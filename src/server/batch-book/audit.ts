/**
 * Audit trail for batch record edits (spec 2.1, 2.2, and the compliance
 * notes in 6). Split the same way as numbering: `diffFields` is pure and
 * unit-tested directly; `writeAuditEntries` is the thin DB call.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLogEntries } from "../db/schema";

/** Renders any field value as the text the audit log stores — consistent
 *  and reversible enough for a human reading old_value/new_value later. */
function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Compares two field maps and returns one FieldChange per field whose
 * rendered value actually differs — unchanged fields produce no row, since
 * an audit trail's value comes from only recording what actually moved.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const oldValue = renderValue(before[field]);
    const newValue = renderValue(after[field]);
    if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
  }
  // Stable order makes the trail readable and the tests deterministic.
  return changes.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Inserts one audit_log_entries row per change. Insert-only, as the schema's
 * comment says — never call update/delete against this table.
 */
export async function writeAuditEntries(
  tx: NodePgDatabase<Record<string, unknown>>,
  params: { batchId: string; changedBy: string; reason: string | null; changes: FieldChange[] },
): Promise<void> {
  if (params.changes.length === 0) return;
  await tx.insert(auditLogEntries).values(
    params.changes.map((change) => ({
      batchId: params.batchId,
      fieldChanged: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      changedBy: params.changedBy,
      reason: params.reason,
    })),
  );
}
