import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { getRecentExceptions } from "@/server/dashboard/reports";

/** GET /api/mes/reports/exceptions?departmentId=<uuid> — the latest
 *  send-backs and failures across every station. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");

    return NextResponse.json({ exceptions: await getRecentExceptions(departmentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
