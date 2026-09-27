import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { optionalStaff } from "@/server/auth/requireStaff";
import { deleteRecord, putRecord } from "@/server/records/service";

interface RouteParams {
  params: Promise<{ collection: string; id: string }>;
}

/** PUT /api/records/:collection/:id — creates or replaces the record (the
 *  body is the whole record). */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const caller = await optionalStaff(request);
    const { collection, id } = await params;
    const data = await request.json().catch(() => null);
    await putRecord(collection, id, data, caller);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const caller = await optionalStaff(request);
    const { collection, id } = await params;
    await deleteRecord(collection, id, caller);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
