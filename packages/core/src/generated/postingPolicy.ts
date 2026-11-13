// GENERATED from spec/postingPolicy.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny


/** Story: Publish a job with a clear pay range / A posting has between one and fifty openings (spec/postingPolicy.md:19) */
export const maxOpenings: number = 50;

/** Story: Publish a job with a clear pay range / Job drafts need a title and pay range before read-back (spec/postingPolicy.md:7) */
//@ pure
export function missingPostingFields(isClose: boolean, hasTitle: boolean, hasPay: boolean): string[] {
  return isClose ? ([] as string[]) : (hasTitle ? (hasPay ? ([] as string[]) : ["pay"]) : (hasPay ? ["title"] : ["title", "pay"]));
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
