# Worksheets (BMRs) — API & schema reference

The Worksheets section (`/worksheets`) holds each product's worksheet
(batch manufacturing record). **Approved** is the version in use;
**Archived** holds older versions — uploading a new version offers to move
the product's current approved one there, noted "Replaced by version N".
Nothing is deleted.

**Who can do what** (`src/server/worksheets/validation.ts`):

- Everyone signed in can view and download approved and archived worksheets.
- Uploading and moving them between Approved and Archived is for people
  given access — the senior pharmacist and the production manager — and
  admins, who always have it.
- Only an admin grants or removes access ("Who can upload" on the page).
  It's per person, not per role: a row in `worksheet_editors`.

## Schema

| Table | Purpose |
|---|---|
| `worksheets` | One per uploaded file: product, version, optional reference and notes, file details, status (`UPLOADING` → `APPROVED` ⇄ `ARCHIVED`), who uploaded/archived it and when. |
| `worksheet_file_chunks` | The file itself, in pieces of up to 3 MB. |
| `worksheet_editors` | Who has worksheet access, and who granted it. |

Files live in Postgres because the project has no file storage set up. They
go up and come down in 3 MB pieces because one request to the hosted site
(Vercel) can't carry more than about 4.5 MB. Files can be PDF, Word or Excel,
up to 25 MB (`src/lib/worksheetRules.ts`). An upload abandoned part-way is
cleared out after a day.

## Endpoints

All take the `x-staff-id` header (see the demo-auth note in
`docs/batch-book-api.md`).

| Method & path | Who | What |
|---|---|---|
| `GET /api/worksheets` | anyone | `{ worksheets, canManage }` — approved and archived ones. |
| `POST /api/worksheets` | access | Starts an upload: `{ productName, version, reference?, notes?, fileName, sizeBytes }` → `{ id, chunkCount, chunkBytes }`. |
| `PUT /api/worksheets/:id/chunks/:index` | the uploader | One piece of the file as the raw body; resending replaces it. |
| `POST /api/worksheets/:id/complete` | the uploader | `{ archiveIds? }` — checks every piece arrived, approves the worksheet and archives the listed ones, in one transaction. |
| `GET /api/worksheets/:id/chunks/:index` | anyone | One piece of a finished worksheet's file. |
| `PATCH /api/worksheets/:id` | access | `{ status: "ARCHIVED", note? }` or `{ status: "APPROVED" }` (restore). |
| `GET /api/worksheets/access` | admin | Everyone active, with `hasAccess`. |
| `PUT /api/worksheets/access` | admin | `{ staffId, allowed }`. |

Rules are unit-tested in `src/server/worksheets/validation.test.ts`.
