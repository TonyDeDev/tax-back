import { addDays, nextBusinessDay } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import { SUPERFICIAL_WINDOW_DAYS } from "./superficial";
import type { AcbPosition, FxLookup, HarvestOpportunity, LedgerEntry, MarketPrice } from "./types";

/** The superficial loss window of a sale traded on `trade`: 30 days either side of its T+1 settlement, as the engine judges it. */
function windowOf(trade: string): { start: string; end: string } {
  const settles = nextBusinessDay(trade);
  return { start: addDays(settles, -SUPERFICIAL_WINDOW_DAYS), end: addDays(settles, SUPERFICIAL_WINDOW_DAYS) };
}

const isWeekday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

/**
 * Positions currently worth less than their pooled ACB, largest loss first.
 * A sale is superficial if any purchase (any account) settled inside its window, so each suggestion is
 * the first trading day from today whose window starts after the last purchase, with that sale's
 * window and the date before which not to rebuy.
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
    let saleDate = asOfDate;
    while (!isWeekday(saleDate) || (last !== undefined && windowOf(saleDate).start <= last)) saleDate = addDays(saleDate, 1);
    const { start: windowStart, end: windowEnd } = windowOf(saleDate);
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
      blockedByRecentPurchase: last !== undefined && windowOf(asOfDate).start <= last,
      earliestSafeSaleDate: saleDate,
      noRebuyBefore: addDays(windowEnd, 1),
    });
  }
  return out.sort((a, b) => b.unrealizedLossCad.comparedTo(a.unrealizedLossCad));
}
