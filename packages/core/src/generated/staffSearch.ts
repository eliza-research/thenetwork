// GENERATED from spec/staffSearch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Find recent eligible conversation and system evidence / Apply the result limit after checking visibility and rendered text (spec/staffSearch.md) */
//@ pure
export function staffSearchHitVisible(canReadSource: boolean, matchesRendered: boolean): boolean {
  return canReadSource && matchesRendered;
}

/** Story: Find recent eligible conversation and system evidence / Apply the result limit after checking visibility and rendered text (spec/staffSearch.md) */
//@ pure
export function lawHiddenSourceCannotMatch(matchesRendered: boolean): boolean {
  //@ ensures \result === true
  return !staffSearchHitVisible(false, matchesRendered);
}
