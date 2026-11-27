import {
  CITY_IDS,
  Rng,
  earliestDayKeyOf,
  getCity,
  hash32,
  type City,
  type MemberId,
  type QualitySignals,
  type VampireTelemetry,
} from "@thenetwork/core";
import type { LeagueAxisProfile } from "../../../core/src/generated/qualityAndLeague.ts";
import { birthKeyForAgeOn } from "../generator.ts";
import type { StratumArchetype } from "../persona.ts";
import {
  FIRST_NAMES,
  JOURNEY_STYLES,
  LAST_NAMES,
  PRIVATE_DISCLOSURES,
  type JourneyWritingStyle,
} from "../taxonomy.ts";
import { ALL_JOURNEY_CHANNELS, type JourneyChannelId } from "./channels.ts";

export const JOURNEY_AGE_BRACKETS = [
  "under13",
  "teen_13_17",
  "young_adult_18_22",
  "prime_23_34",
  "midlife_35_54",
  "senior_55_75",
] as const;
export type JourneyAgeBracket = (typeof JOURNEY_AGE_BRACKETS)[number];

export const CLARITY_BANDS = [
  "high_clarity_concise",
  "high_bandwidth_nuanced",
  "low_verbosity_ambiguous",
  "noisy_typo_vtt",
] as const;
export type ClarityBand = (typeof CLARITY_BANDS)[number];

export const JOURNEY_STRATA: readonly StratumArchetype[] = [
  "uhnw_mogul",
  "famous_creator",
  "elite_researcher",
  "founder_operator",
  "aspiring_creative",
  "working_class_local",
] as const;

export const JOURNEY_BAD_ACTORS = [
  "none",
  "serial_flake",
  "creep_harasser",
  "vampire_pitch_slapper",
  "slop_voip",
  "prompt_injector",
  "adult_poser",
] as const;
export type JourneyBadActorKind = (typeof JOURNEY_BAD_ACTORS)[number];

export interface JourneyReliabilityProfile {
  readonly strikes: number;
  readonly cleanStreak: number;
  readonly provisionalNoShow: boolean;
}

export interface JourneyPersona {
  readonly id: MemberId;
  readonly firstName: string;
  readonly fullName: string;
  readonly city: City;
  readonly neighborhood: string;
  readonly age: number;
  readonly birthKey: number;
  readonly ageBracket: JourneyAgeBracket;
  readonly style: JourneyWritingStyle;
  readonly clarityBand: ClarityBand;
  readonly stratum: StratumArchetype;
  readonly badActor: JourneyBadActorKind;
  readonly channel: JourneyChannelId;
  readonly canary: string;
  readonly privateFact: string;
  readonly qualitySignals: QualitySignals;
  readonly reliability: JourneyReliabilityProfile;
  readonly vampire: VampireTelemetry;
  readonly leagueProfile: LeagueAxisProfile;
  readonly quietHours: [number, number];
}

export interface JourneyCohort {
  readonly seed: number;
  readonly members: readonly JourneyPersona[];
  readonly byStyle: ReadonlyMap<JourneyWritingStyle, JourneyPersona[]>;
  readonly byAgeBracket: ReadonlyMap<JourneyAgeBracket, JourneyPersona[]>;
  readonly byClarityBand: ReadonlyMap<ClarityBand, JourneyPersona[]>;
  readonly byStratum: ReadonlyMap<StratumArchetype, JourneyPersona[]>;
  readonly byChannel: ReadonlyMap<JourneyChannelId, JourneyPersona[]>;
}

function ageForBracket(bracket: JourneyAgeBracket, r: Rng): number {
  switch (bracket) {
    case "under13": return r.int(11, 12);
    case "teen_13_17": return r.int(14, 17);
    case "young_adult_18_22": return r.int(18, 22);
    case "prime_23_34": return r.int(23, 34);
    case "midlife_35_54": return r.int(35, 54);
    case "senior_55_75": return r.int(55, 74);
  }
}

function baseLeagueProfile(stratum: StratumArchetype, badActor: JourneyBadActorKind): LeagueAxisProfile {
  const extractive = badActor === "vampire_pitch_slapper" || badActor === "creep_harasser";
  switch (stratum) {
    case "uhnw_mogul":
      return {
        economic: 96, socialCapital: 92, domainRung: 95, aesthetic: 75,
        discretion: 92, extractionRisk: extractive ? 75 : 10, publicity: 88,
        verifiedEvidence: true, trajectory: 70, crossCapitalOpen: true, sharedGuild: false,
      };
    case "famous_creator":
      return {
        economic: 82, socialCapital: 94, domainRung: 85, aesthetic: 88,
        discretion: 84, extractionRisk: extractive ? 72 : 14, publicity: 95,
        verifiedEvidence: true, trajectory: 82, crossCapitalOpen: true, sharedGuild: true,
      };
    case "elite_researcher":
      return {
        economic: 68, socialCapital: 76, domainRung: 92, aesthetic: 62,
        discretion: 88, extractionRisk: extractive ? 68 : 12, publicity: 55,
        verifiedEvidence: true, trajectory: 76, crossCapitalOpen: true, sharedGuild: true,
      };
    case "founder_operator":
      return {
        economic: 74, socialCapital: 78, domainRung: 80, aesthetic: 70,
        discretion: 78, extractionRisk: extractive ? 78 : 20, publicity: 52,
        verifiedEvidence: true, trajectory: 88, crossCapitalOpen: true, sharedGuild: false,
      };
    case "aspiring_creative":
      return {
        economic: 36, socialCapital: 48, domainRung: 56, aesthetic: 74,
        discretion: 76, extractionRisk: extractive ? 82 : 18, publicity: 30,
        verifiedEvidence: !extractive && badActor !== "slop_voip", trajectory: 86,
        crossCapitalOpen: true, sharedGuild: true,
      };
    case "working_class_local":
      return {
        economic: 32, socialCapital: 54, domainRung: 48, aesthetic: 60,
        discretion: 80, extractionRisk: extractive ? 85 : 15, publicity: 15,
        verifiedEvidence: badActor !== "slop_voip", trajectory: 52,
        crossCapitalOpen: false, sharedGuild: true,
      };
  }
}

function qualityFor(stratum: StratumArchetype, badActor: JourneyBadActorKind, ageBracket: JourneyAgeBracket): QualitySignals {
  if (badActor === "slop_voip") {
    return {
      provenanceScore: 5, specificityScore: 6, hygieneScore: 8, completionScore: 4,
      voipOrPumping: true, sybilFlagged: true, chronicLowEffort: true, unverifiedHype: true, newcomerDays: 2,
    };
  }
  if (stratum === "uhnw_mogul" || stratum === "elite_researcher" || stratum === "famous_creator") {
    return {
      provenanceScore: 32, specificityScore: 22, hygieneScore: 24, completionScore: 12,
      voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 30,
    };
  }
  if (ageBracket === "teen_13_17" || ageBracket === "under13") {
    return {
      provenanceScore: 20, specificityScore: 18, hygieneScore: 22, completionScore: 12,
      voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 5,
    };
  }
  return {
    provenanceScore: 22, specificityScore: 18, hygieneScore: 20, completionScore: 12,
    voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 10,
  };
}

function reliabilityFor(badActor: JourneyBadActorKind): JourneyReliabilityProfile {
  if (badActor === "serial_flake") {
    return { strikes: 6, cleanStreak: 0, provisionalNoShow: true };
  }
  return { strikes: 0, cleanStreak: 4, provisionalNoShow: false };
}

function vampireFor(badActor: JourneyBadActorKind): VampireTelemetry {
  if (badActor === "vampire_pitch_slapper") {
    return {
      introsReceived90d: 6,
      positiveCounterpartVotes90d: 0,
      asymmetricNegativeVotes90d: 4,
      pitchSignals90d: 4,
      distinctSelfPromoReports90d: 2,
    };
  }
  return {
    introsReceived90d: 3,
    positiveCounterpartVotes90d: 3,
    asymmetricNegativeVotes90d: 0,
    pitchSignals90d: 0,
    distinctSelfPromoReports90d: 0,
  };
}

export function generateJourneyCohort(seed: number, nowMs: number): JourneyCohort {
  const root = new Rng(hash32("pass4-journeys-cohort", seed));
  const dayKey = earliestDayKeyOf(nowMs);
  const totalCount = 28;
  const members: JourneyPersona[] = [];

  for (let i = 0; i < totalCount; i++) {
    const r = root.fork("member", i);
    const style = JOURNEY_STYLES[i % JOURNEY_STYLES.length]!;
    const ageBracket = JOURNEY_AGE_BRACKETS[i % JOURNEY_AGE_BRACKETS.length]!;
    const clarityBand = CLARITY_BANDS[i % CLARITY_BANDS.length]!;
    const stratum = JOURNEY_STRATA[i % JOURNEY_STRATA.length]!;
    const channel = ALL_JOURNEY_CHANNELS[i % ALL_JOURNEY_CHANNELS.length]!;
    const badActor: JourneyBadActorKind =
      i >= 14 && i < 20 && ageBracket !== "under13" && ageBracket !== "teen_13_17"
        ? JOURNEY_BAD_ACTORS[(i - 14) + 1]!
        : "none";

    const city = CITY_IDS[i % CITY_IDS.length]!;
    const citySpec = getCity(city);
    const hoods = citySpec?.neighborhoods.map(n => n.name) ?? ["Downtown"];
    const neighborhood = hoods[i % hoods.length]!;
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length]!;
    const age = ageForBracket(ageBracket, r);
    const birthKey = birthKeyForAgeOn(age, dayKey, r.fork("birth"));
    const canary = `JN-${String(1000 + ((seed * 97 + i * 31) % 8999))}-ORCHID`;
    const privateFact = `${PRIVATE_DISCLOSURES[i % PRIVATE_DISCLOSURES.length]!} (ref ${canary})`;

    members.push({
      id: `jm-${String(i + 1).padStart(3, "0")}`,
      firstName,
      fullName: `${firstName} ${lastName}`,
      city,
      neighborhood,
      age,
      birthKey,
      ageBracket,
      style,
      clarityBand,
      stratum,
      badActor,
      channel,
      canary,
      privateFact,
      qualitySignals: qualityFor(stratum, badActor, ageBracket),
      reliability: reliabilityFor(badActor),
      vampire: vampireFor(badActor),
      leagueProfile: baseLeagueProfile(stratum, badActor),
      quietHours: [22, 8],
    });
  }

  const byStyle = new Map<JourneyWritingStyle, JourneyPersona[]>();
  const byAgeBracket = new Map<JourneyAgeBracket, JourneyPersona[]>();
  const byClarityBand = new Map<ClarityBand, JourneyPersona[]>();
  const byStratum = new Map<StratumArchetype, JourneyPersona[]>();
  const byChannel = new Map<JourneyChannelId, JourneyPersona[]>();

  for (const m of members) {
    (byStyle.get(m.style) ?? byStyle.set(m.style, []).get(m.style)!).push(m);
    (byAgeBracket.get(m.ageBracket) ?? byAgeBracket.set(m.ageBracket, []).get(m.ageBracket)!).push(m);
    (byClarityBand.get(m.clarityBand) ?? byClarityBand.set(m.clarityBand, []).get(m.clarityBand)!).push(m);
    (byStratum.get(m.stratum) ?? byStratum.set(m.stratum, []).get(m.stratum)!).push(m);
    (byChannel.get(m.channel) ?? byChannel.set(m.channel, []).get(m.channel)!).push(m);
  }

  return { seed, members, byStyle, byAgeBracket, byClarityBand, byStratum, byChannel };
}
