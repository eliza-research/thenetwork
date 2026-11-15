# Group formation

The [candidate pool model](models/candidate_pool.md) follows groups into the Network service. This state machine governs the engine's group composer. The shell supplies ages, pair compatibility, presence overlap, scores, and the ranked order from the beam search. It keeps the numerical score calculations and the final role assignment.

## Story: Form a compatible group and keep eligible backups

> As a member, I want a group that fits the activity and location, with compatible alternates if a place opens.

### Only eligible adults enter the group search

A forced participant who fails the adult check makes the whole request ineligible. Other candidates who fail it stay outside the search. A candidate already in the partial group, or incompatible with any of its members, cannot extend that group.

```quint
type FormationPhase = AwaitingPool | Forming | PrimaryChosen | RankingAlternates | Finished

type Formation = {
  phase: FormationPhase, hostRequired: bool, primary: List[str], alternates: List[str], alternateLimit: int,
}

pure val initial: Formation = {
  phase: AwaitingPool, hostRequired: false, primary: List(), alternates: List(), alternateLimit: 0,
}

pure def canStartSearch(g: Formation, forcedEligible: bool): bool = g.phase == AwaitingPool and forcedEligible
pure def startSearch(g: Formation, forcedEligible: bool, hostRequired: bool): Formation =
  { ...g, phase: Forming, hostRequired: hostRequired }

pure def poolEligible(adult: bool): bool = adult
pure def extensionAllowed(alreadyIncluded: bool, compatible: bool): bool = not(alreadyIncluded) and compatible
```

### A primary group has a common place and meets its requirements

The scoring shell checks whether the participants have a common city in their windows and whether it is the required city, if one was set. The search keeps groups whose members meet the minimum pairwise fit. A final primary group must meet the configured minimum size. If a host is required, it must contain a host. A configured maximum bounds beam expansion.

```quint
pure def groupLocationAllowed(hasOverlap: bool, requiresCity: bool, matchingCity: bool): bool =
  hasOverlap and (not(requiresCity) or matchingCity)

pure def groupFitAllowed(hasPairs: bool, belowPairFloor: bool): bool =
  not(hasPairs) or not(belowPairFloor)

pure def primaryAllowed(g: Formation, meetsMinimum: bool, hasHost: bool): bool =
  g.phase == Forming and meetsMinimum and (not(g.hostRequired) or hasHost)

pure def canChoosePrimary(g: Formation, members: List[str], meetsMinimum: bool, hasHost: bool): bool =
  members.length() > 0 and primaryAllowed(g, meetsMinimum, hasHost)

pure def choosePrimary(g: Formation, members: List[str], meetsMinimum: bool, hasHost: bool): Formation =
  { ...g, phase: PrimaryChosen, primary: members }

pure def alwaysPrimaryRequiredAfterSearch(g: Formation): bool =
  (g.phase == PrimaryChosen or g.phase == RankingAlternates or g.phase == Finished) implies g.primary.length() > 0
```

### An alternate can join the primary group in its city

An alternate must be outside the primary group, compatible with each primary participant, and available in the group's city. The shell ranks the eligible rows before it supplies them for reservation. The engine checks an alternate against the primary group. The service applies its own checks across alternates before using them.

```quint
pure def alternateAllowed(alreadyPrimary: bool, compatible: bool, sameCityOverlap: bool): bool =
  not(alreadyPrimary) and compatible and sameCityOverlap

pure def canOpenAlternates(g: Formation, alternateLimit: int): bool =
  g.phase == PrimaryChosen and alternateLimit >= 0

pure def openAlternates(g: Formation, alternateLimit: int): Formation =
  { ...g, phase: RankingAlternates, alternateLimit: alternateLimit }

pure def canReserveAlternate(g: Formation, member: str): bool =
  g.phase == RankingAlternates and g.alternates.length() < g.alternateLimit and not(g.primary.includes(member))

pure def reserveAlternate(g: Formation, member: str): Formation =
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
