import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/server/apiError";
import { requireCapability, requireStaff } from "@/server/auth/requireStaff";
import { getBatchesForExport } from "@/server/dashboard/service";
import { formatBatchesCsv } from "@/server/dashboard/metrics";

/** GET /api/mes/batches/export?departmentId=<uuid> — CSV export for
 *  compliance/management reporting (spec 4.3). Requires `dashboard.view`. */
export async function GET(request: NextRequest) {
  try {
    const actingStaff = await requireStaff(request);
    requireCapability(actingStaff, "dashboard.view");

    const departmentId = request.nextUrl.searchParams.get("departmentId");
    if (!departmentId) throw new ApiError(400, "departmentId is required.");

    const rows = await getBatchesForExport(departmentId);
    const csv = formatBatchesCsv(rows);
    const filename = `batches-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
