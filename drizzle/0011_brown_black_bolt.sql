CREATE TYPE "public"."investment_exit_status" AS ENUM('REQUESTED', 'DEFERRED', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."trading_position_status" AS ENUM('OPEN', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "investment_exit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "investment_exit_status" DEFAULT 'REQUESTED' NOT NULL,
	"user_note" text,
	"decision_reason" text,
	"review_after" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"released_amount" numeric(20, 8),
	"release_ledger_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"entry_price" numeric(30, 10) NOT NULL,
	"current_price" numeric(30, 10),
	"stop_loss" numeric(30, 10),
	"take_profit" numeric(30, 10),
	"size_label" text,
	"status" "trading_position_status" DEFAULT 'OPEN' NOT NULL,
	"pnl_percent" numeric(12, 6),
	"note" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_position_side" CHECK ("trading_positions"."side" in ('BUY', 'SELL')),
	CONSTRAINT "trading_position_entry_positive" CHECK ("trading_positions"."entry_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "withdrawal_fee_percent" numeric(9, 6) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "fee_percent" numeric(9, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "fee_amount" numeric(20, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "net_amount" numeric(20, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "withdrawals" SET "net_amount" = "amount" WHERE "net_amount" = 0;--> statement-breakpoint
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_balance", "currency")
VALUES ('PLATFORM:WITHDRAWAL_FEE_REVENUE', 'Withdrawal fee revenue', 'REVENUE', 'CREDIT', 'USDT')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "investment_exit_requests" ADD CONSTRAINT "investment_exit_requests_investment_id_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_exit_requests" ADD CONSTRAINT "investment_exit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_exit_requests" ADD CONSTRAINT "investment_exit_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_exit_requests" ADD CONSTRAINT "investment_exit_requests_release_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("release_ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_positions" ADD CONSTRAINT "trading_positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_exit_user_status_idx" ON "investment_exit_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_exit_active_unique" ON "investment_exit_requests" USING btree ("investment_id") WHERE "investment_exit_requests"."status" in ('REQUESTED', 'DEFERRED');--> statement-breakpoint
CREATE INDEX "trading_positions_status_opened_idx" ON "trading_positions" USING btree ("status","opened_at");--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawal_net_amount_positive" CHECK ("withdrawals"."net_amount" > 0);
