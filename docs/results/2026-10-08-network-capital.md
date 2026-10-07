# Network capital (NC) ledger, MVP-lite: build and pre-launch simulation (2026-10-08)

Spec: [docs/design/2026-10-07-growth-capital-ownership.md](../design/2026-10-07-growth-capital-ownership.md), section 2 ("the doc"), and PRD Section 39.2. **No LLM calls, $0.** Tests run with API keys unset and without `LIVE_TESTS`. The text is hand-written. The tables are copied from the generated output of the commands below.

## Result in one paragraph

The ledger, the earning and losing rules, the anti-gaming logic, the derived levers and the private "what you've built" view are built in `packages/capital` (30 tests). A self-contained simulator runs 90 days and 8 seeds over about 250 starting members, invitees who join during the run, minors, flaky members and three kinds of adversary. With detection and a simulated reviewer, **no gaming strategy pays**. Every adversary type ends with a net loss from gaming:
- vouch rings: -8.5 NC;
- staged meetups: -9.4 NC;
- help farming: -10.2 NC.

For comparison, an honest regular member earns +16.5 NC in 90 days. Median time to detection is 9 days, and no honest member was wrongly confirmed. **The V14 launch gate as written fails (0.74), but NC does not cause the failure.** With every NC lever off, the same population gives 0.75. The top NC decile is mostly organizers and helpers, who get more value because they take part more. The part of the gap that NC adds through the effort lever is -0.010 ± 0.008 (paired seeds), or -0.016 at 2.5x the assumed effort effect. Members who are flaky for real-life reasons lose almost nothing to penalties (mean 0.33 NC, 2% lost more than 3 NC). They do earn less because they attend less (11.9 vs 16.5 NC), so 36% sit at the effort floor while the median regular member is at tier 1. **Recommendation:** adopt the ledger and defaults. Restate the V14 gate as an attributable bound (below). Do not launch NC levers without the review queue: with detection off, vouch rings gain about 1x a regular member's NC.

## What was built

| Design | Code |
|---|---|
| 2.1, 2.4, 2.7: itemized, append-only ledger with provenance | `src/ledger.ts` `CapitalLedger.record(event)`. Idempotent by event id. Events must arrive in time order. Entries are frozen. A reversal is a new `clawback` entry with `provenance.reverses`. Provenance holds the event id and type, the counterparts, `confirmedBy`, the outcome text (no private facts), the plan id, the origin and verification for attendance, and the public label |
| Categories and sign | Earn: `vouch`, `attendance`, `help`, `organizing`, `needs_answered`, `review`. Lose: `vouch_stake`, `no_show`, `ghosting`, `abuse`, `clawback`, `fraud`. `sign` is +1 or -1 |
| 2.3: entries are never shown to others | `entriesFor(viewer, member)` throws unless the viewer is the member, or staff with a role and a reason. Staff reads go to `audit()`. Levers use `internalEntries` |
| 2.3: minors | Uses `isMinor` from core `policy.ts`. Members aged 13-17 and unknown ages (fail closed) get no entries, and events about members who never joined are ignored |
| 2.4: never earned or lost | `declined`, `state_changed` (quiet, receiving, paused), `data_shared` and `help_asked` are accepted and write nothing. There is no decay with time, so inactivity changes nothing |
| 2.3: anti-gaming | In `credit()`: per-pair decay, per-category per-period decay and a per-period cap. Credits reduced to 0 are still written so that detection sees the behaviour. `src/detect.ts` `detectGaming(entries, now)` produces the `reciprocal_ring`, `staged_meetup` and `vouch_ring` flags. A `fraud_confirmed` event (from the reviewer) claws back the credits and adds a penalty |
| 2.5: levers | `src/levers.ts`: `effortTier`, `effortOverlay` (`{ tier, effortIndex, engine: EngineConfigInput, network: { conciergeResearchDepth, intentReSearchDays, planBuildingOptions } }`), `vouchCapacity`, `organizingReach`. All are pure functions of one member's own entries |
| 2.6: what members see | `src/view.ts` `whatYouBuilt(entries)`. Example: "You've vouched for someone who is now active; you've helped 2 members; you organized 2 climbing nights." It shows no NC number, points or tier. Clawed-back credits are left out. Misses are shown only with `includeMisses` |
| 2.8: simulation | `experiments/world.ts` (synthetic world, real ledger, detection, simulated reviewer, levers) and `experiments/run.ts` (metrics, gates, arms, sweeps) |

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
| Effort tiers: NC at least 10, 30 and 80 gives tiers 1, 2 and 3. Tier 0 is the floor for everyone, including negative NC | index 1.00 / 1.12 / 1.20 / 1.25 |
| Vouch capacity per 30 days: 2, plus 1 per vouch that worked out (at most +3), minus 2 per lost stake. Range 0 to 5. 0 for 90 days after abuse or fraud | |
| Organizing reach: 8 people, plus 2 for every 3 sessions, up to 16. 4 for 90 days after abuse or fraud | |

### Effort overlay (concrete knobs)

| Tier | judge pass 2 topK / groupTopK | deep pass (pass 3) | concierge research depth | standing-intent re-search | plan options |
|---|---|---|---|---|---|
| 0 (floor = today's defaults) | 10 / 3 | off | 3 | every 3 days | 3 |
| 1 | 12 / 3 | off | 4 | every 3 days | 3 |
| 2 | 12 / 4 | on, top 3 | 4 | every 2 days | 4 |
| 3 (cap) | 14 / 4 | on, top 4 | 5 | every 2 days | 4 |

`OVERLAY_ENGINE_KEYS = ["judge"]`. A test checks that the overlay's engine part sets only the judge knobs. It never sets weights, thresholds, budgets, exposure or selection. The overlay is meant to apply only when the engine serves this member's own intents. The engine has no per-seeker config today: that is integration ask 2.

## How it was measured

```bash
bun run packages/capital/experiments/run.ts --json runs/capital/2026-10-08-default.json   # arms A-F, 8 seeds, 90 days (~10 s)
bun run packages/capital/experiments/run.ts --effort-sweep                               # effort thresholds x effect size
bun run packages/capital/experiments/run.ts --sweep                                      # period cap x pair decay
bun test packages/capital
```

Seeds 1-8. Each seed is a fresh population and event stream. Arms are paired: every arm uses the same seeds, and outcome draws come from a separate stream with one draw per outcome. So "lever on" and "lever off" see the same luck. ± is the standard error over 8 seeds.

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
- Answered needs arrive weekly. Organizers run their crews weekly.
- Detection runs every evening. Each flag goes to the reviewer 2 days later.

**Assumptions (harness only):**
- **A1 effort effect:** P(good outcome) = q x (1 + effortGain x (effortIndex - 1)), with effortGain 0.4. The capped top tier therefore gives +10% relative (q = 0.5 for intros, 0.45 for crews, 0.75 for useful help). This applies to the member the match was made for. Arm C uses effortGain 1.0 (+25%).
- **A2 life-driven flakiness:** 30% of accepted plans are cancelled a day ahead, 6% are no-shows after confirming, and 1% are ghosted. It does not depend on how much the member wants to take part.
- **A3:** adversaries also behave like regular members. Gaming is on top of that.
- **A4 reviewer:**
  - confirms a flag that contains a true adversary with p 0.9;
  - confirms an all-honest flag with p 0.02;
  - does not review the same set again within 14 days;
  - after a confirmation, the adversary stops that strategy (suspended from it).
- **V14** follows the definition in `engine/src/attention.ts`. The eligible members are adults with tenure of at least 14 days who are not Paused or Quiet, plus active invitees. Sybils are excluded. Members are ranked by **NC at day 45**, and V14 is measured over **days 45-89**, so NC comes before the outcomes. Value events are true outcomes; staged "value" is excluded.
- **Gaming gain** = for each adversary, the sum of NC from staged events, plus vouch credits for sybils, plus clawbacks, fraud and stake entries. **Bound:** the mean per strategy is at most 25% of an honest regular member's 90-day NC.

## Results (8 seeds, 90 days)

### Launch gates (arm A, default)

| Gate | Result | |
|---|---|---|
| Bottom NC decile V14 at least 80% of the top decile's (as written) | 0.74 ± 0.03 (worst seed 0.64) | **FAIL**. The same population with every lever off gives 0.75 ± 0.02 (arm B) |
| Change in that ratio caused by NC (A minus B, paired) | **-0.010 ± 0.008** (top decile V14 +0.020, bottom +0.009) | PASS against the proposed bound of at least -0.02 |
| Same, effort effect x2.5 (C minus C0) | -0.016 ± 0.010 | PASS |
| No gaming strategy yields more than a small bounded gain (detection on) | vouch ring -8.5 ± 0.8, staged -9.4 ± 0.0, help farm -10.2 ± 0.2 NC (regular member +16.5) | **PASS** (all negative) |

V14 by NC decile (arm A): 0.45 0.40 0.42 0.45 0.49 0.49 0.51 0.52 0.50 0.61. In seed 1:
- The bottom decile is mostly caught adversaries (negative NC) and low-activity members.
- Decile 2 is mostly new invitees.
- The top decile is 10 of the 12 organizers plus helpers.

The organizers run a weekly crew, so they get value every week whatever their effort tier. The raw gap therefore measures how much people take part, and no NC default can close it. Lowering the effort thresholds does not change the raw ratio either (sweep below).

### Arms

| Arm | NC Gini (adults) | honest at T0 / T1 / T2 / T3 | V14 ratio | regular NC | vouch ring gain | staged gain | help farm gain | detected | median TTD | honest flagged | bad invitees admitted per seed | vouch quality |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A default | 0.57 | 231 / 158 / 29 / 0 | 0.74 | 16.5 | -8.5 | -9.4 | -10.2 | 94% / 100% / 100% | 9.0 / 8.6 / 8.8 d | 0.2% (0 confirmed) | 57.4 | 0.30 |
| B effort lever off | 0.56 | (same NC) | 0.75 | 16.4 | -8.5 | -9.4 | -10.2 | same | same | 0.2% | 56.5 | 0.30 |
| C effortGain 1.0 | 0.57 | 230 / 160 / 29 / 0 | 0.74 | 16.5 | -8.5 | -9.4 | -10.2 | same | same | 0.2% | 57.9 | 0.30 |
| D detection off | 0.56 | 228 / 160 / 27 / 0 | 0.59 | 16.6 | **+16.6 (101%)** | +4.0 (24%) | +8.6 (52%) | 0% | n/a | 0% | 78.5 | 0.27 |
| E no decay, no cap (detection on) | 0.57 | 205 / 164 / 47 / 1 | 0.67 | 21.2 | -8.3 | -8.1 | -10.1 | same | same | 0.2% | 57.4 | 0.30 |
| F vouch-capacity lever off (3 per 30 days) | 0.57 | 249 / 165 / 26 / 0 | 0.72 | 16.6 | -7.8 | -9.4 | -10.4 | 94% / 100% / 100% | 8.1 / 8.6 / 8.8 d | 0% | **67.1** | 0.27 |

What the arms show:
- **The review queue does the work against gaming, and the decay rules bound what is left (D).** Without review, a vouch ring member gains about as much as an honest regular member earns, a help farmer gains half that, and a staged pair gains 24%. The gain is bounded: the pair decay limits each counterpart to about 2x the base credit per window, and the cap limits each month. But it is not small for rings. Uncaught rings also lower the V14 ratio (0.59), because inflated adversaries sit in the upper deciles with ordinary V14.
- **Decay and cap protect fairness more than they stop gaming (E).** Without them, an honest regular member reaches 21.2 NC, members reach tier 2 or 3 about twice as often (48 vs 29 per seed), and the raw ratio falls to 0.67. With detection on, gaming still loses in both arms.
- **The vouch-capacity lever admits fewer bad invitees (A vs F):** 57.4 vs 67.1 per seed (-14%), and vouch quality rises from 0.27 to 0.30. Bad vouchers send 38.8 invitations per seed instead of 48.5. Vouch quality by voucher type (A): good 0.36, mediocre 0.38, bad 0.15, vouch ring 0.00. Absolute vouch quality is low in this simulator, because "value within 30 days" depends on the sim's V14 of about 0.49. Read the differences between arms, not the levels.
- **Detection precision:** 22 flags per seed. 0.2% of honest members were ever flagged, and none was wrongly confirmed. Before engine-made intros were excluded from ring detection, 37% of honest members were flagged, because an engine intro confirms both people by design. Ring detection now uses member-controlled credits only (help, needs, member-started plans, vouches).

### Flaky members (real-life reasons)

| | flaky (legit) | regular |
|---|---|---|
| NC at day 90 | 11.9 ± 0.4 | 16.5 ± 0.2 |
| members with any penalty | 11% | |
| mean penalty | 0.33 NC | |
| members who lost more than 3 NC to penalties | 2% | |
| below the regular median effort tier | 36% (at the floor; the median regular is at tier 1) | |

Penalties are not the problem: cancelling with notice is free, and the forgiven no-show absorbs most of the rest. The 4.6 NC gap is credit they did not earn, because they attended about 30% fewer plans. In the simulator, the effort difference this causes is +12% effort for tier 1 over the floor, worth about 1% V14. If the founders want parity, one option is to count a cancellation with notice as half an attendance credit. That would reward cancelling, which is why it is not the default.

### Effort sweep (paired on/off, `--effort-sweep`)

| thresholds | effortGain | tiers T0/T1/T2/T3 (honest, day 90) | V14 ratio on | V14 ratio off | on - off (paired) | top decile V14 gain |
|---|---|---|---|---|---|---|
| 20, 60, 150 | 0.4 | 348/68/1/0 | 0.75 ± 0.03 | 0.75 ± 0.02 | -0.007 ± 0.006 | 0.013 |
| 20, 60, 150 | 1 | 348/68/1/0 | 0.74 ± 0.03 | 0.75 ± 0.02 | -0.015 ± 0.008 | 0.026 |
| **10, 30, 80 (default)** | 0.4 | 231/158/29/0 | 0.74 ± 0.03 | 0.75 ± 0.02 | -0.010 ± 0.008 | 0.020 |
| 10, 30, 80 | 1 | 230/160/29/0 | 0.74 ± 0.03 | 0.75 ± 0.02 | -0.016 ± 0.010 | 0.032 |
| 5, 15, 40 | 0.4 | 163/137/103/15 | 0.74 ± 0.02 | 0.75 ± 0.02 | -0.011 ± 0.009 | 0.021 |
| 5, 15, 40 | 1 | 162/136/106/15 | 0.70 ± 0.03 | 0.75 ± 0.02 | **-0.050 ± 0.014** | 0.051 |

Trade-off: with 20/60/150, the lever almost never bites in 90 days (1 member at tier 2). With 5/15/40, it bites hard and, at the high effort effect, takes 5 points off the ratio. **10/30/80 is the default:** about 45% of honest members get some extra effort by day 90, at a cost of at most 0.02 to the ratio even at 2.5x the assumed effect. Tier 3 (NC of at least 80) is not reached in 90 days. It is a ceiling, not a target.

### Anti-gaming sweep (`--sweep`; gains with detection off, as a share of a regular member's NC)

| periodCap | pairDecay | regular NC | flaky NC | vouch ring | staged | help farm | with detection: worst strategy |
|---|---|---|---|---|---|---|---|
| 25 | 0.35 | 16.5 | 12.2 | 14.9 (91%) | 3.3 (20%) | 7.1 (43%) | -52% |
| 25 | 0.5 | 16.5 | 12.3 | 16.4 (100%) | 4.0 (24%) | 8.6 (52%) | -52% |
| 25 | 0.7 | 16.5 | 12.3 | 20.2 (123%) | 5.5 (33%) | 12.3 (75%) | -51% |
| 40 | 0.35 | 16.5 | 12.3 | 15.1 (92%) | 3.3 (20%) | 7.1 (43%) | -52% |
| **40** | **0.5** | 16.6 | 12.3 | 16.6 (101%) | 4.0 (24%) | 8.6 (52%) | -52% |
| 40 | 0.7 | 16.6 | 12.3 | 20.5 (124%) | 5.5 (33%) | 12.3 (74%) | -51% |
| 60 | 0.5 | 16.6 | 12.3 | 16.6 (101%) | 4.0 (24%) | 8.6 (52%) | -52% |

The 60/0.35 and 60/0.7 rows are omitted; they match the 40-cap rows.

- The cap does not bind for honest members in this simulator (about 6 NC per month). It is a backstop for a burst of credits.
- A pair decay of 0.35 trims undetected gains by about 10%. It would also cut honest repeat relationships (second encounters, regular crews), which PRD 21 counts as value, so 0.5 is kept.
- The decay rules cannot make undetected rings small. Only review and clawback can.

## Integration asks (events the Network must emit)

1. **Event feed.** The Network should emit `CapitalEvent`s (`src/types.ts`) from records it already keeps, each with a unique id and the Clock time:
   - `member_joined` (age and `vouchedBy`), `member_activated`;
   - `value_received` (the V14 value event, with the members who provided it);
   - `safety_flag`, `member_removed` (with the reason), `abuse_confirmed`;
   - `plan_accepted` (with `startsAt`), `plan_confirmed` (the morning-of or day-before confirmation), `plan_cancelled`, `plan_no_show`, `plan_ghosted`;
   - `plan_attended` (counterparts, `verifiedBy`, origin engine/member/organizer, public venue), `feedback_given`;
   - `help_given` and `help_confirmed` (the recipient's "was this useful?");
   - `organized` (public venue, recurring, checked-in attendees, public label);
   - `need_answered`, `review_completed`;
   - `fraud_confirmed` (reviewer action);
   - optionally `declined`, `state_changed`, `data_shared` and `help_asked`, which are accepted and ignored.

   **New signals the Network does not record today:**
   - an explicit confirmation step (needed so that a no-show only counts after confirming);
   - the plan's origin;
   - how attendance was verified (counterpart, check-in, organizer);
   - the recipient's help confirmation;
   - the organizer's check-in list;
   - `plan_ghosted` (accepted, then no reply through the start).
2. **A per-seeker effort overlay in the engine.** `effortOverlay(...).engine` is a deep-partial `EngineConfig` touching only `judge.topK`, `judge.groupTopK` and `judge.deep`. The engine has one config per run. It needs a way to apply a member's overlay only to the candidates generated for that member's own intents, and to use it for nothing else. The Network needs `conciergeResearchDepth`, `intentReSearchDays` (replacing the constant 3 days in `network.ts openRequest`) and `planBuildingOptions`.
3. **Review queue.** Route `detectGaming` flags into the existing human review queue with their evidence counts. A reviewer decision becomes a `fraud_confirmed` event, or nothing. The gaming gate depends on this: without it, rings keep about 1x a regular member's NC.
4. **Vouch capacity and organizing reach** must be read at invite time and crew creation. Invitees still opt in, and attention budgets still apply.
5. **Member web and text:** `whatYouBuilt(ledger.entriesFor({ member }, member))` for "what have I built?". Staff reads go through `entriesFor({ staff, role, reason }, member)`, which records them in `audit()`.

## Limitations

- **The world is synthetic and simple.** It has no geography, schedules or embedding fit. Intros pick a random counterpart and value is a coin flip. The *direction* of each lever effect can be trusted; the absolute levels (V14 of about 0.49, vouch quality of about 0.30) cannot.
- **The adversaries do not adapt.** For example, they never avoid reciprocity, or spread across many counterparts with sybils. Such a strategy would evade the ring detector and earn at most the pair-decay bound per counterpart. Each sybil also needs a vouch, and vouches are capacity-limited.
- **The reviewer is simulated (A4).** The 2% wrong-confirm rate never fired, because only 0.2% of honest members were ever flagged.
- **Runs are 90 days long.** Nobody reaches tier 3, so caste effects that build over a longer time are not measured. Rerun at 180-365 days before launch.
- The organizing credit is open to staged crews at public venues with real check-ins. It is not modelled.

## Not in scope / not changed

- `packages/engine` and `packages/core` were not edited. `packages/capital` imports `isMinor` and `DAY`/`HOUR` from core and the `EngineConfigInput` type from engine **by relative path**, because adding a workspace dependency would change `bun.lock`. No new core type was needed: `MemberId` is reused.
- `bun test packages/capital`: 30 pass, 0 fail. `bunx tsc --noEmit -p .`: clean.
