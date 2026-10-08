import "server-only";
import { asc, count, eq, inArray } from "drizzle-orm";
import { DEMO_USER_ID, ensureDemoUser } from "@/server/auth/demo-plugin";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { syncFxRates } from "@/server/fx/boc";
import { recomputeUser } from "@/server/recompute";
import { D, type Dec } from "@/tax-engine";
import { addDays, nextBusinessDay } from "@/tax-engine/dates";

/*
 * The "Try the demo" portfolio: three brokerages, non-registered, TFSA, RRSP, and a Roth IRA, in CAD
 * and USD, over three tax years. Every date is relative to today, so the open superficial loss window
 * and the harvesting suggestion are live whenever it is reset. It shows:
 *
 * - XEQT at two brokerages, pooled into one ACB, with DRIPs, return of capital, and a sale each year.
 * - RY on the TSX at Questrade and on the NYSE at Schwab: one pool, USD trades at their own date's rate,
 *   and USD dividends from a Canadian company counted as eligible.
 * - SHOP sold at a loss and rebought in the TFSA within 30 days: superficial, and lost for good (pending).
 * - XEQT moved in kind into the TFSA: a deemed sale at fair market value.
 * - AAPL in USD with 15% U.S. withholding, and a Roth IRA purchase that never counts as taxable.
 * - MSFT transferred in from a broker TaxBack cannot see, closed with an opening balance.
 * - BCE well below its ACB with no recent purchase: a tax-loss harvesting suggestion.
 * - VFV in the RRSP, where the broker holds more than the history shows: a reconciliation gap.
 * - Contributions over three years: a TFSA withdrawal put back the same year (an excess, taxed 1% a
 *   month), RRSP contributions in the first 60 days and a group RRSP entered by hand, an FHSA with a
 *   carryforward, a transfer from the RRSP, and a deferred deduction, and a transfer to review.
 *
 * Prices and amounts are illustrative, not market data. Exchange rates are real Bank of Canada rates,
 * because `fx_rates` is shared with real users and must never hold invented values.
 */

type AccountKey = "qtMargin" | "qtTfsa" | "wsPersonal" | "wsRrsp" | "wsFhsa" | "wsCash" | "swIndividual" | "swRoth";
type SecurityKey = "XEQT" | "RY" | "RY_US" | "SHOP" | "BCE" | "VFV" | "AAPL" | "MSFT";

const BROKERAGES = [
  { key: "questrade", slug: "questrade", name: "Questrade" },
  { key: "wealthsimple", slug: "wealthsimple", name: "Wealthsimple" },
  { key: "schwab", slug: "schwab", name: "Charles Schwab" },
] as const;

const ACCOUNTS: Record<
  AccountKey,
  { brokerage: (typeof BROKERAGES)[number]["key"]; name: string; type: (typeof s.ACCOUNT_TYPES)[number]; currency: string; kind?: "cash"; last4: string }
> = {
  qtMargin: { brokerage: "questrade", name: "Margin", type: "non_registered", currency: "CAD", last4: "4417" },
  qtTfsa: { brokerage: "questrade", name: "TFSA", type: "tfsa", currency: "CAD", last4: "8820" },
  wsPersonal: { brokerage: "wealthsimple", name: "Personal", type: "non_registered", currency: "CAD", last4: "1093" },
  wsRrsp: { brokerage: "wealthsimple", name: "RRSP", type: "rrsp", currency: "CAD", last4: "5571" },
  wsFhsa: { brokerage: "wealthsimple", name: "FHSA", type: "fhsa", currency: "CAD", last4: "7140" },
  wsCash: { brokerage: "wealthsimple", name: "Cash", type: "non_registered", currency: "CAD", kind: "cash", last4: "3302" },
  swIndividual: { brokerage: "schwab", name: "Individual", type: "non_registered", currency: "USD", last4: "6614" },
  swRoth: { brokerage: "schwab", name: "Roth IRA", type: "us_retirement", currency: "USD", last4: "2958" },
};

const SECURITIES: Record<
  SecurityKey,
  { symbol: string; exchange: string; currency: string; country: string; name: string; type: (typeof s.SECURITY_TYPES)[number]; price: string }
> = {
  XEQT: { symbol: "XEQT", exchange: "XTSE", currency: "CAD", country: "CA", name: "iShares Core Equity ETF Portfolio", type: "etf", price: "33.10" },
  RY: { symbol: "RY", exchange: "XTSE", currency: "CAD", country: "CA", name: "Royal Bank of Canada", type: "equity", price: "165.40" },
  RY_US: { symbol: "RY", exchange: "XNYS", currency: "USD", country: "US", name: "Royal Bank of Canada", type: "equity", price: "120.15" },
  SHOP: { symbol: "SHOP", exchange: "XTSE", currency: "CAD", country: "CA", name: "Shopify Inc.", type: "equity", price: "115.30" },
  BCE: { symbol: "BCE", exchange: "XTSE", currency: "CAD", country: "CA", name: "BCE Inc.", type: "equity", price: "34.05" },
  VFV: { symbol: "VFV", exchange: "XTSE", currency: "CAD", country: "CA", name: "Vanguard S&P 500 Index ETF", type: "etf", price: "140.25" },
  AAPL: { symbol: "AAPL", exchange: "XNAS", currency: "USD", country: "US", name: "Apple Inc.", type: "equity", price: "230.10" },
  MSFT: { symbol: "MSFT", exchange: "XNAS", currency: "USD", country: "US", name: "Microsoft Corporation", type: "equity", price: "480.40" },
};

interface SeedEntry {
  account: AccountKey;
  security: SecurityKey;
  kind: (typeof s.TRANSACTION_KINDS)[number];
  daysAgo: number;
  qty?: string;
  price?: string;
  fees?: string;
  amount?: string;
  cls?: (typeof s.DIVIDEND_CLASSES)[number];
  withholding?: string;
}

const LEDGER: SeedEntry[] = [
  // XEQT: two brokerages, one pool. DRIPs, return of capital, and a sale in each of three years.
  { account: "qtMargin", security: "XEQT", kind: "buy", daysAgo: 900, qty: "200", price: "25.10", fees: "4.95" },
  { account: "wsPersonal", security: "XEQT", kind: "buy", daysAgo: 700, qty: "100", price: "28.40" },
  { account: "qtMargin", security: "XEQT", kind: "sell", daysAgo: 760, qty: "30", price: "26.80", fees: "4.95" },
  { account: "qtMargin", security: "XEQT", kind: "dividend", daysAgo: 820, amount: "88.40", cls: "eligible" },
  { account: "qtMargin", security: "XEQT", kind: "dividend", daysAgo: 455, amount: "92.15", cls: "eligible" },
  { account: "qtMargin", security: "XEQT", kind: "roc", daysAgo: 455, amount: "6.40" },
  { account: "wsPersonal", security: "XEQT", kind: "drip", daysAgo: 455, qty: "1.2", price: "29.10" },
  { account: "qtMargin", security: "XEQT", kind: "sell", daysAgo: 400, qty: "120", price: "31.05", fees: "4.95" },
  { account: "wsPersonal", security: "XEQT", kind: "drip", daysAgo: 90, qty: "1.35", price: "30.20" },
  { account: "qtTfsa", security: "XEQT", kind: "buy", daysAgo: 650, qty: "80", price: "27.00" },
  // Moved in kind into the TFSA: a deemed sale at fair market value.
  { account: "wsPersonal", security: "XEQT", kind: "transfer_out", daysAgo: 150, qty: "20", price: "30.50" },
  { account: "qtTfsa", security: "XEQT", kind: "transfer_in", daysAgo: 148, qty: "20", price: "30.50" },

  // RY at Questrade on the TSX and at Schwab on the NYSE: identical property, one pool.
  { account: "qtMargin", security: "RY", kind: "buy", daysAgo: 800, qty: "50", price: "120.40", fees: "4.95" },
  ...[700, 610, 520, 430, 340, 250, 160, 70].map(
    (daysAgo): SeedEntry => ({ account: "qtMargin", security: "RY", kind: "dividend", daysAgo, amount: "74.00", cls: "eligible" }),
  ),
  { account: "swIndividual", security: "RY_US", kind: "buy", daysAgo: 500, qty: "30", price: "95.10" },
  // Stored as foreign by the NYSE listing; pooled with the TSX listing, the engine counts it as eligible.
  ...[430, 250, 70].map(
    (daysAgo): SeedEntry => ({ account: "swIndividual", security: "RY_US", kind: "dividend", daysAgo, amount: "31.50", cls: "foreign" }),
  ),
  { account: "swIndividual", security: "RY_US", kind: "sell", daysAgo: 200, qty: "20", price: "101.20" },

  // SHOP sold at a loss and rebought in the TFSA eight days later: superficial, and lost for good.
  { account: "wsPersonal", security: "SHOP", kind: "buy", daysAgo: 600, qty: "40", price: "150.00" },
  { account: "wsPersonal", security: "SHOP", kind: "sell", daysAgo: 20, qty: "40", price: "110.00" },
  { account: "qtTfsa", security: "SHOP", kind: "buy", daysAgo: 12, qty: "15", price: "112.00" },

  // BCE: well below its ACB and no purchase in months, so it is a harvesting suggestion.
  { account: "qtMargin", security: "BCE", kind: "buy", daysAgo: 520, qty: "100", price: "60.25", fees: "4.95" },
  ...[430, 340, 250, 160, 70].map(
    (daysAgo): SeedEntry => ({ account: "qtMargin", security: "BCE", kind: "dividend", daysAgo, amount: "99.75", cls: "eligible" }),
  ),

  // VFV in the RRSP. The broker holds 10 more units than the history shared: a reconciliation gap.
  { account: "wsRrsp", security: "VFV", kind: "buy", daysAgo: 700, qty: "30", price: "100.50" },

  // AAPL in USD at Schwab, with 15% U.S. withholding on dividends, and a Roth IRA purchase.
  { account: "swIndividual", security: "AAPL", kind: "buy", daysAgo: 1000, qty: "25", price: "150.20" },
  ...[900, 720, 540, 360].map(
    (daysAgo): SeedEntry => ({ account: "swIndividual", security: "AAPL", kind: "dividend", daysAgo, amount: "6.00", cls: "foreign", withholding: "0.90" }),
  ),
  { account: "swIndividual", security: "AAPL", kind: "sell", daysAgo: 300, qty: "10", price: "210.75" },
  { account: "swIndividual", security: "AAPL", kind: "dividend", daysAgo: 180, amount: "3.75", cls: "foreign", withholding: "0.56" },
  { account: "swRoth", security: "AAPL", kind: "buy", daysAgo: 450, qty: "5", price: "180.00" },

  // MSFT transferred in from a broker that is not connected; the opening balance below supplies its cost.
  { account: "swIndividual", security: "MSFT", kind: "transfer_in", daysAgo: 365, qty: "20", price: "410.00" },
];

/** MSFT's cost from the old broker's statement, entered as an opening balance. */
const MSFT_OPENING = { quantity: "20", acbCad: "7150.00", daysAgo: 365 };
/** Units the RRSP holds beyond its shared history. */
const VFV_UNTRACKED = "10";

const CASH: Partial<Record<AccountKey, string>> = {
  qtMargin: "1240.55",
  qtTfsa: "85.10",
  // Includes the SHOP sale's proceeds, waiting out the 30-day superficial loss window.
  wsPersonal: "4810.00",
  wsRrsp: "22.70",
  wsFhsa: "19050.00",
  wsCash: "3500.00",
  swIndividual: "512.33",
  swRoth: "41.00",
};

/**
 * Cash into and out of the registered accounts, by tax year relative to this one (`year: -1` is last
 * year) and calendar day. RRSP contributions on `02-20` of a year count for the year before. Each flow
 * is a SnapTrade activity except `manual`, which the user entered for an account TaxBack cannot see.
 */
interface SeedFlow {
  account: AccountKey | null;
  year: 0 | -1 | -2;
  /** MM-DD. A day still ahead this year is left out until it arrives. */
  day: string;
  type: "CONTRIBUTION" | "WITHDRAWAL" | "INTERNAL_CASH_TRANSFER_IN" | "INTERNAL_CASH_TRANSFER_OUT" | "manual";
  amount: string;
  plan?: "rrsp";
  description?: string;
}

const FLOWS: SeedFlow[] = [
  // TFSA. Room on January 1 two years ago comes from CRA (below).
  { account: "qtTfsa", year: -2, day: "02-15", type: "CONTRIBUTION", amount: "10000" },
  // Moved over from the margin account at the same broker: a contribution, paired with its other side.
  { account: "qtMargin", year: -1, day: "01-20", type: "INTERNAL_CASH_TRANSFER_OUT", amount: "9000" },
  { account: "qtTfsa", year: -1, day: "01-20", type: "INTERNAL_CASH_TRANSFER_IN", amount: "9000" },
  // Withdrawn in April and put back in August: no room until next January, so an excess until October.
  { account: "qtTfsa", year: -1, day: "04-10", type: "WITHDRAWAL", amount: "3000" },
  { account: "qtTfsa", year: -1, day: "08-14", type: "CONTRIBUTION", amount: "3000" },
  { account: "qtTfsa", year: -1, day: "10-20", type: "WITHDRAWAL", amount: "3000" },
  // A transfer in with no visible other side: TaxBack counts it and asks the user to check.
  { account: "qtTfsa", year: -1, day: "11-05", type: "INTERNAL_CASH_TRANSFER_IN", amount: "500" },
  { account: "qtTfsa", year: 0, day: "01-15", type: "CONTRIBUTION", amount: "2500" },

  // RRSP: one contribution a year, one in the first 60 days, and a group RRSP through work.
  { account: "wsRrsp", year: -2, day: "06-01", type: "CONTRIBUTION", amount: "3000" },
  { account: "wsRrsp", year: -1, day: "03-20", type: "CONTRIBUTION", amount: "5000" },
  { account: null, year: -1, day: "12-15", type: "manual", plan: "rrsp", amount: "2400", description: "Group RRSP at work" },
  { account: "wsRrsp", year: 0, day: "02-20", type: "CONTRIBUTION", amount: "4000" },

  // FHSA, opened two years ago: $5,000 leaves $3,000 to carry forward.
  { account: "wsFhsa", year: -2, day: "05-01", type: "CONTRIBUTION", amount: "5000" },
  { account: "wsFhsa", year: -1, day: "03-01", type: "CONTRIBUTION", amount: "8000" },
  // Cash moved from the RRSP: uses FHSA room but is not deductible.
  { account: "wsRrsp", year: -1, day: "09-10", type: "INTERNAL_CASH_TRANSFER_OUT", amount: "2000" },
  { account: "wsFhsa", year: -1, day: "09-10", type: "INTERNAL_CASH_TRANSFER_IN", amount: "2000" },
  { account: "wsFhsa", year: 0, day: "01-25", type: "CONTRIBUTION", amount: "4000" },
];

/** What the demo user copied from CRA, and the estimate inputs for the years without it. */
const CONTRIBUTION_INPUTS: {
  plan: (typeof s.ROOM_PLANS)[number];
  year: -2 | -1 | 0;
  officialRoomCad?: string;
  earnedIncomePriorYearCad?: string;
  deductionClaimedCad?: string;
}[] = [
  { plan: "tfsa", year: -2, officialRoomCad: "12000" },
  { plan: "rrsp", year: -2, officialRoomCad: "12000" },
  { plan: "rrsp", year: -1, earnedIncomePriorYearCad: "88000" },
  { plan: "rrsp", year: 0, earnedIncomePriorYearCad: "92000" },
  // Deducting less than allowed leaves the rest for a year with a higher income.
  { plan: "fhsa", year: -1, deductionClaimedCad: "6000" },
];
const DEMO_BIRTH_YEAR = 1988;

/** Days of value history: every day for the last 400, then weekly back to the first trade. */
const DAILY_HISTORY_DAYS = 400;

/**
 * An illustrative price path for one security: straight lines between the prices it traded at, with a
 * deterministic wobble that is zero at every trade, so each ledger price and today's price are exact.
 */
function pricePath(key: SecurityKey): (daysAgo: number) => Dec {
  const knots = [
    ...LEDGER.filter((e) => e.security === key && e.price !== undefined).map((e) => ({ daysAgo: e.daysAgo, price: new D(e.price!) })),
    { daysAgo: 0, price: new D(SECURITIES[key].price) },
  ].sort((a, b) => b.daysAgo - a.daysAgo);
  const phase = [...key].reduce((sum, c) => sum + c.charCodeAt(0), 0) / 7;
  return (daysAgo) => {
    const first = knots[0]!;
    if (daysAgo >= first.daysAgo) return first.price;
    const right = knots.findIndex((k) => k.daysAgo <= daysAgo);
    const a = knots[right - 1]!;
    const b = knots[right]!;
    const t = a.daysAgo === b.daysAgo ? 1 : (a.daysAgo - daysAgo) / (a.daysAgo - b.daysAgo);
    const wobble = 0.6 * Math.sin(daysAgo * 0.21 + phase) + 0.4 * Math.sin(daysAgo * 0.057 + 2 * phase);
    const linear = a.price.plus(b.price.minus(a.price).times(t));
    return linear.times(new D(1).plus(new D(0.035 * wobble * 4 * t * (1 - t)).toDecimalPlaces(6)));
  };
}

/** What an entry did to its account's cash, in the account's currency. DRIPs and transfers move no cash. */
function cashFlow(e: SeedEntry): Dec {
  const gross = new D(e.qty ?? 0).times(e.price ?? 0);
  switch (e.kind) {
    case "buy":
      return gross.plus(e.fees ?? 0).negated();
    case "sell":
      return gross.minus(e.fees ?? 0);
    case "dividend":
    case "roc":
      return new D(e.amount ?? 0).minus(e.withholding ?? 0);
    default:
      return new D(0);
  }
}

/** CAD per unit on `date` from rows sorted by date: the latest rate on or before it, as the Hub uses. */
function rateOn(rows: { date: string; rate: Dec }[], date: string): Dec {
  let found: Dec | null = null;
  for (const r of rows) {
    if (r.date > date) break;
    found = r.rate;
  }
  return found ?? rows[0]?.rate ?? new D(1);
}

/** A weekday `daysAgo` days before `today`; weekends move back to Friday. */
function tradeDay(today: string, daysAgo: number): string {
  let date = addDays(today, -daysAgo);
  for (;;) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return date;
    date = addDays(date, -1);
  }
}

export interface SeedOptions {
  /** Loads Bank of Canada rates; replaced in tests so they never reach the network. */
  syncFx?: typeof syncFxRates;
  demoEmail?: string;
}

/**
 * Replaces the demo user's data with the demo portfolio and recomputes it. Safe to repeat: the daily
 * cron calls it to reset whatever state the demo is in.
 */
export async function seedDemo(db: AnyDb, today: string, options: SeedOptions = {}): Promise<void> {
  const { syncFx = syncFxRates, demoEmail = "demo@taxback.invalid" } = options;
  await ensureDemoUser(db, demoEmail);

  // Securities are global reference data shared with real users: reuse a listing if it exists.
  await db
    .insert(s.securities)
    .values(
      Object.values(SECURITIES).map((x) => ({
        symbol: x.symbol,
        exchange: x.exchange,
        currency: x.currency,
        country: x.country,
        name: x.name,
        securityType: x.type,
      })),
    )
    .onConflictDoNothing();
  const rows = await db
    .select({ id: s.securities.id, symbol: s.securities.symbol, exchange: s.securities.exchange, currency: s.securities.currency })
    .from(s.securities)
    .where(inArray(s.securities.symbol, [...new Set(Object.values(SECURITIES).map((x) => x.symbol))]));
  const securityId = (key: SecurityKey) => {
    const x = SECURITIES[key];
    const row = rows.find((r) => r.symbol === x.symbol && r.exchange === x.exchange && r.currency === x.currency);
    if (!row) throw new Error(`Demo security ${key} is missing`);
    return row.id;
  };

  const earliest = tradeDay(today, Math.max(...LEDGER.map((e) => e.daysAgo)));
  const year = Number(today.slice(0, 4));
  // The contributions start two years back; the accounts' history has to reach that far for room to add up.
  const historyFrom = [earliest, `${year - 2}-01-01`].sort()[0]!;
  const fx = await syncFx(db, ["USD"], earliest, today);
  if (fx.unsupported.length > 0) throw new Error(`Bank of Canada has no rates for ${fx.unsupported.join(", ")}`);

  await db.transaction(async (tx) => {
    // Accounts cascade to transactions, holdings, balances, and the derived rows that point at them.
    await tx.delete(s.connections).where(eq(s.connections.userId, DEMO_USER_ID));
    await tx.delete(s.manualAdjustments).where(eq(s.manualAdjustments.userId, DEMO_USER_ID));
    await tx.delete(s.contributionFlows).where(eq(s.contributionFlows.userId, DEMO_USER_ID));
    await tx.delete(s.corporateActions).where(eq(s.corporateActions.userId, DEMO_USER_ID));
    await tx.delete(s.securityPreferences).where(eq(s.securityPreferences.userId, DEMO_USER_ID));
    await tx.delete(s.syncRuns).where(eq(s.syncRuns.userId, DEMO_USER_ID));
    await tx.delete(s.securityPriceSnapshots).where(eq(s.securityPriceSnapshots.userId, DEMO_USER_ID));

    const connections = await tx
      .insert(s.connections)
      .values(
        BROKERAGES.map((b) => ({
          userId: DEMO_USER_ID,
          snaptradeAuthorizationId: `demo-${b.key}`,
          brokerageSlug: b.slug,
          brokerageName: b.name,
        })),
      )
      .returning({ id: s.connections.id, auth: s.connections.snaptradeAuthorizationId });
    const connectionId = (key: string) => connections.find((c) => c.auth === `demo-${key}`)!.id;

    const confirmedAt = new Date();
    const accounts = await tx
      .insert(s.brokerageAccounts)
      .values(
        (Object.entries(ACCOUNTS) as [AccountKey, (typeof ACCOUNTS)[AccountKey]][]).map(([key, a]) => ({
          userId: DEMO_USER_ID,
          connectionId: connectionId(a.brokerage),
          snaptradeAccountId: `demo-${key}`,
          name: a.name,
          numberMasked: a.last4,
          baseCurrency: a.currency,
          brokerRawType: a.name.toUpperCase(),
          kind: a.kind ?? ("investment" as const),
          accountType: a.type,
          accountTypeConfirmedAt: a.kind === "cash" ? null : confirmedAt,
          historyCompleteFrom: historyFrom,
        })),
      )
      .returning({ id: s.brokerageAccounts.id, key: s.brokerageAccounts.snaptradeAccountId });
    const accountId = (key: AccountKey) => accounts.find((a) => a.key === `demo-${key}`)!.id;

    await tx.insert(s.transactions).values(
      LEDGER.map((e, i) => {
        const trade = tradeDay(today, e.daysAgo);
        const settles = e.kind === "buy" || e.kind === "sell" || e.kind === "drip";
        return {
          userId: DEMO_USER_ID,
          accountId: accountId(e.account),
          securityId: securityId(e.security),
          snaptradeActivityId: `demo-${i + 1}`,
          kind: e.kind,
          tradeDate: trade,
          // Trades settle T+1; income and transfers are dated when they land.
          settlementDate: settles ? nextBusinessDay(trade) : trade,
          currency: SECURITIES[e.security].currency,
          quantity: e.qty ?? "0",
          price: e.price ?? "0",
          fees: e.fees ?? "0",
          amount: e.amount ?? "0",
          dividendClass: e.cls ?? null,
          withholdingTax: e.withholding ?? null,
          description: "Demo portfolio",
          raw: { demo: true },
        };
      }),
    );

    // What the brokers hold today: exactly what the history adds up to, plus the RRSP's untracked units.
    const held = new Map<string, { account: AccountKey; security: SecurityKey; quantity: Dec }>();
    for (const e of LEDGER) {
      const sign = ["buy", "drip", "transfer_in"].includes(e.kind) ? 1 : ["sell", "transfer_out"].includes(e.kind) ? -1 : 0;
      if (sign === 0) continue;
      const key = `${e.account}|${e.security}`;
      const current = held.get(key) ?? { account: e.account, security: e.security, quantity: new D(0) };
      current.quantity = current.quantity.plus(new D(e.qty ?? 0).times(sign));
      held.set(key, current);
    }
    const vfv = held.get("wsRrsp|VFV")!;
    vfv.quantity = vfv.quantity.plus(VFV_UNTRACKED);
    const asOf = new Date();
    await tx.insert(s.holdings).values(
      [...held.values()]
        .filter((h) => h.quantity.gt(0))
        .map((h) => {
          const sec = SECURITIES[h.security];
          return {
            userId: DEMO_USER_ID,
            accountId: accountId(h.account),
            securityId: securityId(h.security),
            quantity: h.quantity.toFixed(10),
            price: sec.price,
            currency: sec.currency,
            marketValue: h.quantity.times(sec.price).toFixed(6),
            asOf,
          };
        }),
    );
    await tx.insert(s.accountBalances).values(
      (Object.entries(CASH) as [AccountKey, string][]).map(([key, cash]) => ({
        accountId: accountId(key),
        userId: DEMO_USER_ID,
        currency: ACCOUNTS[key].currency,
        cash,
        asOf,
      })),
    );

    // Only days that have happened: early in the year, this year's flows are not there yet.
    const flows = FLOWS.map((f, i) => ({ ...f, i, date: `${year + f.year}-${f.day}` })).filter((f) => f.date < today);
    await tx.insert(s.contributionFlows).values(
      flows.map((f) =>
        f.type === "manual"
          ? {
              userId: DEMO_USER_ID,
              source: "manual" as const,
              plan: f.plan!,
              flowDate: f.date,
              direction: "in" as const,
              amount: f.amount,
              currency: "CAD",
              description: f.description ?? null,
              classification: "contribution" as const,
            }
          : {
              userId: DEMO_USER_ID,
              source: "snaptrade" as const,
              accountId: accountId(f.account!),
              snaptradeActivityId: `demo-flow-${f.i + 1}`,
              brokerType: f.type,
              flowDate: f.date,
              direction: f.type === "WITHDRAWAL" || f.type === "INTERNAL_CASH_TRANSFER_OUT" ? ("out" as const) : ("in" as const),
              amount: f.amount,
              currency: "CAD",
              description: "Demo portfolio",
              raw: { demo: true },
            },
      ),
    );
    await tx.delete(s.contributionInputs).where(eq(s.contributionInputs.userId, DEMO_USER_ID));
    await tx.insert(s.contributionInputs).values(
      CONTRIBUTION_INPUTS.map(({ year: offset, ...input }) => ({ userId: DEMO_USER_ID, taxYear: year + offset, ...input })),
    );

    await tx.insert(s.manualAdjustments).values({
      userId: DEMO_USER_ID,
      securityId: securityId("MSFT"),
      quantity: MSFT_OPENING.quantity,
      acbCad: MSFT_OPENING.acbCad,
      asOfDate: tradeDay(today, MSFT_OPENING.daysAgo),
      note: "Transferred in from my previous broker; cost from its last statement",
    });
    // The two RY listings are linked as the same shares. A real sync would usually match them by FIGI.
    await tx.insert(s.securityPreferences).values({ userId: DEMO_USER_ID, securityId: securityId("RY_US"), poolSecurityId: securityId("RY") });
    // Value history for the Hub chart, replayed from the ledger above at illustrative prices and real
    // Bank of Canada rates. Cash is today's balance less the trades and income since, floored at zero
    // (a deposit funded it). Day 0 is exactly today's holdings and cash.
    const usd = (
      await tx
        .select({ date: s.fxRates.rateDate, rate: s.fxRates.cadPerUnit })
        .from(s.fxRates)
        .where(eq(s.fxRates.currency, "USD"))
        .orderBy(asc(s.fxRates.rateDate))
    ).map((r) => ({ date: r.date, rate: new D(r.rate) }));
    const fxOn = (currency: string, date: string) => (currency === "CAD" ? new D(1) : rateOn(usd, date));
    const paths = new Map((Object.keys(SECURITIES) as SecurityKey[]).map((key) => [key, pricePath(key)]));
    const oldest = Math.max(...LEDGER.map((e) => e.daysAgo));
    const valueRows: (typeof s.accountValueSnapshots.$inferInsert)[] = [];
    const priceRows: (typeof s.securityPriceSnapshots.$inferInsert)[] = [];
    for (let daysAgo = oldest; daysAgo >= 0; daysAgo--) {
      if (daysAgo > DAILY_HISTORY_DAYS && daysAgo % 7 !== 0) continue;
      const date = addDays(today, -daysAgo);
      const quantities = new Map<string, Dec>();
      for (const e of LEDGER) {
        if (e.daysAgo < daysAgo) continue;
        const sign = ["buy", "drip", "transfer_in"].includes(e.kind) ? 1 : ["sell", "transfer_out"].includes(e.kind) ? -1 : 0;
        if (sign === 0) continue;
        const key = `${e.account}|${e.security}`;
        quantities.set(key, (quantities.get(key) ?? new D(0)).plus(new D(e.qty ?? 0).times(sign)));
      }
      quantities.set("wsRrsp|VFV", (quantities.get("wsRrsp|VFV") ?? new D(0)).plus(VFV_UNTRACKED));
      const priceCad = (key: SecurityKey) => paths.get(key)!(daysAgo).times(fxOn(SECURITIES[key].currency, date));
      const heldSecurities = new Set<SecurityKey>();
      for (const [key, account] of Object.entries(ACCOUNTS) as [AccountKey, (typeof ACCOUNTS)[AccountKey]][]) {
        const later = LEDGER.filter((e) => e.account === key && e.daysAgo < daysAgo).reduce((sum, e) => sum.plus(cashFlow(e)), new D(0));
        let value = D.max(new D(CASH[key] ?? 0).minus(later), 0).times(fxOn(account.currency, date));
        for (const [pair, quantity] of quantities) {
          const [accountKey, securityKey] = pair.split("|") as [AccountKey, SecurityKey];
          if (accountKey !== key || quantity.lte(0)) continue;
          heldSecurities.add(securityKey);
          value = value.plus(quantity.times(paths.get(securityKey)!(daysAgo)).times(fxOn(SECURITIES[securityKey].currency, date)));
        }
        valueRows.push({ accountId: accountId(key), userId: DEMO_USER_ID, day: date, valueCad: value.toFixed(6) });
      }
      for (const key of heldSecurities) {
        priceRows.push({ userId: DEMO_USER_ID, securityId: securityId(key), day: date, priceCad: priceCad(key).toFixed(6) });
      }
    }
    for (let i = 0; i < valueRows.length; i += 1000) await tx.insert(s.accountValueSnapshots).values(valueRows.slice(i, i + 1000));
    for (let i = 0; i < priceRows.length; i += 1000) await tx.insert(s.securityPriceSnapshots).values(priceRows.slice(i, i + 1000));

    await tx
      .update(s.userProfiles)
      .set({
        marginalRate: "0.43410",
        birthYear: DEMO_BIRTH_YEAR,
        residentSinceYear: null,
        fhsaOpenedYear: Math.max(year - 2, 2023),
        lastSyncedAt: asOf,
      })
      .where(eq(s.userProfiles.userId, DEMO_USER_ID));

    await recomputeUser(tx, DEMO_USER_ID, today);
  });
}

/** Seeds the demo the first time a visitor needs it, so "Try the demo" works before the first cron run. */
export async function ensureDemoSeeded(db: AnyDb, today: string, options: SeedOptions = {}): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(s.connections)
    .where(eq(s.connections.userId, DEMO_USER_ID));
  if ((row?.n ?? 0) > 0) return;
  await seedDemo(db, today, options);
}
