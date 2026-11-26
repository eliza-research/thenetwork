# City travel limits and fair midpoint scoring

A multi-city meeting selects a neighborhood midpoint that stays within each participant's travel limit and balances worst-case fairness against average travel time.

## Story: Pick a fair meeting area within travel limits

> As a member meeting someone in my city, I want the selected area to stay within a fair travel limit so nobody carries an unfair commute.

### Travel time must stay within the positive limit plus bounded relaxation

A valid travel time is non-negative and stays at or below the positive base travel limit plus any relaxation step. Relaxation is bounded between 0 and 10 minutes inclusive. A candidate midpoint is valid only when the worst-case participant travel time meets this limit.

```quint
pure val maxRelaxStepMin: int = 10

pure def isWithinTravelLimit(maxTravelMin: int, travelLimitMin: int, relaxStepMin: int): bool =
  travelLimitMin > 0
    and relaxStepMin >= 0
    and relaxStepMin <= maxRelaxStepMin
    and maxTravelMin >= 0
    and maxTravelMin <= travelLimitMin + relaxStepMin

pure def isValidMidpoint(maxTravelMin: int, travelLimitMin: int, relaxStepMin: int): bool =
  isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin)

pure def lawRelaxStepCappedAtTen(maxTravelMin: int, travelLimitMin: int, relaxStepMin: int): bool =
  isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin) implies (relaxStepMin >= 0 and relaxStepMin <= maxRelaxStepMin)

pure def lawTravelLimitMustBePositive(maxTravelMin: int, travelLimitMin: int, relaxStepMin: int): bool =
  isWithinTravelLimit(maxTravelMin, travelLimitMin, relaxStepMin) implies (travelLimitMin > 0 and maxTravelMin >= 0)

pure def lawValidMidpointRespectsMaxBound(maxTravelMin: int, travelLimitMin: int, relaxStepMin: int): bool =
  isValidMidpoint(maxTravelMin, travelLimitMin, relaxStepMin) implies (maxTravelMin <= travelLimitMin + maxRelaxStepMin)

pure val maxTravelMinValues = Set(-5, 0, 10, 25, 30, 35, 40, 50)
pure val travelLimitMinValues = Set(-1, 0, 15, 25, 30, 45)
pure val relaxStepMinValues = Set(-1, 0, 5, 10, 11, 15)
```

### Midpoint cost balances worst-case fairness and average travel time

The scaled midpoint cost weights the maximum participant travel time by 60 percent and the mean participant travel time by 40 percent, scaled by 10 as integers (`6 * max + 4 * mean`). Subtracting a venue supply bonus clamps the net cost at zero so cost never becomes negative.

```quint
pure def fairMidpointCostScaled(maxTravelMin: int, meanTravelMin: int): int =
  6 * maxTravelMin + 4 * meanTravelMin

pure def fairMidpointNetCostScaled(maxTravelMin: int, meanTravelMin: int, supplyBonus: int): int =
  val netCost = fairMidpointCostScaled(maxTravelMin, meanTravelMin) - supplyBonus
  if (netCost < 0) 0 else netCost

pure def lawMidpointCostNonNegative(maxTravelMin: int, meanTravelMin: int): bool =
  (maxTravelMin >= 0 and meanTravelMin >= 0) implies fairMidpointCostScaled(maxTravelMin, meanTravelMin) >= 0

pure def lawMidpointNetCostNonNegative(maxTravelMin: int, meanTravelMin: int, supplyBonus: int): bool =
  fairMidpointNetCostScaled(maxTravelMin, meanTravelMin, supplyBonus) >= 0

pure def lawMidpointCostWithinMinimaxBounds(maxTravelMin: int, meanTravelMin: int): bool =
  (maxTravelMin >= 0 and meanTravelMin >= 0 and meanTravelMin <= maxTravelMin) implies (
    fairMidpointCostScaled(maxTravelMin, meanTravelMin) >= 10 * meanTravelMin
      and fairMidpointCostScaled(maxTravelMin, meanTravelMin) <= 10 * maxTravelMin)

pure val meanTravelMinValues = Set(-2, 0, 10, 20, 30, 45)
pure val supplyBonusValues = Set(0, 10, 50, 200, 600)
```
