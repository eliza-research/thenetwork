import { PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH, parseProfileReviewWithdrawalRequest, parseProfileReviewWithdrawalProof, type ProfileReviewWithdrawalRequest, type ProfileReviewWithdrawalProof } from "../../core/src/svc/profile-review-withdrawal.ts";
import { PROFILE_REVIEW_DISCONNECT_PROOF_PATH, parseProfileReviewDisconnectRequest, parseProfileReviewDisconnectProof } from "../../core/src/svc/profile-review-disconnect.ts";
import type { SuggestionRevokedOwnerResolver } from "./profile-suggestion-disconnect-endpoint.ts";
import { randomUUID } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { parseProfileReviewOwnerRequest } from "../../core/src/svc/profile-review-owner.ts";
import { PROFILE_REVIEW_SOURCE_PATH, parseProfileReviewSourceRequest, parseProfileReviewSourceProof } from "../../core/src/svc/profile-review-source.ts";
import { cloudProfileReviewOwner, type CloudProfileReviewOwnerOptions } from "./cloud-profile-review-owner.ts";
import { profileReviewProofTransport } from "./profile-review-proof-transport.ts";
import { networkRoutePolicy, routeEnvelopeAllowed } from "./route-authority.ts";
import type { SuggestionIdentityResolver, SuggestionTurnIdentity } from "./profile-suggestion-endpoint.ts";
import type { SuggestionAuthorization, SuggestionOwner } from "./profile-suggestions.ts";

interface TransactionReview {
  turn: SuggestionTurnIdentity;
  owner: SuggestionOwner;
  ownerUntil: number;
  sourceUntil: number;
}
export type SuggestionWithdrawalOwnerResolver = (request: ProfileReviewWithdrawalRequest, requestSha256: string) => Promise<ProfileReviewWithdrawalProof | null>;

export interface ProfileReviewCallbacks {
  profileSuggestionIdentity: SuggestionIdentityResolver;
  profileSuggestionAuthorization: SuggestionAuthorization;
  profileSuggestionRevokedOwner: SuggestionRevokedOwnerResolver;
  profileSuggestionWithdrawalOwner: SuggestionWithdrawalOwnerResolver;
}

/** Binds source permission to the same database transaction's current canonical owner proof. */
export function profileReviewFactory(o: CloudProfileReviewOwnerOptions): ProfileReviewCallbacks {
  const identity = cloudProfileReviewOwner(o), post = profileReviewProofTransport(o);
  const transactions = new WeakMap<SQL, TransactionReview>();
  const current = (entry: TransactionReview, tx: SQL) => {
    const now = o.now();
    return transactions.get(tx) === entry && Number.isSafeInteger(now) && now < entry.ownerUntil && now < entry.sourceUntil
      && now < o.routePolicy.admitUntil && routeEnvelopeAllowed(o.routePolicy, entry.turn.networkAuthority, now);
  };
  const revokedOwner: SuggestionRevokedOwnerResolver = async (request, requestSha256) => {
    try {
      const before = o.now();
      if (!parseProfileReviewDisconnectRequest(request) || !/^[a-f0-9]{64}$/u.test(requestSha256)
        || !Number.isSafeInteger(before) || before >= o.routePolicy.admitUntil) return null;
      const result = await post(PROFILE_REVIEW_DISCONNECT_PROOF_PATH, `connection-cleanup:${request.requestNonce}`, { request, requestSha256 });
      if (!result || result.now < before || result.now >= o.routePolicy.admitUntil) return null;
      // The proof binds the original cleanup body hash, not the callback wrapper hash.
      const proof = parseProfileReviewDisconnectProof(result.value, request, requestSha256, result.now);
      return proof && proof.expiresAt <= o.routePolicy.admitUntil && o.now() >= result.now && o.now() < proof.expiresAt
        && o.now() < o.routePolicy.admitUntil ? proof : null;
    } catch { return null; }
  };
  const withdrawalOwner: SuggestionWithdrawalOwnerResolver = async (request, requestSha256) => {
    try {
      const before = o.now();
      if (!parseProfileReviewWithdrawalRequest(request) || !/^[a-f0-9]{64}$/u.test(requestSha256)
        || !Number.isSafeInteger(before) || before >= o.routePolicy.admitUntil) return null;
      const result = await post(PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH, `learning-withdrawal:${request.requestNonce}`, { request, requestSha256 });
      if (!result || result.now < before || result.now >= o.routePolicy.admitUntil) return null;
      const proof = parseProfileReviewWithdrawalProof(result.value, request, requestSha256, result.now);
      return proof && proof.expiresAt <= o.routePolicy.admitUntil && o.now() >= result.now && o.now() < proof.expiresAt
        && o.now() < o.routePolicy.admitUntil ? proof : null;
    } catch { return null; }
  };
  return {
    profileSuggestionWithdrawalOwner: withdrawalOwner,
    profileSuggestionRevokedOwner: revokedOwner,
    profileSuggestionIdentity: async (turn, tx) => {
      transactions.delete(tx);
      const bound = await identity(turn, tx);
      if (!bound || !Number.isSafeInteger(bound.validUntil)) return null;
      const entry: TransactionReview = { turn: { ...turn }, owner: { userId: bound.userId, organizationId: bound.organizationId,
        chatId: bound.chatId, personId: turn.personId, app: turn.app }, ownerUntil: bound.validUntil!, sourceUntil: Infinity };
      transactions.set(tx, entry);
      return { ...bound, valid: () => current(entry, tx) };
    },
    profileSuggestionAuthorization: async (owner, consent, tx) => {
      try {
        const entry = transactions.get(tx);
        if (!entry || !current(entry, tx) || !["decide", "collect"].includes(entry.turn.action)
          || Object.entries(entry.owner).some(([key, value]) => owner[key as keyof SuggestionOwner] !== value)) return false;
        const review = parseProfileReviewOwnerRequest({ version: 1, channel: entry.turn.channel, messageId: entry.turn.messageId,
          app: entry.turn.app, memberId: entry.turn.memberId, batchId: entry.turn.batchId, action: entry.turn.action,
          commandSha256: entry.turn.commandSha256, networkAuthority: entry.turn.networkAuthority, requestNonce: randomUUID() });
        const request = parseProfileReviewSourceRequest({ version: 1, review, personId: owner.personId, consent });
        if (!review || !request) return false;
        const result = await post(PROFILE_REVIEW_SOURCE_PATH, `${review.messageId}:suggestions:source:${review.requestNonce}`, request);
        if (!result || !current(entry, tx)) return false;
        const proof = parseProfileReviewSourceProof(result.value, request, result.selectorSha256, result.now);
        if (!proof || proof.userId !== owner.userId || proof.organizationId !== owner.organizationId || proof.chatId !== owner.chatId
          || proof.personId !== owner.personId || proof.app !== owner.app || proof.expiresAt > o.routePolicy.admitUntil
          || (entry.turn.action === "collect" && (!Number.isSafeInteger(entry.turn.pendingExpiresAt)
            || entry.turn.pendingExpiresAt! > proof.pendingExpiresAt || entry.turn.pendingExpiresAt! <= o.now()))) return false;
        entry.sourceUntil = Math.min(entry.sourceUntil, proof.expiresAt);
        return current(entry, tx);
      } catch { return false; }
    },
  };
}

/** Source-only bootstrap: no flag or incomplete real scope means no automatically granted access. */
export function profileReviewFromEnv(env: Record<string, string | undefined>, now: () => number, fetchImpl?: typeof fetch): Partial<ProfileReviewCallbacks> {
  const enabled = env.NETWORK_PROFILE_REVIEW_ENABLED;
  if (enabled === undefined || enabled === "0") return {};
  if (enabled !== "1") throw new Error("NETWORK_PROFILE_REVIEW_ENABLED must be 0 or 1");
  const routePolicy = networkRoutePolicy(env);
  if (!routePolicy || !env.NETWORK_CLOUD_DELIVERY_ORIGIN || !env.SERVICE_TURN_SECRET)
    throw new Error("Profile review requires its existing isolated route, trusted Cloud origin and service key");
  return profileReviewFactory({ origin: env.NETWORK_CLOUD_DELIVERY_ORIGIN, secret: env.SERVICE_TURN_SECRET, routePolicy, now,
    development: env.PLATFORM_ENV === "dev", fetch: fetchImpl });
}
