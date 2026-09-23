/**
 * Queries behind the production report page: the batches-made chart, the
 * live floor model's per-station counts, recent exceptions, and the product
 * timing search. Raw SQL via `db.execute` for the same reason as
 * service.ts — every `${value}` is a bound parameter, never string-built.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  buildOutputSeries,
  outputWindow,
  percentChange,
  productSearchPatterns,
  timingConfidence,
  type BucketCount,
  type OutputPoint,
  type OutputRange,
  type TimingConfidence,
} from "./metrics";

/** A batch is "made" the moment it's forwarded out of the last stage
 *  (Warehouse): outcome FORWARD with nowhere to go next. */
const FINISHED = sql`st.outcome = 'FORWARD' AND st.destination_stage_id IS NULL`;

/* ---------------------------------------------------------------------------
 * Batches made over time
 * ------------------------------------------------------------------------- */

export interface OutputReport {
  range: OutputRange;
  bucket: "day" | "month";
  points: OutputPoint[];
  totalMade: number;
  totalStarted: number;
  previousMade: number;
  /** vs the equally long period before — null when that period made none,
   *  or when the MES wasn't in use for all of it (a first year compared with
   *  the three batches at the tail of the one before isn't a trend). */
  changePct: number | null;
}

export async function getOutputReport(departmentId: string, range: OutputRange): Promise<OutputReport> {
  const window = outputWindow(range);
  const format = window.bucket === "day" ? "YYYY-MM-DD" : "YYYY-MM";

  const [madeResult, startedResult, previousResult, firstResult] = await Promise.all([
    db.execute<{ bucket: string; count: number }>(sql`
      SELECT to_char(st.completed_at AT TIME ZONE 'UTC', ${format}) AS bucket, COUNT(*)::int AS count
      FROM "stage_transitions" st
      JOIN "batch_records" br ON br.id = st.batch_id
      WHERE br.department_id = ${departmentId} AND ${FINISHED} AND st.completed_at >= ${window.start}
      GROUP BY 1
    `),
    db.execute<{ bucket: string; count: number }>(sql`
      SELECT to_char(br.confirmed_at AT TIME ZONE 'UTC', ${format}) AS bucket, COUNT(*)::int AS count
      FROM "batch_records" br
      WHERE br.department_id = ${departmentId} AND br.confirmed_at >= ${window.start}
      GROUP BY 1
    `),
    db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM "stage_transitions" st
      JOIN "batch_records" br ON br.id = st.batch_id
      WHERE br.department_id = ${departmentId} AND ${FINISHED}
        AND st.completed_at >= ${window.previousStart} AND st.completed_at < ${window.start}
    `),
    db.execute<{ first: string | null }>(sql`
      SELECT MIN(br.confirmed_at) AS first
      FROM "batch_records" br
      WHERE br.department_id = ${departmentId} AND br.confirmed_at IS NOT NULL
    `),
  ]);

  const toCounts = (rows: { bucket: string; count: number }[]): BucketCount[] =>
    rows.map((r) => ({ bucket: r.bucket, count: r.count }));
  const points = buildOutputSeries(window.keys, toCounts(madeResult.rows), toCounts(startedResult.rows));
  const totalMade = points.reduce((n, p) => n + p.made, 0);
  const previousMade = previousResult.rows[0]?.count ?? 0;
  const firstConfirmed = firstResult.rows[0]?.first;
  // A little grace (a tenth of the period): history rarely starts exactly on
  // the window boundary.
  const graceMs = (window.start.getTime() - window.previousStart.getTime()) / 10;
  const coversPrevious =
    firstConfirmed != null && new Date(firstConfirmed).getTime() <= window.previousStart.getTime() + graceMs;

  return {
    range,
    bucket: window.bucket,
    points,
    totalMade,
    totalStarted: points.reduce((n, p) => n + p.started, 0),
    previousMade,
    changePct: coversPrevious ? percentChange(totalMade, previousMade) : null,
  };
}

/* ---------------------------------------------------------------------------
 * Live floor — what's waiting at each station right now
 * ------------------------------------------------------------------------- */

export interface StationLoad {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  /** Arrived forward, not yet claimed — the station's Incoming column. */
  incoming: number;
  /** Sent back for rework, not yet claimed — its Returned column. */
  returned: number;
  /** Claimed and being worked on. */
  inProgress: number;
}

/** Same Incoming / Returned / In progress split the MES board itself uses
 *  (getStageQueue), counted for every station at once. */
export async function getStationLoads(departmentId: string): Promise<StationLoad[]> {
  const result = await db.execute<{
    stage_id: string;
    stage_name: string;
    sequence_number: number;
    incoming: number;
    returned: number;
    in_progress: number;
  }>(sql`
    SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
      COUNT(br.id) FILTER (WHERE open.id IS NULL AND br.current_stage_arrival = 'FORWARD')::int AS incoming,
      COUNT(br.id) FILTER (WHERE open.id IS NULL AND br.current_stage_arrival = 'RETURNED')::int AS returned,
      COUNT(br.id) FILTER (WHERE open.id IS NOT NULL)::int AS in_progress
    FROM "stage_definitions" sd
    LEFT JOIN "batch_records" br ON br.current_stage_id = sd.id
    LEFT JOIN "stage_transitions" open
      ON open.batch_id = br.id AND open.stage_id = sd.id AND open.completed_at IS NULL
    WHERE sd.department_id = ${departmentId} AND sd.sequence_number >= 2
    GROUP BY sd.id, sd.name, sd.sequence_number
    ORDER BY sd.sequence_number
  `);
  return result.rows.map((r) => ({
    stageId: r.stage_id,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    incoming: r.incoming,
    returned: r.returned,
    inProgress: r.in_progress,
  }));
}

/* ---------------------------------------------------------------------------
 * Recent exceptions — send-backs and failures
 * ------------------------------------------------------------------------- */

export interface ReportException {
  id: string;
  outcome: "SENT_BACK" | "FAILED";
  at: string;
  batchNumber: string | null;
  productName: string | null;
  stageName: string;
  sequenceNumber: number;
  operatorName: string;
  notes: string | null;
}

export async function getRecentExceptions(departmentId: string, limit = 6): Promise<ReportException[]> {
  const result = await db.execute<{
    id: string;
    outcome: "SENT_BACK" | "FAILED";
    completed_at: string;
    batch_number: string | null;
    product_name: string | null;
    stage_name: string;
    sequence_number: number;
    operator_name: string;
    notes: string | null;
  }>(sql`
    SELECT st.id, st.outcome, st.completed_at, br.batch_number, br.product_name,
      sd.name AS stage_name, sd.sequence_number, s.name AS operator_name, st.notes
    FROM "stage_transitions" st
    JOIN "batch_records" br ON br.id = st.batch_id
    JOIN "stage_definitions" sd ON sd.id = st.stage_id
    JOIN "staff" s ON s.id = st.operator_id
    WHERE br.department_id = ${departmentId} AND st.outcome IN ('SENT_BACK', 'FAILED')
    ORDER BY st.completed_at DESC
    LIMIT ${limit}
  `);
  return result.rows.map((r) => ({
    id: r.id,
    outcome: r.outcome,
    at: new Date(r.completed_at).toISOString(),
    batchNumber: r.batch_number,
    productName: r.product_name,
    stageName: r.stage_name,
    sequenceNumber: r.sequence_number,
    operatorName: r.operator_name,
    notes: r.notes,
  }));
}

/* ---------------------------------------------------------------------------
 * Product timing search
 * ------------------------------------------------------------------------- */

export interface ProductMatch {
  productName: string;
  /** Every confirmed batch of it, finished or not. */
  batches: number;
  /** Only the finished ones — what the timing averages are built from. */
  completed: number;
}

/** Product names containing every word of `query`, most-made first. Drafts
 *  are left out — they haven't been confirmed as real work yet. */
export async function searchProducts(departmentId: string, query: string): Promise<ProductMatch[]> {
  const patterns = productSearchPatterns(query);
  if (patterns.length === 0) return [];

  const matchesEveryWord = sql.join(
    patterns.map((p) => sql`br.product_name ILIKE ${p}`),
    sql` AND `,
  );
  const result = await db.execute<{ product_name: string; batches: number; completed: number }>(sql`
    SELECT br.product_name, COUNT(*)::int AS batches,
      COUNT(*) FILTER (WHERE br.status = 'COMPLETED')::int AS completed
    FROM "batch_records" br
    WHERE br.department_id = ${departmentId} AND br.product_name IS NOT NULL
      AND br.status <> 'DRAFT' AND ${matchesEveryWord}
    GROUP BY br.product_name
    ORDER BY completed DESC, br.product_name
    LIMIT 8
  `);
  return result.rows.map((r) => ({ productName: r.product_name, batches: r.batches, completed: r.completed }));
}

export interface ProductStageTiming {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface ProductOperatorTiming {
  operatorId: string;
  operatorName: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface ProductTiming {
  productName: string;
  /** Finished batches the start-to-finish figures are averaged over. */
  sampleSize: number;
  confidence: TimingConfidence;
  /** Confirmed in the Batch Book → forwarded out of Warehouse, queues included. */
  avgLeadSeconds: number | null;
  minLeadSeconds: number | null;
  maxLeadSeconds: number | null;
  /** Sum of time actually held at each stage (claim → move on), queues excluded. */
  avgHandsOnSeconds: number | null;
  lastFinishedAt: string | null;
  stages: ProductStageTiming[];
  /** Omitted unless the caller may see per-operator figures. */
  operators?: ProductOperatorTiming[];
}

export async function getProductTiming(
  departmentId: string,
  productName: string,
  includeOperators: boolean,
): Promise<ProductTiming> {
  const [summaryResult, stageResult, operatorResult] = await Promise.all([
    db.execute<{
      sample_size: number;
      avg_lead: number | null;
      min_lead: number | null;
      max_lead: number | null;
      avg_hands_on: number | null;
      last_finished: string | null;
    }>(sql`
      WITH done AS (
        SELECT br.id, br.confirmed_at, st.completed_at AS finished_at
        FROM "batch_records" br
        JOIN "stage_transitions" st ON st.batch_id = br.id AND ${FINISHED}
        WHERE br.department_id = ${departmentId} AND br.product_name = ${productName}
      ), hands AS (
        SELECT st.batch_id, SUM(st.duration) AS hands_on
        FROM "stage_transitions" st
        JOIN done ON done.id = st.batch_id
        JOIN "stage_definitions" sd ON sd.id = st.stage_id
        -- Stage 1 is the Batch Book draft sitting until confirmed, not work.
        WHERE st.completed_at IS NOT NULL AND sd.sequence_number >= 2
        GROUP BY st.batch_id
      )
      SELECT COUNT(*)::int AS sample_size,
        EXTRACT(EPOCH FROM AVG(done.finished_at - done.confirmed_at))::float AS avg_lead,
        EXTRACT(EPOCH FROM MIN(done.finished_at - done.confirmed_at))::float AS min_lead,
        EXTRACT(EPOCH FROM MAX(done.finished_at - done.confirmed_at))::float AS max_lead,
        EXTRACT(EPOCH FROM AVG(hands.hands_on))::float AS avg_hands_on,
        MAX(done.finished_at) AS last_finished
      FROM done
      LEFT JOIN hands ON hands.batch_id = done.id
    `),
    // Every closed visit counts here, including ones from batches still in
    // the pipeline — each is a real measurement of that stage's time.
    db.execute<{
      stage_id: string;
      stage_name: string;
      sequence_number: number;
      avg_seconds: number | null;
      sample_size: number;
    }>(sql`
      SELECT sd.id AS stage_id, sd.name AS stage_name, sd.sequence_number,
        EXTRACT(EPOCH FROM AVG(visit.duration))::float AS avg_seconds,
        COUNT(visit.id)::int AS sample_size
      FROM "stage_definitions" sd
      LEFT JOIN (
        SELECT st.id, st.stage_id, st.duration
        FROM "stage_transitions" st
        JOIN "batch_records" br ON br.id = st.batch_id
        WHERE br.department_id = ${departmentId} AND br.product_name = ${productName}
          AND st.completed_at IS NOT NULL
      ) visit ON visit.stage_id = sd.id
      WHERE sd.department_id = ${departmentId} AND sd.sequence_number >= 2
      GROUP BY sd.id, sd.name, sd.sequence_number
      ORDER BY sd.sequence_number
    `),
    includeOperators
      ? db.execute<{
          operator_id: string;
          operator_name: string;
          stage_name: string;
          sequence_number: number;
          avg_seconds: number | null;
          sample_size: number;
        }>(sql`
          SELECT s.id AS operator_id, s.name AS operator_name, sd.name AS stage_name, sd.sequence_number,
            EXTRACT(EPOCH FROM AVG(st.duration))::float AS avg_seconds,
            COUNT(*)::int AS sample_size
          FROM "stage_transitions" st
          JOIN "batch_records" br ON br.id = st.batch_id
          JOIN "stage_definitions" sd ON sd.id = st.stage_id
          JOIN "staff" s ON s.id = st.operator_id
          WHERE br.department_id = ${departmentId} AND br.product_name = ${productName}
            AND st.completed_at IS NOT NULL AND sd.sequence_number >= 2
          GROUP BY s.id, s.name, sd.id, sd.name, sd.sequence_number
          ORDER BY sd.sequence_number, avg_seconds
        `)
      : null,
  ]);

  const summary = summaryResult.rows[0];
  const sampleSize = summary?.sample_size ?? 0;

  return {
    productName,
    sampleSize,
    confidence: timingConfidence(sampleSize),
    avgLeadSeconds: summary?.avg_lead ?? null,
    minLeadSeconds: summary?.min_lead ?? null,
    maxLeadSeconds: summary?.max_lead ?? null,
    avgHandsOnSeconds: summary?.avg_hands_on ?? null,
    lastFinishedAt: summary?.last_finished ? new Date(summary.last_finished).toISOString() : null,
    stages: stageResult.rows.map((r) => ({
      stageId: r.stage_id,
      stageName: r.stage_name,
      sequenceNumber: r.sequence_number,
      avgSeconds: r.avg_seconds,
      sampleSize: r.sample_size,
    })),
    operators: operatorResult
      ? operatorResult.rows.map((r) => ({
          operatorId: r.operator_id,
          operatorName: r.operator_name,
          stageName: r.stage_name,
          sequenceNumber: r.sequence_number,
          avgSeconds: r.avg_seconds,
          sampleSize: r.sample_size,
        }))
      : undefined,
  };
}
