# Relay item lifecycle

The Network relay desk runs this state machine for each item it handles. The classifier, database and outbound adapter remain effects. The [whole-flow model](models/relay.md) also tracks concurrent consent changes, phone swaps and queue delivery.

## Story: Decide and deliver a selected relay item

> As a member, I want my selected item to reach the other person only after the relay desk allows it.

### A first decision can block, hold, or admit an item

A block ends the item. A hold waits for staff unless the only reason is a rate limit. A pass makes the item ready for the send path. An age signal prevents the held desk from keeping the member's words.

```quint
type RelayPhase = AwaitingVerdict | Blocked | RateLimited | Held | ReadyToSend | Released | Rejected | Sent | Deferred | SendRefused
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

The send path may send, defer, or refuse an admitted item. A refusal updates the relay record so a repeated request cannot claim delivery. A deferred result waits for the recipient's delivery window.

```quint
pure def canRecordDelivery(relay: RelayLifecycle): bool = relay.phase == ReadyToSend or relay.phase == Released

pure def recordDelivery(relay: RelayLifecycle, delivery: DeliveryResult): RelayLifecycle =
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
