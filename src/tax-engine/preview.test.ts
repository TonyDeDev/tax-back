import { describe, expect, it } from "vitest";
import { computeTax } from "./index";
import { previewSale, PreviewError } from "./preview";
import { d, entry, flatFx } from "./test-helpers";
import type { LedgerEntry } from "./types";

// A Friday, so the hypothetical sale settles the following Monday, 2025-06-09.
const TODAY = "2025-06-06";

const preview = (ledger: LedgerEntry[], sale: { qty: number; price: number; fees?: number; currency?: string }, marginalRate?: number) =>
  previewSale({
    ledger,
    fx: flatFx(),
    asOfDate: TODAY,
    marginalRate: marginalRate === undefined ? null : d(marginalRate),
    sale: {
      securityId: "XYZ",
      quantity: d(sale.qty),
      price: d(sale.price),
      currency: sale.currency ?? "CAD",
      fees: d(sale.fees ?? 0),
    },
  });

describe("what if I sell?", () => {
  const held = [entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 })];

  it("shows the realized gain, the tax on it, and settles T+1", () => {
    // 40 @ 15 - 10 fees: proceeds 600, ACB 400, gain 190. Taxable 95, tax at 40% is 38.
    const p = preview(held, { qty: 40, price: 15, fees: 10 }, 0.4);
    expect([p.tradeDate, p.settlementDate]).toEqual([TODAY, "2025-06-09"]);
    expect([p.quantityHeld.toString(), p.totalAcbCad.toFixed(2)]).toEqual(["100", "1000.00"]);
    expect([p.gain.proceedsCad.toFixed(2), p.gain.acbCad.toFixed(2), p.gain.gainCad.toFixed(2)]).toEqual(["600.00", "400.00", "190.00"]);
    expect([p.taxableCad.toFixed(2), p.estimatedTaxCad!.toFixed(2)]).toEqual(["95.00", "38.00"]);
    expect([p.superficial, p.noRebuyBefore, p.recentPurchases]).toEqual([null, null, []]);
  });

  it("warns that a loss would be superficial and lost for good after a recent TFSA purchase", () => {
    // Sell 100 @ 8: loss 200. 20 units bought in the TFSA inside the window and still held deny 20/100 = 40.
    const p = preview(
      [...held, entry({ kind: "buy", date: "2025-05-26", qty: 20, price: 7, account: "t", type: "tfsa" })],
      { qty: 100, price: 8 },
    );
    expect(p.gain.gainCad.toFixed(2)).toBe("-200.00");
    expect(p.superficial).toMatchObject({ status: "pending" });
    expect([p.superficial!.deniedLossCad.toFixed(2), p.superficial!.lostForeverCad.toFixed(2)]).toEqual(["40.00", "40.00"]);
    expect(p.gain.allowedGainCad.toFixed(2)).toBe("-160.00");
    expect(p.recentPurchases.map((x) => [x.accountType, x.date])).toEqual([["tfsa", "2025-05-26"]]);
    expect([p.windowStart, p.windowEnd, p.noRebuyBefore]).toEqual(["2025-05-10", "2025-07-09", "2025-07-10"]);
  });

  it("with no recent purchase, a loss is allowed but rebuying is blocked until the window closes", () => {
    const p = preview(held, { qty: 100, price: 8 });
    expect(p.superficial).toBeNull();
    expect(p.gain.allowedGainCad.toFixed(2)).toBe("-200.00");
    expect(p.noRebuyBefore).toBe("2025-07-10");
  });

  it("converts a US dollar price at today's rate", () => {
    // 10 @ 100 USD x 1.25 = 1250 ACB; sell at 110 USD = 1375, gain 125.
    const usd = [entry({ kind: "buy", date: "2025-01-02", qty: 10, price: 100, currency: "USD" })];
    const p = preview(usd, { qty: 10, price: 110, currency: "USD" });
    expect([p.fxRate.toString(), p.gain.gainCad.toFixed(2)]).toEqual(["1.25", "125.00"]);
  });

  it("refuses more units than the non-registered position holds", () => {
    expect(() => preview(held, { qty: 150, price: 10 })).toThrow(PreviewError);
    expect(() => preview(held, { qty: 150, price: 10 })).toThrow(/Only 100 units/);
    expect(() => preview(held, { qty: 0, price: 10 })).toThrow(/above zero/);
    expect(() => preview([], { qty: 1, price: 10 })).toThrow(/No XYZ is held/);
  });

  it("does not change the stored results", () => {
    const before = computeTax({ ledger: held, fx: flatFx(), asOfDate: TODAY });
    preview(held, { qty: 40, price: 15 });
    const after = computeTax({ ledger: held, fx: flatFx(), asOfDate: TODAY });
    expect(after.gains).toHaveLength(0);
    expect(after.positions[0]!.totalAcbCad.eq(before.positions[0]!.totalAcbCad)).toBe(true);
  });
});
