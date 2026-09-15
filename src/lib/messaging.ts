"use client";

import { useMemo } from "react";
import { conversationCollection, messageCollection, staffCollection } from "./seed";
import { useCollection } from "./storage";
import { pushNotification } from "./notifications";
import type { Conversation, Message, StaffMember } from "./types";

/* ============================================================================
 * Messaging
 * ----------------------------------------------------------------------------
 * Conversations are just a list of participant ids — a 1:1 message and a group
 * chat are the same shape. Unread state is tracked per participant on the
 * conversation (`lastReadAt`) rather than per message, so marking a thread read
 * is a single write regardless of how many messages are in it.
 * ========================================================================= */

/** Human-readable label for a conversation from the other participants' names. */
export function conversationLabel(
  conversation: Conversation,
  currentUserId: string,
  staffById: Map<string, StaffMember>,
): string {
  if (conversation.title) return conversation.title;
  const others = conversation.participantIds
    .filter((id) => id !== currentUserId)
    .map((id) => staffById.get(id)?.name ?? "Former staff member");
  return others.length > 0 ? others.join(", ") : "Notes to self";
}

/** True if `userId` has unread messages in this conversation. */
export function hasUnread(conversation: Conversation, userId: string): boolean {
  const lastRead = conversation.lastReadAt[userId];
  if (!lastRead) return true;
  return conversation.lastMessageAt > lastRead;
}

/**
 * True if `userId` has pinned this conversation to the top of their list.
 * `pinnedBy` falls back to empty because conversations created before this
 * field existed are already sitting in people's browser storage without it.
 */
export function isPinnedBy(conversation: Conversation, userId: string): boolean {
  return (conversation.pinnedBy ?? []).includes(userId);
}

/** Pins or unpins a conversation — personal to `userId`, not shared. */
export function togglePinConversation(conversationId: string, userId: string): void {
  const conversation = conversationCollection.find(conversationId);
  if (!conversation) return;
  const pinnedBy = conversation.pinnedBy ?? [];
  const pinned = pinnedBy.includes(userId);
  conversationCollection.update(conversationId, {
    pinnedBy: pinned ? pinnedBy.filter((id) => id !== userId) : [...pinnedBy, userId],
  });
}

/** Starts a new conversation with an opening message and notifies the others. */
export function startConversation(
  participantIds: string[],
  creatorId: string,
  firstMessage: string,
  title: string | null = null,
): Conversation {
  const now = new Date().toISOString();
  const conversation = conversationCollection.create({
    participantIds,
    title,
    lastMessageAt: now,
    lastReadAt: { [creatorId]: now },
    pinnedBy: [],
  });
  sendMessage(conversation.id, creatorId, firstMessage);
  return conversation;
}

/** Appends a message, bumps the conversation and notifies everyone else in it. */
export function sendMessage(conversationId: string, senderId: string, body: string): Message {
  const trimmed = body.trim();
  const message = messageCollection.create({ conversationId, senderId, body: trimmed });

  const conversation = conversationCollection.find(conversationId);
  if (conversation) {
    conversationCollection.update(conversationId, {
      lastMessageAt: message.createdAt,
      lastReadAt: { ...conversation.lastReadAt, [senderId]: message.createdAt },
    });

    const sender = staffCollection.find(senderId);
    conversation.participantIds
      .filter((id) => id !== senderId)
      .forEach((recipientId) => {
        pushNotification({
          recipientId,
          type: "message",
          title: `New message from ${sender?.name ?? "a colleague"}`,
          body: trimmed,
          href: `/messages?c=${conversationId}`,
        });
      });
  }

  return message;
}

/** Marks everything in a conversation as read for this user, up to its latest message. */
export function markConversationRead(conversationId: string, userId: string): void {
  const conversation = conversationCollection.find(conversationId);
  if (!conversation) return;
  const already = conversation.lastReadAt[userId];
  // Skip the write if there's nothing new — avoids a pointless render loop
  // when the thread is simply left open with no new messages arriving.
  if (already && already >= conversation.lastMessageAt) return;
  // Stamped with the message's own timestamp, not wall-clock "now" — seed
  // data (or any clock skew) can place `lastMessageAt` ahead of real time,
  // and comparing a real-now stamp against a synthetic future timestamp
  // would never satisfy the guard above, writing on every render forever.
  conversationCollection.update(conversationId, {
    lastReadAt: { ...conversation.lastReadAt, [userId]: conversation.lastMessageAt },
  });
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/** Every conversation `userId` is part of — pinned first, newest first within each. */
export function useConversationsFor(userId: string | undefined) {
  const { items: conversations, ready } = useCollection(conversationCollection);
  const filtered = useMemo(
    () =>
      userId
        ? conversations
            .filter((c) => c.participantIds.includes(userId))
            .slice()
            .sort(
              (a, b) =>
                Number(isPinnedBy(b, userId)) - Number(isPinnedBy(a, userId)) ||
                b.lastMessageAt.localeCompare(a.lastMessageAt),
            )
        : [],
    [conversations, userId],
  );
  return { conversations: filtered, ready };
}

export function useMessagesFor(conversationId: string | undefined) {
  const { items: messages, ready } = useCollection(messageCollection);
  const filtered = useMemo(
    () =>
      conversationId
        ? messages
            .filter((m) => m.conversationId === conversationId)
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [messages, conversationId],
  );
  return { messages: filtered, ready };
}

/** Total number of conversations with something unread — used for nav badges. */
export function useUnreadMessageCount(userId: string | undefined): number {
  const { items: conversations } = useCollection(conversationCollection);
  return useMemo(() => {
    if (!userId) return 0;
    return conversations.filter((c) => c.participantIds.includes(userId) && hasUnread(c, userId))
      .length;
  }, [conversations, userId]);
}
