CREATE TYPE "public"."mt5_sync_status" AS ENUM('UNCONFIGURED', 'ONLINE', 'DEGRADED', 'OFFLINE');--> statement-breakpoint
CREATE TABLE "mt5_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket" text NOT NULL,
	"order_ticket" text,
	"position_ticket" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"entry" text NOT NULL,
	"volume" numeric(20, 8) NOT NULL,
	"price" numeric(30, 10) NOT NULL,
	"profit" numeric(20, 8) NOT NULL,
	"commission" numeric(20, 8) NOT NULL,
	"swap" numeric(20, 8) NOT NULL,
	"fee" numeric(20, 8) NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt5_deal_side" CHECK ("mt5_deals"."side" in ('BUY', 'SELL')),
	CONSTRAINT "mt5_deal_volume_non_negative" CHECK ("mt5_deals"."volume" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mt5_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket" text NOT NULL,
	"symbol" text NOT NULL,
	"order_type" text NOT NULL,
	"volume_initial" numeric(20, 8) NOT NULL,
	"volume_current" numeric(20, 8) NOT NULL,
	"requested_price" numeric(30, 10),
	"stop_loss" numeric(30, 10),
	"take_profit" numeric(30, 10),
	"placed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt5_order_volume_positive" CHECK ("mt5_orders"."volume_initial" > 0)
);
--> statement-breakpoint
CREATE TABLE "mt5_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket" text NOT NULL,
	"identifier" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"volume" numeric(20, 8) NOT NULL,
	"entry_price" numeric(30, 10) NOT NULL,
	"current_price" numeric(30, 10),
	"stop_loss" numeric(30, 10),
	"take_profit" numeric(30, 10),
	"floating_profit" numeric(20, 8),
	"swap" numeric(20, 8),
	"opened_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt5_position_side" CHECK ("mt5_positions"."side" in ('BUY', 'SELL')),
	CONSTRAINT "mt5_position_volume_positive" CHECK ("mt5_positions"."volume" > 0)
);
--> statement-breakpoint
CREATE TABLE "mt5_sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" "mt5_sync_status" DEFAULT 'UNCONFIGURED' NOT NULL,
	"server_name" text,
	"terminal_version" text,
	"last_sync_started_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_history_cursor_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_deals_ticket_unique" ON "mt5_deals" USING btree ("ticket");--> statement-breakpoint
CREATE INDEX "mt5_deals_executed_idx" ON "mt5_deals" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "mt5_deals_position_idx" ON "mt5_deals" USING btree ("position_ticket");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_orders_ticket_unique" ON "mt5_orders" USING btree ("ticket");--> statement-breakpoint
CREATE INDEX "mt5_orders_placed_idx" ON "mt5_orders" USING btree ("placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_positions_ticket_unique" ON "mt5_positions" USING btree ("ticket");--> statement-breakpoint
CREATE INDEX "mt5_positions_opened_idx" ON "mt5_positions" USING btree ("opened_at");