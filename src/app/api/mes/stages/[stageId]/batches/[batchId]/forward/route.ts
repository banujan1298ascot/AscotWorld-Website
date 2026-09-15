import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { forwardBatch } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

/** POST /api/mes/stages/:stageId/batches/:batchId/forward — send a claimed
 *  batch on to the next stage (or complete it, forwarding out of Warehouse). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    const batch = await forwardBatch(stageId, batchId, actingStaff);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
