# Reciprocal pair value

This library gives one integer value to a possible match between two members in one relationship lane. The value is high only when the match is good for both members, when they have similar standing in the lane, and, where the lane requires it, when each member gives about as much as the member receives. The [matching engine model](models/matching_engine.md) and the [candidate pool model](models/candidate_pool.md) cover the flow that asks for this value. The [relationship lanes](matchLane.md) spec supplies the per-lane rules and the intended standing offset. It serves [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction) and [Story F33](product/stories.md#story-f33--choose-a-hiring-introduction).

The engine shell supplies, for each side of a pair, integers that it computes from member facets: a utility (how good the other member is for this member), a private standing and its uncertainty in the lane, and the exchange (the value this member receives from the other member). Every value is an integer: `1000` is full value, and standing is `0` to `100`. The shell keeps the facets, the hard eligibility checks (age, blocks, holds, pauses, geography), human review, and all storage. Standing and the values of this library are private. They never appear in member-facing text, explanations, or relay, and they never read acceptance, reply, or popularity counts.

## Story: Value both members get from a match

> As a member, I want an introduction only when the other member is a good match for me and I am a good match for them.

### Each member's utility is a weighted mean of bounded terms

The shell builds each term from integer facts. Coverage counts how many of my wanted items the other member offers. Closeness lowers the value as a scalar difference grows, by a fixed cost for each unit. Each term counts between `0` and full value, and a negative weight counts as zero. With no positive weight, the utility is zero.

```quint
pure val pairValueScale: int = 1000

type UtilityTerm = { weight: int, value: int }

pure def boundedValue(value: int): int =
  if (value < 0) 0 else if (value > pairValueScale) pairValueScale else value

pure def coverageValue(hits: int, wanted: int): int =
  val counted = if (hits < 0) 0 else if (hits > wanted) wanted else hits
  if (wanted > 0) (pairValueScale * counted) / wanted else 0

pure def closenessValue(distance: int, costPerUnit: int): int =
  val cost = if (costPerUnit > 0) costPerUnit else 0
  val span = if (distance < 0) 0 - distance else distance
  val loss = cost * span
  if (loss < pairValueScale) pairValueScale - loss else 0

pure def utilityTermWeight(term: UtilityTerm): int =
  if (term.weight > 0) term.weight else 0

pure def directedUtility(terms: List[UtilityTerm]): int =
  val weightTotal = terms.foldl(0, (total, term) => total + utilityTermWeight(term))
  val weightedTotal = terms.foldl(0, (total, term) => total + utilityTermWeight(term) * boundedValue(term.value))
  if (weightTotal > 0) weightedTotal / weightTotal else 0

pure val termsValues = Set(
  List(),
  List({ weight: 0, value: 500 }),
  List({ weight: 3, value: 1000 }, { weight: 1, value: 0 }),
  List({ weight: -2, value: 900 }, { weight: 1, value: 1200 }),
  List({ weight: 2, value: -50 }, { weight: 5, value: 700 }),
)
pure val distanceValues = Set(-3, 0, 2, 5)
pure val costPerUnitValues = Set(-1, 0, 1, 250, 1000)

pure def lawUtilityTermsBounded(hits: int, wanted: int, distance: int, costPerUnit: int): bool =
  val coverage = coverageValue(hits, wanted)
  val closeness = closenessValue(distance, costPerUnit)
  and {
    0 <= coverage, coverage <= pairValueScale,
    0 <= closeness, closeness <= pairValueScale,
  }

pure def lawDirectedUtilityBounded(terms: List[UtilityTerm]): bool =
  val directed = directedUtility(terms)
  0 <= directed and directed <= pairValueScale
```

### The two utilities combine as an integer harmonic mean

The harmonic mean stays near the lower of the two utilities, so a match that is very good for one member and weak for the other gets a low value. When either utility is zero or less, the mean is zero. The mean of two positive utilities is between them, and it never falls when either utility rises.

```quint
pure def harmonicValue(left: int, right: int): int =
  if (left > 0 and right > 0) (2 * left * right) / (left + right) else 0

pure val leftValues = Set(-1, 0, 1, 2, 999, 1000)
pure val rightValues = Set(-1, 0, 1, 3, 1000)
pure val raisedValues = Set(0, 1, 3, 1000)

pure def lawHarmonicBetweenSides(left: int, right: int): bool =
  val lower = if (left < right) left else right
  val upper = if (left < right) right else left
  val mean = harmonicValue(left, right)
  (left > 0 and right > 0) implies (lower <= mean and mean <= upper)

pure def lawHarmonicMonotone(left: int, raised: int, right: int): bool =
  left <= raised implies harmonicValue(left, right) <= harmonicValue(raised, right)
```

### A pair has a value only when both utilities reach the lane floor

A pair is admissible when both utilities reach the lane's utility floor, the standing gap is inside the allowed band, and, where the lane requires it, the exchange is balanced. A pair that is not admissible has no value (`-1`). Otherwise the value is the harmonic mean of the two utilities minus the standing penalty, and never less than zero. The value is the same from both sides: the mirrored call swaps the sides and negates the offset. With utilities between zero and full value, the value is between zero and full value.

```quint
pure val noPairValue: int = -1

type PairSide = { utility: int, standing: int, uncertainty: int, exchange: int }
type PairRules = {
  utilityFloor: int, parityBand: int, parityFreeGap: int, parityPenaltyPerPoint: int,
  balanceRequired: bool, exchangeFloor: int, balanceTolerancePercent: int
}

pure def pairAdmissible(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  val gap = standingGap(side.standing, other.standing, offset)
  and {
    side.utility >= rules.utilityFloor,
    other.utility >= rules.utilityFloor,
    parityAllowed(gap, rules.parityBand, side.uncertainty, other.uncertainty),
    rules.balanceRequired implies
      exchangeBalanced(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent),
  }

pure def pairValue(side: PairSide, other: PairSide, offset: int, rules: PairRules): int =
  val gap = standingGap(side.standing, other.standing, offset)
  val penalised = harmonicValue(side.utility, other.utility) - parityPenalty(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint)
  if (not(pairAdmissible(side, other, offset, rules))) noPairValue
  else if (penalised > 0) penalised
  else 0

pure val sideValues = Set(
  { utility: 800, standing: 50, uncertainty: 0, exchange: 600 },
  { utility: 600, standing: 55, uncertainty: 3, exchange: 500 },
  { utility: 600, standing: 62, uncertainty: 0, exchange: 400 },
  { utility: 900, standing: 95, uncertainty: 20, exchange: 900 },
  { utility: 300, standing: 50, uncertainty: 0, exchange: 100 },
  { utility: 1000, standing: 75, uncertainty: 0, exchange: 0 },
)
pure val otherValues = sideValues
pure val nearerValues = sideValues
pure val offsetValues = Set(-25, 0, 5, 25)
pure val rulesValues = Set(
  { utilityFloor: 350, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 10,
    balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
  { utilityFloor: 400, parityBand: 20, parityFreeGap: 8, parityPenaltyPerPoint: 10,
    balanceRequired: true, exchangeFloor: 200, balanceTolerancePercent: 50 },
  { utilityFloor: 0, parityBand: 0, parityFreeGap: 3, parityPenaltyPerPoint: -5,
    balanceRequired: true, exchangeFloor: -1, balanceTolerancePercent: 0 },
)

pure def lawNoOneSidedPair(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  pairValue(side, other, offset, rules) >= 0 implies
    (side.utility >= rules.utilityFloor and other.utility >= rules.utilityFloor)

pure def lawPairValueSymmetric(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  pairValue(side, other, offset, rules) == pairValue(other, side, 0 - offset, rules)

pure def lawPairValueBounded(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  val scored = pairValue(side, other, offset, rules)
  and {
    0 <= side.utility, side.utility <= pairValueScale,
    0 <= other.utility, other.utility <= pairValueScale,
  } implies (scored == noPairValue or (0 <= scored and scored <= pairValueScale))
```

## Story: Keep a match between people of similar standing

> As a member, I want introductions to people at about my level in this kind of relationship, so that the match is useful to both of us.

For example, an investor with a long and strong record is not introduced as a peer to a person who is starting a first company. The same holds for private appearance standing in dating. In a lane where one side is meant to sit above the other, such as a mentor and a mentee, the lane gives an offset and the gap is measured from that offset.

### The standing gap is measured from the intended offset

The offset is how far the first side is intended to sit above the other side. The mirrored call passes the negated offset and gets the same gap.

```quint
pure def standingGap(standing: int, otherStanding: int, offset: int): int =
  val signedGap = standing - otherStanding - offset
  if (signedGap < 0) 0 - signedGap else signedGap
```

### A pair is refused when the gap is wider than the band and both uncertainties

Each member's uncertainty widens the band. A new member has the widest uncertainty, so the band for that member is wider, never narrower. The shell supplies uncertainties between zero and the lane ceiling.

```quint
pure def parityAllowed(gap: int, band: int, uncertainty: int, otherUncertainty: int): bool =
  gap <= band + uncertainty + otherUncertainty

pure def lawParityHolds(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  pairValue(side, other, offset, rules) >= 0 implies
    standingGap(side.standing, other.standing, offset) <= rules.parityBand + side.uncertainty + other.uncertainty
```

### Each point of gap above the free gap lowers the value

Inside the band, a gap up to the free gap costs nothing. Each further point costs the lane's penalty per point. A negative penalty per point counts as zero, so a closer pair is never worse. For two admissible pairs with the same utilities, the pair with the smaller gap has a value at least as high.

```quint
pure def parityPenalty(gap: int, freeGap: int, penaltyPerPoint: int): int =
  val excess = gap - freeGap
  val perPoint = if (penaltyPerPoint > 0) penaltyPerPoint else 0
  if (excess > 0) perPoint * excess else 0

pure def lawSmallerGapNeverWorse(side: PairSide, other: PairSide, nearer: PairSide, offset: int, rules: PairRules): bool =
  and {
    nearer.utility == other.utility,
    pairAdmissible(side, other, offset, rules),
    pairAdmissible(side, nearer, offset, rules),
    standingGap(side.standing, nearer.standing, offset) <= standingGap(side.standing, other.standing, offset),
  } implies pairValue(side, nearer, offset, rules) >= pairValue(side, other, offset, rules)
```

## Story: Keep the exchange balanced

> As a member looking for a cofounder or an introduction, I want each of us to receive about as much as we give.

### Where the lane requires balance, both members receive enough and nearly the same value

Each member must receive at least the lane's exchange floor. The difference between the two exchanges must be at most the lane's tolerance, as a percentage of the larger exchange. The check compares products, so it does not divide. It is the same in both orders. A lane without the balance rule, such as mentoring, relies on the senior side's consent to the difference.

```quint
pure def exchangeBalanced(given: int, received: int, floor: int, tolerancePercent: int): bool =
  val exchangeGap = if (given > received) given - received else received - given
  val larger = if (given > received) given else received
  given >= floor and received >= floor and 100 * exchangeGap <= tolerancePercent * larger

pure def lawBalancedExchange(side: PairSide, other: PairSide, offset: int, rules: PairRules): bool =
  (pairValue(side, other, offset, rules) >= 0 and rules.balanceRequired) implies
    exchangeBalanced(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent)
```
