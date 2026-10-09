// Persona model: a synthetic member with HIDDEN ground truth (what the Network can never
// read directly) and a PUBLIC side (what they will reveal in conversation). PRD 34.3.
import { DAY, type AppId, type Category, type City, type MemberId } from "@thenetwork/core";
import { Rng, hash32 } from "@thenetwork/core";
import type { WritingStyle } from "./taxonomy.ts";
import type { Knowledge, RichnessTier } from "./sources.ts";

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
  /**
   * What the Network knows (chat coverage + connected sources + source-derived facets with their
   * hidden truth labels). Harness-side: buildSnapshot turns it into facets and strips the labels.
   * Absent = legacy behavior (every stated trait is known, no sources).
   */
  knowledge?: Knowledge;
  /** Apps the person is a member of (multi-app worlds). Absent = The Network only. */
  apps?: AppId[];
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
 * check-in), so the record is the same whenever it is rebuilt. `unresponsive`: the member is
 * ignoring the agent right now (no check-in counts).
 */
export function intentRecordTiming(p: Persona, index: number, now: number, fallbackStatedAt: number, opts: { unresponsive?: boolean } = {}): IntentRecordTiming | undefined {
  const it = p.public.statedIntents[index];
  if (!it) return undefined;
  const stated = it.statedAt ?? fallbackStatedAt;
  if (stated > now) return undefined;
  // A stated intent that is not a hidden desire (an exaggerating or adversarial persona) never lapses.
  const lapse = p.hidden.desires.find(d => d.id === it.desireId)?.lapsesAt;
  const answer = 1 - p.hidden.responsiveness.ignoreProb;
  let createdAt = stated, reconfirmations = 0;
  // A member who is currently ignoring the agent (2+ unanswered proactive messages, so "only when
  // I ask") is not answering check-ins either: a fresh re-confirmation would read as a new ask.
  if (opts.unresponsive) return { createdAt, status: "active", reconfirmations };
  for (let k = 1; stated + k * INTENT_RECONFIRM_DAYS * DAY <= now; k++) {
    const t = stated + k * INTENT_RECONFIRM_DAYS * DAY;
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
