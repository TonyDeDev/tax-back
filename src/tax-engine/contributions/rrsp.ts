import {
  RRSP_EARNED_INCOME_RATE,
  RRSP_OVERCONTRIBUTION_BUFFER,
  rrspDeadline,
  rrspDollarLimit,
} from "../config/contribution-limits";
import { yearOf } from "../dates";
import { D, ZERO, type Dec } from "../decimal";
import { monthlyExcess, type ExcessPoint } from "./excess";
import type { ClassifiedFlow, ContributionYearInput, RoomSource, RrspYear } from "./types";

export interface RrspInput {
  flows: readonly (ClassifiedFlow & { date: string })[];
  inputs: readonly ContributionYearInput[];
  firstYear: number;
  lastYear: number;
  asOfDate: string;
}

const sum = (values: readonly Dec[]) => values.reduce((total, v) => total.plus(v), ZERO);

/**
 * Schedule 7, year by year. Contributions count for the year whose 60-day deadline they beat.
 *
 * The deduction limit is the CRA figure when the user entered one. Otherwise it is estimated from the
 * year before: unused room (last year's limit - last year's deduction) + 18% of last year's earned
 * income, up to the dollar limit, - the pension adjustment. Without a starting point it is unknown,
 * since a guess at the unused room would be a wrong number.
 *
 * The excess is the undeducted contributions above the limit plus the $2,000 buffer, taxed at 1% a
 * month. Contributions made in the first 60 days count from January 1, which can overstate January
 * and February slightly.
 */
export function rrspYears(input: RrspInput): RrspYear[] {
  const byYear = new Map(input.inputs.filter((i) => i.plan === "rrsp").map((i) => [i.year, i]));
  const out: RrspYear[] = [];

  let unusedRoom: Dec | null = null;
  let carry: Dec | null = null;

  for (let year = input.firstYear; year <= input.lastYear; year += 1) {
    const given = byYear.get(year);
    const deadline = rrspDeadline(year);
    const contributions = input.flows.filter((f) => f.kind === "contribution" && f.taxYear === year);
    const periodOne = sum(contributions.filter((f) => yearOf(f.date) === year).map((f) => f.amountCad));
    const periodTwo = sum(contributions.filter((f) => yearOf(f.date) > year).map((f) => f.amountCad));
    const withdrawals = sum(
      input.flows.filter((f) => f.kind === "withdrawal" && yearOf(f.date) === year).map((f) => f.amountCad),
    );
    const unusedFromPrior: Dec = given?.unusedCarriedForward ?? carry ?? ZERO;
    const available: Dec = unusedFromPrior.plus(periodOne).plus(periodTwo);

    let limit: Dec | null = null;
    let source: RoomSource = "unknown";
    if (given?.officialRoom) {
      limit = given.officialRoom;
      source = "cra";
    } else if (unusedRoom !== null && given?.earnedIncomePriorYear) {
      const earned = D.min(given.earnedIncomePriorYear.times(RRSP_EARNED_INCOME_RATE), rrspDollarLimit(year).amount);
      limit = D.max(unusedRoom.plus(earned).minus(given.pensionAdjustment ?? ZERO), ZERO);
      source = "estimate";
    }

    const maxDeduction: Dec | null = limit === null ? null : D.min(limit, available);
    const claimed = given?.deductionClaimed ?? null;
    let deduction: Dec | null;
    if (maxDeduction !== null) deduction = claimed === null ? maxDeduction : D.min(claimed, maxDeduction);
    else deduction = claimed === null ? null : D.min(claimed, available);
    const carryForward: Dec | null = deduction === null ? null : available.minus(deduction);

    let tax = { peakExcessCad: ZERO, penaltyCad: ZERO };
    if (limit !== null) {
      const threshold = limit.plus(RRSP_OVERCONTRIBUTION_BUFFER);
      const excessOf = (undeducted: Dec) => D.max(undeducted.minus(threshold), ZERO);
      let undeducted = unusedFromPrior;
      const points: ExcessPoint[] = [];
      for (const f of [...contributions].sort((a, b) => (a.date < b.date ? -1 : 1))) {
        if (yearOf(f.date) !== year) continue;
        undeducted = undeducted.plus(f.amountCad);
        points.push({ date: f.date, excessCad: excessOf(undeducted) });
      }
      tax = monthlyExcess(year, excessOf(unusedFromPrior), points, input.asOfDate);
    }

    out.push({
      plan: "rrsp",
      year,
      roomSource: source,
      unusedFromPriorCad: unusedFromPrior,
      periodOneCad: periodOne,
      periodTwoCad: periodTwo,
      withdrawalsCad: withdrawals,
      deductionLimitCad: limit,
      maxDeductionCad: maxDeduction,
      deductionCad: deduction,
      carryForwardCad: carryForward,
      unusedRoomCad: limit === null || deduction === null ? null : limit.minus(deduction),
      deadline,
      limitAssumed: rrspDollarLimit(year).assumed,
      ...tax,
    });

    unusedRoom = limit === null || deduction === null ? null : limit.minus(deduction);
    // With no known deduction nothing was claimed, so every contribution stays available.
    carry = carryForward ?? available;
  }
  return out;
}
