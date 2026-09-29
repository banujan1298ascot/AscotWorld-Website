/**
 * Storage for the shared record collections (see rules.ts for which exist
 * and who may touch them). Records are stored whole, as JSON, in
 * `app_records`.
 *
 * Staff records are also mirrored into the `staff` table the Batch Book, MES
 * and messaging point foreign keys at — so someone added on the Team page
 * can sign in and use those sections too, and a role changed there changes
 * what the server lets them do.
 */
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/types";
import { ApiError } from "../apiError";
import { db } from "../db/client";
import { appRecords, staff } from "../db/schema";
import { canRead, canWrite, checkRecord, MAX_SEED_ITEMS, ruleFor, type CollectionRule, type Verdict } from "./rules";

type Caller = { id: string; role: Role } | null;
type Data = Record<string, unknown>;

function enforce(verdict: Verdict): void {
  if (!verdict.ok) throw new ApiError(verdict.status, verdict.error);
}

function requireRule(collection: string): CollectionRule {
  const rule = ruleFor(collection);
  if (!rule) throw new ApiError(404, "No such collection.");
  return rule;
}

/** Everything the caller may see in a collection, oldest first. `version`
 *  changes whenever anything in it does — a client that already holds that
 *  version gets `unchanged` instead of the whole list again. */
export async function listRecords(
  collection: string,
  caller: Caller,
  knownVersion: string | null,
): Promise<{ version: string; unchanged: true } | { version: string; items: Data[] }> {
  const rule = requireRule(collection);
  enforce(canRead(rule, caller));

  const scope = rule.ownerField
    ? sql`${appRecords.collection} = ${collection} AND ${appRecords.data} ->> ${rule.ownerField} = ${caller?.id ?? ""}`
    : sql`${appRecords.collection} = ${collection}`;

  const [stats] = (
    await db.execute<{ count: number; latest: string | null }>(sql`
      SELECT COUNT(*)::int AS count, MAX(${appRecords.updatedAt}) AS latest FROM ${appRecords} WHERE ${scope}
    `)
  ).rows;
  const version = `${stats.count}:${stats.latest ? new Date(stats.latest).getTime() : 0}`;
  if (knownVersion === version) return { version, unchanged: true };

  const rows = await db.execute<{ data: Data }>(sql`
    SELECT ${appRecords.data} AS data FROM ${appRecords}
    WHERE ${scope}
    ORDER BY ${appRecords.data} ->> 'createdAt', ${appRecords.id}
    LIMIT 5000
  `);
  return { version, items: rows.rows.map((r) => r.data) };
}

async function findRecord(collection: string, id: string): Promise<Data | null> {
  const [row] = await db
    .select({ data: appRecords.data })
    .from(appRecords)
    .where(and(eq(appRecords.collection, collection), eq(appRecords.id, id)))
    .limit(1);
  return (row?.data as Data | undefined) ?? null;
}

/** Creates or replaces one record. */
export async function putRecord(collection: string, id: string, data: unknown, caller: Caller): Promise<void> {
  const rule = requireRule(collection);
  enforce(checkRecord(id, data));
  const next = data as Data;
  enforce(canWrite(rule, caller, await findRecord(collection, id), next));

  await db
    .insert(appRecords)
    .values({ collection, id, data: next })
    .onConflictDoUpdate({
      target: [appRecords.collection, appRecords.id],
      set: { data: next, updatedAt: sql`now()` },
    });

  if (collection === "staff") await mirrorStaff(next);
}

export async function deleteRecord(collection: string, id: string, caller: Caller): Promise<void> {
  const rule = requireRule(collection);
  const existing = await findRecord(collection, id);
  if (!existing) return;
  enforce(canWrite(rule, caller, existing, null));
  await db.delete(appRecords).where(and(eq(appRecords.collection, collection), eq(appRecords.id, id)));
  // Keep the server-side identity (foreign keys point at it) but stop it
  // signing in.
  if (collection === "staff") await db.update(staff).set({ isActive: false }).where(eq(staff.id, id));
}

/**
 * Fills an empty collection with its starting data — the first device to
 * open the portal against a fresh database does this, from the same sample
 * data the browser-only version used. A no-op once anything is stored, so
 * two devices racing to do it can't double up.
 */
export async function seedIfEmpty(collection: string, items: unknown): Promise<{ seeded: number }> {
  requireRule(collection);
  if (!Array.isArray(items) || items.length > MAX_SEED_ITEMS) throw new ApiError(422, "Seed data must be a list.");
  for (const item of items) enforce(checkRecord((item as { id?: string })?.id ?? "", item));

  const [existing] = await db
    .select({ id: appRecords.id })
    .from(appRecords)
    .where(eq(appRecords.collection, collection))
    .limit(1);
  if (existing || items.length === 0) return { seeded: 0 };

  const records = items as Data[];
  await db
    .insert(appRecords)
    .values(records.map((data) => ({ collection, id: data.id as string, data })))
    .onConflictDoNothing();
  if (collection === "staff") for (const person of records) await mirrorStaff(person);
  return { seeded: records.length };
}

/** Wipes every shared collection so the next page load reseeds it. Admin only. */
export async function resetAll(caller: Caller): Promise<void> {
  if (caller?.role !== "admin") throw new ApiError(403, "Only an admin can reset the demo data.");
  await db.delete(appRecords);
}

const ROLES: Role[] = ["admin", "production", "qa", "viewer"];

async function mirrorStaff(person: Data): Promise<void> {
  const { id, name, role, department, email, mesStage } = person as {
    id: string;
    name?: string;
    role?: string;
    department?: string;
    email?: string;
    mesStage?: number | null;
  };
  const station = typeof mesStage === "number" ? mesStage : null;
  if (!name || !email || !ROLES.includes(role as Role)) return;
  try {
    await db
      .insert(staff)
      .values({ id, name, role: role as Role, department: department ?? null, email, mesStage: station, isActive: true })
      .onConflictDoUpdate({
        target: staff.id,
        set: {
          name,
          role: role as Role,
          department: department ?? null,
          email,
          mesStage: station,
          isActive: true,
          updatedAt: sql`now()`,
        },
      });
  } catch (error) {
    // Most likely another person already has this email — the shared record
    // is saved regardless; they just can't use the server-backed sections
    // until the clash is fixed.
    console.warn(`Couldn't mirror staff ${id} into the staff table:`, error);
  }
}

/**
 * Raises a bell notification for someone, server-side — so it reaches every
 * device they use, not just the one that caused it.
 */
export async function notify(input: {
  recipientId: string;
  type: "message" | "task" | "batch" | "mes";
  title: string;
  body: string;
  href: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const id = `not_${randomUUID().slice(0, 8)}`;
  await db
    .insert(appRecords)
    .values({ collection: "notifications", id, data: { ...input, id, read: false, createdAt: now, updatedAt: now } });
}
