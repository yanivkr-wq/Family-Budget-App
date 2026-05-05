CREATE TABLE "import_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"filename" text NOT NULL,
	"file_hash" text,
	"file_size" integer NOT NULL,
	"account_id" uuid,
	"source_type" text NOT NULL,
	"template_used" text,
	"billing_months" jsonb,
	"status" text DEFAULT 'committed' NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_accounts" jsonb,
	"created_categories" jsonb,
	"summary" jsonb,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "import_session_id" uuid;--> statement-breakpoint
ALTER TABLE "import_session" ADD CONSTRAINT "import_session_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_session" ADD CONSTRAINT "import_session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_session_household_id_committed_at_index" ON "import_session" USING btree ("household_id","committed_at");--> statement-breakpoint
CREATE INDEX "import_session_household_id_status_index" ON "import_session" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "import_session_household_id_file_hash_index" ON "import_session" USING btree ("household_id","file_hash");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_import_session_id_import_session_id_fk" FOREIGN KEY ("import_session_id") REFERENCES "public"."import_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_import_session_id_index" ON "transaction" USING btree ("import_session_id");