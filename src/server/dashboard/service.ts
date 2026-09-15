/**
 * Production dashboard queries (spec 4.2). These are analytics
 * aggregations (AVG/COUNT/FILTER across stage_transitions) past what the
 * fluent query builder does cleanly, so they're raw SQL via `db.execute`
 * rather than forced through it — every interpolated `${value}` is a bound
 * parameter (drizzle's `sql` tag parameterizes them), never string-built,
 * so this is not vulnerable to injection despite being raw SQL text.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { buildThroughputSeries, type BatchExportRow, type DailyCount, type ThroughputDay } from "./metrics";

export interface StageOccupancy {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  count: number;
}

/** Batches currently in progress at each stage right now — spec 4.2's
 *  "live pipeline view / bottleneck view". */
export async function getStageOccupancy(departmentId: string): Promise<StageOccupancy[]> {
  const result = await db.execute<{
    stage_id: string;
    stage_name: string;
    sequence_number: number;
    count: number;
  }>(sql`
    SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
      COUNT(br.id)::int AS count
    FROM "stage_definitions" sd
    LEFT JOIN "batch_records" br
      ON br.current_stage_id = sd.id AND br.status = 'IN_PROGRESS'
    WHERE sd.department_id = ${departmentId} AND sd.sequence_number >= 2
    GROUP BY sd.id, sd.name, sd.sequence_number
    ORDER BY sd.sequence_number
  `);
  return result.rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    count: r.count,
  }));
}

/** Batches confirmed / fully completed / failed per day, for `days` days up
 *  to and including today (spec 4.2's volume trend, 4.3's trend line). */
export async function getThroughput(departmentId: string, days: number): Promise<ThroughputDay[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const [confirmedResult, completedResult, failedResult] = await Promise.all([
    db.execute<{ day: string; count: number }>(sql`
      SELECT to_char(confirmed_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "batch_records"
      WHERE department_id = ${departmentId} AND confirmed_at >= ${since}
      GROUP BY 1
    `),
    // A batch "completes" the moment it's forwarded out of the last stage
    // (Warehouse) — that transition has outcome FORWARD but no destination.
    db.execute<{ day: string; count: number }>(sql`
      SELECT to_char(st.completed_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "stage_transitions" st
      JOIN "batch_records" br ON br.id = st.batch_id
      WHERE br.department_id = ${departmentId}
        AND st.outcome = 'FORWARD' AND st.destination_stage_id IS NULL
        AND st.completed_at >= ${since}
      GROUP BY 1
    `),
    db.execute<{ day: string; count: number }>(sql`
      SELECT to_char(st.completed_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "stage_transitions" st
      JOIN "batch_records" br ON br.id = st.batch_id
      WHERE br.department_id = ${departmentId}
        AND st.outcome = 'FAILED'
        AND st.completed_at >= ${since}
      GROUP BY 1
    `),
  ]);

  const toDailyCounts = (rows: { day: string; count: number }[]): DailyCount[] =>
    rows.map((r) => ({ day: r.day, count: r.count }));

  return buildThroughputSeries(
    days,
    toDailyCounts(confirmedResult.rows),
    toDailyCounts(completedResult.rows),
    toDailyCounts(failedResult.rows),
  );
}

export interface StageDuration {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

/** Average time a batch spends at each stage, across every operator (spec
 *  4.2/4.3 — "average time per stage"). */
export async function getStageDurations(departmentId: string): Promise<StageDuration[]> {
  const result = await db.execute<{
    stage_id: string;
    stage_name: string;
    sequence_number: number;
    avg_seconds: number | null;
    sample_size: number;
  }>(sql`
    SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
      EXTRACT(EPOCH FROM AVG(st.duration))::float AS avg_seconds,
      COUNT(st.id)::int AS sample_size
    FROM "stage_definitions" sd
    LEFT JOIN "stage_transitions" st
      ON st.stage_id = sd.id AND st.completed_at IS NOT NULL
    LEFT JOIN "batch_records" br ON br.id = st.batch_id
    WHERE sd.department_id = ${departmentId} AND sd.sequence_number >= 2
    GROUP BY sd.id, sd.name, sd.sequence_number
    ORDER BY sd.sequence_number
  `);
  return result.rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    avgSeconds: r.avg_seconds,
    sampleSize: r.sample_size,
  }));
}

export interface StageReworkRate {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  totalClosed: number;
  sentBack: number;
  failed: number;
}

/** Rework and reject counts per stage (spec 4.2's rework/reject rate) — the
 *  percentage itself is computed client-side via computeRatePct so a
 *  zero-sample stage reads as "no data" rather than a misleading 0%. */
export async function getStageReworkRates(departmentId: string): Promise<StageReworkRate[]> {
  const result = await db.execute<{
    stage_id: string;
    stage_name: string;
    sequence_number: number;
    total_closed: number;
    sent_back: number;
    failed: number;
  }>(sql`
    SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
      COUNT(st.id) FILTER (WHERE st.completed_at IS NOT NULL)::int AS total_closed,
      COUNT(st.id) FILTER (WHERE st.outcome = 'SENT_BACK')::int AS sent_back,
      COUNT(st.id) FILTER (WHERE st.outcome = 'FAILED')::int AS failed
    FROM "stage_definitions" sd
    LEFT JOIN "stage_transitions" st ON st.stage_id = sd.id
    LEFT JOIN "batch_records" br ON br.id = st.batch_id
    WHERE sd.department_id = ${departmentId} AND sd.sequence_number >= 2
    GROUP BY sd.id, sd.name, sd.sequence_number
    ORDER BY sd.sequence_number
  `);
  return result.rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    totalClosed: r.total_closed,
    sentBack: r.sent_back,
    failed: r.failed,
  }));
}

export interface CycleTimeSummary {
  avgSeconds: number | null;
  sampleSize: number;
}

/** Average confirmation-to-completion time for batches completed in the
 *  last `days` days (spec 4.2's "total end-to-end cycle time per batch"). */
export async function getCycleTimeSummary(departmentId: string, days: number): Promise<CycleTimeSummary> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const result = await db.execute<{ avg_seconds: number | null; sample_size: number }>(sql`
    SELECT EXTRACT(EPOCH FROM AVG(st.completed_at - br.confirmed_at))::float AS avg_seconds,
      COUNT(*)::int AS sample_size
    FROM "stage_transitions" st
    JOIN "batch_records" br ON br.id = st.batch_id
    WHERE br.department_id = ${departmentId}
      AND st.outcome = 'FORWARD' AND st.destination_stage_id IS NULL
      AND st.completed_at >= ${since}
  `);
  const row = result.rows[0];
  return { avgSeconds: row?.avg_seconds ?? null, sampleSize: row?.sample_size ?? 0 };
}

export interface OperatorStageDuration {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  operatorId: string;
  operatorName: string;
  avgSeconds: number | null;
  sampleSize: number;
}

/** Average time per stage, broken down per operator (spec 4.2) — gated
 *  behind `dashboard.viewOperatorMetrics` at the route, not here; this
 *  function itself has no access-control opinion. */
export async function getOperatorStageDurations(departmentId: string): Promise<OperatorStageDuration[]> {
  const result = await db.execute<{
    stage_id: string;
    stage_name: string;
    sequence_number: number;
    operator_id: string;
    operator_name: string;
    avg_seconds: number | null;
    sample_size: number;
  }>(sql`
    SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
      st.operator_id, s.name AS operator_name,
      EXTRACT(EPOCH FROM AVG(st.duration))::float AS avg_seconds,
      COUNT(st.id)::int AS sample_size
    FROM "stage_transitions" st
    JOIN "stage_definitions" sd ON sd.id = st.stage_id
    JOIN "batch_records" br ON br.id = st.batch_id
    JOIN "staff" s ON s.id = st.operator_id
    WHERE br.department_id = ${departmentId} AND st.completed_at IS NOT NULL
    GROUP BY sd.id, sd.name, sd.sequence_number, st.operator_id, s.name
    ORDER BY sd.sequence_number, avg_seconds DESC NULLS LAST
  `);
  return result.rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    operatorId: r.operator_id,
    operatorName: r.operator_name,
    avgSeconds: r.avg_seconds,
    sampleSize: r.sample_size,
  }));
}

/** Batch-level export for compliance/management reporting (spec 4.3) — the
 *  route converts this to CSV via formatBatchesCsv. Capped at 1000 rows: a
 *  hard safety valve, not a real pagination story (there is none yet). */
export async function getBatchesForExport(departmentId: string): Promise<BatchExportRow[]> {
  const result = await db.execute<{
    batch_number: string | null;
    batch_type: string;
    department_name: string;
    product_name: string | null;
    quantity: string | null;
    unit: string | null;
    status: string;
    current_stage_name: string | null;
    created_at: string;
    confirmed_at: string | null;
    created_by_name: string;
    confirmed_by_name: string | null;
  }>(sql`
    SELECT br.batch_number, br.batch_type, d.name AS department_name, br.product_name,
      br.quantity, br.unit, br.status, sd.name AS current_stage_name,
      br.created_at, br.confirmed_at,
      creator.name AS created_by_name, confirmer.name AS confirmed_by_name
    FROM "batch_records" br
    JOIN "departments" d ON d.id = br.department_id
    LEFT JOIN "stage_definitions" sd ON sd.id = br.current_stage_id
    JOIN "staff" creator ON creator.id = br.created_by
    LEFT JOIN "staff" confirmer ON confirmer.id = br.confirmed_by
    WHERE br.department_id = ${departmentId}
    ORDER BY br.created_at DESC
    LIMIT 1000
  `);
  return result.rows.map((r) => ({
    batchNumber: r.batch_number,
    batchType: r.batch_type,
    departmentName: r.department_name,
    productName: r.product_name,
    quantity: r.quantity,
    unit: r.unit,
    status: r.status,
    currentStageName: r.current_stage_name,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    createdByName: r.created_by_name,
    confirmedByName: r.confirmed_by_name,
  }));
}
