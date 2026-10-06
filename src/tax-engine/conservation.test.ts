import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import { computeTax } from "./index";
import { previewSale } from "./preview";
import { isRegistered } from "./registered";
import { entry } from "./test-helpers";
import type { AccountType, BrokerPosition, FxLookup, LedgerEntry, TaxResult } from "./types";

/*
 * Property tests: hundreds of random but valid ledgers (buys, sells, DRIPs, stock dividends, splits,
 * return of capital, dividends, transfers across every account type, spinoffs, and mergers), each
 * replayed against an independent per-account share count. Whatever the history, shares are
 * conserved, every ACB step chains, gains add up, and the ledger reconciles with the "broker" 100%.
 * Seeded, so a failure names the seed that reproduces it.
 */

const SEEDS = 500;

/** mulberry32: small, fast, and deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

const ACCOUNTS: readonly { id: string; type: AccountType }[] = [
  { id: "cash-a", type: "non_registered" },
  { id: "cash-b", type: "non_registered" },
  { id: "tfsa", type: "tfsa" },
  { id: "rrsp", type: "rrsp" },
];
const typeOf = (accountId: string) => ACCOUNTS.find((a) => a.id === accountId)!.type;

/** USD/CAD drifts with the date so conversions differ trade to trade. */
const fx: FxLookup = (currency, date) =>
  currency === "CAD" ? new D(1) : new D("1.30").plus(new D(Number(date.slice(5, 7)) + Number(date.slice(8, 10))).div(1000));

interface Generated {
  ledger: LedgerEntry[];
  /** account -> security -> units, kept independently of the engine. */
  held: Map<string, Map<string, Dec>>;
  currency: Map<string, string>;
}

function generate(seed: number): Generated {
  const r = rng(seed);
  const ledger: LedgerEntry[] = [];
  const held = new Map<string, Map<string, Dec>>(ACCOUNTS.map((a) => [a.id, new Map()]));
  const currency = new Map<string, string>([
    ["AAA", "CAD"],
    ["BBB", "CAD"],
    ["UUU", "USD"],
  ]);
  const active = ["AAA", "BBB", "UUU"];
  const lastSplit = new Map<string, string>();
  const lastTransfer = new Map<string, string>();
  let children = 0;
  let date = "2024-01-02";

  const qtyOf = (account: string, security: string) => held.get(account)!.get(security) ?? ZERO;
  const add = (account: string, security: string, delta: Dec) => held.get(account)!.set(security, qtyOf(account, security).plus(delta));
  const holders = (security: string) => ACCOUNTS.filter((a) => qtyOf(a.id, security).gt(0));
  const anyHeld = () =>
    ACCOUNTS.flatMap((a) => active.filter((s) => qtyOf(a.id, s).gt(0)).map((s) => ({ account: a.id, security: s })));
  // Units up to two decimals, so fractional shares (DRIPs, reverse splits) show up.
  const units = (max: number) => new D(r.int(1, max * 100)).div(100);
  const price = () => new D(r.int(100, 20000)).div(100);
  const base = (account: string, security: string) => ({
    date,
    account,
    type: typeOf(account),
    security,
    currency: currency.get(security)!,
  });

  const steps = r.int(30, 120);
  for (let i = 0; i < steps; i++) {
    date = addDays(date, r.int(0, 6));
    const roll = r.next();
    const owned = anyHeld();

    if (roll < 0.3 || owned.length === 0) {
      const account = r.pick(ACCOUNTS).id;
      const security = r.pick(active);
      const qty = units(200);
      ledger.push(entry({ ...base(account, security), kind: "buy", qty: qty.toString(), price: price().toString(), fees: r.int(0, 10) }));
      add(account, security, qty);
    } else if (roll < 0.52) {
      const { account, security } = r.pick(owned);
      // Sometimes sell everything, so pools empty out and refill.
      const all = qtyOf(account, security);
      const qty = r.next() < 0.25 ? all : D.min(all, units(150));
      ledger.push(entry({ ...base(account, security), kind: "sell", qty: qty.toString(), price: price().toString(), fees: r.int(0, 10) }));
      add(account, security, qty.neg());
    } else if (roll < 0.58) {
      const { account, security } = r.pick(owned);
      const qty = units(3);
      ledger.push(entry({ ...base(account, security), kind: "drip", qty: qty.toString(), price: price().toString() }));
      add(account, security, qty);
    } else if (roll < 0.62) {
      const { account, security } = r.pick(owned);
      const qty = units(5);
      const amount = r.next() < 0.5 ? "0" : price().toString();
      ledger.push(entry({ ...base(account, security), kind: "stock_dividend", qty: qty.toString(), amount, cls: "eligible" }));
      add(account, security, qty);
    } else if (roll < 0.68) {
      const { security } = r.pick(owned);
      const previous = lastSplit.get(security);
      if (previous && addDays(previous, 10) > date) continue;
      // The engine applies splits before same-day trades, so a split opens a new day here too.
      date = addDays(date, 1);
      lastSplit.set(security, date);
      const ratio = new D(r.pick(["2", "3", "0.5", "0.25", "1.5"]));
      // Every account holding the security reports the split.
      for (const a of holders(security)) {
        ledger.push(entry({ ...base(a.id, security), kind: "split", ratio: ratio.toString() }));
        held.get(a.id)!.set(security, qtyOf(a.id, security).times(ratio));
      }
    } else if (roll < 0.73) {
      const { account, security } = r.pick(owned);
      const kind = r.next() < 0.5 ? "roc" : "dividend";
      ledger.push(entry({ ...base(account, security), kind, amount: price().times(r.int(1, 30)).toString(), cls: "eligible" }));
    } else if (roll < 0.88) {
      const { account, security } = r.pick(owned);
      const previous = lastTransfer.get(security);
      if (previous && addDays(previous, 12) > date) continue;
      const to = r.pick(ACCOUNTS.filter((a) => a.id !== account)).id;
      lastTransfer.set(security, date);
      const qty = D.min(qtyOf(account, security), units(100));
      const fmv = price().toString();
      ledger.push(entry({ ...base(account, security), kind: "transfer_out", qty: qty.toString(), price: fmv }));
      // The shares can only be used once they arrive, so the clock moves to the arrival date.
      date = addDays(date, r.int(0, 3));
      ledger.push(entry({ ...base(to, security), kind: "transfer_in", qty: qty.toString(), price: fmv }));
      add(account, security, qty.neg());
      add(to, security, qty);
    } else if (roll < 0.94) {
      const { security } = r.pick(owned);
      if (currency.get(security) !== "CAD") continue;
      children += 1;
      const child = `KID${children}`;
      date = addDays(date, 1);
      currency.set(child, "CAD");
      active.push(child);
      const ratio = new D(r.pick(["0.5", "1", "0.2"]));
      ledger.push(
        entry({ date, account: "corporate", security, target: child, kind: "spinoff", ratio: ratio.toString(), price: price().toString(), targetPrice: price().toString() }),
      );
      for (const a of ACCOUNTS) add(a.id, child, qtyOf(a.id, security).times(ratio));
    } else {
      const { security } = r.pick(owned);
      if (currency.get(security) !== "CAD") continue;
      children += 1;
      const next = `NEW${children}`;
      date = addDays(date, 1);
      currency.set(next, "CAD");
      active.splice(active.indexOf(security), 1, next);
      const ratio = new D(r.pick(["0.5", "2", "1.25"]));
      const cash = r.next() < 0.5 ? "0" : price().div(10).toFixed(2);
      ledger.push(
        entry({ date, account: "corporate", security, target: next, kind: "merger", ratio: ratio.toString(), amount: cash, targetPrice: price().toString() }),
      );
      for (const a of ACCOUNTS) {
        add(a.id, next, qtyOf(a.id, security).times(ratio));
        held.get(a.id)!.set(security, ZERO);
      }
    }
  }
  return { ledger, held, currency };
}

function brokerPositionsOf(g: Generated): BrokerPosition[] {
  return ACCOUNTS.flatMap((a) =>
    [...g.held.get(a.id)!].filter(([, q]) => q.gt(0)).map(([securityId, quantity]) => ({ accountId: a.id, accountType: a.type, securityId, symbol: securityId, quantity })),
  );
}

const ASOF = "2027-06-30";
const close = (a: Dec, b: Dec) => a.minus(b).abs().lte("0.000001");

function computeFor(g: Generated, ledger = g.ledger): TaxResult {
  return computeTax({ ledger, fx, asOfDate: ASOF, brokerPositions: brokerPositionsOf(g) });
}

const cases = Array.from({ length: SEEDS }, (_, i) => i + 1).map((seed) => ({ seed, g: generate(seed) }));

describe("conservation over random ledgers", () => {
  it(`generates rich histories (${SEEDS} seeds)`, () => {
    const kinds = new Set(cases.flatMap(({ g }) => g.ledger.map((e) => e.kind)));
    for (const k of ["buy", "sell", "drip", "stock_dividend", "split", "roc", "dividend", "transfer_in", "transfer_out", "spinoff", "merger"]) {
      expect(kinds, k).toContain(k);
    }
  });

  it("the ledger always reconciles with the broker: shares are conserved in every account", () => {
    for (const { seed, g } of cases) {
      const r = computeFor(g);
      const gaps = r.reconciliation.rows.filter((x) => x.status !== "match");
      expect(gaps, `seed ${seed}`).toEqual([]);
      expect(r.reconciliation.matched, `seed ${seed}`).toBe(r.reconciliation.total);
    }
  });

  it("the pooled quantity is the sum of every non-registered account", () => {
    for (const { seed, g } of cases) {
      const r = computeFor(g);
      const expected = new Map<string, Dec>();
      for (const a of ACCOUNTS.filter((x) => !isRegistered(x.type))) {
        for (const [s, q] of g.held.get(a.id)!) expected.set(s, (expected.get(s) ?? ZERO).plus(q));
      }
      for (const [s, q] of expected) {
        const pos = r.positions.find((p) => p.securityId === s);
        expect(close(pos?.quantity ?? ZERO, q), `seed ${seed} ${s}`).toBe(true);
      }
    }
  });

  it("valid histories raise no missing-history or transfer warnings", () => {
    for (const { seed, g } of cases) {
      const types = computeFor(g).warnings.map((w) => w.type);
      expect(types.filter((t) => ["opening_balance_needed", "transfer_unmatched", "transfer_value_missing"].includes(t)), `seed ${seed}`).toEqual([]);
    }
  });

  it("every ACB step chains into the next, never goes negative, and ends at the position", () => {
    for (const { seed, g } of cases) {
      const r = computeFor(g);
      const bySecurity = new Map<string, { qty: Dec; acb: Dec }>();
      for (const e of r.acbEvents) {
        const run = bySecurity.get(e.securityId) ?? { qty: ZERO, acb: ZERO };
        run.qty = run.qty.plus(e.quantityDelta);
        run.acb = run.acb.plus(e.acbDeltaCad);
        bySecurity.set(e.securityId, run);
        const at = `seed ${seed} ${e.securityId} ${e.entryId} ${e.rule}`;
        expect(close(e.poolQuantityAfter, run.qty), at).toBe(true);
        expect(close(e.poolAcbAfterCad, run.acb), at).toBe(true);
        expect(e.poolAcbAfterCad.gte("-0.000001"), at).toBe(true);
        if (e.poolQuantityAfter.isZero()) expect(close(e.poolAcbAfterCad, ZERO), at).toBe(true);
      }
      for (const [s, run] of bySecurity) {
        const pos = r.positions.find((p) => p.securityId === s);
        expect(close(pos?.quantity ?? ZERO, run.qty), `seed ${seed} ${s}`).toBe(true);
        expect(close(pos?.totalAcbCad ?? ZERO, run.acb), `seed ${seed} ${s}`).toBe(true);
      }
    }
  });

  it("corporate actions move ACB without creating or destroying any", () => {
    for (const { seed, g } of cases) {
      const r = computeFor(g);
      for (const e of g.ledger.filter((x) => x.kind === "spinoff" || x.kind === "merger")) {
        const moved = r.acbEvents.filter((x) => x.entryId === e.id).reduce((sum, x) => sum.plus(x.acbDeltaCad), ZERO);
        const cashAcb = r.gains.find((x) => x.entryId === e.id)?.acbCad ?? ZERO;
        expect(close(moved.plus(cashAcb), ZERO), `seed ${seed} ${e.id}`).toBe(true);
      }
    }
  });

  it("gains, denials, and year totals add up", () => {
    for (const { seed, g } of cases) {
      const r = computeFor(g);
      for (const x of r.gains) {
        const at = `seed ${seed} ${x.entryId}`;
        expect(x.allowedGainCad.eq(x.gainCad.plus(x.deniedLossCad)), at).toBe(true);
        expect(x.deniedLossCad.gte(0), at).toBe(true);
        if (x.gainCad.gte(0)) expect(x.deniedLossCad.isZero(), at).toBe(true);
        else expect(x.deniedLossCad.lte(x.gainCad.neg().plus("0.000001")), at).toBe(true);
      }
      for (const l of r.superficialLosses) {
        const at = `seed ${seed} ${l.saleEntryId}`;
        expect(close(l.deniedLossCad.plus(l.allowedLossCad), l.totalLossCad), at).toBe(true);
        expect(l.lostForeverCad.lte(l.deniedLossCad.plus("0.000001")), at).toBe(true);
        const allocated = l.replacements.reduce((sum, x) => sum.plus(x.deniedCad), ZERO);
        expect(close(allocated, l.deniedLossCad), at).toBe(true);
      }
      for (const y of r.years) {
        const net = r.gains.filter((x) => x.year === y.year).reduce((sum, x) => sum.plus(x.allowedGainCad), ZERO);
        expect(close(y.netCapitalGainCad, net), `seed ${seed} ${y.year}`).toBe(true);
      }
    }
  });

  it("the result does not depend on the order entries arrive in", () => {
    for (const { seed, g } of cases.slice(0, 60)) {
      const shuffled = [...g.ledger].reverse();
      const a = computeFor(g);
      const b = computeFor(g, shuffled);
      expect(b.positions.map((p) => [p.securityId, p.quantity.toString(), p.totalAcbCad.toString()]), `seed ${seed}`).toEqual(
        a.positions.map((p) => [p.securityId, p.quantity.toString(), p.totalAcbCad.toString()]),
      );
    }
  });

  it("previewing a sale of a whole position takes exactly its ACB and leaves nothing behind", () => {
    for (const { seed, g } of cases.slice(0, 100)) {
      const r = computeFor(g);
      for (const p of r.positions) {
        const preview = previewSale({
          ledger: g.ledger,
          fx,
          asOfDate: ASOF,
          sale: { securityId: p.securityId, quantity: p.quantity, price: new D(10), currency: g.currency.get(p.securityId)!, fees: ZERO },
        });
        const at = `seed ${seed} ${p.securityId}`;
        expect(close(preview.gain.acbCad, p.totalAcbCad), at).toBe(true);
        expect(close(preview.quantityHeld, p.quantity), at).toBe(true);
      }
    }
  });
});
