import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { confirmBatch } from "@/server/batch-book/service";
import { generateWorksheetForBatch, type GenerateResult } from "@/server/worksheets/generate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/batch-book/:id/confirm — atomically assigns the batch number
 *  and dispatches the record into the MES pipeline (spec 2.1, 2.3), then
 *  generates the batch's worksheet from the approved one for its product.
 *  `worksheet` says how that went; a worksheet that couldn't be made never
 *  undoes the confirmation. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    const batch = await confirmBatch(id, actingStaff);
    const worksheet: GenerateResult = await generateWorksheetForBatch(batch.id, actingStaff).catch((err: unknown) => ({
      status: "failed" as const,
      message: err instanceof Error ? err.message : "The worksheet couldn't be generated.",
    }));
    return NextResponse.json({ batch, worksheet });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
