CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'running', 'paused', 'stopped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('queued', 'claimed', 'sent', 'delivered', 'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'mapping', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('gmail', 'outlook', 'yahoo', 'other_free', 'company', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('pending', 'processing', 'sent', 'delivered', 'bounced', 'failed', 'unknown', 'excluded', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('broker', 'agency');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('manual', 'unsubscribe', 'hard_bounce', 'repeated_soft_bounce', 'complaint', 'invalid_address');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('valid', 'invalid', 'risky', 'unknown');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_identity_id" bigint NOT NULL,
	"office_number" text,
	"name_en" text,
	"name_ar" text,
	"website" text,
	"phone" text,
	"import_batch_id" integer,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brokers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_identity_id" bigint NOT NULL,
	"broker_number" text,
	"name_en" text,
	"name_ar" text,
	"office_name_en" text,
	"office_name_ar" text,
	"phone" text,
	"import_batch_id" integer,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"email_identity_id" bigint NOT NULL,
	"status" "recipient_status" DEFAULT 'pending' NOT NULL,
	"merge_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"message_id" text,
	"smtp_queue_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_smtp_code" text,
	"last_error" text,
	"unsub_token" text
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"template_id" integer,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"send_window_start" text DEFAULT '08:00' NOT NULL,
	"send_window_end" text DEFAULT '18:00' NOT NULL,
	"send_days" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"exclude_previously_contacted" boolean DEFAULT true NOT NULL,
	"max_bounce_rate" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"max_failure_rate" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_sending_usage" (
	"usage_date" date NOT NULL,
	"campaign_id" integer NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_sending_usage_usage_date_campaign_id_pk" PRIMARY KEY("usage_date","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "email_identities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_raw" text NOT NULL,
	"email_normalized" text NOT NULL,
	"local_part" text NOT NULL,
	"domain" text NOT NULL,
	"provider_type" "provider_type" DEFAULT 'unknown' NOT NULL,
	"is_role_account" boolean DEFAULT false NOT NULL,
	"has_mx" boolean,
	"mx_checked_at" timestamp with time zone,
	"verification_status" "verification_status",
	"verified_at" timestamp with time zone,
	"is_suppressed" boolean DEFAULT false NOT NULL,
	"contacted_count" integer DEFAULT 0 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"encoding" text,
	"column_map" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"unique_emails" integer DEFAULT 0 NOT NULL,
	"new_emails" integer DEFAULT 0 NOT NULL,
	"existing_emails" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"blank_email_rows" integer DEFAULT 0 NOT NULL,
	"storage_path" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_row_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_batch_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"reason" text NOT NULL,
	"raw_row" jsonb
);
--> statement-breakpoint
CREATE TABLE "sending_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_recipient_id" bigint,
	"campaign_id" integer,
	"email_identity_id" bigint,
	"event_type" "event_type" NOT NULL,
	"smtp_code" text,
	"smtp_response" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_normalized" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"note" text,
	"source_campaign_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"required_merge_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_identity_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"status" "verification_status" NOT NULL,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_created_idx" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agencies_identity_idx" ON "agencies" USING btree ("email_identity_id");--> statement-breakpoint
CREATE INDEX "agencies_number_idx" ON "agencies" USING btree ("office_number");--> statement-breakpoint
CREATE INDEX "brokers_identity_idx" ON "brokers" USING btree ("email_identity_id");--> statement-breakpoint
CREATE INDEX "brokers_number_idx" ON "brokers" USING btree ("broker_number");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_unique" ON "campaign_recipients" USING btree ("campaign_id","email_identity_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_claim_idx" ON "campaign_recipients" USING btree ("campaign_id","status","id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_identity_idx" ON "campaign_recipients" USING btree ("email_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_token_idx" ON "campaign_recipients" USING btree ("unsub_token");--> statement-breakpoint
CREATE UNIQUE INDEX "email_identities_normalized_key" ON "email_identities" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "email_identities_domain_idx" ON "email_identities" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "email_identities_provider_idx" ON "email_identities" USING btree ("provider_type");--> statement-breakpoint
CREATE INDEX "email_identities_suppressed_idx" ON "email_identities" USING btree ("is_suppressed");--> statement-breakpoint
CREATE INDEX "email_identities_verification_idx" ON "email_identities" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "import_row_errors_batch_idx" ON "import_row_errors" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "sending_events_campaign_idx" ON "sending_events" USING btree ("campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sending_events_type_idx" ON "sending_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_email_key" ON "suppression_list" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "verification_identity_idx" ON "verification_results" USING btree ("email_identity_id");