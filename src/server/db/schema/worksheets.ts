import { customType, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { worksheetStatusEnum } from "./enums";
import { staff } from "./staff";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Worksheets (BMRs) for products, uploaded by the people given access —
 * the senior pharmacist and the production manager — and readable by
 * everyone signed in. APPROVED is the version in use; when a new version
 * comes in, the old one is moved to ARCHIVED rather than deleted, so every
 * version stays on record. UPLOADING rows are uploads still in flight
 * (their file arrives in pieces — see worksheet_file_chunks) and are never
 * listed.
 */
export const worksheets = pgTable(
  "worksheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productName: text("product_name").notNull(),
    version: text("version").notNull(),
    /** The document's own number, e.g. "BMR-0142", if it has one. */
    reference: text("reference"),
    notes: text("notes"),
    status: worksheetStatusEnum("status").notNull().default("UPLOADING"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** How many pieces the file was split into for upload. */
    chunkCount: integer("chunk_count").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    /** When the upload finished (it's created when the upload starts). */
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    archivedBy: text("archived_by").references(() => staff.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Why it was archived — "Replaced by version 5" when a new upload
     *  replaced it, or whatever the person moving it wrote. */
    archivedNote: text("archived_note"),
  },
  (table) => [index("worksheets_status_idx").on(table.status)],
);

/**
 * A worksheet's file, in pieces of at most WORKSHEET_CHUNK_BYTES. Stored in
 * Postgres (there's no file storage set up), and split because a single
 * request to the hosted site can't carry more than about 4.5 MB.
 */
export const worksheetFileChunks = pgTable(
  "worksheet_file_chunks",
  {
    worksheetId: uuid("worksheet_id")
      .notNull()
      .references(() => worksheets.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    data: bytea("data").notNull(),
  },
  (table) => [primaryKey({ columns: [table.worksheetId, table.chunkIndex] })],
);

/** Who may upload and move worksheets, besides admins (who always can, and
 *  are the ones who grant it). Everyone else can only view them. */
export const worksheetEditors = pgTable("worksheet_editors", {
  staffId: text("staff_id")
    .primaryKey()
    .references(() => staff.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by")
    .notNull()
    .references(() => staff.id, { onDelete: "restrict" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});
