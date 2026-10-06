import { D, type Dec, type FxLookup, type LedgerEntry, type OpeningAdjustment, type TaxResult } from "@/tax-engine";
import type * as s from "./schema";

/*
 * Pure mapping between database rows and the tax engine. No I/O here, so it is unit tested directly.
 * Engine entry ids are transaction ids; opening entries use the engine's `opening:<securityId>` form,
 * and corporate actions `corporate:<corporate action id>`.
 */

type TransactionRow = typeof s.transactions.$inferSelect;
type AccountRow = Pick<typeof s.brokerageAccounts.$inferSelect, "id" | "accountType">;
type SecurityRow = Pick<typeof s.securities.$inferSelect, "id" | "symbol">;
type ManualAdjustmentRow = typeof s.manualAdjustments.$inferSelect;
type CorporateActionRow = typeof s.corporateActions.$inferSelect;
type SecurityWithCurrency = SecurityRow & { currency: string };
type FxRow = Pick<typeof s.fxRates.$inferSelect, "currency" | "rateDate" | "cadPerUnit">;

const OPENING_PREFIX = "opening:";
const CORPORATE_PREFIX = "corporate:";

const dec = (value: string | null | undefined): Dec | undefined =>
  value === null || value === undefined ? undefined : new D(value);
export const moneyText = (value: Dec): string => value.toFixed(6);
export const quantityText = (value: Dec): string => value.toFixed(10);

function lookup<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown ${what} ${key}`);
  return value;
}

/**
 * Builds the engine ledger. Cash-level fees (no security) are dropped: the engine never lets a
 * standalone fee change ACB, so they carry no tax information here.
 */
export function toLedger(
  rows: readonly TransactionRow[],
  accounts: readonly AccountRow[],
  securities: readonly SecurityRow[],
): LedgerEntry[] {
  const accountType = new Map(accounts.map((a) => [a.id, a.accountType]));
  const symbol = new Map(securities.map((x) => [x.id, x.symbol]));
  return rows.flatMap((r): LedgerEntry[] => {
    if (r.securityId === null) return [];
    return [
      {
        id: r.id,
        accountId: r.accountId,
        accountType: lookup(accountType, r.accountId, "account"),
        securityId: r.securityId,
        symbol: lookup(symbol, r.securityId, "security"),
        currency: r.currency,
        kind: r.kind,
        tradeDate: r.tradeDate,
        settlementDate: r.settlementDate,
        quantity: new D(r.quantity),
        price: new D(r.price),
        fees: new D(r.fees),
        amount: new D(r.amount),
        splitRatio: dec(r.splitRatio),
        dividendClass: r.dividendClass ?? undefined,
        withholdingTax: dec(r.withholdingTax),
      },
    ];
  });
}

export function toOpenings(
  rows: readonly ManualAdjustmentRow[],
  securities: readonly SecurityRow[],
): OpeningAdjustment[] {
  const symbol = new Map(securities.map((x) => [x.id, x.symbol]));
  return rows.map((r) => ({
    securityId: r.securityId,
    symbol: lookup(symbol, r.securityId, "security"),
    quantity: new D(r.quantity),
    acbCad: new D(r.acbCad),
    asOfDate: r.asOfDate,
  }));
}

/**
 * Spinoffs and mergers as security-wide engine entries. They carry no account: the engine applies
 * them to the pool and to every registered account holding the security.
 */
export function toCorporateActions(
  rows: readonly CorporateActionRow[],
  securities: readonly SecurityWithCurrency[],
): LedgerEntry[] {
  const byId = new Map(securities.map((x) => [x.id, x]));
  return rows.map((r) => {
    const source = lookup(byId, r.securityId, "security");
    const target = lookup(byId, r.targetSecurityId, "security");
    return {
      id: `${CORPORATE_PREFIX}${r.id}`,
      accountId: "corporate",
      accountType: "non_registered" as const,
      securityId: r.securityId,
      symbol: source.symbol,
      currency: r.currency,
      kind: r.kind,
      tradeDate: r.effectiveDate,
      settlementDate: r.effectiveDate,
      quantity: new D(0),
      price: new D(r.oldFmv ?? 0),
      fees: new D(0),
      amount: new D(r.cashPerShare),
      splitRatio: new D(r.ratio),
      target: { securityId: target.id, symbol: target.symbol, currency: target.currency },
      targetPrice: dec(r.newFmv),
    };
  });
}

/**
 * Bank of Canada rate for the date, or the latest earlier one (weekends and holidays have none).
 * A date before every stored rate throws: a guessed rate would produce wrong tax numbers.
 */
export function fxLookupFrom(rows: readonly FxRow[]): FxLookup {
  const byCurrency = new Map<string, { date: string; rate: Dec }[]>();
  for (const r of rows) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push({ date: r.rateDate, rate: new D(r.cadPerUnit) });
    byCurrency.set(r.currency, list);
  }
  for (const list of byCurrency.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return (currency, date) => {
    if (currency === "CAD") return new D(1);
    const list = byCurrency.get(currency) ?? [];
    let lo = 0;
    let hi = list.length - 1;
    let found: Dec | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const point = list[mid]!;
      if (point.date <= date) {
        found = point.rate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (!found) throw new Error(`No ${currency}/CAD rate on or before ${date}`);
    return found;
  };
}

export interface DerivedRows {
  acbPositions: (typeof s.acbPositions.$inferInsert)[];
  acbEvents: (typeof s.acbEvents.$inferInsert)[];
  realizedGains: (typeof s.realizedGains.$inferInsert)[];
  /** Each loss with its replacements; the replacement rows get `superficialLossId` once the loss is inserted. */
  superficialLosses: {
    loss: typeof s.superficialLosses.$inferInsert;
    replacements: Omit<typeof s.superficialLossReplacements.$inferInsert, "superficialLossId">[];
  }[];
  incomeEvents: (typeof s.incomeEvents.$inferInsert)[];
  harvestOpportunities: (typeof s.harvestOpportunities.$inferInsert)[];
  taxYearSummaries: (typeof s.taxYearSummaries.$inferInsert)[];
  taxWarnings: (typeof s.taxWarnings.$inferInsert)[];
  positionReconciliations: (typeof s.positionReconciliations.$inferInsert)[];
}

/** Maps engine output to insert rows. `openingIds` maps securityId to the manual adjustment that produced its opening. */
export function toDerivedRows(
  userId: string,
  result: TaxResult,
  openingIds: ReadonlyMap<string, string>,
  asOfDate: string,
): DerivedRows {
  const seq = new Map<string, number>();
  const source = (entryId: string, securityId: string) => {
    if (entryId.startsWith(OPENING_PREFIX)) {
      return {
        transactionId: null,
        manualAdjustmentId: lookup(openingIds, securityId, "opening for security"),
        corporateActionId: null,
      };
    }
    if (entryId.startsWith(CORPORATE_PREFIX)) {
      return { transactionId: null, manualAdjustmentId: null, corporateActionId: entryId.slice(CORPORATE_PREFIX.length) };
    }
    return { transactionId: entryId, manualAdjustmentId: null, corporateActionId: null };
  };

  return {
    acbPositions: result.positions.map((p) => ({
      userId,
      securityId: p.securityId,
      quantity: quantityText(p.quantity),
      totalAcbCad: moneyText(p.totalAcbCad),
      acbPerShareCad: moneyText(p.acbPerShareCad),
    })),
    acbEvents: result.acbEvents.map((e) => {
      const n = (seq.get(e.securityId) ?? 0) + 1;
      seq.set(e.securityId, n);
      return {
        userId,
        securityId: e.securityId,
        seq: n,
        ...source(e.entryId, e.securityId),
        eventDate: e.date,
        kind: e.kind,
        rule: e.rule,
        fxRate: e.fxRate ? e.fxRate.toFixed(10) : null,
        quantityDelta: quantityText(e.quantityDelta),
        acbDeltaCad: moneyText(e.acbDeltaCad),
        poolQuantityAfter: quantityText(e.poolQuantityAfter),
        poolAcbAfterCad: moneyText(e.poolAcbAfterCad),
      };
    }),
    realizedGains: result.gains.map((g) => {
      const corporate = g.entryId.startsWith(CORPORATE_PREFIX);
      return {
        userId,
        transactionId: corporate ? null : g.entryId,
        corporateActionId: corporate ? g.entryId.slice(CORPORATE_PREFIX.length) : null,
        securityId: g.securityId,
        accountId: corporate ? null : g.accountId,
        kind: g.kind,
        dispositionDate: g.date,
        taxYear: g.year,
        quantity: quantityText(g.quantity),
        proceedsCad: moneyText(g.proceedsCad),
        acbCad: moneyText(g.acbCad),
        feesCad: moneyText(g.feesCad),
        gainCad: moneyText(g.gainCad),
        deniedLossCad: moneyText(g.deniedLossCad),
        allowedGainCad: moneyText(g.allowedGainCad),
        incomplete: g.incomplete,
      };
    }),
    superficialLosses: result.superficialLosses.map((l) => ({
      loss: {
        userId,
        saleTransactionId: l.saleEntryId,
        securityId: l.securityId,
        saleDate: l.saleDate,
        taxYear: l.year,
        status: l.status,
        quantitySold: quantityText(l.quantitySold),
        quantityDenied: quantityText(l.quantityDenied),
        totalLossCad: moneyText(l.totalLossCad),
        deniedLossCad: moneyText(l.deniedLossCad),
        allowedLossCad: moneyText(l.allowedLossCad),
        lostForeverCad: moneyText(l.lostForeverCad),
        windowStart: l.windowStart,
        windowEnd: l.windowEnd,
      },
      replacements: l.replacements.map((r) => ({
        userId,
        transactionId: r.entryId,
        accountId: r.accountId,
        accountType: r.accountType,
        quantity: quantityText(r.quantity),
        deniedCad: moneyText(r.deniedCad),
        disposition: r.disposition,
      })),
    })),
    incomeEvents: result.income.map((i) => ({
      userId,
      transactionId: i.entryId,
      securityId: i.securityId,
      accountId: i.accountId,
      paidDate: i.date,
      taxYear: i.year,
      dividendClass: i.dividendClass,
      amountCad: moneyText(i.amountCad),
      grossedUpCad: moneyText(i.grossedUpCad),
      federalCreditCad: moneyText(i.federalCreditCad),
      withholdingCad: moneyText(i.withholdingCad),
    })),
    harvestOpportunities: result.harvest.map((h) => ({
      userId,
      securityId: h.securityId,
      asOfDate,
      quantity: quantityText(h.quantity),
      acbCad: moneyText(h.acbCad),
      marketValueCad: moneyText(h.marketValueCad),
      unrealizedLossCad: moneyText(h.unrealizedLossCad),
      gainsAvailableToOffsetCad: moneyText(h.gainsAvailableToOffsetCad),
      estimatedTaxSavingsCad: h.estimatedTaxSavingsCad ? moneyText(h.estimatedTaxSavingsCad) : null,
      windowStart: h.windowStart,
      windowEnd: h.windowEnd,
      blockedByRecentPurchase: h.blockedByRecentPurchase,
      earliestSafeSaleDate: h.earliestSafeSaleDate,
      noRebuyBefore: h.noRebuyBefore,
    })),
    taxYearSummaries: result.years.map((y) => ({
      userId,
      taxYear: y.year,
      proceedsCad: moneyText(y.proceedsCad),
      acbCad: moneyText(y.acbCad),
      feesCad: moneyText(y.feesCad),
      netCapitalGainCad: moneyText(y.netCapitalGainCad),
      deniedLossesCad: moneyText(y.deniedLossesCad),
      inclusionRate: y.inclusionRate.toFixed(5),
      taxableCapitalGainCad: moneyText(y.taxableCapitalGainCad),
      eligibleDividendsCad: moneyText(y.eligibleDividendsCad),
      nonEligibleDividendsCad: moneyText(y.nonEligibleDividendsCad),
      foreignIncomeCad: moneyText(y.foreignIncomeCad),
      foreignWithholdingCad: moneyText(y.foreignWithholdingCad),
      federalDividendCreditCad: moneyText(y.federalDividendCreditCad),
      estimatedTaxCad: y.estimatedTaxCad ? moneyText(y.estimatedTaxCad) : null,
      configAssumed: result.warnings.some((w) => w.type === "assumed_year_config" && w.year === y.year),
    })),
    taxWarnings: result.warnings.map((w) => {
      if (w.type === "assumed_year_config") return { userId, type: w.type, taxYear: w.year };
      const base = { userId, type: w.type, securityId: w.securityId, transactionId: w.entryId };
      switch (w.type) {
        case "opening_balance_needed":
          return { ...base, shortfallQuantity: quantityText(w.shortfall) };
        case "superficial_loss_lost_forever":
        case "registered_transfer_loss_denied":
          return { ...base, amountCad: moneyText(w.amountCad) };
        case "superficial_loss_pending":
          return { ...base, dueDate: w.windowEnd };
        default:
          return base;
      }
    }),
    positionReconciliations: result.reconciliation.rows.map((r) => ({
      userId,
      securityId: r.securityId,
      accountId: r.accountId,
      ledgerQuantity: quantityText(r.ledgerQuantity),
      brokerQuantity: quantityText(r.brokerQuantity),
      status: r.status,
    })),
  };
}
