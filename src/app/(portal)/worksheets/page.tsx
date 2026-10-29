"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowCounterClockwise,
  Archive,
  CheckCircle,
  DownloadSimple,
  Eye,
  FileText,
  MagnifyingGlass,
  UploadSimple,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { WorksheetPreview } from "@/components/worksheets/WorksheetPreview";
import { useAuth } from "@/lib/auth";
import { useProductSuggestions } from "@/lib/batchBook";
import { ROLES, type Role } from "@/lib/types";
import {
  WORKSHEET_ACCEPT,
  WORKSHEET_MAX_BYTES,
  formatFileSize,
  sameProduct,
  worksheetContentType,
} from "@/lib/worksheetRules";
import {
  downloadWorksheetFile,
  fetchWorksheetAccess,
  moveWorksheet,
  setWorksheetAccess,
  uploadWorksheet,
  useWorksheets,
  type Worksheet,
  type WorksheetAccessEntry,
} from "@/lib/worksheets";

type Tab = "APPROVED" | "ARCHIVED";

/**
 * Worksheets (BMRs) for every product. Approved holds the version in use;
 * when a new version is uploaded the old one moves to Archived, so every
 * version stays on record. Everyone can view and download them; uploading
 * and moving them is for the people an admin gives access to (the senior
 * pharmacist and production manager) — the server enforces the same.
 */
export default function WorksheetsPage() {
  const { user } = useAuth();
  const { worksheets, canManage, ready, error, refresh } = useWorksheets();
  const [tab, setTab] = useState<Tab>("APPROVED");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [moving, setMoving] = useState<Worksheet | null>(null);
  const [managingAccess, setManagingAccess] = useState(false);
  const [previewing, setPreviewing] = useState<Worksheet | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      APPROVED: worksheets.filter((w) => w.status === "APPROVED").length,
      ARCHIVED: worksheets.filter((w) => w.status === "ARCHIVED").length,
    }),
    [worksheets],
  );

  const query = search.trim().toLowerCase();
  const shown = worksheets.filter(
    (w) =>
      w.status === tab &&
      (!query ||
        [w.productName, w.version, w.reference ?? "", w.fileName].some((field) => field.toLowerCase().includes(query))),
  );

  if (!user) return null;
  const isAdmin = user.role === "admin";

  /** Saves the file to the device, under its original name. */
  async function downloadFile(worksheet: Worksheet) {
    if (!user) return;
    setFileError(null);
    try {
      const blob = await downloadWorksheetFile(user.id, worksheet);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = worksheet.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Couldn't download that file.");
    }
  }

  return (
    <>
      <PageHeader
        title="Worksheets"
        description="Batch manufacturing records (BMRs) for every product. Approved is the version in use; older versions move to Archived when a new one is uploaded."
        actions={
          <>
            {isAdmin ? (
              <Button size="sm" variant="secondary" onClick={() => setManagingAccess(true)}>
                <UserGear size={15} weight="bold" />
                Who can upload
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" variant="primary" onClick={() => setUploading(true)}>
                <UploadSimple size={15} weight="bold" />
                Upload worksheet
              </Button>
            ) : null}
          </>
        }
      />

      {ready && !canManage ? (
        <div className="mb-4">
          <PermissionNotice message="You can view and download worksheets. Uploading and moving them is for the people an admin has given access to." />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TabSwitch tab={tab} counts={counts} onChange={setTab} />
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">Search worksheets</span>
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle-foreground)]"
          />
          <Input
            className="h-9 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Product, version, reference or file…"
          />
        </label>
      </div>

      {error ? (
        <div className="mb-3">
          <ErrorNotice message={error} />
        </div>
      ) : null}
      {fileError ? (
        <div className="mb-3">
          <ErrorNotice message={fileError} />
        </div>
      ) : null}

      {!ready ? (
        <Skeleton className="h-48 w-full" />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            title={
              query
                ? "No worksheets match that search"
                : tab === "APPROVED"
                  ? "No approved worksheets yet"
                  : "Nothing archived yet"
            }
            description={
              query
                ? "Try the product name, version or document reference."
                : tab === "APPROVED"
                  ? canManage
                    ? "Upload a product's worksheet and it appears here for everyone."
                    : "Once worksheets are uploaded they'll appear here."
                  : "When a new version of a worksheet is uploaded, the old one moves here."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">Version</th>
                  <th className="px-4 py-2.5">File</th>
                  <th className="px-4 py-2.5">Uploaded</th>
                  {tab === "ARCHIVED" ? <th className="px-4 py-2.5">Archived</th> : null}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((worksheet) => (
                  <WorksheetRow
                    key={worksheet.id}
                    worksheet={worksheet}
                    canManage={canManage}
                    onView={() => setPreviewing(worksheet)}
                    onDownload={() => void downloadFile(worksheet)}
                    onMove={() => setMoving(worksheet)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {uploading ? (
        <UploadModal
          staffId={user.id}
          worksheets={worksheets}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            setTab("APPROVED");
            refresh();
          }}
        />
      ) : null}

      {moving ? (
        <MoveModal
          staffId={user.id}
          worksheet={moving}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            refresh();
          }}
        />
      ) : null}

      {previewing ? (
        <WorksheetPreview
          staffId={user.id}
          worksheet={previewing}
          onClose={() => setPreviewing(null)}
          onDownload={() => void downloadFile(previewing)}
        />
      ) : null}

      {managingAccess ? (
        <AccessModal staffId={user.id} onClose={() => setManagingAccess(false)} onChanged={refresh} />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function TabSwitch({
  tab,
  counts,
  onChange,
}: {
  tab: Tab;
  counts: Record<Tab, number>;
  onChange: (tab: Tab) => void;
}) {
  const options: { value: Tab; label: string; icon: typeof Archive }[] = [
    { value: "APPROVED", label: "Approved", icon: CheckCircle },
    { value: "ARCHIVED", label: "Archived", icon: Archive },
  ];
  return (
    <div
      role="tablist"
      aria-label="Worksheet status"
      className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = tab === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
              active
                ? "bg-[var(--surface)] text-foreground shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-foreground"
            }`}
          >
            <Icon size={15} weight={active ? "fill" : "bold"} />
            {label}
            <span className="tabular-nums text-[var(--muted-foreground)]">{counts[value]}</span>
          </button>
        );
      })}
    </div>
  );
}

function when(iso: string): string {
  return format(new Date(iso), "d MMM yyyy");
}

function WorksheetRow({
  worksheet,
  canManage,
  onView,
  onDownload,
  onMove,
}: {
  worksheet: Worksheet;
  canManage: boolean;
  onView: () => void;
  onDownload: () => void;
  onMove: () => void;
}) {
  const archived = worksheet.status === "ARCHIVED";
  return (
    <tr className="border-b border-[var(--border)] align-top last:border-b-0">
      <td className="px-4 py-3">
        <p className="font-semibold text-foreground">{worksheet.productName}</p>
        {worksheet.reference ? (
          <p className="font-mono text-[12px] text-[var(--muted-foreground)]">{worksheet.reference}</p>
        ) : null}
        {worksheet.notes ? <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{worksheet.notes}</p> : null}
      </td>
      <td className="px-4 py-3 font-semibold">{worksheet.version}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onView}
          className="inline-flex max-w-[220px] cursor-pointer items-start gap-1.5 text-left text-[var(--primary)] hover:underline"
          title="View it here"
        >
          <FileText size={16} weight="duotone" className="mt-px shrink-0" />
          <span className="break-all">{worksheet.fileName}</span>
        </button>
        <p className="mt-0.5 pl-[22px] text-xs text-[var(--muted-foreground)]">{formatFileSize(worksheet.sizeBytes)}</p>
      </td>
      <td className="px-4 py-3">
        <p>{when(worksheet.uploadedAt)}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{worksheet.uploadedByName}</p>
      </td>
      {archived ? (
        <td className="px-4 py-3">
          <p>{worksheet.archivedAt ? when(worksheet.archivedAt) : "—"}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {[worksheet.archivedByName, worksheet.archivedNote].filter(Boolean).join(" · ")}
          </p>
        </td>
      ) : null}
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="primary" onClick={onView} aria-label={`View ${worksheet.fileName}`}>
            <Eye size={15} weight="bold" />
            View
          </Button>
          <Button size="sm" variant="secondary" onClick={onDownload} aria-label={`Download ${worksheet.fileName}`}>
            <DownloadSimple size={15} weight="bold" />
            Download
          </Button>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={onMove}>
              {archived ? <ArrowCounterClockwise size={15} weight="bold" /> : <Archive size={15} weight="bold" />}
              {archived ? "Restore" : "Archive"}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */

function UploadModal({
  staffId,
  worksheets,
  onClose,
  onUploaded,
}: {
  staffId: string;
  worksheets: Worksheet[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [productName, setProductName] = useState("");
  const [version, setVersion] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  /** Current approved versions the uploader chose to keep approved — all
   *  others for the product are archived when this upload finishes. */
  const [keepApproved, setKeepApproved] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Suggest products already in the Batch Book once typing pauses.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(productName), 200);
    return () => window.clearTimeout(timer);
  }, [productName]);
  const { suggestions } = useProductSuggestions(query);
  const productOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const w of worksheets) names.set(w.productName.toLowerCase(), w.productName);
    for (const s of suggestions) names.set(s.productName.toLowerCase(), s.productName);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [worksheets, suggestions]);

  /** The product's current approved worksheet(s) — what this upload
   *  replaces. */
  const current = productName.trim()
    ? worksheets.filter((w) => w.status === "APPROVED" && sameProduct(w.productName, productName))
    : [];
  const archiveIds = current.filter((w) => !keepApproved.has(w.id)).map((w) => w.id);

  const fileProblem = !file
    ? null
    : !worksheetContentType(file.name)
      ? "Worksheets must be a PDF, Word or Excel file."
      : file.size > WORKSHEET_MAX_BYTES
        ? `That file is ${formatFileSize(file.size)} — worksheets can be up to ${formatFileSize(WORKSHEET_MAX_BYTES)}.`
        : file.size === 0
          ? "That file is empty."
          : null;
  const busy = progress !== null;
  const ready = productName.trim() && version.trim() && file && !fileProblem;

  async function submit() {
    if (!file || !ready) return;
    setSubmitError(null);
    setProgress(0);
    try {
      await uploadWorksheet(staffId, file, { productName, version, reference, notes }, archiveIds, setProgress);
      onUploaded();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "The upload failed — try again.");
      setProgress(null);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Upload worksheet"
      description="It goes straight into Approved. If the product already has an approved worksheet, the old one moves to Archived."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<UploadSimple size={15} weight="bold" />}
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {submitError ? <ErrorNotice message={submitError} /> : null}

        <Field label="Product" htmlFor="ws-product" required>
          <Input
            id="ws-product"
            list="ws-product-options"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Paracetamol 500mg Tablets"
            autoComplete="off"
            disabled={busy}
          />
          <datalist id="ws-product-options">
            {productOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Version" htmlFor="ws-version" required helper="As printed on the worksheet, e.g. 4 or 2.1">
            <Input id="ws-version" value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Document reference" htmlFor="ws-reference" helper="Optional, e.g. BMR-0142">
            <Input id="ws-reference" value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} />
          </Field>
        </div>

        <Field
          label="File"
          htmlFor="ws-file"
          required
          error={fileProblem ?? undefined}
          helper={`PDF, Word or Excel, up to ${formatFileSize(WORKSHEET_MAX_BYTES)}`}
        >
          <input
            id="ws-file"
            type="file"
            accept={WORKSHEET_ACCEPT}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-foreground
              file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[var(--surface-sunken)] file:px-2.5 file:py-1.5 file:text-[13px] file:font-semibold file:text-foreground"
          />
        </Field>

        <Field label="Notes" htmlFor="ws-notes" helper="Optional — e.g. what changed in this version">
          <Textarea id="ws-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </Field>

        {current.length > 0 ? (
          <fieldset className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5">
            <legend className="px-1 text-xs font-bold text-foreground">Current approved worksheet</legend>
            <ul className="grid gap-1.5">
              {current.map((w) => (
                <li key={w.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 cursor-pointer"
                      checked={!keepApproved.has(w.id)}
                      disabled={busy}
                      onChange={(e) =>
                        setKeepApproved((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(w.id);
                          else next.add(w.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      Move <strong>version {w.version}</strong> ({w.fileName}) to Archived
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {busy ? (
          <div
            className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress ?? 0) * 100)}
            aria-label="Upload progress"
          >
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
              style={{ width: `${Math.max(4, (progress ?? 0) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function MoveModal({
  staffId,
  worksheet,
  onClose,
  onMoved,
}: {
  staffId: string;
  worksheet: Worksheet;
  onClose: () => void;
  onMoved: () => void;
}) {
  const archiving = worksheet.status === "APPROVED";
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setSaveError(null);
    try {
      await moveWorksheet(staffId, worksheet.id, archiving ? "ARCHIVED" : "APPROVED", archiving ? note : undefined);
      onMoved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "That didn't work — try again.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={archiving ? "Move to Archived" : "Restore to Approved"}
      description={`${worksheet.productName} — version ${worksheet.version}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Working…" : archiving ? "Move to Archived" : "Restore"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {saveError ? <ErrorNotice message={saveError} /> : null}
        {archiving ? (
          <Field label="Reason" htmlFor="ws-archive-note" helper="Optional — e.g. superseded, product discontinued">
            <Textarea id="ws-archive-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            It goes back into Approved alongside anything already approved for this product — archive the other one
            if this replaces it.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function AccessModal({ staffId, onClose, onChanged }: { staffId: string; onClose: () => void; onChanged: () => void }) {
  const [people, setPeople] = useState<WorksheetAccessEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorksheetAccess(staffId)
      .then(({ people }) => {
        if (!cancelled) setPeople(people);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load the team.");
      });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  async function toggle(person: WorksheetAccessEntry) {
    setSavingId(person.staffId);
    setLoadError(null);
    try {
      const { people } = await setWorksheetAccess(staffId, person.staffId, !person.hasAccess);
      setPeople(people);
      onChanged();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "That didn't save — try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Who can upload worksheets"
      description="People with access can upload worksheets and move them between Approved and Archived. Everyone else can view and download them. Admins always have access."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-3">
        {loadError ? <ErrorNotice message={loadError} /> : null}
        {!people ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ul className="grid gap-1">
            {people.map((person) => {
              const admin = person.role === "admin";
              return (
                <li key={person.staffId}>
                  <label
                    className={`flex items-center gap-3 rounded-md px-2 py-2 ${admin ? "" : "cursor-pointer hover:bg-[var(--surface-sunken)]"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                      checked={person.hasAccess}
                      disabled={admin || savingId !== null}
                      onChange={() => void toggle(person)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        {[ROLES[person.role as Role]?.label ?? person.role, person.department].filter(Boolean).join(" · ")}
                        {admin ? " · always has access" : ""}
                      </span>
                    </span>
                    {savingId === person.staffId ? (
                      <span className="text-xs text-[var(--muted-foreground)]">Saving…</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
