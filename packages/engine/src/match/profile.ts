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

export type TagSet = readonly number[];

export interface Membership {
  readonly id: string;
  readonly lane: MatchLane;
  readonly side: LaneSide;
  readonly market: City;
  readonly capacity: number;
}
export interface MatchEntity extends Membership { readonly memberId: MemberId }
export interface EntityTags {
  readonly offers: readonly string[];
  readonly seeks: readonly string[];
  readonly interests: readonly string[];
}
export interface EntityStanding {
  readonly standing: number;
  readonly uncertainty: number;
  readonly evidenceIds?: readonly string[];
}
export interface EntitySegment { readonly own: string; readonly partners: readonly string[] }
interface EntityMask { readonly own: number; readonly accepts: number }
interface MatchSegment { readonly own: string; readonly partners: ReadonlySet<string> }
interface PackTraits {
  readonly costs: readonly number[];
  of(w: World, entity: MatchEntity): readonly number[];
}
interface PackClasses {
  of(w: World, entity: MatchEntity): number;
  cap(w: World, a: MatchProfile, packClass: number, untouched: boolean): number;
}

export interface PackVectors {
  memberships(w: World, memberId: MemberId): readonly Membership[];
  tags(w: World, entity: MatchEntity): EntityTags;
  standing(w: World, entity: MatchEntity): EntityStanding;
  readonly traits?: PackTraits;
  segment?(w: World, entity: MatchEntity): EntitySegment | undefined;
  packValue?(w: World, a: MatchProfile, b: MatchProfile): number;
  packBound?(w: World, a: MatchProfile, b: MatchProfile): number;
  readonly packClasses?: PackClasses;
  masks?(w: World, entity: MatchEntity): readonly EntityMask[];
}

export interface MatchProfile {
  readonly id: EntityId;
  readonly memberId: MemberId;
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
  readonly segment?: MatchSegment;
  readonly masks?: readonly EntityMask[];
  readonly packClass?: number;
}

const LANE_CATEGORY: Readonly<Record<MatchLane, Category>> = {
  Friend: "social", Date: "romance", Cofounder: "professional", Intro: "professional",
  Hire: "professional", Mentor: "professional", Invest: "professional",
};
export const laneCategory = (lane: MatchLane): Category => LANE_CATEGORY[lane];

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

interface TagInterner { readonly size: number; tagSet(tags: readonly string[]): TagSet }
function internTags(tags: Iterable<string>): TagInterner {
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
  readonly masks?: readonly EntityMask[];
  readonly packClass?: number;
}

const maskBits = (bits: number): number => {
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff) throw new RangeError(`mask must be a whole number in 0..2^32-1, got ${bits}`);
  return bits;
};

export function buildProfiles(w: World, standingUpdates?: MemberStandingRow[], mode: "discovery" | "existingFriendPlan" = "discovery"): readonly MatchProfile[] {
  const vectors = w.pack.vectors;
  if (!vectors) return [];
  const existingFriendPlan = mode === "existingFriendPlan";
  const traitCount = vectors.traits?.costs.length ?? 0;
  let maskCount: number | undefined;
  const drafts: Draft[] = [];
  const seen = new Set<string>();
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
      const masks = vectors.masks?.(w, entity).map(m => ({ own: maskBits(m.own), accepts: maskBits(m.accepts) }));
      if (masks && masks.length !== (maskCount ??= masks.length)) throw new Error(`entity ${id} has ${masks.length} masks, another has ${maskCount}`);
      const packClass = vectors.packClasses ? wholeNumber(vectors.packClasses.of(w, entity), "pack class") : undefined;
      drafts.push({
        entity, id, key: blockKey(lane, side, market), capacity, traits,
        ...(segment ? { segment: { own: segment.own, partners: partnerSet(segment.partners) } } : {}),
        ...(masks ? { masks } : {}),
        ...(packClass !== undefined ? { packClass } : {}),
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
      ...(d.masks ? { masks: d.masks } : {}),
      ...(d.packClass !== undefined ? { packClass: d.packClass } : {}),
    };
  });
}
