// Generated from spec/webhookInbox.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/webhookInbox.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md:57) */
export const webhookAttemptLimit = 5;
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
export const webhookScanLimit = 50;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
export const initial = { phase: "RunningWebhook" };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function webhookArrival(inserted) {
    return inserted ? "DrainSender" : "DuplicateWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function chooseWebhook(hasWaiting, complianceFound, signedTurnBlocks) {
    return !hasWaiting ? "QueueEmpty" : (complianceFound ? "RunCompliance" : (signedTurnBlocks ? "WaitForSignedTurn" : "RunOldest"));
}
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function lawComplianceGoesFirst(signedTurnBlocks) {
    //@ ensures \result === true
    return chooseWebhook(true, true, signedTurnBlocks) === "RunCompliance";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function earlierWebhookCancellable(selectedTurn, compliance) {
    return !selectedTurn && !compliance;
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function canRecordHandled(turn) {
    return turn.phase === "RunningWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function recordHandled(turn, stopCommand) {
    //@ ensures (inv(turn) && canRecordHandled(turn)) ==> stepDoneRequiresCompletion(turn, "recordHandled", \result)
    return { phase: stopCommand ? "CancelEarlier" : "CompleteWebhook" };
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function canRecordCompletion(turn) {
    return turn.phase === "CompleteWebhook" || turn.phase === "CancelEarlier";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function recordCompletion(turn) {
    //@ ensures (inv(turn) && canRecordCompletion(turn)) ==> stepDoneRequiresCompletion(turn, "recordCompletion", \result)
    return { phase: "WebhookDone" };
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function sometimesCanCompleteWebhook(turn) {
    return turn.phase === "WebhookDone";
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function lawNeverCancelCompliance(selectedTurn) {
    //@ ensures \result === true
    return !earlierWebhookCancellable(selectedTurn, true);
}
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md:30) */
//@ pure
export function stepDoneRequiresCompletion(before, via, after) {
    return !(after.phase === "WebhookDone") || (via === "recordCompletion" && canRecordCompletion(before));
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md:57) */
//@ pure
export function recordFailure(turn, attempts, stopCommand) {
    //@ ensures (inv(turn) && canRecordFailure(turn)) ==> stepDoneRequiresCompletion(turn, "recordFailure", \result)
    return { phase: attempts >= webhookAttemptLimit && !stopCommand ? "DropWebhook" : "RetryWebhook" };
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md:57) */
//@ pure
export function sometimesCanRetryWebhook(turn) {
    return turn.phase === "RetryWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md:57) */
//@ pure
export function canRecordFailure(turn) {
    return turn.phase === "RunningWebhook" || canRecordCompletion(turn);
}
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md:57) */
//@ pure
export function lawStopNeverDrops(turn, attempts) {
    //@ ensures \result === true
    return recordFailure(turn, attempts, true).phase === "RetryWebhook";
}
/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md:74) */
//@ pure
export function webhookAnswer(done, failed) {
    return done ? "StoredWebhookAnswer" : (failed ? "StoredWebhookFailure" : "WaitForRetry");
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
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
    if (event.type === "recordHandled" && canRecordHandled(current))
        return recordHandled(current, event.stopCommand);
    if (event.type === "recordCompletion" && canRecordCompletion(current))
        return recordCompletion(current);
    if (event.type === "recordFailure" && canRecordFailure(current))
        return recordFailure(current, event.attempts, event.stopCommand);
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
    if (raw.type === "recordHandled" && typeof raw.stopCommand === "boolean")
        return { type: "recordHandled", stopCommand: raw.stopCommand };
    if (raw.type === "recordCompletion")
        return { type: "recordCompletion" };
    if (raw.type === "recordFailure" && Number.isSafeInteger(raw.attempts) && typeof raw.stopCommand === "boolean")
        return { type: "recordFailure", attempts: raw.attempts, stopCommand: raw.stopCommand };
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
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "RunningWebhook" || raw.phase === "CompleteWebhook" || raw.phase === "CancelEarlier" || raw.phase === "WebhookDone" || raw.phase === "RetryWebhook" || raw.phase === "DropWebhook") && Object.keys(raw).length === 1))
        return undefined;
    const parsed = ({ phase: raw.phase });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
