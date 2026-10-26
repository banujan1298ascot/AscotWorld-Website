import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { completeUpload } from "@/server/worksheets/service";
import { isWorksheetId } from "@/server/worksheets/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/worksheets/:id/complete — `{ archiveIds? }`: once every piece
 *  of the file is in, the worksheet becomes Approved and the ones listed
 *  (its product's previous version) move to Archived. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    if (!isWorksheetId(id)) throw new ApiError(404, "Worksheet not found.");
    const body = (await request.json().catch(() => ({}))) as { archiveIds?: unknown };
    await completeUpload(id, body.archiveIds, actingStaff);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
