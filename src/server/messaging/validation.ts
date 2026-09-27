/**
 * Pure rules for staff messaging — no DB here, so they're unit-testable
 * directly. Same Verdict shape as the MES and Batch Book validation.
 */

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 80;
export const MAX_PARTICIPANTS = 50;

export type Verdict<T> = { ok: true; value: T } | { ok: false; error: string };

/** A message body must have something in it once trimmed, and a sane length. */
export function checkMessageBody(body: unknown): Verdict<string> {
  if (typeof body !== "string" || !body.trim()) return { ok: false, error: "Write a message before sending." };
  const trimmed = body.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { ok: true, value: trimmed };
}

export interface NewConversation {
  /** Every participant, the creator included, each once, creator first. */
  participantIds: string[];
  title: string | null;
  body: string;
}

/**
 * Normalises a request to start a conversation: the creator is always a
 * participant, duplicates are dropped, and there must be at least one other
 * person — a conversation with only yourself in it isn't one.
 */
export function checkNewConversation(
  creatorId: string,
  input: { participantIds?: unknown; title?: unknown; body?: unknown },
): Verdict<NewConversation> {
  if (!Array.isArray(input.participantIds) || input.participantIds.some((id) => typeof id !== "string" || !id)) {
    return { ok: false, error: "Choose who this is for." };
  }
  const participantIds = [...new Set([creatorId, ...(input.participantIds as string[])])];
  if (participantIds.length < 2) return { ok: false, error: "Choose who this is for." };
  if (participantIds.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `A conversation can have at most ${MAX_PARTICIPANTS} people.` };
  }

  let title: string | null = null;
  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== "string") return { ok: false, error: "The group name must be text." };
    title = input.title.trim().slice(0, MAX_TITLE_LENGTH) || null;
  }

  const body = checkMessageBody(input.body);
  if (!body.ok) return body;

  return { ok: true, value: { participantIds, title, body: body.value } };
}

/** Two people, no group name — the case where an existing thread between
 *  them is reused rather than a second one opened. */
export function isDirectMessage(conversation: NewConversation): boolean {
  return conversation.participantIds.length === 2 && conversation.title === null;
}
