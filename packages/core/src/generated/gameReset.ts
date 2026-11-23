// GENERATED from spec/gameReset.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Reset a simulation during an active step / Release the pending replies and drain the step before publishing the replacement (spec/gameReset.md) */
//@ pure
export function gameResetControlsAllowed(draining: boolean, sameWorld: boolean): boolean {
  return !draining && sameWorld;
}

/** Story: Reset a simulation during an active step / Release the pending replies and drain the step before publishing the replacement (spec/gameReset.md) */
//@ pure
export function lawOldGameControlCannotReachReplacement(draining: boolean): boolean {
  //@ ensures \result === true
  return !gameResetControlsAllowed(draining, false);
}
