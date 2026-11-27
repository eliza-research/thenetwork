import { isIP } from "node:net";
import type {
  AgentAuthMode,
  AgentStatus,
  AppId,
  BdDealStage,
  BrandAppId,
  DevicePlatform,
  DeviceStatus,
  DeviceWarmupStage,
  HumanRole,
  ImplementationTier,
  OutreachChannel,
  PayoutRail,
  PersonaId,
  ProofKind,
  ProofVerdict,
  QrBatchAssigneeType,
  RiskDial,
  RiskZone,
  SubscriptionProvider,
  TaskKind,
  TaskStatus,
  VendorChannel,
  VideoAssetStage,
  VipProspectStatus,
} from "./types.ts";

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const APP_IDS = new Set<AppId>(["slop", "peon", "friends", "ntwrk", "all"]);
const BRAND_APP_IDS = new Set<BrandAppId>(["slop", "peon", "friends", "ntwrk"]);
const RISK_ZONES = new Set<RiskZone>(["zone_1_green", "zone_2_amber", "zone_3_red"]);
const RISK_DIALS = new Set<RiskDial>(["conservative", "balanced", "blitz", "lockdown"]);
const CAMPAIGN_STATUSES = new Set<"draft" | "active" | "paused" | "completed">([
  "draft",
  "active",
  "paused",
  "completed",
]);
const PROVIDERS = new Set<SubscriptionProvider>(["chatgpt", "claude", "gemini", "surplus"]);
const AUTH_MODES = new Set<AgentAuthMode>(["cli", "mcp", "oauth", "browser", "api"]);
const PERSONA_IDS = new Set<PersonaId>(["chadwick", "sloane", "peon", "venn", "operator"]);
const AGENT_STATUSES = new Set<AgentStatus>([
  "idle",
  "running",
  "cooldown",
  "rate_limited",
  "paused_stop",
]);
const DEVICE_PLATFORMS = new Set<DevicePlatform>(["macbook", "android", "ios"]);
const WARMUP_STAGES = new Set<DeviceWarmupStage>([
  "birth_passive",
  "light_organic",
  "branded_cadence",
  "steady_state",
]);
const DEVICE_STATUSES = new Set<DeviceStatus>([
  "online",
  "leased",
  "charging_wait",
  "thermal_cooldown",
  "needs_takeover",
  "offline",
]);
const HUMAN_ROLES = new Set<HumanRole>([
  "applicant",
  "street_worker",
  "creator",
  "agency",
  "venue",
  "vip",
]);
const OUTREACH_CHANNELS = new Set<OutreachChannel>([
  "email",
  "craigslist",
  "rentahuman",
  "youtube",
  "tiktok",
  "instagram",
  "x",
  "venue",
  "sms_opted_in",
]);
const TASK_KINDS = new Set<TaskKind>([
  "street_fliering",
  "event_activation",
  "creator_video",
  "agency_booking",
  "print_order",
  "digital_outreach",
  "oss_dev_bounty",
]);
const VENDOR_CHANNELS = new Set<VendorChannel>([
  "craigslist",
  "rentahuman",
  "agency_email",
  "creator_direct",
  "print_api",
  "internal",
  "slop_cash",
]);
const PAYOUT_RAILS = new Set<PayoutRail>([
  "none",
  "fiat_stripe",
  "fiat_tremendous",
  "usdc_direct",
  "slop_cash",
]);
const TASK_STATUSES = new Set<TaskStatus>([
  "drafted",
  "posted_or_emailed",
  "applicant_screened",
  "contract_sent",
  "hired",
  "shift_active",
  "proof_submitted",
  "proof_verified",
  "payout_queued",
  "paid",
  "disputed",
  "cancelled",
]);
const PROOF_KINDS = new Set<ProofKind>([
  "street_shift",
  "creator_video",
  "event_checkin",
  "print_receipt",
  "oss_pr_merge",
]);
const PROOF_VERDICTS = new Set<ProofVerdict>(["pending", "verified", "rejected"]);
const ATTRIBUTION_KINDS = new Set<
  "qr_scan" | "site_visit" | "signup_started" | "signup_verified_adult" | "video_view"
>(["qr_scan", "site_visit", "signup_started", "signup_verified_adult", "video_view"]);
const BD_DEAL_STAGES = new Set<BdDealStage>([
  "prospect",
  "enriched",
  "pitched",
  "negotiating",
  "contracted",
  "kit_shipped",
  "live",
  "audited",
  "closed_lost",
]);
const QR_ASSIGNEE_TYPES = new Set<QrBatchAssigneeType>(["human", "bd_deal"]);
const VIP_STATUSES = new Set<VipProspectStatus>([
  "discovered",
  "scored",
  "drafted",
  "invited",
  "replied",
  "onboarded",
  "declined",
]);
const VIDEO_STAGES = new Set<VideoAssetStage>([
  "trend",
  "script",
  "voice_render",
  "qa",
  "published",
  "measured",
  "killed",
]);

export class HttpValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpValidationError";
    this.status = status;
    this.code = code;
  }
}

function assertNoPrototypePollution(value: unknown, depth = 0): void {
  if (depth > 32) {
    throw new HttpValidationError(400, "NESTING_LIMIT", "JSON payload nesting depth exceeded.");
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoPrototypePollution(item, depth + 1);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new HttpValidationError(
          400,
          "PROTOTYPE_POLLUTION_KEY",
          `Forbidden object key: ${key}`,
        );
      }
      assertNoPrototypePollution(obj[key], depth + 1);
    }
  }
}

function parseJsonStrict(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (key, val: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new HttpValidationError(
          400,
          "PROTOTYPE_POLLUTION_KEY",
          `Forbidden object key: ${key}`,
        );
      }
      return val;
    });
  } catch (err) {
    if (err instanceof HttpValidationError) throw err;
    throw new HttpValidationError(400, "INVALID_JSON", "Invalid JSON request body.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpValidationError(400, "INVALID_JSON_OBJECT", "JSON request body must be an object.");
  }
  assertNoPrototypePollution(parsed);
  return parsed as Record<string, unknown>;
}

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const headerLen = request.headers.get("content-length");
  if (headerLen !== null) {
    const declared = Number(headerLen);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new HttpValidationError(
        413,
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds maximum size of ${maxBytes} bytes.`,
      );
    }
  }

  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new HttpValidationError(
            413,
            "PAYLOAD_TOO_LARGE",
            `Request body exceeds maximum size of ${maxBytes} bytes.`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    return parseJsonStrict(text);
  }

  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new HttpValidationError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds maximum size of ${maxBytes} bytes.`,
    );
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return parseJsonStrict(text);
}

function isPrivateIpv4Octets(a: number, b: number): boolean {
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpAddress(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    return isPrivateIpv4Octets(parts[0] ?? 0, parts[1] ?? 0);
  }
  if (ipVersion === 6) {
    if (host === "::1" || host === "::") return true;
    const mappedDot = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mappedDot?.[1]) {
      return isPrivateIpAddress(mappedDot[1]);
    }
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mappedHex?.[1] && mappedHex[2]) {
      const hi = parseInt(mappedHex[1], 16);
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      return isPrivateIpv4Octets(a, b);
    }
    const firstHextet = host.split(":")[0] ?? "";
    const firstVal = firstHextet ? parseInt(firstHextet, 16) : 0;
    if ((firstVal & 0xfe00) === 0xfc00) return true;
    if ((firstVal & 0xffc0) === 0xfe80) return true;
    if ((firstVal & 0xff00) === 0xff00) return true;
    return false;
  }
  return false;
}

export function validatePublicHttpsUrl(value: unknown, field: string): string {
  const raw = reqString(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpValidationError(400, "INVALID_URL", `${field} must be a valid https:// URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new HttpValidationError(400, "INVALID_URL_SCHEME", `${field} must use https://.`);
  }
  if (parsed.username || parsed.password) {
    throw new HttpValidationError(400, "INVALID_URL_AUTH", `${field} must not embed credentials.`);
  }
  const host = parsed.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, "");
  const isIpLiteral = isIP(bareHost) !== 0;
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!isIpLiteral && !host.includes(".")) ||
    isPrivateIpAddress(host)
  ) {
    throw new HttpValidationError(
      400,
      "SSRF_PRIVATE_HOST",
      `${field} cannot target localhost or private network addresses.`,
    );
  }
  return parsed.href;
}

function asRecord(raw: unknown, label = "body"): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpValidationError(400, "INVALID_OBJECT", `${label} must be a JSON object.`);
  }
  assertNoPrototypePollution(raw);
  return raw as Record<string, unknown>;
}

function reqString(value: unknown, field: string, maxLen = 500): string {
  if (typeof value !== "string") {
    throw new HttpValidationError(400, "INVALID_STRING", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpValidationError(400, "REQUIRED_FIELD", `${field} is required.`);
  }
  if (trimmed.length > maxLen) {
    throw new HttpValidationError(400, "STRING_TOO_LONG", `${field} exceeds ${maxLen} characters.`);
  }
  return trimmed;
}

function optString(value: unknown, field: string, maxLen = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpValidationError(400, "INVALID_STRING", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new HttpValidationError(400, "STRING_TOO_LONG", `${field} exceeds ${maxLen} characters.`);
  }
  return trimmed || undefined;
}

function optNullableString(value: unknown, field: string, maxLen = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpValidationError(400, "INVALID_STRING", `${field} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new HttpValidationError(400, "STRING_TOO_LONG", `${field} exceeds ${maxLen} characters.`);
  }
  return trimmed || null;
}

function reqNumber(value: unknown, field: string, min?: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpValidationError(400, "INVALID_NUMBER", `${field} must be a finite number.`);
  }
  if (min !== undefined && value < min) {
    throw new HttpValidationError(400, "NUMBER_OUT_OF_RANGE", `${field} must be >= ${min}.`);
  }
  if (max !== undefined && value > max) {
    throw new HttpValidationError(400, "NUMBER_OUT_OF_RANGE", `${field} must be <= ${max}.`);
  }
  return value;
}

function reqInt(value: unknown, field: string, min?: number, max?: number): number {
  const n = reqNumber(value, field, min, max);
  if (!Number.isInteger(n)) {
    throw new HttpValidationError(400, "INVALID_INTEGER", `${field} must be an integer.`);
  }
  return n;
}

function optInt(value: unknown, field: string, min?: number, max?: number): number | undefined {
  if (value === undefined) return undefined;
  return reqInt(value, field, min, max);
}

function optNullableInt(
  value: unknown,
  field: string,
  min?: number,
  max?: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return reqInt(value, field, min, max);
}

function optNumber(value: unknown, field: string, min?: number, max?: number): number | undefined {
  if (value === undefined) return undefined;
  return reqNumber(value, field, min, max);
}

function optBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new HttpValidationError(400, "INVALID_BOOLEAN", `${field} must be a boolean.`);
  }
  return value;
}

function reqBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpValidationError(400, "INVALID_BOOLEAN", `${field} must be a boolean.`);
  }
  return value;
}

function reqEnum<T extends string>(value: unknown, field: string, allowed: ReadonlySet<T>): T {
  const s = reqString(value, field, 64);
  if (!allowed.has(s as T)) {
    throw new HttpValidationError(
      400,
      "INVALID_ENUM",
      `${field} must be one of: ${[...allowed].join(", ")}.`,
    );
  }
  return s as T;
}

function optEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return reqEnum(value, field, allowed);
}

function optTier(value: unknown, field: string): ImplementationTier | undefined {
  if (value === undefined) return undefined;
  const n = reqInt(value, field, 1, 4);
  return n as ImplementationTier;
}

function reqTier(value: unknown, field: string): ImplementationTier {
  const n = reqInt(value, field, 1, 4);
  return n as ImplementationTier;
}

function optStringArray(value: unknown, field: string, maxItems = 64): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new HttpValidationError(400, "INVALID_ARRAY", `${field} must be an array of strings.`);
  }
  if (value.length > maxItems) {
    throw new HttpValidationError(400, "ARRAY_TOO_LARGE", `${field} exceeds ${maxItems} items.`);
  }
  return value.map((item, idx) => reqString(item, `${field}[${idx}]`, 256));
}

export interface ParsedCreateCampaign {
  id?: string;
  slug: string;
  name: string;
  city?: string;
  appId: AppId;
  riskZone?: RiskZone;
  riskDial?: RiskDial;
  monthlyBudgetCents?: number;
  dailyCapCents?: number;
  maxTaskCents?: number;
  billingArmed?: boolean;
  slopCashEnabled?: boolean;
  status?: "draft" | "active" | "paused" | "completed";
}

export function parseCreateCampaign(raw: unknown): ParsedCreateCampaign {
  const b = asRecord(raw);
  return {
    id: optString(b.id, "id", 128),
    slug: reqString(b.slug, "slug", 128),
    name: reqString(b.name, "name", 200),
    city: optString(b.city, "city", 64),
    appId: reqEnum(b.appId, "appId", APP_IDS),
    riskZone: optEnum(b.riskZone, "riskZone", RISK_ZONES),
    riskDial: optEnum(b.riskDial, "riskDial", RISK_DIALS),
    monthlyBudgetCents: optInt(b.monthlyBudgetCents, "monthlyBudgetCents", 100, 100_000_000),
    dailyCapCents: optInt(b.dailyCapCents, "dailyCapCents", 100, 10_000_000),
    maxTaskCents: optInt(b.maxTaskCents, "maxTaskCents", 100, 10_000_000),
    billingArmed: optBool(b.billingArmed, "billingArmed"),
    slopCashEnabled: optBool(b.slopCashEnabled, "slopCashEnabled"),
    status: optEnum(b.status, "status", CAMPAIGN_STATUSES),
  };
}

export interface ParsedUpdateCampaign {
  name?: string;
  city?: string;
  appId?: AppId;
  riskZone?: RiskZone;
  riskDial?: RiskDial;
  monthlyBudgetCents?: number;
  dailyCapCents?: number;
  maxTaskCents?: number;
  billingArmed?: boolean;
  slopCashEnabled?: boolean;
  status?: "draft" | "active" | "paused" | "completed";
}

export function parseUpdateCampaign(raw: unknown): ParsedUpdateCampaign {
  const b = asRecord(raw);
  return {
    name: optString(b.name, "name", 200),
    city: optString(b.city, "city", 64),
    appId: optEnum(b.appId, "appId", APP_IDS),
    riskZone: optEnum(b.riskZone, "riskZone", RISK_ZONES),
    riskDial: optEnum(b.riskDial, "riskDial", RISK_DIALS),
    monthlyBudgetCents: optInt(b.monthlyBudgetCents, "monthlyBudgetCents", 100, 100_000_000),
    dailyCapCents: optInt(b.dailyCapCents, "dailyCapCents", 100, 10_000_000),
    maxTaskCents: optInt(b.maxTaskCents, "maxTaskCents", 100, 10_000_000),
    billingArmed: optBool(b.billingArmed, "billingArmed"),
    slopCashEnabled: optBool(b.slopCashEnabled, "slopCashEnabled"),
    status: optEnum(b.status, "status", CAMPAIGN_STATUSES),
  };
}

export function parseRiskDialUpdate(raw: unknown): { riskDial: RiskDial; billingArmed?: boolean } {
  const b = asRecord(raw);
  return {
    riskDial: reqEnum(b.riskDial, "riskDial", RISK_DIALS),
    billingArmed: optBool(b.billingArmed, "billingArmed"),
  };
}

export interface ParsedCreateAgent {
  id?: string;
  personaId: PersonaId;
  displayName: string;
  appId: BrandAppId;
  provider: SubscriptionProvider;
  failoverProvider?: SubscriptionProvider | null;
  authMode?: AgentAuthMode;
  sessionRef?: string;
  sessionHealthy?: boolean;
  dailyTurnCap?: number;
  turnsUsedToday?: number;
  status?: AgentStatus;
}

export function parseCreateAgent(raw: unknown): ParsedCreateAgent {
  const b = asRecord(raw);
  const failover =
    b.failoverProvider === null
      ? null
      : optEnum(b.failoverProvider, "failoverProvider", PROVIDERS);
  return {
    id: optString(b.id, "id", 128),
    personaId: reqEnum(b.personaId, "personaId", PERSONA_IDS),
    displayName: reqString(b.displayName, "displayName", 120),
    appId: reqEnum(b.appId, "appId", BRAND_APP_IDS),
    provider: reqEnum(b.provider, "provider", PROVIDERS),
    failoverProvider: failover,
    authMode: optEnum(b.authMode, "authMode", AUTH_MODES),
    sessionRef: optString(b.sessionRef, "sessionRef", 200),
    sessionHealthy: optBool(b.sessionHealthy, "sessionHealthy"),
    dailyTurnCap: optInt(b.dailyTurnCap, "dailyTurnCap", 1, 2000),
    turnsUsedToday: optInt(b.turnsUsedToday, "turnsUsedToday", 0, 2000),
    status: optEnum(b.status, "status", AGENT_STATUSES),
  };
}

export interface ParsedAgentTick {
  prompt: string;
  campaignId?: string | null;
  targetHumanId?: string | null;
  targetStopped?: boolean;
  lastMessageText?: string;
  lockdown?: boolean;
  allowFailover?: boolean;
  dryRun?: boolean;
}

export function parseAgentTick(raw: unknown): ParsedAgentTick {
  const b = asRecord(raw);
  return {
    prompt: optString(b.prompt, "prompt", 4000) ?? "Execute scheduled NYC growth coordination turn.",
    campaignId: optNullableString(b.campaignId, "campaignId", 128),
    targetHumanId: optNullableString(b.targetHumanId, "targetHumanId", 128),
    targetStopped: optBool(b.targetStopped, "targetStopped"),
    lastMessageText: optString(b.lastMessageText, "lastMessageText", 4000),
    lockdown: optBool(b.lockdown, "lockdown"),
    allowFailover: optBool(b.allowFailover, "allowFailover"),
    dryRun: optBool(b.dryRun, "dryRun"),
  };
}

export interface ParsedCreateDevice {
  id?: string;
  label: string;
  platform: DevicePlatform;
  hostMachine?: string;
  serialOrUdid: string;
  assignedPersona?: PersonaId | null;
  simCarrier?: string | null;
  batteryPct?: number;
  tempC?: number;
  warmupDay?: number;
  warmupStage?: DeviceWarmupStage;
  dailyActionsUsed?: number;
  dailyActionCap?: number;
  status?: DeviceStatus;
}

export function parseCreateDevice(raw: unknown): ParsedCreateDevice {
  const b = asRecord(raw);
  const persona =
    b.assignedPersona === null ? null : optEnum(b.assignedPersona, "assignedPersona", PERSONA_IDS);
  return {
    id: optString(b.id, "id", 128),
    label: reqString(b.label, "label", 120),
    platform: reqEnum(b.platform, "platform", DEVICE_PLATFORMS),
    hostMachine: optString(b.hostMachine, "hostMachine", 120),
    serialOrUdid: reqString(b.serialOrUdid, "serialOrUdid", 128),
    assignedPersona: persona,
    simCarrier: optNullableString(b.simCarrier, "simCarrier", 120),
    batteryPct: optInt(b.batteryPct, "batteryPct", 0, 100),
    tempC: optNumber(b.tempC, "tempC", -20, 100),
    warmupDay: optInt(b.warmupDay, "warmupDay", 0, 3650),
    warmupStage: optEnum(b.warmupStage, "warmupStage", WARMUP_STAGES),
    dailyActionsUsed: optInt(b.dailyActionsUsed, "dailyActionsUsed", 0, 1000),
    dailyActionCap: optInt(b.dailyActionCap, "dailyActionCap", 0, 1000),
    status: optEnum(b.status, "status", DEVICE_STATUSES),
  };
}

export type ParsedDeviceActionPayload =
  | { kind: "tap"; x: number; y: number }
  | { kind: "text"; text: string }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { kind: "launch_app"; packageName: string; activity?: string }
  | { kind: "screenshot"; outputPath?: string }
  | { kind: "ui_dump"; outputPath?: string }
  | { kind: "scrcpy_cmd"; args?: string[] }
  | { kind: "wda_tap"; x: number; y: number }
  | { kind: "wda_type"; text: string }
  | { kind: "wda_launch"; bundleId: string }
  | { kind: "wda_screenshot" };

export interface ParsedDeviceActionRequest {
  action: ParsedDeviceActionPayload;
  leaseHolder?: string;
  lockdown?: boolean;
  targetStopped?: boolean;
  dryRun?: boolean;
  challengeDetected?: boolean;
  batteryPct?: number;
  tempC?: number;
  warmupDay?: number;
}

export function parseDeviceAction(raw: unknown): ParsedDeviceActionRequest {
  const b = asRecord(raw);
  const a = asRecord(b.action, "action");
  const kind = reqString(a.kind, "action.kind", 64);

  let action: ParsedDeviceActionPayload;
  if (kind === "tap" || kind === "wda_tap") {
    action = {
      kind,
      x: reqNumber(a.x, "action.x", 0, 10_000),
      y: reqNumber(a.y, "action.y", 0, 10_000),
    };
  } else if (kind === "text" || kind === "wda_type") {
    action = { kind, text: reqString(a.text, "action.text", 1000) };
  } else if (kind === "swipe") {
    action = {
      kind,
      x1: reqNumber(a.x1, "action.x1", 0, 10_000),
      y1: reqNumber(a.y1, "action.y1", 0, 10_000),
      x2: reqNumber(a.x2, "action.x2", 0, 10_000),
      y2: reqNumber(a.y2, "action.y2", 0, 10_000),
      durationMs: optInt(a.durationMs, "action.durationMs", 10, 30_000),
    };
  } else if (kind === "launch_app") {
    action = {
      kind,
      packageName: reqString(a.packageName, "action.packageName", 200),
      activity: optString(a.activity, "action.activity", 200),
    };
  } else if (kind === "screenshot" || kind === "ui_dump") {
    action = { kind, outputPath: optString(a.outputPath, "action.outputPath", 256) };
  } else if (kind === "scrcpy_cmd") {
    action = { kind, args: optStringArray(a.args, "action.args", 16) };
  } else if (kind === "wda_launch") {
    action = { kind, bundleId: reqString(a.bundleId, "action.bundleId", 200) };
  } else if (kind === "wda_screenshot") {
    action = { kind };
  } else {
    throw new HttpValidationError(400, "INVALID_DEVICE_ACTION", `Unsupported device action kind: ${kind}`);
  }

  return {
    action,
    leaseHolder: optString(b.leaseHolder, "leaseHolder", 120),
    lockdown: optBool(b.lockdown, "lockdown"),
    targetStopped: optBool(b.targetStopped, "targetStopped"),
    dryRun: optBool(b.dryRun, "dryRun"),
    challengeDetected: optBool(b.challengeDetected, "challengeDetected"),
    batteryPct: optInt(b.batteryPct, "batteryPct", 0, 100),
    tempC: optNumber(b.tempC, "tempC", -20, 100),
    warmupDay: optInt(b.warmupDay, "warmupDay", 0, 3650),
  };
}

export interface ParsedCreateHuman {
  id?: string;
  handleOrEmailHmac: string;
  displayLabel: string;
  channel: OutreachChannel;
  role: HumanRole;
  city?: string;
  contactEmail?: string | null;
  lowestAge?: number | null;
  stopped?: boolean;
  banned?: boolean;
  requireAdult?: boolean;
}

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function optValidatedEmail(value: unknown, field: string): string | null | undefined {
  const email = optNullableString(value, field, 254);
  if (email === undefined || email === null) return email;
  if (!BASIC_EMAIL_RE.test(email)) {
    throw new HttpValidationError(400, "INVALID_EMAIL", `${field} must be a valid email address.`);
  }
  return email.toLowerCase();
}

export function parseCreateHuman(raw: unknown): ParsedCreateHuman {
  const b = asRecord(raw);
  return {
    id: optString(b.id, "id", 128),
    handleOrEmailHmac: reqString(b.handleOrEmailHmac, "handleOrEmailHmac", 256),
    displayLabel: reqString(b.displayLabel, "displayLabel", 200),
    channel: reqEnum(b.channel, "channel", OUTREACH_CHANNELS),
    role: reqEnum(b.role, "role", HUMAN_ROLES),
    city: optString(b.city, "city", 64),
    contactEmail: optValidatedEmail(b.contactEmail, "contactEmail"),
    lowestAge: optNullableInt(b.lowestAge, "lowestAge", 0, 150),
    stopped: optBool(b.stopped, "stopped"),
    banned: optBool(b.banned, "banned"),
    requireAdult: optBool(b.requireAdult, "requireAdult"),
  };
}

export interface ParsedCreateTask {
  id?: string;
  campaignId: string;
  tier: ImplementationTier;
  taskKind: TaskKind;
  city?: string;
  title: string;
  briefText: string;
  vendorChannel: VendorChannel;
  assigneeHumanId?: string | null;
  assigneeAgeYears?: number | null;
  amountCents?: number;
  qrBatchCode?: string | null;
  dubShortUrl?: string | null;
  payoutRail?: PayoutRail;
  status?: TaskStatus;
}

export function parseCreateTask(raw: unknown): ParsedCreateTask {
  const b = asRecord(raw);
  const dubUrl =
    b.dubShortUrl === undefined || b.dubShortUrl === null
      ? b.dubShortUrl
      : validatePublicHttpsUrl(b.dubShortUrl, "dubShortUrl");
  return {
    id: optString(b.id, "id", 128),
    campaignId: reqString(b.campaignId, "campaignId", 128),
    tier: reqTier(b.tier, "tier"),
    taskKind: reqEnum(b.taskKind, "taskKind", TASK_KINDS),
    city: optString(b.city, "city", 64),
    title: reqString(b.title, "title", 200),
    briefText: reqString(b.briefText, "briefText", 8000),
    vendorChannel: reqEnum(b.vendorChannel, "vendorChannel", VENDOR_CHANNELS),
    assigneeHumanId: optNullableString(b.assigneeHumanId, "assigneeHumanId", 128),
    assigneeAgeYears: optNullableInt(b.assigneeAgeYears, "assigneeAgeYears", 0, 150),
    amountCents: optInt(b.amountCents, "amountCents", 0, 10_000_000),
    qrBatchCode: optNullableString(b.qrBatchCode, "qrBatchCode", 128),
    dubShortUrl: dubUrl,
    payoutRail: optEnum(b.payoutRail, "payoutRail", PAYOUT_RAILS),
    status: optEnum(b.status, "status", TASK_STATUSES),
  };
}

export interface ParsedSubmitProof {
  taskId: string;
  proofKind: ProofKind;
  evidenceUrl?: string | null;
  checkinMediaHashes?: string[];
  qrScansCount?: number;
  verifiedSignupsCount?: number;
  ftcDisclosed: boolean;
  geoTimeValid: boolean;
  likenessReleaseOk?: boolean;
  shiftDone?: boolean;
  workerAge?: number | null;
  verifierNotes?: string | null;
  authorizePayout?: boolean;
  payoutAdapterId?: string;
  payoutIdempotencyKey?: string;
}

export function parseSubmitProof(raw: unknown): ParsedSubmitProof {
  const b = asRecord(raw);
  const evidenceUrl =
    b.evidenceUrl === undefined || b.evidenceUrl === null || b.evidenceUrl === ""
      ? null
      : validatePublicHttpsUrl(b.evidenceUrl, "evidenceUrl");
  return {
    taskId: reqString(b.taskId, "taskId", 128),
    proofKind: reqEnum(b.proofKind, "proofKind", PROOF_KINDS),
    evidenceUrl,
    checkinMediaHashes: optStringArray(b.checkinMediaHashes, "checkinMediaHashes", 32),
    qrScansCount: optInt(b.qrScansCount, "qrScansCount", 0, 1_000_000),
    verifiedSignupsCount: optInt(b.verifiedSignupsCount, "verifiedSignupsCount", 0, 1_000_000),
    ftcDisclosed: b.ftcDisclosed === undefined ? false : reqBool(b.ftcDisclosed, "ftcDisclosed"),
    geoTimeValid: b.geoTimeValid === undefined ? false : reqBool(b.geoTimeValid, "geoTimeValid"),
    likenessReleaseOk: optBool(b.likenessReleaseOk, "likenessReleaseOk"),
    shiftDone: optBool(b.shiftDone, "shiftDone"),
    workerAge: optNullableInt(b.workerAge, "workerAge", 0, 150),
    verifierNotes: optNullableString(b.verifierNotes, "verifierNotes", 2000),
    authorizePayout: optBool(b.authorizePayout, "authorizePayout"),
    payoutAdapterId: optString(b.payoutAdapterId, "payoutAdapterId", 64),
    payoutIdempotencyKey: optString(b.payoutIdempotencyKey, "payoutIdempotencyKey", 200),
  };
}

export function parseProofReview(raw: unknown): {
  verdict: ProofVerdict;
  verifierNotes?: string | null;
} {
  const b = asRecord(raw);
  return {
    verdict: reqEnum(b.verdict, "verdict", PROOF_VERDICTS),
    verifierNotes: optNullableString(b.verifierNotes, "verifierNotes", 2000),
  };
}

export interface ParsedCreateOutreach {
  campaignId: string;
  agentId: string;
  humanId: string;
  channel: OutreachChannel;
  tier?: ImplementationTier;
  subject?: string | null;
  bodyText: string;
  dailyOutreachCap?: number;
}

export function parseCreateOutreach(raw: unknown): ParsedCreateOutreach {
  const b = asRecord(raw);
  return {
    campaignId: reqString(b.campaignId, "campaignId", 128),
    agentId: reqString(b.agentId, "agentId", 128),
    humanId: reqString(b.humanId, "humanId", 128),
    channel: reqEnum(b.channel, "channel", OUTREACH_CHANNELS),
    tier: optTier(b.tier, "tier"),
    subject: optNullableString(b.subject, "subject", 240),
    bodyText: reqString(b.bodyText, "bodyText", 12_000),
    dailyOutreachCap: optInt(b.dailyOutreachCap, "dailyOutreachCap", 1, 5000),
  };
}

export interface ParsedCreateAttribution {
  campaignId: string;
  taskId?: string | null;
  armId?: string | null;
  desireLane?: string | null;
  qrBatchCode?: string | null;
  eventKind: "qr_scan" | "site_visit" | "signup_started" | "signup_verified_adult" | "video_view";
  city?: string;
  appId: BrandAppId;
  count?: number;
  metadata?: Record<string, unknown>;
}

export function parseCreateAttribution(raw: unknown): ParsedCreateAttribution {
  const b = asRecord(raw);
  const meta = b.metadata === undefined ? undefined : asRecord(b.metadata, "metadata");
  const desireLane =
    b.desireLane === undefined
      ? undefined
      : b.desireLane === null
        ? null
        : parseDesireLane(b.desireLane, "desireLane");
  return {
    campaignId: reqString(b.campaignId, "campaignId", 128),
    taskId: optNullableString(b.taskId, "taskId", 128),
    armId: optNullableString(b.armId, "armId", 128),
    desireLane,
    qrBatchCode: optNullableString(b.qrBatchCode, "qrBatchCode", 128),
    eventKind: reqEnum(b.eventKind, "eventKind", ATTRIBUTION_KINDS),
    city: optString(b.city, "city", 64),
    appId: reqEnum(b.appId, "appId", BRAND_APP_IDS),
    count: optInt(b.count, "count", 1, 1_000_000),
    metadata: meta,
  };
}

export interface ParsedCreateBdDeal {
  id?: string;
  campaignId: string;
  city?: string;
  venueName: string;
  vertical: AppId;
  contactEmail?: string | null;
  businessPhone?: string | null;
  stage?: BdDealStage;
  offeredCents?: number;
  phoneCallbackVerified?: boolean;
  contractHash?: string | null;
  qrBatchId?: string | null;
  notes?: string | null;
}

export function parseCreateBdDeal(raw: unknown): ParsedCreateBdDeal {
  const b = asRecord(raw);
  return {
    id: optString(b.id, "id", 128),
    campaignId: reqString(b.campaignId, "campaignId", 128),
    city: optString(b.city, "city", 64),
    venueName: reqString(b.venueName, "venueName", 200),
    vertical: reqEnum(b.vertical, "vertical", APP_IDS),
    contactEmail: optNullableString(b.contactEmail, "contactEmail", 254),
    businessPhone: optNullableString(b.businessPhone, "businessPhone", 40),
    stage: optEnum(b.stage, "stage", BD_DEAL_STAGES),
    offeredCents: optInt(b.offeredCents, "offeredCents", 0, 10_000_000),
    phoneCallbackVerified: optBool(b.phoneCallbackVerified, "phoneCallbackVerified"),
    contractHash: optNullableString(b.contractHash, "contractHash", 128),
    qrBatchId: optNullableString(b.qrBatchId, "qrBatchId", 128),
    notes: optNullableString(b.notes, "notes", 4000),
  };
}

export interface ParsedCreateQrBatch {
  id?: string;
  campaignId: string;
  city?: string;
  batchCode: string;
  destinationUrl: string;
  dubLinkId?: string | null;
  printQty?: number;
  assignedToType?: QrBatchAssigneeType | null;
  assignedToId?: string | null;
}

export function parseCreateQrBatch(raw: unknown): ParsedCreateQrBatch {
  const b = asRecord(raw);
  const assignedToType =
    b.assignedToType === null
      ? null
      : optEnum(b.assignedToType, "assignedToType", QR_ASSIGNEE_TYPES);
  return {
    id: optString(b.id, "id", 128),
    campaignId: reqString(b.campaignId, "campaignId", 128),
    city: optString(b.city, "city", 64),
    batchCode: reqString(b.batchCode, "batchCode", 128),
    destinationUrl: validatePublicHttpsUrl(b.destinationUrl, "destinationUrl"),
    dubLinkId: optNullableString(b.dubLinkId, "dubLinkId", 128),
    printQty: optInt(b.printQty, "printQty", 1, 1_000_000),
    assignedToType,
    assignedToId: optNullableString(b.assignedToId, "assignedToId", 128),
  };
}

export interface ParsedCreateVipProspect {
  id?: string;
  campaignId: string;
  city?: string;
  name: string;
  archetype: string;
  organization?: string | null;
  publicSource: string;
  sourceUrl?: string | null;
  prestigeScore?: number;
  contactEmail?: string | null;
  inviteDraft?: string | null;
  status?: VipProspectStatus;
}

export function parseCreateVipProspect(raw: unknown): ParsedCreateVipProspect {
  const b = asRecord(raw);
  const sourceUrl =
    b.sourceUrl === undefined || b.sourceUrl === null || b.sourceUrl === ""
      ? null
      : validatePublicHttpsUrl(b.sourceUrl, "sourceUrl");
  return {
    id: optString(b.id, "id", 128),
    campaignId: reqString(b.campaignId, "campaignId", 128),
    city: optString(b.city, "city", 64),
    name: reqString(b.name, "name", 200),
    archetype: reqString(b.archetype, "archetype", 120),
    organization: optNullableString(b.organization, "organization", 200),
    publicSource: reqString(b.publicSource, "publicSource", 120),
    sourceUrl,
    prestigeScore: optInt(b.prestigeScore, "prestigeScore", 0, 100),
    contactEmail: optNullableString(b.contactEmail, "contactEmail", 254),
    inviteDraft: optNullableString(b.inviteDraft, "inviteDraft", 2000),
    status: optEnum(b.status, "status", VIP_STATUSES),
  };
}

export interface ParsedCreateVideoAsset {
  id?: string;
  campaignId: string;
  agentId?: string | null;
  title: string;
  hook: string;
  script: string;
  stage?: VideoAssetStage;
  videoUrl?: string | null;
  platform?: string | null;
  views?: number;
  retention3sPct?: number;
  signups?: number;
  ftcDisclosed?: boolean;
}

export function parseCreateVideoAsset(raw: unknown): ParsedCreateVideoAsset {
  const b = asRecord(raw);
  const videoUrl =
    b.videoUrl === undefined || b.videoUrl === null || b.videoUrl === ""
      ? null
      : validatePublicHttpsUrl(b.videoUrl, "videoUrl");
  return {
    id: optString(b.id, "id", 128),
    campaignId: reqString(b.campaignId, "campaignId", 128),
    agentId: optNullableString(b.agentId, "agentId", 128),
    title: reqString(b.title, "title", 200),
    hook: reqString(b.hook, "hook", 500),
    script: reqString(b.script, "script", 12_000),
    stage: optEnum(b.stage, "stage", VIDEO_STAGES),
    videoUrl,
    platform: optNullableString(b.platform, "platform", 64),
    views: optInt(b.views, "views", 0, 1_000_000_000),
    retention3sPct: optNumber(b.retention3sPct, "retention3sPct", 0, 100),
    signups: optInt(b.signups, "signups", 0, 10_000_000),
    ftcDisclosed: optBool(b.ftcDisclosed, "ftcDisclosed"),
  };
}

export interface ParsedPaginationQuery {
  limit: number;
  offset: number;
  campaignId?: string;
  city?: string;
  status?: string;
}

export function parsePaginationQuery(searchParams: URLSearchParams): ParsedPaginationQuery {
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");

  let limit = 50;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    if (!/^\d+$/.test(rawLimit.trim())) {
      throw new HttpValidationError(400, "INVALID_PAGINATION", "limit must be a positive integer.");
    }
    limit = Number(rawLimit.trim());
    if (limit < 1 || limit > 200) {
      throw new HttpValidationError(400, "INVALID_PAGINATION", "limit must be between 1 and 200.");
    }
  }

  let offset = 0;
  if (rawOffset !== null && rawOffset.trim() !== "") {
    if (!/^\d+$/.test(rawOffset.trim())) {
      throw new HttpValidationError(400, "INVALID_PAGINATION", "offset must be a non-negative integer.");
    }
    offset = Number(rawOffset.trim());
    if (offset > 100_000) {
      throw new HttpValidationError(400, "INVALID_PAGINATION", "offset must be <= 100000.");
    }
  }

  const campaignId = searchParams.get("campaignId")?.trim() || undefined;
  const city = searchParams.get("city")?.trim() || undefined;
  const status = searchParams.get("status")?.trim() || undefined;

  return { limit, offset, campaignId, city, status };
}

const CITY_SLUG_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const DESIRE_LANE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const CONTACT_HASH_RE = /^[a-f0-9]{16,128}$/i;
const E164_OR_PHONE_RE = /^\+?[1-9]\d{6,14}$/;

const DISCOVERY_SOURCES = new Set<string>([
  "nyc_open_data",
  "nys_sla",
  "nys_sla_pending",
  "city_open_data",
  "hn",
  "github",
  "arxiv",
  "reddit",
  "youtube_rss",
  "luma",
  "eventbrite",
  "partiful",
  "sec_form_d",
  "openalex",
  "irs_990",
  "clinical_trials",
]);

export function parseCityParam(
  raw: unknown,
  field = "city",
  opts: { readonly allowAll?: boolean } = {},
): string {
  const value = reqString(raw, field, 32).toLowerCase();
  if (opts.allowAll && value === "all") return "all";
  if (!CITY_SLUG_RE.test(value)) {
    throw new HttpValidationError(
      400,
      "INVALID_CITY",
      `${field} must be a lowercase city code (2-32 chars, letters/digits/-/_).`,
    );
  }
  return value;
}

export function parseDesireLane(raw: unknown, field = "desireLane"): string {
  const value = reqString(raw, field, 64).toLowerCase();
  if (!DESIRE_LANE_RE.test(value)) {
    throw new HttpValidationError(
      400,
      "INVALID_DESIRE_LANE",
      `${field} must be a lowercase snake_case desire lane identifier.`,
    );
  }
  return value;
}

export interface ParsedSeedCity {
  city?: string;
  monthlyBudgetCents?: number;
  dailyCapCents?: number;
  maxTaskCents?: number;
  riskDial?: RiskDial;
  billingArmed?: boolean;
}

export function parseSeedCity(raw: unknown): ParsedSeedCity {
  const b = asRecord(raw);
  const city = b.city !== undefined && b.city !== null ? parseCityParam(b.city, "city") : undefined;
  return {
    city,
    monthlyBudgetCents: optInt(b.monthlyBudgetCents, "monthlyBudgetCents", 100, 100_000_000),
    dailyCapCents: optInt(b.dailyCapCents, "dailyCapCents", 100, 10_000_000),
    maxTaskCents: optInt(b.maxTaskCents, "maxTaskCents", 100, 10_000_000),
    riskDial: optEnum(b.riskDial, "riskDial", RISK_DIALS),
    billingArmed: optBool(b.billingArmed, "billingArmed"),
  };
}

export interface ParsedDiscoveryRequest {
  city?: string;
  desireLane?: string;
  limitPerSource?: number;
  redditSubreddits?: string[];
  youtubeChannelIds?: string[];
  includeSources?: string[];
  includeVipBd?: boolean;
}

export function parseDiscoveryRequest(raw: unknown): ParsedDiscoveryRequest {
  const b = asRecord(raw);
  const city = b.city !== undefined && b.city !== null ? parseCityParam(b.city, "city") : undefined;
  const desireLane =
    b.desireLane !== undefined && b.desireLane !== null
      ? parseDesireLane(b.desireLane, "desireLane")
      : undefined;
  const rawSources = optStringArray(b.includeSources, "includeSources", 20);
  if (rawSources) {
    for (const src of rawSources) {
      if (!DISCOVERY_SOURCES.has(src)) {
        throw new HttpValidationError(
          400,
          "INVALID_DISCOVERY_SOURCE",
          `Unknown discovery source: ${src}`,
        );
      }
    }
  }
  const includeVipBd =
    b.includeVipBd !== undefined
      ? reqBool(b.includeVipBd, "includeVipBd")
      : optBool(b.includeVipBdSources, "includeVipBdSources");
  return {
    city,
    desireLane,
    limitPerSource: optInt(b.limitPerSource, "limitPerSource", 1, 50),
    redditSubreddits: optStringArray(b.redditSubreddits, "redditSubreddits", 10),
    youtubeChannelIds: optStringArray(b.youtubeChannelIds, "youtubeChannelIds", 10),
    includeSources: rawSources,
    includeVipBd,
  };
}

export interface ParsedSimRequest {
  seeds?: number[];
  days?: number;
  cities?: string[];
  quick?: boolean;
  monthlyBudgetCents?: number;
}

export function parseSimRequest(raw: unknown): ParsedSimRequest {
  const b = asRecord(raw);
  let seeds: number[] | undefined;
  if (b.seeds !== undefined) {
    if (!Array.isArray(b.seeds) || b.seeds.length === 0 || b.seeds.length > 16) {
      throw new HttpValidationError(
        400,
        "INVALID_SEEDS",
        "seeds must be a non-empty array of up to 16 positive integers.",
      );
    }
    seeds = b.seeds.map((item, idx) => reqInt(item, `seeds[${idx}]`, 1, 1_000_000));
  }
  let cities: string[] | undefined;
  if (b.cities !== undefined) {
    if (!Array.isArray(b.cities) || b.cities.length === 0 || b.cities.length > 10) {
      throw new HttpValidationError(
        400,
        "INVALID_CITIES",
        "cities must be a non-empty array of up to 10 city codes.",
      );
    }
    cities = b.cities.map((item, idx) => parseCityParam(item, `cities[${idx}]`));
  }
  return {
    seeds,
    days: optInt(b.days, "days", 1, 90),
    cities,
    quick: optBool(b.quick, "quick"),
    monthlyBudgetCents: optInt(b.monthlyBudgetCents, "monthlyBudgetCents", 10_000, 100_000_000),
  };
}

export interface ParsedContactSuppression {
  contactHash?: string;
  phone?: string;
  email?: string;
  reason: string;
  sourceChannel: string;
  isMinor: boolean;
}

export function parseContactSuppression(raw: unknown): ParsedContactSuppression {
  const b = asRecord(raw);
  const contactHash = optString(b.contactHash, "contactHash", 128);
  if (contactHash && !CONTACT_HASH_RE.test(contactHash)) {
    throw new HttpValidationError(
      400,
      "INVALID_CONTACT_HASH",
      "contactHash must be a hex digest (16-128 hex chars).",
    );
  }
  const phone = optString(b.phone, "phone", 32);
  if (phone && !E164_OR_PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
    throw new HttpValidationError(400, "INVALID_PHONE", "phone must be a valid E.164 phone number.");
  }
  const email = optValidatedEmail(b.email, "email") ?? undefined;
  if (!contactHash && !phone && !email) {
    throw new HttpValidationError(
      400,
      "REQUIRED_FIELD",
      "At least one of contactHash, phone, or email is required.",
    );
  }
  return {
    contactHash,
    phone,
    email,
    reason: reqString(b.reason, "reason", 200),
    sourceChannel: optString(b.sourceChannel, "sourceChannel", 64) ?? "operator_api",
    isMinor: optBool(b.isMinor, "isMinor") ?? false,
  };
}

export interface ParsedBdUpdate {
  venueName?: string;
  vertical?: AppId;
  contactEmail?: string | null;
  businessPhone?: string | null;
  offeredCents?: number;
  phoneCallbackVerified?: boolean;
  qrBatchId?: string | null;
  notes?: string | null;
}

export function parseBdUpdate(raw: unknown): ParsedBdUpdate {
  const b = asRecord(raw);
  if (b.stage !== undefined) {
    throw new HttpValidationError(
      400,
      "USE_BD_STAGE_ENDPOINT",
      "Stage transitions must use POST /api/bd/:id/stage so bdDealWithinBounds policy checks run.",
    );
  }
  if (b.contractHash !== undefined) {
    throw new HttpValidationError(
      400,
      "USE_BD_CONTRACT_ENDPOINT",
      "Contract hashes must be issued via POST /api/bd/:id/contract.",
    );
  }
  const businessPhone = optNullableString(b.businessPhone, "businessPhone", 40);
  if (
    typeof businessPhone === "string" &&
    !E164_OR_PHONE_RE.test(businessPhone.replace(/[\s()-]/g, ""))
  ) {
    throw new HttpValidationError(
      400,
      "INVALID_PHONE",
      "businessPhone must be a valid E.164 or numeric phone number.",
    );
  }
  return {
    venueName: optString(b.venueName, "venueName", 200),
    vertical: optEnum(b.vertical, "vertical", APP_IDS),
    contactEmail: optValidatedEmail(b.contactEmail, "contactEmail"),
    businessPhone,
    offeredCents: optInt(b.offeredCents, "offeredCents", 0, 10_000_000),
    phoneCallbackVerified: optBool(b.phoneCallbackVerified, "phoneCallbackVerified"),
    qrBatchId: optNullableString(b.qrBatchId, "qrBatchId", 128),
    notes: optNullableString(b.notes, "notes", 4000),
  };
}
