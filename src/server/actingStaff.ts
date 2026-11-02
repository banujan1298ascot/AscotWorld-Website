import type { StaffAccess } from "@/lib/access";
import type { Role } from "@/lib/types";

/** The calling staff member, as resolved by requireStaff — shared shape
 *  across every server module's validation rules (batch-book, mes, ...). */
export interface ActingStaff {
  id: string;
  role: Role;
  /** The MES station they're pinned to, if any — see staff.mes_stage. */
  mesStage?: number | null;
  /** Where their access differs from their role's — check abilities with
   *  staffCan (src/lib/access.ts), never the role alone. */
  access?: StaffAccess | null;
}
