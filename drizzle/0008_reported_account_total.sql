ALTER TABLE "brokerage_accounts" ADD COLUMN "reported_total" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD COLUMN "reported_total_currency" text;--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD COLUMN "holdings_unreported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_reported_total_currency_check" CHECK (reported_total_currency ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_reported_total_check" CHECK ((reported_total IS NULL) = (reported_total_currency IS NULL) AND (NOT holdings_unreported OR reported_total IS NOT NULL));