// Generated from spec/webhookInbox.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/webhookInbox.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) */
export const webhookScanLimit = 50;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
export const initial = { phase: "WebhookQueued", attempts: 0, stopCommand: false };
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
export const webhookAttemptLimit = 5;
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return alwaysStopNeverDropped(current);
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) */
//@ pure
export function webhookArrival(inserted) {
    return inserted ? "DrainSender" : "DuplicateWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) */
//@ pure
export function chooseWebhook(hasWaiting, complianceFound, signedTurnBlocks) {
    return !hasWaiting ? "QueueEmpty" : (complianceFound ? "RunCompliance" : (signedTurnBlocks ? "WaitForSignedTurn" : "RunOldest"));
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) */
//@ pure
export function lawComplianceGoesFirst(signedTurnBlocks) {
    //@ ensures \result === true
    return chooseWebhook(true, true, signedTurnBlocks) === "RunCompliance";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function canStartWebhook(turn, attempts, stopCommand) {
    return turn.phase === "WebhookQueued" && attempts >= 0 && (stopCommand || attempts < webhookAttemptLimit);
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function startWebhook(turn, attempts, stopCommand) {
    //@ ensures (inv(turn) && canStartWebhook(turn, attempts, stopCommand)) ==> alwaysStopNeverDropped(\result)
    //@ ensures (inv(turn) && canStartWebhook(turn, attempts, stopCommand)) ==> stepDoneRequiresCompletion(turn, "startWebhook", \result)
    return { phase: "RunningWebhook", attempts: attempts, stopCommand: stopCommand };
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function canRecordHandled(turn) {
    return turn.phase === "RunningWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function recordHandled(turn) {
    //@ ensures (inv(turn) && canRecordHandled(turn)) ==> alwaysStopNeverDropped(\result)
    //@ ensures (inv(turn) && canRecordHandled(turn)) ==> stepDoneRequiresCompletion(turn, "recordHandled", \result)
    return { ...turn, phase: turn.stopCommand ? "CancelEarlier" : "CompleteWebhook" };
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function canRecordCompletion(turn) {
    return turn.phase === "CompleteWebhook" || turn.phase === "CancelEarlier";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function recordCompletion(turn) {
    //@ ensures (inv(turn) && canRecordCompletion(turn)) ==> alwaysStopNeverDropped(\result)
    //@ ensures (inv(turn) && canRecordCompletion(turn)) ==> stepDoneRequiresCompletion(turn, "recordCompletion", \result)
    return { ...turn, phase: "WebhookDone" };
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function stepDoneRequiresCompletion(before, via, after) {
    return !(after.phase === "WebhookDone") || (via === "recordCompletion" && canRecordCompletion(before));
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function sometimesCanCompleteWebhook(turn) {
    return turn.phase === "WebhookDone";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function earlierWebhookCancellable(selectedTurn, compliance) {
    return !selectedTurn && !compliance;
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) */
//@ pure
export function lawNeverCancelCompliance(selectedTurn) {
    //@ ensures \result === true
    return !earlierWebhookCancellable(selectedTurn, true);
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
//@ pure
export function canRecordFailure(turn) {
    return turn.phase === "RunningWebhook" || canRecordCompletion(turn);
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
//@ pure
export function recordFailure(turn) {
    //@ ensures (inv(turn) && canRecordFailure(turn)) ==> alwaysStopNeverDropped(\result)
    //@ ensures (inv(turn) && canRecordFailure(turn)) ==> stepDoneRequiresCompletion(turn, "recordFailure", \result)
    return { ...turn, attempts: exact_webhookInbox(turn.attempts + 1), phase: exact_webhookInbox(turn.attempts + 1) >= webhookAttemptLimit && !turn.stopCommand ? "DropWebhook" : "RetryWebhook" };
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
//@ pure
export function alwaysStopNeverDropped(turn) {
    return !(turn.phase === "DropWebhook") || !turn.stopCommand;
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
//@ pure
export function lawStopNeverDrops(turn) {
    //@ ensures \result === true
    return !turn.stopCommand || recordFailure(turn).phase === "RetryWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) */
//@ pure
export function sometimesCanRetryWebhook(turn) {
    return turn.phase === "RetryWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md) */
//@ pure
export function webhookAnswer(done, failed) {
    return done ? "StoredWebhookAnswer" : (failed ? "StoredWebhookFailure" : "WaitForRetry");
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "startWebhook")
        return canStartWebhook(current, event.attempts, event.stopCommand);
    if (event.type === "recordHandled")
        return canRecordHandled(current);
    if (event.type === "recordCompletion")
        return canRecordCompletion(current);
    if (event.type === "recordFailure")
        return canRecordFailure(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "startWebhook")
        return canStartWebhook(current, event.attempts, event.stopCommand) ? startWebhook(current, event.attempts, event.stopCommand) : current;
    if (event.type === "recordHandled")
        return canRecordHandled(current) ? recordHandled(current) : current;
    if (event.type === "recordCompletion")
        return canRecordCompletion(current) ? recordCompletion(current) : current;
    if (event.type === "recordFailure")
        return canRecordFailure(current) ? recordFailure(current) : current;
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
    if (raw.type === "startWebhook" && Number.isSafeInteger(raw.attempts) && typeof raw.stopCommand === "boolean")
        return { type: "startWebhook", attempts: raw.attempts, stopCommand: raw.stopCommand };
    if (raw.type === "recordHandled")
        return { type: "recordHandled" };
    if (raw.type === "recordCompletion")
        return { type: "recordCompletion" };
    if (raw.type === "recordFailure")
        return { type: "recordFailure" };
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
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "WebhookQueued" || raw.phase === "RunningWebhook" || raw.phase === "CompleteWebhook" || raw.phase === "CancelEarlier" || raw.phase === "WebhookDone" || raw.phase === "RetryWebhook" || raw.phase === "DropWebhook") && Number.isSafeInteger(raw.attempts) && typeof raw.stopCommand === "boolean" && Object.keys(raw).length === 3))
        return undefined;
    const parsed = ({ phase: raw.phase, attempts: raw.attempts, stopCommand: raw.stopCommand });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_webhookInbox(n) {
    if (!Number.isSafeInteger(n))
        throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
    return n;
}
