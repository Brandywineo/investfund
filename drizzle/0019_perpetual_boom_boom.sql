ALTER TABLE "mt5_positions" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mt5_positions" ADD COLUMN "visibility_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mt5_positions" ADD COLUMN "visibility_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "mt5_positions" ADD CONSTRAINT "mt5_positions_visibility_updated_by_users_id_fk" FOREIGN KEY ("visibility_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;