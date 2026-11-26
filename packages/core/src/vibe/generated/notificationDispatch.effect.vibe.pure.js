// Generated from spec/notificationDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./notificationDispatch.js";
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function inboxItemStillPending(seen, notified) { return M.inboxItemStillPending(seen, notified); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function inboxItemExpired(hasExpiry, expiresAt, at) { return M.inboxItemExpired(hasExpiry, expiresAt, at); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function inboxItemDigestible(seen, notified, hasExpiry, expiresAt, at) { return M.inboxItemDigestible(seen, notified, hasExpiry, expiresAt, at); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function lawExpiredItemLeavesTheDigest(seen, notified, expiresAt, at) { return M.lawExpiredItemLeavesTheDigest(seen, notified, expiresAt, at); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function inboxItemAllowedForRecipient(requested, proactiveAllowed) { return M.inboxItemAllowedForRecipient(requested, proactiveAllowed); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function rereadCountsPossible(plannedCount, remainingCount) { return M.rereadCountsPossible(plannedCount, remainingCount); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function canRereadItems(digest, plannedCount, remainingCount) { return M.canRereadItems(digest, plannedCount, remainingCount); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function rereadItems(digest, plannedCount, remainingCount, recipientAvailable, destinationChanged) { return M.rereadItems(digest, plannedCount, remainingCount, recipientAvailable, destinationChanged); }
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) @throws {never} */
export function lawMissingRecipientCancels(plannedCount, remainingCount, destinationChanged) { return M.lawMissingRecipientCancels(plannedCount, remainingCount, destinationChanged); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function digestItemSetCanBeRecorded(itemCount, pendingOwnedCount) { return M.digestItemSetCanBeRecorded(itemCount, pendingOwnedCount); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function digestWithinWeeklyCap(countsTowardCap, countedSends, weeklyCap) { return M.digestWithinWeeklyCap(countsTowardCap, countedSends, weeklyCap); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function lawRecordedCountingDigestStaysUnderCap(countedSends, weeklyCap) { return M.lawRecordedCountingDigestStaysUnderCap(countedSends, weeklyCap); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function canRecordDigest(digest) { return M.canRecordDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function recordDigest(digest, recorded) { return M.recordDigest(digest, recorded); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function canEnqueueDigest(digest) { return M.canEnqueueDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function enqueueDigest(digest) { return M.enqueueDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function stepQueueRequiresRecordedDigest(before, via, after) { return M.stepQueueRequiresRecordedDigest(before, via, after); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function sometimesQueuesDigest(digest) { return M.sometimesQueuesDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) @throws {never} */
export function sometimesCancelsDigest(digest) { return M.sometimesCancelsDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function canReadQueuedDigest(digest) { return M.canReadQueuedDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function readQueuedDigest(digest, sameDigest) { return M.readQueuedDigest(digest, sameDigest); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function canRevalidateQueuedItems(digest) { return M.canRevalidateQueuedItems(digest); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function revalidateQueuedItems(digest, allPresent, anyExpired, anyUnseen) { return M.revalidateQueuedItems(digest, allPresent, anyExpired, anyUnseen); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function sometimesKeepsQueuedDigest(digest) { return M.sometimesKeepsQueuedDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) @throws {never} */
export function sometimesSuppressesQueuedDigest(digest) { return M.sometimesSuppressesQueuedDigest(digest); }
/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) @throws {never} */
export function queuedDigestClaimAllowed(sameRecipient, threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable) { return M.queuedDigestClaimAllowed(sameRecipient, threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable); }
/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) @throws {never} */
export function lawUnreadableQueuedLinkCannotSend(sameRecipient, boundLink, appScoped, referenceLive) { return M.lawUnreadableQueuedLinkCannotSend(sameRecipient, boundLink, appScoped, referenceLive); }
/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) @throws {never} */
export function lawForeignQueuedDigestCannotSend(threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable) { return M.lawForeignQueuedDigestCannotSend(threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** @throws {never} */
export function snapshot_notificationDispatch(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++)
            snapshot_notificationDispatch(value[i]);
    }
    else {
        for (const key of Object.keys(value))
            snapshot_notificationDispatch(value[key]);
    }
    return value;
}
/** @throws {never} */
export function snapshot_in_notificationDispatch(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    if (Array.isArray(value)) {
        const copy = new Array(value.length);
        for (let i = 0; i < value.length; i++)
            copy[i] = snapshot_in_notificationDispatch(value[i]);
        return Object.freeze(copy);
    }
    const copy = {};
    for (const key of Object.keys(value))
        copy[key] = snapshot_in_notificationDispatch(value[key]);
    return Object.freeze(copy);
}
