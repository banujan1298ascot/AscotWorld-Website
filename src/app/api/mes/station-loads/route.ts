import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { getStationLoads } from "@/server/dashboard/reports";

/** GET /api/mes/station-loads?departmentId=<uuid> — how many batches sit at
 *  each station right now, for the live counters at the top of a station's
 *  MES screen. Counts only, no batch details, so any signed-in account may
 *  read it — including station tablets that can't open the other queues. */
export async function GET(request: NextRequest) {
  try {
    await requireStaff(request);

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");

    return NextResponse.json({ stations: await getStationLoads(departmentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
