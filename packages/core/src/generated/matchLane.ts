// GENERATED from spec/matchLane.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm, pairValueScale as pairValue_pairValueScale, noPairValue as pairValue_noPairValue, utilityTermWeight as pairValue_utilityTermWeight, boundedValue as pairValue_boundedValue, harmonicValue as pairValue_harmonicValue, parityAllowed as pairValue_parityAllowed, lawHarmonicMonotone as pairValue_lawHarmonicMonotone, coverageValue as pairValue_coverageValue, standingGap as pairValue_standingGap, parityPenalty as pairValue_parityPenalty, exchangeBalanced as pairValue_exchangeBalanced, directedUtility as pairValue_directedUtility, lawHarmonicBetweenSides as pairValue_lawHarmonicBetweenSides, closenessValue as pairValue_closenessValue, pairAdmissible as pairValue_pairAdmissible, lawUtilityTermsBounded as pairValue_lawUtilityTermsBounded, lawDirectedUtilityBounded as pairValue_lawDirectedUtilityBounded, pairValue as pairValue_pairValue, lawNoOneSidedPair as pairValue_lawNoOneSidedPair, lawPairValueSymmetric as pairValue_lawPairValueSymmetric, lawParityHolds as pairValue_lawParityHolds, lawSmallerGapNeverWorse as pairValue_lawSmallerGapNeverWorse, lawBalancedExchange as pairValue_lawBalancedExchange, lawPairValueBounded as pairValue_lawPairValueBounded } from "./pairValue.ts";

/** Story: Peers meet as equals / Each lane is a peer lane or a two-sided lane (spec/matchLane.md:11) */
export type LaneShape = "Peers" | "TwoSided";
/** Story: Peers meet as equals / Each lane is a peer lane or a two-sided lane (spec/matchLane.md:11) */
export type LaneSide = "Peer" | "Offering" | "Seeking";
/** Story: Peers meet as equals / Each lane is a peer lane or a two-sided lane (spec/matchLane.md:11) */
export type MatchLane = "Friend" | "Date" | "Cofounder" | "Intro" | "Hire" | "Mentor" | "Invest";
/** Story: Peers meet as equals / Every lane keeps its rules and bounds in one table (spec/matchLane.md:47) */
export interface LaneLimits { rules: pairValue_PairRules; standingOffset: number; weeklyCapacity: number; searchLimit: number; searchBudget: number; circleMinimum: number; circleMaximum: number; circlePairFloor: number }
/** Story: Peers meet as equals / Each lane weighs the four utility terms (spec/matchLane.md:147) */
export interface LaneWeights { complement: number; affinity: number; closeness: number; pack: number }

/** Story: Peers meet as equals / Every lane keeps its rules and bounds in one table (spec/matchLane.md:47) */
export const standingCeiling: number = 100;
/** Story: Peers meet as equals / Every lane keeps its rules and bounds in one table (spec/matchLane.md:47) */
export const standingUncertaintyCeiling: number = 20;

/** Story: Peers meet as equals / Each lane is a peer lane or a two-sided lane (spec/matchLane.md:11) */
//@ pure
export function laneShape(lane: MatchLane): LaneShape {
  return lane === "Friend" ? "Peers" : lane === "Date" ? "Peers" : lane === "Cofounder" ? "Peers" : lane === "Intro" ? "Peers" : lane === "Hire" ? "TwoSided" : lane === "Mentor" ? "TwoSided" : "TwoSided";
}

/** Story: Peers meet as equals / Two members pair only on compatible sides of the same lane (spec/matchLane.md:34) */
//@ pure
export function laneSidesCompatible(lane: MatchLane, side: LaneSide, other: LaneSide): boolean {
  return laneShape(lane) === "Peers" ? side === "Peer" && other === "Peer" : (side === "Offering" && other === "Seeking") || (side === "Seeking" && other === "Offering");
}

/** Story: Peers meet as equals / Two members pair only on compatible sides of the same lane (spec/matchLane.md:34) */
//@ pure
export function lawLaneSidesSymmetric(lane: MatchLane, laneNearRole: LaneSide, laneFarRole: LaneSide): boolean {
  //@ ensures \result === true
  return laneSidesCompatible(lane, laneNearRole, laneFarRole) === laneSidesCompatible(lane, laneFarRole, laneNearRole);
}

/** Story: Peers meet as equals / Every lane keeps its rules and bounds in one table (spec/matchLane.md:47) */
//@ pure
export function laneLimits(lane: MatchLane): LaneLimits {
  return lane === "Friend" ? ({ rules: ({ utilityFloor: 300, parityBand: 100, parityFreeGap: 100, parityPenaltyPerPoint: 0, balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 3, searchLimit: 12, searchBudget: 600, circleMinimum: 3, circleMaximum: 6, circlePairFloor: 350 } as LaneLimits) : lane === "Date" ? ({ rules: ({ utilityFloor: 350, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 10, balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 2, searchLimit: 10, searchBudget: 600, circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0 } as LaneLimits) : lane === "Cofounder" ? ({ rules: ({ utilityFloor: 400, parityBand: 20, parityFreeGap: 8, parityPenaltyPerPoint: 10, balanceRequired: true, exchangeFloor: 200, balanceTolerancePercent: 50 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 2, searchLimit: 10, searchBudget: 600, circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0 } as LaneLimits) : lane === "Intro" ? ({ rules: ({ utilityFloor: 350, parityBand: 20, parityFreeGap: 8, parityPenaltyPerPoint: 10, balanceRequired: true, exchangeFloor: 200, balanceTolerancePercent: 50 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 3, searchLimit: 12, searchBudget: 600, circleMinimum: 3, circleMaximum: 6, circlePairFloor: 400 } as LaneLimits) : lane === "Hire" ? ({ rules: ({ utilityFloor: 400, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 15, balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 3, searchLimit: 10, searchBudget: 600, circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0 } as LaneLimits) : lane === "Mentor" ? ({ rules: ({ utilityFloor: 350, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 10, balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 } as pairValue_PairRules), standingOffset: 25, weeklyCapacity: 2, searchLimit: 8, searchBudget: 400, circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0 } as LaneLimits) : ({ rules: ({ utilityFloor: 400, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 15, balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 } as pairValue_PairRules), standingOffset: 0, weeklyCapacity: 2, searchLimit: 8, searchBudget: 400, circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0 } as LaneLimits);
}

/** Story: Peers meet as equals / Every lane keeps its rules and bounds in one table (spec/matchLane.md:47) */
//@ pure
export function lawLaneLimitsWellFormed(lane: MatchLane): boolean {
  //@ ensures \result === true
  const local_0: LaneLimits = laneLimits(lane);
  const local_1: pairValue_PairRules = local_0.rules;
  return 0 <= local_1.utilityFloor && local_1.utilityFloor <= pairValue_pairValueScale && 0 <= local_1.exchangeFloor && local_1.exchangeFloor <= pairValue_pairValueScale && (!local_1.balanceRequired || local_1.exchangeFloor > 0) && 0 <= local_1.balanceTolerancePercent && local_1.balanceTolerancePercent <= 100 && 0 <= local_1.parityFreeGap && local_1.parityFreeGap <= local_1.parityBand && local_1.parityBand <= standingCeiling && 0 <= local_1.parityPenaltyPerPoint && 0 <= local_0.standingOffset && local_0.standingOffset <= standingCeiling && local_0.weeklyCapacity > 0 && local_0.searchLimit > 0 && local_0.searchBudget > 0 && local_0.searchLimit <= local_0.searchBudget && ((local_0.circleMinimum === 0 && local_0.circleMaximum === 0 && local_0.circlePairFloor === 0) || (3 <= local_0.circleMinimum && local_0.circleMinimum <= local_0.circleMaximum && local_0.circleMaximum <= 6 && 0 < local_0.circlePairFloor && local_0.circlePairFloor <= pairValue_pairValueScale));
}

/** Story: Peers meet as equals / Each lane weighs the four utility terms (spec/matchLane.md:147) */
//@ pure
export function laneWeights(lane: MatchLane): LaneWeights {
  return lane === "Friend" ? ({ complement: 1, affinity: 6, closeness: 2, pack: 1 } as LaneWeights) : lane === "Date" ? ({ complement: 3, affinity: 2, closeness: 2, pack: 3 } as LaneWeights) : lane === "Cofounder" ? ({ complement: 5, affinity: 2, closeness: 2, pack: 1 } as LaneWeights) : lane === "Intro" ? ({ complement: 6, affinity: 2, closeness: 1, pack: 1 } as LaneWeights) : lane === "Hire" ? ({ complement: 6, affinity: 1, closeness: 2, pack: 1 } as LaneWeights) : lane === "Mentor" ? ({ complement: 5, affinity: 3, closeness: 1, pack: 1 } as LaneWeights) : ({ complement: 6, affinity: 2, closeness: 1, pack: 1 } as LaneWeights);
}

/** Story: Peers meet as equals / Each lane weighs the four utility terms (spec/matchLane.md:147) */
//@ pure
export function lawLaneWeightsWellFormed(lane: MatchLane): boolean {
  //@ ensures \result === true
  const local_2: LaneWeights = laneWeights(lane);
  return 0 <= local_2.complement && 0 <= local_2.affinity && 0 <= local_2.closeness && 0 <= local_2.pack && exact_matchLane(exact_matchLane(exact_matchLane(local_2.complement + local_2.affinity) + local_2.closeness) + local_2.pack) > 0;
}

/** Story: Two sides meet across a role / The offering side sits above the seeking side by the lane's offset (spec/matchLane.md:193) */
//@ pure
export function laneOffset(lane: MatchLane, side: LaneSide): number {
  const local_3 = laneLimits(lane).standingOffset;
  return side === "Offering" ? local_3 : (side === "Seeking" ? exact_matchLane(0 - local_3) : 0);
}

/** Story: Two sides meet across a role / The offering side sits above the seeking side by the lane's offset (spec/matchLane.md:193) */
//@ pure
export function lawLaneOffsetAntisymmetric(lane: MatchLane, laneNearRole: LaneSide, laneFarRole: LaneSide): boolean {
  //@ ensures \result === true
  return !laneSidesCompatible(lane, laneNearRole, laneFarRole) || laneOffset(lane, laneNearRole) === exact_matchLane(0 - laneOffset(lane, laneFarRole));
}

/** Story: Two sides meet across a role / A lane pair value is the same from both sides (spec/matchLane.md:207) */
//@ pure
export function lanePairValue(lane: MatchLane, side: pairValue_PairSide, sideRole: LaneSide, other: pairValue_PairSide, otherRole: LaneSide): number {
  return laneSidesCompatible(lane, sideRole, otherRole) ? pairValue_pairValue(side, other, laneOffset(lane, sideRole), laneLimits(lane).rules) : pairValue_noPairValue;
}

/** Story: Two sides meet across a role / A lane pair value is the same from both sides (spec/matchLane.md:207) */
//@ pure
export function lawLanePairValueSymmetric(lane: MatchLane, laneNear: pairValue_PairSide, laneNearRole: LaneSide, laneFar: pairValue_PairSide, laneFarRole: LaneSide): boolean {
  //@ ensures \result === true
  return lanePairValue(lane, laneNear, laneNearRole, laneFar, laneFarRole) === lanePairValue(lane, laneFar, laneFarRole, laneNear, laneNearRole);
}

/** Story: Each app offers its own lanes / Each app offers a fixed set of lanes (spec/matchLane.md:238) */
//@ pure
export function laneOffered(app: string, lane: MatchLane): boolean {
  return lane === "Friend" ? app === "friends" || app === "ntwrk" : lane === "Date" ? app === "slop" : lane === "Cofounder" ? app === "peon" || app === "ntwrk" : lane === "Intro" ? app === "ntwrk" : lane === "Hire" ? app === "peon" : lane === "Mentor" ? app === "ntwrk" : app === "ntwrk";
}

/** Story: Each app offers its own lanes / Each app offers a fixed set of lanes (spec/matchLane.md:238) */
//@ pure
export function lawEveryAppHasALane(app: string): boolean {
  //@ ensures \result === true
  return !(app === "ntwrk" || app === "slop" || app === "peon" || app === "friends") || (laneOffered(app, "Friend") || laneOffered(app, "Date") || laneOffered(app, "Cofounder") || laneOffered(app, "Intro") || laneOffered(app, "Hire") || laneOffered(app, "Mentor") || laneOffered(app, "Invest"));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_matchLane(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
