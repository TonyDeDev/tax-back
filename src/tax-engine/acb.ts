import type { YearConfig } from "./config/rates";
import { yearOf } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import { incomeFromDividend } from "./dividends";
import { dedupeSplits, pairTransfers } from "./ledger";
import { isRegistered } from "./registered";
import { assessSuperficialLoss, buildHeldTimeline, type Acquisition } from "./superficial";
import type {
  AcbEvent,
  AcbPosition,
  AcbRule,
  FxLookup,
  IncomeEvent,
  LedgerEntry,
  RealizedGain,
  SuperficialLoss,
  SuperficialReplacement,
  Warning,
} from "./types";

interface Pool {
  quantity: Dec;
  acb: Dec;
}

export interface LedgerRun {
  positions: AcbPosition[];
  /** Every pooled security with its final quantity, zero included: reconciliation compares all of them. */
  poolQuantities: Map<string, { symbol: string; quantity: Dec }>;
  acbEvents: AcbEvent[];
  gains: RealizedGain[];
  superficialLosses: SuperficialLoss[];
  income: IncomeEvent[];
  warnings: Warning[];
}

/**
 * Walk a sorted ledger once. ACB is pooled per security across every non-registered account.
 * Registered accounts never touch the pool, but their purchases and holdings feed the superficial loss checks.
 */
export function runLedger(
  sorted: readonly LedgerEntry[],
  fx: FxLookup,
  configFor: (year: number) => YearConfig,
  asOfDate: string,
): LedgerRun {
  const held = buildHeldTimeline(sorted);
  // Scoped to the accounts the pool actually tracks: a registered account reporting the split first
  // must not make the non-registered report look like the duplicate.
  const splits = dedupeSplits(sorted.filter((e) => !isRegistered(e.accountType)));
  const transfers = pairTransfers(sorted);
  const acquisitionsBySecurity = new Map<string, Acquisition[]>();
  sorted.forEach((entry, index) => {
    if (entry.kind !== "buy" && entry.kind !== "drip") return;
    const list = acquisitionsBySecurity.get(entry.securityId) ?? [];
    list.push({ entry, index });
    acquisitionsBySecurity.set(entry.securityId, list);
  });

  const pools = new Map<string, Pool>();
  const meta = new Map<string, { symbol: string; currency: string }>();
  const remaining = new Map<string, Dec>();
  const pendingAcb = new Map<string, Dec>();
  const run: LedgerRun = {
    positions: [],
    poolQuantities: new Map(),
    acbEvents: [],
    gains: [],
    superficialLosses: [],
    income: [],
    warnings: [],
  };

  const poolOf = (securityId: string): Pool => {
    let pool = pools.get(securityId);
    if (!pool) {
      pool = { quantity: ZERO, acb: ZERO };
      pools.set(securityId, pool);
    }
    return pool;
  };

  const record = (
    entry: LedgerEntry,
    kind: AcbEvent["kind"],
    rule: AcbRule,
    fxRate: Dec | null,
    pool: Pool,
    quantityDelta: Dec,
    acbDelta: Dec,
    securityId: string = entry.securityId,
  ): void => {
    run.acbEvents.push({
      entryId: entry.id,
      securityId,
      date: entry.settlementDate,
      kind,
      rule,
      fxRate,
      quantityDelta,
      acbDeltaCad: acbDelta,
      poolQuantityAfter: pool.quantity,
      poolAcbAfterCad: pool.acb,
    });
  };

  const warn = (type: "transfer_value_missing", entry: LedgerEntry) =>
    run.warnings.push({ type, securityId: entry.securityId, symbol: entry.symbol, entryId: entry.id });

  /**
   * Takes `quantity` units out of the pool at average cost. Anything beyond the known position is a
   * shortfall: history is missing, so the ACB of those units is unknown and the caller flags it.
   */
  const removeFromPool = (pool: Pool, quantity: Dec) => {
    const known = D.min(quantity, pool.quantity);
    const acbSold = pool.quantity.isZero() ? ZERO : pool.acb.times(known).div(pool.quantity);
    pool.quantity = pool.quantity.minus(known);
    pool.acb = pool.quantity.isZero() ? ZERO : pool.acb.minus(acbSold);
    return { known, shortfall: quantity.minus(known), acbSold };
  };

  const shortfallWarning = (entry: LedgerEntry, shortfall: Dec) => {
    if (!shortfall.gt(0)) return;
    run.warnings.push({
      type: "opening_balance_needed",
      securityId: entry.securityId,
      symbol: entry.symbol,
      entryId: entry.id,
      shortfall,
    });
  };

  sorted.forEach((entry, index) => {
    meta.set(entry.securityId, { symbol: entry.symbol, currency: entry.currency });
    if (entry.target) meta.set(entry.target.securityId, { symbol: entry.target.symbol, currency: entry.target.currency });
    const registered = isRegistered(entry.accountType);

    switch (entry.kind) {
      case "opening": {
        const pool = poolOf(entry.securityId);
        pool.quantity = pool.quantity.plus(entry.quantity);
        pool.acb = pool.acb.plus(entry.amount);
        record(entry, "opening", "opening_balance", null, pool, entry.quantity, entry.amount);
        break;
      }

      case "buy":
      case "drip": {
        if (registered) break;
        const rate = fx(entry.currency, entry.tradeDate);
        const cost = entry.quantity.times(entry.price).plus(entry.fees).times(rate);
        const pool = poolOf(entry.securityId);
        pool.quantity = pool.quantity.plus(entry.quantity);
        pool.acb = pool.acb.plus(cost);
        const rule = entry.kind === "buy" ? "buy_cost_plus_commission" : "drip_reinvested";
        record(entry, entry.kind, rule, rate, pool, entry.quantity, cost);
        const carried = pendingAcb.get(entry.id);
        if (carried) {
          pool.acb = pool.acb.plus(carried);
          record(entry, "superficial_adjustment", "superficial_loss_added", null, pool, ZERO, carried);
        }
        break;
      }

      // New shares paid as a dividend. Their value is a taxable dividend and becomes their cost;
      // with no value reported it behaves like a split (more shares, same ACB).
      case "stock_dividend": {
        if (registered) break;
        const rate = fx(entry.currency, entry.tradeDate);
        const value = entry.amount.times(rate);
        const pool = poolOf(entry.securityId);
        pool.quantity = pool.quantity.plus(entry.quantity);
        pool.acb = pool.acb.plus(value);
        record(entry, "stock_dividend", "stock_dividend_value", rate, pool, entry.quantity, value);
        if (value.gt(0) && entry.dividendClass) {
          const income = incomeFromDividend(entry, rate, configFor(yearOf(entry.tradeDate)));
          if (income) run.income.push(income);
        }
        break;
      }

      case "split": {
        // The pool spans every non-registered account, so only the first report of a split applies.
        if (splits.duplicateIds.has(entry.id)) break;
        if (registered) break;
        const pool = pools.get(entry.securityId);
        if (!pool) break;
        const before = pool.quantity;
        pool.quantity = before.times(entry.splitRatio ?? 1);
        record(entry, "split", "split_quantity_only", null, pool, pool.quantity.minus(before), ZERO);
        break;
      }

      // ACB moves from the parent to the spun-off shares in proportion to their fair market values.
      case "spinoff": {
        const parent = pools.get(entry.securityId);
        if (!parent || !parent.quantity.gt(0) || !entry.target) break;
        const ratio = entry.splitRatio ?? ZERO;
        const childQuantity = parent.quantity.times(ratio);
        const parentValue = parent.quantity.times(entry.price);
        const childValue = childQuantity.times(entry.targetPrice ?? ZERO);
        const moved = parent.acb.times(childValue).div(parentValue.plus(childValue));
        parent.acb = parent.acb.minus(moved);
        record(entry, "spinoff", "spinoff_acb_to_child", null, parent, ZERO, moved.neg());
        const child = poolOf(entry.target.securityId);
        child.quantity = child.quantity.plus(childQuantity);
        child.acb = child.acb.plus(moved);
        record(entry, "spinoff", "spinoff_acb_from_parent", null, child, childQuantity, moved, entry.target.securityId);
        break;
      }

      // Share-for-share exchange: ACB rolls over to the new shares. Cash in the deal is a sale of
      // the share of ACB it replaces, split by fair market value between the cash and the new shares.
      case "merger": {
        const old = pools.get(entry.securityId);
        if (!old || !old.quantity.gt(0) || !entry.target) break;
        const rate = fx(entry.currency, entry.tradeDate);
        const oldQuantity = old.quantity;
        const oldAcb = old.acb;
        const newQuantity = oldQuantity.times(entry.splitRatio ?? ZERO);
        const cash = oldQuantity.times(entry.amount).times(rate);
        const newValue = newQuantity.times(entry.targetPrice ?? ZERO).times(rate);
        const acbForCash = cash.gt(0) ? oldAcb.times(cash).div(cash.plus(newValue)) : ZERO;
        const carried = oldAcb.minus(acbForCash);
        old.quantity = ZERO;
        old.acb = ZERO;
        record(entry, "merger", "merger_rollover_out", cash.gt(0) ? rate : null, old, oldQuantity.neg(), oldAcb.neg());
        const next = poolOf(entry.target.securityId);
        next.quantity = next.quantity.plus(newQuantity);
        next.acb = next.acb.plus(carried);
        record(entry, "merger", "merger_rollover_in", null, next, newQuantity, carried, entry.target.securityId);
        if (cash.gt(0)) {
          const gain = cash.minus(acbForCash);
          run.gains.push({
            entryId: entry.id,
            kind: "merger_cash",
            securityId: entry.securityId,
            symbol: entry.symbol,
            accountId: entry.accountId,
            date: entry.settlementDate,
            year: yearOf(entry.settlementDate),
            quantity: oldQuantity,
            proceedsCad: cash,
            acbCad: acbForCash,
            feesCad: ZERO,
            gainCad: gain,
            deniedLossCad: ZERO,
            allowedGainCad: gain,
            incomplete: false,
          });
        }
        break;
      }

      case "roc": {
        if (registered) break;
        const pool = pools.get(entry.securityId);
        if (!pool || !pool.quantity.gt(0)) {
          run.warnings.push({
            type: "roc_without_position",
            securityId: entry.securityId,
            symbol: entry.symbol,
            entryId: entry.id,
          });
          break;
        }
        const rate = fx(entry.currency, entry.tradeDate);
        const amount = entry.amount.times(rate);
        const excess = D.max(amount.minus(pool.acb), ZERO);
        const reduction = amount.minus(excess);
        pool.acb = pool.acb.minus(reduction);
        record(entry, "roc", excess.gt(0) ? "roc_floors_at_zero" : "roc_reduces_acb", rate, pool, ZERO, reduction.neg());
        if (excess.gt(0)) {
          run.gains.push({
            entryId: entry.id,
            kind: "roc_excess",
            securityId: entry.securityId,
            symbol: entry.symbol,
            accountId: entry.accountId,
            date: entry.settlementDate,
            year: yearOf(entry.settlementDate),
            quantity: ZERO,
            proceedsCad: excess,
            acbCad: ZERO,
            feesCad: ZERO,
            gainCad: excess,
            deniedLossCad: ZERO,
            allowedGainCad: excess,
            incomplete: false,
          });
        }
        break;
      }

      case "dividend": {
        if (registered) break;
        const config = configFor(yearOf(entry.tradeDate));
        const income = incomeFromDividend(entry, fx(entry.currency, entry.tradeDate), config);
        if (income) run.income.push(income);
        break;
      }

      // Account carrying charges are not deductible against capital gains, so a standalone fee
      // never touches the pool. Trade commissions arrive on the buy or sell entry instead.
      case "fee":
        break;

      // A transfer between two non-registered accounts changes nothing: the pool already spans both.
      // Out of a registered account into a non-registered one, the shares are acquired at fair market value.
      case "transfer_in": {
        if (registered) break;
        const from = transfers.get(entry.id);
        if (!from) {
          // Shares from an account TaxBack cannot see arrive with no cost; reconciliation asks for an opening balance.
          run.warnings.push({
            type: "transfer_unmatched",
            securityId: entry.securityId,
            symbol: entry.symbol,
            entryId: entry.id,
            direction: "in",
          });
          break;
        }
        if (!isRegistered(from.accountType)) break;
        if (!entry.price.gt(0)) {
          warn("transfer_value_missing", entry);
          break;
        }
        const rate = fx(entry.currency, entry.tradeDate);
        const cost = entry.quantity.times(entry.price).times(rate);
        const pool = poolOf(entry.securityId);
        pool.quantity = pool.quantity.plus(entry.quantity);
        pool.acb = pool.acb.plus(cost);
        record(entry, "transfer_in", "transfer_from_registered_at_fmv", rate, pool, entry.quantity, cost);
        break;
      }

      // Into a registered account, the shares are deemed sold at fair market value. A gain is taxable;
      // a loss is denied for good (ITA 40(2)(g)(iv)), and unlike a superficial loss it is not carried anywhere.
      case "transfer_out": {
        if (registered) break;
        const to = transfers.get(entry.id);
        if (!to) {
          run.warnings.push({
            type: "transfer_unmatched",
            securityId: entry.securityId,
            symbol: entry.symbol,
            entryId: entry.id,
            direction: "out",
          });
          break;
        }
        if (!isRegistered(to.accountType)) break;
        if (!entry.price.gt(0)) {
          warn("transfer_value_missing", entry);
          break;
        }
        const rate = fx(entry.currency, entry.tradeDate);
        const proceeds = entry.quantity.times(entry.price).times(rate);
        const feesCad = entry.fees.times(rate);
        const pool = poolOf(entry.securityId);
        const { known, shortfall, acbSold } = removeFromPool(pool, entry.quantity);
        record(entry, "transfer_out", "transfer_to_registered_deemed_sale", rate, pool, known.neg(), acbSold.neg());
        shortfallWarning(entry, shortfall);
        const gain = proceeds.minus(acbSold).minus(feesCad);
        const denied = gain.isNegative() ? gain.neg() : ZERO;
        if (denied.gt(0)) {
          run.warnings.push({
            type: "registered_transfer_loss_denied",
            securityId: entry.securityId,
            symbol: entry.symbol,
            entryId: entry.id,
            amountCad: denied,
          });
        }
        run.gains.push({
          entryId: entry.id,
          kind: "deemed_disposition",
          securityId: entry.securityId,
          symbol: entry.symbol,
          accountId: entry.accountId,
          date: entry.settlementDate,
          year: yearOf(entry.settlementDate),
          quantity: entry.quantity,
          proceedsCad: proceeds,
          acbCad: acbSold,
          feesCad,
          gainCad: gain,
          deniedLossCad: denied,
          allowedGainCad: gain.plus(denied),
          incomplete: shortfall.gt(0),
        });
        break;
      }

      case "sell": {
        if (registered) break;
        const rate = fx(entry.currency, entry.tradeDate);
        const proceeds = entry.quantity.times(entry.price).times(rate);
        const feesCad = entry.fees.times(rate);
        const pool = poolOf(entry.securityId);
        const { known, shortfall, acbSold } = removeFromPool(pool, entry.quantity);
        record(entry, "sell", "sell_average_cost", rate, pool, known.neg(), acbSold.neg());
        shortfallWarning(entry, shortfall);

        const gain = proceeds.minus(acbSold).minus(feesCad);
        let denied = ZERO;

        if (gain.isNegative()) {
          const lossCad = gain.neg();
          const assessment = assessSuperficialLoss({
            sale: entry,
            saleIndex: index,
            lossCad,
            acquisitions: acquisitionsBySecurity.get(entry.securityId) ?? [],
            remaining,
            held,
          });
          if (assessment) {
            denied = assessment.deniedLossCad;
            let lostForever = ZERO;
            const replacements: SuperficialReplacement[] = [];
            for (const alloc of assessment.allocations) {
              const target = alloc.acquisition.entry;
              const toRegistered = isRegistered(target.accountType);
              let disposition: SuperficialReplacement["disposition"] = "added_to_acb";
              if (toRegistered) {
                disposition = "lost_forever";
              } else if (alloc.acquisition.index > index) {
                pendingAcb.set(target.id, (pendingAcb.get(target.id) ?? ZERO).plus(alloc.deniedCad));
              } else if (pool.quantity.gt(0)) {
                pool.acb = pool.acb.plus(alloc.deniedCad);
                record(entry, "superficial_adjustment", "superficial_loss_added", null, pool, ZERO, alloc.deniedCad);
              } else {
                disposition = "lost_forever";
              }
              if (disposition === "lost_forever") lostForever = lostForever.plus(alloc.deniedCad);
              replacements.push({
                entryId: target.id,
                accountId: target.accountId,
                accountType: target.accountType,
                quantity: alloc.quantity,
                deniedCad: alloc.deniedCad,
                disposition,
              });
            }
            if (lostForever.gt(0)) {
              run.warnings.push({
                type: "superficial_loss_lost_forever",
                securityId: entry.securityId,
                symbol: entry.symbol,
                entryId: entry.id,
                amountCad: lostForever,
              });
            }
            // The still-held test looks at the end of the window. While that is in the future the
            // answer rests on what the user does next, so the denial is provisional, not settled.
            const pending = assessment.windowEnd > asOfDate;
            if (pending) {
              run.warnings.push({
                type: "superficial_loss_pending",
                securityId: entry.securityId,
                symbol: entry.symbol,
                entryId: entry.id,
                windowEnd: assessment.windowEnd,
              });
            }
            run.superficialLosses.push({
              saleEntryId: entry.id,
              securityId: entry.securityId,
              symbol: entry.symbol,
              saleDate: entry.settlementDate,
              year: yearOf(entry.settlementDate),
              status: pending ? "pending" : "final",
              quantitySold: entry.quantity,
              quantityDenied: assessment.quantityDenied,
              totalLossCad: lossCad,
              deniedLossCad: denied,
              allowedLossCad: lossCad.minus(denied),
              lostForeverCad: lostForever,
              windowStart: assessment.windowStart,
              windowEnd: assessment.windowEnd,
              replacements,
            });
          }
        }

        run.gains.push({
          entryId: entry.id,
          kind: "sale",
          securityId: entry.securityId,
          symbol: entry.symbol,
          accountId: entry.accountId,
          date: entry.settlementDate,
          year: yearOf(entry.settlementDate),
          quantity: entry.quantity,
          proceedsCad: proceeds,
          acbCad: acbSold,
          feesCad,
          gainCad: gain,
          deniedLossCad: denied,
          allowedGainCad: gain.plus(denied),
          incomplete: shortfall.gt(0),
        });
        break;
      }

      default:
        break;
    }
  });

  for (const conflict of splits.conflicts) {
    run.warnings.push({ type: "split_reported_twice", ...conflict });
  }

  for (const [securityId, pool] of pools) {
    const info = meta.get(securityId);
    run.poolQuantities.set(securityId, { symbol: info?.symbol ?? securityId, quantity: pool.quantity });
    if (!pool.quantity.gt(0)) continue;
    run.positions.push({
      securityId,
      symbol: info?.symbol ?? securityId,
      currency: info?.currency ?? "CAD",
      quantity: pool.quantity,
      totalAcbCad: pool.acb,
      acbPerShareCad: pool.acb.div(pool.quantity),
    });
  }
  return run;
}
