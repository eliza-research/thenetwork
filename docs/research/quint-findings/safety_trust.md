# Quint findings: `quint/safety_trust.qnt`

Module plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.9 (P0).
Model: [quint/safety_trust.qnt](../../../quint/safety_trust.qnt). This file is hand-written. The traces are
from `quint run` (seed `0x5eed` unless stated) and from the model's `run` tests.

## 1. Final state

The model follows the code on branch `wave2/safety_trust` after the fixes `f8d9de8..49602b7` and the
SD-044 follow-up fix in this commit. `safety` holds the rules of every fixed defect and passes. The rules
of the skipped defects (SD-027, SD-074, SD-253) and two new findings (NEW-2, NEW-3) stay out of `safety`
as their own named values. Each has a comment with the id and the reason, and a `run` test replays a trace
that breaks it.

What changed in the model, by fix:

| Defect | Commit | Model change |
|---|---|---|
| SD-044 | f8d9de8 + this commit | `metBefore` reads `told` (bookedTold). The check-in record names the `told` people (see 3.1). |
| SD-045 | df588c8 | `callOffPair` closes only items that the blocker and the target are both going to. |
| SD-025 | de48147 | The tick runs `callOffPair` for every person block on every app. `meet` (the tick's advance) cannot finalize an item that two blocked people are going to. |
| SD-021, SD-022 | 059965d | New state `personHolds` (platform.person_holds). A staff hold writes `(p, "*")` first. A leave of a member who is held, has an urgent report open or was reported as a minor writes `(p, app)`. A covered member is out of matching, and `sync` (syncMember/personHold) holds them at their next unit or tick. A lift turns `"*"` into one row per other app and deletes this app's row. |
| SD-141 | db176ce | `addPts` restarts the decay clock at each event with points. |
| SD-072 | ab4ff2a | `reportHeld` skips a report whose reporter is on hold (a blank reporter id counts as "ok"). |
| SD-067 | 0e0bf2a | The check-in reader (an oracle) reads a happy answer as no report. The corpus gate checks the reader itself. |
| SD-220 | 33ea2bc | New action `disclose(k, m, kind)`: a later disclosure in the 7-day window files the check-in report. |
| SD-221 | 9b8ef32 | Both apps have `postDateReports`. |
| SD-222, SD-442 | 581888d | The check-in record has `by` and the meeting time. `noShows` and `dates` count records by that member. |
| SD-229 | db4ea4c | `blockAndReport` is the one path for "report X" and the check-in: trust block, call off, trust report, case event, record, minor step. |
| SD-250 | 4878d3c | `report` routing: a member of several apps whose text names a counterpart goes to the app of the newest meeting with them. |
| SD-254 | fa81646 | Relay decision `blockSevere` writes a 0-point case event. A block for the form (`block`) opens nothing. |
| SD-475 | 49602b7 | The hold notice outside the member's own turn is the `safety` kind. |

Rules that were rewritten:

- `autoHoldFollowsPerson`, `minorSignalFollowsPerson` and `urgentMetReportBlocksMatching` are now in two
  forms. The `InApp` form (same app, any member id: SD-021) is in `safety`. The every-app form is SD-074
  (skipped) and stays out of `safety`. The ghosts `autoHeldP` and `minorP` now hold `(person, app)`.
- `urgentMetReportBlocksMatchingInApp` counts only a report by a reporter in good standing (the SD-072
  rule), and it accepts a staff lift of the rejoined member as the staff decision.
  `minorSignalFollowsPersonInApp` also accepts that lift (see 3.4).
- `reporterNotHeld` now says what SD-072 asks: a live member that a report holds has such a report by a
  reporter who is not on hold and not banned. The earlier form ("every open met urgent report is
  credible") was about the record, but the fix keeps the record for staff.
- `blockClosesAllApps` allows a pair's item on another app to stay booked until that app's next tick (ghost
  `pendingCallOff`, cleared at the tick). The item cannot finalize first. This is the design of the
  SD-025 fix. The app where the block was made still closes the item at once.
- `blockOnlyAffectsPair` is the SD-045 rule: a block calls an item off only when the blocker and the target
  are both going. The stricter earlier form ("nobody else is going") is NEW-3.
- `relayBlockReachesSafety` is about a severe block (the sender's own words), and it asks for a case
  (`caseSt != "none"`), so that a later staff close does not break it.

## 2. Check results

Bounds: 2 apps, 3 adult persons, member generation 0..1, 3 opportunity slots, days 0..60.

| Check | Result |
|---|---|
| `quint typecheck` | ok |
| `quint test` (29 `run` tests) | ok |
| `safety` simulation (max-steps 14, max-samples 6000, seeds `0x5eed`, `0x1234`, `0xbeef`) | ok: no violation |
| 11 witnesses (date done, check-in report, met message report, staff hold, lift to ok, watch, rejoin, ban, carried-over hold on a rejoin, call-off on another app, relay case) | all reachable |
| `quint verify --invariant safety --max-steps 2` (Apalache 0.62.4, verify-steps 2) | ok: no violation (521 s) |

`bun run quint:check --verify` failed to connect to the shared Apalache server on `localhost:8822` (other
sessions use it: "Connection dropped"), so the verify step ran by hand with `--server-endpoint
localhost:18931`. Deeper bounded checks were not run: 2 steps already take 521 s. A witness for the late
disclosure path (SD-220) was not reachable in 6000 random samples of 14 steps (it needs a booked date, the
meeting, a first answer and the disclosure on the same member and slot), so the model has no witness for it;
`sd220DisclosureAfterAnswerTest` replays that path.

The values kept out of `safety`, simulated at the same bounds (seed `0x5eed`):

| Value | Defect | Result |
|---|---|---|
| `autoHoldFollowsPerson` | SD-074 (skipped) | violated |
| `minorSignalFollowsPerson` | SD-074 (skipped) | violated |
| `urgentMetReportBlocksMatching` | SD-074 (skipped) | violated |
| `engineHoldVisible` | SD-027 (skipped) | violated |
| `staffDecisionEndsEngineHold` | SD-027 (skipped) | `sd027TrustReviewTest` and the simulator |
| `pastContactsToldOfBan` | SD-253 (skipped) | violated (`sd253BanNoticeTest`) |
| `reporterStandingKept` | NEW-2 | violated (`new2HeldReporterLeavesTest`) |
| `blockLeavesOthersPlan` | NEW-3 | violated (`new3BlockInPlanTest`) |

## 3. Register defects of this module

### Fixed (16)

Each fix has its test in the code (named in the commit). The model's `run` test for each replays the
earlier counterexample and now ends in a state that keeps the rule:

| Id | Fix commit | Model run test |
|---|---|---|
| SD-021 | 059965d | `sd021LeaveRejoinKeepsHoldTest`, `sd021MinorReportCarriedOverTest` |
| SD-022 | 059965d | `sd022HoldNotAtomicTest`, `sd022JoinDuringHoldTest`, `sd022JoinDuringHoldTextTest` |
| SD-025 | de48147 | `sd025BlockAcrossAppsTest`, `sd025NoMeetingBeforeCallOffTest` |
| SD-044 | f8d9de8, this commit | `sd044sd045DeclinerTest`, `sd044AfterCheckInTest` |
| SD-045 | df588c8 | `sd044sd045DeclinerTest` |
| SD-067 | 0e0bf2a | `sd067HappyCheckInTest`, `sd067NoMisreadTest` |
| SD-072 | ab4ff2a | `sd072BannedReporterTest` |
| SD-141 | db176ce | `sd141WatchLastsTest` |
| SD-220 | 33ea2bc | `sd220DisclosureAfterAnswerTest` |
| SD-221 | 9b8ef32 | `sd221PeonCheckInTest` |
| SD-222 | 581888d | `sd222SelfNoShowTest` |
| SD-229 | db4ea4c | `sd229CheckInCountedTest` |
| SD-250 | 4878d3c | `sd250ReportRoutedToMeetingTest`, `sd250NotRoutedElsewhereTest` |
| SD-254 | fa81646 | `sd254RelayBlockTest` |
| SD-442 | 581888d (in part) | `sd442SlotTest`. The model uses days; `slotOf` still reads UTC hours, which the model does not cover. |
| SD-475 | 49602b7 | `sd475HoldNoticeKindTest` |

#### 3.1 SD-044: a second path, fixed in this commit

After the f8d9de8 fix the model found a second path to the same defect. `onFeedback` wrote the check-in
record with `participants: [...o.participants]`. A plan keeps a member who said no in `participants`, and
`metBefore` and `counterparts` read the record. So after the plan met and one member answered the
check-in, the decliner counted as someone who met them, and the decliner's urgent report held that member.
Trace: `bookPlan(o1, slop, ana, ben, cy, declined)`, `meet(o1)`, `checkIn(o1, ana@slop, fine)`,
`report(cy, slop, ana, report, harassment)` -> `met = true`.

Fix: the record names the people the booked plan reached (`o.bookedTold ?? o.participants`,
`packages/network/src/network.ts` onFeedback). Test: `packages/network/test/report-plan-decliner.test.ts`
"SD-044: after the plan, a check-in answer does not make the decliner someone who met them". It failed
before the fix (`met` was `true`) and passes after it. The test files of the check-in record
(`check-in-history`, `check-in-report-trust`, `check-in-late-report`, `peon-check-in-report`) also pass.

### Not reproduced

None.

### Skipped (3)

- **SD-027** (founder decision). The slop `trust_review` rule holds a member after 2 blocks or 2 no-shows
  with no case and no staff exit. A fix adds a new staff action and member copy, or removes an engine
  safety filter. `engineHoldVisible` and `staffDecisionEndsEngineHold` stay out of `safety`.
- **SD-074** (founder decision). An automatic hold, a minor report or an urgent report on one app does not
  hold the person on the other apps. It is not clear which staff decision ends such a hold in the other
  apps, and one verifier vote says per-app reach is by design. `autoHoldFollowsPerson`,
  `minorSignalFollowsPerson` and `urgentMetReportBlocksMatching` stay out of `safety`. Their `InApp` forms
  (SD-021) are in `safety` and pass.
- **SD-253** (founder decision). No notice of a ban goes to past contacts. It is new member copy.
  `pastContactsToldOfBan` stays out of `safety`.

### 3.4 Notes on the fixed rows

- SD-021: a minor report carries over as a plain person hold (`held_by = 'safety_carryover'`). A staff lift
  of the rejoined member ends it, and the minor flag does not come back. The case history is not carried
  over (the commit names this as the separate evidence or erasure defect), so staff lift without seeing
  that the hold came from a minor report. The model accepts the lift as the staff decision.
- SD-022: the other apps' members are held at their next unit or tick, not in the same transaction. The
  model treats a covered member as out of matching at once, because matching runs in the tick after
  `personHold`.
- SD-220: the code takes the member's newest done 1:1 date in the window. The model lets a member disclose
  only when one such date is in the window. A disclosure about an older date, with a newer date in the
  window, is not modelled.

## 4. New findings

These findings are reported, not fixed: they are not in the task list, and each needs a decision on the
wanted behaviour.

- **NEW-2: a held reporter's standing resets.** The SD-072 fix reads the reporter's trust level. Two paths
  reset it. (a) A reporter on hold leaves the app: `forget` blanks `reporterId`, `trust.level("")` is "ok",
  and the report holds its subject again (`new2HeldReporterLeavesTest`: `bookDate`, `staffHold(ben)`,
  `report(ben -> ana)`, `leave(slop, ben)` -> ana is out of matching). (b) Staff lift a banned member's hold
  (`liftHold` does not check the ban): the banned member's report holds its subject (the simulator found
  `ban(ana)`, `liftHold(ana@slop)`, `report(ana -> cy)`). The value `reporterStandingKept` keeps this rule.
  A fix needs the report to keep the reporter's standing when it is filed or at the leave, or `liftHold` to
  refuse a banned member. Not fixed here: it is a new defect, not in the task list.
- **NEW-3: a block inside a plan calls it off for everyone.** When two members who are both going to a
  plan of three block each other, `callOffPair` closes the plan, and the third member loses it
  (`new3BlockInPlanTest`). PRD F23 says a block "only affects the pair", and `bookPlan` drops one member of
  a blocked pair so that "one block cannot collapse the quorum". SD-045 covers only a blocker who is not
  going. The value `blockLeavesOthersPlan` keeps the strict rule. It needs a decision on what a block in a
  booked plan does (drop one member, or call it off).

The liveness item of the plan ("every hold reaches a staff decision") is not checked: the simulator and
Apalache check state invariants only.
