CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"security_id" uuid NOT NULL,
	"target_security_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"currency" text NOT NULL,
	"ratio" numeric(20, 10) NOT NULL,
	"old_fmv" numeric(20, 6),
	"new_fmv" numeric(20, 6),
	"cash_per_share" numeric(20, 6) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "corporate_actions_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "corporate_actions_kind_check" CHECK (kind IN ('spinoff', 'merger')),
	CONSTRAINT "corporate_actions_ratio_check" CHECK (ratio > 0),
	CONSTRAINT "corporate_actions_cash_check" CHECK (cash_per_share >= 0),
	CONSTRAINT "corporate_actions_distinct_check" CHECK (security_id <> target_security_id),
	CONSTRAINT "corporate_actions_spinoff_fmv_check" CHECK (kind <> 'spinoff' OR (old_fmv > 0 AND new_fmv > 0)),
	CONSTRAINT "corporate_actions_merger_fmv_check" CHECK (kind <> 'merger' OR cash_per_share = 0 OR new_fmv > 0)
);
--> statement-breakpoint
CREATE TABLE "position_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"account_id" uuid,
	"ledger_quantity" numeric(28, 10) NOT NULL,
	"broker_quantity" numeric(28, 10) NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "position_reconciliations_key" UNIQUE NULLS NOT DISTINCT("user_id","security_id","account_id"),
	CONSTRAINT "position_reconciliations_status_check" CHECK (status IN ('match', 'broker_has_more', 'ledger_has_more'))
);
--> statement-breakpoint
ALTER TABLE "acb_events" DROP CONSTRAINT "acb_events_kind_check";--> statement-breakpoint
ALTER TABLE "acb_events" DROP CONSTRAINT "acb_events_one_source";--> statement-breakpoint
ALTER TABLE "realized_gains" DROP CONSTRAINT "realized_gains_kind_check";--> statement-breakpoint
ALTER TABLE "tax_warnings" DROP CONSTRAINT "tax_warnings_type_check";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_kind_check";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_trade_needs_quantity";--> statement-breakpoint
ALTER TABLE "realized_gains" ALTER COLUMN "transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "realized_gains" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
-- acb_events is a derived cache, rebuilt on every recompute. Clearing it lets "rule" be NOT NULL;
-- the next sync, Refresh, or daily cron fills it again.
DELETE FROM "acb_events";--> statement-breakpoint
ALTER TABLE "acb_events" ADD COLUMN "corporate_action_id" uuid;--> statement-breakpoint
ALTER TABLE "acb_events" ADD COLUMN "rule" text NOT NULL;--> statement-breakpoint
ALTER TABLE "acb_events" ADD COLUMN "fx_rate" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "realized_gains" ADD COLUMN "corporate_action_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_target_security_id_securities_id_fk" FOREIGN KEY ("target_security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reconciliations" ADD CONSTRAINT "position_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reconciliations" ADD CONSTRAINT "position_reconciliations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_reconciliations" ADD CONSTRAINT "position_reconciliations_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_corporate_actions_user" ON "corporate_actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_corporate_actions_security" ON "corporate_actions" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_corporate_actions_target" ON "corporate_actions" USING btree ("target_security_id");--> statement-breakpoint
CREATE INDEX "idx_position_reconciliations_security" ON "position_reconciliations" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_position_reconciliations_account" ON "position_reconciliations" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_corporate_action_fkey" FOREIGN KEY ("corporate_action_id","user_id") REFERENCES "public"."corporate_actions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_corporate_action_fkey" FOREIGN KEY ("corporate_action_id","user_id") REFERENCES "public"."corporate_actions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_acb_events_corporate_action" ON "acb_events" USING btree ("corporate_action_id");--> statement-breakpoint
CREATE INDEX "idx_realized_gains_corporate_action" ON "realized_gains" USING btree ("corporate_action_id");--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_rule_check" CHECK (rule IN ('opening_balance', 'buy_cost_plus_commission', 'drip_reinvested', 'stock_dividend_value', 'sell_average_cost', 'roc_reduces_acb', 'roc_floors_at_zero', 'split_quantity_only', 'superficial_loss_added', 'transfer_to_registered_deemed_sale', 'transfer_from_registered_at_fmv', 'spinoff_acb_to_child', 'spinoff_acb_from_parent', 'merger_rollover_out', 'merger_rollover_in'));--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_kind_check" CHECK (kind IN ('buy', 'sell', 'drip', 'dividend', 'roc', 'split', 'fee', 'transfer_in', 'transfer_out', 'stock_dividend', 'spinoff', 'merger', 'opening', 'superficial_adjustment'));--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_one_source" CHECK (num_nonnulls(transaction_id, manual_adjustment_id, corporate_action_id) = 1);--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_one_source" CHECK (num_nonnulls(transaction_id, corporate_action_id) = 1);--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_kind_check" CHECK (kind IN ('sale', 'roc_excess', 'deemed_disposition', 'merger_cash'));--> statement-breakpoint
ALTER TABLE "tax_warnings" ADD CONSTRAINT "tax_warnings_type_check" CHECK (type IN ('opening_balance_needed', 'superficial_loss_lost_forever', 'superficial_loss_pending', 'unsupported_transfer', 'transfer_unmatched', 'transfer_value_missing', 'registered_transfer_loss_denied', 'roc_without_position', 'split_reported_twice', 'assumed_year_config'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_kind_check" CHECK (kind IN ('buy', 'sell', 'drip', 'dividend', 'roc', 'split', 'fee', 'transfer_in', 'transfer_out', 'stock_dividend'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_trade_needs_quantity" CHECK (kind NOT IN ('buy', 'sell', 'drip', 'stock_dividend', 'transfer_in', 'transfer_out') OR quantity > 0);