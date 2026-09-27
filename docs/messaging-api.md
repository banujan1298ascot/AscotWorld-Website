# Messaging — API reference

Staff messaging used to live in each browser's own storage, so a message
sent from a phone never reached anyone's PC. It now lives in Postgres
(Supabase), like the Batch Book and MES, so every device sees the same
conversations.

Same demo trust boundary as the rest of the API: every request carries an
`x-staff-id` header (see `src/server/auth/requireStaff.ts`). Every call only
ever sees or changes conversations the caller is a participant in — anything
else is a `404`, whether it exists or not.

## Tables

`src/server/db/schema/messaging.ts`, migration `drizzle/0003_*.sql`:

| Table | Holds |
|---|---|
| `conversations` | Title (groups only), who started it, `last_message_at` |
| `conversation_participants` | One row per person: their `last_read_at` and personal `pinned` flag |
| `messages` | Sender, body, time |

`conversation_participants.staff_id` deliberately has no foreign key: staff
added on the Team page still exist only in browser demo data, and they
should still be messageable.

## Endpoints

| Endpoint | Does |
|---|---|
| `GET /api/messages/conversations` | The caller's conversations, newest first, each with participants, read times, the caller's pin, and the latest message's text and sender. |
| `POST /api/messages/conversations` | `{ participantIds, title?, body }` → `{ conversationId }`. A plain 1:1 message to someone you already have a thread with goes into that thread. |
| `GET /api/messages/conversations/:id/messages` | The latest 300 messages, oldest first. |
| `POST /api/messages/conversations/:id/messages` | `{ body }` — sends; also marks the thread read for the sender. |
| `POST /api/messages/conversations/:id/read` | Marks the thread read for the caller. |
| `POST /api/messages/conversations/:id/pin` | `{ pinned }` — personal to the caller. |

## Staying up to date

There's no push channel yet (same as the MES board), so open pages
re-check: the conversation list every 4s, an open thread every 3s, and
immediately when the tab comes back into view. One shared poller serves
both the Messages page and the nav badge (`src/lib/messaging.ts`).

A bell notification for a new message is raised on the server when it's
sent (`notifyOthers` in `src/server/messaging/service.ts`), into the shared
notifications collection — so it reaches every device the recipient uses.

## Demo data

`npm run db:seed` adds three demo conversations — only when the
conversations table is empty, so it never piles demo threads on top of real
ones.
