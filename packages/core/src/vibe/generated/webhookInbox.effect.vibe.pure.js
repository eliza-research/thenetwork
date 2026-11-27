// Generated from spec/webhookInbox.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./webhookInbox.js";
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export const webhookScanLimit = M.webhookScanLimit;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export const initial = M.initial;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export const webhookAttemptLimit = M.webhookAttemptLimit;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export function webhookArrival(inserted) { return M.webhookArrival(inserted); }
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export function chooseWebhook(hasWaiting, complianceFound, signedTurnBlocks) { return M.chooseWebhook(hasWaiting, complianceFound, signedTurnBlocks); }
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export function lawComplianceGoesFirst(signedTurnBlocks) { return M.lawComplianceGoesFirst(signedTurnBlocks); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function canStartWebhook(turn, attempts, stopCommand) { return M.canStartWebhook(turn, attempts, stopCommand); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function startWebhook(turn, attempts, stopCommand) { return M.startWebhook(turn, attempts, stopCommand); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function canRecordHandled(turn) { return M.canRecordHandled(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function recordHandled(turn) { return M.recordHandled(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function canRecordCompletion(turn) { return M.canRecordCompletion(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function recordCompletion(turn) { return M.recordCompletion(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function stepDoneRequiresCompletion(before, via, after) { return M.stepDoneRequiresCompletion(before, via, after); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function sometimesCanCompleteWebhook(turn) { return M.sometimesCanCompleteWebhook(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function earlierWebhookCancellable(selectedTurn, compliance) { return M.earlierWebhookCancellable(selectedTurn, compliance); }
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export function lawNeverCancelCompliance(selectedTurn) { return M.lawNeverCancelCompliance(selectedTurn); }
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export function canRecordFailure(turn) { return M.canRecordFailure(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export function recordFailure(turn) { return M.recordFailure(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export function alwaysStopNeverDropped(turn) { return M.alwaysStopNeverDropped(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export function lawStopNeverDrops(turn) { return M.lawStopNeverDrops(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export function sometimesCanRetryWebhook(turn) { return M.sometimesCanRetryWebhook(turn); }
/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md) @throws {never} */
export function webhookAnswer(done, failed) { return M.webhookAnswer(done, failed); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** @throws {never} */
export function snapshot_webhookInbox(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++)
            snapshot_webhookInbox(value[i]);
    }
    else {
        for (const key of Object.keys(value))
            snapshot_webhookInbox(value[key]);
    }
    return value;
}
/** @throws {never} */
export function snapshot_in_webhookInbox(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    if (Array.isArray(value)) {
        const copy = new Array(value.length);
        for (let i = 0; i < value.length; i++)
            copy[i] = snapshot_in_webhookInbox(value[i]);
        return Object.freeze(copy);
    }
    const copy = {};
    for (const key of Object.keys(value))
        copy[key] = snapshot_in_webhookInbox(value[key]);
    return Object.freeze(copy);
}
