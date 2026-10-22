import { privateJson as json } from "../../platform/src/response.ts";
import { createHash } from "node:crypto";
import { readCapped } from "../../platform/src/body.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH, parseProfileReviewDisconnectRequest, parseProfileReviewDisconnectProof,
  type ProfileReviewDisconnectRequest, type ProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import { cleanupCounts, type ConnectionCleanupCounts, type SuggestionOwner } from "./profile-suggestions.ts";

/** Must verify the dedicated signed Cloud revoked-owner response, independent of source-read consent. */
export type SuggestionRevokedOwnerResolver = (request: ProfileReviewDisconnectRequest, requestSha256: string) => Promise<ProfileReviewDisconnectProof | null>;
export type { ConnectionCleanupCounts } from "./profile-suggestions.ts";
export interface ProfileSuggestionDisconnectDeps {
  secret: string; now: () => number; valid: () => boolean;
  /** Mandatory: fresh signed Cloud response, canonical owner/membership and actual revoked event.
   * No active OAuth grant/source-read proof, cached identity, or model arguments may supply authority.
   * Canonical actual revocation event must supply immutable revokedAt and owner/source join.
   * Explicit operation authority is required: delete is NEVER inferred from disconnect/retention.
   * Callback payload is exactly {request,requestSha256}; digest preserves original raw cleanup body.
   * Return null if owner, membership, connection ownership or event/operation binding is unavailable. */
  resolveRevokedOwner: (request: ProfileReviewDisconnectRequest, requestSha256: string) => Promise<unknown | null>;
  /** Mandatory storage adapter: ONE transaction rechecks current person/member/app/owner join,
   * proof expiry and revoked-event ownership; consumes nonce+request hash atomically with mutation.
   * disconnect honors retention; delete removes all connection-linked suggestions/facts regardless
   * of retention; readback returns counts only. No call to active source authorization is allowed.
   * Never affect batches created AFTER proof.revokedAt, including reconnect/replay; apply cutoff
   * in every suggestion/fact mutation and count readback. Recheck fence immediately before commit.
   * Return null on replay or any join/authority drift. */
  applyRevokedConnection: (owner: SuggestionOwner, request: ProfileReviewDisconnectRequest,
    proof: ProfileReviewDisconnectProof, fence: () => boolean) => Promise<ConnectionCleanupCounts | null>;
}
/** Signed cleanup wire works after revocation; omission of either mandatory resolver fails closed. */
export async function profileSuggestionDisconnectEndpoint(req: Request, d: ProfileSuggestionDisconnectDeps): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== PROFILE_REVIEW_DISCONNECT_PATH || url.search) return json({ error: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!d || typeof d.secret !== "string" || d.secret.length < 32 || typeof d.now !== "function"
    || typeof d.valid !== "function" || typeof d.resolveRevokedOwner !== "function" || typeof d.applyRevokedConnection !== "function")
    return json({ error: "cleanup_unavailable" }, 503);
  try {
    const bytes = await readCapped(req, 4096);
    if (bytes === "too_large") return json({ error: "too_large" }, 413);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const at = d.now();
    if (!Number.isSafeInteger(at) || !d.valid()) return json({ error: "cleanup_unavailable" }, 503);
    const signature = await svcVerify(d.secret, { method: "POST", path: PROFILE_REVIEW_DISCONNECT_PATH,
      headers: req.headers, body, nowS: Math.floor(at / 1000) });
    if (!signature.ok) return json({ error: "unauthorized" }, 401);
    const request = parseProfileReviewDisconnectRequest(JSON.parse(body));
    if (!request || signature.id !== `connection-cleanup:${request.requestNonce}`) return json({ error: "invalid_request" }, 400);
    const hash = createHash("sha256").update(body).digest("hex");
    const current = () => { const now = d.now(); return d.valid() && Number.isSafeInteger(now) && now >= at; };
    if (!current()) return json({ error: "cleanup_denied" }, 403);
    const resolved = await d.resolveRevokedOwner(request, hash);
    if (!current()) return json({ error: "cleanup_denied" }, 403);
    const proof = parseProfileReviewDisconnectProof(resolved, request, hash, d.now());
    if (!proof) return json({ error: "cleanup_denied" }, 403);
    const fence = () => { const now = d.now(); return d.valid() && Number.isSafeInteger(now) && now >= at && now >= proof.issuedAt && now < proof.expiresAt; };
    if (!fence()) return json({ error: "cleanup_denied" }, 403);
    const counts = await d.applyRevokedConnection({ userId: proof.userId, organizationId: proof.organizationId,
      personId: proof.personId, app: proof.app, chatId: proof.chatId }, request, proof, fence);
    if (!counts || !fence()) return json({ error: "cleanup_denied" }, 403);
    const result = cleanupCounts(counts);
    if (!result) return json({ error: "cleanup_unavailable" }, 503);
    // Explicit allowlist: no connection details, source content, profile text or proof crosses back.
    return json({ kind: "connection_cleanup", operation: request.operation,
      counts: result });
  } catch { return json({ error: "cleanup_unavailable" }, 503); }
}
