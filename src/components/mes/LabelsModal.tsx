"use client";

import { useState, type FormEvent } from "react";
import { format } from "date-fns";
import { Printer } from "@phosphor-icons/react/dist/ssr";
import { Button, ErrorNotice, Field, Input, Modal, Skeleton } from "@/components/ui";
import type { BatchRecord } from "@/lib/batchBook";
import { useLabelRecord, type LabelPrintKind, type LabelRun } from "@/lib/mes";

/**
 * Labels printed for a batch at Check 2: the first print, then any reprints
 * or reruns, each kept as its own line so it's always clear how many were
 * printed first and how many again. Saving here updates the batch's Batch
 * Book record, which shows the totals but can't change them.
 */
export function LabelsModal({
  batch,
  stageName,
  canEdit,
  onClose,
  onSaved,
}: {
  batch: BatchRecord;
  stageName: string;
  /** Check 2 only — everyone else sees the record read-only. */
  canEdit: boolean;
  onClose: () => void;
  /** After a save, so the caller can refresh the batch's totals. */
  onSaved?: () => void;
}) {
  const { labels, error: loadError, ready, record } = useLabelRecord(batch.id);
  const [correcting, setCorrecting] = useState(false);

  const firstPrint = labels?.labelsPrinted ?? null;
  const reprinted = labels?.labelsReprinted ?? 0;

  async function save(kind: LabelPrintKind, quantity: number, reason: string) {
    await record({ kind, quantity, reason: reason.trim() || undefined });
    setCorrecting(false);
    onSaved?.();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Labels — ${batch.batchNumber ?? "batch"}`}
      description={batch.productName ?? undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-4">
        {loadError ? <ErrorNotice message={loadError} /> : null}

        {!ready ? (
          <Skeleton className="h-20 w-full" />
        ) : labels ? (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <Tile label="First print" value={firstPrint ?? "—"} />
              <Tile label="Reprinted" value={reprinted} />
              <Tile label="Total printed" value={firstPrint === null ? "—" : firstPrint + reprinted} strong />
            </dl>

            {canEdit ? (
              firstPrint === null ? (
                <RunForm
                  key="first"
                  title="Labels printed"
                  help="How many labels came off the first print for this batch."
                  submitLabel="Save first print"
                  reasonLabel={null}
                  onSubmit={(quantity, reason) => save("FIRST_PRINT", quantity, reason)}
                />
              ) : correcting ? (
                <RunForm
                  key="correct"
                  title="Correct the first print"
                  help={`Currently ${firstPrint}. The old figure stays in the history below.`}
                  submitLabel="Save correction"
                  reasonRequired
                  initialQuantity={String(firstPrint)}
                  onSubmit={(quantity, reason) => save("FIRST_PRINT", quantity, reason)}
                  onCancel={() => setCorrecting(false)}
                />
              ) : (
                <>
                  <RunForm
                    key={`reprint-${labels.runs.length}`}
                    title="Add a reprint or rerun"
                    help="Labels printed again for this batch — added on top of the first print."
                    submitLabel="Add reprint"
                    reasonLabel="Why was it reprinted? (optional)"
                    onSubmit={(quantity, reason) => save("REPRINT", quantity, reason)}
                  />
                  <button
                    type="button"
                    onClick={() => setCorrecting(true)}
                    className="justify-self-start cursor-pointer text-xs font-semibold text-[var(--primary)] hover:underline"
                  >
                    First print entered wrongly? Correct it
                  </button>
                </>
              )
            ) : (
              <p className="rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                Labels are recorded at {stageName} only.
              </p>
            )}

            <History runs={labels.runs} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** The batch's label totals at a glance, opening LabelsModal. Shows the
 *  first print and the reprints apart, never just one combined number. */
export function LabelsButton({
  batch,
  canEdit,
  onOpen,
}: {
  batch: BatchRecord;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const recorded = batch.labelsPrinted !== null;
  if (!recorded && !canEdit) {
    return <span className="text-xs text-[var(--subtle-foreground)]">No labels recorded</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors duration-150 ${
        recorded
          ? "border-[var(--border)] bg-[var(--surface)] text-foreground hover:bg-[var(--surface-sunken)]"
          : "border-dashed border-[var(--status-production)] bg-[var(--status-production-bg)] text-[var(--status-production)] hover:border-[var(--primary)]"
      }`}
    >
      <Printer size={13} weight="bold" className="shrink-0" />
      {recorded ? (
        <span className="truncate tabular-nums">
          {batch.labelsPrinted} printed
          {batch.labelsReprinted > 0 ? ` · ${batch.labelsReprinted} reprinted` : ""}
        </span>
      ) : (
        "Record labels"
      )}
    </button>
  );
}

function Tile({ label, value, strong }: { label: string; value: number | string; strong?: boolean }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        strong ? "border-[var(--status-production)] bg-[var(--status-production-bg)]" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <dt
        className={`text-[11px] font-bold uppercase tracking-wide ${
          strong ? "text-[var(--status-production)]" : "text-[var(--muted-foreground)]"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-xl font-extrabold tabular-nums ${strong ? "text-[var(--status-production)]" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function RunForm({
  title,
  help,
  submitLabel,
  reasonLabel = "Reason",
  reasonRequired = false,
  initialQuantity = "",
  onSubmit,
  onCancel,
}: {
  title: string;
  help: string;
  submitLabel: string;
  /** null leaves the reason field off — a first print needs none. */
  reasonLabel?: string | null;
  reasonRequired?: boolean;
  initialQuantity?: string;
  onSubmit: (quantity: number, reason: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [quantity, setQuantity] = useState(initialQuantity);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(quantity);
  const valid = /^\d+$/.test(quantity.trim()) && parsed > 0 && (!reasonRequired || reason.trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(parsed, reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-[var(--border)] p-3">
      <div>
        <p className="text-sm font-bold text-foreground">{title}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{help}</p>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
      <div className={`grid gap-3 ${reasonLabel ? "sm:grid-cols-[140px_1fr]" : ""}`}>
        <Field label="Labels" htmlFor={`labels-${title}`} required>
          <Input
            id={`labels-${title}`}
            inputMode="numeric"
            autoComplete="off"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className={reasonLabel ? undefined : "max-w-[180px]"}
          />
        </Field>
        {reasonLabel ? (
          <Field label={reasonLabel} htmlFor={`reason-${title}`} required={reasonRequired}>
            <Input id={`reason-${title}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant="primary" disabled={!valid || saving} icon={<Printer size={14} weight="bold" />}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Every run, oldest first. A first print that was later corrected is struck
 *  through, so the record shows both what was entered and what replaced it. */
function History({ runs }: { runs: LabelRun[] }) {
  if (runs.length === 0) return null;
  const firstPrintIds = runs.filter((r) => r.kind === "FIRST_PRINT").map((r) => r.id);
  const lastFirstPrint = firstPrintIds.at(-1);
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">History</p>
      <ul className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
        {runs.map((run) => {
          const isFirst = run.kind === "FIRST_PRINT";
          const corrected = isFirst && firstPrintIds.indexOf(run.id) > 0;
          const superseded = isFirst && run.id !== lastFirstPrint;
          return (
            <li key={run.id} className="flex items-start gap-3 px-3 py-2 text-[13px]">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                  isFirst ? "bg-[var(--status-production-bg)] text-[var(--status-production)]" : "bg-[var(--surface-sunken)] text-foreground"
                }`}
              >
                {isFirst ? (corrected ? "First print · corrected" : "First print") : "Reprint"}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`font-bold tabular-nums ${superseded ? "text-[var(--muted-foreground)] line-through" : ""}`}>
                  {isFirst ? "" : "+"}
                  {run.quantity} labels
                </p>
                {run.reason ? <p className="text-xs text-[var(--muted-foreground)]">{run.reason}</p> : null}
              </div>
              <p className="shrink-0 text-right text-[11px] text-[var(--muted-foreground)]">
                {run.recordedByName}
                <br />
                {format(new Date(run.recordedAt), "d MMM, HH:mm")}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
