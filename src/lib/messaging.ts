"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "./apiClient";
import { pushNotification } from "./notifications";
import { staffCollection } from "./seed";
import type { Conversation, Message, StaffMember } from "./types";

/* ============================================================================
 * Messaging
 * ----------------------------------------------------------------------------
 * Conversations and messages live in the database (src/app/api/messages), not
 * in browser storage — so a message sent from a phone reaches everyone's PC.
 * There's no push channel yet, so every open page re-checks on a short
 * interval, and straight away when the tab comes back into view.
 *
 * Conversations are just a list of participant ids — a 1:1 message and a
 * group chat are the same shape. Unread state is tracked per participant
 * (`lastReadAt`) rather than per message.
 * ========================================================================= */

/** How often an open page re-checks for new conversations and messages. */
export const CONVERSATION_POLL_MS = 4000;
export const THREAD_POLL_MS = 3000;

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

/** True if `userId` has pinned this conversation to the top of their list. */
export function isPinnedBy(conversation: Conversation, userId: string): boolean {
  return (conversation.pinnedBy ?? []).includes(userId);
}

/* -------------------------------------------------------------------------- */
/* Shared conversation list — one poller however many components read it     */
/* -------------------------------------------------------------------------- */

interface ConversationState {
  userId: string | null;
  conversations: Conversation[];
  ready: boolean;
  error: string | null;
}

const EMPTY: ConversationState = { userId: null, conversations: [], ready: false, error: null };
let state: ConversationState = EMPTY;
const listeners = new Set<() => void>();
let attached = 0;
let timer: number | undefined;

function setState(next: ConversationState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-fetches the signed-in person's conversations. Safe to call any time. */
export async function refreshConversations(): Promise<void> {
  const userId = state.userId;
  if (!userId) return;
  try {
    const { conversations } = await apiFetch<{ conversations: Conversation[] }>("/api/messages/conversations", userId);
    if (state.userId !== userId) return; // signed out or switched user meanwhile
    notifyNewArrivals(userId, conversations);
    setState({ userId, conversations, ready: true, error: null });
  } catch (err) {
    if (state.userId !== userId) return;
    // Keep showing what we had; only surface the error if there's nothing.
    setState({ ...state, ready: true, error: err instanceof Error ? err.message : "Couldn't load messages." });
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible") void refreshConversations();
}

/** Starts polling for `userId` while at least one component needs it. */
function attach(userId: string): () => void {
  if (state.userId !== userId) setState({ ...EMPTY, userId });
  attached += 1;
  if (attached === 1) {
    void refreshConversations();
    timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshConversations();
    }, CONVERSATION_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  }
  return () => {
    attached -= 1;
    if (attached === 0) {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    }
  };
}

function useConversationState(userId: string | undefined): ConversationState {
  useEffect(() => (userId ? attach(userId) : undefined), [userId]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
  return snapshot.userId === userId ? snapshot : EMPTY;
}

/* -------------------------------------------------------------------------- */
/* Bell notifications for incoming messages                                   */
/* -------------------------------------------------------------------------- */

const notifiedKey = (userId: string) => `ascotworld:messages-notified:${userId}`;

/**
 * Raises a bell notification on *this* device for each conversation with a
 * new message from someone else. Remembers (per person, per device) the
 * newest message already announced, so a reload doesn't repeat them — and
 * the very first check on a device just records where things stand, rather
 * than announcing every old unread thread at once.
 */
function notifyNewArrivals(userId: string, conversations: Conversation[]): void {
  let seenUpTo: string | null = null;
  try {
    seenUpTo = window.localStorage.getItem(notifiedKey(userId));
  } catch {
    return; // no storage — skip notifications rather than repeat them forever
  }
  const newest = conversations.reduce((max, c) => (c.lastMessageAt > max ? c.lastMessageAt : max), seenUpTo ?? "");

  if (seenUpTo !== null) {
    const open = new URLSearchParams(window.location.search).get("c");
    const staffById = new Map(staffCollection.all().map((s) => [s.id, s]));
    for (const c of conversations) {
      const fresh = c.lastMessageAt > seenUpTo && c.lastSenderId && c.lastSenderId !== userId;
      const alreadyLooking = window.location.pathname === "/messages" && open === c.id;
      if (!fresh || alreadyLooking || !hasUnread(c, userId)) continue;
      pushNotification({
        recipientId: userId,
        type: "message",
        title: `New message from ${staffById.get(c.lastSenderId!)?.name ?? "a colleague"}`,
        body: c.preview ?? "",
        href: `/messages?c=${c.id}`,
      });
    }
  }
  try {
    if (newest) window.localStorage.setItem(notifiedKey(userId), newest);
  } catch {
    // Nothing to do — worst case a notification repeats after a reload.
  }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

const threadListeners = new Map<string, Set<() => void>>();

function refreshThread(conversationId: string): void {
  threadListeners.get(conversationId)?.forEach((listener) => listener());
}

/** Starts a conversation with an opening message. Resolves to its id — an
 *  existing 1:1 thread with the same person is reused. */
export async function startConversation(
  participantIds: string[],
  creatorId: string,
  firstMessage: string,
  title: string | null = null,
): Promise<string> {
  const { conversationId } = await apiFetch<{ conversationId: string }>("/api/messages/conversations", creatorId, {
    method: "POST",
    body: JSON.stringify({ participantIds, title, body: firstMessage }),
  });
  await refreshConversations();
  refreshThread(conversationId);
  return conversationId;
}

export async function sendMessage(conversationId: string, senderId: string, body: string): Promise<Message> {
  const { message } = await apiFetch<{ message: Message }>(
    `/api/messages/conversations/${conversationId}/messages`,
    senderId,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  refreshThread(conversationId);
  void refreshConversations();
  return message;
}

const readInFlight = new Set<string>();

/** Marks the thread read for this user, if there's anything unread in it. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation || !hasUnread(conversation, userId) || readInFlight.has(conversationId)) return;
  readInFlight.add(conversationId);
  // Show it read straight away rather than waiting for the round trip.
  setState({
    ...state,
    conversations: state.conversations.map((c) =>
      c.id === conversationId ? { ...c, lastReadAt: { ...c.lastReadAt, [userId]: c.lastMessageAt } } : c,
    ),
  });
  try {
    await apiFetch(`/api/messages/conversations/${conversationId}/read`, userId, { method: "POST" });
  } finally {
    readInFlight.delete(conversationId);
  }
}

/** Pins or unpins a conversation — personal to `userId`, not shared. */
export async function togglePinConversation(conversationId: string, userId: string): Promise<void> {
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;
  const pinned = !isPinnedBy(conversation, userId);
  setState({
    ...state,
    conversations: state.conversations.map((c) => (c.id === conversationId ? { ...c, pinnedBy: pinned ? [userId] : [] } : c)),
  });
  try {
    await apiFetch(`/api/messages/conversations/${conversationId}/pin`, userId, {
      method: "POST",
      body: JSON.stringify({ pinned }),
    });
  } finally {
    void refreshConversations();
  }
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/** Every conversation `userId` is part of — pinned first, newest first within each. */
export function useConversationsFor(userId: string | undefined) {
  const { conversations, ready, error } = useConversationState(userId);
  const sorted = useMemo(
    () =>
      userId
        ? conversations
            .slice()
            .sort(
              (a, b) =>
                Number(isPinnedBy(b, userId)) - Number(isPinnedBy(a, userId)) ||
                b.lastMessageAt.localeCompare(a.lastMessageAt),
            )
        : [],
    [conversations, userId],
  );
  return { conversations: sorted, ready, error };
}

/**
 * One thread's messages, re-checked every few seconds while it's open, and
 * immediately whenever this device sends into it.
 */
export function useMessagesFor(conversationId: string | undefined, userId: string | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; messages: Message[] } | null>(null);

  useEffect(() => {
    if (!conversationId || !userId) return;
    let cancelled = false;
    const load = () =>
      apiFetch<{ messages: Message[] }>(`/api/messages/conversations/${conversationId}/messages`, userId).then(
        (result) => {
          if (!cancelled) setLoaded({ id: conversationId, messages: result.messages });
        },
        () => {
          // A failed re-check keeps the thread on screen; the next one retries.
        },
      );
    load();
    const listeners = threadListeners.get(conversationId) ?? new Set();
    listeners.add(load);
    threadListeners.set(conversationId, listeners);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, THREAD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      listeners.delete(load);
    };
  }, [conversationId, userId]);

  const current = loaded && loaded.id === conversationId ? loaded.messages : null;
  return { messages: current ?? [], ready: current !== null };
}

/** Total number of conversations with something unread — used for nav badges. */
export function useUnreadMessageCount(userId: string | undefined): number {
  const { conversations } = useConversationState(userId);
  return useMemo(() => {
    if (!userId) return 0;
    return conversations.filter((c) => hasUnread(c, userId)).length;
  }, [conversations, userId]);
}
