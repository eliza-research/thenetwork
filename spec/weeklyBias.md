# Monitor aggregate matching outcomes

The weekly staff report uses aggregate exposure and outcome counts. The service keeps the existing eligibility query, order, clock, and report store. Member identifiers and photo rating values are internal inputs to grouping and never appear in the report.

## Story: Detect differences in outcomes without exposing individual ratings

> As an authorized reviewer, I want a weekly aggregate comparison of proposals, dates, and second dates so I can notice differences in outcomes.

### The weekly run waits until the stored report is one week old

For a photo-enabled network, the normal run is due when there is no stored report or when at least seven days have passed since the newest report. An explicit force request can run sooner. The check is against the latest report the scheduler reads.

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

An opportunity enters the report when its creation timestamp is at either bound or between them. It counts as reaching a member after review. A closed opportunity with no recorded prior stage is treated as having closed in review. Count held dates marked done with a meeting timestamp through the report time. A pair with at least two held dates contributes one second-date count to each participant.

```quint
pure def biasOpportunityInWindow(createdAt: int, from: int, asOf: int): bool =
  createdAt >= from and createdAt <= asOf

pure def biasOpportunityReached(stage: str, closedFrom: str): bool =
  stage != "review" and not(stage == "closed" and closedFrom == "review")

pure def biasDateHeld(stage: str, hasMeeting: bool, meetingAt: int, asOf: int): bool =
  stage == "done" and hasMeeting and meetingAt <= asOf

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
