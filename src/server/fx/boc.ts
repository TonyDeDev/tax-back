import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { addDays } from "@/tax-engine/dates";

/*
 * Bank of Canada daily exchange rates from the Valet API (free, no key): CAD per one unit of a currency.
 * Stored once in the global `fx_rates` table and shared by every user. The previous-business-day fallback
 * for weekends and holidays is `fxLookupFrom`'s job; this only fills the table.
 */

const VALET = "https://www.bankofcanada.ca/valet/observations";
/** Look back far enough that a trade on a Monday after a long weekend still finds the prior business day. */
const LOOKBACK_DAYS = 10;
const CHUNK = 500;

const observationsSchema = z.object({
  observations: z.array(z.looseObject({ d: z.string() })),
});
const valueSchema = z.object({ v: z.string() });

export class FxSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxSourceError";
  }
}

/** Parses one Valet series. Exported for tests. */
export function parseValet(body: unknown, currency: string): { rateDate: string; cadPerUnit: string }[] {
  const series = `FX${currency}CAD`;
  const parsed = observationsSchema.safeParse(body);
  if (!parsed.success) throw new FxSourceError(`Bank of Canada sent an unexpected response for ${series}`);
  return parsed.data.observations.flatMap((o) => {
    const value = valueSchema.safeParse(o[series]);
    // Holidays can appear with an empty value; they are simply not a business day.
    if (!value.success || !/^\d+(\.\d+)?$/.test(value.data.v) || !/^\d{4}-\d{2}-\d{2}$/.test(o.d)) return [];
    return [{ rateDate: o.d, cadPerUnit: value.data.v }];
  });
}

async function fetchSeries(currency: string, start: string, end: string) {
  const url = `${VALET}/FX${currency}CAD/json?start_date=${start}&end_date=${end}`;
  const res = await fetch(url, { cache: "no-store" });
  // Valet answers 404 for a currency it does not publish.
  if (res.status === 404) return null;
  if (!res.ok) throw new FxSourceError(`Bank of Canada returned ${res.status} for ${currency}`);
  return parseValet(await res.json(), currency);
}

export interface FxSyncResult {
  inserted: number;
  /** Currencies the Bank of Canada does not publish. Recompute will fail for them rather than guess. */
  unsupported: string[];
}

/**
 * Makes sure `fx_rates` covers every currency from `fromDate` (less a short lookback) to `today`.
 * Only the missing range is fetched: the gap before the earliest stored rate, and the days after the latest.
 */
export async function syncFxRates(
  db: AnyDb,
  currencies: Iterable<string>,
  fromDate: string,
  today: string,
): Promise<FxSyncResult> {
  const wanted = [...new Set(currencies)].filter((c) => c !== "CAD").sort();
  const result: FxSyncResult = { inserted: 0, unsupported: [] };
  if (wanted.length === 0) return result;

  const stored = await db
    .select({
      currency: s.fxRates.currency,
      first: sql<string>`min(${s.fxRates.rateDate})`,
      last: sql<string>`max(${s.fxRates.rateDate})`,
    })
    .from(s.fxRates)
    .where(inArray(s.fxRates.currency, wanted))
    .groupBy(s.fxRates.currency);
  const range = new Map(stored.map((r) => [r.currency, r]));
  const needFrom = addDays(fromDate, -LOOKBACK_DAYS);

  for (const currency of wanted) {
    const have = range.get(currency);
    // Covered when a stored rate falls on or before `fromDate`. Comparing against `needFrom` instead would
    // refetch everything on every sync, since the lookback usually starts on a day with no rate.
    const start = !have || have.first > fromDate ? needFrom : addDays(have.last, 1);
    if (start > today) continue;

    const rows = await fetchSeries(currency, start, today);
    if (rows === null) {
      result.unsupported.push(currency);
      continue;
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK).map((r) => ({ currency, ...r, source: "boc_valet" }));
      const inserted = await db
        .insert(s.fxRates)
        .values(part)
        // Published rates do not change; a repeat fetch over the same days is a no-op.
        .onConflictDoNothing()
        .returning({ currency: s.fxRates.currency });
      result.inserted += inserted.length;
    }
  }
  return result;
}

/** Latest stored rate per currency on or before `date`, for showing today's values in CAD. */
export async function latestRates(db: AnyDb, currencies: readonly string[], date: string): Promise<Map<string, string>> {
  const wanted = currencies.filter((c) => c !== "CAD");
  const out = new Map<string, string>([["CAD", "1"]]);
  if (wanted.length === 0) return out;
  const rows = await db
    .selectDistinctOn([s.fxRates.currency], { currency: s.fxRates.currency, rate: s.fxRates.cadPerUnit })
    .from(s.fxRates)
    .where(and(inArray(s.fxRates.currency, wanted), sql`${s.fxRates.rateDate} <= ${date}`))
    .orderBy(s.fxRates.currency, sql`${s.fxRates.rateDate} desc`);
  for (const r of rows) out.set(r.currency, r.rate);
  return out;
}

