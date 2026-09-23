import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { isOutputRange } from "@/server/dashboard/metrics";
import { getOutputReport } from "@/server/dashboard/reports";

/** GET /api/mes/reports/output?departmentId=<uuid>&range=week|month|year —
 *  batches made (and started) per day or month, for the report's line chart. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");
    const range = request.nextUrl.searchParams.get("range") ?? "month";
    if (!isOutputRange(range)) throw new ApiError(400, "range must be week, month or year.");

    return NextResponse.json(await getOutputReport(departmentId, range));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
