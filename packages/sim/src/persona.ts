// Persona model: a synthetic member with HIDDEN ground truth (what the Network can never
// read directly) and a PUBLIC side (what they will reveal in conversation). PRD 34.3.
import { DAY, canBeMatched, clamp01, type Category, type City, type FacetKind, type MemberId, type PrivacyScope } from "@thenetwork/core";
import { Rng, hash32 } from "@thenetwork/core";
import type { WritingStyle } from "./taxonomy.ts";
import type { Knowledge, RichnessTier } from "./sources.ts";
import { inHourWindow } from "./time.ts";

export type Archetype =
  | "regular" | "busy_parent" | "newcomer" | "connector" | "introvert" | "very_active"
  | "never_replies" | "traveler";
export type AdversarialKind =
  | "spammer" | "scammer" | "harasser" | "minor" | "prompt_injector" | "block_abuser";

export type StratumArchetype =
  | "uhnw_mogul"
  | "famous_creator"
  | "elite_researcher"
  | "founder_operator"
  | "aspiring_creative"
  | "working_class_local";

export type PersonaLifeStage =
  | "student"
  | "early_career"
  | "established_single"
  | "partnered_no_kids"
  | "young_family"
  | "established_family"
  | "empty_nest"
  | "post_exit"
  | "retired";

export type HumorRegister =
  | "dry_ironic"
  | "absurdist"
  | "warm_earnest"
  | "nerdy_wordplay"
  | "roast_banter";

export type AttachmentStyle = "secure" | "anxious" | "avoidant";
export type SpendComfortTier = "free" | "low" | "moderate" | "high" | "unconstrained";

export type ConnectionGoalType =
  | "dating"
  | "friendship"
  | "work_hiring"
  | "step_ahead_mentorship"
  | "creative_cocreation"
  | "patronage_sponsorship"
  | "intellectual_salon"
  | "habit_accountability"
  | "event_travel_companion"
  | "local_mutual_aid"
  | "parent_support_adult"
  | "coliving_roommate"
  | "life_transition_peer"
  | "craft_maker_guild"
  | "executive_peer_council"
  | "civic_action_coalition"
  | "language_tandem";

export interface ExchangeGoal {
  connectionType: ConnectionGoalType;
  direction: "seeks" | "offers" | "mutual_pool";
  role: string;
  complementaryRoles: string[];
  domain: string;
  targetRungDelta?: [number, number];
}

export interface SubstanceProfile {
  alcohol: "none" | "light" | "social" | "heavy";
  cannabis: "none" | "occasional" | "regular";
  soberProtected: boolean;
}

export interface DunbarOpenSlots {
  inner5: boolean;
  sympathy15: boolean;
  affinity50: boolean;
}

export interface TrueAttractiveness {
  face: number;
  body: number;
  overall: number;
}

export interface StrataSignals {
  stratumArchetype: StratumArchetype;
  adversarySubkind?: "grifter_pitcher" | "clout_chaser";
  economicCapital: number;
  culturalEmbodied: number;
  culturalInstitutional: number;
  socialCapital: number;
  symbolicPublicity: number;
  peerPrestige: number;
  compositeTier: number;
  domainRungs: Record<string, number>;
  trueAttractiveness?: TrueAttractiveness;
  lifeStage: PersonaLifeStage;
  activeTransitions: string[];
  humorRegister: HumorRegister[];
  depthPreference: number;
  attachmentStyle: AttachmentStyle;
  spendComfortTier: SpendComfortTier;
  fitnessIntensity: number;
  substanceProfile: SubstanceProfile;
  workIntensity: number;
  weeklyAvailabilityMask: number[];
  exchangeGoals: ExchangeGoal[];
  extractionPropensity: number;
  discretionScore: number;
  dunbarOpenSlots: DunbarOpenSlots;
}

export interface ProjectedFacetSpec {
  kind: Extract<FacetKind, "trait" | "preference" | "offer" | "goal" | "fact">;
  value: string;
  tags: string[];
  scope: Extract<PrivacyScope, "matchable" | "agent_private">;
}

export interface ProjectedIntentSpec {
  desireId: string;
  text: string;
  category: Category;
  details?: string;
}

export type Gender = "woman" | "man" | "nonbinary";
export type RelationshipType = "friend" | "coworker" | "ex" | "sibling" | "roommate";

export interface Relationship { to: MemberId; type: RelationshipType; closeness: number }

/** Weekly routine used to time persona actions (local hours). */
export interface Routine {
  wake: number; sleep: number;            // e.g. 7, 23
  busyBlocks: [number, number][];         // weekday blocks when they rarely reply (work, school run)
  freeEvenings: number[];                 // weekdays (0=Sun) with free evenings
  homeArea: string; workArea: string;
}

export interface Responsiveness {
  /** Median reply latency in minutes and log-normal sigma. */
  latencyMedianMin: number; latencySigma: number;
  /** Probability of never replying to a given message. */
  ignoreProb: number;
}

export interface Desire {
  id: string; text: string; category: Category; strength: number;
  /**
   * Hidden: when this want genuinely ends (epoch ms): the member got it, lost interest, or life
   * changed. Absent = held throughout. A lapsed want no longer counts for the oracle
   * (Oracle.evaluate via withLiveDesires), and the member withdraws the matching intent at the
   * next re-confirmation they answer (intentRecordTiming).
   */
  lapsesAt?: number;
}

export interface Trip { city: City; fromDay: number; toDay: number }

export interface HiddenTruth extends Partial<StrataSignals> {
  trueAge: number;
  interests: string[];            // interest tags, truly held
  skills: string[];               // skill tags
  desires: Desire[];              // what they actually want, with strength 0-1
  boundaries: string[];
  romance: { optIn: boolean; seeking: Gender[]; ageRange: [number, number] };
  socialEnergy: number;           // 0 introvert .. 1 extrovert
  preferredGroupSize: number;     // 2 = one-to-one
  capacity: number;               // 0..1, spare time/attention this month
  responsiveness: Responsiveness;
  verbosity: number;              // 0 terse .. 1 long messages
  style: WritingStyle;
  flakiness: number;              // P(no-show | accepted) baseline
  honesty: number;                // 1 = reports truthfully; lower = exaggerates/misreports
  openness: number;               // appetite for novel/expansion opportunities
  /** Agent-private disclosure, if any; revealed privately to the Network during onboarding. */
  privateDisclosure?: { fact: string; canary: string };
  trips: Trip[];
  adversarial?: AdversarialKind;
  poser?: true;
  scripted?: true;
  /**
   * How much the Network knows about this persona (hidden; evals stratify by it). Set when the
   * generator runs with `richness`; absent means the legacy "full public profile is known" view.
   */
  richness?: RichnessTier;
}

export interface PublicProfile {
  /** What they say when asked what they're into (may exaggerate or omit). */
  statedInterests: string[];
  statedSkills: string[];
  /**
   * `statedAt` (epoch ms): when the member first told the agent this want. Absent = at join.
   * Harness-side; buildSnapshot turns it into the intent record's createdAt/status.
   */
  statedIntents: { desireId: string; text: string; category: Category; statedAt?: number }[];
  claimedAge: number;
  birthKey?: number;
  verified?: boolean;
  bio: string;
  /** Short sample of how they write, used by LLM persona agents. */
  voiceSample?: string;
  statedLifeStage?: PersonaLifeStage;
  statedSpendTier?: SpendComfortTier;
  statedHumor?: HumorRegister[];
  statedTransitions?: string[];
  statedRoleTags?: string[];
  aspirationalReach?: number;
  hypeClaims?: string[];
  projectedFacets?: ProjectedFacetSpec[];
  projectedIntents?: ProjectedIntentSpec[];
}

export interface Persona {
  id: MemberId;
  name: string;
  gender: Gender;
  archetype: Archetype;
  homeCity: City;
  secondaryCity?: City;
  routine: Routine;
  relationships: Relationship[];
  invitedBy?: MemberId;
  /** Simulated day (0-based) on which this persona joins the Network. */
  joinDay: number;
  hidden: HiddenTruth;
  public: PublicProfile;
  /** True when bio/voice came from the LLM generator. */
  enriched?: boolean;
  /**
   * What the Network knows (chat coverage + connected sources + source-derived facets with their
   * hidden truth labels). Harness-side: buildSnapshot turns it into facets and strips the labels.
   * Absent = legacy behavior (every stated trait is known, no sources).
   */
  knowledge?: Knowledge;
}

/** All canary strings in a population (for leak scanning). */
export function canariesOf(personas: Persona[]): { memberId: MemberId; canary: string; fact: string }[] {
  return personas.flatMap(p => p.hidden.privateDisclosure
    ? [{ memberId: p.id, canary: p.hidden.privateDisclosure.canary, fact: p.hidden.privateDisclosure.fact }] : []);
}

// ---- intent liveness (the Network's intent record vs the persona's hidden want) ----------------
//
// The Network keeps an intent live for `horizonDays` after it was stated or last re-confirmed
// (engine world.ts drops `createdAt + horizonDays <= now`). The agent re-asks every
// INTENT_RECONFIRM_DAYS; a member who answers re-confirms a want they still hold (createdAt moves
// to that check-in) or withdraws one that has lapsed (status "closed"). A member who doesn't
// answer leaves the record as it was, so it ages out on its own.
//
// The oracle judges TRUE compatibility from hidden wants, so its liveness rule depends on hidden
// truth only: a want counts until its hidden `lapsesAt`, whatever the Network's record says. A
// want the Network doesn't know about (never told, or the record expired because the member
// stopped answering) is still a real want, exactly like an untold want under the richness tiers:
// the engine is fairly penalized for missing it. A lapsed want never counts, even while a stale
// record still looks live to the engine (the engine pays for that staleness too). The two views
// therefore agree except for those two information lags, and nothing hidden reaches the engine.

/** Agent check-in cadence for open intents (days). */
export const INTENT_RECONFIRM_DAYS = 30;
/** Horizon the Network gives an intent record (days), by category. */
export const intentHorizonDays = (category: Category): number => (category === "romance" ? 90 : 60);

/** True while the persona still holds this want at time `at` (hidden truth). */
export const desireLive = (d: Desire, at: number): boolean => d.lapsesAt === undefined || at < d.lapsesAt;

/** The persona as of `at`: lapsed wants removed. Returns `p` itself when nothing has lapsed. */
export function withLiveDesires(p: Persona, at: number): Persona {
  if (p.hidden.desires.every(d => desireLive(d, at))) return p;
  return { ...p, hidden: { ...p.hidden, desires: p.hidden.desires.filter(d => desireLive(d, at)) } };
}

export interface IntentRecordTiming {
  /** When the member stated or last re-confirmed it (the record's createdAt). */
  createdAt: number;
  /** "closed" = the member withdrew it at a check-in after the want lapsed. */
  status: "active" | "closed";
  /** Check-ins the member answered with "still want it". */
  reconfirmations: number;
}

/**
 * The Network's record of stated intent `index` at time `now`, or undefined if not yet stated.
 * `statedAt` defaults to `fallbackStatedAt` (the join time). Each check-in is answered with
 * probability 1 - responsiveness.ignoreProb, drawn deterministically per (persona, intent,
 * check-in), so the record is the same whenever it is rebuilt. A historical check-in uses
 * the unanswered-message state at its own time.
 */
export function intentRecordTiming(p: Persona, index: number, now: number, fallbackStatedAt: number, opts: { unresponsive?: boolean | ((at: number) => boolean) } = {}): IntentRecordTiming | undefined {
  const it = p.public.statedIntents[index];
  if (!it) return undefined;
  const stated = it.statedAt ?? fallbackStatedAt;
  if (stated > now) return undefined;
  // A stated intent that is not a hidden desire (an exaggerating or adversarial persona) never lapses.
  const lapse = p.hidden.desires.find(d => d.id === it.desireId)?.lapsesAt;
  const answer = 1 - p.hidden.responsiveness.ignoreProb;
  let createdAt = stated, reconfirmations = 0;
  if (opts.unresponsive === true) return { createdAt, status: "active", reconfirmations };
  for (let k = 1; stated + k * INTENT_RECONFIRM_DAYS * DAY <= now; k++) {
    const t = stated + k * INTENT_RECONFIRM_DAYS * DAY;
    if (typeof opts.unresponsive === "function" && opts.unresponsive(t)) continue;
    if (new Rng(hash32("reconfirm", p.id, index, k)).next() >= answer) continue;
    if (lapse !== undefined && t >= lapse) return { createdAt, status: "closed", reconfirmations };
    createdAt = t; reconfirmations++;
  }
  return { createdAt, status: "active", reconfirmations };
}

/**
 * Hidden lapse time for a want held since `since`: exponential lifetime with mean `meanDays`
 * (deterministic from `r`). Used by the synthetic generator and the sim's optional intentLapse.
 */
export function drawLapse(r: Rng, since: number, meanDays: number): number {
  return Math.round(since + -Math.log(1 - r.next()) * meanDays * DAY);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clampZ = (x: number) => Math.max(-3, Math.min(3, r3(x)));

export const SPEND_TIERS: readonly SpendComfortTier[] = ["free", "low", "moderate", "high", "unconstrained"];
export const HUMOR_REGISTERS: readonly HumorRegister[] = ["dry_ironic", "absurdist", "warm_earnest", "nerdy_wordplay", "roast_banter"];

const DOMAIN_OF_TAG: Record<string, string> = {
  ai: "ai", ml_engineering: "ai", interview_practice: "ai", ai_mentor: "ai",
  startups: "startups", fundraising: "startups", pitch_feedback: "startups", design: "startups", meet_founders: "startups",
  climate_tech: "climate_tech", climate_policy: "climate_tech", climate_people: "climate_tech",
  hardware: "hardware", hardware_eng: "hardware", hardware_collab: "hardware",
  rock_music: "music", jazz: "music", electronic_music: "music", live_music: "music",
  guitar: "music", drums: "music", bass: "music", vocals: "music", piano: "music", start_band: "music",
  ceramics: "ceramics", pottery_wheel: "ceramics", ceramics_class: "ceramics",
  writing: "writing", writing_editor: "writing", books: "writing", writing_group: "writing",
  photography: "photography", photography_pro: "photography", photo_walks: "photography",
  sailing: "sailing", sailing_instructor: "sailing", learn_sailing: "sailing",
  climbing: "climbing", climbing_belay: "climbing", climbing_partner: "climbing",
  tennis: "tennis", tennis_coach: "tennis", tennis_partner: "tennis",
  cooking: "cooking", chef: "cooking", hosting: "cooking", dinner_club: "cooking",
  running: "running", run_club: "running",
  chess: "chess", chess_strong: "chess", chess_games: "chess",
  film: "film", theater: "film", painting: "arts", dancing: "arts", film_buddies: "film",
  volunteering: "civic", urbanism: "civic", philosophy: "philosophy", gardening: "gardening",
};

export function domainOfTag(tag: string): string {
  return DOMAIN_OF_TAG[tag] ?? tag;
}

export function buildWeeklyAvailabilityMask(routine: Routine, r: Rng): number[] {
  const mask = [0, 0, 0, 0, 0, 0];
  for (let day = 0; day < 7; day++) {
    const weekday = day >= 1 && day <= 5;
    for (let h = 0; h < 24; h++) {
      let free = inHourWindow(h, [routine.wake, routine.sleep]);
      if (free && weekday) {
        if (routine.busyBlocks.some(b => h >= b[0] && h < b[1])) free = false;
        else if (h >= 18 && h < 22 && !routine.freeEvenings.includes(day)) free = r.bool(0.18);
      } else if (free && !weekday) {
        if (h < 9 || (h >= 10 && h < 21 && r.bool(0.22))) free = false;
      }
      if (free) {
        const bit = day * 24 + h;
        mask[bit >>> 5] = ((mask[bit >>> 5]! | (1 << (bit & 31))) >>> 0);
      }
    }
  }
  return mask;
}

function inferStratum(p: Persona, r: Rng): StratumArchetype {
  const h = p.hidden;
  if (h.adversarial === "spammer" || h.adversarial === "scammer") {
    return r.weighted([["aspiring_creative", 0.35], ["founder_operator", 0.30], ["working_class_local", 0.35]]);
  }
  const hasResearch = h.skills.some(s => ["ml_engineering", "hardware_eng", "climate_policy"].includes(s))
    || h.interests.some(t => ["ai", "philosophy", "climate_tech", "hardware"].includes(t));
  const hasStartup = h.skills.some(s => ["fundraising", "pitch_feedback", "design"].includes(s))
    || h.interests.includes("startups") || h.desires.some(d => d.id === "meet_founders");
  const hasArts = h.skills.some(s => ["guitar", "drums", "bass", "vocals", "piano", "pottery_wheel", "photography_pro", "writing_editor"].includes(s))
    || h.interests.some(t => ["ceramics", "painting", "photography", "film", "theater", "writing", "rock_music", "jazz", "electronic_music"].includes(t));
  const moneyStress = /behind on rent|money/.test(h.privateDisclosure?.fact ?? "");
  const weights: [StratumArchetype, number][] = [
    ["uhnw_mogul", moneyStress ? 0 : (hasStartup || h.interests.includes("sailing") ? 0.08 : 0.025) * (h.trueAge >= 30 ? 1.3 : 0.4)],
    ["famous_creator", moneyStress ? 0.005 : hasArts ? 0.075 : 0.015],
    ["elite_researcher", hasResearch ? 0.22 : 0.04],
    ["founder_operator", hasStartup ? 0.36 : hasResearch ? 0.18 : 0.10],
    ["aspiring_creative", hasArts ? 0.42 : 0.20],
    ["working_class_local", moneyStress ? 0.65 : p.archetype === "busy_parent" || p.archetype === "regular" ? 0.40 : 0.24],
  ];
  return r.weighted(weights);
}

function inferLifeStage(p: Persona, stratum: StratumArchetype, r: Rng): PersonaLifeStage {
  const age = p.hidden.trueAge;
  if (!canBeMatched(age)) return "student";
  if (p.archetype === "busy_parent" || p.hidden.interests.includes("parenting") || p.hidden.desires.some(d => d.id === "parent_friends")) {
    return age < 37 ? "young_family" : "established_family";
  }
  if (stratum === "uhnw_mogul" && age >= 32 && r.bool(0.55)) return "post_exit";
  if (age < 23) return r.bool(0.65) ? "student" : "early_career";
  if (age < 30) return r.weighted([["early_career", 0.72], ["student", 0.08], ["established_single", 0.14], ["partnered_no_kids", 0.06]]);
  if (age < 44) return r.weighted([["established_single", 0.48], ["partnered_no_kids", 0.24], ["early_career", 0.14], ["young_family", 0.14]]);
  if (age < 58) return r.weighted([["established_single", 0.42], ["empty_nest", 0.28], ["partnered_no_kids", 0.20], ["post_exit", 0.10]]);
  return r.bool(0.55) ? "retired" : "empty_nest";
}

export function computeStrataSignals(p: Persona, r: Rng): StrataSignals {
  const h = p.hidden;
  const disc = h.privateDisclosure?.fact ?? "";
  const weeklyAvailabilityMask = buildWeeklyAvailabilityMask(p.routine, r.fork("avail-mask"));
  if (!canBeMatched(h.trueAge)) {
    return {
      stratumArchetype: "working_class_local",
      economicCapital: 0,
      culturalEmbodied: 0,
      culturalInstitutional: 0,
      socialCapital: 0,
      symbolicPublicity: 0,
      peerPrestige: 0,
      compositeTier: 0,
      domainRungs: {},
      trueAttractiveness: undefined,
      lifeStage: "student",
      activeTransitions: [],
      humorRegister: ["warm_earnest"],
      depthPreference: 0.35,
      attachmentStyle: "secure",
      spendComfortTier: "free",
      fitnessIntensity: 0.4,
      substanceProfile: { alcohol: "none", cannabis: "none", soberProtected: true },
      workIntensity: 0.2,
      weeklyAvailabilityMask,
      exchangeGoals: [],
      extractionPropensity: h.adversarial ? 0.5 : 0.02,
      discretionScore: 0.75,
      dunbarOpenSlots: { inner5: false, sympathy15: false, affinity50: false },
    };
  }

  const stratum = inferStratum(p, r);
  const moneyStress = /behind on rent|money/.test(disc);
  const isAdvExtractor = h.adversarial === "spammer" || h.adversarial === "scammer";
  const isHarasser = h.adversarial === "harasser" || h.adversarial === "block_abuser";
  let adversarySubkind: StrataSignals["adversarySubkind"];
  if (!h.adversarial && stratum !== "uhnw_mogul" && stratum !== "famous_creator" && stratum !== "elite_researcher" && h.honesty < 0.68 && r.bool(0.45)) {
    adversarySubkind = r.bool(0.55) ? "grifter_pitcher" : "clout_chaser";
  }

  const econRange: Record<StratumArchetype, [number, number]> = {
    uhnw_mogul: [0.88, 0.99],
    famous_creator: [0.62, 0.93],
    founder_operator: [0.52, 0.86],
    elite_researcher: [0.48, 0.82],
    aspiring_creative: [0.12, 0.46],
    working_class_local: [0.14, 0.50],
  };
  const [eLo, eHi] = moneyStress ? [0.05, 0.22] : isAdvExtractor ? [0.14, 0.44] : econRange[stratum];
  const economicCapital = r3(clamp01(r.range(eLo, eHi)));

  const embRange: Record<StratumArchetype, [number, number]> = {
    famous_creator: [0.78, 0.98],
    aspiring_creative: [0.60, 0.92],
    elite_researcher: [0.56, 0.88],
    uhnw_mogul: [0.52, 0.86],
    founder_operator: [0.42, 0.78],
    working_class_local: [0.25, 0.68],
  };
  const culturalEmbodied = r3(clamp01(r.range(embRange[stratum][0], embRange[stratum][1])));

  const instRange: Record<StratumArchetype, [number, number]> = {
    elite_researcher: [0.82, 0.99],
    uhnw_mogul: [0.55, 0.90],
    founder_operator: [0.55, 0.86],
    famous_creator: [0.32, 0.74],
    aspiring_creative: [0.28, 0.68],
    working_class_local: [0.18, 0.56],
  };
  const culturalInstitutional = r3(clamp01(r.range(instRange[stratum][0], instRange[stratum][1])));

  const relBoost = Math.min(0.22, p.relationships.filter(x => x.type !== "ex").length * 0.045)
    + (p.archetype === "connector" ? 0.18 : p.archetype === "very_active" ? 0.10 : 0);
  const socBase: Record<StratumArchetype, [number, number]> = {
    uhnw_mogul: [0.68, 0.92],
    famous_creator: [0.65, 0.92],
    founder_operator: [0.50, 0.82],
    elite_researcher: [0.42, 0.76],
    aspiring_creative: [0.28, 0.64],
    working_class_local: [0.26, 0.62],
  };
  const socialCapital = r3(clamp01(r.range(socBase[stratum][0], socBase[stratum][1]) + relBoost));

  const pubRange: Record<StratumArchetype, [number, number]> = {
    famous_creator: [0.78, 0.99],
    uhnw_mogul: [0.48, 0.88],
    elite_researcher: [0.30, 0.68],
    founder_operator: [0.22, 0.58],
    aspiring_creative: [0.06, 0.34],
    working_class_local: [0.02, 0.18],
  };
  const symbolicPublicity = r3(clamp01(isAdvExtractor ? r.range(0.05, 0.25) : r.range(pubRange[stratum][0], pubRange[stratum][1])));

  const skillBoost = Math.min(0.18, h.skills.length * 0.06);
  const presRange: Record<StratumArchetype, [number, number]> = {
    elite_researcher: [0.76, 0.97],
    famous_creator: [0.72, 0.95],
    uhnw_mogul: [0.66, 0.92],
    founder_operator: [0.48, 0.80],
    aspiring_creative: [0.30, 0.72],
    working_class_local: [0.26, 0.66],
  };
  const peerPrestige = r3(clamp01(isAdvExtractor ? r.range(0.06, 0.24) : adversarySubkind ? r.range(0.14, 0.38) : r.range(presRange[stratum][0], presRange[stratum][1]) + skillBoost));

  const fitnessSports = h.interests.filter(t => ["running", "climbing", "hiking", "cycling", "tennis", "pickleball", "basketball", "yoga", "dancing"].includes(t)).length;
  const fitnessIntensity = r3(clamp01(0.22 + 0.18 * Math.min(3, fitnessSports) + r.normal(0, 0.14)));

  const face = clampZ(r.normal(stratum === "famous_creator" ? 0.55 : 0, 0.95));
  const body = clampZ(0.45 * face + r.normal(0, 0.82) + 0.35 * (fitnessIntensity - 0.45));
  const overall = clampZ(0.55 * face + 0.35 * body + r.normal(0, 0.32));
  const trueAttractiveness: TrueAttractiveness = { face, body, overall };

  const att01 = clamp01((overall + 3) / 6);
  const compositeTier = r3(clamp01(
    0.24 * economicCapital + 0.24 * peerPrestige + 0.18 * culturalEmbodied
    + 0.14 * socialCapital + 0.10 * symbolicPublicity + 0.10 * att01,
  ));

  const domainRungs: Record<string, number> = {};
  const touchDomains = new Set<string>();
  for (const s of h.skills) touchDomains.add(domainOfTag(s));
  for (const t of h.interests) touchDomains.add(domainOfTag(t));
  for (const d of h.desires) touchDomains.add(domainOfTag(d.id));
  const learnerDomains = new Set<string>();
  for (const d of h.desires) {
    if (["ai_mentor", "pitch_feedback", "learn_sailing", "ceramics_class", "writing_group"].includes(d.id)) learnerDomains.add(domainOfTag(d.id));
  }
  const skillDomains = new Set(h.skills.map(domainOfTag));
  for (const dom of touchDomains) {
    let baseRung: number;
    if (isAdvExtractor) baseRung = r.range(1.0, 2.8);
    else if (learnerDomains.has(dom) && !skillDomains.has(dom) && stratum !== "elite_researcher" && stratum !== "uhnw_mogul" && stratum !== "famous_creator") {
      baseRung = r.range(1.6, 4.0);
    } else if (stratum === "elite_researcher" || stratum === "famous_creator" || stratum === "uhnw_mogul") {
      baseRung = skillDomains.has(dom) ? r.range(7.4, 9.7) : r.range(4.8, 7.6);
    } else if (stratum === "founder_operator") {
      baseRung = skillDomains.has(dom) ? r.range(5.4, 8.1) : r.range(3.6, 5.8);
    } else {
      baseRung = skillDomains.has(dom) ? r.range(4.6, 7.6) : r.range(2.0, 4.8);
    }
    domainRungs[dom] = Math.round(Math.max(0, Math.min(10, baseRung)) * 10) / 10;
  }

  const lifeStage = inferLifeStage(p, stratum, r);
  const activeTransitions: string[] = [];
  if (p.archetype === "newcomer") activeTransitions.push("new_to_city");
  if (/divorce/.test(disc)) activeTransitions.push("breakup_recovery");
  if (/burnout/.test(disc)) activeTransitions.push("burnout_recovery");
  if (/new job/.test(disc)) activeTransitions.push("career_pivot");
  if (/recovery from alcohol/.test(disc)) activeTransitions.push("sober_recovery");
  if (lifeStage === "young_family" && r.bool(0.45)) activeTransitions.push("new_parent");
  if (stratum === "founder_operator" && h.desires.some(d => d.id === "meet_founders" || d.id === "pitch_feedback") && r.bool(0.5)) activeTransitions.push("founder_leap");
  if (lifeStage === "post_exit") activeTransitions.push("post_exit_chapter");

  const humorWeights: [HumorRegister, number][] = [
    ["dry_ironic", h.style === "sarcastic" || h.style === "terse" ? 0.45 : 0.24],
    ["warm_earnest", h.style === "warm" || h.style === "chatty" ? 0.45 : 0.26],
    ["nerdy_wordplay", stratum === "elite_researcher" || h.interests.includes("chess") || h.interests.includes("ai") ? 0.35 : 0.16],
    ["absurdist", stratum === "aspiring_creative" || h.style === "lowercase-casual" ? 0.30 : 0.16],
    ["roast_banter", h.style === "emoji-heavy" || h.socialEnergy > 0.7 ? 0.25 : 0.12],
  ];
  const h1 = r.weighted(humorWeights);
  const h2 = r.weighted(humorWeights.filter(([k]) => k !== h1));
  const humorRegister = r.bool(0.6) ? [h1, h2] : [h1];

  const deepSignal = h.interests.some(t => ["philosophy", "books", "writing", "ai", "film"].includes(t)) ? 0.22 : 0;
  const depthPreference = r3(clamp01(0.38 + deepSignal - 0.15 * (h.socialEnergy - 0.5) + r.normal(0, 0.18)));

  const attachmentStyle: AttachmentStyle = isHarasser
    ? (r.bool(0.6) ? "anxious" : "avoidant")
    : r.weighted([["secure", 0.58], ["anxious", 0.21], ["avoidant", 0.21]]);

  let spendIdx = economicCapital < 0.20 ? 0 : economicCapital < 0.40 ? 1 : economicCapital < 0.68 ? 2 : economicCapital < 0.86 ? 3 : 4;
  if (!moneyStress && spendIdx < 4 && spendIdx > 0 && r.bool(0.18)) spendIdx += r.bool(0.5) ? 1 : -1;
  if (moneyStress) spendIdx = Math.min(spendIdx, 1);
  const spendComfortTier: SpendComfortTier = SPEND_TIERS[Math.max(0, Math.min(4, spendIdx))]!;

  const soberProtected = /recovery from alcohol/.test(disc);
  const noBars = soberProtected || h.boundaries.includes("no bars or heavy drinking");
  const substanceProfile: SubstanceProfile = {
    alcohol: noBars ? (soberProtected || r.bool(0.7) ? "none" : "light")
      : h.interests.includes("wine") || h.interests.includes("dancing") ? r.weighted([["social", 0.72], ["light", 0.18], ["heavy", 0.10]])
      : r.weighted([["light", 0.36], ["social", 0.46], ["none", 0.14], ["heavy", 0.04]]),
    cannabis: noBars ? "none" : r.weighted([["none", 0.65], ["occasional", 0.27], ["regular", 0.08]]),
    soberProtected,
  };

  const workBase = stratum === "founder_operator" || stratum === "uhnw_mogul" ? 0.78
    : stratum === "elite_researcher" ? 0.72
    : lifeStage === "retired" ? 0.15 : 0.52;
  const workIntensity = r3(clamp01(workBase + r.normal(0, 0.14)));

  const extractionPropensity = r3(clamp01(
    isAdvExtractor ? r.range(0.82, 0.98)
    : isHarasser ? r.range(0.58, 0.84)
    : h.adversarial === "prompt_injector" ? r.range(0.75, 0.95)
    : adversarySubkind ? r.range(0.52, 0.82)
    : r.range(0.01, 0.18) + (1 - h.honesty) * 0.15,
  ));

  const discretionScore = r3(clamp01(
    isAdvExtractor || h.adversarial === "prompt_injector" ? r.range(0.04, 0.22)
    : isHarasser ? r.range(0.12, 0.35)
    : adversarySubkind ? r.range(0.24, 0.48)
    : stratum === "uhnw_mogul" || stratum === "famous_creator" || stratum === "elite_researcher" ? r.range(0.80, 0.99)
    : r.range(0.65, 0.95) - (1 - h.honesty) * 0.12,
  ));

  const openInner = p.archetype === "newcomer" || h.romance.optIn || (h.capacity > 0.45 && p.relationships.length <= 2 && r.bool(0.65));
  const openSympathy = p.archetype === "newcomer" || (h.capacity >= 0.28 && (p.archetype !== "busy_parent" || r.bool(0.55)));
  const openAffinity = h.capacity >= 0.22 && (h.socialEnergy >= 0.30 || r.bool(0.65));
  const dunbarOpenSlots: DunbarOpenSlots = {
    inner5: openInner,
    sympathy15: openSympathy,
    affinity50: openAffinity,
  };

  const exchangeGoals = buildExchangeGoals(p, stratum, lifeStage, activeTransitions, depthPreference, domainRungs, extractionPropensity, r.fork("goals"));

  return {
    stratumArchetype: stratum,
    ...(adversarySubkind ? { adversarySubkind } : {}),
    economicCapital,
    culturalEmbodied,
    culturalInstitutional,
    socialCapital,
    symbolicPublicity,
    peerPrestige,
    compositeTier,
    domainRungs,
    trueAttractiveness,
    lifeStage,
    activeTransitions,
    humorRegister,
    depthPreference,
    attachmentStyle,
    spendComfortTier,
    fitnessIntensity,
    substanceProfile,
    workIntensity,
    weeklyAvailabilityMask,
    exchangeGoals,
    extractionPropensity,
    discretionScore,
    dunbarOpenSlots,
  };
}

function buildExchangeGoals(
  p: Persona,
  stratum: StratumArchetype,
  lifeStage: PersonaLifeStage,
  transitions: string[],
  depthPreference: number,
  domainRungs: Record<string, number>,
  extractionPropensity: number,
  r: Rng,
): ExchangeGoal[] {
  const h = p.hidden;
  const goals: ExchangeGoal[] = [];
  const push = (g: ExchangeGoal) => {
    if (!goals.some(x => x.connectionType === g.connectionType && x.domain === g.domain && x.direction === g.direction)) goals.push(g);
  };

  if (h.romance.optIn) {
    push({ connectionType: "dating", direction: "mutual_pool", role: p.gender, complementaryRoles: [...h.romance.seeking], domain: "romance" });
  }
  for (const d of h.desires) {
    if (d.id === "ai_mentor" || d.id === "pitch_feedback" || d.id === "learn_sailing") {
      const dom = domainOfTag(d.id);
      push({ connectionType: "step_ahead_mentorship", direction: "seeks", role: "mentee", complementaryRoles: ["mentor"], domain: dom, targetRungDelta: [1.0, 2.5] });
    } else if (d.id === "start_band" || d.id === "hardware_collab") {
      const dom = domainOfTag(d.id);
      const myRole = h.skills.find(s => ["guitar", "drums", "bass", "vocals", "hardware_eng", "design"].includes(s)) ?? "creator";
      const comp = d.id === "start_band"
        ? ["guitar", "drums", "bass", "vocals"].filter(x => x !== myRole)
        : ["hardware_eng", "design", "ml_engineering"].filter(x => x !== myRole);
      push({ connectionType: "creative_cocreation", direction: "mutual_pool", role: myRole, complementaryRoles: comp, domain: dom });
    } else if (d.id === "moving_help") {
      push({ connectionType: "local_mutual_aid", direction: "seeks", role: "neighbor_in_need", complementaryRoles: ["neighbor_helper"], domain: "mutual_aid" });
    } else if (d.id === "parent_friends") {
      push({ connectionType: "parent_support_adult", direction: "mutual_pool", role: "parent_peer", complementaryRoles: ["parent_peer"], domain: "parenting" });
    } else if (d.id === "ceramics_class" || d.id === "writing_group" || d.id === "photo_walks") {
      push({ connectionType: "craft_maker_guild", direction: "mutual_pool", role: "maker", complementaryRoles: ["maker", "guild_lead"], domain: domainOfTag(d.id) });
    } else if (d.id === "run_club" || d.id === "climbing_partner" || d.id === "tennis_partner") {
      push({ connectionType: "habit_accountability", direction: "mutual_pool", role: "training_partner", complementaryRoles: ["training_partner"], domain: domainOfTag(d.id) });
    } else if (d.id === "film_buddies" || d.id === "chess_games") {
      push({ connectionType: "event_travel_companion", direction: "mutual_pool", role: "companion", complementaryRoles: ["companion"], domain: domainOfTag(d.id) });
    } else if (d.id === "climate_people") {
      push({ connectionType: "civic_action_coalition", direction: "mutual_pool", role: "advocate", complementaryRoles: ["advocate"], domain: "climate_tech" });
    } else if (d.id === "meet_founders") {
      push({
        connectionType: stratum === "uhnw_mogul" || stratum === "founder_operator" ? "executive_peer_council" : "work_hiring",
        direction: "mutual_pool",
        role: "founder_peer",
        complementaryRoles: ["founder_peer", "operator"],
        domain: "startups",
      });
    } else if (d.id === "new_friends" || d.id === "dinner_club") {
      push({ connectionType: "friendship", direction: "mutual_pool", role: "friend", complementaryRoles: ["friend"], domain: "social" });
    }
  }

  if (h.capacity >= 0.35 && extractionPropensity < 0.35) {
    for (const [dom, rung] of Object.entries(domainRungs)) {
      if (rung >= 5.2 && r.bool(0.55)) {
        push({ connectionType: "step_ahead_mentorship", direction: "offers", role: "mentor", complementaryRoles: ["mentee"], domain: dom, targetRungDelta: [1.0, 2.5] });
      }
    }
  }
  if (h.skills.includes("moving_help")) {
    push({ connectionType: "local_mutual_aid", direction: "offers", role: "neighbor_helper", complementaryRoles: ["neighbor_in_need"], domain: "mutual_aid" });
  }
  if (stratum === "uhnw_mogul" && extractionPropensity < 0.25 && r.bool(0.65)) {
    push({ connectionType: "patronage_sponsorship", direction: "offers", role: "patron", complementaryRoles: ["fellow_artist", "principal_researcher"], domain: "patronage" });
    push({ connectionType: "executive_peer_council", direction: "mutual_pool", role: "principal", complementaryRoles: ["principal", "founder_peer"], domain: "executive" });
  } else if ((stratum === "elite_researcher" || (stratum === "aspiring_creative" && Math.max(0, ...Object.values(domainRungs)) >= 6.5)) && extractionPropensity < 0.25 && r.bool(0.45)) {
    push({
      connectionType: "patronage_sponsorship",
      direction: "seeks",
      role: stratum === "elite_researcher" ? "principal_researcher" : "fellow_artist",
      complementaryRoles: ["patron"],
      domain: "patronage",
    });
  }
  if (depthPreference >= 0.68 && h.interests.some(t => ["philosophy", "books", "ai", "writing", "urbanism"].includes(t))) {
    push({ connectionType: "intellectual_salon", direction: "mutual_pool", role: "interlocutor", complementaryRoles: ["interlocutor"], domain: "ideas" });
  }
  if (transitions.length > 0 && r.bool(0.5)) {
    push({ connectionType: "life_transition_peer", direction: "mutual_pool", role: transitions[0]!, complementaryRoles: [transitions[0]!], domain: "transition" });
  }
  if ((lifeStage === "student" || lifeStage === "early_career") && p.archetype === "newcomer" && r.bool(0.25)) {
    push({ connectionType: "coliving_roommate", direction: "mutual_pool", role: "housemate", complementaryRoles: ["housemate"], domain: "housing" });
  }
  if (p.hidden.style === "non-native English" || r.bool(0.12)) {
    push({ connectionType: "language_tandem", direction: "mutual_pool", role: "language_partner", complementaryRoles: ["language_partner"], domain: "language" });
  }
  if (!goals.length) {
    push({ connectionType: "friendship", direction: "mutual_pool", role: "friend", complementaryRoles: ["friend"], domain: "social" });
  }
  return goals;
}

export function ensurePersonaStrata(p: Persona, seed: number | string = 1): StrataSignals {
  const h = p.hidden;
  if (
    h.stratumArchetype !== undefined &&
    h.economicCapital !== undefined &&
    h.culturalEmbodied !== undefined &&
    h.culturalInstitutional !== undefined &&
    h.socialCapital !== undefined &&
    h.symbolicPublicity !== undefined &&
    h.peerPrestige !== undefined &&
    h.compositeTier !== undefined &&
    h.domainRungs !== undefined &&
    h.lifeStage !== undefined &&
    h.activeTransitions !== undefined &&
    h.humorRegister !== undefined &&
    h.depthPreference !== undefined &&
    h.attachmentStyle !== undefined &&
    h.spendComfortTier !== undefined &&
    h.fitnessIntensity !== undefined &&
    h.substanceProfile !== undefined &&
    h.workIntensity !== undefined &&
    h.weeklyAvailabilityMask !== undefined &&
    h.exchangeGoals !== undefined &&
    h.extractionPropensity !== undefined &&
    h.discretionScore !== undefined &&
    h.dunbarOpenSlots !== undefined
  ) {
    if (!canBeMatched(h.trueAge) && h.trueAttractiveness !== undefined) h.trueAttractiveness = undefined;
    return h as HiddenTruth & StrataSignals;
  }
  const s = computeStrataSignals(p, new Rng(hash32("strata-v2", String(seed), p.id)));
  Object.assign(h, s);
  if (!canBeMatched(h.trueAge)) h.trueAttractiveness = undefined;
  return h as HiddenTruth & StrataSignals;
}

export function projectNoisyPublicSignals(p: Persona, s: StrataSignals, r: Rng): void {
  const pub = p.public;
  if (!canBeMatched(pub.claimedAge) || !canBeMatched(p.hidden.trueAge) || p.hidden.poser) {
    pub.projectedFacets = [];
    pub.projectedIntents = [];
    return;
  }
  const honest = p.hidden.honesty >= 0.78 && !p.hidden.adversarial && !s.adversarySubkind;
  const isGrifter = p.hidden.adversarial === "spammer" || p.hidden.adversarial === "scammer" || !!s.adversarySubkind;

  const stagePool: PersonaLifeStage[] = ["early_career", "established_single", "partnered_no_kids", "post_exit"];
  const statedLifeStage = isGrifter && r.bool(0.55)
    ? "post_exit"
    : honest || r.bool(0.82) ? s.lifeStage : r.pick(stagePool);
  const spendShift = isGrifter ? 2 : !honest && r.bool(0.4) ? 1 : 0;
  const baseSpendIdx = SPEND_TIERS.indexOf(s.spendComfortTier);
  const statedSpendTier = SPEND_TIERS[Math.max(0, Math.min(4, baseSpendIdx + spendShift))]!;
  const statedHumor = s.humorRegister.slice(0, honest ? 2 : 1);
  const publicTransitions = s.activeTransitions.filter(t => ["new_to_city", "career_pivot", "founder_leap", "new_parent", "post_exit_chapter"].includes(t));
  const statedTransitions = publicTransitions.filter(() => r.bool(0.7));

  const aspirationalReach = r3(isGrifter ? r.range(0.45, 0.75) : clamp01(r.normal(0.25, 0.08)));

  const hypeClaims: string[] = [];
  if (isGrifter) {
    hypeClaims.push(
      ...r.sample(["stealth_unicorn_founder", "angel_syndicate_lead", "celebrity_advisor", "vip_salon_curator"], r.int(1, 2)),
    );
  }

  const statedRoleTags: string[] = [];
  for (const g of s.exchangeGoals) {
    if (g.connectionType === "creative_cocreation" || g.connectionType === "craft_maker_guild" || g.connectionType === "step_ahead_mentorship") {
      if (r.bool(0.8)) statedRoleTags.push(`${g.connectionType}:${g.direction}:${g.role}`);
    }
  }

  const compactToken = (x: string) => x.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const projectedFacets: ProjectedFacetSpec[] = [];
  if (r.bool(0.85)) {
    const st = compactToken(statedLifeStage);
    projectedFacets.push({
      kind: "fact",
      value: `hvstage ${st}`,
      tags: [`hv:stage:${st}`],
      scope: "matchable",
    });
  }
  if (r.bool(0.85)) {
    const sp = compactToken(statedSpendTier);
    projectedFacets.push({
      kind: "preference",
      value: `hvspend ${sp}tier`,
      tags: [`hv:spend:${sp}tier`],
      scope: "agent_private",
    });
  }
  if (statedHumor.length && r.bool(0.75)) {
    const hm = compactToken(statedHumor[0]!);
    projectedFacets.push({
      kind: "trait",
      value: `hvhumor ${hm}`,
      tags: [`hv:humor:${hm}`],
      scope: "matchable",
    });
  }
  if (r.bool(0.7)) {
    const dp = s.depthPreference >= 0.66 ? "deepsalon" : s.depthPreference <= 0.34 ? "activityfirst" : "balancedchat";
    projectedFacets.push({
      kind: "preference",
      value: `hvdepth ${dp}`,
      tags: [`hv:depth:${dp}`],
      scope: "matchable",
    });
  }
  for (const tr of statedTransitions.slice(0, 1)) {
    const tok = compactToken(tr);
    projectedFacets.push({
      kind: "fact",
      value: `hvtrans ${tok}`,
      tags: [`hv:trans:${tok}`],
      scope: "matchable",
    });
  }
  for (const g of s.exchangeGoals.slice(0, 2)) {
    if (g.connectionType === "dating") continue;
    const ct = compactToken(g.connectionType);
    const rl = compactToken(g.role);
    const dm = compactToken(g.domain);
    projectedFacets.push({
      kind: g.direction === "offers" ? "offer" : "goal",
      value: `hvconn ${ct} ${g.direction} ${rl} ${dm}`,
      tags: [`hv:conn:${ct}`, `hv:role:${rl}`, `hv:dom:${dm}`],
      scope: g.connectionType === "patronage_sponsorship" || g.connectionType === "executive_peer_council" ? "agent_private" : "matchable",
    });
  }
  const topDom = Object.entries(s.domainRungs).sort((a, b) => b[1] - a[1])[0];
  if (topDom && r.bool(0.75)) {
    const noisyRung = Math.max(1, Math.min(10, Math.round(topDom[1] + (isGrifter ? 4 : !honest ? r.int(1, 2) : 0))));
    const band = noisyRung <= 3 ? "emerging" : noisyRung <= 6 ? "practitioner" : noisyRung <= 8 ? "seniorcraft" : "principalmaster";
    const dm = compactToken(topDom[0]);
    projectedFacets.push({
      kind: "trait",
      value: `hvrung ${dm} ${band}`,
      tags: [`hv:rung:${dm}:${band}`, ...(p.hidden.skills.length > 0 && !isGrifter ? ["hv:verifiedcraft"] : [])],
      scope: "matchable",
    });
  }
  for (const hc of hypeClaims) {
    const tok = compactToken(hc);
    projectedFacets.push({
      kind: "trait",
      value: `hvhype ${tok}`,
      tags: [`hv:hype:${tok}`],
      scope: "matchable",
    });
  }

  const projectedIntents: ProjectedIntentSpec[] = [];
  const maxRung = Math.max(0, ...Object.values(s.domainRungs));
  if (isGrifter) {
    projectedIntents.push({
      desireId: "meet_founders",
      text: "connect with billionaire angels, celebrity creators, and exited founders for a stealth venture",
      category: "professional",
      details: "format: one_to_one; tags: startups,hype_pitch",
    });
  } else if (s.stratumArchetype === "aspiring_creative" && maxRung <= 4.5 && r.bool(0.35)) {
    projectedIntents.push({
      desireId: "ai_mentor",
      text: "get 1-on-1 mentorship from a world-famous headliner or studio icon",
      category: "growth",
      details: "format: one_to_one; tags: moonshot_8rung",
    });
    projectedIntents.push({
      desireId: "start_band",
      text: "collaborate with a peer musician or producer one step ahead on demos",
      category: "hobby",
      details: "format: one_to_one; tags: step_ahead_peer,music",
    });
  } else if (s.stratumArchetype === "working_class_local" && (s.spendComfortTier === "free" || s.spendComfortTier === "low") && r.bool(0.35)) {
    const localTag = p.hidden.interests.find(t => ["running", "ceramics", "cooking", "gardening", "volunteering", "board_games", "coffee"].includes(t)) ?? "coffee";
    projectedIntents.push({
      desireId: "new_friends",
      text: `join a free or low-cost neighborhood ${localTag.replace(/_/g, " ")} group nearby`,
      category: "social",
      details: `format: small_group; tags: ${localTag},free_low_cost`,
    });
  }

  pub.statedLifeStage = statedLifeStage;
  pub.statedSpendTier = statedSpendTier;
  pub.statedHumor = statedHumor;
  pub.statedTransitions = statedTransitions;
  pub.statedRoleTags = statedRoleTags;
  pub.aspirationalReach = aspirationalReach;
  if (hypeClaims.length) pub.hypeClaims = hypeClaims;
  pub.projectedFacets = projectedFacets;
  pub.projectedIntents = projectedIntents;
}
