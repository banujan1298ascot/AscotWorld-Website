import { describe, expect, it } from "vitest";
import {
  canActOnTransition,
  canClaim,
  canFail,
  canForward,
  canRecordLabels,
  canRunStation,
  canSendBack,
  checkAssignee,
  checkLabelRun,
  checkOperatorRole,
} from "./validation";

describe("canRecordLabels", () => {
  const check2 = { sequenceNumber: 2, name: "Order/Calculation Check", operatorRole: "order_processing" };

  it("lets Station 2's own account record", () => {
    expect(canRecordLabels({ id: "s2", role: "production", mesStage: 2 }, check2).ok).toBe(true);
  });

  it("refuses Station 1 and every other station account", () => {
    for (const mesStage of [1, 3, 4, 5]) {
      expect(canRecordLabels({ id: "s", role: "production", mesStage }, check2).ok).toBe(false);
    }
  });

  it("lets an unpinned Order processing operator record, but not other operators", () => {
    expect(
      canRecordLabels({ id: "op", role: "production", mesStage: null, operatorRole: "order_processing" }, check2).ok,
    ).toBe(true);
    expect(
      canRecordLabels({ id: "op", role: "production", mesStage: null, operatorRole: "dispensary" }, check2).ok,
    ).toBe(false);
  });

  it("refuses a viewer, and anything recorded away from Check 2", () => {
    expect(canRecordLabels({ id: "v", role: "viewer", operatorRole: "order_processing" }, check2).ok).toBe(false);
    expect(
      canRecordLabels({ id: "a", role: "admin" }, { sequenceNumber: 3, name: "Dispensary", operatorRole: null }).ok,
    ).toBe(false);
  });
});

describe("checkLabelRun", () => {
  it("needs a whole number above zero", () => {
    for (const quantity of [0, -5, 2.5, "500", null]) {
      expect(checkLabelRun({ kind: "FIRST_PRINT", quantity }, { labelsPrinted: null }).ok).toBe(false);
    }
    expect(checkLabelRun({ kind: "FIRST_PRINT", quantity: 500 }, { labelsPrinted: null }).ok).toBe(true);
  });

  it("needs a first print before any reprint", () => {
    expect(checkLabelRun({ kind: "REPRINT", quantity: 20 }, { labelsPrinted: null }).ok).toBe(false);
    expect(checkLabelRun({ kind: "REPRINT", quantity: 20 }, { labelsPrinted: 500 }).ok).toBe(true);
  });

  it("needs a reason to correct a first print already recorded", () => {
    expect(checkLabelRun({ kind: "FIRST_PRINT", quantity: 480 }, { labelsPrinted: 500 }).ok).toBe(false);
    expect(
      checkLabelRun({ kind: "FIRST_PRINT", quantity: 480, reason: "Miscounted" }, { labelsPrinted: 500 }).ok,
    ).toBe(true);
  });
});

const prodStaff = { id: "staff_prod_1", role: "production" as const };
const otherProdStaff = { id: "staff_prod_2", role: "production" as const };
const viewerStaff = { id: "staff_viewer", role: "viewer" as const };

describe("canClaim", () => {
  it("allows production/qa/admin", () => {
    expect(canClaim(prodStaff).ok).toBe(true);
    expect(canClaim({ id: "x", role: "qa" }).ok).toBe(true);
    expect(canClaim({ id: "x", role: "admin" }).ok).toBe(true);
  });

  it("refuses viewer", () => {
    expect(canClaim(viewerStaff).ok).toBe(false);
  });
});

describe("canActOnTransition", () => {
  it("allows the claimant on their own open transition", () => {
    const transition = { operatorId: prodStaff.id, completedAt: null };
    expect(canActOnTransition(prodStaff, transition).ok).toBe(true);
  });

  it("refuses someone else acting on it", () => {
    const transition = { operatorId: prodStaff.id, completedAt: null };
    const verdict = canActOnTransition(otherProdStaff, transition);
    expect(verdict).toEqual({ ok: false, error: "Only the operator who claimed this batch can act on it." });
  });

  it("refuses when there's no open transition at all", () => {
    const verdict = canActOnTransition(prodStaff, undefined);
    expect(verdict).toEqual({ ok: false, error: "This batch hasn't been started at this stage yet." });
  });

  it("refuses a transition that's already closed", () => {
    const transition = { operatorId: prodStaff.id, completedAt: new Date().toISOString() };
    expect(canActOnTransition(prodStaff, transition).ok).toBe(false);
  });

  it("at a supervised stage, allows someone other than the assignee to act on it", () => {
    // Check 4: the assigned operator works the floor and never opens the
    // app, so the supervisor running the station has to be able to move
    // the batch on regardless of who it's assigned to.
    const transition = { operatorId: prodStaff.id, completedAt: null };
    const verdict = canActOnTransition(otherProdStaff, transition, { supervised: true });
    expect(verdict.ok).toBe(true);
  });

  it("a supervised stage still refuses once the transition is closed", () => {
    const transition = { operatorId: prodStaff.id, completedAt: new Date().toISOString() };
    expect(canActOnTransition(otherProdStaff, transition, { supervised: true }).ok).toBe(false);
  });
});

describe("canForward", () => {
  it("allows production/qa/admin, refuses viewer", () => {
    expect(canForward(prodStaff).ok).toBe(true);
    expect(canForward(viewerStaff).ok).toBe(false);
  });
});

describe("canSendBack", () => {
  it("refuses sending back to Batch Book Entry (stage 2 -> stage 1)", () => {
    const verdict = canSendBack(prodStaff, { sequenceNumber: 2, failAuthority: false }, "some reason");
    expect(verdict).toEqual({
      ok: false,
      error: "Cannot send back to Batch Book Entry — edit the confirmed record from Batch Book instead.",
    });
  });

  it("allows sending back from stage 3 onward with a reason", () => {
    const verdict = canSendBack(prodStaff, { sequenceNumber: 3, failAuthority: false }, "missing lot number");
    expect(verdict.ok).toBe(true);
  });

  it("requires a non-empty reason", () => {
    expect(canSendBack(prodStaff, { sequenceNumber: 4, failAuthority: true }, "").ok).toBe(false);
    expect(canSendBack(prodStaff, { sequenceNumber: 4, failAuthority: true }, "   ").ok).toBe(false);
    expect(canSendBack(prodStaff, { sequenceNumber: 4, failAuthority: true }, undefined).ok).toBe(false);
  });

  it("refuses viewer regardless of stage", () => {
    expect(canSendBack(viewerStaff, { sequenceNumber: 4, failAuthority: true }, "reason").ok).toBe(false);
  });
});

describe("canFail", () => {
  it("allows only at a stage with fail authority", () => {
    expect(canFail(prodStaff, { sequenceNumber: 4, failAuthority: true }, "contamination found").ok).toBe(true);
    const verdict = canFail(prodStaff, { sequenceNumber: 3, failAuthority: false }, "contamination found");
    expect(verdict).toEqual({ ok: false, error: "This stage cannot fail a batch." });
  });

  it("requires a non-empty reason even at a fail-authority stage", () => {
    const verdict = canFail(prodStaff, { sequenceNumber: 6, failAuthority: true }, "");
    expect(verdict).toEqual({ ok: false, error: "A reason is required to fail a batch." });
  });

  it("refuses viewer even at a fail-authority stage", () => {
    expect(canFail(viewerStaff, { sequenceNumber: 6, failAuthority: true }, "reason").ok).toBe(false);
  });
});

describe("canRunStation", () => {
  const check4 = { sequenceNumber: 4, supervised: true };
  const check3 = { sequenceNumber: 3, supervised: false };

  it("lets anyone through at an ordinary station — the usual rules decide", () => {
    expect(canRunStation({ id: "op", role: "production" }, check3).ok).toBe(true);
  });

  it("at a supervised station, allows only its own pinned account and admins", () => {
    expect(canRunStation({ id: "sup", role: "production", mesStage: 4 }, check4).ok).toBe(true);
    expect(canRunStation({ id: "boss", role: "admin" }, check4).ok).toBe(true);
    expect(canRunStation({ id: "op", role: "production" }, check4).ok).toBe(false);
    expect(canRunStation({ id: "other", role: "production", mesStage: 5 }, check4).ok).toBe(false);
  });
});

describe("checkAssignee", () => {
  it("needs a named operator at a supervised station", () => {
    expect(checkAssignee({ supervised: true }, null).ok).toBe(false);
    expect(checkAssignee({ supervised: true }, "staff_eng").ok).toBe(true);
  });

  it("allows a self-claim anywhere else", () => {
    expect(checkAssignee({ supervised: false }, null).ok).toBe(true);
  });
});

describe("checkOperatorRole", () => {
  const dispensary = { name: "Raw Material Picking", operatorRole: "dispensary" };

  it("only lets the station's kind of operator take a batch", () => {
    expect(checkOperatorRole(dispensary, { name: "Marta", operatorRole: "dispensary" }).ok).toBe(true);
    const refused = checkOperatorRole(dispensary, { name: "Daniel", operatorRole: "bespoke_production" });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/Dispensary technicians.*Daniel isn't one/);
    expect(checkOperatorRole(dispensary, { name: "Priya", operatorRole: null }).ok).toBe(false);
  });

  it("lets anyone through where the station has no requirement", () => {
    expect(checkOperatorRole({ name: "Production Check", operatorRole: null }, { name: "X", operatorRole: null }).ok).toBe(true);
  });
});
