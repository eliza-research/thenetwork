// The one key for a pair of members (world.ts). Blocks, cooldowns and used pairs all use it, so the
// order of the two ids must not matter. Proved with LemmaScript. Import-free.

/** The pair's key, smaller id first. */
export function pairKey(a: string, b: string): string {
  //@ verify
  //@ ensures \result === pairKey(b, a)
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
