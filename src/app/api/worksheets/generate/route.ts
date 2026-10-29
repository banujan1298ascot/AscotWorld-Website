import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { generateWorksheetForBatch } from "@/server/worksheets/generate";
import { isWorksheetId } from "@/server/worksheets/validation";

/** POST /api/worksheets/generate — `{ batchId }`: generates (again) the
 *  worksheet for a confirmed batch — for one confirmed before its product
 *  had an approved worksheet, or after its details were corrected. Each
 *  run makes a new copy; earlier ones are kept. Batch Book entry or people
 *  with worksheet access. */
export async function POST(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = (await request.json().catch(() => null)) as { batchId?: unknown } | null;
    if (typeof body?.batchId !== "string" || !isWorksheetId(body.batchId)) throw new ApiError(404, "Batch not found.");
    return NextResponse.json({ worksheet: await generateWorksheetForBatch(body.batchId, actingStaff) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
