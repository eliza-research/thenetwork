// Generated from spec/notificationDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { DigestFlow, Event } from "./notificationDispatch.ts";
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare const initial: DigestFlow;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare function inboxItemStillPending(seen: boolean, notified: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare function inboxItemAllowedForRecipient(requested: boolean, proactiveAllowed: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare function rereadItems(digest: DigestFlow, plannedCount: number, remainingCount: number, recipientAvailable: boolean, destinationChanged: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare function canRereadItems(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) @throws {never} */
export declare function lawMissingRecipientCancels(plannedCount: number, remainingCount: number, destinationChanged: boolean): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function digestItemSetCanBeRecorded(itemCount: number, pendingOwnedCount: number): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function canRecordDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function recordDigest(digest: DigestFlow, recorded: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function canEnqueueDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function enqueueDigest(digest: DigestFlow): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function stepQueueRequiresRecordedDigest(before: DigestFlow, via: string, after: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function sometimesQueuesDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) @throws {never} */
export declare function sometimesCancelsDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function inboxItemExpired(hasExpiry: boolean, expiresAt: number, at: number): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function canReadQueuedDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function readQueuedDigest(digest: DigestFlow, sameDigest: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function canRevalidateQueuedItems(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function revalidateQueuedItems(digest: DigestFlow, allPresent: boolean, anyExpired: boolean, anyUnseen: boolean): DigestFlow;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function sometimesKeepsQueuedDigest(digest: DigestFlow): boolean;
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) @throws {never} */
export declare function sometimesSuppressesQueuedDigest(digest: DigestFlow): boolean;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: DigestFlow, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: DigestFlow, event: Event): DigestFlow;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): DigestFlow | undefined;
/** A Machine never shares its held state with callers. @throws {never} */
export declare function snapshot_notificationDispatch<A>(value: A): A;
