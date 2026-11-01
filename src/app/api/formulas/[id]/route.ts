import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { replaceFormula, withdrawFormula } from "@/server/formulas/service";
import { isWorksheetId } from "@/server/worksheets/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PUT /api/formulas/:id — saves a change as the formula's next version
 *  (the old one is kept, retired). People with worksheet access only. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    if (!isWorksheetId(id)) throw new ApiError(404, "Formula not found.");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "Expected a JSON body.");
    return NextResponse.json(await replaceFormula(id, body, actingStaff));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** DELETE /api/formulas/:id — takes the formula out of use; it stays on
 *  record. People with worksheet access only. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    if (!isWorksheetId(id)) throw new ApiError(404, "Formula not found.");
    await withdrawFormula(id, actingStaff);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
