import { CONTRIBUTION_T1_LINES, schedule15Config, schedule7Config } from "../config/contribution-forms";
import { rrspDeadline } from "../config/contribution-limits";
import { addDays } from "../dates";
import type { Dec } from "../decimal";
import type { ReturnLine } from "../return-lines";
import type { FhsaYear, RrspYear } from "./types";

/*
 * The Schedule 7 and Schedule 15 amounts for one year, from saved results only, in the order the forms
 * ask for them. Each deduction also gets its T1 line, which is the number most people look for.
 */

export interface ContributionLinesInput {
  year: number;
  rrsp: Pick<
    RrspYear,
    "unusedFromPriorCad" | "periodOneCad" | "periodTwoCad" | "deductionLimitCad" | "deductionCad" | "carryForwardCad" | "roomSource"
  > | null;
  fhsa: Pick<
    FhsaYear,
    | "firstYear"
    | "contributionsCad"
    | "carryforwardInCad"
    | "rrspTransfersCad"
    | "annualLimitCad"
    | "maxDeductionCad"
    | "unusedFromPriorCad"
    | "deductionCad"
    | "carryForwardCad"
  > | null;
}

export interface ContributionLines {
  lines: ReturnLine[];
  /** Per schedule shown: the year whose form the line numbers come from, and whether that is the filing year. */
  forms: { form: "Schedule 7" | "Schedule 15"; formYear: number; verified: boolean }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "March 4, 2025": the way CRA writes dates on the schedules. */
function longDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

export function contributionLines({ year, rrsp, fhsa }: ContributionLinesInput): ContributionLines {
  const lines: ReturnLine[] = [];
  const forms: ContributionLines["forms"] = [];

  if (rrsp) {
    const c = schedule7Config(year);
    forms.push({ form: "Schedule 7", formYear: c.formYear, verified: c.verified });
    const l = c.lines;
    const s7 = (key: string, line: string, label: string, amountCad: Dec, note: string | null = null): ReturnLine => ({
      key: `s7-${key}`,
      form: "Schedule 7",
      line,
      label,
      amountCad,
      note,
    });
    const deadline = rrspDeadline(year);
    lines.push(
      s7("unused", l.unusedFromPrior, "Unused RRSP contributions from earlier years", rrsp.unusedFromPriorCad, "From your latest notice of assessment."),
      s7(
        "period-one",
        l.periodOne,
        `RRSP contributions from ${longDate(addDays(rrspDeadline(year - 1), 1))} to December 31, ${year}`,
        rrsp.periodOneCad,
      ),
      s7("period-two", l.periodTwo, `RRSP contributions from January 1 to ${longDate(deadline)}`, rrsp.periodTwoCad),
      s7(
        "total",
        l.total,
        "Total RRSP contributions",
        rrsp.periodOneCad.plus(rrsp.periodTwoCad),
        `Also line ${CONTRIBUTION_T1_LINES.rrspContributions}. Attach every receipt, including contributions you do not deduct.`,
      ),
    );
    if (rrsp.deductionLimitCad) {
      lines.push(
        s7(
          "limit",
          l.deductionLimit,
          `RRSP deduction limit for ${year}`,
          rrsp.deductionLimitCad,
          rrsp.roomSource === "cra" ? "The figure you entered from your notice of assessment." : "Estimated by TaxBack: use the figure on your notice of assessment.",
        ),
      );
    }
    if (rrsp.deductionCad && rrsp.carryForwardCad) {
      lines.push(
        s7("deduction", l.deduction, "RRSP deduction", rrsp.deductionCad),
        s7("carry", l.carryForward, "Unused contributions to carry forward to a future year", rrsp.carryForwardCad),
        {
          key: "t1-20800",
          form: "T1",
          line: CONTRIBUTION_T1_LINES.rrspDeduction,
          label: "RRSP deduction",
          amountCad: rrsp.deductionCad,
          note: "From Schedule 7.",
        },
      );
    }
  }

  if (fhsa) {
    const c = schedule15Config(year);
    forms.push({ form: "Schedule 15", formYear: c.formYear, verified: c.verified });
    const l = c.lines;
    const s15 = (key: string, line: string, label: string, amountCad: Dec, note: string | null = null): ReturnLine => ({
      key: `s15-${key}`,
      form: "Schedule 15",
      line,
      label,
      amountCad,
      note,
    });
    lines.push(
      s15(
        "contributions",
        l.contributions,
        "Total contributions to your FHSAs",
        fhsa.contributionsCad,
        `Also line ${CONTRIBUTION_T1_LINES.fhsaContributions} (box 18 of your T4FHSA slips).${fhsa.firstYear ? ` Tick box ${CONTRIBUTION_T1_LINES.fhsaOpened}: you opened your first FHSA this year.` : ""}`,
      ),
    );
    if (l.carryforward && !fhsa.firstYear) {
      lines.push(s15("carryforward", l.carryforward, "FHSA carryforward", fhsa.carryforwardInCad, "From your FHSA participation room statement."));
    }
    if (!fhsa.rrspTransfersCad.isZero()) {
      lines.push(
        s15(
          "rrsp-transfers",
          l.rrspTransfers,
          "Transfers from your RRSPs to your FHSAs",
          fhsa.rrspTransfersCad,
          `Also line ${CONTRIBUTION_T1_LINES.fhsaRrspTransfers}.`,
        ),
      );
    }
    lines.push(
      s15("annual-limit", l.annualLimit, `Annual FHSA limit for ${year}`, fhsa.annualLimitCad),
      s15("max-deduction", l.maxDeduction, "Maximum FHSA deduction available", fhsa.maxDeductionCad),
    );
    if (l.unusedFromPrior && !fhsa.firstYear) {
      lines.push(
        s15("unused", l.unusedFromPrior, "Unused FHSA contributions from earlier years", fhsa.unusedFromPriorCad, "From your FHSA participation room statement."),
      );
    }
    lines.push(
      s15("deduction", l.deduction, "FHSA deduction", fhsa.deductionCad),
      s15("carry", l.carryForward, "Unused FHSA contributions to deduct in future years", fhsa.carryForwardCad),
      {
        key: "t1-20805",
        form: "T1",
        line: CONTRIBUTION_T1_LINES.fhsaDeduction,
        label: "FHSA deduction",
        amountCad: fhsa.deductionCad,
        note: "From Schedule 15.",
      },
    );
  }

  return { lines, forms };
}
