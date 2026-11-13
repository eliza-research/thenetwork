import { initial, step as stepReview, type ReviewRequest, type ReviewVerb } from "../../core/src/generated/profileSuggestionReview.ts";
import type { ProfileSuggestions, SuggestionOwner, SuggestionReviewBatch, SuggestionDecision } from "./profile-suggestions.ts";

export type { SuggestionReviewBatch } from "./profile-suggestions.ts";

const REVIEW_VERBS = { accept: "AcceptVerb", reject: "RejectVerb", edit: "EditVerb" } as const satisfies Record<string, ReviewVerb>;

function batchReview(batch: SuggestionReviewBatch, owner: SuggestionOwner, now: number): ReviewRequest | null {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(batch.expiresAt) || !Number.isSafeInteger(batch.revision)) return null;
  const metadata = stepReview(initial, {
    type: "checkBatch",
    pending: batch.status === "pending",
    ownerMatches: batch.personId === owner.personId && batch.app === owner.app && batch.chatId === owner.chatId,
    batchIdValid: /^[A-Za-z0-9_-]{1,64}$/.test(batch.id),
    revision: batch.revision,
    asOf: now,
    expiresAt: batch.expiresAt,
  });
  if (metadata.phase !== "NeedsItems") return null;
  const itemCount = batch.suggestions.length;
  const distinctIds = new Set(batch.suggestions.map(s => s.id)).size === itemCount;
  const allItemsValid = batch.suggestions.every(s => /^[A-Za-z0-9_-]{1,64}$/.test(s.id) && s.value.trim().length > 0 && s.value.length <= 400
      && !/[\r\n\u0000-\u001f\u007f]/.test(s.value) && Number.isSafeInteger(s.observedAt) && s.observedAt <= now
      && ["gmail", "google_calendar"].includes(s.source)
      && ["interest", "goal", "availability_pattern"].includes(s.kind));
  const review = stepReview(metadata, { type: "checkItems", itemCount, distinctIds, allItemsValid });
  return review.phase === "ReadyToReview" ? review : null;
}

export function renderSuggestionReview(batch: SuggestionReviewBatch, owner: SuggestionOwner, now: number): string | null {
  if (!batchReview(batch, owner, now)) return null;
  const token = `${batch.id}.${batch.revision}`;
  return [
    `Suggestions for ${batch.app} — nothing saved yet (${token}).`,
    `Source window: ${new Date(batch.windowStart).toISOString()} to ${new Date(batch.windowEnd).toISOString()} (${batch.timezone}).`,
    `If Google is disconnected: ${batch.retainOnDisconnect ? "keep accepted facts until you delete them" : "remove these accepted facts"}. Pending review expires ${new Date(batch.expiresAt).toISOString()}.`,
    ...batch.suggestions.map((s, i) => `${i + 1}. ${s.value} (${s.source === "gmail" ? "Gmail" : "Calendar"}; observed ${new Date(s.observedAt).toISOString().slice(0, 10)}; ${s.scope === "agent_private" ? "private" : "matching"})`),
    `Accept one: accept ${token} 1 private — or matching. Changing scope shows a new preview first.`,
    `Edit one: edit ${token} 1: your wording. Edits need a new review before acceptance.`,
    `Reject one: reject ${token} 1. Each command applies only to this batch.`,
  ].join("\n");
}

/** Returns intent only. The store must atomically recheck owner, revision, expiry and pending state. */
export function parseSuggestionReview(text: string, batch: SuggestionReviewBatch, owner: SuggestionOwner, now: number):
  | { batchId: string; revision: number; decisions: SuggestionDecision[] }
  | null {
  const review = batchReview(batch, owner, now);
  if (!review) return null;
  const match = /^(accept|reject|edit) ([A-Za-z0-9_-]+)\.([1-9][0-9]*) (10|[1-9])(?:(?: (private|matching))|(?:: ([^\r\n]+)))?$/.exec(text.trim());
  if (!match) return null;
  const verb = REVIEW_VERBS[match[1] as keyof typeof REVIEW_VERBS];
  const suggestion = batch.suggestions[Number(match[4]) - 1];
  const value = match[6]?.trim() ?? "";
  const outcome = stepReview(review, {
    type: "readCommand",
    verb,
    tokenMatches: match[2] === batch.id && Number(match[3]) === batch.revision,
    itemExists: !!suggestion,
    scopeGiven: !!match[5],
    wordingGiven: !!match[6],
    wordingValid: value.length > 0 && value.length <= 400 && !/[\u0000-\u001f\u007f]/.test(value),
  });
  if (!suggestion) return null;
  const decision = (value: SuggestionDecision) => ({ batchId: batch.id, revision: batch.revision, decisions: [value] });
  switch (outcome.phase) {
    case "AcceptItem": return decision({ action: "accept", suggestionId: suggestion.id, scope: match[5] === "private" ? "agent_private" : "matchable" });
    case "RejectItem": return decision({ action: "reject", suggestionId: suggestion.id });
    case "PreviewEdit": return decision({ action: "accept", suggestionId: suggestion.id, editedValue: value });
    default: return null;
  }
}

/** Only this store-backed entry verifies the full user/org binding and applies decisions. */
export async function reviewSuggestionMessage(store: Pick<ProfileSuggestions, "getPendingBatch" | "decide">, owner: SuggestionOwner, batchId: string, text: string, now: number) {
  const batch = await store.getPendingBatch(owner, batchId, now);
  if (!batch) return null;
  const input = parseSuggestionReview(text, batch, owner, now);
  if (!input) return null;
  return store.decide(owner, input, now);
}
