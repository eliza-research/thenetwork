# Outbound send admission

The [queue model](models/outbound_queue.md) includes workers, leases, retry and receipts. This module checks a due row before the queue can claim it. The shell supplies current eligibility, conversation and line facts and runs the leak check before calling the provider. The storage transaction still performs its final admission checks.

## Story: Recheck a queued message at send time

> As a member, I want the service to respect my consent and sending limits when a queued message is due.

### A current row needs live approval and the recipient's eligibility

A stale or expired row ends first. An exact neutral outcome notice for an accepting member may still pass admission after its opportunity closes. Every message needs live approval. Except for compliance messages, a current opt-out or recipient restriction stops the row.

```quint
type Admission = Proceed | Expired | ApprovalMissing | OptedOut | RecipientIneligible | ReplyTooOld |
  InvalidZone | QuietHours | AwaitingReply | LinePaused | RecipientCap | LineCap | NewConversationCap |
  PersonCap | LeakReview | Admit

pure def duePolicy(stale: bool): Admission = if (stale) Expired else Proceed
pure def closedOpportunityRowStale(closed: bool, terminalNotice: bool): bool = closed and not(terminalNotice)
pure def livePolicy(live: bool): Admission = if (live) Proceed else ApprovalMissing
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

A queued probe, plan probe, schedule, booking notice, or reminder needs a current roster with no block between its members. A block in any app applies in either direction. A canonical ban, applicable staff hold, or carried open report restriction on any member of that roster stops the contact even while the app's runtime still has the earlier state. Use the exact roster recorded on a booking notice when present. Otherwise use the recipient and the current participating seats. Declined, dropped, unavailable, and alternate seats do not join that roster. Read the current restrictions again before returning a stored signed reply that carries this contact. Neutral cancellation and safety replies keep their own admission rules.

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

A reply must follow a recent inbound. An agent-initiated message needs a valid time zone and waits through quiet hours. Read the current member's saved window and local zone, falling back to the queue's settings when absent. Equal window endpoints turn quiet hours off. Recheck under the current member lock just before claiming. If the row must wait, schedule it for the first allowed time without using a provider attempt or a person-cap slot. Replies and compliance messages are exempt from quiet hours. After the unanswered limit, an eligible agent-initiated message can use one re-engagement after its waiting period. Otherwise the row waits for an answer. Compliance skips the unanswered limit.

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

### Apply line controls and sending caps before checking the text

Line review pauses every row. A reply-only line holds agent-initiated and new conversations. A pause-new line holds new conversations. Compliance skips the hourly recipient, daily line, and new-conversation caps. The line and new-conversation caps apply to agent-initiated rows. A proactive message also needs its person-cap slot. A leak finding holds the text for staff review.

The shared contact reader treats a plain handle as a leak when a person
states it as their own, names it as a way to contact someone on a social
app, or gives it after a direct invitation to find them on that app.
Ordinary time words, state words and conjunctions after the app name
do not count as handles without a handle marker.

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
