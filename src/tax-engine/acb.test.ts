import { describe, expect, it } from "vitest";
import { computeTax } from "./index";
import { d, entry, flatFx } from "./test-helpers";

const run = (ledger: ReturnType<typeof entry>[], fx = flatFx()) =>
  computeTax({ ledger, fx, asOfDate: "2025-12-31" });

describe("pooled ACB", () => {
  it("buy with fees then partial sell", () => {
    // Buy 100 @ 10 + 10 fee = 1010. Sell 40 @ 15 - 10 fee: ACB sold 404, gain 600 - 404 - 10 = 186.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, fees: 10 }),
      entry({ kind: "sell", date: "2025-02-03", qty: 40, price: 15, fees: 10 }),
    ]);
    const g = r.gains[0]!;
    expect(g.acbCad.toFixed(2)).toBe("404.00");
    expect(g.gainCad.toFixed(2)).toBe("186.00");
    expect(r.positions[0]!.quantity.toString()).toBe("60");
    expect(r.positions[0]!.totalAcbCad.toFixed(2)).toBe("606.00");
  });

  it("averages multiple buys", () => {
    // 100 @ 10 and 100 @ 20 -> avg 15. Sell 50 @ 18: gain 900 - 750 = 150.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "buy", date: "2025-01-03", qty: 100, price: 20 }),
      entry({ kind: "sell", date: "2025-03-01", qty: 50, price: 18 }),
    ]);
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("150.00");
  });

  it("pools the same stock across two brokerages", () => {
    // Broker A alone would show ACB 1000 (gain 1500). Pooled ACB is 1500 per 100, so gain is 1000.
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "broker-a" }),
      entry({ kind: "buy", date: "2025-01-03", qty: 100, price: 20, account: "broker-b" }),
      entry({ kind: "sell", date: "2025-03-01", qty: 100, price: 25, account: "broker-a" }),
    ]);
    expect(r.gains[0]!.acbCad.toFixed(2)).toBe("1500.00");
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("1000.00");
  });

  it("return of capital lowers ACB", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "roc", date: "2025-02-01", amount: 200 }),
      entry({ kind: "sell", date: "2025-03-01", qty: 100, price: 10 }),
    ]);
    expect(r.gains).toHaveLength(1);
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("200.00");
  });

  it("return of capital beyond ACB is an immediate gain and ACB floors at zero", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "roc", date: "2025-02-01", amount: 1200 }),
    ]);
    const g = r.gains[0]!;
    expect(g.kind).toBe("roc_excess");
    expect(g.gainCad.toFixed(2)).toBe("200.00");
    expect(r.positions[0]!.totalAcbCad.toFixed(2)).toBe("0.00");
  });

  it("ignores return of capital with no position", () => {
    const r = run([entry({ kind: "roc", date: "2025-02-01", amount: 50 })]);
    expect(r.gains).toHaveLength(0);
    expect(r.warnings.map((w) => w.type)).toContain("roc_without_position");
  });

  it("a split changes quantity only", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
      entry({ kind: "split", date: "2025-02-01", ratio: 2 }),
      entry({ kind: "sell", date: "2025-03-01", qty: 100, price: 8 }),
    ]);
    expect(r.gains[0]!.acbCad.toFixed(2)).toBe("500.00");
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("300.00");
    expect(r.positions[0]!.quantity.toString()).toBe("100");
  });

  it("converts USD trades at each trade-date rate", () => {
    const fx = (c: string, date: string) => (c === "CAD" ? d(1) : date === "2025-01-02" ? d("1.30") : d("1.40"));
    const r = run(
      [
        entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 100, currency: "USD" }),
        entry({ kind: "sell", date: "2025-06-02", qty: 10, price: 120, currency: "USD" }),
      ],
      fx,
    );
    // ACB 1300, proceeds 1680.
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("380.00");
  });

  it("reports gains in the settlement-date year", () => {
    const r = run([
      entry({ kind: "buy", date: "2024-12-01", qty: 10, price: 10 }),
      entry({ kind: "sell", date: "2024-12-30", settle: "2025-01-02", qty: 10, price: 20 }),
    ]);
    expect(r.gains[0]!.year).toBe(2025);
    expect(r.years.map((y) => y.year)).toEqual([2025]);
  });

  it("excludes registered accounts from gains and the pool", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, type: "tfsa" }),
      entry({ kind: "sell", date: "2025-02-02", qty: 100, price: 50, type: "tfsa" }),
    ]);
    expect(r.gains).toHaveLength(0);
    expect(r.positions).toHaveLength(0);
  });

  it("flags unsupported transfers", () => {
    const r = run([entry({ kind: "transfer_in", date: "2025-01-02", qty: 5 })]);
    expect(r.warnings.map((w) => w.type)).toContain("unsupported_transfer");
  });

  it("rejects an invalid ledger", () => {
    expect(() => run([entry({ kind: "buy", date: "2025-13-40", qty: 0 })])).toThrow(/Invalid ledger/);
  });
});

describe("missing history", () => {
  const sellOnly = () => [
    entry({ kind: "buy", date: "2025-01-02", qty: 40, price: 10 }),
    entry({ kind: "sell", date: "2025-02-02", qty: 100, price: 12 }),
  ];

  it("warns and marks the gain incomplete when a sale exceeds known holdings", () => {
    const r = run(sellOnly());
    const w = r.warnings.find((x) => x.type === "opening_balance_needed");
    expect(w && "shortfall" in w ? w.shortfall.toString() : "").toBe("60");
    expect(r.gains[0]!.incomplete).toBe(true);
  });

  it("an opening balance replaces earlier history and clears the warning", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2024-06-01", qty: 5, price: 99 }),
        entry({ kind: "sell", date: "2025-02-02", qty: 100, price: 12 }),
      ],
      openings: [{ securityId: "XYZ", symbol: "XYZ", quantity: d(100), acbCad: d(1000), asOfDate: "2025-01-01" }],
      fx: flatFx(),
      asOfDate: "2025-12-31",
    });
    expect(r.warnings.filter((w) => w.type === "opening_balance_needed")).toHaveLength(0);
    expect(r.gains[0]!.gainCad.toFixed(2)).toBe("200.00");
    expect(r.gains[0]!.incomplete).toBe(false);
  });
});
