ALTER TABLE "transaction" ADD COLUMN "applied_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "category_source" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_applied_rule_id_category_rule_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."category_rule"("id") ON DELETE set null ON UPDATE no action;