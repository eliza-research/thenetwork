import type {
  AnomalyAlert,
  AttributionModel,
  AttributionRow,
  CohortMatrix as CoreCohortMatrix,
  FunnelResult,
  OutreachHeatmap,
  SafetyInvariantCounters,
  SliceResult,
  TimeSeriesPoint,
} from "@thenetwork/core";
import type {
  DecryptedTrajectorySpan,
  TrajectoryManifestRow,
  TrajectorySpan,
} from "@thenetwork/core";
import type {
  AntiFraudClaim,
  BanditArm,
  BdDeal,
  Campaign,
  CityAppDemandSignal,
  ContactSuppression,
  DailyLlmUsage,
  DeviceNode,
  DiscoveredLead,
  HumanPartner,
  LlmTrajectory,
  MarketingAgent,
  MarketingTask,
  OutreachMessage,
  ProofSubmission,
  QrBatch,
  VideoAsset,
  VipProspect,
} from "../src/types.ts";

export type {
  AnomalyAlert,
  AttributionModel,
  AttributionRow,
  CoreCohortMatrix,
  DecryptedTrajectorySpan,
  FunnelResult,
  OutreachHeatmap,
  SafetyInvariantCounters,
  SliceResult,
  TimeSeriesPoint,
  TrajectoryManifestRow,
  TrajectorySpan,
};

export type WorkspaceId = "command" | "analytics" | "outreach" | "trust" | "fleet";
export type BrandTheme = "network" | "slop" | "peon" | "friends";

export type BudgetTrackItem = {
  id?: string;
  key?: string;
  track?: string;
  label?: string;
  name?: string;
  amountCents?: number;
  monthlyBudgetCents?: number;
  budgetCents?: number;
  allocationCents?: number;
  monthlyCents?: number;
  spentCents?: number;
  sharePct?: number;
};

export type ComplianceGateSummary = {
  mode?: string;
  status?: "GREEN" | "AMBER" | "RED";
  allowed?: boolean;
  reason?: string;
  reasons?: string[];
};

export type CompliancePayload = {
  env?: string;
  liveBillingEnabled?: boolean;
  mockModeActive?: boolean;
  gates?: Record<string, ComplianceGateSummary>;
  breakers?: Record<string, { state?: string; reason?: string; trips?: number }>;
  audit?: Array<{ id?: string; action?: string; actor?: string; at?: string; detail?: string }>;
};

export type OverviewPayload = {
  generatedAt?: string;
  campaigns?: {
    total?: number;
    active?: number;
    billingArmedCount?: number;
    lockdownCount?: number;
    slopCashEnabledCount?: number;
  };
  agents?: {
    total?: number;
    healthy?: number;
    paused?: number;
    rateLimited?: number;
    turnsUsedToday?: number;
    dailyTurnCapTotal?: number;
  };
  devices?: {
    total?: number;
    online?: number;
    leased?: number;
    needsTakeover?: number;
    actionsUsedToday?: number;
  };
  banditArms?: BanditArm[];
  budget?: {
    monthlyBudgetCents?: number;
    spentCents?: number;
    reservedCents?: number;
    dailySpentCents?: number;
    dailyCapCents?: number;
    remainingMonthlyCents?: number;
  };
  attribution?: {
    siteVisits?: number;
    qrScans?: number;
    signupsStarted?: number;
    verifiedAdultSignups?: number;
    verifiedSignups?: number;
    signups?: number;
    videoViews?: number;
    blendedCpaCents?: number | null;
    cpaCents?: number | null;
    targetCpaCents?: number;
    cpaHistoryCents?: number[];
  };
  tasks?: {
    total?: number;
    open?: number;
    proofVerified?: number;
    paid?: number;
    disputed?: number;
  };
  proofs?: {
    total?: number;
    pending?: number;
    verified?: number;
    rejected?: number;
  };
  tracks?: BudgetTrackItem[];
  daemon?: {
    running: boolean;
    tickCount?: number;
    lastTickAt?: string | null;
    pausedQueues?: Record<string, string>;
  };
  adapters?: Array<{
    id: string;
    label?: string;
    configured?: boolean;
    live?: boolean;
    readiness?: string;
    status?: string;
    mode?: string;
  }>;
  slopCash?: {
    enabled: boolean;
    reason?: string;
    mode?: string;
  };
  compliance?: CompliancePayload;
};

export type CityReadinessPayload = {
  code: string;
  name: string;
  stage: string;
  overrideStage?: string;
  platformActive?: boolean;
  readiness?: {
    currentStage?: string;
    nextStage?: string | null;
    readyForNext?: boolean;
    verifiedWaitlistAdults?: number;
    signedVenues?: number;
    activeAdults?: number;
    blockers?: string[];
  };
};

export type DesireLaneItem = {
  id: string;
  label: string;
  appId: string;
  airGapGroup?: string;
  status?: string;
};

export type DesireLaneMetric = {
  campaigns: number;
  tasks: number;
  banditArms: number;
  verifiedOutcomes: number;
  bdDeals: number;
  vipProspects: number;
  videos: number;
  demandCount?: number;
  supplyCount?: number;
};

export type DesireLanesPayload = {
  lanes: DesireLaneItem[];
  metrics: Record<string, DesireLaneMetric>;
};

export type LlmUsagePayload = {
  usage: DailyLlmUsage;
  caps: { dailyTokenCap: number; dailyCostCapMicros: number };
  deterministicSkips?: number;
  budgetDecision?: { allowed: boolean; reason?: string };
};

export type CorePressurePayload = {
  mode: string;
  bridgeHealthy: boolean;
  bridgeFunctionsPresent?: boolean;
  paused: boolean;
  pausedQueues: string[];
  signals: CityAppDemandSignal[];
};

export type OpsSummaryPayload = {
  overview: OverviewPayload;
  cities: CityReadinessPayload[];
  desireLanes: DesireLanesPayload;
  llmUsage: LlmUsagePayload;
  corePressure: CorePressurePayload;
  compliance?: CompliancePayload;
};

export type TimeSeriesApiPayload = {
  granularity: string;
  series: {
    visits?: TimeSeriesPoint[];
    signups?: TimeSeriesPoint[];
    spendCents?: TimeSeriesPoint[];
    cpaCents?: TimeSeriesPoint[];
    meetings?: TimeSeriesPoint[];
    stops?: TimeSeriesPoint[];
  };
};

export type AttributionApiPayload = {
  model: AttributionModel;
  rows: AttributionRow[];
};

export type AnomaliesApiPayload = {
  alerts: AnomalyAlert[];
  safety: SafetyInvariantCounters;
};

export type TrajectoriesApiPayload = {
  traces: TrajectoryManifestRow[];
  hotTail: TrajectorySpan[];
  driver?: string;
};

export type TrajectoryDetailPayload = {
  traceId: string;
  manifest: TrajectoryManifestRow | null;
  spans: DecryptedTrajectorySpan[];
};

export type SimSnapshotDto = {
  playing?: boolean;
  running?: boolean;
  paused?: boolean;
  speedPreset?: "1x" | "10x" | "60x" | "360x" | "1000x" | "turbo";
  speed?: "1x" | "10x" | "60x" | "360x" | "1000x" | "turbo";
  responseMode?: "canned" | "hybrid" | "llm";
  simTimeMs?: number;
  simDay?: number;
  simHour?: number;
  simTimeLabel?: string;
  digest?: string;
  seed?: number;
  score?: number;
  safetyViolations?: number;
  llmBudget?: {
    spentUsd?: number;
    limitUsd?: number;
    spentMicros?: number;
    limitMicros?: number;
  };
  responseStats?: {
    mode?: "canned" | "hybrid" | "llm";
    costUsd?: number;
    budgetLimitUsd?: number;
  };
  scorecard?: {
    simDay?: number;
    totalScore?: number;
    score?: number;
    safetyViolations?: number;
    canaryLeaks?: number;
    teenViolations?: number;
  };
  activeChaos?: Array<string | { id: string; enabled?: boolean }>;
};

export type SimStateApiPayload = {
  active?: boolean;
  scenarioId?: string;
  responseMode?: "canned" | "hybrid" | "llm";
  scenarios?: Array<{ id: string; title?: string; label?: string; name?: string }>;
  snapshot?: SimSnapshotDto;
  mockBaseUrl?: string;
  recentEvents?: Array<{ seq?: number; stage?: string; city?: string; platform?: string }>;
  recentAudit?: Array<{ ts?: number; action?: string; detail?: string }>;
};

export type MockTrafficEntry = {
  id?: string;
  seq?: number;
  ts?: number;
  timestamp?: string;
  service: string;
  method: string;
  path: string;
  status: number;
  latencyMs?: number;
  durationMs?: number;
  chaosFault?: string | null;
  fault?: string | null;
};

export type DirectoryPayload = {
  tracks?: BudgetTrackItem[];
  agencies?: Array<{ name: string; focus?: string }>;
  platforms?: Array<{ name: string; category?: string }>;
};

export type VideoLintResult = {
  pass: boolean;
  errors: string[];
  warnings: string[];
};

export type AgentTickResult = {
  ok: boolean;
  providerUsed?: string;
  failedOverFrom?: string | null;
  outputText?: string;
  tokensUsed?: number;
  cached?: boolean;
  leakBlocked?: boolean;
  reason?: string;
};

export type ToastItem = {
  id: number;
  tone: "info" | "ok" | "destructive";
  message: string;
};

export type WorkspaceDatasets = {
  campaigns: Campaign[];
  agents: MarketingAgent[];
  devices: DeviceNode[];
  deals: BdDeal[];
  qrBatches: QrBatch[];
  vips: VipProspect[];
  videos: VideoAsset[];
  outreach: OutreachMessage[];
  tasks: MarketingTask[];
  proofs: ProofSubmission[];
  claims: AntiFraudClaim[];
  humans: HumanPartner[];
  suppressions: ContactSuppression[];
  llmTrajectories: LlmTrajectory[];
  trajectories: TrajectoryManifestRow[];
  hotTail: TrajectorySpan[];
  selectedTraceId: string | null;
  selectedTraceSpans: DecryptedTrajectorySpan[];
  mockTraffic: MockTrafficEntry[];
  discoveredLeads: DiscoveredLead[];
};
