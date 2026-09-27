import { describe, expect, it } from "vitest";
import { checkMessageBody, checkNewConversation, isDirectMessage, MAX_MESSAGE_LENGTH } from "./validation";

describe("checkMessageBody", () => {
  it("trims and accepts ordinary text", () => {
    expect(checkMessageBody("  hello  ")).toEqual({ ok: true, value: "hello" });
  });

  it("refuses empty, whitespace-only and non-text bodies", () => {
    expect(checkMessageBody("   ").ok).toBe(false);
    expect(checkMessageBody("").ok).toBe(false);
    expect(checkMessageBody(undefined).ok).toBe(false);
    expect(checkMessageBody(42).ok).toBe(false);
  });

  it("refuses an over-long message", () => {
    expect(checkMessageBody("x".repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
    expect(checkMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
  });
});

describe("checkNewConversation", () => {
  it("always includes the creator, first, and drops duplicates", () => {
    const result = checkNewConversation("me", { participantIds: ["you", "me", "you"], body: "hi" });
    expect(result).toEqual({ ok: true, value: { participantIds: ["me", "you"], title: null, body: "hi" } });
  });

  it("needs at least one other person", () => {
    expect(checkNewConversation("me", { participantIds: ["me"], body: "hi" }).ok).toBe(false);
    expect(checkNewConversation("me", { participantIds: [], body: "hi" }).ok).toBe(false);
    expect(checkNewConversation("me", { body: "hi" }).ok).toBe(false);
  });

  it("refuses malformed participant lists", () => {
    expect(checkNewConversation("me", { participantIds: ["you", 7], body: "hi" }).ok).toBe(false);
    expect(checkNewConversation("me", { participantIds: "you", body: "hi" }).ok).toBe(false);
  });

  it("treats a blank group name as no name", () => {
    const result = checkNewConversation("me", { participantIds: ["a", "b"], title: "   ", body: "hi" });
    expect(result.ok && result.value.title).toBe(null);
  });

  it("needs an opening message", () => {
    expect(checkNewConversation("me", { participantIds: ["you"], body: "  " }).ok).toBe(false);
  });
});

describe("isDirectMessage", () => {
  it("is two people with no group name", () => {
    expect(isDirectMessage({ participantIds: ["me", "you"], title: null, body: "x" })).toBe(true);
    expect(isDirectMessage({ participantIds: ["me", "you"], title: "Shift swap", body: "x" })).toBe(false);
    expect(isDirectMessage({ participantIds: ["me", "you", "them"], title: null, body: "x" })).toBe(false);
  });
});
