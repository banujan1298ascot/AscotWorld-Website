import { addDays, format, startOfWeek } from "date-fns";
import { createCollection } from "./storage";
import {
  DEFAULT_DEPARTMENTS,
  type AppNotification,
  type Batch,
  type DepartmentRecord,
  type ShiftEntry,
  type StaffMember,
  type Task,
} from "./types";

/* ============================================================================
 * Demo data
 * ----------------------------------------------------------------------------
 * Seeded once into the shared database by the first device to open the
 * portal against an empty one (see src/lib/storage.ts), then owned by the
 * users — edits persist, for everyone, until an admin uses "Reset demo data".
 *
 * Dates are generated relative to the day the data is seeded, so a freshly
 * reset portal's calendar and rota look current.
 * ========================================================================= */

const today = new Date();
const iso = (d: Date) => format(d, "yyyy-MM-dd");
const day = (offset: number) => iso(addDays(today, offset));
const stamp = (offset: number) => addDays(today, offset).toISOString();
/** Same as `stamp`, with a specific time of day — used to order messages within a conversation. */
const stampAt = (offset: number, hour: number, minute = 0) => {
  const d = addDays(today, offset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/* -------------------------------------------------------------------------- */
/* Staff                                                                      */
/* -------------------------------------------------------------------------- */

const staffSeed = (): StaffMember[] =>
  [
    {
      id: "staff_admin",
      name: "Priya Raman",
      initials: "PR",
      role: "admin" as const,
      jobTitle: "Operations Manager",
      department: "Management" as const,
      email: "p.raman@ascotworld.example",
      phone: "020 8953 0141",
      demoPassword: "demo1234",
    },
    {
      id: "staff_prod_1",
      name: "Daniel Okafor",
      initials: "DO",
      role: "production" as const,
      jobTitle: "Senior Bespoke Production Operator",
      department: "Production" as const,
      email: "d.okafor@ascotworld.example",
      phone: "020 8953 0142",
      demoPassword: "demo1234",
      operatorRole: "bespoke_production" as const,
    },
    {
      id: "staff_prod_2",
      name: "Marta Kowalska",
      initials: "MK",
      role: "production" as const,
      jobTitle: "Dispensary Technician",
      department: "Production" as const,
      email: "m.kowalska@ascotworld.example",
      phone: "020 8953 0143",
      demoPassword: "demo1234",
      operatorRole: "dispensary" as const,
    },
    {
      id: "staff_prod_3",
      name: "Sam Whitfield",
      initials: "SW",
      role: "production" as const,
      jobTitle: "Bespoke Production Operator",
      department: "Production" as const,
      email: "s.whitfield@ascotworld.example",
      phone: "020 8953 0144",
      demoPassword: "demo1234",
      operatorRole: "bespoke_production" as const,
    },
    {
      id: "staff_qa_1",
      name: "Aisha Bello",
      initials: "AB",
      role: "qa" as const,
      jobTitle: "Qualified Person (QP)",
      department: "Quality Assurance" as const,
      email: "a.bello@ascotworld.example",
      phone: "020 8953 0151",
      demoPassword: "demo1234",
    },
    {
      id: "staff_qa_2",
      name: "Tom Hargreaves",
      initials: "TH",
      role: "qa" as const,
      jobTitle: "QA Analyst",
      department: "Quality Assurance" as const,
      email: "t.hargreaves@ascotworld.example",
      phone: "020 8953 0152",
      demoPassword: "demo1234",
    },
    {
      id: "staff_eng",
      name: "Reece Donnelly",
      initials: "RD",
      role: "production" as const,
      jobTitle: "Maintenance Engineer",
      department: "Engineering" as const,
      email: "r.donnelly@ascotworld.example",
      phone: "020 8953 0161",
      demoPassword: "demo1234",
    },
    {
      id: "staff_wh",
      name: "Grace Adeyemi",
      initials: "GA",
      role: "production" as const,
      jobTitle: "Warehouse Supervisor",
      department: "Warehouse" as const,
      email: "g.adeyemi@ascotworld.example",
      phone: "020 8953 0171",
      demoPassword: "demo1234",
    },
    {
      id: "staff_viewer",
      name: "Helen Voss",
      initials: "HV",
      role: "viewer" as const,
      jobTitle: "External Auditor",
      department: "Regulatory" as const,
      email: "h.voss@ascotworld.example",
      phone: "—",
      demoPassword: "demo1234",
    },

    /* ---- MES station accounts ------------------------------------------
     * One per pipeline stage. Each is pinned to its own stage via `mesStage`,
     * so signing in as one shows that station's queue and nothing else —
     * the way a tablet mounted at that station should behave. Everyone above
     * has no `mesStage` and keeps the full cross-stage view.
     * Their ids are mirrored into Postgres by src/server/db/seed.ts, since a
     * claimed batch records its operator as a real foreign key. */
    {
      id: "staff_stage_1",
      name: "Nadia Farouk",
      initials: "NF",
      role: "production" as const,
      jobTitle: "Batch Book Clerk",
      department: "Production" as const,
      email: "n.farouk@ascotworld.example",
      phone: "020 8953 0161",
      demoPassword: "demo1234",
      mesStage: 1,
    },
    {
      id: "staff_stage_2",
      name: "Liam Byrne",
      initials: "LB",
      role: "production" as const,
      jobTitle: "Order & Calculation Checker",
      department: "Production" as const,
      email: "l.byrne@ascotworld.example",
      phone: "020 8953 0162",
      demoPassword: "demo1234",
      mesStage: 2,
      operatorRole: "order_processing" as const,
    },
    {
      id: "staff_stage_3",
      name: "Ola Adeyinka",
      initials: "OA",
      role: "production" as const,
      jobTitle: "Raw Material Picker",
      department: "Warehouse" as const,
      email: "o.adeyinka@ascotworld.example",
      phone: "020 8953 0163",
      demoPassword: "demo1234",
      mesStage: 3,
      operatorRole: "dispensary" as const,
    },
    {
      id: "staff_stage_4",
      name: "Ruth Cavendish",
      initials: "RC",
      role: "production" as const,
      jobTitle: "Production Supervisor",
      department: "Production" as const,
      email: "r.cavendish@ascotworld.example",
      phone: "020 8953 0164",
      demoPassword: "demo1234",
      mesStage: 4,
    },
    {
      id: "staff_stage_5",
      name: "Jacob Lindqvist",
      initials: "JL",
      role: "production" as const,
      jobTitle: "Production Check Operator",
      department: "Production" as const,
      email: "j.lindqvist@ascotworld.example",
      phone: "020 8953 0165",
      demoPassword: "demo1234",
      mesStage: 5,
    },
    {
      id: "staff_stage_6",
      name: "Yara Haddad",
      initials: "YH",
      role: "qa" as const,
      jobTitle: "QA Release Officer",
      department: "Quality Assurance" as const,
      email: "y.haddad@ascotworld.example",
      phone: "020 8953 0166",
      demoPassword: "demo1234",
      mesStage: 6,
    },
    {
      id: "staff_stage_7",
      name: "Errol Simmons",
      initials: "ES",
      role: "production" as const,
      jobTitle: "Warehouse Operative",
      department: "Warehouse" as const,
      email: "e.simmons@ascotworld.example",
      phone: "020 8953 0167",
      demoPassword: "demo1234",
      mesStage: 7,
    },

    /* ---- Floating operators --------------------------------------------
     * Not pinned to a station, so they can be assigned work at any stage —
     * these are who a station picks from when handing a batch to a named
     * person rather than claiming it themselves. */
    {
      id: "staff_float_1",
      name: "Farah Iqbal",
      initials: "FI",
      role: "production" as const,
      jobTitle: "Order Processing Operator",
      department: "Production" as const,
      email: "f.iqbal@ascotworld.example",
      phone: "020 8953 0171",
      demoPassword: "demo1234",
      operatorRole: "order_processing" as const,
    },
    {
      id: "staff_float_2",
      name: "Callum Reid",
      initials: "CR",
      role: "production" as const,
      jobTitle: "Bespoke Production Operator",
      department: "Production" as const,
      email: "c.reid@ascotworld.example",
      phone: "020 8953 0172",
      demoPassword: "demo1234",
      operatorRole: "bespoke_production" as const,
    },
    {
      id: "staff_float_3",
      name: "Dmitri Volkov",
      initials: "DV",
      role: "production" as const,
      jobTitle: "Bespoke Production Operator",
      department: "Production" as const,
      email: "d.volkov@ascotworld.example",
      phone: "020 8953 0173",
      demoPassword: "demo1234",
      operatorRole: "bespoke_production" as const,
    },
    {
      id: "staff_float_4",
      name: "Priti Shah",
      initials: "PS",
      role: "qa" as const,
      jobTitle: "QA Technician",
      department: "Quality Assurance" as const,
      email: "p.shah@ascotworld.example",
      phone: "020 8953 0174",
      demoPassword: "demo1234",
    },
  ].map((s) => ({ ...s, createdAt: stamp(-120), updatedAt: stamp(-120) }));

/* -------------------------------------------------------------------------- */
/* Batches                                                                    */
/* -------------------------------------------------------------------------- */

const batchSeed = (): Batch[] =>
  [
    {
      id: "batch_1",
      batchNo: "AW-24118",
      product: "Omeprazole 2mg/ml Oral Suspension",
      productLine: "human" as const,
      quantity: 480,
      unit: "bottles",
      startDate: day(-4),
      endDate: day(-2),
      status: "released" as const,
      lineId: "line-1",
      roomId: "room-a",
      equipmentId: "eq-mixer-1",
      operatorIds: ["staff_prod_1", "staff_prod_2"],
      qaOwnerId: "staff_qa_1",
      releasedById: "staff_qa_1",
      releasedAt: stamp(-2),
      notes: "Yield within specification. COA issued.",
    },
    {
      id: "batch_2",
      batchNo: "AW-24119",
      product: "Hydrocortisone 1% Cream BP",
      productLine: "human" as const,
      quantity: 1200,
      unit: "tubes",
      startDate: day(-1),
      endDate: day(1),
      status: "in_production" as const,
      lineId: "line-2",
      roomId: "room-a",
      equipmentId: "eq-mixer-2",
      operatorIds: ["staff_prod_2", "staff_prod_3"],
      qaOwnerId: "staff_qa_2",
      releasedById: null,
      releasedAt: null,
      notes: "Second of three scheduled runs this month.",
    },
    {
      id: "batch_3",
      batchNo: "AW-24120",
      product: "Meloxicam 1.5mg/ml Oral Suspension",
      productLine: "veterinary" as const,
      quantity: 300,
      unit: "bottles",
      startDate: day(0),
      endDate: day(2),
      status: "in_production" as const,
      lineId: "line-1",
      roomId: "room-b",
      equipmentId: "eq-fill-1",
      operatorIds: ["staff_prod_1"],
      qaOwnerId: "staff_qa_1",
      releasedById: null,
      releasedAt: null,
      notes: "Canine formulation — palatability check required at fill.",
    },
    {
      id: "batch_4",
      batchNo: "AW-24121",
      product: "Sodium Chloride 0.9% Nasal Spray",
      productLine: "human" as const,
      quantity: 950,
      unit: "units",
      startDate: day(0),
      endDate: day(1),
      status: "qa_hold" as const,
      lineId: "line-1",
      roomId: "room-c",
      equipmentId: "eq-fill-1",
      operatorIds: ["staff_prod_3"],
      qaOwnerId: "staff_qa_2",
      releasedById: null,
      releasedAt: null,
      // Deliberately shares Filler F1 with AW-24120 so the schedule opens with
      // one genuine resource clash, demonstrating the double-booking warning.
      notes:
        "Held pending fill-weight investigation on units 400–460. Filler F1 is also booked to AW-24120 — needs resolving.",
    },
    {
      id: "batch_5",
      batchNo: "AW-24122",
      product: "Phenobarbital 5mg/ml Oral Solution",
      productLine: "veterinary" as const,
      quantity: 220,
      unit: "bottles",
      startDate: day(3),
      endDate: day(5),
      status: "scheduled" as const,
      lineId: "line-1",
      roomId: "room-b",
      equipmentId: "eq-mixer-2",
      operatorIds: ["staff_prod_2"],
      qaOwnerId: "staff_qa_1",
      releasedById: null,
      releasedAt: null,
      notes: "Controlled drug — CD register entry required before dispensing.",
    },
    {
      id: "batch_6",
      batchNo: "AW-24123",
      product: "Tacrolimus 0.03% Ointment",
      productLine: "human" as const,
      quantity: 400,
      unit: "tubes",
      startDate: day(3),
      endDate: day(6),
      status: "scheduled" as const,
      lineId: "line-2",
      roomId: "room-a",
      equipmentId: "eq-mixer-1",
      operatorIds: ["staff_prod_1", "staff_prod_3"],
      qaOwnerId: "staff_qa_2",
      releasedById: null,
      releasedAt: null,
      notes: "Named-patient special. Confirm API lot before dispensing.",
    },
    {
      id: "batch_7",
      batchNo: "AW-24124",
      product: "Furosemide 8mg/ml Oral Solution",
      productLine: "human" as const,
      quantity: 640,
      unit: "bottles",
      startDate: day(5),
      endDate: day(8),
      status: "scheduled" as const,
      lineId: "line-3",
      roomId: "room-c",
      equipmentId: "eq-blist-1",
      operatorIds: ["staff_prod_2"],
      qaOwnerId: "staff_qa_1",
      releasedById: null,
      releasedAt: null,
      notes: "",
    },
    {
      id: "batch_8",
      batchNo: "AW-24125",
      product: "Ciclosporin 50mg/ml Oral Solution",
      productLine: "veterinary" as const,
      quantity: 180,
      unit: "bottles",
      startDate: day(8),
      endDate: day(10),
      status: "scheduled" as const,
      lineId: "line-1",
      roomId: "room-b",
      equipmentId: "eq-mixer-2",
      operatorIds: ["staff_prod_3"],
      qaOwnerId: "staff_qa_2",
      releasedById: null,
      releasedAt: null,
      notes: "Feline formulation.",
    },
    {
      id: "batch_9",
      batchNo: "AW-24117",
      product: "Metronidazole 50mg/ml Suspension",
      productLine: "human" as const,
      quantity: 250,
      unit: "bottles",
      startDate: day(-8),
      endDate: day(-6),
      status: "cancelled" as const,
      lineId: "line-1",
      roomId: "room-a",
      equipmentId: "eq-mixer-1",
      operatorIds: [],
      qaOwnerId: "staff_qa_1",
      releasedById: null,
      releasedAt: null,
      notes: "Cancelled — API supply delayed by supplier. Rescheduling to next month.",
    },
    {
      id: "batch_10",
      batchNo: "AW-24126",
      product: "Paracetamol 500mg Tablets",
      productLine: "human" as const,
      quantity: 20000,
      unit: "tablets",
      startDate: day(0),
      endDate: day(2),
      status: "in_production" as const,
      lineId: "line-4",
      roomId: "room-c",
      equipmentId: "eq-blist-1",
      operatorIds: ["staff_prod_2"],
      qaOwnerId: "staff_qa_2",
      releasedById: null,
      releasedAt: null,
      notes: "High-volume run — packaging line booked back-to-back after compression.",
    },
    {
      id: "batch_11",
      batchNo: "AW-24127",
      product: "Doxycycline 100mg Capsules",
      productLine: "human" as const,
      quantity: 8000,
      unit: "capsules",
      startDate: day(0),
      endDate: day(2),
      status: "in_production" as const,
      lineId: "line-3",
      roomId: "room-a",
      equipmentId: "eq-mixer-1",
      operatorIds: ["staff_prod_3"],
      qaOwnerId: "staff_qa_1",
      releasedById: null,
      releasedAt: null,
      notes: "Blend and encapsulate — Liquids, Tablets and Capsules all running today.",
    },
  ].map((b) => ({ ...b, createdAt: stamp(-30), updatedAt: stamp(-2) }));

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

const taskSeed = (): Task[] =>
  [
    {
      id: "task_1",
      title: "Investigate fill-weight variance on AW-24121",
      detail:
        "Units 400–460 fell below the lower fill limit. Check filler F1 calibration, sample 20 units and record findings against the deviation log.",
      status: "in_progress" as const,
      priority: "critical" as const,
      assigneeId: "staff_qa_2",
      dueDate: day(0),
      batchId: "batch_4",
    },
    {
      id: "task_2",
      title: "Line 2 changeover cleaning before Tacrolimus run",
      detail:
        "Full clean-down and line clearance between Hydrocortisone and Tacrolimus. Complete the changeover checklist and get it countersigned.",
      status: "todo" as const,
      priority: "high" as const,
      assigneeId: "staff_prod_3",
      dueDate: day(2),
      batchId: "batch_6",
    },
    {
      id: "task_3",
      title: "Verify API lot for Tacrolimus special",
      detail: "Confirm the API lot number and expiry against the named-patient prescription before dispensing.",
      status: "todo" as const,
      priority: "high" as const,
      assigneeId: "staff_qa_1",
      dueDate: day(2),
      batchId: "batch_6",
    },
    {
      id: "task_4",
      title: "Monthly calibration — Vessel M1 temperature probe",
      detail: "Routine calibration due. Record certificate number in the equipment log.",
      status: "todo" as const,
      priority: "normal" as const,
      assigneeId: "staff_eng",
      dueDate: day(4),
      batchId: null,
    },
    {
      id: "task_5",
      title: "CD register entry for Phenobarbital batch",
      detail: "Controlled drug — complete the register entry and arrange the second signature before the run starts.",
      status: "todo" as const,
      priority: "high" as const,
      assigneeId: "staff_prod_2",
      dueDate: day(1),
      batchId: "batch_5",
    },
    {
      id: "task_6",
      title: "Chase API delivery from supplier",
      detail: "Metronidazole API delayed and the batch was cancelled. Get a firm delivery date so it can be rescheduled.",
      status: "blocked" as const,
      priority: "normal" as const,
      assigneeId: "staff_wh",
      dueDate: day(-1),
      batchId: "batch_9",
    },
    {
      id: "task_7",
      title: "Issue COA for AW-24118",
      detail: "Certificate of analysis for the released Omeprazole batch.",
      status: "done" as const,
      priority: "normal" as const,
      assigneeId: "staff_qa_1",
      dueDate: day(-1),
      batchId: "batch_1",
    },
    {
      id: "task_8",
      title: "Update SOP-114 cleaning validation",
      detail: "Annual review of the cleaning validation SOP is overdue for sign-off.",
      status: "todo" as const,
      priority: "low" as const,
      assigneeId: "staff_admin",
      dueDate: day(12),
      batchId: null,
    },
    {
      id: "task_11",
      title: "Review supplier audit questionnaire",
      detail:
        "New excipient supplier has returned their questionnaire. Needs reviewing and filing before we can approve them.",
      status: "todo" as const,
      priority: "low" as const,
      // Left unassigned deliberately — shows the unassigned state on the board.
      assigneeId: null,
      dueDate: day(9),
      batchId: null,
    },
    {
      id: "task_9",
      title: "Stock count — packaging components",
      detail: "Quarterly count of bottles, caps and cartons ahead of next month's schedule.",
      status: "in_progress" as const,
      priority: "normal" as const,
      assigneeId: "staff_wh",
      dueDate: day(3),
      batchId: null,
    },
    {
      id: "task_10",
      title: "Palatability check on veterinary Meloxicam fill",
      detail: "Sample at fill and record against the batch record.",
      status: "todo" as const,
      priority: "normal" as const,
      assigneeId: "staff_prod_1",
      dueDate: day(1),
      batchId: "batch_3",
    },
  ].map((t) => ({
    ...t,
    requestedDueDate: null,
    extensionReason: null,
    reminderSentFor: null,
    createdAt: stamp(-10),
    updatedAt: stamp(-1),
  }));

/* -------------------------------------------------------------------------- */
/* Shift rota                                                                 */
/* -------------------------------------------------------------------------- */

const shiftSeed = (): ShiftEntry[] => {
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const pattern: Record<string, Array<"early" | "late" | "night" | "holiday" | "absent">> = {
    staff_prod_1: ["early", "early", "early", "late", "late", "holiday", "holiday"],
    staff_prod_2: ["late", "late", "early", "early", "early", "holiday", "holiday"],
    staff_prod_3: ["early", "absent", "late", "late", "early", "holiday", "holiday"],
    staff_eng: ["early", "early", "early", "early", "early", "holiday", "holiday"],
    staff_wh: ["early", "early", "late", "early", "early", "holiday", "holiday"],
    staff_qa_1: ["early", "early", "early", "early", "holiday", "holiday", "holiday"],
    staff_qa_2: ["late", "early", "early", "early", "early", "holiday", "holiday"],
  };

  const entries: ShiftEntry[] = [];
  // Two weeks of rota: the current week and the one after.
  for (let week = 0; week < 2; week += 1) {
    Object.entries(pattern).forEach(([staffId, shifts]) => {
      shifts.forEach((shift, dayIndex) => {
        const date = addDays(weekStart, week * 7 + dayIndex);
        entries.push({
          id: `shift_${staffId}_${iso(date)}`,
          staffId,
          date: iso(date),
          shift,
          createdAt: stamp(-14),
          updatedAt: stamp(-14),
        });
      });
    });
  }
  return entries;
};

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

const notificationSeed = (): AppNotification[] => [
  {
    id: "notif_1",
    recipientId: "staff_admin",
    type: "message",
    title: "New message from Aisha Bello",
    body: "Will do — should have an answer by tomorrow.",
    href: "/messages",
    read: false,
    createdAt: stampAt(-1, 14, 5),
    updatedAt: stampAt(-1, 14, 5),
  },
  {
    id: "notif_2",
    recipientId: "staff_admin",
    type: "message",
    title: "New message from Tom Hargreaves",
    body: "Thanks Sam — I'll verify the API lot before we start dispensing.",
    href: "/messages",
    read: false,
    createdAt: stampAt(0, 8, 10),
    updatedAt: stampAt(0, 8, 10),
  },
  {
    id: "notif_3",
    recipientId: "staff_admin",
    type: "batch",
    title: "Batch AW-24121 on QA hold",
    body: "Sodium Chloride 0.9% Nasal Spray — held pending fill-weight investigation.",
    href: "/schedule",
    read: true,
    createdAt: stampAt(-2, 9, 41),
    updatedAt: stampAt(-2, 9, 41),
  },
  {
    id: "notif_4",
    recipientId: "staff_admin",
    type: "task",
    title: "Task assigned: Update SOP-114 cleaning validation",
    body: "Annual review of the cleaning validation SOP is overdue for sign-off.",
    href: "/tasks",
    read: true,
    createdAt: stamp(-10),
    updatedAt: stamp(-10),
  },
  {
    id: "notif_5",
    recipientId: "staff_prod_3",
    type: "task",
    title: "Task assigned: Line 2 changeover cleaning before Tacrolimus run",
    body: "Full clean-down and line clearance between Hydrocortisone and Tacrolimus.",
    href: "/tasks",
    read: true,
    createdAt: stamp(-10),
    updatedAt: stamp(-10),
  },
];

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

const departmentSeed = (): DepartmentRecord[] =>
  DEFAULT_DEPARTMENTS.map((name, i) => ({
    id: `dept_${i}`,
    name,
    createdAt: stamp(-120),
    updatedAt: stamp(-120),
  }));

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export const staffCollection = createCollection<StaffMember>("staff", staffSeed, { provisionalSeed: true });
export const departmentCollection = createCollection<DepartmentRecord>("departments", departmentSeed, {
  provisionalSeed: true,
});
export const batchCollection = createCollection<Batch>("batches", batchSeed);
export const taskCollection = createCollection<Task>("tasks", taskSeed);
export const shiftCollection = createCollection<ShiftEntry>("shifts", shiftSeed);
export const notificationCollection = createCollection<AppNotification>("notifications", notificationSeed);
