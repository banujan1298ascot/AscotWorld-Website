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

## Viewing in the page

**View** (or clicking the file name) opens the worksheet inside the portal —
`src/components/worksheets/WorksheetPreview.tsx`, with each renderer loaded
only when needed:

- **PDF** — drawn page by page with pdf.js (`pdfjs-dist`), not the browser's
  own viewer, because tablets and phones (Chrome on Android especially)
  won't show a PDF inside a page.
- **Word .docx** — laid out as pages with `docx-preview`; embedded HTML in a
  document isn't rendered.
- **Excel .xlsx / .xls** — each sheet as a plain table of values, read with
  SheetJS (`xlsx`, installed from SheetJS's own CDN as they recommend).
- **Old Word .doc** — can't be read in a browser; the viewer offers the
  download instead.

PDFs and Word documents fit the window's width. Zoom with the buttons, Ctrl +
scroll (or a trackpad pinch) — centred on the mouse — or Ctrl + / − / 0. PDF
zoom resizes instantly and redraws the pages on screen sharp once it stops;
pages out of view are kept at lower resolution to save memory. Archived
versions carry a warning that they're not the version in use.

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

## Generated worksheets

When Check 1 confirms a batch, the batch's worksheet is generated
(`src/server/worksheets/generate.ts`, called from
`POST /api/batch-book/:id/confirm`):

1. **Pick the master** (`matching.ts`): the approved worksheet whose product
   name, file name or reference contains every word of the medicine name, its
   strength ("20mg" — not "120mg") and its type ("tablet", "capsule", …). A
   pack count in the file name ("100s") must match the batch's pack size;
   ties go to the newest upload.
2. **Fill a copy** (`fill.ts` plans, pdf-lib draws): pdf.js reads where each
   label sits, and the value goes into the blank beside it — an underscore
   run, or for dates the day / month / year between the dots of
   `__ . __ . ____`. Labels: BATCH No. (every page), Batch size / Quantity
   (`____ x ____ capsules` gets quantity × pack size), Pack size, Date
   manufactured, Expiry date. A summary line goes across the top of page 1,
   and every page gets a "generated copy" footer naming the master, version,
   date and person.
3. **Save it** as a `GENERATED` worksheet with `batch_id` and
   `source_worksheet_id`, shown in the **Generated** tab. Generated copies
   can't be approved, archived or edited; the master is only ever read.

The confirm response carries `worksheet` — `{ status: "generated", filled,
notFound, … }`, or `no-match` / `unsupported` (Word/Excel masters can't be
filled yet) / `failed` with a message — and the Batch Book shows it. A batch
whose worksheet couldn't be made stays confirmed; **Worksheet** on its row
(`POST /api/worksheets/generate { batchId }`) generates it later, making a
new copy each time.

The batch's manufacture date and new **expiry date** (`batch_records.expiry_date`,
entered at Check 1, must be after manufacture) feed the dates.
