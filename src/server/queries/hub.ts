import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { loadUserPools } from "@/server/db/pools";
import type { AnyDb } from "@/server/db/types";
import type { WarningView } from "@/lib/warnings";
import { latestRates } from "@/server/fx/boc";
import type { SyncErrorCode } from "@/server/sync/sync";
import { gapClass } from "@/server/reconciliation";
import { accountValue, valueHoldings } from "@/server/valuation";
import { D, type AccountType, type Dec } from "@/tax-engine";
import { addDays, yearOf } from "@/tax-engine/dates";

/*
 * Read queries for the Hub. Every query is scoped by `userId` first. Values are summed server side and
 * returned as decimal strings; the browser only formats them.
 */

export interface HubAccount {
  id: string;
  name: string;
  numberMasked: string | null;
  accountType: AccountType;
  /** Cash accounts hold no securities, so their type does not matter and is never asked for. */
  kind: "investment" | "cash";
  confirmed: boolean;
  /** SnapTrade does not list this account's holdings, so its value is the broker's reported total. */
  holdingsUnreported: boolean;
  /** Holdings plus cash in CAD (unrounded, so sums match the total), or null when an FX rate is missing. */
  valueCad: string | null;
}

export interface HubBrokerage {
  id: string;
  name: string;
  status: "active" | "broken";
  statusDetail: string | null;
  accounts: HubAccount[];
  /** Sum of the accounts that have a CAD value. */
  totalCad: string;
  /** True when an account could not be converted to CAD, so `totalCad` leaves it out. */
  totalIncomplete: boolean;
}

/** A SnapTrade connection with no accounts listed yet, e.g. a new Interactive Brokers connection still syncing. */
export interface HubPendingBrokerage {
  id: string;
  name: string;
  status: "active" | "broken";
  statusDetail: string | null;
}

export interface HubSync {
  status: "running" | "succeeded" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  errorCode: SyncErrorCode | null;
}


export interface HubSummary {
  brokerages: HubBrokerage[];
  /** Connections SnapTrade lists no accounts for; kept out of `brokerages`, the filter, and the totals. */
  pendingBrokerages: HubPendingBrokerage[];
  totalValueCad: string;
  /** True when some value could not be converted to CAD, so the total leaves it out. */
  totalIncomplete: boolean;
  ytdGainCad: string;
  /** Null when the user has not set a marginal rate, so there is no estimate. */
  estimatedTaxCad: string | null;
  marginalRate: string | null;
  warnings: WarningView[];
  unconfirmedAccounts: number;
}

/** The latest sync, plus whether any sync has ever been attempted. */
export async function getLastSync(db: AnyDb, userId: string): Promise<HubSync | null> {
  const [run] = await db
    .select({
      status: s.syncRuns.status,
      startedAt: s.syncRuns.startedAt,
      finishedAt: s.syncRuns.finishedAt,
      error: s.syncRuns.error,
      stats: s.syncRuns.stats,
    })
    .from(s.syncRuns)
    .where(eq(s.syncRuns.userId, userId))
    .orderBy(desc(s.syncRuns.startedAt))
    .limit(1);
  if (!run) return null;
  const code = (run.stats as { errorCode?: SyncErrorCode } | null)?.errorCode ?? null;
  return { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, errorCode: code };
}

export async function getLastSuccessfulSyncAt(db: AnyDb, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: s.syncRuns.finishedAt })
    .from(s.syncRuns)
    .where(and(eq(s.syncRuns.userId, userId), eq(s.syncRuns.status, "succeeded")))
    .orderBy(desc(s.syncRuns.startedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

export async function getHubSummary(db: AnyDb, userId: string, today: string): Promise<HubSummary> {
  const [connections, accounts, valuation, [year], warnings, [profile]] = await Promise.all([
    db
      .select({
        id: s.connections.id,
        name: s.connections.brokerageName,
        status: s.connections.status,
        statusDetail: s.connections.statusDetail,
      })
      .from(s.connections)
      .where(eq(s.connections.userId, userId))
      .orderBy(asc(s.connections.brokerageName)),
    db
      .select({
        id: s.brokerageAccounts.id,
        connectionId: s.brokerageAccounts.connectionId,
        name: s.brokerageAccounts.name,
        numberMasked: s.brokerageAccounts.numberMasked,
        accountType: s.brokerageAccounts.accountType,
        kind: s.brokerageAccounts.kind,
        confirmedAt: s.brokerageAccounts.accountTypeConfirmedAt,
        holdingsUnreported: s.brokerageAccounts.holdingsUnreported,
      })
      .from(s.brokerageAccounts)
      .where(eq(s.brokerageAccounts.userId, userId))
      .orderBy(asc(s.brokerageAccounts.name)),
    valueHoldings(db, userId, today),
    db
      .select({ net: s.taxYearSummaries.netCapitalGainCad, tax: s.taxYearSummaries.estimatedTaxCad })
      .from(s.taxYearSummaries)
      .where(and(eq(s.taxYearSummaries.userId, userId), eq(s.taxYearSummaries.taxYear, yearOf(today)))),
    db
      .select({
        type: s.taxWarnings.type,
        securityId: s.taxWarnings.securityId,
        symbol: s.securities.symbol,
        taxYear: s.taxWarnings.taxYear,
        amountCad: s.taxWarnings.amountCad,
        shortfallQuantity: s.taxWarnings.shortfallQuantity,
        dueDate: s.taxWarnings.dueDate,
      })
      .from(s.taxWarnings)
      .leftJoin(s.securities, eq(s.securities.id, s.taxWarnings.securityId))
      .where(eq(s.taxWarnings.userId, userId))
      .orderBy(asc(s.taxWarnings.type), asc(s.securities.symbol)),
    db.select({ marginalRate: s.userProfiles.marginalRate }).from(s.userProfiles).where(eq(s.userProfiles.userId, userId)),
  ]);

  let total = new D(0);
  let totalIncomplete = false;
  const byConnection = new Map<string, HubAccount[]>();
  const connectionTotals = new Map<string, Dec>();
  for (const a of accounts) {
    const v = accountValue(valuation, a.id);
    if (v === null) totalIncomplete = true;
    else {
      total = total.plus(v);
      connectionTotals.set(a.connectionId, (connectionTotals.get(a.connectionId) ?? new D(0)).plus(v));
    }
    const list = byConnection.get(a.connectionId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      numberMasked: a.numberMasked,
      accountType: a.accountType,
      kind: a.kind,
      confirmed: a.confirmedAt !== null,
      holdingsUnreported: a.holdingsUnreported,
      valueCad: v === null ? null : v.toFixed(6),
    });
    byConnection.set(a.connectionId, list);
  }

  return {
    pendingBrokerages: connections.filter((c) => !byConnection.has(c.id)),
    brokerages: connections
      .map((c) => ({ ...c, accounts: byConnection.get(c.id) ?? [] }))
      .filter((c) => c.accounts.length > 0)
      .map((c) => ({
        ...c,
        totalCad: (connectionTotals.get(c.id) ?? new D(0)).toFixed(2),
        totalIncomplete: c.accounts.some((a) => a.valueCad === null),
      })),
    totalValueCad: total.toFixed(2),
    totalIncomplete,
    ytdGainCad: year?.net ?? "0",
    marginalRate: profile?.marginalRate ?? null,
    // A rate with no gains yet this year is an estimate of zero, not a missing one.
    estimatedTaxCad: profile?.marginalRate ? (year?.tax ?? "0") : null,
    warnings,
    unconfirmedAccounts: accounts.filter((a) => a.kind === "investment" && a.confirmedAt === null).length,
  };
}

export interface InvestmentRow {
  securityId: string;
  symbol: string;
  name: string | null;
  /** Units the brokers report across every account, registered included. */
  brokerQuantity: string;
  /** The pooled non-registered position the ACB applies to. */
  pooledQuantity: string;
  totalAcbCad: string | null;
  acbPerShareCad: string | null;
  /** Every account's units at the latest price, or null without a price or rate. */
  marketValueCad: string | null;
  /** Pooled units' market value less their ACB. */
  unrealizedCad: string | null;
  /** Daily CAD prices for the sparkline, oldest first; empty until two syncs have run. */
  trend: string[];
}

/** Days of price history behind each Hub sparkline. */
export const TREND_DAYS = 90;

/**
 * One row per security held anywhere or carrying ACB, largest value first. Listings of the same shares
 * (RY on the TSX and the NYSE) are one row, under the canonical listing the ACB is pooled on.
 */
export async function getInvestments(
  db: AnyDb,
  userId: string,
  today: string,
  /** Only count units held in these accounts (a brokerage filter). ACB stays pooled across every account. */
  accountIds?: readonly string[],
): Promise<InvestmentRow[]> {
  const [positions, rawHoldings, { pools }] = await Promise.all([
    db
      .select({
        securityId: s.acbPositions.securityId,
        quantity: s.acbPositions.quantity,
        totalAcbCad: s.acbPositions.totalAcbCad,
        acbPerShareCad: s.acbPositions.acbPerShareCad,
      })
      .from(s.acbPositions)
      .where(eq(s.acbPositions.userId, userId)),
    db
      .select({
        securityId: s.holdings.securityId,
        accountId: s.holdings.accountId,
        quantity: s.holdings.quantity,
        price: s.holdings.price,
        currency: s.holdings.currency,
      })
      .from(s.holdings)
      .innerJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.holdings.accountId))
      .where(and(eq(s.holdings.userId, userId), eq(s.brokerageAccounts.kind, "investment"))),
    loadUserPools(db, userId),
  ]);
  const holdings = rawHoldings
    .filter((h) => !accountIds || accountIds.includes(h.accountId))
    .map((h) => ({ ...h, listingId: h.securityId, securityId: pools.poolOf(h.securityId) }));
  // Filtered to a brokerage, a security shows only when that brokerage holds it.
  const ids = accountIds
    ? [...new Set(holdings.map((h) => h.securityId))]
    : [...new Set([...positions.map((p) => p.securityId), ...holdings.map((h) => h.securityId)])];
  if (ids.length === 0) return [];
  const securities = await db
    .select({ id: s.securities.id, symbol: s.securities.symbol, name: s.securities.name })
    .from(s.securities)
    .where(inArray(s.securities.id, ids));
  const [rates, trends] = await Promise.all([
    latestRates(db, [...new Set(holdings.map((h) => h.currency))], today),
    getPriceTrends(db, userId, today),
  ]);

  const rows = ids.map((id) => {
    const security = securities.find((x) => x.id === id);
    const position = positions.find((p) => p.securityId === id);
    const held = holdings.filter((h) => h.securityId === id);
    const brokerQuantity = held.reduce((sum, h) => sum.plus(h.quantity), new D(0));
    // Value each listing at its own price and currency; pooled listings trade at slightly different prices.
    let marketValue: Dec | null = new D(0);
    for (const h of held) {
      const rate = rates.get(h.currency);
      marketValue = marketValue && h.price !== null && rate ? marketValue.plus(new D(h.quantity).times(h.price).times(rate)) : null;
    }
    if (held.length === 0) marketValue = null;
    const priced = held.find((h) => h.price !== null && rates.has(h.currency));
    const unitCad = priced ? new D(priced.price!).times(rates.get(priced.currency)!) : null;
    return {
      securityId: id,
      symbol: security?.symbol ?? "?",
      name: security?.name ?? null,
      brokerQuantity: brokerQuantity.toString(),
      pooledQuantity: position?.quantity ?? "0",
      totalAcbCad: position?.totalAcbCad ?? null,
      acbPerShareCad: position?.acbPerShareCad ?? null,
      marketValueCad: marketValue ? marketValue.toFixed(2) : null,
      unrealizedCad: unitCad && position ? new D(position.quantity).times(unitCad).minus(position.totalAcbCad).toFixed(2) : null,
      // The canonical listing's prices, or a held listing's when only another listing of the pool is held.
      trend: trends.get(id) ?? held.map((h) => trends.get(h.listingId)).find((x) => x !== undefined) ?? [],
    };
  });
  return rows.sort((a, b) => Number(b.marketValueCad ?? 0) - Number(a.marketValueCad ?? 0) || (a.symbol < b.symbol ? -1 : 1));
}

export interface ReconciliationGap {
  securityId: string;
  symbol: string;
  /** Null for the pooled non-registered position. */
  accountName: string | null;
  ledgerQuantity: string;
  brokerQuantity: string;
  status: "broker_has_more" | "ledger_has_more";
  /** The day a gap appeared on a later sync; null when it has been there since the first one. */
  gapSince: string | null;
}

export interface ReconciliationSummary {
  /** Non-registered positions only, pooled per security: the ones ACB depends on. */
  matched: number;
  total: number;
  /** Non-registered gaps that change tax: the user is asked to fix these. */
  gaps: ReconciliationGap[];
  /** Non-registered gaps that appeared in the last few days, likely trades the broker has not reported yet. */
  waiting: ReconciliationGap[];
  /** Gaps inside registered accounts: no ACB, so no effect on tax. */
  registered: ReconciliationGap[];
}

/** "Ledger matches broker positions": how many positions agree, and the ones that do not, by class. */
export async function getReconciliation(db: AnyDb, userId: string, today: string): Promise<ReconciliationSummary> {
  const rows = await db
    .select({
      securityId: s.positionReconciliations.securityId,
      symbol: s.securities.symbol,
      accountId: s.positionReconciliations.accountId,
      accountName: s.brokerageAccounts.name,
      ledgerQuantity: s.positionReconciliations.ledgerQuantity,
      brokerQuantity: s.positionReconciliations.brokerQuantity,
      status: s.positionReconciliations.status,
      gapSince: s.positionReconciliations.gapSince,
    })
    .from(s.positionReconciliations)
    .innerJoin(s.securities, eq(s.securities.id, s.positionReconciliations.securityId))
    .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.positionReconciliations.accountId))
    .where(eq(s.positionReconciliations.userId, userId))
    .orderBy(asc(s.securities.symbol));
  const pooled = rows.filter((r) => r.accountId === null);
  const summary: ReconciliationSummary = {
    matched: pooled.filter((r) => r.status === "match").length,
    total: pooled.length,
    gaps: [],
    waiting: [],
    registered: [],
  };
  const bucket = { tax: summary.gaps, waiting: summary.waiting, registered: summary.registered };
  for (const { accountId, status, ...r } of rows) {
    if (status === "match") continue;
    bucket[gapClass({ accountId, gapSince: r.gapSince }, today)].push({ ...r, status });
  }
  return summary;
}

/** Recent daily CAD prices per listing, oldest first, from the snapshots each sync writes. */
async function getPriceTrends(db: AnyDb, userId: string, today: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ securityId: s.securityPriceSnapshots.securityId, priceCad: s.securityPriceSnapshots.priceCad })
    .from(s.securityPriceSnapshots)
    .where(and(eq(s.securityPriceSnapshots.userId, userId), gte(s.securityPriceSnapshots.day, addDays(today, -TREND_DAYS))))
    .orderBy(asc(s.securityPriceSnapshots.day));
  const trends = new Map<string, string[]>();
  for (const r of rows) {
    const list = trends.get(r.securityId) ?? [];
    list.push(r.priceCad);
    trends.set(r.securityId, list);
  }
  return trends;
}

export interface HoldingByAccount {
  /** The pooled security, which the security page and ACB audit trail are keyed on. */
  securityId: string;
  symbol: string;
  name: string | null;
  accountId: string;
  accountName: string;
  brokerageName: string;
  accountType: AccountType;
  quantity: string;
  /** Null without a price or a CAD rate. */
  marketValueCad: string | null;
}

/** One row per security per account, for the Hub's "By account" view. Largest value first. */
export async function getHoldingsByAccount(
  db: AnyDb,
  userId: string,
  today: string,
  accountIds?: readonly string[],
): Promise<HoldingByAccount[]> {
  const [rows, { pools }] = await Promise.all([
    db
      .select({
        securityId: s.holdings.securityId,
        symbol: s.securities.symbol,
        name: s.securities.name,
        accountId: s.holdings.accountId,
        accountName: s.brokerageAccounts.name,
        brokerageName: s.connections.brokerageName,
        accountType: s.brokerageAccounts.accountType,
        quantity: s.holdings.quantity,
        price: s.holdings.price,
        currency: s.holdings.currency,
      })
      .from(s.holdings)
      .innerJoin(s.securities, eq(s.securities.id, s.holdings.securityId))
      .innerJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.holdings.accountId))
      .innerJoin(s.connections, eq(s.connections.id, s.brokerageAccounts.connectionId))
      .where(and(eq(s.holdings.userId, userId), eq(s.brokerageAccounts.kind, "investment"))),
    loadUserPools(db, userId),
  ]);
  const kept = rows.filter((r) => !accountIds || accountIds.includes(r.accountId));
  const rates = await latestRates(db, [...new Set(kept.map((r) => r.currency))], today);
  return kept
    .map((r) => {
      const rate = rates.get(r.currency);
      return {
        securityId: pools.poolOf(r.securityId),
        symbol: r.symbol,
        name: r.name,
        accountId: r.accountId,
        accountName: r.accountName,
        brokerageName: r.brokerageName,
        accountType: r.accountType,
        quantity: new D(r.quantity).toString(),
        marketValueCad: r.price !== null && rate ? new D(r.quantity).times(r.price).times(rate).toFixed(2) : null,
      };
    })
    .sort((a, b) => Number(b.marketValueCad ?? 0) - Number(a.marketValueCad ?? 0) || (a.symbol < b.symbol ? -1 : 1));
}

export interface ValuePoint {
  day: string;
  valueCad: string;
}

/** Total value per snapshot day, oldest first, optionally for some accounts only. */
export async function getValueHistory(db: AnyDb, userId: string, accountIds?: readonly string[]): Promise<ValuePoint[]> {
  if (accountIds && accountIds.length === 0) return [];
  const rows = await db
    .select({ day: s.accountValueSnapshots.day, valueCad: sql<string>`sum(${s.accountValueSnapshots.valueCad})` })
    .from(s.accountValueSnapshots)
    .where(
      and(
        eq(s.accountValueSnapshots.userId, userId),
        accountIds ? inArray(s.accountValueSnapshots.accountId, [...accountIds]) : undefined,
      ),
    )
    .groupBy(s.accountValueSnapshots.day)
    .orderBy(asc(s.accountValueSnapshots.day));
  return rows.map((r) => ({ day: r.day, valueCad: new D(r.valueCad).toFixed(2) }));
}

export interface ValueChange {
  /** The latest snapshot less the one before it. */
  changeCad: string;
  /** The earlier snapshot's day, which the change is measured from. */
  sinceDay: string;
}

/** The change between the last two snapshots, or null with fewer than two. */
export function latestChange(history: readonly ValuePoint[]): ValueChange | null {
  const last = history.at(-1);
  const previous = history.at(-2);
  if (!last || !previous) return null;
  return { changeCad: new D(last.valueCad).minus(previous.valueCad).toFixed(2), sinceDay: previous.day };
}

export type AllocationKey = "non_registered" | "tfsa" | "rrsp" | "other_registered" | "cash";

export interface AllocationSlice {
  key: AllocationKey;
  label: string;
  valueCad: string;
  /** Share of the total, 0 to 1, as a decimal string. */
  share: string;
}

const ALLOCATION_LABELS: Record<AllocationKey, string> = {
  non_registered: "Non-registered",
  tfsa: "TFSA",
  rrsp: "RRSP",
  other_registered: "Other registered",
  cash: "Cash",
};

/**
 * Value by account type. Cash accounts are their own slice; uninvested cash inside a TFSA stays TFSA.
 * Every type the user has an account in is listed, even at zero, so the mix reads honestly.
 */
export function allocationByType(brokerages: readonly HubBrokerage[]): AllocationSlice[] {
  const sums = new Map<AllocationKey, Dec>();
  for (const a of brokerages.flatMap((b) => b.accounts)) {
    const key: AllocationKey =
      a.kind === "cash"
        ? "cash"
        : a.accountType === "non_registered" || a.accountType === "tfsa" || a.accountType === "rrsp"
          ? a.accountType
          : "other_registered";
    sums.set(key, (sums.get(key) ?? new D(0)).plus(a.valueCad ?? 0));
  }
  const total = [...sums.values()].reduce((x, y) => x.plus(y), new D(0));
  return (Object.keys(ALLOCATION_LABELS) as AllocationKey[])
    .filter((key) => sums.has(key))
    .map((key) => ({
      key,
      label: ALLOCATION_LABELS[key],
      valueCad: sums.get(key)!.toFixed(2),
      share: total.isZero() ? "0" : sums.get(key)!.div(total).toFixed(6),
    }));
}
