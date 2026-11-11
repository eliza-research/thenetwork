import type { ProfileSuggestions, SuggestionOwner, SuggestionReviewBatch, SuggestionDecision, SuggestionReviewClaim } from "./profile-suggestions.ts";

export type { SuggestionReviewBatch } from "./profile-suggestions.ts";
import { currentBatch as currentBatchCore, MAX_SUGGESTION_TEXT } from "./profile-core.ts";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The regular expressions and Number.isSafeInteger stay here; profile-core.ts decides from their results. */
function currentBatch(batch: SuggestionReviewBatch, owner: SuggestionOwner, now: number): boolean {
  return currentBatchCore({
    status: batch.status, personId: batch.personId, app: batch.app, chatId: batch.chatId,
    idOk: SAFE_ID.test(batch.id),
    numbersSafe: Number.isSafeInteger(now) && Number.isSafeInteger(batch.expiresAt) && Number.isSafeInteger(batch.revision),
    expiresAt: batch.expiresAt, revision: batch.revision,
    distinctIds: new Set(batch.suggestions.map(s => s.id)).size,
    suggestions: batch.suggestions.map(s => ({
      idOk: SAFE_ID.test(s.id),
      valueOk: s.value.trim().length > 0 && s.value.length <= MAX_SUGGESTION_TEXT && !/[\r\n\u0000-\u001f\u007f]/.test(s.value),
      // A Calendar event start can be in the future (the store accepts it); a Gmail time cannot (profile-core.ts).
      observedSafe: Number.isSafeInteger(s.observedAt), observedAt: s.observedAt, source: s.source, kind: s.kind,
    })),
  }, { personId: owner.personId, app: owner.app, chatId: owner.chatId }, now);
}

export function renderSuggestionReview(batch: SuggestionReviewBatch, owner: SuggestionOwner, now: number): string | null {
  if (!currentBatch(batch, owner, now)) return null;
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
  if (!currentBatch(batch, owner, now)) return null;
  const match = /^(accept|reject|edit) ([A-Za-z0-9_-]+)\.([1-9][0-9]*) (10|[1-9])(?:(?: (private|matching))|(?:: ([^\r\n]+)))?$/.exec(text.trim());
  if (!match || match[2] !== batch.id || Number(match[3]) !== batch.revision) return null;
  const suggestion = batch.suggestions[Number(match[4]) - 1];
  if (!suggestion) return null;
  const decision = (value: SuggestionDecision) => ({ batchId: batch.id, revision: batch.revision, decisions: [value] });
  if (match[1] === "accept" && match[5] && !match[6]) return decision({ action: "accept", suggestionId: suggestion.id, scope: match[5] === "private" ? "agent_private" : "matchable" });
  if (match[1] === "reject" && !match[5] && !match[6]) return decision({ action: "reject", suggestionId: suggestion.id });
  if (match[1] === "edit" && !match[5] && match[6]) {
    const value = match[6].trim();
    if (value.length > 0 && value.length <= 400 && !/[\u0000-\u001f\u007f]/.test(value)) return decision({ action: "accept", suggestionId: suggestion.id, editedValue: value });
  }
  return null;
}

/** Only this store-backed entry verifies the full user/org binding and applies decisions. */
export async function reviewSuggestionMessage(store: Pick<ProfileSuggestions, "getPendingBatch" | "decide">, owner: SuggestionOwner, batchId: string, text: string, now: number,
  claim?: SuggestionReviewClaim) {
  const batch = await store.getPendingBatch(owner, batchId, now);
  if (!batch) return null;
  const input = parseSuggestionReview(text, batch, owner, now);
  if (!input) return null;
  return claim ? store.decide(owner, input, now, claim) : store.decide(owner, input, now);
}
