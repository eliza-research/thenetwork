// GENERATED from spec/postingPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md:19) */
export const maxOpenings: number = 50;

/** Story: Publish a job with a clear pay range / Job drafts need a title and pay range before read-back (spec/postingPolicy.md:7) */
//@ pure
export function missingPostingFields(isClose: boolean, hasTitle: boolean, hasPay: boolean): string[] {
  return isClose ? ([] as string[]) : (hasTitle ? (hasPay ? ([] as string[]) : (["pay"] as string[])) : (hasPay ? (["title"] as string[]) : (["title", "pay"] as string[])));
}

/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md:19) */
//@ pure
export function openingsInRange(openings: number): boolean {
  return openings >= 1 && openings <= maxOpenings;
}

/** Story: Publish a job with a clear pay range / The low end of the pay range comes first (spec/postingPolicy.md:30) */
//@ pure
export function payRangeAllowed(low: number, high: number): boolean {
  return low >= 10 && high >= low && high <= 999;
}

/** Story: Publish a job with a clear pay range / The low end of the pay range comes first (spec/postingPolicy.md:30) */
//@ pure
export function lawPayRangeIsOrdered(low: number, high: number): boolean {
  //@ ensures \result === true
  return !payRangeAllowed(low, high) || low <= high;
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md:42) */
//@ pure
export function confirmPosting(ready: boolean, affirmative: boolean, edited: boolean, revisionMatches: boolean): boolean {
  return ready && affirmative && !edited && revisionMatches;
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md:42) */
//@ pure
export function lawEditedPostingNeedsReadback(ready: boolean, affirmative: boolean, revisionMatches: boolean): boolean {
  //@ ensures \result === true
  return !confirmPosting(ready, affirmative, true, revisionMatches);
}

/** Story: Publish a job with a clear pay range / Confirm only the posting shown in the read-back (spec/postingPolicy.md:42) */
//@ pure
export function lawStalePostingCannotBeConfirmed(ready: boolean, affirmative: boolean, edited: boolean): boolean {
  //@ ensures \result === true
  return !confirmPosting(ready, affirmative, edited, false);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md:57) */
//@ pure
export function postingDraftCurrent(readsSavedPosting: boolean, storedExists: boolean, storedOpen: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  return readsSavedPosting ? storedExists && storedOpen && storedUnchanged : !storedExists && !isClose;
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md:57) */
//@ pure
export function lawClosedPostingIsNeverCurrent(readsSavedPosting: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(readsSavedPosting, true, false, storedUnchanged, isClose);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md:57) */
//@ pure
export function lawChangedPostingIsNeverCurrent(readsSavedPosting: boolean, storedOpen: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(readsSavedPosting, true, storedOpen, false, isClose);
}

/** Story: Publish a job with a clear pay range / A stale yes never reopens or overwrites a posting that staff changed or closed (spec/postingPolicy.md:57) */
//@ pure
export function lawNewDraftNeverOverwrites(storedOpen: boolean, storedUnchanged: boolean, isClose: boolean): boolean {
  //@ ensures \result === true
  return !postingDraftCurrent(false, true, storedOpen, storedUnchanged, isClose);
}
