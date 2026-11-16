// GENERATED from spec/matchingBudgets.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Respect a member's participation limits / The limit includes use already reserved for the decision (spec/matchingBudgets.md:9) */
//@ pure
export function budgetReached(used: number, extra: number, limit: number): boolean {
  return exact_matchingBudgets(used + extra) >= limit;
}

/** Story: Respect a member's participation limits / The limit includes use already reserved for the decision (spec/matchingBudgets.md:9) */
//@ pure
export function lawBudgetHeld(used: number, extra: number, limit: number): boolean {
  //@ ensures \result === true
  return !(!budgetReached(used, extra, limit)) || exact_matchingBudgets(used + extra) < limit;
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function inCooldown(now: number, has: boolean, at: number, window: number): boolean {
  return has && exact_matchingBudgets(now - at) < window;
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function lawCategoryCooldownHeld(now: number, has: boolean, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(has && exact_matchingBudgets(now - at) < window) || inCooldown(now, has, at, window);
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function lawCooldownEndsAtWindow(now: number, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(exact_matchingBudgets(now - at) >= window) || !inCooldown(now, true, at, window);
}

/** Story: Wait after a decline or negative feedback / A recent decline, expiry, or cancellation blocks another pair proposal (spec/matchingBudgets.md:39) */
//@ pure
export function pairInteractionCooling(disposition: string, now: number, at: number, window: number): boolean {
  return (disposition === "declined" || disposition === "expired" || disposition === "cancelled") && inCooldown(now, true, at, window);
}

/** Story: Wait after a decline or negative feedback / A recent decline, expiry, or cancellation blocks another pair proposal (spec/matchingBudgets.md:39) */
//@ pure
export function lawPairCooldownHeld(now: number, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(exact_matchingBudgets(now - at) < window) || (pairInteractionCooling("declined", now, at, window) && pairInteractionCooling("expired", now, at, window) && pairInteractionCooling("cancelled", now, at, window));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_matchingBudgets(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
