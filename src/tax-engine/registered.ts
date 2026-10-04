import type { AccountType } from "./types";

const REGISTERED: ReadonlySet<AccountType> = new Set(["tfsa", "rrsp", "fhsa", "resp", "rrif", "lira"]);

/** Registered accounts are excluded from gains and income but still count in superficial loss checks. */
export function isRegistered(type: AccountType): boolean {
  return REGISTERED.has(type);
}
