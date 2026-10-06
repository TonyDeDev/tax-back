import { addDays } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import { dedupeSplits } from "./ledger";
import type { LedgerEntry } from "./types";

/** Window is inclusive: 30 days before the sale through 30 days after it, on settlement dates. */
export const SUPERFICIAL_WINDOW_DAYS = 30;

export interface HeldTimeline {
  /** Total units of the security held across ALL accounts (registered included) at the end of `date`. */
  heldAt(securityId: string, date: string): Dec;
}

interface Point {
  date: string;
  total: Dec;
}

export function buildHeldTimeline(sorted: readonly LedgerEntry[]): HeldTimeline {
  const totals = new Map<string, Dec>();
  const points = new Map<string, Point[]>();
  // These totals span every account, so a split reported by each of them must only count once.
  const { duplicateIds } = dedupeSplits(sorted);
  const set = (securityId: string, date: string, total: Dec) => {
    totals.set(securityId, total);
    const list = points.get(securityId) ?? [];
    list.push({ date, total });
    points.set(securityId, list);
  };
  for (const e of sorted) {
    const current = totals.get(e.securityId) ?? ZERO;
    switch (e.kind) {
      case "opening":
      case "buy":
      case "drip":
      case "stock_dividend":
      case "transfer_in":
        set(e.securityId, e.settlementDate, current.plus(e.quantity));
        break;
      case "sell":
      case "transfer_out":
        set(e.securityId, e.settlementDate, current.minus(e.quantity));
        break;
      case "split":
        if (duplicateIds.has(e.id)) continue;
        set(e.securityId, e.settlementDate, current.times(e.splitRatio ?? 1));
        break;
      // Corporate actions apply to every account at once, registered ones included.
      case "spinoff":
      case "merger": {
        if (!e.target) continue;
        const received = D.max(current, ZERO).times(e.splitRatio ?? 0);
        const targetTotal = totals.get(e.target.securityId) ?? ZERO;
        set(e.target.securityId, e.settlementDate, targetTotal.plus(received));
        if (e.kind === "merger") set(e.securityId, e.settlementDate, ZERO);
        break;
      }
      default:
        continue;
    }
  }
  return {
    heldAt(securityId, date) {
      const list = points.get(securityId);
      if (!list) return ZERO;
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((list[mid] as Point).date <= date) lo = mid + 1;
        else hi = mid;
      }
      const total = lo === 0 ? ZERO : (list[lo - 1] as Point).total;
      return total.isNegative() ? ZERO : total;
    },
  };
}

export interface Acquisition {
  entry: LedgerEntry;
  index: number;
}

export interface SuperficialAllocation {
  acquisition: Acquisition;
  quantity: Dec;
  deniedCad: Dec;
}

export interface SuperficialAssessment {
  windowStart: string;
  windowEnd: string;
  quantityDenied: Dec;
  deniedLossCad: Dec;
  allocations: SuperficialAllocation[];
}

/**
 * Least-of rule: denied share = min(sold, bought in window, held at end of window) / sold.
 * `remaining` tracks how much of each purchase is still free to act as a replacement,
 * so one purchase cannot shelter two different losses. It is updated in place.
 */
export function assessSuperficialLoss(args: {
  sale: LedgerEntry;
  saleIndex: number;
  lossCad: Dec;
  acquisitions: readonly Acquisition[];
  remaining: Map<string, Dec>;
  held: HeldTimeline;
}): SuperficialAssessment | null {
  const { sale, saleIndex, lossCad, acquisitions, remaining, held } = args;
  const windowStart = addDays(sale.settlementDate, -SUPERFICIAL_WINDOW_DAYS);
  const windowEnd = addDays(sale.settlementDate, SUPERFICIAL_WINDOW_DAYS);

  const candidates = acquisitions.filter(
    (a) => a.entry.settlementDate >= windowStart && a.entry.settlementDate <= windowEnd,
  );
  const freeQty = (a: Acquisition): Dec => remaining.get(a.entry.id) ?? a.entry.quantity;
  const bought = candidates.reduce((sum, a) => sum.plus(freeQty(a)), ZERO);
  if (!bought.gt(0)) return null;

  const stillHeld = held.heldAt(sale.securityId, windowEnd);
  const denied = D.min(sale.quantity, bought, stillHeld);
  if (!denied.gt(0)) return null;

  const deniedLossCad = lossCad.times(denied).div(sale.quantity);
  const allocations: SuperficialAllocation[] = [];
  let left = denied;

  // Deliberately not chronological. The denied loss has to follow the shares still owned at the end
  // of the window, which are the ones bought after the sale; a pre-sale purchase inside the window
  // may well have been sold off by this very disposition. Consuming those first would strand the
  // denial on shares that no longer exist and report it as lost forever.
  const ordered = [...candidates].sort(
    (a, b) => Number(a.index < saleIndex) - Number(b.index < saleIndex) || a.index - b.index,
  );

  for (const a of ordered) {
    if (!left.gt(0)) break;
    const free = freeQty(a);
    if (!free.gt(0)) continue;
    const take = D.min(left, free);
    remaining.set(a.entry.id, free.minus(take));
    allocations.push({ acquisition: a, quantity: take, deniedCad: deniedLossCad.times(take).div(denied) });
    left = left.minus(take);
  }
  return { windowStart, windowEnd, quantityDenied: denied, deniedLossCad, allocations };
}
