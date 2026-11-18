# Relay item lifecycle

The Network relay desk runs this state machine for each item it handles. The classifier, database and outbound adapter remain effects. The [whole-flow model](models/relay.md) also tracks concurrent consent changes, phone swaps and queue delivery.

## Story: Decide and deliver a selected relay item

> As a member, I want my selected item to reach the other person only after the relay desk allows it.

### A first decision can block, hold, or admit an item

A block ends the item. A hold waits for staff unless the only reason is a rate limit. A pass makes the item ready for the send path. An age signal prevents the held desk from keeping the member's words. Changed: the phases now include Expired, for a held item that staff did not decide by its review deadline, because a held item had no end other than a staff decision (audit OPP21).

```quint
type RelayPhase = AwaitingVerdict | Blocked | RateLimited | Held | ReadyToSend | Released | Rejected | Expired | Sent | Deferred | SendRefused
type DeliveryResult = Delivered | Queued | Refused
type RelayVerdict = Pass | Hold | Block
type RelayLifecycle = { phase: RelayPhase, staffReviewed: bool, retainsText: bool }

pure val initial: RelayLifecycle = { phase: AwaitingVerdict, staffReviewed: false, retainsText: false }

pure def canRecordVerdict(relay: RelayLifecycle): bool = relay.phase == AwaitingVerdict

pure def recordVerdict(relay: RelayLifecycle, verdict: RelayVerdict, rateOnly: bool, hasText: bool, ageSignal: bool): RelayLifecycle =
  if (verdict == Block) { ...relay, phase: Blocked }
  else if (verdict == Pass) { ...relay, phase: ReadyToSend }
  else if (rateOnly) { ...relay, phase: RateLimited }
  else { ...relay, phase: Held, retainsText: hasText and not(ageSignal) }

pure def alwaysOnlyHeldItemRetainsText(relay: RelayLifecycle): bool =
  relay.retainsText implies relay.phase == Held
```

### The send path determines the result of an admitted item

The send path may send, defer, or refuse an admitted item. It records a delivery result only while the current policy permits the item's rendered content: a pass verdict permits it for a ready item, and a fresh policy check permits it for a released item. A refusal updates the relay record so a repeated request cannot claim delivery. A deferred result waits for the recipient's delivery window.

```quint
pure def canRecordDelivery(relay: RelayLifecycle, policyPermits: bool): bool =
  (relay.phase == ReadyToSend or relay.phase == Released) and policyPermits

pure def recordDelivery(relay: RelayLifecycle, delivery: DeliveryResult, policyPermits: bool): RelayLifecycle =
  { ...relay, phase: if (delivery == Delivered) Sent else if (delivery == Queued) Deferred else SendRefused }

pure def sometimesDeliveryWaits(relay: RelayLifecycle): bool = relay.phase == Deferred
```

## Story: Resolve a held item

> As a reviewer, I want to release or reject a held item once, with its original text cleared after the decision.

### Staff review clears the held text

A held item can be released or rejected once. A release may enter the send path only when the current policy permits rendered content. Erasure applies the rejection transition to the held item and clears its text.

```quint
pure val storedHold: RelayLifecycle = { ...initial, phase: Held }

pure def canReviewHold(relay: RelayLifecycle): bool = relay.phase == Held

pure def reviewHold(relay: RelayLifecycle, released: bool): RelayLifecycle =
  { phase: if (released) Released else Rejected, staffReviewed: true, retainsText: false }

pure def stepReviewRemainsRecorded(before: RelayLifecycle, after: RelayLifecycle): bool =
  before.staffReviewed implies after.staffReviewed

pure def sometimesReviewReleases(relay: RelayLifecycle): bool = relay.phase == Released
pure def sometimesReviewRejects(relay: RelayLifecycle): bool = relay.phase == Rejected
```

## Story: Close a held item that staff do not decide in time

> As a member, I want my held message to end at the review deadline instead of reaching my match days later, and I want to know that it did not go.

### A held item that staff do not decide by its review deadline expires unsent

The review deadline of a held item is the time it was held plus the network's review window, the same window that closes an unreviewed proposal. The deadline is exclusive: at the deadline the item expires, its text is cleared, and it can never be released or sent. The desk tells the sender that the item did not go, in one notice for all of that sender's items that expire together, and records a review expiry for each item, which the operations alerts count as a missed review SLA. Before the deadline, a held item that waited longer than its app's review SLA raises the review SLA alert of the operations timing rules. The desk expires due items at each tick and before each staff release or rejection, so a staff decision after the deadline finds the item expired. New rule: a held item had no expiry and no alert (audit OPP21).

```quint
pure def canExpireHold(relay: RelayLifecycle, now: int, deadline: int): bool =
  relay.phase == Held and now >= deadline

pure def expireHold(relay: RelayLifecycle, now: int, deadline: int): RelayLifecycle =
  { ...relay, phase: Expired, retainsText: false }

pure def stepExpiredItemStaysUnsent(before: RelayLifecycle, after: RelayLifecycle): bool =
  before.phase == Expired implies after.phase == Expired

pure def sometimesHoldExpires(relay: RelayLifecycle): bool = relay.phase == Expired
```
