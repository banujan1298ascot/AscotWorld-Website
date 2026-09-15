import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { confirmBatch } from "@/server/batch-book/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/batch-book/:id/confirm — atomically assigns the batch number
 *  and dispatches the record into the MES pipeline (spec 2.1, 2.3). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    const batch = await confirmBatch(id, actingStaff);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
