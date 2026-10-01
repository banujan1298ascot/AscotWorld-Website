"use client";

import { useMemo, useState } from "react";
import { CheckCircle, PencilSimple, Plus, Warning } from "@phosphor-icons/react/dist/ssr";
import { BatchFlags } from "@/components/mes/BatchFlags";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  FilterSelect,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  BATCH_BOOK_STATUS_LABELS,
  BATCH_DESTINATIONS,
  BATCH_TYPE_LABELS,
  useBatchBook,
  useDepartments,
  type BatchBookStatus,
  type BatchDestination,
  type BatchPatch,
  type BatchRecord,
  type BatchType,
} from "@/lib/batchBook";

/** Each batch type keeps its own numbering sequence (spec 2.3), so each one
 *  gets its own log rather than being mixed into a single list. */
const TYPE_OPTIONS = (Object.keys(BATCH_TYPE_LABELS) as BatchType[]).map((value) => ({
  value,
  label: BATCH_TYPE_LABELS[value],
}));

/** Colour is always paired with the status label — no colour-only meaning. */
const STATUS_TONE: Record<BatchBookStatus, { color: string; background: string }> = {
  DRAFT: { color: "var(--muted-foreground)", background: "var(--surface-sunken)" },
  CONFIRMED: { color: "var(--status-production)", background: "var(--status-production-bg)" },
  IN_PROGRESS: { color: "var(--status-production)", background: "var(--status-production-bg)" },
  COMPLETED: { color: "var(--status-released)", background: "var(--status-released-bg)" },
  ON_HOLD: { color: "var(--status-qa)", background: "var(--status-qa-bg)" },
  FAILED: { color: "var(--status-cancelled)", background: "var(--status-cancelled-bg)" },
};

/** Labels printed at Check 2, first print and reprints kept apart. Read-only
 *  here: only Check 2 records them, through the MES. */
function LabelCounts({ batch }: { batch: BatchRecord }) {
  if (batch.labelsPrinted === null) {
    return <span className="text-xs text-[var(--subtle-foreground)]">Not yet printed</span>;
  }
  return (
    <span className="text-[13px] tabular-nums leading-tight">
      <span className="font-semibold">{batch.labelsPrinted.toLocaleString()}</span>{" "}
      <span className="text-[var(--muted-foreground)]">first print</span>
      {batch.labelsReprinted > 0 ? (
        <span className="block text-xs text-[var(--muted-foreground)]">
          + <span className="font-semibold text-foreground">{batch.labelsReprinted.toLocaleString()}</span> reprinted
        </span>
      ) : null}
    </span>
  );
}

export default function BatchBookPage() {
  const { user, can } = useAuth();
  const [batchType, setBatchType] = useState<BatchType>("A");
  const { batches, ready, error, createDraft, editBatch, confirmBatch } = useBatchBook();
  const { departments } = useDepartments();
  const departmentById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const visibleBatches = useMemo(
    () => batches?.filter((b) => b.batchType === batchType) ?? null,
    [batches, batchType],
  );

  const [creating, setCreating] = useState(false);
  const [editingBatch, setEditingBatch] = useState<BatchRecord | null>(null);

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Batch Book"
        description="Each batch type keeps its own log and its own numbering. A batch is confirmed as it's entered, which assigns its permanent number."
        actions={
          can("batchbook.create") ? (
            <Button variant="primary" icon={<Plus size={16} weight="bold" />} onClick={() => setCreating(true)}>
              New batch
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Batch type"
          value={batchType}
          onChange={(v) => setBatchType(v as BatchType)}
          options={TYPE_OPTIONS}
        />
      </div>

      {error ? (
        <Card className="mb-4 border-[var(--danger)]">
          <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
        </Card>
      ) : null}

      {!ready ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : visibleBatches && visibleBatches.length === 0 ? (
        <EmptyState
          title={`No ${BATCH_TYPE_LABELS[batchType]} batches yet`}
          description="Entering a batch confirms it and assigns the next number in this type's sequence."
          action={
            can("batchbook.create") ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                New batch
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-4 py-2.5">Batch number</th>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">Department</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Labels</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visibleBatches?.map((batch) => {
                  const isOwnDraft = batch.status === "DRAFT" && batch.createdBy === user.id;
                  const canEditDraft = batch.status === "DRAFT" && can("batchbook.editOwnDraft") && (isOwnDraft || user.role === "admin");
                  const canEditConfirmed = batch.status !== "DRAFT" && can("batchbook.editConfirmed");

                  return (
                    <tr key={batch.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[13px] font-semibold">
                        {batch.batchNumber ?? <span className="text-[var(--muted-foreground)]">Not yet assigned</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {batch.productName ?? "—"}
                        <BatchFlags batch={batch} className="mt-1 flex" />
                      </td>
                      <td className="px-4 py-2.5">{departmentById.get(batch.departmentId) ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill
                          label={BATCH_BOOK_STATUS_LABELS[batch.status]}
                          {...STATUS_TONE[batch.status]}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <LabelCounts batch={batch} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {canEditDraft || canEditConfirmed ? (
                            <Button size="sm" variant="ghost" onClick={() => setEditingBatch(batch)}>
                              <PencilSimple size={14} weight="bold" />
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {creating ? (
        <CreateBatchModal
          open={creating}
          defaultBatchType={batchType}
          onClose={() => setCreating(false)}
          onSubmit={async (input, confirmNow) => {
            const batch = await createDraft(input);
            if (confirmNow) await confirmBatch(batch.id);
            // Land on the log the batch was actually filed under.
            setBatchType(input.batchType);
            setCreating(false);
          }}
        />
      ) : null}

      {editingBatch ? (
        <EditBatchModal
          batch={editingBatch}
          onClose={() => setEditingBatch(null)}
          onSave={async (patch, reason) => {
            await editBatch(editingBatch.id, patch, reason);
            setEditingBatch(null);
          }}
          onConfirm={
            editingBatch.status === "DRAFT" && can("batchbook.confirm")
              ? async (patch) => {
                  // Save any edits made in this form before the number is
                  // assigned — a confirmed record can't be edited without a
                  // logged reason.
                  await editBatch(editingBatch.id, patch);
                  await confirmBatch(editingBatch.id);
                  setEditingBatch(null);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Priority and destination, entered with the batch and carried through every
 * MES station: urgent shows orange (#FF4D00), stock for Ireland neon green (see
 * src/components/mes/BatchFlags.tsx). Priority is only ever "urgent" or left
 * alone. The destination has no default — a wrong pre-filled market would
 * look exactly like a right one — so it must be picked before confirming.
 */
function PriorityAndDestinationFields({
  idPrefix,
  urgent,
  onUrgentChange,
  destination,
  onDestinationChange,
}: {
  idPrefix: string;
  urgent: boolean;
  onUrgentChange: (urgent: boolean) => void;
  destination: BatchDestination | null;
  onDestinationChange: (destination: BatchDestination) => void;
}) {
  return (
    <>
      <Field label="Priority" htmlFor={`${idPrefix}-urgent`}>
        <label
          htmlFor={`${idPrefix}-urgent`}
          className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 transition-colors duration-150"
          style={
            urgent
              ? { borderColor: "var(--urgent)", background: "var(--urgent-bg)" }
              : { borderColor: "var(--border-strong)" }
          }
        >
          <input
            id={`${idPrefix}-urgent`}
            type="checkbox"
            checked={urgent}
            onChange={(e) => onUrgentChange(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-[var(--urgent)]"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <Warning size={15} weight={urgent ? "fill" : "bold"} style={{ color: urgent ? "var(--urgent)" : undefined }} />
              Urgent
            </span>
            <span className="block text-xs text-[var(--muted-foreground)]">
              Leave unticked for normal priority. Urgent batches show orange at every MES station.
            </span>
          </span>
        </label>
      </Field>

      <Field
        label="Destination"
        htmlFor={`${idPrefix}-destination`}
        required
        helper={destination ? undefined : "Choose where the stock is going before confirming."}
      >
        <div id={`${idPrefix}-destination`} role="radiogroup" aria-label="Destination" className="flex flex-wrap gap-1.5">
          {BATCH_DESTINATIONS.map((option) => {
            const selected = destination === option.value;
            const ireland = option.value === "IRELAND";
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onDestinationChange(option.value)}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                  selected
                    ? ireland
                      ? ""
                      : "border-[var(--primary)] bg-[var(--primary)] text-white"
                    : "border-[var(--border-strong)] text-[var(--muted-foreground)] hover:text-foreground"
                }`}
                style={
                  selected && ireland
                    ? { borderColor: "var(--ireland)", background: "var(--ireland)", color: "var(--ireland-ink)" }
                    : undefined
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

/**
 * Entering a batch and confirming it are one step: confirming is what
 * assigns the permanent number, so it belongs with the data being entered
 * rather than as an action against a row in the log. "Save as draft" is
 * still there for an entry that isn't ready to be numbered yet.
 */
function CreateBatchModal({
  open,
  defaultBatchType,
  onClose,
  onSubmit,
}: {
  open: boolean;
  defaultBatchType: BatchType;
  onClose: () => void;
  onSubmit: (
    input: {
      batchType: BatchType;
      departmentId: string;
      productName?: string;
      quantity?: string;
      unit?: string;
      plannedManufactureDate?: string;
      urgent?: boolean;
      destination?: BatchDestination;
    },
    confirmNow: boolean,
  ) => Promise<void>;
}) {
  const { departments, ready, error: departmentsError } = useDepartments();
  const [batchType, setBatchType] = useState<BatchType>(defaultBatchType);
  const [departmentId, setDepartmentId] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [destination, setDestination] = useState<BatchDestination | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const error = submitError ?? departmentsError;

  const selectedDepartment = departmentId || departments[0]?.id || "";

  async function submit(confirmNow: boolean) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(
        {
          batchType,
          departmentId: selectedDepartment,
          productName: productName || undefined,
          quantity: quantity || undefined,
          unit: unit || undefined,
          plannedManufactureDate: plannedDate || undefined,
          urgent,
          destination: destination ?? undefined,
        },
        confirmNow,
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save this batch.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New batch"
      description="Confirming assigns the next number in this type's sequence and can't be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={!selectedDepartment || submitting} onClick={() => void submit(false)}>
            Save as draft
          </Button>
          <Button
            variant="primary"
            icon={<CheckCircle size={15} weight="bold" />}
            disabled={!selectedDepartment || !destination || submitting}
            onClick={() => void submit(true)}
          >
            {submitting ? "Working…" : "Confirm batch"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {error ? <ErrorNotice message={error} /> : null}

        <Field label="Batch type" htmlFor="batch-type" required>
          <Select id="batch-type" value={batchType} onChange={(e) => setBatchType(e.target.value as BatchType)}>
            {Object.entries(BATCH_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Department" htmlFor="department" required helper={!ready ? "Loading departments…" : undefined}>
          <Select id="department" value={selectedDepartment} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.length === 0 ? <option value="">No departments configured</option> : null}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Product" htmlFor="product-name">
          <Input id="product-name" value={productName} onChange={(e) => setProductName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Quantity" htmlFor="quantity">
            <Input id="quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Unit" htmlFor="unit">
            <Input id="unit" placeholder="bottles, kg…" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>

        <Field label="Planned manufacture date" htmlFor="planned-date">
          <Input id="planned-date" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
        </Field>

        <PriorityAndDestinationFields
          idPrefix="new"
          urgent={urgent}
          onUrgentChange={setUrgent}
          destination={destination}
          onDestinationChange={setDestination}
        />
      </div>
    </Modal>
  );
}

function EditBatchModal({
  batch,
  onClose,
  onSave,
  onConfirm,
}: {
  batch: BatchRecord;
  onClose: () => void;
  onSave: (patch: BatchPatch, reason?: string) => Promise<void>;
  /** Present for a draft: finishes data entry by confirming it here, rather
   *  than leaving a confirm action sitting on the log. */
  onConfirm?: (patch: BatchPatch) => Promise<void>;
}) {
  const isDraft = batch.status === "DRAFT";
  const [productName, setProductName] = useState(batch.productName ?? "");
  const [quantity, setQuantity] = useState(batch.quantity ?? "");
  const [unit, setUnit] = useState(batch.unit ?? "");
  const [plannedDate, setPlannedDate] = useState(batch.plannedManufactureDate ?? "");
  const [urgent, setUrgent] = useState(batch.urgent);
  const [destination, setDestination] = useState<BatchDestination | null>(batch.destination);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPatch = (): BatchPatch => ({
    productName: productName || null,
    quantity: quantity || null,
    unit: unit || null,
    plannedManufactureDate: plannedDate || null,
    urgent,
    destination,
  });

  async function run(action: () => Promise<void>) {
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isDraft ? "Finish this batch" : `Edit ${batch.batchNumber ?? "batch"}`}
      description={
        isDraft
          ? "Confirming assigns the next number in this type's sequence and can't be undone."
          : "This record is confirmed — every change here is logged to the audit trail with your reason."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={submitting || (!isDraft && reason.trim().length === 0)}
            onClick={() => void run(() => onSave(currentPatch(), isDraft ? undefined : reason))}
          >
            {isDraft ? "Save as draft" : "Save changes"}
          </Button>
          {onConfirm ? (
            <Button
              variant="primary"
              icon={<CheckCircle size={15} weight="bold" />}
              disabled={submitting || !destination}
              onClick={() => void run(() => onConfirm(currentPatch()))}
            >
              {submitting ? "Working…" : "Confirm batch"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-3.5">
        {error ? <ErrorNotice message={error} /> : null}

        <Field label="Product" htmlFor="edit-product-name">
          <Input id="edit-product-name" value={productName} onChange={(e) => setProductName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Quantity" htmlFor="edit-quantity">
            <Input
              id="edit-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Unit" htmlFor="edit-unit">
            <Input id="edit-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>

        <Field label="Planned manufacture date" htmlFor="edit-planned-date">
          <Input
            id="edit-planned-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
          />
        </Field>

        <PriorityAndDestinationFields
          idPrefix="edit"
          urgent={urgent}
          onUrgentChange={setUrgent}
          destination={destination}
          onDestinationChange={setDestination}
        />

        {!isDraft ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Labels</p>
              <LabelCounts batch={batch} />
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              Recorded by Check 2 in the MES — it can&apos;t be changed from the Batch Book.
            </p>
          </div>
        ) : null}

        {!isDraft ? (
          <Field
            label="Reason for this edit"
            htmlFor="edit-reason"
            required
            helper="Required for any change to a confirmed record — recorded in the audit trail."
          >
            <Textarea id="edit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
