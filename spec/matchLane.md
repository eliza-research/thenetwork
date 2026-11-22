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
| Friend | 150 | 100 | 100 | 0 | no | 0 | 100 | 0 | 3 | 12 | 600 | 3/6/150 |
| Date | 350 | 15 | 10 | 10 | no | 0 | 100 | 0 | 2 | 10 | 600 | 0/0/0 |
| Cofounder | 400 | 20 | 8 | 10 | yes | 200 | 50 | 0 | 2 | 10 | 600 | 0/0/0 |
| Intro | 350 | 20 | 8 | 10 | yes | 200 | 50 | 0 | 3 | 12 | 600 | 3/6/400 |
| Hire | 400 | 15 | 5 | 15 | no | 0 | 100 | 0 | 3 | 10 | 600 | 0/0/0 |
| Mentor | 350 | 15 | 5 | 10 | no | 0 | 100 | 25 | 2 | 8 | 400 | 0/0/0 |
| Invest | 400 | 15 | 5 | 15 | no | 0 | 100 | 0 | 2 | 8 | 400 | 0/0/0 |

- **Utility floor.** Decision: each member must get at least this much from the other, so a pair is never one-sided. The work lanes (Cofounder, Hire, Invest) ask for more than the social lanes. The acceptance rate of the two sides of approved probes tunes it; a floor that refuses pairs that both sides accept in the per-app worlds is too high.
- **Friend floors: a friend pair needs no shared stated interest.** Decision (2026-11-16): the Friend utility floor and the Friend circle pair floor are both 150, not 300 and 350. Proximity, a shared schedule and an activity that anyone can share (a dinner, a coffee) are enough for a friendship. Friend weighs affinity 6, complement 1 and closeness 2, and friends.help supplies no pack value, so a member who shares no stated interest and covers none of the other member's seeks gets at most 2 x 1000 / 9 = 222, and a typical neighbour gets about 150 from closeness alone. Floors of 300 and 350 therefore refused every such pair, which is about half of the pairs within 30 minutes of each other, and the weekly planner could not seat the neighbours at a dinner or coffee table. Measured with `sim --only friends` (pinned seeds 5 to 8, 8 weeks, 400 personas), all runs on one copy of the tree that differ only in the step named, one step at a time. Values: repeat-meetup rate (gate 30% or more), V14 (gate 0.75x oracle 42.1% and 1.75x random 17.0%), lowest borough ratio (gate 0.7) with its worst seed, friendship forming against random (gate 2x), harm against random (gate 0.5x):
  - Before (300 and 350, planner of e53fe984): 27.1%, 21.8%, 0.70 (worst seed 0.41), 2.4x, 0.27x. 26 of 29 gates pass.
  - Utility floor 300 to 150 only: 20.6%, 23.6%, 0.58 (0.44), 2.0x, 0.37x. 25 of 29. A lower utility floor alone gives more pairs to the pair stage, but the tables still need the circle pair floor 350, so the planner seats fewer familiar groups.
  - Circle pair floor 350 to 150 only (utility floor 150): 27.4%, 36.1%, 0.85 (0.68), 3.8x, 0.48x. 28 of 29.
  - The planner keeps the largest valued subset of a crew or a repeat group (planner change, no spec number): 29.7%, 36.3%, 0.83 (0.47), 4.5x, 0.48x. 28 of 29.
  - The planner's repeat window 10 to 14 days (planner change, no spec number): 30.5%, 37.3%, 0.80 (0.63), 4.0x, 0.48x. 29 of 29. This is the shipped state.
  - Both floors at another value with the shipped planner: 100 gave 28.2%, 37.5%, 0.73 (0.52), 4.6x, 0.42x (28 of 29); 200 gave 21.5%, 27.7%, 0.62 (0.21), 2.9x, 0.43x (26 of 29); 250 gave 27.2%, 26.2%, 0.76 (0.44), 3.1x, 0.46x (26 of 29). Only 150 passes every gate.
  The margins are small: repeat passes by 0.5 points and harm is 0.48x against 0.5x. Harm events rise with the number of meetups (0.27x to 0.48x). On the tuning seeds 1 to 4 (`packages/sim/src/apps/friends/cli.ts --seeds 1-4`), the shipped state gives repeat 28.2%, V14 37.3%, borough 0.83 and harm 0.61x, against 19.4%, 20.4%, 0.82 and 0.28x before; repeat and harm do not reach their gates there.
  The Friend lane also serves ntwrk social pairs, social events, social groups and newcomer welcome circles. On the ntwrk planted worlds (`sim --only matching --quick --matching-pack ntwrk`), 300 and 350 against 150 and 150 gave the same 276 pairs, 6 groups, 110 circles, standing correlation 0.800 and worse-side utility 583.2; ARI 0.660 to 0.661, purity 0.754 to 0.755, pair precision 0.584 to 0.586; touches per profile at N 1,000 116.0 to 167.4 (checks 15.6 to 15.7). On the network consent arms (21 days, seeds 1 to 3), meetings went from 130 to 158 (gate more than 140), held plans from 0,0,0 to 0,0,2, everyone-yes 0.858 to 0.857, invite-yes 0.929 to 0.926, and the judge found 0 invariants at 150 (at 300 and 350, seed 1 had one `decliner_exposed`, which this change does not cause).
  The circle pair floor equals the utility floor. For Friend this keeps every valued pair eligible for a circle: a valued pair has both utilities at the utility floor or above, the harmonic mean of two utilities is between them (spec/pairValue.md, "The two utilities combine as an integer harmonic mean"), and Friend's penalty per point is 0, so the standing penalty is 0 (spec/pairValue.md, "Each point of gap above the free gap lowers the value"). In a lane with a penalty above 0 this does not hold.
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
        rules: { utilityFloor: 150, parityBand: 100, parityFreeGap: 100, parityPenaltyPerPoint: 0,
                 balanceRequired: false, exchangeFloor: 0, balanceTolerancePercent: 100 },
        standingOffset: 0, weeklyCapacity: 3, searchLimit: 12, searchBudget: 600,
        circleMinimum: 3, circleMaximum: 6, circlePairFloor: 150
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

- **Friend** weights affinity most, because a member who looks for a friend often states no seeks, so complement is often empty. A shared interest raises a friend pair's value, but it is not required: closeness alone can reach the Friend utility floor (the decision "Friend floors" above).
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
