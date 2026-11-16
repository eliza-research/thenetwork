// spec/browserJoin.md, "Join in the browser"
import type { AuthLookup, BlockReason, JoinOutcome, SessionResult, StartResult, VerifyResult } from "../../../core/src/generated/browserJoin.ts";
import { type ApiError, call, recordField } from "./client.ts";

/** What the page read about the app: its join mode and minimum join age, or why it could not read them. */
export type AppAnswer = { read: true; inviteOnly: boolean; minJoinAge: number } | { read: false; unreachable: boolean };

/** What the page read about the session. `account` is an opaque marker of the signed-in account, empty when signed out. */
export interface SessionAnswer {
  result: SessionResult;
  account: string;
  reason: BlockReason;
  /** The app and account whose fields the person reviews; never a credential. */
  signupView?: string;
}

/** The answer to a code request. `error` tells a general failure apart. */
export interface StartAnswer {
  result: StartResult;
  error?: ApiError;
}

/** The answer to a code check. */
export interface VerifyAnswer {
  result: VerifyResult;
  error?: ApiError;
}

/** The answer to a join request, with the first name that the server saved. */
export interface JoinAnswer {
  result: JoinOutcome;
  error?: ApiError;
  firstName?: string;
}

/** The answer to a cloud sign-in request: the address to go to, or the error. */
export type CloudAnswer = { ok: true; url: string } | { ok: false; error: ApiError };

/** The profile that the page sends to join. */
export interface JoinBody {
  signupView?: string;
  firstName: string;
  age: number;
  consent: { sms: true; wording: string };
}

const serverReasons: Readonly<Record<string, BlockReason>> = { under_age: "UnderAge", invite_only: "InviteOnly", review: "InReview", invalid: "NotValid" };

/** Reads the app's join mode and minimum join age. */
export async function readApp(): Promise<AppAnswer> {
  const answer = await call("GET", "/api/app");
  if (!answer.ok) return { read: false, unreachable: answer.error === "api_unreachable" };
  const { joinMode, minJoinAge } = answer.data;
  if ((joinMode !== "open" && joinMode !== "invite" && joinMode !== "waitlist") || !Number.isSafeInteger(minJoinAge)) return { read: false, unreachable: false };
  return { read: true, inviteOnly: joinMode === "invite", minJoinAge: minJoinAge as number };
}

/** Reads the session: signed out, unreadable, or what the signed-in account may do. */
export async function readSession(): Promise<SessionAnswer> {
  const answer = await call("GET", "/api/me");
  if (!answer.ok) return { result: answer.error === "unauthorized" ? "SignedOut" : "ReadFailed", account: "", reason: "NoBlock" };
  const { canJoin, phoneMasked, signupView, reason } = answer.data;
  const membership = answer.data.membership === null ? null : recordField(answer.data, "membership");
  if (typeof canJoin !== "boolean" || typeof phoneMasked !== "string" || membership === undefined) return { result: "ReadFailed", account: "", reason: "NoBlock" };
  const view = typeof signupView === "string" && signupView !== "" ? signupView : undefined;
  const account = view ?? `phone:${phoneMasked}`;
  const result: SessionResult = canJoin ? "MayJoin" : membership ? "AlreadyIn" : "MayNotJoin";
  const blocked: BlockReason = result !== "MayNotJoin" || typeof reason !== "string" ? "NoBlock" : (serverReasons[reason] ?? "OtherReason");
  return { result, account, reason: blocked, ...(view ? { signupView: view } : {}) };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Asks which sign-in to use. A failure other than "not found" is tried again two times, after 1 s and 2 s. */
export async function readAuthLookup(): Promise<AuthLookup> {
  for (let attempt = 0; ; attempt++) {
    const answer = await call("GET", "/api/auth/mode");
    if (answer.ok) return answer.data.mode === "cloud" ? "ModeCloud" : "ModeOtp";
    if (answer.status === 404 || attempt >= 2) return "LookupFailed";
    await wait(1000 * 2 ** attempt);
  }
}

/** Asks the server to text a code. The security check token goes in the body only when there is one. */
export async function startCode(phone: string, turnstileToken?: string): Promise<StartAnswer> {
  const answer = await call("POST", "/api/auth/otp/start", turnstileToken ? { phone, turnstileToken } : { phone });
  if (answer.ok) return { result: "CodeSent" };
  if (answer.error === "rate_limited") return { result: "StartRateLimited" };
  if (answer.error === "turnstile") return { result: "StartCheckRejected" };
  return { result: "StartFailed", error: answer.error };
}

/** Sends the code that the person typed. */
export async function verifyCode(phone: string, code: string): Promise<VerifyAnswer> {
  const answer = await call("POST", "/api/auth/otp/verify", { phone, code });
  if (answer.ok) return { result: "Verified" };
  if (answer.error === "invalid_code") return { result: "WrongCode" };
  if (answer.error === "rate_limited") return { result: "VerifyRateLimited" };
  return { result: "VerifyFailed", error: answer.error };
}

const joinRefusals: Readonly<Partial<Record<ApiError, JoinOutcome>>> = {
  under_age: "JoinUnderAge",
  invite_only: "JoinInviteOnly",
  review: "JoinReview",
  account_changed: "JoinAccountChanged",
  unauthorized: "JoinUnauthorized",
};

/** Sends the profile with the text consent. */
export async function joinApp(body: JoinBody): Promise<JoinAnswer> {
  const answer = await call("POST", "/api/join", { ...body });
  if (answer.ok) {
    const firstName = recordField(answer.data, "membership")?.firstName;
    return { result: "JoinedOk", ...(typeof firstName === "string" ? { firstName } : {}) };
  }
  const refusal = joinRefusals[answer.error];
  return refusal ? { result: refusal } : { result: "JoinFailed", error: answer.error };
}

/** Asks for the cloud sign-in address. Only an http or https address is accepted. */
export async function startCloud(returnPath: string): Promise<CloudAnswer> {
  const answer = await call("POST", "/api/auth/cloud/start", { returnPath });
  if (!answer.ok) return { ok: false, error: answer.error };
  const { url } = answer.data;
  if (typeof url !== "string" || !URL.canParse(url, window.location.href)) return { ok: false, error: "unknown" };
  const target = new URL(url, window.location.href);
  return target.protocol === "https:" || target.protocol === "http:" ? { ok: true, url: target.href } : { ok: false, error: "unknown" };
}

/** Changes a US number to E.164 (+1XXXXXXXXXX), or null when it is not a 10-digit US number. */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  if (/^[01]/.test(national) || /^[01]/.test(national.slice(3))) return null;
  return `+1${national}`;
}

/** Shows only the last four digits of a number. */
export const maskPhone = (e164: string): string => `(•••) •••-${e164.slice(-4)}`;
