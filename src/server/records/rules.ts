/**
 * Which shared collections exist and who may do what with them — pure, so
 * it's unit-testable without a database. See service.ts for the storage.
 */
import { cleanAccess, staffCan, type StaffAccess } from "@/lib/access";
import type { Capability, Role } from "@/lib/types";

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

type Caller = { id: string; role: Role; access?: StaffAccess | null };

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
  caller: Caller | null,
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

  if (rule.write && rule.write.some((capability) => staffCan(caller, capability))) return { ok: true };
  return deny(403, "Your account isn't allowed to change this.");
}

/** A record must be a plain object carrying its own id, and not enormous. */
export function checkRecord(id: string, data: unknown): Verdict {
  if (!data || typeof data !== "object" || Array.isArray(data)) return deny(422, "A record must be an object.");
  if ((data as { id?: unknown }).id !== id) return deny(422, "The record's id doesn't match the address.");
  if (JSON.stringify(data).length > MAX_RECORD_BYTES) return deny(413, "That record is too large.");
  return { ok: true };
}

type StaffRecord = Record<string, unknown> & { id?: unknown; role?: unknown; access?: unknown; email?: unknown };

const asPerson = (record: StaffRecord) => ({
  role: (record.role as Role) ?? "viewer",
  access: cleanAccess(record.access),
});

/**
 * The extra rules for changing the staff list, on top of needing the
 * "manage users" ability: nobody changes their own role or access, or
 * removes themselves (so nobody locks themselves out, or promotes
 * themselves); only an admin touches an admin's account, makes someone an
 * admin, or lets someone manage users; and there's always an admin left.
 * `others` is everyone else on the staff list.
 */
export function checkStaffChange(
  caller: Caller,
  existing: StaffRecord | null,
  next: StaffRecord | null,
  others: StaffRecord[],
): Verdict {
  const callerIsAdmin = caller.role === "admin";
  const adminsLeft = others.filter((s) => s.role === "admin").length;

  if (next === null) {
    if (!existing) return { ok: true };
    if (existing.id === caller.id) return deny(403, "You can't remove your own account.");
    if (existing.role === "admin" && !callerIsAdmin) return deny(403, "Only an admin can remove an admin.");
    if (existing.role === "admin" && adminsLeft === 0) return deny(409, "This is the last admin — make someone else an admin first.");
    return { ok: true };
  }

  if (typeof next.email === "string") {
    const email = next.email.trim().toLowerCase();
    if (others.some((s) => typeof s.email === "string" && s.email.trim().toLowerCase() === email)) {
      return deny(409, "Someone else already uses that email address.");
    }
  }

  if (existing) {
    const sameAccess = JSON.stringify(cleanAccess(existing.access)) === JSON.stringify(cleanAccess(next.access));
    if (existing.id === caller.id && (existing.role !== next.role || !sameAccess)) {
      return deny(403, "You can't change your own role or access — ask another admin or manager.");
    }
    if (existing.role === "admin" && !callerIsAdmin) return deny(403, "Only an admin can change an admin's account.");
    if (existing.role === "admin" && next.role !== "admin" && adminsLeft === 0) {
      return deny(409, "This is the last admin — make someone else an admin first.");
    }
  }

  if (!callerIsAdmin) {
    if (next.role === "admin" && existing?.role !== "admin") return deny(403, "Only an admin can make someone an admin.");
    const manages = (record: StaffRecord | null) => (record ? staffCan(asPerson(record), "team.manage") : false);
    if (manages(next) && !manages(existing)) return deny(403, "Only an admin can let someone manage users.");
  }
  return { ok: true };
}
