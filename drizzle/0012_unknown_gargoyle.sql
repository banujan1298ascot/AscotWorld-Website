CREATE TABLE "product_formulas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medicine_name" text NOT NULL,
	"dosage_form" "dosage_form" NOT NULL,
	"strength" text,
	"overage_ml" numeric NOT NULL,
	"ingredients" jsonb NOT NULL,
	"notes" text,
	"scan_layout" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" text,
	"retired_at" timestamp with time zone,
	"replaced_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "product_formulas" ADD CONSTRAINT "product_formulas_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_formulas" ADD CONSTRAINT "product_formulas_retired_by_staff_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_formulas" ADD CONSTRAINT "product_formulas_replaced_by_id_product_formulas_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."product_formulas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_formulas_retired_at_idx" ON "product_formulas" USING btree ("retired_at");