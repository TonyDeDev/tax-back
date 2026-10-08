/*
 * Line numbers on Schedule 7 (RRSP, PRPP, and SPP contributions) and Schedule 15 (FHSA contributions),
 * checked against the e-text of CRA's 5000-S7 for 2019 to 2025 and 5000-S15 for 2023 to 2025.
 *
 * The numbered T1 lines are stable: 24500 (total RRSP contributions), 20800 (RRSP deduction),
 * 68930 (first FHSA opened), 68935 (FHSA contributions), 68950 (RRSP to FHSA transfers), and 20805
 * (FHSA deduction). The schedules' own step lines move between years:
 *
 * - Schedule 7 2019-2020: deduction on line 17, carry forward on line 18. 2021 on: lines 20 and 23.
 * - Schedule 15 changed every year since it was introduced in 2023.
 *
 * A year CRA has not published yet uses the latest verified year's numbers and is labelled as such.
 */

export interface Schedule7Lines {
  unusedFromPrior: string;
  periodOne: string;
  periodTwo: string;
  total: string;
  deductionLimit: string;
  deduction: string;
  carryForward: string;
}

export interface Schedule15Lines {
  contributions: string;
  /** Null on the first year's form, which has no carryforward. */
  carryforward: string | null;
  rrspTransfers: string;
  annualLimit: string;
  maxDeduction: string;
  /** Null on the first year's form, which has no earlier contributions. */
  unusedFromPrior: string | null;
  deduction: string;
  carryForward: string;
}

export interface FormConfig<T> {
  year: number;
  formYear: number;
  verified: boolean;
  lines: T;
}

export const CONTRIBUTION_T1_LINES = {
  rrspContributions: "24500",
  rrspDeduction: "20800",
  fhsaOpened: "68930",
  fhsaContributions: "68935",
  fhsaRrspTransfers: "68950",
  fhsaDeduction: "20805",
} as const;

const S7_FIRST = 2019;
const S7_LAST = 2025;
const S15_FIRST = 2023;
const S15_LAST = 2025;

const S7_EARLY: Schedule7Lines = {
  unusedFromPrior: "1",
  periodOne: "2",
  periodTwo: "3",
  total: "4",
  deductionLimit: "11",
  deduction: "17",
  carryForward: "18",
};
const S7_CURRENT: Schedule7Lines = { ...S7_EARLY, deduction: "20", carryForward: "23" };

const S15: Readonly<Record<number, Schedule15Lines>> = {
  2023: {
    contributions: "1",
    carryforward: null,
    rrspTransfers: "7",
    annualLimit: "11",
    maxDeduction: "18",
    unusedFromPrior: null,
    deduction: "20",
    carryForward: "21",
  },
  2024: {
    contributions: "1",
    carryforward: "15",
    rrspTransfers: "18",
    annualLimit: "33",
    maxDeduction: "44",
    unusedFromPrior: "45",
    deduction: "50",
    carryForward: "51",
  },
  2025: {
    contributions: "1",
    carryforward: "15",
    rrspTransfers: "18",
    annualLimit: "40",
    maxDeduction: "51",
    unusedFromPrior: "52",
    deduction: "57",
    carryForward: "58",
  },
};

export function schedule7Config(year: number): FormConfig<Schedule7Lines> {
  const formYear = Math.min(Math.max(year, S7_FIRST), S7_LAST);
  return { year, formYear, verified: formYear === year, lines: formYear <= 2020 ? S7_EARLY : S7_CURRENT };
}

export function schedule15Config(year: number): FormConfig<Schedule15Lines> {
  const formYear = Math.min(Math.max(year, S15_FIRST), S15_LAST);
  return { year, formYear, verified: formYear === year, lines: S15[formYear]! };
}
