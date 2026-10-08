import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "@/server/auth/config";
import * as s from "@/server/db/schema";
import { getHubSummary, getValueHistory } from "@/server/queries/hub";
import { STALE_RUN_MS, SYNC_COOLDOWN_MS, syncUser } from "./sync";

/*
 * The whole sync against the real migrations on PGlite, with SnapTrade and the Bank of Canada stubbed
 * at `fetch`. The scenario: XEQT bought and sold at a loss in a non-registered account, then rebought
 * in a TFSA within 30 days (a superficial loss lost for good), plus a USD stock that needs FX.
 */

let client: PGlite;
let db: PgliteDatabase<typeof s>;

const A = "user-a";
const B = "user-b";
const NOW = new Date("2026-10-06T16:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

const XEQT = {
  id: "sym-xeqt",
  symbol: "XEQT.TO",
  raw_symbol: "XEQT",
  description: "iShares Core Equity ETF Portfolio",
  currency: { code: "CAD" },
  exchange: { code: "TSX", mic_code: "XTSE" },
  type: { code: "et" },
};
const AAPL = {
  id: "sym-aapl",
  symbol: "AAPL",
  raw_symbol: "AAPL",
  description: "Apple Inc.",
  currency: { code: "USD" },
  exchange: { code: "NASDAQ", mic_code: "XNAS" },
  type: { code: "cs" },
};

const act = (id: string, over: Record<string, unknown>) => ({
  id,
  symbol: XEQT,
  option_symbol: null,
  currency: { code: "CAD" },
  type: "BUY",
  amount: 0,
  price: 0,
  units: 0,
  fee: 0,
  settlement_date: "2026-01-05T15:00:00Z",
  trade_date: "2026-01-05T15:00:00Z",
  description: "",
  ...over,
});

const snaptrade = {
  authorizations: [
    { id: "auth-ws", disabled: false, brokerage: { name: "Wealthsimple", display_name: "Wealthsimple", slug: "WEALTHSIMPLETRADE" } },
    // A new Interactive Brokers Flex connection: SnapTrade lists it before it lists any of its accounts.
    { id: "auth-ibkr", disabled: false, brokerage: { name: "Interactive Brokers", display_name: "Interactive Brokers", slug: "INTERACTIVE-BROKERS-FLEX" } },
  ],
  accounts: [
    {
      id: "acc-nr",
      brokerage_authorization: "auth-ws",
      name: "Wealthsimple Trade PERSONAL",
      number: "HQ0001NRAB",
      institution_name: "Wealthsimple Trade",
      raw_type: "PERSONAL",
      account_category: "INVESTMENT",
      meta: { type: "non_registered", currency: "CAD" },
    },
    {
      id: "acc-tfsa",
      brokerage_authorization: "auth-ws",
      name: "TFSA",
      number: "HQ0002TFSA",
      institution_name: "Wealthsimple Trade",
      raw_type: "TFSA",
      account_category: "INVESTMENT",
      meta: { type: "tfsa", currency: "CAD" },
    },
    {
      // A Wealthsimple managed portfolio: SnapTrade lists no positions, only the broker's total.
      id: "acc-managed",
      brokerage_authorization: "auth-ws",
      name: "Wealthsimple Trade TFSA",
      number: "HQ0005MGD1",
      institution_name: "Wealthsimple Trade",
      raw_type: "TFSA",
      status: "open",
      account_category: "INVESTMENT",
      meta: { type: "tfsa", currency: "CAD", unifiedAccountType: "MANAGED_PORTFOLIO_TFSA" },
      balance: { total: { amount: 2979.12862883, currency: "CAD" } },
    },
    {
      // Closed and empty: skipped.
      id: "acc-old",
      brokerage_authorization: "auth-ws",
      name: "Wealthsimple Trade PERSONAL",
      number: "HQ0003OLD1",
      institution_name: "Wealthsimple Trade",
      raw_type: "PERSONAL",
      status: "closed",
      account_category: "INVESTMENT",
      meta: { type: "non_registered", currency: "CAD" },
    },
    {
      // Wealthsimple Cash: a cash account, synced for its balance.
      id: "acc-cash",
      brokerage_authorization: "auth-ws",
      name: "Wealthsimple Trade MSB",
      number: "HQ0004CASH",
      institution_name: "Wealthsimple Trade",
      raw_type: "MSB",
      status: "open",
      account_category: "DEPOSIT",
      meta: { type: "ca_cash_msb", currency: "CAD", unifiedAccountType: "CASH" },
    },
    {
      id: "acc-card",
      brokerage_authorization: "auth-ws",
      name: "Card",
      number: "9999",
      institution_name: "Wealthsimple Trade",
      raw_type: "CARD",
      account_category: "LOC",
      meta: { type: "ca_credit_card" },
    },
  ],
  activities: {
    "acc-nr": [
      act("nr-buy", { type: "BUY", units: 10, price: 40, amount: -400 }),
      act("nr-sell", { type: "SELL", units: -5, price: 30, amount: 150, settlement_date: "2026-03-02T15:00:00Z", trade_date: "2026-03-02T15:00:00Z" }),
      act("nr-aapl", { symbol: AAPL, currency: { code: "USD" }, type: "BUY", units: 2, price: 200, amount: -400, settlement_date: "2026-02-02T15:00:00Z", trade_date: "2026-02-02T15:00:00Z" }),
      act("nr-div", { type: "DIVIDEND", amount: 12.5, price: 0.1, settlement_date: "2026-06-29T15:00:00Z", trade_date: "2026-06-29T15:00:00Z" }),
      act("nr-dep", { symbol: null, type: "CONTRIBUTION", amount: 1000 }),
    ],
    "acc-tfsa": [
      act("tfsa-buy", { type: "BUY", units: 5, price: 31, amount: -155, settlement_date: "2026-03-10T15:00:00Z", trade_date: "2026-03-10T15:00:00Z" }),
      act("tfsa-dep", { symbol: null, type: "CONTRIBUTION", amount: 500, settlement_date: null, trade_date: "2026-03-09T15:00:00Z" }),
    ],
  } as Record<string, unknown[]>,
  positions: {
    "acc-nr": [
      { instrument: { kind: "etf", id: "sym-xeqt", symbol: "XEQT.TO", raw_symbol: "XEQT", currency: "CAD", exchange: "XTSE" }, units: "5", price: "46", cost_basis: "40", currency: "CAD" },
      { instrument: { kind: "stock", id: "sym-aapl", symbol: "AAPL", raw_symbol: "AAPL", currency: "USD", exchange: "XNAS" }, units: "2", price: "250", cost_basis: "200", currency: "USD" },
    ],
    "acc-tfsa": [
      { instrument: { kind: "etf", id: "sym-xeqt", symbol: "XEQT.TO", raw_symbol: "XEQT", currency: "CAD", exchange: "XTSE" }, units: "5", price: "46", cost_basis: "31", currency: "CAD" },
    ],
  } as Record<string, unknown[]>,
  balances: {
    "acc-nr": [{ currency: { code: "CAD" }, cash: 100.5 }],
    "acc-tfsa": [],
    "acc-cash": [{ currency: { code: "CAD" }, cash: 3501.09 }],
    "acc-managed": [{ currency: { code: "CAD" }, cash: 8.2 }],
  } as Record<string, unknown[]>,
};

/** Weekday USD/CAD observations at 1.35 for any requested range. */
function boc(url: URL) {
  const start = url.searchParams.get("start_date")!;
  const end = url.searchParams.get("end_date")!;
  const observations = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) observations.push({ d: d.toISOString().slice(0, 10), FXUSDCAD: { v: "1.3500" } });
  }
  return observations;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let snaptradeDown = false;
let bocCalls = 0;

const fetchStub = vi.fn(async (input: URL | string) => {
  const url = new URL(String(input));
  if (url.hostname === "www.bankofcanada.ca") {
    bocCalls += 1;
    if (!url.pathname.includes("FXUSDCAD")) return json({ message: "Series not found" }, 404);
    return json({ observations: boc(url) });
  }
  if (snaptradeDown) return json({ detail: "down" }, 503);
  const p = url.pathname.replace("/api/v1", "");
  if (p === "/authorizations") return json(snaptrade.authorizations);
  if (p === "/accounts") return json(snaptrade.accounts);
  const m = /^\/accounts\/([^/]+)\/(positions\/all|balances|activities)$/.exec(p);
  if (!m) return json({ detail: "not found" }, 404);
  const [, id, what] = m;
  if (what === "positions/all") return json({ results: snaptrade.positions[id!] ?? [] });
  if (what === "balances") return json(snaptrade.balances[id!] ?? []);
  const data = snaptrade.activities[id!] ?? [];
  return json({ data, pagination: { offset: 0, limit: 1000, total: data.length } });
});

function fakeAuth(over: Partial<{ getAccessToken: () => Promise<unknown>; refreshToken: () => Promise<unknown> }> = {}) {
  const api = {
    getAccessToken: vi.fn(over.getAccessToken ?? (async () => ({ accessToken: "access-1" }))),
    refreshToken: vi.fn(over.refreshToken ?? (async () => ({ accessToken: "access-2" }))),
  };
  return { auth: { api } as unknown as Auth, api };
}

type UserTable =
  | typeof s.transactions
  | typeof s.holdings
  | typeof s.brokerageAccounts
  | typeof s.connections
  | typeof s.accountValueSnapshots
  | typeof s.securityPriceSnapshots;

async function rows(table: UserTable, userId: string) {
  const [r] = await db.select({ n: count() }).from(table).where(eq(table.userId, userId));
  return r!.n;
}

async function addUser(id: string) {
  await db.insert(s.users).values({ id, name: id, email: `${id}@example.com` });
  await db.insert(s.userProfiles).values({ userId: id });
  await db.insert(s.accounts).values({ id: `grant-${id}`, userId: id, accountId: `sub-${id}`, providerId: "snaptrade" });
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await addUser(A);
  await addUser(B);
  // A demo-only security with the same natural key as a real one, and no SnapTrade id.
  await db.insert(s.securities).values({ symbol: "AAPL", exchange: "XNAS", currency: "USD", name: "Apple (demo)" });
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchStub);
  vi.spyOn(console, "error").mockImplementation(() => {});
  snaptradeDown = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncUser", () => {
  it("stores every investment account, its holdings, cash, and activity, then recomputes tax", async () => {
    const { auth } = fakeAuth();
    const outcome = await syncUser(db, auth, A, "connect", NOW);
    expect(outcome.status).toBe("succeeded");

    const accounts = await db.select().from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, A));
    expect(accounts.map((a) => [a.snaptradeAccountId, a.name, a.kind, a.accountType, a.numberMasked, a.accountTypeConfirmedAt])).toEqual(
      expect.arrayContaining([
        ["acc-nr", "Personal", "investment", "non_registered", "NRAB", null],
        ["acc-tfsa", "TFSA", "investment", "tfsa", "TFSA", null],
        ["acc-cash", "Cash", "cash", "non_registered", "CASH", null],
        ["acc-managed", "TFSA managed", "investment", "tfsa", "MGD1", null],
      ]),
    );
    // The credit card and the empty closed account are not stored.
    expect(accounts).toHaveLength(4);
    // Only the managed account is valued at the broker's total; the others list their positions.
    expect(accounts.filter((a) => a.holdingsUnreported).map((a) => [a.snaptradeAccountId, a.reportedTotal, a.reportedTotalCurrency])).toEqual([
      ["acc-managed", "2979.128629", "CAD"],
    ]);
    expect(accounts.find((a) => a.snaptradeAccountId === "acc-nr")!.historyCompleteFrom).toBe("2026-01-05");

    expect(await rows(s.connections, A)).toBe(2);
    expect(await rows(s.transactions, A)).toBe(5);
    expect(await rows(s.holdings, A)).toBe(3);

    const cash = await db.select().from(s.accountBalances).where(eq(s.accountBalances.userId, A));
    expect(cash.map((c) => c.cash).sort()).toEqual(["100.500000", "3501.090000", "8.200000"]);

    // The non-registered sale at a loss, with the TFSA rebuy inside 30 days: denied and lost for good.
    const [gain] = await db.select().from(s.realizedGains).where(eq(s.realizedGains.userId, A));
    expect(gain).toMatchObject({ gainCad: "-50.000000", deniedLossCad: "50.000000", allowedGainCad: "0.000000", taxYear: 2026 });
    const [loss] = await db.select().from(s.superficialLosses).where(eq(s.superficialLosses.userId, A));
    expect(loss).toMatchObject({ status: "final", lostForeverCad: "50.000000" });

    // The USD purchase is converted at the Bank of Canada rate: 2 x 200 x 1.35.
    const [aapl] = await db
      .select({ totalAcbCad: s.acbPositions.totalAcbCad })
      .from(s.acbPositions)
      .innerJoin(s.securities, eq(s.securities.id, s.acbPositions.securityId))
      .where(and(eq(s.acbPositions.userId, A), eq(s.securities.symbol, "AAPL")));
    expect(aapl!.totalAcbCad).toBe("540.000000");

    const [income] = await db.select().from(s.incomeEvents).where(eq(s.incomeEvents.userId, A));
    expect(income).toMatchObject({ dividendClass: "eligible", amountCad: "12.500000" });

    const [run] = await db.select().from(s.syncRuns).where(eq(s.syncRuns.userId, A));
    expect(run).toMatchObject({ status: "succeeded", trigger: "connect" });
    expect(run!.stats).toMatchObject({ accounts: 4, transactions: 5, holdings: 3, cashFlows: 2, skipped: { "position:unreported": 1 } });

    // Cash deposits are kept: the TFSA one is a contribution, the non-registered one counts for nothing.
    const flows = await db
      .select({ id: s.contributionFlows.snaptradeActivityId, kind: s.contributionFlowResults.kind, plan: s.contributionFlowResults.plan })
      .from(s.contributionFlows)
      .innerJoin(s.contributionFlowResults, eq(s.contributionFlowResults.flowId, s.contributionFlows.id))
      .where(eq(s.contributionFlows.userId, A));
    expect(flows.sort((a, b) => a.id!.localeCompare(b.id!))).toEqual([
      { id: "nr-dep", kind: "ignored", plan: null },
      { id: "tfsa-dep", kind: "contribution", plan: "tfsa" },
    ]);
    const [tfsaYear] = await db.select().from(s.contributionSummaries).where(eq(s.contributionSummaries.userId, A));
    expect(tfsaYear).toMatchObject({ plan: "tfsa", taxYear: 2026, contributionsCad: "500.000000", roomSource: "unknown" });
    const [profile] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, A));
    expect(profile!.lastSyncedAt).not.toBeNull();
    expect(profile!.lastRecomputedAt).not.toBeNull();

    // Today's value snapshot is exactly the Hub total, so the chart ends on the number above it.
    expect(await rows(s.accountValueSnapshots, A)).toBe(4);
    const history = await getValueHistory(db, A);
    const summary = await getHubSummary(db, A, "2026-10-06");
    // The managed account is worth the broker's total, which already includes its cash.
    const managed = summary.brokerages.flatMap((b) => b.accounts).find((a) => a.name === "TFSA managed");
    expect(managed).toMatchObject({ holdingsUnreported: true, valueCad: "2979.128629" });
    // The connection with no accounts yet is listed as waiting, outside the brokerages and their totals.
    expect(summary.brokerages.map((b) => b.name)).toEqual(["Wealthsimple"]);
    expect(summary.pendingBrokerages).toEqual([
      expect.objectContaining({ name: "Interactive Brokers", status: "active", statusDetail: expect.stringContaining("not listed any accounts") }),
    ]);
    expect(history).toEqual([{ day: "2026-10-06", valueCad: summary.totalValueCad }]);
    expect(await rows(s.securityPriceSnapshots, A)).toBeGreaterThan(0);
  });

  it("adopts a demo-only security with the same natural key instead of failing", async () => {
    const all = await db.select().from(s.securities).where(eq(s.securities.symbol, "AAPL"));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ snaptradeSymbolId: "sym-aapl", exchange: "XNAS" });
  });

  it("changes nothing when run again with the same data, and fetches no FX it already has", async () => {
    const before = await db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.userId, A));
    bocCalls = 0;
    const outcome = await syncUser(db, fakeAuth().auth, A, "cron", later(SYNC_COOLDOWN_MS + 1000));
    expect(outcome.status).toBe("succeeded");

    const after = await db.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.userId, A));
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(await rows(s.holdings, A)).toBe(3);
    expect(await rows(s.brokerageAccounts, A)).toBe(4);
    // A second sync on the same day replaces that day's snapshot rather than adding one.
    expect(await rows(s.accountValueSnapshots, A)).toBe(4);
    expect(bocCalls).toBe(0);
  });

  it("allows Refresh once per 15 minutes, but not after a failure", async () => {
    const at = later(SYNC_COOLDOWN_MS * 2 + 2000);
    const minutes = (n: number) => new Date(at.getTime() + n * 60_000);
    const first = await syncUser(db, fakeAuth().auth, A, "manual", at);
    expect(first.status).toBe("succeeded");
    const second = await syncUser(db, fakeAuth().auth, A, "manual", minutes(1));
    expect(second).toEqual({ status: "cooldown", retryAt: new Date(at.getTime() + SYNC_COOLDOWN_MS) });

    // A failed run does not start a new cooldown: the user can retry as soon as the last good one allows.
    await db.insert(s.syncRuns).values({ userId: A, trigger: "manual", status: "failed", startedAt: minutes(16), finishedAt: minutes(16) });
    const third = await syncUser(db, fakeAuth().auth, A, "manual", minutes(17));
    expect(third.status).toBe("succeeded");
  });

  it("keeps the user's confirmed account type over the broker's guess", async () => {
    await db
      .update(s.brokerageAccounts)
      .set({ accountType: "rrsp", accountTypeConfirmedAt: NOW })
      .where(and(eq(s.brokerageAccounts.userId, A), eq(s.brokerageAccounts.snaptradeAccountId, "acc-tfsa")));
    await syncUser(db, fakeAuth().auth, A, "cron", later(SYNC_COOLDOWN_MS * 3));
    const [tfsa] = await db
      .select()
      .from(s.brokerageAccounts)
      .where(and(eq(s.brokerageAccounts.userId, A), eq(s.brokerageAccounts.snaptradeAccountId, "acc-tfsa")));
    expect(tfsa!.accountType).toBe("rrsp");
  });

  it("keeps two users who share one SnapTrade connection apart", async () => {
    const outcome = await syncUser(db, fakeAuth().auth, B, "connect", NOW);
    expect(outcome.status).toBe("succeeded");
    expect(await rows(s.transactions, B)).toBe(5);
    expect(await rows(s.transactions, A)).toBe(5);

    const aIds = await db.select({ id: s.brokerageAccounts.id }).from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, A));
    const bIds = await db.select({ id: s.brokerageAccounts.id }).from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, B));
    expect(aIds.some((a) => bIds.some((b) => b.id === a.id))).toBe(false);
    // B's account type is B's own guess; A's confirmation does not leak across.
    const [bTfsa] = await db
      .select()
      .from(s.brokerageAccounts)
      .where(and(eq(s.brokerageAccounts.userId, B), eq(s.brokerageAccounts.snaptradeAccountId, "acc-tfsa")));
    expect(bTfsa!.accountType).toBe("tfsa");
  });

  it("refuses a second sync while one is running, and recovers a stale lock", async () => {
    const at = later(SYNC_COOLDOWN_MS * 5);
    await db.insert(s.syncRuns).values({ userId: A, trigger: "cron", status: "running", startedAt: at });
    expect(await syncUser(db, fakeAuth().auth, A, "cron", new Date(at.getTime() + 1000))).toEqual({ status: "in_progress" });

    const outcome = await syncUser(db, fakeAuth().auth, A, "cron", new Date(at.getTime() + STALE_RUN_MS + 1000));
    expect(outcome.status).toBe("succeeded");
    const runs = await db.select().from(s.syncRuns).where(and(eq(s.syncRuns.userId, A), eq(s.syncRuns.startedAt, at)));
    expect(runs[0]).toMatchObject({ status: "failed", error: "The sync did not finish in time." });
  });

  it("refreshes the token once on a 401 and retries", async () => {
    let calls = 0;
    fetchStub.mockImplementationOnce(async () => {
      calls += 1;
      return json({ detail: "expired" }, 401);
    });
    const { auth, api } = fakeAuth();
    const outcome = await syncUser(db, auth, A, "cron", later(SYNC_COOLDOWN_MS * 7));
    expect(calls).toBe(1);
    expect(api.refreshToken).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("succeeded");
  });

  it("asks the user to reconnect when the token cannot be refreshed", async () => {
    const { auth } = fakeAuth({
      getAccessToken: async () => {
        throw new Error("FAILED_TO_GET_ACCESS_TOKEN");
      },
    });
    const outcome = await syncUser(db, auth, A, "cron", later(SYNC_COOLDOWN_MS * 9));
    expect(outcome).toMatchObject({ status: "failed", code: "reauth_required" });
    if (outcome.status !== "failed") return;
    const [run] = await db.select().from(s.syncRuns).where(eq(s.syncRuns.id, outcome.runId));
    expect(run).toMatchObject({ status: "failed", stats: { errorCode: "reauth_required" } });
  });

  it("keeps the last good data when SnapTrade is down, and does not leak details", async () => {
    snaptradeDown = true;
    const outcome = await syncUser(db, fakeAuth().auth, A, "manual", later(SYNC_COOLDOWN_MS * 11));
    expect(outcome).toMatchObject({
      status: "failed",
      code: "snaptrade_unavailable",
      message: "SnapTrade could not be read right now. Try again later.",
    });
    expect(await rows(s.transactions, A)).toBe(5);
    const [gain] = await db.select().from(s.realizedGains).where(eq(s.realizedGains.userId, A));
    expect(gain).toBeDefined();
  });

  it("removes a connection SnapTrade stopped listing once it has no accounts", async () => {
    const saved = snaptrade.authorizations;
    snaptrade.authorizations = saved.filter((a) => a.id !== "auth-ibkr");
    try {
      await syncUser(db, fakeAuth().auth, A, "cron", later(SYNC_COOLDOWN_MS * 11 + 1000));
    } finally {
      snaptrade.authorizations = saved;
    }
    const connections = await db.select().from(s.connections).where(eq(s.connections.userId, A));
    expect(connections.map((c) => c.snaptradeAuthorizationId)).toEqual(["auth-ws"]);
  });

  it("removes an account SnapTrade stopped listing only when it has no history", async () => {
    const [connection] = await db.select().from(s.connections).where(eq(s.connections.userId, A));
    await db.insert(s.brokerageAccounts).values({
      userId: A,
      connectionId: connection!.id,
      snaptradeAccountId: "acc-gone",
      name: "Gone",
      baseCurrency: "CAD",
    });
    await syncUser(db, fakeAuth().auth, A, "cron", later(SYNC_COOLDOWN_MS * 12));
    const ids = (await db.select().from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, A))).map((a) => a.snaptradeAccountId);
    expect(ids.sort()).toEqual(["acc-cash", "acc-managed", "acc-nr", "acc-tfsa"]);
  });

  it("flags a brokerage that is no longer shared, but keeps its history", async () => {
    const original = { accounts: snaptrade.accounts, authorizations: snaptrade.authorizations };
    snaptrade.accounts = [];
    snaptrade.authorizations = [];
    try {
      const outcome = await syncUser(db, fakeAuth().auth, A, "cron", later(SYNC_COOLDOWN_MS * 13));
      expect(outcome.status).toBe("succeeded");
    } finally {
      Object.assign(snaptrade, original);
    }
    const [connection] = await db.select().from(s.connections).where(eq(s.connections.userId, A));
    expect(connection).toMatchObject({ status: "broken", statusDetail: "No longer shared through SnapTrade." });
    expect(await rows(s.transactions, A)).toBe(5);
  });
});
