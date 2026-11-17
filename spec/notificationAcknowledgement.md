# Read and acknowledge inbox updates

The caller enters with the member identity established by the authenticated app or the thread. The scheduler keeps the member's surface activity, inbox rows, token records, and delivery outcomes in the notify store. The store owns first writes and the scheduler uses their results to decide what to expose or count.

## Story: See my own updates on the surface I am using

> As a member, I want to read my updates on the current surface and have those updates marked seen across my inbox.

### A scoped surface shows only items from its app

The shell reads the member's unseen, unexpired inbox and filters it to the requested app if there is one. An update token limits that result to the token's items. A valid token with no matching items returns an empty result.

```quint
pure def appAllowsInboxItem(scoped: bool, sameApp: bool): bool = not(scoped) or sameApp

pure def lawScopedReadRequiresAppMatch(sameApp: bool): bool =
  appAllowsInboxItem(true, sameApp) implies sameApp
```

### A delivered text can appear only once and its opportunity must still be current

Key a delivered Network text by its message ID, with the opportunity as
context when there is one. A repeated projection uses the same durable
delivery ID, including for a retained older subject. Each new accepted text
about that opportunity remains a separate item. Resolve an item's opportunity
in the caller's app. Retained subjects that used only the opportunity or
message ID still resolve there. Omit a closed opportunity or a missing
opportunity from an explicitly bound text. Retire stale items as seen with
the selected read. Ordinary updates with no opportunity remain visible.

```quint
pure def inboxOpportunityTerminal(opportunityStatus: str): bool =
  opportunityStatus == "COMPLETED" or opportunityStatus == "FEEDBACK_COLLECTED" or opportunityStatus == "DECLINED" or opportunityStatus == "EXPIRED" or
    opportunityStatus == "CANCELLED" or opportunityStatus == "SKIPPED" or opportunityStatus == "ABANDONED" or opportunityStatus == "QUORUM_FAILED"

pure def inboxOpportunityAllowsUpdate(bound: bool, found: bool, opportunityStatus: str): bool =
  not(bound) or (found and not(inboxOpportunityTerminal(opportunityStatus)))

pure def lawClosedOpportunityCannotDisplay(opportunityStatus: str): bool =
  inboxOpportunityTerminal(opportunityStatus) implies not(inboxOpportunityAllowsUpdate(true, true, opportunityStatus))

pure def lawMissingBoundOpportunityCannotDisplay(opportunityStatus: str): bool =
  not(inboxOpportunityAllowsUpdate(true, false, opportunityStatus))
```

### Only a live update token of this member can resolve items

An update token is a reference to the inbox. The caller still needs their own authenticated identity, and a token expires at its expiry time. Load only the caller's live items from the token, restricted to the caller's app when the surface is app-scoped. Record first redemption and delivery action only after finding one of those items. A token exclusively for another app does not change the token or delivery. For a surface that lists its own updates, return subject IDs for these items and let that surface acknowledge what it displayed separately.

```quint
pure def mayRedeemInboxToken(sameOwner: bool, expiresAt: int, at: int): bool =
  sameOwner and not(expiresAt <= at)

pure def lawInboxTokenExpiresAtDeadline(expiresAt: int): bool =
  not(mayRedeemInboxToken(true, expiresAt, expiresAt))

pure def inboxTokenMayRecordRedemption(matchingLiveItems: int): bool = matchingLiveItems > 0

pure def lawNoMatchingAppItemsMeansNoRedemption(matchingLiveItems: int): bool =
  matchingLiveItems <= 0 implies not(inboxTokenMayRecordRedemption(matchingLiveItems))
```

### A read marks the selected items seen before responding

Touch the surface before the read. After selecting the update items, record those IDs as seen before returning them. An unusable token ends a token-limited read without marking anything. A separate acknowledgement of displayed subjects marks only current unseen items with those subjects and can skip the write when nothing matches.

```quint
type AcknowledgementPhase =
  AcknowledgementStarting | AwaitingReadToken | MarkingInboxSeen | InboxSeen | NoInboxRead |
  DeliveryUnchanged | DeliveryActed
type AcknowledgementFlow = { phase: AcknowledgementPhase }
pure val initial: AcknowledgementFlow = { phase: AcknowledgementStarting }

pure def canSelectInboxRead(flow: AcknowledgementFlow): bool = flow.phase == AcknowledgementStarting
pure def selectInboxRead(flow: AcknowledgementFlow, withToken: bool): AcknowledgementFlow =
  { phase: if (withToken) AwaitingReadToken else MarkingInboxSeen }

pure def canResolveInboxReadToken(flow: AcknowledgementFlow): bool = flow.phase == AwaitingReadToken
pure def resolveInboxReadToken(flow: AcknowledgementFlow, valid: bool): AcknowledgementFlow =
  { phase: if (valid) MarkingInboxSeen else NoInboxRead }

pure def canSelectShownSubjects(flow: AcknowledgementFlow): bool = flow.phase == AcknowledgementStarting
pure def selectShownSubjects(flow: AcknowledgementFlow, hasVisibleItems: bool): AcknowledgementFlow =
  { phase: if (hasVisibleItems) MarkingInboxSeen else NoInboxRead }

pure def canRecordInboxSeen(flow: AcknowledgementFlow): bool = flow.phase == MarkingInboxSeen
pure def recordInboxSeen(flow: AcknowledgementFlow): AcknowledgementFlow = { phase: InboxSeen }

pure def stepInboxResponseFollowsSeenWrite(before: AcknowledgementFlow, via: str, after: AcknowledgementFlow): bool =
  after.phase == InboxSeen implies (before.phase == MarkingInboxSeen and via == "recordInboxSeen")

pure def sometimesMarksInboxSeen(flow: AcknowledgementFlow): bool = flow.phase == InboxSeen
pure def sometimesLeavesInboxUnchanged(flow: AcknowledgementFlow): bool = flow.phase == NoInboxRead
```

### Count a delivery action only when the store closes a pending delivery

For token use, the shell looks for a delivery among the token's stored items. For a reply in the thread, it checks the member's pending deliveries. Record the acted outcome on the surface only for a successful change from a pending delivery.

```quint
pure def canReadDeliveryClosure(flow: AcknowledgementFlow): bool = flow.phase == AcknowledgementStarting
pure def readDeliveryClosure(flow: AcknowledgementFlow, deliveryClosed: bool): AcknowledgementFlow =
  { phase: if (deliveryClosed) DeliveryActed else DeliveryUnchanged }

pure def sometimesRecordsDeliveryAction(flow: AcknowledgementFlow): bool = flow.phase == DeliveryActed
```
