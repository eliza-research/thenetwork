// Subscription-connected multi-agent lifecycle coordinator for @thenetwork/marketing (Node 26).
// Manages the 5 branded agents (Chadwick, Sloane, Peon, Venn, The Operator) and any
// additional agents connected via ChatGPT, Claude, Gemini, or Surplus subscriptions.
// Enforces Vibestack-generated canDispatchAgentTurn via ./policy.ts, automatic provider
// failover on rate limits without bouncing back to tried providers, sanitized CLI env,
// bounded process output, and core LeakGuard + parseOptOut safety middleware.

import { RealClock } from "../../../packages/core/src/clock.ts";
import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { spawnProcess } from "../../../packages/core/src/runtime/process.ts";
import {
  CANONICAL_MARKETING_AGENTS,
  FALLBACK_PROVIDER_ORDER,
  type CanonicalAgentSpec,
} from "./constants.ts";
import { evaluateAgentTurnPolicy } from "./policy.ts";
import type { MarketingStore, UpsertAgentInput } from "./store.ts";
import type {
  AgentAuthMode,
  Clock,
  HumanPartner,
  MarketingAgent,
  SubscriptionProvider,
} from "./types.ts";

export { CANONICAL_MARKETING_AGENTS, type CanonicalAgentSpec };

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
  rateLimited?: boolean;
  cooldownMs?: number;
  error?: string;
}

export type BrowserSessionRunner = (req: {
  agent: MarketingAgent;
  provider: SubscriptionProvider;
  sessionRef: string;
  prompt: string;
}) => Promise<ProviderExecutionResponse>;

export type OAuthOrApiRunner = (req: {
  agent: MarketingAgent;
  provider: SubscriptionProvider;
  authMode: AgentAuthMode;
  sessionRef: string;
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
  leakGuard?: LeakGuard;
  defaultCooldownMs?: number;
  cliTimeoutMs?: number;
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
  stopped?: boolean;
  banned?: boolean;
  lastMessageText?: string;
}

export interface DispatchTurnOptions {
  campaignId?: string | null;
  targetContact?: HumanPartner | TargetContactRef | null;
  lockdown?: boolean;
  allowFailover?: boolean;
  dryRun?: boolean;
}

export interface AgentTurnResult {
  ok: boolean;
  agent: MarketingAgent;
  providerUsed: SubscriptionProvider;
  failedOverFrom: SubscriptionProvider | null;
  authMode: AgentAuthMode;
  outputText: string | null;
  leakReasons: string[];
  blockedReason?: string;
  dryRun: boolean;
  dispatchedAt: string;
}

export interface AutopilotTickResult {
  campaignId: string;
  skipped: boolean;
  skipReason?: string;
  checkedAt: string;
  heartbeats: AgentHeartbeatResult[];
  dispatched: AgentTurnResult[];
}

const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_CLI_TIMEOUT_MS = 30_000;
const CLI_KILL_GRACE_MS = 1_500;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;

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

const DEFAULT_MARKETING_LEAK_ALLOW: readonly string[] = [
  "ops-nyc@ntwrk.party",
  "ntwrk.party",
  "slop.date",
  "peon.biz",
  "friends.help",
  "go.ntwrk.party",
  "go.slop.date",
  "go.peon.biz",
  "go.friends.help",
];

/** Builds a minimal non-secret environment for subscription CLI subprocesses. */
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

function isRateLimitMessage(text: string): boolean {
  return /\b(429|rate[ -]?limit|quota|too many requests|limit reached|try again later|capacity)\b/i.test(
    text,
  );
}

function cliCommandForProvider(provider: SubscriptionProvider, prompt: string): string[] {
  if (provider === "claude") return ["claude", "-p", prompt];
  if (provider === "chatgpt") return ["codex", "exec", prompt];
  if (provider === "gemini") return ["gemini", "-p", prompt];
  return ["codex", "exec", prompt];
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
  private readonly leakGuard: LeakGuard;
  private readonly defaultCooldownMs: number;
  private readonly cliTimeoutMs: number;

  constructor(opts: AgentLifecycleOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.dryRunDefault = opts.dryRun ?? this.env.MARKETING_LIVE_AGENTS !== "1";
    this.cliRunner = opts.cliRunner ?? defaultCliRunner;
    this.browserRunner = opts.browserRunner;
    this.oauthOrApiRunner = opts.oauthOrApiRunner;
    this.leakGuard =
      opts.leakGuard ??
      new LeakGuard({
        contacts: true,
        canaryShapes: true,
        allow: [...DEFAULT_MARKETING_LEAK_ALLOW],
      });
    this.defaultCooldownMs = opts.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.cliTimeoutMs = opts.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  }

  /** Ensures all 5 canonical branded agents exist in the store. */
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

  /** Registers or updates an agent bound to a ChatGPT, Claude, Gemini, or Surplus subscription. */
  async registerAgent(
    input: Omit<UpsertAgentInput, "authMode"> & { authMode?: SubscriptionConnectionMode },
  ): Promise<MarketingAgent> {
    return this.store.upsertAgent({
      ...input,
      authMode: input.authMode ? normalizeAuthMode(input.authMode) : "cli",
    });
  }

  /** Checks agent session health, clears expired cooldowns, and returns remaining daily quota. */
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

  /**
   * Dispatches one turn on a subscription-connected agent.
   * Strictly checks proved marketingPolicy.canDispatchAgentTurn via evaluateAgentTurnPolicy,
   * respects contact STOP fences (and parses opt-outs on lastMessageText),
   * runs LeakGuard on output, and fails over across untried backup subscription
   * providers when rate-limited.
   */
  async dispatchTurn(
    agentId: string,
    prompt: string,
    opts: DispatchTurnOptions = {},
  ): Promise<AgentTurnResult> {
    const nowMs = this.clock.now();
    const dispatchedAt = new Date(nowMs).toISOString();
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
    let targetStopped = false;
    if (opts.targetContact) {
      if ("handleOrEmailHmac" in opts.targetContact) {
        targetHumanId = opts.targetContact.id;
        targetStopped = opts.targetContact.stopped || opts.targetContact.banned;
      } else {
        targetHumanId = opts.targetContact.id ?? null;
        if (targetHumanId) {
          const persisted = await this.store.getHuman(targetHumanId);
          if (persisted && (persisted.stopped || persisted.banned)) {
            targetStopped = true;
          }
        }
        if (opts.targetContact.stopped || opts.targetContact.banned) {
          targetStopped = true;
        }
        if (opts.targetContact.lastMessageText) {
          const reading = parseOptOut(opts.targetContact.lastMessageText);
          if (reading.match !== "none") {
            targetStopped = true;
            if (targetHumanId) {
              await this.store.markHumanStopped(targetHumanId, `opt_out_${reading.match}`);
            }
          }
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
          authMode: agent.authMode,
          outputText: null,
          leakReasons: [],
          blockedReason: policyDecision.reason ?? "policy_blocked",
          dryRun,
          dispatchedAt,
        };
      }
    }

    let exec = await this.executeProvider(agent, activeProvider, prompt, dryRun);
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
      agent = await this.store.updateAgent(agent.id, {
        provider: backup,
        failoverProvider: prevProvider,
        status: "idle",
        cooldownUntil: null,
      });
      exec = await this.executeProvider(agent, activeProvider, prompt, dryRun);
    }

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
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        authMode: agent.authMode,
        outputText: null,
        leakReasons: [],
        blockedReason: exec.rateLimited ? "rate_limited" : (exec.error ?? "provider_error"),
        dryRun,
        dispatchedAt,
      };
    }

    const leakReasons = this.leakGuard.check(exec.text);
    if (leakReasons.length > 0) {
      return {
        ok: false,
        agent,
        providerUsed: activeProvider,
        failedOverFrom,
        authMode: agent.authMode,
        outputText: null,
        leakReasons,
        blockedReason: "leak_guard_blocked",
        dryRun,
        dispatchedAt,
      };
    }

    const consumed = await this.store.consumeAgentTurn({
      agentId: agent.id,
      campaignId: opts.campaignId ?? null,
      targetHumanId,
      targetStopped,
      lockdown,
    });
    if (!consumed.allowed) {
      return {
        ok: false,
        agent: consumed.agent,
        providerUsed: activeProvider,
        failedOverFrom,
        authMode: agent.authMode,
        outputText: null,
        leakReasons: [],
        blockedReason: consumed.reason ?? "policy_blocked",
        dryRun,
        dispatchedAt,
      };
    }

    return {
      ok: true,
      agent: consumed.agent,
      providerUsed: activeProvider,
      failedOverFrom,
      authMode: consumed.agent.authMode,
      outputText: exec.text,
      leakReasons: [],
      dryRun,
      dispatchedAt,
    };
  }

  async runAutopilotTick(campaignId: string): Promise<AutopilotTickResult> {
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
      (t) => t.status === "drafted" || t.status === "posted_or_emailed" || t.status === "applicant_screened",
    );

    const dispatched: AgentTurnResult[] = [];
    const maxPerTick =
      campaign.riskDial === "conservative" ? 2 : campaign.riskDial === "balanced" ? 4 : 6;

    for (const hb of heartbeats) {
      if (dispatched.length >= maxPerTick) break;
      if (!hb.healthy) continue;

      const task = openTasks[dispatched.length];
      const prompt = task
        ? `[Campaign ${campaign.slug} | ${campaign.city}] Advance task "${task.title}" (${task.taskKind}, status=${task.status}) while obeying 18+, FTC #Ad, and STOP rules.`
        : `[Campaign ${campaign.slug} | ${campaign.city}] Prepare next ${hb.agent.displayName} (${hb.agent.appId}) zero-cost ${campaign.city.toUpperCase()} discovery and outreach draft.`;

      const targetHuman = task?.assigneeHumanId
        ? await this.store.getHuman(task.assigneeHumanId)
        : null;

      const res = await this.dispatchTurn(hb.agent.id, prompt, {
        campaignId: campaign.id,
        targetContact: targetHuman,
        lockdown: false,
      });
      dispatched.push(res);
    }

    return {
      campaignId,
      skipped: false,
      checkedAt,
      heartbeats,
      dispatched,
    };
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

  private async executeProvider(
    agent: MarketingAgent,
    provider: SubscriptionProvider,
    prompt: string,
    dryRun: boolean,
  ): Promise<ProviderExecutionResponse> {
    if (dryRun) {
      return {
        ok: true,
        text: `[dry-run:${provider}/${agent.authMode}:${agent.personaId}] ${prompt.slice(0, 180)}`,
      };
    }

    if (agent.authMode === "cli") {
      const cmd = cliCommandForProvider(provider, prompt);
      const res = await this.cliRunner(cmd, {
        timeoutMs: this.cliTimeoutMs,
        env: sanitizeCliEnv(provider, this.env),
      });
      if (res.exitCode === 0) {
        return { ok: true, text: res.stdout.trim() || "(ok)" };
      }
      const combined = `${res.stderr} ${res.stdout}`.trim();
      return {
        ok: false,
        text: "",
        rateLimited: isRateLimitMessage(combined),
        error: combined || `cli_exit_${res.exitCode}`,
      };
    }

    if (agent.authMode === "browser") {
      if (!this.browserRunner) {
        return {
          ok: false,
          text: "",
          error: `browser_profile runner not attached for session ${agent.sessionRef}`,
        };
      }
      return this.browserRunner({
        agent,
        provider,
        sessionRef: agent.sessionRef,
        prompt,
      });
    }

    if (!this.oauthOrApiRunner) {
      return {
        ok: false,
        text: "",
        error: `${agent.authMode} runner not attached for provider ${provider}`,
      };
    }
    return this.oauthOrApiRunner({
      agent,
      provider,
      authMode: agent.authMode,
      sessionRef: agent.sessionRef,
      prompt,
    });
  }
}
