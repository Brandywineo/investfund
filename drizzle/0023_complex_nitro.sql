CREATE TYPE "public"."deposit_gas_recovery_status" AS ENUM('APPROVED', 'PROCESSING', 'BROADCAST', 'CONFIRMED', 'SKIPPED', 'FAILED');--> statement-breakpoint
CREATE TABLE "deposit_gas_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address_id" uuid NOT NULL,
	"destination_platform_wallet_id" uuid NOT NULL,
	"balance_before" numeric(30, 18),
	"recovered_amount" numeric(30, 18),
	"network_fee" numeric(30, 18),
	"status" "deposit_gas_recovery_status" DEFAULT 'APPROVED' NOT NULL,
	"requested_by" uuid NOT NULL,
	"signed_transaction" text,
	"chain_nonce" integer,
	"tx_hash" text,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" DROP CONSTRAINT "controlled_wallet_transfer_route";--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD COLUMN "source_platform_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD COLUMN "destination_platform_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD COLUMN "purpose" text DEFAULT 'WALLET_REBALANCING' NOT NULL;--> statement-breakpoint
UPDATE "controlled_wallet_transfers" AS transfer
SET "source_platform_wallet_id" = wallet."id"
FROM "platform_wallets" AS wallet
WHERE transfer."source_platform_wallet_id" IS NULL
  AND wallet."wallet_set_id" = '00000000-0000-4000-8000-000000000001'
  AND wallet."role" = transfer."source_role";--> statement-breakpoint
UPDATE "controlled_wallet_transfers" AS transfer
SET "destination_platform_wallet_id" = wallet."id"
FROM "platform_wallets" AS wallet
WHERE transfer."destination_type" = 'INTERNAL'
  AND transfer."destination_platform_wallet_id" IS NULL
  AND wallet."wallet_set_id" = '00000000-0000-4000-8000-000000000001'
  AND wallet."role" = transfer."destination_role";--> statement-breakpoint
ALTER TABLE "deposit_gas_recoveries" ADD CONSTRAINT "deposit_gas_recoveries_wallet_address_id_wallet_addresses_id_fk" FOREIGN KEY ("wallet_address_id") REFERENCES "public"."wallet_addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_gas_recoveries" ADD CONSTRAINT "deposit_gas_recoveries_destination_platform_wallet_id_platform_wallets_id_fk" FOREIGN KEY ("destination_platform_wallet_id") REFERENCES "public"."platform_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_gas_recoveries" ADD CONSTRAINT "deposit_gas_recoveries_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_gas_recoveries_tx_hash_unique" ON "deposit_gas_recoveries" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "deposit_gas_recoveries_status_idx" ON "deposit_gas_recoveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deposit_gas_recoveries_address_idx" ON "deposit_gas_recoveries" USING btree ("wallet_address_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_gas_recoveries_active_address_unique" ON "deposit_gas_recoveries" USING btree ("wallet_address_id") WHERE "deposit_gas_recoveries"."status" in ('APPROVED', 'PROCESSING', 'BROADCAST');--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD CONSTRAINT "controlled_wallet_transfers_source_platform_wallet_id_platform_wallets_id_fk" FOREIGN KEY ("source_platform_wallet_id") REFERENCES "public"."platform_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD CONSTRAINT "controlled_wallet_transfers_destination_platform_wallet_id_platform_wallets_id_fk" FOREIGN KEY ("destination_platform_wallet_id") REFERENCES "public"."platform_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "controlled_wallet_transfers_source_idx" ON "controlled_wallet_transfers" USING btree ("source_platform_wallet_id","created_at");
