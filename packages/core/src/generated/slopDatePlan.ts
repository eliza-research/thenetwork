// GENERATED from spec/slopDatePlan.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Get a public date plan for a permitted match / Recheck both members before making a plan (spec/slopDatePlan.md) */
//@ pure
export function slopDateProfilesAllowed(distinct: boolean, bothAdult: boolean, bothOptedIn: boolean, eitherPaused: boolean): boolean {
  return distinct && bothAdult && bothOptedIn && !eitherPaused;
}

/** Story: Get a public date plan for a permitted match / Recheck both members before making a plan (spec/slopDatePlan.md) */
//@ pure
export function slopDatePairAllowed(blocked: boolean, held: boolean): boolean {
  return !(blocked || held);
}

/** Story: Get a public date plan for a permitted match / Recheck both members before making a plan (spec/slopDatePlan.md) */
//@ pure
export function lawSlopDateDoesNotPlanForYoungMembers(distinct: boolean, bothOptedIn: boolean, eitherPaused: boolean): boolean {
  //@ ensures \result === true
  return !slopDateProfilesAllowed(distinct, false, bothOptedIn, eitherPaused);
}

/** Story: Get a public date plan for a permitted match / Recheck both members before making a plan (spec/slopDatePlan.md) */
//@ pure
export function lawSlopDateBlockPreventsPlan(held: boolean): boolean {
  //@ ensures \result === true
  return !slopDatePairAllowed(true, held);
}

/** Story: Get a public date plan for a permitted match / Recheck both members before making a plan (spec/slopDatePlan.md) */
//@ pure
export function lawSlopDateHoldPreventsPlan(blocked: boolean): boolean {
  //@ ensures \result === true
  return !slopDatePairAllowed(blocked, true);
}
