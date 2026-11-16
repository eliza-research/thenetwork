// GENERATED from spec/backendLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
export type BackendPhase = "Serving" | "StoppingListeners" | "WaitingForWork" | "ClosingClean" | "ClosingTimedOut" | "ClosedClean" | "ClosedTimedOut";
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
export interface BackendLifecycle { phase: BackendPhase; ticking: string[]; timerStarted: boolean; ticksFrom: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "releaseTick"; tickKey: string }
  | { type: "reserveTick"; tickKey: string }
  | { type: "startTimer"; at: number }
  | { type: "beginShutdown" }
  | { type: "recordListenerDrain" }
  | { type: "settleWorkDrain"; timedOut: boolean }
  | { type: "recordBackendClose" };

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
export const initial: BackendLifecycle = { phase: "Serving", ticking: ([] as string[]), timerStarted: false, ticksFrom: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: BackendLifecycle): boolean {
  return true;
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function canReleaseTick(s: BackendLifecycle, tickKey: string): boolean {
  return s.ticking.includes(tickKey);
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function releaseTick(s: BackendLifecycle, tickKey: string): BackendLifecycle {
  //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepNewTicksRequireServing(s, "releaseTick", \result)
  //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, ticking: s.ticking.filter((set_x: string) => ![tickKey].includes(set_x)) };
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function stepNewTicksRequireServing(before: BackendLifecycle, via: string, after: BackendLifecycle): boolean {
  return !(via === "reserveTick") || (before.phase === "Serving" && after.phase === "Serving");
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function backendAcceptsWork(s: BackendLifecycle): boolean {
  return s.phase === "Serving";
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function reserveTick(s: BackendLifecycle, tickKey: string): BackendLifecycle {
  //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepNewTicksRequireServing(s, "reserveTick", \result)
  //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, ticking: s.ticking.concat([tickKey].filter((set_x: string) => !s.ticking.includes(set_x))) };
}

/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md:9) */
//@ pure
export function canReserveTick(s: BackendLifecycle, tickKey: string): boolean {
  return backendAcceptsWork(s) && !s.ticking.includes(tickKey);
}

/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md:34) */
//@ pure
export function startTimer(s: BackendLifecycle, at: number): BackendLifecycle {
  //@ ensures (inv(s) && canStartTimer(s)) ==> stepNewTicksRequireServing(s, "startTimer", \result)
  //@ ensures (inv(s) && canStartTimer(s)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, timerStarted: true, ticksFrom: at };
}

/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md:34) */
//@ pure
export function sometimesTimerStarts(s: BackendLifecycle): boolean {
  return s.timerStarted;
}

/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md:34) */
//@ pure
export function canStartTimer(s: BackendLifecycle): boolean {
  return backendAcceptsWork(s);
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function beginShutdown(s: BackendLifecycle): BackendLifecycle {
  //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepNewTicksRequireServing(s, "beginShutdown", \result)
  //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, phase: "StoppingListeners" };
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function canRecordListenerDrain(s: BackendLifecycle): boolean {
  return s.phase === "StoppingListeners";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function recordListenerDrain(s: BackendLifecycle): BackendLifecycle {
  //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepNewTicksRequireServing(s, "recordListenerDrain", \result)
  //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, phase: "WaitingForWork" };
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function canSettleWorkDrain(s: BackendLifecycle): boolean {
  return s.phase === "WaitingForWork";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function settleWorkDrain(s: BackendLifecycle, timedOut: boolean): BackendLifecycle {
  //@ ensures (inv(s) && canSettleWorkDrain(s)) ==> stepNewTicksRequireServing(s, "settleWorkDrain", \result)
  //@ ensures (inv(s) && canSettleWorkDrain(s)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, phase: timedOut ? "ClosingTimedOut" : "ClosingClean" };
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function canRecordBackendClose(s: BackendLifecycle): boolean {
  return s.phase === "ClosingClean" || s.phase === "ClosingTimedOut";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function recordBackendClose(s: BackendLifecycle): BackendLifecycle {
  //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepNewTicksRequireServing(s, "recordBackendClose", \result)
  //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepDrainNeverReopens(s, \result)
  return { ...s, phase: s.phase === "ClosingClean" ? "ClosedClean" : "ClosedTimedOut" };
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function shutdownWasClean(s: BackendLifecycle): boolean {
  return s.phase === "ClosingClean" || s.phase === "ClosedClean";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function sometimesClosesCleanly(s: BackendLifecycle): boolean {
  return s.phase === "ClosedClean";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function sometimesClosesAfterGrace(s: BackendLifecycle): boolean {
  return s.phase === "ClosedTimedOut";
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function canBeginShutdown(s: BackendLifecycle): boolean {
  return backendAcceptsWork(s);
}

/** Story: Drain work before closing the backend / Shutdown drains listeners and then waits for tracked work (spec/backendLifecycle.md:50) */
//@ pure
export function stepDrainNeverReopens(before: BackendLifecycle, after: BackendLifecycle): boolean {
  return !(!backendAcceptsWork(before)) || !backendAcceptsWork(after);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: BackendLifecycle, event: Event): boolean {
  if (event.type === "releaseTick") return canReleaseTick(current, event.tickKey);
  if (event.type === "reserveTick") return canReserveTick(current, event.tickKey);
  if (event.type === "startTimer") return canStartTimer(current);
  if (event.type === "beginShutdown") return canBeginShutdown(current);
  if (event.type === "recordListenerDrain") return canRecordListenerDrain(current);
  if (event.type === "settleWorkDrain") return canSettleWorkDrain(current);
  if (event.type === "recordBackendClose") return canRecordBackendClose(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: BackendLifecycle, event: Event): BackendLifecycle {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "releaseTick" && canReleaseTick(current, event.tickKey)) return releaseTick(current, event.tickKey);
  if (event.type === "reserveTick" && canReserveTick(current, event.tickKey)) return reserveTick(current, event.tickKey);
  if (event.type === "startTimer" && canStartTimer(current)) return startTimer(current, event.at);
  if (event.type === "beginShutdown" && canBeginShutdown(current)) return beginShutdown(current);
  if (event.type === "recordListenerDrain" && canRecordListenerDrain(current)) return recordListenerDrain(current);
  if (event.type === "settleWorkDrain" && canSettleWorkDrain(current)) return settleWorkDrain(current, event.timedOut);
  if (event.type === "recordBackendClose" && canRecordBackendClose(current)) return recordBackendClose(current);
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
  if (raw.type === "releaseTick" && typeof raw.tickKey === "string") return { type: "releaseTick", tickKey: raw.tickKey };
  if (raw.type === "reserveTick" && typeof raw.tickKey === "string") return { type: "reserveTick", tickKey: raw.tickKey };
  if (raw.type === "startTimer" && Number.isSafeInteger(raw.at)) return { type: "startTimer", at: raw.at };
  if (raw.type === "beginShutdown") return { type: "beginShutdown" };
  if (raw.type === "recordListenerDrain") return { type: "recordListenerDrain" };
  if (raw.type === "settleWorkDrain" && typeof raw.timedOut === "boolean") return { type: "settleWorkDrain", timedOut: raw.timedOut };
  if (raw.type === "recordBackendClose") return { type: "recordBackendClose" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): BackendLifecycle | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Serving" || raw.phase === "StoppingListeners" || raw.phase === "WaitingForWork" || raw.phase === "ClosingClean" || raw.phase === "ClosingTimedOut" || raw.phase === "ClosedClean" || raw.phase === "ClosedTimedOut") && Array.isArray(raw.ticking) && raw.ticking.every((x1: any) => typeof x1 === "string") && new Set(raw.ticking).size === raw.ticking.length && typeof raw.timerStarted === "boolean" && Number.isSafeInteger(raw.ticksFrom) && Object.keys(raw).length === 4)) return undefined;
  const parsed: BackendLifecycle = ({ phase: raw.phase, ticking: raw.ticking.map((x1: any) => x1), timerStarted: raw.timerStarted, ticksFrom: raw.ticksFrom });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): BackendLifecycle {
  //@ ensures inv(\result)
  return initial;
}
