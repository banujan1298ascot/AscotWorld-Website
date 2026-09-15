CREATE TYPE "public"."stage_arrival" AS ENUM('FORWARD', 'RETURNED');--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "current_stage_arrival" "stage_arrival";