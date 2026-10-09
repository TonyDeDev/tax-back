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
  securityId: string | null;
  symbol: string | null;
  taxYear: number | null;
  amountCad: string | null;
  shortfallQuantity: string | null;
  dueDate: string | null;
}

/** One plain sentence per warning. `hidden` masks the amounts, for the "hide amounts" toggle. */
export function warningMessage(w: WarningView, hidden = false): string {
  const symbol = w.symbol ?? "A security";
  switch (w.type) {
    case "opening_balance_needed":
      return `${symbol}: sales exceed the purchases SnapTrade reported${
        w.shortfallQuantity ? ` by ${formatQuantity(w.shortfallQuantity)} units` : ""
      }, so its ACB is understated. Older history is missing.`;
    case "superficial_loss_lost_forever":
      return `${symbol}: a superficial loss${
        w.amountCad ? ` of ${formatMoney(w.amountCad, "CAD", { hidden })}` : ""
      } was denied for good because the replacement shares are in a registered account.`;
    case "superficial_loss_pending":
      return `${symbol}: a capital loss is denied as superficial for now. It is final once the 30-day window ends${
        w.dueDate ? ` on ${formatDate(w.dueDate)}` : ""
      }.`;
    case "unsupported_transfer":
      return `${symbol}: a transfer between accounts was found. Refresh to apply the newer transfer rules.`;
    case "transfer_unmatched":
      return `${symbol}: shares moved to or from an account Snap Tax Back cannot see. Check the position reconciliation and add an opening balance if needed.`;
    case "transfer_value_missing":
      return `${symbol}: shares crossed between a registered and a non-registered account, but the broker sent no market value, so the transfer was not applied.`;
    case "registered_transfer_loss_denied":
      return `${symbol}: shares moved into a registered account at a loss${
        w.amountCad ? ` of ${formatMoney(w.amountCad, "CAD", { hidden })}` : ""
      }. That loss is denied for good, unlike a superficial loss.`;
    case "roc_without_position":
      return `${symbol}: a return of capital arrived while no shares were held.`;
    case "split_reported_twice":
      return `${symbol}: the same split was reported on different dates. It was applied once.`;
    case "assumed_year_config":
      return `${w.taxYear ?? "A year"}: tax rates for this year are not verified yet, so the nearest year's rates were used.`;
  }
}

/** One row in the Hub's "Needs attention" list. */
export interface AttentionItem {
  /** Negative needs the user to act; neutral is for their information. */
  tone: "negative" | "neutral";
  text: string;
  href: string;
  linkLabel: string;
}

/** A warning as one short line with a link to where it is resolved. The full sentence is `warningMessage`. */
export function warningAttention(w: WarningView, hidden = false): AttentionItem {
  const symbol = w.symbol ?? "A security";
  const security = w.securityId ? `/hub/securities/${w.securityId}` : "/hub";
  const amount = w.amountCad ? ` (${formatMoney(w.amountCad, "CAD", { hidden })})` : "";
  switch (w.type) {
    case "opening_balance_needed":
      return { tone: "negative", text: `${symbol}: older history is missing`, href: `${security}#opening`, linkLabel: "Add opening balance" };
    case "superficial_loss_lost_forever":
      return { tone: "negative", text: `${symbol}: superficial loss denied for good${amount}`, href: `${security}#audit`, linkLabel: "Review" };
    case "superficial_loss_pending":
      return {
        tone: "neutral",
        text: `${symbol}: superficial loss pending${w.dueDate ? ` until ${formatDate(w.dueDate)}` : ""}`,
        href: `${security}#audit`,
        linkLabel: "Review",
      };
    case "unsupported_transfer":
      return { tone: "neutral", text: `${symbol}: refresh to apply transfer rules`, href: security, linkLabel: "Review" };
    case "transfer_unmatched":
      return { tone: "negative", text: `${symbol}: transfer from an unseen account`, href: `${security}#opening`, linkLabel: "Review" };
    case "transfer_value_missing":
      return { tone: "negative", text: `${symbol}: transfer has no market value`, href: security, linkLabel: "Review" };
    case "registered_transfer_loss_denied":
      return { tone: "negative", text: `${symbol}: loss on move into a registered account${amount}`, href: `${security}#audit`, linkLabel: "Review" };
    case "roc_without_position":
      return { tone: "neutral", text: `${symbol}: return of capital with no shares held`, href: `${security}#audit`, linkLabel: "Review" };
    case "split_reported_twice":
      return { tone: "neutral", text: `${symbol}: split reported twice, applied once`, href: `${security}#audit`, linkLabel: "Review" };
    case "assumed_year_config":
      return {
        tone: "neutral",
        text: `${w.taxYear ?? "A year"}: tax rates not verified yet`,
        href: w.taxYear ? `/tax/${w.taxYear}` : "/hub",
        linkLabel: "Open Tax Center",
      };
  }
}
