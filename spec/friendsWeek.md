# Friends weekly planning

The weekly Friends planner uses this run state to assign reservations. The [crew model](models/plan_crew.md) and [plan model](models/plan_run.md) cover what happens after a proposal leaves the planner. The planner supplies eligible members and finished candidates in its ranked order. It reserves an activity partner only after it finishes that candidate, so an unfinished candidate does not use the partner allowance. It computes availability, venue, travel, timing, and plan copy outside this state.

## Story: Find time with familiar people or meet someone nearby

> As a Friends member, I want the weekly planner to offer recurring meetups first and use remaining opportunities for nearby plans and activity partners.

### A split table still belongs to one invitation in the simulator report

Count each proposal once. The quorum denominator includes proposals actually probed. Credit a proposal with reaching quorum once when its first table reaches quorum, even if other tables fill from its replies. Attendance and held meetup totals count all tables.

```quint
pure def friendCountsProposal(additionalTable: bool): bool = not(additionalTable)

pure def friendCountsProbedProposal(additionalTable: bool, probes: int): bool =
  friendCountsProposal(additionalTable) and probes > 0

pure def lawAdditionalTableCannotCountAsProbed(probes: int): bool =
  not(friendCountsProbedProposal(true, probes))
```

### Crew sessions, offers, repeats, new plans, and partners run in order

Existing crew sessions come first. A crew offer comes before a repeat. New group and single-slot plans come next. The one-to-one activity partner pass has its own allowance and comes last. The planner can skip any disabled or empty pass. A completed week cannot reserve another plan.

```quint
type WeekPhase = CrewSessions | CrewOffers | RepeatPlans | NewPlans | PartnerIntros | WeekComplete
type FriendsRun = {
  phase: WeekPhase, spreadNew: bool,
  recurring: str -> bool, newUsed: str -> bool, newInvited: str -> bool, partnerCounts: str -> int,
}

pure val initial: FriendsRun = {
  phase: CrewSessions, spreadNew: false,
  recurring: Map(), newUsed: Map(), newInvited: Map(), partnerCounts: Map(),
}

pure def canBeginCrewOffers(s: FriendsRun): bool = s.phase == CrewSessions
pure def beginCrewOffers(s: FriendsRun): FriendsRun = { ...s, phase: CrewOffers }

pure def canBeginRepeats(s: FriendsRun): bool = s.phase == CrewOffers
pure def beginRepeats(s: FriendsRun): FriendsRun = { ...s, phase: RepeatPlans }

pure def canBeginNewPlans(s: FriendsRun): bool = s.phase == RepeatPlans
pure def beginNewPlans(s: FriendsRun, spreadNew: bool): FriendsRun = { ...s, phase: NewPlans, spreadNew: spreadNew }

pure def canBeginPartners(s: FriendsRun): bool = s.phase == NewPlans
pure def beginPartners(s: FriendsRun): FriendsRun = { ...s, phase: PartnerIntros }

pure def canFinishWeek(s: FriendsRun): bool = s.phase == PartnerIntros
pure def finishWeek(s: FriendsRun): FriendsRun = { ...s, phase: WeekComplete }

pure def stepCompletedWeekStaysClosed(before: FriendsRun, after: FriendsRun): bool =
  before.phase == WeekComplete implies after.phase == WeekComplete
```

### Recurring plans reserve places for later passes

Existing crew sessions keep their members, including members of multiple formed crews. Crew offers and repeats use only members who have not already been reserved for a recurring plan this week. Crew sessions and offers reserve invitees. A repeat reserves both its invitees and its remaining alternates.

```quint
type RecurringKind = Session | Offer | Repeat

pure def reserveIds(used: str -> bool, members: List[str]): str -> bool =
  members.foldl(used, (seen, memberId) => seen.put(memberId, true))

pure def recurringAvailable(s: FriendsRun, memberId: str): bool = not(s.recurring.keys().contains(memberId))

pure def canReserveRecurring(s: FriendsRun, kind: RecurringKind, members: List[str]): bool =
  (s.phase == CrewSessions and kind == Session) or
    (((s.phase == CrewOffers and kind == Offer) or (s.phase == RepeatPlans and kind == Repeat)) and
      members.every(memberId => recurringAvailable(s, memberId)))

pure def reserveRecurring(s: FriendsRun, kind: RecurringKind, members: List[str]): FriendsRun =
  { ...s, recurring: reserveIds(s.recurring, members) }

pure val membersValues = Set(List("one", "two"), List("two", "three"), List("three", "four"))
```

### A Friends repeat uses its own completed table and a fresh review

Use the exact settled Friends plan and its private replies. A seat needs a timely reply to its own delivered feedback prompt, confirmed attendance in that reply, and an explicit yes to the same activity again. Record the reply's schedule revision. Settlement marks the seat only if it verifies receipt of the booking for that same revision and confirms attendance. A staged booking, an older revision, and older state with no such mark do not authorize a repeat. A reply reporting an absence cannot supply repeat consent. A later decline of that crew offer removes the seat. Defer to a pending crew offer or an existing crew for the table. Use each original plan for at most one new repeat and keep the same group of three to six consenting attendees. Recheck the shared activity, public venue, full window, current availability, and the current fit of every seat before review and again at approval. Rotate the host in stable member order. Every member needs to accept the new plan separately.

```quint
pure def friendsRepeatSourceAllowed(completed: bool, settlementComplete: bool, crewActive: bool, alreadyOffered: bool): bool =
  completed and settlementComplete and not(crewActive or alreadyOffered)

pure def friendsRepeatBookingProofCurrent(replyRevision: int, currentRevision: int, settledBooking: bool): bool =
  replyRevision >= 0 and replyRevision == currentRevision and settledBooking

pure def lawFriendsRepeatNeedsSettledBooking(replyRevision: int, currentRevision: int): bool =
  not(friendsRepeatBookingProofCurrent(replyRevision, currentRevision, false))

pure def friendsRepeatAttendanceAllowed(booked: bool, came: bool, again: bool, noShowReported: bool, crewDeclined: bool): bool =
  booked and came and again and not(noShowReported or crewDeclined)

pure val expectedValues = Set(List("a", "b"), List("a", "b", "c"), List("b", "c", "d"))
pure val offeredValues = expectedValues

pure def friendsRepeatRosterCurrent(expected: List[str], offered: List[str]): bool =
  expected.length() >= 3 and expected.length() <= 6 and expected == offered

pure def lawFriendsRepeatNeedsOriginalRoster(expected: List[str], offered: List[str]): bool =
  friendsRepeatRosterCurrent(expected, offered) implies expected == offered

pure def friendsRepeatHostIndex(previousIndex: int, seats: int): int =
  if (previousIndex < 0 or previousIndex + 1 >= seats) 0 else previousIndex + 1
```

### New plans reserve each invitee once

When the spread policy is on, a new plan leaves places for members without a recurring reservation. Open table construction holds its remaining alternates as well as its invitees for the rest of the new-plan pass. A single-slot plan reserves its invitees and removes alternates already held by the time it is added. At publication, an alternate can remain only if no new plan invited them.

```quint
pure def newPlanUsed(s: FriendsRun, memberId: str): bool = s.newUsed.keys().contains(memberId)

pure def newPlanAvailable(s: FriendsRun, memberId: str): bool =
  not(newPlanUsed(s, memberId)) and (not(s.spreadNew) or recurringAvailable(s, memberId))

pure def newPlanAlternateCanRemain(s: FriendsRun, memberId: str): bool = not(s.newInvited.keys().contains(memberId))

pure def canReserveNewPlan(s: FriendsRun, invited: List[str], alternates: List[str], reserveAlternates: bool): bool =
  s.phase == NewPlans and invited.every(memberId => newPlanAvailable(s, memberId)) and
    (not(reserveAlternates) or alternates.every(memberId => newPlanAvailable(s, memberId)))

pure def reserveNewPlan(s: FriendsRun, invited: List[str], alternates: List[str], reserveAlternates: bool): FriendsRun =
  val used = reserveIds(s.newUsed, invited)
  { ...s, newInvited: reserveIds(s.newInvited, invited), newUsed: if (reserveAlternates) reserveIds(used, alternates) else used }

pure val invitedValues = Set(List("one", "two"), List("two", "three"))
pure val alternatesValues = Set(List(), List("three"), List("one"))

pure def sometimesPublishesAPlan(s: FriendsRun): bool = s.phase == WeekComplete and not(newPlanAlternateCanRemain(s, "one"))
```

### A standby has no initial invitation and holds one bench place

At publication, collect initial invitees from crew sessions, crew offers,
repeats, new plans, and activity partner plans. An open table contacts its
extra candidates with its initial invitees. Keep those invitations. For repeat
benches and closed-table benches, keep a standby only if the member has no
initial invitation or earlier standby place. Check repeat benches first, then
closed-table benches, in planning order. The activity partner allowance stays
separate from initial group invitations.

```quint
pure def friendStandbyCanRemain(hasInitialInvitation: bool, hasStandbyPlace: bool): bool =
  not(hasInitialInvitation or hasStandbyPlace)

pure def lawFriendStandbyHasNoOtherSeat(hasInitialInvitation: bool, hasStandbyPlace: bool): bool =
  friendStandbyCanRemain(hasInitialInvitation, hasStandbyPlace) implies
  not(hasInitialInvitation) and not(hasStandbyPlace)

pure def lawFriendUnassignedStandbyCanRemain(hasInitialInvitation: bool, hasStandbyPlace: bool): bool =
  (not(hasInitialInvitation) and not(hasStandbyPlace)) implies
  friendStandbyCanRemain(hasInitialInvitation, hasStandbyPlace)
```

### An unsuccessful starting member leaves the rest of the table candidates available

Try the bounded candidate pool in its existing priority order. A table must reach the minimum number of mutually compatible candidates, pass the venue, travel, and circle checks, and reserve its seats. If the table fails any of these checks, try the next starting member in the same pool. Stop when one table reserves its seats or the pool has no starting member left.

```quint
pure def friendTableHasMinimumCandidates(compatibleCandidates: int, minimumInvitees: int): bool =
  compatibleCandidates >= minimumInvitees

pure def lawFriendTableBelowMinimumIsRefused(compatibleCandidates: int, minimumInvitees: int): bool =
  compatibleCandidates < minimumInvitees implies not(friendTableHasMinimumCandidates(compatibleCandidates, minimumInvitees))

pure def friendTableTriesNextStarter(tableReserved: bool, startersLeft: int): bool =
  not(tableReserved) and startersLeft > 0

pure def lawFriendTableStopsAfterAReservedTable(startersLeft: int): bool =
  not(friendTableTriesNextStarter(true, startersLeft))

pure def lawFriendTableStopsWhenNoStarterIsLeft(tableReserved: bool): bool =
  not(friendTableTriesNextStarter(tableReserved, 0))
```

### Activity partner reservations use a separate per-member allowance

An activity partner reservation pairs two different members and uses one allowance for each. A new plan or recurring reservation does not affect the partner allowance.

```quint
type PartnerPair = { first: str, second: str }

pure def partnerCount(s: FriendsRun, memberId: str): int =
  s.partnerCounts.getOr(memberId, 0)

pure def canReservePartner(s: FriendsRun, pair: PartnerPair, limit: int): bool =
  s.phase == PartnerIntros and pair.first != pair.second and
    partnerCount(s, pair.first) < limit and partnerCount(s, pair.second) < limit

pure def reservePartner(s: FriendsRun, pair: PartnerPair, limit: int): FriendsRun =
  { ...s, partnerCounts: s.partnerCounts
    .put(pair.first, partnerCount(s, pair.first) + 1)
    .put(pair.second, partnerCount(s, pair.second) + 1) }

pure val pairValues = Set({ first: "one", second: "two" }, { first: "two", second: "three" })
pure val limitValues = Set(0, 1, 2)

pure def sometimesPublishesAPartner(s: FriendsRun): bool = s.phase == WeekComplete and partnerCount(s, "one") > 0
```

### The simulator counts contact after a visible concern

A known-adversary contact depends on the evidence available at the start of the proposal week. An uncleared safety cue, incomplete verification, or a hold already in effect makes the offender known. Count every affected offender–member pair once. Check every contact so a previous interaction before the hold cannot hide a later violation.

```quint
pure def friendAdversaryKnownAtProposal(visibleConcern: bool, holdAlreadyInEffect: bool): bool =
  visibleConcern or holdAlreadyInEffect

pure def lawFriendExistingHoldMakesAdversaryKnown(visibleConcern: bool): bool =
  friendAdversaryKnownAtProposal(visibleConcern, true)
```
