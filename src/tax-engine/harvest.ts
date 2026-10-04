import { addDays } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import type { AcbPosition, FxLookup, HarvestOpportunity, LedgerEntry, MarketPrice } from "./types";

/**
 * Positions currently worth less than their pooled ACB, largest loss first.
 * A sale today is superficial if any purchase (any account) sits inside the 30-day window,
 * so we report the first date a sale would be safe and how long to avoid rebuying.
 */
export function findHarvestOpportunities(args: {
  positions: readonly AcbPosition[];
  sorted: readonly LedgerEntry[];
  prices: Readonly<Record<string, MarketPrice>>;
  asOfDate: string;
  fx: FxLookup;
  netGainYtdCad: Dec;
  inclusionRate: Dec;
  marginalRate?: Dec | null;
}): HarvestOpportunity[] {
  const { positions, sorted, prices, asOfDate, fx, netGainYtdCad, inclusionRate, marginalRate } = args;
  const windowStart = addDays(asOfDate, -30);
  const windowEnd = addDays(asOfDate, 30);
  const offset = D.max(netGainYtdCad, ZERO);

  const lastAcquisition = new Map<string, string>();
  for (const e of sorted) {
    if (e.kind !== "buy" && e.kind !== "drip") continue;
    const prev = lastAcquisition.get(e.securityId);
    if (prev === undefined || e.settlementDate > prev) lastAcquisition.set(e.securityId, e.settlementDate);
  }

  const out: HarvestOpportunity[] = [];
  for (const p of positions) {
    const quote = prices[p.securityId];
    if (!quote) continue;
    const marketValueCad = p.quantity.times(quote.price).times(fx(quote.currency, asOfDate));
    const unrealizedLossCad = p.totalAcbCad.minus(marketValueCad);
    if (!unrealizedLossCad.gt(0)) continue;

    const last = lastAcquisition.get(p.securityId);
    const blocked = last !== undefined && last >= windowStart;
    const usable = D.min(unrealizedLossCad, offset);
    out.push({
      securityId: p.securityId,
      symbol: p.symbol,
      quantity: p.quantity,
      acbCad: p.totalAcbCad,
      marketValueCad,
      unrealizedLossCad,
      gainsAvailableToOffsetCad: offset,
      estimatedTaxSavingsCad:
        marginalRate === null || marginalRate === undefined ? null : usable.times(inclusionRate).times(marginalRate),
      windowStart,
      windowEnd,
      blockedByRecentPurchase: blocked,
      earliestSafeSaleDate: blocked && last !== undefined ? addDays(last, 31) : asOfDate,
      noRebuyBefore: addDays(windowEnd, 1),
    });
  }
  return out.sort((a, b) => b.unrealizedLossCad.comparedTo(a.unrealizedLossCad));
}
