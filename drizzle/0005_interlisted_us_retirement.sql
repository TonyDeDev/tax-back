CREATE TABLE "security_preferences" (
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"pool_security_id" uuid,
	"dividend_class" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_preferences_pkey" PRIMARY KEY("user_id","security_id"),
	CONSTRAINT "security_preferences_dividend_class_check" CHECK (dividend_class IN ('eligible', 'non_eligible', 'foreign'))
);
--> statement-breakpoint
ALTER TABLE "brokerage_accounts" DROP CONSTRAINT "brokerage_accounts_account_type_check";--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" DROP CONSTRAINT "slr_account_type_check";--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "figi_share_class" text;--> statement-breakpoint
ALTER TABLE "security_preferences" ADD CONSTRAINT "security_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_preferences" ADD CONSTRAINT "security_preferences_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_preferences" ADD CONSTRAINT "security_preferences_pool_security_id_securities_id_fk" FOREIGN KEY ("pool_security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_security_preferences_security" ON "security_preferences" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_security_preferences_pool" ON "security_preferences" USING btree ("pool_security_id");--> statement-breakpoint
CREATE INDEX "idx_securities_figi_share_class" ON "securities" USING btree ("figi_share_class");--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_account_type_check" CHECK (account_type IN ('non_registered', 'tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira', 'us_retirement'));--> statement-breakpoint
ALTER TABLE "superficial_loss_replacements" ADD CONSTRAINT "slr_account_type_check" CHECK (account_type IN ('non_registered', 'tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira', 'us_retirement'));