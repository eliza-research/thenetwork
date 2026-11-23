# Private member standing

This library estimates a member's private standing in one [relationship lane](matchLane.md) and the uncertainty of that estimate. The matching engine uses both numbers for pair parity, as the [matching engine model](models/matching_engine.md) and the [candidate pool model](models/candidate_pool.md) describe. The shell supplies the current evidence or private rating, the adult and consent facts, and the last authorized observation in the same app and lane. The current evidence determines uncertainty on every matching run. Only standing and its observation time carry forward.

Standing is private. It is never shown to any member, and it never appears in an explanation, a member-facing message, relay text, or an export to a member. The leak guard checks every member-facing text. For the Date lane, the standing comes from the private photo rating of [Story F31](product/stories.md#story-f31--add-my-adult-dating-photos-privately) and the [photo rating attempt](photoRating.md). For the Hire lane of [Story F33](product/stories.md#story-f33--choose-a-hiring-introduction), the evidence is role level and track record only. Protected traits and their proxies are never evidence. The [weekly bias report](weeklyBias.md) watches outcomes by rating group.

Acceptance counts, reply counts, likes, and any other popularity count are never inputs to standing. A standing that reads popularity makes a feedback loop: exposure brings acceptances, acceptances raise standing, and standing brings more exposure.

## Story: Estimate standing from facts, never from popularity

> As a member, I want the service to place me near people of similar standing from facts about me, not from how many people said yes to me.

### Standing exists only for an adult who consented to the lane

A member who is not age-eligible for the lane has no standing in it, so no parity check can use one. A member is age-eligible when they are an adult, or when they are teen ready and the lane is the Friend lane of friends.help or of The Network (`teenFriendLane` of the [relationship lanes](matchLane.md) and `teenReady` of the [friend introduction age rule](friendIntroAge.md)). A member who did not consent to the lane has no standing in it. The shell checks this before it reads any evidence or rating. Changed (owner decision 2026-11-22): the parameter was `adult`; a teen-ready member now has the Friend standing, which is the middle standing with uncertainty 0, so a teen friendship pair can pass the Friend parity check, and no other lane gives a minor any standing. Changed (owner decision 2026-11-22, answers A2 to A5): the owner opened the Friend lane of The Network to teen introductions, so a teen-ready member also has the Friend standing on ntwrk.party.

```quint
import matchLane as Lane from "./matchLane"

pure def standingReadable(ageEligible: bool, consented: bool): bool = ageEligible and consented
```

### Standing history requires current account and lane authority

The shell keeps history only for an age-eligible member with an active account and current permission in that app and lane. It removes history when that authority ends. A saved estimate is usable in a match only while every evidence item it was computed from is still a current source that permits matching. A correction, removal, or scope reduction that withdraws that evidence invalidates the old estimate before matching, even within the weekly interval. With current authority and fresh evidence, the shell can start a new observation. Changed (owner decision 2026-11-22): the parameter `adult` is now `ageEligible`, with the meaning of the rule above, so the history of a teen-ready member in the Friend lane of friends.help or of The Network is kept while it stays age-eligible and is removed when it does not. Changed (owner decision 2026-11-22, answers A2 to A5): the ntwrk Friend lane now gives a teen-ready member the same age eligibility as the friends.help Friend lane.

```quint
pure def standingMayRetain(ageEligible: bool, activeAccount: bool, lanePermitted: bool): bool =
  standingReadable(ageEligible, lanePermitted) and activeAccount

pure def standingHistoryUsable(hasHistory: bool, evidenceStillPermits: bool): bool =
  hasHistory and evidenceStillPermits

pure def lawWithdrawnEvidenceInvalidatesStanding(hasHistory: bool): bool =
  not(standingHistoryUsable(hasHistory, false))

pure def lawStandingRetentionRequiresAuthority(ageEligible: bool, activeAccount: bool, lanePermitted: bool): bool =
  (not(ageEligible) or not(activeAccount) or not(lanePermitted)) implies
    not(standingMayRetain(ageEligible, activeAccount, lanePermitted))
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

### A private photo rating gives a percentile among rated adults of the same market and pool

The Date lane does not trust the scale of the photo rating, because the shipped rating weights are not fitted and multimodal models compress their ratings. The standing is the member's midrank percentile among the rated adults of the same market and dating pool: the members rated lower count in full, and the members with an equal rating, the member included, count at half. The shell counts the members from the matching snapshot. A pool with fewer than twenty rated adults gives no percentile: each member in it keeps the middle standing with the widest uncertainty. A member with no usable rating also keeps the middle standing. The Friend lane has no vertical dimension, so every Friend member has the middle standing with uncertainty 0. Every standing estimate stays in the standing range. This rule replaces the linear map from the rating to the standing range, because that map assumed a calibrated rating scale that the shipped weights do not give.

```quint
pure val standingMiddle: int = Lane::standingCeiling / 2
pure val standingPoolMinimum: int = 20

pure def standingPoolReady(rated: int): bool = rated >= standingPoolMinimum

pure def standingPercentile(below: int, equal: int, rated: int): int =
  if (rated > 0) standingClamp(((2 * below + equal) * Lane::standingCeiling) / (2 * rated)) else standingMiddle

pure val belowValues = Set(-1, 0, 1, 9, 19, 20, 39)
pure val equalValues = Set(-1, 0, 1, 2, 20)
pure val ratedValues = Set(-1, 0, 1, 19, 20, 21, 40)

pure def lawStandingBounded(evidence: List[StandingEvidence], below: int, equal: int, rated: int): bool =
  val fromFacts = standingFromEvidence(evidence)
  val fromRating = standingPercentile(below, equal, rated)
  fromFacts >= 0 and fromFacts <= Lane::standingCeiling and
    fromRating >= 0 and fromRating <= Lane::standingCeiling

pure def lawStandingPercentileRisesWithRank(below: int, equal: int, rated: int): bool =
  (below >= 0 and equal >= 0) implies
    standingPercentile(below + 1, equal, rated) >= standingPercentile(below, equal, rated)
```

### One rated adult who joins a pool moves another member's percentile by at most the weekly step

The percentile of a member must stay stable when unrelated members join. In a pool of at least twenty rated adults, one more rated adult, whether rated lower, higher or the same, moves another member's percentile by at most five points. One rated adult who leaves a pool that keeps at least twenty does the same. The weekly step then limits how fast the standing used in matching follows the percentile. This rule is new, because a percentile depends on the other members of the pool, and the stability bound must be stated for it.

```quint
pure def standingMovesWithinStep(before: int, after: int): bool =
  after - before <= standingWeeklyStep and before - after <= standingWeeklyStep

pure def lawStandingPercentileStableWhenOneJoins(below: int, equal: int, rated: int): bool =
  val held = standingPercentile(below, equal, rated)
  (below >= 0 and equal >= 1 and below + equal <= rated and standingPoolReady(rated)) implies and {
    standingMovesWithinStep(held, standingPercentile(below, equal, rated + 1)),
    standingMovesWithinStep(held, standingPercentile(below + 1, equal, rated + 1)),
    standingMovesWithinStep(held, standingPercentile(below, equal + 1, rated + 1)),
  }
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

### A photo rating's uncertainty narrows with rated photos and widens with their disagreement

A rating from fewer than two rated photos has no measure of agreement, so it keeps the widest uncertainty. From two rated photos, each rated photo narrows the uncertainty as a reviewed fact does, and the disagreement between the photos widens it again. The spread is the sample standard deviation of the overall per-photo ratings, on the rater's z scale, and a rater reports it only from two or more rated photos. The shell measures the disagreement as two percentiles in the member's pool: the percentile of the rating one spread below the member's rating, and the percentile one spread above it. Half the distance between them, rounded up, is added to the uncertainty, so a wider disagreement on either side never narrows it. The result stays between the floor and the lane ceiling. A rating stored without a measured disagreement, from a rater or an earlier build that did not measure it, counts as photos that disagree across the whole pool and keeps the widest uncertainty until the member is rated again. This rule is new, because the production rater did not report its photo count, so every rated member had the uncertainty of one photo whatever the number of photos or their agreement. The simulated rater reports a photo count and a spread from its own per-photo noise, but the count does not change the error of its rating, so the slop block exercises this rule and cannot show that it makes matching better.

```quint
pure def ratingSpreadPoints(spreadLow: int, spreadHigh: int): int =
  if (spreadHigh > spreadLow) (spreadHigh - spreadLow + 1) / 2 else 0

pure def ratingUncertainty(photos: int, spreadLow: int, spreadHigh: int): int =
  val widened = standingUncertainty(photos) + ratingSpreadPoints(spreadLow, spreadHigh)
  if (photos < 2) Lane::standingUncertaintyCeiling
  else if (widened > Lane::standingUncertaintyCeiling) Lane::standingUncertaintyCeiling
  else widened

pure val photosValues = Set(-1, 0, 1, 2, 4, 9, 10)
pure val spreadLowValues = Set(-1, 0, 30, 50)
pure val spreadHighValues = Set(0, 31, 50, 51, 70, 100)
pure val widerValues = Set(0, 51, 60, 100, 101)
pure val lowerValues = Set(-2, -1, 0, 29, 30, 50)

pure def lawRatingUncertaintyBounded(photos: int, spreadLow: int, spreadHigh: int): bool =
  val spread = ratingUncertainty(photos, spreadLow, spreadHigh)
  spread >= standingUncertaintyFloor and spread <= Lane::standingUncertaintyCeiling and
    (photos < 2 implies spread == Lane::standingUncertaintyCeiling)

pure def lawRatingUncertaintyShrinksWithPhotos(photos: int, spreadLow: int, spreadHigh: int): bool =
  ratingUncertainty(photos + 1, spreadLow, spreadHigh) <= ratingUncertainty(photos, spreadLow, spreadHigh)

pure def lawRatingUncertaintyGrowsWithSpread(photos: int, spreadLow: int, spreadHigh: int, wider: int, lower: int): bool =
  (wider >= spreadHigh implies
    ratingUncertainty(photos, spreadLow, wider) >= ratingUncertainty(photos, spreadLow, spreadHigh)) and
  (lower <= spreadLow implies
    ratingUncertainty(photos, lower, spreadHigh) >= ratingUncertainty(photos, spreadLow, spreadHigh))
```

### A standing that staff reviewed as a property of the offer has the floor uncertainty

Some standings are not estimates of a person. The role level of a job seat is a property of the seat: the employer states it in the posting, and staff review the posting before the seat can be matched. So the seat's standing is its level, and its uncertainty is the floor, whatever count of facts the shell finds. A standing that is estimated from a member's facts keeps the count rule above. The shell passes true only for a standing that the reviewed offer itself defines. In the peon pack (`packages/engine/src/packs/peon/match.ts`, `standing`), a seat passes true, because an unverified seat has no membership. A candidate passes false with a count of reviewed facts: the level itself when a trusted source gave it, and each demonstrated or interview-verified skill at or above that level. The count takes one fact for each facet, as in the network pack, so a trusted facet that carries both the level and a skill is one reviewed fact.

Decision (2026-11-17): the Hire lane gives a staff-reviewed posting level the floor uncertainty, not the uncertainty of one reviewed fact. Before, a posting got 18 points, so the parity check (band 15 plus both uncertainties) admitted a gap of 15 + 18 + 18 = 51 points against a candidate with one reviewed fact, which is two role levels of 25 points. On the peon block's pinned seeds, 142 of 4,767 proposed pairs with a backed candidate level had a role-level gap above one level. With the floor, the Hire limit is the band plus 3 plus the candidate's uncertainty, so no candidate is shown two levels away. The Hire band is 22, so the limit runs from 28 to 45 points and every candidate can be shown one level up or down. The measured effect and the band decision are in the Hire prose of the [lane table](matchLane.md).

```quint
pure def standingUncertaintyFor(reviewedCount: int, reviewedProperty: bool): int =
  if (reviewedProperty) standingUncertaintyFloor else standingUncertainty(reviewedCount)

pure def lawReviewedPropertyHasFloorUncertainty(reviewedCount: int, reviewedProperty: bool): bool =
  standingUncertaintyFor(reviewedCount, true) == standingUncertaintyFloor and
    standingUncertaintyFor(reviewedCount, true) <= standingUncertaintyFor(reviewedCount, reviewedProperty)
```

## Story: Move standing slowly

> As a member, I want my private standing to change gradually, so that one new fact or one rating does not move me to a different group of people in one week.

### Standing moves toward its target by at most five points a week

The shell computes the target from the current evidence or rating. A started estimate moves toward the target by at most five points on a due observation. The calculation clamps the starting value and target to the standing range.

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

### The first observation initializes standing and a due observation advances it once

The shell passes integer Unix milliseconds and indicates whether it has a saved observation. A non-negative clock initializes absent history to the clamped target. A negative saved timestamp counts as absent history. A negative clock cannot start history and returns the unsaved timestamp `-1`. With valid history, a clock that is earlier than the saved timestamp or less than seven days later keeps the saved value and time. At seven days or more, one step applies and the observation time becomes the current time, even when the target is already reached. Skipped weeks do not accumulate steps.

```quint
type StandingObservation = { standing: int, updatedAt: int }

pure val standingObservationWeekMs: int = 604800000

pure def observeStanding(value: int, observedAt: int, target: int, now: int, initialized: bool): StandingObservation =
  if (not(initialized) or observedAt < 0)
    if (now < 0) { standing: standingClamp(value), updatedAt: -1 }
    else { standing: standingClamp(target), updatedAt: now }
  else if (now >= observedAt and now - observedAt >= standingObservationWeekMs)
    { standing: nextStanding(value, target), updatedAt: now }
  else { standing: standingClamp(value), updatedAt: observedAt }

pure val valueValues = standingValues
pure val observedAtValues = Set(-1, 0, 1, 604800000, 1710000000000)
pure val nowValues = Set(-1, 0, 1, 604799999, 604800000, 604800001, 1209600000, 1710000000000)

pure def lawStandingObservationInRange(value: int, observedAt: int, target: int, now: int, initialized: bool): bool =
  val observed = observeStanding(value, observedAt, target, now, initialized)
  0 <= observed.standing and observed.standing <= Lane::standingCeiling and observed.updatedAt >= -1

pure def lawFirstStandingObservationUsesTarget(value: int, observedAt: int, target: int, now: int, initialized: bool): bool =
  ((not(initialized) or observedAt < 0) and now >= 0) implies
    observeStanding(value, observedAt, target, now, initialized) == { standing: standingClamp(target), updatedAt: now }

pure def lawStandingInvalidClockCannotInitialize(value: int, observedAt: int, target: int, now: int, initialized: bool): bool =
  ((not(initialized) or observedAt < 0) and now < 0) implies
    observeStanding(value, observedAt, target, now, initialized).updatedAt == -1

pure def lawStandingObservationHoldsUntilDue(value: int, observedAt: int, target: int, now: int): bool =
  (observedAt >= 0 and (now < observedAt or now - observedAt < standingObservationWeekMs)) implies
    observeStanding(value, observedAt, target, now, true) == { standing: standingClamp(value), updatedAt: observedAt }

pure def lawStandingDueObservationStepsOnce(value: int, observedAt: int, target: int, now: int): bool =
  val observed = observeStanding(value, observedAt, target, now, true)
  val prior = standingClamp(value)
  (observedAt >= 0 and now >= observedAt and now - observedAt >= standingObservationWeekMs) implies
    (observed.updatedAt == now and observed.standing == nextStanding(value, target) and
      observed.standing - prior <= standingWeeklyStep and prior - observed.standing <= standingWeeklyStep)

pure def lawStandingObservationNeverMovesTimeBackward(value: int, observedAt: int, target: int, now: int): bool =
  observedAt >= 0 implies observeStanding(value, observedAt, target, now, true).updatedAt >= observedAt

pure def lawStandingObservationCannotAdvanceTwiceAtSameTime(value: int, observedAt: int, target: int, now: int, initialized: bool): bool =
  val observed = observeStanding(value, observedAt, target, now, initialized)
  observed.updatedAt >= 0 implies
    observeStanding(observed.standing, observed.updatedAt, target, now, true) == observed
```
