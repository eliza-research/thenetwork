import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BufferedTrajectoryWriter,
  DAY,
  HOUR,
  LLMBudget,
  LeakGuard,
  MINUTE,
  MemoryTrajectoryKeyRing,
  MemoryTrajectoryManifestStore,
  R2TrajectoryBlobStore,
  SimClock,
  canJoin,
  type ChatMessage,
  type LLM,
} from "@thenetwork/core";
import { startMockServices } from "../../mock-services/src/index.ts";
import {
  DualResponseEngine,
  SimClockController,
  UNIFIED_SCENARIOS,
  UnifiedSimCoordinator,
  getUnifiedScenario,
  renderBrandOutreachTemplate,
  renderMarketingTemplate,
  type MarketingPlatform,
  type UnifiedFunnelEvent,
  type UnifiedScenarioId,
  type UnifiedTrajectorySpan,
} from "../src/index.ts";

describe("marketingTemplates", () => {
  it("produces deterministic seeded output across platforms, roles, and adversarial cases", () => {
    const req = {
      platform: "x" as MarketingPlatform,
      role: "social_user" as const,
      sentiment: "curious" as const,
      desireLane: "builders_founders" as const,
      city: "nyc",
      seedKey: "det-test-1",
    };
    const first = renderMarketingTemplate(req);
    const second = renderMarketingTemplate(req);
    expect(first).toEqual(second);
    expect(first.text.length).toBeGreaterThan(10);
    expect(first.text).not.toMatch(/\{[a-zA-Z]+\}/);

    const platforms: MarketingPlatform[] = ["x", "instagram", "tiktok", "reddit", "linkedin", "discord"];
    for (const platform of platforms) {
      const res = renderMarketingTemplate({
        platform,
        role: "social_user",
        sentiment: "warm",
        city: "sf",
        desireLane: "friends_belonging",
        seedKey: `plat-${platform}`,
      });
      expect(res.text.length).toBeGreaterThan(5);
      expect(res.stopKeyword).toBe(false);
    }

    const vip = renderMarketingTemplate({
      platform: "email",
      role: "vip",
      vipSubtype: "michelin_chef",
      sentiment: "referral",
      city: "nyc",
      seedKey: "vip-1",
    });
    expect(vip.referredHandle).toMatch(/^@/);

    const bd = renderMarketingTemplate({
      platform: "email",
      role: "bd_venue",
      venueName: "Mercer Tea House",
      sentiment: "negotiating",
      city: "nyc",
      seedKey: "bd-1",
    });
    expect(bd.text).toContain("Mercer Tea House");

    const underage = renderMarketingTemplate({
      platform: "email",
      role: "applicant",
      sentiment: "underage",
      city: "nyc",
      seedKey: "adv-underage",
    });
    expect(underage.underageSignal).toBe(true);

    const sybil = renderMarketingTemplate({
      platform: "email",
      role: "applicant",
      sentiment: "sybil",
      city: "nyc",
      seedKey: "adv-sybil",
    });
    expect(sybil.sybilSignal).toBe(true);

    const stop = renderMarketingTemplate({
      platform: "email",
      role: "email_lead",
      sentiment: "stop",
      city: "nyc",
      seedKey: "adv-stop",
    });
    expect(stop.stopKeyword).toBe(true);
  });

  it("renders clean leak-free brand outreach copy", () => {
    const guard = new LeakGuard({ canaryShapes: true, contacts: true, allow: ["https://go.ntwrk.party/nyc-1"] });
    const text = renderBrandOutreachTemplate({
      persona: "chadwick",
      city: "nyc",
      desireLane: "friends_belonging",
      linkUrl: "https://go.ntwrk.party/nyc-1",
      seedKey: "brand-1",
    });
    expect(text).toContain("NYC");
    expect(text).toContain("https://go.ntwrk.party/nyc-1");
    expect(guard.check(text)).toEqual([]);
  });
});

describe("DualResponseEngine", () => {
  it("falls back gracefully to canned mode when no API key is configured", async () => {
    const engine = new DualResponseEngine({
      mode: "hybrid",
      env: {},
      clock: new SimClock(Date.UTC(2026, 9, 5, 12)),
      seed: 42,
    });
    const stats0 = engine.getStats();
    expect(stats0.llmAvailable).toBe(false);
    expect(stats0.effectiveMode).toBe("canned");
    expect(stats0.unavailableReason).toBe("no_api_key");

    const reply = await engine.generateProspectReply(
      {
        platform: "x",
        role: "social_user",
        sentiment: "curious",
        city: "nyc",
        seedKey: "no-key-1",
      },
      {
        surface: "social_comment",
        actorId: "p1",
        threadId: "t1",
        isVipOrHighValue: true,
        currentSpeedRatio: 1,
      },
    );
    expect(reply.source).toBe("canned_fallback");
    expect(reply.text.length).toBeGreaterThan(5);
    expect(engine.getStats().cannedFallbackCount).toBe(1);
  });

  it("supports L1 cache, L2 JSONL cassette replay, speed downgrade, budget cap, concurrency semaphore, and LeakGuard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-cassette-"));
    const cassettePath = join(dir, "turns.jsonl");
    let calls = 0;
    let peakInFlight = 0;
    let currentInFlight = 0;
    let nextReply = JSON.stringify({ text: "Totally down to check out the NYC salon this week." });

    const fakeLlm: LLM = {
      async chat(_messages: ChatMessage[]) {
        calls++;
        currentInFlight++;
        if (currentInFlight > peakInFlight) peakInFlight = currentInFlight;
        await new Promise(resolve => setTimeout(resolve, 10));
        currentInFlight--;
        return nextReply;
      },
    };

    try {
      const budget = new LLMBudget({ maxCostMicro: 500_000, maxRequests: 10 });
      const engine = new DualResponseEngine({
        mode: "hybrid",
        llm: fakeLlm,
        budget,
        maxConcurrency: 2,
        cassettePath,
        clock: new SimClock(Date.UTC(2026, 9, 5, 12)),
        seed: 7,
      });

      const stopTurn = await engine.generateProspectReply(
        { platform: "email", role: "email_lead", sentiment: "stop", city: "nyc", seedKey: "s1" },
        { surface: "email_outreach", actorId: "a1", threadId: "t1", isVipOrHighValue: true, currentSpeedRatio: 1 },
      );
      expect(stopTurn.source).toBe("exact_guard");
      expect(calls).toBe(0);

      const bgFast = await engine.generateProspectReply(
        { platform: "x", role: "social_user", sentiment: "curious", city: "nyc", seedKey: "bg-fast" },
        { surface: "social_comment", actorId: "a2", threadId: "t2", isVipOrHighValue: false, currentSpeedRatio: 360 },
      );
      expect(bgFast.source).toBe("canned_fallback");
      expect(calls).toBe(0);

      const vipTurn1 = await engine.generateProspectReply(
        { platform: "email", role: "vip", sentiment: "warm", city: "nyc", seedKey: "vip-hit" },
        { surface: "email_outreach", actorId: "vip1", threadId: "tvip", isVipOrHighValue: true, currentSpeedRatio: 360 },
      );
      expect(vipTurn1.source).toBe("llm");
      expect(vipTurn1.text).toContain("NYC salon");
      expect(calls).toBe(1);

      const vipTurn2 = await engine.generateProspectReply(
        { platform: "email", role: "vip", sentiment: "warm", city: "nyc", seedKey: "vip-hit" },
        { surface: "email_outreach", actorId: "vip1", threadId: "tvip", isVipOrHighValue: true, currentSpeedRatio: 360 },
      );
      expect(vipTurn2.source).toBe("cache_l1");
      expect(calls).toBe(1);

      const turboTurn = await engine.generateProspectReply(
        { platform: "email", role: "vip", sentiment: "curious", city: "nyc", seedKey: "vip-turbo" },
        { surface: "email_outreach", actorId: "vip2", threadId: "tvip2", isVipOrHighValue: true, currentSpeedRatio: 86_400 },
      );
      expect(turboTurn.source).toBe("canned_fallback");
      expect(calls).toBe(1);

      nextReply = JSON.stringify({ text: "Call me at 212-555-0199 with code QX-4821-ORCHID" });
      const leakyBrand = await engine.generateBrandDraft({
        persona: "chadwick",
        city: "nyc",
        desireLane: "friends_belonging",
        linkUrl: "https://go.ntwrk.party/clean",
        seedKey: "leak-test",
        isVipOrHighValue: true,
      });
      expect(leakyBrand.leakBlocked).toBe(true);
      expect(leakyBrand.text).not.toContain("212-555-0199");
      expect(leakyBrand.text).not.toContain("QX-4821-ORCHID");
      expect(engine.getStats().leakBlockedCount).toBe(1);

      nextReply = JSON.stringify({ text: "Sounds fun, count me in." });
      await Promise.all(
        [1, 2, 3, 4].map(i =>
          engine.generateVoice({
            routing: {
              surface: "email_outreach",
              actorId: `conc_${i}`,
              threadId: `t_${i}`,
              intent: `warm_${i}`,
              isVipOrHighValue: true,
              currentSpeedRatio: 1,
              deterministicSeedKey: `conc_${i}`,
            },
            cannedText: "fallback",
            systemPrompt: "sys",
            userPrompt: `prompt ${i}`,
          }),
        ),
      );
      expect(peakInFlight).toBeLessThanOrEqual(2);

      const replayEngine = new DualResponseEngine({
        mode: "hybrid",
        llm: {
          async chat() {
            throw new Error("should_not_call_llm_on_cassette_hit");
          },
        },
        cassettePath,
        clock: new SimClock(Date.UTC(2026, 9, 5, 12)),
        seed: 7,
      });
      const replayed = await replayEngine.generateProspectReply(
        { platform: "email", role: "vip", sentiment: "warm", city: "nyc", seedKey: "vip-hit" },
        { surface: "email_outreach", actorId: "vip1", threadId: "tvip", isVipOrHighValue: true, currentSpeedRatio: 360 },
      );
      expect(replayed.source).toBe("cassette_l2");
      expect(replayed.text).toContain("NYC salon");

      const exhaustedBudget = new LLMBudget({ maxCostMicro: 500_000, maxRequests: 1 });
      exhaustedBudget.take("test");
      const capEngine = new DualResponseEngine({
        mode: "llm",
        llm: fakeLlm,
        budget: exhaustedBudget,
        clock: new SimClock(Date.UTC(2026, 9, 5, 12)),
        seed: 9,
      });
      const afterCap = await capEngine.generateProspectReply(
        { platform: "x", role: "social_user", sentiment: "warm", city: "nyc", seedKey: "cap-1" },
        { surface: "social_comment", actorId: "cap1", threadId: "tcap", currentSpeedRatio: 1 },
      );
      expect(afterCap.source).toBe("canned_fallback");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SimClockController", () => {
  it("supports all speed presets and manual step deltas", () => {
    const clock = new SimClock(Date.UTC(2026, 9, 5, 7));
    const ctrl = new SimClockController(clock, "paused");
    expect(ctrl.paused).toBe(true);
    expect(ctrl.speedRatio).toBe(0);

    ctrl.play();
    expect(ctrl.paused).toBe(false);
    expect(ctrl.speedRatio).toBe(60);

    ctrl.setSpeed("1x");
    expect(ctrl.speedRatio).toBe(1);
    ctrl.setSpeed("10x");
    expect(ctrl.speedRatio).toBe(10);
    ctrl.setSpeed("360x");
    expect(ctrl.speedRatio).toBe(360);
    ctrl.setSpeed("1000x");
    expect(ctrl.speedRatio).toBe(1000);
    ctrl.setSpeed("turbo");
    expect(ctrl.speedRatio).toBe(86_400);

    expect(ctrl.stepDeltaMs("+15m")).toBe(15 * MINUTE);
    expect(ctrl.stepDeltaMs("+1h")).toBe(HOUR);
    expect(ctrl.stepDeltaMs("+6h")).toBe(6 * HOUR);
    expect(ctrl.stepDeltaMs("+1d")).toBe(DAY);
    expect(ctrl.stepDeltaMs("+7d")).toBe(7 * DAY);
  });
});

describe("UnifiedSimCoordinator", () => {
  it("is deterministically reproducible in canned mode and enforces zero-tolerance safety gates", async () => {
    const spansA: UnifiedTrajectorySpan[] = [];
    const eventsA: UnifiedFunnelEvent[] = [];
    const simA = new UnifiedSimCoordinator({
      scenario: "city_launch",
      seed: 101,
      responseMode: "canned",
      populationScale: 0.08,
      onTrajectorySpan: s => spansA.push(s),
      onFunnelEvent: e => eventsA.push(e),
    });
    const simB = new UnifiedSimCoordinator({
      scenario: "city_launch",
      seed: 101,
      responseMode: "canned",
      populationScale: 0.08,
    });

    await simA.runDays(4);
    await simB.runDays(4);

    expect(simA.getDigest()).toBe(simB.getDigest());
    const snapA = simA.getSnapshot();
    const snapB = simB.getSnapshot();
    expect(snapA.scorecard.acquisition.verifiedAdultSignups).toBe(snapB.scorecard.acquisition.verifiedAdultSignups);
    expect(snapA.scorecard.acquisition.spentUsd).toBe(snapB.scorecard.acquisition.spentUsd);
    expect(snapA.scorecard.acquisition.verifiedAdultSignups).toBeGreaterThan(0);
    expect(snapA.scorecard.acquisition.under13Refused).toBeGreaterThan(0);
    expect(snapA.scorecard.clean).toBe(true);
    expect(snapA.scorecard.safety).toEqual({
      canaryLeaks: 0,
      invariantViolations: 0,
      teenRuleViolations: 0,
      stopFenceViolations: 0,
      budgetOverruns: 0,
      antifraudEscapes: 0,
    });

    for (const p of simA.world.personaList()) {
      expect(canJoin(p.hidden.trueAge)).toBe(true);
    }
    expect(spansA.length).toBeGreaterThan(0);
    expect(eventsA.some(e => e.stage === "signup_verified_adult")).toBe(true);
    expect(eventsA.some(e => e.stage === "signup_declined_under13")).toBe(true);

    const leakBlock = await simA.dispatchCommand({
      type: "reply_as_brand",
      persona: "chadwick",
      prospectId: "pr_000001",
      text: "Text me at 212-555-0199 right now",
    });
    expect(leakBlock.ok).toBe(false);
    expect(leakBlock.reason).toBe("leak_guard_blocked");

    const teenStopRes = await simA.dispatchCommand({
      type: "teen_stop",
      stop: true,
      actor: "staff_alice",
    });
    expect(teenStopRes.ok).toBe(true);
    expect(teenStopRes.snapshot.teenStop).toBe(true);
    expect(simA.getAuditLog().some(a => a.action === "teen_stop_on" && a.actor === "staff_alice")).toBe(true);
  });

  it("dispatches real HTTP calls to embedded startMockServices, injects chaos, writes Mock R2 trajectories, and checkpoints/rewinds via S3", async () => {
    const mock = await startMockServices({ port: 0, seed: 202 });
    const trajClock = new SimClock(Date.UTC(2026, 9, 5, 7));
    const blobStore = new R2TrajectoryBlobStore({
      endpoint: `${mock.url}/s3`,
      bucket: "sim-trajectories",
      accessKeyId: "mock-access",
      secretAccessKey: "mock-secret",
    });
    const manifestStore = new MemoryTrajectoryManifestStore();
    const keyRing = new MemoryTrajectoryKeyRing("test-sim-master-secret-32-bytes-minimum-key");
    const writer = new BufferedTrajectoryWriter({
      blobStore,
      manifestStore,
      keyRing,
      clock: trajClock,
      workerId: "sim-test",
      flushIntervalMs: 0,
      maxBatchSpans: 1000,
    });

    try {
      const sim = new UnifiedSimCoordinator({
        scenario: "city_launch",
        seed: 202,
        responseMode: "canned",
        populationScale: 0.06,
        mockBaseUrl: mock.url,
        onTrajectorySpan: (span) => {
          writer.record({
            schemaVersion: 1,
            traceId: span.traceId,
            spanId: span.spanId,
            app: "ntwrk",
            city: span.city,
            kind: "sim_record",
            name: span.kind,
            startedAt: span.ts,
            durationMs: span.latencyMs,
            entityType: "run",
            entityId: span.traceId,
            status: span.status === "blocked" ? "flagged" : span.status,
            payload: span.detail,
          });
        },
      });

      await sim.runDays(2);
      const flushRes = await writer.flush();
      expect(flushRes.chunksWritten).toBeGreaterThanOrEqual(1);
      expect(flushRes.spansWritten).toBeGreaterThan(10);

      const s3State = (await (await fetch(`${mock.url}/_mock/state/s3`)).json()) as {
        buckets: Record<string, string[]>;
      };
      expect((s3State.buckets["sim-trajectories"] ?? []).length).toBeGreaterThanOrEqual(1);
      const manifestRows = await manifestStore.query({ appId: "ntwrk" });
      expect(manifestRows.length).toBeGreaterThanOrEqual(1);

      const afterDay2 = sim.getSnapshot();
      expect(afterDay2.httpSummary.totalRequests).toBeGreaterThan(15);
      expect(afterDay2.httpSummary.okResponses).toBeGreaterThan(15);
      expect(afterDay2.httpSummary.s3CheckpointsWritten).toBeGreaterThanOrEqual(2);

      const traffic = mock.traffic.query({ limit: 500 });
      expect(traffic.some(e => e.service === "dub" && e.path === "/ops/dub/links")).toBe(true);
      expect(traffic.some(e => e.service === "beacon" && e.path === "/beacon/v1/events")).toBe(true);
      expect(traffic.some(e => e.service === "s3" && e.path.startsWith("/s3/sim-checkpoints/"))).toBe(true);
      expect(traffic.some(e => e.service === "s3" && e.path.startsWith("/s3/sim-trajectories/"))).toBe(true);

      await sim.dispatchCommand({
        type: "trigger_chaos",
        rule: {
          id: "test-x-429",
          service: "x",
          probability: 1,
          enabled: true,
          fault: { kind: "http_error", status: 429, retryAfterSec: 30 },
        },
      });
      for (let i = 0; i < 6; i += 1) {
        await sim.dispatchCommand({ type: "dispatch_outreach", armId: "social_organic", city: "nyc", count: 2 });
      }
      expect(sim.getSnapshot().httpSummary.rateLimited429).toBeGreaterThan(0);

      await sim.dispatchCommand({ type: "clear_chaos", id: "test-x-429" });
      await sim.dispatchCommand({ type: "set_risk_dial", dial: "blitz" });
      expect(sim.getSnapshot().riskDial).toBe("blitz");

      const rewound = await sim.dispatchCommand({ type: "rewind_checkpoint", day: 1 });
      expect(rewound.ok).toBe(true);
      expect(rewound.snapshot.riskDial).toBe("balanced");
    } finally {
      await writer.shutdown();
      await mock.stop(true);
    }
  });

  it("runs all 5 unified scenarios cleanly with chaos reactions and zero safety violations", async () => {
    expect(UNIFIED_SCENARIOS).toHaveLength(5);
    const ids: UnifiedScenarioId[] = [
      "city_launch",
      "viral_spike",
      "platform_crackdown",
      "cold_start",
      "high_volume_stress",
    ];

    for (const id of ids) {
      const preset = getUnifiedScenario(id);
      const scale = id === "high_volume_stress" ? 0.004 : id === "viral_spike" ? 0.02 : 0.04;
      const sim = new UnifiedSimCoordinator({
        scenario: preset,
        seed: 303,
        responseMode: "canned",
        populationScale: scale,
        networkKind: id === "high_volume_stress" ? "stub" : "consent",
      });

      const runDays = id === "platform_crackdown" ? 7 : id === "viral_spike" ? 5 : 4;
      const snap = await sim.runDays(runDays);

      expect(snap.scorecard.clean).toBe(true);
      expect(snap.scorecard.safety.canaryLeaks).toBe(0);
      expect(snap.scorecard.safety.invariantViolations).toBe(0);
      expect(snap.scorecard.safety.teenRuleViolations).toBe(0);
      expect(snap.scorecard.safety.stopFenceViolations).toBe(0);
      expect(snap.scorecard.safety.budgetOverruns).toBe(0);
      expect(snap.scorecard.safety.antifraudEscapes).toBe(0);

      if (id === "viral_spike") {
        expect(snap.scorecard.acquisition.antifraudBlocked + snap.scorecard.acquisition.under13Refused).toBeGreaterThan(0);
      }
      if (id === "platform_crackdown") {
        expect(snap.backpressure.lineRestricted).toBe(true);
        expect(snap.backpressure.queuePressurePaused).toBe(true);
        expect(snap.openDeviceChallenges).toBeGreaterThan(0);
        const firstChallenge = `cap:instagram`;
        const resolved = await sim.dispatchCommand({ type: "resolve_device_takeover", challengeId: firstChallenge });
        expect(resolved.ok).toBe(true);
      }
      if (id === "cold_start") {
        expect(snap.scorecard.acquisition.spentUsd).toBeLessThanOrEqual(preset.monthlyBudgetCents / 100);
      }
    }
  });

  it("enforces zero Date.now(), bare new Date(), or Math.random() in new sim modules", () => {
    const files = [
      "packages/sim/src/marketingTemplates.ts",
      "packages/sim/src/responseEngine.ts",
      "packages/sim/src/unifiedWorld.ts",
      "packages/sim/src/scenarios/unified.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/\bDate\.now\s*\(/);
      expect(src).not.toMatch(/\bnew\s+Date\s*\(\s*\)/);
      expect(src).not.toMatch(/\bMath\.random\s*\(/);
    }
  });
});
