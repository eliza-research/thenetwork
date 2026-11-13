// GENERATED from spec/matchingBudgets.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny



/** Story: Respect a member's participation limits / The limit includes use already reserved for the decision (spec/matchingBudgets.md:9) */
//@ pure
export function budgetReached(used: number, extra: number, limit: number): boolean {
  return used + extra >= limit;
}

/** Story: Respect a member's participation limits / The limit includes use already reserved for the decision (spec/matchingBudgets.md:9) */
//@ pure
export function lawBudgetHeld(used: number, extra: number, limit: number): boolean {
  //@ ensures \result === true
  return !(!budgetReached(used, extra, limit)) || used + extra < limit;
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function inCooldown(now: number, has: boolean, at: number, window: number): boolean {
  return has && now - at < window;
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function lawCategoryCooldownHeld(now: number, has: boolean, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(has && now - at < window) || inCooldown(now, has, at, window);
}

/** Story: Wait after a decline or negative feedback / An applicable event blocks proposals until its cooldown ends (spec/matchingBudgets.md:24) */
//@ pure
export function lawCooldownEndsAtWindow(now: number, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(now - at >= window) || !inCooldown(now, true, at, window);
}

/** Story: Wait after a decline or negative feedback / A recent decline, expiry, or cancellation blocks another pair proposal (spec/matchingBudgets.md:39) */
//@ pure
export function pairInteractionCooling(outcome: string, now: number, at: number, window: number): boolean {
  return (outcome === "declined" || outcome === "expired" || outcome === "cancelled") && inCooldown(now, true, at, window);
}

/** Story: Wait after a decline or negative feedback / A recent decline, expiry, or cancellation blocks another pair proposal (spec/matchingBudgets.md:39) */
//@ pure
export function lawPairCooldownHeld(now: number, at: number, window: number): boolean {
  //@ ensures \result === true
  return !(now - at < window) || (pairInteractionCooling("declined", now, at, window) && pairInteractionCooling("expired", now, at, window) && pairInteractionCooling("cancelled", now, at, window));
}
