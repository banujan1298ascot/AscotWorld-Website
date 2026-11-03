-- A formula's single per-bottle overage becomes an overage table (by pack
-- size and number of packs, once per batch), and formulas get a base unit
-- so creams and ointments can be made by weight. Existing formulas keep
-- their overage as one "any pack size, any number of packs" row.
-- overage_ml stays (no longer required) until the app deployed before this
-- has been replaced, so it keeps working meanwhile; a later migration drops it.
ALTER TABLE "product_formulas" ADD COLUMN "base_unit" text DEFAULT 'ml' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_formulas" ADD COLUMN "overages" jsonb;--> statement-breakpoint
UPDATE "product_formulas" SET "overages" = jsonb_build_array(jsonb_build_object('packSize', NULL, 'fromPacks', 1, 'toPacks', NULL, 'amount', "overage_ml"::numeric));--> statement-breakpoint
ALTER TABLE "product_formulas" ALTER COLUMN "overages" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_formulas" ALTER COLUMN "overage_ml" DROP NOT NULL;
