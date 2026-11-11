# Audit: coverage of quint/plan_run.qnt (wave 3)

Hand-written. Read-only research on branch claude/quint-state-machines (HEAD f02196f). Line numbers: `N:` is
packages/network/src/network.ts at HEAD, `E:` is packages/engine/src/plans.ts at HEAD, `Q:` is quint/plan_run.qnt.
Inputs: the model, docs/research/quint-findings/plan_run.md, research doc section 6.7, the drift review on
claude/formal-main (docs/results/2026-11-09-quint-drift.md, plan_run section). Not repeated: defects that the
findings file marks fixed (SD-008, 046, 078, 204, 268, 423, 480, Q-plan_run-1, Q-plan_run-2), SD-144 and SD-444
(plan_crew), and the two drift-session code fixes (auth_edge rotateSession, invite_only under-13).

## 1. Suspected code defects (new)

### S1 (P1). A booked reveal takes the answer slot of a pending probe; "no" to the probe cancels the booked plan
- Where: N:4392-4395 (`expect` lets `booked` replace `probe`), N:4335 (reveal onSent calls `expect(booked)`),
  N:4630-4632 (busy(): a plan yes in a probing plan is not busy, "plans ask 6"), N:807-812 (booked routing),
  N:3164 (planProbe checks `awaiting` only at send time).
- Trigger: plan P1 probing, d says yes (status `available`, awaiting cleared). d is not busy, so plan P2 (or an
  intro, whose probe hook writes awaiting directly) probes d: `awaiting = probe P2`. Then a, b say yes to P1:
  bookPlan -> planReveal(d) -> onSent -> `expect(d, booked P1)` replaces the probe slot. d answers P2 with
  "no, can't Saturday": N:807 routes it to booked P1, `yn === "no"` -> `handleDrop(d, P1)`. d is out of the plan
  they wanted; P1 of 3 is off for everyone. A "yes" to P2 instead confirms P1 and sends "Great, see you there.";
  P2 expires after 26 h as a silent no.
- Not SD-043/D5: D5 is the writers that skip `expect()`, and it says only a manager can reach probe+booked.
  Here `expect()` itself allows it, and every plan yes-sayer reaches it through the busy() exemption.
- Fix sketch: `expect` must not replace a pending `probe` with `booked` (keep the probe slot; route "can't make
  it" for the booked plan by content or ask once), or make a member with a pending probe busy for bookPlan.
  Integration test: two plans, the trace above, assert d stays in P1.

### S2 (P1). bookPlan keeps revealing after a refused reveal closed the plan
- Where: N:3284 (`for (const id of keep) this.planReveal(o, id)`), N:3287-3300 (planReveal has no stage check),
  N:4339 (reveal onRefused -> handleDrop), N:2661-2671 (handleDrop closes with < 3), N:4126-4180 (an immediate
  send never calls the hook's `valid()`; only the tick flush does, N:3493), N:4174-4179 (leak guard refusal ->
  onRefused).
- Trigger: seated a, b, c (quorum 3). a has an agent_private facet equal to the venue name (the send-time
  guard has no plan-public-content exemption, unlike buildPlanProbe E:505-510). Reveal to a passes
  (exceptOwner a). Reveal to b is refused by the guard -> handleDrop(b): a and c left -> plan closed, a gets
  "this one is off now". Loop goes on: planReveal(c) computes going = [a, c] and, if c's text passes, c gets
  "You're in ... with Ann K." for a closed plan, `plan_accepted` is emitted and `awaiting = booked`. If c's text
  is refused too, onRefused does nothing (stage closed) and b and c never hear anything after "I'll tell you once
  enough people are in".
- Fix sketch: stop the loop when `o.stage !== "scheduled"`, and note (planNotTogether) the yes-sayers whose
  reveal did not go out; or run all reveal checks (leak guard included) before booking.

### S3 (P1). Deferred reveals keep the booking-time body and `about`
- Where: N:3297-3299 (reveal: logistics timing, `about: going`), N:4140-4145 (deferred with body and opts),
  N:3488-3495 (flush: `valid()`, then send() again with the stored body and about), N:4483-4490
  (checkRecipient: no check of an opted-out other), N:4339, N:2661-2666 (drop notice only to `bookedTold`).
- Trigger A (stale cascade): booking at night (the answering member's reveal is a reply and goes now; the
  others' reveals are deferred to 09:00). Seated a, b, c, d; a goes on watch at 02:00 -> dropMember ->
  handleDrop(a): b, c, d stay (keep). 09:00 flush: b's reveal, about = [a, b, c, d] -> `other_on_watch` ->
  onRefused -> handleDrop(b) -> c, d left -> off; drop notice only to bookedTold (the replier). c's and d's
  reveals now fail `valid()` and are skipped (N:3493): c and d never hear anything. One watch cancels a group that
  the SD-078 rule keeps on.
- Trigger B (wrong roster): same, but a sends STOP. checkRecipient does not check other.optedOut, so b, c, d get
  "You're in ... with Ann K." naming a member who left; a's drop notice reached only bookedTold.
- Fix sketch: build the reveal body and about at flush time (store a hook to rebuild, not the text), or after
  handleDrop rewrite/drop the pending reveals; tell the yes-sayers whose reveal is dropped.

### S4 (P2). A plan closed by handleDrop leaves pending invitees with a permanent probe slot
- Where: N:2667 (handleDrop closes by hand, not with close(); close() clears awaiting at N:2693),
  N:3576 (advance skips closed opps), N:3505-3506 (tick expires every slot but `probe`), N:3098 (runPlanner
  excludes awaiting probe), N:3164 (other plan probes defer on `one_question`).
- Trigger: plan booked a, b, c; d contacted, pending. c says "can't make it" -> closed. d's `awaiting` stays
  `probe` for the closed plan until d texts; d is left out of every planner run and every plan probe meanwhile.
- Fix sketch: in handleDrop's `!keep` branch clear `awaiting` for every participant whose slot names `o`
  (or call close()).

### S5 (P2). forget() of one member deletes a group plan that the drop notice said is still on
- Where: N:956 (dropMember first), N:2661-2666 (handleDrop keep >= 3: "The rest of you are still on."), N:960
  (`if (o.participants.includes(id)) { this.opps.delete(oid) }`).
- Trigger: plan booked a, b, c, d; d deletes their data (or the under-13 decline path). a, b, c hear "The rest
  of you are still on", then the opportunity is deleted: no reminder, no feedback, no crew offer, and bookedNear
  no longer protects their time (double booking possible). In the probing stage the yes-sayers (`available`,
  promised "I'll tell you once enough people are in") are dropped with no word. JE7 is the pair case; the group
  case is new because the SD-078 fix keeps groups of 3+.
- Fix sketch: for a kept group, scrub the member (as for opps that do not name them) instead of deleting the opp.

### S6 (P1). The partner plan made at the group's deadline is born expired and still probes
- Where: E:625 (partner probeDeadline = min(start - 30 h, now + 96 h)), E:650 (smaller needs start - now > 6 h),
  N:3329-3333 (planFallback submits it), N:2171 (review SLA 12 h, no plan-deadline check), N:3129-3138 (beginPlan
  calls planLane with no planDeadline), N:2474-2476 (the answer runs planDeadline first).
- Trigger: group plan made with start < 126 h ahead, so its deadline is start - 30 h. At the deadline exactly two
  yes (activity groupSize[0] <= 2). The tick runs the fallback at now >= start - 30 h: the partner plan's
  deadline is <= now. A reviewer approves within 12 h; beginPlan probes the first member at once. Their yes runs
  planDeadline first -> fallback `none` -> closed -> "That plan didn't come together" note. Carry is `[]` for
  `smaller` (E:651), so the demand is also lost. SD-205 was refuted on the engine trigger; this is the network
  path (approval and probe of a plan already past its deadline).
- Fix sketch: partner deadline = min(start - deadlineBeforeStart, now + window) only if > now + review SLA, else
  fall through to solo_event/next_week with carry; and beginPlan runs planDeadline before planLane.

### S7 (P2). A block that involves a pending invitee cancels a whole booked group, and probing yes-sayers hear nothing
- Where: N:1523-1535 (callOffPair: "out" is only no/unavailable/dropped, so a `probing` invitee counts),
  N:3500 (cross-app block edges in every tick), N:2694-2701 (close tells nobody for a plan in probing, and
  nobody for reason `blocked`), N:3255-3256 (bookPlan: "one block cannot collapse the quorum").
- Trigger: booked a, b, c; d contacted, never answered. d blocks a on slop.date. Next tick: callOffPair(d, a)
  closes the booked plan for a, b, c, who all said yes and do not block each other. In probing: a block between
  two invitees closes the plan and the unrelated yes-sayers (promised an answer) get no word.
- Fix sketch: for a plan, planOut the member who is not yet `yes`; handleDrop one side of a booked pair and keep
  the group with 3+; note the yes-sayers when a probing plan closes.

## 2. Model gaps (code paths the model leaves out)

| # | Gap | Code | Can it break an invariant? |
|---|---|---|---|
| G1 | Deferred reveals (drift open item) and send-time refusal of a reveal inside bookPlan. Q:282-285 assumes every seated reveal passes. | N:3297, N:4140, N:3488-3495, N:4174-4179, N:4339 | Yes: yesSayerTold (S2, S3); a new `revealOnlyWhileScheduled` (bookedTold only while stage scheduled) fails on S2. Add `revealOk` and `revealNow` oracles and a per-member deferred reveal with the stored about. |
| G2 | The per-member `awaiting` slot and answer routing (probe, booked, expect()). `answer` is guarded by `contacted` and `pending` only (Q:579-582). | N:784-812, N:4392, N:4335, N:4344 | Yes: with one intro or second plan probe plus the slot, an invariant "an answer reaches the item it answers" or groupNeverShrinksToPair-without-consent fails (S1). Also S4 (stale slot). |
| G3 | Partner plans: startPlanRun partner branch, probe_partner, first-no fallback, the partner deadline, its review. The model only records `partnerAsked` (Q:26, Q:302). | E:545-551, E:576-585, E:620-631, N:3329-3333 | Yes: a "no probe after the plan's deadline" invariant and a witness "a partner plan can be booked" fail (S6). |
| G4 | forget()/deleteAll deleting the opp, and the deferred filter on `about`. | N:953-985 | Yes: yesSayerTold and a "kept group still has its item" rule (S5). |
| G5 | Tick-level work: deferred flush, cross-app block edges (callOffPair), awaiting expiry, 48 h confirmation, reminders, done at meetingAt + 3 h (model: S + 1), runPlanner exclusion. | N:3486-3506, N:3600-3640 | Flush and edges: yes (S3, S7). The rest: no. |
| G6 | callOffPair's exact rule (scheduled: declinedQuiet to bookedTold yes except the blocker; probing: silent). | N:1523-1535 | Yes, with E6 removed (S7). |
| G7 | More than one plan per member (busy() exemption for plan yes, bookedNear across plans). Only the intro abstraction exists. | N:4630-4632, N:3058-3064 | Yes with G2 (S1). |
| G8 | Unclear answers (clarify), MCP turns, "can't make that time" availability history; refusal reasons away/account/onlyWhenAsked/hold in planProbe. | N:788-790, N:3158-3160 | No: all end as pending or a silent no, which the model has. |
| G9 | Unit abort: a throw inside a unit (for example `activityById.get(...)!` for a retired activity) aborts runStored, so the unit is retried or lost; exportState/importState per unit. | N:3243, N:4939-4990 | Not for this model's invariants; belongs to runtime_ops/outbound_queue. |

## 3. Model errors

- E1 (P1, drift, fixed only on claude/formal-main). Q:380 calls handleDrop for any participant of a scheduled
  plan; the code only for status `yes` (N:2735). On this branch the model still closes or shrinks plans the code
  keeps, and hides the S4 slot path (d stays pending in the code).
- E2 (P1, drift, fixed only on claude/formal-main). Q:672-683 `block` closes for any two participants; callOffPair
  skips a member who is out (N:1526). Even the formal-main version keeps `probing` invitees in, which is S7.
- E3 (P1). Q:567 lets a probe go out only while now < D. beginPlan calls planLane with no deadline check
  (N:3138), so the code probes a plan approved after its deadline. The guard is stronger than the code and hides S6.
- E4 (P1). Q:282-285 assumes every seated reveal goes out (only checkRecipient is argued symmetric). The leak guard
  (N:4174) and the deferral (N:4140) are not symmetric. Hides S2 and S3.
- E5 (P2). `told` is optimistic. `note` (Q:180) counts as told, but a note rides only on the next send within 7
  days (N:4157, N:4204) and is one slot (N:3345). The solo-event `tellAll` (Q:173, Q:307) ignores the send checks of
  N:3337-3340 (streak refusal, hold, deferral). Drop notices can be refused by the streak (JE8). yesSayerTold
  therefore passes on paths where the member hears nothing.
- E6 (P1, invariant weaker than the rule). yesSayerTold exempts every promised member when closedReason is
  `minors policy` or `blocked` (Q:821). The rule (the ack at N:2481) is per member; the exemption is meant for the
  member who left or the minor, not for unrelated yes-sayers. A note carries no name and no proposal id, so the
  code comment's reason does not cover it. This hides S7.
- E7 (P2). Q:425 ends the meeting at S + 1; the code at meetingAt + 3 h (N:3627). No invariant reads it now.

## 4. Open carve-outs

- C1. revealSymmetric (SD-479) in `skippedDefects` (Q:832, Q:868). Founder decision on text; not fixable in
  scope without new copy or removing late joins. New related path: a late joiner whose reveal is refused triggers
  handleDrop and the booked members get "one person can't make it" about someone they never heard of (N:3306-3310,
  N:4339, N:2664).
- C2. SD-425 skipped (friends planner, local only). Fix is a config check (minLeadHours > deadlineBeforeStart +
  review SLA) in packages/sim/src/apps/friends/planner.ts; needs founder confirmation of the friends lead time.
- C3. The plan (section 6.7) asks for liveness "probing ends by the deadline" and `partnerPlanHasFreshConsent`;
  neither is in the model. Liveness can be an invariant with a ghost `lastTickAt`: idle and lastTickAt >= D
  implies stage != probing. partnerPlanHasFreshConsent needs G3.
- C4. SD-205 refuted, but S6 reaches the same harm through the network; reopen with the S6 trigger.
- C5. Apalache depth: verify-steps=2 from four checkpoints. The smaller-group booking after a fallback (3 steps),
  every deferred path and every 3+ step interleaving are only in random simulation.
- C6. Comment line references (about 60) are at wave2/plan_run, 150-260 lines off (drift open item, comment only).
