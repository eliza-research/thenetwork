# Quint findings: `quint/join_age.qnt`

Date: 2026-11-08. Branch `wave2/join_age`, base commit ad67275. Model: [quint/join_age.qnt](../../../quint/join_age.qnt).
Module plan: section 6.3 of [2026-11-07-state-machines.md](../2026-11-07-state-machines.md). This file is
hand-written. The traces are short forms of simulator counterexamples (generated), checked by hand against the code.

## 0. Final state

The model follows the code of this branch after the fixes (section 4). `bun run quint:check quint/join_age.qnt`
passes: typecheck, 26 run tests, `safety` and all 7 witnesses. `--verify` passes too: Apalache finds no violation of
`safety` to depth 8 (section 6).

- 17 register defects and new findings of the first model are fixed in code, each with an integration test
  (section 4). SD-126 is not reproduced after the SD-038 fix. SD-080 is skipped (founder decision).
- The fixed model found two more defects. Q-join_age-3 (an under-13 decline keeps the phone's pending text join) is
  fixed on this branch. Q-join_age-4 (a chat decline whose statedAge step fails keeps the other memberships) is not
  fixed: it needs a design decision. Its strict invariant stays out of `safety` (section 5).
- One invariant of the first model, `activeImpliesMember`, is a state that the code allows for a short time after
  a crash (SD-128, refuted in the register). It is now outside `safety`, and `joinSuccessHasMember` is the safety
  form (section 3).

## 1. What the model covers

Machines: `text-join` (M-014), `web-join` (M-015), `age-floor` (M-016), `member-age-policy` (M-017),
`minor-single-player` (M-018), `looking-for-enroll` (M-019), `membership` (M-020), `staff-invite` (M-021),
`eliza-notice` (M-112), `member-onboarding` (M-113).

Scope: one phone, one person, three apps (ntwrk, slop, friends). Text ages {12, 15, 25}. Web ages {0, 12, 15, 25}.
Join modes are the production values: ntwrk invite-only on the web, slop and friends open (AGENTS.md 2026-10-09).
`min_join_age` is 13 on every app (migration 0007:141). Every text turn is a signed gateway turn.

State: `db` (durable rows: person, `lowest_age`, `age_floor`, pending join and looking-for rows, memberships and
member ids, network members with record age, `minor`, stage and awaiting interview, the Eliza notice row and whether
its turn lost its worker), `vol` (the in-memory `statedAges` of the runtime), `turn` (the turn in flight and its
program counter), and `g` (ghost history for the invariants).

Steps: one action per transaction or unit of work, in code order:

- Text join: `receive` (route; the inbox admission sweeps a stuck turn and its notice row), `noticeStep`, `joinStep`
  (the decision), `underStep` (recordAge and declineUnderAge) and `underNoticeStep`, `personStep`, `ageStep`,
  `memberStep`, `createStep`, `welcomeStep`, `afterStep`, `lfPendStep`.
- Member text: `lfCloseStep` (a looking-for reply with no app word closes the question), `unitStep` (one
  ConsentNetwork unit; its save writes the ages it read), `flushStep` (statedAge: `takeAges` and `recordAge`),
  `flushForgetStep` (the decline forgets every membership).
- Looking-for answer: `unitStep` and `flushStep` first, then `enrollStart`, `enrollApp(a)`, `enrollCreate`,
  `enrollNext`, `enrollEnd`.
- Web join: `webJoin`, `webCheck` (repeat, invite-only, under age with declineUnderAge, or the repeat that completes
  a membership with no network member), `webPerson`, `webAge`, `webMember`, `webCreate`, `webWelcome(throws)`,
  `webCatch` (onForget and forgetMembership).
- Other actors and failures: `staffInvite`, `pendingExpire` (one day), `deleteAll`, `crash` (memory and `onFail`
  lost; the turn becomes unresolved and its replies never go out), `stepThrows` (a step throws; `onFail` runs). At
  most 1 crash and 1 throw per trace.

Oracles (README rule 7): the message carries the output of `keywordApp`, `parseJoinText`, `lookingFor` and the
network classifier (`kw`, `age`, `name`, `wants`, `signal`, `long`, `explicit`), `receive(m, pick)` picks one app
of the route's choices (rule 4: the newest open item or the last writer; a staff invite: the first row), and
`doneStep(present)` chooses the presence check of `singlePlayer`.

Not modelled: two turns at the same time (the text and web joins share the `join:<phone>` lock; the member path is
taken as alone, so the concurrent trace of SD-127 is covered by its integration test only), STOP, leave, holds,
bans, photos, suppression, waitlist join mode, staff `clearMinorSignal`. `recordAge` followed by `declineUnderAge`
is one action (the first model also kept `recordAge` and the pending delete of the text decline in one action).

## 2. Invariants

In `val safety` (all pass):

| Invariant | Rule | At ad67275 | Now |
|---|---|---|---|
| `lowestWins` | AGENTS.md decision 1: the lowest stated age wins | failed: SD-010, SD-011, SD-038, SD-383 | pass |
| `minorNeverMatched` | AGENTS.md decision 1: a person who stated an age under 18 is matchable nowhere | failed: same | pass |
| `under13StoresNothing` | policy.ts:2: under 13 stores only the age floor | failed: SD-014, SD-315 | pass (outside the Q-join_age-4 window) |
| `noOrphanMember` | S:719-722: a network member belongs to a live membership | failed: SD-015 | pass |
| `joinSuccessHasMember` | A:11-12: a join that answers success has its network member | (new form) failed: Q-join_age-2 | pass |
| `oneMemberPerApp` | A:11-12: one member per app | failed: SD-127, SD-015 | pass |
| `minorNoAdultQuestion` | policy.ts:3: no adult interview for a minor | failed: SD-213 | pass |
| `noticeSpentImpliesDelivered` | S:1167-1174: a failed turn stores nothing | failed: SD-276 | pass |
| `enrollAnswered` | S:1464-1470: the looking-for answer gets a reply | failed: SD-126 | pass |
| `enrollTurnApp` | AGENTS.md decision 2: the turn names the app of the member that replies | failed: SD-125 | pass |
| `enrollOnlyFromAnswer` | S:1114: enroll is the answer to the question | failed: SD-179 | pass |
| `lookingForAnswerEnrolls` | S:1114: an answer that names an app is that answer | failed: Q-join_age-1 | pass |
| `inviteReplyJoinsInvitedApp` | S:1550-1552: the reply with name and age joins the invited app | failed: SD-488 | pass |
| `minorIsSinglePlayer` | AGENTS.md decision 1, R:732: a minor is single-player in the open context | failed: SD-066 | pass |
| `minorChatReachesAgent` | AGENTS.md age policy: a member aged 13-17 can chat with the agent | failed: SD-065 | pass |

Outside `safety` (named values, each with its reason in the model):

- `activeImpliesMember`: an active membership has its network member. A crash between `putMembership` and
  `createMember` leaves the window until the next join of that app completes it (SD-128, refuted in the register;
  the web retry completes it since 29331d4). `q2WebJoinRepairTest` shows the window and the repair.
- `under13StoresNothingStrict`: `under13StoresNothing` with no exception. It fails on Q-join_age-4 (section 5).

Witnesses (all reachable): `witness_adultTextJoin`, `witness_minorJoined`, `witness_under13Declined`,
`witness_enrolled`, `witness_noticeDelivered`, `witness_webJoined`, `witness_matchable`.

## 3. Model changes for the fixed code

Each action that a fix changed now follows the code:

| Defect | Commit | Model change |
|---|---|---|
| SD-010 | 84c9fef | `joinStep`: an age with no name runs `recordAge` before the pending join row. |
| SD-011 | f1dc7c7 | `unitAges`: the unit's save writes the ages it read to the person and the floor (`unitStep`, `welcomeStep`). |
| SD-014 | b6a1489 | `declineUnderAge` after `recordAge` on every under_age branch (`underStep`, `webCheck`). |
| SD-015 | 8e083b4 | `webCatch` forgets the network member. |
| SD-038 | b3f9868 | The looking-for answer goes `unitStep`, `flushStep`, then enroll; the turn outcome is the unit's. |
| SD-065 | e94c1d8 | `unitOf`: the concierge branch is gone; a minor's ordinary text is open. |
| SD-066 | 0170505 | `doneStep`: `singlePlayer` also reads the member's `minor` flag. |
| SD-125 | 26b760a | `enrollEnd` gives the turn back The Network's app. |
| SD-179 | 55941d0 | `lfCloseStep`: a reply with no app word closes the question. |
| SD-127 | 541e045 | `memberStep` keeps the member id of a membership that is not removed. |
| SD-213 | a4326bf | `unitOf`: a member who becomes a minor at q1 to q3 goes to stage active, the interview question closes. |
| SD-276 | 7b0cd6f | `crash` marks the notice row stuck; `receive` (inbox admission) deletes it. |
| SD-315 | ff807e1 | `joinStep`: no age and a floor under 13 is under_age; the pending join goes. |
| SD-383 | 77dff0d | `recordAge` keeps 0 on the floor (it no longer raises). |
| SD-488 | 1a6ed45 | `routeChoices`: an invited app takes the reply by the rule of a pending join. |
| Q-join_age-1 | bcd83b8 | `routeChoices`: a bare app word of a ntwrk member with the question open stays on ntwrk; `wantsOf` adds it. |
| Q-join_age-2 | 29331d4 | `webCheck`: a repeat join of an active membership with no network member runs the hook again; a throw there is not undone. |
| Q-join_age-3 | this branch | `declineUnderAge` and the decline in `flushStep` delete the pending join row. |

Model corrections (the counterexamples were errors in the model, not in the code):

1. `enrollAnswered` read only the Network's own reply. Since b3f9868 the answer can be an open turn: the agent
   answers. The invariant now accepts `replied` or `outcome == "open"`.
2. `noticeSpentImpliesDelivered` fired between a crash and the next text. The row of a stuck turn is deleted in the
   admission of the sender's next turn, before any read, so that row is not spent.
3. `lookingForAnswerEnrolls` fired when the ntwrk membership was gone (an under-13 decline), when the reply reads as a
   join answer to a join the person started or to a staff invite (route rule 3 comes first, S:949-953), and when the
   person joined another app after the question and the text had no app word (route rule 4). The question is asked
   only to a person with no other app (S:1454-1461).
4. `inviteReplyJoinsInvitedApp` fired when the person had a pending join of their own or the target app was also
   invited. Route rule 3 takes the person's own pending join first.
5. `minorChatReachesAgent` fired on the text that makes a member a minor (it gets the minor notice, N:728) and on the
   first text of a member made by enroll (it gets the welcome). It now binds for a member the Network already held
   as a minor and had welcomed.
6. `crash` and `stepThrows` no longer reset the ghost `askOpen`: a turn that did not complete did not answer the
   question. `askOpen` changes only on a completed turn of The Network.
7. `activeImpliesMember` is a window the code allows (see section 2); `joinSuccessHasMember` states the defect
   that Q-join_age-2 was.

## 4. Register defects of this module

| Id | Result | Commit | Proof |
|---|---|---|---|
| SD-010 | fixed | 84c9fef | join-age.integration.test.ts (2 cases); `sd010PendingAgeKeptTest`, `sd010PendingAgeExpiresTest` |
| SD-011 | fixed | f1dc7c7 | join-age.integration.test.ts; `sd011CrashKeepsMinorAgeTest`, `sd011ThrowKeepsMinorAgeTest` |
| SD-014 | fixed | b6a1489 | join-age.integration.test.ts (3 cases), service-platform.test.ts updated; `sd014Under12RemovesMembershipsTest`, `sd014Under12TextJoinTest` |
| SD-015 | fixed | 8e083b4 | join-age.integration.test.ts; `sd015WebJoinOrphanTest` |
| SD-038 | fixed | b3f9868 | join-age.integration.test.ts; `sd038EnrollReadsAgeTest` |
| SD-065 | fixed | e94c1d8 | join-age.integration.test.ts, `bun run sim --only network` 61/61; `sd065MinorChatOpenTest` |
| SD-066 | fixed | 0170505 | join-age.integration.test.ts; `sd066SinglePlayerTest` |
| SD-125 | fixed | 26b760a | join-age.integration.test.ts; `sd125EnrollTurnAppTest` |
| SD-126 | not reproduced | - | After b3f9868 the answer is a member message first, so the turn is answered. `sd126MinorDatingAnswerTest` |
| SD-127 | fixed | 541e045 | join-age.integration.test.ts (the concurrent trace); `sd127MemberIdKeptTest` (the crash trace) |
| SD-179 | fixed | 55941d0 | join-age.integration.test.ts; `sd179ReplyClosesQuestionTest` |
| SD-213 | fixed | a4326bf | join-age.integration.test.ts; `sd213MinorInterviewStopsTest` |
| SD-276 | fixed | 7b0cd6f | join-age.integration.test.ts, migration 0043; `sd276NoticeGivenBackTest` |
| SD-315 | fixed | ff807e1 | join-age.integration.test.ts; `sd315FloorUnder13DeclinedTest` |
| SD-383 | fixed | 77dff0d | join-age.integration.test.ts, migration 0043; `sd383AgeZeroTest` |
| SD-488 | fixed | 1a6ed45 | join-age.integration.test.ts; `sd488InviteReplyTest` |
| Q-join_age-1 | fixed | bcd83b8 | join-age.integration.test.ts; `q1BareKeywordAnswerTest` |
| Q-join_age-2 | fixed | 29331d4 | join-age.integration.test.ts; `q2WebJoinRepairTest` |
| Q-join_age-3 | fixed | this branch | join-age.integration.test.ts (2 cases); `q3WebDeclineDropsPendingJoinTest`, `q3ChatDeclineDropsPendingJoinTest` |
| Q-join_age-4 | not fixed | - | `q4DeclineStepFailsTest`; needs a design decision (section 5) |
| SD-080 | skipped | - | Founder decision (below) |
| SD-128 | refuted in the register | - | The window stays; the next join completes it (`activeImpliesMember`, outside `safety`) |

SD-126 (not reproduced): since b3f9868 the looking-for answer goes through `memberMessage` before enroll. A
15-year-old who joined ntwrk with no keyword and answers "dating" gets a reply in the same turn. The pending row is
still deleted: that is the close-on-answer behaviour that the SD-179 fix makes general. No code was changed.

SD-080 (skipped, founder decision): a first text "Area 51" on the shared line is a full ntwrk join with an opt-in
whose wording was never shown. The fix (read a name only after the join ask or an invite) changes the text join
flow and made 21 integration and e2e tests fail, because they use one-message joins such as "Ro 31". Whether a
one-message "name age" first text is a valid join with consent (PRD F3) is a product and consent decision. The
parser is an oracle in this model (README rule 7), so the model has no invariant for it.

Not reached (unchanged): SD-123, SD-145, SD-270, SD-272, SD-295, SD-436 (all refuted): the model uses the production
join modes and has no waitlist app and no `clearMinorSignal`.

## 5. New defects found by the fixed model

**Q-join_age-3: an under-13 decline keeps the phone's pending text join** (fixed on this branch). Trace
(`q3WebDeclineDropsPendingJoinTest`): text "slop" -> pending join row of slop -> web join of friends at 12 ->
`recordAge` and `declineUnderAge` -> under_age, but the pending join row (which can hold a name and an age) stays
for a day. The same in chat (`q3ChatDeclineDropsPendingJoinTest`): a pending join row, a web join at 15, then "I am 12
years old" -> the Network declines, statedAge forgets every membership, the pending join row stays. Fix:
`Accounts.declineUnderAge` deletes the phone's pending join when the phone's lowest age is under 13 (also when there
is no person), and `statedAge` deletes it on a decline. The two integration tests in
`packages/network/test/join-age.integration.test.ts` ("Q-join_age-3: ...") failed before the fix on the pending row.

**Q-join_age-4: a chat decline whose statedAge step fails keeps the other memberships** (not fixed). Trace
(`q4DeclineStepFailsTest`): web joins of friends and slop at 15 -> "I am 12 years old" on friends -> the unit
declines: its save forgets the friends member and writes 12 to the person and the floor (SD-011 fix) -> statedAge
throws (or the worker stops) before its loop forgets the other memberships (S:1302-1309) -> the slop membership, its
network member and its opt-in stay for a person under 13. No later step repairs it: the slop member's own texts
never decline (its record age is 15, `ageLowered` did not run), and only a new join runs `declineUnderAge`. The fix
needs a design decision: forget every app's member in the unit's own transaction (one save across apps), or repair
on a later turn (for example `declineUnderAge` in the member path when the phone's lowest age is under 13). Neither
is a small change, so it is not in this round. The model keeps `under13StoresNothingStrict` (fails on this trace)
out of `safety`; `under13StoresNothing` in `safety` excepts only the window between a committed decline and its
forget (ghost `declineOpen`), so SD-014, SD-315 and Q-join_age-3 stay covered.

## 6. Checks run

- `bun run quint:check quint/join_age.qnt` (seed 0x5eed, max-steps 40, max-samples 4000): typecheck ok, 26 run
  tests ok, `safety` ok, 7 witnesses reachable.
- Extra simulations of `safety` (Rust backend): seeds 0x2a and 0x99 with max-steps 60 and 30000 samples, seed 0x3 with
  max-steps 50 and 20000 samples, seeds 0x1, 0x2, 0x7 with max-steps 40 and 10000 samples: no violation.
- `bun run quint:check --verify quint/join_age.qnt`: all of the above and `verify safety` ok at `verify-steps=6`
  (Apalache 0.62.4, Java 21, about 2 minutes in all). The model header had `verify-steps=10`; it is now 6, because
  the run time grows about 4 times for each 2 steps and a first run at 10 lost its server connection ("Connection
  dropped") on this shared machine.
- `quint verify --invariant safety` on a separate Apalache server (`apalache-mc server --port=28931`,
  `--server-endpoint localhost:28931`): no violation at max-steps 4 (22 s), 6 (84 s) and 8 (711 s).
- Code: `bun test --conditions eliza-source` on `packages/network/test/join-age.integration.test.ts` (22 pass),
  `service-platform.test.ts`, `packages/platform/test/api.test.ts`, `api-security.test.ts`,
  `eliza-takeover.integration.test.ts` (88 pass), `tests/e2e/platform.e2e.test.ts` (40 pass), `bun run typecheck` ok.
- Known failures that this branch did not cause: three cases in `packages/network/test/service.test.ts` ("an
  under-13 decline keeps only the member id") and `service-apps.test.ts` ("text joins: an open app ...", "a text join
  refused under age cannot retry ...") expect `join_asked` for a text from a phone whose age floor is under 13. That
  is the behaviour SD-315 removed (ff807e1); they fail the same way without the Q-join_age-3 change.
