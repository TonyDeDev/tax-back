import { describe, expect, it } from "vitest";
import { D } from "@/tax-engine";
import { fxLookupFrom, toDerivedRows, toLedger } from "./ledger";
import type * as s from "./schema";

type TransactionRow = typeof s.transactions.$inferSelect;

const row = (over: Partial<TransactionRow>): TransactionRow => ({
  id: "t1",
  userId: "u1",
  accountId: "a1",
  securityId: "sec1",
  snaptradeActivityId: "act1",
  kind: "buy",
  tradeDate: "2025-01-02",
  settlementDate: "2025-01-03",
  currency: "CAD",
  quantity: "10.0000000000",
  price: "12.345678",
  fees: "4.950000",
  amount: "0.000000",
  splitRatio: null,
  dividendClass: null,
  withholdingTax: null,
  description: null,
  raw: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("fxLookupFrom", () => {
  const fx = fxLookupFrom([
    { currency: "USD", rateDate: "2025-01-03", cadPerUnit: "1.4400000000" },
    { currency: "USD", rateDate: "2025-01-02", cadPerUnit: "1.4300000000" },
    { currency: "USD", rateDate: "2025-01-06", cadPerUnit: "1.4500000000" },
  ]);

  it("returns 1 for CAD without any stored rate", () => {
    expect(fx("CAD", "1999-01-01").toString()).toBe("1");
  });

  it("uses the rate for the exact date", () => {
    expect(fx("USD", "2025-01-03").toString()).toBe("1.44");
  });

  it("falls back to the previous business day over a weekend", () => {
    expect(fx("USD", "2025-01-05").toString()).toBe("1.44");
  });

  it("throws rather than guess before the first stored rate or for an unknown currency", () => {
    expect(() => fx("USD", "2025-01-01")).toThrow(/No USD\/CAD rate/);
    expect(() => fx("EUR", "2025-01-03")).toThrow(/No EUR\/CAD rate/);
  });
});

describe("toLedger", () => {
  const accounts = [{ id: "a1", accountType: "tfsa" as const }];
  const securities = [{ id: "sec1", symbol: "XYZ" }];

  it("maps columns to engine fields with exact decimals", () => {
    const [e] = toLedger([row({})], accounts, securities);
    expect(e).toMatchObject({ id: "t1", accountType: "tfsa", symbol: "XYZ", settlementDate: "2025-01-03" });
    expect(e!.price.toFixed(6)).toBe("12.345678");
    expect(e!.splitRatio).toBeUndefined();
  });

  it("drops cash-level fees that have no security", () => {
    expect(toLedger([row({ kind: "fee", securityId: null })], accounts, securities)).toEqual([]);
  });

  it("throws on a row whose account was not loaded", () => {
    expect(() => toLedger([row({ accountId: "missing" })], accounts, securities)).toThrow(/Unknown account/);
  });
});

describe("toDerivedRows", () => {
  it("points opening ACB events at the manual adjustment and numbers events per security", () => {
    const zero = new D(0);
    const rows = toDerivedRows(
      "u1",
      {
        positions: [],
        gains: [],
        superficialLosses: [],
        income: [],
        harvest: [],
        years: [],
        warnings: [],
        acbEvents: [
          { entryId: "opening:sec1", securityId: "sec1", date: "2025-01-01", kind: "opening", quantityDelta: new D(5), acbDeltaCad: new D(50), poolQuantityAfter: new D(5), poolAcbAfterCad: new D(50) },
          { entryId: "t1", securityId: "sec1", date: "2025-01-03", kind: "buy", quantityDelta: new D(10), acbDeltaCad: new D(128), poolQuantityAfter: new D(15), poolAcbAfterCad: new D(178) },
          { entryId: "t2", securityId: "sec2", date: "2025-01-03", kind: "buy", quantityDelta: zero, acbDeltaCad: zero, poolQuantityAfter: zero, poolAcbAfterCad: zero },
        ],
      },
      new Map([["sec1", "adj1"]]),
      "2025-12-31",
    );
    expect(rows.acbEvents.map((e) => [e.securityId, e.seq, e.transactionId, e.manualAdjustmentId])).toEqual([
      ["sec1", 1, null, "adj1"],
      ["sec1", 2, "t1", null],
      ["sec2", 1, "t2", null],
    ]);
    expect(rows.acbEvents[1]!.acbDeltaCad).toBe("128.000000");
  });
});
