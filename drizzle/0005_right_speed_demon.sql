ALTER TYPE "public"."stage_outcome" ADD VALUE 'REASSIGNED';--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mes_stage" integer;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD COLUMN "visit_started_at" timestamp with time zone;