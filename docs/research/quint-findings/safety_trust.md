# Quint findings: `quint/safety_trust.qnt`

Module plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.9 (P0).
Model: [quint/safety_trust.qnt](../../../quint/safety_trust.qnt). This file is hand-written. The traces are
from `quint run` (seed `0x5eed`) and from the model's `run` tests.

## 1. What the model covers

- Machines: person-safety-carryover (M-051), trust-level (M-052), safety-report (M-053), pair-relations (M-054),
  slop-check-in-report (M-055), slop-review-hold (M-056), safety-case (M-127), pending-safety-who (M-128).
  journey-help (M-183) has no Network state (`network.ts:677` returns on HELP), so the model leaves it out.
- Bounds: 2 apps (`slop` with `postDateReports`, `peon` without), 3 adult persons (`ana`, `ben`, `cy`),
  member generation 0..1 (one rejoin per app and person gives a new member id), 3 opportunity slots, days
  0..60.
- One action is one unit of work of one Network. The service loops that run one unit per app (staff hold,
  `service.ts:1681-1684`) have one action per unit and a `crash` action between units.
- Oracles: the report-kind reader on the "report X" text, the check-in reader (`checkInReport`; it can
  misread only a happy answer; a missed real report is corpus work, the SD-031 family), the route of a member's
  message (`service.ts:957-981`: the app with the newest item, else the last writer), and the relay decision.
- Not modelled: the 14-day window of `blocksMade` (the model counts every stranger block), the UTC hour in
  `slotOf` (the model uses days), inviter accountability, the probe stage (items start booked), and
  person-level ages from `onAgeStated` (only the minor *report* is modelled).

## 2. Check results

| Check | Result |
|---|---|
| `quint typecheck` | ok |
| `quint test` (21 `run` tests) | ok: each defect trace below replays and ends in the stated violation |
| `safety` simulation (max-steps 14, max-samples 6000) | FAIL (expected: the model shows the defects) |
| 8 witnesses (date done, check-in report, met message report, staff hold, lift to ok, watch, rejoin, ban) | all reachable |
| `quint verify --invariant safety` (Apalache, verify-steps 2, 22 s) | FAIL at step 1 (staff hold notice, SD-475; and the hold window, SD-022) |
| `quint verify --invariant noSingleActorHold --max-steps 2` | ok (no counterexample in 2 steps, 142 s) |
| `quint verify --invariant holdOnlyLiftedByStaff --max-steps 2` | not finished: Apalache ran out of Java heap (157 s). At 3 and 5 steps both invariants ran out of heap or time. |

Per-invariant simulation (seed `0x5eed`, same bounds). "run" means the simulator did not find it in 6000
samples, and the named `run` test replays a concrete trace.

| Invariant | Rule | Result | Register |
|---|---|---|---|
| `staffHoldFollowsPerson` | PRD 40.3 (prd-snapshot.md:1777), admin-console 3.7.1 | violated | SD-021, SD-022 |
| `autoHoldFollowsPerson` | admin-console 4.6, trust.ts:6-7 | violated | SD-074, SD-021 |
| `minorSignalFollowsPerson` | founder decision 1 (AGENTS.md) | violated | SD-074, SD-021 |
| `urgentMetReportBlocksMatching` | PRD 36.3 / prd-snapshot.md:1446 | violated | SD-022, SD-074, SD-021 |
| `holdOnlyLiftedByStaff` | trust.ts:6-7 | holds | - |
| `noSingleActorHold` | trust.ts:8-11, network.ts:1143 | holds | - |
| `reporterNotHeld` | trust.ts:115-116, network.ts:1326 | violated | SD-072 |
| `blockClosesAllApps` | PRD 40.3, PRD F23 (prd-snapshot.md:1055) | violated | SD-025 |
| `blockOnlyAffectsPair` | PRD F23, network.ts:3050-3051 | violated | SD-045 |
| `metIsReal` | network.ts:1383-1386, trust.ts:9 | violated | SD-044 |
| `checkInReportIntended` | reports.ts:33-37 | violated (run) | SD-067 |
| `reportersCounted` | trust.ts:8-10 | violated | SD-229 |
| `watchLasts14Days` | trust.ts:4-5 | violated | SD-141 |
| `engineHoldVisible` | trust.ts:6, PRD 1420 safety console | violated | SD-027 |
| `staffDecisionEndsEngineHold` | trust.ts:7 | violated | SD-027 |
| `noShowCountsAbsentOnly` | network.ts:2602 (`came: !f.selfNoShow`) | violated (run) | SD-222 |
| `slotFromMeeting` | profile.ts:51 (`attendedSlots`) | violated (run) | SD-442 |
| `everyMetReportFiled` | PRD F23, slop and peon check-in copy | violated | SD-250, SD-220 (run), SD-221 (run) |
| `pastContactsToldOfBan` | PRD 40.5 (prd-snapshot.md:1820) | violated | SD-253 |
| `relayBlockReachesSafety` | PRD 1420, PRD F23 | violated | SD-254 |
| `safetyNoticeImmediate` | network.ts:4143 (`safety` is "now"), outbound-queue.ts:46 | violated | SD-475 |

No counterexample was a model error after one correction: `blockClosesAllApps` first read every
participant of an item, so a plan member who had said no (not going) counted. The rule is about a booked item
that the two people are going to, so it now reads `going`.

## 3. Counterexamples, mapped to the code

Short form: `action(args)` per step. `S` is slop, `P` is peon.

1. **SD-021, leave and rejoin clears a hold** (`sd021LeaveRejoinClearsHoldTest`).
   `staffHold(ben@S)`, `staffHoldApply(ben@P)`, `leave(S, ben)`, `join(S, ben)` -> `ben@S#1` is level ok and
   matchable. Code: `network.ts:912-943` `forget` deletes the trust record, the cases and the minor flags of
   the member; `service.ts:1443` gives the rejoin a new member id (`${app.id}_${randomUUID()}`); nothing reads
   the person's earlier hold. The same trace with an automatic hold or a minor report fails
   `autoHoldFollowsPerson` and `minorSignalFollowsPerson`.
2. **SD-022, a hold is not atomic and not inherited** (`sd022HoldNotAtomicTest`, `sd022JoinDuringHoldTest`).
   (a) `staffHold(ben@S)`, `crash` -> `ben@P` is matchable. Code: `service.ts:1681` holds on this app in one
   unit, then `service.ts:1684` awaits one unit per other app; a stop between them leaves the other apps open
   and nothing resumes the loop. The simulator finds the shorter form: the state right after `staffHold` already
   breaks the rule, because another unit can run in the await. (b) `staffHold(cy@S)`, `join(P, cy)` -> the new
   peon member is not held. Code: `service.ts:1390` refuses only a banned person; `createMember` makes a fresh
   member. (c) Simulated: `leave(P, ana)`, `bookPlan(S, ...)`, `report(cy, S, ana, report, minor)`, `join(P, ana)`
   -> an open urgent met report about `ana@S` does not keep `ana@P` out of matching (`network.ts:1295-1296` reads
   reports of this member id only).
3. **SD-074, minor report and automatic hold stay in one app** (`sd074MinorReportOneAppTest`).
   `bookDate(S, ana, ben)`, `report(ana, S, ben, report, minor)` -> `ben@P` is matchable. Code:
   `network.ts:1550-1558` `minorReported` sets flags on this Network's member and calls no platform hook (compare
   `onAgeStated`, `network.ts:700`). Simulated automatic hold: `abuse(ben@S, 3)`, `abuse(ben@S, 6)` -> `ben@S`
   hold, `ben@P` ok and matchable (`network.ts:1188-1203` `onTrustChange` acts on one Network).
4. **SD-025, a block on one app leaves the other app's item** (`sd025BlockOneAppTest`).
   `bookDate(S, ana, ben)`, `bookDate(P, ana, ben)`, `report(ana, S, ben, block)` -> the peon item is still
   scheduled. Code: `network.ts:1434-1445` loops over `this.opps` of one Network; `runtime.ts:508-512` writes the
   person block, which the other app reads only for new items (`approvalCheck`, `network.ts:1998-1999`).
5. **SD-044 and SD-045, a plan decliner** (`sd044sd045DeclinerTest`).
   `bookPlan(S, ana, ben, cy, declined)`, `report(cy, S, ana, report, harassment)` -> the report has
   `met = true` (cy only got the anonymous probe), ana is out of matching (urgent met report) and the plan of
   ana and ben closes. Code: `network.ts:1388` `metBefore` reads `participants` and `contacted` (a decliner is
   both, `network.ts:3014`); `network.ts:1435` closes any open item that names both, whoever is going.
6. **SD-072, a banned or held reporter** (`sd072BannedReporterTest`).
   `bookDate(S, ana, ben)`, `ban(ben)`, `report(ben, S, ana, report, harassment)` -> ana is out of matching.
   Code: `service.ts:1122` passes a banned member's text to the Network (no ban check for members);
   `network.ts:740` runs block and report before the hold return at `network.ts:746`; `network.ts:1296`
   `reportHeld` reads `met` and the kind, not the reporter's standing. The simulator also found it through
   "Who do you mean?" (`reportAsk`, `ban`, `answerWho`).
7. **SD-067, a happy check-in answer** (`sd067HappyCheckInTest`).
   `bookDate(S, ana, ben)`, `meet`, `checkIn(ana@S, fine, reader = minor)` -> a check-in report, a person block
   and `minorF(ben@S)`. Code: `reports.ts:38-41` `checkInReport` reads the whole answer with the kind regexes;
   `network.ts:2608-2616` files a report, writes a block and calls `minorReported` for any kind it returns.
8. **SD-229, check-in reports skip the trust rules** (simulated: `bookDate`, `meet`, `checkIn(report)`).
   The check-in report is credible and met, but the reporter is not in `reportsFrom` and adds no points.
   Code: `network.ts:2611` calls `fileReport` only; `network.ts:1447` (`trust.report`) runs only on the
   "report X" path. The doc comment at `network.ts:1276-1277` says only the message path keeps the trust
   rules, so the gap is known in the code, but trust.ts:8-10 states the rule for every report.
9. **SD-141, a short watch** (`sd141ShortWatchTest`; the simulator found a 13-day form).
   `abuse(ben@S, 1)` on day 0, `tick(13)`, `abuse(ben@S, 2)` -> watch on day 13; `tick(1)` -> ok on day 14.
   Code: `trust.ts:85` `r.lastDecay ??= now` keeps the grid of the first event; `trust.ts:127-131` takes a whole
   step on day 14.
10. **SD-027, `trust_review` with no case and no exit** (`sd027TrustReviewTest`).
    `report(ana, S, ben, block)`, `report(cy, S, ben, block)` -> `trustReview(ben@S)` with no case. Code:
    `profile.ts:273` counts `blocked` edges, `rules.ts:57` holds at 2; `network.ts:1429-1431` writes no case
    event for the target of a block. Simulated "no exit": `report(cy, S, ana, block)`, `report(ben, P, ana,
    report, no_show)` (a case for ana), `staffHold(ana@S)`, `liftHold(ana@S)` -> ana is still in trust_review.
    Code: `rules.ts:48-59` reads `review:cleared` only for the safety cue, and no production code writes the
    `review:*` tags (only `packages/sim` does).
11. **SD-222, a self-reported no-show** (`sd222SelfNoShowTest`).
    `bookDate(S, ana, ben)`, `meet(absent = {ben})`, `checkIn(ben@S, selfNoShow)` -> `noShows(ana@S) = 1`.
    Code: `network.ts:2641` pushes one interaction with every participant and outcome `no_show`;
    `profile.ts:247` charges every participant.
12. **SD-442, the slot of the answer** (`sd442SlotTest`).
    `bookDate`, `meet`, `tick(1)`, `checkIn(fine)` -> the completed interaction has the answer day.
    Code: `network.ts:2641` stamps `at: this.now()`; `profile.ts:244` `slotOf(r.at)`.
13. **SD-220, a disclosure after the first answer** (`sd220DisclosureAfterAnswerTest`).
    `checkIn(ana@S, fine)`, then `disclose(ana@S)` -> no report. Code: `network.ts:748` only logs
    `abuse_disclosed`; `onFeedback` runs once per member (`network.ts:2587-2591`).
14. **SD-221, the peon check-in** (`sd221PeonCheckInTest`).
    `bookDate(P, ana, ben)`, `meet`, `checkIn(ana@P, report, harassment)` -> nothing filed. Code:
    `network.ts:2608` needs `hooks.postDateReports`; only slop sets it (`packs.ts:275`).
15. **SD-250, the route of a report** (`sd250MisroutedReportTest`; simulated with `leave` then
    `reportUnresolved`). `bookDate(S, ana, ben)`, `report(ana, P, ben, report, harassment)` -> filed on peon with
    `met = false`; ben stays matchable on slop. If ben is not a peon member, the report is unresolved. Code:
    `service.ts:972-978` routes a plain text to the newest item or the last writer; `service.ts:966`
    `namedApp` reads only a whole-message app name; `network.ts:1371` `findByName` searches only this Network.
16. **SD-253, no ban notice** (`sd253BanNoticeTest`). `bookDate(S, ana, ben)`, `ban(ben)` -> ana is never told.
    Code: `service.ts:1734-1764` `ban` writes no notice and calls no relay-log reader.
17. **SD-254, relay blocks** (`sd254RelayBlockTest`). `bookDate`, `relaySend(ben@S, block)` -> no case for ben.
    Code: `relay.ts:234` returns on a block after the log; `RelayHost` (`relay.ts:67-80`) has no trust or case
    method.
18. **SD-475, hold notice kind** (`sd475HoldNoticeKindTest`). `staffHold(ben@S)` -> the hold notice is queued
    as `transactional`. Code: `network.ts:1197` sends kind `safety` (`timingOf` "now", `network.ts:4143`);
    `runtime.ts:429` makes every send that is not a reply in the member's own turn `transactional`, and the
    outbound queue applies quiet hours and the caps to it (`packages/blooio/src/outbound-queue.ts:46`, quiet hours at 394, caps at 398-421).
    A report by another member that puts someone on hold has the same result.

## 4. Register defects of this module

Reproduced (19 of 19 in the task list): SD-021, SD-022, SD-025, SD-027, SD-044, SD-045, SD-067, SD-072,
SD-074, SD-141, SD-220, SD-221, SD-222, SD-229, SD-250, SD-253, SD-254, SD-442, SD-475.

Notes on the disputed rows:

- SD-072 (disputed): reproduced through the code path above. The model assumes the gateway passes a banned
  member's text to `/internal/turn` (the backend has no ban check before `memberMessage`, `service.ts:1122`).
  If the Eliza gateway drops texts from banned numbers, the banned half does not occur, but the held-reporter
  half does (a member on hold can still report, `network.ts:740`).
- SD-074 (disputed): reproduced; the rule used is admin-console 4.6 ("a hold on any app holds the person
  everywhere") and founder decision 1 (age is a person fact). If the founder decides that an automatic hold
  is per app, `autoHoldFollowsPerson` goes and `minorSignalFollowsPerson` stays.
- SD-221, SD-253, SD-254 (disputed): reproduced as "no code path exists". The model cannot say whether the
  production deployment reaches them (for SD-254, whether `NETWORK_RELAY_ENABLED` is on).

Other rows in section 6.9 that are not in the task list:

- SD-251 (refuted, design of "leave"): the model records a wanted report only while the reporter is a member
  of the app where they met, so it does not report it.
- SD-476 (refuted): a lift on one app leaves the other apps held; the model shows this as fail-safe (no
  invariant fails).
- SD-477 (refuted): no unban path; the model has none either, by design.

The liveness item of the plan ("every hold reaches a staff decision") is not checked: the simulator and
Apalache check state invariants only.

## 5. New findings

None. Every counterexample maps to a register id above. `holdOnlyLiftedByStaff` and `noSingleActorHold` hold
in 6000 random traces of 14 steps. Apalache confirms `noSingleActorHold` for 2 steps only; deeper bounded checks of this model run out of heap.
