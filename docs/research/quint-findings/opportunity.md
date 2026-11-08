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

## 2. What the model covers

- Machines: `opportunity-lifecycle`, `opp-participant-status`, `review-item`, `awaiting-slot`, `yes-hold`,
  `send-pipeline-and-deferred`, `send-belief`, `booked-attendance`, `member-request` (one request),
  `outreach-attention` (the two-unanswered pause and the Blooio streak) and the tick. `reply-reader` is an oracle.
- Bounds: 3 members (`a`, `b`, `c`), 2 pair opportunities. `o1` is a member request of `a` with `b`
  (alternate `c`). `o2` is an engine intro of `a` with `c` (alternate `b`). Time is in hours.
- One action is one unit under the store lock: `submit`, `approve` and `reject` (staff), `probeSend`
  (the probe at a moment the send window is open and the member owes no other answer), `answer(m, intent)`
  (an inbound text), `stop`, `start`, `becomeMinor`, `forget` (leave or delete), `tick`, `elapse` (the clock
  moves with no tick) and `queueDecide` (the outbound queue sends, holds or refuses a collected message).
- Oracles: the send window and quiet hours, the intro budget, the meeting lead time, the queue outcome,
  and the readers (fixed maps from what the member means to what the code reads).
- Ghost state: what the member meant (`accepted`, `withdrawn`, `saidNo`, `cancelAsked`), what reached them
  (`msgs[].q`), who was told what (`revealSent`, `wasTold`, `cancelHeard`, `released`) and which notices
  `send()` refused (`noticeRefused`).
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

`bun run quint:check quint/opportunity.qnt` (bounds `max-steps=40 max-samples=8000`, seed `0x5eed`):

```
ok   quint/opportunity.qnt typecheck
ok   quint/opportunity.qnt test                         (21 run tests)
ok   quint/opportunity.qnt safety
ok   quint/opportunity.qnt witness_revealed (must be reachable)
ok   quint/opportunity.qnt witness_feedbackAnswered (must be reachable)
ok   quint/opportunity.qnt witness_rejectNoContact (must be reachable)
ok   quint/opportunity.qnt witness_confirmedBySilence (must be reachable)
ok   quint/opportunity.qnt witness_requestFulfilled (must be reachable)
ok   quint/opportunity.qnt witness_yesTakenBack (must be reachable)
ok   quint/opportunity.qnt witness_partialReleased (must be reachable)
```

`safety` also has no violation with `--max-steps 50 --max-samples 15000` at seeds `0x1`, `0x2`, `0x3` and
`0x4` (60000 traces).

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
  `booked`, and a new ask opens a new request (`openRequest` skips `booked` requests, N:1597).

`--verify` (Apalache, `verify-steps=6`): see section 7.

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

`bun run quint:check --verify quint/opportunity.qnt` fails on this machine: the shared Apalache server
(4 GB heap) runs out of heap while it reads the model. The flattened model is about 22 MB of JSON
(`quint compile --target json`), because every action folds over maps and inlines the helpers.
A second try used a private Apalache 0.62.4 server with a 12 GB heap
(`quint verify --invariant safety --max-steps 1 --server-endpoint localhost:8869`). It read the model,
checked the 14 invariants in the initial state, and then ran out of heap on the third transition of step 1
(after about 11 minutes). So bounded model checking does not finish for this model, even at 1 step, and
the `--verify` check fails. The checks in section 4 use the random simulator and the run tests only. To
make `--verify` possible, the model must be split into smaller models (for example the review gate, the
probe and yes-hold, and the booked attendance), each with fewer folds.

## 8. Model errors found and fixed during the work

- First version: `forget` left the slot and the member state of the forgotten member; a post-meeting
  answer was allowed from a member with no meeting; `partialAcceptReleased` asked for a release to a minor.
- This version: the 49-hour tick could pass the meeting with a deferred reveal or drop notice in quiet
  hours (SD-146, see section 3). The happy-path test first also asked for `knownOpen`; that fails on SD-006
  in every booked trace, because the queue does not decide the messages there.
