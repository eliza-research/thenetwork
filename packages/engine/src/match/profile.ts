// Generic match profiles: one per lane membership of a matchable member or entity (a member, or a
// peon job seat owned by a manager). Packs supply the vectors; the engine owns the rest.
import type { Category, City, MemberId } from "@thenetwork/core";
import {
  laneOffered, laneShape, laneSidesCompatible, standingCeiling, standingUncertaintyCeiling,
  type LaneSide, type MatchLane,
} from "../../../core/src/generated/matchLane.ts";
import { planProfileCapacityAllows } from "../../../core/src/generated/planDecision.ts";
import { sendTimeReason } from "../filters.ts";
import type { MemberStandingRow } from "../types.ts";
import type { World } from "../world.ts";
import { standingObservations } from "./standing.ts";

export type EntityId = string & { readonly __brand: "EntityId" };
export const isEntityId = (value: string): value is EntityId => value.length > 0;

/** Interned tag ids, sorted ascending, no duplicates. */
export type TagSet = readonly number[];

/** One lane membership as a pack reports it. */
export interface Membership {
  readonly id: string;
  readonly lane: MatchLane;
  readonly side: LaneSide;
  readonly market: City;
  /** Introductions this entity can still take this week; discovery requires a positive value. */
  readonly capacity: number;
}
export interface MatchEntity extends Membership { readonly memberId: MemberId }
export interface EntityTags {
  readonly offers: readonly string[];
  readonly seeks: readonly string[];
  readonly interests: readonly string[];
}
/** Whole numbers from the generated memberStanding helpers; the engine clamps them to their ranges. */
export interface EntityStanding {
  readonly standing: number;
  readonly uncertainty: number;
  /** Exact source identities used for the estimate. Kept out of public match profiles and logs. */
  readonly evidenceIds?: readonly string[];
}
/**
 * A hard-constraint segment of one membership (spec/candidateSearch.md, "Segment blocking never drops
 * a pair the pair gate admits"): its own segment and the segments it can pair with. A pack gives
 * segments only as a superset of its own pair rules.
 */
export interface EntitySegment { readonly own: string; readonly partners: readonly string[] }
export interface MatchSegment { readonly own: string; readonly partners: ReadonlySet<string> }
/** Scalar attributes compared by closeness: `of` returns one whole number per entry of `costs`. */
export interface PackTraits {
  readonly costs: readonly number[];
  of(w: World, entity: MatchEntity): readonly number[];
}

/** The hook a pack implements to take part in generic matching (AppPack.vectors). */
export interface PackVectors {
  memberships(w: World, memberId: MemberId): readonly Membership[];
  tags(w: World, entity: MatchEntity): EntityTags;
  standing(w: World, entity: MatchEntity): EntityStanding;
  readonly traits?: PackTraits;
  /** The entity's segment; undefined pairs with every segment. */
  segment?(w: World, entity: MatchEntity): EntitySegment | undefined;
  /** Directed value of `b` for `a`, 0..1000 (whole number). */
  packValue?(w: World, a: MatchProfile, b: MatchProfile): number;
}

export interface MatchProfile {
  readonly id: EntityId;
  readonly memberId: MemberId;
  /** Position in the canonical (entity id) order of its block: unique and stable inside the block. */
  readonly ordinal: number;
  readonly lane: MatchLane;
  readonly side: LaneSide;
  readonly market: City;
  readonly standing: number;
  readonly uncertainty: number;
  readonly capacity: number;
  readonly offers: TagSet;
  readonly seeks: TagSet;
  readonly interests: TagSet;
  readonly traits: readonly number[];
  /** Absent: the profile reaches every partner and every partner reaches it. */
  readonly segment?: MatchSegment;
}

/** The legacy category whose opt-in, cooldowns and pack pair rules apply to a lane. */
const LANE_CATEGORY: Readonly<Record<MatchLane, Category>> = {
  Friend: "social", Date: "romance", Cofounder: "professional", Intro: "professional",
  Hire: "professional", Mentor: "professional", Invest: "professional",
};
export const laneCategory = (lane: MatchLane): Category => LANE_CATEGORY[lane];

/** The side a partner holds: the same side in a Peers lane, the other side in a TwoSided lane. */
export function partnerSide(lane: MatchLane, side: LaneSide): LaneSide {
  if (laneShape(lane) === "Peers") return side;
  switch (side) {
    case "Offering": return "Seeking";
    case "Seeking": return "Offering";
    case "Peer": return "Peer";
    default: { const _exhaustive: never = side; return _exhaustive; }
  }
}

export const blockKey = (lane: MatchLane, side: LaneSide, market: City): string => `${lane}\u0000${side}\u0000${market}`;
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function wholeNumber(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${what} must be a whole number, got ${value}`);
  return value;
}
const clamp = (value: number, ceiling: number): number => (value < 0 ? 0 : value > ceiling ? ceiling : value);

export interface TagInterner { readonly size: number; tagSet(tags: readonly string[]): TagSet }
/** Ids follow the sorted order of the distinct tags, so one run always interns the same way. */
export function internTags(tags: Iterable<string>): TagInterner {
  const sorted = [...new Set(tags)].sort(compareText);
  const ids = new Map(sorted.map((tag, id) => [tag, id] as const));
  return {
    size: sorted.length,
    tagSet: list => [...new Set(list.flatMap(tag => { const id = ids.get(tag); return id === undefined ? [] : [id]; }))].sort((x, y) => x - y),
  };
}

const normalTags = (tags: readonly string[]): string[] => tags.map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

interface Draft {
  readonly entity: MatchEntity; readonly id: EntityId; readonly key: string;
  readonly capacity: number; readonly tags: EntityTags; readonly standing: EntityStanding; readonly traits: readonly number[];
  readonly segment?: MatchSegment;
}

/**
 * Profiles in canonical order (block key, then entity id). A member who cannot be matched (minor or
 * unknown age, under the pack or config age floor, safety hold, paused, not opted in to the lane's
 * category) gets none, and the pack is not asked about a member who fails the core checks.
 */
export function buildProfiles(w: World, standingUpdates?: MemberStandingRow[], mode: "discovery" | "existingFriendPlan" = "discovery"): readonly MatchProfile[] {
  const vectors = w.pack.vectors;
  if (!vectors) return [];
  const existingFriendPlan = mode === "existingFriendPlan";
  const traitCount = vectors.traits?.costs.length ?? 0;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  // Packs memoize partner lists, so members with the same list share one set.
  const partnerSets = new WeakMap<readonly string[], ReadonlySet<string>>();
  const partnerSet = (partners: readonly string[]): ReadonlySet<string> => {
    let set = partnerSets.get(partners);
    if (!set) { set = new Set(partners); partnerSets.set(partners, set); }
    return set;
  };
  for (const memberId of w.ids) {
    if (sendTimeReason(w, memberId) !== null) continue;
    for (const membership of vectors.memberships(w, memberId)) {
      const { id, lane, side, market } = membership;
      if (existingFriendPlan && lane !== "Friend") continue;
      if (!isEntityId(id)) throw new Error(`empty entity id for member ${memberId}`);
      if (seen.has(id)) throw new Error(`duplicate entity id ${id}`);
      seen.add(id);
      if (!laneOffered(w.pack.id, lane) || !laneSidesCompatible(lane, side, partnerSide(lane, side))) continue;
      if (sendTimeReason(w, memberId, [], undefined, laneCategory(lane)) !== null) continue;
      const capacity = wholeNumber(membership.capacity, "capacity");
      if (!planProfileCapacityAllows(capacity, existingFriendPlan)) continue;
      const entity: MatchEntity = { ...membership, memberId };
      const raw = vectors.tags(w, entity);
      const rated = vectors.standing(w, entity);
      const traits = vectors.traits ? vectors.traits.of(w, entity).map(t => wholeNumber(t, "trait")) : [];
      if (traits.length !== traitCount) throw new Error(`entity ${id} has ${traits.length} traits, the pack declares ${traitCount}`);
      const segment = vectors.segment?.(w, entity);
      drafts.push({
        entity, id, key: blockKey(lane, side, market), capacity, traits,
        ...(segment ? { segment: { own: segment.own, partners: partnerSet(segment.partners) } } : {}),
        tags: { offers: normalTags(raw.offers), seeks: normalTags(raw.seeks), interests: normalTags(raw.interests) },
        standing: {
          standing: clamp(wholeNumber(rated.standing, "standing"), standingCeiling),
          uncertainty: clamp(wholeNumber(rated.uncertainty, "uncertainty"), standingUncertaintyCeiling),
          evidenceIds: rated.evidenceIds,
        },
      });
    }
  }
  const interner = internTags(drafts.flatMap(d => [...d.tags.offers, ...d.tags.seeks, ...d.tags.interests]));
  drafts.sort((x, y) => compareText(x.key, y.key) || compareText(x.id, y.id));
  const observe = standingObservations(w, standingUpdates);
  let ordinal = 0;
  return drafts.map((d, i) => {
    ordinal = i > 0 && drafts[i - 1].key === d.key ? ordinal + 1 : 0;
    return {
      id: d.id, memberId: d.entity.memberId, ordinal,
      lane: d.entity.lane, side: d.entity.side, market: d.entity.market,
      standing: observe(d.entity, d.standing.standing, d.standing.evidenceIds), uncertainty: d.standing.uncertainty, capacity: d.capacity,
      offers: interner.tagSet(d.tags.offers), seeks: interner.tagSet(d.tags.seeks), interests: interner.tagSet(d.tags.interests),
      traits: d.traits,
      ...(d.segment ? { segment: d.segment } : {}),
    };
  });
}
