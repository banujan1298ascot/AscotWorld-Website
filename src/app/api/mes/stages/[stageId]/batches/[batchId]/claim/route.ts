import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { claimBatch } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

/**
 * POST /api/mes/stages/:stageId/batches/:batchId/claim
 *
 * Body is optional: `{ "operatorId": "staff_float_1" }` assigns the batch to
 * that operator instead of the caller (the station-tablet case).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    // No body at all is the ordinary self-claim, so an unparseable/empty
    // body is not an error here.
    const body = await request.json().catch(() => ({}));
    const operatorId = typeof body?.operatorId === "string" ? body.operatorId : null;
    const transition = await claimBatch(stageId, batchId, actingStaff, operatorId);
    return NextResponse.json({ transition });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
