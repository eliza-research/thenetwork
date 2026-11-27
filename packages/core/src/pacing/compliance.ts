import { createHmac } from "node:crypto";
import type { Clock } from "../clock.ts";
import { fold } from "../guard.ts";

export type ComplianceTier = "GREEN" | "AMBER" | "RED";

export type ComplianceMode =
  | "official_api_opt_in"
  | "inbound_qr_deeplink"
  | "public_open_data"
  | "paid_ads_api"
  | "human_copilot_draft"
  | "us_b2b_commercial_email"
  | "creator_sponsored_outreach"
  | "device_farm_social_automation"
  | "unauthenticated_scraping"
  | "cold_sms_without_pewc"
  | "consumer_cli_subscription"
  | "undisclosed_ai_persona"
  | "cross_app_score_bleed";

export type RuntimeEnvironment = "dev" | "test" | "staging" | "production";

export interface ComplianceGateInput {
  readonly mode: ComplianceMode;
  readonly env: RuntimeEnvironment;
  readonly hasRecordedConsent?: boolean;
  readonly hasHitlApproval?: boolean;
  readonly recipientCountry?: string;
  readonly recipientIsMinor?: boolean;
  readonly officialApiApproved?: boolean;
  readonly allowAmberInProd?: boolean;
}

export interface ComplianceGateDecision {
  readonly allowed: boolean;
  readonly tier: ComplianceTier;
  readonly code: string;
  readonly reason: string;
}

const MODE_TIERS: Readonly<Record<ComplianceMode, ComplianceTier>> = {
  official_api_opt_in: "GREEN",
  inbound_qr_deeplink: "GREEN",
  public_open_data: "GREEN",
  paid_ads_api: "GREEN",
  human_copilot_draft: "GREEN",
  us_b2b_commercial_email: "AMBER",
  creator_sponsored_outreach: "AMBER",
  device_farm_social_automation: "RED",
  unauthenticated_scraping: "RED",
  cold_sms_without_pewc: "RED",
  consumer_cli_subscription: "RED",
  undisclosed_ai_persona: "RED",
  cross_app_score_bleed: "RED",
};

const OPT_IN_ONLY_EMAIL_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB",
  "UK", "NO", "IS", "LI", "CH", "CA",
]);

export function complianceTierOf(mode: ComplianceMode): ComplianceTier {
  return MODE_TIERS[mode];
}

export function evaluateComplianceGate(input: ComplianceGateInput): ComplianceGateDecision {
  const tier = complianceTierOf(input.mode);
  if (input.recipientIsMinor === true) {
    return {
      allowed: false,
      tier: "RED",
      code: "minor_outreach_prohibited",
      reason: "Marketing and paid outreach to minors under 18 is strictly prohibited.",
    };
  }

  if (tier === "RED") {
    return {
      allowed: false,
      tier,
      code: `red_mode_blocked_${input.mode}`,
      reason: `Mode '${input.mode}' is classified RED and blocked by default.`,
    };
  }

  if (tier === "AMBER") {
    const deployed = input.env === "staging" || input.env === "production";
    if (deployed && input.allowAmberInProd === false) {
      return {
        allowed: false,
        tier,
        code: "amber_disabled_in_deployed_env",
        reason: `AMBER mode '${input.mode}' is disabled in ${input.env}.`,
      };
    }
    if (!input.hasHitlApproval) {
      return {
        allowed: false,
        tier,
        code: "amber_hitl_approval_required",
        reason: `AMBER mode '${input.mode}' requires human-in-the-loop template approval.`,
      };
    }
    if (input.mode === "us_b2b_commercial_email") {
      const country = input.recipientCountry?.trim().toUpperCase();
      if (country && OPT_IN_ONLY_EMAIL_COUNTRIES.has(country) && !input.hasRecordedConsent) {
        return {
          allowed: false,
          tier,
          code: "opt_in_required_for_jurisdiction",
          reason: `Commercial email to ${country} requires recorded prior opt-in consent.`,
        };
      }
    }
    return {
      allowed: true,
      tier,
      code: "amber_approved",
      reason: `AMBER mode '${input.mode}' approved with HITL controls.`,
    };
  }

  if (input.mode === "official_api_opt_in") {
    if (input.officialApiApproved === false) {
      return {
        allowed: false,
        tier,
        code: "official_api_not_approved",
        reason: "Official platform API app review/approval is required.",
      };
    }
    if (input.hasRecordedConsent === false) {
      return {
        allowed: false,
        tier,
        code: "missing_recorded_consent",
        reason: "Recorded opt-in consent is required for official API outreach.",
      };
    }
  }

  return {
    allowed: true,
    tier,
    code: "green_allowed",
    reason: `GREEN mode '${input.mode}' allowed.`,
  };
}

export interface CopyLintInput {
  readonly channel: "email" | "sms" | "social" | "creator";
  readonly text: string;
  readonly subject?: string;
  readonly isCommercial?: boolean;
  readonly isAiGenerated?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly hasNativePaidToggle?: boolean;
}

export interface CopyLintResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

const UNRENDERED_TOKEN_RE = /\{\{[A-Za-z0-9_.-]+\}\}/;
const POSTAL_ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|pl|place|way|ln|lane|dr|drive|suite|ste|floor|fl|broadway)\b|\bp\.?\s*o\.?\s*box\s+\d+\b/i;
const UNSUBSCRIBE_COPY_RE = /\b(unsubscribe|opt[\s-]?out|manage\s+preferences|reply\s+stop)\b/i;
const AI_DISCLOSURE_RE =
  /\b(ai\s+(?:assistant|agent|coordinator|concierge|matchmaker)|automated\s+(?:assistant|message|outreach)|sent\s+by\s+the\s+network(?:'s)?\s+ai|powered\s+by\s+ai)\b/i;
const FTC_TAG_RE = /(#ad\b|paid\s+partnership|sponsored\s+by)/i;
const PROHIBITED_CLAIMS_RE =
  /\b(guaranteed\s+(?:match|date|job|hire|income)|100%\s+human\s+not\s+a\s+bot|i\s+am\s+not\s+an?\s+ai|secret\s+attractiveness\s+score|clef\s+score)\b/i;

export function hasUnrenderedTemplateTokens(text: string): boolean {
  return UNRENDERED_TOKEN_RE.test(text);
}

export function lintComplianceCopy(input: CopyLintInput): CopyLintResult {
  const violations: string[] = [];
  const combined = `${input.subject ?? ""}\n${input.text}`;

  if (!input.text.trim()) {
    violations.push("empty_body");
  }
  if (hasUnrenderedTemplateTokens(combined)) {
    violations.push("unrendered_template_variable");
  }
  if (PROHIBITED_CLAIMS_RE.test(combined)) {
    violations.push("prohibited_claim");
  }

  if (input.channel === "email" && input.isCommercial !== false) {
    if (!POSTAL_ADDRESS_RE.test(input.text)) {
      violations.push("missing_postal_address");
    }
    if (!UNSUBSCRIBE_COPY_RE.test(input.text)) {
      violations.push("missing_unsubscribe_copy");
    }
    const headersLower = new Map<string, string>();
    for (const [k, v] of Object.entries(input.headers ?? {})) {
      headersLower.set(k.toLowerCase(), v);
    }
    const listUnsub = headersLower.get("list-unsubscribe") ?? "";
    const listUnsubPost = headersLower.get("list-unsubscribe-post") ?? "";
    const hasHttpsUnsub = /<https:\/\/[^>]+>/i.test(listUnsub);
    const hasOneClickPost = /list-unsubscribe=one-click/i.test(listUnsubPost);
    if (!hasHttpsUnsub || !hasOneClickPost) {
      violations.push("missing_rfc8058_headers");
    }
  }

  if (input.channel === "sms" && input.isCommercial !== false) {
    if (!/\bstop\b/i.test(input.text)) {
      violations.push("missing_sms_stop_disclosure");
    }
  }

  if (input.isAiGenerated === true && !AI_DISCLOSURE_RE.test(combined)) {
    violations.push("missing_ai_disclosure");
  }

  if (input.channel === "creator" && input.isCommercial !== false) {
    if (!FTC_TAG_RE.test(combined)) {
      violations.push("missing_ftc_disclosure");
    }
    if (input.hasNativePaidToggle === false) {
      violations.push("missing_native_paid_toggle");
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): bigint {
  let h = FNV64_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * FNV64_PRIME) & MASK_64;
  }
  return h;
}

export function simHash64(text: string): bigint {
  const normalized = fold(text);
  const words = normalized ? normalized.split(" ").filter(Boolean) : [];
  if (words.length === 0) return 0n;
  const features: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    features.push(`1:${words[i]}`);
    if (i + 1 < words.length) {
      features.push(`2:${words[i]} ${words[i + 1]}`);
    }
  }
  const weights = new Int32Array(64);
  for (const feature of features) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit += 1) {
      if (((h >> BigInt(bit)) & 1n) === 1n) {
        weights[bit] = (weights[bit] ?? 0) + 1;
      } else {
        weights[bit] = (weights[bit] ?? 0) - 1;
      }
    }
  }
  let digest = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if ((weights[bit] ?? 0) > 0) {
      digest |= 1n << BigInt(bit);
    }
  }
  return digest;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK_64;
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

export interface EntropyCheckResult {
  readonly ok: boolean;
  readonly hashHex: string;
  readonly nearDuplicateCount: number;
  readonly reason?: string;
}

export class TemplateEntropyGuard {
  private readonly clock: Clock;
  private readonly windowMs: number;
  private readonly maxHammingDistance: number;
  private readonly maxNearDuplicates: number;
  private readonly history = new Map<string, Array<{ hash: bigint; atMs: number }>>();

  constructor(opts: {
    readonly clock: Clock;
    readonly windowMs?: number;
    readonly maxHammingDistance?: number;
    readonly maxNearDuplicates?: number;
  }) {
    this.clock = opts.clock;
    this.windowMs = Math.max(1000, opts.windowMs ?? 86_400_000);
    this.maxHammingDistance = Math.max(0, Math.min(64, opts.maxHammingDistance ?? 3));
    this.maxNearDuplicates = Math.max(1, opts.maxNearDuplicates ?? 25);
  }

  checkAndRecord(scopeKey: string, text: string): EntropyCheckResult {
    const hash = simHash64(text);
    const hashHex = hash.toString(16).padStart(16, "0");
    if (hasUnrenderedTemplateTokens(text)) {
      return {
        ok: false,
        hashHex,
        nearDuplicateCount: 0,
        reason: "unrendered_template_variable",
      };
    }

    const nowMs = this.clock.now();
    const cutoff = nowMs - this.windowMs;
    const entries = (this.history.get(scopeKey) ?? []).filter((e) => e.atMs >= cutoff);
    let nearDuplicateCount = 0;
    for (const entry of entries) {
      if (hammingDistance64(entry.hash, hash) <= this.maxHammingDistance) {
        nearDuplicateCount += 1;
      }
    }

    if (nearDuplicateCount >= this.maxNearDuplicates) {
      this.history.set(scopeKey, entries);
      return {
        ok: false,
        hashHex,
        nearDuplicateCount,
        reason: "near_duplicate_entropy_limit",
      };
    }

    entries.push({ hash, atMs: nowMs });
    this.history.set(scopeKey, entries);
    return {
      ok: true,
      hashHex,
      nearDuplicateCount,
    };
  }
}

export type ContactKind = "phone" | "email" | "handle";
export type SuppressionScope = "global" | "marketing" | "sms" | "email" | "social";

export interface VersionedHashKey {
  readonly version: string;
  readonly secret: string;
}

export interface SuppressionRecord {
  readonly hash: string;
  readonly kind: ContactKind;
  readonly scope: SuppressionScope;
  readonly reason: string;
  readonly source: string;
  readonly isMinor: boolean;
  readonly recordedAtMs: number;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
const NANP_10_RE = /^[2-9]\d{2}[2-9]\d{6}$/;

export function normalizeContactValue(
  kind: ContactKind,
  raw: string,
  platform?: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === "phone") {
    if (trimmed.startsWith("+")) {
      const compact = `+${trimmed.slice(1).replace(/[\s().-]+/g, "")}`;
      return E164_RE.test(compact) ? compact : null;
    }
    const digits = trimmed.replace(/\D+/g, "");
    if (digits.length === 10 && NANP_10_RE.test(digits)) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1") && NANP_10_RE.test(digits.slice(1))) {
      return `+${digits}`;
    }
    return null;
  }
  if (kind === "email") {
    const lower = trimmed.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower) ? lower : null;
  }
  const cleanHandle = trimmed.replace(/^@+/, "").toLowerCase();
  if (!cleanHandle) return null;
  const cleanPlatform = platform?.trim().toLowerCase();
  return cleanPlatform ? `${cleanPlatform}:${cleanHandle}` : cleanHandle;
}

export function versionedContactHmac(
  kind: ContactKind,
  raw: string,
  key: VersionedHashKey,
  platform?: string,
): string | null {
  const normalized = normalizeContactValue(kind, raw, platform);
  if (!normalized || !key.version.trim() || !key.secret.trim()) return null;
  const digest = createHmac("sha256", key.secret)
    .update(`${kind}:${normalized}`)
    .digest("hex");
  return `${key.version.trim()}:${digest}`;
}

export function allVersionedContactHmacs(
  kind: ContactKind,
  raw: string,
  keys: readonly VersionedHashKey[],
  platform?: string,
): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const hash = versionedContactHmac(kind, raw, key, platform);
    if (hash) out.push(hash);
  }
  return out;
}

export class SuppressionSync {
  private readonly clock: Clock;
  private readonly keys: readonly VersionedHashKey[];
  private readonly records = new Map<string, SuppressionRecord>();

  constructor(opts: {
    readonly clock: Clock;
    readonly keys: readonly VersionedHashKey[];
    readonly initial?: readonly SuppressionRecord[];
  }) {
    this.clock = opts.clock;
    this.keys = opts.keys;
    if (opts.initial) {
      this.mergeDelta(opts.initial);
    }
  }

  suppress(input: {
    readonly kind: ContactKind;
    readonly value: string;
    readonly platform?: string;
    readonly scope: SuppressionScope;
    readonly reason: string;
    readonly source: string;
    readonly isMinor?: boolean;
  }): SuppressionRecord | null {
    const primary = this.keys[0];
    if (!primary) return null;
    const hash = versionedContactHmac(input.kind, input.value, primary, input.platform);
    if (!hash) return null;
    const record: SuppressionRecord = {
      hash,
      kind: input.kind,
      scope: input.scope,
      reason: input.reason,
      source: input.source,
      isMinor: input.isMinor === true,
      recordedAtMs: this.clock.now(),
    };
    const existing = this.records.get(hash);
    if (!existing || existing.scope !== "global" || record.isMinor) {
      this.records.set(hash, {
        ...record,
        scope: existing?.scope === "global" || record.scope === "global" ? "global" : record.scope,
        isMinor: existing?.isMinor === true || record.isMinor,
      });
    }
    return this.records.get(hash) ?? record;
  }

  check(input: {
    readonly kind: ContactKind;
    readonly value: string;
    readonly platform?: string;
    readonly scope?: SuppressionScope;
  }): { readonly suppressed: boolean; readonly failClosed: boolean; readonly record?: SuppressionRecord } {
    if (this.keys.length === 0) {
      return { suppressed: true, failClosed: true };
    }
    const hashes = allVersionedContactHmacs(input.kind, input.value, this.keys, input.platform);
    if (hashes.length === 0) {
      return { suppressed: true, failClosed: true };
    }
    for (const hash of hashes) {
      const record = this.records.get(hash);
      if (!record) continue;
      if (
        record.isMinor ||
        record.scope === "global" ||
        input.scope === undefined ||
        record.scope === input.scope
      ) {
        return { suppressed: true, failClosed: false, record };
      }
    }
    return { suppressed: false, failClosed: false };
  }

  exportDelta(sinceMs = 0): SuppressionRecord[] {
    return [...this.records.values()]
      .filter((r) => r.recordedAtMs >= sinceMs)
      .sort((a, b) => a.recordedAtMs - b.recordedAtMs || a.hash.localeCompare(b.hash));
  }

  mergeDelta(incoming: readonly SuppressionRecord[]): number {
    let applied = 0;
    for (const rec of incoming) {
      const prev = this.records.get(rec.hash);
      if (!prev || rec.recordedAtMs > prev.recordedAtMs || rec.isMinor !== prev.isMinor || rec.scope === "global") {
        this.records.set(rec.hash, {
          ...rec,
          scope: prev?.scope === "global" || rec.scope === "global" ? "global" : rec.scope,
          isMinor: prev?.isMinor === true || rec.isMinor,
          recordedAtMs: Math.max(prev?.recordedAtMs ?? 0, rec.recordedAtMs),
        });
        applied += 1;
      }
    }
    return applied;
  }
}
