// GENERATED from spec/reviewDeadline.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Act on a proposal while review is open / An opportunity expires at its review deadline (spec/reviewDeadline.md:7) */
//@ pure
export function reviewLate(currentTime: number, deadline: number): boolean {
  return currentTime >= deadline;
}

/** Story: Act on a proposal while review is open / An opportunity expires at its review deadline (spec/reviewDeadline.md:7) */
//@ pure
export function lawReviewDeadlineIsExclusive(deadline: number): boolean {
  //@ ensures \result === true
  return reviewLate(deadline, deadline);
}

/** Story: Act on a proposal while review is open / A decision applies only to the revision the reviewer saw (spec/reviewDeadline.md:19) */
//@ pure
export function reviewRevisionCurrent(seenRevision: number, currentRevision: number): boolean {
  return seenRevision === currentRevision;
}

/** Story: Act on a proposal while review is open / A decision applies only to the revision the reviewer saw (spec/reviewDeadline.md:19) */
//@ pure
export function lawSeenReviewRevisionIsCurrent(revision: number): boolean {
  //@ ensures \result === true
  return reviewRevisionCurrent(revision, revision);
}

/** Story: Act on a proposal while review is open / A decision applies only to the revision the reviewer saw (spec/reviewDeadline.md:19) */
//@ pure
export function lawRerolledReviewIsStale(seenRevision: number): boolean {
  //@ ensures \result === true
  return !reviewRevisionCurrent(seenRevision, exact_reviewDeadline(seenRevision + 1));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_reviewDeadline(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
