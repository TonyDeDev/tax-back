import { formatDate, formatMoney, formatQuantity } from "./format";

/** A stored tax warning, as the Hub reads it. */
export interface WarningView {
  type:
    | "opening_balance_needed"
    | "superficial_loss_lost_forever"
    | "superficial_loss_pending"
    | "unsupported_transfer"
    | "transfer_unmatched"
    | "transfer_value_missing"
    | "registered_transfer_loss_denied"
    | "roc_without_position"
    | "split_reported_twice"
    | "assumed_year_config";
  symbol: string | null;
  taxYear: number | null;
  amountCad: string | null;
  shortfallQuantity: string | null;
  dueDate: string | null;
}

/** One plain sentence per warning. */
export function warningMessage(w: WarningView): string {
  const symbol = w.symbol ?? "A security";
  switch (w.type) {
    case "opening_balance_needed":
      return `${symbol}: sales exceed the purchases SnapTrade reported${
        w.shortfallQuantity ? ` by ${formatQuantity(w.shortfallQuantity)} units` : ""
      }, so its ACB is understated. Older history is missing.`;
    case "superficial_loss_lost_forever":
      return `${symbol}: a superficial loss${
        w.amountCad ? ` of ${formatMoney(w.amountCad)}` : ""
      } was denied for good because the replacement shares are in a registered account.`;
    case "superficial_loss_pending":
      return `${symbol}: a capital loss is denied as superficial for now. It is final once the 30-day window ends${
        w.dueDate ? ` on ${formatDate(w.dueDate)}` : ""
      }.`;
    case "unsupported_transfer":
      return `${symbol}: a transfer between accounts was found. Refresh to apply the newer transfer rules.`;
    case "transfer_unmatched":
      return `${symbol}: shares moved to or from an account TaxBack cannot see. Check the position reconciliation and add an opening balance if needed.`;
    case "transfer_value_missing":
      return `${symbol}: shares crossed between a registered and a non-registered account, but the broker sent no market value, so the transfer was not applied.`;
    case "registered_transfer_loss_denied":
      return `${symbol}: shares moved into a registered account at a loss${
        w.amountCad ? ` of ${formatMoney(w.amountCad)}` : ""
      }. That loss is denied for good, unlike a superficial loss.`;
    case "roc_without_position":
      return `${symbol}: a return of capital arrived while no shares were held.`;
    case "split_reported_twice":
      return `${symbol}: the same split was reported on different dates. It was applied once.`;
    case "assumed_year_config":
      return `${w.taxYear ?? "A year"}: tax rates for this year are not verified yet, so the nearest year's rates were used.`;
  }
}
