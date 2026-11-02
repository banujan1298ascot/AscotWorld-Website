import { describe, expect, it } from "vitest";
import { accessFor, cleanAccess, sectionOpen, staffCan } from "./access";
import type { Capability } from "./types";

describe("staffCan", () => {
  it("starts from the role, then adds and takes away per person", () => {
    expect(staffCan({ role: "production" }, "mes.claim")).toBe(true);
    expect(staffCan({ role: "production" }, "batch.release")).toBe(false);
    expect(staffCan({ role: "production", access: { grant: ["batch.release"] } }, "batch.release")).toBe(true);
    expect(staffCan({ role: "production", access: { revoke: ["mes.claim"] } }, "mes.claim")).toBe(false);
    // Taking away wins if both somehow say so.
    expect(staffCan({ role: "viewer", access: { grant: ["task.create"], revoke: ["task.create"] } }, "task.create")).toBe(false);
  });
});

describe("sectionOpen", () => {
  it("opens or hides a section for one person", () => {
    expect(sectionOpen({ role: "production" }, "reports", false)).toBe(false);
    expect(sectionOpen({ role: "production", access: { showSections: ["reports"] } }, "reports", false)).toBe(true);
    expect(sectionOpen({ role: "admin", access: { hideSections: ["tasks"] } }, "tasks", true)).toBe(false);
  });
});

describe("accessFor", () => {
  const sections = ["tasks", "reports"];
  const roleOpens = (id: string) => id === "tasks";

  it("stores only the differences from the role", () => {
    const can = new Set<Capability>(["task.updateOwn", "mes.claim", "mes.pass", "batch.updateProgress", "batchbook.create", "batchbook.editOwnDraft", "batchbook.confirm", "batch.release"]);
    expect(accessFor("production", can, new Set(["tasks", "reports"]), roleOpens, sections)).toEqual({
      grant: ["batch.release"],
      showSections: ["reports"],
    });
  });

  it("is null when it's just the role's defaults", () => {
    const can = new Set<Capability>(["task.updateOwn", "mes.claim", "mes.pass", "batch.updateProgress", "batchbook.create", "batchbook.editOwnDraft", "batchbook.confirm"]);
    expect(accessFor("production", can, new Set(["tasks"]), roleOpens, sections)).toBeNull();
  });
});

describe("cleanAccess", () => {
  it("keeps only known abilities and sensible section ids", () => {
    expect(
      cleanAccess({ grant: ["mes.claim", "do.anything", 4, "mes.claim"], hideSections: ["tasks", "<script>"], extra: true }),
    ).toEqual({ grant: ["mes.claim"], hideSections: ["tasks"] });
    expect(cleanAccess({ grant: [] })).toBeNull();
    expect(cleanAccess("admin")).toBeNull();
  });
});
