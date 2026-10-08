import "server-only";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { D, contributionLines, type ContributionLines, type Plan, type RoomPlan } from "@/tax-engine";
import { yearOf } from "@/tax-engine/dates";

/*
 * Read queries for the Contributions page and the Tax Center's Schedule 7 and Schedule 15 lines. Every
 * number comes from the derived tables the recompute wrote; amounts stay decimal strings.
 */

export type PlanSummary = typeof s.contributionSummaries.$inferSelect;

export interface ContributionInputsView {
  officialRoom: string;
  unusedCarriedForward: string;
  earnedIncomePriorYear: string;
  pensionAdjustment: string;
  deductionClaimed: string;
}

export interface FlowView {
  id: string;
  source: "snaptrade" | "manual";
  date: string;
  /** Null for a manual entry with no connected account. */
  accountName: string | null;
  plan: Plan;
  brokerType: string | null;
  direction: "in" | "out";
  amount: string;
  currency: string;
  amountCad: string;
  description: string | null;
  kind: (typeof s.FLOW_KINDS)[number];
  /** The user's override; null when TaxBack's own reading applies. */
  classification: (typeof s.FLOW_CLASSIFICATIONS)[number] | null;
  needsReview: boolean;
  /** The tax year it counts for, which differs from the date's year for RRSP contributions in the first 60 days. */
  taxYear: number;
}

export interface ContributionProfileView {
  birthYear: string;
  residentSinceYear: string;
  fhsaOpenedYear: string;
}

export interface ContributionsView {
  year: number;
  isCurrentYear: boolean;
  /** One row per plan with activity or a CRA figure this year, room plans first. */
  summaries: PlanSummary[];
  inputs: Record<RoomPlan, ContributionInputsView>;
  profile: ContributionProfileView;
  /** Flows that count for this year. */
  flows: FlowView[];
  /** Registered plan types the user holds, from confirmed or guessed account types. */
  plansHeld: Plan[];
}

const PLAN_ORDER: readonly Plan[] = ["tfsa", "rrsp", "fhsa", "resp", "rrif", "lira", "us_retirement"];
const blank = (v: string | null) => (v === null ? "" : new D(v).toFixed(2));

/** Years with contribution results, newest first, always including the year in progress. */
export async function getContributionYears(db: AnyDb, userId: string, today: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: s.contributionSummaries.taxYear })
    .from(s.contributionSummaries)
    .where(eq(s.contributionSummaries.userId, userId));
  const years = new Set(rows.map((r) => r.year));
  years.add(yearOf(today));
  return [...years].sort((a, b) => b - a);
}

export async function getContributions(db: AnyDb, userId: string, year: number, today: string): Promise<ContributionsView> {
  const [summaries, inputs, [profile], flows, accounts] = await Promise.all([
    db
      .select()
      .from(s.contributionSummaries)
      .where(and(eq(s.contributionSummaries.userId, userId), eq(s.contributionSummaries.taxYear, year))),
    db
      .select()
      .from(s.contributionInputs)
      .where(and(eq(s.contributionInputs.userId, userId), eq(s.contributionInputs.taxYear, year))),
    db
      .select({
        birthYear: s.userProfiles.birthYear,
        residentSinceYear: s.userProfiles.residentSinceYear,
        fhsaOpenedYear: s.userProfiles.fhsaOpenedYear,
      })
      .from(s.userProfiles)
      .where(eq(s.userProfiles.userId, userId)),
    db
      .select({
        id: s.contributionFlows.id,
        source: s.contributionFlows.source,
        date: s.contributionFlows.flowDate,
        accountName: s.brokerageAccounts.name,
        plan: s.contributionFlowResults.plan,
        brokerType: s.contributionFlows.brokerType,
        direction: s.contributionFlows.direction,
        amount: s.contributionFlows.amount,
        currency: s.contributionFlows.currency,
        amountCad: s.contributionFlowResults.amountCad,
        description: s.contributionFlows.description,
        kind: s.contributionFlowResults.kind,
        classification: s.contributionFlows.classification,
        needsReview: s.contributionFlowResults.needsReview,
        taxYear: s.contributionFlowResults.taxYear,
      })
      .from(s.contributionFlowResults)
      .innerJoin(
        s.contributionFlows,
        and(eq(s.contributionFlows.id, s.contributionFlowResults.flowId), eq(s.contributionFlows.userId, userId)),
      )
      .leftJoin(
        s.brokerageAccounts,
        and(eq(s.brokerageAccounts.id, s.contributionFlows.accountId), eq(s.brokerageAccounts.userId, userId)),
      )
      .where(
        and(
          eq(s.contributionFlowResults.userId, userId),
          eq(s.contributionFlowResults.taxYear, year),
          // Cash in and out of non-registered accounts is not a contribution to anything.
          or(isNotNull(s.contributionFlowResults.plan), eq(s.contributionFlows.source, "manual")),
        ),
      )
      .orderBy(asc(s.contributionFlows.flowDate), asc(s.contributionFlows.id)),
    db
      .select({ accountType: s.brokerageAccounts.accountType })
      .from(s.brokerageAccounts)
      .where(and(eq(s.brokerageAccounts.userId, userId), eq(s.brokerageAccounts.kind, "investment"))),
  ]);

  const inputsFor = (plan: RoomPlan): ContributionInputsView => {
    const row = inputs.find((i) => i.plan === plan);
    return {
      officialRoom: blank(row?.officialRoomCad ?? null),
      unusedCarriedForward: blank(row?.unusedCarriedForwardCad ?? null),
      earnedIncomePriorYear: blank(row?.earnedIncomePriorYearCad ?? null),
      pensionAdjustment: blank(row?.pensionAdjustmentCad ?? null),
      deductionClaimed: blank(row?.deductionClaimedCad ?? null),
    };
  };

  const plansHeld = PLAN_ORDER.filter((p) => accounts.some((a) => a.accountType === p));
  return {
    year,
    isCurrentYear: year === yearOf(today),
    summaries: summaries.sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan)),
    inputs: { tfsa: inputsFor("tfsa"), rrsp: inputsFor("rrsp"), fhsa: inputsFor("fhsa") },
    profile: {
      birthYear: profile?.birthYear?.toString() ?? "",
      residentSinceYear: profile?.residentSinceYear?.toString() ?? "",
      fhsaOpenedYear: profile?.fhsaOpenedYear?.toString() ?? "",
    },
    // A manual flow always has a plan; a synced one in a non-registered account was filtered out above.
    flows: flows.map((f) => ({ ...f, plan: f.plan! })),
    plansHeld,
  };
}

/** The Tax Center's view of contributions for one year: Schedule 7 and 15 lines, the TFSA check, and what to look at first. */
export interface ContributionReturnView extends ContributionLines {
  tfsa: Pick<PlanSummary, "roomSource" | "roomRemainingCad" | "peakExcessCad" | "penaltyCad" | "estimateIncomplete"> | null;
  rrspLimitUnknown: boolean;
  flowsToReview: number;
}

const dec = (v: string | null) => (v === null ? null : new D(v));
const req = (v: string | null) => new D(v ?? 0);

export async function getContributionReturn(db: AnyDb, userId: string, year: number): Promise<ContributionReturnView> {
  const [summaries, review] = await Promise.all([
    db
      .select()
      .from(s.contributionSummaries)
      .where(and(eq(s.contributionSummaries.userId, userId), eq(s.contributionSummaries.taxYear, year))),
    db
      .select({ id: s.contributionFlowResults.flowId })
      .from(s.contributionFlowResults)
      .where(
        and(
          eq(s.contributionFlowResults.userId, userId),
          eq(s.contributionFlowResults.taxYear, year),
          eq(s.contributionFlowResults.needsReview, true),
        ),
      ),
  ]);
  const rrsp = summaries.find((x) => x.plan === "rrsp") ?? null;
  const fhsa = summaries.find((x) => x.plan === "fhsa") ?? null;
  const tfsa = summaries.find((x) => x.plan === "tfsa") ?? null;
  // A year with nothing to report on a schedule leaves it out, rather than listing a column of zeros.
  const rrspShown = rrsp && !(req(rrsp.contributionsCad).isZero() && req(rrsp.unusedFromPriorCad).isZero());
  const fhsaShown =
    fhsa && !(req(fhsa.contributionsCad).isZero() && req(fhsa.rrspTransfersCad).isZero() && req(fhsa.unusedFromPriorCad).isZero() && !fhsa.firstYear);

  const lines = contributionLines({
    year,
    rrsp: rrspShown
      ? {
          roomSource: rrsp.roomSource ?? "unknown",
          unusedFromPriorCad: req(rrsp.unusedFromPriorCad),
          periodOneCad: req(rrsp.periodOneCad),
          periodTwoCad: req(rrsp.periodTwoCad),
          deductionLimitCad: dec(rrsp.deductionLimitCad),
          deductionCad: dec(rrsp.deductionCad),
          carryForwardCad: dec(rrsp.carryForwardCad),
        }
      : null,
    fhsa: fhsaShown
      ? {
          firstYear: fhsa.firstYear,
          contributionsCad: req(fhsa.contributionsCad),
          carryforwardInCad: req(fhsa.carryforwardInCad),
          rrspTransfersCad: req(fhsa.rrspTransfersCad),
          annualLimitCad: req(fhsa.annualLimitCad),
          maxDeductionCad: req(fhsa.maxDeductionCad),
          unusedFromPriorCad: req(fhsa.unusedFromPriorCad),
          deductionCad: req(fhsa.deductionCad),
          carryForwardCad: req(fhsa.carryForwardCad),
        }
      : null,
  });

  return {
    ...lines,
    tfsa: tfsa && {
      roomSource: tfsa.roomSource,
      roomRemainingCad: tfsa.roomRemainingCad,
      peakExcessCad: tfsa.peakExcessCad,
      penaltyCad: tfsa.penaltyCad,
      estimateIncomplete: tfsa.estimateIncomplete,
    },
    rrspLimitUnknown: !!rrspShown && rrsp.deductionLimitCad === null,
    flowsToReview: review.length,
  };
}

export interface ContributionAlert {
  plan: "tfsa" | "rrsp" | "fhsa";
  taxYear: number;
  peakExcessCad: string;
  penaltyCad: string;
}

/** Plans over their room in `year`: the Hub lists each one, since the 1% a month keeps adding up until it is fixed. */
export async function getContributionAlerts(db: AnyDb, userId: string, year: number): Promise<ContributionAlert[]> {
  const rows = await db
    .select({
      plan: s.contributionSummaries.plan,
      taxYear: s.contributionSummaries.taxYear,
      peakExcessCad: s.contributionSummaries.peakExcessCad,
      penaltyCad: s.contributionSummaries.penaltyCad,
    })
    .from(s.contributionSummaries)
    .where(and(eq(s.contributionSummaries.userId, userId), eq(s.contributionSummaries.taxYear, year)));
  return rows.flatMap((r) =>
    (r.plan === "tfsa" || r.plan === "rrsp" || r.plan === "fhsa") && new D(r.peakExcessCad).gt(0) ? [{ ...r, plan: r.plan }] : [],
  );
}
