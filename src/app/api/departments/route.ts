import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { db } from "@/server/db/client";
import { departments } from "@/server/db/schema";

/** GET /api/departments — active departments, for pickers (e.g. the Batch
 *  Book "new draft" form). Read-only, no capability beyond being signed in. */
export async function GET(request: NextRequest) {
  try {
    await requireStaff(request);
    const rows = await db.select().from(departments).where(eq(departments.isActive, true)).orderBy(departments.name);
    return NextResponse.json({ departments: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
