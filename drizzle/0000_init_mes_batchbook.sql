CREATE TYPE "public"."batch_status" AS ENUM('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."batch_type" AS ENUM('A', 'B', 'C', 'D', 'M');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'production', 'qa', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."stage_outcome" AS ENUM('FORWARD', 'SENT_BACK', 'ON_HOLD', 'FAILED');--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"department" text,
	"email" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "stage_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"name" text NOT NULL,
	"fail_authority" boolean DEFAULT false NOT NULL,
	"is_terminal_release_stage" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_definitions_department_sequence_unique" UNIQUE("department_id","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "batch_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_type" "batch_type" NOT NULL,
	"year" integer,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reason_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reason_codes_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "batch_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_type" "batch_type" NOT NULL,
	"batch_number" text,
	"batch_sequence" integer,
	"department_id" uuid NOT NULL,
	"product_name" text,
	"quantity" numeric,
	"unit" text,
	"planned_manufacture_date" date,
	"status" "batch_status" DEFAULT 'DRAFT' NOT NULL,
	"current_stage_id" uuid,
	"is_historical_import" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"operator_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration" interval GENERATED ALWAYS AS ((completed_at - received_at)) STORED,
	"outcome" "stage_outcome",
	"destination_stage_id" uuid,
	"reason_code_id" uuid,
	"notes" text,
	"investigation_flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"field_changed" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "stage_definitions" ADD CONSTRAINT "stage_definitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_current_stage_id_stage_definitions_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."stage_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_records" ADD CONSTRAINT "batch_records_confirmed_by_staff_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_batch_id_batch_records_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_stage_id_stage_definitions_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stage_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_operator_id_staff_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_destination_stage_id_stage_definitions_id_fk" FOREIGN KEY ("destination_stage_id") REFERENCES "public"."stage_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_reason_code_id_reason_codes_id_fk" FOREIGN KEY ("reason_code_id") REFERENCES "public"."reason_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_batch_id_batch_records_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_changed_by_staff_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_counters_type_unique" ON "batch_counters" USING btree ("batch_type") WHERE "batch_counters"."year" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_counters_type_year_unique" ON "batch_counters" USING btree ("batch_type","year") WHERE "batch_counters"."year" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_records_batch_number_unique" ON "batch_records" USING btree ("batch_number") WHERE "batch_records"."batch_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stage_transitions_active_operator_unique" ON "stage_transitions" USING btree ("operator_id") WHERE "stage_transitions"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stage_transitions_batch_id_idx" ON "stage_transitions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "stage_transitions_stage_open_idx" ON "stage_transitions" USING btree ("stage_id") WHERE "stage_transitions"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_log_entries_batch_id_idx" ON "audit_log_entries" USING btree ("batch_id");