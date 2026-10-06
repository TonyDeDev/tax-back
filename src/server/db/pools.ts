import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DividendClass } from "@/tax-engine";
import * as s from "./schema";
import type { AnyDb } from "./types";

/*
 * Identical property across listings. The CRA pools shares that are the same property wherever they
 * trade, so RY bought on the TSX in CAD and sold on the NYSE in USD is one ACB pool and one superficial
 * loss check. Listings are joined when SnapTrade gives them the same share-class FIGI, or when the user
 * links them; a user can also keep a listing separate. Each pool is represented by one canonical listing,
 * the Canadian one when there is one, and the engine only ever sees that id.
 */

export interface Listing {
  id: string;
  symbol: string;
  exchange: string | null;
  currency: string;
  country: string | null;
  figiShareClass: string | null;
}

export interface Preference {
  securityId: string;
  poolSecurityId: string | null;
  dividendClass: DividendClass | null;
}

/** How a listing came to be in its pool, for the security page. */
export type PoolReason = "canonical" | "figi" | "linked";

export interface Pools {
  /** The canonical listing id for any listing; a listing nobody knows maps to itself. */
  poolOf(securityId: string): string;
  /** Every listing in the pool, canonical first. */
  listingsOf(poolId: string): (Listing & { reason: PoolReason })[];
  /** True when the user chose to keep this listing out of any pool. */
  isSeparate(securityId: string): boolean;
  /**
   * The class a dividend on this listing gets: the user's choice for the listing or its pool, else
   * eligible when the pool includes a Canadian listing (the issuer is Canadian), else what sync stored.
   */
  dividendClassFor(securityId: string, stored: DividendClass): DividendClass;
  /** The user's dividend class choice for the pool, or null for automatic. */
  dividendOverride(poolId: string): DividendClass | null;
}

/** Canadian listing first, then a CAD one, then a stable order, so the canonical id does not wander. */
function rank(l: Listing): string {
  return `${l.country === "CA" ? 0 : 1}${l.currency === "CAD" ? 0 : 1}${l.id}`;
}

export function resolvePools(listings: readonly Listing[], preferences: readonly Preference[]): Pools {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const prefs = new Map(preferences.map((p) => [p.securityId, p]));
  const separate = new Set(preferences.filter((p) => p.poolSecurityId === p.securityId).map((p) => p.securityId));

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const l of listings) parent.set(l.id, l.id);

  const viaFigi = new Set<string>();
  const firstWithFigi = new Map<string, string>();
  for (const l of listings) {
    if (!l.figiShareClass || separate.has(l.id)) continue;
    const first = firstWithFigi.get(l.figiShareClass);
    if (first) {
      union(l.id, first);
      viaFigi.add(l.id).add(first);
    } else firstWithFigi.set(l.figiShareClass, l.id);
  }
  const viaLink = new Set<string>();
  for (const p of preferences) {
    if (!p.poolSecurityId || p.poolSecurityId === p.securityId) continue;
    if (!byId.has(p.securityId) || !byId.has(p.poolSecurityId)) continue;
    union(p.securityId, p.poolSecurityId);
    viaLink.add(p.securityId);
  }

  const members = new Map<string, Listing[]>();
  for (const l of listings) {
    const root = find(l.id);
    members.set(root, [...(members.get(root) ?? []), l]);
  }
  const canonical = new Map<string, string>();
  const sortedMembers = new Map<string, Listing[]>();
  for (const group of members.values()) {
    const sorted = [...group].sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
    const head = sorted[0]!.id;
    sortedMembers.set(head, sorted);
    for (const l of group) canonical.set(l.id, head);
  }

  const poolOf = (id: string) => canonical.get(id) ?? id;
  const dividendOverride = (poolId: string) => {
    for (const l of sortedMembers.get(poolId) ?? []) {
      const choice = prefs.get(l.id)?.dividendClass;
      if (choice) return choice;
    }
    return null;
  };

  return {
    poolOf,
    listingsOf(poolId) {
      return (sortedMembers.get(poolId) ?? []).map((l) => ({
        ...l,
        reason: l.id === poolId ? "canonical" : viaLink.has(l.id) ? "linked" : viaFigi.has(l.id) ? "figi" : "linked",
      }));
    },
    isSeparate: (id) => separate.has(id),
    dividendClassFor(securityId, stored) {
      const own = prefs.get(securityId)?.dividendClass;
      if (own) return own;
      const pool = poolOf(securityId);
      const chosen = dividendOverride(pool);
      if (chosen) return chosen;
      if (stored === "foreign" && (sortedMembers.get(pool) ?? []).some((l) => l.country === "CA")) return "eligible";
      return stored;
    },
    dividendOverride,
  };
}

/**
 * The pools for one user, over every security they have touched: transactions, holdings, opening
 * balances, corporate actions, and preferences.
 */
export async function loadUserPools(db: AnyDb, userId: string): Promise<{ pools: Pools; listings: Listing[]; preferences: Preference[] }> {
  const [txIds, holdingIds, openingIds, corporate, preferences] = await Promise.all([
    db
      .selectDistinct({ id: s.transactions.securityId })
      .from(s.transactions)
      .where(and(eq(s.transactions.userId, userId), isNotNull(s.transactions.securityId))),
    db.selectDistinct({ id: s.holdings.securityId }).from(s.holdings).where(eq(s.holdings.userId, userId)),
    db.select({ id: s.manualAdjustments.securityId }).from(s.manualAdjustments).where(eq(s.manualAdjustments.userId, userId)),
    db
      .select({ a: s.corporateActions.securityId, b: s.corporateActions.targetSecurityId })
      .from(s.corporateActions)
      .where(eq(s.corporateActions.userId, userId)),
    db
      .select({
        securityId: s.securityPreferences.securityId,
        poolSecurityId: s.securityPreferences.poolSecurityId,
        dividendClass: s.securityPreferences.dividendClass,
      })
      .from(s.securityPreferences)
      .where(eq(s.securityPreferences.userId, userId)),
  ]);
  const ids = [
    ...new Set([
      ...txIds.map((r) => r.id!),
      ...holdingIds.map((r) => r.id),
      ...openingIds.map((r) => r.id),
      ...corporate.flatMap((c) => [c.a, c.b]),
      ...preferences.flatMap((p) => (p.poolSecurityId ? [p.securityId, p.poolSecurityId] : [p.securityId])),
    ]),
  ];
  const listings =
    ids.length === 0
      ? []
      : await db
          .select({
            id: s.securities.id,
            symbol: s.securities.symbol,
            exchange: s.securities.exchange,
            currency: s.securities.currency,
            country: s.securities.country,
            figiShareClass: s.securities.figiShareClass,
          })
          .from(s.securities)
          .where(inArray(s.securities.id, ids));
  return { pools: resolvePools(listings, preferences), listings, preferences };
}
