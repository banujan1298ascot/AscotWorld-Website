CREATE TYPE "public"."label_print_kind" AS ENUM('FIRST_PRINT', 'REPRINT');--> statement-breakpoint
CREATE TABLE "label_print_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"kind" "label_print_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_print_runs_quantity_positive" CHECK ("label_print_runs"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "labels_printed" integer;--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "labels_reprinted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "label_print_runs" ADD CONSTRAINT "label_print_runs_batch_id_batch_records_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_print_runs" ADD CONSTRAINT "label_print_runs_stage_id_stage_definitions_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stage_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_print_runs" ADD CONSTRAINT "label_print_runs_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_print_runs_batch_id_idx" ON "label_print_runs" USING btree ("batch_id");