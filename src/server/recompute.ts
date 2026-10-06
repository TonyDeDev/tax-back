import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { replaceDerived } from "@/server/db/derived";
import { fxLookupFrom, toDerivedRows, toLedger, toOpenings } from "@/server/db/ledger";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { torontoDate } from "@/server/snaptrade/map";
import { computeTax, D, type MarketPrice } from "@/tax-engine";

/**
 * Recomputes every derived tax table for one user from their stored ledger, in one transaction.
 * `today` comes from the caller (`torontoToday()`), because the engine never reads the clock.
 * Throws when the ledger cannot be computed (for example a missing FX rate); the old results stay.
 */
export async function recomputeUser(db: AnyDb, userId: string, today: string): Promise<void> {
  const [transactions, accounts, openings, holdings, [profile]] = await Promise.all([
    db.select().from(s.transactions).where(eq(s.transactions.userId, userId)),
    db
      .select({ id: s.brokerageAccounts.id, accountType: s.brokerageAccounts.accountType })
      .from(s.brokerageAccounts)
      .where(eq(s.brokerageAccounts.userId, userId)),
    db.select().from(s.manualAdjustments).where(eq(s.manualAdjustments.userId, userId)),
    db
      .select({ securityId: s.holdings.securityId, price: s.holdings.price, currency: s.holdings.currency })
      .from(s.holdings)
      .where(and(eq(s.holdings.userId, userId), isNotNull(s.holdings.price))),
    db.select({ marginalRate: s.userProfiles.marginalRate }).from(s.userProfiles).where(eq(s.userProfiles.userId, userId)),
  ]);

  const securityIds = [
    ...new Set([
      ...transactions.flatMap((t) => (t.securityId ? [t.securityId] : [])),
      ...openings.map((o) => o.securityId),
    ]),
  ];
  const currencies = [...new Set(transactions.map((t) => t.currency).filter((c) => c !== "CAD"))];
  const [securities, fxRows] = await Promise.all([
    securityIds.length === 0
      ? []
      : db
          .select({ id: s.securities.id, symbol: s.securities.symbol })
          .from(s.securities)
          .where(inArray(s.securities.id, securityIds)),
    currencies.length === 0
      ? []
      : db
          .select({ currency: s.fxRates.currency, rateDate: s.fxRates.rateDate, cadPerUnit: s.fxRates.cadPerUnit })
          .from(s.fxRates)
          .where(inArray(s.fxRates.currency, currencies)),
  ]);

  // Holdings of one security at two brokerages carry the same market price; any one will do.
  const prices: Record<string, MarketPrice> = {};
  for (const h of holdings) prices[h.securityId] ??= { price: new D(h.price!), currency: h.currency };

  const result = computeTax({
    ledger: toLedger(transactions, accounts, securities),
    openings: toOpenings(openings, securities),
    fx: fxLookupFrom(fxRows),
    asOfDate: today,
    prices,
    marginalRate: profile?.marginalRate ? new D(profile.marginalRate) : null,
  });

  const openingIds = new Map(openings.map((o) => [o.securityId, o.id]));
  await replaceDerived(db, userId, toDerivedRows(userId, result, openingIds, today));
  await db.update(s.userProfiles).set({ lastRecomputedAt: new Date() }).where(eq(s.userProfiles.userId, userId));
}

/** Today's date in Toronto as YYYY-MM-DD: the "as of" date for tax results and harvesting windows. */
export function torontoToday(now: Date = new Date()): string {
  return torontoDate(now.toISOString());
}
