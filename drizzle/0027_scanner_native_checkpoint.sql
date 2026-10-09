ALTER TABLE "chain_watcher_state" ADD COLUMN "last_native_scanned_block" bigint;--> statement-breakpoint
ALTER TABLE "chain_watcher_state" ADD COLUMN "last_native_error" text;
--> statement-breakpoint
UPDATE "chain_watcher_state" SET "last_native_scanned_block" = "last_scanned_block" WHERE "last_native_scanned_block" IS NULL;
