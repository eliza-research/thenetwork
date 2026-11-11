// The one key for a pair of members (world.ts). Blocks, cooldowns and used pairs all use it, so the
// order of the two ids must not matter, and two different pairs must never share a key. Proved with
// LemmaScript. Import-free.

/** An id that may go into a pair key: it does not hold the separator. World build refuses any other member id. */
export function keyableId(id: string): boolean {
  //@ verify
  return !id.includes("|");
}

/**
 * The pair's key, smaller id first. When `a` and `b` are keyable, no other pair of ids has this key
 * (the other two ids need no rule: a key with a second separator is never equal to it).
 */
export function pairKey(a: string, b: string): string {
  //@ verify
  //@ ensures \result === pairKey(b, a)
  //@ ensures forall(c: string, forall(d: string, keyableId(a) && keyableId(b) && \result === pairKey(c, d) ==> (a === c && b === d) || (a === d && b === c)))
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
