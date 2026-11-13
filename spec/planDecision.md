# Plan decisions

This library takes the decision steps from the [plan flow model](models/plan_run.md). The engine keeps the plan, computes time and eligibility, and applies the chosen action to the participants and the alternate list.

## Story: Confirm a plan after enough members accept

> As a member, I want Eliza to confirm a plan only when enough of its invited members accept. I want it to stop asking once the plan closes.

### Only a pending member can change an open plan

An acceptance during probing books at quorum. A partner plan below quorum asks the next eligible partner before the deadline. After booking, acceptances can add a member up to and including the late-join cutoff. A late acceptance after that cutoff does not add a member. A decline after booking does not close the plan. The first member's decline in a partner plan closes it. Other declines can use eligible alternates before the deadline.

```quint
type PlanStage = Probing | Booked | Closed
type ReplyChoice = IgnoreReply | AddMember | RecordLate | BookPlan | AskPartner | RecordAnswer | ClosePlan | AskAlternate
type ReplyFacts = {
  phase: PlanStage, pendingMember: bool, accepted: bool, yesAfter: int,
  needed: int, partnerPlan: bool, firstMember: bool, beforeDeadline: bool, lateJoinOpen: bool
}

pure def canApplyPlanReply(phase: PlanStage, pendingMember: bool): bool =
  phase != Closed and pendingMember

pure def planReplyChoice(reply: ReplyFacts): ReplyChoice =
  if (not(canApplyPlanReply(reply.phase, reply.pendingMember))) IgnoreReply
  else if (reply.accepted) {
    if (reply.phase == Booked) {
      if (reply.lateJoinOpen) AddMember else RecordLate
    } else if (reply.yesAfter >= reply.needed) BookPlan
    else if (reply.partnerPlan and reply.beforeDeadline) AskPartner
    else RecordAnswer
  } else if (reply.phase == Booked) RecordAnswer
  else if (reply.partnerPlan and reply.firstMember) ClosePlan
  else if (reply.beforeDeadline) AskAlternate
  else RecordAnswer
```

### Booking requires a pending acceptance that meets quorum

Only an accepting response from a member whose answer is pending can book a plan. The run must still be probing, and the new answer must bring the acceptance count to quorum.

```quint
pure def lawBookingNeedsQuorum(phase: PlanStage, pendingMember: bool, accepted: bool, yesAfter: int, needed: int,
    partnerPlan: bool, firstMember: bool, beforeDeadline: bool, lateJoinOpen: bool): bool =
  val facts = { phase: phase, pendingMember: pendingMember, accepted: accepted, yesAfter: yesAfter, needed: needed,
    partnerPlan: partnerPlan, firstMember: firstMember, beforeDeadline: beforeDeadline, lateJoinOpen: lateJoinOpen }
  planReplyChoice(facts) == BookPlan implies
    (phase == Probing and pendingMember and accepted and yesAfter >= needed)
```

### An unanswered plan closes when its deadline passes

When the deadline arrives, an unbooked plan closes. If a decline leaves no one pending and quorum is still unmet after the engine checks available alternates, the plan can also close before the deadline.

```quint
pure def planProbeExpired(phase: PlanStage, deadlineReached: bool): bool =
  phase == Probing and deadlineReached

pure def unmetPlanQuorum(pendingCount: int, yesCount: int, needed: int): bool =
  pendingCount == 0 and yesCount < needed

pure def lawOnlyProbingPlansExpire(phase: PlanStage): bool =
  planProbeExpired(phase, true) implies phase == Probing
```

## Story: Choose a fallback for a plan that cannot proceed

> As a member, I want a smaller group when the activity and lead time allow one. I want a new invitation before a group becomes a one-to-one meeting.

### Two acceptances for a group require new partner consent

When a smaller meeting is enabled, the activity permits two people, and enough time remains, three or more accepting members can form a smaller group. Exactly two accepting members start a fresh partner plan. Otherwise the engine can look for a suitable solo event or carry the request forward.

```quint
type FallbackShape = SmallerGroup | FreshPartnerPlan | OtherFallback

pure def planFallbackShape(yesCount: int, smallerOn: bool, minGroup: int, leadOk: bool): FallbackShape =
  if (smallerOn and yesCount >= 2 and minGroup <= 2 and leadOk) {
    if (yesCount == 2) FreshPartnerPlan else SmallerGroup
  } else OtherFallback

pure def lawDirectFallbackRequiresGroup(yesCount: int, smallerOn: bool, minGroup: int, leadOk: bool): bool =
  planFallbackShape(yesCount, smallerOn, minGroup, leadOk) == SmallerGroup implies yesCount >= 3
```
