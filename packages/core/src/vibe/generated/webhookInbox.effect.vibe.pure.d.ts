// Generated from spec/webhookInbox.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { QueueChoice, ArrivalResult, WebhookTurn, WebhookAnswer, Event } from "./webhookInbox.ts";
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare const webhookAttemptLimit: number;
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export declare const webhookScanLimit: number;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare const initial: WebhookTurn;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export declare function webhookArrival(inserted: boolean): ArrivalResult;
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export declare function chooseWebhook(hasWaiting: boolean, complianceFound: boolean, signedTurnBlocks: boolean): QueueChoice;
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md) @throws {never} */
export declare function lawComplianceGoesFirst(signedTurnBlocks: boolean): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function earlierWebhookCancellable(selectedTurn: boolean, compliance: boolean): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function canStartWebhook(turn: WebhookTurn, attempts: number, stopCommand: boolean): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function startWebhook(turn: WebhookTurn, attempts: number, stopCommand: boolean): WebhookTurn;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function canRecordHandled(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function recordHandled(turn: WebhookTurn): WebhookTurn;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function canRecordCompletion(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function recordCompletion(turn: WebhookTurn): WebhookTurn;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function sometimesCanCompleteWebhook(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function lawNeverCancelCompliance(selectedTurn: boolean): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Completing a STOP clears earlier ordinary rows in the same write (spec/webhookInbox.md) @throws {never} */
export declare function stepDoneRequiresCompletion(before: WebhookTurn, via: string, after: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare function recordFailure(turn: WebhookTurn): WebhookTurn;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare function alwaysStopNeverDropped(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare function sometimesCanRetryWebhook(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare function canRecordFailure(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / A failed STOP stays pending and other rows can exhaust their attempts (spec/webhookInbox.md) @throws {never} */
export declare function lawStopNeverDrops(turn: WebhookTurn): boolean;
/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md) @throws {never} */
export declare function webhookAnswer(done: boolean, failed: boolean): WebhookAnswer;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: WebhookTurn, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: WebhookTurn, event: Event): WebhookTurn;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): WebhookTurn | undefined;
/** A Machine never shares a state with its callers. @throws {never} */
export declare function snapshot_webhookInbox<A>(value: A): A;
