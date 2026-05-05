CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_cutoff_day" text DEFAULT '10' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'he' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"institution" text NOT NULL,
	"scraper_provider" text,
	"encrypted_credentials" text,
	"cutoff_day" integer DEFAULT 10 NOT NULL,
	"account_number_masked" text,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"last_scrape_status" text DEFAULT 'never' NOT NULL,
	"last_scrape_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text,
	"parent_id" uuid,
	"icon" text,
	"color" text,
	"monthly_target_ils" numeric(10, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_income" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"pattern" text NOT NULL,
	"applies_to_account_id" uuid,
	"category_id" uuid NOT NULL,
	"sub_category_id" uuid,
	"source" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "installment_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"merchant_normalized" text NOT NULL,
	"description" text,
	"total_payments" integer,
	"payment_amount_ils" numeric(10, 2) NOT NULL,
	"current_payment_no" integer DEFAULT 1 NOT NULL,
	"start_month" text NOT NULL,
	"projected_end_month" text,
	"actual_end_month" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_pattern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_normalized" text NOT NULL,
	"category_id" uuid,
	"expected_amount_ils" numeric(10, 2) NOT NULL,
	"median_amount_ils" numeric(10, 2) NOT NULL,
	"tolerance_pct" integer DEFAULT 10 NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_month" text NOT NULL,
	"last_seen_month" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_pattern_householdId_merchantNormalized_unique" UNIQUE("household_id","merchant_normalized")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text,
	"transaction_date" date NOT NULL,
	"posted_date" date,
	"billing_month" text NOT NULL,
	"amount_ils" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"original_amount" numeric(10, 2),
	"original_currency" text,
	"merchant_raw" text NOT NULL,
	"merchant_normalized" text NOT NULL,
	"category_id" uuid,
	"sub_category_id" uuid,
	"installment_plan_id" uuid,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"is_installment" boolean DEFAULT false NOT NULL,
	"is_projected" boolean DEFAULT false NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"notes" text,
	"raw_source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transaction_accountId_externalId_unique" UNIQUE("account_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"transaction_id" uuid,
	"merchant_normalized" text NOT NULL,
	"amount_ils" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_category_id" uuid,
	"response_sub_category_id" uuid,
	"confidence" text,
	"model" text NOT NULL,
	"tokens_in" text,
	"tokens_out" text,
	"duration_ms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "undo_stack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content_encrypted" text NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_tool_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"args_json" jsonb NOT NULL,
	"result_summary" text,
	"rows_returned" integer,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomaly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"summary_he" text NOT NULL,
	"detail_json" jsonb NOT NULL,
	"related_transaction_ids" jsonb,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"total_income_ils" numeric(12, 2) NOT NULL,
	"total_spent_ils" numeric(12, 2) NOT NULL,
	"net_ils" numeric(12, 2) NOT NULL,
	"by_category_json" jsonb NOT NULL,
	"by_account_json" jsonb NOT NULL,
	"predicted_eom_balance_ils" numeric(12, 2),
	"anomalies_json" jsonb,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_snapshot_householdId_yearMonth_unique" UNIQUE("household_id","year_month")
);
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_applies_to_account_id_account_id_fk" FOREIGN KEY ("applies_to_account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_sub_category_id_category_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pattern" ADD CONSTRAINT "recurring_pattern_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pattern" ADD CONSTRAINT "recurring_pattern_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_sub_category_id_category_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_installment_plan_id_installment_plan_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_log" ADD CONSTRAINT "categorization_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_stack" ADD CONSTRAINT "undo_stack_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undo_stack" ADD CONSTRAINT "undo_stack_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_session_id_chat_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_call_log" ADD CONSTRAINT "chat_tool_call_log_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_snapshot" ADD CONSTRAINT "monthly_snapshot_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_index" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_household_id_index" ON "user" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "account_household_id_index" ON "account" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "account_household_id_is_active_index" ON "account" USING btree ("household_id","is_active");--> statement-breakpoint
CREATE INDEX "category_household_id_index" ON "category" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "category_parent_id_index" ON "category" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "category_rule_household_id_is_active_priority_index" ON "category_rule" USING btree ("household_id","is_active","priority");--> statement-breakpoint
CREATE INDEX "category_rule_household_id_source_index" ON "category_rule" USING btree ("household_id","source");--> statement-breakpoint
CREATE INDEX "installment_plan_household_id_index" ON "installment_plan" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "installment_plan_household_id_status_index" ON "installment_plan" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "recurring_pattern_household_id_index" ON "recurring_pattern" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transaction_household_id_index" ON "transaction" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transaction_account_id_transaction_date_index" ON "transaction" USING btree ("account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transaction_household_id_billing_month_index" ON "transaction" USING btree ("household_id","billing_month");--> statement-breakpoint
CREATE INDEX "transaction_household_id_category_id_index" ON "transaction" USING btree ("household_id","category_id");--> statement-breakpoint
CREATE INDEX "transaction_household_id_merchant_normalized_index" ON "transaction" USING btree ("household_id","merchant_normalized");--> statement-breakpoint
CREATE INDEX "transaction_deleted_at_index" ON "transaction" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "audit_log_household_id_created_at_index" ON "audit_log" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_entity_id_index" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_created_at_index" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "categorization_log_household_id_created_at_index" ON "categorization_log" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "categorization_log_transaction_id_index" ON "categorization_log" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "undo_stack_user_id_expires_at_index" ON "undo_stack" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "chat_message_session_id_created_at_index" ON "chat_message" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_session_user_id_last_message_at_index" ON "chat_session" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "chat_tool_call_log_message_id_index" ON "chat_tool_call_log" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_tool_call_log_tool_name_created_at_index" ON "chat_tool_call_log" USING btree ("tool_name","created_at");--> statement-breakpoint
CREATE INDEX "anomaly_household_id_year_month_index" ON "anomaly" USING btree ("household_id","year_month");--> statement-breakpoint
CREATE INDEX "anomaly_household_id_kind_index" ON "anomaly" USING btree ("household_id","kind");--> statement-breakpoint
CREATE INDEX "monthly_snapshot_household_id_year_month_index" ON "monthly_snapshot" USING btree ("household_id","year_month");