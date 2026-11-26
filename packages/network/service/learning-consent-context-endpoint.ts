import { parseNetworkCollectionCommand, hashNetworkCollectionSelection, networkCollectionDeadline } from "../../core/src/svc/learning-collection-command.ts";
import { createHash } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { readCapped } from "../../platform/src/body.ts";
import { ledgerOptedOut } from "./consent-ledger-read.ts";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { LEARNING_CONSENT_CONTEXT_PATH, parseLearningConsentContextRequest, type LearningConsentContextProof, NETWORK_LEARNING_ENTRY_SELECTION_SHA256, learningSelectionMatchesStoredCommand } from "../../core/src/svc/learning-consent-context.ts";
import { routeEnvelopeAllowed, type NetworkRoutePolicy } from "./route-authority.ts";
import { canBeMatched } from "../../core/src/policy.ts";
import { effectiveAgesOf } from "./snapshot.ts";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function learningConsentContextEndpoint(d: { sql: SQL; now: () => number; secret?: string; routePolicy?: NetworkRoutePolicy; reviewEnabled: boolean }, req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!d.reviewEnabled) return json({ error: "identity_unavailable" }, 503);
  if (url.pathname !== LEARNING_CONSENT_CONTEXT_PATH || url.search) return json({ error: "invalid_request" }, 400);
  const bytes = await readCapped(req, 16 * 1024);
  if (bytes === "too_large") return json({ error: "payload_too_large" }, 413);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return json({ error: "invalid_request" }, 400); }
  const now = d.now();
  if (!Number.isSafeInteger(now)) return json({ error: "unavailable" }, 503);
  const auth = await svcVerify(d.secret, { method: "POST", path: LEARNING_CONSENT_CONTEXT_PATH, headers: req.headers, body: raw, nowS: Math.floor(now / 1000) });
  if (!auth.ok) return json({ error: auth.reason }, auth.reason === "no_secret" ? 503 : 401);
  let request;
  try { request = parseLearningConsentContextRequest(JSON.parse(raw)); } catch { request = undefined; }
  if (!request) return json({ error: "invalid_request" }, 400);
  const review = request.review, policy = d.routePolicy;
  const id = `${review.messageId}:learning-consent:${review.requestNonce}`;
  if (auth.id !== id) return json({ error: "invalid_request" }, 400);
  const current = () => Number.isSafeInteger(d.now()) && d.now() >= now && !!policy && d.now() < policy.admitUntil
    && routeEnvelopeAllowed(policy, review.networkAuthority, d.now());
  if (!current()) return json({ error: "turn_scope_invalid" }, 403);
  try {
    return await d.sql.begin(async tx => {
      await tx`select set_config('app.app_id',${review.app},true),
        set_config('app.age_as_of',${new Date(now).toISOString()},true)`;
      // Resolve the canonical person first, then use the normal person/member/turn lock order.
      const [candidate] = await tx`select p.id from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash
        join network.members n on n.person_id=p.id and n.app_id=${review.app} and n.id=${review.memberId}
        where i.id=${`msg:${review.channel}:${review.messageId}`} and p.deleted_at is null`;
      if (!candidate) return json({ error: "turn_scope_invalid" }, 403);
      await tx`select id from platform.people where id=${candidate.id} for share`;
      const [member] = await tx`select n.id from network.members n join platform.people p on p.id=n.person_id
        join platform.memberships m on m.person_id=p.id and m.app_id=n.app_id and m.member_id=n.id
        join platform.matching_ages ages on ages.app_id=n.app_id and ages.member_id=n.id
        where p.id=${candidate.id} and p.deleted_at is null and n.app_id=${review.app} and n.id=${review.memberId}
        and n.account_status='active' and not n.opted_out
        and m.state in ('active','onboarding') and m.review is null
        and not exists(select 1 from platform.bans b where b.person_id=p.id or b.phone_hash=p.phone_hash)
        and not exists(select 1 from platform.suppression s where s.phone_hash=p.phone_hash)
        and not exists(select 1 from platform.phone_identities ph where ph.person_id=p.id and ph.hold is not null)
        for share of n,m`;
      if (!member || !canBeMatched((await effectiveAgesOf(tx, review.app, [review.memberId], now)).get(review.memberId))) return json({ error: "turn_scope_invalid" }, 403);
      const [turn] = await tx`select i.request_hash,i.arrived_at,i.network_authority,i.response,m.body
        from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash and p.id=${candidate.id}
        join network.messages m on m.app_id=${review.app} and m.member_id=${review.memberId} and m.id=${`in:${review.channel}:${review.messageId}`} and m.direction='inbound'
        where i.id=${`msg:${review.channel}:${review.messageId}`} and i.status='done' for share of i,m`;
      const arrivedAt = turn ? new Date(turn.arrived_at).getTime() : NaN;
      if (!turn || !/^[a-f0-9]{64}$/u.test(turn.request_hash ?? '') || turn.response?.outcome !== 'open'
        || turn.response.app !== review.app || turn.response.memberId !== review.memberId || !Number.isSafeInteger(arrivedAt)
        || arrivedAt > d.now() || d.now() >= arrivedAt + 300_000 || !routeEnvelopeAllowed(policy, turn.network_authority, d.now())
        || typeof turn.body !== 'string' || createHash('sha256').update(turn.body).digest('hex') !== review.commandSha256) return json({ error: "turn_scope_invalid" }, 403);
      const command = parseNetworkCollectionCommand(turn.body);
      if (!command || command.batchId !== review.batchId) return json({ error: 'turn_scope_invalid' }, 403);
      if (request.selection === undefined) {
        if (request.selectionSha256 !== NETWORK_LEARNING_ENTRY_SELECTION_SHA256) return json({ error: 'turn_scope_invalid' }, 403);
      } else if (!learningSelectionMatchesStoredCommand(request.selection, turn.body, review.batchId, arrivedAt, d.now())
        || await hashNetworkCollectionSelection(request.selection) !== request.selectionSha256 || !current()) return json({ error: 'turn_scope_invalid' }, 403);
      const phones = await tx`select e164 from platform.phone_identities where person_id=${candidate.id} limit 2 for share`;
      if (phones.length !== 1) return json({ error: "turn_scope_invalid" }, 403);
      const phone = phones[0]!;
      const optedOut = () => ledgerOptedOut(tx, phone.e164, review.app);
      if (await optedOut() || !current()) return json({ error: "turn_scope_invalid" }, 403);
      const issuedAt = d.now(), collectionExpiresAt = networkCollectionDeadline(arrivedAt, issuedAt);
      if (collectionExpiresAt === undefined) return json({ error: "turn_scope_invalid" }, 403);
      const expiresAt = Math.min(issuedAt + 30_000, arrivedAt + 300_000, collectionExpiresAt, policy!.admitUntil, request.selection?.pendingExpiresAt ?? Infinity, request.selection?.expiresAt ?? Infinity);
      if (expiresAt <= issuedAt) return json({ error: "turn_scope_invalid" }, 403);
      const proof: LearningConsentContextProof = { version: 1, purpose: 'network-learning-membership-v1', requestSha256: createHash('sha256').update(raw).digest('hex'),
        requestNonce: review.requestNonce, channel: review.channel, messageId: review.messageId, commandSha256: review.commandSha256,
        networkAuthority: review.networkAuthority, personId: candidate.id, app: review.app, memberId: review.memberId,
        selectionSha256: request.selectionSha256, collectionExpiresAt, issuedAt, expiresAt };
      const body = JSON.stringify(proof);
      const headers = await svcSign(d.secret!, { method: 'POST', path: LEARNING_CONSENT_CONTEXT_PATH, id: `${id}:proof`, body, nowS: Math.floor(d.now() / 1000) });
      if (await optedOut() || !current() || d.now() >= expiresAt) return json({ error: 'turn_scope_invalid' }, 403);
      return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    });
  } catch { return json({ error: 'unavailable' }, 503); }
}
