# Consent to a reviewed home-help plan

[Story F14](product/stories.md#story-f14--ask-for-bounded-help) requires a
current [staff-approved home-help plan](boundedHelp.md) and explicit consent
from the requester and every reviewed helper.

## Story: Decide privately about the exact reviewed plan

> As a participant, I want to accept or refuse the reviewed scope in private.

### Only the current approved roster can receive a notice

Create one stable notice per participant after staff approves that exact
revision and the roster still passes eligibility checks. The notice shows
the bounded task, coarse area, time, effort, and response deadline. The
requester's explicit acceptance unlocks the helper notices. A notice has no
street address or other participants' identities.

```quint
type HomeHelpConsentPhase = Unstaged | Pending | Sent | Accepted | Declined | Withdrawn | Cancelled
type HomeHelpRecipientConsent = { phase: HomeHelpConsentPhase }

pure val initial: HomeHelpRecipientConsent = { phase: Unstaged }

pure def canStageNotice(c: HomeHelpRecipientConsent, reviewedNow: bool): bool =
  c.phase == Unstaged and reviewedNow

pure def stageNotice(c: HomeHelpRecipientConsent, reviewedNow: bool): HomeHelpRecipientConsent =
  if (canStageNotice(c, reviewedNow)) { phase: Pending } else c

pure def homeHelpConsentStopped(phase: HomeHelpConsentPhase): bool =
  phase == Declined or phase == Withdrawn or phase == Cancelled

pure def homeHelpNoticeAllowed(phase: HomeHelpConsentPhase, reviewedNow: bool, exactRoster: bool,
  consentStopped: bool, requesterNotice: bool, requesterAccepted: bool): bool =
  phase == Pending and reviewedNow and exactRoster and not(consentStopped) and (requesterNotice or requesterAccepted)

pure def lawHelperNoticeRequiresRequester(phase: HomeHelpConsentPhase, reviewedNow: bool, exactRoster: bool, consentStopped: bool): bool =
  not(homeHelpNoticeAllowed(phase, reviewedNow, exactRoster, consentStopped, false, false))

pure def sometimesNoticePending(c: HomeHelpRecipientConsent): bool = c.phase == Pending
```

### A response belongs to the recipient of a delivered notice

Only the authoritative positive receipt for this notice and recipient
records delivery. Require a current signed command from that recipient to
record an explicit accept or decline. The command must arrive at or after
the authenticated delivery time. A submission, queued notice, timeout,
ambiguous reply, and another member's response supply no acceptance.

```quint
pure def canRecordNoticeSent(c: HomeHelpRecipientConsent, deliveryAllowed: bool, exactReceipt: bool): bool =
  c.phase == Pending and deliveryAllowed and exactReceipt

pure def recordNoticeSent(c: HomeHelpRecipientConsent, deliveryAllowed: bool, exactReceipt: bool): HomeHelpRecipientConsent =
  if (canRecordNoticeSent(c, deliveryAllowed, exactReceipt)) { phase: Sent } else c

pure def canChooseHomeHelp(c: HomeHelpRecipientConsent, responseAllowed: bool, exactActor: bool): bool =
  c.phase == Sent and responseAllowed and exactActor

pure def homeHelpResponseAfterDelivery(sentAt: int, receivedAt: int, now: int): bool =
  sentAt >= 0 and sentAt <= receivedAt and receivedAt <= now

pure def lawPrematureHomeHelpResponseRefused(sentAt: int, receivedAt: int, now: int): bool =
  receivedAt < sentAt implies not(homeHelpResponseAfterDelivery(sentAt, receivedAt, now))

pure def chooseHomeHelp(c: HomeHelpRecipientConsent, responseAllowed: bool, exactActor: bool, wantsHelp: bool): HomeHelpRecipientConsent =
  if (canChooseHomeHelp(c, responseAllowed, exactActor))
    (if (wantsHelp) { phase: Accepted } else { phase: Declined })
  else c

pure def stepAcceptanceFollowsDelivery(before: HomeHelpRecipientConsent, after: HomeHelpRecipientConsent): bool =
  after.phase == Accepted implies (before.phase == Sent or before.phase == Accepted)

pure def sometimesAccepted(c: HomeHelpRecipientConsent): bool = c.phase == Accepted
pure def sometimesDeclined(c: HomeHelpRecipientConsent): bool = c.phase == Declined
```

### Any withdrawal or invalidation stops the reviewed consent

A recipient may withdraw their acceptance. A decline, withdrawal, or
invalidation stops all pending contact and acceptance under that revision.
Recheck current age, STOP, membership, hold, block, offer, and approval before
returning consent for any later action. Invalidate a staged consent cycle
when one of those checks fails. An expired, closed, or revised plan cannot
reuse its notices or responses. Erasure removes the corresponding rows.

```quint
pure def canWithdrawHomeHelp(c: HomeHelpRecipientConsent, exactActor: bool): bool = c.phase == Accepted and exactActor

pure def withdrawHomeHelp(c: HomeHelpRecipientConsent, exactActor: bool): HomeHelpRecipientConsent =
  if (canWithdrawHomeHelp(c, exactActor)) { phase: Withdrawn } else c

pure def canInvalidateHomeHelp(c: HomeHelpRecipientConsent, planInvalidated: bool): bool =
  planInvalidated and (c.phase == Pending or c.phase == Sent or c.phase == Accepted)

pure def invalidateHomeHelp(c: HomeHelpRecipientConsent, planInvalidated: bool): HomeHelpRecipientConsent =
  if (canInvalidateHomeHelp(c, planInvalidated)) { phase: Cancelled } else c

pure def stepStoppedConsentStaysStopped(before: HomeHelpRecipientConsent, after: HomeHelpRecipientConsent): bool =
  homeHelpConsentStopped(before.phase) implies before.phase == after.phase

pure def sometimesConsentWithdrawn(c: HomeHelpRecipientConsent): bool = c.phase == Withdrawn
pure def sometimesConsentCancelled(c: HomeHelpRecipientConsent): bool = c.phase == Cancelled
```

### The requester and every member of the exact roster must accept

Count only the recorded acceptances for the requester and every current
reviewed helper. A missing row, a changed roster, or current ineligibility
withholds consent. Return no information about other participants' replies to
a requester or helper.

```quint
pure def homeHelpConsentComplete(reviewedNow: bool, exactRoster: bool, expected: int, accepted: int): bool =
  reviewedNow and exactRoster and expected >= 2 and expected <= 4 and accepted == expected

pure def lawMissingAcceptanceWithholdsConsent(reviewedNow: bool, exactRoster: bool, expected: int, accepted: int): bool =
  accepted < expected implies not(homeHelpConsentComplete(reviewedNow, exactRoster, expected, accepted))

pure def lawStaleRevisionWithholdsConsent(exactRoster: bool, expected: int, accepted: int): bool =
  not(homeHelpConsentComplete(false, exactRoster, expected, accepted))
```
