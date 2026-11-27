import type { AppId, City } from "@thenetwork/core";
import type { MarketingDesireLane } from "../marketingTemplates.ts";
import type { ResponseMode } from "../responseEngine.ts";

export type UnifiedScenarioId =
  | "city_launch"
  | "viral_spike"
  | "platform_crackdown"
  | "cold_start"
  | "high_volume_stress";

export type SimRiskDial = "conservative" | "balanced" | "blitz" | "lockdown";

export type SimSpeedPreset = "paused" | "1x" | "10x" | "60x" | "360x" | "1000x" | "turbo";

export type ScheduledShockKind =
  | { kind: "viral_multiplier"; platform: "tiktok" | "x" | "instagram"; multiplier: number; minorSurgeFactor: number; sybilSurgeFactor: number }
  | { kind: "shadowban_wave"; services: ("x" | "instagram" | "tiktok")[]; reachMultiplier: number }
  | { kind: "captcha_wave"; services: ("instagram" | "tiktok" | "x")[]; probability: number }
  | { kind: "email_bounce_storm"; hardBounceRate: number; spamComplaintRate: number }
  | { kind: "blooio_safety"; action: "reply_only" | "new_conversations_paused" | "account_review" }
  | { kind: "intermittent_http_faults"; services: ("x" | "instagram" | "meta_ads" | "resend")[]; status: 429 | 503; probability: number };

export interface ScheduledScenarioShock {
  id: string;
  atDay: number;
  durationDays: number;
  label: string;
  shock: ScheduledShockKind;
}

export interface ScenarioWinTarget {
  minVerifiedAdultSignups?: number;
  minGoodMeetings?: number;
  maxBlendedCpaUsd?: number;
  minViralKFactor?: number;
  minNewcomerFirstMeetingRate?: number;
  minCrackdownRecoveryShare?: number;
  maxStopRateBps?: number;
  maxExpiredReviews?: number;
  requireZeroSafetyViolations: true;
}

export interface UnifiedScenarioPreset {
  id: UnifiedScenarioId;
  title: string;
  description: string;
  app: AppId;
  cities: readonly City[];
  days: number;
  initialActiveMembers: number;
  seededVips: number;
  latentProspects: number;
  monthlyBudgetCents: number;
  riskDial: SimRiskDial;
  defaultSpeed: SimSpeedPreset;
  defaultResponseMode: ResponseMode;
  focusLanes: readonly MarketingDesireLane[];
  skepticismBias: number;
  flakinessBias: number;
  minorProspectShare: number;
  under13ProbeShare: number;
  sybilShare: number;
  enableS3Checkpoints: boolean;
  shocks: readonly ScheduledScenarioShock[];
  winTarget: ScenarioWinTarget;
}

export const UNIFIED_SCENARIOS: readonly UnifiedScenarioPreset[] = [
  {
    id: "city_launch",
    title: "City Launch",
    description: "Bootstrap NYC from 20 seeded VIPs and 3,000 latent prospects with $5,000 budget and uniform bandit priors.",
    app: "ntwrk",
    cities: ["nyc"],
    days: 30,
    initialActiveMembers: 20,
    seededVips: 20,
    latentProspects: 3_000,
    monthlyBudgetCents: 500_000,
    riskDial: "balanced",
    defaultSpeed: "60x",
    defaultResponseMode: "hybrid",
    focusLanes: [
      "friends_belonging",
      "builders_founders",
      "creative_cultural",
      "fitness_sports",
      "local_hosts",
      "love_dating",
    ],
    skepticismBias: 0.15,
    flakinessBias: 0.08,
    minorProspectShare: 0.05,
    under13ProbeShare: 0.01,
    sybilShare: 0.03,
    enableS3Checkpoints: true,
    shocks: [],
    winTarget: {
      minVerifiedAdultSignups: 250,
      minGoodMeetings: 40,
      maxBlendedCpaUsd: 12,
      requireZeroSafetyViolations: true,
    },
  },
  {
    id: "viral_spike",
    title: "Viral Spike",
    description: "NYC with 250 active members and 15,000 prospects. Day 3 TikTok video hits 20x reach alongside 5x underage and sybil surge.",
    app: "ntwrk",
    cities: ["nyc"],
    days: 21,
    initialActiveMembers: 250,
    seededVips: 35,
    latentProspects: 15_000,
    monthlyBudgetCents: 600_000,
    riskDial: "balanced",
    defaultSpeed: "60x",
    defaultResponseMode: "hybrid",
    focusLanes: [
      "friends_belonging",
      "creative_cultural",
      "fitness_sports",
      "status_scenes",
      "campus_early_career",
    ],
    skepticismBias: 0.12,
    flakinessBias: 0.1,
    minorProspectShare: 0.06,
    under13ProbeShare: 0.015,
    sybilShare: 0.04,
    enableS3Checkpoints: true,
    shocks: [
      {
        id: "viral_day3_tiktok",
        atDay: 3,
        durationDays: 5,
        label: "TikTok 20x creator viral wave",
        shock: {
          kind: "viral_multiplier",
          platform: "tiktok",
          multiplier: 20,
          minorSurgeFactor: 5,
          sybilSurgeFactor: 5,
        },
      },
    ],
    winTarget: {
      minNewcomerFirstMeetingRate: 0.55,
      maxExpiredReviews: 0,
      requireZeroSafetyViolations: true,
    },
  },
  {
    id: "platform_crackdown",
    title: "Platform Crackdown",
    description: "NYC + SF multi-city ops hit by Day 2 X/IG shadowban, Day 4 CAPTCHA wave, and Day 6 email bounce storm + Blooio reply-only.",
    app: "ntwrk",
    cities: ["nyc", "sf"],
    days: 21,
    initialActiveMembers: 400,
    seededVips: 40,
    latentProspects: 8_000,
    monthlyBudgetCents: 750_000,
    riskDial: "balanced",
    defaultSpeed: "60x",
    defaultResponseMode: "hybrid",
    focusLanes: [
      "builders_founders",
      "friends_belonging",
      "career_money",
      "local_hosts",
      "creative_cultural",
    ],
    skepticismBias: 0.2,
    flakinessBias: 0.1,
    minorProspectShare: 0.04,
    under13ProbeShare: 0.01,
    sybilShare: 0.04,
    enableS3Checkpoints: true,
    shocks: [
      {
        id: "crackdown_day2_shadowban",
        atDay: 2,
        durationDays: 8,
        label: "X and Instagram shadowban wave",
        shock: {
          kind: "shadowban_wave",
          services: ["x", "instagram"],
          reachMultiplier: 0.05,
        },
      },
      {
        id: "crackdown_day4_captcha",
        atDay: 4,
        durationDays: 6,
        label: "DeviceBridge CAPTCHA challenge wave",
        shock: {
          kind: "captcha_wave",
          services: ["instagram", "tiktok", "x"],
          probability: 0.65,
        },
      },
      {
        id: "crackdown_day6_email_bounce",
        atDay: 6,
        durationDays: 5,
        label: "Email bounce and complaint storm",
        shock: {
          kind: "email_bounce_storm",
          hardBounceRate: 0.18,
          spamComplaintRate: 0.012,
        },
      },
      {
        id: "crackdown_day6_blooio_reply_only",
        atDay: 6,
        durationDays: 4,
        label: "Blooio safety reply-only restriction",
        shock: {
          kind: "blooio_safety",
          action: "reply_only",
        },
      },
    ],
    winTarget: {
      minCrackdownRecoveryShare: 0.6,
      maxStopRateBps: 150,
      requireZeroSafetyViolations: true,
    },
  },
  {
    id: "cold_start",
    title: "Cold Start",
    description: "Miami with 0 active members, 1,500 skeptical/flaky prospects, and a tight $500 budget over 21 sim days.",
    app: "ntwrk",
    cities: ["miami"],
    days: 21,
    initialActiveMembers: 0,
    seededVips: 12,
    latentProspects: 1_500,
    monthlyBudgetCents: 50_000,
    riskDial: "conservative",
    defaultSpeed: "60x",
    defaultResponseMode: "hybrid",
    focusLanes: ["friends_belonging", "local_hosts", "fitness_sports"],
    skepticismBias: 0.42,
    flakinessBias: 0.24,
    minorProspectShare: 0.05,
    under13ProbeShare: 0.015,
    sybilShare: 0.05,
    enableS3Checkpoints: true,
    shocks: [],
    winTarget: {
      minGoodMeetings: 25,
      minViralKFactor: 0.35,
      requireZeroSafetyViolations: true,
    },
  },
  {
    id: "high_volume_stress",
    title: "High Volume Stress",
    description: "All 5 US launch cities at 1000x-Turbo speed with 5,000 active + 50,000 latent prospects, intermittent 429/503 faults, and S3 checkpoints.",
    app: "ntwrk",
    cities: ["sf", "nyc", "la", "chicago", "miami"],
    days: 14,
    initialActiveMembers: 5_000,
    seededVips: 100,
    latentProspects: 50_000,
    monthlyBudgetCents: 2_500_000,
    riskDial: "blitz",
    defaultSpeed: "1000x",
    defaultResponseMode: "canned",
    focusLanes: [
      "friends_belonging",
      "builders_founders",
      "love_dating",
      "career_money",
      "creative_cultural",
      "fitness_sports",
      "local_hosts",
      "diaspora_newcomers",
    ],
    skepticismBias: 0.16,
    flakinessBias: 0.1,
    minorProspectShare: 0.05,
    under13ProbeShare: 0.01,
    sybilShare: 0.04,
    enableS3Checkpoints: true,
    shocks: [
      {
        id: "stress_429_burst",
        atDay: 2,
        durationDays: 10,
        label: "Intermittent 429 rate-limit spikes",
        shock: {
          kind: "intermittent_http_faults",
          services: ["x", "instagram", "meta_ads", "resend"],
          status: 429,
          probability: 0.18,
        },
      },
      {
        id: "stress_503_burst",
        atDay: 5,
        durationDays: 5,
        label: "Intermittent 503 upstream instability",
        shock: {
          kind: "intermittent_http_faults",
          services: ["meta_ads", "resend"],
          status: 503,
          probability: 0.12,
        },
      },
    ],
    winTarget: {
      minVerifiedAdultSignups: 500,
      requireZeroSafetyViolations: true,
    },
  },
];

export const UNIFIED_SCENARIO_MAP: Readonly<Record<UnifiedScenarioId, UnifiedScenarioPreset>> =
  Object.fromEntries(UNIFIED_SCENARIOS.map(s => [s.id, s])) as Record<UnifiedScenarioId, UnifiedScenarioPreset>;

export function getUnifiedScenario(id: UnifiedScenarioId): UnifiedScenarioPreset {
  return UNIFIED_SCENARIO_MAP[id];
}
