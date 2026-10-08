import "server-only";
import { eq, inArray } from "drizzle-orm";
import { replaceDerived } from "@/server/db/derived";
import {
  fxLookupFrom,
  toCashFlows,
  toContributionInputs,
  toCorporateActions,
  toDerivedRows,
  toLedger,
  toOpenings,
} from "@/server/db/ledger";
import { loadUserPools } from "@/server/db/pools";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { torontoDate } from "@/server/snaptrade/map";
import { type ComputeTaxInput, computeTax, D, isRegistered, type MarketPrice, type Plan, type RoomPlan } from "@/tax-engine";

export interface EngineInput {
  input: ComputeTaxInput;
  /** securityId -> the manual adjustment that produced its opening entry. */
  openingIds: Map<string, string>;
}

/**
 * Everything the engine needs for one user, read in one pass: the ledger, opening balances,
 * corporate actions, Bank of Canada rates, prices, and what the brokers hold for reconciliation.
 * Shared by the recompute and the sale preview, so a preview replays exactly what was stored.
 *
 * Listings of the same shares (RY on the TSX and on the NYSE) are mapped to one canonical security
 * here, so the engine pools them as identical property. Each entry keeps its own currency, so every
 * trade is still converted at its own date's rate.
 */
export async function loadEngineInput(db: AnyDb, userId: string, today: string): Promise<EngineInput> {
  const [transactions, accounts, openings, corporate, holdings, [profile], { pools, listings }, flows, contributionInputs] = await Promise.all([
    db.select().from(s.transactions).where(eq(s.transactions.userId, userId)),
    db
      .select({
        id: s.brokerageAccounts.id,
        accountType: s.brokerageAccounts.accountType,
        kind: s.brokerageAccounts.kind,
        historyCompleteFrom: s.brokerageAccounts.historyCompleteFrom,
      })
      .from(s.brokerageAccounts)
      .where(eq(s.brokerageAccounts.userId, userId)),
    db.select().from(s.manualAdjustments).where(eq(s.manualAdjustments.userId, userId)),
    db.select().from(s.corporateActions).where(eq(s.corporateActions.userId, userId)),
    db
      .select({
        accountId: s.holdings.accountId,
        securityId: s.holdings.securityId,
        quantity: s.holdings.quantity,
        price: s.holdings.price,
        currency: s.holdings.currency,
      })
      .from(s.holdings)
      .where(eq(s.holdings.userId, userId)),
    db
      .select({
        marginalRate: s.userProfiles.marginalRate,
        birthYear: s.userProfiles.birthYear,
        residentSinceYear: s.userProfiles.residentSinceYear,
        fhsaOpenedYear: s.userProfiles.fhsaOpenedYear,
      })
      .from(s.userProfiles)
      .where(eq(s.userProfiles.userId, userId)),
    loadUserPools(db, userId),
    db.select().from(s.contributionFlows).where(eq(s.contributionFlows.userId, userId)),
    db.select().from(s.contributionInputs).where(eq(s.contributionInputs.userId, userId)),
  ]);

  const currencies = [
    ...new Set([
      ...transactions.map((t) => t.currency),
      ...corporate.map((c) => c.currency),
      ...holdings.map((h) => h.currency),
      ...flows.map((f) => f.currency),
    ]),
  ].filter((c) => c !== "CAD");
  const fxRows =
    currencies.length === 0
      ? []
      : await db
          .select({ currency: s.fxRates.currency, rateDate: s.fxRates.rateDate, cadPerUnit: s.fxRates.cadPerUnit })
          .from(s.fxRates)
          .where(inArray(s.fxRates.currency, currencies));

  const pool = pools.poolOf;
  const pooledTransactions = transactions.map((t) => {
    if (!t.securityId) return t;
    const dividendClass =
      t.dividendClass && (t.kind === "dividend" || t.kind === "stock_dividend")
        ? pools.dividendClassFor(t.securityId, t.dividendClass)
        : t.dividendClass;
    return { ...t, securityId: pool(t.securityId), dividendClass };
  });
  const pooledHoldings = holdings.map((h) => ({ ...h, securityId: pool(h.securityId) }));
  // A corporate action between two listings of the same shares has nothing left to do once they are pooled.
  const pooledCorporate = corporate
    .map((c) => ({ ...c, securityId: pool(c.securityId), targetSecurityId: pool(c.targetSecurityId) }))
    .filter((c) => c.securityId !== c.targetSecurityId);
  // One opening balance per pool: the one saved on the canonical listing, else the most recent.
  const openingByPool = new Map<string, (typeof openings)[number]>();
  for (const o of [...openings].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1))) {
    const key = pool(o.securityId);
    const current = openingByPool.get(key);
    if (!current || current.securityId !== key) openingByPool.set(key, o);
  }
  const pooledOpenings = [...openingByPool].map(([key, o]) => ({ ...o, securityId: key }));

  // Holdings of one security at two brokerages carry the same market price; any one will do.
  const prices: Record<string, MarketPrice> = {};
  for (const h of pooledHoldings) {
    if (h.price !== null) prices[h.securityId] ??= { price: new D(h.price), currency: h.currency };
  }

  const symbol = new Map(listings.map((x) => [x.id, x.symbol]));
  const account = new Map(accounts.map((a) => [a.id, a]));
  const brokerPositions = pooledHoldings.flatMap((h) => {
    const a = account.get(h.accountId);
    // Cash accounts hold no securities that the engine tracks.
    if (!a || a.kind !== "investment") return [];
    return [
      {
        accountId: h.accountId,
        accountType: a.accountType,
        securityId: h.securityId,
        symbol: symbol.get(h.securityId) ?? h.securityId,
        quantity: new D(h.quantity),
      },
    ];
  });

  // Registered investment accounts the user holds, and per room plan the date from which all of them have history.
  const planAccounts = accounts.filter((a) => a.kind === "investment" && isRegistered(a.accountType));
  const plansHeld = [...new Set(planAccounts.map((a) => a.accountType as Plan))];
  const historyFrom: Partial<Record<RoomPlan, string | null>> = {};
  for (const plan of ["tfsa", "rrsp", "fhsa"] as const) {
    const dates = planAccounts.filter((a) => a.accountType === plan).map((a) => a.historyCompleteFrom);
    if (dates.length === 0) continue;
    historyFrom[plan] = dates.some((d) => d === null) ? null : dates.reduce((a, b) => (a! > b! ? a : b));
  }

  return {
    input: {
      ledger: [...toLedger(pooledTransactions, accounts, listings), ...toCorporateActions(pooledCorporate, listings)],
      openings: toOpenings(pooledOpenings, listings),
      fx: fxLookupFrom(fxRows),
      asOfDate: today,
      prices,
      marginalRate: profile?.marginalRate ? new D(profile.marginalRate) : null,
      brokerPositions,
      contributions: {
        flows: toCashFlows(flows, accounts),
        inputs: toContributionInputs(contributionInputs),
        profile: {
          birthYear: profile?.birthYear ?? null,
          residentSinceYear: profile?.residentSinceYear ?? null,
          fhsaOpenedYear: profile?.fhsaOpenedYear ?? null,
        },
        plansHeld,
        historyFrom,
      },
    },
    openingIds: new Map(pooledOpenings.map((o) => [o.securityId, o.id])),
  };
}

/**
 * Recomputes every derived tax table for one user from their stored ledger, in one transaction.
 * `today` comes from the caller (`torontoToday()`), because the engine never reads the clock.
 * Throws when the ledger cannot be computed (for example a missing FX rate); the old results stay.
 */
export async function recomputeUser(db: AnyDb, userId: string, today: string): Promise<void> {
  const { input, openingIds } = await loadEngineInput(db, userId, today);
  const result = computeTax(input);
  await replaceDerived(db, userId, toDerivedRows(userId, result, openingIds, today), today);
  await db.update(s.userProfiles).set({ lastRecomputedAt: new Date() }).where(eq(s.userProfiles.userId, userId));
}

/** Today's date in Toronto as YYYY-MM-DD: the "as of" date for tax results and harvesting windows. */
export function torontoToday(now: Date = new Date()): string {
  return torontoDate(now.toISOString());
}
