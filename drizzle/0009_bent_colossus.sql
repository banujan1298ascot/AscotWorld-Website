CREATE TYPE "public"."dosage_form" AS ENUM('TABLETS', 'CAPSULES', 'CREAM', 'OINTMENT', 'SOLUTION', 'SUSPENSION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."pack_unit" AS ENUM('tablets', 'capsules', 'ml', 'g');--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "medicine_name" text;--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "strength" text;--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "dosage_form" "dosage_form";--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "pack_size" numeric;--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "pack_unit" "pack_unit";