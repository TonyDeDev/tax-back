import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Briefcase, CircleCheck, PieChart, Scale, TableProperties, TriangleAlert } from "lucide-react";
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
import { formatAgo, formatPercent, formatQuantity } from "@/lib/format";
import { warningMessage } from "@/lib/warnings";
import { hasSnapTradeGrant } from "@/server/auth/accounts";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  type HubSummary,
  type HubSync,
  type InvestmentRow,
  type ReconciliationSummary,
  getHubSummary,
  getInvestments,
  getLastSuccessfulSyncAt,
  getLastSync,
  getReconciliation,
} from "@/server/queries/hub";
import { ensureDemoSeeded } from "@/server/demo/seed";
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

function Accounts({ summary, readOnly }: { summary: HubSummary; readOnly: boolean }) {
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
                    <AccountTypeSelect accountId={a.id} accountName={a.name} value={a.accountType} confirmed={a.confirmed} readOnly={readOnly} />
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

function Investments({ rows }: { rows: InvestmentRow[] }) {
  if (rows.length === 0) return <EmptyState icon={TableProperties} title="No investments to show" />;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[40rem] text-body-sm tabular-nums">
        <thead className="text-caption text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">Security</th>
            <th className="px-3 py-2 text-right font-medium">Units, all accounts</th>
            <th className="px-3 py-2 text-right font-medium">Market value</th>
            <th className="px-3 py-2 text-right font-medium">Non-registered units</th>
            <th className="px-3 py-2 text-right font-medium">Pooled ACB</th>
            <th className="px-3 py-2 text-right font-medium">Unrealized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.securityId} className="border-b last:border-0 hover:bg-accent/50">
              <td className="px-3 py-2">
                <Link href={`/hub/securities/${r.securityId}`} className="font-medium text-link hover:underline">
                  {r.symbol}
                </Link>
                {r.name && <span className="block max-w-[14rem] truncate text-caption text-muted-foreground">{r.name}</span>}
              </td>
              <td className="px-3 py-2 text-right">{formatQuantity(r.brokerQuantity)}</td>
              <td className="px-3 py-2 text-right">{r.marketValueCad ? <Money value={r.marketValueCad} /> : "-"}</td>
              <td className="px-3 py-2 text-right">{formatQuantity(r.pooledQuantity)}</td>
              <td className="px-3 py-2 text-right">
                {r.totalAcbCad ? (
                  <Link href={`/hub/securities/${r.securityId}#audit`} className="hover:underline" title="See how this ACB was built">
                    <Money value={r.totalAcbCad} />
                  </Link>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-3 py-2 text-right">{r.unrealizedCad ? <Money value={r.unrealizedCad} signed className="justify-end" /> : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerVsBroker({ summary }: { summary: ReconciliationSummary }) {
  if (summary.total === 0) return <EmptyState icon={Scale} title="Nothing to compare yet" description="Positions are compared after the first sync." />;
  const share = summary.matched / summary.total;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {summary.gaps.length === 0 ? (
          <CircleCheck aria-hidden className="size-6 shrink-0 text-positive" />
        ) : (
          <TriangleAlert aria-hidden className="size-6 shrink-0 text-negative" />
        )}
        <p className="text-body">
          Ledger matches broker positions: <strong className="tabular-nums">{formatPercent(share, share === 1 ? 0 : 1)}</strong>{" "}
          <span className="text-muted-foreground tabular-nums">
            ({summary.matched} of {summary.total})
          </span>
        </p>
      </div>
      {summary.gaps.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border">
          {summary.gaps.map((g, i) => (
            <li key={i} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-body-sm">
                <Link href={`/hub/securities/${g.securityId}`} className="font-medium text-link hover:underline">
                  {g.symbol}
                </Link>{" "}
                <span className="text-muted-foreground">{g.accountName ?? "non-registered, pooled"}</span>
              </span>
              <span className="text-body-sm tabular-nums text-muted-foreground">
                Ledger {formatQuantity(g.ledgerQuantity)} · Broker {formatQuantity(g.brokerQuantity)} ·{" "}
                {g.status === "broker_has_more" ? (
                  <Link href={`/hub/securities/${g.securityId}#opening`} className="text-link hover:underline">
                    {g.accountName ? "history missing" : "add an opening balance"}
                  </Link>
                ) : (
                  "units unaccounted for"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function Hub() {
  const user = await requireUser("/hub");
  const db = getDb();
  const connected = !user.isDemo && (await hasSnapTradeGrant(db, user.id));
  const lastSync = connected ? await getLastSync(db, user.id) : null;
  const today = torontoToday();
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
  const [summary, lastSuccessAt, investments, reconciliation] =
    demoReady || (connected && lastSync)
      ? await Promise.all([
          getHubSummary(db, user.id, today),
          getLastSuccessfulSyncAt(db, user.id),
          getInvestments(db, user.id, today),
          getReconciliation(db, user.id),
        ])
      : [null, null, null, null];
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
            <Accounts summary={summary} readOnly={user.isDemo} />
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
          <CardDescription>Pooled by security. Select a security or its ACB for the full audit trail.</CardDescription>
        </CardHeader>
        <CardContent>
          {investments ? <Investments rows={investments} /> : <EmptyState icon={TableProperties} title="No investments to show" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger vs broker</CardTitle>
          <CardDescription>Your full history replayed, then compared with the units each broker reports holding today.</CardDescription>
        </CardHeader>
        <CardContent>
          {reconciliation ? <LedgerVsBroker summary={reconciliation} /> : <EmptyState icon={Scale} title="Nothing to compare yet" />}
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
