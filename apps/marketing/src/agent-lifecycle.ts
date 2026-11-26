// Subscription-connected multi-agent lifecycle coordinator for @thenetwork/marketing (Node 26).
// Manages the 5 branded agents (Chadwick, Sloane, Peon, Venn, The Operator) and any
// additional agents connected via ChatGPT, Claude, Gemini, or Surplus subscriptions.
// Enforces Vibestack-generated canDispatchAgentTurn, automatic provider failover
// on rate limits, and core LeakGuard + parseOptOut safety middleware.

import { RealClock } from "../../../packages/core/src/clock.ts";
import { canDispatchAgentTurn } from "../../../packages/core/src/generated/marketingPolicy.ts";
import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { spawnProcess } from "../../../packages/core/src/runtime/process.ts";
import type { MarketingStore, UpsertAgentInput } from "./store.ts";
import type {
  AgentAuthMode,
  Clock,
  HumanPartner,
  MarketingAgent,
  SubscriptionProvider,
} from "./types.ts";

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

export interface CanonicalAgentSpec extends UpsertAgentInput {
  systemPrompt: string;
}

export const CANONICAL_MARKETING_AGENTS: readonly CanonicalAgentSpec[] = [
  {
    personaId: "chadwick",
    displayName: "Chadwick",
    appId: "ntwrk",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "codex:chadwick-nyc",
    dailyTurnCap: 60,
    systemPrompt:
      "You are Chadwick, NYC social & hospitality connector for The Network (ntwrk.party). Speak concisely, never leak private contacts, and respect STOP opt-outs.",
  },
  {
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    provider: "claude",
    failoverProvider: "gemini",
    authMode: "cli",
    sessionRef: "claude:sloane-nyc",
    dailyTurnCap: 60,
    systemPrompt:
      "You are Sloane, dating growth and creator-partnerships agent for slop.date (18+ only). Never contact minors, enforce FTC #Ad disclosure, and respect STOP opt-outs.",
  },
  {
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    provider: "gemini",
    failoverProvider: "chatgpt",
    authMode: "cli",
    sessionRef: "gemini:peon-nyc",
    dailyTurnCap: 60,
    systemPrompt:
      "You are Peon, builder/career networking and OSS growth agent for peon.biz. Keep outreach authentic, never spam, and honor STOP immediately.",
  },
  {
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    provider: "claude",
    failoverProvider: "chatgpt",
    authMode: "cli",
    sessionRef: "claude:venn-nyc",
    dailyTurnCap: 60,
    systemPrompt:
      "You are Venn, NYC friend-group and local event community agent for friends.help. Coordinate local IRL events and honor STOP immediately.",
  },
  {
    personaId: "operator",
    displayName: "The Operator",
    appId: "ntwrk",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "codex:operator-nyc",
    dailyTurnCap: 80,
    systemPrompt:
      "You are The Operator, campaign coordinator for The Network across ntwrk.party, slop.date, peon.biz, and friends.help. Enforce 18+ rules, budget caps, proof checks, and STOP fences.",
  },
];

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
const DEFAULT_CLI_TIMEOUT_MS = 20_000;
const FALLBACK_PROVIDER_ORDER: readonly SubscriptionProvider[] = ["claude", "chatgpt", "gemini"];

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

async function defaultCliRunner(
  cmd: readonly string[],
  opts: { stdin?: string; timeoutMs: number; env?: Record<string, string | undefined> },
): Promise<CliRunResult> {
  try {
    const proc = spawnProcess(cmd, {
      stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: opts.env,
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process already exited.
      }
    }, opts.timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
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
    this.leakGuard = opts.leakGuard ?? new LeakGuard({ contacts: false });
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
        roster.push(await this.store.upsertAgent(spec));
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
    const healthy =
      agent.sessionHealthy &&
      agent.status !== "paused_stop" &&
      agent.status !== "rate_limited" &&
      !cooldownActive &&
      remainingTurnsToday > 0;

    let reason: string | undefined;
    if (agent.status === "paused_stop") reason = "paused_stop";
    else if (cooldownActive || agent.status === "rate_limited") reason = "cooldown_or_rate_limited";
    else if (!agent.sessionHealthy) reason = "session_unhealthy";
    else if (remainingTurnsToday <= 0) reason = "daily_turn_cap_reached";

    return {
      agent,
      healthy,
      inCooldown: cooldownActive,
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
   * Strictly checks proved marketingPolicy.canDispatchAgentTurn before executing,
   * respects contact STOP fences (and parses opt-outs on lastMessageText),
   * runs LeakGuard on output, and automatically fails over to a healthy backup
   * subscription provider when rate-limited.
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

    const inCooldown = agent.cooldownUntil !== null && Date.parse(agent.cooldownUntil) > nowMs;
    const precheckAllowed = canDispatchAgentTurn(
      agent.status === "paused_stop",
      agent.status === "rate_limited" || inCooldown,
      agent.sessionHealthy,
      agent.turnsUsedToday,
      agent.dailyTurnCap,
      targetStopped,
      lockdown,
    );

    const allowFailover = opts.allowFailover !== false;
    let activeProvider = agent.provider;
    let failedOverFrom: SubscriptionProvider | null = null;

    if (!precheckAllowed) {
      const onlyRateLimited =
        agent.status !== "paused_stop" &&
        agent.sessionHealthy &&
        agent.turnsUsedToday < agent.dailyTurnCap &&
        !targetStopped &&
        !lockdown &&
        (agent.status === "rate_limited" || inCooldown);

      const backup = this.pickBackupProvider(agent);
      if (onlyRateLimited && allowFailover && backup) {
        failedOverFrom = agent.provider;
        activeProvider = backup;
        agent = await this.store.updateAgent(agent.id, {
          provider: backup,
          failoverProvider: failedOverFrom,
          status: "idle",
          cooldownUntil: null,
        });
      } else {
        const blockedReason = targetStopped
          ? "target_stopped"
          : lockdown
            ? "campaign_lockdown"
            : agent.status === "paused_stop"
              ? "agent_paused"
              : !agent.sessionHealthy
                ? "session_unhealthy"
                : agent.turnsUsedToday >= agent.dailyTurnCap
                  ? "daily_turn_cap_reached"
                  : "rate_limited";
        return {
          ok: false,
          agent,
          providerUsed: activeProvider,
          failedOverFrom: null,
          authMode: agent.authMode,
          outputText: null,
          leakReasons: [],
          blockedReason,
          dryRun,
          dispatchedAt,
        };
      }
    }

    let exec = await this.executeProvider(agent, activeProvider, prompt, dryRun);
    if (!exec.ok && exec.rateLimited && allowFailover) {
      const backup = this.pickBackupProvider({ ...agent, provider: activeProvider });
      if (backup) {
        failedOverFrom = activeProvider;
        activeProvider = backup;
        agent = await this.store.updateAgent(agent.id, {
          provider: backup,
          failoverProvider: failedOverFrom,
          status: "idle",
          cooldownUntil: null,
        });
        exec = await this.executeProvider(agent, activeProvider, prompt, dryRun);
      }
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
        : `[Campaign ${campaign.slug} | ${campaign.city}] Prepare next ${hb.agent.displayName} (${hb.agent.appId}) zero-cost NYC discovery and outreach draft.`;

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

  private pickBackupProvider(agent: MarketingAgent): SubscriptionProvider | null {
    if (agent.failoverProvider && agent.failoverProvider !== agent.provider) {
      return agent.failoverProvider;
    }
    for (const candidate of FALLBACK_PROVIDER_ORDER) {
      if (candidate !== agent.provider) return candidate;
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
        env: this.env,
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
