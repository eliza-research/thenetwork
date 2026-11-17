// Generated from spec/backendLifecycle.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/backendLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
export const initial = { phase: "Serving", ticking: [], timerStarted: false, ticksFrom: 0 };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function canReleaseTick(s, tickKey) {
    return s.ticking.includes(tickKey);
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function releaseTick(s, tickKey) {
    //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepNewTicksRequireServing(s, "releaseTick", \result)
    //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canReleaseTick(s, tickKey)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, ticking: s.ticking.filter((set_x) => ![tickKey].includes(set_x)) };
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function stepNewTicksRequireServing(before, via, after) {
    return !(via === "reserveTick") || (before.phase === "Serving" && after.phase === "Serving");
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function backendAcceptsWork(s) {
    return s.phase === "Serving";
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function reserveTick(s, tickKey) {
    //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepNewTicksRequireServing(s, "reserveTick", \result)
    //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canReserveTick(s, tickKey)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, ticking: s.ticking.concat([tickKey].filter((set_x) => !s.ticking.includes(set_x))) };
}
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) */
//@ pure
export function canReserveTick(s, tickKey) {
    return backendAcceptsWork(s) && !s.ticking.includes(tickKey);
}
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) */
//@ pure
export function startTimer(s, at) {
    //@ ensures (inv(s) && canStartTimer(s)) ==> stepNewTicksRequireServing(s, "startTimer", \result)
    //@ ensures (inv(s) && canStartTimer(s)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canStartTimer(s)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canStartTimer(s)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, timerStarted: true, ticksFrom: at };
}
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) */
//@ pure
export function sometimesTimerStarts(s) {
    return s.timerStarted;
}
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) */
//@ pure
export function canStartTimer(s) {
    return backendAcceptsWork(s);
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function beginShutdown(s) {
    //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepNewTicksRequireServing(s, "beginShutdown", \result)
    //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canBeginShutdown(s)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, phase: "StoppingListeners" };
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function canRecordListenerDrain(s) {
    return s.phase === "StoppingListeners";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function recordListenerDrain(s) {
    //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepNewTicksRequireServing(s, "recordListenerDrain", \result)
    //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canRecordListenerDrain(s)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, phase: "WaitingForWork" };
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function ticksReleased(s) {
    return s.ticking.length === 0;
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function settleWorkDrain(s, timedOut) {
    //@ ensures (inv(s) && canSettleWorkDrain(s, timedOut)) ==> stepNewTicksRequireServing(s, "settleWorkDrain", \result)
    //@ ensures (inv(s) && canSettleWorkDrain(s, timedOut)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canSettleWorkDrain(s, timedOut)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canSettleWorkDrain(s, timedOut)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, phase: timedOut ? "ClosingTimedOut" : "ClosingClean" };
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function canRecordBackendClose(s) {
    return s.phase === "ClosingClean" || s.phase === "ClosingTimedOut";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function recordBackendClose(s) {
    //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepNewTicksRequireServing(s, "recordBackendClose", \result)
    //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepCleanDrainWaitsForListeners(s, \result)
    //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepDrainNeverReopens(s, \result)
    //@ ensures (inv(s) && canRecordBackendClose(s)) ==> stepCleanDrainHasNoTicks(s, \result)
    return { ...s, phase: s.phase === "ClosingClean" ? "ClosedClean" : "ClosedTimedOut" };
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function shutdownWasClean(s) {
    return s.phase === "ClosingClean" || s.phase === "ClosedClean";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function stepCleanDrainWaitsForListeners(before, after) {
    return !(before.phase !== "ClosingClean" && after.phase === "ClosingClean") || before.phase === "WaitingForWork";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function sometimesClosesCleanly(s) {
    return s.phase === "ClosedClean";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function sometimesClosesAfterGrace(s) {
    return s.phase === "ClosedTimedOut";
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function canBeginShutdown(s) {
    return backendAcceptsWork(s);
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function canSettleWorkDrain(s, timedOut) {
    return (s.phase === "WaitingForWork" && (timedOut || ticksReleased(s))) || (s.phase === "StoppingListeners" && timedOut);
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function stepDrainNeverReopens(before, after) {
    return !(!backendAcceptsWork(before)) || !backendAcceptsWork(after);
}
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) */
//@ pure
export function stepCleanDrainHasNoTicks(before, after) {
    return !(before.phase !== "ClosingClean" && after.phase === "ClosingClean") || ticksReleased(before);
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "releaseTick")
        return canReleaseTick(current, event.tickKey);
    if (event.type === "reserveTick")
        return canReserveTick(current, event.tickKey);
    if (event.type === "startTimer")
        return canStartTimer(current);
    if (event.type === "beginShutdown")
        return canBeginShutdown(current);
    if (event.type === "recordListenerDrain")
        return canRecordListenerDrain(current);
    if (event.type === "settleWorkDrain")
        return canSettleWorkDrain(current, event.timedOut);
    if (event.type === "recordBackendClose")
        return canRecordBackendClose(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "releaseTick" && canReleaseTick(current, event.tickKey))
        return releaseTick(current, event.tickKey);
    if (event.type === "reserveTick" && canReserveTick(current, event.tickKey))
        return reserveTick(current, event.tickKey);
    if (event.type === "startTimer" && canStartTimer(current))
        return startTimer(current, event.at);
    if (event.type === "beginShutdown" && canBeginShutdown(current))
        return beginShutdown(current);
    if (event.type === "recordListenerDrain" && canRecordListenerDrain(current))
        return recordListenerDrain(current);
    if (event.type === "settleWorkDrain" && canSettleWorkDrain(current, event.timedOut))
        return settleWorkDrain(current, event.timedOut);
    if (event.type === "recordBackendClose" && canRecordBackendClose(current))
        return recordBackendClose(current);
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "releaseTick" && typeof raw.tickKey === "string")
        return { type: "releaseTick", tickKey: raw.tickKey };
    if (raw.type === "reserveTick" && typeof raw.tickKey === "string")
        return { type: "reserveTick", tickKey: raw.tickKey };
    if (raw.type === "startTimer" && Number.isSafeInteger(raw.at))
        return { type: "startTimer", at: raw.at };
    if (raw.type === "beginShutdown")
        return { type: "beginShutdown" };
    if (raw.type === "recordListenerDrain")
        return { type: "recordListenerDrain" };
    if (raw.type === "settleWorkDrain" && typeof raw.timedOut === "boolean")
        return { type: "settleWorkDrain", timedOut: raw.timedOut };
    if (raw.type === "recordBackendClose")
        return { type: "recordBackendClose" };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Serving" || raw.phase === "StoppingListeners" || raw.phase === "WaitingForWork" || raw.phase === "ClosingClean" || raw.phase === "ClosingTimedOut" || raw.phase === "ClosedClean" || raw.phase === "ClosedTimedOut") && Array.isArray(raw.ticking) && raw.ticking.every((x1) => typeof x1 === "string") && new Set(raw.ticking).size === raw.ticking.length && typeof raw.timerStarted === "boolean" && Number.isSafeInteger(raw.ticksFrom) && Object.keys(raw).length === 4))
        return undefined;
    const parsed = ({ phase: raw.phase, ticking: raw.ticking.map((x1) => x1), timerStarted: raw.timerStarted, ticksFrom: raw.ticksFrom });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
