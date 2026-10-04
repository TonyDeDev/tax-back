import type { YearConfig } from "./config/rates";
import { ZERO, type Dec } from "./decimal";
import { estimateCapitalGainsTax } from "./estimate";
import type { IncomeEvent, RealizedGain, YearSummary } from "./types";

/** One summary per tax year that has any gain or income, oldest first. Capital gains count in the settlement year. */
export function summarizeYears(
  gains: readonly RealizedGain[],
  income: readonly IncomeEvent[],
  configFor: (year: number) => YearConfig,
  marginalRate?: Dec | null,
): YearSummary[] {
  const years = new Set<number>([...gains.map((g) => g.year), ...income.map((i) => i.year)]);
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const config = configFor(year);
      const yearGains = gains.filter((g) => g.year === year);
      const yearIncome = income.filter((i) => i.year === year);
      const sum = <T>(items: readonly T[], pick: (item: T) => Dec): Dec =>
        items.reduce((total, item) => total.plus(pick(item)), ZERO);
      const sumClass = (cls: IncomeEvent["dividendClass"]): Dec =>
        sum(
          yearIncome.filter((i) => i.dividendClass === cls),
          (i) => i.amountCad,
        );
      const net = sum(yearGains, (g) => g.allowedGainCad);
      const taxable = net.times(config.inclusionRate);
      return {
        year,
        proceedsCad: sum(yearGains, (g) => g.proceedsCad),
        acbCad: sum(yearGains, (g) => g.acbCad),
        feesCad: sum(yearGains, (g) => g.feesCad),
        netCapitalGainCad: net,
        deniedLossesCad: sum(yearGains, (g) => g.deniedLossCad),
        inclusionRate: config.inclusionRate,
        taxableCapitalGainCad: taxable,
        eligibleDividendsCad: sumClass("eligible"),
        nonEligibleDividendsCad: sumClass("non_eligible"),
        foreignIncomeCad: sumClass("foreign"),
        foreignWithholdingCad: sum(yearIncome, (i) => i.withholdingCad),
        federalDividendCreditCad: sum(yearIncome, (i) => i.federalCreditCad),
        estimatedTaxCad: estimateCapitalGainsTax(taxable, marginalRate),
      };
    });
}
