// GENERATED from spec/emptyIntentFollowup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Hear when nothing fits yet / Explain an empty search after its configured wait (spec/emptyIntentFollowup.md) */
//@ pure
export function emptyIntentFollowupReasonAllowed(reason: string): boolean {
  return reason === "no_candidates" || reason === "density_gap" || reason === "below_threshold" || reason === "filtered";
}

/** Story: Hear when nothing fits yet / A pending follow-up uses current permission and the same live statement (spec/emptyIntentFollowup.md) */
//@ pure
export function emptyIntentFollowupReady(liveStatement: boolean, eligible: boolean, categoryAllowed: boolean, quietConversation: boolean, sameSearchDay: boolean, alreadyReported: boolean): boolean {
  return liveStatement && eligible && categoryAllowed && quietConversation && sameSearchDay && !alreadyReported;
}

/** Story: Hear when nothing fits yet / A pending follow-up uses current permission and the same live statement (spec/emptyIntentFollowup.md) */
//@ pure
export function lawReportedIntentDoesNotRepeat(liveStatement: boolean, eligible: boolean, categoryAllowed: boolean, quietConversation: boolean, sameSearchDay: boolean): boolean {
  //@ ensures \result === true
  return !emptyIntentFollowupReady(liveStatement, eligible, categoryAllowed, quietConversation, sameSearchDay, true);
}
