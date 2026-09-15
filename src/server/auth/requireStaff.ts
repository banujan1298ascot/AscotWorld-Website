/**
 * ============================================================================
 * Demo trust boundary — read this before wiring up a new API route.
 * ----------------------------------------------------------------------------
 * Real auth (src/lib/auth.tsx) is still a browser-storage session with no
 * server-side verification, exactly as documented there. Every Batch Book API
 * route trusts an `x-staff-id` header the client sends on each request and
 * looks up that id's role here — there is no signature, token or password
 * check proving the request actually came from that staff member. Anyone
 * with devtools can change the header and act as someone else.
 *
 * This is acceptable for the same reason the rest of the demo auth is: it's
 * a working prototype for agreeing the design and the flows, not a
 * production deployment. TO MOVE TO REAL AUTH: replace `getStaffId` below
 * with reading a verified session (cookie/JWT) instead of a client-supplied
 * header — every route already calls through this one function, so that's
 * the only place that needs to change.
 * ========================================================================= */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { roleCan, type Capability } from "@/lib/types";
import { ApiError } from "../apiError";
import type { ActingStaff } from "../actingStaff";
import { db } from "../db/client";
import { staff } from "../db/schema";

export type { ActingStaff as RequestStaff };

function getStaffId(request: NextRequest): string | null {
  return request.headers.get("x-staff-id");
}

/** Resolves the calling staff member, or throws a 401 ApiError. */
export async function requireStaff(request: NextRequest): Promise<ActingStaff> {
  const id = getStaffId(request);
  if (!id) throw new ApiError(401, "Missing x-staff-id header.");

  const [row] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!row || !row.isActive) throw new ApiError(401, "Unknown or inactive staff id.");

  return { id: row.id, role: row.role };
}

/** Throws a 403 ApiError if `staffMember`'s role lacks `capability`. */
export function requireCapability(staffMember: ActingStaff, capability: Capability): void {
  if (!roleCan(staffMember.role, capability)) {
    throw new ApiError(403, `Your role cannot perform this action (${capability}).`);
  }
}
