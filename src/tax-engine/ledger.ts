import { addDays, isIsoDate } from "./dates";
import type { EntryKind, LedgerEntry } from "./types";

/** How far apart two reports of the same split may sit before they count as separate events. */
const SPLIT_REPORT_TOLERANCE_DAYS = 7;

export interface SplitDedupe {
  /** Split entries that repeat an already-applied split and must be skipped. */
  duplicateIds: ReadonlySet<string>;
  /** Duplicates that arrived on a different date than the split they repeat, worth surfacing. */
  conflicts: { securityId: string; symbol: string; entryId: string }[];
}

/**
 * A split is one corporate action, but every account holding the security reports it. Both the ACB
 * pool and the cross-account held timeline are totals, so the ratio must be applied once per split
 * rather than once per account, or a 2-for-1 held at two brokerages quadruples the quantity.
 *
 * Two entries are the same split when they share a security and ratio and sit within
 * `SPLIT_REPORT_TOLERANCE_DAYS` of each other, which absorbs brokers disagreeing on the date.
 * Expects a ledger already ordered by `sortLedger`.
 */
export function dedupeSplits(sorted: readonly LedgerEntry[]): SplitDedupe {
  const duplicateIds = new Set<string>();
  const conflicts: SplitDedupe["conflicts"] = [];
  const applied = new Map<string, { date: string }>();

  for (const e of sorted) {
    if (e.kind !== "split" || !e.splitRatio) continue;
    const key = `${e.securityId}|${e.splitRatio.toString()}`;
    const previous = applied.get(key);
    if (previous && e.settlementDate <= addDays(previous.date, SPLIT_REPORT_TOLERANCE_DAYS)) {
      duplicateIds.add(e.id);
      if (e.settlementDate !== previous.date) {
        conflicts.push({ securityId: e.securityId, symbol: e.symbol, entryId: e.id });
      }
      continue;
    }
    applied.set(key, { date: e.settlementDate });
  }
  return { duplicateIds, conflicts };
}

/** Same-day order: opening, splits, acquisitions, other income, then dispositions. */
const KIND_ORDER: Record<EntryKind, number> = {
  opening: 0,
  split: 1,
  buy: 2,
  drip: 2,
  transfer_in: 2,
  roc: 3,
  dividend: 3,
  fee: 3,
  transfer_out: 4,
  sell: 5,
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order by settlement date (when ownership changes), then kind, then trade date, then id. */
export function sortLedger(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort(
    (a, b) =>
      cmp(a.settlementDate, b.settlementDate) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      cmp(a.tradeDate, b.tradeDate) ||
      cmp(a.id, b.id),
  );
}

/** Returns a list of human-readable problems; empty means the ledger is usable. */
export function validateLedger(entries: readonly LedgerEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const at = `entry ${e.id}`;
    if (seen.has(e.id)) errors.push(`${at}: duplicate id`);
    seen.add(e.id);
    if (!isIsoDate(e.tradeDate) || !isIsoDate(e.settlementDate)) {
      errors.push(`${at}: dates must be YYYY-MM-DD`);
    } else if (e.settlementDate < e.tradeDate) {
      errors.push(`${at}: settlement date is before trade date`);
    }
    if (e.fees.isNegative()) errors.push(`${at}: negative fees`);
    switch (e.kind) {
      case "buy":
      case "drip":
      case "sell":
        if (!e.quantity.gt(0)) errors.push(`${at}: quantity must be positive`);
        if (e.price.isNegative()) errors.push(`${at}: negative price`);
        break;
      case "split":
        if (!e.splitRatio || !e.splitRatio.gt(0)) errors.push(`${at}: split needs a positive ratio`);
        break;
      case "dividend":
        if (!e.dividendClass) errors.push(`${at}: dividend needs a class`);
        if (e.amount.isNegative()) errors.push(`${at}: negative dividend`);
        break;
      case "roc":
        if (e.amount.isNegative()) errors.push(`${at}: negative return of capital`);
        break;
      default:
        break;
    }
  }
  return errors;
}
