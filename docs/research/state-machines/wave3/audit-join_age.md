# Audit: quint/join_age.qnt coverage (wave 3)

Date 2026-11-09. Branch claude/quint-state-machines (HEAD d87de6d). Read-only. Hand-written.
Inputs: quint/join_age.qnt, docs/research/quint-findings/join_age.md, research doc 6.3, code at HEAD
(service.ts, accounts.ts, pg-store.ts, runtime.ts, network.ts, policy.ts, age.ts, mcp/hooks.ts) and the
claude/formal-main drift review (docs/results/2026-11-09-quint-drift.md, quint/drift.json "join_age").
Already fixed on formal-main and not repeated as new: the invite_only under-13 exit (3bd350d).

Scratch probe (not in the repo): wave3/ja/join_age.qnt = the model with recordAge and declineUnderAge
split into two steps (underStep -> declineStep, webCheck -> webDecline), plus run tests
`declineSplitTest` and `enrollRepeatNoMemberTest` and invariants `under13NoLive`, `enrollSuccessHasMember`.
Both run tests pass (they assert the bad states are reachable). `quint run --invariant under13NoLive`
fails at seed 0x2a (stepThrows between recordAge and declineUnderAge).

## suspected_defect

D1 (P1, confirmed in the scratch model). The under-13 decline on the join paths is not atomic and the
SD-315 branch does not repair it.
 - service.ts:1614-1616 (text under_age): recordAge, then declineUnderAge, then deletePending; each a commit.
 - accounts.ts:363 and 377-378 (web repeat and new join): recordAge, then declineUnderAge.
 - accounts.ts:431-440 declineUnderAge: per membership hooks.onForget (service.ts:814-823: forget,
   photos.deleteFor, every forget listener such as the MCP grant revoke), then forgetMembership, then the
   opt-out. A throw in any hook stops the loop.
 - service.ts:1592-1598 (text, no age, floor < 13): deletes the pending join and answers under_age; it does
   NOT call declineUnderAge (formal-main decisions.ts joinStep and service.ts the same: declineUnderAge only
   when age !== undefined).
 Trigger: web join slop at 15 (complete). Text "friends" -> join_asked. Text "Sam, 12" -> recordAge commits
 (floor 12, person 12, slop member age 12) -> the process dies, or onForget/a forget listener throws, before
 declineUnderAge finishes -> slop membership, network member and opt-in stay. Text "friends" again ->
 under_age at service.ts:1594 with no decline. The state stays until the person texts slop (the unit then
 declines on the attested age 12) or posts a web join. Same end state as Q-join_age-4, but on the join path,
 where the model has no `declineOpen` exception: `under13StoresNothing` in safety would fail if the model
 split the step (scratch `declineSplitTest`).
 Fix (in scope, safety): (a) call accounts.declineUnderAge in the SD-315 branch (service.ts:1594); (b) a purge
 repair next to reconcileAges (service.ts:850, run by purge at :604): every person or phone whose lowest age
 is under 13 and who has a membership not removed goes through declineUnderAge. (b) also closes Q-join_age-4.
 Test: an integration case that makes a forget listener throw once during the decline (service.onForget
 accepts listeners) and checks that the next "friends" text or the purge removes the slop membership.

D2 (P1, plausible, needs an integration race test). A chat decline races a join of another app.
 The member path (service.ts:1264-1283 memberMessage -> statedAge) takes no `join:<phone>` lock; the text
 join (service.ts:1302) and the web join (accounts.ts:357) do. Trigger: a friends member aged 15 texts
 "I am 12 years old" while the same phone's POST /api/join slop age 15 runs. joinLocked reads lowestAge 15
 and passes (accounts.ts:375); the unit commits floor 12 and statedAge lists memberships (service.ts:1474)
 before slop's putMembership (accounts.ts:390) -> slop is not forgotten; createMember gets age.effective 15
 computed before. Result: a live slop membership and member of an under-13 person with no decline pending.
 reconcileAges later lowers the member age to 12; only a later slop text then declines. The model cannot
 show this ("One turn runs at a time", join_age.qnt:21-23). Fix: statedAge's decline runs under
 withLock(`join:${e164}`), or the purge repair of D1(b).

D3 (P2, confirmed in the scratch model). enroll reports a membership with no network member as joined.
 service.ts:1689-1700: putMembership, recordConsent, createMember are separate commits; the looking_for row
 is deleted only at :1705. A crash after putMembership leaves friends active with no member and the
 question open. The next answer "friends" takes service.ts:1690 (`existing` live -> joined.push; continue):
 no createMember, and enrolledText says the person is in friends. Q-join_age-2 fixed the same shape for the
 web repeat (29331d4) but not for enroll. The model reaches it with safety true (`joinSuccessHasMember`
 covers only kind web and text): scratch `enrollRepeatNoMemberTest`.
 Fix: in enroll, for a live existing membership with no network member (runtimeOfMember undefined), run
 createMember as the web repeat does; extend joinSuccessHasMember to kind "enroll".

D4 (P2, plausible). A web join whose opt-in never committed is completed with no opt-in.
 accounts.ts:390-393: putMembership, addConsent, bindSessions run before the try at :394. A throw or crash
 after putMembership leaves an active membership with no member and no opt-in row. The repeat join
 (accounts.ts:360-372) completes the member (Q-join_age-2) but never writes the opt-in. Sends are refused by
 the ledger (fail closed) and activeMembership (accounts.ts:322) returns nothing, so the member is in the
 network (and the review queue) but can never be reached; the person sees "member". Fix: the repeat branch
 writes the web_form opt-in when the ledger has none for the app, or the putMembership..addConsent pair
 goes into one transaction.

D5 (P2). A staff or member invite stores a person for a phone declined under 13.
 accounts.ts:331-339 invite refuses held, suppressed and banned numbers but never reads lowestAge. Trigger:
 "Kid, 12" (floor 12, nothing else stored) -> an adult member invites that number -> createPerson
 (phone_identities row with the number in plain text) and an invited membership. policy.ts:2 and
 accounts.ts:7: under 13 stores nothing. The model allows it (staffInvite precondition, join_age.qnt:682)
 and under13Clean ignores invited memberships and the person row. Fix: invite returns undefined when
 lowestAge(e164) is under 13.

## model_gap (states, steps, actors, failures the model leaves out)

G1 (P1) need_home / invalidHome branch missing (service.ts:1599-1602 and 1621-1624). On THIS branch a
 passing age with an invalid home city returns join_asked with no recordAge and no pending row: "Sam, 15,
 Boston" then "Sam, 25" joins as an adult (lowestWins fails). Fixed on formal-main (653fcfb records the age
 on need_home); formal-main's model adds Msg.badHome and needHomeKeepsAgeTest. Merge that model change.
G2 (P1) recordAge/declineUnderAge are one action (join_age.qnt:353-358, 569-579); see D1.
G3 (P1) recordAge is three commits (accounts.ts:286-300: noteAgeFloor with the MCP draft cleanup at
 pg-store.ts:96-105 and mcp/hooks.ts:131-137, noteAge, onAgeLowered -> ageLowered loop with photo and
 rating deletes, service.ts:834-842). A crash after noteAgeFloor and before noteAge keeps person.lowest_age
 adult; reconcileAges (service.ts:850-860) reads p.lowest_age and so never repairs member ages or photos.
 Matching still excludes (the view reads the floor). Model this as two steps plus the reconcile actor.
G4 (P1) No concurrent turns; the member path and deleteAll (api.ts:641 -> accounts.ts:481, no join lock)
 run beside joins in the code. See D2.
G5 (P2) statedAge decline is one action (flushForgetStep) but is forgetPhone (listeners) plus a per-app loop
 (service.ts:1471-1477). Covered by Q-join_age-4's exception only as a whole.
G6 (P2) Web steps that can throw: the model throws only in webWelcome (stepThrows excludes kind web,
 join_age.qnt:674). createPerson, recordAge, putMembership, addConsent, bindSessions can throw. See D4.
G7 (P2) enrollApp merges putMembership and the opt-in (join_age.qnt:505-524); see D3.
G8 (P2) invite_only exits: the model writes nothing (join_age.qnt:324-326, 575-577) which matches HEAD;
 formal-main 3bd350d records the age and declines on both exits. Open drift item in drift.json; update the
 model when the branches merge. The text exit is reachable only on a dedicated app line (route.shared
 false, service.ts:1073-1077), which the model does not have (it treats every text as shared, :21).
G9 (P2) Other entries into the age policy: MCP submit_profile (service.ts:1380 memberMessage + statedAge),
 the ntwrk keyword ("ntwrk" never in Msg.kw), STOP (deletes every pending row, service.ts:1499), leave
 (deletes the app's pending join), share pending, the link notice, held numbers and bans.
G10 (P2) Network member states not modelled: stage "age" / ageUnknown (network.ts:1019-1023, 1044-1053),
 ageConflict (network.ts:724-728), staff clearMinorSignal (network.ts:1666-1680), isDeclined
 (service.ts:1414). Unreachable through joins today (every join has an age); reachable for pre-platform
 members.
G11 (P2) Plan 6.3 items not built: machine signup-channel-mode (M-114), actions staffClearMinor and rejoin
 after leave, invariant inviteRespected, the general everyAnswerGetsReply, one run per joinMode value
 (waitlist: the "onboarding" state is in LIVE but no action makes it), the waitlist liveness (SD-295).
G12 (P2) New-owner path (accounts.ts:211-213 clearAgeFloor, deleteAll newOwner) is absent; lowestWins would
 need a history reset there. Belongs with identity_sagas.

## open_carveout

C1 Q-join_age-4 (not fixed; under13StoresNothingStrict out of safety). Fixable now in scope: the purge
 repair of D1(b) (extend reconcileAges, no new design), plus D1(a). Then put the strict form back in safety
 with a fairness note or a "repair runs" step.
C2 activeImpliesMember (SD-128, refuted) out of safety. Keep; D3 shows the enroll path has no repair, so
 add enroll to joinSuccessHasMember and fix D3.
C3 SD-080 skipped (founder decision on one-message joins). Not fixable without the founder.
C4 SD-126 not reproduced: closed, nothing to do.
C5 The three "known failures" in findings section 6 (service.test.ts:132, service-apps.test.ts:115/362) now
 expect under_age at HEAD: closed.
C6 Drift: header line references pinned to ad67275 are stale (drift.json join_age item 1).

## model_error

E1 (P2) lowestWins (join_age.qnt:739-740) allows durableLowest <= hi(a, 13): for every statement under 13
 it accepts a recorded 13, not only for the attested-adult case. A change that records max(age, 13) for a
 declined 12 would pass lowestWins and make under13StoresNothing vacuous (effLowest would be 13). Track the
 adult-record flag per statement and bound by a otherwise.
E2 (P2) under13Clean (join_age.qnt:748-749) ignores invited memberships, the person row, the looking_for
 and share pending rows, opt-ins and the notice row: D5 passes it. Add invited and personless checks.
E3 (P2) joinSuccessHasMember (join_age.qnt:774-776) excludes kind "enroll": D3 passes it.
E4 (P2) The `misrouted`, `invitedElsewhere` flags and declineOpen ghost encode exceptions in the actions;
 declineOpen exists only on the chat path, so the join-path window (D1) is invisible because the step is
 atomic, not because the rule holds.
