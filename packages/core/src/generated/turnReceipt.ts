// GENERATED from spec/turnReceipt.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export type ReceiptPhase = "ReadingTurn" | "CheckingAuthority" | "CheckingPrevious" | "CheckingScope" | "CheckingDelivery" | "AwaitingEmptyWrite" | "AwaitingReplyWrite" | "Stored" | "Replayed" | "TurnUnavailable" | "AuthorityInvalid" | "Conflict" | "ScopeInvalid" | "DeliveryInvalid";
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export interface TurnReceipt { phase: ReceiptPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkTurn"; handled: boolean }
  | { type: "checkAuthority"; validAuthority: boolean }
  | { type: "readPrevious"; identical: boolean; alreadyStored: boolean; previouslyUnknown: boolean; finalDelivery: boolean }
  | { type: "checkScope"; collectedReplies: boolean; orderedIdsMatch: boolean; providerIds: boolean; history: boolean }
  | { type: "checkDelivery"; accepted: boolean; providerIds: boolean; history: boolean; accountFree: boolean }
  | { type: "recordReceipt" };

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export const initial: TurnReceipt = { phase: "ReadingTurn" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: TurnReceipt): boolean {
  return true;
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function checkTurn(receipt: TurnReceipt, handled: boolean): TurnReceipt {
  //@ ensures (inv(receipt) && canCheckTurn(receipt)) ==> stepReceiptNeedsAdmission(receipt, "checkTurn", \result)
  return { phase: handled ? "CheckingAuthority" : "TurnUnavailable" };
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function canCheckAuthority(receipt: TurnReceipt): boolean {
  return receipt.phase === "CheckingAuthority";
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function checkAuthority(receipt: TurnReceipt, validAuthority: boolean): TurnReceipt {
  //@ ensures (inv(receipt) && canCheckAuthority(receipt)) ==> stepReceiptNeedsAdmission(receipt, "checkAuthority", \result)
  return { phase: validAuthority ? "CheckingPrevious" : "AuthorityInvalid" };
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function canReadPrevious(receipt: TurnReceipt): boolean {
  return receipt.phase === "CheckingPrevious";
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function readPrevious(receipt: TurnReceipt, identical: boolean, alreadyStored: boolean, previouslyUnknown: boolean, finalDelivery: boolean): TurnReceipt {
  //@ ensures (inv(receipt) && canReadPrevious(receipt)) ==> stepReceiptNeedsAdmission(receipt, "readPrevious", \result)
  return identical ? ({ phase: "Replayed" } as TurnReceipt) : (alreadyStored && !(previouslyUnknown && finalDelivery) ? ({ phase: "Conflict" } as TurnReceipt) : ({ phase: "CheckingScope" } as TurnReceipt));
}

/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
//@ pure
export function canCheckTurn(receipt: TurnReceipt): boolean {
  return receipt.phase === "ReadingTurn";
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function receiptReplyIdsMatch(loadedIds: string[], submittedIds: string[]): boolean {
  return equal_turnReceipt(loadedIds, submittedIds);
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function noHistoryAllowed(accountFree: boolean, replyKind: string, reason: string, memberAbsent: boolean, knownApp: boolean): boolean {
  return accountFree && (replyKind === "compliance" || (replyKind === "reply" && reason === "onboarding_asked" && memberAbsent && knownApp));
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function canCheckScope(receipt: TurnReceipt): boolean {
  return receipt.phase === "CheckingScope";
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function checkScope(receipt: TurnReceipt, collectedReplies: boolean, orderedIdsMatch: boolean, providerIds: boolean, history: boolean): TurnReceipt {
  //@ ensures (inv(receipt) && canCheckScope(receipt)) ==> stepReceiptNeedsAdmission(receipt, "checkScope", \result)
  return !orderedIdsMatch || (!collectedReplies && (providerIds || history)) ? ({ phase: "ScopeInvalid" } as TurnReceipt) : ({ phase: collectedReplies ? "CheckingDelivery" : "AwaitingEmptyWrite" } as TurnReceipt);
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function canCheckDelivery(receipt: TurnReceipt): boolean {
  return receipt.phase === "CheckingDelivery";
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function checkDelivery(receipt: TurnReceipt, accepted: boolean, providerIds: boolean, history: boolean, accountFree: boolean): TurnReceipt {
  //@ ensures (inv(receipt) && canCheckDelivery(receipt)) ==> stepReceiptNeedsAdmission(receipt, "checkDelivery", \result)
  return (accepted ? providerIds && (history || accountFree) : !history) ? ({ phase: "AwaitingReplyWrite" } as TurnReceipt) : ({ phase: "DeliveryInvalid" } as TurnReceipt);
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function lawReceiptRequiresExactOrder(firstId: string, secondId: string): boolean {
  //@ ensures \result === true
  return !(firstId !== secondId) || !receiptReplyIdsMatch(([firstId, secondId] as string[]), ([secondId, firstId] as string[]));
}

/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
//@ pure
export function lawAccountBoundReceiptNeedsHistory(replyKind: string, reason: string, memberAbsent: boolean, knownApp: boolean): boolean {
  //@ ensures \result === true
  return !noHistoryAllowed(false, replyKind, reason, memberAbsent, knownApp);
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function receiptAccepted(delivery: string): boolean {
  return delivery === "accepted";
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function canRecordReceipt(receipt: TurnReceipt): boolean {
  return receipt.phase === "AwaitingEmptyWrite" || receipt.phase === "AwaitingReplyWrite";
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function recordReceipt(receipt: TurnReceipt): TurnReceipt {
  //@ ensures (inv(receipt) && canRecordReceipt(receipt)) ==> stepReceiptNeedsAdmission(receipt, "recordReceipt", \result)
  return { phase: "Stored" };
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function receiptFinal(delivery: string): boolean {
  return receiptAccepted(delivery) || delivery === "rejected";
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function receiptMessageStatus(delivery: string): string {
  return receiptAccepted(delivery) ? "sent" : (delivery === "unknown" ? "send_unknown" : "refused_gateway");
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function sometimesCanStoreReceipt(receipt: TurnReceipt): boolean {
  return receipt.phase === "Stored";
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function sometimesCanReplayReceipt(receipt: TurnReceipt): boolean {
  return receipt.phase === "Replayed";
}

/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
//@ pure
export function stepReceiptNeedsAdmission(before: TurnReceipt, via: string, after: TurnReceipt): boolean {
  return !(after.phase === "Stored") || (via === "recordReceipt" && canRecordReceipt(before));
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: TurnReceipt, event: Event): boolean {
  if (event.type === "checkTurn") return canCheckTurn(current);
  if (event.type === "checkAuthority") return canCheckAuthority(current);
  if (event.type === "readPrevious") return canReadPrevious(current);
  if (event.type === "checkScope") return canCheckScope(current);
  if (event.type === "checkDelivery") return canCheckDelivery(current);
  if (event.type === "recordReceipt") return canRecordReceipt(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: TurnReceipt, event: Event): TurnReceipt {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkTurn" && canCheckTurn(current)) return checkTurn(current, event.handled);
  if (event.type === "checkAuthority" && canCheckAuthority(current)) return checkAuthority(current, event.validAuthority);
  if (event.type === "readPrevious" && canReadPrevious(current)) return readPrevious(current, event.identical, event.alreadyStored, event.previouslyUnknown, event.finalDelivery);
  if (event.type === "checkScope" && canCheckScope(current)) return checkScope(current, event.collectedReplies, event.orderedIdsMatch, event.providerIds, event.history);
  if (event.type === "checkDelivery" && canCheckDelivery(current)) return checkDelivery(current, event.accepted, event.providerIds, event.history, event.accountFree);
  if (event.type === "recordReceipt" && canRecordReceipt(current)) return recordReceipt(current);
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
  if (raw.type === "checkTurn" && typeof raw.handled === "boolean") return { type: "checkTurn", handled: raw.handled };
  if (raw.type === "checkAuthority" && typeof raw.validAuthority === "boolean") return { type: "checkAuthority", validAuthority: raw.validAuthority };
  if (raw.type === "readPrevious" && typeof raw.identical === "boolean" && typeof raw.alreadyStored === "boolean" && typeof raw.previouslyUnknown === "boolean" && typeof raw.finalDelivery === "boolean") return { type: "readPrevious", identical: raw.identical, alreadyStored: raw.alreadyStored, previouslyUnknown: raw.previouslyUnknown, finalDelivery: raw.finalDelivery };
  if (raw.type === "checkScope" && typeof raw.collectedReplies === "boolean" && typeof raw.orderedIdsMatch === "boolean" && typeof raw.providerIds === "boolean" && typeof raw.history === "boolean") return { type: "checkScope", collectedReplies: raw.collectedReplies, orderedIdsMatch: raw.orderedIdsMatch, providerIds: raw.providerIds, history: raw.history };
  if (raw.type === "checkDelivery" && typeof raw.accepted === "boolean" && typeof raw.providerIds === "boolean" && typeof raw.history === "boolean" && typeof raw.accountFree === "boolean") return { type: "checkDelivery", accepted: raw.accepted, providerIds: raw.providerIds, history: raw.history, accountFree: raw.accountFree };
  if (raw.type === "recordReceipt") return { type: "recordReceipt" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): TurnReceipt | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ReadingTurn" || raw.phase === "CheckingAuthority" || raw.phase === "CheckingPrevious" || raw.phase === "CheckingScope" || raw.phase === "CheckingDelivery" || raw.phase === "AwaitingEmptyWrite" || raw.phase === "AwaitingReplyWrite" || raw.phase === "Stored" || raw.phase === "Replayed" || raw.phase === "TurnUnavailable" || raw.phase === "AuthorityInvalid" || raw.phase === "Conflict" || raw.phase === "ScopeInvalid" || raw.phase === "DeliveryInvalid") && Object.keys(raw).length === 1)) return undefined;
  const parsed: TurnReceipt = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): TurnReceipt {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_turnReceipt(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_turnReceipt((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
