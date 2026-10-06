import { yearConfig } from "./config/rates";
import { addDays, nextBusinessDay } from "./dates";
import { ZERO, type Dec } from "./decimal";
import { computeTax, type ComputeTaxInput } from "./compute";
import { SUPERFICIAL_WINDOW_DAYS } from "./superficial";
import type { AccountType, LedgerEntry, RealizedGain, SuperficialLoss } from "./types";

export const PREVIEW_ENTRY_ID = "preview:sale";

export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewError";
  }
}

export interface SalePreviewInput extends ComputeTaxInput {
  sale: {
    securityId: string;
    quantity: Dec;
    /** Per unit, in `currency`. */
    price: Dec;
    currency: string;
    fees: Dec;
  };
}

export interface RecentPurchase {
  entryId: string;
  accountId: string;
  accountType: AccountType;
  date: string;
  quantity: Dec;
}

export interface SalePreview {
  symbol: string;
  tradeDate: string;
  settlementDate: string;
  /** The pooled non-registered position before the sale. */
  quantityHeld: Dec;
  totalAcbCad: Dec;
  /** CAD per unit of the sale currency on the trade date. */
  fxRate: Dec;
  gain: RealizedGain;
  /** Present when the sale would be a loss with a purchase inside the window. */
  superficial: SuperficialLoss | null;
  windowStart: string;
  windowEnd: string;
  /** For a loss: buying the security in any account (TFSA and RRSP included) before this date makes it superficial. */
  noRebuyBefore: string | null;
  /** Purchases in any account inside the window so far: each one can make a loss superficial. */
  recentPurchases: RecentPurchase[];
  inclusionRate: Dec;
  taxableCad: Dec;
  /** Tax on this sale alone at the user's marginal rate; negative is tax saved. Null without a rate. */
  estimatedTaxCad: Dec | null;
}

/**
 * "What if I sell?": the same ledger run one step forward. A hypothetical sale from the pooled
 * non-registered position is added today (settling T+1) and the whole engine runs again, so the
 * preview follows exactly the rules the real sale would.
 */
export function previewSale(input: SalePreviewInput): SalePreview {
  const { sale, asOfDate } = input;
  if (!sale.quantity.gt(0)) throw new PreviewError("Enter a quantity above zero.");
  if (sale.price.isNegative() || sale.fees.isNegative()) throw new PreviewError("Price and fees cannot be negative.");

  const known = input.ledger.find((e) => e.securityId === sale.securityId);
  const opening = input.openings?.find((o) => o.securityId === sale.securityId);
  const symbol = known?.symbol ?? known?.target?.symbol ?? opening?.symbol ?? sale.securityId;
  const settlementDate = nextBusinessDay(asOfDate);
  const entry: LedgerEntry = {
    id: PREVIEW_ENTRY_ID,
    accountId: "preview",
    accountType: "non_registered",
    securityId: sale.securityId,
    symbol,
    currency: sale.currency,
    kind: "sell",
    tradeDate: asOfDate,
    settlementDate,
    quantity: sale.quantity,
    price: sale.price,
    fees: sale.fees,
    amount: ZERO,
  };

  const result = computeTax({ ...input, ledger: [...input.ledger, entry] });
  const gain = result.gains.find((g) => g.entryId === PREVIEW_ENTRY_ID && g.kind === "sale");
  const event = result.acbEvents.find((e) => e.entryId === PREVIEW_ENTRY_ID && e.kind === "sell");
  if (!gain || !event) throw new PreviewError("The sale could not be previewed.");

  const quantityHeld = event.poolQuantityAfter.minus(event.quantityDelta);
  const totalAcbCad = event.poolAcbAfterCad.minus(event.acbDeltaCad);
  if (gain.incomplete) {
    throw new PreviewError(
      quantityHeld.isZero()
        ? `No ${symbol} is held in a non-registered account, so there is nothing taxable to sell.`
        : `Only ${quantityHeld.toString()} units of ${symbol} are held in non-registered accounts.`,
    );
  }

  const windowStart = addDays(settlementDate, -SUPERFICIAL_WINDOW_DAYS);
  const windowEnd = addDays(settlementDate, SUPERFICIAL_WINDOW_DAYS);
  const recentPurchases = input.ledger
    .filter(
      (e) =>
        e.securityId === sale.securityId &&
        (e.kind === "buy" || e.kind === "drip") &&
        e.settlementDate >= windowStart &&
        e.settlementDate <= settlementDate,
    )
    .map((e) => ({ entryId: e.id, accountId: e.accountId, accountType: e.accountType, date: e.settlementDate, quantity: e.quantity }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const inclusionRate = yearConfig(gain.year).inclusionRate;
  const taxableCad = gain.allowedGainCad.times(inclusionRate);
  const rate = input.marginalRate;
  return {
    symbol,
    tradeDate: asOfDate,
    settlementDate,
    quantityHeld,
    totalAcbCad,
    fxRate: event.fxRate ?? ZERO,
    gain,
    superficial: result.superficialLosses.find((l) => l.saleEntryId === PREVIEW_ENTRY_ID) ?? null,
    windowStart,
    windowEnd,
    noRebuyBefore: gain.gainCad.isNegative() ? addDays(windowEnd, 1) : null,
    recentPurchases,
    inclusionRate,
    taxableCad,
    estimatedTaxCad: rate === null || rate === undefined ? null : taxableCad.times(rate),
  };
}
