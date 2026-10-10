ALTER TABLE "email_outbox" ADD COLUMN "event_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_event_key_unique" ON "email_outbox" USING btree ("event_key");