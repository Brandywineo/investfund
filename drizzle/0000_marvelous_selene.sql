CREATE TYPE "public"."investment_status" AS ENUM('ACTIVE', 'PAUSED', 'MATURED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."normal_balance" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'MANAGER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "accrual_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_rate_percent" numeric(9, 6) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accrual_rate_non_negative" CHECK ("accrual_rates"."daily_rate_percent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investment_id" uuid NOT NULL,
	"accrual_date" timestamp with time zone NOT NULL,
	"opening_balance" numeric(20, 8) NOT NULL,
	"rate_percent" numeric(9, 6) NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"closing_balance" numeric(20, 8) NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"principal" numeric(20, 8) NOT NULL,
	"compounded_balance" numeric(20, 8) NOT NULL,
	"status" "investment_status" DEFAULT 'ACTIVE' NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"last_accrued_on" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_principal_positive" CHECK ("investments"."principal" > 0),
	CONSTRAINT "investment_balance_non_negative" CHECK ("investments"."compounded_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "ledger_account_type" NOT NULL,
	"normal_balance" "normal_balance" NOT NULL,
	"owner_user_id" uuid,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"transaction_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(20, 8) DEFAULT '0' NOT NULL,
	"credit" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_transaction_id_line_number_pk" PRIMARY KEY("transaction_id","line_number"),
	CONSTRAINT "ledger_entry_one_side_only" CHECK (("ledger_entries"."debit" > 0 AND "ledger_entries"."credit" = 0) OR ("ledger_entries"."credit" > 0 AND "ledger_entries"."debit" = 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"minimum_investment" numeric(20, 8) DEFAULT '300' NOT NULL,
	"maximum_investment" numeric(20, 8) DEFAULT '5000' NOT NULL,
	"compounding_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accrual_rates" ADD CONSTRAINT "accrual_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_accruals" ADD CONSTRAINT "daily_accruals_investment_id_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_accruals" ADD CONSTRAINT "daily_accruals_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accrual_rates_effective_idx" ON "accrual_rates" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_accrual_investment_date_unique" ON "daily_accruals" USING btree ("investment_id","accrual_date");--> statement-breakpoint
CREATE INDEX "investments_user_status_idx" ON "investments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ledger_accounts_owner_idx" ON "ledger_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_effective_idx" ON "ledger_transactions" USING btree ("effective_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));