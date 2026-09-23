import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { searchProducts } from "@/server/dashboard/reports";

/** GET /api/mes/reports/products?departmentId=<uuid>&q=<text> — product
 *  names containing every word typed (e.g. "amox 500"). */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");
    const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 120);

    return NextResponse.json({ products: await searchProducts(departmentId, query) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
