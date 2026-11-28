import type { BudgetState, EnvMap, PreflightSafetyStatus, RecipientKind } from "./types.ts";

export type SafetyErrorCode =
  | "recipient_not_allowlisted"
  | "live_send_unlocked"
  | "production_mutation_blocked"
  | "budget_exceeded";

export class LiveTestSafetyError extends Error {
  override readonly name = "LiveTestSafetyError";
  constructor(
    readonly code: SafetyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_BUDGET_USD = 2.0;
export const DEFAULT_MAX_REQUESTS = 150;
export const REQUIRED_LIVE_SEND_CONFIRM = "ALLOWLIST_ONLY";

export const PRODUCTION_DOMAINS: readonly string[] = [
  "ntwrk.party",
  "slop.date",
  "peon.biz",
  "friends.help",
  "api.ntwrk.party",
] as const;

const ALLOWLIST_ENV_BY_KIND: Record<RecipientKind, string> = {
  phone: "LIVE_TEST_ALLOWLIST_PHONES",
  email: "LIVE_TEST_ALLOWLIST_EMAILS",
  handle: "LIVE_TEST_ALLOWLIST_HANDLES",
};

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function normalizeRecipient(kind: RecipientKind, target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  if (kind === "phone") {
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/\D+/g, "");
    if (!digits) return "";
    if (hasPlus) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${digits}`;
  }
  if (kind === "email") {
    return trimmed.toLowerCase();
  }
  return trimmed.replace(/^@+/, "").toLowerCase();
}

export function getAllowlistSet(kind: RecipientKind, env: EnvMap = process.env): Set<string> {
  const key = ALLOWLIST_ENV_BY_KIND[kind];
  const entries = parseAllowlist(env[key]);
  const out = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeRecipient(kind, entry);
    if (normalized) out.add(normalized);
  }
  return out;
}

export function assertAllowedRecipient(
  kind: RecipientKind,
  target: string,
  env: EnvMap = process.env,
): string {
  const normalized = normalizeRecipient(kind, target);
  if (!normalized) {
    throw new LiveTestSafetyError(
      "recipient_not_allowlisted",
      `Refusing empty or invalid ${kind} recipient target.`,
    );
  }
  const allowlist = getAllowlistSet(kind, env);
  if (!allowlist.has(normalized)) {
    const envKey = ALLOWLIST_ENV_BY_KIND[kind];
    throw new LiveTestSafetyError(
      "recipient_not_allowlisted",
      `Refusing ${kind} send to non-allowlisted target. Add it explicitly to ${envKey}.`,
    );
  }
  return normalized;
}

export function activeLiveSendFlags(env: EnvMap = process.env): string[] {
  const active: string[] = [];
  if (env.NETWORK_CHANNEL && env.NETWORK_CHANNEL.trim() !== "") {
    active.push(`NETWORK_CHANNEL=${env.NETWORK_CHANNEL.trim()}`);
  }
  if (env.MARKETING_LIVE_SEND === "1") active.push("MARKETING_LIVE_SEND=1");
  if (env.MARKETING_LIVE_BILLING === "1") active.push("MARKETING_LIVE_BILLING=1");
  if (env.MARKETING_LIVE_DEVICE === "1") active.push("MARKETING_LIVE_DEVICE=1");
  return active;
}

export function inspectSafetyStatus(env: EnvMap = process.env): PreflightSafetyStatus {
  const liveSendFlagsActive = activeLiveSendFlags(env);
  const phones = getAllowlistSet("phone", env).size;
  const emails = getAllowlistSet("email", env).size;
  const handles = getAllowlistSet("handle", env).size;
  const hasAllowlist = phones + emails + handles > 0;
  const confirmLiveSendValid = env.LIVE_TEST_CONFIRM_LIVE_SEND === REQUIRED_LIVE_SEND_CONFIRM;

  let safetyError: string | undefined;
  if (liveSendFlagsActive.length > 0) {
    if (!confirmLiveSendValid) {
      safetyError = `Live send flags active (${liveSendFlagsActive.join(", ")}) without LIVE_TEST_CONFIRM_LIVE_SEND=${REQUIRED_LIVE_SEND_CONFIRM}.`;
    } else if (!hasAllowlist) {
      safetyError = `Live send flags active (${liveSendFlagsActive.join(", ")}) with empty allowlists. Populate LIVE_TEST_ALLOWLIST_PHONES, LIVE_TEST_ALLOWLIST_EMAILS, or LIVE_TEST_ALLOWLIST_HANDLES.`;
    }
  }

  return {
    liveSendFlagsActive,
    confirmLiveSendValid,
    allowlistCounts: { phones, emails, handles },
    safeToRunLiveSend: confirmLiveSendValid && hasAllowlist,
    ...(safetyError ? { safetyError } : {}),
  };
}

export function assertSafeLiveSend(env: EnvMap = process.env): void {
  const status = inspectSafetyStatus(env);
  if (status.safetyError) {
    throw new LiveTestSafetyError("live_send_unlocked", status.safetyError);
  }
}

export function isProductionDomainUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/)[0] ?? "";
  }
  if (!host) return false;
  for (const domain of PRODUCTION_DOMAINS) {
    if (host === domain || host === `www.${domain}`) {
      return true;
    }
  }
  return false;
}

export function assertNotProductionMutation(url: string, mutating: boolean): void {
  if (!mutating) return;
  if (isProductionDomainUrl(url)) {
    throw new LiveTestSafetyError(
      "production_mutation_blocked",
      `Refusing mutating live-test operation against production domain URL: ${url}`,
    );
  }
}

export function parseBudgetConfig(
  env: EnvMap = process.env,
  overrides: { limitUsd?: number; maxRequests?: number } = {},
): { limitUsd: number; maxRequests: number } {
  const rawUsd = env.LIVE_TEST_BUDGET_USD;
  const envUsd = rawUsd !== undefined && rawUsd.trim() !== "" ? Number(rawUsd) : DEFAULT_BUDGET_USD;
  const limitUsd = overrides.limitUsd ?? envUsd;
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
    throw new LiveTestSafetyError(
      "budget_exceeded",
      `Invalid LIVE_TEST_BUDGET_USD value: ${String(overrides.limitUsd ?? rawUsd)}`,
    );
  }

  const rawReq = env.LIVE_TEST_MAX_REQUESTS;
  const envReq =
    rawReq !== undefined && rawReq.trim() !== "" ? Number(rawReq) : DEFAULT_MAX_REQUESTS;
  const maxRequests = overrides.maxRequests ?? envReq;
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    throw new LiveTestSafetyError(
      "budget_exceeded",
      `Invalid LIVE_TEST_MAX_REQUESTS value: ${String(overrides.maxRequests ?? rawReq)}`,
    );
  }

  return { limitUsd, maxRequests: Math.floor(maxRequests) };
}

export function assertWithinBudget(
  budget: BudgetState,
  estimatedAdditionalUsd = 0,
  additionalRequests = 0,
): void {
  const projectedUsd = budget.spentUsd + Math.max(0, estimatedAdditionalUsd);
  if (budget.spentUsd >= budget.limitUsd || projectedUsd > budget.limitUsd + 1e-9) {
    throw new LiveTestSafetyError(
      "budget_exceeded",
      `Budget USD limit reached: spent=$${budget.spentUsd.toFixed(4)} + est=$${estimatedAdditionalUsd.toFixed(4)} exceeds limit=$${budget.limitUsd.toFixed(4)}`,
    );
  }
  const projectedRequests = budget.requests + Math.max(0, additionalRequests);
  if (budget.requests >= budget.maxRequests || projectedRequests > budget.maxRequests) {
    throw new LiveTestSafetyError(
      "budget_exceeded",
      `Request budget limit reached: used=${budget.requests} + est=${additionalRequests} exceeds max=${budget.maxRequests}`,
    );
  }
}

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|passwd|session[_-]?cookie|phone|email|otp|verification[_-]?code)$/i;

const PHONE_E164_RE = /\+[1-9]\d{6,14}\b/g;
const PHONE_NANP_RE = /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const COOKIE_HDR_RE = /\b((?:Set-)?Cookie:\s*)[^\r\n;]+/gi;
const API_KEY_RE =
  /\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{12,}|rk_(?:live|test)_[A-Za-z0-9_-]{12,}|pk_(?:live|test)_[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const ENV_SECRET_ASSIGN_RE =
  /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|COOKIE)[A-Z0-9_]*=)([^\s"'`&]+)/g;

export function redactText(input: string): string {
  return input
    .replace(BEARER_RE, "$1[REDACTED_TOKEN]")
    .replace(COOKIE_HDR_RE, "$1[REDACTED_COOKIE]")
    .replace(API_KEY_RE, "[REDACTED_KEY]")
    .replace(ENV_SECRET_ASSIGN_RE, "$1[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_E164_RE, "[REDACTED_PHONE]")
    .replace(PHONE_NANP_RE, "[REDACTED_PHONE]");
}

export function redactSensitive<T>(value: T): T {
  if (typeof value === "string") {
    return redactText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSensitive(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSensitive(v);
      }
    }
    return out as T;
  }
  return value;
}
