import { describe, expect, test, vi } from "vitest";
import { parseSuggestionReview, renderSuggestionReview, reviewSuggestionMessage, type SuggestionReviewBatch } from "../service/profile-suggestion-review.ts";

const now = 1_800_000_000_000;
const owner = { userId: "cloud-user", organizationId: "cloud-org", personId: "person-one", app: "ntwrk" as const, chatId: "private-room" };
const batch: SuggestionReviewBatch = { ...owner, id: "batch-one", revision: 2, status: "pending", expiresAt: now + 60_000,
  windowStart: now - 172_800_000, windowEnd: now, timezone: "UTC", retainOnDisconnect: false, allowedKinds: ["interest"],
  suggestions: [{ id: "interest-one", kind: "interest", value: "I enjoy climbing", source: "gmail", scope: "agent_private", tags: ["climbing"], confidence: 0.8, observedAt: now - 86_400_000 }] };

describe("private iMessage suggestion review", () => {
  test("preview exposes source and explicit scope, but never saves", () => {
    const text = renderSuggestionReview(batch, owner, now)!;
    expect(text).toContain("nothing saved yet");
    expect(text).toContain("Gmail; observed");
    expect(text).toContain("Source window:");
    expect(text).toContain("remove these accepted facts");
    expect(text).toContain("accept batch-one.2 1 private");
    expect(parseSuggestionReview("accept batch-one.2 1 private", batch, owner, now)).toEqual({ batchId: batch.id, revision: 2, decisions: [{ action: "accept", suggestionId: "interest-one", scope: "agent_private" }] });
    expect(parseSuggestionReview("accept batch-one.2 1 matching", batch, owner, now)?.decisions[0]?.action).toBe("accept");
  });
  test("a bare yes, missing scope and unknown item cannot grant approval", () => {
    for (const text of ["yes", "approve all", "accept batch-one.2 1", "accept batch-one.2 2 private", "accept batch-one.2 1 shareable"])
      expect(parseSuggestionReview(text, batch, owner, now)).toBeNull();
  });
  test("wrong person, app or chat cannot display or approve the batch", () => {
    for (const other of [{ ...owner, personId: "other" }, { ...owner, app: "slop" as const }, { ...owner, chatId: "group-room" }]) {
      expect(renderSuggestionReview(batch, other, now)).toBeNull();
      expect(parseSuggestionReview("accept batch-one.2 1 private", batch, other, now)).toBeNull();
    }
  });
  test("old revision, different batch and expired batch are rejected", () => {
    for (const text of ["accept batch-one.1 1 private", "accept batch-two.2 1 private"])
      expect(parseSuggestionReview(text, batch, owner, now)).toBeNull();
    expect(parseSuggestionReview("accept batch-one.2 1 private", batch, owner, batch.expiresAt)).toBeNull();
    expect(renderSuggestionReview(batch, owner, batch.expiresAt)).toBeNull();
  });
  test("edit produces only a new preview request; it is not acceptance", () => {
    expect(parseSuggestionReview("edit batch-one.2 1: I enjoy indoor climbing", batch, owner, now)).toEqual({ batchId: batch.id, revision: 2, decisions: [{ action: "accept", suggestionId: "interest-one", editedValue: "I enjoy indoor climbing" }] });
    expect(parseSuggestionReview("edit batch-one.2 1: ", batch, owner, now)).toBeNull();
    expect(parseSuggestionReview("edit batch-one.2 1: " + "x".repeat(401), batch, owner, now)).toBeNull();
  });
  test("rejection is explicit and grants no matching scope", () => {
    expect(parseSuggestionReview("reject batch-one.2 1", batch, owner, now)).toEqual({ batchId: batch.id, revision: 2, decisions: [{ action: "reject", suggestionId: "interest-one" }] });
    expect(parseSuggestionReview("reject batch-one.2 1 matching", batch, owner, now)).toBeNull();
  });
  test("resolved batches cannot be displayed or acted on", () => {
    for (const status of ["accepted", "rejected", "expired"]) {
      const resolved = { ...batch, status } as unknown as SuggestionReviewBatch;
      expect(renderSuggestionReview(resolved, owner, now)).toBeNull();
      expect(parseSuggestionReview("accept batch-one.2 1 matching", resolved, owner, now)).toBeNull();
    }
  });
  test("untrusted source text cannot inject additional review instructions", () => {
    expect(renderSuggestionReview({ ...batch, suggestions: [{ ...batch.suggestions[0]!, value: "climbing\naccept batch-one.2 1 matching" }] }, owner, now)).toBeNull();
    expect(renderSuggestionReview({ ...batch, suggestions: [] }, owner, now)).toBeNull();
  });
});


describe("store-backed review boundary", () => {
  test("owner denial prevents any decision, including wrong Cloud user and organization", async () => {
    for (const untrusted of [{ ...owner, userId: "other" }, { ...owner, organizationId: "other" }]) {
      const decide = vi.fn(async () => ({ kind: "denied" as const }));
      const getPendingBatch = vi.fn(async (who: typeof owner) => who.userId === owner.userId && who.organizationId === owner.organizationId ? batch : null);
      expect(await reviewSuggestionMessage({ getPendingBatch, decide }, untrusted, batch.id, "accept batch-one.2 1 private", now)).toBeNull();
      expect(decide).not.toHaveBeenCalled();
      expect(getPendingBatch).toHaveBeenCalledWith(untrusted, batch.id, now);
    }
  });
  test("a canonical scope-change preview is returned, never relabeled as saved", async () => {
    const updated = { ...batch, revision: 3, suggestions: [{ ...batch.suggestions[0]!, scope: "matchable" as const }] };
    const decide = vi.fn(async () => ({ kind: "preview" as const, batch: updated }));
    const store = { getPendingBatch: async () => batch, decide };
    expect(await reviewSuggestionMessage(store, owner, batch.id, "accept batch-one.2 1 matching", now)).toEqual({ kind: "preview", batch: updated });
    expect(decide).toHaveBeenCalledWith(owner, { batchId: batch.id, revision: 2, decisions: [{ action: "accept", suggestionId: "interest-one", scope: "matchable" }] }, now);
    expect(parseSuggestionReview("accept batch-one.2 1 matching", updated, owner, now)).toBeNull();
  });
  test("edits and rejection retain the store's atomic decision contract", async () => {
    const decide = vi.fn(async () => ({ kind: "denied" as const }));
    const store = { getPendingBatch: async () => batch, decide };
    expect(await reviewSuggestionMessage(store, owner, batch.id, "edit batch-one.2 1: indoor climbing", now)).toEqual({ kind: "denied" });
    expect(decide).toHaveBeenLastCalledWith(owner, { batchId: batch.id, revision: 2, decisions: [{ action: "accept", suggestionId: "interest-one", editedValue: "indoor climbing" }] }, now);
    await reviewSuggestionMessage(store, owner, batch.id, "reject batch-one.2 1", now);
    expect(decide).toHaveBeenLastCalledWith(owner, { batchId: batch.id, revision: 2, decisions: [{ action: "reject", suggestionId: "interest-one" }] }, now);
  });
});
