import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Briefcase, PieChart, TableProperties, TriangleAlert } from "lucide-react";
import { ConnectSnapTradeButton } from "@/components/auth/connect-snaptrade-button";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { AccountTypeSelect } from "@/components/sync/account-type-select";
import { FirstSync } from "@/components/sync/first-sync";
import { RefreshButton } from "@/components/sync/refresh-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAgo } from "@/lib/format";
import { warningMessage } from "@/lib/warnings";
import { hasSnapTradeGrant } from "@/server/auth/accounts";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { type HubSummary, type HubSync, getHubSummary, getLastSuccessfulSyncAt, getLastSync } from "@/server/queries/hub";
import { torontoToday } from "@/server/recompute";
import { SYNC_COOLDOWN_MS } from "@/server/sync/sync";

export const metadata: Metadata = { title: "Hub" };
// Refresh and the first sync run as server actions on this page; they read every brokerage account.
export const maxDuration = 300;

function refreshState(lastSync: HubSync, lastSuccessAt: Date | null, now: Date) {
  const status = lastSuccessAt ? `Synced ${formatAgo(lastSuccessAt, now)}` : "Not synced yet";
  if (lastSync.status === "running") return { status, disabledReason: "A sync is running." };
  if (lastSync.status === "succeeded") {
    const minutes = Math.ceil((lastSync.startedAt.getTime() + SYNC_COOLDOWN_MS - now.getTime()) / 60_000);
    if (minutes > 0) return { status, disabledReason: `You can refresh again in ${minutes} min.` };
  }
  return { status, disabledReason: null };
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

function Summary({ summary }: { summary: HubSummary | null }) {
  const alerts = (summary?.warnings.length ?? 0) + (summary?.unconfirmedAccounts ? 1 : 0);
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Total value"
        value={<Money value={summary?.totalValueCad ?? 0} />}
        hint={summary?.totalIncomplete ? "Some accounts could not be converted to CAD" : "Holdings and cash, in CAD"}
      />
      <StatCard label="YTD realized gains" value={<Money value={summary?.ytdGainCad ?? 0} signed />} hint="Non-registered accounts" />
      <StatCard
        label="Estimated tax"
        value={summary?.estimatedTaxCad ? <Money value={summary.estimatedTaxCad} /> : "Not set"}
        hint={summary?.estimatedTaxCad ? "On capital gains only" : "Needs your marginal tax rate"}
      />
      <StatCard label="Alerts" value={String(alerts)} />
    </section>
  );
}

function Alerts({ summary }: { summary: HubSummary }) {
  const items = [
    ...(summary.unconfirmedAccounts > 0
      ? [
          `${summary.unconfirmedAccounts} ${summary.unconfirmedAccounts === 1 ? "account needs its" : "accounts need their"} type confirmed below. TaxBack guessed it from the broker, and the type decides what is taxable.`,
        ]
      : []),
    ...summary.warnings.map(warningMessage),
  ];
  if (items.length === 0) return <EmptyState icon={Bell} title="Nothing needs attention" />;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((text, i) => (
        <li key={i} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="text-body-sm">{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Accounts({ summary }: { summary: HubSummary }) {
  if (summary.brokerages.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No investment accounts found"
        description="SnapTrade did not share any investment accounts. Add a brokerage in your SnapTrade account, then refresh."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {summary.brokerages.map((b) => (
        <section key={b.id} aria-label={b.name} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-medium">{b.name}</h3>
            {b.status === "broken" && <Badge variant="negative">Needs attention</Badge>}
          </div>
          {b.status === "broken" && b.statusDetail && (
            <p className="text-caption text-muted-foreground">{b.statusDetail}</p>
          )}
          <ul className="flex flex-col divide-y divide-border rounded-md border">
            {b.accounts.map((a) => (
              // Phones: name and value on one line, the type picker below. Wider: name | picker | value.
              <li
                key={a.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_14rem_7rem]"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body-sm font-medium">{a.name}</span>
                  {a.numberMasked && (
                    <span className="font-mono text-caption text-muted-foreground">
                      <span className="sr-only">Account ending in </span>
                      <span aria-hidden>•••• </span>
                      {a.numberMasked}
                    </span>
                  )}
                </div>
                <span className="text-right text-body-sm sm:order-last">
                  {a.valueCad === null ? <span className="text-muted-foreground">No CAD rate</span> : <Money value={a.valueCad} />}
                </span>
                <div className="col-span-2 sm:col-span-1">
                  {a.kind === "cash" ? (
                    <Badge variant="outline" title="Holds cash only, so it never affects capital gains.">
                      Cash account
                    </Badge>
                  ) : (
                    <AccountTypeSelect accountId={a.id} accountName={a.name} value={a.accountType} confirmed={a.confirmed} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default async function Hub() {
  const user = await requireUser("/hub");
  const db = getDb();
  const connected = !user.isDemo && (await hasSnapTradeGrant(db, user.id));
  const lastSync = connected ? await getLastSync(db, user.id) : null;
  const [summary, lastSuccessAt] =
    connected && lastSync
      ? await Promise.all([getHubSummary(db, user.id, torontoToday()), getLastSuccessfulSyncAt(db, user.id)])
      : [null, null];
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Hub"
        description="Every account in one place, with Canadian tax insight."
        actions={lastSync ? <RefreshButton {...refreshState(lastSync, lastSuccessAt, now)} /> : undefined}
      />

      {connected && !lastSync && <FirstSync />}
      {lastSync?.status === "failed" && <SyncProblem sync={lastSync} />}

      <Summary summary={summary} />

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>Superficial losses, missing history, and accounts to confirm.</CardDescription>
        </CardHeader>
        <CardContent>{summary ? <Alerts summary={summary} /> : <EmptyState icon={Bell} title="Nothing needs attention" />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Grouped by brokerage. Confirm each account&apos;s type so the tax numbers are right.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary ? (
            <Accounts summary={summary} />
          ) : (
            <EmptyState
              icon={Briefcase}
              title={connected ? "Waiting for the first sync" : "No accounts yet"}
              description={
                connected
                  ? "Your accounts show up here once SnapTrade has been read."
                  : user.isDemo
                    ? "The demo portfolio is on its way."
                    : "Connect your SnapTrade account to see your brokerages here."
              }
              action={
                connected || user.isDemo ? undefined : (
                  <Link href="/settings" className={buttonVariants({ size: "sm" })}>
                    Go to Settings
                  </Link>
                )
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Investments</CardTitle>
          <CardDescription>Pooled by security, with a per-account view.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={TableProperties} title="No investments to show" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocation</CardTitle>
          <CardDescription>By security, account type, and currency.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState icon={PieChart} title="No allocation data yet" />
        </CardContent>
      </Card>
    </>
  );
}
