CREATE TYPE "public"."sweep_status" AS ENUM('WAITING_FINALITY', 'BELOW_THRESHOLD', 'READY', 'GAS_BROADCAST', 'SWEEP_BROADCAST', 'SWEPT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."wallet_address_status" AS ENUM('ACTIVE', 'ROTATED', 'PAUSED');--> statement-breakpoint
CREATE TABLE "chain_watcher_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"chain_id" integer NOT NULL,
	"last_scanned_block" bigint NOT NULL,
	"last_head_block" bigint,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"derivation_index" serial NOT NULL,
	"address" text NOT NULL,
	"network" text DEFAULT 'BEP20' NOT NULL,
	"status" "wallet_address_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_swept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_sweeps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"status" "sweep_status" DEFAULT 'WAITING_FINALITY' NOT NULL,
	"gas_tx_hash" text,
	"sweep_tx_hash" text,
	"failure_reason" text,
	"requested_by" uuid,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_sweep_amount_positive" CHECK ("wallet_sweeps"."amount" > 0)
);
--> statement-breakpoint
DROP INDEX "deposits_tx_hash_unique";--> statement-breakpoint
ALTER TABLE "custody_settings" ALTER COLUMN "confirmation_threshold" SET DEFAULT 1;--> statement-breakpoint
UPDATE "custody_settings" SET "confirmation_threshold" = 1;--> statement-breakpoint
ALTER TABLE "custody_settings" ADD COLUMN "chain_id" integer DEFAULT 56 NOT NULL;--> statement-breakpoint
ALTER TABLE "custody_settings" ADD COLUMN "token_contract_address" text;--> statement-breakpoint
ALTER TABLE "custody_settings" ADD COLUMN "auto_sweep_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "custody_settings" ADD COLUMN "minimum_sweep_amount" numeric(20, 8) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "wallet_address_id" uuid;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "token_contract_address" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "sender_address" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "block_number" bigint;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "log_index" integer;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "confirmations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "chain_finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "signed_transaction" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "chain_nonce" integer;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_sweeps" ADD CONSTRAINT "wallet_sweeps_wallet_address_id_wallet_addresses_id_fk" FOREIGN KEY ("wallet_address_id") REFERENCES "public"."wallet_addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_sweeps" ADD CONSTRAINT "wallet_sweeps_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_address_unique" ON "wallet_addresses" USING btree (lower("address"));--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_derivation_index_unique" ON "wallet_addresses" USING btree ("derivation_index");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_active_user_unique" ON "wallet_addresses" USING btree ("user_id") WHERE "wallet_addresses"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "wallet_sweeps_status_idx" ON "wallet_sweeps" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_sweeps_tx_hash_unique" ON "wallet_sweeps" USING btree ("sweep_tx_hash");--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_wallet_address_id_wallet_addresses_id_fk" FOREIGN KEY ("wallet_address_id") REFERENCES "public"."wallet_addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_chain_event_unique" ON "deposits" USING btree ("chain_id","token_contract_address","tx_hash","log_index");
