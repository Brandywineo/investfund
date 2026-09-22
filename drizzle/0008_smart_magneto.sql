ALTER TYPE "public"."treasury_transfer_status" ADD VALUE 'PROCESSING' BEFORE 'BROADCAST';--> statement-breakpoint
ALTER TABLE "custody_settings" ADD COLUMN "minimum_withdrawal_amount" numeric(20, 8) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "direction" text DEFAULT 'OUTBOUND' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "reason" text DEFAULT 'Legacy treasury transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "signed_transaction" text;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "chain_nonce" integer;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_balance", "currency")
VALUES ('PLATFORM:TRADING_PROFIT', 'Realized MT5 trading profit', 'REVENUE', 'CREDIT', 'USDT')
ON CONFLICT ("code") DO NOTHING;
