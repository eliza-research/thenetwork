# State machines in the simulator (packages/sim, scripts/sim, scripts/sim.ts)

Hand-written from a read of the code on branch `claude/quint-state-machines`. Part 8 lists what was not read in full.

Scope: world lifecycle, persona agents, oracle, judges and gates, per-app worlds. This file also records
which production machines the gates check, and where the simulator models production differently.
Model divergence is a finding.

The simulator has two jobs for this effort. It holds its own machines (the world, the channel, the
stub, the judge), and it is the only automatic check of the production machines. So a defect in a judge
machine is a defect in the proof of a production invariant. This file marks each such defect.

Evidence terms: "VERIFIED-RUN" means a throwaway script in the scratchpad reproduced the behaviour.
"VERIFIED-READ" means the code path was traced by reading. No repository file except this one changed.

Paths without a prefix are under `packages/sim/src/`.

---

# Part 1. The core world

## M1 `sim-run-lifecycle`: the run of a World

- Kind: implicit. No status field. The stage is which method has run.
- State: `World.ctx` (undefined until `begin`), handlers on `Scheduler`, `clock`, `records`, `run_start`
  and `run_end` records. world.ts:292, 289, 356.
- States: `constructed` -> `begun` -> `advancing` (repeat) -> `completed`.

| From | Event | Guard | Effect | To | Where | Trigger |
|---|---|---|---|---|---|---|
| constructed | `begin()` | none | `network.init`, handlers, `run_start`, persona records, seeds join, action, tick, engine_run, day events | begun | world.ts:292-353 | harness |
| begun | `advanceTo(t)` | t capped at `end` | runs due events | advancing | world.ts:289 | harness |
| advancing | `act(a)` | none | `scheduler.at(now, "action")`; runs on the next advance | advancing | world.ts:287 | harness |
| advancing | `spawn(p, t)` | id is new | adds persona, oracle entry, name index, `persona` record, `join` event | advancing | world.ts:270-284 | network through `ctx.invite` |
| advancing | `complete()` | none | `latent_opportunities`, `run_end`, `computeMetrics`, write folder | completed | world.ts:356-369 | harness |

Invariants: the clock never moves back (scheduler.ts:83 clamps). `run_end` is last. `computeMetrics` sees
every record.

Failure analysis: one process, no database. `network_error` records catch throws from `onInbound`,
`tick` and the engine (world.ts:313, 317, 545). A throw from `onJoin`, `onDeliver` or `onMeeting` is not
caught, so it stops the run. `Scheduler.runUntil` has no try/catch (scheduler.ts:86).

Defect candidates:
- `begin()`, `complete()` and `advanceTo()` have no guard against a second call or a wrong order.
  A second `begin` registers `onDeliverToMember` twice (world.ts:300), so every message goes to the
  persona twice. Confidence: high that the guard is missing; low impact, no caller does this.
- `complete()` calls `computeMetrics(this.records)` with no `requireReview` (world.ts:365). See S-08.
- A meeting with `at > end` never gets an outcome. It stays in `meetings.scheduled` and is not in
  `held`. This is intended, but the rates use `slots` from outcomes only.

Quint: not needed alone. Model it as the driver of the other machines.

## M2 `sim-event-queue`: discrete events

- Kind: explicit. `ScheduledEvent.kind` strings: join, deliver, persona_send, network_inbound, tick,
  engine_run, initiative, flake_check, meeting, action, day. world.ts:306-328.
- Order: by `(at, seq)`. scheduler.ts:27. Events at the same time run in insertion order.
- `at()` clamps a past time to now (scheduler.ts:68). `runUntil` stops at the first event past `until`.

Key ordering facts for a Quint model:
- A persona's STOP takes two steps. `persona_send` runs `channel.receive`, which sets the carrier
  opt-out at once and queues `network_inbound` at the same time. The Network sees STOP one event later
  (world.ts:304, channel.ts:91-101). So a `tick` queued earlier at the same `at` runs in between. The
  window is real and the channel fence covers it.
- Reply delay is a separate event, so a Network message can cross a persona's STOP in flight. This
  models a real race. The message counts as delivered, and no violation is raised.
- `tick` reschedules itself only if `now + tickMs <= end` (world.ts:318).

Divergence: production has no single total order. The gateway, the backend and the deliver path run
concurrently. The sim gives one global order, so no gate can find a race between two processes.
That is the largest class of model divergence (see Part 5, D-01).

## M3 `sim-channel-opt-out`: carrier STOP/START/HELP

- Kind: implicit. `SimChannel.optedOut: Set<MemberId>` channel.ts:33.
- States per member: `subscribed`, `opted_out`.

| From | Event | Guard | Effect | To | Where | Trigger |
|---|---|---|---|---|---|---|
| subscribed | `receive(body)` with STOP word | not a reaction | add to set; carrier reply | opted_out | channel.ts:91-93 | member |
| opted_out | `receive` with START word | not a reaction | remove; carrier reply | subscribed | channel.ts:94-96 | member |
| any | `receive` with HELP word | | carrier reply; no state change | same | channel.ts:97-98 | member |
| any | `receive` other | | forwarded | same | channel.ts:101 | member |

Also: keyword messages always reach the Network (channel.ts:100). `detectKeyword` uses
`KEYWORDS.stop + stopAll`, `start`, `help` from core.

Divergences from production (AGENTS.md "Consent path", decision 7):
- D-02. The sim knows only the English STOP set. Production `detectKeyword` in platform also has the
  polite and Spanish forms (`stopPolite`, `stopEs`, replies.ts:310-312) and `parseOptOut` phrases. A
  persona never sends those words, so no world run covers them. The `evals` block covers the parsers only.
- D-03. No per-app leave. "leave slop.date" is not a keyword here. There is no `scope: "app"`. The
  `opt_in` record type exists in the log schema, and the judge reads it (metrics.ts:314), but World never
  writes it. World relies on the START keyword (metrics.ts:415).
- D-04. The carrier reply here is a third party. In production the backend writes the reply, the gateway
  sends it, and the turn receipt acknowledges it. The turn-handled path, `consent{}` copy and the
  gateway fence are not modelled. Only the `pipeline` block touches a real path, with a fake Blooio.

## M4 `sim-outbound-idempotency`: delivery status

- Kind: explicit. `DeliveryStatus`: delivered, suppressed_opted_out, failed, duplicate. channel.ts:61-77.
- State: `sentKeys: Map<key, SimMessage>` channel.ts:35.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| key unseen | `send` | opted out | record | suppressed_opted_out (terminal) | channel.ts:67 |
| key unseen | `send` | failure draw | record | failed (terminal) | channel.ts:68 |
| key unseen | `send` | else | record, notify member | delivered | channel.ts:66, 75 |
| key seen | `send` | any | returns a copy with `status: duplicate`, no record | same | channel.ts:62-65 |

S-11 (divergence, VERIFIED-READ, high). `sentKeys.set` runs for every status (channel.ts:74), so a `failed`
or `suppressed_opted_out` send uses up its key. A retry with the same key returns `duplicate` and never
delivers. Production `DeliverResponse` says the opposite: "on `unknown` retry only with the same id". A
send that the channel failed cannot be retried with the same key in the sim. A consequence: `failureRate`
runs cannot test the retry path, and a member who sends START cannot get a message retried under the old key.

Also: the World logs a duplicate as `network_log kind duplicate_send` (world.ts:175), not as a message, so
the branch `m.status === "duplicate"` at metrics.ts:439 cannot run on a World log. The `duplicate_send`
invariant fires only on the same body within 10 minutes under different keys (metrics.ts:545-547). The log
kind `duplicate_send` is written and never read by the judge. Confidence: high.

Order note: the carrier reply is logged before the inbound message that caused it. `receive` runs
`systemReply` first, which logs at once through the listener (world.ts:301), then `personaSend` logs the
inbound (world.ts:249). Same timestamp. The judge tolerates it through `keywordTimes` (metrics.ts:442).

## M5 `sim-member-lifecycle`: persona memory flags

- Kind: implicit. `PersonaMemory` agent/types.ts:29-67: `joined`, `joinedAt`, `optedOut`, `silentFrom`,
  `forceFlake`, `trust`, `weekly`, `stated`, `crews`. Also `World.joined`, `World.optedOut`,
  `World.unanswered`, and the channel's `optedOut`. Three copies of opt-out.
- States: `unjoined` -> `joined` -> `opted_out` -> (`joined` on START). Orthogonal: `silent` (from a time on),
  `force_flake{notice,no_show}` (one-shot), `trust` (0..1, only with qualityChurn).

| From | Event | Guard | Effect | To | Where | Trigger |
|---|---|---|---|---|---|---|
| unjoined | `join` event | `!mem.joined` | sets joined, registers channel kind, logs, sends join text, schedules first initiative | joined | world.ts:388-400 | clock or scenario |
| joined | `personaSend` STOP | not already out | `mem.optedOut`, World set, `opt_out` record | opted_out | world.ts:251 | policy or scenario |
| opted_out | `personaSend` "START" | exact text, upper-cased | clears both | joined | world.ts:246, 252 | scenario only |
| joined | `go_silent` | | `silentFrom = now` | joined + silent | world.ts:520 | scenario |
| joined | `force_flake` | | `forceFlake = how` | joined + flake | world.ts:521 | scenario |
| joined | decide: over tolerance | proactive, not silent, not adversary, not never_replies, recent > 3 + 4xcapacity | intent opt_out | joined, STOP queued | agent/policy.ts:128 | delivered message |
| joined | decide: low trust | qualityChurn, trust < 0.5, draw | intent opt_out | same | agent/policy.ts:132 | delivered message |

Invariants: `mem.optedOut`, `World.optedOut` and `channel.optedOut` must agree after each `personaSend`.
They agree, because all change in the same synchronous block.

Defects:
- S-14 (VERIFIED-READ, medium). The persona's START guard is exact: `text.trim().toUpperCase() !== "START"`
  (world.ts:246), but the channel accepts `UNSTOP`, `SUBSCRIBE`, `RESUME` (replies.ts:313). A scenario
  `say` with "UNSTOP" from an opted-out persona is dropped before the channel, so the keyword cannot be
  tested. Also, the guard runs on mem.optedOut, so HELP from an opted-out member is dropped too.
  In production HELP after STOP gets an answer.
- S-15 (VERIFIED-READ, medium). The initiative chain ends for good at STOP. `onInitiative` does not
  schedule the next one when `mem.optedOut` (world.ts:443), and START does not restart it. Also no
  policy path ever sends START (`opt_out` is the only keyword intent; grep of agent/ finds no START
  sender). So `opted_out` is terminal for every persona except through a scenario. No run explores the
  STOP -> START -> new proposal path by default. Production has this path (`consent: opted_in`).
- Persona `mem.blocked` is written before the Network knows. See S-05.

## M6 `sim-proposal-decision`: a persona's answer to one opportunity

- Kind: explicit plus implicit. `mem.proposals[pid].decision`: accept, decline, counter, none.
  `plannedShow`, `timeConflict`, `at`, `decidedAt`. Intent union agent/types.ts:15-27.
- States for (persona, pid): `absent`, `accept+show`, `accept+noshow`, `counter+show`, `counter+noshow`,
  `decline`.

Transitions: decideProposal writes on first sight (agent/policy.ts:305), repeats after that
(agent/policy.ts:287). `learnTime` sets `timeConflict` and `plannedShow=false` (policy.ts:326). LLM variant
may overwrite decision (agent/llmAgent.ts:149-152). Menu commit writes accept (policy.ts:425). Plan commit
writes accept (policy.ts:500).

Invariant to check: a persona's stored decision is what the persona said. This fails:

S-01 (P0 for the proof, VERIFIED-RUN, high). An unsent accept counts as consent in the judge.
`decideProposal` writes `mem.proposals[pid]` and returns `decision: "accept"`. Then `decide` draws the
ignore (agent/policy.ts:245) and sets only `intent: "ignore"`. The `decision` stays. World logs both
(world.ts:408). The judge reads `r.decision === "accept"` first (metrics.ts:321) and calls `accept()`.
So a member who never replied is "accepted". After that, messages on that opportunity are not proactive
(metrics.ts:518, 521), so over_budget, quiet_hours, two_unanswered and pause_path_missing do not fire, and
name_before_reveal (metrics.ts:487) lets the name through. The comment at metrics.ts:4-10 promises the
opposite. Line 590-595 handles the same case correctly (`intent === "ignore"` first), so the two readers
of one record disagree. Reproduction: a decision record with intent ignore and decision accept, then five
nudges: violations go from `{over_budget:3, two_unanswered:3}` to `{}`.
The comment at policy.ts:249-253 shows the same bug was fixed for menus, plans and probes (commit only when
sent). The named-proposal path and the `scheduling` path were not fixed. The same flaw makes
`mem.proposals[pid]` claim `accept`, so `onMeeting` lets a silent persona attend a meeting booked on no
reply (world.ts:479).

S-02 (VERIFIED-READ, high). The default decision in `scheduling` is accept: `decision: pr?.decision ?? "accept"`
(policy.ts:163). A persona with no memory of the proposal answers a scheduling message with
`confirm_schedule` + `accept`. So a Network that sends a "scheduling" message for an opportunity the
persona never saw creates its own consent record. The judge then treats the persona as accepted.
That persona then does not show (no `pr`, world.ts:479), so the outcome stays honest and the consent
record does not.

S-03 (P0 for the proof, VERIFIED-RUN, high). A counter counts as consent in the judge: metrics.ts:321
`r.decision === "counter"`. Founder decision 11: "only `answer: "yes"` is consent, a counter is not a yes".
`networkStateFromRecords` has the same reading: `inviteAnswer` returns yes for a counter
(snapshot.ts:383-387), with a comment "a counter is a yes to meeting". The engine sees `acceptedBy` built
that way. World `onMeeting` also lets a counter attend (world.ts:479).

## M7 `sim-flake-and-meeting`: a meeting in the world

- Kind: implicit. `World.meetings`, `World.notices` (`pid|member`), `flake_check` and `meeting` events,
  `mem.meetings[pid]`. world.ts:115-116, 210-229, 446-501.
- States per meeting: `scheduled` -> `outcome` (terminal). Per seat: `going`, `gave_notice`, `silent_noshow`,
  `showed`. There is no `cancelled` state. The Network has no way to cancel. `NetworkContext` has only
  `recordMeeting` (core network.ts:146).

| From | Event | Guard | Effect | To | Where | Trigger |
|---|---|---|---|---|---|---|
| none | `recordMeeting` | same pid and same at exists? no | new id, flake checks, meeting event | scheduled | world.ts:221-228 | network |
| scheduled | `recordMeeting` | same pid and at | adds participants only, flake checks for them | scheduled | world.ts:212-219 | network |
| none | `recordMeeting` | same pid, different at | a second meeting row | scheduled (two) | world.ts:212, 221 | network |
| seat going | `flake_check` | clash or planned no-show, draw | notice, flake text | gave_notice | world.ts:446-463 | clock |
| seat going | reply intent flake_notice or booked_cancel | proposalId known | `notices.add` | gave_notice | world.ts:411 | persona reply |
| scheduled | `meeting` event | none | computes attendance, enjoyment, `mem.meetings`, `outcome` record | outcome | world.ts:470-501 | clock |

Invariants: attendance is true only with a stored non-decline decision, a planned show, no notice, not opted
out, no clash (world.ts:479). "Show" must imply "consented". That fails through S-01.

S-04 (model divergence, VERIFIED-RUN, high). The world has no cancelled meeting. The Network cancels in its
own state only. `decide` has no `cancellation` case, so it falls to `default` (policy.ts:227-233): ack or
ignore. `plannedShow` does not change. `onMeeting` then still runs and writes an `outcome`. Reproduction:
a stub run with one cancelled-after-scheduling opportunity has an outcome with a seat shown. After a
block cancels a scheduled pair (stubNetwork.ts:374-375), both people still show: the world holds a meeting
between a blocked pair. The judge checks blocks only at `meeting_scheduled` (metrics.ts:403), not at
`outcome`. Reproduction: block after schedule, then outcome with both shown gives no violation. So `held`,
`showRate`, `networkStateFromRecords` outcome "completed" and plan-again edges can count a meeting the
Network called off. The same holds for a cancel after a minor signal, a trust hold or a ban: a minor flagged
after booking still "attends" with no violation. Production has real cancellation (`plan_cancelled`, relay
close). A Quint model must have the cancel transition that the sim lacks.

Other notes:
- A rescheduled meeting (new `at`) makes two rows and both run. `notices` is keyed by proposal, so a notice
  for the first time carries over to the second. No current caller reschedules with a new `at` for one
  proposal in the stub; `ConsentNetwork` has three `recordMeeting` calls (network.ts:2444, 3075, 3099).
  Confidence: medium that this is reachable.
- `scheduleMeeting` adds, never removes. A participant the Network dropped stays in `m.participants`, and
  their outcome counts as a seat.
- `onFlakeCheck` returns early when `mem.optedOut`, so `forceFlake` stays set. Harmless.

## M8 `sim-stub-member`: StubNetwork member stage

The stub is the push baseline in `runArm("push_baseline")` and the network for all JSON scenarios. It has
no review and no leak check (AGENTS.md says so). stubNetwork.ts:41-48.

- States: `stage` new, asked, onboarded. Orthogonal: `optedOut`, `unanswered` (0..), `awaiting`
  (none, invite(pid), feedback(pid)), `minor`, `ageSeen`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| any | STOP | | optedOut, dropFromOpenOpps | same | stubNetwork.ts:87 |
| any | START | | clear, welcome | same | stubNetwork.ts:88 |
| new | inbound | minor | minor notice | asked | :92-97 |
| new | inbound | adult | intro | asked | :98-103 |
| asked | inbound | minor | concierge | onboarded | :191-194 |
| asked | inbound | adult | answers | onboarded | :122-126 |

Defects, all in the stub, so they affect only the baseline and JSON scenarios:
- S-16 (VERIFIED-READ, medium; not seen in one 120-persona random run). `awaiting` can outlive its
  opportunity. `schedule` marks pending invites `dropped` (:298) and does not clear their `awaiting`. A
  group member who never answers keeps `awaiting` forever. `canPropose` then returns false for good (:414).
  The feedback case is the same: `awaiting = feedback` clears only on a reply (:115-119, :348), so a member
  who does not answer feedback is never proposed again. Stuck state with no exit except an inbound.
- S-17 (VERIFIED-READ, high). The budget guard is on the random path only. `canPropose` checks stage, opt-out,
  unanswered, awaiting and budget. `dispatch` (engine and scenario path) checks only minors, busy and opt-out
  (:208-221). `invite` then sends after only `proactiveAllowed`. The second invite in a pair also ignores the
  budget (:285). The header says it "honours ... a weekly proactive budget". So engine-fed runs can exceed it,
  and `over_budget` then measures the stub.
- S-18 (VERIFIED-READ, medium). A deferred invite is not re-checked. `tick` replays `deferred` when the
  opportunity is still inviting (:139-143). `invite` does not check opt-out, block, or budget. A member who
  sent STOP in the deferral window gets `dropFromOpenOpps`, which sets status dropped (:383), but `invite`
  then overwrites it with `pending` (:250) and sends. The channel suppresses it and the judge records
  `send_after_stop`. A real invariant failure in the baseline, if a STOP lands inside the quiet-hour deferral.
- S-19 (VERIFIED-READ, low). STOP does not touch a scheduled opportunity: `dropFromOpenOpps` covers only
  `inviting` (:382). Reminders for that member are suppressed by the channel, and each is a `send_after_stop`.
  Other participants are never told.
- `dispatch` drops a blocked proposal with no log and no `proposal_skipped` (:223). `networkStateFromRecords`
  then sees it as pending.

## M9 `sim-stub-opportunity`: StubNetwork opportunity

- Kind: explicit. `Opp.stage`: inviting, scheduled, done, cancelled. `Invite.status`: pending, yes, no,
  expired, dropped. stubNetwork.ts:49-53. Flags `reminded`, `feedbackSent`. `deadline`.

| From | Event | Guard | Effect | To | Where | Trigger |
|---|---|---|---|---|---|---|
| none | dispatch | no minor, enough free, not blocked | opp, first invite (pair) or all (group) | inviting | :208-233 | tick |
| inviting | yes (pair, first) | other unsent | invite second, deadline reset | inviting | :280-287 | member |
| inviting | yes (pair, both) | | | scheduled | :288 | member |
| inviting | yes (group) | yes >= quorum | | scheduled | :291 | member |
| inviting | no (pair) | | | cancelled | :274 | member |
| inviting | deadline | group, yes >= max(3, quorum-1) | | scheduled | :334 | clock |
| inviting | deadline | else | | cancelled | :335 | clock |
| inviting | STOP (pair) | | | cancelled | :384 | member |
| inviting, scheduled | block | both in it | | cancelled | :374-375 | member |
| scheduled | late yes (group) | meetingAt > now + 2h | adds, re-records | scheduled | :259-268 | member |
| scheduled | "can't make it" | keep | | scheduled | :311-323 | member |
| scheduled | "can't make it" | !keep | | cancelled | :322 | member |
| scheduled | reminder | at-4h <= now < at | reminded | scheduled | :338-342 | clock |
| scheduled | feedback time | at+3h, 9-21 local | | done | :343-351 | clock |

Notes:
- `handleInviteReply` looks up the pid from `awaiting`, which is single-valued. A second invite overwrites
  `awaiting`. The first opportunity then expires without the member's answer.
- A late yes can raise a member whose status was `dropped`, including one dropped by STOP who later sent START.
- `reminder` at at-4h for a 10:00 slot (timeAware) goes at about 06:00 local. The judge exempts it as an accepted
  opportunity (metrics.ts:518-521). The `network` block checks ConsentNetwork reminders, not the stub. Low.
- `cancel` line 357 compares to `"declined_first"`, a reason no caller passes. Dead condition.

---

# Part 2. The judge (`judge/metrics.ts`)

The judge reads a run log in order and folds it through per-member and per-opportunity state. It is a set of
monitors. Each is a machine. A Quint model should state the same property as an invariant. These machines
matter because `bun run sim` is the only proof of "invariants are 0".

## M10 `judge-member-line`: per-member timeline

- Kind: implicit. `Line` metrics.ts:239-243: lastIn, outSince, lastOut, lastOutProactive, askAt, askUsed, streak,
  reengageUsed, proactive[], laneTs, optedOut, state, city, recent[], lastOpp.

Classifier: a delivered outbound is proactive unless (a) within 15 min of the last inbound and fewer than 3
outbound since (`reply`), (b) on an opportunity the member accepted (`inAccepted`), or (c) within 48 h of an
ask and fewer than 2 follow-ups (`followup`). metrics.ts:517-521.

Monitors on proactive messages: `proactive_mislabeled`, `over_budget`, `quiet_hours`, `pause_path_missing`,
`two_unanswered`. Monitors on every message: `send_after_stop`, `duplicate_send`, style.

| Event | Effect | Where |
|---|---|---|
| join | lastIn, outSince = 0 | :312 |
| opt_out / opt_in / START | optedOut | :313, :314, :415 |
| participation_state | state | :315 |
| inbound | ask window, streak reset rule, decline read, lastIn, outSince = 0 | :425-436 |
| outbound delivered | classification, counters, monitors | :517-547 |

Invariant mapping: over_budget uses `PRD_BUDGETS` (open 4/7d, normal 2/7d, quiet 1/30d, receiving and paused 0),
`LANE_BUDGETS` plan and check_in 1/7d. outreach.ts:96-108.

S-06 (gap, VERIFIED-READ, high). Founder decision 7 sets a person-level cap of 3 proactive messages a day across
all apps, at send time. The judge has no such rule. One gate exists outside the judge: `slop-live: the person cap`
(scripts/sim/slop-live.ts:269-273). That gate has three limits. It runs on one app and one member id per person, so
"across all apps" is not tested. It trusts `meta.proactive`, which the judge's own header refuses to trust. It
uses a rolling 24 hours, while the production reader may use a calendar day (check `PERSON_DAILY_CAP` use in
packages/network/service/service.ts). The World has no person with two memberships.

S-07 (gap, VERIFIED-READ, high). No per-app opt-out monitor. `optedOut` is global. A send in slop after "leave
slop.date" is not a defined event in the log schema.

Other notes:
- The README text says over_budget is "more than 3 proactive messages in 7 days". The code says 2 for normal.
  Stale doc.
- AGENTS.md says the single 14-day re-engagement "shows as a two_unanswered violation". The code now exempts one
  when `meta.reengagement === true` and `streak === 2` (metrics.ts:540) and ConsentNetwork sets it (network.ts:3339).
  The AGENTS.md note looks stale. Confirm with the owner.
- The exemptions (a), (b), (c) apply to quiet hours too. A 3 am "follow-up" within 48 h of an ask passes. The
  `network` block adds a separate quiet-hours gate, only for seed 3 (scripts/sim/network.ts:100-105).
- `send_after_stop` depends on `opt_out` records from the World. It is sound for World runs. A log that comes from
  `packages/network/service/runtime.ts` needs its own check.

## M11 `judge-consent-tracking`: who accepted, who declined

- State: `accepted`, `decliners`, `oppMembers`, `oppRoster`, `probed`, `msgOpp`, `swapped`. metrics.ts:252-271.
- Writers of `accepted`: decision records (:318-326), `probe_started.primed` (:345), `meeting_scheduled` (:404).

S-03 and S-01 above are in this machine. Also:

S-09 (P0 for the proof, VERIFIED-RUN, high). `meeting_scheduled` makes the Network its own witness. The header says
meetings are simulator records, but World writes that record from `ctx.recordMeeting`, which the Network under test
calls (world.ts:191, 223). At metrics.ts:404 every participant becomes accepted. No monitor asks "did each
participant say yes before the meeting was scheduled?". Reproduction: one `meeting_scheduled` with no decision,
then five nudges: no violations. Same for `probe_started.primed` (:345), which is also Network output.
Missing invariant: `meeting_without_consent`. The `network` block has a partial check, on one seed, using
`op.primed` (scripts/sim/network.ts:79-84), and `primed` is Network state again.

S-10 (VERIFIED-READ, medium). Consent is never withdrawn in the judge. `accepted` only grows. A member who accepted
and then said "no", or sent STOP then START, stays accepted for that opportunity, so later messages on it stay
exempt. `decline` after accept is ignored (:324 `!hasAccepted`, :432).

## M12 `judge-review-gate`

- State: `reviewGated`, `approvedOpps`, `reviewExempt`. metrics.ts:295-303.
- Machine per opp: `unknown` -> `approved` (review_decision approve) -> `unknown` (any other decision) ; `exempt`
  (probe_started with origin player or reviewed false). `unreviewed_contact` fires for a delivered proposal or probe
  while not approved and not exempt, and for each `probe_sent` log.

AGENTS.md: "Every proactive proposal, and every member-initiated request, must go through human review before any
member is contacted."

S-08 (VERIFIED-READ, high). The gate is opt-in by evidence. `World.complete` passes no options (world.ts:365). A
Network that writes none of the four log kinds has `reviewGated = false`. Callers that pass `requireReview: true`:
`scripts/sim/network.ts:49`, `scripts/sim/slop-live.ts:177`, `packages/network/harness/experiment.ts:177`,
`packages/observatory/src/sources/game.ts:397`. The `audit` block's run and other direct `w.complete()` metrics
do not. Fail-open default.

S-12 (P0 for the proof, VERIFIED-RUN, high). Plan probes escape the review monitor. The monitor runs only for
`meta.type` proposal or probe, or a `meta.probe` (metrics.ts:509). A plan probe has `type: "plan_probe"` and
`plan: { planId }` (network.ts:2993-2994). Reproduction under `requireReview: true`: a probe gives
`unreviewed_contact: 1`, a plan_probe gives none. In ConsentNetwork the plan path logs `probe_sent` with oppId
(network.ts:4097), and that branch (:352-353) does check review. So the proof holds by the log line, not by the
message. A Network that sends a plan probe without that log passes. `crew_offer`, `checkin`, `growth_ask` and
`relay` messages are unchecked too, though they may be out of scope for the review rule.

S-13 (P0 for the proof, VERIFIED-RUN, high). The judge reads plan fields that do not exist. metrics.ts:444 types
`plan` as `{id, invited, alternates, participants, hostId}`. The core type is `PlanMeta { planId, activity, options,
window, size, area }` (core network.ts:181-190), and ConsentNetwork writes `planId`. So `plan?.id` is always
undefined and `oppId` is undefined for every plan probe. All of :445-454 does nothing for them. `snapshot.ts:360`
uses `planId` correctly. Result: `addOpp`, `addRoster`, `probed`, `msgOpp`, `name_before_reveal` and the
minor roster check never run on a plan probe. AGENTS.md decision 11 asks for "minor contacts via plans copy" to
reach 0, so the rule exists, and the monitor cannot see the message itself.

S-20 (P0 for the proof, VERIFIED-RUN, high). `plan_probe` and `crew_offer` are not in `CONNECT_TYPES` (metrics.ts:88).
A plan probe sent to a declared minor gives `minorContacts: 0`; the same text as `probe` gives 1. It is caught only if
the body matches `CONNECTION` or names a member, or if `probe_started`/`probe_sent` is logged. The body of a plan probe
names nobody by design. The `network` block adds "plans: 0 minors in any plan role", from the arm's own counters.

The self-exemption:
S-21 (VERIFIED-RUN, medium). `reviewed: false` in a `probe_started` log exempts the opportunity (metrics.ts:343).
The Network under test writes that log. ConsentNetwork does not write `reviewed: false` today (grep finds none; it logs
`origin`), so the key is unused, and it opens a hole: `origin: "player"` is a real value, and any bug that labels an
engine opportunity "player" removes it from the review check. Reproduction: a probe with `reviewed:false` gives no
violation under `requireReview`.

## M13 `judge-minor-flag`

- State: `flaggedMinor` (network age logs), `isDeclaredMinor`, `isHiddenMinor`, `minorRosterOpps`. metrics.ts:205-216.
- Machine per member: `adult` -> `flagged` (minor_signal, age_unknown) -> `adult` (age_confirmed or age_resolved with an
  adult `d.age`).

S-22 (VERIFIED-READ, high). Schema mismatch on clear. The judge reads `d.age` (metrics.ts:330). ConsentNetwork logs
`age_resolved` as `{ memberId, minor }` (network.ts:714) with no `age`, and nothing logs `age_confirmed`. So
`isMinorAge(undefined)` is true (fail closed), and `flaggedMinor` is never cleared by a real log. The direction is safe.
It can raise a false `minor_contact` for a member who gave an adult age after `age_unknown`. `age_unknown` needs a
missing age, which World personas do not have, so no run hits it. The staff clear (`clear_minor_signal`,
network.ts:1578) is also unread.

S-23 (VERIFIED-READ, medium). A monitor that can clear a flag does not match "the lowest age ever stated wins"
(decision 1). The branch :330 would clear a `minor_signal` on an `age_confirmed` log. If the logs are fixed for S-22 this
branch must not clear a stated minor age.

Also: hidden minors (trueAge < 18, claimed 18+) count only as `undisclosedMinorProposals`. They are not a violation,
by design (decision 9: a stated age is enough).

## M14 `judge-block-tracking`

- State: `blocked` pairs. metrics.ts:280. Written only by `block` records.

S-05 (P0 for the proof, VERIFIED-READ, high). The `block` record comes from `ctx.recordBlock`, a Network call
(world.ts:199-202). A persona's block is a text ("block Sam", world.ts:421) and a `mem.blocked` entry (world.ts:420).
World does not log the persona's intent. So a Network that fails to parse the block never gets a block record, and
`blocked_pair_proposed`, `blocked_pair_meeting` and `blocked_pair_relayed` cannot fire. The header's trust boundary
does not hold here. The same pattern does not apply to `opt_out`, which World writes. The scenario expectation
`blocked_pair_kept_apart` fails when no block happened (scenario.ts:229), so scenarios cover this, on those scripts only.
The comment on `report X` adds a gap: a `report` initiative has `block` undefined (policy.ts:733-736).

## M15 `snapshot-network-state`: derived opportunity history

- Kind: implicit. `networkStateFromRecords` snapshot.ts:268-338. Outcome union: pending, accepted, declined, expired,
  completed, no_show. `openOpportunities.stage`: inviting, scheduled.

Divergence and defects:
- S-24 (VERIFIED-READ, medium). Only `meta.type === "proposal"` counts as an invite (:286) and only a `proposal` thread
  can answer (:291). Probes and plan probes are not read. Under ConsentNetwork, probe answers do not reach
  `interactions`. Declines of a probe are invisible here, and the opportunity shows `pending`, then `expired` after
  three days (:324). The Network has its own record, so this affects the engine's view only where the snapshot is the source.
- `dec?.length` wins over the outcome (:317). A group where one member declined and the meeting then happened reads
  `declined`.
- 48 h and 3 d are hard-coded here (:310, :324) and differ from the Network's TTLs.
- `feedbackReading` and `inviteAnswer` are a second copy of reply understanding, though the second calls core `parseReply`.

## M16 `oracle-decision` and `intent-liveness`

Oracle is a pure function of (seed, proposal id or stable key). No lifecycle. `withLiveDesires` makes a want `live` until
hidden `lapsesAt`. `intentRecordTiming` (persona.ts:165-184) computes a record state `not_stated`, `active`, `closed` from
time alone; it is a derived machine with reconfirm steps every 30 days. `closed` is reached only when a check-in is
answered after the lapse. `unresponsive` freezes it at `active`.

Do not model in Quint. Abstract it as nondeterministic choice for accept, show and answer. This is an important
abstraction: Quint explores what the oracle only samples.

Note: `Oracle.score` uses `people.length >= 2` for `compatible`, so a one-person ask is never compatible, by design.

## M17 `connected-source-status`

`ConnectedSourceSummary.status`: connected, confirmed, pending_confirmation, rejected, revoked (sources.ts:262-277). These are
assigned once at generation. No transitions in the sim. So the source consent machine (connect, confirm, revoke, delete
facets) has no simulation coverage. `found_profile` namesakes keep no data, by construction. P2 for the sim; the production
machine belongs to another scope.

---

# Part 3. The per-app worlds

Common shape: each world is a loop of weekly rounds. Inside a round, each proposal runs to its end in one
synchronous step. So there is no in-flight state, no timer, no concurrency, and no overlap between two flows of one
member, except through caps. These worlds use the real engine for matching and hand-written flows for everything after
the proposal. The flows are copies of the product's flow, not the product's code. Exception: `relayItem`,
`probePhotoRefs` and `slopProbeMessage` are the real engine functions.

## M18 `slop-world-flow`

- Kind: explicit. `FlowRecord.stage` apps/slop/world.ts:52-53: dropped_policy, dropped_first_cap, first_silent, first_no,
  dropped_partner_cap, partner_silent, partner_no, backout, no_show, date. Flags: firstYes, partnerYes, mutualYes,
  revealed, declaredMinor, filterViolation. Mirrored by `InteractionRecord.outcome`: expired, declined, cancelled,
  no_show, completed.

| Step | Event | Guard | To | Where |
|---|---|---|---|---|
| 0 | proposal | unknown or same id | dropped_policy | :196 |
| 0 | proposal | claimed minor | dropped_policy + declaredMinor | :198 |
| 0 | proposal | either paused | dropped_policy | :199 |
| 1 | first probe | invites >= cap or booked | dropped_first_cap | :218 |
| 1 | first probe | no reply | first_silent | :222 |
| 1 | first probe | no | first_no | :223 |
| 2 | partner probe | cap or booked | dropped_partner_cap | :225 |
| 2 | partner probe | no reply / no | partner_silent / partner_no | :230-231 |
| 3 | reveal | both yes | revealed; harms drawn; relay exchange | :232-278 |
| 3 | back-out | either | backout | :282 |
| 4 | attendance | either absent | no_show | :289-291 |
| 4 | date | both | date; feedback; second date; maybe paused | :292-305 |

Probes model: first with the live want, then partner with the first's picks. Same as attention design (c). The pinned arm
has `photos` off, by decision 2026-10-11 (#22).

Invariants: declared minors never reach step 1. No reveal without two yeses. No harm on a dropped flow.

Divergences and defects:
- S-26 (P0 for the proof, VERIFIED-READ, high). The pinned slop world turns on a check production does not have.
  scripts/sim/slop.ts:55 `WORLD = { verification: true, ... }`. `verificationFacets` writes `verify:*:fail` for 70% of
  scammers, 90% of catfish and 85% of age liars (apps/slop/snapshot.ts:61-64, 71-72), and the pack holds any failed check
  (engine packs/slop/options.ts:15-18). Founder decision 9: "No ID check: phone login is the identity check". Production
  has `verification: { required: false }` and no writer of `verify:` tags. So the blocking gate "Scammer median reach <= 1"
  and the tracked adversary and age-liar cuts are measured with a filter that does not exist live. The random arm does not
  get `WORLD` (slop.ts:91), so "cut vs random" counts that filter too. The `slop-live` arm has no scammers
  (`adversarialRate: 0`, slop-live.ts:128). So no gate measures scammer reach on the live configuration.
- S-25 (VERIFIED-READ, high). A vacuous gate. "no photo is shown between members: 0 probes carry a photo"
  (slop.ts:117-118). `PACK_WORLD` has no `photos`, so `rc.photoCount` never moves (world.ts:215) and `res.photos` is absent.
  The gate cannot fail. It reads the sim's own config, not the product. The header at slop.ts:5-7 still says "photo in the
  probe (sd 1)". The live check is in `scripts/sim/relay.ts:575`.
- D-05 (VERIFIED-READ, medium). Decision conflict in the relay world. slop.ts:56 says no photo relay. relay.ts:146 still scripts
  `photo` items, and they can be delivered. AGENTS.md decision 9 describes a photo relay. One of these is stale. Ask the owner.
- S-27 (VERIFIED-READ, medium). Holds are not re-checked inside a week. `resolveWeek` checks `paused` only (world.ts:199). A hold
  placed by flow i of a round does not stop flow i+1 of the same round. Peon re-checks at delivery (peon/world.ts:226), friends does
  not (friends/world.ts:140-143). Production checks at send time. The sim is more pessimistic here. The three worlds disagree.
- S-28 (VERIFIED-READ, medium). An age slip does not lower the age. `ageSignal` is local to one exchange (relay.ts:132, 182) and
  `stated.claimedAge` never changes. The member goes on a hold with no end (world.ts:251-252). Production records the lowest age
  (decision 1) and, per scripts/sim/audit.ts:398-404, keeps it across apps. So a hold stands in for "is a minor". The relay's "minor:party"
  rule then fires only inside that one thread; in a later thread that member is only `held`.
- D-06. No per-opportunity human review in the slop, peon or friends worlds. `PlatformModel.review` is the review of a held member
  (snapshot.ts:88-90, 147-151), not the gate before contact. Only `slop-live` runs the review queue.
- D-07. Relay runs before the back-out (world.ts:238 vs 280), once per flow, and has no close. A relay after cancel, after a later
  block, or after a ban is not modelled here. `scripts/sim/relay.ts` has scripted cases for a closed match.
- D-08. `safetyHolds` have no staff step and no ban. `to` is set at creation when "cleared" (world.ts:252). There is no lift event.
  `state.paused` has no exit.
- A hold and a block are written only when `h.reported`. `applyHarms` runs at the end of a flow, so a report in flow i is visible from
  the next snapshot, and in the same round only through `heldNow` in relay.
- `f.filterViolation` is computed before the minor and pause checks (world.ts:197), so a dropped flow can count.

## M19 `slop-relay-sim`

- Kind: explicit. `decision`: pass, hold, block (engine). `RelayRole`, `ItemClass` (relay.ts:19-21). Per-thread sets: `flagged`,
  `ageSignal`, `recent`, `history`.
- Machine per exchange: `open` -> (sender held for family in `SLOP_SENDER_HOLD`) -> `sender_held` -> all later items from that sender stop;
  (age slip) -> `minor_party` -> all items stop. `adversarial.ts` `Thread` adds the same rules for five scenarios.
- This is the same pure function as production. The transition logic is real. What is scripted is the platform's reaction.
  Two copies of that reaction exist (world.ts:243-253, adversarial.ts:83-84) and the production RelayDesk is a third.

## M20 `peon-application-flow`

- Kind: implicit. `Flow` flags: delivered, dropped{minor,held,cap,repeat,invalid,closed}, replied, yes, reviewed, onFile, employerYes,
  expired, interviewWeek, interviewed, passed, offered, accepted, hired, withdrawn, roleClosed, scamContact (peon/world.ts:96-110). Interaction
  outcome: pending, expired, declined, accepted, no_show, cancelled, completed.
- States: `dropped`, `no_reply`, `candidate_no`, `queued`, `on_file`, `employer_no`, `expired_ghosted`, `cancelled_role_closed`, `interview_booked`,
  `scam_contact`, `withdrawn`, `no_show`, `interviewed_fail`, `interviewed_pass`, `offered`, `declined_by_cand`, `hired`.
- A week runs: close roles; matcher; probes; offers from week-1 interviews; candidate takes the best; interviews; review; exits; audit.
- Candidate lifecycle: `not_joined`, `active`, `hired`, `exited`. Job: `not_posted`, `open`, `closed` (`openings` 0). Company: `ok`, `held`.

Invariants: `openings >= 0` (:285). No delivery with a hold (:226). One introduction per pair for the whole run (:225).

Defects:
- S-29 (VERIFIED-READ, medium). `exited` is not an exit. `candActive` guards only new probes (:198, :227). Review, interview and offer steps check
  `state.hired` only (:256, :292, :310). A candidate who left the search still interviews and can be hired.
- S-30 (VERIFIED-READ, low). `held` ignores `to` (:191). The same type has an end in the slop world. Peon holds are forever.
- `audit: "flag"` (the default) holds nothing (:386). audit.ts:3 says "the harness holds flagged companies", true only for `hold`.
- Age: `f.minor` reads hidden truth (:217), but peon persona `declaredAge` equals true age (persona.ts:235), so there are no age liars. The gate
  `minors = 0` counts proposals of declared minors. The name `minorsMatched` overstates it.
- `scam_reach` counts real victims after a relay screen with an assumed catch rate of 0.7 (:50). That is an assumption, not a measure.

## M21 `peon-seats` (real ConsentNetwork)

scripts/sim/peon-seats.ts is not a world. It drives the real ConsentNetwork through intake, review, candidate probe, blind manager review, intro, restart
by `exportState`/`importState`, and close. It checks the production machine directly. See the network researcher's file for its states. In this
scope the only finding: its context `send` always returns `delivered` (:97-101), so no failed or suppressed send is exercised, and `recordBlock` is
a no-op (:106).

## M22 `friends-world-flow` and `friends-crew`

- Kind: explicit. `FlowRecord.stage` apps/friends/world.ts:56: dropped_policy, no_quorum, backout, no_show, held, crew_declined. `ProposalKind`: plan, partner,
  repeat, crew_offer, crew_session, plus `crew_self` meetups. `verify` per persona: pending, passed (snapshot `verifyAt`).
- Crew machine: `offered` -> (optIn < 3) `declined`; (optIn >= 3) `formed` -> `session` (repeat) -> `handedOff` when `sessionsHeld >= 3` (:256) -> `self_meeting` (decays).
  No exit from `formed` or `handedOff`. Not reachable: a crew that loses members. `crew_session` for a handed-off crew is dropped (:148), stage stays `dropped_policy`.

Defects:
- S-31 (VERIFIED-READ, medium). Blocks and holds do not reach hidden hangouts. The pair loop (:275-278) reads only `world.mutual`, so a pair still meets after one blocks
  the other. Crew self-meetings skip held members but not blocked pairs (:270). Hours and V14 can count them.
- S-32 (VERIFIED-READ, low). `dropped_policy` is the default stage and also the label for `crew_session` on a handed-off crew, a bad activity, or empty options. It is
  not a policy event.
- S-33 (VERIFIED-READ, low). `pr.kind === "crew_offer"` with no `pr.crew` skips the offer block, then `state.crews[len-1]!` at :231 and :254 reads the wrong crew or undefined. The
  pack always sets `crew`, so this is unreachable today.
- A pair flow's second invite ignores a cap by `return null` then treats it as not yes. Fine. A cap drop is silent to the member by design.
- `state.checkIns` is rebuilt each week. Fine. `lastPlannedAt` is written at ask time, even for a member who drops out.

## M23 `slop-onboarding-sim`

scripts/sim/onboard.ts runs `extractSlopProfile`/`applyCorrection` -> `readBack`/`nextQuestion` from the engine against templated answers. The states
are the engine's `SlopOnboarding`. This file records only that the sim is a loop over the real functions, and that its P4 fill target is tracked and not blocking.
Blocking: 0 wrong gender or seeking after confirmation, minors flagged, no read-back leak.

---

# Part 4. `bun run sim`: gates as a machine

## M24 `sim-gate-run`

- Kind: explicit. `Gate { pass, blocking }` scripts/sim/gate.ts:6. A gate is `PASS`, `FAIL` (blocking), or `track`.
- `Block.run` turns a throw into a failed gate. A block that throws gets one failed gate "ran to completion" (scripts/sim.ts:93).
- Exit: 1 when any blocking gate failed, else 0 (:106). Unknown `--only` name: 2.
- `--quick`: quality gates become tracked (`blocking = safety || !quick`).
- Skips: a block that cannot reach Postgres records a tracked gate with "skipped" and returns. `bun run sim` then passes with those proofs missing. CI fails on the word
  "skipped" under REQUIRE_PG=1 (.github/workflows/ci.yml:95-99). So the fail-closed rule lives in shell text matching a gate name. A skip gate whose name lacks that
  word would pass silently. `pipeline: skipped`, `Postgres scenarios: skipped`, `observatory-6: skipped`, `network-service-M1: skipped` all carry it.
- `ops.ts` has its own switch `pgBlocking`. Its two skip gates also carry the word. Two mechanisms for one rule.
- Determinism gates: `fingerprint` gates are tracked, with `pass: true` always (`b.track(..., true, digest)`). They never fail.

## M25 `scenario-grade`

`ExpectationResult.status`: pass, fail, skipped. `ScenarioResult.vacuous` when all are skipped. pass^k: k consecutive seeds (scenario.ts:262-292).

S-34 (P0 for the proof, VERIFIED-READ, high). The JSON scenarios run against the stub only. scripts/sim/network.ts:304-309 builds `new StubNetwork`. So
`stop-keyword`, `post-match-harassment`, `lying-minor-seeks-romance`, `minor-joins-single-player` and `private-disclosure-canary` prove the push baseline, which AGENTS.md says has no
review and no leak check. `lying-minor` has an expectation `appliesTo: ["consent"]` that is skipped there. `band-week-apart` and `nyc-to-sf-traveler` have `appliesTo: ["engine"]`
expectations, and no engine is passed, so these are skipped too. The ConsentNetwork has its own `SCENARIOS` (packages/network/harness), so this is not a hole in total coverage, but
a reader of the gate names may think so. Consider running the JSON set against ConsentNetwork too.

`factLeaked` is a three-content-word match (scenario.ts:278). `canary_not_leaked` uses it. The judge's `canary_leak` uses tokens only.

---

# Part 5. What the gates check, and where the sim differs from production

## Coverage of production machines

| Production machine | Rule | Sim coverage | Gap |
|---|---|---|---|
| STOP on shared line | decision 7, consent path | judge `send_after_stop` on World runs; `pipeline` real queue with fake Blooio, 3 stops | Gateway fence and `/internal/turn` consent copy not in `bun run sim` |
| Per-app leave | decision 7 | `pipeline` Fay case; `evals` parser | No world run; judge has no scope (S-07) |
| START | consent path | stub and ConsentNetwork code; no persona sends it (S-15) | Path untested in worlds |
| Person daily cap | decision 7 | `slop-live` gate only | Not across apps (S-06) |
| Weekly budgets, lanes | PRD_BUDGETS | judge `over_budget`; `network` block | Exempt on accepted opps; accept is over-read (S-01, S-03, S-09) |
| Quiet hours | | judge; `network` block seed 3 | Exempt after an ask (M10) |
| Review gate | AGENTS invariant | judge `unreviewed_contact`, `network` block, `pipeline`, `slop-live` | Plan probes by log only (S-12); fail-open default (S-08); self-exempt (S-21) |
| Consent before reveal | decision 11 | judge `name_before_reveal`; network gates | Accept over-read; no `meeting_without_consent` (S-09) |
| Minors never matched | decision 1 | judge `minor_contact`; conformance; all worlds | Plan messages blind (S-13, S-20) |
| Lowest age wins | decision 1 | `audit` service gate | Judge can clear flags (S-23); slop world keeps claimed age (S-28) |
| Blocks | | judge `blocked_pair_*`; scenario | Needs the Network's own record (S-05); outcome unchecked (S-04) |
| Bans | decision 3 | `safety` block, Postgres part | No world has a ban |
| Leak guard | AGENTS invariant | canary; `evals`; `relay`; `network` gates | Stub has none; fine |
| Relay | decision 9, 12 | `relay` block, `slop` world, adversarial, desk | HTTP endpoint not in sim; desk with a fake host |
| Outbound queue | | `pipeline` | Real code, one seed, one script |
| Eliza takeover notice | 2026-10-09 | none in sim | integration test only |
| Deliver path, receipts | 2026-10-09 | none in sim | integration test only |
| Photos and rater | decision 12, 13 | `safety`, `clef` | Fake Workers AI |
| Ops alerts and dispatcher | | `ops` block | Scripted, real code |

Search result: no file in `packages/sim/src` or `scripts/sim` calls `/internal/turn` or `/internal/network/deliver`. `scripts/sim/relay.ts:362` names `/internal/relay` in a comment only.

## Model divergences

- D-01. One total order of events. No concurrency, so no race can appear. Crash windows exist only in `pipeline` (one scripted crash) and `peon-seats` (one restart).
- D-02. English STOP set only in the channel.
- D-03. No per-app leave, no `opt_in` record from World.
- D-04. Carrier replies are a channel feature, not a turn. Production: gateway owns the webhook; the backend replies inside `/internal/turn`. The `pipeline` block posts the Blooio webhook
  to the service, a path AGENTS.md says production does not take for live traffic. Its comment admits this (scripts/sim/pipeline.ts:238-239). So `pipeline: 0 sends after STOP` proves the
  service path, not the gateway fence.
- D-05. Photo relay decision conflict.
- D-06. No opportunity review in the app worlds.
- D-07. Relay has no close in the slop world.
- D-08. No staff actions in worlds.
- D-09. World meetings have no cancel (S-04).
- D-10. One member id equals one person, one app. `LoggedPersona.apps` exists, and no World run sets it. `cross_app_leak` is unreachable on World runs unless a network labels messages.
- D-11. Failed sends cannot be retried with their key (S-11).
- D-12. The sim clock moves only at events. A TTL that ends between ticks ends at the next tick. `tickMinutes` 60 hides sub-hour timing. Production ticks faster.
- D-13. Persona ages never change. `claimedAge` is fixed, except scripted lines. Age conflict appears only in scripted gates.
- D-14. Slop, peon and friends snapshots build `Member.state` as normal or paused only. `unansweredProactive: 0`, `onlyWhenAsked: false` always (slop snapshot.ts:280-282).

---

# Part 6. Defect index

| Id | Title | Where | Conf. | Effect on proof |
|---|---|---|---|---|
| S-01 | Ignored accept counts as consent | judge/metrics.ts:321, agent/policy.ts:245 | high, run | yes |
| S-03 | Counter counts as consent | judge/metrics.ts:321, snapshot.ts:386 | high, run | yes |
| S-09 | meeting_scheduled self-certifies acceptance; no meeting_without_consent | judge/metrics.ts:404 | high, run | yes |
| S-13 | Judge reads plan.id; the field is planId | judge/metrics.ts:444-445 | high, run | yes |
| S-20 | plan_probe, crew_offer not in CONNECT_TYPES | judge/metrics.ts:88 | high, run | yes |
| S-12 | Plan probes skip the review message check | judge/metrics.ts:509 | high, run | yes |
| S-05 | Block record comes from the Network | world.ts:199, 421 | high | yes |
| S-04 | World has no meeting cancel | world.ts:470, policy.ts:227 | high, run | yes |
| S-26 | Pinned slop world has a verification check production lacks | scripts/sim/slop.ts:55 | high | yes |
| S-34 | JSON scenarios prove only the stub | scripts/sim/network.ts:306 | high | partly |
| S-08 | Review check is fail-open by default | world.ts:365, metrics.ts:296 | high | partly |
| S-02 | Scheduling default decision is accept | agent/policy.ts:163 | high | yes |
| S-06 | Person daily cap not in the judge, not cross-app | judge/metrics.ts:528-534 | high | yes |
| S-07 | No app-scoped opt-out monitor | judge/metrics.ts:313 | high | yes |
| S-11 | Failed send burns its idempotency key | channel.ts:74 | high | model |
| S-25 | "No photo" gate is vacuous | scripts/sim/slop.ts:117 | high | yes |
| S-10 | Consent never withdrawn in the judge | judge/metrics.ts:324 | medium | partly |
| S-21 | `reviewed:false` self-exempts | judge/metrics.ts:343 | medium, run | partly |
| S-22 | age_resolved has no `age`; clear branch dead | judge/metrics.ts:330, network.ts:714 | high | small |
| S-23 | Flag clear conflicts with lowest age | judge/metrics.ts:330 | medium | latent |
| S-14 | START guard exact; HELP dropped after STOP | world.ts:246 | medium | model |
| S-15 | No persona returns from STOP | world.ts:443 | medium | gap |
| S-24 | Probes invisible to networkStateFromRecords | snapshot.ts:286, 291 | medium | model |
| S-27 | Holds not re-checked in a round | apps/slop/world.ts:199 | medium | model |
| S-28 | Age slip does not lower age | apps/slop/relay.ts:182 | medium | model |
| S-29 | Exited candidates still interview | apps/peon/world.ts:256, 292 | medium | model |
| S-31 | Blocked pairs still hang out | apps/friends/world.ts:275 | medium | metric |
| S-16 | Stub `awaiting` can stick | stubNetwork.ts:298, 348 | medium, not seen in one run | baseline |
| S-17 | Stub budget only on random path | stubNetwork.ts:208-221 | high | baseline |
| S-18 | Stub deferred invite resurrects a dropped member | stubNetwork.ts:139-143, 250 | medium | baseline |
| S-19 | Stub STOP ignores scheduled opps | stubNetwork.ts:382 | low | baseline |
| S-30 | Peon holds ignore `to` | apps/peon/world.ts:191 | low | model |
| S-32 | `dropped_policy` overloaded | apps/friends/world.ts:138, 148 | low | label |
| S-33 | Crew offer without crew | apps/friends/world.ts:231 | low | unreachable |

Probe output (scratchpad script, seed-free crafted logs; `computeMetrics` from the repository):

```
control: 5 nudges, no accept                   {"over_budget":3,"two_unanswered":3}
1 ignored accept + 5 nudges                    {}
2 counter + 5 nudges                           {}
3 network-reported meeting + 5 nudges          {}
4a plan_probe to minor                         {}   minorContacts 0
4b crew_offer to minor                         {}   minorContacts 0
4c probe to minor (control)                    {"minor_contact":1}
5a plan_probe to adult, requireReview          {}
5b probe to adult, requireReview (control)     {"unreviewed_contact":1}
5c probe, self-exempt via reviewed:false       {}
7 block then outcome (both showed)             {}
```

Stub run (120 personas, 30 days, seed 1): one opportunity cancelled after scheduling, one outcome recorded for it, one seat shown. `awaiting` on a finished opportunity: 0 in that run.

A caution on impact: S-01, S-03, S-09, S-12, S-13, S-20 show what the judge cannot see. They do not show that ConsentNetwork does these things. It has its own gates (`recipientPolicy`, plan
counters, `probe_sent` logs). The finding is that a regression there would pass `computeMetrics`.

---

# Part 7. Quint modelling notes

Priority order, and the merge plan:

| Id | Priority | Model | Plan |
|---|---|---|---|
| judge-consent-tracking, judge-review-gate, judge-minor-flag, judge-block-tracking | P0 | no model of the judge itself | Turn each into a Quint invariant on the production model, then use it as the spec the judge must match. Fix list comes from Part 6 |
| sim-channel-opt-out + sim-member-lifecycle | P0 | merge with the production consent machine | Add per-app scope, START, STOP race |
| sim-flake-and-meeting | P0 | merge with production opportunity | Must add cancel, block after booking, minor flag after booking |
| sim-proposal-decision | P0 | environment | Persona as nondeterministic: yes, no, counter, silent |
| slop-world-flow, friends-world-flow, peon-application-flow | P1 | small model of the flow only | Use as sanity check that the sim flow refines the product flow |
| sim-outbound-idempotency | P1 | merge with the outbound queue | Add failed and retry |
| sim-run-lifecycle, sim-event-queue | P2 | no | Driver only. Quint interleavings replace it |
| sim-stub-*, sim-gate-run, scenario-grade | P2 | no | Fix in code |
| oracle-decision, intent-liveness, connected-source-status | P2 | abstract | Nondeterminism |

Suggested state for the merged P0 model (bounds: 3 members, 2 apps, 2 opportunities, 2 clock ticks per TTL):

```
var phase: Opp -> str              // review, probing, scheduled, done, cancelled
var answer: (Opp, Member) -> str   // none, yes, no, counter, silent
var approved: Opp -> bool
var optOut: Member -> Set[App]     // {} or all or one app
var blocked: Set[(Member, Member)]
var lowestAge: Member -> int
var held: Set[Member]
var sent: List[Msg]                // {to, kind, opp, app, t}
```

Actions: `propose, approve, reject, expire, probe, reply(answer), reveal, book, cancel, stop, start, leave(app), block, statesAge, hold, ban, tick, sendReminder`.

Invariants to check:
1. `noContactUnapproved`: every sent probe, plan probe or reveal has `approved[opp]`.
2. `revealNeedsYes`: reveal or booking implies `answer = yes` for every participant. Counter and silent fail it. This is S-01, S-03, S-09 as a spec.
3. `noMinorInAnyConnectionKind`: no message of any connection kind, plan probe and crew offer included, to or about a member with `lowestAge < 18`.
4. `noSendAfterStop`: after `stop`, nothing except the compliance reply until `start`, by scope.
5. `blockWins`: after `block(a, b)`, no new proposal, no reveal, and no meeting that still counts as held. Booked meetings move to cancelled.
6. `cancelledIsFinal`: no outcome after cancel. This is S-04.
7. `lowestAgeMonotone`: `lowestAge` never rises.
8. `personDailyCap`: at most 3 proactive per person per day across apps.
9. Liveness (with fairness on tick): every `review` opp leaves `review` by approve, reject or expire. Every `probing` opp ends.

Abstractions: time as integer ticks. Text as a kind. Oracle as a nondeterministic choice. Budgets as counters over a sliding window of ticks.

---

# Part 8. What was read

Read in full: packages/sim/README.md; src/stubNetwork, channel, scheduler, world, plans, time, snapshot, scenario, oracle, persona, sources, cli, engineAdapter, index, network, llmGenerator, taxonomy;
src/agent/*; src/judge/*; src/apps/README.md, apps/gates.ts; apps/slop world, relay, behavior, adversarial, metrics, packEval, snapshot, enginePack; apps/peon world, gates, audit, arms; apps/friends world, gates, arms,
packMatcher; scripts/sim.ts; scripts/sim gate, capital, evals, conformance, network, safety, ops, audit, slop, slop-live, peon, peon-seats, friends, pipeline, pipeline/harness.

Read in part (headers, gate lists, or lines around state; line ends cut at about 170 characters in some cases): src/generator.ts (first 120 lines plus a search), scripts/sim relay.ts, onboard.ts, clef.ts; apps/slop oracle, baselines,
visible; apps/peon baselines, metrics, snapshot, persona; apps/friends snapshot, metrics; scenarios/*.json (expectation lists; post-match-harassment in part).

Not read: apps/slop persona, bodyType, geo, clefSynth, cli; apps/peon oracle, skills, cli; apps/friends oracle, persona, visible, baselines, cli. These are data generators and CLIs. By name and by their callers they hold no lifecycle state, but that is not verified. The `relay`
block's scripted cases should get a second pass by the relay researcher.
