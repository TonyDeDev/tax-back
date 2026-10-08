import type { ContributionsResult } from "./contributions/types";
import type { Dec } from "./decimal";

/**
 * `us_retirement` is an IRA, Roth IRA, 401(k), or similar held by a Canadian resident. Growth inside it
 * is not taxed each year in Canada, so like a TFSA or RRSP it is left out of gains and income.
 */
export type AccountType = "non_registered" | "tfsa" | "rrsp" | "fhsa" | "resp" | "rrif" | "lira" | "us_retirement";

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
  | "stock_dividend"
  | "spinoff"
  | "merger"
  | "opening";

export type DividendClass = "eligible" | "non_eligible" | "foreign";

/** The security a spinoff or merger hands out. */
export interface TargetSecurity {
  securityId: string;
  symbol: string;
  currency: string;
}

/**
 * One brokerage event. Quantities are always positive; `kind` gives the direction.
 * `price` and `fees` are in `currency`. `amount` is the total for dividend, roc, and stock_dividend
 * entries, in `currency`. `splitRatio` is new shares per old share (2 for a 2-for-1).
 *
 * Transfers use `price` as the fair market value per unit on the transfer date; it only matters when
 * the shares cross between a registered and a non-registered account.
 *
 * Spinoffs and mergers are security-wide corporate actions entered by the user, not per-account
 * reports: `splitRatio` is new shares per old share, `price` is the old share's fair market value
 * just after the action, `targetPrice` the new share's, and for a merger `amount` is cash per old share.
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
  target?: TargetSecurity;
  targetPrice?: Dec;
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

/** Why an ACB event changed the pool the way it did. The audit trail shows one sentence per rule. */
export type AcbRule =
  | "opening_balance"
  | "buy_cost_plus_commission"
  | "drip_reinvested"
  | "stock_dividend_value"
  | "sell_average_cost"
  | "roc_reduces_acb"
  | "roc_floors_at_zero"
  | "split_quantity_only"
  | "superficial_loss_added"
  | "transfer_to_registered_deemed_sale"
  | "transfer_from_registered_at_fmv"
  | "spinoff_acb_to_child"
  | "spinoff_acb_from_parent"
  | "merger_rollover_out"
  | "merger_rollover_in";

export interface AcbEvent {
  entryId: string;
  securityId: string;
  date: string;
  kind: EntryKind | "superficial_adjustment";
  rule: AcbRule;
  /** CAD per unit of the entry's currency used for this step, or null when no conversion happened. */
  fxRate: Dec | null;
  quantityDelta: Dec;
  acbDeltaCad: Dec;
  poolQuantityAfter: Dec;
  poolAcbAfterCad: Dec;
}

export interface RealizedGain {
  entryId: string;
  /**
   * `deemed_disposition`: shares moved into a registered account count as sold at fair market value.
   * `merger_cash`: the cash part of a merger is a sale of the share of ACB it replaces.
   */
  kind: "sale" | "roc_excess" | "deemed_disposition" | "merger_cash";
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
  /**
   * `pending` while `windowEnd` is still in the future: the outcome depends on what the user does
   * next, so the denial is provisional. Selling the replacement before the window closes undoes it.
   */
  status: "final" | "pending";
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
  /** The superficial loss window of a sale on `earliestSafeSaleDate`, around its T+1 settlement. */
  windowStart: string;
  windowEnd: string;
  /** Selling today would be superficial because of a purchase inside the window. */
  blockedByRecentPurchase: boolean;
  /** The first trading day, from today, a sale would not be superficial. */
  earliestSafeSaleDate: string;
  /** After a sale on `earliestSafeSaleDate`, do not buy this security in ANY account (including TFSA/RRSP) before this date. */
  noRebuyBefore: string;
}

export type Warning =
  | { type: "opening_balance_needed"; securityId: string; symbol: string; entryId: string; shortfall: Dec }
  | { type: "superficial_loss_lost_forever"; securityId: string; symbol: string; entryId: string; amountCad: Dec }
  | {
      type: "superficial_loss_pending";
      securityId: string;
      symbol: string;
      entryId: string;
      /** The denial is only settled once this date has passed. */
      windowEnd: string;
    }
  /** A transfer with no counterpart in another connected account: the other side is unknown. */
  | { type: "transfer_unmatched"; securityId: string; symbol: string; entryId: string; direction: "in" | "out" }
  /** A transfer across the registered boundary arrived without a fair market value, so it was not applied. */
  | { type: "transfer_value_missing"; securityId: string; symbol: string; entryId: string }
  /** Shares moved into a registered account at a loss: the loss is denied for good (ITA 40(2)(g)(iv)). */
  | { type: "registered_transfer_loss_denied"; securityId: string; symbol: string; entryId: string; amountCad: Dec }
  | { type: "roc_without_position"; securityId: string; symbol: string; entryId: string }
  /** The same split was reported by more than one account on different dates; it was applied once. */
  | { type: "split_reported_twice"; securityId: string; symbol: string; entryId: string }
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
  /** The taxable amounts after the gross-up: T1 lines 12010 (eligible) and 12000 (both). */
  eligibleTaxableCad: Dec;
  nonEligibleTaxableCad: Dec;
  foreignIncomeCad: Dec;
  foreignWithholdingCad: Dec;
  federalDividendCreditCad: Dec;
  estimatedTaxCad: Dec | null;
}

/** A position the broker reports right now, for reconciliation. */
export interface BrokerPosition {
  accountId: string;
  accountType: AccountType;
  securityId: string;
  symbol: string;
  quantity: Dec;
}

/**
 * `match`: the ledger and the broker agree. `broker_has_more`: shares arrived with no cost history
 * (usually a transfer in, or history older than the broker shares), so an opening balance is needed.
 * `ledger_has_more`: shares left without a recorded sale or transfer.
 */
export type ReconciliationStatus = "match" | "broker_has_more" | "ledger_has_more";

export interface ReconciliationRow {
  securityId: string;
  symbol: string;
  /** Null for the pooled non-registered position; a registered account is checked on its own. */
  accountId: string | null;
  ledgerQuantity: Dec;
  brokerQuantity: Dec;
  status: ReconciliationStatus;
}

export interface Reconciliation {
  rows: ReconciliationRow[];
  matched: number;
  total: number;
}

export interface TaxResult {
  positions: AcbPosition[];
  reconciliation: Reconciliation;
  acbEvents: AcbEvent[];
  gains: RealizedGain[];
  superficialLosses: SuperficialLoss[];
  income: IncomeEvent[];
  harvest: HarvestOpportunity[];
  years: YearSummary[];
  warnings: Warning[];
  contributions: ContributionsResult;
}
