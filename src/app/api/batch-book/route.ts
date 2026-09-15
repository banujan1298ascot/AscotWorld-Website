import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { batchStatusEnum } from "@/server/db/schema";
import { createDraft, listBatches, type CreateDraftInput } from "@/server/batch-book/service";

const VALID_STATUSES = new Set(batchStatusEnum.enumValues);
type BatchStatus = (typeof batchStatusEnum.enumValues)[number];

function parseStatusFilter(request: NextRequest): BatchStatus | undefined {
  const raw = request.nextUrl.searchParams.get("status");
  if (!raw) return undefined;
  if (!VALID_STATUSES.has(raw as BatchStatus)) {
    throw new ApiError(400, `Unknown status filter "${raw}".`);
  }
  return raw as BatchStatus;
}

/** GET /api/batch-book?status=DRAFT — list batches. Viewing isn't
 *  capability-gated, matching every other module: anyone signed in with
 *  access to the section can see it, only mutations check a capability. */
export async function GET(request: NextRequest) {
  try {
    await requireStaff(request);
    const status = parseStatusFilter(request);
    const batches = await listBatches(status ? { status } : undefined);
    return NextResponse.json({ batches });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/batch-book — create a new draft. */
export async function POST(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = (await request.json()) as CreateDraftInput;
    const batch = await createDraft(body, actingStaff);
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
