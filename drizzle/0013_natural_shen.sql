ALTER TABLE "deposits" ADD COLUMN "source" text DEFAULT 'AUTOMATIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "received_into" text DEFAULT 'HOT_WALLET' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposit_source_valid" CHECK ("deposits"."source" in ('AUTOMATIC', 'USER_SUBMITTED', 'ADMIN_RECORDED'));--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposit_received_into_valid" CHECK ("deposits"."received_into" in ('HOT_WALLET', 'ADMIN_CUSTODY'));
--> statement-breakpoint
INSERT INTO "ledger_accounts" (
  "code", "name", "type", "normal_balance", "currency"
) VALUES (
  'PLATFORM:ADMIN_CUSTODY',
  'Administrator-controlled custody',
  'ASSET',
  'DEBIT',
  'USDT'
)
ON CONFLICT ("code") DO NOTHING;
