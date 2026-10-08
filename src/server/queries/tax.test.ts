import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER_ID } from "@/server/auth/demo-plugin";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { seedDemo } from "@/server/demo/seed";
import { taxYearCsv } from "@/lib/tax-csv";
import { D } from "@/tax-engine";
import { addDays, nextBusinessDay } from "@/tax-engine/dates";
import { getTaxYear, getTaxYears, groupDividends, type TaxYearView } from "./tax";

/*
 * The Tax Center read queries over the demo portfolio, seeded into PGlite with the real migrations.
 * The demo is the richest ledger TaxBack has: three brokerages, three tax years, registered and
 * U.S. retirement accounts, an interlisted pool, a pending superficial loss, and a harvest.
 *
 * The totals the page and the CSV print come from `tax_year_summaries`, while the rows come from the
 * detail tables, so the strongest check is that the two agree for every year.
 */

let client: PGlite;
let db: PgliteDatabase<typeof s>;
const TODAY = "2026-10-06";
const views = new Map<number, TaxYearView>();

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

const sum = (values: string[]) => values.reduce((total, v) => total.plus(v), new D(0));

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await seedDemo(db, TODAY, { syncFx: stubFx });
  for (const year of await getTaxYears(db, DEMO_USER_ID, TODAY)) {
    views.set(year, await getTaxYear(db, DEMO_USER_ID, year, TODAY));
  }
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("getTaxYears", () => {
  it("lists every year with results, newest first", async () => {
    expect(await getTaxYears(db, DEMO_USER_ID, TODAY)).toEqual([2026, 2025, 2024]);
  });

  it("offers the year in progress even for a user with no results", async () => {
    await db.insert(s.users).values({ id: "fresh", name: "F", email: "f@example.com" });
    await db.insert(s.userProfiles).values({ userId: "fresh" });
    expect(await getTaxYears(db, "fresh", TODAY)).toEqual([2026]);
    const view = await getTaxYear(db, "fresh", 2026, TODAY);
    expect(view).toMatchObject({ totals: null, gains: [], superficialLosses: [], dividends: [], harvest: [] });
  });
});

describe("getTaxYear", () => {
  it("has results for all three demo years", () => {
    expect([...views.keys()]).toEqual([2026, 2025, 2024]);
    for (const [year, view] of views) {
      expect(view.totals, `${year} summary`).not.toBeNull();
      expect(view.gains.length, `${year} gains`).toBeGreaterThan(0);
      expect(view.dividends.length, `${year} dividends`).toBeGreaterThan(0);
    }
  });

  it("agrees with the saved year summary on every total the page prints", () => {
    for (const [year, view] of views) {
      const t = view.totals!;
      const label = `year ${year}`;
      expect(sum(view.gains.map((g) => g.proceedsCad)).toFixed(6), label).toBe(new D(t.proceedsCad).toFixed(6));
      expect(sum(view.gains.map((g) => g.acbCad)).toFixed(6), label).toBe(new D(t.acbCad).toFixed(6));
      expect(sum(view.gains.map((g) => g.feesCad)).toFixed(6), label).toBe(new D(t.feesCad).toFixed(6));
      expect(sum(view.gains.map((g) => g.deniedLossCad)).toFixed(6), label).toBe(new D(t.deniedLossesCad).toFixed(6));
      expect(sum(view.gains.map((g) => g.gainCad)).toFixed(6), label).toBe(new D(t.grossGainCad).toFixed(6));
      expect(sum(view.gains.map((g) => g.allowedGainCad)).toFixed(6), label).toBe(new D(t.netCapitalGainCad).toFixed(6));
      // The taxable half, which is what a return actually carries. The engine rounds the net and the
      // taxable amount to six decimals independently, so they can differ by one unit in the last place.
      const halfOfNet = new D(t.netCapitalGainCad).times(t.inclusionRate);
      expect(new D(t.taxableCapitalGainCad).minus(halfOfNet).abs().lte("0.000001"), label).toBe(true);
    }
  });

  it("agrees with the saved summary on each dividend class and on the income tile", () => {
    for (const [year, view] of views) {
      const t = view.totals!;
      const ofClass = (cls: string) => sum(view.dividends.filter((d) => d.dividendClass === cls).map((d) => d.amountCad)).toFixed(6);
      expect(ofClass("eligible"), `year ${year}`).toBe(new D(t.eligibleDividendsCad).toFixed(6));
      expect(ofClass("non_eligible"), `year ${year}`).toBe(new D(t.nonEligibleDividendsCad).toFixed(6));
      expect(ofClass("foreign"), `year ${year}`).toBe(new D(t.foreignIncomeCad).toFixed(6));
      expect(sum(view.dividends.map((d) => d.withholdingCad)).toFixed(6), `year ${year}`).toBe(new D(t.foreignWithholdingCad).toFixed(6));
      expect(new D(t.totalIncomeCad).toFixed(6)).toBe(
        new D(t.eligibleDividendsCad).plus(t.nonEligibleDividendsCad).plus(t.foreignIncomeCad).toFixed(6),
      );
    }
  });

  it("leaves registered and U.S. retirement accounts out of gains and income", () => {
    const registered = ["TFSA", "RRSP", "Roth IRA"];
    for (const view of views.values()) {
      // The deemed sale on a move into the TFSA belongs to the non-registered account it left.
      expect(view.gains.map((g) => g.accountName).filter((n) => n && registered.includes(n))).toEqual([]);
      expect(view.dividends.map((d) => d.accountName).filter((n) => n && registered.includes(n))).toEqual([]);
    }
  });

  it("reports the SHOP superficial loss with the TFSA purchase that denied it", () => {
    const losses = views.get(2026)!.superficialLosses;
    expect(losses).toHaveLength(1);
    const loss = losses[0]!;
    // 40 SHOP bought at 150 and sold at 110 is a 1,600 loss; 15 rebought in the TFSA deny 15/40 of it.
    expect(loss).toMatchObject({
      symbol: "SHOP",
      status: "pending",
      quantitySold: "40.0000000000",
      totalLossCad: "1600.000000",
      deniedLossCad: "600.000000",
      allowedLossCad: "1000.000000",
      lostForeverCad: "600.000000",
    });
    expect(loss.windowEnd > TODAY).toBe(true);
    expect(loss.replacements).toEqual([
      expect.objectContaining({ accountName: "TFSA", accountType: "tfsa", disposition: "lost_forever", deniedCad: "600.000000" }),
    ]);
    // The denial shows up against the sale on the Schedule 3 table too.
    const sale = views.get(2026)!.gains.find((g) => g.symbol === "SHOP" && g.dispositionDate === loss.saleDate)!;
    expect(sale).toMatchObject({ gainCad: "-1600.000000", deniedLossCad: "600.000000", allowedGainCad: "-1000.000000" });
  });

  it("groups dividends by security and class, keeping every payment counted", () => {
    const view = views.get(2025)!;
    const groups = groupDividends(view.dividends);
    expect(groups.length).toBeLessThan(view.dividends.length);
    expect(sum(groups.map((g) => g.amountCad)).toFixed(6)).toBe(sum(view.dividends.map((d) => d.amountCad)).toFixed(6));
    expect(groups.reduce((n, g) => n + g.payments, 0)).toBe(view.dividends.length);
    // One row per security and class, and no row for a class with nothing in it.
    expect(new Set(groups.map((g) => `${g.securityId}:${g.dividendClass}`)).size).toBe(groups.length);
    // RY is interlisted; its TSX and NYSE payments pool into one eligible row.
    const ry = groups.filter((g) => g.symbol === "RY");
    expect(ry).toHaveLength(1);
    expect(ry[0]).toMatchObject({ dividendClass: "eligible" });
  });

  it("suggests harvesting only for the year in progress", () => {
    const current = views.get(2026)!;
    expect(current.isCurrentYear).toBe(true);
    expect(current.harvest.map((h) => h.symbol)).toContain("BCE");
    const bce = current.harvest.find((h) => h.symbol === "BCE")!;
    expect(bce).toMatchObject({ blockedByRecentPurchase: false, asOfDate: TODAY, earliestSafeSaleDate: TODAY });
    expect(Number(bce.unrealizedLossCad)).toBeGreaterThan(0);
    // A sale today settles T+1; no buying back in any account until the 30 days after that are over.
    expect(bce.noRebuyBefore).toBe(addDays(nextBusinessDay(TODAY), 31));

    for (const year of [2025, 2024]) {
      expect(views.get(year)!.isCurrentYear).toBe(false);
      expect(views.get(year)!.harvest).toEqual([]);
    }
  });

  it("uses the demo's marginal rate for the tax estimate", () => {
    const view = views.get(2025)!;
    expect(view.marginalRate).toBe("0.43410");
    const t = view.totals!;
    const expected = Number(t.taxableCapitalGainCad) > 0 ? new D(t.taxableCapitalGainCad).times(view.marginalRate!).toFixed(6) : "0.000000";
    expect(new D(t.estimatedTaxCad!).toFixed(6)).toBe(expected);
  });
});

describe("taxYearCsv over the demo", () => {
  it("writes one line per row under each section, with the summary totals", () => {
    const view = views.get(2026)!;
    const csv = taxYearCsv(view, TODAY);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("TaxBack,Tax year 2026");
    expect(csv).toContain(`Generated,${TODAY}`);
    expect(csv).toContain(`Net capital gain or loss,${new D(view.totals!.netCapitalGainCad).toFixed(2)}`);

    // Every gain, loss, dividend payment, and harvest row reaches the file.
    const after = (heading: string) => {
      const start = lines.indexOf(heading);
      expect(start, heading).toBeGreaterThan(-1);
      const rest = lines.slice(start + 2);
      return rest.slice(0, rest.findIndex((l) => l === "")).length;
    };
    expect(after("Realized gains and losses (Schedule 3)")).toBe(view.gains.length + 1); // plus the total row
    expect(after("Superficial losses")).toBe(view.superficialLosses.length);
    expect(after("Dividends and investment income")).toBe(view.dividends.length + 1);
    expect(csv).toContain("Replacement purchases that absorbed the denied loss");
    expect(csv).toContain(`Tax-loss harvesting, as of ${TODAY}`);
  });

  it("totals each dividend column at full precision, and warns that a printed column may not foot", () => {
    for (const [year, view] of views) {
      const lines = taxYearCsv(view, TODAY).split("\r\n");
      const start = lines.indexOf("Dividends and investment income") + 2;
      const totalAt = start + lines.slice(start).findIndex((l) => l.startsWith("Total,"));
      expect(lines.slice(start, totalAt).length, `year ${year}`).toBe(view.dividends.length);
      // The last four cells are amount, taxable amount, federal credit, and withholding. Counting from
      // the end survives a security name that holds a comma, which is written as one quoted cell.
      const total = lines[totalAt]!.split(",").slice(-4);
      const fields = ["amountCad", "grossedUpCad", "federalCreditCad", "withholdingCad"] as const;
      fields.forEach((field, column) => {
        const exact = view.dividends.reduce((t, d) => t.plus(d[field]), new D(0)).toFixed(2);
        expect(total[column], `year ${year}, ${field}`).toBe(exact);
      });
    }
    // 2026 is the year that showed why: nine credits that each print to the cent add to 126.09, while
    // the engine's own total is 126.07. The header has to say so rather than let a reader find it.
    expect(taxYearCsv(views.get(2026)!, TODAY)).toContain("adding up a printed column can land a cent or two away");
  });

  it("names the empty sections of a quiet year rather than dropping them", () => {
    const csv = taxYearCsv({ ...views.get(2024)!, gains: [], superficialLosses: [], dividends: [], harvest: [] }, TODAY);
    expect(csv).toContain("Realized gains and losses (Schedule 3)\r\nNone for this year.");
    expect(csv).toContain("Superficial losses\r\nNone for this year.");
    expect(csv).toContain("Dividends and investment income\r\nNone for this year.");
  });
});
