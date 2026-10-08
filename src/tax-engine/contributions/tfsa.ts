import { TFSA_ADULT_AGE, TFSA_FIRST_YEAR, tfsaLimit } from "../config/contribution-limits";
import { D, ZERO, type Dec } from "../decimal";
import { monthlyExcess, type ExcessPoint } from "./excess";
import type { ClassifiedFlow, ContributionProfile, ContributionYearInput, RoomSource, TfsaYear } from "./types";

export interface TfsaInput {
  /** Classified TFSA flows with their dates, in any order. */
  flows: readonly (ClassifiedFlow & { date: string })[];
  inputs: readonly ContributionYearInput[];
  profile: ContributionProfile;
  firstYear: number;
  lastYear: number;
  asOfDate: string;
  historyFrom: string | null;
}

/** The first year TFSA room accrues: 2009, the year the holder turns 18, or the year they became a resident. */
export function tfsaStartYear(profile: ContributionProfile): number | null {
  if (profile.birthYear === null) return null;
  return Math.max(TFSA_FIRST_YEAR, profile.birthYear + TFSA_ADULT_AGE, profile.residentSinceYear ?? TFSA_FIRST_YEAR);
}

/**
 * TFSA room, year by year. Room on January 1 = last year's room - last year's contributions + last
 * year's withdrawals + this year's limit. A withdrawal never frees room in the same year, and an excess
 * left at year end eats into the next year's new room. A CRA figure for a year restarts the chain there.
 */
export function tfsaYears(input: TfsaInput): TfsaYear[] {
  const official = new Map(input.inputs.filter((i) => i.plan === "tfsa").map((i) => [i.year, i.officialRoom]));
  const start = tfsaStartYear(input.profile);
  const from = Math.min(input.firstYear, start ?? input.firstYear);
  const out: TfsaYear[] = [];

  // Room on January 1 of `year`, and the year the chain it comes from began.
  let opening: Dec | null = null;
  let source: RoomSource = "unknown";
  let baseYear: number | null = null;

  for (let year = from; year <= input.lastYear; year += 1) {
    const cra = official.get(year) ?? null;
    if (cra !== null) {
      opening = cra;
      source = "cra";
      baseYear = year;
    } else if (opening === null && year === start) {
      opening = tfsaLimit(year).amount;
      source = "estimate";
      baseYear = year;
    } else if (opening !== null) {
      source = "estimate";
    }

    const flows = input.flows
      .filter((f) => f.taxYear === year && (f.kind === "contribution" || f.kind === "withdrawal"))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let contributions = ZERO;
    let withdrawals = ZERO;
    let restored = ZERO;
    let roomLeft: Dec = opening === null ? ZERO : D.max(opening, ZERO);
    let excess: Dec = opening === null ? ZERO : D.max(opening.neg(), ZERO);
    const startExcess = excess;
    const points: ExcessPoint[] = [];
    for (const f of flows) {
      if (f.kind === "contribution") {
        contributions = contributions.plus(f.amountCad);
        if (roomLeft.greaterThanOrEqualTo(f.amountCad)) {
          roomLeft = roomLeft.minus(f.amountCad);
        } else {
          excess = excess.plus(f.amountCad.minus(roomLeft));
          roomLeft = ZERO;
        }
      } else {
        withdrawals = withdrawals.plus(f.amountCad);
        // The part of a withdrawal that removes an excess does not come back as room next year.
        const removed = D.min(f.amountCad, excess);
        excess = excess.minus(removed);
        restored = restored.plus(f.amountCad.minus(removed));
      }
      points.push({ date: f.date, excessCad: excess });
    }

    const known: boolean = opening !== null;
    if (year >= input.firstYear) {
      const tax = known ? monthlyExcess(year, startExcess, points, input.asOfDate) : { peakExcessCad: ZERO, penaltyCad: ZERO };
      out.push({
        plan: "tfsa",
        year,
        roomSource: known ? source : "unknown",
        estimateIncomplete:
          known && source === "estimate" && (input.historyFrom === null || input.historyFrom > `${baseYear}-01-01`),
        openingRoomCad: opening,
        contributionsCad: contributions,
        withdrawalsCad: withdrawals,
        roomRemainingCad: known ? roomLeft.minus(excess) : null,
        restoredNextYearCad: restored,
        limitAssumed: tfsaLimit(year).assumed,
        ...tax,
      });
    }
    opening = known ? roomLeft.minus(excess).plus(restored).plus(tfsaLimit(year + 1).amount) : null;
  }
  return out;
}

