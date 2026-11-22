# Bounded candidate search

One search finds the best candidates in one lane, partner side, and market within fixed limits on pair checks and index entries visited. The shell walks the standing window in tag postings, passes the value and canonical ordinal of each checked pair to the search machine, and supplies an upper bound on unchecked candidates. The [reciprocal pair value](pairValue.md) and [relationship lanes](matchLane.md) define the scoring rules. The [matching engine model](models/matching_engine.md) and [candidate pool model](models/candidate_pool.md) follow the results from retrieval to proposal. [Story F21](product/stories.md#story-f21--hear-when-nothing-fits) uses an empty or budgeted result as a recorded reason. [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction) uses the kept candidates. The engine runs at most one search per profile in a run.

## Story: Search only where a pair can have a value

> As a member, I want the Network to look for my matches only where a match is possible, so that the search stays small and misses no one.

### The standing window contains every partner that the parity rule allows

The window is centered on the member's standing minus the lane offset. Its half-width is the parity band plus the member's own uncertainty plus the uncertainty ceiling, because the shell does not know the partner's uncertainty before it reads the partner. A partner whose uncertainty is at most the ceiling and who passes the parity rule is always in the window. Each posting list of the index is sorted by standing, so the window is one binary-search range inside every posting list, and the shell skips everyone outside it.

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

### Segment blocking never drops a pair the pair gate admits

A pack can give a membership a hard-constraint segment: one opaque segment of its own and the set of segments it can pair with. The member's home zone and travel class are an example, or a dating pool and a location cell. One member reaches another when either membership has no segment, or when the other's segment is in the member's partner segments. The one pair gate admits a pair only when each member reaches the other, before it applies the pack pair rules.

The index sorts the members of a block by segment, then by standing, then by ordinal. So each segment is one range of positions, and the standing window inside a segment is one binary-search range. A search walks only the window ranges of the segments that the searching member reaches, and the segment of the members without a segment. The walk therefore holds every partner that the searching member reaches.

This is the blocking-completeness theorem. It has two halves. The gate half: a pair that the gate admits has a searching member who reaches the partner (`lawSegmentBlockingComplete`). This law states only that half, and it is simple by design. The walk half: the shell (search.ts `windowSpans`) walks the range of every segment that the searching member reaches and the range of the members without a segment, so a reached partner is inside the walked ranges. The law does not state the walk half; the code and the exactness check against brute force hold it. Together, blocking by segment never drops a feasible pair. With the standing window (`lawWindowComplete`), the walked ranges hold every partner that can have a pair value.

A pack gives segments only as a superset of its own pair rules. If a segment refuses a pair that the pack rules admit, the gate refuses the pair, and the search and the brute-force oracle agree, so the exactness check cannot see it. The matching block therefore counts each pair that the segment check refuses and the pack rules admit, and requires none.

```quint
pure def segmentPairAllowed(reachesOther: bool, otherReaches: bool): bool = reachesOther and otherReaches

pure def lawSegmentBlockingComplete(reachesOther: bool, otherReaches: bool): bool =
  segmentPairAllowed(reachesOther, otherReaches) implies reachesOther
```

### A bound is never below the value of the pair it covers

The shell bounds the value of each candidate before it checks the candidate. For a candidate it touched, it knows both tag sets, both standings and both exchanges, so it computes the lane pair value with each utility replaced by an upper bound: the tag terms and the closeness are exact, and only the pack term, which the shell does not read before a check, counts at full value. The pair gate (minors, blocks, holds) can only lower a value to `noPairValue`. A higher utility never lowers the pair value: the floors are the only admission conditions that read a utility, and the harmonic value does not decrease when either utility increases. So the bound is never below the pair value (`lawCandidateBoundSound`).

For a candidate it did not touch, the shell knows only upper bounds of the two utilities and the two exchanges. When a bound is below a required floor, no such pair has a value. Otherwise the harmonic mean of the utility bounds covers the pair because the standing penalty is nonnegative (`lawUnseenBoundSound`). The common bound remains sound when the shell can supply a higher lower bound on the penalty (`lawBucketBoundSound`).

```quint
pure def bucketValueBound(utilityBound: int, otherUtilityBound: int, leastPenalty: int): int =
  val bound = harmonicValue(utilityBound, otherUtilityBound) - leastPenalty
  if (bound > 0) bound else 0

pure def lawBucketBoundSound(utility: int, otherUtility: int, penalty: int, utilityBound: int, otherUtilityBound: int, leastPenalty: int): bool =
  val penalised = harmonicValue(utility, otherUtility) - penalty
  val pairWorth = if (penalised > 0) penalised else 0
  and { utility <= utilityBound, otherUtility <= otherUtilityBound, penalty >= leastPenalty, leastPenalty >= 0 }
    implies pairWorth <= bucketValueBound(utilityBound, otherUtilityBound, leastPenalty)

pure def unseenValueBound(utilityBound: int, otherUtilityBound: int, exchangeBound: int, otherExchangeBound: int, rules: PairRules): int =
  val belowFloor = utilityBound < rules.utilityFloor or otherUtilityBound < rules.utilityFloor
  val belowExchangeFloor = rules.balanceRequired and (exchangeBound < rules.exchangeFloor or otherExchangeBound < rules.exchangeFloor)
  if (belowFloor or belowExchangeFloor) noPairValue
  else bucketValueBound(utilityBound, otherUtilityBound, 0)

pure val utilityBoundValues = Set(0, 299, 350, 800, 1000)
pure val otherUtilityBoundValues = Set(0, 350, 600, 1000)
pure val exchangeBoundValues = Set(0, 199, 500, 1000)
pure val otherExchangeBoundValues = Set(0, 200, 1000)

pure def lawCandidateBoundSound(side: PairSide, other: PairSide, offset: int, rules: PairRules, utilityBound: int, otherUtilityBound: int): bool =
  (side.utility <= utilityBound and other.utility <= otherUtilityBound) implies
    pairValue(side, other, offset, rules)
      <= pairValue({ ...side, utility: utilityBound }, { ...other, utility: otherUtilityBound }, offset, rules)

pure def lawUnseenBoundSound(side: PairSide, other: PairSide, offset: int, rules: PairRules, utilityBound: int, otherUtilityBound: int, exchangeBound: int, otherExchangeBound: int): bool =
  and {
    side.utility <= utilityBound, other.utility <= otherUtilityBound,
    side.exchange <= exchangeBound, other.exchange <= otherExchangeBound,
  } implies pairValue(side, other, offset, rules) <= unseenValueBound(utilityBound, otherUtilityBound, exchangeBound, otherExchangeBound, rules)
```

### The posting walk covers or bounds every partner in the window

The shell walks the nonempty posting ranges of shared interests and of each side's seeks against the other side's offers. The range of one tag is the part of its posting inside the walked window ranges. It starts with the shortest range. An untouched partner can only share tags from ranges that remain open. An unfinished range stays open when the walk stops partway through it.

The upper bound counts only the utility terms the pack provides. The open ranges bound the searcher's affinity and complement hit counts. For the other direction the bound allows full coverage while a relevant range is open. Closeness and custom pack value count at their maximum when present. If the bound still allows an untagged pair after the tag ranges are exhausted, the shell can walk the whole window: the standing window inside each segment the member reaches. When the next tag range is at least as long as the whole window, the shell walks the whole window in its place: that costs no more touches and leaves no partner untouched. The lane floors apply as specified.

Each visited posting or whole-window entry costs one touch, including a repeated visit to the same candidate. The shell visits an entry only while `searchMayTouch` holds: it stops visiting entries when their count reaches `searchTouchesPerCheck` times the lane's search budget. The search can still check candidates it has already touched.

```quint
pure val searchTouchesPerCheck: int = 8

pure def searchMayTouch(touches: int, budget: int): bool = touches < searchTouchesPerCheck * budget

pure def lawSearchTouchesStayWithinLimit(touches: int, budget: int): bool =
  searchMayTouch(touches, budget) implies touches + 1 <= searchTouchesPerCheck * budget
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

The shell checks the touched candidates in the order of their bounds, highest first, and then ordinal, lowest first. It passes as `unseenBound` the higher of the next touched candidate's bound and the bound of the candidates it did not touch, or `noPairValue` when no candidate is left that can have a value. The search is exact when nothing is unseen, or when the kept list is full and every kept value is above the unseen bound.

The walked segment ranges contain every partner the gate can admit (`lawSegmentBlockingComplete`), and the standing window contains every feasible partner (`lawWindowComplete`). The largest pending bound covers all touched candidates, and the untouched bound covers any remaining candidate in the window (`lawCandidateBoundSound`, `lawUnseenBoundSound`). Kept candidates rank above dropped candidates by value and then ordinal (`alwaysKeptRankAboveDropped`). An exact search closes only when no unchecked candidate can enter (`alwaysExactBeatsUnseen`). It returns the first `limit` feasible partners by descending value and ascending ordinal, or every feasible partner when fewer than `limit` exist.

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

### A search that spends its budget or its posting walk before it is exact reports the value it may have missed

A search that cannot stop exactly closes as Budgeted when it reaches its check budget, or when the shell has spent its posting walk (`walkSpent`) and has no touched candidate left to check. Its kept list is the best among the checked candidates, and no candidate it did not check has a pair value above `unseenBound`. The engine records the search, its bound, and an empty or Budgeted result as the reason of [Story F21](product/stories.md#story-f21--hear-when-nothing-fits). It never fills the gap with a pair that has no pair value. A closed search does not change.

One search makes at most `budget` pair checks (`alwaysChecksWithinBudget`). In addition to the touch limit, the shell locates its posting ranges with binary searches, sorts those ranges by length, and ranks each touched candidate at most once in a heap.

```quint
pure def canCloseBudgeted(s: CandidateSearch, unseenBound: int, walkSpent: bool, touchedLeft: bool): bool =
  s.phase == Scanning and (s.checks >= s.budget or (walkSpent and not(touchedLeft))) and not(searchStopsExact(s, unseenBound))

pure def closeBudgeted(s: CandidateSearch, unseenBound: int, walkSpent: bool, touchedLeft: bool): CandidateSearch =
  { ...s, phase: Budgeted, unseenBound: unseenBound }

pure def stepClosedSearchStaysClosed(before: CandidateSearch, after: CandidateSearch): bool =
  (before.phase == Exact or before.phase == Budgeted) implies after == before

pure def sometimesBudgeted(s: CandidateSearch): bool = s.phase == Budgeted
```
