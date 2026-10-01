import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/apiError";
import { requireStaff } from "@/server/auth/requireStaff";
import { suggestProducts } from "@/server/batch-book/products";

/** GET /api/batch-book/products?q=<text> — products made before that match
 *  what's being typed, with the details to fill the new-batch form in.
 *  Anyone signed in, like the Batch Book itself. */
export async function GET(request: NextRequest) {
  try {
    await requireStaff(request);
    const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
    return NextResponse.json({ products: await suggestProducts(query) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
