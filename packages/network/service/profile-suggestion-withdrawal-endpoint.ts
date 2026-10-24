import { privateJson as json } from "../../platform/src/response.ts";
import { createHash } from "node:crypto";
import { readCapped } from "../../platform/src/body.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { PROFILE_REVIEW_WITHDRAWAL_PATH, parseProfileReviewWithdrawalRequest, parseProfileReviewWithdrawalProof,
  type ProfileReviewWithdrawalRequest, type ProfileReviewWithdrawalProof } from "../../core/src/svc/profile-review-withdrawal.ts";
import { cleanupCounts, type ConnectionCleanupCounts, type SuggestionOwner } from "./profile-suggestions.ts";

/** Must verify canonical signed Cloud owner-withdrawal receipt, independent of OAuth state. */
export type SuggestionWithdrawalOwnerResolver = (request: ProfileReviewWithdrawalRequest, requestSha256: string) => Promise<ProfileReviewWithdrawalProof | null>;
export type { ConnectionCleanupCounts } from "./profile-suggestions.ts";
export interface ProfileSuggestionWithdrawalDeps {
  secret: string; now: () => number; valid: () => boolean;
  /** Mandatory fresh signed Cloud proof of durable canonical owner withdrawal command/event.
   * Payload {request,requestSha256}; proof message identifiers must join stored Network inbound body.
   * No provider OAuth state or active source-read grant is asserted or required. */
  resolveWithdrawalOwner: (request: ProfileReviewWithdrawalRequest, requestSha256: string) => Promise<unknown | null>;
  /** Mandatory storage adapter: ONE transaction rechecks current person/member/app/owner join,
   * proof expiry and durable owner-withdrawal event/message ownership; consumes nonce+request hash atomically with mutation.
   * withdraw keeps all accepted facts and removes pending only; delete removes all connection-linked suggestions/facts regardless
   * of retention; readback returns counts only. No call to active source authorization is allowed.
   * Never affect batches created AFTER proof.cutoffAt, including reconnect/replay; apply cutoff
   * in every suggestion/fact mutation and count readback. Recheck fence immediately before commit.
   * Return null on replay or any join/authority drift. */
  applyOwnerWithdrawal: (owner: SuggestionOwner, request: ProfileReviewWithdrawalRequest,
    proof: ProfileReviewWithdrawalProof, fence: () => boolean) => Promise<ConnectionCleanupCounts | null>;
}
/** Signed owner-withdrawal wire uses canonical recorded command authority; omission of either mandatory resolver fails closed. */
export async function profileSuggestionWithdrawalEndpoint(req: Request, d: ProfileSuggestionWithdrawalDeps): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== PROFILE_REVIEW_WITHDRAWAL_PATH || url.search) return json({ error: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!d || typeof d.secret !== "string" || d.secret.length < 32 || typeof d.now !== "function"
    || typeof d.valid !== "function" || typeof d.resolveWithdrawalOwner !== "function" || typeof d.applyOwnerWithdrawal !== "function")
    return json({ error: "cleanup_unavailable" }, 503);
  try {
    const bytes = await readCapped(req, 4096);
    if (bytes === "too_large") return json({ error: "too_large" }, 413);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const at = d.now();
    if (!Number.isSafeInteger(at) || !d.valid()) return json({ error: "cleanup_unavailable" }, 503);
    const signature = await svcVerify(d.secret, { method: "POST", path: PROFILE_REVIEW_WITHDRAWAL_PATH,
      headers: req.headers, body, nowS: Math.floor(at / 1000) });
    if (!signature.ok) return json({ error: "unauthorized" }, 401);
    const request = parseProfileReviewWithdrawalRequest(JSON.parse(body));
    if (!request || signature.id !== `learning-withdrawal:${request.requestNonce}`) return json({ error: "invalid_request" }, 400);
    const hash = createHash("sha256").update(body).digest("hex");
    const current = () => { const now = d.now(); return d.valid() && Number.isSafeInteger(now) && now >= at; };
    if (!current()) return json({ error: "cleanup_denied" }, 403);
    const resolved = await d.resolveWithdrawalOwner(request, hash);
    if (!current()) return json({ error: "cleanup_denied" }, 403);
    const proof = parseProfileReviewWithdrawalProof(resolved, request, hash, d.now());
    if (!proof) return json({ error: "cleanup_denied" }, 403);
    const fence = () => { const now = d.now(); return d.valid() && Number.isSafeInteger(now) && now >= at && now >= proof.issuedAt && now < proof.expiresAt; };
    if (!fence()) return json({ error: "cleanup_denied" }, 403);
    const counts = await d.applyOwnerWithdrawal({ userId: proof.userId, organizationId: proof.organizationId,
      personId: proof.personId, app: proof.app, chatId: proof.chatId }, request, proof, fence);
    if (!counts || !fence()) return json({ error: "cleanup_denied" }, 403);
    const result = cleanupCounts(counts);
    if (!result) return json({ error: "cleanup_unavailable" }, 503);
    // Explicit allowlist: no connection details, source content, profile text or proof crosses back.
    return json({ kind: "owner_withdrawal", operation: request.operation,
      counts: result });
  } catch { return json({ error: "cleanup_unavailable" }, 503); }
}
