// Shared domain types for @thenetwork/marketing matching docs/marketing/PRD.md
// and the PostgreSQL marketing.* schema.

export type AppId = "slop" | "peon" | "friends" | "ntwrk" | "all";
export type BrandAppId = "slop" | "peon" | "friends" | "ntwrk";
export type ImplementationTier = 1 | 2 | 3 | 4;

export type RiskZone = "zone_1_green" | "zone_2_amber" | "zone_3_red";
export type RiskDial = "conservative" | "balanced" | "blitz" | "lockdown";

export type SubscriptionProvider = "chatgpt" | "claude" | "gemini" | "surplus";
export type AgentAuthMode = "cli" | "mcp" | "oauth" | "browser" | "api";
export type PersonaId = "chadwick" | "sloane" | "peon" | "venn" | "operator";
export type AgentStatus = "idle" | "running" | "cooldown" | "rate_limited" | "paused_stop";

export type DevicePlatform = "android" | "ios";
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

export interface Clock {
  now(): number;
}

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  city: string;
  appId: AppId;
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

export interface AttributionEvent {
  id: string;
  campaignId: string;
  taskId: string | null;
  qrBatchCode: string | null;
  eventKind: "qr_scan" | "site_visit" | "signup_started" | "signup_verified_adult" | "video_view";
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
