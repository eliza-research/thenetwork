import { proofWindowOk } from "./proof-window.js";
/** Owner intake withdrawal is distinct from provider OAuth revocation. */
export const PROFILE_REVIEW_WITHDRAWAL_PATH = "/internal/profile-suggestions/withdrawal";
export const PROFILE_REVIEW_WITHDRAWAL_PROOF_PATH = "/api/internal/network/profile-review-withdrawal";
export interface ProfileReviewWithdrawalRequest {
  version: 2; operation: "withdraw" | "delete" | "readback";
  app: "ntwrk" | "slop" | "friends" | "peon";
  personId: string; memberId: string; connectionId: string;
  withdrawalId: string; requestNonce: string;
}
export interface ProfileReviewWithdrawalProof extends ProfileReviewWithdrawalRequest {
  purpose: "network-profile-review-withdrawal-v2";
  requestSha256: string; userId: string; organizationId: string; chatId: string;
  cutoffAt: number; issuedAt: number; expiresAt: number;
  channel: "blooio" | "twilio"; messageId: string; commandSha256: string;
}
const keys = ["version", "operation", "app", "personId", "memberId", "connectionId", "withdrawalId", "requestNonce"];
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_:.-]{1,128}$/u.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
export function parseProfileReviewWithdrawalRequest(value: unknown): ProfileReviewWithdrawalRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || v.version !== 2
    || !["withdraw", "delete", "readback"].includes(String(v.operation)) || !["ntwrk", "slop", "friends", "peon"].includes(String(v.app))
    || !uuid(v.personId) || !id(v.memberId) || !uuid(v.connectionId) || !uuid(v.withdrawalId) || !uuid(v.requestNonce)) return;
  return value as ProfileReviewWithdrawalRequest;
}
export function parseProfileReviewWithdrawalProofRequest(value: unknown): { request: ProfileReviewWithdrawalRequest; requestSha256: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, "request") || !Object.hasOwn(v, "requestSha256")
    || !parseProfileReviewWithdrawalRequest(v.request) || !digest(v.requestSha256)) return;
  return value as { request: ProfileReviewWithdrawalRequest; requestSha256: string };
}
/** Only after Cloud service signature verification; event derives from actual canonical owner command. */
export function parseProfileReviewWithdrawalProof(value: unknown, request: ProfileReviewWithdrawalRequest, hash: string, now: number): ProfileReviewWithdrawalProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const all = [...keys, "purpose", "requestSha256", "userId", "organizationId", "chatId", "cutoffAt", "issuedAt", "expiresAt", "channel", "messageId", "commandSha256"];
  if (Object.keys(v).length !== all.length || Object.keys(v).some(k => !all.includes(k)) || !parseProfileReviewWithdrawalRequest(request)
    || keys.some(k => v[k] !== request[k as keyof ProfileReviewWithdrawalRequest])
    || v.purpose !== "network-profile-review-withdrawal-v2" || !digest(hash) || v.requestSha256 !== hash
    || !uuid(v.userId) || !uuid(v.organizationId) || typeof v.chatId !== "string" || !v.chatId.startsWith("personal:") || !uuid(v.chatId.slice(9))
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(v.cutoffAt) || !Number.isSafeInteger(v.issuedAt) || !Number.isSafeInteger(v.expiresAt)
    || (v.cutoffAt as number) < 0 || (v.cutoffAt as number) > (v.issuedAt as number)
    || !proofWindowOk(v.issuedAt as number, v.expiresAt as number, now, 30_000)
    || !["blooio", "twilio"].includes(String(v.channel))
    || typeof v.messageId !== "string" || !/^[A-Za-z0-9_:.-]{1,200}$/u.test(v.messageId) || !digest(v.commandSha256)) return;
  return value as ProfileReviewWithdrawalProof;
}
