// GENERATED from spec/phoneChange.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export type CurrentPhone = "OwnedPhone" | "UnavailablePhone" | "WrongPerson";
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export type MovePolicy = "MoveAllowed" | "MoveBlocked" | "NumberTaken";
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export type PhoneChangePhase = "Beginning" | "CheckingStartOwner" | "CheckingConfirmOwner" | "CheckingStartPolicy" | "AwaitingRateLimit" | "AwaitingCodeSend" | "AwaitingPendingWrite" | "PendingRecorded" | "AwaitingPendingRead" | "AwaitingVerification" | "AwaitingMovePolicy" | "AwaitingMove" | "Moved" | "Refused";
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export type MoveOutcome = "MoveApplied" | "MoveNumberTaken" | "MoveMissingPhone";
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export type PhoneChangeFailure = "NoFailure" | "SameNumber" | "ReviewNeeded" | "NoPerson" | "RateLimited" | "NoPendingChange" | "InvalidCode" | "NumberInUse";
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export interface PhoneChange { phase: PhoneChangePhase; failure: PhoneChangeFailure; codeVerified: boolean; moveAllowed: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "requestChallenge"; sameNumber: boolean }
  | { type: "beginConfirmation" }
  | { type: "checkCurrentPhone"; ownership: CurrentPhone }
  | { type: "checkStartPolicy"; oldNumberAllowed: boolean }
  | { type: "checkStartRate"; slotGranted: boolean }
  | { type: "recordCodeSend"; sendAccepted: boolean }
  | { type: "recordPendingWrite" }
  | { type: "readPending"; hasTarget: boolean; elapsedMs: number }
  | { type: "recordVerification"; otpVerified: boolean }
  | { type: "checkMovePolicy"; policy: MovePolicy }
  | { type: "recordMove"; moveResult: MoveOutcome };

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
export const phoneChangesPerDay: number = 3;
/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
export const phoneChangeLifetimeMs: number = exact_phoneChange(exact_phoneChange(15 * 60) * 1000);
/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
export const initial: PhoneChange = { phase: "Beginning", failure: "NoFailure", codeVerified: false, moveAllowed: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhoneChange): boolean {
  return alwaysMoveRequiresProof(current);
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function canRequestChallenge(change: PhoneChange): boolean {
  return change.phase === "Beginning";
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function requestChallenge(change: PhoneChange, sameNumber: boolean): PhoneChange {
  //@ ensures (inv(change) && canRequestChallenge(change)) ==> alwaysMoveRequiresProof(\result)
  return sameNumber ? ({ ...change, phase: "Refused", failure: "SameNumber" } as PhoneChange) : ({ ...change, phase: "CheckingStartOwner" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function canBeginConfirmation(change: PhoneChange): boolean {
  return change.phase === "Beginning";
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function beginConfirmation(change: PhoneChange): PhoneChange {
  //@ ensures (inv(change) && canBeginConfirmation(change)) ==> alwaysMoveRequiresProof(\result)
  return { ...change, phase: "CheckingConfirmOwner" };
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function canCheckCurrentPhone(change: PhoneChange): boolean {
  return change.phase === "CheckingStartOwner" || change.phase === "CheckingConfirmOwner";
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function checkCurrentPhone(change: PhoneChange, ownership: CurrentPhone): PhoneChange {
  //@ ensures (inv(change) && canCheckCurrentPhone(change)) ==> alwaysMoveRequiresProof(\result)
  return ownership === "UnavailablePhone" ? ({ ...change, phase: "Refused", failure: "ReviewNeeded" } as PhoneChange) : (ownership === "WrongPerson" ? ({ ...change, phase: "Refused", failure: "NoPerson" } as PhoneChange) : ({ ...change, phase: change.phase === "CheckingStartOwner" ? "CheckingStartPolicy" : "AwaitingPendingRead" } as PhoneChange));
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function canCheckStartPolicy(change: PhoneChange): boolean {
  return change.phase === "CheckingStartPolicy";
}

/** Story: Keep my account when my phone changes / The request uses the existing account (spec/phoneChange.md) */
//@ pure
export function checkStartPolicy(change: PhoneChange, oldNumberAllowed: boolean): PhoneChange {
  //@ ensures (inv(change) && canCheckStartPolicy(change)) ==> alwaysMoveRequiresProof(\result)
  return oldNumberAllowed ? ({ ...change, phase: "AwaitingRateLimit" } as PhoneChange) : ({ ...change, phase: "Refused", failure: "ReviewNeeded" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function canCheckStartRate(change: PhoneChange): boolean {
  return change.phase === "AwaitingRateLimit";
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function checkStartRate(change: PhoneChange, slotGranted: boolean): PhoneChange {
  //@ ensures (inv(change) && canCheckStartRate(change)) ==> alwaysMoveRequiresProof(\result)
  return slotGranted ? ({ ...change, phase: "AwaitingCodeSend" } as PhoneChange) : ({ ...change, phase: "Refused", failure: "RateLimited" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function canRecordCodeSend(change: PhoneChange): boolean {
  return change.phase === "AwaitingCodeSend";
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function recordCodeSend(change: PhoneChange, sendAccepted: boolean): PhoneChange {
  //@ ensures (inv(change) && canRecordCodeSend(change)) ==> alwaysMoveRequiresProof(\result)
  return sendAccepted ? ({ ...change, phase: "AwaitingPendingWrite" } as PhoneChange) : ({ ...change, phase: "Refused", failure: "RateLimited" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function canRecordPendingWrite(change: PhoneChange): boolean {
  return change.phase === "AwaitingPendingWrite";
}

/** Story: Keep my account when my phone changes / A challenge needs a send slot and a persisted request (spec/phoneChange.md) */
//@ pure
export function recordPendingWrite(change: PhoneChange): PhoneChange {
  //@ ensures (inv(change) && canRecordPendingWrite(change)) ==> alwaysMoveRequiresProof(\result)
  return { ...change, phase: "PendingRecorded" };
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function pendingWindowOpen(elapsedMs: number): boolean {
  return !(elapsedMs > phoneChangeLifetimeMs);
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function lawWindowIncludesDeadline(offsetMs: number): boolean {
  //@ ensures \result === true
  return !(offsetMs === phoneChangeLifetimeMs) || pendingWindowOpen(offsetMs);
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function canReadPending(change: PhoneChange): boolean {
  return change.phase === "AwaitingPendingRead";
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function readPending(change: PhoneChange, hasTarget: boolean, elapsedMs: number): PhoneChange {
  //@ ensures (inv(change) && canReadPending(change)) ==> alwaysMoveRequiresProof(\result)
  return hasTarget && pendingWindowOpen(elapsedMs) ? ({ ...change, phase: "AwaitingVerification" } as PhoneChange) : ({ ...change, phase: "Refused", failure: "NoPendingChange" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function canRecordVerification(change: PhoneChange): boolean {
  return change.phase === "AwaitingVerification";
}

/** Story: Keep my account when my phone changes / A live pending request needs a valid code (spec/phoneChange.md) */
//@ pure
export function recordVerification(change: PhoneChange, otpVerified: boolean): PhoneChange {
  //@ ensures (inv(change) && canRecordVerification(change)) ==> alwaysMoveRequiresProof(\result)
  return otpVerified ? ({ ...change, phase: "AwaitingMovePolicy", codeVerified: true } as PhoneChange) : ({ ...change, phase: "Refused", failure: "InvalidCode" } as PhoneChange);
}

/** Story: Keep my account when my phone changes / The verified request can move only when both numbers allow it (spec/phoneChange.md) */
//@ pure
export function canCheckMovePolicy(change: PhoneChange): boolean {
  return change.phase === "AwaitingMovePolicy" && change.codeVerified;
}

/** Story: Keep my account when my phone changes / The verified request can move only when both numbers allow it (spec/phoneChange.md) */
//@ pure
export function checkMovePolicy(change: PhoneChange, policy: MovePolicy): PhoneChange {
  //@ ensures (inv(change) && canCheckMovePolicy(change)) ==> alwaysMoveRequiresProof(\result)
  return policy === "MoveBlocked" ? ({ ...change, phase: "Refused", failure: "ReviewNeeded" } as PhoneChange) : (policy === "NumberTaken" ? ({ ...change, phase: "Refused", failure: "NumberInUse" } as PhoneChange) : ({ ...change, phase: "AwaitingMove", moveAllowed: true } as PhoneChange));
}

/** Story: Keep my account when my phone changes / The verified request can move only when both numbers allow it (spec/phoneChange.md) */
//@ pure
export function canRecordMove(change: PhoneChange): boolean {
  return change.phase === "AwaitingMove" && change.codeVerified && change.moveAllowed;
}

/** Story: Keep my account when my phone changes / The verified request can move only when both numbers allow it (spec/phoneChange.md) */
//@ pure
export function recordMove(change: PhoneChange, moveResult: MoveOutcome): PhoneChange {
  //@ ensures (inv(change) && canRecordMove(change)) ==> alwaysMoveRequiresProof(\result)
  return moveResult === "MoveApplied" ? ({ ...change, phase: "Moved" } as PhoneChange) : (moveResult === "MoveNumberTaken" ? ({ ...change, phase: "Refused", failure: "NumberInUse" } as PhoneChange) : ({ ...change, phase: "Refused", failure: "ReviewNeeded" } as PhoneChange));
}

/** Story: Keep my account when my phone changes / Reporting a move requires both the new code and current move authority (spec/phoneChange.md) */
//@ pure
export function alwaysMoveRequiresProof(change: PhoneChange): boolean {
  return !(change.phase === "AwaitingMove" || change.phase === "Moved") || (change.codeVerified && change.moveAllowed);
}

/** Story: Keep my account when my phone changes / Reporting a move requires both the new code and current move authority (spec/phoneChange.md) */
//@ pure
export function sometimesPendingRecorded(change: PhoneChange): boolean {
  return change.phase === "PendingRecorded";
}

/** Story: Keep my account when my phone changes / Reporting a move requires both the new code and current move authority (spec/phoneChange.md) */
//@ pure
export function sometimesMoved(change: PhoneChange): boolean {
  return change.phase === "Moved";
}

/** Story: Keep my account when my phone changes / Reporting a move requires both the new code and current move authority (spec/phoneChange.md) */
//@ pure
export function sometimesRefusesCode(change: PhoneChange): boolean {
  return change.failure === "InvalidCode";
}

/** Story: Keep my account when my phone changes / Reporting a move requires both the new code and current move authority (spec/phoneChange.md) */
//@ pure
export function sometimesRefusesTakenNumber(change: PhoneChange): boolean {
  return change.failure === "NumberInUse";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhoneChange, event: Event): boolean {
  if (event.type === "requestChallenge") return canRequestChallenge(current);
  if (event.type === "beginConfirmation") return canBeginConfirmation(current);
  if (event.type === "checkCurrentPhone") return canCheckCurrentPhone(current);
  if (event.type === "checkStartPolicy") return canCheckStartPolicy(current);
  if (event.type === "checkStartRate") return canCheckStartRate(current);
  if (event.type === "recordCodeSend") return canRecordCodeSend(current);
  if (event.type === "recordPendingWrite") return canRecordPendingWrite(current);
  if (event.type === "readPending") return canReadPending(current);
  if (event.type === "recordVerification") return canRecordVerification(current);
  if (event.type === "checkMovePolicy") return canCheckMovePolicy(current);
  if (event.type === "recordMove") return canRecordMove(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhoneChange, event: Event): PhoneChange {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "requestChallenge" && canRequestChallenge(current)) return requestChallenge(current, event.sameNumber);
  if (event.type === "beginConfirmation" && canBeginConfirmation(current)) return beginConfirmation(current);
  if (event.type === "checkCurrentPhone" && canCheckCurrentPhone(current)) return checkCurrentPhone(current, event.ownership);
  if (event.type === "checkStartPolicy" && canCheckStartPolicy(current)) return checkStartPolicy(current, event.oldNumberAllowed);
  if (event.type === "checkStartRate" && canCheckStartRate(current)) return checkStartRate(current, event.slotGranted);
  if (event.type === "recordCodeSend" && canRecordCodeSend(current)) return recordCodeSend(current, event.sendAccepted);
  if (event.type === "recordPendingWrite" && canRecordPendingWrite(current)) return recordPendingWrite(current);
  if (event.type === "readPending" && canReadPending(current)) return readPending(current, event.hasTarget, event.elapsedMs);
  if (event.type === "recordVerification" && canRecordVerification(current)) return recordVerification(current, event.otpVerified);
  if (event.type === "checkMovePolicy" && canCheckMovePolicy(current)) return checkMovePolicy(current, event.policy);
  if (event.type === "recordMove" && canRecordMove(current)) return recordMove(current, event.moveResult);
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
  if (raw.type === "requestChallenge" && typeof raw.sameNumber === "boolean") return { type: "requestChallenge", sameNumber: raw.sameNumber };
  if (raw.type === "beginConfirmation") return { type: "beginConfirmation" };
  if (raw.type === "checkCurrentPhone" && (raw.ownership === "OwnedPhone" || raw.ownership === "UnavailablePhone" || raw.ownership === "WrongPerson")) return { type: "checkCurrentPhone", ownership: raw.ownership };
  if (raw.type === "checkStartPolicy" && typeof raw.oldNumberAllowed === "boolean") return { type: "checkStartPolicy", oldNumberAllowed: raw.oldNumberAllowed };
  if (raw.type === "checkStartRate" && typeof raw.slotGranted === "boolean") return { type: "checkStartRate", slotGranted: raw.slotGranted };
  if (raw.type === "recordCodeSend" && typeof raw.sendAccepted === "boolean") return { type: "recordCodeSend", sendAccepted: raw.sendAccepted };
  if (raw.type === "recordPendingWrite") return { type: "recordPendingWrite" };
  if (raw.type === "readPending" && typeof raw.hasTarget === "boolean" && Number.isSafeInteger(raw.elapsedMs)) return { type: "readPending", hasTarget: raw.hasTarget, elapsedMs: raw.elapsedMs };
  if (raw.type === "recordVerification" && typeof raw.otpVerified === "boolean") return { type: "recordVerification", otpVerified: raw.otpVerified };
  if (raw.type === "checkMovePolicy" && (raw.policy === "MoveAllowed" || raw.policy === "MoveBlocked" || raw.policy === "NumberTaken")) return { type: "checkMovePolicy", policy: raw.policy };
  if (raw.type === "recordMove" && (raw.moveResult === "MoveApplied" || raw.moveResult === "MoveNumberTaken" || raw.moveResult === "MoveMissingPhone")) return { type: "recordMove", moveResult: raw.moveResult };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhoneChange | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "CheckingStartOwner" || raw.phase === "CheckingConfirmOwner" || raw.phase === "CheckingStartPolicy" || raw.phase === "AwaitingRateLimit" || raw.phase === "AwaitingCodeSend" || raw.phase === "AwaitingPendingWrite" || raw.phase === "PendingRecorded" || raw.phase === "AwaitingPendingRead" || raw.phase === "AwaitingVerification" || raw.phase === "AwaitingMovePolicy" || raw.phase === "AwaitingMove" || raw.phase === "Moved" || raw.phase === "Refused") && (raw.failure === "NoFailure" || raw.failure === "SameNumber" || raw.failure === "ReviewNeeded" || raw.failure === "NoPerson" || raw.failure === "RateLimited" || raw.failure === "NoPendingChange" || raw.failure === "InvalidCode" || raw.failure === "NumberInUse") && typeof raw.codeVerified === "boolean" && typeof raw.moveAllowed === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: PhoneChange = ({ phase: raw.phase, failure: raw.failure, codeVerified: raw.codeVerified, moveAllowed: raw.moveAllowed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhoneChange {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_phoneChange(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
