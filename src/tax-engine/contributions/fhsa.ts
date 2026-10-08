import {
  FHSA_ANNUAL_LIMIT,
  FHSA_FIRST_YEAR,
  FHSA_LIFETIME_LIMIT,
  FHSA_MAX_CARRYFORWARD,
} from "../config/contribution-limits";
import { D, ZERO, type Dec } from "../decimal";
import { monthlyExcess, type ExcessPoint } from "./excess";
import type { ClassifiedFlow, ContributionYearInput, FhsaYear } from "./types";

export interface FhsaInput {
  flows: readonly (ClassifiedFlow & { date: string })[];
  inputs: readonly ContributionYearInput[];
  openedYear: number;
  lastYear: number;
  asOfDate: string;
}

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const sum = (values: readonly Dec[]) => values.reduce((total, v) => total.plus(v), ZERO);

/**
 * Schedule 15, year by year, from the year the first FHSA was opened.
 *
 * Participation room is $8,000 plus the unused room carried from last year (at most $8,000), and the
 * annual limits plus RRSP transfers can never pass $40,000 for life. Transfers from an RRSP use room
 * first; the annual FHSA limit is the contributions that fit in what is left. Contributions above it
 * carry into next year's limit ("B" on the form) and are an excess taxed at 1% a month until room
 * catches up or they are withdrawn. A withdrawal is read as a designated withdrawal of that excess;
 * qualifying withdrawals for a home purchase are not modelled.
 *
 * The deduction is at most the annual limits to date less past deductions, and the lifetime limit less
 * past deductions and RRSP transfers. Undeducted contributions carry forward.
 */
export function fhsaYears(input: FhsaInput): FhsaYear[] {
  const byYear = new Map(input.inputs.filter((i) => i.plan === "fhsa").map((i) => [i.year, i]));
  const opened = Math.max(input.openedYear, FHSA_FIRST_YEAR);
  const out: FhsaYear[] = [];

  let carryforward = ZERO;
  let lifetimeUsed = ZERO;
  let limitsToDate = ZERO;
  let deductionsToDate = ZERO;
  let transfersToDate = ZERO;
  let unusedContributions = ZERO;
  let carriedExcess = ZERO;

  for (let year = opened; year <= input.lastYear; year += 1) {
    const given = byYear.get(year);
    const official = given?.officialRoom ?? null;
    const room = official ?? D.max(D.min(FHSA_ANNUAL_LIMIT.plus(carryforward), FHSA_LIFETIME_LIMIT.minus(lifetimeUsed)), ZERO);
    const flows = input.flows.filter((f) => f.taxYear === year).sort(byDate);
    const contributions = sum(flows.filter((f) => f.kind === "contribution").map((f) => f.amountCad));
    const transfers = sum(flows.filter((f) => f.kind === "rrsp_to_fhsa").map((f) => f.amountCad));
    const withdrawals = sum(flows.filter((f) => f.kind === "withdrawal").map((f) => f.amountCad));

    // Running room and excess, for the monthly tax. Last year's excess counts as contributed on January 1.
    let roomLeft = room;
    let excess = ZERO;
    let excessRemoved = ZERO;
    const takeRoom = (amount: Dec) => {
      if (roomLeft.greaterThanOrEqualTo(amount)) {
        roomLeft = roomLeft.minus(amount);
      } else {
        excess = excess.plus(amount.minus(roomLeft));
        roomLeft = ZERO;
      }
    };
    takeRoom(carriedExcess);
    const startExcess = excess;
    const points: ExcessPoint[] = [];
    for (const f of flows) {
      if (f.kind === "contribution" || f.kind === "rrsp_to_fhsa") takeRoom(f.amountCad);
      else if (f.kind === "withdrawal") {
        const removed = D.min(f.amountCad, excess);
        excess = excess.minus(removed);
        excessRemoved = excessRemoved.plus(removed);
      } else continue;
      points.push({ date: f.date, excessCad: excess });
    }

    const counted = D.max(contributions.plus(carriedExcess).minus(excessRemoved), ZERO);
    const annualLimit = D.min(counted, D.max(room.minus(transfers), ZERO));
    const maxDeduction = D.max(
      D.min(
        limitsToDate.plus(annualLimit).minus(deductionsToDate),
        FHSA_LIFETIME_LIMIT.minus(deductionsToDate).minus(transfersToDate).minus(transfers),
      ),
      ZERO,
    );
    const unusedFromPrior = given?.unusedCarriedForward ?? unusedContributions;
    const pool = D.max(unusedFromPrior.plus(contributions).minus(excessRemoved), ZERO);
    const claimed = given?.deductionClaimed ?? maxDeduction;
    const deduction = D.max(D.min(claimed, maxDeduction, pool), ZERO);
    const roomRemaining = D.max(room.minus(transfers).minus(annualLimit), ZERO);

    out.push({
      plan: "fhsa",
      year,
      roomSource: official === null ? "estimate" : "cra",
      firstYear: year === opened,
      participationRoomCad: room,
      carryforwardInCad: official === null ? carryforward : D.max(official.minus(FHSA_ANNUAL_LIMIT), ZERO),
      contributionsCad: contributions,
      rrspTransfersCad: transfers,
      withdrawalsCad: withdrawals,
      annualLimitCad: annualLimit,
      maxDeductionCad: maxDeduction,
      unusedFromPriorCad: unusedFromPrior,
      deductionCad: deduction,
      carryForwardCad: pool.minus(deduction),
      roomRemainingCad: roomRemaining,
      lifetimeUsedCad: lifetimeUsed.plus(annualLimit).plus(transfers),
      ...monthlyExcess(year, startExcess, points, input.asOfDate),
    });

    carryforward = D.min(roomRemaining, FHSA_MAX_CARRYFORWARD);
    lifetimeUsed = lifetimeUsed.plus(annualLimit).plus(transfers);
    limitsToDate = limitsToDate.plus(annualLimit);
    deductionsToDate = deductionsToDate.plus(deduction);
    transfersToDate = transfersToDate.plus(transfers);
    unusedContributions = pool.minus(deduction);
    carriedExcess = D.max(counted.minus(annualLimit), ZERO);
  }
  return out;
}
