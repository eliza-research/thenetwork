# Can the consent-first Network reach 90% "everyone says yes"? (2026-10-07)

Design: [docs/network.md](../network.md). Runbook: [docs/runbook-simulation.md](../runbook-simulation.md). Raw results: [network/](network/) (the section 12 runs; the older JSON files are in git history at `16cde70`). **No LLM calls, $0.**

The runs used the network harness (`packages/network/harness/experiment.ts`), since deleted; validation on the current tree is `bun run sim`. Sections 2-11 (the older code) are summarized below; their full text is in git history at commit `16cde70` (`git show 16cde70:docs/results/2026-10-07-network-consent.md`).

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

The founder-default run (`docs/results/network/consent-21d-seed{1,2,3}.json`, in git history at `16cde70`: 0.866, 0.835, 0.747; 129 meetings; 0 opt-outs; 0 honest members flagged) is within noise of the run before it (z about 0.6). 90% is not reached.


## 2-11. Older code (summary)

- **Metrics (section 2):** everyone-yes = revealed (now booked) proposals where at least 2 members were invited and every one accepted; invite accept = accepts over invitation messages; meetings held = at least 2 members came. Before section 12, only a typed yes counted.
- **Setup (section 3):** 250 NYC members of `data/synthetic/v1` plus invited friends (about 70% join), deterministic persona policy (`PolicyPersonaAgent`, no LLM), engine-v1 run once a day by the Network without the judges, simulated reviewer (`review: "auto"`), oracle `PRIMED_MODEL = { met: 0.96, partial: 0.82, identity: 0.95 }`, seeds 1-3, 21 days.
- **Results (sections 4-6):** consent everyone-yes 0.753 / 0.847 / 0.848 by seed (pooled 0.816) against push v2 about 0.20 and the push baseline about 0.10 (0.097 pooled). The largest loss was requesters declining the match they asked for (member requests 0.81 vs engine proposals 0.95). The pair ceiling under the simulator's model is 0.95 x 0.95 = 0.90 (the identity veto at the reveal, section 6.3). Letting personas ask only for wants they still hold (`--live-asks`) raised the pooled rate from 0.816 to 0.846.
- **Safety and bugs (sections 7-9):** 0 canary leaks and 0 minor contacts; 2 real `duplicate_send` violations on seed 2 and a feedback classifier that read "not great" as positive. Both were fixed.
- **After the Network fixes (section 11):** consent everyone-yes 0.838 pooled (201/240), 0 `duplicate_send`, 0 minor contacts, 0 canary leaks; the one remaining violation per seed was the known `two_unanswered` judge issue on the allowed re-engagement message.

## 12. Re-measured on the attention v1.2 send path (2026-10-07, latest)

**This section uses newer code and a different definition from sections 1 (older rows) to 11. Do not mix its numbers with theirs.**

The Network now follows the engine session's send defaults, attention v1.2 ([network.md](../network.md) sections 4 and 6.4; before and after numbers in [SUMMARY.md](SUMMARY.md), "ConsentNetwork send defaults"): one daily send slot, only initial invites on the cap, probes one member at a time with 2-3 time options, and a booked plan with a 48-hour opt-out in place of the reveal. The simulator gained the opt-in time-aware personas, and the StubNetwork changed (stub baseline history: [SUMMARY.md](SUMMARY.md), "StubNetwork baseline with history"). This section runs all three arms again on the combined working tree.

### 12.1 Setup

| Item | Value |
|---|---|
| Commands | At the time: `bun run packages/network/harness/experiment.ts --days 21 --seed N` (all three arms) and `... --days 21 --seed N --only consent --time-aware`, for N = 1, 2, 3; `... --days 42 --seed 1 --only consent`. That harness has been deleted; validation is now `bun run sim`. |
| World, personas, engine, oracle model | As section 3. The default persona policy, except the time-aware rows (`PolicyOptions.timeAware` and `WorldOptions.timeAware`: personas answer offered times from a hidden week, and a meeting at a time that clashes is missed with p = 0.7) |
| Review | `review: "auto"`, the simulated reviewer. Every opportunity is queued and approved before anyone is contacted. |
| Model and request settings | None. `OPENAI_API_KEY`, `SURPLUS_API_KEY` and `CEREBRAS_API_KEY` were empty. No LLM call, $0. |
| Code | The working tree in the `thenetwork-console` worktree on 2026-10-07 at about 17:17 PDT, after the network, simulator, service and console work of this round |
| Determinism | The consent rows are identical, seed by seed, to the "after" runs in the send-defaults report, which ran `--only consent` on an earlier tree of this round |
| Wall time | 3-8 s per arm for 21 days, 16 s for 42 days (six runs in parallel) |
| Sample size | 3 seeds; 70-90 booked plans per seed for the consent arm. Wilson 95% intervals; pooled intervals treat seeds as independent. |

Generated files: [network/arms-21d-send-path-seed1.json](network/arms-21d-send-path-seed1.json), [seed2](network/arms-21d-send-path-seed2.json), [seed3](network/arms-21d-send-path-seed3.json), `network/consent-42d-send-path-seed1.json` (git history at `16cde70`). The time-aware consent runs are the "after_time_aware" entries of [network/send-defaults-21d.json](network/send-defaults-21d.json) (the re-run gave the same numbers). The tables are copied from these files by hand.

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
