import { D, type Dec } from "@/tax-engine";
import type { AccountType, DividendClass } from "@/tax-engine";
import type { SECURITY_TYPES, TRANSACTION_KINDS } from "@/server/db/schema";
import {
  type SnapTradeAccount,
  type SnapTradeActivity,
  type SnapTradeBalance,
  type SnapTradePosition,
  type SnapTradeSymbol,
  activitySchema,
} from "./schemas";

/*
 * Pure mapping from SnapTrade responses to TaxBack rows. No I/O, so it is unit tested directly.
 * This is the only place SnapTrade numbers become decimals, always through their text form, so a
 * JSON number like 0.1 never picks up binary float error.
 */

type SecurityType = (typeof SECURITY_TYPES)[number];
type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const dec = (value: number | string | null | undefined): Dec => new D(value === null || value === undefined ? 0 : String(value));

// ===== Dates =====

const TORONTO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar date of a SnapTrade timestamp in Toronto, where Canadian markets settle.
 * Timestamps are UTC, so an evening trade would otherwise land on the next day (or the next tax year).
 */
export function torontoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`Unreadable SnapTrade date ${value}`);
  return TORONTO.format(instant);
}

// ===== Accounts =====

/**
 * Credit cards (`LOC`) are debt, not holdings, so they are never synced. Everything else is: investment
 * accounts, and cash accounts (`DEPOSIT`: chequing, Wealthsimple Cash) whose money counts toward value.
 */
export function isSyncedAccount(account: SnapTradeAccount): boolean {
  return account.account_category !== "LOC";
}

export type AccountKind = "investment" | "cash";

/** Cash accounts hold no securities, so they never produce capital gains and need no type confirmation. */
export function accountKind(account: SnapTradeAccount): AccountKind {
  return account.account_category === "DEPOSIT" ? "cash" : "investment";
}

const REGISTERED_PATTERNS: [RegExp, AccountType][] = [
  // U.S. retirement accounts at U.S. brokers. Checked first, because "Roth IRA" must not read as anything else.
  [/\b(roth\s+)?ira\b|\b401\s*\(?k\)?|\b403\s*\(?b\)?|\b457\s*\(?b\)?/i, "us_retirement"],
  [/\btfsa\b/i, "tfsa"],
  [/\bfhsa\b/i, "fhsa"],
  [/\bresp\b/i, "resp"],
  [/\b(rrif|lrif|prif)\b/i, "rrif"],
  [/\b(lira|lrsp|lif|rlif)\b/i, "lira"],
  [/\b(rrsp|rsp)\b/i, "rrsp"],
];

/**
 * TaxBack's guess at the account type from what the broker reported. It is only a guess: the user
 * confirms each account, because a wrong type puts a TFSA's sales into taxable gains or the reverse.
 */
export function guessAccountType(account: SnapTradeAccount): AccountType {
  const text = `${account.meta?.type ?? ""} ${account.raw_type ?? ""} ${account.name ?? ""}`.replace(/_/g, " ");
  for (const [pattern, type] of REGISTERED_PATTERNS) if (pattern.test(text)) return type;
  return "non_registered";
}

const isCurrency = (value: string | null | undefined): value is string => !!value && /^[A-Z]{3}$/.test(value);

export interface MappedAccount {
  snaptradeAccountId: string;
  snaptradeAuthorizationId: string;
  name: string;
  numberMasked: string | null;
  baseCurrency: string;
  brokerRawType: string | null;
  kind: AccountKind;
  accountTypeGuess: AccountType;
  /** The broker's total for the account (holdings and cash), in `reportedTotalCurrency`. */
  reportedTotal: Dec | null;
  reportedTotalCurrency: string | null;
}

/** Acronyms that stay upper case in account names. */
const ACRONYMS = new Set(["TFSA", "RRSP", "FHSA", "RESP", "RRIF", "LIRA", "LIF", "RDSP", "USD", "CAD", "HISA"]);

const casing = (text: string) =>
  text
    .split(/(\s+|_)/)
    .map((word) => (word === "_" ? " " : /^[A-Z]{2,}$/.test(word) && !ACRONYMS.has(word) ? word[0] + word.slice(1).toLowerCase() : word))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A clearer name from SnapTrade's detailed type when the broker's own name is only the generic type:
 * Wealthsimple calls both a savings account and a self-directed account "PERSONAL".
 */
function nameFromUnifiedType(unified: string | null | undefined): string | null {
  if (!unified) return null;
  const variant = (prefix: string, base: string) => {
    const rest = unified.slice(prefix.length);
    return rest === "NON_REGISTERED" ? base : `${casing(rest)} ${base.toLowerCase()}`;
  };
  if (unified === "CASH") return "Cash";
  if (unified === "BUSINESS_CHEQUING") return "Business chequing";
  if (unified.startsWith("HISA_PORTFOLIO_")) return variant("HISA_PORTFOLIO_", "Savings");
  if (unified.startsWith("MANAGED_PORTFOLIO_")) return variant("MANAGED_PORTFOLIO_", "Managed");
  return null;
}

/**
 * SnapTrade names accounts "<institution> <TYPE>", e.g. "Wealthsimple Trade PERSONAL". The Hub already
 * groups by brokerage, so the prefix is dropped and shouted words are cased: "Personal", "TFSA".
 * When that leaves only the generic type, SnapTrade's detailed type gives a better one: "Savings", "Cash".
 */
export function friendlyAccountName(
  name: string | null | undefined,
  institution: string,
  rawType?: string | null,
  unifiedType?: string | null,
): string {
  let text = (name ?? "").trim();
  if (text.toLowerCase().startsWith(institution.toLowerCase())) text = text.slice(institution.length).trim();
  const generic = !text || (rawType != null && text.toLowerCase() === rawType.trim().toLowerCase());
  if (generic) text = nameFromUnifiedType(unifiedType) ?? (text || rawType?.trim() || "Account");
  return casing(text);
}

export function mapAccount(account: SnapTradeAccount): MappedAccount {
  const digits = (account.number ?? "").replace(/\W/g, "");
  const currency = [account.meta?.currency, account.balance?.total?.currency].find(isCurrency) ?? "CAD";
  const total = account.balance?.total;
  const reported = total && isCurrency(total.currency) && total.amount !== null && total.amount !== undefined;
  return {
    snaptradeAccountId: account.id,
    snaptradeAuthorizationId: account.brokerage_authorization,
    name: friendlyAccountName(account.name, account.institution_name, account.raw_type, account.meta?.unifiedAccountType),
    // Last 4 only: the full number is never stored.
    numberMasked: digits.length > 0 ? digits.slice(-4) : null,
    baseCurrency: currency,
    brokerRawType: account.raw_type ?? account.meta?.type ?? null,
    kind: accountKind(account),
    accountTypeGuess: guessAccountType(account),
    reportedTotal: reported ? dec(total.amount) : null,
    reportedTotalCurrency: reported ? total.currency! : null,
  };
}

/** Below this, a broker total and the cash it lists are the same amount, give or take rounding. */
const UNREPORTED_TOLERANCE = new D("0.01");

/**
 * True when SnapTrade lists no positions for an account whose broker total is more than its cash:
 * the account holds securities SnapTrade does not itemize (Wealthsimple managed portfolios do this).
 * Such an account is valued at the broker total, since its holdings cannot be priced one by one.
 * Cash in another currency than the total cannot be compared, so the answer is then no.
 */
export function holdingsUnreported(
  account: Pick<MappedAccount, "reportedTotal" | "reportedTotalCurrency">,
  positionCount: number,
  balances: readonly MappedBalance[],
): boolean {
  const { reportedTotal, reportedTotalCurrency } = account;
  if (positionCount > 0 || reportedTotal === null || reportedTotalCurrency === null) return false;
  let cash = new D(0);
  for (const b of balances) {
    if (b.currency === reportedTotalCurrency) cash = cash.plus(b.cash);
    else if (!b.cash.isZero()) return false;
  }
  return reportedTotal.minus(cash).gt(UNREPORTED_TOLERANCE);
}

// ===== Securities =====

/** Canadian exchanges, by MIC and by SnapTrade's own code. */
const CANADIAN_EXCHANGES = new Set(["XTSE", "XTSX", "XCNQ", "NEOE", "XNEO", "XATS", "TSX", "TSXV", "CSE", "NEO", "CBOE CA"]);
const US_EXCHANGES = new Set(["XNYS", "XNAS", "ARCX", "BATS", "XASE", "IEXG", "NYSE", "NASDAQ", "ARCA", "AMEX", "OTC"]);

export interface MappedSecurity {
  snaptradeSymbolId: string;
  symbol: string;
  exchange: string | null;
  name: string | null;
  currency: string;
  securityType: SecurityType;
  /** Issuer country from the listing; drives the default dividend class. */
  country: string | null;
  /** Same for every listing of the same shares; null when SnapTrade has no FIGI for it. */
  figiShareClass: string | null;
}

function countryOf(exchange: string | null | undefined): string | null {
  if (!exchange) return null;
  const key = exchange.toUpperCase();
  if (CANADIAN_EXCHANGES.has(key)) return "CA";
  if (US_EXCHANGES.has(key)) return "US";
  return null;
}

/** SnapTrade symbol type codes (activities) and instrument kinds (positions) to TaxBack security types. */
function securityTypeOf(code: string | null | undefined): SecurityType {
  switch (code?.toLowerCase()) {
    case "cs":
    case "ad":
    case "adr":
    case "ps":
    case "stock":
    case "closed_end_fund":
      return "equity";
    case "et":
    case "etf":
      return "etf";
    case "oef":
    case "mf":
    case "mutualfund":
    case "mutual_fund":
      return "mutual_fund";
    case "bnd":
    case "bond":
      return "bond";
    case "crypto":
    case "crypto_currency":
      return "crypto";
    default:
      return "other";
  }
}

export function securityFromSymbol(symbol: SnapTradeSymbol): MappedSecurity {
  const exchange = symbol.exchange?.mic_code || symbol.exchange?.code || null;
  return {
    snaptradeSymbolId: symbol.id,
    symbol: symbol.raw_symbol || symbol.symbol,
    exchange,
    name: symbol.description ?? null,
    currency: symbol.currency.code,
    securityType: securityTypeOf(symbol.type?.code),
    country: countryOf(exchange),
    figiShareClass: symbol.figi_instrument?.figi_share_class || null,
  };
}

/** The default class: eligible for a Canadian listing, foreign otherwise. The user can't override it yet. */
export function dividendClassFor(security: Pick<MappedSecurity, "country">): DividendClass {
  return security.country === "CA" ? "eligible" : "foreign";
}

// ===== Holdings and balances =====

/** Options, futures, and CFDs are not tracked: TaxBack's ACB engine covers shares, units, and crypto. */
const HOLDING_KINDS = new Set(["stock", "adr", "etf", "mutualfund", "closed_end_fund", "crypto"]);

export interface MappedHolding {
  snaptradeSymbolId: string;
  quantity: Dec;
  price: Dec | null;
  currency: string;
  marketValue: Dec | null;
  /** The broker's book value (units x its average cost), for comparison only. */
  brokerBookValue: Dec | null;
}

export function mapPositions(positions: readonly SnapTradePosition[]): {
  holdings: MappedHolding[];
  securities: MappedSecurity[];
  skipped: Record<string, number>;
} {
  const holdings: MappedHolding[] = [];
  const securities: MappedSecurity[] = [];
  const skipped: Record<string, number> = {};

  for (const p of positions) {
    const { instrument } = p;
    const currency = [instrument.currency, p.currency].find(isCurrency);
    const symbol = instrument.raw_symbol || instrument.symbol;
    if (!HOLDING_KINDS.has(instrument.kind) || !instrument.id || !currency || !symbol) {
      skipped[`position:${instrument.kind}`] = (skipped[`position:${instrument.kind}`] ?? 0) + 1;
      continue;
    }
    const exchange = instrument.exchange || null;
    securities.push({
      snaptradeSymbolId: instrument.id,
      symbol,
      exchange,
      name: instrument.description ?? null,
      currency,
      securityType: securityTypeOf(instrument.kind),
      country: countryOf(exchange),
      figiShareClass: instrument.figi_instrument?.figi_share_class || null,
    });

    const quantity = dec(p.units);
    const price = p.price === null || p.price === undefined ? null : dec(p.price);
    const costBasis = p.cost_basis === null || p.cost_basis === undefined ? null : dec(p.cost_basis);
    holdings.push({
      snaptradeSymbolId: instrument.id,
      quantity,
      price,
      currency,
      marketValue: price ? quantity.times(price) : null,
      brokerBookValue: costBasis ? quantity.times(costBasis) : null,
    });
  }
  return { holdings, securities, skipped };
}

export interface MappedBalance {
  currency: string;
  cash: Dec;
}

export function mapBalances(balances: readonly SnapTradeBalance[]): MappedBalance[] {
  const byCurrency = new Map<string, Dec>();
  for (const b of balances) {
    const code = b.currency?.code;
    if (!isCurrency(code) || b.cash === null || b.cash === undefined) continue;
    byCurrency.set(code, (byCurrency.get(code) ?? new D(0)).plus(dec(b.cash)));
  }
  return [...byCurrency].map(([currency, cash]) => ({ currency, cash }));
}

// ===== Activities =====

export interface MappedTransaction {
  snaptradeActivityId: string;
  /** Null only for a cash-level fee. */
  snaptradeSymbolId: string | null;
  kind: TransactionKind;
  tradeDate: string;
  settlementDate: string;
  currency: string;
  quantity: Dec;
  price: Dec;
  fees: Dec;
  amount: Dec;
  splitRatio: Dec | null;
  dividendClass: DividendClass | null;
  withholdingTax: Dec | null;
  description: string | null;
  /** The original activity, kept so a mapping fix can be replayed without a re-sync. */
  raw: Record<string, unknown>;
}

/** Cash moved into or out of the account: what registered plan contributions and withdrawals are read from. */
export interface MappedCashFlow {
  snaptradeActivityId: string;
  /** The SnapTrade type, kept so the engine can tell a deposit from a transfer between the user's own accounts. */
  brokerType: string;
  /** The trade date: the day the money moved, which decides the RRSP contribution period. */
  date: string;
  direction: "in" | "out";
  /** Positive. */
  amount: Dec;
  currency: string;
  description: string | null;
  raw: Record<string, unknown>;
}

export interface MappedActivities {
  transactions: MappedTransaction[];
  cashFlows: MappedCashFlow[];
  securities: MappedSecurity[];
  /** Activities with no tax meaning or no ledger kind (interest, options), counted by type. */
  skipped: Record<string, number>;
  /** Earliest activity date SnapTrade returned, or null when there were none. */
  earliestDate: string | null;
}

/** Activities stored as ledger transactions. Everything else is counted and skipped. */
const LEDGER_TYPES = new Set([
  "BUY",
  "SELL",
  "REI",
  "DIVIDEND",
  "SUBSTITUTE_DIVIDEND",
  "SPLIT",
  "REVERSE_SPLIT",
  "STOCK_DIVIDEND",
  "FEE",
  "TAX",
  "RETURN_OF_CAPITAL",
  "TRANSFER",
  "EXTERNAL_ASSET_TRANSFER_IN",
  "EXTERNAL_ASSET_TRANSFER_OUT",
  // Shares moved between the user's own accounts at one broker: into a registered account that is a
  // deemed disposition, so it cannot be skipped.
  "INTERNAL_ASSET_TRANSFER_IN",
  "INTERNAL_ASSET_TRANSFER_OUT",
]);

/**
 * Cash in and out, stored as contribution flows rather than ledger transactions. A plain `TRANSFER` with
 * no security is cash too, and is read there. `DEPOSIT` is not a documented activity type but costs
 * nothing to accept.
 */
const CASH_FLOW_TYPES = new Set(["CONTRIBUTION", "DEPOSIT", "WITHDRAWAL", "INTERNAL_CASH_TRANSFER_IN", "INTERNAL_CASH_TRANSFER_OUT"]);
const isStored = (type: string) => LEDGER_TYPES.has(type) || CASH_FLOW_TYPES.has(type);

interface Parsed {
  activity: SnapTradeActivity;
  raw: Record<string, unknown>;
  tradeDate: string;
  settlementDate: string;
}

function parse(raw: Record<string, unknown>): Parsed {
  const result = activitySchema.safeParse(raw);
  // A stored type with an unexpected shape fails the sync: silently dropping a trade would make the tax
  // numbers wrong. The failing fields are named, because the next shape surprise is someone else's to read.
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`SnapTrade activity ${String(raw.id)} (${String(raw.type)}) has an unexpected shape - ${detail}`);
  }
  const activity = result.data;
  /*
   * SnapTrade only sets `settlement_date` on trades; a dividend, fee, split, or transfer leaves it null,
   * so the trade date stands in. For those events the two are the same day anyway. A BUY or SELL always
   * carries its own settlement date, which is the one that decides the tax year, so this fallback never
   * moves a disposition between years in practice.
   */
  const reported = activity.settlement_date ?? activity.trade_date;
  if (!reported) {
    throw new Error(`SnapTrade activity ${activity.id} (${activity.type}) has neither a settlement date nor a trade date`);
  }
  const settlementDate = torontoDate(reported);
  const tradeDate = activity.trade_date ? torontoDate(activity.trade_date) : settlementDate;
  // Some brokers report a trade date after settlement for corrections; the ledger needs trade <= settlement.
  return { activity, raw, tradeDate: tradeDate <= settlementDate ? tradeDate : settlementDate, settlementDate };
}

/**
 * Price per unit in the activity's cash currency. When the trade settled in another currency than the
 * listing (a USD stock bought with CAD), SnapTrade's `price` is in the listing currency, so the price is
 * derived from the cash `amount` instead: that is what was actually paid or received.
 */
function tradePrice(a: SnapTradeActivity, units: Dec, fees: Dec, direction: "in" | "out"): Dec {
  const cash = a.currency?.code;
  if (!a.symbol || !cash || cash === a.symbol.currency.code || a.amount === null || a.amount === undefined) {
    return dec(a.price).abs();
  }
  const gross = dec(a.amount).abs();
  const net = direction === "in" ? gross.minus(fees) : gross.plus(fees);
  return net.isNegative() ? new D(0) : net.dividedBy(units);
}

/**
 * Maps one account's activities. Order does not matter on input; splits need the account's running
 * quantity, so activities are replayed in date order.
 */
export function mapActivities(activities: readonly Record<string, unknown>[]): MappedActivities {
  const skipped: Record<string, number> = {};
  const skip = (type: string) => (skipped[type] = (skipped[type] ?? 0) + 1);
  const securities = new Map<string, MappedSecurity>();
  const transactions: MappedTransaction[] = [];
  const cashFlows: MappedCashFlow[] = [];
  let earliestDate: string | null = null;

  const parsed: Parsed[] = [];
  for (const raw of activities) {
    const type = String(raw.type);
    if (!isStored(type)) {
      skip(type);
      continue;
    }
    parsed.push(parse(raw));
  }
  for (const p of parsed) if (earliestDate === null || p.settlementDate < earliestDate) earliestDate = p.settlementDate;
  // Skipped types still bound how far back the history reaches, and they are the ones with no settlement date.
  for (const raw of activities) {
    if (isStored(String(raw.type))) continue;
    const reported = [raw.settlement_date, raw.trade_date].find((d) => typeof d === "string");
    if (reported === undefined) continue;
    const date = torontoDate(reported);
    if (earliestDate === null || date < earliestDate) earliestDate = date;
  }

  parsed.sort(
    (x, y) =>
      (x.settlementDate < y.settlementDate ? -1 : x.settlementDate > y.settlementDate ? 1 : 0) ||
      (x.activity.id < y.activity.id ? -1 : 1),
  );

  /*
   * Withholding tax arrives as its own TAX activity. Brokers post it a day or two off the dividend it
   * belongs to rather than on the same date, so it attaches to the nearest dividend on the same security
   * within a window. The window stays well short of a monthly payer's 30-day spacing, so the nearest
   * dividend is never ambiguous.
   */
  const WITHHOLDING_WINDOW_DAYS = 7;
  const withholding = new Map<string, Dec>();
  const taxKey = (symbolId: string, date: string) => `${symbolId}|${date}`;
  const dividendDates = new Map<string, string[]>();
  for (const { activity: a, settlementDate } of parsed) {
    if ((a.type === "DIVIDEND" || a.type === "SUBSTITUTE_DIVIDEND") && a.symbol) {
      dividendDates.set(a.symbol.id, [...(dividendDates.get(a.symbol.id) ?? []), settlementDate]);
    }
  }
  const daysApart = (a: string, b: string) =>
    Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) /
    86_400_000;

  /** The dividend a withholding row belongs to: the nearest one on that security, earliest breaking a tie. */
  const dividendDateFor = (symbolId: string, date: string): string | null => {
    let best: string | null = null;
    let bestGap = Infinity;
    for (const candidate of [...(dividendDates.get(symbolId) ?? [])].sort()) {
      const gap = daysApart(candidate, date);
      if (gap <= WITHHOLDING_WINDOW_DAYS && gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
    return best;
  };

  const held = new Map<string, Dec>();
  const hold = (id: string, delta: Dec) => held.set(id, (held.get(id) ?? new D(0)).plus(delta));

  const base = (p: Parsed, security: MappedSecurity | null) => ({
    snaptradeActivityId: p.activity.id,
    snaptradeSymbolId: security?.snaptradeSymbolId ?? null,
    tradeDate: p.tradeDate,
    settlementDate: p.settlementDate,
    currency: [p.activity.currency?.code, security?.currency].find(isCurrency) ?? "CAD",
    quantity: new D(0),
    price: new D(0),
    fees: dec(p.activity.fee).abs(),
    amount: new D(0),
    splitRatio: null,
    dividendClass: null,
    withholdingTax: null,
    description: p.activity.description ?? null,
    raw: p.raw,
  });

  /** Direction from the sign: SnapTrade gives money into the account a positive amount. */
  const cashFlow = (p: Parsed) => {
    const amount = dec(p.activity.amount);
    if (amount.isZero()) {
      skip(p.activity.type);
      return;
    }
    cashFlows.push({
      snaptradeActivityId: p.activity.id,
      brokerType: p.activity.type,
      date: p.tradeDate,
      direction: amount.isNegative() ? "out" : "in",
      amount: amount.abs(),
      currency: [p.activity.currency?.code].find(isCurrency) ?? "CAD",
      description: p.activity.description ?? null,
      raw: p.raw,
    });
  };

  for (const p of parsed) {
    const a = p.activity;
    if (CASH_FLOW_TYPES.has(a.type) || (a.type === "TRANSFER" && !a.symbol && !a.option_symbol)) {
      cashFlow(p);
      continue;
    }
    if (a.option_symbol) {
      skip(`OPTION_${a.type}`);
      continue;
    }
    const security = a.symbol ? securityFromSymbol(a.symbol) : null;
    if (security) securities.set(security.snaptradeSymbolId, security);
    const units = dec(a.units).abs();

    switch (a.type) {
      case "BUY":
      case "REI":
      case "SELL": {
        if (!security || units.isZero()) {
          skip(a.type);
          break;
        }
        const row = base(p, security);
        const sell = a.type === "SELL";
        transactions.push({
          ...row,
          kind: a.type === "BUY" ? "buy" : a.type === "REI" ? "drip" : "sell",
          quantity: units,
          price: tradePrice(a, units, row.fees, sell ? "out" : "in"),
        });
        hold(security.snaptradeSymbolId, sell ? units.negated() : units);
        break;
      }
      case "DIVIDEND":
      case "SUBSTITUTE_DIVIDEND": {
        const amount = dec(a.amount);
        // A negative dividend is a reversal; the engine has no kind for it.
        if (!security || !amount.gt(0)) {
          skip(amount.isNegative() ? `${a.type}_REVERSAL` : a.type);
          break;
        }
        transactions.push({
          ...base(p, security),
          kind: "dividend",
          amount,
          price: dec(a.price).abs(),
          dividendClass: dividendClassFor(security),
        });
        break;
      }
      case "RETURN_OF_CAPITAL": {
        // Cash paid out of capital rather than earnings: not income, it lowers the ACB of the shares held.
        const amount = dec(a.amount);
        if (!security || !amount.gt(0)) {
          skip(amount.isNegative() ? "RETURN_OF_CAPITAL_REVERSAL" : a.type);
          break;
        }
        transactions.push({ ...base(p, security), kind: "roc", amount });
        break;
      }
      case "TAX": {
        const paidOn = security ? dividendDateFor(security.snaptradeSymbolId, p.settlementDate) : null;
        if (!security || !paidOn) {
          skip("TAX");
          break;
        }
        const key = taxKey(security.snaptradeSymbolId, paidOn);
        withholding.set(key, (withholding.get(key) ?? new D(0)).plus(dec(a.amount).abs()));
        break;
      }
      // A reverse split is the same event with a negative unit change, so the ratio comes out below 1.
      case "SPLIT":
      case "REVERSE_SPLIT": {
        // SnapTrade reports the change in units; the engine needs new shares per old share.
        const before = security ? (held.get(security.snaptradeSymbolId) ?? new D(0)) : new D(0);
        const delta = dec(a.units);
        const after = before.plus(delta);
        if (!security || delta.isZero()) {
          skip(a.type);
          break;
        }
        /*
         * The ratio needs the quantity before the split, and that only comes from activities in this
         * sync. A security whose purchases predate the window has none, so the split cannot be applied
         * and is counted separately: it is a gap in the numbers, not an event with no tax meaning.
         * Checked before `after`, or a reverse split with nothing held would look like the case below.
         * Recomputing it later would need the ratio resolved against the stored ledger instead.
         */
        if (!before.gt(0)) {
          skip(`${a.type}_NO_POSITION`);
          break;
        }
        // A change that would leave nothing held is not a split; applying it would zero the position.
        if (!after.gt(0)) {
          skip(a.type);
          break;
        }
        transactions.push({ ...base(p, security), kind: "split", splitRatio: after.dividedBy(before) });
        held.set(security.snaptradeSymbolId, after);
        break;
      }
      case "STOCK_DIVIDEND": {
        // New shares instead of cash. The reported amount, when there is one, is the taxable dividend and
        // becomes their cost; without it the engine treats them like a split (more shares, same ACB).
        if (!security || units.isZero()) {
          skip(a.type);
          break;
        }
        transactions.push({
          ...base(p, security),
          kind: "stock_dividend",
          quantity: units,
          amount: dec(a.amount).abs(),
          dividendClass: dividendClassFor(security),
        });
        hold(security.snaptradeSymbolId, units);
        break;
      }
      case "FEE": {
        const fee = dec(a.amount).abs().plus(dec(a.fee).abs());
        if (fee.isZero()) {
          skip("FEE");
          break;
        }
        transactions.push({ ...base(p, security), kind: "fee", fees: fee });
        break;
      }
      case "TRANSFER":
      case "EXTERNAL_ASSET_TRANSFER_IN":
      case "EXTERNAL_ASSET_TRANSFER_OUT":
      case "INTERNAL_ASSET_TRANSFER_IN":
      case "INTERNAL_ASSET_TRANSFER_OUT": {
        const signed = dec(a.units);
        if (!security || signed.isZero()) {
          skip(a.type);
          break;
        }
        // The named types carry their direction; a plain TRANSFER only has the sign of its units.
        const out = a.type.endsWith("_TRANSFER_OUT") || (a.type === "TRANSFER" && signed.isNegative());
        const row = base(p, security);
        const price = dec(a.price).abs();
        transactions.push({ ...row, kind: out ? "transfer_out" : "transfer_in", quantity: units, price });
        hold(security.snaptradeSymbolId, out ? units.negated() : units);
        // Into or out of a registered plan, shares count as a contribution or withdrawal at fair market
        // value. The flow shares the activity id, which links it to this transfer; without a price there
        // is no value to count, and the ledger warns about the transfer instead.
        const value = units.times(price);
        if (value.gt(0)) {
          cashFlows.push({
            snaptradeActivityId: a.id,
            brokerType: a.type,
            date: p.tradeDate,
            direction: out ? "out" : "in",
            amount: value,
            currency: row.currency,
            description: `${units.toFixed()} ${security.symbol} in kind`,
            raw: p.raw,
          });
        }
        break;
      }
      default:
        skip(a.type);
    }
  }

  for (const t of transactions) {
    if (t.kind !== "dividend" || !t.snaptradeSymbolId) continue;
    const tax = withholding.get(taxKey(t.snaptradeSymbolId, t.settlementDate));
    if (tax) {
      t.withholdingTax = tax;
      // One dividend per day per security takes the whole withholding; a second one must not count it again.
      withholding.delete(taxKey(t.snaptradeSymbolId, t.settlementDate));
    }
  }

  return { transactions, cashFlows, securities: [...securities.values()], skipped, earliestDate };
}
