import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { sendBatchBack } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string; batchId: string }>;
}

interface SendBackBody {
  notes: string;
  reasonCodeId?: string;
}

/** POST /api/mes/stages/:stageId/batches/:batchId/send-back — rework, with a
 *  mandatory free-text reason (spec 3.2). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { stageId, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as Partial<SendBackBody>;
    if (!body.notes) throw new ApiError(422, "A reason is required to send a batch back.");
    const batch = await sendBatchBack(stageId, batchId, actingStaff, body.notes, body.reasonCodeId);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
