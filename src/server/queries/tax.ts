import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { D, type AccountType, type DividendClass } from "@/tax-engine";
import { yearOf } from "@/tax-engine/dates";

/*
 * Read queries for the Tax Center. Every query is scoped by `userId` first, and every row comes from
 * the derived tables the recompute wrote: the browser displays saved results and never computes tax.
 * Amounts stay decimal strings so nothing is rounded before it is formatted.
 *
 * Security ids here are canonical: the recompute pools interlisted listings before writing, so every
 * row links straight to `/hub/securities/<securityId>`.
 */

export interface TaxYearTotals {
  proceedsCad: string;
  acbCad: string;
  feesCad: string;
  /** The gain before any superficial loss was denied: the net plus the denied amount back out. */
  grossGainCad: string;
  netCapitalGainCad: string;
  deniedLossesCad: string;
  inclusionRate: string;
  /** Signed: negative is a net capital loss available to carry. */
  taxableCapitalGainCad: string;
  eligibleDividendsCad: string;
  nonEligibleDividendsCad: string;
  foreignIncomeCad: string;
  foreignWithholdingCad: string;
  federalDividendCreditCad: string;
  /** The three dividend classes added up, for the summary tile. */
  totalIncomeCad: string;
  estimatedTaxCad: string | null;
  /** The year is outside the verified rate table, so the nearest year's rates were used. */
  configAssumed: boolean;
}

export interface GainRow {
  id: string;
  securityId: string;
  symbol: string;
  name: string | null;
  /** Null for a merger, which happens to the security rather than in one account. */
  accountName: string | null;
  kind: "sale" | "roc_excess" | "deemed_disposition" | "merger_cash";
  dispositionDate: string;
  quantity: string;
  proceedsCad: string;
  acbCad: string;
  feesCad: string;
  gainCad: string;
  deniedLossCad: string;
  allowedGainCad: string;
  /** The sale exceeded the known position, so the ACB is understated. */
  incomplete: boolean;
}

export interface ReplacementRow {
  accountName: string;
  accountType: AccountType;
  quantity: string;
  deniedCad: string;
  disposition: "added_to_acb" | "lost_forever";
}

export interface SuperficialLossRow {
  id: string;
  securityId: string;
  symbol: string;
  saleDate: string;
  /** `pending` until the window closes; the denial is provisional until then. */
  status: "final" | "pending";
  quantitySold: string;
  quantityDenied: string;
  totalLossCad: string;
  deniedLossCad: string;
  allowedLossCad: string;
  lostForeverCad: string;
  windowStart: string;
  windowEnd: string;
  replacements: ReplacementRow[];
}

export interface DividendRow {
  securityId: string;
  symbol: string;
  name: string | null;
  accountName: string | null;
  paidDate: string;
  dividendClass: DividendClass;
  amountCad: string;
  /** The taxable amount: the dividend after the gross-up. */
  grossedUpCad: string;
  federalCreditCad: string;
  withholdingCad: string;
}

export interface HarvestRow {
  securityId: string;
  symbol: string;
  name: string | null;
  asOfDate: string;
  quantity: string;
  acbCad: string;
  marketValueCad: string;
  unrealizedLossCad: string;
  gainsAvailableToOffsetCad: string;
  estimatedTaxSavingsCad: string | null;
  windowStart: string;
  windowEnd: string;
  /** A purchase in the last 30 days would make the loss superficial, so the sale has to wait. */
  blockedByRecentPurchase: boolean;
  earliestSafeSaleDate: string;
  /** Do not buy this security in any account, including TFSA and RRSP, before this date. */
  noRebuyBefore: string;
}

export interface TaxYearView {
  year: number;
  /** Harvesting windows are measured from today, so they only belong to the year in progress. */
  isCurrentYear: boolean;
  totals: TaxYearTotals | null;
  gains: GainRow[];
  superficialLosses: SuperficialLossRow[];
  dividends: DividendRow[];
  /** As of today rather than for `year`, so it is empty unless this is the current year. */
  harvest: HarvestRow[];
  /** Null means the user has not set one, so there is no tax estimate. */
  marginalRate: string | null;
}

/** Years with tax results, newest first, always including the year in progress. */
export async function getTaxYears(db: AnyDb, userId: string, today: string): Promise<number[]> {
  const rows = await db
    .select({ year: s.taxYearSummaries.taxYear })
    .from(s.taxYearSummaries)
    .where(eq(s.taxYearSummaries.userId, userId));
  const years = new Set(rows.map((r) => r.year));
  years.add(yearOf(today));
  return [...years].sort((a, b) => b - a);
}

/** The saved summary as the page reads it: no `userId` or `taxYear`, plus the income tile's total. */
function toTotals(row: typeof s.taxYearSummaries.$inferSelect): TaxYearTotals {
  return {
    proceedsCad: row.proceedsCad,
    acbCad: row.acbCad,
    feesCad: row.feesCad,
    // Each row's allowed gain is its gain plus its denied loss, so the gross total is the net less the denials.
    grossGainCad: new D(row.netCapitalGainCad).minus(row.deniedLossesCad).toFixed(6),
    netCapitalGainCad: row.netCapitalGainCad,
    deniedLossesCad: row.deniedLossesCad,
    inclusionRate: row.inclusionRate,
    taxableCapitalGainCad: row.taxableCapitalGainCad,
    eligibleDividendsCad: row.eligibleDividendsCad,
    nonEligibleDividendsCad: row.nonEligibleDividendsCad,
    foreignIncomeCad: row.foreignIncomeCad,
    foreignWithholdingCad: row.foreignWithholdingCad,
    federalDividendCreditCad: row.federalDividendCreditCad,
    totalIncomeCad: new D(row.eligibleDividendsCad).plus(row.nonEligibleDividendsCad).plus(row.foreignIncomeCad).toFixed(6),
    estimatedTaxCad: row.estimatedTaxCad,
    configAssumed: row.configAssumed,
  };
}

export async function getTaxYear(db: AnyDb, userId: string, year: number, today: string): Promise<TaxYearView> {
  const isCurrentYear = year === yearOf(today);
  const [[totals], gains, losses, dividends, harvest, [profile]] = await Promise.all([
    db
      .select()
      .from(s.taxYearSummaries)
      .where(and(eq(s.taxYearSummaries.userId, userId), eq(s.taxYearSummaries.taxYear, year))),
    db
      .select({
        id: s.realizedGains.id,
        securityId: s.realizedGains.securityId,
        symbol: s.securities.symbol,
        name: s.securities.name,
        accountName: s.brokerageAccounts.name,
        kind: s.realizedGains.kind,
        dispositionDate: s.realizedGains.dispositionDate,
        quantity: s.realizedGains.quantity,
        proceedsCad: s.realizedGains.proceedsCad,
        acbCad: s.realizedGains.acbCad,
        feesCad: s.realizedGains.feesCad,
        gainCad: s.realizedGains.gainCad,
        deniedLossCad: s.realizedGains.deniedLossCad,
        allowedGainCad: s.realizedGains.allowedGainCad,
        incomplete: s.realizedGains.incomplete,
      })
      .from(s.realizedGains)
      .innerJoin(s.securities, eq(s.securities.id, s.realizedGains.securityId))
      .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.realizedGains.accountId))
      .where(and(eq(s.realizedGains.userId, userId), eq(s.realizedGains.taxYear, year)))
      .orderBy(asc(s.realizedGains.dispositionDate), asc(s.securities.symbol)),
    db
      .select({
        id: s.superficialLosses.id,
        securityId: s.superficialLosses.securityId,
        symbol: s.securities.symbol,
        saleDate: s.superficialLosses.saleDate,
        status: s.superficialLosses.status,
        quantitySold: s.superficialLosses.quantitySold,
        quantityDenied: s.superficialLosses.quantityDenied,
        totalLossCad: s.superficialLosses.totalLossCad,
        deniedLossCad: s.superficialLosses.deniedLossCad,
        allowedLossCad: s.superficialLosses.allowedLossCad,
        lostForeverCad: s.superficialLosses.lostForeverCad,
        windowStart: s.superficialLosses.windowStart,
        windowEnd: s.superficialLosses.windowEnd,
      })
      .from(s.superficialLosses)
      .innerJoin(s.securities, eq(s.securities.id, s.superficialLosses.securityId))
      .where(and(eq(s.superficialLosses.userId, userId), eq(s.superficialLosses.taxYear, year)))
      .orderBy(asc(s.superficialLosses.saleDate)),
    db
      .select({
        securityId: s.incomeEvents.securityId,
        symbol: s.securities.symbol,
        name: s.securities.name,
        accountName: s.brokerageAccounts.name,
        paidDate: s.incomeEvents.paidDate,
        dividendClass: s.incomeEvents.dividendClass,
        amountCad: s.incomeEvents.amountCad,
        grossedUpCad: s.incomeEvents.grossedUpCad,
        federalCreditCad: s.incomeEvents.federalCreditCad,
        withholdingCad: s.incomeEvents.withholdingCad,
      })
      .from(s.incomeEvents)
      .innerJoin(s.securities, eq(s.securities.id, s.incomeEvents.securityId))
      .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.incomeEvents.accountId))
      .where(and(eq(s.incomeEvents.userId, userId), eq(s.incomeEvents.taxYear, year)))
      .orderBy(asc(s.incomeEvents.paidDate), asc(s.securities.symbol)),
    isCurrentYear
      ? db
          .select({
            securityId: s.harvestOpportunities.securityId,
            symbol: s.securities.symbol,
            name: s.securities.name,
            asOfDate: s.harvestOpportunities.asOfDate,
            quantity: s.harvestOpportunities.quantity,
            acbCad: s.harvestOpportunities.acbCad,
            marketValueCad: s.harvestOpportunities.marketValueCad,
            unrealizedLossCad: s.harvestOpportunities.unrealizedLossCad,
            gainsAvailableToOffsetCad: s.harvestOpportunities.gainsAvailableToOffsetCad,
            estimatedTaxSavingsCad: s.harvestOpportunities.estimatedTaxSavingsCad,
            windowStart: s.harvestOpportunities.windowStart,
            windowEnd: s.harvestOpportunities.windowEnd,
            blockedByRecentPurchase: s.harvestOpportunities.blockedByRecentPurchase,
            earliestSafeSaleDate: s.harvestOpportunities.earliestSafeSaleDate,
            noRebuyBefore: s.harvestOpportunities.noRebuyBefore,
          })
          .from(s.harvestOpportunities)
          .innerJoin(s.securities, eq(s.securities.id, s.harvestOpportunities.securityId))
          .where(eq(s.harvestOpportunities.userId, userId))
          .orderBy(desc(s.harvestOpportunities.unrealizedLossCad))
      : Promise.resolve([]),
    db.select({ marginalRate: s.userProfiles.marginalRate }).from(s.userProfiles).where(eq(s.userProfiles.userId, userId)),
  ]);

  // The replacement purchases that absorbed each denied loss, read once for every loss on the page.
  const replacements =
    losses.length === 0
      ? []
      : await db
          .select({
            superficialLossId: s.superficialLossReplacements.superficialLossId,
            accountName: s.brokerageAccounts.name,
            accountType: s.superficialLossReplacements.accountType,
            quantity: s.superficialLossReplacements.quantity,
            deniedCad: s.superficialLossReplacements.deniedCad,
            disposition: s.superficialLossReplacements.disposition,
          })
          .from(s.superficialLossReplacements)
          .innerJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.superficialLossReplacements.accountId))
          .where(
            and(
              eq(s.superficialLossReplacements.userId, userId),
              inArray(
                s.superficialLossReplacements.superficialLossId,
                losses.map((l) => l.id),
              ),
            ),
          )
          .orderBy(asc(s.brokerageAccounts.name));

  return {
    year,
    isCurrentYear,
    totals: totals ? toTotals(totals) : null,
    gains,
    superficialLosses: losses.map((l) => ({
      ...l,
      replacements: replacements.flatMap(({ superficialLossId, ...r }) => (superficialLossId === l.id ? [r] : [])),
    })),
    dividends,
    harvest,
    marginalRate: profile?.marginalRate ?? null,
  };
}

export interface DividendGroup {
  securityId: string;
  symbol: string;
  name: string | null;
  dividendClass: DividendClass;
  /** How many payments were summed into this row. */
  payments: number;
  amountCad: string;
  grossedUpCad: string;
  federalCreditCad: string;
  withholdingCad: string;
}

/** One row per security and class for the page; the CSV export keeps every individual payment. */
export function groupDividends(rows: DividendRow[]): DividendGroup[] {
  const sum = (values: string[]) => values.reduce((total, v) => total.plus(v), new D(0)).toFixed(6);
  const groups = new Map<string, DividendRow[]>();
  for (const row of rows) {
    const key = `${row.securityId}:${row.dividendClass}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()]
    .map((items) => {
      const first = items[0]!;
      return {
        securityId: first.securityId,
        symbol: first.symbol,
        name: first.name,
        dividendClass: first.dividendClass,
        payments: items.length,
        amountCad: sum(items.map((i) => i.amountCad)),
        grossedUpCad: sum(items.map((i) => i.grossedUpCad)),
        federalCreditCad: sum(items.map((i) => i.federalCreditCad)),
        withholdingCad: sum(items.map((i) => i.withholdingCad)),
      };
    })
    .sort((a, b) => Number(b.amountCad) - Number(a.amountCad) || (a.symbol < b.symbol ? -1 : 1));
}
