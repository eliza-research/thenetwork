// spec/browserJoin.md, "Join in the browser"

/** Each error that the join page can show. The platform codes map onto these in `platformErrors`. */
export type ApiError =
  | "api_unreachable"
  | "cloud_auth_unavailable"
  | "cloud_auth_required"
  | "server"
  | "rate_limited"
  | "invalid_code"
  | "invalid_phone"
  | "invalid"
  | "account_changed"
  | "turnstile"
  | "under_age"
  | "invite_only"
  | "review"
  | "unauthorized"
  | "unknown";

/** Platform error code to the error that the page shows, for the codes that the join endpoints send. */
export const platformErrors: Readonly<Record<string, ApiError>> = {
  cloud_auth_unavailable: "cloud_auth_unavailable",
  cloud_auth_required: "cloud_auth_required",
  rate_limited: "rate_limited",
  invalid_code: "invalid_code",
  invalid_phone: "invalid_phone",
  invalid: "invalid",
  account_changed: "account_changed",
  turnstile: "turnstile",
  under_age: "under_age",
  invite_only: "invite_only",
  review: "review",
  unauthorized: "unauthorized",
  reauth: "unauthorized",
  no_person: "unauthorized",
  join_failed: "server",
  consent_wording: "server",
  server: "server",
  too_large: "invalid",
  json_required: "unknown",
  origin: "unknown",
  app_mismatch: "unknown",
  unknown_app: "unknown",
  method: "unknown",
  not_found: "unknown",
  api_unreachable: "api_unreachable",
};

/** The text that the page shows for each error. */
export const apiMessages: Readonly<Record<ApiError, string>> = {
  cloud_auth_unavailable: "Phone sign-in is unavailable right now. Please try again in a minute.",
  cloud_auth_required: "Reload this page, then choose Continue with your phone to sign in.",
  api_unreachable: "We can't reach our server right now. Nothing was sent. Please try again in a minute.",
  server: "Something went wrong on our side. Please try again in a minute.",
  invalid_phone: "Enter a 10-digit US mobile number.",
  turnstile: "We could not check that you are a person. Please try again.",
  review: "We need to check this number before it can be used here. Please try again later, or email us for help.",
  rate_limited: "Too many tries for now. Please wait an hour, then try again.",
  invalid_code: "That code is not right, or it has expired. Check the text and try again.",
  invalid: "Some details are missing or not valid. Check the fields and try again.",
  account_changed: "Your account changed. Please check your details again.",
  under_age: "You must be 13 or older to join. We did not save your details.",
  invite_only: "You can join only with an invitation.",
  unauthorized: "Your session ended. Please log in again.",
  unknown: "Something went wrong. Nothing was changed. Please try again.",
};

/** One answer of the same-origin API: a JSON object, or the error that the page shows. */
export type ApiAnswer = { ok: true; data: Readonly<Record<string, unknown>> } | { ok: false; error: ApiError; status: number };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Sends one request to `/api/*` on the page's own origin. Every POST is JSON, also with no fields, because the API refuses other POSTs. */
export async function call(method: "GET" | "POST", path: string, body?: Readonly<Record<string, unknown>>): Promise<ApiAnswer> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "POST" ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    return { ok: false, error: "api_unreachable", status: 0 };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const object = isRecord(json) ? json : undefined;
  if (response.ok) return object ? { ok: true, data: object } : { ok: false, error: "api_unreachable", status: response.status };
  if (response.status === 401) return { ok: false, error: "unauthorized", status: 401 };
  if (response.status === 429) return { ok: false, error: "rate_limited", status: 429 };
  const named = object && typeof object.error === "string" ? platformErrors[object.error] : undefined;
  if (named) return { ok: false, error: named, status: response.status };
  if (!object) return { ok: false, error: "api_unreachable", status: response.status };
  return { ok: false, error: response.status >= 500 ? "server" : "unknown", status: response.status };
}

/** Reads a field of an answer as a plain object, or undefined. */
export const recordField = (data: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | undefined => {
  const value = data[key];
  return isRecord(value) ? value : undefined;
};
