import { OVERCONTRIBUTION_MONTHLY_RATE } from "../config/contribution-limits";
import { yearOf } from "../dates";
import { ZERO, type Dec } from "../decimal";
import type { MonthlyExcess } from "./types";

/** The excess amount right after something changed it. */
export interface ExcessPoint {
  date: string;
  excessCad: Dec;
}

/**
 * The 1%-per-month tax on an excess: each month is taxed on its highest excess. `startCad` is the excess
 * on January 1 and `points` (in date order, all in `year`) are the excess after each change. Months
 * after `asOfDate` have not happened yet, so they are not taxed.
 */
export function monthlyExcess(year: number, startCad: Dec, points: readonly ExcessPoint[], asOfDate: string): MonthlyExcess {
  const asOfYear = yearOf(asOfDate);
  const lastMonth = year < asOfYear ? 12 : year === asOfYear ? Number(asOfDate.slice(5, 7)) : 0;
  let current = startCad;
  let peak = ZERO;
  let penalty = ZERO;
  for (let month = 1; month <= lastMonth; month += 1) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    let monthPeak = current;
    for (const p of points) {
      if (!p.date.startsWith(prefix)) continue;
      if (p.excessCad.greaterThan(monthPeak)) monthPeak = p.excessCad;
      current = p.excessCad;
    }
    if (monthPeak.greaterThan(peak)) peak = monthPeak;
    penalty = penalty.plus(monthPeak.times(OVERCONTRIBUTION_MONTHLY_RATE));
  }
  return { peakExcessCad: peak, penaltyCad: penalty };
}
