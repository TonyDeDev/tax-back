import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@/server/db/schema";
import { getInvestments, getReconciliation } from "@/server/queries/hub";
import { canonicalSecurityId, getSecurityDetail } from "@/server/queries/security";
import { recomputeUser } from "./recompute";

/*
 * The recompute against real migrations on PGlite: corporate actions, transfers into a TFSA, and
 * reconciliation against stored holdings all land in the derived tables, and the read queries behind
 * the security page and the Hub return them. A change the engine cannot compute rolls back whole.
 */

let client: PGlite;
let db: PgliteDatabase<typeof s>;
const U = "user-r";
const TODAY = "2025-12-31";
const ids = {} as Record<"nonReg" | "tfsa" | "old" | "next" | "xyz" | "usd", string>;

const tx = (over: Partial<typeof s.transactions.$inferInsert> & { snaptradeActivityId: string }) => ({
  userId: U,
  accountId: ids.nonReg,
  securityId: ids.xyz,
  kind: "buy" as const,
  tradeDate: "2025-01-06",
  settlementDate: "2025-01-06",
  currency: "CAD",
  quantity: "1",
  price: "1",
  raw: {},
  ...over,
});

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  await db.insert(s.users).values({ id: U, name: "R", email: "r@example.com" });
  await db.insert(s.userProfiles).values({ userId: U });
  const [conn] = await db
    .insert(s.connections)
    .values({ userId: U, snaptradeAuthorizationId: "auth-r", brokerageSlug: "qt", brokerageName: "Questrade" })
    .returning();
  const accounts = await db
    .insert(s.brokerageAccounts)
    .values([
      { userId: U, connectionId: conn!.id, snaptradeAccountId: "r-1", name: "Margin", baseCurrency: "CAD" },
      { userId: U, connectionId: conn!.id, snaptradeAccountId: "r-2", name: "TFSA", baseCurrency: "CAD", accountType: "tfsa" },
    ])
    .returning();
  ids.nonReg = accounts[0]!.id;
  ids.tfsa = accounts[1]!.id;
  const secs = await db
    .insert(s.securities)
    .values([
      { symbol: "OLD", exchange: "TSX", currency: "CAD" },
      { symbol: "NEXT", exchange: "TSX", currency: "CAD" },
      { symbol: "XYZ", exchange: "TSX", currency: "CAD" },
      { symbol: "USDCO", exchange: "NYSE", currency: "USD" },
    ])
    .returning();
  [ids.old, ids.next, ids.xyz, ids.usd] = secs.map((x) => x.id) as [string, string, string, string];
  await db.insert(s.fxRates).values({ currency: "USD", rateDate: "2025-01-02", cadPerUnit: "1.40" });

  await db.insert(s.transactions).values([
    // 100 OLD at 30 = 3000, later merged 1:2 into NEXT with 10 cash per share.
    tx({ snaptradeActivityId: "1", securityId: ids.old, quantity: "100", price: "30" }),
    // 100 XYZ at 10; 40 move into the TFSA at 15: a deemed sale with a 200 gain.
    tx({ snaptradeActivityId: "2", quantity: "100", price: "10" }),
    tx({ snaptradeActivityId: "3", kind: "transfer_out", tradeDate: "2025-03-03", settlementDate: "2025-03-03", quantity: "40", price: "15" }),
    tx({ snaptradeActivityId: "4", accountId: ids.tfsa, kind: "transfer_in", tradeDate: "2025-03-04", settlementDate: "2025-03-04", quantity: "40", price: "15" }),
  ]);
  await db.insert(s.corporateActions).values({
    userId: U,
    kind: "merger",
    securityId: ids.old,
    targetSecurityId: ids.next,
    effectiveDate: "2025-04-01",
    currency: "CAD",
    ratio: "0.5",
    newFmv: "100",
    cashPerShare: "10",
  });
  // The brokers: 60 XYZ in margin, 40 in the TFSA, 50 NEXT, and 25 XYZ more than the history explains.
  await db.insert(s.holdings).values([
    { userId: U, accountId: ids.nonReg, securityId: ids.xyz, quantity: "85", price: "16", currency: "CAD", asOf: new Date() },
    { userId: U, accountId: ids.tfsa, securityId: ids.xyz, quantity: "40", price: "16", currency: "CAD", asOf: new Date() },
    { userId: U, accountId: ids.nonReg, securityId: ids.next, quantity: "50", price: "90", currency: "CAD", asOf: new Date() },
  ]);
  await recomputeUser(db, U, TODAY);
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("recompute", () => {
  it("stores a merger's events and its cash gain against the corporate action, with no account", async () => {
    // ACB for the cash: 3000 x 1000 / (1000 + 5000) = 500, gain 500; NEXT carries 2500.
    const [gain] = await db.select().from(s.realizedGains).where(eq(s.realizedGains.kind, "merger_cash"));
    expect(gain).toMatchObject({ transactionId: null, accountId: null, gainCad: "500.000000" });
    expect(gain!.corporateActionId).not.toBeNull();
    const [next] = await db.select().from(s.acbPositions).where(eq(s.acbPositions.securityId, ids.next));
    expect(next).toMatchObject({ quantity: "50.0000000000", totalAcbCad: "2500.000000" });
    const events = await db.select().from(s.acbEvents).where(eq(s.acbEvents.securityId, ids.next));
    expect(events.map((e) => [e.rule, e.corporateActionId === gain!.corporateActionId])).toEqual([["merger_rollover_in", true]]);
  });

  it("stores a transfer into the TFSA as a deemed sale, with the rule and rate on its audit step", async () => {
    const [gain] = await db.select().from(s.realizedGains).where(eq(s.realizedGains.kind, "deemed_disposition"));
    expect(gain).toMatchObject({ gainCad: "200.000000", accountId: ids.nonReg });
    const events = await db.select().from(s.acbEvents).where(eq(s.acbEvents.securityId, ids.xyz)).orderBy(s.acbEvents.seq);
    expect(events.map((e) => [e.rule, e.fxRate])).toEqual([
      ["buy_cost_plus_commission", "1.0000000000"],
      ["transfer_to_registered_deemed_sale", "1.0000000000"],
    ]);
  });

  it("reconciles the pooled position and the TFSA against the broker", async () => {
    const rows = await db.select().from(s.positionReconciliations).where(eq(s.positionReconciliations.securityId, ids.xyz));
    const pooled = rows.find((r) => r.accountId === null);
    const tfsa = rows.find((r) => r.accountId === ids.tfsa);
    expect(pooled).toMatchObject({ ledgerQuantity: "60.0000000000", brokerQuantity: "85.0000000000", status: "broker_has_more" });
    expect(tfsa).toMatchObject({ status: "match" });

    const summary = await getReconciliation(db, U, TODAY);
    // Only the pooled non-registered rows count: the ones ACB depends on.
    expect(summary).toMatchObject({ matched: 1, total: 2, waiting: [], registered: [] });
    // Seen on the first reconciliation, so it is missing history, not a delay: the user is asked at once.
    expect(summary.gaps).toEqual([expect.objectContaining({ symbol: "XYZ", accountName: null, status: "broker_has_more", gapSince: null })]);
  });

  it("an opening balance closes the gap", async () => {
    await db.insert(s.manualAdjustments).values({ userId: U, securityId: ids.xyz, quantity: "25", acbCad: "300", asOfDate: "2025-01-06" });
    await recomputeUser(db, U, TODAY);
    const [pooled] = await db
      .select()
      .from(s.positionReconciliations)
      .where(and(eq(s.positionReconciliations.securityId, ids.xyz), isNull(s.positionReconciliations.accountId)));
    expect(pooled).toMatchObject({ ledgerQuantity: "85.0000000000", status: "match" });
    expect(await getReconciliation(db, U, TODAY)).toMatchObject({ matched: 2, total: 2, gaps: [] });
  });

  it("gives a gap that appears after a match a few days to resolve, and keeps its first day", async () => {
    await db.delete(s.manualAdjustments).where(eq(s.manualAdjustments.securityId, ids.xyz));
    await recomputeUser(db, U, TODAY);
    let summary = await getReconciliation(db, U, TODAY);
    expect(summary.gaps).toEqual([]);
    expect(summary.waiting).toEqual([expect.objectContaining({ symbol: "XYZ", gapSince: TODAY })]);

    // Still there three days later: the day carries across recomputes, and it becomes a gap to fix.
    const later = "2026-01-03";
    await recomputeUser(db, U, later);
    summary = await getReconciliation(db, U, later);
    expect(summary.waiting).toEqual([]);
    expect(summary.gaps).toEqual([expect.objectContaining({ symbol: "XYZ", gapSince: TODAY })]);

    // Put the opening balance back for the tests that follow.
    await db.insert(s.manualAdjustments).values({ userId: U, securityId: ids.xyz, quantity: "25", acbCad: "300", asOfDate: "2025-01-06" });
    await recomputeUser(db, U, TODAY);
  });

  it("rolls the whole change back when the engine cannot compute it", async () => {
    // A USD merger dated before the first stored rate: the engine refuses to guess a rate.
    const attempt = db.transaction(async (t) => {
      await t.insert(s.corporateActions).values({
        userId: U,
        kind: "merger",
        securityId: ids.usd,
        targetSecurityId: ids.old,
        effectiveDate: "2024-01-02",
        currency: "USD",
        ratio: "1",
        newFmv: "10",
        cashPerShare: "1",
      });
      await t.insert(s.transactions).values(tx({ snaptradeActivityId: "u1", securityId: ids.usd, currency: "USD", tradeDate: "2023-12-01", settlementDate: "2023-12-01" }));
      await recomputeUser(t, U, TODAY);
    });
    await expect(attempt).rejects.toThrow(/No USD\/CAD rate/);
    expect(await db.select().from(s.corporateActions).where(eq(s.corporateActions.securityId, ids.usd))).toEqual([]);
    expect(await db.select().from(s.realizedGains).where(eq(s.realizedGains.kind, "merger_cash"))).toHaveLength(1);
  });
});

describe("read queries", () => {
  it("the security page gets every audit step with its source and rule", async () => {
    const detail = await getSecurityDetail(db, U, ids.xyz, TODAY);
    expect(detail!.audit.map((a) => [a.rule, a.source.type])).toEqual([
      ["opening_balance", "opening"],
      ["buy_cost_plus_commission", "transaction"],
      ["transfer_to_registered_deemed_sale", "transaction"],
    ]);
    expect(detail!.audit[1]!.source).toMatchObject({ accountName: "Margin", brokerage: "Questrade", price: "10.000000" });
    expect(detail!.opening).toMatchObject({ asOfDate: "2025-01-06" });
    expect(detail!.otherSecurities.map((x) => x.symbol)).toEqual(["NEXT", "OLD"]);
  });

  it("the security page shows corporate actions from both sides", async () => {
    const next = await getSecurityDetail(db, U, ids.next, TODAY);
    expect(next!.corporateActions).toMatchObject([{ kind: "merger", role: "target", otherSymbol: "OLD" }]);
    expect(next!.audit[0]!.source).toMatchObject({ type: "corporate", role: "target", otherSymbol: "OLD" });
    // 50 NEXT at 90 = 4500 against 2500 of ACB.
    expect([next!.marketValueCad, next!.unrealizedCad]).toEqual(["4500.00", "2000.00"]);
  });

  it("the security page is not found for a security this user never touched", async () => {
    expect(await getSecurityDetail(db, U, ids.usd, TODAY)).toBeNull();
  });

  it("the Hub lists investments with pooled ACB and every account's units", async () => {
    const rows = await getInvestments(db, U, TODAY);
    const xyz = rows.find((r) => r.symbol === "XYZ")!;
    expect(xyz).toMatchObject({ brokerQuantity: "125", pooledQuantity: "85.0000000000", marketValueCad: "2000.00" });
    expect(rows[0]!.symbol).toBe("NEXT");
  });
});

describe("U.S. brokerages: interlisted shares, IRAs, and dividends", () => {
  const V = "user-us";
  const us = {} as Record<"cdn" | "schwab" | "ira" | "ryTsx" | "ryNyse" | "tdTsx" | "tdNyse", string>;
  const trade = (over: Partial<typeof s.transactions.$inferInsert> & { snaptradeActivityId: string }) => ({
    userId: V,
    accountId: us.cdn,
    securityId: us.ryTsx,
    kind: "buy" as const,
    tradeDate: "2025-02-03",
    settlementDate: "2025-02-03",
    currency: "CAD",
    quantity: "1",
    price: "1",
    raw: {},
    ...over,
  });

  beforeAll(async () => {
    await db.insert(s.users).values({ id: V, name: "V", email: "v@example.com" });
    await db.insert(s.userProfiles).values({ userId: V });
    const [qt, sw] = await db
      .insert(s.connections)
      .values([
        { userId: V, snaptradeAuthorizationId: "auth-qt", brokerageSlug: "questrade", brokerageName: "Questrade" },
        { userId: V, snaptradeAuthorizationId: "auth-sw", brokerageSlug: "schwab", brokerageName: "Charles Schwab" },
      ])
      .returning();
    const accounts = await db
      .insert(s.brokerageAccounts)
      .values([
        { userId: V, connectionId: qt!.id, snaptradeAccountId: "v-1", name: "Margin", baseCurrency: "CAD" },
        { userId: V, connectionId: sw!.id, snaptradeAccountId: "v-2", name: "Individual", baseCurrency: "USD" },
        { userId: V, connectionId: sw!.id, snaptradeAccountId: "v-3", name: "Roth IRA", baseCurrency: "USD", accountType: "us_retirement" },
      ])
      .returning();
    [us.cdn, us.schwab, us.ira] = accounts.map((a) => a.id) as [string, string, string];
    const secs = await db
      .insert(s.securities)
      .values([
        { symbol: "RY", exchange: "XTSE", currency: "CAD", country: "CA", figiShareClass: "BBG001S5S1X6" },
        { symbol: "RY", exchange: "XNYS", currency: "USD", country: "US", figiShareClass: "BBG001S5S1X6" },
        { symbol: "TD", exchange: "XTSE", currency: "CAD", country: "CA" },
        { symbol: "TD", exchange: "XNYS", currency: "USD", country: "US" },
      ])
      .returning();
    [us.ryTsx, us.ryNyse, us.tdTsx, us.tdNyse] = secs.map((x) => x.id) as [string, string, string, string];

    await db.insert(s.transactions).values([
      // 100 RY bought on the TSX for 10,000 CAD, journaled and sold on the NYSE at 60 USD (x 1.40 = 8,400): a 1,600 loss.
      trade({ snaptradeActivityId: "ry1", quantity: "100", price: "100" }),
      trade({ snaptradeActivityId: "ry2", accountId: us.schwab, securityId: us.ryNyse, kind: "sell", currency: "USD", tradeDate: "2025-03-03", settlementDate: "2025-03-03", quantity: "100", price: "60" }),
      // 10 RY rebought in the Roth IRA a week later: 10% of the loss is superficial, and lost for good.
      trade({ snaptradeActivityId: "ry3", accountId: us.ira, securityId: us.ryNyse, currency: "USD", tradeDate: "2025-03-10", settlementDate: "2025-03-10", quantity: "10", price: "61" }),
      // A RY dividend paid in USD at Schwab, stored as foreign by the listing.
      trade({ snaptradeActivityId: "ry4", accountId: us.schwab, securityId: us.ryNyse, kind: "dividend", currency: "USD", tradeDate: "2025-02-20", settlementDate: "2025-02-20", quantity: "0", price: "0", amount: "10", dividendClass: "foreign" }),
      // An IRA sale at a gain: never taxable in Canada while inside the account.
      trade({ snaptradeActivityId: "ry5", accountId: us.ira, securityId: us.ryNyse, kind: "sell", currency: "USD", tradeDate: "2025-06-02", settlementDate: "2025-06-02", quantity: "5", price: "90" }),
      // TD: no FIGI. Bought on the TSX, sold on the NYSE.
      trade({ snaptradeActivityId: "td1", securityId: us.tdTsx, quantity: "50", price: "80" }),
      trade({ snaptradeActivityId: "td2", accountId: us.schwab, securityId: us.tdNyse, kind: "sell", currency: "USD", tradeDate: "2025-04-01", settlementDate: "2025-04-01", quantity: "50", price: "70" }),
    ]);
    await db.insert(s.holdings).values({ userId: V, accountId: us.ira, securityId: us.ryNyse, quantity: "5", price: "90", currency: "USD", asOf: new Date() });
    await recomputeUser(db, V, TODAY);
  });

  const gainsOf = (securityId: string) =>
    db.select().from(s.realizedGains).where(and(eq(s.realizedGains.userId, V), eq(s.realizedGains.securityId, securityId)));

  it("pools RY on the TSX and the NYSE as one security, each trade at its own currency", async () => {
    const [gain, ...rest] = await gainsOf(us.ryTsx);
    expect(rest).toEqual([]);
    expect(gain).toMatchObject({ proceedsCad: "8400.000000", acbCad: "10000.000000", gainCad: "-1600.000000", incomplete: false });
    expect(await gainsOf(us.ryNyse)).toEqual([]);
  });

  it("catches a repurchase in a Roth IRA as superficial, and the denied part is lost for good", async () => {
    const [gain] = await gainsOf(us.ryTsx);
    expect(gain).toMatchObject({ deniedLossCad: "160.000000", allowedGainCad: "-1440.000000" });
    const [replacement] = await db.select().from(s.superficialLossReplacements).where(eq(s.superficialLossReplacements.userId, V));
    expect(replacement).toMatchObject({ accountType: "us_retirement", disposition: "lost_forever" });
  });

  it("gives a U.S.-listed Canadian company's dividend the eligible class", async () => {
    const [income] = await db.select().from(s.incomeEvents).where(eq(s.incomeEvents.userId, V));
    expect(income).toMatchObject({ dividendClass: "eligible", amountCad: "14.000000" });
  });

  it("reconciles the IRA on its own, under the pooled security", async () => {
    const rows = await db.select().from(s.positionReconciliations).where(eq(s.positionReconciliations.userId, V));
    expect(rows.map((r) => [r.securityId, r.accountId, r.status])).toContainEqual([us.ryTsx, us.ira, "match"]);
  });

  it("sends the NYSE listing's page to the pooled one, and the Hub shows one row", async () => {
    expect(await canonicalSecurityId(db, V, us.ryNyse)).toBe(us.ryTsx);
    const detail = await getSecurityDetail(db, V, us.ryTsx, TODAY);
    expect(detail!.listings.map((l) => [l.exchange, l.reason])).toEqual([
      ["XTSE", "canonical"],
      ["XNYS", "figi"],
    ]);
    expect(detail!.automaticDividendClass).toBe("eligible");
    const rows = (await getInvestments(db, V, TODAY)).filter((r) => r.symbol === "RY");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ securityId: us.ryTsx, brokerQuantity: "5" });
  });

  it("without a FIGI, TD is two securities until the user links them", async () => {
    const warnings = await db.select().from(s.taxWarnings).where(and(eq(s.taxWarnings.userId, V), eq(s.taxWarnings.securityId, us.tdNyse)));
    expect(warnings.map((w) => w.type)).toEqual(["opening_balance_needed"]);

    await db.insert(s.securityPreferences).values({ userId: V, securityId: us.tdNyse, poolSecurityId: us.tdTsx });
    await recomputeUser(db, V, TODAY);
    // 50 x 70 USD x 1.40 = 4,900 against 4,000 of ACB.
    const [gain] = await gainsOf(us.tdTsx);
    expect(gain).toMatchObject({ gainCad: "900.000000", incomplete: false });
    const left = await db
      .select()
      .from(s.taxWarnings)
      .where(and(eq(s.taxWarnings.userId, V), eq(s.taxWarnings.type, "opening_balance_needed")));
    expect(left).toEqual([]);
  });

  it("a user can keep a FIGI match separate", async () => {
    await db.insert(s.securityPreferences).values({ userId: V, securityId: us.ryNyse, poolSecurityId: us.ryNyse });
    await recomputeUser(db, V, TODAY);
    expect(await canonicalSecurityId(db, V, us.ryNyse)).toBe(us.ryNyse);
    const [gain] = await gainsOf(us.ryNyse);
    expect(gain).toMatchObject({ incomplete: true });
    await db.delete(s.securityPreferences).where(eq(s.securityPreferences.securityId, us.ryNyse));
  });
});
