CREATE TYPE "public"."admin_alert_delivery_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TABLE "admin_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"channel" text DEFAULT 'WHATSAPP' NOT NULL,
	"category" text NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "admin_alert_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_alert_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"whatsapp_recipient" text,
	"notify_user_sweeps" boolean DEFAULT true NOT NULL,
	"notify_direct_hot_deposits" boolean DEFAULT true NOT NULL,
	"minimum_alert_amount" numeric(20, 8) DEFAULT '0.10' NOT NULL,
	"updated_by" uuid,
	"last_successful_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "support_email" text DEFAULT 'support@investfund.site' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "support_email_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_alert_settings" ADD CONSTRAINT "admin_alert_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_alert_deliveries_event_unique" ON "admin_alert_deliveries" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "admin_alert_deliveries_status_next_idx" ON "admin_alert_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "admin_alert_deliveries_created_idx" ON "admin_alert_deliveries" USING btree ("created_at");