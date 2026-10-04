import { addDays } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
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
  for (const e of sorted) {
    const current = totals.get(e.securityId) ?? ZERO;
    let next: Dec;
    switch (e.kind) {
      case "opening":
      case "buy":
      case "drip":
      case "transfer_in":
        next = current.plus(e.quantity);
        break;
      case "sell":
      case "transfer_out":
        next = current.minus(e.quantity);
        break;
      case "split":
        next = current.times(e.splitRatio ?? 1);
        break;
      default:
        continue;
    }
    totals.set(e.securityId, next);
    const list = points.get(e.securityId) ?? [];
    list.push({ date: e.settlementDate, total: next });
    points.set(e.securityId, list);
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
  lossCad: Dec;
  acquisitions: readonly Acquisition[];
  remaining: Map<string, Dec>;
  held: HeldTimeline;
}): SuperficialAssessment | null {
  const { sale, lossCad, acquisitions, remaining, held } = args;
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
  for (const a of candidates) {
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
