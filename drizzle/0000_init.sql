CREATE TABLE "acb_events" (
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"transaction_id" uuid,
	"manual_adjustment_id" uuid,
	"event_date" date NOT NULL,
	"kind" text NOT NULL,
	"quantity_delta" numeric(28, 10) NOT NULL,
	"acb_delta_cad" numeric(20, 6) NOT NULL,
	"pool_quantity_after" numeric(28, 10) NOT NULL,
	"pool_acb_after_cad" numeric(20, 6) NOT NULL,
	CONSTRAINT "acb_events_pkey" PRIMARY KEY("user_id","security_id","seq"),
	CONSTRAINT "acb_events_kind_check" CHECK (kind IN ('buy', 'sell', 'drip', 'dividend', 'roc', 'split', 'fee', 'transfer_in', 'transfer_out', 'opening', 'superficial_adjustment')),
	CONSTRAINT "acb_events_one_source" CHECK (num_nonnulls(transaction_id, manual_adjustment_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "acb_positions" (
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"total_acb_cad" numeric(20, 6) NOT NULL,
	"acb_per_share_cad" numeric(20, 6) NOT NULL,
	CONSTRAINT "acb_positions_pkey" PRIMARY KEY("user_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "account_balances" (
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"currency" text NOT NULL,
	"cash" numeric(20, 6) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "account_balances_pkey" PRIMARY KEY("account_id","currency"),
	CONSTRAINT "account_balances_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "brokerage_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"snaptrade_account_id" text NOT NULL,
	"name" text NOT NULL,
	"number_masked" text,
	"base_currency" text NOT NULL,
	"broker_raw_type" text,
	"account_type" text DEFAULT 'non_registered' NOT NULL,
	"account_type_confirmed_at" timestamp with time zone,
	"history_complete_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brokerage_accounts_snaptrade_account_id_unique" UNIQUE("snaptrade_account_id"),
	CONSTRAINT "brokerage_accounts_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "brokerage_accounts_base_currency_check" CHECK (base_currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "brokerage_accounts_account_type_check" CHECK (account_type IN ('non_registered', 'tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"snaptrade_authorization_id" text NOT NULL,
	"brokerage_slug" text NOT NULL,
	"brokerage_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_snaptrade_authorization_id_unique" UNIQUE("snaptrade_authorization_id"),
	CONSTRAINT "connections_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "connections_status_check" CHECK (status IN ('active', 'broken'))
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"rate_date" date NOT NULL,
	"cad_per_unit" numeric(20, 10) NOT NULL,
	"source" text DEFAULT 'boc_valet' NOT NULL,
	CONSTRAINT "fx_rates_pkey" PRIMARY KEY("currency","rate_date"),
	CONSTRAINT "fx_rates_currency_check" CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'CAD'),
	CONSTRAINT "fx_rates_rate_check" CHECK (cad_per_unit > 0)
);
--> statement-breakpoint
CREATE TABLE "harvest_opportunities" (
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"acb_cad" numeric(20, 6) NOT NULL,
	"market_value_cad" numeric(20, 6) NOT NULL,
	"unrealized_loss_cad" numeric(20, 6) NOT NULL,
	"gains_available_to_offset_cad" numeric(20, 6) NOT NULL,
	"estimated_tax_savings_cad" numeric(20, 6),
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"blocked_by_recent_purchase" boolean NOT NULL,
	"earliest_safe_sale_date" date NOT NULL,
	"no_rebuy_before" date NOT NULL,
	CONSTRAINT "harvest_opportunities_pkey" PRIMARY KEY("user_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"price" numeric(20, 6),
	"currency" text NOT NULL,
	"market_value" numeric(20, 6),
	"broker_book_value" numeric(20, 6),
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "holdings_account_security_key" UNIQUE("account_id","security_id"),
	CONSTRAINT "holdings_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "income_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"paid_date" date NOT NULL,
	"tax_year" smallint NOT NULL,
	"dividend_class" text NOT NULL,
	"amount_cad" numeric(20, 6) NOT NULL,
	"grossed_up_cad" numeric(20, 6) NOT NULL,
	"federal_credit_cad" numeric(20, 6) NOT NULL,
	"withholding_cad" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "income_events_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "income_events_dividend_class_check" CHECK (dividend_class IN ('eligible', 'non_eligible', 'foreign'))
);
--> statement-breakpoint
CREATE TABLE "manual_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"acb_cad" numeric(20, 6) NOT NULL,
	"as_of_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_adjustments_user_security_key" UNIQUE("user_id","security_id"),
	CONSTRAINT "manual_adjustments_quantity_check" CHECK (quantity >= 0),
	CONSTRAINT "manual_adjustments_acb_check" CHECK (acb_cad >= 0)
);
--> statement-breakpoint
CREATE TABLE "realized_gains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"disposition_date" date NOT NULL,
	"tax_year" smallint NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"proceeds_cad" numeric(20, 6) NOT NULL,
	"acb_cad" numeric(20, 6) NOT NULL,
	"fees_cad" numeric(20, 6) NOT NULL,
	"gain_cad" numeric(20, 6) NOT NULL,
	"denied_loss_cad" numeric(20, 6) DEFAULT '0' NOT NULL,
	"allowed_gain_cad" numeric(20, 6) NOT NULL,
	"incomplete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "realized_gains_transaction_kind_key" UNIQUE("transaction_id","kind"),
	CONSTRAINT "realized_gains_kind_check" CHECK (kind IN ('sale', 'roc_excess'))
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snaptrade_symbol_id" text,
	"symbol" text NOT NULL,
	"exchange" text,
	"name" text,
	"currency" text NOT NULL,
	"security_type" text DEFAULT 'equity' NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_snaptrade_symbol_id_unique" UNIQUE("snaptrade_symbol_id"),
	CONSTRAINT "securities_symbol_exchange_currency_key" UNIQUE NULLS NOT DISTINCT("symbol","exchange","currency"),
	CONSTRAINT "securities_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "securities_security_type_check" CHECK (security_type IN ('equity', 'etf', 'mutual_fund', 'bond', 'option', 'crypto', 'other'))
);
--> statement-breakpoint
CREATE TABLE "snaptrade_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"snaptrade_user_id" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"secret_tag" "bytea" NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snaptrade_users_snaptrade_user_id_unique" UNIQUE("snaptrade_user_id"),
	CONSTRAINT "snaptrade_users_secret_iv_check" CHECK (octet_length(secret_iv) = 12),
	CONSTRAINT "snaptrade_users_secret_tag_check" CHECK (octet_length(secret_tag) = 16)
);
--> statement-breakpoint
CREATE TABLE "superficial_loss_replacements" (
	"superficial_loss_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"denied_cad" numeric(20, 6) NOT NULL,
	"disposition" text NOT NULL,
	CONSTRAINT "superficial_loss_replacements_pkey" PRIMARY KEY("superficial_loss_id","transaction_id"),
	CONSTRAINT "slr_account_type_check" CHECK (account_type IN ('non_registered', 'tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira')),
	CONSTRAINT "slr_disposition_check" CHECK (disposition IN ('added_to_acb', 'lost_forever'))
);
--> statement-breakpoint
CREATE TABLE "superficial_losses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sale_transaction_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"tax_year" smallint NOT NULL,
	"status" text NOT NULL,
	"quantity_sold" numeric(28, 10) NOT NULL,
	"quantity_denied" numeric(28, 10) NOT NULL,
	"total_loss_cad" numeric(20, 6) NOT NULL,
	"denied_loss_cad" numeric(20, 6) NOT NULL,
	"allowed_loss_cad" numeric(20, 6) NOT NULL,
	"lost_forever_cad" numeric(20, 6) DEFAULT '0' NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	CONSTRAINT "superficial_losses_sale_transaction_id_unique" UNIQUE("sale_transaction_id"),
	CONSTRAINT "superficial_losses_status_check" CHECK (status IN ('final', 'pending')),
	CONSTRAINT "superficial_losses_window_check" CHECK (window_end > window_start)
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"stats" jsonb,
	CONSTRAINT "sync_runs_trigger_check" CHECK (trigger IN ('connect', 'manual', 'cron', 'demo_reset')),
	CONSTRAINT "sync_runs_status_check" CHECK (status IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "sync_runs_finished_check" CHECK ((status = 'running') = (finished_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tax_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"security_id" uuid,
	"transaction_id" uuid,
	"tax_year" smallint,
	"shortfall_quantity" numeric(28, 10),
	"amount_cad" numeric(20, 6),
	"due_date" date,
	CONSTRAINT "tax_warnings_type_check" CHECK (type IN ('opening_balance_needed', 'superficial_loss_lost_forever', 'superficial_loss_pending', 'unsupported_transfer', 'roc_without_position', 'split_reported_twice', 'assumed_year_config')),
	CONSTRAINT "tax_warnings_subject_check" CHECK (CASE WHEN type = 'assumed_year_config' THEN tax_year IS NOT NULL
               ELSE security_id IS NOT NULL AND transaction_id IS NOT NULL END)
);
--> statement-breakpoint
CREATE TABLE "tax_year_summaries" (
	"user_id" text NOT NULL,
	"tax_year" smallint NOT NULL,
	"proceeds_cad" numeric(20, 6) NOT NULL,
	"acb_cad" numeric(20, 6) NOT NULL,
	"fees_cad" numeric(20, 6) NOT NULL,
	"net_capital_gain_cad" numeric(20, 6) NOT NULL,
	"denied_losses_cad" numeric(20, 6) NOT NULL,
	"inclusion_rate" numeric(6, 5) NOT NULL,
	"taxable_capital_gain_cad" numeric(20, 6) NOT NULL,
	"eligible_dividends_cad" numeric(20, 6) NOT NULL,
	"non_eligible_dividends_cad" numeric(20, 6) NOT NULL,
	"foreign_income_cad" numeric(20, 6) NOT NULL,
	"foreign_withholding_cad" numeric(20, 6) NOT NULL,
	"federal_dividend_credit_cad" numeric(20, 6) NOT NULL,
	"estimated_tax_cad" numeric(20, 6),
	"config_assumed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tax_year_summaries_pkey" PRIMARY KEY("user_id","tax_year")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid,
	"snaptrade_activity_id" text NOT NULL,
	"kind" text NOT NULL,
	"trade_date" date NOT NULL,
	"settlement_date" date NOT NULL,
	"currency" text NOT NULL,
	"quantity" numeric(28, 10) DEFAULT '0' NOT NULL,
	"price" numeric(20, 6) DEFAULT '0' NOT NULL,
	"fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"split_ratio" numeric(20, 10),
	"dividend_class" text,
	"withholding_tax" numeric(20, 6),
	"description" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_account_activity_key" UNIQUE("account_id","snaptrade_activity_id"),
	CONSTRAINT "transactions_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_kind_check" CHECK (kind IN ('buy', 'sell', 'drip', 'dividend', 'roc', 'split', 'fee', 'transfer_in', 'transfer_out')),
	CONSTRAINT "transactions_dividend_class_check" CHECK (dividend_class IN ('eligible', 'non_eligible', 'foreign')),
	CONSTRAINT "transactions_quantity_check" CHECK (quantity >= 0),
	CONSTRAINT "transactions_price_check" CHECK (price >= 0),
	CONSTRAINT "transactions_fees_check" CHECK (fees >= 0),
	CONSTRAINT "transactions_split_ratio_check" CHECK (split_ratio IS NULL OR split_ratio > 0),
	CONSTRAINT "transactions_withholding_check" CHECK (withholding_tax IS NULL OR withholding_tax >= 0),
	CONSTRAINT "transactions_dates_check" CHECK (settlement_date >= trade_date),
	CONSTRAINT "transactions_split_needs_ratio" CHECK (kind <> 'split' OR split_ratio IS NOT NULL),
	CONSTRAINT "transactions_dividend_needs_class" CHECK (kind <> 'dividend' OR dividend_class IS NOT NULL),
	CONSTRAINT "transactions_needs_security" CHECK (kind = 'fee' OR security_id IS NOT NULL),
	CONSTRAINT "transactions_trade_needs_quantity" CHECK (kind NOT IN ('buy', 'sell', 'drip') OR quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"marginal_rate" numeric(6, 5),
	"last_synced_at" timestamp with time zone,
	"last_recomputed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_marginal_rate_check" CHECK (marginal_rate IS NULL OR (marginal_rate >= 0 AND marginal_rate < 1))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase_check" CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_manual_adjustment_id_manual_adjustments_id_fk" FOREIGN KEY ("manual_adjustment_id") REFERENCES "public"."manual_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_positions" ADD CONSTRAINT "acb_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_positions" ADD CONSTRAINT "acb_positions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_connection_fkey" FOREIGN KEY ("connection_id","user_id") REFERENCES "public"."connections"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_opportunities" ADD CONSTRAINT "harvest_opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_opportunities" ADD CONSTRAINT "harvest_opportunities_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaptrade_users" ADD CONSTRAINT "snaptrade_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "superficial_loss_replacements_superficial_loss_id_superficial_losses_id_fk" FOREIGN KEY ("superficial_loss_id") REFERENCES "public"."superficial_losses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "superficial_loss_replacements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "superficial_loss_replacements_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_losses" ADD CONSTRAINT "superficial_losses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_losses" ADD CONSTRAINT "superficial_losses_sale_transaction_id_transactions_id_fk" FOREIGN KEY ("sale_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_losses" ADD CONSTRAINT "superficial_losses_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_warnings" ADD CONSTRAINT "tax_warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_warnings" ADD CONSTRAINT "tax_warnings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_warnings" ADD CONSTRAINT "tax_warnings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_year_summaries" ADD CONSTRAINT "tax_year_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_acb_events_security" ON "acb_events" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_acb_events_transaction" ON "acb_events" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_acb_events_manual" ON "acb_events" USING btree ("manual_adjustment_id");--> statement-breakpoint
CREATE INDEX "idx_acb_positions_security" ON "acb_positions" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_account_balances_user" ON "account_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_brokerage_accounts_connection" ON "brokerage_accounts" USING btree ("connection_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_brokerage_accounts_user" ON "brokerage_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_connections_user" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_harvest_opportunities_security" ON "harvest_opportunities" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_holdings_user" ON "holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_holdings_security" ON "holdings" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_income_events_user_year" ON "income_events" USING btree ("user_id","tax_year","paid_date");--> statement-breakpoint
CREATE INDEX "idx_income_events_security" ON "income_events" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_income_events_account" ON "income_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_manual_adjustments_security" ON "manual_adjustments" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_realized_gains_user_year" ON "realized_gains" USING btree ("user_id","tax_year","disposition_date");--> statement-breakpoint
CREATE INDEX "idx_realized_gains_security" ON "realized_gains" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_realized_gains_account" ON "realized_gains" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_slr_transaction" ON "superficial_loss_replacements" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_slr_account" ON "superficial_loss_replacements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_superficial_losses_user_year" ON "superficial_losses" USING btree ("user_id","tax_year");--> statement-breakpoint
CREATE INDEX "idx_superficial_losses_pending" ON "superficial_losses" USING btree ("user_id","window_end") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "idx_superficial_losses_security" ON "superficial_losses" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_user_started" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_running_key" ON "sync_runs" USING btree ("user_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "idx_tax_warnings_user" ON "tax_warnings" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_tax_warnings_security" ON "tax_warnings" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_tax_warnings_transaction" ON "tax_warnings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_user_security_date" ON "transactions" USING btree ("user_id","security_id","settlement_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_account_date" ON "transactions" USING btree ("account_id","settlement_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_transactions_security" ON "transactions" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_one_demo_key" ON "user_profiles" USING btree ("is_demo") WHERE is_demo;--> statement-breakpoint
CREATE INDEX "idx_accounts_user" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_verifications_identifier" ON "verifications" USING btree ("identifier");