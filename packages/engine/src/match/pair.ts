import {
  closenessValue, coverageValue, directedUtility, noPairValue, pairValueScale, type PairSide, type UtilityTerm,
} from "../../../core/src/generated/pairValue.ts";
import { maskPairAllowed, segmentPairAllowed } from "../../../core/src/generated/candidateSearch.ts";
import { lanePairValue, laneSidesCompatible, laneWeights, type LaneWeights } from "../../../core/src/generated/matchLane.ts";
import { pairReason } from "../filters.ts";
import type { World } from "../world.ts";
import { laneCategory, wholeNumber, type MatchProfile, type PackVectors, type TagSet } from "./profile.ts";

export function intersectCount(a: TagSet, b: TagSet): number {
  let i = 0, j = 0, count = 0;
  while (i < a.length && j < b.length) {
    const x = a[i], y = b[j];
    if (x === y) { count++; i++; j++; } else if (x < y) i++; else j++;
  }
  return count;
}

export const sharesTag = (a: MatchProfile, b: MatchProfile): boolean =>
  intersectCount(a.interests, b.interests) > 0 || intersectCount(a.seeks, b.offers) > 0 || intersectCount(a.offers, b.seeks) > 0;

interface TermValues { readonly complement: number; readonly affinity: number; readonly closeness: number; readonly pack: number }

export function weightedTerms(weights: LaneWeights, hasTraits: boolean, hasPackValue: boolean, values: TermValues): UtilityTerm[] {
  return [
    { weight: weights.complement, value: values.complement },
    { weight: weights.affinity, value: values.affinity },
    { weight: hasTraits ? weights.closeness : 0, value: values.closeness },
    { weight: hasPackValue ? weights.pack : 0, value: values.pack },
  ];
}

function closenessOf(a: MatchProfile, b: MatchProfile, costs: readonly number[]): number {
  if (costs.length === 0) return pairValueScale;
  let total = 0;
  for (let d = 0; d < costs.length; d++) total += closenessValue(a.traits[d] - b.traits[d], costs[d]);
  return Math.floor(total / costs.length);
}

const complementOf = (a: MatchProfile, b: MatchProfile): number => coverageValue(intersectCount(a.seeks, b.offers), a.seeks.length);

function sideTerms(a: MatchProfile, weights: LaneWeights, complement: number, sharedInterests: number, closeness: number, hasTraits: boolean, packValue: number | undefined): UtilityTerm[] {
  return weightedTerms(weights, hasTraits, packValue !== undefined, {
    complement,
    affinity: coverageValue(sharedInterests, a.interests.length),
    closeness,
    pack: packValue ?? pairValueScale,
  });
}

function side(a: MatchProfile, complement: number, sharedInterests: number, closeness: number, hasTraits: boolean, packValue: number | undefined): PairSide {
  return {
    utility: directedUtility(sideTerms(a, laneWeights(a.lane), complement, sharedInterests, closeness, hasTraits, packValue)),
    standing: a.standing, uncertainty: a.uncertainty, exchange: complement,
  };
}

export function pairSideOf(a: MatchProfile, b: MatchProfile, traitCosts: readonly number[], packValue: number | undefined): PairSide {
  return side(a, complementOf(a, b), intersectCount(a.interests, b.interests),
    closenessOf(a, b, traitCosts), traitCosts.length > 0, packValue);
}

export const segmentReaches = (a: MatchProfile, b: MatchProfile): boolean =>
  a.segment === undefined || b.segment === undefined || a.segment.partners.has(b.segment.own);

function masksAccept(a: MatchProfile, b: MatchProfile): boolean {
  const theirs = b.masks;
  return a.masks === undefined || theirs === undefined || a.masks.every((mask, d) => (mask.accepts & theirs[d].own) !== 0);
}

export const masksAdmit = (a: MatchProfile, b: MatchProfile): boolean => maskPairAllowed(masksAccept(a, b), masksAccept(b, a));

export function eligiblePair(w: World, a: MatchProfile, b: MatchProfile): string | null {
  if (a.memberId === b.memberId) return "duplicate_participant";
  if (a.lane !== b.lane || !laneSidesCompatible(a.lane, a.side, b.side)) return "lane_mismatch";
  if (a.market !== b.market) return "market_mismatch";
  if (!segmentPairAllowed(segmentReaches(a, b), segmentReaches(b, a))) return "segment_unreachable";
  if (!masksAdmit(a, b)) return "mask_refused";
  return pairReason(w, a.memberId, b.memberId, laneCategory(a.lane), a.lane);
}

export function vectorsOf(w: World): PackVectors {
  const vectors = w.pack.vectors;
  if (!vectors) throw new Error(`pack ${w.pack.id} has no match vectors`);
  return vectors;
}

export const packValueOf = (w: World, vectors: PackVectors, a: MatchProfile, b: MatchProfile): number | undefined =>
  vectors.packValue ? wholeNumber(vectors.packValue(w, a, b), "pack value") : undefined;

export function pairArithmetic(a: MatchProfile, b: MatchProfile, costs: readonly number[], packAB: number | undefined, packBA: number | undefined): number {
  const sharedInterests = intersectCount(a.interests, b.interests);
  const closeness = closenessOf(a, b, costs);
  const hasTraits = costs.length > 0;
  return lanePairValue(a.lane, side(a, complementOf(a, b), sharedInterests, closeness, hasTraits, packAB), a.side,
    side(b, complementOf(b, a), sharedInterests, closeness, hasTraits, packBA), b.side);
}

export interface PairCheck { readonly value: number; readonly refusal: string | null }

export function gatePair(w: World, a: MatchProfile, b: MatchProfile, arithmetic: number): PairCheck {
  if (arithmetic < 0) return { value: noPairValue, refusal: "below_floor" };
  const refusal = eligiblePair(w, a, b);
  return refusal === null ? { value: arithmetic, refusal } : { value: noPairValue, refusal };
}

export function pairValueOf(w: World, a: MatchProfile, b: MatchProfile): number {
  const vectors = vectorsOf(w);
  const arithmetic = pairArithmetic(a, b, vectors.traits?.costs ?? [], packValueOf(w, vectors, a, b), packValueOf(w, vectors, b, a));
  return gatePair(w, a, b, arithmetic).value;
}
