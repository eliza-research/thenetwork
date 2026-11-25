// GENERATED from spec/postingPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md) */
export const maxOpenings: number = 50;

/** Story: Only the manager's own text controls a job posting / Only the member's own text in the thread issues a command (spec/postingPolicy.md) */
//@ pure
export function inboundMayCommand(source: string): boolean {
  return source === "thread";
}

/** Story: Only the manager's own text controls a job posting / Only the member's own text in the thread issues a command (spec/postingPolicy.md) */
//@ pure
export function lawAssistantProfileNeverCommands(source: string): boolean {
  //@ ensures \result === true
  return !inboundMayCommand(source) || source !== "mcp";
}

/** Story: Publish a job with a clear pay range / Job drafts need a title and pay range before read-back (spec/postingPolicy.md) */
//@ pure
export function missingPostingFields(isClose: boolean, hasTitle: boolean, hasPay: boolean): string[] {
  return isClose ? ([] as string[]) : (hasTitle ? (hasPay ? ([] as string[]) : (["pay"] as string[])) : (hasPay ? (["title"] as string[]) : (["title", "pay"] as string[])));
}

/** Story: Publish a job with a clear pay range / A post with a workplace needs a supported area (spec/postingPolicy.md) */
//@ pure
export function postingNeedsArea(isClose: boolean, remote: boolean, hasArea: boolean): boolean {
  return !(isClose || remote || hasArea);
}

/** Story: Publish a job with a clear pay range / A post with a workplace needs a supported area (spec/postingPolicy.md) */
//@ pure
export function lawOnsiteDraftWithoutAreaNeedsAnswer(isClose: boolean, remote: boolean): boolean {
  //@ ensures \result === true
  return postingNeedsArea(isClose, remote, false) === !(isClose || remote);
}

/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md) */
//@ pure
export function openingsInRange(openings: number): boolean {
  return openings >= 1 && openings <= maxOpenings;
}

/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md) */
//@ pure
export function openingCountNeedsCorrection(isClose: boolean, supplied: boolean, openings: number): boolean {
  return !isClose && supplied && !openingsInRange(openings);
}

/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md) */
//@ pure
export function lawOmittedCountUsesDefault(isClose: boolean, openings: number): boolean {
  //@ ensures \result === true
  return !openingCountNeedsCorrection(isClose, false, openings);
}

/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md) */
//@ pure
export function lawInvalidStatedCountNeedsCorrection(openings: number): boolean {
  //@ ensures \result === true
  return !(!openingsInRange(openings)) || openingCountNeedsCorrection(false, true, openings);
}

/** Story: Publish a job with a clear pay range / The low end of the pay range comes first (spec/postingPolicy.md) */
//@ pure
export function payRangeAllowed(low: number, high: number): boolean {
  return low >= 10 && high >= low && high <= 999;
}

/** Story: Publish a job with a clear pay range / The low end of the pay range comes first (spec/postingPolicy.md) */
//@ pure
export function lawPayRangeIsOrdered(low: number, high: number): boolean {
  //@ ensures \result === true
  return !payRangeAllowed(low, high) || low <= high;
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md) */
//@ pure
export function confirmPosting(ready: boolean, affirmative: boolean, edited: boolean, revisionMatches: boolean): boolean {
  return ready && affirmative && !edited && revisionMatches;
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md) */
//@ pure
export function lawEditedPostingNeedsReadback(ready: boolean, affirmative: boolean, revisionMatches: boolean): boolean {
  //@ ensures \result === true
  return !confirmPosting(ready, affirmative, true, revisionMatches);
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md) */
//@ pure
export function lawStalePostingCannotBeConfirmed(ready: boolean, affirmative: boolean, edited: boolean): boolean {
  //@ ensures \result === true
  return !confirmPosting(ready, affirmative, edited, false);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md) */
//@ pure
export function postingDraftCurrent(readsSavedPosting: boolean, storedExists: boolean, storedOpen: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  return readsSavedPosting ? storedExists && storedOpen && storedUnchanged : !storedExists && !isClose;
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md) */
//@ pure
export function lawClosedPostingIsNeverCurrent(readsSavedPosting: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(readsSavedPosting, true, false, storedUnchanged, isClose);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md) */
//@ pure
export function lawChangedPostingIsNeverCurrent(readsSavedPosting: boolean, storedOpen: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(readsSavedPosting, true, storedOpen, false, isClose);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md) */
//@ pure
export function lawNewDraftNeverOverwrites(storedOpen: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(false, true, storedOpen, storedUnchanged, isClose);
}
