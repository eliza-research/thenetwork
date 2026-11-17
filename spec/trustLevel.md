# Trust level

This library classifies the score after the network applies a trust signal. The network stores scores and events, schedules decay, and handles staff decisions.

## Story: Pause unsafe activity

> As a member, I want Eliza to stop suggesting new connections when safety signals reach the review threshold.

### Trust scores at three trigger watch and scores at six trigger hold

Watch starts at three points. Hold starts at six points. Watch prevents new opportunities. Hold pauses matching and open opportunities for staff review.

```quint
type TrustLevel = Ok | Watch | Hold

pure val watchScore: int = 3
pure val holdScore: int = 6

pure def levelForScore(score: int, held: bool): TrustLevel =
  if (held or score >= holdScore) Hold else if (score >= watchScore) Watch else Ok
```

### An explicit attempt to bypass contact consent triggers watch

The classifier distinguishes a request for another member’s private phone number with an explicit intention to contact them directly. One such attempt reaches watch on a clean record. An ordinary extraction signal adds two points. A recognized request to start a consented swap within a mutual match follows the relay path without adding trust points. A report that quotes someone else’s behavior does not add points to the reporter.

```quint
pure def contactExtractionRisk(explicitBypass: bool): int =
  if (explicitBypass) watchScore else 2

pure def lawExplicitContactBypassTriggersWatch(explicitBypass: bool): bool =
  levelForScore(contactExtractionRisk(explicitBypass), false) == (if (explicitBypass) Watch else Ok)
```

### A hold stays in place until staff lift it

Score updates and decay cannot release a hold. Staff release a hold through the separate review path.

```quint
pure def lawScoreUpdatesKeepHolds(score: int): bool =
  levelForScore(score, true) == Hold
```

### Clean time lowers the score through a recorded decay event

The score drops by one point for each full fourteen days with no new signal. The network records each drop as a `decay` event with negative points, so the events of a member always add up to the score. A drop never takes the score below zero, and a held score does not decay. The shell counts the elapsed steps and records the event only when the points are below zero. [Safety cases](safetyCase.md) decide where a decay event goes.

```quint
pure val trustDecayDays: int = 14

pure def trustDecayPoints(score: int, steps: int, held: bool): int =
  if (held or score <= 0 or steps <= 0) 0
  else if (steps < score) 0 - steps
  else 0 - score

pure def lawTrustDecayKeepsScoreInRange(score: int, steps: int, held: bool): bool =
  val points = trustDecayPoints(score, steps, held)
  points <= 0 and (score >= 0 implies score + points >= 0)

pure def lawTrustDecayLeavesHoldsAlone(score: int, steps: int): bool =
  trustDecayPoints(score, steps, true) == 0
```
