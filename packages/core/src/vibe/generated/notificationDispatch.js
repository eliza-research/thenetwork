// Generated from spec/notificationDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/notificationDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
export const initial = { phase: "DigestStarting" };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
//@ pure
export function inboxItemStillPending(seen, notified) {
    return !seen && !notified;
}
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
//@ pure
export function inboxItemAllowedForRecipient(requested, proactiveAllowed) {
    return requested || proactiveAllowed;
}
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
//@ pure
export function rereadItems(digest, plannedCount, remainingCount, recipientAvailable, destinationChanged) {
    //@ ensures (inv(digest) && canRereadItems(digest)) ==> stepQueueRequiresRecordedDigest(digest, "rereadItems", \result)
    return { phase: remainingCount === 0 || !recipientAvailable ? "DigestCancelled" : (remainingCount === plannedCount && !destinationChanged ? "ReusingDigest" : "RebuildingDigest") };
}
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
//@ pure
export function canRereadItems(digest) {
    return digest.phase === "DigestStarting";
}
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md:9) */
//@ pure
export function lawMissingRecipientCancels(plannedCount, remainingCount, destinationChanged) {
    //@ ensures \result === true
    return rereadItems(initial, plannedCount, remainingCount, false, destinationChanged).phase === "DigestCancelled";
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function digestItemSetCanBeRecorded(itemCount, pendingOwnedCount) {
    return itemCount > 0 && itemCount === pendingOwnedCount;
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function canRecordDigest(digest) {
    return digest.phase === "ReusingDigest" || digest.phase === "RebuildingDigest";
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function recordDigest(digest, recorded) {
    //@ ensures (inv(digest) && canRecordDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "recordDigest", \result)
    return { phase: recorded ? "EnqueueingDigest" : "DigestCancelled" };
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function canEnqueueDigest(digest) {
    return digest.phase === "EnqueueingDigest";
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function enqueueDigest(digest) {
    //@ ensures (inv(digest) && canEnqueueDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "enqueueDigest", \result)
    return { phase: "DigestQueued" };
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function stepQueueRequiresRecordedDigest(before, via, after) {
    return !(after.phase === "DigestQueued") || (before.phase === "EnqueueingDigest" && via === "enqueueDigest");
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function sometimesQueuesDigest(digest) {
    return digest.phase === "DigestQueued";
}
/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md:34) */
//@ pure
export function sometimesCancelsDigest(digest) {
    return digest.phase === "DigestCancelled";
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function inboxItemExpired(hasExpiry, expiresAt, at) {
    return hasExpiry && expiresAt <= at;
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function canReadQueuedDigest(digest) {
    return digest.phase === "DigestStarting";
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function readQueuedDigest(digest, sameDigest) {
    //@ ensures (inv(digest) && canReadQueuedDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "readQueuedDigest", \result)
    return { phase: sameDigest ? "ReadingQueuedItems" : "QueuedDigestObsolete" };
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function canRevalidateQueuedItems(digest) {
    return digest.phase === "ReadingQueuedItems";
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function revalidateQueuedItems(digest, allPresent, anyExpired, anyUnseen) {
    //@ ensures (inv(digest) && canRevalidateQueuedItems(digest)) ==> stepQueueRequiresRecordedDigest(digest, "revalidateQueuedItems", \result)
    return { phase: allPresent && !anyExpired && anyUnseen ? "QueuedDigestNeeded" : "QueuedDigestObsolete" };
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function sometimesKeepsQueuedDigest(digest) {
    return digest.phase === "QueuedDigestNeeded";
}
/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md:57) */
//@ pure
export function sometimesSuppressesQueuedDigest(digest) {
    return digest.phase === "QueuedDigestObsolete";
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "rereadItems")
        return canRereadItems(current);
    if (event.type === "recordDigest")
        return canRecordDigest(current);
    if (event.type === "enqueueDigest")
        return canEnqueueDigest(current);
    if (event.type === "readQueuedDigest")
        return canReadQueuedDigest(current);
    if (event.type === "revalidateQueuedItems")
        return canRevalidateQueuedItems(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "rereadItems" && canRereadItems(current))
        return rereadItems(current, event.plannedCount, event.remainingCount, event.recipientAvailable, event.destinationChanged);
    if (event.type === "recordDigest" && canRecordDigest(current))
        return recordDigest(current, event.recorded);
    if (event.type === "enqueueDigest" && canEnqueueDigest(current))
        return enqueueDigest(current);
    if (event.type === "readQueuedDigest" && canReadQueuedDigest(current))
        return readQueuedDigest(current, event.sameDigest);
    if (event.type === "revalidateQueuedItems" && canRevalidateQueuedItems(current))
        return revalidateQueuedItems(current, event.allPresent, event.anyExpired, event.anyUnseen);
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "rereadItems" && Number.isSafeInteger(raw.plannedCount) && Number.isSafeInteger(raw.remainingCount) && typeof raw.recipientAvailable === "boolean" && typeof raw.destinationChanged === "boolean")
        return { type: "rereadItems", plannedCount: raw.plannedCount, remainingCount: raw.remainingCount, recipientAvailable: raw.recipientAvailable, destinationChanged: raw.destinationChanged };
    if (raw.type === "recordDigest" && typeof raw.recorded === "boolean")
        return { type: "recordDigest", recorded: raw.recorded };
    if (raw.type === "enqueueDigest")
        return { type: "enqueueDigest" };
    if (raw.type === "readQueuedDigest" && typeof raw.sameDigest === "boolean")
        return { type: "readQueuedDigest", sameDigest: raw.sameDigest };
    if (raw.type === "revalidateQueuedItems" && typeof raw.allPresent === "boolean" && typeof raw.anyExpired === "boolean" && typeof raw.anyUnseen === "boolean")
        return { type: "revalidateQueuedItems", allPresent: raw.allPresent, anyExpired: raw.anyExpired, anyUnseen: raw.anyUnseen };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "DigestStarting" || raw.phase === "ReusingDigest" || raw.phase === "RebuildingDigest" || raw.phase === "EnqueueingDigest" || raw.phase === "DigestQueued" || raw.phase === "DigestCancelled" || raw.phase === "ReadingQueuedItems" || raw.phase === "QueuedDigestNeeded" || raw.phase === "QueuedDigestObsolete") && Object.keys(raw).length === 1))
        return undefined;
    const parsed = ({ phase: raw.phase });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
