import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { createFormula, listFormulas } from "@/server/formulas/service";
import { mayManageWorksheets } from "@/server/worksheets/service";

/** GET /api/formulas — the product formulas in use, and whether the caller
 *  may change them. Anyone signed in. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const [formulas, canManage] = await Promise.all([listFormulas(), mayManageWorksheets(actingStaff)]);
    return NextResponse.json({ formulas, canManage });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/formulas — a new product's formula (see checkFormula in
 *  src/lib/formulaRules.ts). People with worksheet access only. */
export async function POST(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "Expected a JSON body.");
    return NextResponse.json(await createFormula(body, actingStaff), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
