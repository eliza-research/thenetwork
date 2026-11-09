// The core prefix of the hard filters (filters.ts), proved with LemmaScript. Import-free. A pack cannot
// reorder or override it: pack rules run after it, so they can only add reasons. `matchable` and
// `blocked` come from canBeMatched and the World's block index and are trusted inputs here.

export type CoreState = "open" | "normal" | "quiet" | "receiving" | "paused";

/**
 * Null means the member is matchable, at or above both age floors, not held and not paused. The age
 * tests stay negated: an unknown or NaN age makes `age >= floor` false, so it fails closed.
 */
export function memberCore(matchable: boolean, age: number, ageMin: number, packMin: number, held: boolean, state: CoreState): string | null {
  //@ verify
  //@ type age real
  //@ type ageMin real
  //@ type packMin real
  //@ ensures \result === null ==> matchable && age >= ageMin && age >= packMin && !held && state !== "paused"
  if (!matchable || !(age >= ageMin) || !(age >= packMin)) return "underage";
  if (held) return "safety_hold";
  if (state === "paused") return "state_paused";
  return null;
}

/** The judge can only remove: a configuration ineligible before it stays ineligible. */
export function eligibleAfterJudge(before: boolean, after: boolean): boolean {
  //@ verify
  //@ ensures \result === (before && after)
  return before && after;
}

/** Null means two different adults with no block in either direction. The answer does not depend on the order. */
export function pairCore(a: string, b: string, minorA: boolean, minorB: boolean, blocked: boolean): string | null {
  //@ verify
  //@ ensures \result === pairCore(b, a, minorB, minorA, blocked)
  //@ ensures \result === null ==> a !== b && !minorA && !minorB && !blocked
  if (a === b) return "duplicate_participant";
  if (minorA || minorB) return "underage";
  if (blocked) return "blocked";
  return null;
}
