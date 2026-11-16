// The one pair gate and the integer pair value of two profiles.
import {
  closenessValue, coverageValue, directedUtility, noPairValue, pairValueScale, type PairSide, type UtilityTerm,
} from "../../../core/src/generated/pairValue.ts";
import { lanePairValue, laneSidesCompatible, laneWeights, type LaneWeights } from "../../../core/src/generated/matchLane.ts";
import { pairReason } from "../filters.ts";
import type { World } from "../world.ts";
import { laneCategory, wholeNumber, type MatchProfile, type PackVectors, type TagSet } from "./profile.ts";

/** |a ∩ b| for two sorted tag sets (linear merge). */
export function intersectCount(a: TagSet, b: TagSet): number {
  let i = 0, j = 0, count = 0;
  while (i < a.length && j < b.length) {
    const x = a[i], y = b[j];
    if (x === y) { count++; i++; j++; } else if (x < y) i++; else j++;
  }
  return count;
}

export interface TermValues { readonly complement: number; readonly affinity: number; readonly closeness: number; readonly pack: number }

/** The four generic terms. A term the pack does not supply (no traits, no pack value) weighs 0. */
export function weightedTerms(weights: LaneWeights, hasTraits: boolean, hasPackValue: boolean, values: TermValues): UtilityTerm[] {
  return [
    { weight: weights.complement, value: values.complement },
    { weight: weights.affinity, value: values.affinity },
    { weight: hasTraits ? weights.closeness : 0, value: values.closeness },
    { weight: hasPackValue ? weights.pack : 0, value: values.pack },
  ];
}

/** Mean closeness over trait dimensions (floor). `distances[d]` pairs with `costs[d]`. */
export function meanCloseness(distances: readonly number[], costs: readonly number[]): number {
  if (costs.length === 0) return pairValueScale;
  let total = 0;
  for (let d = 0; d < costs.length; d++) total += closenessValue(distances[d], costs[d]);
  return Math.floor(total / costs.length);
}

/** The value `a` receives from `b`: coverage of a's seeks by b's offers. */
const complementOf = (a: MatchProfile, b: MatchProfile): number => coverageValue(intersectCount(a.seeks, b.offers), a.seeks.length);

export function utilityTerms(
  a: MatchProfile, b: MatchProfile, weights: LaneWeights, traitCosts: readonly number[], packValue: number | undefined,
): UtilityTerm[] {
  return weightedTerms(weights, traitCosts.length > 0, packValue !== undefined, {
    complement: complementOf(a, b),
    affinity: coverageValue(intersectCount(a.interests, b.interests), a.interests.length),
    closeness: meanCloseness(a.traits.map((x, d) => x - b.traits[d]), traitCosts),
    pack: packValue ?? pairValueScale,
  });
}

/** a's side of the pair (a, b). */
export function pairSideOf(a: MatchProfile, b: MatchProfile, traitCosts: readonly number[], packValue: number | undefined): PairSide {
  return {
    utility: directedUtility(utilityTerms(a, b, laneWeights(a.lane), traitCosts, packValue)),
    standing: a.standing, uncertainty: a.uncertainty, exchange: complementOf(a, b),
  };
}

/**
 * THE pair gate: never the same member twice, the same lane with compatible sides, the same market,
 * then the core pair checks, the pack pair rules and the pack geo rule (filters.ts pairReason).
 */
export function eligiblePair(w: World, a: MatchProfile, b: MatchProfile): string | null {
  if (a.memberId === b.memberId) return "duplicate_participant";
  if (a.lane !== b.lane || !laneSidesCompatible(a.lane, a.side, b.side)) return "lane_mismatch";
  if (a.market !== b.market) return "market_mismatch";
  return pairReason(w, a.memberId, b.memberId, laneCategory(a.lane), a.lane);
}

export function vectorsOf(w: World): PackVectors {
  const vectors = w.pack.vectors;
  if (!vectors) throw new Error(`pack ${w.pack.id} has no match vectors`);
  return vectors;
}

/** The pack's directed value of `b` for `a` (a whole number), or undefined when the pack supplies none. */
export const packValueOf = (w: World, vectors: PackVectors, a: MatchProfile, b: MatchProfile): number | undefined =>
  vectors.packValue ? wholeNumber(vectors.packValue(w, a, b), "pack value") : undefined;

/** The pair value of (a, b), or noPairValue. Symmetric: lanePairValue mirrors the offset. */
export function pairValueOf(w: World, a: MatchProfile, b: MatchProfile): number {
  const vectors = vectorsOf(w);
  const costs = vectors.traits?.costs ?? [];
  const value = lanePairValue(
    a.lane, pairSideOf(a, b, costs, packValueOf(w, vectors, a, b)), a.side,
    pairSideOf(b, a, costs, packValueOf(w, vectors, b, a)), b.side);
  // The gate runs after the arithmetic only because it is the slower part; the result is the same.
  return value >= 0 && eligiblePair(w, a, b) === null ? value : noPairValue;
}
