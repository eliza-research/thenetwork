// The AppPack contract: one engine, four apps (docs/research/2026-10-08-engine-generalization.md
// section 2; docs/research/2026-10-08-platform-architecture.md 6.2).
//
//   ntwrk   The Network           networkPack (packs/network): today's behaviour, byte-identical
//   slop    slop.date (dating)    slopPack (next; first priority)
//   peon    peon.biz (hiring)     peonPack
//   friends friends.help (NYC)    friendsPack
//
// BYTE IDENTITY (section 3.2). Pack identity travels BESIDE the config (`deps.pack`, the World
// constructor), never inside it: EngineConfig / AttentionConfig / PlansConfig keep their shapes and
// hashes. Run logs get no new fields for networkPack. Rule and generator order is the contract.
import type { AppId, Category, City, Facet, Intent, MemberId, OpportunityKind } from "@thenetwork/core";
import { teenFriendCategory, type MatchLane } from "../../core/src/generated/matchLane.ts";
import type { ActivityType } from "./packs/network/activities.ts";
import type { AttentionConfig, EngineConfig } from "./config.ts";
import type { GenCtx } from "./genkit.ts";
import type { Candidate, Format, Role } from "./types.ts";
import type { Interval, MemberIndex, RomanceProfile, World } from "./world.ts";
import type { SelectionResult } from "./policy.ts";
import type { EngineRng as Rng } from "@thenetwork/core";
import type { Scored } from "./scoring.ts";
import type { PackVectors } from "./match/profile.ts";

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
export type { AppId } from "@thenetwork/core";
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
  scoring: ScoringPolicy;
  selection: SelectionPolicy;
  consent: ConsentPolicy;
  attention: AttentionPack;
  /** Absent: the LLM judge passes never run for this pack. */
  judge?: JudgePack;
  explain: ExplainPack;
  plans?: PlansPack;
  /** Lane memberships, tags, standing and optional traits and pack value for generic matching (match/). Absent: no profiles. */
  vectors?: PackVectors;
}

// ---------------------------------------------------------------------------------------- ontology
export interface LaneDef {
  id: LaneId;
  minors: "never" | "teenFriendship";
  /** Plans never use this lane. networkPack: romance (D15). */
  neverInPlans?: boolean;
}

/** The want vocabulary of a pack (networkPack: packs/network/taxonomy.ts OBJECTIVES). */
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
  /** Roles that give (provider, helper, host, connector): contribution budgets, receiving-state rule, load. */
  contributorRoles: ReadonlySet<Role>;
  /** Positive edge types that form the warm graph (blocking edges are core: blocked, avoid). */
  warmEdges: ReadonlySet<string>;
  /** Lane and role of the once-per-member availability probe in the run report (funnel.memberFunnel). */
  funnelProbe: { lane: Category; role: Role };
  objectives: readonly ObjectiveDef[];
  /** Objectives a stated want maps to (plan activities). */
  objectivesFor(text: string, details?: string, lane?: string): ObjectiveDef[];
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
  lane?: MatchLane;
  extraProactive?: number; extraContribution?: number; ownIntentCreatedAt?: number;
}
/** A rule returns a funnel reason (string) or null. Rules are pure and only ever REMOVE. */
export interface MemberRule { id: string; check(w: World, id: MemberId, mi: MemberIndex, c: MemberCheck): string | null }
export interface PairRule {
  id: string;
  check(w: World, a: MemberId, b: MemberId, category: Category, ma: MemberIndex, mb: MemberIndex, lane?: MatchLane): string | null;
}
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
 * with `pairReason` as the mutual-radius hard filter.
 */
export interface GeoModel {
  /** Markets this run covers (locking, per-market caps, time zones). networkPack: cfg.cities, same array. */
  markets(cfg: EngineConfig): readonly City[];
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
  pairReason?(w: World, a: MemberId, b: MemberId, lane?: MatchLane): string | null;
}

// ---------------------------------------------------------------------------------------- generators
export interface GeneratorSpec { name: GeneratorId; run(ctx: GenCtx): Candidate[] }

// ---------------------------------------------------------------------------------------- scoring
export interface ScoringPolicy {
  /** Applied to novelty at the same arithmetic point as before (byte identity rule 4). */
  novelty?(c: Candidate, novelty: number): number;
  /** Applied to social risk after the safety-class bump (byte identity rule 4: networkPack adds romance +0.1 here). */
  socialRisk?(c: Candidate, risk: number): number;
}

// ---------------------------------------------------------------------------------------- selection
export interface SelectionPolicy {
  /**
   * Optional pack refusal at selection time (peonPack: a job's slate cap and a candidate's weekly
   * cap). Returning -Infinity is a hard refusal: no phase, exploration included, reserves the
   * configuration (spec/selectionRun.md, packAllows). A refusal must stay a refusal as the run's
   * use grows. Any other return value is ignored: it never changes the greedy value or order.
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
  /** Whether this pack has a model rubric for the candidate's lane. */
  reviewCandidate?(c: Candidate): boolean;
  /** Pseudonymous, scrubbed context for a pass (must never carry agent_private facets or sealed attributes to member-facing fields). */
  buildContext(w: World, c: Candidate, visibility: JudgeVisibility): { context: object; refs: Record<string, MemberId> };
  /** Pack part of the post-model gate, after the core gate (minors, unknown, holds, blocks). */
  hardGate?(w: World, c: Pick<Candidate, "participants" | "via" | "category" | "lane">): string | null;
}

// ---------------------------------------------------------------------------------------- explanations
export interface ExplainPack {
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

// ---------------------------------------------------------------------------------------- plans
export interface PlansPack {
  /** The lane plans run in (networkPack: social; never romance). */
  lane: Category;
  activities: readonly ActivityType[];
}
// ---------------------------------------------------------------------------------------- helpers
/** The judge part of a World's pack (throws if the pack has no judge; runEngine never calls a pass then). */
export function judgePackOf(w: World): JudgePack {
  const j = w.pack.judge;
  if (!j) throw new Error(`pack ${w.pack.id} has no judge`);
  return j;
}

export function validatePack(p: AppPack): AppPack {
  const errs: string[] = [];
  if (!(p.eligibility.minMatchAge >= 18)) errs.push(`minMatchAge ${p.eligibility.minMatchAge} < 18 (core invariant)`);
  for (const t of p.eligibility.accountTiers) {
    if ((t as { matchable: boolean }).matchable !== false) errs.push(`account tier ${t.label} must not be matchable`);
    if (t.maxAge >= 18 && t.minAge < 18) errs.push(`account tier ${t.label} straddles 18`);
  }
  for (const l of p.ontology.lanes) {
    const minors: unknown = l.minors;
    if (minors !== "never" && !(minors === "teenFriendship" && teenFriendCategory(p.id, l.id))) errs.push(`lane ${l.id} cannot admit minors`);
  }
  const dup = (xs: string[], what: string) => { const s = new Set<string>(); for (const x of xs) { if (s.has(x)) errs.push(`duplicate ${what} ${x}`); s.add(x); } };
  dup(p.generators.map(g => g.name), "generator");
  dup(p.eligibility.memberRules.map(r => r.id), "member rule");
  dup(p.eligibility.pairRules.map(r => r.id), "pair rule");
  dup([...p.eligibility.candidatePreRules, ...p.eligibility.candidatePostRules].map(r => r.id), "candidate rule");
  dup(p.ontology.lanes.map(l => l.id), "lane");
  if (errs.length) throw new Error(`invalid pack ${p.id}: ${errs.join("; ")}`);
  return p;
}
