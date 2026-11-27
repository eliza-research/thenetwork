import {
  canContactExternalProspect,
  canInviteExternalProspectToNetwork,
  canReadExternalProspectInApp,
  canReconsiderExternalProspect,
  genderMan,
  genderNonbinary,
  genderUnknown,
  genderWoman,
  matchmakerAppFriends,
  matchmakerAppNtwrk,
  matchmakerAppPeon,
  matchmakerAppSlop,
  matchmakerPersonaFemale,
  matchmakerPersonaMale,
  personaStatusActive,
  personaStatusDegraded,
  personaStatusSuspended,
  prospectConsentBanned,
  prospectConsentDeclined,
  prospectConsentFutureOptin,
  prospectConsentNone,
  prospectConsentSingleOnly,
  prospectConsentSmsLogistics,
  prospectConsentStopped,
  prospectRetentionDecision,
  routeMatchmakerPersona,
  shouldTriggerExternalSourcing,
  type ContactExternalProspectInput,
  type ExternalSourcingTriggerInput,
  type InviteExternalProspectInput,
  type ProspectRetentionInput,
  type ReconsiderExternalProspectInput,
  type RouteMatchmakerPersonaInput,
} from "./generated/externalMatchmaker.ts";
import { ADULT_AGE, canBeMatched, isMinor } from "./policy.ts";
import type { AppId, LaunchCity } from "./types.ts";

export type PersonaGender = "female" | "male";
export type MemberGender = "woman" | "man" | "nonbinary" | "unknown";
export type PersonaHealthStatus = "active" | "degraded" | "suspended";
export type ExternalProspectPlatform =
  | "hinge"
  | "bumble"
  | "tinder"
  | "datemedoc"
  | "luma"
  | "partiful"
  | "referral";

export type ExternalProspectConsentState =
  | "none"
  | "intro_single_only"
  | "intro_future_optin"
  | "sms_logistics_optin"
  | "declined"
  | "stopped"
  | "banned";

export type ExternalSourcingState =
  | "member_sparse"
  | "brief_review"
  | "scouting"
  | "prospect_qualifying"
  | "prospect_soft_yes"
  | "pair_review_desk"
  | "member_probed"
  | "member_yes"
  | "prospect_sms_optin"
  | "venue_verified_booked"
  | "pre_brief"
  | "active_arrival"
  | "completed"
  | "member_followup"
  | "quality_gate"
  | "warm_invite"
  | "closed";

export interface MatchmakerPersona {
  id: string;
  city: string;
  gender: PersonaGender;
  firstName: string;
  tz: string;
  hubs: string[];
  verticals: ("slop" | "friends")[];
  humanOperated: true;
  bioDisclosure: string;
  status: PersonaHealthStatus;
  dailyOutboundCap: number;
  dailyOutboundCount: number;
  rollingChatsCount: number;
  rollingUnmatchesCount: number;
  suspendedReason?: string;
}

export interface CityMatchmakerPair {
  city: string;
  female: MatchmakerPersona;
  male: MatchmakerPersona;
}

export interface ExternalProspectRecord {
  id: string;
  city: string;
  sourcePlatform: ExternalProspectPlatform;
  assignedPersonaId: string;
  assignedPersonaGender: PersonaGender;
  dedupeHash: string;
  phoneHash?: string;
  firstName: string;
  statedAge: number;
  gender: MemberGender;
  seeks: MemberGender[];
  neighborhood: string;
  facets: Record<string, string | boolean>;
  consentState: ExternalProspectConsentState;
  consentAtMs?: number;
  createdAtMs: number;
  lastContactAtMs: number;
  expiresAtMs: number;
  recontactCount: number;
  inviteAttempts: number;
  convertedMemberId?: string;
  held: boolean;
  redFlagged: boolean;
}

export interface ExternalProspectSuppressionTombstone {
  dedupeHash: string;
  phoneHash?: string;
  city: string;
  reason:
    | "stopped"
    | "declined"
    | "blocked"
    | "deletion_requested"
    | "underage"
    | "red_flag"
    | "expired"
    | "no_show";
  suppressedAtMs: number;
  permanent: boolean;
}

export interface ExternalProspectCacheSnapshot {
  prospects: ExternalProspectRecord[];
  tombstones: ExternalProspectSuppressionTombstone[];
  personaLocks: Record<string, { personaId: string; gender: PersonaGender }>;
}

export interface ExternalSourcingTicket {
  id: string;
  city: string;
  app: "slop" | "friends";
  memberId: string;
  personaId: string;
  prospectDedupeHash?: string;
  state: ExternalSourcingState;
  offAppSmsOptedIn: boolean;
  venueId?: string;
  createdAtMs: number;
  updatedAtMs: number;
  closedReason?: string;
}

export interface KillSwitchFailoverResult {
  personaId: string;
  reason: string;
  preservedOffAppTicketIds: string[];
  failedOverOnAppTicketIds: string[];
  memberNotices: Array<{ ticketId: string; memberId: string; text: string }>;
}

export function appToCoreCode(app: AppId): number {
  if (app === "slop") return matchmakerAppSlop;
  if (app === "peon") return matchmakerAppPeon;
  if (app === "friends") return matchmakerAppFriends;
  return matchmakerAppNtwrk;
}

export function genderToCoreCode(gender: MemberGender): number {
  if (gender === "woman") return genderWoman;
  if (gender === "man") return genderMan;
  if (gender === "nonbinary") return genderNonbinary;
  return genderUnknown;
}

export function personaGenderToCoreCode(gender: PersonaGender | null | undefined): number {
  if (gender === "female") return matchmakerPersonaFemale;
  if (gender === "male") return matchmakerPersonaMale;
  return -1;
}

export function personaStatusToCoreCode(status: PersonaHealthStatus): number {
  if (status === "active") return personaStatusActive;
  if (status === "degraded") return personaStatusDegraded;
  return personaStatusSuspended;
}

export function consentStateToCoreCode(state: ExternalProspectConsentState): number {
  switch (state) {
    case "none":
      return prospectConsentNone;
    case "intro_single_only":
      return prospectConsentSingleOnly;
    case "intro_future_optin":
      return prospectConsentFutureOptin;
    case "sms_logistics_optin":
      return prospectConsentSmsLogistics;
    case "declined":
      return prospectConsentDeclined;
    case "stopped":
      return prospectConsentStopped;
    case "banned":
      return prospectConsentBanned;
  }
}

const URL_OR_BRAND_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(?:com|date|party|help|biz|app|io|co|net|org|me|gg|ai|xyz)\b/i,
  /\blu\.ma\b/i,
  /\bpartiful\b/i,
  /\blava\s*link\b/i,
  /\blinktr\.ee\b/i,
  /\bslop\.date\b/i,
  /\bntwrk\.party\b/i,
  /\bpeon\.biz\b/i,
  /\bfriends\.help\b/i,
  /\bthe\s+network\b/i,
  /\bdownload\s+(?:this|the|our|my)\s+app\b/i,
  /\bsign\s+up\s+(?:at|here|via|on)\b/i,
  /\breferral\s+code\b/i,
  /\bpromo\s+code\b/i,
  /\bcheck\s+out\s+my\s+link\b/i,
];

export function containsUrlOrBrandSpam(text: string): boolean {
  for (const re of URL_OR_BRAND_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

function makePersona(
  id: string,
  city: LaunchCity | string,
  cityLabel: string,
  gender: PersonaGender,
  firstName: string,
  tz: string,
  hubs: string[]
): MatchmakerPersona {
  return {
    id,
    city,
    gender,
    firstName,
    tz,
    hubs: [...hubs],
    verticals: ["slop", "friends"],
    humanOperated: true,
    bioDisclosure: `Local matchmaker & small-group host in ${cityLabel} (not dating here myself — setting up real offline intros).`,
    status: "active",
    dailyOutboundCap: 10,
    dailyOutboundCount: 0,
    rollingChatsCount: 0,
    rollingUnmatchesCount: 0,
  };
}

function defaultLaunchCityPairs(): CityMatchmakerPair[] {
  return [
    {
      city: "sf",
      female: makePersona("sf-f", "sf", "SF", "female", "Maya", "America/Los_Angeles", [
        "Hayes Valley",
        "Mission",
        "SoMa",
        "North Beach",
      ]),
      male: makePersona("sf-m", "sf", "SF", "male", "Devon", "America/Los_Angeles", [
        "Hayes Valley",
        "Mission",
        "SoMa",
        "North Beach",
      ]),
    },
    {
      city: "nyc",
      female: makePersona("nyc-f", "nyc", "NYC", "female", "Clara", "America/New_York", [
        "Flatiron",
        "West Village",
        "East Village",
        "Williamsburg",
      ]),
      male: makePersona("nyc-m", "nyc", "NYC", "male", "Julian", "America/New_York", [
        "Flatiron",
        "West Village",
        "East Village",
        "Williamsburg",
      ]),
    },
    {
      city: "la",
      female: makePersona("la-f", "la", "LA", "female", "Elena", "America/Los_Angeles", [
        "Arts District",
        "Culver City",
        "Silver Lake",
        "West Hollywood",
      ]),
      male: makePersona("la-m", "la", "LA", "male", "Marcus", "America/Los_Angeles", [
        "Arts District",
        "Culver City",
        "Silver Lake",
        "West Hollywood",
      ]),
    },
    {
      city: "chicago",
      female: makePersona("chi-f", "chicago", "Chicago", "female", "Nora", "America/Chicago", [
        "West Loop",
        "Fulton Market",
        "Loop",
        "Wicker Park",
      ]),
      male: makePersona("chi-m", "chicago", "Chicago", "male", "Sam", "America/Chicago", [
        "West Loop",
        "Fulton Market",
        "Loop",
        "Wicker Park",
      ]),
    },
    {
      city: "miami",
      female: makePersona("mia-f", "miami", "Miami", "female", "Sofia", "America/New_York", [
        "Brickell",
        "Wynwood",
        "Coral Gables",
      ]),
      male: makePersona("mia-m", "miami", "Miami", "male", "Mateo", "America/New_York", [
        "Brickell",
        "Wynwood",
        "Coral Gables",
      ]),
    },
  ];
}

function deterministicBit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) & 1;
}

export class CityMatchmakerRegistry {
  private readonly pairs = new Map<string, CityMatchmakerPair>();
  private readonly byId = new Map<string, MatchmakerPersona>();

  constructor(initialPairs: CityMatchmakerPair[] = defaultLaunchCityPairs()) {
    for (const pair of initialPairs) {
      this.registerCityMatchmakers(pair.city, pair.female, pair.male);
    }
  }

  registerCityMatchmakers(city: string, female: MatchmakerPersona, male: MatchmakerPersona): void {
    if (female.gender !== "female" || male.gender !== "male") {
      throw new Error(`City ${city} must register one female and one male matchmaker persona`);
    }
    if (containsUrlOrBrandSpam(female.bioDisclosure) || containsUrlOrBrandSpam(male.bioDisclosure)) {
      throw new Error(`Matchmaker bio for ${city} must never contain URLs or brand spam`);
    }
    const key = city.trim().toLowerCase();
    const pair: CityMatchmakerPair = {
      city: key,
      female: { ...female, city: key },
      male: { ...male, city: key },
    };
    this.pairs.set(key, pair);
    this.byId.set(pair.female.id, pair.female);
    this.byId.set(pair.male.id, pair.male);
  }

  getCityMatchmakers(city: string): CityMatchmakerPair | undefined {
    return this.pairs.get(city.trim().toLowerCase());
  }

  getPersonaById(personaId: string): MatchmakerPersona | undefined {
    return this.byId.get(personaId);
  }

  listAllMatchmakers(): MatchmakerPersona[] {
    return [...this.byId.values()];
  }

  selectPersona(params: {
    city: LaunchCity | string;
    app: "slop" | "friends";
    memberGender: MemberGender;
    targetProspectGender: MemberGender;
    existingLockGender?: PersonaGender | null;
    tieBreakSeed: string;
  }): MatchmakerPersona | undefined {
    const pair = this.getCityMatchmakers(params.city);
    if (!pair) return undefined;
    const input: RouteMatchmakerPersonaInput = {
      appCode: appToCoreCode(params.app),
      memberGender: genderToCoreCode(params.memberGender),
      targetProspectGender: genderToCoreCode(params.targetProspectGender),
      existingLockPersona: personaGenderToCoreCode(params.existingLockGender),
      tieBreakBit: deterministicBit(params.tieBreakSeed),
    };
    const code = routeMatchmakerPersona(input);
    return code === matchmakerPersonaFemale ? pair.female : pair.male;
  }

  recordChatOutcome(personaId: string, unmatched: boolean): MatchmakerPersona | undefined {
    const persona = this.byId.get(personaId);
    if (!persona) return undefined;
    persona.rollingChatsCount += 1;
    if (unmatched) persona.rollingUnmatchesCount += 1;
    if (persona.rollingChatsCount >= 15) {
      const ratePct = Math.round((persona.rollingUnmatchesCount * 100) / persona.rollingChatsCount);
      if (ratePct > 30) {
        persona.dailyOutboundCap = Math.max(2, Math.floor(persona.dailyOutboundCap / 2));
        if (persona.status === "active") persona.status = "degraded";
      }
    }
    return persona;
  }

  suspendPersona(personaId: string, reason: string): MatchmakerPersona | undefined {
    const persona = this.byId.get(personaId);
    if (!persona) return undefined;
    persona.status = "suspended";
    persona.suspendedReason = reason;
    return persona;
  }
}

export const DEFAULT_MATCHMAKER_REGISTRY = new CityMatchmakerRegistry();

export function registerCityMatchmakers(
  city: string,
  female: MatchmakerPersona,
  male: MatchmakerPersona
): void {
  DEFAULT_MATCHMAKER_REGISTRY.registerCityMatchmakers(city, female, male);
}

export function evaluateExternalSourcingTrigger(input: ExternalSourcingTriggerInput): boolean {
  return shouldTriggerExternalSourcing(input);
}

export function evaluateContactExternalProspect(
  input: Omit<ContactExternalProspectInput, "containsUrlOrBrandSpam"> & { draftText: string }
): boolean {
  return canContactExternalProspect({
    ...input,
    containsUrlOrBrandSpam: containsUrlOrBrandSpam(input.draftText),
  });
}

export function evaluateReconsiderExternalProspect(input: ReconsiderExternalProspectInput): boolean {
  return canReconsiderExternalProspect(input);
}

export function evaluateInviteExternalProspect(input: InviteExternalProspectInput): boolean {
  return canInviteExternalProspectToNetwork(input);
}

export function isAppAllowedToReadExternalProspects(app: AppId): boolean {
  return canReadExternalProspectInApp(appToCoreCode(app));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT_ENCODER = new TextEncoder();

const ALLOWED_FACET_EXACT = new Set([
  "interest",
  "activity",
  "non_drinker",
  "strict_sober",
  "alcohol_optional",
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten_free",
  "severe_allergen",
  "wheelchair",
  "low_walking",
  "smoke_free",
  "low_noise",
  "daytime_only",
  "women_only",
  "all_ages",
  "wants_kids",
  "wantskids",
  "religion",
  "politics",
  "drinking",
  "smoking",
]);

const ALLOWED_FACET_PREFIXES = [
  "slop:goal:",
  "slop:dealbreaker:",
  "slop:free:",
  "slop:wants_kids:",
  "slop:religion:",
  "slop:politics:",
  "slop:drinking:",
  "slop:smoking:",
];

const FORBIDDEN_FACET_PATTERN =
  /(raw_html|html_dump|photo_url|photo_base64|clef|appearance_score|race|ethnicity|health_diagnosis|income|ssn|last_name|employer|ig_handle|instagram|transcript)/i;

export function sanitizeProspectFacets(
  raw: Record<string, unknown>
): Record<string, string | boolean> {
  const clean: Record<string, string | boolean> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= 30) break;
    const key = k.trim().toLowerCase();
    if (!key || FORBIDDEN_FACET_PATTERN.test(key)) continue;
    const allowed =
      ALLOWED_FACET_EXACT.has(key) ||
      ALLOWED_FACET_PREFIXES.some(prefix => key.startsWith(prefix));
    if (!allowed) continue;
    if (typeof v === "boolean") {
      clean[key] = v;
      count++;
    } else if (typeof v === "string") {
      const val = v.trim().slice(0, 120);
      if (val && !FORBIDDEN_FACET_PATTERN.test(val) && !containsUrlOrBrandSpam(val)) {
        clean[key] = val;
        count++;
      }
    }
  }
  return clean;
}

export async function computeProspectHmacHash(hmacSecret: string, normalizedValue: string): Promise<string> {
  if (!hmacSecret || hmacSecret.length < 16) {
    throw new Error("Prospect HMAC secret must be at least 16 characters");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const canonical = normalizedValue.trim().toLowerCase();
  const sig = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(canonical));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface UpsertExternalProspectInput {
  id: string;
  city: LaunchCity | string;
  sourcePlatform: ExternalProspectPlatform;
  assignedPersona: MatchmakerPersona;
  platformHandleKey: string;
  phoneE164?: string;
  firstName: string;
  statedAge: number;
  gender: MemberGender;
  seeks: MemberGender[];
  neighborhood: string;
  rawFacets: Record<string, unknown>;
  consentState: ExternalProspectConsentState;
  nowMs: number;
}

export class ExternalProspectCache {
  private readonly prospects = new Map<string, ExternalProspectRecord>();
  private readonly tombstones = new Map<string, ExternalProspectSuppressionTombstone>();
  private readonly phoneTombstones = new Map<string, ExternalProspectSuppressionTombstone>();
  private readonly personaLocks = new Map<string, { personaId: string; gender: PersonaGender }>();

  private readonly hmacSecret: string;

  constructor(hmacSecret: string) {
    if (!hmacSecret || hmacSecret.length < 16) {
      throw new Error("ExternalProspectCache requires an HMAC secret of at least 16 characters");
    }
    this.hmacSecret = hmacSecret;
  }

  static fromSnapshot(snapshot: ExternalProspectCacheSnapshot, hmacSecret: string): ExternalProspectCache {
    const cache = new ExternalProspectCache(hmacSecret);
    for (const p of snapshot.prospects) {
      cache.prospects.set(p.dedupeHash, { ...p, facets: sanitizeProspectFacets(p.facets) });
    }
    for (const t of snapshot.tombstones) {
      cache.tombstones.set(t.dedupeHash, { ...t });
      if (t.phoneHash) cache.phoneTombstones.set(t.phoneHash, { ...t });
    }
    for (const [k, v] of Object.entries(snapshot.personaLocks)) {
      cache.personaLocks.set(k, { ...v });
    }
    return cache;
  }

  exportSnapshot(): ExternalProspectCacheSnapshot {
    return {
      prospects: [...this.prospects.values()].map(p => ({ ...p, facets: { ...p.facets } })),
      tombstones: [...this.tombstones.values()].map(t => ({ ...t })),
      personaLocks: Object.fromEntries([...this.personaLocks.entries()].map(([k, v]) => [k, { ...v }])),
    };
  }

  private lockKey(city: string, dedupeHash: string): string {
    return `${city.trim().toLowerCase()}:${dedupeHash}`;
  }

  getPersonaLock(city: string, dedupeHash: string): { personaId: string; gender: PersonaGender } | undefined {
    return this.personaLocks.get(this.lockKey(city, dedupeHash));
  }

  isSuppressed(dedupeHash: string, phoneHash?: string): boolean {
    if (this.tombstones.has(dedupeHash)) return true;
    if (phoneHash && this.phoneTombstones.has(phoneHash)) return true;
    return false;
  }

  getForApp(app: AppId, dedupeHash: string): ExternalProspectRecord | undefined {
    if (!canReadExternalProspectInApp(appToCoreCode(app))) return undefined;
    return this.prospects.get(dedupeHash);
  }

  async upsertProspect(
    input: UpsertExternalProspectInput
  ): Promise<{ ok: true; record: ExternalProspectRecord } | { ok: false; reason: string; dedupeHash: string }> {
    const city = input.city.trim().toLowerCase();
    const dedupeHash = await computeProspectHmacHash(
      this.hmacSecret,
      `${input.sourcePlatform}:${input.platformHandleKey}`
    );
    const phoneHash = input.phoneE164
      ? await computeProspectHmacHash(this.hmacSecret, input.phoneE164.replace(/\s+/g, ""))
      : undefined;

    if (!Number.isInteger(input.statedAge) || !canBeMatched(input.statedAge)) {
      if (input.statedAge < ADULT_AGE) {
        this.writeTombstone(dedupeHash, phoneHash, city, "underage", input.nowMs, true);
      }
      return { ok: false, reason: "underage_or_invalid_age", dedupeHash };
    }

    if (this.isSuppressed(dedupeHash, phoneHash)) {
      return { ok: false, reason: "suppressed", dedupeHash };
    }

    const lKey = this.lockKey(city, dedupeHash);
    const existingLock = this.personaLocks.get(lKey);
    if (existingLock && existingLock.personaId !== input.assignedPersona.id) {
      return { ok: false, reason: "persona_lock_conflict", dedupeHash };
    }

    const existing = this.prospects.get(dedupeHash);
    const lowestAge = existing ? Math.min(existing.statedAge, input.statedAge) : input.statedAge;
    if (isMinor(lowestAge)) {
      this.purgeWithSuppression(dedupeHash, "underage", input.nowMs, true);
      return { ok: false, reason: "underage_detected", dedupeHash };
    }

    const maxTtlDays =
      input.consentState === "intro_future_optin"
        ? 60
        : input.consentState === "none"
          ? 14
          : 30;
    const record: ExternalProspectRecord = {
      id: existing?.id ?? input.id,
      city,
      sourcePlatform: input.sourcePlatform,
      assignedPersonaId: input.assignedPersona.id,
      assignedPersonaGender: input.assignedPersona.gender,
      dedupeHash,
      phoneHash: phoneHash ?? existing?.phoneHash,
      firstName: input.firstName.trim().split(/\s+/)[0] ?? "",
      statedAge: lowestAge,
      gender: input.gender,
      seeks: [...input.seeks],
      neighborhood: input.neighborhood.trim().slice(0, 80),
      facets: sanitizeProspectFacets(input.rawFacets),
      consentState: input.consentState,
      consentAtMs: input.consentState === "none" ? existing?.consentAtMs : input.nowMs,
      createdAtMs: existing?.createdAtMs ?? input.nowMs,
      lastContactAtMs: input.nowMs,
      expiresAtMs: input.nowMs + maxTtlDays * DAY_MS,
      recontactCount: existing?.recontactCount ?? 0,
      inviteAttempts: existing?.inviteAttempts ?? 0,
      convertedMemberId: existing?.convertedMemberId,
      held: existing?.held ?? false,
      redFlagged: existing?.redFlagged ?? false,
    };

    const retention = this.evaluateRetention(record, input.nowMs, {});
    if (retention === "purge_with_suppression") {
      this.purgeWithSuppression(dedupeHash, "stopped", input.nowMs, true);
      return { ok: false, reason: "purged_by_retention_policy", dedupeHash };
    }

    this.personaLocks.set(lKey, {
      personaId: input.assignedPersona.id,
      gender: input.assignedPersona.gender,
    });
    this.prospects.set(dedupeHash, record);
    return { ok: true, record };
  }

  evaluateRetention(
    record: ExternalProspectRecord,
    nowMs: number,
    signals: {
      stopped?: boolean;
      declined?: boolean;
      blocked?: boolean;
      deletionRequested?: boolean;
      underageDetected?: boolean;
      redFlagged?: boolean;
    }
  ): "keep" | "purge_with_suppression" {
    const maxTtlDays = record.consentState === "intro_future_optin" ? 60 : 30;
    const cacheAgeDays = Math.floor((nowMs - record.createdAtMs) / DAY_MS);
    const input: ProspectRetentionInput = {
      stopped: Boolean(signals.stopped) || record.consentState === "stopped",
      declined: Boolean(signals.declined) || record.consentState === "declined",
      blocked: Boolean(signals.blocked) || record.consentState === "banned",
      deletionRequested: Boolean(signals.deletionRequested),
      underageDetected: Boolean(signals.underageDetected) || isMinor(record.statedAge),
      redFlagged: Boolean(signals.redFlagged) || record.redFlagged,
      expired: nowMs > record.expiresAtMs,
      cacheAgeDays,
      maxTtlDays,
    };
    return prospectRetentionDecision(input) as "keep" | "purge_with_suppression";
  }

  purgeWithSuppression(
    dedupeHash: string,
    reason: ExternalProspectSuppressionTombstone["reason"],
    nowMs: number,
    permanent = true
  ): ExternalProspectSuppressionTombstone | undefined {
    const existing = this.prospects.get(dedupeHash);
    this.prospects.delete(dedupeHash);
    const city = existing?.city ?? "unknown";
    return this.writeTombstone(dedupeHash, existing?.phoneHash, city, reason, nowMs, permanent);
  }

  sweepExpired(nowMs: number): string[] {
    const purged: string[] = [];
    for (const [dedupeHash, record] of [...this.prospects.entries()]) {
      if (this.evaluateRetention(record, nowMs, {}) === "purge_with_suppression") {
        this.purgeWithSuppression(dedupeHash, "expired", nowMs, false);
        purged.push(dedupeHash);
      }
    }
    return purged;
  }

  private writeTombstone(
    dedupeHash: string,
    phoneHash: string | undefined,
    city: string,
    reason: ExternalProspectSuppressionTombstone["reason"],
    nowMs: number,
    permanent: boolean
  ): ExternalProspectSuppressionTombstone {
    const tombstone: ExternalProspectSuppressionTombstone = {
      dedupeHash,
      phoneHash,
      city,
      reason,
      suppressedAtMs: nowMs,
      permanent,
    };
    this.tombstones.set(dedupeHash, tombstone);
    if (phoneHash) this.phoneTombstones.set(phoneHash, tombstone);
    return tombstone;
  }
}

const ALLOWED_SOURCING_TRANSITIONS: Record<ExternalSourcingState, ExternalSourcingState[]> = {
  member_sparse: ["brief_review", "closed"],
  brief_review: ["scouting", "closed"],
  scouting: ["prospect_qualifying", "closed"],
  prospect_qualifying: ["prospect_soft_yes", "closed"],
  prospect_soft_yes: ["pair_review_desk", "closed"],
  pair_review_desk: ["member_probed", "closed"],
  member_probed: ["member_yes", "closed"],
  member_yes: ["prospect_sms_optin", "closed"],
  prospect_sms_optin: ["venue_verified_booked", "closed"],
  venue_verified_booked: ["pre_brief", "closed"],
  pre_brief: ["active_arrival", "closed"],
  active_arrival: ["completed", "closed"],
  completed: ["member_followup", "closed"],
  member_followup: ["quality_gate", "closed"],
  quality_gate: ["warm_invite", "closed"],
  warm_invite: ["closed"],
  closed: [],
};

const OFF_APP_PRESERVED_STATES = new Set<ExternalSourcingState>([
  "prospect_sms_optin",
  "venue_verified_booked",
  "pre_brief",
  "active_arrival",
  "completed",
  "member_followup",
  "quality_gate",
  "warm_invite",
]);

export function transitionSourcingTicket(
  ticket: ExternalSourcingTicket,
  nextState: ExternalSourcingState,
  nowMs: number,
  options: {
    inviteGateInput?: InviteExternalProspectInput;
    closedReason?: string;
    venueId?: string;
    prospectDedupeHash?: string;
  } = {}
): { ok: true; ticket: ExternalSourcingTicket } | { ok: false; reason: string } {
  const allowed = ALLOWED_SOURCING_TRANSITIONS[ticket.state];
  if (!allowed.includes(nextState)) {
    return { ok: false, reason: `invalid_transition:${ticket.state}->${nextState}` };
  }
  if (nextState === "warm_invite") {
    if (!options.inviteGateInput || !canInviteExternalProspectToNetwork(options.inviteGateInput)) {
      return { ok: false, reason: "quality_gate_failed" };
    }
  }
  const updated: ExternalSourcingTicket = {
    ...ticket,
    state: nextState,
    updatedAtMs: nowMs,
    offAppSmsOptedIn: ticket.offAppSmsOptedIn || nextState === "prospect_sms_optin",
    venueId: options.venueId ?? ticket.venueId,
    prospectDedupeHash: options.prospectDedupeHash ?? ticket.prospectDedupeHash,
    closedReason: nextState === "closed" ? options.closedReason ?? "closed" : ticket.closedReason,
  };
  return { ok: true, ticket: updated };
}

export function triggerPersonaKillSwitch(
  registry: CityMatchmakerRegistry,
  personaId: string,
  tickets: ExternalSourcingTicket[],
  reason: string,
  nowMs: number
): KillSwitchFailoverResult {
  registry.suspendPersona(personaId, reason);
  const preservedOffAppTicketIds: string[] = [];
  const failedOverOnAppTicketIds: string[] = [];
  const memberNotices: Array<{ ticketId: string; memberId: string; text: string }> = [];

  for (const ticket of tickets) {
    if (ticket.personaId !== personaId || ticket.state === "closed") continue;
    if (ticket.offAppSmsOptedIn || OFF_APP_PRESERVED_STATES.has(ticket.state)) {
      preservedOffAppTicketIds.push(ticket.id);
      continue;
    }
    const wasMemberProbed = ticket.state === "member_probed" || ticket.state === "member_yes";
    ticket.state = "closed";
    ticket.closedReason = `persona_suspended_tier1_failover:${reason}`;
    ticket.updatedAtMs = nowMs;
    failedOverOnAppTicketIds.push(ticket.id);
    if (wasMemberProbed) {
      memberNotices.push({
        ticketId: ticket.id,
        memberId: ticket.memberId,
        text: buildKillSwitchFailoverNoticeScript(),
      });
    }
  }

  return {
    personaId,
    reason,
    preservedOffAppTicketIds,
    failedOverOnAppTicketIds,
    memberNotices,
  };
}

export function buildDatingOpenerScript(params: {
  prospectFirstName: string;
  cityName: string;
  promptDetail?: string;
  isReplyFollowup?: boolean;
}): string {
  const name = params.prospectFirstName.trim().split(/\s+/)[0] || "there";
  if (params.isReplyFollowup) {
    return `haha fair — full disclosure i'm actually playing matchmaker in ${params.cityName} right now, not looking for myself. well i've got someone great i'd love to connect you with if you're interested, do you mind if i set it up?`;
  }
  const detail = params.promptDetail?.trim() || "your profile";
  return `hey ${name} — quick heads up so i'm not wasting your time: i'm actually a local matchmaker here in ${params.cityName} (not dating on here myself). saw your prompt about ${detail} and i've got someone great i'd love to connect you with if you're interested, do you mind if i set it up?`;
}

export function buildFriendsMeetupOpenerScript(params: {
  prospectFirstName: string;
  hobbyOrNeighborhood: string;
  activity: string;
  neighborhood: string;
  dayLabel: string;
  timeLabel: string;
}): string {
  const name = params.prospectFirstName.trim().split(/\s+/)[0] || "there";
  return `hey ${name} — saw you're into ${params.hobbyOrNeighborhood}. i organize small 4-5 person ${params.activity} hangs in ${params.neighborhood} for folks new-ish or looking to expand their circle (totally platonic). doing one ${params.dayLabel} around ${params.timeLabel} — want me to save you a spot?`;
}

export function buildQualificationAgeRedLineScript(): string {
  return "awesome. quick sanity check so i don't waste your evening — confirming you're 18+, and are there any hard dealbreakers i should know (drinking/sober, smoking, dietary, what you're looking for)?";
}

export function buildAnonymizedMemberPitchScript(params: {
  pronounSubject: "she's" | "he's" | "they're";
  ageBand: string;
  neighborhood: string;
  interests: string;
  goal: string;
  activity: string;
}): string {
  return `${params.pronounSubject} in ${params.ageBand}, lives near ${params.neighborhood}, super into ${params.interests}, and looking for ${params.goal}. sound like someone you'd want to grab ${params.activity} with?`;
}

export function buildSmsOptInScript(memberPronoun: "she's" | "he's" | "they're"): string {
  return `great — if ${memberPronoun} a yes too, i coordinate the spot and day-of check-in over text so neither of you has to share numbers until you meet. what's the best cell number to text you logistics, and are you cool getting texts from me to set this up? (you can text STOP anytime)`;
}

export function buildMemberExpectationScript(cityName: string): string {
  return `Quick heads up: our local ${cityName} circle is still a bit light for your exact criteria, so I'm having our ${cityName} matchmaker scout outside the network for you. Same rules — I'll vet them against your dealbreakers first and only text you if I find someone solid. Cool if I look?`;
}

export function buildMemberExternalProbeScript(params: {
  activity: string;
  neighborhood: string;
  timeOptions: string;
  ageBand: string;
  distancePhrase: string;
  shareableInterest: string;
}): string {
  return `Found someone great outside our current circle for a first date: ${params.activity} in ${params.neighborhood}, ${params.timeOptions}. They're ${params.ageBand}, ${params.distancePhrase}, and into ${params.shareableInterest}. Want me to lock it in? I'll only share first names and the exact spot if you're both a yes — tell me which time works, or no.`;
}

export function buildBotScamSkepticismScript(personaFirstName: string, cityName: string): string {
  return `totally fair to ask — nope, not a bot, not selling anything, no links, nothing to sign up for. i'm ${personaFirstName}, a real local matchmaker helping a friend/client in ${cityName} meet someone offline. if it sounds weird, no worries at all, i'll leave you be!`;
}

export function buildRomanticRedirectScript(): string {
  return "haha i appreciate that! i'm strictly playing matchmaker on here (off the market / just setting people up), not dating myself. totally cool if you're not into blind setups — just let me know.";
}

export function buildPhotoOrSocialRefusalScript(): string {
  return "i keep everyone's name, socials, and contact private until you're both a yes and actually meet — same goes for protecting your privacy too. you two can swap numbers or socials at the table if you click.";
}

export function buildGhostOrFlakeScripts(params: {
  dayLabel: string;
  prospectFirstName: string;
  memberFirstName: string;
  venueName: string;
}): {
  midSetupNudgeToProspect: string;
  midSetupUpdateToMember: string;
  dayOfT12PingToProspect: string;
  dayOfT18ReleaseToMember: string;
} {
  return {
    midSetupNudgeToProspect: `no rush — still down for ${params.dayLabel} or should i release the slot?`,
    midSetupUpdateToMember:
      "Scheduling didn't line up on their end — I'm already scouting the next person for you.",
    dayOfT12PingToProspect: `${params.memberFirstName} is at ${params.venueName} — still heading over?`,
    dayOfT18ReleaseToMember: `Haven't heard back from ${params.prospectFirstName} yet — feel free to grab a coffee or head out, no pressure.`,
  };
}

export function buildMemberDeclinedProspectScript(
  prospectFirstName: string,
  memberPossessive: "her" | "his" | "their"
): string {
  const name = prospectFirstName.trim().split(/\s+/)[0] || "there";
  return `hey ${name}, quick update — timing/logistics didn't end up lining up on ${memberPossessive} end this week, so we'll hold off on this one. appreciate you being open to it! want me to keep you in mind if someone else great comes up, or would you rather i not reach out again?`;
}

export function buildProspectDeclinedScripts(): {
  toProspect: string;
  toMemberIfAlreadyProbed: string;
} {
  return {
    toProspect: "totally get it, thanks for being upfront — have a great week!",
    toMemberIfAlreadyProbed: "Timing didn't work out on that one — keeping an eye out for the next fit.",
  };
}

export function buildUnderageOrRedFlagCloseScript(): {
  underageToProspect: string;
  genericCancelToMember: string;
} {
  return {
    underageToProspect:
      "Appreciate you saying that — I only set up intros for adults 18+, so I'll close this out. Take care!",
    genericCancelToMember:
      "Quick update: had to cancel that setup on my end — sorry for the change. I'll keep looking for your next match.",
  };
}

export function buildKillSwitchFailoverNoticeScript(): string {
  return "Lost touch with a lead before we locked a time — shifting to another channel to find someone for you.";
}

export function buildQualityGatedNetworkInviteScript(
  gateInput: InviteExternalProspectInput,
  params: {
    variant: "mutual_spark" | "vouched_not_romantic";
    memberFirstName: string;
    cityName: string;
  }
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!canInviteExternalProspectToNetwork(gateInput)) {
    return { ok: false, reason: "quality_gate_failed" };
  }
  const memberName = params.memberFirstName.trim().split(/\s+/)[0] || "your date";
  if (params.variant === "mutual_spark") {
    return {
      ok: true,
      text: `so glad you and ${memberName} hit it off! by the way, i run a small curated circle in ${params.cityName} (The Network / slop.date) where we set up vetted dates and small hangs like this without the swiping. since you're clearly one of the good ones, want an invite to join?`,
    };
  }
  return {
    ok: true,
    text: `glad you two had a good convo even if it wasn't a romantic match — ${memberName} actually had really nice things to say about you. i run a small vetted circle in ${params.cityName} for curated dates & low-key friend hangs. want me to add you so i can set you up with a better fit?`,
  };
}
