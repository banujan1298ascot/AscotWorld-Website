import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { getLabelRecord, recordLabelRun, type LabelRunInput } from "@/server/mes/labels";

interface RouteParams {
  params: Promise<{ batchId: string }>;
}

/** GET /api/mes/batches/:batchId/labels — the batch's label totals and every
 *  print run behind them. Readable by anyone signed in, like the Batch Book. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireStaff(request);
    const { batchId } = await params;
    return NextResponse.json({ labels: await getLabelRecord(batchId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/mes/batches/:batchId/labels — `{ kind: "FIRST_PRINT" | "REPRINT",
 * quantity, reason? }`. Check 2 only, while the batch is there; see
 * canRecordLabels and checkLabelRun in src/server/mes/validation.ts.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { batchId } = await params;
    const body = (await request.json().catch(() => null)) as LabelRunInput | null;
    if (!body) throw new ApiError(400, "Expected a JSON body.");
    const labels = await recordLabelRun(
      batchId,
      { kind: body.kind, quantity: body.quantity, reason: typeof body.reason === "string" ? body.reason : null },
      actingStaff,
    );
    return NextResponse.json({ labels });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
