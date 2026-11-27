// Shared domain types for @thenetwork/marketing matching docs/marketing/PRD.md
// and the PostgreSQL marketing.* schema (Pass 2 canonical source of truth).

import type { Clock } from "../../../packages/core/src/clock.ts";

export type { Clock };

export type AppId = "slop" | "peon" | "friends" | "ntwrk" | "all";
export type BrandAppId = "slop" | "peon" | "friends" | "ntwrk";
export type SupportedCity = "nyc" | "sf" | "la" | "chicago" | "miami" | "austin" | "london";
export type CityCode = string;
export type ImplementationTier = 1 | 2 | 3 | 4;

export type CoreDesireLaneId =
  | "love_dating"
  | "friends_belonging"
  | "career_money"
  | "status_scenes"
  | "builders_founders"
  | "creative_cultural"
  | "fitness_sports"
  | "local_hosts"
  | "campus_early_career"
  | "diaspora_newcomers";

export type DesireLaneId = CoreDesireLaneId | (string & {});

export type CityLaunchStage =
  | "scout"
  | "seed_waitlist"
  | "soft_launch"
  | "density_growth"
  | "mature";

export type LlmTrajectoryStatus =
  | "ok"
  | "cached"
  | "fallback"
  | "budget_blocked"
  | "leak_blocked"
  | "error";

export type ContactTouchSurface = "outreach" | "vip" | "bd" | "agent";

export type RiskZone = "zone_1_green" | "zone_2_amber" | "zone_3_red";
export type RiskDial = "conservative" | "balanced" | "blitz" | "lockdown";

export type SubscriptionProvider = "chatgpt" | "claude" | "gemini" | "surplus";
export type AgentAuthMode = "cli" | "mcp" | "oauth" | "browser" | "api";
export type PersonaId = "chadwick" | "sloane" | "peon" | "venn" | "operator";
export type AgentStatus = "idle" | "running" | "cooldown" | "rate_limited" | "paused_stop";

export type DevicePlatform = "macbook" | "android" | "ios";
export type DeviceWarmupStage = "birth_passive" | "light_organic" | "branded_cadence" | "steady_state";
export type DeviceStatus =
  | "online"
  | "leased"
  | "charging_wait"
  | "thermal_cooldown"
  | "needs_takeover"
  | "offline";

export type PayoutRail = "none" | "fiat_stripe" | "fiat_tremendous" | "usdc_direct" | "slop_cash";

export type TaskKind =
  | "street_fliering"
  | "event_activation"
  | "creator_video"
  | "agency_booking"
  | "print_order"
  | "digital_outreach"
  | "oss_dev_bounty";

export type VendorChannel =
  | "craigslist"
  | "rentahuman"
  | "agency_email"
  | "creator_direct"
  | "print_api"
  | "internal"
  | "slop_cash";

export type TaskStatus =
  | "drafted"
  | "posted_or_emailed"
  | "applicant_screened"
  | "contract_sent"
  | "hired"
  | "shift_active"
  | "proof_submitted"
  | "proof_verified"
  | "payout_queued"
  | "paid"
  | "disputed"
  | "cancelled";

export type ProofKind =
  | "street_shift"
  | "creator_video"
  | "event_checkin"
  | "print_receipt"
  | "oss_pr_merge";

export type ProofVerdict = "pending" | "verified" | "rejected";

export type HumanRole =
  | "applicant"
  | "street_worker"
  | "creator"
  | "agency"
  | "venue"
  | "vip";

export type OutreachChannel =
  | "email"
  | "craigslist"
  | "rentahuman"
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "venue"
  | "sms_opted_in";

export type OutreachStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "replied"
  | "blocked_stop"
  | "blocked_policy"
  | "failed";

export type BudgetEntryType = "dry_run" | "reserve" | "commit" | "release" | "refund";

export type SlopCashHookState =
  | "disabled_stub"
  | "ready_for_sync"
  | "manifest_submitted"
  | "month_closed"
  | "settled_onchain"
  | "rejected";

export type SlopCashVaultChain = "base" | "solana" | "robinhood_4663";

export type BanditArmStatus = "active" | "killed" | "paused";

export type BdDealStage =
  | "prospect"
  | "enriched"
  | "pitched"
  | "negotiating"
  | "contracted"
  | "kit_shipped"
  | "live"
  | "audited"
  | "closed_lost";

export type QrBatchAssigneeType = "human" | "bd_deal";

export type VipProspectStatus =
  | "discovered"
  | "scored"
  | "drafted"
  | "invited"
  | "replied"
  | "onboarded"
  | "declined";

export type VideoAssetStage =
  | "trend"
  | "script"
  | "voice_render"
  | "qa"
  | "published"
  | "measured"
  | "killed";

export type PhoneLineType = "postpaid" | "prepaid" | "mvno" | "voip" | "landline" | "unknown";

export type AntiFraudClaimStatus = "vesting" | "approved" | "quarantined" | "rejected";

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  city: string;
  appId: AppId;
  desireLane?: DesireLaneId | null;
  riskZone: RiskZone;
  riskDial: RiskDial;
  monthlyBudgetCents: number;
  dailyCapCents: number;
  maxTaskCents: number;
  reservedCents: number;
  spentCents: number;
  dailySpentCents: number;
  billingArmed: boolean;
  slopCashEnabled: boolean;
  status: "draft" | "active" | "paused" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface MarketingAgent {
  id: string;
  personaId: PersonaId;
  displayName: string;
  appId: BrandAppId;
  provider: SubscriptionProvider;
  failoverProvider: SubscriptionProvider | null;
  authMode: AgentAuthMode;
  sessionRef: string;
  sessionHealthy: boolean;
  dailyTurnCap: number;
  turnsUsedToday: number;
  cooldownUntil: string | null;
  status: AgentStatus;
  updatedAt: string;
}

export interface DeviceNode {
  id: string;
  label: string;
  platform: DevicePlatform;
  hostMachine: string;
  serialOrUdid: string;
  assignedPersona: PersonaId | null;
  simCarrier: string | null;
  batteryPct: number;
  tempC: number;
  warmupDay: number;
  warmupStage: DeviceWarmupStage;
  dailyActionsUsed: number;
  dailyActionCap: number;
  leaseHolder: string | null;
  leaseExpiresAt: string | null;
  status: DeviceStatus;
  lastSeenAt: string;
}

export interface ChannelAccount {
  id: string;
  agentId: string;
  deviceId: string | null;
  channel: OutreachChannel;
  handle: string;
  city: string;
  warmupDay: number;
  dailyOutreachCap: number;
  sentToday: number;
  status: "warming" | "active" | "cooldown" | "suspended" | "disabled";
  createdAt: string;
}

export interface HumanPartner {
  id: string;
  handleOrEmailHmac: string;
  contactEmail?: string | null;
  displayLabel: string;
  channel: OutreachChannel;
  role: HumanRole;
  city: string;
  lowestAge: number | null;
  stopped: boolean;
  banned: boolean;
  stopReason: string | null;
  dailySendsToday: number;
  lastContactedAt: string | null;
  createdAt: string;
}

export interface MarketingTask {
  id: string;
  campaignId: string;
  tier: ImplementationTier;
  taskKind: TaskKind;
  city: string;
  desireLane?: DesireLaneId | null;
  title: string;
  briefText: string;
  vendorChannel: VendorChannel;
  assigneeHumanId: string | null;
  assigneeAgeYears: number | null;
  amountCents: number;
  qrBatchCode: string | null;
  dubShortUrl: string | null;
  payoutRail: PayoutRail;
  proofVerified: boolean;
  status: TaskStatus;
  createdAt: string;
  paidAt: string | null;
}

export interface ProofSubmission {
  id: string;
  taskId: string;
  proofKind: ProofKind;
  evidenceUrl: string | null;
  checkinMediaHashes: string[];
  qrScansCount: number;
  verifiedSignupsCount: number;
  ftcDisclosed: boolean;
  geoTimeValid: boolean;
  likenessReleaseOk: boolean;
  verdict: ProofVerdict;
  verifierNotes: string | null;
  createdAt: string;
}

export interface OutreachMessage {
  id: string;
  campaignId: string;
  agentId: string;
  humanId: string;
  channel: OutreachChannel;
  tier: ImplementationTier;
  subject: string | null;
  bodySummary: string;
  leakCheckPass: boolean;
  status: OutreachStatus;
  externalRef: string | null;
  createdAt: string;
}

export type AttributionEventKind =
  | "qr_scan"
  | "site_visit"
  | "signup_started"
  | "signup_verified_adult"
  | "video_view"
  | "first_match_accepted"
  | "irl_meeting_confirmed"
  | "second_meetup_retained"
  | "intro_or_hire_unlocked"
  | "t3_match_verified";

export interface AttributionEvent {
  id: string;
  campaignId: string;
  taskId: string | null;
  armId?: string | null;
  desireLane?: DesireLaneId | null;
  qrBatchCode: string | null;
  eventKind: AttributionEventKind;
  city: string;
  appId: BrandAppId;
  count: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BudgetEntry {
  id: string;
  campaignId: string;
  taskId: string | null;
  adapterId: string;
  tier: ImplementationTier;
  amountCents: number;
  entryType: BudgetEntryType;
  fromReserve?: boolean;
  idempotencyKey: string;
  externalRef: string | null;
  createdAt: string;
}

export interface SlopCashHook {
  id: string;
  taskId: string;
  repoSlug: string;
  issueNumber: number | null;
  vaultChain: SlopCashVaultChain;
  estimatedUsdcCents: number;
  hookState: SlopCashHookState;
  externalTxHash: string | null;
  createdAt: string;
}

export interface BanditArm {
  id: string;
  campaignId: string;
  armKey: string;
  label: string;
  track: string;
  desireLane?: DesireLaneId | null;
  alpha: number;
  beta: number;
  weight: number;
  spendCents: number;
  signups: number;
  verifiedOutcomes?: number;
  stopEvents: number;
  totalContacts: number;
  status: BanditArmStatus;
  updatedAt: string;
}

export interface BdDeal {
  id: string;
  campaignId: string;
  city: string;
  desireLane?: DesireLaneId | null;
  venueName: string;
  vertical: AppId;
  contactEmail: string | null;
  businessPhone: string | null;
  stage: BdDealStage;
  offeredCents: number;
  phoneCallbackVerified: boolean;
  contractHash: string | null;
  qrBatchId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrBatch {
  id: string;
  campaignId: string;
  city: string;
  batchCode: string;
  destinationUrl: string;
  dubLinkId: string | null;
  printQty: number;
  assignedToType: QrBatchAssigneeType | null;
  assignedToId: string | null;
  scans: number;
  verifiedSignups: number;
  createdAt: string;
}

export interface VipProspect {
  id: string;
  campaignId: string;
  city: string;
  desireLane?: DesireLaneId | null;
  name: string;
  archetype: string;
  organization: string | null;
  publicSource: string;
  sourceUrl: string | null;
  prestigeScore: number;
  contactEmail: string | null;
  inviteDraft: string | null;
  status: VipProspectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VideoAsset {
  id: string;
  campaignId: string;
  agentId: string | null;
  desireLane?: DesireLaneId | null;
  title: string;
  hook: string;
  script: string;
  stage: VideoAssetStage;
  videoUrl: string | null;
  platform: string | null;
  views: number;
  retention3sPct: number;
  signups: number;
  ftcDisclosed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AntiFraudClaim {
  id: string;
  campaignId: string;
  personKey: string;
  workerId: string | null;
  taskId: string | null;
  phoneLineType: PhoneLineType;
  mediaHash: string | null;
  clusterId: string | null;
  vestingTier: number;
  amountCents: number;
  status: AntiFraudClaimStatus;
  reason: string | null;
  createdAt: string;
}

export interface DiscoveredLead {
  dedupeKey: string;
  city: string;
  vertical: BrandAppId;
  category: "venue" | "event" | "creator" | "vip" | "community";
  title: string;
  source: string;
  sourceUrl: string;
  contactHint: string | null;
  score: number;
  discoveredAt: string;
}

export interface DesireLane {
  id: DesireLaneId;
  label: string;
  appId: BrandAppId;
  universalDesire: string;
  copyAngles: string[];
  vipArchetypes: string[];
  venueCategories: string[];
  videoFormats: string[];
  discoveryQueries: string[];
  adultOnly: true;
}

export interface CityPack {
  code: string;
  name: string;
  country: string;
  region: string;
  currency: string;
  locale: string;
  tz: string;
  platformActive: boolean;
  stage: CityLaunchStage;
  targetAdultDensity: number;
  neighborhoods: string[];
  culturalHooks: string[];
  venues: string[];
  localMedia: string[];
  universities: string[];
  desireLaneWeights: Record<string, number>;
  complianceNotes: string[];
  updatedAt?: string;
}

export interface CityPackOverride {
  code: string;
  stage: CityLaunchStage;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface LlmTrajectory {
  id: string;
  agentId: string | null;
  campaignId: string | null;
  provider: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
  costMicros: number;
  latencyMs: number;
  status: LlmTrajectoryStatus;
  failoverChain: string | null;
  leakBlocked: boolean;
  createdAt: string;
}

export type LlmTrajectoryRecord = LlmTrajectory;

export interface DailyLlmUsage {
  day: string;
  calls: number;
  cachedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costMicros: number;
  leakBlockedCalls: number;
  budgetBlockedCalls: number;
}

export interface ContactSuppression {
  contactHash: string;
  reason: string;
  sourceChannel: string;
  isMinor: boolean;
  suppressedAt: string;
}

export type ContactSuppressionRecord = ContactSuppression;

export interface ContactTouchpoint {
  id: string;
  contactHash: string;
  campaignId: string | null;
  surface: ContactTouchSurface;
  isCold: boolean;
  replied: boolean;
  touchedAt: string;
}

export interface ContactTouchpointStats {
  contactHash: string;
  daysSinceLastCold: number;
  coldTouches30d: number;
  unansweredColdStreak: number;
  opTouchesToday: number;
  lastTouchedAt: string | null;
}

export interface ContactFenceVerdict {
  allowed: boolean;
  banned: boolean;
  globallyStopped: boolean;
  knownMinor: boolean;
  recycledHold: boolean;
  reason?: string;
  source: "platform_pg" | "standalone_fallback";
}

export type NetworkFenceVerdict = ContactFenceVerdict;

export interface CityAppDemandSignal {
  appId: BrandAppId;
  city: string;
  activeAdultBucket: number;
  matchingEnabled: boolean;
  openReviewCount: number;
  overdueReviewCount: number;
  outboundWaitingCount: number;
  lineRestricted: boolean;
  closedVenueCount: number;
  queuePressurePaused: boolean;
}

export interface NetworkSupplyDemandSnapshot {
  capturedAt: string;
  source: "platform_pg" | "standalone_fallback";
  signals: CityAppDemandSignal[];
  anyQueuePressurePaused: boolean;
  anyLineRestricted: boolean;
}

export interface BdVenueCandidate {
  id: string;
  dealId: string;
  city: string;
  platformActiveCity: boolean;
  neighborhood: string;
  name: string;
  address: string;
  category: string;
  vertical: BrandAppId;
  isPublic: true;
  allAges: false;
  ageMin: number;
  isBarOnly: boolean;
  isAlcoholCentric: boolean;
  alcoholOptional: boolean;
  groupScore: number;
  dateScore: number;
  personaPriors: Record<string, never>;
  source: "marketing_bd_partner";
  contactEmail: string | null;
  businessPhone: string | null;
  contractHash: string;
  qrBatchId: string | null;
  createdAt: string;
}
