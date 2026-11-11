# Audit: coverage of `quint/plan_crew.qnt` (M-124 crew-offer-and-crew)

Branch: claude/quint-state-machines (HEAD f02196f). Code that I read in full: network.ts crewCheck 3377-3404,
onCrewAnswer 3407-3415, resolveCrew 3417-3427, crewSessions 3435-3456, the crew_offer hook 4355-4358, expect
4392-4395, onFeedback 2755-2780, planPost 3360-3368, planSeatOk 3077-3080, submitPlan 3114-3125, review/approvalCheck
2027-2041 and 2100-2114, callOffPair 1523-1537, dropMember 2725-2745, forget 1004-1005, checkRecipient 4475-4495,
the tick 3497-3527; plans.ts detectCrews 676-704, crewOptIn 710-715, crewSessionPlan 718-740; copy.ts 151-154.
I also compared claude/formal-main (d83c5b7): it has no plan_crew.qnt (the crew is still in its plan_run.qnt), and
its network.ts already filters crew offers and the resolve yes set with planSeatOk.

`bun run quint:check quint/plan_crew.qnt`: all ok (typecheck, 3 tests, safety, 3 witnesses).
Probe (scratchpad/wave3/probe/plan_crew_probe.qnt, a copy, not the repo file):
- run `probeMinorCounted`: a says yes, then minorSignal(a), then b and c say yes -> crew "formed" with a in
  crewMembers and crewTold, and `safety` holds. Passes: safety does not catch a minor in a crew.
- invariant `crewNotDead` = formed and not handed off implies >= 3 seat-ok members: violated in 5 steps
  (seed 7: formed, then watch(c)). No invariant or liveness property flags a dead crew.

## suspected_defect (new code defects)

D1 (P1). Resolved crew offers block every later crew for those members and that activity, forever.
network.ts:3392 passes `[...this.crews, ...this.crewOffers.map(c => c.crew)]` to detectCrews as `existing`;
crewOffers is never pruned (only assigned at restore 5016); plans.ts:678 puts every member of every existing crew
or offer in `inCrew`. Trigger: plan P1 (yoga) a,b,c say "again" -> offer; b says no, c silent -> timeout ->
crew_not_formed, a hears "I'll keep you in mind for the next plan" (copy.ts:154). Weeks later plan P2 (yoga) a,c,d,e
all say "again": positive = {a,c,d,e} minus inCrew {a,b,c} = {d,e} < 3 -> no offer. a and c can never be in a yoga
crew again. Also on formal-main. Fix: pass only `this.crews` plus unresolved offers (`!c.resolved`).

D2 (P1). A formed crew that falls under minMembers seat-ok members, or holds a blocked pair, never ends.
crewSessions (3437-3446) has only one exit: 3 "done" sessions. (a) Seats: a member STOPs, goes on watch, becomes a
minor or is deleted -> `members.length < minMembers` -> `continue` every day forever; crewFormed promised "Your weekly
X crew is on"; no notice; members stay in inCrew (D1). (b) Block: crew a,b,c,d; a blocks b (callOffPair closes only
open items). Each week crewSessions proposes a,b,c,d (planSeatOk has no pair check), a human reviewer approves,
approvalCheck returns blocked_pair (2111-2112) and closes it, `markDeclined` is not run but the reviewer did the
work; next week the same. "done" never reaches 3. This is the residue of SD-211 (refuted because approval catches
the probe), not the probe itself. Fix: in crewSessions, drop one side of a blocked pair (or end the crew) and mark
the crew ended (handedOff or a new `ended`) when seat-ok members stay below minMembers.

D3 (P2). The late-join path skips the one-crew-per-activity rule. network.ts:3385-3389 appends m to an open offer
with no `inCrew` check (detectCrews' rule, plans.ts:678-685). Trigger: d is in yoga crew X; d attends a normal yoga
plan with a,b,c; a,b,c say "again" -> offer without d (detectCrews filters d); then d says "again" -> open path adds
d to offered and crew.members -> d says yes -> d is in two yoga crews with two weekly sessions. Also on formal-main
(it adds only a seatable check).

D4 (P2). A crew answer is lost in two ways. (a) After the timeout: a late joiner's offer has awaiting.at later than
offer.at; crewSessions resolves at offer.at+3d (3436) while the joiner's awaiting is still set (cleared at aw.at+3d,
3509); the joiner's "yes" goes to onCrewAnswer (805), which returns with no reply because the offer is resolved
(3408-3409): the member gets silence. (b) Overwrite: `expect` (4392-4395) protects only probe/booked, so a weekly
check-in, a feedback ask or a growth ask sent during the 3 days replaces awaiting=crew; the "yes" is then not a crew
answer and the crew can fail to reach 3 (AJ23 third bullet names only the probe/booked case).

(Not new, for the record: on HEAD and main the crew offer goes out as kind "info"/"reply" (3401, 2775) and crewFormed
as "info" (3425); none is in ABOUT_OTHERS (outreach.ts:59), so a member who became a minor or went on watch after
saying "again" gets the offer and counts toward the crew. claude/formal-main fixes this (seatable filter, kind
"scheduling", resolve yes filtered). See model_error E1.)

## model_gap

G1 (P1). No offer creation. init starts at stage "offered" with fixed CREW0. Missing: crewCheck (3377), detectCrews
inCrew rule and `existing` list (D1), the late-join path (D3), the per-recipient send gates and refusals (cap,
opt-out, hold, leak guard: a refused offer leaves an offered member who can never answer, so resolution waits 3 days),
and the plansOn gate. Adding a second offer and a second activity would show D1 and D3 (needs an invariant
`oneCrewPerActivity` and a liveness/witness "a new positive group gets an offer").

G2 (P1). No blocks. Section 6.7 planned `crewRechecksBlocks`; neither plan_crew nor plan_run has it. Add a `block(a,b)`
actor event and approvalCheck invalidation as a session end "invalidated"; invariant "no session proposal holds a
blocked pair" fails today; a liveness check shows D2(b).

G3 (P1). No end state besides handoff and no liveness. Add `crewStage = "ended"` or a temporal property
`formed ~> handedOff or ended` (Apalache/TLC-style fairness on crewTick); today `crewNotDead` is violated in 5 steps.

G4 (P2). No member deletion (forget 1004-1005, opps.delete 961). Deletion shrinks crew.members below 3 and deletes
the done session opps, so the "done" count drops and the handoff moves later. Adding it breaks `crewOptedIn`
(size >= CREW_MIN) as written.

G5 (P2). Session slot decoupled from the clock. crewWeek moves by a free crewWeekPass; code computes start from `now`
(plans.ts:729, minLead 72h, config.ts:493) and crewSessions runs once a day after the planner (3522-3526), only when
plansOn() (3039: plans and matchingEnabled). With matching off, offers never time out, but onCrewAnswer still forms
crews (crewFormed sent, no sessions).

G6 (P2). Session lifecycle collapsed to review -> held|failed. Missing: probing/scheduled (OPEN_STAGES 469), approval
invalidation (busy_elsewhere, on_watch, blocked_pair), reject -> markDeclined of every crew pair (2041), withReach
outsiders (3471), handleDrop below quorum. "done" in code = scheduled and meeting+3h passed (3626), even when nobody
came; the model's "held" is fine for the count.

G7 (P2). The awaiting slot (expect 4392, 3-day clear 3509, answer routing 803-806) is absent: crewAnswer is always
delivered. Adding it shows D4.

G8 (P2). seatOk ignores busy, stage active, onlyWhenAsked, account, validAge (planSeatOk 3077-3080); crewSessions
calls planSeatOk(m) without busyOk (3445), so a member busy in another opportunity is left out of that session.

## model_error

E1 (P1). Model follows HEAD resolveCrew (no seat filter) and `safety` is too weak to notice: `probeMinorCounted`
passes with safety true. Rule: minors are never matched or connected (AGENTS.md); plans copy never reaches minors.
claude/formal-main code filters yes by planSeatOk and its drift note says so for plan_run.qnt; plan_crew.qnt does
not exist there. Fix: resolveCrew filters `yes` by seatOk (crewMembers and crewTold); add `crewAdultsOnly`:
formed implies crewMembers disjoint from minors at formation (keep a `formedWith` snapshot), and an offer-recipient
invariant once G1 is in.

E2 (P1). `sessionSlotOnce` is the guard restated: planId = slot and `not(dup)` is a guard of crewTick, so the
invariant cannot fail. SD-144's mechanism (wrong key space) is not representable. Fix: model planId as a function of
(crew, start computed from now) and the opportunity id as a separate counter, with the dedupe on the plan id; or
check crewSessionPlan id determinism in the sim.

E3 (P2). `handoffCountsSessions` counts "not failed" (held or review); the rule is held sessions. Use the held count.

E4 (P2). `crewOptedIn` size >= CREW_MIN holds only because nothing removes members (G4); state it at formation.

E5 (P2). Comment line 53 says planSeatOk "with busyOk"; crewSessions uses no busyOk (G8). Header anchors
(crewCheck 3212, onCrewAnswer 3242, resolveCrew 3252, crewSessions 3270) are now 3377, 3407, 3417, 3435.

## open_carveout

C1. SD-444 notice part (`crewEndHeard`, skippedDefects): still fails (crewHandoffTest). Needs founder copy; not in scope
without it. D2 adds a second silent end (dead crew) that the same decision should cover.
C2. SD-211 refuted (approval catches the probe), but the planned `crewRechecksBlocks` was dropped from both models;
the residual D2(b) loop is in scope as a reproduced bug: integration case with mini.ts (crew of 4, block, 3 weeks of
auto review -> 3 invalidated items, 0 done, no end).
C3. Drift input: integrate formal-main's seat filter into plan_crew.qnt (E1) when the branches merge.
