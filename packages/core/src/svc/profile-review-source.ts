import { proofWindowOk } from "./proof-window.js";
import { parseProfileReviewOwnerRequest, type ProfileReviewOwnerRequest } from "./profile-review-owner.js";

export const PROFILE_REVIEW_SOURCE_PATH = "/api/internal/network/profile-review-source";
export interface ProfileReviewSourceRequest {
  version: 1;
  review: ProfileReviewOwnerRequest;
  personId: string;
  consent: {
    connectionId: string;
    source: "gmail" | "google_calendar";
    windowStart: number;
    windowEnd: number;
    timezone: string;
    allowedKinds: ("interest" | "goal" | "availability_pattern")[];
    retainOnDisconnect: boolean;
  };
}
export interface ProfileReviewSourceProof {
  version: 1;
  purpose: "network-profile-learning-source-v1";
  requestSha256: string;
  requestNonce: string;
  userId: string;
  organizationId: string;
  personId: string;
  app: ProfileReviewOwnerRequest["app"];
  chatId: string;
  issuedAt: number;
  expiresAt: number;
  pendingExpiresAt: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Canonical source descriptor contains scope only, never Google content or caller Cloud identity. */
export function parseProfileReviewSourceRequest(value: unknown): ProfileReviewSourceRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "consent,personId,review,version" || v.version !== 1
    || !parseProfileReviewOwnerRequest(v.review) || typeof v.personId !== "string" || !uuid.test(v.personId)
    || !v.consent || typeof v.consent !== "object" || Array.isArray(v.consent)) return undefined;
  const c = v.consent as Record<string, unknown>;
  if (Object.keys(c).sort().join() !== "allowedKinds,connectionId,retainOnDisconnect,source,timezone,windowEnd,windowStart"
    || typeof c.connectionId !== "string" || !uuid.test(c.connectionId)
    || (c.source !== "gmail" && c.source !== "google_calendar")
    || !Number.isSafeInteger(c.windowStart) || !Number.isSafeInteger(c.windowEnd)
    || (c.windowStart as number) < 0 || (c.windowStart as number) >= (c.windowEnd as number)
    || typeof c.timezone !== "string" || c.timezone.length > 100 || typeof c.retainOnDisconnect !== "boolean"
    || !Array.isArray(c.allowedKinds) || !c.allowedKinds.length || c.allowedKinds.length > 3
    || new Set(c.allowedKinds).size !== c.allowedKinds.length
    || c.allowedKinds.some(k => k !== "interest" && k !== "goal" && k !== "availability_pattern")) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone: c.timezone }); } catch { return undefined; }
  return value as ProfileReviewSourceRequest;
}

/** Validate only after verifying svcVerify over the exact response bytes. No cached proof or retry. */
export function parseProfileReviewSourceProof(value: unknown, request: ProfileReviewSourceRequest, requestSha256: string, now: number): ProfileReviewSourceProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "app,chatId,expiresAt,issuedAt,organizationId,pendingExpiresAt,personId,purpose,requestNonce,requestSha256,userId,version"
    || v.version !== 1 || v.purpose !== "network-profile-learning-source-v1"
    || !/^[a-f0-9]{64}$/.test(requestSha256) || v.requestSha256 !== requestSha256
    || v.requestNonce !== request.review.requestNonce || v.personId !== request.personId || v.app !== request.review.app
    || typeof v.userId !== "string" || !uuid.test(v.userId) || typeof v.organizationId !== "string" || !uuid.test(v.organizationId)
    || typeof v.chatId !== "string" || !/^personal:[0-9a-f-]{36}$/i.test(v.chatId)
    || !Number.isSafeInteger(v.pendingExpiresAt) || (v.pendingExpiresAt as number) < (v.expiresAt as number)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(v.issuedAt) || !Number.isSafeInteger(v.expiresAt)
    || !proofWindowOk(v.issuedAt as number, v.expiresAt as number, now, 5_000)) return undefined;
  return value as ProfileReviewSourceProof;
}
