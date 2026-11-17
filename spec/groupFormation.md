# Group formation

The [candidate pool model](models/candidate_pool.md) follows groups into the Network service. This state machine governs the engine's group composer and its circle admission. The shell supplies ages, pair compatibility, presence overlap, scores, the ranked order from the circle search, and the circle evidence: member count, pair values and standing spread, all as integers on the 1000 scale (pair values) and the 0..100 scale (standing). The shell also supplies the circle limits. It reads them from the lane table (`laneLimits` in `spec/matchLane.md`) or uses the caller's own group size, so this spec does not import that table. The shell keeps the score calculations, the standing values and the final role assignment. Product stories: [Story F12](product/stories.md#story-f12--join-a-small-group) and [Story F32](product/stories.md#story-f32--keep-meeting-a-public-activity-group).

## Story: Form a compatible group and keep eligible backups

> As a member, I want a group that fits the activity and location, with compatible alternates if a place opens.

### Only eligible adults enter the group search

A forced participant who fails the adult check makes the whole request ineligible. Other candidates who fail it stay outside the search. The Network applies the same check to each invitee and host of a plan at the moment it submits the plan for review, whoever built it: a plan with one who is not an adult then is not submitted. The planner's view of the members can be older than the member records. A candidate already in the partial group, or incompatible with any of its members, cannot extend that group.

```quint
type FormationPhase = AwaitingPool | Forming | PrimaryChosen | RankingAlternates | Finished

type Formation = {
  phase: FormationPhase, hostRequired: bool, primary: List[str], alternates: List[str], alternateLimit: int,
  circle: CircleEvidence, circleLimits: CircleLimits,
}

pure val initial: Formation = {
  phase: AwaitingPool, hostRequired: false, primary: List(), alternates: List(), alternateLimit: 0,
  circle: {
    size: 0, lowestPairValue: 0, pairValueTotal: 0, pairCount: 0, standingLow: 0, standingHigh: 0, uncertaintyTotal: 0,
  },
  circleLimits: { minimum: 0, maximum: 0, pairFloor: 0, parityBand: 0 },
}

pure def canStartSearch(g: Formation, forcedEligible: bool): bool = g.phase == AwaitingPool and forcedEligible
pure def startSearch(g: Formation, forcedEligible: bool, hostRequired: bool): Formation =
  { ...g, phase: Forming, hostRequired: hostRequired }

pure def poolEligible(adult: bool): bool = adult
pure def extensionAllowed(alreadyIncluded: bool, compatible: bool): bool = not(alreadyIncluded) and compatible
```

### A primary group has a common place and meets its requirements

The scoring shell checks whether the participants have a common city in their windows and whether it is the required city, if one was set. The search keeps groups whose members meet the minimum pairwise fit. A final primary group must meet the configured minimum size. If a host is required, it must contain a host. A configured maximum bounds the search. The shell also supplies the circle evidence for the chosen members and the circle limits. The group is chosen only when the evidence counts exactly these members and the circle is coherent.

```quint
pure val membersValues = Set(List("a", "b", "c"), List("a", "b"))

pure def groupLocationAllowed(hasOverlap: bool, requiresCity: bool, matchingCity: bool): bool =
  hasOverlap and (not(requiresCity) or matchingCity)

pure def groupFitAllowed(hasPairs: bool, belowPairFloor: bool): bool =
  not(hasPairs) or not(belowPairFloor)

pure def primaryAllowed(g: Formation, meetsMinimum: bool, hasHost: bool): bool =
  g.phase == Forming and meetsMinimum and (not(g.hostRequired) or hasHost)

pure def canChoosePrimary(g: Formation, members: List[str], meetsMinimum: bool, hasHost: bool,
  circle: CircleEvidence, circleLimits: CircleLimits): bool = and {
  members.length() > 0,
  circle.size == members.length(),
  circleCoherent(circle, circleLimits.minimum, circleLimits.maximum, circleLimits.pairFloor, circleLimits.parityBand),
  primaryAllowed(g, meetsMinimum, hasHost),
}

pure def choosePrimary(g: Formation, members: List[str], meetsMinimum: bool, hasHost: bool,
  circle: CircleEvidence, circleLimits: CircleLimits): Formation =
  { ...g, phase: PrimaryChosen, primary: members, circle: circle, circleLimits: circleLimits }

pure def alwaysPrimaryRequiredAfterSearch(g: Formation): bool =
  (g.phase == PrimaryChosen or g.phase == RankingAlternates or g.phase == Finished) implies g.primary.length() > 0
```

### A primary circle values every pair and keeps a narrow standing spread

A circle is coherent when its member count is between the minimum and the maximum and the evidence has one pair for each two members. Every pair must have a real pair value: the lowest pair value is at least zero and at least the pair floor, and the pair values together reach the floor for each pair. The gap from the lowest standing to the highest standing must be within the parity band plus the uncertainty total. The uncertainty total is the sum of the uncertainties of the member with the lowest standing and the member with the highest standing, so the circle spread uses the same allowance as a pair check between those two members. A lane whose sides sit apart on purpose, such as a mentor above mentees, gets the band plus its standing offset from the shell. A circle of one member has no pairs, so only its count and standing checks apply. A count of zero or less, or a maximum of zero, never gives a coherent circle: a lane with a circle maximum of zero forms no circles.

Existing callers that form a pair (an activity partner plan) or a group of their own size pass their own minimum and maximum as the circle limits, for example 2 and 2 for a pair. A pair circle has one pair.

The state records the evidence and the limits that admitted the primary group. They stay fixed while alternates are ranked and reserved.

```quint
type CircleEvidence = {
  size: int, lowestPairValue: int, pairValueTotal: int, pairCount: int,
  standingLow: int, standingHigh: int, uncertaintyTotal: int,
}
type CircleLimits = { minimum: int, maximum: int, pairFloor: int, parityBand: int }

pure def circleCoherent(e: CircleEvidence, minimum: int, maximum: int, pairFloor: int, parityBand: int): bool = and {
  e.size >= 1,
  minimum <= e.size,
  e.size <= maximum,
  e.pairCount == e.size * (e.size - 1) / 2,
  e.pairCount == 0 or (e.lowestPairValue >= 0 and e.lowestPairValue >= pairFloor and e.pairValueTotal >= pairFloor * e.pairCount),
  e.uncertaintyTotal >= 0,
  e.standingLow <= e.standingHigh,
  e.standingHigh - e.standingLow <= parityBand + e.uncertaintyTotal,
}

pure def alwaysPrimaryCircleCoherent(g: Formation): bool =
  (g.phase == PrimaryChosen or g.phase == RankingAlternates or g.phase == Finished) implies and {
    g.circle.size == g.primary.length(),
    circleCoherent(g.circle, g.circleLimits.minimum, g.circleLimits.maximum, g.circleLimits.pairFloor, g.circleLimits.parityBand),
  }

pure def sometimesPairCircleChosen(g: Formation): bool = g.phase == PrimaryChosen and g.circle.size == 2

pure val circleLimitsValues = Set(
  { minimum: 3, maximum: 6, pairFloor: 400, parityBand: 20 },
  { minimum: 2, maximum: 2, pairFloor: 400, parityBand: 20 })

pure val circleValues = Set(
  { size: 3, lowestPairValue: 450, pairValueTotal: 1500, pairCount: 3, standingLow: 40, standingHigh: 55, uncertaintyTotal: 6 },
  { size: 2, lowestPairValue: 500, pairValueTotal: 500, pairCount: 1, standingLow: 40, standingHigh: 50, uncertaintyTotal: 6 },
  { size: 3, lowestPairValue: 450, pairValueTotal: 1500, pairCount: 3, standingLow: 10, standingHigh: 90, uncertaintyTotal: 6 },
  { size: 3, lowestPairValue: 300, pairValueTotal: 1500, pairCount: 3, standingLow: 40, standingHigh: 55, uncertaintyTotal: 6 },
  { size: 3, lowestPairValue: 450, pairValueTotal: 1000, pairCount: 2, standingLow: 40, standingHigh: 55, uncertaintyTotal: 6 })
```

### A member's share of a circle is highest when the circle is a clique

A member's share of a circle is the number of circle members it has a real pair value with, divided by the circle size, in thousandths. The size counts the member itself, as in fractional hedonic games (Aziz et al., arXiv:1705.10116), so a clique of three gives each member 666 and a clique of six gives 833. The shell uses the share to measure how well each member fits the formed circle. A neighbour count below zero counts as zero, and a count above the size minus one counts as the size minus one. A size of zero or less gives a share of zero.

```quint
pure val circleShareScale: int = 1000

pure def circleMemberShare(neighbours: int, circleSize: int): int =
  val counted = if (neighbours < 0) 0 else if (neighbours > circleSize - 1) circleSize - 1 else neighbours
  if (circleSize <= 0) 0 else circleShareScale * counted / circleSize

pure def lawCliqueShareIsHighest(neighbours: int, circleSize: int): bool =
  circleMemberShare(neighbours, circleSize) <= circleMemberShare(circleSize - 1, circleSize)
```

### An alternate can join the primary group in its city

An alternate must be outside the primary group and available in its city. Consider alternates by rank. The engine keeps a candidate only when it has a pair value with every primary participant and previously reserved alternate that the lane pairs them with. Skip a candidate who fails that check and keep looking until the alternate limit is reached. A candidate is reserved as an alternate at most once. The service checks current eligibility when it uses a replacement.

```quint
pure val memberValues = Set("c", "d", "e")

pure def alternateAllowed(alreadyPrimary: bool, compatible: bool, sameCityOverlap: bool): bool =
  not(alreadyPrimary) and compatible and sameCityOverlap

pure def canOpenAlternates(g: Formation, alternateLimit: int): bool =
  g.phase == PrimaryChosen and alternateLimit >= 0

pure def openAlternates(g: Formation, alternateLimit: int): Formation =
  { ...g, phase: RankingAlternates, alternateLimit: alternateLimit }

pure def canReserveAlternate(g: Formation, member: str, compatible: bool, sameCityOverlap: bool, pairedWithReserved: bool): bool = and {
  g.phase == RankingAlternates,
  g.alternates.length() < g.alternateLimit,
  not(g.alternates.includes(member)),
  alternateAllowed(g.primary.includes(member), compatible and pairedWithReserved, sameCityOverlap),
}

pure def reserveAlternate(g: Formation, member: str, compatible: bool, sameCityOverlap: bool, pairedWithReserved: bool): Formation =
  { ...g, alternates: g.alternates.append(member) }

pure def canFinishGroup(g: Formation): bool = g.phase == RankingAlternates
pure def finishGroup(g: Formation): Formation = { ...g, phase: Finished }

pure def alwaysAlternateLimitHolds(g: Formation): bool = and {
  g.alternates.length() <= g.alternateLimit,
  (g.phase == AwaitingPool or g.phase == Forming or g.phase == PrimaryChosen) implies g.alternates.length() == 0,
}

pure def stepFinishedStaysFinished(before: Formation, after: Formation): bool =
  before.phase == Finished implies after.phase == Finished

pure def sometimesFinishedWithAlternate(g: Formation): bool = g.phase == Finished and g.alternates.length() > 0
```
