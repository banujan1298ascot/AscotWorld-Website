/**
 * Pure authorization/validation rules for the MES pipeline (spec 3). Same
 * split as batch-book/validation.ts: no DB here, so "who may do what" is
 * unit-testable directly.
 */
import { OPERATOR_ROLES, roleCan, type OperatorRole } from "@/lib/types";
import type { ActingStaff } from "../actingStaff";

export type Verdict = { ok: true } | { ok: false; error: string };

export interface StageForAuth {
  sequenceNumber: number;
  failAuthority: boolean;
  /** See the `supervised` column on stage_definitions. */
  supervised?: boolean;
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
 *
 * Normally only the operator who claimed it may — "the batch stays with that
 * operator... until they send it forward or back" (spec 3.3).
 *
 * A supervised stage is the exception: its operators don't use the app, so
 * the batch is assigned to them for the record while the supervisor, who is
 * the station's only app user, moves it on. Requiring the holder there would
 * strand every batch the moment it was assigned.
 */
export function canActOnTransition(
  staff: ActingStaff,
  transition: OpenTransitionForAuth | undefined,
  stage?: Pick<StageForAuth, "supervised">,
): Verdict {
  if (!transition || transition.completedAt !== null) {
    return { ok: false, error: "This batch hasn't been started at this stage yet." };
  }
  if (transition.operatorId !== staff.id && !stage?.supervised) {
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

/**
 * Who may run a supervised station (Check 4). Its floor operators never use
 * the app — the supervisor assigns each batch to one of them (so we know how
 * long each operator takes over each product) and moves it on once they
 * report back. So every action there is the supervisor's: the account
 * pinned to that station, or an admin. Anywhere else this adds nothing —
 * the ordinary rules apply.
 */
export function canRunStation(
  staff: ActingStaff,
  stage: Pick<StageForAuth, "sequenceNumber" | "supervised">,
): Verdict {
  if (!stage.supervised || staff.role === "admin" || staff.mesStage === stage.sequenceNumber) return { ok: true };
  return { ok: false, error: "Only this station's supervisor can do that here." };
}

/**
 * At a supervised station a batch is always started by assigning it to a
 * named operator — never self-claimed, which would record the supervisor as
 * the one who did the work and skew that operator timing.
 */
export function checkAssignee(
  stage: Pick<StageForAuth, "supervised">,
  assignToOperatorId: string | null | undefined,
): Verdict {
  if (stage.supervised && !assignToOperatorId) {
    return { ok: false, error: "Choose which operator is doing this batch." };
  }
  return { ok: true };
}

/** The station that prints a batch's labels — Check 2, Order/Calculation Check. */
export const LABEL_STATION_SEQUENCE = 2;

/** Upper bound on one print run, to catch a slipped finger (an extra zero or
 *  three) rather than to model any real limit. */
export const MAX_LABELS_PER_RUN = 100_000;

/**
 * Who may record labels printed for a batch: only Check 2, which prints them
 * — the account pinned there, an Order processing operator working the MES
 * unpinned, or an admin correcting a record. Every other station account is
 * refused outright, Check 1 (Batch Book entry) included: the Batch Book shows
 * these counts but never takes them as input.
 */
export function canRecordLabels(
  staff: ActingStaff & { operatorRole?: string | null },
  stage: { sequenceNumber: number; name: string; operatorRole: string | null },
): Verdict {
  if (stage.sequenceNumber !== LABEL_STATION_SEQUENCE) {
    return { ok: false, error: `Labels are recorded at Check ${LABEL_STATION_SEQUENCE} only.` };
  }
  if (staff.role === "admin" || staff.mesStage === LABEL_STATION_SEQUENCE) return { ok: true };
  if (staff.mesStage != null) {
    return {
      ok: false,
      error: `Only Station ${LABEL_STATION_SEQUENCE} can record labels — this account is Station ${staff.mesStage}'s.`,
    };
  }
  if (!roleCan(staff.role, "mes.claim")) {
    return { ok: false, error: "Your role cannot record labels." };
  }
  if (stage.operatorRole && staff.operatorRole !== stage.operatorRole) {
    const needed = OPERATOR_ROLES[stage.operatorRole as OperatorRole];
    return { ok: false, error: `Only ${needed ? needed.plural : "this station's operators"} can record labels at ${stage.name}.` };
  }
  return { ok: true };
}

/**
 * Check 2 can't send a batch on until it has recorded how many labels it
 * printed — the first print at least. Reprints are optional. No other
 * station is affected.
 */
export function checkLabelsBeforeForward(
  stage: { sequenceNumber: number },
  batch: { labelsPrinted: number | null },
): Verdict {
  if (stage.sequenceNumber === LABEL_STATION_SEQUENCE && batch.labelsPrinted === null) {
    return { ok: false, error: "Record how many labels were printed before sending this batch on." };
  }
  return { ok: true };
}

/**
 * Is this print run well-formed? A reprint needs a first print to follow,
 * and correcting a first print that's already recorded needs a reason — the
 * old figure stays in the history, so the record says why it changed.
 */
export function checkLabelRun(
  run: { kind: "FIRST_PRINT" | "REPRINT"; quantity: unknown; reason?: string | null },
  current: { labelsPrinted: number | null },
): Verdict {
  const { quantity } = run;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Enter how many labels as a whole number above zero." };
  }
  if (quantity > MAX_LABELS_PER_RUN) {
    return { ok: false, error: `That's more than ${MAX_LABELS_PER_RUN.toLocaleString("en-GB")} labels in one run — check the number.` };
  }
  if (run.kind === "REPRINT" && current.labelsPrinted === null) {
    return { ok: false, error: "Record the first print before any reprint." };
  }
  if (run.kind === "FIRST_PRINT" && current.labelsPrinted !== null && !run.reason?.trim()) {
    return { ok: false, error: "Give a reason for correcting the first print." };
  }
  return { ok: true };
}

/**
 * Some stations only take one kind of operator (stage_definitions.operator_role):
 * Order processing operators at Check 2, Dispensary technicians at Check 3,
 * Bespoke production operators at Check 4. Whoever a batch is assigned to —
 * or whoever claims it themselves — must be that kind.
 */
export function checkOperatorRole(
  stage: { name: string; operatorRole: string | null },
  operator: { name: string; operatorRole: string | null },
): Verdict {
  if (!stage.operatorRole || operator.operatorRole === stage.operatorRole) return { ok: true };
  const needed = OPERATOR_ROLES[stage.operatorRole as OperatorRole];
  const kind = needed ? needed.plural : "operators of the right type";
  return { ok: false, error: `Only ${kind} can take batches at ${stage.name} — ${operator.name} isn't one.` };
}
