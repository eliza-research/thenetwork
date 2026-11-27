// GENERATED from spec/notificationDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
export type DigestPhase = "DigestStarting" | "ReusingDigest" | "RebuildingDigest" | "EnqueueingDigest" | "DigestQueued" | "DigestCancelled" | "ReadingQueuedItems" | "QueuedDigestNeeded" | "QueuedDigestObsolete";
/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
export interface DigestFlow { phase: DigestPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "rereadItems"; plannedCount: number; remainingCount: number; recipientAvailable: boolean; destinationChanged: boolean }
  | { type: "recordDigest"; recorded: boolean }
  | { type: "enqueueDigest" }
  | { type: "readQueuedDigest"; sameDigest: boolean }
  | { type: "revalidateQueuedItems"; allPresent: boolean; anyExpired: boolean; anyUnseen: boolean };

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
export const initial: DigestFlow = { phase: "DigestStarting" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: DigestFlow): boolean {
  return true;
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function inboxItemStillPending(seen: boolean, notified: boolean): boolean {
  return !seen && !notified;
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function inboxItemExpired(hasExpiry: boolean, expiresAt: number, at: number): boolean {
  return hasExpiry && expiresAt <= at;
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function inboxItemDigestible(seen: boolean, notified: boolean, hasExpiry: boolean, expiresAt: number, at: number): boolean {
  return inboxItemStillPending(seen, notified) && !inboxItemExpired(hasExpiry, expiresAt, at);
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function lawExpiredItemLeavesTheDigest(seen: boolean, notified: boolean, expiresAt: number, at: number): boolean {
  //@ ensures \result === true
  return !(expiresAt <= at) || !inboxItemDigestible(seen, notified, true, expiresAt, at);
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function inboxItemAllowedForRecipient(requested: boolean, proactiveAllowed: boolean): boolean {
  return requested || proactiveAllowed;
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function rereadCountsPossible(plannedCount: number, remainingCount: number): boolean {
  return plannedCount >= 1 && remainingCount >= 0 && remainingCount <= plannedCount;
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function canRereadItems(digest: DigestFlow, plannedCount: number, remainingCount: number): boolean {
  return digest.phase === "DigestStarting" && rereadCountsPossible(plannedCount, remainingCount);
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function rereadItems(digest: DigestFlow, plannedCount: number, remainingCount: number, recipientAvailable: boolean, destinationChanged: boolean): DigestFlow {
  //@ ensures (inv(digest) && canRereadItems(digest, plannedCount, remainingCount)) ==> stepQueueRequiresRecordedDigest(digest, "rereadItems", \result)
  return { phase: remainingCount === 0 || !recipientAvailable ? "DigestCancelled" : (remainingCount === plannedCount && !destinationChanged ? "ReusingDigest" : "RebuildingDigest") };
}

/** Story: Get a pending inbox update only while it is relevant / Re-read the planned items before recording a digest (spec/notificationDispatch.md) */
//@ pure
export function lawMissingRecipientCancels(plannedCount: number, remainingCount: number, destinationChanged: boolean): boolean {
  //@ ensures \result === true
  return rereadItems(initial, plannedCount, remainingCount, false, destinationChanged).phase === "DigestCancelled";
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function digestItemSetCanBeRecorded(itemCount: number, pendingOwnedCount: number): boolean {
  return itemCount > 0 && itemCount === pendingOwnedCount;
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function digestWithinWeeklyCap(countsTowardCap: boolean, countedSends: number, weeklyCap: number): boolean {
  return !countsTowardCap || countedSends < weeklyCap;
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function lawRecordedCountingDigestStaysUnderCap(countedSends: number, weeklyCap: number): boolean {
  //@ ensures \result === true
  return !digestWithinWeeklyCap(true, countedSends, weeklyCap) || exact_notificationDispatch(countedSends + 1) <= weeklyCap;
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function canRecordDigest(digest: DigestFlow): boolean {
  return digest.phase === "ReusingDigest" || digest.phase === "RebuildingDigest";
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function recordDigest(digest: DigestFlow, recorded: boolean): DigestFlow {
  //@ ensures (inv(digest) && canRecordDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "recordDigest", \result)
  return { phase: recorded ? "EnqueueingDigest" : "DigestCancelled" };
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function canEnqueueDigest(digest: DigestFlow): boolean {
  return digest.phase === "EnqueueingDigest";
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function enqueueDigest(digest: DigestFlow): DigestFlow {
  //@ ensures (inv(digest) && canEnqueueDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "enqueueDigest", \result)
  return { phase: "DigestQueued" };
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function stepQueueRequiresRecordedDigest(before: DigestFlow, via: string, after: DigestFlow): boolean {
  return !(after.phase === "DigestQueued") || (before.phase === "EnqueueingDigest" && via === "enqueueDigest");
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function sometimesQueuesDigest(digest: DigestFlow): boolean {
  return digest.phase === "DigestQueued";
}

/** Story: Get a pending inbox update only while it is relevant / The sink receives only a recorded digest (spec/notificationDispatch.md) */
//@ pure
export function sometimesCancelsDigest(digest: DigestFlow): boolean {
  return digest.phase === "DigestCancelled";
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function canReadQueuedDigest(digest: DigestFlow): boolean {
  return digest.phase === "DigestStarting";
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function readQueuedDigest(digest: DigestFlow, sameDigest: boolean): DigestFlow {
  //@ ensures (inv(digest) && canReadQueuedDigest(digest)) ==> stepQueueRequiresRecordedDigest(digest, "readQueuedDigest", \result)
  return { phase: sameDigest ? "ReadingQueuedItems" : "QueuedDigestObsolete" };
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function canRevalidateQueuedItems(digest: DigestFlow): boolean {
  return digest.phase === "ReadingQueuedItems";
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function revalidateQueuedItems(digest: DigestFlow, allPresent: boolean, anyExpired: boolean, anyUnseen: boolean): DigestFlow {
  //@ ensures (inv(digest) && canRevalidateQueuedItems(digest)) ==> stepQueueRequiresRecordedDigest(digest, "revalidateQueuedItems", \result)
  return { phase: allPresent && !anyExpired && anyUnseen ? "QueuedDigestNeeded" : "QueuedDigestObsolete" };
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function sometimesKeepsQueuedDigest(digest: DigestFlow): boolean {
  return digest.phase === "QueuedDigestNeeded";
}

/** Story: Get a pending inbox update only while it is relevant / A queued digest is relevant only while its original content remains live and unseen in part (spec/notificationDispatch.md) */
//@ pure
export function sometimesSuppressesQueuedDigest(digest: DigestFlow): boolean {
  return digest.phase === "QueuedDigestObsolete";
}

/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) */
//@ pure
export function queuedDigestClaimAllowed(sameRecipient: boolean, threadCopy: boolean, boundLink: boolean, appScoped: boolean, referenceLive: boolean, allAssistantsReadable: boolean): boolean {
  return sameRecipient && (threadCopy || (boundLink && appScoped && referenceLive && allAssistantsReadable));
}

/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) */
//@ pure
export function lawUnreadableQueuedLinkCannotSend(sameRecipient: boolean, boundLink: boolean, appScoped: boolean, referenceLive: boolean): boolean {
  //@ ensures \result === true
  return !queuedDigestClaimAllowed(sameRecipient, false, boundLink, appScoped, referenceLive, false);
}

/** Story: Get a pending inbox update only while it is relevant / Recheck assistant access before claiming an immutable queued text (spec/notificationDispatch.md) */
//@ pure
export function lawForeignQueuedDigestCannotSend(threadCopy: boolean, boundLink: boolean, appScoped: boolean, referenceLive: boolean, allAssistantsReadable: boolean): boolean {
  //@ ensures \result === true
  return !queuedDigestClaimAllowed(false, threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: DigestFlow, event: Event): boolean {
  if (event.type === "rereadItems") return canRereadItems(current, event.plannedCount, event.remainingCount);
  if (event.type === "recordDigest") return canRecordDigest(current);
  if (event.type === "enqueueDigest") return canEnqueueDigest(current);
  if (event.type === "readQueuedDigest") return canReadQueuedDigest(current);
  if (event.type === "revalidateQueuedItems") return canRevalidateQueuedItems(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: DigestFlow, event: Event): DigestFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "rereadItems") return canRereadItems(current, event.plannedCount, event.remainingCount) ? rereadItems(current, event.plannedCount, event.remainingCount, event.recipientAvailable, event.destinationChanged) : current;
  if (event.type === "recordDigest") return canRecordDigest(current) ? recordDigest(current, event.recorded) : current;
  if (event.type === "enqueueDigest") return canEnqueueDigest(current) ? enqueueDigest(current) : current;
  if (event.type === "readQueuedDigest") return canReadQueuedDigest(current) ? readQueuedDigest(current, event.sameDigest) : current;
  if (event.type === "revalidateQueuedItems") return canRevalidateQueuedItems(current) ? revalidateQueuedItems(current, event.allPresent, event.anyExpired, event.anyUnseen) : current;
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
  if (raw.type === "rereadItems" && Number.isSafeInteger(raw.plannedCount) && Number.isSafeInteger(raw.remainingCount) && typeof raw.recipientAvailable === "boolean" && typeof raw.destinationChanged === "boolean") return { type: "rereadItems", plannedCount: raw.plannedCount, remainingCount: raw.remainingCount, recipientAvailable: raw.recipientAvailable, destinationChanged: raw.destinationChanged };
  if (raw.type === "recordDigest" && typeof raw.recorded === "boolean") return { type: "recordDigest", recorded: raw.recorded };
  if (raw.type === "enqueueDigest") return { type: "enqueueDigest" };
  if (raw.type === "readQueuedDigest" && typeof raw.sameDigest === "boolean") return { type: "readQueuedDigest", sameDigest: raw.sameDigest };
  if (raw.type === "revalidateQueuedItems" && typeof raw.allPresent === "boolean" && typeof raw.anyExpired === "boolean" && typeof raw.anyUnseen === "boolean") return { type: "revalidateQueuedItems", allPresent: raw.allPresent, anyExpired: raw.anyExpired, anyUnseen: raw.anyUnseen };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): DigestFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "DigestStarting" || raw.phase === "ReusingDigest" || raw.phase === "RebuildingDigest" || raw.phase === "EnqueueingDigest" || raw.phase === "DigestQueued" || raw.phase === "DigestCancelled" || raw.phase === "ReadingQueuedItems" || raw.phase === "QueuedDigestNeeded" || raw.phase === "QueuedDigestObsolete") && Object.keys(raw).length === 1)) return undefined;
  const parsed: DigestFlow = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): DigestFlow {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_notificationDispatch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
