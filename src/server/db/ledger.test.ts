import { describe, expect, it } from "vitest";
import { D } from "@/tax-engine";
import { fxLookupFrom, toCashFlows, toContributionInputs, toCorporateActions, toDerivedRows, toLedger } from "./ledger";
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
  const zero = new D(0);
  const empty = {
    positions: [],
    gains: [],
    superficialLosses: [],
    income: [],
    harvest: [],
    years: [],
    warnings: [],
    acbEvents: [],
    reconciliation: { rows: [], matched: 0, total: 0 },
    contributions: { flows: [], years: [] },
  };

  it("points opening ACB events at the manual adjustment and numbers events per security", () => {
    const rows = toDerivedRows(
      "u1",
      {
        ...empty,
        acbEvents: [
          { entryId: "opening:sec1", securityId: "sec1", date: "2025-01-01", kind: "opening", rule: "opening_balance", fxRate: null, quantityDelta: new D(5), acbDeltaCad: new D(50), poolQuantityAfter: new D(5), poolAcbAfterCad: new D(50) },
          { entryId: "t1", securityId: "sec1", date: "2025-01-03", kind: "buy", rule: "buy_cost_plus_commission", fxRate: new D("1.43"), quantityDelta: new D(10), acbDeltaCad: new D(128), poolQuantityAfter: new D(15), poolAcbAfterCad: new D(178) },
          { entryId: "t2", securityId: "sec2", date: "2025-01-03", kind: "buy", rule: "buy_cost_plus_commission", fxRate: new D(1), quantityDelta: zero, acbDeltaCad: zero, poolQuantityAfter: zero, poolAcbAfterCad: zero },
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
    // The audit trail keeps the rule and the exact rate used.
    expect(rows.acbEvents.map((e) => [e.rule, e.fxRate])).toEqual([
      ["opening_balance", null],
      ["buy_cost_plus_commission", "1.4300000000"],
      ["buy_cost_plus_commission", "1.0000000000"],
    ]);
  });

  it("points corporate action events and merger cash gains at the corporate action, with no account", () => {
    const rows = toDerivedRows(
      "u1",
      {
        ...empty,
        acbEvents: [
          { entryId: "corporate:ca1", securityId: "sec2", date: "2025-03-01", kind: "merger", rule: "merger_rollover_in", fxRate: null, quantityDelta: new D(5), acbDeltaCad: new D(80), poolQuantityAfter: new D(5), poolAcbAfterCad: new D(80) },
        ],
        gains: [
          { entryId: "corporate:ca1", kind: "merger_cash", securityId: "sec1", symbol: "OLD", accountId: "corporate", date: "2025-03-01", year: 2025, quantity: new D(10), proceedsCad: new D(30), acbCad: new D(20), feesCad: zero, gainCad: new D(10), deniedLossCad: zero, allowedGainCad: new D(10), incomplete: false },
        ],
      },
      new Map(),
      "2025-12-31",
    );
    expect(rows.acbEvents[0]).toMatchObject({ transactionId: null, manualAdjustmentId: null, corporateActionId: "ca1" });
    expect(rows.realizedGains[0]).toMatchObject({ transactionId: null, corporateActionId: "ca1", accountId: null, kind: "merger_cash" });
  });

  it("writes reconciliation rows, with a null account for the pooled position", () => {
    const rows = toDerivedRows(
      "u1",
      {
        ...empty,
        reconciliation: {
          rows: [
            { securityId: "sec1", symbol: "XYZ", accountId: null, ledgerQuantity: new D(10), brokerQuantity: new D(15), status: "broker_has_more" },
            { securityId: "sec1", symbol: "XYZ", accountId: "tfsa1", ledgerQuantity: new D(3), brokerQuantity: new D(3), status: "match" },
          ],
          matched: 1,
          total: 2,
        },
      },
      new Map(),
      "2025-12-31",
    );
    expect(rows.positionReconciliations.map((r) => [r.accountId, r.ledgerQuantity, r.brokerQuantity, r.status])).toEqual([
      [null, "10.0000000000", "15.0000000000", "broker_has_more"],
      ["tfsa1", "3.0000000000", "3.0000000000", "match"],
    ]);
  });
});

describe("toCorporateActions", () => {
  it("maps a merger to one security-wide entry with its target, ratio, cash, and fair market value", () => {
    const [e] = toCorporateActions(
      [
        {
          id: "ca1",
          userId: "u1",
          kind: "merger",
          securityId: "old",
          targetSecurityId: "new",
          effectiveDate: "2025-03-01",
          currency: "USD",
          ratio: "0.5000000000",
          oldFmv: null,
          newFmv: "40.000000",
          cashPerShare: "3.000000",
          note: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
      [
        { id: "old", symbol: "OLD", currency: "USD" },
        { id: "new", symbol: "NEW", currency: "USD" },
      ],
    );
    expect(e).toMatchObject({ id: "corporate:ca1", kind: "merger", securityId: "old", accountType: "non_registered", tradeDate: "2025-03-01" });
    expect(e!.target).toEqual({ securityId: "new", symbol: "NEW", currency: "USD" });
    expect([e!.splitRatio!.toString(), e!.amount.toString(), e!.targetPrice!.toString(), e!.price.toString()]).toEqual(["0.5", "3", "40", "0"]);
  });
});

type FlowRow = typeof s.contributionFlows.$inferSelect;

const flowRow = (over: Partial<FlowRow>): FlowRow => ({
  id: "f1",
  userId: "u1",
  source: "snaptrade",
  accountId: "a1",
  plan: null,
  snaptradeActivityId: "act1",
  brokerType: "CONTRIBUTION",
  flowDate: "2025-02-03",
  direction: "in",
  amount: "1000.000000",
  currency: "CAD",
  description: null,
  classification: null,
  raw: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("toCashFlows", () => {
  const accounts = [
    { id: "a1", accountType: "tfsa" as const, kind: "investment" as const },
    { id: "cash", accountType: "non_registered" as const, kind: "cash" as const },
  ];

  it("takes a synced flow's plan from its account's current type", () => {
    const [f] = toCashFlows([flowRow({})], accounts);
    expect(f).toMatchObject({ id: "f1", accountId: "a1", plan: "tfsa", investment: true, direction: "in", brokerType: "CONTRIBUTION" });
    expect(f!.amount.toString()).toBe("1000");
  });

  it("keeps a manual flow's own plan, and marks cash accounts", () => {
    const [manual, cash] = toCashFlows(
      [
        flowRow({ id: "m1", source: "manual", accountId: null, snaptradeActivityId: null, plan: "rrsp", brokerType: null, classification: "contribution" }),
        flowRow({ id: "c1", accountId: "cash" }),
      ],
      accounts,
    );
    expect(manual).toMatchObject({ plan: "rrsp", accountId: null, investment: true, classification: "contribution" });
    expect(cash).toMatchObject({ plan: "non_registered", investment: false });
  });

  it("links a flow for shares moved in kind to the transfer of the same activity in the same account", () => {
    const transactions = [
      { id: "t1", accountId: "a1", snaptradeActivityId: "act1", kind: "transfer_in" as const },
      { id: "t2", accountId: "a1", snaptradeActivityId: "act2", kind: "buy" as const },
      { id: "t3", accountId: "other", snaptradeActivityId: "act3", kind: "transfer_in" as const },
    ];
    const flows = toCashFlows(
      [flowRow({}), flowRow({ id: "f2", snaptradeActivityId: "act2" }), flowRow({ id: "f3", snaptradeActivityId: "act3" })],
      accounts,
      transactions,
    );
    expect(flows.map((f) => f.transferEntryId)).toEqual(["t1", null, null]);
  });

  it("maps CRA figures, leaving blanks as null", () => {
    const [i] = toContributionInputs([
      {
        userId: "u1",
        plan: "rrsp",
        taxYear: 2025,
        officialRoomCad: "12000.000000",
        unusedCarriedForwardCad: null,
        earnedIncomePriorYearCad: null,
        pensionAdjustmentCad: null,
        deductionClaimedCad: "500.000000",
        updatedAt: new Date(0),
      },
    ]);
    expect(i).toMatchObject({ plan: "rrsp", year: 2025, unusedCarriedForward: null });
    expect([i!.officialRoom!.toString(), i!.deductionClaimed!.toString()]).toEqual(["12000", "500"]);
  });
});
