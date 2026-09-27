import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { listConversations, startConversation } from "@/server/messaging/service";

/** GET /api/messages/conversations — the caller's conversations, newest first. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    return NextResponse.json({ conversations: await listConversations(actingStaff.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/messages/conversations — `{ participantIds, title?, body }`.
 *  Starts a conversation (or reuses an existing 1:1 thread) with a first
 *  message. → `{ conversationId }` */
export async function POST(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await startConversation(actingStaff.id, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
