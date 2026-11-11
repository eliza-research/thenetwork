// The migration number rule as a pure function, proved with LemmaScript. This file imports nothing.

/** The first id whose 4-digit number an earlier id holds, or -1 when no two ids share one. */
export function dupAt(ids: string[]): number {
  //@ verify
  //@ requires forall(k: number, 0 <= k && k < ids.length ==> ids[k].length >= 4)
  //@ ensures \result === -1 ==> forall(a: number, forall(b: number, 0 <= a && a < b && b < ids.length ==> ids[a].slice(0, 4) !== ids[b].slice(0, 4)))
  //@ ensures \result !== -1 ==> 0 <= \result && \result < ids.length
  const seen = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    //@ invariant 0 <= i && i <= ids.length
    //@ invariant forall(k: number, 0 <= k && k < i ==> seen.has(ids[k].slice(0, 4)))
    //@ invariant forall(a: number, forall(b: number, 0 <= a && a < b && b < i ==> ids[a].slice(0, 4) !== ids[b].slice(0, 4)))
    //@ decreases ids.length - i
    const n = ids[i].slice(0, 4);
    if (seen.has(n)) return i;
    seen.set(n, ids[i]);
  }
  return -1;
}
