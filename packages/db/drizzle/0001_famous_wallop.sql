CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"total_budget_ils" numeric(12, 2),
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"exclude_from_monthly_totals" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "purpose" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "is_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "transfer_pair_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_household_id_index" ON "project" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "project_household_id_status_index" ON "project" USING btree ("household_id","status");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_pair_id_transaction_id_fk" FOREIGN KEY ("transfer_pair_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_household_id_purpose_index" ON "account" USING btree ("household_id","purpose");--> statement-breakpoint
CREATE INDEX "transaction_household_id_project_id_index" ON "transaction" USING btree ("household_id","project_id");--> statement-breakpoint
CREATE INDEX "transaction_household_id_is_transfer_index" ON "transaction" USING btree ("household_id","is_transfer");