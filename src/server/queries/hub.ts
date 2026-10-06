import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import type { WarningView } from "@/lib/warnings";
import { latestRates } from "@/server/fx/boc";
import type { SyncErrorCode } from "@/server/sync/sync";
import { D, type AccountType, type Dec } from "@/tax-engine";
import { yearOf } from "@/tax-engine/dates";

/*
 * Read queries for the Hub. Every query is scoped by `userId` first. Values are summed server side and
 * returned as decimal strings; the browser only formats them.
 */

export interface HubAccount {
  id: string;
  name: string;
  numberMasked: string | null;
  accountType: AccountType;
  confirmed: boolean;
  /** Holdings plus cash in CAD, or null when an FX rate is missing for one of its currencies. */
  valueCad: string | null;
}

export interface HubBrokerage {
  id: string;
  name: string;
  status: "active" | "broken";
  statusDetail: string | null;
  accounts: HubAccount[];
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
  totalValueCad: string;
  /** True when some value could not be converted to CAD, so the total leaves it out. */
  totalIncomplete: boolean;
  ytdGainCad: string;
  estimatedTaxCad: string | null;
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
  const [connections, accounts, holdings, balances, [year], warnings] = await Promise.all([
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
        confirmedAt: s.brokerageAccounts.accountTypeConfirmedAt,
      })
      .from(s.brokerageAccounts)
      .where(eq(s.brokerageAccounts.userId, userId))
      .orderBy(asc(s.brokerageAccounts.name)),
    db
      .select({ accountId: s.holdings.accountId, currency: s.holdings.currency, marketValue: s.holdings.marketValue })
      .from(s.holdings)
      .where(eq(s.holdings.userId, userId)),
    db
      .select({ accountId: s.accountBalances.accountId, currency: s.accountBalances.currency, cash: s.accountBalances.cash })
      .from(s.accountBalances)
      .where(eq(s.accountBalances.userId, userId)),
    db
      .select({ net: s.taxYearSummaries.netCapitalGainCad, tax: s.taxYearSummaries.estimatedTaxCad })
      .from(s.taxYearSummaries)
      .where(and(eq(s.taxYearSummaries.userId, userId), eq(s.taxYearSummaries.taxYear, yearOf(today)))),
    db
      .select({
        type: s.taxWarnings.type,
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
  ]);

  const currencies = [...new Set([...holdings.map((h) => h.currency), ...balances.map((b) => b.currency)])];
  const rates = await latestRates(db, currencies, today);

  // Per account: the CAD value, or null once any of its amounts has no rate (a partial sum would mislead).
  const value = new Map<string, Dec | null>();
  const valueOf = (accountId: string): Dec | null => {
    const v = value.get(accountId);
    return v === undefined ? new D(0) : v;
  };
  const add = (accountId: string, amount: string | null, currency: string) => {
    if (amount === null) return;
    const current = valueOf(accountId);
    const rate = rates.get(currency);
    value.set(accountId, current === null || rate === undefined ? null : current.plus(new D(amount).times(rate)));
  };
  for (const h of holdings) add(h.accountId, h.marketValue, h.currency);
  for (const b of balances) add(b.accountId, b.cash, b.currency);

  let total = new D(0);
  let totalIncomplete = false;
  const byConnection = new Map<string, HubAccount[]>();
  for (const a of accounts) {
    const v = valueOf(a.id);
    if (v === null) totalIncomplete = true;
    else total = total.plus(v);
    const list = byConnection.get(a.connectionId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      numberMasked: a.numberMasked,
      accountType: a.accountType,
      confirmed: a.confirmedAt !== null,
      valueCad: v === null ? null : v.toFixed(2),
    });
    byConnection.set(a.connectionId, list);
  }

  return {
    brokerages: connections
      .map((c) => ({ ...c, accounts: byConnection.get(c.id) ?? [] }))
      .filter((c) => c.accounts.length > 0),
    totalValueCad: total.toFixed(2),
    totalIncomplete,
    ytdGainCad: year?.net ?? "0",
    estimatedTaxCad: year?.tax ?? null,
    warnings,
    unconfirmedAccounts: accounts.filter((a) => a.confirmedAt === null).length,
  };
}
