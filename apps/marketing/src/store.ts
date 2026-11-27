// Persistent and in-memory stores for @thenetwork/marketing (Node 26).
// Delegates every policy and device safety decision to canonical ./policy.ts & ./constants.ts,
// wraps every critical state transition in Postgres sql.begin(...) + SELECT ... FOR UPDATE,
// and implements full Memory + Pg CRUD across all 17 marketing.* tables.

import { createHmac, randomUUID } from "node:crypto";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { warmupDailyCap } from "../../../packages/core/src/generated/marketingDevice.ts";
import { isOssDevBounty } from "../../../packages/core/src/generated/marketingPolicy.ts";
import { fileAt } from "../../../packages/core/src/runtime/files.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import {
  DEFAULT_DAILY_CAP_CENTS,
  DEFAULT_DAILY_OUTREACH_CAP,
  DEFAULT_DAILY_TURN_CAP,
  DEFAULT_MAX_TASK_CENTS,
  DEFAULT_MONTHLY_BUDGET_CENTS,
  DEFAULT_SLOP_CASH_CHAIN,
  DEFAULT_SLOP_CASH_REPO,
} from "./constants.ts";
import {
  PolicyViolationError,
  assertProofAndAdultForPayoutPolicy,
  assertSpendAuth,
  deriveDeviceTelemetryStatus,
  deriveWarmupStage,
  evaluateAgentTurnPolicy,
  evaluateDeviceActionPolicy,
  evaluateOutreachPolicy,
  evaluateProofPolicy,
  isAdultReading,
  isDeviceLeaseHeldByOther,
  minAgeReading,
} from "./policy.ts";
import type {
  AgentAuthMode,
  AgentStatus,
  AntiFraudClaim,
  AntiFraudClaimStatus,
  AppId,
  AttributionEvent,
  BanditArm,
  BanditArmStatus,
  BdDeal,
  BdDealStage,
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
  PhoneLineType,
  ProofKind,
  ProofSubmission,
  ProofVerdict,
  QrBatch,
  QrBatchAssigneeType,
  RiskDial,
  RiskZone,
  SlopCashHook,
  SlopCashHookState,
  SlopCashVaultChain,
  SubscriptionProvider,
  TaskKind,
  TaskStatus,
  VendorChannel,
  VideoAsset,
  VideoAssetStage,
  VipProspect,
  VipProspectStatus,
} from "./types.ts";

export { PolicyViolationError };

export interface PaginationFilter {
  limit?: number;
  offset?: number;
}

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1_000;

function normalizePagination(filter?: PaginationFilter): { limit: number; offset: number } {
  const rawLimit = filter?.limit;
  const rawOffset = filter?.offset;
  const limit =
    rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIST_LIMIT, Math.round(rawLimit))
      : DEFAULT_LIST_LIMIT;
  const offset =
    rawOffset !== undefined && Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.round(rawOffset)
      : 0;
  return { limit, offset };
}

function paginateArray<T>(items: T[], filter?: PaginationFilter): T[] {
  const { limit, offset } = normalizePagination(filter);
  return items.slice(offset, offset + limit);
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
  perTaskCapCents?: number;
  billingArmed?: boolean;
  slopCashEnabled?: boolean;
  status?: Campaign["status"];
  notes?: string | null;
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
  preserveCounters?: boolean;
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
  challengeDetected?: boolean;
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
  phoneHash?: string | null;
  phoneE164?: string | null;
  displayLabel: string;
  channel: OutreachChannel;
  role: HumanRole;
  city?: string;
  lowestAge?: number | null;
  stopped?: boolean;
  unstop?: boolean;
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
  slopCashEnvEnabled?: boolean;
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
  workerAge: number | null;
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
  phoneHash?: string | null;
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
  taskKind?: TaskKind;
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

export interface UpsertBanditArmInput {
  id?: string;
  campaignId: string;
  armKey: string;
  label: string;
  track: string;
  alpha?: number;
  beta?: number;
  weight?: number;
  spendCents?: number;
  signups?: number;
  stopEvents?: number;
  totalContacts?: number;
  status?: BanditArmStatus;
}

export interface UpdateBanditArmInput {
  label?: string;
  alpha?: number;
  beta?: number;
  weight?: number;
  spendCents?: number;
  signups?: number;
  stopEvents?: number;
  totalContacts?: number;
  status?: BanditArmStatus;
}

export interface CreateBdDealInput {
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

export interface UpdateBdDealInput {
  venueName?: string;
  vertical?: AppId;
  contactEmail?: string | null;
  businessPhone?: string | null;
  stage?: BdDealStage;
  offeredCents?: number;
  phoneCallbackVerified?: boolean;
  contractHash?: string | null;
  qrBatchId?: string | null;
  notes?: string | null;
}

export interface CreateQrBatchInput {
  id?: string;
  campaignId: string;
  city?: string;
  batchCode: string;
  destinationUrl: string;
  dubLinkId?: string | null;
  printQty?: number;
  assignedToType?: QrBatchAssigneeType | null;
  assignedToId?: string | null;
  scans?: number;
  verifiedSignups?: number;
}

export interface UpdateQrBatchInput {
  destinationUrl?: string;
  dubLinkId?: string | null;
  printQty?: number;
  assignedToType?: QrBatchAssigneeType | null;
  assignedToId?: string | null;
  scans?: number;
  verifiedSignups?: number;
}

export interface CreateVipProspectInput {
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

export interface UpdateVipProspectInput {
  archetype?: string;
  organization?: string | null;
  sourceUrl?: string | null;
  prestigeScore?: number;
  contactEmail?: string | null;
  inviteDraft?: string | null;
  status?: VipProspectStatus;
}

export interface CreateVideoAssetInput {
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

export interface UpdateVideoAssetInput {
  agentId?: string | null;
  title?: string;
  hook?: string;
  script?: string;
  stage?: VideoAssetStage;
  videoUrl?: string | null;
  platform?: string | null;
  views?: number;
  retention3sPct?: number;
  signups?: number;
  ftcDisclosed?: boolean;
}

export interface CreateAntiFraudClaimInput {
  id?: string;
  campaignId: string;
  personKey: string;
  workerId?: string | null;
  taskId?: string | null;
  phoneLineType?: PhoneLineType;
  mediaHash?: string | null;
  clusterId?: string | null;
  vestingTier?: number;
  amountCents: number;
  status?: AntiFraudClaimStatus;
  reason?: string | null;
}

export interface UpdateAntiFraudClaimInput {
  clusterId?: string | null;
  vestingTier?: number;
  amountCents?: number;
  status?: AntiFraudClaimStatus;
  reason?: string | null;
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
  listCampaigns(
    filter?: { city?: string; appId?: AppId; status?: Campaign["status"] } & PaginationFilter,
  ): Promise<Campaign[]>;
  updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign>;
  setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign>;

  upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent>;
  getAgent(id: string): Promise<MarketingAgent | null>;
  getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null>;
  listAgents(filter?: PaginationFilter): Promise<MarketingAgent[]>;
  updateAgent(
    id: string,
    patch: Partial<Omit<MarketingAgent, "id" | "personaId">>,
  ): Promise<MarketingAgent>;
  consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult>;
  recordAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult>;

  upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode>;
  getDevice(id: string): Promise<DeviceNode | null>;
  listDevices(filter?: PaginationFilter): Promise<DeviceNode[]>;
  updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode>;
  acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts?: { lockdown?: boolean; targetStopped?: boolean },
  ): Promise<DeviceNode>;
  releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode>;
  sweepExpiredDeviceLeases(): Promise<number>;
  recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt>;

  upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount>;
  getChannelAccount(id: string): Promise<ChannelAccount | null>;
  listChannelAccounts(
    filter?: { agentId?: string; channel?: OutreachChannel } & PaginationFilter,
  ): Promise<ChannelAccount[]>;

  upsertHuman(input: UpsertHumanInput): Promise<HumanPartner>;
  getHuman(id: string): Promise<HumanPartner | null>;
  getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null>;
  getHumanPhoneHash?(id: string): Promise<string | null>;
  isPhoneHashSuppressed?(phoneHash: string): Promise<boolean>;
  listHumans(
    filter?: { city?: string; role?: HumanRole; stopped?: boolean } & PaginationFilter,
  ): Promise<HumanPartner[]>;
  markHumanStopped(id: string, reason: string): Promise<HumanPartner>;
  markHumanBanned(id: string, reason: string): Promise<HumanPartner>;
  recordHumanAge(id: string, age: number): Promise<HumanPartner>;

  createTask(input: CreateTaskInput): Promise<MarketingTask>;
  getTask(id: string): Promise<MarketingTask | null>;
  listTasks(
    filter?: {
      campaignId?: string;
      status?: TaskStatus;
      taskKind?: TaskKind;
      city?: string;
    } & PaginationFilter,
  ): Promise<MarketingTask[]>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask>;
  markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }>;

  createProof(input: CreateProofInput): Promise<ProofSubmission>;
  getProof(id: string): Promise<ProofSubmission | null>;
  listProofs(
    filter?: { taskId?: string; verdict?: ProofVerdict } & PaginationFilter,
  ): Promise<ProofSubmission[]>;
  evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult>;

  createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage>;
  listOutreachMessages(
    filter?: {
      campaignId?: string;
      humanId?: string;
      agentId?: string;
      status?: OutreachStatus;
    } & PaginationFilter,
  ): Promise<OutreachMessage[]>;
  updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
    dailyOutreachCap?: number,
  ): Promise<OutreachMessage>;

  recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent>;
  listAttributionEvents(
    filter?: {
      campaignId?: string;
      taskId?: string;
      qrBatchCode?: string;
      appId?: BrandAppId;
    } & PaginationFilter,
  ): Promise<AttributionEvent[]>;

  authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult>;
  listBudgetEntries(
    filter?: {
      campaignId?: string;
      taskId?: string;
      entryType?: BudgetEntryType;
    } & PaginationFilter,
  ): Promise<BudgetEntry[]>;

  upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook>;
  getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null>;
  listSlopCashHooks(filter?: PaginationFilter): Promise<SlopCashHook[]>;

  // Pass-2 tables CRUD
  upsertBanditArm(input: UpsertBanditArmInput): Promise<BanditArm>;
  getBanditArm(id: string): Promise<BanditArm | null>;
  listBanditArms(
    filter?: string | ({ campaignId?: string; status?: BanditArmStatus } & PaginationFilter),
  ): Promise<BanditArm[]>;
  updateBanditArm(id: string, patch: UpdateBanditArmInput): Promise<BanditArm>;

  createBdDeal(input: CreateBdDealInput): Promise<BdDeal>;
  getBdDeal(id: string): Promise<BdDeal | null>;
  listBdDeals(
    filter?: { campaignId?: string; city?: string; stage?: BdDealStage } & PaginationFilter,
  ): Promise<BdDeal[]>;
  updateBdDeal(id: string, patch: UpdateBdDealInput): Promise<BdDeal>;

  createQrBatch(input: CreateQrBatchInput): Promise<QrBatch>;
  getQrBatch(id: string): Promise<QrBatch | null>;
  getQrBatchByCode(batchCode: string): Promise<QrBatch | null>;
  listQrBatches(
    filter?: {
      campaignId?: string;
      city?: string;
      assignedToType?: QrBatchAssigneeType;
    } & PaginationFilter,
  ): Promise<QrBatch[]>;
  updateQrBatch(id: string, patch: UpdateQrBatchInput): Promise<QrBatch>;

  createVipProspect(input: CreateVipProspectInput): Promise<VipProspect>;
  getVipProspect(id: string): Promise<VipProspect | null>;
  listVipProspects(
    filter?: {
      campaignId?: string;
      city?: string;
      archetype?: string;
      status?: VipProspectStatus;
    } & PaginationFilter,
  ): Promise<VipProspect[]>;
  updateVipProspect(id: string, patch: UpdateVipProspectInput): Promise<VipProspect>;

  createVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset>;
  getVideoAsset(id: string): Promise<VideoAsset | null>;
  listVideoAssets(
    filter?: { campaignId?: string; agentId?: string; stage?: VideoAssetStage } & PaginationFilter,
  ): Promise<VideoAsset[]>;
  updateVideoAsset(id: string, patch: UpdateVideoAssetInput): Promise<VideoAsset>;

  createAntiFraudClaim(input: CreateAntiFraudClaimInput): Promise<AntiFraudClaim>;
  getAntiFraudClaim(id: string): Promise<AntiFraudClaim | null>;
  listAntiFraudClaims(
    filter?: {
      campaignId?: string;
      personKey?: string;
      workerId?: string;
      status?: AntiFraudClaimStatus;
    } & PaginationFilter,
  ): Promise<AntiFraudClaim[]>;
  updateAntiFraudClaim(id: string, patch: UpdateAntiFraudClaimInput): Promise<AntiFraudClaim>;
  getAnnualWorkerPaidCents(workerId: string, year: number): Promise<number>;
  getLifetimePersonBonusCents(personKey: string): Promise<number>;
  hasMediaHash(mediaHash: string, excludeTaskId?: string): Promise<boolean>;

  resetDailyCounters(): Promise<void>;
  getOverview(campaignId?: string): Promise<MarketingOverview>;
}

const HIRED_OR_LATER_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "hired",
  "shift_active",
  "proof_submitted",
  "proof_verified",
  "payout_queued",
  "paid",
]);

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

function validPersistableAge(age: number | null | undefined): number | null {
  if (typeof age !== "number" || !Number.isInteger(age)) return null;
  if (age < 0 || age > 120) return null;
  return age;
}

function sortProofsVerifiedFirst(a: ProofSubmission, b: ProofSubmission): number {
  const aVer = a.verdict === "verified" ? 1 : 0;
  const bVer = b.verdict === "verified" ? 1 : 0;
  if (bVer !== aVer) return bVer - aVer;
  const cmp = b.createdAt.localeCompare(a.createdAt);
  if (cmp !== 0) return cmp;
  return b.id.localeCompare(a.id);
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
      verifiedAdults: humans.filter((h) => isAdultReading(h.lowestAge)).length,
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
      sent: outreach.filter(
        (o) => o.status === "sent" || o.status === "delivered" || o.status === "replied",
      ).length,
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

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

export function normalizeMarketingPhoneE164(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  if (/[^0-9+().\-\s]/.test(trimmed)) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) {
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1") && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits.slice(1))) {
    return `+${digits}`;
  }
  return null;
}

export function computeMarketingPhoneHash(
  phoneOrE164: string,
  hashKey: string | undefined = process.env.PLATFORM_HASH_KEY,
): string | null {
  const key = hashKey?.trim();
  if (!key) return null;
  const normalized = normalizeMarketingPhoneE164(phoneOrE164);
  if (!normalized) return null;
  return createHmac("sha256", key).update(normalized).digest("hex");
}

function resolveHumanPhoneHash(
  input: Pick<UpsertHumanInput, "phoneHash" | "phoneE164" | "handleOrEmailHmac">,
  hashKey?: string,
): string | null {
  const explicit = typeof input.phoneHash === "string" ? input.phoneHash.trim() : "";
  if (explicit.length > 0) return explicit;
  const effectiveKey = hashKey ?? process.env.PLATFORM_HASH_KEY;
  if (input.phoneE164) {
    const hashed = computeMarketingPhoneHash(input.phoneE164, effectiveKey);
    if (hashed) return hashed;
  }
  const fromContactKey = computeMarketingPhoneHash(input.handleOrEmailHmac, effectiveKey);
  if (fromContactKey) return fromContactKey;
  return null;
}

export async function isGloballySuppressedPhoneHash(
  sql: SQL,
  phoneHash: string | null | undefined,
): Promise<boolean> {
  const hash = typeof phoneHash === "string" ? phoneHash.trim() : "";
  if (!hash) return false;

  const fnCheck = firstRow(await sql`
    select exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform'
        and p.proname = 'is_suppressed_phone_hash'
        and p.pronargs = 1
        and has_function_privilege(p.oid, 'EXECUTE')
    ) as has_fn
  `);
  if (asBool(fnCheck?.has_fn)) {
    const res = firstRow(await sql`
      select platform.is_suppressed_phone_hash(${hash}) as suppressed
    `);
    return asBool(res?.suppressed);
  }

  const fallback = firstRow(await sql`
    select exists (
      select 1
      from marketing.humans
      where phone_hash = ${hash}
        and (stopped or banned)
    ) as suppressed
  `);
  return asBool(fallback?.suppressed);
}

// ============================================================================
// MemoryMarketingStore
// ============================================================================

export class MemoryMarketingStore implements MarketingStore {
  readonly clock: Clock;
  private readonly idGen: () => string;
  private readonly hashKey?: string;
  private readonly externalSuppressedPhoneHashes = new Set<string>();
  private readonly isExternalPhoneHashSuppressed?: (phoneHash: string) => Promise<boolean> | boolean;

  private readonly campaigns = new Map<string, Campaign>();
  private readonly agents = new Map<string, MarketingAgent>();
  private readonly devices = new Map<string, DeviceNode>();
  private readonly channels = new Map<string, ChannelAccount>();
  private readonly humans = new Map<string, HumanPartner>();
  private readonly humanPhoneHashes = new Map<string, string>();
  private readonly tasks = new Map<string, MarketingTask>();
  private readonly proofs = new Map<string, ProofSubmission>();
  private readonly outreach = new Map<string, OutreachMessage>();
  private readonly attribution = new Map<string, AttributionEvent>();
  private readonly budgetEntries = new Map<string, BudgetEntry>();
  private readonly budgetByKey = new Map<string, string>();
  private readonly slopCashHooks = new Map<string, SlopCashHook>();
  private readonly banditArms = new Map<string, BanditArm>();
  private readonly bdDeals = new Map<string, BdDeal>();
  private readonly qrBatches = new Map<string, QrBatch>();
  private readonly vipProspects = new Map<string, VipProspect>();
  private readonly videoAssets = new Map<string, VideoAsset>();
  private readonly antifraudClaims = new Map<string, AntiFraudClaim>();

  constructor(
    opts: {
      clock?: Clock;
      idGen?: () => string;
      hashKey?: string;
      isExternalPhoneHashSuppressed?: (phoneHash: string) => Promise<boolean> | boolean;
    } = {},
  ) {
    this.clock = opts.clock ?? new RealClock();
    this.idGen = opts.idGen ?? defaultId;
    this.hashKey = opts.hashKey;
    this.isExternalPhoneHashSuppressed = opts.isExternalPhoneHashSuppressed;
  }

  suppressExternalPhoneHash(phoneHash: string): void {
    const trimmed = phoneHash.trim();
    if (trimmed) this.externalSuppressedPhoneHashes.add(trimmed);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    for (const c of this.campaigns.values()) {
      if (c.slug === input.slug) {
        return Promise.reject(new Error(`Campaign slug already exists: ${input.slug}`));
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
    return Promise.resolve({ ...campaign });
  }

  getCampaign(id: string): Promise<Campaign | null> {
    const c = this.campaigns.get(id);
    return Promise.resolve(c ? { ...c } : null);
  }

  getCampaignBySlug(slug: string): Promise<Campaign | null> {
    for (const c of this.campaigns.values()) {
      if (c.slug === slug) return Promise.resolve({ ...c });
    }
    return Promise.resolve(null);
  }

  listCampaigns(
    filter?: { city?: string; appId?: AppId; status?: Campaign["status"] } & PaginationFilter,
  ): Promise<Campaign[]> {
    const filtered = [...this.campaigns.values()]
      .filter((c) => !filter?.city || c.city === filter.city)
      .filter((c) => !filter?.appId || c.appId === filter.appId)
      .filter((c) => !filter?.status || c.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c }));
    return Promise.resolve(paginateArray(filtered, filter));
  }

  updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign> {
    const existing = this.campaigns.get(id);
    if (!existing) return Promise.reject(new Error(`Campaign not found: ${id}`));
    const nextMonthly =
      patch.monthlyBudgetCents !== undefined ? patch.monthlyBudgetCents : existing.monthlyBudgetCents;
    const nextMaxTask =
      patch.maxTaskCents !== undefined
        ? patch.maxTaskCents
        : patch.perTaskCapCents !== undefined
          ? patch.perTaskCapCents
          : existing.maxTaskCents;
    if (existing.reservedCents + existing.spentCents > nextMonthly) {
      return Promise.reject(
        new PolicyViolationError(
          "BUDGET_CAP_EXCEEDED",
          "inv_budget_never_exceeded",
          "Cannot lower monthly budget below already reserved + spent amount.",
        ),
      );
    }
    // C-07: strict mutable allowlist — never overwrite spentCents, reservedCents, dailySpentCents, id, or slug.
    const next: Campaign = {
      ...existing,
      name: patch.name !== undefined ? patch.name : existing.name,
      city: patch.city !== undefined ? patch.city : existing.city,
      riskZone: patch.riskZone !== undefined ? patch.riskZone : existing.riskZone,
      riskDial: patch.riskDial !== undefined ? patch.riskDial : existing.riskDial,
      monthlyBudgetCents: nextMonthly,
      dailyCapCents: patch.dailyCapCents !== undefined ? patch.dailyCapCents : existing.dailyCapCents,
      maxTaskCents: nextMaxTask,
      billingArmed: patch.billingArmed !== undefined ? patch.billingArmed : existing.billingArmed,
      slopCashEnabled:
        patch.slopCashEnabled !== undefined ? patch.slopCashEnabled : existing.slopCashEnabled,
      status: patch.status !== undefined ? patch.status : existing.status,
      updatedAt: isoNow(this.clock),
    };
    this.campaigns.set(id, next);
    return Promise.resolve({ ...next });
  }

  setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign> {
    return this.updateCampaign(id, {
      riskDial,
      ...(billingArmed !== undefined ? { billingArmed } : {}),
    });
  }

  upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent> {
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
        input.failoverProvider !== undefined
          ? input.failoverProvider
          : (existing?.failoverProvider ?? null),
      authMode: input.authMode ?? existing?.authMode ?? "cli",
      sessionRef: input.sessionRef ?? existing?.sessionRef ?? "",
      sessionHealthy: input.sessionHealthy ?? existing?.sessionHealthy ?? true,
      dailyTurnCap: input.dailyTurnCap ?? existing?.dailyTurnCap ?? DEFAULT_DAILY_TURN_CAP,
      turnsUsedToday: input.turnsUsedToday ?? existing?.turnsUsedToday ?? 0,
      cooldownUntil:
        input.cooldownUntil !== undefined
          ? input.cooldownUntil
          : (existing?.cooldownUntil ?? null),
      status: input.status ?? existing?.status ?? "idle",
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    return Promise.resolve({ ...agent });
  }

  getAgent(id: string): Promise<MarketingAgent | null> {
    const a = this.agents.get(id);
    return Promise.resolve(a ? { ...a } : null);
  }

  getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null> {
    for (const a of this.agents.values()) {
      if (a.personaId === personaId) return Promise.resolve({ ...a });
    }
    return Promise.resolve(null);
  }

  listAgents(filter?: PaginationFilter): Promise<MarketingAgent[]> {
    const list = [...this.agents.values()]
      .sort((a, b) => a.personaId.localeCompare(b.personaId))
      .map((a) => ({ ...a }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateAgent(
    id: string,
    patch: Partial<Omit<MarketingAgent, "id" | "personaId">>,
  ): Promise<MarketingAgent> {
    const existing = this.agents.get(id);
    if (!existing) return Promise.reject(new Error(`Agent not found: ${id}`));
    const next: MarketingAgent = {
      ...existing,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.appId !== undefined ? { appId: patch.appId } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.failoverProvider !== undefined ? { failoverProvider: patch.failoverProvider } : {}),
      ...(patch.authMode !== undefined ? { authMode: patch.authMode } : {}),
      ...(patch.sessionRef !== undefined ? { sessionRef: patch.sessionRef } : {}),
      ...(patch.sessionHealthy !== undefined ? { sessionHealthy: patch.sessionHealthy } : {}),
      ...(patch.dailyTurnCap !== undefined ? { dailyTurnCap: patch.dailyTurnCap } : {}),
      ...(patch.turnsUsedToday !== undefined ? { turnsUsedToday: patch.turnsUsedToday } : {}),
      ...(patch.cooldownUntil !== undefined ? { cooldownUntil: patch.cooldownUntil } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: isoNow(this.clock),
    };
    this.agents.set(id, next);
    return Promise.resolve({ ...next });
  }

  async consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
    const campaign = input.campaignId ? this.campaigns.get(input.campaignId) ?? null : null;
    const human = input.targetHumanId ? this.humans.get(input.targetHumanId) ?? null : null;
    const phoneHash = human ? this.humanPhoneHashes.get(human.id) ?? null : null;
    const phoneSuppressed = phoneHash ? await this.isPhoneHashSuppressed(phoneHash) : false;

    const targetStopped = Boolean(input.targetStopped || human?.stopped || human?.banned || phoneSuppressed);
    const lockdown = Boolean(input.lockdown || campaign?.riskDial === "lockdown");
    const decision = evaluateAgentTurnPolicy({
      agent,
      nowMs: this.clock.now(),
      targetStopped,
      lockdown,
    });

    if (!decision.allowed) {
      return { allowed: false, agent: { ...agent }, reason: decision.reason };
    }

    const updated: MarketingAgent = {
      ...agent,
      turnsUsedToday: agent.turnsUsedToday + 1,
      updatedAt: isoNow(this.clock),
    };
    this.agents.set(updated.id, updated);
    return { allowed: true, agent: { ...updated } };
  }

  recordAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    return this.consumeAgentTurn(input);
  }

  upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode> {
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
    const preserve = Boolean(input.preserveCounters && existing);
    const warmupDay = preserve
      ? existing!.warmupDay
      : (input.warmupDay ?? existing?.warmupDay ?? 1);
    const device: DeviceNode = {
      id: existing?.id ?? input.id ?? this.idGen(),
      label: input.label,
      platform: input.platform,
      hostMachine: input.hostMachine ?? existing?.hostMachine ?? "local-macbook",
      serialOrUdid: input.serialOrUdid,
      assignedPersona: preserve
        ? existing!.assignedPersona
        : input.assignedPersona !== undefined
          ? input.assignedPersona
          : (existing?.assignedPersona ?? null),
      simCarrier: preserve
        ? existing!.simCarrier
        : input.simCarrier !== undefined
          ? input.simCarrier
          : (existing?.simCarrier ?? null),
      batteryPct: preserve
        ? existing!.batteryPct
        : (input.batteryPct ?? existing?.batteryPct ?? 60),
      tempC: preserve ? existing!.tempC : (input.tempC ?? existing?.tempC ?? 30),
      warmupDay,
      warmupStage: preserve
        ? existing!.warmupStage
        : (input.warmupStage ?? deriveWarmupStage(warmupDay)),
      dailyActionsUsed: preserve
        ? existing!.dailyActionsUsed
        : (input.dailyActionsUsed ?? existing?.dailyActionsUsed ?? 0),
      dailyActionCap: preserve
        ? existing!.dailyActionCap
        : (input.dailyActionCap ?? warmupDailyCap(warmupDay)),
      leaseHolder: preserve
        ? existing!.leaseHolder
        : input.leaseHolder !== undefined
          ? input.leaseHolder
          : (existing?.leaseHolder ?? null),
      leaseExpiresAt: preserve
        ? existing!.leaseExpiresAt
        : input.leaseExpiresAt !== undefined
          ? input.leaseExpiresAt
          : (existing?.leaseExpiresAt ?? null),
      status: preserve
        ? existing!.status === "offline" && input.status === "online"
          ? "online"
          : existing!.status
        : (input.status ?? existing?.status ?? "online"),
      lastSeenAt: now,
    };
    this.devices.set(device.id, device);
    return Promise.resolve({ ...device });
  }

  getDevice(id: string): Promise<DeviceNode | null> {
    const d = this.devices.get(id);
    return Promise.resolve(d ? { ...d } : null);
  }

  listDevices(filter?: PaginationFilter): Promise<DeviceNode[]> {
    const list = [...this.devices.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((d) => ({ ...d }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) return Promise.reject(new Error(`Device not found: ${id}`));
    const warmupDay = update.warmupDay ?? existing.warmupDay;
    const nowMs = this.clock.now();
    const hasActiveLease =
      existing.leaseHolder !== null &&
      (existing.leaseExpiresAt === null || Date.parse(existing.leaseExpiresAt) > nowMs);
    const requestedStatus = update.status ?? existing.status;
    const nextStatus =
      update.status === "offline" || update.status === "needs_takeover"
        ? update.status
        : deriveDeviceTelemetryStatus(
            requestedStatus !== "offline",
            update.batteryPct,
            update.tempC,
            requestedStatus,
            hasActiveLease,
          );
    const next: DeviceNode = {
      ...existing,
      batteryPct: update.batteryPct,
      tempC: update.tempC,
      warmupDay,
      warmupStage: deriveWarmupStage(warmupDay),
      dailyActionCap: warmupDailyCap(warmupDay),
      status: nextStatus,
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(id, next);
    return Promise.resolve({ ...next });
  }

  acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts: { lockdown?: boolean; targetStopped?: boolean } = {},
  ): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) return Promise.reject(new Error(`Device not found: ${id}`));
    const nowMs = this.clock.now();
    const decision = evaluateDeviceActionPolicy({
      device: existing,
      leaseHolder,
      nowMs,
      lockdown: Boolean(opts.lockdown),
      targetStopped: Boolean(opts.targetStopped),
    });
    if (!decision.allowed) {
      return Promise.reject(
        new PolicyViolationError(
          "DEVICE_LEASE_DENIED",
          "inv_device_safety_envelope",
          `Cannot lease device ${existing.label}: ${decision.reason ?? "safety envelope check failed"}.`,
        ),
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
    return Promise.resolve({ ...next });
  }

  releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode> {
    const existing = this.devices.get(id);
    if (!existing) return Promise.reject(new Error(`Device not found: ${id}`));
    if (leaseHolder && isDeviceLeaseHeldByOther(existing, leaseHolder, this.clock.now())) {
      return Promise.reject(
        new PolicyViolationError(
          "LEASE_OWNER_MISMATCH",
          "inv_device_safety_envelope",
          `Device ${existing.label} is leased by ${existing.leaseHolder}, not ${leaseHolder}.`,
        ),
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
    return Promise.resolve({ ...next });
  }

  sweepExpiredDeviceLeases(): Promise<number> {
    const nowMs = this.clock.now();
    let count = 0;
    for (const [id, d] of this.devices) {
      if (d.leaseHolder && d.leaseExpiresAt && Date.parse(d.leaseExpiresAt) <= nowMs) {
        this.devices.set(id, {
          ...d,
          leaseHolder: null,
          leaseExpiresAt: null,
          status: d.status === "leased" ? "online" : d.status,
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  async recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt> {
    const device = this.devices.get(input.deviceId);
    if (!device) throw new Error(`Device not found: ${input.deviceId}`);
    const human = input.targetHumanId ? this.humans.get(input.targetHumanId) ?? null : null;
    const phoneHash = human ? this.humanPhoneHashes.get(human.id) ?? null : null;
    const phoneSuppressed = phoneHash ? await this.isPhoneHashSuppressed(phoneHash) : false;
    const nowMs = this.clock.now();
    const targetStopped = Boolean(input.targetStopped || human?.stopped || human?.banned || phoneSuppressed);

    const decision = evaluateDeviceActionPolicy({
      device,
      leaseHolder: input.leaseHolder,
      nowMs,
      lockdown: Boolean(input.lockdown),
      targetStopped,
      challengeDetected: input.challengeDetected,
    });

    if (!decision.allowed) {
      let current = device;
      if (input.challengeDetected && device.status !== "needs_takeover") {
        current = { ...device, status: "needs_takeover", lastSeenAt: isoNow(this.clock) };
        this.devices.set(device.id, current);
      }
      return Promise.resolve({
        allowed: false,
        device: { ...current },
        reason: decision.reason,
      });
    }

    const updated: DeviceNode = {
      ...device,
      dailyActionsUsed: device.dailyActionsUsed + 1,
      dailyActionCap: warmupDailyCap(device.warmupDay),
      lastSeenAt: isoNow(this.clock),
    };
    this.devices.set(updated.id, updated);
    return Promise.resolve({ allowed: true, device: { ...updated } });
  }

  upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount> {
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
      dailyOutreachCap:
        input.dailyOutreachCap ?? existing?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP,
      sentToday: input.sentToday ?? existing?.sentToday ?? 0,
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.channels.set(account.id, account);
    return Promise.resolve({ ...account });
  }

  getChannelAccount(id: string): Promise<ChannelAccount | null> {
    const ch = this.channels.get(id);
    return Promise.resolve(ch ? { ...ch } : null);
  }

  listChannelAccounts(
    filter?: { agentId?: string; channel?: OutreachChannel } & PaginationFilter,
  ): Promise<ChannelAccount[]> {
    const list = [...this.channels.values()]
      .filter((c) => !filter?.agentId || c.agentId === filter.agentId)
      .filter((c) => !filter?.channel || c.channel === filter.channel)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c }));
    return Promise.resolve(paginateArray(list, filter));
  }

  upsertHuman(input: UpsertHumanInput): Promise<HumanPartner> {
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
    const lowestAge = minAgeReading(existing?.lowestAge, validPersistableAge(input.lowestAge));
    const stopped = input.unstop === true ? false : Boolean(existing?.stopped || input.stopped);
    const banned = Boolean(existing?.banned || input.banned);
    const human: HumanPartner = {
      id: existing?.id ?? input.id ?? this.idGen(),
      handleOrEmailHmac: input.handleOrEmailHmac,
      displayLabel: input.displayLabel,
      channel: input.channel,
      role: input.role,
      city: input.city ?? existing?.city ?? "nyc",
      lowestAge,
      stopped,
      banned,
      stopReason:
        input.unstop === true
          ? null
          : input.stopReason !== undefined
            ? input.stopReason
            : (existing?.stopReason ?? null),
      dailySendsToday: input.dailySendsToday ?? existing?.dailySendsToday ?? 0,
      lastContactedAt:
        input.lastContactedAt !== undefined
          ? input.lastContactedAt
          : (existing?.lastContactedAt ?? null),
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.humans.set(human.id, human);
    const resolvedPhoneHash = resolveHumanPhoneHash(input, this.hashKey);
    if (resolvedPhoneHash) {
      this.humanPhoneHashes.set(human.id, resolvedPhoneHash);
    }
    return Promise.resolve({ ...human });
  }

  getHuman(id: string): Promise<HumanPartner | null> {
    const h = this.humans.get(id);
    return Promise.resolve(h ? { ...h } : null);
  }

  getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null> {
    for (const h of this.humans.values()) {
      if (h.handleOrEmailHmac === handleOrEmailHmac) return Promise.resolve({ ...h });
    }
    return Promise.resolve(null);
  }

  getHumanPhoneHash(id: string): Promise<string | null> {
    return Promise.resolve(this.humanPhoneHashes.get(id) ?? null);
  }

  async isPhoneHashSuppressed(phoneHash: string): Promise<boolean> {
    const hash = phoneHash.trim();
    if (!hash) return false;
    if (this.externalSuppressedPhoneHashes.has(hash)) return true;
    if (this.isExternalPhoneHashSuppressed && (await this.isExternalPhoneHashSuppressed(hash))) {
      return true;
    }
    for (const [id, storedHash] of this.humanPhoneHashes.entries()) {
      if (storedHash !== hash) continue;
      const h = this.humans.get(id);
      if (h && (h.stopped || h.banned)) return true;
    }
    return false;
  }

  listHumans(
    filter?: { city?: string; role?: HumanRole; stopped?: boolean } & PaginationFilter,
  ): Promise<HumanPartner[]> {
    const list = [...this.humans.values()]
      .filter((h) => !filter?.city || h.city === filter.city)
      .filter((h) => !filter?.role || h.role === filter.role)
      .filter((h) => filter?.stopped === undefined || h.stopped === filter.stopped)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((h) => ({ ...h }));
    return Promise.resolve(paginateArray(list, filter));
  }

  markHumanStopped(id: string, reason: string): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) return Promise.reject(new Error(`Human not found: ${id}`));
    const next: HumanPartner = { ...existing, stopped: true, stopReason: reason };
    this.humans.set(id, next);
    return Promise.resolve({ ...next });
  }

  markHumanBanned(id: string, reason: string): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) return Promise.reject(new Error(`Human not found: ${id}`));
    const next: HumanPartner = { ...existing, banned: true, stopped: true, stopReason: reason };
    this.humans.set(id, next);
    return Promise.resolve({ ...next });
  }

  recordHumanAge(id: string, age: number): Promise<HumanPartner> {
    const existing = this.humans.get(id);
    if (!existing) return Promise.reject(new Error(`Human not found: ${id}`));
    const validAge = validPersistableAge(age);
    const next: HumanPartner = {
      ...existing,
      lowestAge: minAgeReading(existing.lowestAge, validAge),
    };
    this.humans.set(id, next);
    return Promise.resolve({ ...next });
  }

  createTask(input: CreateTaskInput): Promise<MarketingTask> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    const payoutRail: PayoutRail = input.payoutRail ?? (input.tier >= 3 ? "fiat_stripe" : "none");
    const status: TaskStatus = input.status ?? "drafted";
    const amountCents = input.amountCents ?? 0;

    if (payoutRail === "slop_cash") {
      if (!isOssDevBounty(input.taskKind === "oss_dev_bounty")) {
        return Promise.reject(
          new PolicyViolationError(
            "SLOP_CASH_OSS_ONLY",
            "inv_slop_cash_disabled",
            "slop_cash payout rail is restricted strictly to oss_dev_bounty tasks.",
          ),
        );
      }
      if (!campaign.slopCashEnabled || !input.slopCashEnvEnabled) {
        return Promise.reject(
          new PolicyViolationError(
            "SLOP_CASH_DISABLED",
            "inv_slop_cash_disabled",
            "Cannot create slop_cash task while slop.cash is disabled.",
          ),
        );
      }
    }

    const human = input.assigneeHumanId ? this.humans.get(input.assigneeHumanId) ?? null : null;
    const effectiveAge = minAgeReading(
      human?.lowestAge,
      validPersistableAge(input.assigneeAgeYears),
    );
    if (input.tier === 4 && HIRED_OR_LATER_STATUSES.has(status)) {
      if (!isAdultReading(effectiveAge)) {
        return Promise.reject(
          new PolicyViolationError(
            "UNDERAGE_OR_UNKNOWN_WORKER",
            "inv_adult_only_paid",
            "Tier 4 task requires a verified 18+ adult before hiring.",
          ),
        );
      }
    }
    if (status === "paid") {
      return Promise.reject(
        new PolicyViolationError(
          "DIRECT_PAID_FORBIDDEN",
          "inv_proof_required_before_payout",
          "Tasks cannot be created directly in paid state; use evaluateProof and markTaskPaid.",
        ),
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
    return Promise.resolve({ ...task });
  }

  getTask(id: string): Promise<MarketingTask | null> {
    const t = this.tasks.get(id);
    return Promise.resolve(t ? { ...t } : null);
  }

  listTasks(
    filter?: {
      campaignId?: string;
      status?: TaskStatus;
      taskKind?: TaskKind;
      city?: string;
    } & PaginationFilter,
  ): Promise<MarketingTask[]> {
    const list = [...this.tasks.values()]
      .filter((t) => !filter?.campaignId || t.campaignId === filter.campaignId)
      .filter((t) => !filter?.status || t.status === filter.status)
      .filter((t) => !filter?.taskKind || t.taskKind === filter.taskKind)
      .filter((t) => !filter?.city || t.city === filter.city)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({ ...t }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask> {
    const existing = this.tasks.get(id);
    if (!existing) return Promise.reject(new Error(`Task not found: ${id}`));
    if (patch.status === "paid") {
      return Promise.reject(
        new PolicyViolationError(
          "DIRECT_PAID_FORBIDDEN",
          "inv_proof_required_before_payout",
          "Use markTaskPaid to transition a task to paid.",
        ),
      );
    }
    const nextRail = patch.payoutRail ?? existing.payoutRail;
    if (nextRail === "slop_cash") {
      if (!isOssDevBounty(existing.taskKind === "oss_dev_bounty")) {
        return Promise.reject(
          new PolicyViolationError(
            "SLOP_CASH_OSS_ONLY",
            "inv_slop_cash_disabled",
            "slop_cash payout rail is restricted strictly to oss_dev_bounty tasks.",
          ),
        );
      }
      const campaign = this.campaigns.get(existing.campaignId);
      if (!campaign?.slopCashEnabled || !patch.slopCashEnvEnabled) {
        return Promise.reject(
          new PolicyViolationError(
            "SLOP_CASH_DISABLED",
            "inv_slop_cash_disabled",
            "Cannot set slop_cash payout rail while slop.cash is disabled.",
          ),
        );
      }
    }
    const humanId =
      patch.assigneeHumanId !== undefined ? patch.assigneeHumanId : existing.assigneeHumanId;
    const human = humanId ? this.humans.get(humanId) ?? null : null;
    const nextAge = minAgeReading(
      existing.assigneeAgeYears,
      human?.lowestAge,
      patch.assigneeAgeYears !== undefined ? validPersistableAge(patch.assigneeAgeYears) : null,
    );
    const nextStatus = patch.status ?? existing.status;
    if (existing.tier === 4 && HIRED_OR_LATER_STATUSES.has(nextStatus)) {
      if (!isAdultReading(nextAge)) {
        return Promise.reject(
          new PolicyViolationError(
            "UNDERAGE_OR_UNKNOWN_WORKER",
            "inv_adult_only_paid",
            "Cannot hire or advance Tier 4 task without verified adult age (18..120).",
          ),
        );
      }
    }
    const next: MarketingTask = {
      ...existing,
      title: patch.title ?? existing.title,
      briefText: patch.briefText ?? existing.briefText,
      assigneeHumanId: humanId,
      assigneeAgeYears: nextAge,
      amountCents: patch.amountCents ?? existing.amountCents,
      qrBatchCode: patch.qrBatchCode !== undefined ? patch.qrBatchCode : existing.qrBatchCode,
      dubShortUrl: patch.dubShortUrl !== undefined ? patch.dubShortUrl : existing.dubShortUrl,
      payoutRail: nextRail,
      proofVerified: patch.proofVerified ?? existing.proofVerified,
      status: nextStatus,
      paidAt: patch.paidAt !== undefined ? patch.paidAt : existing.paidAt,
    };
    this.tasks.set(id, next);
    return Promise.resolve({ ...next });
  }

  async markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === "paid") {
      throw new PolicyViolationError(
        "TASK_ALREADY_PAID",
        "inv_budget_never_exceeded",
        `Task ${task.id} is already paid.`,
      );
    }
    if (task.status === "cancelled") {
      throw new PolicyViolationError(
        "TASK_CANCELLED",
        "inv_budget_never_exceeded",
        `Task ${task.id} is cancelled and cannot be paid.`,
      );
    }
    const campaign = this.campaigns.get(task.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${task.campaignId}`);
    const human = task.assigneeHumanId ? this.humans.get(task.assigneeHumanId) ?? null : null;

    const proofs = [...this.proofs.values()]
      .filter((p) => p.taskId === taskId)
      .sort(sortProofsVerifiedFirst);
    assertProofAndAdultForPayoutPolicy(task, proofs[0] ?? null, human);

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
      taskKind: task.taskKind,
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

  createProof(input: CreateProofInput): Promise<ProofSubmission> {
    const task = this.tasks.get(input.taskId);
    if (!task) return Promise.reject(new Error(`Task not found: ${input.taskId}`));
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
    const canMarkSubmitted =
      task.status !== "paid" &&
      task.status !== "cancelled" &&
      task.status !== "proof_verified" &&
      task.status !== "payout_queued" &&
      (task.tier < 4 || isAdultReading(task.assigneeAgeYears));
    if (canMarkSubmitted) {
      this.tasks.set(task.id, { ...task, status: "proof_submitted" });
    }
    return Promise.resolve({ ...proof, checkinMediaHashes: [...proof.checkinMediaHashes] });
  }

  getProof(id: string): Promise<ProofSubmission | null> {
    const p = this.proofs.get(id);
    return Promise.resolve(p ? { ...p, checkinMediaHashes: [...p.checkinMediaHashes] } : null);
  }

  listProofs(
    filter?: { taskId?: string; verdict?: ProofVerdict } & PaginationFilter,
  ): Promise<ProofSubmission[]> {
    const list = [...this.proofs.values()]
      .filter((p) => !filter?.taskId || p.taskId === filter.taskId)
      .filter((p) => !filter?.verdict || p.verdict === filter.verdict)
      .sort(sortProofsVerifiedFirst)
      .map((p) => ({ ...p, checkinMediaHashes: [...p.checkinMediaHashes] }));
    return Promise.resolve(paginateArray(list, filter));
  }

  evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult> {
    const proof = this.proofs.get(proofId);
    if (!proof) return Promise.reject(new Error(`Proof not found: ${proofId}`));
    const task = this.tasks.get(proof.taskId);
    if (!task) return Promise.reject(new Error(`Task not found: ${proof.taskId}`));
    const human = task.assigneeHumanId ? this.humans.get(task.assigneeHumanId) ?? null : null;

    const effectiveAge = minAgeReading(
      validPersistableAge(opts.workerAge),
      task.assigneeAgeYears,
      human?.lowestAge,
    );
    const workerBanned = Boolean(opts.workerBanned || human?.banned);
    const decision = evaluateProofPolicy({
      proof,
      workerAge: effectiveAge,
      workerBanned,
      shiftDone: opts.shiftDone,
    });

    const updatedProof: ProofSubmission = {
      ...proof,
      verdict: decision.approved ? "verified" : "rejected",
      verifierNotes:
        opts.verifierNotes ??
        (decision.approved
          ? "Approved by proved marketingPolicy.canApproveCreatorProof"
          : `Rejected: ${decision.reason ?? "proof_rejected"}`),
    };
    this.proofs.set(proofId, updatedProof);

    const updatedAge = minAgeReading(task.assigneeAgeYears, validPersistableAge(opts.workerAge));
    const immutableTerminal = task.status === "paid" || task.status === "cancelled";
    const hasVerifiedProof =
      decision.approved ||
      (!workerBanned &&
        isAdultReading(effectiveAge) &&
        [...this.proofs.values()].some((p) => p.taskId === task.id && p.verdict === "verified"));
    const updatedTask: MarketingTask = immutableTerminal
      ? { ...task }
      : {
          ...task,
          assigneeAgeYears: updatedAge,
          proofVerified: hasVerifiedProof,
          status: hasVerifiedProof
            ? task.status === "payout_queued"
              ? "payout_queued"
              : "proof_verified"
            : "disputed",
        };
    this.tasks.set(task.id, updatedTask);

    return Promise.resolve({
      proof: { ...updatedProof, checkinMediaHashes: [...updatedProof.checkinMediaHashes] },
      task: { ...updatedTask },
      approved: decision.approved,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });
  }

  async createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const human = this.humans.get(input.humanId);
    if (!human) throw new Error(`Human not found: ${input.humanId}`);
    const account = input.channelAccountId ? this.channels.get(input.channelAccountId) ?? null : null;

    const phoneHash = input.phoneHash?.trim() || this.humanPhoneHashes.get(human.id) || null;
    const globallySuppressed = phoneHash ? await this.isPhoneHashSuppressed(phoneHash) : false;

    const sentToday = account ? account.sentToday : human.dailySendsToday;
    const dailyOutreachCap =
      input.dailyOutreachCap ?? account?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;
    const decision = evaluateOutreachPolicy({
      human: globallySuppressed ? { ...human, stopped: true } : human,
      lockdown: campaign.riskDial === "lockdown",
      leakCheckPass: input.leakCheckPass,
      sentToday,
      dailyOutreachCap,
    });

    const status: OutreachStatus = decision.allowed
      ? (input.desiredStatus ?? "queued")
      : (decision.blockedStatus ?? "blocked_policy");

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

  listOutreachMessages(
    filter?: {
      campaignId?: string;
      humanId?: string;
      agentId?: string;
      status?: OutreachStatus;
    } & PaginationFilter,
  ): Promise<OutreachMessage[]> {
    const list = [...this.outreach.values()]
      .filter((m) => !filter?.campaignId || m.campaignId === filter.campaignId)
      .filter((m) => !filter?.humanId || m.humanId === filter.humanId)
      .filter((m) => !filter?.agentId || m.agentId === filter.agentId)
      .filter((m) => !filter?.status || m.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => ({ ...m }));
    return Promise.resolve(paginateArray(list, filter));
  }

  async updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
    dailyOutreachCap?: number,
  ): Promise<OutreachMessage> {
    const existing = this.outreach.get(id);
    if (!existing) throw new Error(`Outreach message not found: ${id}`);

    if (status === "sent" || status === "delivered") {
      const campaign = this.campaigns.get(existing.campaignId);
      const human = this.humans.get(existing.humanId);
      if (!campaign || !human) {
        throw new Error("Missing campaign or human for outreach send");
      }
      const phoneHash = this.humanPhoneHashes.get(human.id) ?? null;
      const globallySuppressed = phoneHash ? await this.isPhoneHashSuppressed(phoneHash) : false;
      const decision = evaluateOutreachPolicy({
        human: globallySuppressed ? { ...human, stopped: true } : human,
        lockdown: campaign.riskDial === "lockdown",
        leakCheckPass: existing.leakCheckPass,
        dailyOutreachCap: dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP,
      });
      if (!decision.allowed) {
        const blocked: OutreachMessage = {
          ...existing,
          status: decision.blockedStatus ?? "blocked_policy",
        };
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

  recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
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
    return Promise.resolve({ ...event, metadata: { ...event.metadata } });
  }

  listAttributionEvents(
    filter?: {
      campaignId?: string;
      taskId?: string;
      qrBatchCode?: string;
      appId?: BrandAppId;
    } & PaginationFilter,
  ): Promise<AttributionEvent[]> {
    const list = [...this.attribution.values()]
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.qrBatchCode || e.qrBatchCode === filter.qrBatchCode)
      .filter((e) => !filter?.appId || e.appId === filter.appId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((e) => ({ ...e, metadata: { ...e.metadata } }));
    return Promise.resolve(paginateArray(list, filter));
  }

  authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult> {
    const existingId = this.budgetByKey.get(input.idempotencyKey);
    if (existingId) {
      const entry = this.budgetEntries.get(existingId)!;
      const campaign = this.campaigns.get(entry.campaignId)!;
      return Promise.resolve({ entry: { ...entry }, campaign: { ...campaign }, replayed: true });
    }

    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));

    const useSlopCash = Boolean(input.useSlopCash || input.adapterId === "slop_cash");
    const taskKind =
      input.taskKind ?? (input.taskId ? this.tasks.get(input.taskId)?.taskKind : undefined);
    const fromReserve = Boolean(input.fromReserve);

    try {
      if (input.entryType === "reserve" || input.entryType === "commit") {
        assertSpendAuth({
          campaign,
          tier: input.tier,
          amountCents: input.amountCents,
          useSlopCash,
          slopCashEnvEnabled: Boolean(input.slopCashEnvEnabled),
          taskKind,
          fromReserve,
        });
      } else if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        throw new PolicyViolationError(
          "INVALID_AMOUNT",
          "inv_budget_never_exceeded",
          "Budget ledger entries require a positive integer amountCents.",
        );
      }
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }

    const now = isoNow(this.clock);
    const nextCampaign: Campaign = { ...campaign, updatedAt: now };
    if (input.entryType === "reserve") {
      nextCampaign.reservedCents += input.amountCents;
      nextCampaign.dailySpentCents += input.amountCents;
    } else if (input.entryType === "commit") {
      if (fromReserve) {
        nextCampaign.reservedCents -= input.amountCents;
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
      fromReserve,
      idempotencyKey: input.idempotencyKey,
      externalRef: input.externalRef ?? null,
      createdAt: now,
    };
    this.budgetEntries.set(entry.id, entry);
    this.budgetByKey.set(entry.idempotencyKey, entry.id);
    this.campaigns.set(nextCampaign.id, nextCampaign);

    return Promise.resolve({ entry: { ...entry }, campaign: { ...nextCampaign }, replayed: false });
  }

  listBudgetEntries(
    filter?: {
      campaignId?: string;
      taskId?: string;
      entryType?: BudgetEntryType;
    } & PaginationFilter,
  ): Promise<BudgetEntry[]> {
    const list = [...this.budgetEntries.values()]
      .filter((e) => !filter?.campaignId || e.campaignId === filter.campaignId)
      .filter((e) => !filter?.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter?.entryType || e.entryType === filter.entryType)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((e) => ({ ...e }));
    return Promise.resolve(paginateArray(list, filter));
  }

  upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook> {
    const enabled = Boolean(input.enabled);
    const hookState: SlopCashHookState = enabled
      ? (input.hookState ?? "ready_for_sync")
      : "disabled_stub";
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
      repoSlug: input.repoSlug ?? existing?.repoSlug ?? DEFAULT_SLOP_CASH_REPO,
      issueNumber:
        input.issueNumber !== undefined ? input.issueNumber : (existing?.issueNumber ?? null),
      vaultChain: input.vaultChain ?? existing?.vaultChain ?? DEFAULT_SLOP_CASH_CHAIN,
      estimatedUsdcCents: input.estimatedUsdcCents,
      hookState,
      externalTxHash: enabled
        ? input.externalTxHash !== undefined
          ? input.externalTxHash
          : (existing?.externalTxHash ?? null)
        : null,
      createdAt: existing?.createdAt ?? isoNow(this.clock),
    };
    this.slopCashHooks.set(hook.id, hook);
    return Promise.resolve({ ...hook });
  }

  getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null> {
    for (const h of this.slopCashHooks.values()) {
      if (h.taskId === taskId) return Promise.resolve({ ...h });
    }
    return Promise.resolve(null);
  }

  listSlopCashHooks(filter?: PaginationFilter): Promise<SlopCashHook[]> {
    const list = [...this.slopCashHooks.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((h) => ({ ...h }));
    return Promise.resolve(paginateArray(list, filter));
  }

  // ---- Pass-2 CRUD (Memory) ----

  upsertBanditArm(input: UpsertBanditArmInput): Promise<BanditArm> {
    if (!this.campaigns.has(input.campaignId)) {
      return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    }
    let existing: BanditArm | undefined;
    if (input.id) existing = this.banditArms.get(input.id);
    if (!existing) {
      for (const arm of this.banditArms.values()) {
        if (arm.campaignId === input.campaignId && arm.armKey === input.armKey) {
          existing = arm;
          break;
        }
      }
    }
    const arm: BanditArm = {
      id: existing?.id ?? input.id ?? this.idGen(),
      campaignId: input.campaignId,
      armKey: input.armKey,
      label: input.label,
      track: input.track,
      alpha: input.alpha ?? existing?.alpha ?? 1,
      beta: input.beta ?? existing?.beta ?? 1,
      weight: input.weight ?? existing?.weight ?? 0,
      spendCents: input.spendCents ?? existing?.spendCents ?? 0,
      signups: input.signups ?? existing?.signups ?? 0,
      stopEvents: input.stopEvents ?? existing?.stopEvents ?? 0,
      totalContacts: input.totalContacts ?? existing?.totalContacts ?? 0,
      status: input.status ?? existing?.status ?? "active",
      updatedAt: isoNow(this.clock),
    };
    this.banditArms.set(arm.id, arm);
    return Promise.resolve({ ...arm });
  }

  getBanditArm(id: string): Promise<BanditArm | null> {
    const arm = this.banditArms.get(id);
    return Promise.resolve(arm ? { ...arm } : null);
  }

  listBanditArms(
    filter?: string | ({ campaignId?: string; status?: BanditArmStatus } & PaginationFilter),
  ): Promise<BanditArm[]> {
    const normalized = typeof filter === "string" ? { campaignId: filter } : filter;
    const list = [...this.banditArms.values()]
      .filter((a) => !normalized?.campaignId || a.campaignId === normalized.campaignId)
      .filter((a) => !normalized?.status || a.status === normalized.status)
      .sort((a, b) => b.weight - a.weight || a.armKey.localeCompare(b.armKey))
      .map((a) => ({ ...a }));
    return Promise.resolve(paginateArray(list, normalized));
  }

  updateBanditArm(id: string, patch: UpdateBanditArmInput): Promise<BanditArm> {
    const existing = this.banditArms.get(id);
    if (!existing) return Promise.reject(new Error(`Bandit arm not found: ${id}`));
    const next: BanditArm = {
      ...existing,
      label: patch.label ?? existing.label,
      alpha: patch.alpha ?? existing.alpha,
      beta: patch.beta ?? existing.beta,
      weight: patch.weight ?? existing.weight,
      spendCents: patch.spendCents ?? existing.spendCents,
      signups: patch.signups ?? existing.signups,
      stopEvents: patch.stopEvents ?? existing.stopEvents,
      totalContacts: patch.totalContacts ?? existing.totalContacts,
      status: patch.status ?? existing.status,
      updatedAt: isoNow(this.clock),
    };
    this.banditArms.set(id, next);
    return Promise.resolve({ ...next });
  }

  createBdDeal(input: CreateBdDealInput): Promise<BdDeal> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    const now = isoNow(this.clock);
    const deal: BdDeal = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      city: input.city ?? campaign.city,
      venueName: input.venueName,
      vertical: input.vertical,
      contactEmail: input.contactEmail ?? null,
      businessPhone: input.businessPhone ?? null,
      stage: input.stage ?? "prospect",
      offeredCents: input.offeredCents ?? 0,
      phoneCallbackVerified: input.phoneCallbackVerified ?? false,
      contractHash: input.contractHash ?? null,
      qrBatchId: input.qrBatchId ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.bdDeals.set(deal.id, deal);
    return Promise.resolve({ ...deal });
  }

  getBdDeal(id: string): Promise<BdDeal | null> {
    const d = this.bdDeals.get(id);
    return Promise.resolve(d ? { ...d } : null);
  }

  listBdDeals(
    filter?: { campaignId?: string; city?: string; stage?: BdDealStage } & PaginationFilter,
  ): Promise<BdDeal[]> {
    const list = [...this.bdDeals.values()]
      .filter((d) => !filter?.campaignId || d.campaignId === filter.campaignId)
      .filter((d) => !filter?.city || d.city === filter.city)
      .filter((d) => !filter?.stage || d.stage === filter.stage)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((d) => ({ ...d }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateBdDeal(id: string, patch: UpdateBdDealInput): Promise<BdDeal> {
    const existing = this.bdDeals.get(id);
    if (!existing) return Promise.reject(new Error(`BD deal not found: ${id}`));
    const next: BdDeal = {
      ...existing,
      venueName: patch.venueName ?? existing.venueName,
      vertical: patch.vertical ?? existing.vertical,
      contactEmail: patch.contactEmail !== undefined ? patch.contactEmail : existing.contactEmail,
      businessPhone:
        patch.businessPhone !== undefined ? patch.businessPhone : existing.businessPhone,
      stage: patch.stage ?? existing.stage,
      offeredCents: patch.offeredCents ?? existing.offeredCents,
      phoneCallbackVerified: patch.phoneCallbackVerified ?? existing.phoneCallbackVerified,
      contractHash: patch.contractHash !== undefined ? patch.contractHash : existing.contractHash,
      qrBatchId: patch.qrBatchId !== undefined ? patch.qrBatchId : existing.qrBatchId,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      updatedAt: isoNow(this.clock),
    };
    this.bdDeals.set(id, next);
    return Promise.resolve({ ...next });
  }

  createQrBatch(input: CreateQrBatchInput): Promise<QrBatch> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    for (const q of this.qrBatches.values()) {
      if (q.batchCode === input.batchCode) {
        return Promise.reject(new Error(`QR batch code already exists: ${input.batchCode}`));
      }
    }
    const batch: QrBatch = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      city: input.city ?? campaign.city,
      batchCode: input.batchCode,
      destinationUrl: input.destinationUrl,
      dubLinkId: input.dubLinkId ?? null,
      printQty: input.printQty ?? 0,
      assignedToType: input.assignedToType ?? null,
      assignedToId: input.assignedToId ?? null,
      scans: input.scans ?? 0,
      verifiedSignups: input.verifiedSignups ?? 0,
      createdAt: isoNow(this.clock),
    };
    this.qrBatches.set(batch.id, batch);
    return Promise.resolve({ ...batch });
  }

  getQrBatch(id: string): Promise<QrBatch | null> {
    const q = this.qrBatches.get(id);
    return Promise.resolve(q ? { ...q } : null);
  }

  getQrBatchByCode(batchCode: string): Promise<QrBatch | null> {
    for (const q of this.qrBatches.values()) {
      if (q.batchCode === batchCode) return Promise.resolve({ ...q });
    }
    return Promise.resolve(null);
  }

  listQrBatches(
    filter?: {
      campaignId?: string;
      city?: string;
      assignedToType?: QrBatchAssigneeType;
    } & PaginationFilter,
  ): Promise<QrBatch[]> {
    const list = [...this.qrBatches.values()]
      .filter((q) => !filter?.campaignId || q.campaignId === filter.campaignId)
      .filter((q) => !filter?.city || q.city === filter.city)
      .filter((q) => !filter?.assignedToType || q.assignedToType === filter.assignedToType)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((q) => ({ ...q }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateQrBatch(id: string, patch: UpdateQrBatchInput): Promise<QrBatch> {
    const existing = this.qrBatches.get(id);
    if (!existing) return Promise.reject(new Error(`QR batch not found: ${id}`));
    const next: QrBatch = {
      ...existing,
      destinationUrl: patch.destinationUrl ?? existing.destinationUrl,
      dubLinkId: patch.dubLinkId !== undefined ? patch.dubLinkId : existing.dubLinkId,
      printQty: patch.printQty ?? existing.printQty,
      assignedToType:
        patch.assignedToType !== undefined ? patch.assignedToType : existing.assignedToType,
      assignedToId: patch.assignedToId !== undefined ? patch.assignedToId : existing.assignedToId,
      scans: patch.scans ?? existing.scans,
      verifiedSignups: patch.verifiedSignups ?? existing.verifiedSignups,
    };
    this.qrBatches.set(id, next);
    return Promise.resolve({ ...next });
  }

  createVipProspect(input: CreateVipProspectInput): Promise<VipProspect> {
    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    const now = isoNow(this.clock);
    const prospect: VipProspect = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      city: input.city ?? campaign.city,
      name: input.name,
      archetype: input.archetype,
      organization: input.organization ?? null,
      publicSource: input.publicSource,
      sourceUrl: input.sourceUrl ?? null,
      prestigeScore: input.prestigeScore ?? 0,
      contactEmail: input.contactEmail ?? null,
      inviteDraft: input.inviteDraft ?? null,
      status: input.status ?? "discovered",
      createdAt: now,
      updatedAt: now,
    };
    this.vipProspects.set(prospect.id, prospect);
    return Promise.resolve({ ...prospect });
  }

  getVipProspect(id: string): Promise<VipProspect | null> {
    const v = this.vipProspects.get(id);
    return Promise.resolve(v ? { ...v } : null);
  }

  listVipProspects(
    filter?: {
      campaignId?: string;
      city?: string;
      archetype?: string;
      status?: VipProspectStatus;
    } & PaginationFilter,
  ): Promise<VipProspect[]> {
    const list = [...this.vipProspects.values()]
      .filter((v) => !filter?.campaignId || v.campaignId === filter.campaignId)
      .filter((v) => !filter?.city || v.city === filter.city)
      .filter((v) => !filter?.archetype || v.archetype === filter.archetype)
      .filter((v) => !filter?.status || v.status === filter.status)
      .sort((a, b) => b.prestigeScore - a.prestigeScore || b.updatedAt.localeCompare(a.updatedAt))
      .map((v) => ({ ...v }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateVipProspect(id: string, patch: UpdateVipProspectInput): Promise<VipProspect> {
    const existing = this.vipProspects.get(id);
    if (!existing) return Promise.reject(new Error(`VIP prospect not found: ${id}`));
    const next: VipProspect = {
      ...existing,
      archetype: patch.archetype ?? existing.archetype,
      organization: patch.organization !== undefined ? patch.organization : existing.organization,
      sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl : existing.sourceUrl,
      prestigeScore: patch.prestigeScore ?? existing.prestigeScore,
      contactEmail: patch.contactEmail !== undefined ? patch.contactEmail : existing.contactEmail,
      inviteDraft: patch.inviteDraft !== undefined ? patch.inviteDraft : existing.inviteDraft,
      status: patch.status ?? existing.status,
      updatedAt: isoNow(this.clock),
    };
    this.vipProspects.set(id, next);
    return Promise.resolve({ ...next });
  }

  createVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset> {
    if (!this.campaigns.has(input.campaignId)) {
      return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    }
    const now = isoNow(this.clock);
    const asset: VideoAsset = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      agentId: input.agentId ?? null,
      title: input.title,
      hook: input.hook,
      script: input.script,
      stage: input.stage ?? "trend",
      videoUrl: input.videoUrl ?? null,
      platform: input.platform ?? null,
      views: input.views ?? 0,
      retention3sPct: input.retention3sPct ?? 0,
      signups: input.signups ?? 0,
      ftcDisclosed: input.ftcDisclosed ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.videoAssets.set(asset.id, asset);
    return Promise.resolve({ ...asset });
  }

  getVideoAsset(id: string): Promise<VideoAsset | null> {
    const v = this.videoAssets.get(id);
    return Promise.resolve(v ? { ...v } : null);
  }

  listVideoAssets(
    filter?: { campaignId?: string; agentId?: string; stage?: VideoAssetStage } & PaginationFilter,
  ): Promise<VideoAsset[]> {
    const list = [...this.videoAssets.values()]
      .filter((v) => !filter?.campaignId || v.campaignId === filter.campaignId)
      .filter((v) => !filter?.agentId || v.agentId === filter.agentId)
      .filter((v) => !filter?.stage || v.stage === filter.stage)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((v) => ({ ...v }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateVideoAsset(id: string, patch: UpdateVideoAssetInput): Promise<VideoAsset> {
    const existing = this.videoAssets.get(id);
    if (!existing) return Promise.reject(new Error(`Video asset not found: ${id}`));
    const next: VideoAsset = {
      ...existing,
      agentId: patch.agentId !== undefined ? patch.agentId : existing.agentId,
      title: patch.title ?? existing.title,
      hook: patch.hook ?? existing.hook,
      script: patch.script ?? existing.script,
      stage: patch.stage ?? existing.stage,
      videoUrl: patch.videoUrl !== undefined ? patch.videoUrl : existing.videoUrl,
      platform: patch.platform !== undefined ? patch.platform : existing.platform,
      views: patch.views ?? existing.views,
      retention3sPct: patch.retention3sPct ?? existing.retention3sPct,
      signups: patch.signups ?? existing.signups,
      ftcDisclosed: patch.ftcDisclosed ?? existing.ftcDisclosed,
      updatedAt: isoNow(this.clock),
    };
    this.videoAssets.set(id, next);
    return Promise.resolve({ ...next });
  }

  createAntiFraudClaim(input: CreateAntiFraudClaimInput): Promise<AntiFraudClaim> {
    if (!this.campaigns.has(input.campaignId)) {
      return Promise.reject(new Error(`Campaign not found: ${input.campaignId}`));
    }
    const claim: AntiFraudClaim = {
      id: input.id ?? this.idGen(),
      campaignId: input.campaignId,
      personKey: input.personKey,
      workerId: input.workerId ?? null,
      taskId: input.taskId ?? null,
      phoneLineType: input.phoneLineType ?? "unknown",
      mediaHash: input.mediaHash ?? null,
      clusterId: input.clusterId ?? null,
      vestingTier: input.vestingTier ?? 1,
      amountCents: input.amountCents,
      status: input.status ?? "vesting",
      reason: input.reason ?? null,
      createdAt: isoNow(this.clock),
    };
    this.antifraudClaims.set(claim.id, claim);
    return Promise.resolve({ ...claim });
  }

  getAntiFraudClaim(id: string): Promise<AntiFraudClaim | null> {
    const c = this.antifraudClaims.get(id);
    return Promise.resolve(c ? { ...c } : null);
  }

  listAntiFraudClaims(
    filter?: {
      campaignId?: string;
      personKey?: string;
      workerId?: string;
      status?: AntiFraudClaimStatus;
    } & PaginationFilter,
  ): Promise<AntiFraudClaim[]> {
    const list = [...this.antifraudClaims.values()]
      .filter((c) => !filter?.campaignId || c.campaignId === filter.campaignId)
      .filter((c) => !filter?.personKey || c.personKey === filter.personKey)
      .filter((c) => !filter?.workerId || c.workerId === filter.workerId)
      .filter((c) => !filter?.status || c.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c }));
    return Promise.resolve(paginateArray(list, filter));
  }

  updateAntiFraudClaim(id: string, patch: UpdateAntiFraudClaimInput): Promise<AntiFraudClaim> {
    const existing = this.antifraudClaims.get(id);
    if (!existing) return Promise.reject(new Error(`Anti-fraud claim not found: ${id}`));
    const next: AntiFraudClaim = {
      ...existing,
      clusterId: patch.clusterId !== undefined ? patch.clusterId : existing.clusterId,
      vestingTier: patch.vestingTier ?? existing.vestingTier,
      amountCents: patch.amountCents ?? existing.amountCents,
      status: patch.status ?? existing.status,
      reason: patch.reason !== undefined ? patch.reason : existing.reason,
    };
    this.antifraudClaims.set(id, next);
    return Promise.resolve({ ...next });
  }

  getAnnualWorkerPaidCents(workerId: string, year: number): Promise<number> {
    const startMs = Date.UTC(year, 0, 1);
    const endMs = Date.UTC(year + 1, 0, 1);
    let total = 0;
    for (const t of this.tasks.values()) {
      if (t.assigneeHumanId === workerId && t.status === "paid" && t.paidAt) {
        const ms = Date.parse(t.paidAt);
        if (ms >= startMs && ms < endMs) total += t.amountCents;
      }
    }
    for (const c of this.antifraudClaims.values()) {
      if (c.workerId === workerId && c.status === "approved" && !c.taskId) {
        const ms = Date.parse(c.createdAt);
        if (ms >= startMs && ms < endMs) total += c.amountCents;
      }
    }
    return Promise.resolve(total);
  }

  getLifetimePersonBonusCents(personKey: string): Promise<number> {
    let total = 0;
    for (const c of this.antifraudClaims.values()) {
      if (c.personKey === personKey && (c.status === "approved" || c.status === "vesting")) {
        total += c.amountCents;
      }
    }
    return Promise.resolve(total);
  }

  hasMediaHash(mediaHash: string, excludeTaskId?: string): Promise<boolean> {
    const target = mediaHash.trim();
    if (!target) return Promise.resolve(false);
    for (const c of this.antifraudClaims.values()) {
      if (c.mediaHash === target && (!excludeTaskId || c.taskId !== excludeTaskId)) {
        return Promise.resolve(true);
      }
    }
    for (const p of this.proofs.values()) {
      if (
        p.checkinMediaHashes.includes(target) &&
        (!excludeTaskId || p.taskId !== excludeTaskId)
      ) {
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  resetDailyCounters(): Promise<void> {
    const now = isoNow(this.clock);
    for (const [id, c] of this.campaigns) {
      this.campaigns.set(id, { ...c, dailySpentCents: 0, updatedAt: now });
    }
    for (const [id, a] of this.agents) {
      const clearRateLimit = a.status === "rate_limited" || a.status === "cooldown";
      this.agents.set(id, {
        ...a,
        turnsUsedToday: 0,
        status: clearRateLimit ? "idle" : a.status,
        cooldownUntil: clearRateLimit ? null : a.cooldownUntil,
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
    return Promise.resolve();
  }

  getOverview(campaignId?: string): Promise<MarketingOverview> {
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

    return Promise.resolve(
      buildOverview(
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
      ),
    );
  }
}

// ============================================================================
// PgMarketingStore (Node 26 postgres.ts against marketing.* schema)
// ============================================================================

type Row = Record<string, unknown>;

function asStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

function asOptStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return asStr(v);
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asOptNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = asNum(v, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

function asBool(v: unknown): boolean {
  return Boolean(v);
}

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
      const parsed: unknown = JSON.parse(v);
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
  if (Array.isArray(v)) return v.map((item) => asStr(item));
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return (parsed as unknown[]).map((item) => asStr(item));
    } catch {
      return [];
    }
  }
  return [];
}

function authModeFromDb(mode: string): AgentAuthMode {
  return mode === "api_key" ? "api" : (mode as AgentAuthMode);
}

function channelStatusFromDb(status: string): ChannelAccount["status"] {
  if (status === "retired") return "disabled";
  if (status === "needs_takeover") return "cooldown";
  return status as ChannelAccount["status"];
}

function outreachDbToChannel(dbCh: string, templateId?: string | null): OutreachChannel {
  if (templateId && templateId.startsWith("ch:")) {
    return templateId.slice(3) as OutreachChannel;
  }
  if (dbCh === "craigslist_relay") return "craigslist";
  if (dbCh === "x_dm") return "x";
  if (dbCh === "ig_dm") return "instagram";
  if (dbCh === "eliza_deliver") return "sms_opted_in";
  return (dbCh === "other" ? "email" : dbCh) as OutreachChannel;
}

function payoutRailFromDb(rail: string, meta: Record<string, unknown>): PayoutRail {
  if (rail === "usdc_direct" || meta["payoutRail"] === "usdc_direct") return "usdc_direct";
  if (rail === "agency_invoice" || rail === "platform_escrow") return "fiat_stripe";
  return rail as PayoutRail;
}

function attributionKindFromDb(dbType: string): AttributionEvent["eventKind"] {
  if (dbType === "link_click" || dbType === "site_visit") return "site_visit";
  if (dbType === "signup_verified_18plus" || dbType === "signup_verified_adult") {
    return "signup_verified_adult";
  }
  if (dbType === "video_view_snapshot" || dbType === "video_view") return "video_view";
  if (dbType === "signup_started") return "signup_started";
  return "qr_scan";
}

function firstRow(rows: unknown): Row | undefined {
  return Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
}

function allRows(rows: unknown): Row[] {
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

export class PgMarketingStore implements MarketingStore {
  readonly sql: SQL;
  readonly clock: Clock;
  private readonly owned: boolean;
  private readonly idGen: () => string;
  private readonly hashKey?: string;

  constructor(
    db: string | SQL,
    opts: { clock?: Clock; idGen?: () => string; hashKey?: string } = {},
  ) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
    this.clock = opts.clock ?? new RealClock();
    this.idGen = opts.idGen ?? defaultId;
    this.hashKey = opts.hashKey;
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

  private async dailySpentForCampaign(
    q: SQL,
    campaignId: string,
    meta: Record<string, unknown>,
  ): Promise<number> {
    const dayStart = utcDayStartIso(this.clock);
    const resetAt = typeof meta["dailyResetAt"] === "string" ? meta["dailyResetAt"] : null;
    const since = resetAt && resetAt > dayStart ? resetAt : dayStart;
    // C-02: exclude `from_reserve = true` commits so reserve -> commit is never double-counted.
    const rows = await q`
      select
        coalesce(sum(case
          when entry_type = 'reserve' or (entry_type = 'commit' and from_reserve = false)
          then amount_cents else 0 end), 0)::int as added,
        coalesce(sum(case when entry_type in ('release', 'refund') then amount_cents else 0 end), 0)::int as reduced
      from marketing.budget_ledger
      where campaign_id = ${campaignId}
        and created_at >= ${new Date(since)}
    `;
    const r = firstRow(rows);
    return Math.max(0, asNum(r?.added) - asNum(r?.reduced));
  }

  private mapCampaign(r: Row, dailySpentCents?: number): Campaign {
    const riskDialRaw = asStr(r.risk_dial, "conservative");
    const statusRaw = asStr(r.status, "active");
    return {
      id: asStr(r.id),
      slug: asStr(r.slug),
      name: asStr(r.name),
      city: asStr(r.city, "nyc"),
      appId: asStr(r.app_id, "all") as AppId,
      riskZone: asStr(r.risk_zone, "zone_2_amber") as RiskZone,
      riskDial: (riskDialRaw === "normal" ? "balanced" : riskDialRaw) as RiskDial,
      monthlyBudgetCents: asNum(r.monthly_budget_cents),
      dailyCapCents: asNum(r.daily_cap_cents),
      maxTaskCents: asNum(r.max_task_cents),
      reservedCents: asNum(r.reserved_cents),
      spentCents: asNum(r.spent_cents),
      dailySpentCents:
        dailySpentCents !== undefined
          ? dailySpentCents
          : asNum(r.computed_daily_spent_cents ?? r.daily_spent_cents),
      billingArmed: asBool(r.billing_armed),
      slopCashEnabled: asBool(r.slop_cash_enabled),
      status: (statusRaw === "archived" ? "completed" : statusRaw) as Campaign["status"],
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapAgent(r: Row): MarketingAgent {
    const rawPersona = asStr(r.persona_id);
    const persona = (rawPersona === "eliza" ? "operator" : rawPersona) as PersonaId;
    const rawApp = asStr(r.app_id, "ntwrk");
    const appId = (rawApp === "all" ? "ntwrk" : rawApp) as BrandAppId;
    return {
      id: asStr(r.id),
      personaId: persona,
      displayName: asStr(r.display_name),
      appId,
      provider: asStr(r.provider, "chatgpt") as SubscriptionProvider,
      failoverProvider: asOptStr(r.failover_provider) as SubscriptionProvider | null,
      authMode: authModeFromDb(asStr(r.auth_mode, "cli")),
      sessionRef: asStr(r.session_ref),
      sessionHealthy: asBool(r.session_healthy),
      dailyTurnCap: asNum(r.daily_turn_cap, DEFAULT_DAILY_TURN_CAP),
      turnsUsedToday: asNum(r.turns_used_today),
      cooldownUntil: toIsoOrNull(r.cooldown_until),
      status: asStr(r.status, "idle") as AgentStatus,
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapDevice(r: Row): DeviceNode {
    const rawPlatform = asStr(r.platform, "android");
    const platform: DevicePlatform =
      rawPlatform === "macbook" || rawPlatform === "ios" ? rawPlatform : "android";
    const rawAssigned = asOptStr(r.assigned_persona);
    return {
      id: asStr(r.id),
      label: asStr(r.label),
      platform,
      hostMachine: asStr(r.host_machine, "local-macbook"),
      serialOrUdid: asStr(r.serial_or_udid),
      assignedPersona: (rawAssigned === "eliza" ? "operator" : rawAssigned) as PersonaId | null,
      simCarrier: asOptStr(r.sim_carrier),
      batteryPct: asNum(r.battery_pct, 60),
      tempC: asNum(r.temp_c, 30),
      warmupDay: asNum(r.warmup_day),
      warmupStage: asStr(r.warmup_stage, "birth_passive") as DeviceWarmupStage,
      dailyActionsUsed: asNum(r.daily_actions_used),
      dailyActionCap: asNum(r.daily_action_cap),
      leaseHolder: asOptStr(r.lease_holder),
      leaseExpiresAt: toIsoOrNull(r.lease_expires_at),
      status: asStr(r.status, "online") as DeviceStatus,
      lastSeenAt: toIso(r.last_seen_at),
    };
  }

  private mapChannelAccount(r: Row): ChannelAccount {
    const meta = toJsonObj(r.metadata);
    return {
      id: asStr(r.id),
      agentId: asStr(r.agent_id),
      deviceId: asOptStr(r.device_id),
      channel: (typeof meta["channel"] === "string"
        ? meta["channel"]
        : asStr(r.platform, "email")) as OutreachChannel,
      handle: asStr(r.handle),
      city: asStr(r.city) || (typeof meta["city"] === "string" ? meta["city"] : "nyc"),
      warmupDay: asNum(r.warmup_day),
      dailyOutreachCap: asNum(r.daily_post_cap, DEFAULT_DAILY_OUTREACH_CAP),
      sentToday: asNum(r.posts_today),
      status: channelStatusFromDb(asStr(r.status, "active")),
      createdAt: toIso(r.created_at),
    };
  }

  private mapHuman(r: Row): HumanPartner {
    const meta = toJsonObj(r.metadata);
    const rawRole = asStr(r.role, "applicant");
    const role = (
      rawRole === "event_activator"
        ? "street_worker"
        : rawRole === "printer" || rawRole === "community"
          ? "venue"
          : rawRole
    ) as HumanRole;
    return {
      id: asStr(r.id),
      handleOrEmailHmac: asStr(r.contact_key),
      displayLabel: asStr(r.display_name),
      channel: (typeof meta["channel"] === "string"
        ? meta["channel"]
        : asStr(r.source_channel, "email")) as OutreachChannel,
      role,
      city: asStr(r.city, "nyc"),
      lowestAge: asOptNum(r.age_years),
      stopped: asBool(r.stopped),
      banned: asBool(r.banned),
      stopReason: asOptStr(r.stop_reason),
      dailySendsToday: asNum(r.daily_sends_today),
      lastContactedAt: toIsoOrNull(r.last_contacted_at),
      createdAt: toIso(r.created_at),
    };
  }

  private mapTask(r: Row): MarketingTask {
    const meta = toJsonObj(r.metadata);
    const rawKind = asStr(r.task_kind, "street_fliering");
    const rawVendor = asStr(r.vendor_channel, "internal");
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      tier: asNum(r.tier, 1) as ImplementationTier,
      taskKind: (rawKind === "discovery" ? "digital_outreach" : rawKind) as TaskKind,
      city: asStr(r.city, "nyc"),
      title: asStr(r.title),
      briefText: asStr(r.brief_text),
      vendorChannel: (rawVendor === "print_local" ? "print_api" : rawVendor) as VendorChannel,
      assigneeHumanId: asOptStr(r.human_id),
      assigneeAgeYears: asOptNum(r.worker_age_years),
      amountCents: asNum(r.amount_cents),
      qrBatchCode: asOptStr(r.qr_batch_code),
      dubShortUrl: asOptStr(r.short_url),
      payoutRail: payoutRailFromDb(asStr(r.payout_rail, "none"), meta),
      proofVerified: asBool(r.proof_verified),
      status: asStr(r.status, "drafted") as TaskStatus,
      createdAt: toIso(r.created_at),
      paidAt: toIsoOrNull(r.paid_at),
    };
  }

  private mapProof(r: Row): ProofSubmission {
    const rawKind = asStr(r.proof_kind, "street_shift");
    return {
      id: asStr(r.id),
      taskId: asStr(r.task_id),
      proofKind: (rawKind === "agency_recap" ? "street_shift" : rawKind) as ProofKind,
      evidenceUrl: asOptStr(r.evidence_url),
      checkinMediaHashes: toStringArray(r.checkin_media_hashes),
      qrScansCount: asNum(r.qr_scans_count),
      verifiedSignupsCount: asNum(r.verified_signups_count),
      ftcDisclosed: asBool(r.ftc_disclosed),
      geoTimeValid: asBool(r.geo_time_valid),
      likenessReleaseOk: asBool(r.likeness_release_ok),
      verdict: asStr(r.verifier_verdict, "pending") as ProofVerdict,
      verifierNotes: asOptStr(r.verifier_notes),
      createdAt: toIso(r.created_at),
    };
  }

  private mapOutreach(r: Row): OutreachMessage {
    const rawStatus = asStr(r.status, "queued");
    const status = (
      rawStatus === "drafted" || rawStatus === "dry_run"
        ? "queued"
        : rawStatus === "bounced"
          ? "failed"
          : rawStatus
    ) as OutreachStatus;
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      agentId: asStr(r.agent_id),
      humanId: asStr(r.human_id),
      channel: outreachDbToChannel(asStr(r.channel, "email"), asOptStr(r.template_id)),
      tier: asNum(r.tier, 1) as ImplementationTier,
      subject: asOptStr(r.subject),
      bodySummary: asStr(r.body_text),
      leakCheckPass: asBool(r.leak_check_pass),
      status,
      externalRef: asOptStr(r.external_message_id),
      createdAt: toIso(r.created_at),
    };
  }

  private mapAttribution(r: Row): AttributionEvent {
    const meta = toJsonObj(r.metadata);
    const colCount = asOptNum(r.count);
    const count =
      colCount !== null && colCount !== 1
        ? colCount
        : typeof meta["__count"] === "number"
          ? meta["__count"]
          : (colCount ?? 1);
    const qrNull = meta["__qrBatchNull"] === true;
    const cleanMeta = { ...meta };
    delete cleanMeta["__count"];
    delete cleanMeta["__qrBatchNull"];
    const rawApp = asStr(r.app_id, "ntwrk");
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      taskId: asOptStr(r.task_id),
      qrBatchCode: qrNull ? null : asOptStr(r.qr_batch_code),
      eventKind: attributionKindFromDb(asStr(r.event_type, "qr_scan")),
      city: asStr(r.city, "nyc"),
      appId: (rawApp === "all" ? "ntwrk" : rawApp) as BrandAppId,
      count,
      metadata: cleanMeta,
      createdAt: toIso(r.created_at),
    };
  }

  private mapBudgetEntry(r: Row): BudgetEntry {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      taskId: asOptStr(r.task_id),
      adapterId: asStr(r.adapter_id),
      tier: asNum(r.tier, 1) as ImplementationTier,
      amountCents: asNum(r.amount_cents),
      entryType: asStr(r.entry_type, "commit") as BudgetEntryType,
      fromReserve: asBool(r.from_reserve),
      idempotencyKey: asStr(r.idempotency_key),
      externalRef: asOptStr(r.external_ref),
      createdAt: toIso(r.created_at),
    };
  }

  private mapSlopCashHook(r: Row): SlopCashHook {
    return {
      id: asStr(r.id),
      taskId: asStr(r.task_id),
      repoSlug: asStr(r.repo_slug, DEFAULT_SLOP_CASH_REPO),
      issueNumber: asOptNum(r.issue_number),
      vaultChain: asStr(r.vault_chain, DEFAULT_SLOP_CASH_CHAIN) as SlopCashVaultChain,
      estimatedUsdcCents: asNum(r.estimated_usdc_cents),
      hookState: asStr(r.hook_state, "disabled_stub") as SlopCashHookState,
      externalTxHash: asOptStr(r.external_tx_hash),
      createdAt: toIso(r.created_at),
    };
  }

  private mapBanditArm(r: Row): BanditArm {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      armKey: asStr(r.arm_key),
      label: asStr(r.label),
      track: asStr(r.track),
      alpha: asNum(r.alpha, 1),
      beta: asNum(r.beta, 1),
      weight: asNum(r.weight, 0),
      spendCents: asNum(r.spend_cents),
      signups: asNum(r.signups),
      stopEvents: asNum(r.stop_events),
      totalContacts: asNum(r.total_contacts),
      status: asStr(r.status, "active") as BanditArmStatus,
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapBdDeal(r: Row): BdDeal {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      city: asStr(r.city, "nyc"),
      venueName: asStr(r.venue_name),
      vertical: asStr(r.vertical, "all") as AppId,
      contactEmail: asOptStr(r.contact_email),
      businessPhone: asOptStr(r.business_phone),
      stage: asStr(r.stage, "prospect") as BdDealStage,
      offeredCents: asNum(r.offered_cents),
      phoneCallbackVerified: asBool(r.phone_callback_verified),
      contractHash: asOptStr(r.contract_hash),
      qrBatchId: asOptStr(r.qr_batch_id),
      notes: asOptStr(r.notes),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapQrBatch(r: Row): QrBatch {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      city: asStr(r.city, "nyc"),
      batchCode: asStr(r.batch_code),
      destinationUrl: asStr(r.destination_url),
      dubLinkId: asOptStr(r.dub_link_id),
      printQty: asNum(r.print_qty),
      assignedToType: asOptStr(r.assigned_to_type) as QrBatchAssigneeType | null,
      assignedToId: asOptStr(r.assigned_to_id),
      scans: asNum(r.scans),
      verifiedSignups: asNum(r.verified_signups),
      createdAt: toIso(r.created_at),
    };
  }

  private mapVipProspect(r: Row): VipProspect {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      city: asStr(r.city, "nyc"),
      name: asStr(r.name),
      archetype: asStr(r.archetype),
      organization: asOptStr(r.organization),
      publicSource: asStr(r.public_source),
      sourceUrl: asOptStr(r.source_url),
      prestigeScore: asNum(r.prestige_score),
      contactEmail: asOptStr(r.contact_email),
      inviteDraft: asOptStr(r.invite_draft),
      status: asStr(r.status, "discovered") as VipProspectStatus,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapVideoAsset(r: Row): VideoAsset {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      agentId: asOptStr(r.agent_id),
      title: asStr(r.title),
      hook: asStr(r.hook),
      script: asStr(r.script),
      stage: asStr(r.stage, "trend") as VideoAssetStage,
      videoUrl: asOptStr(r.video_url),
      platform: asOptStr(r.platform),
      views: asNum(r.views),
      retention3sPct: asNum(r.retention_3s_pct),
      signups: asNum(r.signups),
      ftcDisclosed: asBool(r.ftc_disclosed),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapAntiFraudClaim(r: Row): AntiFraudClaim {
    return {
      id: asStr(r.id),
      campaignId: asStr(r.campaign_id),
      personKey: asStr(r.person_key),
      workerId: asOptStr(r.worker_id),
      taskId: asOptStr(r.task_id),
      phoneLineType: asStr(r.phone_line_type, "unknown") as PhoneLineType,
      mediaHash: asOptStr(r.media_hash),
      clusterId: asOptStr(r.cluster_id),
      vestingTier: asNum(r.vesting_tier, 1),
      amountCents: asNum(r.amount_cents),
      status: asStr(r.status, "vesting") as AntiFraudClaimStatus,
      reason: asOptStr(r.reason),
      createdAt: toIso(r.created_at),
    };
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
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
    return this.mapCampaign(firstRow(rows)!, 0);
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const rows = await this.sql`select * from marketing.campaigns where id = ${id}`;
    const r = firstRow(rows);
    if (!r) return null;
    const daily = await this.dailySpentForCampaign(this.sql, id, toJsonObj(r.metadata));
    return this.mapCampaign(r, daily);
  }

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    const rows = await this.sql`select * from marketing.campaigns where slug = ${slug}`;
    const r = firstRow(rows);
    if (!r) return null;
    const daily = await this.dailySpentForCampaign(this.sql, asStr(r.id), toJsonObj(r.metadata));
    return this.mapCampaign(r, daily);
  }

  async listCampaigns(
    filter?: { city?: string; appId?: AppId; status?: Campaign["status"] } & PaginationFilter,
  ): Promise<Campaign[]> {
    const { limit, offset } = normalizePagination(filter);
    const dayStart = new Date(utcDayStartIso(this.clock));
    // C-08: Eliminate N+1 dailySpentForCampaign via single LEFT JOIN LATERAL + SQL WHERE + pagination.
    const rows = await this.sql`
      select c.*,
        greatest(0, coalesce(d.added, 0) - coalesce(d.reduced, 0))::int as computed_daily_spent_cents
      from marketing.campaigns c
      left join lateral (
        select
          sum(case
            when bl.entry_type = 'reserve' or (bl.entry_type = 'commit' and bl.from_reserve = false)
            then bl.amount_cents else 0 end) as added,
          sum(case when bl.entry_type in ('release', 'refund') then bl.amount_cents else 0 end) as reduced
        from marketing.budget_ledger bl
        where bl.campaign_id = c.id
          and bl.created_at >= greatest(
            ${dayStart},
            coalesce((c.metadata->>'dailyResetAt')::timestamptz, ${dayStart})
          )
      ) d on true
      where (${filter?.city ?? null}::text is null or c.city = ${filter?.city ?? null})
        and (${filter?.appId ?? null}::text is null or c.app_id = ${filter?.appId ?? null})
        and (${filter?.status ?? null}::text is null or c.status = ${filter?.status ?? null})
      order by c.created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapCampaign(r));
  }

  async updateCampaign(id: string, patch: UpdateCampaignInput): Promise<Campaign> {
    return this.sql.begin(async (tx) => {
      const existingRows = await tx`select * from marketing.campaigns where id = ${id} for update`;
      const existingRow = firstRow(existingRows);
      if (!existingRow) throw new Error(`Campaign not found: ${id}`);
      const existing = this.mapCampaign(existingRow);

      const nextMonthly =
        patch.monthlyBudgetCents !== undefined
          ? patch.monthlyBudgetCents
          : existing.monthlyBudgetCents;
      const nextMaxTask =
        patch.maxTaskCents !== undefined
          ? patch.maxTaskCents
          : patch.perTaskCapCents !== undefined
            ? patch.perTaskCapCents
            : existing.maxTaskCents;
      if (existing.reservedCents + existing.spentCents > nextMonthly) {
        throw new PolicyViolationError(
          "BUDGET_CAP_EXCEEDED",
          "inv_budget_never_exceeded",
          "Cannot lower monthly budget below reserved + spent.",
        );
      }

      const now = new Date(this.clock.now());
      const nextMeta =
        patch.notes !== undefined
          ? JSON.stringify({ ...toJsonObj(existingRow.metadata), notes: patch.notes })
          : null;

      // C-07: strict mutable allowlist — never updates spent_cents or reserved_cents.
      const updatedRows = await tx`
        update marketing.campaigns set
          name = ${patch.name ?? existing.name},
          city = ${patch.city ?? existing.city},
          risk_zone = ${patch.riskZone ?? existing.riskZone},
          risk_dial = ${patch.riskDial ?? existing.riskDial},
          monthly_budget_cents = ${nextMonthly},
          daily_cap_cents = ${patch.dailyCapCents ?? existing.dailyCapCents},
          max_task_cents = ${nextMaxTask},
          billing_armed = ${patch.billingArmed ?? existing.billingArmed},
          slop_cash_enabled = ${patch.slopCashEnabled ?? existing.slopCashEnabled},
          status = ${patch.status ?? existing.status},
          metadata = coalesce(${nextMeta}::text::jsonb, metadata),
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      const r = firstRow(updatedRows)!;
      const daily = await this.dailySpentForCampaign(tx, id, toJsonObj(r.metadata));
      return this.mapCampaign(r, daily);
    });
  }

  setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign> {
    return this.updateCampaign(id, {
      riskDial,
      ...(billingArmed !== undefined ? { billingArmed } : {}),
    });
  }

  async upsertAgent(input: UpsertAgentInput): Promise<MarketingAgent> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const hasFailover = input.failoverProvider !== undefined;
    const hasAuthMode = input.authMode !== undefined;
    const hasSessionRef = input.sessionRef !== undefined;
    const hasSessionHealthy = input.sessionHealthy !== undefined;
    const hasDailyTurnCap = input.dailyTurnCap !== undefined;
    const hasTurnsUsed = input.turnsUsedToday !== undefined;
    const hasCooldown = input.cooldownUntil !== undefined;
    const hasStatus = input.status !== undefined;

    const rows = await this.sql`
      insert into marketing.agents (
        id, persona_id, display_name, app_id, provider, failover_provider,
        auth_mode, session_ref, session_healthy, daily_turn_cap,
        turns_used_today, cooldown_until, status, created_at, updated_at
      ) values (
        ${id}, ${input.personaId}, ${input.displayName}, ${input.appId},
        ${input.provider}, ${input.failoverProvider ?? null},
        ${input.authMode ?? "cli"}, ${input.sessionRef ?? ""},
        ${input.sessionHealthy ?? true}, ${input.dailyTurnCap ?? DEFAULT_DAILY_TURN_CAP},
        ${input.turnsUsedToday ?? 0},
        ${input.cooldownUntil ? new Date(input.cooldownUntil) : null},
        ${input.status ?? "idle"}, ${now}, ${now}
      )
      on conflict (persona_id) do update set
        display_name = excluded.display_name,
        app_id = excluded.app_id,
        provider = excluded.provider,
        failover_provider = case when ${hasFailover} then excluded.failover_provider else marketing.agents.failover_provider end,
        auth_mode = case when ${hasAuthMode} then excluded.auth_mode else marketing.agents.auth_mode end,
        session_ref = case when ${hasSessionRef} then excluded.session_ref else marketing.agents.session_ref end,
        session_healthy = case when ${hasSessionHealthy} then excluded.session_healthy else marketing.agents.session_healthy end,
        daily_turn_cap = case when ${hasDailyTurnCap} then excluded.daily_turn_cap else marketing.agents.daily_turn_cap end,
        turns_used_today = case when ${hasTurnsUsed} then excluded.turns_used_today else marketing.agents.turns_used_today end,
        cooldown_until = case when ${hasCooldown} then excluded.cooldown_until else marketing.agents.cooldown_until end,
        status = case when ${hasStatus} then excluded.status else marketing.agents.status end,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapAgent(firstRow(rows)!);
  }

  async getAgent(id: string): Promise<MarketingAgent | null> {
    const rows = await this.sql`select * from marketing.agents where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapAgent(r) : null;
  }

  async getAgentByPersona(personaId: PersonaId): Promise<MarketingAgent | null> {
    const rows = await this.sql`select * from marketing.agents where persona_id = ${personaId}`;
    const r = firstRow(rows);
    return r ? this.mapAgent(r) : null;
  }

  async listAgents(filter?: PaginationFilter): Promise<MarketingAgent[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.agents
      order by persona_id
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapAgent(r));
  }

  async updateAgent(
    id: string,
    patch: Partial<Omit<MarketingAgent, "id" | "personaId">>,
  ): Promise<MarketingAgent> {
    return this.sql.begin(async (tx) => {
      const existingRows = await tx`select * from marketing.agents where id = ${id} for update`;
      const existingRow = firstRow(existingRows);
      if (!existingRow) throw new Error(`Agent not found: ${id}`);
      const existing = this.mapAgent(existingRow);
      const now = new Date(this.clock.now());
      const nextCooldown =
        patch.cooldownUntil !== undefined ? patch.cooldownUntil : existing.cooldownUntil;
      const updatedRows = await tx`
        update marketing.agents set
          display_name = ${patch.displayName ?? existing.displayName},
          app_id = ${patch.appId ?? existing.appId},
          provider = ${patch.provider ?? existing.provider},
          failover_provider = ${patch.failoverProvider !== undefined ? patch.failoverProvider : existing.failoverProvider},
          auth_mode = ${patch.authMode ?? existing.authMode},
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
      return this.mapAgent(firstRow(updatedRows)!);
    });
  }

  async consumeAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    return this.sql.begin(async (tx) => {
      const agentRows = await tx`select * from marketing.agents where id = ${input.agentId} for update`;
      const ar = firstRow(agentRows);
      if (!ar) throw new Error(`Agent not found: ${input.agentId}`);
      const agent = this.mapAgent(ar);

      let lockdown = Boolean(input.lockdown);
      if (input.campaignId) {
        const cr = firstRow(
          await tx`select risk_dial from marketing.campaigns where id = ${input.campaignId}`,
        );
        if (asStr(cr?.risk_dial) === "lockdown") lockdown = true;
      }

      let targetStopped = Boolean(input.targetStopped);
      if (input.targetHumanId) {
        const hr = firstRow(
          await tx`select stopped, banned, phone_hash from marketing.humans where id = ${input.targetHumanId}`,
        );
        if (hr && (asBool(hr.stopped) || asBool(hr.banned))) targetStopped = true;
        const phoneHash = asOptStr(hr?.phone_hash);
        if (!targetStopped && phoneHash && (await isGloballySuppressedPhoneHash(tx, phoneHash))) {
          targetStopped = true;
        }
      }

      const nowMs = this.clock.now();
      const decision = evaluateAgentTurnPolicy({
        agent,
        nowMs,
        targetStopped,
        lockdown,
      });

      if (!decision.allowed) {
        return { allowed: false, agent, reason: decision.reason };
      }

      const updatedRows = await tx`
        update marketing.agents
        set turns_used_today = turns_used_today + 1, updated_at = ${new Date(nowMs)}
        where id = ${input.agentId}
        returning *
      `;
      return { allowed: true, agent: this.mapAgent(firstRow(updatedRows)!) };
    });
  }

  recordAgentTurn(input: ConsumeAgentTurnInput): Promise<ConsumeAgentTurnResult> {
    return this.consumeAgentTurn(input);
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceNode> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const warmupDay = input.warmupDay ?? 1;
    const preserve = Boolean(input.preserveCounters);

    const updateAssignedPersona = !preserve && input.assignedPersona !== undefined;
    const updateSimCarrier = !preserve && input.simCarrier !== undefined;
    const updateBattery = !preserve && input.batteryPct !== undefined;
    const updateTemp = !preserve && input.tempC !== undefined;
    const updateWarmup = !preserve && input.warmupDay !== undefined;
    const updateActionsUsed = !preserve && input.dailyActionsUsed !== undefined;
    const updateActionCap = !preserve && (input.dailyActionCap !== undefined || input.warmupDay !== undefined);
    const updateLeaseHolder = !preserve && input.leaseHolder !== undefined;
    const updateLeaseExpires = !preserve && input.leaseExpiresAt !== undefined;
    const updateStatus = !preserve && input.status !== undefined;

    const rows = await this.sql`
      insert into marketing.devices (
        id, label, platform, host_machine, serial_or_udid, assigned_persona,
        sim_carrier, battery_pct, temp_c, warmup_day, warmup_stage,
        daily_actions_used, daily_action_cap, lease_holder, lease_expires_at,
        status, last_seen_at, created_at
      ) values (
        ${id}, ${input.label}, ${input.platform}, ${input.hostMachine ?? "local-macbook"},
        ${input.serialOrUdid}, ${input.assignedPersona ?? null}, ${input.simCarrier ?? null},
        ${input.batteryPct ?? 60}, ${input.tempC ?? 30}, ${warmupDay},
        ${input.warmupStage ?? deriveWarmupStage(warmupDay)},
        ${input.dailyActionsUsed ?? 0}, ${input.dailyActionCap ?? warmupDailyCap(warmupDay)},
        ${input.leaseHolder ?? null},
        ${input.leaseExpiresAt ? new Date(input.leaseExpiresAt) : null},
        ${input.status ?? "online"}, ${now}, ${now}
      )
      on conflict (serial_or_udid) do update set
        label = excluded.label,
        platform = excluded.platform,
        host_machine = excluded.host_machine,
        assigned_persona = case when ${updateAssignedPersona} then excluded.assigned_persona else marketing.devices.assigned_persona end,
        sim_carrier = case when ${updateSimCarrier} then excluded.sim_carrier else marketing.devices.sim_carrier end,
        battery_pct = case when ${updateBattery} then excluded.battery_pct else marketing.devices.battery_pct end,
        temp_c = case when ${updateTemp} then excluded.temp_c else marketing.devices.temp_c end,
        warmup_day = case when ${updateWarmup} then excluded.warmup_day else marketing.devices.warmup_day end,
        warmup_stage = case when ${updateWarmup} then excluded.warmup_stage else marketing.devices.warmup_stage end,
        daily_actions_used = case when ${updateActionsUsed} then excluded.daily_actions_used else marketing.devices.daily_actions_used end,
        daily_action_cap = case when ${updateActionCap} then excluded.daily_action_cap else marketing.devices.daily_action_cap end,
        lease_holder = case when ${updateLeaseHolder} then excluded.lease_holder else marketing.devices.lease_holder end,
        lease_expires_at = case when ${updateLeaseExpires} then excluded.lease_expires_at else marketing.devices.lease_expires_at end,
        status = case
          when ${updateStatus} then excluded.status
          when marketing.devices.status = 'offline' and excluded.status = 'online' then 'online'
          else marketing.devices.status
        end,
        last_seen_at = excluded.last_seen_at
      returning *
    `;
    return this.mapDevice(firstRow(rows)!);
  }

  async getDevice(id: string): Promise<DeviceNode | null> {
    const rows = await this.sql`select * from marketing.devices where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapDevice(r) : null;
  }

  async listDevices(filter?: PaginationFilter): Promise<DeviceNode[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.devices
      order by label
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapDevice(r));
  }

  async updateDeviceTelemetry(id: string, update: DeviceTelemetryUpdate): Promise<DeviceNode> {
    return this.sql.begin(async (tx) => {
      const dr = firstRow(await tx`select * from marketing.devices where id = ${id} for update`);
      if (!dr) throw new Error(`Device not found: ${id}`);
      const existing = this.mapDevice(dr);
      const warmupDay = update.warmupDay ?? existing.warmupDay;
      const nowMs = this.clock.now();
      const hasActiveLease =
        existing.leaseHolder !== null &&
        (existing.leaseExpiresAt === null || Date.parse(existing.leaseExpiresAt) > nowMs);
      const requestedStatus = update.status ?? existing.status;
      const nextStatus =
        update.status === "offline" || update.status === "needs_takeover"
          ? update.status
          : deriveDeviceTelemetryStatus(
              requestedStatus !== "offline",
              update.batteryPct,
              update.tempC,
              requestedStatus,
              hasActiveLease,
            );
      const rows = await tx`
        update marketing.devices set
          battery_pct = ${update.batteryPct},
          temp_c = ${update.tempC},
          warmup_day = ${warmupDay},
          warmup_stage = ${deriveWarmupStage(warmupDay)},
          daily_action_cap = ${warmupDailyCap(warmupDay)},
          status = ${nextStatus},
          last_seen_at = ${new Date(nowMs)}
        where id = ${id}
        returning *
      `;
      return this.mapDevice(firstRow(rows)!);
    });
  }

  async acquireDeviceLease(
    id: string,
    leaseHolder: string,
    ttlMs: number,
    opts: { lockdown?: boolean; targetStopped?: boolean } = {},
  ): Promise<DeviceNode> {
    return this.sql.begin(async (tx) => {
      const dr = firstRow(await tx`select * from marketing.devices where id = ${id} for update`);
      if (!dr) throw new Error(`Device not found: ${id}`);
      const device = this.mapDevice(dr);
      const nowMs = this.clock.now();
      const decision = evaluateDeviceActionPolicy({
        device,
        leaseHolder,
        nowMs,
        lockdown: Boolean(opts.lockdown),
        targetStopped: Boolean(opts.targetStopped),
      });
      if (!decision.allowed) {
        throw new PolicyViolationError(
          "DEVICE_LEASE_DENIED",
          "inv_device_safety_envelope",
          `Cannot lease device ${device.label}: ${decision.reason ?? "safety envelope or lease exclusion failed"}.`,
        );
      }

      const rows = await tx`
        update marketing.devices set
          lease_holder = ${leaseHolder},
          lease_expires_at = ${new Date(nowMs + Math.max(1_000, ttlMs))},
          status = 'leased',
          last_seen_at = ${new Date(nowMs)}
        where id = ${id}
        returning *
      `;
      return this.mapDevice(firstRow(rows)!);
    });
  }

  async releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode> {
    return this.sql.begin(async (tx) => {
      const dr = firstRow(await tx`select * from marketing.devices where id = ${id} for update`);
      if (!dr) throw new Error(`Device not found: ${id}`);
      const device = this.mapDevice(dr);
      if (leaseHolder && isDeviceLeaseHeldByOther(device, leaseHolder, this.clock.now())) {
        throw new PolicyViolationError(
          "LEASE_OWNER_MISMATCH",
          "inv_device_safety_envelope",
          `Device ${device.label} is leased by ${device.leaseHolder}, not ${leaseHolder}.`,
        );
      }
      const nextStatus: DeviceStatus = device.status === "leased" ? "online" : device.status;
      const rows = await tx`
        update marketing.devices set
          lease_holder = null,
          lease_expires_at = null,
          status = ${nextStatus},
          last_seen_at = ${new Date(this.clock.now())}
        where id = ${id}
        returning *
      `;
      return this.mapDevice(firstRow(rows)!);
    });
  }

  async sweepExpiredDeviceLeases(): Promise<number> {
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      update marketing.devices set
        lease_holder = null,
        lease_expires_at = null,
        status = case when status = 'leased' then 'online' else status end
      where lease_holder is not null
        and lease_expires_at is not null
        and lease_expires_at <= ${now}
      returning id
    `;
    return allRows(rows).length;
  }

  async recordDeviceAction(input: RecordDeviceActionInput): Promise<DeviceActionReceipt> {
    return this.sql.begin(async (tx) => {
      const dr = firstRow(
        await tx`select * from marketing.devices where id = ${input.deviceId} for update`,
      );
      if (!dr) throw new Error(`Device not found: ${input.deviceId}`);
      const device = this.mapDevice(dr);
      let targetStopped = Boolean(input.targetStopped);
      if (input.targetHumanId) {
        const hr = firstRow(
          await tx`select stopped, banned, phone_hash from marketing.humans where id = ${input.targetHumanId}`,
        );
        if (hr && (asBool(hr.stopped) || asBool(hr.banned))) targetStopped = true;
        const phoneHash = asOptStr(hr?.phone_hash);
        if (!targetStopped && phoneHash && (await isGloballySuppressedPhoneHash(tx, phoneHash))) {
          targetStopped = true;
        }
      }

      const nowMs = this.clock.now();
      const decision = evaluateDeviceActionPolicy({
        device,
        leaseHolder: input.leaseHolder,
        nowMs,
        lockdown: Boolean(input.lockdown),
        targetStopped,
        challengeDetected: input.challengeDetected,
      });

      if (!decision.allowed) {
        if (input.challengeDetected && device.status !== "needs_takeover") {
          const updatedRows = await tx`
            update marketing.devices set
              status = 'needs_takeover',
              last_seen_at = ${new Date(nowMs)}
            where id = ${input.deviceId}
            returning *
          `;
          return {
            allowed: false,
            device: this.mapDevice(firstRow(updatedRows)!),
            reason: decision.reason,
          };
        }
        return { allowed: false, device, reason: decision.reason };
      }

      const rows = await tx`
        update marketing.devices set
          daily_actions_used = daily_actions_used + 1,
          daily_action_cap = ${warmupDailyCap(device.warmupDay)},
          last_seen_at = ${new Date(nowMs)}
        where id = ${input.deviceId}
        returning *
      `;
      return { allowed: true, device: this.mapDevice(firstRow(rows)!) };
    });
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccount> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const meta = JSON.stringify({ channel: input.channel, city: input.city ?? "nyc" });
    const rows = await this.sql`
      insert into marketing.channels_and_accounts (
        id, agent_id, device_id, app_id, platform, handle, city, warmup_day,
        daily_post_cap, posts_today, status, metadata, created_at, updated_at
      ) values (
        ${id}, ${input.agentId}, ${input.deviceId ?? null}, ${input.appId ?? "all"},
        ${input.channel}, ${input.handle}, ${input.city ?? "nyc"},
        ${input.warmupDay ?? 0}, ${input.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP},
        ${input.sentToday ?? 0}, ${input.status ?? "active"},
        ${meta}::text::jsonb, ${now}, ${now}
      )
      on conflict (platform, handle) do update set
        agent_id = excluded.agent_id,
        device_id = excluded.device_id,
        city = excluded.city,
        warmup_day = excluded.warmup_day,
        daily_post_cap = excluded.daily_post_cap,
        posts_today = excluded.posts_today,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapChannelAccount(firstRow(rows)!);
  }

  async getChannelAccount(id: string): Promise<ChannelAccount | null> {
    const rows = await this.sql`select * from marketing.channels_and_accounts where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapChannelAccount(r) : null;
  }

  async listChannelAccounts(
    filter?: { agentId?: string; channel?: OutreachChannel } & PaginationFilter,
  ): Promise<ChannelAccount[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.channels_and_accounts
      where (${filter?.agentId ?? null}::text is null or agent_id = ${filter?.agentId ?? null})
        and (${filter?.channel ?? null}::text is null or platform = ${filter?.channel ?? null} or metadata->>'channel' = ${filter?.channel ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapChannelAccount(r));
  }

  async upsertHuman(input: UpsertHumanInput): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const incomingAge = validPersistableAge(input.lowestAge);
    const unstop = input.unstop === true;
    const incomingStopped = unstop ? false : Boolean(input.stopped);
    const incomingBanned = Boolean(input.banned);
    const phoneHash = resolveHumanPhoneHash(input, this.hashKey);
    const meta = JSON.stringify({ channel: input.channel });

    // C-04: Atomic SQL ON CONFLICT preserves youngest age reading and STOP/ban fence.
    const rows = await this.sql`
      insert into marketing.humans (
        id, contact_key, display_name, role, source_channel, city, phone_hash,
        age_years, age_verified, stopped, stop_reason, banned,
        daily_sends_today, last_contacted_at, metadata, created_at, updated_at
      ) values (
        ${id}, ${input.handleOrEmailHmac}, ${input.displayLabel},
        ${input.role}, ${input.channel}, ${input.city ?? "nyc"}, ${phoneHash},
        ${incomingAge}, ${isAdultReading(incomingAge)},
        ${incomingStopped}, ${unstop ? null : (input.stopReason ?? null)}, ${incomingBanned},
        ${input.dailySendsToday ?? 0},
        ${input.lastContactedAt ? new Date(input.lastContactedAt) : null},
        ${meta}::text::jsonb, ${now}, ${now}
      )
      on conflict (contact_key) do update set
        display_name = excluded.display_name,
        role = excluded.role,
        city = excluded.city,
        phone_hash = coalesce(excluded.phone_hash, marketing.humans.phone_hash),
        age_years = case
          when marketing.humans.age_years is null then excluded.age_years
          when excluded.age_years is null then marketing.humans.age_years
          else least(marketing.humans.age_years, excluded.age_years)
        end,
        age_verified = (
          case
            when marketing.humans.age_years is null then excluded.age_years
            when excluded.age_years is null then marketing.humans.age_years
            else least(marketing.humans.age_years, excluded.age_years)
          end between 18 and 120
        ),
        stopped = case
          when ${unstop} then false
          else (marketing.humans.stopped or excluded.stopped)
        end,
        stop_reason = case
          when ${unstop} then null
          else coalesce(excluded.stop_reason, marketing.humans.stop_reason)
        end,
        banned = (marketing.humans.banned or excluded.banned),
        metadata = marketing.humans.metadata || excluded.metadata,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapHuman(firstRow(rows)!);
  }

  async getHuman(id: string): Promise<HumanPartner | null> {
    const rows = await this.sql`select * from marketing.humans where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapHuman(r) : null;
  }

  async getHumanByHmac(handleOrEmailHmac: string): Promise<HumanPartner | null> {
    const rows = await this.sql`select * from marketing.humans where contact_key = ${handleOrEmailHmac}`;
    const r = firstRow(rows);
    return r ? this.mapHuman(r) : null;
  }

  async getHumanPhoneHash(id: string): Promise<string | null> {
    const rows = await this.sql`select phone_hash from marketing.humans where id = ${id}`;
    const r = firstRow(rows);
    return r ? asOptStr(r.phone_hash) : null;
  }

  async isPhoneHashSuppressed(phoneHash: string): Promise<boolean> {
    return isGloballySuppressedPhoneHash(this.sql, phoneHash);
  }

  async listHumans(
    filter?: { city?: string; role?: HumanRole; stopped?: boolean } & PaginationFilter,
  ): Promise<HumanPartner[]> {
    const { limit, offset } = normalizePagination(filter);
    const stoppedParam = filter?.stopped === undefined ? null : filter.stopped;
    const rows = await this.sql`
      select * from marketing.humans
      where (${filter?.city ?? null}::text is null or city = ${filter?.city ?? null})
        and (${filter?.role ?? null}::text is null or role = ${filter?.role ?? null})
        and (${stoppedParam}::boolean is null or stopped = ${stoppedParam})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapHuman(r));
  }

  async markHumanStopped(id: string, reason: string): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      update marketing.humans set
        stopped = true,
        stop_reason = ${reason},
        stopped_at = coalesce(stopped_at, ${now}),
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    const r = firstRow(rows);
    if (!r) throw new Error(`Human not found: ${id}`);
    return this.mapHuman(r);
  }

  async markHumanBanned(id: string, reason: string): Promise<HumanPartner> {
    const now = new Date(this.clock.now());
    const rows = await this.sql`
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
    const r = firstRow(rows);
    if (!r) throw new Error(`Human not found: ${id}`);
    return this.mapHuman(r);
  }

  async recordHumanAge(id: string, age: number): Promise<HumanPartner> {
    const validAge = validPersistableAge(age);
    const now = new Date(this.clock.now());
    // Atomic youngest-reading-wins update.
    const rows = await this.sql`
      update marketing.humans set
        age_years = case
          when age_years is null then ${validAge}::smallint
          when ${validAge}::smallint is null then age_years
          else least(age_years, ${validAge}::smallint)
        end,
        age_verified = (
          case
            when age_years is null then ${validAge}::smallint
            when ${validAge}::smallint is null then age_years
            else least(age_years, ${validAge}::smallint)
          end between 18 and 120
        ),
        updated_at = ${now}
      where id = ${id}
      returning *
    `;
    const r = firstRow(rows);
    if (!r) throw new Error(`Human not found: ${id}`);
    return this.mapHuman(r);
  }

  async createTask(input: CreateTaskInput): Promise<MarketingTask> {
    const campaign = await this.getCampaign(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const payoutRail: PayoutRail = input.payoutRail ?? (input.tier >= 3 ? "fiat_stripe" : "none");
    const status: TaskStatus = input.status ?? "drafted";

    if (payoutRail === "slop_cash") {
      if (!isOssDevBounty(input.taskKind === "oss_dev_bounty")) {
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
    const effectiveAge = minAgeReading(
      human?.lowestAge,
      validPersistableAge(input.assigneeAgeYears),
    );
    if (input.tier === 4 && HIRED_OR_LATER_STATUSES.has(status)) {
      if (!isAdultReading(effectiveAge)) {
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
    const rows = await this.sql`
      insert into marketing.tasks (
        id, campaign_id, human_id, tier, task_kind, app_id, city, title, brief_text,
        vendor_channel, worker_age_years, amount_cents, qr_batch_code, short_url,
        payout_rail, proof_verified, status, metadata, created_at, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.assigneeHumanId ?? null}, ${input.tier},
        ${input.taskKind}, ${campaign.appId}, ${input.city ?? campaign.city},
        ${input.title}, ${input.briefText}, ${input.vendorChannel},
        ${effectiveAge}, ${input.amountCents ?? 0}, ${input.qrBatchCode ?? null},
        ${input.dubShortUrl ?? null}, ${payoutRail}, false,
        ${status}, '{}'::jsonb, ${now}, ${now}
      ) returning *
    `;
    return this.mapTask(firstRow(rows)!);
  }

  async getTask(id: string): Promise<MarketingTask | null> {
    const rows = await this.sql`select * from marketing.tasks where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapTask(r) : null;
  }

  async listTasks(
    filter?: {
      campaignId?: string;
      status?: TaskStatus;
      taskKind?: TaskKind;
      city?: string;
    } & PaginationFilter,
  ): Promise<MarketingTask[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.tasks
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.status ?? null}::text is null or status = ${filter?.status ?? null})
        and (${filter?.taskKind ?? null}::text is null or task_kind = ${filter?.taskKind ?? null})
        and (${filter?.city ?? null}::text is null or city = ${filter?.city ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapTask(r));
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<MarketingTask> {
    return this.sql.begin(async (tx) => {
      const tr = firstRow(await tx`select * from marketing.tasks where id = ${id} for update`);
      if (!tr) throw new Error(`Task not found: ${id}`);
      const existing = this.mapTask(tr);
      if (patch.status === "paid") {
        throw new PolicyViolationError(
          "DIRECT_PAID_FORBIDDEN",
          "inv_proof_required_before_payout",
          "Use markTaskPaid to transition a task to paid.",
        );
      }

      const nextRail = patch.payoutRail ?? existing.payoutRail;
      if (nextRail === "slop_cash") {
        if (!isOssDevBounty(existing.taskKind === "oss_dev_bounty")) {
          throw new PolicyViolationError(
            "SLOP_CASH_OSS_ONLY",
            "inv_slop_cash_disabled",
            "slop_cash payout rail is restricted strictly to oss_dev_bounty tasks.",
          );
        }
        const cr = firstRow(
          await tx`select slop_cash_enabled from marketing.campaigns where id = ${existing.campaignId}`,
        );
        if (!cr || !asBool(cr.slop_cash_enabled) || !patch.slopCashEnvEnabled) {
          throw new PolicyViolationError(
            "SLOP_CASH_DISABLED",
            "inv_slop_cash_disabled",
            "Cannot set slop_cash payout rail while slop.cash is disabled.",
          );
        }
      }

      const humanId =
        patch.assigneeHumanId !== undefined ? patch.assigneeHumanId : existing.assigneeHumanId;
      let humanAge: number | null = null;
      if (humanId) {
        const hr = firstRow(await tx`select age_years from marketing.humans where id = ${humanId}`);
        humanAge = asOptNum(hr?.age_years);
      }
      const nextAge = minAgeReading(
        existing.assigneeAgeYears,
        humanAge,
        patch.assigneeAgeYears !== undefined ? validPersistableAge(patch.assigneeAgeYears) : null,
      );
      const nextStatus = patch.status ?? existing.status;
      if (existing.tier === 4 && HIRED_OR_LATER_STATUSES.has(nextStatus)) {
        if (!isAdultReading(nextAge)) {
          throw new PolicyViolationError(
            "UNDERAGE_OR_UNKNOWN_WORKER",
            "inv_adult_only_paid",
            "Cannot hire or advance Tier 4 task without verified adult age (18..120).",
          );
        }
      }

      const now = new Date(this.clock.now());
      const rows = await tx`
        update marketing.tasks set
          title = ${patch.title ?? existing.title},
          brief_text = ${patch.briefText ?? existing.briefText},
          human_id = ${humanId},
          worker_age_years = ${nextAge},
          amount_cents = ${patch.amountCents ?? existing.amountCents},
          qr_batch_code = ${patch.qrBatchCode !== undefined ? patch.qrBatchCode : existing.qrBatchCode},
          short_url = ${patch.dubShortUrl !== undefined ? patch.dubShortUrl : existing.dubShortUrl},
          payout_rail = ${nextRail},
          proof_verified = ${patch.proofVerified ?? existing.proofVerified},
          status = ${nextStatus},
          paid_at = ${patch.paidAt !== undefined ? (patch.paidAt ? new Date(patch.paidAt) : null) : (existing.paidAt ? new Date(existing.paidAt) : null)},
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return this.mapTask(firstRow(rows)!);
    });
  }

  private async authorizeSpendInTx(
    tx: SQL,
    input: AuthorizeSpendInput,
  ): Promise<AuthorizeSpendResult> {
    // Lock campaign row FIRST to prevent idempotency/cap races (C-01 / C-02 / H-03).
    const cr = firstRow(
      await tx`select * from marketing.campaigns where id = ${input.campaignId} for update`,
    );
    if (!cr) throw new Error(`Campaign not found: ${input.campaignId}`);

    const existingEntry = firstRow(
      await tx`select * from marketing.budget_ledger where idempotency_key = ${input.idempotencyKey}`,
    );
    if (existingEntry) {
      const daily = await this.dailySpentForCampaign(tx, input.campaignId, toJsonObj(cr.metadata));
      return {
        entry: this.mapBudgetEntry(existingEntry),
        campaign: this.mapCampaign(cr, daily),
        replayed: true,
      };
    }

    const daily = await this.dailySpentForCampaign(tx, input.campaignId, toJsonObj(cr.metadata));
    const campaign = this.mapCampaign(cr, daily);

    const useSlopCash = Boolean(input.useSlopCash || input.adapterId === "slop_cash");
    let taskKind = input.taskKind;
    if (!taskKind && input.taskId) {
      const tr = firstRow(await tx`select task_kind from marketing.tasks where id = ${input.taskId}`);
      if (tr) taskKind = asStr(tr.task_kind) as TaskKind;
    }
    const fromReserve = Boolean(input.fromReserve);

    if (input.entryType === "reserve" || input.entryType === "commit") {
      assertSpendAuth({
        campaign,
        tier: input.tier,
        amountCents: input.amountCents,
        useSlopCash,
        slopCashEnvEnabled: Boolean(input.slopCashEnvEnabled),
        taskKind,
        fromReserve,
      });
    } else if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PolicyViolationError(
        "INVALID_AMOUNT",
        "inv_budget_never_exceeded",
        "Budget ledger entries require a positive integer amountCents.",
      );
    }

    let nextReserved = campaign.reservedCents;
    let nextSpent = campaign.spentCents;
    if (input.entryType === "reserve") {
      nextReserved += input.amountCents;
    } else if (input.entryType === "commit") {
      if (fromReserve) nextReserved -= input.amountCents;
      nextSpent += input.amountCents;
    } else if (input.entryType === "release") {
      nextReserved = Math.max(0, nextReserved - input.amountCents);
    } else if (input.entryType === "refund") {
      nextSpent = Math.max(0, nextSpent - input.amountCents);
    }

    const now = new Date(this.clock.now());
    const insertedRows = await tx`
      insert into marketing.budget_ledger (
        campaign_id, task_id, adapter_id, tier, amount_cents, entry_type,
        from_reserve, payout_rail, idempotency_key, external_ref, created_at
      ) values (
        ${input.campaignId}, ${input.taskId ?? null}, ${input.adapterId}, ${input.tier},
        ${input.amountCents}, ${input.entryType}, ${fromReserve},
        ${useSlopCash ? "slop_cash" : input.tier >= 3 ? "fiat_stripe" : "none"},
        ${input.idempotencyKey}, ${input.externalRef ?? null}, ${now}
      )
      on conflict (idempotency_key) do nothing
      returning *
    `;
    const inserted = firstRow(insertedRows);
    if (!inserted) {
      const replayEntry = firstRow(
        await tx`select * from marketing.budget_ledger where idempotency_key = ${input.idempotencyKey}`,
      )!;
      return {
        entry: this.mapBudgetEntry(replayEntry),
        campaign,
        replayed: true,
      };
    }

    const updatedDaily = await this.dailySpentForCampaign(tx, input.campaignId, toJsonObj(cr.metadata));
    const updatedCampaignRows = await tx`
      update marketing.campaigns set
        reserved_cents = ${nextReserved},
        spent_cents = ${nextSpent},
        daily_spent_cents = ${updatedDaily},
        updated_at = ${now}
      where id = ${input.campaignId}
      returning *
    `;
    return {
      entry: this.mapBudgetEntry(inserted),
      campaign: this.mapCampaign(firstRow(updatedCampaignRows)!, updatedDaily),
      replayed: false,
    };
  }

  async markTaskPaid(
    taskId: string,
    opts: MarkTaskPaidOptions,
  ): Promise<{ task: MarketingTask; entry: BudgetEntry; campaign: Campaign }> {
    return this.sql.begin(async (tx) => {
      // C-01: Single atomic transaction with deterministic lock order (campaign -> task).
      const lookupRow = firstRow(
        await tx`select campaign_id from marketing.tasks where id = ${taskId}`,
      );
      if (!lookupRow) throw new Error(`Task not found: ${taskId}`);
      const campaignId = asStr(lookupRow.campaign_id);

      await tx`select id from marketing.campaigns where id = ${campaignId} for update`;
      const tr = firstRow(await tx`select * from marketing.tasks where id = ${taskId} for update`);
      if (!tr) throw new Error(`Task not found: ${taskId}`);
      const task = this.mapTask(tr);

      if (task.status === "paid") {
        throw new PolicyViolationError(
          "TASK_ALREADY_PAID",
          "inv_budget_never_exceeded",
          `Task ${task.id} is already paid.`,
        );
      }
      if (task.status === "cancelled") {
        throw new PolicyViolationError(
          "TASK_CANCELLED",
          "inv_budget_never_exceeded",
          `Task ${task.id} is cancelled and cannot be paid.`,
        );
      }

      let human: HumanPartner | null = null;
      if (task.assigneeHumanId) {
        const hr = firstRow(
          await tx`select * from marketing.humans where id = ${task.assigneeHumanId}`,
        );
        if (hr) human = this.mapHuman(hr);
      }

      // H-01: Prioritize verified proofs deterministically over same-timestamp or later rejected/pending rows.
      const proofRow = firstRow(await tx`
        select * from marketing.proofs
        where task_id = ${taskId}
        order by (verifier_verdict = 'verified') desc, verified_at desc nulls last, created_at desc, id desc
        limit 1
      `);
      const bestProof = proofRow ? this.mapProof(proofRow) : null;
      assertProofAndAdultForPayoutPolicy(task, bestProof, human);

      const { entry, campaign } = await this.authorizeSpendInTx(tx, {
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
        taskKind: task.taskKind,
        fromReserve: opts.fromReserve,
      });

      const now = new Date(this.clock.now());
      const paidTaskRows = await tx`
        update marketing.tasks set
          status = 'paid',
          paid_at = ${now},
          updated_at = ${now}
        where id = ${taskId}
        returning *
      `;
      return { task: this.mapTask(firstRow(paidTaskRows)!), entry, campaign };
    });
  }

  async createProof(input: CreateProofInput): Promise<ProofSubmission> {
    return this.sql.begin(async (tx) => {
      const tr = firstRow(
        await tx`select * from marketing.tasks where id = ${input.taskId} for update`,
      );
      if (!tr) throw new Error(`Task not found: ${input.taskId}`);
      const task = this.mapTask(tr);
      const id = input.id ?? this.idGen();
      const now = new Date(this.clock.now());
      const hashes = JSON.stringify(input.checkinMediaHashes ?? []);
      const rows = await tx`
        insert into marketing.proofs (
          id, task_id, human_id, proof_kind, evidence_url, checkin_media_hashes,
          geo_time_valid, qr_scans_count, verified_signups_count, ftc_disclosed,
          likeness_releases_count, featured_interviewees_count, likeness_release_ok,
          verifier_verdict, verifier_notes, created_at
        ) values (
          ${id}, ${input.taskId}, ${task.assigneeHumanId}, ${input.proofKind},
          ${input.evidenceUrl ?? null}, ${hashes}::text::jsonb,
          ${input.geoTimeValid ?? false}, ${input.qrScansCount ?? 0},
          ${input.verifiedSignupsCount ?? 0}, ${input.ftcDisclosed ?? false},
          ${input.likenessReleaseOk ? 1 : 0}, ${input.proofKind === "creator_video" ? 1 : 0},
          ${input.likenessReleaseOk ?? false}, 'pending', ${input.verifierNotes ?? null}, ${now}
        ) returning *
      `;
      const canMarkSubmitted =
        task.status !== "paid" &&
        task.status !== "cancelled" &&
        task.status !== "proof_verified" &&
        task.status !== "payout_queued" &&
        (task.tier < 4 || isAdultReading(task.assigneeAgeYears));
      if (canMarkSubmitted) {
        await tx`
          update marketing.tasks set status = 'proof_submitted', updated_at = ${now}
          where id = ${input.taskId}
        `;
      }
      return this.mapProof(firstRow(rows)!);
    });
  }

  async getProof(id: string): Promise<ProofSubmission | null> {
    const rows = await this.sql`select * from marketing.proofs where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapProof(r) : null;
  }

  async listProofs(
    filter?: { taskId?: string; verdict?: ProofVerdict } & PaginationFilter,
  ): Promise<ProofSubmission[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.proofs
      where (${filter?.taskId ?? null}::text is null or task_id = ${filter?.taskId ?? null})
        and (${filter?.verdict ?? null}::text is null or verifier_verdict = ${filter?.verdict ?? null})
      order by (verifier_verdict = 'verified') desc, verified_at desc nulls last, created_at desc, id desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapProof(r));
  }

  async evaluateProof(proofId: string, opts: EvaluateProofOptions): Promise<EvaluateProofResult> {
    return this.sql.begin(async (tx) => {
      const prLookup = firstRow(
        await tx`select * from marketing.proofs where id = ${proofId} for update`,
      );
      if (!prLookup) throw new Error(`Proof not found: ${proofId}`);
      const proof = this.mapProof(prLookup);

      const tr = firstRow(
        await tx`select * from marketing.tasks where id = ${proof.taskId} for update`,
      );
      if (!tr) throw new Error(`Task not found: ${proof.taskId}`);
      const task = this.mapTask(tr);

      let human: HumanPartner | null = null;
      if (task.assigneeHumanId) {
        const hr = firstRow(
          await tx`select * from marketing.humans where id = ${task.assigneeHumanId}`,
        );
        if (hr) human = this.mapHuman(hr);
      }

      const incomingValidAge = validPersistableAge(opts.workerAge);
      const effectiveAge = minAgeReading(incomingValidAge, task.assigneeAgeYears, human?.lowestAge);
      const workerBanned = Boolean(opts.workerBanned || human?.banned);
      const decision = evaluateProofPolicy({
        proof,
        workerAge: effectiveAge,
        workerBanned,
        shiftDone: opts.shiftDone,
      });

      const now = new Date(this.clock.now());
      const notes =
        opts.verifierNotes ??
        (decision.approved
          ? "Approved by proved marketingPolicy.canApproveCreatorProof"
          : `Rejected: ${decision.reason ?? "proof_rejected"}`);

      const updatedPr = firstRow(await tx`
        update marketing.proofs set
          verifier_verdict = ${decision.approved ? "verified" : "rejected"},
          verifier_notes = ${notes},
          verified_at = ${decision.approved ? now : null}
        where id = ${proofId}
        returning *
      `)!;

      const immutableTerminal = task.status === "paid" || task.status === "cancelled";
      if (immutableTerminal) {
        return {
          proof: this.mapProof(updatedPr),
          task,
          approved: decision.approved,
          ...(decision.reason ? { reason: decision.reason } : {}),
        };
      }

      // C-04 / H-05: Never persist -1 into worker_age_years CHECK(0..120); store null when unknown.
      const persistAge = minAgeReading(task.assigneeAgeYears, incomingValidAge);
      let hasVerifiedProof = decision.approved;
      if (!hasVerifiedProof && !workerBanned && isAdultReading(effectiveAge)) {
        const verifiedCheck = firstRow(await tx`
          select 1 as ok from marketing.proofs
          where task_id = ${task.id} and verifier_verdict = 'verified'
          limit 1
        `);
        hasVerifiedProof = Boolean(verifiedCheck);
      }
      const nextStatus: TaskStatus = hasVerifiedProof
        ? task.status === "payout_queued"
          ? "payout_queued"
          : "proof_verified"
        : "disputed";
      const updatedTr = firstRow(await tx`
        update marketing.tasks set
          worker_age_years = ${persistAge},
          proof_verified = ${hasVerifiedProof},
          status = ${nextStatus},
          updated_at = ${now}
        where id = ${task.id}
        returning *
      `)!;

      return {
        proof: this.mapProof(updatedPr),
        task: this.mapTask(updatedTr),
        approved: decision.approved,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
    });
  }

  async createOutreachMessage(input: CreateOutreachInput): Promise<OutreachMessage> {
    return this.sql.begin(async (tx) => {
      const cr = firstRow(
        await tx`select risk_dial from marketing.campaigns where id = ${input.campaignId}`,
      );
      if (!cr) throw new Error(`Campaign not found: ${input.campaignId}`);
      const hr = firstRow(
        await tx`select * from marketing.humans where id = ${input.humanId} for update`,
      );
      if (!hr) throw new Error(`Human not found: ${input.humanId}`);
      const human = this.mapHuman(hr);

      let account: ChannelAccount | null = null;
      if (input.channelAccountId) {
        const ar = firstRow(
          await tx`select * from marketing.channels_and_accounts where id = ${input.channelAccountId} for update`,
        );
        if (ar) account = this.mapChannelAccount(ar);
      }

      const sentToday = account ? account.sentToday : human.dailySendsToday;
      const dailyOutreachCap =
        input.dailyOutreachCap ?? account?.dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP;
      const phoneHash = input.phoneHash?.trim() || asOptStr(hr.phone_hash);
      const globallySuppressed = phoneHash
        ? await isGloballySuppressedPhoneHash(tx, phoneHash)
        : false;
      const decision = evaluateOutreachPolicy({
        human: globallySuppressed ? { ...human, stopped: true } : human,
        lockdown: asStr(cr.risk_dial) === "lockdown",
        leakCheckPass: input.leakCheckPass,
        sentToday,
        dailyOutreachCap,
      });

      const status: OutreachStatus = decision.allowed
        ? (input.desiredStatus ?? "queued")
        : (decision.blockedStatus ?? "blocked_policy");

      const id = input.id ?? this.idGen();
      const now = new Date(this.clock.now());
      const bodyText = input.bodySummary.trim().length > 0 ? input.bodySummary : "(empty)";
      const r = firstRow(await tx`
        insert into marketing.outreach_messages (
          id, campaign_id, agent_id, human_id, channel, tier, direction,
          template_id, subject, body_text, leak_check_pass, external_message_id,
          status, sent_at, created_at
        ) values (
          ${id}, ${input.campaignId}, ${input.agentId}, ${input.humanId},
          ${input.channel}, ${input.tier}, 'outbound',
          ${`ch:${input.channel}`}, ${input.subject ?? null}, ${bodyText},
          ${input.leakCheckPass}, ${input.externalRef ?? null},
          ${status}, ${status === "sent" || status === "delivered" ? now : null}, ${now}
        ) returning *
      `)!;

      if (status === "sent" || status === "delivered") {
        await tx`
          update marketing.humans set
            daily_sends_today = daily_sends_today + 1,
            last_contacted_at = ${now},
            updated_at = ${now}
          where id = ${human.id}
        `;
        if (account) {
          await tx`
            update marketing.channels_and_accounts set
              posts_today = posts_today + 1,
              updated_at = ${now}
            where id = ${account.id}
          `;
        }
      }

      return this.mapOutreach(r);
    });
  }

  async listOutreachMessages(
    filter?: {
      campaignId?: string;
      humanId?: string;
      agentId?: string;
      status?: OutreachStatus;
    } & PaginationFilter,
  ): Promise<OutreachMessage[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.outreach_messages
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.humanId ?? null}::text is null or human_id = ${filter?.humanId ?? null})
        and (${filter?.agentId ?? null}::text is null or agent_id = ${filter?.agentId ?? null})
        and (${filter?.status ?? null}::text is null or status = ${filter?.status ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapOutreach(r));
  }

  async updateOutreachStatus(
    id: string,
    status: OutreachStatus,
    externalRef?: string | null,
    dailyOutreachCap?: number,
  ): Promise<OutreachMessage> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.outreach_messages where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`Outreach message not found: ${id}`);
      const existing = this.mapOutreach(existingRow);
      const now = new Date(this.clock.now());

      let finalStatus = status;
      if (status === "sent" || status === "delivered") {
        const cr = firstRow(
          await tx`select risk_dial from marketing.campaigns where id = ${existing.campaignId}`,
        );
        const hr = firstRow(
          await tx`select * from marketing.humans where id = ${existing.humanId} for update`,
        );
        if (!cr || !hr) throw new Error("Missing campaign or human for outreach send");
        const human = this.mapHuman(hr);
        const phoneHash = asOptStr(hr.phone_hash);
        const globallySuppressed = phoneHash
          ? await isGloballySuppressedPhoneHash(tx, phoneHash)
          : false;
        const decision = evaluateOutreachPolicy({
          human: globallySuppressed ? { ...human, stopped: true } : human,
          lockdown: asStr(cr.risk_dial) === "lockdown",
          leakCheckPass: existing.leakCheckPass,
          dailyOutreachCap: dailyOutreachCap ?? DEFAULT_DAILY_OUTREACH_CAP,
        });
        if (!decision.allowed) {
          finalStatus = decision.blockedStatus ?? "blocked_policy";
        } else if (existing.status !== "sent" && existing.status !== "delivered") {
          await tx`
            update marketing.humans set
              daily_sends_today = daily_sends_today + 1,
              last_contacted_at = ${now},
              updated_at = ${now}
            where id = ${human.id}
          `;
        }
      }

      const r = firstRow(await tx`
        update marketing.outreach_messages set
          status = ${finalStatus},
          external_message_id = ${externalRef !== undefined ? externalRef : existing.externalRef},
          sent_at = ${finalStatus === "sent" || finalStatus === "delivered" ? now : (existingRow.sent_at as Date | null)}
        where id = ${id}
        returning *
      `)!;
      return this.mapOutreach(r);
    });
  }

  async recordAttributionEvent(input: CreateAttributionEventInput): Promise<AttributionEvent> {
    const campaign = await this.getCampaign(input.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${input.campaignId}`);
    const now = new Date(this.clock.now());
    const count = input.count ?? 1;
    const meta = JSON.stringify(input.metadata ?? {});
    const rows = await this.sql`
      insert into marketing.attribution_events (
        campaign_id, task_id, qr_batch_code, app_id, city, event_type,
        count, is_adult_verified, metadata, occurred_at, created_at
      ) values (
        ${input.campaignId}, ${input.taskId ?? null},
        ${input.qrBatchCode ?? null}, ${input.appId},
        ${input.city ?? campaign.city}, ${input.eventKind},
        ${count}, ${input.eventKind === "signup_verified_adult"}, ${meta}::text::jsonb, ${now}, ${now}
      ) returning *
    `;
    return this.mapAttribution(firstRow(rows)!);
  }

  async listAttributionEvents(
    filter?: {
      campaignId?: string;
      taskId?: string;
      qrBatchCode?: string;
      appId?: BrandAppId;
    } & PaginationFilter,
  ): Promise<AttributionEvent[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.attribution_events
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.taskId ?? null}::text is null or task_id = ${filter?.taskId ?? null})
        and (${filter?.qrBatchCode ?? null}::text is null or qr_batch_code = ${filter?.qrBatchCode ?? null})
        and (${filter?.appId ?? null}::text is null or app_id = ${filter?.appId ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapAttribution(r));
  }

  async authorizeSpend(input: AuthorizeSpendInput): Promise<AuthorizeSpendResult> {
    try {
      return await this.sql.begin((tx) => this.authorizeSpendInTx(tx, input));
    } catch (err) {
      // C-02 / H-03: Graceful recovery if a concurrent unique conflict (23505) on idempotency_key occurs.
      if (isPgUniqueViolation(err)) {
        const existingEntry = firstRow(
          await this.sql`select * from marketing.budget_ledger where idempotency_key = ${input.idempotencyKey}`,
        );
        if (existingEntry) {
          const campaign = await this.getCampaign(asStr(existingEntry.campaign_id));
          if (campaign) {
            return {
              entry: this.mapBudgetEntry(existingEntry),
              campaign,
              replayed: true,
            };
          }
        }
      }
      throw err;
    }
  }

  async listBudgetEntries(
    filter?: {
      campaignId?: string;
      taskId?: string;
      entryType?: BudgetEntryType;
    } & PaginationFilter,
  ): Promise<BudgetEntry[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.budget_ledger
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.taskId ?? null}::text is null or task_id = ${filter?.taskId ?? null})
        and (${filter?.entryType ?? null}::text is null or entry_type = ${filter?.entryType ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapBudgetEntry(r));
  }

  async upsertSlopCashHook(input: UpsertSlopCashHookInput): Promise<SlopCashHook> {
    const enabled = Boolean(input.enabled);
    const hookState: SlopCashHookState = enabled
      ? (input.hookState ?? "ready_for_sync")
      : "disabled_stub";
    const now = new Date(this.clock.now());
    const id = input.id ?? this.idGen();
    const rows = await this.sql`
      insert into marketing.slop_cash_hooks (
        id, task_id, repo_slug, issue_number, vault_chain,
        estimated_usdc_cents, enabled, hook_state, external_tx_hash,
        created_at, updated_at
      ) values (
        ${id}, ${input.taskId}, ${input.repoSlug ?? DEFAULT_SLOP_CASH_REPO},
        ${input.issueNumber ?? null}, ${input.vaultChain ?? DEFAULT_SLOP_CASH_CHAIN},
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
    return this.mapSlopCashHook(firstRow(rows)!);
  }

  async getSlopCashHookByTask(taskId: string): Promise<SlopCashHook | null> {
    const rows = await this.sql`select * from marketing.slop_cash_hooks where task_id = ${taskId}`;
    const r = firstRow(rows);
    return r ? this.mapSlopCashHook(r) : null;
  }

  async listSlopCashHooks(filter?: PaginationFilter): Promise<SlopCashHook[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.slop_cash_hooks
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapSlopCashHook(r));
  }

  // ---- Pass-2 CRUD (Postgres) ----

  async upsertBanditArm(input: UpsertBanditArmInput): Promise<BanditArm> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.bandit_arms (
        id, campaign_id, arm_key, label, track, alpha, beta, weight,
        spend_cents, signups, stop_events, total_contacts, status, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.armKey}, ${input.label}, ${input.track},
        ${input.alpha ?? 1}, ${input.beta ?? 1}, ${input.weight ?? 0},
        ${input.spendCents ?? 0}, ${input.signups ?? 0}, ${input.stopEvents ?? 0},
        ${input.totalContacts ?? 0}, ${input.status ?? "active"}, ${now}
      )
      on conflict (campaign_id, arm_key) do update set
        label = excluded.label,
        track = excluded.track,
        alpha = excluded.alpha,
        beta = excluded.beta,
        weight = excluded.weight,
        spend_cents = excluded.spend_cents,
        signups = excluded.signups,
        stop_events = excluded.stop_events,
        total_contacts = excluded.total_contacts,
        status = excluded.status,
        updated_at = excluded.updated_at
      returning *
    `;
    return this.mapBanditArm(firstRow(rows)!);
  }

  async getBanditArm(id: string): Promise<BanditArm | null> {
    const rows = await this.sql`select * from marketing.bandit_arms where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapBanditArm(r) : null;
  }

  async listBanditArms(
    filter?: string | ({ campaignId?: string; status?: BanditArmStatus } & PaginationFilter),
  ): Promise<BanditArm[]> {
    const normalized = typeof filter === "string" ? { campaignId: filter } : filter;
    const { limit, offset } = normalizePagination(normalized);
    const rows = await this.sql`
      select * from marketing.bandit_arms
      where (${normalized?.campaignId ?? null}::text is null or campaign_id = ${normalized?.campaignId ?? null})
        and (${normalized?.status ?? null}::text is null or status = ${normalized?.status ?? null})
      order by weight desc, arm_key asc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapBanditArm(r));
  }

  async updateBanditArm(id: string, patch: UpdateBanditArmInput): Promise<BanditArm> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.bandit_arms where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`Bandit arm not found: ${id}`);
      const existing = this.mapBanditArm(existingRow);
      const now = new Date(this.clock.now());
      const rows = await tx`
        update marketing.bandit_arms set
          label = ${patch.label ?? existing.label},
          alpha = ${patch.alpha ?? existing.alpha},
          beta = ${patch.beta ?? existing.beta},
          weight = ${patch.weight ?? existing.weight},
          spend_cents = ${patch.spendCents ?? existing.spendCents},
          signups = ${patch.signups ?? existing.signups},
          stop_events = ${patch.stopEvents ?? existing.stopEvents},
          total_contacts = ${patch.totalContacts ?? existing.totalContacts},
          status = ${patch.status ?? existing.status},
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return this.mapBanditArm(firstRow(rows)!);
    });
  }

  async createBdDeal(input: CreateBdDealInput): Promise<BdDeal> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.bd_deals (
        id, campaign_id, city, venue_name, vertical, contact_email, business_phone,
        stage, offered_cents, phone_callback_verified, contract_hash, qr_batch_id,
        notes, created_at, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.city ?? "nyc"}, ${input.venueName},
        ${input.vertical}, ${input.contactEmail ?? null}, ${input.businessPhone ?? null},
        ${input.stage ?? "prospect"}, ${input.offeredCents ?? 0},
        ${input.phoneCallbackVerified ?? false}, ${input.contractHash ?? null},
        ${input.qrBatchId ?? null}, ${input.notes ?? null}, ${now}, ${now}
      ) returning *
    `;
    return this.mapBdDeal(firstRow(rows)!);
  }

  async getBdDeal(id: string): Promise<BdDeal | null> {
    const rows = await this.sql`select * from marketing.bd_deals where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapBdDeal(r) : null;
  }

  async listBdDeals(
    filter?: { campaignId?: string; city?: string; stage?: BdDealStage } & PaginationFilter,
  ): Promise<BdDeal[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.bd_deals
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.city ?? null}::text is null or city = ${filter?.city ?? null})
        and (${filter?.stage ?? null}::text is null or stage = ${filter?.stage ?? null})
      order by updated_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapBdDeal(r));
  }

  async updateBdDeal(id: string, patch: UpdateBdDealInput): Promise<BdDeal> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.bd_deals where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`BD deal not found: ${id}`);
      const existing = this.mapBdDeal(existingRow);
      const now = new Date(this.clock.now());
      const rows = await tx`
        update marketing.bd_deals set
          venue_name = ${patch.venueName ?? existing.venueName},
          vertical = ${patch.vertical ?? existing.vertical},
          contact_email = ${patch.contactEmail !== undefined ? patch.contactEmail : existing.contactEmail},
          business_phone = ${patch.businessPhone !== undefined ? patch.businessPhone : existing.businessPhone},
          stage = ${patch.stage ?? existing.stage},
          offered_cents = ${patch.offeredCents ?? existing.offeredCents},
          phone_callback_verified = ${patch.phoneCallbackVerified ?? existing.phoneCallbackVerified},
          contract_hash = ${patch.contractHash !== undefined ? patch.contractHash : existing.contractHash},
          qr_batch_id = ${patch.qrBatchId !== undefined ? patch.qrBatchId : existing.qrBatchId},
          notes = ${patch.notes !== undefined ? patch.notes : existing.notes},
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return this.mapBdDeal(firstRow(rows)!);
    });
  }

  async createQrBatch(input: CreateQrBatchInput): Promise<QrBatch> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.qr_batches (
        id, campaign_id, city, batch_code, destination_url, dub_link_id,
        print_qty, assigned_to_type, assigned_to_id, scans, verified_signups, created_at
      ) values (
        ${id}, ${input.campaignId}, ${input.city ?? "nyc"}, ${input.batchCode},
        ${input.destinationUrl}, ${input.dubLinkId ?? null}, ${input.printQty ?? 0},
        ${input.assignedToType ?? null}, ${input.assignedToId ?? null},
        ${input.scans ?? 0}, ${input.verifiedSignups ?? 0}, ${now}
      ) returning *
    `;
    return this.mapQrBatch(firstRow(rows)!);
  }

  async getQrBatch(id: string): Promise<QrBatch | null> {
    const rows = await this.sql`select * from marketing.qr_batches where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapQrBatch(r) : null;
  }

  async getQrBatchByCode(batchCode: string): Promise<QrBatch | null> {
    const rows = await this.sql`select * from marketing.qr_batches where batch_code = ${batchCode}`;
    const r = firstRow(rows);
    return r ? this.mapQrBatch(r) : null;
  }

  async listQrBatches(
    filter?: {
      campaignId?: string;
      city?: string;
      assignedToType?: QrBatchAssigneeType;
    } & PaginationFilter,
  ): Promise<QrBatch[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.qr_batches
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.city ?? null}::text is null or city = ${filter?.city ?? null})
        and (${filter?.assignedToType ?? null}::text is null or assigned_to_type = ${filter?.assignedToType ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapQrBatch(r));
  }

  async updateQrBatch(id: string, patch: UpdateQrBatchInput): Promise<QrBatch> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.qr_batches where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`QR batch not found: ${id}`);
      const existing = this.mapQrBatch(existingRow);
      const rows = await tx`
        update marketing.qr_batches set
          destination_url = ${patch.destinationUrl ?? existing.destinationUrl},
          dub_link_id = ${patch.dubLinkId !== undefined ? patch.dubLinkId : existing.dubLinkId},
          print_qty = ${patch.printQty ?? existing.printQty},
          assigned_to_type = ${patch.assignedToType !== undefined ? patch.assignedToType : existing.assignedToType},
          assigned_to_id = ${patch.assignedToId !== undefined ? patch.assignedToId : existing.assignedToId},
          scans = ${patch.scans ?? existing.scans},
          verified_signups = ${patch.verifiedSignups ?? existing.verifiedSignups}
        where id = ${id}
        returning *
      `;
      return this.mapQrBatch(firstRow(rows)!);
    });
  }

  async createVipProspect(input: CreateVipProspectInput): Promise<VipProspect> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.vip_prospects (
        id, campaign_id, city, name, archetype, organization, public_source,
        source_url, prestige_score, contact_email, invite_draft, status,
        created_at, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.city ?? "nyc"}, ${input.name},
        ${input.archetype}, ${input.organization ?? null}, ${input.publicSource},
        ${input.sourceUrl ?? null}, ${input.prestigeScore ?? 0},
        ${input.contactEmail ?? null}, ${input.inviteDraft ?? null},
        ${input.status ?? "discovered"}, ${now}, ${now}
      ) returning *
    `;
    return this.mapVipProspect(firstRow(rows)!);
  }

  async getVipProspect(id: string): Promise<VipProspect | null> {
    const rows = await this.sql`select * from marketing.vip_prospects where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapVipProspect(r) : null;
  }

  async listVipProspects(
    filter?: {
      campaignId?: string;
      city?: string;
      archetype?: string;
      status?: VipProspectStatus;
    } & PaginationFilter,
  ): Promise<VipProspect[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.vip_prospects
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.city ?? null}::text is null or city = ${filter?.city ?? null})
        and (${filter?.archetype ?? null}::text is null or archetype = ${filter?.archetype ?? null})
        and (${filter?.status ?? null}::text is null or status = ${filter?.status ?? null})
      order by prestige_score desc, updated_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapVipProspect(r));
  }

  async updateVipProspect(id: string, patch: UpdateVipProspectInput): Promise<VipProspect> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.vip_prospects where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`VIP prospect not found: ${id}`);
      const existing = this.mapVipProspect(existingRow);
      const now = new Date(this.clock.now());
      const rows = await tx`
        update marketing.vip_prospects set
          archetype = ${patch.archetype ?? existing.archetype},
          organization = ${patch.organization !== undefined ? patch.organization : existing.organization},
          source_url = ${patch.sourceUrl !== undefined ? patch.sourceUrl : existing.sourceUrl},
          prestige_score = ${patch.prestigeScore ?? existing.prestigeScore},
          contact_email = ${patch.contactEmail !== undefined ? patch.contactEmail : existing.contactEmail},
          invite_draft = ${patch.inviteDraft !== undefined ? patch.inviteDraft : existing.inviteDraft},
          status = ${patch.status ?? existing.status},
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return this.mapVipProspect(firstRow(rows)!);
    });
  }

  async createVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.video_assets (
        id, campaign_id, agent_id, title, hook, script, stage, video_url,
        platform, views, retention_3s_pct, signups, ftc_disclosed,
        created_at, updated_at
      ) values (
        ${id}, ${input.campaignId}, ${input.agentId ?? null}, ${input.title},
        ${input.hook}, ${input.script}, ${input.stage ?? "trend"},
        ${input.videoUrl ?? null}, ${input.platform ?? null},
        ${input.views ?? 0}, ${input.retention3sPct ?? 0}, ${input.signups ?? 0},
        ${input.ftcDisclosed ?? false}, ${now}, ${now}
      ) returning *
    `;
    return this.mapVideoAsset(firstRow(rows)!);
  }

  async getVideoAsset(id: string): Promise<VideoAsset | null> {
    const rows = await this.sql`select * from marketing.video_assets where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapVideoAsset(r) : null;
  }

  async listVideoAssets(
    filter?: { campaignId?: string; agentId?: string; stage?: VideoAssetStage } & PaginationFilter,
  ): Promise<VideoAsset[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.video_assets
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.agentId ?? null}::text is null or agent_id = ${filter?.agentId ?? null})
        and (${filter?.stage ?? null}::text is null or stage = ${filter?.stage ?? null})
      order by updated_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapVideoAsset(r));
  }

  async updateVideoAsset(id: string, patch: UpdateVideoAssetInput): Promise<VideoAsset> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.video_assets where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`Video asset not found: ${id}`);
      const existing = this.mapVideoAsset(existingRow);
      const now = new Date(this.clock.now());
      const rows = await tx`
        update marketing.video_assets set
          agent_id = ${patch.agentId !== undefined ? patch.agentId : existing.agentId},
          title = ${patch.title ?? existing.title},
          hook = ${patch.hook ?? existing.hook},
          script = ${patch.script ?? existing.script},
          stage = ${patch.stage ?? existing.stage},
          video_url = ${patch.videoUrl !== undefined ? patch.videoUrl : existing.videoUrl},
          platform = ${patch.platform !== undefined ? patch.platform : existing.platform},
          views = ${patch.views ?? existing.views},
          retention_3s_pct = ${patch.retention3sPct ?? existing.retention3sPct},
          signups = ${patch.signups ?? existing.signups},
          ftc_disclosed = ${patch.ftcDisclosed ?? existing.ftcDisclosed},
          updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return this.mapVideoAsset(firstRow(rows)!);
    });
  }

  async createAntiFraudClaim(input: CreateAntiFraudClaimInput): Promise<AntiFraudClaim> {
    const id = input.id ?? this.idGen();
    const now = new Date(this.clock.now());
    const rows = await this.sql`
      insert into marketing.antifraud_claims (
        id, campaign_id, person_key, worker_id, task_id, phone_line_type,
        media_hash, cluster_id, vesting_tier, amount_cents, status, reason, created_at
      ) values (
        ${id}, ${input.campaignId}, ${input.personKey}, ${input.workerId ?? null},
        ${input.taskId ?? null}, ${input.phoneLineType ?? "unknown"},
        ${input.mediaHash ?? null}, ${input.clusterId ?? null},
        ${input.vestingTier ?? 1}, ${input.amountCents},
        ${input.status ?? "vesting"}, ${input.reason ?? null}, ${now}
      ) returning *
    `;
    return this.mapAntiFraudClaim(firstRow(rows)!);
  }

  async getAntiFraudClaim(id: string): Promise<AntiFraudClaim | null> {
    const rows = await this.sql`select * from marketing.antifraud_claims where id = ${id}`;
    const r = firstRow(rows);
    return r ? this.mapAntiFraudClaim(r) : null;
  }

  async listAntiFraudClaims(
    filter?: {
      campaignId?: string;
      personKey?: string;
      workerId?: string;
      status?: AntiFraudClaimStatus;
    } & PaginationFilter,
  ): Promise<AntiFraudClaim[]> {
    const { limit, offset } = normalizePagination(filter);
    const rows = await this.sql`
      select * from marketing.antifraud_claims
      where (${filter?.campaignId ?? null}::text is null or campaign_id = ${filter?.campaignId ?? null})
        and (${filter?.personKey ?? null}::text is null or person_key = ${filter?.personKey ?? null})
        and (${filter?.workerId ?? null}::text is null or worker_id = ${filter?.workerId ?? null})
        and (${filter?.status ?? null}::text is null or status = ${filter?.status ?? null})
      order by created_at desc
      limit ${limit} offset ${offset}
    `;
    return allRows(rows).map((r) => this.mapAntiFraudClaim(r));
  }

  async updateAntiFraudClaim(
    id: string,
    patch: UpdateAntiFraudClaimInput,
  ): Promise<AntiFraudClaim> {
    return this.sql.begin(async (tx) => {
      const existingRow = firstRow(
        await tx`select * from marketing.antifraud_claims where id = ${id} for update`,
      );
      if (!existingRow) throw new Error(`Anti-fraud claim not found: ${id}`);
      const existing = this.mapAntiFraudClaim(existingRow);
      const rows = await tx`
        update marketing.antifraud_claims set
          cluster_id = ${patch.clusterId !== undefined ? patch.clusterId : existing.clusterId},
          vesting_tier = ${patch.vestingTier ?? existing.vestingTier},
          amount_cents = ${patch.amountCents ?? existing.amountCents},
          status = ${patch.status ?? existing.status},
          reason = ${patch.reason !== undefined ? patch.reason : existing.reason}
        where id = ${id}
        returning *
      `;
      return this.mapAntiFraudClaim(firstRow(rows)!);
    });
  }

  async getAnnualWorkerPaidCents(workerId: string, year: number): Promise<number> {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const rows = await this.sql`
      select (
        coalesce((
          select sum(amount_cents)::bigint
          from marketing.tasks
          where human_id = ${workerId}
            and status = 'paid'
            and paid_at >= ${start}
            and paid_at < ${end}
        ), 0) +
        coalesce((
          select sum(amount_cents)::bigint
          from marketing.antifraud_claims
          where worker_id = ${workerId}
            and status = 'approved'
            and task_id is null
            and created_at >= ${start}
            and created_at < ${end}
        ), 0)
      )::int as total
    `;
    return asNum(firstRow(rows)?.total);
  }

  async getLifetimePersonBonusCents(personKey: string): Promise<number> {
    const rows = await this.sql`
      select coalesce(sum(amount_cents), 0)::int as total
      from marketing.antifraud_claims
      where person_key = ${personKey}
        and status in ('approved', 'vesting')
    `;
    return asNum(firstRow(rows)?.total);
  }

  async hasMediaHash(mediaHash: string, excludeTaskId?: string): Promise<boolean> {
    const target = mediaHash.trim();
    if (!target) return false;
    const rows = await this.sql`
      select (
        exists(
          select 1 from marketing.antifraud_claims
          where media_hash = ${target}
            and (${excludeTaskId ?? null}::text is null or task_id is distinct from ${excludeTaskId ?? null})
        )
        or exists(
          select 1 from marketing.proofs
          where jsonb_typeof(checkin_media_hashes) = 'array'
            and checkin_media_hashes @> jsonb_build_array(${target}::text)
            and (${excludeTaskId ?? null}::text is null or task_id is distinct from ${excludeTaskId ?? null})
        )
      ) as found
    `;
    return asBool(firstRow(rows)?.found);
  }

  async resetDailyCounters(): Promise<void> {
    const nowIso = isoNow(this.clock);
    const now = new Date(this.clock.now());
    const resetMeta = JSON.stringify({ dailyResetAt: nowIso });
    await this.sql.begin(async (tx) => {
      await tx`
        update marketing.campaigns
        set daily_spent_cents = 0,
            metadata = metadata || ${resetMeta}::text::jsonb,
            updated_at = ${now}
      `;
      await tx`
        update marketing.agents
        set turns_used_today = 0,
            cooldown_until = case when status in ('rate_limited', 'cooldown') then null else cooldown_until end,
            status = case when status in ('rate_limited', 'cooldown') then 'idle' else status end,
            updated_at = ${now}
      `;
      await tx`update marketing.devices set daily_actions_used = 0`;
      await tx`update marketing.channels_and_accounts set posts_today = 0, updated_at = ${now}`;
      await tx`update marketing.humans set daily_sends_today = 0, updated_at = ${now}`;
    });
  }

  async getOverview(campaignId?: string): Promise<MarketingOverview> {
    const cid = campaignId ?? null;
    const dayStart = new Date(utcDayStartIso(this.clock));
    // C-08: Single SQL CTE aggregate query — zero N+1, zero full-table row loads!
    const rows = await this.sql`
      with
      camp_daily as (
        select
          c.id,
          c.status,
          c.billing_armed,
          c.risk_dial,
          c.slop_cash_enabled,
          c.monthly_budget_cents,
          c.daily_cap_cents,
          c.reserved_cents,
          c.spent_cents,
          greatest(0, coalesce(d.added, 0) - coalesce(d.reduced, 0))::int as daily_spent_cents
        from marketing.campaigns c
        left join lateral (
          select
            sum(case
              when bl.entry_type = 'reserve' or (bl.entry_type = 'commit' and bl.from_reserve = false)
              then bl.amount_cents else 0 end) as added,
            sum(case when bl.entry_type in ('release', 'refund') then bl.amount_cents else 0 end) as reduced
          from marketing.budget_ledger bl
          where bl.campaign_id = c.id
            and bl.created_at >= greatest(
              ${dayStart},
              coalesce((c.metadata->>'dailyResetAt')::timestamptz, ${dayStart})
            )
        ) d on true
        where (${cid}::text is null or c.id = ${cid})
      ),
      camp_agg as (
        select
          count(*)::int as total,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where billing_armed)::int as billing_armed_count,
          count(*) filter (where risk_dial = 'lockdown')::int as lockdown_count,
          count(*) filter (where slop_cash_enabled)::int as slop_cash_enabled_count,
          coalesce(sum(monthly_budget_cents), 0)::bigint as monthly_budget_cents,
          coalesce(sum(daily_cap_cents), 0)::bigint as daily_cap_cents,
          coalesce(sum(reserved_cents), 0)::bigint as reserved_cents,
          coalesce(sum(spent_cents), 0)::bigint as spent_cents,
          coalesce(sum(daily_spent_cents), 0)::bigint as daily_spent_cents
        from camp_daily
      ),
      agent_agg as (
        select
          count(*)::int as total,
          count(*) filter (where session_healthy and status <> 'paused_stop')::int as healthy,
          count(*) filter (where status = 'paused_stop')::int as paused,
          count(*) filter (where status in ('rate_limited', 'cooldown'))::int as rate_limited,
          coalesce(sum(turns_used_today), 0)::int as turns_used_today,
          coalesce(sum(daily_turn_cap), 0)::int as daily_turn_cap_total,
          count(*) filter (where provider = 'chatgpt')::int as prov_chatgpt,
          count(*) filter (where provider = 'claude')::int as prov_claude,
          count(*) filter (where provider = 'gemini')::int as prov_gemini,
          count(*) filter (where provider = 'surplus')::int as prov_surplus
        from marketing.agents
      ),
      device_agg as (
        select
          count(*)::int as total,
          count(*) filter (where status in ('online', 'leased'))::int as online,
          count(*) filter (where status = 'leased')::int as leased,
          count(*) filter (where status = 'needs_takeover')::int as needs_takeover,
          coalesce(sum(daily_actions_used), 0)::int as actions_used_today
        from marketing.devices
      ),
      human_agg as (
        select
          count(*)::int as total,
          count(*) filter (where stopped)::int as stopped,
          count(*) filter (where banned)::int as banned,
          count(*) filter (where age_years between 18 and 120)::int as verified_adults
        from marketing.humans
      ),
      task_agg as (
        select
          count(*)::int as total,
          count(*) filter (where status not in ('paid', 'cancelled'))::int as open,
          count(*) filter (where proof_verified)::int as proof_verified,
          count(*) filter (where status = 'paid')::int as paid,
          count(*) filter (where status = 'disputed')::int as disputed
        from marketing.tasks
        where (${cid}::text is null or campaign_id = ${cid})
      ),
      proof_agg as (
        select
          count(*)::int as total,
          count(*) filter (where p.verifier_verdict = 'pending')::int as pending,
          count(*) filter (where p.verifier_verdict = 'verified')::int as verified,
          count(*) filter (where p.verifier_verdict = 'rejected')::int as rejected
        from marketing.proofs p
        join marketing.tasks t on t.id = p.task_id
        where (${cid}::text is null or t.campaign_id = ${cid})
      ),
      outreach_agg as (
        select
          count(*)::int as total,
          count(*) filter (where status in ('queued', 'drafted', 'dry_run'))::int as queued,
          count(*) filter (where status in ('sent', 'delivered', 'replied'))::int as sent,
          count(*) filter (where status = 'blocked_stop')::int as blocked_stop,
          count(*) filter (where status = 'blocked_policy')::int as blocked_policy
        from marketing.outreach_messages
        where (${cid}::text is null or campaign_id = ${cid})
      ),
      attr_agg as (
        select
          coalesce(sum(case when event_type = 'qr_scan' then count else 0 end), 0)::int as qr_scans,
          coalesce(sum(case when event_type in ('site_visit', 'link_click') then count else 0 end), 0)::int as site_visits,
          coalesce(sum(case when event_type = 'signup_started' then count else 0 end), 0)::int as signups_started,
          coalesce(sum(case when event_type in ('signup_verified_adult', 'signup_verified_18plus') then count else 0 end), 0)::int as verified_adult_signups,
          coalesce(sum(case when event_type in ('video_view', 'video_view_snapshot') then count else 0 end), 0)::int as video_views
        from marketing.attribution_events
        where (${cid}::text is null or campaign_id = ${cid})
      ),
      hook_agg as (
        select
          count(*)::int as total,
          count(*) filter (where h.hook_state = 'disabled_stub')::int as disabled_stub_count,
          count(*) filter (where h.hook_state = 'settled_onchain')::int as settled_count
        from marketing.slop_cash_hooks h
        join marketing.tasks t on t.id = h.task_id
        where (${cid}::text is null or t.campaign_id = ${cid})
      )
      select
        c.total as c_total, c.active as c_active, c.billing_armed_count as c_billing_armed,
        c.lockdown_count as c_lockdown, c.slop_cash_enabled_count as c_slop_cash,
        c.monthly_budget_cents as b_monthly, c.daily_cap_cents as b_daily_cap,
        c.reserved_cents as b_reserved, c.spent_cents as b_spent, c.daily_spent_cents as b_daily_spent,
        a.total as a_total, a.healthy as a_healthy, a.paused as a_paused, a.rate_limited as a_rate_limited,
        a.turns_used_today as a_turns, a.daily_turn_cap_total as a_turn_cap,
        a.prov_chatgpt, a.prov_claude, a.prov_gemini, a.prov_surplus,
        d.total as d_total, d.online as d_online, d.leased as d_leased,
        d.needs_takeover as d_takeover, d.actions_used_today as d_actions,
        h.total as h_total, h.stopped as h_stopped, h.banned as h_banned, h.verified_adults as h_adults,
        t.total as t_total, t.open as t_open, t.proof_verified as t_verified, t.paid as t_paid, t.disputed as t_disputed,
        p.total as p_total, p.pending as p_pending, p.verified as p_verified, p.rejected as p_rejected,
        o.total as o_total, o.queued as o_queued, o.sent as o_sent,
        o.blocked_stop as o_blocked_stop, o.blocked_policy as o_blocked_policy,
        at.qr_scans, at.site_visits, at.signups_started, at.verified_adult_signups, at.video_views,
        sk.total as sk_total, sk.disabled_stub_count as sk_disabled, sk.settled_count as sk_settled
      from camp_agg c, agent_agg a, device_agg d, human_agg h,
           task_agg t, proof_agg p, outreach_agg o, attr_agg at, hook_agg sk
    `;
    const r = firstRow(rows)!;
    const monthlyBudgetCents = asNum(r.b_monthly);
    const reservedCents = asNum(r.b_reserved);
    const spentCents = asNum(r.b_spent);
    const verifiedAdultSignups = asNum(r.verified_adult_signups);

    return {
      generatedAt: isoNow(this.clock),
      campaigns: {
        total: asNum(r.c_total),
        active: asNum(r.c_active),
        billingArmedCount: asNum(r.c_billing_armed),
        lockdownCount: asNum(r.c_lockdown),
        slopCashEnabledCount: asNum(r.c_slop_cash),
      },
      budget: {
        monthlyBudgetCents,
        dailyCapCents: asNum(r.b_daily_cap),
        reservedCents,
        spentCents,
        dailySpentCents: asNum(r.b_daily_spent),
        remainingMonthlyCents: Math.max(0, monthlyBudgetCents - reservedCents - spentCents),
      },
      agents: {
        total: asNum(r.a_total),
        healthy: asNum(r.a_healthy),
        paused: asNum(r.a_paused),
        rateLimited: asNum(r.a_rate_limited),
        turnsUsedToday: asNum(r.a_turns),
        dailyTurnCapTotal: asNum(r.a_turn_cap),
        byProvider: {
          chatgpt: asNum(r.prov_chatgpt),
          claude: asNum(r.prov_claude),
          gemini: asNum(r.prov_gemini),
          surplus: asNum(r.prov_surplus),
        },
      },
      devices: {
        total: asNum(r.d_total),
        online: asNum(r.d_online),
        leased: asNum(r.d_leased),
        needsTakeover: asNum(r.d_takeover),
        actionsUsedToday: asNum(r.d_actions),
      },
      humans: {
        total: asNum(r.h_total),
        stopped: asNum(r.h_stopped),
        banned: asNum(r.h_banned),
        verifiedAdults: asNum(r.h_adults),
      },
      tasks: {
        total: asNum(r.t_total),
        open: asNum(r.t_open),
        proofVerified: asNum(r.t_verified),
        paid: asNum(r.t_paid),
        disputed: asNum(r.t_disputed),
      },
      proofs: {
        total: asNum(r.p_total),
        pending: asNum(r.p_pending),
        verified: asNum(r.p_verified),
        rejected: asNum(r.p_rejected),
      },
      outreach: {
        total: asNum(r.o_total),
        queued: asNum(r.o_queued),
        sent: asNum(r.o_sent),
        blockedStop: asNum(r.o_blocked_stop),
        blockedPolicy: asNum(r.o_blocked_policy),
      },
      attribution: {
        qrScans: asNum(r.qr_scans),
        siteVisits: asNum(r.site_visits),
        signupsStarted: asNum(r.signups_started),
        verifiedAdultSignups,
        videoViews: asNum(r.video_views),
        blendedCpaCents:
          verifiedAdultSignups > 0 ? Math.round(spentCents / verifiedAdultSignups) : null,
      },
      slopCashHooks: {
        total: asNum(r.sk_total),
        disabledStubCount: asNum(r.sk_disabled),
        settledCount: asNum(r.sk_settled),
      },
    };
  }
}
