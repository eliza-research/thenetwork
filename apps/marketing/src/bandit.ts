import { Rng } from "../../../packages/core/src/rng.ts";
import type { AppId, RiskDial } from "./types.ts";

export type BanditTrack =
  | "street_fliering"
  | "creator_video"
  | "event_activation"
  | "print_qr"
  | "agency_reserve"
  | "bd_venue"
  | "vip_salon"
  | "video_factory"
  | "organic_play";

export type BanditArmState =
  | "active"
  | "scaled"
  | "paused_low_roi"
  | "auto_killed"
  | "halted_safety";

export interface BanditArm {
  readonly id: string;
  readonly campaignId: string;
  readonly armKey: string;
  readonly label: string;
  readonly track: BanditTrack;
  readonly playCode: string | null;
  readonly city: string;
  readonly appId: AppId;
  readonly alpha: number;
  readonly beta: number;
  readonly decayGamma: number;
  readonly exposures: number;
  readonly verifiedT2Joins: number;
  readonly verifiedT3Matches: number;
  readonly stopCount: number;
  readonly ftcFailCount: number;
  readonly spentCents: number;
  readonly targetCpaCents: number;
  readonly allocatedShareBps: number;
  readonly allocatedCents: number;
  readonly state: BanditArmState;
  readonly killReason: string | null;
  readonly updatedAt: string;
}

export interface BanditObservation {
  readonly exposures?: number;
  readonly verifiedT2Joins?: number;
  readonly verifiedT3Matches?: number;
  readonly stopCount?: number;
  readonly ftcFailCount?: number;
  readonly spentCents?: number;
}

export interface BanditPolicyParams {
  readonly weeklyDecayGamma: number;
  readonly exploitShareBps: number;
  readonly minExploreReserveBps: number;
  readonly maxArmShareBps: number;
  readonly maxStepDeltaBps: number;
  readonly minExposuresBeforeRoiKill: number;
  readonly minExposuresBeforeStopKill: number;
  readonly maxStopRateForExploit: number;
  readonly hardStopRateKill: number;
  readonly maxCpaMultiplierKill: number;
  readonly t3QualityWeight: number;
  readonly day15AgencyNoShowThreshold: number;
  readonly agencyReserveCents: number;
}

export const DEFAULT_BANDIT_POLICY: BanditPolicyParams = {
  weeklyDecayGamma: 0.92,
  exploitShareBps: 7_000,
  minExploreReserveBps: 1_000,
  maxArmShareBps: 6_000,
  maxStepDeltaBps: 2_000,
  minExposuresBeforeRoiKill: 100,
  minExposuresBeforeStopKill: 20,
  maxStopRateForExploit: 0.03,
  hardStopRateKill: 0.05,
  maxCpaMultiplierKill: 2.5,
  t3QualityWeight: 2.5,
  day15AgencyNoShowThreshold: 0.15,
  agencyReserveCents: 100_000,
};

export interface BanditRebalanceInput {
  readonly campaignId: string;
  readonly arms: readonly BanditArm[];
  readonly availableCents: number;
  readonly seed: number | string;
  readonly nowIso: string;
  readonly riskDial: RiskDial;
  readonly billingArmed?: boolean;
  readonly weeksElapsed?: number;
  readonly dayOfCampaign?: number;
  readonly directNoShowRate?: number;
  readonly policy?: Partial<BanditPolicyParams>;
}

export interface BanditArmDecision {
  readonly armId: string;
  readonly armKey: string;
  readonly previousShareBps: number;
  readonly nextShareBps: number;
  readonly allocatedCents: number;
  readonly sampledPosterior: number;
  readonly efficiencyScore: number;
  readonly observedCpaCents: number | null;
  readonly stopRate: number;
  readonly bucket: "exploit" | "explore" | "reserve" | "killed" | "locked";
  readonly state: BanditArmState;
  readonly killReason: string | null;
}

export interface BanditRebalanceResult {
  readonly campaignId: string;
  readonly seed: number | string;
  readonly rebalancedAt: string;
  readonly availableCents: number;
  readonly totalAllocatedCents: number;
  readonly exploitAllocatedCents: number;
  readonly exploreAllocatedCents: number;
  readonly agencySurgeTriggered: boolean;
  readonly agencyReserveReallocatedTo: string | null;
  readonly arms: readonly BanditArm[];
  readonly decisions: readonly BanditArmDecision[];
}

export function sampleStandardGamma(rng: Rng, shape: number): number {
  if (!Number.isFinite(shape) || shape <= 0) {
    throw new Error(`Gamma shape must be positive finite, got ${shape}`);
  }
  if (shape < 1) {
    const u = Math.max(rng.next(), 1e-12);
    return sampleStandardGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 10_000; i += 1) {
    let x: number;
    let v: number;
    do {
      x = rng.normal(0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    const v3 = v * v * v;
    const u = Math.max(rng.next(), 1e-12);
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) {
      return d * v3;
    }
    if (Math.log(u) < 0.5 * x2 + d * (1 - v3 + Math.log(v3))) {
      return d * v3;
    }
  }
  return d;
}

export function sampleBeta(rng: Rng, alpha: number, beta: number): number {
  const safeAlpha = Math.max(1e-3, alpha);
  const safeBeta = Math.max(1e-3, beta);
  const g1 = sampleStandardGamma(rng, safeAlpha);
  const g2 = sampleStandardGamma(rng, safeBeta);
  const sum = g1 + g2;
  if (!Number.isFinite(sum) || sum <= 0) {
    return safeAlpha / (safeAlpha + safeBeta);
  }
  return Math.max(0, Math.min(1, g1 / sum));
}

export function observedCpaCents(arm: Pick<BanditArm, "spentCents" | "verifiedT2Joins">): number | null {
  if (arm.verifiedT2Joins <= 0) return null;
  return Math.round(arm.spentCents / arm.verifiedT2Joins);
}

export function observedStopRate(arm: Pick<BanditArm, "stopCount" | "exposures">): number {
  if (arm.exposures <= 0) return 0;
  return arm.stopCount / arm.exposures;
}

export function applyWeeklyDecay(
  arm: BanditArm,
  weeksElapsed = 1,
  gammaOverride?: number,
): BanditArm {
  if (!Number.isFinite(weeksElapsed) || weeksElapsed <= 0) {
    return { ...arm };
  }
  const gamma = gammaOverride ?? arm.decayGamma;
  const factor = Math.pow(Math.max(0.01, Math.min(1, gamma)), weeksElapsed);
  const nextAlpha = Math.max(1, Number((1 + (arm.alpha - 1) * factor).toFixed(4)));
  const nextBeta = Math.max(1, Number((1 + (arm.beta - 1) * factor).toFixed(4)));
  return {
    ...arm,
    alpha: nextAlpha,
    beta: nextBeta,
  };
}

export function evaluateArmKillRules(
  arm: BanditArm,
  policy: BanditPolicyParams = DEFAULT_BANDIT_POLICY,
  activeHealthyCount = 2,
): { state: BanditArmState; killReason: string | null } {
  if (arm.ftcFailCount > 0) {
    return {
      state: "halted_safety",
      killReason: `ftc_disclosure_failure (${arm.ftcFailCount})`,
    };
  }

  const stopRate = observedStopRate(arm);
  if (
    arm.exposures >= policy.minExposuresBeforeStopKill &&
    stopRate > policy.hardStopRateKill
  ) {
    return {
      state: "halted_safety",
      killReason: `stop_rate_exceeded (${(stopRate * 100).toFixed(2)}% > ${(policy.hardStopRateKill * 100).toFixed(1)}%)`,
    };
  }

  if (
    arm.exposures >= policy.minExposuresBeforeRoiKill &&
    activeHealthyCount > 1
  ) {
    const cpa = observedCpaCents(arm);
    const maxAllowedCpa = Math.round(arm.targetCpaCents * policy.maxCpaMultiplierKill);
    if (cpa !== null && cpa > maxAllowedCpa) {
      return {
        state: "auto_killed",
        killReason: `cpa_exceeded_2_5x_target (${cpa}c > ${maxAllowedCpa}c)`,
      };
    }
    if (cpa === null && arm.spentCents > maxAllowedCpa) {
      return {
        state: "auto_killed",
        killReason: `zero_joins_after_${arm.exposures}_exposures_and_${arm.spentCents}c_spend`,
      };
    }
  }

  if (arm.state === "halted_safety" || arm.state === "auto_killed") {
    return { state: arm.state, killReason: arm.killReason };
  }
  return { state: arm.state, killReason: null };
}

export function recordBanditObservation(
  arm: BanditArm,
  obs: BanditObservation,
  updatedAtIso: string,
  policy: BanditPolicyParams = DEFAULT_BANDIT_POLICY,
  activeHealthyCount = 2,
): BanditArm {
  const addExposures = Math.max(0, Math.floor(obs.exposures ?? 0));
  const addT2 = Math.max(0, Math.floor(obs.verifiedT2Joins ?? 0));
  const addT3 = Math.max(0, Math.floor(obs.verifiedT3Matches ?? 0));
  const addStops = Math.max(0, Math.floor(obs.stopCount ?? 0));
  const addFtcFails = Math.max(0, Math.floor(obs.ftcFailCount ?? 0));
  const addSpend = Math.max(0, Math.floor(obs.spentCents ?? 0));

  const nextAlpha = Number((arm.alpha + addT2 + addT3 * policy.t3QualityWeight).toFixed(4));
  const failures = Math.max(0, addExposures - addT2);
  const nextBeta = Number((arm.beta + failures).toFixed(4));

  const updated: BanditArm = {
    ...arm,
    alpha: nextAlpha,
    beta: nextBeta,
    exposures: arm.exposures + addExposures,
    verifiedT2Joins: arm.verifiedT2Joins + addT2,
    verifiedT3Matches: arm.verifiedT3Matches + addT3,
    stopCount: arm.stopCount + addStops,
    ftcFailCount: arm.ftcFailCount + addFtcFails,
    spentCents: arm.spentCents + addSpend,
    updatedAt: updatedAtIso,
  };

  const verdict = evaluateArmKillRules(updated, policy, activeHealthyCount);
  const killed = verdict.state === "halted_safety" || verdict.state === "auto_killed";

  return {
    ...updated,
    state: verdict.state,
    killReason: verdict.killReason,
    allocatedShareBps: killed ? 0 : updated.allocatedShareBps,
    allocatedCents: killed ? 0 : updated.allocatedCents,
  };
}

function distributeLargestRemainder(
  total: number,
  weights: ReadonlyArray<{ readonly key: string; readonly weight: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || weights.length === 0) {
    for (const w of weights) out.set(w.key, 0);
    return out;
  }
  const positiveSum = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (positiveSum <= 0) {
    const base = Math.floor(total / weights.length);
    let rem = total - base * weights.length;
    for (const w of weights) {
      const extra = rem > 0 ? 1 : 0;
      if (rem > 0) rem -= 1;
      out.set(w.key, base + extra);
    }
    return out;
  }

  const parts = weights.map((w) => {
    const exact = (Math.max(0, w.weight) / positiveSum) * total;
    const floor = Math.floor(exact);
    return { key: w.key, floor, frac: exact - floor };
  });

  let remainder = total - parts.reduce((s, p) => s + p.floor, 0);
  const byFrac = [...parts].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return a.key.localeCompare(b.key);
  });

  for (const p of parts) out.set(p.key, p.floor);
  for (let i = 0; i < byFrac.length && remainder > 0; i += 1) {
    const target = byFrac[i];
    if (!target) break;
    out.set(target.key, (out.get(target.key) ?? 0) + 1);
    remainder -= 1;
  }
  return out;
}

export function createDefaultNycBanditArms(
  campaignId: string,
  updatedAtIso: string,
): BanditArm[] {
  return [
    {
      id: `${campaignId}:street_fliering`,
      campaignId,
      armKey: "street_fliering",
      label: "Direct Street Teams (CL + RentAHuman)",
      track: "street_fliering",
      playCode: "NYC-TRACK-A",
      city: "nyc",
      appId: "all",
      alpha: 2,
      beta: 8,
      decayGamma: 0.92,
      exposures: 0,
      verifiedT2Joins: 0,
      verifiedT3Matches: 0,
      stopCount: 0,
      ftcFailCount: 0,
      spentCents: 0,
      targetCpaCents: 711,
      allocatedShareBps: 3_200,
      allocatedCents: 320_000,
      state: "active",
      killReason: null,
      updatedAt: updatedAtIso,
    },
    {
      id: `${campaignId}:creator_video`,
      campaignId,
      armKey: "creator_video",
      label: "Street-Interview Creators (YT/TT/IG)",
      track: "creator_video",
      playCode: "NYC-TRACK-B",
      city: "nyc",
      appId: "slop",
      alpha: 2,
      beta: 8,
      decayGamma: 0.92,
      exposures: 0,
      verifiedT2Joins: 0,
      verifiedT3Matches: 0,
      stopCount: 0,
      ftcFailCount: 0,
      spentCents: 0,
      targetCpaCents: 759,
      allocatedShareBps: 3_300,
      allocatedCents: 330_000,
      state: "active",
      killReason: null,
      updatedAt: updatedAtIso,
    },
    {
      id: `${campaignId}:event_activation`,
      campaignId,
      armKey: "event_activation",
      label: "NYC Event & Venue Activators",
      track: "event_activation",
      playCode: "NYC-TRACK-C",
      city: "nyc",
      appId: "friends",
      alpha: 2,
      beta: 8,
      decayGamma: 0.92,
      exposures: 0,
      verifiedT2Joins: 0,
      verifiedT3Matches: 0,
      stopCount: 0,
      ftcFailCount: 0,
      spentCents: 0,
      targetCpaCents: 895,
      allocatedShareBps: 1_700,
      allocatedCents: 170_000,
      state: "active",
      killReason: null,
      updatedAt: updatedAtIso,
    },
    {
      id: `${campaignId}:print_qr`,
      campaignId,
      armKey: "print_qr",
      label: "Serialized 4x6 QR Flier Print",
      track: "print_qr",
      playCode: "NYC-TRACK-D",
      city: "nyc",
      appId: "all",
      alpha: 2,
      beta: 8,
      decayGamma: 0.92,
      exposures: 0,
      verifiedT2Joins: 0,
      verifiedT3Matches: 0,
      stopCount: 0,
      ftcFailCount: 0,
      spentCents: 0,
      targetCpaCents: 858,
      allocatedShareBps: 800,
      allocatedCents: 80_000,
      state: "active",
      killReason: null,
      updatedAt: updatedAtIso,
    },
    {
      id: `${campaignId}:agency_reserve`,
      campaignId,
      armKey: "agency_reserve",
      label: "W-2 NYC Agency Surge Reserve",
      track: "agency_reserve",
      playCode: "NYC-TRACK-E",
      city: "nyc",
      appId: "all",
      alpha: 1,
      beta: 4,
      decayGamma: 0.92,
      exposures: 0,
      verifiedT2Joins: 0,
      verifiedT3Matches: 0,
      stopCount: 0,
      ftcFailCount: 0,
      spentCents: 0,
      targetCpaCents: 1_111,
      allocatedShareBps: 1_000,
      allocatedCents: 100_000,
      state: "active",
      killReason: null,
      updatedAt: updatedAtIso,
    },
  ];
}

export function computeBanditAllocations(
  input: BanditRebalanceInput,
): BanditRebalanceResult {
  const policy: BanditPolicyParams = {
    ...DEFAULT_BANDIT_POLICY,
    ...input.policy,
  };
  const safeAvailableCents = Math.max(0, Math.floor(input.availableCents));
  const rootRng = new Rng(input.seed).fork("bandit", input.campaignId);

  if (input.riskDial === "lockdown" || safeAvailableCents === 0) {
    const lockedArms: BanditArm[] = input.arms.map((arm) => ({
      ...arm,
      allocatedShareBps: 0,
      allocatedCents: 0,
      updatedAt: input.nowIso,
    }));
    const decisions: BanditArmDecision[] = lockedArms.map((arm) => ({
      armId: arm.id,
      armKey: arm.armKey,
      previousShareBps: arm.allocatedShareBps,
      nextShareBps: 0,
      allocatedCents: 0,
      sampledPosterior: 0,
      efficiencyScore: 0,
      observedCpaCents: observedCpaCents(arm),
      stopRate: observedStopRate(arm),
      bucket: "locked",
      state: arm.state,
      killReason: input.riskDial === "lockdown" ? "campaign_lockdown" : arm.killReason,
    }));
    return {
      campaignId: input.campaignId,
      seed: input.seed,
      rebalancedAt: input.nowIso,
      availableCents: safeAvailableCents,
      totalAllocatedCents: 0,
      exploitAllocatedCents: 0,
      exploreAllocatedCents: 0,
      agencySurgeTriggered: false,
      agencyReserveReallocatedTo: null,
      arms: lockedArms,
      decisions,
    };
  }

  const weeksElapsed = input.weeksElapsed ?? 0;
  const decayedArms = input.arms.map((arm) =>
    weeksElapsed > 0 ? applyWeeklyDecay(arm, weeksElapsed, policy.weeklyDecayGamma) : { ...arm },
  );

  let remainingHealthy = decayedArms.filter(
    (a) => a.state !== "halted_safety" && a.state !== "auto_killed",
  ).length;

  const evaluated = decayedArms.map((arm) => {
    const verdict = evaluateArmKillRules(arm, policy, remainingHealthy);
    if (
      (verdict.state === "auto_killed" || verdict.state === "halted_safety") &&
      arm.state !== "auto_killed" &&
      arm.state !== "halted_safety"
    ) {
      remainingHealthy = Math.max(0, remainingHealthy - 1);
    }
    return {
      ...arm,
      state: verdict.state,
      killReason: verdict.killReason,
    };
  });

  const dayOfCampaign = input.dayOfCampaign ?? 1;
  const directNoShowRate = input.directNoShowRate ?? 0;
  const agencyArm = evaluated.find((a) => a.track === "agency_reserve");
  const agencyAlive =
    agencyArm !== undefined &&
    agencyArm.state !== "halted_safety" &&
    agencyArm.state !== "auto_killed";

  let agencyLockedCents = 0;
  let agencySurgeTriggered = false;
  let agencyReserveReallocatedTo: string | null = null;

  if (agencyAlive && agencyArm) {
    const reserveSlice = Math.min(policy.agencyReserveCents, safeAvailableCents);
    if (dayOfCampaign < 15) {
      agencyLockedCents = reserveSlice;
    } else if (directNoShowRate > policy.day15AgencyNoShowThreshold) {
      agencyLockedCents = reserveSlice;
      agencySurgeTriggered = true;
    } else {
      agencyLockedCents = 0;
    }
  }

  const variablePoolCents = Math.max(0, safeAvailableCents - agencyLockedCents);

  const sampledByKey = new Map<
    string,
    { posterior: number; efficiency: number; cpa: number | null; stopRate: number }
  >();

  for (const arm of evaluated) {
    const armRng = rootRng.fork(arm.armKey);
    const posterior = sampleBeta(armRng, arm.alpha, arm.beta);
    const cpa = observedCpaCents(arm);
    const unitCostUsd = Math.max(0.5, (cpa ?? arm.targetCpaCents) / 100);
    const qualityRatio =
      arm.verifiedT2Joins > 0
        ? 1 + (arm.verifiedT3Matches * (policy.t3QualityWeight - 1)) / arm.verifiedT2Joins
        : 1;
    const efficiency = (posterior * qualityRatio) / unitCostUsd;
    sampledByKey.set(arm.armKey, {
      posterior,
      efficiency,
      cpa,
      stopRate: observedStopRate(arm),
    });
  }

  const activeVariableArms = evaluated.filter(
    (a) =>
      a.state !== "halted_safety" &&
      a.state !== "auto_killed" &&
      a.track !== "agency_reserve",
  );

  if (agencyAlive && dayOfCampaign >= 15 && !agencySurgeTriggered && activeVariableArms.length > 0) {
    const lowestCpaWinner = [...activeVariableArms].sort((a, b) => {
      const ca = observedCpaCents(a) ?? a.targetCpaCents;
      const cb = observedCpaCents(b) ?? b.targetCpaCents;
      if (ca !== cb) return ca - cb;
      return a.armKey.localeCompare(b.armKey);
    })[0];
    agencyReserveReallocatedTo = lowestCpaWinner?.armKey ?? null;
  }

  const exploitCandidates = activeVariableArms.filter((a) => {
    const stats = sampledByKey.get(a.armKey);
    if (!stats) return false;
    return stats.stopRate < policy.maxStopRateForExploit;
  });

  const exploreCandidates = activeVariableArms.filter(
    (a) => a.exposures < policy.minExposuresBeforeRoiKill,
  );

  const effectiveExploitShare =
    exploreCandidates.length === 0
      ? 10_000 - policy.minExploreReserveBps
      : exploitCandidates.length === 0
        ? 0
        : policy.exploitShareBps;

  const exploitPoolCents = Math.floor((variablePoolCents * effectiveExploitShare) / 10_000);
  const explorePoolCents = variablePoolCents - exploitPoolCents;

  const exploitWeights = (exploitCandidates.length > 0 ? exploitCandidates : activeVariableArms).map(
    (a) => ({
      key: a.armKey,
      weight: sampledByKey.get(a.armKey)?.efficiency ?? 1,
    }),
  );

  const explorePoolTargets =
    exploreCandidates.length > 0 ? exploreCandidates : activeVariableArms;
  const exploreWeights = explorePoolTargets.map((a) => ({
    key: a.armKey,
    weight: 1 / Math.sqrt(a.exposures + 1),
  }));

  const exploitDist = distributeLargestRemainder(exploitPoolCents, exploitWeights);
  const exploreDist = distributeLargestRemainder(explorePoolCents, exploreWeights);

  const rawCents = new Map<string, number>();
  for (const arm of evaluated) {
    if (arm.state === "halted_safety" || arm.state === "auto_killed") {
      rawCents.set(arm.armKey, 0);
    } else if (arm.track === "agency_reserve") {
      rawCents.set(arm.armKey, agencyLockedCents);
    } else {
      rawCents.set(
        arm.armKey,
        (exploitDist.get(arm.armKey) ?? 0) + (exploreDist.get(arm.armKey) ?? 0),
      );
    }
  }

  const maxPerArmCents = Math.floor((safeAvailableCents * policy.maxArmShareBps) / 10_000);
  if (activeVariableArms.length >= 2) {
    let overflow = 0;
    for (const arm of activeVariableArms) {
      const current = rawCents.get(arm.armKey) ?? 0;
      if (current > maxPerArmCents) {
        overflow += current - maxPerArmCents;
        rawCents.set(arm.armKey, maxPerArmCents);
      }
    }
    if (overflow > 0) {
      const underCap = activeVariableArms.filter(
        (a) => (rawCents.get(a.armKey) ?? 0) < maxPerArmCents,
      );
      const extraDist = distributeLargestRemainder(
        overflow,
        underCap.map((a) => ({
          key: a.armKey,
          weight: maxPerArmCents - (rawCents.get(a.armKey) ?? 0),
        })),
      );
      for (const arm of underCap) {
        const nextVal = Math.min(
          maxPerArmCents,
          (rawCents.get(arm.armKey) ?? 0) + (extraDist.get(arm.armKey) ?? 0),
        );
        rawCents.set(arm.armKey, nextVal);
      }
    }
  }

  const totalAllocatedCents = Array.from(rawCents.values()).reduce((s, v) => s + v, 0);
  const topExploitKey = [...exploitWeights].sort((a, b) => b.weight - a.weight)[0]?.key ?? null;

  const updatedArms: BanditArm[] = [];
  const decisions: BanditArmDecision[] = [];

  for (const arm of evaluated) {
    const allocatedCents = rawCents.get(arm.armKey) ?? 0;
    const nextShareBps =
      safeAvailableCents > 0 ? Math.round((allocatedCents / safeAvailableCents) * 10_000) : 0;
    const stats = sampledByKey.get(arm.armKey) ?? {
      posterior: 0,
      efficiency: 0,
      cpa: observedCpaCents(arm),
      stopRate: observedStopRate(arm),
    };

    const isKilled = arm.state === "halted_safety" || arm.state === "auto_killed";
    const nextState: BanditArmState = isKilled
      ? arm.state
      : arm.armKey === topExploitKey && arm.exposures >= policy.minExposuresBeforeStopKill
        ? "scaled"
        : arm.track === "agency_reserve" && agencyLockedCents === 0
          ? "paused_low_roi"
          : "active";

    const bucket: BanditArmDecision["bucket"] = isKilled
      ? "killed"
      : arm.track === "agency_reserve"
        ? "reserve"
        : (exploitDist.get(arm.armKey) ?? 0) >= (exploreDist.get(arm.armKey) ?? 0)
          ? "exploit"
          : "explore";

    updatedArms.push({
      ...arm,
      allocatedShareBps: nextShareBps,
      allocatedCents,
      state: nextState,
      updatedAt: input.nowIso,
    });

    decisions.push({
      armId: arm.id,
      armKey: arm.armKey,
      previousShareBps: arm.allocatedShareBps,
      nextShareBps,
      allocatedCents,
      sampledPosterior: Number(stats.posterior.toFixed(4)),
      efficiencyScore: Number(stats.efficiency.toFixed(4)),
      observedCpaCents: stats.cpa,
      stopRate: Number(stats.stopRate.toFixed(4)),
      bucket,
      state: nextState,
      killReason: arm.killReason,
    });
  }

  return {
    campaignId: input.campaignId,
    seed: input.seed,
    rebalancedAt: input.nowIso,
    availableCents: safeAvailableCents,
    totalAllocatedCents,
    exploitAllocatedCents: exploitPoolCents,
    exploreAllocatedCents: explorePoolCents,
    agencySurgeTriggered,
    agencyReserveReallocatedTo,
    arms: updatedArms,
    decisions,
  };
}
