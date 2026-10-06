-- Sign in with SnapTrade (OAuth) replaces the Commercial registerUser flow, so no userSecret is stored.
-- SnapTrade ids become unique per user rather than globally (an OAuth connection can be shared), and the
-- new (user_id, ...) keys replace the plain user_id indexes. New keys are added before the old ones go.
DROP TABLE "snaptrade_users" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_key" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_authorization_key" UNIQUE("user_id","snaptrade_authorization_id");--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_user_snaptrade_key" UNIQUE("user_id","snaptrade_account_id");--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_snaptrade_authorization_id_unique";--> statement-breakpoint
ALTER TABLE "brokerage_accounts" DROP CONSTRAINT "brokerage_accounts_snaptrade_account_id_unique";--> statement-breakpoint
DROP INDEX "idx_connections_user";--> statement-breakpoint
DROP INDEX "idx_brokerage_accounts_user";
