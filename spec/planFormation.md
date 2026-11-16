# Single-slot plan formation

The [plan flow model](models/plan_run.md) follows plans through review, replies, quorum and fallback. This spec governs candidate formation before review. The planner supplies its ranked slots, people, venues, and scores. It keeps the existing beam search, tie breaks, and proposal fields.

## Story: Find a public activity that fits the group

> As a member, I want a proposal for a compatible group that can fit at the chosen venue.

### A public venue must fit the activity and the proposed number of people

Consider venues in the requested city that host the activity, have room for a pair, and are open at the slot. Prefer a venue that has room for a group and enough people who meet its minimum age. The chosen venue or event limits the number the plan can invite.

```quint
pure def venueCanHostActivity(isPublic: bool, sameCity: bool, supportsActivity: bool, capacity: int): bool =
  isPublic and sameCity and supportsActivity and capacity >= 2

pure def venueCanHoldGroup(capacity: int, eligiblePeople: int, minimumGroup: int): bool =
  capacity >= minimumGroup and eligiblePeople >= minimumGroup

pure def planCanFitPlace(maximumGroup: int, minimumPlace: int): bool = not(maximumGroup < minimumPlace)
```

### Search for a qualifying group before an activity partner

Search for a group when the capacity and the current pool meet the group minimums. Both the minimum score for any participant and the whole proposal score must meet their thresholds. If no group qualifies, look for a pair when partner plans are enabled, the activity allows pairs, and the place can hold two people.

```quint
pure def searchForPlanGroup(available: int, minimumInvite: int, maximumGroup: int, minimumGroup: int): bool =
  available >= minimumInvite and maximumGroup >= minimumGroup

pure def planScoreQualifies(minimumScore: int, overallScore: int, memberFloor: int, planFloor: int): bool =
  minimumScore >= memberFloor and overallScore >= planFloor

pure def searchForPlanPartner(hasGroup: bool, partnerEnabled: bool, activityMinimum: int, capacity: int): bool =
  not(hasGroup) and partnerEnabled and activityMinimum <= 2 and capacity >= 2
```

### Alternates must fit the entire offered group

An alternate must be an eligible adult and compatible with every invitee and previously chosen alternate. A partner plan may list one alternate. A group plan uses its configured alternate limit. For a new or repeated Friends table, each of those pairs must have a value in the Friend lane. Check the ranked candidates before applying the alternate limit. If transit removes an invitee, only a compatible alternate already selected for that table can fill the seat.

```quint
pure def isPlanAlternate(adult: bool, compatibleWithEveryone: bool): bool = adult and compatibleWithEveryone

pure def planAlternateLimitReached(alternates: int, partner: bool, groupLimit: int): bool =
  alternates >= (if (partner) 1 else groupLimit)
```

## Story: Give each invited member one plan per city run

> As a member, I want the planner to reserve one invitation at a time so the plans can go to review together.

### Reserve ranked plans until the city limit is reached

The planner offers candidates in score order with its existing tie break. Skip a plan that would repeat an invited member and keep looking at later candidates. Stop reserving at the configured limit. A reservation consumes one plan and records its primary invitees together.

```quint
type PlanRunPhase = ReservingPlans | PlansPublished
type CityPlanRun = { phase: PlanRunPhase, count: int, occupied: str -> bool }

pure val initial: CityPlanRun = { phase: ReservingPlans, count: 0, occupied: Map() }

pure def cityPlanLimitReached(s: CityPlanRun, limit: int): bool = s.count >= limit

pure def memberAlreadyInvited(s: CityPlanRun, memberId: str): bool = s.occupied.keys().contains(memberId)

pure def canReservePlan(s: CityPlanRun, invited: List[str], limit: int): bool =
  s.phase == ReservingPlans and not(cityPlanLimitReached(s, limit)) and invited.every(memberId => not(memberAlreadyInvited(s, memberId)))

pure def reservePlan(s: CityPlanRun, invited: List[str], limit: int): CityPlanRun =
  { ...s, count: s.count + 1, occupied: invited.foldl(s.occupied, (members, memberId) => members.put(memberId, true)) }

pure val invitedValues = Set(List("a", "b"), List("b", "c"), List("c", "d", "e"))
pure val limitValues = Set(0, 1, 2, 3)

pure def stepPlanCountChangesOnlyOnReservation(before: CityPlanRun, via: str, after: CityPlanRun): bool =
  if (via == "reservePlan") after.count == before.count + 1 else after.count == before.count
```

### Publish alternates after all invitations are reserved

Publish the reserved plans together. Remove alternates who received an invitation in any of those plans. An alternate who did not receive an invitation can remain on more than one plan. Publication closes reservations.

```quint
pure def canPublishPlans(s: CityPlanRun): bool = s.phase == ReservingPlans
pure def publishPlans(s: CityPlanRun): CityPlanRun = { ...s, phase: PlansPublished }

pure def planAlternateCanRemain(s: CityPlanRun, memberId: str): bool =
  s.phase == PlansPublished and not(memberAlreadyInvited(s, memberId))

pure def stepPublishedPlansStayClosed(before: CityPlanRun, after: CityPlanRun): bool =
  before.phase == PlansPublished implies after == before

pure def sometimesPublishesAnInvitation(s: CityPlanRun): bool = s.phase == PlansPublished and s.count > 0
```
