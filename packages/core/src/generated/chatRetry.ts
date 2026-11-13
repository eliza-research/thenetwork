// GENERATED from spec/chatRetry.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
export type RetryPhase = "Unconfigured" | "Ready" | "Requesting" | "Accepted" | "CallbackStopped" | "Aborted" | "Expired" | "TerminalFailure" | "Exhausted";
/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
export interface RetryRun { phase: RetryPhase; attemptLimit: number; unbounded: boolean; attemptsStarted: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "configure"; attemptLimit: number; unbounded: boolean }
  | { type: "stopBeforeAttempt" }
  | { type: "preflight"; cancelled: boolean; expired: boolean }
  | { type: "acceptReply" }
  | { type: "rejectReply"; terminal: boolean };

/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
export const initial: RetryRun = { phase: "Unconfigured", attemptLimit: 0, unbounded: false, attemptsStarted: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RetryRun): boolean {
  return alwaysRetriesBounded(current) && alwaysExhaustionUsesBudget(current);
}

/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
//@ pure
export function configure(r: RetryRun, attemptLimit: number, unbounded: boolean): RetryRun {
  //@ ensures (inv(r) && canConfigure(r, attemptLimit)) ==> alwaysRetriesBounded(\result)
  //@ ensures (inv(r) && canConfigure(r, attemptLimit)) ==> alwaysExhaustionUsesBudget(\result)
  //@ ensures (inv(r) && canConfigure(r, attemptLimit)) ==> stepOnlyStartConsumesAnAttempt(r, "configure", \result)
  //@ ensures (inv(r) && canConfigure(r, attemptLimit)) ==> stepOkOnlyAfterValidation(r, "configure", \result)
  //@ ensures (inv(r) && canConfigure(r, attemptLimit)) ==> stepTerminalPhasesStayClosed(r, \result)
  return { ...r, attemptLimit: attemptLimit, unbounded: unbounded, phase: unbounded || attemptLimit > 0 ? "Ready" : "Exhausted" };
}

/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
//@ pure
export function alwaysRetriesBounded(r: RetryRun): boolean {
  return r.attemptsStarted >= 0 && r.attemptLimit >= 0 && (r.unbounded || r.attemptsStarted <= r.attemptLimit) && (!(r.phase === "Unconfigured") || r.attemptsStarted === 0) && (!(r.phase === "Ready") || (r.unbounded || r.attemptsStarted < r.attemptLimit));
}

/** Story: Finish a structured request within its budget / The configured attempt budget limits how many requests start (spec/chatRetry.md:9) */
//@ pure
export function canConfigure(r: RetryRun, attemptLimit: number): boolean {
  return r.phase === "Unconfigured" && attemptLimit >= 0;
}

/** Story: Finish a structured request within its budget / Only a positive configured timeout sets a deadline (spec/chatRetry.md:35) */
//@ pure
export function hasDeadline(isSet: boolean, deadlineMs: number): boolean {
  return isSet && deadlineMs > 0;
}

/** Story: Finish a structured request within its budget / Only a positive configured timeout sets a deadline (spec/chatRetry.md:35) */
//@ pure
export function deadlineExpired(hasLimit: boolean, left: number): boolean {
  return hasLimit && left <= 0;
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:44) */
//@ pure
export function canStopBeforeAttempt(r: RetryRun): boolean {
  return r.phase === "Ready";
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:44) */
//@ pure
export function stopBeforeAttempt(r: RetryRun): RetryRun {
  //@ ensures (inv(r) && canStopBeforeAttempt(r)) ==> alwaysRetriesBounded(\result)
  //@ ensures (inv(r) && canStopBeforeAttempt(r)) ==> alwaysExhaustionUsesBudget(\result)
  //@ ensures (inv(r) && canStopBeforeAttempt(r)) ==> stepOnlyStartConsumesAnAttempt(r, "stopBeforeAttempt", \result)
  //@ ensures (inv(r) && canStopBeforeAttempt(r)) ==> stepOkOnlyAfterValidation(r, "stopBeforeAttempt", \result)
  //@ ensures (inv(r) && canStopBeforeAttempt(r)) ==> stepTerminalPhasesStayClosed(r, \result)
  return { ...r, phase: "CallbackStopped" };
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:44) */
//@ pure
export function canPreflight(r: RetryRun): boolean {
  return r.phase === "Ready";
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:44) */
//@ pure
export function preflight(r: RetryRun, cancelled: boolean, expired: boolean): RetryRun {
  //@ ensures (inv(r) && canPreflight(r)) ==> alwaysRetriesBounded(\result)
  //@ ensures (inv(r) && canPreflight(r)) ==> alwaysExhaustionUsesBudget(\result)
  //@ ensures (inv(r) && canPreflight(r)) ==> stepOnlyStartConsumesAnAttempt(r, "preflight", \result)
  //@ ensures (inv(r) && canPreflight(r)) ==> stepOkOnlyAfterValidation(r, "preflight", \result)
  //@ ensures (inv(r) && canPreflight(r)) ==> stepTerminalPhasesStayClosed(r, \result)
  return cancelled ? ({ ...r, phase: "Aborted" } as RetryRun) : (expired ? ({ ...r, phase: "Expired" } as RetryRun) : ({ ...r, phase: "Requesting", attemptsStarted: r.attemptsStarted + 1 } as RetryRun));
}

/** Story: Finish a structured request within its budget / Caller cancellation wins over a deadline (spec/chatRetry.md:44) */
//@ pure
export function stepOnlyStartConsumesAnAttempt(before: RetryRun, via: string, after: RetryRun): boolean {
  return via === "preflight" && after.phase === "Requesting" ? after.attemptsStarted === before.attemptsStarted + 1 : after.attemptsStarted === before.attemptsStarted;
}

/** Story: Finish a structured request within its budget / A validated reply completes the request (spec/chatRetry.md:63) */
//@ pure
export function canAcceptReply(r: RetryRun): boolean {
  return r.phase === "Requesting";
}

/** Story: Finish a structured request within its budget / A validated reply completes the request (spec/chatRetry.md:63) */
//@ pure
export function acceptReply(r: RetryRun): RetryRun {
  //@ ensures (inv(r) && canAcceptReply(r)) ==> alwaysRetriesBounded(\result)
  //@ ensures (inv(r) && canAcceptReply(r)) ==> alwaysExhaustionUsesBudget(\result)
  //@ ensures (inv(r) && canAcceptReply(r)) ==> stepOnlyStartConsumesAnAttempt(r, "acceptReply", \result)
  //@ ensures (inv(r) && canAcceptReply(r)) ==> stepOkOnlyAfterValidation(r, "acceptReply", \result)
  //@ ensures (inv(r) && canAcceptReply(r)) ==> stepTerminalPhasesStayClosed(r, \result)
  return { ...r, phase: "Accepted" };
}

/** Story: Finish a structured request within its budget / A validated reply completes the request (spec/chatRetry.md:63) */
//@ pure
export function stepOkOnlyAfterValidation(before: RetryRun, via: string, after: RetryRun): boolean {
  return !(after.phase === "Accepted" && before.phase !== "Accepted") || (before.phase === "Requesting" && via === "acceptReply");
}

/** Story: Finish a structured request within its budget / A validated reply completes the request (spec/chatRetry.md:63) */
//@ pure
export function sometimesValidated(r: RetryRun): boolean {
  return r.phase === "Accepted";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function isFinalCode(code: string): boolean {
  return code === "aborted" || code === "deadline" || code === "budget";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function canRejectReply(r: RetryRun): boolean {
  return r.phase === "Requesting";
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function rejectReply(r: RetryRun, terminal: boolean): RetryRun {
  //@ ensures (inv(r) && canRejectReply(r)) ==> alwaysRetriesBounded(\result)
  //@ ensures (inv(r) && canRejectReply(r)) ==> alwaysExhaustionUsesBudget(\result)
  //@ ensures (inv(r) && canRejectReply(r)) ==> stepOnlyStartConsumesAnAttempt(r, "rejectReply", \result)
  //@ ensures (inv(r) && canRejectReply(r)) ==> stepOkOnlyAfterValidation(r, "rejectReply", \result)
  //@ ensures (inv(r) && canRejectReply(r)) ==> stepTerminalPhasesStayClosed(r, \result)
  return { ...r, phase: terminal ? "TerminalFailure" : (r.unbounded || r.attemptsStarted < r.attemptLimit ? "Ready" : "Exhausted") };
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function alwaysExhaustionUsesBudget(r: RetryRun): boolean {
  return !(r.phase === "Exhausted") || (!r.unbounded && r.attemptsStarted === r.attemptLimit);
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function stepTerminalPhasesStayClosed(before: RetryRun, after: RetryRun): boolean {
  return !(before.phase !== "Unconfigured" && before.phase !== "Ready" && before.phase !== "Requesting") || after.phase === before.phase;
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function sometimesRetry(r: RetryRun): boolean {
  return r.phase === "Ready" && r.attemptsStarted > 0;
}

/** Story: Finish a structured request within its budget / Terminal errors stop the retry loop (spec/chatRetry.md:78) */
//@ pure
export function sometimesExhaustedAfterRequest(r: RetryRun): boolean {
  return r.phase === "Exhausted" && r.attemptsStarted > 0;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RetryRun, event: Event): boolean {
  if (event.type === "configure") return canConfigure(current, event.attemptLimit);
  if (event.type === "stopBeforeAttempt") return canStopBeforeAttempt(current);
  if (event.type === "preflight") return canPreflight(current);
  if (event.type === "acceptReply") return canAcceptReply(current);
  if (event.type === "rejectReply") return canRejectReply(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RetryRun, event: Event): RetryRun {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "configure" && canConfigure(current, event.attemptLimit)) return configure(current, event.attemptLimit, event.unbounded);
  if (event.type === "stopBeforeAttempt" && canStopBeforeAttempt(current)) return stopBeforeAttempt(current);
  if (event.type === "preflight" && canPreflight(current)) return preflight(current, event.cancelled, event.expired);
  if (event.type === "acceptReply" && canAcceptReply(current)) return acceptReply(current);
  if (event.type === "rejectReply" && canRejectReply(current)) return rejectReply(current, event.terminal);
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "configure" && Number.isSafeInteger(raw.attemptLimit) && typeof raw.unbounded === "boolean") return { type: "configure", attemptLimit: raw.attemptLimit, unbounded: raw.unbounded };
  if (raw.type === "stopBeforeAttempt") return { type: "stopBeforeAttempt" };
  if (raw.type === "preflight" && typeof raw.cancelled === "boolean" && typeof raw.expired === "boolean") return { type: "preflight", cancelled: raw.cancelled, expired: raw.expired };
  if (raw.type === "acceptReply") return { type: "acceptReply" };
  if (raw.type === "rejectReply" && typeof raw.terminal === "boolean") return { type: "rejectReply", terminal: raw.terminal };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): RetryRun | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unconfigured" || raw.phase === "Ready" || raw.phase === "Requesting" || raw.phase === "Accepted" || raw.phase === "CallbackStopped" || raw.phase === "Aborted" || raw.phase === "Expired" || raw.phase === "TerminalFailure" || raw.phase === "Exhausted") && Number.isSafeInteger(raw.attemptLimit) && typeof raw.unbounded === "boolean" && Number.isSafeInteger(raw.attemptsStarted) && Object.keys(raw).length === 4)) return undefined;
  const parsed: RetryRun = ({ phase: raw.phase, attemptLimit: raw.attemptLimit, unbounded: raw.unbounded, attemptsStarted: raw.attemptsStarted });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RetryRun {
  //@ ensures inv(\result)
  return initial;
}
