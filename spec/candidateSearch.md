# Bounded candidate search

The [matching engine model](models/matching_engine.md) and the [candidate pool model](models/candidate_pool.md) follow matching from retrieval to proposal. This spec governs one search: the best candidates for one member in one block (one lane, the partner side and one market), found with a fixed limit on pair checks. The engine shell supplies the lane's search limit and search budget, the member's standing window, the bucket bounds, the pair value and canonical ordinal of each candidate it checks, and the highest bound of the buckets it has not scanned. The shell keeps the candidate index, the bucket order, and the candidate records. The [reciprocal pair value](pairValue.md) gives each pair value. [Story F21](product/stories.md#story-f21--hear-when-nothing-fits) uses an empty or budgeted result as a recorded reason, and [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction) uses the kept candidates.

## Story: Search only where a pair can have a value

> As a member, I want the Network to look for my matches only where a match is possible, so that the search stays small and misses no one.

### The standing window contains every partner that the parity rule allows

The window is centered on the member's standing minus the lane offset. Its half-width is the parity band plus the member's own uncertainty plus the uncertainty ceiling, because the shell does not know the partner's uncertainty before it reads the partner. A partner whose uncertainty is at most the ceiling and who passes the parity rule is always in the window, so the shell can find the window with two binary searches on members sorted by standing and skip everyone outside it.

```quint
import pairValue.* from "./pairValue"

pure def searchWindowLow(standing: int, offset: int, band: int, uncertainty: int, uncertaintyCeiling: int): int =
  standing - offset - (band + uncertainty + uncertaintyCeiling)

pure def searchWindowHigh(standing: int, offset: int, band: int, uncertainty: int, uncertaintyCeiling: int): int =
  standing - offset + (band + uncertainty + uncertaintyCeiling)

pure def inSearchWindow(otherStanding: int, standing: int, offset: int, band: int, uncertainty: int, uncertaintyCeiling: int): bool =
  searchWindowLow(standing, offset, band, uncertainty, uncertaintyCeiling) <= otherStanding
    and otherStanding <= searchWindowHigh(standing, offset, band, uncertainty, uncertaintyCeiling)

pure def lawWindowComplete(standing: int, otherStanding: int, offset: int, band: int, uncertainty: int, otherUncertainty: int, uncertaintyCeiling: int): bool =
  (otherUncertainty <= uncertaintyCeiling
    and parityAllowed(standingGap(standing, otherStanding, offset), band, uncertainty, otherUncertainty))
  implies inSearchWindow(otherStanding, standing, offset, band, uncertainty, uncertaintyCeiling)
```

### A bucket bound is never below the value of a pair inside the bucket

The shell computes, for each bucket, an upper bound on the member's utility for any member of the bucket, an upper bound on their utility for the member, and the smallest parity penalty in the bucket's standing range. The bucket bound is the harmonic value of the two utility bounds minus that least penalty, and never below zero. The harmonic value does not decrease when either utility increases, so no pair value in the bucket is above the bound.

```quint
pure def bucketValueBound(utilityBound: int, otherUtilityBound: int, leastPenalty: int): int =
  val bound = harmonicValue(utilityBound, otherUtilityBound) - leastPenalty
  if (bound > 0) bound else 0

pure def lawBucketBoundSound(utility: int, otherUtility: int, penalty: int, utilityBound: int, otherUtilityBound: int, leastPenalty: int): bool =
  val penalised = harmonicValue(utility, otherUtility) - penalty
  val pairWorth = if (penalised > 0) penalised else 0
  and { utility <= utilityBound, otherUtility <= otherUtilityBound, penalty >= leastPenalty, leastPenalty >= 0 }
    implies pairWorth <= bucketValueBound(utilityBound, otherUtilityBound, leastPenalty)
```

## Story: Keep the best candidates within a fixed number of pair checks

> As a member, I want the best available matches found with a bounded amount of work, and I want the Network to know when the work stopped before it was sure.

### A search starts once with a positive limit and a budget no smaller than the limit

The limit is the number of candidates to keep. The budget is the most pair checks the search can make. Both come from the lane limits. Before it starts, a search has no checks, no kept candidate, and no dropped value.

```quint
type SearchPhase = Idle | Scanning | Exact | Budgeted
type RankedCandidate = { value: int, ordinal: int }
type CandidateSearch = {
  phase: SearchPhase, limit: int, budget: int, checks: int,
  kept: List[RankedCandidate], bestDropped: int, bestDroppedOrdinal: int, unseenBound: int,
}

pure val initial: CandidateSearch = {
  phase: Idle, limit: 0, budget: 0, checks: 0,
  kept: List(), bestDropped: noPairValue, bestDroppedOrdinal: 0, unseenBound: noPairValue,
}

pure val limitValues = Set(1, 2)
pure val budgetValues = Set(1, 2, 3)

pure def canBeginSearch(s: CandidateSearch, limit: int, budget: int): bool =
  s.phase == Idle and limit > 0 and budget >= limit

pure def beginSearch(s: CandidateSearch, limit: int, budget: int): CandidateSearch =
  { ...s, phase: Scanning, limit: limit, budget: budget }

pure def alwaysIdleSearchIsEmpty(s: CandidateSearch): bool =
  s.phase == Idle implies (s.checks == 0 and s.kept.length() == 0 and s.bestDropped == noPairValue)

pure def alwaysChecksWithinBudget(s: CandidateSearch): bool = s.checks <= s.budget
```

### Each check counts once and keeps the candidate only when it ranks among the best

Candidates rank by pair value, highest first, and then by ordinal, lowest first. This is a total order, because the shell gives each member one ordinal in the canonical member order. A candidate without a pair value is counted and not kept. While the kept list is not full, a candidate with a pair value is kept. When the list is full, the new candidate replaces the worst kept candidate only when the new candidate ranks above it. The kept list is not sorted, and it never holds two candidates with the same ordinal. `bestDropped` and `bestDroppedOrdinal` are the value and ordinal of the highest-ranked candidate with a pair value that was displaced or not kept. They start below every pair value. A candidate is dropped only when the list is full. Every kept candidate ranks above the best dropped one, so ties go to the lower ordinal; every kept value is then also at least `bestDropped`.

```quint
type WorstKeptScan = { position: int, worstPosition: int, worst: RankedCandidate }

pure val valueValues = Set(-1, 0, 3, 5)
pure val ordinalValues = Set(0, 1, 2)

pure def candidateRanksAbove(candidate: RankedCandidate, other: RankedCandidate): bool =
  candidate.value > other.value or (candidate.value == other.value and candidate.ordinal < other.ordinal)

pure def searchHigherRanked(left: RankedCandidate, right: RankedCandidate): RankedCandidate =
  if (candidateRanksAbove(right, left)) right else left

pure def searchDroppedRank(s: CandidateSearch): RankedCandidate =
  { value: s.bestDropped, ordinal: s.bestDroppedOrdinal }

pure def worstKeptScan(kept: List[RankedCandidate]): WorstKeptScan =
  kept.foldl({ position: 0, worstPosition: -1, worst: { value: 0, ordinal: 0 } }, (scan, candidate) =>
    if (scan.worstPosition < 0 or candidateRanksAbove(scan.worst, candidate))
      { position: scan.position + 1, worstPosition: scan.position, worst: candidate }
    else { ...scan, position: scan.position + 1 })

pure def canCheckCandidate(s: CandidateSearch, ordinal: int): bool =
  s.phase == Scanning and s.checks < s.budget and not(s.kept.some(c => c.ordinal == ordinal))

pure def checkCandidate(s: CandidateSearch, value: int, ordinal: int): CandidateSearch =
  val candidate = { value: value, ordinal: ordinal }
  val scan = worstKeptScan(s.kept)
  val displacedBest = searchHigherRanked(searchDroppedRank(s), scan.worst)
  val refusedBest = searchHigherRanked(searchDroppedRank(s), candidate)
  val counted = { ...s, checks: s.checks + 1 }
  if (value < 0) counted
  else if (s.kept.length() < s.limit) { ...counted, kept: s.kept.append(candidate) }
  else if (scan.worstPosition >= 0 and scan.worstPosition < s.kept.length() and candidateRanksAbove(candidate, scan.worst))
    { ...counted, kept: s.kept.removeAt(scan.worstPosition).append(candidate),
      bestDropped: displacedBest.value, bestDroppedOrdinal: displacedBest.ordinal }
  else { ...counted, bestDropped: refusedBest.value, bestDroppedOrdinal: refusedBest.ordinal }

pure def alwaysKeptWithinLimit(s: CandidateSearch): bool = s.kept.length() <= s.limit

pure def alwaysKeptValuesAreRealPairs(s: CandidateSearch): bool = s.kept.every(c => c.value >= 0)

pure def alwaysDroppedOnlyWhenFull(s: CandidateSearch): bool =
  s.bestDropped > noPairValue implies s.kept.length() == s.limit

pure def alwaysKeptOrdinalsDistinct(s: CandidateSearch): bool =
  s.kept.every(c => s.kept.select(d => d.ordinal == c.ordinal).length() == 1)

pure def alwaysKeptBeatDropped(s: CandidateSearch): bool = s.kept.every(c => c.value >= s.bestDropped)

pure def alwaysKeptRankAboveDropped(s: CandidateSearch): bool =
  val dropped = searchDroppedRank(s)
  s.bestDropped > noPairValue implies s.kept.every(c => candidateRanksAbove(c, dropped))

pure def stepEachCheckCountsOnce(before: CandidateSearch, via: str, after: CandidateSearch): bool =
  if (via == "checkCandidate") after.checks == before.checks + 1
  else after.checks == before.checks

pure def sometimesDroppedCandidate(s: CandidateSearch): bool = s.bestDropped >= 0
```

### An exact search stops only when no unseen candidate can enter the kept list

The shell passes as `unseenBound` the highest bucket bound of the window buckets that still hold an unchecked candidate (a partly scanned bucket counts), or `noPairValue` when every window candidate was checked. The search is exact when nothing is unseen, or when the kept list is full and every kept value is above the unseen bound.

The composed theorem: the window contains every feasible partner (`lawWindowComplete`), no unseen pair value is above its bucket bound (`lawBucketBoundSound`), every kept candidate ranks above every dropped one in the total order, so ties go to the lower ordinal (`alwaysKeptRankAboveDropped`, which implies `alwaysKeptBeatDropped`), and an exact search leaves no unseen candidate that could enter (`alwaysExactBeatsUnseen`). So an Exact result is the brute-force answer: the first `limit` members of the feasible set in the order of value, highest first, and then ordinal, lowest first. If the feasible set is smaller than the limit, the result is the whole feasible set.

```quint
pure val unseenBoundValues = Set(-1, 2, 4, 6)

pure def searchStopsExact(s: CandidateSearch, unseenBound: int): bool =
  unseenBound < 0 or (s.kept.length() == s.limit and s.kept.every(c => c.value > unseenBound))

pure def canCloseExact(s: CandidateSearch, unseenBound: int): bool =
  s.phase == Scanning and searchStopsExact(s, unseenBound)

pure def closeExact(s: CandidateSearch, unseenBound: int): CandidateSearch =
  { ...s, phase: Exact, unseenBound: unseenBound }

pure def alwaysExactBeatsUnseen(s: CandidateSearch): bool =
  s.phase == Exact implies searchStopsExact(s, s.unseenBound)

pure def sometimesExact(s: CandidateSearch): bool = s.phase == Exact and s.unseenBound >= 0
```

### A search that spends its budget before it is exact reports the value it may have missed

A search that reaches its budget and cannot stop exactly closes as Budgeted. Its kept list is the best among the checked candidates, and no candidate it did not check has a pair value above `unseenBound`. The engine records the search, its bound, and an empty or Budgeted result as the reason of [Story F21](product/stories.md#story-f21--hear-when-nothing-fits). It never fills the gap with a pair that has no pair value. A closed search does not change.

The cost bound: a search makes at most `budget` pair checks (`alwaysChecksWithinBudget`), and a run starts at most one search for each lane membership of each member. So the pair checks of a run in one lane are at most the number of members times the lane's search budget, whatever the data.

```quint
pure def canCloseBudgeted(s: CandidateSearch, unseenBound: int): bool =
  s.phase == Scanning and s.checks >= s.budget and not(searchStopsExact(s, unseenBound))

pure def closeBudgeted(s: CandidateSearch, unseenBound: int): CandidateSearch =
  { ...s, phase: Budgeted, unseenBound: unseenBound }

pure def stepClosedSearchStaysClosed(before: CandidateSearch, after: CandidateSearch): bool =
  (before.phase == Exact or before.phase == Budgeted) implies after == before

pure def sometimesBudgeted(s: CandidateSearch): bool = s.phase == Budgeted
```
