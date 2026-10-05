// Persona model: a synthetic member with HIDDEN ground truth (what the Network can never
// read directly) and a PUBLIC side (what they will reveal in conversation). PRD 34.3.
import type { Category, City, MemberId } from "@thenetwork/core";
import type { WritingStyle } from "./taxonomy.ts";

export type Archetype =
  | "regular" | "busy_parent" | "newcomer" | "connector" | "introvert" | "very_active"
  | "never_replies" | "traveler";
export type AdversarialKind =
  | "spammer" | "scammer" | "harasser" | "minor" | "prompt_injector" | "block_abuser";

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

export interface Desire { id: string; text: string; category: Category; strength: number }

export interface Trip { city: City; fromDay: number; toDay: number }

export interface HiddenTruth {
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
}

export interface PublicProfile {
  /** What they say when asked what they're into (may exaggerate or omit). */
  statedInterests: string[];
  statedSkills: string[];
  statedIntents: { desireId: string; text: string; category: Category }[];
  claimedAge: number;
  bio: string;
  /** Short sample of how they write, used by LLM persona agents. */
  voiceSample?: string;
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
}

/** All canary strings in a population (for leak scanning). */
export function canariesOf(personas: Persona[]): { memberId: MemberId; canary: string; fact: string }[] {
  return personas.flatMap(p => p.hidden.privateDisclosure
    ? [{ memberId: p.id, canary: p.hidden.privateDisclosure.canary, fact: p.hidden.privateDisclosure.fact }] : []);
}
