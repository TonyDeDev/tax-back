import { yearOf } from "../dates";
import { ZERO } from "../decimal";
import { classifyFlows } from "./classify";
import { fhsaYears } from "./fhsa";
import { rrspYears } from "./rrsp";
import { tfsaYears } from "./tfsa";
import type { ContributionsInput, ContributionsResult, OtherPlanYear, Plan, PlanYear } from "./types";

export * from "./types";
export { contributionLines, type ContributionLines, type ContributionLinesInput } from "./forms";
export { tfsaStartYear } from "./tfsa";

const OTHER_PLANS = ["resp", "rrif", "lira", "us_retirement"] as const;

/**
 * Contributions, withdrawals, and room for every registered plan, from the first year with activity
 * (or a CRA figure) up to the year of `asOfDate`. Pure: the caller supplies FX rates and today's date.
 */
export function computeContributions(input: ContributionsInput): ContributionsResult {
  const classified = classifyFlows(input.flows, input.fx);
  const date = new Map(input.flows.map((f) => [f.id, f.date]));
  const dated = classified.map((c) => ({ ...c, date: date.get(c.flowId)! }));
  const lastYear = yearOf(input.asOfDate);
  const held = new Set(input.plansHeld);

  const flowsOf = (plan: Plan) => dated.filter((f) => f.plan === plan && f.kind !== "ignored" && f.taxYear <= lastYear);
  const firstYear = (plan: Plan): number | null => {
    const years = [
      ...flowsOf(plan).map((f) => f.taxYear),
      ...input.inputs.filter((i) => i.plan === plan).map((i) => i.year),
    ];
    if (years.length > 0) return Math.min(...years);
    return held.has(plan) ? lastYear : null;
  };

  const years: PlanYear[] = [];

  const tfsaFirst = firstYear("tfsa");
  if (tfsaFirst !== null) {
    years.push(
      ...tfsaYears({
        flows: flowsOf("tfsa"),
        inputs: input.inputs,
        profile: input.profile,
        firstYear: tfsaFirst,
        lastYear,
        asOfDate: input.asOfDate,
        historyFrom: input.historyFrom.tfsa ?? null,
      }),
    );
  }

  const rrspFirst = firstYear("rrsp");
  if (rrspFirst !== null) {
    years.push(...rrspYears({ flows: flowsOf("rrsp"), inputs: input.inputs, firstYear: rrspFirst, lastYear, asOfDate: input.asOfDate }));
  }

  const fhsaFirst = input.profile.fhsaOpenedYear ?? firstYear("fhsa");
  if (fhsaFirst !== null && fhsaFirst <= lastYear) {
    years.push(...fhsaYears({ flows: flowsOf("fhsa"), inputs: input.inputs, openedYear: fhsaFirst, lastYear, asOfDate: input.asOfDate }));
  }

  for (const plan of OTHER_PLANS) {
    const flows = flowsOf(plan);
    const planYears = [...new Set(flows.map((f) => f.taxYear))].sort((a, b) => a - b);
    for (const year of planYears) {
      const inYear = flows.filter((f) => f.taxYear === year);
      const total = (kind: "contribution" | "withdrawal") =>
        inYear.filter((f) => f.kind === kind).reduce((t, f) => t.plus(f.amountCad), ZERO);
      years.push({ plan, year, contributionsCad: total("contribution"), withdrawalsCad: total("withdrawal") } satisfies OtherPlanYear);
    }
  }

  return { flows: classified, years };
}
