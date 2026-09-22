CREATE TYPE "public"."platform_transaction_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."platform_wallet_role" AS ENUM('HOT_WITHDRAWAL', 'SWEEP_GAS');--> statement-breakpoint
CREATE TABLE "platform_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_wallet_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer,
	"block_number" bigint,
	"direction" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(30, 18) NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"status" "platform_transaction_status" DEFAULT 'PENDING' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"classification" text,
	"related_type" text,
	"related_id" uuid,
	"admin_note" text,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_wallet_transaction_direction" CHECK ("platform_wallet_transactions"."direction" in ('INCOMING', 'OUTGOING')),
	CONSTRAINT "platform_wallet_transaction_amount_positive" CHECK ("platform_wallet_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "platform_wallet_role" NOT NULL,
	"address" text NOT NULL,
	"derivation_path" text NOT NULL,
	"token_balance" numeric(20, 8) DEFAULT '0' NOT NULL,
	"native_balance" numeric(30, 18) DEFAULT '0' NOT NULL,
	"balance_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_wallet_transactions" ADD CONSTRAINT "platform_wallet_transactions_platform_wallet_id_platform_wallets_id_fk" FOREIGN KEY ("platform_wallet_id") REFERENCES "public"."platform_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_wallet_transactions" ADD CONSTRAINT "platform_wallet_transactions_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallet_transactions_event_unique" ON "platform_wallet_transactions" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "platform_wallet_transactions_wallet_idx" ON "platform_wallet_transactions" USING btree ("platform_wallet_id","observed_at");--> statement-breakpoint
CREATE INDEX "platform_wallet_transactions_classification_idx" ON "platform_wallet_transactions" USING btree ("classification");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallets_role_unique" ON "platform_wallets" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallets_address_unique" ON "platform_wallets" USING btree (lower("address"));
--> statement-breakpoint
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_balance", "currency")
VALUES ('PLATFORM:CAPITAL_CONTRIBUTION', 'Platform capital contribution', 'EQUITY', 'CREDIT', 'USDT')
ON CONFLICT ("code") DO NOTHING;
