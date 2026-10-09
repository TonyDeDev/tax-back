import type { Metadata } from "next";
import { FileText, Info, PiggyBank, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AddFlowForm } from "@/components/contributions/add-flow-form";
import { FlowList } from "@/components/contributions/flow-list";
import { ContributionInputsForm } from "@/components/contributions/inputs-form";
import { ContributionProfileForm } from "@/components/contributions/profile-form";
import { RoomMeter } from "@/components/contributions/room-meter";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { YearNav } from "@/components/year-nav";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { ROOM_SOURCE_LABELS } from "@/lib/contribution-labels";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ensureDemoSeeded } from "@/server/demo/seed";
import { type ContributionsView, getContributionYears, getContributions, type PlanSummary } from "@/server/queries/contributions";
import { torontoToday } from "@/server/recompute";
import { D } from "@/tax-engine";
import { rrspDeadline } from "@/tax-engine/config/contribution-limits";
import { addDays } from "@/tax-engine/dates";

export const metadata: Metadata = { title: "Contributions" };

const num = (v: string | null) => (v === null ? 0 : Number(v));
const isPositive = (v: string | null) => v !== null && new D(v).gt(0);

function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="font-display text-subheading font-medium tabular-nums">{children}</dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Label and amount rows under the headline figures. */
function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y divide-border rounded-md border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 px-4 py-2 text-body-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({ tone, children }: { tone: "negative" | "muted"; children: ReactNode }) {
  const Icon = tone === "negative" ? TriangleAlert : Info;
  return (
    <p
      role={tone === "negative" ? "alert" : undefined}
      className={
        tone === "negative"
          ? "flex items-start gap-2 rounded-md border border-negative/40 bg-negative/10 px-4 py-3 text-body-sm"
          : "flex items-start gap-2 text-caption text-muted-foreground"
      }
    >
      <Icon aria-hidden className={tone === "negative" ? "mt-0.5 size-4 shrink-0 text-negative" : "mt-0.5 size-4 shrink-0"} />
      <span>{children}</span>
    </p>
  );
}

function SourceBadge({ source }: { source: PlanSummary["roomSource"] }) {
  if (!source) return null;
  return (
    <Badge variant={source === "unknown" ? "outline" : "default"} className="w-fit">
      {ROOM_SOURCE_LABELS[source]}
    </Badge>
  );
}

function PlanCard({
  id,
  title,
  source,
  description,
  children,
}: {
  id: string;
  title: string;
  source: PlanSummary["roomSource"];
  description: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-12">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{title}</CardTitle>
          <SourceBadge source={source} />
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-body-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function TfsaCard({ s, view, readOnly }: { s: PlanSummary; view: ContributionsView; readOnly: boolean }) {
  const { year } = view;
  const known = s.openingRoomCad !== null;
  const over = known && new D(s.roomRemainingCad ?? 0).isNegative();
  return (
    <PlanCard
      id="tfsa"
      title="TFSA"
      source={s.roomSource}
      description="Room on January 1 is last year's unused room, plus this year's limit, plus last year's withdrawals. A withdrawal never frees room in the same year."
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Figure label={`Room on January 1, ${year}`}>{known ? <Money value={s.openingRoomCad!} /> : "Unknown"}</Figure>
        <Figure label="Contributed">
          <Money value={s.contributionsCad} />
        </Figure>
        <Figure label={over ? "Over the limit by" : "Room left"}>
          {known ? (
            <Money value={over ? new D(s.roomRemainingCad!).neg().toFixed(2) : s.roomRemainingCad!} className={over ? "text-negative" : undefined} />
          ) : (
            "Unknown"
          )}
        </Figure>
      </dl>
      {known && <RoomMeter label="TFSA room used" room={Math.max(num(s.openingRoomCad), 0)} used={num(s.contributionsCad) - Math.min(num(s.openingRoomCad), 0)} />}
      {isPositive(s.withdrawalsCad) && (
        <Details
          rows={[
            ["Withdrawn", <Money key="w" value={s.withdrawalsCad} />],
            [`Added back to your room on January 1, ${year + 1}`, <Money key="r" value={s.restoredNextYearCad ?? "0"} />],
          ]}
        />
      )}
      {isPositive(s.penaltyCad) && (
        <Notice tone="negative">
          You went over your TFSA room by up to <Money value={s.peakExcessCad} />. CRA charges 1% a month on each month&apos;s
          highest excess: about <Money value={s.penaltyCad} /> for {year}. Withdraw the excess as soon as you can, and file Form
          RC243 (TFSA Return) by June 30, {year + 1}.
        </Notice>
      )}
      {s.roomSource === "unknown" && (
        <Notice tone="muted">Enter your room from CRA My Account below, or your birth year under Estimates, to see how much room you have.</Notice>
      )}
      {s.estimateIncomplete && (
        <Notice tone="muted">
          Estimated from your birth year and the history your brokers share, which starts later than your room does.
          Contributions Snap Tax Back cannot see would lower it: enter the figure from CRA My Account for an exact number.
        </Notice>
      )}
      <FormSection title="Your CRA figure">
        <ContributionInputsForm
          plan="tfsa"
          year={year}
          initial={view.inputs.tfsa}
          readOnly={readOnly}
          fields={[
            {
              name: "officialRoom",
              label: `TFSA room on January 1, ${year}`,
              hint: "In CRA My Account, under Tax-free savings account. Replaces the estimate.",
              placeholder: "7000",
            },
          ]}
        />
      </FormSection>
    </PlanCard>
  );
}

function RrspCard({ s, view, readOnly }: { s: PlanSummary; view: ContributionsView; readOnly: boolean }) {
  const { year } = view;
  const deadline = s.deadline!;
  const contributed = new D(s.periodOneCad ?? 0).plus(s.periodTwoCad ?? 0);
  const available = contributed.plus(s.unusedFromPriorCad ?? 0);
  const periodStart = addDays(rrspDeadline(year - 1), 1);
  return (
    <PlanCard
      id="rrsp"
      title="RRSP"
      source={s.roomSource}
      description={`Contributions made until ${formatDate(deadline)} count for ${year}. They go on Schedule 7 even when you do not deduct them.`}
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Figure label={`Deduction limit for ${year}`}>{s.deductionLimitCad ? <Money value={s.deductionLimitCad} /> : "Unknown"}</Figure>
        <Figure label={`Contributed for ${year}`}>
          <Money value={contributed.toFixed(2)} />
        </Figure>
        <Figure label="Deduction (line 20800)">{s.deductionCad ? <Money value={s.deductionCad} /> : "Unknown"}</Figure>
      </dl>
      {s.deductionLimitCad && <RoomMeter label="RRSP deduction limit used" room={num(s.deductionLimitCad)} used={available.toNumber()} />}
      <Details
        rows={[
          ["Unused contributions from earlier years", <Money key="u" value={s.unusedFromPriorCad ?? "0"} />],
          [`Contributed ${formatDate(periodStart)} to December 31`, <Money key="p1" value={s.periodOneCad ?? "0"} />],
          [`Contributed January 1 to ${formatDate(deadline)}`, <Money key="p2" value={s.periodTwoCad ?? "0"} />],
          ["Unused contributions to carry forward", s.carryForwardCad ? <Money key="c" value={s.carryForwardCad} /> : "Unknown"],
          [`Unused room left for ${year + 1}`, s.unusedRoomCad ? <Money key="r" value={s.unusedRoomCad} /> : "Unknown"],
          ...(isPositive(s.withdrawalsCad)
            ? ([[`Withdrawn in ${year} (taxable income, on your T4RSP)`, <Money key="w" value={s.withdrawalsCad} />]] as [string, ReactNode][])
            : []),
        ]}
      />
      {isPositive(s.penaltyCad) && (
        <Notice tone="negative">
          Your undeducted contributions passed your deduction limit plus the $2,000 allowance by up to{" "}
          <Money value={s.peakExcessCad} />. CRA charges 1% a month on it: about <Money value={s.penaltyCad} /> for {year}. Withdraw
          the excess and file Form T1-OVP by March 31, {year + 1}.
        </Notice>
      )}
      {s.roomSource === "unknown" && (
        <Notice tone="muted">
          Your deduction limit is on your {year - 1} notice of assessment. Without it Snap Tax Back cannot work out the deduction, so
          it is left off your return.
        </Notice>
      )}
      <FormSection title="From your notice of assessment">
        <ContributionInputsForm
          plan="rrsp"
          year={year}
          initial={view.inputs.rrsp}
          readOnly={readOnly}
          fields={[
            { name: "officialRoom", label: `RRSP deduction limit for ${year}`, hint: `On your ${year - 1} notice of assessment.`, placeholder: "18000" },
            { name: "unusedCarriedForward", label: "Unused RRSP contributions", hint: "Same notice. Blank uses Snap Tax Back's carry forward.", placeholder: "0" },
            {
              name: "deductionClaimed",
              label: "Deduction to claim",
              hint: "Blank claims the most allowed. Claiming less carries the rest to a later year.",
              placeholder: "Most allowed",
            },
          ]}
          moreLabel="No notice of assessment? Estimate the limit from last year"
          moreFields={[
            { name: "earnedIncomePriorYear", label: `Earned income for ${year - 1}`, hint: "Salary, self-employment, rental income.", placeholder: "85000" },
            { name: "pensionAdjustment", label: `Pension adjustment for ${year - 1}`, hint: "Box 52 of your T4 slips.", placeholder: "0" },
          ]}
        />
      </FormSection>
    </PlanCard>
  );
}

function FhsaCard({ s, view, readOnly }: { s: PlanSummary; view: ContributionsView; readOnly: boolean }) {
  const { year } = view;
  const used = new D(s.contributionsCad).plus(s.rrspTransfersCad ?? 0);
  return (
    <PlanCard
      id="fhsa"
      title="FHSA"
      source={s.roomSource}
      description="Room is $8,000 a year plus up to $8,000 left from last year, and $40,000 for life. Contributions go on Schedule 15; you can deduct them now or later."
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Figure label={`Participation room for ${year}`}>
          <Money value={s.participationRoomCad ?? "0"} />
        </Figure>
        <Figure label="Contributed">
          <Money value={used.toFixed(2)} />
        </Figure>
        <Figure label="Room left">
          <Money value={s.roomRemainingCad ?? "0"} />
        </Figure>
      </dl>
      <RoomMeter label="FHSA room used" room={num(s.participationRoomCad)} used={used.toNumber()} />
      <Details
        rows={[
          ...(s.firstYear ? [] : ([["Carried forward from last year", <Money key="cf" value={s.carryforwardInCad ?? "0"} />]] as [string, ReactNode][])),
          ...(isPositive(s.rrspTransfersCad)
            ? ([["Transferred from your RRSP (not deductible)", <Money key="t" value={s.rrspTransfersCad!} />]] as [string, ReactNode][])
            : []),
          ["Annual FHSA limit", <Money key="al" value={s.annualLimitCad ?? "0"} />],
          ["Deduction (line 20805)", <Money key="d" value={s.deductionCad ?? "0"} />],
          ["Unused contributions to carry forward", <Money key="c" value={s.carryForwardCad ?? "0"} />],
          ["Lifetime limit used, of $40,000", <Money key="l" value={s.lifetimeUsedCad ?? "0"} />],
          ...(isPositive(s.withdrawalsCad)
            ? ([["Withdrawn", <Money key="w" value={s.withdrawalsCad} />]] as [string, ReactNode][])
            : []),
        ]}
      />
      {isPositive(s.penaltyCad) && (
        <Notice tone="negative">
          You went over your FHSA room by up to <Money value={s.peakExcessCad} />. CRA charges 1% a month on the excess: about{" "}
          <Money value={s.penaltyCad} /> for {year}. A designated withdrawal or a transfer to your RRSP removes it.
        </Notice>
      )}
      {s.firstYear && <Notice tone="muted">You opened your first FHSA in {year}: tick box 68930 on Schedule 15.</Notice>}
      <FormSection title="From your FHSA participation room statement">
        <ContributionInputsForm
          plan="fhsa"
          year={year}
          initial={view.inputs.fhsa}
          readOnly={readOnly}
          fields={[
            { name: "officialRoom", label: `FHSA participation room for ${year}`, hint: "In CRA My Account. Replaces the estimate.", placeholder: "8000" },
            { name: "unusedCarriedForward", label: "Unused FHSA contributions", hint: "Same statement. Blank uses Snap Tax Back's carry forward.", placeholder: "0" },
            {
              name: "deductionClaimed",
              label: "Deduction to claim",
              hint: "Blank claims the most allowed. Claiming less carries the rest forward.",
              placeholder: "Most allowed",
            },
          ]}
        />
      </FormSection>
    </PlanCard>
  );
}

function OtherPlanCard({ s }: { s: PlanSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ACCOUNT_TYPE_LABELS[s.plan]}</CardTitle>
        <CardDescription>Snap Tax Back lists what went in and out; it does not track room for this plan.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          <Figure label="Contributed">
            <Money value={s.contributionsCad} />
          </Figure>
          <Figure label="Withdrawn">
            <Money value={s.withdrawalsCad} />
          </Figure>
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function ContributionsYear(props: PageProps<"/contributions/[year]">) {
  const { year: raw } = await props.params;
  const user = await requireUser(`/contributions/${raw}`);
  const db = getDb();
  const today = torontoToday();
  if (user.isDemo) {
    try {
      await ensureDemoSeeded(db, today);
    } catch (error) {
      console.error("[demo] seeding failed", error);
    }
  }

  const years = await getContributionYears(db, user.id, today);
  const year = Number(raw);
  if (!years.includes(year)) notFound();
  const view = await getContributions(db, user.id, year, today);
  const readOnly = user.isDemo;
  const card = (s: PlanSummary) => {
    switch (s.plan) {
      case "tfsa":
        return <TfsaCard key={s.plan} s={s} view={view} readOnly={readOnly} />;
      case "rrsp":
        return <RrspCard key={s.plan} s={s} view={view} readOnly={readOnly} />;
      case "fhsa":
        return <FhsaCard key={s.plan} s={s} view={view} readOnly={readOnly} />;
      default:
        return <OtherPlanCard key={s.plan} s={s} />;
    }
  };
  const hasForms = view.summaries.some((s) => s.plan === "rrsp" || s.plan === "fhsa");

  return (
    <>
      <PageHeader
        title={`Contributions ${year}`}
        description="Contribution room and what went in and out of your registered accounts, with the amounts for Schedule 7 (RRSP) and Schedule 15 (FHSA)."
      />

      <YearNav years={years} current={year} basePath="/contributions" />

      {readOnly && (
        <Notice tone="muted">The demo is read-only: sign in to enter your own CRA figures or change how a deposit is counted.</Notice>
      )}

      {view.summaries.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={`No registered account activity in ${year}`}
          description="Deposits and withdrawals in a TFSA, RRSP, FHSA, or other registered account show up here once your brokers share them. Confirm each account's type on the Hub."
        />
      ) : (
        <>
          {hasForms && (
            <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
              <FileText aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                The Schedule 7 and Schedule 15 lines, ready to copy, are in the{" "}
                <Link href={`/tax/${year}#return`} className="text-link hover:underline">
                  Tax Center
                </Link>
                .
              </span>
            </p>
          )}
          {view.summaries.map(card)}
        </>
      )}

      <Card id="activity" className="scroll-mt-12">
        <CardHeader>
          <CardTitle>Deposits and withdrawals</CardTitle>
          <CardDescription>
            Cash and shares in and out of your registered accounts that count for {year}. Snap Tax Back reads a deposit as a
            contribution, shares moved in kind at their fair market value, and a transfer between two accounts of the same type
            as neither; change any row it got wrong.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {view.flows.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">Nothing for {year} yet.</p>
          ) : (
            <FlowList flows={view.flows} readOnly={readOnly} />
          )}
          <FormSection title="Add a contribution Snap Tax Back cannot see">
            <AddFlowForm today={today} readOnly={readOnly} />
          </FormSection>
        </CardContent>
      </Card>

      <Card id="estimates" className="scroll-mt-12">
        <CardHeader>
          <CardTitle>Estimates</CardTitle>
          <CardDescription>
            Without CRA&apos;s figures, Snap Tax Back estimates TFSA room from the year you turned 18 and FHSA room from the year you
            opened your first FHSA. A CRA figure always wins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContributionProfileForm initial={view.profile} readOnly={readOnly} />
        </CardContent>
      </Card>
    </>
  );
}
