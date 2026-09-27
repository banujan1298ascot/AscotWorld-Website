/**
 * Which shared collections exist and who may do what with them — pure, so
 * it's unit-testable without a database. See service.ts for the storage.
 */
import { roleCan, type Capability, type Role } from "@/lib/types";

export interface CollectionRule {
  /** Readable before signing in — the login screen lists the demo staff. */
  publicRead?: boolean;
  /** Any one of these lets a caller create, change or delete records. */
  write?: Capability[];
  /**
   * Records belong to the person named in this field: they only see their
   * own, and only they can change or delete them. Anyone signed in may
   * create one for someone else — that's how a notification is sent.
   */
  ownerField?: string;
}

export const COLLECTIONS: Record<string, CollectionRule> = {
  staff: { publicRead: true, write: ["team.manage"] },
  departments: { publicRead: true, write: ["team.manage"] },
  tasks: { write: ["task.create", "task.assign", "task.updateOwn", "task.updateAny", "task.delete"] },
  batches: { write: ["batch.create", "batch.updateProgress", "batch.release", "batch.delete"] },
  shifts: { write: ["rota.manage"] },
  notifications: { ownerField: "recipientId" },
};

export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_SEED_ITEMS = 2000;

export type Verdict = { ok: true } | { ok: false; status: number; error: string };

const deny = (status: number, error: string): Verdict => ({ ok: false, status, error });

export function ruleFor(collection: string): CollectionRule | null {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, collection) ? COLLECTIONS[collection] : null;
}

export function canRead(rule: CollectionRule, caller: { role: Role } | null): Verdict {
  if (rule.publicRead || caller) return { ok: true };
  return deny(401, "Sign in first.");
}

/**
 * May `caller` write this record? `existing` is what's stored now (null for
 * a new record), `next` what they want stored (null for a delete).
 */
export function canWrite(
  rule: CollectionRule,
  caller: { id: string; role: Role } | null,
  existing: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): Verdict {
  if (!caller) return deny(401, "Sign in first.");

  if (rule.ownerField) {
    const field = rule.ownerField;
    if (existing && existing[field] !== caller.id) return deny(403, "That isn't yours to change.");
    if (existing && next && next[field] !== existing[field]) return deny(403, "Records can't be handed to someone else.");
    if (next && typeof next[field] !== "string") return deny(422, `Every record needs a ${field}.`);
    return { ok: true };
  }

  if (rule.write && rule.write.some((capability) => roleCan(caller.role, capability))) return { ok: true };
  return deny(403, "Your role can't change this.");
}

/** A record must be a plain object carrying its own id, and not enormous. */
export function checkRecord(id: string, data: unknown): Verdict {
  if (!data || typeof data !== "object" || Array.isArray(data)) return deny(422, "A record must be an object.");
  if ((data as { id?: unknown }).id !== id) return deny(422, "The record's id doesn't match the address.");
  if (JSON.stringify(data).length > MAX_RECORD_BYTES) return deny(413, "That record is too large.");
  return { ok: true };
}
