import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { getStationLoads } from "@/server/dashboard/reports";

/** GET /api/mes/reports/stations?departmentId=<uuid> — how many batches are
 *  waiting / returned / in progress at every station right now, for the
 *  report's floor model. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");

    return NextResponse.json({ stations: await getStationLoads(departmentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
