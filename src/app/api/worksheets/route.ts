import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { listWorksheets, mayManageWorksheets, startUpload } from "@/server/worksheets/service";
import { WORKSHEET_CHUNK_BYTES } from "@/lib/worksheetRules";

/** GET /api/worksheets — every approved and archived worksheet, and whether
 *  the caller may upload and move them. Anyone signed in. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const [worksheets, canManage] = await Promise.all([listWorksheets(), mayManageWorksheets(actingStaff)]);
    return NextResponse.json({ worksheets, canManage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/worksheets — starts an upload: `{ productName, version,
 * reference?, notes?, fileName, sizeBytes }`. Returns `{ id, chunkCount,
 * chunkBytes }`; the file then goes up in pieces (PUT .../chunks/:index) and
 * POST .../complete finishes it. People with worksheet access only.
 */
export async function POST(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "Expected a JSON body.");
    const upload = await startUpload(body, actingStaff);
    return NextResponse.json({ ...upload, chunkBytes: WORKSHEET_CHUNK_BYTES }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
