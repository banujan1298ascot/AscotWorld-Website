/**
 * Pure authorization/validation rules for Batch Book edits (spec 2.1, 5).
 * Kept separate from service.ts so "who may do what, and when" is testable
 * without a database — service.ts calls these and only then touches the DB.
 */
import { roleCan } from "@/lib/types";
import type { ActingStaff } from "../actingStaff";

export type { ActingStaff };

export type Verdict = { ok: true } | { ok: false; error: string };

export interface BatchForAuth {
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD" | "FAILED";
  createdBy: string;
}

function isOwnerOrAdmin(staff: ActingStaff, batch: BatchForAuth): boolean {
  return staff.id === batch.createdBy || staff.role === "admin";
}

/** Can `staff` create a new draft? (spec 2.1: any data-entry-capable role.) */
export function canCreateDraft(staff: ActingStaff): Verdict {
  return roleCan(staff.role, "batchbook.create")
    ? { ok: true }
    : { ok: false, error: "Your role cannot create Batch Book entries." };
}

/**
 * Can `staff` edit `batch`, and — for a confirmed/historical record — did
 * they supply the reason the edit requires?
 */
export function canEditBatch(
  staff: ActingStaff,
  batch: BatchForAuth,
  reason: string | null | undefined,
): Verdict {
  if (batch.status === "DRAFT") {
    if (!roleCan(staff.role, "batchbook.editOwnDraft")) {
      return { ok: false, error: "Your role cannot edit Batch Book drafts." };
    }
    if (!isOwnerOrAdmin(staff, batch)) {
      return { ok: false, error: "You can only edit your own drafts." };
    }
    return { ok: true };
  }

  // Confirmed, historical, or anything past DRAFT: a logged supervisor/QA edit.
  if (!roleCan(staff.role, "batchbook.editConfirmed")) {
    return { ok: false, error: "Your role cannot edit a confirmed batch record." };
  }
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "A reason is required to edit a confirmed batch record." };
  }
  return { ok: true };
}

/** Fields that become permanently fixed the moment a batch is confirmed
 *  (spec 2.1: "batch number is permanently assigned"). Descriptive fields
 *  (product, quantity, planned date, custom fields) stay editable by a
 *  supervisor/QA edit; identity and numbering fields do not. */
const IMMUTABLE_ONCE_CONFIRMED = new Set([
  "batchType",
  "departmentId",
  "batchNumber",
  "batchSequence",
  "status",
  "createdBy",
  "createdAt",
  "confirmedBy",
  "confirmedAt",
]);

/** Does this patch touch any field that's locked once the batch is past DRAFT? */
export function canEditFields(batch: BatchForAuth, patchKeys: string[]): Verdict {
  if (batch.status === "DRAFT") return { ok: true };
  const offending = patchKeys.filter((key) => IMMUTABLE_ONCE_CONFIRMED.has(key));
  if (offending.length > 0) {
    return { ok: false, error: `These fields are immutable once confirmed: ${offending.join(", ")}.` };
  }
  return { ok: true };
}

/** Can `staff` confirm `batch` right now? */
export function canConfirmBatch(staff: ActingStaff, batch: BatchForAuth): Verdict {
  if (batch.status !== "DRAFT") {
    return { ok: false, error: "Only a draft can be confirmed." };
  }
  if (!roleCan(staff.role, "batchbook.confirm")) {
    return { ok: false, error: "Your role cannot confirm Batch Book entries." };
  }
  if (!isOwnerOrAdmin(staff, batch)) {
    return { ok: false, error: "You can only confirm your own drafts." };
  }
  return { ok: true };
}
