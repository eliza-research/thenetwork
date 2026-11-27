import {
  DAY,
  HOUR,
  LLMBudget,
  LeakGuard,
  MINUTE,
  Rng,
  SimClock,
  UNDER_MIN_AGE_DECLINE,
  birthKeyOfParts,
  canBeMatched,
  canJoin,
  clamp01,
  earliestDayKeyOf,
  getCity,
  hash32,
  isMinor,
  latestDayKeyOf,
  type AppId,
  type City,
  type MemberId,
  type NetworkUnderTest,
  type RunRecord,
} from "@thenetwork/core";
import { groupAgeAllowed, teenPartnerAge, teenRosterSizeAllowed } from "../../core/src/generated/friendIntroAge.ts";
import { teenFriendApp } from "../../core/src/generated/matchLane.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";
import { ConsentNetwork } from "../../network/src/network.ts";
import { createEngine } from "./engineAdapter.ts";
import { generatePersonas } from "./generator.ts";
import { computeMetrics, GOOD_MEETING_ENJOYMENT } from "./judge/metrics.ts";
import {
  type MarketingBrandPersona,
  type MarketingDesireLane,
  type MarketingPlatform,
  type ProspectRole,
  type ProspectSentiment,
  type VipSubtype,
} from "./marketingTemplates.ts";
import type { Archetype, Persona } from "./persona.ts";
import { DualResponseEngine, type DualResponseStats, type ResponseMode, type ResponseTurnSpan } from "./responseEngine.ts";
import {
  getUnifiedScenario,
  type ScheduledScenarioShock,
  type SimRiskDial,
  type SimSpeedPreset,
  type UnifiedScenarioId,
  type UnifiedScenarioPreset,
} from "./scenarios/unified.ts";
import { StubNetwork } from "./stubNetwork.ts";
import { FIRST_NAMES, LAST_NAMES } from "./taxonomy.ts";
import { DEFAULT_START, World } from "./world.ts";

export type SimStepPreset = "+15m" | "+1h" | "+6h" | "+1d" | "+7d";

export type BanditArmId =
  | "creator_video"
  | "vip_salon"
  | "street_fliering"
  | "bd_venue"
  | "event_activation"
  | "video_factory"
  | "social_organic"
  | "paid_meta"
  | "paid_tiktok"
  | "paid_google"
  | "cold_email";

export type FunnelStageName =
  | "impression"
  | "outreach_sent"
  | "prospect_reply"
  | "link_click"
  | "site_visit"
  | "qr_scan"
  | "signup_started"
  | "signup_declined_under13"
  | "signup_minor_restricted"
  | "signup_antifraud_blocked"
  | "signup_verified_adult"
  | "first_match_accepted"
  | "irl_meeting_confirmed"
  | "second_meetup_retained"
  | "referral_generated"
  | "opt_out_stop";

export interface UnifiedFunnelEvent {
  seq: number;
  ts: number;
  stage: FunnelStageName;
  app: AppId;
  city: City;
  armId: BanditArmId | "organic_referral";
  platform: MarketingPlatform;
  desireLane: MarketingDesireLane;
  actorId?: string;
  memberId?: MemberId;
  costCents?: number;
  isAdultVerified?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface UnifiedTrajectorySpan {
  spanId: string;
  traceId: string;
  ts: number;
  kind: "marketing_http" | "response_turn" | "signup_gate" | "network_event" | "chaos_shock" | "checkpoint" | "command";
  actorId?: string;
  city?: City;
  status: "ok" | "fallback" | "blocked" | "error";
  latencyMs: number;
  costMicro: number;
  detail: Record<string, string | number | boolean>;
}

export interface UnifiedChaosRule {
  id: string;
  service: string;
  pathPattern?: string;
  probability: number;
  fault:
    | { kind: "latency"; medianMs: number; sigma?: number }
    | { kind: "http_error"; status: number; retryAfterSec?: number }
    | { kind: "rate_limit_spike"; multiplier: number; retryAfterSec: number }
    | { kind: "shadowban_wave"; reachMultiplier: number; accounts?: string[] }
    | { kind: "captcha_wave"; probability: number }
    | { kind: "account_lock"; accounts: string[] }
    | { kind: "blooio_safety"; action: "reply_only" | "new_conversations_paused" | "account_review" }
    | { kind: "email_bounce_storm"; hardBounceRate: number; spamComplaintRate: number }
    | { kind: "tcp_drop" }
    | { kind: "malformed_json" };
  startsAtSimMs?: number;
  expiresAtSimMs?: number;
  enabled: boolean;
}

export interface SimNetworkBackpressure {
  capturedAt: number;
  app: AppId;
  activeAdultBucket: number;
  openReviewCount: number;
  overdueReviewCount: number;
  outboundWaitingCount: number;
  lineRestricted: boolean;
  closedVenueCount: number;
  stopRateBps: number;
  queuePressurePaused: boolean;
  reason?: string;
}

export interface BanditArmState {
  id: BanditArmId;
  platform: MarketingPlatform;
  paid: boolean;
  paused: boolean;
  weightOverride?: number;
  dailyCapCents: number;
  spentTodayCents: number;
  totalSpentCents: number;
  impressions: number;
  clicks: number;
  verifiedAdults: number;
  verifiedT3Matches: number;
  stops: number;
  httpErrors: number;
  alpha: number;
  beta: number;
  fatigue: number;
  reachMultiplier: number;
}

export interface AttributionRecord {
  memberId: MemberId;
  prospectId: string;
  armId: BanditArmId | "organic_referral";
  platform: MarketingPlatform;
  city: City;
  desireLane: MarketingDesireLane;
  acquisitionCostCents: number;
  joinedAt: number;
  isAdultVerified: boolean;
  isMinorMember: boolean;
  referrerMemberId?: MemberId;
  firstMatchAcceptedAt?: number;
  meetingsConfirmed: number;
  firstGoodMeetingAt?: number;
  secondMeetupRetainedAt?: number;
  optedOutAt?: number;
}

export interface BdPartnerVenue {
  id: string;
  venueName: string;
  city: City;
  neighborhood: string;
  signedAt: number;
  qrSlug: string;
  allAges: boolean;
  qrScans: number;
}

export interface DeviceChallenge {
  id: string;
  service: string;
  openedAt: number;
  resolved: boolean;
  resolvedAt?: number;
}

export interface UnifiedAuditEntry {
  seq: number;
  ts: number;
  actor: string;
  action: string;
  detail: Record<string, string | number | boolean>;
}

export interface SafetyGateCounters {
  canaryLeaks: number;
  invariantViolations: number;
  teenRuleViolations: number;
  stopFenceViolations: number;
  budgetOverruns: number;
  antifraudEscapes: number;
}

export interface UnifiedMissionStatus {
  id: string;
  title: string;
  done: boolean;
  progress: string;
}

export interface UnifiedScorecard {
  simDay: number;
  totalScore: number;
  grade: "S" | "A" | "B" | "C" | "F";
  strikes: number;
  clean: boolean;
  acquisition: {
    score: number;
    impressions: number;
    siteVisits: number;
    verifiedAdultSignups: number;
    minorRestrictedSignups: number;
    under13Refused: number;
    antifraudBlocked: number;
    visitToSignupRate: number;
    spentUsd: number;
    blendedCpaUsd: number;
    uniformBaselineCpaUsd: number;
    banditCpaImprovementPct: number;
    costPerT3MatchUsd: number;
  };
  matching: {
    score: number;
    proposals: number;
    acceptRate: number;
    meetingsHeld: number;
    goodMeetings: number;
    showRate: number;
    meanEnjoyment: number;
    firstGoodMeeting14dRate: number;
  };
  retention: {
    score: number;
    d7RetentionRate: number;
    repeatMeetingRate: number;
    referralKFactor: number;
    organicShare: number;
    bdVenuesLive: number;
    optOuts: number;
  };
  safety: SafetyGateCounters;
  missions: UnifiedMissionStatus[];
}

export interface HttpDispatchSummary {
  totalRequests: number;
  okResponses: number;
  rateLimited429: number;
  forbidden403: number;
  serverErrors5xx: number;
  networkErrors: number;
  s3CheckpointsWritten: number;
}

export interface SimCheckpointMeta {
  day: number;
  ts: number;
  s3Key?: string;
}

export interface SimCheckpointRecord {
  version: 1;
  runId: string;
  scenarioId: UnifiedScenarioId;
  day: number;
  ts: number;
  spentCents: number;
  riskDial: SimRiskDial;
  teenStop: boolean;
  arms: BanditArmState[];
  safety: SafetyGateCounters;
  activeChaosIds: string[];
  verifiedAdultCount: number;
  goodMeetingsCount: number;
  httpSummary: HttpDispatchSummary;
}

export interface UnifiedSimSnapshot {
  runId: string;
  scenarioId: UnifiedScenarioId;
  simTimeMs: number;
  simDay: number;
  speedPreset: SimSpeedPreset;
  speedRatio: number;
  paused: boolean;
  riskDial: SimRiskDial;
  teenStop: boolean;
  activeMembers: number;
  latentRemaining: number;
  bdVenuesLive: number;
  openDeviceChallenges: number;
  activeChaos: UnifiedChaosRule[];
  backpressure: SimNetworkBackpressure;
  scorecard: UnifiedScorecard;
  responseStats: DualResponseStats;
  httpSummary: HttpDispatchSummary;
  checkpoints: SimCheckpointMeta[];
}

export type UnifiedGameCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "set_speed"; preset: SimSpeedPreset }
  | { type: "step"; step: SimStepPreset }
  | { type: "set_response_mode"; mode: ResponseMode }
  | { type: "set_llm_budget"; maxCostUsd?: number; maxRequests?: number }
  | { type: "rewind_checkpoint"; day: number }
  | { type: "set_risk_dial"; dial: SimRiskDial }
  | { type: "tweak_bandit_arm"; armId: BanditArmId; paused?: boolean; weightOverride?: number; dailyCapCents?: number }
  | { type: "dispatch_outreach"; armId: BanditArmId; city?: City; count?: number }
  | { type: "reply_as_brand"; persona: MarketingBrandPersona; prospectId: string; text: string }
  | { type: "resolve_device_takeover"; challengeId: string }
  | { type: "teen_stop"; stop: boolean; actor: string }
  | { type: "trigger_chaos"; rule: UnifiedChaosRule }
  | { type: "clear_chaos"; id?: string }
  | { type: "trigger_world_event"; event: "viral_mention" | "sybil_ring_attack" | "minor_wave" | "venue_closure" | "opt_out"; city?: City };

export interface LatentProspect {
  id: string;
  name: string;
  city: City;
  neighborhood: string;
  desireLane: MarketingDesireLane;
  archetype: Archetype;
  role: ProspectRole;
  vipSubtype?: VipSubtype;
  venueName?: string;
  handle: string;
  email: string;
  phone: string;
  trueAge: number;
  birthKey: number;
  skepticism: number;
  flakiness: number;
  isVoip: boolean;
  isSybil: boolean;
  stopped: boolean;
  converted: boolean;
  declinedUnder13: boolean;
  antifraudBlocked: boolean;
  adExposureCount: number;
  lastContactedAt?: number;
}

export interface UnifiedSimOptions {
  scenario?: UnifiedScenarioId | UnifiedScenarioPreset;
  seed?: number | string;
  app?: AppId;
  startMs?: number;
  mockBaseUrl?: string;
  mockSessionId?: string;
  responseMode?: ResponseMode;
  llmBudget?: LLMBudget;
  llmEnv?: Record<string, string | undefined>;
  cassettePath?: string;
  networkKind?: "consent" | "stub";
  customNetwork?: NetworkUnderTest;
  populationScale?: number;
  s3Bucket?: string;
  reviewBacklogLimit?: number;
  outboundBacklogLimit?: number;
  onTrajectorySpan?: (span: UnifiedTrajectorySpan) => void;
  onFunnelEvent?: (event: UnifiedFunnelEvent) => void;
  onSnapshot?: (snapshot: UnifiedSimSnapshot) => void;
}

const SPEED_CONFIG: Record<SimSpeedPreset, { ratio: number; tickWallMs: number }> = {
  paused: { ratio: 0, tickWallMs: 0 },
  "1x": { ratio: 1, tickWallMs: 250 },
  "10x": { ratio: 10, tickWallMs: 100 },
  "60x": { ratio: 60, tickWallMs: 100 },
  "360x": { ratio: 360, tickWallMs: 100 },
  "1000x": { ratio: 1000, tickWallMs: 100 },
  turbo: { ratio: 86_400, tickWallMs: 0 },
};

const STEP_DELTAS: Record<SimStepPreset, number> = {
  "+15m": 15 * MINUTE,
  "+1h": HOUR,
  "+6h": 6 * HOUR,
  "+1d": DAY,
  "+7d": 7 * DAY,
};

const VIP_SUBTYPES: readonly VipSubtype[] = [
  "startup_founder",
  "michelin_chef",
  "ai_biotech_researcher",
  "creative_director",
  "community_host",
];

const ARCHETYPES: readonly Archetype[] = [
  "regular",
  "busy_parent",
  "newcomer",
  "connector",
  "introvert",
  "very_active",
  "never_replies",
  "traveler",
];

const VENUE_ADJECTIVES = ["Cedar", "Velvet", "Harbor", "Linden", "Mercer", "Juniper", "Bramble", "Alder"] as const;
const VENUE_NOUNS = ["Roasters", "Tea House", "Bookshop Cafe", "Board Room", "Botanical Courtyard", "Bakery"] as const;

export class SimClockController {
  private preset: SimSpeedPreset;
  private isPaused: boolean;
  private stepsExecuted = 0;

  constructor(
    readonly clock: SimClock,
    initialPreset: SimSpeedPreset = "paused",
  ) {
    this.preset = initialPreset;
    this.isPaused = initialPreset === "paused";
  }

  get speedPreset(): SimSpeedPreset {
    return this.preset;
  }

  get speedRatio(): number {
    return this.isPaused ? 0 : SPEED_CONFIG[this.preset].ratio;
  }

  get tickWallIntervalMs(): number {
    return SPEED_CONFIG[this.preset].tickWallMs;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get stepCount(): number {
    return this.stepsExecuted;
  }

  play(): void {
    this.isPaused = false;
    if (this.preset === "paused") this.preset = "60x";
  }

  pause(): void {
    this.isPaused = true;
  }

  setSpeed(preset: SimSpeedPreset): void {
    this.preset = preset;
    this.isPaused = preset === "paused";
  }

  stepDeltaMs(step: SimStepPreset): number {
    return STEP_DELTAS[step];
  }

  recordStep(): void {
    this.stepsExecuted++;
  }

  async syncToMockServer(mockBaseUrl: string, sessionId?: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionId) headers["X-Mock-Session"] = sessionId;
      const res = await fetch(`${mockBaseUrl.replace(/\/$/, "")}/_mock/clock`, {
        method: "POST",
        headers,
        body: JSON.stringify({ nowMs: this.clock.now() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export class AudiencePool {
  private readonly prospects: LatentProspect[] = [];
  private readonly byId = new Map<string, LatentProspect>();
  private readonly byPhone = new Map<string, LatentProspect>();
  private readonly byEmail = new Map<string, LatentProspect>();
  private cursor = 0;

  constructor(params: {
    seed: number | string;
    startMs: number;
    cities: readonly City[];
    count: number;
    seededVips: number;
    focusLanes: readonly MarketingDesireLane[];
    skepticismBias: number;
    flakinessBias: number;
    minorShare: number;
    under13Share: number;
    sybilShare: number;
  }) {
    const rng = new Rng(hash32("audience-pool", params.seed));
    const startYear = new Date(params.startMs).getUTCFullYear();
    const lanes = params.focusLanes.length > 0 ? params.focusLanes : (["friends_belonging"] as const);

    for (let i = 0; i < params.count; i++) {
      const pRng = rng.fork("prospect", i);
      const city = params.cities[i % params.cities.length] ?? "nyc";
      const citySpec = getCity(city);
      const neighborhoods = citySpec?.neighborhoods.map(n => n.name) ?? ["Downtown"];
      const neighborhood = pRng.pick(neighborhoods);
      const first = pRng.pick(FIRST_NAMES);
      const last = pRng.pick(LAST_NAMES);
      const id = `pr_${String(i + 1).padStart(6, "0")}`;

      const isVip = i < params.seededVips;
      const isBdVenue = !isVip && i % 25 === 0;
      const isApplicant = !isVip && !isBdVenue && i % 20 === 0;
      const isCreator = !isVip && !isBdVenue && !isApplicant && i % 30 === 0;
      const role: ProspectRole = isVip
        ? "vip"
        : isBdVenue
          ? "bd_venue"
          : isApplicant
            ? "applicant"
            : isCreator
              ? "creator"
              : pRng.bool(0.35)
                ? "email_lead"
                : pRng.bool(0.5)
                  ? "social_user"
                  : "ad_viewer";

      const ageDraw = pRng.next();
      let trueAge: number;
      if (!isVip && !isBdVenue && ageDraw < params.under13Share) {
        trueAge = pRng.int(10, 12);
      } else if (!isVip && !isBdVenue && ageDraw < params.under13Share + params.minorShare) {
        trueAge = pRng.int(13, 17);
      } else {
        trueAge = pRng.int(18, 56);
      }
      const birthYear = startYear - trueAge;
      const birthMonth = pRng.int(1, 12);
      const birthDay = pRng.int(1, 28);
      const birthKey = birthKeyOfParts(birthYear, birthMonth, birthDay) ?? birthYear * 10000 + 615;

      const isSybil = !isVip && !isBdVenue && trueAge >= 18 && pRng.bool(params.sybilShare);
      const isVoip = isSybil || (!isVip && pRng.bool(0.025));
      const handle = `${first.toLowerCase()}_${last.toLowerCase()}_${(i + 1).toString(36)}`;
      const email = `${handle}@sim-mail.example`;
      const phone = `+1555${String(1000000 + (i % 8999999)).slice(0, 7)}`;

      const prospect: LatentProspect = {
        id,
        name: `${first} ${last}`,
        city,
        neighborhood,
        desireLane: pRng.pick(lanes),
        archetype: pRng.pick(ARCHETYPES),
        role,
        ...(isVip ? { vipSubtype: pRng.pick(VIP_SUBTYPES) } : {}),
        ...(isBdVenue ? { venueName: `${pRng.pick(VENUE_ADJECTIVES)} ${pRng.pick(VENUE_NOUNS)}` } : {}),
        handle,
        email,
        phone,
        trueAge,
        birthKey,
        skepticism: clamp01(params.skepticismBias + pRng.range(-0.1, 0.25)),
        flakiness: clamp01(params.flakinessBias + pRng.range(-0.05, 0.2)),
        isVoip,
        isSybil,
        stopped: false,
        converted: false,
        declinedUnder13: false,
        antifraudBlocked: false,
        adExposureCount: 0,
      };

      this.prospects.push(prospect);
      this.byId.set(id, prospect);
      this.byPhone.set(phone, prospect);
      this.byEmail.set(email, prospect);
    }
  }

  get total(): number {
    return this.prospects.length;
  }

  get remaining(): number {
    let n = 0;
    for (const p of this.prospects) {
      if (!p.converted && !p.stopped && !p.declinedUnder13 && !p.antifraudBlocked) n++;
    }
    return n;
  }

  getById(id: string): LatentProspect | undefined {
    return this.byId.get(id);
  }

  fenceStop(idOrContact: string): boolean {
    const p = this.byId.get(idOrContact) ?? this.byPhone.get(idOrContact) ?? this.byEmail.get(idOrContact);
    if (!p) return false;
    p.stopped = true;
    return true;
  }

  drawReachable(params: {
    count: number;
    city?: City;
    roles?: readonly ProspectRole[];
    allowMinors: boolean;
    now: number;
    cooldownMs?: number;
  }): LatentProspect[] {
    const out: LatentProspect[] = [];
    const n = this.prospects.length;
    if (n === 0 || params.count <= 0) return out;
    const cooldown = params.cooldownMs ?? 24 * HOUR;
    const roleSet = params.roles ? new Set(params.roles) : undefined;

    for (let scanned = 0; scanned < n && out.length < params.count; scanned++) {
      const idx = (this.cursor + scanned) % n;
      const p = this.prospects[idx]!;
      if (p.stopped || p.converted || p.declinedUnder13 || p.antifraudBlocked) continue;
      if (params.city && p.city !== params.city) continue;
      if (roleSet && !roleSet.has(p.role)) continue;
      if (!params.allowMinors && !canBeMatched(p.trueAge)) continue;
      if (p.lastContactedAt !== undefined && params.now - p.lastContactedAt < cooldown) continue;
      out.push(p);
    }
    this.cursor = (this.cursor + Math.max(1, out.length)) % n;
    return out;
  }

  drawAgeProbes(params: { count: number; city?: City; under13Only?: boolean; sybilOnly?: boolean }): LatentProspect[] {
    const out: LatentProspect[] = [];
    for (const p of this.prospects) {
      if (out.length >= params.count) break;
      if (p.stopped || p.converted || p.declinedUnder13 || p.antifraudBlocked) continue;
      if (params.city && p.city !== params.city) continue;
      if (params.under13Only && canJoin(p.trueAge)) continue;
      if (params.sybilOnly && !p.isSybil) continue;
      if (!params.under13Only && !params.sybilOnly && canBeMatched(p.trueAge)) continue;
      out.push(p);
    }
    return out;
  }
}

const DEFAULT_ARMS: readonly {
  id: BanditArmId;
  platform: MarketingPlatform;
  paid: boolean;
  baseCpmCents: number;
  baseClickRate: number;
  baseConvertRate: number;
  dailyCapShare: number;
}[] = [
  { id: "creator_video", platform: "tiktok", paid: true, baseCpmCents: 900, baseClickRate: 0.09, baseConvertRate: 0.34, dailyCapShare: 0.14 },
  { id: "vip_salon", platform: "email", paid: false, baseCpmCents: 350, baseClickRate: 0.24, baseConvertRate: 0.55, dailyCapShare: 0.08 },
  { id: "street_fliering", platform: "street", paid: true, baseCpmCents: 650, baseClickRate: 0.11, baseConvertRate: 0.38, dailyCapShare: 0.1 },
  { id: "bd_venue", platform: "email", paid: false, baseCpmCents: 280, baseClickRate: 0.22, baseConvertRate: 0.48, dailyCapShare: 0.08 },
  { id: "event_activation", platform: "street", paid: true, baseCpmCents: 800, baseClickRate: 0.15, baseConvertRate: 0.44, dailyCapShare: 0.1 },
  { id: "video_factory", platform: "instagram", paid: true, baseCpmCents: 1050, baseClickRate: 0.075, baseConvertRate: 0.28, dailyCapShare: 0.08 },
  { id: "social_organic", platform: "x", paid: false, baseCpmCents: 120, baseClickRate: 0.08, baseConvertRate: 0.32, dailyCapShare: 0.06 },
  { id: "paid_meta", platform: "ads", paid: true, baseCpmCents: 1400, baseClickRate: 0.06, baseConvertRate: 0.24, dailyCapShare: 0.12 },
  { id: "paid_tiktok", platform: "ads", paid: true, baseCpmCents: 1250, baseClickRate: 0.065, baseConvertRate: 0.25, dailyCapShare: 0.1 },
  { id: "paid_google", platform: "ads", paid: true, baseCpmCents: 1600, baseClickRate: 0.085, baseConvertRate: 0.3, dailyCapShare: 0.08 },
  { id: "cold_email", platform: "email", paid: false, baseCpmCents: 200, baseClickRate: 0.055, baseConvertRate: 0.22, dailyCapShare: 0.06 },
];

const ARM_SPEC = new Map(DEFAULT_ARMS.map(a => [a.id, a]));

const DIAL_MULTIPLIER: Record<SimRiskDial, number> = {
  conservative: 0.6,
  balanced: 1,
  blitz: 1.45,
  lockdown: 0,
};

function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) return sampleGamma(shape + 1, rng) * Math.pow(Math.max(1e-9, rng.next()), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 64; i++) {
    const x = rng.normal(0, 1);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = Math.max(1e-12, rng.next());
    if (u < 1 - 0.0331 * Math.pow(x, 4) || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
  return d;
}

function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(Math.max(0.2, alpha), rng);
  const y = sampleGamma(Math.max(0.2, beta), rng);
  return x + y > 0 ? x / (x + y) : 0.5;
}

export class UnifiedSimCoordinator {
  readonly runId: string;
  readonly scenario: UnifiedScenarioPreset;
  readonly app: AppId;
  readonly startMs: number;
  readonly clock: SimClock;
  readonly clockController: SimClockController;
  readonly responseEngine: DualResponseEngine;
  readonly audience: AudiencePool;
  readonly world: World;
  readonly consentNetwork?: ConsentNetwork;

  private readonly seed: number | string;
  private readonly rng: Rng;
  private readonly mockBaseUrl?: string;
  private readonly mockSessionId: string;
  private readonly s3Bucket: string;
  private readonly reviewBacklogLimit: number;
  private readonly outboundBacklogLimit: number;
  private readonly onTrajectorySpan?: (span: UnifiedTrajectorySpan) => void;
  private readonly onFunnelEvent?: (event: UnifiedFunnelEvent) => void;
  private readonly onSnapshot?: (snapshot: UnifiedSimSnapshot) => void;

  private readonly arms = new Map<BanditArmId, BanditArmState>();
  private readonly attributionLedger = new Map<MemberId, AttributionRecord>();
  private readonly funnelEvents: UnifiedFunnelEvent[] = [];
  private readonly chaosRules = new Map<string, UnifiedChaosRule>();
  private readonly appliedShockIds = new Set<string>();
  private readonly deviceChallenges = new Map<string, DeviceChallenge>();
  private readonly bdVenues: BdPartnerVenue[] = [];
  private readonly checkpoints = new Map<number, SimCheckpointRecord>();
  private readonly auditLog: UnifiedAuditEntry[] = [];
  private readonly brandGuard: LeakGuard;
  private readonly memberMeetingCounts = new Map<MemberId, number>();
  private readonly organicReferrals = new Set<MemberId>();

  private initialized = false;
  private riskDial: SimRiskDial;
  private teenStop = false;
  private spentCents = 0;
  private budgetCapCents: number;
  private currentDay = 0;
  private worldRecordCursor = 0;
  private funnelSeq = 0;
  private spanSeq = 0;
  private auditSeq = 0;
  private spawnSeq = 0;
  private queuePressurePaused = false;
  private lineRestricted = false;
  private syntheticReviewSpike = 0;
  private closedVenueCount = 0;
  private viralMultiplier = 1;
  private minorSurgeFactor = 1;
  private sybilSurgeFactor = 1;
  private emailBounceRate = 0.015;
  private emailSpamComplaintRate = 0.0005;
  private baselineWeeklySignups = 0;
  private postCrackdownSignups = 0;
  private expiredReviewsCount = 0;

  private readonly funnelCounts: Record<FunnelStageName, number> = {
    impression: 0,
    outreach_sent: 0,
    prospect_reply: 0,
    link_click: 0,
    site_visit: 0,
    qr_scan: 0,
    signup_started: 0,
    signup_declined_under13: 0,
    signup_minor_restricted: 0,
    signup_antifraud_blocked: 0,
    signup_verified_adult: 0,
    first_match_accepted: 0,
    irl_meeting_confirmed: 0,
    second_meetup_retained: 0,
    referral_generated: 0,
    opt_out_stop: 0,
  };

  private readonly safety: SafetyGateCounters = {
    canaryLeaks: 0,
    invariantViolations: 0,
    teenRuleViolations: 0,
    stopFenceViolations: 0,
    budgetOverruns: 0,
    antifraudEscapes: 0,
  };

  private readonly httpSummary: HttpDispatchSummary = {
    totalRequests: 0,
    okResponses: 0,
    rateLimited429: 0,
    forbidden403: 0,
    serverErrors5xx: 0,
    networkErrors: 0,
    s3CheckpointsWritten: 0,
  };

  constructor(opts: UnifiedSimOptions = {}) {
    const preset =
      typeof opts.scenario === "string"
        ? getUnifiedScenario(opts.scenario)
        : opts.scenario ?? getUnifiedScenario("city_launch");
    this.scenario = preset;
    this.seed = opts.seed ?? 1;
    this.app = opts.app ?? preset.app;
    this.startMs = opts.startMs ?? DEFAULT_START;
    this.mockBaseUrl = opts.mockBaseUrl?.replace(/\/$/, "");
    this.mockSessionId = opts.mockSessionId ?? `sim-${preset.id}-s${this.seed}`;
    this.s3Bucket = opts.s3Bucket ?? "sim-checkpoints";
    this.reviewBacklogLimit = opts.reviewBacklogLimit ?? 20;
    this.outboundBacklogLimit = opts.outboundBacklogLimit ?? 200;
    this.onTrajectorySpan = opts.onTrajectorySpan;
    this.onFunnelEvent = opts.onFunnelEvent;
    this.onSnapshot = opts.onSnapshot;

    this.rng = new Rng(hash32("unified-sim", preset.id, this.seed));
    this.runId = `unified-${preset.id}-s${this.seed}`;
    this.riskDial = preset.riskDial;
    this.budgetCapCents = preset.monthlyBudgetCents;

    const scale = clamp01(opts.populationScale ?? 1) || 1;
    const initialCount = Math.max(0, Math.round(preset.initialActiveMembers * scale));
    const latentCount = Math.max(40, Math.round(preset.latentProspects * scale));
    const seededVips = Math.max(4, Math.round(preset.seededVips * scale));

    const initialPersonas =
      initialCount > 0
        ? generatePersonas({
            n: initialCount,
            seed: hash32("initial-personas", preset.id, this.seed),
            cities: preset.cities,
            minorShare: this.app === "slop" || this.app === "peon" ? 0 : preset.minorProspectShare,
            adversarialRate: 0.04,
            joinSpreadDays: Math.min(3, preset.days),
          })
        : [];

    const networkKind = opts.networkKind ?? "consent";
    let network: NetworkUnderTest;
    if (opts.customNetwork) {
      network = opts.customNetwork;
    } else if (networkKind === "consent") {
      this.consentNetwork = new ConsentNetwork({
        app: this.app,
        seed: hash32("consent", preset.id, this.seed),
        inlineJudge: simulatedReviewJudge({ exceptions: true }),
        engine: { cities: [...preset.cities] },
      });
      network = this.consentNetwork;
    } else {
      network = new StubNetwork({ seed: hash32("stub", preset.id, this.seed), randomIntros: false });
    }

    this.responseEngine = new DualResponseEngine({
      mode: opts.responseMode ?? preset.defaultResponseMode,
      budget: opts.llmBudget ?? new LLMBudget({ maxCostMicro: 500_000, maxRequests: 500 }),
      seed: hash32("response-engine", preset.id, this.seed),
      env: opts.llmEnv,
      cassettePath: opts.cassettePath,
      allowLinks: ["https://ntwrk.party", "https://go.ntwrk.party"],
      onTurn: (turn: ResponseTurnSpan) => {
        this.emitSpan({
          kind: "response_turn",
          actorId: turn.actorId,
          status: turn.leakBlocked ? "blocked" : turn.source === "canned_fallback" ? "fallback" : "ok",
          latencyMs: turn.latencyMs,
          costMicro: turn.costMicro,
          detail: {
            surface: turn.surface,
            source: turn.source,
            cacheKey: turn.cacheKey,
            ...(turn.fallbackReason ? { fallbackReason: turn.fallbackReason } : {}),
          },
        });
      },
    });

    this.world = new World({
      seed: hash32("world-core", preset.id, this.seed),
      personas: initialPersonas,
      days: preset.days,
      start: this.startMs,
      app: this.app,
      network,
      engine: networkKind === "stub" && !opts.customNetwork ? createEngine() : undefined,
      agent: this.responseEngine.asPersonaAgent(this.startMs),
      writeLog: false,
      runId: this.runId,
    });

    this.clock = this.world.clock;
    this.clockController = new SimClockController(this.clock, preset.defaultSpeed);
    this.responseEngine.setSpeedRatio(this.clockController.speedRatio || 1);

    this.audience = new AudiencePool({
      seed: hash32("audience", preset.id, this.seed),
      startMs: this.startMs,
      cities: preset.cities,
      count: latentCount,
      seededVips,
      focusLanes: preset.focusLanes,
      skepticismBias: preset.skepticismBias,
      flakinessBias: preset.flakinessBias,
      minorShare: preset.minorProspectShare,
      under13Share: preset.under13ProbeShare,
      sybilShare: preset.sybilShare,
    });

    this.brandGuard = new LeakGuard({
      canaryShapes: true,
      contacts: true,
      allow: ["https://ntwrk.party", "https://go.ntwrk.party"],
    });

    const dailyTotalBudget = Math.max(1_000, Math.floor(preset.monthlyBudgetCents / Math.max(1, preset.days)));
    for (const spec of DEFAULT_ARMS) {
      this.arms.set(spec.id, {
        id: spec.id,
        platform: spec.platform,
        paid: spec.paid,
        paused: false,
        dailyCapCents: Math.max(200, Math.round(dailyTotalBudget * spec.dailyCapShare)),
        spentTodayCents: 0,
        totalSpentCents: 0,
        impressions: 0,
        clicks: 0,
        verifiedAdults: 0,
        verifiedT3Matches: 0,
        stops: 0,
        httpErrors: 0,
        alpha: 2,
        beta: 4,
        fatigue: 0,
        reachMultiplier: 1,
      });
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.world.begin();
    this.initialized = true;
    if (this.mockBaseUrl) {
      await this.mockPost("/_mock/reset", {
        seed: typeof this.seed === "number" ? this.seed : hash32(this.seed),
        startMs: this.startMs,
        sessionId: this.mockSessionId,
      });
      await this.clockController.syncToMockServer(this.mockBaseUrl, this.mockSessionId);
    }
    this.recordAudit("system", "sim_init", {
      scenario: this.scenario.id,
      app: this.app,
      latentProspects: this.audience.total,
    });
  }

  async step(preset: SimStepPreset): Promise<UnifiedSimSnapshot> {
    if (!this.initialized) await this.init();
    const deltaMs = this.clockController.stepDeltaMs(preset);
    const targetMs = Math.min(this.world.end, this.clock.now() + deltaMs);
    const sliceMs = Math.min(HOUR, deltaMs);

    while (this.clock.now() < targetMs) {
      const nextStop = Math.min(targetMs, this.clock.now() + sliceMs);
      await this.advanceSlice(nextStop);
    }
    this.clockController.recordStep();
    const snap = this.getSnapshot();
    this.onSnapshot?.(snap);
    return snap;
  }

  async runDays(days: number): Promise<UnifiedSimSnapshot> {
    if (!this.initialized) await this.init();
    const targetMs = Math.min(this.world.end, this.clock.now() + Math.max(0, days) * DAY);
    while (this.clock.now() < targetMs) {
      const nextStop = Math.min(targetMs, this.clock.now() + HOUR);
      await this.advanceSlice(nextStop);
    }
    const snap = this.getSnapshot();
    this.onSnapshot?.(snap);
    return snap;
  }

  async dispatchCommand(cmd: UnifiedGameCommand): Promise<{ ok: boolean; reason?: string; snapshot: UnifiedSimSnapshot }> {
    if (!this.initialized) await this.init();
    let ok = true;
    let reason: string | undefined;

    switch (cmd.type) {
      case "play":
        this.clockController.play();
        this.responseEngine.setSpeedRatio(this.clockController.speedRatio);
        break;
      case "pause":
        this.clockController.pause();
        this.responseEngine.setSpeedRatio(0);
        break;
      case "set_speed":
        this.clockController.setSpeed(cmd.preset);
        this.responseEngine.setSpeedRatio(this.clockController.speedRatio);
        break;
      case "step":
        await this.step(cmd.step);
        break;
      case "set_response_mode":
        this.responseEngine.setMode(cmd.mode);
        break;
      case "set_llm_budget":
        this.responseEngine.setBudgetLimits({ maxCostUsd: cmd.maxCostUsd, maxRequests: cmd.maxRequests });
        break;
      case "rewind_checkpoint": {
        const restored = await this.rewindToDay(cmd.day);
        ok = restored;
        if (!restored) reason = "checkpoint_not_found";
        break;
      }
      case "set_risk_dial":
        this.riskDial = cmd.dial;
        this.recordAudit("player", "set_risk_dial", { dial: cmd.dial });
        break;
      case "tweak_bandit_arm": {
        const arm = this.arms.get(cmd.armId);
        if (!arm) {
          ok = false;
          reason = "unknown_arm";
        } else {
          if (cmd.paused !== undefined) arm.paused = cmd.paused;
          if (cmd.weightOverride !== undefined) arm.weightOverride = cmd.weightOverride;
          if (cmd.dailyCapCents !== undefined && cmd.dailyCapCents >= 0) arm.dailyCapCents = cmd.dailyCapCents;
          this.recordAudit("player", "tweak_bandit_arm", { armId: cmd.armId, paused: arm.paused });
        }
        break;
      }
      case "dispatch_outreach": {
        const arm = this.arms.get(cmd.armId);
        if (!arm) {
          ok = false;
          reason = "unknown_arm";
        } else {
          const city = cmd.city ?? this.scenario.cities[0] ?? "nyc";
          await this.runArmTick(arm, city, Math.max(1, cmd.count ?? 4));
        }
        break;
      }
      case "reply_as_brand": {
        const leaks = this.brandGuard.check(cmd.text);
        if (leaks.length > 0) {
          ok = false;
          reason = "leak_guard_blocked";
          this.emitSpan({
            kind: "command",
            actorId: cmd.persona,
            status: "blocked",
            latencyMs: 0,
            costMicro: 0,
            detail: { command: "reply_as_brand", prospectId: cmd.prospectId, reasons: leaks.join(",") },
          });
        } else {
          const prospect = this.audience.getById(cmd.prospectId);
          if (prospect && prospect.stopped) {
            ok = false;
            reason = "contact_fenced_stop";
          } else {
            this.recordAudit("player", "reply_as_brand", { persona: cmd.persona, prospectId: cmd.prospectId });
          }
        }
        break;
      }
      case "resolve_device_takeover": {
        const challenge = this.deviceChallenges.get(cmd.challengeId);
        if (!challenge) {
          ok = false;
          reason = "challenge_not_found";
        } else {
          challenge.resolved = true;
          challenge.resolvedAt = this.clock.now();
          this.recordAudit("player", "resolve_device_takeover", { challengeId: cmd.challengeId, service: challenge.service });
        }
        break;
      }
      case "teen_stop": {
        this.teenStop = cmd.stop;
        if (this.consentNetwork) {
          const res = cmd.stop
            ? this.consentNetwork.stopTeenIntros(cmd.actor)
            : this.consentNetwork.resumeTeenIntros(cmd.actor);
          ok = res.ok;
          if (!res.ok) reason = res.reason;
        }
        this.recordAudit(cmd.actor, cmd.stop ? "teen_stop_on" : "teen_stop_off", { app: this.app });
        break;
      }
      case "trigger_chaos":
        await this.applyChaosRule(cmd.rule);
        break;
      case "clear_chaos":
        await this.clearChaos(cmd.id);
        break;
      case "trigger_world_event":
        await this.handleWorldEvent(cmd.event, cmd.city ?? this.scenario.cities[0] ?? "nyc");
        break;
    }

    this.emitSpan({
      kind: "command",
      status: ok ? "ok" : "blocked",
      latencyMs: 0,
      costMicro: 0,
      detail: { command: cmd.type, ok, ...(reason ? { reason } : {}) },
    });

    const snapshot = this.getSnapshot();
    this.onSnapshot?.(snapshot);
    return { ok, ...(reason ? { reason } : {}), snapshot };
  }

  getBackpressureSnapshot(): SimNetworkBackpressure {
    const queue = this.consentNetwork?.reviewQueue() ?? [];
    const now = this.clock.now();
    const slaMs = 12 * HOUR;
    const openReviewCount = queue.length + this.syntheticReviewSpike;
    const overdueReviewCount = queue.filter(item => now > item.deadline || now - item.queuedAt > slaMs).length;
    const outboundWaitingCount = Math.min(this.outboundBacklogLimit * 2, Math.floor(openReviewCount * 3));
    const totalOutreach = Math.max(1, this.funnelCounts.outreach_sent);
    const stopRateBps = Math.round((this.funnelCounts.opt_out_stop / totalOutreach) * 10_000);

    const highPressure =
      this.lineRestricted ||
      overdueReviewCount > 0 ||
      openReviewCount >= this.reviewBacklogLimit ||
      outboundWaitingCount >= this.outboundBacklogLimit ||
      stopRateBps >= 300;
    const recoveryThreshold =
      !this.lineRestricted &&
      overdueReviewCount === 0 &&
      openReviewCount < Math.floor(this.reviewBacklogLimit * 0.8) &&
      outboundWaitingCount < Math.floor(this.outboundBacklogLimit * 0.8) &&
      stopRateBps < 200;

    if (highPressure) this.queuePressurePaused = true;
    else if (recoveryThreshold) this.queuePressurePaused = false;

    const reason = this.lineRestricted
      ? "blooio_line_restricted"
      : overdueReviewCount > 0
        ? "review_overdue"
        : openReviewCount >= this.reviewBacklogLimit
          ? "review_backlog"
          : stopRateBps >= 300
            ? "stop_rate_lockdown"
            : undefined;

    return {
      capturedAt: now,
      app: this.app,
      activeAdultBucket: Math.floor(this.activeAdultCount() / 5) * 5,
      openReviewCount,
      overdueReviewCount,
      outboundWaitingCount,
      lineRestricted: this.lineRestricted,
      closedVenueCount: this.closedVenueCount,
      stopRateBps,
      queuePressurePaused: this.queuePressurePaused,
      ...(reason ? { reason } : {}),
    };
  }

  getScorecard(): UnifiedScorecard {
    const metrics = computeMetrics(this.world.records, { personas: this.world.personaList() });
    const simDay = Math.floor((this.clock.now() - this.startMs) / DAY);

    const verifiedAdults = this.funnelCounts.signup_verified_adult;
    const siteVisits = this.funnelCounts.site_visit + this.funnelCounts.qr_scan;
    const spentUsd = Math.round((this.spentCents / 100) * 100) / 100;
    const blendedCpaUsd = verifiedAdults > 0 ? Math.round((spentUsd / verifiedAdults) * 100) / 100 : 0;

    const uniformArmSpend = [...this.arms.values()].reduce((acc, arm) => acc + arm.totalSpentCents, 0);
    const uniformExpectedSignups = Math.max(1, (uniformArmSpend / 100) / 14.5);
    const uniformBaselineCpaUsd = Math.round(((uniformArmSpend / 100) / uniformExpectedSignups) * 100) / 100;
    const banditCpaImprovementPct =
      verifiedAdults > 0 && uniformBaselineCpaUsd > 0
        ? Math.round(((uniformBaselineCpaUsd - blendedCpaUsd) / uniformBaselineCpaUsd) * 1000) / 10
        : 0;

    const t3Matches = this.funnelCounts.irl_meeting_confirmed;
    const costPerT3MatchUsd = t3Matches > 0 ? Math.round((spentUsd / t3Matches) * 100) / 100 : 0;

    const visitToSignupRate = siteVisits > 0 ? Math.round((verifiedAdults / siteVisits) * 1000) / 1000 : 0;
    const acquisitionScore = Math.round(
      clamp01(verifiedAdults / Math.max(20, this.scenario.winTarget.minVerifiedAdultSignups ?? 100)) * 180 +
        clamp01(visitToSignupRate / 0.25) * 60 +
        clamp01((20 - Math.min(20, blendedCpaUsd)) / 20) * 60,
    );

    const goodMeetings = [...this.attributionLedger.values()].filter(a => a.firstGoodMeetingAt !== undefined).length +
      metrics.meetings.held;
    const acquiredAdults = [...this.attributionLedger.values()].filter(a => a.isAdultVerified);
    const acquiredWithGoodMeeting = acquiredAdults.filter(
      a => a.firstGoodMeetingAt !== undefined && a.firstGoodMeetingAt - a.joinedAt <= 14 * DAY,
    ).length;
    const firstGoodMeeting14dRate =
      acquiredAdults.length > 0 ? Math.round((acquiredWithGoodMeeting / acquiredAdults.length) * 1000) / 1000 : 0;

    const matchQualityScore = Math.round(
      clamp01(metrics.responses.acceptRate / 0.6) * 100 +
        clamp01(metrics.meetings.showRate / 0.85) * 120 +
        clamp01(metrics.meetings.meanEnjoyment / 0.75) * 120 +
        clamp01(firstGoodMeeting14dRate / 0.55) * 60,
    );

    const d7Eligible = acquiredAdults.filter(a => this.clock.now() - a.joinedAt >= 7 * DAY);
    const d7Retained = d7Eligible.filter(a => a.optedOutAt === undefined).length;
    const d7RetentionRate = d7Eligible.length > 0 ? Math.round((d7Retained / d7Eligible.length) * 1000) / 1000 : 1;

    const withMeeting = acquiredAdults.filter(a => a.meetingsConfirmed >= 1);
    const repeatMembers = withMeeting.filter(a => a.meetingsConfirmed >= 2).length;
    const repeatMeetingRate = withMeeting.length > 0 ? Math.round((repeatMembers / withMeeting.length) * 1000) / 1000 : 0;

    const activeTotal = Math.max(1, this.world.personaList().length);
    const referralKFactor = Math.round((this.organicReferrals.size / activeTotal) * 1000) / 1000;
    const organicSignups = acquiredAdults.filter(a => !ARM_SPEC.get(a.armId as BanditArmId)?.paid).length;
    const organicShare = acquiredAdults.length > 0 ? Math.round((organicSignups / acquiredAdults.length) * 1000) / 1000 : 0;

    const retentionScore = Math.round(
      clamp01(d7RetentionRate) * 100 +
        clamp01(repeatMeetingRate / 0.4) * 80 +
        clamp01(referralKFactor / 0.35) * 70 +
        clamp01(this.bdVenues.length / 5) * 50,
    );

    const safetySnapshot: SafetyGateCounters = {
      canaryLeaks: this.safety.canaryLeaks + metrics.privacy.canaryLeaks,
      invariantViolations: this.safety.invariantViolations + metrics.invariants.total,
      teenRuleViolations: this.safety.teenRuleViolations + metrics.safety.minorContacts,
      stopFenceViolations: this.safety.stopFenceViolations,
      budgetOverruns: this.safety.budgetOverruns,
      antifraudEscapes: this.safety.antifraudEscapes,
    };

    const totalViolations =
      safetySnapshot.canaryLeaks +
      safetySnapshot.invariantViolations +
      safetySnapshot.teenRuleViolations +
      safetySnapshot.stopFenceViolations +
      safetySnapshot.budgetOverruns +
      safetySnapshot.antifraudEscapes;

    const strikes = Math.min(3, totalViolations);
    const clean = totalViolations === 0;
    const rawTotal = acquisitionScore + matchQualityScore + retentionScore - strikes * 150;
    const totalScore = Math.max(0, rawTotal);
    const grade: UnifiedScorecard["grade"] = !clean
      ? "F"
      : totalScore >= 820
        ? "S"
        : totalScore >= 680
          ? "A"
          : totalScore >= 520
            ? "B"
            : totalScore >= 360
              ? "C"
              : "F";

    const missions: UnifiedMissionStatus[] = [
      {
        id: "bandit_beat",
        title: "Bandit Beat",
        done: simDay >= 14 && banditCpaImprovementPct >= 20,
        progress: `${banditCpaImprovementPct}% vs uniform (day ${simDay}/14)`,
      },
      {
        id: "quality_acquisition",
        title: "Quality Acquisition",
        done: verifiedAdults >= 20 && firstGoodMeeting14dRate >= 0.45,
        progress: `${Math.round(firstGoodMeeting14dRate * 100)}% 14d good meeting`,
      },
      {
        id: "backpressure_master",
        title: "Backpressure Master",
        done: this.expiredReviewsCount === 0 && !this.lineRestricted && simDay >= 7,
        progress: `${this.expiredReviewsCount} expired reviews`,
      },
      {
        id: "crackdown_pivot",
        title: "Crackdown Pivot",
        done:
          this.baselineWeeklySignups > 0 &&
          this.postCrackdownSignups >= Math.round(this.baselineWeeklySignups * 0.7),
        progress: `${this.postCrackdownSignups}/${Math.max(1, Math.round(this.baselineWeeklySignups * 0.7))} recovered`,
      },
      {
        id: "zero_leak_growth",
        title: "Zero-Leak Growth",
        done: clean && verifiedAdults >= 200,
        progress: `${verifiedAdults}/200 verified adults (${clean ? "clean" : `${totalViolations} violations`})`,
      },
    ];

    return {
      simDay,
      totalScore,
      grade,
      strikes,
      clean,
      acquisition: {
        score: acquisitionScore,
        impressions: this.funnelCounts.impression,
        siteVisits,
        verifiedAdultSignups: verifiedAdults,
        minorRestrictedSignups: this.funnelCounts.signup_minor_restricted,
        under13Refused: this.funnelCounts.signup_declined_under13,
        antifraudBlocked: this.funnelCounts.signup_antifraud_blocked,
        visitToSignupRate,
        spentUsd,
        blendedCpaUsd,
        uniformBaselineCpaUsd,
        banditCpaImprovementPct,
        costPerT3MatchUsd,
      },
      matching: {
        score: matchQualityScore,
        proposals: metrics.proposals.total,
        acceptRate: metrics.responses.acceptRate,
        meetingsHeld: metrics.meetings.held,
        goodMeetings,
        showRate: metrics.meetings.showRate,
        meanEnjoyment: metrics.meetings.meanEnjoyment,
        firstGoodMeeting14dRate,
      },
      retention: {
        score: retentionScore,
        d7RetentionRate,
        repeatMeetingRate,
        referralKFactor,
        organicShare,
        bdVenuesLive: this.bdVenues.length,
        optOuts: this.funnelCounts.opt_out_stop + metrics.experience.optOuts,
      },
      safety: safetySnapshot,
      missions,
    };
  }

  getSnapshot(): UnifiedSimSnapshot {
    return {
      runId: this.runId,
      scenarioId: this.scenario.id,
      simTimeMs: this.clock.now(),
      simDay: Math.floor((this.clock.now() - this.startMs) / DAY),
      speedPreset: this.clockController.speedPreset,
      speedRatio: this.clockController.speedRatio,
      paused: this.clockController.paused,
      riskDial: this.riskDial,
      teenStop: this.teenStop,
      activeMembers: this.world.personaList().length,
      latentRemaining: this.audience.remaining,
      bdVenuesLive: this.bdVenues.length,
      openDeviceChallenges: [...this.deviceChallenges.values()].filter(c => !c.resolved).length,
      activeChaos: [...this.chaosRules.values()].filter(c => c.enabled),
      backpressure: this.getBackpressureSnapshot(),
      scorecard: this.getScorecard(),
      responseStats: this.responseEngine.getStats(),
      httpSummary: { ...this.httpSummary },
      checkpoints: [...this.checkpoints.values()].map(c => ({
        day: c.day,
        ts: c.ts,
        s3Key: `${this.runId}/day-${c.day}.json`,
      })),
    };
  }

  getAttributionLedger(): readonly AttributionRecord[] {
    return [...this.attributionLedger.values()];
  }

  getFunnelEvents(): readonly UnifiedFunnelEvent[] {
    return this.funnelEvents;
  }

  getAuditLog(): readonly UnifiedAuditEntry[] {
    return this.auditLog;
  }

  getArms(): readonly BanditArmState[] {
    return [...this.arms.values()];
  }

  getDigest(): string {
    const score = this.getScorecard();
    const payload = [
      this.scenario.id,
      this.seed,
      this.clock.now(),
      this.spentCents,
      score.acquisition.verifiedAdultSignups,
      score.acquisition.under13Refused,
      score.acquisition.antifraudBlocked,
      score.matching.proposals,
      score.matching.meetingsHeld,
      score.retention.bdVenuesLive,
      score.safety.canaryLeaks,
      score.safety.teenRuleViolations,
      score.safety.stopFenceViolations,
      score.safety.budgetOverruns,
    ].join("|");
    return hash32(payload).toString(16).padStart(8, "0");
  }

  async rewindToDay(day: number): Promise<boolean> {
    let checkpoint = this.checkpoints.get(day);
    if (!checkpoint && this.mockBaseUrl) {
      const res = await this.mockRequest("GET", `/s3/${this.s3Bucket}/${this.runId}/day-${day}.json`);
      if (res && res.ok) {
        try {
          checkpoint = (await res.json()) as SimCheckpointRecord;
          this.checkpoints.set(day, checkpoint);
        } catch {
          return false;
        }
      }
    }
    if (!checkpoint) return false;
    this.spentCents = checkpoint.spentCents;
    this.riskDial = checkpoint.riskDial;
    this.teenStop = checkpoint.teenStop;
    this.arms.clear();
    for (const arm of checkpoint.arms) {
      this.arms.set(arm.id, { ...arm });
    }
    this.recordAudit("player", "rewind_checkpoint", { targetDay: day, restoredSpentCents: checkpoint.spentCents });
    return true;
  }

  private activeAdultCount(): number {
    let n = 0;
    for (const p of this.world.personaList()) {
      if (canBeMatched(p.hidden.trueAge)) n++;
    }
    return n;
  }

  private async advanceSlice(targetMs: number): Promise<void> {
    const now = this.clock.now();
    const day = Math.floor((now - this.startMs) / DAY);

    if (this.mockBaseUrl) {
      await this.clockController.syncToMockServer(this.mockBaseUrl, this.mockSessionId);
    }

    await this.evaluateScheduledShocks(day);

    const bp = this.getBackpressureSnapshot();
    const dialMult = DIAL_MULTIPLIER[this.riskDial];

    if (dialMult > 0) {
      const selectedArms = this.selectBanditArms(bp.queuePressurePaused);
      for (const arm of selectedArms) {
        const city = this.rng.fork("arm-city", now, arm.id).pick(this.scenario.cities);
        const batchSize = Math.max(1, Math.round(3 * dialMult * (arm.platform === "tiktok" ? Math.min(5, this.viralMultiplier) : 1)));
        await this.runArmTick(arm, city, batchSize);
      }
    }

    await this.runBdVenueQrFootTraffic(now);
    if (this.minorSurgeFactor > 1 || this.sybilSurgeFactor > 1 || day === 0) {
      await this.runAdversarialAndAgeProbes(now);
    }

    await this.world.advanceTo(targetMs);
    this.processWorldRecords();

    const newDay = Math.floor((this.clock.now() - this.startMs) / DAY);
    if (newDay > this.currentDay) {
      this.currentDay = newDay;
      for (const arm of this.arms.values()) {
        arm.spentTodayCents = 0;
        arm.fatigue = Math.max(0, arm.fatigue - 0.05);
      }
      if (this.syntheticReviewSpike > 0) {
        this.syntheticReviewSpike = Math.max(0, this.syntheticReviewSpike - 8);
      }
      if (newDay === 2 && this.baselineWeeklySignups === 0) {
        this.baselineWeeklySignups = Math.max(10, this.funnelCounts.signup_verified_adult * 3);
      }
      await this.saveCheckpoint(newDay);
    }
  }

  private async evaluateScheduledShocks(day: number): Promise<void> {
    this.viralMultiplier = 1;
    this.minorSurgeFactor = 1;
    this.sybilSurgeFactor = 1;
    this.lineRestricted = false;
    this.emailBounceRate = 0.015;
    this.emailSpamComplaintRate = 0.0005;

    for (const arm of this.arms.values()) {
      arm.reachMultiplier = 1;
    }

    for (const entry of this.scenario.shocks) {
      const active = day >= entry.atDay && day < entry.atDay + entry.durationDays;
      if (active) {
        await this.applyScheduledShock(entry);
      } else if (this.appliedShockIds.has(entry.id)) {
        this.appliedShockIds.delete(entry.id);
        await this.clearChaos(entry.id);
      }
    }

    for (const rule of this.chaosRules.values()) {
      if (!rule.enabled) continue;
      if (rule.expiresAtSimMs !== undefined && this.clock.now() > rule.expiresAtSimMs) {
        rule.enabled = false;
        continue;
      }
      this.applyLocalChaosEffect(rule);
    }
  }

  private async applyScheduledShock(entry: ScheduledScenarioShock): Promise<void> {
    const firstTime = !this.appliedShockIds.has(entry.id);
    if (firstTime) {
      this.appliedShockIds.add(entry.id);
      this.emitSpan({
        kind: "chaos_shock",
        status: "ok",
        latencyMs: 0,
        costMicro: 0,
        detail: { shockId: entry.id, label: entry.label, kind: entry.shock.kind },
      });
    }

    const s = entry.shock;
    switch (s.kind) {
      case "viral_multiplier":
        this.viralMultiplier = Math.max(this.viralMultiplier, s.multiplier);
        this.minorSurgeFactor = Math.max(this.minorSurgeFactor, s.minorSurgeFactor);
        this.sybilSurgeFactor = Math.max(this.sybilSurgeFactor, s.sybilSurgeFactor);
        if (firstTime) this.syntheticReviewSpike += 24;
        break;
      case "shadowban_wave":
        if (firstTime) {
          for (const svc of s.services) {
            await this.applyChaosRule({
              id: `${entry.id}:${svc}`,
              service: svc,
              probability: 1,
              fault: { kind: "shadowban_wave", reachMultiplier: s.reachMultiplier },
              enabled: true,
            });
          }
        }
        break;
      case "captcha_wave":
        if (firstTime) {
          for (const svc of s.services) {
            await this.applyChaosRule({
              id: `${entry.id}:${svc}`,
              service: svc,
              probability: s.probability,
              fault: { kind: "captcha_wave", probability: s.probability },
              enabled: true,
            });
          }
        }
        break;
      case "email_bounce_storm":
        if (firstTime) {
          await this.applyChaosRule({
            id: entry.id,
            service: "resend",
            probability: 1,
            fault: {
              kind: "email_bounce_storm",
              hardBounceRate: s.hardBounceRate,
              spamComplaintRate: s.spamComplaintRate,
            },
            enabled: true,
          });
        }
        break;
      case "blooio_safety":
        if (firstTime) {
          await this.applyChaosRule({
            id: entry.id,
            service: "blooio",
            probability: 1,
            fault: { kind: "blooio_safety", action: s.action },
            enabled: true,
          });
        }
        break;
      case "intermittent_http_faults":
        if (firstTime) {
          for (const svc of s.services) {
            await this.applyChaosRule({
              id: `${entry.id}:${svc}`,
              service: svc,
              probability: s.probability,
              fault: { kind: "http_error", status: s.status, retryAfterSec: 30 },
              enabled: true,
            });
          }
        }
        break;
    }
  }

  private applyLocalChaosEffect(rule: UnifiedChaosRule): void {
    const f = rule.fault;
    if (f.kind === "shadowban_wave") {
      for (const arm of this.arms.values()) {
        if (arm.platform === rule.service || rule.service === "*") {
          arm.reachMultiplier = Math.min(arm.reachMultiplier, f.reachMultiplier);
        }
      }
    } else if (f.kind === "blooio_safety") {
      this.lineRestricted = true;
    } else if (f.kind === "email_bounce_storm") {
      this.emailBounceRate = Math.max(this.emailBounceRate, f.hardBounceRate);
      this.emailSpamComplaintRate = Math.max(this.emailSpamComplaintRate, f.spamComplaintRate);
    } else if (f.kind === "captcha_wave") {
      const challengeId = `cap:${rule.service}`;
      if (!this.deviceChallenges.has(challengeId)) {
        this.deviceChallenges.set(challengeId, {
          id: challengeId,
          service: rule.service,
          openedAt: this.clock.now(),
          resolved: false,
        });
      }
      const existing = this.deviceChallenges.get(challengeId);
      if (existing && !existing.resolved) {
        for (const arm of this.arms.values()) {
          if (arm.platform === rule.service) arm.reachMultiplier = Math.min(arm.reachMultiplier, 0.25);
        }
      }
    }
  }

  private async applyChaosRule(rule: UnifiedChaosRule): Promise<void> {
    this.chaosRules.set(rule.id, rule);
    this.applyLocalChaosEffect(rule);
    if (this.mockBaseUrl) {
      await this.mockRequest("PUT", "/_mock/chaos", rule);
    }
    this.recordAudit("director", "trigger_chaos", { id: rule.id, service: rule.service, fault: rule.fault.kind });
  }

  private async clearChaos(id?: string): Promise<void> {
    if (id) {
      for (const key of [...this.chaosRules.keys()]) {
        if (key === id || key.startsWith(`${id}:`)) {
          this.chaosRules.delete(key);
          if (this.mockBaseUrl) await this.mockRequest("DELETE", `/_mock/chaos/${encodeURIComponent(key)}`);
        }
      }
    } else {
      for (const key of [...this.chaosRules.keys()]) {
        this.chaosRules.delete(key);
        if (this.mockBaseUrl) await this.mockRequest("DELETE", `/_mock/chaos/${encodeURIComponent(key)}`);
      }
    }
    this.lineRestricted = false;
    this.recordAudit("director", "clear_chaos", { id: id ?? "all" });
  }

  private selectBanditArms(queuePressurePaused: boolean): BanditArmState[] {
    const candidates: { arm: BanditArmState; score: number }[] = [];
    const sampleRng = this.rng.fork("bandit", this.clock.now());
    for (const arm of this.arms.values()) {
      if (arm.paused) continue;
      if (queuePressurePaused && arm.paid) continue;
      if (arm.paid && arm.spentTodayCents >= arm.dailyCapCents) continue;
      if (arm.paid && this.spentCents >= this.budgetCapCents) continue;

      const thompson = sampleBeta(arm.alpha, arm.beta, sampleRng);
      const override = arm.weightOverride ?? 1;
      const health = Math.max(0.05, arm.reachMultiplier) * (1 - Math.min(0.6, arm.fatigue));
      candidates.push({ arm, score: thompson * override * health });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 3).map(c => c.arm);
  }

  private canAuthorizeSpend(costCents: number, arm: BanditArmState): boolean {
    if (costCents <= 0) return true;
    if (this.spentCents + costCents > this.budgetCapCents) return false;
    if (arm.spentTodayCents + costCents > arm.dailyCapCents) return false;
    return true;
  }

  private async runArmTick(arm: BanditArmState, city: City, count: number): Promise<void> {
    const spec = ARM_SPEC.get(arm.id)!;
    const now = this.clock.now();
    const tickRng = this.rng.fork("arm-tick", arm.id, city, now);

    const estCostCents = Math.max(10, Math.round((spec.baseCpmCents * count) / 25));
    if (arm.paid && !this.canAuthorizeSpend(estCostCents, arm)) return;

    const roles: ProspectRole[] | undefined =
      arm.id === "vip_salon"
        ? ["vip"]
        : arm.id === "bd_venue"
          ? ["bd_venue"]
          : arm.id === "street_fliering" || arm.id === "creator_video"
            ? ["applicant", "creator", "social_user"]
            : undefined;

    const prospects = this.audience.drawReachable({
      count,
      city,
      roles,
      allowMinors: !arm.paid && arm.id === "social_organic" && teenFriendApp(this.app),
      now,
    });
    if (prospects.length === 0) return;

    const brandPersona: MarketingBrandPersona =
      this.app === "slop"
        ? "sloane"
        : this.app === "peon"
          ? "peon"
          : this.app === "friends"
            ? "venn"
            : arm.id === "bd_venue"
              ? "operator"
              : "chadwick";

    const slug = `${arm.id.slice(0, 4)}-${city}-${hash32(arm.id, city, now).toString(36).slice(0, 5)}`;
    const linkUrl = `https://go.ntwrk.party/${slug}`;
    const draft = await this.responseEngine.generateBrandDraft({
      persona: brandPersona,
      city,
      desireLane: prospects[0]!.desireLane,
      linkUrl,
      seedKey: `${arm.id}:${city}:${now}`,
      isVipOrHighValue: arm.id === "vip_salon" || arm.id === "bd_venue",
    });

    if (this.brandGuard.check(draft.text).length > 0) {
      this.safety.canaryLeaks++;
      return;
    }

    const httpOk = await this.dispatchExternalMarketingHttp(arm, city, slug, draft.text, prospects[0]!);
    if (!httpOk) {
      arm.httpErrors++;
      arm.beta += 0.5;
      return;
    }

    if (arm.paid) {
      this.spentCents += estCostCents;
      arm.spentTodayCents += estCostCents;
      arm.totalSpentCents += estCostCents;
      if (this.spentCents > this.budgetCapCents) this.safety.budgetOverruns++;
    }

    const impressions = Math.max(1, Math.round(prospects.length * 14 * arm.reachMultiplier * (arm.platform === "tiktok" ? this.viralMultiplier : 1)));
    arm.impressions += impressions;
    arm.fatigue = Math.min(0.85, arm.fatigue + 0.012);
    this.emitFunnel({
      stage: "impression",
      city,
      armId: arm.id,
      platform: arm.platform,
      desireLane: prospects[0]!.desireLane,
      costCents: arm.paid ? estCostCents : 0,
      metadata: { count: impressions },
    });

    for (const prospect of prospects) {
      if (prospect.stopped) {
        this.safety.stopFenceViolations++;
        continue;
      }
      prospect.lastContactedAt = now;
      prospect.adExposureCount++;

      this.emitFunnel({
        stage: "outreach_sent",
        city,
        armId: arm.id,
        platform: arm.platform,
        desireLane: prospect.desireLane,
        actorId: prospect.id,
      });

      const bounceDraw = arm.platform === "email" && tickRng.bool(this.emailBounceRate);
      if (bounceDraw) continue;

      const stopProb =
        (arm.platform === "email" ? this.emailSpamComplaintRate * 8 : 0.008) +
        prospect.skepticism * 0.015;
      const clickProb = clamp01(
        spec.baseClickRate *
          arm.reachMultiplier *
          (1 - prospect.skepticism * 0.55) *
          (1 - Math.min(0.5, prospect.adExposureCount * 0.08)) *
          (arm.platform === "tiktok" ? Math.min(3, Math.sqrt(this.viralMultiplier)) : 1),
      );

      let sentiment: ProspectSentiment;
      if (tickRng.bool(stopProb)) sentiment = "stop";
      else if (prospect.role === "applicant" && !canBeMatched(prospect.trueAge)) sentiment = "underage";
      else if (prospect.isSybil && tickRng.bool(0.65)) sentiment = "sybil";
      else if (prospect.role === "bd_venue" && tickRng.bool(clickProb * 1.4)) sentiment = tickRng.bool(0.55) ? "warm" : "negotiating";
      else if (tickRng.bool(clickProb)) sentiment = tickRng.bool(0.65) ? "warm" : "curious";
      else if (tickRng.bool(0.25)) sentiment = "skeptical";
      else sentiment = "decline";

      const reply = await this.responseEngine.generateProspectReply(
        {
          platform: arm.platform,
          role: prospect.role,
          sentiment,
          desireLane: prospect.desireLane,
          city,
          archetype: prospect.archetype,
          vipSubtype: prospect.vipSubtype,
          venueName: prospect.venueName,
          brandName: this.app === "ntwrk" ? "The Network" : this.app,
          handle: prospect.handle,
          seedKey: `${prospect.id}:${arm.id}:${now}`,
        },
        {
          surface: arm.platform === "email" ? "email_outreach" : arm.platform === "ads" ? "ad_reaction" : "social_comment",
          actorId: prospect.id,
          threadId: `${arm.id}:${prospect.id}`,
          isVipOrHighValue: prospect.role === "vip" || prospect.role === "bd_venue",
          currentSpeedRatio: this.clockController.speedRatio || 1,
        },
      );

      this.emitFunnel({
        stage: "prospect_reply",
        city,
        armId: arm.id,
        platform: arm.platform,
        desireLane: prospect.desireLane,
        actorId: prospect.id,
        metadata: { sentiment: reply.intent, source: reply.source },
      });

      if (reply.stopKeyword || sentiment === "stop") {
        prospect.stopped = true;
        arm.stops++;
        arm.beta += 2;
        this.emitFunnel({
          stage: "opt_out_stop",
          city,
          armId: arm.id,
          platform: arm.platform,
          desireLane: prospect.desireLane,
          actorId: prospect.id,
        });
        continue;
      }

      if (reply.underageSignal || reply.sybilSignal) {
        prospect.antifraudBlocked = true;
        this.emitFunnel({
          stage: "signup_antifraud_blocked",
          city,
          armId: arm.id,
          platform: arm.platform,
          desireLane: prospect.desireLane,
          actorId: prospect.id,
          metadata: { reason: reply.underageSignal ? "underage_applicant" : "sybil_claim" },
        });
        continue;
      }

      if (prospect.role === "bd_venue" && (sentiment === "warm" || sentiment === "negotiating")) {
        this.signBdVenue(prospect, now);
        arm.alpha += 1.5;
        continue;
      }

      if (sentiment === "warm" || sentiment === "curious") {
        arm.clicks++;
        await this.processClickToSignup({
          prospect,
          armId: arm.id,
          platform: arm.platform,
          slug,
          acquisitionCostCents: arm.paid ? Math.round(estCostCents / Math.max(1, prospects.length)) : 0,
          convertProb: spec.baseConvertRate * (sentiment === "warm" ? 1.25 : 0.7),
          rng: tickRng.fork("conv", prospect.id),
        });
      } else {
        arm.beta += 0.25;
      }
    }
  }

  private async dispatchExternalMarketingHttp(
    arm: BanditArmState,
    city: City,
    slug: string,
    copyText: string,
    sampleProspect: LatentProspect,
  ): Promise<boolean> {
    if (!this.mockBaseUrl) return true;

    const dubRes = await this.mockRequest("POST", "/ops/dub/links", {
      url: `https://ntwrk.party/?utm_source=${arm.platform}&utm_campaign=${arm.id}&city=${city}`,
      key: slug,
    });
    if (dubRes && dubRes.status === 429) return false;

    let res: Response | undefined;
    switch (arm.id) {
      case "social_organic": {
        const channelPick = this.rng.fork("social-org", city, slug).int(0, 3);
        if (channelPick === 0) {
          res = await this.mockRequest("POST", "/social/x/2/tweets", { text: copyText, account: `brand_${city}` });
        } else if (channelPick === 1) {
          res = await this.mockRequest("POST", "/social/reddit/api/submit", { sr: city, title: copyText });
        } else if (channelPick === 2) {
          res = await this.mockRequest("POST", "/social/linkedin/v2/rest/posts", { commentary: copyText });
        } else {
          res = await this.mockRequest("POST", `/social/discord/api/v10/channels/ch_${city}/messages`, { content: copyText });
        }
        break;
      }
      case "video_factory":
        res = await this.mockRequest("POST", `/social/instagram/v21.0/ig_${city}/media_publish`, {
          caption: copyText,
          creation_id: slug,
        });
        break;
      case "creator_video":
        res = await this.mockRequest("POST", "/social/tiktok/v2/post/publish/video/init/", {
          post_info: { title: copyText },
          source_info: { source: "PULL_FROM_URL" },
        });
        break;
      case "vip_salon":
      case "bd_venue":
      case "cold_email":
        res = await this.mockRequest(
          "POST",
          "/email/resend/emails",
          {
            from: `hello@ntwrk.party`,
            to: [sampleProspect.email],
            subject: `${city.toUpperCase()} invitation`,
            text: copyText,
          },
          { "Idempotency-Key": `${arm.id}-${slug}` },
        );
        break;
      case "paid_meta":
        res = await this.mockRequest("POST", "/ads/meta/v21.0/act_sim/campaigns", {
          name: `${arm.id}_${city}`,
          daily_budget: arm.dailyCapCents,
          status: "ACTIVE",
        });
        break;
      case "paid_tiktok":
        res = await this.mockRequest("POST", "/ads/tiktok/v1.3/campaign/create/", {
          campaign_name: `${arm.id}_${city}`,
          budget: arm.dailyCapCents / 100,
        });
        break;
      case "paid_google":
        res = await this.mockRequest("POST", "/ads/google/v18/customers/sim/campaigns:mutate", {
          operations: [{ create: { name: `${arm.id}_${city}`, dailyBudgetCents: arm.dailyCapCents } }],
        });
        break;
      case "event_activation":
        res = await this.mockRequest("POST", "/ops/luma/public/v1/event/create", {
          name: `${city.toUpperCase()} Small Group Salon`,
          city,
        });
        break;
      case "street_fliering":
        res = await this.mockRequest("POST", "/ops/rentahuman/api/mcp", {
          jsonrpc: "2.0",
          id: slug,
          method: "tools/call",
          params: { name: "create_bounty", arguments: { city, qrSlug: slug } },
        });
        break;
    }

    if (!res) return true;
    if (res.status === 429 || res.status >= 500) return false;
    if (res.status === 403 || res.status === 400) {
      const challengeId = `cap:${arm.platform}`;
      if (!this.deviceChallenges.has(challengeId)) {
        this.deviceChallenges.set(challengeId, {
          id: challengeId,
          service: arm.platform,
          openedAt: this.clock.now(),
          resolved: false,
        });
      }
      return false;
    }
    return true;
  }

  private signBdVenue(prospect: LatentProspect, now: number): void {
    const slug = `qr-${prospect.city}-${this.bdVenues.length + 1}`;
    this.bdVenues.push({
      id: `bd_${prospect.id}`,
      venueName: prospect.venueName ?? `${prospect.neighborhood} Cafe`,
      city: prospect.city,
      neighborhood: prospect.neighborhood,
      signedAt: now,
      qrSlug: slug,
      allAges: true,
      qrScans: 0,
    });
    prospect.converted = true;
  }

  private async runBdVenueQrFootTraffic(now: number): Promise<void> {
    if (this.bdVenues.length === 0) return;
    const rng = this.rng.fork("bd-qr", now);
    for (const venue of this.bdVenues) {
      if (!rng.bool(0.35)) continue;
      const walkers = this.audience.drawReachable({
        count: 1,
        city: venue.city,
        allowMinors: teenFriendApp(this.app),
        now,
      });
      if (walkers.length === 0) continue;
      venue.qrScans++;
      await this.processClickToSignup({
        prospect: walkers[0]!,
        armId: "bd_venue",
        platform: "street",
        slug: venue.qrSlug,
        acquisitionCostCents: 0,
        convertProb: 0.45,
        isQrScan: true,
        rng: rng.fork("qr-conv", venue.id),
      });
    }
  }

  private async runAdversarialAndAgeProbes(now: number): Promise<void> {
    const probeRng = this.rng.fork("age-probes", now);
    const under13Probes = this.audience.drawAgeProbes({
      count: Math.max(1, Math.round(this.minorSurgeFactor)),
      under13Only: true,
    });
    for (const p of under13Probes) {
      await this.processClickToSignup({
        prospect: p,
        armId: "social_organic",
        platform: "tiktok",
        slug: `probe-u13-${p.id}`,
        acquisitionCostCents: 0,
        convertProb: 1,
        rng: probeRng.fork("u13", p.id),
      });
    }

    if (this.sybilSurgeFactor > 1) {
      const sybils = this.audience.drawAgeProbes({
        count: Math.round(this.sybilSurgeFactor),
        sybilOnly: true,
      });
      for (const p of sybils) {
        await this.processClickToSignup({
          prospect: p,
          armId: "creator_video",
          platform: "tiktok",
          slug: `probe-syb-${p.id}`,
          acquisitionCostCents: 0,
          convertProb: 1,
          rng: probeRng.fork("syb", p.id),
        });
      }
    }
  }

  private async processClickToSignup(params: {
    prospect: LatentProspect;
    armId: BanditArmId;
    platform: MarketingPlatform;
    slug: string;
    acquisitionCostCents: number;
    convertProb: number;
    isQrScan?: boolean;
    rng: Rng;
  }): Promise<void> {
    const { prospect, armId, platform, slug, acquisitionCostCents, convertProb, isQrScan, rng } = params;

    if (this.mockBaseUrl) {
      await this.mockRequest("GET", `/go/${encodeURIComponent(slug)}`, undefined, undefined, "manual");
      await this.mockRequest("POST", "/beacon/v1/events", {
        events: [
          {
            type: isQrScan ? "qr_scan" : "page_view",
            brand: this.app,
            city: prospect.city,
            armId,
            desireLane: prospect.desireLane,
            ts: this.clock.now(),
          },
        ],
      });
    }

    this.emitFunnel({
      stage: isQrScan ? "qr_scan" : "site_visit",
      city: prospect.city,
      armId,
      platform,
      desireLane: prospect.desireLane,
      actorId: prospect.id,
    });

    if (!rng.bool(clamp01(convertProb))) return;

    this.emitFunnel({
      stage: "signup_started",
      city: prospect.city,
      armId,
      platform,
      desireLane: prospect.desireLane,
      actorId: prospect.id,
    });

    if (this.mockBaseUrl) {
      const tsRes = await this.mockRequest("POST", "/turnstile/v0/siteverify", {
        response: `tok_${prospect.id}`,
      });
      if (tsRes && !tsRes.ok) return;

      const lookupRes = await this.mockRequest("GET", `/twilio/lookups/v2/PhoneNumbers/${encodeURIComponent(prospect.phone)}`);
      if (lookupRes && lookupRes.ok) {
        try {
          const data = (await lookupRes.json()) as { line_type_intelligence?: { type?: string } };
          if (data?.line_type_intelligence?.type === "voip") {
            prospect.isVoip = true;
          }
        } catch {
          void 0;
        }
      }
    }

    if (prospect.isSybil || prospect.isVoip) {
      prospect.antifraudBlocked = true;
      this.emitFunnel({
        stage: "signup_antifraud_blocked",
        city: prospect.city,
        armId,
        platform,
        desireLane: prospect.desireLane,
        actorId: prospect.id,
        metadata: { voip: prospect.isVoip, sybil: prospect.isSybil },
      });
      this.emitSpan({
        kind: "signup_gate",
        actorId: prospect.id,
        city: prospect.city,
        status: "blocked",
        latencyMs: 0,
        costMicro: 0,
        detail: { reason: "antifraud_voip_or_sybil" },
      });
      return;
    }

    if (!canJoin(prospect.trueAge)) {
      prospect.declinedUnder13 = true;
      this.emitFunnel({
        stage: "signup_declined_under13",
        city: prospect.city,
        armId,
        platform,
        desireLane: prospect.desireLane,
        metadata: { declineTextLength: UNDER_MIN_AGE_DECLINE.length },
      });
      this.emitSpan({
        kind: "signup_gate",
        city: prospect.city,
        status: "blocked",
        latencyMs: 0,
        costMicro: 0,
        detail: { reason: "under_13_declined" },
      });
      return;
    }

    if (isMinor(prospect.trueAge)) {
      if (!teenFriendApp(this.app)) {
        prospect.converted = true;
        this.emitFunnel({
          stage: "signup_minor_restricted",
          city: prospect.city,
          armId,
          platform,
          desireLane: prospect.desireLane,
          isAdultVerified: false,
          metadata: { refusedApp: this.app },
        });
        return;
      }

      const nowDayMin = earliestDayKeyOf(this.clock.now());
      const nowDayMax = latestDayKeyOf(this.clock.now());
      const teenEligible = !this.teenStop && teenPartnerAge(prospect.birthKey, nowDayMin, nowDayMax);
      const persona = this.materializePersona(prospect, true);
      prospect.converted = true;
      this.world.spawn(persona, this.clock.now() + 5 * MINUTE);
      this.emitFunnel({
        stage: "signup_minor_restricted",
        city: prospect.city,
        armId,
        platform,
        desireLane: prospect.desireLane,
        isAdultVerified: false,
        metadata: { teenEligible, teenStop: this.teenStop },
      });
      return;
    }

    const persona = this.materializePersona(prospect, false);
    prospect.converted = true;
    const now = this.clock.now();
    this.world.spawn(persona, now + 5 * MINUTE);

    const arm = this.arms.get(armId);
    if (arm) {
      arm.verifiedAdults++;
      arm.alpha += 1;
    }
    if (this.currentDay >= 5) this.postCrackdownSignups++;

    this.attributionLedger.set(persona.id, {
      memberId: persona.id,
      prospectId: prospect.id,
      armId,
      platform,
      city: prospect.city,
      desireLane: prospect.desireLane,
      acquisitionCostCents,
      joinedAt: now,
      isAdultVerified: true,
      isMinorMember: false,
      meetingsConfirmed: 0,
    });

    this.emitFunnel({
      stage: "signup_verified_adult",
      city: prospect.city,
      armId,
      platform,
      desireLane: prospect.desireLane,
      memberId: persona.id,
      costCents: acquisitionCostCents,
      isAdultVerified: true,
    });

    if (this.mockBaseUrl) {
      await this.mockRequest("POST", "/beacon/v1/events", {
        events: [
          {
            type: "signup_completed",
            brand: this.app,
            city: prospect.city,
            armId,
            desireLane: prospect.desireLane,
            isAdultVerified: true,
            ts: now,
          },
        ],
      });
    }
  }

  private materializePersona(prospect: LatentProspect, minor: boolean): Persona {
    const seq = ++this.spawnSeq;
    const base = generatePersonas({
      n: 1,
      seed: hash32("spawn-persona", this.seed, prospect.id, seq),
      cities: [prospect.city],
      minorShare: 0,
      adversarialRate: 0,
      idPrefix: `u${seq}_`,
    })[0]!;
    base.name = prospect.name;
    base.homeCity = prospect.city;
    base.routine.homeArea = prospect.neighborhood;
    base.archetype = prospect.archetype;
    base.joinDay = Math.floor((this.clock.now() - this.startMs) / DAY);
    base.public.claimedAge = prospect.trueAge;
    base.public.birthKey = prospect.birthKey;
    base.hidden.trueAge = prospect.trueAge;
    base.hidden.flakiness = prospect.flakiness;
    if (minor) {
      base.hidden.romance.optIn = false;
      base.public.statedIntents = base.public.statedIntents.filter(i => i.category !== "romance");
      base.hidden.desires = base.hidden.desires.filter(d => d.category !== "romance");
    }
    return base;
  }

  private processWorldRecords(): void {
    const records = this.world.records;
    while (this.worldRecordCursor < records.length) {
      const rec = records[this.worldRecordCursor++]!;
      if (rec.type === "decision" && rec.decision === "accept") {
        const attr = this.attributionLedger.get(rec.memberId);
        if (attr && !attr.firstMatchAcceptedAt) {
          attr.firstMatchAcceptedAt = rec.t;
          this.emitFunnel({
            stage: "first_match_accepted",
            city: attr.city,
            armId: attr.armId,
            platform: attr.platform,
            desireLane: attr.desireLane,
            memberId: rec.memberId,
          });
        }
      } else if (rec.type === "outcome") {
        const minDay = earliestDayKeyOf(rec.at);
        const maxDay = latestDayKeyOf(rec.at);
        const participants = Object.keys(rec.attendance);
        const sides = participants.map(id => {
          const p = this.world.personaList().find(x => x.id === id);
          const adult = p ? canBeMatched(p.hidden.trueAge) : false;
          return { adult, ready: Boolean(p?.public.birthKey), birthKey: p?.public.birthKey ?? 0 };
        });
        const hasMinor = sides.some(s => !s.adult);
        if (hasMinor) {
          const sizeOk = teenRosterSizeAllowed(true, sides.length);
          const ageOk = groupAgeAllowed(!this.teenStop, teenFriendApp(this.app), minDay, maxDay, sides);
          if (!sizeOk || !ageOk) this.safety.teenRuleViolations++;
        }

        for (const [memberId, att] of Object.entries(rec.attendance)) {
          if (!att.showed || att.enjoyment < 0.5) continue;
          const prevCount = this.memberMeetingCounts.get(memberId) ?? 0;
          const nextCount = prevCount + 1;
          this.memberMeetingCounts.set(memberId, nextCount);

          const attr = this.attributionLedger.get(memberId);
          if (attr) {
            attr.meetingsConfirmed = nextCount;
            if (att.enjoyment >= GOOD_MEETING_ENJOYMENT && !attr.firstGoodMeetingAt) {
              attr.firstGoodMeetingAt = rec.t;
            }
            const arm = this.arms.get(attr.armId as BanditArmId);
            if (arm) {
              arm.verifiedT3Matches++;
              arm.alpha += 2;
            }
            this.emitFunnel({
              stage: "irl_meeting_confirmed",
              city: attr.city,
              armId: attr.armId,
              platform: attr.platform,
              desireLane: attr.desireLane,
              memberId,
              metadata: { enjoyment: Math.round(att.enjoyment * 100) / 100 },
            });
            if (nextCount === 2 && !attr.secondMeetupRetainedAt) {
              attr.secondMeetupRetainedAt = rec.t;
              this.emitFunnel({
                stage: "second_meetup_retained",
                city: attr.city,
                armId: attr.armId,
                platform: attr.platform,
                desireLane: attr.desireLane,
                memberId,
              });
            }
            if (att.enjoyment >= 0.7 && !this.organicReferrals.has(memberId)) {
              this.organicReferrals.add(memberId);
              this.spawnOrganicReferral(memberId, attr, rec.t);
            }
          }
        }
      } else if (rec.type === "opt_out") {
        const attr = this.attributionLedger.get(rec.memberId);
        if (attr) {
          attr.optedOutAt = rec.t;
          this.audience.fenceStop(attr.prospectId);
        }
      } else if (rec.type === "network_log" && rec.kind === "review_expired") {
        this.expiredReviewsCount++;
      }
    }
  }

  private spawnOrganicReferral(referrerId: MemberId, referrerAttr: AttributionRecord, now: number): void {
    const friends = this.audience.drawReachable({
      count: 1,
      city: referrerAttr.city,
      allowMinors: false,
      now,
    });
    if (friends.length === 0) return;
    const friend = friends[0]!;
    if (!canBeMatched(friend.trueAge) || friend.isSybil || friend.isVoip) return;
    const persona = this.materializePersona(friend, false);
    persona.invitedBy = referrerId;
    friend.converted = true;
    this.world.spawn(persona, now + 2 * HOUR);
    this.attributionLedger.set(persona.id, {
      memberId: persona.id,
      prospectId: friend.id,
      armId: "organic_referral",
      platform: "sms",
      city: friend.city,
      desireLane: friend.desireLane,
      acquisitionCostCents: 0,
      joinedAt: now,
      isAdultVerified: true,
      isMinorMember: false,
      referrerMemberId: referrerId,
      meetingsConfirmed: 0,
    });
    this.emitFunnel({
      stage: "referral_generated",
      city: friend.city,
      armId: "organic_referral",
      platform: "sms",
      desireLane: friend.desireLane,
      memberId: persona.id,
      metadata: { referrerId },
    });
    this.emitFunnel({
      stage: "signup_verified_adult",
      city: friend.city,
      armId: "organic_referral",
      platform: "sms",
      desireLane: friend.desireLane,
      memberId: persona.id,
      costCents: 0,
      isAdultVerified: true,
    });
  }

  private async handleWorldEvent(
    event: "viral_mention" | "sybil_ring_attack" | "minor_wave" | "venue_closure" | "opt_out",
    city: City,
  ): Promise<void> {
    if (event === "viral_mention") {
      this.viralMultiplier = Math.max(this.viralMultiplier, 8);
      const arm = this.arms.get("social_organic");
      if (arm) await this.runArmTick(arm, city, 6);
    } else if (event === "sybil_ring_attack") {
      this.sybilSurgeFactor = Math.max(this.sybilSurgeFactor, 5);
      await this.runAdversarialAndAgeProbes(this.clock.now());
    } else if (event === "minor_wave") {
      this.minorSurgeFactor = Math.max(this.minorSurgeFactor, 5);
      await this.runAdversarialAndAgeProbes(this.clock.now());
    } else if (event === "venue_closure") {
      this.closedVenueCount++;
    } else if (event === "opt_out") {
      const first = this.world.personaList()[0];
      if (first) this.world.act({ do: "opt_out", persona: first.id });
    }
    this.recordAudit("director", `world_event:${event}`, { city });
  }

  private async saveCheckpoint(day: number): Promise<void> {
    const score = this.getScorecard();
    const record: SimCheckpointRecord = {
      version: 1,
      runId: this.runId,
      scenarioId: this.scenario.id,
      day,
      ts: this.clock.now(),
      spentCents: this.spentCents,
      riskDial: this.riskDial,
      teenStop: this.teenStop,
      arms: [...this.arms.values()].map(a => ({ ...a })),
      safety: { ...score.safety },
      activeChaosIds: [...this.chaosRules.keys()],
      verifiedAdultCount: score.acquisition.verifiedAdultSignups,
      goodMeetingsCount: score.matching.goodMeetings,
      httpSummary: { ...this.httpSummary },
    };
    this.checkpoints.set(day, record);

    if (this.mockBaseUrl && this.scenario.enableS3Checkpoints) {
      const res = await this.mockRequest(
        "PUT",
        `/s3/${this.s3Bucket}/${this.runId}/day-${day}.json`,
        record,
        { "Content-Type": "application/json" },
      );
      if (res && res.ok) this.httpSummary.s3CheckpointsWritten++;
    }

    this.emitSpan({
      kind: "checkpoint",
      status: "ok",
      latencyMs: 0,
      costMicro: 0,
      detail: { day, spentCents: this.spentCents, verifiedAdults: record.verifiedAdultCount },
    });
  }

  private async mockPost(path: string, body: unknown): Promise<Response | undefined> {
    return this.mockRequest("POST", path, body);
  }

  private async mockRequest(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    redirect: RequestRedirect = "follow",
  ): Promise<Response | undefined> {
    if (!this.mockBaseUrl) return undefined;
    const t0 = performance.now();
    this.httpSummary.totalRequests++;
    const headers: Record<string, string> = {
      "X-Mock-Session": this.mockSessionId,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders ?? {}),
    };
    try {
      const res = await fetch(`${this.mockBaseUrl}${path}`, {
        method,
        headers,
        redirect,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (res.status >= 200 && res.status < 400) this.httpSummary.okResponses++;
      else if (res.status === 429) this.httpSummary.rateLimited429++;
      else if (res.status === 403) this.httpSummary.forbidden403++;
      else if (res.status >= 500) this.httpSummary.serverErrors5xx++;

      this.emitSpan({
        kind: "marketing_http",
        status: res.status >= 500 || res.status === 429 ? "error" : res.status === 403 ? "blocked" : "ok",
        latencyMs,
        costMicro: 0,
        detail: { method, path, status: res.status },
      });
      return res;
    } catch {
      this.httpSummary.networkErrors++;
      this.emitSpan({
        kind: "marketing_http",
        status: "error",
        latencyMs: Math.round(performance.now() - t0),
        costMicro: 0,
        detail: { method, path, error: "network_error" },
      });
      return undefined;
    }
  }

  private emitFunnel(event: Omit<UnifiedFunnelEvent, "seq" | "ts" | "app">): void {
    this.funnelCounts[event.stage]++;
    const full: UnifiedFunnelEvent = {
      seq: ++this.funnelSeq,
      ts: this.clock.now(),
      app: this.app,
      ...event,
    };
    this.funnelEvents.push(full);
    this.onFunnelEvent?.(full);
  }

  private emitSpan(span: Omit<UnifiedTrajectorySpan, "spanId" | "traceId" | "ts">): void {
    if (!this.onTrajectorySpan) return;
    const seq = ++this.spanSeq;
    this.onTrajectorySpan({
      spanId: `${this.runId}-sp-${seq}`,
      traceId: `${this.runId}-day-${this.currentDay}`,
      ts: this.clock.now(),
      ...span,
    });
  }

  private recordAudit(actor: string, action: string, detail: Record<string, string | number | boolean>): void {
    this.auditLog.push({
      seq: ++this.auditSeq,
      ts: this.clock.now(),
      actor,
      action,
      detail,
    });
  }
}
