# Network capital (NC) ledger, MVP-lite: build and pre-launch simulation (2026-10-08)

Spec: [docs/design/2026-10-07-growth-capital-ownership.md](../design/2026-10-07-growth-capital-ownership.md), section 2 ("the doc"), and PRD Section 39.2. **No LLM calls, $0.** Tests run with API keys unset and without `LIVE_TESTS`. The text is hand-written. The tables are copied from the generated output of the commands below.

## Result in one paragraph

The ledger, the earning and losing rules, the anti-gaming logic, the derived levers and the private "what you've built" view are built in `packages/capital` (30 tests). A self-contained simulator runs about 250 starting members plus invitees, minors, flaky members and three kinds of adversary for 90 days. **Both blocking launch gates pass with the defaults.**

- **Primary fairness gate (a).** The NC levers together change the bottom/top-decile V14 ratio by **-0.013**. This is measured against the same 32 seeds with every NC lever off. The bound is -0.02. The 95% CI is wide (-0.062 to +0.036), mostly because the vouch lever changes who joins.
- **Effort lever alone.** It is measured precisely: -0.016 ± 0.003.
- **Levers help everyone.** They raise V14 for all eligible members (0.480 vs 0.447). Both the bottom decile (+0.036) and the top decile (+0.056) gain.
- **Gaming gate.** Every adversary type ends with a net loss of 9-10 NC, against +15.8 NC for an honest regular member. Median time to detection is 9 days.
- **Tracked health target (b), not blocking.** The absolute ratio is 0.71 (0.72 with the levers off), so it is not met. It reflects a participation gap: the bottom NC decile takes part 0.77 times a week, the top decile 1.29 times (60%). Plans and asks have to close it, not NC.

Two default changes were needed to pass gate (a) once all levers were in the comparison:
- Organizing reach above the base is now reserved for members with the least recent participation.
- Effort thresholds moved from 10/30/80 to 15/45/120.

Gate (a) does not pass if effort helps 2.5x more than assumed (-0.023). Measure the real effort effect in the pilot.

## Update 2026-10-09: gate (a) failed on main, fixed

Once gate (a) read the 95% CI lower bound (capital-13), it failed on main: change -0.012, lower bound -0.056. Two causes, measured at 32 paired seeds (`bun run packages/capital/experiments/run.ts`):

- **Effort lever (mechanism).** Effort alone lowered the ratio by -0.016 ± 0.003, a precise effect: high-NC members got up to +25% AI spend, which raised the top decile's V14 (+0.018) and barely the bottom's (+0.003). Fix in `src/levers.ts` `EFFORT_TABLE`, per PRD 39.2.3 (a high floor, diminishing returns at the top): the floor is raised (judge pass 2 on the top 12 instead of 10), and the tiers above add +5%, +3% and +2% spend, capped at +10% (was +12%, +8%, +5%, capped at +25%). Effort alone is now -0.005 ± 0.002. The x2.5 effort-effect sensitivity now passes too (lower bound -0.011).
- **Broken pairing in the harness (measurement).** The common-random-numbers design promised that arms stay paired when a lever changes who joins. They did not: invitee and sybil ids came from a running counter, friend-plan ids from the plan counter, and intro, crew, helper and needs picks indexed into the population list. One extra or missing invite re-rolled every later draw in that seed, so the vouch lever alone carried a paired standard error of 0.022 and the gate's CI was about +-0.045 whatever the levers did. Fix in `experiments/world.ts`: ids are derived from (member, day), and members are drawn by rendezvous hashing (`Keyed.member`, `Keyed.weighted`), which changes a draw only when the added or removed member wins it. The gate's threshold (0.02), seeds (1-32), sample size and comparator are unchanged.

After both fixes, 32 paired seeds: **change +0.015 (95% CI -0.004 to +0.034), PASS**. By lever: effort -0.005 ± 0.002, reach +0.008 ± 0.007, vouch +0.008 ± 0.010. Gaming still passes (vouch ring -52%, staged -57%, help farm -55%). Health target (b), tracked: 0.70 (levers off 0.69). Each fix alone: the pairing fix with the old effort table gives +0.007 (lower bound -0.011, a pass, with effort still at -0.013 ± 0.003); the effort fix on the old harness gives -0.008 (lower bound -0.052, a fail, because the CI stays wide). The numbers in the sections below are from 2026-10-08 and predate this update.

## Fairness gate (coordinator decision, 2026-10-08)

The founder delegated the gate. The coordinator restated it in two parts:

- **(a) Primary, blocking.** NC levers must not lower the bottom/top-decile V14 ratio by more than **0.02** compared with levers off, on paired seeds.
  - *Levers off* means effort, vouch capacity and organizing reach all off: everyone gets the floor effort, 3 invites per 30 days and a reach of 8.
  - *Paired* means the same seeds with common random numbers: every decision draws from a hash of (seed, purpose, day, members), so both arms see the same coin flips.
  - It is evaluated on **32 seeds**. With 8 seeds the standard error of the paired difference is about 0.04, which cannot resolve a 0.02 bound.
  - Pass rule: the mean difference is at least -0.02. The CI is reported with it.
- **(b) Tracked, non-blocking network-health target.** The absolute ratio is at least 0.80. It is reported together with the participation gap it reflects (acts per week by NC decile), and it is addressed by other levers (plans, asks), not NC.
- **Gaming (blocking, unchanged).** No strategy's mean net gain per adversary exceeds 25% of an honest regular member's 90-day NC.

The gate is encoded in `experiments/run.ts`:
- `FAIRNESS_MAX_DROP` = 0.02;
- `HEALTH_TARGET_RATIO` = 0.8;
- `GATE_SEEDS` = 32;
- `launchGates(on, off)` returns `primaryFairness` (blocking), `gaming` (blocking), `healthTarget` (`blocking: false`, with participation) and `pass`.

## What was built

| Design | Code |
|---|---|
| 2.1, 2.4, 2.7: itemized, append-only ledger with provenance | `src/ledger.ts` `CapitalLedger.record(event)`. Idempotent by event id. Events must arrive in time order. Entries are frozen. A reversal is a new `clawback` entry with `provenance.reverses`. Provenance holds the event id and type, the counterparts, `confirmedBy`, the outcome text (no private facts), the plan id, the origin and verification for attendance, and the public label |
| Categories and sign | Earn: `vouch`, `attendance`, `help`, `organizing`, `needs_answered`, `review`. Lose: `vouch_stake`, `no_show`, `ghosting`, `abuse`, `clawback`, `fraud`. `sign` is +1 or -1 |
| 2.3: entries are never shown to others | `entriesFor(viewer, member)` throws unless the viewer is the member, or staff with a role and a reason. Staff reads go to `audit()`. Levers use `internalEntries` |
| 2.3: minors | Uses `isMinor` from core `policy.ts`. Members aged 13-17 and unknown ages (fail closed) get no entries, and events about members who never joined are ignored |
| 2.4: never earned or lost | `declined`, `state_changed` (quiet, receiving, paused), `data_shared` and `help_asked` are accepted and write nothing. There is no decay with time, so inactivity changes nothing |
| 2.3: anti-gaming | In `credit()`: per-pair decay, per-category per-period decay and a per-period cap. Credits reduced to 0 are still written so that detection sees the behaviour. `src/detect.ts` `detectGaming(entries, now)` produces the `reciprocal_ring`, `staged_meetup` and `vouch_ring` flags. A `fraud_confirmed` event (from the reviewer) claws back the credits and adds a penalty |
| 2.5: levers | `src/levers.ts`: `effortTier`; `effortOverlay` (`{ tier, effortIndex, engine: EngineConfigInput, network: { conciergeResearchDepth, intentReSearchDays, planBuildingOptions } }`); `vouchCapacity`; `organizingReach` (`{ max, reservedForLowExposure }`). All are pure functions of one member's own entries |
| 2.6: what members see | `src/view.ts` `whatYouBuilt(entries)`. Example: "You've vouched for someone who is now active; you've helped 2 members; you organized 2 climbing nights." It shows no NC number, points or tier. Clawed-back credits are left out. Misses are shown only with `includeMisses` |
| 2.8: simulation | `experiments/world.ts` (synthetic world, real ledger, detection, simulated reviewer, levers, common random numbers) and `experiments/run.ts` (metrics, gates, arms, sweeps) |

### Rules and defaults (`src/config.ts` `DEFAULT_CAPITAL`)

| Rule | Default |
|---|---|
| Vouch credit: the invitee activates, gets value within **30 days** and has **no safety flag** (any severity) before the credit. The value must come from someone other than the voucher and the voucher's close circle: members tied to the voucher by member-controlled credits in the last 90 days | +10 |
| Vouch stake: the invitee is removed for **serious abuse within 90 days**. The credit is reversed and the stake is lost. Nothing is lost for leaving, being quiet, declining or minor flags | credit reversed, then -10 |
| Attendance: an accepted plan, attended, with verification (counterpart, check-in, organizer or reviewer) | +2 |
| Feedback on an attended plan (scaled by the attendance multiplier) | +0.5 |
| Help, confirmed useful by the recipient. Self-help and confirmation by the wrong person earn nothing | +3 |
| Organizing: public venue, at least 2 adult attendees who are not the organizer | +4 |
| Need answered (confirmed by staff or the person who asked) | +3 |
| Review and stewarding | +1 per item, at most 5 per event |
| No-show after confirming. A cancellation within **4 hours** of the start after confirming counts as a no-show. **One forgiven per 90 days.** A no-show without confirming costs nothing | -3 |
| Cancelling at least 4 hours before the start | 0 |
| Ghosting after accepting | -2 |
| Confirmed abuse (spam, harassment, scam or policy) | -20 |
| Confirmed fraud: claw back every positive credit whose counterparts or confirmers are in the ring, plus a penalty (once per 30 days) | clawback, then -10 |
| Pair decay: credit x 0.5^k, where k = earlier credits with that counterpart (mean over counterparts). The window is 30 days for engine- and organizer-made matches, and 90 days for member-controlled credits (help, needs, member-started plans) | 0.5 |
| Category decay: x 1/(1 + n/softN), where n = earlier credits in that category in the last 30 days. softN: vouch 3, attendance 8, help 6, organizing 6, needs 4, review 20 | |
| Cap on positive NC per rolling 30 days | 40 |
| Detection: reciprocal ring = at least 5 confirmed member-controlled credits in 30 days, with at least 60% confirmed by members the member confirms back within 2 hops, and that set no larger than 6. Staged meetup = the same people in at least 3 member-started plans verified only by each other. Vouch ring = the invitee's value came only from members with a two-way confirmation tie to the voucher | |
| **Effort tiers: NC at least 15, 45 and 120** gives tiers 1, 2 and 3. Tier 0 is the floor for everyone, including negative NC | index 1.00 / 1.05 / 1.08 / 1.10 (was 1.00 / 1.12 / 1.20 / 1.25 until 2026-10-09) |
| Vouch capacity per 30 days: 2, plus 1 per vouch that worked out (at most +3), minus 2 per lost stake. Range 0 to 5. 0 for 90 days after abuse or fraud | |
| Organizing reach: 8 people, plus 2 for every 3 sessions, up to 16. **Every slot above 8 is reserved for members with the least recent participation** (`reservedForLowExposure`). 4 for 90 days after abuse or fraud | |

### Effort overlay (concrete knobs)

| Tier | judge pass 2 topK / groupTopK | deep pass (pass 3) | concierge research depth | standing-intent re-search | plan options |
|---|---|---|---|---|---|
| 0 (floor, raised 2026-10-09: judge top 12, not today's 10) | 12 / 3 | off | 3 | every 3 days | 3 |
| 1 | 12 / 4 | off | 4 | every 3 days | 3 |
| 2 | 14 / 4 | off | 4 | every 2 days | 4 |
| 3 (cap) | 14 / 4 | on, top 2 | 5 | every 2 days | 4 |

`OVERLAY_ENGINE_KEYS = ["judge"]`. A test checks that the overlay's engine part sets only the judge knobs. It never sets weights, thresholds, budgets, exposure or selection. The overlay is meant to apply only when the engine serves this member's own intents. The engine has no per-seeker config today: that is integration ask 2.

## How it was measured

```bash
bun run packages/capital/experiments/run.ts --json runs/capital/2026-10-08-default.json   # arms at 8 seeds + launch gates at 32 paired seeds (~25 s)
bun run packages/capital/experiments/run.ts --effort-sweep                               # thresholds x effect size x reach policy, 32 paired seeds
bun run packages/capital/experiments/run.ts --sweep                                      # period cap x pair decay, 8 seeds
bun test packages/capital
```

Descriptive arms use seeds 1-8, and the launch gates use seeds 1-32 (`--gate-seeds`). Each seed is a fresh population and event stream. **Common random numbers:** every decision draws from a hash of (seed, purpose, day, members), not from a shared stream. Two arms that differ only in a lever therefore see the same coin flips for the same decisions, even when the lever changes who joins. ± is the standard error over seeds.

**Population per seed:**
- 240 adults:
  - regular 36%;
  - good, mediocre and bad vouchers 7%, 7% and 5%;
  - flaky for life reasons 10%;
  - helpers 8%;
  - organizers 4% (a weekly public crew);
  - Quiet, Receiving or Paused 8%;
  - low activity 8%;
  - 4 stewards.
- 12 minors.
- 18 adversaries:
  - 2 vouch rings of 3 members, who vouch sybils, stage the sybils' "value" with another ring member, and help each other about twice a week;
  - 3 staged pairs, who meet every 3 days in plans they start themselves, verified by each other, and give feedback;
  - 2 help-farming trios, each member "helping" another member of the trio on about 50% of days.
- Invitees join during the run. Their quality follows the voucher's type. Bad invitees get a serious safety flag with p 0.6, and 55% of those are removed for serious abuse.

**Each day:**
- Engine intros come from state budgets (Normal 2 per week). Both members must accept.
- Each participant then attends, cancels a day ahead (free), ghosts, or confirms and no-shows.
- Help asks are answered by helpers chosen in proportion to their help rate. Recipients confirm 85% of the time.
- Answered needs arrive weekly.
- Organizers run their crews weekly. The base 8 invitees are random. Slots above 8 go to the least-participating members in a random sample.
- Detection runs every evening. Each flag goes to the reviewer 2 days later.

**Assumptions (harness only):**
- **A1 effort effect:** P(good outcome) = q x (1 + effortGain x (effortIndex - 1)), with effortGain 0.4. The capped top tier therefore gives +10% relative (q = 0.5 for intros, 0.45 for crews, 0.75 for useful help). This applies to the member the match was made for. Arm C uses effortGain 1.0 (+25%).
- **A2 life-driven flakiness:** 30% of accepted plans are cancelled a day ahead, 6% are no-shows after confirming, and 1% are ghosted. It does not depend on how much the member wants to take part.
- **A3:** adversaries also behave like regular members. Gaming is on top of that.
- **A4 reviewer:**
  - confirms a flag that contains a true adversary with p 0.9;
  - confirms an all-honest flag with p 0.02;
  - does not review the same set again within 14 days;
  - after a confirmation, the adversary stops that strategy.
- **V14** follows the definition in `engine/src/attention.ts`. The eligible members are adults with tenure of at least 14 days who are not Paused or Quiet, plus active invitees. Sybils are excluded. Members are ranked by **NC at day 45**, and V14 is measured over **days 45-89**, so NC comes before the outcomes. Value events are true outcomes; staged "value" is excluded.
- **Participation** is acts per week over days 45-89. An act is a yes to an intro, plan or crew, a session organized, a help request, or help given.
- **Gaming gain** = for each adversary, the sum of NC from staged events, plus vouch credits for sybils, plus clawbacks, fraud and stake entries.

## Results

### Launch gates (defaults; arm A vs all levers off Z; 32 paired seeds, 90 days)

| Gate | Result | |
|---|---|---|
| **(a) Primary fairness**: change in the bottom/top V14 ratio caused by NC levers, at least -0.02 | **-0.013** (95% CI -0.062 to +0.036) | **PASS** |
| by lever (A minus A with only that lever off) | effort -0.016 ± 0.003; reach +0.008 ± 0.009; vouch capacity -0.002 ± 0.020 | |
| sensitivity: effort effect x2.5 (C vs C0) | -0.023 (95% CI -0.072 to +0.026) | would fail (not a gate) |
| what the levers do to V14 | all eligible 0.480 vs 0.447 with levers off; bottom decile +0.036, top decile +0.056 | |
| **Gaming**: each strategy's mean net gain at most 25% of a regular member's NC | vouch ring -56%, staged -58%, help farm -61% (net -9.0, -9.4 and -10.0 NC; a regular member earns +15.8) | **PASS** |
| **(b) Tracked health target**: absolute ratio at least 0.80 | 0.71 (worst seed 0.50); levers off 0.72 | not met (non-blocking) |
| participation gap behind (b) | bottom NC decile 0.77 vs top 1.29 acts per week (60%) | addressed by plans and asks |

How to read (a):
- The point estimate passes. The CI is wide, almost entirely because the vouch-capacity lever changes who joins (that component's standard error is 0.020), which reshuffles who is in each decile.
- The two levers that act on existing members are measured tightly:
  - effort: -0.016 ± 0.003;
  - reach: +0.008 ± 0.009 (it narrows the gap).
- The effort lever alone is close to the bound. Any increase in the effort effect, or lower thresholds, breaks it (sweep below).

### What changed to pass (a), and why

At the first rerun, with reach going to random invitees and thresholds of 10/30/80, all levers together gave **-0.043 ± 0.023** (32 seeds): effort -0.015, reach -0.017, vouch -0.021.

The reach lever widened the gap even though it raised everyone's V14. The extra crew slots went to whoever said yes most, so the top decile gained most. That is the participation gap again, now amplified by NC.

The fix is a design rule, not a parameter: **reach earned through NC widens the network, not the organizer's circle.** Slots above the base go to the members with the least recent participation, like the engine's exposure floor. With it, reach narrows the gap (+0.008), and the vouch component shrinks to -0.002.

The effort lever was then the main cost. Moving the thresholds from 10/30/80 to 15/45/120 trims it from -0.019 to -0.016. Tiers still bite: 108 honest members at tier 1 and 9 at tier 2 by day 90.

### Effort sweep (`--effort-sweep`; paired against all levers off, 32 seeds)

| thresholds | effortGain | reach extra to low exposure | honest T0/T1/T2/T3 (day 90) | V14 ratio on | all levers: on - off | effort lever only |
|---|---|---|---|---|---|---|
| 10, 30, 80 | 0.4 | yes | 225/159/28/0 | 0.70 ± 0.01 | -0.016 ± 0.025 | -0.019 ± 0.003 |
| 10, 30, 80 | 0.4 | no | 226/159/28/0 | 0.68 ± 0.02 | -0.043 ± 0.023 | -0.015 ± 0.003 |
| 10, 30, 80 | 1 | yes | 224/160/29/0 | 0.69 ± 0.01 | -0.027 ± 0.025 | -0.029 ± 0.004 |
| **15, 45, 120 (default)** | 0.4 | yes | 296/108/9/0 | 0.71 ± 0.01 | **-0.013 ± 0.025** | -0.016 ± 0.003 |
| 15, 45, 120 | 0.4 | no | 294/110/9/0 | 0.68 ± 0.02 | -0.040 ± 0.024 | -0.012 ± 0.003 |
| 15, 45, 120 | 1 | yes | 295/109/9/0 | 0.70 ± 0.01 | -0.023 ± 0.025 | -0.026 ± 0.004 |
| 20, 60, 150 | 0.4 | yes | 340/72/0/0 | 0.71 ± 0.01 | -0.009 ± 0.025 | -0.012 ± 0.003 |
| 20, 60, 150 | 0.4 | no | 340/72/0/0 | 0.68 ± 0.02 | -0.037 ± 0.024 | -0.009 ± 0.003 |
| 20, 60, 150 | 1 | yes | 340/73/0/0 | 0.70 ± 0.01 | -0.020 ± 0.025 | -0.023 ± 0.003 |

The trade-offs:
- Without the reach rule, no threshold passes.
- 20/60/150 gives the most margin, but the lever almost never bites (nobody reaches tier 2 in 90 days).
- 15/45/120 passes at the assumed effect and fails narrowly at 2.5x.
- No threshold keeps the effort lever inside the bound at 2.5x without making it nearly inert. The pilot must measure the real effort effect (V14 by tier, against a randomized holdout at the floor) before raising tiers.

### Arms (8 seeds, 90 days; descriptive)

| Arm | NC Gini (adults) | honest at T0 / T1 / T2 / T3 | V14 ratio | V14 all | regular NC | vouch ring gain | staged gain | help farm gain | detected | median TTD | bad invitees admitted per seed | vouch quality |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A default | 0.55 | 298 / 105 / 9 / 0 | 0.72 | 0.48 | 15.8 | -9.0 | -9.4 | -10.0 | 96% / 100% / 100% | 9.1 / 8.6 / 8.5 d | 52.9 | 0.31 |
| Z all levers off | 0.58 | 327 / 102 / 6 / 0 | 0.76 | 0.45 | 15.8 | -9.1 | -9.4 | -10.0 | 96% / 100% / 100% | same | 64.9 | 0.27 |
| B effort lever off | 0.55 | (same NC) | 0.73 | 0.47 | 15.8 | -9.0 | -9.4 | -10.0 | same | same | 52.9 | 0.31 |
| C effortGain 1.0 | 0.55 | 296 / 107 / 9 / 0 | 0.71 | 0.49 | 16.0 | -9.0 | -9.4 | -10.0 | same | same | 52.8 | 0.31 |
| D detection off | 0.55 | 298 / 106 / 9 / 0 | 0.68 | 0.49 | 16.0 | **+15.8 (99%)** | +4.0 (25%) | +8.9 (56%) | 0% | n/a | 74.9 | 0.27 |
| E no decay, no cap | 0.56 | 255 / 138 / 19 / 0 | 0.63 | 0.48 | 20.2 | -8.8 | -8.3 | -9.9 | same | same | 52.9 | 0.31 |
| F vouch-capacity lever off | 0.57 | 322 / 106 / 8 / 0 | 0.74 | 0.47 | 16.2 | -9.1 | -9.4 | -10.0 | same | same | 64.9 | 0.30 |

At 8 seeds the paired A-vs-Z difference is -0.042 ± 0.036, too noisy to judge. That is why the gate uses 32 seeds.

What the arms show:
- **The review queue does the work against gaming, and the decay rules bound what is left (D).** Without review, a vouch ring member gains about as much as an honest regular member earns, a help farmer gains half that, and a staged pair gains 25%. Uncaught rings also lower the V14 ratio (0.68).
- **Decay and cap protect fairness as much as they stop gaming (E).** Without them, an honest regular member reaches 20.2 NC, twice as many members reach tier 2, and the ratio falls to 0.63.
- **The vouch-capacity lever admits fewer bad invitees (A vs F):** 52.9 vs 64.9 per seed (-18%), and vouch quality rises from 0.30 to 0.31. Absolute vouch quality is low in this simulator (value within 30 days depends on the sim's V14 of about 0.48). Read the differences between arms, not the levels.
- **Detection precision:** 20 flags per seed. 0.1% of honest members were ever flagged, and none was wrongly confirmed. Ring detection uses member-controlled credits only (help, needs, member-started plans, vouches), because an engine-made intro confirms both sides by design. Before that change, 37% of honest members were flagged.

### Participation by NC decile (arm A, acts per week, days 45-89)

0.76 0.64 0.80 0.86 0.85 0.88 0.83 0.96 1.07 1.28, against V14 0.45 0.38 0.43 0.46 0.46 0.48 0.46 0.51 0.53 0.63.

The top decile is mostly organizers and helpers, who take part almost twice as often. The bottom decile is caught adversaries and low-activity members. The levers-off arm shows the same shape (0.75 ... 1.28). This is health target (b): plans and asks that reach low-participation members can close it, and NC cannot.

### Flaky members (real-life reasons; arm A)

| | flaky (legit) | regular |
|---|---|---|
| NC at day 90 | 12.2 ± 0.4 | 15.8 ± 0.2 |
| members with any penalty | 18% | |
| mean penalty | 0.52 NC | |
| members who lost more than 3 NC to penalties | 3% | |
| below the regular median effort tier | 0% (the median regular member is at the floor with thresholds of 15/45/120) | |

Penalties are not the problem: cancelling with notice is free, and the forgiven no-show absorbs most of the rest. The 3.6 NC gap is credit they did not earn, because they attended about 30% fewer plans.

### Anti-gaming sweep (`--sweep`; gains with detection off, as a share of a regular member's NC, 8 seeds)

| periodCap | pairDecay | regular NC | flaky NC | vouch ring | staged | help farm | with detection: worst strategy |
|---|---|---|---|---|---|---|---|
| 25 | 0.35 | 15.9 | 12.3 | 14.2 (90%) | 3.3 (21%) | 7.4 (46%) | -58% |
| 25 | 0.5 | 15.9 | 12.3 | 15.8 (99%) | 4.0 (25%) | 8.9 (56%) | -57% |
| 25 | 0.7 | 16.0 | 12.4 | 19.7 (124%) | 5.5 (35%) | 12.6 (79%) | -57% |
| 40 | 0.35 | 15.9 | 12.3 | 14.2 (90%) | 3.3 (21%) | 7.4 (46%) | -58% |
| **40** | **0.5** | 16.0 | 12.3 | 15.8 (99%) | 4.0 (25%) | 8.9 (56%) | -57% |
| 40 | 0.7 | 16.0 | 12.4 | 19.7 (123%) | 5.5 (34%) | 12.6 (79%) | -57% |
| 60 | 0.5 | 16.0 | 12.3 | 15.8 (99%) | 4.0 (25%) | 8.9 (56%) | -57% |

- The cap does not bind for honest members in this simulator (about 6 NC per month). It is a backstop for a burst of credits.
- A pair decay of 0.35 trims undetected gains by about 10%. It would also cut honest repeat relationships, which PRD 21 counts as value, so 0.5 is kept.
- Only review and clawback make rings unprofitable.

## Integration asks (events the Network must emit)

1. **Event feed.** The Network should emit `CapitalEvent`s (`src/types.ts`) from records it already keeps, each with a unique id and the Clock time:
   - `member_joined` (age and `vouchedBy`), `member_activated`;
   - `value_received` (the V14 value event, with the members who provided it);
   - `safety_flag`, `member_removed` (with the reason), `abuse_confirmed`;
   - `plan_accepted` (with `startsAt`), `plan_confirmed`, `plan_cancelled`, `plan_no_show`, `plan_ghosted`;
   - `plan_attended` (counterparts, `verifiedBy`, origin engine/member/organizer, public venue), `feedback_given`;
   - `help_given` and `help_confirmed`;
   - `organized` (public venue, recurring, checked-in attendees, public label);
   - `need_answered`, `review_completed`;
   - `fraud_confirmed` (reviewer action);
   - optionally `declined`, `state_changed`, `data_shared` and `help_asked`, which are accepted and ignored.

   **New signals the Network does not record today:**
   - an explicit confirmation step;
   - the plan's origin;
   - how attendance was verified;
   - the recipient's help confirmation;
   - the organizer's check-in list;
   - `plan_ghosted`.
2. **A per-seeker effort overlay in the engine.** `effortOverlay(...).engine` touches only `judge.topK`, `judge.groupTopK` and `judge.deep`. The engine needs a way to apply it only to candidates generated for that member's own intents. The Network needs `conciergeResearchDepth`, `intentReSearchDays` (replacing the constant 3 days in `network.ts openRequest`) and `planBuildingOptions`.
3. **Organizing reach with an exposure floor.** When a member starts a crew or plan, the Network may invite up to `organizingReach(...).max` people. The `reservedForLowExposure` slots must go to members with the least recent participation who still fit (opt-in and attention budgets apply). Gate (a) depends on this rule.
4. **Review queue.** Route `detectGaming` flags into the existing human review queue with their evidence counts. A reviewer decision becomes a `fraud_confirmed` event, or nothing. The gaming gate depends on this.
5. **Vouch capacity** must be read at invite time.
6. **Member web and text:** `whatYouBuilt(ledger.entriesFor({ member }, member))`. Staff reads go through `entriesFor({ staff, role, reason }, member)`, which records them in `audit()`.
7. **Pilot measurement:** randomize a holdout at the effort floor and measure V14 by tier. Gate (a) passes at the assumed effect (+10% relative at the top tier) and fails at 2.5x.

## Limitations

- **The world is synthetic and simple.** It has no geography, schedules or embedding fit. Intros pick a random counterpart and value is a coin flip. The *direction* of each lever effect can be trusted; the absolute levels cannot.
- **Gate (a) has a wide CI,** because the vouch lever changes the population. The effort and reach components are precise.
- **The adversaries do not adapt.** For example, they never avoid reciprocity, or spread across many counterparts with sybils.
- **The reviewer is simulated (A4).**
- **Runs are 90 days long.** Nobody reaches tier 3. Rerun at 180-365 days before launch.
- The organizing credit is open to staged crews at public venues with real check-ins. It is not modelled.

## Not in scope / not changed

- `packages/engine` and `packages/core` were not edited. `packages/capital` imports `isMinor` and `DAY`/`HOUR` from core and the `EngineConfigInput` type from engine **by relative path**, because adding a workspace dependency would change `bun.lock`. No new core type was needed: `MemberId` is reused.
- `bun test packages/capital`: 30 pass, 0 fail. `bunx tsc --noEmit -p .`: clean.
