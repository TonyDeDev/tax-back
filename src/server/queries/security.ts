import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { loadUserPools, type PoolReason } from "@/server/db/pools";
import type { AnyDb } from "@/server/db/types";
import { latestRates } from "@/server/fx/boc";
import { gapClass, type GapClass } from "@/server/reconciliation";
import { D, isRegistered, type AcbRule, type AccountType, type DividendClass } from "@/tax-engine";

/*
 * Read queries for the security detail page: the ACB audit trail with the source of every step, the
 * realized gains, the reconciliation rows, and what the forms need. Every query is scoped by `userId`.
 * Values stay decimal strings; the browser only formats them.
 */

export type AuditSource =
  | {
      type: "transaction";
      accountName: string;
      accountType: AccountType;
      brokerage: string;
      currency: string;
      quantity: string;
      price: string;
      fees: string;
      amount: string;
      tradeDate: string;
    }
  | { type: "opening"; asOfDate: string; note: string | null }
  | {
      type: "corporate";
      kind: "spinoff" | "merger";
      /** The other security in the action, and whether this one gave or received shares. */
      otherSymbol: string;
      role: "source" | "target";
      ratio: string;
      currency: string;
      oldFmv: string | null;
      newFmv: string | null;
      cashPerShare: string;
    };

export interface AuditStep {
  seq: number;
  date: string;
  kind: string;
  rule: AcbRule;
  fxRate: string | null;
  quantityDelta: string;
  acbDeltaCad: string;
  poolQuantityAfter: string;
  poolAcbAfterCad: string;
  acbPerShareAfterCad: string | null;
  source: AuditSource;
}

export interface SecurityGain {
  date: string;
  kind: "sale" | "roc_excess" | "deemed_disposition" | "merger_cash";
  accountName: string | null;
  quantity: string;
  proceedsCad: string;
  acbCad: string;
  feesCad: string;
  gainCad: string;
  deniedLossCad: string;
  allowedGainCad: string;
}

export interface SecurityReconciliationRow {
  /** Null for the pooled non-registered position. */
  accountId: string | null;
  accountName: string | null;
  accountType: AccountType | null;
  ledgerQuantity: string;
  brokerQuantity: string;
  status: "match" | "broker_has_more" | "ledger_has_more";
  /** Null for a match. */
  gapClass: GapClass | null;
  gapSince: string | null;
}

export interface CorporateActionView {
  id: string;
  kind: "spinoff" | "merger";
  role: "source" | "target";
  otherSymbol: string;
  effectiveDate: string;
  ratio: string;
  currency: string;
  oldFmv: string | null;
  newFmv: string | null;
  cashPerShare: string;
}

export interface ListingView {
  id: string;
  symbol: string;
  exchange: string | null;
  currency: string;
  reason: PoolReason;
}

export interface SecurityDetail {
  security: { id: string; symbol: string; name: string | null; currency: string; exchange: string | null };
  /** Every listing pooled with this one as identical property, this one first. */
  listings: ListingView[];
  /** The user's dividend class for the pool, or null for automatic. */
  dividendOverride: DividendClass | null;
  /** What dividends get without an override: eligible when the pool has a Canadian listing. */
  automaticDividendClass: DividendClass;
  position: { quantity: string; totalAcbCad: string; acbPerShareCad: string } | null;
  price: { price: string; currency: string } | null;
  marketValueCad: string | null;
  unrealizedCad: string | null;
  audit: AuditStep[];
  gains: SecurityGain[];
  reconciliation: SecurityReconciliationRow[];
  opening: { quantity: string; acbCad: string; asOfDate: string; note: string | null } | null;
  corporateActions: CorporateActionView[];
  /** Securities this user has seen outside this pool, for corporate actions and linking listings. */
  otherSecurities: { id: string; symbol: string }[];
  /** Earliest settlement date in this security's history, the natural date for an opening balance. */
  firstActivityDate: string | null;
  /**
   * The registered accounts holding it when it has never touched a non-registered account (no ACB, no
   * gains, no opening balance, no corporate action): nothing about it affects tax. Null otherwise.
   */
  registeredOnlyIn: string[] | null;
}

/** The canonical listing for a security id, so a page for RY (NYSE) can show the pooled RY. */
export async function canonicalSecurityId(db: AnyDb, userId: string, securityId: string): Promise<string> {
  const { pools } = await loadUserPools(db, userId);
  return pools.poolOf(securityId);
}

/** `securityId` must be canonical (see `canonicalSecurityId`); listings pooled with it are included. */
export async function getSecurityDetail(db: AnyDb, userId: string, securityId: string, today: string): Promise<SecurityDetail | null> {
  const { pools } = await loadUserPools(db, userId);
  const pooled = pools.listingsOf(securityId);
  const listingIds = pooled.length > 0 ? pooled.map((l) => l.id) : [securityId];
  const [[security], [position], events, gains, reconciliation, [opening], corporate, holdings, firstTx, accounts] = await Promise.all([
    db
      .select({ id: s.securities.id, symbol: s.securities.symbol, name: s.securities.name, currency: s.securities.currency, exchange: s.securities.exchange })
      .from(s.securities)
      .where(eq(s.securities.id, securityId)),
    db
      .select({ quantity: s.acbPositions.quantity, totalAcbCad: s.acbPositions.totalAcbCad, acbPerShareCad: s.acbPositions.acbPerShareCad })
      .from(s.acbPositions)
      .where(and(eq(s.acbPositions.userId, userId), eq(s.acbPositions.securityId, securityId))),
    db
      .select({
        seq: s.acbEvents.seq,
        date: s.acbEvents.eventDate,
        kind: s.acbEvents.kind,
        rule: s.acbEvents.rule,
        fxRate: s.acbEvents.fxRate,
        quantityDelta: s.acbEvents.quantityDelta,
        acbDeltaCad: s.acbEvents.acbDeltaCad,
        poolQuantityAfter: s.acbEvents.poolQuantityAfter,
        poolAcbAfterCad: s.acbEvents.poolAcbAfterCad,
        manualAdjustmentId: s.acbEvents.manualAdjustmentId,
        corporateActionId: s.acbEvents.corporateActionId,
        tx: {
          currency: s.transactions.currency,
          quantity: s.transactions.quantity,
          price: s.transactions.price,
          fees: s.transactions.fees,
          amount: s.transactions.amount,
          tradeDate: s.transactions.tradeDate,
        },
        accountName: s.brokerageAccounts.name,
        accountType: s.brokerageAccounts.accountType,
        brokerage: s.connections.brokerageName,
      })
      .from(s.acbEvents)
      .leftJoin(s.transactions, and(eq(s.transactions.id, s.acbEvents.transactionId), eq(s.transactions.userId, userId)))
      .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.transactions.accountId))
      .leftJoin(s.connections, eq(s.connections.id, s.brokerageAccounts.connectionId))
      .where(and(eq(s.acbEvents.userId, userId), eq(s.acbEvents.securityId, securityId)))
      .orderBy(asc(s.acbEvents.seq)),
    db
      .select({
        date: s.realizedGains.dispositionDate,
        kind: s.realizedGains.kind,
        accountName: s.brokerageAccounts.name,
        quantity: s.realizedGains.quantity,
        proceedsCad: s.realizedGains.proceedsCad,
        acbCad: s.realizedGains.acbCad,
        feesCad: s.realizedGains.feesCad,
        gainCad: s.realizedGains.gainCad,
        deniedLossCad: s.realizedGains.deniedLossCad,
        allowedGainCad: s.realizedGains.allowedGainCad,
      })
      .from(s.realizedGains)
      .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.realizedGains.accountId))
      .where(and(eq(s.realizedGains.userId, userId), eq(s.realizedGains.securityId, securityId)))
      .orderBy(asc(s.realizedGains.dispositionDate)),
    db
      .select({
        accountId: s.positionReconciliations.accountId,
        accountName: s.brokerageAccounts.name,
        accountType: s.brokerageAccounts.accountType,
        ledgerQuantity: s.positionReconciliations.ledgerQuantity,
        brokerQuantity: s.positionReconciliations.brokerQuantity,
        status: s.positionReconciliations.status,
        gapSince: s.positionReconciliations.gapSince,
      })
      .from(s.positionReconciliations)
      .leftJoin(s.brokerageAccounts, eq(s.brokerageAccounts.id, s.positionReconciliations.accountId))
      .where(and(eq(s.positionReconciliations.userId, userId), eq(s.positionReconciliations.securityId, securityId))),
    db
      .select({
        id: s.manualAdjustments.id,
        quantity: s.manualAdjustments.quantity,
        acbCad: s.manualAdjustments.acbCad,
        asOfDate: s.manualAdjustments.asOfDate,
        note: s.manualAdjustments.note,
      })
      .from(s.manualAdjustments)
      .where(and(eq(s.manualAdjustments.userId, userId), inArray(s.manualAdjustments.securityId, listingIds)))
      .orderBy(desc(s.manualAdjustments.asOfDate)),
    db
      .select()
      .from(s.corporateActions)
      .where(
        and(
          eq(s.corporateActions.userId, userId),
          or(inArray(s.corporateActions.securityId, listingIds), inArray(s.corporateActions.targetSecurityId, listingIds)),
        ),
      )
      .orderBy(asc(s.corporateActions.effectiveDate)),
    db
      .select({ quantity: s.holdings.quantity, price: s.holdings.price, currency: s.holdings.currency })
      .from(s.holdings)
      .where(and(eq(s.holdings.userId, userId), inArray(s.holdings.securityId, listingIds))),
    db
      .select({ date: s.transactions.settlementDate })
      .from(s.transactions)
      .where(and(eq(s.transactions.userId, userId), inArray(s.transactions.securityId, listingIds)))
      .orderBy(asc(s.transactions.settlementDate))
      .limit(1),
    // Every account that has traded or holds it, to tell a registered-only security apart.
    db
      .selectDistinct({ name: s.brokerageAccounts.name, type: s.brokerageAccounts.accountType })
      .from(s.brokerageAccounts)
      .where(
        and(
          eq(s.brokerageAccounts.userId, userId),
          or(
            inArray(
              s.brokerageAccounts.id,
              db
                .select({ id: s.transactions.accountId })
                .from(s.transactions)
                .where(and(eq(s.transactions.userId, userId), inArray(s.transactions.securityId, listingIds))),
            ),
            inArray(
              s.brokerageAccounts.id,
              db
                .select({ id: s.holdings.accountId })
                .from(s.holdings)
                .where(and(eq(s.holdings.userId, userId), inArray(s.holdings.securityId, listingIds))),
            ),
          ),
        ),
      )
      .orderBy(asc(s.brokerageAccounts.name)),
  ]);
  if (!security) return null;
  // Securities are shared reference data; the page only exists for ones this user has touched.
  const touched = position || events.length > 0 || holdings.length > 0 || corporate.length > 0 || opening || firstTx.length > 0;
  if (!touched) return null;

  // Symbols for corporate action counterparts, and every security this user has seen for the form.
  const seen = await db
    .selectDistinct({ id: s.securities.id, symbol: s.securities.symbol })
    .from(s.securities)
    .where(
      or(
        inArray(s.securities.id, db.select({ id: s.holdings.securityId }).from(s.holdings).where(eq(s.holdings.userId, userId))),
        inArray(
          s.securities.id,
          db.select({ id: s.transactions.securityId }).from(s.transactions).where(eq(s.transactions.userId, userId)),
        ),
        inArray(s.securities.id, corporate.flatMap((c) => [c.securityId, c.targetSecurityId])),
      ),
    )
    .orderBy(asc(s.securities.symbol));
  const symbolOf = new Map(seen.map((x) => [x.id, x.symbol]));

  const inPool = new Set(listingIds);
  const actions: CorporateActionView[] = corporate.map((c) => {
    const role = inPool.has(c.securityId) ? "source" : "target";
    const other = role === "source" ? c.targetSecurityId : c.securityId;
    return {
      id: c.id,
      kind: c.kind,
      role,
      otherSymbol: symbolOf.get(other) ?? "?",
      effectiveDate: c.effectiveDate,
      ratio: c.ratio,
      currency: c.currency,
      oldFmv: c.oldFmv,
      newFmv: c.newFmv,
      cashPerShare: c.cashPerShare,
    };
  });
  const actionById = new Map(actions.map((a) => [a.id, a]));

  const audit: AuditStep[] = events.map((e) => {
    let source: AuditSource;
    if (e.corporateActionId) {
      const a = actionById.get(e.corporateActionId);
      source = {
        type: "corporate",
        kind: a?.kind ?? "merger",
        otherSymbol: a?.otherSymbol ?? "?",
        role: a?.role ?? "source",
        ratio: a?.ratio ?? "0",
        currency: a?.currency ?? "CAD",
        oldFmv: a?.oldFmv ?? null,
        newFmv: a?.newFmv ?? null,
        cashPerShare: a?.cashPerShare ?? "0",
      };
    } else if (e.manualAdjustmentId || !e.tx) {
      source = { type: "opening", asOfDate: opening?.asOfDate ?? e.date, note: opening?.note ?? null };
    } else {
      source = {
        type: "transaction",
        accountName: e.accountName ?? "Account",
        accountType: e.accountType ?? "non_registered",
        brokerage: e.brokerage ?? "",
        ...e.tx,
      };
    }
    const qty = new D(e.poolQuantityAfter);
    return {
      seq: e.seq,
      date: e.date,
      kind: e.kind,
      rule: e.rule,
      fxRate: e.fxRate,
      quantityDelta: e.quantityDelta,
      acbDeltaCad: e.acbDeltaCad,
      poolQuantityAfter: e.poolQuantityAfter,
      poolAcbAfterCad: e.poolAcbAfterCad,
      acbPerShareAfterCad: qty.gt(0) ? new D(e.poolAcbAfterCad).div(qty).toFixed(6) : null,
      source,
    };
  });

  const registeredOnly =
    accounts.length > 0 &&
    accounts.every((a) => isRegistered(a.type)) &&
    !position &&
    events.length === 0 &&
    gains.length === 0 &&
    !opening &&
    corporate.length === 0;

  const priced = holdings.find((h) => h.price !== null);
  let marketValueCad: string | null = null;
  let unrealizedCad: string | null = null;
  if (priced && position) {
    const rates = await latestRates(db, [priced.currency], today);
    const rate = rates.get(priced.currency);
    if (rate) {
      const value = new D(position.quantity).times(priced.price!).times(rate);
      marketValueCad = value.toFixed(2);
      unrealizedCad = value.minus(position.totalAcbCad).toFixed(2);
    }
  }

  return {
    security,
    listings: (pooled.length > 0 ? pooled : [{ ...security, reason: "canonical" as const }]).map((l) => ({
      id: l.id,
      symbol: l.symbol,
      exchange: l.exchange,
      currency: l.currency,
      reason: l.reason,
    })),
    dividendOverride: pools.dividendOverride(securityId),
    automaticDividendClass: pooled.some((l) => l.country === "CA") ? "eligible" : "foreign",
    position: position ?? null,
    price: priced ? { price: priced.price!, currency: priced.currency } : null,
    marketValueCad,
    unrealizedCad,
    audit,
    gains,
    reconciliation: reconciliation.map((r) => ({
      ...r,
      accountName: r.accountName ?? null,
      accountType: r.accountType ?? null,
      gapClass: r.status === "match" ? null : gapClass(r, today),
    })),
    opening: opening ? { quantity: opening.quantity, acbCad: opening.acbCad, asOfDate: opening.asOfDate, note: opening.note } : null,
    corporateActions: actions,
    otherSecurities: seen.filter((x) => !inPool.has(x.id)),
    firstActivityDate: firstTx[0]?.date ?? null,
    registeredOnlyIn: registeredOnly ? accounts.map((a) => a.name) : null,
  };
}
