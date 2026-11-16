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

### A hold stays in place until staff lift it

Score updates and decay cannot release a hold. Staff release a hold through the separate review path.

```quint
pure def lawScoreUpdatesKeepHolds(score: int): bool =
  levelForScore(score, true) == Hold
```
