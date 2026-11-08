// The decisions of the "ask, parse, validate, retry" loop in chatJson.ts. Import-free, proved by
// LemmaScript (docs/formal-verification.md). tryChatJson calls these functions and does not decide
// again. The await, the callbacks and the clock stay in chatJson.ts; quint/chatjson_loop.qnt models
// the full loop with them.

/** What the loop does before one attempt, after beforeAttempt returned. */
export type AttemptGate = "go" | "aborted" | "deadline";

/** What the loop does after a failed attempt (a thrown call, parse or validation error). */
export type AfterFailure = "stop" | "retry" | "exhausted";

/** The inputs of the check before one attempt. left is the time that is left (only when hasDeadline). */
export interface GateInput { aborted: boolean; hasDeadline: boolean; left: number }

/** True when a total deadline applies: deadlineMs is set and is more than 0 (0 means none). */
export function hasDeadline(set: boolean, deadlineMs: number): boolean {
  //@ verify
  //@ ensures \result === (set && deadlineMs > 0)
  return set && deadlineMs > 0;
}

/** The check before one attempt. The caller signal wins over the deadline. */
export function attemptGate(g: GateInput): AttemptGate {
  //@ verify
  //@ ensures \result === "aborted" <==> g.aborted
  //@ ensures \result === "go" ==> !g.aborted && (!g.hasDeadline || g.left > 0)
  //@ ensures \result === "deadline" ==> g.hasDeadline && g.left <= 0
  //@ ensures !g.aborted && !g.hasDeadline ==> \result === "go"
  if (g.aborted) return "aborted";
  if (g.hasDeadline && g.left <= 0) return "deadline";
  return "go";
}

/** LLMError codes that make a further attempt pointless: the loop stops (stopped: true). */
export function isFinalCode(code: string): boolean {
  //@ verify
  //@ ensures \result === (code === "aborted" || code === "deadline" || code === "budget")
  return code === "aborted" || code === "deadline" || code === "budget";
}

/**
 * The step after a failed attempt number `attempt` (0-based) of `attempts`. final: the error is an
 * LLMError with a final code. "retry" only when one more attempt is in the budget.
 */
export function afterFailure(final: boolean, attempt: number, attempts: number): AfterFailure {
  //@ verify
  //@ requires attempt >= 0 && attempt < attempts
  //@ ensures \result === "stop" <==> final
  //@ ensures \result === "retry" ==> !final && attempt + 1 < attempts
  //@ ensures \result === "exhausted" ==> !final && attempt + 1 >= attempts
  //@ ensures !final && attempt + 1 < attempts ==> \result === "retry"
  if (final) return "stop";
  return attempt + 1 < attempts ? "retry" : "exhausted";
}
