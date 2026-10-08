// Same-origin client for the shared platform API (PUBLIC API CONTRACT in sites/README.md).
// Every site calls only /api/* on its own origin. The server picks the app from the Host.

/**
 * Every error the pages can show. The platform's codes (packages/platform/src/api.ts) map onto these
 * in PLATFORM_ERRORS; a test checks that every platform code has an entry.
 */
export type ApiError =
  | "api_unreachable"
  | "server"
  | "rate_limited"
  | "invalid_code"
  | "invalid_phone"
  | "invalid"
  | "turnstile"
  | "under_age"
  | "invite_only"
  | "review"
  | "unauthorized"
  | "unknown";

/** Platform error code -> the message key the page shows. */
export const PLATFORM_ERRORS: Record<string, ApiError> = {
  rate_limited: "rate_limited",
  invalid_code: "invalid_code",
  invalid_phone: "invalid_phone",
  invalid: "invalid",
  turnstile: "turnstile",
  under_age: "under_age",
  invite_only: "invite_only",
  review: "review",
  unauthorized: "unauthorized",
  // A delete or export needs a fresh login: the same next step as an ended session.
  reauth: "unauthorized",
  join_failed: "server",
  // The page's consent text is not the platform's current text: a stale page, not the person's fault.
  consent_wording: "server",
  server: "server",
  // Requests the pages never make on purpose: a bug or a proxy problem, not the person's fault.
  too_large: "invalid",
  json_required: "unknown",
  origin: "unknown",
  app_mismatch: "unknown",
  unknown_app: "unknown",
  method: "unknown",
  not_found: "unknown",
  api_unreachable: "api_unreachable",
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

export interface AppInfo {
  id: string;
  name: string;
  domain: string;
  joinMode: "open" | "invite" | "waitlist";
  minJoinAge: number;
}

export interface Membership {
  state: string;
  joinedAt: string;
  firstName: string;
}

export interface Me {
  app: string;
  phoneMasked: string;
  membership: Membership | null;
  canJoin: boolean;
  reason?: string;
}

export interface JoinBody {
  firstName: string;
  age: number;
  neighborhood?: string;
  zip?: string;
  interests?: string[];
  about?: string;
  consent: { sms: true; wording: string };
}

export async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      // Every POST is JSON, even with no fields: the API refuses any other POST with 415 (CSRF rule).
      headers: method === "POST" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    return { ok: false, error: "api_unreachable", status: 0 };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const isObject = json !== null && typeof json === "object" && !Array.isArray(json);
  // A 200 that is not a JSON object is not our API (an HTML page from a proxy or a captive portal).
  if (res.ok) return isObject ? { ok: true, data: json as T } : { ok: false, error: "api_unreachable", status: res.status };
  if (res.status === 401) return { ok: false, error: "unauthorized", status: 401 };
  if (res.status === 429) return { ok: false, error: "rate_limited", status: 429 };
  const named = isObject && typeof json.error === "string" ? PLATFORM_ERRORS[json.error as string] : undefined;
  if (named) return { ok: false, error: named, status: res.status };
  // No JSON body: the edge or the dev proxy answered, so the API is not there.
  if (!isObject) return { ok: false, error: "api_unreachable", status: res.status };
  return { ok: false, error: res.status >= 500 ? "server" : "unknown", status: res.status };
}

export const api = {
  app: () => call<AppInfo>("GET", "/api/app"),
  me: () => call<Me>("GET", "/api/me"),
  otpStart: (phone: string, turnstileToken?: string) =>
    call<{ ok: true }>("POST", "/api/auth/otp/start", turnstileToken ? { phone, turnstileToken } : { phone }),
  otpVerify: (phone: string, code: string) => call<{ ok: true }>("POST", "/api/auth/otp/verify", { phone, code }),
  logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),
  join: (body: JoinBody) => call<{ ok: true; membership: Membership }>("POST", "/api/join", body),
  exportData: () => call<unknown>("GET", "/api/me/export"),
  stop: () => call<unknown>("POST", "/api/me/stop"),
  remove: (scope: "app" | "all") => call<unknown>("POST", "/api/me/delete", { scope }),
  demo: () => call<unknown>("GET", "/api/demo"),
};

/** Normalizes a US number to E.164 (+1XXXXXXXXXX). Returns null for anything else. */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(national) || /^[01]/.test(national.slice(3))) return null;
  return `+1${national}`;
}

export const MESSAGES: Record<ApiError, string> = {
  api_unreachable: "We can't reach our server right now. Nothing was sent. Please try again in a minute.",
  server: "Something went wrong on our side. Please try again in a minute.",
  invalid_phone: "Enter a 10-digit US mobile number.",
  turnstile: "We could not check that you are a person. Please try again.",
  review: "We need to check this number before it can be used here. Please try again later, or email us for help.",
  rate_limited: "Too many tries for now. Please wait an hour, then try again.",
  invalid_code: "That code is not right, or it has expired. Check the text and try again.",
  invalid: "Some details are missing or not valid. Check the fields and try again.",
  under_age: "You must be 13 or older to join. We did not save your details.",
  invite_only: "You can join only with an invitation.",
  unauthorized: "Your session ended. Please log in again.",
  unknown: "Something went wrong. Nothing was changed. Please try again.",
};
