import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { listMessages, sendMessage } from "@/server/messaging/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/messages/conversations/:id/messages — the thread, oldest first. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    return NextResponse.json({ messages: await listMessages(id, actingStaff.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/messages/conversations/:id/messages — `{ body }`. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { body?: unknown };
    return NextResponse.json({ message: await sendMessage(id, actingStaff.id, body.body) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
