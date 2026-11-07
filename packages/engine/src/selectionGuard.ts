// The last check on a run's selection (engine.ts), proved with LemmaScript. It runs on the output of
// ANY selector: the core greedy pass or a pack's `selection.assign` hook. Each pick that would break
// a rule is withheld (fail closed). For the core greedy pass nothing is ever dropped: `selectOnce`
// checks the same rules first.
// Import-free: the engine maps its Selected list to these records and back by `index`.

export interface SelectionPick { index: number; participants: string[]; alternates: string[]; via: string | undefined; city: string }
export interface GuardDrop { index: number; reason: string }
export interface GuardResult { kept: SelectionPick[]; dropped: GuardDrop[] }

/** True if the pick touches a minor (or an unknown age) in any role: participant, alternate or via. */
export function touchesMinor(p: SelectionPick, minor: (id: string) => boolean): boolean {
  //@ verify
  //@ ensures !\result ==> forall(i: nat, i < p.participants.length ==> !minor(p.participants[i]))
  //@ ensures !\result ==> forall(i: nat, i < p.alternates.length ==> !minor(p.alternates[i]))
  //@ ensures !\result && p.via !== undefined ==> !minor(p.via)
  if (p.participants.some(id => minor(id)) || p.alternates.some(id => minor(id))) return true;
  return p.via !== undefined ? minor(p.via) : false;
}

/** How many of the first `n` picks have this member as a participant. */
export function countIn(out: SelectionPick[], id: string, n: number): number {
  //@ verify
  //@ type n nat
  //@ requires n <= out.length
  //@ decreases n
  return n === 0 ? 0 : (out[n - 1]!.participants.includes(id) ? 1 : 0) + countIn(out, id, n - 1);
}

/** How many of the first `n` picks are in this city. */
export function cityCount(out: SelectionPick[], city: string, n: number): number {
  //@ verify
  //@ type n nat
  //@ requires n <= out.length
  //@ decreases n
  return n === 0 ? 0 : (out[n - 1]!.city === city ? 1 : 0) + cityCount(out, city, n - 1);
}

/** True if two different members are participants of both picks. */
export function repeatsPair(a: SelectionPick, b: SelectionPick): boolean {
  //@ verify
  //@ ensures !\result ==> forall(x: string, forall(y: string, x !== y && a.participants.includes(x) && a.participants.includes(y) ==> !(b.participants.includes(x) && b.participants.includes(y))))
  return a.participants.some(x => a.participants.some(y => x !== y && b.participants.includes(x) && b.participants.includes(y)));
}

/** Why `p` cannot join the picks in `out` (null = it can). */
export function dropReason(out: SelectionPick[], p: SelectionPick, allow: (id: string) => number, cityCap: number, minor: (id: string) => boolean): string | null {
  //@ verify
  //@ ensures \result === null ==> !touchesMinor(p, minor)
  //@ ensures \result === null ==> cityCount(out, p.city, out.length) + 1 <= cityCap
  //@ ensures \result === null ==> forall(id: string, p.participants.includes(id) ==> countIn(out, id, out.length) + 1 <= allow(id))
  //@ ensures \result === null ==> forall(i: nat, i < out.length ==> !repeatsPair(p, out[i]))
  if (touchesMinor(p, minor)) return "underage";
  if (cityCount(out, p.city, out.length) + 1 > cityCap) return "city_cap";
  if (p.participants.some(id => countIn(out, id, out.length) + 1 > allow(id))) return "member_budget";
  if (out.some(q => repeatsPair(p, q))) return "repeated_pair";
  return null;
}

/**
 * Keep picks in order while they fit. In the result: no pick touches a minor in any role, each member
 * is within `allow`, each city is within `cityCap`, no pair repeats, and every pick came from `picks`.
 */
export function enforceSelection(picks: SelectionPick[], allow: (id: string) => number, cityCap: number, minor: (id: string) => boolean): GuardResult {
  //@ verify
  //@ ensures forall(i: nat, i < \result.kept.length ==> picks.includes(\result.kept[i]))
  //@ ensures forall(i: nat, i < \result.kept.length ==> !touchesMinor(\result.kept[i], minor))
  //@ ensures forall(i: nat, forall(id: string, i < \result.kept.length && \result.kept[i].participants.includes(id) ==> countIn(\result.kept, id, \result.kept.length) <= allow(id)))
  //@ ensures forall(i: nat, i < \result.kept.length ==> cityCount(\result.kept, \result.kept[i].city, \result.kept.length) <= cityCap)
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.kept.length ==> !repeatsPair(\result.kept[j], \result.kept[i])))
  let kept: SelectionPick[] = [];
  let dropped: GuardDrop[] = [];
  let k = 0;
  while (k < picks.length) {
    //@ type k nat
    //@ invariant k <= picks.length
    //@ invariant forall(i: nat, i < kept.length ==> picks.includes(kept[i]))
    //@ invariant forall(i: nat, i < kept.length ==> !touchesMinor(kept[i], minor))
    //@ invariant forall(i: nat, forall(id: string, i < kept.length && kept[i].participants.includes(id) ==> countIn(kept, id, kept.length) <= allow(id)))
    //@ invariant forall(i: nat, i < kept.length ==> cityCount(kept, kept[i].city, kept.length) <= cityCap)
    //@ invariant forall(i: nat, forall(j: nat, i < j && j < kept.length ==> !repeatsPair(kept[j], kept[i])))
    //@ decreases picks.length - k
    const p = picks[k]!;
    k = k + 1;
    const why = dropReason(kept, p, allow, cityCap, minor);
    if (why === null) kept = [...kept, p];
    else dropped = [...dropped, { index: p.index, reason: why }];
  }
  return { kept, dropped };
}
