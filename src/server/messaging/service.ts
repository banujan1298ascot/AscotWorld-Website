/**
 * Staff messaging, backed by Postgres so every device sees the same
 * conversations — previously this lived in each browser's own storage, so a
 * message sent from a phone never reached a PC.
 *
 * Every function takes the calling staff member's id and only ever returns
 * or changes conversations they're a participant in.
 */
import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../apiError";
import { db } from "../db/client";
import { conversationParticipants, conversations, messages } from "../db/schema";
import { checkMessageBody, checkNewConversation, isDirectMessage } from "./validation";

/** Shape the client works with — see src/lib/types.ts `Conversation`. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  participantIds: string[];
  lastMessageAt: string;
  /** staffId → when they last read it; absent for someone who never has. */
  lastReadAt: Record<string, string>;
  /** Only ever the caller, if they pinned it — pinning is personal. */
  pinnedBy: string[];
  preview: string;
  lastSenderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

/** Every conversation `staffId` is in, newest activity first. */
export async function listConversations(staffId: string): Promise<ConversationSummary[]> {
  const result = await db.execute<{
    id: string;
    title: string | null;
    last_message_at: string;
    created_at: string;
    updated_at: string;
    pinned: boolean;
    participants: { staffId: string; lastReadAt: string | null }[];
    preview: string | null;
    last_sender_id: string | null;
  }>(sql`
    SELECT c.id, c.title, c.last_message_at, c.created_at, c.updated_at, me.pinned,
      (
        SELECT json_agg(json_build_object('staffId', p.staff_id, 'lastReadAt', p.last_read_at))
        FROM "conversation_participants" p
        WHERE p.conversation_id = c.id
      ) AS participants,
      last.body AS preview, last.sender_id AS last_sender_id
    FROM "conversation_participants" me
    JOIN "conversations" c ON c.id = me.conversation_id
    LEFT JOIN LATERAL (
      SELECT m.body, m.sender_id
      FROM "messages" m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) last ON true
    WHERE me.staff_id = ${staffId}
    ORDER BY c.last_message_at DESC
    LIMIT 200
  `);

  return result.rows.map((row) => {
    const lastReadAt: Record<string, string> = {};
    for (const p of row.participants ?? []) if (p.lastReadAt) lastReadAt[p.staffId] = iso(p.lastReadAt);
    return {
      id: row.id,
      title: row.title,
      participantIds: (row.participants ?? []).map((p) => p.staffId),
      lastMessageAt: iso(row.last_message_at),
      lastReadAt,
      pinnedBy: row.pinned ? [staffId] : [],
      preview: row.preview ?? "",
      lastSenderId: row.last_sender_id,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  });
}

async function requireParticipant(conversationId: string, staffId: string): Promise<void> {
  const [row] = await db
    .select({ staffId: conversationParticipants.staffId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.staffId, staffId)))
    .limit(1);
  // Same answer for "doesn't exist" and "not yours", so ids can't be probed.
  if (!row) throw new ApiError(404, "Conversation not found.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(conversationId: string): void {
  if (!UUID.test(conversationId)) throw new ApiError(404, "Conversation not found.");
}

/** A thread's messages, oldest first — the latest 300. */
export async function listMessages(conversationId: string, staffId: string): Promise<MessageRecord[]> {
  requireUuid(conversationId);
  await requireParticipant(conversationId, staffId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(sql`${messages.createdAt} DESC`)
    .limit(300);
  return rows.reverse().map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.createdAt),
  }));
}

/** Appends a message and bumps the conversation, marking it read for the sender. */
export async function sendMessage(conversationId: string, senderId: string, rawBody: unknown): Promise<MessageRecord> {
  requireUuid(conversationId);
  const body = checkMessageBody(rawBody);
  if (!body.ok) throw new ApiError(422, body.error);
  await requireParticipant(conversationId, senderId);

  return db.transaction(async (tx) => {
    const [message] = await tx.insert(messages).values({ conversationId, senderId, body: body.value }).returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: message.createdAt, updatedAt: message.createdAt })
      .where(eq(conversations.id, conversationId));
    await tx
      .update(conversationParticipants)
      .set({ lastReadAt: message.createdAt })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.staffId, senderId)));
    return {
      id: message.id,
      conversationId,
      senderId,
      body: message.body,
      createdAt: iso(message.createdAt),
      updatedAt: iso(message.createdAt),
    };
  });
}

/**
 * Starts a conversation with an opening message. A plain direct message to
 * someone you already have a thread with goes into that thread instead of
 * opening a second one.
 */
export async function startConversation(
  creatorId: string,
  input: { participantIds?: unknown; title?: unknown; body?: unknown },
): Promise<{ conversationId: string }> {
  const checked = checkNewConversation(creatorId, input);
  if (!checked.ok) throw new ApiError(422, checked.error);
  const request = checked.value;

  if (isDirectMessage(request)) {
    const [other] = request.participantIds.filter((id) => id !== creatorId);
    const existing = await db.execute<{ id: string }>(sql`
      SELECT c.id
      FROM "conversations" c
      WHERE c.title IS NULL
        AND (SELECT COUNT(*) FROM "conversation_participants" p WHERE p.conversation_id = c.id) = 2
        AND EXISTS (SELECT 1 FROM "conversation_participants" p WHERE p.conversation_id = c.id AND p.staff_id = ${creatorId})
        AND EXISTS (SELECT 1 FROM "conversation_participants" p WHERE p.conversation_id = c.id AND p.staff_id = ${other})
      LIMIT 1
    `);
    const found = existing.rows[0]?.id;
    if (found) {
      await sendMessage(found, creatorId, request.body);
      return { conversationId: found };
    }
  }

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({ title: request.title, createdBy: creatorId })
      .returning({ id: conversations.id });
    const [message] = await tx
      .insert(messages)
      .values({ conversationId: conversation.id, senderId: creatorId, body: request.body })
      .returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: message.createdAt, updatedAt: message.createdAt })
      .where(eq(conversations.id, conversation.id));
    await tx.insert(conversationParticipants).values(
      request.participantIds.map((staffId) => ({
        conversationId: conversation.id,
        staffId,
        lastReadAt: staffId === creatorId ? message.createdAt : null,
      })),
    );
    return { conversationId: conversation.id };
  });
}

/** Marks the thread read for `staffId` up to its newest message. */
export async function markRead(conversationId: string, staffId: string): Promise<void> {
  requireUuid(conversationId);
  await requireParticipant(conversationId, staffId);
  await db.execute(sql`
    UPDATE "conversation_participants" p
    SET last_read_at = c.last_message_at
    FROM "conversations" c
    WHERE c.id = p.conversation_id
      AND p.conversation_id = ${conversationId}
      AND p.staff_id = ${staffId}
      AND (p.last_read_at IS NULL OR p.last_read_at < c.last_message_at)
  `);
}

export async function setPinned(conversationId: string, staffId: string, pinned: boolean): Promise<void> {
  requireUuid(conversationId);
  await requireParticipant(conversationId, staffId);
  await db
    .update(conversationParticipants)
    .set({ pinned })
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.staffId, staffId)));
}
