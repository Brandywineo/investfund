CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_accrual_id" uuid NOT NULL,
	"source_user_id" uuid NOT NULL,
	"beneficiary_user_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"rate_percent" numeric(9, 6) NOT NULL,
	"source_profit" numeric(20, 8) NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"ledger_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_commission_level_range" CHECK ("referral_commissions"."level" between 1 and 3),
	CONSTRAINT "referral_commission_amount_positive" CHECK ("referral_commissions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "referral_relationships" (
	"referred_user_id" uuid PRIMARY KEY NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_relationship_not_self" CHECK ("referral_relationships"."referred_user_id" <> "referral_relationships"."referrer_user_id")
);
--> statement-breakpoint
ALTER TABLE "treasury_transfers" ADD COLUMN "purpose" text DEFAULT 'MT5_CAPITAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD COLUMN "token_balance" numeric(20, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD COLUMN "native_balance" numeric(30, 18) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD COLUMN "balance_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_daily_accrual_id_daily_accruals_id_fk" FOREIGN KEY ("daily_accrual_id") REFERENCES "public"."daily_accruals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_ledger_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relationships" ADD CONSTRAINT "referral_relationships_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relationships" ADD CONSTRAINT "referral_relationships_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_relationships" ADD CONSTRAINT "referral_relationships_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_user_unique" ON "referral_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_code_unique" ON "referral_codes" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "referral_commissions_accrual_level_unique" ON "referral_commissions" USING btree ("daily_accrual_id","level");--> statement-breakpoint
CREATE INDEX "referral_commissions_beneficiary_idx" ON "referral_commissions" USING btree ("beneficiary_user_id");--> statement-breakpoint
CREATE INDEX "referral_relationships_referrer_idx" ON "referral_relationships" USING btree ("referrer_user_id");
--> statement-breakpoint
INSERT INTO "ledger_accounts" ("code", "name", "type", "normal_balance", "currency")
VALUES ('PLATFORM:REFERRAL_EXPENSE', 'Referral commission expense', 'EXPENSE', 'DEBIT', 'USDT')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "referral_codes" ("user_id", "code")
SELECT "id", upper('IF' || substr(replace("id"::text, '-', ''), 1, 10))
FROM "users"
ON CONFLICT DO NOTHING;
