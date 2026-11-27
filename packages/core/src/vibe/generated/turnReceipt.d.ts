// Generated from spec/turnReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export type ReceiptPhase = "ReadingTurn" | "CheckingAuthority" | "CheckingPrevious" | "CheckingScope" | "CheckingDelivery" | "AwaitingEmptyWrite" | "AwaitingReplyWrite" | "Stored" | "Replayed" | "TurnUnavailable" | "AuthorityInvalid" | "Conflict" | "ScopeInvalid" | "DeliveryInvalid";
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export interface TurnReceipt {
    phase: ReceiptPhase;
}
/** One variant per transition in the spec. */
export type Event = {
    type: "checkTurn";
    handled: boolean;
} | {
    type: "checkAuthority";
    validAuthority: boolean;
} | {
    type: "readPrevious";
    identical: boolean;
    alreadyStored: boolean;
    previouslyUnknown: boolean;
    finalDelivery: boolean;
} | {
    type: "checkScope";
    collectedReplies: boolean;
    orderedIdsMatch: boolean;
    providerIds: boolean;
    history: boolean;
} | {
    type: "checkDelivery";
    accepted: boolean;
    providerIds: boolean;
    history: boolean;
    accountFree: boolean;
} | {
    type: "recordReceipt";
};
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare const initial: TurnReceipt;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function canCheckTurn(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function checkTurn(receipt: TurnReceipt, handled: boolean): TurnReceipt;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function canCheckAuthority(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function checkAuthority(receipt: TurnReceipt, validAuthority: boolean): TurnReceipt;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function canReadPrevious(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md) */
export declare function readPrevious(receipt: TurnReceipt, identical: boolean, alreadyStored: boolean, previouslyUnknown: boolean, finalDelivery: boolean): TurnReceipt;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function canCheckScope(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function checkScope(receipt: TurnReceipt, collectedReplies: boolean, orderedIdsMatch: boolean, providerIds: boolean, history: boolean): TurnReceipt;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function canCheckDelivery(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function checkDelivery(receipt: TurnReceipt, accepted: boolean, providerIds: boolean, history: boolean, accountFree: boolean): TurnReceipt;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function receiptReplyIdsMatch(loadedIds: string[], submittedIds: string[]): boolean;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function noHistoryAllowed(accountFree: boolean, replyKind: string, reason: string, memberAbsent: boolean, knownApp: boolean): boolean;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function lawReceiptRequiresExactOrder(firstId: string, secondId: string): boolean;
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md) */
export declare function lawAccountBoundReceiptNeedsHistory(replyKind: string, reason: string, memberAbsent: boolean, knownApp: boolean): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function canRecordReceipt(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function recordReceipt(receipt: TurnReceipt): TurnReceipt;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function receiptAccepted(delivery: string): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function receiptFinal(delivery: string): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function receiptMessageStatus(delivery: string): string;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function stepReceiptNeedsAdmission(before: TurnReceipt, via: string, after: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function sometimesCanStoreReceipt(receipt: TurnReceipt): boolean;
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md) */
export declare function sometimesCanReplayReceipt(receipt: TurnReceipt): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: TurnReceipt, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: TurnReceipt, event: Event): TurnReceipt;
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
export declare function parseEvent(x: unknown): Event | undefined;
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
export declare function parseState(x: unknown): TurnReceipt | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): TurnReceipt;
/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export declare function equal_turnReceipt(a: unknown, b: unknown): boolean;
