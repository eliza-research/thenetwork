// GENERATED from spec/webhookInbox.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
export type QueueChoice = "QueueEmpty" | "RunCompliance" | "WaitForSignedTurn" | "RunOldest";
/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
export type ArrivalResult = "DrainSender" | "DuplicateWebhook";
/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
export type WebhookPhase = "RunningWebhook" | "CancelEarlier" | "WebhookDone" | "RetryWebhook" | "DropWebhook";
/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
export interface WebhookTurn { phase: WebhookPhase }
/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md:56) */
export type WebhookAnswer = "StoredWebhookAnswer" | "StoredWebhookFailure" | "WaitForRetry";

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordHandled"; stopCommand: boolean }
  | { type: "recordFailure"; attempts: number };

/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
export const webhookScanLimit: number = 50;
/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
export const webhookAttemptLimit: number = 5;
/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
export const initial: WebhookTurn = { phase: "RunningWebhook" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: WebhookTurn): boolean {
  return true;
}

/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function webhookArrival(inserted: boolean): ArrivalResult {
  return inserted ? "DrainSender" : "DuplicateWebhook";
}

/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function chooseWebhook(hasWaiting: boolean, complianceFound: boolean, signedTurnBlocks: boolean): QueueChoice {
  return !hasWaiting ? "QueueEmpty" : (complianceFound ? "RunCompliance" : (signedTurnBlocks ? "WaitForSignedTurn" : "RunOldest"));
}

/** Story: Handle my pending messages in order while prioritizing consent / Dedupe a received message and choose the next pending turn (spec/webhookInbox.md:9) */
//@ pure
export function lawComplianceGoesFirst(signedTurnBlocks: boolean): boolean {
  //@ ensures \result === true
  return chooseWebhook(true, true, signedTurnBlocks) === "RunCompliance";
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function earlierWebhookCancellable(selectedTurn: boolean, compliance: boolean): boolean {
  return !selectedTurn && !compliance;
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function canRecordHandled(turn: WebhookTurn): boolean {
  return turn.phase === "RunningWebhook";
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function recordHandled(turn: WebhookTurn, stopCommand: boolean): WebhookTurn {
  return { phase: stopCommand ? "CancelEarlier" : "WebhookDone" };
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function canRecordFailure(turn: WebhookTurn): boolean {
  return turn.phase === "RunningWebhook";
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function recordFailure(turn: WebhookTurn, attempts: number): WebhookTurn {
  return { phase: attempts >= webhookAttemptLimit ? "DropWebhook" : "RetryWebhook" };
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function lawNeverCancelCompliance(selectedTurn: boolean): boolean {
  //@ ensures \result === true
  return !earlierWebhookCancellable(selectedTurn, true);
}

/** Story: Handle my pending messages in order while prioritizing consent / A completed STOP clears earlier ordinary rows and errors retry at most five times (spec/webhookInbox.md:30) */
//@ pure
export function sometimesCanRetryWebhook(turn: WebhookTurn): boolean {
  return turn.phase === "RetryWebhook";
}

/** Story: Handle my pending messages in order while prioritizing consent / Report the received row's stored result after draining (spec/webhookInbox.md:56) */
//@ pure
export function webhookAnswer(done: boolean, failed: boolean): WebhookAnswer {
  return done ? "StoredWebhookAnswer" : (failed ? "StoredWebhookFailure" : "WaitForRetry");
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: WebhookTurn, event: Event): boolean {
  if (event.type === "recordHandled") return canRecordHandled(current);
  if (event.type === "recordFailure") return canRecordFailure(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: WebhookTurn, event: Event): WebhookTurn {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordHandled" && canRecordHandled(current)) return recordHandled(current, event.stopCommand);
  if (event.type === "recordFailure" && canRecordFailure(current)) return recordFailure(current, event.attempts);
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
  if (raw.type === "recordHandled" && typeof raw.stopCommand === "boolean") return { type: "recordHandled", stopCommand: raw.stopCommand };
  if (raw.type === "recordFailure" && Number.isSafeInteger(raw.attempts)) return { type: "recordFailure", attempts: raw.attempts };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): WebhookTurn | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "RunningWebhook" || raw.phase === "CancelEarlier" || raw.phase === "WebhookDone" || raw.phase === "RetryWebhook" || raw.phase === "DropWebhook") && Object.keys(raw).length === 1)) return undefined;
  const parsed: WebhookTurn = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): WebhookTurn {
  //@ ensures inv(\result)
  return initial;
}
