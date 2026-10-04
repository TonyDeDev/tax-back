import type { Dec } from "./decimal";

export type AccountType = "non_registered" | "tfsa" | "rrsp" | "fhsa" | "resp" | "rrif" | "lira";

/** `opening` is internal: it is produced from OpeningAdjustment and never supplied by callers. */
export type EntryKind =
  | "buy"
  | "sell"
  | "drip"
  | "dividend"
  | "roc"
  | "split"
  | "fee"
  | "transfer_in"
  | "transfer_out"
  | "opening";

export type DividendClass = "eligible" | "non_eligible" | "foreign";

/**
 * One brokerage event. Quantities are always positive; `kind` gives the direction.
 * `price` and `fees` are in `currency`. `amount` is the total for dividend and roc entries, in `currency`.
 * `splitRatio` is new shares per old share (2 for a 2-for-1).
 */
export interface LedgerEntry {
  id: string;
  accountId: string;
  accountType: AccountType;
  securityId: string;
  symbol: string;
  currency: string;
  kind: EntryKind;
  tradeDate: string;
  settlementDate: string;
  quantity: Dec;
  price: Dec;
  fees: Dec;
  amount: Dec;
  splitRatio?: Dec;
  dividendClass?: DividendClass;
  withholdingTax?: Dec;
}

/** User-confirmed starting position (quantity and total ACB in CAD) as of the start of `asOfDate`. */
export interface OpeningAdjustment {
  securityId: string;
  symbol: string;
  quantity: Dec;
  acbCad: Dec;
  asOfDate: string;
}

/** CAD per one unit of `currency` on `date`. Must return 1 for CAD. Previous-business-day fallback is the caller's job. */
export type FxLookup = (currency: string, date: string) => Dec;

export interface AcbPosition {
  securityId: string;
  symbol: string;
  currency: string;
  quantity: Dec;
  totalAcbCad: Dec;
  acbPerShareCad: Dec;
}

export interface AcbEvent {
  entryId: string;
  securityId: string;
  date: string;
  kind: EntryKind | "superficial_adjustment";
  quantityDelta: Dec;
  acbDeltaCad: Dec;
  poolQuantityAfter: Dec;
  poolAcbAfterCad: Dec;
}

export interface RealizedGain {
  entryId: string;
  kind: "sale" | "roc_excess";
  securityId: string;
  symbol: string;
  accountId: string;
  date: string;
  year: number;
  quantity: Dec;
  proceedsCad: Dec;
  acbCad: Dec;
  feesCad: Dec;
  /** proceeds - acb - fees, before any superficial loss denial. */
  gainCad: Dec;
  deniedLossCad: Dec;
  /** gainCad + deniedLossCad: what actually counts for the year. */
  allowedGainCad: Dec;
  /** True when the sale exceeded the known position, so ACB is understated. */
  incomplete: boolean;
}

export interface SuperficialReplacement {
  entryId: string;
  accountId: string;
  accountType: AccountType;
  quantity: Dec;
  deniedCad: Dec;
  disposition: "added_to_acb" | "lost_forever";
}

export interface SuperficialLoss {
  saleEntryId: string;
  securityId: string;
  symbol: string;
  saleDate: string;
  year: number;
  quantitySold: Dec;
  quantityDenied: Dec;
  totalLossCad: Dec;
  deniedLossCad: Dec;
  allowedLossCad: Dec;
  lostForeverCad: Dec;
  windowStart: string;
  windowEnd: string;
  replacements: SuperficialReplacement[];
}

export interface IncomeEvent {
  entryId: string;
  securityId: string;
  symbol: string;
  accountId: string;
  date: string;
  year: number;
  dividendClass: DividendClass;
  amountCad: Dec;
  grossedUpCad: Dec;
  federalCreditCad: Dec;
  withholdingCad: Dec;
}

export interface MarketPrice {
  price: Dec;
  currency: string;
}

export interface HarvestOpportunity {
  securityId: string;
  symbol: string;
  quantity: Dec;
  acbCad: Dec;
  marketValueCad: Dec;
  unrealizedLossCad: Dec;
  /** Net realized gain so far this year that a loss could offset (never negative). */
  gainsAvailableToOffsetCad: Dec;
  estimatedTaxSavingsCad: Dec | null;
  windowStart: string;
  windowEnd: string;
  /** Selling today would be superficial because of a purchase inside the window. */
  blockedByRecentPurchase: boolean;
  earliestSafeSaleDate: string;
  /** Do not buy this security in ANY account (including TFSA/RRSP) before this date. */
  noRebuyBefore: string;
}

export type Warning =
  | { type: "opening_balance_needed"; securityId: string; symbol: string; entryId: string; shortfall: Dec }
  | { type: "superficial_loss_lost_forever"; securityId: string; symbol: string; entryId: string; amountCad: Dec }
  | { type: "unsupported_transfer"; securityId: string; symbol: string; entryId: string }
  | { type: "roc_without_position"; securityId: string; symbol: string; entryId: string }
  | { type: "assumed_year_config"; year: number };

export interface YearSummary {
  year: number;
  proceedsCad: Dec;
  acbCad: Dec;
  feesCad: Dec;
  /** Sum of allowed gains and losses. */
  netCapitalGainCad: Dec;
  deniedLossesCad: Dec;
  inclusionRate: Dec;
  /** Signed: negative is a net capital loss available to carry. */
  taxableCapitalGainCad: Dec;
  eligibleDividendsCad: Dec;
  nonEligibleDividendsCad: Dec;
  foreignIncomeCad: Dec;
  foreignWithholdingCad: Dec;
  federalDividendCreditCad: Dec;
  estimatedTaxCad: Dec | null;
}

export interface TaxResult {
  positions: AcbPosition[];
  acbEvents: AcbEvent[];
  gains: RealizedGain[];
  superficialLosses: SuperficialLoss[];
  income: IncomeEvent[];
  harvest: HarvestOpportunity[];
  years: YearSummary[];
  warnings: Warning[];
}
