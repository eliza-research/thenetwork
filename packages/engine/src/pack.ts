// The AppPack contract: one engine, four apps (docs/research/2026-10-08-engine-generalization.md
// section 2; docs/research/2026-10-08-platform-architecture.md 6.2).
//
//   ntwrk   The Network           networkPack (packs/network): today's behaviour, byte-identical
//   slop    slop.date (dating)    slopPack (next; first priority)
//   peon    peon.biz (hiring)     peonPack
//   friends friends.help (NYC)    friendsPack
//
// THE CORE OWNS INVARIANTS, PACKS OWN POLICY. A pack is data plus small, pure, synchronous hooks,
// called in a fixed order. Pack rules run IN ADDITION to the core rules and can only remove
// candidates. These core invariants hold for every pack and cannot be configured away:
//   1. Minors (13-17, and any missing / invalid age) may join any app but are NEVER matched or
//      connected to anyone, in any role (participant, alternate, `via`, host, plan member). A pack
//      can raise `eligibility.minMatchAge`, never lower it below 18. Enforced in five layers (world
//      index, member filter, pair filter, configuration filter, final guard) plus attention and plans.
//   2. Blocks win: a blocked or avoided pair is never a warm tie, never paired, never a `via`.
//   3. Hard filters run before scoring and before every judge pass; the judge can only remove.
//   4. LeakGuard on every member-facing string (explanations, probes, judge "why", questions).
//   5. Determinism: seeded RNG, stable ordering, no clock reads; same input + config + pack = same bytes.
//   6. Consent before reveal: nobody is named to anyone before the pack's consent flow allows it.
//
// BYTE IDENTITY (section 3.2). Pack identity travels BESIDE the config (`deps.pack`, the World
// constructor), never inside it: EngineConfig / AttentionConfig / PlansConfig keep their shapes and
// hashes. Run logs get no new fields for networkPack. Rule and generator order is the contract.
import type { Category, City, Facet, Intent, MemberId, OpportunityKind } from "@thenetwork/core";
import type { ActivityType } from "./packs/network/activities.ts";
import type { AttentionConfig, EngineConfig, PlansConfig } from "./config.ts";
import type { GenCtx } from "./genkit.ts";
import type { Candidate, CadencePrefs, Format, Role } from "./types.ts";
import type { Interval, MemberIndex, RomanceProfile, World } from "./world.ts";
import type { SelectionResult } from "./policy.ts";
import type { Rng } from "./rng.ts";
import type { Scored } from "./scoring.ts";

/** What a pack's global assignment sees besides the scored configurations (policy.ts selectProposals). */
export interface AssignContext {
  rng: Rng;
  /** Exposure debt carried between runs (input.exposureDebt, canonical ids). */
  debt: Readonly<Record<MemberId, number>>;
  /** Members held back this run (asked a question first). */
  exclude?: ReadonlySet<MemberId>;
  /** Proactive messages already planned this run outside selection (asks), per member. */
  extraProactive?: ReadonlyMap<MemberId, number>;
}

// ---------------------------------------------------------------------------------------- ids
/** App ids (platform.apps). */
export type AppId = "ntwrk" | "slop" | "peon" | "friends";
/** Open strings at the core; a pack narrows them (networkPack: Category, City, Role, OpportunityKind). */
export type LaneId = string;
export type RoleId = string;
export type KindId = string;
export type MarketId = string;
export type GeneratorId = string;

// ---------------------------------------------------------------------------------------- pack
export interface AppPack {
  id: AppId;
  /** Pack version, e.g. "network-pack-1.0.0". Not logged for networkPack (byte identity); other packs log it. */
  version: string;
  ontology: Ontology;
  eligibility: EligibilityPolicy;
  geo: GeoModel;
  /** Candidate generators. ORDER IS PART OF THE CONTRACT (funnel key order, dedupe ties, network_growth last-but-one). */
  generators: readonly GeneratorSpec[];
  retrieval: RetrievalPolicy;
  scoring: ScoringPolicy;
  selection: SelectionPolicy;
  consent: ConsentPolicy;
  attention: AttentionPack;
  /** Absent: the LLM judge passes never run for this pack. */
  judge?: JudgePack;
  explain: ExplainPack;
  plans?: PlansPack;
  capital?: CapitalPack;
  /** Where the pack's simulator lives (personas, snapshot, oracle, metrics, gates). Harness only. */
  sim?: SimPackRef;
  metrics: MetricsPack;
  /** Pack defaults. Shapes are the shared config types, so configHash is unchanged for networkPack. */
  defaults: { engine: EngineConfig; attention: AttentionConfig; plans?: PlansConfig };
}

// ---------------------------------------------------------------------------------------- ontology
export interface LaneDef {
  id: LaneId; label: string;
  /** default_on: opted in unless the member opts out; explicit: needs an opt-in; explicit_mutual: every participant opted in AND each admits the other. */
  optIn: "default_on" | "explicit" | "explicit_mutual";
  /** Core invariant: every lane is adults-only for matching. There is no `false`. */
  adultOnly: true;
  /** Shown alone, never inside a digest (attention). networkPack: romance. */
  shipsAlone?: boolean;
  /** Plans never use this lane. networkPack: romance (D15). */
  neverInPlans?: boolean;
}
export interface RoleDef { id: RoleId; contributor: boolean }
export interface KindDef { id: KindId; format: Format | "listing"; size: [number, number] }

/** The want vocabulary the complementarity term reads (networkPack: engine/taxonomy OBJECTIVES). */
export interface ObjectiveDef {
  id: string; pattern: RegExp; needs: string[]; pool?: string; interests: string[];
  /** Satisfied by mutual stated preferences (dating), not by tags. */
  romance?: boolean;
}

/** Per-member constraints parsed from boundary / preference facets (typed, instead of tag strings). */
export interface MemberConstraints {
  dealbreakers: string[];
  /** Mutual dating preferences (who I am / who I seek / age range). slopPack's mutual gender/orientation filter reads the same shape. */
  romance?: RomanceProfile;
}

export interface Ontology {
  lanes: readonly LaneDef[];
  roles: readonly RoleDef[];
  kinds: readonly KindDef[];
  /** Roles that give (provider, helper, host, connector): contribution budgets, receiving-state rule, load. */
  contributorRoles: ReadonlySet<Role>;
  /** Positive edge types that form the warm graph (blocking edges are core: blocked, avoid). */
  warmEdges: ReadonlySet<string>;
  /** Lane and role of the once-per-member availability probe in the run report (funnel.memberFunnel). */
  funnelProbe: { lane: Category; role: Role };
  objectives: readonly ObjectiveDef[];
  /** Objectives a stated want maps to (complementarity, retrieval need channel). */
  objectivesFor(text: string, details?: string, lane?: string): ObjectiveDef[];
  /** Both members' mutual-preference constraints admit each other (the `romance` objective). */
  mutualPreferenceMatch(w: World, a: MemberId, b: MemberId): boolean;
  /** Re-label a stated want (networkPack: personal growth -> hobby, which also opts the member in to hobby). Undefined = unchanged. */
  relabelIntent?(it: Intent, cfg: EngineConfig): Category | undefined;
  /** Typed constraints from a member's boundary / preference facets. */
  constraints(boundaryFacets: readonly Facet[]): MemberConstraints;
  /** The member can host (newcomer welcomes, groups). */
  isHost(matchFacets: readonly Facet[]): boolean;
}

// ---------------------------------------------------------------------------------------- eligibility
/** What a member-level rule sees (filters.ts MemberCheck). */
export interface MemberCheck {
  category: Category; role: Role; format: Format; timeSensitive: boolean;
  extraProactive?: number; extraContribution?: number; ownIntentCreatedAt?: number;
}
/** A rule returns a funnel reason (string) or null. Rules are pure and only ever REMOVE. */
export interface MemberRule { id: string; check(w: World, id: MemberId, mi: MemberIndex, c: MemberCheck): string | null }
export interface PairRule { id: string; check(w: World, a: MemberId, b: MemberId, lane: Category, ma: MemberIndex, mb: MemberIndex): string | null }
export interface CandidateRule { id: string; check(w: World, c: Candidate): string | null }

export interface EligibilityPolicy {
  /** >= 18, asserted when the pack is validated. The effective floor is max(this, cfg.ageMin). */
  minMatchAge: number;
  /**
   * Accounts below the match age that may still join (networkPack: 13-17 personal agent). Never
   * matchable. Without tiers, a pack must not store anyone under 18 (enforced at join, outside the engine).
   */
  accountTiers: readonly { minAge: number; maxAge: number; matchable: false; label: string }[];
  /**
   * Member rules, in order, AFTER the core prefix (unknown_member, underage, safety_hold,
   * state_paused). The first failing rule names the funnel reason.
   */
  memberRules: readonly MemberRule[];
  /** Pair rules, in order, AFTER the core prefix (duplicate_participant, underage, blocked). */
  pairRules: readonly PairRule[];
  /** Configuration rules BEFORE the core minors / via / member / pair checks (networkPack: group_size, high_risk). */
  candidatePreRules: readonly CandidateRule[];
  /** Configuration rules AFTER the member / pair checks, before geo (networkPack: home_entry_rule). */
  candidatePostRules: readonly CandidateRule[];
}

// ---------------------------------------------------------------------------------------- geo
export interface GeoOverlap { city: City; intervals: Interval[]; hours: number }
/**
 * Where members are and whether a configuration can meet. networkPack: city buckets (sf / nyc ids
 * kept: they are inside seeds, tick ids and proposal keys). slopPack: radius around a zip or point,
 * with `pairReason` as the mutual-radius hard filter and `displayDistance` for bucketed copy.
 */
export interface GeoModel {
  kind: "city" | "radius" | "multi_market";
  /** Markets this run covers (locking, per-market caps, time zones). networkPack: cfg.cities, same array. */
  markets(cfg: EngineConfig): readonly City[];
  tz(market: City, cfg: EngineConfig): string;
  /** Market -> availability intervals of a member in [start, end). */
  location(w: World, id: MemberId, start: number, end: number): Map<City, Interval[]>;
  /** Common availability of all members in one market (prefers `preferred`); null = cannot meet. The core geo filter. */
  overlap(w: World, ids: MemberId[], start: number, end: number, preferred?: City): GeoOverlap | null;
  /** Do all members share a neighbourhood / cell in `market` (activation cost). */
  sharesArea(w: World, ids: MemberId[], market: City | undefined): boolean;
  /**
   * Optional pair-level geo hard filter, checked after the pack's pair rules (radius model: mutual
   * radius, d <= min(rA, rB)). Must be symmetric. networkPack: absent (city overlap only).
   */
  pairReason?(w: World, a: MemberId, b: MemberId): string | null;
  /** Bucketed distance copy ("under 2 mi"); never an exact distance. */
  displayDistance?(km: number): string;
}

// ---------------------------------------------------------------------------------------- generators / retrieval
export interface GeneratorSpec { name: GeneratorId; run(ctx: GenCtx): Candidate[] }
export interface RetrievalPolicy {
  channels: readonly ("semantic" | "tag" | "graph" | "need" | "geo" | "exposure_floor")[];
  /** Directions retrieved (peon: candidate->job and job->candidate). networkPack: members for intents. */
  directions: readonly { from: string; to: string }[];
}

// ---------------------------------------------------------------------------------------- scoring
export interface ScoringPolicy {
  /** Objective name, for reports. networkPack: reciprocal harmonic (pairs) + average-without-misery (groups). */
  objective: "reciprocal" | "one_sided" | "two_sided_asymmetric";
  /** Aggregates per-side benefits into mutual benefit. Default (networkPack) = scoring.ts mutualBenefit. */
  aggregate(benefits: number[]): number;
  /** Applied to novelty at the same arithmetic point as before (byte identity rule 4). */
  novelty?(c: Candidate, novelty: number): number;
  /** Applied to social risk after the safety-class bump (byte identity rule 4: networkPack adds romance +0.1 here). */
  socialRisk?(c: Candidate, risk: number): number;
}

// ---------------------------------------------------------------------------------------- selection
export interface SelectionPolicy {
  /**
   * Optional lift on the greedy key (slopPack: exposure fairness on top of exposure debt, e.g. a
   * popularity penalty). Absent for networkPack, so the greedy arithmetic is unchanged.
   */
  adjust?(w: World, c: Candidate, value: number, timesSelectedInRun: (id: MemberId) => number): number;
  /**
   * Optional global assignment that replaces the core greedy selection (slopPack: stable matching per
   * tick, or a pack greedy with inbound caps). It receives the scored configurations after every
   * hard filter and must only choose among `eligible` ones; the core minors guard still runs on its
   * output (engine.ts). Absent for networkPack, so the core greedy (and its bytes) are unchanged.
   */
  assign?(w: World, scored: readonly Scored[], ctx: AssignContext): SelectionResult;
  /** Ask-before-proposing questions by reason (policy.ts planAsks). */
  askQuestions: Readonly<Record<string, string>>;
  /** Whether the pack's extra asks are on under this config (networkPack: cfg.romance.requireStatedPrefs). */
  extraAsksEnabled?(cfg: EngineConfig): boolean;
  /** Pack asks per member (networkPack: the romance-preferences ask). `add(reason, intentId)` emits one. */
  extraAsks?(w: World, id: MemberId, mi: MemberIndex, lastAsk: (reasons: string[]) => number, add: (reason: string, intentId?: string) => void): void;
}

// ---------------------------------------------------------------------------------------- consent
export type ConsentFlow =
  /** networkPack: anonymous probe to the wanter first, then the partner; reveal = the booked plan with an opt-out. */
  | { kind: "probe_first"; order: "wanter_first" | "parallel"; reveal: "confirm" | "opt_out"; anonymousProbe: true }
  /** slopPack: both sides asked blind at once; names only on mutual yes; expires. */
  | { kind: "double_opt_in"; blind: true; revealOn: "mutual_yes"; expiresHours: number }
  /** peonPack: the candidate opts in, the employer reviews a blind profile, then reveal. */
  | { kind: "application"; initiator: RoleId; reviewer: RoleId; blindReview: readonly string[]; stages: readonly string[] }
  /** Groups and plans: anonymous probes, names after quorum. */
  | { kind: "group_rsvp"; quorum: number; lateJoinHours: number };
export interface ConsentPolicy { default: ConsentFlow; byKind: Partial<Record<OpportunityKind | KindId, ConsentFlow>> }

// ---------------------------------------------------------------------------------------- attention
export interface ProbeFrameCtx {
  lane: Category; kind: OpportunityKind | string; when: string; othersCount: number; contributor: boolean; mutual?: string;
}
export interface AttentionPack {
  /** Default AttentionConfig (caps, lambda, quiet hours, send time, consent...). */
  config: AttentionConfig;
  /** Ê calibrator knots, global and per lane (fitted on the pack's sim labels). */
  calibrator: { knots: [number, number][]; byLane: Partial<Record<Category, [number, number][]>> };
  /** The lane that always ships in its own message unless the member allows it in a digest (networkPack: romance, D10). */
  shipsAloneLane?: Category;
  /** Lanes a warm mention ("a friend of Sam") is never used for. */
  noWarmMentionLanes: readonly Category[];
  /** Pack gate on a single attention item, after the core minors gate. */
  itemGate?(m: { age: number; categoriesOptIn?: Category[] }, it: { category: Category }): string | null;
  /** Probe preconditions beyond the core ones (networkPack: a romance probe is one-to-one). */
  probeAllowed?(lane: Category, othersCount: number): boolean;
  /** Generic activity phrase per lane when the objective cannot be shown. */
  laneActivity: Readonly<Record<string, string>>;
  /** The anonymous probe text. Must not name anyone; the core leak gate checks every candidate text. */
  probeText(ctx: ProbeFrameCtx, activity: string, attribute?: string, area?: string): string;
  /** Default cadence fields the pack owns (networkPack: romanceInDigest). */
  cadenceDefaults?(cfg: AttentionConfig): Partial<CadencePrefs>;
}

// ---------------------------------------------------------------------------------------- judge
export interface JudgePassSpec { version: string; system: string }
export type JudgeVisibility = "public" | "compact" | "matchable" | "private";
export interface JudgePack {
  /** Pass 1 (screen). */
  screen?: JudgePassSpec;
  /** Pass 2 (rubric): "compact" context (judge-v2.1) or "matchable" context (judge-v3). */
  rubric: { compact: JudgePassSpec; matchable: JudgePassSpec };
  /** Pass 3 (deep review). */
  deep?: JudgePassSpec;
  rubricKeys: readonly string[];
  /** Pseudonymous, scrubbed context for a pass (must never carry agent_private facets or sealed attributes to member-facing fields). */
  buildContext(w: World, c: Candidate, visibility: JudgeVisibility): { context: object; refs: Record<string, MemberId> };
  /** Pack part of the post-model gate, after the core gate (minors, unknown, holds, blocks). */
  hardGate?(w: World, c: Pick<Candidate, "participants" | "via" | "category">): string | null;
}

// ---------------------------------------------------------------------------------------- explanations
export interface ExplainPack {
  laneLabel: Readonly<Record<string, string>>;
  facetPhrase: Partial<Record<Facet["kind"], string>>;
  /** Replaces the whole explanation for a kind (networkPack: network_growth). */
  leadBits?(w: World, c: Candidate, me: MemberId): string[] | undefined;
  /** Kind sentences after the intent / event bits (networkPack: newcomer_welcome, second_encounter). */
  kindBits?(w: World, c: Candidate, me: MemberId): string[];
  /** Used when a text still carries a canary after every gate. */
  safeFallback: string;
  /**
   * Generic lane words that are never private for this pack even though they occur in its private
   * facet templates (slopPack: "date" in "first date idea: coffee"). Removed from the leak gate's
   * private vocabulary; keep it to words that say nothing about a member. Absent for networkPack.
   */
  publicWords?: readonly string[];
}

// ---------------------------------------------------------------------------------------- plans / capital
export interface PlansPack {
  config: PlansConfig;
  /** The lane plans run in (networkPack: social; never romance). */
  lane: Category;
  activities: readonly ActivityType[];
}
export interface CapitalPack {
  /** Ledger categories (packages/capital types). The capital package owns the ledger; this names the pack's policy. */
  earn: readonly string[];
  lose: readonly string[];
  /** Core: minors never accrue capital. */
  minorsExcluded: true;
}

// ---------------------------------------------------------------------------------------- simulation
/** Pointer to the pack's simulator (the sim lives outside the engine; the oracle is never importable from engine code). */
export interface SimPackRef { module: string; export: string }
/**
 * The simulator side of a pack (implemented in packages/sim; harness only). P = persona, S = snapshot, O = oracle.
 */
export interface SimPack<P = unknown, S = unknown, O = unknown> {
  appId: AppId;
  personas: { generate(opts: { n: number; seed: number | string; markets?: Record<MarketId, number>; minorShare?: number }): P[] };
  snapshot(personas: P[], state: unknown): S;
  oracle(personas: P[], seed: number | string, start: number): O;
  metrics: MetricsPack;
  adversarial: { kinds: readonly string[]; rate: number };
}

// ---------------------------------------------------------------------------------------- metrics & gates
export interface MetricGate { metric: string; op: ">=" | "<=" | "=="; value: number; seeds: number; blocking: boolean }
export interface MetricsPack {
  primary: readonly string[];
  gates: readonly MetricGate[];
  /** Oracle unsafe classes that must be 0. */
  unsafeClasses: readonly string[];
}

// ---------------------------------------------------------------------------------------- helpers
/** The judge part of a World's pack (throws if the pack has no judge; runEngine never calls a pass then). */
export function judgePackOf(w: World): JudgePack {
  const j = w.pack.judge;
  if (!j) throw new Error(`pack ${w.pack.id} has no judge`);
  return j;
}

/**
 * Validates a pack against the core contract. Throws on: a match age under 18, a matchable account
 * tier, a lane that is not adults-only, duplicate generator / rule / lane ids.
 */
export function validatePack(p: AppPack): AppPack {
  const errs: string[] = [];
  if (!(p.eligibility.minMatchAge >= 18)) errs.push(`minMatchAge ${p.eligibility.minMatchAge} < 18 (core invariant)`);
  for (const t of p.eligibility.accountTiers) {
    if ((t as { matchable: boolean }).matchable !== false) errs.push(`account tier ${t.label} must not be matchable`);
    if (t.maxAge >= 18 && t.minAge < 18) errs.push(`account tier ${t.label} straddles 18`);
  }
  for (const l of p.ontology.lanes) if ((l as { adultOnly: boolean }).adultOnly !== true) errs.push(`lane ${l.id} must be adultOnly`);
  const dup = (xs: string[], what: string) => { const s = new Set<string>(); for (const x of xs) { if (s.has(x)) errs.push(`duplicate ${what} ${x}`); s.add(x); } };
  dup(p.generators.map(g => g.name), "generator");
  dup(p.eligibility.memberRules.map(r => r.id), "member rule");
  dup(p.eligibility.pairRules.map(r => r.id), "pair rule");
  dup([...p.eligibility.candidatePreRules, ...p.eligibility.candidatePostRules].map(r => r.id), "candidate rule");
  dup(p.ontology.lanes.map(l => l.id), "lane");
  if (errs.length) throw new Error(`invalid pack ${p.id}: ${errs.join("; ")}`);
  return p;
}
