import { proofWindowOk } from "./proof-window.js";
import { parseNetworkRouteAuthorityV1, type NetworkRouteAuthorityV1 } from "./contract.js";

export const PROFILE_REVIEW_OWNER_PATH = "/api/internal/network/profile-review-owner";
export interface ProfileReviewOwnerRequest {
  version: 1;
  channel: "blooio" | "twilio";
  messageId: string;
  app: "ntwrk" | "slop" | "friends" | "peon";
  memberId: string;
  batchId: string;
  action: "preview" | "decide" | "delete" | "collect";
  commandSha256: string;
  networkAuthority: NetworkRouteAuthorityV1;
  requestNonce: string;
}
export interface ProfileReviewOwnerProof extends ProfileReviewOwnerRequest {
  purpose: "network-profile-review-owner-v1";
  selectorSha256: string;
  userId: string;
  organizationId: string;
  chatId: string;
  issuedAt: number;
  expiresAt: number;
}
const requestKeys = ["version", "channel", "messageId", "app", "memberId", "batchId", "action", "commandSha256", "networkAuthority", "requestNonce"] as const;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function requestFields(v: Record<string, unknown>): boolean {
  return v.version === 1 && ["blooio", "twilio"].includes(String(v.channel))
    && typeof v.messageId === "string" && /^[A-Za-z0-9_:.\-]{1,200}$/.test(v.messageId)
    && ["ntwrk", "slop", "friends", "peon"].includes(String(v.app))
    && typeof v.memberId === "string" && /^[A-Za-z0-9_:\-]{1,128}$/.test(v.memberId)
    && uuid(v.batchId) && ["preview", "decide", "delete", "collect"].includes(String(v.action))
    && digest(v.commandSha256) && !!parseNetworkRouteAuthorityV1(v.networkAuthority) && uuid(v.requestNonce);
}
export function parseProfileReviewOwnerRequest(value: unknown): ProfileReviewOwnerRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === requestKeys.length && Object.keys(v).every(k => (requestKeys as readonly string[]).includes(k)) && requestFields(v)
    ? value as ProfileReviewOwnerRequest : undefined;
}
/** Called only AFTER the service response signature has been verified over its exact bytes. */
export function parseProfileReviewOwnerProof(value: unknown, request: ProfileReviewOwnerRequest, selectorSha256: string, now: number): ProfileReviewOwnerProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const keys = [...requestKeys, "purpose", "selectorSha256", "userId", "organizationId", "chatId", "issuedAt", "expiresAt"];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || !requestFields(v)
    || requestKeys.some(k => JSON.stringify(v[k]) !== JSON.stringify(request[k]))
    || v.purpose !== "network-profile-review-owner-v1" || !digest(selectorSha256) || v.selectorSha256 !== selectorSha256
    || !uuid(v.userId) || !uuid(v.organizationId) || typeof v.chatId !== "string" || !/^personal:[0-9a-f-]{36}$/i.test(v.chatId)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(v.issuedAt) || !Number.isSafeInteger(v.expiresAt)
    || !proofWindowOk(v.issuedAt as number, v.expiresAt as number, now, 30_000)) return undefined;
  return value as ProfileReviewOwnerProof;
}
