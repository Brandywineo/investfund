ALTER TYPE "public"."treasury_transfer_status" ADD VALUE 'APPROVED' BEFORE 'BROADCAST';--> statement-breakpoint
ALTER TYPE "public"."treasury_transfer_status" ADD VALUE 'CONFIRMED' BEFORE 'BROKER_CREDITED';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE 'FAILED' BEFORE 'REJECTED';