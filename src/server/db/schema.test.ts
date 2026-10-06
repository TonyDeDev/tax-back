import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeTax } from "@/tax-engine";
import { replaceDerived } from "./derived";
import { fxLookupFrom, toDerivedRows, toLedger, toOpenings } from "./ledger";
import * as s from "./schema";

/*
 * Applies the real generated migration to an in-process Postgres (PGlite), then checks that the
 * constraints reject bad data, that a ledger round-trips through the engine into the derived
 * tables, and that deleting a user removes everything they own.
 */

let client: PGlite;
let db: PgliteDatabase<typeof s>;

const A = "user-a";
const B = "user-b";
const ids = {} as Record<"x" | "y" | "nonReg1" | "nonReg2" | "tfsa" | "shop" | "aapl", string>;

/** Drizzle wraps driver errors; the constraint name is on the cause. */
async function rejectsWith(promise: Promise<unknown>, constraint: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected ${constraint} to reject`).not.toBeNull();
  const cause = (error as { cause?: { message?: string; constraint?: string } }).cause;
  expect(`${cause?.constraint ?? ""} ${cause?.message ?? ""} ${String(error)}`).toContain(constraint);
}

const tx = (over: Partial<typeof s.transactions.$inferInsert> & { snaptradeActivityId: string }) => ({
  userId: A,
  accountId: ids.nonReg1,
  securityId: ids.shop,
  kind: "buy" as const,
  tradeDate: "2024-01-10",
  settlementDate: "2024-01-10",
  currency: "CAD",
  quantity: "1",
  price: "1",
  raw: {},
  ...over,
});

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });

  await db.insert(s.users).values([
    { id: A, name: "Demo", email: "demo@taxback.app" },
    { id: B, name: "Other", email: "other@example.com" },
  ]);
  await db.insert(s.userProfiles).values([{ userId: A, isDemo: true }, { userId: B }]);

  const [x, y] = await db
    .insert(s.connections)
    .values([
      { userId: A, snaptradeAuthorizationId: "demo-x", brokerageSlug: "questrade", brokerageName: "Questrade" },
      { userId: A, snaptradeAuthorizationId: "demo-y", brokerageSlug: "wealthsimple", brokerageName: "Wealthsimple" },
    ])
    .returning();
  ids.x = x!.id;
  ids.y = y!.id;

  const accounts = await db
    .insert(s.brokerageAccounts)
    .values([
      { userId: A, connectionId: ids.x, snaptradeAccountId: "demo-x-1", name: "Margin", baseCurrency: "CAD" },
      { userId: A, connectionId: ids.y, snaptradeAccountId: "demo-y-1", name: "Personal", baseCurrency: "CAD" },
      { userId: A, connectionId: ids.y, snaptradeAccountId: "demo-y-2", name: "TFSA", baseCurrency: "CAD", accountType: "tfsa" },
    ])
    .returning();
  ids.nonReg1 = accounts[0]!.id;
  ids.nonReg2 = accounts[1]!.id;
  ids.tfsa = accounts[2]!.id;

  const [shop, aapl] = await db
    .insert(s.securities)
    .values([
      { symbol: "SHOP", exchange: "TSX", currency: "CAD", snaptradeSymbolId: "sym-shop" },
      { symbol: "AAPL", exchange: "NASDAQ", currency: "USD", snaptradeSymbolId: "sym-aapl", country: "US" },
    ])
    .returning();
  ids.shop = shop!.id;
  ids.aapl = aapl!.id;

  await db.insert(s.fxRates).values([
    { currency: "USD", rateDate: "2025-01-06", cadPerUnit: "1.44" },
    { currency: "USD", rateDate: "2025-02-14", cadPerUnit: "1.42" },
    { currency: "USD", rateDate: "2025-02-28", cadPerUnit: "1.43" },
  ]);

  await db.insert(s.transactions).values([
    // Same stock at two brokerages: pooled to 200 shares, ACB 1005 + 2005 = 3010.
    tx({ snaptradeActivityId: "1", quantity: "100", price: "10", fees: "5" }),
    tx({ snaptradeActivityId: "2", accountId: ids.nonReg2, tradeDate: "2024-02-12", settlementDate: "2024-02-12", quantity: "100", price: "20", fees: "5" }),
    // Sell 50: ACB of sold 752.5, proceeds 1500, fee 5, gain 742.5.
    tx({ snaptradeActivityId: "3", kind: "sell", tradeDate: "2024-06-03", settlementDate: "2024-06-03", quantity: "50", price: "30", fees: "5" }),
    // One 2-for-1 split reported by both brokerages: applied once, 150 -> 300.
    tx({ snaptradeActivityId: "4", kind: "split", tradeDate: "2024-07-02", settlementDate: "2024-07-02", quantity: "0", price: "0", splitRatio: "2" }),
    tx({ snaptradeActivityId: "5", accountId: ids.nonReg2, kind: "split", tradeDate: "2024-07-02", settlementDate: "2024-07-02", quantity: "0", price: "0", splitRatio: "2" }),
    tx({ snaptradeActivityId: "6", kind: "dividend", tradeDate: "2024-09-16", settlementDate: "2024-09-16", quantity: "0", price: "0", amount: "50", dividendClass: "eligible" }),
    // USD loss whose replacement is a TFSA buy: the denied loss is lost forever.
    tx({ snaptradeActivityId: "7", securityId: ids.aapl, currency: "USD", tradeDate: "2025-01-06", settlementDate: "2025-01-06", quantity: "10", price: "100" }),
    tx({ snaptradeActivityId: "8", securityId: ids.aapl, currency: "USD", kind: "dividend", tradeDate: "2025-02-14", settlementDate: "2025-02-14", quantity: "0", price: "0", amount: "2", dividendClass: "foreign", withholdingTax: "0.3" }),
    tx({ snaptradeActivityId: "9", securityId: ids.aapl, currency: "USD", kind: "sell", tradeDate: "2025-03-03", settlementDate: "2025-03-03", quantity: "10", price: "80" }),
    tx({ snaptradeActivityId: "10", accountId: ids.tfsa, securityId: ids.aapl, currency: "USD", tradeDate: "2025-03-10", settlementDate: "2025-03-10", quantity: "10", price: "80" }),
    // Cash-level fee: no security, ignored by the engine.
    tx({ snaptradeActivityId: "11", securityId: null, kind: "fee", quantity: "0", price: "0", fees: "9.99" }),
  ]);
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("constraints", () => {
  it("rejects rows the tax engine would reject", async () => {
    await rejectsWith(db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad1", fees: "-1" })), "transactions_fees_check");
    await rejectsWith(
      db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad2", kind: "split", quantity: "0" })),
      "transactions_split_needs_ratio",
    );
    await rejectsWith(
      db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad3", kind: "dividend", amount: "1" })),
      "transactions_dividend_needs_class",
    );
    await rejectsWith(
      db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad4", tradeDate: "2024-01-10", settlementDate: "2024-01-09" })),
      "transactions_dates_check",
    );
    await rejectsWith(
      db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad5", kind: "sell", quantity: "0" })),
      "transactions_trade_needs_quantity",
    );
    await rejectsWith(
      db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad6", securityId: null })),
      "transactions_needs_security",
    );
    await rejectsWith(db.insert(s.transactions).values(tx({ snaptradeActivityId: "bad7", currency: "usd" })), "transactions_currency_check");
  });

  it("makes repeated syncs idempotent on the SnapTrade activity id", async () => {
    await rejectsWith(db.insert(s.transactions).values(tx({ snaptradeActivityId: "1" })), "transactions_account_activity_key");
  });

  it("keeps a transaction from pointing at another user's account", async () => {
    await rejectsWith(db.insert(s.transactions).values(tx({ snaptradeActivityId: "x1", userId: B })), "transactions_account_fkey");
  });

  it("allows one demo user and one running sync per user", async () => {
    await rejectsWith(db.update(s.userProfiles).set({ isDemo: true }).where(eq(s.userProfiles.userId, B)), "user_profiles_one_demo_key");
    await db.insert(s.syncRuns).values({ userId: A, trigger: "manual" });
    await rejectsWith(db.insert(s.syncRuns).values({ userId: A, trigger: "cron" }), "sync_runs_one_running_key");
    await rejectsWith(
      db.update(s.syncRuns).set({ status: "succeeded" }).where(eq(s.syncRuns.userId, A)),
      "sync_runs_finished_check",
    );
    await db.update(s.syncRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(s.syncRuns.userId, A));
    await db.insert(s.syncRuns).values({ userId: A, trigger: "cron" });
  });

  it("rejects mixed-case emails and invalid marginal rates", async () => {
    await rejectsWith(db.insert(s.users).values({ id: "c", name: "C", email: "Mixed@Example.com" }), "users_email_lowercase_check");
    await rejectsWith(db.update(s.userProfiles).set({ marginalRate: "1" }).where(eq(s.userProfiles.userId, A)), "user_profiles_marginal_rate_check");
  });
});

describe("ledger round trip", () => {
  async function recompute() {
    const [transactions, accounts, securities, adjustments, fx] = await Promise.all([
      db.select().from(s.transactions).where(eq(s.transactions.userId, A)),
      db.select().from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, A)),
      db.select().from(s.securities),
      db.select().from(s.manualAdjustments).where(eq(s.manualAdjustments.userId, A)),
      db.select().from(s.fxRates),
    ]);
    const result = computeTax({
      ledger: toLedger(transactions, accounts, securities),
      openings: toOpenings(adjustments, securities),
      fx: fxLookupFrom(fx),
      asOfDate: "2025-12-31",
    });
    await replaceDerived(db, A, toDerivedRows(A, result, new Map(adjustments.map((a) => [a.securityId, a.id])), "2025-12-31"));
    return result;
  }

  it("stores engine output exactly and reads it back", async () => {
    const result = await recompute();

    const [shop] = await db.select().from(s.acbPositions).where(eq(s.acbPositions.securityId, ids.shop));
    expect(shop).toMatchObject({ quantity: "300.0000000000", totalAcbCad: "2257.500000" });

    const gains = await db.select().from(s.realizedGains).where(eq(s.realizedGains.userId, A)).orderBy(s.realizedGains.dispositionDate);
    expect(gains.map((g) => [g.taxYear, g.gainCad, g.allowedGainCad])).toEqual(
      result.gains.map((g) => [g.year, g.gainCad.toFixed(6), g.allowedGainCad.toFixed(6)]),
    );
    expect(gains[0]!.gainCad).toBe("742.500000");

    const [loss] = await db.select().from(s.superficialLosses).where(eq(s.superficialLosses.userId, A));
    // 10 * 100 USD at 1.44 = 1440; 10 * 80 USD at 1.43 (previous business day) = 1144.
    expect(loss).toMatchObject({ totalLossCad: "296.000000", lostForeverCad: "296.000000", status: "final" });
    const replacements = await db.select().from(s.superficialLossReplacements);
    expect(replacements).toEqual([expect.objectContaining({ accountId: ids.tfsa, disposition: "lost_forever" })]);

    const income = await db.select().from(s.incomeEvents).where(eq(s.incomeEvents.userId, A)).orderBy(s.incomeEvents.paidDate);
    expect(income.map((i) => [i.dividendClass, i.amountCad, i.withholdingCad])).toEqual([
      ["eligible", "50.000000", "0.000000"],
      ["foreign", "2.840000", "0.426000"],
    ]);

    const events = await db.select().from(s.acbEvents).where(eq(s.acbEvents.securityId, ids.shop)).orderBy(s.acbEvents.seq);
    expect(events.map((e) => e.kind)).toEqual(["buy", "buy", "sell", "split"]);

    const years = await db.select().from(s.taxYearSummaries).where(eq(s.taxYearSummaries.userId, A));
    expect(years.map((y) => y.taxYear).sort()).toEqual([2024, 2025]);

    const warnings = await db.select().from(s.taxWarnings).where(eq(s.taxWarnings.userId, A));
    expect(warnings.map((w) => w.type)).toContain("superficial_loss_lost_forever");
  });

  it("replaces rather than appends on a second recompute", async () => {
    const count = async () =>
      (await db.execute<{ n: number }>(sql`SELECT
        (SELECT count(*) FROM realized_gains) + (SELECT count(*) FROM acb_events) +
        (SELECT count(*) FROM superficial_loss_replacements) + (SELECT count(*) FROM tax_warnings) AS n`)).rows[0]!.n;
    const before = await count();
    await recompute();
    expect(await count()).toBe(before);
  });

  it("links an opening balance's ACB event to the manual adjustment", async () => {
    await db.insert(s.manualAdjustments).values({ userId: A, securityId: ids.shop, quantity: "100", acbCad: "1000", asOfDate: "2024-01-01" });
    await recompute();
    const [first] = await db.select().from(s.acbEvents).where(eq(s.acbEvents.securityId, ids.shop)).orderBy(s.acbEvents.seq).limit(1);
    expect(first).toMatchObject({ kind: "opening", transactionId: null });
    expect(first!.manualAdjustmentId).not.toBeNull();
    await db.delete(s.manualAdjustments);
    await recompute();
  });
});

describe("indexes", () => {
  async function plan(query: string) {
    // Tables this small are always seq-scanned; disabling that shows whether an index can serve the query.
    await client.exec("SET enable_seqscan = off");
    const result = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${query}`);
    await client.exec("SET enable_seqscan = on");
    return result.rows.map((r) => r["QUERY PLAN"]).join("\n");
  }

  it("serves the Tax Center year query and the FX previous-day lookup", async () => {
    expect(await plan(`SELECT * FROM realized_gains WHERE user_id = '${A}' AND tax_year = 2024 ORDER BY disposition_date`)).toContain(
      "idx_realized_gains_user_year",
    );
    expect(
      await plan(`SELECT cad_per_unit FROM fx_rates WHERE currency = 'USD' AND rate_date <= '2025-03-03' ORDER BY rate_date DESC LIMIT 1`),
    ).toContain("fx_rates_pkey");
    expect(await plan(`SELECT * FROM transactions WHERE account_id = '${ids.nonReg1}' ORDER BY settlement_date DESC LIMIT 50`)).toContain(
      "idx_transactions_account_date",
    );
  });
});

describe("delete my data", () => {
  it("removes every row the user owns and leaves other users and global data alone", async () => {
    await db.delete(s.users).where(eq(s.users.id, A));
    const owned = [
      "user_profiles", "snaptrade_users", "connections", "brokerage_accounts", "transactions", "holdings",
      "account_balances", "manual_adjustments", "sync_runs", "acb_positions", "acb_events", "realized_gains",
      "superficial_losses", "income_events", "harvest_opportunities", "tax_year_summaries", "tax_warnings",
    ];
    for (const table of owned) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [A]);
      expect(rows[0]!.n, table).toBe(0);
    }
    expect((await db.select().from(s.superficialLossReplacements)).length).toBe(0);
    expect((await db.select().from(s.users)).map((u) => u.id)).toEqual([B]);
    expect((await db.select().from(s.securities)).length).toBe(2);
    expect((await db.select().from(s.fxRates)).length).toBe(3);
  });
});
