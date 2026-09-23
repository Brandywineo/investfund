ALTER TABLE "chain_watcher_state" ADD COLUMN "active_rpc_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_watcher_state" ADD COLUMN "rpc_failover_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_watcher_state" ADD COLUMN "last_rpc_failover_at" timestamp with time zone;