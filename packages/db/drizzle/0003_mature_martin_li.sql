ALTER TABLE "account" ADD COLUMN "payment_schedule" text DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "charge_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rule" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "category_rule" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "category_rule" ADD COLUMN "min_amount_ils" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "category_rule" ADD COLUMN "max_amount_ils" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "category_rule" ADD COLUMN "last_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "charge_date" date;