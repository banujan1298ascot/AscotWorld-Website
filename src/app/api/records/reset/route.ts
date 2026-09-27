import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { resetAll } from "@/server/records/service";

/** POST /api/records/reset — admin only: wipes the shared tasks, schedule,
 *  team, rota and notifications so the next page load reseeds the samples. */
export async function POST(request: NextRequest) {
  try {
    await resetAll(await requireStaff(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
