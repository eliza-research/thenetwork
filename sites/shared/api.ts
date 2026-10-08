// Same-origin client for the shared platform API (PUBLIC API CONTRACT in sites/README.md).
// Every site calls only /api/* on its own origin. The server picks the app from the Host.

export type ApiError =
  | "api_unreachable"
  | "rate_limited"
  | "invalid_code"
  | "invalid"
  | "under_age"
  | "invite_only"
  | "unauthorized"
  | "unknown";

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

export interface AppInfo {
  id: string;
  name: string;
  domain: string;
  joinMode: "open" | "invite";
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

const KNOWN: ApiError[] = ["rate_limited", "invalid_code", "invalid", "under_age", "invite_only"];

export async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  if (res.ok) return { ok: true, data: (json ?? {}) as T };
  if (res.status === 401) return { ok: false, error: "unauthorized", status: 401 };
  if (res.status === 429) return { ok: false, error: "rate_limited", status: 429 };
  const named = json && typeof json.error === "string" ? (json.error as ApiError) : null;
  if (named && KNOWN.includes(named)) return { ok: false, error: named, status: res.status };
  // 502/503/504 from the dev proxy or the edge, or a non-JSON answer: the API is not there.
  if (res.status >= 500 || json === null || named === "api_unreachable") return { ok: false, error: "api_unreachable", status: res.status };
  return { ok: false, error: "unknown", status: res.status };
}

export const api = {
  app: () => call<AppInfo>("GET", "/api/app"),
  me: () => call<Me>("GET", "/api/me"),
  otpStart: (phone: string) => call<{ ok: true }>("POST", "/api/auth/otp/start", { phone }),
  otpVerify: (phone: string, code: string) => call<{ ok: true }>("POST", "/api/auth/otp/verify", { phone, code }),
  logout: () => call<unknown>("POST", "/api/auth/logout"),
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
  rate_limited: "Too many tries for now. Please wait an hour, then try again.",
  invalid_code: "That code is not right, or it has expired. Check the text and try again.",
  invalid: "Some details are missing or not valid. Check the fields and try again.",
  under_age: "You must be older to join. We did not save your details.",
  invite_only: "You can join only with an invitation.",
  unauthorized: "Your session ended. Please log in again.",
  unknown: "Something went wrong. Nothing was changed. Please try again.",
};
