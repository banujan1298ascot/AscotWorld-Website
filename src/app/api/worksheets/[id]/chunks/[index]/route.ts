import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { getChunk, putChunk } from "@/server/worksheets/service";
import { isWorksheetId } from "@/server/worksheets/validation";

interface RouteParams {
  params: Promise<{ id: string; index: string }>;
}

async function target(params: RouteParams["params"]) {
  const { id, index } = await params;
  const n = Number(index);
  if (!isWorksheetId(id) || !Number.isInteger(n) || n < 0) throw new ApiError(404, "File not found.");
  return { id, index: n };
}

/** GET /api/worksheets/:id/chunks/:index — one piece of a worksheet's file,
 *  as raw bytes. The page fetches every piece and joins them back up.
 *  Anyone signed in. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireStaff(request);
    const { id, index } = await target(params);
    const { data, contentType } = await getChunk(id, index);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** PUT /api/worksheets/:id/chunks/:index — one piece of an upload in
 *  progress, as the raw request body. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const actingStaff = await requireStaff(request);
    const { id, index } = await target(params);
    const data = Buffer.from(await request.arrayBuffer());
    await putChunk(id, index, data, actingStaff);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
