// The decision step of parseReply (replies.ts), proved with LemmaScript (docs/formal-verification.md).
// replies.ts reads the text into signals with its regex tables; this file only decides from them, so
// it has no imports and no regex. The proofs say what a "yes" needs. They trust the signals: a wrong
// regex gives a wrong signal, and only the evals/replies.jsonl rows check that.

export type ReplyAnswer = "yes" | "no" | "unsure";
export type ReplyLeaning = "yes" | "no" | "neither";
/** Which restrictions the caller reports: none, the time refusals, or the time refusals and the conditions. */
export type ReplyConstraintSet = "empty" | "time" | "all";
export type ReplySignalKind = "yes" | "no" | "unsure" | "timeNeg" | "counter" | "cond" | "reversal" | "neutral";

/** One signal after the negation, condition and reversal steps. */
export interface ReplySignal {
  kind: ReplySignalKind;
  /** Position in the normalized text, for "later than". */
  at: number;
  sentence: number;
  /** A "no" that is a sentence on its own. */
  bare: boolean;
  /** A condition that only names a time. */
  condTime: boolean;
  /** A contrast word stands between the first decisive signal and this one. */
  contrast: boolean;
  /** A yes word in a sentence that asks a question ("are you sure?", "yes?"). */
  asked: boolean;
}

export interface ReplyVerdict {
  answer: ReplyAnswer;
  reason: string;
  counter: boolean;
  leaning: ReplyLeaning;
  constraints: ReplyConstraintSet;
}

export function isDecisive(k: ReplySignalKind): boolean {
  //@ verify
  //@ pure
  return k === "yes" || k === "no" || k === "unsure" || k === "timeNeg";
}

function verdict(answer: ReplyAnswer, reason: string, counter: boolean, leaning: ReplyLeaning, constraints: ReplyConstraintSet): ReplyVerdict {
  //@ verify
  //@ pure
  return { answer, reason, counter, leaning, constraints };
}

/** The last yes or no signal of `sentence`, at or before index `i`, is a no. */
function lastInSentenceIsNo(sig: ReplySignal[], sentence: number, i: number): boolean {
  //@ verify
  //@ pure
  //@ requires i < sig.length
  //@ decreases i + 1
  if (i < 0) return false;
  const s = sig[i];
  if (s.sentence === sentence && (s.kind === "yes" || s.kind === "no")) return s.kind === "no";
  return lastInSentenceIsNo(sig, sentence, i - 1);
}

/**
 * The answer when at least one signal decides. Only "yes" is consent, so the proved claims are about
 * "yes": it needs a yes signal, and no refusal, hedge, counter or question anywhere in the signals,
 * and every condition must be a time. `sig` is in text order, and `rest` keeps "later" in that order.
 */
export function decideReply(sig: ReplySignal[]): ReplyVerdict {
  //@ verify
  //@ requires exists(d: nat, d < sig.length && isDecisive(sig[d].kind))
  //@ ensures \result.answer === "yes" ==> exists(i: nat, i < sig.length && sig[i].kind === "yes")
  //@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "no")
  //@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "unsure")
  //@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "counter")
  //@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length && sig[i].kind === "cond" ==> sig[i].condTime)
  //@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length && sig[i].kind === "yes" ==> !sig[i].asked)
  let f = 0;
  while (!isDecisive(sig[f].kind)) {
    //@ invariant 0 <= f && f < sig.length
    //@ invariant forall(k: nat, k < f ==> !isDecisive(sig[k].kind))
    //@ invariant exists(d: nat, d >= f && d < sig.length && isDecisive(sig[d].kind))
    //@ decreases sig.length - f
    f = f + 1;
  }
  const first = sig[f];
  const rest = sig.slice(f + 1);
  const counter = sig.some(s => s.kind === "counter");
  if (first.kind === "no") return verdict("no", "refusal", counter, "neither", "time");
  if (first.kind === "timeNeg") {
    // "Not Thursday, but Friday works" offers another time; "Not this week, thanks" is a no.
    if (rest.some(s => s.kind === "yes")) return verdict("unsure", "time_refused_other_offered", true, "yes", "time");
    return verdict("no", "time_refusal", counter, "neither", "time");
  }
  if (first.kind === "unsure") {
    if (counter) return verdict("unsure", "hedge_counter", true, "neither", "empty");
    const leanYes = sig.some(s => s.kind === "yes");
    const leanNo = sig.some(s => s.kind === "no");
    return verdict("unsure", "hedge", false, leanYes && !leanNo ? "yes" : leanNo && !leanYes ? "no" : "neither", "empty");
  }
  // first.kind === "yes"
  if (rest.some(s => s.kind === "no")) {
    // "ok no", "yeah no", "sure... no": the last word is the answer.
    const sameSentence = rest.some(s => s.kind === "no" && s.sentence === first.sentence && !s.contrast);
    if (sameSentence && lastInSentenceIsNo(sig, first.sentence, sig.length - 1)) return verdict("no", "yes_then_no", false, "neither", "empty");
    // A bare "no" in a later sentence, the last no and with no yes after it, takes it back.
    const taken = rest.some(s => s.kind === "no" && s.bare && s.sentence !== first.sentence && !rest.some(n => n.kind === "no" && n.at > s.at) && !rest.some(y => y.kind === "yes" && y.at > s.at));
    if (taken) return verdict("no", "yes_then_bare_no", false, "neither", "empty");
    return verdict("unsure", "yes_no_conflict", false, "neither", "empty");
  }
  if (rest.some(s => s.kind === "unsure")) return verdict("unsure", "yes_then_hedge", counter, "yes", "all");
  if (counter) return verdict("unsure", "yes_other_time", true, "yes", "all");
  if (sig.some(c => c.kind === "cond" && !c.condTime)) return verdict("unsure", "conditional_yes", false, "yes", "all");
  if (sig.some(s => s.kind === "yes" && s.asked)) return verdict("unsure", "question", false, "neither", "all");
  return verdict("yes", "yes", false, "neither", "all");
}

/**
 * The answer when no word decides. Emoji decide only in a short reply that is not a question, and only
 * when there is no counter, no condition and no refusing or doubtful emoji.
 */
export function decideWithoutWords(counter: boolean, conditions: boolean, wordy: boolean, question: boolean, noEmoji: boolean, unsureEmoji: boolean, yesEmoji: boolean): ReplyVerdict {
  //@ verify
  //@ ensures \result.answer === "yes" ==> yesEmoji && !noEmoji && !unsureEmoji && !counter && !conditions && !wordy && !question
  if (counter) return verdict("unsure", "counter", true, "neither", "empty");
  if (conditions) return verdict("unsure", "condition_only", false, "neither", "empty");
  if (question) return verdict("unsure", "question", false, "neither", "empty");
  if (wordy) return verdict("unsure", "no_signal", false, "neither", "empty");
  if (noEmoji) return verdict("no", "emoji_no", false, "neither", "empty");
  if (unsureEmoji) return verdict("unsure", "emoji_unsure", false, "neither", "empty");
  if (yesEmoji) return verdict("yes", "emoji_yes", false, "neither", "empty");
  return verdict("unsure", "no_signal", false, "neither", "empty");
}
