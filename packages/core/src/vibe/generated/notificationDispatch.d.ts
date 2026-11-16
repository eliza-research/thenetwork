// Generated from spec/notificationDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export type DigestPhase = "DigestStarting" | "ReusingDigest" | "RebuildingDigest" | "EnqueueingDigest" | "DigestQueued" | "DigestCancelled" | "ReadingQueuedItems" | "QueuedDigestNeeded" | "QueuedDigestObsolete";
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export interface DigestFlow {
    phase: DigestPhase;
}
/** One variant per transition in the spec. */
export type Event = {
    type: "rereadItems";
    plannedCount: number;
    remainingCount: number;
    recipientAvailable: boolean;
    destinationChanged: boolean;
} | {
    type: "recordDigest";
    recorded: boolean;
} | {
    type: "enqueueDigest";
} | {
    type: "readQueuedDigest";
    sameDigest: boolean;
} | {
    type: "revalidateQueuedItems";
    allPresent: boolean;
    anyExpired: boolean;
    anyUnseen: boolean;
};
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare const initial: DigestFlow;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare function inboxItemStillPending(seen: boolean, notified: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare function inboxItemAllowedForRecipient(requested: boolean, proactiveAllowed: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare function rereadItems(digest: DigestFlow, plannedCount: number, remainingCount: number, recipientAvailable: boolean, destinationChanged: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare function canRereadItems(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export declare function lawMissingRecipientCancels(plannedCount: number, remainingCount: number, destinationChanged: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function digestItemSetCanBeRecorded(itemCount: number, pendingOwnedCount: number): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function canRecordDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function recordDigest(digest: DigestFlow, recorded: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function canEnqueueDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function enqueueDigest(digest: DigestFlow): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function stepQueueRequiresRecordedDigest(before: DigestFlow, via: string, after: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function sometimesQueuesDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
export declare function sometimesCancelsDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function inboxItemExpired(hasExpiry: boolean, expiresAt: number, at: number): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function canReadQueuedDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function readQueuedDigest(digest: DigestFlow, sameDigest: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function canRevalidateQueuedItems(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function revalidateQueuedItems(digest: DigestFlow, allPresent: boolean, anyExpired: boolean, anyUnseen: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function sometimesKeepsQueuedDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
export declare function sometimesSuppressesQueuedDigest(digest: DigestFlow): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: DigestFlow, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: DigestFlow, event: Event): DigestFlow;
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
export declare function parseState(x: unknown): DigestFlow | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): DigestFlow;
