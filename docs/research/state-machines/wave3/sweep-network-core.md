# Wave 3 sweep: packages/network outside service/ (ConsentNetwork core)

Hand-written, 2026-11-11. Read-only research on branch claude/quint-state-machines. Line numbers are on that branch
(network.ts = packages/network/src/network.ts, N:<line>). One probe was run (a bun script in this folder, `sd261.ts`,
on the real ConsentNetwork with MemoryStore). No model was changed.

Scope read: src/network.ts (state fields 531-604, inbound 631-893, send 4150-4520, tick 3526-3706, persistence
5038-5120, review 1955-2160, requests 1690-1820, encounters 4080-4150, fraud 3033-3070, forget 965-1020), src/store.ts,
src/outreach.ts, src/relay.ts (cap, prune, forget), src/capital.ts, harness/*. Models compared: opportunity,
outbound_queue, review_desk, turn_consent, safety_trust, relay, plan_run, plan_crew, join_age, runtime_ops,
matching_engine, notify_capital (headers and grep for each state field).

## 1. Coverage map of the 27 machines in network-consent-core.md section 1

Covered (states and transitions in a model): opportunity-lifecycle, opp-participant-status, review-item (approve,
reject, expire only), plan-run, booked-attendance, member-request (one request, no retries), member-age-policy and
onboarding stage (join_age), member-opt-out-and-forget (opportunity, turn_consent), awaiting-slot,
outreach-attention (two-unanswered pause only), send-pipeline-and-deferred (probe, reveal, feedback only),
trust-level, safety-case, safety-report, pending-safety-who, pair-relations (blocks), relay-held-item,
relay-number-swap (open drift already recorded), relay-match-view, job-posting, job-seat-item, crew-offer-and-crew,
store-unit-of-work (runtime_ops), ledger-emitter (notify_capital, as the capital intake).

Not covered: #24 fraud-item, #26 daily-gates-and-switches (only `matchingEnabled` is in staff_console, as a
browser switch), most of #11 (the send budgets), the non-opportunity part of #12, and the review re-roll and edit.

## 2. New machines (no model has their states)

### NM-1 outreach-budget (send controller per member) - P1 - new module `outreach_budget.qnt`

State (MemberState, N:254-330): `state` (open|normal|quiet|receiving|paused, synced from the record N:4772),
`proactive[]` (intro cap, OUTREACH.budget), `planInvites[]`, `unsol{state,plan,check_in}[]` (PRD_BUDGETS, LANE_BUDGETS),
`unsolStreak`, `lastOutUnsol`, `askAt`/`askUsed` (2 follow-ups in 48 h), `outbound` (Blooio streak), `openAskAt`
(one-question rule, 72 h in send N:4180; 24 h ASK_HOLD_MS in probe N:2295), `pendingAsks`/`unanswered`/`onlyWhenAsked`,
`reengaged`, `heldHighAt`, `lastInbound`/`lastAskAt`, `pendingAck` (24 h fold), `note` (7 days), `lastSent`
(10-minute duplicate window), `weekly`/`lastCheckinAt`/`calendar`/`offerMade`.

Transitions: inbound (N:641-652: initiated / MEMBER_ASK resets askAt; ACK_ONLY after a logistics text does not reset
the streak; heardFrom N:675 clears pendingAsks, outbound, openAskAt, reengaged, onlyWhenAsked); send (N:4165-4270:
recipient, intro cap, one-question, streak, timing/defer, ack and note fold, unsolicited lane verdict
transitions.ts:384 unsolVerdict, leak guard, duplicate skip, counters); tick (refreshUnanswered N:3595,
reengage N:3604 once per silence when heldHighAt is less than 7 days old, weeklyCheckins N:3584 on the check-in
weekday, at most once per 5 days, opt-in adults only); optIns (N:906, CALENDAR / WEEKLY [OFF]); syncRecord state change.

Rules that should hold (same names as the judge in packages/sim/src/judge/metrics.ts:528-561, so the model is
the specification the judge checks): `laneBudget` (unsolicited sends per lane within PRD_BUDGETS/LANE_BUDGETS;
receiving and paused get none in any lane), `twoUnanswered` (no third unsolicited send without an inbound, except
one re-engagement per streak), `pausePathOnUnsolicited`, `reengageOnce` (at most one per silence; never to minors,
opted-out), `checkinOnlyOptedIn` (weekly true, adult, not onlyWhenAsked), `noStandaloneAck`, `oneOpenAsk`
(no ask while a probe or booked yes/no is awaited, N:4183), `introCap` (OUTREACH.budget on initial invites).

Why Quint has value: the rules are counters over sliding windows that several actors move (inbound resets, tick,
deferred flush, record change of `state`), and two of the reset conditions are subtle (ACK_ONLY does not reset the
streak; a reply inside 15 minutes is not unsolicited, so it has no pause path and no lane count). Bounds: one member,
time in hours, budgets scaled (quiet 1 per 30 days scaled to 1 per 4 ticks). The text readers (ACK_ONLY, MEMBER_ASK)
are oracles. opportunity.qnt today takes the budget as an oracle (`env.budget`, opportunity.qnt:78, 175-182) and
models only ask1/ask2/onlyWhenAsked (opportunity.qnt:99, 570-576), so it cannot find a defect in the budgets.
Extending opportunity.qnt is possible but it is already at max-steps=250; a separate module that exports the
gate as a pure def that opportunity.qnt can call is better.

### NM-2 daily-gates-and-switches (#26) - P1 - new module `network_tick.qnt` (or a part of runtime_ops M-141)

State: `lastRunDay` (N:559), `lastPlanRunDay` (N:589), `opts.matchingEnabled` (persisted, N:5041),
`opts.review` (NOT persisted, N:1959; production is always "human"), `lastTick`/`tickGap` (N:568-569, 3527).
Transitions (tick N:3526-3576): the daily block runs once per New York day at the first tick in
[runHour, ENGINE_RUN_UNTIL=20) (N:3560): sets lastRunDay BEFORE `await dailyRun`, trust.decay, retryRequests and
dailyRun only when matching is on, localEncounters (growth asks always, encounters only when on), reengage,
queueFraudFlags. The plan block (N:3570) runs when plans and matching are on: runPlanner on runDays
(N:3131 sets lastPlanRunDay), else the tick sets it; crewSessions daily. setMatchingEnabled(true) resets
`openFrom` of standing requests (N:1974-1982).
Rules: `oneEngineRunPerDay`, `noEngineRunWhileOff`, `tickWorkNotHostage` (a failure of the engine run must not
discard the rest of the tick: review expiry, probe expiry, booked confirmation, deferred flush); `planRunDays`.
Why Quint has value: the gate interacts with the store unit of work (stored() saves only on success,
store.ts:53-58) and with the switch; SD-261 below is exactly an interleaving of "throw" with "no save". Quint can
model it with an `engineThrows` oracle and the stored/memory split that runtime_ops already has.

### NM-3 deferred sends that no opportunity owns - P2 - extend opportunity.qnt send-pipeline-and-deferred (or NM-1)

`ConsentNetwork.deferred` (N:541, push N:4200, flush N:3532-3545) holds any kind: info (inviteeJoined N:1050),
growth, reengage, interview asks (hook "ask", valid N:4428), feedback (hook with no `valid`, N:4421), drop_notice
(valid by meeting time, N:4419), checkin (valid: weekly and adult, N:4424), relay. The flush re-checks `valid()` and
timing; a timing miss puts the entry back WITHOUT a recipient check, so an entry lives across STOP until the window
opens (defect D-4). No TTL and no dedupe (except checkin, N:3589). opportunity.qnt models only probe, reveal and
feedback deferrals of its two opportunities. Rule: `noSendComposedBeforeStop` (a send composed before a STOP is
never delivered after it, START or not), `deferredBounded`.

### NM-4 fraud-item (#24) - P2 - small new module `fraud_review.qnt`, or a part of notify_capital Part B

`FraudItem.status` review -> confirmed | dismissed | expired (N:93-96, queue N:3033-3044, decide N:3056-3071,
forget N:1016). Dedupe key kind|members within 14 days; expiry at deadline in the daily block; a flag that names a
declined member is skipped for ever (N:3036). No production trigger today: runtime.ts:126 builds the capital wiring
with `reader: false`, so `capital.flags` is undefined (the harness and Observatory game turn it on). Rules:
`fraudNeverMessages`, `fraudOnePerKey`, `fraudSurvivesLeave` (fails, D-3), `noDecisionAfterDeadline` (fails, D-10).
Quint value: low now (no production path); worth a small module when the reader is turned on.

### NM-5 composed encounters: second encounter, newcomer welcome, plans buddy - P2 - extend opportunity.qnt (origins)

`again` map (N:554, written in onFeedback N:2826-2829, consumed in localEncounters N:4112-4123), newcomer welcome
(N:4126-4141, once per member: any opportunity that names them), plans buddy (`requests` kind "plans",
N:1910-1946). quint-findings/opportunity.md:171 already lists them as not modelled (SD-143). Rules: `mutualWishKept`
(a pair that both said "again" keeps the wish until it is proposed or barred; fails, D-2), `pairHistoryOnEveryPath`
(SD-143). Quint value: medium; the consumption order is an interleaving with eligibility (busy, streak, travel).

### NM-6 network-state persistence round trip - P2 - not a good Quint target (cover with an integration test)

exportState/importState (N:5038-5118), NETWORK_STATE_VERSION 1, JSON deep copies. Not persisted: `opts.review`,
the per-process caches `profiles` (N:4481, send-hour profile), `judgeCache` (N:3755, SD-420), `sendCfg` (N:4570),
`snapCache`/`records`/`snapBlocks` (cleared on import), `followup`, `outboundBefore`, `understood`. A field set is a
list, not a state machine: the right check is a round-trip test (export -> import -> export is identical; every
MemberState/Opp field is in MemberJSON/OppJSON). Quint would only restate the list.

### NM-7 harness (experiment.ts, scenarios.ts, growth.ts, paraphrase.ts) - carve-out

Simulator code (quint/README.md rule; section 6.18 of the research file): runArm and runScenario drive a World with
`review: "auto"`; scenario actions are applied in time order (scenarios.ts:402), one awaited `advanceTo` at a
time, so there is no concurrent unit. No production decision. No model; the class-B rule of
quint-findings/unmodelled.md applies (production rules go into the production modules as invariants).

## 3. Model gaps (covered machines whose model misses part of this area)

- G-1 opportunity.qnt: review re-roll and edit are not modelled (`Review` type opportunity.qnt:76 has decision,
  deadline, decidedAt, invalidated only). Code: reroll N:2128-2160 swaps a participant for an eligible alternate,
  resets the SLA deadline, deletes `primed`, regenerates explanations (reexplain), marks pairs declined, and
  closes when no alternate is left; edit N:2086-2104 leak-checks every edited text and the objective. review_desk.qnt
  models the browser keys only (server is an environment). Rules to add: `rerollNeverContactsOut`,
  `rerollInIsEligible`, `editLeakFree`, `slaPerReroll` (each re-roll gives one new SLA; alternates are finite).
- G-2 opportunity.qnt: member-request retries. Code: tries/lastTry (N:1777), retry at most every 20 h inside 7 days
  from `openFrom ?? at` (N:1806), no retry within 72 h of `lastConfirmAt` (N:1808, 2322), two "no" answers close
  the request (`noCount`, N:2460-2461), `toldNone` once unless asked again (N:1753-1757, SD-266), and the switch
  resets `openFrom` (N:1978, SD-267). The model has one request with outcome only. Rule: `requestTerminates`
  (a request ends: booked, fulfilled, closed, or ages out) and `toldOnceUnlessAsked`.
- G-3 opportunity.qnt: reminder timing. The model folds "T-4h, or the last allowed tick before it" into the window
  oracle (opportunity.qnt:627-628). The code predicts the next tick with `tickGap` (N:3670, 3701-3704), learned from
  the last two ticks (N:3527). runTick skips a tick when this process has a unit in progress (store.ts:42,
  withTickLock), and an outage makes tickGap large. A skipped "last allowed tick" before quiet hours loses the
  reminder for good (the next ticks are in quiet hours, then the meeting starts). The model cannot reach this.
  Add a `tickSkipped` action and keep `tickGap` as state.
- G-4 opportunity.qnt (and turn_consent): STOP then START with a deferred send that no opportunity hook guards
  (NM-3, D-4). `noSendAfterStop` holds in the model only because every modelled deferred entry has a `valid` hook
  tied to the opportunity.
- G-5 runtime_ops.qnt: M-141 models "ticks throw each round" for the tick_late alert (runtime_ops.qnt:869), but not
  the cause in the Network: the daily engine run is inside the same unit as all other tick work, and the in-memory
  `lastRunDay` write does not survive the failed unit (D-1). The SD-261 verdict ("refuted") rests on the
  in-memory write, which stored() discards.
- G-6 notify_capital.qnt / outreach: `emit` keys that hold `now` (state_changed N:4773, age_updated N:2929) are
  idempotent only inside one unit; not a new defect (SD-049 residual covers the failed-unit case), listed so that
  NM-1 reuses the same oracle.

## 4. Suspected defects

### D-1 (P1) SD-261 is real: one engine throw discards every tick from runHour to 20:00 New York, every day

Where: network.ts:3560-3567 (lastRunDay set before `await this.dailyRun(now)`), store.ts:53-58 (`stored`: no save on a
throw; the next unit imports the stored state, so the in-memory lastRunDay is lost), runtime.ts:761-763 (production
tick = runTick). Engine throws that data can trigger: engine/src/world.ts:101 (duplicate member id),
world.ts:106 (member id with "|"), pack.ts:333/358, any throw in a pack generator or fromProposal.
Trigger (reproduced, `sd261.ts` in this folder, Mini world, MemoryStore, hourly runTick): day 1 tick at 13:00 runs and
saves lastRunDay=2026-10-05. Add member "c|d". Day 2: 11 ticks from 09:00 to 19:00 New York throw
"member id holds the pair-key separator"; the stored state stays lastRunDay=2026-10-05, lastTick=08:00. In each failed
tick the deferred flush, review SLA expiry, probe TTL expiry and replacement, booked confirmation by silence,
reminders, feedback asks and attendance finalisation are all discarded. They run again only after 20:00, and the same
happens the next day. Effect: reminders for meetings in that window never go; probes are not replaced for up to
11 hours; quiet-hour deferrals that should go at 09:00 go at 20:00 (one hour before most quiet hours). Safety holds
(decisions past the SLA are refused by reviewBlock N:2067). The tick_late alert fires (runtime_ops SD-368 fix).
Proposal: run the engine in its own unit (or catch in dailyRun, log, keep lastRunDay so the day is skipped and the
rest of the tick saves); a sim gate or integration case "engine throws -> review expiry and reminders still happen".
Model: NM-2 with an `engineThrows` oracle; invariant `tickWorkNotHostage`.

### D-2 (P2) A mutual "meet again" wish is lost when either member is not eligible on that day

Where: network.ts:4112-4116. `this.again.delete(k)` runs before `eligible(a)`, `eligible(b)` and `pairBarred`.
Trigger: A and B both answer "would meet again" (N:2826-2829). At the next daily run A is busy with another
probing opportunity (busy N:4723), or has outbound >= 1 unanswered (canInterrupt, N:4717), or a trip makes inNyc
false. The key is deleted and `continue` skips it; nothing re-adds it, so the second encounter is never proposed.
network-consent-core.md:548 noted it; it is not in the register. Rule `mutualWishKept`.

### D-3 (P2, no production trigger) A leave by one ring member deletes the fraud item and exempts the others for ever

Where: forget N:1016 (`this.fraud = this.fraud.filter(x => !x.flag.members.includes(id))`), queueFraudFlags N:3036
(a flag that names a declined member is skipped). Trigger (harness or Observatory with the capital reader on):
detectGaming flags ring {a, b, c}; the item waits for review; a leaves (service forget -> Network.forget adds a to
declinedIds). The item is gone, and every later flag of the same ring names a, so it is skipped: b and c are never
reviewed. A confirmed item is also deleted (the staff record of the decision is lost; the ledger clawback stays).
Compare reports: they stay after a leave (N:1008, "leaving never escapes a ban"). Fix direction: drop only the leaver
from the flag (or keep ids only, like reports), and do not skip a flag because one member is declined.

### D-4 (P2) STOP does not end deferred sends; a START before the window opens releases them

Where: handleInbound N:711-712 (STOP sets optedOut and dropMember; START clears it), dropMember N:2756-2779 (no
`deferred` filter), tick flush N:3539-3542 (`valid()` then timing; on a timing miss the entry is pushed back with no
recipient check). Trigger: a member on "only when I ask" gets the re-engagement at 09:00 (reengage N:3604, slot
timing); their send window is 12:00, so it is deferred and `reengaged` is set. 10:00 STOP (heardFrom N:675 also
resets reengaged and onlyWhenAsked). 11:00 START. 12:00 tick: the entry has no `valid`, timing passes, send() passes
the recipient check (optedOut false) and the "something is waiting for you" text composed before the STOP goes out.
Same with a feedback ask deferred by quiet hours (N:3686, hook "feedback" has no valid) or an inviteeJoined info.
Fix direction: on STOP drop the member's deferred entries (as forget does, N:1000). Rule `noSendComposedBeforeStop`.

### D-5 (P2, simulator path only) tellNoneYet overwrites a pending probe slot

Where: network.ts:1761 (`m.awaiting = { kind: "growth" }` directly, not through expect() N:4451, which never replaces
a probe or booked slot), reached from openRequest's prior-request branch N:1705 (tellNoneYet(m, prior, true) is
called even when the member is busy). Trigger (growth and ctx.invite on: simulator, Observatory): A has a standing
request (outcome none) and then gets an engine probe (awaiting probe). A texts the same want again inside the
re-search interval; the probe branch (N:812-822) reads it as unclear and clarify() returns false for a
people_request; openRequest -> tellNoneYet -> awaiting = growth. A's next "yes" is not read as the probe answer
(N:798 path is skipped), so the probe expires as silence after 26 hours (PROBE_TTL N:468). Production has no
ctx.invite (invitesWork false, N:2882), so the line does not run there.

### D-6 (P2) A failed first unit persists its partial writes

Where: store.ts:53-58. `if (state) net.importState(state)`: with no stored row (a new network, or after a restore that
lost the row), a throw inside fn leaves the in-memory Network mutated; the next unit also loads nothing, keeps the
mutated memory and saves it. Trigger: first ever inbound for a new app:city throws after member() and welcome()
ran (ctx.send already pushed into the unit that is dropped); the next unit saves the member at stage q1 with
`awaiting interview` but the welcome text was never sent. Small; runtime_ops.qnt load action always copies
`committed` into memory (runtime_ops.qnt:318-321), so it cannot see it.

### D-7 (P2) No retention for the network_state document

opps (only forget deletes, N:973), requests, interactions, feedback, asks, reports, cases, crews, fraud grow without
limit; each unit parses the JSON twice on import (N:5077) and once on export, PgStore.save rewrites every
participation row (store.ts:291-292), and every tick walks every opportunity (N:3546). With the 8 s /internal/turn
budget this becomes a latency fault over months. Recorded in network-consent-core.md:211 and 654 but not in the
register. Not a Quint target (a size bound); needs a retention rule (for example closed and done opportunities after
the 60-day pair-history window) and a load-time test.

### D-8 (P2) The learned send-hour cache stops seeing new replies after 60 replies

Where: replies are kept as the last 60 (N:650); the profile cache key is (day, n = replies.length, state, quiet)
(N:4465-4471). After 60 replies n is always 60, so a new reply refreshes the send hours only on the next day,
against the comment "recomputed once a day or after a new reply" (N:4480). Effect: a heavy texter's slot can lag by
up to a day. Fix: key on the last reply time.

### D-9 (P2) Feedback ids repeat after a forget

Where: N:2816 `id: fb${this.feedback.length + 1}`; forget filters `feedback` (N:1011). Trigger: fb1 (from X), fb2
(from Y); X leaves; length is 1; the next record is fb2 again. No reader keys on the id today (the engine reads
from/about), so the effect is a duplicate key in the stored state and the engine input. Use a sequence like
caseSeq/reportSeq.

### D-10 (P2, no production trigger) A fraud item can be decided after its deadline

Where: decideFraud N:3056-3071 checks only `status === "review"`; expiry runs in the daily block only (N:3043).
Opportunity items refuse every decision once the clock passes the deadline (reviewBlock N:2067, SD-009). Between
the deadline and the next daily block a fraud item is still confirmable, and confirm emits fraud_confirmed (a
ledger clawback).

## 5. Notes that are not defects

- Review mode is not persisted (N:1959, not in NetworkState); only game.ts calls setReviewMode, production stays
  "human". If a future staff route sets "auto", it would revert on restart and differ between replicas.
- ASK_HOLD_MS (24 h, N:338) holds a probe behind an open ask, while OUTREACH.askOpenMs (72 h) refuses a second ask.
  Two numbers for two rules; NM-1 should keep both.
- `managerProblem` (N:4867-4878) creates a MemberState through member() as a side effect of a read
  (rt.readState in postings.ts:119); join_age should treat lazy creation as stage "new" with no welcome.
- Relay log cap, swap TTL and held-item prune are in relay.qnt (LOG_MAX scaled, SD-387).
