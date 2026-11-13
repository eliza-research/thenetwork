// GENERATED from spec/reviewDeadline.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
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
