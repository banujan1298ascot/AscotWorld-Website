import { describe, expect, it } from "vitest";
import { canActOnTransition, canClaim, canFail, canForward, canSendBack } from "./validation";

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
    expect(verdict).toEqual({ ok: false, error: "You haven't claimed a batch at this stage." });
  });

  it("refuses a transition that's already closed", () => {
    const transition = { operatorId: prodStaff.id, completedAt: new Date().toISOString() };
    expect(canActOnTransition(prodStaff, transition).ok).toBe(false);
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
