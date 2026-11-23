# Relay item lifecycle

The Network relay desk runs this state machine for each item it handles. The classifier, database and outbound adapter remain effects. The [whole-flow model](models/relay.md) also tracks concurrent consent changes, phone swaps and queue delivery.

## Story: Decide and deliver a selected relay item

> As a member, I want my selected item to reach the other person only after the relay desk allows it, and to hear at once when it did not go.

### A first decision blocks or admits an item

A block ends the item: nothing reaches the other person, the desk keeps no text, and the sender gets the notice of the [relay decision](relayDecision.md) at once. A pass makes the item ready for the send path and records that it was cleared. Only a cleared item can reach the send path. A text item between a minor and a teen partner can be admitted only while teen introductions are not stopped and the pair passes the age rule of [friend introductions with a minor](friendIntroAge.md) at that moment, on friends.help and in the Friend lane of The Network; a phone number or a photo is never relayed from or to a minor, so a teen pair can never swap numbers. Changed (owner decisions 2026-11-22, D1 and D18): a reason held the item for a staff decision or an expiry (`RateLimited`, `Held`, `Released`, `Rejected`, `Expired`) and no item with a minor was admitted -> a reason blocks the item and a current teen pair can relay text, because the rules and the classifier decide alone and the owner allowed teen friendship introductions.

```quint
type RelayPhase = AwaitingVerdict | Blocked | ReadyToSend | Sent | Deferred | SendRefused
type DeliveryResult = Delivered | Queued | Refused
type RelayVerdict = Pass | Block
type RelayLifecycle = { phase: RelayPhase, cleared: bool }

pure val initial: RelayLifecycle = { phase: AwaitingVerdict, cleared: false }

pure def canRecordVerdict(relay: RelayLifecycle): bool = relay.phase == AwaitingVerdict

pure def recordVerdict(relay: RelayLifecycle, verdict: RelayVerdict): RelayLifecycle =
  if (verdict == Pass) { phase: ReadyToSend, cleared: true }
  else { phase: Blocked, cleared: false }

pure def alwaysClearedExactlyAfterAPass(relay: RelayLifecycle): bool =
  relay.cleared iff (relay.phase == ReadyToSend or relay.phase == Sent or relay.phase == Deferred or relay.phase == SendRefused)

pure def stepABlockedItemStaysBlocked(before: RelayLifecycle, after: RelayLifecycle): bool =
  before.phase == Blocked implies after.phase == Blocked

pure def sometimesBlocked(relay: RelayLifecycle): bool = relay.phase == Blocked
```

### The send path determines the result of an admitted item

The send path may send, defer, or refuse an admitted item. It records a delivery result only for a ready item. A refusal updates the relay record so a repeated request cannot claim delivery. A deferred result waits for the recipient's delivery window. Changed (owner decision 2026-11-22, D18): the policy check of a staff release is removed with the release, so only a ready item, which a pass verdict made, reaches this step.

```quint
pure def canRecordDelivery(relay: RelayLifecycle): bool = relay.phase == ReadyToSend

pure def recordDelivery(relay: RelayLifecycle, delivery: DeliveryResult): RelayLifecycle =
  { ...relay, phase: if (delivery == Delivered) Sent else if (delivery == Queued) Deferred else SendRefused }

pure def sometimesDeliveryWaits(relay: RelayLifecycle): bool = relay.phase == Deferred

pure def sometimesSent(relay: RelayLifecycle): bool = relay.phase == Sent
```
