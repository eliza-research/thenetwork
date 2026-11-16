// GENERATED from spec/reviewDeadline.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Act on a proposal while review is open / An opportunity expires at its review deadline (spec/reviewDeadline.md) */
//@ pure
export function reviewLate(currentTime: number, deadline: number): boolean {
  return currentTime >= deadline;
}

/** Story: Act on a proposal while review is open / An opportunity expires at its review deadline (spec/reviewDeadline.md) */
//@ pure
export function lawReviewDeadlineIsExclusive(deadline: number): boolean {
  //@ ensures \result === true
  return reviewLate(deadline, deadline);
}
