CREATE TABLE "contribution_flow_results" (
	"flow_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text,
	"kind" text NOT NULL,
	"tax_year" smallint NOT NULL,
	"amount_cad" numeric(20, 6) NOT NULL,
	"fx_rate" numeric(20, 10),
	"needs_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "contribution_flow_results_plan_check" CHECK (plan IN ('tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira', 'us_retirement')),
	CONSTRAINT "contribution_flow_results_kind_check" CHECK (kind IN ('contribution', 'withdrawal', 'transfer', 'rrsp_to_fhsa', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "contribution_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"account_id" uuid,
	"plan" text,
	"snaptrade_activity_id" text,
	"broker_type" text,
	"flow_date" date NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"description" text,
	"classification" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_flows_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "contribution_flows_account_activity_key" UNIQUE("account_id","snaptrade_activity_id"),
	CONSTRAINT "contribution_flows_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "contribution_flows_source_check" CHECK (source IN ('snaptrade', 'manual')),
	CONSTRAINT "contribution_flows_direction_check" CHECK (direction IN ('in', 'out')),
	CONSTRAINT "contribution_flows_plan_check" CHECK (plan IN ('tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira', 'us_retirement')),
	CONSTRAINT "contribution_flows_classification_check" CHECK (classification IN ('contribution', 'withdrawal', 'transfer', 'rrsp_to_fhsa', 'ignore')),
	CONSTRAINT "contribution_flows_amount_check" CHECK (amount > 0),
	CONSTRAINT "contribution_flows_source_fields_check" CHECK (CASE WHEN source = 'snaptrade' THEN account_id IS NOT NULL AND snaptrade_activity_id IS NOT NULL AND plan IS NULL
               ELSE account_id IS NULL AND snaptrade_activity_id IS NULL AND plan IS NOT NULL END)
);
--> statement-breakpoint
CREATE TABLE "contribution_inputs" (
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"tax_year" smallint NOT NULL,
	"official_room_cad" numeric(20, 6),
	"unused_carried_forward_cad" numeric(20, 6),
	"earned_income_prior_year_cad" numeric(20, 6),
	"pension_adjustment_cad" numeric(20, 6),
	"deduction_claimed_cad" numeric(20, 6),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_inputs_pkey" PRIMARY KEY("user_id","plan","tax_year"),
	CONSTRAINT "contribution_inputs_plan_check" CHECK (plan IN ('tfsa', 'rrsp', 'fhsa')),
	CONSTRAINT "contribution_inputs_amounts_check" CHECK (coalesce(unused_carried_forward_cad, 0) >= 0 AND coalesce(earned_income_prior_year_cad, 0) >= 0
          AND coalesce(pension_adjustment_cad, 0) >= 0 AND coalesce(deduction_claimed_cad, 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "contribution_summaries" (
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"tax_year" smallint NOT NULL,
	"room_source" text,
	"estimate_incomplete" boolean DEFAULT false NOT NULL,
	"limit_assumed" boolean DEFAULT false NOT NULL,
	"contributions_cad" numeric(20, 6) NOT NULL,
	"withdrawals_cad" numeric(20, 6) NOT NULL,
	"peak_excess_cad" numeric(20, 6) DEFAULT '0' NOT NULL,
	"penalty_cad" numeric(20, 6) DEFAULT '0' NOT NULL,
	"opening_room_cad" numeric(20, 6),
	"room_remaining_cad" numeric(20, 6),
	"restored_next_year_cad" numeric(20, 6),
	"unused_from_prior_cad" numeric(20, 6),
	"period_one_cad" numeric(20, 6),
	"period_two_cad" numeric(20, 6),
	"deadline" date,
	"deduction_limit_cad" numeric(20, 6),
	"max_deduction_cad" numeric(20, 6),
	"deduction_cad" numeric(20, 6),
	"carry_forward_cad" numeric(20, 6),
	"unused_room_cad" numeric(20, 6),
	"first_year" boolean DEFAULT false NOT NULL,
	"participation_room_cad" numeric(20, 6),
	"carryforward_in_cad" numeric(20, 6),
	"rrsp_transfers_cad" numeric(20, 6),
	"annual_limit_cad" numeric(20, 6),
	"lifetime_used_cad" numeric(20, 6),
	CONSTRAINT "contribution_summaries_pkey" PRIMARY KEY("user_id","plan","tax_year"),
	CONSTRAINT "contribution_summaries_plan_check" CHECK (plan IN ('tfsa', 'rrsp', 'fhsa', 'resp', 'rrif', 'lira', 'us_retirement')),
	CONSTRAINT "contribution_summaries_room_source_check" CHECK (room_source IN ('cra', 'estimate', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "resident_since_year" smallint;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "fhsa_opened_year" smallint;--> statement-breakpoint
ALTER TABLE "contribution_flow_results" ADD CONSTRAINT "contribution_flow_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_flow_results" ADD CONSTRAINT "contribution_flow_results_flow_fkey" FOREIGN KEY ("flow_id","user_id") REFERENCES "public"."contribution_flows"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_flows" ADD CONSTRAINT "contribution_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_flows" ADD CONSTRAINT "contribution_flows_account_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."brokerage_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_inputs" ADD CONSTRAINT "contribution_inputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_summaries" ADD CONSTRAINT "contribution_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contribution_flow_results_user_year" ON "contribution_flow_results" USING btree ("user_id","tax_year");--> statement-breakpoint
CREATE INDEX "idx_contribution_flows_user_date" ON "contribution_flows" USING btree ("user_id","flow_date");--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_birth_year_check" CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_resident_since_check" CHECK (resident_since_year IS NULL OR resident_since_year BETWEEN 1900 AND 2100);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_fhsa_opened_check" CHECK (fhsa_opened_year IS NULL OR fhsa_opened_year BETWEEN 2023 AND 2100);