import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, Link2 } from "lucide-react";
import { ConnectSnapTradeButton } from "@/components/auth/connect-snaptrade-button";
import { EmptyState } from "@/components/empty-state";
import { MarginalRateForm } from "@/components/settings/marginal-rate-form";
import { DeleteData } from "@/components/settings/delete-data";
import { NewConnectionHint } from "@/components/sync/sync-hints";
import { FirstSync } from "@/components/sync/first-sync";
import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAgo } from "@/lib/format";
import { hasSnapTradeGrant } from "@/server/auth/accounts";
import { configuredProviders } from "@/server/auth/config";
import { requireUser } from "@/server/auth/session";
import { SNAPTRADE_DASHBOARD_URL } from "@/server/auth/snaptrade-provider";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { getLastSuccessfulSyncAt, getLastSync } from "@/server/queries/hub";
import { D } from "@/tax-engine";

export const metadata: Metadata = { title: "Settings" };
// "Connect with SnapTrade" returns here, and the first sync runs as a server action on this page.
export const maxDuration = 300;

/** Better Auth sends `?error=<code>` back here when "Connect with SnapTrade" fails. */
function connectError(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "access_denied") return "SnapTrade access was not granted, so nothing was connected.";
  if (code === "account_ownership_conflict") return "That SnapTrade account is already connected to a different TaxBack account.";
  // The 5-minute state cookie expired, or SnapTrade returned to a different host (localhost vs 127.0.0.1).
  if (code === "state_mismatch" || code === "state_security_mismatch") {
    return "The connection timed out or came back to a different address. Click Connect with SnapTrade again and finish within 5 minutes.";
  }
  return "SnapTrade could not be connected. Try again.";
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const manageInSnapTrade = (
  <a
    href={SNAPTRADE_DASHBOARD_URL}
    target="_blank"
    rel="noopener noreferrer"
    className={buttonVariants({ variant: "outline", size: "sm" })}
  >
    Manage in SnapTrade
    <ExternalLink aria-hidden className="size-4" />
  </a>
);

export default async function Settings(props: PageProps<"/settings">) {
  const user = await requireUser("/settings");
  const params = await props.searchParams;
  const connected = !user.isDemo && (await hasSnapTradeGrant(getDb(), user.id));
  const error = connectError(first(params.error));
  const justConnected = connected && first(params.connected) === "snaptrade";
  const db = getDb();
  const [[lastSync, lastSuccessAt], [profile]] = await Promise.all([
    connected ? Promise.all([getLastSync(db, user.id), getLastSuccessfulSyncAt(db, user.id)]) : Promise.resolve([null, null] as const),
    db.select({ marginalRate: s.userProfiles.marginalRate }).from(s.userProfiles).where(eq(s.userProfiles.userId, user.id)),
  ]);
  // "0.43410" shows as "43.41".
  const ratePercent = profile?.marginalRate ? new D(profile.marginalRate).times(100).toString() : "";

  return (
    <>
      <PageHeader title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Follows your system theme until you pick one.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="text-body-sm">Theme</span>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card id="marginal-rate" className="scroll-mt-12">
        <CardHeader>
          <CardTitle>Tax estimate</CardTitle>
          <CardDescription>
            Your combined federal and provincial marginal tax rate. TaxBack multiplies it by your taxable capital gains to
            estimate the tax owed. Leave it blank for no estimate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarginalRateForm initialPercent={ratePercent} readOnly={user.isDemo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected brokerages</CardTitle>
          <CardDescription>
            TaxBack reads your brokerages through SnapTrade, read-only. You add, repair, or remove brokerages in your
            SnapTrade account, and TaxBack picks up the change on the next refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-body-sm text-destructive">
              {error}
            </p>
          )}
          {justConnected && (
            <p role="status" className="flex items-center gap-2 rounded-md border px-3 py-2 text-body-sm">
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-positive" />
              SnapTrade is connected.
              <NewConnectionHint align="start" />
            </p>
          )}
          {user.isDemo ? (
            <EmptyState
              icon={Link2}
              title="Sample brokerages"
              description="The demo uses sample data. Sign in to connect your own brokerages."
            />
          ) : connected ? (
            <>
              {!lastSync && <FirstSync />}
              <EmptyState
                icon={Link2}
                title="SnapTrade connected"
                description={`Brokerages you share in SnapTrade show up in the Hub after a refresh. ${
                  lastSuccessAt ? `Last synced ${formatAgo(lastSuccessAt, new Date())}.` : "Not synced yet."
                }`}
                action={manageInSnapTrade}
              />
            </>
          ) : (
            <EmptyState
              icon={Link2}
              title="No brokerages yet"
              description="Connect your SnapTrade account (free) to share your brokerages. You sign in to SnapTrade and approve read-only access."
              action={<ConnectSnapTradeButton disabled={!configuredProviders(getEnv()).snaptrade} />}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete my data</CardTitle>
          <CardDescription>Removes your connections, transactions, and tax results for good.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          <DeleteData disabledReason={user.isDemo ? "The demo is shared by every visitor, so it cannot be deleted." : undefined} />
        </CardContent>
      </Card>
    </>
  );
}
