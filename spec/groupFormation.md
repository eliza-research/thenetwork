# Group formation

The [candidate pool model](models/candidate_pool.md) follows groups into the Network service. This state machine governs the engine's group composer and its circle admission. The shell supplies ages, pair compatibility, presence overlap, scores, the ranked order from the circle search, and the circle evidence: member count, pair values and standing spread, all as integers on the 1000 scale (pair values) and the 0..100 scale (standing). The shell also supplies the circle limits. It reads them from the lane table (`laneLimits` in `spec/matchLane.md`) or uses the caller's own group size, so this spec does not import that table. The shell keeps the score calculations, the standing values and the final role assignment. Product stories: [Story F12](product/stories.md#story-f12--join-a-small-group) and [Story F32](product/stories.md#story-f32--keep-meeting-a-public-activity-group).

## Story: Form a compatible group and keep eligible backups

> As a member, I want a group that fits the activity and location, with compatible alternates if a place opens.

### Only eligible adults enter the group search

A forced participant who fails the adult check makes the whole request ineligible. Other candidates who fail it stay outside the search. A candidate already in the partial group, or incompatible with any of its members, cannot extend that group.

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

## Story: Grow circles that fit and keep crews together

> As a member, I want a small circle in which every pair fits, and I want the people I already enjoyed meeting to stay together.

The engine's circle builder (`packages/engine/src/match/circles.ts`) is the shell of these rules. It uses only the pair values of its edges (each at the circle pair floor) and admits every circle with `circleCoherent`, so the rules here change which coherent circles it finds, never what a coherent circle is. It reads no pair value of its own, so a build costs no pair checks beyond the bounded search that made its edges. Each member is in at most one circle of a build, and only while the member has capacity left. A plan can also rank each complete circle during growth, so that its activity and time floors apply before reservation. The builder first tries the earlier circles that its caller gives, then the triangles of its edges from the strongest (highest lowest pair value, then highest total, then key order). A circle grows by the member whose lowest pair value with the circle is highest, while the circle is smaller than the maximum of the build and a member links to every member of the circle.

A circle grows to the maximum of its build. A preferred size of four for the Friend lane (grow to four, then add a member only when the member does not lower the circle's lowest pair value) was built, measured and removed, because it held fewer meetings in The Network. Spontaneous conversation has an upper limit of about four people (Dunbar, Duncan and Nettle 1995), and on the planted Friend worlds of the matching block (N 200, seeds 1 to 3) the preferred size of four recovered the planted circles better than growth to the maximum: adjusted Rand index 0.814 against 0.727 in the friends app and 0.735 against 0.701 for The Network's Friend lane, and a mean lowest pair value per circle of 518 against 407 and 455 against 335 (sizes of three and five gave 0.692 and 0.814 in the friends app). But in The Network's consent arms of the network block (21 days, seeds 1 to 10) the preferred size of four held 497 meetings against 522 for growth to the maximum (paired difference per seed -2.5, 95% interval -8.3 to +3.3), and the share of proposals where everyone said yes was 0.846 against 0.853. On seeds 1 to 3 it held 146 meetings against 171, near the block's gate of more than 140. Growth to the maximum held 522 meetings against 520 for the builder before this story (paired difference +0.2, 95% interval -2.8 to +3.2). Meetings held are the outcome that members feel, so the Friend lane grows to its maximum. A preferred size of four is a product-owner decision: it gives circles that match better and meet less, and these numbers are its evidence.

A wedge (two edges a-b and b-c whose third side a-c is in no kept list) is not closed. A step that read the third side through the pair gate, under a budget of 66 extra checks per member, was measured on the planted worlds of the matching block (N 200, seeds 1 to 3, with the preferred size of four) and removed: without it, the adjusted Rand index of the circles against the planted circles was 0.814 against 0.805 in the friends app and 0.735 against 0.708 for The Network's Friend lane, the low standing quintile's proposal rate was 0.961x against 0.926x the overall rate in the friends app, and the mean lowest pair value per circle was 518 against 519 and 455 against 448, at no extra pair checks against 17.6 and 36.0 per profile.

The matching block measures how far the greedy circles are from the best packing. On small planted worlds (N 30, one for each seed and circle lane) an offline branch and bound search (`scripts/sim/circleOracle.ts`, never on the engine path) finds the best partition of the lane's profiles into disjoint coherent circles, with every pair value read through the one pair gate. Its objective is the member-weighted least pair value: the sum over circles of the circle size times its lowest pair value, so a member outside every circle adds 0. A member adds at most its pair value with its second best partner, because a circle has at least two other members. A search that stops at its node limit reports the best packing that it found, which is a lower bound on the best packing, so the greedy share is then an upper bound. The tracked gate asks for a greedy share of at least 0.8.

### An earlier circle is tried before new triangles

Friendship needs many hours with the same people (Hall 2018), so a group that already met and would meet again is tried as a seed before any new triangle. The caller supplies the past tables: each completed meetup of the last `circleRepeatWindowDays` (21) days, newest first, as its attendees who said they would meet another attendee again and heard the same back. The past tables of a world are read once, because the input of a world does not change during its run. A plan pool passes the past tables of its members; a pool build that must contain forced members uses only the past tables that contain all of them, because another past table could take the partners of the forced members. The lane build of a run passes none. A seed is used only when it has at least two members and at most the maximum, every member is still open in this run, its lowest pair value reaches the circle pair floor (a pair without an edge counts as below the floor), and the standing spread is within the band. The seed then grows like a triangle seed, and the finished circle passes `circleCoherent`. This rule changed: a seed now grows to the maximum of its build, because the Friend lane has no preferred size (see the story). A seed that fails is skipped, and new circles still form from triangles, so an earlier circle is a preference, never a restriction. A crew is not a seed: a crew meets again through its own sessions (`crewSessionPlan`), and its members in a live crew session are not in the plan pool.

```quint
pure val circleRepeatWindowDays: int = 21

pure def circleSeedAllowed(circleSize: int, maximum: int, membersOpen: bool, lowestPairValue: int, pairFloor: int, spreadAllowed: bool): bool =
  2 <= circleSize and circleSize <= maximum and membersOpen and lowestPairValue >= pairFloor and spreadAllowed

pure def lawAllowedSeedFitsTheCircle(circleSize: int, maximum: int, membersOpen: bool, lowestPairValue: int, pairFloor: int, spreadAllowed: bool): bool =
  circleSeedAllowed(circleSize, maximum, membersOpen, lowestPairValue, pairFloor, spreadAllowed) implies and {
    lowestPairValue >= pairFloor,
    circleSize <= maximum,
    membersOpen,
    spreadAllowed,
  }
```

### A swap between two circles raises the lower of their lowest pair values

After the greedy pass, the builder makes one bounded round of local search. For each two circles joined by a link, in a fixed order, it tries to move one member from one circle to the other, or to swap one member of each. It keeps a change only when both new circles pass `circleCoherent` and stay within the maximum, the lower of their two lowest pair values rises, and the sum of the two lowest pair values does not fall, so the stronger circle loses at most what the weaker one gains. Of the changes that pass, it keeps the one with the highest lower value, then the first in key order. This rule changed: a move no longer obeys a preferred size, because circles grow to the maximum of their build (see the story). On the planted worlds of the matching block (N 200, seeds 1 to 3), with growth to the maximum, the round raised the mean lowest pair value per circle from 397 to 407 in the friends app and from 322 to 335 for The Network's Friend lane, and the adjusted Rand index from 0.712 to 0.727 and from 0.687 to 0.701. With the preferred size of four, the round raised the low standing quintile's proposal rate from 0.954x to 0.961x and from 1.045x to 1.063x the overall rate, and without the sum condition it lowered the adjusted Rand index of the friends circles from 0.814 to 0.791. Each kept change raises that lower value, so neither new circle falls to or below the old lower value. A circle seeded by an earlier circle keeps its members: the round changes only circles that grew from triangles. A ranked build (a plan pool) makes no swap round, because a swap does not see the plan's rank and could replace the circle the plan ranked best. A build with forced members (a pool build that must contain given members, such as `composeGroup` and its retry with a host forced in) makes no swap round either: its caller keeps only the circle that holds every forced member, and a swap could move a forced member out of that circle or take a partner from it to improve a circle the caller does not keep. The round reads only values the builder already has, visits each linked pair of circles once, and is deterministic.

```quint
pure def circleSwapImproves(lowestFirst: int, lowestSecond: int, lowestFirstAfter: int, lowestSecondAfter: int): bool =
  val before = if (lowestFirst < lowestSecond) lowestFirst else lowestSecond
  val after = if (lowestFirstAfter < lowestSecondAfter) lowestFirstAfter else lowestSecondAfter
  after > before and lowestFirstAfter + lowestSecondAfter >= lowestFirst + lowestSecond

pure def circleSwapRoundRuns(ranked: bool, forcedCount: int): bool = not(ranked) and forcedCount <= 0

pure def lawForcedBuildKeepsGreedyCircles(ranked: bool, forcedCount: int): bool =
  (ranked or forcedCount > 0) implies not(circleSwapRoundRuns(ranked, forcedCount))

pure def lawSwapLosesNoMoreThanItGains(lowestFirst: int, lowestSecond: int, lowestFirstAfter: int, lowestSecondAfter: int): bool =
  val lowerBefore = if (lowestFirst < lowestSecond) lowestFirst else lowestSecond
  val higherBefore = if (lowestFirst < lowestSecond) lowestSecond else lowestFirst
  val lowerAfter = if (lowestFirstAfter < lowestSecondAfter) lowestFirstAfter else lowestSecondAfter
  val higherAfter = if (lowestFirstAfter < lowestSecondAfter) lowestSecondAfter else lowestFirstAfter
  val improves = circleSwapImproves(lowestFirst, lowestSecond, lowestFirstAfter, lowestSecondAfter)
  improves implies (higherBefore - higherAfter <= lowerAfter - lowerBefore)

pure def lawSwapLeavesNoCircleAtTheOldLow(lowestFirst: int, lowestSecond: int, lowestFirstAfter: int, lowestSecondAfter: int): bool =
  circleSwapImproves(lowestFirst, lowestSecond, lowestFirstAfter, lowestSecondAfter) implies and {
    lowestFirstAfter > lowestFirst or lowestFirstAfter > lowestSecond,
    lowestSecondAfter > lowestFirst or lowestSecondAfter > lowestSecond,
  }
```
