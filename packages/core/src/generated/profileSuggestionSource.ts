// GENERATED from spec/profileSuggestionSource.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
export type SourcePhase = "SourceInitial" | "SourceDenied" | "CheckingCollectionTurn" | "CheckingLiveSources" | "ReadingCollectionReceipt" | "ReplayingCollection" | "CollectionReadyToReplay" | "SavingCollection" | "CollectionReadyToSave" | "CheckingWithdrawalTurn" | "ReadingCleanupReceipt" | "ReplayingCleanup" | "ApplyingCleanup" | "CleanupConfirmed";
/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
export interface SourceFlow { phase: SourcePhase }
/** Story: Stop collection or remove data from one connector / Cleanup changes only rows selected by the member's operation (spec/profileSuggestionSource.md) */
export type SuggestionCleanupAction = "KeepSuggestion" | "ScrubSuggestion" | "DeleteSuggestion";

/** One variant per transition in the spec. */
export type Event =
  | { type: "startSourceCollection"; eligible: boolean; claimed: boolean }
  | { type: "readCollectionTurn"; matches: boolean }
  | { type: "readLiveSourceConsent"; allowed: boolean; stillEligible: boolean }
  | { type: "readCollectionReceipt"; prior: boolean; matches: boolean }
  | { type: "checkCollectionReplay"; revision: number; sameCount: boolean; onlyPending: boolean }
  | { type: "checkCollectionSave"; receiptCount: number; batchIdUnused: boolean }
  | { type: "startSourceCleanup"; authorized: boolean; ownerWithdrawal: boolean }
  | { type: "readWithdrawalTurn"; matches: boolean }
  | { type: "readCleanupReceipt"; prior: boolean; matches: boolean }
  | { type: "confirmSourceCleanup"; authorized: boolean };

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
export const collectionReceiptLimit: number = 16;
/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
export const initial: SourceFlow = { phase: "SourceInitial" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SourceFlow): boolean {
  return true;
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function sourceUseAllowed(allowed: boolean, stillEligible: boolean): boolean {
  return allowed && stillEligible;
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function startSourceCollection(flow: SourceFlow, eligible: boolean, claimed: boolean): SourceFlow {
  //@ ensures (inv(flow) && canStartSourceCollection(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "startSourceCollection", \result)
  //@ ensures (inv(flow) && canStartSourceCollection(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "startSourceCollection", \result)
  //@ ensures (inv(flow) && canStartSourceCollection(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "startSourceCollection", \result)
  return { phase: !eligible ? "SourceDenied" : (claimed ? "CheckingCollectionTurn" : "CheckingLiveSources") };
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function canReadCollectionTurn(flow: SourceFlow): boolean {
  return flow.phase === "CheckingCollectionTurn";
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function readCollectionTurn(flow: SourceFlow, matches: boolean): SourceFlow {
  //@ ensures (inv(flow) && canReadCollectionTurn(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "readCollectionTurn", \result)
  //@ ensures (inv(flow) && canReadCollectionTurn(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "readCollectionTurn", \result)
  //@ ensures (inv(flow) && canReadCollectionTurn(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "readCollectionTurn", \result)
  return { phase: matches ? "CheckingLiveSources" : "SourceDenied" };
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function canReadLiveSourceConsent(flow: SourceFlow): boolean {
  return flow.phase === "CheckingLiveSources";
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function readLiveSourceConsent(flow: SourceFlow, allowed: boolean, stillEligible: boolean): SourceFlow {
  //@ ensures (inv(flow) && canReadLiveSourceConsent(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "readLiveSourceConsent", \result)
  //@ ensures (inv(flow) && canReadLiveSourceConsent(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "readLiveSourceConsent", \result)
  //@ ensures (inv(flow) && canReadLiveSourceConsent(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "readLiveSourceConsent", \result)
  return { phase: sourceUseAllowed(allowed, stillEligible) ? "ReadingCollectionReceipt" : "SourceDenied" };
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function lawSourceUseNeedsCurrentEligibility(allowed: boolean): boolean {
  //@ ensures \result === true
  return !sourceUseAllowed(allowed, false);
}

/** Story: Collect suggestions from sources I authorized / Resolve the owner and any claimed collection turn before authorizing live sources (spec/profileSuggestionSource.md) */
//@ pure
export function canStartSourceCollection(flow: SourceFlow): boolean {
  return flow.phase === "SourceInitial";
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function collectionRevisionIsOriginal(revision: number): boolean {
  return revision === 1;
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function collectionPreviewUnchanged(sameCount: boolean, onlyPending: boolean): boolean {
  return sameCount && onlyPending;
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function collectionReceiptHasRoom(count: number): boolean {
  return count >= 0 && count < collectionReceiptLimit;
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function canReadCollectionReceipt(flow: SourceFlow): boolean {
  return flow.phase === "ReadingCollectionReceipt";
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function readCollectionReceipt(flow: SourceFlow, prior: boolean, matches: boolean): SourceFlow {
  //@ ensures (inv(flow) && canReadCollectionReceipt(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "readCollectionReceipt", \result)
  //@ ensures (inv(flow) && canReadCollectionReceipt(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "readCollectionReceipt", \result)
  //@ ensures (inv(flow) && canReadCollectionReceipt(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "readCollectionReceipt", \result)
  return { phase: !prior ? "SavingCollection" : (matches ? "ReplayingCollection" : "SourceDenied") };
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function canCheckCollectionReplay(flow: SourceFlow): boolean {
  return flow.phase === "ReplayingCollection";
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function checkCollectionReplay(flow: SourceFlow, revision: number, sameCount: boolean, onlyPending: boolean): SourceFlow {
  //@ ensures (inv(flow) && canCheckCollectionReplay(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "checkCollectionReplay", \result)
  //@ ensures (inv(flow) && canCheckCollectionReplay(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "checkCollectionReplay", \result)
  //@ ensures (inv(flow) && canCheckCollectionReplay(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "checkCollectionReplay", \result)
  return { phase: collectionRevisionIsOriginal(revision) && collectionPreviewUnchanged(sameCount, onlyPending) ? "CollectionReadyToReplay" : "SourceDenied" };
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function canCheckCollectionSave(flow: SourceFlow): boolean {
  return flow.phase === "SavingCollection";
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function checkCollectionSave(flow: SourceFlow, receiptCount: number, batchIdUnused: boolean): SourceFlow {
  //@ ensures (inv(flow) && canCheckCollectionSave(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "checkCollectionSave", \result)
  //@ ensures (inv(flow) && canCheckCollectionSave(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "checkCollectionSave", \result)
  //@ ensures (inv(flow) && canCheckCollectionSave(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "checkCollectionSave", \result)
  return { phase: collectionReceiptHasRoom(receiptCount) && batchIdUnused ? "CollectionReadyToSave" : "SourceDenied" };
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function stepCollectionReplayNeedsOriginalPreview(before: SourceFlow, via: string, after: SourceFlow): boolean {
  return !(after.phase === "CollectionReadyToReplay") || (before.phase === "ReplayingCollection" && via === "checkCollectionReplay");
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function stepCollectionSaveNeedsCapacity(before: SourceFlow, via: string, after: SourceFlow): boolean {
  return !(after.phase === "CollectionReadyToSave") || (before.phase === "SavingCollection" && via === "checkCollectionSave");
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function stepCollectionSaveRequiresReceiptCheck(before: SourceFlow, via: string, after: SourceFlow): boolean {
  return !(after.phase === "SavingCollection") || (before.phase === "ReadingCollectionReceipt" && via === "readCollectionReceipt");
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function sometimesSavesSourceCollection(flow: SourceFlow): boolean {
  return flow.phase === "CollectionReadyToSave";
}

/** Story: Collect suggestions from sources I authorized / A collection replay only returns its original private pending batch (spec/profileSuggestionSource.md) */
//@ pure
export function sometimesReplaysSourceCollection(flow: SourceFlow): boolean {
  return flow.phase === "CollectionReadyToReplay";
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function cleanupCoversGrant(cutoffAt: number, authorizedAt: number): boolean {
  return authorizedAt <= cutoffAt;
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function lawCleanupCoversGrantAtSameTime(authorizedAt: number): boolean {
  //@ ensures \result === true
  return cleanupCoversGrant(authorizedAt, authorizedAt);
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function lawCleanupMissesLaterGrant(cutoffAt: number): boolean {
  //@ ensures \result === true
  return !cleanupCoversGrant(cutoffAt, exact_profileSuggestionSource(cutoffAt + 1));
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function lawLegacyRowIsCovered(cutoffAt: number): boolean {
  //@ ensures \result === true
  return !(cutoffAt >= 0) || cleanupCoversGrant(cutoffAt, 0);
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function canStartSourceCleanup(flow: SourceFlow): boolean {
  return flow.phase === "SourceInitial";
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function startSourceCleanup(flow: SourceFlow, authorized: boolean, ownerWithdrawal: boolean): SourceFlow {
  //@ ensures (inv(flow) && canStartSourceCleanup(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "startSourceCleanup", \result)
  //@ ensures (inv(flow) && canStartSourceCleanup(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "startSourceCleanup", \result)
  //@ ensures (inv(flow) && canStartSourceCleanup(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "startSourceCleanup", \result)
  return { phase: !authorized ? "SourceDenied" : (ownerWithdrawal ? "CheckingWithdrawalTurn" : "ReadingCleanupReceipt") };
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function canReadWithdrawalTurn(flow: SourceFlow): boolean {
  return flow.phase === "CheckingWithdrawalTurn";
}

/** Story: Stop collection or remove data from one connector / Cleanup uses current owner authority and any required stored withdrawal turn (spec/profileSuggestionSource.md) */
//@ pure
export function readWithdrawalTurn(flow: SourceFlow, matches: boolean): SourceFlow {
  //@ ensures (inv(flow) && canReadWithdrawalTurn(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "readWithdrawalTurn", \result)
  //@ ensures (inv(flow) && canReadWithdrawalTurn(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "readWithdrawalTurn", \result)
  //@ ensures (inv(flow) && canReadWithdrawalTurn(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "readWithdrawalTurn", \result)
  return { phase: matches ? "ReadingCleanupReceipt" : "SourceDenied" };
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function ownerCleanupUsesReceipt(operation: string): boolean {
  return operation !== "readback";
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function canReadCleanupReceipt(flow: SourceFlow): boolean {
  return flow.phase === "ReadingCleanupReceipt";
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function readCleanupReceipt(flow: SourceFlow, prior: boolean, matches: boolean): SourceFlow {
  //@ ensures (inv(flow) && canReadCleanupReceipt(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "readCleanupReceipt", \result)
  //@ ensures (inv(flow) && canReadCleanupReceipt(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "readCleanupReceipt", \result)
  //@ ensures (inv(flow) && canReadCleanupReceipt(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "readCleanupReceipt", \result)
  return { phase: !prior ? "ApplyingCleanup" : (matches ? "ReplayingCleanup" : "SourceDenied") };
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function canConfirmSourceCleanup(flow: SourceFlow): boolean {
  return flow.phase === "ApplyingCleanup" || flow.phase === "ReplayingCleanup";
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function confirmSourceCleanup(flow: SourceFlow, authorized: boolean): SourceFlow {
  //@ ensures (inv(flow) && canConfirmSourceCleanup(flow)) ==> stepCollectionReplayNeedsOriginalPreview(flow, "confirmSourceCleanup", \result)
  //@ ensures (inv(flow) && canConfirmSourceCleanup(flow)) ==> stepCollectionSaveNeedsCapacity(flow, "confirmSourceCleanup", \result)
  //@ ensures (inv(flow) && canConfirmSourceCleanup(flow)) ==> stepCollectionSaveRequiresReceiptCheck(flow, "confirmSourceCleanup", \result)
  return { phase: authorized ? "CleanupConfirmed" : "SourceDenied" };
}

/** Story: Stop collection or remove data from one connector / Replay returns stored results without mutating the suggestions (spec/profileSuggestionSource.md) */
//@ pure
export function sometimesConfirmsSourceCleanup(flow: SourceFlow): boolean {
  return flow.phase === "CleanupConfirmed";
}

/** Story: Stop collection or remove data from one connector / Cleanup changes only rows selected by the member's operation (spec/profileSuggestionSource.md) */
//@ pure
export function suggestionCleanupAction(operation: string, status: string, retainAccepted: boolean): SuggestionCleanupAction {
  return operation === "readback" ? "KeepSuggestion" : (operation === "disconnect" && status === "accepted" && retainAccepted ? "KeepSuggestion" : (operation === "withdraw" && status !== "proposed" ? "KeepSuggestion" : (operation === "delete" ? "DeleteSuggestion" : "ScrubSuggestion")));
}

/** Story: Stop collection or remove data from one connector / Cleanup changes only rows selected by the member's operation (spec/profileSuggestionSource.md) */
//@ pure
export function lawReadbackPreservesSuggestion(status: string, retainAccepted: boolean): boolean {
  //@ ensures \result === true
  return suggestionCleanupAction("readback", status, retainAccepted) === "KeepSuggestion";
}

/** Story: Stop collection or remove data from one connector / Cleanup changes only rows selected by the member's operation (spec/profileSuggestionSource.md) */
//@ pure
export function lawWithdrawalPreservesAcceptedSuggestion(retainAccepted: boolean): boolean {
  //@ ensures \result === true
  return suggestionCleanupAction("withdraw", "accepted", retainAccepted) === "KeepSuggestion";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SourceFlow, event: Event): boolean {
  if (event.type === "startSourceCollection") return canStartSourceCollection(current);
  if (event.type === "readCollectionTurn") return canReadCollectionTurn(current);
  if (event.type === "readLiveSourceConsent") return canReadLiveSourceConsent(current);
  if (event.type === "readCollectionReceipt") return canReadCollectionReceipt(current);
  if (event.type === "checkCollectionReplay") return canCheckCollectionReplay(current);
  if (event.type === "checkCollectionSave") return canCheckCollectionSave(current);
  if (event.type === "startSourceCleanup") return canStartSourceCleanup(current);
  if (event.type === "readWithdrawalTurn") return canReadWithdrawalTurn(current);
  if (event.type === "readCleanupReceipt") return canReadCleanupReceipt(current);
  if (event.type === "confirmSourceCleanup") return canConfirmSourceCleanup(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SourceFlow, event: Event): SourceFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "startSourceCollection") return canStartSourceCollection(current) ? startSourceCollection(current, event.eligible, event.claimed) : current;
  if (event.type === "readCollectionTurn") return canReadCollectionTurn(current) ? readCollectionTurn(current, event.matches) : current;
  if (event.type === "readLiveSourceConsent") return canReadLiveSourceConsent(current) ? readLiveSourceConsent(current, event.allowed, event.stillEligible) : current;
  if (event.type === "readCollectionReceipt") return canReadCollectionReceipt(current) ? readCollectionReceipt(current, event.prior, event.matches) : current;
  if (event.type === "checkCollectionReplay") return canCheckCollectionReplay(current) ? checkCollectionReplay(current, event.revision, event.sameCount, event.onlyPending) : current;
  if (event.type === "checkCollectionSave") return canCheckCollectionSave(current) ? checkCollectionSave(current, event.receiptCount, event.batchIdUnused) : current;
  if (event.type === "startSourceCleanup") return canStartSourceCleanup(current) ? startSourceCleanup(current, event.authorized, event.ownerWithdrawal) : current;
  if (event.type === "readWithdrawalTurn") return canReadWithdrawalTurn(current) ? readWithdrawalTurn(current, event.matches) : current;
  if (event.type === "readCleanupReceipt") return canReadCleanupReceipt(current) ? readCleanupReceipt(current, event.prior, event.matches) : current;
  if (event.type === "confirmSourceCleanup") return canConfirmSourceCleanup(current) ? confirmSourceCleanup(current, event.authorized) : current;
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
  if (raw.type === "startSourceCollection" && typeof raw.eligible === "boolean" && typeof raw.claimed === "boolean") return { type: "startSourceCollection", eligible: raw.eligible, claimed: raw.claimed };
  if (raw.type === "readCollectionTurn" && typeof raw.matches === "boolean") return { type: "readCollectionTurn", matches: raw.matches };
  if (raw.type === "readLiveSourceConsent" && typeof raw.allowed === "boolean" && typeof raw.stillEligible === "boolean") return { type: "readLiveSourceConsent", allowed: raw.allowed, stillEligible: raw.stillEligible };
  if (raw.type === "readCollectionReceipt" && typeof raw.prior === "boolean" && typeof raw.matches === "boolean") return { type: "readCollectionReceipt", prior: raw.prior, matches: raw.matches };
  if (raw.type === "checkCollectionReplay" && Number.isSafeInteger(raw.revision) && typeof raw.sameCount === "boolean" && typeof raw.onlyPending === "boolean") return { type: "checkCollectionReplay", revision: raw.revision, sameCount: raw.sameCount, onlyPending: raw.onlyPending };
  if (raw.type === "checkCollectionSave" && Number.isSafeInteger(raw.receiptCount) && typeof raw.batchIdUnused === "boolean") return { type: "checkCollectionSave", receiptCount: raw.receiptCount, batchIdUnused: raw.batchIdUnused };
  if (raw.type === "startSourceCleanup" && typeof raw.authorized === "boolean" && typeof raw.ownerWithdrawal === "boolean") return { type: "startSourceCleanup", authorized: raw.authorized, ownerWithdrawal: raw.ownerWithdrawal };
  if (raw.type === "readWithdrawalTurn" && typeof raw.matches === "boolean") return { type: "readWithdrawalTurn", matches: raw.matches };
  if (raw.type === "readCleanupReceipt" && typeof raw.prior === "boolean" && typeof raw.matches === "boolean") return { type: "readCleanupReceipt", prior: raw.prior, matches: raw.matches };
  if (raw.type === "confirmSourceCleanup" && typeof raw.authorized === "boolean") return { type: "confirmSourceCleanup", authorized: raw.authorized };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SourceFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "SourceInitial" || raw.phase === "SourceDenied" || raw.phase === "CheckingCollectionTurn" || raw.phase === "CheckingLiveSources" || raw.phase === "ReadingCollectionReceipt" || raw.phase === "ReplayingCollection" || raw.phase === "CollectionReadyToReplay" || raw.phase === "SavingCollection" || raw.phase === "CollectionReadyToSave" || raw.phase === "CheckingWithdrawalTurn" || raw.phase === "ReadingCleanupReceipt" || raw.phase === "ReplayingCleanup" || raw.phase === "ApplyingCleanup" || raw.phase === "CleanupConfirmed") && Object.keys(raw).length === 1)) return undefined;
  const parsed: SourceFlow = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SourceFlow {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_profileSuggestionSource(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
