//@ backend dafny
// The label tool's decisions on flagged photos and undo. Proved with LemmaScript
// (docs/formal-verification.md). No imports: build.ts inlines this file in index.html, which must
// stay one file with no network access. Keep this file free of URLs and of network calls.

export interface Pair { a: string; b: string; dim: string }
/** One line of the labels file: isFlag is true for a flag line, and flag then is the photo id. */
export interface Line { isFlag: boolean; flag: string }

function hasFlag(p: Pair, flagged: string[]): boolean {
  //@ verify
  return flagged.includes(p.a) || flagged.includes(p.b);
}

/** The same two photos on the same question, on either side. */
function samePair(x: Pair, y: Pair): boolean {
  //@ verify
  return x.dim === y.dim && ((x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a));
}

/** The first plan row at or after start with no flagged photo, or an index past the plan. */
export function planNext(plan: Pair[], start: number, flagged: string[]): number {
  //@ verify
  //@ requires 0 <= start
  //@ ensures \result >= start
  //@ ensures \result >= plan.length || !hasFlag(plan[\result], flagged)
  //@ ensures forall(k: nat, start <= k && k < \result && k < plan.length ==> hasFlag(plan[k], flagged))
  let i = start;
  while (i < plan.length) {
    //@ invariant i >= start
    //@ invariant forall(k: nat, start <= k && k < i && k < plan.length ==> hasFlag(plan[k], flagged))
    //@ decreases plan.length - i
    if (!hasFlag(plan[i], flagged)) return i;
    i = i + 1;
  }
  return i;
}

/** The earlier pairs that may repeat: every pair with no flagged photo. */
export function repeatPool(history: Pair[], flagged: string[]): Pair[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> !hasFlag(\result[k], flagged) && history.includes(\result[k]))
  //@ ensures forall(k: nat, k < history.length && !hasFlag(history[k], flagged) ==> \result.includes(history[k]))
  return history.filter(h => !hasFlag(h, flagged));
}

/** The photo ids of all flag lines. */
export function flagsOf(lines: Line[]): string[] {
  //@ verify
  //@ ensures forall(k: nat, k < lines.length && lines[k].isFlag ==> \result.includes(lines[k].flag))
  //@ ensures forall(k: nat, k < \result.length ==> exists(j: nat, j < lines.length && lines[j].isFlag && lines[j].flag === \result[k]))
  return lines.filter(l => l.isFlag).map(l => l.flag);
}

/** The photo ids that may still be shown. */
export function resumeIds(ids: string[], flagged: string[]): string[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> !flagged.includes(\result[k]) && ids.includes(\result[k]))
  //@ ensures forall(k: nat, k < ids.length && !flagged.includes(ids[k]) ==> \result.includes(ids[k]))
  return ids.filter(x => !flagged.includes(x));
}

function lastAnswer(lines: Line[], n: number): number {
  //@ verify
  //@ requires 0 <= n && n <= lines.length
  //@ decreases n
  return n === 0 ? -1 : !lines[n - 1].isFlag ? n - 1 : lastAnswer(lines, n - 1);
}

/** The line that undo removes: the last answer, never a flag. -1 when there is no answer. */
export function undoIndex(lines: Line[]): number {
  //@ verify
  //@ ensures \result >= -1 && \result < lines.length
  //@ ensures \result >= 0 ==> !lines[\result].isFlag
  //@ ensures forall(k: nat, k > \result && k < lines.length ==> lines[k].isFlag)
  return lastAnswer(lines, lines.length);
}

/** The list with one element taken out. */
export function without<T>(xs: T[], i: number): T[] {
  //@ verify
  //@ requires 0 <= i && i < xs.length
  //@ ensures \result.length === xs.length - 1
  return xs.slice(0, i).concat(xs.slice(i + 1));
}

/** Undo keeps every flag, because the line that it removes is never a flag line. */
export function undoKeepsFlags(lines: Line[]): boolean {
  //@ verify
  //@ requires undoIndex(lines) >= 0 && undoIndex(lines) < lines.length
  //@ ensures flagsOf(without(lines, undoIndex(lines))) === flagsOf(lines)
  //@ ensures \result === true
  return true;
}

/** History after an undo: the pair cannot repeat. Other pairs stay. */
export function dropPair(history: Pair[], p: Pair): Pair[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> !samePair(\result[k], p) && history.includes(\result[k]))
  //@ ensures forall(k: nat, k < history.length && !samePair(history[k], p) ==> \result.includes(history[k]))
  return history.filter(h => !samePair(h, p));
}
