# Dispatch an inbox digest

A scheduler plan is tentative until the inbox is read again. The scheduler owns the database reads, revised digest content and ID, delivery recording, and enqueue. Outside this decision, the application and outbound queue still check recipient eligibility, consent and leak safety before delivery.

## Story: Get a pending inbox update only while it is relevant

> As a member, I want the scheduler to leave out updates I already saw or received and to send a queued digest only while its contents remain eligible for delivery.

### Re-read the planned items before recording a digest

Keep only items that remain unseen and unnotified. If none remain, cancel the original plan. If some were removed, rebuild the text, item-set ID and surface from the remaining items. If all remain, reuse the original plan.

```quint
type DigestPhase =
  DigestStarting | ReusingDigest | RebuildingDigest | EnqueueingDigest | DigestQueued |
  DigestCancelled | ReadingQueuedItems | QueuedDigestNeeded | QueuedDigestObsolete
type DigestFlow = { phase: DigestPhase }
pure val initial: DigestFlow = { phase: DigestStarting }

pure def inboxItemStillPending(seen: bool, notified: bool): bool = not(seen) and not(notified)

pure def canRereadItems(digest: DigestFlow): bool = digest.phase == DigestStarting
pure def rereadItems(digest: DigestFlow, plannedCount: int, remainingCount: int): DigestFlow =
  { phase:
    if (remainingCount == 0) DigestCancelled
    else if (remainingCount == plannedCount) ReusingDigest
    else RebuildingDigest }
```

### The sink receives only a recorded digest

Record the final plan before asking the sink to enqueue it. A recording rejection cancels that plan, using its final delivery ID. Count the plan as queued only after the sink accepts it. The store owns the transaction and rejects repeated delivery IDs.

```quint
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

pure def inboxItemExpired(hasExpiry: bool, expiresAt: int, at: int): bool =
  hasExpiry and expiresAt <= at

pure def canRevalidateQueuedItems(digest: DigestFlow): bool = digest.phase == ReadingQueuedItems
pure def revalidateQueuedItems(digest: DigestFlow, allPresent: bool, anyExpired: bool, anyUnseen: bool): DigestFlow =
  { phase: if (allPresent and not(anyExpired) and anyUnseen) QueuedDigestNeeded else QueuedDigestObsolete }

pure def sometimesKeepsQueuedDigest(digest: DigestFlow): bool = digest.phase == QueuedDigestNeeded
pure def sometimesSuppressesQueuedDigest(digest: DigestFlow): bool = digest.phase == QueuedDigestObsolete
```
