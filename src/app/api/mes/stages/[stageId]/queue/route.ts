import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { getStageQueue } from "@/server/mes/service";

interface RouteParams {
  params: Promise<{ stageId: string }>;
}

/** GET /api/mes/stages/:stageId/queue — the Incoming/Returned/In-progress
 *  board for one stage (spec 3.1, 3.3). */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireStaff(request);
    const { stageId } = await params;
    const queue = await getStageQueue(stageId);
    return NextResponse.json({ queue });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
