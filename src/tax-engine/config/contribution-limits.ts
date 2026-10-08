import { addDays } from "../dates";
import { D, type Dec } from "../decimal";

/*
 * Contribution limits for registered plans, from CRA's "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE
 * and the YAMPE" table (canada.ca, checked 2026-10-08) and the FHSA rules (canada.ca/fhsa).
 *
 * Verify each new year against CRA before extending a table; a year outside it uses the nearest
 * year's figure and is flagged as assumed.
 */

/** TFSA dollar limit per year. Room accrues from 2009, or the year the holder turns 18 if later. */
const TFSA_LIMITS: Readonly<Record<number, string>> = {
  2009: "5000",
  2010: "5000",
  2011: "5000",
  2012: "5000",
  2013: "5500",
  2014: "5500",
  2015: "10000",
  2016: "5500",
  2017: "5500",
  2018: "5500",
  2019: "6000",
  2020: "6000",
  2021: "6000",
  2022: "6000",
  2023: "6500",
  2024: "7000",
  2025: "7000",
  2026: "7000",
};

/** RRSP dollar limit per year: the cap on the new room earned for that year. */
const RRSP_DOLLAR_LIMITS: Readonly<Record<number, string>> = {
  2009: "21000",
  2010: "22000",
  2011: "22450",
  2012: "22970",
  2013: "23820",
  2014: "24270",
  2015: "24930",
  2016: "25370",
  2017: "26010",
  2018: "26230",
  2019: "26500",
  2020: "27230",
  2021: "27830",
  2022: "29210",
  2023: "30780",
  2024: "31560",
  2025: "32490",
  2026: "33810",
  2027: "35390",
};

export const TFSA_FIRST_YEAR = 2009;
export const TFSA_ADULT_AGE = 18;

/** New RRSP room is 18% of the previous year's earned income, up to the dollar limit. */
export const RRSP_EARNED_INCOME_RATE = new D("0.18");
/** Cumulative excess RRSP contributions up to this amount are not taxed. */
export const RRSP_OVERCONTRIBUTION_BUFFER = new D(2000);

export const FHSA_FIRST_YEAR = 2023;
export const FHSA_ANNUAL_LIMIT = new D(8000);
/** Unused participation room carries forward, but never more than this. */
export const FHSA_MAX_CARRYFORWARD = new D(8000);
export const FHSA_LIFETIME_LIMIT = new D(40000);

/** TFSA, RRSP, and FHSA excess amounts are all taxed at 1% per month on the month's highest excess. */
export const OVERCONTRIBUTION_MONTHLY_RATE = new D("0.01");

export interface YearLimit {
  amount: Dec;
  /** True when `year` is outside the verified table and the nearest year's figure was used. */
  assumed: boolean;
}

function fromTable(table: Readonly<Record<number, string>>, year: number): YearLimit {
  const years = Object.keys(table).map(Number);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const clamped = Math.min(Math.max(year, first), last);
  return { amount: new D(table[clamped]!), assumed: clamped !== year };
}

export function tfsaLimit(year: number): YearLimit {
  if (year < TFSA_FIRST_YEAR) return { amount: new D(0), assumed: false };
  return fromTable(TFSA_LIMITS, year);
}

export function rrspDollarLimit(year: number): YearLimit {
  return fromTable(RRSP_DOLLAR_LIMITS, year);
}

/**
 * The last day a contribution counts for `year`'s RRSP deduction: the 60th day of the next year, moved
 * to the next Monday when it falls on a weekend. Matches CRA's Schedule 7 for 2019 to 2025 (for 2023,
 * February 29, 2024; for 2024, March 3, 2025; for 2025, March 2, 2026).
 */
export function rrspDeadline(year: number): string {
  const sixtieth = addDays(`${year + 1}-01-01`, 59);
  const weekday = new Date(`${sixtieth}T00:00:00Z`).getUTCDay();
  if (weekday === 6) return addDays(sixtieth, 2);
  if (weekday === 0) return addDays(sixtieth, 1);
  return sixtieth;
}

/** The Schedule 7 year an RRSP contribution made on `date` belongs to. */
export function rrspScheduleYear(date: string): number {
  const year = Number(date.slice(0, 4));
  return date <= rrspDeadline(year - 1) ? year - 1 : year;
}
