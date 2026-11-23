# Candidate hard screening

The [matching engine](models/matching_engine.md) and [candidate pool](models/candidate_pool.md) models follow matching from retrieval to proposal. This machine screens one candidate before scoring. The engine supplies evidence from the current world, calls pack rules, and constructs the meeting window. Each call occurs only when the machine requests its stage.

## Story: Refuse an ineligible match before scoring it

> As a member, I want the engine to consider only proposals that pass eligibility, consent, safety, and shared availability checks.

### Hard checks run in a fixed order

First check for duplicate participants, then apply the pack’s preliminary rules. Check for minors in every role and then check the intermediary. Check each member and each pair in their existing order. Apply the pack’s final rules before resolving presence. Only a candidate that passes each stage reaches scoring. The shell passes the first refusal from each stage, or the empty string when that stage passes.

```quint
type CheckPhase = Duplicates | PackPre | Age | Intermediary | Members | Pairs | PackPost | Presence | Passed | Refused

type Screening = { phase: CheckPhase, refusal: str }

pure val initial: Screening = { phase: Duplicates, refusal: "" }

pure def nextPhase(phase: CheckPhase): CheckPhase =
  if (phase == Duplicates) PackPre
  else if (phase == PackPre) Age
  else if (phase == Age) Intermediary
  else if (phase == Intermediary) Members
  else if (phase == Members) Pairs
  else if (phase == Pairs) PackPost
  else if (phase == PackPost) Presence
  else Passed

pure def canRecordCheck(s: Screening, checked: CheckPhase): bool =
  s.phase == checked and s.phase != Passed and s.phase != Refused

pure def recordCheck(s: Screening, checked: CheckPhase, reason: str): Screening =
  if (reason == "") { phase: nextPhase(s.phase), refusal: "" }
  else { phase: Refused, refusal: reason }
```

### The first refusal ends screening

A refused candidate keeps its original reason. A completed screen cannot advance or change its outcome. The successful path reaches presence first.

```quint
pure def alwaysRefusalHasReason(s: Screening): bool = (s.phase == Refused) iff s.refusal != ""

pure def stepCompletedScreenStaysClosed(before: Screening, after: Screening): bool =
  (before.phase == Refused or before.phase == Passed) implies (after.phase == before.phase and after.refusal == before.refusal)

pure def stepPassedRequiresPresence(before: Screening, after: Screening): bool =
  (after.phase == Passed and before.phase != Passed) implies before.phase == Presence

pure def sometimesPassed(s: Screening): bool = s.phase == Passed
pure def sometimesRefused(s: Screening): bool = s.phase == Refused
```

### Every retained alternate passes the same safety floor

An alternate must exist and have no active safety hold. Keep the lane's
pair checks for the primary participants and the alternatives. The final
judge checks every person named in any role for age, holds, and blocks.
Its positive answer cannot restore an unsafe alternative.

```quint
pure def candidateBackfillAllowed(known: bool, held: bool): bool =
  known and not(held)

pure def lawCandidateBackfillNeedsAvailableMember(known: bool, held: bool): bool =
  candidateBackfillAllowed(known, held) implies known and not(held)
```
