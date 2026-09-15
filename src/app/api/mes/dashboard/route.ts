import { NextRequest, NextResponse } from "next/server";
import { roleCan } from "@/lib/types";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import {
  getCycleTimeSummary,
  getOperatorStageDurations,
  getStageDurations,
  getStageOccupancy,
  getStageReworkRates,
  getThroughput,
} from "@/server/dashboard/service";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

/**
 * GET /api/mes/dashboard?departmentId=<uuid>&days=<n> — spec 4's production
 * dashboard. Requires `dashboard.view`; the per-operator breakdown
 * (`operatorStageDurations`) is included only when the caller also has
 * `dashboard.viewOperatorMetrics` — omitted server-side, not just hidden by
 * the client, so a capability change actually controls what data leaves
 * the server.
 */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");

    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? Math.max(1, Math.min(MAX_DAYS, Number(daysParam) || DEFAULT_DAYS)) : DEFAULT_DAYS;

    const [stageOccupancy, throughput, stageDurations, stageReworkRates, cycleTime] = await Promise.all([
      getStageOccupancy(departmentId),
      getThroughput(departmentId, days),
      getStageDurations(departmentId),
      getStageReworkRates(departmentId),
      getCycleTimeSummary(departmentId, days),
    ]);

    const operatorStageDurations = roleCan(actingStaff.role, "dashboard.viewOperatorMetrics")
      ? await getOperatorStageDurations(departmentId)
      : undefined;

    return NextResponse.json({
      days,
      stageOccupancy,
      throughput,
      stageDurations,
      stageReworkRates,
      cycleTime,
      operatorStageDurations,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
