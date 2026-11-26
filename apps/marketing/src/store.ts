// Persistent and in-memory stores for @thenetwork/marketing (Node 26).
// Enforces Vibestack-generated proved policies from packages/core/src/generated/
// on every state transition and maps cleanly onto the PostgreSQL marketing.* schema.

import { randomUUID } from "node:crypto";
import { RealClock } from "../../../packages/core/src/clock.ts";
import {
  canExecuteDeviceAction,
  deviceBatterySafe,
  warmupDailyCap,
} from "../../../packages/core/src/generated/marketingDevice.ts";
import {
  adultParticipantAge,
  canApproveProof,
  canAuthorizeSpend,
  canDispatchAgentTurn,
  canSendOutreach,
} from "../../../packages/core/src/generated/marketingPolicy.ts";
import { fileAt } from "../../../packages/core/src/runtime/files.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import type {
  AgentAuthMode,
  AgentStatus,
  AppId,
  AttributionEvent,
  BrandAppId,
  BudgetEntry,
  BudgetEntryType,
  Campaign,
  ChannelAccount,
  Clock,
  DeviceNode,
  DevicePlatform,
  DeviceStatus,
  DeviceWarmupStage,
  HumanPartner,
  HumanRole,
  ImplementationTier,
  MarketingAgent,
  MarketingTask,
  OutreachChannel,
  OutreachMessage,
  OutreachStatus,
  PayoutRail,
  PersonaId,
  ProofKind,
  ProofSubmission,
  ProofVerdict,
  RiskDial,
  RiskZone,
  SlopCashHook,
  SlopCashHookState,
  SlopCashVaultChain,
  SubscriptionProvider,
  TaskKind,
  TaskStatus,
  VendorChannel,
} from "./types.ts";

export class PolicyViolationError extends Error {
  readonly code: string;
  readonly invariant: string;

  constructor(code: string, invariant: string, message: string) {
    super(message);
    this.name = "PolicyViolationError";
    this.code = code;
    this.invariant = invariant;
  }
}

export interface CreateCampaignInput {
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
  status?: Campaign["status"];
}

export interface UpdateCampaignInput {
  name?: string;
  city?: string;
  riskZone?: RiskZone;
  riskDial?: RiskDial;
  monthlyBudgetCents?: number;
  dailyCapCents?: number;
  maxTaskCents?: number;
  billingArmed?: boolean;
  slopCashEnabled?: boolean;
  status?: Campaign["status"];
}

export interface UpsertAgentInput {
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
  cooldownUntil?: string | null;
  status?: AgentStatus;
}

export interface ConsumeAgentTurnInput {
  agentId: string;
  campaignId?: string | null;
  targetHumanId?: string | null;
  targetStopped?: boolean;
  lockdown?: boolean;
}

export interface ConsumeAgentTurnResult {
  allowed: boolean;
  agent: MarketingAgent;
  reason?: string;
}

export interface UpsertDeviceInput {
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
  leaseHolder?: string | null;
  leaseExpiresAt?: string | null;
  status?: DeviceStatus;
}

export interface DeviceTelemetryUpdate {
  batteryPct: number;
  tempC: number;
  warmupDay?: number;
  status?: DeviceStatus;
}

export interface RecordDeviceActionInput {
  deviceId: string;
  leaseHolder: string;
  lockdown?: boolean;
  targetHumanId?: string | null;
  targetStopped?: boolean;
}

export interface DeviceActionReceipt {
  allowed: boolean;
  device: DeviceNode;
  reason?: string;
}

export interface UpsertChannelAccountInput {
  id?: string;
  agentId: string;
  deviceId?: string | null;
  appId?: AppId;
  channel: OutreachChannel;
  handle: string;
  city?: string;
  warmupDay?: number;
  dailyOutreachCap?: number;
  sentToday?: number;
  status?: ChannelAccount["status"];
}

export interface UpsertHumanInput {
  id?: string;
  handleOrEmailHmac: string;
  displayLabel: string;
  channel: OutreachChannel;
  role: HumanRole;
  city?: string;
  lowestAge?: number | null;
  stopped?: boolean;
  banned?: boolean;
  stopReason?: string | null;
  dailySendsToday?: number;
  lastContactedAt?: string | null;
}

export interface CreateTaskInput {
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
  slopCashEnvEnabled?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  briefText?: string;
  assigneeHumanId?: string | null;
  assigneeAgeYears?: number | null;
  amountCents?: number;
  qrBatchCode?: string | null;
  dubShortUrl?: string | null;
  payoutRail?: PayoutRail;
  proofVerified?: boolean;
  status?: TaskStatus;
  paidAt?: string | null;
}

export interface CreateProofInput {
  id?: string;
  taskId: string;
  proofKind: ProofKind;
  evidenceUrl?: string | null;
  checkinMediaHashes?: string[];
  qrScansCount?: number;
  verifiedSignupsCount?: number;
  ftcDisclosed?: boolean;
  geoTimeValid?: boolean;
  likenessReleaseOk?: boolean;
  verifierNotes?: string | null;
}

export interface EvaluateProofOptions {
  workerAge: number;
  workerBanned: boolean;
  shiftDone?: boolean;
  verifierNotes?: string | null;
}

export interface EvaluateProofResult {
  proof: ProofSubmission;
  task: MarketingTask;
  approved: boolean;
  reason?: string;
}

export interface CreateOutreachInput {
  id?: string;
  campaignId: string;
  agentId: string;
  humanId: string;
  channelAccountId?: string | null;
  channel: OutreachChannel;
  tier: ImplementationTier;
  subject?: string | null;
  bodySummary: string;
  leakCheckPass: boolean;
  desiredStatus?: "queued" | "sent" | "delivered";
  externalRef?: string | null;
  dailyOutreachCap?: number;
}

export interface CreateAttributionEventInput {
  id?: string;
  campaignId: string;
  taskId?: string | null;
  qrBatchCode?: string | null;
  eventKind: AttributionEvent["eventKind"];
  city?: string;
  appId: BrandAppId;
  count?: number;
  metadata?: Record<string, unknown>;
}

export interface AuthorizeSpendInput {
  campaignId: string;
  taskId?: string | null;
  adapterId: string;
  tier: ImplementationTier;
  amountCents: number;
  entryType: BudgetEntryType;
  idempotencyKey: string;
  externalRef?: string | null;
  useSlopCash?: boolean;
  slopCashEnvEnabled?: boolean;
  fromReserve?: boolean;
}

export interface AuthorizeSpendResult {
  entry: BudgetEntry;
  campaign: Campaign;
  replayed: boolean;
}

export interface MarkTaskPaidOptions {
  adapterId: string;
  idempotencyKey: string;
  externalRef?: string | null;
  slopCashEnvEnabled?: boolean;
  fromReserve?: boolean;
}

export interface UpsertSlopCashHookInput {
  id?: string;
  taskId: string;
  repoSlug?: string;
  issueNumber?: number | null;
  vaultChain?: SlopCashVaultChain;
  estimatedUsdcCents: number;
  hookState?: SlopCashHookState;
  externalTxHash?: string | null;
  enabled?: boolean;
}

export interface MarketingOverview {
  generatedAt: string;
  campaigns: {
    total: number;
    active: number;
    billingArmedCount: number;
    lockdownCount: number;
    slopCashEnabledCount: number;
  };
  budget: {
    monthlyBudgetCents: number;
    dailyCapCents: number;
    reservedCents: number;
    spentCents: number;
    dailySpentCents: number;
    remainingMonthlyCents: number;
  };
  agents: {
    total: number;
    healthy: number;
    paused: number;
    rateLimited: number;
    turnsUsedToday: number;
    dailyTurnCapTotal: number;
    byProvider: Record<SubscriptionProvider, number>;
  };
  devices: {
    total: number;
    online: number;
    leased: number;
    needsTakeover: number;
    actionsUsedToday: number;
  };
  humans: {
    total: number;
    stopped: number;
    banned: number;
    verifiedAdults: number;
  };
  tasks: {
    total: number;
    open: number;
    proofVerified: number;
    paid: number;
    disputed: number;
  };
  proofs: {
    total: number;
    pending: number;
    verified: number;
    rejected: number;
  };
  outreach: {
    total: number;
    queued: number;
    sent: number;
    blockedStop: number;
    blockedPolicy: number;
  };
  attribution: {
    qrScans: number;
    siteVisits: number;
    signupsStarted: number;
    verifiedAdultSignups: number;
    videoViews: number;
    blendedCpaCents: number | null;
  };
  slopCashHooks: {
    total: number;
    disabledStubCount: number;
    settledCount: number;
  };
}

export interface MarketingStore {
  readonly clock: Clock;
  close(): Promise<void>;

  createCampaign(input: CreateCampaignInput): Promise<Campaign>;
  getCampaign(id: string): Promise<Campaign | null>;
  getCampaignBySlug(slug: string): Promise<Campaign | null>;
  listCampaigns(filter?: { city?: string; appId?: AppId; status?: Campaign["status"] }): Promise<Campaign[]>;
  updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign>;
  setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign>;

  upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent>;
  getAgent(id: string): Promise<MarketingAgent | null>;
  getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null>;
  listAgents(): Promise<MarketingAgent[]>;
  updateAgent(id: string, patch: Partial<Omit<MarketingAgent, "id" | "personaId">>): Promise<MarketingAgent>;
  consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult>;

  upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode>;
  getDevice(id: string): Promise<DeviceNode | null>;
  listDevices(): Promise<DeviceNode[]>;
  updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode>;
  acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts?: { lockdown?: boolean; targetStopped?: boolean },
  ): Promise<DeviceNode>;
  releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode>;
  recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt>;

  upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount>;
  getChannelAccount(id: string): Promise<ChannelAccount | null>;
  listChannelAccounts(filter?: { agentId?: string; channel?: OutreachChannel }): Promise<ChannelAccount[]>;

  upsertHuman(input: UpsertHumanInput): Promise<HumanPartner>;
  getHuman(id: string): Promise<HumanPartner | null>;
  getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null>;
  listHumans(filter?: { city?: string; role?: HumanRole; stopped?: boolean }): Promise<HumanPartner[]>;
  markHumanStopped(id: string, reason: string): Promise<HumanPartner>;
  markHumanBanned(id: string, reason: string): Promise<HumanPartner>;
  recordHumanAge(id: string, age: number): Promise<HumanPartner>;

  createTask(input: CreateTaskInput): Promise<MarketingTask>;
  getTask(id: string): Promise<MarketingTask | null>;
  listTasks(filter?: {
    campaignId?: string;
    status?: TaskStatus;
    taskKind?: TaskKind;
    city?: string;
  }): Promise<MarketingTask[]>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask>;
  markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }>;

  createProof(input: CreateProofInput): Promise<ProofSubmission>;
  getProof(id: string): Promise<ProofSubmission | null>;
  listProofs(filter?: { taskId?: string; verdict?: ProofVerdict }): Promise<ProofSubmission[]>;
  evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult>;

  createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage>;
  listOutreachMessages(filter?: {
    campaignId?: string;
    humanId?: string;
    agentId?: string;
    status?: OutreachStatus;
  }): Promise<OutreachMessage[]>;
  updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
  ): Promise<OutreachMessage>;

  recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent>;
  listAttributionEvents(filter?: {
    campaignId?: string;
    taskId?: string;
    qrBatchCode?: string;
    appId?: BrandAppId;
  }): Promise<AttributionEvent[]>;

  authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult>;
  listBudgetEntries(filter?: {
    campaignId?: string;
    taskId?: string;
    entryType?: BudgetEntryType;
  }): Promise<BudgetEntry[]>;

  upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook>;
  getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null>;
  listSlopCashHooks(): Promise<SlopCashHook[]>;

  resetDailyCounters(): Promise<void>;
  getOverview(campaignId?: string): Promise<MarketingOverview>;
}

const DEFAULT_MONTHLY_BUDGET_CENTS = 1_000_000;
const DEFAULT_DAILY_CAP_CENTS = 100_000;
const DEFAULT_MAX_TASK_CENTS = 150_000;
const DEFAULT_DAILY_OUTREACH_CAP = 50;

function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

function utcDayStartIso(clock: Clock): string {
  const d = new Date(clock.now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function defaultId(): string {
  return randomUUID();
}

function warmupStageForDay(warmupDay: number): DeviceWarmupStage {
  if (warmupDay < 1) return "birth_passive";
  if (warmupDay <= 3) return "light_organic";
  if (warmupDay <= 14) return "branded_cadence";
  return "steady_state";
}

function minAge(existing: number | null, incoming: number | null | undefined): number | null {
  if (incoming === null || incoming === undefined) return existing;
  if (existing === null) return incoming;
  return Math.min(existing, incoming);
}

function buildOverview(
  nowIso: string,
  campaigns: Campaign[],
  agents: MarketingAgent[],
  devices: DeviceNode[],
  humans: HumanPartner[],
  tasks: MarketingTask[],
  proofs: ProofSubmission[],
  outreach: OutreachMessage[],
  attribution: AttributionEvent[],
  hooks: SlopCashHook[],
): MarketingOverview {
  const monthlyBudgetCents = campaigns.reduce((s, c) => s + c.monthlyBudgetCents, 0);
  const dailyCapCents = campaigns.reduce((s, c) => s + c.dailyCapCents, 0);
  const reservedCents = campaigns.reduce((s, c) => s + c.reservedCents, 0);
  const spentCents = campaigns.reduce((s, c) => s + c.spentCents, 0);
  const dailySpentCents = campaigns.reduce((s, c) => s + c.dailySpentCents, 0);

  const byProvider: Record<SubscriptionProvider, number> = {
    chatgpt: 0,
    claude: 0,
    gemini: 0,
    surplus: 0,
  };
  for (const a of agents) byProvider[a.provider] += 1;

  let qrScans = 0;
  let siteVisits = 0;
  let signupsStarted = 0;
  let verifiedAdultSignups = 0;
  let videoViews = 0;
  for (const e of attribution) {
    if (e.eventKind === "qr_scan") qrScans += e.count;
    else if (e.eventKind === "site_visit") siteVisits += e.count;
    else if (e.eventKind === "signup_started") signupsStarted += e.count;
    else if (e.eventKind === "signup_verified_adult") verifiedAdultSignups += e.count;
    else if (e.eventKind === "video_view") videoViews += e.count;
  }

  return {
    generatedAt: nowIso,
    campaigns: {
      total: campaigns.length,
      active: campaigns.filter((c) => c.status === "active").length,
      billingArmedCount: campaigns.filter((c) => c.billingArmed).length,
      lockdownCount: campaigns.filter((c) => c.riskDial === "lockdown").length,
      slopCashEnabledCount: campaigns.filter((c) => c.slopCashEnabled).length,
    },
    budget: {
      monthlyBudgetCents,
      dailyCapCents,
      reservedCents,
      spentCents,
      dailySpentCents,
      remainingMonthlyCents: Math.max(0, monthlyBudgetCents - reservedCents - spentCents),
    },
    agents: {
      total: agents.length,
      healthy: agents.filter((a) => a.sessionHealthy && a.status !== "paused_stop").length,
      paused: agents.filter((a) => a.status === "paused_stop").length,
      rateLimited: agents.filter((a) => a.status === "rate_limited" || a.status === "cooldown").length,
      turnsUsedToday: agents.reduce((s, a) => s + a.turnsUsedToday, 0),
      dailyTurnCapTotal: agents.reduce((s, a) => s + a.dailyTurnCap, 0),
      byProvider,
    },
    devices: {
      total: devices.length,
      online: devices.filter((d) => d.status === "online" || d.status === "leased").length,
      leased: devices.filter((d) => d.status === "leased").length,
      needsTakeover: devices.filter((d) => d.status === "needs_takeover").length,
      actionsUsedToday: devices.reduce((s, d) => s + d.dailyActionsUsed, 0),
    },
    humans: {
      total: humans.length,
      stopped: humans.filter((h) => h.stopped).length,
      banned: humans.filter((h) => h.banned).length,
      verifiedAdults: humans.filter((h) => h.lowestAge !== null && adultParticipantAge(h.lowestAge)).length,
    },
    tasks: {
      total: tasks.length,
      open: tasks.filter((t) => t.status !== "paid" && t.status !== "cancelled").length,
      proofVerified: tasks.filter((t) => t.proofVerified).length,
      paid: tasks.filter((t) => t.status === "paid").length,
      disputed: tasks.filter((t) => t.status === "disputed").length,
    },
    proofs: {
      total: proofs.length,
      pending: proofs.filter((p) => p.verdict === "pending").length,
      verified: proofs.filter((p) => p.verdict === "verified").length,
      rejected: proofs.filter((p) => p.verdict === "rejected").length,
    },
    outreach: {
      total: outreach.length,
      queued: outreach.filter((o) => o.status === "queued").length,
      sent: outreach.filter((o) => o.status === "sent" || o.status === "delivered" || o.status === "replied").length,
      blockedStop: outreach.filter((o) => o.status === "blocked_stop").length,
      blockedPolicy: outreach.filter((o) => o.status === "blocked_policy").length,
    },
    attribution: {
      qrScans,
      siteVisits,
      signupsStarted,
      verifiedAdultSignups,
      videoViews,
      blendedCpaCents: verifiedAdultSignups > 0 ? Math.round(spentCents / verifiedAdultSignups) : null,
    },
    slopCashHooks: {
      total: hooks.length,
      disabledStubCount: hooks.filter((h) => h.hookState === "disabled_stub").length,
      settledCount: hooks.filter((h) => h.hookState === "settled_onchain").length,
    },
  };
}

function assertProofAndAdultForPayout(
  task: MarketingTask,
  latestProof: ProofSubmission | null,
  human: HumanPartner | null,
): void {
  if (task.tier < 4) return;
  const workerAge = task.assigneeAgeYears ?? human?.lowestAge ?? -1;
  const workerBanned = human?.banned ?? false;
  if (!adultParticipantAge(workerAge)) {
    throw new PolicyViolationError(
      "UNDERAGE_OR_UNKNOWN_WORKER",
      "inv_adult_only_paid",
      `Task ${task.id} cannot be paid: worker age (${workerAge}) is not a verified adult (18..120).`,
    );
  }
  const hasEvidenceUrl = Boolean(latestProof?.evidenceUrl && latestProof.evidenceUrl.trim().length > 0);
  const verifiedSignupsOrShiftDone = Boolean(
    latestProof &&
      (latestProof.verifiedSignupsCount > 0 ||
        latestProof.qrScansCount > 0 ||
        latestProof.checkinMediaHashes.length > 0 ||
        latestProof.verdict === "verified"),
  );
  const ok =
    task.proofVerified &&
    latestProof !== null &&
    latestProof.verdict === "verified" &&
    canApproveProof(
      hasEvidenceUrl,
      latestProof.ftcDisclosed,
      latestProof.geoTimeValid,
      verifiedSignupsOrShiftDone,
      workerAge,
      workerBanned,
    ) &&
    (latestProof.proofKind !== "creator_video" || latestProof.likenessReleaseOk);

  if (!ok) {
    throw new PolicyViolationError(
      "PROOF_NOT_VERIFIED",
      "inv_proof_required_before_payout",
      `Task ${task.id} cannot be paid without a verified adult proof passing canApproveProof.`,
    );
  }
}

function assertSpendAllowed(
  campaign: Campaign,
  input: {
    tier: ImplementationTier;
    amountCents: number;
    useSlopCash: boolean;
    slopCashEnvEnabled: boolean;
    fromReserve?: boolean;
  },
): void {
  const effectiveMonthly = input.fromReserve
    ? Math.max(0, campaign.spentCents + campaign.reservedCents - input.amountCents)
    : campaign.spentCents + campaign.reservedCents;
  const effectiveDaily = input.fromReserve
    ? Math.max(0, campaign.dailySpentCents - input.amountCents)
    : campaign.dailySpentCents;
  const slopCashEnabled = campaign.slopCashEnabled && input.slopCashEnvEnabled;

  const allowed = canAuthorizeSpend(
    input.tier,
    input.amountCents,
    campaign.maxTaskCents,
    effectiveDaily,
    campaign.dailyCapCents,
    effectiveMonthly,
    campaign.monthlyBudgetCents,
    campaign.billingArmed,
    campaign.riskDial === "lockdown",
    input.useSlopCash,
    slopCashEnabled,
  );

  if (!allowed) {
    if (input.useSlopCash && !slopCashEnabled) {
      throw new PolicyViolationError(
        "SLOP_CASH_DISABLED",
        "inv_slop_cash_disabled",
        "slop.cash settlement is disabled.",
      );
    }
    if (input.tier > 2 && (!campaign.billingArmed || campaign.riskDial === "lockdown")) {
      throw new PolicyViolationError(
        "TIER_BILLING_BLOCKED",
        "inv_tier_billing_gate",
        `Tier ${input.tier} spend blocked: billingArmed=${campaign.billingArmed}, riskDial=${campaign.riskDial}.`,
      );
    }
    throw new PolicyViolationError(
      "BUDGET_CAP_EXCEEDED",
      "inv_budget_never_exceeded",
      `Spend of ${input.amountCents}c rejected by campaign caps (task=${campaign.maxTaskCents}c, daily=${campaign.dailyCapCents}c, monthly=${campaign.monthlyBudgetCents}c).`,
    );
  }
}

// ============================================================================
// MemoryMarketingStore
// ============================================================================

export class MemoryMarketingStore implements MarketingStore {
  readonly clock: Clock;
  private readonly idGen: () => string;

  private readonly campaigns = new Map<string, Campaign>();
  private readonly agents = new Map<string, MarketingAgent>();
  private readonly devices = new Map<string, DeviceNode>();
  private readonly channels = new Map<string, ChannelAccount>();
  private readonly humans = new Map<string, HumanPartner>();
  private readonly tasks = new Map<string, MarketingTask>();
  private readonly proofs = new Map<string, ProofSubmission>();
  private readonly outreach = new Map<string, OutreachMessage>();
  private readonly attribution = new Map<string, AttributionEvent>();
  private readonly budgetEntries = new Map<string, BudgetEntry>();
  private readonly budgetByKey = new Map<string, string>();
  private readonly slopCashHooks = new Map<string, SlopCashHook>();

  constructor(opts: { clock?: Clock; idGen?: () => string } = {}) {
    this.clock = opts.clock ?? new RealClock();
    this.idGen = opts.idGen ?? defaultId;
  }

  async close(): Promise<void> {}

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    for (const c of this.campaigns.values()) {
      if (c.slug === input.slug) {
        throw new Error(`Campaign slug already exists: ${input.slug}`);
      }
    }
    const now = isoNow(this.clock);
    const campaign: Campaign = {
      id: input.id ?? this.idGen(),
      slug: input.slug,
      name: input.name,
      city: input.city ?? "nyc",
      appId: input.appId,
      riskZone: input.riskZone ?? "zone_2_amber",
      riskDial: input.riskDial ?? "conservative",
      monthlyBudgetCents: input.monthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS,
      dailyCapCents: input.dailyCapCents ?? DEFAULT_DAILY_CAP_CENTS,
      maxTaskCents: input.maxTaskCents ?? DEFAULT_MAX_TASK_CENTS,
      reservedCents: 0,
      spentCents: 0,
      dailySpentCents: 0,
      billingArmed: input.billingArmed ?? false,
      slopCashEnabled: input.slopCashEnabled ?? false,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    this.campaigns.set(campaign.id, campaign);
    return { ...campaign };
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const c = this.campaigns.get(id);
    return c ? { ...c } : null;
  }

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    for (const c of this.campaigns.values()) {
      if (c.slug === slug) return { ...c };
    }
    return null;
  }

  async listCampaigns(filter?: {
    city?: string;
    appId?: AppId;
    status?: Campaign["status"];
  }): Promise<Campaign[]> {
    return [...this.campaigns.values()]
      .filter((c) => !filter?.city || c.city === filter.city)
      .filter((c) => !filter?.appId || c.appId === filter.appId)
      .filter((c) => !filter?.status || c.status === filter.status)
      .map((c) => ({ ...c }));
  }

  async updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign> {
    const existing = this.campaigns.get(id);
    if (!existing) throw new Error(`Campaign not found: ${id}`);
    const next: Campaign = {
      ...existing,
      ...patch,
      updatedAt: isoNow(this.clock),
    };
    if (next.reservedCents + next.spentCents > next.monthlyBudgetCents) {
      throw new PolicyViolationError(
        "BUDGET_CAP_EXCEEDED",
        "inv_budget_never_exceeded",
        "Cannot lower monthly budget below already reserved + spent amount.",
      );
    }
    this.campaigns.set(id, next);
    return { ...next };
  }

  async setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign> {
    return this.updateCampaign(id, {
      riskDial,
      ...(billingArmed !== undefined ? { billingArmed } : {}),
    });
  }

  async upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent> {
    const now = isoNow(this.clock);
    let existing: MarketingAgent | undefined;
    if (input.id) existing = this.agents.get(input.id);
    if (!existing) {
      for (const a of this.agents.values()) {
        if (a.personaId === input.personaId) {
          existing = a;
          break;
        }
      }
    }
    const agent: MarketingAgent = {
      id: existing?.id ?? input.id ?? this.idGen(),
      personaId: input.personaId,
      displayName: input.displayName,
      appId: input.appId,
      provider: input.provider,
      failoverProvider:
        input.failoverProvider !== undefined ? input.failoverProvider : (existing?.failoverProvider ?? null),
      authMode: input.authMode ?? existing?.authMode ?? "cli",
      sessionRef: input.sessionRef ?? existing?.sessionRef ?? "",
      sessionHealthy: input.sessionHealthy ?? existing?.sessionHealthy ?? true,
      dailyTurnCap: input.dailyTurnCap ?? existing?.dailyTurnCap ?? 60,
      turnsUsedToday: input.turnsUsedToday ?? existing?.turnsUsedToday ?? 0,
      cooldownUntil: input.cooldownUntil !== undefined ? input.cooldownUntil : (existing?.cooldownUntil ?? null),
      status: input.status ?? existing?.status ?? "idle",
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    return { ...agent };
  }

  async getAgent(id: string): Promise<MarketingAgent | null> {
    const a = this.agents.get(id);
    return a ? { ...a } : null;
  }

  async getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null> {
    for (const a of this.agents.values()) {
      if (a.personaId === personaId) return { ...a };
    }
    return null;
  }

  async listAgents(): Promise<MarketingAgent[]> {
    return [...this.agents.values()].map((a) => ({ ...a }));
  }

  async updateAgent(
    id: string,
    patch: Partial<Omit<MarketingAgent, "id" | "personaId">>,
  ): Promise<MarketingAgent> {
    const existing = this.agents.get(id);
    if (!existing) throw new Error(`Agent not found: ${id}`);
    const next: MarketingAgent = {
      ...existing,
      ...patch,
      updatedAt: isoNow(this.clock),
    };
    this.agents.set(id, next);
    return { ...next };
  }

  async consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
    const campaign = input.campaignId ? this.campaigns.get(input.campaignId) ?? null : null;
    const human = input.targetHumanId ? this.humans.get(input.targetHumanId) ?? null : null;

    const nowMs = this.clock.now();
    const inCooldown = agent.cooldownUntil !== null && Date.parse(agent.cooldownUntil) > nowMs;
    const targetStopped = Boolean(input.targetStopped || human?.stopped || human?.banned);
    const lockdown = Boolean(input.lockdown || campaign?.riskDial === "lockdown");

    const allowed = canDispatchAgentTurn(
      agent.status === "paused_stop",
      agent.status === "rate_limited" || inCooldown,
      agent.sessionHealthy,
      agent.turnsUsedToday,
      agent.dailyTurnCap,
      targetStopped,
      lockdown,
    );

    if (!allowed) {
      const reason = targetStopped
        ? "target_stopped"
        : lockdown
          ? "campaign_lockdown"
          : agent.status === "paused_stop"
            ? "agent_paused"
            : agent.status === "rate_limited" || inCooldown
              ? "rate_limited"
              : !agent.sessionHealthy
                ? "session_unhealthy"
                : "daily_turn_cap_reached";
      return { allowed: false, agent: { ...agent }, reason };
    }

    const updated: MarketingAgent = {
      ...agent,
      turnsUsedToday: agent.turnsUsedToday + 1,
      updatedAt: isoNow(this.clock),
    };
    this.agents.set(updated.id, updated);
    return { allowed: true, agent: { ...updated } };
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode> {
    const now = isoNow(this.clock);
    let existing: DeviceNode | undefined;
    if (input.id) existing = this.devices.get(input.id);
    if (!existing) {
      for (const d of this.devices.values()) {
        if (d.serialOrUdid === input.serialOrUdid || d.label === input.label) {
          existing = d;
          break;
        }
      }
    }
    const warmupDay = input.warmupDay ?? existing?.warmupDay ?? 1;
    const device: DeviceNode = {
      id: existing?.id ?? input.id ?? this.idGen(),
      label: input.label,
      platform: input.platform,
      hostMachine: input.hostMachine ?? existing?.hostMachine ?? "local-macbook",
      serialOrUdid: input.serialOrUdid,
      assignedPersona:
        input.assignedPersona !== undefined ? input.assignedPersona : (existing?.assignedPersona ?? null),
      simCarrier: input.simCarrier !== undefined ? input.simCarrier : (existing?.simCarrier ?? null),
      batteryPct: input.batteryPct ?? existing?.batteryPct ?? 60,
      tempC: input.tempC ?? existing?.tempC ?? 30,
      warmupDay,
      warmupStage: input.warmupStage ?? warmupStageForDay(warmupDay),
      dailyActionsUsed: input.dailyActionsUsed ?? existing?.dailyActionsUsed ?? 0,
      dailyActionCap: input.dailyActionCap ?? warmupDailyCap(warmupDay),
      leaseHolder: input.leaseHolder !== undefined ? input.leaseHolder : (existing?.leaseHolder ?? null),
      leaseExpiresAt:
        input.leaseExpiresAt !== undefined ? input.leaseExpiresAt : (existing?.leaseExpiresAt ?? null),
      status: input.status ?? existing?.status ?? "online",
      lastSeenAt: now,
    };
    this.devices.set(device.id, device);
    return { ...device };
  }

  async getDevice(id: string): Promise<DeviceNode | null> {
    const d = this.devices.get(id);
    return d ? { ...d } : null;
  }

  async listDevices(): Promise<DeviceNode[]> {
    return [...this.devices.values()].map((d) => ({ ...d }));
  }

  async updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) throw new Error(`Device not found: ${id}`);
    const warmupDay = update.warmupDay ?? existing.warmupDay;
    const safe = deviceBatterySafe(update.batteryPct, update.tempC);
    let nextStatus = update.status ?? existing.status;
    if (!safe && nextStatus !== "offline" && nextStatus !== "needs_takeover") {
      nextStatus = update.tempC > 41 ? "thermal_cooldown" : "charging_wait";
    } else if (safe && (existing.status === "thermal_cooldown" || existing.status === "charging_wait")) {
      nextStatus = existing.leaseHolder ? "leased" : "online";
    }
    const next: DeviceNode = {
      ...existing,
      batteryPct: update.batteryPct,
      tempC: update.tempC,
      warmupDay,
      warmupStage: warmupStageForDay(warmupDay),
      dailyActionCap: warmupDailyCap(warmupDay),
      status: nextStatus,
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(id, next);
    return { ...next };
  }

  async acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts: { lockdown?: boolean; targetStopped?: boolean } = {},
  ): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) throw new Error(`Device not found: ${id}`);
    const nowMs = this.clock.now();
    const activeLease =
      existing.leaseHolder !== null &&
      existing.leaseExpiresAt !== null &&
      Date.parse(existing.leaseExpiresAt) > nowMs;
    const leasedByOther = activeLease && existing.leaseHolder !== leaseHolder;
    const deviceOnline = existing.status === "online" || existing.status === "leased";

    const ok = canExecuteDeviceAction(
      deviceOnline,
      leasedByOther,
      existing.batteryPct,
      existing.tempC,
      existing.dailyActionsUsed,
      existing.warmupDay,
      Boolean(opts.lockdown),
      Boolean(opts.targetStopped),
    );
    if (!ok) {
      throw new PolicyViolationError(
        "DEVICE_LEASE_DENIED",
        "inv_device_safety_envelope",
        `Cannot lease device ${existing.label}: safety envelope or mutual-exclusion lease check failed.`,
      );
    }

    const next: DeviceNode = {
      ...existing,
      leaseHolder,
      leaseExpiresAt: new Date(nowMs + Math.max(1_000, ttlMs)).toISOString(),
      status: "leased",
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(id, next);
    return { ...next };
  }

  async releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) throw new Error(`Device not found: ${id}`);
    if (leaseHolder && existing.leaseHolder && existing.leaseHolder !== leaseHolder) {
      throw new PolicyViolationError(
        "LEASE_OWNER_MISMATCH",
        "inv_device_safety_envelope",
        `Device ${existing.label} is leased by ${existing.leaseHolder}, not ${leaseHolder}.`,
      );
    }
    const next: DeviceNode = {
      ...existing,
      leaseHolder: null,
      leaseExpiresAt: null,
      status: existing.status === "leased" ? "online" : existing.status,
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(id, next);
    return { ...next };
  }

  async recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt> {
    const device = this.devices.get(input.deviceId);
    if (!device) throw new Error(`Device not found: ${input.deviceId}`);
    const human = input.targetHumanId ? this.humans.get(input.targetHumanId) ?? null : null;
    const nowMs = this.clock.now();
    const activeLease =
      device.leaseHolder !== null &&
      device.leaseExpiresAt !== null &&
      Date.parse(device.leaseExpiresAt) > nowMs;
    const leasedByOther = activeLease && device.leaseHolder !== input.leaseHolder;
    const deviceOnline = device.status === "online" || device.status === "leased";
    const targetStopped = Boolean(input.targetStopped || human?.stopped || human?.banned);

    const allowed = canExecuteDeviceAction(
      deviceOnline,
      leasedByOther,
      device.batteryPct,
      device.tempC,
      device.dailyActionsUsed,
      device.warmupDay,
      Boolean(input.lockdown),
      targetStopped,
    );

    if (!allowed) {
      return {
        allowed: false,
        device: { ...device },
        reason: targetStopped
          ? "target_stopped"
          : input.lockdown
            ? "lockdown"
            : leasedByOther
              ? "leased_by_other"
              : !deviceOnline
                ? "device_offline"
                : !deviceBatterySafe(device.batteryPct, device.tempC)
                  ? "battery_or_thermal_unsafe"
                  : "warmup_cap_reached",
      };
    }

    const updated: DeviceNode = {
      ...device,
      dailyActionsUsed: device.dailyActionsUsed + 1,
      dailyActionCap: warmupDailyCap(device.warmupDay),
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(updated.id, updated);
    return { allowed: true, device: { ...updated } };
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount> {
    let existing: ChannelAccount | undefined;
    if (input.id) existing = this.channels.get(input.id);
    if (!existing) {
      for (const ch of this.channels.values()) {
        if (ch.channel === input.channel && ch.handle === input.handle) {
          existing = ch;
          break;
        }
      }
    }
    const account: ChannelAccount = {
      id: existing?.id ?? input.id ?? this.idGen(),
      agentId: input.agentId,
      deviceId: input.deviceId !== undefined ? input.deviceId : (existing?.deviceId ?? null),
      channel: input.channel,
      handle: input.handle,
      city: input.city ?? existing?.city ?? "nyc",
      warmupDay: input.warmupDay ?? existing?.warmupDay ?? 0,
      dailyOutreachCap: input.dailyOutreachCap ?? existing?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP,
      sentToday: input.sentToday ?? existing?.sentToday ?? 0,
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.channels.set(account.id, account);
    return { ...account };
  }

  async getChannelAccount(id: string): Promise<ChannelAccount | null> {
    const ch = this.channels.get(id);
    return ch ? { ...ch } : null;
  }

  async listChannelAccounts(filter?: {
    agentId?: string;
    channel?: OutreachChannel;
  }): Promise<ChannelAccount[]> {
    return [...this.channels.values()]
      .filter((c) => !filter?.agentId || c.agentId === filter.agentId)
      .filter((c) => !filter?.channel || c.channel === filter.channel)
      .map((c) => ({ ...c }));
  }

  async upsertHuman(input: UpsertHumanInput): Promise<HumanPartner> {
    let existing: HumanPartner | undefined;
    if (input.id) existing = this.humans.get(input.id);
    if (!existing) {
      for (const h of this.humans.values()) {
        if (h.handleOrEmailHmac === input.handleOrEmailHmac) {
          existing = h;
          break;
        }
      }
    }
    const human: HumanPartner = {
      id: existing?.id ?? input.id ?? this.idGen(),
      handleOrEmailHmac: input.handleOrEmailHmac,
      displayLabel: input.displayLabel,
      channel: input.channel,
      role: input.role,
      city: input.city ?? existing?.city ?? "nyc",
      lowestAge: minAge(existing?.lowestAge ?? null, input.lowestAge),
      stopped: Boolean(existing?.stopped || input.stopped),
      banned: Boolean(existing?.banned || input.banned),
      stopReason: input.stopReason !== undefined ? input.stopReason : (existing?.stopReason ?? null),
      dailySendsToday: input.dailySendsToday ?? existing?.dailySendsToday ?? 0,
      lastContactedAt:
        input.lastContactedAt !== undefined ? input.lastContactedAt : (existing?.lastContactedAt ?? null),
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.humans.set(human.id, human);
    return { ...human };
  }

  async getHuman(id: string): Promise<HumanPartner | null> {
    const h = this.humans.get(id);
    return h ? { ...h } : null;
  }

  async getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null> {
    for (const h of this.humans.values()) {
      if (h.handleOrEmailHmac === handleOrEmailHmac) return { ...h };
    }
    return null;
  }

  async listHumans(filter?: {
    city?: string;
    role?: HumanRole;
    stopped?: boolean;
  }): Promise<HumanPartner[]> {
    return [...this.humans.values()]
      .filter((h) => !filter?.city || h.city === filter.city)
      .filter((h) => !filter?.role || h.role === filter.role)
      .filter((h) => filter?.stopped === undefined || h.stopped === filter.stopped)
      .map((h) => ({ ...h }));
  }

  async markHumanStopped(id: string, reason: string): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) throw new Error(`Human not found: ${id}`);
    const next: HumanPartner = { ...existing, stopped: true, stopReason: reason };
    this.humans.set(id, next);
    return { ...next };
  }

  async markHumanBanned(id: string, reason: string): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) throw new Error(`Human not found: ${id}`);
    const next: HumanPartner = { ...existing, banned: true, stopped: true, stopReason: reason };
    this.humans.set(id, next);
    return { ...next };
  }

  async recordHumanAge(id: string, age: number): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) throw new Error(`Human not found: ${id}`);
    const next: HumanPartner = { ...existing, lowestAge: minAge(existing.lowestAge, age) };
    this.humans.set(id, next);
    return { ...next };
  }

  async createTask(input: CreateTaskInput): Promise<MarketingTask> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const payoutRail: PayoutRail = input.payoutRail ?? (input.tier >= 3 ? "fiat_stripe" : "none");
    const status: TaskStatus = input.status ?? "drafted";
    const amountCents = input.amountCents ?? 0;

    if (payoutRail === "slop_cash") {
      if (input.taskKind !== "oss_dev_bounty") {
        throw new PolicyViolationError(
          "SLOP_CASH_OSS_ONLY",
          "inv_slop_cash_disabled",
          "slop_cash payout rail is restricted strictly to oss_dev_bounty tasks.",
        );
      }
      if (!campaign.slopCashEnabled || !input.slopCashEnvEnabled) {
        throw new PolicyViolationError(
          "SLOP_CASH_DISABLED",
          "inv_slop_cash_disabled",
          "Cannot create slop_cash task while slop.cash is disabled.",
        );
      }
    }

    const human = input.assigneeHumanId ? this.humans.get(input.assigneeHumanId) ?? null : null;
    const effectiveAge = minAge(human?.lowestAge ?? null, input.assigneeAgeYears);
    const hiredOrLater: TaskStatus[] = [
      "hired",
      "shift_active",
      "proof_submitted",
      "proof_verified",
      "payout_queued",
      "paid",
    ];
    if (input.tier === 4 && hiredOrLater.includes(status)) {
      if (effectiveAge === null || !adultParticipantAge(effectiveAge)) {
        throw new PolicyViolationError(
          "UNDERAGE_OR_UNKNOWN_WORKER",
          "inv_adult_only_paid",
          "Tier 4 task requires a verified 18+ adult before hiring.",
        );
      }
    }
    if (status === "paid") {
      throw new PolicyViolationError(
        "DIRECT_PAID_FORBIDDEN",
        "inv_proof_required_before_payout",
        "Tasks cannot be created directly in paid state; use evaluateProof and markTaskPaid.",
      );
    }

    const task: MarketingTask = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      tier: input.tier,
      taskKind: input.taskKind,
      city: input.city ?? campaign.city,
      title: input.title,
      briefText: input.briefText,
      vendorChannel: input.vendorChannel,
      assigneeHumanId: input.assigneeHumanId ?? null,
      assigneeAgeYears: effectiveAge,
      amountCents,
      qrBatchCode: input.qrBatchCode ?? null,
      dubShortUrl: input.dubShortUrl ?? null,
      payoutRail,
      proofVerified: false,
      status,
      createdAt: isoNow(this.clock),
      paidAt: null,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async getTask(id: string): Promise<MarketingTask | null> {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }

  async listTasks(filter?: {
    campaignId?: string;
    status?: TaskStatus;
    taskKind?: TaskKind;
    city?: string;
  }): Promise<MarketingTask[]> {
    return [...this.tasks.values()]
      .filter((t) => !filter?.campaignId || t.campaignId === filter.campaignId)
      .filter((t) => !filter?.status || t.status === filter.status)
      .filter((t) => !filter?.taskKind || t.taskKind === filter.taskKind)
      .filter((t) => !filter?.city || t.city === filter.city)
      .map((t) => ({ ...t }));
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask> {
    const existing = this.tasks.get(id);
    if (!existing) throw new Error(`Task not found: ${id}`);
    if (patch.status === "paid") {
      throw new PolicyViolationError(
        "DIRECT_PAID_FORBIDDEN",
        "inv_proof_required_before_payout",
        "Use markTaskPaid to transition a task to paid.",
      );
    }
    const nextAge =
      patch.assigneeAgeYears !== undefined
        ? minAge(existing.assigneeAgeYears, patch.assigneeAgeYears)
        : existing.assigneeAgeYears;
    const nextStatus = patch.status ?? existing.status;
    const hiredOrLater: TaskStatus[] = [
      "hired",
      "shift_active",
      "proof_submitted",
      "proof_verified",
      "payout_queued",
    ];
    if (existing.tier === 4 && hiredOrLater.includes(nextStatus)) {
      if (nextAge === null || !adultParticipantAge(nextAge)) {
        throw new PolicyViolationError(
          "UNDERAGE_OR_UNKNOWN_WORKER",
          "inv_adult_only_paid",
          "Cannot hire or advance Tier 4 task without verified adult age (18..120).",
        );
      }
    }
    const next: MarketingTask = {
      ...existing,
      ...patch,
      assigneeAgeYears: nextAge,
    };
    this.tasks.set(id, next);
    return { ...next };
  }

  async markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const campaign = this.campaigns.get(task.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${task.campaignId}`);
    const human = task.assigneeHumanId ? this.humans.get(task.assigneeHumanId) ?? null : null;

    const proofs = [...this.proofs.values()]
      .filter((p) => p.taskId === taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    assertProofAndAdultForPayout(task, proofs[0] ?? null, human);

    const { entry, campaign: updatedCampaign } = await this.authorizeSpend({
      campaignId: task.campaignId,
      taskId: task.id,
      adapterId: opts.adapterId,
      tier: task.tier,
      amountCents: task.amountCents,
      entryType: "commit",
      idempotencyKey: opts.idempotencyKey,
      externalRef: opts.externalRef ?? null,
      useSlopCash: task.payoutRail === "slop_cash",
      slopCashEnvEnabled: Boolean(opts.slopCashEnvEnabled),
      fromReserve: opts.fromReserve,
    });

    const paidTask: MarketingTask = {
      ...task,
      status: "paid",
      paidAt: isoNow(this.clock),
    };
    this.tasks.set(taskId, paidTask);
    return { task: { ...paidTask }, entry, campaign: updatedCampaign };
  }

  async createProof(input: CreateProofInput): Promise<ProofSubmission> {
    const task = this.tasks.get(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const proof: ProofSubmission = {
      id: input.id ?? this.idGen(),
      taskId: input.taskId,
      proofKind: input.proofKind,
      evidenceUrl: input.evidenceUrl ?? null,
      checkinMediaHashes: [...(input.checkinMediaHashes ?? [])],
      qrScansCount: input.qrScansCount ?? 0,
      verifiedSignupsCount: input.verifiedSignupsCount ?? 0,
      ftcDisclosed: input.ftcDisclosed ?? false,
      geoTimeValid: input.geoTimeValid ?? false,
      likenessReleaseOk: input.likenessReleaseOk ?? false,
      verdict: "pending",
      verifierNotes: input.verifierNotes ?? null,
      createdAt: isoNow(this.clock),
    };
    this.proofs.set(proof.id, proof);
    if (task.status !== "paid" && task.status !== "cancelled") {
      this.tasks.set(task.id, { ...task, status: "proof_submitted" });
    }
    return { ...proof, checkinMediaHashes: [...proof.checkinMediaHashes] };
  }

  async getProof(id: string): Promise<ProofSubmission | null> {
    const p = this.proofs.get(id);
    return p ? { ...p, checkinMediaHashes: [...p.checkinMediaHashes] } : null;
  }

  async listProofs(filter?: { taskId?: string; verdict?: ProofVerdict }): Promise<ProofSubmission[]> {
    return [...this.proofs.values()]
      .filter((p) => !filter?.taskId || p.taskId === filter.taskId)
      .filter((p) => !filter?.verdict || p.verdict === filter.verdict)
      .map((p) => ({ ...p, checkinMediaHashes: [...p.checkinMediaHashes] }));
  }

  async evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult> {
    const proof = this.proofs.get(proofId);
    if (!proof) throw new Error(`Proof not found: ${proofId}`);
    const task = this.tasks.get(proof.taskId);
    if (!task) throw new Error(`Task not found: ${proof.taskId}`);

    const hasEvidenceUrl = Boolean(proof.evidenceUrl && proof.evidenceUrl.trim().length > 0);
    const verifiedSignupsOrShiftDone = Boolean(
      opts.shiftDone ||
        proof.verifiedSignupsCount > 0 ||
        proof.qrScansCount > 0 ||
        proof.checkinMediaHashes.length >= 2,
    );

    const coreApproved = canApproveProof(
      hasEvidenceUrl,
      proof.ftcDisclosed,
      proof.geoTimeValid,
      verifiedSignupsOrShiftDone,
      opts.workerAge,
      opts.workerBanned,
    );
    const releaseOk = proof.proofKind !== "creator_video" || proof.likenessReleaseOk;
    const approved = coreApproved && releaseOk;

    let reason: string | undefined;
    if (!approved) {
      if (!adultParticipantAge(opts.workerAge)) reason = "worker_underage_or_invalid_age";
      else if (opts.workerBanned) reason = "worker_banned";
      else if (!hasEvidenceUrl) reason = "missing_evidence_url";
      else if (!proof.ftcDisclosed) reason = "missing_ftc_disclosure";
      else if (!proof.geoTimeValid) reason = "invalid_geo_time_window";
      else if (!verifiedSignupsOrShiftDone) reason = "missing_shift_or_signup_evidence";
      else if (!releaseOk) reason = "missing_ny_likeness_release";
    }

    const updatedProof: ProofSubmission = {
      ...proof,
      verdict: approved ? "verified" : "rejected",
      verifierNotes:
        opts.verifierNotes ??
        (approved ? "Approved by proved marketingPolicy.canApproveProof" : `Rejected: ${reason}`),
    };
    this.proofs.set(proofId, updatedProof);

    const updatedAge = minAge(task.assigneeAgeYears, opts.workerAge);
    const updatedTask: MarketingTask = {
      ...task,
      assigneeAgeYears: updatedAge,
      proofVerified: approved,
      status: approved ? "proof_verified" : "disputed",
    };
    this.tasks.set(task.id, updatedTask);

    return {
      proof: { ...updatedProof, checkinMediaHashes: [...updatedProof.checkinMediaHashes] },
      task: { ...updatedTask },
      approved,
      ...(reason ? { reason } : {}),
    };
  }

  async createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const human = this.humans.get(input.humanId);
    if (!human) throw new Error(`Human not found: ${input.humanId}`);
    const account = input.channelAccountId ? this.channels.get(input.channelAccountId) ?? null : null;

    const sentToday = account ? account.sentToday : human.dailySendsToday;
    const dailyOutreachCap =
      input.dailyOutreachCap ?? account?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;
    const lockdown = campaign.riskDial === "lockdown";

    const gatePass = canSendOutreach(
      human.stopped,
      human.banned,
      lockdown,
      sentToday,
      dailyOutreachCap,
    );

    let status: OutreachStatus;
    if (human.stopped) {
      status = "blocked_stop";
    } else if (!gatePass || !input.leakCheckPass) {
      status = "blocked_policy";
    } else {
      status = input.desiredStatus ?? "queued";
    }

    const now = isoNow(this.clock);
    const msg: OutreachMessage = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      agentId: input.agentId,
      humanId: input.humanId,
      channel: input.channel,
      tier: input.tier,
      subject: input.subject ?? null,
      bodySummary: input.bodySummary,
      leakCheckPass: input.leakCheckPass,
      status,
      externalRef: input.externalRef ?? null,
      createdAt: now,
    };
    this.outreach.set(msg.id, msg);

    if (status === "sent" || status === "delivered") {
      this.humans.set(human.id, {
        ...human,
        dailySendsToday: human.dailySendsToday + 1,
        lastContactedAt: now,
      });
      if (account) {
        this.channels.set(account.id, { ...account, sentToday: account.sentToday + 1 });
      }
    }

    return { ...msg };
  }

  async listOutreachMessages(filter?: {
    campaignId?: string;
    humanId?: string;
    agentId?: string;
    status?: OutreachStatus;
  }): Promise<OutreachMessage[]> {
    return [...this.outreach.values()]
      .filter((m) => !filter?.campaignId || m.campaignId === filter.campaignId)
      .filter((m) => !filter?.humanId || m.humanId === filter.humanId)
      .filter((m) => !filter?.agentId || m.agentId === filter.agentId)
      .filter((m) => !filter?.status || m.status === filter.status)
      .map((m) => ({ ...m }));
  }

  async updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
  ): Promise<OutreachMessage> {
    const existing = this.outreach.get(id);
    if (!existing) throw new Error(`Outreach message not found: ${id}`);

    if (status === "sent" || status === "delivered") {
      const campaign = this.campaigns.get(existing.campaignId);
      const human = this.humans.get(existing.humanId);
      if (!campaign || !human) throw new Error("Missing campaign or human for outreach send");
      const allowed = canSendOutreach(
        human.stopped,
        human.banned,
        campaign.riskDial === "lockdown",
        human.dailySendsToday,
        DEFAULT_DAILY_OUTREACH_CAP,
      );
      if (!allowed || !existing.leakCheckPass) {
        const blockedStatus: OutreachStatus = human.stopped ? "blocked_stop" : "blocked_policy";
        const blocked: OutreachMessage = { ...existing, status: blockedStatus };
        this.outreach.set(id, blocked);
        return { ...blocked };
      }
      if (existing.status !== "sent" && existing.status !== "delivered") {
        this.humans.set(human.id, {
          ...human,
          dailySendsToday: human.dailySendsToday + 1,
          lastContactedAt: isoNow(this.clock),
        });
      }
    }

    const updated: OutreachMessage = {
      ...existing,
      status,
      externalRef: externalRef !== undefined ? externalRef : existing.externalRef,
    };
    this.outreach.set(id, updated);
    return { ...updated };
  }

  async recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const event: AttributionEvent = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      taskId: input.taskId ?? null,
      qrBatchCode: input.qrBatchCode ?? null,
      eventKind: input.eventKind,
      city: input.city ?? campaign.city,
      appId: input.appId,
      count: input.count ?? 1,
      metadata: { ...(input.metadata ?? {}) },
      createdAt: isoNow(this.clock),
    };
    this.attribution.set(event.id, event);
    return { ...event, metadata: { ...event.metadata } };
  }

  async listAttributionEvents(filter?: {
    campaignId?: string;
    taskId?: string;
    qrBatchCode?: string;
    appId?: BrandAppId;
  }): Promise<AttributionEvent[]> {
    return [...this.attribution.values()]
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.qrBatchCode || e.qrBatchCode === filter.qrBatchCode)
      .filter((e) => !filter?.appId || e.appId === filter.appId)
      .map((e) => ({ ...e, metadata: { ...e.metadata } }));
  }

  async authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult> {
    const existingId = this.budgetByKey.get(input.idempotencyKey);
    if (existingId) {
      const entry = this.budgetEntries.get(existingId)!;
      const campaign = this.campaigns.get(entry.campaignId)!;
      return { entry: { ...entry }, campaign: { ...campaign }, replayed: true };
    }

    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);

    const useSlopCash = Boolean(input.useSlopCash || input.adapterId === "slop_cash");
    if (input.entryType === "reserve" || input.entryType === "commit") {
      assertSpendAllowed(campaign, {
        tier: input.tier,
        amountCents: input.amountCents,
        useSlopCash,
        slopCashEnvEnabled: Boolean(input.slopCashEnvEnabled),
        fromReserve: input.fromReserve,
      });
    } else if (input.amountCents <= 0) {
      throw new PolicyViolationError(
        "INVALID_AMOUNT",
        "inv_budget_never_exceeded",
        "Budget ledger entries require a positive amountCents.",
      );
    }

    const now = isoNow(this.clock);
    const nextCampaign: Campaign = { ...campaign, updatedAt: now };
    if (input.entryType === "reserve") {
      nextCampaign.reservedCents += input.amountCents;
      nextCampaign.dailySpentCents += input.amountCents;
    } else if (input.entryType === "commit") {
      if (input.fromReserve) {
        nextCampaign.reservedCents = Math.max(0, nextCampaign.reservedCents - input.amountCents);
      } else {
        nextCampaign.dailySpentCents += input.amountCents;
      }
      nextCampaign.spentCents += input.amountCents;
    } else if (input.entryType === "release") {
      nextCampaign.reservedCents = Math.max(0, nextCampaign.reservedCents - input.amountCents);
      nextCampaign.dailySpentCents = Math.max(0, nextCampaign.dailySpentCents - input.amountCents);
    } else if (input.entryType === "refund") {
      nextCampaign.spentCents = Math.max(0, nextCampaign.spentCents - input.amountCents);
      nextCampaign.dailySpentCents = Math.max(0, nextCampaign.dailySpentCents - input.amountCents);
    }

    const entry: BudgetEntry = {
      id: this.idGen(),
      campaignId: input.campaignId,
      taskId: input.taskId ?? null,
      adapterId: input.adapterId,
      tier: input.tier,
      amountCents: input.amountCents,
      entryType: input.entryType,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef ?? null,
      createdAt: now,
    };
    this.budgetEntries.set(entry.id, entry);
    this.budgetByKey.set(entry.idempotencyKey, entry.id);
    this.campaigns.set(nextCampaign.id, nextCampaign);

    return { entry: { ...entry }, campaign: { ...nextCampaign }, replayed: false };
  }

  async listBudgetEntries(filter?: {
    campaignId?: string;
    taskId?: string;
    entryType?: BudgetEntryType;
  }): Promise<BudgetEntry[]> {
    return [...this.budgetEntries.values()]
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.entryType || e.entryType === filter.entryType)
      .map((e) => ({ ...e }));
  }

  async upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook> {
    const enabled = Boolean(input.enabled);
    const hookState: SlopCashHookState = enabled ? (input.hookState ?? "ready_for_sync") : "disabled_stub";
    let existing: SlopCashHook | undefined;
    for (const h of this.slopCashHooks.values()) {
      if (h.taskId === input.taskId) {
        existing = h;
        break;
      }
    }
    const hook: SlopCashHook = {
      id: existing?.id ?? input.id ?? this.idGen(),
      taskId: input.taskId,
      repoSlug: input.repoSlug ?? existing?.repoSlug ?? "eliza-research/thenetwork",
      issueNumber: input.issueNumber !== undefined ? input.issueNumber : (existing?.issueNumber ?? null),
      vaultChain: input.vaultChain ?? existing?.vaultChain ?? "base",
      estimatedUsdcCents: input.estimatedUsdcCents,
      hookState,
      externalTxHash: enabled
        ? (input.externalTxHash !== undefined ? input.externalTxHash : (existing?.externalTxHash ?? null))
        : null,
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.slopCashHooks.set(hook.id, hook);
    return { ...hook };
  }

  async getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null> {
    for (const h of this.slopCashHooks.values()) {
      if (h.taskId === taskId) return { ...h };
    }
    return null;
  }

  async listSlopCashHooks(): Promise<SlopCashHook[]> {
    return [...this.slopCashHooks.values()].map((h) => ({ ...h }));
  }

  async resetDailyCounters(): Promise<void> {
    const now = isoNow(this.clock);
    for (const [id, c] of this.campaigns) {
      this.campaigns.set(id, { ...c, dailySpentCents: 0, updatedAt: now });
    }
    for (const [id, a] of this.agents) {
      this.agents.set(id, {
        ...a,
        turnsUsedToday: 0,
        status: a.status === "rate_limited" ? "idle" : a.status,
        updatedAt: now,
      });
    }
    for (const [id, d] of this.devices) {
      this.devices.set(id, { ...d, dailyActionsUsed: 0 });
    }
    for (const [id, ch] of this.channels) {
      this.channels.set(id, { ...ch, sentToday: 0 });
    }
    for (const [id, h] of this.humans) {
      this.humans.set(id, { ...h, dailySendsToday: 0 });
    }
  }

  async getOverview(campaignId?: string): Promise<MarketingOverview> {
    const campaigns = campaignId
      ? [...this.campaigns.values()].filter((c) => c.id === campaignId)
      : [...this.campaigns.values()];
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const tasks = campaignId
      ? [...this.tasks.values()].filter((t) => campaignIds.has(t.campaignId))
      : [...this.tasks.values()];
    const taskIds = new Set(tasks.map((t) => t.id));
    const proofs = campaignId
      ? [...this.proofs.values()].filter((p) => taskIds.has(p.taskId))
      : [...this.proofs.values()];
    const outreach = campaignId
      ? [...this.outreach.values()].filter((o) => campaignIds.has(o.campaignId))
      : [...this.outreach.values()];
    const attribution = campaignId
      ? [...this.attribution.values()].filter((a) => campaignIds.has(a.campaignId))
      : [...this.attribution.values()];
    const hooks = campaignId
      ? [...this.slopCashHooks.values()].filter((h) => taskIds.has(h.taskId))
      : [...this.slopCashHooks.values()];

    return buildOverview(
      isoNow(this.clock),
      campaigns,
      [...this.agents.values()],
      [...this.devices.values()],
      [...this.humans.values()],
      tasks,
      proofs,
      outreach,
      attribution,
      hooks,
    );
  }
}

// ============================================================================
// PgMarketingStore (Node 26 postgres.ts against marketing.* schema)
// ============================================================================

type Row = Record<string, any>;

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

function toJsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function authModeToDb(mode: AgentAuthMode): string {
  return mode === "api" ? "api_key" : mode;
}

function authModeFromDb(mode: string): AgentAuthMode {
  return mode === "api_key" ? "api" : (mode as AgentAuthMode);
}

function channelToAccountPlatform(ch: OutreachChannel): string {
  if (ch === "venue" || ch === "sms_opted_in") return "other";
  return ch;
}

function channelToHumanSource(ch: OutreachChannel): string {
  if (ch === "venue" || ch === "sms_opted_in") return "other";
  return ch;
}

function channelToOutreachDb(ch: OutreachChannel): string {
  if (ch === "craigslist") return "craigslist_relay";
  if (ch === "x") return "x_dm";
  if (ch === "instagram") return "ig_dm";
  if (ch === "sms_opted_in") return "eliza_deliver";
  if (ch === "email" || ch === "rentahuman") return ch;
  return "other";
}

function outreachDbToChannel(dbCh: string, templateId?: string | null): OutreachChannel {
  if (templateId && templateId.startsWith("ch:")) {
    return templateId.slice(3) as OutreachChannel;
  }
  if (dbCh === "craigslist_relay") return "craigslist";
  if (dbCh === "x_dm") return "x";
  if (dbCh === "ig_dm") return "instagram";
  if (dbCh === "eliza_deliver") return "sms_opted_in";
  if (dbCh === "email" || dbCh === "rentahuman") return dbCh;
  return "email";
}

function channelStatusToDb(status: ChannelAccount["status"]): string {
  return status === "disabled" ? "retired" : status;
}

function channelStatusFromDb(status: string): ChannelAccount["status"] {
  if (status === "retired") return "disabled";
  if (status === "needs_takeover") return "cooldown";
  return status as ChannelAccount["status"];
}

function payoutRailToDb(rail: PayoutRail): string {
  return rail === "usdc_direct" ? "platform_escrow" : rail;
}

function payoutRailFromDb(rail: string, meta: Record<string, unknown>): PayoutRail {
  if (meta.payoutRail === "usdc_direct") return "usdc_direct";
  if (rail === "agency_invoice" || rail === "platform_escrow") return "fiat_stripe";
  return rail as PayoutRail;
}

function attributionKindToDb(kind: AttributionEvent["eventKind"]): string {
  if (kind === "site_visit") return "link_click";
  if (kind === "signup_verified_adult") return "signup_verified_18plus";
  if (kind === "video_view") return "video_view_snapshot";
  return kind;
}

function attributionKindFromDb(dbType: string): AttributionEvent["eventKind"] {
  if (dbType === "link_click") return "site_visit";
  if (dbType === "signup_verified_18plus") return "signup_verified_adult";
  if (dbType === "video_view_snapshot") return "video_view";
  if (dbType === "signup_started") return "signup_started";
  return "qr_scan";
}

export class PgMarketingStore implements MarketingStore {
  readonly sql: SQL;
  readonly clock: Clock;
  private readonly owned: boolean;
  private readonly idGen: () => string;

  constructor(
    db: string | SQL,
    opts: { clock?: Clock; idGen?: () => string } = {},
  ) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
    this.clock = opts.clock ?? new RealClock();
    this.idGen = opts.idGen ?? defaultId;
  }

  async close(): Promise<void> {
    if (this.owned) await (this.sql as unknown as { close(): Promise<void> }).close();
  }

  /** Apply apps/marketing/db/schema.sql (idempotent). */
  async migrate(): Promise<void> {
    await this.sql.unsafe(
      await fileAt(new URL("../db/schema.sql", import.meta.url)).text(),
    );
  }

  private async dailySpentForCampaign(q: SQL, campaignId: string, meta: Record<string, unknown>): Promise<number> {
    const dayStart = utcDayStartIso(this.clock);
    const resetAt = typeof meta.dailyResetAt === "string" ? meta.dailyResetAt : null;
    const since = resetAt && resetAt > dayStart ? resetAt : dayStart;
    const rows = await q`
      select
        coalesce(sum(case when entry_type in ('reserve', 'commit') then amount_cents else 0 end), 0)::int as added,
        coalesce(sum(case when entry_type in ('release', 'refund') then amount_cents else 0 end), 0)::int as reduced
      from marketing.budget_ledger
      where campaign_id = ${campaignId}
        and created_at >= ${new Date(since)}
    `;
    const r = rows[0] as Row | undefined;
    const added = Number(r?.added ?? 0);
    const reduced = Number(r?.reduced ?? 0);
    return Math.max(0, added - reduced);
  }

  private mapCampaign(r: Row, dailySpentCents: number): Campaign {
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      city: String(r.city),
      appId: r.app_id as AppId,
      riskZone: r.risk_zone as RiskZone,
      riskDial: (r.risk_dial === "normal" ? "balanced" : r.risk_dial) as RiskDial,
      monthlyBudgetCents: Number(r.monthly_budget_cents),
      dailyCapCents: Number(r.daily_cap_cents),
      maxTaskCents: Number(r.max_task_cents),
      reservedCents: Number(r.reserved_cents),
      spentCents: Number(r.spent_cents),
      dailySpentCents,
      billingArmed: Boolean(r.billing_armed),
      slopCashEnabled: Boolean(r.slop_cash_enabled),
      status: (r.status === "archived" ? "completed" : r.status) as Campaign["status"],
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapAgent(r: Row): MarketingAgent {
    const persona = r.persona_id === "eliza" ? "operator" : (r.persona_id as PersonaId);
    const appId = r.app_id === "all" ? "ntwrk" : (r.app_id as BrandAppId);
    return {
      id: String(r.id),
      personaId: persona,
      displayName: String(r.display_name),
      appId,
      provider: r.provider as SubscriptionProvider,
      failoverProvider: (r.failover_provider ?? null) as SubscriptionProvider | null,
      authMode: authModeFromDb(String(r.auth_mode)),
      sessionRef: String(r.session_ref ?? ""),
      sessionHealthy: Boolean(r.session_healthy),
      dailyTurnCap: Number(r.daily_turn_cap),
      turnsUsedToday: Number(r.turns_used_today),
      cooldownUntil: toIsoOrNull(r.cooldown_until),
      status: r.status as AgentStatus,
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapDevice(r: Row): DeviceNode {
    const platform: DevicePlatform = r.platform === "ios" ? "ios" : "android";
    return {
      id: String(r.id),
      label: String(r.label),
      platform,
      hostMachine: String(r.host_machine),
      serialOrUdid: String(r.serial_or_udid),
      assignedPersona: (r.assigned_persona === "eliza" ? "operator" : r.assigned_persona ?? null) as PersonaId | null,
      simCarrier: r.sim_carrier ?? null,
      batteryPct: Number(r.battery_pct),
      tempC: Number(r.temp_c),
      warmupDay: Number(r.warmup_day),
      warmupStage: r.warmup_stage as DeviceWarmupStage,
      dailyActionsUsed: Number(r.daily_actions_used),
      dailyActionCap: Number(r.daily_action_cap),
      leaseHolder: r.lease_holder ?? null,
      leaseExpiresAt: toIsoOrNull(r.lease_expires_at),
      status: r.status as DeviceStatus,
      lastSeenAt: toIso(r.last_seen_at),
    };
  }

  private mapChannelAccount(r: Row): ChannelAccount {
    const meta = toJsonObj(r.metadata);
    return {
      id: String(r.id),
      agentId: String(r.agent_id ?? ""),
      deviceId: r.device_id ? String(r.device_id) : null,
      channel: (typeof meta.channel === "string" ? meta.channel : r.platform) as OutreachChannel,
      handle: String(r.handle),
      city: typeof meta.city === "string" ? meta.city : "nyc",
      warmupDay: Number(r.warmup_day),
      dailyOutreachCap: Number(r.daily_post_cap),
      sentToday: Number(r.posts_today),
      status: channelStatusFromDb(String(r.status)),
      createdAt: toIso(r.created_at),
    };
  }

  private mapHuman(r: Row): HumanPartner {
    const meta = toJsonObj(r.metadata);
    return {
      id: String(r.id),
      handleOrEmailHmac: String(r.contact_key),
      displayLabel: String(r.display_name),
      channel: (typeof meta.channel === "string" ? meta.channel : r.source_channel) as OutreachChannel,
      role: (r.role === "event_activator" ? "street_worker" : r.role === "printer" || r.role === "community" ? "venue" : r.role) as HumanRole,
      city: String(r.city),
      lowestAge: r.age_years === null || r.age_years === undefined ? null : Number(r.age_years),
      stopped: Boolean(r.stopped),
      banned: Boolean(r.banned),
      stopReason: r.stop_reason ?? null,
      dailySendsToday: Number(r.daily_sends_today),
      lastContactedAt: toIsoOrNull(r.last_contacted_at),
      createdAt: toIso(r.created_at),
    };
  }

  private mapTask(r: Row): MarketingTask {
    const meta = toJsonObj(r.metadata);
    return {
      id: String(r.id),
      campaignId: String(r.campaign_id),
      tier: Number(r.tier) as ImplementationTier,
      taskKind: (r.task_kind === "discovery" ? "digital_outreach" : r.task_kind) as TaskKind,
      city: String(r.city),
      title: String(r.title),
      briefText: String(r.brief_text),
      vendorChannel: (r.vendor_channel === "print_local" ? "print_api" : r.vendor_channel) as VendorChannel,
      assigneeHumanId: r.human_id ? String(r.human_id) : null,
      assigneeAgeYears: r.worker_age_years === null || r.worker_age_years === undefined ? null : Number(r.worker_age_years),
      amountCents: Number(r.amount_cents),
      qrBatchCode: r.qr_batch_code ?? null,
      dubShortUrl: r.short_url ?? null,
      payoutRail: payoutRailFromDb(String(r.payout_rail), meta),
      proofVerified: Boolean(r.proof_verified),
      status: r.status as TaskStatus,
      createdAt: toIso(r.created_at),
      paidAt: toIsoOrNull(r.paid_at),
    };
  }

  private mapProof(r: Row): ProofSubmission {
    return {
      id: String(r.id),
      taskId: String(r.task_id),
      proofKind: (r.proof_kind === "agency_recap" ? "street_shift" : r.proof_kind) as ProofKind,
      evidenceUrl: r.evidence_url ?? null,
      checkinMediaHashes: toStringArray(r.checkin_media_hashes),
      qrScansCount: Number(r.qr_scans_count),
      verifiedSignupsCount: Number(r.verified_signups_count),
      ftcDisclosed: Boolean(r.ftc_disclosed),
      geoTimeValid: Boolean(r.geo_time_valid),
      likenessReleaseOk: Boolean(r.likeness_release_ok),
      verdict: r.verifier_verdict as ProofVerdict,
      verifierNotes: r.verifier_notes ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  private mapOutreach(r: Row): OutreachMessage {
    return {
      id: String(r.id),
      campaignId: String(r.campaign_id ?? ""),
      agentId: String(r.agent_id ?? ""),
      humanId: String(r.human_id ?? ""),
      channel: outreachDbToChannel(String(r.channel), r.template_id),
      tier: Number(r.tier ?? 1) as ImplementationTier,
      subject: r.subject ?? null,
      bodySummary: String(r.body_text),
      leakCheckPass: Boolean(r.leak_check_pass),
      status: (r.status === "drafted" || r.status === "dry_run" ? "queued" : r.status === "bounced" ? "failed" : r.status) as OutreachStatus,
      externalRef: r.external_message_id ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  private mapAttribution(r: Row): AttributionEvent {
    const meta = toJsonObj(r.metadata);
    const count = typeof meta.__count === "number" ? meta.__count : 1;
    const qrNull = meta.__qrBatchNull === true;
    const cleanMeta = { ...meta };
    delete cleanMeta.__count;
    delete cleanMeta.__qrBatchNull;
    return {
      id: String(r.id),
      campaignId: String(r.campaign_id),
      taskId: r.task_id ? String(r.task_id) : null,
      qrBatchCode: qrNull ? null : String(r.qr_batch_code),
      eventKind: attributionKindFromDb(String(r.event_type)),
      city: String(r.city),
      appId: (r.app_id === "all" ? "ntwrk" : r.app_id) as BrandAppId,
      count,
      metadata: cleanMeta,
      createdAt: toIso(r.created_at),
    };
  }

  private mapBudgetEntry(r: Row): BudgetEntry {
    return {
      id: String(r.id),
      campaignId: String(r.campaign_id),
      taskId: r.task_id ? String(r.task_id) : null,
      adapterId: String(r.adapter_id),
      tier: Number(r.tier) as ImplementationTier,
      amountCents: Number(r.amount_cents),
      entryType: r.entry_type as BudgetEntryType,
      idempotencyKey: String(r.idempotency_key),
      externalRef: r.external_ref ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  private mapSlopCashHook(r: Row): SlopCashHook {
    return {
      id: String(r.id),
      taskId: String(r.task_id),
      repoSlug: String(r.repo_slug),
      issueNumber: r.issue_number === null || r.issue_number === undefined ? null : Number(r.issue_number),
      vaultChain: r.vault_chain as SlopCashVaultChain,
      estimatedUsdcCents: Number(r.estimated_usdc_cents),
      hookState: r.hook_state as SlopCashHookState,
      externalTxHash: r.external_tx_hash ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      insert into marketing.campaigns (
        id, slug, name, city, app_id, risk_zone, risk_dial,
        monthly_budget_cents, daily_cap_cents, max_task_cents,
        billing_armed, slop_cash_enabled, status, created_at, updated_at
      ) values (
        ${id}, ${input.slug}, ${input.name}, ${input.city ?? "nyc"}, ${input.appId},
        ${input.riskZone ?? "zone_2_amber"}, ${input.riskDial ?? "conservative"},
        ${input.monthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS},
        ${input.dailyCapCents ?? DEFAULT_DAILY_CAP_CENTS},
        ${input.maxTaskCents ?? DEFAULT_MAX_TASK_CENTS},
        ${input.billingArmed ?? false}, ${input.slopCashEnabled ?? false},
        ${input.status ?? "active"}, ${now}, ${now}
      ) returning *
    `;
    return this.mapCampaign(r, 0);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const [r] = await this.sql`select * from marketing.campaigns where id = ${id}`;
    if (!r) return null;
    const daily = await this.dailySpentForCampaign(this.sql, id, toJsonObj(r.metadata));
    return this.mapCampaign(r, daily);
  }

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    const [r] = await this.sql`select * from marketing.campaigns where slug = ${slug}`;
    if (!r) return null;
    const daily = await this.dailySpentForCampaign(this.sql, String(r.id), toJsonObj(r.metadata));
    return this.mapCampaign(r, daily);
  }

  async listCampaigns(filter?: {
    city?: string;
    appId?: AppId;
    status?: Campaign["status"];
  }): Promise<Campaign[]> {
    const rows = await this.sql`select * from marketing.campaigns order by created_at desc`;
    const out: Campaign[] = [];
    for (const r of rows as Row[]) {
      const daily = await this.dailySpentForCampaign(this.sql, String(r.id), toJsonObj(r.metadata));
      const c = this.mapCampaign(r, daily);
      if (filter?.city && c.city !== filter.city) continue;
      if (filter?.appId && c.appId !== filter.appId) continue;
      if (filter?.status && c.status !== filter.status) continue;
      out.push(c);
    }
    return out;
  }

  async updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign> {
    const existing = await this.getCampaign(id);
    if (!existing) throw new Error(`Campaign not found: ${id}`);
    const nextMonthly = patch.monthlyBudgetCents ?? existing.monthlyBudgetCents;
    if (existing.reservedCents + existing.spentCents > nextMonthly) {
      throw new PolicyViolationError(
        "BUDGET_CAP_EXCEEDED",
        "inv_budget_never_exceeded",
        "Cannot lower monthly budget below reserved + spent.",
      );
    }
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.campaigns set
        name = ${patch.name ?? existing.name},
        city = ${patch.city ?? existing.city},
        risk_zone = ${patch.riskZone ?? existing.riskZone},
        risk_dial = ${patch.riskDial ?? existing.riskDial},
        monthly_budget_cents = ${nextMonthly},
        daily_cap_cents = ${patch.dailyCapCents ?? existing.dailyCapCents},
        max_task_cents = ${patch.maxTaskCents ?? existing.maxTaskCents},
        billing_armed = ${patch.billingArmed ?? existing.billingArmed},
        slop_cash_enabled = ${patch.slopCashEnabled ?? existing.slopCashEnabled},
        status = ${patch.status ?? existing.status},
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    const daily = await this.dailySpentForCampaign(this.sql, id, toJsonObj(r.metadata));
    return this.mapCampaign(r, daily);
  }

  async setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign> {
    return this.updateCampaign(id, {
      riskDial,
      ...(billingArmed !== undefined ? { billingArmed } : {}),
    });
  }

  async upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const [r] = await this.sql`
      insert into marketing.agents (
        id, persona_id, display_name, app_id, provider, failover_provider,
        auth_mode, session_ref, session_healthy, daily_turn_cap,
        turns_used_today, cooldown_until, status, created_at, updated_at
      ) values (
        ${id}, ${input.personaId}, ${input.displayName}, ${input.appId},
        ${input.provider}, ${input.failoverProvider ?? null},
        ${authModeToDb(input.authMode ?? "cli")}, ${input.sessionRef ?? ""},
        ${input.sessionHealthy ?? true}, ${input.dailyTurnCap ?? 60},
        ${input.turnsUsedToday ?? 0},
        ${input.cooldownUntil ? new Date(input.cooldownUntil) : null},
        ${input.status ?? "idle"}, ${now}, ${now}
      )
      on conflict (persona_id) do update set
        display_name = excluded.display_name,
        app_id = excluded.app_id,
        provider = excluded.provider,
        failover_provider = excluded.failover_provider,
        auth_mode = excluded.auth_mode,
        session_ref = excluded.session_ref,
        session_healthy = excluded.session_healthy,
        daily_turn_cap = excluded.daily_turn_cap,
        turns_used_today = excluded.turns_used_today,
        cooldown_until = excluded.cooldown_until,
        status = excluded.status,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapAgent(r);
  }

  async getAgent(id: string): Promise<MarketingAgent | null> {
    const [r] = await this.sql`select * from marketing.agents where id = ${id}`;
    return r ? this.mapAgent(r) : null;
  }

  async getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null> {
    const [r] = await this.sql`select * from marketing.agents where persona_id = ${personaId}`;
    return r ? this.mapAgent(r) : null;
  }

  async listAgents(): Promise<MarketingAgent[]> {
    const rows = await this.sql`select * from marketing.agents order by persona_id`;
    return (rows as Row[]).map((r) => this.mapAgent(r));
  }

  async updateAgent(
    id: string,
    patch: Partial<Omit<MarketingAgent, "id" | "personaId">>,
  ): Promise<MarketingAgent> {
    const existing = await this.getAgent(id);
    if (!existing) throw new Error(`Agent not found: ${id}`);
    const now = new Date(this.clock.now());
    const nextCooldown =
      patch.cooldownUntil !== undefined ? patch.cooldownUntil : existing.cooldownUntil;
    const [r] = await this.sql`
      update marketing.agents set
        display_name = ${patch.displayName ?? existing.displayName},
        app_id = ${patch.appId ?? existing.appId},
        provider = ${patch.provider ?? existing.provider},
        failover_provider = ${patch.failoverProvider !== undefined ? patch.failoverProvider : existing.failoverProvider},
        auth_mode = ${authModeToDb(patch.authMode ?? existing.authMode)},
        session_ref = ${patch.sessionRef ?? existing.sessionRef},
        session_healthy = ${patch.sessionHealthy ?? existing.sessionHealthy},
        daily_turn_cap = ${patch.dailyTurnCap ?? existing.dailyTurnCap},
        turns_used_today = ${patch.turnsUsedToday ?? existing.turnsUsedToday},
        cooldown_until = ${nextCooldown ? new Date(nextCooldown) : null},
        status = ${patch.status ?? existing.status},
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    return this.mapAgent(r);
  }

  async consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    return this.sql.begin(async (tx) => {
      const [ar] = await tx`select * from marketing.agents where id = ${input.agentId} for update`;
      if (!ar) throw new Error(`Agent not found: ${input.agentId}`);
      const agent = this.mapAgent(ar);

      let lockdown = Boolean(input.lockdown);
      if (input.campaignId) {
        const [cr] = await tx`select risk_dial from marketing.campaigns where id = ${input.campaignId}`;
        if (cr?.risk_dial === "lockdown") lockdown = true;
      }

      let targetStopped = Boolean(input.targetStopped);
      if (input.targetHumanId) {
        const [hr] = await tx`select stopped, banned from marketing.humans where id = ${input.targetHumanId}`;
        if (hr && (hr.stopped || hr.banned)) targetStopped = true;
      }

      const nowMs = this.clock.now();
      const inCooldown = agent.cooldownUntil !== null && Date.parse(agent.cooldownUntil) > nowMs;
      const allowed = canDispatchAgentTurn(
        agent.status === "paused_stop",
        agent.status === "rate_limited" || inCooldown,
        agent.sessionHealthy,
        agent.turnsUsedToday,
        agent.dailyTurnCap,
        targetStopped,
        lockdown,
      );

      if (!allowed) {
        const reason = targetStopped
          ? "target_stopped"
          : lockdown
            ? "campaign_lockdown"
            : agent.status === "paused_stop"
              ? "agent_paused"
              : agent.status === "rate_limited" || inCooldown
                ? "rate_limited"
                : !agent.sessionHealthy
                  ? "session_unhealthy"
                  : "daily_turn_cap_reached";
        return { allowed: false, agent, reason };
      }

      const [updated] = await tx`
        update marketing.agents
        set turns_used_today = turns_used_today + 1, updated_at = ${new Date(nowMs)}
        where id = ${input.agentId}
        returning *
      `;
      return { allowed: true, agent: this.mapAgent(updated) };
    });
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const warmupDay = input.warmupDay ?? 1;
    const [r] = await this.sql`
      insert into marketing.devices (
        id, label, platform, host_machine, serial_or_udid, assigned_persona,
        sim_carrier, battery_pct, temp_c, warmup_day, warmup_stage,
        daily_actions_used, daily_action_cap, lease_holder, lease_expires_at,
        status, last_seen_at, created_at
      ) values (
        ${id}, ${input.label}, ${input.platform}, ${input.hostMachine ?? "local-macbook"},
        ${input.serialOrUdid}, ${input.assignedPersona ?? null}, ${input.simCarrier ?? null},
        ${input.batteryPct ?? 60}, ${input.tempC ?? 30}, ${warmupDay},
        ${input.warmupStage ?? warmupStageForDay(warmupDay)},
        ${input.dailyActionsUsed ?? 0}, ${input.dailyActionCap ?? warmupDailyCap(warmupDay)},
        ${input.leaseHolder ?? null},
        ${input.leaseExpiresAt ? new Date(input.leaseExpiresAt) : null},
        ${input.status ?? "online"}, ${now}, ${now}
      )
      on conflict (serial_or_udid) do update set
        label = excluded.label,
        platform = excluded.platform,
        host_machine = excluded.host_machine,
        assigned_persona = excluded.assigned_persona,
        sim_carrier = excluded.sim_carrier,
        battery_pct = excluded.battery_pct,
        temp_c = excluded.temp_c,
        warmup_day = excluded.warmup_day,
        warmup_stage = excluded.warmup_stage,
        daily_actions_used = excluded.daily_actions_used,
        daily_action_cap = excluded.daily_action_cap,
        lease_holder = excluded.lease_holder,
        lease_expires_at = excluded.lease_expires_at,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at
      returning *
    `;
    return this.mapDevice(r);
  }

  async getDevice(id: string): Promise<DeviceNode | null> {
    const [r] = await this.sql`select * from marketing.devices where id = ${id}`;
    return r ? this.mapDevice(r) : null;
  }

  async listDevices(): Promise<DeviceNode[]> {
    const rows = await this.sql`select * from marketing.devices order by label`;
    return (rows as Row[]).map((r) => this.mapDevice(r));
  }

  async updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode> {
    const existing = await this.getDevice(id);
    if (!existing) throw new Error(`Device not found: ${id}`);
    const warmupDay = update.warmupDay ?? existing.warmupDay;
    const safe = deviceBatterySafe(update.batteryPct, update.tempC);
    let nextStatus = update.status ?? existing.status;
    if (!safe && nextStatus !== "offline" && nextStatus !== "needs_takeover") {
      nextStatus = update.tempC > 41 ? "thermal_cooldown" : "charging_wait";
    } else if (safe && (existing.status === "thermal_cooldown" || existing.status === "charging_wait")) {
      nextStatus = existing.leaseHolder ? "leased" : "online";
    }
    const [r] = await this.sql`
      update marketing.devices set
        battery_pct = ${update.batteryPct},
        temp_c = ${update.tempC},
        warmup_day = ${warmupDay},
        warmup_stage = ${warmupStageForDay(warmupDay)},
        daily_action_cap = ${warmupDailyCap(warmupDay)},
        status = ${nextStatus},
        last_seen_at = ${new Date(this.clock.now())}
      where id = ${id}
      returning *
    `;
    return this.mapDevice(r);
  }

  async acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts: { lockdown?: boolean; targetStopped?: boolean } = {},
  ): Promise<DeviceNode> {
    return this.sql.begin(async (tx) => {
      const [dr] = await tx`select * from marketing.devices where id = ${id} for update`;
      if (!dr) throw new Error(`Device not found: ${id}`);
      const device = this.mapDevice(dr);
      const nowMs = this.clock.now();
      const activeLease =
        device.leaseHolder !== null &&
        device.leaseExpiresAt !== null &&
        Date.parse(device.leaseExpiresAt) > nowMs;
      const leasedByOther = activeLease && device.leaseHolder !== leaseHolder;
      const deviceOnline = device.status === "online" || device.status === "leased";

      const ok = canExecuteDeviceAction(
        deviceOnline,
        leasedByOther,
        device.batteryPct,
        device.tempC,
        device.dailyActionsUsed,
        device.warmupDay,
        Boolean(opts.lockdown),
        Boolean(opts.targetStopped),
      );
      if (!ok) {
        throw new PolicyViolationError(
          "DEVICE_LEASE_DENIED",
          "inv_device_safety_envelope",
          `Cannot lease device ${device.label}: safety envelope or lease exclusion failed.`,
        );
      }

      const [updated] = await tx`
        update marketing.devices set
          lease_holder = ${leaseHolder},
          lease_expires_at = ${new Date(nowMs + Math.max(1_000, ttlMs))},
          status = 'leased',
          last_seen_at = ${new Date(nowMs)}
        where id = ${id}
        returning *
      `;
      return this.mapDevice(updated);
    });
  }

  async releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode> {
    return this.sql.begin(async (tx) => {
      const [dr] = await tx`select * from marketing.devices where id = ${id} for update`;
      if (!dr) throw new Error(`Device not found: ${id}`);
      const device = this.mapDevice(dr);
      if (leaseHolder && device.leaseHolder && device.leaseHolder !== leaseHolder) {
        throw new PolicyViolationError(
          "LEASE_OWNER_MISMATCH",
          "inv_device_safety_envelope",
          `Device ${device.label} is leased by ${device.leaseHolder}, not ${leaseHolder}.`,
        );
      }
      const nextStatus: DeviceStatus = device.status === "leased" ? "online" : device.status;
      const [updated] = await tx`
        update marketing.devices set
          lease_holder = null,
          lease_expires_at = null,
          status = ${nextStatus},
          last_seen_at = ${new Date(this.clock.now())}
        where id = ${id}
        returning *
      `;
      return this.mapDevice(updated);
    });
  }

  async recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt> {
    return this.sql.begin(async (tx) => {
      const [dr] = await tx`select * from marketing.devices where id = ${input.deviceId} for update`;
      if (!dr) throw new Error(`Device not found: ${input.deviceId}`);
      const device = this.mapDevice(dr);
      let targetStopped = Boolean(input.targetStopped);
      if (input.targetHumanId) {
        const [hr] = await tx`select stopped, banned from marketing.humans where id = ${input.targetHumanId}`;
        if (hr && (hr.stopped || hr.banned)) targetStopped = true;
      }

      const nowMs = this.clock.now();
      const activeLease =
        device.leaseHolder !== null &&
        device.leaseExpiresAt !== null &&
        Date.parse(device.leaseExpiresAt) > nowMs;
      const leasedByOther = activeLease && device.leaseHolder !== input.leaseHolder;
      const deviceOnline = device.status === "online" || device.status === "leased";

      const allowed = canExecuteDeviceAction(
        deviceOnline,
        leasedByOther,
        device.batteryPct,
        device.tempC,
        device.dailyActionsUsed,
        device.warmupDay,
        Boolean(input.lockdown),
        targetStopped,
      );

      if (!allowed) {
        return {
          allowed: false,
          device,
          reason: targetStopped
            ? "target_stopped"
            : input.lockdown
              ? "lockdown"
              : leasedByOther
                ? "leased_by_other"
                : !deviceOnline
                  ? "device_offline"
                  : !deviceBatterySafe(device.batteryPct, device.tempC)
                    ? "battery_or_thermal_unsafe"
                    : "warmup_cap_reached",
        };
      }

      const [updated] = await tx`
        update marketing.devices set
          daily_actions_used = daily_actions_used + 1,
          daily_action_cap = ${warmupDailyCap(device.warmupDay)},
          last_seen_at = ${new Date(nowMs)}
        where id = ${input.deviceId}
        returning *
      `;
      return { allowed: true, device: this.mapDevice(updated) };
    });
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const meta = JSON.stringify({ channel: input.channel, city: input.city ?? "nyc" });
    const [r] = await this.sql`
      insert into marketing.channels_and_accounts (
        id, agent_id, device_id, app_id, platform, handle, warmup_day,
        daily_post_cap, posts_today, status, metadata, created_at, updated_at
      ) values (
        ${id}, ${input.agentId}, ${input.deviceId ?? null}, ${input.appId ?? "all"},
        ${channelToAccountPlatform(input.channel)}, ${input.handle},
        ${input.warmupDay ?? 0}, ${input.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP},
        ${input.sentToday ?? 0}, ${channelStatusToDb(input.status ?? "active")},
        ${meta}::jsonb, ${now}, ${now}
      )
      on conflict (platform, handle) do update set
        agent_id = excluded.agent_id,
        device_id = excluded.device_id,
        warmup_day = excluded.warmup_day,
        daily_post_cap = excluded.daily_post_cap,
        posts_today = excluded.posts_today,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapChannelAccount(r);
  }

  async getChannelAccount(id: string): Promise<ChannelAccount | null> {
    const [r] = await this.sql`select * from marketing.channels_and_accounts where id = ${id}`;
    return r ? this.mapChannelAccount(r) : null;
  }

  async listChannelAccounts(filter?: {
    agentId?: string;
    channel?: OutreachChannel;
  }): Promise<ChannelAccount[]> {
    const rows = await this.sql`select * from marketing.channels_and_accounts order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapChannelAccount(r))
      .filter((c) => !filter?.agentId || c.agentId === filter.agentId)
      .filter((c) => !filter?.channel || c.channel === filter.channel);
  }

  async upsertHuman(input: UpsertHumanInput): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const existing = await this.getHumanByHmac(input.handleOrEmailHmac);
    const lowestAge = minAge(existing?.lowestAge ?? null, input.lowestAge);
    const stopped = Boolean(existing?.stopped || input.stopped);
    const banned = Boolean(existing?.banned || input.banned);
    const meta = JSON.stringify({ channel: input.channel });
    const [r] = await this.sql`
      insert into marketing.humans (
        id, contact_key, display_name, role, source_channel, city,
        age_years, age_verified, stopped, stop_reason, banned,
        daily_sends_today, last_contacted_at, metadata, created_at, updated_at
      ) values (
        ${existing?.id ?? id}, ${input.handleOrEmailHmac}, ${input.displayLabel},
        ${input.role}, ${channelToHumanSource(input.channel)}, ${input.city ?? "nyc"},
        ${lowestAge}, ${lowestAge !== null && adultParticipantAge(lowestAge)},
        ${stopped}, ${input.stopReason ?? existing?.stopReason ?? null}, ${banned},
        ${input.dailySendsToday ?? existing?.dailySendsToday ?? 0},
        ${input.lastContactedAt ? new Date(input.lastContactedAt) : null},
        ${meta}::jsonb, ${now}, ${now}
      )
      on conflict (contact_key) do update set
        display_name = excluded.display_name,
        role = excluded.role,
        city = excluded.city,
        age_years = excluded.age_years,
        age_verified = excluded.age_verified,
        stopped = excluded.stopped,
        stop_reason = excluded.stop_reason,
        banned = excluded.banned,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapHuman(r);
  }

  async getHuman(id: string): Promise<HumanPartner | null> {
    const [r] = await this.sql`select * from marketing.humans where id = ${id}`;
    return r ? this.mapHuman(r) : null;
  }

  async getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null> {
    const [r] = await this.sql`select * from marketing.humans where contact_key = ${handleOrEmailHmac}`;
    return r ? this.mapHuman(r) : null;
  }

  async listHumans(filter?: {
    city?: string;
    role?: HumanRole;
    stopped?: boolean;
  }): Promise<HumanPartner[]> {
    const rows = await this.sql`select * from marketing.humans order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapHuman(r))
      .filter((h) => !filter?.city || h.city === filter.city)
      .filter((h) => !filter?.role || h.role === filter.role)
      .filter((h) => filter?.stopped === undefined || h.stopped === filter.stopped);
  }

  async markHumanStopped(id: string, reason: string): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.humans set
        stopped = true,
        stop_reason = ${reason},
        stopped_at = coalesce(stopped_at, ${now}),
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    if (!r) throw new Error(`Human not found: ${id}`);
    return this.mapHuman(r);
  }

  async markHumanBanned(id: string, reason: string): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.humans set
        banned = true,
        ban_reason = ${reason},
        stopped = true,
        stop_reason = ${reason},
        stopped_at = coalesce(stopped_at, ${now}),
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    if (!r) throw new Error(`Human not found: ${id}`);
    return this.mapHuman(r);
  }

  async recordHumanAge(id: string, age: number): Promise<HumanPartner> {
    const existing = await this.getHuman(id);
    if (!existing) throw new Error(`Human not found: ${id}`);
    const nextAge = minAge(existing.lowestAge, age);
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.humans set
        age_years = ${nextAge},
        age_verified = ${nextAge !== null && adultParticipantAge(nextAge)},
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    return this.mapHuman(r);
  }

  async createTask(input: CreateTaskInput): Promise<MarketingTask> {
    const campaign = await this.getCampaign(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const payoutRail: PayoutRail = input.payoutRail ?? (input.tier >= 3 ? "fiat_stripe" : "none");
    const status: TaskStatus = input.status ?? "drafted";

    if (payoutRail === "slop_cash") {
      if (input.taskKind !== "oss_dev_bounty") {
        throw new PolicyViolationError(
          "SLOP_CASH_OSS_ONLY",
          "inv_slop_cash_disabled",
          "slop_cash payout rail is restricted strictly to oss_dev_bounty tasks.",
        );
      }
      if (!campaign.slopCashEnabled || !input.slopCashEnvEnabled) {
        throw new PolicyViolationError(
          "SLOP_CASH_DISABLED",
          "inv_slop_cash_disabled",
          "Cannot create slop_cash task while slop.cash is disabled.",
        );
      }
    }

    const human = input.assigneeHumanId ? await this.getHuman(input.assigneeHumanId) : null;
    const effectiveAge = minAge(human?.lowestAge ?? null, input.assigneeAgeYears);
    const hiredOrLater: TaskStatus[] = [
      "hired",
      "shift_active",
      "proof_submitted",
      "proof_verified",
      "payout_queued",
      "paid",
    ];
    if (input.tier === 4 && hiredOrLater.includes(status)) {
      if (effectiveAge === null || !adultParticipantAge(effectiveAge)) {
        throw new PolicyViolationError(
          "UNDERAGE_OR_UNKNOWN_WORKER",
          "inv_adult_only_paid",
          "Tier 4 task requires a verified 18+ adult before hiring.",
        );
      }
    }
    if (status === "paid") {
      throw new PolicyViolationError(
        "DIRECT_PAID_FORBIDDEN",
        "inv_proof_required_before_payout",
        "Tasks cannot be created directly in paid state; use evaluateProof and markTaskPaid.",
      );
    }

    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const meta = JSON.stringify(payoutRail === "usdc_direct" ? { payoutRail: "usdc_direct" } : {});
    const [r] = await this.sql`
      insert into marketing.tasks (
        id, campaign_id, human_id, tier, task_kind, app_id, city, title, brief_text,
        vendor_channel, worker_age_years, amount_cents, qr_batch_code, short_url,
        payout_rail, proof_verified, status, metadata, created_at, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.assigneeHumanId ?? null}, ${input.tier},
        ${input.taskKind}, ${campaign.appId}, ${input.city ?? campaign.city},
        ${input.title}, ${input.briefText}, ${input.vendorChannel},
        ${effectiveAge}, ${input.amountCents ?? 0}, ${input.qrBatchCode ?? null},
        ${input.dubShortUrl ?? null}, ${payoutRailToDb(payoutRail)}, false,
        ${status}, ${meta}::jsonb, ${now}, ${now}
      ) returning *
    `;
    return this.mapTask(r);
  }

  async getTask(id: string): Promise<MarketingTask | null> {
    const [r] = await this.sql`select * from marketing.tasks where id = ${id}`;
    return r ? this.mapTask(r) : null;
  }

  async listTasks(filter?: {
    campaignId?: string;
    status?: TaskStatus;
    taskKind?: TaskKind;
    city?: string;
  }): Promise<MarketingTask[]> {
    const rows = await this.sql`select * from marketing.tasks order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapTask(r))
      .filter((t) => !filter?.campaignId || t.campaignId === filter.campaignId)
      .filter((t) => !filter?.status || t.status === filter.status)
      .filter((t) => !filter?.taskKind || t.taskKind === filter.taskKind)
      .filter((t) => !filter?.city || t.city === filter.city);
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask> {
    const existing = await this.getTask(id);
    if (!existing) throw new Error(`Task not found: ${id}`);
    if (patch.status === "paid") {
      throw new PolicyViolationError(
        "DIRECT_PAID_FORBIDDEN",
        "inv_proof_required_before_payout",
        "Use markTaskPaid to transition a task to paid.",
      );
    }
    const nextAge =
      patch.assigneeAgeYears !== undefined
        ? minAge(existing.assigneeAgeYears, patch.assigneeAgeYears)
        : existing.assigneeAgeYears;
    const nextStatus = patch.status ?? existing.status;
    const hiredOrLater: TaskStatus[] = [
      "hired",
      "shift_active",
      "proof_submitted",
      "proof_verified",
      "payout_queued",
    ];
    if (existing.tier === 4 && hiredOrLater.includes(nextStatus)) {
      if (nextAge === null || !adultParticipantAge(nextAge)) {
        throw new PolicyViolationError(
          "UNDERAGE_OR_UNKNOWN_WORKER",
          "inv_adult_only_paid",
          "Cannot hire or advance Tier 4 task without verified adult age (18..120).",
        );
      }
    }
    const nextRail = patch.payoutRail ?? existing.payoutRail;
    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.tasks set
        title = ${patch.title ?? existing.title},
        brief_text = ${patch.briefText ?? existing.briefText},
        human_id = ${patch.assigneeHumanId !== undefined ? patch.assigneeHumanId : existing.assigneeHumanId},
        worker_age_years = ${nextAge},
        amount_cents = ${patch.amountCents ?? existing.amountCents},
        qr_batch_code = ${patch.qrBatchCode !== undefined ? patch.qrBatchCode : existing.qrBatchCode},
        short_url = ${patch.dubShortUrl !== undefined ? patch.dubShortUrl : existing.dubShortUrl},
        payout_rail = ${payoutRailToDb(nextRail)},
        proof_verified = ${patch.proofVerified ?? existing.proofVerified},
        status = ${nextStatus},
        paid_at = ${patch.paidAt !== undefined ? (patch.paidAt ? new Date(patch.paidAt) : null) : (existing.paidAt ? new Date(existing.paidAt) : null)},
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    return this.mapTask(r);
  }

  async markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const human = task.assigneeHumanId ? await this.getHuman(task.assigneeHumanId) : null;
    const proofs = await this.listProofs({ taskId });
    assertProofAndAdultForPayout(task, proofs[0] ?? null, human);

    const { entry, campaign } = await this.authorizeSpend({
      campaignId: task.campaignId,
      taskId: task.id,
      adapterId: opts.adapterId,
      tier: task.tier,
      amountCents: task.amountCents,
      entryType: "commit",
      idempotencyKey: opts.idempotencyKey,
      externalRef: opts.externalRef ?? null,
      useSlopCash: task.payoutRail === "slop_cash",
      slopCashEnvEnabled: Boolean(opts.slopCashEnvEnabled),
      fromReserve: opts.fromReserve,
    });

    const now = new Date(this.clock.now());
    const [r] = await this.sql`
      update marketing.tasks set
        status = 'paid',
        paid_at = ${now},
        updated_at = ${now}
      where id = ${taskId}
      returning *
    `;
    return { task: this.mapTask(r), entry, campaign };
  }

  async createProof(input: CreateProofInput): Promise<ProofSubmission> {
    const task = await this.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const hashes = JSON.stringify(input.checkinMediaHashes ?? []);
    const [r] = await this.sql`
      insert into marketing.proofs (
        id, task_id, human_id, proof_kind, evidence_url, checkin_media_hashes,
        geo_time_valid, qr_scans_count, verified_signups_count, ftc_disclosed,
        likeness_releases_count, featured_interviewees_count, likeness_release_ok,
        verifier_verdict, verifier_notes, created_at
      ) values (
        ${id}, ${input.taskId}, ${task.assigneeHumanId}, ${input.proofKind},
        ${input.evidenceUrl ?? null}, ${hashes}::jsonb,
        ${input.geoTimeValid ?? false}, ${input.qrScansCount ?? 0},
        ${input.verifiedSignupsCount ?? 0}, ${input.ftcDisclosed ?? false},
        ${input.likenessReleaseOk ? 1 : 0}, ${input.proofKind === "creator_video" ? 1 : 0},
        ${input.likenessReleaseOk ?? false}, 'pending', ${input.verifierNotes ?? null}, ${now}
      ) returning *
    `;
    if (task.status !== "paid" && task.status !== "cancelled") {
      await this.sql`
        update marketing.tasks set status = 'proof_submitted', updated_at = ${now}
        where id = ${input.taskId}
      `;
    }
    return this.mapProof(r);
  }

  async getProof(id: string): Promise<ProofSubmission | null> {
    const [r] = await this.sql`select * from marketing.proofs where id = ${id}`;
    return r ? this.mapProof(r) : null;
  }

  async listProofs(filter?: { taskId?: string; verdict?: ProofVerdict }): Promise<ProofSubmission[]> {
    const rows = await this.sql`select * from marketing.proofs order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapProof(r))
      .filter((p) => !filter?.taskId || p.taskId === filter.taskId)
      .filter((p) => !filter?.verdict || p.verdict === filter.verdict);
  }

  async evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult> {
    const proof = await this.getProof(proofId);
    if (!proof) throw new Error(`Proof not found: ${proofId}`);
    const task = await this.getTask(proof.taskId);
    if (!task) throw new Error(`Task not found: ${proof.taskId}`);

    const hasEvidenceUrl = Boolean(proof.evidenceUrl && proof.evidenceUrl.trim().length > 0);
    const verifiedSignupsOrShiftDone = Boolean(
      opts.shiftDone ||
        proof.verifiedSignupsCount > 0 ||
        proof.qrScansCount > 0 ||
        proof.checkinMediaHashes.length >= 2,
    );

    const coreApproved = canApproveProof(
      hasEvidenceUrl,
      proof.ftcDisclosed,
      proof.geoTimeValid,
      verifiedSignupsOrShiftDone,
      opts.workerAge,
      opts.workerBanned,
    );
    const releaseOk = proof.proofKind !== "creator_video" || proof.likenessReleaseOk;
    const approved = coreApproved && releaseOk;

    let reason: string | undefined;
    if (!approved) {
      if (!adultParticipantAge(opts.workerAge)) reason = "worker_underage_or_invalid_age";
      else if (opts.workerBanned) reason = "worker_banned";
      else if (!hasEvidenceUrl) reason = "missing_evidence_url";
      else if (!proof.ftcDisclosed) reason = "missing_ftc_disclosure";
      else if (!proof.geoTimeValid) reason = "invalid_geo_time_window";
      else if (!verifiedSignupsOrShiftDone) reason = "missing_shift_or_signup_evidence";
      else if (!releaseOk) reason = "missing_ny_likeness_release";
    }

    const now = new Date(this.clock.now());
    const notes =
      opts.verifierNotes ??
      (approved ? "Approved by proved marketingPolicy.canApproveProof" : `Rejected: ${reason}`);
    const [pr] = await this.sql`
      update marketing.proofs set
        verifier_verdict = ${approved ? "verified" : "rejected"},
        verifier_notes = ${notes},
        verified_at = ${approved ? now : null}
      where id = ${proofId}
      returning *
    `;

    const nextAge = minAge(task.assigneeAgeYears, opts.workerAge);
    const [tr] = await this.sql`
      update marketing.tasks set
        worker_age_years = ${nextAge},
        proof_verified = ${approved},
        status = ${approved ? "proof_verified" : "disputed"},
        updated_at = ${now}
      where id = ${task.id}
      returning *
    `;

    return {
      proof: this.mapProof(pr),
      task: this.mapTask(tr),
      approved,
      ...(reason ? { reason } : {}),
    };
  }

  async createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage> {
    const campaign = await this.getCampaign(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const human = await this.getHuman(input.humanId);
    if (!human) throw new Error(`Human not found: ${input.humanId}`);
    const account = input.channelAccountId ? await this.getChannelAccount(input.channelAccountId) : null;

    const sentToday = account ? account.sentToday : human.dailySendsToday;
    const dailyOutreachCap =
      input.dailyOutreachCap ?? account?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;
    const gatePass = canSendOutreach(
      human.stopped,
      human.banned,
      campaign.riskDial === "lockdown",
      sentToday,
      dailyOutreachCap,
    );

    let status: OutreachStatus;
    if (human.stopped) status = "blocked_stop";
    else if (!gatePass || !input.leakCheckPass) status = "blocked_policy";
    else status = input.desiredStatus ?? "queued";

    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const bodyText = input.bodySummary.trim().length > 0 ? input.bodySummary : "(empty)";
    const [r] = await this.sql`
      insert into marketing.outreach_messages (
        id, campaign_id, agent_id, human_id, channel, direction,
        template_id, subject, body_text, leak_check_pass, external_message_id,
        status, sent_at, created_at
      ) values (
        ${id}, ${input.campaignId}, ${input.agentId}, ${input.humanId},
        ${channelToOutreachDb(input.channel)}, 'outbound',
        ${`ch:${input.channel}`}, ${input.subject ?? null}, ${bodyText},
        ${input.leakCheckPass}, ${input.externalRef ?? null},
        ${status}, ${status === "sent" || status === "delivered" ? now : null}, ${now}
      ) returning *
    `;

    if (status === "sent" || status === "delivered") {
      await this.sql`
        update marketing.humans set
          daily_sends_today = daily_sends_today + 1,
          last_contacted_at = ${now},
          updated_at = ${now}
        where id = ${human.id}
      `;
      if (account) {
        await this.sql`
          update marketing.channels_and_accounts set
            posts_today = posts_today + 1,
            updated_at = ${now}
          where id = ${account.id}
        `;
      }
    }

    const mapped = this.mapOutreach(r);
    mapped.tier = input.tier;
    return mapped;
  }

  async listOutreachMessages(filter?: {
    campaignId?: string;
    humanId?: string;
    agentId?: string;
    status?: OutreachStatus;
  }): Promise<OutreachMessage[]> {
    const rows = await this.sql`select * from marketing.outreach_messages order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapOutreach(r))
      .filter((m) => !filter?.campaignId || m.campaignId === filter.campaignId)
      .filter((m) => !filter?.humanId || m.humanId === filter.humanId)
      .filter((m) => !filter?.agentId || m.agentId === filter.agentId)
      .filter((m) => !filter?.status || m.status === filter.status);
  }

  async updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
  ): Promise<OutreachMessage> {
    const [existingRow] = await this.sql`select * from marketing.outreach_messages where id = ${id}`;
    if (!existingRow) throw new Error(`Outreach message not found: ${id}`);
    const existing = this.mapOutreach(existingRow);
    const now = new Date(this.clock.now());

    let finalStatus = status;
    if (status === "sent" || status === "delivered") {
      const campaign = await this.getCampaign(existing.campaignId);
      const human = await this.getHuman(existing.humanId);
      if (!campaign || !human) throw new Error("Missing campaign or human for outreach send");
      const allowed = canSendOutreach(
        human.stopped,
        human.banned,
        campaign.riskDial === "lockdown",
        human.dailySendsToday,
        DEFAULT_DAILY_OUTREACH_CAP,
      );
      if (!allowed || !existing.leakCheckPass) {
        finalStatus = human.stopped ? "blocked_stop" : "blocked_policy";
      } else if (existing.status !== "sent" && existing.status !== "delivered") {
        await this.sql`
          update marketing.humans set
            daily_sends_today = daily_sends_today + 1,
            last_contacted_at = ${now},
            updated_at = ${now}
          where id = ${human.id}
        `;
      }
    }

    const [r] = await this.sql`
      update marketing.outreach_messages set
        status = ${finalStatus},
        external_message_id = ${externalRef !== undefined ? externalRef : existing.externalRef},
        sent_at = ${finalStatus === "sent" || finalStatus === "delivered" ? now : existingRow.sent_at}
      where id = ${id}
      returning *
    `;
    return this.mapOutreach(r);
  }

  async recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent> {
    const campaign = await this.getCampaign(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const now = new Date(this.clock.now());
    const meta = JSON.stringify({
      ...(input.metadata ?? {}),
      __count: input.count ?? 1,
      __qrBatchNull: !input.qrBatchCode,
    });
    const [r] = await this.sql`
      insert into marketing.attribution_events (
        campaign_id, task_id, qr_batch_code, app_id, city, event_type,
        is_adult_verified, metadata, occurred_at, created_at
      ) values (
        ${input.campaignId}, ${input.taskId ?? null},
        ${input.qrBatchCode ?? "DIRECT"}, ${input.appId},
        ${input.city ?? campaign.city}, ${attributionKindToDb(input.eventKind)},
        ${input.eventKind === "signup_verified_adult"}, ${meta}::jsonb, ${now}, ${now}
      ) returning *
    `;
    return this.mapAttribution(r);
  }

  async listAttributionEvents(filter?: {
    campaignId?: string;
    taskId?: string;
    qrBatchCode?: string;
    appId?: BrandAppId;
  }): Promise<AttributionEvent[]> {
    const rows = await this.sql`select * from marketing.attribution_events order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapAttribution(r))
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.qrBatchCode || e.qrBatchCode === filter.qrBatchCode)
      .filter((e) => !filter?.appId || e.appId === filter.appId);
  }

  async authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult> {
    return this.sql.begin(async (tx) => {
      const [existingEntry] = await tx`
        select * from marketing.budget_ledger where idempotency_key = ${input.idempotencyKey}
      `;
      if (existingEntry) {
        const [cr] = await tx`select * from marketing.campaigns where id = ${existingEntry.campaign_id}`;
        const daily = await this.dailySpentForCampaign(tx, String(cr.id), toJsonObj(cr.metadata));
        return {
          entry: this.mapBudgetEntry(existingEntry),
          campaign: this.mapCampaign(cr, daily),
          replayed: true,
        };
      }

      const [cr] = await tx`select * from marketing.campaigns where id = ${input.campaignId} for update`;
      if (!cr) throw new Error(`Campaign not found: ${input.campaignId}`);
      const daily = await this.dailySpentForCampaign(tx, input.campaignId, toJsonObj(cr.metadata));
      const campaign = this.mapCampaign(cr, daily);

      const useSlopCash = Boolean(input.useSlopCash || input.adapterId === "slop_cash");
      if (input.entryType === "reserve" || input.entryType === "commit") {
        assertSpendAllowed(campaign, {
          tier: input.tier,
          amountCents: input.amountCents,
          useSlopCash,
          slopCashEnvEnabled: Boolean(input.slopCashEnvEnabled),
          fromReserve: input.fromReserve,
        });
      } else if (input.amountCents <= 0) {
        throw new PolicyViolationError(
          "INVALID_AMOUNT",
          "inv_budget_never_exceeded",
          "Budget ledger entries require a positive amountCents.",
        );
      }

      let nextReserved = campaign.reservedCents;
      let nextSpent = campaign.spentCents;
      if (input.entryType === "reserve") {
        nextReserved += input.amountCents;
      } else if (input.entryType === "commit") {
        if (input.fromReserve) nextReserved = Math.max(0, nextReserved - input.amountCents);
        nextSpent += input.amountCents;
      } else if (input.entryType === "release") {
        nextReserved = Math.max(0, nextReserved - input.amountCents);
      } else if (input.entryType === "refund") {
        nextSpent = Math.max(0, nextSpent - input.amountCents);
      }

      const now = new Date(this.clock.now());
      const [inserted] = await tx`
        insert into marketing.budget_ledger (
          campaign_id, task_id, adapter_id, tier, amount_cents, entry_type,
          payout_rail, idempotency_key, external_ref, created_at
        ) values (
          ${input.campaignId}, ${input.taskId ?? null}, ${input.adapterId}, ${input.tier},
          ${input.amountCents}, ${input.entryType},
          ${useSlopCash ? "slop_cash" : input.tier >= 3 ? "fiat_stripe" : "none"},
          ${input.idempotencyKey}, ${input.externalRef ?? null}, ${now}
        ) returning *
      `;

      const [updatedCr] = await tx`
        update marketing.campaigns set
          reserved_cents = ${nextReserved},
          spent_cents = ${nextSpent},
          updated_at = ${now}
        where id = ${input.campaignId}
        returning *
      `;
      const updatedDaily = await this.dailySpentForCampaign(tx, input.campaignId, toJsonObj(updatedCr.metadata));
      return {
        entry: this.mapBudgetEntry(inserted),
        campaign: this.mapCampaign(updatedCr, updatedDaily),
        replayed: false,
      };
    });
  }

  async listBudgetEntries(filter?: {
    campaignId?: string;
    taskId?: string;
    entryType?: BudgetEntryType;
  }): Promise<BudgetEntry[]> {
    const rows = await this.sql`select * from marketing.budget_ledger order by created_at desc`;
    return (rows as Row[])
      .map((r) => this.mapBudgetEntry(r))
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.entryType || e.entryType === filter.entryType);
  }

  async upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook> {
    const enabled = Boolean(input.enabled);
    const hookState: SlopCashHookState = enabled ? (input.hookState ?? "ready_for_sync") : "disabled_stub";
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const [r] = await this.sql`
      insert into marketing.slop_cash_hooks (
        id, task_id, repo_slug, issue_number, vault_chain,
        estimated_usdc_cents, enabled, hook_state, external_tx_hash,
        created_at, updated_at
      ) values (
        ${id}, ${input.taskId}, ${input.repoSlug ?? "eliza-research/thenetwork"},
        ${input.issueNumber ?? null}, ${input.vaultChain ?? "base"},
        ${input.estimatedUsdcCents}, ${enabled}, ${hookState},
        ${enabled ? (input.externalTxHash ?? null) : null}, ${now}, ${now}
      )
      on conflict (task_id) do update set
        repo_slug = excluded.repo_slug,
        issue_number = excluded.issue_number,
        vault_chain = excluded.vault_chain,
        estimated_usdc_cents = excluded.estimated_usdc_cents,
        enabled = excluded.enabled,
        hook_state = excluded.hook_state,
        external_tx_hash = excluded.external_tx_hash,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapSlopCashHook(r);
  }

  async getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null> {
    const [r] = await this.sql`select * from marketing.slop_cash_hooks where task_id = ${taskId}`;
    return r ? this.mapSlopCashHook(r) : null;
  }

  async listSlopCashHooks(): Promise<SlopCashHook[]> {
    const rows = await this.sql`select * from marketing.slop_cash_hooks order by created_at desc`;
    return (rows as Row[]).map((r) => this.mapSlopCashHook(r));
  }

  async resetDailyCounters(): Promise<void> {
    const nowIso = isoNow(this.clock);
    const now = new Date(this.clock.now());
    const resetMeta = JSON.stringify({ dailyResetAt: nowIso });
    await this.sql.begin(async (tx) => {
      await tx`
        update marketing.campaigns
        set metadata = metadata || ${resetMeta}::jsonb, updated_at = ${now}
      `;
      await tx`
        update marketing.agents
        set turns_used_today = 0,
            status = case when status = 'rate_limited' then 'idle' else status end,
            updated_at = ${now}
      `;
      await tx`update marketing.devices set daily_actions_used = 0`;
      await tx`update marketing.channels_and_accounts set posts_today = 0, updated_at = ${now}`;
      await tx`update marketing.humans set daily_sends_today = 0, updated_at = ${now}`;
    });
  }

  async getOverview(campaignId?: string): Promise<MarketingOverview> {
    const [campaigns, agents, devices, humans, tasks, proofs, outreach, attribution, hooks] =
      await Promise.all([
        this.listCampaigns(),
        this.listAgents(),
        this.listDevices(),
        this.listHumans(),
        this.listTasks(campaignId ? { campaignId } : undefined),
        this.listProofs(),
        this.listOutreachMessages(campaignId ? { campaignId } : undefined),
        this.listAttributionEvents(campaignId ? { campaignId } : undefined),
        this.listSlopCashHooks(),
      ]);

    const filteredCampaigns = campaignId
      ? campaigns.filter((c) => c.id === campaignId)
      : campaigns;
    const taskIds = new Set(tasks.map((t) => t.id));
    const filteredProofs = campaignId ? proofs.filter((p) => taskIds.has(p.taskId)) : proofs;
    const filteredHooks = campaignId ? hooks.filter((h) => taskIds.has(h.taskId)) : hooks;

    return buildOverview(
      isoNow(this.clock),
      filteredCampaigns,
      agents,
      devices,
      humans,
      tasks,
      filteredProofs,
      outreach,
      attribution,
      filteredHooks,
    );
  }
}
