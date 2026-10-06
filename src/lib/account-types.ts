import type { AccountType } from "@/tax-engine/types";

/** Display labels, in the order the type picker shows them. */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  non_registered: "Non-registered",
  tfsa: "TFSA",
  rrsp: "RRSP",
  fhsa: "FHSA",
  resp: "RESP",
  rrif: "RRIF",
  lira: "LIRA / LIF",
};

export const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][];
