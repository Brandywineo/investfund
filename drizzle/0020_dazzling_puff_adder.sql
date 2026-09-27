CREATE TYPE "public"."chain_worker_run_status" AS ENUM('SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."operational_event_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."operational_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TABLE "chain_worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "chain_worker_run_status" NOT NULL,
	"from_block" bigint,
	"to_block" bigint,
	"head_block" bigint,
	"lag_blocks" bigint,
	"batches" integer DEFAULT 0 NOT NULL,
	"runtime_ms" integer,
	"rpc_endpoint_count" integer,
	"rpc_failovers" integer DEFAULT 0 NOT NULL,
	"credited" integer DEFAULT 0 NOT NULL,
	"swept" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"component" text NOT NULL,
	"severity" "operational_severity" NOT NULL,
	"status" "operational_event_status" DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chain_worker_runs_finished_idx" ON "chain_worker_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "chain_worker_runs_status_idx" ON "chain_worker_runs" USING btree ("status","finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_events_key_unique" ON "operational_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "operational_events_status_idx" ON "operational_events" USING btree ("status","severity","last_observed_at");