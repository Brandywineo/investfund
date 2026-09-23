CREATE TABLE "treasury_transaction_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treasury_transfer_id" uuid NOT NULL,
	"tx_hash" text NOT NULL,
	"signed_transaction" text NOT NULL,
	"chain_nonce" integer NOT NULL,
	"gas_price_wei" numeric(30, 0) NOT NULL,
	"status" text DEFAULT 'BROADCAST' NOT NULL,
	"broadcast_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_transaction_attempt_status" CHECK ("treasury_transaction_attempts"."status" in ('BROADCAST', 'REPLACED', 'CONFIRMED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "treasury_transaction_attempts" ADD CONSTRAINT "treasury_transaction_attempts_treasury_transfer_id_treasury_transfers_id_fk" FOREIGN KEY ("treasury_transfer_id") REFERENCES "public"."treasury_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transaction_attempts_tx_hash_unique" ON "treasury_transaction_attempts" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "treasury_transaction_attempts_transfer_idx" ON "treasury_transaction_attempts" USING btree ("treasury_transfer_id");