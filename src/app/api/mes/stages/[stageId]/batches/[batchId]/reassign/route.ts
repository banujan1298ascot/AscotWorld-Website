import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { reassignBatch } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

/**
 * POST /api/mes/stages/:stageId/batches/:batchId/reassign — `{ operatorId }`.
 * Moves an in-progress batch to a different operator. Allowed for its
 * current holder, or anyone running a supervised station.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { operatorId?: unknown };
    if (typeof body.operatorId !== "string" || !body.operatorId) throw new ApiError(422, "Choose an operator.");
    const transition = await reassignBatch(stageId, batchId, actingStaff, body.operatorId);
    return NextResponse.json({ transition });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
