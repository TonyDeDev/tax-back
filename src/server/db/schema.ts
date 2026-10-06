import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth-schema";

export * from "./auth-schema";

/*
 * Tenancy is per user: every user-owned row carries `user_id`, and children reference their parent
 * through `(id, user_id)` composite keys so a row can never point at another user's data.
 * Numbers come back as strings and go straight into decimal.js; never parse them as `number`.
 * Derived tables are a cache of `computeTax()` output, replaced per user on every recompute.
 */

const money = (name: string) => numeric(name, { precision: 20, scale: 6 });
const quantity = (name: string) => numeric(name, { precision: 28, scale: 10 });
const ratio = (name: string) => numeric(name, { precision: 20, scale: 10 });
const rate = (name: string) => numeric(name, { precision: 6, scale: 5 });
const day = (name: string) => date(name, { mode: "string" });
const instant = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => instant("created_at").notNull().defaultNow();
const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const currencyCheck = (name: string, column: string) => check(name, sql.raw(`${column} ~ '^[A-Z]{3}$'`));
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const ACCOUNT_TYPES = ["non_registered", "tfsa", "rrsp", "fhsa", "resp", "rrif", "lira"] as const;
export const TRANSACTION_KINDS = [
  "buy",
  "sell",
  "drip",
  "dividend",
  "roc",
  "split",
  "fee",
  "transfer_in",
  "transfer_out",
] as const;
export const DIVIDEND_CLASSES = ["eligible", "non_eligible", "foreign"] as const;
/** `cash` accounts (chequing, Wealthsimple Cash) hold only cash, so they count toward value but never toward gains. */
export const ACCOUNT_KINDS = ["investment", "cash"] as const;
export const SECURITY_TYPES = ["equity", "etf", "mutual_fund", "bond", "option", "crypto", "other"] as const;
export const CONNECTION_STATUSES = ["active", "broken"] as const;
export const SYNC_TRIGGERS = ["connect", "manual", "cron", "demo_reset"] as const;
export const SYNC_STATUSES = ["running", "succeeded", "failed"] as const;
export const ACB_EVENT_KINDS = [...TRANSACTION_KINDS, "opening", "superficial_adjustment"] as const;
export const WARNING_TYPES = [
  "opening_balance_needed",
  "superficial_loss_lost_forever",
  "superficial_loss_pending",
  "unsupported_transfer",
  "roc_without_position",
  "split_reported_twice",
  "assumed_year_config",
] as const;

// ===== Profile =====

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    isDemo: boolean("is_demo").notNull().default(false),
    /** User-chosen marginal rate for the tax estimate; null means no estimate. */
    marginalRate: rate("marginal_rate"),
    lastSyncedAt: instant("last_synced_at"),
    lastRecomputedAt: instant("last_recomputed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("user_profiles_one_demo_key").on(t.isDemo).where(sql`is_demo`),
    check(
      "user_profiles_marginal_rate_check",
      sql`marginal_rate IS NULL OR (marginal_rate >= 0 AND marginal_rate < 1)`,
    ),
  ],
);

// ===== Brokerage data (upserted by SnapTrade id) =====

/** One SnapTrade brokerage authorization. The demo seed uses `demo-` prefixed ids. */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    snaptradeAuthorizationId: text("snaptrade_authorization_id").notNull(),
    brokerageSlug: text("brokerage_slug").notNull(),
    brokerageName: text("brokerage_name").notNull(),
    status: text("status", { enum: CONNECTION_STATUSES }).notNull().default("active"),
    statusDetail: text("status_detail"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("connections_id_user_id_key").on(t.id, t.userId),
    // Per user, not global: an OAuth user can share one SnapTrade connection with others (workspaces), and
    // the sync upserts on this key, so it can only ever touch the signed-in user's own rows.
    unique("connections_user_authorization_key").on(t.userId, t.snaptradeAuthorizationId),
    check("connections_status_check", inList("status", CONNECTION_STATUSES)),
  ],
);

export const brokerageAccounts = pgTable(
  "brokerage_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    snaptradeAccountId: text("snaptrade_account_id").notNull(),
    name: text("name").notNull(),
    /** Last 4 digits only, never the full number. */
    numberMasked: text("number_masked"),
    baseCurrency: text("base_currency").notNull(),
    /** What SnapTrade reported, e.g. "TFSA" or "Margin". */
    brokerRawType: text("broker_raw_type"),
    kind: text("kind", { enum: ACCOUNT_KINDS }).notNull().default("investment"),
    accountType: text("account_type", { enum: ACCOUNT_TYPES }).notNull().default("non_registered"),
    /** Null while `accountType` is only a guess; the UI asks the user to confirm. */
    accountTypeConfirmedAt: instant("account_type_confirmed_at"),
    /** Earliest activity SnapTrade returned for this account. */
    historyCompleteFrom: day("history_complete_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("brokerage_accounts_id_user_id_key").on(t.id, t.userId),
    unique("brokerage_accounts_user_snaptrade_key").on(t.userId, t.snaptradeAccountId),
    foreignKey({
      name: "brokerage_accounts_connection_fkey",
      columns: [t.connectionId, t.userId],
      foreignColumns: [connections.id, connections.userId],
    }).onDelete("cascade"),
    index("idx_brokerage_accounts_connection").on(t.connectionId, t.userId),
    currencyCheck("brokerage_accounts_base_currency_check", "base_currency"),
    check("brokerage_accounts_account_type_check", inList("account_type", ACCOUNT_TYPES)),
    check("brokerage_accounts_kind_check", inList("kind", ACCOUNT_KINDS)),
  ],
);

/** Global reference data: one row per instrument, shared by every user, which is what makes pooled ACB a GROUP BY. */
export const securities = pgTable(
  "securities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SnapTrade universal symbol id; null for securities only the demo seed knows. */
    snaptradeSymbolId: text("snaptrade_symbol_id").unique(),
    symbol: text("symbol").notNull(),
    exchange: text("exchange"),
    name: text("name"),
    currency: text("currency").notNull(),
    securityType: text("security_type", { enum: SECURITY_TYPES }).notNull().default("equity"),
    /** Issuer country; drives the default dividend class. */
    country: text("country"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("securities_symbol_exchange_currency_key").on(t.symbol, t.exchange, t.currency).nullsNotDistinct(),
    currencyCheck("securities_currency_check", "currency"),
    check("securities_security_type_check", inList("security_type", SECURITY_TYPES)),
  ],
);

/** Mirrors the tax engine's `LedgerEntry`, and repeats its `validateLedger` rules as constraints. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Null only for cash-level fees. */
    securityId: uuid("security_id").references(() => securities.id, { onDelete: "restrict" }),
    snaptradeActivityId: text("snaptrade_activity_id").notNull(),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    tradeDate: day("trade_date").notNull(),
    settlementDate: day("settlement_date").notNull(),
    currency: text("currency").notNull(),
    quantity: quantity("quantity").notNull().default("0"),
    price: money("price").notNull().default("0"),
    fees: money("fees").notNull().default("0"),
    /** Total for dividend and roc entries, in `currency`. */
    amount: money("amount").notNull().default("0"),
    /** New shares per old share. */
    splitRatio: ratio("split_ratio"),
    dividendClass: text("dividend_class", { enum: DIVIDEND_CLASSES }),
    withholdingTax: money("withholding_tax"),
    description: text("description"),
    /** Original SnapTrade activity, so a mapping fix can be replayed without a re-sync. Never queried into. */
    raw: jsonb("raw").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("transactions_id_user_id_key").on(t.id, t.userId),
    unique("transactions_account_activity_key").on(t.accountId, t.snaptradeActivityId),
    foreignKey({
      name: "transactions_account_fkey",
      columns: [t.accountId, t.userId],
      foreignColumns: [brokerageAccounts.id, brokerageAccounts.userId],
    }).onDelete("cascade"),
    index("idx_transactions_user_security_date").on(t.userId, t.securityId, t.settlementDate),
    index("idx_transactions_account_date").on(t.accountId, t.settlementDate.desc()),
    index("idx_transactions_security").on(t.securityId),
    currencyCheck("transactions_currency_check", "currency"),
    check("transactions_kind_check", inList("kind", TRANSACTION_KINDS)),
    // A NULL class passes: CHECK only rejects false.
    check("transactions_dividend_class_check", inList("dividend_class", DIVIDEND_CLASSES)),
    check("transactions_quantity_check", sql`quantity >= 0`),
    check("transactions_price_check", sql`price >= 0`),
    check("transactions_fees_check", sql`fees >= 0`),
    check("transactions_split_ratio_check", sql`split_ratio IS NULL OR split_ratio > 0`),
    check("transactions_withholding_check", sql`withholding_tax IS NULL OR withholding_tax >= 0`),
    check("transactions_dates_check", sql`settlement_date >= trade_date`),
    check("transactions_split_needs_ratio", sql`kind <> 'split' OR split_ratio IS NOT NULL`),
    check("transactions_dividend_needs_class", sql`kind <> 'dividend' OR dividend_class IS NOT NULL`),
    check("transactions_needs_security", sql`kind = 'fee' OR security_id IS NOT NULL`),
    check("transactions_trade_needs_quantity", sql`kind NOT IN ('buy', 'sell', 'drip') OR quantity > 0`),
  ],
);

export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    quantity: quantity("quantity").notNull(),
    price: money("price"),
    currency: text("currency").notNull(),
    marketValue: money("market_value"),
    /** The broker's own book value: shown for comparison only, never trusted for ACB. */
    brokerBookValue: money("broker_book_value"),
    asOf: instant("as_of").notNull(),
  },
  (t) => [
    unique("holdings_account_security_key").on(t.accountId, t.securityId),
    foreignKey({
      name: "holdings_account_fkey",
      columns: [t.accountId, t.userId],
      foreignColumns: [brokerageAccounts.id, brokerageAccounts.userId],
    }).onDelete("cascade"),
    index("idx_holdings_user").on(t.userId),
    index("idx_holdings_security").on(t.securityId),
    currencyCheck("holdings_currency_check", "currency"),
  ],
);

export const accountBalances = pgTable(
  "account_balances",
  {
    accountId: uuid("account_id").notNull(),
    userId: text("user_id").notNull(),
    currency: text("currency").notNull(),
    cash: money("cash").notNull(),
    asOf: instant("as_of").notNull(),
  },
  (t) => [
    primaryKey({ name: "account_balances_pkey", columns: [t.accountId, t.currency] }),
    foreignKey({
      name: "account_balances_account_fkey",
      columns: [t.accountId, t.userId],
      foreignColumns: [brokerageAccounts.id, brokerageAccounts.userId],
    }).onDelete("cascade"),
    index("idx_account_balances_user").on(t.userId),
    currencyCheck("account_balances_currency_check", "currency"),
  ],
);

// ===== User input =====

/** The engine's `OpeningAdjustment`: a user-confirmed starting position when history is incomplete. */
export const manualAdjustments = pgTable(
  "manual_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    quantity: quantity("quantity").notNull(),
    acbCad: money("acb_cad").notNull(),
    asOfDate: day("as_of_date").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("manual_adjustments_id_user_id_key").on(t.id, t.userId),
    unique("manual_adjustments_user_security_key").on(t.userId, t.securityId),
    index("idx_manual_adjustments_security").on(t.securityId),
    check("manual_adjustments_quantity_check", sql`quantity >= 0`),
    check("manual_adjustments_acb_check", sql`acb_cad >= 0`),
  ],
);

// ===== Global reference =====

/** Bank of Canada rates, CAD per one unit of `currency`. CAD itself is never stored (it is always 1). */
export const fxRates = pgTable(
  "fx_rates",
  {
    currency: text("currency").notNull(),
    rateDate: day("rate_date").notNull(),
    cadPerUnit: ratio("cad_per_unit").notNull(),
    source: text("source").notNull().default("boc_valet"),
  },
  (t) => [
    primaryKey({ name: "fx_rates_pkey", columns: [t.currency, t.rateDate] }),
    check("fx_rates_currency_check", sql`currency ~ '^[A-Z]{3}$' AND currency <> 'CAD'`),
    check("fx_rates_rate_check", sql`cad_per_unit > 0`),
  ],
);

// ===== Operational =====

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    trigger: text("trigger", { enum: SYNC_TRIGGERS }).notNull(),
    status: text("status", { enum: SYNC_STATUSES }).notNull().default("running"),
    startedAt: instant("started_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
    error: text("error"),
    /** Row counts per entity, for display and debugging only. */
    stats: jsonb("stats"),
  },
  (t) => [
    index("idx_sync_runs_user_started").on(t.userId, t.startedAt.desc()),
    // One running sync per user: blocks double clicks and cron overlapping a manual refresh.
    uniqueIndex("sync_runs_one_running_key").on(t.userId).where(sql`status = 'running'`),
    check("sync_runs_trigger_check", inList("trigger", SYNC_TRIGGERS)),
    check("sync_runs_status_check", inList("status", SYNC_STATUSES)),
    check("sync_runs_finished_check", sql`(status = 'running') = (finished_at IS NULL)`),
  ],
);

// ===== Derived (replaced per user on every recompute) =====

/*
 * Derived rows reference the ledger through `(id, user_id)` like every other child, so a recompute
 * bug can never attach one user's result to another user's transaction or account.
 * A NULL source id skips the check (MATCH SIMPLE), which is what the nullable sources want.
 */
const ownTransaction = (name: string, transactionId: AnyPgColumn, userId: AnyPgColumn) =>
  foreignKey({
    name,
    columns: [transactionId, userId],
    foreignColumns: [transactions.id, transactions.userId],
  }).onDelete("cascade");
const ownAccount = (name: string, accountId: AnyPgColumn, userId: AnyPgColumn) =>
  foreignKey({
    name,
    columns: [accountId, userId],
    foreignColumns: [brokerageAccounts.id, brokerageAccounts.userId],
  }).onDelete("cascade");

export const acbPositions = pgTable(
  "acb_positions",
  {
    userId: userRef(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    quantity: quantity("quantity").notNull(),
    totalAcbCad: money("total_acb_cad").notNull(),
    acbPerShareCad: money("acb_per_share_cad").notNull(),
  },
  (t) => [
    primaryKey({ name: "acb_positions_pkey", columns: [t.userId, t.securityId] }),
    index("idx_acb_positions_security").on(t.securityId),
  ],
);

/** The security detail page's ACB breakdown. Each event comes from a transaction or from an opening balance. */
export const acbEvents = pgTable(
  "acb_events",
  {
    userId: userRef(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    /** Engine order within the security; the breakdown's sort key. */
    seq: integer("seq").notNull(),
    transactionId: uuid("transaction_id"),
    manualAdjustmentId: uuid("manual_adjustment_id"),
    eventDate: day("event_date").notNull(),
    kind: text("kind", { enum: ACB_EVENT_KINDS }).notNull(),
    quantityDelta: quantity("quantity_delta").notNull(),
    acbDeltaCad: money("acb_delta_cad").notNull(),
    poolQuantityAfter: quantity("pool_quantity_after").notNull(),
    poolAcbAfterCad: money("pool_acb_after_cad").notNull(),
  },
  (t) => [
    primaryKey({ name: "acb_events_pkey", columns: [t.userId, t.securityId, t.seq] }),
    ownTransaction("acb_events_transaction_fkey", t.transactionId, t.userId),
    foreignKey({
      name: "acb_events_manual_adjustment_fkey",
      columns: [t.manualAdjustmentId, t.userId],
      foreignColumns: [manualAdjustments.id, manualAdjustments.userId],
    }).onDelete("cascade"),
    index("idx_acb_events_security").on(t.securityId),
    index("idx_acb_events_transaction").on(t.transactionId),
    index("idx_acb_events_manual").on(t.manualAdjustmentId),
    check("acb_events_kind_check", inList("kind", ACB_EVENT_KINDS)),
    check("acb_events_one_source", sql`num_nonnulls(transaction_id, manual_adjustment_id) = 1`),
  ],
);

export const realizedGains = pgTable(
  "realized_gains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    transactionId: uuid("transaction_id").notNull(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    kind: text("kind", { enum: ["sale", "roc_excess"] }).notNull(),
    dispositionDate: day("disposition_date").notNull(),
    taxYear: smallint("tax_year").notNull(),
    quantity: quantity("quantity").notNull(),
    proceedsCad: money("proceeds_cad").notNull(),
    acbCad: money("acb_cad").notNull(),
    feesCad: money("fees_cad").notNull(),
    /** proceeds - acb - fees, before any superficial loss denial. */
    gainCad: money("gain_cad").notNull(),
    deniedLossCad: money("denied_loss_cad").notNull().default("0"),
    /** What counts for the year: gain + denied loss. */
    allowedGainCad: money("allowed_gain_cad").notNull(),
    /** The sale exceeded the known position, so ACB is understated. */
    incomplete: boolean("incomplete").notNull().default(false),
  },
  (t) => [
    unique("realized_gains_transaction_kind_key").on(t.transactionId, t.kind),
    ownTransaction("realized_gains_transaction_fkey", t.transactionId, t.userId),
    ownAccount("realized_gains_account_fkey", t.accountId, t.userId),
    index("idx_realized_gains_user_year").on(t.userId, t.taxYear, t.dispositionDate),
    index("idx_realized_gains_security").on(t.securityId),
    index("idx_realized_gains_account").on(t.accountId),
    check("realized_gains_kind_check", sql`kind IN ('sale', 'roc_excess')`),
  ],
);

export const superficialLosses = pgTable(
  "superficial_losses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    saleTransactionId: uuid("sale_transaction_id").notNull().unique(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    saleDate: day("sale_date").notNull(),
    taxYear: smallint("tax_year").notNull(),
    /** `pending` until `windowEnd` has passed; the denial is provisional until then. */
    status: text("status", { enum: ["final", "pending"] }).notNull(),
    quantitySold: quantity("quantity_sold").notNull(),
    quantityDenied: quantity("quantity_denied").notNull(),
    totalLossCad: money("total_loss_cad").notNull(),
    deniedLossCad: money("denied_loss_cad").notNull(),
    allowedLossCad: money("allowed_loss_cad").notNull(),
    lostForeverCad: money("lost_forever_cad").notNull().default("0"),
    windowStart: day("window_start").notNull(),
    windowEnd: day("window_end").notNull(),
  },
  (t) => [
    unique("superficial_losses_id_user_id_key").on(t.id, t.userId),
    ownTransaction("superficial_losses_sale_transaction_fkey", t.saleTransactionId, t.userId),
    index("idx_superficial_losses_user_year").on(t.userId, t.taxYear),
    index("idx_superficial_losses_pending").on(t.userId, t.windowEnd).where(sql`status = 'pending'`),
    index("idx_superficial_losses_security").on(t.securityId),
    check("superficial_losses_status_check", sql`status IN ('final', 'pending')`),
    check("superficial_losses_window_check", sql`window_end > window_start`),
  ],
);

export const superficialLossReplacements = pgTable(
  "superficial_loss_replacements",
  {
    superficialLossId: uuid("superficial_loss_id").notNull(),
    /** No direct `users` reference: every row cascades from its loss, which has one. */
    userId: text("user_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Snapshot of the replacement account's type at compute time. */
    accountType: text("account_type", { enum: ACCOUNT_TYPES }).notNull(),
    quantity: quantity("quantity").notNull(),
    deniedCad: money("denied_cad").notNull(),
    disposition: text("disposition", { enum: ["added_to_acb", "lost_forever"] }).notNull(),
  },
  (t) => [
    primaryKey({ name: "superficial_loss_replacements_pkey", columns: [t.superficialLossId, t.transactionId] }),
    foreignKey({
      name: "slr_superficial_loss_fkey",
      columns: [t.superficialLossId, t.userId],
      foreignColumns: [superficialLosses.id, superficialLosses.userId],
    }).onDelete("cascade"),
    ownTransaction("slr_transaction_fkey", t.transactionId, t.userId),
    ownAccount("slr_account_fkey", t.accountId, t.userId),
    index("idx_slr_transaction").on(t.transactionId),
    index("idx_slr_account").on(t.accountId),
    check("slr_account_type_check", inList("account_type", ACCOUNT_TYPES)),
    check("slr_disposition_check", sql`disposition IN ('added_to_acb', 'lost_forever')`),
  ],
);

export const incomeEvents = pgTable(
  "income_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    transactionId: uuid("transaction_id").notNull().unique(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    paidDate: day("paid_date").notNull(),
    taxYear: smallint("tax_year").notNull(),
    dividendClass: text("dividend_class", { enum: DIVIDEND_CLASSES }).notNull(),
    amountCad: money("amount_cad").notNull(),
    grossedUpCad: money("grossed_up_cad").notNull(),
    federalCreditCad: money("federal_credit_cad").notNull(),
    withholdingCad: money("withholding_cad").notNull().default("0"),
  },
  (t) => [
    ownTransaction("income_events_transaction_fkey", t.transactionId, t.userId),
    ownAccount("income_events_account_fkey", t.accountId, t.userId),
    index("idx_income_events_user_year").on(t.userId, t.taxYear, t.paidDate),
    index("idx_income_events_security").on(t.securityId),
    index("idx_income_events_account").on(t.accountId),
    check("income_events_dividend_class_check", inList("dividend_class", DIVIDEND_CLASSES)),
  ],
);

export const harvestOpportunities = pgTable(
  "harvest_opportunities",
  {
    userId: userRef(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    asOfDate: day("as_of_date").notNull(),
    quantity: quantity("quantity").notNull(),
    acbCad: money("acb_cad").notNull(),
    marketValueCad: money("market_value_cad").notNull(),
    unrealizedLossCad: money("unrealized_loss_cad").notNull(),
    gainsAvailableToOffsetCad: money("gains_available_to_offset_cad").notNull(),
    estimatedTaxSavingsCad: money("estimated_tax_savings_cad"),
    windowStart: day("window_start").notNull(),
    windowEnd: day("window_end").notNull(),
    blockedByRecentPurchase: boolean("blocked_by_recent_purchase").notNull(),
    earliestSafeSaleDate: day("earliest_safe_sale_date").notNull(),
    /** Do not buy this security in any account, including TFSA/RRSP, before this date. */
    noRebuyBefore: day("no_rebuy_before").notNull(),
  },
  (t) => [
    primaryKey({ name: "harvest_opportunities_pkey", columns: [t.userId, t.securityId] }),
    index("idx_harvest_opportunities_security").on(t.securityId),
  ],
);

export const taxYearSummaries = pgTable(
  "tax_year_summaries",
  {
    userId: userRef(),
    taxYear: smallint("tax_year").notNull(),
    proceedsCad: money("proceeds_cad").notNull(),
    acbCad: money("acb_cad").notNull(),
    feesCad: money("fees_cad").notNull(),
    netCapitalGainCad: money("net_capital_gain_cad").notNull(),
    deniedLossesCad: money("denied_losses_cad").notNull(),
    inclusionRate: rate("inclusion_rate").notNull(),
    /** Signed: negative is a net capital loss available to carry. */
    taxableCapitalGainCad: money("taxable_capital_gain_cad").notNull(),
    eligibleDividendsCad: money("eligible_dividends_cad").notNull(),
    nonEligibleDividendsCad: money("non_eligible_dividends_cad").notNull(),
    foreignIncomeCad: money("foreign_income_cad").notNull(),
    foreignWithholdingCad: money("foreign_withholding_cad").notNull(),
    federalDividendCreditCad: money("federal_dividend_credit_cad").notNull(),
    estimatedTaxCad: money("estimated_tax_cad"),
    /** The year was outside the verified rate table and the nearest year's rates were used. */
    configAssumed: boolean("config_assumed").notNull().default(false),
  },
  (t) => [primaryKey({ name: "tax_year_summaries_pkey", columns: [t.userId, t.taxYear] })],
);

export const taxWarnings = pgTable(
  "tax_warnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    type: text("type", { enum: WARNING_TYPES }).notNull(),
    securityId: uuid("security_id").references(() => securities.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id"),
    taxYear: smallint("tax_year"),
    /** Units missing from the known position, for `opening_balance_needed`. */
    shortfallQuantity: quantity("shortfall_quantity"),
    /** Amount lost, for `superficial_loss_lost_forever`. */
    amountCad: money("amount_cad"),
    /** Window end, for `superficial_loss_pending`. */
    dueDate: day("due_date"),
  },
  (t) => [
    ownTransaction("tax_warnings_transaction_fkey", t.transactionId, t.userId),
    index("idx_tax_warnings_user").on(t.userId, t.type),
    index("idx_tax_warnings_security").on(t.securityId),
    index("idx_tax_warnings_transaction").on(t.transactionId),
    check("tax_warnings_type_check", inList("type", WARNING_TYPES)),
    check(
      "tax_warnings_subject_check",
      sql`CASE WHEN type = 'assumed_year_config' THEN tax_year IS NOT NULL
               ELSE security_id IS NOT NULL AND transaction_id IS NOT NULL END`,
    ),
  ],
);
