import { proofWindowOk } from "./proof-window.js";
import { parseNetworkCollectionCommand, networkCollectionDeadline, NETWORK_COLLECTION_RETENTION_MS, type NetworkCollectionSelection } from "./learning-collection-command.js";
import { parseProfileReviewOwnerRequest, type ProfileReviewOwnerRequest } from "./profile-review-owner.js";

export const LEARNING_CONSENT_CONTEXT_PATH = "/internal/profile-suggestions/consent-context";
export interface LearningConsentContextRequest {
  version: 1;
  purpose: "network_profile_learning_v1";
  review: ProfileReviewOwnerRequest;
  selectionSha256: string;
  /** Exact eight-key displayed DTO. Omitted only for nonauthorizing entry lookup. */
  selection?: NetworkCollectionSelection;
}
export interface LearningConsentContextProof {
  version: 1;
  purpose: "network-learning-membership-v1";
  requestSha256: string;
  requestNonce: string;
  channel: ProfileReviewOwnerRequest["channel"];
  messageId: string;
  commandSha256: string;
  networkAuthority: ProfileReviewOwnerRequest["networkAuthority"];
  personId: string;
  app: ProfileReviewOwnerRequest["app"];
  memberId: string;
  selectionSha256: string;
  /** Fixed collection lifetime from Network's verified original inbound, not this proof's issuance. */
  collectionExpiresAt: number;
  issuedAt: number;
  expiresAt: number;
}

export function parseLearningConsentContextRequest(value: unknown): LearningConsentContextRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const review = parseProfileReviewOwnerRequest(v.review);
  if (Object.keys(v).sort().join() !== (v.selection === undefined ? "purpose,review,selectionSha256,version" : "purpose,review,selection,selectionSha256,version") || v.version !== 1
    || v.purpose !== "network_profile_learning_v1" || !review || review.action !== "collect"
    || typeof v.selectionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.selectionSha256)
    || (v.selection !== undefined && !parseLearningCollectionSelection(v.selection))) return undefined;
  return value as LearningConsentContextRequest;
}

/** Verify existing service HMAC over the exact body before parsing this identity-only proof. */
export function parseLearningConsentContextProof(value: unknown, request: LearningConsentContextRequest, requestSha256: string, now: number): LearningConsentContextProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "app,channel,collectionExpiresAt,commandSha256,expiresAt,issuedAt,memberId,messageId,networkAuthority,personId,purpose,requestNonce,requestSha256,selectionSha256,version"
    || v.version !== 1 || v.purpose !== "network-learning-membership-v1"
    || !/^[a-f0-9]{64}$/.test(requestSha256) || v.requestSha256 !== requestSha256
    || v.requestNonce !== request.review.requestNonce || v.channel !== request.review.channel || v.messageId !== request.review.messageId
    || v.commandSha256 !== request.review.commandSha256 || v.app !== request.review.app || v.memberId !== request.review.memberId
    || v.selectionSha256 !== request.selectionSha256 || JSON.stringify(v.networkAuthority) !== JSON.stringify(request.review.networkAuthority)
    || typeof v.personId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.personId)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(v.issuedAt) || !Number.isSafeInteger(v.expiresAt)
    || !Number.isSafeInteger(v.collectionExpiresAt)
    || (v.collectionExpiresAt as number) <= (v.issuedAt as number)
    || (v.collectionExpiresAt as number) - (v.issuedAt as number) > NETWORK_COLLECTION_RETENTION_MS
    || (v.expiresAt as number) > (v.collectionExpiresAt as number)
    || (request.selection !== undefined && (request.selection.expiresAt !== v.collectionExpiresAt
      || request.selection.pendingExpiresAt > (v.collectionExpiresAt as number)))
    || !proofWindowOk(v.issuedAt as number, v.expiresAt as number, now, 30_000)) return undefined;
  return value as LearningConsentContextProof;
}

/** Auth655's existing plain-entry marker: an identity lookup, never a collection authorization. */
export const NETWORK_LEARNING_ENTRY_SELECTION_SHA256 = "8078c64dcb84cccf4ba7d82c4fe5f6811bccd449c8502d7ea279eac579f89359";

/** Strict identity-free DTO, with canonical serialization supplied by learning-collection-command. */
export function parseLearningCollectionSelection(value: unknown): NetworkCollectionSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "expiresAt,fields,pendingExpiresAt,retainAcceptedOnDisconnect,sources,timezone,windowEnd,windowStart"
    || ![v.windowStart,v.windowEnd,v.pendingExpiresAt,v.expiresAt].every(Number.isSafeInteger)
    || typeof v.timezone !== "string" || typeof v.retainAcceptedOnDisconnect !== "boolean"
    || !Array.isArray(v.fields) || !v.fields.length || v.fields.length > 3 || new Set(v.fields).size !== v.fields.length
    || v.fields.some(x => !["interest","goal","availability_pattern"].includes(x as string))
    || !Array.isArray(v.sources) || !v.sources.length || v.sources.length > 2) return undefined;
  const sources = new Set<string>();
  for (const x of v.sources) {
    if (!x || typeof x !== "object" || Array.isArray(x) || Object.keys(x).sort().join() !== "connectionId,source"
      || !["gmail","google_calendar"].includes(x.source) || typeof x.connectionId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x.connectionId)
      || sources.has(x.source)) return undefined;
    sources.add(x.source);
  }
  return value as NetworkCollectionSelection;
}

/** Independently join the displayed scope and fixed lifetime to original stored inbound bytes. */
export function learningSelectionMatchesStoredCommand(selection: NetworkCollectionSelection, text: string, batchId: string, arrivedAt: number, now: number): boolean {
  const command = parseNetworkCollectionCommand(text), deadline = networkCollectionDeadline(arrivedAt, now);
  if (command?.kind !== "collect" || command.batchId !== batchId || deadline === undefined) return false;
  const s = command.scope;
  return selection.windowStart === s.windowStart && selection.windowEnd === s.windowEnd && selection.timezone === s.timezone
    && JSON.stringify(selection.fields) === JSON.stringify(s.fields)
    && JSON.stringify(selection.sources.map(x => x.source)) === JSON.stringify(s.sources)
    && selection.retainAcceptedOnDisconnect === s.retainAcceptedOnDisconnect
    && selection.expiresAt === deadline && selection.pendingExpiresAt > now && selection.pendingExpiresAt <= deadline;
}
