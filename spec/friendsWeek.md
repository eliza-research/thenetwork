# Friends weekly planning

The weekly Friends planner uses this run state to assign reservations. The [crew model](models/plan_crew.md) and [plan model](models/plan_run.md) cover what happens after a proposal leaves the planner. The planner supplies eligible members and finished candidates in its ranked order. It computes availability, venue, travel, timing, and plan copy outside this state.

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

### An unsuccessful starting member leaves the rest of the table candidates available

Try the bounded candidate pool in its existing priority order. A table must reach the minimum number of mutually compatible candidates, pass the venue, travel, and circle checks, and reserve its seats. If the table fails any of these checks, try the next starting member in the same pool. Stop when one table reserves its seats or the pool has no starting member left.

```quint
pure def friendTableHasMinimumCandidates(compatibleCandidates: int, minimumInvitees: int): bool =
  compatibleCandidates >= minimumInvitees

pure def lawFriendTableNeedsMoreThanOneCompatiblePeer(compatibleCandidates: int, minimumInvitees: int): bool =
  (compatibleCandidates <= 2 and minimumInvitees >= 3) implies not(friendTableHasMinimumCandidates(compatibleCandidates, minimumInvitees))
```

### Activity partner reservations use a separate per-member allowance

An activity partner reservation pairs two different members and uses one allowance for each. Only finished candidates use the allowance. A new plan or recurring reservation does not affect the partner allowance.

```quint
type PartnerPair = { first: str, second: str }

pure def partnerCount(s: FriendsRun, memberId: str): int =
  if (s.partnerCounts.keys().contains(memberId)) s.partnerCounts.get(memberId) else 0

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
