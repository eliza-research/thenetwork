# Book and close a reviewed three-person hike

[Story F12](product/stories.md#story-f12--join-a-small-group) requires review, anonymous invitations and quorum. [Story F18](product/stories.md#story-f18--keep-a-meeting-on-track) requires the booked group to close gracefully when its minimum attendance fails. This journey follows a public day hike with three adult invitees who shared a Saturday afternoon window. There are no eligible alternates or smaller hike in the fixture.

## Story: Join a reviewed public hike only after the group agrees

> As a participant, I want to see a confirmed hike only when the three invited members have each agreed, and I want a private update if the booked hike falls through.

### Review comes before anonymous contact

The proposal starts in staff review. Only an approval opens the three invitations. A rejection closes the proposal without contacting any participant. The invitations use the public venue and the shared window without identifying other participants.

```quint
import planDecision as Plan from "./planDecision"
import opportunityLifecycle as Opportunity from "./opportunityLifecycle"

type Hiker = FirstHiker | SecondHiker | ThirdHiker
type GroupPhase = AwaitingGroupReview | GroupInvited | ReviewDenied | GroupUnderfilled | HikeBooked | HikeCancelled
type GroupEffect = AnonymousInvite | GroupReveal | PrivateCancellation
type ReviewedGroupJourney = { phase: GroupPhase, accepted: List[Hiker], declined: List[Hiker], invites: int, meetings: int, reveals: int, cancellations: int }
type GroupStep = { state: ReviewedGroupJourney, out: List[GroupEffect] }

pure val hikers = List(FirstHiker, SecondHiker, ThirdHiker)
pure val initial: ReviewedGroupJourney =
  { phase: AwaitingGroupReview, accepted: List(), declined: List(), invites: 0, meetings: 0, reveals: 0, cancellations: 0 }

pure def canReviewGroup(s: ReviewedGroupJourney, approved: bool): bool = s.phase == AwaitingGroupReview
pure def reviewGroup(s: ReviewedGroupJourney, approved: bool): GroupStep =
  if (approved)
    { state: { ...s, phase: GroupInvited, invites: 3 }, out: List(AnonymousInvite, AnonymousInvite, AnonymousInvite) }
  else { state: { ...s, phase: ReviewDenied }, out: List() }

pure def alwaysNoContactWithoutApproval(s: ReviewedGroupJourney): bool =
  (s.phase == AwaitingGroupReview or s.phase == ReviewDenied) implies
    (s.invites == 0 and s.meetings == 0 and s.reveals == 0 and s.cancellations == 0)
pure def sometimesRejectedWithoutContact(s: ReviewedGroupJourney): bool = s.phase == ReviewDenied
```

### Booking requires an independent yes from all three invitees

Each invitee responds to their own invitation. A yes below quorum sends no reveal. A third yes books one meeting, with one reveal to each consenting participant. A decline cannot count towards quorum. With no alternates, the last reply closes the plan when it leaves the acceptances below quorum, whether that reply accepts or declines ([planDecision](planDecision.md), "An unanswered plan closes when its deadline passes"). An underfilled plan that stays open closes when the probe deadline passes. The deadline does not record a decline: an invitee who did not reply stays without an answer.

```quint
pure def groupReplyPending(s: ReviewedGroupJourney, hiker: Hiker): bool =
  not(s.accepted.includes(hiker) or s.declined.includes(hiker))

pure def canAnswerGroup(s: ReviewedGroupJourney, hiker: Hiker, agrees: bool): bool =
  s.phase == GroupInvited and groupReplyPending(s, hiker)

pure def answerGroup(s: ReviewedGroupJourney, hiker: Hiker, agrees: bool): GroupStep =
  val yes = hikers.select(person => s.accepted.includes(person) or (agrees and person == hiker))
  val no = hikers.select(person => s.declined.includes(person) or (not(agrees) and person == hiker))
  val answered = { ...s, accepted: yes, declined: no }
  val choice = Plan::planReplyChoice({ phase: Plan::Probing, pendingMember: groupReplyPending(s, hiker), accepted: agrees,
    yesAfter: yes.length(), needed: 3, partnerPlan: false, firstMember: false, beforeDeadline: true, lateJoinOpen: true })
  if (choice == Plan::BookPlan)
    { state: { ...answered, phase: HikeBooked, meetings: 1, reveals: 3 }, out: List(GroupReveal, GroupReveal, GroupReveal) }
  else if (Plan::unmetPlanQuorum(3 - yes.length() - no.length(), yes.length(), 3))
    { state: { ...answered, phase: GroupUnderfilled }, out: List() }
  else { state: answered, out: List() }

pure def canExpireGroup(s: ReviewedGroupJourney): bool = s.phase == GroupInvited
pure def expireGroup(s: ReviewedGroupJourney): GroupStep =
  { state: { ...s, phase: GroupUnderfilled }, out: List() }

pure def alwaysRevealsBelongToOneBooking(s: ReviewedGroupJourney): bool =
  s.meetings == (if (s.phase == HikeBooked or s.phase == HikeCancelled) 1 else 0) and s.reveals == 3 * s.meetings
pure def alwaysBookingRequiresQuorum(s: ReviewedGroupJourney): bool =
  s.phase == HikeBooked implies s.accepted.length() == 3
pure def sometimesThreeHikersBook(s: ReviewedGroupJourney): bool = s.phase == HikeBooked
pure def sometimesUnderfilledCloses(s: ReviewedGroupJourney): bool = s.phase == GroupUnderfilled
```

### A withdrawal below minimum closes a booked group privately

A participant can withdraw by replying to the booking. A group with only two remaining participants cannot continue. Each of the other two receives one cancellation without being told who withdrew or why. The original booking remains in the history. A restart preserves the review, responses, booking and closure.

```quint
pure def canWithdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): bool =
  s.phase == HikeBooked and s.accepted.includes(hiker)
pure def withdrawFromGroup(s: ReviewedGroupJourney, hiker: Hiker): GroupStep =
  val remaining = s.accepted.select(person => person != hiker)
  if (Opportunity::groupCanContinue(remaining.length())) { state: { ...s, accepted: remaining }, out: List() }
  else
    { state: { ...s, phase: HikeCancelled, accepted: remaining, declined: List(hiker), cancellations: 2 },
      out: List(PrivateCancellation, PrivateCancellation) }

pure def canRestartGroup(s: ReviewedGroupJourney): bool = true
pure def restartGroup(s: ReviewedGroupJourney): GroupStep = { state: s, out: List() }

pure def alwaysCancellationFollowsBooking(s: ReviewedGroupJourney): bool =
  s.cancellations == (if (s.phase == HikeCancelled) 2 else 0)
pure def sometimesBookedGroupCancels(s: ReviewedGroupJourney): bool = s.phase == HikeCancelled
```
