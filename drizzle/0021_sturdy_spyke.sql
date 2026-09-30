CREATE TYPE "public"."email_delivery_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."email_provider" AS ENUM('RESEND');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"category" text NOT NULL,
	"status" "email_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" "email_provider" DEFAULT 'RESEND' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"verification_required" boolean DEFAULT false NOT NULL,
	"encrypted_api_key" text,
	"api_key_last_four" text,
	"from_name" text DEFAULT 'InvestFund' NOT NULL,
	"from_address" text DEFAULT 'no-reply@investfund.site' NOT NULL,
	"reply_to_address" text,
	"verification_expiry_minutes" integer DEFAULT 1440 NOT NULL,
	"reset_expiry_minutes" integer DEFAULT 30 NOT NULL,
	"updated_by" uuid,
	"last_successful_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_status_next_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_outbox_created_idx" ON "email_outbox" USING btree ("created_at");