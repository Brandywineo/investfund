CREATE TYPE "public"."controlled_wallet_transfer_status" AS ENUM('DRAFTED', 'APPROVED', 'PROCESSING', 'BROADCAST', 'CONFIRMED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "controlled_wallet_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_role" "platform_wallet_role" NOT NULL,
	"destination_type" text NOT NULL,
	"destination_role" "platform_wallet_role",
	"destination_address" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(30, 18) NOT NULL,
	"reason" text NOT NULL,
	"status" "controlled_wallet_transfer_status" DEFAULT 'DRAFTED' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"signed_transaction" text,
	"chain_nonce" integer,
	"tx_hash" text,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "controlled_wallet_transfer_amount_positive" CHECK ("controlled_wallet_transfers"."amount" > 0),
	CONSTRAINT "controlled_wallet_transfer_destination_type" CHECK ("controlled_wallet_transfers"."destination_type" in ('INTERNAL', 'EXTERNAL')),
	CONSTRAINT "controlled_wallet_transfer_asset" CHECK ("controlled_wallet_transfers"."asset" in ('BNB', 'USDT')),
	CONSTRAINT "controlled_wallet_transfer_route" CHECK ((
        "controlled_wallet_transfers"."source_role" = 'SWEEP_GAS'
        and "controlled_wallet_transfers"."asset" = 'BNB'
        and "controlled_wallet_transfers"."destination_type" = 'INTERNAL'
        and "controlled_wallet_transfers"."destination_role" = 'HOT_WITHDRAWAL'
      ) or (
        "controlled_wallet_transfers"."source_role" = 'HOT_WITHDRAWAL'
        and "controlled_wallet_transfers"."destination_type" = 'INTERNAL'
        and "controlled_wallet_transfers"."destination_role" = 'SWEEP_GAS'
        and "controlled_wallet_transfers"."asset" = 'BNB'
      ) or (
        "controlled_wallet_transfers"."source_role" = 'HOT_WITHDRAWAL'
        and "controlled_wallet_transfers"."destination_type" = 'EXTERNAL'
        and "controlled_wallet_transfers"."destination_role" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD CONSTRAINT "controlled_wallet_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_wallet_transfers" ADD CONSTRAINT "controlled_wallet_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "controlled_wallet_transfers_tx_hash_unique" ON "controlled_wallet_transfers" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "controlled_wallet_transfers_status_idx" ON "controlled_wallet_transfers" USING btree ("status");