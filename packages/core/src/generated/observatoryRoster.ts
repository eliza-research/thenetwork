// GENERATED from spec/observatoryRoster.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function replacementRosterMode(recordedRoster: boolean, outgoingSeat: boolean, incomingAlreadyListed: boolean): string {
  return recordedRoster ? "recorded" : (outgoingSeat ? "substitute" : (incomingAlreadyListed ? "retain" : "append"));
}

/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function lawReplacementPrefersRecorded(outgoingSeat: boolean, incomingAlreadyListed: boolean): boolean {
  //@ ensures \result === true
  return replacementRosterMode(true, outgoingSeat, incomingAlreadyListed) === "recorded";
}

/** Story: F35 — Inspect a member's experience as staff / A replacement uses the Network's recorded roster (spec/observatoryRoster.md) */
//@ pure
export function lawLegacyBackfillAddsOnce(incomingAlreadyListed: boolean): boolean {
  //@ ensures \result === true
  return replacementRosterMode(false, false, incomingAlreadyListed) === (incomingAlreadyListed ? "retain" : "append");
}

/** Story: F35 — Inspect a member's experience as staff / A probe closure keeps the final alternate evidence (spec/observatoryRoster.md) */
//@ pure
export function closedProbeUpdate(terminal: boolean, recordedAlternates: boolean): boolean {
  return !terminal || recordedAlternates;
}

/** Story: F35 — Inspect a member's experience as staff / A probe closure keeps the final alternate evidence (spec/observatoryRoster.md) */
//@ pure
export function lawClosedReplayWithoutRosterKeepsTerminal(terminal: boolean): boolean {
  //@ ensures \result === true
  return closedProbeUpdate(terminal, false) === !terminal;
}
