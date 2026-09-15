import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { listStages } from "@/server/mes/service";

/** GET /api/mes/stages?departmentId=<uuid> — stage definitions, for building
 *  the pipeline's stage picker. No capability beyond being signed in. */
export async function GET(request: NextRequest) {
  try {
    await requireStaff(request);
    const departmentId = request.nextUrl.searchParams.get("departmentId") ?? undefined;
    const stages = await listStages(departmentId);
    return NextResponse.json({ stages });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
