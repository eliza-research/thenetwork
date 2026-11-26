// GENERATED from spec/cityTravel.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
export const maxRelaxStepMin: number = 10;

/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
//@ pure
export function isWithinTravelLimit(maxTravelMin: number, travelLimitMin: number, relaxStepMin: number): boolean {
  return travelLimitMin > 0 && relaxStepMin >= 0 && relaxStepMin <= maxRelaxStepMin && maxTravelMin >= 0 && maxTravelMin <= exact_cityTravel(travelLimitMin + relaxStepMin);
}

/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
//@ pure
export function isValidMidpoint(maxTravelMin: number, travelLimitMin: number, relaxStepMin: number): boolean {
  return isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin);
}

/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
//@ pure
export function lawRelaxStepCappedAtTen(maxTravelMin: number, travelLimitMin: number, relaxStepMin: number): boolean {
  //@ ensures \result === true
  return !isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin) || (relaxStepMin >= 0 && relaxStepMin <= maxRelaxStepMin);
}

/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
//@ pure
export function lawTravelLimitMustBePositive(maxTravelMin: number, travelLimitMin: number, relaxStepMin: number): boolean {
  //@ ensures \result === true
  return !isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin) || (travelLimitMin > 0 && maxTravelMin >= 0);
}

/** Story: Pick a fair meeting area within travel limits / Travel time must stay within the positive limit plus bounded relaxation (spec/cityTravel.md) */
//@ pure
export function lawValidMidpointRespectsMaxBound(maxTravelMin: number, travelLimitMin: number, relaxStepMin: number): boolean {
  //@ ensures \result === true
  return !isValidMidpoint(maxTravelMin, travelLimitMin, relaxStepMin) || maxTravelMin <= exact_cityTravel(travelLimitMin + maxRelaxStepMin);
}

/** Story: Pick a fair meeting area within travel limits / Midpoint cost balances worst-case fairness and average travel time (spec/cityTravel.md) */
//@ pure
export function fairMidpointCostScaled(maxTravelMin: number, meanTravelMin: number): number {
  return exact_cityTravel(exact_cityTravel(6 * maxTravelMin) + exact_cityTravel(4 * meanTravelMin));
}

/** Story: Pick a fair meeting area within travel limits / Midpoint cost balances worst-case fairness and average travel time (spec/cityTravel.md) */
//@ pure
export function lawMidpointCostNonNegative(maxTravelMin: number, meanTravelMin: number): boolean {
  //@ ensures \result === true
  return !(maxTravelMin >= 0 && meanTravelMin >= 0) || fairMidpointCostScaled(maxTravelMin, meanTravelMin) >= 0;
}

/** Story: Pick a fair meeting area within travel limits / Midpoint cost balances worst-case fairness and average travel time (spec/cityTravel.md) */
//@ pure
export function lawMidpointCostWithinMinimaxBounds(maxTravelMin: number, meanTravelMin: number): boolean {
  //@ ensures \result === true
  return !(maxTravelMin >= 0 && meanTravelMin >= 0 && meanTravelMin <= maxTravelMin) || (fairMidpointCostScaled(maxTravelMin, meanTravelMin) >= exact_cityTravel(10 * meanTravelMin) && fairMidpointCostScaled(maxTravelMin, meanTravelMin) <= exact_cityTravel(10 * maxTravelMin));
}

/** Story: Pick a fair meeting area within travel limits / Midpoint cost balances worst-case fairness and average travel time (spec/cityTravel.md) */
//@ pure
export function fairMidpointNetCostScaled(maxTravelMin: number, meanTravelMin: number, supplyBonus: number): number {
  const local_0 = exact_cityTravel(fairMidpointCostScaled(maxTravelMin, meanTravelMin) - supplyBonus);
  return local_0 < 0 ? 0 : local_0;
}

/** Story: Pick a fair meeting area within travel limits / Midpoint cost balances worst-case fairness and average travel time (spec/cityTravel.md) */
//@ pure
export function lawMidpointNetCostNonNegative(maxTravelMin: number, meanTravelMin: number, supplyBonus: number): boolean {
  //@ ensures \result === true
  return fairMidpointNetCostScaled(maxTravelMin, meanTravelMin, supplyBonus) >= 0;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_cityTravel(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
