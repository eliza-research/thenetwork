// Generated from spec/backendLifecycle.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./backendLifecycle.js";
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function canReleaseTick(s, tickKey) { return M.canReleaseTick(s, tickKey); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function releaseTick(s, tickKey) { return M.releaseTick(s, tickKey); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function stepNewTicksRequireServing(before, via, after) { return M.stepNewTicksRequireServing(before, via, after); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function backendAcceptsWork(s) { return M.backendAcceptsWork(s); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function reserveTick(s, tickKey) { return M.reserveTick(s, tickKey); }
/** Story: Run one tick per worker at a time / Reserve each tick worker before starting its work (spec/backendLifecycle.md) @throws {never} */
export function canReserveTick(s, tickKey) { return M.canReserveTick(s, tickKey); }
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export function startTimer(s, at) { return M.startTimer(s, at); }
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export function sometimesTimerStarts(s) { return M.sometimesTimerStarts(s); }
/** Story: Run one tick per worker at a time / A timer start records when tick monitoring began (spec/backendLifecycle.md) @throws {never} */
export function canStartTimer(s) { return M.canStartTimer(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function beginShutdown(s) { return M.beginShutdown(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function canRecordListenerDrain(s) { return M.canRecordListenerDrain(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function recordListenerDrain(s) { return M.recordListenerDrain(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function ticksReleased(s) { return M.ticksReleased(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function settleWorkDrain(s, timedOut) { return M.settleWorkDrain(s, timedOut); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function canRecordBackendClose(s) { return M.canRecordBackendClose(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function recordBackendClose(s) { return M.recordBackendClose(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function shutdownWasClean(s) { return M.shutdownWasClean(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function stepCleanDrainWaitsForListeners(before, after) { return M.stepCleanDrainWaitsForListeners(before, after); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function sometimesClosesCleanly(s) { return M.sometimesClosesCleanly(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function sometimesClosesAfterGrace(s) { return M.sometimesClosesAfterGrace(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function canBeginShutdown(s) { return M.canBeginShutdown(s); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function canSettleWorkDrain(s, timedOut) { return M.canSettleWorkDrain(s, timedOut); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function stepDrainNeverReopens(before, after) { return M.stepDrainNeverReopens(before, after); }
/** Story: Drain work before closing the backend / The grace period covers listener and work drain (spec/backendLifecycle.md) @throws {never} */
export function stepCleanDrainHasNoTicks(before, after) { return M.stepCleanDrainHasNoTicks(before, after); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares a state with its callers. @throws {never} */
export function snapshot_backendLifecycle(value) { return structuredClone(value); }
