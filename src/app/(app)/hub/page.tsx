import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Briefcase, ExternalLink, TriangleAlert } from "lucide-react";
import { ConnectSnapTradeButton } from "@/components/auth/connect-snaptrade-button";
import { EmptyState } from "@/components/empty-state";
import { AccountRow } from "@/components/hub/account-row";
import { AllocationDonut } from "@/components/hub/allocation-donut";
import { AttentionList } from "@/components/hub/attention-list";
import { BrokerageFilter } from "@/components/hub/brokerage-filter";
import { type AccountHolding, HoldingsTable, type PooledHolding } from "@/components/hub/holdings-table";
import { KpiCard } from "@/components/hub/kpi-card";
import { ValueChart } from "@/components/hub/value-chart";
import { Money } from "@/components/money";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { FirstSync } from "@/components/sync/first-sync";
import { SyncControls } from "@/components/sync/sync-controls";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { formatAgo, formatPercent, formatQuantity, formatShortDate } from "@/lib/format";
import { type AttentionItem, warningAttention } from "@/lib/warnings";
import { hasSnapTradeGrant } from "@/server/auth/accounts";
import { configuredProviders } from "@/server/auth/config";
import { amountsHidden } from "@/server/amounts";
import { requireUser } from "@/server/auth/session";
import { SNAPTRADE_DASHBOARD_URL } from "@/server/auth/snaptrade-provider";
import { getDb } from "@/server/db";
import { ensureDemoSeeded } from "@/server/demo/seed";
import { getEnv } from "@/server/env";
import {
  type HubBrokerage,
  type HubPendingBrokerage,
  type HubSummary,
  type HubSync,
  type ReconciliationSummary,
  allocationByType,
  getHoldingsByAccount,
  getHubSummary,
  getInvestments,
  getLastSuccessfulSyncAt,
  getLastSync,
  getReconciliation,
  getValueHistory,
  latestChange,
} from "@/server/queries/hub";
import { torontoToday } from "@/server/recompute";
import { SYNC_COOLDOWN_MS } from "@/server/sync/sync";
import { D } from "@/tax-engine";
import { yearOf } from "@/tax-engine/dates";

export const metadata: Metadata = { title: "Hub" };
// Refresh and the first sync run as server actions on this page; they read every brokerage account.
export const maxDuration = 300;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function syncState(lastSync: HubSync | null, lastSuccessAt: Date | null, now: Date, isDemo: boolean) {
  if (isDemo) return { status: "Sample data", tone: "positive" as StatusTone, running: false, disabledReason: undefined };
  if (!lastSync) return { status: "Not synced yet", tone: "neutral" as StatusTone, running: false, disabledReason: undefined };
  const status = lastSuccessAt ? `Synced ${formatAgo(lastSuccessAt, now)}` : "Not synced yet";
  const tone: StatusTone = lastSync.status === "failed" ? "negative" : "positive";
  if (lastSync.status === "running") return { status: "Syncing...", tone, running: true, disabledReason: "A sync is running." };
  if (lastSync.status === "succeeded") {
    const minutes = Math.ceil((lastSync.startedAt.getTime() + SYNC_COOLDOWN_MS - now.getTime()) / 60_000);
    if (minutes > 0) return { status, tone, running: false, disabledReason: `You can refresh again in ${minutes} min.` };
  }
  return { status, tone, running: false, disabledReason: null };
}

function HubHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-heading-sm font-semibold md:text-heading">Hub</h1>
        <p className="text-body-sm text-muted-foreground">Every account in one place, with Canadian tax insight.</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3 xl:justify-end">{actions}</div> : null}
    </header>
  );
}

function SyncProblem({ sync }: { sync: HubSync }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-md border border-destructive px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="text-body-sm text-destructive">
          The last sync failed: {sync.error ?? "unknown error"} The numbers below are from the last successful sync.
        </p>
      </div>
      {sync.errorCode === "reauth_required" && <ConnectSnapTradeButton />}
    </div>
  );
}

/** Every item the "Needs attention" card lists; the Alerts count is its length. */
function attentionItems(summary: HubSummary, reconciliation: ReconciliationSummary, hidden: boolean): AttentionItem[] {
  const broken = [...summary.brokerages, ...summary.pendingBrokerages].filter((b) => b.status === "broken");
  return [
    ...broken.map((b) => ({
      tone: "negative" as const,
      text: `${b.name} needs to be reconnected`,
      href: SNAPTRADE_DASHBOARD_URL,
      linkLabel: "Open SnapTrade",
    })),
    ...(summary.unconfirmedAccounts > 0
      ? [
          {
            tone: "negative" as const,
            text: `${summary.unconfirmedAccounts} ${summary.unconfirmedAccounts === 1 ? "account type" : "account types"} to confirm`,
            href: "#accounts",
            linkLabel: "Confirm below",
          },
        ]
      : []),
    // Only gaps that change ACB; registered-account gaps and ones still waiting for the broker are not alerts.
    ...reconciliation.gaps.map((g) => ({
      tone: "negative" as const,
      text: `${g.symbol}: ledger ${formatQuantity(g.ledgerQuantity)}, broker ${formatQuantity(g.brokerQuantity)} units`,
      href: `/hub/securities/${g.securityId}${g.status === "broker_has_more" ? "#opening" : "#reconciliation"}`,
      linkLabel: g.status === "broker_has_more" ? "Add opening balance" : "Review",
    })),
    ...summary.warnings.map((w) => warningAttention(w, hidden)),
  ];
}

/** The ledger check under the investments table; only non-registered positions count, since only they carry ACB. */
function ReconciliationNote({ reconciliation, matchShare }: { reconciliation: ReconciliationSummary; matchShare: number | null }) {
  const extras = [
    reconciliation.waiting.length > 0 &&
      `${reconciliation.waiting.length} waiting for the broker to report recent trades`,
    reconciliation.registered.length > 0 &&
      `${reconciliation.registered.length} ${reconciliation.registered.length === 1 ? "gap" : "gaps"} in registered accounts, no effect on tax`,
  ].filter(Boolean);
  return (
    <p className="flex items-start gap-2 text-caption text-muted-foreground">
      <StatusDot
        tone={reconciliation.gaps.length > 0 ? "negative" : matchShare === null ? "neutral" : "positive"}
        className="mt-1"
      />
      <span>
        {matchShare === null ? (
          "No non-registered positions to check"
        ) : (
          <>
            Ledger matches broker positions:{" "}
            <strong className="font-mono font-medium tabular-nums text-foreground">{formatPercent(matchShare, matchShare === 1 ? 0 : 1)}</strong>{" "}
            <span className="tabular-nums">
              ({reconciliation.matched} of {reconciliation.total} non-registered)
            </span>
          </>
        )}
        {extras.map((text) => (
          <span key={text as string}> · {text}</span>
        ))}
      </span>
    </p>
  );
}

function ConnectCta({ isDemo }: { isDemo: boolean }) {
  if (isDemo) {
    return (
      <Link href="/sign-in" className={buttonVariants({ size: "sm" })}>
        Connect brokerage
      </Link>
    );
  }
  // Brokerages are added in the SnapTrade Dashboard; the next refresh picks them up.
  return (
    <a href={SNAPTRADE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
      Connect brokerage
      <ExternalLink aria-hidden className="size-4" />
      <span className="sr-only">(opens SnapTrade in a new tab)</span>
    </a>
  );
}

function BrokerageSection({ brokerage: b, totalCad, readOnly }: { brokerage: HubBrokerage; totalCad: string; readOnly: boolean }) {
  const total = Number(totalCad);
  const broken = b.status === "broken";
  return (
    <section aria-label={b.name} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate font-sans text-body font-medium">{b.name}</h3>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <StatusDot tone={broken ? "negative" : "positive"} />
            {broken ? "Needs reconnect" : "Synced"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {broken && (
            <a
              href={SNAPTRADE_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Reconnect
              <ExternalLink aria-hidden className="size-4" />
              <span className="sr-only">(opens SnapTrade in a new tab)</span>
            </a>
          )}
          <span className="font-mono text-body-sm font-medium tabular-nums">
            <span className="sr-only">Subtotal </span>
            <Money value={b.totalCad} />
            {b.totalIncomplete && <span className="text-muted-foreground"> + unconverted</span>}
          </span>
        </div>
      </div>
      {broken && b.statusDetail && <p className="px-1 text-caption text-muted-foreground">{b.statusDetail}</p>}
      <ul className="flex flex-col divide-y divide-border rounded-md border">
        {b.accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            share={a.valueCad === null ? null : total > 0 ? Number(a.valueCad) / total : 0}
            readOnly={readOnly}
          />
        ))}
      </ul>
    </section>
  );
}

/** A connection SnapTrade lists no accounts for yet: shown so the brokerage is never silently missing. */
function PendingBrokerageSection({ brokerage: b }: { brokerage: HubPendingBrokerage }) {
  const broken = b.status === "broken";
  return (
    <section aria-label={b.name} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="truncate font-sans text-body font-medium">{b.name}</h3>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <StatusDot tone={broken ? "negative" : "neutral"} pulse={!broken} />
            {broken ? "Needs reconnect" : "Waiting for accounts"}
          </span>
        </div>
        <a
          href={SNAPTRADE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {broken ? "Reconnect" : "Open SnapTrade"}
          <ExternalLink aria-hidden className="size-4" />
          <span className="sr-only">(opens SnapTrade in a new tab)</span>
        </a>
      </div>
      {b.statusDetail && (
        <p className="rounded-md border border-dashed px-4 py-3 text-body-sm text-muted-foreground">{b.statusDetail}</p>
      )}
    </section>
  );
}

function NotConnected() {
  return (
    <Card className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-6 py-12 text-center">
      <Briefcase aria-hidden className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-heading-sm font-semibold">Connect your first brokerage</h2>
        <p className="text-body-sm text-muted-foreground">
          TaxBack reads your accounts through SnapTrade, read-only, and pools your cost basis across every brokerage. Connect
          your free SnapTrade account to see your Hub.
        </p>
      </div>
      <ConnectSnapTradeButton label="Connect brokerage" callbackURL="/hub" disabled={!configuredProviders(getEnv()).snaptrade} />
    </Card>
  );
}

export default async function Hub(props: PageProps<"/hub">) {
  const user = await requireUser("/hub");
  const hidden = await amountsHidden();
  const params = await props.searchParams;
  const db = getDb();
  const connected = !user.isDemo && (await hasSnapTradeGrant(db, user.id));
  const lastSync = connected ? await getLastSync(db, user.id) : null;
  const today = torontoToday();
  const year = yearOf(today);
  const now = new Date();

  if (!user.isDemo && !connected) {
    return (
      <>
        <HubHeader />
        <NotConnected />
      </>
    );
  }

  // The demo has no SnapTrade grant; its portfolio is seeded instead, on the first visit if the cron has not run yet.
  let demoReady = false;
  if (user.isDemo) {
    try {
      await ensureDemoSeeded(db, today);
      demoReady = true;
    } catch (error) {
      console.error("[demo] seeding failed", error);
    }
  }
  const hasData = demoReady || lastSync !== null;
  const [summary, lastSuccessAt, reconciliation] = hasData
    ? await Promise.all([getHubSummary(db, user.id, today), getLastSuccessfulSyncAt(db, user.id), getReconciliation(db, user.id, today)])
    : [null, null, null];

  const selected = summary?.brokerages.find((b) => b.id === first(params.brokerage)) ?? null;
  const shown = selected ? [selected] : (summary?.brokerages ?? []);
  // Connections with no accounts yet have nothing to filter to, so they show only on the unfiltered Hub.
  const pending = selected ? [] : (summary?.pendingBrokerages ?? []);
  const accountIds = selected ? selected.accounts.map((a) => a.id) : undefined;
  const [history, investments, byAccount] = summary
    ? await Promise.all([
        getValueHistory(db, user.id, accountIds),
        getInvestments(db, user.id, today, accountIds),
        getHoldingsByAccount(db, user.id, today, accountIds),
      ])
    : [[], [], []];

  const sync = syncState(lastSync, lastSuccessAt, now, user.isDemo);
  const header = (
    <HubHeader
      actions={
        <>
          <SyncControls status={sync.status} tone={sync.tone} running={sync.running} disabledReason={sync.disabledReason}>
            {summary && <BrokerageFilter brokerages={summary.brokerages} selected={selected?.id ?? null} />}
          </SyncControls>
          <ConnectCta isDemo={user.isDemo} />
        </>
      }
    />
  );

  if (!summary || !reconciliation) {
    return (
      <>
        {header}
        {connected && !lastSync ? (
          <FirstSync />
        ) : (
          <EmptyState icon={Briefcase} title="The demo portfolio is on its way" description="Reload the page in a moment." />
        )}
      </>
    );
  }

  const totalCad = selected ? selected.totalCad : summary.totalValueCad;
  const totalIncomplete = selected ? selected.totalIncomplete : summary.totalIncomplete;
  const change = latestChange(history);
  const attention = attentionItems(summary, reconciliation, hidden);
  const needAction = attention.filter((a) => a.tone === "negative").length;
  const weightOf = (value: string | null) =>
    value === null || new D(totalCad).isZero() ? null : new D(value).div(totalCad).toFixed(6);
  const pooled: PooledHolding[] = investments.map((r) => ({
    securityId: r.securityId,
    symbol: r.symbol,
    name: r.name,
    brokerQuantity: r.brokerQuantity,
    marketValueCad: r.marketValueCad,
    pooledQuantity: r.pooledQuantity,
    totalAcbCad: r.totalAcbCad,
    unrealizedCad: r.unrealizedCad,
    trend: r.trend,
    weight: weightOf(r.marketValueCad),
  }));
  const perAccount: AccountHolding[] = byAccount.map((r) => ({
    ...r,
    accountTypeLabel: ACCOUNT_TYPE_LABELS[r.accountType],
    weight: weightOf(r.marketValueCad),
  }));
  const matchShare = reconciliation.total === 0 ? null : reconciliation.matched / reconciliation.total;
  const scope = selected ? `${selected.name} only` : "All brokerages";

  return (
    <>
      {header}
      {lastSync?.status === "failed" && <SyncProblem sync={lastSync} />}

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          featured
          label="Total value"
          value={<Money value={totalCad} />}
          href="#accounts"
          hrefLabel="Jump to accounts"
          caption={
            <div className="flex flex-col gap-0.5">
              <span>{totalIncomplete ? "Some accounts could not be converted to CAD" : `Holdings and cash, in CAD${selected ? `, ${selected.name}` : ""}`}</span>
              {change && Number(change.changeCad) !== 0 && (
                <span className="flex flex-wrap items-center gap-x-1">
                  <Money value={change.changeCad} signed className="font-medium" />
                  <span>since {formatShortDate(change.sinceDay)}</span>
                </span>
              )}
            </div>
          }
        />
        <KpiCard
          label="YTD realized gains"
          value={<Money value={summary.ytdGainCad} signed />}
          caption={`Non-registered accounts, ${year}${selected ? ", all brokerages" : ""}`}
          href={`/tax/${year}`}
          hrefLabel={`Open the ${year} Tax Center`}
        />
        <KpiCard
          label="Estimated tax"
          value={summary.estimatedTaxCad === null ? "Not set" : <Money value={summary.estimatedTaxCad} />}
          caption={
            summary.estimatedTaxCad === null ? (
              user.isDemo ? (
                "Needs your marginal tax rate"
              ) : (
                <Link href="/settings#marginal-rate" className="text-link hover:underline">
                  Set marginal rate <span aria-hidden>→</span>
                </Link>
              )
            ) : (
              `On ${year} capital gains at ${formatPercent(summary.marginalRate ?? 0, 2)}`
            )
          }
          href={`/tax/${year}`}
          hrefLabel={`Open the ${year} Tax Center`}
        />
        <KpiCard
          label="Alerts"
          value={
            <span className="flex items-center gap-3">
              <StatusDot tone={needAction > 0 ? "negative" : "positive"} className="size-2.5" />
              {attention.length}
            </span>
          }
          caption={
            attention.length === 0 ? "Nothing needs attention" : needAction > 0 ? `${needAction} need your action` : "For your information"
          }
          href="#attention"
          hrefLabel="Jump to what needs attention"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Card className="min-w-0 md:col-span-2 xl:col-span-5">
          <CardHeader className="pb-4 md:pb-4">
            <CardTitle>Portfolio value</CardTitle>
            <CardDescription>{scope}, from daily syncs</CardDescription>
          </CardHeader>
          <CardContent>
            <ValueChart points={history} today={today} />
          </CardContent>
        </Card>
        <Card className="min-w-0 xl:col-span-4">
          <CardHeader className="pb-4 md:pb-4">
            <CardTitle>Allocation by account type</CardTitle>
            <CardDescription>{scope}</CardDescription>
          </CardHeader>
          <CardContent>
            <AllocationDonut slices={allocationByType(shown)} totalCad={totalCad} />
          </CardContent>
        </Card>
        <Card id="attention" className="min-w-0 scroll-mt-12 xl:col-span-3">
          <CardHeader className="pb-4 md:pb-4">
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>All brokerages</CardDescription>
          </CardHeader>
          <CardContent>
            <AttentionList items={attention} />
          </CardContent>
        </Card>
      </div>

      <Card id="accounts" className="scroll-mt-12">
        <CardHeader>
          <CardTitle>Accounts by brokerage</CardTitle>
          <CardDescription>Confirm each account&apos;s type: it decides what is taxable.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {shown.length === 0 && pending.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No investment accounts found"
              description="SnapTrade did not share any investment accounts. Add a brokerage in your SnapTrade account, then refresh."
            />
          ) : (
            <>
              {shown.map((b) => (
                <BrokerageSection key={b.id} brokerage={b} totalCad={totalCad} readOnly={user.isDemo} />
              ))}
              {pending.map((b) => (
                <PendingBrokerageSection key={b.id} brokerage={b} />
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Investments</CardTitle>
          <CardDescription>
            {selected
              ? `Units and value at ${selected.name}. Non-registered units and ACB stay pooled across every brokerage.`
              : "Pooled by security across every brokerage, or one row per account. Select a row for its ACB audit trail."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HoldingsTable
            pooled={pooled}
            byAccount={perAccount}
            aside={
              matchShare === null && reconciliation.registered.length === 0 ? null : (
                <ReconciliationNote reconciliation={reconciliation} matchShare={matchShare} />
              )
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
