import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { setPinned } from "@/server/messaging/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/messages/conversations/:id/pin — `{ pinned: boolean }`, for the caller only. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { pinned?: unknown };
    if (typeof body.pinned !== "boolean") throw new ApiError(422, "pinned must be true or false.");
    await setPinned(id, actingStaff.id, body.pinned);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
