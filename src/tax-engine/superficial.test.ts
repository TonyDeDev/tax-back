import { describe, expect, it } from "vitest";
import { computeTax } from "./index";
import { sortLedger } from "./ledger";
import { buildHeldTimeline } from "./superficial";
import { entry, flatFx } from "./test-helpers";

const run = (ledger: ReturnType<typeof entry>[]) => computeTax({ ledger, fx: flatFx(), asOfDate: "2025-12-31" });

const original = () => entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 });
const lossSale = () => entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 6 });

describe("superficial loss", () => {
  it("denies the full loss and moves it to the replacement shares", () => {
    const r = run([original(), lossSale(), entry({ kind: "buy", date: "2025-03-20", qty: 100, price: 6 })]);
    const s = r.superficialLosses[0]!;
    expect(s.totalLossCad.toFixed(2)).toBe("400.00");
    expect(s.deniedLossCad.toFixed(2)).toBe("400.00");
    expect(r.gains[0]!.allowedGainCad.toFixed(2)).toBe("0.00");
    // 100 @ 6 = 600, plus 400 denied.
    expect(r.positions[0]!.totalAcbCad.toFixed(2)).toBe("1000.00");
    expect(s.replacements[0]!.disposition).toBe("added_to_acb");
  });

  it("loses the denied amount forever when a TFSA buy is the replacement", () => {
    const r = run([
      original(),
      lossSale(),
      entry({ kind: "buy", date: "2025-03-10", qty: 100, price: 6, type: "tfsa", account: "tfsa" }),
    ]);
    const s = r.superficialLosses[0]!;
    expect(s.lostForeverCad.toFixed(2)).toBe("400.00");
    expect(s.replacements[0]!.disposition).toBe("lost_forever");
    expect(r.warnings.map((w) => w.type)).toContain("superficial_loss_lost_forever");
    expect(r.positions).toHaveLength(0);
  });

  it("denies only the least-of portion", () => {
    // Rebuy 40 and still hold 40: denied 400 * 40/100 = 160, allowed 240, new ACB 40 * 6 + 160 = 400.
    const r = run([original(), lossSale(), entry({ kind: "buy", date: "2025-03-20", qty: 40, price: 6 })]);
    const s = r.superficialLosses[0]!;
    expect(s.quantityDenied.toString()).toBe("40");
    expect(s.deniedLossCad.toFixed(2)).toBe("160.00");
    expect(r.gains[0]!.allowedGainCad.toFixed(2)).toBe("-240.00");
    expect(r.positions[0]!.totalAcbCad.toFixed(2)).toBe("400.00");
  });

  it("is not superficial if the replacement is gone by the end of the window", () => {
    const r = run([
      original(),
      lossSale(),
      entry({ kind: "buy", date: "2025-03-10", qty: 100, price: 6 }),
      entry({ kind: "sell", date: "2025-03-25", qty: 100, price: 9 }),
    ]);
    expect(r.superficialLosses).toHaveLength(0);
    expect(r.gains[0]!.allowedGainCad.toFixed(2)).toBe("-400.00");
  });

  it("counts a purchase exactly 30 days after the sale but not 31", () => {
    const base = [original(), lossSale()];
    expect(run([...base, entry({ kind: "buy", date: "2025-04-02", qty: 100, price: 6 })]).superficialLosses).toHaveLength(1);
    expect(run([...base, entry({ kind: "buy", date: "2025-04-03", qty: 100, price: 6 })]).superficialLosses).toHaveLength(0);
  });

  it("counts a purchase exactly 30 days before the sale but not 31", () => {
    // Extra 100 bought outside/inside the window while the first lot is sold; 100 stay held.
    const lot = (date: string) => [
      entry({ kind: "buy", date: "2024-12-01", qty: 100, price: 10 }),
      entry({ kind: "buy", date, qty: 100, price: 10 }),
      entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 6 }),
    ];
    expect(run(lot("2025-02-01")).superficialLosses).toHaveLength(1);
    expect(run(lot("2025-01-31")).superficialLosses).toHaveLength(0);
  });

  it("one purchase cannot shelter two losses", () => {
    const r = run([
      entry({ kind: "buy", date: "2025-01-02", qty: 200, price: 10 }),
      entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 6 }),
      entry({ kind: "sell", date: "2025-03-04", qty: 100, price: 6 }),
      entry({ kind: "buy", date: "2025-03-10", qty: 100, price: 6 }),
    ]);
    const denied = r.superficialLosses.reduce((n, s) => n + s.quantityDenied.toNumber(), 0);
    expect(denied).toBe(100);
  });

  it("does not apply to gains", () => {
    const r = run([
      original(),
      entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 15 }),
      entry({ kind: "buy", date: "2025-03-10", qty: 100, price: 15 }),
    ]);
    expect(r.superficialLosses).toHaveLength(0);
  });

  it("attaches the denied loss to the replacement when the sold lot was also inside the window", () => {
    // The opening buy sits inside the 30-day pre-window, so it is a candidate too. The denied loss
    // must still follow the shares actually held at the end of the window: the Mar 20 replacement.
    const r = run([
      entry({ kind: "buy", date: "2025-02-10", qty: 100, price: 10 }),
      entry({ kind: "sell", date: "2025-03-03", qty: 100, price: 6 }),
      entry({ kind: "buy", date: "2025-03-20", qty: 100, price: 6 }),
    ]);
    const s = r.superficialLosses[0]!;
    expect(s.deniedLossCad.toFixed(2)).toBe("400.00");
    expect(s.lostForeverCad.toFixed(2)).toBe("0.00");
    // 100 @ 6 = 600, plus the 400 denied.
    expect(r.positions[0]!.totalAcbCad.toFixed(2)).toBe("1000.00");
    expect(r.warnings.map((w) => w.type)).not.toContain("superficial_loss_lost_forever");
  });

  it("does not lose part of the denial to a DRIP that fell inside the window", () => {
    // A DRIP shortly before the sale is an in-window acquisition, but it is sold with everything
    // else; the non-registered replacement is what the denial must attach to.
    const r = run([
      entry({ kind: "buy", date: "2024-06-01", qty: 100, price: 10 }),
      entry({ kind: "drip", date: "2025-02-20", qty: 2, price: 6 }),
      entry({ kind: "sell", date: "2025-03-03", qty: 102, price: 6 }),
      entry({ kind: "buy", date: "2025-03-20", qty: 100, price: 6 }),
    ]);
    const s = r.superficialLosses[0]!;
    expect(s.lostForeverCad.toFixed(2)).toBe("0.00");
    expect(r.warnings.map((w) => w.type)).not.toContain("superficial_loss_lost_forever");
  });
});

describe("held timeline", () => {
  it("applies one split once when two accounts each report it", () => {
    // 100 in a non-registered account and 100 in a TFSA. A 2-for-1 arrives from both brokers,
    // but the security split once: the cross-account total is 400, not 800.
    const held = buildHeldTimeline(
      sortLedger([
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "broker-a" }),
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "tfsa", type: "tfsa" }),
        entry({ kind: "split", date: "2025-02-01", ratio: 2, account: "broker-a" }),
        entry({ kind: "split", date: "2025-02-01", ratio: 2, account: "tfsa", type: "tfsa" }),
      ]),
    );
    expect(held.heldAt("XYZ", "2025-03-01").toString()).toBe("400");
  });
});

describe("superficial loss status", () => {
  const recent = [
    entry({ kind: "buy", date: "2025-11-01", qty: 100, price: 10 }),
    entry({ kind: "sell", date: "2025-12-20", qty: 100, price: 6 }),
    entry({ kind: "buy", date: "2025-12-22", qty: 100, price: 6 }),
  ];

  it("is pending while the 30-day window is still open", () => {
    const r = computeTax({ ledger: recent, fx: flatFx(), asOfDate: "2025-12-31" });
    const s = r.superficialLosses[0]!;
    expect(s.status).toBe("pending");
    expect(s.windowEnd).toBe("2026-01-19");
    expect(r.warnings.map((w) => w.type)).toContain("superficial_loss_pending");
  });

  it("is final once the window has closed", () => {
    const r = computeTax({ ledger: recent, fx: flatFx(), asOfDate: "2026-02-01" });
    expect(r.superficialLosses[0]!.status).toBe("final");
    expect(r.warnings.map((w) => w.type)).not.toContain("superficial_loss_pending");
  });
});

describe("split reporting", () => {
  it("warns when two brokers report one split on different dates", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "broker-a" }),
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, account: "broker-b" }),
        entry({ kind: "split", date: "2025-02-01", ratio: 2, account: "broker-a" }),
        entry({ kind: "split", date: "2025-02-03", ratio: 2, account: "broker-b" }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
    });
    expect(r.positions[0]!.quantity.toString()).toBe("400");
    expect(r.warnings.map((w) => w.type)).toContain("split_reported_twice");
  });

  it("treats a genuine second split outside the tolerance as its own event", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
        entry({ kind: "split", date: "2025-02-01", ratio: 2 }),
        entry({ kind: "split", date: "2025-06-01", ratio: 2 }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
    });
    expect(r.positions[0]!.quantity.toString()).toBe("400");
    expect(r.warnings.map((w) => w.type)).not.toContain("split_reported_twice");
  });
});
