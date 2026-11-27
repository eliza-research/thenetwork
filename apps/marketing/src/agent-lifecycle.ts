import { AsyncLocalStorage } from "node:async_hooks";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { fenceUntrusted, UNTRUSTED_NOTE } from "../../../packages/core/src/fence.ts";
import type { LeakGuard } from "../../../packages/core/src/guard.ts";
import { maskPii } from "../../../packages/core/src/pii.ts";
import {
  DEFAULT_MODEL,
  endpointsFor,
  LLMError,
  llmFor,
  type ChatMessage,
  type ClientOptions,
  type FallbackInfo,
  type LLM,
  type ResponseInfo,
} from "../../../packages/core/src/llm.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { spawnProcess } from "../../../packages/core/src/runtime/process.ts";
import {
  buildSocialPlaybookBrief,
  CANONICAL_MARKETING_AGENTS,
  FALLBACK_PROVIDER_ORDER,
  isSocialPlaybookChannel,
  marketingLeakAllowlist,
  type CanonicalAgentSpec,
} from "./constants.ts";
import {
  buildPromptCacheKey,
  estimateLlmCostMicros,
  estimateTokens,
  hashPromptText,
  PromptCache,
  tryDeterministicRoute,
  type DeterministicTaskHint,
} from "./llm-cache.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import {
  createMarketingLeakGuard,
  evaluateAgentTurnPolicy,
  evaluateLlmBudget,
  isGlobalOptOutText,
} from "./policy.ts";
import type { MarketingStore, UpsertAgentInput } from "./store.ts";
import type {
  AgentAuthMode,
  Clock,
  DailyLlmUsage,
  HumanPartner,
  LlmTrajectory,
  LlmTrajectoryStatus,
  MarketingAgent,
  OutreachChannel,
  SubscriptionProvider,
} from "./types.ts";

export { CANONICAL_MARKETING_AGENTS, type CanonicalAgentSpec };

export const DEFAULT_SURPLUS_MODEL = DEFAULT_MODEL;
export const DEFAULT_DAILY_TOKEN_CAP = 250_000;
export const DEFAULT_DAILY_COST_CAP_MICROS = 5_000_000;
export const DEFAULT_LLM_DEADLINE_MS = 25_000;
export const DEFAULT_AUTOPILOT_CONCURRENCY = 3;

export type SurplusClientFactory = (
  provider: "surplus",
  model: string,
  hooks: ClientOptions,
) => LLM;

export type SubscriptionConnectionMode =
  | AgentAuthMode
  | "cli_session"
  | "browser_profile"
  | "oauth_session"
  | "api_key";

export function normalizeAuthMode(mode: SubscriptionConnectionMode): AgentAuthMode {
  if (mode === "cli_session" || mode === "cli") return "cli";
  if (mode === "browser_profile" || mode === "browser") return "browser";
  if (mode === "oauth_session" || mode === "oauth") return "oauth";
  if (mode === "api_key" || mode === "api") return "api";
  return "mcp";
}

export function modelForProvider(
  provider: SubscriptionProvider,
  env: Record<string, string | undefined> = process.env,
): string {
  if (provider === "surplus") {
    return env.MARKETING_SURPLUS_MODEL?.trim() || DEFAULT_SURPLUS_MODEL;
  }
  if (provider === "claude") {
    return env.MARKETING_CLAUDE_MODEL?.trim() || "claude-sonnet";
  }
  if (provider === "chatgpt") {
    return env.MARKETING_CHATGPT_MODEL?.trim() || "codex-cli";
  }
  return env.MARKETING_GEMINI_MODEL?.trim() || "gemini-cli";
}

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliProcessRunner = (
  cmd: readonly string[],
  opts: { stdin?: string; timeoutMs: number; env?: Record<string, string | undefined> },
) => Promise<CliRunResult>;

export interface ProviderExecutionResponse {
  ok: boolean;
  text: string;
  model?: string;
  inputTokens?: number;
  cachedPromptTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costMicros?: number;
  costUsd?: number;
  latencyMs?: number;
  attempts?: number;
  usageKnown?: boolean;
  fellBack?: boolean;
  fallbackNotes?: string[];
  rateLimited?: boolean;
  cooldownMs?: number;
  error?: string;
}

export type BrowserSessionRunner = (req: {
  agent: MarketingAgent;
  provider: SubscriptionProvider;
  sessionRef: string;
  systemPrompt: string;
  prompt: string;
}) => Promise<ProviderExecutionResponse>;

export type OAuthOrApiRunner = (req: {
  agent: MarketingAgent;
  provider: SubscriptionProvider;
  authMode: AgentAuthMode;
  sessionRef: string;
  systemPrompt: string;
  prompt: string;
}) => Promise<ProviderExecutionResponse>;

export interface AgentLifecycleOptions {
  store: MarketingStore;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  cliRunner?: CliProcessRunner;
  browserRunner?: BrowserSessionRunner;
  oauthOrApiRunner?: OAuthOrApiRunner;
  llmClient?: LLM;
  surplusClientFactory?: SurplusClientFactory;
  leakGuard?: LeakGuard;
  promptCache?: PromptCache;
  enablePromptCache?: boolean;
  enableDeterministicRouter?: boolean;
  dailyTokenCap?: number;
  dailyCostCapMicros?: number;
  bridge?: NetworkCoreBridge;
  defaultCooldownMs?: number;
  cliTimeoutMs?: number;
  llmDeadlineMs?: number;
  autopilotConcurrency?: number;
}

export interface AgentHeartbeatResult {
  agent: MarketingAgent;
  healthy: boolean;
  inCooldown: boolean;
  remainingTurnsToday: number;
  checkedAt: string;
  reason?: string;
}

export interface TargetContactRef {
  id?: string;
  displayLabel?: string;
  role?: string;
  city?: string;
  phoneHash?: string | null;
  stopped?: boolean;
  banned?: boolean;
  lastMessageText?: string;
  notes?: string;
}

export interface DispatchTurnOptions {
  campaignId?: string | null;
  channel?: OutreachChannel | "reddit" | null;
  targetContact?: HumanPartner | TargetContactRef | null;
  untrustedContext?: Record<string, string | null | undefined> | string | null;
  lockdown?: boolean;
  allowFailover?: boolean;
  dryRun?: boolean;
  deterministicTaskHint?: DeterministicTaskHint | null;
  skipCache?: boolean;
  cacheTtlMs?: number;
  maxTokens?: number;
  temperature?: number;
  estimatedOutputTokens?: number;
}

export interface AgentTurnResult {
  ok: boolean;
  agent: MarketingAgent;
  providerUsed: SubscriptionProvider;
  failedOverFrom: SubscriptionProvider | null;
  failoverChain: string[];
  authMode: AgentAuthMode;
  model: string;
  promptHash: string;
  outputText: string | null;
  cached: boolean;
  deterministicRule: string | null;
  inputTokens: number;
  cachedPromptTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  costMicros: number;
  costUsd?: number;
  latencyMs: number;
  attempts?: number;
  leakReasons: string[];
  blockedReason?: string;
  dryRun: boolean;
  dispatchedAt: string;
}

export interface AutopilotTickOptions {
  forceIdle?: boolean;
}

export interface AutopilotTickResult {
  campaignId: string;
  skipped: boolean;
  skipReason?: string;
  checkedAt: string;
  heartbeats: AgentHeartbeatResult[];
  dispatched: AgentTurnResult[];
}

interface RecordLlmTrajectoryInput {
  agentId?: string | null;
  campaignId?: string | null;
  provider: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
  costMicros: number;
  latencyMs: number;
  status: LlmTrajectoryStatus;
  failoverChain?: string | null;
  leakBlocked: boolean;
}

interface Pass3StoreMethods {
  reserveAgentTurn?(
    agentId: string,
    nowIso: string,
  ): Promise<{ reserved: boolean; agent: MarketingAgent; reason?: string }>;
  recordLlmTrajectory?(input: RecordLlmTrajectoryInput): Promise<LlmTrajectory>;
  getDailyLlmUsage?(filter?: {
    agentId?: string;
    campaignId?: string;
    dayIso?: string;
  }): Promise<DailyLlmUsage>;
}

const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_CLI_TIMEOUT_MS = 30_000;
const CLI_KILL_GRACE_MS = 1_500;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 250;
const MAX_LOCAL_DAILY_USAGE_DAYS = 90;
const MAX_IDLE_FINGERPRINTS = 256;
const MAX_SURPLUS_CLIENTS = 16;

interface SurplusCallAccumulator {
  promptTokens: number;
  cachedPromptTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costMicro: number;
  latencyMs: number;
  attempts: number;
  regrows: number;
  anyCostKnown: boolean;
  allCostKnown: boolean;
  lastModel?: string;
  fallbackNotes: string[];
}

function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  if (map.has(key)) {
    map.delete(key);
  } else {
    while (map.size >= maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
  map.set(key, value);
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(items.length, Math.floor(limit)));
  const results = new Array<R>(items.length);
  let nextIdx = 0;

  const runner = async (): Promise<void> => {
    while (true) {
      const current = nextIdx;
      nextIdx += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]!, current);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  return results;
}

const BASE_CLI_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "NO_COLOR",
];

const PROVIDER_CLI_ENV_ALLOWLIST: Record<SubscriptionProvider, readonly string[]> = {
  claude: ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
  chatgpt: ["CODEX_HOME", "CODEX_CONFIG_DIR"],
  gemini: ["GEMINI_CLI_HOME", "GEMINI_CONFIG_DIR"],
  surplus: [],
};

const CANONICAL_BY_PERSONA: ReadonlyMap<string, CanonicalAgentSpec> = new Map(
  CANONICAL_MARKETING_AGENTS.map((spec) => [spec.personaId, spec]),
);

export function resolveSystemPrompt(
  agent: Pick<MarketingAgent, "personaId" | "displayName" | "appId">,
  opts?: { channel?: OutreachChannel | "reddit" | null },
): string {
  const spec = CANONICAL_BY_PERSONA.get(agent.personaId);
  const base = spec
    ? spec.systemPrompt
    : `You are ${agent.displayName}, an 18+ marketing agent for The Network (${agent.appId}). Never contact minors, enforce FTC #Ad disclosure, protect private contacts, and obey STOP immediately.`;
  if (isSocialPlaybookChannel(opts?.channel)) {
    return `${base}\n\n${buildSocialPlaybookBrief(agent.personaId, opts.channel)}`;
  }
  return base;
}

export function buildCliStdinPayload(systemPrompt: string, prompt: string): string {
  return `<system>\n${systemPrompt}\n</system>\n\n${prompt}`;
}

export function cliCommandForProvider(provider: SubscriptionProvider): string[] {
  if (provider === "claude") return ["claude", "-p"];
  if (provider === "chatgpt") return ["codex", "exec", "-"];
  if (provider === "gemini") return ["gemini"];
  throw new Error("Surplus provider uses core llmFor API rather than a CLI subprocess");
}

export function sanitizeCliEnv(
  provider: SubscriptionProvider,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  const allowedKeys = [
    ...BASE_CLI_ENV_ALLOWLIST,
    ...PROVIDER_CLI_ENV_ALLOWLIST[provider],
  ];
  for (const key of allowedKeys) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0) {
      clean[key] = val;
    }
  }
  return clean;
}

export function buildFencedAgentPrompt(
  prompt: string,
  opts: {
    targetContact?: HumanPartner | TargetContactRef | null;
    untrustedContext?: Record<string, string | null | undefined> | string | null;
  } = {},
): string {
  const blocks: string[] = [];
  const contact = opts.targetContact;
  if (contact) {
    const label = contact.displayLabel?.trim();
    if (label) {
      blocks.push(fenceUntrusted(maskPii(label), "contact_label"));
    }
    if ("lastMessageText" in contact && typeof contact.lastMessageText === "string") {
      const msg = contact.lastMessageText.trim();
      if (msg) {
        blocks.push(fenceUntrusted(maskPii(msg), "contact_message"));
      }
    }
    if ("notes" in contact && typeof contact.notes === "string") {
      const notes = contact.notes.trim();
      if (notes) {
        blocks.push(fenceUntrusted(maskPii(notes), "contact_notes"));
      }
    }
  }

  const ctx = opts.untrustedContext;
  if (typeof ctx === "string") {
    const trimmed = ctx.trim();
    if (trimmed) {
      blocks.push(fenceUntrusted(maskPii(trimmed), "external_context"));
    }
  } else if (ctx && typeof ctx === "object") {
    const sortedEntries = Object.entries(ctx).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sortedEntries) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      blocks.push(fenceUntrusted(maskPii(trimmed), `external_${key}`));
    }
  }

  const hasFencedBlock = blocks.length > 0 || prompt.includes("<<<UNTRUSTED ");
  if (!hasFencedBlock) {
    return prompt;
  }

  const parts: string[] = [];
  if (!prompt.includes(UNTRUSTED_NOTE)) {
    parts.push(UNTRUSTED_NOTE);
  }
  parts.push(prompt);
  if (blocks.length > 0) {
    parts.push(...blocks);
  }
  return parts.join("\n\n");
}

function isRateLimitMessage(text: string): boolean {
  return /\b(429|rate[ -]?limit|quota|too many requests|limit reached|try again later|capacity)\b/i.test(
    text,
  );
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total < maxBytes) {
        const remaining = maxBytes - total;
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        chunks.push(slice);
        total += slice.byteLength;
      }
    }
  } catch {
    // Stream closed after process termination.
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function defaultCliRunner(
  cmd: readonly string[],
  opts: { stdin?: string; timeoutMs: number; env?: Record<string, string | undefined> },
): Promise<CliRunResult> {
  let timedOut = false;
  let softTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const proc = spawnProcess(cmd, {
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: opts.env,
    });
    const timeoutMs = Math.max(250, opts.timeoutMs);
    softTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process already exited.
      }
      hardTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process already exited.
        }
      }, CLI_KILL_GRACE_MS);
    }, timeoutMs);

    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(proc.stdout, MAX_CLI_OUTPUT_BYTES),
      readBoundedStream(proc.stderr, MAX_CLI_OUTPUT_BYTES),
      proc.exited,
    ]);
    if (timedOut) {
      return {
        exitCode: 124,
        stdout,
        stderr: stderr || `CLI command timed out after ${timeoutMs}ms`,
      };
    }
    return { exitCode, stdout, stderr };
  } catch (err) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (softTimer) clearTimeout(softTimer);
    if (hardTimer) clearTimeout(hardTimer);
  }
}

export class AgentLifecycleManager {
  private readonly store: MarketingStore;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly dryRunDefault: boolean;
  private readonly cliRunner: CliProcessRunner;
  private readonly browserRunner?: BrowserSessionRunner;
  private readonly oauthOrApiRunner?: OAuthOrApiRunner;
  private readonly llmClient?: LLM;
  private readonly surplusClientFactory: SurplusClientFactory;
  private readonly leakGuard: LeakGuard;
  private readonly promptCache: PromptCache;
  private readonly enablePromptCache: boolean;
  private readonly enableDeterministicRouter: boolean;
  private readonly dailyTokenCap: number;
  private readonly dailyCostCapMicros: number;
  private readonly bridge?: NetworkCoreBridge;
  private readonly defaultCooldownMs: number;
  private readonly cliTimeoutMs: number;
  private readonly llmDeadlineMs: number;
  private readonly autopilotConcurrency: number;

  private readonly localDailyUsage = new Map<string, DailyLlmUsage>();
  private readonly lastIdleFingerprint = new Map<string, string>();
  private readonly surplusClients = new Map<string, LLM>();
  private readonly surplusCallStore = new AsyncLocalStorage<SurplusCallAccumulator>();

  constructor(opts: AgentLifecycleOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.dryRunDefault = opts.dryRun ?? this.env.MARKETING_LIVE_AGENTS !== "1";
    this.cliRunner = opts.cliRunner ?? defaultCliRunner;
    this.browserRunner = opts.browserRunner;
    this.oauthOrApiRunner = opts.oauthOrApiRunner;
    this.llmClient = opts.llmClient;
    this.surplusClientFactory = opts.surplusClientFactory ?? llmFor;
    this.leakGuard =
      opts.leakGuard ??
      createMarketingLeakGuard(this.env, {
        allow: [...marketingLeakAllowlist([], this.env)],
      });
    this.promptCache =
      opts.promptCache ??
      new PromptCache({
        clock: this.clock,
        maxEntries: 512,
        defaultTtlMs: 30 * 60_000,
      });
    this.enablePromptCache = opts.enablePromptCache !== false;
    this.enableDeterministicRouter = opts.enableDeterministicRouter !== false;
    this.dailyTokenCap = Math.max(1, Math.floor(opts.dailyTokenCap ?? DEFAULT_DAILY_TOKEN_CAP));
    this.dailyCostCapMicros = Math.max(
      1,
      Math.floor(opts.dailyCostCapMicros ?? DEFAULT_DAILY_COST_CAP_MICROS),
    );
    this.bridge = opts.bridge;
    this.defaultCooldownMs = opts.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.cliTimeoutMs = opts.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
    const rawDeadline = opts.llmDeadlineMs ?? DEFAULT_LLM_DEADLINE_MS;
    this.llmDeadlineMs =
      typeof rawDeadline === "number" && Number.isFinite(rawDeadline) && rawDeadline >= 1_000
        ? Math.floor(rawDeadline)
        : DEFAULT_LLM_DEADLINE_MS;
    const rawConcurrency = opts.autopilotConcurrency ?? DEFAULT_AUTOPILOT_CONCURRENCY;
    this.autopilotConcurrency =
      typeof rawConcurrency === "number" && Number.isFinite(rawConcurrency) && rawConcurrency >= 1
        ? Math.floor(rawConcurrency)
        : DEFAULT_AUTOPILOT_CONCURRENCY;
  }

  getPromptCache(): PromptCache {
    return this.promptCache;
  }

  async ensureCanonicalRoster(): Promise<MarketingAgent[]> {
    const roster: MarketingAgent[] = [];
    for (const spec of CANONICAL_MARKETING_AGENTS) {
      const existing = await this.store.getAgentByPersona(spec.personaId);
      if (existing) {
        roster.push(existing);
      } else {
        roster.push(
          await this.store.upsertAgent({
            id: spec.id,
            personaId: spec.personaId,
            displayName: spec.displayName,
            appId: spec.appId,
            provider: spec.provider,
            failoverProvider: spec.failoverProvider,
            authMode: spec.authMode,
            sessionRef: spec.sessionRef,
            dailyTurnCap: spec.dailyTurnCap,
          }),
        );
      }
    }
    return roster;
  }

  async registerAgent(
    input: Omit<UpsertAgentInput, "authMode"> & { authMode?: SubscriptionConnectionMode },
  ): Promise<MarketingAgent> {
    return this.store.upsertAgent({
      ...input,
      authMode: input.authMode ? normalizeAuthMode(input.authMode) : "cli",
    });
  }

  async heartbeat(agentId: string): Promise<AgentHeartbeatResult> {
    const existing = await this.store.getAgent(agentId);
    if (!existing) throw new Error(`Agent not found: ${agentId}`);

    const nowMs = this.clock.now();
    const checkedAt = new Date(nowMs).toISOString();
    let agent = existing;

    const cooldownActive =
      agent.cooldownUntil !== null && Date.parse(agent.cooldownUntil) > nowMs;
    if (!cooldownActive && (agent.status === "cooldown" || agent.status === "rate_limited")) {
      agent = await this.store.updateAgent(agent.id, {
        status: "idle",
        cooldownUntil: null,
        sessionHealthy: true,
      });
    }

    const remainingTurnsToday = Math.max(0, agent.dailyTurnCap - agent.turnsUsedToday);
    const decision = evaluateAgentTurnPolicy({
      agent,
      nowMs,
      targetStopped: false,
      lockdown: false,
    });

    const reason = decision.allowed
      ? undefined
      : decision.reason === "agent_paused"
        ? "paused_stop"
        : decision.reason === "rate_limited"
          ? "cooldown_or_rate_limited"
          : decision.reason;

    return {
      agent,
      healthy: decision.allowed,
      inCooldown: decision.inCooldown,
      remainingTurnsToday,
      checkedAt,
      ...(reason ? { reason } : {}),
    };
  }

  async pauseAgent(agentId: string): Promise<MarketingAgent> {
    return this.store.updateAgent(agentId, { status: "paused_stop" });
  }

  async resumeAgent(agentId: string): Promise<MarketingAgent> {
    return this.store.updateAgent(agentId, {
      status: "idle",
      cooldownUntil: null,
      sessionHealthy: true,
    });
  }

  async dispatchTurn(
    agentId: string,
    prompt: string,
    opts: DispatchTurnOptions = {},
  ): Promise<AgentTurnResult> {
    const nowMs = this.clock.now();
    const dispatchedAt = new Date(nowMs).toISOString();
    const utcDay = dispatchedAt.slice(0, 10);
    const dryRun = opts.dryRun ?? this.dryRunDefault;
    let agent = await this.store.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    if (
      agent.cooldownUntil !== null &&
      Date.parse(agent.cooldownUntil) <= nowMs &&
      (agent.status === "cooldown" || agent.status === "rate_limited")
    ) {
      agent = await this.store.updateAgent(agent.id, {
        status: "idle",
        cooldownUntil: null,
      });
    }

    const campaign = opts.campaignId ? await this.store.getCampaign(opts.campaignId) : null;
    const lockdown = Boolean(opts.lockdown || campaign?.riskDial === "lockdown");

    let targetHumanId: string | null = null;
    let targetPhoneHash: string | null = null;
    let targetStopped = false;
    let resolvedTargetContact: HumanPartner | TargetContactRef | null = opts.targetContact ?? null;

    if (opts.targetContact) {
      if ("handleOrEmailHmac" in opts.targetContact) {
        targetHumanId = opts.targetContact.id;
        targetStopped = opts.targetContact.stopped || opts.targetContact.banned;
      } else {
        targetHumanId = opts.targetContact.id ?? null;
        if (typeof opts.targetContact.phoneHash === "string" && opts.targetContact.phoneHash.trim()) {
          targetPhoneHash = opts.targetContact.phoneHash.trim();
        }
        if (targetHumanId) {
          const persisted = await this.store.getHuman(targetHumanId);
          if (persisted) {
            if (persisted.stopped || persisted.banned) {
              targetStopped = true;
            }
            resolvedTargetContact = {
              ...opts.targetContact,
              displayLabel: opts.targetContact.displayLabel ?? persisted.displayLabel,
              role: opts.targetContact.role ?? persisted.role,
              city: opts.targetContact.city ?? persisted.city,
            };
          }
        }
        if (opts.targetContact.stopped || opts.targetContact.banned) {
          targetStopped = true;
        }
        if (opts.targetContact.lastMessageText) {
          const reading = parseOptOut(opts.targetContact.lastMessageText);
          const globalStop = isGlobalOptOutText(opts.targetContact.lastMessageText);
          if (reading.match !== "none" || globalStop) {
            targetStopped = true;
            if (targetHumanId) {
              await this.store.markHumanStopped(
                targetHumanId,
                reading.match !== "none" ? `opt_out_${reading.match}` : "opt_out_global_stop",
              );
            }
          }
        }
      }
      if (!targetPhoneHash && targetHumanId && this.store.getHumanPhoneHash) {
        targetPhoneHash = await this.store.getHumanPhoneHash(targetHumanId);
      }
      if (!targetStopped && targetPhoneHash && this.store.isPhoneHashSuppressed) {
        if (await this.store.isPhoneHashSuppressed(targetPhoneHash)) {
          targetStopped = true;
        }
      }
    }

    const policyDecision = evaluateAgentTurnPolicy({
      agent,
      nowMs,
      targetStopped,
      lockdown,
    });

    const allowFailover = opts.allowFailover !== false;
    let activeProvider = agent.provider;
    let failedOverFrom: SubscriptionProvider | null = null;
    const triedProviders = new Set<SubscriptionProvider>([activeProvider]);
    const failoverChain: string[] = [activeProvider];

    const systemPrompt = resolveSystemPrompt(agent, { channel: opts.channel });
    const initialModel = modelForProvider(activeProvider, this.env);
    const fencedPrompt = buildFencedAgentPrompt(prompt, {
      targetContact: resolvedTargetContact,
      untrustedContext: opts.untrustedContext,
    });
    const promptHash = hashPromptText(systemPrompt, fencedPrompt);

    if (!policyDecision.allowed) {
      const onlyRateLimited =
        policyDecision.reason === "rate_limited" &&
        agent.sessionHealthy &&
        agent.turnsUsedToday < agent.dailyTurnCap;
      const backup = this.pickBackupProvider(agent, triedProviders);

      if (onlyRateLimited && allowFailover && backup) {
        failedOverFrom = activeProvider;
        activeProvider = backup;
        triedProviders.add(backup);
        failoverChain.push(backup);
        agent = await this.store.updateAgent(agent.id, {
          provider: backup,
          failoverProvider: failedOverFrom,
          status: "idle",
          cooldownUntil: null,
        });
      } else {
        return {
          ok: false,
          agent,
          providerUsed: activeProvider,
          failedOverFrom: null,
          failoverChain,
          authMode: agent.authMode,
          model: initialModel,
          promptHash,
          outputText: null,
          cached: false,
          deterministicRule: null,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: 0,
          latencyMs: 0,
          leakReasons: [],
          blockedReason: policyDecision.reason ?? "policy_blocked",
          dryRun,
          dispatchedAt,
        };
      }
    }

    if (this.enableDeterministicRouter && opts.deterministicTaskHint !== null) {
      const routed = tryDeterministicRoute({
        prompt,
        personaId: agent.personaId,
        taskHint: opts.deterministicTaskHint ?? "auto",
      });
      if (routed && routed.handled) {
        const leakReasons = this.leakGuard.check(routed.outputText);
        const leakBlocked = leakReasons.length > 0;
        await this.recordTrajectory(utcDay, {
          agentId: agent.id,
          campaignId: opts.campaignId ?? null,
          provider: "deterministic",
          model: routed.rule,
          promptHash,
          inputTokens: 0,
          outputTokens: 0,
          cached: true,
          costMicros: 0,
          latencyMs: 0,
          status: leakBlocked ? "leak_blocked" : "cached",
          failoverChain: null,
          leakBlocked,
        });
        if (leakBlocked) {
          return {
            ok: false,
            agent,
            providerUsed: activeProvider,
            failedOverFrom,
            failoverChain,
            authMode: agent.authMode,
            model: routed.rule,
            promptHash,
            outputText: null,
            cached: false,
            deterministicRule: routed.rule,
            inputTokens: 0,
            outputTokens: 0,
            costMicros: 0,
            latencyMs: 0,
            leakReasons,
            blockedReason: "leak_guard_blocked",
            dryRun,
            dispatchedAt,
          };
        }
        return {
          ok: true,
          agent,
          providerUsed: activeProvider,
          failedOverFrom,
          failoverChain,
          authMode: agent.authMode,
          model: routed.rule,
          promptHash,
          outputText: routed.outputText,
          cached: false,
          deterministicRule: routed.rule,
          inputTokens: 0,
          outputTokens: 0,
          costMicros: 0,
          latencyMs: 0,
          leakReasons: [],
          dryRun,
          dispatchedAt,
        };
      }
    }

    const activeModel = modelForProvider(activeProvider, this.env);
    const contactScopeParts: string[] = [];
    if (opts.channel) contactScopeParts.push(`ch:${opts.channel}`);
    if (resolvedTargetContact) {
      if (targetHumanId) contactScopeParts.push(`cid:${targetHumanId}`);
      if (resolvedTargetContact.displayLabel?.trim()) {
        contactScopeParts.push(`lbl:${resolvedTargetContact.displayLabel.trim()}`);
      }
      if (resolvedTargetContact.role?.trim()) {
        contactScopeParts.push(`role:${resolvedTargetContact.role.trim()}`);
      }
      if (resolvedTargetContact.city?.trim()) {
        contactScopeParts.push(`city:${resolvedTargetContact.city.trim()}`);
      }
    }
    const cacheScope = contactScopeParts.length > 0 ? contactScopeParts.join("|") : undefined;

    const cacheKey = buildPromptCacheKey({
      personaId: agent.personaId,
      provider: activeProvider,
      model: activeModel,
      systemPrompt,
      prompt: fencedPrompt,
      scope: cacheScope,
    });

    if (this.enablePromptCache && !opts.skipCache) {
      const cached = this.promptCache.get(cacheKey);
      if (cached) {
        const leakReasons = this.leakGuard.check(cached.text);
        if (leakReasons.length === 0) {
          await this.recordTrajectory(utcDay, {
            agentId: agent.id,
            campaignId: opts.campaignId ?? null,
            provider: activeProvider,
            model: cached.model,
            promptHash,
            inputTokens: 0,
            outputTokens: 0,
            cached: true,
            costMicros: 0,
            latencyMs: 0,
            status: "cached",
            failoverChain: failoverChain.length > 1 ? failoverChain.join("->") : null,
            leakBlocked: false,
          });
          return {
            ok: true,
            agent,
            providerUsed: activeProvider,
            failedOverFrom,
            failoverChain,
            authMode: agent.authMode,
            model: cached.model,
            promptHash,
            outputText: cached.text,
            cached: true,
            deterministicRule: null,
            inputTokens: 0,
            outputTokens: 0,
            costMicros: 0,
            latencyMs: 0,
            leakReasons: [],
            dryRun,
            dispatchedAt,
          };
        }
        this.promptCache.delete(cacheKey);
      }
    }

    const estimatedInputTokens = estimateTokens(`${systemPrompt}\n${fencedPrompt}`);
    const estimatedOutputTokens = Math.max(
      1,
      Math.floor(opts.estimatedOutputTokens ?? DEFAULT_ESTIMATED_OUTPUT_TOKENS),
    );
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
    const estimatedCostMicros = dryRun
      ? 0
      : estimateLlmCostMicros({
          model: activeModel,
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
        });

    const dailyUsage = await this.getDailyUsage(utcDay, agent.id, opts.campaignId ?? null);
    const budgetDecision = evaluateLlmBudget({
      tokensUsedToday: dailyUsage.totalTokens,
      estimatedTokens: estimatedTotalTokens,
      dailyTokenCap: this.dailyTokenCap,
      costMicrosToday: dailyUsage.costMicros,
      estimatedCostMicros,
      dailyCostCapMicros: this.dailyCostCapMicros,
    });

    if (!budgetDecision.allowed) {
      await this.recordTrajectory(utcDay, {
        agentId: agent.id,
        campaignId: opts.campaignId ?? null,
        provider: activeProvider,
        model: activeModel,
        promptHash,
        inputTokens: 0,
        outputTokens: 0,
        cached: false,
        costMicros: 0,
        latencyMs: 0,
        status: "budget_blocked",
        failoverChain: failoverChain.length > 1 ? failoverChain.join("->") : null,
        leakBlocked: false,
      });
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        failoverChain,
        authMode: agent.authMode,
        model: activeModel,
        promptHash,
        outputText: null,
        cached: false,
        deterministicRule: null,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        latencyMs: 0,
        leakReasons: [],
        blockedReason: budgetDecision.reason ?? "llm_budget_exceeded",
        dryRun,
        dispatchedAt,
      };
    }

    const reserved = await this.reserveTurnAtomic(agent, {
      dispatchedAt,
      campaignId: opts.campaignId ?? null,
      targetHumanId,
      targetStopped,
      lockdown,
    });
    agent = reserved.agent;
    if (!reserved.reserved) {
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        failoverChain,
        authMode: agent.authMode,
        model: activeModel,
        promptHash,
        outputText: null,
        cached: false,
        deterministicRule: null,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        latencyMs: 0,
        leakReasons: [],
        blockedReason: reserved.reason ?? "policy_blocked",
        dryRun,
        dispatchedAt,
      };
    }

    const callStartMs = this.clock.now();
    let exec = await this.executeProvider(agent, activeProvider, systemPrompt, fencedPrompt, dryRun, opts);
    while (!exec.ok && exec.rateLimited && allowFailover) {
      const backup = this.pickBackupProvider(
        { ...agent, provider: activeProvider },
        triedProviders,
      );
      if (!backup) break;
      if (failedOverFrom === null) failedOverFrom = activeProvider;
      const prevProvider = activeProvider;
      activeProvider = backup;
      triedProviders.add(backup);
      failoverChain.push(backup);
      agent = await this.store.updateAgent(agent.id, {
        provider: backup,
        failoverProvider: prevProvider,
        status: "idle",
        cooldownUntil: null,
      });
      exec = await this.executeProvider(agent, activeProvider, systemPrompt, fencedPrompt, dryRun, opts);
    }

    if (exec.fallbackNotes && exec.fallbackNotes.length > 0) {
      for (const note of exec.fallbackNotes) {
        if (!failoverChain.includes(note)) failoverChain.push(note);
      }
    }

    const wallLatencyMs = Math.max(0, this.clock.now() - callStartMs);
    const latencyMs =
      exec.latencyMs !== undefined && exec.latencyMs > wallLatencyMs
        ? Math.round(exec.latencyMs)
        : wallLatencyMs;
    const resolvedModel = exec.model ?? modelForProvider(activeProvider, this.env);
    const actualInputTokens = exec.inputTokens ?? (exec.ok ? estimatedInputTokens : 0);
    const actualCachedPromptTokens = Math.max(0, Math.floor(exec.cachedPromptTokens ?? 0));
    const actualOutputTokens = exec.outputTokens ?? (exec.ok ? estimateTokens(exec.text) : 0);
    const actualReasoningTokens = Math.max(0, Math.floor(exec.reasoningTokens ?? 0));
    const actualAttempts = Math.max(1, Math.floor(exec.attempts ?? 1));
    const actualCostMicros = dryRun
      ? 0
      : (exec.costMicros ??
        (exec.ok
          ? estimateLlmCostMicros({
              model: resolvedModel,
              inputTokens: actualInputTokens,
              outputTokens: actualOutputTokens,
              cachedTokens: actualCachedPromptTokens,
            })
          : 0));
    const actualCostUsd = dryRun ? 0 : (exec.costUsd ?? actualCostMicros / 1_000_000);
    const failoverChainStr = failoverChain.length > 1 ? failoverChain.join("->") : null;

    if (!exec.ok) {
      if (exec.rateLimited) {
        const cooldownUntil = new Date(
          this.clock.now() + (exec.cooldownMs ?? this.defaultCooldownMs),
        ).toISOString();
        agent = await this.store.updateAgent(agent.id, {
          status: "rate_limited",
          cooldownUntil,
        });
      }
      await this.recordTrajectory(utcDay, {
        agentId: agent.id,
        campaignId: opts.campaignId ?? null,
        provider: activeProvider,
        model: resolvedModel,
        promptHash,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        cached: false,
        costMicros: actualCostMicros,
        latencyMs,
        status: "error",
        failoverChain: failoverChainStr,
        leakBlocked: false,
      });
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        failoverChain,
        authMode: agent.authMode,
        model: resolvedModel,
        promptHash,
        outputText: null,
        cached: false,
        deterministicRule: null,
        inputTokens: actualInputTokens,
        cachedPromptTokens: actualCachedPromptTokens,
        outputTokens: actualOutputTokens,
        reasoningTokens: actualReasoningTokens,
        costMicros: actualCostMicros,
        costUsd: actualCostUsd,
        latencyMs,
        attempts: actualAttempts,
        leakReasons: [],
        blockedReason: exec.rateLimited ? "rate_limited" : (exec.error ?? "provider_error"),
        dryRun,
        dispatchedAt,
      };
    }

    const leakReasons = this.leakGuard.check(exec.text);
    if (leakReasons.length > 0) {
      await this.recordTrajectory(utcDay, {
        agentId: agent.id,
        campaignId: opts.campaignId ?? null,
        provider: activeProvider,
        model: resolvedModel,
        promptHash,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        cached: false,
        costMicros: actualCostMicros,
        latencyMs,
        status: "leak_blocked",
        failoverChain: failoverChainStr,
        leakBlocked: true,
      });
      await this.reportBridgeCost(
        agent,
        activeProvider,
        resolvedModel,
        actualInputTokens + actualOutputTokens,
        actualCostMicros,
        exec.usageKnown === true,
        dryRun,
        {
          inputTokens: actualInputTokens,
          cachedPromptTokens: actualCachedPromptTokens,
          outputTokens: actualOutputTokens,
          reasoningTokens: actualReasoningTokens,
          latencyMs,
          attempts: actualAttempts,
        },
      );
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        failoverChain,
        authMode: agent.authMode,
        model: resolvedModel,
        promptHash,
        outputText: null,
        cached: false,
        deterministicRule: null,
        inputTokens: actualInputTokens,
        cachedPromptTokens: actualCachedPromptTokens,
        outputTokens: actualOutputTokens,
        reasoningTokens: actualReasoningTokens,
        costMicros: actualCostMicros,
        costUsd: actualCostUsd,
        latencyMs,
        attempts: actualAttempts,
        leakReasons,
        blockedReason: "leak_guard_blocked",
        dryRun,
        dispatchedAt,
      };
    }

    if (this.enablePromptCache && !opts.skipCache) {
      const finalCacheKey = buildPromptCacheKey({
        personaId: agent.personaId,
        provider: activeProvider,
        model: resolvedModel,
        systemPrompt,
        prompt: fencedPrompt,
        scope: cacheScope,
      });
      this.promptCache.set(
        finalCacheKey,
        {
          promptHash,
          provider: activeProvider,
          model: resolvedModel,
          text: exec.text,
        },
        opts.cacheTtlMs,
      );
    }

    const trajectoryStatus: LlmTrajectoryStatus =
      failedOverFrom !== null || exec.fellBack ? "fallback" : "ok";
    await this.recordTrajectory(utcDay, {
      agentId: agent.id,
      campaignId: opts.campaignId ?? null,
      provider: activeProvider,
      model: resolvedModel,
      promptHash,
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
      cached: false,
      costMicros: actualCostMicros,
      latencyMs,
      status: trajectoryStatus,
      failoverChain: failoverChainStr,
      leakBlocked: false,
    });
    await this.reportBridgeCost(
      agent,
      activeProvider,
      resolvedModel,
      actualInputTokens + actualOutputTokens,
      actualCostMicros,
      exec.usageKnown === true,
      dryRun,
      {
        inputTokens: actualInputTokens,
        cachedPromptTokens: actualCachedPromptTokens,
        outputTokens: actualOutputTokens,
        reasoningTokens: actualReasoningTokens,
        latencyMs,
        attempts: actualAttempts,
      },
    );

    return {
      ok: true,
      agent,
      providerUsed: activeProvider,
      failedOverFrom,
      failoverChain,
      authMode: agent.authMode,
      model: resolvedModel,
      promptHash,
      outputText: exec.text,
      cached: false,
      deterministicRule: null,
      inputTokens: actualInputTokens,
      cachedPromptTokens: actualCachedPromptTokens,
      outputTokens: actualOutputTokens,
      reasoningTokens: actualReasoningTokens,
      costMicros: actualCostMicros,
      costUsd: actualCostUsd,
      latencyMs,
      attempts: actualAttempts,
      leakReasons: [],
      dryRun,
      dispatchedAt,
    };
  }

  async runAutopilotTick(
    campaignId: string,
    opts: AutopilotTickOptions = {},
  ): Promise<AutopilotTickResult> {
    const checkedAt = new Date(this.clock.now()).toISOString();
    const campaign = await this.store.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    if (campaign.riskDial === "lockdown") {
      return {
        campaignId,
        skipped: true,
        skipReason: "campaign_lockdown",
        checkedAt,
        heartbeats: [],
        dispatched: [],
      };
    }
    if (campaign.status !== "active") {
      return {
        campaignId,
        skipped: true,
        skipReason: `campaign_status_${campaign.status}`,
        checkedAt,
        heartbeats: [],
        dispatched: [],
      };
    }

    const allAgents = await this.store.listAgents();
    const agents = allAgents.length > 0 ? allAgents : await this.ensureCanonicalRoster();
    const relevantAgents = agents.filter(
      (a) => campaign.appId === "all" || a.appId === campaign.appId || a.personaId === "operator",
    );

    const heartbeats: AgentHeartbeatResult[] = [];
    for (const a of relevantAgents) {
      heartbeats.push(await this.heartbeat(a.id));
    }

    const openTasks = (await this.store.listTasks({ campaignId })).filter(
      (t) =>
        t.status === "drafted" ||
        t.status === "posted_or_emailed" ||
        t.status === "applicant_screened",
    );

    if (openTasks.length === 0 && !opts.forceIdle) {
      const idleFingerprint = `${campaign.id}:${campaign.updatedAt}:${campaign.riskDial}:${checkedAt.slice(0, 10)}`;
      if (this.lastIdleFingerprint.get(campaignId) === idleFingerprint) {
        return {
          campaignId,
          skipped: true,
          skipReason: "idle_no_state_change",
          checkedAt,
          heartbeats,
          dispatched: [],
        };
      }
      setBoundedMapEntry(
        this.lastIdleFingerprint,
        campaignId,
        idleFingerprint,
        MAX_IDLE_FINGERPRINTS,
      );
    } else if (openTasks.length > 0) {
      this.lastIdleFingerprint.delete(campaignId);
    }

    const maxPerTick =
      campaign.riskDial === "conservative" ? 2 : campaign.riskDial === "balanced" ? 4 : 6;

    const healthyHeartbeats = heartbeats.filter((hb) => hb.healthy).slice(0, maxPerTick);
    const workItems = await Promise.all(
      healthyHeartbeats.map(async (hb, idx) => {
        const task = openTasks[idx];
        const prompt = task
          ? `${UNTRUSTED_NOTE}\n\n[Campaign ${campaign.slug} | ${campaign.city}] Advance task (${task.taskKind}, status=${task.status}) while obeying 18+, FTC #Ad, and STOP rules.\n\n${fenceUntrusted(maskPii(task.title), "task_title")}`
          : `[Campaign ${campaign.slug} | ${campaign.city}] Prepare next ${hb.agent.displayName} (${hb.agent.appId}) zero-cost ${campaign.city.toUpperCase()} discovery and outreach draft.`;
        const targetHuman = task?.assigneeHumanId
          ? await this.store.getHuman(task.assigneeHumanId)
          : null;
        return {
          agentId: hb.agent.id,
          prompt,
          targetHuman,
          hasTask: Boolean(task),
        };
      }),
    );

    const taskItems = workItems.filter((item) => item.hasTask);
    const idleItems = workItems.filter((item) => !item.hasTask);

    const dispatchedTasks = await runWithConcurrency(
      taskItems,
      this.autopilotConcurrency,
      (item) =>
        this.dispatchTurn(item.agentId, item.prompt, {
          campaignId: campaign.id,
          targetContact: item.targetHuman,
          lockdown: false,
        }),
    );
    const dispatchedIdle = await runWithConcurrency(
      idleItems,
      this.autopilotConcurrency,
      (item) =>
        this.dispatchTurn(item.agentId, item.prompt, {
          campaignId: campaign.id,
          targetContact: item.targetHuman,
          lockdown: false,
        }),
    );
    const dispatched: AgentTurnResult[] = [...dispatchedTasks, ...dispatchedIdle];

    return {
      campaignId,
      skipped: false,
      checkedAt,
      heartbeats,
      dispatched,
    };
  }

  private async reserveTurnAtomic(
    agent: MarketingAgent,
    ctx: {
      dispatchedAt: string;
      campaignId: string | null;
      targetHumanId: string | null;
      targetStopped: boolean;
      lockdown: boolean;
    },
  ): Promise<{ reserved: boolean; agent: MarketingAgent; reason?: string }> {
    const ext = this.store as MarketingStore & Pass3StoreMethods;
    if (typeof ext.reserveAgentTurn === "function") {
      return ext.reserveAgentTurn(agent.id, ctx.dispatchedAt);
    }
    const consumed = await this.store.consumeAgentTurn({
      agentId: agent.id,
      campaignId: ctx.campaignId,
      targetHumanId: ctx.targetHumanId,
      targetStopped: ctx.targetStopped,
      lockdown: ctx.lockdown,
    });
    return {
      reserved: consumed.allowed,
      agent: consumed.agent,
      ...(consumed.reason ? { reason: consumed.reason } : {}),
    };
  }

  private async getDailyUsage(
    dayIso: string,
    agentId: string,
    campaignId: string | null,
  ): Promise<DailyLlmUsage> {
    const ext = this.store as MarketingStore & Pass3StoreMethods;
    if (typeof ext.getDailyLlmUsage === "function") {
      return ext.getDailyLlmUsage({ dayIso });
    }
    const existing = this.localDailyUsage.get(dayIso);
    if (existing) return existing;
    const blank: DailyLlmUsage = {
      day: dayIso,
      calls: 0,
      cachedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      leakBlockedCalls: 0,
      budgetBlockedCalls: 0,
    };
    void agentId;
    void campaignId;
    return blank;
  }

  private async recordTrajectory(dayIso: string, entry: RecordLlmTrajectoryInput): Promise<void> {
    const ext = this.store as MarketingStore & Pass3StoreMethods;
    if (typeof ext.recordLlmTrajectory === "function") {
      await ext.recordLlmTrajectory(entry);
    }
    const prev = this.localDailyUsage.get(dayIso) ?? {
      day: dayIso,
      calls: 0,
      cachedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      leakBlockedCalls: 0,
      budgetBlockedCalls: 0,
    };
    const next: DailyLlmUsage = {
      day: dayIso,
      calls: prev.calls + 1,
      cachedCalls: prev.cachedCalls + (entry.cached ? 1 : 0),
      inputTokens: prev.inputTokens + entry.inputTokens,
      outputTokens: prev.outputTokens + entry.outputTokens,
      totalTokens: prev.totalTokens + entry.inputTokens + entry.outputTokens,
      costMicros: prev.costMicros + entry.costMicros,
      leakBlockedCalls: prev.leakBlockedCalls + (entry.leakBlocked ? 1 : 0),
      budgetBlockedCalls: prev.budgetBlockedCalls + (entry.status === "budget_blocked" ? 1 : 0),
    };
    setBoundedMapEntry(this.localDailyUsage, dayIso, next, MAX_LOCAL_DAILY_USAGE_DAYS);
  }

  private async reportBridgeCost(
    agent: MarketingAgent,
    provider: SubscriptionProvider,
    model: string,
    totalTokens: number,
    costMicros: number,
    usageKnown: boolean,
    dryRun: boolean,
    breakdown?: {
      inputTokens: number;
      cachedPromptTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      latencyMs: number;
      attempts: number;
    },
  ): Promise<void> {
    if (!this.bridge || dryRun || costMicros <= 0) return;
    await this.bridge
      .recordOperationalCost({
        appId: agent.appId,
        provider,
        kind: "llm",
        quantity: totalTokens,
        costUsd: costMicros / 1_000_000,
        estimated: !usageKnown,
        detail: {
          personaId: agent.personaId,
          model,
          ...(breakdown ?? {}),
        },
      })
      .catch(() => false);
  }

  private pickBackupProvider(
    agent: MarketingAgent,
    tried: ReadonlySet<SubscriptionProvider>,
  ): SubscriptionProvider | null {
    if (
      agent.failoverProvider &&
      agent.failoverProvider !== agent.provider &&
      !tried.has(agent.failoverProvider)
    ) {
      return agent.failoverProvider;
    }
    for (const candidate of FALLBACK_PROVIDER_ORDER) {
      if (candidate !== agent.provider && !tried.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private getOrCreateSurplusClient(model: string): LLM {
    const existing = this.surplusClients.get(model);
    if (existing) {
      this.surplusClients.delete(model);
      this.surplusClients.set(model, existing);
      return existing;
    }

    const client = this.surplusClientFactory("surplus", model, {
      clock: this.clock,
      timeoutMs: Math.min(this.cliTimeoutMs, this.llmDeadlineMs),
      deadlineMs: this.llmDeadlineMs,
      onResponse: (info: ResponseInfo) => {
        const acc = this.surplusCallStore.getStore();
        if (!acc) return;
        acc.attempts += 1;
        acc.regrows = Math.max(acc.regrows, info.regrows ?? 0);
        if (info.model) acc.lastModel = info.model;
        const usage = info.usage as {
          promptTokens?: number;
          completionTokens?: number;
          reasoningTokens?: number;
          cachedPromptTokens?: number;
          cachedTokens?: number;
          cacheWriteTokens?: number;
        };
        const rawPromptDetails = (
          info.data as
            | { usage?: { prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } } }
            | undefined
        )?.usage?.prompt_tokens_details;
        acc.promptTokens += Math.max(0, Number(usage.promptTokens ?? 0));
        acc.cachedPromptTokens += Math.max(
          0,
          Number(usage.cachedPromptTokens ?? usage.cachedTokens ?? rawPromptDetails?.cached_tokens ?? 0),
        );
        acc.cacheWriteTokens += Math.max(
          0,
          Number(usage.cacheWriteTokens ?? rawPromptDetails?.cache_write_tokens ?? 0),
        );
        acc.completionTokens += Math.max(0, Number(usage.completionTokens ?? 0));
        acc.reasoningTokens += Math.max(0, Number(usage.reasoningTokens ?? 0));
        acc.costMicro += Math.max(0, Number(info.costMicro ?? 0));
        acc.latencyMs += Math.max(0, Number(info.latencyMs ?? 0));
        if (info.costKnown) acc.anyCostKnown = true;
        else acc.allCostKnown = false;
      },
      onFallback: (info: FallbackInfo) => {
        const acc = this.surplusCallStore.getStore();
        if (!acc) return;
        acc.fallbackNotes.push(`${info.from}->${info.to}`);
      },
    });

    setBoundedMapEntry(this.surplusClients, model, client, MAX_SURPLUS_CLIENTS);
    return client;
  }

  private async executeSurplusProvider(
    agent: MarketingAgent,
    systemPrompt: string,
    prompt: string,
    opts: DispatchTurnOptions,
  ): Promise<ProviderExecutionResponse> {
    const model = modelForProvider("surplus", this.env);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    if (this.llmClient) {
      try {
        const text = await this.llmClient.chat(messages, {
          maxTokens: opts.maxTokens ?? 700,
          temperature: opts.temperature ?? 0.4,
          deadlineMs: this.llmDeadlineMs,
        });
        const inputTokens = estimateTokens(`${systemPrompt}\n${prompt}`);
        const outputTokens = estimateTokens(text);
        const costMicros = estimateLlmCostMicros({ model, inputTokens, outputTokens });
        return {
          ok: true,
          text,
          model,
          inputTokens,
          cachedPromptTokens: 0,
          outputTokens,
          reasoningTokens: 0,
          costMicros,
          costUsd: costMicros / 1_000_000,
          attempts: 1,
          usageKnown: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited =
          (err instanceof LLMError && err.detail.status === 429) || isRateLimitMessage(msg);
        return {
          ok: false,
          text: "",
          model,
          rateLimited,
          error: msg,
        };
      }
    }

    if (this.oauthOrApiRunner) {
      return this.oauthOrApiRunner({
        agent,
        provider: "surplus",
        authMode: agent.authMode,
        sessionRef: agent.sessionRef,
        systemPrompt,
        prompt,
      });
    }

    if (this.surplusClientFactory === llmFor && endpointsFor("surplus", this.env).length === 0) {
      return {
        ok: false,
        text: "",
        model,
        rateLimited: false,
        error: "surplus_api_key_missing",
      };
    }

    const client = this.getOrCreateSurplusClient(model);
    const acc: SurplusCallAccumulator = {
      promptTokens: 0,
      cachedPromptTokens: 0,
      cacheWriteTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      costMicro: 0,
      latencyMs: 0,
      attempts: 0,
      regrows: 0,
      anyCostKnown: false,
      allCostKnown: true,
      fallbackNotes: [],
    };

    return this.surplusCallStore.run(acc, async () => {
      try {
        const text = await client.chat(messages, {
          maxTokens: opts.maxTokens ?? 700,
          temperature: opts.temperature ?? 0.4,
          deadlineMs: this.llmDeadlineMs,
        });
        const resolvedModel = acc.lastModel ?? model;
        const inputTokens =
          acc.promptTokens > 0 ? acc.promptTokens : estimateTokens(`${systemPrompt}\n${prompt}`);
        const outputTokens =
          acc.completionTokens > 0 ? acc.completionTokens : estimateTokens(text);
        const costMicros =
          acc.costMicro > 0
            ? Math.round(acc.costMicro)
            : estimateLlmCostMicros({
                model: resolvedModel,
                inputTokens,
                outputTokens,
                cachedTokens: acc.cachedPromptTokens,
                cacheWriteTokens: acc.cacheWriteTokens,
              });
        return {
          ok: true,
          text,
          model: resolvedModel,
          inputTokens,
          cachedPromptTokens: acc.cachedPromptTokens,
          outputTokens,
          reasoningTokens: acc.reasoningTokens,
          costMicros,
          costUsd: costMicros / 1_000_000,
          latencyMs: acc.latencyMs,
          attempts: Math.max(1, acc.attempts),
          usageKnown: acc.anyCostKnown && acc.allCostKnown,
          fellBack: acc.fallbackNotes.length > 0,
          fallbackNotes: acc.fallbackNotes,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited =
          (err instanceof LLMError && err.detail.status === 429) || isRateLimitMessage(msg);
        const costMicros = Math.round(acc.costMicro);
        return {
          ok: false,
          text: "",
          model: acc.lastModel ?? model,
          inputTokens: acc.promptTokens,
          cachedPromptTokens: acc.cachedPromptTokens,
          outputTokens: acc.completionTokens,
          reasoningTokens: acc.reasoningTokens,
          costMicros,
          costUsd: costMicros / 1_000_000,
          latencyMs: acc.latencyMs,
          attempts: Math.max(1, acc.attempts),
          rateLimited,
          fallbackNotes: acc.fallbackNotes,
          error: msg,
        };
      }
    });
  }

  private async executeProvider(
    agent: MarketingAgent,
    provider: SubscriptionProvider,
    systemPrompt: string,
    prompt: string,
    dryRun: boolean,
    opts: DispatchTurnOptions,
  ): Promise<ProviderExecutionResponse> {
    const model = modelForProvider(provider, this.env);
    if (dryRun) {
      const text = `[dry-run:${provider}/${agent.authMode}:${agent.personaId}] ${prompt.slice(0, 180)}`;
      return {
        ok: true,
        text,
        model,
        inputTokens: estimateTokens(`${systemPrompt}\n${prompt}`),
        outputTokens: estimateTokens(text),
        costMicros: 0,
        usageKnown: false,
      };
    }

    if (provider === "surplus") {
      return this.executeSurplusProvider(agent, systemPrompt, prompt, opts);
    }

    if (agent.authMode === "cli") {
      const cmd = cliCommandForProvider(provider);
      const stdin = buildCliStdinPayload(systemPrompt, prompt);
      const res = await this.cliRunner(cmd, {
        stdin,
        timeoutMs: this.cliTimeoutMs,
        env: sanitizeCliEnv(provider, this.env),
      });
      if (res.exitCode === 0) {
        const text = res.stdout.trim() || "(ok)";
        const inputTokens = estimateTokens(stdin);
        const outputTokens = estimateTokens(text);
        return {
          ok: true,
          text,
          model,
          inputTokens,
          outputTokens,
          costMicros: estimateLlmCostMicros({ model, inputTokens, outputTokens }),
          usageKnown: false,
        };
      }
      const combined = `${res.stderr} ${res.stdout}`.trim();
      return {
        ok: false,
        text: "",
        model,
        rateLimited: isRateLimitMessage(combined),
        error: combined || `cli_exit_${res.exitCode}`,
      };
    }

    if (agent.authMode === "browser") {
      if (!this.browserRunner) {
        return {
          ok: false,
          text: "",
          model,
          error: `browser_profile runner not attached for session ${agent.sessionRef}`,
        };
      }
      return this.browserRunner({
        agent,
        provider,
        sessionRef: agent.sessionRef,
        systemPrompt,
        prompt,
      });
    }

    if (!this.oauthOrApiRunner) {
      return {
        ok: false,
        text: "",
        model,
        error: `${agent.authMode} runner not attached for provider ${provider}`,
      };
    }
    return this.oauthOrApiRunner({
      agent,
      provider,
      authMode: agent.authMode,
      sessionRef: agent.sessionRef,
      systemPrompt,
      prompt,
    });
  }
}
