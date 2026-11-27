# Read and acknowledge inbox updates

The caller enters with the member identity established by the authenticated app or the thread. The scheduler keeps the member's surface activity, inbox rows, token records, and delivery outcomes in the notify store. The store owns first writes and commits each delivery outcome with its surface count. The scheduler uses the read and token results to decide what to expose.

## Story: See my own updates on the surface I am using

> As a member, I want to read my updates on the current surface and have those updates marked seen across my inbox.

### A scoped surface shows only items from its app

The shell reads the member's unseen, unexpired inbox and filters it to the requested app if there is one. An update token limits that result to the token's items. A valid token with no matching items returns an empty result.

```quint
pure def appAllowsInboxItem(scoped: bool, sameApp: bool): bool = not(scoped) or sameApp

pure def lawScopedReadRequiresAppMatch(sameApp: bool): bool =
  appAllowsInboxItem(true, sameApp) implies sameApp
```

### A signed Updates reply reads a bounded page in the member's current text thread

The whole word `updates`, with optional outer space and any letter case, is a direct command on the signed phone text thread. The shared line may read current updates for the phone owner's active app memberships. A dedicated line reads only its app. A sender needs the current active membership for each item and does not join, consent or resume by reading. Group turns and assistant profile submissions do not run this command. A reply is one text with up to three summaries. A provider-accepted digest whose exact text and recipient still match its receipt has already shown its preview summaries on this thread. Keep those summaries available on other surfaces and offer the rest in the thread. The text can ask the person to reply `updates` again when more are available. Mark these summaries seen in the same durable turn that records the reply. A replay never reads a new page and cannot expose a stored summary after its owner, active app membership or current update changes.

```quint
pure val threadUpdateCommand = "updates"
pure val threadUpdatePageSize = 3

pure def mayShowThreadUpdate(sharedLine: bool, sameRoutedApp: bool, activeAppOwner: bool): bool =
  activeAppOwner and appAllowsInboxItem(not(sharedLine), sameRoutedApp)

pure def lawDedicatedThreadCannotShowAnotherApp(sameRoutedApp: bool, activeAppOwner: bool): bool =
  mayShowThreadUpdate(false, sameRoutedApp, activeAppOwner) implies sameRoutedApp

pure def lawSharedThreadStillNeedsActiveAppOwner(sameRoutedApp: bool, activeAppOwner: bool): bool =
  mayShowThreadUpdate(true, sameRoutedApp, activeAppOwner) implies activeAppOwner
```

### A delivered text can appear only once and its opportunity must still be current

An accepted member-facing probe, plan probe, proposal, reveal, pre-brief,
venue pivot, check-in, relay, reminder, feedback request, cancellation or
scheduling text can produce an inbox item. System replies do not produce one.
Changed (2026-11-27): reveal, pre-brief, venue pivot, check-in and relay texts
also produce inbox items so a member's connected assistant sees live meetup
updates too. Key a delivered text by its message ID, with the
opportunity as context when there is one. A repeated projection uses the
same durable delivery ID, including for a retained older subject, and skips
an already recorded delivery. The item and its delivery are stored in one
transaction, so the item is never pending for the scheduler without its
delivery. Changed 2026-11-18: they were two transactions (SD-151), and a
failure between them left the text pending, so the scheduler texted it again.
A message that another sender delivered also adds its item and records its
delivery in one transaction (`NotifyStore.addDelivered`).
Each new accepted text about that opportunity
remains a separate item. Resolve an item's opportunity
in the caller's app. Retained subjects that used only the opportunity or
message ID still resolve there. Omit a closed opportunity or a missing
opportunity from an explicitly bound text. Ordinary updates with no
opportunity remain visible. An item summary has at most 500 characters.

```quint
pure val networkTextSummaryLimit: int = 500

pure def networkTextCanProduceInboxItem(system: bool, messageType: str): bool =
  not(system) and (messageType == "probe" or messageType == "plan_probe" or messageType == "proposal"
    or messageType == "reveal" or messageType == "pre_brief" or messageType == "venue_pivot"
    or messageType == "checkin" or messageType == "relay"
    or messageType == "reminder" or messageType == "feedback_request" or messageType == "cancellation"
    or messageType == "scheduling")

type NetworkTextProjection = SkipRecordedText | ProjectOpportunityText | ProjectUnboundText

pure def networkTextProjection(deliveryRecorded: bool, opportunityBound: bool): NetworkTextProjection =
  if (deliveryRecorded) SkipRecordedText
  else if (opportunityBound) ProjectOpportunityText else ProjectUnboundText

pure def lawRecordedTextHasNoNewProjection(opportunityBound: bool): bool =
  networkTextProjection(true, opportunityBound) == SkipRecordedText

pure def lawSystemTextProducesNoInboxItem(messageType: str): bool =
  not(networkTextCanProduceInboxItem(true, messageType))

pure def networkTextDeliveryKey(messageId: str, opportunityId: str): str = messageId

pure def lawRepeatedProjectionKeepsItsKey(messageId: str, firstOpportunity: str, laterOpportunity: str): bool =
  networkTextDeliveryKey(messageId, firstOpportunity) == networkTextDeliveryKey(messageId, laterOpportunity)

pure def lawEachNewTextKeepsItsOwnKey(firstMessage: str, laterMessage: str, opportunityId: str): bool =
  (firstMessage != laterMessage) implies networkTextDeliveryKey(firstMessage, opportunityId) != networkTextDeliveryKey(laterMessage, opportunityId)

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

Touch the surface before the read. After selecting the update items, record those IDs as seen before returning them. The selected items include the stale items that the response omits, so the same read retires them as seen. An unusable token ends a token-limited read without marking anything. A separate acknowledgement of displayed subjects marks only current unseen items with those subjects and can skip the write when nothing matches.

```quint
type AcknowledgementPhase =
  AcknowledgementStarting | AwaitingReadToken | MarkingInboxSeen | InboxSeen | NoInboxRead
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

For token use, the shell looks for a delivery among the token's stored items. For a reply in the thread, it checks the member's pending deliveries. The store closes an acted delivery and counts it on the surface that acted in one mutation. The expiry sweep closes still-pending deliveries sent strictly before the cutoff and counts them on their recorded targets in the same mutation. A failed count write leaves the delivery pending. A repeated action or sweep cannot count a closed delivery again.

```quint
pure def pendingDeliveryMayClose(pending: bool): bool = pending

pure def pendingDeliveryMayExpire(pending: bool, sentAt: int, cutoff: int): bool =
  pendingDeliveryMayClose(pending) and sentAt < cutoff

pure def lawClosedDeliveryCannotCount(sentAt: int, cutoff: int): bool =
  not(pendingDeliveryMayClose(false)) and not(pendingDeliveryMayExpire(false, sentAt, cutoff))

pure def lawDeliveryAtCutoffRemainsPending(pending: bool, cutoff: int): bool =
  not(pendingDeliveryMayExpire(pending, cutoff, cutoff))
```
