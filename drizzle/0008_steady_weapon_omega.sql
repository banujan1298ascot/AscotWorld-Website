CREATE TYPE "public"."batch_destination" AS ENUM('UK', 'IRELAND', 'SPAIN', 'GERMANY', 'ABU_DHABI');--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "destination" "batch_destination";