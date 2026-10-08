import { addDays } from "@/tax-engine/dates";

/*
 * Which reconciliation gaps the user should act on.
 *
 * Only the pooled non-registered position carries ACB, so only its gaps can change tax. A gap that
 * appears on a later sync is usually a trade the broker already counts in its holdings but has not
 * reported as an activity yet (a recurring buy is typically a day behind), so it gets a few days to
 * resolve itself before the user is asked for an opening balance.
 */

/** Days a newly appeared gap waits for the broker's activity feed to catch up. */
export const GAP_GRACE_DAYS = 3;

export type ReconciliationStatus = "match" | "broker_has_more" | "ledger_has_more";

/**
 * - `tax`: a non-registered gap that changes ACB; the user is asked to fix it.
 * - `waiting`: a non-registered gap that appeared in the last few days; likely not reported yet.
 * - `registered`: a gap inside one registered account; no ACB, so no effect on tax.
 */
export type GapClass = "tax" | "waiting" | "registered";

export interface ReconciliationKey {
  securityId: string;
  /** Null (or absent, on an insert row) for the pooled non-registered position. */
  accountId?: string | null;
}

export interface StoredReconciliation extends ReconciliationKey {
  status: ReconciliationStatus;
  gapSince: string | null;
}

const keyOf = (r: ReconciliationKey) => `${r.securityId}|${r.accountId ?? ""}`;
const accountOf = (r: ReconciliationKey) => r.accountId ?? "";

/**
 * Carries `gapSince` from the previous recompute into the new rows.
 * A gap keeps its date while its direction is unchanged. A gap on a position that matched before, or
 * on a new position in an account that was already reconciled, starts today. A gap seen on the first
 * reconciliation of an account gets null: that is history the broker never shared, not a delay.
 */
export function carryGapSince<T extends ReconciliationKey & { status: ReconciliationStatus }>(
  next: readonly T[],
  previous: readonly StoredReconciliation[],
  today: string,
): (T & { gapSince: string | null })[] {
  const before = new Map(previous.map((p) => [keyOf(p), p]));
  const knownAccounts = new Set(previous.map(accountOf));
  return next.map((row) => {
    if (row.status === "match") return { ...row, gapSince: null };
    const prior = before.get(keyOf(row));
    if (prior) return { ...row, gapSince: prior.status === row.status ? prior.gapSince : today };
    return { ...row, gapSince: knownAccounts.has(accountOf(row)) ? today : null };
  });
}

/** The class of a non-matching row; `today` decides whether a recent gap is still waiting. */
export function gapClass(row: { accountId: string | null; gapSince: string | null }, today: string): GapClass {
  if (row.accountId !== null) return "registered";
  return isWaiting(row.gapSince, today) ? "waiting" : "tax";
}

export function isWaiting(gapSince: string | null, today: string): boolean {
  return gapSince !== null && today < waitingUntil(gapSince);
}

/** The first day a waiting gap counts as real. */
export function waitingUntil(gapSince: string): string {
  return addDays(gapSince, GAP_GRACE_DAYS);
}
