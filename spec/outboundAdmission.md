# Outbound send admission

The [queue model](models/outbound_queue.md) includes workers, leases, retry and receipts. This module checks a due row before the queue can claim it. The shell supplies current eligibility, conversation and line facts and runs the leak check before calling the provider. The storage transaction still performs its final admission checks.

## Story: Recheck a queued message at send time

> As a member, I want the service to respect my consent and sending limits when a queued message is due.

### A current row needs a delivering line and the recipient's eligibility

A stale or expired row ends first. An exact neutral outcome notice for an accepting member may still pass admission after its opportunity closes. Every message needs a delivering line: the line of a dry-run service refuses every row. Changed (owner decision 2026-11-22): this check read the live approvals `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` and `<APP>_LIVE_APPROVED`; the owner approved every app, so the line of a configured channel always delivers and only the dry-run line refuses ([startup configuration](bootPolicy.md#the-configured-channel-alone-decides-whether-a-send-is-real)). Except for compliance messages, a current opt-out or recipient restriction stops the row. The claim transaction reads the consent ledger again for every row except compliance, a direct text to someone who is not a member too. Changed 2026-11-18: the claim read the ledger again only for a row with a member (Q-outbound_queue-1), so a STOP that committed during the checks did not stop a direct text. A booking notice that carries a venue booking link is eligible only while the current booking still approves that exact link, and this check comes before the leak check. A permanent refusal by the admission check in the claim transaction stores the check's reason with the row; the other refusals in that transaction (opted out, ineligible account, forgotten member) store only their status. Changed 2026-11-22: when the venue of a booking changed, the leak check found the old link first and parked the notice for staff review, although the notice was no longer eligible; and a refusal by the admission check stored no reason.

```quint
type Admission = Proceed | Expired | DryRunLine | OptedOut | RecipientIneligible | ReplyTooOld |
  InvalidZone | QuietHours | AwaitingReply | LinePaused | RecipientCap | LineCap | NewConversationCap |
  PersonCap | LeakReview | Admit

pure def duePolicy(stale: bool): Admission = if (stale) Expired else Proceed
pure def closedOpportunityRowStale(closed: bool, terminalNotice: bool): bool = closed and not(terminalNotice)
pure def livePolicy(live: bool): Admission = if (live) Proceed else DryRunLine
pure def consentPolicy(compliance: bool, optedOut: bool): Admission =
  if (not(compliance) and optedOut) OptedOut else Proceed
pure def recipientPolicy(compliance: bool, eligible: bool): Admission =
  if (not(compliance) and not(eligible)) RecipientIneligible else Proceed

pure def lawOptedOutOnlyGetsCompliance(compliance: bool): bool =
  consentPolicy(compliance, true) == Proceed implies compliance
```

### A cancelled booking can notify a participant who received the booked plan

Give a terminal booking cancellation one ID per opportunity and recipient. An accepted seat with a recorded booking notice can get a queued cancellation. Before delivery, verify the exact stored cancellation, the cancelled booked plan, and [receipt of the booking notice](meetingSettlement.md#claim-a-cancellation-only-for-a-member-who-received-booking-details). A cancellation must arrive before the meeting start. The text does not identify other participants or the reason. Verify consent, quiet hours, and text safety as for other cancellation messages.

```quint
pure val bookedCancellationPrefix = "booked-cancellation:"

pure def bookedCancellationAllowed(cancelled: bool, acceptedSeat: bool, told: bool, remainingMs: int): bool =
  cancelled and acceptedSeat and told and remainingMs > 0

pure def lawBookedCancellationNeedsPriorBooking(cancelled: bool, acceptedSeat: bool, told: bool, remainingMs: int): bool =
  bookedCancellationAllowed(cancelled, acceptedSeat, told, remainingMs) implies (cancelled and acceptedSeat and told)
```

### A queued match invitation still needs the member's current settings

Before a proactive matching probe is claimed, read the current app's member settings and the opportunity's category inside the claim transaction. A pause or disallowed category stops the probe. A missing category cannot authorize a probe. Replies, compliance messages and logistics for existing plans keep their usual rules.

```quint
pure def queuedProbePolicy(proactiveProbe: bool, paused: bool, categoryAllowed: bool): Admission =
  if (proactiveProbe and (paused or not(categoryAllowed))) RecipientIneligible else Proceed

pure def lawPausedProbeCannotProceed(categoryAllowed: bool): bool =
  queuedProbePolicy(true, true, categoryAllowed) == RecipientIneligible
```

### Recheck blocks between the participants before contact

A queued probe, plan probe, schedule, booking notice, or reminder needs a current roster with no block between its members. When the roster holds a minor, the contact also needs a teen friendship item that is still current under the age rule of [friend introductions with a minor](friendIntroAge.md) at send time, while no stop is stored, over the stored roster with its plan host and the exact roster of the message, and only while the stored item keeps its friendship shape and the size of a small group. Changed (owner decision 2026-11-22, answers A2 to A5): the check read a stored switch that two admins turned on; now teen introductions are on unless a stop is stored, and a teen group plan of at most 6 people can queue contacts, so the check also reads the shape and the size. Changed (owner decision 2026-11-22): the claim transaction did not read ages, because the network refused every minor before it queued a contact; it now refuses a queued contact whose roster holds a minor unless that rule holds, because teen friendship items can queue contacts for a minor. A block in any app applies in either direction. A canonical ban, applicable staff hold, or carried open report restriction on any member of that roster stops the contact even while the app's runtime still has the earlier state. Use the exact roster recorded on a booking notice when present. Otherwise use the recipient and the current participating seats. Declined, dropped, unavailable, and alternate seats do not join that roster. Read the current restrictions again before returning a stored signed reply that carries this contact. Neutral cancellation and safety replies keep their own admission rules.

```quint
pure val peerContactTypes: List[str] = List("probe", "plan_probe", "scheduling", "proposal", "reminder")
pure val peerContactSeatStatuses: List[str] = List("pending", "checking", "available", "accepted", "confirmed", "attended")

pure def queuedPeerContactPolicy(rosterBlocked: bool, rosterRestricted: bool): Admission =
  if (rosterBlocked or rosterRestricted) RecipientIneligible else Proceed

pure def lawBlockedRosterCannotProceed(rosterRestricted: bool): bool =
  queuedPeerContactPolicy(true, rosterRestricted) != Proceed

pure def lawRestrictedRosterCannotProceed(rosterBlocked: bool): bool =
  queuedPeerContactPolicy(rosterBlocked, true) != Proceed
```

### Replies, quiet hours and unanswered messages limit when a send can go out

A reply must follow a recent inbound. An agent-initiated message needs a valid time zone and waits through quiet hours. Read the current member's saved window and local zone, falling back to the queue's settings when absent. Equal window endpoints turn quiet hours off. Recheck under the current member lock just before claiming. If the row must wait, schedule it for the first allowed time without using a provider attempt or a person-cap slot. Replies and compliance messages are exempt from quiet hours. After the unanswered limit, an eligible agent-initiated message can use one re-engagement after its waiting period. Otherwise the row waits for an answer. Compliance skips the unanswered limit. A reply that the gateway sent in a signed turn counts in the unanswered streak as a queued send does. Changed 2026-11-18: an accepted gateway reply did not count (SD-148), so a fourth unanswered message could go.

```quint
pure def replyPolicy(reply: bool, recentInbound: bool): Admission =
  if (reply and not(recentInbound)) ReplyTooOld else Proceed

pure def quietPolicy(agent: bool, validZone: bool, quiet: bool): Admission =
  if (not(agent)) Proceed else if (not(validZone)) InvalidZone else if (quiet) QuietHours else Proceed

type ConversationAdmission = { decision: Admission, reengage: bool }

pure def conversationPolicy(compliance: bool, atCap: bool, agent: bool, reengaged: bool, waited: bool): ConversationAdmission =
  if (compliance or not(atCap)) { decision: Proceed, reengage: false }
  else if (agent and not(reengaged) and waited) { decision: Proceed, reengage: true }
  else { decision: AwaitingReply, reengage: false }
```

### A row does not wait for an answer that the person already gave

A row waits for an answer only when the person did not write after the check read the conversation. When the person wrote during the check, the release of held rows may already have run, so the row is due again at once. Changed 2026-11-18: the queue held such a row although the person had written (SD-147), and it waited until the next message or its expiry.

```quint
pure def holdForReply(personWroteSinceRead: bool): Admission = if (personWroteSinceRead) Proceed else AwaitingReply

pure def lawWriteDuringCheckReleasesRow(personWroteSinceRead: bool): bool =
  holdForReply(personWroteSinceRead) == AwaitingReply implies not(personWroteSinceRead)
```

### A check that cannot answer delays the row and never sends it

When a send-time check throws (the stale check of a notification, or a database error in the claim transaction), the row is not sent. It counts one attempt and waits with the provider backoff, then runs every check again with the same provider key. Only when its attempts are used up is it parked for a person. The error changes the row only while it still has the status the check read. Changed 2026-11-18: a stale check that threw read as current and the row was sent (SD-299), and any other error parked the row at once with no retry (SD-117).

```quint
type DispatchFailure = RetryDispatch | ParkDispatch

pure def dispatchFailurePolicy(hasAttemptsLeft: bool): DispatchFailure = if (hasAttemptsLeft) RetryDispatch else ParkDispatch

pure def lawDispatchParksOnlyWithoutAttempts(hasAttemptsLeft: bool): bool =
  dispatchFailurePolicy(hasAttemptsLeft) == ParkDispatch iff not(hasAttemptsLeft)
```

### A claim needs the Network state that its checks read

The stale check, the recipient check and the leak check read the replica's copy of the Network state. The claim transaction locks the stored state. After the checks that read the stored rows, it claims a row only when the stored version is still the version of the copy; otherwise the row waits with the same provider key and without its person-cap slot. A runtime drain whose copy is not the stored version loads the stored state before its checks, and a drain that ends with such a copy loads it and drains once more. A copy whose unit failed before its save has no known version. Changed 2026-11-19: a replica sent from an old copy after another replica closed the item or held the member (SD-020). Changed 2026-11-21: a drain ran its checks on an old copy before it loaded the stored state, so an opt-out or hold that another replica had lifted ended a row for good; the drain now loads the stored state first. Changed 2026-11-22: this sentence records the interleaving that remains. Another replica can commit after the reload and before the checks, so a drain can still end a row by a refusal that it decided on an old copy. That row is not sent, because the claim compares the stored version with the version of the copy. The refusal is fail-safe: it can lose one message, but it never sends one.

```quint
type ViewCheck = ViewCurrent | ViewChanged

pure def viewPolicy(storedVersion: str, viewVersion: str): ViewCheck =
  if (viewVersion != "" and storedVersion == viewVersion) ViewCurrent else ViewChanged

pure def lawClaimOnlyFromStoredVersion(storedVersion: str, viewVersion: str): bool =
  viewPolicy(storedVersion, viewVersion) == ViewCurrent implies (viewVersion != "" and storedVersion == viewVersion)
```

### Apply line controls and sending caps before checking the text

Line review pauses every row. A reply-only line holds agent-initiated and new conversations. A pause-new line holds new conversations. Compliance skips the hourly recipient, daily line, and new-conversation caps. The line and new-conversation caps apply to agent-initiated rows. A proactive message also needs its person-cap slot. A leak finding holds the text for staff review.

```quint
pure def linePolicy(lineAction: str, agent: bool, newConversation: bool): Admission =
  if (lineAction == "review" or (lineAction == "reply_only" and (agent or newConversation)) or (lineAction == "pause_new" and newConversation)) LinePaused
  else Proceed

pure def lineCaps(compliance: bool, agent: bool, newConversation: bool, recipientAtCap: bool, lineAtCap: bool, newAtCap: bool): Admission =
  if (compliance) Proceed
  else if (recipientAtCap) RecipientCap
  else if (agent and lineAtCap) LineCap
  else if (agent and newConversation and newAtCap) NewConversationCap
  else Proceed

pure def personPolicy(slotAllowed: bool): Admission = if (slotAllowed) Proceed else PersonCap
pure def textPolicy(foundLeak: bool): Admission = if (foundLeak) LeakReview else Admit

pure def lawLeakBlocksAdmission(foundLeak: bool): bool = foundLeak implies textPolicy(foundLeak) != Admit
```
