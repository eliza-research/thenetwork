# Plan decisions

This library takes the decision steps from the [plan flow model](models/plan_run.md). The engine keeps the plan, computes time and eligibility, and applies the chosen action to the participants and the alternate list.

## Story: Confirm a plan after enough members accept

> As a member, I want Eliza to confirm a plan only when enough of its invited members accept. I want it to stop asking once the plan closes.

### Only a pending member can change an open plan

An acceptance during probing books at quorum if it arrives before the deadline. A reply at or after the deadline closes the probe without changing the member's answer. A partner plan below quorum asks the next eligible partner before the deadline. After booking, acceptances can add a member up to and including the late-join cutoff. A late acceptance after that cutoff does not add a member. A decline after booking does not close the plan. The first member's decline in a partner plan closes it. Other declines can use eligible alternates before the deadline.

```quint
type PlanStage = Probing | Booked | Closed
type ReplyChoice = IgnoreReply | ExpireProbe | AddMember | RecordLate | BookPlan | AskPartner | RecordAnswer | ClosePlan | AskAlternate
type ReplyFacts = {
  phase: PlanStage, pendingMember: bool, accepted: bool, yesAfter: int,
  needed: int, partnerPlan: bool, firstMember: bool, beforeDeadline: bool, lateJoinOpen: bool
}

pure def canApplyPlanReply(phase: PlanStage, pendingMember: bool): bool =
  phase != Closed and pendingMember

pure def planProbeExpired(phase: PlanStage, deadlineReached: bool): bool =
  phase == Probing and deadlineReached

pure def planReplyChoice(reply: ReplyFacts): ReplyChoice =
  if (not(canApplyPlanReply(reply.phase, reply.pendingMember))) IgnoreReply
  else if (planProbeExpired(reply.phase, not(reply.beforeDeadline))) ExpireProbe
  else if (reply.accepted) {
    if (reply.phase == Booked) {
      if (reply.lateJoinOpen) AddMember else RecordLate
    } else if (reply.yesAfter >= reply.needed) BookPlan
    else if (reply.partnerPlan) AskPartner
    else RecordAnswer
  } else if (reply.phase == Booked) RecordAnswer
  else if (reply.partnerPlan and reply.firstMember) ClosePlan
  else AskAlternate
```

### Booking requires a pending acceptance that meets quorum

Only an accepting response from a member whose answer is pending can book a plan. It must arrive before the probe deadline and bring the acceptance count to quorum.

```quint
pure def lawBookingNeedsQuorum(phase: PlanStage, pendingMember: bool, accepted: bool, yesAfter: int, needed: int,
    partnerPlan: bool, firstMember: bool, beforeDeadline: bool, lateJoinOpen: bool): bool =
  val facts = { phase: phase, pendingMember: pendingMember, accepted: accepted, yesAfter: yesAfter, needed: needed,
    partnerPlan: partnerPlan, firstMember: firstMember, beforeDeadline: beforeDeadline, lateJoinOpen: lateJoinOpen }
  planReplyChoice(facts) == BookPlan implies
    (phase == Probing and pendingMember and accepted and beforeDeadline and yesAfter >= needed)
```

### An unanswered plan closes when its deadline passes

When the deadline arrives, an unbooked plan closes. A reply before that deadline also closes a plan when it leaves no one pending and quorum is still unmet after the engine checks available alternates.

```quint
pure def unmetPlanQuorum(pendingCount: int, yesCount: int, needed: int): bool =
  pendingCount == 0 and yesCount < needed

pure def lawOnlyProbingPlansExpire(phase: PlanStage): bool =
  planProbeExpired(phase, true) implies phase == Probing

pure def lawReplyAtDeadlineClosesProbe(accepted: bool, yesAfter: int, needed: int, partnerPlan: bool, firstMember: bool): bool =
  planReplyChoice({ phase: Probing, pendingMember: true, accepted: accepted, yesAfter: yesAfter, needed: needed,
    partnerPlan: partnerPlan, firstMember: firstMember, beforeDeadline: false, lateJoinOpen: false }) == ExpireProbe
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

### A group plan never books two members directly

The engine counts the accepting members it can still seat after it removes booking conflicts and contact refusals. A partner plan books when that count reaches its quorum. A group plan books only with three or more seated members, and only when the count reaches quorum or the activity permits two people. When a group plan keeps exactly two seated members, the engine uses the fallback for those two members. That fallback asks them again through a fresh partner plan, which needs new review and consent from both.

```quint
pure def planBookingConsented(partnerPlan: bool, seatedCount: int, needed: int, minGroup: int): bool =
  if (partnerPlan) seatedCount >= needed
  else seatedCount >= 3 and (seatedCount >= needed or minGroup <= 2)

pure def lawGroupBookingNeedsThreeMembers(seatedCount: int, needed: int, minGroup: int): bool =
  planBookingConsented(false, seatedCount, needed, minGroup) implies seatedCount >= 3

pure def lawPartnerBookingNeedsQuorum(seatedCount: int, needed: int, minGroup: int): bool =
  planBookingConsented(true, seatedCount, needed, minGroup) implies seatedCount >= needed
```

## Story: Keep plan invites on a separate allowance

> As a member who has told Eliza when I am free, I want group-plan invitations to use their own allowance.

### The separate plan allowance requires availability evidence or weekly check-in consent

An active stated window, a standing window, an accepted or attended time at or before the current time, or consent to the weekly check-in qualifies. A declined time does not count as evidence. The engine checks allowance and delivery limits separately.

```quint
pure def qualifiesForPlanAllowance(checkInOptIn: bool, activeStated: bool, standingWindow: bool, learnedTime: bool): bool =
  checkInOptIn or activeStated or standingWindow or learnedTime
```

## Story: Turn a good plan into a recurring crew

> As someone who enjoyed a plan, I want to opt in to meeting the group again and share hosting with the group.

### A crew offer needs enough positive responses

The configured minimum number of attendees must say they would do it again. Under the one-plan setting, one successful plan is enough. A stated wish for a recurring plan can also seed an offer from one plan. When the setting requires two plans, the engine also checks for enough of the same members to have responded positively to another plan for the same activity.

```quint
pure def hasCrewQuorum(memberCount: int, minimum: int): bool =
  memberCount >= minimum

pure def singlePlanSeedsCrew(positiveCount: int, minimum: int, minPlans: int, recurringWant: bool): bool =
  hasCrewQuorum(positiveCount, minimum) and (minPlans <= 1 or recurringWant)
```

### Only accepting members join the recurring crew

The crew forms only when the accepting members meet the configured minimum. Keep their original order. Use the preferred hosts who accepted. If none accepted, rotate among all accepting members.

```quint
pure def crewBelowMinimum(memberCount: int, minimum: int): bool =
  memberCount < minimum

pure def crewMembersWhoOptedIn(invitedMembers: List[str], optIns: List[str]): List[str] =
  invitedMembers.select(memberId => optIns.includes(memberId))

pure def crewHostOrder(members: List[str], preferredHosts: List[str]): List[str] =
  val hosts = crewMembersWhoOptedIn(preferredHosts, members)
  if (hosts.length() > 0) hosts else members
```
