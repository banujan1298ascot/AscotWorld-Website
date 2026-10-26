import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { listAccess, setAccess } from "@/server/worksheets/service";

/** GET /api/worksheets/access — everyone, and who can upload and move
 *  worksheets. Admins only. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    return NextResponse.json({ people: await listAccess(actingStaff) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** PUT /api/worksheets/access — `{ staffId, allowed }`: give or take away
 *  someone's worksheet access. Admins only. */
export async function PUT(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = (await request.json().catch(() => null)) as { staffId?: unknown; allowed?: unknown } | null;
    if (!body) throw new ApiError(400, "Expected a JSON body.");
    await setAccess(body.staffId, body.allowed, actingStaff);
    return NextResponse.json({ people: await listAccess(actingStaff) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
