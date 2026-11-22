// spec/oneStepPage.md, "The sign-in moves as the browser join sign-in does"
import type { SignInAnswer, StepSession } from "../../../core/src/generated/oneStepPage.ts";

/** One answer of the same-origin API as the one-step pages read it: the status, the `error` code ("" when there is none), the JSON object and the `retry-after` wait in whole seconds; or no answer, when the request did not reach a server. */
export type StepAnswer =
  | { reached: true; status: number; code: string; data: Readonly<Record<string, unknown>>; retryAfterSeconds: number | undefined }
  | { reached: false };

/** What a one-step page sends: `json` as application/json, or `form` as multipart with the boundary that the browser sets. */
export interface StepRequest {
  method: "GET" | "POST";
  json?: Readonly<Record<string, unknown>>;
  form?: FormData;
  headers?: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const wholeSeconds = (value: string | null): number | undefined => {
  const text = value?.trim() ?? "";
  return /^\d{1,9}$/.test(text) ? Number(text) : undefined;
};

/**
 * Sends one request to `/api/*` on the page's own origin and keeps every fact that the one-step pages map: the status, the error code and `retry-after`.
 * An edge answer such as `502 api_unreachable` or `503 proxy_not_configured` is a reached answer; each caller maps it.
 * @model spec/oneStepPage.md
 */
export async function stepCall(path: string, init: StepRequest): Promise<StepAnswer> {
  const headers: Record<string, string> = { ...init.headers, accept: "application/json" };
  let body: string | FormData | undefined;
  if (init.form) body = init.form;
  else if (init.method === "POST") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json ?? {});
  }
  let response: Response;
  try {
    response = await fetch(path, { method: init.method, credentials: "same-origin", headers, body });
  } catch {
    return { reached: false };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const data = isRecord(json) ? json : {};
  return {
    reached: true,
    status: response.status,
    code: typeof data.error === "string" ? data.error : "",
    data,
    retryAfterSeconds: wholeSeconds(response.headers.get("retry-after")),
  };
}

/** The answer to a sign-in code request, with the wait from the server when it refused for too many tries. */
export interface StepCodeAnswer {
  answer: SignInAnswer;
  retryAfterSeconds?: number;
}

/**
 * Asks the server to text a sign-in code to the current number. The security check token goes in the body only when there is one.
 * @model spec/oneStepPage.md
 */
export async function startStepCode(phone: string, turnstileToken?: string): Promise<StepCodeAnswer> {
  const result = await stepCall("/api/auth/otp/start", { method: "POST", json: turnstileToken ? { phone, turnstileToken } : { phone } });
  if (!result.reached) return { answer: "SignInAnswerFailed" };
  if (result.status === 200) return { answer: "SignInAnswerOk" };
  if (result.status === 429) return { answer: "SignInAnswerRateLimited", ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
  if (result.status === 400 && result.code === "turnstile") return { answer: "SignInAnswerCheckRejected" };
  return { answer: "SignInAnswerFailed" };
}

/**
 * Reads `/api/me`: signed in (200 with a masked number), signed out (401), or unreadable (every other answer, or no answer).
 * @model spec/oneStepPage.md
 */
export async function readStepSession(): Promise<StepSession> {
  const result = await stepCall("/api/me", { method: "GET" });
  if (!result.reached) return "SessionUnreadable";
  if (result.status === 401) return "SessionSignedOut";
  return result.status === 200 && typeof result.data.phoneMasked === "string" ? "SessionSignedIn" : "SessionUnreadable";
}
