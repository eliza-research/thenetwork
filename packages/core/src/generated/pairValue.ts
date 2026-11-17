// GENERATED from spec/pairValue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
export interface UtilityTerm { weight: number; value: number }
/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
export interface PairSide { utility: number; standing: number; uncertainty: number; exchange: number }
/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
export interface PairRules { utilityFloor: number; parityBand: number; parityFreeGap: number; parityPenaltyPerPoint: number; balanceRequired: boolean; exchangeFloor: number; balanceTolerancePercent: number }

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
export const pairValueScale: number = 1000;
/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
export const noPairValue: number = -1;

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function utilityTermWeight(term: UtilityTerm): number {
  return term.weight > 0 ? term.weight : 0;
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function boundedValue(value: number): number {
  return value < 0 ? 0 : (value > pairValueScale ? pairValueScale : value);
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function coverageValue(hits: number, wanted: number): number {
  const local_0 = hits < 0 ? 0 : (hits > wanted ? wanted : hits);
  return wanted > 0 ? quotient_pairValue(exact_pairValue(pairValueScale * local_0), wanted) : 0;
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function directedUtility(terms: UtilityTerm[]): number {
  const local_1 = terms.reduce((total: number, term: UtilityTerm) => exact_pairValue(total + utilityTermWeight(term)), 0);
  const local_2 = terms.reduce((total: number, term: UtilityTerm) => exact_pairValue(total + exact_pairValue(utilityTermWeight(term) * boundedValue(term.value))), 0);
  return local_1 > 0 ? quotient_pairValue(local_2, local_1) : 0;
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function closenessValue(distance: number, costPerUnit: number): number {
  const local_3 = costPerUnit > 0 ? costPerUnit : 0;
  const local_4 = distance < 0 ? exact_pairValue(0 - distance) : distance;
  const local_5 = exact_pairValue(local_3 * local_4);
  return local_5 < pairValueScale ? exact_pairValue(pairValueScale - local_5) : 0;
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function lawUtilityTermsBounded(hits: number, wanted: number, distance: number, costPerUnit: number): boolean {
  //@ ensures \result === true
  const local_6 = coverageValue(hits, wanted);
  const local_7 = closenessValue(distance, costPerUnit);
  return 0 <= local_6 && local_6 <= pairValueScale && 0 <= local_7 && local_7 <= pairValueScale;
}

/** Story: Value both members get from a match / Each member's utility is a weighted mean of bounded terms (spec/pairValue.md) */
//@ pure
export function lawDirectedUtilityBounded(terms: UtilityTerm[]): boolean {
  //@ ensures \result === true
  const local_8 = directedUtility(terms);
  return 0 <= local_8 && local_8 <= pairValueScale;
}

/** Story: Value both members get from a match / The two utilities combine as an integer harmonic mean (spec/pairValue.md) */
//@ pure
export function harmonicValue(left: number, right: number): number {
  return left > 0 && right > 0 ? quotient_pairValue(exact_pairValue(exact_pairValue(2 * left) * right), exact_pairValue(left + right)) : 0;
}

/** Story: Value both members get from a match / The two utilities combine as an integer harmonic mean (spec/pairValue.md) */
//@ pure
export function lawHarmonicMonotone(left: number, raised: number, right: number): boolean {
  //@ ensures \result === true
  return !(left <= raised) || harmonicValue(left, right) <= harmonicValue(raised, right);
}

/** Story: Value both members get from a match / The two utilities combine as an integer harmonic mean (spec/pairValue.md) */
//@ pure
export function lawHarmonicBetweenSides(left: number, right: number): boolean {
  //@ ensures \result === true
  const local_9 = left < right ? left : right;
  const local_10 = left < right ? right : left;
  const local_11 = harmonicValue(left, right);
  return !(left > 0 && right > 0) || (local_9 <= local_11 && local_11 <= local_10);
}

/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
//@ pure
export function pairAdmissible(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  const local_12 = standingGap(side.standing, other.standing, offset);
  return side.utility >= rules.utilityFloor && other.utility >= rules.utilityFloor && parityAllowed(local_12, rules.parityBand, side.uncertainty, other.uncertainty) && (!rules.balanceRequired || exchangeBalanced(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent));
}

/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
//@ pure
export function pairValue(side: PairSide, other: PairSide, offset: number, rules: PairRules): number {
  const local_13 = standingGap(side.standing, other.standing, offset);
  const local_14 = exact_pairValue(harmonicValue(side.utility, other.utility) - parityPenalty(local_13, rules.parityFreeGap, rules.parityPenaltyPerPoint));
  return !pairAdmissible(side, other, offset, rules) ? noPairValue : (local_14 > 0 ? local_14 : 0);
}

/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
//@ pure
export function lawNoOneSidedPair(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  return !(pairValue(side, other, offset, rules) >= 0) || (side.utility >= rules.utilityFloor && other.utility >= rules.utilityFloor);
}

/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
//@ pure
export function lawPairValueSymmetric(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  return pairValue(side, other, offset, rules) === pairValue(other, side, exact_pairValue(0 - offset), rules);
}

/** Story: Value both members get from a match / A pair has a value only when both utilities reach the lane floor (spec/pairValue.md) */
//@ pure
export function lawPairValueBounded(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  const local_15 = pairValue(side, other, offset, rules);
  return !(0 <= side.utility && side.utility <= pairValueScale && 0 <= other.utility && other.utility <= pairValueScale) || (local_15 === noPairValue || (0 <= local_15 && local_15 <= pairValueScale));
}

/** Story: Keep a match between people of similar standing / The standing gap is measured from the intended offset (spec/pairValue.md) */
//@ pure
export function standingGap(standing: number, otherStanding: number, offset: number): number {
  const local_16 = exact_pairValue(exact_pairValue(standing - otherStanding) - offset);
  return local_16 < 0 ? exact_pairValue(0 - local_16) : local_16;
}

/** Story: Keep a match between people of similar standing / A pair is refused when the gap is wider than the band and both uncertainties (spec/pairValue.md) */
//@ pure
export function parityAllowed(gap: number, band: number, uncertainty: number, otherUncertainty: number): boolean {
  return gap <= exact_pairValue(exact_pairValue(band + uncertainty) + otherUncertainty);
}

/** Story: Keep a match between people of similar standing / A pair is refused when the gap is wider than the band and both uncertainties (spec/pairValue.md) */
//@ pure
export function lawParityHolds(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  return !(pairValue(side, other, offset, rules) >= 0) || standingGap(side.standing, other.standing, offset) <= exact_pairValue(exact_pairValue(rules.parityBand + side.uncertainty) + other.uncertainty);
}

/** Story: Keep a match between people of similar standing / Each point of gap above the free gap lowers the value (spec/pairValue.md) */
//@ pure
export function parityPenalty(gap: number, freeGap: number, penaltyPerPoint: number): number {
  const local_17 = exact_pairValue(gap - freeGap);
  const local_18 = penaltyPerPoint > 0 ? penaltyPerPoint : 0;
  return local_17 > 0 ? exact_pairValue(local_18 * local_17) : 0;
}

/** Story: Keep a match between people of similar standing / Each point of gap above the free gap lowers the value (spec/pairValue.md) */
//@ pure
export function lawSmallerGapNeverWorse(side: PairSide, other: PairSide, nearer: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  return !(nearer.utility === other.utility && pairAdmissible(side, other, offset, rules) && pairAdmissible(side, nearer, offset, rules) && standingGap(side.standing, nearer.standing, offset) <= standingGap(side.standing, other.standing, offset)) || pairValue(side, nearer, offset, rules) >= pairValue(side, other, offset, rules);
}

/** Story: Keep the exchange balanced / Where the lane requires balance, both members receive enough and nearly the same value (spec/pairValue.md) */
//@ pure
export function exchangeBalanced(given: number, received: number, floor: number, tolerancePercent: number): boolean {
  const local_19 = given > received ? exact_pairValue(given - received) : exact_pairValue(received - given);
  const local_20 = given > received ? given : received;
  return given >= floor && received >= floor && exact_pairValue(100 * local_19) <= exact_pairValue(tolerancePercent * local_20);
}

/** Story: Keep the exchange balanced / Where the lane requires balance, both members receive enough and nearly the same value (spec/pairValue.md) */
//@ pure
export function lawBalancedExchange(side: PairSide, other: PairSide, offset: number, rules: PairRules): boolean {
  //@ ensures \result === true
  return !(pairValue(side, other, offset, rules) >= 0 && rules.balanceRequired) || exchangeBalanced(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_pairValue(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_pairValue(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
