ALTER TYPE "public"."worksheet_status" ADD VALUE 'GENERATED';--> statement-breakpoint
ALTER TABLE "batch_records" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "worksheets" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "worksheets" ADD COLUMN "source_worksheet_id" uuid;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_batch_id_batch_records_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_source_worksheet_id_worksheets_id_fk" FOREIGN KEY ("source_worksheet_id") REFERENCES "public"."worksheets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worksheets_batch_id_idx" ON "worksheets" USING btree ("batch_id");