import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { failBatch } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

interface FailBody {
  notes: string;
  reasonCodeId?: string;
}

/** POST /api/mes/stages/:stageId/batches/:batchId/fail — only stages with
 *  fail authority (Check 4+, spec 3.2) can call this; the service layer
 *  checks that against the stage row, not the client's say-so. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as Partial<FailBody>;
    if (!body.notes) throw new ApiError(422, "A reason is required to fail a batch.");
    const batch = await failBatch(stageId, batchId, actingStaff, body.notes, body.reasonCodeId);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
