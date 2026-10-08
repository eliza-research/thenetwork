# Network capital events and plans v1.1 in the ConsentNetwork (2026-10-08)

Asks: [2026-10-08-network-capital.md](2026-10-08-network-capital.md) ("Integration asks") and [2026-10-08-plans.md](2026-10-08-plans.md) (iteration 2 and iteration 1 asks). Raw results: [network/capital-plans/](network/capital-plans/). **No LLM calls, $0.** Every run was made with no API keys and without `LIVE_TESTS`. The simulated reviewer approves opportunities (`review: "auto"`). It never decides fraud items. The text is hand-written. The tables are copied from the JSON files.

## 1. Result

- **Safety gates hold in every run.** Canary leaks 0, judge invariant violations 0, minor contacts 0. Plan checks: 0 members under 18 in any plan role, 0 names in a plan probe, 0 reveals before quorum, at most 1 plan invite per member per 7 days, at most 2 intro invites per member per 7 days.
- **Every NC ledger event in the asks is emitted** through one typed emitter (`NetworkOptions.onLedger`). With a real `CapitalLedger` attached, 0 events were rejected (time order and ids are valid) in 4 runs (3 x 21 days, 1 x 60 days).
- **Plans run end to end, but they book few plans in this simulator.** 21 days, 3 seeds: 99 plans proposed, 226 plan probes, 54 yes (24%), 8 plans booked, 7 plan meetings held. 60 days, seed 1: 98 plans, 209 probes, 59 yes, 10 booked, 9 held. No crew formed. Quorum is 3 of 4-6 invitees, and a cold plan probe gets a yes about 1 time in 4.
- **Meetings held do not change measurably.** 21 days, 3 seeds pooled: 172 with plans, 161 with plans off on the same simulator, 163 on the code before this change. The differences are within seed noise (per-seed spread about +-8).
- **One measured fix.** In the first wiring, request and plans-buddy meetings counted as member-started. Ring detection then flagged 58 honest groups in 60 days (seed 1, `--capital`; 0 adversaries in any flag). Only second encounters count as member-started now (the members chose each other). Result: 0 flags in the same run.

## 2. What was built (packages/network)

### 2.1 Network capital

| Ask | How |
|---|---|
| One typed emitter | `NetworkOptions.onLedger(e: CapitalEvent)`. Each event has a stable id `<type>:<key>` (a replay after a restart is idempotent) and the Clock time. `capital.ts capitalWiring()` connects a `CapitalLedger` |
| member_joined (age, voucher), member_activated | At the welcome (when the age is known). The age is the lowest valid age. A member treated as a minor is sent with no age, so the ledger excludes them. Activated when onboarding ends |
| value_received (providers) | A post-meeting answer that is positive (or "would do it again"), with the others who came |
| safety_flag, abuse_confirmed, member_removed | On a trust change to watch or hold (serious = hold). When staff close a case with the member still on hold: abuse_confirmed (kind from the case events) and member_removed `serious_abuse` |
| plan_accepted (start) | When the booked plan reaches the member |
| **Pre-plan confirmation (new)** | plan_confirmed when the member says yes or "see you there" to the booked plan, or by silence: 48 hours after it reached them, or at the start. Both kinds are logged (`plan_confirmed`, how) |
| plan_cancelled | The member said they can't make it, or opted out |
| **Attendance verification and ghosting (new)** | `finalize()` runs when everyone booked has answered, or 4 days after the meeting. Present = said they came, or a counterpart who came reported nobody missing (mutual check-in), or the host checked them in. A member who said they couldn't make it is a no-show. A member reported missing in a pair, who sent no word after the booked plan (no confirmation in words, no feedback), is plan_ghosted; with a word, plan_no_show. Nothing is known: nothing is emitted |
| **Plan origin (new)** | `member` = a second encounter (both asked for it); `organizer` = a crew session; everything else (engine, requests, the planner, staff) = `engine` |
| feedback_given | After plan_attended, for members who answered (the ledger only credits feedback on an attended plan) |
| **help_given, help_confirmed (new: the recipient's confirmation)** | The requester's post-meeting answer on a request whose want needs a skill the other member has. Useful = positive |
| need_answered | A retried standing request (it was on the needs list) that the requester found good |
| **organized (new: the organizer's check-in list)** | A hosted plan whose host came. The check-in is the people the host named, or everyone who did not say they missed it |
| review_completed | A review decision by a reviewer who is a member |
| fraud_confirmed | A reviewer approves a fraud item |
| declined, state_changed, help_asked | Emitted; the ledger ignores them |

Run-time reads (`NetworkOptions.capital`, a `CapitalReader`; `ledgerReader(ledger)` builds one). Without a reader, nothing changes:
- vouch capacity replaces `invitesPerMonth` at invite time;
- the effort overlay sets the re-search interval (was a fixed 3 days in `openRequest`), the research depth (candidates searched for a request: 1 + depth, floor 3 = 4 as before) and plan options (venues suggested for a plans ask, floor 3);
- organizing reach for crew sessions: the crew's own seats come first (at most the base 8). Every seat above the base is reserved for members with the least recent participation who fit the activity. They get the plain plan probe, not "your crew";
- gaming flags (`reader.flags`) are queued once a day as review items of kind `fraud`. The same kind and members are not queued again within 14 days. Approve = `fraud_confirmed`, reject = dismissed, edit and re-roll are refused. Nobody is messaged. The simulated reviewer never decides them.

### 2.2 Plans v1.1

| Ask | How |
|---|---|
| Check-in answers -> StatedWindows | `checkinTags` ("Saturday afternoon" pairs) -> `statedWindows` for the next 7 days; activities named -> planner hints |
| Standing availability at onboarding | The answer during onboarding is kept as standing availability (it used to expire after 7 days) |
| Planner Mon/Thu 09:00 | `plans.planProposals` on an engine World built from `engineInput`, members with a window who are not in an open opportunity |
| One review item per plan | `planToProposal`; origin `planner` |
| Probes and answers | `planItem` + `attention.composeMessage`, text from `buildPlanProbe` (null = not sent, counted as a no). `recordPlanAnswer`, `checkPlanDeadline`; silence 26 hours after a probe = no; backfill from the reviewed alternates |
| Plan lane | At most one plan invite a day, in the send window; allowance-eligible members use `planAllowanceConfig` with a plan-only ledger (1 per 7 days). It counts for two-unanswered and the Blooio streak, never for the intro cap. Others go on the intro cap |
| Booking | Quorum books; anyone booked elsewhere within 4 hours is left out first; send-time recheck; the reveal names the people, the time and the public place, "everyone pays their own way". A late yes joins until 6 hours before. Booked plans count as away when a time is chosen for an intro |
| A yes waiting for quorum does not block other items | `busy()` ignores it |
| Fallbacks | `planFallback`: smaller plan, a public event, or next week (carried demand). "That plan didn't come together this time." rides on the next message; nobody learns who declined |
| After the plan | "How was X, and would you do it again with this group?" Both-yes pairs -> `would_interact_again` edges; `detectCrews` (minPlans 1); the crew is offered once, in the reply to the answer that completed it (others get it as one short message; later "again" answers join the same offer); `crewOptIn`; weekly sessions, reviewed like any plan, handed off after 3 |
| Venues | `PLAN_VENUES`: geo.ts public places mapped to plan activities (parks, libraries, markets, courts, museums); price tier 0; no homes, no money |

## 3. How it was measured

```bash
# before (the tree before this change, run first; a snapshot copy of packages/network)
bun run packages/network/harness/experiment.ts --only consent --days 21 --seed {1,2,3}
bun run packages/network/harness/experiment.ts --only consent --days 60 --seed 1
# before, with plan-aware personas (sim WorldOptions.plans + PolicyOptions.plans), same snapshot
# after (default: plans on, plan-aware personas)
bun run packages/network/harness/experiment.ts --only consent --days 21 --seed {1,2,3}
bun run packages/network/harness/experiment.ts --only consent --days 60 --seed 1
# after, plans off on the same plan-aware simulator; after, with an NC ledger and its levers
bun run packages/network/harness/experiment.ts --only consent --days 21 --seed {1,2,3} --plans off --sim-plans on
bun run packages/network/harness/experiment.ts --only consent --days 21 --seed {1,2,3} --capital
```

NYC world (about 270-330 members with invitees), simulated reviewer, model: none. Personas only answer plan probes, the weekly check-in and crew offers when the simulator's plans option is on, so the fair "before" for plans is the second row. A rerun of the first "before" command after all the runs gave identical numbers (no simulator drift).

## 4. Tables

### 4.1 21 days, seeds 1 / 2 / 3

| Arm | Meetings held | Precision | Proactive / member-week | Opt-outs | Canary leaks | Invariants | Minor contacts |
|---|---|---|---|---|---|---|---|
| Before | 54 / 58 / 58 | 0.385 / 0.413 / 0.426 | 0.513 / 0.548 / 0.542 | 0 | 0 | 0 | 0 |
| Before, plan-aware personas | 58 / 58 / 47 | 0.330 / 0.375 / 0.393 | 0.515 / 0.537 / 0.603 | 0 | 0 | 0 | 0 |
| After, plans off | 51 / 54 / 56 | 0.407 / 0.380 / 0.274 | 0.541 / 0.580 / 0.556 | 0 | 0 | 0 | 0 |
| **After (plans on)** | **62 / 57 / 53** | 0.358 / 0.372 / 0.319 | 0.566 / 0.638 / 0.643 | 0 | 0 | 0 | 0 |
| After, `--capital` | 62 / 57 / 49 | 0.358 / 0.372 / 0.341 | 0.566 / 0.638 / 0.631 | 0 | 0 | 0 | 0 |

Plans off differs from "before" on the same simulator because of the other changes (standing availability kept, booked plans counted as away). The per-seed spread is as large as the differences.

### 4.2 Plans (after, plans on)

| | Seed 1 | Seed 2 | Seed 3 | 60 days, seed 1 |
|---|---|---|---|---|
| Plans proposed (review items) | 32 | 33 | 34 | 98 |
| Plan probes sent | 76 | 74 | 76 | 209 |
| Yes | 16 | 17 | 21 | 59 |
| Plans booked | 3 | 2 | 3 | 10 |
| Plan meetings held (2+ came) | 3 | 2 | 2 | 9 |
| ... everyone who came enjoyed it (>= 0.5) | 1 | 1 | 2 | 4 |
| Crews offered / formed | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Max plan invites per member in 7 days | 1 | 1 | 1 | 1 |
| Max intro invites per member in 7 days | 2 | 2 | 2 | 2 |
| Names in a plan probe / minors in a plan / reveals before quorum | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

### 4.3 60 days, seed 1

| Arm | Meetings held | Precision | Proactive / member-week | Canary leaks | Invariants | Minor contacts |
|---|---|---|---|---|---|---|
| Before | 246 | 0.392 | 0.491 | 0 | 0 | 0 |
| Before, plan-aware personas | 225 | 0.392 | 0.504 | 0 | 0 | 0 |
| After, plans off | 230 | 0.380 | 0.469 | 0 | 0 | 0 |
| **After (plans on)** | **221** | 0.372 | 0.542 | 0 | 0 | 0 |
| After, `--capital` | 213 | 0.390 | 0.535 | 0 | 0 | 0 |

### 4.4 Ledger events (after, 21 days seed 1; 60 days seed 1 with `--capital`)

| Event | 21 d | 60 d |
|---|---|---|
| member_joined / member_activated | 276 / 230 | 325 / 284 |
| plan_accepted / plan_confirmed / plan_cancelled | 192 / 171 / 21 | 641 / 542 / 87 |
| plan_attended / feedback_given / plan_no_show / plan_ghosted | 122 / 117 / 1 / 0 | 429 / 410 / 10 / 1 |
| value_received | 58 | 216 |
| help_given = help_confirmed / need_answered | 6 / 11 | 23 / 35 |
| safety_flag | 18 | 18 |
| organized | 0 (1 in seed 3) | 0 |
| Ledger entries written / events rejected / fraud items queued | 287 / 0 / 0 | 935 / 0 / 0 |

## 5. Why plans book few plans here

- **Cold probes.** The simulator's plan-probe model gives a yes about 1 time in 4 (24% measured). A group plan needs 3 yes out of 4-6. Window priming (a stated check-in window) raises it, but only 55 members (21 days) opted in to the weekly check-in, which is offered once, in the first booked plan.
- **The engine's leak gate drops about a quarter of plan probes.** `buildPlanProbe` returned null for 40 of about 120 probe attempts in a 21-day diagnostic run (seed 1). In every case checked, the only blocked word was "free" (from the cost line "Free."), which is in another invitee's matchable facet vocabulary. A null is not sent and counts as a no. This is an engine issue (the cost words are not exempted like the activity and place words); `packages/engine` was not edited.
- Members in an open opportunity wait (one open question at a time), and a probe goes out at most once a day in the send window.

## 6. Tests

- `bun test packages/network`: 97 pass, 0 fail (6 files).
- New flows in `test/flows.test.ts` (Mini world): ledger events in order for a booked intro, with silent confirmation and mutual check-in, and the ledger credits both; ghosting and vouch capacity at invite time; fraud items (not auto-decided, approve -> fraud_confirmed, reject -> nothing, no re-queue within 14 days); the planner and plan lane (no names, no minor, plan allowance 1 per 7 days, intro cap untouched); quorum booking, late joins, crew offered once, opt-in, organizing reach above the base going to the least-exposed members.
- `test/network.test.ts`: the cap test now counts plan-allowance invites separately (at most 1 per 7 days) from the intro cap.
- `bun test packages/observatory packages/sim`: 198 pass, 0 fail, 2 skipped (not changed here).
- `bunx tsc --noEmit -p .`: clean.

## 7. Limits and open points

- 3 seeds at 21 days and 1 seed at 60 days. No significance claim for meetings held.
- No adversarial rings in the NYC world, so fraud review was tested in a flow test only, not measured.
- The simulator's plan-probe and crew models are the plans harness assumptions (sim `plans.ts`), not real members.
- Engine copy: crew probes read "Your an easy group run crew is on again" (an activity label with an article). Engine owner.
