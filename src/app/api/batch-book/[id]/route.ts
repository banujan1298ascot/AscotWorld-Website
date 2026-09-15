import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { getBatch, updateBatch, type UpdateBatchInput } from "@/server/batch-book/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/batch-book/:id */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireStaff(request);
    const { id } = await params;
    const batch = await getBatch(id);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface PatchBody {
  patch: UpdateBatchInput["patch"];
  reason?: string;
}

/** PATCH /api/batch-book/:id — edit a draft (own) or a confirmed/historical
 *  record (supervisor/QA, with a mandatory reason — spec 2.1). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    const body = (await request.json()) as PatchBody;
    const batch = await updateBatch(id, { patch: body.patch, reason: body.reason }, actingStaff);
    return NextResponse.json({ batch });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
