CREATE TYPE "public"."worksheet_status" AS ENUM('UPLOADING', 'APPROVED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "worksheet_editors" (
	"staff_id" text PRIMARY KEY NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worksheet_file_chunks" (
	"worksheet_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "worksheet_file_chunks_worksheet_id_chunk_index_pk" PRIMARY KEY("worksheet_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "worksheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_name" text NOT NULL,
	"version" text NOT NULL,
	"reference" text,
	"notes" text,
	"status" "worksheet_status" DEFAULT 'UPLOADING' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_by" text,
	"archived_at" timestamp with time zone,
	"archived_note" text
);
--> statement-breakpoint
ALTER TABLE "worksheet_editors" ADD CONSTRAINT "worksheet_editors_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheet_editors" ADD CONSTRAINT "worksheet_editors_granted_by_staff_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheet_file_chunks" ADD CONSTRAINT "worksheet_file_chunks_worksheet_id_worksheets_id_fk" FOREIGN KEY ("worksheet_id") REFERENCES "public"."worksheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_uploaded_by_staff_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_archived_by_staff_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worksheets_status_idx" ON "worksheets" USING btree ("status");