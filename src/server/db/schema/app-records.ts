import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared store for the portal sections that started life in browser storage
 * — Task planner, Batch schedule, Team & rota, departments and bell
 * notifications. Each record is kept whole as JSON under its collection
 * name, exactly the shape the client already works with, so moving those
 * sections off the browser needed no change to the pages themselves. See
 * src/server/records/service.ts and the client side in src/lib/storage.ts.
 *
 * A section that grows real query or integrity needs (reporting across
 * tasks, say) is the cue to give it proper tables of its own, the way the
 * Batch Book, MES and messaging have.
 */
export const appRecords = pgTable(
  "app_records",
  {
    collection: text("collection").notNull(),
    id: text("id").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.collection, table.id] }),
    index("app_records_collection_updated_idx").on(table.collection, table.updatedAt),
  ],
);
