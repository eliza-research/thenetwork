# Matching engine migration: results on commit c05d23b2 (2026-11-17)

This report compares the matching engine before and after the move to one generic match core. It is hand-written from saved command output. The numbers come from the simulator with pinned seeds and no model calls. No real member data and no real LLM call is in this report. The gap analysis that started the work is [2026-11-16-matching-backend-gap-analysis.md](2026-11-16-matching-backend-gap-analysis.md).

## What changed

- **One pair gate.** A pair exists only with a pair value ([pairValue](../../spec/pairValue.md)): both directed utilities reach the lane floor, the standing gap is in the lane band, and the exchange is balanced where the lane requires it. Every candidate path (pairs, groups, alternates, plans, crews) reads pairs from that gate.
- **Lanes.** One table of relationship lanes, sides, weights and limits ([matchLane](../../spec/matchLane.md)): Friend, Date, Cofounder, Intro, Hire, Mentor, Invest.
- **Private standing.** One standing and one uncertainty for each lane membership, from stated and reviewed facts and private ratings ([memberStanding](../../spec/memberStanding.md)). Acceptance and popularity counts are not inputs.
- **Bounded exact search.** Tag postings in a standing window, with hard-constraint segments ([candidateSearch](../../spec/candidateSearch.md)). A search is exact, or it reports a bound on the value it could have missed.
- **Selection.** Exposure, exploration, then one greedy walk in value order with a recorded refusal ([selectionRun](../../spec/selectionRun.md)).
- **Circles.** A group is admitted only when every pair has a value at the circle floor and the standing spread is in the band ([groupFormation](../../spec/groupFormation.md)).

## Method

| Item | Value |
|---|---|
| Baseline | `e4c06faa` (vibestack before the migration) |
| After | `c05d23b2` |
| Simulation command | `pnpm run sim --only friends --only peon --only slop`, `pnpm run sim --only network`, `pnpm run sim --only matching` |
| Seeds | The pinned seeds of each block (unchanged between the two runs) |
| Model | None. The simulator clears the provider keys. The reviewer is simulated (`review: "auto"`). |
| Other commands | `pnpm run test:integration`, `pnpm run test:e2e`, `pnpm run check`, `pnpm run spec:conformance <module>` |
| Variance | The runs are deterministic for a seed. No confidence interval is given. A difference of less than one gate margin must not be read as a real effect. |

The `matching` block is new, so it has no baseline. It runs the engine alone on planted worlds (hidden circles and hidden standing that the engine cannot read).

## Blocking gates

| Block | Baseline | After |
|---|---|---|
| friends | 24 of 24 | 29 of 29 |
| peon | 27 of 27 | 27 of 27 |
| slop | 42 of 42 | 45 of 45 |
| network | 66 of 66 | 67 of 67 |
| matching | not present | 32 of 32 (10 seeds) |

Each safety invariant is 0 on every seed after the migration: minor contacts, minors in a plan role, name before reveal, review before contact, canary leaks, pause path, decliner exposed.

## Quality measures that moved

| App | Measure | Baseline | After |
|---|---|---|---|
| friends | Valued meetup in 14 days (V14) | 34.7% | 37.3% |
| friends | Repeat-meetup rate (gate 30%) | 33.7% | 30.5% |
| friends | Friendship forming against random | 3.9x | 4.0x |
| friends | Lowest borough against overall V14 (gate 0.7) | 0.71 | 0.80 |
| friends | Harm events against random (gate 0.5x) | 0.42x | 0.48x |
| network | Everyone-yes rate, consent arms | 0.841 | 0.880 |
| network | Meetings, consent arms, pooled | 167 | 174 |
| network | Unsafe proposals on seed 1, consent against push | 2 against 32 | 0 against 18 |
| network | Plans booked and held, seeds 1 to 3 | 4, 2, 2 | 1, 1, 0 |
| slop | Lowest rating quintile dates against overall (gate 0.85) | 0.927 | 0.928 |
| slop | Second-date rate against random (tracked, target 2.5x) | 1.733 | 1.923 |
| slop | Dates per member-month against random (tracked, target 0.9x) | 1.005 | 0.834 |
| slop | Lowest group against overall (tracked, target 0.7x) | 0.506 | 0.324 |
| slop | Minor contacts cut against random (tracked, target 90%) | 76.5% | 70.6% |
| slop | Adversary contacts cut (tracked, target 90%) | 45.4% | 48.5% |
| peon | Interviews per hire against keyword (gate 0.75x) | 0.75x | 0.75x |

Regressions that are not behind a blocking gate, and are not fixed:

1. **slop dates per member-month** fell below its tracked target (1.005x to 0.834x of random).
2. **slop lowest group** against overall fell (0.506 to 0.324).
3. **slop minor contacts cut** fell (76.5% to 70.6%). The pilot plan requires 90% before live sends.
4. **network plans booked** fell (8 to 2 across three seeds).
5. **friends** passes two gates by a small margin: repeat-meetup rate by 0.5 points, harm by 0.02x.
6. **peon**: 142 of 4,767 proposed Hire pairs with backed levels have a role-level gap above 1 (new tracked measure). The lane band plus the uncertainties admits a two-level gap for a candidate with one reviewed fact or none.

## Matching block (planted worlds)

Quick mode, 3 seeds, 200 members: for the network pack, circles recover the planted circles (adjusted Rand index 0.87 for Friend against 0.01 for random groups of the same sizes), and matched standings correlate (0.82 to 0.93 against about 0 for a random pairing). No proposed pair is outside the lane band. Both directed utilities of each proposed pair reach the lane floor. The greedy phase has no blocking pair.

Full mode, 10 seeds: for each search that closed exact at 100, 200 and 400 members, the kept list equals the brute-force list (same members, same order), for all four packs. No pack segment refused a pair that the pack rules admit.

### Search cost (full mode)

| Pack and lane | Members | Exact searches | Pair checks per profile | Search time |
|---|---|---|---|---|
| ntwrk Intro | 1,000 | 100% | 1.0 | 58 ms |
| ntwrk Intro | 10,000 | 100% | 0.9 | 0.6 s |
| ntwrk Intro | 100,000 | 100% | 0.9 | 8 s |
| peon Hire | 10,000 | 100% | 52.8 | 1.9 s |
| peon Hire | 100,000 | 70.0% | 265.0 | 284 s |
| slop Date | 10,000 | 93.9% | 129.7 | 31 s |
| slop Date | 100,000 | 31.4% | 438.0 | 515 s |
| friends Friend | 10,000 | 84.5% | 103.5 | 14 s |
| friends Friend | 100,000 | 21.8% | 472.0 | 1,474 s |

Each search makes at most the lane budget of pair checks (600), so the cost of a run is at most the number of profiles times the budget. Before the migration the dating generator scored every pair in a market. At 100,000 members in one market, most Friend and Date searches spend their budget and report a bound. The cause is tags that many members hold (about 42 activity tags, each held by about 19% of friends members) and lanes that need no shared tag. Times were taken on a shared machine under load and are upper bounds.

## Verification

| Check | Result on `c05d23b2` |
|---|---|
| Type check (`pnpm run typecheck`) | pass |
| Integration suite | 998 passed, 6 skipped, 0 failed |
| End-to-end suite | 53 passed, 3 skipped |
| Spec check: model, always, replay | 150 of 150 units |
| Spec check: sometimes | 447 of 447 goals |
| Spec check: proof (Dafny 4.11) | 150 of 150 units, no obligation left as simulated only |
| Conformance journeys | 9 of 9 |
| Spec check: review | Every spec is listed. The product owner has not run `accept`. |

The spec check stages and the conformance journeys were run on the same changes in a second checkout. The full `pnpm run check` has not been run again on `c05d23b2` itself.

Proved for all states and inputs, among others: the pair value is symmetric and bounded; no pair has a value unless both utilities reach the floor and the gap is in the band; a balanced exchange where the lane requires it; the standing window contains each feasible partner; a bound is not below the value of a pair it covers; a kept candidate ranks above each dropped candidate; an exact search leaves no unseen candidate that could enter; a refused greedy choice has a member with no room; a primary circle is coherent.

## Defects found and fixed during the work

- A probe acknowledgement, and a weekend reply to weekday options, were read as a yes.
- A booked opportunity stayed open when a contacted, replaced member was found to be a minor.
- A survey in an ask window was not counted as a follow-up, so the next probe had no pause path.
- An invitation notice could ride a reply about an opportunity in which the invitee had a role.
- A review decision could approve an item that changed after the reviewer saw it.
- A ban left web sessions, connector tokens and profile-share grants in force.
- Stated availability blocks that touch were not joined, so an activity across two blocks was never offered.
- The simulator judge did not tie a plan message to its opportunity.
- The Observatory recorded a flake notice from a member who had declined as a yes taken back.
- The deployed backend did not run the retention purge or the inbox redrive.
- The profile that an agent submits at signup did not reach matching.

## Open decisions for the product owner

1. **Help intent against a proactive circle.** In the daily run, a stored help intent can lose its slot to a circle of the same members, because the selector uses each pair once in a run and the circle scores higher. The intent is searched again later. No spec gives an order.
2. **Hire level gap.** Whether a two-level gap must be refused for all candidates.
3. **Friend lane floors of 150.** A friend pair needs no shared stated interest. The margins on two friends gates are small.
4. **Rule changes to confirm at review:** `expireGroup` in `reviewedGroupJourney` (silence is not a decline), four invariants in `agentSignup`, the booked-opportunity minor rule in `opportunityLifecycle`, the invitation-notice rule in `outreachPolicy`.
5. **Pair-value ranking for ntwrk.** An experiment raised the Intro lane's AUC against the simulator's good pairs from 0.56 to 0.73 and lowered end-to-end outcomes (meetings 174 to 150). It is not merged. See the pair-value quality report when it lands.

## Limits

- Simulated members and a simulated reviewer. A simulated result says nothing about real acceptance rates.
- No run with real LLM calls was made for this change. The engine judge is off by default.
- The friends and dating pair values rank the simulator's good pairs weakly (AUC about 0.60 and 0.58), because the simulated chemistry is not visible before a meeting.
- The Clef weights are placeholders.
