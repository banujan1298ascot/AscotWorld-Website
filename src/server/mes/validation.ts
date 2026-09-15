/**
 * Pure authorization/validation rules for the MES pipeline (spec 3). Same
 * split as batch-book/validation.ts: no DB here, so "who may do what" is
 * unit-testable directly.
 */
import { roleCan } from "@/lib/types";
import type { ActingStaff } from "../actingStaff";

export type Verdict = { ok: true } | { ok: false; error: string };

export interface StageForAuth {
  sequenceNumber: number;
  failAuthority: boolean;
}

export interface OpenTransitionForAuth {
  operatorId: string;
  completedAt: Date | string | null;
}

/** Can `staff` claim an unclaimed batch from a stage's Incoming/Returned queue? */
export function canClaim(staff: ActingStaff): Verdict {
  return roleCan(staff.role, "mes.claim")
    ? { ok: true }
    : { ok: false, error: "Your role cannot claim batches at this stage." };
}

/**
 * Can `staff` act on `transition` (pass forward, send back, or fail it)?
 * Only the operator who claimed it may — "the batch stays with that
 * operator... until they send it forward or back" (spec 3.3).
 */
export function canActOnTransition(staff: ActingStaff, transition: OpenTransitionForAuth | undefined): Verdict {
  if (!transition || transition.completedAt !== null) {
    return { ok: false, error: "You haven't claimed a batch at this stage." };
  }
  if (transition.operatorId !== staff.id) {
    return { ok: false, error: "Only the operator who claimed this batch can act on it." };
  }
  return { ok: true };
}

/** Can `staff` pass a claimed batch forward to the next stage? */
export function canForward(staff: ActingStaff): Verdict {
  return roleCan(staff.role, "mes.pass")
    ? { ok: true }
    : { ok: false, error: "Your role cannot pass batches to the next stage." };
}

/**
 * Can `staff` send a claimed batch back to the previous stage? Stage 1
 * (Batch Book Entry) has no claim/drag screen of its own (see
 * src/server/batch-book/service.ts), so nothing can be sent back to it —
 * the earliest a send-back can land is stage 2.
 */
export function canSendBack(
  staff: ActingStaff,
  stage: StageForAuth,
  notes: string | null | undefined,
): Verdict {
  if (!roleCan(staff.role, "mes.pass")) {
    return { ok: false, error: "Your role cannot send batches back." };
  }
  if (stage.sequenceNumber <= 2) {
    return {
      ok: false,
      error: "Cannot send back to Batch Book Entry — edit the confirmed record from Batch Book instead.",
    };
  }
  if (!notes || notes.trim().length === 0) {
    return { ok: false, error: "A reason is required to send a batch back." };
  }
  return { ok: true };
}

/**
 * Can `staff` fail a claimed batch at `stage`? Only stages with fail
 * authority may (spec 3.2: only Check 4 onward) — that's a fact about the
 * stage, not the acting role, so it's checked here rather than via a
 * separate capability.
 */
export function canFail(staff: ActingStaff, stage: StageForAuth, notes: string | null | undefined): Verdict {
  if (!roleCan(staff.role, "mes.pass")) {
    return { ok: false, error: "Your role cannot fail batches." };
  }
  if (!stage.failAuthority) {
    return { ok: false, error: "This stage cannot fail a batch." };
  }
  if (!notes || notes.trim().length === 0) {
    return { ok: false, error: "A reason is required to fail a batch." };
  }
  return { ok: true };
}
