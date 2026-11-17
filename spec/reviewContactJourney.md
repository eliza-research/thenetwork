# Human review before first contact

A member on friends.help asks to find a climbing partner. The request queues an opportunity for human review. The [opportunity lifecycle](opportunityLifecycle.md) and the [review deadline](reviewDeadline.md) govern the first contact. The fixture has two eligible adults and keeps their local send window open while the reviewer acts.

## Story: Ask about an introduction only after a person approves

> As a member, I want a human reviewer to approve an introduction before the Network contacts anyone about the proposal.

### A pending proposal sends no probe

The proposal starts in review with no approval and no contact about the opportunity. A service tick while review is pending does not change that.

```quint
import opportunityLifecycle as Opportunity from "./opportunityLifecycle"
import reviewDeadline as Deadline from "./reviewDeadline"

type ContactReview = AwaitingReviewer | ReviewerApproved | ReviewerRejected | ReviewExpired
type ReviewReply = DecisionAccepted | DeadlinePassed | NoLongerPending
type ReviewContactJourney = { review: ContactReview, probeCount: int }
type ReviewContactStep = { state: ReviewContactJourney, out: List[ReviewReply] }

pure val initial: ReviewContactJourney = { review: AwaitingReviewer, probeCount: 0 }

pure def canRunServiceTick(s: ReviewContactJourney): bool = true
pure def runServiceTick(s: ReviewContactJourney): ReviewContactStep = { state: s, out: List() }
```

### Timely approval permits one anonymous probe to the requester

The service records an approval before it starts the probe. The requester gets the first probe in this journey. Repeating a decision after review closes cannot start another probe. This fixture supplies no reply from the requester.

```quint
pure def canDecideProposal(s: ReviewContactJourney, approve: bool, atDeadline: bool): bool = true
pure def decideProposal(s: ReviewContactJourney, approve: bool, atDeadline: bool): ReviewContactStep =
  if (s.review != AwaitingReviewer) { state: s, out: List(NoLongerPending) }
  else if (Deadline::reviewLate(if (atDeadline) 1 else 0, 1))
    { state: { ...s, review: ReviewExpired }, out: List(DeadlinePassed) }
  else if (Opportunity::canStartProbing(Opportunity::initial, approve, true))
    { state: { review: ReviewerApproved, probeCount: 1 }, out: List(DecisionAccepted) }
  else { state: { ...s, review: ReviewerRejected }, out: List(DecisionAccepted) }

pure def alwaysContactRequiresReview(s: ReviewContactJourney): bool =
  s.probeCount == (if (s.review == ReviewerApproved) 1 else 0)

pure def sometimesFirstProbeIsSent(s: ReviewContactJourney): bool = s.probeCount == 1
```

### Rejected and expired items stay unsent

A timely rejection closes the opportunity. At the review deadline a late decision closes the opportunity as expired, even before the next service tick. A tick after either result leaves it closed and unsent.

```quint
pure def stepClosedReviewStaysClosed(before: ReviewContactJourney, after: ReviewContactJourney): bool =
  before.review != AwaitingReviewer implies after == before

pure def sometimesReviewerRejects(s: ReviewContactJourney): bool = s.review == ReviewerRejected
pure def sometimesReviewExpires(s: ReviewContactJourney): bool = s.review == ReviewExpired
```
