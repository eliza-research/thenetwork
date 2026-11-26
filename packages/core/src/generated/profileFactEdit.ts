// GENERATED from spec/profileFactEdit.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
export type ProfileFactEditOperation = "CorrectFact" | "RemoveFact" | "ChangeFactScope";
/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export type ProfileFactEditPhase = "NoProfileFactDraft" | "AwaitingProfileFactConfirmation" | "AppliedProfileFactEdit" | "ClosedProfileFactDraft";
/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export interface ProfileFactEdit { phase: ProfileFactEditPhase; operation: ProfileFactEditOperation; stagedAt: number }
/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export interface ProfileFactEditStageFacts { direct: boolean; ownerCurrent: boolean; exactFact: boolean; operationAllowed: boolean; validInput: boolean }
/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
export interface ProfileFactEditApplyFacts { direct: boolean; ownerCurrent: boolean; exactDraft: boolean; exactFact: boolean; unchanged: boolean; operationAllowed: boolean; stagedAt: number; now: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "stageProfileFact"; stageFacts: ProfileFactEditStageFacts; operation: ProfileFactEditOperation; stagedAt: number }
  | { type: "confirmProfileFact"; applyFacts: ProfileFactEditApplyFacts }
  | { type: "closeProfileFact"; now: number; exactCancellation: boolean }
  | { type: "replayProfileFact"; direct: boolean; ownerCurrent: boolean; exactReceipt: boolean };

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export const initial: ProfileFactEdit = { phase: "NoProfileFactDraft", operation: "CorrectFact", stagedAt: 0 };
/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export const profileFactEditTtlMs: number = 900000;
/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
export const validStage: ProfileFactEditStageFacts = { direct: true, ownerCurrent: true, exactFact: true, operationAllowed: true, validInput: true };
/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
export const validApply: ProfileFactEditApplyFacts = { direct: true, ownerCurrent: true, exactDraft: true, exactFact: true, unchanged: true, operationAllowed: true, stagedAt: 0, now: 1 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ProfileFactEdit): boolean {
  return alwaysProfileFactDraftHasStagingTime(current);
}

/** Story: Review my facts and approve a specific change / Only a direct request from the current app member can show their saved facts (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditMayRead(direct: boolean, ownerCurrent: boolean, sameApp: boolean): boolean {
  return direct && ownerCurrent && sameApp;
}

/** Story: Review my facts and approve a specific change / Only a direct request from the current app member can show their saved facts (spec/profileFactEdit.md) */
//@ pure
export function lawProfileFactReadRequiresCurrentOwner(direct: boolean, sameApp: boolean): boolean {
  //@ ensures \result === true
  return !profileFactEditMayRead(direct, false, sameApp);
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function profileFactScopeRank(scope: string): number {
  return scope === "agent_private" ? 1 : (scope === "matchable" ? 2 : (scope === "shareable" ? 3 : 0));
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditScopeSupported(scope: string): boolean {
  return profileFactScopeRank(scope) > 0;
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditNarrower(currentScope: string, proposedScope: string): boolean {
  return (currentScope === "opportunity_specific" && proposedScope === "agent_private") || (profileFactEditScopeSupported(proposedScope) && profileFactScopeRank(proposedScope) < profileFactScopeRank(currentScope));
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditOperationAllowed(operation: ProfileFactEditOperation, policyOwned: boolean, sensitiveInferred: boolean, currentScope: string, proposedScope: string): boolean {
  return !policyOwned && (profileFactEditScopeSupported(currentScope) || currentScope === "opportunity_specific") && (operation !== "ChangeFactScope" ? true : (sensitiveInferred || currentScope === "opportunity_specific" ? profileFactEditNarrower(currentScope, proposedScope) : profileFactEditScopeSupported(proposedScope) && currentScope !== proposedScope));
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function lawProfileFactEditPreservesPolicy(operation: ProfileFactEditOperation, sensitiveInferred: boolean, currentScope: string, proposedScope: string): boolean {
  //@ ensures \result === true
  return !profileFactEditOperationAllowed(operation, true, sensitiveInferred, currentScope, proposedScope);
}

/** Story: Review my facts and approve a specific change / The policy for the current fact decides which edits the owner can propose (spec/profileFactEdit.md) */
//@ pure
export function lawSensitiveProfileFactScopeOnlyNarrows(currentScope: string, proposedScope: string): boolean {
  //@ ensures \result === true
  return !profileFactEditOperationAllowed("ChangeFactScope", false, true, currentScope, proposedScope) || profileFactEditNarrower(currentScope, proposedScope);
}

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditDraftCurrent(stagedAt: number, now: number): boolean {
  return stagedAt >= 0 && now >= stagedAt && exact_profileFactEdit(now - stagedAt) < profileFactEditTtlMs;
}

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditMayStage(stageFacts: ProfileFactEditStageFacts): boolean {
  return stageFacts.direct && stageFacts.ownerCurrent && stageFacts.exactFact && stageFacts.operationAllowed && stageFacts.validInput;
}

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
//@ pure
export function canStageProfileFact(draft: ProfileFactEdit, stageFacts: ProfileFactEditStageFacts, operation: ProfileFactEditOperation, stagedAt: number): boolean {
  return stagedAt >= 0 && profileFactEditMayStage(stageFacts);
}

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
//@ pure
export function stageProfileFact(draft: ProfileFactEdit, stageFacts: ProfileFactEditStageFacts, operation: ProfileFactEditOperation, stagedAt: number): ProfileFactEdit {
  //@ ensures (inv(draft) && canStageProfileFact(draft, stageFacts, operation, stagedAt)) ==> alwaysProfileFactDraftHasStagingTime(\result)
  //@ ensures (inv(draft) && canStageProfileFact(draft, stageFacts, operation, stagedAt)) ==> stepProfileFactApplyNeedsPendingDraft(draft, "stageProfileFact", \result)
  //@ ensures (inv(draft) && canStageProfileFact(draft, stageFacts, operation, stagedAt)) ==> stepProfileFactReplayKeepsState(draft, "stageProfileFact", \result)
  return canStageProfileFact(draft, stageFacts, operation, stagedAt) ? ({ phase: "AwaitingProfileFactConfirmation", operation: operation, stagedAt: stagedAt } as ProfileFactEdit) : draft;
}

/** Story: Review my facts and approve a specific change / An explicit command stages one exact draft without writing the fact (spec/profileFactEdit.md) */
//@ pure
export function sometimesProfileFactDraftStaged(draft: ProfileFactEdit): boolean {
  return draft.phase === "AwaitingProfileFactConfirmation";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditMayApply(applyFacts: ProfileFactEditApplyFacts): boolean {
  return applyFacts.direct && applyFacts.ownerCurrent && applyFacts.exactDraft && applyFacts.exactFact && applyFacts.unchanged && applyFacts.operationAllowed && profileFactEditDraftCurrent(applyFacts.stagedAt, applyFacts.now);
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditClearsDerived(operation: ProfileFactEditOperation): boolean {
  return operation === "CorrectFact" || operation === "RemoveFact" || operation === "ChangeFactScope";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditDisablesSourceReplay(operation: ProfileFactEditOperation): boolean {
  return operation === "CorrectFact" || operation === "RemoveFact";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function canConfirmProfileFact(draft: ProfileFactEdit, applyFacts: ProfileFactEditApplyFacts): boolean {
  return draft.phase === "AwaitingProfileFactConfirmation" && applyFacts.stagedAt === draft.stagedAt && profileFactEditMayApply(applyFacts);
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function confirmProfileFact(draft: ProfileFactEdit, applyFacts: ProfileFactEditApplyFacts): ProfileFactEdit {
  //@ ensures (inv(draft) && canConfirmProfileFact(draft, applyFacts)) ==> alwaysProfileFactDraftHasStagingTime(\result)
  //@ ensures (inv(draft) && canConfirmProfileFact(draft, applyFacts)) ==> stepProfileFactApplyNeedsPendingDraft(draft, "confirmProfileFact", \result)
  //@ ensures (inv(draft) && canConfirmProfileFact(draft, applyFacts)) ==> stepProfileFactReplayKeepsState(draft, "confirmProfileFact", \result)
  return canConfirmProfileFact(draft, applyFacts) ? ({ ...draft, phase: "AppliedProfileFactEdit" } as ProfileFactEdit) : draft;
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function lawProfileFactEditNeedsExactCurrentConfirmation(applyFacts: ProfileFactEditApplyFacts): boolean {
  //@ ensures \result === true
  return !profileFactEditMayApply(applyFacts) || (applyFacts.direct && applyFacts.ownerCurrent && applyFacts.exactDraft && applyFacts.exactFact && applyFacts.unchanged && profileFactEditDraftCurrent(applyFacts.stagedAt, applyFacts.now));
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function lawChangedProfileFactClearsDerivationAndOldEvidence(operation: ProfileFactEditOperation): boolean {
  //@ ensures \result === true
  return !(operation === "CorrectFact" || operation === "RemoveFact") || (profileFactEditClearsDerived(operation) && profileFactEditDisablesSourceReplay(operation));
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function stepProfileFactApplyNeedsPendingDraft(before: ProfileFactEdit, via: string, after: ProfileFactEdit): boolean {
  return !(via === "confirmProfileFact" && !equal_profileFactEdit(after, before)) || before.phase === "AwaitingProfileFactConfirmation";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function sometimesProfileFactCorrected(draft: ProfileFactEdit): boolean {
  return draft.phase === "AppliedProfileFactEdit" && draft.operation === "CorrectFact";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function sometimesProfileFactRemoved(draft: ProfileFactEdit): boolean {
  return draft.phase === "AppliedProfileFactEdit" && draft.operation === "RemoveFact";
}

/** Story: Review my facts and approve a specific change / Confirmation must match the current draft and the unchanged saved fact (spec/profileFactEdit.md) */
//@ pure
export function sometimesProfileFactScopeChanged(draft: ProfileFactEdit): boolean {
  return draft.phase === "AppliedProfileFactEdit" && draft.operation === "ChangeFactScope";
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditMayCancel(direct: boolean, ownerCurrent: boolean, exactDraft: boolean): boolean {
  return direct && ownerCurrent && exactDraft;
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function profileFactEditMayReplay(direct: boolean, ownerCurrent: boolean, exactReceipt: boolean): boolean {
  return direct && ownerCurrent && exactReceipt;
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function canCloseProfileFact(draft: ProfileFactEdit, now: number, exactCancellation: boolean): boolean {
  return draft.phase === "AwaitingProfileFactConfirmation" && (exactCancellation || exact_profileFactEdit(now - draft.stagedAt) >= profileFactEditTtlMs);
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function closeProfileFact(draft: ProfileFactEdit, now: number, exactCancellation: boolean): ProfileFactEdit {
  //@ ensures (inv(draft) && canCloseProfileFact(draft, now, exactCancellation)) ==> alwaysProfileFactDraftHasStagingTime(\result)
  //@ ensures (inv(draft) && canCloseProfileFact(draft, now, exactCancellation)) ==> stepProfileFactApplyNeedsPendingDraft(draft, "closeProfileFact", \result)
  //@ ensures (inv(draft) && canCloseProfileFact(draft, now, exactCancellation)) ==> stepProfileFactReplayKeepsState(draft, "closeProfileFact", \result)
  return canCloseProfileFact(draft, now, exactCancellation) ? ({ ...draft, phase: "ClosedProfileFactDraft" } as ProfileFactEdit) : draft;
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function canReplayProfileFact(draft: ProfileFactEdit, direct: boolean, ownerCurrent: boolean, exactReceipt: boolean): boolean {
  return draft.phase === "AppliedProfileFactEdit" && profileFactEditMayReplay(direct, ownerCurrent, exactReceipt);
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function replayProfileFact(draft: ProfileFactEdit, direct: boolean, ownerCurrent: boolean, exactReceipt: boolean): ProfileFactEdit {
  //@ ensures (inv(draft) && canReplayProfileFact(draft, direct, ownerCurrent, exactReceipt)) ==> alwaysProfileFactDraftHasStagingTime(\result)
  //@ ensures (inv(draft) && canReplayProfileFact(draft, direct, ownerCurrent, exactReceipt)) ==> stepProfileFactApplyNeedsPendingDraft(draft, "replayProfileFact", \result)
  //@ ensures (inv(draft) && canReplayProfileFact(draft, direct, ownerCurrent, exactReceipt)) ==> stepProfileFactReplayKeepsState(draft, "replayProfileFact", \result)
  return draft;
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function alwaysProfileFactDraftHasStagingTime(draft: ProfileFactEdit): boolean {
  return !(draft.phase !== "NoProfileFactDraft") || draft.stagedAt >= 0;
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function stepProfileFactReplayKeepsState(before: ProfileFactEdit, via: string, after: ProfileFactEdit): boolean {
  return !(via === "replayProfileFact") || equal_profileFactEdit(after, before);
}

/** Story: Review my facts and approve a specific change / Cancellation, expiry and replay cannot make another change (spec/profileFactEdit.md) */
//@ pure
export function sometimesProfileFactDraftClosed(draft: ProfileFactEdit): boolean {
  return draft.phase === "ClosedProfileFactDraft";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ProfileFactEdit, event: Event): boolean {
  if (event.type === "stageProfileFact") return canStageProfileFact(current, event.stageFacts, event.operation, event.stagedAt);
  if (event.type === "confirmProfileFact") return canConfirmProfileFact(current, event.applyFacts);
  if (event.type === "closeProfileFact") return canCloseProfileFact(current, event.now, event.exactCancellation);
  if (event.type === "replayProfileFact") return canReplayProfileFact(current, event.direct, event.ownerCurrent, event.exactReceipt);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ProfileFactEdit, event: Event): ProfileFactEdit {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "stageProfileFact") return canStageProfileFact(current, event.stageFacts, event.operation, event.stagedAt) ? stageProfileFact(current, event.stageFacts, event.operation, event.stagedAt) : current;
  if (event.type === "confirmProfileFact") return canConfirmProfileFact(current, event.applyFacts) ? confirmProfileFact(current, event.applyFacts) : current;
  if (event.type === "closeProfileFact") return canCloseProfileFact(current, event.now, event.exactCancellation) ? closeProfileFact(current, event.now, event.exactCancellation) : current;
  if (event.type === "replayProfileFact") return canReplayProfileFact(current, event.direct, event.ownerCurrent, event.exactReceipt) ? replayProfileFact(current, event.direct, event.ownerCurrent, event.exactReceipt) : current;
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
  const is_ProfileFactEditStageFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.direct === "boolean" && typeof v.ownerCurrent === "boolean" && typeof v.exactFact === "boolean" && typeof v.operationAllowed === "boolean" && typeof v.validInput === "boolean";
  const is_ProfileFactEditApplyFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.direct === "boolean" && typeof v.ownerCurrent === "boolean" && typeof v.exactDraft === "boolean" && typeof v.exactFact === "boolean" && typeof v.unchanged === "boolean" && typeof v.operationAllowed === "boolean" && Number.isSafeInteger(v.stagedAt) && Number.isSafeInteger(v.now);
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "stageProfileFact" && is_ProfileFactEditStageFacts(raw.stageFacts) && (raw.operation === "CorrectFact" || raw.operation === "RemoveFact" || raw.operation === "ChangeFactScope") && Number.isSafeInteger(raw.stagedAt)) return { type: "stageProfileFact", stageFacts: ({ direct: raw.stageFacts.direct, ownerCurrent: raw.stageFacts.ownerCurrent, exactFact: raw.stageFacts.exactFact, operationAllowed: raw.stageFacts.operationAllowed, validInput: raw.stageFacts.validInput }), operation: raw.operation, stagedAt: raw.stagedAt };
  if (raw.type === "confirmProfileFact" && is_ProfileFactEditApplyFacts(raw.applyFacts)) return { type: "confirmProfileFact", applyFacts: ({ direct: raw.applyFacts.direct, ownerCurrent: raw.applyFacts.ownerCurrent, exactDraft: raw.applyFacts.exactDraft, exactFact: raw.applyFacts.exactFact, unchanged: raw.applyFacts.unchanged, operationAllowed: raw.applyFacts.operationAllowed, stagedAt: raw.applyFacts.stagedAt, now: raw.applyFacts.now }) };
  if (raw.type === "closeProfileFact" && Number.isSafeInteger(raw.now) && typeof raw.exactCancellation === "boolean") return { type: "closeProfileFact", now: raw.now, exactCancellation: raw.exactCancellation };
  if (raw.type === "replayProfileFact" && typeof raw.direct === "boolean" && typeof raw.ownerCurrent === "boolean" && typeof raw.exactReceipt === "boolean") return { type: "replayProfileFact", direct: raw.direct, ownerCurrent: raw.ownerCurrent, exactReceipt: raw.exactReceipt };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ProfileFactEdit | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NoProfileFactDraft" || raw.phase === "AwaitingProfileFactConfirmation" || raw.phase === "AppliedProfileFactEdit" || raw.phase === "ClosedProfileFactDraft") && (raw.operation === "CorrectFact" || raw.operation === "RemoveFact" || raw.operation === "ChangeFactScope") && Number.isSafeInteger(raw.stagedAt) && Object.keys(raw).length === 3)) return undefined;
  const parsed: ProfileFactEdit = ({ phase: raw.phase, operation: raw.operation, stagedAt: raw.stagedAt });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ProfileFactEdit {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_profileFactEdit(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_profileFactEdit(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_profileFactEdit((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
