import { describe, expect, it } from "vitest";
import { nextBusinessDay } from "./dates";
import { D } from "./decimal";
import { computeTax } from "./index";
import { d, entry, flatFx } from "./test-helpers";
import type { FxLookup, LedgerEntry } from "./types";

/*
 * Golden cases for every event that changes ACB beyond plain buys and sells, plus the audit trail
 * each one leaves. Worked numbers are in the comments.
 */

const run = (ledger: LedgerEntry[], fx: FxLookup = flatFx()) => computeTax({ ledger, fx, asOfDate: "2025-12-31" });
const eventsOf = (r: ReturnType<typeof run>, security = "XYZ") => r.acbEvents.filter((e) => e.securityId === security);
const position = (r: ReturnType<typeof run>, security = "XYZ") => r.positions.find((p) => p.securityId === security);

describe("audit trail", () => {
  it("records the rule and the Bank of Canada rate of each trade's own date", () => {
    // USD/CAD is 1.30 in January and 1.40 in March.
    const fx: FxLookup = (c, date) => new D(c === "CAD" ? 1 : date < "2025-02-01" ? "1.30" : "1.40");
    // Buy: (10 x 100 + 5) x 1.30 = 1306.50. Sell 4 @ 120 - 5: proceeds 672, fees 7, ACB 522.60, gain 142.40.
    const r = run(
      [
        entry({ kind: "buy", date: "2025-01-10", qty: 10, price: 100, fees: 5, currency: "USD" }),
        entry({ kind: "sell", date: "2025-03-03", qty: 4, price: 120, fees: 5, currency: "USD" }),
      ],
      fx,
    );
    expect(eventsOf(r).map((e) => [e.rule, e.fxRate?.toString(), e.acbDeltaCad.toFixed(2)])).toEqual([
      ["buy_cost_plus_commission", "1.3", "1306.50"],
      ["sell_average_cost", "1.4", "-522.60"],
    ]);
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("142.40");
  });

  it("each event's pool totals chain into the next and end at the position", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "roc", date: "2025-02-01", amount: 100 }),
      entry({ kind: "split", date: "2025-03-01", ratio: 2 }),
      entry({ kind: "sell", date: "2025-04-01", qty: 50, price: 6 }),
    ]);
    const events = eventsOf(r);
    let qty = d(0);
    let acb = d(0);
    for (const e of events) {
      qty = qty.plus(e.quantityDelta);
      acb = acb.plus(e.acbDeltaCad);
      expect(e.poolQuantityAfter.eq(qty)).toBe(true);
      expect(e.poolAcbAfterCad.eq(acb)).toBe(true);
    }
    expect(events.map((e) => e.rule)).toEqual(["buy_cost_plus_commission", "roc_reduces_acb", "split_quantity_only", "sell_average_cost"]);
    expect(position(r)!.quantity.eq(qty)).toBe(true);
    expect(position(r)!.totalAcbCad.eq(acb)).toBe(true);
  });

  it("labels a denied superficial loss moving onto the replacement shares, with no FX step", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 8 }),
      entry({ kind: "buy", date: "2025-03-10", qty: 100, price: 8 }),
    ]);
    const adj = eventsOf(r).find((e) => e.kind === "superficial_adjustment")!;
    expect([adj.rule, adj.fxRate, adj.acbDeltaCad.toFixed(2)]).toEqual(["superficial_loss_added", null, "200.00"]);
  });

  it("marks return of capital beyond ACB as flooring at zero", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 10 }),
      entry({ kind: "roc", date: "2025-02-01", amount: 150 }),
    ]);
    expect(eventsOf(r).at(-1)!.rule).toBe("roc_floors_at_zero");
  });
});

describe("stock dividends", () => {
  it("add shares, add their value to ACB, and count that value as a dividend", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "stock_dividend", date: "2025-06-01", qty: 5, amount: 50, cls: "eligible" }),
    ]);
    expect(position(r)!.quantity.toString()).toBe("105");
    expect(position(r)!.totalAcbCad.toFixed(2)).toBe("1050.00");
    expect(r.income.map((i) => [i.dividendClass, i.amountCad.toFixed(2)])).toEqual([["eligible", "50.00"]]);
  });

  it("with no reported value behave like a split: more shares, same ACB, no income", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "stock_dividend", date: "2025-06-01", qty: 5, cls: "eligible" }),
    ]);
    expect(position(r)!.quantity.toString()).toBe("105");
    expect(position(r)!.totalAcbCad.toFixed(2)).toBe("1000.00");
    expect(r.income).toHaveLength(0);
  });

  it("in a registered account never touch the pool", () => {
    const r = run([entry({ kind: "stock_dividend", date: "2025-06-01", qty: 5, amount: 50, cls: "eligible", type: "tfsa" })]);
    expect(r.positions).toHaveLength(0);
    expect(r.income).toHaveLength(0);
  });
});

describe("transfers in kind", () => {
  const buy = entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "a" });

  it("between two non-registered accounts are not a tax event", () => {
    // Pool ACB stays 1000, so selling everything at 20 from the new account gains 1000.
    const r = run([
      buy,
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 100, price: 15, account: "a" }),
      entry({ kind: "transfer_in", date: "2025-03-05", qty: 100, price: 15, account: "b" }),
      entry({ kind: "sell", date: "2025-05-01", qty: 100, price: 20, account: "b" }),
    ]);
    expect(r.gains.map((g) => [g.kind, g.gainCad.toFixed(2)])).toEqual([["sale", "1000.00"]]);
    expect(r.warnings).toHaveLength(0);
  });

  it("into a TFSA are a deemed sale at fair market value, and a gain is taxable", () => {
    // 40 units at 15: proceeds 600, ACB 400, gain 200. The pool keeps 60 units and 600 of ACB.
    const r = run([
      buy,
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 40, price: 15, account: "a" }),
      entry({ kind: "transfer_in", date: "2025-03-04", qty: 40, price: 15, account: "t", type: "tfsa" }),
    ]);
    const g = r.gains[0]!;
    expect([g.kind, g.proceedsCad.toFixed(2), g.acbCad.toFixed(2), g.allowedGainCad.toFixed(2)]).toEqual([
      "deemed_disposition",
      "600.00",
      "400.00",
      "200.00",
    ]);
    expect([position(r)!.quantity.toString(), position(r)!.totalAcbCad.toFixed(2)]).toEqual(["60", "600.00"]);
    expect(eventsOf(r).at(-1)!.rule).toBe("transfer_to_registered_deemed_sale");
  });

  it("into a TFSA at a loss: the loss is denied for good, not carried like a superficial loss", () => {
    // 40 units at 7: proceeds 280, ACB 400, loss 120, all of it denied.
    const r = run([
      buy,
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 40, price: 7, account: "a" }),
      entry({ kind: "transfer_in", date: "2025-03-04", qty: 40, price: 7, account: "t", type: "tfsa" }),
    ]);
    const g = r.gains[0]!;
    expect([g.gainCad.toFixed(2), g.deniedLossCad.toFixed(2), g.allowedGainCad.toFixed(2)]).toEqual(["-120.00", "120.00", "0.00"]);
    expect(r.superficialLosses).toHaveLength(0);
    expect(r.years[0]!.netCapitalGainCad.toFixed(2)).toBe("0.00");
    const w = r.warnings.find((x) => x.type === "registered_transfer_loss_denied");
    expect(w && "amountCad" in w ? w.amountCad.toFixed(2) : "").toBe("120.00");
    // The remaining 60 units keep their own ACB; nothing was added to them.
    expect(position(r)!.totalAcbCad.toFixed(2)).toBe("600.00");
  });

  it("out of a TFSA are acquired at fair market value", () => {
    // 50 units come out at 12: ACB 600. Selling them at 13 gains 50.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 50, price: 10, account: "t", type: "tfsa" }),
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 50, price: 12, account: "t", type: "tfsa" }),
      entry({ kind: "transfer_in", date: "2025-03-04", qty: 50, price: 12, account: "a" }),
      entry({ kind: "sell", date: "2025-05-01", qty: 50, price: 13, account: "a" }),
    ]);
    expect(eventsOf(r)[0]!.rule).toBe("transfer_from_registered_at_fmv");
    expect(r.gains.map((g) => [g.kind, g.gainCad.toFixed(2)])).toEqual([["sale", "50.00"]]);
  });

  it("across the registered boundary without a market value are flagged and not applied", () => {
    const r = run([
      buy,
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 40, account: "a" }),
      entry({ kind: "transfer_in", date: "2025-03-04", qty: 40, account: "t", type: "tfsa" }),
    ]);
    expect(r.warnings.map((w) => w.type)).toContain("transfer_value_missing");
    expect(r.gains).toHaveLength(0);
    expect(position(r)!.quantity.toString()).toBe("100");
  });

  it("to an account TaxBack cannot see are flagged, and the shares stay in the pool", () => {
    const r = run([buy, entry({ kind: "transfer_out", date: "2025-03-03", qty: 40, price: 15, account: "a" })]);
    expect(r.warnings).toMatchObject([{ type: "transfer_unmatched", direction: "out" }]);
    expect(position(r)!.quantity.toString()).toBe("100");
  });

  it("only pair sides with the same quantity", () => {
    const r = run([
      buy,
      entry({ kind: "transfer_out", date: "2025-03-03", qty: 40, price: 15, account: "a" }),
      entry({ kind: "transfer_in", date: "2025-03-04", qty: 30, price: 15, account: "t", type: "tfsa" }),
    ]);
    expect(r.gains).toHaveLength(0);
    expect(r.warnings.map((w) => w.type)).toEqual(["transfer_unmatched"]);
  });
});

describe("spinoffs", () => {
  it("move ACB to the spun-off shares in proportion to fair market value", () => {
    // 100 PAR with ACB 5000. 1 KID per 2 PAR. PAR worth 40, KID 20: 4000 vs 1000, so KID takes 1/5 = 1000.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 50, security: "PAR" }),
      entry({ kind: "spinoff", date: "2025-04-01", security: "PAR", target: "KID", ratio: "0.5", price: 40, targetPrice: 20 }),
    ]);
    expect([position(r, "PAR")!.quantity.toString(), position(r, "PAR")!.totalAcbCad.toFixed(2)]).toEqual(["100", "4000.00"]);
    expect([position(r, "KID")!.quantity.toString(), position(r, "KID")!.totalAcbCad.toFixed(2)]).toEqual(["50", "1000.00"]);
    expect(eventsOf(r, "PAR").at(-1)!.rule).toBe("spinoff_acb_to_child");
    expect(eventsOf(r, "KID")[0]!.rule).toBe("spinoff_acb_from_parent");
    expect(r.gains).toHaveLength(0);
  });

  it("are rejected without both fair market values", () => {
    expect(() => run([entry({ kind: "spinoff", date: "2025-04-01", security: "PAR", target: "KID", ratio: 1, price: 40 })])).toThrow(
      /fair market values/,
    );
  });
});

describe("mergers", () => {
  const buyOld = entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 30, security: "OLD" });

  it("roll ACB over to the new shares when the deal is all shares", () => {
    const r = run([buyOld, entry({ kind: "merger", date: "2025-04-01", security: "OLD", target: "NEW", ratio: "0.5" })]);
    expect(position(r, "OLD")).toBeUndefined();
    expect([position(r, "NEW")!.quantity.toString(), position(r, "NEW")!.totalAcbCad.toFixed(2)]).toEqual(["50", "3000.00"]);
    expect(r.gains).toHaveLength(0);
  });

  it("with cash: the cash is a sale of the share of ACB it replaces", () => {
    // 100 OLD, ACB 3000 -> 50 NEW worth 100 each (5000) plus 10 cash per share (1000).
    // ACB for the cash: 3000 x 1000 / 6000 = 500, gain 500. NEW carries 2500.
    const r = run([
      buyOld,
      entry({ kind: "merger", date: "2025-04-01", security: "OLD", target: "NEW", ratio: "0.5", amount: 10, targetPrice: 100 }),
    ]);
    const g = r.gains[0]!;
    expect([g.kind, g.proceedsCad.toFixed(2), g.acbCad.toFixed(2), g.gainCad.toFixed(2)]).toEqual(["merger_cash", "1000.00", "500.00", "500.00"]);
    expect(position(r, "NEW")!.totalAcbCad.toFixed(2)).toBe("2500.00");
  });

  it("with US dollar cash converts at the effective date's rate", () => {
    // Buy 100 @ 24 USD x 1.25 = 3000. Cash 1000 USD = 1250, new shares 5000 USD = 6250.
    // ACB for the cash: 3000 x 1250 / 7500 = 500, gain 750.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 24, security: "OLD", currency: "USD" }),
      entry({ kind: "merger", date: "2025-04-01", security: "OLD", target: "NEW", ratio: "0.5", amount: 10, targetPrice: 100, currency: "USD" }),
    ]);
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("750.00");
    expect(position(r, "NEW")!.totalAcbCad.toFixed(2)).toBe("2500.00");
  });

  it("carry the new shares' ACB into later sales", () => {
    const r = run([
      buyOld,
      entry({ kind: "merger", date: "2025-04-01", security: "OLD", target: "NEW", ratio: "0.5" }),
      entry({ kind: "sell", date: "2025-06-02", qty: 50, price: 70, security: "NEW" }),
    ]);
    expect(r.gains.map((g) => g.gainCad.toFixed(2))).toEqual(["500.00"]);
  });
});

describe("reconciliation against the broker", () => {
  const broker = (accountId: string, securityId: string, quantity: number, accountType: LedgerEntry["accountType"] = "non_registered") => ({
    accountId,
    accountType,
    securityId,
    symbol: securityId,
    quantity: d(quantity),
  });

  it("matches the pooled position across brokerages and each registered account on its own", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "a" }),
        entry({ kind: "buy", date: "2025-01-03", qty: 50, price: 10, account: "b" }),
        entry({ kind: "sell", date: "2025-02-03", qty: 30, price: 12, account: "a" }),
        entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 5, account: "t", type: "tfsa", security: "ABC" }),
        entry({ kind: "split", date: "2025-03-03", ratio: 2, account: "t", type: "tfsa", security: "ABC" }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
      brokerPositions: [broker("a", "XYZ", 70), broker("b", "XYZ", 50), broker("t", "ABC", 20, "tfsa")],
    });
    expect(r.reconciliation).toMatchObject({ matched: 2, total: 2 });
  });

  it("flags shares that arrived with no history and shares that vanished, mismatches first", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "a" }),
        entry({ kind: "transfer_in", date: "2025-02-02", qty: 25, price: 10, account: "a" }),
        entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 10, account: "a", security: "GONE" }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
      brokerPositions: [broker("a", "XYZ", 125), broker("a", "OLDCO", 40)],
    });
    expect(r.reconciliation.rows.map((x) => [x.securityId, x.ledgerQuantity.toString(), x.brokerQuantity.toString(), x.status])).toEqual([
      ["GONE", "10", "0", "ledger_has_more"],
      ["OLDCO", "0", "40", "broker_has_more"],
      ["XYZ", "100", "125", "broker_has_more"],
    ]);
    expect(r.reconciliation).toMatchObject({ matched: 0, total: 3 });
  });

  it("applies a spinoff to registered accounts too", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 50, security: "PAR", account: "a" }),
        entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 50, security: "PAR", account: "t", type: "tfsa" }),
        entry({ kind: "spinoff", date: "2025-04-01", security: "PAR", target: "KID", ratio: "0.5", price: 40, targetPrice: 20 }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
      brokerPositions: [broker("a", "PAR", 100), broker("a", "KID", 50), broker("t", "PAR", 10, "tfsa"), broker("t", "KID", 5, "tfsa")],
    });
    expect(r.reconciliation).toMatchObject({ matched: 4, total: 4 });
  });

  it("is empty when no broker positions are given", () => {
    const r = run([entry({ kind: "buy", date: "2025-01-02", qty: 1, price: 1 })]);
    expect(r.reconciliation).toEqual({ rows: [], matched: 0, total: 0 });
  });
});

describe("dates", () => {
  it("settles T+1 on business days", () => {
    expect(nextBusinessDay("2025-06-05")).toBe("2025-06-06");
    expect(nextBusinessDay("2025-06-06")).toBe("2025-06-09");
    expect(nextBusinessDay("2025-06-07")).toBe("2025-06-09");
  });
});
