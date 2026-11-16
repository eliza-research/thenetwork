# Outbound send admission

The [queue model](models/outbound_queue.md) includes workers, leases, retry and receipts. This module checks a due row before the queue can claim it. The shell supplies current eligibility, conversation and line facts and runs the leak check before calling the provider. The storage transaction still performs its final admission checks.

## Story: Recheck a queued message at send time

> As a member, I want the service to respect my consent and sending limits when a queued message is due.

### A current row needs live approval and the recipient's eligibility

A stale or expired row ends first. Every message needs live approval. Except for compliance messages, a current opt-out or recipient restriction stops the row.

```quint
type Admission = Proceed | Expired | ApprovalMissing | OptedOut | RecipientIneligible | ReplyTooOld |
  InvalidZone | QuietHours | AwaitingReply | LinePaused | RecipientCap | LineCap | NewConversationCap |
  PersonCap | LeakReview | Admit

pure def duePolicy(stale: bool): Admission = if (stale) Expired else Proceed
pure def livePolicy(live: bool): Admission = if (live) Proceed else ApprovalMissing
pure def consentPolicy(compliance: bool, optedOut: bool): Admission =
  if (not(compliance) and optedOut) OptedOut else Proceed
pure def recipientPolicy(compliance: bool, eligible: bool): Admission =
  if (not(compliance) and not(eligible)) RecipientIneligible else Proceed

pure def lawOptedOutOnlyGetsCompliance(compliance: bool): bool =
  consentPolicy(compliance, true) == Proceed implies compliance
```

### Replies, quiet hours and unanswered messages limit when a send can go out

A reply must follow a recent inbound. An agent-initiated message needs a valid time zone and waits through quiet hours. After the unanswered limit, an eligible agent-initiated message can use one re-engagement after its waiting period. Otherwise the row waits for an answer. Compliance skips the unanswered limit.

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
