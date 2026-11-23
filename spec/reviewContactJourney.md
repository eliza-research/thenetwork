# Recorded approval before first contact

A member on friends.help asks to find a climbing partner. The request queues an opportunity for review. The review judge reads it first; staff decide only an opportunity that the judge holds ([automated review](automatedReview.md)). The [opportunity lifecycle](opportunityLifecycle.md) and the [review deadline](reviewDeadline.md) govern the first contact. The fixture has two eligible adults and keeps their local send window open while the judge or the staff member acts. Changed (owner decision 2026-11-22, D15 to D17): a human reviewer approved every introduction; now the review judge approves it, and a held item needs a named staff member.

## Story: Ask about an introduction only after a recorded approval

> As a member, I want the review judge, or a named staff member for an item that the judge held, to approve an introduction before the Network contacts anyone about the proposal.

### A pending proposal sends no probe

The proposal starts waiting for the review judge, with no approval and no contact about the opportunity. A service tick while review is pending does not change that. Changed (owner decision 2026-11-22, D15 to D17): the proposal waited for a human reviewer; now it waits for the judge.

```quint
import opportunityLifecycle as Opportunity from "./opportunityLifecycle"
import reviewDeadline as Deadline from "./reviewDeadline"

type ContactReview = AwaitingJudge | JudgeApproved | HeldForStaff | StaffApproved | ReviewerRejected | ReviewExpired | HeldExpired
type ReviewReply = DecisionAccepted | DeadlinePassed | NoLongerPending | NotHeldForStaff
type ReviewContactJourney = { review: ContactReview, probeCount: int }
type ReviewContactStep = { state: ReviewContactJourney, out: List[ReviewReply] }

pure val initial: ReviewContactJourney = { review: AwaitingJudge, probeCount: 0 }

pure def canRunServiceTick(s: ReviewContactJourney): bool = true
pure def runServiceTick(s: ReviewContactJourney): ReviewContactStep = { state: s, out: List() }
```

### A timely judge approval permits one anonymous probe to the requester

The service records the judge's approval before it starts the probe. The requester gets the first probe in this journey. Any other judgment holds the item for staff and sends nothing. A judgment at or after the deadline closes the opportunity as expired. A judgment after the review left the judge changes nothing. This fixture supplies no reply from the requester. Changed (owner decision 2026-11-22, D15 to D17): a human reviewer's approval started the probe; now the judge's approval does, and every other judgment holds the item for staff (D17).

```quint
pure def canRecordJudgment(s: ReviewContactJourney, approve: bool, atDeadline: bool): bool = true
pure def recordJudgment(s: ReviewContactJourney, approve: bool, atDeadline: bool): ReviewContactStep =
  if (s.review != AwaitingJudge) { state: s, out: List(NoLongerPending) }
  else if (Deadline::reviewLate(if (atDeadline) 1 else 0, 1))
    { state: { ...s, review: ReviewExpired }, out: List(DeadlinePassed) }
  else if (Opportunity::canStartProbing(Opportunity::initial, approve, true))
    { state: { review: JudgeApproved, probeCount: 1 }, out: List(DecisionAccepted) }
  else { state: { ...s, review: HeldForStaff }, out: List(DecisionAccepted) }

pure def alwaysContactRequiresReview(s: ReviewContactJourney): bool =
  s.probeCount == (if (s.review == JudgeApproved or s.review == StaffApproved) 1 else 0)

pure def sometimesFirstProbeIsSent(s: ReviewContactJourney): bool = s.probeCount == 1
```

### Staff approve only an item that the judge held

A named staff member approves a held item before its deadline, and the approval starts the first probe to the requester. A staff member may reject an open item, held or waiting for the judge, and the rejection closes the opportunity unsent. A staff approval of an item that waits for the judge is refused as not held for staff and changes nothing. A decision at the deadline closes an open opportunity as expired. A decision after the review closed changes nothing. Changed (owner decision 2026-11-22, D15 to D17): staff approved every item; now staff approve only the exceptions that the judge holds, and an approval before the judge read the item is refused.

```quint
pure def canStaffDecideHeld(s: ReviewContactJourney, approve: bool, atDeadline: bool): bool = true
pure def staffDecideHeld(s: ReviewContactJourney, approve: bool, atDeadline: bool): ReviewContactStep =
  if (s.review != HeldForStaff and s.review != AwaitingJudge) { state: s, out: List(NoLongerPending) }
  else if (Deadline::reviewLate(if (atDeadline) 1 else 0, 1))
    { state: { ...s, review: if (s.review == HeldForStaff) HeldExpired else ReviewExpired }, out: List(DeadlinePassed) }
  else if (s.review == AwaitingJudge and approve) { state: s, out: List(NotHeldForStaff) }
  else if (Opportunity::canStartProbing(Opportunity::initial, approve, true))
    { state: { review: StaffApproved, probeCount: 1 }, out: List(DecisionAccepted) }
  else { state: { ...s, review: ReviewerRejected }, out: List(DecisionAccepted) }

pure def sometimesStaffApprovesHeldItem(s: ReviewContactJourney): bool = s.review == StaffApproved
```

### Rejected and expired items stay unsent

A timely rejection closes the opportunity. At the review deadline a late judgment or decision closes the opportunity as expired, even before the next service tick. A held item that nobody decides also expires unsent at its deadline, and the record keeps that the judge held it. A tick after either result leaves it closed and unsent. Changed (owner decision 2026-11-22, D17): a held item expires unsent at its deadline like any other open review. The separate state for a held item that expired is new in this revision, so that the journey shows the D17 case and not only an expiry of an item that waited for the judge.

```quint
pure def stepClosedReviewStaysClosed(before: ReviewContactJourney, after: ReviewContactJourney): bool =
  (before.review != AwaitingJudge and before.review != HeldForStaff) implies after == before

pure def sometimesReviewerRejects(s: ReviewContactJourney): bool = s.review == ReviewerRejected
pure def sometimesReviewExpires(s: ReviewContactJourney): bool = s.review == ReviewExpired
pure def sometimesHeldItemExpires(s: ReviewContactJourney): bool = s.review == HeldExpired
```
