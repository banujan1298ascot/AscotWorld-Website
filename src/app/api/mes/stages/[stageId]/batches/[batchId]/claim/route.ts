import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { claimBatch } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

/** POST /api/mes/stages/:stageId/batches/:batchId/claim */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    const transition = await claimBatch(stageId, batchId, actingStaff);
    return NextResponse.json({ transition });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
