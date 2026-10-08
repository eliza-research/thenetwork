# ConsentNetwork send defaults (attention v1.2), measured (2026-10-07)

The ConsentNetwork (`packages/network`) now follows the engine session's reference, attention v1.2 ([2026-10-07-attention-budget.md](2026-10-07-attention-budget.md), iterations 3 and 4). This document gives the before and after numbers on the NYC world. The tables are generated from the runs below. The text is hand-written.

**No LLM calls, $0.** Every run had `OPENAI_API_KEY`, `SURPLUS_API_KEY` and `CEREBRAS_API_KEY` empty and no `LIVE_TESTS`. Every run uses the simulated reviewer (`review: "auto"`): each opportunity is queued and approved before any member is contacted.

## Result

- **More meetings, same safety.** Meetings held over seeds 1-3 went from 129 to 173 (+34%) with the default persona policy, and from 52 to 95 (+83%) with the time-aware simulator. Canary leaks, invariant violations, minor contacts and false flags stay at 0 in all 12 runs.
- **Fewer interruptions.** Initial invites per member-week fell from 0.93 to 0.50. Part of this is the new definition: only initial invites are proactive now (founder decision 3).
- **Everyone-yes** went from 0.818 (198/242) to 0.853 (214/251) pooled. The difference is inside noise (z = 1.05).
- **Booked plans are cancelled.** 54 of 251 booked plans were cancelled with "can't" (default policy) and 120 of 235 (time-aware). Most time-aware cancels are a time that clashed with the member's hidden week.
- **Enjoyment per meeting fell** from 0.553 to 0.517 (mean of seeds). Meetings where everyone enjoyed it stayed about the same in count (39 before, 36 after). Silence now counts as a yes, so some members who would not have confirmed now come.

## Re-run after the review fixes

The review fixes changed booking: an opportunity where members named times and none is left in common now closes (`no_common_time`) instead of booking an estimated slot, refusals are no longer read as picks, and probes carry the activity only. The same commands, seeds 1-3, 21 days, re-run afterwards:

| Arm | Everyone-yes (pooled) | Meetings held | Cancelled ("can't") | No common time | Initial invites / member-week | Judge invariants / canary leaks / minor contacts |
|---|---|---|---|---|---|---|
| After, default policy | 0.866 (246/284) | 65 / 60 / 53 = **178** | 17 / 23 / 21 | 0 / 2 / 0 | 0.58 / 0.54 / 0.54 | 0 / 0 / 0 |
| After, time-aware | 0.848 (167/197) | 39 / 34 / 38 = **111** | 23 / 25 / 20 | 40 / 41 / 37 | 0.54 / 0.61 / 0.53 | 0 / 0 / 0 |

Closing instead of guessing a time cut time-aware cancellations from about 40 to about 23 per seed and raised meetings from 95 to 111. The tables below are from before these fixes.

Unsafe proposals (1-2 per seed, as before) were traced one by one. A block abuser, a spammer and a harasser were each proposed before they acted; each plan was cancelled before anyone met. One was a 16-year-old whose record said 20 and who gave no sign of age until after the meeting (seed 2): that meeting happened. The Network now opens a safety case for staff when this happens (`minor_after_contact`, docs/network.md 6.3).

## What changed (code)

| Founder rule | What the Network does now | Where |
|---|---|---|
| 1. Send time | Interruptions go in a rolling daily slot at 12:00 New York, with up to 2 hours of spread per member and a 6-hour window. The slot is learned from the member's replies (`attention.learnSendProfile`). Quiet hours always win. Logistics wait only for quiet hours. Replies and safety notices go at once. The old 09:00-20:00 window is gone. | `network.ts` `timingOk`, `openAt`, `view`; `outreach.ts` |
| 2. Cap counting | Only a member's initial invite counts, once per member and opportunity. The partner's first probe counts on the partner's cap and goes in their window as soon as the first member says yes. The booked plan, reminders, feedback, acknowledgements, profiling and growth asks and the weekly check-in never count. Hard limits: the Blooio streak (`attention.canInterrupt`, `canSendLogistics`), quiet hours, two unanswered initial invites. | `send()`, `eligible()` |
| 3. Probe first, one at a time | The first member, then the partner, each with 2-3 time options (`attention.chooseTimeOptions`). The answer is parsed (`parseProbeReply`). The partner is offered only the picked times. A requester with a strong fit picks the times first. "Neither" gets other times once. | `advanceProbes`, `probe`, `onProbeAnswer`, `timeOptionsFor` |
| 4. Booked plan | One message per member after all yeses, with the time and place. Silence for 48 hours is a yes. "Can't" cancels, and the other member hears without the reason. No separate "you're all set". | `reveal`, `meetingTime`, `handleDrop` |
| 5. Calendar, weekly check-in | One offer in a member's first booked plan: CALENDAR (consent recorded; no calendar source yet) or WEEKLY ("What's your week like?" on Sundays in the send window; never for members aged 13-17). | `optIns`, `weeklyCheckins` |
| 6. Logs | `send_deferred { kind, until }`, `gate_reason { proposalKey, reason, members }`, `review_mode { mode, actor }`, `probe_started { origin, first }`, `probe_sent { options, invite }`, `booked_cancelled`, `time_answer`. | |
| 7. Leak lists | `forbiddenProvider(net, memberOf?)` for the Blooio queue's `forbiddenProvider` hook. | `network.ts` |
| 8. Judge in the harness | `summarize()` reports `judge { invariants, byRule, canaryLeaks, minorContacts }` and a PRD scorecard proxy. | `harness/experiment.ts` |

One choice goes beyond the reference: a member who says yes but picks none of the times gets other times once, as a direct reply. Without it, the time-aware runs set most plans at a time nobody had picked (seed 1, during development: 47 of 83 plans), and most of those were cancelled.

## How it was measured

```bash
# after (this tree); add --time-aware for the time-aware simulator
bun run packages/network/harness/experiment.ts --only consent --days 21 --seed 1   # seeds 1, 2, 3
# before: the same command on a copy of the previous network code (git index version of
# packages/network/src, with the old outreach.ts), with today's harness and simulator
```

- World: the 250 synthetic NYC personas plus invited friends, 21 days, engine-v1 through the Network, default persona policy (`PolicyPersonaAgent`).
- Time-aware: `PolicyOptions.timeAware` and `WorldOptions.timeAware` (packages/sim, landed by the simulator session in this round). Personas answer offered times from a hidden week, answer a booked plan with opt-out semantics, and do not come to a time that clashes with their week (p = 0.7).
- Sample size: 3 seeds per arm, about 80 booked plans per seed. A difference of one seed is one sample. Treat per-seed differences under about 10 meetings as noise.

## Results (seeds 1 / 2 / 3, pooled)

| Arm | Everyone-yes | Invite accept | Meetings held | Mean enjoyment | Initial invites / member-week | Booked plans | Cancelled ("can't") | Judge invariants / canary leaks / minor contacts | False flags |
|---|---|---|---|---|---|---|---|---|---|
| Before | 0.866 / 0.835 / 0.747, pooled 0.818 (198/242) | 0.825 (434/526) | 49 / 48 / 32 = **129** | 0.551 / 0.544 / 0.565 | 0.94 / 0.90 / 0.93 | 82 / 85 / 75 | - | 0 / 0 / 0 | 0 |
| After | 0.780 / 0.886 / 0.889, pooled 0.853 (214/251) | 0.924 (464/502) | 52 / 56 / 65 = **173** | 0.482 / 0.534 / 0.535 | 0.50 / 0.50 / 0.52 | 82 / 79 / 90 | 23 / 13 / 18 | 0 / 0 / 0 | 0 |
| Before, time-aware | 0.877 / 0.824 / 0.809, pooled 0.836 (204/244) | 0.836 (443/530) | 22 / 13 / 17 = **52** | 0.619 / 0.466 / 0.560 | 0.93 / 0.91 / 0.95 | 81 / 74 / 89 | - | 0 / 0 / 0 | 0 |
| After, time-aware | 0.779 / 0.818 / 0.800, pooled 0.800 (188/235) | 0.903 (419/464) | 32 / 35 / 28 = **95** | 0.506 / 0.503 / 0.560 | 0.48 / 0.52 / 0.45 | 77 / 88 / 70 | 35 / 47 / 38 | 0 / 0 / 0 | 0 |

Significance (small samples, read with care):

- Meetings held, paired by seed: +3, +8, +33 (default policy; mean +14.7, t = 1.6, df = 2, not significant); +10, +22, +11 (time-aware; mean +14.3, t = 3.7, df = 2, p about 0.07).
- Everyone-yes: 0.818 vs 0.853, z = 1.05 (not significant). Time-aware: 0.836 vs 0.800, z = -1.0 (not significant).
- Invite accept: 0.825 vs 0.924, z = 4.9. **Caution:** the definition changed. On a booked plan the member's own decision counts, so silence is a yes and a silent decliner is a no. Before, only a typed yes counted.

Definitions: everyone-yes = booked (or revealed) plans where every invited member decided yes. Meetings held = meetings where at least 2 people came. Cancelled = `booked_cancelled` after the member said they can't.

Other counts (after): every probe carried time options (698 / 726 / 766 probes, including requesters' time questions). In the time-aware runs, 86 / 97 / 62 answers picked no offered time. Members moved to "only when I ask": 0 / 0 / 1 (before: 7 / 9 / 17). Deferred sends: about 600 per run (before: about 1,800, mostly the 09:00-20:00 window).

### PRD scorecard proxy (PRD 28.2)

From the same runs (`ArmResult.scorecard`). These are simulator proxies, not pilot numbers.

| Score | Target | Before | After | After, time-aware |
|---|---|---|---|---|
| Worthwhile interruptions (persona-judged initial invites) | 70% | 22-24% | 26-32% | 28-30% |
| Opt-in (probe yes rate) | 40% | 24-27% | 37-40% | 37-39% |
| Completion (show rate of booked seats) | 70% | 89-94% | 86-89% | 64-72% |
| First good meeting within 14 days (members who joined in week 1) | 60% | 7-10% | 4-11% | 4-6% |

Caution: the opt-in rate now includes the requester's time question, which is almost always a yes. The worthwhile rate now covers only initial invites (before: every proactive message).

## Known limits

- **No calendar source.** CALENDAR records consent only. `AvailabilityEvidence.calendar` stays empty until a free/busy integration exists.
- **Employer rule copied.** The probe check for employer-like values copies two regular expressions from the engine's `buildProbe`, because the engine does not export them.
- **Cancels are high in the time-aware runs** (51% of booked plans). The sim's hidden week is strict (weekday evenings only on the persona's free evenings). Pilot data must say how often real members cancel.
- **Push arm.** `probes: false` (the `push_v2` arm) now books a plan straight away with a named, proactive message. It is a comparison arm only.
- The learned send hours are not stored in `NetworkState`. They are recomputed from the stored replies, so a restart gives the same sends (store test).

## Files

- `packages/network/src/network.ts`, `outreach.ts`, `copy.ts`, `classify.ts`, `store.ts`.
- `packages/network/harness/experiment.ts`.
- `packages/observatory/src/projector.ts`: game mode counts a booked plan as a yes when the meeting is booked (silence = in), a typed no after it as a no, and a member who said no is not a no-show. Game and real mode then agree on the opt-in rate (`real-console.test.ts`).
- Tests: `test/flows.test.ts` (sequential probes and time options, booked plan and cancel, "neither", CALENDAR and WEEKLY, logs, cap counting, `forbiddenProvider` in the Blooio queue), `test/units.test.ts` (answer parsing, including every answer form the simulator's personas write), `test/network.test.ts` (send timing, partner offers, booked plan, Blooio streak; 21-day floors pooled over seeds 1-3), `test/staff.test.ts`, `test/store.test.ts`.
- Docs: [network.md](../network.md) sections 2, 3, 4, 6.4, 6.5, 7, 9, 11.
- Raw results (generated): [network/send-defaults-21d.json](network/send-defaults-21d.json), all 12 runs.
