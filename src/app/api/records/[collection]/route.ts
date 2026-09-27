import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { optionalStaff } from "@/server/auth/requireStaff";
import { listRecords, seedIfEmpty } from "@/server/records/service";

interface RouteParams {
  params: Promise<{ collection: string }>;
}

/** GET /api/records/:collection?version= — every record the caller may see,
 *  or `{ unchanged: true }` if they already hold the current version. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const caller = await optionalStaff(request);
    const { collection } = await params;
    const version = request.nextUrl.searchParams.get("version");
    return NextResponse.json(await listRecords(collection, caller, version));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST /api/records/:collection — `{ items }`: starting data for an empty
 *  collection. Ignored once the collection has anything in it. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { collection } = await params;
    const body = (await request.json().catch(() => ({}))) as { items?: unknown };
    return NextResponse.json(await seedIfEmpty(collection, body.items));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
