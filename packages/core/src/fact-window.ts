// The sliding window of the fuzzy fact check (guard.ts), proved with LemmaScript
// (docs/formal-verification.md). A private fact leaks when one window of the text holds enough of the
// fact's distinct words. The proof in proofs/ says the loop answers exactly that, for every window,
// so a counting slip cannot let a leak through. guard.ts maps the words to ids and trusts that step.

/**
 * True when some run of at most `window` tokens that ends in the list holds `need` or more distinct
 * wanted ids. `ids[i]` is the id of token i, from 0 up to `zeros.length`, or -1 for a word the fact
 * does not have. `zeros` holds one 0 per wanted id, and the function uses it as its count table.
 */
export function windowHit(ids: number[], zeros: number[], need: number, window: number): boolean {
  //@ verify
  //@ requires window >= 1
  //@ requires forall(i: nat, i < ids.length ==> ids[i] >= -1 && ids[i] < zeros.length)
  //@ requires forall(i: nat, i < zeros.length ==> zeros[i] === 0)
  let counts = zeros;
  let distinct = 0;
  let i = 0;
  while (i < ids.length) {
    //@ invariant 0 <= i && i <= ids.length
    //@ invariant counts.length === zeros.length
    //@ decreases ids.length - i
    const add = ids[i];
    if (add >= 0) {
      if (counts[add] === 0) distinct = distinct + 1;
      counts[add] = counts[add] + 1;
    }
    if (i - window >= 0) {
      const drop = ids[i - window];
      if (drop >= 0) {
        counts[drop] = counts[drop] - 1;
        if (counts[drop] === 0) distinct = distinct - 1;
      }
    }
    if (distinct >= need) return true;
    i = i + 1;
  }
  return false;
}
