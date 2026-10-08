import "server-only";
import { and, eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { latestRates } from "@/server/fx/boc";
import { D, type Dec } from "@/tax-engine";

/*
 * What the user holds today, in CAD, at the brokers' latest prices and the latest Bank of Canada rates.
 * The Hub's totals and the daily value snapshots both come from here, so the chart's last point always
 * matches the number above it.
 */

export interface Valuation {
  /**
   * Holdings plus cash per account, or null once any amount in it has no CAD rate (a partial sum would mislead).
   * An account whose holdings SnapTrade does not list is worth the broker's reported total instead.
   */
  accounts: Map<string, Dec | null>;
  /** The broker's price per unit in CAD, per security held, where a price and rate exist. */
  pricesCad: Map<string, Dec>;
}

export async function valueHoldings(db: AnyDb, userId: string, today: string): Promise<Valuation> {
  const [holdings, balances, unreported] = await Promise.all([
    db
      .select({
        accountId: s.holdings.accountId,
        securityId: s.holdings.securityId,
        currency: s.holdings.currency,
        price: s.holdings.price,
        marketValue: s.holdings.marketValue,
      })
      .from(s.holdings)
      .where(eq(s.holdings.userId, userId)),
    db
      .select({ accountId: s.accountBalances.accountId, currency: s.accountBalances.currency, cash: s.accountBalances.cash })
      .from(s.accountBalances)
      .where(eq(s.accountBalances.userId, userId)),
    db
      .select({
        accountId: s.brokerageAccounts.id,
        total: s.brokerageAccounts.reportedTotal,
        currency: s.brokerageAccounts.reportedTotalCurrency,
      })
      .from(s.brokerageAccounts)
      .where(and(eq(s.brokerageAccounts.userId, userId), eq(s.brokerageAccounts.holdingsUnreported, true))),
  ]);
  const currencies = [
    ...new Set([
      ...holdings.map((h) => h.currency),
      ...balances.map((b) => b.currency),
      ...unreported.flatMap((u) => (u.currency ? [u.currency] : [])),
    ]),
  ];
  const rates = await latestRates(db, currencies, today);

  const accounts = new Map<string, Dec | null>();
  const add = (accountId: string, amount: string | null, currency: string) => {
    if (amount === null) return;
    const current = accounts.has(accountId) ? accounts.get(accountId)! : new D(0);
    const rate = rates.get(currency);
    accounts.set(accountId, current === null || rate === undefined ? null : current.plus(new D(amount).times(rate)));
  };
  const pricesCad = new Map<string, Dec>();
  for (const h of holdings) {
    add(h.accountId, h.marketValue, h.currency);
    const rate = rates.get(h.currency);
    if (h.price !== null && rate !== undefined) pricesCad.set(h.securityId, new D(h.price).times(rate));
  }
  for (const b of balances) add(b.accountId, b.cash, b.currency);
  // The reported total already includes the cash, so it replaces the sum rather than adding to it.
  for (const u of unreported) {
    const rate = u.currency ? rates.get(u.currency) : undefined;
    accounts.set(u.accountId, u.total === null || rate === undefined ? null : new D(u.total).times(rate));
  }
  return { accounts, pricesCad };
}

/** An account with no holdings and no cash is worth zero, not unknown. */
export function accountValue(valuation: Valuation, accountId: string): Dec | null {
  const v = valuation.accounts.get(accountId);
  return v === undefined ? new D(0) : v;
}

/**
 * Records today's value of every account and the price of every held security, replacing any earlier
 * snapshot from the same day. Accounts without a CAD value are skipped: the Hub total leaves them out too.
 */
export async function writeValueSnapshots(db: AnyDb, userId: string, today: string): Promise<void> {
  const [valuation, accounts] = await Promise.all([
    valueHoldings(db, userId, today),
    db.select({ id: s.brokerageAccounts.id }).from(s.brokerageAccounts).where(eq(s.brokerageAccounts.userId, userId)),
  ]);
  const values = accounts.flatMap((a) => {
    const v = accountValue(valuation, a.id);
    return v === null ? [] : [{ accountId: a.id, userId, day: today, valueCad: v.toFixed(6) }];
  });
  const prices = [...valuation.pricesCad].map(([securityId, price]) => ({ userId, securityId, day: today, priceCad: price.toFixed(6) }));
  if (values.length > 0) {
    await db
      .insert(s.accountValueSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [s.accountValueSnapshots.accountId, s.accountValueSnapshots.day],
        set: { valueCad: sql`excluded.value_cad` },
      });
  }
  if (prices.length > 0) {
    await db
      .insert(s.securityPriceSnapshots)
      .values(prices)
      .onConflictDoUpdate({
        target: [s.securityPriceSnapshots.userId, s.securityPriceSnapshots.securityId, s.securityPriceSnapshots.day],
        set: { priceCad: sql`excluded.price_cad` },
      });
  }
}
