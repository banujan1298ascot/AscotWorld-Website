import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staff } from "./staff";

/**
 * Staff messaging. Lives in Postgres rather than browser storage so a
 * message sent from a phone shows up on every other device — see
 * src/server/messaging/service.ts.
 *
 * A 1:1 message and a group chat are the same shape: a conversation plus
 * its participant rows. Read state and pinning are per participant, on the
 * participant row, so marking a thread read is one small update however
 * long the thread is.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Custom name for a group conversation; null shows participant names. */
  title: text("title"),
  createdBy: text("created_by")
    .notNull()
    .references(() => staff.id, { onDelete: "restrict" }),
  /** Time of the newest message — drives conversation ordering and unread. */
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** No foreign key on purpose: the Team page can still add staff who only
     *  exist in the browser demo data, and they should be messageable. */
    staffId: text("staff_id").notNull(),
    /** Up to which message this participant has read; null = never opened. */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    /** Personal — pinning a shared conversation doesn't pin it for others. */
    pinned: boolean("pinned").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.staffId] }),
    index("conversation_participants_staff_idx").on(table.staffId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)],
);
