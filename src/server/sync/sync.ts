import "server-only";
import { and, desc, eq, inArray, lt, min, ne, notInArray, sql } from "drizzle-orm";
import type { Auth } from "@/server/auth/config";
import { moneyText, quantityText } from "@/server/db/ledger";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { FxSourceError, syncFxRates } from "@/server/fx/boc";
import { recomputeUser, torontoToday } from "@/server/recompute";
import { SnapTradeApiError, SnapTradeResponseError } from "@/server/snaptrade/client";
import {
  type MappedAccount,
  type MappedActivities,
  type MappedBalance,
  type MappedHolding,
  type MappedSecurity,
  isSyncedAccount,
  mapAccount,
  mapActivities,
  mapBalances,
  mapPositions,
} from "@/server/snaptrade/map";
import type { SnapTradeAuthorization } from "@/server/snaptrade/schemas";
import { SnapTradeReauthRequiredError, withSnapTrade } from "@/server/snaptrade/token";

/*
 * One sync: fetch everything from SnapTrade, upsert it by SnapTrade id (safe to repeat), fill FX rates,
 * then recompute the user's tax results. The rules it follows are in docs/schema.md, "Rules for Writers".
 */

export type SyncTrigger = "connect" | "manual" | "cron";

/** The Refresh button may start a sync once per this window. */
export const SYNC_COOLDOWN_MS = 15 * 60 * 1000;
/** A `running` row older than this belongs to a function that died; Vercel stops functions well before. */
export const STALE_RUN_MS = 10 * 60 * 1000;

const CHUNK = 500;

/** Stored in `sync_runs.stats.errorCode` so the UI can offer the right fix. */
export const SYNC_ERROR_CODES = ["reauth_required", "snaptrade_unavailable", "fx_unavailable", "failed"] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export type SyncOutcome =
  | { status: "succeeded"; runId: string }
  | { status: "failed"; runId: string; code: SyncErrorCode; message: string }
  | { status: "cooldown"; retryAt: Date }
  | { status: "in_progress" };

interface FetchedAccount {
  account: MappedAccount;
  holdings: MappedHolding[];
  balances: MappedBalance[];
  activities: MappedActivities;
  positionSecurities: MappedSecurity[];
  skippedPositions: Record<string, number>;
}

interface Fetched {
  authorizations: SnapTradeAuthorization[];
  accounts: FetchedAccount[];
  institutions: Map<string, string>;
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** A message safe to show the user and store: SnapTrade tokens and SQL never reach it. */
function describe(error: unknown): { code: SyncErrorCode; message: string } {
  if (error instanceof SnapTradeReauthRequiredError) return { code: "reauth_required", message: error.message };
  if (error instanceof SnapTradeApiError || error instanceof SnapTradeResponseError) {
    return { code: "snaptrade_unavailable", message: "SnapTrade could not be read right now. Try again later." };
  }
  if (error instanceof FxSourceError) return { code: "fx_unavailable", message: error.message };
  if (error instanceof Error && /^(No [A-Z]{3}\/CAD rate|Invalid ledger|SnapTrade activity)/.test(error.message)) {
    return { code: "failed", message: error.message.slice(0, 500) };
  }
  return { code: "failed", message: "Sync failed. Try again later." };
}

async function fetchAll(db: AnyDb, auth: Auth, userId: string): Promise<Fetched> {
  return withSnapTrade(db, auth, userId, async (client) => {
    const [authorizations, rawAccounts] = await Promise.all([client.listAuthorizations(), client.listAccounts()]);
    const institutions = new Map(rawAccounts.map((a) => [a.brokerage_authorization, a.institution_name]));
    const accounts: FetchedAccount[] = [];
    // One account at a time keeps well inside SnapTrade's rate limits; a user has a handful of accounts.
    for (const raw of rawAccounts.filter(isSyncedAccount)) {
      const [positions, balances, activities] = await Promise.all([
        client.listPositions(raw.id),
        client.listBalances(raw.id),
        client.listAllActivities(raw.id),
      ]);
      // A closed account with nothing in it carries no tax history; listing it would only add noise.
      const empty = activities.length === 0 && positions.length === 0 && !balances.some((b) => b.cash);
      if (raw.status === "closed" && empty) continue;
      const mappedPositions = mapPositions(positions);
      accounts.push({
        account: mapAccount(raw),
        holdings: mappedPositions.holdings,
        positionSecurities: mappedPositions.securities,
        skippedPositions: mappedPositions.skipped,
        balances: mapBalances(balances),
        activities: mapActivities(activities),
      });
    }
    return { authorizations, accounts, institutions };
  });
}

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/**
 * Securities are global. Match on the SnapTrade id first; otherwise insert, and if a row with the same
 * `(symbol, exchange, currency)` exists without a SnapTrade id (a demo-only security), adopt it.
 */
async function upsertSecurities(tx: AnyDb, list: readonly MappedSecurity[]): Promise<Map<string, string>> {
  const unique = new Map<string, MappedSecurity>();
  for (const sec of list) if (!unique.has(sec.snaptradeSymbolId)) unique.set(sec.snaptradeSymbolId, sec);
  const ids = new Map<string, string>();
  if (unique.size === 0) return ids;

  const existing = await tx
    .select({ id: s.securities.id, snaptradeSymbolId: s.securities.snaptradeSymbolId, figiShareClass: s.securities.figiShareClass })
    .from(s.securities)
    .where(inArray(s.securities.snaptradeSymbolId, [...unique.keys()]));
  for (const row of existing) ids.set(row.snaptradeSymbolId!, row.id);
  // Fill in a share-class FIGI SnapTrade has started sending for a security we already know; never erase one.
  for (const row of existing) {
    const figi = unique.get(row.snaptradeSymbolId!)?.figiShareClass;
    if (figi && row.figiShareClass !== figi) {
      await tx.update(s.securities).set({ figiShareClass: figi }).where(eq(s.securities.id, row.id));
    }
  }

  for (const sec of unique.values()) {
    if (ids.has(sec.snaptradeSymbolId)) continue;
    const [row] = await tx
      .insert(s.securities)
      .values({ ...sec })
      .onConflictDoUpdate({
        target: [s.securities.symbol, s.securities.exchange, s.securities.currency],
        set: {
          snaptradeSymbolId: sec.snaptradeSymbolId,
          name: sec.name,
          securityType: sec.securityType,
          country: sec.country,
          figiShareClass: sec.figiShareClass,
        },
        setWhere: sql`${s.securities.snaptradeSymbolId} IS NULL`,
      })
      .returning({ id: s.securities.id });
    if (!row) {
      throw new Error(
        `Security ${sec.symbol} (${sec.exchange ?? "no exchange"}, ${sec.currency}) is already linked to another SnapTrade id`,
      );
    }
    ids.set(sec.snaptradeSymbolId, row.id);
  }
  return ids;
}

async function writeAll(tx: AnyDb, userId: string, fetched: Fetched, now: Date) {
  // Connections: one per SnapTrade brokerage authorization behind a synced account.
  const authById = new Map(fetched.authorizations.map((a) => [a.id, a]));
  const authorizationIds = [...new Set(fetched.accounts.map((a) => a.account.snaptradeAuthorizationId))];
  const connectionIds = new Map<string, string>();
  for (const authorizationId of authorizationIds) {
    const auth = authById.get(authorizationId);
    const name = auth?.brokerage.display_name || auth?.brokerage.name || fetched.institutions.get(authorizationId) || "Brokerage";
    const values = {
      userId,
      snaptradeAuthorizationId: authorizationId,
      brokerageSlug: auth?.brokerage.slug ?? name.toUpperCase().replace(/\W+/g, ""),
      brokerageName: name,
      status: auth?.disabled ? ("broken" as const) : ("active" as const),
      statusDetail: auth?.disabled ? "Reconnect this brokerage in the SnapTrade Dashboard." : null,
    };
    const [row] = await tx
      .insert(s.connections)
      .values(values)
      .onConflictDoUpdate({
        target: [s.connections.userId, s.connections.snaptradeAuthorizationId],
        set: {
          brokerageSlug: values.brokerageSlug,
          brokerageName: values.brokerageName,
          status: values.status,
          statusDetail: values.statusDetail,
          updatedAt: now,
        },
      })
      .returning({ id: s.connections.id });
    connectionIds.set(authorizationId, row!.id);
  }
  // A brokerage removed in SnapTrade keeps its history (closed accounts still carry ACB) but is flagged.
  await tx
    .update(s.connections)
    .set({ status: "broken", statusDetail: "No longer shared through SnapTrade.", updatedAt: now })
    .where(
      authorizationIds.length > 0
        ? and(eq(s.connections.userId, userId), notInArray(s.connections.snaptradeAuthorizationId, authorizationIds))
        : eq(s.connections.userId, userId),
    );

  const securityIds = await upsertSecurities(
    tx,
    fetched.accounts.flatMap((a) => [...a.activities.securities, ...a.positionSecurities]),
  );
  const securityId = (snaptradeId: string) => {
    const id = securityIds.get(snaptradeId);
    if (!id) throw new Error(`Security ${snaptradeId} was not stored`);
    return id;
  };

  const counts = { accounts: 0, transactions: 0, holdings: 0 };
  for (const f of fetched.accounts) {
    const a = f.account;
    const [row] = await tx
      .insert(s.brokerageAccounts)
      .values({
        userId,
        connectionId: connectionIds.get(a.snaptradeAuthorizationId)!,
        snaptradeAccountId: a.snaptradeAccountId,
        name: a.name,
        numberMasked: a.numberMasked,
        baseCurrency: a.baseCurrency,
        brokerRawType: a.brokerRawType,
        kind: a.kind,
        accountType: a.accountTypeGuess,
        historyCompleteFrom: f.activities.earliestDate,
      })
      .onConflictDoUpdate({
        target: [s.brokerageAccounts.userId, s.brokerageAccounts.snaptradeAccountId],
        set: {
          connectionId: excluded("connection_id"),
          name: excluded("name"),
          numberMasked: excluded("number_masked"),
          baseCurrency: excluded("base_currency"),
          brokerRawType: excluded("broker_raw_type"),
          kind: excluded("kind"),
          // The user's confirmed type always wins over the broker's guess.
          accountType: sql`CASE WHEN ${s.brokerageAccounts.accountTypeConfirmedAt} IS NULL THEN excluded.account_type ELSE ${s.brokerageAccounts.accountType} END`,
          historyCompleteFrom: excluded("history_complete_from"),
          updatedAt: now,
        },
      })
      .returning({ id: s.brokerageAccounts.id });
    const accountId = row!.id;
    counts.accounts += 1;

    // Holdings and balances are snapshots: replace them.
    await tx.delete(s.holdings).where(and(eq(s.holdings.accountId, accountId), eq(s.holdings.userId, userId)));
    const holdingRows = f.holdings.map((h) => ({
      userId,
      accountId,
      securityId: securityId(h.snaptradeSymbolId),
      quantity: quantityText(h.quantity),
      price: h.price ? moneyText(h.price) : null,
      currency: h.currency,
      marketValue: h.marketValue ? moneyText(h.marketValue) : null,
      brokerBookValue: h.brokerBookValue ? moneyText(h.brokerBookValue) : null,
      asOf: now,
    }));
    for (let i = 0; i < holdingRows.length; i += CHUNK) await tx.insert(s.holdings).values(holdingRows.slice(i, i + CHUNK));
    counts.holdings += holdingRows.length;

    await tx
      .delete(s.accountBalances)
      .where(and(eq(s.accountBalances.accountId, accountId), eq(s.accountBalances.userId, userId)));
    if (f.balances.length > 0) {
      await tx.insert(s.accountBalances).values(
        f.balances.map((b) => ({ accountId, userId, currency: b.currency, cash: moneyText(b.cash), asOf: now })),
      );
    }

    // Activities are history: upsert on the SnapTrade id so a repeat sync changes nothing.
    const transactionRows = f.activities.transactions.map((t) => ({
      userId,
      accountId,
      securityId: t.snaptradeSymbolId ? securityId(t.snaptradeSymbolId) : null,
      snaptradeActivityId: t.snaptradeActivityId,
      kind: t.kind,
      tradeDate: t.tradeDate,
      settlementDate: t.settlementDate,
      currency: t.currency,
      quantity: quantityText(t.quantity),
      price: moneyText(t.price),
      fees: moneyText(t.fees),
      amount: moneyText(t.amount),
      splitRatio: t.splitRatio ? t.splitRatio.toFixed(10) : null,
      dividendClass: t.dividendClass,
      withholdingTax: t.withholdingTax ? moneyText(t.withholdingTax) : null,
      description: t.description,
      raw: t.raw,
    }));
    for (let i = 0; i < transactionRows.length; i += CHUNK) {
      await tx
        .insert(s.transactions)
        .values(transactionRows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [s.transactions.accountId, s.transactions.snaptradeActivityId],
          set: {
            securityId: excluded("security_id"),
            kind: excluded("kind"),
            tradeDate: excluded("trade_date"),
            settlementDate: excluded("settlement_date"),
            currency: excluded("currency"),
            quantity: excluded("quantity"),
            price: excluded("price"),
            fees: excluded("fees"),
            amount: excluded("amount"),
            splitRatio: excluded("split_ratio"),
            // Keep a class the user has overridden once overrides exist; today it always follows the mapper.
            dividendClass: excluded("dividend_class"),
            withholdingTax: excluded("withholding_tax"),
            description: excluded("description"),
            raw: excluded("raw"),
            updatedAt: now,
          },
        });
    }
    counts.transactions += transactionRows.length;
  }

  // Accounts SnapTrade no longer lists are kept while they hold history (closed accounts still carry ACB);
  // empty ones are removed, with their holdings and balances.
  const kept = fetched.accounts.map((f) => f.account.snaptradeAccountId);
  await tx
    .delete(s.brokerageAccounts)
    .where(
      and(
        eq(s.brokerageAccounts.userId, userId),
        kept.length > 0 ? notInArray(s.brokerageAccounts.snaptradeAccountId, kept) : undefined,
        sql`NOT EXISTS (SELECT 1 FROM ${s.transactions} WHERE ${s.transactions.accountId} = ${s.brokerageAccounts.id})`,
      ),
    );
  return counts;
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, n] of Object.entries(source)) target[key] = (target[key] ?? 0) + n;
}

/**
 * Syncs one user. Never throws for expected failures: the outcome says what happened and is also stored
 * in `sync_runs`, which is what the UI reads.
 */
export async function syncUser(
  db: AnyDb,
  auth: Auth,
  userId: string,
  trigger: SyncTrigger,
  now: Date = new Date(),
): Promise<SyncOutcome> {
  // Recover a lock left by a function that died mid-sync, or the user would be blocked forever.
  await db
    .update(s.syncRuns)
    .set({ status: "failed", finishedAt: now, error: "The sync did not finish in time." })
    .where(
      and(
        eq(s.syncRuns.userId, userId),
        eq(s.syncRuns.status, "running"),
        lt(s.syncRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
      ),
    );

  if (trigger === "manual") {
    // Failed runs do not count, so a user can retry right after fixing a connection.
    const [last] = await db
      .select({ startedAt: s.syncRuns.startedAt })
      .from(s.syncRuns)
      .where(and(eq(s.syncRuns.userId, userId), ne(s.syncRuns.status, "failed")))
      .orderBy(desc(s.syncRuns.startedAt))
      .limit(1);
    const retryAt = last ? new Date(last.startedAt.getTime() + SYNC_COOLDOWN_MS) : null;
    if (retryAt && retryAt > now) return { status: "cooldown", retryAt };
  }

  let runId: string;
  try {
    const [run] = await db
      .insert(s.syncRuns)
      .values({ userId, trigger, status: "running", startedAt: now })
      .returning({ id: s.syncRuns.id });
    runId = run!.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "in_progress" };
    throw error;
  }

  const skipped: Record<string, number> = {};
  try {
    const fetched = await fetchAll(db, auth, userId);
    for (const f of fetched.accounts) {
      mergeCounts(skipped, f.activities.skipped);
      mergeCounts(skipped, f.skippedPositions);
    }

    const counts = await db.transaction((tx) => writeAll(tx, userId, fetched, now));

    const today = torontoToday(now);
    const [range] = await db
      .select({ first: min(s.transactions.settlementDate) })
      .from(s.transactions)
      .where(eq(s.transactions.userId, userId));
    const currencies = new Set<string>();
    for (const f of fetched.accounts) {
      for (const t of f.activities.transactions) currencies.add(t.currency);
      for (const h of f.holdings) currencies.add(h.currency);
      for (const b of f.balances) currencies.add(b.currency);
    }
    const fx = await syncFxRates(db, currencies, range?.first ?? today, today);

    await recomputeUser(db, userId, today);

    const finishedAt = new Date();
    await db
      .update(s.syncRuns)
      .set({
        status: "succeeded",
        finishedAt,
        stats: { ...counts, fxRatesAdded: fx.inserted, unsupportedCurrencies: fx.unsupported, skipped },
      })
      .where(eq(s.syncRuns.id, runId));
    await db.update(s.userProfiles).set({ lastSyncedAt: finishedAt }).where(eq(s.userProfiles.userId, userId));
    return { status: "succeeded", runId };
  } catch (error) {
    const { code, message } = describe(error);
    console.error(`[sync] user ${userId} run ${runId} failed`, error);
    await db
      .update(s.syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message, stats: { errorCode: code, skipped } })
      .where(eq(s.syncRuns.id, runId));
    return { status: "failed", runId, code, message };
  }
}
