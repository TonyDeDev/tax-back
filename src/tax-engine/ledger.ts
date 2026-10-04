import { isIsoDate } from "./dates";
import type { EntryKind, LedgerEntry } from "./types";

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
