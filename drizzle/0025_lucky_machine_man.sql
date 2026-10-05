ALTER TABLE "admin_alert_settings" ADD COLUMN "admin_push_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_alert_settings" ADD COLUMN "notify_withdrawal_requests" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
INSERT INTO "admin_alert_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
