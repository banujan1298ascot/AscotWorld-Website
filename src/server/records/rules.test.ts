import { describe, expect, it } from "vitest";
import { canRead, canWrite, checkRecord, COLLECTIONS, MAX_RECORD_BYTES, ruleFor } from "./rules";

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
