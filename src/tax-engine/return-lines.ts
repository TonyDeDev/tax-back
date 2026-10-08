import { returnLineConfig, T1_LINES } from "./config/return-lines";
import { ZERO, type Dec } from "./decimal";

/*
 * The amounts to enter on the return for one year, from saved results only: the year summary and the
 * realized gains. Nothing here recomputes tax; it sums by Schedule 3 period and maps totals to lines.
 */

export type ReturnForm = "Schedule 3" | "T1" | "Schedule 1" | "T2209" | "Schedule 7" | "Schedule 15";

export interface ReturnLine {
  key: string;
  form: ReturnForm;
  /** Null when the form has no line number for it. */
  line: string | null;
  label: string;
  amountCad: Dec;
  note: string | null;
}

export interface ReturnLines {
  year: number;
  formYear: number;
  verified: boolean;
  lines: ReturnLine[];
  /** The net capital loss to carry, when the year's gains are negative. */
  netCapitalLossCad: Dec | null;
}

export interface ReturnLinesInput {
  year: number;
  gains: readonly { date: string; proceedsCad: Dec; allowedGainCad: Dec }[];
  totals: {
    taxableCapitalGainCad: Dec;
    netCapitalGainCad: Dec;
    eligibleTaxableCad: Dec;
    nonEligibleTaxableCad: Dec;
    foreignIncomeCad: Dec;
    foreignWithholdingCad: Dec;
    federalDividendCreditCad: Dec;
  } | null;
}

const sum = (values: readonly Dec[]) => values.reduce((total, v) => total.plus(v), ZERO);

export function returnLines({ year, gains, totals }: ReturnLinesInput): ReturnLines {
  const config = returnLineConfig(year);
  const lines: ReturnLine[] = [];

  for (const period of config.schedule3) {
    const inPeriod = gains.filter((g) => g.date >= period.from && g.date <= period.to);
    if (inPeriod.length === 0) continue;
    const suffix = period.label ? `, ${period.label}` : "";
    lines.push(
      {
        key: `s3-proceeds-${period.proceedsLine}`,
        form: "Schedule 3",
        line: period.proceedsLine,
        label: `Publicly traded shares and fund units: total proceeds of disposition${suffix}`,
        amountCad: sum(inPeriod.map((g) => g.proceedsCad)),
        note: null,
      },
      {
        key: `s3-gain-${period.gainLine}`,
        form: "Schedule 3",
        line: period.gainLine,
        label: `Publicly traded shares and fund units: total gain or loss${suffix}`,
        amountCad: sum(inPeriod.map((g) => g.allowedGainCad)),
        note: "Superficial losses are already left out. Each sale is listed under Realized gains below.",
      },
    );
  }

  const taxable = totals?.taxableCapitalGainCad ?? ZERO;
  const netLoss = totals && totals.netCapitalGainCad.isNegative() ? totals.netCapitalGainCad.neg() : null;
  lines.push({
    key: "t1-12700",
    form: "T1",
    line: T1_LINES.taxableCapitalGains,
    label: "Taxable capital gains",
    amountCad: taxable.isNegative() ? ZERO : taxable,
    note: "Add capital gains from your T3 and T5 slips (Schedule 3 lines 17400 and 17600), which TaxBack does not see.",
  });

  if (totals) {
    const dividends = totals.eligibleTaxableCad.plus(totals.nonEligibleTaxableCad);
    const optional: ReturnLine[] = [
      {
        key: "t1-12000",
        form: "T1",
        line: T1_LINES.dividends,
        label: "Taxable amount of dividends from Canadian corporations (eligible and other than eligible)",
        amountCad: dividends,
        note: "The grossed-up amount, not the cash received.",
      },
      {
        key: "t1-12010",
        form: "T1",
        line: T1_LINES.nonEligibleDividends,
        label: "Taxable amount of dividends other than eligible dividends (included in line 12000)",
        amountCad: totals.nonEligibleTaxableCad,
        note: null,
      },
      {
        key: "t1-12100",
        form: "T1",
        line: T1_LINES.investmentIncome,
        label: "Interest and other investment income: foreign dividends in CAD",
        amountCad: totals.foreignIncomeCad,
        note: "Before withholding tax. Add any interest income, which TaxBack does not track.",
      },
      {
        key: "s1-40425",
        form: "Schedule 1",
        line: T1_LINES.dividendTaxCredit,
        label: "Federal dividend tax credit",
        amountCad: totals.federalDividendCreditCad,
        note: null,
      },
      {
        key: "t2209-tax-paid",
        form: "T2209",
        line: null,
        label: `Non-business income tax paid to a foreign country (Form T2209, which gives the credit on line ${T1_LINES.foreignTaxCredit})`,
        amountCad: totals.foreignWithholdingCad,
        note: null,
      },
    ];
    lines.push(...optional.filter((l) => !l.amountCad.isZero()));
  }

  return { year, formYear: config.formYear, verified: config.verified, lines, netCapitalLossCad: netLoss };
}
