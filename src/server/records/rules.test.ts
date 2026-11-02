import { describe, expect, it } from "vitest";
import { canRead, canWrite, checkRecord, checkStaffChange, COLLECTIONS, MAX_RECORD_BYTES, ruleFor } from "./rules";

const admin = { id: "staff_admin", role: "admin" as const };
const operator = { id: "staff_prod_1", role: "production" as const };
const viewer = { id: "staff_viewer", role: "viewer" as const };

describe("ruleFor", () => {
  it("knows the shared collections and nothing else", () => {
    expect(ruleFor("tasks")).toBe(COLLECTIONS.tasks);
    expect(ruleFor("session")).toBeNull();
    expect(ruleFor("toString")).toBeNull();
  });
});

describe("canRead", () => {
  it("lets anyone read the staff list — sign-in needs it", () => {
    expect(canRead(COLLECTIONS.staff, null).ok).toBe(true);
  });

  it("needs a signed-in caller for everything else", () => {
    expect(canRead(COLLECTIONS.tasks, null)).toMatchObject({ ok: false, status: 401 });
    expect(canRead(COLLECTIONS.tasks, viewer).ok).toBe(true);
  });
});

describe("canWrite — capability-gated collections", () => {
  it("follows the role's capabilities", () => {
    expect(canWrite(COLLECTIONS.tasks, operator, null, { id: "t1" }).ok).toBe(true);
    expect(canWrite(COLLECTIONS.tasks, viewer, null, { id: "t1" })).toMatchObject({ ok: false, status: 403 });
    expect(canWrite(COLLECTIONS.shifts, operator, null, { id: "s1" }).ok).toBe(false);
    expect(canWrite(COLLECTIONS.shifts, admin, null, { id: "s1" }).ok).toBe(true);
  });

  it("only lets team managers change the staff list", () => {
    expect(canWrite(COLLECTIONS.staff, operator, { id: "x" }, { id: "x", role: "admin" }).ok).toBe(false);
    expect(canWrite(COLLECTIONS.staff, admin, { id: "x" }, { id: "x", role: "admin" }).ok).toBe(true);
  });

  it("refuses anonymous writes", () => {
    expect(canWrite(COLLECTIONS.tasks, null, null, { id: "t1" })).toMatchObject({ ok: false, status: 401 });
  });
});

describe("canWrite — notifications", () => {
  const rule = COLLECTIONS.notifications;
  const mine = { id: "n1", recipientId: operator.id, read: false };

  it("lets anyone signed in send one to someone else", () => {
    expect(canWrite(rule, viewer, null, mine).ok).toBe(true);
  });

  it("lets only the recipient mark it read or delete it", () => {
    expect(canWrite(rule, operator, mine, { ...mine, read: true }).ok).toBe(true);
    expect(canWrite(rule, admin, mine, { ...mine, read: true })).toMatchObject({ ok: false, status: 403 });
    expect(canWrite(rule, operator, mine, null).ok).toBe(true);
    expect(canWrite(rule, admin, mine, null).ok).toBe(false);
  });

  it("can't be handed to someone else", () => {
    expect(canWrite(rule, operator, mine, { ...mine, recipientId: admin.id }).ok).toBe(false);
  });

  it("must name a recipient", () => {
    expect(canWrite(rule, operator, null, { id: "n2" })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("checkRecord", () => {
  it("needs an object carrying the id it's stored under", () => {
    expect(checkRecord("a", { id: "a" }).ok).toBe(true);
    expect(checkRecord("a", { id: "b" }).ok).toBe(false);
    expect(checkRecord("a", [{ id: "a" }]).ok).toBe(false);
    expect(checkRecord("a", null).ok).toBe(false);
  });

  it("refuses an oversized record", () => {
    expect(checkRecord("a", { id: "a", blob: "x".repeat(MAX_RECORD_BYTES) })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("checkStaffChange", () => {
  const manager = { id: "staff_qa", role: "qa" as const, access: { grant: ["team.manage" as const] } };
  const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, email: `${id}@x.test`, ...extra });
  const team = [person("staff_admin", "admin"), person("staff_prod_1", "production"), person("staff_qa", "qa")];
  const others = (id: string) => team.filter((s) => s.id !== id);

  it("lets a manager change someone's details, role and access", () => {
    const before = person("staff_prod_1", "production");
    const after = { ...before, phone: "0123", role: "qa", access: { grant: ["batch.release"] } };
    expect(checkStaffChange(manager, before, after, others("staff_prod_1")).ok).toBe(true);
  });

  it("stops people changing their own role or access, or removing themselves", () => {
    const me = person("staff_qa", "qa");
    expect(checkStaffChange(manager, me, { ...me, phone: "0123" }, others("staff_qa")).ok).toBe(true);
    expect(checkStaffChange(manager, me, { ...me, role: "admin" }, others("staff_qa")).ok).toBe(false);
    expect(checkStaffChange(manager, me, { ...me, access: { grant: ["batch.delete"] } }, others("staff_qa")).ok).toBe(false);
    expect(checkStaffChange(manager, me, null, others("staff_qa")).ok).toBe(false);
  });

  it("keeps admin accounts, the admin role and user management for admins to give", () => {
    const op = person("staff_prod_1", "production");
    const theAdmin = person("staff_admin", "admin");
    expect(checkStaffChange(manager, theAdmin, { ...theAdmin, phone: "1" }, others("staff_admin")).ok).toBe(false);
    expect(checkStaffChange(manager, theAdmin, null, others("staff_admin")).ok).toBe(false);
    expect(checkStaffChange(manager, op, { ...op, role: "admin" }, others("staff_prod_1")).ok).toBe(false);
    expect(checkStaffChange(manager, op, { ...op, access: { grant: ["team.manage"] } }, others("staff_prod_1")).ok).toBe(false);
    expect(checkStaffChange(admin, op, { ...op, access: { grant: ["team.manage"] } }, others("staff_prod_1")).ok).toBe(true);
    expect(checkStaffChange(admin, op, { ...op, role: "admin" }, others("staff_prod_1")).ok).toBe(true);
  });

  it("always leaves an admin", () => {
    const second = person("staff_admin_2", "admin");
    const alone = [person("staff_prod_1", "production")];
    expect(checkStaffChange(admin, second, null, alone).ok).toBe(false);
    expect(checkStaffChange(admin, second, { ...second, role: "qa" }, alone).ok).toBe(false);
    expect(checkStaffChange(admin, second, null, [...alone, person("staff_admin", "admin")]).ok).toBe(true);
  });

  it("refuses an email someone else already uses", () => {
    const op = person("staff_prod_1", "production");
    expect(checkStaffChange(admin, op, { ...op, email: "STAFF_QA@x.test " }, others("staff_prod_1")).ok).toBe(false);
  });
});
