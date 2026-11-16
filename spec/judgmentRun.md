# Matching judgment passes

The [matching engine flow model](models/matching_engine.md) follows matching from candidate generation to proposals. After hard checks and scoring, the engine runs the configured judgment passes. Prompt construction, top candidate ordering, scoring, and leak checks use the existing engine and pack.

## Story: Review the strongest possible matches in order

> As a member, I want the engine to review promising matches while keeping its hard rules and score thresholds.

### The rubric pass enables the run

Judgment requires a configured model, a pack with a judge, an enabled rubric pass, and a positive rubric limit. Start with the screen only if the pack provides it and the screen is enabled with a positive limit. Otherwise begin with the rubric.

```quint
type JudgmentPhase = AwaitingSetup | Screening | Rubric | DeepReview | Complete
type PassOption = { enabled: bool, limit: int, supported: bool }
type JudgmentRun = { phase: JudgmentPhase, deepAllowed: bool }

pure val initial: JudgmentRun = { phase: AwaitingSetup, deepAllowed: false }

pure def passAvailable(option: PassOption): bool = option.enabled and option.limit > 0 and option.supported

pure def canConfigureRun(review: JudgmentRun): bool = review.phase == AwaitingSetup

pure def configureRun(review: JudgmentRun, rubricOption: PassOption, screenOption: PassOption): JudgmentRun =
  if (not(passAvailable(rubricOption))) { ...review, phase: Complete }
  else { ...review, phase: if (passAvailable(screenOption)) Screening else Rubric }

pure val rubricOptionValues: Set[PassOption] = Set(
  { enabled: true, limit: 2, supported: true },
  { enabled: false, limit: 2, supported: true },
  { enabled: true, limit: 0, supported: true },
  { enabled: true, limit: 2, supported: false }
)
pure val screenOptionValues = rubricOptionValues
pure val deepOptionValues = rubricOptionValues
```

### Each completed pass advances the run once

Screening advances to the rubric. Check whether deep review is enabled and available after the rubric completes. Continue to deep review if it is available. Otherwise the run ends. Deep review ends the run. A run that is complete cannot start another pass.

```quint
pure def canFinishScreen(review: JudgmentRun): bool = review.phase == Screening
pure def finishScreen(review: JudgmentRun): JudgmentRun = { ...review, phase: Rubric }

pure def canFinishRubric(review: JudgmentRun): bool = review.phase == Rubric
pure def finishRubric(review: JudgmentRun, deepOption: PassOption): JudgmentRun =
  if (passAvailable(deepOption)) { phase: DeepReview, deepAllowed: true }
  else { ...review, phase: Complete }

pure def canFinishDeepReview(review: JudgmentRun): bool = review.phase == DeepReview
pure def finishDeepReview(review: JudgmentRun): JudgmentRun = { ...review, phase: Complete }

pure def alwaysDeepReviewWasEnabled(review: JudgmentRun): bool = review.phase == DeepReview implies review.deepAllowed
pure def stepDeepReviewFollowsRubric(before: JudgmentRun, after: JudgmentRun): bool =
  (before.phase != DeepReview and after.phase == DeepReview) implies before.phase == Rubric
pure def stepCompletedRunStaysClosed(before: JudgmentRun, after: JudgmentRun): bool =
  before.phase == Complete implies after == before

pure def sometimesScreening(review: JudgmentRun): bool = review.phase == Screening
pure def sometimesDeepReview(review: JudgmentRun): bool = review.phase == DeepReview
pure def sometimesComplete(review: JudgmentRun): bool = review.phase == Complete
```
