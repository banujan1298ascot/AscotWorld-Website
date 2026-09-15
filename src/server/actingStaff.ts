import type { Role } from "@/lib/types";

/** The calling staff member, as resolved by requireStaff — shared shape
 *  across every server module's validation rules (batch-book, mes, ...). */
export interface ActingStaff {
  id: string;
  role: Role;
}
