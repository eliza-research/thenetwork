// GENERATED from spec/profileSuggestionReview.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Review suggestions before they change my profile / A review starts with no authorized batch (spec/profileSuggestionReview.md:9) */
export type ReviewVerb = "AcceptVerb" | "RejectVerb" | "EditVerb";
/** Story: Review suggestions before they change my profile / A review starts with no authorized batch (spec/profileSuggestionReview.md:9) */
export type ReviewPhase = "Unchecked" | "NeedsItems" | "BatchUnavailable" | "ReadyToReview" | "CommandRefused" | "AcceptItem" | "RejectItem" | "PreviewEdit";
/** Story: Review suggestions before they change my profile / A review starts with no authorized batch (spec/profileSuggestionReview.md:9) */
export interface ReviewRequest { phase: ReviewPhase; metadataApproved: boolean; itemsApproved: boolean; commandBound: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkBatch"; pending: boolean; ownerMatches: boolean; batchIdValid: boolean; revision: number; asOf: number; expiresAt: number }
  | { type: "checkItems"; itemCount: number; distinctIds: boolean; allItemsValid: boolean }
  | { type: "readCommand"; verb: ReviewVerb; tokenMatches: boolean; itemExists: boolean; scopeGiven: boolean; wordingGiven: boolean; wordingValid: boolean };

/** Story: Review suggestions before they change my profile / Only a bounded batch of distinct, valid suggestions can be shown (spec/profileSuggestionReview.md:36) */
export const maxSuggestions: number = 10;
/** Story: Review suggestions before they change my profile / A review starts with no authorized batch (spec/profileSuggestionReview.md:9) */
export const initial: ReviewRequest = { phase: "Unchecked", metadataApproved: false, itemsApproved: false, commandBound: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReviewRequest): boolean {
  return alwaysReviewNeedsEligibleBatch(current) && alwaysActionNeedsBoundCommand(current);
}

/** Story: Review suggestions before they change my profile / Only a current batch for the same person, app and chat enters review (spec/profileSuggestionReview.md:23) */
//@ pure
export function checkBatch(review: ReviewRequest, pending: boolean, ownerMatches: boolean, batchIdValid: boolean, revision: number, asOf: number, expiresAt: number): ReviewRequest {
  //@ ensures (inv(review) && canCheckBatch(review)) ==> alwaysReviewNeedsEligibleBatch(\result)
  //@ ensures (inv(review) && canCheckBatch(review)) ==> alwaysActionNeedsBoundCommand(\result)
  const eligible: boolean = pending && ownerMatches && batchIdValid && revision > 0 && asOf < expiresAt;
  return { ...review, metadataApproved: eligible, phase: eligible ? "NeedsItems" : "BatchUnavailable" };
}

/** Story: Review suggestions before they change my profile / Only a current batch for the same person, app and chat enters review (spec/profileSuggestionReview.md:23) */
//@ pure
export function canCheckBatch(review: ReviewRequest): boolean {
  return review.phase === "Unchecked";
}

/** Story: Review suggestions before they change my profile / Only a bounded batch of distinct, valid suggestions can be shown (spec/profileSuggestionReview.md:36) */
//@ pure
export function canCheckItems(review: ReviewRequest): boolean {
  return review.phase === "NeedsItems" && review.metadataApproved;
}

/** Story: Review suggestions before they change my profile / Only a bounded batch of distinct, valid suggestions can be shown (spec/profileSuggestionReview.md:36) */
//@ pure
export function checkItems(review: ReviewRequest, itemCount: number, distinctIds: boolean, allItemsValid: boolean): ReviewRequest {
  //@ ensures (inv(review) && canCheckItems(review)) ==> alwaysReviewNeedsEligibleBatch(\result)
  //@ ensures (inv(review) && canCheckItems(review)) ==> alwaysActionNeedsBoundCommand(\result)
  const eligible: boolean = itemCount > 0 && itemCount <= maxSuggestions && distinctIds && allItemsValid;
  return { ...review, itemsApproved: eligible, phase: eligible ? "ReadyToReview" : "BatchUnavailable" };
}

/** Story: Review suggestions before they change my profile / A command targets this batch revision and one existing item (spec/profileSuggestionReview.md:52) */
//@ pure
export function canReadCommand(review: ReviewRequest): boolean {
  return review.phase === "ReadyToReview" && review.metadataApproved && review.itemsApproved;
}

/** Story: Review suggestions before they change my profile / A command targets this batch revision and one existing item (spec/profileSuggestionReview.md:52) */
//@ pure
export function readCommand(review: ReviewRequest, verb: ReviewVerb, tokenMatches: boolean, itemExists: boolean, scopeGiven: boolean, wordingGiven: boolean, wordingValid: boolean): ReviewRequest {
  //@ ensures (inv(review) && canReadCommand(review)) ==> alwaysReviewNeedsEligibleBatch(\result)
  //@ ensures (inv(review) && canReadCommand(review)) ==> alwaysActionNeedsBoundCommand(\result)
  const bound: boolean = tokenMatches && itemExists;
  const outcome: ReviewPhase = !bound ? "CommandRefused" : (verb === "AcceptVerb" && scopeGiven && !wordingGiven ? "AcceptItem" : (verb === "RejectVerb" && !scopeGiven && !wordingGiven ? "RejectItem" : (verb === "EditVerb" && !scopeGiven && wordingGiven && wordingValid ? "PreviewEdit" : "CommandRefused")));
  return { ...review, phase: outcome, commandBound: bound };
}

/** Story: Review suggestions before they change my profile / A review action requires an eligible batch and a bound command (spec/profileSuggestionReview.md:72) */
//@ pure
export function alwaysReviewNeedsEligibleBatch(review: ReviewRequest): boolean {
  return !(review.phase === "ReadyToReview" || review.phase === "AcceptItem" || review.phase === "RejectItem" || review.phase === "PreviewEdit") || (review.metadataApproved && review.itemsApproved);
}

/** Story: Review suggestions before they change my profile / A review action requires an eligible batch and a bound command (spec/profileSuggestionReview.md:72) */
//@ pure
export function alwaysActionNeedsBoundCommand(review: ReviewRequest): boolean {
  return !(review.phase === "AcceptItem" || review.phase === "RejectItem" || review.phase === "PreviewEdit") || review.commandBound;
}

/** Story: Review suggestions before they change my profile / A member can reach review, accept, reject and edit (spec/profileSuggestionReview.md:87) */
//@ pure
export function sometimesReadyToReview(review: ReviewRequest): boolean {
  return review.phase === "ReadyToReview";
}

/** Story: Review suggestions before they change my profile / A member can reach review, accept, reject and edit (spec/profileSuggestionReview.md:87) */
//@ pure
export function sometimesCanAccept(review: ReviewRequest): boolean {
  return review.phase === "AcceptItem";
}

/** Story: Review suggestions before they change my profile / A member can reach review, accept, reject and edit (spec/profileSuggestionReview.md:87) */
//@ pure
export function sometimesCanReject(review: ReviewRequest): boolean {
  return review.phase === "RejectItem";
}

/** Story: Review suggestions before they change my profile / A member can reach review, accept, reject and edit (spec/profileSuggestionReview.md:87) */
//@ pure
export function sometimesCanEdit(review: ReviewRequest): boolean {
  return review.phase === "PreviewEdit";
}

/** Story: Review suggestions before they change my profile / A member can reach review, accept, reject and edit (spec/profileSuggestionReview.md:87) */
//@ pure
export function sometimesBatchUnavailable(review: ReviewRequest): boolean {
  return review.phase === "BatchUnavailable";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReviewRequest, event: Event): boolean {
  if (event.type === "checkBatch") return canCheckBatch(current);
  if (event.type === "checkItems") return canCheckItems(current);
  if (event.type === "readCommand") return canReadCommand(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ReviewRequest, event: Event): ReviewRequest {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkBatch" && canCheckBatch(current)) return checkBatch(current, event.pending, event.ownerMatches, event.batchIdValid, event.revision, event.asOf, event.expiresAt);
  if (event.type === "checkItems" && canCheckItems(current)) return checkItems(current, event.itemCount, event.distinctIds, event.allItemsValid);
  if (event.type === "readCommand" && canReadCommand(current)) return readCommand(current, event.verb, event.tokenMatches, event.itemExists, event.scopeGiven, event.wordingGiven, event.wordingValid);
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
  if (raw.type === "checkBatch" && typeof raw.pending === "boolean" && typeof raw.ownerMatches === "boolean" && typeof raw.batchIdValid === "boolean" && Number.isSafeInteger(raw.revision) && Number.isSafeInteger(raw.asOf) && Number.isSafeInteger(raw.expiresAt)) return { type: "checkBatch", pending: raw.pending, ownerMatches: raw.ownerMatches, batchIdValid: raw.batchIdValid, revision: raw.revision, asOf: raw.asOf, expiresAt: raw.expiresAt };
  if (raw.type === "checkItems" && Number.isSafeInteger(raw.itemCount) && typeof raw.distinctIds === "boolean" && typeof raw.allItemsValid === "boolean") return { type: "checkItems", itemCount: raw.itemCount, distinctIds: raw.distinctIds, allItemsValid: raw.allItemsValid };
  if (raw.type === "readCommand" && (raw.verb === "AcceptVerb" || raw.verb === "RejectVerb" || raw.verb === "EditVerb") && typeof raw.tokenMatches === "boolean" && typeof raw.itemExists === "boolean" && typeof raw.scopeGiven === "boolean" && typeof raw.wordingGiven === "boolean" && typeof raw.wordingValid === "boolean") return { type: "readCommand", verb: raw.verb, tokenMatches: raw.tokenMatches, itemExists: raw.itemExists, scopeGiven: raw.scopeGiven, wordingGiven: raw.wordingGiven, wordingValid: raw.wordingValid };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReviewRequest | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unchecked" || raw.phase === "NeedsItems" || raw.phase === "BatchUnavailable" || raw.phase === "ReadyToReview" || raw.phase === "CommandRefused" || raw.phase === "AcceptItem" || raw.phase === "RejectItem" || raw.phase === "PreviewEdit") && typeof raw.metadataApproved === "boolean" && typeof raw.itemsApproved === "boolean" && typeof raw.commandBound === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: ReviewRequest = ({ phase: raw.phase, metadataApproved: raw.metadataApproved, itemsApproved: raw.itemsApproved, commandBound: raw.commandBound });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReviewRequest {
  //@ ensures inv(\result)
  return initial;
}
