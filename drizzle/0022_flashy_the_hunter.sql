CREATE TYPE "public"."wallet_set_status" AS ENUM('READY', 'ACTIVE', 'DRAINING', 'RETIRED');--> statement-breakpoint
CREATE TABLE "wallet_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"signer_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "wallet_set_status" DEFAULT 'READY' NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "wallet_sets" ("id", "name", "signer_key", "fingerprint", "status", "activated_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'Primary Wallet', 'primary', 'primary-existing-wallet', 'ACTIVE', now());--> statement-breakpoint
ALTER TABLE "platform_wallets" ADD COLUMN "wallet_set_id" uuid;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD COLUMN "wallet_set_id" uuid;--> statement-breakpoint
UPDATE "platform_wallets" SET "wallet_set_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "wallet_addresses" SET "wallet_set_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE "platform_wallets" ALTER COLUMN "wallet_set_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ALTER COLUMN "wallet_set_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "platform_wallets_role_unique";--> statement-breakpoint
DROP INDEX "wallet_addresses_derivation_index_unique";--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "source_platform_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "wallet_sets" ADD CONSTRAINT "wallet_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_sets_signer_key_unique" ON "wallet_sets" USING btree ("signer_key");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_sets_fingerprint_unique" ON "wallet_sets" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_sets_single_active_unique" ON "wallet_sets" USING btree ("status") WHERE "wallet_sets"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "platform_wallets" ADD CONSTRAINT "platform_wallets_wallet_set_id_wallet_sets_id_fk" FOREIGN KEY ("wallet_set_id") REFERENCES "public"."wallet_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_wallet_set_id_wallet_sets_id_fk" FOREIGN KEY ("wallet_set_id") REFERENCES "public"."wallet_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_source_platform_wallet_id_platform_wallets_id_fk" FOREIGN KEY ("source_platform_wallet_id") REFERENCES "public"."platform_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallets_set_role_unique" ON "platform_wallets" USING btree ("wallet_set_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_set_derivation_unique" ON "wallet_addresses" USING btree ("wallet_set_id","derivation_index");
