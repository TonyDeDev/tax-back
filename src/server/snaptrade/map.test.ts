import { describe, expect, it } from "vitest";
import {
  friendlyAccountName,
  guessAccountType,
  accountKind,
  isSyncedAccount,
  mapAccount,
  mapActivities,
  mapBalances,
  mapPositions,
  torontoDate,
} from "./map";
import type { SnapTradeAccount } from "./schemas";

/*
 * Fixtures follow the shapes of live OAuth responses (checked with `pnpm snaptrade:probe`), with
 * made-up ids and values.
 */

const XEQT = {
  id: "sym-xeqt",
  symbol: "XEQT.TO",
  raw_symbol: "XEQT",
  description: "iShares Core Equity ETF Portfolio",
  currency: { code: "CAD", name: "Canadian Dollar", id: "cur-cad" },
  exchange: { id: "ex-tsx", code: "TSX", mic_code: "XTSE", name: "Toronto Stock Exchange" },
  type: { id: "t-et", code: "et", description: "ETF", is_supported: true },
};
const AAPL = {
  id: "sym-aapl",
  symbol: "AAPL",
  raw_symbol: "AAPL",
  description: "Apple Inc.",
  currency: { code: "USD", name: "US Dollar", id: "cur-usd" },
  exchange: { id: "ex-nas", code: "NASDAQ", mic_code: "XNAS", name: "Nasdaq" },
  type: { id: "t-cs", code: "cs", description: "Common Stock", is_supported: true },
};

let seq = 0;
function activity(over: Record<string, unknown>): Record<string, unknown> {
  seq += 1;
  return {
    id: `act-${seq}`,
    symbol: XEQT,
    option_symbol: null,
    currency: { code: "CAD", name: "Canadian Dollar", id: "cur-cad" },
    type: "BUY",
    description: "",
    amount: 0,
    price: 0,
    units: 0,
    fee: 0,
    fx_rate: null,
    settlement_date: "2026-03-02T15:00:00Z",
    trade_date: "2026-03-02T15:00:00Z",
    institution: "Wealthsimple Trade",
    option_type: "",
    ...over,
  };
}

const account = (over: Partial<SnapTradeAccount>): SnapTradeAccount => ({
  id: "acc-1",
  brokerage_authorization: "auth-1",
  name: "Wealthsimple TFSA",
  number: "HQ1234ABCD",
  institution_name: "Wealthsimple Trade",
  raw_type: "TFSA",
  status: "open",
  account_category: "INVESTMENT",
  meta: { type: "tfsa", currency: "CAD" },
  balance: { total: { currency: "CAD" } },
  ...over,
});

describe("torontoDate", () => {
  it("uses the Toronto calendar day, not the UTC one", () => {
    // 9 pm in Toronto on Dec 31 is Jan 1 in UTC: the trade belongs to the earlier tax year.
    expect(torontoDate("2026-01-01T02:00:00Z")).toBe("2025-12-31");
    expect(torontoDate("2026-07-15T03:59:00Z")).toBe("2026-07-14");
    expect(torontoDate("2026-07-15T04:00:00Z")).toBe("2026-07-15");
    expect(torontoDate("2026-07-15")).toBe("2026-07-15");
  });

  it("rejects an unreadable date", () => {
    expect(() => torontoDate("yesterday")).toThrow(/Unreadable/);
  });
});

describe("accounts", () => {
  it("guesses registered types from what the broker reported", () => {
    expect(guessAccountType(account({}))).toBe("tfsa");
    expect(guessAccountType(account({ raw_type: "RRSP", meta: { type: "rrsp" }, name: null }))).toBe("rrsp");
    expect(guessAccountType(account({ raw_type: "SPOUSAL_RRSP", meta: null, name: null }))).toBe("rrsp");
    expect(guessAccountType(account({ raw_type: "FHSA", meta: null, name: null }))).toBe("fhsa");
    expect(guessAccountType(account({ raw_type: "LIRA", meta: null, name: null }))).toBe("lira");
    expect(guessAccountType(account({ raw_type: "RRIF", meta: null, name: null }))).toBe("rrif");
    expect(guessAccountType(account({ raw_type: "PERSONAL", meta: { type: "non_registered" }, name: "Personal" }))).toBe(
      "non_registered",
    );
    expect(guessAccountType(account({ raw_type: "CRYPTO", meta: { type: "non_registered_crypto" }, name: null }))).toBe(
      "non_registered",
    );
  });

  it("guesses U.S. retirement accounts at U.S. brokers", () => {
    const guess = (raw_type: string, name: string | null = null) => guessAccountType(account({ raw_type, meta: null, name }));
    expect([guess("IRA"), guess("ROTH_IRA"), guess("Rollover IRA"), guess("401K"), guess("401(k)"), guess("403b")]).toEqual(
      Array(6).fill("us_retirement"),
    );
    // Words that merely contain the letters stay non-registered.
    expect([guess("INDIVIDUAL"), guess("MARGIN", "Mirai growth"), guess("JOINT")]).toEqual(Array(3).fill("non_registered"));
  });

  it("syncs investment and cash accounts, never credit cards", () => {
    expect(isSyncedAccount(account({}))).toBe(true);
    expect(isSyncedAccount(account({ account_category: null }))).toBe(true);
    expect(isSyncedAccount(account({ account_category: "DEPOSIT" }))).toBe(true);
    expect(isSyncedAccount(account({ account_category: "LOC" }))).toBe(false);
    expect(accountKind(account({ account_category: "DEPOSIT" }))).toBe("cash");
    expect(accountKind(account({ account_category: "INVESTMENT" }))).toBe("investment");
    expect(accountKind(account({ account_category: null }))).toBe("investment");
  });

  it("names savings and cash accounts from SnapTrade's detailed type", () => {
    const ws = "Wealthsimple Trade";
    expect(friendlyAccountName(`${ws} PERSONAL`, ws, "PERSONAL", "HISA_PORTFOLIO_NON_REGISTERED")).toBe("Savings");
    expect(friendlyAccountName(`${ws} PERSONAL`, ws, "PERSONAL", "MANAGED_PORTFOLIO_NON_REGISTERED")).toBe("Managed");
    expect(friendlyAccountName(`${ws} TFSA`, ws, "TFSA", "MANAGED_PORTFOLIO_TFSA")).toBe("TFSA managed");
    expect(friendlyAccountName(`${ws} MSB`, ws, "MSB", "CASH")).toBe("Cash");
    expect(friendlyAccountName(`${ws} PERSONAL`, ws, "PERSONAL", "SELF_DIRECTED_NON_REGISTERED")).toBe("Personal");
    // A name the user or broker chose is kept.
    expect(friendlyAccountName("Rainy day fund", ws, "PERSONAL", "HISA_PORTFOLIO_NON_REGISTERED")).toBe("Rainy day fund");
  });

  it("keeps only the last 4 characters of the account number", () => {
    const mapped = mapAccount(account({}));
    expect(mapped.numberMasked).toBe("ABCD");
    expect(JSON.stringify(mapped)).not.toContain("HQ1234");
    expect(mapAccount(account({ number: null })).numberMasked).toBeNull();
  });

  it("drops the institution prefix and fixes shouted names", () => {
    expect(friendlyAccountName("Wealthsimple Trade PERSONAL", "Wealthsimple Trade")).toBe("Personal");
    expect(friendlyAccountName("Wealthsimple Trade TFSA", "Wealthsimple Trade")).toBe("TFSA");
    expect(friendlyAccountName("SPOUSAL_RRSP", "Questrade")).toBe("Spousal RRSP");
    expect(friendlyAccountName("My Margin account", "Questrade")).toBe("My Margin account");
    expect(friendlyAccountName(null, "Questrade", "MARGIN")).toBe("Margin");
    expect(friendlyAccountName("Questrade", "Questrade", null)).toBe("Account");
  });

  it("falls back to a readable name and CAD", () => {
    const mapped = mapAccount(account({ name: " ", meta: { currency: "bad" }, balance: null }));
    expect(mapped.name).toBe("TFSA");
    expect(mapped.baseCurrency).toBe("CAD");
  });
});

describe("mapActivities", () => {
  it("maps buys and sells with exact decimals", () => {
    const { transactions, securities } = mapActivities([
      activity({ type: "BUY", units: 0.1, price: 0.2, fee: 0.3, amount: -0.32 }),
      activity({ type: "SELL", units: -0.1, price: 0.7, fee: 0, amount: 0.07, settlement_date: "2026-03-03T15:00:00Z" }),
    ]);
    const [buy, sell] = transactions;
    expect(buy).toMatchObject({ kind: "buy", tradeDate: "2026-03-02", settlementDate: "2026-03-02", currency: "CAD" });
    expect(buy!.quantity.toString()).toBe("0.1");
    expect(buy!.price.toString()).toBe("0.2");
    expect(buy!.fees.toString()).toBe("0.3");
    expect(sell!.kind).toBe("sell");
    expect(sell!.quantity.toString()).toBe("0.1");
    expect(securities).toEqual([
      {
        snaptradeSymbolId: "sym-xeqt",
        symbol: "XEQT",
        exchange: "XTSE",
        name: "iShares Core Equity ETF Portfolio",
        currency: "CAD",
        securityType: "etf",
        country: "CA",
        figiShareClass: null,
      },
    ]);
  });

  it("maps reinvested dividends as DRIP purchases", () => {
    const [drip] = mapActivities([activity({ type: "REI", units: 0.5, price: 40 })]).transactions;
    expect(drip).toMatchObject({ kind: "drip" });
    expect(drip!.quantity.toString()).toBe("0.5");
  });

  it("derives the price from cash paid when a trade settles in another currency", () => {
    // A USD stock bought with CAD: the cash amount is what was actually paid, in CAD.
    const [buy] = mapActivities([activity({ symbol: AAPL, type: "BUY", units: 2, price: 200, fee: 1, amount: -551 })])
      .transactions;
    expect(buy!.currency).toBe("CAD");
    expect(buy!.price.toString()).toBe("275");
  });

  it("classifies dividends by listing and attaches same-day withholding tax", () => {
    const { transactions, skipped } = mapActivities([
      activity({ type: "DIVIDEND", amount: 23.24, price: 0.102 }),
      activity({ type: "DIVIDEND", symbol: AAPL, currency: { code: "USD" }, amount: 10, price: 0.25 }),
      activity({ type: "TAX", symbol: AAPL, currency: { code: "USD" }, amount: -1.5 }),
      activity({ type: "TAX", symbol: AAPL, currency: { code: "USD" }, amount: -0.5, settlement_date: "2026-04-01T15:00:00Z" }),
    ]);
    const [cad, usd] = transactions;
    expect(cad).toMatchObject({ kind: "dividend", dividendClass: "eligible", withholdingTax: null });
    expect(cad!.amount.toString()).toBe("23.24");
    expect(usd).toMatchObject({ kind: "dividend", dividendClass: "foreign", currency: "USD" });
    expect(usd!.withholdingTax!.toString()).toBe("1.5");
    // The second TAX has no dividend that day, so it is not guessed onto one.
    expect(skipped).toEqual({ TAX: 1 });
  });

  it("skips dividend reversals rather than storing a negative dividend", () => {
    const { transactions, skipped } = mapActivities([activity({ type: "DIVIDEND", amount: -5 })]);
    expect(transactions).toEqual([]);
    expect(skipped).toEqual({ DIVIDEND_REVERSAL: 1 });
  });

  it("turns a split's unit change into a ratio using the account's running quantity", () => {
    const { transactions, skipped } = mapActivities([
      activity({ type: "SPLIT", units: 100, settlement_date: "2026-06-10T15:00:00Z" }),
      activity({ type: "BUY", units: 100, price: 10, settlement_date: "2026-01-05T15:00:00Z" }),
      activity({ type: "SELL", units: -50, price: 12, settlement_date: "2026-02-05T15:00:00Z" }),
    ]);
    const split = transactions.find((t) => t.kind === "split");
    // 50 held, 100 added: 150 / 50 = 3-for-1.
    expect(split!.splitRatio!.toString()).toBe("3");
    expect(skipped).toEqual({});
  });

  it("handles a reverse split and skips a split with nothing held", () => {
    const { transactions, skipped } = mapActivities([
      activity({ type: "BUY", units: 100, price: 10, settlement_date: "2026-01-05T15:00:00Z" }),
      activity({ type: "SPLIT", units: -75, settlement_date: "2026-06-10T15:00:00Z" }),
      activity({ type: "SPLIT", symbol: AAPL, units: 10, settlement_date: "2026-06-10T15:00:00Z" }),
    ]);
    expect(transactions.find((t) => t.kind === "split")!.splitRatio!.toString()).toBe("0.25");
    expect(skipped).toEqual({ SPLIT: 1 });
  });

  it("maps stock dividends with their value, and counts their units for a later split", () => {
    const { transactions } = mapActivities([
      activity({ type: "BUY", units: 100, price: 10, settlement_date: "2026-01-05T15:00:00Z" }),
      activity({ type: "STOCK_DIVIDEND", units: 5, amount: 52.5, settlement_date: "2026-03-05T15:00:00Z" }),
      activity({ type: "SPLIT", units: 105, settlement_date: "2026-06-10T15:00:00Z" }),
    ]);
    const dividend = transactions.find((t) => t.kind === "stock_dividend")!;
    expect([dividend.quantity.toString(), dividend.amount.toString(), dividend.dividendClass]).toEqual(["5", "52.5", "eligible"]);
    // 105 held after the stock dividend, 105 added: a 2-for-1.
    expect(transactions.find((t) => t.kind === "split")!.splitRatio!.toString()).toBe("2");
  });

  it("maps fees and transfers", () => {
    const { transactions } = mapActivities([
      activity({ type: "FEE", symbol: null, amount: -9.99 }),
      activity({ type: "EXTERNAL_ASSET_TRANSFER_IN", units: 10, price: 30 }),
      activity({ type: "TRANSFER", units: -4, price: 30 }),
    ]);
    expect(transactions.map((t) => [t.kind, t.snaptradeSymbolId, t.quantity.toString()])).toEqual([
      ["fee", null, "0"],
      ["transfer_in", "sym-xeqt", "10"],
      ["transfer_out", "sym-xeqt", "4"],
    ]);
    expect(transactions[0]!.fees.toString()).toBe("9.99");
  });

  /*
   * Shares moved between the user's own accounts at one broker. Skipping these used to lose the deemed
   * disposition when the destination was a TFSA or an RRSP, so the direction comes from the type name.
   */
  it("maps internal asset transfers, which move shares between the user's own accounts", () => {
    const { transactions, skipped } = mapActivities([
      activity({ type: "INTERNAL_ASSET_TRANSFER_OUT", units: -1, price: 170, amount: -170 }),
      activity({ type: "INTERNAL_ASSET_TRANSFER_IN", units: 1, price: 170, amount: 170 }),
    ]);
    expect(transactions.map((t) => [t.kind, t.quantity.toString(), t.price.toString()])).toEqual([
      ["transfer_out", "1", "170"],
      ["transfer_in", "1", "170"],
    ]);
    expect(skipped).toEqual({});
  });

  it("maps a return of capital, which lowers ACB instead of being income", () => {
    const { transactions } = mapActivities([
      activity({ type: "RETURN_OF_CAPITAL", amount: 8, units: 0, price: 0, settlement_date: null, trade_date: "2026-09-22T12:00:00Z" }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ kind: "roc", settlementDate: "2026-09-22" });
    expect(transactions[0]!.amount.toString()).toBe("8");
    expect(transactions[0]!.quantity.toString()).toBe("0");
  });

  it("skips a reversed return of capital rather than feeding the engine a negative one", () => {
    // The engine refuses a negative return of capital, so it must never reach the ledger.
    const { transactions, skipped } = mapActivities([activity({ type: "RETURN_OF_CAPITAL", amount: -8 })]);
    expect(transactions).toEqual([]);
    expect(skipped).toEqual({ RETURN_OF_CAPITAL_REVERSAL: 1 });
  });

  it("counts cash movements, interest, and options as skipped", () => {
    const { transactions, skipped } = mapActivities([
      activity({ type: "CONTRIBUTION", symbol: null, amount: 1000 }),
      activity({ type: "INTEREST", symbol: null, amount: 0.01 }),
      activity({ type: "INTERNAL_CASH_TRANSFER_IN", symbol: null, amount: 5 }),
      activity({ type: "BUY", option_symbol: { id: "opt" }, units: 1, price: 2 }),
    ]);
    expect(transactions).toEqual([]);
    expect(skipped).toEqual({ CONTRIBUTION: 1, INTEREST: 1, INTERNAL_CASH_TRANSFER_IN: 1, OPTION_BUY: 1 });
  });

  it("reports the earliest activity date, skipped ones included", () => {
    const { earliestDate } = mapActivities([
      activity({ type: "BUY", units: 1, price: 1, settlement_date: "2026-03-02T15:00:00Z" }),
      activity({ type: "CONTRIBUTION", symbol: null, settlement_date: "2025-10-05T22:45:50Z" }),
    ]);
    expect(earliestDate).toBe("2025-10-05");
    expect(mapActivities([]).earliestDate).toBeNull();
  });

  it("fails loudly when a stored activity type has an unexpected shape, naming the field", () => {
    expect(() => mapActivities([activity({ type: "BUY", units: "lots" })])).toThrow(/unexpected shape/);
    // The message has to say which field, or the next shape surprise costs a probe to diagnose.
    expect(() => mapActivities([activity({ type: "BUY", units: "lots" })])).toThrow(/units: .*expected number/);
  });

  /*
   * SnapTrade sets `settlement_date` only on trades. Everything else - dividends, fees, splits,
   * transfers - comes back with it null, which used to fail the whole sync on the first one.
   */
  it("falls back to the trade date when SnapTrade sends no settlement date", () => {
    const [dividend] = mapActivities([
      activity({ type: "DIVIDEND", amount: 12.5, settlement_date: null, trade_date: "2026-04-09T13:30:00Z" }),
    ]).transactions;
    expect(dividend).toMatchObject({ kind: "dividend", settlementDate: "2026-04-09", tradeDate: "2026-04-09" });
  });

  it("skips a cash transfer with no security instead of failing the sync", () => {
    // The exact shape SnapTrade returns for a sandbox cash transfer: no symbol, no units, no settlement.
    const { transactions, skipped } = mapActivities([
      {
        id: "cbb3d62b-e2cc-4722-a333-0e5034927e41",
        symbol: null,
        option_symbol: null,
        currency: { code: "USD", name: "US Dollar", id: "cur-usd" },
        type: "TRANSFER",
        description: "Cash transfer",
        amount: 1000,
        price: 0,
        units: 0,
        fee: 0,
        settlement_date: null,
        trade_date: "2026-09-30T23:54:32.607825Z",
      },
    ]);
    expect(transactions).toEqual([]);
    expect(skipped).toEqual({ TRANSFER: 1 });
  });

  it("rejects an activity that carries no date at all", () => {
    expect(() => mapActivities([activity({ type: "BUY", units: 1, price: 1, settlement_date: null, trade_date: null })])).toThrow(
      /neither a settlement date nor a trade date/,
    );
  });

  it("dates a skipped activity by its trade date when it has no settlement date", () => {
    const { earliestDate } = mapActivities([
      activity({ type: "BUY", units: 1, price: 1, settlement_date: "2026-03-02T15:00:00Z" }),
      activity({ type: "INTEREST", symbol: null, settlement_date: null, trade_date: "2025-08-11T22:45:50Z" }),
    ]);
    expect(earliestDate).toBe("2025-08-11");
  });

  it("keeps the raw activity and never lets the trade date pass settlement", () => {
    const raw = activity({ type: "BUY", units: 1, price: 1, trade_date: "2026-03-05T15:00:00Z" });
    const [buy] = mapActivities([raw]).transactions;
    expect(buy!.raw).toBe(raw);
    expect(buy!.tradeDate).toBe("2026-03-02");
  });
});

describe("share-class FIGI", () => {
  it("is read from activity symbols and from positions, and is null when absent", () => {
    const withFigi = { ...AAPL, figi_instrument: { figi_code: "BBG000B9XRY4", figi_share_class: "BBG001S5N8V8" } };
    const { securities } = mapActivities([activity({ type: "BUY", symbol: withFigi, units: 1, price: 1 }), activity({ type: "BUY", units: 1, price: 1 })]);
    expect(securities.map((x) => [x.symbol, x.figiShareClass])).toEqual([
      ["AAPL", "BBG001S5N8V8"],
      ["XEQT", null],
    ]);
    const positions = mapPositions([
      {
        instrument: { kind: "stock", id: "sym-ry", symbol: "RY", currency: "USD", exchange: "XNYS", figi_instrument: { figi_share_class: "BBG001S5S1X6" } },
        units: "10",
        currency: "USD",
      },
    ]);
    expect(positions.securities[0]!.figiShareClass).toBe("BBG001S5S1X6");
  });
});

describe("mapPositions and mapBalances", () => {
  it("maps share positions with string numbers and skips options", () => {
    const { holdings, securities, skipped } = mapPositions([
      {
        instrument: { kind: "etf", id: "sym-xeqt", symbol: "XEQT.TO", raw_symbol: "XEQT", currency: "CAD", exchange: "XTSE" },
        units: "230.5291",
        price: "46.2",
        cost_basis: "40.73255827572310827570141904",
        currency: "CAD",
      },
      { instrument: { kind: "option", id: "opt-1" }, units: "1", price: "2", currency: "USD" },
    ]);
    expect(securities[0]).toMatchObject({ symbol: "XEQT", exchange: "XTSE", securityType: "etf", country: "CA" });
    expect(holdings[0]!.marketValue!.toString()).toBe("10650.44442");
    expect(holdings[0]!.brokerBookValue!.toFixed(2)).toBe("9390.04");
    expect(skipped).toEqual({ "position:option": 1 });
  });

  it("sums cash per currency and ignores unknown balances", () => {
    const balances = mapBalances([
      { currency: { code: "CAD" }, cash: 2089.99 },
      { currency: { code: "CAD" }, cash: 0.01 },
      { currency: { code: "USD" }, cash: null },
      { currency: null, cash: 5 },
    ]);
    expect(balances.map((b) => [b.currency, b.cash.toString()])).toEqual([["CAD", "2090"]]);
  });
});
