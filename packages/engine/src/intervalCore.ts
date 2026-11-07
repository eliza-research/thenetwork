// Interval arithmetic (interval.ts), proved with LemmaScript over records. Import-free. Presence
// overlap (ME-011) rests on these two steps.

export interface Span { s: number; e: number }

/** True if `x` lies inside one of the intervals. */
export function insideOne(a: Span[], x: Span): boolean {
  //@ verify
  return a.some(y => y.s <= x.s && x.e <= y.e);
}

/** `a` without the span [s, e). The parts are not empty, avoid the span, and lie inside an input interval. */
export function subtractSpan(a: Span[], s: number, e: number): Span[] {
  //@ verify
  //@ requires s < e
  //@ requires forall(i: nat, i < a.length ==> a[i].s < a[i].e)
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].s < \result[i].e)
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].e <= s || \result[i].s >= e)
  //@ ensures forall(i: nat, i < \result.length ==> insideOne(a, \result[i]))
  let out: Span[] = [];
  let k = 0;
  while (k < a.length) {
    //@ type k nat
    //@ invariant k <= a.length
    //@ invariant forall(i: nat, i < out.length ==> out[i].s < out[i].e)
    //@ invariant forall(i: nat, i < out.length ==> out[i].e <= s || out[i].s >= e)
    //@ invariant forall(i: nat, i < out.length ==> insideOne(a, out[i]))
    //@ decreases a.length - k
    const iv = a[k]!;
    k = k + 1;
    if (e <= iv.s || s >= iv.e) { out = [...out, iv]; continue; }
    if (s > iv.s) out = [...out, { s: iv.s, e: s }];
    if (e < iv.e) out = [...out, { s: e, e: iv.e }];
  }
  return out;
}

/** Merge intervals sorted by start. The result is sorted, and two intervals never touch or overlap. */
export function mergeSorted(ivs: Span[]): Span[] {
  //@ verify
  //@ requires forall(i: nat, i < ivs.length ==> ivs[i].s <= ivs[i].e)
  //@ requires forall(i: nat, forall(j: nat, i < j && j < ivs.length ==> ivs[i].s <= ivs[j].s))
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].s <= \result[i].e)
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.length ==> \result[i].e < \result[j].s))
  let out: Span[] = [];
  let k = 0;
  while (k < ivs.length) {
    //@ type k nat
    //@ invariant k <= ivs.length
    //@ invariant forall(i: nat, i < out.length ==> out[i].s <= out[i].e)
    //@ invariant forall(i: nat, forall(j: nat, i < j && j < out.length ==> out[i].e < out[j].s))
    //@ invariant forall(i: nat, i < out.length ==> forall(j: nat, k <= j && j < ivs.length ==> out[i].s <= ivs[j].s))
    //@ decreases ivs.length - k
    const iv = ivs[k]!;
    k = k + 1;
    const n = out.length;
    if (n > 0 && iv.s <= out[n - 1]!.e) {
      const last = out[n - 1]!;
      out = [...out.slice(0, n - 1), { s: last.s, e: Math.max(last.e, iv.e) }];
    } else out = [...out, { s: iv.s, e: iv.e }];
  }
  return out;
}
