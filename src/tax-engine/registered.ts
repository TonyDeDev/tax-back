import type { AccountType } from "./types";

// U.S. retirement accounts are tax-sheltered for a Canadian resident too. Purchases in them count for
// superficial loss checks the same way, which is the cautious reading: a loss replaced there is lost.
const REGISTERED: ReadonlySet<AccountType> = new Set(["tfsa", "rrsp", "fhsa", "resp", "rrif", "lira", "us_retirement"]);

/** Registered (and U.S. retirement) accounts are excluded from gains and income but still count in superficial loss checks. */
export function isRegistered(type: AccountType): boolean {
  return REGISTERED.has(type);
}
