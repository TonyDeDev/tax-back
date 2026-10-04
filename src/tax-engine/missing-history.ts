import { ZERO } from "./decimal";
import { isRegistered } from "./registered";
import type { LedgerEntry, OpeningAdjustment } from "./types";

/** Turn user-confirmed opening balances into internal ledger entries that sort before everything else that day. */
export function openingEntries(adjustments: readonly OpeningAdjustment[]): LedgerEntry[] {
  return adjustments.map((a) => ({
    id: `opening:${a.securityId}`,
    accountId: "opening",
    accountType: "non_registered" as const,
    securityId: a.securityId,
    symbol: a.symbol,
    currency: "CAD",
    kind: "opening" as const,
    tradeDate: a.asOfDate,
    settlementDate: a.asOfDate,
    quantity: a.quantity,
    price: ZERO,
    fees: ZERO,
    amount: a.acbCad,
  }));
}

/**
 * An opening balance replaces earlier non-registered history for its security.
 * Registered-account entries are kept because they still matter for superficial loss checks.
 */
export function dropSupersededEntries(
  entries: readonly LedgerEntry[],
  adjustments: readonly OpeningAdjustment[],
): LedgerEntry[] {
  const asOf = new Map(adjustments.map((a) => [a.securityId, a.asOfDate]));
  return entries.filter((e) => {
    const date = asOf.get(e.securityId);
    return date === undefined || isRegistered(e.accountType) || e.settlementDate >= date;
  });
}
