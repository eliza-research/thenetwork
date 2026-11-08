# Quint findings: `quint/opportunity.qnt`

Model: [`quint/opportunity.qnt`](../../../quint/opportunity.qnt). Plan: section 6.6 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Code: `packages/network/src/network.ts`
(`N:<line>`) and `packages/network/src/classify.ts` (`C:<line>`) on branch `wave2/opportunity` (from ad67275).
This file is hand-written. The traces are short forms of the simulator output.

## 1. What the model covers

- Machines: `opportunity-lifecycle`, `opp-participant-status`, `review-item`, `awaiting-slot`, `yes-hold`,
  `send-pipeline-and-deferred`, `send-belief`, `booked-attendance`, `member-request` (one request),
  `outreach-attention` (the two-unanswered pause and the Blooio streak) and the tick. `reply-reader` is an oracle.
- Bounds: 3 members (`a`, `b`, `c`), 2 pair opportunities. `o1` is a member request of `a` with `b`
  (alternate `c`). `o2` is an engine intro of `a` with `c` (alternate `b`). Time is in hours.
- One action is one unit under the store lock: `submit`, `approve` (staff), `reject` (staff), `probeSend`
  (the probe at a moment the send window is open), `answer(m, intent)` (an inbound text), `stop`, `start`,
  `becomeMinor` (minor signal or record age), `forget` (leave or delete), `tick`, `elapse` (the clock moves
  with no tick) and `queueDecide` (the outbound queue sends, holds or refuses a collected message).
- Oracles: the send window and quiet hours, the intro budget, the meeting lead time, the queue outcome.
  The readers are fixed maps from what the member means to what the code reads. Only the code's own
  mapping is modelled (`C:666`, `C:719`: a counter-offer is "yes"). The readers themselves are not checked.
- Ghost state: what the member really meant (`accepted`, `withdrawn`, `saidNo`, `cancelAsked`), what
  really reached them (`msgs[].q`), and who was told what (`revealSent`, `wasTold`, `cancelHeard`, `released`).
- Not modelled: plans and plan runs (`plan_run.qnt`), job seats and the hiring manager, groups of 3 or
  more, blocks and reports, the engine run, standing-request retries, the matching switch, MCP profiles.

## 2. Check output

`bun run quint:check quint/opportunity.qnt` (bounds `max-steps=40 max-samples=8000`, seed `0x5eed`):

```
ok   quint/opportunity.qnt typecheck
ok   quint/opportunity.qnt test                         (18 run tests)
FAIL quint/opportunity.qnt safety                       (expected: the model shows defects)
ok   quint/opportunity.qnt witness_revealed (must be reachable)
ok   quint/opportunity.qnt witness_feedbackAnswered (must be reachable)
ok   quint/opportunity.qnt witness_rejectNoContact (must be reachable)
ok   quint/opportunity.qnt witness_confirmedBySilence (must be reachable)
ok   quint/opportunity.qnt witness_requestFulfilled (must be reachable)
```

Each invariant alone (`quint run --invariant <name>`, same bounds and seed):

| Invariant | Result | Register id |
|---|---|---|
| `reviewGate` | holds (8000 traces) | - |
| `decidedBeforeDeadline` | violated | SD-009 |
| `namesAfterAllYes` | violated | SD-041, SD-075, SD-076, SD-077 |
| `counterIsNotYes` | violated | SD-041, SD-077 |
| `slotOwnerAlive` | violated | SD-048 (and the time-retry slot of SD-076) |
| `bookedSlotAlive` | violated | SD-139 (second part) |
| `noLostAnswer` | violated | SD-043 (posting path) |
| `minorNever` | holds | - |
| `stopWins` | holds | - |
| `confirmedImpliesDelivered` | violated | SD-006 |
| `silenceOnlyAfterDelivery` | violated | SD-030 |
| `terminalStable` | holds | - |
| `requestNotStuck` | violated | SD-139 |
| `cancelReachesTold` | violated | SD-249, SD-248 |
| `partialAcceptReleased` | violated | SD-263 |
| `declineRecorded` | violated | SD-140 |
| `noShowOnce` | holds in random simulation; violated by `noShowTwiceTest` | SD-328 |
| `bookedNoHonored` | holds in random simulation; violated by `lateNoTest` | SD-259 |
| `bookedMembersTold` | holds in random simulation; violated by `deferredRevealTest` | SD-146 |

`safetyHolds` (`reviewGate`, `minorNever`, `stopWins`, `terminalStable`) has no violation in 30000 traces.
The first `safety` counterexample at seed `0x5eed` is SD-030 (the probe to `a` is still pending in the
queue when it expires as silence).

`--verify` (Apalache) does not finish: `quint verify --invariant safety --max-steps 3` ran out of Java heap
(4 GB, the shared Apalache server on this machine). The state is one record of maps, sets and lists with
folds in each action. The checks above use the random simulator and the run tests only.

## 3. Defects the model reproduces

Each trace is the run test in the model (`quint test quint/opportunity.qnt --match <name>`). `ALL_OPEN`
means every send window is open, the budget is free and the meeting is 30 hours ahead.

### SD-009: a reviewer approves an item past its SLA

`lateApprovalTest`: `submit(o2)` (deadline t=12) -> `elapse(13)` -> `approve(o2)` -> `probeSend(o2, a)`.
`decidedAt 13 >= deadline 12` and the probe goes out. Code: the deadline check is only in `advance()`
(`N:3345`); `decide()` (`N:1889`) and `reviewBlock()` (`N:1941`) do not check it. The model needs `elapse`:
the clock moves between ticks and `withTickLock` can skip a tick.

### SD-041: a counter-offer counts as a yes, and silence after it reveals names

`counterOfferTest`: probe to `a` -> "how about next week instead?" -> `C:719` returns yes with no keys ->
time retry (`N:2314-2322`) -> `tick(27)`: `N:3378` keeps the yes -> `b` says yes -> reveal to both.
`counterIsNotYes` and `namesAfterAllYes` fail. Without options `C:666` maps the counter to yes at once.

### SD-075: a member cannot take back a yes before the reveal

`withdrawnYesTest`: `a` says yes (status `available`, slot cleared, `N:2300`) -> `a` says "no" or "I need
to cancel": no slot, no scheduled plan, so `handleInbound` does nothing (`N:798-801` looks only for a
scheduled plan) -> `b` says yes -> reveal names `a`. `namesAfterAllYes` fails.

### SD-076: a "no" after a silent time retry is swallowed

`noAfterRetryTest`: `a` says "yes, but none of those times" -> `tick(27)`: `N:3378` sets `available` and
`continue`s before the slot is cleared, so the slot stays `probe` (`slotOwnerAlive` fails) -> `a` says
"no thanks": the probe branch clears the slot and `onProbeAnswer` returns because the status is not
`probing` (`N:2292`) -> `b` says yes -> reveal. `namesAfterAllYes` fails.

### SD-077: a feedback answer is read as a yes to a new probe

`feedbackAsYesTest`: `o1` meeting done, `a` has the `feedback` slot -> "ok" (not an answer, `N:805-812`;
the streak resets) -> `o2` submitted, approved, probe to `a`: the probe hook writes the slot with no
`expect()` (`N:4055`) -> "it was great!" reads as yes (`N:766-772`) -> `a` is `available` in `o2`.
`counterIsNotYes` fails; `namesAfterAllYes` fails if `c` says yes.

### SD-048: a replaced prober keeps a dead `awaiting: probe`

`replacedProberTest`: `b` is probing -> STOP: `dropMember` sets `unavailable` and `replaceOrClose` puts `c`
in (`N:2580`); nothing clears `b`'s slot -> START. `b` keeps `probe/o1`; the tick never expires a `probe`
slot (`N:3285`). The random simulation also finds the time-retry variant (`N:3378`).

### SD-043: the posting writer takes the slot of a pending probe

`postingTakesSlotTest`: probe to `a` pending -> `a` sends a job post: `postingTurn` runs before the probe
branch (`N:755`) and sets `awaiting: posting` with no `expect()` (`N:4636`). `noLostAnswer` fails. The seat
and plan-probe paths of SD-043 need the hiring manager or a plan; the model has neither.

### SD-006: silence confirms a booked plan that never reached the member

`silentConfirmTest`: reveal to `b` is collected (`onSent` sets `bookedAt`, `N:4075-4085`) -> the queue
holds it (the line's unanswered cap, `packages/blooio/src/outbound-queue.ts:398-401`) -> `tick(49)`:
`N:3392` confirms `b` by silence. `confirmedImpliesDelivered` fails. The Network has no signal back from the
queue.

### SD-030: a probe the queue refused still counts as contact and as silence

`refusedProbeSilenceTest`: probe to `a` collected (`contacted`, `sentAt`, `pendingAsks`, `N:3938`,
`N:4053-4058`) -> the queue refuses it -> `tick(27)`: `N:3379-3382` expires it as `a`'s silence and the item
closes. `silenceOnlyAfterDelivery` fails. The same message also counts toward the two-unanswered pause
(`N:3323`).

### SD-139: a booked request stays `booked` after its meeting is called off

`requestStuckTest`: `o1` booked, `r.outcome = "booked"` (`N:2442`) -> `a` cancels -> `handleDrop` closes on
its own path (`N:2518`), not `close()`, so the request is not reset (`N:2544`). `requestNotStuck` fails.
The same trace shows the second part: `b` keeps `awaiting: booked` for a closed plan (`bookedSlotAlive`
fails). The random simulation also reaches it through `dropMember` (a minor signal or a leave of the partner).

### SD-140: a declined probe is recorded as expired

`partnerNoTest`: `o2`, `a` yes, `c` "no" (`N:2334` sets `unavailable`), no free alternate -> `close(o2,
"no one available")` records `expired` with `declinedBy` empty (`N:2559`). `declineRecorded` fails.

### SD-263: a yes-sayer whose partner says no hears nothing

`partnerNoTest` (same trace): `close()` tells only when the item was booked (`!wasProbing`, `N:2540`).
`o2` has no requester, so `a` gets no message. `partialAcceptReleased` fails. The random simulation also
finds the case where the partner's probe expires in silence. For `o1` the requester gets `tellNoneYet` once
(`N:1642`).

### SD-249: a cancellation can be refused by the streak rule, with no retry

`cancelRefusedTest`: `o1` booked; the reminder brings both to 3 messages since their last text -> `a`
cancels -> the drop notice to `b` is refused by `canSendLogistics` (`N:3885`); the `drop_notice` hook has no
`onRefused` (`N:4105`) -> the item closes. `cancelReachesTold` fails. The random simulation reaches the same
state when a deferred reveal raises the streak.

### SD-248: a leave or delete in quiet hours loses the partner's cancellation

`leaveInQuietHoursTest`: `o1` booked; `b` is in quiet hours -> `a` leaves (`forget`, `N:913`): `dropMember`
-> `handleDrop` defers the drop notice to `b`; then `forget` deletes the item (`N:920`). The notice has no
`about`, so `N:947` keeps it, and the next tick drops it because `valid()` needs the item (`N:3274`,
`N:4105`). `cancelReachesTold` fails.

### SD-146: a deferred reveal that goes invalid is dropped

`deferredRevealTest`: `b` is in quiet hours at the reveal (meeting 8 hours ahead) -> the reveal to `b` is
deferred -> at the meeting time `valid()` is false (`N:4076`) and the tick drops it with no `onRefused`
(`N:3274`). The plan stays `scheduled` and `b` was never told. `bookedMembersTold` fails. This needs a quiet
window that covers the time from the booking to the meeting; the window oracle allows it.

### SD-259: cancel works only inside a narrow slot

`lateNoTest`: meeting 72 hours ahead -> `tick(49)` ends the `booked` slot (48 hours, `N:3285`) -> "no,
sorry": no slot and not a `cancel` reading, so nothing happens (`N:782-801`). `bookedNoHonored` fails.

### SD-328: a late feedback answer counts a no-show twice

`noShowTwiceTest`: `a` says `b` never showed -> `tick(96)`: `finalize` counts `b`'s no-show (`N:2771-2774`)
-> `b` answers "I couldn't make it" inside `feedbackDue`'s 7 days (`N:2590`) -> `onFeedback` counts it again
(`N:2621`). `noShowOnce` fails.

## 4. Register defects of this module the model does not reach

| Id | Why not |
|---|---|
| SD-028 | Routing on the shared line between two app networks happens in the service (`service.ts`). This model is one Network. |
| SD-033, SD-035 | Reader defects. The readers are oracles here; the `evals/` corpora test them. |
| SD-047 | Needs a scheduled item with more than 2 participants or a plan; the model has pairs only (`plan_run.qnt`). |
| SD-142 | The model has no MCP or carrier-keyword source on `answer`. The register calls the fix a founder decision. |
| SD-143 | The plans buddy, second-encounter and newcomer composition paths are not modelled. |
| SD-219 | Profile edit by text is the profile machine (`profile_learning.qnt`). |
| SD-266, SD-267 | The model has one request and no repeat ask, no daily retry and no matching switch. |
| SD-269 | Classifier scope (no intent for a member-initiated intro). |
| SD-297 | Missing copy on resume; `heardFrom` is modelled, but the defect is a missing message, not a state. |
| SD-325 | `o.deadline` is written and never read: dead state with no behaviour to check. |

SD-079, SD-258, SD-265, SD-326, SD-429 and SD-481 to SD-487 are in the plan list but not in this task's list.

## 5. Model errors found and fixed during the work

- `forget` first left the slot and the member state of the forgotten member. The code deletes them and
  clears slots on deleted items (`N:940-942`), and drops deferred sends about them (`N:947`). Fixed.
- A post-meeting answer ("it was great") was allowed from a member who never had a meeting. Guarded.
- `partialAcceptReleased` first asked for a release message to a member who became a minor. The code sends
  the minor notice instead, and a release would be a message about an opportunity. Minors are exempt.

## 6. New findings

None. Every `safety` violation maps to a register id above.
