import type { Dec } from "../decimal";
import type { AccountType, FxLookup } from "../types";

/** Every registered plan type; contributions to a non-registered account mean nothing for room. */
export type Plan = Exclude<AccountType, "non_registered">;

/** Plans whose contribution room TaxBack tracks. The others only list contributions and withdrawals. */
export type RoomPlan = "tfsa" | "rrsp" | "fhsa";

/**
 * What the user says a cash movement is, overriding the automatic reading.
 * `transfer`: a direct transfer between two plans of the same type (TFSA to TFSA), which is neither a
 * contribution nor a withdrawal. `rrsp_to_fhsa`: property moved from an RRSP to an FHSA, which uses FHSA
 * room but is not deductible. `ignore`: not a contribution at all (a correction, a fee refund).
 */
export type FlowClassification = "contribution" | "withdrawal" | "transfer" | "rrsp_to_fhsa" | "ignore";

/**
 * One cash movement into or out of an account, or a contribution the user entered for an account
 * TaxBack cannot see. `amount` is positive in `currency`; `direction` gives the way it went.
 */
export interface CashFlow {
  id: string;
  /** Null for a manual entry with no connected account. */
  accountId: string | null;
  /** The plan the money moved in or out of: the account's type, or the plan a manual entry names. */
  plan: AccountType;
  /** False for chequing-style cash accounts, whose deposits are never contributions. */
  investment: boolean;
  date: string;
  direction: "in" | "out";
  amount: Dec;
  currency: string;
  /** The activity type SnapTrade reported (`CONTRIBUTION`, `INTERNAL_CASH_TRANSFER_IN`, ...); null for manual entries. */
  brokerType: string | null;
  classification: FlowClassification | null;
}

/** The figures CRA gives the user for one plan and year, and estimate inputs when they have none. */
export interface ContributionYearInput {
  plan: RoomPlan;
  year: number;
  /**
   * TFSA: contribution room on January 1 (CRA My Account). RRSP: the deduction limit from the notice of
   * assessment. FHSA: participation room (annual limit plus carryforward) from the FHSA room statement.
   */
  officialRoom: Dec | null;
  /** RRSP: unused contributions from the notice of assessment. FHSA: unused contributions from the room statement. */
  unusedCarriedForward: Dec | null;
  /** RRSP estimate: earned income for the previous year. */
  earnedIncomePriorYear: Dec | null;
  /** RRSP estimate: pension adjustment for the previous year (box 52 of the T4). */
  pensionAdjustment: Dec | null;
  /** RRSP and FHSA: the deduction the user claims. Null claims the most allowed. */
  deductionClaimed: Dec | null;
}

export interface ContributionProfile {
  birthYear: number | null;
  /** The year the user became a resident of Canada; null for a lifelong resident. */
  residentSinceYear: number | null;
  /** The year the user opened their first FHSA; null to take the year of the first FHSA flow. */
  fhsaOpenedYear: number | null;
}

export interface ContributionsInput {
  flows: readonly CashFlow[];
  inputs: readonly ContributionYearInput[];
  profile: ContributionProfile;
  fx: FxLookup;
  asOfDate: string;
  /** Plans the user has an account of, so a plan with no activity yet still gets this year's room. */
  plansHeld: readonly Plan[];
  /** Per room plan, the earliest date from which every account of that plan has full history; null when unknown. */
  historyFrom: Readonly<Partial<Record<RoomPlan, string | null>>>;
}

export type FlowKind = "contribution" | "withdrawal" | "transfer" | "rrsp_to_fhsa" | "ignored";

export interface ClassifiedFlow {
  flowId: string;
  plan: Plan | null;
  kind: FlowKind;
  /** The tax year the flow counts for: the calendar year, except RRSP contributions in the first 60 days. */
  taxYear: number;
  amountCad: Dec;
  /** CAD per unit of `currency`; null for CAD. */
  fxRate: Dec | null;
  /** The automatic reading is a guess the user should confirm (an internal transfer with no visible other side). */
  needsReview: boolean;
}

/** `cra`: from a figure the user entered. `estimate`: computed by TaxBack. `unknown`: not enough to say. */
export type RoomSource = "cra" | "estimate" | "unknown";

export interface MonthlyExcess {
  /** Highest excess in any month of the year. */
  peakExcessCad: Dec;
  /** 1% of each month's highest excess, summed. */
  penaltyCad: Dec;
}

export interface TfsaYear extends MonthlyExcess {
  plan: "tfsa";
  year: number;
  roomSource: RoomSource;
  /** The estimate starts before the earliest tracked history, so contributions TaxBack cannot see may be missing. */
  estimateIncomplete: boolean;
  /** Room on January 1. Negative when an excess carried over from the year before. */
  openingRoomCad: Dec | null;
  contributionsCad: Dec;
  withdrawalsCad: Dec;
  /** Room left now (or at year end): opening room - contributions; withdrawals come back next year. */
  roomRemainingCad: Dec | null;
  /** Withdrawals added back to room on January 1 of the next year (less any that removed an excess). */
  restoredNextYearCad: Dec;
  limitAssumed: boolean;
}

export interface RrspYear extends MonthlyExcess {
  plan: "rrsp";
  year: number;
  roomSource: RoomSource;
  /** Schedule 7 line 1: unused contributions from earlier years. */
  unusedFromPriorCad: Dec;
  /** Line 2: contributions from the day after last year's deadline to December 31. */
  periodOneCad: Dec;
  /** Line 3: contributions from January 1 to the 60-day deadline of the next year. */
  periodTwoCad: Dec;
  /** RRSP withdrawals in the calendar year (taxable income; TaxBack does not compute it). */
  withdrawalsCad: Dec;
  /** Line 11: the deduction limit. Null when TaxBack has nothing to base it on. */
  deductionLimitCad: Dec | null;
  /** The most that can be deducted: whichever is less of the limit and the contributions available. */
  maxDeductionCad: Dec | null;
  /** Line 20 and line 20800. */
  deductionCad: Dec | null;
  /** Line 23: unused contributions to carry forward. */
  carryForwardCad: Dec | null;
  /** The deduction limit left for next year's room: limit - deduction. */
  unusedRoomCad: Dec | null;
  /** The last day a contribution counts for this year. */
  deadline: string;
  limitAssumed: boolean;
}

export interface FhsaYear extends MonthlyExcess {
  plan: "fhsa";
  year: number;
  roomSource: RoomSource;
  /** The year the first FHSA was opened (Schedule 15 line 68930). */
  firstYear: boolean;
  /** Participation room: $8,000 plus the carryforward, within the lifetime limit. */
  participationRoomCad: Dec;
  carryforwardInCad: Dec;
  /** Schedule 15 line 68935. */
  contributionsCad: Dec;
  /** Line 68950: transfers from an RRSP. */
  rrspTransfersCad: Dec;
  withdrawalsCad: Dec;
  /** The annual FHSA limit: the contributions that fit in the room, after RRSP transfers. */
  annualLimitCad: Dec;
  /** The most that can be deducted this year. */
  maxDeductionCad: Dec;
  /** Unused contributions from earlier years. */
  unusedFromPriorCad: Dec;
  /** Line 20805. */
  deductionCad: Dec;
  /** Unused contributions to carry forward. */
  carryForwardCad: Dec;
  /** Participation room left this year. */
  roomRemainingCad: Dec;
  lifetimeUsedCad: Dec;
}

/** Plans without room tracking (RESP, RRIF, LIRA, U.S. retirement): totals only. */
export interface OtherPlanYear {
  plan: Exclude<Plan, RoomPlan>;
  year: number;
  contributionsCad: Dec;
  withdrawalsCad: Dec;
}

export type PlanYear = TfsaYear | RrspYear | FhsaYear | OtherPlanYear;

export interface ContributionsResult {
  flows: ClassifiedFlow[];
  years: PlanYear[];
}
