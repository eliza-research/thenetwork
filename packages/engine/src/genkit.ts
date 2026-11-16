// Generator building blocks (core, pack-independent): the candidate constructors over the match
// core, event retrieval by tag postings, shareable labels and format inference. Packs compose their
// generators from these; pair candidates come only from the bounded search (searchFor).
import type { Facet, MemberId } from "@thenetwork/core";
import { pairValueScale } from "../../core/src/generated/pairValue.ts";
import type { MatchLane } from "../../core/src/generated/matchLane.ts";
import { memberReason, type FilterReason } from "./filters.ts";
import type { Circle } from "./match/circles.ts";
import { packValueOf, pairSideOf, vectorsOf } from "./match/pair.ts";
import type { EntityId, MatchProfile } from "./match/profile.ts";
import type { SearchResult } from "./match/search.ts";
import type { EngineRng as Rng } from "@thenetwork/core";
import type { Candidate, NetworkEvent, Role } from "./types.ts";
import type { World } from "./world.ts";

export interface GenCtx {
  w: World;
  /** Members by first failing member-level filter (funnel.memberExclusions). */
  memberExclusions: Record<string, number>;
  rng: Rng;
  /** Intents for which retrieval found nobody (input to network growth + empty states). */
  unmatchedIntents: Set<string>;
}

export type CandidateFields = Omit<Candidate, "key" | "alternates" | "exploration" | "safetyClass" | "timeSensitive" | "riskText" | "warm" | "channels"> & Partial<Candidate>;
/** Everything a generator still names for a matched candidate; the match core supplies the rest. */
export type MatchedFields = Omit<CandidateFields, "participants" | "lane" | "entities" | "fit" | "benefit">;

export function makeCandidate(p: CandidateFields): Candidate {
  const parts = [...p.participants];
  return {
    key: `${p.generator}:${p.kind}:${p.anchor?.id ?? "-"}:${[...parts].sort().join(",")}`,
    alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: p.objective,
    warm: 0, channels: new Set(), ...p,
  } as Candidate;
}

export function countExclusion(ctx: GenCtx, r: FilterReason) {
  ctx.memberExclusions[r] = (ctx.memberExclusions[r] ?? 0) + 1;
}

/** The best partners of one profile: the bounded, memoized search of the match core. */
export const searchFor = (ctx: GenCtx, profile: MatchProfile): SearchResult => ctx.w.match.candidates(profile);

/** a's PairSide utility toward b over 1000: the value a receives, never a constant. */
function sideBenefit(w: World, a: MatchProfile, b: MatchProfile): number {
  const vectors = vectorsOf(w);
  return pairSideOf(a, b, vectors.traits?.costs ?? [], packValueOf(w, vectors, a, b)).utility / pairValueScale;
}

/** Participant -> entity for every participant matched through an entity that is not itself. */
function entitiesOf(profiles: readonly MatchProfile[]): Record<MemberId, EntityId> | undefined {
  const named = profiles.filter(p => p.id !== p.memberId);
  return named.length > 0 ? Object.fromEntries(named.map(p => [p.memberId, p.id])) : undefined;
}

/** A two-participant candidate from a searched pair: lane, entities, fit = value / 1000, each side's own benefit. */
export function pairCandidate(w: World, a: MatchProfile, b: MatchProfile, value: number, rest: MatchedFields): Candidate {
  const entities = entitiesOf([a, b]);
  return makeCandidate({
    ...rest, participants: [a.memberId, b.memberId], lane: a.lane, ...(entities ? { entities } : {}),
    fit: Math.max(0, value) / pairValueScale,
    benefit: { [a.memberId]: sideBenefit(w, a, b), [b.memberId]: sideBenefit(w, b, a) },
  });
}

/**
 * A group candidate from a circle: fit = the circle's lowest pair value / 1000, and each member's
 * benefit = the mean of its PairSide utilities toward the other members.
 */
export function circleCandidate(w: World, circle: Circle, lane: MatchLane, rest: MatchedFields): Candidate {
  const profiles = circle.members.map(id => {
    const profile = w.match.profile(id);
    if (!profile || profile.lane !== lane) throw new Error(`circle member ${id} has no profile in lane ${lane}`);
    return profile;
  });
  const benefit: Record<MemberId, number> = {};
  for (const p of profiles) {
    const others = profiles.filter(q => q !== p);
    benefit[p.memberId] = others.reduce((t, q) => t + sideBenefit(w, p, q), 0) / Math.max(1, others.length);
  }
  const entities = entitiesOf(profiles);
  return makeCandidate({
    ...rest, participants: profiles.map(p => p.memberId), lane, ...(entities ? { entities } : {}),
    fit: circle.evidence.lowestPairValue / pairValueScale, benefit,
  });
}

/**
 * Members for one event: the union of the tag postings of the event's tags (World.tagPostings,
 * built once per run), then the member-level hard filters. Never a scan of every member.
 */
export function eventMembers(ctx: GenCtx, ev: NetworkEvent, role: Role, timeSensitive: boolean): MemberId[] {
  const { w } = ctx;
  const ids = new Set<MemberId>();
  for (const tag of ev.tags) for (const id of w.tagPostings.get(tag.toLowerCase()) ?? []) ids.add(id);
  const out: MemberId[] = [];
  for (const id of [...ids].sort()) {
    const reason = memberReason(w, id, { category: ev.category, role, format: "event", timeSensitive });
    if (reason) countExclusion(ctx, reason); else out.push(id);
  }
  return out;
}

/** A shareable label for a facet (tags first, then the short value). Only call with shareable facets. */
export function label(f: Facet | undefined): string | undefined {
  if (!f || f.scope !== "shareable") return undefined;
  return f.tags[0] ?? f.value.split(/[.,;]/)[0]!.slice(0, 40);
}

/**
 * Warm-path value as an inverted U in tie strength (research: matching-and-graphs.md 4.9,
 * LinkedIn PYMK weak-tie experiments): moderate friend-of-a-friend ties beat both the
 * strongest and the weakest. Peaks at strength 0.5.
 */
export function warmPathValue(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return 0.3 + 0.7 * 4 * s * (1 - s);
}

export function eventRiskText(ev: NetworkEvent) { return `${ev.title} ${ev.description ?? ""} ${ev.tags.join(" ")} ${(ev.riskTags ?? []).join(" ")}`; }
