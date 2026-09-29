/**
 * One-off / idempotent seed for the Postgres side of the portal. Run with:
 *
 *   npm run db:seed
 *
 * Mirrors the same staff identities already hardcoded in src/lib/seed.ts
 * (same ids, e.g. "staff_admin") so a browser session signed in via the demo
 * localStorage auth maps onto a real row here — see the note in
 * src/server/db/schema/staff.ts. Also creates the Bespoke department and its
 * 7-stage pipeline (spec 3.0), since Bespoke is built first, and — only
 * into an empty messages table — a few demo conversations.
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { appRecords, conversationParticipants, conversations, departments, messages, staff, stageDefinitions } from "./schema";

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
  // MES station accounts — one per pipeline stage, pinned to it by
  // `mesStage` (as in src/lib/seed.ts). The server needs the pin to know who
  // runs a supervised station: only Check 4's own account (or an admin) may
  // act there.
  { id: "staff_stage_1", name: "Nadia Farouk", role: "production" as const, department: "Production", email: "n.farouk@ascotworld.example", mesStage: 1 },
  { id: "staff_stage_2", name: "Liam Byrne", role: "production" as const, department: "Production", email: "l.byrne@ascotworld.example", mesStage: 2 },
  { id: "staff_stage_3", name: "Ola Adeyinka", role: "production" as const, department: "Warehouse", email: "o.adeyinka@ascotworld.example", mesStage: 3 },
  { id: "staff_stage_4", name: "Ruth Cavendish", role: "production" as const, department: "Production", email: "r.cavendish@ascotworld.example", mesStage: 4 },
  { id: "staff_stage_5", name: "Jacob Lindqvist", role: "production" as const, department: "Production", email: "j.lindqvist@ascotworld.example", mesStage: 5 },
  { id: "staff_stage_6", name: "Yara Haddad", role: "qa" as const, department: "Quality Assurance", email: "y.haddad@ascotworld.example", mesStage: 6 },
  { id: "staff_stage_7", name: "Errol Simmons", role: "production" as const, department: "Warehouse", email: "e.simmons@ascotworld.example", mesStage: 7 },
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
  // Each of Checks 2-4 only takes one kind of operator (`operatorRole`).
  {
    sequenceNumber: 2,
    name: "Order/Calculation Check",
    failAuthority: false,
    isTerminalReleaseStage: false,
    supervised: false,
    operatorRole: "order_processing",
  },
  {
    sequenceNumber: 3,
    name: "Raw Material Picking",
    failAuthority: false,
    isTerminalReleaseStage: false,
    supervised: false,
    operatorRole: "dispensary",
  },
  // The supervisor is the only person at this station using the app: they
  // assign the check to an operator on the floor and move the batch on
  // themselves. See `supervised` in the stage_definitions schema.
  {
    sequenceNumber: 4,
    name: "Supervisor Material Check",
    failAuthority: true,
    isTerminalReleaseStage: false,
    supervised: true,
    operatorRole: "bespoke_production",
  },
  { sequenceNumber: 5, name: "Production Check", failAuthority: true, isTerminalReleaseStage: false, supervised: false },
  { sequenceNumber: 6, name: "Final QA Release", failAuthority: true, isTerminalReleaseStage: true, supervised: false },
  { sequenceNumber: 7, name: "Warehouse", failAuthority: false, isTerminalReleaseStage: false, supervised: false },
];

/**
 * The demo team's MES operator types, and the job titles that go with them —
 * enough of each kind for the stations that need one: Order processing
 * operators (Check 2), Dispensary technicians (Check 3) and Bespoke
 * production operators (Check 4).
 */
const DEMO_OPERATOR_TYPES: Record<string, { operatorRole: string; jobTitle?: string }> = {
  staff_stage_2: { operatorRole: "order_processing" },
  staff_float_1: { operatorRole: "order_processing", jobTitle: "Order Processing Operator" },
  staff_stage_3: { operatorRole: "dispensary" },
  staff_prod_2: { operatorRole: "dispensary", jobTitle: "Dispensary Technician" },
  staff_prod_1: { operatorRole: "bespoke_production", jobTitle: "Senior Bespoke Production Operator" },
  staff_prod_3: { operatorRole: "bespoke_production", jobTitle: "Bespoke Production Operator" },
  staff_float_2: { operatorRole: "bespoke_production", jobTitle: "Bespoke Production Operator" },
  staff_float_3: { operatorRole: "bespoke_production", jobTitle: "Bespoke Production Operator" },
};

/**
 * Gives the demo team their operator types — on the server's staff table,
 * and on the shared Team-page records if they've already been created (only
 * the first time: once a record has a type, it's the Team page's to change).
 */
async function seedOperatorTypes(): Promise<void> {
  for (const [id, { operatorRole, jobTitle }] of Object.entries(DEMO_OPERATOR_TYPES)) {
    await db.update(staff).set({ operatorRole }).where(eq(staff.id, id));
    const patch = jobTitle ? { operatorRole, jobTitle } : { operatorRole };
    await db
      .update(appRecords)
      .set({ data: sql`${appRecords.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`now()` })
      .where(
        and(
          eq(appRecords.collection, "staff"),
          eq(appRecords.id, id),
          sql`NOT (${appRecords.data} ? 'operatorRole')`,
        ),
      );
  }
}

/** At `daysAgo` days back, `hour:minute` — keeps the demo threads recent. */
function at(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const DEMO_THREADS: {
  title: string | null;
  participants: string[];
  pinnedBy?: string[];
  /** Who hasn't seen the latest message yet — shows the unread badge. */
  unreadFor?: string[];
  messages: { from: string; body: string; at: Date }[];
}[] = [
  {
    title: null,
    participants: ["staff_admin", "staff_qa_1"],
    unreadFor: ["staff_admin"],
    messages: [
      { from: "staff_admin", body: "Morning Aisha — what's the latest on the fill-weight investigation for AW-24121?", at: at(2, 9, 15) },
      { from: "staff_qa_1", body: "Sampled 20 units, 3 came in under spec. Holding the batch until we've reviewed Filler F1's calibration log.", at: at(2, 9, 40) },
      { from: "staff_admin", body: "Good call. Let me know as soon as you've got a result.", at: at(2, 9, 42) },
      { from: "staff_qa_1", body: "Will do — should have an answer by tomorrow.", at: at(1, 14, 5) },
    ],
  },
  {
    title: "Tacrolimus line changeover",
    participants: ["staff_admin", "staff_qa_2", "staff_prod_3"],
    pinnedBy: ["staff_admin"],
    unreadFor: ["staff_admin"],
    messages: [
      { from: "staff_prod_3", body: "Line 2 clean-down complete, changeover checklist signed off.", at: at(0, 7, 50) },
      { from: "staff_qa_2", body: "Thanks Sam — I'll verify the API lot before we start dispensing.", at: at(0, 8, 10) },
    ],
  },
  {
    title: null,
    participants: ["staff_prod_1", "staff_wh"],
    messages: [
      { from: "staff_wh", body: "Have you got space for the extra pallet of bottles for AW-24124?", at: at(3, 11, 5) },
      { from: "staff_prod_1", body: "Yeah, warehouse bay 2 is clear — bring it over whenever.", at: at(3, 11, 20) },
    ],
  },
];

async function seedDemoConversations(): Promise<number> {
  const [existing] = await db.select({ id: conversations.id }).from(conversations).limit(1);
  if (existing) return 0; // real conversations exist — never add demo ones on top

  for (const thread of DEMO_THREADS) {
    const last = thread.messages[thread.messages.length - 1].at;
    const [conversation] = await db
      .insert(conversations)
      .values({
        title: thread.title,
        createdBy: thread.messages[0].from,
        lastMessageAt: last,
        createdAt: thread.messages[0].at,
        updatedAt: last,
      })
      .returning({ id: conversations.id });
    await db.insert(messages).values(
      thread.messages.map((m) => ({ conversationId: conversation.id, senderId: m.from, body: m.body, createdAt: m.at })),
    );
    await db.insert(conversationParticipants).values(
      thread.participants.map((staffId) => {
        const ownLast = [...thread.messages].reverse().find((m) => m.from === staffId)?.at ?? null;
        return {
          conversationId: conversation.id,
          staffId,
          lastReadAt: thread.unreadFor?.includes(staffId) ? ownLast : last,
          pinned: thread.pinnedBy?.includes(staffId) ?? false,
        };
      }),
    );
  }
  return DEMO_THREADS.length;
}

async function main() {
  for (const person of STAFF) {
    await db
      .insert(staff)
      .values(person)
      .onConflictDoUpdate({
        target: staff.id,
        set: {
          name: person.name,
          role: person.role,
          department: person.department,
          email: person.email,
          mesStage: "mesStage" in person ? person.mesStage : null,
        },
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
          operatorRole: "operatorRole" in stage ? stage.operatorRole : null,
        },
      });
  }

  await seedOperatorTypes();

  const threads = await seedDemoConversations();

  console.log(
    `Seeded ${STAFF.length} staff rows, the Bespoke department, its ${BESPOKE_STAGES.length} stages` +
      (threads ? `, and ${threads} demo conversations.` : " (conversations already exist, left alone)."),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
