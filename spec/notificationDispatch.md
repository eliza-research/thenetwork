# Dispatch an inbox digest

A scheduler plan is tentative until the inbox and recipient are read again. A VibeLang shell runs the generated rules through the scheduler's inbox, recipient and outbound adapters. The application and outbound queue still check recipient eligibility, consent and leak safety before delivery.

## Story: Get a pending inbox update only while it is relevant

> As a member, I want the scheduler to leave out updates I already saw or received and to send a queued digest only while its contents remain eligible for delivery.

### Re-read the planned items before recording a digest

Keep only items that remain unseen, unnotified and unexpired. A recipient who no longer allows proactive updates can still get requested items. Cancel the original plan if no items remain or the recipient is unavailable. Rebuild the digest if some items were removed, the recipient's address, channel or time zone changed, or a prepared assistant link no longer covers the item app. Reuse the original plan while its items, destination and link authority still fit.

```quint
type DigestPhase =
  DigestStarting | ReusingDigest | RebuildingDigest | EnqueueingDigest | DigestQueued |
  DigestCancelled | ReadingQueuedItems | QueuedDigestNeeded | QueuedDigestObsolete
type DigestFlow = { phase: DigestPhase }
pure val initial: DigestFlow = { phase: DigestStarting }

pure def inboxItemStillPending(seen: bool, notified: bool): bool = not(seen) and not(notified)

pure def inboxItemExpired(hasExpiry: bool, expiresAt: int, at: int): bool =
  hasExpiry and expiresAt <= at

pure def inboxItemDigestible(seen: bool, notified: bool, hasExpiry: bool, expiresAt: int, at: int): bool =
  inboxItemStillPending(seen, notified) and not(inboxItemExpired(hasExpiry, expiresAt, at))

pure def lawExpiredItemLeavesTheDigest(seen: bool, notified: bool, expiresAt: int, at: int): bool =
  (expiresAt <= at) implies not(inboxItemDigestible(seen, notified, true, expiresAt, at))

pure def inboxItemAllowedForRecipient(requested: bool, proactiveAllowed: bool): bool = requested or proactiveAllowed

pure def canRereadItems(digest: DigestFlow): bool = digest.phase == DigestStarting
pure def rereadItems(digest: DigestFlow, plannedCount: int, remainingCount: int, recipientAvailable: bool, destinationChanged: bool): DigestFlow =
  { phase:
    if (remainingCount == 0 or not(recipientAvailable)) DigestCancelled
    else if (remainingCount == plannedCount and not(destinationChanged)) ReusingDigest
    else RebuildingDigest }

pure def lawMissingRecipientCancels(plannedCount: int, remainingCount: int, destinationChanged: bool): bool =
  rereadItems(initial, plannedCount, remainingCount, false, destinationChanged).phase == DigestCancelled
```

### The sink receives only a recorded digest

Record the final plan before asking the sink to enqueue it. The store locks the selected items and requires every item to belong to the recipient and remain unseen, unnotified and unexpired at recording. It rejects repeated IDs and overlapping claims. A recording rejection cancels that plan, using its final delivery ID. Count the plan as queued only after the sink accepts it.

```quint
pure def digestItemSetCanBeRecorded(itemCount: int, pendingOwnedCount: int): bool =
  itemCount > 0 and itemCount == pendingOwnedCount

pure def canRecordDigest(digest: DigestFlow): bool =
  digest.phase == ReusingDigest or digest.phase == RebuildingDigest
pure def recordDigest(digest: DigestFlow, recorded: bool): DigestFlow =
  { phase: if (recorded) EnqueueingDigest else DigestCancelled }

pure def canEnqueueDigest(digest: DigestFlow): bool = digest.phase == EnqueueingDigest
pure def enqueueDigest(digest: DigestFlow): DigestFlow = { phase: DigestQueued }

pure def stepQueueRequiresRecordedDigest(before: DigestFlow, via: str, after: DigestFlow): bool =
  after.phase == DigestQueued implies (before.phase == EnqueueingDigest and via == "enqueueDigest")

pure def sometimesQueuesDigest(digest: DigestFlow): bool = digest.phase == DigestQueued
pure def sometimesCancelsDigest(digest: DigestFlow): bool = digest.phase == DigestCancelled
```

### A queued digest is relevant only while its original content remains live and unseen in part

The recorded item-set ID must still identify the queued digest. Every recorded item must still exist and be unexpired. If all items have been seen, suppress the digest. Seeing only some items keeps the complete queued text eligible, provided every original item still exists and is unexpired.

```quint
pure def canReadQueuedDigest(digest: DigestFlow): bool = digest.phase == DigestStarting
pure def readQueuedDigest(digest: DigestFlow, sameDigest: bool): DigestFlow =
  { phase: if (sameDigest) ReadingQueuedItems else QueuedDigestObsolete }

pure def canRevalidateQueuedItems(digest: DigestFlow): bool = digest.phase == ReadingQueuedItems
pure def revalidateQueuedItems(digest: DigestFlow, allPresent: bool, anyExpired: bool, anyUnseen: bool): DigestFlow =
  { phase: if (allPresent and not(anyExpired) and anyUnseen) QueuedDigestNeeded else QueuedDigestObsolete }

pure def sometimesKeepsQueuedDigest(digest: DigestFlow): bool = digest.phase == QueuedDigestNeeded
pure def sometimesSuppressesQueuedDigest(digest: DigestFlow): bool = digest.phase == QueuedDigestObsolete
```

### Recheck assistant access before claiming an immutable queued text

The provider can claim a queued digest only for its recorded recipient. A text showing the recorded items in the thread needs no assistant grant. A text containing a handoff must match the recorded body, have an unexpired reference, and cover exactly one app. Every assistant offered by that text must still have a readable grant for that recipient in the digest app. When any of these checks fails, withhold the stored text and leave unseen items available in the inbox. A stored text without render evidence can proceed only if its body matches the plain thread digest.

```quint
pure def queuedDigestClaimAllowed(sameRecipient: bool, threadCopy: bool, boundLink: bool, appScoped: bool, referenceLive: bool, allAssistantsReadable: bool): bool =
  sameRecipient and (threadCopy or (boundLink and appScoped and referenceLive and allAssistantsReadable))

pure def lawUnreadableQueuedLinkCannotSend(sameRecipient: bool, boundLink: bool, appScoped: bool, referenceLive: bool): bool =
  not(queuedDigestClaimAllowed(sameRecipient, false, boundLink, appScoped, referenceLive, false))

pure def lawForeignQueuedDigestCannotSend(threadCopy: bool, boundLink: bool, appScoped: bool, referenceLive: bool, allAssistantsReadable: bool): bool =
  not(queuedDigestClaimAllowed(false, threadCopy, boundLink, appScoped, referenceLive, allAssistantsReadable))
```
