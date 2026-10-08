import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER_ID } from "@/server/auth/demo-plugin";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import {
  allocationByType,
  getHoldingsByAccount,
  getHubSummary,
  getInvestments,
  getReconciliation,
  getValueHistory,
  latestChange,
} from "@/server/queries/hub";
import { getContributionAlerts, getContributionReturn, getContributions } from "@/server/queries/contributions";
import { addDays } from "@/tax-engine/dates";
import { ensureDemoSeeded, seedDemo } from "./seed";

/*
 * Seeds the demo into PGlite with the real migrations and checks that every scenario it is meant to
 * show actually comes out of the engine. Exchange rates come from a stub writing into this
 * throwaway database only; the real seed loads Bank of Canada rates.
 */

let client: PGlite;
let db: PgliteDatabase<typeof s>;
const TODAY = "2026-10-06";

async function stubFx(target: AnyDb, currencies: Iterable<string>, from: string, today: string) {
  const rows = [];
  for (let date = addDays(from, -10); date <= today; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    for (const currency of currencies) rows.push({ currency, rateDate: date, cadPerUnit: "1.3500000000" });
  }
  for (let i = 0; i < rows.length; i += 500) await target.insert(s.fxRates).values(rows.slice(i, i + 500)).onConflictDoNothing();
  return { inserted: rows.length, unsupported: [] };
}

const securityId = async (symbol: string, exchange = "XTSE") =>
  (await db.select({ id: s.securities.id }).from(s.securities).where(and(eq(s.securities.symbol, symbol), eq(s.securities.exchange, exchange))))[0]!.id;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await seedDemo(db, TODAY, { syncFx: stubFx });
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("demo seed", () => {
  it("creates the read-only demo user with three brokerages and eight accounts", async () => {
    const [profile] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, DEMO_USER_ID));
    expect(profile).toMatchObject({ isDemo: true, marginalRate: "0.43410" });
    expect(await db.select().from(s.connections).where(eq(s.connections.userId, DEMO_USER_ID))).toHaveLength(3);
    const accounts = await db.select().from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, DEMO_USER_ID));
    expect(accounts.map((a) => a.accountType).sort()).toEqual(
      ["non_registered", "non_registered", "non_registered", "non_registered", "rrsp", "fhsa", "tfsa", "us_retirement"].sort(),
    );
  });

  it("tracks contributions to every registered plan over three years", async () => {
    const rows = await db.select().from(s.contributionSummaries).where(eq(s.contributionSummaries.userId, DEMO_USER_ID));
    const get = (plan: string, year: number) => rows.find((r) => r.plan === plan && r.taxYear === year)!;

    // TFSA: CRA's $12,000 for 2024, then $9,000 on January 1, 2025. Withdrawn in April and put back in
    // August, the $3,000 is an excess until October, and an unpaired $500 transfer in November adds one
    // to December: 3 x $30 + 2 x $5 = $100. 2026 opens at -500 + 3,000 back + 7,000 = $9,500.
    expect(get("tfsa", 2024)).toMatchObject({ roomSource: "cra", openingRoomCad: "12000.000000", roomRemainingCad: "2000.000000" });
    expect(get("tfsa", 2025)).toMatchObject({
      roomSource: "estimate",
      estimateIncomplete: false,
      openingRoomCad: "9000.000000",
      peakExcessCad: "3000.000000",
      penaltyCad: "100.000000",
      roomRemainingCad: "-500.000000",
    });
    expect(get("tfsa", 2026)).toMatchObject({ openingRoomCad: "9500.000000", roomRemainingCad: "7000.000000", penaltyCad: "0.000000" });

    // RRSP: 2025's limit is 2024's unused $9,000 + 18% of $88,000. February 2026's $4,000 counts for 2025.
    expect(get("rrsp", 2024)).toMatchObject({ roomSource: "cra", deductionCad: "3000.000000", unusedRoomCad: "9000.000000" });
    expect(get("rrsp", 2025)).toMatchObject({
      roomSource: "estimate",
      deductionLimitCad: "24840.000000",
      periodOneCad: "7400.000000",
      periodTwoCad: "4000.000000",
      deductionCad: "11400.000000",
      deadline: "2026-03-02",
    });
    expect(get("rrsp", 2026)).toMatchObject({ deductionLimitCad: "30000.000000", contributionsCad: "0.000000" });

    // FHSA: $3,000 carried into 2025; the $2,000 from the RRSP uses room; $6,000 of $8,000 deducted.
    expect(get("fhsa", 2024)).toMatchObject({ firstYear: true, annualLimitCad: "5000.000000", roomRemainingCad: "3000.000000" });
    expect(get("fhsa", 2025)).toMatchObject({
      participationRoomCad: "11000.000000",
      rrspTransfersCad: "2000.000000",
      annualLimitCad: "8000.000000",
      deductionCad: "6000.000000",
      carryForwardCad: "2000.000000",
      roomRemainingCad: "1000.000000",
    });
    expect(get("fhsa", 2026)).toMatchObject({ participationRoomCad: "9000.000000", deductionCad: "6000.000000", carryForwardCad: "0.000000" });

    const review = await db
      .select()
      .from(s.contributionFlowResults)
      .where(and(eq(s.contributionFlowResults.userId, DEMO_USER_ID), eq(s.contributionFlowResults.needsReview, true)));
    expect(review).toMatchObject([{ plan: "tfsa", kind: "contribution", taxYear: 2025, amountCad: "500.000000" }]);
  });

  it("lays out Schedule 7 and Schedule 15 for the Tax Center, and lists the year's flows", async () => {
    const r = await getContributionReturn(db, DEMO_USER_ID, 2025);
    const byLine = Object.fromEntries(r.lines.map((l) => [`${l.form} ${l.line}`, l.amountCad.toFixed(2)]));
    expect(byLine).toMatchObject({
      "Schedule 7 2": "7400.00",
      "Schedule 7 3": "4000.00",
      "Schedule 7 4": "11400.00",
      "Schedule 7 11": "24840.00",
      "Schedule 7 20": "11400.00",
      "T1 20800": "11400.00",
      "Schedule 15 1": "8000.00",
      "Schedule 15 15": "3000.00",
      "Schedule 15 18": "2000.00",
      "Schedule 15 40": "8000.00",
      "Schedule 15 57": "6000.00",
      "Schedule 15 58": "2000.00",
      "T1 20805": "6000.00",
    });
    expect(r).toMatchObject({ rrspLimitUnknown: false, flowsToReview: 1 });
    expect(r.tfsa).toMatchObject({ penaltyCad: "100.000000" });

    const view = await getContributions(db, DEMO_USER_ID, 2025, TODAY);
    expect(view.summaries.map((x) => x.plan)).toEqual(["tfsa", "rrsp", "fhsa"]);
    // February 2026's RRSP contribution is listed under 2025, where it counts; the margin side of the TFSA transfer is not listed.
    expect(view.flows.some((f) => f.date === "2026-02-20" && f.plan === "rrsp")).toBe(true);
    expect(view.flows.every((f) => f.accountName !== "Margin")).toBe(true);
    expect(view.inputs.rrsp.earnedIncomePriorYear).toBe("88000.00");
    expect(view.profile).toEqual({ birthYear: "1988", residentSinceYear: "", fhsaOpenedYear: "2024" });
    // Nothing is over the limit this year, so the Hub has no contribution alert.
    expect(await getContributionAlerts(db, DEMO_USER_ID, 2026)).toEqual([]);
    expect(await getContributionAlerts(db, DEMO_USER_ID, 2025)).toMatchObject([{ plan: "tfsa", peakExcessCad: "3000.000000" }]);
  });

  it("has realized gains in three tax years", async () => {
    const years = await db.select({ year: s.taxYearSummaries.taxYear }).from(s.taxYearSummaries).where(eq(s.taxYearSummaries.userId, DEMO_USER_ID));
    expect(years.map((y) => y.year).sort()).toEqual([2024, 2025, 2026]);
  });

  it("shows a pending superficial loss caused by a TFSA purchase, lost for good", async () => {
    const [loss] = await db.select().from(s.superficialLosses).where(eq(s.superficialLosses.userId, DEMO_USER_ID));
    // 40 SHOP bought at 150, sold at 110: a 1,600 loss. 15 rebought in the TFSA deny 15/40 of it.
    expect(loss).toMatchObject({ status: "pending", totalLossCad: "1600.000000", deniedLossCad: "600.000000", lostForeverCad: "600.000000" });
  });

  it("pools RY across the TSX and the NYSE, and counts its U.S. dividends as eligible", async () => {
    const ry = await securityId("RY");
    const gains = await db.select().from(s.realizedGains).where(and(eq(s.realizedGains.userId, DEMO_USER_ID), eq(s.realizedGains.securityId, ry)));
    expect(gains).toMatchObject([{ kind: "sale", incomplete: false }]);
    const income = await db.select().from(s.incomeEvents).where(eq(s.incomeEvents.securityId, ry));
    expect(new Set(income.map((i) => i.dividendClass))).toEqual(new Set(["eligible"]));
    expect(income).toHaveLength(11);
  });

  it("records the move into the TFSA as a deemed sale", async () => {
    const [deemed] = await db
      .select()
      .from(s.realizedGains)
      .where(and(eq(s.realizedGains.userId, DEMO_USER_ID), eq(s.realizedGains.kind, "deemed_disposition")));
    expect(Number(deemed!.gainCad)).toBeGreaterThan(0);
  });

  it("suggests harvesting BCE, with no purchase blocking the sale", async () => {
    const bce = await securityId("BCE");
    const [harvest] = await db.select().from(s.harvestOpportunities).where(eq(s.harvestOpportunities.securityId, bce));
    expect(harvest).toMatchObject({ blockedByRecentPurchase: false });
  });

  it("matches the brokers everywhere but the RRSP's untracked VFV units, which do not affect tax", async () => {
    const summary = await getReconciliation(db, DEMO_USER_ID, TODAY);
    // Pooled XEQT, RY, BCE, AAPL, MSFT all match; the registered rows are checked but carry no ACB.
    expect(summary).toMatchObject({ matched: 5, total: 5, gaps: [], waiting: [] });
    expect(summary.registered).toEqual([
      expect.objectContaining({ symbol: "VFV", accountName: "RRSP", ledgerQuantity: "30.0000000000", brokerQuantity: "40.0000000000" }),
    ]);
  });

  it("closes the MSFT transfer with an opening balance, and lists one RY row on the Hub", async () => {
    const msft = await securityId("MSFT", "XNAS");
    const events = await db.select().from(s.acbEvents).where(eq(s.acbEvents.securityId, msft));
    expect(events.map((e) => e.rule)).toEqual(["opening_balance"]);
    const rows = await getInvestments(db, DEMO_USER_ID, TODAY);
    expect(rows.filter((r) => r.symbol === "RY")).toHaveLength(1);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["AAPL", "BCE", "MSFT", "RY", "SHOP", "VFV", "XEQT"]);
  });

  it("has a value history that ends exactly on today's Hub total, overall and per brokerage", async () => {
    const summary = await getHubSummary(db, DEMO_USER_ID, TODAY);
    const history = await getValueHistory(db, DEMO_USER_ID);
    expect(history.length).toBeGreaterThan(400);
    expect(history.at(-1)).toEqual({ day: TODAY, valueCad: summary.totalValueCad });
    expect(history[0]!.day < addDays(TODAY, -900)).toBe(true);
    expect(latestChange(history)).toMatchObject({ sinceDay: addDays(TODAY, -1) });

    for (const brokerage of summary.brokerages) {
      const own = await getValueHistory(db, DEMO_USER_ID, brokerage.accounts.map((a) => a.id));
      expect(own.at(-1)!.valueCad).toBe(brokerage.totalCad);
    }
  });

  it("splits the total by account type, with cash accounts on their own", async () => {
    const summary = await getHubSummary(db, DEMO_USER_ID, TODAY);
    const slices = allocationByType(summary.brokerages);
    expect(slices.map((x) => x.key)).toEqual(["non_registered", "tfsa", "rrsp", "other_registered", "cash"]);
    const sum = slices.reduce((acc, x) => acc + Number(x.valueCad), 0);
    expect(sum).toBeCloseTo(Number(summary.totalValueCad), 2);
    expect(slices.find((x) => x.key === "cash")!.valueCad).toBe("3500.00");
  });

  it("narrows investments to one brokerage, keeps ACB pooled, and has price trends", async () => {
    const summary = await getHubSummary(db, DEMO_USER_ID, TODAY);
    const ws = summary.brokerages.find((b) => b.name === "Wealthsimple")!;
    const ids = ws.accounts.map((a) => a.id);
    const all = await getInvestments(db, DEMO_USER_ID, TODAY);
    const rows = await getInvestments(db, DEMO_USER_ID, TODAY, ids);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["VFV", "XEQT"]);
    const xeqt = rows.find((r) => r.symbol === "XEQT")!;
    // XEQT units at Wealthsimple only, but its ACB is the pool across Questrade too.
    expect(Number(xeqt.brokerQuantity)).toBeLessThan(Number(all.find((r) => r.symbol === "XEQT")!.brokerQuantity));
    expect(xeqt.totalAcbCad).toBe(all.find((r) => r.symbol === "XEQT")!.totalAcbCad);
    expect(xeqt.trend.length).toBeGreaterThan(60);
    expect(Number(xeqt.trend.at(-1))).toBeCloseTo(33.1, 6);

    const perAccount = await getHoldingsByAccount(db, DEMO_USER_ID, TODAY);
    const [held] = await db.select({ n: count() }).from(s.holdings).where(eq(s.holdings.userId, DEMO_USER_ID));
    expect(perAccount).toHaveLength(held!.n);
    // Both RY listings link to the one pooled security page.
    expect(new Set(perAccount.filter((r) => r.symbol === "RY").map((r) => r.securityId)).size).toBe(1);
  });

  it("resets to the same state when run again, and ensureDemoSeeded leaves it alone", async () => {
    const totals = async () =>
      Promise.all(
        [
          s.transactions,
          s.holdings,
          s.acbEvents,
          s.realizedGains,
          s.positionReconciliations,
          s.accountValueSnapshots,
          s.securityPriceSnapshots,
        ].map(async (table) => {
          const [row] = await db.select({ n: count() }).from(table).where(eq(table.userId, DEMO_USER_ID));
          return row!.n;
        }),
      );
    const before = await totals();
    await seedDemo(db, TODAY, { syncFx: stubFx });
    expect(await totals()).toEqual(before);
    await ensureDemoSeeded(db, TODAY, { syncFx: () => Promise.reject(new Error("must not reseed")) });
    expect(await totals()).toEqual(before);
  });
});
