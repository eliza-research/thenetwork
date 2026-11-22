# Monitor aggregate matching outcomes

The weekly staff report uses aggregate exposure and outcome counts. The service keeps the existing eligibility query, order, clock, and report store. Member identifiers and photo rating values are internal inputs to grouping and never appear in the report.

## Story: Detect differences in outcomes without exposing individual ratings

> As an authorized reviewer, I want a weekly aggregate comparison of proposals, dates, and second dates so I can notice differences in outcomes.

### The weekly run waits until the stored report is one week old

For a photo-enabled network, the normal run is due when there is no stored report or when at least seven days have passed since the newest report. An explicit force request can run sooner. The check is against the latest report the scheduler reads.

Read opportunities from the latest saved network state. Before saving,
acquire the report's network-scoped lock and apply the same cadence
check to the latest stored report. A competing report can make the
current run no longer due.

```quint
pure val biasEveryMs: int = 604800000

pure def weeklyBiasDue(forced: bool, hasReport: bool, elapsed: int): bool =
  forced or not(hasReport and elapsed < biasEveryMs)

pure def lawRecentBiasReportDefersWeeklyRun(elapsed: int): bool =
  elapsed < biasEveryMs implies not(weeklyBiasDue(false, true, elapsed))
```

### Adult members need at least one day of exposure in the window

The default window is twenty-eight days. Time at risk starts at the later of the window start and the member's join time. A member needs a recorded adult age and at least one day of exposure to contribute a row. The shell converts the measured time to member-months. Rated members are grouped by their stable rating rank in five buckets, and members without a rating are grouped as unrated.

```quint
pure val biasWindowMs: int = 2419200000
pure val biasMinimumExposureMs: int = 86400000

pure def biasMemberEligible(age: int, adultAge: int, exposure: int): bool =
  age >= adultAge and exposure >= biasMinimumExposureMs

pure def biasRatingQuintile(rank: int, population: int): int =
  if (population > 0) 1 + (5 * rank) / population else 1
```

### Outcomes count only the opportunities in the observation window

Each outcome uses its own timestamp. A proposal enters the report when its creation timestamp is at either bound or between them. It counts as reaching a member after review. A closed opportunity with no recorded prior stage is treated as having closed in review. A held date enters the report when it is marked done and its meeting timestamp is at either bound or between them, whenever the proposal was created. So a date stays in the report until its meeting leaves the window. A pair with at least two held dates in the window contributes one second-date count to each participant.

```quint
pure def biasOpportunityInWindow(createdAt: int, from: int, asOf: int): bool =
  createdAt >= from and createdAt <= asOf

pure def biasOpportunityReached(stage: str, closedFrom: str): bool =
  stage != "review" and not(stage == "closed" and (closedFrom == "review" or closedFrom == ""))

pure def biasDateHeld(stage: str, hasMeeting: bool, meetingAt: int, from: int, asOf: int): bool =
  stage == "done" and hasMeeting and meetingAt >= from and meetingAt <= asOf

pure def lawBiasDateCountsByMeetingTime(meetingAt: int, from: int, asOf: int): bool =
  biasDateHeld("done", true, meetingAt, from, asOf) == biasOpportunityInWindow(meetingAt, from, asOf)

pure def biasSinglePair(participants: int): bool = participants == 2
pure def biasPairMetAgain(dates: int): bool = dates >= 2
```

### Report rates and alert only below the configured ratio

Calculate a rate per member-month for each metric, or zero when exposure is absent. Compare a group rate to the overall rate, using a ratio of one when the overall rate is zero. Calculating fractional exposure, dividing rates, and formatting the report stay in the decimal shell. Only groups at or above the minimum size enter the minimum and alerts. A ratio strictly below the threshold raises an alert. The normal threshold is four fifths. The service minimum is eight and the standalone analysis default is fifteen.

```quint
pure val biasProductionGroupMinimum: int = 8
pure val biasAnalysisGroupMinimum: int = 15
pure val biasThresholdNumerator: int = 4
pure val biasThresholdDenominator: int = 5

pure def biasRateFor(hasExposure: bool, quotient: int): int = if (hasExposure) quotient else 0
pure def biasRatioFor(hasOverallRate: bool, quotient: int): int = if (hasOverallRate) quotient else 1
pure def biasGroupEligible(members: int, minimum: int): bool = members >= minimum
pure def biasRatioBelowThreshold(ratio: int, threshold: int): bool = ratio < threshold

pure def lawBiasAtThresholdIsQuiet(threshold: int): bool =
  not(biasRatioBelowThreshold(threshold, threshold))
```

## Story: Stop using photo standing when it predicts nothing

> As an authorized reviewer, I want the Date lane to stop using the private photo standing when real outcomes show that it does not help, and to see that decision in the weekly report.

### The Date lane uses photo standing only while the standing gap predicts mutual interest

The monitor reads real outcomes only, from the same observation window as the report. An introduction where both members said yes and a date was booked is positive: its record says the date was completed or that someone did not come. An introduction that ended before a date was booked is negative: its record says a member declined, or it expired. Expired is the record of every introduction that closed while its members were being asked: a no, no answer, and also a block, a pair that no longer fits, a withdrawn consent, a safety hold, an opt-out or a minor signal. The record does not carry the reason, so each of these counts as a negative. The production network records a no to a probe as expired, so the two endings count the same. When a member says no and the network swaps in an alternate, the introduction keeps its identifier and the pair that declined gets no record: the monitor counts only the final pair of each introduction, with the gap of that pair. The simulator has no alternates and writes one record per proposed pair, so the slop block measures the monitor on every declined pair, which is a larger and different sample than production gives. A cancelled introduction is not an outcome, because a member can cancel before or after both said yes. The production network writes one record per check-in answer, so the shell counts each introduction once, by the identifier before ":fb:"; an introduction with a positive record is positive. Each outcome needs both members rated in pools large enough for a percentile, and its gap is the distance between their two percentiles. The shell counts every positive and negative pair of outcomes: a pair counts two when the positive outcome has the smaller gap, and one when the gaps are equal. That count, divided by twice the number of such pairs, is the chance that a positive outcome has a smaller gap than a negative one. With fewer than thirty positive or thirty negative outcomes, the evidence is too small and the lane keeps the standing. Otherwise the lane keeps the standing only when that chance is at least one half plus a margin of five percent. When the lane does not keep it, every member of the lane has the middle standing and the widest uncertainty until the monitor sees the chance reach the margin again. The monitor reads the percentiles, not the standing used in matching, so it can recover. The weekly report shows the counts and the decision, never a member or a rating. While the lane does not use the standing, the weekly run writes an alert line with the counts; the operations alert for bias reports counts only the group ratios under the threshold. This rule is new, because the shipped rating weights are not fitted, and the Date lane must stop using a standing that real outcomes do not support.

The switch is not symmetric, and it has no recovery margin of its own. When the lane stops using the standing, the middle standing carries no rating evidence, so the stored standing history does not apply and every member is at the middle at once. When the lane uses the standing again, the history at the middle applies, and the weekly step moves each member back by at most five points a week. A monitor that changes its decision near the margin therefore keeps the standing near the middle; it never moves a member faster than the weekly step toward a rating. The weekly step needs the stored standing history, which production keeps; the simulator does not pass a history, so in the simulator the standing follows the percentile at once. The monitor has no hysteresis, because in the simulator no decision went from off back to keep: over twelve seeds of four weeks, each seed left keep at most once and did not come back.

```quint
pure val standingValidityMinimum: int = 30
pure val standingValidityMarginPermille: int = 50

pure def standingOutcomePositive(ending: str): bool =
  ending == "completed" or ending == "no_show"

pure def standingOutcomeNegative(ending: str): bool =
  ending == "declined" or ending == "expired"

pure val endingValues = Set("pending", "accepted", "declined", "expired", "completed", "cancelled", "no_show")

pure def lawStandingOutcomeHasOneSide(ending: str): bool =
  not(standingOutcomePositive(ending) and standingOutcomeNegative(ending))

pure def standingGapPredicts(positives: int, negatives: int, concordantTwice: int): bool =
  if (positives < standingValidityMinimum or negatives < standingValidityMinimum) true
  else concordantTwice * 1000 >= (1000 + 2 * standingValidityMarginPermille) * positives * negatives

pure val positivesValues = Set(-1, 0, 29, 30, 31, 60)
pure val negativesValues = Set(0, 29, 30, 45)
pure val concordantTwiceValues = Set(0, 900, 990, 1000, 1800, 5400)

pure def lawStandingKeptWhileOutcomesAreFew(positives: int, negatives: int, concordantTwice: int): bool =
  (positives < standingValidityMinimum or negatives < standingValidityMinimum) implies
    standingGapPredicts(positives, negatives, concordantTwice)

pure def lawStandingOffWhenGapOrdersNoBetterThanChance(positives: int, negatives: int, concordantTwice: int): bool =
  (positives >= standingValidityMinimum and negatives >= standingValidityMinimum and
    concordantTwice <= positives * negatives) implies not(standingGapPredicts(positives, negatives, concordantTwice))

pure def lawStandingKeptWhenGapOrdersEveryPair(positives: int, negatives: int, concordantTwice: int): bool =
  (positives >= standingValidityMinimum and negatives >= standingValidityMinimum and
    concordantTwice >= 2 * positives * negatives) implies standingGapPredicts(positives, negatives, concordantTwice)
```
