import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { moveWorksheet } from "@/server/worksheets/service";
import { isWorksheetId } from "@/server/worksheets/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH /api/worksheets/:id — `{ status: "ARCHIVED" | "APPROVED", note? }`:
 *  archive a worksheet, or restore an archived one. People with worksheet
 *  access only. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    if (!isWorksheetId(id)) throw new ApiError(404, "Worksheet not found.");
    const body = (await request.json().catch(() => null)) as { status?: unknown; note?: unknown } | null;
    if (!body) throw new ApiError(400, "Expected a JSON body.");
    await moveWorksheet(id, body.status, body.note, actingStaff);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
