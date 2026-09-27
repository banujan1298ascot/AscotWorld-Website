import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { markRead } from "@/server/messaging/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/messages/conversations/:id/read — marks the thread read for the caller. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    await markRead(id, actingStaff.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
