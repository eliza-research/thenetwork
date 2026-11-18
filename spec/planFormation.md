# Single-slot plan formation

The [plan flow model](models/plan_run.md) follows plans through review, replies, quorum and fallback. This spec governs candidate formation before review. The planner supplies its ranked slots, people, venues, and scores. It keeps the existing beam search, tie breaks, and proposal fields.

## Story: Find a public activity that fits the group

> As a member, I want a proposal for a compatible group that can fit at the chosen venue.

### A public venue must fit the activity and the proposed number of people

Consider venues in the requested city that host the activity, have room for a pair, and are open at the slot. Prefer a venue that has room for a group and enough people who meet its minimum age. The chosen venue or event limits the number the plan can invite. A plan goes on only when that limit is not less than the smaller of its minimum group and two.

```quint
pure def venueCanHostActivity(isPublic: bool, sameCity: bool, supportsActivity: bool, capacity: int, openAtSlot: bool): bool =
  isPublic and sameCity and supportsActivity and capacity >= 2 and openAtSlot

pure def venueCanHoldGroup(capacity: int, eligiblePeople: int, minimumGroup: int): bool =
  capacity >= minimumGroup and eligiblePeople >= minimumGroup

pure def planInviteLimit(planMaximum: int, placeCapacity: int): int =
  if (placeCapacity < planMaximum) placeCapacity else planMaximum

pure def planCanFitPlace(maximumGroup: int, minimumPlace: int): bool = not(maximumGroup < minimumPlace)

pure def lawPlaceCapsInvites(planMaximum: int, placeCapacity: int): bool =
  not(planInviteLimit(planMaximum, placeCapacity) > placeCapacity) and not(planInviteLimit(planMaximum, placeCapacity) > planMaximum)
```

### A known trip must fit the member's travel limit

For a generic plan, use the member's known neighborhood and the public venue
or event area to estimate the one-way trip. When the estimate and the member's
limit are known, use only venues within the limit for that member. This applies
to primary participants and alternates. Unknown neighborhoods leave the travel
estimate unknown. Of venues that can hold a group, favor those that fit more
members, then shorter longest known trips. Keep the existing area and stable
venue tie breaks. A public event uses its fixed location and the same limit.

```quint
pure def planTravelFits(hasEstimateAndLimit: bool, minutes: int, maximumMinutes: int): bool =
  not(hasEstimateAndLimit) or minutes <= maximumMinutes

pure def lawAPlanCannotExceedKnownTravelLimit(minutes: int, maximumMinutes: int): bool =
  minutes > maximumMinutes implies not(planTravelFits(true, minutes, maximumMinutes))
```

### Friends prefers a venue every primary invitee can reach

Compare eligible open venues for the exact activity and slot. If any venue fits each primary invitee's current travel limit, choose among those venues. Within the same travel eligibility, minimize the longest trip and keep the established mean and stable ID tie breaks. When no venue fits everyone, the existing seat and alternate checks still apply. A partner plan needs both people to fit.

```quint
pure def preferPlanVenue(candidateFitsEveryone: bool, selectedFitsEveryone: bool, candidateWinsTravelTieBreak: bool): bool =
  if (candidateFitsEveryone == selectedFitsEveryone) candidateWinsTravelTieBreak else candidateFitsEveryone

pure def lawReachablePlanVenueWins(travelTieBreak: bool): bool =
  preferPlanVenue(true, false, travelTieBreak) and not(preferPlanVenue(false, true, travelTieBreak))
```

### Check pairs inside the available slot pool

For each activity and time, check each pair of distinct members in the ranked
availability pool. The configured pool size bounds this work. Keep an edge only
when the lane's current pair rules give it a value. Use those values for the
group and partner searches. The checker may reuse the same pair's result
within one planner run.

```quint
pure def planSlotPairCanConnect(pairWorth: int): bool =
  pairWorth >= 0
```

### Search for a qualifying group before an activity partner

Search for a group when the capacity and the current pool meet the group minimums. Both the minimum score for any participant and the whole proposal score must meet their thresholds before the group reserves members. Check candidate sizes within the allowed range as the pair-compatible circle grows. Keep a qualifying smaller circle when adding someone would make the group fall below a threshold. Within each growth step, consider the other eligible extensions before choosing one. If the remaining members have no qualifying group in this search, look for a pair when partner plans are enabled, the activity allows pairs, and the place can hold two people.

```quint
pure def searchForPlanGroup(available: int, minimumInvite: int, maximumGroup: int, minimumGroup: int): bool =
  available >= minimumInvite and maximumGroup >= minimumGroup

pure def planScoreQualifies(minimumScore: int, overallScore: int, memberFloor: int, planFloor: int): bool =
  minimumScore >= memberFloor and overallScore >= planFloor

pure def planGroupCanReserve(coherent: bool, minimumScore: int, overallScore: int, memberFloor: int, planFloor: int): bool =
  coherent and planScoreQualifies(minimumScore, overallScore, memberFloor, planFloor)

pure def lawPlanGroupReservationRequiresBothScores(coherent: bool, minimumScore: int, overallScore: int, memberFloor: int, planFloor: int): bool =
  planGroupCanReserve(coherent, minimumScore, overallScore, memberFloor, planFloor) implies
    (coherent and minimumScore >= memberFloor and overallScore >= planFloor)

pure def searchForPlanPartner(hasGroup: bool, partnerEnabled: bool, activityMinimum: int, capacity: int): bool =
  not(hasGroup) and partnerEnabled and activityMinimum <= 2 and capacity >= 2
```

### Alternates must fit the entire offered group

An alternate must be an eligible adult and compatible with every invitee and previously chosen alternate. A partner plan may list one alternate. A group plan uses its configured alternate limit. For a new or repeated Friends table, each of those pairs must have a value in the Friend lane. Check the ranked candidates before applying the alternate limit. If transit removes an invitee, only a compatible alternate already selected for that table can fill the seat. A reviewed plan checks again at the moment it starts its bench and at the moment it promotes an alternate or asks the partner of a partner plan: the member must still be an adult by the lowest age on record or stated, with no minor signal, in every app. An age can become known or go down after the plan was made. The Network also checks every alternate when it submits a plan for review, whoever built the plan, and an alternate who is not an adult then leaves the plan. Changed 2026-11-17 (age safety review): before, only the planner checked age, on a view of the members that can be older than the records, so an alternate whose age had gone down could still be promoted.

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

## Story: Use the same activity window for availability and a proposal

> As a member, I want the planner to check whether I am free for the whole activity before offering the time.

### A template supplies the start and the activity supplies the end

For a proposed start in the generic or Friends planner, use the activity's duration to set the end. Apply existing availability evidence, competing commitments, and the venue check to that whole window. Keep the same bounds on the selected plan and other offered times. For a published event, use its published start and end when checking availability and offering the plan.

```quint
pure def planActivityWindowEnd(startsAt: int, durationMinutes: int): int = startsAt + durationMinutes * 60000

pure def lawPlanActivityWindowEndsAfterStart(startsAt: int, durationMinutes: int): bool =
  durationMinutes > 0 implies planActivityWindowEnd(startsAt, durationMinutes) > startsAt
```

### A standing window applies to the whole activity

Resolve the standing window on the proposed start's local date. Count it as
availability for the activity only if its weekday applies and it contains the
complete activity interval. An activity can end at the window's end. A partial
window supplies no positive standing evidence for the activity.

```quint
pure def planStandingWindowCoversSlot(windowStart: int, windowEnd: int, slotStart: int, slotEnd: int): bool =
  windowStart <= slotStart and slotStart < slotEnd and slotEnd <= windowEnd
```

### The member's latest weekly answer takes precedence

Record this week's windows from the member's own text answer to their weekly
check-in. A clear answer that the whole week is busy records an empty week.
An unclear answer leaves the earlier record in place. A recorded answer applies
for seven days. When that period includes the activity's start, a stated window
must contain the whole activity. Standing or learned availability cannot make
an excluded activity eligible. Formation, rescheduling, and dispatch use the
same rule for this record.

```quint
type WeeklyCheckinEvidence = KeepEarlier | RecordWindows | RecordUnavailable

pure val weeklyCheckinEvidenceMs: int = 604800000

pure def weeklyCheckinEvidence(directAnswer: bool, hasWindows: bool, wholeWeekBusy: bool): WeeklyCheckinEvidence =
  if (not(directAnswer)) KeepEarlier
  else if (hasWindows) RecordWindows
  else if (wholeWeekBusy) RecordUnavailable
  else KeepEarlier

pure def statedPlanWindowAllows(statedAt: int, statedUntil: int, now: int, slotStart: int, coversSlot: bool): bool =
  statedAt > now or statedUntil <= slotStart or coversSlot

pure def lawUnclearWeeklyAnswerKeepsEarlier(directAnswer: bool): bool =
  weeklyCheckinEvidence(directAnswer, false, false) == KeepEarlier

pure def lawCurrentExcludedWindowStopsPlan(statedAt: int, statedUntil: int, now: int, slotStart: int): bool =
  (statedAt <= now and statedUntil > slotStart) implies not(statedPlanWindowAllows(statedAt, statedUntil, now, slotStart, false))
```
