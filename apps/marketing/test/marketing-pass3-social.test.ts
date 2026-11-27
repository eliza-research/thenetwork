import { describe, expect, test } from "vitest";
import { SimClock } from "../../../packages/core/src/clock.ts";
import type { ChatOptions, ClientOptions, LLM } from "../../../packages/core/src/llm.ts";
import {
  AgentLifecycleManager,
  buildFencedAgentPrompt,
  DEFAULT_LLM_DEADLINE_MS,
  resolveSystemPrompt,
  type CliProcessRunner,
} from "../src/agent-lifecycle.ts";
import {
  CANONICAL_MARKETING_AGENTS,
  marketingLeakAllowlist,
  PERSONA_SOCIAL_PLAYBOOKS,
  renderSocialPlaybookReply,
} from "../src/constants.ts";
import { CrowdsourcingEngine } from "../src/crowdsourcing.ts";
import {
  buildPromptCacheKey,
  detectUnderageText,
  PromptCache,
  tryDeterministicRoute,
} from "../src/llm-cache.ts";
import { NullNetworkCoreBridge } from "../src/network-bridge.ts";
import { createMarketingLeakGuard } from "../src/policy.ts";
import { MemoryMarketingStore } from "../src/store.ts";
import type { OutreachChannel, PersonaId } from "../src/types.ts";
import {
  buildStarterScriptsForCity,
  lintVideoScript,
  localizeVideoScriptForCity,
  STARTER_COMEDY_SCRIPTS,
} from "../src/video-factory.ts";
import { getVipArchetype, VipDiscoveryEngine } from "../src/vip-engine.ts";

describe("Pass 3 Wave 1: marketing cache isolation, retry accounting, deterministic router & X/LinkedIn social playbooks", () => {
  const startMs = Date.parse("2026-11-27T19:00:00.000Z");

  test("1. Zero cross-contact cache poisoning, sorted untrustedContext keys, channel isolation, and strict LRU cap", async () => {
    const clock = new SimClock(startMs);
    const store = new MemoryMarketingStore({ clock });
    const campaign = await store.createCampaign({
      slug: "pass3-cache-iso",
      name: "Pass 3 Cache Isolation",
      city: "nyc",
      appId: "slop",
      status: "active",
    });

    let calls = 0;
    const llmClient: LLM = {
      chat(messages): Promise<string> {
        calls += 1;
        const userText = messages[messages.length - 1]?.content ?? "";
        if (userText.includes("Alice")) {
          return Promise.resolve("Custom reply for Alice via go.slop.date #Ad");
        }
        if (userText.includes("Bob")) {
          return Promise.resolve("Custom reply for Bob via go.slop.date #Ad");
        }
        return Promise.resolve(`Generic reply #${calls} via go.slop.date #Ad`);
      },
    };

    const manager = new AgentLifecycleManager({
      store,
      clock,
      env: {},
      dryRun: false,
      llmClient,
    });
    const [chadwick] = await manager.ensureCanonicalRoster();
    await store.updateAgent(chadwick!.id, { provider: "surplus", authMode: "api" });

    const basePrompt = "Draft a brief follow-up reply.";

    const aliceTurn = await manager.dispatchTurn(chadwick!.id, basePrompt, {
      campaignId: campaign.id,
      channel: "x",
      targetContact: { id: "h-alice", displayLabel: "Alice", lastMessageText: "Hey Alice here" },
      untrustedContext: { z_note: "second", a_note: "first" },
    });
    expect(aliceTurn.ok).toBe(true);
    expect(aliceTurn.cached).toBe(false);
    expect(aliceTurn.outputText).toContain("Alice");
    expect(calls).toBe(1);
    // Must store ONLY ONE cache entry (canonical fenced key), never double-writing raw base prompt
    expect(manager.getPromptCache().stats().size).toBe(1);

    // Same contact with reversed untrustedContext key order MUST hit cache
    const aliceReordered = await manager.dispatchTurn(chadwick!.id, basePrompt, {
      campaignId: campaign.id,
      channel: "x",
      targetContact: { id: "h-alice", displayLabel: "Alice", lastMessageText: "Hey Alice here" },
      untrustedContext: { a_note: "first", z_note: "second" },
    });
    expect(aliceReordered.ok).toBe(true);
    expect(aliceReordered.cached).toBe(true);
    expect(aliceReordered.outputText).toBe(aliceTurn.outputText);
    expect(calls).toBe(1);

    // Same base prompt with NO contact must NOT receive Alice's cached output
    const genericTurn = await manager.dispatchTurn(chadwick!.id, basePrompt, {
      campaignId: campaign.id,
      channel: "x",
    });
    expect(genericTurn.ok).toBe(true);
    expect(genericTurn.cached).toBe(false);
    expect(genericTurn.outputText).not.toContain("Alice");
    expect(calls).toBe(2);

    // Same base prompt for Bob must NOT receive Alice's or generic cached output
    const bobTurn = await manager.dispatchTurn(chadwick!.id, basePrompt, {
      campaignId: campaign.id,
      channel: "x",
      targetContact: { id: "h-bob", displayLabel: "Bob", lastMessageText: "Bob checking in" },
      untrustedContext: { a_note: "first", z_note: "second" },
    });
    expect(bobTurn.ok).toBe(true);
    expect(bobTurn.cached).toBe(false);
    expect(bobTurn.outputText).toContain("Bob");
    expect(calls).toBe(3);

    // Same prompt on LinkedIn vs X must NOT collide in cache
    const linkedinTurn = await manager.dispatchTurn(chadwick!.id, basePrompt, {
      campaignId: campaign.id,
      channel: "linkedin",
    });
    expect(linkedinTurn.ok).toBe(true);
    expect(linkedinTurn.cached).toBe(false);
    expect(calls).toBe(4);

    // buildFencedAgentPrompt produces identical string regardless of object key order
    const f1 = buildFencedAgentPrompt("Hello", { untrustedContext: { b: "2", a: "1" } });
    const f2 = buildFencedAgentPrompt("Hello", { untrustedContext: { a: "1", b: "2" } });
    expect(f1).toBe(f2);

    // Strict LRU cap & NaN safety on PromptCache
    const smallCache = new PromptCache({ clock, maxEntries: 2, defaultTtlMs: 60_000 });
    const k1 = buildPromptCacheKey({ provider: "surplus", model: "m", systemPrompt: "s", prompt: "p1" });
    const k2 = buildPromptCacheKey({ provider: "surplus", model: "m", systemPrompt: "s", prompt: "p2" });
    const k3 = buildPromptCacheKey({ provider: "surplus", model: "m", systemPrompt: "s", prompt: "p3" });
    smallCache.set(k1, { promptHash: "h1", provider: "surplus", model: "m", text: "one" });
    smallCache.set(k2, { promptHash: "h2", provider: "surplus", model: "m", text: "two" });
    expect(smallCache.get(k1)?.text).toBe("one"); // refresh k1 as MRU
    smallCache.set(k3, { promptHash: "h3", provider: "surplus", model: "m", text: "three" });
    expect(smallCache.stats().size).toBe(2);
    expect(smallCache.get(k2)).toBeNull(); // k2 evicted as LRU
    expect(smallCache.get(k1)?.text).toBe("one");
    expect(smallCache.get(k3)?.text).toBe("three");

    const nanSafeCache = new PromptCache({ clock, maxEntries: Number.NaN, defaultTtlMs: Number.NaN });
    expect(nanSafeCache.stats().maxEntries).toBe(512);
  });

  test("2. Retry/regrow token & cost accumulation, reused LLM client, and bounded 25s deadline", async () => {
    const clock = new SimClock(startMs);
    const store = new MemoryMarketingStore({ clock });
    const campaign = await store.createCampaign({
      slug: "pass3-retry-acc",
      name: "Pass 3 Retry Accumulation",
      city: "nyc",
      appId: "ntwrk",
      status: "active",
    });

    const bridgeCostRecords: Array<Record<string, unknown>> = [];
    let factoryCalls = 0;
    let capturedClientHooks: ClientOptions | undefined;
    let capturedChatOpts: ChatOptions | undefined;

    const nullBridge = new NullNetworkCoreBridge();
    const manager = new AgentLifecycleManager({
      store,
      clock,
      env: {},
      dryRun: false,
      bridge: {
        ping: () => nullBridge.ping(),
        checkContactFence: () => nullBridge.checkContactFence(),
        getDemandAndPressure: () => nullBridge.getDemandAndPressure(),
        getSupplyDemandK5: () => nullBridge.getSupplyDemandK5(),
        shouldThrottleIntake: () => nullBridge.shouldThrottleIntake(),
        getVenueClosureSignals: () => nullBridge.getVenueClosureSignals(),
        recordOperationalCost: (input) => {
          bridgeCostRecords.push(input as unknown as Record<string, unknown>);
          return Promise.resolve(true);
        },
        recordCostLedgerEntry: () => nullBridge.recordCostLedgerEntry(),
      },
      surplusClientFactory: (_provider, model, hooks) => {
        factoryCalls += 1;
        capturedClientHooks = hooks;
        return {
          chat(_messages, chatOpts): Promise<string> {
            capturedChatOpts = chatOpts;
            // Simulate 3 attempts (attempt 0 retry + attempt 1 regrow + attempt 2 success)
            hooks.onResponse?.({
              model,
              baseUrl: "https://surplus.example",
              status: 503,
              ok: false,
              latencyMs: 320,
              attempt: 0,
              regrows: 0,
              request: {},
              usage: { promptTokens: 100, completionTokens: 0, reasoningTokens: 0 },
              costMicro: 10,
              costKnown: true,
            });
            hooks.onResponse?.({
              model,
              baseUrl: "https://surplus.example",
              status: 200,
              ok: true,
              latencyMs: 480,
              attempt: 1,
              regrows: 1,
              request: {},
              data: { usage: { prompt_tokens_details: { cached_tokens: 60 } } },
              usage: { promptTokens: 200, completionTokens: 150, reasoningTokens: 90 },
              costMicro: 95,
              costKnown: true,
              finishReason: "length",
            });
            hooks.onResponse?.({
              model,
              baseUrl: "https://surplus.example",
              status: 200,
              ok: true,
              latencyMs: 410,
              attempt: 2,
              regrows: 2,
              request: {},
              data: { usage: { prompt_tokens_details: { cached_tokens: 120 } } },
              usage: { promptTokens: 200, completionTokens: 80, reasoningTokens: 30 },
              costMicro: 65,
              costKnown: true,
              finishReason: "stop",
            });
            return Promise.resolve("Reviewed 18+ invite via go.ntwrk.party #Ad");
          },
        };
      },
    });

    const roster = await manager.ensureCanonicalRoster();
    const operator = roster.find((a) => a.personaId === "operator")!;
    await store.updateAgent(operator.id, { provider: "surplus", authMode: "api" });

    const turn1 = await manager.dispatchTurn(operator.id, "Draft turn 1", {
      campaignId: campaign.id,
      skipCache: true,
    });
    expect(turn1.ok).toBe(true);
    expect(turn1.inputTokens).toBe(500); // 100 + 200 + 200
    expect(turn1.cachedPromptTokens).toBe(180); // 0 + 60 + 120
    expect(turn1.outputTokens).toBe(230); // 0 + 150 + 80
    expect(turn1.reasoningTokens).toBe(120); // 0 + 90 + 30
    expect(turn1.costMicros).toBe(170); // 10 + 95 + 65
    expect(turn1.costUsd).toBeCloseTo(0.00017, 8);
    expect(turn1.latencyMs).toBe(1210); // 320 + 480 + 410
    expect(turn1.attempts).toBe(3);

    // Bounded 25s deadline propagated to both client and chat call
    expect(capturedClientHooks?.deadlineMs).toBe(DEFAULT_LLM_DEADLINE_MS);
    expect(capturedChatOpts?.deadlineMs).toBe(DEFAULT_LLM_DEADLINE_MS);
    expect(DEFAULT_LLM_DEADLINE_MS).toBe(25_000);

    // Bridge cost record includes accumulated breakdown
    expect(bridgeCostRecords.length).toBe(1);
    expect(bridgeCostRecords[0]?.quantity).toBe(730);
    expect((bridgeCostRecords[0]?.detail as Record<string, unknown>)?.cachedPromptTokens).toBe(180);
    expect((bridgeCostRecords[0]?.detail as Record<string, unknown>)?.reasoningTokens).toBe(120);
    expect((bridgeCostRecords[0]?.detail as Record<string, unknown>)?.attempts).toBe(3);

    // Second turn reuses the same Surplus LLM client (no per-call recreation!)
    const turn2 = await manager.dispatchTurn(operator.id, "Draft turn 2", {
      campaignId: campaign.id,
      skipCache: true,
    });
    expect(turn2.ok).toBe(true);
    expect(factoryCalls).toBe(1);
  });

  test("3. Auto deterministic router offload without deterministicTaskHint & parallel autopilot ticks", async () => {
    const clock = new SimClock(startMs);
    const store = new MemoryMarketingStore({ clock });
    const campaign = await store.createCampaign({
      slug: "pass3-auto-router",
      name: "Pass 3 Auto Router",
      city: "nyc",
      appId: "all",
      riskDial: "balanced",
      status: "active",
    });

    let activeConcurrent = 0;
    let maxConcurrent = 0;
    let cliCalls = 0;
    const cliRunner: CliProcessRunner = async () => {
      cliCalls += 1;
      activeConcurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
      await new Promise((r) => setTimeout(r, 15));
      activeConcurrent -= 1;
      return { exitCode: 0, stdout: "Safe draft via go.ntwrk.party #Ad", stderr: "" };
    };

    const manager = new AgentLifecycleManager({
      store,
      clock,
      env: {},
      dryRun: false,
      cliRunner,
      autopilotConcurrency: 3,
    });
    const roster = await manager.ensureCanonicalRoster();
    const operator = roster.find((a) => a.personaId === "operator")!;

    // Without deterministicTaskHint (like /api/agents/:id/tick), prefix auto-routing offloads to 0 tokens
    const autoOptOut = await manager.dispatchTurn(operator.id, "CHECK_STOP: STOP texting me", {
      campaignId: campaign.id,
    });
    expect(autoOptOut.ok).toBe(true);
    expect(autoOptOut.deterministicRule).toBe("opt_out_check");
    expect(autoOptOut.inputTokens).toBe(0);
    expect(cliCalls).toBe(0);

    const autoScreen = await manager.dispatchTurn(
      operator.id,
      "SCREEN_APPLICANT: Hey I'm 17yo and available downtown",
      { campaignId: campaign.id },
    );
    expect(autoScreen.ok).toBe(true);
    expect(autoScreen.deterministicRule).toBe("applicant_screen");
    expect(JSON.parse(autoScreen.outputText ?? "{}").decision).toBe("rejected_underage");
    expect(cliCalls).toBe(0);

    // Explicitly passing deterministicTaskHint: null opts out of auto-routing
    const bypassed = await manager.dispatchTurn(operator.id, "CHECK_STOP: STOP", {
      campaignId: campaign.id,
      deterministicTaskHint: null,
    });
    expect(bypassed.ok).toBe(true);
    expect(bypassed.deterministicRule).toBeNull();
    expect(cliCalls).toBe(1);

    // Parallel autopilot runs up to concurrency cap (3) for 4 healthy agents
    const tick = await manager.runAutopilotTick(campaign.id);
    expect(tick.skipped).toBe(false);
    expect(tick.dispatched.length).toBe(4);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test("4. LinkedIn OutreachChannel support & X/LinkedIn social playbooks across all 5 personas", async () => {
    const clock = new SimClock(startMs);
    const store = new MemoryMarketingStore({ clock });
    const leakGuard = createMarketingLeakGuard({}, {
      allow: [...marketingLeakAllowlist()],
    });

    // LinkedIn is a first-class OutreachChannel
    const linkedInChannel: OutreachChannel = "linkedin";
    const campaign = await store.createCampaign({
      slug: "pass3-linkedin",
      name: "Pass 3 LinkedIn Outreach",
      city: "sf",
      appId: "peon",
      status: "active",
    });
    const engine = new CrowdsourcingEngine({ store, clock, env: {} });
    const peonAgent = await store.upsertAgent({
      personaId: "peon",
      displayName: "Peon",
      appId: "peon",
      provider: "gemini",
    });
    const founder = await store.upsertHuman({
      handleOrEmailHmac: "li:founder-sf-1",
      displayLabel: "Devon Chen",
      channel: linkedInChannel,
      role: "vip",
      city: "sf",
      lowestAge: 31,
    });

    const opener = renderSocialPlaybookReply("peon", "linkedin", "");
    expect(opener.disclosedAi).toBe(true);
    expect(opener.includesLink).toBe(false);
    expect(opener.reply).toContain("peon.biz");
    expect(opener.reply).toContain("STOP");
    expect(leakGuard.check(opener.reply)).toEqual([]);

    const queued = await engine.queueOutreach({
      campaignId: campaign.id,
      agentId: peonAgent.id,
      humanId: founder.id,
      channel: linkedInChannel,
      tier: 1,
      bodyText: opener.reply,
    });
    expect(queued.channel).toBe("linkedin");
    expect(queued.leakCheckPass).toBe(true);

    const dispatched = await engine.dispatchPendingOutreach(campaign.id, { dryRun: true });
    expect(dispatched.dryRun).toBe(1);

    // Every canonical persona has X & LinkedIn playbooks that pass LeakGuard & safety rules
    const personas: PersonaId[] = ["chadwick", "sloane", "peon", "venn", "operator"];
    for (const personaId of personas) {
      const spec = CANONICAL_MARKETING_AGENTS.find((a) => a.personaId === personaId)!;
      const playbook = PERSONA_SOCIAL_PLAYBOOKS[personaId];

      // System prompt injects channel playbook for X and LinkedIn
      const xSys = resolveSystemPrompt(spec, { channel: "x" });
      const liSys = resolveSystemPrompt(spec, { channel: "linkedin" });
      expect(xSys).toContain("[Channel Playbook: X");
      expect(liSys).toContain("[Channel Playbook: LINKEDIN");

      for (const ch of ["x", "linkedin"] as const) {
        // Cold opener: no premature URL, passes LeakGuard
        const cold = renderSocialPlaybookReply(personaId, ch, "hello");
        expect(cold.includesLink).toBe(false);
        expect(cold.disclosedAi).toBe(true);
        expect(leakGuard.check(cold.reply)).toEqual([]);

        // "Are you AI?" -> transparent AI disclosure, no link drop
        const aiObj = renderSocialPlaybookReply(personaId, ch, "Wait are you an AI bot?");
        expect(aiObj.objection).toBe("are_you_ai");
        expect(aiObj.disclosedAi).toBe(true);
        expect(aiObj.includesLink).toBe(false);
        expect(aiObj.reply).not.toMatch(/not\s+a\s+bot/i);
        expect(leakGuard.check(aiObj.reply)).toEqual([]);

        // STOP -> polite opt-out & suppress
        const stopObj = renderSocialPlaybookReply(personaId, ch, "STOP messaging me");
        expect(stopObj.objection).toBe("opt_out_stop");
        expect(stopObj.shouldSuppress).toBe(true);
        expect(stopObj.includesLink).toBe(false);

        // Underage -> firm 18+ refusal & suppress, no link
        const minorObj = renderSocialPlaybookReply(personaId, ch, "I'm 17yo in high school");
        expect(minorObj.objection).toBe("underage_or_minor");
        expect(minorObj.shouldSuppress).toBe(true);
        expect(minorObj.isMinor).toBe(true);
        expect(minorObj.includesLink).toBe(false);

        // Ready to join -> clean go.<brand> handoff, passes LeakGuard
        const ready = renderSocialPlaybookReply(personaId, ch, "Sounds great, send the link!");
        expect(ready.objection).toBe("ready_to_join");
        expect(ready.includesLink).toBe(true);
        expect(ready.reply).toContain(playbook.shortDomain);
        expect(leakGuard.check(ready.reply)).toEqual([]);
      }
    }
  });

  test("5. VIP CAN-SPAM opt-out, Craigslist template interpolation, SF video localization & underage guardrails", async () => {
    const clock = new SimClock(startMs);
    const store = new MemoryMarketingStore({ clock });

    // A. VIP invites all include CAN-SPAM opt-out and stay <= 75 words
    const vipEngine = new VipDiscoveryEngine({ clock });
    for (const slug of ["michelin_chef_hospitality", "oss_maintainer", "startup_founder", "ai_biotech_researcher"]) {
      const invite = vipEngine.buildAndValidateVipInvite({
        firstName: "Elena",
        archetypeSlug: slug,
        city: "sf",
        proofOfWork1Line: "your essay on distributed consensus systems",
        senderName: "The Operator",
      });
      expect(invite.valid).toBe(true);
      expect(invite.wordCount).toBeLessThanOrEqual(75);
      expect(invite.body).toMatch(/reply stop to opt out/i);
    }
    const earlyFollowUp = vipEngine.buildVipFollowUp("Elena", 2, "founder", "The Operator");
    expect(earlyFollowUp.allowed).toBe(false);
    const followUp = vipEngine.buildVipFollowUp("Elena", 14, "founder", "The Operator");
    expect(followUp.allowed).toBe(true);
    expect(followUp.body).toMatch(/reply stop to opt out/i);

    // Custom VIP body without opt-out is rejected by validateVipInvite
    const noOptOut = vipEngine.validateVipInvite(
      "Dinner Thursday",
      "Hi Elena, read your paper and hosting a 6-seat dinner Thursday in SoHo.",
      getVipArchetype("startup_founder"),
    );
    expect(noOptOut.valid).toBe(false);
    expect(noOptOut.errors).toContain("missing_can_spam_opt_out");

    // B. Craigslist template interpolation fixes (no "end of shift", no LOCAL/NYC mismatch)
    const engine = new CrowdsourcingEngine({ store, clock, env: {} });
    const packet = engine.buildHiringPacket("street_fliering", "nyc", 20_000, {
      neighborhood: "SoHo",
      shiftDate: "2026-12-01",
      shiftHours: "1:00 PM – 5:00 PM (4 hours)",
    });
    expect(packet.craigslistPost.body).toContain("(1:00 PM - 5:00 PM)");
    expect(packet.craigslistPost.body).not.toContain("end of shift");
    expect(packet.craigslistPost.body).not.toContain("LOCAL 18+ CONFIRMED");
    expect(packet.craigslistPost.body).not.toContain("your city");
    expect(packet.craigslistPost.body).toContain('"NYC 18+ CONFIRMED"');

    // C. Video localization fixes "We are building New York City first" for SF & other cities
    const operatorScript2 = STARTER_COMEDY_SCRIPTS.find((s) => s.id === "script-operator-02")!;
    const sfOperator = localizeVideoScriptForCity(operatorScript2, "sf");
    expect(sfOperator.punchline).not.toContain("building San Francisco first");
    expect(sfOperator.punchline).toContain("started in New York City");
    expect(sfOperator.punchline).toContain("San Francisco");
    for (const s of buildStarterScriptsForCity("sf")) {
      expect(lintVideoScript(s).pass).toBe(true);
    }

    // Video lint rejects deceptive AI denial and underage shorthand
    const deceptiveLint = lintVideoScript({
      ...operatorScript2,
      dialogue: "I am not a bot, I am a real person texting 17yo locals.",
    });
    expect(deceptiveLint.pass).toBe(false);
    expect(deceptiveLint.errors.some((e) => e.includes("deceptive_ai_denial"))).toBe(true);
    expect(deceptiveLint.errors.some((e) => e.includes("minor_targeting_violation"))).toBe(true);

    // D. Underage detection catches 17yo, 17 years old, turning 18 next month, high school senior
    for (const phrase of [
      "Hey I'm 17yo and love promo work",
      "17 years old, NYC 18+ CONFIRMED, available downtown",
      "Turning 18 next month, can I join?",
      "I am a high school senior looking for weekend gigs",
    ]) {
      expect(detectUnderageText(phrase).isMinor).toBe(true);
      const routed = tryDeterministicRoute({
        prompt: `SCREEN_APPLICANT: ${phrase}`,
        taskHint: "auto",
      });
      expect(routed?.handled).toBe(true);
      expect(routed?.data.decision).toBe("rejected_underage");

      const screened = await engine.screenApplicantReply({
        replyText: phrase,
        statedAge: null,
        city: "nyc",
        filterToken: "NYC 18+ CONFIRMED",
      });
      expect(screened.decision).toBe("rejected_underage");
    }

    // Adult high school coach / 24yo must NOT false-positive as underage
    expect(detectUnderageText("I'm 24 years old, former high school coach, NYC 18+ CONFIRMED").isMinor).toBe(false);
  });
});
