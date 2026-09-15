"use client";

import { useMemo, useState } from "react";
import { CheckCircle, PencilSimple, Plus } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FilterSelect,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  BATCH_BOOK_STATUS_LABELS,
  BATCH_TYPE_LABELS,
  useBatchBook,
  useDepartments,
  type BatchBookStatus,
  type BatchPatch,
  type BatchRecord,
  type BatchType,
} from "@/lib/batchBook";

const STATUS_FILTERS: Array<{ value: "all" | BatchBookStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
];

/** Colour is always paired with the status label — no colour-only meaning. */
const STATUS_TONE: Record<BatchBookStatus, { color: string; background: string }> = {
  DRAFT: { color: "var(--muted-foreground)", background: "var(--surface-sunken)" },
  CONFIRMED: { color: "var(--status-production)", background: "var(--status-production-bg)" },
  IN_PROGRESS: { color: "var(--status-production)", background: "var(--status-production-bg)" },
  COMPLETED: { color: "var(--status-released)", background: "var(--status-released-bg)" },
  ON_HOLD: { color: "var(--status-qa)", background: "var(--status-qa-bg)" },
  FAILED: { color: "var(--status-cancelled)", background: "var(--status-cancelled-bg)" },
};

export default function BatchBookPage() {
  const { user, can } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"all" | BatchBookStatus>("all");
  const { batches, ready, error, createDraft, editBatch, confirmBatch } = useBatchBook(
    statusFilter === "all" ? undefined : statusFilter,
  );
  const { departments } = useDepartments();
  const departmentById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const [creating, setCreating] = useState(false);
  const [editingBatch, setEditingBatch] = useState<BatchRecord | null>(null);

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Batch Book"
        description="Every batch is logged here first and given a permanent, sequential number once confirmed."
        actions={
          can("batchbook.create") ? (
            <Button variant="primary" icon={<Plus size={16} weight="bold" />} onClick={() => setCreating(true)}>
              New draft
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | BatchBookStatus)}
          options={STATUS_FILTERS}
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
      ) : batches && batches.length === 0 ? (
        <EmptyState
          title="No batches yet"
          description="Start a draft to log the first batch — it gets a permanent number once you confirm it."
          action={
            can("batchbook.create") ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                New draft
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-4 py-2.5">Batch number</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">Department</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {batches?.map((batch) => {
                  const isOwnDraft = batch.status === "DRAFT" && batch.createdBy === user.id;
                  const canEditDraft = batch.status === "DRAFT" && can("batchbook.editOwnDraft") && (isOwnDraft || user.role === "admin");
                  const canConfirm = batch.status === "DRAFT" && can("batchbook.confirm") && (isOwnDraft || user.role === "admin");
                  const canEditConfirmed = batch.status !== "DRAFT" && can("batchbook.editConfirmed");

                  return (
                    <tr key={batch.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[13px] font-semibold">
                        {batch.batchNumber ?? <span className="text-[var(--muted-foreground)]">Not yet assigned</span>}
                      </td>
                      <td className="px-4 py-2.5">{batch.batchType}</td>
                      <td className="px-4 py-2.5">{batch.productName ?? "—"}</td>
                      <td className="px-4 py-2.5">{departmentById.get(batch.departmentId) ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill
                          label={BATCH_BOOK_STATUS_LABELS[batch.status]}
                          {...STATUS_TONE[batch.status]}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {canEditDraft || canEditConfirmed ? (
                            <Button size="sm" variant="ghost" onClick={() => setEditingBatch(batch)}>
                              <PencilSimple size={14} weight="bold" />
                              Edit
                            </Button>
                          ) : null}
                          {canConfirm ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={async () => {
                                if (
                                  window.confirm(
                                    "Confirm this batch?\n\nThis permanently assigns its batch number and dispatches it — it cannot be undone.",
                                  )
                                ) {
                                  await confirmBatch(batch.id);
                                }
                              }}
                            >
                              <CheckCircle size={14} weight="bold" />
                              Confirm
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
        <CreateDraftModal
          open={creating}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await createDraft(input);
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
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function CreateDraftModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    batchType: BatchType;
    departmentId: string;
    productName?: string;
    quantity?: string;
    unit?: string;
    plannedManufactureDate?: string;
  }) => Promise<void>;
}) {
  const { departments, ready, error: departmentsError } = useDepartments();
  const [batchType, setBatchType] = useState<BatchType>("A");
  const [departmentId, setDepartmentId] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const error = submitError ?? departmentsError;

  const selectedDepartment = departmentId || departments[0]?.id || "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Batch Book draft"
      description="Drafts aren't numbered yet and aren't visible outside your own view until confirmed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selectedDepartment || submitting}
            onClick={async () => {
              setSubmitting(true);
              setSubmitError(null);
              try {
                await onCreate({
                  batchType,
                  departmentId: selectedDepartment,
                  productName: productName || undefined,
                  quantity: quantity || undefined,
                  unit: unit || undefined,
                  plannedManufactureDate: plannedDate || undefined,
                });
              } catch (err) {
                setSubmitError(err instanceof Error ? err.message : "Failed to create draft.");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Create draft
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {error ? <PermissionNotice message={error} /> : null}

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
      </div>
    </Modal>
  );
}

function EditBatchModal({
  batch,
  onClose,
  onSave,
}: {
  batch: BatchRecord;
  onClose: () => void;
  onSave: (patch: BatchPatch, reason?: string) => Promise<void>;
}) {
  const isDraft = batch.status === "DRAFT";
  const [productName, setProductName] = useState(batch.productName ?? "");
  const [quantity, setQuantity] = useState(batch.quantity ?? "");
  const [unit, setUnit] = useState(batch.unit ?? "");
  const [plannedDate, setPlannedDate] = useState(batch.plannedManufactureDate ?? "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={isDraft ? "Edit draft" : `Edit ${batch.batchNumber ?? "batch"}`}
      description={
        isDraft
          ? undefined
          : "This record is confirmed — every change here is logged to the audit trail with your reason."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting || (!isDraft && reason.trim().length === 0)}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await onSave(
                  {
                    productName: productName || null,
                    quantity: quantity || null,
                    unit: unit || null,
                    plannedManufactureDate: plannedDate || null,
                  },
                  isDraft ? undefined : reason,
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save changes.");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {error ? <PermissionNotice message={error} /> : null}

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
