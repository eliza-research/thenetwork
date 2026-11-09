# Quint findings: `quint/opportunity.qnt`

Model: [`quint/opportunity.qnt`](../../../quint/opportunity.qnt). Plan: section 6.6 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Code: `packages/network/src/network.ts`
(`N:<line>`) and `packages/network/src/classify.ts` (`C:<line>`) on branch `wave2/opportunity`. The first
version of the model (0d8cf9f) followed the code at ad67275 and showed the defects. The fixes are the
commits c06f633 to 25b54f1. This version follows the code after the fixes. This file is hand-written. The
traces are short forms of the simulator output and of the run tests.

## 1. Final state

`safety` holds. Every defect that was fixed is checked by an invariant in `safety` and by a run test that
replays the fixed trace. The defects that were skipped still fail: their invariants are in `knownOpen`
(not in `safety`), and each has a run test that shows the trace on the current code.

`bun run quint:check --verify quint/opportunity.qnt` passes: Apalache finds no violation of `safety` in 3
steps from the initial state (section 7). To make this possible, a unit's large helpers are now jobs on a stack
(section 2), and the state has no set of messages. Deeper simulation (section 4) found one model error in
`requestNotStuck` (section 8).

## 2. What the model covers

- Machines: `opportunity-lifecycle`, `opp-participant-status`, `review-item`, `awaiting-slot`, `yes-hold`,
  `send-pipeline-and-deferred`, `send-belief`, `booked-attendance`, `member-request` (one request),
  `outreach-attention` (the two-unanswered pause and the Blooio streak) and the tick. `reply-reader` is an oracle.
- Bounds: 3 members (`a`, `b`, `c`), 2 pair opportunities. `o1` is a member request of `a` with `b`
  (alternate `c`). `o2` is an engine intro of `a` with `c` (alternate `b`). Time is in hours.
- One unit under the store lock: `submit`, `approve` and `reject` (staff), `probeSend`
  (the probe at a moment the send window is open and the member owes no other answer), `answer(m, intent)`
  (an inbound text), `stop`, `start`, `becomeMinor`, `forget` (leave or delete), `tick`, `elapse` (the clock
  moves with no tick) and `queueDecide` (the outbound queue sends, holds or refuses a collected probe or
  reveal).
- Jobs. A unit action does the light part of the unit. The large helpers that it calls are jobs on a stack
  (`s.jobs`): `close`, `replaceOrClose` (`replace`), `advanceProbes` (`probes`), the reveal to one participant
  (`reveal`), `handleDrop` (`drop`), the dropMember step for one opportunity (`dm`), the rest of `forget`
  (`forgetRest`), and the parts of the tick: one deferred send (`deliver`), `refreshUnanswered` (`refresh`),
  `advance` for one opportunity (`adv`), the probe silence of one participant (`exp`) and `expireSlots`
  (`expire`). A helper pushes the jobs it calls on top of the stack, in the order of the calls in the code, so
  the jobs run in the code's order. The units are enabled only when the stack is empty (`idle`); while it is not
  empty, only the job actions are. So a unit is still atomic, as in the code. Each job uses the unit's oracles
  (`s.jobEnv`). The invariants and witnesses are read only when `idle` is true. The tick's deferred sends are
  delivered one job at a time in any order; the code goes in insertion order, which is one of them.
- Oracles: the send window and quiet hours, the intro budget, the meeting lead time, the queue outcome,
  and the readers (fixed maps from what the member means to what the code reads).
- Ghost state: what the member meant (`accepted`, `withdrawn`, `saidNo`, `cancelAsked`), what reached them
  (`probeQ`, `revealQ`: the queue state of the probe and of the reveal, at most one of each per opportunity
  and member), who was told what (`revealSent`, `wasTold`, `cancelHeard`, `released`) and which notices
  `send()` refused (`noticeRefused`). The model keeps no other message: no invariant reads one. `s.collected`
  counts the collected messages. A member keeps the times of the first two proactive invites since their last
  text (`ask1`, `ask2`), which is all that the two-unanswered rule reads.
- Not modelled: plans and plan runs (`plan_run.qnt`), job seats and the hiring manager, groups of 3 or
  more, blocks and reports, the engine run, repeat asks and standing-request retries, the matching switch,
  MCP profiles.

## 3. Changes to the model for the fixes

| Id | Commit | Model change |
|---|---|---|
| SD-009 | c06f633 | `reviewOpen`: `approve` and `reject` need `now < review.deadline` (`reviewBlock`, N:1975). |
| SD-041 | 113a369 | `readProbe` and `readYesNo`: a bare counter-offer is "unclear" (`consentOf`, C:598). A counter with a yes word is the `yes_other_times` reading. |
| SD-043 | 74602b1 | `owedAnswer` (N:4662): when the job-post read-back ends, the slot goes back to the owed probe or booked plan (N:4681). `probeOwed`: a probe waits while the member owes an answer on another probe (N:2201). `noLostAnswer` lets the `posting` slot hold the slot, because it gives it back. |
| SD-047 | 7d979c2 | `dropMember`: only a member with status `yes` leaves a booked meeting (N:2632). With pairs only, this changes no trace. |
| SD-048 | 73d1e2b | `replaceOrClose` clears the slot of the member who is out (N:2408-2410). |
| SD-075, SD-076 | 791ff6a | `route`: with no slot, "no" or a cancel takes back an `available` yes (N:807-812). `onProbeAnswer` accepts a no from `available` (N:2330). The time-retry expiry clears the slot before it keeps the yes (N:3430-3432). |
| SD-077 | 6d8d2d3 | `probeOwed`: a probe waits while the `feedback` slot is open and nothing else is owed (N:2201). |
| SD-139 | 6e500fa | `handleDrop`: when the item closes and the requester still says yes, the request goes back to `none` (N:2560-2563). |
| SD-248 | c29646e | `defValid`: the drop notice is valid until the meeting time, also after `forget` deleted the item (N:4158). |
| SD-263 | 791f698 | `close`: a contacted member with status `available`, not the requester, gets a release (`info`, logistics timing) unless the reason is `blocked` or `minors policy` (N:2587-2591). Deferred releases are kind `release`. |
| SD-328 | 25b54f1 | `finalize` records `noShowCounted`; `onFeedback` does not count a self no-show again (N:2673, N:2825). |

Two more model changes:

- SD-146 (not reproduced). The first model let a deferred reveal wait in quiet hours until the meeting
  time. The code does not create that state (see section 5). The model now has a clock constraint,
  `deferredInTime`: no `tick` or `elapse` passes the meeting of a deferred reveal or drop notice, and the
  last tick before the meeting has that member's window open. The first model's 49-hour tick jumps also
  dropped a deferred drop notice in this way; the same constraint covers it. This is an assumption from
  the time-option code. The model does not check it.
- `sendNotice`: one helper for every notice (`declined_quiet`, `release`, `none_yet`, `drop_notice`), at the
  first send and at a deferred send. It records a refused notice in `noticeRefused`.

## 4. Check output

`bun run quint:check --verify quint/opportunity.qnt` (bounds `max-steps=250 max-samples=8000 verify-steps=3`,
seed `0x5eed`). `max-steps` went from 40 to 250 because each job is a step now: a tick is up to about 10 steps.

```
ok   quint/opportunity.qnt typecheck
ok   quint/opportunity.qnt test                         (22 run tests)
ok   quint/opportunity.qnt safety
ok   quint/opportunity.qnt witness_revealed (must be reachable)
ok   quint/opportunity.qnt witness_feedbackAnswered (must be reachable)
ok   quint/opportunity.qnt witness_rejectNoContact (must be reachable)
ok   quint/opportunity.qnt witness_confirmedBySilence (must be reachable)
ok   quint/opportunity.qnt witness_requestFulfilled (must be reachable)
ok   quint/opportunity.qnt witness_yesTakenBack (must be reachable)
ok   quint/opportunity.qnt witness_partialReleased (must be reachable)
ok   quint/opportunity.qnt verify safety
```

`safety` also has no violation at seeds `0x1`, `0x2` and `0x3` (8000 traces of 250 steps each).

`safety` is: `reviewGate`, `decidedBeforeDeadline`, `namesAfterAllYes`, `counterIsNotYes`, `slotOwnerAlive`,
`noLostAnswer`, `minorNever`, `stopWins`, `terminalStable`, `requestNotStuck`, `cancelReachesTold`,
`partialAcceptReleased`, `noShowOnce`, `bookedMembersTold`.

`knownOpen` (not in `safety`; each value alone, same bounds and seed, is violated, as expected):

| Value | Register id | Run test |
|---|---|---|
| `confirmedImpliesDelivered` | SD-006 | `silentConfirmTest` |
| `silenceOnlyAfterDelivery` | SD-030 | `refusedProbeSilenceTest` |
| `declineRecorded` | SD-140 | `partnerNoTest` |
| `bookedNoHonored` | SD-259 | `lateNoTest` |
| `noticeNeverRefused` | SD-249 | `cancelRefusedTest` |
| `bookedSlotAlive` | SD-139, second part (residual) | `requestStuckTest` |

Three invariants in `safety` have an exemption for a skipped or residual case. Each exemption is named in
the invariant's comment:

- `cancelReachesTold` and `partialAcceptReleased` exempt a member in `noticeRefused` (the streak rule
  refused the notice: SD-249, checked by `noticeNeverRefused`).
- `partialAcceptReleased` exempts a close for reason `minors policy`: the SD-263 fix sends no release on
  that close by design (no message about an item with a minor).
- `requestNotStuck` exempts a request whose requester called the booked meeting off: the request stays
  `booked`, and a new ask opens a new request (`openRequest` skips `booked` requests, N:1597). It also accepts
  a done item that `forget` deleted (section 8).

`--verify` (Apalache, `verify-steps=3`): see section 7.

## 5. Defects: final status

### Fixed, and checked in `safety`

- **SD-009** (c06f633). `lateApprovalTest`: `submit(o2)` -> `elapse(13)`: no decision is possible
  (`reviewOpen` is false) -> `tick(1)` expires the item; nobody is contacted. `decidedBeforeDeadline` holds.
- **SD-041** (113a369). `counterOfferTest`: probe to `a` -> "how about next week instead?" is unclear: one
  clarification, the slot stays -> `tick(27)` expires it; `b` replaces `a`; no names go out.
  `counterIsNotYes` and `namesAfterAllYes` hold.
- **SD-043** (74602b1). `postingTakesSlotTest`: probe to `a` -> job post: slot `posting` -> "no" drops the
  post and the slot is `probe/o1` again -> "yes" makes `a` available. `noLostAnswer` holds. The seat path
  (the second probe to a hiring manager waits) is in `probeOwed`; the model has no seats, so no trace
  reaches it. The plan-probe path is not modelled.
- **SD-047** (7d979c2). Changed in `dropMember`. The model has pairs only, so a scheduled participant who is
  not `yes` does not occur; the change keeps the model the same as the code.
- **SD-048** (73d1e2b). `replacedProberTest`: `b` probing -> STOP -> `c` replaces `b` -> START: `b` has no slot.
  `slotOwnerAlive` holds.
- **SD-075** (791ff6a). `withdrawnYesTest`: `a` yes -> "no": `a` is out of `o2`, `b` replaces `a`; `b` and `c`
  say yes; names go to `b` and `c` only. `cancelYesTest`: the requester says yes, then "I need to cancel":
  `o1` closes and the request waits again.
- **SD-076** (791ff6a). `noAfterRetryTest`: "yes, but none of those times" -> `tick(27)` keeps the yes and
  ends the slot -> "no" takes the yes back; `o1` closes with no reveal.
- **SD-077** (6d8d2d3). `feedbackAsYesTest`: after the `o1` meeting `a` has the `feedback` slot -> `o2` is
  approved; `probeOwed(a, o2)` is true, so the probe waits -> "it was great!" answers the feedback -> the
  probe goes out with its own slot.
- **SD-139** (6e500fa). `requestStuckTest`: `b` cancels the booked request: `o1` closes and the request is
  `none`. `requesterCancelsTest`: the requester cancels: the request stays `booked` (exempt, see section 4)
  and `b` hears the plan is off. `requestNotStuck` holds.
- **SD-248** (c29646e). `leaveInQuietHoursTest`: `b` in quiet hours -> `a` leaves: the drop notice to `b` is
  deferred and `o1` is deleted -> `tick(6)`: `b` gets the notice. `cancelReachesTold` holds.
- **SD-263** (791f698). `partnerNoTest`: `a` yes, `c` no, no free alternate: `o2` closes and `a` is released.
  `partnerNoQuietTest`: the release waits for `a`'s window and goes at the next tick.
  `partialAcceptReleased` holds.
- **SD-328** (25b54f1). `noShowTwiceTest`: `a` says `b` never showed -> `finalize` counts `b` once ->
  `b`'s late "I couldn't make it" does not count it again. `noShowOnce` holds.

### Fixed, not in the model

- **SD-033** (839facd) and **SD-035** (e15c554): reader defects. The readers are oracles in the model; the
  `evals/replies.jsonl` and `evals/network/consent-replies.jsonl` rows test them.
- **SD-143** (aed5df4): the plans buddy, second-encounter and newcomer paths are not modelled.
- **SD-266** (dc55401) and **SD-267** (e4cee3c): the model has one request, no repeat ask, no daily retry
  and no matching switch.

### Not reproduced

- **SD-146**. The first model's trace (a meeting 8 hours ahead inside the member's quiet window) does not
  occur in the code: the time options leave out the first member's quiet hours, the partner picks only from
  those, and MIN_NOTICE (6 h) and PARTNER_LEAD (12 h) give the deferred reveal time to go out. The model
  was wrong; it now has the clock constraint `deferredInTime` (section 3). `deferredRevealTest` shows the
  deferred reveal going out at the last tick before the meeting; `bookedMembersTold` holds and is in `safety`.
- **SD-325**. `o.deadline` is written and never read. Dead state with no behavior to check; not modelled.

### Skipped (still fail; in `knownOpen`)

- **SD-006** (`confirmedImpliesDelivered`) and **SD-030** (`silenceOnlyAfterDelivery`): the Network has no
  delivery-outcome path from the outbound queue. The fix crosses modules (with SD-095 and SD-257) and needs
  a founder or maintainer decision on the design.
- **SD-140** (`declineRecorded`): the fix was made and then removed, because it exposed two older sim-gate
  failures (the proactive timing of unsolicited info sends, and the minors-in-plans gate for a minor found
  only after contact). Those need to be fixed and decided first.
- **SD-249** (`noticeNeverRefused`): the line-safety streak rule refuses logistics at 3 unanswered; letting
  a cancellation past it, or adding a retry, needs a founder decision. The same rule can refuse an SD-263
  release or a "none yet" notice; the model records those in `noticeRefused` too.
- **SD-259** (`bookedNoHonored`): reschedule and a cancel outside the booked slot are a new flow and need a
  founder or maintainer decision on wording and window.

### Skipped, not in the model

- **SD-028**: routing on the shared line between two app networks is in the service; the model is one
  Network. Needs a founder decision.
- **SD-142**: the model has no MCP or carrier-keyword source on `answer`. Needs a founder decision.
- **SD-219**: profile editing by text (`profile_learning.qnt`); needs an upstream contract change and a
  scope decision.
- **SD-269**: an intro to a named member has no entry point; a new flow.
- **SD-297**: a missing message on resume, not a state. Needs a founder decision.

## 6. New finding (residual of SD-139)

`bookedSlotAlive` is still violated. When one member of a booked pair cancels, `handleDrop` closes the item
on its own path and clears only the dropping member's slot (N:2553). The partner keeps `awaiting: booked`
for the closed item until the slot ends (48 hours or the meeting time). In that time a "yes" from the
partner gets the booked thanks for a plan that is off (N:789). The 6e500fa fix covers the request only.
`requestStuckTest` shows the trace. The value stays out of `safety` until a fix lands with its own
integration test. This was the "second part" of SD-139 in the first version of this file.

## 7. Bounded model checking

`bun run quint:check --verify quint/opportunity.qnt` passes (Apalache 0.62.4, the default server with a 4 GB
heap): no violation of `safety` in 3 steps from the initial state.

Before this update, Apalache did not finish one step. The shared server (4 GB heap) ran out of heap while it
read the model. A private server with a 12 GB heap checked the 14 invariants in the initial state and then ran
out of heap on the third transition of step 1, after about 11 minutes. Each unit inlined all its helpers:
`tick` folded `deliverDeferred` (with `handleDrop`) and two `advance` calls (with `replaceOrClose`, `close`,
`advanceProbes` and the reveal), and `answer` inlined `onProbeAnswer` twice with all of these.

The changes (section 2): the job stack, so that each helper is once in the transition relation; the queue state
of the probe and of the reveal instead of the set of messages; two invite times instead of a list. The run tests
replay the same traces with the same results (with the jobs of each unit run after it: `settled`).

Measured on this machine (load average 40 to 90 from other sessions; wall clock):

| Run | Result | Time |
|---|---|---|
| model before this update, `--max-steps 1`, 12 GB heap | out of heap in step 1 | about 11 min |
| `quint verify --max-steps 2` | no violation | 1 min 43 s |
| `quint verify --max-steps 3` (the model's `verify-steps`) | no violation | 5 min 24 s |
| `quint verify --max-steps 4` | step 4 not done after 4 min | stopped |

What 3 steps reach: `submit`, then `approve` (its first job, `advanceProbes`, sets the turn) or `reject` (its
`close` job), or a tick or an `elapse` past the review deadline (SD-009: no decision after the deadline, and the
tick's `close` job expires the item). With the job stack, one unit is several steps, so a probe answer and the
reveal are deeper than 3 steps. They are covered by the random simulation (8000 traces of 250 steps at four
seeds) and by the 22 run tests. A start state deeper in the lifecycle (as in `plan_run.qnt`) made Apalache much
slower there: the start state is then a choice between states, and every later step carries that choice.

## 8. Model errors found and fixed during the work

- This update: `requestNotStuck` was false in the model before this update too, at more than 40 steps (the
  random simulation finds it at 60 steps). Trace (`requestAfterLeaveTest`): o1 is booked for a and b, the
  meeting time passes, a says "I couldn't make it", so finalize does not fulfil the request and it stays
  `booked` (allowed: the item is `done`). Then b leaves the app: `forget` deletes the done item (N:961) and
  clears the request's `oppId` (N:977). The invariant read this as a stuck request. It is not: the meeting was
  set, and a new ask from a opens a new request, as for the exempt case in section 4. This is the same state as
  `done`, so the invariant now also accepts a deleted item whose meeting time passed (`feedbackSent`). No code
  change.

- First version: `forget` left the slot and the member state of the forgotten member; a post-meeting
  answer was allowed from a member with no meeting; `partialAcceptReleased` asked for a release to a minor.
- This version: the 49-hour tick could pass the meeting with a deferred reveal or drop notice in quiet
  hours (SD-146, see section 3). The happy-path test first also asked for `knownOpen`; that fails on SD-006
  in every booked trace, because the queue does not decide the messages there.
