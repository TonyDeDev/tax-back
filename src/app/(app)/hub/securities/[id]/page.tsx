import type { Metadata } from "next";
import { ChevronDown, ChevronLeft, CircleCheck, Info, Layers, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { CorporateActionForm, DeleteCorporateActionButton } from "@/components/security/corporate-action-form";
import { ListingPool } from "@/components/security/listing-pool";
import { OpeningBalanceForm } from "@/components/security/opening-balance-form";
import { SalePreview } from "@/components/security/sale-preview";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACB_RULE_TEXT } from "@/lib/acb-rules";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { amountsHidden } from "@/server/amounts";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { type AuditStep, type SecurityDetail, canonicalSecurityId, getSecurityDetail } from "@/server/queries/security";
import { torontoToday } from "@/server/recompute";
import { waitingUntil } from "@/server/reconciliation";
import { D } from "@/tax-engine";

export const metadata: Metadata = { title: "Security" };

const listFormat = new Intl.ListFormat("en-CA", { type: "conjunction" });

const GAIN_LABELS: Record<SecurityDetail["gains"][number]["kind"], string> = {
  sale: "Sale",
  roc_excess: "Return of capital above ACB",
  deemed_disposition: "Deemed sale (moved to registered)",
  merger_cash: "Cash from merger",
};

function signedQuantity(value: string): string {
  const n = Number(value);
  return n === 0 ? "0" : `${n > 0 ? "+" : "-"}${formatQuantity(Math.abs(n))}`;
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Where a step's numbers came from, in the units the broker reported. */
function SourceDetail({ step }: { step: AuditStep }) {
  const src = step.source;
  if (src.type === "opening") {
    return (
      <p className="text-body-sm">
        Opening balance you entered as of {formatDate(src.asOfDate)}
        {src.note ? `: ${src.note}` : "."}
      </p>
    );
  }
  if (src.type === "corporate") {
    const verb = src.kind === "spinoff" ? (src.role === "source" ? `spun off ${src.otherSymbol}` : `spun off from ${src.otherSymbol}`) : src.role === "source" ? `merged into ${src.otherSymbol}` : `received in the merger of ${src.otherSymbol}`;
    return (
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Corporate action">{verb}</Figure>
        <Figure label="New shares per old">{formatQuantity(src.ratio, 6)}</Figure>
        {src.oldFmv && <Figure label="Old share value"><Money value={src.oldFmv} currency={src.currency} /></Figure>}
        {src.newFmv && <Figure label="New share value"><Money value={src.newFmv} currency={src.currency} /></Figure>}
        {Number(src.cashPerShare) > 0 && <Figure label="Cash per old share"><Money value={src.cashPerShare} currency={src.currency} /></Figure>}
      </dl>
    );
  }
  const cash = ["roc", "stock_dividend"].includes(step.kind);
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Figure label="Account">
        {src.brokerage ? `${src.brokerage} · ` : ""}
        {src.accountName} ({ACCOUNT_TYPE_LABELS[src.accountType]})
      </Figure>
      <Figure label="Trade date">{formatDate(src.tradeDate)}</Figure>
      {Number(src.quantity) > 0 && (
        <Figure label="Units x price">
          {formatQuantity(src.quantity)} x <Money value={src.price} currency={src.currency} />
        </Figure>
      )}
      {cash && Number(src.amount) > 0 && <Figure label="Amount"><Money value={src.amount} currency={src.currency} /></Figure>}
      {Number(src.fees) > 0 && <Figure label="Commission"><Money value={src.fees} currency={src.currency} /></Figure>}
      {step.fxRate && (
        <Figure label="Exchange rate">
          {src.currency === "CAD" ? "CAD, no conversion" : `1 ${src.currency} = ${Number(step.fxRate).toFixed(4)} CAD`}
        </Figure>
      )}
    </dl>
  );
}

function AuditTrail({ steps }: { steps: AuditStep[] }) {
  if (steps.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No ACB history yet"
        description="Buys, sales, return of capital, splits, transfers, and corporate actions in non-registered accounts appear here once synced."
      />
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-border rounded-md border">
      {steps.map((step) => {
        const text = ACB_RULE_TEXT[step.rule];
        return (
          <li key={step.seq} id={`step-${step.seq}`}>
            <details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent/50 sm:grid-cols-[6.5rem_minmax(0,1fr)_6rem_8rem_8rem_1rem] [&::-webkit-details-marker]:hidden">
                <span className="text-caption text-muted-foreground tabular-nums sm:text-body-sm">{formatDate(step.date)}</span>
                <span className="col-start-1 row-start-2 truncate text-body-sm font-medium sm:col-start-auto sm:row-start-auto">{text.label}</span>
                <span className="hidden text-right text-body-sm tabular-nums text-muted-foreground sm:block">{signedQuantity(step.quantityDelta)}</span>
                <span className="hidden text-right text-body-sm sm:block">
                  <Money value={step.acbDeltaCad} signed className="justify-end" />
                </span>
                <span className="row-span-2 flex flex-col items-end sm:row-span-1">
                  <span className="text-body-sm font-medium tabular-nums"><Money value={step.poolAcbAfterCad} /></span>
                  <span className="text-caption text-muted-foreground tabular-nums">{formatQuantity(step.poolQuantityAfter)} units</span>
                </span>
                <ChevronDown aria-hidden className="hidden size-4 text-muted-foreground transition-transform duration-(--motion-base) ease-in-out group-open:rotate-180 motion-reduce:transition-none sm:block" />
              </summary>
              <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3">
                <p className="text-body-sm">{text.rule}</p>
                <SourceDetail step={step} />
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Figure label="Units">{signedQuantity(step.quantityDelta)}</Figure>
                  <Figure label="ACB change">
                    <Money value={step.acbDeltaCad} signed />
                  </Figure>
                  <Figure label="Total ACB after"><Money value={step.poolAcbAfterCad} /></Figure>
                  <Figure label="ACB per unit after">{step.acbPerShareAfterCad ? <Money value={step.acbPerShareAfterCad} /> : "-"}</Figure>
                </dl>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** What a non-matching row means for the user, in words. */
function gapText(r: SecurityDetail["reconciliation"][number], gap: InstanceType<typeof D>): string {
  const units = r.status === "broker_has_more" ? `${formatQuantity(gap.toString())} units with no history` : `${formatQuantity(gap.neg().toString())} units unaccounted for`;
  if (r.gapClass === "registered") return `${units}, no effect on tax`;
  if (r.gapClass === "waiting") return `${units}, waiting for the broker to report recent trades`;
  return units;
}

function Reconciliation({ rows }: { rows: SecurityDetail["reconciliation"] }) {
  if (rows.length === 0) return <p className="text-body-sm text-muted-foreground">The brokers report no units of this security.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border">
      {rows.map((r, i) => {
        const gap = new D(r.brokerQuantity).minus(r.ledgerQuantity);
        const ok = r.status === "match" || r.gapClass === "registered";
        return (
          <li key={i} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {r.status === "match" ? (
                <CircleCheck aria-hidden className="size-4 shrink-0 text-positive" />
              ) : ok || r.gapClass === "waiting" ? (
                <Info aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-negative" />
              )}
              <span className="text-body-sm font-medium">
                {r.accountName ? `${r.accountName} (${ACCOUNT_TYPE_LABELS[r.accountType ?? "non_registered"]})` : "Non-registered accounts, pooled"}
              </span>
            </div>
            <span className="text-body-sm tabular-nums text-muted-foreground">
              Ledger {formatQuantity(r.ledgerQuantity)} · Broker {formatQuantity(r.brokerQuantity)}
              {r.status !== "match" && <span className={r.gapClass === "tax" ? "text-negative" : undefined}> · {gapText(r, gap)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A card, or on a registered-only security a closed one: out of the way, but one click from the same form. */
function Section({ title, description, collapsed, children }: { title: string; description: React.ReactNode; collapsed: boolean; children: React.ReactNode }) {
  const header = (
    <>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </>
  );
  if (!collapsed) {
    return (
      <Card>
        <CardHeader>{header}</CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <details className="group">
        <summary className="cursor-pointer list-none rounded-md hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <span className="flex flex-col gap-1">{header}</span>
            <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-base) ease-in-out group-open:rotate-180 motion-reduce:transition-none" />
          </CardHeader>
        </summary>
        <CardContent>{children}</CardContent>
      </details>
    </Card>
  );
}

export default async function SecurityPage(props: PageProps<"/hub/securities/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/hub/securities/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  // Listings of the same shares share one page: the canonical one, where their ACB is pooled.
  const canonical = await canonicalSecurityId(db, user.id, id);
  if (canonical !== id) redirect(`/hub/securities/${canonical}`);
  const [detail, hidden] = await Promise.all([getSecurityDetail(db, user.id, id, torontoToday()), amountsHidden()]);
  if (!detail) notFound();
  const { security, position } = detail;

  const pooledRow = detail.reconciliation.find((r) => r.accountId === null);
  const pooledGap = pooledRow?.status === "broker_has_more" ? pooledRow : undefined;
  const taxGap = pooledRow?.gapClass === "tax";
  const waiting = pooledRow?.gapClass === "waiting" ? pooledRow : undefined;
  const registeredGaps = detail.reconciliation.some((r) => r.gapClass === "registered");
  const suggestedQuantity = pooledGap ? new D(pooledGap.brokerQuantity).minus(pooledGap.ledgerQuantity).toString() : null;
  const registeredOnly = detail.registeredOnlyIn;
  // The opening balance is a non-registered ACB; a security that never touched one has nothing to open.
  const showOpening = !user.isDemo && !registeredOnly && (position !== null || pooledRow !== undefined || detail.opening !== null);

  return (
    <>
      <Link href="/hub" className="inline-flex items-center gap-1 text-body-sm text-link hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Hub
      </Link>
      <PageHeader
        title={security.symbol}
        description={[security.name, security.exchange, security.currency].filter(Boolean).join(" · ")}
        actions={
          taxGap ? (
            <Badge variant="negative">Ledger does not match broker</Badge>
          ) : waiting ? (
            <Badge variant="outline">Waiting for broker</Badge>
          ) : detail.reconciliation.length > 0 && !registeredOnly ? (
            <Badge variant="positive">Matches broker</Badge>
          ) : undefined
        }
      />

      {registeredOnly && (
        <p className="flex items-start gap-2 rounded-md border border-border px-4 py-3 text-body-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Held only in your {listFormat.format(registeredOnly)}, so nothing here affects your tax: registered accounts have no ACB, and their
            gains and dividends are not reported.
          </span>
        </p>
      )}

      {!registeredOnly && (
      <section aria-label="Position" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Units (non-registered)" value={formatQuantity(position?.quantity ?? 0)} hint="Pooled across brokerages" />
        <StatCard
          label="Total ACB"
          value={
            <a href="#audit" className="hover:underline" title="See every event that produced this number">
              <Money value={position?.totalAcbCad ?? 0} />
            </a>
          }
          hint="Select to see how it was built"
        />
        <StatCard label="ACB per unit" value={position ? <Money value={position.acbPerShareCad} /> : "-"} />
        <StatCard
          label="Unrealized"
          value={detail.unrealizedCad ? <Money value={detail.unrealizedCad} signed /> : "-"}
          hint={detail.marketValueCad ? `Market value ${formatMoney(detail.marketValueCad, "CAD", { hidden })}` : "No price yet"}
        />
      </section>
      )}

      {!registeredOnly && (
      <Card id="audit">
        <CardHeader>
          <CardTitle>ACB audit trail</CardTitle>
          <CardDescription>
            Every event that produced the ACB, pooled across all non-registered accounts, with the rule applied and the exchange rate used. Select
            a step for its receipts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTrail steps={detail.audit} />
        </CardContent>
      </Card>
      )}

      <Card id="reconciliation">
        <CardHeader>
          <CardTitle>Ledger vs broker</CardTitle>
          <CardDescription>
            TaxBack replays your history and compares the units it arrives at with what each broker holds today.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Reconciliation rows={detail.reconciliation} />
          {waiting && (
            <p className="text-caption text-muted-foreground">
              This gap appeared on {formatDate(waiting.gapSince!)}. Brokers often count a new trade in their holdings a day or so before they
              report it as an activity, so TaxBack waits until {formatDate(waitingUntil(waiting.gapSince!))} before asking you about it.
            </p>
          )}
          {registeredGaps && (
            <p className="text-caption text-muted-foreground">
              Registered accounts have no ACB, so a gap there only affects superficial loss checks. It usually means the broker shared less history
              than you have, and there is nothing to enter.
            </p>
          )}
        </CardContent>
      </Card>

      <Section
        title="Listings and dividends"
        description="The same shares on different exchanges are identical property: one ACB pool, and a purchase on either listing counts for superficial losses. Each trade is still converted at its own date's rate."
        collapsed={registeredOnly !== null}
      >
          <ListingPool
            poolId={security.id}
            symbol={security.symbol}
            listings={detail.listings}
            others={detail.otherSecurities}
            dividendOverride={detail.dividendOverride}
            automaticDividendClass={detail.automaticDividendClass}
            readOnly={user.isDemo}
          />
      </Section>

      {position && Number(position.quantity) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What if I sell?</CardTitle>
            <CardDescription>The same ledger run one step forward: the realized gain, and whether a superficial loss window is open.</CardDescription>
          </CardHeader>
          <CardContent>
            <SalePreview
              securityId={security.id}
              symbol={security.symbol}
              maxQuantity={new D(position.quantity).toString()}
              price={detail.price}
              currencies={[...new Set(detail.listings.map((l) => l.currency))]}
            />
          </CardContent>
        </Card>
      )}

      {detail.gains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Realized gains</CardTitle>
            <CardDescription>Dispositions of {security.symbol} in non-registered accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[40rem] text-body-sm tabular-nums">
                <thead className="text-caption text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Units</th>
                    <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                    <th className="px-3 py-2 text-right font-medium">ACB</th>
                    <th className="px-3 py-2 text-right font-medium">Outlays</th>
                    <th className="px-3 py-2 text-right font-medium">Counts for tax</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.gains.map((g, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">{formatDate(g.date)}</td>
                      <td className="px-3 py-2">
                        {GAIN_LABELS[g.kind]}
                        {Number(g.deniedLossCad) > 0 && <span className="block text-caption text-muted-foreground"><Money value={g.deniedLossCad} /> loss denied</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{formatQuantity(g.quantity)}</td>
                      <td className="px-3 py-2 text-right"><Money value={g.proceedsCad} /></td>
                      <td className="px-3 py-2 text-right"><Money value={g.acbCad} /></td>
                      <td className="px-3 py-2 text-right"><Money value={g.feesCad} /></td>
                      <td className="px-3 py-2 text-right">
                        <Money value={g.allowedGainCad} signed className="justify-end" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {showOpening && (
        <Card id="opening">
          <CardHeader>
            <CardTitle>Opening balance</CardTitle>
            <CardDescription>
              {waiting
                ? `Your brokers hold ${formatQuantity(suggestedQuantity ?? "0")} more units than the history explains, most likely a recent trade not reported yet. If the gap is still here on ${formatDate(waitingUntil(waiting.gapSince!))}, enter what those units cost.`
                : pooledGap
                  ? `Your brokers hold ${formatQuantity(suggestedQuantity ?? "0")} more units than the history explains, usually shares transferred in or bought before the history SnapTrade shares. Enter what they cost.`
                  : "For a position whose history is older than what your broker shares."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OpeningBalanceForm
              securityId={security.id}
              symbol={security.symbol}
              existing={detail.opening}
              // Dated at the first known activity, the opening holds only what came before it: the gap itself.
              suggestedQuantity={waiting ? null : suggestedQuantity}
              suggestedDate={detail.firstActivityDate}
            />
          </CardContent>
        </Card>
      )}

      <Section
        title="Corporate actions"
        description="Spinoffs and mergers move ACB between securities. Record them here, since brokers do not report them cleanly."
        collapsed={registeredOnly !== null}
      >
        <div className="flex flex-col gap-4">
          {detail.corporateActions.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-md border">
              {detail.corporateActions.map((a) => {
                const label =
                  a.kind === "spinoff"
                    ? a.role === "source"
                      ? `Spun off ${a.otherSymbol}`
                      : `Spun off from ${a.otherSymbol}`
                    : a.role === "source"
                      ? `Merged into ${a.otherSymbol}`
                      : `Received in the merger of ${a.otherSymbol}`;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="text-body-sm">
                      {formatDate(a.effectiveDate)} · {label} · {formatQuantity(a.ratio, 6)} new per old
                      {Number(a.cashPerShare) > 0 ? ` plus ${formatMoney(a.cashPerShare, a.currency, { hidden })} cash` : ""}
                    </span>
                    {!user.isDemo && a.role === "source" && <DeleteCorporateActionButton securityId={security.id} id={a.id} label={label} />}
                  </li>
                );
              })}
            </ul>
          )}
          {user.isDemo ? (
            <p className="text-body-sm text-muted-foreground">The demo is read-only. Sign in to record corporate actions.</p>
          ) : (
            <CorporateActionForm securityId={security.id} symbol={security.symbol} currency={security.currency} others={detail.otherSecurities} />
          )}
        </div>
      </Section>
    </>
  );
}
