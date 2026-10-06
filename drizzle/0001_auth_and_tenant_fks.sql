-- Hand-ordered: the (id, user_id) keys must exist before the composite foreign keys that reference
-- them, and the new replacements.user_id is backfilled from its loss before it becomes NOT NULL.
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "superficial_losses" ADD CONSTRAINT "superficial_losses_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "acb_events" DROP CONSTRAINT "acb_events_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "acb_events" DROP CONSTRAINT "acb_events_manual_adjustment_id_manual_adjustments_id_fk";
--> statement-breakpoint
ALTER TABLE "income_events" DROP CONSTRAINT "income_events_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "income_events" DROP CONSTRAINT "income_events_account_id_brokerage_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "realized_gains" DROP CONSTRAINT "realized_gains_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "realized_gains" DROP CONSTRAINT "realized_gains_account_id_brokerage_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" DROP CONSTRAINT "superficial_loss_replacements_superficial_loss_id_superficial_losses_id_fk";
--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" DROP CONSTRAINT "superficial_loss_replacements_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" DROP CONSTRAINT "superficial_loss_replacements_account_id_brokerage_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "superficial_losses" DROP CONSTRAINT "superficial_losses_sale_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "tax_warnings" DROP CONSTRAINT "tax_warnings_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "superficial_loss_replacements" AS r SET "user_id" = l."user_id" FROM "superficial_losses" AS l WHERE l."id" = r."superficial_loss_id";--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_transaction_fkey" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acb_events" ADD CONSTRAINT "acb_events_manual_adjustment_fkey" FOREIGN KEY ("manual_adjustment_id","user_id") REFERENCES "public"."manual_adjustments"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_transaction_fkey" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_transaction_fkey" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_gains" ADD CONSTRAINT "realized_gains_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "slr_superficial_loss_fkey" FOREIGN KEY ("superficial_loss_id","user_id") REFERENCES "public"."superficial_losses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "slr_transaction_fkey" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "slr_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superficial_losses" ADD CONSTRAINT "superficial_losses_sale_transaction_fkey" FOREIGN KEY ("sale_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_warnings" ADD CONSTRAINT "tax_warnings_transaction_fkey" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE cascade ON UPDATE no action;
