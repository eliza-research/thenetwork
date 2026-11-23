// GENERATED from spec/staffHistory.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Inspect a member or opportunity after a long history / Keep history reads bounded and preserve their order (spec/staffHistory.md) */
//@ pure
export function staffHistoryPageSize(memberEvents: boolean): number {
  return memberEvents ? 5000 : 2000;
}

/** Story: Inspect a member or opportunity after a long history / Keep history reads bounded and preserve their order (spec/staffHistory.md) */
//@ pure
export function staffHistoryHasEarlier(rowCount: number, memberEvents: boolean): boolean {
  return rowCount > staffHistoryPageSize(memberEvents);
}

/** Story: Inspect a member or opportunity after a long history / Keep history reads bounded and preserve their order (spec/staffHistory.md) */
//@ pure
export function lawStaffHistoryMayUseOneLookahead(memberEvents: boolean): boolean {
  //@ ensures \result === true
  return staffHistoryHasEarlier(exact_staffHistory(staffHistoryPageSize(memberEvents) + 1), memberEvents);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_staffHistory(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
