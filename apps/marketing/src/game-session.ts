import { randomBytes } from "node:crypto";
import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";
import { LLMBudget } from "../../../packages/core/src/llm.ts";
import {
  MemoryTrajectoryManifestStore,
} from "../../../packages/core/src/trajectory/blob-store.ts";
import { MemoryTrajectoryKeyRing } from "../../../packages/core/src/trajectory/keyring.ts";
import type {
  DecryptedTrajectorySpan,
  TrajectoryBlobStore,
  TrajectoryManifestRow,
  TrajectorySpan,
  TrajectoryStatus,
} from "../../../packages/core/src/trajectory/types.ts";
import { BufferedTrajectoryWriter } from "../../../packages/core/src/trajectory/writer.ts";
import {
  startMockServices,
  type MockServicesServer,
  type MockTrafficEntry,
} from "../../../packages/mock-services/src/index.ts";
import {
  UNIFIED_SCENARIOS,
  type SimRiskDial,
  type SimSpeedPreset,
  type UnifiedScenarioId,
  type UnifiedScenarioPreset,
} from "../../../packages/sim/src/scenarios/unified.ts";
import {
  UnifiedSimCoordinator,
  type BanditArmId,
  type BanditArmState,
  type SimStepPreset,
  type UnifiedAuditEntry,
  type UnifiedChaosRule,
  type UnifiedFunnelEvent,
  type UnifiedGameCommand,
  type UnifiedSimSnapshot,
  type UnifiedTrajectorySpan,
} from "../../../packages/sim/src/unifiedWorld.ts";
import type { MarketingBrandPersona } from "../../../packages/sim/src/marketingTemplates.ts";
import type { ResponseMode } from "../../../packages/sim/src/responseEngine.ts";
import type { City } from "../../../packages/core/src/types.ts";

class MockS3TrajectoryBlobStore implements TrajectoryBlobStore {
  readonly kind = "r2" as const;
  private readonly getBaseUrl: () => string;
  private readonly bucket: string;
  private readonly keys = new Set<string>();

  constructor(getBaseUrl: () => string, bucket = "sim-trajectories") {
    this.getBaseUrl = getBaseUrl;
    this.bucket = bucket;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const clean = key.replace(/^\/+/, "");
    const res = await fetch(`${this.getBaseUrl()}/s3/${this.bucket}/${clean}`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      throw new Error(`mock S3 PUT failed (${res.status}) for ${clean}`);
    }
    this.keys.add(clean);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const clean = key.replace(/^\/+/, "");
    const res = await fetch(`${this.getBaseUrl()}/s3/${this.bucket}/${clean}`, {
      method: "GET",
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      throw new Error(`mock S3 GET failed (${res.status}) for ${clean}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  list(prefix: string, startAfter?: string): Promise<{ keys: string[]; isTruncated: boolean }> {
    const matched = [...this.keys]
      .filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter))
      .sort();
    return Promise.resolve({ keys: matched, isTruncated: false });
  }

  async delete(key: string): Promise<void> {
    const clean = key.replace(/^\/+/, "");
    await fetch(`${this.getBaseUrl()}/s3/${this.bucket}/${clean}`, {
      method: "DELETE",
    }).catch(() => undefined);
    this.keys.delete(clean);
  }
}

export interface MarketingSimStatePayload {
  readonly active: boolean;
  readonly scenarioId: UnifiedScenarioId;
  readonly scenarios: readonly UnifiedScenarioPreset[];
  readonly snapshot: UnifiedSimSnapshot & {
    playing: boolean;
    running: boolean;
    speed: SimSpeedPreset;
    responseMode: ResponseMode;
    digest: string;
    seed: number;
    score: number;
    safetyViolations: number;
    llmBudget: {
      spentUsd: number;
      limitUsd: number;
      spentMicros: number;
      limitMicros: number;
    };
  };
  readonly mockBaseUrl: string | null;
  readonly mockStats: {
    total: number;
    byService: Record<string, number>;
    byStatus: Record<string, number>;
  };
  readonly recentEvents: UnifiedFunnelEvent[];
  readonly recentAudit: UnifiedAuditEntry[];
  readonly arms: BanditArmState[];
}

export interface MarketingGameSessionOptions {
  readonly clock?: Clock;
  readonly env?: Record<string, string | undefined>;
  readonly initialScenario?: UnifiedScenarioId;
  readonly seed?: number;
  readonly onUpdate?: (state: MarketingSimStatePayload) => void;
  readonly onFunnelEvent?: (event: UnifiedFunnelEvent) => void;
  readonly externalTrajectoryWriter?: BufferedTrajectoryWriter;
}

const VALID_SCENARIOS = new Set<string>([
  "city_launch",
  "viral_spike",
  "platform_crackdown",
  "cold_start",
  "high_volume_stress",
]);

const VALID_SPEEDS = new Set<string>(["paused", "1x", "10x", "60x", "360x", "1000x", "turbo"]);
const VALID_STEPS = new Set<string>(["+15m", "+1h", "+6h", "+1d", "+7d"]);
const VALID_RESPONSE_MODES = new Set<string>(["canned", "hybrid", "llm"]);
const VALID_DIALS = new Set<string>(["conservative", "balanced", "blitz", "lockdown"]);

function normalizeTrajectoryStatus(status: UnifiedTrajectorySpan["status"]): TrajectoryStatus {
  if (status === "blocked") return "leak_blocked";
  if (status === "fallback") return "fallback";
  if (status === "error") return "error";
  return "ok";
}

function summarizeMockTraffic(entries: readonly MockTrafficEntry[]): {
  total: number;
  byService: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const byService: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const entry of entries) {
    byService[entry.service] = (byService[entry.service] ?? 0) + 1;
    const statusBucket = `${Math.floor(entry.status / 100)}xx`;
    byStatus[statusBucket] = (byStatus[statusBucket] ?? 0) + 1;
  }
  return { total: entries.length, byService, byStatus };
}

export class MarketingGameSession {
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly onUpdate?: (state: MarketingSimStatePayload) => void;
  private readonly onFunnelEvent?: (event: UnifiedFunnelEvent) => void;
  private readonly externalTrajectoryWriter?: BufferedTrajectoryWriter;
  private readonly manifestStore = new MemoryTrajectoryManifestStore();
  private readonly keyRing: MemoryTrajectoryKeyRing;

  private mockServer: MockServicesServer | null = null;
  private simTrajectoryWriter: BufferedTrajectoryWriter | null = null;
  private coordinator: UnifiedSimCoordinator | null = null;
  private scenarioId: UnifiedScenarioId;
  private seed: number;
  private responseMode: ResponseMode = "canned";
  private llmBudgetLimitUsd = 0.5;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private stepping = false;
  private initPromise: Promise<void> | null = null;

  constructor(opts: MarketingGameSessionOptions = {}) {
    this.clock = opts.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.scenarioId = opts.initialScenario ?? "city_launch";
    this.seed = opts.seed ?? 11;
    this.onUpdate = opts.onUpdate;
    this.onFunnelEvent = opts.onFunnelEvent;
    this.externalTrajectoryWriter = opts.externalTrajectoryWriter;
    const masterKey =
      this.env.TRAJECTORY_MASTER_KEY?.trim() ||
      randomBytes(32).toString("hex");
    this.keyRing = new MemoryTrajectoryKeyRing(masterKey);
  }

  isInitialized(): boolean {
    return this.coordinator !== null;
  }

  getMockBaseUrl(): string | null {
    return this.mockServer?.url ?? null;
  }

  async ensureInitialized(): Promise<void> {
    if (this.coordinator) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.bootstrap(this.scenarioId, this.seed, this.responseMode);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async bootstrap(
    scenarioId: UnifiedScenarioId,
    seed: number,
    responseMode: ResponseMode,
  ): Promise<void> {
    this.stopPlayTimer();
    if (!this.mockServer) {
      this.mockServer = await startMockServices({
        hostname: "127.0.0.1",
        port: 0,
        seed,
      });
    }
    if (!this.simTrajectoryWriter) {
      const blobStore = new MockS3TrajectoryBlobStore(() => this.mockServer?.url ?? "", "sim-trajectories");
      this.simTrajectoryWriter = new BufferedTrajectoryWriter({
        blobStore,
        manifestStore: this.manifestStore,
        keyRing: this.keyRing,
        clock: this.clock,
        workerId: "marketing-sim",
        flushIntervalMs: 0,
        maxBatchSpans: 50,
      });
    }

    this.scenarioId = scenarioId;
    this.seed = seed;
    this.responseMode = responseMode;

    const recordSpan = (span: UnifiedTrajectorySpan): void => {
      const trajSpan: TrajectorySpan = {
        schemaVersion: 1,
        traceId: span.traceId,
        spanId: span.spanId,
        app: "marketing",
        city: span.city,
        kind: span.kind === "response_turn" ? "llm" : "sim_record",
        name: `sim:${span.kind}`,
        startedAt: span.ts,
        durationMs: span.latencyMs,
        entityType: "run",
        entityId: this.coordinator?.runId ?? scenarioId,
        status: normalizeTrajectoryStatus(span.status),
        metrics: {
          costMicros: span.costMicro,
        },
        tags: span.detail,
        payload: {
          actorId: span.actorId ?? null,
          ...span.detail,
        },
      };
      this.simTrajectoryWriter?.record(trajSpan);
      this.externalTrajectoryWriter?.record(trajSpan);
    };

    this.coordinator = new UnifiedSimCoordinator({
      scenario: scenarioId,
      seed,
      app: "ntwrk",
      mockBaseUrl: this.mockServer.url,
      responseMode,
      llmBudget: new LLMBudget({
        maxCostMicro: Math.round(this.llmBudgetLimitUsd * 1_000_000),
        maxRequests: 500,
      }),
      llmEnv: this.env,
      populationScale: 0.35,
      s3Bucket: "sim-trajectories",
      onTrajectorySpan: recordSpan,
      onFunnelEvent: (ev) => {
        this.onFunnelEvent?.(ev);
      },
    });
    await this.coordinator.init();
    this.coordinator.clockController.setSpeed("paused");
    this.coordinator.clockController.pause();
  }

  private stopPlayTimer(): void {
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  private startPlayTimer(): void {
    this.stopPlayTimer();
    this.playTimer = setInterval(() => {
      if (this.stepping || !this.coordinator || this.coordinator.clockController.paused) return;
      this.stepping = true;
      const preset = this.coordinator.clockController.speedPreset;
      const stepSize: SimStepPreset =
        preset === "turbo"
          ? "+1d"
          : preset === "1000x" || preset === "360x"
            ? "+6h"
            : preset === "60x"
              ? "+1h"
              : "+15m";
      void this.coordinator
        .step(stepSize)
        .then(async () => {
          await this.simTrajectoryWriter?.flush().catch(() => undefined);
          this.onUpdate?.(this.buildStateSnapshot());
        })
        .catch(() => undefined)
        .finally(() => {
          this.stepping = false;
        });
    }, 1_000);
    if (typeof this.playTimer.unref === "function") {
      this.playTimer.unref();
    }
  }

  private buildStateSnapshot(): MarketingSimStatePayload {
    const coord = this.coordinator!;
    const raw = coord.getSnapshot();
    const safety = raw.scorecard.safety;
    const safetyViolations =
      safety.canaryLeaks +
      safety.invariantViolations +
      safety.teenRuleViolations +
      safety.stopFenceViolations +
      safety.budgetOverruns +
      safety.antifraudEscapes;
    const spentUsd = Number((raw.responseStats.spentUsd ?? 0).toFixed(4));
    const spentMicros = Math.round(spentUsd * 1_000_000);
    const trafficEntries = this.mockServer?.traffic.query({ limit: 500 }) ?? [];

    return {
      active: true,
      scenarioId: this.scenarioId,
      scenarios: UNIFIED_SCENARIOS,
      snapshot: {
        ...raw,
        playing: !raw.paused,
        running: !raw.paused,
        speed: raw.speedPreset,
        responseMode: raw.responseStats.effectiveMode,
        digest: coord.getDigest(),
        seed: this.seed,
        score: raw.scorecard.totalScore,
        safetyViolations,
        llmBudget: {
          spentUsd,
          limitUsd: this.llmBudgetLimitUsd,
          spentMicros,
          limitMicros: Math.round(this.llmBudgetLimitUsd * 1_000_000),
        },
      },
      mockBaseUrl: this.mockServer?.url ?? null,
      mockStats: summarizeMockTraffic(trafficEntries),
      recentEvents: coord.getFunnelEvents().slice(-80),
      recentAudit: coord.getAuditLog().slice(-50),
      arms: [...coord.getArms()],
    };
  }

  async getState(): Promise<MarketingSimStatePayload> {
    await this.ensureInitialized();
    return this.buildStateSnapshot();
  }

  async dispatchCommand(raw: Record<string, unknown>): Promise<{
    ok: boolean;
    reason?: string;
    state: MarketingSimStatePayload;
  }> {
    await this.ensureInitialized();
    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    let ok: boolean;
    let reason: string | undefined;

    if (type === "reset_scenario") {
      const nextScenario =
        typeof raw.scenarioId === "string" && VALID_SCENARIOS.has(raw.scenarioId)
          ? (raw.scenarioId as UnifiedScenarioId)
          : typeof raw.scenario === "string" && VALID_SCENARIOS.has(raw.scenario)
            ? (raw.scenario as UnifiedScenarioId)
            : this.scenarioId;
      const nextSeed =
        typeof raw.seed === "number" && Number.isInteger(raw.seed) && raw.seed >= 1
          ? raw.seed
          : this.seed;
      const nextMode =
        typeof raw.responseMode === "string" && VALID_RESPONSE_MODES.has(raw.responseMode)
          ? (raw.responseMode as ResponseMode)
          : this.responseMode;
      await this.bootstrap(nextScenario, nextSeed, nextMode);
      const state = this.buildStateSnapshot();
      this.onUpdate?.(state);
      return { ok: true, state };
    }

    const coord = this.coordinator!;

    if (type === "launch_campaign") {
      const armId = (typeof raw.armId === "string" ? raw.armId : "creator_video") as BanditArmId;
      const count = typeof raw.count === "number" && Number.isFinite(raw.count) ? Math.max(1, Math.min(25, Math.round(raw.count))) : 6;
      const city = typeof raw.city === "string" ? (raw.city as City) : undefined;
      const res = await coord.dispatchCommand({ type: "dispatch_outreach", armId, city, count });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "play") {
      const res = await coord.dispatchCommand({ type: "play" });
      ok = res.ok;
      reason = res.reason;
      this.startPlayTimer();
    } else if (type === "pause") {
      this.stopPlayTimer();
      const res = await coord.dispatchCommand({ type: "pause" });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "set_speed") {
      const preset =
        typeof raw.preset === "string" && VALID_SPEEDS.has(raw.preset)
          ? (raw.preset as SimSpeedPreset)
          : typeof raw.speed === "string" && VALID_SPEEDS.has(raw.speed)
            ? (raw.speed as SimSpeedPreset)
            : "60x";
      const res = await coord.dispatchCommand({ type: "set_speed", preset });
      ok = res.ok;
      reason = res.reason;
      if (preset === "paused") this.stopPlayTimer();
    } else if (type === "step") {
      const step =
        typeof raw.step === "string" && VALID_STEPS.has(raw.step)
          ? (raw.step as SimStepPreset)
          : "+1h";
      const res = await coord.dispatchCommand({ type: "step", step });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "set_response_mode") {
      const mode =
        typeof raw.mode === "string" && VALID_RESPONSE_MODES.has(raw.mode)
          ? (raw.mode as ResponseMode)
          : "canned";
      this.responseMode = mode;
      const res = await coord.dispatchCommand({ type: "set_response_mode", mode });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "set_llm_budget") {
      const maxCostUsd =
        typeof raw.maxCostUsd === "number" && Number.isFinite(raw.maxCostUsd) && raw.maxCostUsd >= 0
          ? raw.maxCostUsd
          : undefined;
      const maxRequests =
        typeof raw.maxRequests === "number" && Number.isFinite(raw.maxRequests) && raw.maxRequests >= 0
          ? Math.round(raw.maxRequests)
          : undefined;
      if (maxCostUsd !== undefined) this.llmBudgetLimitUsd = maxCostUsd;
      const res = await coord.dispatchCommand({ type: "set_llm_budget", maxCostUsd, maxRequests });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "trigger_chaos") {
      const rule = this.buildChaosRule(raw);
      const res = await coord.dispatchCommand({ type: "trigger_chaos", rule });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "clear_chaos") {
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : undefined;
      const res = await coord.dispatchCommand({ type: "clear_chaos", id });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "reply_as_brand") {
      const persona = (typeof raw.persona === "string" ? raw.persona : "sloane") as MarketingBrandPersona;
      const prospectId = typeof raw.prospectId === "string" ? raw.prospectId : "pr_000001";
      const text = typeof raw.text === "string" ? raw.text : "";
      const res = await coord.dispatchCommand({ type: "reply_as_brand", persona, prospectId, text });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "set_risk_dial") {
      const dial =
        typeof raw.dial === "string" && VALID_DIALS.has(raw.dial)
          ? (raw.dial as SimRiskDial)
          : "balanced";
      const res = await coord.dispatchCommand({ type: "set_risk_dial", dial });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "tweak_bandit_arm") {
      const cmd: UnifiedGameCommand = {
        type: "tweak_bandit_arm",
        armId: (typeof raw.armId === "string" ? raw.armId : "creator_video") as BanditArmId,
        paused: typeof raw.paused === "boolean" ? raw.paused : undefined,
        weightOverride: typeof raw.weightOverride === "number" ? raw.weightOverride : undefined,
        dailyCapCents: typeof raw.dailyCapCents === "number" ? raw.dailyCapCents : undefined,
      };
      const res = await coord.dispatchCommand(cmd);
      ok = res.ok;
      reason = res.reason;
    } else if (type === "dispatch_outreach") {
      const cmd: UnifiedGameCommand = {
        type: "dispatch_outreach",
        armId: (typeof raw.armId === "string" ? raw.armId : "cold_email") as BanditArmId,
        city: typeof raw.city === "string" ? (raw.city as City) : undefined,
        count: typeof raw.count === "number" ? raw.count : 4,
      };
      const res = await coord.dispatchCommand(cmd);
      ok = res.ok;
      reason = res.reason;
    } else if (type === "resolve_device_takeover") {
      const challengeId = typeof raw.challengeId === "string" ? raw.challengeId : "";
      const res = await coord.dispatchCommand({ type: "resolve_device_takeover", challengeId });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "teen_stop") {
      const stop = raw.stop !== false;
      const actor = typeof raw.actor === "string" && raw.actor.trim() ? raw.actor.trim() : "operator";
      const res = await coord.dispatchCommand({ type: "teen_stop", stop, actor });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "trigger_world_event") {
      const event = (
        typeof raw.event === "string" ? raw.event : "viral_mention"
      ) as "viral_mention" | "sybil_ring_attack" | "minor_wave" | "venue_closure" | "opt_out";
      const city = typeof raw.city === "string" ? (raw.city as City) : undefined;
      const res = await coord.dispatchCommand({ type: "trigger_world_event", event, city });
      ok = res.ok;
      reason = res.reason;
    } else if (type === "rewind_checkpoint") {
      const day = typeof raw.day === "number" && Number.isInteger(raw.day) ? raw.day : 0;
      const res = await coord.dispatchCommand({ type: "rewind_checkpoint", day });
      ok = res.ok;
      reason = res.reason;
    } else {
      ok = false;
      reason = `unsupported_sim_command:${type}`;
    }

    await this.simTrajectoryWriter?.flush().catch(() => undefined);
    const state = this.buildStateSnapshot();
    this.onUpdate?.(state);
    return { ok, ...(reason ? { reason } : {}), state };
  }

  private buildChaosRule(raw: Record<string, unknown>): UnifiedChaosRule {
    if (raw.rule && typeof raw.rule === "object" && !Array.isArray(raw.rule)) {
      return raw.rule as UnifiedChaosRule;
    }
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `chaos-${this.clock.now()}`;
    const service = typeof raw.service === "string" && raw.service.trim() ? raw.service.trim() : "all";
    const probability =
      typeof raw.probability === "number" && Number.isFinite(raw.probability)
        ? Math.max(0, Math.min(1, raw.probability))
        : 0.5;
    const faultKind = typeof raw.faultKind === "string" ? raw.faultKind : typeof raw.fault === "string" ? raw.fault : "rate_limit_spike";
    let fault: UnifiedChaosRule["fault"];
    if (faultKind === "shadowban_wave") {
      fault = { kind: "shadowban_wave", reachMultiplier: 0.25 };
    } else if (faultKind === "captcha_wave") {
      fault = { kind: "captcha_wave", probability: 0.6 };
    } else if (faultKind === "blooio_safety") {
      fault = { kind: "blooio_safety", action: "new_conversations_paused" };
    } else if (faultKind === "email_bounce_storm") {
      fault = { kind: "email_bounce_storm", hardBounceRate: 0.08, spamComplaintRate: 0.01 };
    } else if (faultKind === "http_error") {
      fault = { kind: "http_error", status: 503, retryAfterSec: 15 };
    } else {
      fault = { kind: "rate_limit_spike", multiplier: 4, retryAfterSec: 30 };
    }
    return {
      id,
      service,
      probability,
      fault,
      enabled: raw.enabled !== false,
    };
  }

  getMockTraffic(filter?: { service?: string; status?: number; limit?: number }): {
    entries: MockTrafficEntry[];
    stats: { total: number; byService: Record<string, number>; byStatus: Record<string, number> };
  } {
    if (!this.mockServer) {
      return { entries: [], stats: { total: 0, byService: {}, byStatus: {} } };
    }
    const entries = this.mockServer.traffic.query({
      service: filter?.service,
      status: filter?.status,
      limit: filter?.limit ?? 100,
    });
    return { entries, stats: summarizeMockTraffic(entries) };
  }

  async getMockServiceState(service: string): Promise<Record<string, unknown>> {
    if (!this.mockServer) return {};
    const res = await fetch(`${this.mockServer.url}/_mock/state/${encodeURIComponent(service)}`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  }

  async listSimTrajectories(limit = 50): Promise<{
    traces: TrajectoryManifestRow[];
    hotTail: TrajectorySpan[];
  }> {
    await this.simTrajectoryWriter?.flush().catch(() => undefined);
    const traces = await this.manifestStore.query({ appId: "marketing", limit });
    const hotTail = this.simTrajectoryWriter?.tailHot({ app: "marketing", limit }) ?? [];
    return { traces, hotTail };
  }

  async readSimTrace(traceId: string, decrypt: boolean): Promise<{
    manifest: TrajectoryManifestRow | null;
    spans: DecryptedTrajectorySpan[];
  }> {
    await this.simTrajectoryWriter?.flush().catch(() => undefined);
    const manifest = (await this.manifestStore.getByTraceId("marketing", traceId)) ?? null;
    const spans = this.simTrajectoryWriter
      ? await this.simTrajectoryWriter.readTrace("marketing", traceId, { decrypt })
      : [];
    return { manifest, spans };
  }

  async stop(): Promise<void> {
    this.stopPlayTimer();
    if (this.simTrajectoryWriter) {
      await this.simTrajectoryWriter.shutdown().catch(() => undefined);
      this.simTrajectoryWriter = null;
    }
    if (this.mockServer) {
      await this.mockServer.stop(true).catch(() => undefined);
      this.mockServer = null;
    }
    this.coordinator = null;
  }
}
