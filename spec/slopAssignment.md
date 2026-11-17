# Slop assignment rounds

The [matching engine model](models/matching_engine.md) follows the Slop assignment path through the service. This machine controls the rounds and reservations in `packages/engine/src/packs/slop/assign.ts`. The shell supplies eligible, ranked pairs. It checks exclusions, open opportunities and minimum value, calculates each member’s degree, and orders the edges: pairs whose scarcer member has few searched partners first, then the highest value. Round 1 opens with the exposure floor (`packages/engine/src/policy.ts` `exposureFloor`, the same floor as the [global selection spec](selectionRun.md)): each floor member, highest carried exposure debt first, reserves their best edge that fits, until the floor cap is reached. Then one greedy walk over the ordered edges runs in each round. Every reservation, the floor ones included, goes through `canReservePair` and `reservePair` of this machine. The floor order and the floor cap are shell decisions outside this machine. The machine only checks that each reservation is allowed.

## Story: Assign a date proposal without filling a member’s inbox

> As a slop.date member, I want to receive a limited number of proposals from the compatible pool, with a backup round available for people with few options.

### Assignment opens each configured round once in order

Each run starts with no reservations. The shell gives the machine the number of rounds and the number that can use any eligible pair. Rounds beyond the base allocation can select only a pair with at least one member at or below the configured degree limit. An empty round still advances. The shell converts the existing numeric configuration to whole-round inputs and bounds them by the number of candidate pairs.

```quint
type AssignmentPhase = NotConfigured | BetweenRounds | InRound | Finished
type AssignmentRun = {
  phase: AssignmentPhase, round: int, totalRounds: int, baseRounds: int,
  proposed: int, usedPairs: str -> bool, usedInRound: str -> bool, memberCounts: str -> int,
}

pure val initial: AssignmentRun = {
  phase: NotConfigured, round: 0, totalRounds: 0, baseRounds: 0,
  proposed: 0, usedPairs: Map(), usedInRound: Map(), memberCounts: Map(),
}

pure def canConfigureAssignment(s: AssignmentRun, totalRounds: int, baseRounds: int): bool =
  s.phase == NotConfigured and totalRounds >= 0 and baseRounds >= 0 and baseRounds <= totalRounds

pure def configureAssignment(s: AssignmentRun, totalRounds: int, baseRounds: int): AssignmentRun =
  { ...s, totalRounds: totalRounds, baseRounds: baseRounds,
    phase: if (totalRounds == 0) Finished else BetweenRounds }

pure def canOpenRound(s: AssignmentRun): bool = s.phase == BetweenRounds and s.round < s.totalRounds
pure def openRound(s: AssignmentRun): AssignmentRun =
  { ...s, phase: InRound, round: s.round + 1, usedInRound: Map() }

pure def canCloseRound(s: AssignmentRun): bool = s.phase == InRound
pure def closeRound(s: AssignmentRun): AssignmentRun =
  { ...s, phase: if (s.round == s.totalRounds) Finished else BetweenRounds }

pure def alwaysRoundWithinAllocation(s: AssignmentRun): bool = and {
  s.round >= 0, s.round <= s.totalRounds, s.baseRounds >= 0, s.baseRounds <= s.totalRounds,
  s.phase == NotConfigured implies s.round == 0,
  s.phase == BetweenRounds implies s.round < s.totalRounds,
  s.phase == InRound implies s.round > 0,
  s.phase == Finished implies s.round == s.totalRounds,
}

pure def stepOnlyOpeningAdvancesRound(before: AssignmentRun, via: str, after: AssignmentRun): bool =
  if (via == "openRound") after.round == before.round + 1 else after.round == before.round
```

### Each pair can be reserved once and each member can participate once per round

A reservation requires an open round, an unused pair, and room for both members. Neither member may already have a reservation in the round. The selector checks both the primary and backup rounds with the same reservation transition. The shell supplies a canonical pair key and whether the pair meets the backup degree limit.

```quint
pure def isMarked(flags: str -> bool, key: str): bool =
  flags.getOr(key, false)

pure def memberCount(counts: str -> int, member: str): int =
  counts.getOr(member, 0)

pure def canReservePair(s: AssignmentRun, pairKey: str, memberA: str, memberB: str, withinBackupDegree: bool): bool = and {
  s.phase == InRound,
  not(isMarked(s.usedPairs, pairKey)),
  not(isMarked(s.usedInRound, memberA)), not(isMarked(s.usedInRound, memberB)),
  memberCount(s.memberCounts, memberA) < s.round, memberCount(s.memberCounts, memberB) < s.round,
  s.round <= s.baseRounds or withinBackupDegree,
}

pure def incrementMember(counts: str -> int, member: str): str -> int =
  counts.put(member, memberCount(counts, member) + 1)

pure def reservePair(s: AssignmentRun, pairKey: str, memberA: str, memberB: str, withinBackupDegree: bool): AssignmentRun =
  val withFirst = incrementMember(s.memberCounts, memberA)
  { ...s, proposed: s.proposed + 1, usedPairs: s.usedPairs.put(pairKey, true),
    usedInRound: s.usedInRound.put(memberA, true).put(memberB, true),
    memberCounts: incrementMember(withFirst, memberB) }

pure def alwaysProposalCountIsNonnegative(s: AssignmentRun): bool = s.proposed >= 0

pure def stepOnlyReservationCountsProposal(before: AssignmentRun, via: str, after: AssignmentRun): bool =
  if (via == "reservePair") after.proposed == before.proposed + 1 else after.proposed == before.proposed

pure def stepFinishedStaysFinished(before: AssignmentRun, after: AssignmentRun): bool =
  before.phase == Finished implies after.phase == Finished

pure def sometimesAssigned(s: AssignmentRun): bool = s.proposed > 0
pure def sometimesBackupRound(s: AssignmentRun): bool = s.phase == InRound and s.round > s.baseRounds
```

## Story: Measure how many Slop members scammers reach

> As a pilot reviewer, I want the scammer reach gate to measure distinct real members exposed by a reveal.

### Count each real recipient once after a reveal

For each simulated scammer, count distinct real recipients whose identities became known at reveal. A probe, another synthetic adversary, or another reveal of the same recipient adds no reach. Keep scammers with no reveals in the cohort. Use simulator truth only in the report.

```quint
pure def slopScammerContactCounts(revealed: bool, realRecipient: bool): bool =
  revealed and realRecipient
```

### An even cohort averages its two middle reach counts

Sort the reach counts. The median uses the middle count for an odd cohort and the arithmetic mean of both middle counts for an even cohort. An empty cohort reports zero. Return twice the median so the integer model preserves half-unit values. The existing pilot gate compares the mean of the per-seed medians with its maximum of one.

```quint
pure def slopScammerMedianReachTwice(orderedReach: List[int]): int =
  val count = orderedReach.length()
  if (count == 0) 0 else orderedReach.nthOr((count - 1) / 2, 0) + orderedReach.nthOr(count / 2, 0)

pure def lawSlopSingleScammerKeepsReach(contactCount: int): bool =
  slopScammerMedianReachTwice(List(contactCount)) == 2 * contactCount
```
