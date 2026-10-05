import type { YearConfig } from "./config/rates";
import { yearOf } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import { incomeFromDividend } from "./dividends";
import { dedupeSplits } from "./ledger";
import { isRegistered } from "./registered";
import { assessSuperficialLoss, buildHeldTimeline, type Acquisition } from "./superficial";
import type {
  AcbEvent,
  AcbPosition,
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
    pool: Pool,
    quantityDelta: Dec,
    acbDelta: Dec,
  ): void => {
    run.acbEvents.push({
      entryId: entry.id,
      securityId: entry.securityId,
      date: entry.settlementDate,
      kind,
      quantityDelta,
      acbDeltaCad: acbDelta,
      poolQuantityAfter: pool.quantity,
      poolAcbAfterCad: pool.acb,
    });
  };

  sorted.forEach((entry, index) => {
    meta.set(entry.securityId, { symbol: entry.symbol, currency: entry.currency });
    const registered = isRegistered(entry.accountType);

    switch (entry.kind) {
      case "opening": {
        const pool = poolOf(entry.securityId);
        pool.quantity = pool.quantity.plus(entry.quantity);
        pool.acb = pool.acb.plus(entry.amount);
        record(entry, "opening", pool, entry.quantity, entry.amount);
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
        record(entry, entry.kind, pool, entry.quantity, cost);
        const carried = pendingAcb.get(entry.id);
        if (carried) {
          pool.acb = pool.acb.plus(carried);
          record(entry, "superficial_adjustment", pool, ZERO, carried);
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
        record(entry, "split", pool, pool.quantity.minus(before), ZERO);
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
        const amount = entry.amount.times(fx(entry.currency, entry.tradeDate));
        const excess = D.max(amount.minus(pool.acb), ZERO);
        const reduction = amount.minus(excess);
        pool.acb = pool.acb.minus(reduction);
        record(entry, "roc", pool, ZERO, reduction.neg());
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

      case "transfer_in":
      case "transfer_out":
        run.warnings.push({
          type: "unsupported_transfer",
          securityId: entry.securityId,
          symbol: entry.symbol,
          entryId: entry.id,
        });
        break;

      case "sell": {
        if (registered) break;
        const rate = fx(entry.currency, entry.tradeDate);
        const proceeds = entry.quantity.times(entry.price).times(rate);
        const feesCad = entry.fees.times(rate);
        const pool = poolOf(entry.securityId);
        const known = D.min(entry.quantity, pool.quantity);
        const shortfall = entry.quantity.minus(known);
        const acbSold = pool.quantity.isZero() ? ZERO : pool.acb.times(known).div(pool.quantity);
        pool.quantity = pool.quantity.minus(known);
        pool.acb = pool.quantity.isZero() ? ZERO : pool.acb.minus(acbSold);
        record(entry, "sell", pool, known.neg(), acbSold.neg());
        if (shortfall.gt(0)) {
          run.warnings.push({
            type: "opening_balance_needed",
            securityId: entry.securityId,
            symbol: entry.symbol,
            entryId: entry.id,
            shortfall,
          });
        }

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
                record(entry, "superficial_adjustment", pool, ZERO, alloc.deniedCad);
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
    if (!pool.quantity.gt(0)) continue;
    const info = meta.get(securityId);
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
