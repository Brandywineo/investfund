CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."treasury_transfer_status" AS ENUM('DRAFTED', 'BROADCAST', 'BROKER_CREDITED', 'FAILED', 'RECONCILED');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('REQUESTED', 'APPROVED', 'BROADCAST', 'CONFIRMED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "custody_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"network" text DEFAULT 'BEP20' NOT NULL,
	"deposit_address" text,
	"confirmation_threshold" integer DEFAULT 15 NOT NULL,
	"reserve_fixed" numeric(20, 8) DEFAULT '0' NOT NULL,
	"reserve_percent" numeric(9, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"network" text DEFAULT 'BEP20' NOT NULL,
	"tx_hash" text,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"ledger_transaction_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_amount_positive" CHECK ("deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"destination" text NOT NULL,
	"status" "treasury_transfer_status" DEFAULT 'DRAFTED' NOT NULL,
	"tx_hash" text,
	"broker_reference" text,
	"created_by" uuid NOT NULL,
	"broadcast_at" timestamp with time zone,
	"broker_credited_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"hot_wallet_ledger_transaction_id" uuid,
	"broker_ledger_transaction_id" uuid,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_transfer_amount_positive" CHECK ("treasury_transfers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"destination_address" text NOT NULL,
	"network" text DEFAULT 'BEP20' NOT NULL,
	"status" "withdrawal_status" DEFAULT 'REQUESTED' NOT NULL,
	"tx_hash" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"reservation_ledger_transaction_id" uuid,
	"payment_ledger_transaction_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_amount_positive" CHECK ("withdrawals"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_hot_wallet_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("hot_wallet_ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_broker_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("broker_ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reservation_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("reservation_ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payment_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("payment_ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tx_hash_unique" ON "deposits" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "deposits_user_status_idx" ON "deposits" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transfers_tx_hash_unique" ON "treasury_transfers" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "treasury_transfers_status_idx" ON "treasury_transfers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_tx_hash_unique" ON "withdrawals" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "withdrawals_user_status_idx" ON "withdrawals" USING btree ("user_id","status");
--> statement-breakpoint
INSERT INTO "custody_settings" ("id", "network", "confirmation_threshold", "reserve_fixed", "reserve_percent")
VALUES (1, 'BEP20', 15, 0, 0)
ON CONFLICT ("id") DO NOTHING;
