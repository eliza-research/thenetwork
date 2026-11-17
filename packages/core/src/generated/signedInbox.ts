// GENERATED from spec/signedInbox.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export type ClaimPhase = "Claiming" | "CheckingPrior" | "RunningTurn" | "CheckingRescue" | "PreservingCompliance" | "ReleasingClaim" | "Finished" | "Replayed" | "Busy" | "Conflict" | "Unresolved" | "RetryCompliance";
/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export interface SignedInbox { phase: ClaimPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "recordClaim"; inserted: boolean; senderLock: boolean; admissionOpen: boolean }
  | { type: "readPrior"; rowPresent: boolean; sameRequest: boolean; responseAvailable: boolean; processing: boolean }
  | { type: "recordCompletion"; saved: boolean }
  | { type: "handleFailure"; compliance: boolean }
  | { type: "checkRescue"; processing: boolean; effectCommitted: boolean }
  | { type: "recordRescue"; changed: boolean };

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export const processingLeaseMs: number = 120000;
/** Story: Handle each signed message once without delaying consent / A completed signed row is later scrubbed and then removed (spec/signedInbox.md) */
export const turnTombstoneKeepMs: number = exact_signedInbox(exact_signedInbox(exact_signedInbox(30 * 24) * 60) * 60000);
/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export const leaseRenewMs: number = 30000;
/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export const unresolvedBlockMs: number = 600000;
/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
export const initial: SignedInbox = { phase: "Claiming" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SignedInbox): boolean {
  return true;
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function mayStartClaimWrite(senderLock: boolean, admissionOpen: boolean): boolean {
  return senderLock && admissionOpen;
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function ordinaryTurnMustWait(compliance: boolean): boolean {
  return !compliance;
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function signedAdmissionOpen(deadlineSet: boolean, at: number, deadline: number): boolean {
  return !deadlineSet || at < deadline;
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function canRecordClaim(turn: SignedInbox): boolean {
  return turn.phase === "Claiming";
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function recordClaim(turn: SignedInbox, inserted: boolean, senderLock: boolean, admissionOpen: boolean): SignedInbox {
  //@ ensures (inv(turn) && canRecordClaim(turn)) ==> stepRetryNeedsReleasedClaim(turn, "recordClaim", \result)
  return { phase: inserted && mayStartClaimWrite(senderLock, admissionOpen) ? "RunningTurn" : "CheckingPrior" };
}

/** Story: Handle each signed message once without delaying consent / A worker runs only a committed claim (spec/signedInbox.md) */
//@ pure
export function lawClaimRunsOnlyUnderLockAndOpenAdmission(inserted: boolean, senderLock: boolean, admissionOpen: boolean): boolean {
  //@ ensures \result === true
  return !(recordClaim(({ phase: "Claiming" } as SignedInbox), inserted, senderLock, admissionOpen).phase === "RunningTurn") || (inserted && senderLock && admissionOpen);
}

/** Story: Handle each signed message once without delaying consent / A replay must match a stored request (spec/signedInbox.md) */
//@ pure
export function canReadPrior(turn: SignedInbox): boolean {
  return turn.phase === "CheckingPrior";
}

/** Story: Handle each signed message once without delaying consent / A replay must match a stored request (spec/signedInbox.md) */
//@ pure
export function readPrior(turn: SignedInbox, rowPresent: boolean, sameRequest: boolean, responseAvailable: boolean, processing: boolean): SignedInbox {
  //@ ensures (inv(turn) && canReadPrior(turn)) ==> stepRetryNeedsReleasedClaim(turn, "readPrior", \result)
  return !rowPresent ? ({ phase: "Busy" } as SignedInbox) : (!sameRequest ? ({ phase: "Conflict" } as SignedInbox) : (responseAvailable ? ({ phase: "Replayed" } as SignedInbox) : ({ phase: processing ? "Busy" : "Unresolved" } as SignedInbox)));
}

/** Story: Handle each signed message once without delaying consent / A replay must match a stored request (spec/signedInbox.md) */
//@ pure
export function lawChangedRequestConflicts(responseAvailable: boolean, processing: boolean): boolean {
  //@ ensures \result === true
  return readPrior(({ phase: "CheckingPrior" } as SignedInbox), true, false, responseAvailable, processing).phase === "Conflict";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function canRecordCompletion(turn: SignedInbox): boolean {
  return turn.phase === "RunningTurn";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function recordCompletion(turn: SignedInbox, saved: boolean): SignedInbox {
  //@ ensures (inv(turn) && canRecordCompletion(turn)) ==> stepRetryNeedsReleasedClaim(turn, "recordCompletion", \result)
  return saved ? ({ phase: "Finished" } as SignedInbox) : turn;
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function canHandleFailure(turn: SignedInbox): boolean {
  return turn.phase === "RunningTurn";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function handleFailure(turn: SignedInbox, compliance: boolean): SignedInbox {
  //@ ensures (inv(turn) && canHandleFailure(turn)) ==> stepRetryNeedsReleasedClaim(turn, "handleFailure", \result)
  return { phase: compliance ? "CheckingRescue" : "Unresolved" };
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function canCheckRescue(turn: SignedInbox): boolean {
  return turn.phase === "CheckingRescue";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function checkRescue(turn: SignedInbox, processing: boolean, effectCommitted: boolean): SignedInbox {
  //@ ensures (inv(turn) && canCheckRescue(turn)) ==> stepRetryNeedsReleasedClaim(turn, "checkRescue", \result)
  return !processing ? ({ phase: "Unresolved" } as SignedInbox) : ({ phase: effectCommitted ? "PreservingCompliance" : "ReleasingClaim" } as SignedInbox);
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function canRecordRescue(turn: SignedInbox): boolean {
  return turn.phase === "PreservingCompliance" || turn.phase === "ReleasingClaim";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function recordRescue(turn: SignedInbox, changed: boolean): SignedInbox {
  //@ ensures (inv(turn) && canRecordRescue(turn)) ==> stepRetryNeedsReleasedClaim(turn, "recordRescue", \result)
  return !changed ? ({ phase: "Unresolved" } as SignedInbox) : ({ phase: turn.phase === "PreservingCompliance" ? "Finished" : "RetryCompliance" } as SignedInbox);
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function stepRetryNeedsReleasedClaim(before: SignedInbox, via: string, after: SignedInbox): boolean {
  return !(after.phase === "RetryCompliance") || (before.phase === "ReleasingClaim" && via === "recordRescue");
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function sometimesCanReplay(turn: SignedInbox): boolean {
  return turn.phase === "Replayed";
}

/** Story: Handle each signed message once without delaying consent / Completion and compliance recovery depend on the stored row (spec/signedInbox.md) */
//@ pure
export function sometimesCanRetryCompliance(turn: SignedInbox): boolean {
  return turn.phase === "RetryCompliance";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SignedInbox, event: Event): boolean {
  if (event.type === "recordClaim") return canRecordClaim(current);
  if (event.type === "readPrior") return canReadPrior(current);
  if (event.type === "recordCompletion") return canRecordCompletion(current);
  if (event.type === "handleFailure") return canHandleFailure(current);
  if (event.type === "checkRescue") return canCheckRescue(current);
  if (event.type === "recordRescue") return canRecordRescue(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SignedInbox, event: Event): SignedInbox {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "recordClaim" && canRecordClaim(current)) return recordClaim(current, event.inserted, event.senderLock, event.admissionOpen);
  if (event.type === "readPrior" && canReadPrior(current)) return readPrior(current, event.rowPresent, event.sameRequest, event.responseAvailable, event.processing);
  if (event.type === "recordCompletion" && canRecordCompletion(current)) return recordCompletion(current, event.saved);
  if (event.type === "handleFailure" && canHandleFailure(current)) return handleFailure(current, event.compliance);
  if (event.type === "checkRescue" && canCheckRescue(current)) return checkRescue(current, event.processing, event.effectCommitted);
  if (event.type === "recordRescue" && canRecordRescue(current)) return recordRescue(current, event.changed);
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
  if (raw.type === "recordClaim" && typeof raw.inserted === "boolean" && typeof raw.senderLock === "boolean" && typeof raw.admissionOpen === "boolean") return { type: "recordClaim", inserted: raw.inserted, senderLock: raw.senderLock, admissionOpen: raw.admissionOpen };
  if (raw.type === "readPrior" && typeof raw.rowPresent === "boolean" && typeof raw.sameRequest === "boolean" && typeof raw.responseAvailable === "boolean" && typeof raw.processing === "boolean") return { type: "readPrior", rowPresent: raw.rowPresent, sameRequest: raw.sameRequest, responseAvailable: raw.responseAvailable, processing: raw.processing };
  if (raw.type === "recordCompletion" && typeof raw.saved === "boolean") return { type: "recordCompletion", saved: raw.saved };
  if (raw.type === "handleFailure" && typeof raw.compliance === "boolean") return { type: "handleFailure", compliance: raw.compliance };
  if (raw.type === "checkRescue" && typeof raw.processing === "boolean" && typeof raw.effectCommitted === "boolean") return { type: "checkRescue", processing: raw.processing, effectCommitted: raw.effectCommitted };
  if (raw.type === "recordRescue" && typeof raw.changed === "boolean") return { type: "recordRescue", changed: raw.changed };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SignedInbox | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Claiming" || raw.phase === "CheckingPrior" || raw.phase === "RunningTurn" || raw.phase === "CheckingRescue" || raw.phase === "PreservingCompliance" || raw.phase === "ReleasingClaim" || raw.phase === "Finished" || raw.phase === "Replayed" || raw.phase === "Busy" || raw.phase === "Conflict" || raw.phase === "Unresolved" || raw.phase === "RetryCompliance") && Object.keys(raw).length === 1)) return undefined;
  const parsed: SignedInbox = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SignedInbox {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_signedInbox(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
