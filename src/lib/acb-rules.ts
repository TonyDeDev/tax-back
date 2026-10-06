import type { AcbRule } from "@/tax-engine/types";

/** A short label and the one-sentence rule behind each step of the ACB audit trail. */
export const ACB_RULE_TEXT: Record<AcbRule, { label: string; rule: string }> = {
  opening_balance: {
    label: "Opening balance",
    rule: "You entered the units and total ACB held on this date; earlier non-registered history is replaced by it.",
  },
  buy_cost_plus_commission: {
    label: "Buy",
    rule: "ACB grows by units x price plus the commission, converted to CAD at the trade date's Bank of Canada rate.",
  },
  drip_reinvested: {
    label: "Reinvested dividend",
    rule: "A reinvested dividend buys units, and their cost is added to ACB like any purchase.",
  },
  stock_dividend_value: {
    label: "Stock dividend",
    rule: "New units paid as a dividend; their reported value is a taxable dividend and becomes their cost.",
  },
  sell_average_cost: {
    label: "Sale",
    rule: "A sale removes average cost: total ACB x units sold / units held. Commission reduces the proceeds instead.",
  },
  roc_reduces_acb: {
    label: "Return of capital",
    rule: "Return of capital is not income; it lowers the ACB of the units still held.",
  },
  roc_floors_at_zero: {
    label: "Return of capital",
    rule: "Return of capital beyond the remaining ACB brings ACB to zero, and the excess is a capital gain right away.",
  },
  split_quantity_only: {
    label: "Split",
    rule: "A split or reverse split changes the number of units only; total ACB is unchanged.",
  },
  superficial_loss_added: {
    label: "Denied loss added",
    rule: "A superficial loss was denied, and the denied amount is added to the ACB of the replacement units.",
  },
  transfer_to_registered_deemed_sale: {
    label: "Moved to registered",
    rule: "Moving units into a TFSA, RRSP, or other registered account is a deemed sale at fair market value; a loss is denied for good.",
  },
  transfer_from_registered_at_fmv: {
    label: "Moved from registered",
    rule: "Units withdrawn in kind from a registered account are acquired at their fair market value on that date.",
  },
  spinoff_acb_to_child: {
    label: "Spinoff",
    rule: "Part of the ACB moves to the spun-off shares, in proportion to the fair market values just after the spinoff.",
  },
  spinoff_acb_from_parent: {
    label: "Spinoff",
    rule: "These shares were spun off; their ACB is the parent's ACB times their share of the combined fair market value.",
  },
  merger_rollover_out: {
    label: "Merger",
    rule: "The shares were exchanged in a merger; their ACB carries over to the new shares, less any part sold for cash.",
  },
  merger_rollover_in: {
    label: "Merger",
    rule: "Received in a merger; the old shares' ACB carries over, less the part allocated to any cash by fair market value.",
  },
};
