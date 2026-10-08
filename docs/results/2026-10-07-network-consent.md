# Can the consent-first Network reach 90% "everyone says yes"? (2026-10-07)

Design: [docs/network.md](../network.md). Runbook: [docs/runbook-simulation.md](../runbook-simulation.md). Raw results: [network/](network/). **No LLM calls, $0.**

## 1. Answer

**No. The simulated consent-first Network does not reach 90%.**

**Current code (section 12, attention v1.2 send path, measured 2026-10-07 later):**

| | Everyone-yes rate of booked plans | Invite accept rate | Meetings held (3 seeds) |
|---|---|---|---|
| **Consent-first, send path v1.2, 3 seeds pooled (21 days)** | **0.853** (214/251), 95% CI 0.803-0.891 | 0.924 (464/502) | 173 |
| Consent-first, send path v1.2, time-aware simulator, 3 seeds pooled | 0.800 (188/235), 95% CI 0.744-0.846 | 0.903 (419/464) | 95 |
| Push v2 (no probes, no gates), same code, 3 seeds pooled | 0.216 (240/1111) | 0.479 (906/1891) | 188 |
| Push baseline (StubNetwork), same code, 3 seeds pooled | 0.126 (125/995) | 0.390 (446/1143) | 90 |

**Caution:** on a booked plan, silence counts as a yes (the member's own decision counts). Before section 12, only a typed yes counted. The rows below use the old definition and older code. Compare them with the rows above only with that in mind.

**Older code (sections 4-11):**

| | Everyone-yes rate of revealed proposals | Invite accept rate |
|---|---|---|
| Consent-first on the founder outreach defaults (72 h, D6, Receiving 2/7d, folded acks), 3 seeds pooled (21 days) | 0.818 (198/242), 95% CI 0.765-0.862 | 0.825 (434/526) |
| Consent-first after the Network fixes, 3 seeds pooled (21 days) (section 11) | 0.838 (201/240), 95% CI 0.786-0.879 | 0.830 (438/528) |
| Consent-first before the fixes, 3 seeds pooled (21 days) | 0.816 (200/245), 95% CI 0.763-0.860 | 0.814 (433/532) |
| Consent-first with live asks, 3 seeds pooled (before the fixes) | 0.846 (248/293), 95% CI 0.801-0.883 | 0.839 (535/638) |
| Best single run | 0.889 (seed 1, live asks, before the fixes) | 0.845 |
| Push v2 (no probes, no gates), 3 seeds pooled (before the fixes) | 0.206 (281/1365) | 0.419 |
| Push baseline (StubNetwork), 3 seeds pooled (before the fixes) | 0.097 (95/978) | 0.397 |

- Section 12 has all three arms on the current code (the attention v1.2 send path). Section 11 has the consent arm after the earlier Network fixes. Sections 4-6 are from the earliest code.
- After the fixes, the consent arm passes the safety gates on all three seeds. The only violation is the known `two_unanswered` judge issue (section 11.2).
- Consent-first is 4 times the push v2 rate and 8 times the baseline rate (older code). On the current code: 3.9 times and 6.8 times.
- Under the simulator's own model, 0.90 is close to the ceiling for a pair (section 6.3). Each person who said yes to the probe still accepts the reveal with probability 0.95, so a pair reaches 0.95 x 0.95 = 0.90. Reaching 90% needs every other loss to be zero.
- The largest loss is requesters who decline the match they asked for (section 5). Part of it is a simulator effect: personas can ask for wants they no longer hold. Turning that off (`--live-asks`) raises the pooled rate from 0.816 to 0.846.
- Consent-first holds fewer meetings than push v2 (older code: mean 47 against 68 in 21 days). It asks first, so fewer opportunities reach a reveal. On the current code the gap is smaller: mean 57.7 against 62.7 (section 12).

The founder-default run (`docs/results/network/consent-21d-seed{1,2,3}.json`: 0.866, 0.835, 0.747; 129 meetings; 0 opt-outs; 0 honest members flagged) is within noise of the run before it (z about 0.6). 90% is not reached.

## 2. Metrics

Both metrics come from `summarize()` in `packages/network/harness/experiment.ts`.

| Metric | Definition |
|---|---|
| Revealed proposal | A proposal the Network recorded (a `proposal` run record). The ConsentNetwork records a proposal only at the reveal, when it names the people. Probes that never reached a reveal are not counted. The push arms record every proposal they send. |
| **Everyone-yes rate** | Revealed proposals where at least 2 members got an invitation message and every one of them accepted (persona decision `accept` or `counter`), divided by all revealed proposals. Strict: a group where one member declines counts as a failure, even if the meeting happens. |
| **Invite accept rate** | Distinct (proposal, member) accepts divided by invitation messages. Invitation messages are reveals plus nudges (both have type `proposal`), so the rate is a little lower than accepts per invited member. |
| Meetings held | Meetings where at least 2 members showed up |
| Precision | Revealed proposals that the oracle (the simulator's hidden answer key) rates compatible |
| Unsafe | Revealed proposals that the oracle flags unsafe (a minor, an adversarial persona, exes, a romance mismatch) |
| Probe yes rate | Probe yeses divided by probe answers and expiries |

## 3. Setup

| Item | Value |
|---|---|
| Command | `bun run packages/network/harness/experiment.ts --days 21 --seed N` for N = 1, 2, 3 (all three arms) |
| Extra runs (seed 1, consent arm) | `--primed-identity 0.90`, `--primed-identity 0.98`, `--primed-met 0.9 --primed-partial 0.75`, `--days 42`, and `--live-asks` for seeds 1-3 |
| World | 250 NYC members of `data/synthetic/v1`, plus friends they invite (friend factory, about 70% join) |
| Persona agents | Deterministic policy (`PolicyPersonaAgent`); no LLM |
| Engine | engine-v1 defaults, run once a day by the Network, without an LLM (the judges do not run) |
| Review | `review: "auto"`: the simulated reviewer approves every queued opportunity. Every opportunity is still queued and approved before anyone is contacted. |
| Oracle model | `PRIMED_MODEL = { met: 0.96, partial: 0.82, identity: 0.95 }` unless a flag changes it ([network.md](../network.md) section 9) |
| Model and request settings | None. No LLM call is made. |
| Code | The working tree on 2026-10-07 at about 22:50 PDT, with the review gate, age policy, send-time checks, outreach rules and leak guard in place |
| Determinism | Seed 1 consent was run twice; the JSON was identical |
| Wall time | 70-110 s per arm for 21 days; 240 s for 42 days (one laptop, heavily loaded) |

What is generated and what is hand-written:

- Generated by the harness: every file in [network/](network/) named `arms-*`, `consent-42d-*`, `sensitivity-*`, `live-asks-*`.
- Hand-written analysis (scratch scripts, not in the repo, described in sections 5 and 6): [network/consent-21d-failure-breakdown.json](network/consent-21d-failure-breakdown.json) and [network/ceiling-cold-pairs.json](network/ceiling-cold-pairs.json).
- Confidence intervals: Wilson 95% intervals. Pooled intervals treat proposals from different seeds as independent.

## 4. Results by arm and seed (21 days)

| Arm | Seed | Revealed | Everyone-yes | Invite accept | Meetings | Precision | Unsafe | Proactive per member-week | Opt-outs |
|---|---|---|---|---|---|---|---|---|---|
| push_baseline | 1 | 327 | 0.101 | 0.401 | 29 | 0.346 | 33 | 0.39 | 0 |
| push_baseline | 2 | 326 | 0.098 | 0.417 | 25 | 0.270 | 32 | 0.42 | 0 |
| push_baseline | 3 | 325 | 0.092 | 0.373 | 24 | 0.289 | 36 | 0.39 | 0 |
| push_v2 | 1 | 454 | 0.203 | 0.427 | 64 | 0.251 | 7 | 0.81 | 0 |
| push_v2 | 2 | 449 | 0.216 | 0.421 | 72 | 0.229 | 6 | 0.80 | 0 |
| push_v2 | 3 | 462 | 0.199 | 0.409 | 68 | 0.214 | 8 | 0.82 | 0 |
| **consent** | 1 | 81 | **0.753** (0.649-0.834) | 0.780 | 47 | 0.358 | 3 | 0.90 | 0 |
| **consent** | 2 | 85 | **0.847** (0.756-0.908) | 0.831 | 50 | 0.400 | 1 | 0.92 | 0 |
| **consent** | 3 | 79 | **0.848** (0.753-0.911) | 0.831 | 43 | 0.278 | 1 | 0.92 | 0 |

Consent arm, more detail:

| Seed | Queued for review = approved | Probes sent | Probe yes rate | Requests | Request fulfilled | Median hours to fulfil | New members | Bad actors restricted | Honest members flagged |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 359 | 725 | 0.26 | 265 | 0.185 | 24 | 20 | 10/10 | 0 |
| 2 | 389 | 761 | 0.26 | 272 | 0.243 | 21 | 24 | 7/7 | 0 |
| 3 | 397 | 777 | 0.26 | 269 | 0.212 | 30 | 22 | 7/7 | 0 |

Gate reasons (engine proposals not started), seed 1: `participant_unavailable` 472, `want_not_named` 182, `daily_cap` 22, `unresponsive` 7. Seeds 2 and 3 are similar (see the JSON).

Notes:

- About 370-400 opportunities are approved per run, but only about 80 reach a reveal. The probes filter them: 26% of probe answers are yes.
- The consent arm's unsafe proposals (1-3) all include an adversarial persona who had not acted yet. Every bad actor who acted was restricted.
- Proactive messages per member-week (about 0.9) stay under the Normal budget of 2.

## 5. Where everyone-yes fails

Hand-written analysis of the same three consent runs ([network/consent-21d-failure-breakdown.json](network/consent-21d-failure-breakdown.json)). For each revealed proposal it takes the origin from the `probe_started` log and checks each invited member.

| Origin | Revealed | Everyone-yes | Rate |
|---|---|---|---|
| Member request | 222 | 180 | 0.81 |
| Engine | 20 | 19 | 0.95 |
| Newcomer welcome | 1 | 1 | - |

Every revealed proposal was a pair. Two proposals counted in section 4 had fewer than 2 invitation messages; they count as failures there and are not in this table.

Invited members who did not accept (53 in all):

| Who | Said no | Did not answer |
|---|---|---|
| The requester (who asked for this) | **30** | 3 |
| A probed member (said yes to the probe) | 11 | 8 |

- **Requesters who decline their own match are the largest loss (57%).** The persona asked for a want, then judged the match on its hidden wants. When the want has lapsed in hidden truth, the persona has little reason to accept. With `--live-asks` (personas ask only for live wants), the pooled rate rises from 0.816 to 0.846. The live-ask runs were not split by cause, so how many requester declines this removes is not measured.
- **Probed members who say no at the reveal** are the identity veto: 0.95 per person by assumption (section 6.3).
- **No answer** at the reveal (11) is the rest. The reveal expires after 30 hours.

## 6. The ceiling

### 6.1 Cold proposals cannot reach 90%

Hand-written analysis ([network/ceiling-cold-pairs.json](network/ceiling-cold-pairs.json)): `Oracle.evaluate()` on every pair of NYC adults who are not adversarial (215 people, 23,005 pairs), as an intro with a window of days 1-5. Mutual accept is the product of the two acceptance probabilities. This is a cold proposal: no probe and no ask.

| Oracle seed | Best pair | Top 0.1% of pairs (99.9th percentile) | 99th percentile | Median | Pairs at 0.9 or more |
|---|---|---|---|---|---|
| 1 | 0.694 | 0.545 | 0.361 | 0.011 | 0 |
| 2 | 0.700 | 0.503 | 0.366 | 0.011 | 0 |
| 3 | 0.693 | 0.530 | 0.362 | 0.011 | 0 |

- No NYC pair reaches 0.9 mutual accept for a cold proposal. The best 0.1% are about 0.50-0.55.
- For the oracle's compatible pairs (about 1,700 per seed), the median mutual accept is 0.15.
- An earlier analysis with different inputs found a maximum of 0.84 ([match failures](../research/2026-10-07-match-failures-and-diversity.md)). Both are below 0.9.
- So no selection rule can make a push Network reach 90%. The measured push rates (0.10 and 0.21) agree.

### 6.2 What consent-first changes

Consent-first moves the decision to the probe. The probe describes the activity, the time, the place and the reason, but no name. A member says yes only when they want this, this week. At the reveal, the content is already decided; only the identity of the others is new. In the model:

- A member who said yes to the probe accepts the reveal with probability `identity` (0.95).
- A member who asked for this accepts with 0.96 when the others meet their want, 0.82 for a partial fit, and the cold model otherwise.

The cost is volume. Most probes get a no or no answer, so far fewer opportunities reach a reveal (about 80 against about 450 for push v2 in 21 days), and fewer meetings happen.

### 6.3 The identity veto

| Opportunity | Ceiling on everyone-yes |
|---|---|
| Pair, both probed | 0.95 x 0.95 = **0.9025** |
| Pair, requester with a met want + one probed member | 0.96 x 0.95 = 0.912 |
| Pair, requester with a partial fit + one probed member | 0.82 x 0.95 = 0.779 |
| Group of 3, all probed | 0.95^3 = 0.857 |

These are ceilings under the model, before no-answers, cancellations and lapsed wants. The engine opportunities reach 19 of 20 (0.95), which is at the ceiling, but the sample is small.

### 6.4 Sensitivity (seed 1, consent arm)

| Run | Everyone-yes | Invite accept | Pair ceiling |
|---|---|---|---|
| Default (`identity` 0.95) | 0.753 (61/81) | 0.780 | 0.90 |
| `--primed-identity 0.90` | 0.693 (61/88) | 0.790 | 0.81 |
| `--primed-identity 0.98` | 0.831 (69/83) | 0.814 | 0.96 |
| `--primed-met 0.9 --primed-partial 0.75` | 0.759 (63/83) | 0.801 | 0.86 (requester + probed) |

- The rate moves with the identity assumption, as the model predicts. Seed 1 is the lowest seed, and each run is one sample, so these show the direction, not the size. Changing `PRIMED_MODEL` also changes the random path of the run.
- The identity value is an assumption. Nobody has measured it on real members. It is the most important number to measure in the pilot.

### 6.5 Longer and live-ask runs

| Run | Revealed | Everyone-yes | Invite accept | Meetings | Request fulfilled | New members | Opt-outs |
|---|---|---|---|---|---|---|---|
| 42 days, seed 1 | 169 | 0.799 (0.732-0.852) | 0.814 | 103 | 0.218 | 45 | 0 |
| Live asks, seed 1 | 99 | 0.889 | 0.845 | 62 | 0.401 | - | 0 |
| Live asks, seed 2 | 92 | 0.837 | 0.843 | 47 | 0.326 | - | 0 |
| Live asks, seed 3 | 102 | 0.814 | 0.828 | 57 | 0.315 | - | 0 |

The 42-day run holds its rate. Live asks raise everyone-yes, meetings and request fulfillment, because requesters now ask for things they still want.

## 7. Safety gates

The judge (`computeMetrics` with the Network's weekly budget) on the three 21-day consent runs:

| Seed | Canary leaks | Minor contacts | Errors | Invariant violations |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 1 `two_unanswered` |
| 2 | 0 | 0 | 0 | 2 `two_unanswered`, **2 `duplicate_send`** |
| 3 | 0 | 0 | 0 | 1 `two_unanswered` |

- Every `two_unanswered` violation is the one allowed re-engagement message after 14 days of silence (`meta.reengagement: true`). This is a judge rule issue, not a Network bug ([network.md](../network.md) section 11).
- **The 2 `duplicate_send` violations are real Network bugs** (section 9). The safety gate requires 0, so the consent arm does not pass the gate on seed 2.
- **Fixed.** After the fixes, all three seeds have 0 `duplicate_send` violations and 1 `two_unanswered` each (section 11.2).

## 8. What would push the rate further

In order of expected effect. None of these is measured, except where the table says so.

| Change | Where | Expected effect |
|---|---|---|
| Personas ask only for live wants (`liveAsksOnly` default on) | `packages/sim` (sim owner) | Measured: +3 pp pooled (0.816 to 0.846). Makes the simulator honest; not a product change. |
| Confirm the want with every requester before the reveal (a confirm-probe, not only for partial fits and withdrawn wants) | `packages/network` | The requester becomes probe-primed (0.95) instead of ask-primed. Removes most requester declines. Costs one message per request. |
| A better reveal: one shareable fact about the other person and a specific reason ("you both want to start a band; they play bass") | `packages/network/src/copy.ts` | The only lever above the 0.90 ceiling: it raises the identity acceptance. The 0.98 sensitivity run gives +8 pp on seed 1. Measure it in the pilot; the simulator ignores wording. |
| Keep pairs; use groups only with a strong anchor | gates | A group of 3 has a lower ceiling (0.857). All revealed proposals are pairs today, so no change now. |
| Reveal when the member is likely to answer; shorter reveal TTL with one nudge | `packages/network` | Cuts the 11 no-answers |
| Fix the feedback classifier (section 9) | `packages/network/src/classify.ts` | Bad meetings become "avoid" pairs, so later proposals improve |

What does not help: stricter gates. They lower volume, and the all-yes losses are at the reveal, after the gates.

## 9. Bugs found during this run

Both are in `packages/network`. Both are now fixed (section 11.1).

1. **"not great" reads as positive.** `feedbackOf()` in `classify.ts` checks the positive words first, and "great" matches inside "not great". So "Honestly not great, we didn't have much to talk about" is recorded as positive. The Network then sends "Glad that went well" with a growth ask after a bad meeting, does not add an "avoid" pair, and can vouch for a skill.
2. **Duplicate replies.** (a) A member who answers the feedback question with "See you there." gets "Thanks, that's really helpful.", and the real feedback 7 minutes later gets the same text again. (b) A member aged 13-17 who sends several short messages gets the same venue suggestion each time. The judge flags both as `duplicate_send` (same text to the same member within 10 minutes).

## 10. Change from earlier runs

| Run | Consent everyone-yes, seeds 1 / 2 / 3 |
|---|---|
| 2026-10-06 (before the review gate, age policy, send-time checks and outreach rules) | 0.670 / 0.653 / 0.688 |
| 2026-10-07, earlier in the day (after those changes; reported by the Network work) | 0.874 / 0.840 / 0.831 |
| 2026-10-07, this report | 0.753 / 0.847 / 0.848 |
| 2026-10-07, after the Network fixes (section 11) | 0.765 / 0.875 / 0.873 |

The engine package (`packages/engine`, another work stream) changed between the second and third rows, and seed 1 moved most. This report did not isolate the cause. The files in [network/](network/) are replaced by this report's runs.

## 11. Re-measured after the Network fixes (2026-10-07, later)

The Network work stream fixed the bugs in section 9 and made other changes in `packages/network` and `packages/observatory`. The simulator work stream changed `packages/sim/src/world.ts` and `packages/sim/src/stubNetwork.ts`. This section runs the consent arm again on the combined working tree.

### 11.1 What changed

| Change | Where |
|---|---|
| `feedbackOf()` checks negations first ("not great", "didn't click"). A bad meeting is negative and adds an "avoid" pair. | `packages/network/src/classify.ts` |
| "How did it go?" is answered only for a held meeting with no feedback yet. An acknowledgement ("See you there.") gets no reply. `send()` never sends the same text to one member twice within 10 minutes (`send_skipped`). | `packages/network/src/network.ts` |
| Members aged 13-17 get different venues on repeat messages, and no reply when the nearby ideas run out | `network.ts`, `geo.ts` |
| Logs keep no member text; `forget()` removes a declined member everywhere; review refuses to approve an item with a declined member or a minor; request retries send nothing before review | `network.ts`, `packages/observatory` |
| Engine questions (`EngineResult.asks`) go out as proactive questions, at most one per member per 7 days, never to members aged 13-17 | `network.ts` |
| The simulator snapshot carries the run's records; the oracle gets the proposal category; the StubNetwork never repeats an acknowledgement | `packages/sim` |

The simulator changes do not move the consent arm. The ConsentNetwork builds the engine input from its own state and takes only members, facets, intents, presence and edges from the snapshot. They do move every StubNetwork baseline that uses an engine: [2026-10-07-stub-baseline-history.md](2026-10-07-stub-baseline-history.md) has the numbers before and after. The 3-4 engine questions per seed are `romance_prefs` only, because `ask.enabled` is off by default.

### 11.2 Results (consent arm, 21 days)

Commands, from the repository root:

```bash
bun run packages/network/harness/experiment.ts --days 21 --seed N --only consent   # N = 1, 2, 3
```

The judge numbers come from `computeMetrics(records, { weeklyBudget: OUTREACH.maxPerWeek })` on the records of the same runs. A scratch script (not in the repo) ran the same `World` setup as `runArm()`. Its `summarize()` output was identical to the harness JSON for every seed, so the judge saw the same runs.

| Seed | Revealed | Everyone-yes (Wilson 95% CI) | Invite accept | Meetings held | Precision | Unsafe | Invariant violations by rule | Minor contacts | Canary leaks | Errors | False flags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 81 | **0.765** (62/81, 0.662-0.844) | 0.797 (141/177) | 44 | 0.321 | 5 | 1 `two_unanswered` | 0 | 0 | 0 | 0 |
| 2 | 80 | **0.875** (70/80, 0.785-0.931) | 0.847 (150/177) | 44 | 0.363 | 2 | 1 `two_unanswered` | 0 | 0 | 0 | 0 |
| 3 | 79 | **0.873** (69/79, 0.782-0.930) | 0.845 (147/174) | 40 | 0.367 | 2 | 1 `two_unanswered` | 0 | 0 | 0 | 0 |
| Pooled | 240 | **0.838** (201/240, 0.786-0.879) | 0.830 (438/528) | 128 (mean 42.7) | - | 9 | 3 `two_unanswered` | 0 | 0 | 0 | 0 |

| Seed | Probes | Probe yes rate | Requests | Request fulfilled | Median hours to fulfil | New members | Bad actors restricted | Honest members restricted | Proactive per member-week |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 744 | 0.265 | 253 | 0.206 | 48 | 17 | 8/8 | 0 | 0.93 |
| 2 | 797 | 0.246 | 302 | 0.209 | 30 | 21 | 10/10 | 0 | 0.96 |
| 3 | 750 | 0.243 | 269 | 0.230 | 45 | 19 | 8/8 | 0 | 0.92 |

- **Safety gates pass.** 0 `duplicate_send`, 0 minor contacts, 0 canary leaks, 0 errors, 0 style failures on every seed. The 2 `duplicate_send` violations on seed 2 are gone. The `send_skipped` backstop did not fire in these runs.
- **The one violation per seed is the known judge issue.** On every seed it is one message to `ny-0244` with `meta.reengagement: true`: the one allowed re-engagement message after 14 days of silence ([network.md](../network.md) section 11). Before the fixes it was 1 / 2 / 1.
- **Everyone-yes: 0.838 pooled, against 0.816 before.** The difference is not significant (two-proportion z = 0.62). Each seed is one deterministic sample, and the code change reshuffles which requests happen.
- **Seed 1 (0.765) is still the lowest seed and is above the 0.75 test bar.** Its lower bound (0.662) is below 0.75, so the single-seed test can fail on noise. The pooled lower bound (0.786) is above 0.75.
- **Fewer meetings: mean 42.7 against 46.7 before.** Not analysed. One probable cause: a bad meeting now adds an "avoid" pair, so the gates block more pairs. This is not measured. The difference is about one standard deviation of the per-seed counts, so it can also be noise.
- **Unsafe proposals rose from 3 / 1 / 1 to 5 / 2 / 2.** Every one includes an adversarial persona (`adversarialInProposals` equals `unsafe` on each seed). Every bad actor who joined (spammers, scammers, harassers and prompt injectors: 8, 10 and 8) was restricted, and no honest member was restricted. This analysis did not check which unsafe proposals came before the adversarial persona acted.
- **Determinism and run time.** For each seed, the harness JSON and the scratch script's summary were identical. Each run took about 16 s of wall time.
- Not re-run: the push arms, the sensitivity runs, the 42-day run, the live-ask runs and the failure breakdown (sections 4-6). They are from the earlier code.

Raw results (generated):

- [network/consent-21d-seed1.json](network/consent-21d-seed1.json), [seed2](network/consent-21d-seed2.json), [seed3](network/consent-21d-seed3.json): the harness output.
- [network/consent-21d-judge.json](network/consent-21d-judge.json): the judge numbers above, written by the scratch script.

## 12. Re-measured on the attention v1.2 send path (2026-10-07, latest)

**This section uses newer code and a different definition from sections 1 (older rows) to 11. Do not mix its numbers with theirs.**

The Network now follows the engine session's send defaults, attention v1.2 ([network.md](../network.md) sections 4 and 6.4; before and after numbers in [2026-10-07-network-send-defaults.md](2026-10-07-network-send-defaults.md)): one daily send slot, only initial invites on the cap, probes one member at a time with 2-3 time options, and a booked plan with a 48-hour opt-out in place of the reveal. The simulator gained the opt-in time-aware personas, and the StubNetwork changed (stub baseline history: [2026-10-07-stub-baseline-history.md](2026-10-07-stub-baseline-history.md)). This section runs all three arms again on the combined working tree.

### 12.1 Setup

| Item | Value |
|---|---|
| Commands | `bun run packages/network/harness/experiment.ts --days 21 --seed N` (all three arms) and `... --days 21 --seed N --only consent --time-aware`, for N = 1, 2, 3; `... --days 42 --seed 1 --only consent` |
| World, personas, engine, oracle model | As section 3. The default persona policy, except the time-aware rows (`PolicyOptions.timeAware` and `WorldOptions.timeAware`: personas answer offered times from a hidden week, and a meeting at a time that clashes is missed with p = 0.7) |
| Review | `review: "auto"`, the simulated reviewer. Every opportunity is queued and approved before anyone is contacted. |
| Model and request settings | None. `OPENAI_API_KEY`, `SURPLUS_API_KEY` and `CEREBRAS_API_KEY` were empty. No LLM call, $0. |
| Code | The working tree in `/Users/shawwalters/thenetwork-console` on 2026-10-07 at about 17:17 PDT, after the network, simulator, service and console work of this round |
| Determinism | The consent rows are identical, seed by seed, to the "after" runs in the send-defaults report, which ran `--only consent` on an earlier tree of this round |
| Wall time | 3-8 s per arm for 21 days, 16 s for 42 days (six runs in parallel) |
| Sample size | 3 seeds; 70-90 booked plans per seed for the consent arm. Wilson 95% intervals; pooled intervals treat seeds as independent. |

Generated files: [network/arms-21d-send-path-seed1.json](network/arms-21d-send-path-seed1.json), [seed2](network/arms-21d-send-path-seed2.json), [seed3](network/arms-21d-send-path-seed3.json), [network/consent-42d-send-path-seed1.json](network/consent-42d-send-path-seed1.json). The time-aware consent runs are the "after_time_aware" entries of [network/send-defaults-21d.json](network/send-defaults-21d.json) (the re-run gave the same numbers). The tables are copied from these files by hand.

Definition change: the ConsentNetwork no longer reveals and then asks. It books the plan and tells each member once. **Everyone-yes** is now booked plans where every invited member decided yes, counting silence as a yes and a silent decliner as a no. **Invite accept** counts the same decisions. The push v2 arm (probes off) now also books the plan at once, with a named, proactive message, so its rates are not comparable with section 4.

### 12.2 Results by arm and seed (21 days, default persona policy)

| Arm | Seed | Booked or revealed | Everyone-yes | Invite accept | Meetings held | Precision | Unsafe | Proactive per member-week | Judge invariants / canary leaks / minor contacts |
|---|---|---|---|---|---|---|---|---|---|
| push_baseline | 1 | 342 | 0.123 | 0.398 | 35 | 0.304 | 34 | 0.51 | 0 / 0 / 0 |
| push_baseline | 2 | 330 | 0.133 | 0.401 | 29 | 0.300 | 37 | 0.52 | 0 / 0 / 0 |
| push_baseline | 3 | 323 | 0.121 | 0.372 | 26 | 0.307 | 31 | 0.50 | 0 / 0 / 0 |
| push_v2 | 1 | 367 | 0.234 | 0.485 | 68 | 0.275 | 5 | 0.66 | 0 / 0 / 0 |
| push_v2 | 2 | 363 | 0.204 | 0.474 | 60 | 0.264 | 5 | 0.64 | 0 / 0 / 0 |
| push_v2 | 3 | 381 | 0.210 | 0.479 | 60 | 0.297 | 11 | 0.69 | 0 / 0 / 0 |
| **consent** | 1 | 82 | **0.780** (64/82, 0.679-0.856) | 0.890 | 52 | 0.232 | 1 | 0.50 | 0 / 0 / 0 |
| **consent** | 2 | 79 | **0.886** (70/79, 0.797-0.939) | 0.937 | 56 | 0.392 | 2 | 0.50 | 0 / 0 / 0 |
| **consent** | 3 | 90 | **0.889** (80/90, 0.807-0.939) | 0.944 | 65 | 0.322 | 1 | 0.52 | 0 / 0 / 0 |
| **consent, pooled** | | 251 | **0.853** (214/251, 0.803-0.891) | 0.924 (464/502) | 173 | - | 4 | - | 0 / 0 / 0 |

"Proactive per member-week" for the consent arm counts initial invites only (founder decision 3). In section 4 it counted every proactive message.

Consent arm, more detail:

| Seed | Queued for review = approved | Probes sent | Probe yes rate | Requests | Request fulfilled | Median hours to fulfil | Booked plans cancelled | New members | Bad actors restricted | Honest members flagged | Moved to "only when I ask" |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 387 | 698 | 0.391 | 258 | 0.283 | 34 | 23 | 22 | 8/8 | 0 | 0 |
| 2 | 410 | 726 | 0.365 | 263 | 0.278 | 53 | 13 | 26 | 7/8 | 0 | 0 |
| 3 | 439 | 766 | 0.396 | 256 | 0.316 | 30 | 18 | 29 | 7/7 | 0 | 1 |

Gate reasons (engine proposals not started), seed 1: `participant_unavailable` 439, `want_not_named` 215, `unresponsive` 13, `daily_cap` 7.

PRD 28.2 scorecard proxy (`ArmResult.scorecard`, consent arm, seeds 1 / 2 / 3; simulator proxies, not pilot numbers):

| Score | Target | Value |
|---|---|---|
| Worthwhile interruptions (persona-judged initial invites) | 70% | 30% / 26% / 32% |
| Opt-in (probe yes rate, including requesters' time questions) | 40% | 39% / 37% / 40% |
| Completion (show rate of booked seats) | 70% | 86% / 89% / 88% |
| First good meeting within 14 days (members who joined in week 1) | 60% | 4% / 10% / 11% |

### 12.3 Time-aware simulator (consent arm, 21 days)

| Seed | Booked | Everyone-yes | Invite accept | Meetings held | Cancelled ("can't") | Completion | Unsafe | Judge invariants / canary leaks / minor contacts | Bad actors restricted |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 77 | 0.779 (60/77) | 0.889 | 32 | 35 | 72% | 0 | 0 / 0 / 0 | 8/8 |
| 2 | 88 | 0.818 (72/88) | 0.913 | 35 | 47 | 64% | 2 | 0 / 0 / 0 | 7/7 |
| 3 | 70 | 0.800 (56/70) | 0.906 | 28 | 38 | 65% | 2 | 0 / 0 / 0 | 7/7 |
| Pooled | 235 | **0.800** (188/235, 0.744-0.846) | 0.903 (419/464) | 95 | 120 | - | 4 | 0 / 0 / 0 | 22/22 |

### 12.4 42 days (seed 1, consent arm, default persona policy)

| Booked | Everyone-yes | Invite accept | Meetings held | Request fulfilled | New members | Cancelled | Judge invariants / canary leaks / minor contacts | Re-engagements | Bad actors restricted |
|---|---|---|---|---|---|---|---|---|---|
| 187 | 0.834 (156/187, 0.774-0.881) | 0.914 | 133 | 0.326 | 50 | 45 | 0 / 0 / 0 | 0 | 10/11 |

### 12.5 What the numbers say

- **90% is still not reached.** The pooled everyone-yes rate is 0.853 (95% CI 0.803-0.891). Two seeds (0.886 and 0.889) are close to the pair ceiling of 0.90 (section 6.3), but seed 1 is 0.780.
- **The definition moved the rate, so treat the change as small.** Against the founder-default row (0.818, older code and the old definition), z = 1.03, not significant.
- **Safety gates pass on all seven runs.** 0 invariant violations, 0 canary leaks, 0 minor contacts, 0 honest members flagged. The known `two_unanswered` judge issue did not fire: no run sent a re-engagement, because D6 needs 30 days of silence and a held top-quartile item.
- **Not every bad actor was restricted.** Seed 2 restricted 7 of 8 and the 42-day run 10 of 11 (8/8 and 7/7 on the other seeds). This analysis did not check whether the missed bad actor acted.
- **Consent-first now holds almost as many meetings as push v2** (173 against 188 over three seeds), with about one quarter of the opportunities and far fewer unsafe proposals (4 against 21).
- **Time awareness costs meetings.** With the time-aware simulator, meetings fall from 173 to 95, and about half the booked plans are cancelled (120 of 235). This is a simulator assumption (strict hidden weeks), not a measured member behaviour.
- **The push baseline moved** from 0.097 (section 4) to 0.126 pooled. The StubNetwork and the simulator changed in this round; this report did not isolate the cause.
- **Not re-run on this code:** the sensitivity runs, the live-ask runs, the failure breakdown and the cold-pair ceiling (sections 5, 6.1, 6.4 and 6.5).
