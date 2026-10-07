/**
 * Feeds the tax engine a realistic portfolio and prints everything it produces.
 *
 *   npx tsx scripts/try-engine.ts
 *
 * The engine is a pure function, so this needs no database, no auth, and no SnapTrade
 * connection. It is a bench test for eyeballing the numbers: every figure below is
 * hand-checkable from the ledger it is built from.
 */
import {
  computeTax,
  D,
  type AccountType,
  type DividendClass,
  type EntryKind,
  type FxLookup,
  type LedgerEntry,
  type MarketPrice,
} from "../src/tax-engine";

let seq = 0;

interface TxInit {
  kind: EntryKind;
  date: string;
  account: string;
  symbol: string;
  type?: AccountType;
  currency?: string;
  qty?: string;
  price?: string;
  fees?: string;
  amount?: string;
  ratio?: string;
  cls?: DividendClass;
  withholding?: string;
}

function tx(t: TxInit): LedgerEntry {
  seq += 1;
  return {
    id: `e${String(seq).padStart(2, "0")}`,
    accountId: t.account,
    accountType: t.type ?? "non_registered",
    securityId: t.symbol,
    symbol: t.symbol,
    currency: t.currency ?? "CAD",
    kind: t.kind,
    tradeDate: t.date,
    settlementDate: t.date,
    quantity: new D(t.qty ?? 0),
    price: new D(t.price ?? 0),
    fees: new D(t.fees ?? 0),
    amount: new D(t.amount ?? 0),
    splitRatio: t.ratio === undefined ? undefined : new D(t.ratio),
    dividendClass: t.cls,
    withholdingTax: t.withholding === undefined ? undefined : new D(t.withholding),
  };
}

/** Stand-in for the Bank of Canada Valet rates, close enough to real USD/CAD to be plausible. */
const USD_CAD: Record<string, string> = { "2024": "1.36", "2025": "1.43", "2026": "1.40" };
const fx: FxLookup = (currency, date) =>
  currency === "CAD" ? new D(1) : new D(USD_CAD[date.slice(0, 4)] ?? "1.40");

const ASOF = "2026-10-05";

const ledger: LedgerEntry[] = [
  // ENB: the flagship case. The same stock at two brokerages, so neither broker sees the
  // whole picture and only the pooled ACB is right. 200 @ 48 and 100 @ 52 pool to 300.
  tx({ kind: "buy", date: "2024-02-15", account: "questrade", symbol: "ENB", qty: "200", price: "48.00", fees: "9.99" }),
  tx({ kind: "buy", date: "2024-03-20", account: "wealthsimple", symbol: "ENB", qty: "100", price: "52.00", fees: "9.99" }),
  // Eligible Canadian dividends, grossed up 38% with the federal credit.
  tx({ kind: "dividend", date: "2024-06-14", account: "questrade", symbol: "ENB", amount: "183.00", cls: "eligible" }),
  tx({ kind: "dividend", date: "2024-06-14", account: "wealthsimple", symbol: "ENB", amount: "91.50", cls: "eligible" }),
  // Same security in an RRSP: excluded from the pool and from income, but it still
  // counts for superficial loss checks.
  tx({ kind: "buy", date: "2024-07-02", account: "rbc-rrsp", symbol: "ENB", type: "rrsp", qty: "50", price: "50.00" }),
  tx({ kind: "dividend", date: "2024-09-13", account: "rbc-rrsp", symbol: "ENB", type: "rrsp", amount: "45.75", cls: "eligible" }),
  // Partial sell against the pooled ACB, not against the Questrade lot alone.
  tx({ kind: "sell", date: "2025-05-09", account: "questrade", symbol: "ENB", qty: "100", price: "58.00", fees: "9.99" }),

  // AAPL: a USD holding. Cost, proceeds and dividends each convert at their own trade-date rate.
  tx({ kind: "buy", date: "2024-04-10", account: "questrade", symbol: "AAPL", currency: "USD", qty: "50", price: "170.00", fees: "4.95" }),
  tx({ kind: "dividend", date: "2025-02-20", account: "questrade", symbol: "AAPL", currency: "USD", amount: "12.50", cls: "foreign", withholding: "1.88" }),
  tx({ kind: "sell", date: "2026-03-16", account: "questrade", symbol: "AAPL", currency: "USD", qty: "50", price: "210.00", fees: "4.95" }),

  // VFV: a 2-for-1 split that both brokerages report, a day apart. One corporate action,
  // so the ratio must be applied once to the 50-share pool, not once per report.
  tx({ kind: "buy", date: "2024-01-10", account: "questrade", symbol: "VFV", qty: "30", price: "110.00", fees: "9.99" }),
  tx({ kind: "buy", date: "2024-01-12", account: "wealthsimple", symbol: "VFV", qty: "20", price: "112.00", fees: "9.99" }),
  tx({ kind: "split", date: "2025-06-01", account: "questrade", symbol: "VFV", ratio: "2" }),
  tx({ kind: "split", date: "2025-06-02", account: "wealthsimple", symbol: "VFV", ratio: "2" }),

  // ZAG: return of capital, which lowers ACB without being income.
  tx({ kind: "buy", date: "2024-05-01", account: "questrade", symbol: "ZAG", qty: "100", price: "14.00", fees: "4.99" }),
  tx({ kind: "roc", date: "2025-12-31", account: "questrade", symbol: "ZAG", amount: "45.00" }),

  // SHOP: a superficial loss with the worst ending. The replacement lands in a TFSA,
  // so the denied loss cannot be added to any ACB and is gone for good.
  tx({ kind: "buy", date: "2025-09-02", account: "questrade", symbol: "SHOP", qty: "100", price: "95.00", fees: "9.99" }),
  tx({ kind: "sell", date: "2026-01-15", account: "questrade", symbol: "SHOP", qty: "100", price: "70.00", fees: "9.99" }),
  tx({ kind: "buy", date: "2026-01-20", account: "questrade-tfsa", symbol: "SHOP", type: "tfsa", qty: "100", price: "69.00" }),

  // CNR: sold at a loss 10 days ago and bought back 5 days later. The 30-day window is
  // still open, so this denial is provisional, not settled.
  tx({ kind: "buy", date: "2026-06-01", account: "questrade", symbol: "CNR", qty: "100", price: "160.00", fees: "9.99" }),
  tx({ kind: "sell", date: "2026-09-25", account: "questrade", symbol: "CNR", qty: "100", price: "140.00", fees: "9.99" }),
  tx({ kind: "buy", date: "2026-09-30", account: "questrade", symbol: "CNR", qty: "100", price: "138.00", fees: "9.99" }),

  // TD: underwater and untouched for months, so it is a clean harvesting candidate.
  tx({ kind: "buy", date: "2026-05-01", account: "wealthsimple", symbol: "TD", qty: "100", price: "90.00", fees: "9.99" }),
];

const prices: Record<string, MarketPrice> = {
  ENB: { price: new D("56.00"), currency: "CAD" },
  AAPL: { price: new D("215.00"), currency: "USD" },
  VFV: { price: new D("62.00"), currency: "CAD" },
  ZAG: { price: new D("13.50"), currency: "CAD" },
  CNR: { price: new D("142.00"), currency: "CAD" },
  TD: { price: new D("78.00"), currency: "CAD" },
};

const result = computeTax({
  ledger,
  fx,
  asOfDate: ASOF,
  prices,
  marginalRate: new D("0.43"),
});

// ---------------------------------------------------------------- presentation

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const money = (v: { toNumber(): number } | null | undefined): string =>
  v === null || v === undefined ? "-" : cad.format(v.toNumber());
const num = (v: { toString(): string }): string => v.toString();

function table(rows: string[][]): void {
  const header = rows[0];
  if (!header) return;
  const widths = header.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  rows.forEach((row, index) => {
    const line = row
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join("  ");
    console.log(`  ${line}`);
    if (index === 0) console.log(`  ${widths.map((w) => "-".repeat(w)).join("  ")}`);
  });
}

function heading(text: string): void {
  console.log(`\n${text}\n${"=".repeat(text.length)}`);
}

console.log(`TaxBack engine bench - ${ledger.length} entries, as of ${ASOF}`);

heading("Pooled positions (across every non-registered account)");
table([
  ["SECURITY", "QTY", "TOTAL ACB", "ACB/SHARE"],
  ...result.positions.map((p) => [p.symbol, num(p.quantity), money(p.totalAcbCad), money(p.acbPerShareCad)]),
]);

heading("Realized gains and losses");
table([
  ["SECURITY", "DATE", "YEAR", "QTY", "PROCEEDS", "ACB", "FEES", "GAIN", "ALLOWED"],
  ...result.gains.map((g) => [
    `${g.symbol}${g.kind === "roc_excess" ? " (ROC)" : ""}`,
    g.date,
    String(g.year),
    num(g.quantity),
    money(g.proceedsCad),
    money(g.acbCad),
    money(g.feesCad),
    money(g.gainCad),
    money(g.allowedGainCad),
  ]),
]);

heading("Superficial losses");
for (const s of result.superficialLosses) {
  console.log(`  ${s.symbol} sold ${s.saleDate}  [${s.status.toUpperCase()}]  window ${s.windowStart} -> ${s.windowEnd}`);
  console.log(
    `    loss ${money(s.totalLossCad)}  denied ${money(s.deniedLossCad)}  allowed ${money(s.allowedLossCad)}  lost forever ${money(s.lostForeverCad)}`,
  );
  for (const r of s.replacements) {
    console.log(`    replacement ${num(r.quantity)} in ${r.accountId} (${r.accountType}) -> ${r.disposition}`);
  }
}

heading("Income");
table([
  ["SECURITY", "DATE", "CLASS", "AMOUNT", "GROSSED UP", "FED CREDIT", "WITHHELD"],
  ...result.income.map((i) => [
    i.symbol,
    i.date,
    i.dividendClass,
    money(i.amountCad),
    money(i.grossedUpCad),
    money(i.federalCreditCad),
    money(i.withholdingCad),
  ]),
]);

heading("Year summaries");
table([
  ["YEAR", "NET GAIN", "DENIED", "TAXABLE", "ELIGIBLE DIV", "FOREIGN", "EST. TAX"],
  ...result.years.map((y) => [
    String(y.year),
    money(y.netCapitalGainCad),
    money(y.deniedLossesCad),
    money(y.taxableCapitalGainCad),
    money(y.eligibleDividendsCad),
    money(y.foreignIncomeCad),
    money(y.estimatedTaxCad),
  ]),
]);

heading("Harvesting opportunities");
table([
  ["SECURITY", "QTY", "ACB", "MARKET", "LOSS", "OFFSETS", "EST. SAVING", "BLOCKED", "SAFE TO SELL", "NO REBUY BEFORE"],
  ...result.harvest.map((h) => [
    h.symbol,
    num(h.quantity),
    money(h.acbCad),
    money(h.marketValueCad),
    money(h.unrealizedLossCad),
    money(h.gainsAvailableToOffsetCad),
    money(h.estimatedTaxSavingsCad),
    h.blockedByRecentPurchase ? "yes" : "no",
    h.earliestSafeSaleDate,
    h.noRebuyBefore,
  ]),
]);

heading("Warnings");
if (result.warnings.length === 0) console.log("  none");
for (const w of result.warnings) {
  const detail = Object.entries(w)
    .filter(([k]) => k !== "type")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  console.log(`  ${w.type}  ${detail}`);
}
console.log();
