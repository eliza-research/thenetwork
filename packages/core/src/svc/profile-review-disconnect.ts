import { proofWindowOk } from "./proof-window.js";
/** Revoked-connection cleanup authority; deliberately independent of active source-read consent. */
export const PROFILE_REVIEW_DISCONNECT_PATH = "/internal/profile-suggestions/connection";
export const PROFILE_REVIEW_DISCONNECT_PROOF_PATH = "/api/internal/network/profile-review-disconnect";
export interface ProfileReviewDisconnectRequest {
  version: 1; operation: "disconnect" | "delete" | "readback";
  app: "ntwrk" | "slop" | "friends" | "peon";
  personId: string; memberId: string; connectionId: string;
  revokedEventId: string; requestNonce: string;
}
export interface ProfileReviewDisconnectProof extends ProfileReviewDisconnectRequest {
  purpose: "network-profile-review-revoked-owner-v1";
  requestSha256: string; userId: string; organizationId: string; chatId: string;
  connectionState: "revoked"; revokedAt: number; issuedAt: number; expiresAt: number;
}
export interface ProfileReviewDisconnectProofRequest { request: ProfileReviewDisconnectRequest; requestSha256: string }
const keys = ["version", "operation", "app", "personId", "memberId", "connectionId", "revokedEventId", "requestNonce"];
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
const bounded = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_:.-]{1,128}$/u.test(v);
export function parseProfileReviewDisconnectRequest(value: unknown): ProfileReviewDisconnectRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))
    || v.version !== 1 || !["disconnect", "delete", "readback"].includes(String(v.operation))
    || !["ntwrk", "slop", "friends", "peon"].includes(String(v.app))
    || !uuid(v.personId) || !bounded(v.memberId) || !uuid(v.connectionId)
    || !bounded(v.revokedEventId) || !uuid(v.requestNonce)) return;
  return value as ProfileReviewDisconnectRequest;
}
/** Exact Cloud callback payload; digest is of ORIGINAL signed cleanup raw body, not this wrapper. */
export function parseProfileReviewDisconnectProofRequest(value: unknown): ProfileReviewDisconnectProofRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, "request") || !Object.hasOwn(v, "requestSha256")
    || !parseProfileReviewDisconnectRequest(v.request) || typeof v.requestSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(v.requestSha256)) return;
  return value as ProfileReviewDisconnectProofRequest;
}
/** Invoke only after trusted Cloud service-response signature verification over exact response bytes. */
export function parseProfileReviewDisconnectProof(value: unknown, request: ProfileReviewDisconnectRequest,
  requestSha256: string, now: number): ProfileReviewDisconnectProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const all = [...keys, "purpose", "requestSha256", "userId", "organizationId", "chatId", "connectionState", "revokedAt", "issuedAt", "expiresAt"];
  if (Object.keys(v).length !== all.length || Object.keys(v).some(k => !all.includes(k))
    || keys.some(k => v[k] !== request[k as keyof ProfileReviewDisconnectRequest])
    || v.purpose !== "network-profile-review-revoked-owner-v1" || v.connectionState !== "revoked"
    || !/^[a-f0-9]{64}$/u.test(requestSha256) || v.requestSha256 !== requestSha256
    || !uuid(v.userId) || !uuid(v.organizationId) || typeof v.chatId !== "string" || !v.chatId.startsWith("personal:") || !uuid(v.chatId.slice(9))
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(v.issuedAt) || !Number.isSafeInteger(v.expiresAt)
    || !Number.isSafeInteger(v.revokedAt) || (v.revokedAt as number) < 0 || (v.revokedAt as number) > (v.issuedAt as number)
    || !proofWindowOk(v.issuedAt as number, v.expiresAt as number, now, 30_000)) return;
  return value as ProfileReviewDisconnectProof;
}
