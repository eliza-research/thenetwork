# Global proposal selection

The default selector in `packages/engine/src/policy.ts` uses this state machine for each run. The [matching engine model](models/matching_engine.md) covers the engine and service together. This machine reserves one proposal at a time after the engine builds and ranks eligible candidates. The shell supplies member history, budget limits, open opportunities, ask exclusions, and conflicts with fixed windows. It keeps the pack hooks, scores, seeded draws, and proposal payloads.

## Story: Select compatible proposals within the run’s limits

> As a member, I want a fair chance to receive a suitable proposal within my participation limits.

### Exposure selection precedes exploration and greedy selection

The selector first reserves exposure for members the policy prioritizes. It then draws its exploration slice before filling remaining slots greedily. Each pass can be empty. Exploration reservations belong to the exploration pass. A completed run cannot reserve another proposal.

```quint
type SelectionPhase = Exposure | Exploration | Greedy | Complete
type SelectionRun = {
  phase: SelectionPhase, selectedCount: int,
  selectedKeys: str -> bool, usedPairs: str -> bool,
  byCity: str -> int, proactive: str -> int, contribution: str -> int,
}

pure val initial: SelectionRun = {
  phase: Exposure, selectedCount: 0, selectedKeys: Map(), usedPairs: Map(),
  byCity: Map(), proactive: Map(), contribution: Map(),
}

pure def canBeginExploration(s: SelectionRun): bool = s.phase == Exposure
pure def beginExploration(s: SelectionRun): SelectionRun = { ...s, phase: Exploration }
pure def canBeginGreedy(s: SelectionRun): bool = s.phase == Exploration
pure def beginGreedy(s: SelectionRun): SelectionRun = { ...s, phase: Greedy }
pure def canCompleteRun(s: SelectionRun): bool = s.phase == Greedy
pure def completeRun(s: SelectionRun): SelectionRun = { ...s, phase: Complete }

pure def stepCompletedRunStaysClosed(before: SelectionRun, after: SelectionRun): bool =
  before.phase == Complete implies after.phase == Complete
```

### Each reservation checks the city, pair, and member limits

A run can reserve each candidate key and each participant pair once. The city must have capacity. Each participant must be available to receive a proposal. Adding one invitation must fit the member’s proactive budget, including planned asks. A contributor also needs capacity in the contribution budget. The shell checks fixed windows against the prior reservations before it requests a reservation.

```quint
type SelectionMember = {
  id: str, unavailable: bool,
  priorProactive: int, proactiveLimit: int,
  contributor: bool, priorContribution: int, contributionLimit: int,
}
type SelectionChoice = {
  candidateKey: str, city: str, cityLimit: int,
  members: List[SelectionMember], pairKeys: List[str],
}

pure val choiceValues = Set(
  { candidateKey: "a", city: "NYC", cityLimit: 2,
    members: List({ id: "one", unavailable: false, priorProactive: 0, proactiveLimit: 1, contributor: true, priorContribution: 0, contributionLimit: 1 }), pairKeys: List("one+two") },
  { candidateKey: "b", city: "NYC", cityLimit: 2,
    members: List({ id: "one", unavailable: false, priorProactive: 0, proactiveLimit: 1, contributor: false, priorContribution: 0, contributionLimit: 1 }), pairKeys: List("one+three") },
  { candidateKey: "c", city: "NYC", cityLimit: 2,
    members: List({ id: "three", unavailable: false, priorProactive: 0, proactiveLimit: 2, contributor: true, priorContribution: 0, contributionLimit: 1 }), pairKeys: List("one+two") },
  { candidateKey: "d", city: "SF", cityLimit: 1,
    members: List({ id: "two", unavailable: true, priorProactive: 0, proactiveLimit: 2, contributor: true, priorContribution: 0, contributionLimit: 2 }), pairKeys: List("two+three") },
)

pure def numberUsed(counts: str -> int, key: str): int =
  if (counts.keys().contains(key)) counts.get(key) else 0

pure def selectedBefore(s: SelectionRun, candidateKey: str): bool =
  val keyMap = s.selectedKeys
  if (keyMap.keys().contains(candidateKey)) keyMap.get(candidateKey) else false

pure def pairAlreadyUsed(s: SelectionRun, pair: str): bool =
  val keyMap = s.usedPairs
  if (keyMap.keys().contains(pair)) keyMap.get(pair) else false

pure def proactiveUsed(s: SelectionRun, id: str): int = numberUsed(s.proactive, id)

pure def memberHasRoom(s: SelectionRun, m: SelectionMember): bool =
  not(m.unavailable)
    and not(m.priorProactive + proactiveUsed(s, m.id) + 1 > m.proactiveLimit)
    and (not(m.contributor) or not(m.priorContribution + numberUsed(s.contribution, m.id) + 1 > m.contributionLimit))

pure def choiceHasRoom(s: SelectionRun, choice: SelectionChoice): bool =
  s.phase != Complete and not(selectedBefore(s, choice.candidateKey))
    and not(numberUsed(s.byCity, choice.city) >= choice.cityLimit)
    and choice.members.every(m => memberHasRoom(s, m))
    and choice.pairKeys.every(pair => not(pairAlreadyUsed(s, pair)))

pure def canReserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: bool, exploring: bool): bool =
  timeFree and (exploring iff s.phase == Exploration) and choiceHasRoom(s, choice)
```

### Reserving a proposal consumes its slots together

A reservation records the candidate and its participant pairs, consumes one slot in its city, and increments use for its participants. Each contribution reservation also increments the contributor’s use. The selection shell records the proposal payload after the reservation and applies the same fixed-window commitment to each participant.

```quint
pure def addUse(counts: str -> int, key: str): str -> int =
  counts.put(key, numberUsed(counts, key) + 1)

pure def reserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: bool, exploring: bool): SelectionRun =
  val newPairs = choice.pairKeys.foldl(s.usedPairs, (pairs, pair) => pairs.put(pair, true))
  val newProactive = choice.members.foldl(s.proactive, (counts, m) => addUse(counts, m.id))
  val newContribution = choice.members.foldl(s.contribution, (counts, m) =>
    if (m.contributor) addUse(counts, m.id) else counts)
  { ...s, selectedCount: s.selectedCount + 1,
    selectedKeys: s.selectedKeys.put(choice.candidateKey, true), usedPairs: newPairs,
    byCity: addUse(s.byCity, choice.city), proactive: newProactive, contribution: newContribution }

pure def alwaysSelectedCountIsNonnegative(s: SelectionRun): bool = s.selectedCount >= 0

pure def stepOnlyReserveIncreasesSelections(before: SelectionRun, via: str, after: SelectionRun): bool =
  if (via == "reserveSelection") after.selectedCount == before.selectedCount + 1
  else after.selectedCount == before.selectedCount

pure def sometimesSelected(s: SelectionRun): bool = s.selectedCount > 0
pure def sometimesFinishedWithSelection(s: SelectionRun): bool = s.phase == Complete and s.selectedCount > 0
```
