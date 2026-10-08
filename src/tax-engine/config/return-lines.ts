/*
 * Where each amount goes on the return, per tax year.
 *
 * Checked against CRA's published forms (the e-text of 5006-R, the T1, and 5000-S3, Schedule 3) for
 * 2019 to 2025. The T1 and Schedule 1 line numbers are the same in every one of those years:
 *
 * - 12000: taxable amount of dividends, eligible and other than eligible (after the gross-up)
 * - 12010: the part of 12000 that is other than eligible (non-eligible) dividends
 * - 12100: interest and other investment income, where foreign dividends go in CAD
 * - 12700: taxable capital gains, from Schedule 3
 * - 40425: federal dividend tax credit (Schedule 1 / Step 5)
 * - 40500: federal foreign tax credit, from Form T2209
 *
 * Schedule 3 reports shares and fund units on lines 13199 (proceeds) and 13200 (gain or loss),
 * except 2024, whose form splits dispositions into Period 1 (January 1 to June 24: lines 10689 and
 * 10690) and Period 2 (June 25 to December 31: lines 13199 and 13200).
 *
 * Verify each new year's forms before adding it; until then the latest verified year's numbers are
 * shown and labelled as such.
 */

export interface Schedule3Period {
  /** Inclusive ISO dates. */
  from: string;
  to: string;
  /** Null when the year has a single period. */
  label: string | null;
  proceedsLine: string;
  gainLine: string;
}

export interface ReturnLineConfig {
  year: number;
  /** The year whose forms the numbers come from. */
  formYear: number;
  /** False when `year` is not verified yet and `formYear`'s numbers are used. */
  verified: boolean;
  schedule3: Schedule3Period[];
}

export const T1_LINES = {
  dividends: "12000",
  nonEligibleDividends: "12010",
  investmentIncome: "12100",
  taxableCapitalGains: "12700",
  dividendTaxCredit: "40425",
  foreignTaxCredit: "40500",
} as const;

const FIRST_VERIFIED = 2019;
const LAST_VERIFIED = 2025;

function schedule3For(year: number): Schedule3Period[] {
  if (year === 2024) {
    return [
      { from: "2024-01-01", to: "2024-06-24", label: "Period 1 (January 1 to June 24)", proceedsLine: "10689", gainLine: "10690" },
      { from: "2024-06-25", to: "2024-12-31", label: "Period 2 (June 25 to December 31)", proceedsLine: "13199", gainLine: "13200" },
    ];
  }
  return [{ from: `${year}-01-01`, to: `${year}-12-31`, label: null, proceedsLine: "13199", gainLine: "13200" }];
}

export function returnLineConfig(year: number): ReturnLineConfig {
  const formYear = Math.min(Math.max(year, FIRST_VERIFIED), LAST_VERIFIED);
  // The periods follow the form; dates follow the year being filed.
  const schedule3 = schedule3For(formYear).map((p) =>
    formYear === year ? p : { ...p, from: `${year}${p.from.slice(4)}`, to: `${year}${p.to.slice(4)}` },
  );
  return { year, formYear, verified: formYear === year, schedule3 };
}
