# Relationship lanes

A lane is one kind of relationship: a friend, a date, a cofounder, an introduction, a hire, a mentor or an investor. This library gives each lane its shape, its sides, its private standing offset and its one table of limits. It also says which app offers which lane. The [reciprocal pair value](pairValue.md) supplies the pair arithmetic that each lane uses.

The engine shell supplies, for each membership in a pair check, the integer `PairSide`: the utility of the other member, the private standing and its uncertainty, and the exchange value. The shell extracts memberships from each app pack. The pack still owns consent: its ontology lanes in `packages/engine/src/pack.ts` are opt-in categories, not relationship lanes. The shell keeps every hard pair rule (minors are never matched, blocks, holds, pauses, geography) in its one pair gate, and calls `lanePairValue` only for a pair that passes that gate. Standing is private: it never appears in member-facing text, explanations or relay. The flow models are the [matching engine](models/matching_engine.md) and the [candidate pool](models/candidate_pool.md). The product stories are [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction), [Story F12](product/stories.md#story-f12--join-a-small-group) and [Story F33](product/stories.md#story-f33--choose-a-hiring-introduction).

## Story: Peers meet as equals

> As a member who looks for a friend, a date, a cofounder or an introduction, I want to meet people near my own standing who want me as much as I want them.

### Each lane is a peer lane or a two-sided lane

Friend, Date, Cofounder and Intro are peer lanes: each member is a Peer, and either member can give and receive. Hire, Mentor and Invest are two-sided lanes: one member is Offering (an employer seat, a mentor, an investor) and the other is Seeking (a candidate, a mentee, a founder). Date keeps mutual preference pools as a hard rule in the shell; inside a pool the two members are peers.

```quint
import pairValue.* from "./pairValue"

type MatchLane = Friend | Date | Cofounder | Intro | Hire | Mentor | Invest
type LaneShape = Peers | TwoSided
type LaneSide = Peer | Offering | Seeking

pure def laneShape(lane: MatchLane): LaneShape =
  match lane {
    | Friend => Peers
    | Date => Peers
    | Cofounder => Peers
    | Intro => Peers
    | Hire => TwoSided
    | Mentor => TwoSided
    | Invest => TwoSided
  }
```

### Two members pair only on compatible sides of the same lane

A peer lane pairs two Peers. A two-sided lane pairs one Offering member with one Seeking member. Two employers, two candidates, or a Peer in a two-sided lane never pair. Compatibility does not depend on which member asks.

```quint
pure def laneSidesCompatible(lane: MatchLane, side: LaneSide, other: LaneSide): bool =
  if (laneShape(lane) == Peers) side == Peer and other == Peer
  else (side == Offering and other == Seeking) or (side == Seeking and other == Offering)

pure def lawLaneSidesSymmetric(lane: MatchLane, laneNearRole: LaneSide, laneFarRole: LaneSide): bool =
  laneSidesCompatible(lane, laneNearRole, laneFarRole) iff laneSidesCompatible(lane, laneFarRole, laneNearRole)
```

### Every lane keeps its rules and bounds in one table

Standing runs from 0 to `standingCeiling` (100). The uncertainty of a standing runs from 0 to `standingUncertaintyCeiling` (20); a new member has the widest uncertainty, which widens the parity band and never narrows it. These two ceilings are scale decisions, not tuning knobs.

The table below is the starting table. Each number is a decision. Change a number only with measured evidence from the same command and seeds before and after. The `matching` sim block (planted worlds, with the brute-force oracle) and the per-app worlds give the measurements.

| Lane | utilityFloor | parityBand | parityFreeGap | penalty per point | balance | exchangeFloor | tolerance % | offset | weeklyCapacity | searchLimit | searchBudget | circle min/max/pairFloor |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Friend | 300 | 100 | 100 | 0 | no | 0 | 100 | 0 | 3 | 12 | 600 | 3/6/350 |
| Date | 350 | 15 | 10 | 10 | no | 0 | 100 | 0 | 2 | 10 | 600 | 0/0/0 |
| Cofounder | 400 | 20 | 8 | 10 | yes | 200 | 50 | 0 | 2 | 10 | 600 | 0/0/0 |
| Intro | 350 | 20 | 8 | 10 | yes | 200 | 50 | 0 | 3 | 12 | 600 | 3/6/400 |
| Hire | 400 | 15 | 5 | 15 | no | 0 | 100 | 0 | 3 | 10 | 600 | 0/0/0 |
| Mentor | 350 | 15 | 5 | 10 | no | 0 | 100 | 25 | 2 | 8 | 400 | 0/0/0 |
| Invest | 400 | 15 | 5 | 15 | no | 0 | 100 | 0 | 2 | 8 | 400 | 0/0/0 |

- **Utility floor.** Decision: each member must get at least this much from the other, so a pair is never one-sided. The work lanes (Cofounder, Hire, Invest) ask for more than the social lanes. The acceptance rate of the two sides of approved probes tunes it; a floor that refuses pairs that both sides accept in the per-app worlds is too high.
- **Parity band and free gap.** Decision: the private standing gap, after the offset, must stay inside the band plus both uncertainties, and the gap inside the free gap costs nothing. Friend has no vertical standing, so its band is the full range. Date uses a band of 15 points on the private appearance standing, plus both uncertainties. Date uses a free gap of 10 points, not 5. With 5, each point of a small gap that is inside the rating noise lowered the pair value, and members at the edge of the rating range, where fewer partners sit near them, lost their weekly assignment to pairs in the middle. On the slop block's pinned seeds (13 to 16, 4 weeks, 300 per city, with the exposure floor in the weekly assignment), the lowest rating quintile's dates against the overall rate went from 0.839 to 0.928 (gate 0.85 or more). Dates per member-month against random went from 0.822 to 0.834, and second dates per seed against random went from 1.811 to 1.541. On seeds 1 to 8, the same change moved the lowest quintile from 0.853 to 0.960 and kept second dates per member-month at 0.041. The penalty per point past the free gap stays 10, so each point of a large gap still costs the same; only the first 10 points are free. Cofounder and Intro use track record and allow a wider band than Hire and Invest. The reply and acceptance rate by standing gap tunes it, and the parity gate counter (pairs past the band) must stay 0.
- **Penalty per point.** Decision: each point of gap past the free gap lowers the pair value by this much. Hire and Invest use the largest penalty, because a level mismatch costs both sides most there. The acceptance rate by gap inside the band tunes it.
- **Balance, exchange floor and tolerance.** Decision: Cofounder and Intro require a balanced exchange. Each side must receive at least 200 and the two values may differ by at most 50 percent of the larger. Mentor has no balance rule, because the Offering side consents to the asymmetry. Hire and Invest use the parity band and offset as their two-way check. The share of accepted introductions that one side reports as one-sided tunes it.
- **Offset.** Decision: a mentor sits 25 standing points above a mentee. Every other lane has offset 0: an employer seat meets a candidate of its level, and a fund meets founders of its traction tier. The mentee acceptance rate by gap tunes it.
- **Weekly capacity.** Decision: the most proposals per member per week in this lane. Date, Cofounder, Mentor and Invest are scarce and get 2. The decline and no-reply rate as capacity changes tunes it.
- **Search limit and budget.** Decision: a search keeps the best `searchLimit` candidates and checks at most `searchBudget` pairs per member. The total cost is at most members times budget. The share of searches that close exact and the largest unseen bound of budgeted searches tune them.
- **Circle bounds and pair floor.** Decision: Friend and Intro form circles of 3 to 6. Every pair in a circle must reach the pair floor. A maximum of 0 means that the lane forms no circles. Mentor forms no circles: two mentees are both Seeking, so their pair has no value, and a circle needs a value for every pair. A circle around one Offering member needs its own rule, which is a later decision. The planted-partition recovery and the attendance against random groups in the `matching` block tune them.

```quint
type LaneLimits = {
  rules: PairRules, standingOffset: int,
  weeklyCapacity: int, searchLimit: int, searchBudget: int,
  circleMinimum: int, circleMaximum: int, circlePairFloor: int
}

pure val standingCeiling: int = 100
pure val standingUncertaintyCeiling: int = 20

pure def laneLimits(lane: MatchLane): LaneLimits =
  match lane {
    | Friend => {
        rules: { utilityFloor: 300, parityBand: 100, parityFreeGap: 100, parityPenaltyPerPoint: 0,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 0, weeklyCapacity: 3, searchLimit: 12, searchBudget: 600,
        circleMinimum: 3, circleMaximum: 6, circlePairFloor: 350
      }
    | Date => {
        rules: { utilityFloor: 350, parityBand: 15, parityFreeGap: 10, parityPenaltyPerPoint: 10,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 0, weeklyCapacity: 2, searchLimit: 10, searchBudget: 600,
        circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0
      }
    | Cofounder => {
        rules: { utilityFloor: 400, parityBand: 20, parityFreeGap: 8, parityPenaltyPerPoint: 10,
                 balanceRequired: true, exchangeFloor: 200, balanceTolerancePercent: 50 },
        standingOffset: 0, weeklyCapacity: 2, searchLimit: 10, searchBudget: 600,
        circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0
      }
    | Intro => {
        rules: { utilityFloor: 350, parityBand: 20, parityFreeGap: 8, parityPenaltyPerPoint: 10,
                 balanceRequired: true, exchangeFloor: 200, balanceTolerancePercent: 50 },
        standingOffset: 0, weeklyCapacity: 3, searchLimit: 12, searchBudget: 600,
        circleMinimum: 3, circleMaximum: 6, circlePairFloor: 400
      }
    | Hire => {
        rules: { utilityFloor: 400, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 15,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 0, weeklyCapacity: 3, searchLimit: 10, searchBudget: 600,
        circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0
      }
    | Mentor => {
        rules: { utilityFloor: 350, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 10,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 25, weeklyCapacity: 2, searchLimit: 8, searchBudget: 400,
        circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0
      }
    | Invest => {
        rules: { utilityFloor: 400, parityBand: 15, parityFreeGap: 5, parityPenaltyPerPoint: 15,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 0, weeklyCapacity: 2, searchLimit: 8, searchBudget: 400,
        circleMinimum: 0, circleMaximum: 0, circlePairFloor: 0
      }
  }

pure def lawLaneLimitsWellFormed(lane: MatchLane): bool =
  val limits = laneLimits(lane)
  val rules = limits.rules
  and {
    0 <= rules.utilityFloor, rules.utilityFloor <= pairValueScale,
    0 <= rules.exchangeFloor, rules.exchangeFloor <= pairValueScale,
    rules.balanceRequired implies rules.exchangeFloor > 0,
    0 <= rules.balanceTolerancePercent, rules.balanceTolerancePercent <= 100,
    0 <= rules.parityFreeGap, rules.parityFreeGap <= rules.parityBand, rules.parityBand <= standingCeiling,
    0 <= rules.parityPenaltyPerPoint,
    0 <= limits.standingOffset, limits.standingOffset <= standingCeiling,
    limits.weeklyCapacity > 0, limits.searchLimit > 0, limits.searchBudget > 0,
    limits.searchLimit <= limits.searchBudget,
    (limits.circleMinimum == 0 and limits.circleMaximum == 0 and limits.circlePairFloor == 0) or
      (3 <= limits.circleMinimum and limits.circleMinimum <= limits.circleMaximum and limits.circleMaximum <= 6 and
        0 < limits.circlePairFloor and limits.circlePairFloor <= pairValueScale),
  }
```

### Each lane weighs the four utility terms

The directed utility of one member for another has four terms: complement (what the other member offers of what this member seeks), affinity (shared interests), closeness (trait distance) and pack (one value that the app pack supplies). The shell computes each term from 0 to `pairValueScale` and passes the four terms with the lane's weights to `directedUtility`. Each weight is a decision:

| Lane | complement | affinity | closeness | pack |
|---|---|---|---|---|
| Friend | 1 | 6 | 2 | 1 |
| Date | 3 | 2 | 2 | 3 |
| Cofounder | 5 | 2 | 2 | 1 |
| Intro | 6 | 2 | 1 | 1 |
| Hire | 6 | 1 | 2 | 1 |
| Mentor | 5 | 3 | 1 | 1 |
| Invest | 6 | 2 | 1 | 1 |

- **Friend** weights affinity most, because a member who looks for a friend often states no seeks, so complement is often empty. Its utility floor is set for that reason.
- **Date** weights complement and the pack value equally, because in a date the app pack's own directed value counts as much as what one member offers of what the other seeks.
- **The work lanes** (Cofounder, Intro, Hire, Mentor, Invest) weight complement most, because a work introduction is useful only when one side has what the other seeks. Mentor gives affinity more weight than the other work lanes, because a mentee and a mentor must share a field.

The acceptance rate of approved probes by term, in the per-app worlds and the planted worlds of the `matching` block, tunes these weights. Each weight is 0 or more and the weights of a lane have a positive sum, so `directedUtility` never falls back to 0 for a lane.

```quint
type LaneWeights = { complement: int, affinity: int, closeness: int, pack: int }

pure def laneWeights(lane: MatchLane): LaneWeights =
  match lane {
    | Friend => { complement: 1, affinity: 6, closeness: 2, pack: 1 }
    | Date => { complement: 3, affinity: 2, closeness: 2, pack: 3 }
    | Cofounder => { complement: 5, affinity: 2, closeness: 2, pack: 1 }
    | Intro => { complement: 6, affinity: 2, closeness: 1, pack: 1 }
    | Hire => { complement: 6, affinity: 1, closeness: 2, pack: 1 }
    | Mentor => { complement: 5, affinity: 3, closeness: 1, pack: 1 }
    | Invest => { complement: 6, affinity: 2, closeness: 1, pack: 1 }
  }

pure def lawLaneWeightsWellFormed(lane: MatchLane): bool =
  val weights = laneWeights(lane)
  and {
    0 <= weights.complement, 0 <= weights.affinity, 0 <= weights.closeness, 0 <= weights.pack,
    weights.complement + weights.affinity + weights.closeness + weights.pack > 0,
  }
```

## Story: Two sides meet across a role

> As a candidate, a mentee or a founder, I want an introduction to an employer, a mentor or an investor whose level fits mine, and I want the other side to see the same fit.

### The offering side sits above the seeking side by the lane's offset

The offset says how far a member is intended to sit above the other member. An Offering member is above by the lane's standing offset, a Seeking member is below by the same amount, and a Peer has no offset. So the offsets of two compatible sides always cancel.

```quint
pure def laneOffset(lane: MatchLane, side: LaneSide): int =
  val offset = laneLimits(lane).standingOffset
  if (side == Offering) offset else if (side == Seeking) 0 - offset else 0

pure def lawLaneOffsetAntisymmetric(lane: MatchLane, laneNearRole: LaneSide, laneFarRole: LaneSide): bool =
  laneSidesCompatible(lane, laneNearRole, laneFarRole) implies
    laneOffset(lane, laneNearRole) == 0 - laneOffset(lane, laneFarRole)
```

### A lane pair value is the same from both sides

A pair has a value only when its sides are compatible. The value is then the reciprocal pair value with the lane's offset for the first side and the lane's rules. Because the offsets cancel and the pair value is symmetric, both members of a pair get the same value, whichever member the search starts from.

```quint
pure val laneNearValues = Set(
  { utility: 1000, standing: 50, uncertainty: 0, exchange: 600 },
  { utility: 400, standing: 70, uncertainty: 20, exchange: 300 },
  { utility: 349, standing: 25, uncertainty: 5, exchange: 200 },
  { utility: 0, standing: 100, uncertainty: 0, exchange: 0 }
)
pure val laneFarValues = Set(
  { utility: 800, standing: 25, uncertainty: 3, exchange: 500 },
  { utility: 350, standing: 50, uncertainty: 0, exchange: 199 },
  { utility: 600, standing: 90, uncertainty: 20, exchange: 1000 },
  { utility: 300, standing: 55, uncertainty: 10, exchange: 250 }
)

pure def lanePairValue(lane: MatchLane, side: PairSide, sideRole: LaneSide, other: PairSide, otherRole: LaneSide): int =
  if (laneSidesCompatible(lane, sideRole, otherRole))
    pairValue(side, other, laneOffset(lane, sideRole), laneLimits(lane).rules)
  else noPairValue

pure def lawLanePairValueSymmetric(lane: MatchLane, laneNear: PairSide, laneNearRole: LaneSide, laneFar: PairSide, laneFarRole: LaneSide): bool =
  lanePairValue(lane, laneNear, laneNearRole, laneFar, laneFarRole) == lanePairValue(lane, laneFar, laneFarRole, laneNear, laneNearRole)
```

## Story: Each app offers its own lanes

> As a member of one app, I want matches only of the kinds that app is for.

### Each app offers a fixed set of lanes

The app ids are the ones in `packages/platform/src/apps.ts`. friends.help offers Friend. slop.date offers Date. peon.biz offers Hire and Cofounder. ntwrk.party offers Friend, Cofounder, Intro, Mentor and Invest. Any other app id offers no lane. Every app offers at least one lane.

```quint
pure val appValues = Set("ntwrk", "slop", "peon", "friends", "eliza")

pure def laneOffered(app: str, lane: MatchLane): bool =
  match lane {
    | Friend => app == "friends" or app == "ntwrk"
    | Date => app == "slop"
    | Cofounder => app == "peon" or app == "ntwrk"
    | Intro => app == "ntwrk"
    | Hire => app == "peon"
    | Mentor => app == "ntwrk"
    | Invest => app == "ntwrk"
  }

pure def lawEveryAppHasALane(app: str): bool =
  (app == "ntwrk" or app == "slop" or app == "peon" or app == "friends") implies
    (laneOffered(app, Friend) or laneOffered(app, Date) or laneOffered(app, Cofounder) or
      laneOffered(app, Intro) or laneOffered(app, Hire) or laneOffered(app, Mentor) or
      laneOffered(app, Invest))
```
