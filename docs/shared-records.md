# Shared records — Task planner, Batch schedule, Team & rota, notifications

These sections started out storing everything in each browser's own
storage, so a task added on a phone never reached a PC. They now live in
Postgres (Supabase) and every device sees the same data.

## How it works

- **Storage:** one table, `app_records` (`collection`, `id`, `data` as JSON),
  migration `drizzle/0004_*.sql`. Each record is kept whole, in exactly the
  shape the pages already used, so the pages themselves didn't change.
- **Client:** `src/lib/storage.ts`. `createCollection` keeps its synchronous
  API — a change shows immediately on the device that made it and is saved
  in the background (rolled back if the server refuses it). Open pages
  re-check every 5s and when a tab comes back into view; a request carries
  a version, so an unchanged collection costs a tiny response.
- **First run:** the first device to open the portal against an empty
  database fills each collection with the sample data from `src/lib/seed.ts`.
- **Staff mirror:** saving a staff record also updates the `staff` table the
  Batch Book, MES and messaging use, so someone added on the Team page can
  sign in and use those sections, and a role change there takes effect on
  the server too.

## Endpoints (header `x-staff-id`)

| Endpoint | Does |
|---|---|
| `GET /api/records/:collection?version=` | Everything the caller may see, or `{ unchanged: true }`. |
| `PUT /api/records/:collection/:id` | Create or replace one record (body = the record). |
| `DELETE /api/records/:collection/:id` | Delete one. |
| `POST /api/records/:collection` | `{ items }` — sample data for an **empty** collection; ignored otherwise. |
| `POST /api/records/reset` | Admin only — wipe every collection so the next page load reseeds the samples. |

## Who can do what (`src/server/records/rules.ts`)

| Collection | Read | Change |
|---|---|---|
| `staff`, `departments` | anyone (sign-in needs the list) | `team.manage` |
| `tasks` | signed in | any task capability |
| `batches` (schedule) | signed in | any schedule batch capability |
| `shifts` (rota) | signed in | `rota.manage` |
| `notifications` | only your own | anyone may send one to someone; only the recipient may mark it read or delete it |

Same demo trust boundary as the rest of the API: the caller is whoever the
`x-staff-id` header names (see `src/server/auth/requireStaff.ts`).

## Reset demo data

Now resets the data **for everyone**, so only admins see the control and the
server refuses anyone else.
