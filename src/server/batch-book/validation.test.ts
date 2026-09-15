import { describe, expect, it } from "vitest";
import { canConfirmBatch, canCreateDraft, canEditBatch, canEditFields } from "./validation";

const draftByProd1 = { status: "DRAFT" as const, createdBy: "staff_prod_1" };
const confirmedByProd1 = { status: "CONFIRMED" as const, createdBy: "staff_prod_1" };

describe("canCreateDraft", () => {
  it("allows production, qa and admin", () => {
    expect(canCreateDraft({ id: "x", role: "production" }).ok).toBe(true);
    expect(canCreateDraft({ id: "x", role: "qa" }).ok).toBe(true);
    expect(canCreateDraft({ id: "x", role: "admin" }).ok).toBe(true);
  });

  it("refuses viewer", () => {
    const verdict = canCreateDraft({ id: "x", role: "viewer" });
    expect(verdict.ok).toBe(false);
  });
});

describe("canEditBatch — drafts", () => {
  it("lets the creator edit their own draft", () => {
    expect(canEditBatch({ id: "staff_prod_1", role: "production" }, draftByProd1, null).ok).toBe(true);
  });

  it("refuses another production operator editing someone else's draft", () => {
    const verdict = canEditBatch({ id: "staff_prod_2", role: "production" }, draftByProd1, null);
    expect(verdict).toEqual({ ok: false, error: "You can only edit your own drafts." });
  });

  it("lets admin edit anyone's draft", () => {
    expect(canEditBatch({ id: "staff_admin", role: "admin" }, draftByProd1, null).ok).toBe(true);
  });

  it("does not require a reason for a draft edit", () => {
    expect(canEditBatch({ id: "staff_prod_1", role: "production" }, draftByProd1, undefined).ok).toBe(true);
  });
});

describe("canEditBatch — confirmed records", () => {
  it("refuses production even on their own record", () => {
    const verdict = canEditBatch({ id: "staff_prod_1", role: "production" }, confirmedByProd1, "correction");
    expect(verdict).toEqual({ ok: false, error: "Your role cannot edit a confirmed batch record." });
  });

  it("lets qa edit with a reason", () => {
    expect(canEditBatch({ id: "staff_qa_1", role: "qa" }, confirmedByProd1, "fixing a typo").ok).toBe(true);
  });

  it("refuses qa without a reason", () => {
    const verdict = canEditBatch({ id: "staff_qa_1", role: "qa" }, confirmedByProd1, "");
    expect(verdict).toEqual({ ok: false, error: "A reason is required to edit a confirmed batch record." });
  });

  it("refuses a whitespace-only reason", () => {
    const verdict = canEditBatch({ id: "staff_qa_1", role: "qa" }, confirmedByProd1, "   ");
    expect(verdict.ok).toBe(false);
  });
});

describe("canEditFields", () => {
  it("allows any field while still a draft", () => {
    expect(canEditFields(draftByProd1, ["batchType", "departmentId", "quantity"]).ok).toBe(true);
  });

  it("blocks identity/numbering fields once confirmed", () => {
    const verdict = canEditFields(confirmedByProd1, ["batchType", "quantity"]);
    expect(verdict).toEqual({ ok: false, error: "These fields are immutable once confirmed: batchType." });
  });

  it("allows descriptive fields once confirmed", () => {
    expect(canEditFields(confirmedByProd1, ["productName", "quantity", "plannedManufactureDate"]).ok).toBe(true);
  });
});

describe("canConfirmBatch", () => {
  it("lets the creator confirm their own draft", () => {
    expect(canConfirmBatch({ id: "staff_prod_1", role: "production" }, draftByProd1).ok).toBe(true);
  });

  it("refuses confirming someone else's draft", () => {
    const verdict = canConfirmBatch({ id: "staff_prod_2", role: "production" }, draftByProd1);
    expect(verdict).toEqual({ ok: false, error: "You can only confirm your own drafts." });
  });

  it("refuses confirming a record that is already confirmed", () => {
    const verdict = canConfirmBatch({ id: "staff_prod_1", role: "production" }, confirmedByProd1);
    expect(verdict).toEqual({ ok: false, error: "Only a draft can be confirmed." });
  });

  it("refuses viewer even on their own draft", () => {
    const ownDraft = { status: "DRAFT" as const, createdBy: "staff_viewer" };
    const verdict = canConfirmBatch({ id: "staff_viewer", role: "viewer" }, ownDraft);
    expect(verdict.ok).toBe(false);
  });
});
