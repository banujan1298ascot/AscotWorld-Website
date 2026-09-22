/**
 * One-off / idempotent seed for the Postgres side of the portal. Run with:
 *
 *   npm run db:seed
 *
 * Mirrors the same staff identities already hardcoded in src/lib/seed.ts
 * (same ids, e.g. "staff_admin") so a browser session signed in via the demo
 * localStorage auth maps onto a real row here — see the note in
 * src/server/db/schema/staff.ts. Also creates the Bespoke department and its
 * 7-stage pipeline (spec 3.0), since Bespoke is built first.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { departments, staff, stageDefinitions } from "./schema";

const STAFF = [
  { id: "staff_admin", name: "Priya Raman", role: "admin" as const, department: "Management", email: "p.raman@ascotworld.example" },
  { id: "staff_prod_1", name: "Daniel Okafor", role: "production" as const, department: "Production", email: "d.okafor@ascotworld.example" },
  { id: "staff_prod_2", name: "Marta Kowalska", role: "production" as const, department: "Production", email: "m.kowalska@ascotworld.example" },
  { id: "staff_prod_3", name: "Sam Whitfield", role: "production" as const, department: "Production", email: "s.whitfield@ascotworld.example" },
  { id: "staff_qa_1", name: "Aisha Bello", role: "qa" as const, department: "Quality Assurance", email: "a.bello@ascotworld.example" },
  { id: "staff_qa_2", name: "Tom Hargreaves", role: "qa" as const, department: "Quality Assurance", email: "t.hargreaves@ascotworld.example" },
  { id: "staff_eng", name: "Reece Donnelly", role: "production" as const, department: "Engineering", email: "r.donnelly@ascotworld.example" },
  { id: "staff_wh", name: "Grace Adeyemi", role: "production" as const, department: "Warehouse", email: "g.adeyemi@ascotworld.example" },
  { id: "staff_viewer", name: "Helen Voss", role: "viewer" as const, department: "Regulatory", email: "h.voss@ascotworld.example" },
  // MES station accounts — one per pipeline stage. Which stage each one is
  // pinned to lives in src/lib/seed.ts (`mesStage`); this table only needs
  // the identity, since it exists for foreign-key attribution.
  { id: "staff_stage_1", name: "Nadia Farouk", role: "production" as const, department: "Production", email: "n.farouk@ascotworld.example" },
  { id: "staff_stage_2", name: "Liam Byrne", role: "production" as const, department: "Production", email: "l.byrne@ascotworld.example" },
  { id: "staff_stage_3", name: "Ola Adeyinka", role: "production" as const, department: "Warehouse", email: "o.adeyinka@ascotworld.example" },
  { id: "staff_stage_4", name: "Ruth Cavendish", role: "production" as const, department: "Production", email: "r.cavendish@ascotworld.example" },
  { id: "staff_stage_5", name: "Jacob Lindqvist", role: "production" as const, department: "Production", email: "j.lindqvist@ascotworld.example" },
  { id: "staff_stage_6", name: "Yara Haddad", role: "qa" as const, department: "Quality Assurance", email: "y.haddad@ascotworld.example" },
  { id: "staff_stage_7", name: "Errol Simmons", role: "production" as const, department: "Warehouse", email: "e.simmons@ascotworld.example" },
  // Floating operators, assignable at any stage.
  { id: "staff_float_1", name: "Farah Iqbal", role: "production" as const, department: "Production", email: "f.iqbal@ascotworld.example" },
  { id: "staff_float_2", name: "Callum Reid", role: "production" as const, department: "Production", email: "c.reid@ascotworld.example" },
  { id: "staff_float_3", name: "Dmitri Volkov", role: "production" as const, department: "Production", email: "d.volkov@ascotworld.example" },
  { id: "staff_float_4", name: "Priti Shah", role: "qa" as const, department: "Quality Assurance", email: "p.shah@ascotworld.example" },
];

/** Spec 3.0's stage table. Stage 1 (Batch Book Entry) has no claim/drag
 *  screen of its own — its work is the Batch Book confirm action itself
 *  (see src/server/batch-book/service.ts), which auto-closes it and
 *  dispatches straight into stage 2's Incoming queue. Only Check 4 onward
 *  has fail authority (spec 3.2); only Check 6 releases onward to Warehouse. */
const BESPOKE_STAGES = [
  { sequenceNumber: 1, name: "Batch Book Entry", failAuthority: false, isTerminalReleaseStage: false, supervised: false },
  { sequenceNumber: 2, name: "Order/Calculation Check", failAuthority: false, isTerminalReleaseStage: false, supervised: false },
  { sequenceNumber: 3, name: "Raw Material Picking", failAuthority: false, isTerminalReleaseStage: false, supervised: false },
  // The supervisor is the only person at this station using the app: they
  // assign the check to an operator on the floor and move the batch on
  // themselves. See `supervised` in the stage_definitions schema.
  { sequenceNumber: 4, name: "Supervisor Material Check", failAuthority: true, isTerminalReleaseStage: false, supervised: true },
  { sequenceNumber: 5, name: "Production Check", failAuthority: true, isTerminalReleaseStage: false, supervised: false },
  { sequenceNumber: 6, name: "Final QA Release", failAuthority: true, isTerminalReleaseStage: true, supervised: false },
  { sequenceNumber: 7, name: "Warehouse", failAuthority: false, isTerminalReleaseStage: false, supervised: false },
];

async function main() {
  for (const person of STAFF) {
    await db
      .insert(staff)
      .values(person)
      .onConflictDoUpdate({
        target: staff.id,
        set: { name: person.name, role: person.role, department: person.department, email: person.email },
      });
  }

  await db.insert(departments).values({ name: "Bespoke" }).onConflictDoNothing({ target: departments.name });
  const [bespoke] = await db.select().from(departments).where(eq(departments.name, "Bespoke")).limit(1);

  for (const stage of BESPOKE_STAGES) {
    await db
      .insert(stageDefinitions)
      .values({ departmentId: bespoke.id, ...stage })
      .onConflictDoUpdate({
        target: [stageDefinitions.departmentId, stageDefinitions.sequenceNumber],
        set: {
          name: stage.name,
          failAuthority: stage.failAuthority,
          isTerminalReleaseStage: stage.isTerminalReleaseStage,
          supervised: stage.supervised,
        },
      });
  }

  console.log(`Seeded ${STAFF.length} staff rows, the Bespoke department, and its ${BESPOKE_STAGES.length} stages.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
