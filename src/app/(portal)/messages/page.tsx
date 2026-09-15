"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, isSameDay } from "date-fns";
import {
  CaretLeft,
  Check,
  MagnifyingGlass,
  PaperPlaneRight,
  PencilSimple,
  PushPin,
} from "@phosphor-icons/react/dist/ssr";
import { StaffStack } from "@/components/domain";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  conversationLabel,
  hasUnread,
  isPinnedBy,
  markConversationRead,
  sendMessage,
  startConversation,
  togglePinConversation,
  useConversationsFor,
  useMessagesFor,
} from "@/lib/messaging";
import { messageCollection, staffCollection } from "@/lib/seed";
import { useCollection } from "@/lib/storage";
import type { Conversation, StaffMember } from "@/lib/types";

function messageTime(iso: string): string {
  const date = new Date(iso);
  return isSameDay(date, new Date()) ? format(date, "HH:mm") : format(date, "d MMM");
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <MessagesView />
    </Suspense>
  );
}

function MessagesView() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");

  const { conversations, ready } = useConversationsFor(user?.id);
  const { items: staff } = useCollection(staffCollection);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const [composing, setComposing] = useState(false);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  function openConversation(id: string) {
    router.push(`/messages?c=${id}`);
  }

  return (
    <>
      <PageHeader
        title="Messages"
        description="Direct messages with anyone on site — keep work conversations here."
        actions={
          <Button
            variant="primary"
            icon={<PencilSimple size={16} weight="bold" />}
            onClick={() => setComposing(true)}
          >
            New message
          </Button>
        }
      />

      {!ready ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : conversations.length === 0 ? (
        <Card>
          <EmptyState
            title="No conversations yet"
            description="Start one with anyone on site — this is where work communication belongs."
            action={<Button variant="primary" onClick={() => setComposing(true)}>New message</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <ConversationList
            conversations={conversations}
            staffById={staffById}
            currentUserId={user!.id}
            selectedId={selectedId}
            onSelect={openConversation}
            className={selectedId ? "hidden lg:block" : "block"}
          />
          <ThreadPanel
            conversation={selected}
            staffById={staffById}
            currentUserId={user!.id}
            className={selectedId ? "flex" : "hidden lg:flex"}
          />
        </div>
      )}

      {composing ? (
        <ComposeDialog
          currentUser={user!}
          staff={staff}
          onClose={() => setComposing(false)}
          onSent={(conversationId) => {
            setComposing(false);
            openConversation(conversationId);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Conversation list                                                          */
/* -------------------------------------------------------------------------- */

function ConversationList({
  conversations,
  staffById,
  currentUserId,
  selectedId,
  onSelect,
  className = "",
}: {
  conversations: Conversation[];
  staffById: Map<string, StaffMember>;
  currentUserId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const { items: allMessages } = useCollection(messageCollection);
  // Messages are append-only and created in chronological order, so the last
  // occurrence for a conversation in this array is its most recent message.
  const previewByConversation = useMemo(() => {
    const map = new Map<string, string>();
    allMessages.forEach((m) => map.set(m.conversationId, m.body));
    return map;
  }, [allMessages]);

  const pinned = conversations.filter((c) => isPinnedBy(c, currentUserId));
  const rest = conversations.filter((c) => !isPinnedBy(c, currentUserId));

  return (
    <Card padded={false} className={`overflow-hidden lg:h-[70vh] ${className}`}>
      <ul className="h-full divide-y divide-[var(--border)] overflow-y-auto">
        {pinned.length > 0 ? (
          <>
            <SectionLabel text="Pinned" />
            {pinned.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                staffById={staffById}
                currentUserId={currentUserId}
                selectedId={selectedId}
                onSelect={onSelect}
                preview={previewByConversation.get(conversation.id) ?? ""}
              />
            ))}
            {rest.length > 0 ? <SectionLabel text="All conversations" /> : null}
          </>
        ) : null}
        {rest.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            staffById={staffById}
            currentUserId={currentUserId}
            selectedId={selectedId}
            onSelect={onSelect}
            preview={previewByConversation.get(conversation.id) ?? ""}
          />
        ))}
      </ul>
    </Card>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <li
      className="bg-[var(--surface-sunken)] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--subtle-foreground)]"
      aria-hidden="true"
    >
      {text}
    </li>
  );
}

function ConversationRow({
  conversation,
  staffById,
  currentUserId,
  selectedId,
  onSelect,
  preview,
}: {
  conversation: Conversation;
  staffById: Map<string, StaffMember>;
  currentUserId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  preview: string;
}) {
  const unread = hasUnread(conversation, currentUserId);
  const pinned = isPinnedBy(conversation, currentUserId);
  const others = conversation.participantIds
    .filter((id) => id !== currentUserId)
    .map((id) => staffById.get(id))
    .filter((s): s is StaffMember => Boolean(s));

  return (
    <li className="relative">
      <button
        onClick={() => onSelect(conversation.id)}
        aria-current={selectedId === conversation.id ? "true" : undefined}
        className={`flex w-full cursor-pointer items-start gap-2.5 py-2.5 pl-3 pr-9 text-left
          transition-colors duration-150 hover:bg-[var(--surface-sunken)]
          ${selectedId === conversation.id ? "bg-[var(--brand-50)]" : ""}`}
      >
        <StaffStack people={others.slice(0, 2)} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-[13px] ${unread ? "font-extrabold text-foreground" : "font-bold text-foreground"}`}
            >
              {conversationLabel(conversation, currentUserId, staffById)}
            </span>
            <span className="tabular shrink-0 text-[10px] font-semibold text-[var(--subtle-foreground)]">
              {messageTime(conversation.lastMessageAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {unread ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]"
                aria-hidden="true"
              />
            ) : null}
            <span
              className={`truncate text-xs ${unread ? "font-semibold text-foreground" : "text-[var(--muted-foreground)]"}`}
            >
              {preview}
            </span>
          </span>
        </span>
      </button>

      <button
        onClick={() => togglePinConversation(conversation.id, currentUserId)}
        aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
        aria-pressed={pinned}
        className={`absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center
          rounded-md transition-colors duration-150 hover:bg-[var(--surface-sunken)]
          ${pinned ? "text-[var(--brand-500)]" : "text-[var(--subtle-foreground)] hover:text-foreground"}`}
      >
        <PushPin size={14} weight={pinned ? "fill" : "regular"} />
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Thread                                                                     */
/* -------------------------------------------------------------------------- */

function ThreadPanel({
  conversation,
  staffById,
  currentUserId,
  className = "",
}: {
  conversation: Conversation | null;
  staffById: Map<string, StaffMember>;
  currentUserId: string;
  className?: string;
}) {
  const { messages } = useMessagesFor(conversation?.id);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mark read whenever the thread is open and up to date with new arrivals.
  useEffect(() => {
    if (conversation) markConversationRead(conversation.id, currentUserId);
  }, [conversation, conversation?.lastMessageAt, currentUserId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, conversation?.id]);

  if (!conversation) {
    return (
      <Card className={`flex-col items-center justify-center lg:h-[70vh] ${className}`}>
        <EmptyState
          title="Select a conversation"
          description="Choose someone from the list, or start a new message."
        />
      </Card>
    );
  }

  const others = conversation.participantIds
    .filter((id) => id !== currentUserId)
    .map((id) => staffById.get(id))
    .filter((s): s is StaffMember => Boolean(s));

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !conversation) return;
    sendMessage(conversation.id, currentUserId, body);
    setDraft("");
  }

  return (
    <Card padded={false} className={`flex-col overflow-hidden lg:h-[70vh] ${className}`}>
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3 py-2.5">
        <Link
          href="/messages"
          aria-label="Back to conversations"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-[var(--muted-foreground)]
            transition-colors duration-150 hover:bg-[var(--surface-sunken)] hover:text-foreground lg:hidden"
        >
          <CaretLeft size={16} weight="bold" />
        </Link>
        <StaffStack people={others.slice(0, 3)} />
        <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-foreground">
          {conversationLabel(conversation, currentUserId, staffById)}
        </span>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {messages.map((message, i) => {
          const own = message.senderId === currentUserId;
          const prev = messages[i - 1];
          const showSender = !own && (!prev || prev.senderId !== message.senderId);
          const sender = staffById.get(message.senderId);

          return (
            <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[80%] items-end gap-2 ${own ? "flex-row-reverse" : ""}`}>
                {!own ? (
                  <span className={showSender ? "opacity-100" : "invisible"}>
                    <Avatar initials={sender?.initials ?? "?"} size={24} title={sender?.name} />
                  </span>
                ) : null}
                <div>
                  {showSender ? (
                    <p className="mb-0.5 px-1 text-[11px] font-bold text-[var(--muted-foreground)]">
                      {sender?.name ?? "Former staff member"}
                    </p>
                  ) : null}
                  <div
                    className={`rounded-lg px-3 py-2 text-[13px] leading-snug ${
                      own
                        ? "rounded-br-sm bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "rounded-bl-sm bg-[var(--surface-sunken)] text-foreground"
                    }`}
                  >
                    {message.body}
                  </div>
                  <p
                    className={`tabular mt-0.5 px-1 text-[10px] text-[var(--subtle-foreground)] ${own ? "text-right" : ""}`}
                  >
                    {messageTime(message.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-[var(--border)] p-2.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          aria-label="Message"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<PaperPlaneRight size={16} weight="fill" />}
          disabled={!draft.trim()}
        >
          Send
        </Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Compose dialog                                                             */
/* -------------------------------------------------------------------------- */

function ComposeDialog({
  currentUser,
  staff,
  onClose,
  onSent,
}: {
  currentUser: StaffMember;
  staff: readonly StaffMember[];
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const others = staff.filter((s) => s.id !== currentUser.id);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? others.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.jobTitle.toLowerCase().includes(query) ||
          p.department.toLowerCase().includes(query),
      )
    : others;

  function switchMode(next: "dm" | "group") {
    setMode(next);
    setSelectedIds(new Set());
    setError(null);
  }

  /** Direct messages replace the pick; groups toggle it like a checkbox. */
  function selectPerson(id: string) {
    setError(null);
    if (mode === "dm") {
      setSelectedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSend() {
    if (mode === "dm" && selectedIds.size !== 1) {
      return setError("Choose who this is for.");
    }
    if (mode === "group" && selectedIds.size < 2) {
      return setError("Choose at least two people for a group.");
    }
    if (!body.trim()) return setError("Write a message before sending.");

    const conversation = startConversation(
      [currentUser.id, ...selectedIds],
      currentUser.id,
      body,
      mode === "group" ? groupTitle.trim() || null : null,
    );
    onSent(conversation.id);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New message"
      description="Pick who this is for — this is a demo, so everyone on site is reachable."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSend}>
            Send
          </Button>
        </>
      }
    >
      <div
        className="mb-4 inline-flex rounded-md border border-[var(--border-strong)] p-0.5"
        role="tablist"
        aria-label="Message type"
      >
        {(
          [
            { id: "dm", label: "Direct message" },
            { id: "group", label: "Group" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => switchMode(tab.id)}
            className={`cursor-pointer rounded px-3 py-1.5 text-[13px] font-bold transition-colors duration-150 ${
              mode === tab.id
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-[var(--muted-foreground)] hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        <Field
          label={mode === "group" ? "Members" : "To"}
          htmlFor="compose-search"
          required
          error={error ?? undefined}
          helper={
            mode === "group"
              ? `${selectedIds.size} selected — choose at least two`
              : undefined
          }
        >
          <div className="relative mb-1.5">
            <MagnifyingGlass
              size={15}
              weight="bold"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--subtle-foreground)]"
            />
            <Input
              id="compose-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role or department…"
              className="pl-8"
              autoFocus
            />
          </div>

          <div
            id="compose-to"
            className="max-h-48 overflow-y-auto rounded-md border border-[var(--border-strong)]"
          >
            {filtered.length === 0 ? (
              <p className="px-2.5 py-4 text-center text-xs text-[var(--muted-foreground)]">
                No one matches “{search.trim()}”.
              </p>
            ) : null}
            {filtered.map((person) => {
              const checked = selectedIds.has(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => selectPerson(person.id)}
                  aria-pressed={checked}
                  className={`flex w-full cursor-pointer items-center gap-2.5 border-b border-[var(--border)]
                    px-2.5 py-2 text-left transition-colors duration-150 last:border-b-0
                    hover:bg-[var(--surface-sunken)] ${checked ? "bg-[var(--brand-50)]" : ""}`}
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center border-2 transition-colors duration-150
                      ${mode === "dm" ? "rounded-full" : "rounded"}
                      ${
                        checked
                          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "border-[var(--border-strong)]"
                      }`}
                    aria-hidden="true"
                  >
                    {checked ? <Check size={12} weight="bold" /> : null}
                  </span>
                  <Avatar initials={person.initials} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-foreground">
                      {person.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                      {person.jobTitle}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        {mode === "group" ? (
          <Field
            label="Group name"
            htmlFor="compose-title"
            helper="Optional — leave blank to list everyone's names instead."
          >
            <Input
              id="compose-title"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="e.g. Tacrolimus line changeover"
            />
          </Field>
        ) : null}

        <Field label="Message" htmlFor="compose-body" required>
          <Textarea
            id="compose-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What do you need to say?"
          />
        </Field>
      </div>
    </Modal>
  );
}
