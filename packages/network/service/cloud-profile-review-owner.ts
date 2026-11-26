import { collectionProposalMatchesStoredCommand } from "./profile-suggestions.ts";
import { createHash, randomUUID } from "node:crypto";
import { isAppId } from "../../platform/src/apps.ts";
import { PROFILE_REVIEW_OWNER_PATH as OWNER_PATH, parseProfileReviewOwnerRequest, parseProfileReviewOwnerProof } from "../../core/src/svc/profile-review-owner.ts";
import { profileReviewProofTransport } from "./profile-review-proof-transport.ts";
import { routeEnvelopeAllowed, sameNetworkAuthority, type NetworkRoutePolicy } from "./route-authority.ts";
import type { SuggestionIdentityResolver } from "./profile-suggestion-endpoint.ts";

const MAX_PARENT_AGE_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export interface CloudProfileReviewOwnerOptions {
  origin: string; secret: string; routePolicy: NetworkRoutePolicy; now: () => number;
  development?: boolean;
  fetch?: typeof fetch;
}

export function cloudProfileReviewOwner(o: CloudProfileReviewOwnerOptions): SuggestionIdentityResolver {
  const post = profileReviewProofTransport(o);
  return async (context, tx) => {
    try {
      const now = o.now();
      if (!Number.isSafeInteger(now) || !isAppId(context.app) || !UUID.test(context.personId)
        || !UUID.test(context.batchId) || !/^[a-f0-9]{64}$/u.test(context.commandSha256)
        || !context.networkAuthority || now >= o.routePolicy.admitUntil
        || !routeEnvelopeAllowed(o.routePolicy, context.networkAuthority, now)) return null;
      await tx`select set_config('app.app_id',${context.app},true)`;
      const [turn] = await tx`select i.request_hash,i.arrived_at,i.network_authority,i.response,m.body
        from platform.inbound i join platform.people p on p.phone_hash=i.sender_hash
        join network.members n on n.person_id=p.id and n.app_id=${context.app} and n.id=${context.memberId}
        join platform.memberships pm on pm.person_id=p.id and pm.app_id=n.app_id and pm.member_id=n.id
        join network.messages m on m.app_id=n.app_id and m.member_id=n.id and m.id=${`in:${context.channel}:${context.messageId}`} and m.direction='inbound'
        where i.id=${`msg:${context.channel}:${context.messageId}`} and i.status='done' and p.id=${context.personId}
        and p.deleted_at is null and pm.state<>'removed'`;
      if (!turn || !/^[a-f0-9]{64}$/u.test(turn.request_hash ?? "") || turn.response?.outcome !== "open"
        || turn.response.app !== context.app || turn.response.memberId !== context.memberId
        || !sameNetworkAuthority(turn.network_authority, context.networkAuthority)
        || typeof turn.body !== "string" || sha256(turn.body) !== context.commandSha256) return null;
      const command = turn.body.trim();
      if (context.action === "collect") {
        if (!context.collectionProposal || !collectionProposalMatchesStoredCommand(context.collectionProposal, turn.body, context.batchId, new Date(turn.arrived_at).getTime(), now)
          || context.pendingExpiresAt !== context.collectionProposal.expiresAt) return null;
      } else if (context.action === "preview" || context.action === "delete") {
        if (command !== `${context.action} ${context.batchId}`) return null;
      } else if (!["accept", "reject", "edit"].some(verb => command.startsWith(`${verb} ${context.batchId}.`))) return null;
      const arrivedAt = new Date(turn.arrived_at).getTime();
      if (!Number.isSafeInteger(arrivedAt) || arrivedAt > now || now - arrivedAt >= MAX_PARENT_AGE_MS) return null;
      const requestNonce = randomUUID();
      const selector = parseProfileReviewOwnerRequest({ version: 1, channel: context.channel, messageId: context.messageId, app: context.app, memberId: context.memberId,
        batchId: context.batchId, action: context.action, commandSha256: context.commandSha256, networkAuthority: context.networkAuthority, requestNonce });
      if (!selector) return null;
      const result = await post(OWNER_PATH, `${context.messageId}:suggestions:owner:${requestNonce}`, selector);
      if (!result) return null;
      const proof = parseProfileReviewOwnerProof(result.value, selector, result.selectorSha256, result.now);
      if (!proof || result.now >= o.routePolicy.admitUntil || proof.expiresAt > o.routePolicy.admitUntil
        || !routeEnvelopeAllowed(o.routePolicy, proof.networkAuthority, result.now)) return null;
      return { userId: proof.userId, organizationId: proof.organizationId, chatId: proof.chatId, validUntil: proof.expiresAt };
    } catch { return null; }
  };
}
