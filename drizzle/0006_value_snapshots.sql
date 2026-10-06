CREATE TABLE "account_value_snapshots" (
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"value_cad" numeric(20, 6) NOT NULL,
	CONSTRAINT "account_value_snapshots_pkey" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
CREATE TABLE "security_price_snapshots" (
	"user_id" text NOT NULL,
	"security_id" uuid NOT NULL,
	"day" date NOT NULL,
	"price_cad" numeric(20, 6) NOT NULL,
	CONSTRAINT "security_price_snapshots_pkey" PRIMARY KEY("user_id","security_id","day"),
	CONSTRAINT "security_price_snapshots_price_check" CHECK (price_cad >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_value_snapshots" ADD CONSTRAINT "account_value_snapshots_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price_snapshots" ADD CONSTRAINT "security_price_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_price_snapshots" ADD CONSTRAINT "security_price_snapshots_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_value_snapshots_user_day" ON "account_value_snapshots" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "idx_security_price_snapshots_security" ON "security_price_snapshots" USING btree ("security_id");