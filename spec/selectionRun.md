# Global proposal selection

The default selector in `packages/engine/src/policy.ts` uses this state machine for each run. The [matching engine model](models/matching_engine.md) covers the engine and service together. This machine reserves one proposal at a time after the engine builds and ranks eligible candidates. The shell supplies member history, budget limits, open opportunities, ask exclusions, conflicts with fixed windows, the app pack's refusals, and the integer value of each greedy choice. The shell orders the greedy choices once by value. It keeps the pack hooks, scores, seeded draws, and proposal payloads. The selected proposals become the introductions of [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction).

## Story: Select compatible proposals within the run’s limits

> As a member, I want a fair chance to receive a suitable proposal within my participation limits.

### Exposure selection precedes exploration and greedy selection

The selector first reserves exposure for members the policy prioritizes. It then draws its exploration slice before filling remaining slots greedily. Each pass can be empty. Exploration reservations belong to the exploration pass. A completed run cannot reserve another proposal. The run also keeps the greedy value bound and the greedy refusals. The bound starts above every value the shell uses.

```quint
type SelectionPhase = Exposure | Exploration | Greedy | Complete
type SelectionMember = {
  id: str, unavailable: bool,
  priorProactive: int, proactiveLimit: int,
  contributor: bool, priorContribution: int, contributionLimit: int,
}
type SelectionRefusal = { member: SelectionMember, proactiveAtRefusal: int, contributionAtRefusal: int }
type SelectionRun = {
  phase: SelectionPhase, selectedCount: int,
  selectedKeys: str -> bool, usedPairs: str -> bool,
  byCity: str -> int, proactive: str -> int, contribution: str -> int,
  greedyBound: int, refusals: List[SelectionRefusal],
}

pure val selectionGreedyBoundStart: int = 1000000000

pure val initial: SelectionRun = {
  phase: Exposure, selectedCount: 0, selectedKeys: Map(), usedPairs: Map(),
  byCity: Map(), proactive: Map(), contribution: Map(),
  greedyBound: selectionGreedyBoundStart, refusals: List(),
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

### Greedy decisions never rise in value

The greedy pass takes the remaining choices once, from the highest value to the lowest, with ties in candidate key order. Each greedy reservation and each greedy refusal carries the choice's value. The value must not be above the last greedy value, and the decision lowers the bound to it. Exposure and exploration reservations carry no value in this order and do not change the bound. A shell that changes values during the pass, for example with a load penalty, cannot reserve a choice above an earlier one.

```quint
pure val valueValues = Set(-1, 0, 400, 900)

pure def selectionValueInOrder(s: SelectionRun, value: int): bool =
  s.phase != Greedy or value <= s.greedyBound

pure def stepGreedyValuesNeverRise(before: SelectionRun, after: SelectionRun): bool =
  after.greedyBound <= before.greedyBound

pure def sometimesGreedyBoundLowered(s: SelectionRun): bool =
  s.greedyBound < selectionGreedyBoundStart
```

### Each reservation checks the city, pair, and member limits

A run can reserve each candidate key and each participant pair once. The city must have capacity. Each participant must be available to receive a proposal. Adding one invitation must fit the member’s proactive budget, including planned asks. A contributor also needs capacity in the contribution budget. The shell checks fixed windows against the prior reservations before it requests a reservation. An app pack may refuse a reservation because it has no room. Every pass, exploration included, respects that refusal. Exploration still draws among the remaining candidates with its own weights. A greedy reservation must also keep the value order. A member named in a greedy refusal gets no later reservation in the run, whatever limits a later choice carries for that member.

```quint
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
  { candidateKey: "e", city: "LA", cityLimit: 1,
    members: List(
      { id: "three", unavailable: false, priorProactive: 0, proactiveLimit: 2, contributor: true, priorContribution: 0, contributionLimit: 1 },
      { id: "four", unavailable: false, priorProactive: 0, proactiveLimit: 2, contributor: false, priorContribution: 0, contributionLimit: 1 }),
    pairKeys: List("three+four") },
)

pure def numberUsed(counts: str -> int, key: str): int =
  counts.getOr(key, 0)

pure def selectedBefore(s: SelectionRun, candidateKey: str): bool =
  s.selectedKeys.getOr(candidateKey, false)

pure def pairAlreadyUsed(s: SelectionRun, pair: str): bool =
  s.usedPairs.getOr(pair, false)

pure def proactiveUsed(s: SelectionRun, id: str): int = numberUsed(s.proactive, id)

pure def memberHasRoom(s: SelectionRun, m: SelectionMember): bool =
  not(m.unavailable)
    and not(m.priorProactive + proactiveUsed(s, m.id) + 1 > m.proactiveLimit)
    and (not(m.contributor) or not(m.priorContribution + numberUsed(s.contribution, m.id) + 1 > m.contributionLimit))

pure def selectionMemberRefused(s: SelectionRun, id: str): bool =
  s.refusals.some(r => r.member.id == id)

pure def choiceHasRoom(s: SelectionRun, choice: SelectionChoice): bool =
  s.phase != Complete and not(selectedBefore(s, choice.candidateKey))
    and not(numberUsed(s.byCity, choice.city) >= choice.cityLimit)
    and choice.members.every(m => memberHasRoom(s, m) and not(selectionMemberRefused(s, m.id)))
    and choice.pairKeys.every(pair => not(pairAlreadyUsed(s, pair)))

pure def canReserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: bool, exploring: bool, packAllows: bool, value: int): bool =
  packAllows and timeFree and (exploring iff s.phase == Exploration)
    and selectionValueInOrder(s, value) and choiceHasRoom(s, choice)
```

### Reserving a proposal consumes its slots together

A reservation records the candidate and its participant pairs, consumes one slot in its city, and increments use for its participants. Each contribution reservation also increments the contributor’s use. A greedy reservation lowers the greedy bound to its value. The selection shell records the proposal payload after the reservation and applies the same fixed-window commitment to each participant.

```quint
pure def addUse(counts: str -> int, key: str): str -> int =
  counts.put(key, numberUsed(counts, key) + 1)

pure def reserveSelection(s: SelectionRun, choice: SelectionChoice, timeFree: bool, exploring: bool, packAllows: bool, value: int): SelectionRun =
  val newPairs = choice.pairKeys.foldl(s.usedPairs, (pairs, pair) => pairs.put(pair, true))
  val newProactive = choice.members.foldl(s.proactive, (counts, m) => addUse(counts, m.id))
  val newContribution = choice.members.foldl(s.contribution, (counts, m) =>
    if (m.contributor) addUse(counts, m.id) else counts)
  val newBound = if (s.phase == Greedy) value else s.greedyBound
  { ...s, selectedCount: s.selectedCount + 1,
    selectedKeys: s.selectedKeys.put(choice.candidateKey, true), usedPairs: newPairs,
    byCity: addUse(s.byCity, choice.city), proactive: newProactive, contribution: newContribution,
    greedyBound: newBound }

pure def alwaysSelectedCountIsNonnegative(s: SelectionRun): bool = s.selectedCount >= 0

pure def stepOnlyReserveIncreasesSelections(before: SelectionRun, via: str, after: SelectionRun): bool =
  if (via == "reserveSelection") after.selectedCount == before.selectedCount + 1
  else after.selectedCount == before.selectedCount

pure def sometimesSelected(s: SelectionRun): bool = s.selectedCount > 0
pure def sometimesFinishedWithSelection(s: SelectionRun): bool = s.phase == Complete and s.selectedCount > 0
```

### A greedy refusal names a member who stays without room

When a greedy choice fails only because a participant has no room, the shell records a refusal with the choice's value and that participant. The participant must be in the choice and must have no room now. The refusal keeps the member's limits and the member's use in this run at the time of the refusal, and it lowers the greedy bound to the value. Use in a run never decreases, so a member who had no room at a refusal still has no room later. The reservation guard also refuses every later choice that includes a member with the refused id, so the use of that member does not change after the refusal, even when a later choice carries other limits for the same id.

This gives the greedy stability claim. Take a refused greedy choice with value v and its blocked member m. Every reservation that used the room of m came before the refusal. Each of those made in the greedy pass had a value of at least v, because greedy values never rise. So m holds no greedy reservation worse than the refused choice, and the refused choice does not block the greedy selection through m. With one value for both sides of a pair, this is stability for that shared value, not for each member's own ranking.

The claim has limits. It covers only choices that the shell refuses through this transition. A choice skipped for its city limit, a used pair, a fixed time window, a pack refusal, or a score below its threshold (the shell checks the score) is outside it. Exposure and exploration reservations carry no value in the greedy order, so a member that they filled can hold a reservation worth less than a refused greedy choice. Prior proactive and contribution use from the shell counts as room already used.

```quint
pure val blockedMemberValues = Set(
  { id: "one", unavailable: false, priorProactive: 0, proactiveLimit: 1, contributor: true, priorContribution: 0, contributionLimit: 1 },
  { id: "one", unavailable: false, priorProactive: 0, proactiveLimit: 1, contributor: false, priorContribution: 0, contributionLimit: 1 },
  { id: "two", unavailable: true, priorProactive: 0, proactiveLimit: 2, contributor: true, priorContribution: 0, contributionLimit: 2 },
  { id: "three", unavailable: false, priorProactive: 0, proactiveLimit: 2, contributor: true, priorContribution: 0, contributionLimit: 1 },
)

pure def selectionMemberFullAt(m: SelectionMember, proactive: int, contribution: int): bool =
  m.unavailable or m.priorProactive + proactive + 1 > m.proactiveLimit
    or (m.contributor and m.priorContribution + contribution + 1 > m.contributionLimit)

pure def selectionChoiceHasMember(choice: SelectionChoice, m: SelectionMember): bool =
  choice.members.some(x => x.id == m.id and x.unavailable == m.unavailable
    and x.priorProactive == m.priorProactive and x.proactiveLimit == m.proactiveLimit
    and x.contributor == m.contributor and x.priorContribution == m.priorContribution
    and x.contributionLimit == m.contributionLimit)

pure def canRefuseSelection(s: SelectionRun, choice: SelectionChoice, value: int, blockedMember: SelectionMember): bool =
  s.phase == Greedy and value <= s.greedyBound and not(selectedBefore(s, choice.candidateKey))
    and selectionChoiceHasMember(choice, blockedMember) and not(memberHasRoom(s, blockedMember))

pure def refuseSelection(s: SelectionRun, choice: SelectionChoice, value: int, blockedMember: SelectionMember): SelectionRun =
  val refusal = {
    member: blockedMember,
    proactiveAtRefusal: proactiveUsed(s, blockedMember.id),
    contributionAtRefusal: numberUsed(s.contribution, blockedMember.id),
  }
  { ...s, greedyBound: value, refusals: s.refusals.append(refusal) }

pure def lawSelectionFullMemberStaysFull(blockedMember: SelectionMember, proactive: int, contribution: int, laterProactive: int, laterContribution: int): bool =
  (selectionMemberFullAt(blockedMember, proactive, contribution)
    and proactive <= laterProactive and contribution <= laterContribution)
    implies selectionMemberFullAt(blockedMember, laterProactive, laterContribution)

pure def alwaysRefusedMemberStaysFull(s: SelectionRun): bool =
  s.refusals.every(r => selectionMemberFullAt(r.member, r.proactiveAtRefusal, r.contributionAtRefusal)
    and r.proactiveAtRefusal <= proactiveUsed(s, r.member.id)
    and r.contributionAtRefusal <= numberUsed(s.contribution, r.member.id)
    and selectionMemberFullAt(r.member, proactiveUsed(s, r.member.id), numberUsed(s.contribution, r.member.id)))

pure def stepRefusedMemberGetsNoReservation(before: SelectionRun, after: SelectionRun): bool =
  before.refusals.every(r => proactiveUsed(after, r.member.id) == proactiveUsed(before, r.member.id)
    and numberUsed(after.contribution, r.member.id) == numberUsed(before.contribution, r.member.id))

pure def sometimesRefusedAfterReservation(s: SelectionRun): bool =
  s.refusals.some(r => r.proactiveAtRefusal > 0)
```
