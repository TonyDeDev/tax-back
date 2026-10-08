import type { Metadata } from "next";
import { CircleCheck, Download, FileText, Info, Lightbulb, Percent, TrendingDown, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { CopyAmount } from "@/components/tax/copy-amount";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { formatDate, formatPercent, formatQuantity } from "@/lib/format";
import { DIVIDEND_CLASS_LABELS, GAIN_KIND_LABELS } from "@/lib/tax-csv";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ensureDemoSeeded } from "@/server/demo/seed";
import { groupDividends, getTaxYear, getTaxYears, type TaxYearView } from "@/server/queries/tax";
import { torontoToday } from "@/server/recompute";

export const metadata: Metadata = { title: "Tax Center" };

function YearNav({ years, current }: { years: number[]; current: number }) {
  return (
    <nav aria-label="Tax year" className="flex flex-wrap gap-1">
      {years.map((y) => (
        <Link
          key={y}
          href={`/tax/${y}`}
          aria-current={y === current ? "page" : undefined}
          className={cn(
            "rounded-sm px-3 py-1.5 text-body-sm font-medium tabular-nums transition-colors",
            y === current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {y}
        </Link>
      ))}
    </nav>
  );
}

function Summary({ view }: { view: TaxYearView }) {
  const t = view.totals;
  return (
    <section aria-label="Year summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Net capital gain"
        value={<Money value={t?.netCapitalGainCad ?? 0} signed />}
        hint={view.isCurrentYear ? "So far this year" : "Settled in this year"}
      />
      <StatCard
        label="Taxable capital gain"
        value={<Money value={t?.taxableCapitalGainCad ?? 0} signed />}
        hint={t ? `${formatPercent(t.inclusionRate, 0)} inclusion rate` : "50% inclusion rate"}
      />
      <StatCard
        label="Dividends and income"
        value={<Money value={t?.totalIncomeCad ?? 0} />}
        hint="Non-registered accounts only"
      />
      <StatCard
        label="Estimated tax"
        value={t?.estimatedTaxCad ? <Money value={t.estimatedTaxCad} /> : "Not set"}
        hint={t?.estimatedTaxCad ? "On capital gains only" : "Needs your marginal tax rate"}
      />
    </section>
  );
}

const listFormat = new Intl.ListFormat("en-CA", { type: "conjunction" });

/** What makes this year's numbers unreliable, worst first; an all-clear when there is nothing. */
function Readiness({ view }: { view: TaxYearView }) {
  const { checks, t3Symbols } = view.returnView;
  return (
    <div className="flex flex-col gap-2">
      {checks.length === 0 ? (
        <p className="flex items-center gap-2 text-body-sm">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-positive" />
          Nothing to fix first: every position with an ACB matches your brokers, and your account types are confirmed.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-body-sm font-medium">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-negative" />
            {checks.length === 1 ? "1 thing to check first" : `${checks.length} things to check first`}
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border">
            {checks.map((c) => (
              <li key={c.key} className="flex flex-col gap-1 px-4 py-2 text-body-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span>{c.text}</span>
                {c.href && (
                  <Link href={c.href} className="shrink-0 text-link hover:underline">
                    {c.linkLabel}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="flex items-start gap-2 text-caption text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {t3Symbols.length > 0 &&
            `For ${listFormat.format(t3Symbols)}, use your T3 ${t3Symbols.length === 1 ? "slip" : "slips"} instead: a Canadian ETF's distribution mixes dividends, capital gains, and return of capital, and only the T3 has the split. `}
          Compare the dividend lines with your T5 and T3 slips before you file.
        </span>
      </p>
    </div>
  );
}

/** The amounts to type into the return, one row per line, with the form and line number to find it by. */
function FillOutReturn({ view }: { view: TaxYearView }) {
  const r = view.returnView;
  return (
    <div className="flex flex-col gap-4">
      <Readiness view={view} />
      {!r.verified && (
        <p className="text-caption text-muted-foreground">
          Line numbers are from the {r.formYear} forms. CRA has not published the {view.year} forms yet, so check them when it does.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-md border">
        {r.lines.map((l) => (
          <li key={l.key} className="flex items-start gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {l.form}
                  {l.line ? ` · ${l.line}` : ""}
                </Badge>
                <span className="text-body-sm font-medium">{l.label}</span>
              </span>
              {l.note && <span className="text-caption text-muted-foreground">{l.note}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1 pt-0.5">
              <Money value={l.amountCad} signed={l.key.startsWith("s3-gain")} className="text-body-sm font-medium" />
              <CopyAmount value={l.amountCad} label={l.line ? `line ${l.line}` : l.label} />
            </span>
          </li>
        ))}
      </ul>
      {r.netCapitalLossCad && (
        <p className="text-body-sm text-muted-foreground">
          You have a net capital loss of <Money value={r.netCapitalLossCad} /> for {view.year}. It does not go on line 12700: you can apply it against
          taxable capital gains of the past 3 years (Form T1A) or carry it forward to future years (line 25300).
        </p>
      )}
      <p className="text-caption text-muted-foreground">
        Not covered: interest income, carrying charges (line 22100), losses from other years (line 25300), RRSP and FHSA deductions, foreign
        property (Form T1135), and provincial forms.
      </p>
    </div>
  );
}

/** Schedule 3 lines, in the order the form asks for them. */
function ScheduleThree({ view }: { view: TaxYearView }) {
  if (view.gains.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No realized gains for this year"
        description="A sale, a return of capital over the ACB, or shares moved into a registered account would show up here."
      />
    );
  }
  const t = view.totals;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[52rem] text-body-sm tabular-nums">
        <caption className="sr-only">Realized gains and losses for {view.year}, in the Schedule 3 order</caption>
        <thead className="text-caption text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Settled
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Security
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Units
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Proceeds
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              ACB
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Outlays
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Gain or loss
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Reportable
            </th>
          </tr>
        </thead>
        <tbody>
          {view.gains.map((g) => (
            <tr key={g.id} className="border-b last:border-0 hover:bg-accent/50">
              <td className="whitespace-nowrap px-3 py-2">{formatDate(g.dispositionDate)}</td>
              <td className="px-3 py-2">
                <Link href={`/hub/securities/${g.securityId}`} className="font-medium text-link hover:underline">
                  {g.symbol}
                </Link>
                <span className="block text-caption text-muted-foreground">
                  {g.accountName ?? "pooled, non-registered"}
                  {g.kind !== "sale" && ` · ${GAIN_KIND_LABELS[g.kind]}`}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{formatQuantity(g.quantity)}</td>
              <td className="px-3 py-2 text-right">
                <Money value={g.proceedsCad} />
              </td>
              <td className="px-3 py-2 text-right">
                <Link href={`/hub/securities/${g.securityId}#audit`} className="hover:underline" title="See how this ACB was built">
                  <Money value={g.acbCad} />
                </Link>
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={g.feesCad} />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={g.gainCad} signed className="justify-end" />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={g.allowedGainCad} signed className="justify-end" />
                {Number(g.deniedLossCad) !== 0 && (
                  <span className="block text-caption text-muted-foreground">
                    <Money value={g.deniedLossCad} /> denied
                  </span>
                )}
                {g.incomplete && (
                  <span className="block text-caption text-negative">ACB understated: history missing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        {t && (
          <tfoot className="border-t font-medium">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right">
                <Money value={t.proceedsCad} />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={t.acbCad} />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={t.feesCad} />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={t.grossGainCad} signed className="justify-end" />
              </td>
              <td className="px-3 py-2 text-right">
                <Money value={t.netCapitalGainCad} signed className="justify-end" />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function SuperficialLosses({ view }: { view: TaxYearView }) {
  if (view.superficialLosses.length === 0) {
    return (
      <EmptyState
        icon={TrendingDown}
        title="No superficial losses"
        description="A loss is superficial when the same security is bought within 30 days before or after the sale, in any account."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {view.superficialLosses.map((l) => (
        <li key={l.id} className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/hub/securities/${l.securityId}`} className="text-body font-medium text-link hover:underline">
              {l.symbol}
            </Link>
            <span className="text-body-sm text-muted-foreground">sold {formatDate(l.saleDate)}</span>
            {l.status === "pending" ? (
              <Badge variant="outline" title={`Final once the window closes on ${formatDate(l.windowEnd)}.`}>
                Pending
              </Badge>
            ) : (
              <Badge>Final</Badge>
            )}
            {Number(l.lostForeverCad) > 0 && <Badge variant="negative">Lost for good</Badge>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
            <div>
              <dt className="text-caption text-muted-foreground">Loss on the sale</dt>
              <dd className="tabular-nums">
                <Money value={l.totalLossCad} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Denied</dt>
              <dd className="tabular-nums">
                <Money value={l.deniedLossCad} /> on {formatQuantity(l.quantityDenied)} of {formatQuantity(l.quantitySold)} units
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Allowed this year</dt>
              <dd className="tabular-nums">
                <Money value={l.allowedLossCad} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">30-day window</dt>
              <dd className="tabular-nums">
                {formatDate(l.windowStart)} to {formatDate(l.windowEnd)}
              </dd>
            </div>
          </dl>

          {l.replacements.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-caption text-muted-foreground">Replacement purchases in the window</p>
              <ul className="flex flex-col divide-y divide-border">
                {l.replacements.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5 text-body-sm">
                    <span>
                      {formatQuantity(r.quantity)} units in {r.accountName}{" "}
                      <span className="text-muted-foreground">({ACCOUNT_TYPE_LABELS[r.accountType]})</span>
                    </span>
                    <span className="tabular-nums">
                      <Money value={r.deniedCad} />{" "}
                      <span className="text-muted-foreground">
                        {r.disposition === "added_to_acb" ? "added to their ACB" : "lost for good"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Number(l.lostForeverCad) > 0 && (
            <p className="flex items-start gap-2 text-body-sm text-negative">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <Money value={l.lostForeverCad} /> of this loss can never be claimed: the replacement shares are in a
              registered account, so there is no ACB it can be added to.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Dividends({ view }: { view: TaxYearView }) {
  const groups = groupDividends(view.dividends);
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Percent}
        title="No dividend income"
        description="Dividends paid into registered accounts are not taxable, so they are left out here."
      />
    );
  }
  const t = view.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[40rem] text-body-sm tabular-nums">
          <caption className="sr-only">Dividends and investment income for {view.year}, by security</caption>
          <thead className="text-caption text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Security
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Class
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Received
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Taxable amount
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Federal credit
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Tax withheld
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.securityId}:${g.dividendClass}`} className="border-b last:border-0 hover:bg-accent/50">
                <td className="px-3 py-2">
                  <Link href={`/hub/securities/${g.securityId}`} className="font-medium text-link hover:underline">
                    {g.symbol}
                  </Link>
                  <span className="block text-caption text-muted-foreground">
                    {g.payments} {g.payments === 1 ? "payment" : "payments"}
                  </span>
                </td>
                <td className="px-3 py-2">{DIVIDEND_CLASS_LABELS[g.dividendClass]}</td>
                <td className="px-3 py-2 text-right">
                  <Money value={g.amountCad} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Money value={g.grossedUpCad} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Money value={g.federalCreditCad} />
                </td>
                <td className="px-3 py-2 text-right">{Number(g.withholdingCad) === 0 ? "-" : <Money value={g.withholdingCad} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
          <div>
            <dt className="text-caption text-muted-foreground">Eligible dividends</dt>
            <dd className="tabular-nums">
              <Money value={t.eligibleDividendsCad} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Non-eligible dividends</dt>
            <dd className="tabular-nums">
              <Money value={t.nonEligibleDividendsCad} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Foreign income</dt>
            <dd className="tabular-nums">
              <Money value={t.foreignIncomeCad} />
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Foreign tax withheld</dt>
            <dd className="tabular-nums">
              <Money value={t.foreignWithholdingCad} />
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Harvesting({ view }: { view: TaxYearView }) {
  if (!view.isCurrentYear) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="Only for the year in progress"
        description="Harvesting windows are measured from today, so they are shown on the current year."
      />
    );
  }
  if (view.harvest.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No harvesting opportunities"
        description="Nothing you hold in a non-registered account is worth less than its ACB today."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {view.harvest.map((h) => (
        <li key={h.securityId} className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/hub/securities/${h.securityId}`} className="text-body font-medium text-link hover:underline">
                {h.symbol}
              </Link>
              <span className="text-body-sm text-muted-foreground">{formatQuantity(h.quantity)} units</span>
              {h.blockedByRecentPurchase && <Badge variant="negative">Wait to sell</Badge>}
            </div>
            {/* The engine only reports a position worth less than its ACB, so the stored loss is positive. */}
            <Money value={`-${h.unrealizedLossCad}`} signed className="text-body" />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
            <div>
              <dt className="text-caption text-muted-foreground">Market value</dt>
              <dd className="tabular-nums">
                <Money value={h.marketValueCad} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Pooled ACB</dt>
              <dd className="tabular-nums">
                <Money value={h.acbCad} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Gains it could offset</dt>
              <dd className="tabular-nums">
                <Money value={h.gainsAvailableToOffsetCad} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Estimated tax saving</dt>
              <dd className="tabular-nums">
                {h.estimatedTaxSavingsCad === null ? (
                  <span className="text-muted-foreground">Set a marginal rate</span>
                ) : (
                  <Money value={h.estimatedTaxSavingsCad} />
                )}
              </dd>
            </div>
          </dl>

          <p className="text-body-sm text-muted-foreground">
            {h.blockedByRecentPurchase ? (
              <>
                You bought this within the last 30 days, so selling now would make the loss superficial. Sell on or after{" "}
                <strong className="font-medium text-foreground tabular-nums">{formatDate(h.earliestSafeSaleDate)}</strong>.
              </>
            ) : (
              <>
                Safe to sell today. The 30-day window would run{" "}
                <span className="tabular-nums">
                  {formatDate(h.windowStart)} to {formatDate(h.windowEnd)}
                </span>
                .
              </>
            )}{" "}
            Do not buy it back in any account, including a TFSA or RRSP, before{" "}
            <strong className="font-medium text-foreground tabular-nums">{formatDate(h.noRebuyBefore)}</strong>.
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function TaxCenter(props: PageProps<"/tax/[year]">) {
  const { year: raw } = await props.params;
  const user = await requireUser(`/tax/${raw}`);
  const db = getDb();
  const today = torontoToday();
  // The demo has no SnapTrade grant; its portfolio is seeded instead, on the first visit of the day.
  if (user.isDemo) {
    try {
      await ensureDemoSeeded(db, today);
    } catch (error) {
      console.error("[demo] seeding failed", error);
    }
  }

  const years = await getTaxYears(db, user.id, today);
  const year = Number(raw);
  if (!years.includes(year)) notFound();
  const view = await getTaxYear(db, user.id, year, today);

  return (
    <>
      <PageHeader
        title={`Tax Center ${year}`}
        description="Your realized gains, denied losses, and investment income for the year, laid out the way Schedule 3 asks for them."
        actions={
          <a
            href={`/tax/${year}/export`}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
            aria-label={`Export ${year} as CSV`}
          >
            <Download aria-hidden className="size-4" />
            Export CSV
          </a>
        }
      />

      <YearNav years={years} current={year} />

      {view.totals?.configAssumed && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-border px-4 py-3 text-body-sm text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          The tax rates for {year} are not verified against CRA yet, so the nearest verified year was used. Treat these
          numbers as an estimate.
        </p>
      )}

      <Summary view={view} />

      <Card id="return">
        <CardHeader>
          <CardTitle>Fill out your return</CardTitle>
          <CardDescription>
            What to enter for {year}, line by line, from your non-registered accounts. Copy each amount into your tax software.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FillOutReturn view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Realized gains</CardTitle>
          <CardDescription>
            Proceeds, ACB, outlays, and gain by disposition, in the year the sale settled. Select an ACB for the audit
            trail behind it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScheduleThree view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Superficial losses</CardTitle>
          <CardDescription>Denied losses, the purchases that caused them, and where the denied amount went.</CardDescription>
        </CardHeader>
        <CardContent>
          <SuperficialLosses view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dividends</CardTitle>
          <CardDescription>Eligible, non-eligible, and foreign, with the gross-up and the federal credit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Dividends view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax-loss harvesting</CardTitle>
          <CardDescription>Positions worth less than their ACB today, with the 30-day window each sale would open.</CardDescription>
        </CardHeader>
        <CardContent>
          <Harvesting view={view} />
        </CardContent>
      </Card>
    </>
  );
}
