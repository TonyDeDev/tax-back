import type { DividendClass } from "@/tax-engine/types";
import { D } from "@/tax-engine/decimal";
import type { GainRow, TaxYearView } from "@/server/queries/tax";
import { ACCOUNT_TYPE_LABELS } from "./account-types";

/*
 * The Tax Center CSV export: one file per tax year, with a section per table on the page.
 *
 * Money is written as a plain number with two decimals and no currency symbol or thousands
 * separator, so a spreadsheet parses it as a number. Quantities keep what they have. Sums come from
 * the saved year summary wherever one exists, so the file never recomputes tax.
 */

export const GAIN_KIND_LABELS: Record<GainRow["kind"], string> = {
  sale: "Sale",
  roc_excess: "Return of capital over ACB",
  deemed_disposition: "Deemed sale (moved into a registered account)",
  merger_cash: "Cash part of a merger",
};

export const DIVIDEND_CLASS_LABELS: Record<DividendClass, string> = {
  eligible: "Eligible",
  non_eligible: "Non-eligible",
  foreign: "Foreign",
};

type Cell = string | number | boolean | null | undefined;

/**
 * Text that a spreadsheet would run as a formula: it starts with =, +, -, @, a tab or a carriage return.
 * Security names and descriptions come from brokerages, so one named "=HYPERLINK(...)" must not execute
 * when the export is opened in Excel. A plain number such as "-12.34" stays a number.
 */
function isFormula(text: string): boolean {
  return /^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?%?$/.test(text);
}

/**
 * RFC 4180: quote a cell that holds a comma, a quote, a newline, or edge whitespace, and double its
 * quotes. A formula-like cell gets a leading apostrophe (OWASP CSV injection), so it shows as text.
 */
function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  const text = isFormula(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) || text.trim() !== text ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Cell[][]): string {
  // CRLF and a trailing newline: what Excel writes, and what every reader accepts.
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Money for a spreadsheet: "1234.50", never "$1,234.50". */
const money = (value: string | null | undefined) => (value === null || value === undefined ? "" : new D(value).toFixed(2));

/** Drop the trailing zeros Postgres pads a `numeric` with: "30.0000000000" becomes "30". */
const qty = (value: string) => new D(value).toString();

const percent = (value: string) => `${new D(value).times(100).toDP(3).toString()}%`;

/**
 * The engine's total: the stored six-decimal values added, then rounded once. It can differ by a cent
 * or two from adding up the printed column, because each printed cell is rounded on its own. Rounding
 * each cell first would make that one column foot but would then disagree with the summary, which adds
 * the same payments up by class. No summation order avoids this, so every total here stays the
 * authoritative one and the header says detail rows are rounded.
 */
const sum = (values: (string | null)[]) => values.reduce((total, v) => total.plus(v ?? 0), new D(0)).toFixed(2);

/** A section with nothing in it still gets its heading, so the reader can tell it was checked. */
const empty = (title: string): Cell[][] => [[title], ["None for this year."]];

function summarySection(view: TaxYearView): Cell[][] {
  const t = view.totals;
  if (!t) return [["Summary"], ["No tax results for this year."]];
  return [
    ["Summary"],
    ["Line", "Amount (CAD)"],
    ["Proceeds of disposition", money(t.proceedsCad)],
    ["Adjusted cost base", money(t.acbCad)],
    ["Outlays and expenses", money(t.feesCad)],
    ["Capital gain or loss before denials", money(t.grossGainCad)],
    ["Superficial losses denied", money(t.deniedLossesCad)],
    ["Net capital gain or loss", money(t.netCapitalGainCad)],
    ["Inclusion rate", percent(t.inclusionRate)],
    ["Taxable capital gain", money(t.taxableCapitalGainCad)],
    ["Eligible dividends received", money(t.eligibleDividendsCad)],
    ["Non-eligible dividends received", money(t.nonEligibleDividendsCad)],
    ["Foreign income", money(t.foreignIncomeCad)],
    ["Foreign tax withheld", money(t.foreignWithholdingCad)],
    ["Federal dividend tax credit", money(t.federalDividendCreditCad)],
    ["Estimated tax on capital gains", t.estimatedTaxCad === null ? "not estimated (no marginal rate set)" : money(t.estimatedTaxCad)],
  ];
}

function gainsSection(view: TaxYearView): Cell[][] {
  if (view.gains.length === 0) return empty("Realized gains and losses (Schedule 3)");
  const rows: Cell[][] = [
    ["Realized gains and losses (Schedule 3)"],
    [
      "Settlement date",
      "Security",
      "Account",
      "Event",
      "Units",
      "Proceeds (CAD)",
      "Adjusted cost base (CAD)",
      "Outlays and expenses (CAD)",
      "Gain or loss (CAD)",
      "Denied as superficial (CAD)",
      "Reportable gain or loss (CAD)",
      "History incomplete",
    ],
  ];
  for (const g of view.gains) {
    rows.push([
      g.dispositionDate,
      g.name ? `${g.symbol} - ${g.name}` : g.symbol,
      g.accountName ?? "pooled, non-registered",
      GAIN_KIND_LABELS[g.kind],
      qty(g.quantity),
      money(g.proceedsCad),
      money(g.acbCad),
      money(g.feesCad),
      money(g.gainCad),
      money(g.deniedLossCad),
      money(g.allowedGainCad),
      g.incomplete,
    ]);
  }
  if (view.totals) {
    const t = view.totals;
    rows.push([
      "Total",
      "",
      "",
      "",
      "",
      money(t.proceedsCad),
      money(t.acbCad),
      money(t.feesCad),
      money(t.grossGainCad),
      money(t.deniedLossesCad),
      money(t.netCapitalGainCad),
      "",
    ]);
  }
  return rows;
}

function superficialSection(view: TaxYearView): Cell[][] {
  if (view.superficialLosses.length === 0) return empty("Superficial losses");
  const rows: Cell[][] = [
    ["Superficial losses"],
    [
      "Sale date",
      "Security",
      "Status",
      "Units sold",
      "Units denied",
      "Loss (CAD)",
      "Denied (CAD)",
      "Allowed (CAD)",
      "Lost for good (CAD)",
      "Window start",
      "Window end",
    ],
  ];
  for (const l of view.superficialLosses) {
    rows.push([
      l.saleDate,
      l.symbol,
      l.status === "pending" ? "pending until the window closes" : "final",
      qty(l.quantitySold),
      qty(l.quantityDenied),
      money(l.totalLossCad),
      money(l.deniedLossCad),
      money(l.allowedLossCad),
      money(l.lostForeverCad),
      l.windowStart,
      l.windowEnd,
    ]);
  }
  const replacements = view.superficialLosses.flatMap((l) => l.replacements.map((r) => ({ ...r, loss: l })));
  if (replacements.length === 0) return rows;
  return [
    ...rows,
    [],
    ["Replacement purchases that absorbed the denied loss"],
    ["Sale date", "Security", "Account", "Account type", "Units", "Denied loss (CAD)", "Where the denied loss went"],
    ...replacements.map((r) => [
      r.loss.saleDate,
      r.loss.symbol,
      r.accountName,
      ACCOUNT_TYPE_LABELS[r.accountType],
      qty(r.quantity),
      money(r.deniedCad),
      r.disposition === "added_to_acb" ? "added to the ACB of the replacement shares" : "lost for good (registered account)",
    ]),
  ];
}

function dividendsSection(view: TaxYearView): Cell[][] {
  if (view.dividends.length === 0) return empty("Dividends and investment income");
  const rows: Cell[][] = [
    ["Dividends and investment income"],
    ["Paid date", "Security", "Account", "Class", "Amount (CAD)", "Taxable amount (CAD)", "Federal dividend tax credit (CAD)", "Foreign tax withheld (CAD)"],
  ];
  for (const d of view.dividends) {
    rows.push([
      d.paidDate,
      d.name ? `${d.symbol} - ${d.name}` : d.symbol,
      d.accountName ?? "",
      DIVIDEND_CLASS_LABELS[d.dividendClass],
      money(d.amountCad),
      money(d.grossedUpCad),
      money(d.federalCreditCad),
      money(d.withholdingCad),
    ]);
  }
  rows.push([
    "Total",
    "",
    "",
    "",
    sum(view.dividends.map((d) => d.amountCad)),
    sum(view.dividends.map((d) => d.grossedUpCad)),
    sum(view.dividends.map((d) => d.federalCreditCad)),
    sum(view.dividends.map((d) => d.withholdingCad)),
  ]);
  return rows;
}

function harvestSection(view: TaxYearView): Cell[][] {
  if (view.harvest.length === 0) return [];
  return [
    [],
    [`Tax-loss harvesting, as of ${view.harvest[0]!.asOfDate}`],
    [
      "Security",
      "Units",
      "Adjusted cost base (CAD)",
      "Market value (CAD)",
      "Unrealized loss (CAD)",
      "Gains available to offset (CAD)",
      "Estimated tax saving (CAD)",
      "Blocked by a purchase in the last 30 days",
      "Earliest safe sale date",
      "Do not rebuy in any account before",
    ],
    ...view.harvest.map((h) => [
      h.name ? `${h.symbol} - ${h.name}` : h.symbol,
      qty(h.quantity),
      money(h.acbCad),
      money(h.marketValueCad),
      money(h.unrealizedLossCad),
      money(h.gainsAvailableToOffsetCad),
      h.estimatedTaxSavingsCad === null ? "not estimated (no marginal rate set)" : money(h.estimatedTaxSavingsCad),
      h.blockedByRecentPurchase,
      h.earliestSafeSaleDate,
      h.noRebuyBefore,
    ]),
  ];
}

/** The amounts to enter, by form and line, exactly as the Tax Center lists them. */
function returnSection(view: TaxYearView): Cell[][] {
  const r = view.returnView;
  return [
    ["For your return"],
    ...(r.verified ? [] : [[`Line numbers are from the ${r.formYear} forms; check them once CRA publishes the ${view.year} forms.`]]),
    ...r.contributionForms
      .filter((f) => !f.verified)
      .map((f) => [`${f.form} line numbers are from the ${f.formYear} form; check them once CRA publishes the ${view.year} form.`]),
    ["Form", "Line", "What it is", "Amount (CAD)", "Note"],
    ...r.lines.map((l) => [l.form, l.line ?? "", l.label, l.amountCad, l.note ?? ""]),
    ...(r.netCapitalLossCad ? [["", "", "Net capital loss to carry back or forward (not on line 12700)", r.netCapitalLossCad, ""]] : []),
    ...(r.tfsa?.roomRemainingCad
      ? [
          [
            "TFSA",
            "",
            "TFSA room left (no form to file)",
            money(r.tfsa.roomRemainingCad),
            new D(r.tfsa.penaltyCad).isZero()
              ? r.tfsa.roomSource === "cra"
                ? "From the room you entered."
                : "Estimated by TaxBack."
              : `Over the limit: estimated tax of ${money(r.tfsa.penaltyCad)} at 1% a month (Form RC243).`,
          ],
        ]
      : []),
    ...(r.checks.length > 0 ? [[], ["Check first"], ...r.checks.map((c) => [c.text])] : []),
  ];
}

/** `generatedOn` is passed in so the caller owns the clock and tests stay fixed. */
export function taxYearCsv(view: TaxYearView, generatedOn: string): string {
  return toCsv([
    ["TaxBack", `Tax year ${view.year}`],
    ["Generated", generatedOn],
    ["Note", "Concept demo, not tax advice. Check every number against your own records before filing."],
    [
      "Rounding",
      "Every total is calculated at full precision and rounded once, so adding up a printed column can land a cent or two away from it. The Summary holds the figures to file.",
    ],
    [],
    ...returnSection(view),
    [],
    ...summarySection(view),
    [],
    ...gainsSection(view),
    [],
    ...superficialSection(view),
    [],
    ...dividendsSection(view),
    ...harvestSection(view),
  ]);
}

export const taxYearCsvFilename = (year: number) => `taxback-${year}.csv`;
