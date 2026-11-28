import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CANARY_SHAPES,
  LLMBudget,
  LeakGuard,
  Rng,
  SimClock,
  chatJson,
  defaultLLM,
  endpointsFor,
  hash32,
  type Clock,
  type LLM,
  type ResponseInfo,
} from "@thenetwork/core";
import { PolicyPersonaAgent, decide, policyInitiative, templateText, type PolicyOptions } from "./agent/policy.ts";
import { personaCard } from "./agent/llmAgent.ts";
import type { AgentReply, Initiative, PersonaAgent, PersonaContext, PolicyDecision } from "./agent/types.ts";
import type { SimMessage } from "./channel.ts";
import { anyJson, SIM_JSON_GROW } from "./llmGenerator.ts";
import {
  renderBrandOutreachTemplate,
  renderMarketingTemplate,
  type MarketingBrandPersona,
  type MarketingDesireLane,
  type MarketingTemplateRequest,
  type MarketingTemplateResponse,
} from "./marketingTemplates.ts";

export type ResponseMode = "canned" | "hybrid" | "llm";

export type InteractionSurface =
  | "network_sms"
  | "social_comment"
  | "social_dm"
  | "email_outreach"
  | "ad_reaction"
  | "brand_agent_draft";

export type ResponseSource = "exact_guard" | "cache_l1" | "cassette_l2" | "llm" | "canned" | "canned_fallback";

export interface ResponseTurnSpan {
  ts: number;
  surface: InteractionSurface;
  actorId: string;
  threadId: string;
  source: ResponseSource;
  cacheKey: string;
  latencyMs: number;
  costMicro: number;
  leakBlocked: boolean;
  fallbackReason?: string;
}

export interface DualResponseConfig {
  mode: ResponseMode;
  budget?: LLMBudget;
  clock?: Clock;
  seed?: number | string;
  llm?: LLM;
  env?: Record<string, string | undefined>;
  hybridMaxSpeedRatio?: number;
  spotlightMaxSpeedRatio?: number;
  budgetSoftThreshold?: number;
  hybridSampleRate?: number;
  maxConcurrency?: number;
  cacheCapacity?: number;
  cassettePath?: string;
  forbiddenStrings?: string[];
  canaries?: string[];
  allowLinks?: string[];
  onTurn?: (span: ResponseTurnSpan) => void;
}

export interface ResponseRoutingContext {
  surface: InteractionSurface;
  actorId: string;
  threadId: string;
  archetype?: string;
  city?: string;
  intent: string;
  isPlayerInspected?: boolean;
  isPlayerControlled?: boolean;
  isVipOrHighValue?: boolean;
  currentSpeedRatio: number;
  deterministicSeedKey: string;
  ownCanary?: string;
}

export interface DualResponseStats {
  configuredMode: ResponseMode;
  effectiveMode: ResponseMode;
  llmAvailable: boolean;
  unavailableReason?: string;
  spentUsd: number;
  budgetCapUsd: number;
  requests: number;
  maxRequests: number;
  budgetUtilization: number;
  llmCalls: number;
  cannedCalls: number;
  exactGuardCalls: number;
  cacheHits: number;
  cassetteHits: number;
  cacheHitRate: number;
  cannedFallbackCount: number;
  leakBlockedCount: number;
  errorCount: number;
  avgLatencyMs: number;
  inFlight: number;
}

export interface GeneratedTextResult {
  text: string;
  source: ResponseSource;
  leakBlocked: boolean;
  fallbackReason?: string;
}

const DEFAULT_BUDGET_COST_MICRO = 500_000;
const DEFAULT_BUDGET_REQUESTS = 500;
const TURBO_SPEED_CUTOFF = 86_400;

const EXACT_MEMBER_INTENTS = new Set<PolicyDecision["intent"]>([
  "ignore",
  "opt_out",
  "menu_pick",
  "menu_none",
  "react",
  "plan_pick",
  "plan_none",
  "plan_cant",
  "checkin_answer",
  "crew_yes",
  "crew_no",
]);

class AsyncSemaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  get inFlight(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

class LruCache<V> {
  private map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: string, value: V): void {
    if (this.capacity <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

function scrubCanaries(text: string, canaries: readonly string[], keepOwnCanary?: string): string {
  let out = text;
  for (const canary of canaries) {
    if (!canary || canary === keepOwnCanary) continue;
    out = out.split(canary).join("");
  }
  for (const re of CANARY_SHAPES) {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    out = out.replace(globalRe, match => (keepOwnCanary && match === keepOwnCanary ? match : ""));
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export class DualResponseEngine {
  private configuredMode: ResponseMode;
  private readonly clock: Clock;
  private readonly budget: LLMBudget;
  private readonly rng: Rng;
  private readonly semaphore: AsyncSemaphore;
  private readonly l1Cache: LruCache<string>;
  private readonly l2Cassette = new Map<string, string>();
  private readonly cassettePath?: string;
  private readonly backgroundMaxSpeed: number;
  private readonly spotlightMaxSpeed: number;
  private readonly budgetSoftThreshold: number;
  private readonly hybridSampleRate: number;
  private readonly env: Record<string, string | undefined>;
  private readonly canaries: string[];
  private readonly guard: LeakGuard;
  private readonly onTurn?: (span: ResponseTurnSpan) => void;
  private llmClient?: LLM;
  private llmAvailable = false;
  private unavailableReason?: string;
  private currentSpeedRatio = 1;
  private spotlightActors = new Set<string>();
  private lastCostMicro = 0;

  private llmCalls = 0;
  private cannedCalls = 0;
  private exactGuardCalls = 0;
  private cacheHits = 0;
  private cassetteHits = 0;
  private cannedFallbackCount = 0;
  private leakBlockedCount = 0;
  private errorCount = 0;
  private latencySumMs = 0;
  private latencySamples = 0;

  constructor(config: DualResponseConfig) {
    this.configuredMode = config.mode;
    this.clock = config.clock ?? new SimClock();
    this.budget =
      config.budget ??
      new LLMBudget({ maxCostMicro: DEFAULT_BUDGET_COST_MICRO, maxRequests: DEFAULT_BUDGET_REQUESTS });
    this.rng = new Rng(hash32("dual-response", config.seed ?? 1));
    this.semaphore = new AsyncSemaphore(Math.max(1, config.maxConcurrency ?? 4));
    this.l1Cache = new LruCache<string>(config.cacheCapacity ?? 2000);
    this.cassettePath = config.cassettePath;
    this.backgroundMaxSpeed = config.hybridMaxSpeedRatio ?? 60;
    this.spotlightMaxSpeed = config.spotlightMaxSpeedRatio ?? 1000;
    this.budgetSoftThreshold = config.budgetSoftThreshold ?? 0.8;
    this.hybridSampleRate = config.hybridSampleRate ?? 0.05;
    this.env = config.env ?? (typeof process !== "undefined" ? process.env : {});
    this.canaries = [...(config.canaries ?? [])];
    this.onTurn = config.onTurn;
    this.guard = new LeakGuard({
      forbidden: config.forbiddenStrings ?? [],
      canaries: this.canaries,
      canaryShapes: true,
      contacts: true,
      allow: config.allowLinks ?? [],
    });

    if (this.cassettePath) this.loadCassette(this.cassettePath);

    if (config.llm) {
      this.llmClient = config.llm;
      this.llmAvailable = true;
    } else {
      const eps = endpointsFor("surplus", this.env);
      if (eps.length > 0) {
        this.llmAvailable = true;
      } else {
        this.llmAvailable = false;
        this.unavailableReason = "no_api_key";
      }
    }
  }

  get mode(): ResponseMode {
    return this.configuredMode;
  }

  get effectiveMode(): ResponseMode {
    if (this.configuredMode === "canned") return "canned";
    if (!this.llmAvailable || this.budget.exhausted) return "canned";
    if (this.currentSpeedRatio >= TURBO_SPEED_CUTOFF) return "canned";
    return this.configuredMode;
  }

  setMode(mode: ResponseMode): void {
    this.configuredMode = mode;
  }

  setSpeedRatio(ratio: number): void {
    if (Number.isFinite(ratio) && ratio >= 0) this.currentSpeedRatio = ratio;
  }

  setSpotlight(actorId: string, active: boolean): void {
    if (active) this.spotlightActors.add(actorId);
    else this.spotlightActors.delete(actorId);
  }

  setBudgetLimits(limits: { maxCostUsd?: number; maxRequests?: number }): void {
    const mutable = this.budget.limits as { maxCostMicro?: number; maxRequests?: number };
    if (limits.maxCostUsd !== undefined && Number.isFinite(limits.maxCostUsd) && limits.maxCostUsd >= 0) {
      mutable.maxCostMicro = Math.round(limits.maxCostUsd * 1_000_000);
    }
    if (limits.maxRequests !== undefined && Number.isFinite(limits.maxRequests) && limits.maxRequests >= 0) {
      mutable.maxRequests = Math.floor(limits.maxRequests);
    }
  }

  getBudget(): LLMBudget {
    return this.budget;
  }

  getStats(): DualResponseStats {
    const costCapMicro = this.budget.limits.maxCostMicro ?? DEFAULT_BUDGET_COST_MICRO;
    const reqCap = this.budget.limits.maxRequests ?? DEFAULT_BUDGET_REQUESTS;
    const costRatio = costCapMicro > 0 ? this.budget.spentMicro / costCapMicro : 0;
    const reqRatio = reqCap > 0 ? this.budget.requests / reqCap : 0;
    const totalCacheChecks = this.cacheHits + this.cassetteHits + this.llmCalls;
    return {
      configuredMode: this.configuredMode,
      effectiveMode: this.effectiveMode,
      llmAvailable: this.llmAvailable,
      ...(this.unavailableReason ? { unavailableReason: this.unavailableReason } : {}),
      spentUsd: Math.round((this.budget.spentMicro / 1_000_000) * 10_000) / 10_000,
      budgetCapUsd: Math.round((costCapMicro / 1_000_000) * 10_000) / 10_000,
      requests: this.budget.requests,
      maxRequests: reqCap,
      budgetUtilization: Math.min(1, Math.max(costRatio, reqRatio)),
      llmCalls: this.llmCalls,
      cannedCalls: this.cannedCalls,
      exactGuardCalls: this.exactGuardCalls,
      cacheHits: this.cacheHits,
      cassetteHits: this.cassetteHits,
      cacheHitRate: totalCacheChecks > 0 ? (this.cacheHits + this.cassetteHits) / totalCacheChecks : 0,
      cannedFallbackCount: this.cannedFallbackCount,
      leakBlockedCount: this.leakBlockedCount,
      errorCount: this.errorCount,
      avgLatencyMs: this.latencySamples > 0 ? Math.round(this.latencySumMs / this.latencySamples) : 0,
      inFlight: this.semaphore.inFlight,
    };
  }

  private ensureLlmClient(): LLM | undefined {
    if (!this.llmAvailable) return undefined;
    if (!this.llmClient) {
      try {
        this.llmClient = defaultLLM({
          budget: this.budget,
          clock: this.clock,
          rand: () => this.rng.next(),
          seed: hash32("dual-llm-seed", this.configuredMode),
          onResponse: (info: ResponseInfo) => {
            this.lastCostMicro = info.costMicro;
            this.latencySumMs += info.latencyMs;
            this.latencySamples++;
          },
        });
      } catch {
        this.llmAvailable = false;
        this.unavailableReason = "client_init_failed";
        return undefined;
      }
    }
    return this.llmClient;
  }

  private budgetUtilization(): number {
    const costCap = this.budget.limits.maxCostMicro;
    const reqCap = this.budget.limits.maxRequests;
    const costRatio = costCap && costCap > 0 ? this.budget.spentMicro / costCap : 0;
    const reqRatio = reqCap && reqCap > 0 ? this.budget.requests / reqCap : 0;
    return Math.max(costRatio, reqRatio);
  }

  private shouldUseLlm(ctx: ResponseRoutingContext): { use: boolean; fallbackReason?: string } {
    if (this.configuredMode === "canned") return { use: false };
    if (!this.llmAvailable) return { use: false, fallbackReason: this.unavailableReason ?? "no_api_key" };
    if (this.budget.exhausted) return { use: false, fallbackReason: "budget_exhausted" };

    const speed = ctx.currentSpeedRatio ?? this.currentSpeedRatio;
    if (speed >= TURBO_SPEED_CUTOFF) return { use: false, fallbackReason: "turbo_speed" };

    if (this.configuredMode === "llm") return { use: true };

    const isSpotlight = Boolean(
      ctx.isPlayerInspected ||
        ctx.isPlayerControlled ||
        ctx.isVipOrHighValue ||
        this.spotlightActors.has(ctx.actorId),
    );
    if (isSpotlight) {
      if (speed <= this.spotlightMaxSpeed) return { use: true };
      return { use: false, fallbackReason: "speed_downgrade" };
    }
    if (speed > this.backgroundMaxSpeed) {
      return { use: false, fallbackReason: "speed_downgrade" };
    }
    if (this.budgetUtilization() >= this.budgetSoftThreshold) {
      return { use: false, fallbackReason: "budget_soft_cap" };
    }
    const sampleDraw = this.rng.fork("hybrid-sample", ctx.deterministicSeedKey).bool(this.hybridSampleRate);
    return sampleDraw ? { use: true } : { use: false };
  }

  private buildCacheKey(ctx: ResponseRoutingContext, promptFingerprint: string): string {
    const hash = hash32(
      ctx.surface,
      ctx.archetype ?? "default",
      ctx.intent,
      ctx.city ?? "any",
      promptFingerprint,
    );
    return `${ctx.surface}:${ctx.intent}:${hash.toString(16)}`;
  }

  private loadCassette(path: string): void {
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = JSON.parse(trimmed) as { key?: string; text?: string };
        if (typeof parsed.key === "string" && typeof parsed.text === "string") {
          this.l2Cassette.set(parsed.key, parsed.text);
        }
      }
    } catch {
      this.errorCount++;
    }
  }

  private writeCassette(key: string, text: string): void {
    if (!this.cassettePath) return;
    this.l2Cassette.set(key, text);
    try {
      mkdirSync(dirname(this.cassettePath), { recursive: true });
      appendFileSync(this.cassettePath, `${JSON.stringify({ key, text, ts: this.clock.now() })}\n`, "utf8");
    } catch {
      this.errorCount++;
    }
  }

  private emitTurn(span: ResponseTurnSpan): void {
    this.onTurn?.(span);
  }

  private checkBrandLeak(text: string, fallbackText: string): { text: string; leakBlocked: boolean } {
    const cleaned = scrubCanaries(text, this.canaries);
    const leaks = this.guard.check(cleaned);
    if (leaks.length > 0) {
      this.leakBlockedCount++;
      return { text: fallbackText, leakBlocked: true };
    }
    return { text: cleaned, leakBlocked: false };
  }

  async generateVoice(params: {
    routing: ResponseRoutingContext;
    cannedText: string;
    systemPrompt: string;
    userPrompt: string;
    exactGuard?: boolean;
    checkBrandLeak?: boolean;
  }): Promise<GeneratedTextResult> {
    const { routing, cannedText, systemPrompt, userPrompt, exactGuard, checkBrandLeak } = params;
    const cacheKey = this.buildCacheKey(routing, `${systemPrompt.length}:${userPrompt}`);

    if (exactGuard) {
      this.exactGuardCalls++;
      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: "exact_guard",
        cacheKey,
        latencyMs: 0,
        costMicro: 0,
        leakBlocked: false,
      });
      return { text: cannedText, source: "exact_guard", leakBlocked: false };
    }

    const l1 = this.l1Cache.get(cacheKey);
    if (l1 !== undefined && this.configuredMode !== "canned") {
      this.cacheHits++;
      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: "cache_l1",
        cacheKey,
        latencyMs: 0,
        costMicro: 0,
        leakBlocked: false,
      });
      return { text: l1, source: "cache_l1", leakBlocked: false };
    }

    const l2 = this.l2Cassette.get(cacheKey);
    if (l2 !== undefined && this.configuredMode !== "canned") {
      this.cassetteHits++;
      this.l1Cache.set(cacheKey, l2);
      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: "cassette_l2",
        cacheKey,
        latencyMs: 0,
        costMicro: 0,
        leakBlocked: false,
      });
      return { text: l2, source: "cassette_l2", leakBlocked: false };
    }

    const decision = this.shouldUseLlm(routing);
    if (!decision.use) {
      if (decision.fallbackReason) this.cannedFallbackCount++;
      this.cannedCalls++;
      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: decision.fallbackReason ? "canned_fallback" : "canned",
        cacheKey,
        latencyMs: 0,
        costMicro: 0,
        leakBlocked: false,
        ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      });
      return {
        text: cannedText,
        source: decision.fallbackReason ? "canned_fallback" : "canned",
        leakBlocked: false,
        ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
      };
    }

    const client = this.ensureLlmClient();
    if (!client) {
      this.cannedFallbackCount++;
      this.cannedCalls++;
      return {
        text: cannedText,
        source: "canned_fallback",
        leakBlocked: false,
        fallbackReason: this.unavailableReason ?? "no_api_key",
      };
    }

    const t0 = performance.now();
    this.lastCostMicro = 0;
    try {
      const rawText = await this.semaphore.run(async () => {
        this.llmCalls++;
        const parsed = await chatJson(
          client,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          anyJson<{ text?: string }>,
          { attempts: 2, maxTokens: 400, temperature: 0.7, grow: SIM_JSON_GROW },
        );
        return String(parsed?.text ?? "").trim();
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!rawText) throw new Error("empty_llm_text");
      const scrubbed = scrubCanaries(rawText, this.canaries, routing.ownCanary);
      const checked = checkBrandLeak
        ? this.checkBrandLeak(scrubbed, cannedText)
        : { text: scrubbed || cannedText, leakBlocked: false };

      if (!checked.leakBlocked) {
        this.l1Cache.set(cacheKey, checked.text);
        this.writeCassette(cacheKey, checked.text);
      }

      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: "llm",
        cacheKey,
        latencyMs,
        costMicro: this.lastCostMicro,
        leakBlocked: checked.leakBlocked,
      });
      return { text: checked.text, source: "llm", leakBlocked: checked.leakBlocked };
    } catch {
      this.errorCount++;
      this.cannedFallbackCount++;
      this.cannedCalls++;
      const latencyMs = Math.round(performance.now() - t0);
      this.emitTurn({
        ts: this.clock.now(),
        surface: routing.surface,
        actorId: routing.actorId,
        threadId: routing.threadId,
        source: "canned_fallback",
        cacheKey,
        latencyMs,
        costMicro: this.lastCostMicro,
        leakBlocked: false,
        fallbackReason: "llm_error",
      });
      return {
        text: cannedText,
        source: "canned_fallback",
        leakBlocked: false,
        fallbackReason: "llm_error",
      };
    }
  }

  async generateProspectReply(
    request: MarketingTemplateRequest,
    routing: Omit<ResponseRoutingContext, "intent" | "deterministicSeedKey">,
  ): Promise<MarketingTemplateResponse & { source: ResponseSource; leakBlocked: boolean }> {
    const base = renderMarketingTemplate(request);
    const exactGuard =
      base.stopKeyword || base.underageSignal || base.sybilSignal || request.sentiment === "stop";
    const result = await this.generateVoice({
      routing: {
        ...routing,
        intent: request.sentiment,
        city: request.city ?? routing.city,
        archetype: request.archetype ?? routing.archetype,
        deterministicSeedKey: request.seedKey,
      },
      cannedText: base.text,
      systemPrompt: `Roleplay a real ${request.role} on ${request.platform} in ${request.city ?? "nyc"} with sentiment "${request.sentiment}". Return ONLY JSON {"text": string}. Keep it under 220 characters and never include phone numbers, emails, or real private data.`,
      userPrompt: `Rewrite this reaction naturally while preserving the exact intent (${request.sentiment}): "${base.text}"`,
      exactGuard,
    });
    return {
      ...base,
      text: result.text,
      source: result.source,
      leakBlocked: result.leakBlocked,
    };
  }

  async generateBrandDraft(params: {
    persona: MarketingBrandPersona;
    city: string;
    desireLane: MarketingDesireLane;
    linkUrl: string;
    seedKey: string;
    isVipOrHighValue?: boolean;
  }): Promise<GeneratedTextResult> {
    const canned = renderBrandOutreachTemplate(params);
    return this.generateVoice({
      routing: {
        surface: "brand_agent_draft",
        actorId: params.persona,
        threadId: `brand:${params.persona}:${params.city}:${params.desireLane}`,
        city: params.city,
        intent: "brand_outreach",
        isVipOrHighValue: params.isVipOrHighValue ?? false,
        currentSpeedRatio: this.currentSpeedRatio,
        deterministicSeedKey: params.seedKey,
      },
      cannedText: canned,
      systemPrompt: `You are ${params.persona}, writing concise, compliant marketing copy in Simplified Technical English. Never include phone numbers, emails, private facts, or canary codes. Return ONLY JSON {"text": string}.`,
      userPrompt: `Draft a 1-sentence outreach note for ${params.city} (${params.desireLane}) linking to ${params.linkUrl}. Baseline: "${canned}"`,
      checkBrandLeak: true,
    });
  }

  asPersonaAgent(worldStart: number, policyOpts: PolicyOptions = {}): PersonaAgent {
    const engine = this;
    const fallback = new PolicyPersonaAgent(worldStart, policyOpts);

    return {
      get mode(): "policy" | "llm" {
        return engine.effectiveMode === "canned" ? "policy" : "llm";
      },
      async respond(ctx: PersonaContext, msg: SimMessage): Promise<AgentReply> {
        const d = decide(ctx, msg, worldStart, policyOpts);
        if (d.intent === "ignore") return { ...d, action: "ignore" };
        if (d.intent === "opt_out") return { ...d, action: "reply", text: "STOP" };

        const cannedText = templateText(ctx, d);
        if (!cannedText) return { ...d, action: "ignore" };

        const exactGuard = EXACT_MEMBER_INTENTS.has(d.intent) || Boolean(d.feedback?.plan);
        const generated = await engine.generateVoice({
          routing: {
            surface: "network_sms",
            actorId: ctx.persona.id,
            threadId: `member:${ctx.persona.id}`,
            archetype: ctx.persona.archetype,
            city: ctx.persona.homeCity,
            intent: d.intent,
            isPlayerInspected: engine.spotlightActors.has(ctx.persona.id),
            currentSpeedRatio: engine.currentSpeedRatio,
            deterministicSeedKey: `${ctx.persona.id}:${msg.id}:${d.intent}`,
            ownCanary: d.disclose ? ctx.persona.hidden.privateDisclosure?.canary : undefined,
          },
          cannedText,
          systemPrompt: `${personaCard(ctx.persona)}\nReturn ONLY JSON {"text": string}. Stay brief and natural as an SMS reply.`,
          userPrompt: `Incoming SMS: "${msg.body}"\nYour decided reply meaning (${d.intent}): "${cannedText}"`,
          exactGuard,
        });

        if (d.intent === "answer_question") ctx.memory.questionsAnswered++;
        if (d.disclose) ctx.memory.disclosed = true;
        return { ...d, action: "reply", text: generated.text };
      },
      async initiative(ctx: PersonaContext): Promise<Initiative | undefined> {
        const ini = policyInitiative(ctx, worldStart, policyOpts);
        if (!ini || (ini.kind !== "ask" && ini.kind !== "travel")) return ini;
        const generated = await engine.generateVoice({
          routing: {
            surface: "network_sms",
            actorId: ctx.persona.id,
            threadId: `member:${ctx.persona.id}`,
            archetype: ctx.persona.archetype,
            city: ctx.persona.homeCity,
            intent: `initiative_${ini.kind}`,
            isPlayerInspected: engine.spotlightActors.has(ctx.persona.id),
            currentSpeedRatio: engine.currentSpeedRatio,
            deterministicSeedKey: `${ctx.persona.id}:ini:${ctx.now}`,
          },
          cannedText: ini.text,
          systemPrompt: `${personaCard(ctx.persona)}\nReturn ONLY JSON {"text": string}.`,
          userPrompt: `Rewrite this brief SMS in your voice while keeping the exact meaning: "${ini.text}"`,
        });
        return { ...ini, text: generated.text };
      },
      joinMessage(ctx: PersonaContext): Promise<string> {
        return fallback.joinMessage(ctx);
      },
    };
  }
}
