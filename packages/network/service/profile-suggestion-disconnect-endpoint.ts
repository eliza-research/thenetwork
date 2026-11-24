import { createHash } from "node:crypto";
import { readCapped } from "../../platform/src/body.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH, parseProfileReviewDisconnectRequest, parseProfileReviewDisconnectProof,
  type ProfileReviewDisconnectRequest, type ProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import type { SuggestionOwner } from "./profile-suggestions.ts";

export type SuggestionRevokedOwnerResolver = (request: ProfileReviewDisconnectRequest, requestSha256: string) => Promise<ProfileReviewDisconnectProof | null>;
export interface ConnectionCleanupCounts { pending: number; retainedAccepted: number; linkedFacts: number }
export interface ProfileSuggestionDisconnectDeps {
  secret: string; now: () => number; valid: () => boolean;
  resolveRevokedOwner: (request: ProfileReviewDisconnectRequest, requestSha256: string) => Promise<unknown | null>;
  applyRevokedConnection: (owner: SuggestionOwner, request: ProfileReviewDisconnectRequest,
    proof: ProfileReviewDisconnectProof, fence: () => boolean) => Promise<ConnectionCleanupCounts | null>;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store" } });
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
    const numbers = [counts.pending, counts.retainedAccepted, counts.linkedFacts];
    if (numbers.some(n => !Number.isSafeInteger(n) || n < 0)) return json({ error: "cleanup_unavailable" }, 503);
    return json({ kind: "connection_cleanup", operation: request.operation,
      counts: { pending: counts.pending, retainedAccepted: counts.retainedAccepted, linkedFacts: counts.linkedFacts } });
  } catch { return json({ error: "cleanup_unavailable" }, 503); }
}
