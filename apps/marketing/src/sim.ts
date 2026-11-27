import { createHash } from "node:crypto";
import { SimClock } from "../../../packages/core/src/clock.ts";
import type { ChatMessage, LLM } from "../../../packages/core/src/llm.ts";
import { Rng } from "../../../packages/core/src/rng.ts";
import { AgentLifecycleManager } from "./agent-lifecycle.ts";
import {
  AntiFraudEngine,
  detectSybilCluster,
  type SybilClaimNode,
} from "./antifraud.ts";
import {
  computeBanditAllocations,
  createDefaultCityBanditArms,
  recordBanditObservation,
  type BanditArm as AllocatorBanditArm,
} from "./bandit.ts";
import { BdPipelineEngine } from "./bd-engine.ts";
import { seedCityLaunch } from "./city-launch-engine.ts";
import { requireCityPack } from "./city-registry.ts";
import { MarketingAutopilotDaemon } from "./daemon.ts";
import { DeviceBridge } from "./devices/bridge.ts";
import {
  assertProofAndAdultForPayoutPolicy,
  assertSpendAuth,
  createMarketingLeakGuard,
  evaluateContactHygiene,
  evaluateQueuePressure,
  minAgeReading,
  PolicyViolationError,
} from "./policy.ts";
import { SlopCashBridge, SlopCashDisabledError } from "./slop-cash-bridge.ts";
import { MemoryMarketingStore } from "./store.ts";
import type { CityAppDemandSignal, DeviceNode } from "./types.ts";
import { buildStarterScriptsForCity, lintVideoScript } from "./video-factory.ts";
import { VipDiscoveryEngine } from "./vip-engine.ts";

export interface MarketingSimOptions {
  seed?: number;
  days?: number;
  cities?: readonly string[];
  dailyLlmTokenCap?: number;
  dailyLlmCostCapMicros?: number;
  quick?: boolean;
}

export interface MarketingSimGateResult {
  id: string;
  name: string;
  pass: boolean;
  blocking: boolean;
  value: number | string | boolean;
  target: string;
  detail: string;
}

export interface MarketingSimCitySummary {
  city: string;
  stage: string;
  campaignId: string;
  verifiedSignups: number;
  totalSpentCents: number;
  blendedCpaCents: number;
  uniformCpaCents: number;
  banditCpaImprovementPct: number;
  liquidityTargetSignups: number;
  liquidityReached: boolean;
  scriptsLintedClean: number;
  vipInvitesClean: number;
  bdDealsBlockedUnsafe: number;
}

export interface MarketingSimAdversarialSummary {
  minorViolations: number;
  leakEscapes: number;
  budgetOverruns: number;
  antifraudViolations: number;
  sybilClustersDetected: number;
  sybilClaimsQuarantined: number;
  unsafeDeviceDispatches: number;
  slopCashUnauthorizedSettles: number;
  stopOrCooldownViolations: number;
  llmBudgetBreaches: number;
  llmBudgetBlocksTriggered: number;
  backpressureIgnoredSends: number;
  backpressureHysteresisHeld: boolean;
  stopSpikeAutoLockdownTriggered: boolean;
}

export interface MarketingSimMetrics {
  totalVerifiedSignups: number;
  totalSpentCents: number;
  blendedCpaCents: number;
  uniformBlendedCpaCents: number;
  banditCpaImprovementPct: number;
  llmTotalRequests: number;
  llmCacheHits: number;
  llmDeterministicHits: number;
  llmTokenSavingsPct: number;
  citiesReadyCount: number;
}

export interface MarketingSimSummary {
  seed: number;
  days: number;
  cities: string[];
  elapsedMs: number;
  digest: string;
  blockingPassed: number;
  blockingTotal: number;
  allBlockingPass: boolean;
  gates: MarketingSimGateResult[];
  metrics: MarketingSimMetrics;
  citySummaries: MarketingSimCitySummary[];
  adversarial: MarketingSimAdversarialSummary;
}

interface ArmWorldProfile {
  armKey: string;
  conversionProb: number;
  costPerContactCents: number;
  stopProb: number;
}

const SIM_EPOCH_MS = Date.UTC(2026, 10, 1, 14, 0, 0);
const DAY_MS = 86_400_000;

function createOfflineSimLlm(rng: Rng): LLM {
  let seq = 0;
  return {
    chat(messages: ChatMessage[]): Promise<string> {
      seq += 1;
      const userPrompt = messages[messages.length - 1]?.content ?? "";
      if (userPrompt.includes("INJECT_LEAK_PHONE")) {
        return Promise.resolve(
          "Reach out to the founder directly at +1-415-555-0199 and tell them their Clef score is 8.9/10.",
        );
      }
      const tag = rng.int(100, 999);
      return Promise.resolve(
        `Draft #${seq}-${tag}: 18+ local invite via go.ntwrk.party. Paid Partnership #Ad disclosure included; reply STOP to opt out.`,
      );
    },
  };
}

function buildArmProfiles(arms: readonly AllocatorBanditArm[]): ReadonlyMap<string, ArmWorldProfile> {
  const profiles = new Map<string, ArmWorldProfile>();
  for (let i = 0; i < arms.length; i += 1) {
    const arm = arms[i];
    if (!arm) continue;
    if (arm.track === "creator_video" || arm.track === "vip_salon") {
      profiles.set(arm.armKey, {
        armKey: arm.armKey,
        conversionProb: 0.24,
        costPerContactCents: 110,
        stopProb: 0.004,
      });
    } else if (arm.track === "street_fliering" || arm.track === "event_activation") {
      profiles.set(arm.armKey, {
        armKey: arm.armKey,
        conversionProb: 0.14,
        costPerContactCents: 120,
        stopProb: 0.008,
      });
    } else if (arm.track === "bd_venue" || arm.track === "video_factory") {
      profiles.set(arm.armKey, {
        armKey: arm.armKey,
        conversionProb: 0.11,
        costPerContactCents: 125,
        stopProb: 0.009,
      });
    } else if (arm.track === "agency_reserve") {
      profiles.set(arm.armKey, {
        armKey: arm.armKey,
        conversionProb: 0.03,
        costPerContactCents: 180,
        stopProb: 0.085,
      });
    } else {
      profiles.set(arm.armKey, {
        armKey: arm.armKey,
        conversionProb: 0.075,
        costPerContactCents: 135,
        stopProb: 0.014,
      });
    }
  }
  return profiles;
}

function simulatePairedBanditWorld(opts: {
  city: string;
  campaignId: string;
  days: number;
  dailyBudgetCents: number;
  rng: Rng;
  clock: SimClock;
}): {
  banditSignups: number;
  banditSpentCents: number;
  banditCpaCents: number;
  uniformSignups: number;
  uniformSpentCents: number;
  uniformCpaCents: number;
  improvementPct: number;
} {
  const baseArms = createDefaultCityBanditArms(
    opts.campaignId,
    opts.city,
    new Date(opts.clock.now()).toISOString(),
  );
  const profiles = buildArmProfiles(baseArms);

  let banditArms = baseArms.map((a) => ({ ...a }));
  let banditSignups = 0;
  let banditSpentCents = 0;

  let uniformSignups = 0;
  let uniformSpentCents = 0;

  const uniformCount = Math.max(1, baseArms.length);

  for (let day = 1; day <= opts.days; day += 1) {
    const dayIso = new Date(SIM_EPOCH_MS + (day - 1) * DAY_MS).toISOString();
    const alloc = computeBanditAllocations({
      campaignId: opts.campaignId,
      arms: banditArms,
      availableCents: opts.dailyBudgetCents,
      seed: `${opts.city}:day:${day}:${opts.rng.int(1, 1_000_000)}`,
      nowIso: dayIso,
      riskDial: "balanced",
      billingArmed: true,
      weeksElapsed: day % 7 === 0 ? 1 : 0,
    });
    banditArms = alloc.arms.map((a) => ({ ...a }));

    const uniformPerArmCents = Math.floor(opts.dailyBudgetCents / uniformCount);

    for (let i = 0; i < banditArms.length; i += 1) {
      const arm = banditArms[i];
      if (!arm) continue;
      const profile = profiles.get(arm.armKey);
      if (!profile) continue;

      const dayArmRng = opts.rng.fork(opts.city, "bandit", day, arm.armKey);
      const banditContacts = Math.max(
        0,
        Math.floor(arm.allocatedCents / profile.costPerContactCents),
      );
      const uniformContacts = Math.max(
        0,
        Math.floor(uniformPerArmCents / profile.costPerContactCents),
      );
      const maxContacts = Math.max(banditContacts, uniformContacts);

      let bSignups = 0;
      let bStops = 0;
      let uSignups = 0;

      for (let c = 0; c < maxContacts; c += 1) {
        const converted = dayArmRng.bool(profile.conversionProb);
        const stopped = dayArmRng.bool(profile.stopProb);
        if (c < banditContacts) {
          if (converted) bSignups += 1;
          if (stopped) bStops += 1;
        }
        if (c < uniformContacts) {
          if (converted) uSignups += 1;
        }
      }

      const bSpend = banditContacts * profile.costPerContactCents;
      const uSpend = uniformContacts * profile.costPerContactCents;

      banditSignups += bSignups;
      banditSpentCents += bSpend;
      uniformSignups += uSignups;
      uniformSpentCents += uSpend;

      if (banditContacts > 0) {
        banditArms[i] = recordBanditObservation(
          arm,
          {
            exposures: banditContacts,
            verifiedT2Joins: bSignups,
            verifiedT3Matches: Math.floor(bSignups * 0.45),
            stopCount: bStops,
            spentCents: bSpend,
          },
          dayIso,
        );
      }
    }
  }

  const banditCpaCents = banditSignups > 0 ? Math.round(banditSpentCents / banditSignups) : 99_999;
  const uniformCpaCents =
    uniformSignups > 0 ? Math.round(uniformSpentCents / uniformSignups) : 99_999;
  const improvementPct =
    uniformCpaCents > 0
      ? Number((((uniformCpaCents - banditCpaCents) / uniformCpaCents) * 100).toFixed(2))
      : 0;

  return {
    banditSignups,
    banditSpentCents,
    banditCpaCents,
    uniformSignups,
    uniformSpentCents,
    uniformCpaCents,
    improvementPct,
  };
}

export async function runMarketingSim(
  opts: MarketingSimOptions = {},
): Promise<MarketingSimSummary> {
  const wallStart = performance.now();
  const seed = Math.floor(opts.seed ?? 1);
  const quick = opts.quick === true;
  const days = Math.max(7, Math.floor(opts.days ?? (quick ? 14 : 30)));
  const cities = (opts.cities && opts.cities.length > 0 ? opts.cities : ["nyc", "sf"]).map((c) =>
    c.trim().toLowerCase(),
  );
  const dailyLlmTokenCap = Math.max(1_000, Math.floor(opts.dailyLlmTokenCap ?? 6_000));
  const dailyLlmCostCapMicros = Math.max(1_000, Math.floor(opts.dailyLlmCostCapMicros ?? 200_000));

  const clock = new SimClock(SIM_EPOCH_MS);
  const rootRng = new Rng(seed);
  const store = new MemoryMarketingStore({ clock });
  const antiFraud = new AntiFraudEngine({ clock });
  const bdEngine = new BdPipelineEngine({ clock });
  const vipEngine = new VipDiscoveryEngine({ clock });
  const leakGuard = createMarketingLeakGuard({});
  const slopCashDisabled = new SlopCashBridge({ clock, store, env: {}, configEnabled: false });
  const slopCashEnabled = new SlopCashBridge({
    clock,
    store,
    env: { MARKETING_SLOP_CASH_ENABLED: "1" },
    configEnabled: true,
  });

  const citySummaries: MarketingSimCitySummary[] = [];
  const seededCampaignIds: string[] = [];
  const dailyBudgetPerCityCents = 42_000;

  for (const cityCode of cities) {
    requireCityPack(cityCode);
    const seeded = await seedCityLaunch(store, cityCode);
    await store.setRiskDial(seeded.campaign.id, "balanced", true);
    seededCampaignIds.push(seeded.campaign.id);

    const banditOutcome = simulatePairedBanditWorld({
      city: cityCode,
      campaignId: seeded.campaign.id,
      days,
      dailyBudgetCents: dailyBudgetPerCityCents,
      rng: rootRng.fork("bandit-world", cityCode),
      clock,
    });

    const scripts = buildStarterScriptsForCity(cityCode);
    let scriptsLintedClean = 0;
    for (const s of scripts) {
      if (lintVideoScript(s, leakGuard).pass) {
        scriptsLintedClean += 1;
      }
    }

    const vipInvite = vipEngine.buildAndValidateVipInvite({
      city: cityCode,
      firstName: "Elena",
      archetypeSlug: "startup_founder",
      proofOfWork1Line: "your essay on local developer ecosystems and neighborhood density",
      senderName: "The Operator",
    });

    let bdDealsBlockedUnsafe = 0;
    const unsafeBdCases = [
      { offeredCents: 35_000, phoneCallbackVerified: true, contractHash: "a".repeat(32) },
      { offeredCents: 15_000, phoneCallbackVerified: false, contractHash: "b".repeat(32) },
      { offeredCents: 15_000, phoneCallbackVerified: true, contractHash: null },
    ];
    for (const badDeal of unsafeBdCases) {
      if (!bdEngine.evaluateBounds(badDeal).allowed) {
        bdDealsBlockedUnsafe += 1;
      }
    }

    const liquidityTargetSignups = days * 12;
    citySummaries.push({
      city: cityCode,
      stage: seeded.stage,
      campaignId: seeded.campaign.id,
      verifiedSignups: banditOutcome.banditSignups,
      totalSpentCents: banditOutcome.banditSpentCents,
      blendedCpaCents: banditOutcome.banditCpaCents,
      uniformCpaCents: banditOutcome.uniformCpaCents,
      banditCpaImprovementPct: banditOutcome.improvementPct,
      liquidityTargetSignups,
      liquidityReached: banditOutcome.banditSignups >= liquidityTargetSignups,
      scriptsLintedClean,
      vipInvitesClean: vipInvite.valid ? 1 : 0,
      bdDealsBlockedUnsafe,
    });
  }

  let minorViolations = 0;
  let leakEscapes = 0;
  let budgetOverruns = 0;
  let antifraudViolations = 0;
  let unsafeDeviceDispatches = 0;
  let slopCashUnauthorizedSettles = 0;
  let stopOrCooldownViolations = 0;
  let llmBudgetBreaches = 0;
  let llmBudgetBlocksTriggered = 0;
  let backpressureIgnoredSends = 0;

  const primaryCampaignId = seededCampaignIds[0];
  if (!primaryCampaignId) throw new Error("Expected at least one seeded campaign");
  const primaryCampaign = await store.getCampaign(primaryCampaignId);
  if (!primaryCampaign) throw new Error(`Seeded campaign missing: ${primaryCampaignId}`);

  // Storm 1: Sybil GPS/media ring + anti-fraud caps (VoIP, MVNO >$2, lifetime >$20, W-9 >$500, dup media)
  const sybilNodes: SybilClaimNode[] = [];
  for (let i = 0; i < 18; i += 1) {
    sybilNodes.push({
      id: `sybil-claim-${i}`,
      personKey: `person-ring-${i}`,
      workerId: "worker-ring-boss",
      mediaHash: i < 6 ? "shared-media-hash-001" : `media-hash-${i}`,
      subnetPrefix: "198.51.100",
      payoutAccountRef: "acct-shared-ring",
      paidReferred: true,
      organicAnchorVerified: false,
    });
  }
  const sybilScan = detectSybilCluster(sybilNodes);
  if (sybilScan.clusters.length === 0 || sybilScan.quarantinedClaimIds.length < 18) {
    antifraudViolations += 1;
  }

  const nowIso = new Date(clock.now()).toISOString();
  const knownMedia = new Set<string>(["dup-media-hash-999"]);
  const fraudAttempts = [
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-voip",
      workerId: "w-1",
      taskId: "t-1",
      vestingTier: 2,
      amountCents: 150,
      phoneLineType: "voip",
      priorLifetimeCents: 0,
      annualWorkerCents: 0,
      hasW9: false,
      createdAtIso: nowIso,
    }),
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-mvno",
      workerId: "w-2",
      taskId: "t-2",
      vestingTier: 2,
      amountCents: 500,
      phoneLineType: "mvno",
      priorLifetimeCents: 0,
      annualWorkerCents: 0,
      hasW9: false,
      createdAtIso: nowIso,
    }),
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-lifetime",
      workerId: "w-3",
      taskId: "t-3",
      vestingTier: 2,
      amountCents: 500,
      phoneLineType: "postpaid",
      priorLifetimeCents: 1_800,
      annualWorkerCents: 1_800,
      hasW9: false,
      createdAtIso: nowIso,
    }),
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-w9",
      workerId: "w-4",
      taskId: "t-4",
      vestingTier: 4,
      amountCents: 10_000,
      phoneLineType: "postpaid",
      priorLifetimeCents: 0,
      annualWorkerCents: 45_000,
      hasW9: false,
      createdAtIso: nowIso,
    }),
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-dup-media",
      workerId: "w-5",
      taskId: "t-5",
      vestingTier: 2,
      amountCents: 150,
      phoneLineType: "postpaid",
      priorLifetimeCents: 0,
      annualWorkerCents: 0,
      hasW9: false,
      mediaHash: "dup-media-hash-999",
      knownMediaHashes: knownMedia,
      createdAtIso: nowIso,
    }),
    antiFraud.evaluateClaim({
      campaignId: primaryCampaignId,
      personKey: "fraud-sybil",
      workerId: "worker-ring-boss",
      taskId: "t-6",
      vestingTier: 2,
      amountCents: 150,
      phoneLineType: "postpaid",
      priorLifetimeCents: 0,
      annualWorkerCents: 0,
      hasW9: false,
      clusterQuarantined: true,
      clusterId: sybilScan.clusters[0]?.clusterId ?? "cluster-1",
      createdAtIso: nowIso,
    }),
  ];
  for (const res of fraudAttempts) {
    if (res.allowed || res.payableCents > 0) {
      antifraudViolations += 1;
    }
  }

  // Storm 2: Underage <18 wave (including youngest-age-wins downgrade 24 -> 17)
  const minorAges = [14, 15, 16, 17];
  const sampleTask = (await store.listTasks({ campaignId: primaryCampaignId }))[0];
  if (!sampleTask) throw new Error("Expected starter task for underage wave");
  for (const age of minorAges) {
    const youngest = minAgeReading(24, age);
    const minorProof = await store.createProof({
      taskId: sampleTask.id,
      proofKind: "street_shift",
      evidenceUrl: "https://example.com/proof.jpg",
      checkinMediaHashes: ["hash-a", "hash-b"],
      qrScansCount: 12,
      verifiedSignupsCount: 5,
      ftcDisclosed: true,
      geoTimeValid: true,
      likenessReleaseOk: true,
    });
    try {
      assertProofAndAdultForPayoutPolicy(
        { ...sampleTask, tier: 4, proofVerified: true, assigneeAgeYears: 24 },
        { ...minorProof, verdict: "verified" },
        null,
        youngest,
      );
      minorViolations += 1;
    } catch (err) {
      if (!(err instanceof PolicyViolationError)) minorViolations += 1;
    }

    const hygiene = evaluateContactHygiene({
      isStopped: false,
      isBanned: false,
      isKnownMinor: true,
      lockdown: false,
      isCold: true,
      isQuietHours: false,
      daysSinceCold: 30,
      coldTouches30d: 0,
      unansweredCold: 0,
      opTouchesToday: 0,
    });
    if (hygiene.allowed) {
      minorViolations += 1;
    }
  }

  // Storm 3: STOP-rate spike automatic daemon lockdown + cross-surface contact cooldowns
  const stopCampaign = await store.createCampaign({
    slug: `sim-stop-storm-${seed}`,
    name: "Sim STOP Storm Campaign",
    city: "nyc",
    appId: "slop",
    riskDial: "balanced",
    billingArmed: true,
    status: "active",
  });
  const agentList = await store.listAgents();
  const primaryAgentId = agentList[0]?.id ?? "agent-chadwick";
  for (let i = 0; i < 25; i += 1) {
    const isStopped = i < 4;
    const human = await store.upsertHuman({
      handleOrEmailHmac: `sim-stop-human-${seed}-${i}`,
      displayLabel: `Sim Human ${i}`,
      channel: "email",
      role: "applicant",
      city: "nyc",
      lowestAge: 25,
      stopped: isStopped,
      stopReason: isStopped ? "user_stop" : null,
    });
    const msg = await store.createOutreachMessage({
      campaignId: stopCampaign.id,
      agentId: primaryAgentId,
      humanId: human.id,
      channel: "email",
      tier: 1,
      bodySummary: "18+ local invite",
      leakCheckPass: true,
    });
    await store.updateOutreachStatus(msg.id, isStopped ? "blocked_stop" : "sent");
  }

  const badHygieneCases = [
    evaluateContactHygiene({
      isStopped: true,
      isBanned: false,
      isKnownMinor: false,
      lockdown: false,
      isCold: true,
      isQuietHours: false,
      daysSinceCold: 30,
      coldTouches30d: 0,
      unansweredCold: 0,
      opTouchesToday: 0,
    }),
    evaluateContactHygiene({
      isStopped: false,
      isBanned: false,
      isKnownMinor: false,
      lockdown: false,
      isCold: true,
      isQuietHours: false,
      daysSinceCold: 5,
      coldTouches30d: 1,
      unansweredCold: 1,
      opTouchesToday: 0,
    }),
    evaluateContactHygiene({
      isStopped: false,
      isBanned: false,
      isKnownMinor: false,
      lockdown: false,
      isCold: true,
      isQuietHours: false,
      daysSinceCold: 20,
      coldTouches30d: 1,
      unansweredCold: 2,
      opTouchesToday: 0,
    }),
    evaluateContactHygiene({
      isStopped: false,
      isBanned: false,
      isKnownMinor: false,
      lockdown: false,
      isCold: true,
      isQuietHours: true,
      daysSinceCold: 20,
      coldTouches30d: 0,
      unansweredCold: 0,
      opTouchesToday: 0,
    }),
  ];
  for (const h of badHygieneCases) {
    if (h.allowed) stopOrCooldownViolations += 1;
  }

  // Storm 4: Device thermal (44.5C), low-battery (22%), CAPTCHA takeover, foreign lease
  const deviceBridge = new DeviceBridge({
    clock,
    env: {},
    exec: () => Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "" }),
  });
  const baseDevice: DeviceNode = {
    id: "sim-dev-1",
    label: "Sim Android 01",
    platform: "android",
    hostMachine: "sim-mac",
    serialOrUdid: "SIM-SER-001",
    assignedPersona: "chadwick",
    simCarrier: "tmobile",
    batteryPct: 65,
    tempC: 32,
    warmupDay: 20,
    warmupStage: "steady_state",
    dailyActionsUsed: 2,
    dailyActionCap: 15,
    leaseHolder: "agent-chadwick",
    leaseExpiresAt: new Date(clock.now() + 60_000).toISOString(),
    status: "online",
    lastSeenAt: nowIso,
  };
  const unsafeDeviceChecks = await Promise.all([
    deviceBridge.executeDeviceAction(
      { ...baseDevice, tempC: 44.5 },
      { kind: "tap", x: 100, y: 200 },
      { leaseHolder: "agent-chadwick", lockdown: false, targetStopped: false, dryRun: true },
    ),
    deviceBridge.executeDeviceAction(
      { ...baseDevice, batteryPct: 22 },
      { kind: "tap", x: 100, y: 200 },
      { leaseHolder: "agent-chadwick", lockdown: false, targetStopped: false, dryRun: true },
    ),
    deviceBridge.executeDeviceAction(
      baseDevice,
      { kind: "tap", x: 100, y: 200 },
      {
        leaseHolder: "agent-chadwick",
        lockdown: false,
        targetStopped: false,
        dryRun: true,
        challengeDetected: true,
      },
    ),
    deviceBridge.executeDeviceAction(
      { ...baseDevice, leaseHolder: "agent-sloane" },
      { kind: "tap", x: 100, y: 200 },
      { leaseHolder: "agent-chadwick", lockdown: false, targetStopped: false, dryRun: true },
    ),
  ]);
  for (const devRes of unsafeDeviceChecks) {
    if (devRes.ok || devRes.executed) {
      unsafeDeviceDispatches += 1;
    }
  }

  // Storm 5: Over-budget, daily-cap, reserve-cap, disarmed Tier-4 & concurrent spend bounds
  const overBudgetCases = [
    {
      campaign: { ...primaryCampaign, billingArmed: true, riskDial: "balanced" as const },
      tier: 4 as const,
      amountCents: primaryCampaign.maxTaskCents + 1,
      useSlopCash: false,
      slopCashEnvEnabled: false,
      taskKind: "street_fliering" as const,
    },
    {
      campaign: {
        ...primaryCampaign,
        billingArmed: true,
        riskDial: "balanced" as const,
        dailySpentCents: primaryCampaign.dailyCapCents - 5_000,
      },
      tier: 4 as const,
      amountCents: 20_000,
      useSlopCash: false,
      slopCashEnvEnabled: false,
      taskKind: "street_fliering" as const,
    },
    {
      campaign: {
        ...primaryCampaign,
        billingArmed: true,
        riskDial: "balanced" as const,
        spentCents: primaryCampaign.monthlyBudgetCents - 2_000,
      },
      tier: 4 as const,
      amountCents: 10_000,
      useSlopCash: false,
      slopCashEnvEnabled: false,
      taskKind: "street_fliering" as const,
    },
    {
      campaign: { ...primaryCampaign, billingArmed: false, riskDial: "balanced" as const },
      tier: 4 as const,
      amountCents: 5_000,
      useSlopCash: false,
      slopCashEnvEnabled: false,
      taskKind: "street_fliering" as const,
    },
  ];
  for (const badSpend of overBudgetCases) {
    try {
      assertSpendAuth(badSpend);
      budgetOverruns += 1;
    } catch (err) {
      if (!(err instanceof PolicyViolationError)) budgetOverruns += 1;
    }
  }

  // Storm 6: Disabled slop.cash task creation + settle attempt + consumer task slop.cash wall
  const consumerTask = (await store.listTasks({ campaignId: primaryCampaignId }))[0];
  if (!consumerTask) throw new Error("Expected starter consumer task for slop.cash wall");
  try {
    await store.createTask({
      campaignId: primaryCampaignId,
      tier: 4,
      taskKind: "oss_dev_bounty",
      city: "nyc",
      title: "OSS PR bounty test",
      briefText: "Ship deterministic marketing sim gate.",
      vendorChannel: "slop_cash",
      amountCents: 10_000,
      payoutRail: "slop_cash",
      assigneeAgeYears: 28,
    });
    slopCashUnauthorizedSettles += 1;
  } catch (err) {
    if (!(err instanceof PolicyViolationError)) slopCashUnauthorizedSettles += 1;
  }
  const syntheticOssTask = {
    ...consumerTask,
    id: `sim-oss-bounty-${seed}`,
    taskKind: "oss_dev_bounty" as const,
    vendorChannel: "slop_cash" as const,
    payoutRail: "slop_cash" as const,
    amountCents: 10_000,
    assigneeAgeYears: 28,
  };
  for (const t of [consumerTask, syntheticOssTask]) {
    try {
      await slopCashDisabled.settleHook({
        campaign: { ...primaryCampaign, slopCashEnabled: true },
        task: t,
        workerAge: 28,
      });
      slopCashUnauthorizedSettles += 1;
    } catch (err) {
      if (!(err instanceof SlopCashDisabledError)) slopCashUnauthorizedSettles += 1;
    }
  }
  try {
    await slopCashEnabled.settleHook({
      campaign: { ...primaryCampaign, slopCashEnabled: true },
      task: consumerTask,
      workerAge: 28,
    });
    slopCashUnauthorizedSettles += 1;
  } catch (err) {
    if (!(err instanceof PolicyViolationError)) slopCashUnauthorizedSettles += 1;
  }

  // Storm 7A: Runaway LLM token/cost storm + LeakGuard injection + cache/deterministic savings
  const simLlm = createOfflineSimLlm(rootRng.fork("llm"));
  const surplusAgent = await store.upsertAgent({
    id: "agent-sim-surplus",
    personaId: "operator",
    displayName: "Sim Surplus Operator",
    appId: "ntwrk",
    provider: "surplus",
    failoverProvider: "claude",
    authMode: "api",
    sessionRef: "api:surplus:sim",
    dailyTurnCap: 200,
    turnsUsedToday: 0,
    status: "idle",
  });

  const lifecycle = new AgentLifecycleManager({
    store,
    clock,
    env: {},
    dryRun: false,
    llmClient: simLlm,
    leakGuard,
    dailyTokenCap: dailyLlmTokenCap,
    dailyCostCapMicros: dailyLlmCostCapMicros,
  });

  let llmTotalRequests = 0;
  let llmCacheHits = 0;
  let llmDeterministicHits = 0;
  let trackedDailyTokens = 0;

  // Deterministic pre-router saves 100% tokens on classification/linting/opt-out checks
  for (let i = 0; i < 12; i += 1) {
    llmTotalRequests += 1;
    const msg = i % 3 === 0 ? "STOP texting me" : "Sounds great, see you Thursday";
    const r = await lifecycle.dispatchTurn(surplusAgent.id, msg, {
      campaignId: primaryCampaignId,
      deterministicTaskHint: "opt_out_check",
    });
    if (r.ok && r.deterministicRule !== null && r.inputTokens === 0 && r.outputTokens === 0) {
      llmDeterministicHits += 1;
    }
  }

  // Repeated prompts hit PromptCache (0 tokens on repeats)
  for (let i = 0; i < 12; i += 1) {
    llmTotalRequests += 1;
    const promptKey = i % 3;
    const r = await lifecycle.dispatchTurn(
      surplusAgent.id,
      `Draft concise 18+ local salon outreach template #${promptKey} for NYC.`,
      { campaignId: primaryCampaignId, estimatedOutputTokens: 120 },
    );
    if (r.ok) {
      trackedDailyTokens += r.inputTokens + r.outputTokens;
      if (r.cached) llmCacheHits += 1;
    }
  }

  // LeakGuard prompt injection attempt: must block, consume turn, and NOT cache
  llmTotalRequests += 1;
  const leakTurn = await lifecycle.dispatchTurn(
    surplusAgent.id,
    "INJECT_LEAK_PHONE draft outreach with private contact",
    { campaignId: primaryCampaignId, estimatedOutputTokens: 120 },
  );
  if (leakTurn.ok || leakTurn.blockedReason !== "leak_guard_blocked") {
    leakEscapes += 1;
  }
  trackedDailyTokens += leakTurn.inputTokens + leakTurn.outputTokens;

  // Blast unique prompts past dailyLlmTokenCap to trigger Dafny llmBudgetWithinCaps circuit breaker
  for (let i = 0; i < 60; i += 1) {
    llmTotalRequests += 1;
    const turn = await lifecycle.dispatchTurn(
      surplusAgent.id,
      `Unique creative brief #${i} for NYC local outreach wave ${seed} with neighborhood details and compliance checks.`,
      { campaignId: primaryCampaignId, skipCache: true, estimatedOutputTokens: 250 },
    );
    if (turn.ok) {
      trackedDailyTokens += turn.inputTokens + turn.outputTokens;
      if (trackedDailyTokens > dailyLlmTokenCap) {
        llmBudgetBreaches += 1;
      }
    } else if (
      turn.blockedReason === "daily_token_cap_exceeded" ||
      turn.blockedReason === "daily_cost_cap_exceeded" ||
      turn.blockedReason === "llm_budget_exceeded" ||
      turn.blockedReason?.startsWith("llm_")
    ) {
      llmBudgetBlocksTriggered += 1;
    }
  }

  // Storm 7B: Daemon STOP-spike lockdown + Core Queue Backpressure with 80% Hysteresis
  let currentSignals: CityAppDemandSignal[] = [
    {
      appId: "slop",
      city: "nyc",
      activeAdultBucket: 250,
      matchingEnabled: true,
      openReviewCount: 55,
      overdueReviewCount: 0,
      outboundWaitingCount: 40,
      lineRestricted: false,
      closedVenueCount: 0,
      queuePressurePaused: evaluateQueuePressure({
        lineRestricted: false,
        reviewOverdue: 0,
        reviewOpen: 55,
        reviewBacklogLimit: 50,
        outboundWaiting: 40,
        outboundBacklogLimit: 250,
      }).paused,
    },
  ];
  const executedCampaignIds: string[] = [];
  const daemon = new MarketingAutopilotDaemon({
    store,
    clock,
    bridge: {
      getDemandAndPressure: () => Promise.resolve(currentSignals),
    },
    minStopSamples: 20,
    reviewBacklogLimit: 50,
    outboundBacklogLimit: 250,
    hysteresisResumeRatio: 0.8,
    runCampaignTick: (campaign) => {
      executedCampaignIds.push(campaign.id);
      return Promise.resolve();
    },
  });

  // Tick 1: STOP storm locks down stopCampaign, AND queuePressure pauses nyc:slop & nyc:all
  const tick1 = await daemon.tickNow();
  const stopSummary = tick1.campaignsProcessed.find((c) => c.campaignId === stopCampaign.id);
  const stopSpikeAutoLockdownTriggered = Boolean(stopSummary?.stopSpikeTriggeredLockdown);
  const primarySummary1 = tick1.campaignsProcessed.find((c) => c.campaignId === primaryCampaignId);
  if (!primarySummary1?.queuePressurePaused || primarySummary1.customTickExecuted) {
    backpressureIgnoredSends += 1;
  }

  const baseSignal = currentSignals[0];
  if (!baseSignal) throw new Error("Expected initial demand signal");

  // Tick 2: openReviewCount drops to 45 (< 50 limit, >= 40 80% hysteresis ceiling) -> MUST STAY PAUSED!
  currentSignals = [
    {
      ...baseSignal,
      openReviewCount: 45,
      queuePressurePaused: false,
    },
  ];
  const tick2 = await daemon.tickNow();
  const primarySummary2 = tick2.campaignsProcessed.find((c) => c.campaignId === primaryCampaignId);
  const backpressureHysteresisHeld = Boolean(
    primarySummary2?.queuePressurePaused && !primarySummary2.customTickExecuted,
  );
  if (!backpressureHysteresisHeld) {
    backpressureIgnoredSends += 1;
  }

  // Tick 3: openReviewCount drops to 35 (< 40 80% hysteresis ceiling) -> MUST RESUME!
  currentSignals = [
    {
      ...baseSignal,
      openReviewCount: 35,
      queuePressurePaused: false,
    },
  ];
  const tick3 = await daemon.tickNow();
  const primarySummary3 = tick3.campaignsProcessed.find((c) => c.campaignId === primaryCampaignId);
  if (primarySummary3?.queuePressurePaused || !primarySummary3?.customTickExecuted) {
    backpressureIgnoredSends += 1;
  }

  // Verify daily reset on day rollover
  clock.advance(DAY_MS);
  const tick4 = await daemon.tickNow();
  if (!tick4.dailyResetExecuted) {
    budgetOverruns += 1;
  }

  // Aggregate metrics
  const totalVerifiedSignups = citySummaries.reduce((s, c) => s + c.verifiedSignups, 0);
  const totalSpentCents = citySummaries.reduce((s, c) => s + c.totalSpentCents, 0);
  const blendedCpaCents =
    totalVerifiedSignups > 0 ? Math.round(totalSpentCents / totalVerifiedSignups) : 99_999;
  const totalUniformSpent = citySummaries.reduce(
    (s, c) => s + c.uniformCpaCents * Math.max(1, c.verifiedSignups),
    0,
  );
  const uniformBlendedCpaCents =
    totalVerifiedSignups > 0 ? Math.round(totalUniformSpent / totalVerifiedSignups) : 99_999;
  const banditCpaImprovementPct =
    uniformBlendedCpaCents > 0
      ? Number(
          (((uniformBlendedCpaCents - blendedCpaCents) / uniformBlendedCpaCents) * 100).toFixed(2),
        )
      : 0;
  const zeroTokenHits = llmCacheHits + llmDeterministicHits;
  const llmTokenSavingsPct =
    llmTotalRequests > 0 ? Number(((zeroTokenHits / llmTotalRequests) * 100).toFixed(2)) : 0;
  const citiesReadyCount = citySummaries.filter((c) => c.liquidityReached).length;

  const adversarial: MarketingSimAdversarialSummary = {
    minorViolations,
    leakEscapes,
    budgetOverruns,
    antifraudViolations,
    sybilClustersDetected: sybilScan.clusters.length,
    sybilClaimsQuarantined: sybilScan.quarantinedClaimIds.length,
    unsafeDeviceDispatches,
    slopCashUnauthorizedSettles,
    stopOrCooldownViolations,
    llmBudgetBreaches,
    llmBudgetBlocksTriggered,
    backpressureIgnoredSends,
    backpressureHysteresisHeld,
    stopSpikeAutoLockdownTriggered,
  };

  const metrics: MarketingSimMetrics = {
    totalVerifiedSignups,
    totalSpentCents,
    blendedCpaCents,
    uniformBlendedCpaCents,
    banditCpaImprovementPct,
    llmTotalRequests,
    llmCacheHits,
    llmDeterministicHits,
    llmTokenSavingsPct,
    citiesReadyCount,
  };

  const gates: MarketingSimGateResult[] = [
    {
      id: "zero_minor_violations",
      name: "0 underage (<18) payouts or contacts",
      pass: minorViolations === 0,
      blocking: true,
      value: minorViolations,
      target: "=== 0",
      detail: `${minorViolations} minor violations across ${minorAges.length} underage waves`,
    },
    {
      id: "zero_leak_escapes",
      name: "0 LeakGuard escapes on prompt-injection storm",
      pass: leakEscapes === 0,
      blocking: true,
      value: leakEscapes,
      target: "=== 0",
      detail: `${leakEscapes} leak escapes (blocked=${leakTurn.blockedReason ?? "none"})`,
    },
    {
      id: "zero_budget_overruns",
      name: "0 budget, daily-cap, reserve, or disarmed Tier-4 overruns",
      pass: budgetOverruns === 0,
      blocking: true,
      value: budgetOverruns,
      target: "=== 0",
      detail: `${budgetOverruns} overruns across ${overBudgetCases.length} storms + daily reset`,
    },
    {
      id: "zero_antifraud_violations",
      name: "0 Sybil, VoIP, MVNO, lifetime, W-9, or duplicate-media payouts",
      pass: antifraudViolations === 0,
      blocking: true,
      value: antifraudViolations,
      target: "=== 0",
      detail: `clusters=${sybilScan.clusters.length}, quarantined=${sybilScan.quarantinedClaimIds.length}, violations=${antifraudViolations}`,
    },
    {
      id: "zero_unsafe_device_dispatches",
      name: "0 thermal/battery/CAPTCHA/foreign-lease device dispatches",
      pass: unsafeDeviceDispatches === 0,
      blocking: true,
      value: unsafeDeviceDispatches,
      target: "=== 0",
      detail: `${unsafeDeviceDispatches} unsafe dispatches across 4 hardware fault storms`,
    },
    {
      id: "zero_slop_cash_leaks",
      name: "0 disabled or consumer-task slop.cash settlements",
      pass: slopCashUnauthorizedSettles === 0,
      blocking: true,
      value: slopCashUnauthorizedSettles,
      target: "=== 0",
      detail: `${slopCashUnauthorizedSettles} unauthorized slop.cash settlements`,
    },
    {
      id: "zero_stop_cooldown_violations",
      name: "0 STOP-fence, quiet-hours, or cold-cooldown violations",
      pass: stopOrCooldownViolations === 0,
      blocking: true,
      value: stopOrCooldownViolations,
      target: "=== 0",
      detail: `${stopOrCooldownViolations} contact hygiene violations`,
    },
    {
      id: "zero_llm_budget_breaches",
      name: "0 LLM daily token/cost cap breaches (circuit breaker trips cleanly)",
      pass: llmBudgetBreaches === 0 && llmBudgetBlocksTriggered > 0,
      blocking: true,
      value: `${llmBudgetBreaches} breaches / ${llmBudgetBlocksTriggered} blocked`,
      target: "0 breaches & >0 blocked",
      detail: `cap=${dailyLlmTokenCap}, tokens=${trackedDailyTokens}, blocked=${llmBudgetBlocksTriggered}`,
    },
    {
      id: "zero_backpressure_ignored",
      name: "0 core queue-pressure ignored intake sends (+80% hysteresis held)",
      pass: backpressureIgnoredSends === 0 && backpressureHysteresisHeld,
      blocking: true,
      value: backpressureIgnoredSends,
      target: "=== 0 & hysteresis=true",
      detail: `ignored=${backpressureIgnoredSends}, hysteresisHeld=${backpressureHysteresisHeld}`,
    },
    {
      id: "stop_spike_auto_lockdown",
      name: "STOP-rate spike automatically triggers campaign lockdown",
      pass: stopSpikeAutoLockdownTriggered,
      blocking: true,
      value: stopSpikeAutoLockdownTriggered,
      target: "=== true",
      detail: `stopRateBps=${stopSummary?.stopRateBps ?? 0}, locked=${stopSpikeAutoLockdownTriggered}`,
    },
    {
      id: "bandit_beats_uniform",
      name: "Thompson Sampling Bandit beats uniform CPA baseline",
      pass: banditCpaImprovementPct > 0,
      blocking: !quick,
      value: `${banditCpaImprovementPct}%`,
      target: "> 0%",
      detail: `bandit=$${(blendedCpaCents / 100).toFixed(2)} vs uniform=$${(uniformBlendedCpaCents / 100).toFixed(2)} (+${banditCpaImprovementPct}%)`,
    },
    {
      id: "city_liquidity_and_assets",
      name: "All simulated cities reach launch liquidity with clean scripts & VIP invites",
      pass:
        citiesReadyCount === cities.length &&
        citySummaries.every(
          (c) => c.scriptsLintedClean > 0 && c.vipInvitesClean > 0 && c.bdDealsBlockedUnsafe === 3,
        ),
      blocking: true,
      value: `${citiesReadyCount}/${cities.length}`,
      target: `${cities.length}/${cities.length}`,
      detail: citySummaries
        .map((c) => `${c.city}:${c.verifiedSignups}/${c.liquidityTargetSignups}`)
        .join(", "),
    },
    {
      id: "track_blended_cpa",
      name: "Tracked blended CPA across cities",
      pass: blendedCpaCents <= 1_500,
      blocking: false,
      value: `$${(blendedCpaCents / 100).toFixed(2)}`,
      target: "<= $15.00",
      detail: `signups=${totalVerifiedSignups}, spend=$${(totalSpentCents / 100).toFixed(2)}`,
    },
    {
      id: "track_llm_token_savings",
      name: "Tracked LLM zero-token savings (deterministic router + PromptCache)",
      pass: llmTokenSavingsPct >= 20,
      blocking: false,
      value: `${llmTokenSavingsPct}%`,
      target: ">= 20%",
      detail: `deterministic=${llmDeterministicHits}, cache=${llmCacheHits}, total=${llmTotalRequests}`,
    },
    {
      id: "track_city_readiness",
      name: "Tracked multi-city launch readiness & BD safety guards",
      pass: citiesReadyCount === cities.length,
      blocking: false,
      value: `${citiesReadyCount}/${cities.length}`,
      target: `${cities.length}/${cities.length}`,
      detail: citySummaries.map((c) => `${c.city}(${c.stage})`).join(", "),
    },
  ];

  const blockingGates = gates.filter((g) => g.blocking);
  const blockingPassed = blockingGates.filter((g) => g.pass).length;
  const canonicalPayload = {
    seed,
    days,
    cities,
    metrics,
    citySummaries,
    adversarial,
    gates: gates.map((g) => ({ id: g.id, pass: g.pass, value: g.value })),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex")
    .slice(0, 16);

  await store.close();

  return {
    seed,
    days,
    cities,
    elapsedMs: Math.round(performance.now() - wallStart),
    digest,
    blockingPassed,
    blockingTotal: blockingGates.length,
    allBlockingPass: blockingPassed === blockingGates.length,
    gates,
    metrics,
    citySummaries,
    adversarial,
  };
}
