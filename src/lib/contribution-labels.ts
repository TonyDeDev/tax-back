/** Display labels for the Contributions page, shared by the page and its client forms. */

export const FLOW_KIND_LABELS = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  transfer: "Same-plan transfer",
  rrsp_to_fhsa: "RRSP to FHSA",
  ignored: "Not counted",
} as const;

/** The choices a user can make for a flow; `auto` returns to TaxBack's reading. */
export const CLASSIFICATION_OPTIONS = [
  ["auto", "Automatic"],
  ["contribution", "Contribution"],
  ["withdrawal", "Withdrawal"],
  ["transfer", "Same-plan transfer"],
  ["rrsp_to_fhsa", "RRSP to FHSA transfer"],
  ["ignore", "Not a contribution"],
] as const;

/** What the broker called it. */
export const BROKER_TYPE_LABELS: Record<string, string> = {
  CONTRIBUTION: "Deposit",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  INTERNAL_CASH_TRANSFER_IN: "Transfer in",
  INTERNAL_CASH_TRANSFER_OUT: "Transfer out",
  TRANSFER: "Transfer",
  INTERNAL_ASSET_TRANSFER_IN: "Shares transferred in",
  INTERNAL_ASSET_TRANSFER_OUT: "Shares transferred out",
  EXTERNAL_ASSET_TRANSFER_IN: "Shares transferred in",
  EXTERNAL_ASSET_TRANSFER_OUT: "Shares transferred out",
};

export const ROOM_SOURCE_LABELS = {
  cra: "CRA figure",
  estimate: "Estimate",
  unknown: "Room unknown",
} as const;
