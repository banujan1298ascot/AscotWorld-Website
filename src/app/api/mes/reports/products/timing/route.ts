import { NextRequest, NextResponse } from "next/server";
import { roleCan } from "@/lib/types";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { getProductTiming } from "@/server/dashboard/reports";

/**
 * GET /api/mes/reports/products/timing?departmentId=<uuid>&product=<exact name>
 * — average time to make one product, per stage and (with
 * `dashboard.viewOperatorMetrics`) per operator. The operator breakdown is
 * left out server-side for anyone without that capability, same as the
 * dashboard endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");
    const product = request.nextUrl.searchParams.get("product");
    if (!product) throw new ApiError(400, "product is required.");

    const includeOperators = roleCan(actingStaff.role, "dashboard.viewOperatorMetrics");
    return NextResponse.json(await getProductTiming(departmentId, product, includeOperators));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
