# Private member standing

This library estimates a member's private standing in one [relationship lane](matchLane.md) and the uncertainty of that estimate. The matching engine uses both numbers for pair parity, as the [matching engine model](models/matching_engine.md) and the [candidate pool model](models/candidate_pool.md) describe. The pack shell supplies the evidence points for each lane, the count of reviewed facts, the private Clef rating for the Date lane, and the adult and consent facts. The current engine computes standing from each matching snapshot. The weekly step below defines the planned rule for a shell that stores the standing and weekly update time per lane membership.

Standing is private. It is never shown to any member, and it never appears in an explanation, a member-facing message, relay text, or an export to a member. The leak guard checks every member-facing text. For the Date lane, the standing comes from the private photo rating of [Story F31](product/stories.md#story-f31--add-my-adult-dating-photos-privately) and the [photo rating attempt](photoRating.md). For the Hire lane of [Story F33](product/stories.md#story-f33--choose-a-hiring-introduction), the evidence is role level and track record only. Protected traits and their proxies are never evidence. The [weekly bias report](weeklyBias.md) watches outcomes by rating group.

Acceptance counts, reply counts, likes, and any other popularity count are never inputs to standing. A standing that reads popularity makes a feedback loop: exposure brings acceptances, acceptances raise standing, and standing brings more exposure.

## Story: Estimate standing from facts, never from popularity

> As a member, I want the service to place me near people of similar standing from facts about me, not from how many people said yes to me.

### Standing exists only for an adult who consented to the lane

A minor has no standing in any lane, so no parity check can use one. A member who did not consent to the lane has no standing in it. The shell checks this before it reads any evidence or rating.

```quint
import matchLane as Lane from "./matchLane"

pure def standingReadable(adult: bool, consented: bool): bool = adult and consented
```

### Ordinary standing evidence uses the member's current matching scope

The Network reads fresh, explicitly lane-tagged ordinary facts from the current app. The member can permit matching with matchable or shareable scope. A connected source needs confirmation by the member. Sensitive or inferred facts have no standing effect. Scope and corrections take effect in the next matching snapshot. The computed standing stays private.

```quint
pure def standingFacetReadable(scope: str, provenance: str, confirmed: bool, sensitive: bool, inferred: bool): bool =
  (scope == "matchable" or scope == "shareable") and not(sensitive) and not(inferred) and
  (provenance == "said" or provenance == "vouched" or (provenance == "connected_source" and confirmed))

pure val standingFacetScopes = Set("agent_private", "opportunity_specific", "matchable", "shareable")
pure val standingFacetProvenances = Set("said", "vouched", "connected_source", "inferred")

pure def lawStandingFacetNeedsMatchingPermission(scope: str, provenance: str, confirmed: bool, sensitive: bool, inferred: bool): bool =
  standingFacetReadable(scope, provenance, confirmed, sensitive, inferred) implies
    ((scope == "matchable" or scope == "shareable") and not(sensitive) and not(inferred) and
      (provenance != "connected_source" or confirmed))
```

### Standing adds reviewed facts in full and unreviewed facts at half

Each evidence item gives points. A negative item counts as zero, so no single fact can push a member down. One item counts at most the standing ceiling. A fact that staff or a trusted source reviewed counts in full. A fact that only the member stated counts at fifty percent, which limits inflated claims. The total is clamped to the standing range. Because no item subtracts, a new fact never lowers the standing.

```quint
type StandingEvidence = { points: int, reviewed: bool }

pure val standingUnreviewedPercent: int = 50

pure def standingClamp(value: int): int =
  if (value < 0) 0 else if (value > Lane::standingCeiling) Lane::standingCeiling else value

pure def standingEvidencePoints(fact: StandingEvidence): int =
  val capped = standingClamp(fact.points)
  if (fact.reviewed) capped else capped * standingUnreviewedPercent / 100

pure def standingFromEvidence(evidence: List[StandingEvidence]): int =
  standingClamp(evidence.foldl(0, (total, fact) => total + standingEvidencePoints(fact)))

pure val extraValues = Set(
  { points: -1, reviewed: true }, { points: 0, reviewed: false }, { points: 7, reviewed: false },
  { points: 40, reviewed: true }, { points: 101, reviewed: true })
pure val evidenceValues = Set(
  List(), List({ points: -5, reviewed: true }), List({ points: 60, reviewed: true }, { points: 30, reviewed: false }),
  List({ points: 100, reviewed: true }, { points: 1, reviewed: false }))

pure def lawStandingMonotoneInEvidence(evidence: List[StandingEvidence], extra: StandingEvidence): bool =
  standingFromEvidence(evidence.append(extra)) >= standingFromEvidence(evidence)
```

### A private photo rating maps onto the standing scale for dating

The Date lane uses the overall Clef rating in permille. The rating is clamped to 0 through 1000 and scaled to the standing range. Every standing estimate stays in the standing range.

```quint
pure val standingRatingScale: int = 1000

pure def standingFromRating(ratingPermille: int): int =
  val rating = if (ratingPermille < 0) 0 else if (ratingPermille > standingRatingScale) standingRatingScale else ratingPermille
  if (standingRatingScale > 0) rating * Lane::standingCeiling / standingRatingScale else 0

pure val ratingPermilleValues = Set(-1, 0, 9, 10, 500, 999, 1000, 1001)

pure def lawStandingBounded(evidence: List[StandingEvidence], ratingPermille: int): bool =
  val fromFacts = standingFromEvidence(evidence)
  val fromRating = standingFromRating(ratingPermille)
  fromFacts >= 0 and fromFacts <= Lane::standingCeiling and
    fromRating >= 0 and fromRating <= Lane::standingCeiling
```

## Story: Treat a new member with wide uncertainty

> As a new member, I want the service to look across a wide range of people until it knows me better, not to place me in a narrow band from a guess.

### A member with no reviewed facts gets the widest uncertainty

The uncertainty starts at the lane ceiling of twenty points. Each reviewed fact narrows it by two points until it reaches the floor of three points, after nine reviewed facts. A negative count is the same as zero. Unreviewed facts do not narrow it. The parity check adds both uncertainties to the band, so a wide uncertainty widens a new member's band and never narrows it.

```quint
pure val standingUncertaintyFloor: int = 3
pure val standingUncertaintyStep: int = 2

pure def standingUncertainty(reviewedCount: int): int =
  val counted = if (reviewedCount <= 0) 0
    else if (reviewedCount >= Lane::standingUncertaintyCeiling) Lane::standingUncertaintyCeiling
    else reviewedCount
  val narrowed = Lane::standingUncertaintyCeiling - standingUncertaintyStep * counted
  if (narrowed < standingUncertaintyFloor) standingUncertaintyFloor else narrowed

pure val reviewedCountValues = Set(-2, -1, 0, 1, 8, 9, 10, 20, 21)

pure def lawUncertaintyBounded(reviewedCount: int): bool =
  val spread = standingUncertainty(reviewedCount)
  spread >= standingUncertaintyFloor and spread <= Lane::standingUncertaintyCeiling and
    (reviewedCount <= 0 implies spread == Lane::standingUncertaintyCeiling)
```

### Another reviewed fact never widens the uncertainty

```quint
pure def lawUncertaintyShrinks(reviewedCount: int): bool =
  standingUncertainty(reviewedCount + 1) <= standingUncertainty(reviewedCount)
```

## Story: Move standing slowly

> As a member, I want my private standing to change gradually, so that one new fact or one rating does not move me to a different group of people in one week.

### Standing moves toward its target by at most five points a week

The shell computes the target from the evidence or the rating, then calls this once a week for each lane membership. The stored standing and the target are clamped to the standing range first. The first estimate of a new member is the target itself, and the widest uncertainty covers its error.

```quint
pure val standingWeeklyStep: int = 5

pure def nextStanding(standing: int, target: int): int =
  val start = standingClamp(standing)
  val goal = standingClamp(target)
  if (goal > start + standingWeeklyStep) start + standingWeeklyStep
  else if (goal < start - standingWeeklyStep) start - standingWeeklyStep
  else goal

pure val standingValues = Set(-1, 0, 3, 50, 97, 100, 101)
pure val targetValues = Set(-5, 0, 4, 45, 50, 55, 56, 100, 120)

pure def lawStandingStepBounded(standing: int, target: int): bool =
  val stepped = nextStanding(standing, target)
  stepped >= 0 and stepped <= Lane::standingCeiling and
    ((standing >= 0 and standing <= Lane::standingCeiling) implies
      (stepped - standing <= standingWeeklyStep and standing - stepped <= standingWeeklyStep))
```

### Standing reaches a target that is within one step

```quint
pure def lawStandingStepConverges(standing: int, target: int): bool =
  (standing >= 0 and standing <= Lane::standingCeiling and target >= 0 and target <= Lane::standingCeiling and
    target - standing <= standingWeeklyStep and standing - target <= standingWeeklyStep)
    implies nextStanding(standing, target) == target
```
