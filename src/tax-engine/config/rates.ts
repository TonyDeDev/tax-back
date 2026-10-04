import { D, type Dec } from "../decimal";

export interface DividendRates {
  /** Taxable amount = dividend * grossUp. */
  grossUp: Dec;
  /** Federal dividend tax credit as a share of the grossed-up amount. */
  federalCredit: Dec;
}

export interface YearConfig {
  year: number;
  /** True when the year is not in the table and the nearest year was used. */
  assumed: boolean;
  /** Share of a capital gain that is taxable. */
  inclusionRate: Dec;
  eligible: DividendRates;
  nonEligible: DividendRates;
}

const ELIGIBLE: DividendRates = { grossUp: new D("1.38"), federalCredit: new D("0.150198") };
const NON_ELIGIBLE: DividendRates = { grossUp: new D("1.15"), federalCredit: new D("0.090301") };

/** Rates in force since 2019 are unchanged through the supported range. Verify each new year against CRA before extending. */
const FIRST_YEAR = 2019;
const LAST_YEAR = 2026;

export function yearConfig(year: number): YearConfig {
  const clamped = Math.min(Math.max(year, FIRST_YEAR), LAST_YEAR);
  return {
    year,
    assumed: clamped !== year,
    inclusionRate: new D("0.5"),
    eligible: ELIGIBLE,
    nonEligible: NON_ELIGIBLE,
  };
}
