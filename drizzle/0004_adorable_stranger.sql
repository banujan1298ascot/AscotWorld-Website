CREATE TABLE "app_records" (
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_records_collection_id_pk" PRIMARY KEY("collection","id")
);
--> statement-breakpoint
CREATE INDEX "app_records_collection_updated_idx" ON "app_records" USING btree ("collection","updated_at");