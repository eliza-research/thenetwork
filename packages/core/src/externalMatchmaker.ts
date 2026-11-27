import { detectExternalPromptInjection, parseAdult18PlusAnswer, type ParseAdult18PlusOptions } from "./externalEvents.ts";
import {
  canContactExternalProspect,
  canInviteExternalProspectToNetwork,
  canReadExternalProspectInApp,
  canReconsiderExternalProspect,
  effectivePersonaOutboundCap,
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
import { contactVariants, findContactKinds, textVariants } from "./guard.ts";
import { ADULT_AGE, canBeMatched, isMinor, relayMinorAge, relayMinorEstimate } from "./policy.ts";
import { parseOptOut, parseReply, type ReplyAnswer } from "./replies.ts";
import { clampSms, cleanPhrase, validateOutboundSms } from "./smsCopy.ts";
import type { AppId, CityId } from "./types.ts";

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
  suppressUntilMs?: number;
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
  updatedTickets: ExternalSourcingTicket[];
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

const EXTENDED_TLDS = "com|date|party|help|biz|app|io|co|net|org|me|gg|ai|xyz|ly|gy|gl|gd|ee|ma|to|us|uk|ca";
const SPELLED_OR_SPACED_EXTENDED_DOT = new RegExp(
  `(?<=[a-z0-9])(?:\\s{0,3}(?:\\[\\s{0,2}\\.\\s{0,2}\\]|\\(\\s{0,2}\\.\\s{0,2}\\)|\\{\\s{0,2}\\.\\s{0,2}\\}|<\\s{0,2}\\.\\s{0,2}>)\\s{0,3}|[\\s([{<]+(?:dot|punto)[\\s)\\]}>]+|\\s+\\.\\s*)(?=(?:${EXTENDED_TLDS})\\b)`,
  "g"
);

const URL_OR_BRAND_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  new RegExp(`\\b[a-z0-9-]+\\.(?:${EXTENDED_TLDS})\\b`, "i"),
  /\b(?:bit\.ly|tinyurl\.com|t\.co|rb\.gy|t\.me|goo\.gl|ow\.ly|is\.gd|buff\.ly|linktr\.ee|lu\.ma)\b/i,
  /\bpartiful\b/i,
  /\blava\s*link\b/i,
  /\bslop\s*\.\s*date\b/i,
  /\bntwrk\s*\.\s*party\b/i,
  /\bpeon\s*\.\s*biz\b/i,
  /\bfriends\s*\.\s*help\b/i,
  /\bthe\s+network\b/i,
  /\bdownload\s+(?:this|the|our|my)\s+app\b/i,
  /\bsign\s+up\s+(?:at|here|via|on)\b/i,
  /\breferral\s+code\b/i,
  /\bpromo\s+code\b/i,
  /\bcheck\s+out\s+my\s+link\b/i,
];

const URL_AND_HANDLE_KINDS: ReadonlySet<string> = new Set(["url", "handle"]);

export function containsUrlOrBrandSpam(text: string): boolean {
  if (!text) return false;
  if (findContactKinds(text, { kinds: URL_AND_HANDLE_KINDS }).length > 0) return true;
  const variants = new Set<string>();
  for (const v of contactVariants(text)) variants.add(v);
  for (const v of textVariants(text)) variants.add(v);
  for (const base of [...variants]) {
    SPELLED_OR_SPACED_EXTENDED_DOT.lastIndex = 0;
    const closed = base.replace(SPELLED_OR_SPACED_EXTENDED_DOT, ".");
    variants.add(closed);
  }
  for (const v of variants) {
    for (const re of URL_OR_BRAND_PATTERNS) {
      if (re.test(v)) return true;
    }
  }
  return false;
}

function makePersona(
  id: string,
  city: CityId,
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

const ROLLING_OUTCOME_WINDOW = 20;

export class CityMatchmakerRegistry {
  private readonly pairs = new Map<string, CityMatchmakerPair>();
  private readonly byId = new Map<string, MatchmakerPersona>();
  private readonly recentOutcomes = new Map<string, boolean[]>();

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
    const prev = this.pairs.get(key);
    if (prev) {
      if (prev.female.id !== female.id) {
        this.byId.delete(prev.female.id);
        this.recentOutcomes.delete(prev.female.id);
      }
      if (prev.male.id !== male.id) {
        this.byId.delete(prev.male.id);
        this.recentOutcomes.delete(prev.male.id);
      }
    }
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

  effectiveOutboundCap(personaId: string): number {
    const persona = this.byId.get(personaId);
    if (!persona) return 0;
    return effectivePersonaOutboundCap(personaStatusToCoreCode(persona.status), persona.dailyOutboundCap);
  }

  selectPersona(params: {
    city: CityId;
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
    const window = this.recentOutcomes.get(personaId) ?? [];
    window.push(unmatched);
    if (window.length > ROLLING_OUTCOME_WINDOW) window.shift();
    this.recentOutcomes.set(personaId, window);

    persona.rollingChatsCount = window.length;
    persona.rollingUnmatchesCount = window.reduce((acc, u) => acc + (u ? 1 : 0), 0);
    if (persona.status !== "suspended" && persona.rollingChatsCount >= 15) {
      const ratePct = Math.round((persona.rollingUnmatchesCount * 100) / persona.rollingChatsCount);
      if (ratePct > 30) {
        persona.status = "degraded";
      } else if (persona.status === "degraded" && ratePct <= 20) {
        persona.status = "active";
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
  "vegetarian",
  "vegan",
  "halal",
  "kosher",
  "gluten_free",
  "wheelchair",
  "smoke_free",
  "low_noise",
  "daytime_only",
]);

const ALLOWED_FACET_PREFIXES = ["slop:goal:", "slop:dealbreaker:", "slop:free:"];

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
      if (
        val &&
        !FORBIDDEN_FACET_PATTERN.test(val) &&
        !containsUrlOrBrandSpam(val) &&
        detectExternalPromptInjection(val) === null
      ) {
        clean[key] = val;
        count++;
      }
    }
  }
  return clean;
}

const MAX_CACHED_PROSPECT_HMAC_KEYS = 32;
const prospectHmacKeyCache = new Map<string, Promise<CryptoKey>>();

function getCachedProspectHmacKey(hmacSecret: string): Promise<CryptoKey> {
  const cached = prospectHmacKeyCache.get(hmacSecret);
  if (cached) return cached;
  if (prospectHmacKeyCache.size >= MAX_CACHED_PROSPECT_HMAC_KEYS) {
    const oldest = prospectHmacKeyCache.keys().next().value;
    if (oldest !== undefined) prospectHmacKeyCache.delete(oldest);
  }
  const keyPromise = crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  prospectHmacKeyCache.set(hmacSecret, keyPromise);
  return keyPromise;
}

export async function computeProspectHmacHash(hmacSecret: string, normalizedValue: string): Promise<string> {
  if (!hmacSecret || hmacSecret.length < 16) {
    throw new Error("Prospect HMAC secret must be at least 16 characters");
  }
  const key = await getCachedProspectHmacKey(hmacSecret);
  const canonical = normalizedValue.trim().toLowerCase();
  const sig = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(canonical));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface UpsertExternalProspectInput {
  id: string;
  city: CityId;
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

const DEFAULT_MAX_CACHE_ENTRIES = 10_000;
const TTL_SUPPRESSION_COOLDOWN_MS = 30 * DAY_MS;

function consentStateToTombstoneReason(
  state: ExternalProspectConsentState
): ExternalProspectSuppressionTombstone["reason"] {
  if (state === "declined") return "declined";
  if (state === "banned") return "blocked";
  return "stopped";
}

export class ExternalProspectCache {
  private readonly prospects = new Map<string, ExternalProspectRecord>();
  private readonly tombstones = new Map<string, ExternalProspectSuppressionTombstone>();
  private readonly phoneTombstones = new Map<string, ExternalProspectSuppressionTombstone>();
  private readonly personaLocks = new Map<string, { personaId: string; gender: PersonaGender }>();

  private readonly hmacSecret: string;
  private readonly maxEntries: number;

  constructor(hmacSecret: string, opts: { maxEntries?: number } = {}) {
    if (!hmacSecret || hmacSecret.length < 16) {
      throw new Error("ExternalProspectCache requires an HMAC secret of at least 16 characters");
    }
    this.hmacSecret = hmacSecret;
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
  }

  static fromSnapshot(
    snapshot: ExternalProspectCacheSnapshot,
    hmacSecret: string,
    opts: { maxEntries?: number; nowMs?: number } = {}
  ): ExternalProspectCache {
    const cache = new ExternalProspectCache(hmacSecret, opts);
    // Load tombstones first so suppressed prospects in corrupted snapshots are never re-admitted.
    for (const t of snapshot.tombstones) {
      if (!t.dedupeHash) continue;
      if (!t.permanent && opts.nowMs !== undefined && t.suppressUntilMs !== undefined && opts.nowMs >= t.suppressUntilMs) {
        continue;
      }
      cache.tombstones.set(t.dedupeHash, { ...t });
      if (t.phoneHash) cache.phoneTombstones.set(t.phoneHash, { ...t });
    }
    for (const [k, v] of Object.entries(snapshot.personaLocks)) {
      cache.personaLocks.set(k, { ...v });
    }
    for (const p of snapshot.prospects) {
      if (!p.dedupeHash || !Number.isInteger(p.statedAge) || !canBeMatched(p.statedAge) || isMinor(p.statedAge)) {
        continue;
      }
      if (cache.isSuppressed(p.dedupeHash, p.phoneHash, opts.nowMs)) continue;
      if (p.consentState === "stopped" || p.consentState === "declined" || p.consentState === "banned") continue;
      if (opts.nowMs !== undefined && opts.nowMs > p.expiresAtMs) continue;
      cache.prospects.set(p.dedupeHash, { ...p, facets: sanitizeProspectFacets(p.facets) });
    }
    cache.enforceBounds();
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

  private isTombstoneActive(t: ExternalProspectSuppressionTombstone | undefined, nowMs?: number): boolean {
    if (!t) return false;
    if (t.permanent) return true;
    if (nowMs !== undefined && t.suppressUntilMs !== undefined && nowMs >= t.suppressUntilMs) {
      this.tombstones.delete(t.dedupeHash);
      if (t.phoneHash && this.phoneTombstones.get(t.phoneHash)?.dedupeHash === t.dedupeHash) {
        this.phoneTombstones.delete(t.phoneHash);
      }
      return false;
    }
    return true;
  }

  private enforceBounds(): void {
    while (this.prospects.size > this.maxEntries) {
      const oldest = this.prospects.keys().next().value;
      if (oldest === undefined) break;
      this.prospects.delete(oldest);
    }
    while (this.personaLocks.size > this.maxEntries) {
      const oldest = this.personaLocks.keys().next().value;
      if (oldest === undefined) break;
      this.personaLocks.delete(oldest);
    }
    if (this.tombstones.size > this.maxEntries) {
      // Evict non-permanent tombstones first before touching permanent suppressions.
      for (const [k, t] of this.tombstones) {
        if (this.tombstones.size <= this.maxEntries) break;
        if (!t.permanent) {
          this.tombstones.delete(k);
          if (t.phoneHash && this.phoneTombstones.get(t.phoneHash)?.dedupeHash === k) {
            this.phoneTombstones.delete(t.phoneHash);
          }
        }
      }
      while (this.tombstones.size > this.maxEntries) {
        const oldest = this.tombstones.keys().next().value;
        if (oldest === undefined) break;
        const t = this.tombstones.get(oldest);
        this.tombstones.delete(oldest);
        if (t?.phoneHash && this.phoneTombstones.get(t.phoneHash)?.dedupeHash === oldest) {
          this.phoneTombstones.delete(t.phoneHash);
        }
      }
    }
    while (this.phoneTombstones.size > this.maxEntries) {
      const oldest = this.phoneTombstones.keys().next().value;
      if (oldest === undefined) break;
      this.phoneTombstones.delete(oldest);
    }
  }

  getPersonaLock(city: string, dedupeHash: string): { personaId: string; gender: PersonaGender } | undefined {
    return this.personaLocks.get(this.lockKey(city, dedupeHash));
  }

  isSuppressed(dedupeHash: string, phoneHash?: string, nowMs?: number): boolean {
    if (this.isTombstoneActive(this.tombstones.get(dedupeHash), nowMs)) return true;
    if (phoneHash && this.isTombstoneActive(this.phoneTombstones.get(phoneHash), nowMs)) return true;
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

    const existing = this.prospects.get(dedupeHash);
    const effectivePhoneHash = phoneHash ?? existing?.phoneHash;

    if (this.isSuppressed(dedupeHash, effectivePhoneHash, input.nowMs)) {
      return { ok: false, reason: "suppressed", dedupeHash };
    }

    const lKey = this.lockKey(city, dedupeHash);
    const existingLock = this.personaLocks.get(lKey);
    if (existingLock && existingLock.personaId !== input.assignedPersona.id) {
      return { ok: false, reason: "persona_lock_conflict", dedupeHash };
    }

    const lowestAge = existing ? Math.min(existing.statedAge, input.statedAge) : input.statedAge;
    if (isMinor(lowestAge)) {
      this.purgeWithSuppression(dedupeHash, "underage", input.nowMs, true, { phoneHash: effectivePhoneHash, city });
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
      phoneHash: effectivePhoneHash,
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
      const reason = record.redFlagged ? "red_flag" : consentStateToTombstoneReason(record.consentState);
      this.purgeWithSuppression(dedupeHash, reason, input.nowMs, true, {
        phoneHash: record.phoneHash,
        city: record.city,
      });
      return { ok: false, reason: "purged_by_retention_policy", dedupeHash };
    }

    this.personaLocks.set(lKey, {
      personaId: input.assignedPersona.id,
      gender: input.assignedPersona.gender,
    });
    this.prospects.set(dedupeHash, record);
    this.enforceBounds();
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
    permanent = true,
    fallback?: { phoneHash?: string; city?: string }
  ): ExternalProspectSuppressionTombstone | undefined {
    const existing = this.prospects.get(dedupeHash);
    this.prospects.delete(dedupeHash);
    const city = existing?.city ?? fallback?.city ?? "unknown";
    const phoneHash = existing?.phoneHash ?? fallback?.phoneHash;
    return this.writeTombstone(dedupeHash, phoneHash, city, reason, nowMs, permanent);
  }

  sweepExpired(nowMs: number): string[] {
    const purged: string[] = [];
    for (const [dedupeHash, record] of this.prospects) {
      if (this.evaluateRetention(record, nowMs, {}) === "purge_with_suppression") {
        this.purgeWithSuppression(dedupeHash, "expired", nowMs, false);
        purged.push(dedupeHash);
      }
    }
    for (const [dedupeHash, tombstone] of this.tombstones) {
      if (!tombstone.permanent && tombstone.suppressUntilMs !== undefined && nowMs >= tombstone.suppressUntilMs) {
        this.tombstones.delete(dedupeHash);
        if (tombstone.phoneHash && this.phoneTombstones.get(tombstone.phoneHash)?.dedupeHash === dedupeHash) {
          this.phoneTombstones.delete(tombstone.phoneHash);
        }
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
      ...(permanent ? {} : { suppressUntilMs: nowMs + TTL_SUPPRESSION_COOLDOWN_MS }),
      permanent,
    };
    this.tombstones.set(dedupeHash, tombstone);
    if (phoneHash) this.phoneTombstones.set(phoneHash, tombstone);
    this.enforceBounds();
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
  tickets: readonly ExternalSourcingTicket[],
  reason: string,
  nowMs: number
): KillSwitchFailoverResult {
  registry.suspendPersona(personaId, reason);
  const preservedOffAppTicketIds: string[] = [];
  const failedOverOnAppTicketIds: string[] = [];
  const memberNotices: Array<{ ticketId: string; memberId: string; text: string }> = [];
  const updatedTickets: ExternalSourcingTicket[] = [];

  for (const ticket of tickets) {
    if (ticket.personaId !== personaId || ticket.state === "closed") {
      updatedTickets.push({ ...ticket });
      continue;
    }
    if (ticket.offAppSmsOptedIn || OFF_APP_PRESERVED_STATES.has(ticket.state)) {
      preservedOffAppTicketIds.push(ticket.id);
      updatedTickets.push({ ...ticket });
      continue;
    }
    const wasMemberProbed = ticket.state === "member_probed" || ticket.state === "member_yes";
    updatedTickets.push({
      ...ticket,
      state: "closed",
      closedReason: `persona_suspended_tier1_failover:${reason}`,
      updatedAtMs: nowMs,
    });
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
    updatedTickets,
  };
}

/** Validate any outbound matchmaker script against SMS style rules, LeakGuard, and optional on-app spam checks. */
export function validateMatchmakerOutboundScript(
  text: string,
  opts: { onApp?: boolean; firstContact?: boolean; contactAllow?: readonly string[]; forbidden?: string[]; facts?: string[] } = {}
): string[] {
  const issues = validateOutboundSms(text, {
    firstContact: opts.firstContact,
    contactAllow: opts.contactAllow,
    forbidden: opts.forbidden,
    facts: opts.facts,
  });
  if (opts.onApp && containsUrlOrBrandSpam(text)) {
    issues.push("url_or_brand_spam");
  }
  return issues;
}

export type MatchmakerTone = "standard" | "casual";
export type PronounSubject = "she's" | "he's" | "they're";

export function possessiveFor(pronounSubject: PronounSubject): "her" | "his" | "their" {
  if (pronounSubject === "she's") return "her";
  if (pronounSubject === "he's") return "his";
  return "their";
}

function capitalizeSubject(pronounSubject: PronounSubject, tone: MatchmakerTone): string {
  if (tone === "casual") return pronounSubject;
  return pronounSubject[0]!.toUpperCase() + pronounSubject.slice(1);
}

function formatAgeBandPhrase(pronounSubject: PronounSubject, rawAgeBand: string): string {
  const band = cleanPhrase(rawAgeBand);
  if (!band) return "";
  if (/^(?:in\s+|aged\s+)/i.test(band)) return band;
  if (/^\d{2}\s*[-–]\s*\d{2}$/.test(band)) return `aged ${band}`;
  if (/^(?:(?:early|mid|late)\s+)?\d{2}s$/i.test(band)) {
    return `in ${possessiveFor(pronounSubject)} ${band}`;
  }
  return band;
}

export type ExternalProspectIntent =
  | "stop"
  | "underage"
  | "injection"
  | "skepticism"
  | "romantic_redirect"
  | "photo_or_social_ask"
  | "accept"
  | "decline"
  | "counter"
  | "unclear";

export interface ExternalProspectReplyReading {
  intent: ExternalProspectIntent;
  answer: ReplyAnswer;
  optOut: boolean;
  underage: boolean;
  confirmedAdult18Plus: boolean;
  injectionLabel: string | null;
  phoneE164?: string;
  counter: boolean;
  reason: string;
}

const PROSPECT_UNDERAGE_RE =
  /\b(?:under\s*18|underage|not\s+(?:yet\s+)?18|turning\s*18|almost\s*18|high\s+school|middle\s+school|soy\s+menor|menor\s+de\s+edad|tengo\s+(?:1[0-7]|[1-9])(?:\s*a[nñ]os?)?|(?:\b(?:1[0-7]|[1-9])\s*(?:y\/?o|y(?:ears?|rs?)[\s-]*old)))\b/i;
const PROSPECT_SKEPTICISM_RE =
  /\b(?:are\s+you\s+(?:a\s+)?(?:bot|ai|real|human|scam(?:mer)?)|is\s+this\s+(?:a\s+)?(?:bot|ai|scam|fake|spam|real)|you\s+(?:a\s+)?(?:bot|scam(?:mer)?|catfish)|sounds?\s+(?:like\s+a\s+)?(?:scam|fake|sketchy|spam)|selling\s+something|what'?s\s+the\s+catch)\b/i;
const PROSPECT_PHOTO_OR_SOCIAL_RE =
  /\b(?:send\s+(?:a\s+)?(?:pic|pics|photo|photos|picture|selfie)|see\s+(?:a\s+)?(?:pic|photo|picture)|what\s+(?:does|do)\s+(?:he|she|they)\s+look\s+like|instagram|insta\b|\big\b|snapchat|linkedin|socials?|last\s+name|full\s+name|their\s+(?:number|phone)|(?:his|her)\s+(?:number|phone))\b/i;
const PROSPECT_ROMANTIC_REDIRECT_RE =
  /\b(?:what\s+about\s+you|rather\s+(?:date|meet|go\s+out\s+with)\s+you|take\s+you\s+out|are\s+you\s+single|date\s+you\s+instead|just\s+you\s+and\s+me)\b/i;
const PROSPECT_PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/;

function extractUsPhoneE164(text: string): string | undefined {
  const m = PROSPECT_PHONE_RE.exec(text);
  if (!m) return undefined;
  return `+1${m[1]}${m[2]}${m[3]}`;
}

/** Parse a free-text reply from an external dating/friends prospect with fail-closed safety priority. */
export function parseExternalProspectReply(
  text: string,
  opts: ParseAdult18PlusOptions = {}
): ExternalProspectReplyReading {
  const raw = (text ?? "").trim();
  const injectionLabel = detectExternalPromptInjection(raw);
  if (injectionLabel) {
    return {
      intent: "injection",
      answer: "unsure",
      optOut: false,
      underage: false,
      confirmedAdult18Plus: false,
      injectionLabel,
      counter: false,
      reason: `injection:${injectionLabel}`,
    };
  }

  const optOut = parseOptOut(raw).match !== "none";
  if (optOut) {
    return {
      intent: "stop",
      answer: "no",
      optOut: true,
      underage: false,
      confirmedAdult18Plus: false,
      injectionLabel: null,
      counter: false,
      reason: "opt_out",
    };
  }

  const underage =
    relayMinorAge(raw, true) !== undefined ||
    relayMinorEstimate(raw) ||
    PROSPECT_UNDERAGE_RE.test(raw);
  if (underage) {
    return {
      intent: "underage",
      answer: "no",
      optOut: false,
      underage: true,
      confirmedAdult18Plus: false,
      injectionLabel: null,
      counter: false,
      reason: "underage",
    };
  }

  const confirmedAdult18Plus = parseAdult18PlusAnswer(raw, opts);
  const phoneE164 = extractUsPhoneE164(raw);
  const reply = parseReply(raw);

  if (PROSPECT_SKEPTICISM_RE.test(raw)) {
    return {
      intent: "skepticism",
      answer: reply.answer,
      optOut: false,
      underage: false,
      confirmedAdult18Plus,
      injectionLabel: null,
      ...(phoneE164 ? { phoneE164 } : {}),
      counter: reply.counter,
      reason: "skepticism",
    };
  }

  if (PROSPECT_PHOTO_OR_SOCIAL_RE.test(raw)) {
    return {
      intent: "photo_or_social_ask",
      answer: reply.answer,
      optOut: false,
      underage: false,
      confirmedAdult18Plus,
      injectionLabel: null,
      ...(phoneE164 ? { phoneE164 } : {}),
      counter: reply.counter,
      reason: "photo_or_social_ask",
    };
  }

  if (PROSPECT_ROMANTIC_REDIRECT_RE.test(raw)) {
    return {
      intent: "romantic_redirect",
      answer: reply.answer,
      optOut: false,
      underage: false,
      confirmedAdult18Plus,
      injectionLabel: null,
      ...(phoneE164 ? { phoneE164 } : {}),
      counter: reply.counter,
      reason: "romantic_redirect",
    };
  }

  if (reply.answer === "no") {
    return {
      intent: "decline",
      answer: "no",
      optOut: false,
      underage: false,
      confirmedAdult18Plus: false,
      injectionLabel: null,
      counter: reply.counter,
      reason: reply.reason,
    };
  }

  if (reply.counter) {
    return {
      intent: "counter",
      answer: reply.answer,
      optOut: false,
      underage: false,
      confirmedAdult18Plus,
      injectionLabel: null,
      ...(phoneE164 ? { phoneE164 } : {}),
      counter: true,
      reason: reply.reason,
    };
  }

  if (reply.answer === "yes" || confirmedAdult18Plus || Boolean(phoneE164)) {
    return {
      intent: "accept",
      answer: "yes",
      optOut: false,
      underage: false,
      confirmedAdult18Plus,
      injectionLabel: null,
      ...(phoneE164 ? { phoneE164 } : {}),
      counter: false,
      reason: phoneE164 ? "phone_provided" : confirmedAdult18Plus && reply.answer !== "yes" ? "adult_confirmed" : reply.reason,
    };
  }

  return {
    intent: "unclear",
    answer: "unsure",
    optOut: false,
    underage: false,
    confirmedAdult18Plus: false,
    injectionLabel: null,
    counter: false,
    reason: reply.reason,
  };
}

export const parseMatchmakerReply = parseExternalProspectReply;

export function buildDatingOpenerScript(params: {
  prospectFirstName: string;
  cityName: string;
  promptDetail?: string;
  isReplyFollowup?: boolean;
  tone?: MatchmakerTone;
}): string {
  const tone = params.tone ?? "standard";
  const name = cleanPhrase(params.prospectFirstName.trim().split(/\s+/)[0] || "there");
  const city = cleanPhrase(params.cityName);
  if (params.isReplyFollowup) {
    if (tone === "casual") {
      return clampSms(
        `haha fair — full disclosure i'm actually playing matchmaker in ${city} right now, not looking for myself. i've got someone great i'd love to connect you with if you're interested — mind if i set it up?`
      );
    }
    return clampSms(
      `Fair enough — full disclosure, I'm working as a local matchmaker in ${city}, not dating here myself. I have someone great I'd love to introduce you to — would you be open to me setting it up?`
    );
  }
  const detail = cleanPhrase(params.promptDetail || "your profile");
  if (tone === "casual") {
    return clampSms(
      `hey ${name} — quick heads up so i'm not wasting your time: i'm actually a local matchmaker here in ${city} (not dating on here myself). saw your prompt about ${detail} and i've got someone great i'd love to connect you with — mind if i set it up?`,
      `hey ${name} — full disclosure i'm a local matchmaker in ${city} (not dating on here myself) and i've got someone great to connect you with — mind if i set it up?`
    );
  }
  return clampSms(
    `Hi ${name} — quick heads up so I'm transparent: I'm a local matchmaker in ${city} (not dating here myself). I noticed your note about ${detail} and have someone great I'd love to introduce you to. Would you be open to me setting it up?`,
    `Hi ${name} — full disclosure, I'm a local matchmaker in ${city} (not dating here myself) and have someone great to introduce you to. Would you be open to me setting it up?`
  );
}

export function buildFriendsMeetupOpenerScript(params: {
  prospectFirstName: string;
  hobbyOrNeighborhood: string;
  activity: string;
  neighborhood: string;
  dayLabel: string;
  timeLabel: string;
  tone?: MatchmakerTone;
}): string {
  const tone = params.tone ?? "standard";
  const name = cleanPhrase(params.prospectFirstName.trim().split(/\s+/)[0] || "there");
  const hobby = cleanPhrase(params.hobbyOrNeighborhood);
  const activity = cleanPhrase(params.activity);
  const hood = cleanPhrase(params.neighborhood);
  const day = cleanPhrase(params.dayLabel);
  const time = cleanPhrase(params.timeLabel);
  if (tone === "casual") {
    return clampSms(
      `hey ${name} — saw you're into ${hobby}. i organize small 4-5 person ${activity} hangs in ${hood} for people new in town or looking to make new friends (platonic group). doing one ${day} around ${time} — want me to save you a spot?`,
      `hey ${name} — i organize small 4-5 person ${activity} hangs in ${hood} (platonic group). doing one ${day} around ${time} — want me to save you a spot?`
    );
  }
  return clampSms(
    `Hi ${name} — I noticed you enjoy ${hobby}. I host small 4-5 person ${activity} meetups in ${hood} for people new in town or looking to make new friends (platonic group). We're meeting ${day} around ${time} — would you like me to save you a spot?`,
    `Hi ${name} — I host small 4-5 person ${activity} meetups in ${hood} (platonic group). We're meeting ${day} around ${time} — would you like me to save you a spot?`
  );
}

export function buildQualificationAgeRedLineScript(
  opts: { tone?: MatchmakerTone; step?: "age" | "preferences" } = {}
): string {
  const tone = opts.tone ?? "standard";
  const step = opts.step ?? "age";
  if (step === "preferences") {
    if (tone === "casual") {
      return "thanks! any hard dealbreakers i should keep in mind before i suggest someone (like drinking/sober, smoking, or dietary needs)?";
    }
    return "Thank you. Are there any dealbreakers I should know before I suggest someone — such as drinking, smoking, dietary needs, or what you're looking for?";
  }
  if (tone === "casual") {
    return "awesome. quick check first — can you confirm you're 18 or older?";
  }
  return "Great — quick check before we go further: can you confirm you are 18 or older?";
}

export function buildQualificationPreferencesScript(opts: { tone?: MatchmakerTone } = {}): string {
  return buildQualificationAgeRedLineScript({ tone: opts.tone, step: "preferences" });
}

export function buildAnonymizedMemberPitchScript(params: {
  pronounSubject: PronounSubject;
  ageBand: string;
  neighborhood: string;
  interests: string;
  goal: string;
  activity: string;
  tone?: MatchmakerTone;
}): string {
  const tone = params.tone ?? "standard";
  const subject = capitalizeSubject(params.pronounSubject, tone);
  const agePhrase = formatAgeBandPhrase(params.pronounSubject, params.ageBand);
  const hood = cleanPhrase(params.neighborhood);
  const interests = cleanPhrase(params.interests);
  const goal = cleanPhrase(params.goal);
  const activity = cleanPhrase(params.activity);
  const agePart = agePhrase ? ` ${agePhrase},` : "";
  if (tone === "casual") {
    return clampSms(
      `${subject}${agePart} lives near ${hood}, super into ${interests}, and looking for ${goal}. sound like someone you'd want to grab ${activity} with?`,
      `${subject}${agePart} near ${hood}, into ${interests}. sound like someone you'd want to grab ${activity} with?`
    );
  }
  return clampSms(
    `${subject}${agePart} lives near ${hood}, enjoys ${interests}, and is looking for ${goal}. Does that sound like someone you'd enjoy meeting for ${activity}?`,
    `${subject}${agePart} near ${hood} and enjoys ${interests}. Would you like to meet for ${activity}?`
  );
}

export function buildSmsOptInScript(
  memberPronoun: PronounSubject,
  opts: { tone?: MatchmakerTone } = {}
): string {
  const tone = opts.tone ?? "standard";
  if (tone === "casual") {
    return clampSms(
      `great — if ${memberPronoun} a yes too, i coordinate the spot and day-of check-in by text so neither of you shares numbers before meeting. reply STOP anytime to opt out; msg & data rates may apply. what's the best cell number for setup texts?`
    );
  }
  return clampSms(
    `Great — if ${memberPronoun} a yes too, I coordinate the spot and day-of check-in by text so neither of you shares numbers before meeting. Reply STOP anytime to opt out; msg & data rates may apply. What is the best cell number for setup texts?`
  );
}

export function buildMemberExpectationScript(cityName: string): string {
  const city = cleanPhrase(cityName);
  return clampSms(
    `Quick heads up: our local ${city} circle is still a bit light for your exact criteria, so I'm having our ${city} matchmaker scout outside our circle for you. Same rules — I'll vet them against your dealbreakers first and only text you if I find someone solid. Cool if I look?`,
    `Our local ${city} circle is light for your criteria, so I can have our local matchmaker scout and vet someone for you. Cool if I look?`
  );
}

export function buildMemberExternalProbeScript(params: {
  activity: string;
  neighborhood: string;
  timeOptions: string;
  ageBand: string;
  distancePhrase: string;
  shareableInterest: string;
}): string {
  const activity = cleanPhrase(params.activity);
  const hood = cleanPhrase(params.neighborhood);
  const times = cleanPhrase(params.timeOptions);
  const agePhrase = formatAgeBandPhrase("they're", params.ageBand);
  const dist = cleanPhrase(params.distancePhrase);
  const interest = cleanPhrase(params.shareableInterest);
  return clampSms(
    `Found someone great outside our circle for a first date: ${activity} in ${hood}, ${times}. They're ${agePhrase}, ${dist}, and into ${interest}. I'll only share first names and the exact spot if you're both a yes — which time works, or no?`,
    `Found someone great for a first date: ${activity} in ${hood}, ${times}. They're ${agePhrase} and into ${interest}. Which time works, or no?`
  );
}

export function buildBotScamSkepticismScript(
  personaFirstName: string,
  cityName: string,
  opts: { tone?: MatchmakerTone } = {}
): string {
  const tone = opts.tone ?? "standard";
  const name = cleanPhrase(personaFirstName.trim().split(/\s+/)[0] || "your host");
  const city = cleanPhrase(cityName);
  if (tone === "casual") {
    return clampSms(
      `totally fair to ask — i'm ${name}, a local matchmaker in ${city} using an intro service to set up real in-person meetups. nothing to buy, no links, nothing to sign up for. if it's not your thing, no worries at all and i'll leave you be.`
    );
  }
  return clampSms(
    `Fair question — I'm ${name}, a local matchmaker in ${city} using an intro service to set up real in-person meetups. Nothing to buy, no links, and nothing to sign up for. If it's not for you, no problem at all and I'll leave you be.`
  );
}

export function buildRomanticRedirectScript(opts: { tone?: MatchmakerTone } = {}): string {
  const tone = opts.tone ?? "standard";
  if (tone === "casual") {
    return "haha i appreciate that! i'm strictly playing matchmaker on here (just setting people up), not dating myself. totally cool if you're not into blind setups — just let me know.";
  }
  return "Thank you, that's kind of you to say! I'm strictly working as a matchmaker here to set up introductions, not dating myself. Completely fine if you prefer not to do a setup — just let me know.";
}

export function buildPhotoOrSocialRefusalScript(opts: { tone?: MatchmakerTone } = {}): string {
  const tone = opts.tone ?? "standard";
  if (tone === "casual") {
    return "i keep everyone's name, socials, and contact private until you're both a yes and actually meet — same goes for protecting your privacy too. you two can swap numbers or socials at the table if you click.";
  }
  return "I keep everyone's name, social profiles, and contact details private until you've both agreed and met in person — the same protects your privacy too. You can always swap numbers at the table if you click.";
}

export function buildGhostOrFlakeScripts(params: {
  dayLabel: string;
  prospectFirstName: string;
  memberFirstName: string;
  venueName: string;
  memberArrived?: boolean;
  tone?: MatchmakerTone;
}): {
  midSetupNudgeToProspect: string;
  midSetupUpdateToMember: string;
  dayOfT12PingToProspect: string;
  dayOfT18ReleaseToMember: string;
} {
  const tone = params.tone ?? "standard";
  const day = cleanPhrase(params.dayLabel);
  const prospect = cleanPhrase(params.prospectFirstName.trim().split(/\s+/)[0] || "them");
  const member = cleanPhrase(params.memberFirstName.trim().split(/\s+/)[0] || "your match");
  const venue = cleanPhrase(params.venueName);
  const dayOfT12 = params.memberArrived
    ? tone === "casual"
      ? `${member} is at ${venue} — still heading over?`
      : `${member} has arrived at ${venue} — are you still on your way?`
    : tone === "casual"
      ? `quick check-in before ${venue} — still good to meet ${member}?`
      : `Quick check-in before ${venue} — are you still on track to meet ${member}?`;
  return {
    midSetupNudgeToProspect: clampSms(
      tone === "casual"
        ? `no rush — still down for ${day} or should i release the slot?`
        : `No rush — are you still interested in ${day}, or should I release the time?`
    ),
    midSetupUpdateToMember:
      "Scheduling didn't line up on their end — I'm already scouting the next person for you.",
    dayOfT12PingToProspect: clampSms(dayOfT12),
    dayOfT18ReleaseToMember: clampSms(
      `Haven't heard back from ${prospect} yet — feel free to grab a coffee or head out, no pressure.`
    ),
  };
}

export function buildMemberDeclinedProspectScript(
  prospectFirstName: string,
  memberPossessive: "her" | "his" | "their",
  opts: { tone?: MatchmakerTone } = {}
): string {
  const tone = opts.tone ?? "standard";
  const name = cleanPhrase(prospectFirstName.trim().split(/\s+/)[0] || "there");
  if (tone === "casual") {
    return clampSms(
      `hey ${name}, quick update — timing didn't line up on ${memberPossessive} end this week, so we'll hold off on this one. appreciate you being open to it! want me to keep you in mind for someone else? reply yes to stay on my list, or no and i won't text again.`
    );
  }
  return clampSms(
    `Hi ${name}, quick update — timing didn't line up on ${memberPossessive} end this week, so we'll hold off on this one. Appreciate you being open to it! Want me to keep you in mind for someone else? Reply yes to stay on my list, or no and I won't text again.`
  );
}

export function buildProspectDeclinedScripts(opts: { tone?: MatchmakerTone } = {}): {
  toProspect: string;
  toMemberIfAlreadyProbed: string;
} {
  const tone = opts.tone ?? "standard";
  return {
    toProspect:
      tone === "casual"
        ? "totally get it, thanks for being upfront — have a great week!"
        : "Completely understand, thanks for letting me know — wishing you a great week!",
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
    variant: "mutual_spark" | "vouched_not_romantic" | "friends_hang";
    app?: "slop" | "friends";
    memberFirstName: string;
    cityName: string;
    tone?: MatchmakerTone;
  }
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!canInviteExternalProspectToNetwork(gateInput)) {
    return { ok: false, reason: "quality_gate_failed" };
  }
  const tone = params.tone ?? "standard";
  const memberName = cleanPhrase(params.memberFirstName.trim().split(/\s+/)[0] || "your host");
  const city = cleanPhrase(params.cityName);
  const isFriends = params.app === "friends" || params.variant === "friends_hang";

  let raw: string;
  let fallback: string;
  if (isFriends) {
    if (tone === "casual") {
      raw = `so glad you and ${memberName} had a great time! i run a small vetted circle in ${city} for low-key group hangs and hobby meetups. reply YES and i'll send you an invite link, or reply STOP anytime to opt out.`;
      fallback = `glad you had a great time with ${memberName}! reply YES for an invite link to our ${city} group hangs, or STOP anytime to opt out.`;
    } else {
      raw = `So glad you and ${memberName} had a great time! I run a small local circle in ${city} for relaxed small-group hangouts and hobby meetups. Reply YES and I'll text you an invite link, or reply STOP anytime to opt out.`;
      fallback = `So glad you had a great time with ${memberName}! Reply YES and I'll text you an invite link for our ${city} local hangouts, or reply STOP anytime to opt out.`;
    }
  } else if (params.variant === "mutual_spark") {
    if (tone === "casual") {
      raw = `so glad you and ${memberName} hit it off! i run a small curated circle in ${city} for vetted dates and small hangs without swiping. reply YES and i'll send you an invite link, or reply STOP anytime to opt out.`;
      fallback = `so glad you and ${memberName} hit it off! reply YES for an invite link to our ${city} circle, or STOP anytime to opt out.`;
    } else {
      raw = `So glad you and ${memberName} hit it off! I run a small curated circle in ${city} for vetted dates and small hangouts without swiping. Reply YES and I'll text you an invite link, or reply STOP anytime to opt out.`;
      fallback = `So glad you and ${memberName} hit it off! Reply YES and I'll text you an invite link for our ${city} circle, or reply STOP anytime to opt out.`;
    }
  } else {
    if (tone === "casual") {
      raw = `glad you two had a good convo even if it wasn't a romantic match — ${memberName} had really nice things to say about you. i run a small circle in ${city} for curated intros. reply YES and i'll send an invite link, or STOP anytime to opt out.`;
      fallback = `glad you two had a good convo — ${memberName} spoke warmly of you. reply YES for an invite link to our ${city} circle, or STOP anytime to opt out.`;
    } else {
      raw = `Glad you two had a good conversation even if it wasn't a romantic match — ${memberName} had very kind things to say about you. I run a small circle in ${city} for curated introductions. Reply YES and I'll text you an invite link, or reply STOP anytime to opt out.`;
      fallback = `Glad you two had a good conversation — ${memberName} spoke warmly of you. Reply YES and I'll text you an invite link for our ${city} circle, or reply STOP anytime to opt out.`;
    }
  }

  const text = clampSms(raw, fallback);
  const violations = validateOutboundSms(text, { firstContact: true });
  if (violations.length > 0) {
    return { ok: false, reason: `style_violation:${violations.join(",")}` };
  }
  return { ok: true, text };
}
