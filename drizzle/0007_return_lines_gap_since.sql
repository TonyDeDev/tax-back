ALTER TABLE "position_reconciliations" ADD COLUMN "gap_since" date;--> statement-breakpoint
ALTER TABLE "tax_year_summaries" ADD COLUMN "eligible_taxable_cad" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_year_summaries" ADD COLUMN "non_eligible_taxable_cad" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Backfill the new totals from the stored income events, so results are right before the next recompute.
UPDATE "tax_year_summaries" t SET
	"eligible_taxable_cad" = COALESCE((SELECT sum(i."grossed_up_cad") FROM "income_events" i WHERE i."user_id" = t."user_id" AND i."tax_year" = t."tax_year" AND i."dividend_class" = 'eligible'), 0),
	"non_eligible_taxable_cad" = COALESCE((SELECT sum(i."grossed_up_cad") FROM "income_events" i WHERE i."user_id" = t."user_id" AND i."tax_year" = t."tax_year" AND i."dividend_class" = 'non_eligible'), 0);
