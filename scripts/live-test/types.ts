export type SuiteName = "core" | "mcp" | "site" | "obs" | "deploy" | "ext" | "mkt";

export const SUITE_NAMES: readonly SuiteName[] = [
  "core",
  "mcp",
  "site",
  "obs",
  "deploy",
  "ext",
  "mkt",
] as const;

export type CaseMode = "AUTO-LIVE" | "SEMI-AUTO" | "MANUAL";

export type PhaseNumber = 0 | 1 | 2 | 3 | 4 | 5;

export const PHASE_NUMBERS: readonly PhaseNumber[] = [0, 1, 2, 3, 4, 5] as const;

export type ProbeKey =
  | "journey_eval_live"
  | "journey_eval_offline"
  | "review_eval_live"
  | "relay_eval_live"
  | "clef_features_live"
  | "llm_live_roundtrip"
  | "http_staging_probe"
  | "marketing_live_probe"
  | "e2e_connector_probe"
  | "security_suite_probe"
  | "manual_checklist_probe";

export const PROBE_KEYS: readonly ProbeKey[] = [
  "journey_eval_live",
  "journey_eval_offline",
  "review_eval_live",
  "relay_eval_live",
  "clef_features_live",
  "llm_live_roundtrip",
  "http_staging_probe",
  "marketing_live_probe",
  "e2e_connector_probe",
  "security_suite_probe",
  "manual_checklist_probe",
] as const;

export type CaseStatus =
  | "pending"
  | "ready"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "manual_pending"
  | "manual_passed"
  | "skipped";

export type RecipientKind = "phone" | "email" | "handle";

export type EnvMap = Record<string, string | undefined>;

export interface CaseDefinition {
  readonly id: string;
  readonly suite: SuiteName;
  readonly title: string;
  readonly mode: CaseMode;
  readonly phase: PhaseNumber;
  readonly requiresEnv: readonly string[];
  readonly optionalEnv: readonly string[];
  readonly requiresPostgres?: boolean;
  readonly requiresBaseUrl?: boolean;
  readonly requiresMarketingUrl?: boolean;
  readonly requiresLiveSendLock?: boolean;
  readonly estimatedMaxUsd: number;
  readonly mutating: boolean;
  readonly cleanupNote: string;
  readonly probeKey: ProbeKey;
  readonly checklist?: readonly string[];
}

export interface UserCredentialEntry {
  readonly key: string;
  readonly category:
    | "llm"
    | "cloudflare"
    | "telephony"
    | "database"
    | "external_events"
    | "venues"
    | "marketing"
    | "staging"
    | "safety";
  readonly requiredForPhases: readonly PhaseNumber[];
  readonly suites: readonly SuiteName[];
  readonly description: string;
  readonly secret: boolean;
  readonly sensitiveSendGate?: boolean;
}

export interface LlmTelemetry {
  provider?: string;
  model?: string;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costMicro: number;
  costUsd: number;
  latencyMsAvg: number;
  fallbacks: number;
}

export interface TranscriptTurn {
  actor: string;
  direction: "inbound" | "outbound" | "system";
  text: string;
  timestamp?: string;
}

export interface SafetyCounters {
  allowlistChecks: number;
  canaryLeaks: number;
  minorContacts: number;
  liveSendBlocked: number;
}

export interface CaseCheckpoint {
  id: string;
  status: CaseStatus;
  suite: SuiteName;
  phase: PhaseNumber;
  mode: CaseMode;
  attempts: number;
  lastRunAt?: string;
  durationMs?: number;
  costUsd: number;
  requests: number;
  tokens: number;
  missingEnv?: string[];
  errorSummary?: string;
  logFile?: string;
  transcriptScore?: number;
  needsScriptReview?: boolean;
  manualNotes?: string;
}

export interface BudgetState {
  limitUsd: number;
  spentUsd: number;
  requests: number;
  maxRequests: number;
}

export interface StateFile {
  version: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  budget: BudgetState;
  cases: Record<string, CaseCheckpoint>;
}

export interface CaseLog {
  id: string;
  suite: SuiteName;
  phase: PhaseNumber;
  mode: CaseMode;
  probeKey: ProbeKey;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: CaseStatus;
  summary: string;
  command?: string;
  exitCode?: number;
  telemetry?: LlmTelemetry;
  safety: SafetyCounters;
  transcript?: TranscriptTurn[];
  transcriptScore?: number;
  needsScriptReview?: boolean;
  checklist?: readonly string[];
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  details?: Record<string, unknown>;
}

export type PreflightClassification = "ready" | "blocked" | "manual_pending";

export interface PreflightCaseResult {
  id: string;
  suite: SuiteName;
  phase: PhaseNumber;
  mode: CaseMode;
  probeKey: ProbeKey;
  classification: PreflightClassification;
  missingEnv: string[];
  reasons: string[];
  estimatedMaxUsd: number;
  mutating: boolean;
}

export interface PreflightSafetyStatus {
  liveSendFlagsActive: string[];
  confirmLiveSendValid: boolean;
  allowlistCounts: {
    phones: number;
    emails: number;
    handles: number;
  };
  safeToRunLiveSend: boolean;
  safetyError?: string;
}

export interface PreflightReport {
  generatedAt: string;
  filters: {
    suite?: SuiteName;
    phase?: PhaseNumber;
  };
  infrastructure: {
    postgresPort: number;
    postgresReachable: boolean | "skipped";
    baseUrl?: string;
    baseUrlProductionBlocked: boolean;
    marketingUrl?: string;
    marketingUrlProductionBlocked: boolean;
  };
  safety: PreflightSafetyStatus;
  budget: {
    limitUsd: number;
    maxRequests: number;
    estimatedTotalMaxUsd: number;
    estimatedReadyMaxUsd: number;
  };
  counts: {
    total: number;
    ready: number;
    blocked: number;
    manual_pending: number;
  };
  bySuite: Record<SuiteName, { total: number; ready: number; blocked: number; manual_pending: number }>;
  byPhase: Record<PhaseNumber, { total: number; ready: number; blocked: number; manual_pending: number }>;
  missingEnvSummary: Array<{ key: string; blockedCases: number; caseIds: string[] }>;
  cases: PreflightCaseResult[];
}

export interface ScriptReviewItem {
  id: string;
  suite: SuiteName;
  phase: PhaseNumber;
  status: CaseStatus;
  reason: string;
  transcriptScore?: number;
  logFile?: string;
  errorSummary?: string;
}

export interface ReportSummary {
  generatedAt: string;
  runId: string;
  statePath: string;
  budget: BudgetState;
  totals: Record<CaseStatus, number> & { total: number };
  bySuite: Record<SuiteName, { total: number; passed: number; failed: number; blocked: number; manualPending: number; pending: number }>;
  byPhase: Record<PhaseNumber, { total: number; passed: number; failed: number; blocked: number; manualPending: number; pending: number }>;
  telemetry: {
    totalCostUsd: number;
    totalRequests: number;
    totalTokens: number;
  };
  missingEnvFromUser: Array<{ key: string; blockedCases: number }>;
  failedCases: Array<{
    id: string;
    suite: SuiteName;
    phase: PhaseNumber;
    attempts: number;
    errorSummary?: string;
    logFile?: string;
  }>;
  scriptReviewQueue: ScriptReviewItem[];
}
