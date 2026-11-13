// GENERATED from spec/chatRetry.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:17) */
export interface GateInput { aborted: boolean; hasDeadline: boolean; left: number }


/** Story: Finish a structured request within its budget / Only a positive configured timeout sets a deadline (spec/chatRetry.md:9) */
//@ pure
export function hasDeadline(isSet: boolean, deadlineMs: number): boolean {
  return isSet && deadlineMs > 0;
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:17) */
//@ pure
export function attemptGate(g: GateInput): string {
  return g.aborted ? "aborted" : (g.hasDeadline && g.left <= 0 ? "deadline" : "go");
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:17) */
//@ pure
export function lawCancelledAttemptStops(hasLimit: boolean, left: number): boolean {
  //@ ensures \result === true
  return attemptGate(({ aborted: true, hasDeadline: hasLimit, left: left } as GateInput)) === "aborted";
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:17) */
//@ pure
export function lawExpiredAttemptStops(left: number): boolean {
  //@ ensures \result === true
  return !(left <= 0) || attemptGate(({ aborted: false, hasDeadline: true, left: left } as GateInput)) === "deadline";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:36) */
//@ pure
export function afterFailure(final: boolean, attempt: number, attempts: number): string {
  return final ? "stop" : (attempt + 1 < attempts ? "retry" : "exhausted");
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:36) */
//@ pure
export function isFinalCode(code: string): boolean {
  return code === "aborted" || code === "deadline" || code === "budget";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:36) */
//@ pure
export function lawFinalErrorStopsRetry(attempt: number, attempts: number): boolean {
  //@ ensures \result === true
  return afterFailure(true, attempt, attempts) === "stop";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:36) */
//@ pure
export function lawRetryNeedsAnotherAttempt(attempt: number, attempts: number): boolean {
  //@ ensures \result === true
  return (afterFailure(false, attempt, attempts) === "retry") === attempt + 1 < attempts;
}
