# Safety reports, holds, and blocks

## Story: Safety reports, holds, and blocks

A member needs a safety report or block to affect eligibility, with staff control of restricted actions.

### Safety rules and reachability

Check person and app scope, age signals, review and hold decisions, and safety notices. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/safety_trust.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

Production uses [Safety cases and report review](../safetyCase.md) for the case lifecycle, report decisions, and staff hold and age-clearance admission. The standalone model also covers member contact, trust scores, and cross-app effects.

The matching snapshot reads [canonical ban authority](../staffSafetyService.md#live-enrollment-and-ban-projection-use-the-current-person) while runtime restriction is being projected. [Durable staff holds](../staffSafetyService.md#a-staff-hold-survives-ordinary-app-membership-changes) retain explicit staff decisions through ordinary app leave and rejoin under [PRD §40.3](../product/source/prd.md#403-shared-platform). Production keeps global authority with per-app releases. The retained model represents coverage with a set of app scopes. [A committed hard trust hold](../staffSafetyService.md#a-committed-trust-hold-follows-the-person-through-ordinary-app-leave) also carries within its app when the runtime forgets its member. [Exact open report restrictions](../safetyCase.md#the-exact-open-report-follows-its-subject-through-ordinary-app-leave) carry within their originating app. This model has one runtime per app and represents the exact report ID by its immutable report identity tuple. The older independent minor-signal trace remains an abstraction of the age path.

Compared with `vibestack-matching` on 2026-11-18, and again on 2026-11-19: since then only the leave path changed (a failed forget listener now stops the leave, `service.ts` `onForget`), which this model does not cover; `applyBlock`, `liftHold`, `holdMember` and `snapshot.ts` are unchanged. The trust rules (`packages/network/src/trust.ts` `add`, `block`, `report`, `lift`, `decay`, and the generated `levelForScore` and `trustDecayPoints` of [trust levels](../trustLevel.md)), the report decisions (`reportAfterDecision`, `holdLiftResult`, `caseCloseResult`, `holdAuthority` of [safety cases](../safetyCase.md)) and `ConsentNetwork.holdMember`, `liftHold`, `markBanned`, `dismissReport`, `closeCase`, `metBefore`, `applyBlock` agree with the model. Drift closed in this comparison (the code is right; the model changed):

1. Staff lift. `NetworkService.liftHold` (`packages/network/service/service.ts`) is one unit of work: it reads `platform.staff_safety_holds` (`currentStaffHold`), refuses a global hold without safety on every app (`durableStaffHoldLiftAllowed`, `needs_safety_everywhere`), calls `ConsentNetwork.liftHold(memberId, actor, note, durable)`, and its member command `liftStaffHold` (`packages/network/service/staff-safety-holds.ts`) reads the rows again under the person lock and refuses a change (`hold_changed`, the unit rolls back). It deletes this app's row and adds this app to `released_apps` of the global row. The model's three lift steps (`liftStart`, `liftTx`, `liftUnit`) and the rewrite of `"*"` into rows for the current apps are replaced by one step `liftHoldBy` and the `released` set; W3-644 is closed on this branch (`w3_644LiftAfterGlobalHoldTest`).
2. Durable hold on another app. `snapshot.ts` maps a durable staff hold and a canonical ban to `accountStatus: "restricted"` (`durableStaffHoldSnapshotStatus`, `staffBanSnapshotStatus`), and `syncMember` only drops the member from open items. The model's `sync` now writes no trust hold, no hold notice and no report status.
3. A lift with a durable hold and no runtime hold returns ok and marks an open case lifted (`holdLiftResult(actor, runtimeHeld || durable)`); `liftOf` does so (`liftDurableOnlyTest`).
4. No drift (the earlier note was wrong): the other apps of a staff hold call `holdMember(..., relatedReport, undefined)`, which marks every open report of that member `held` as `staffHoldApply` does. The `"projection"` authority is used only when the hold comes from an archived report of a person who has no current record, which the model does not have.

Compared again 2026-11-21 (audit COV08), twice. Convention: the intended action is in `step`, so `safety` checks the intended design; where the code differs, a `*Code` action (one `*By(code, ...)` body) is outside `step` and a run test shows the rule fail after it, as [join_age](join_age.md) does. In the first pass `quint:check` failed on `safety` (`checkInReportIntended`, seed `0xd0bb2`): the model's late path `disclose` (the source branch's `lateCheckInReport`) and the route of the answer to "Who do you mean?" were in `step`. The second pass rewrote the report paths to this branch's code:

- The check-in. `checkIn` follows `onFeedback`: slop and peon set `postDateReports` (`packs.ts` `slopHooks`, `peonHooks`; SD-221 fixed 2026-11-22), and each other person gets `recordMeetingSafetyReport`, which is `blockAndReport` with source `check_in`: the pair block and person block, the close of the pair's open items on this app (`closePairOpportunities`, ST-D7 fixed), `trust.report` with met true and a 0-point `report_received` case event when it adds no points (SD-229 fixed), `fileReport` (an urgent kind holds the subject through `reportHeld` and `dropMember`), and `minorReported` for kind minor. The code does not call `trust.block` there, because `trust.block` does nothing for a member who met the target.
- The later text. `disclose` is gone: this branch has no `lateCheckInReport`. A later free text with no "block" or "report" command files nothing (`freeText`; classify reads it as "other" and inbound logs `abuse_disclosed` only). A "report him" is the `report` command: `resolveTarget` with `confirmPast` asks "Who do you mean: Ben?" when no date is ahead (`report` with `ambiguous`, then `answerWho`), so the report names the person the member confirms (`w3_218PronounConfirmedTest`; W3-218, W3-219 and W3-224 were source-branch defects and do not arise here). Whether a free text should open a report is not in the approved specs (spec/safetyCase.md files a check-in report only from explicit report language).
- The route. `report` (intended) reaches the app of the newest meeting with the named person (SD-250). `reportCode` follows `NetworkService.route`, which does not read the name (the newest open item, else the last writer): a "report Ben" can reach an app where Ben is a stranger and is filed as a stranger's report (SD-250 open, `sd250CodeRoutedElsewhereTest`, `w3_220ReportRoutedElsewhereTest`). The answer to "Who do you mean?" can reach another app (`answerWhoElsewhereCode`, W3-220 open).
- The relay. `relaySendCode` follows `RelayDesk.apply`: a block for the sender's own words writes no case event (SD-254 open, `sd254CodeNoCaseTest`).

With these, `checkInReportIntended`, `reportSubjectMeant` and `everyMetReportFiled` are back in `safety`.

- ST-D5, SD-072 (`reporterNotHeld`, `reporterStandingKept`, in `reporterStandingDecision`): a founder decision, the spec is silent. `reportHeld` (`pendingReportHold`, the generated `reportRestrictsMatching` of [safety cases](../safetyCase.md)) reads no reporter standing, and `applyBlock` runs before the hold return of inbound (network-consent-4), so a reporter on hold who met the subject takes the subject out of matching (`sd072HeldReporterTest`). The approved rule says only that an open urgent report from a reporter who met the member restricts that member's matching, so the code agrees with the approved spec. Adding a reporter-standing condition is a decision for spec/safetyCase.md.

Fixed 2026-11-22 (spec/safetyCase.md, "A block or a report about a person closes every open opportunity of the pair" and "A minor signal on one app holds the person on every app until a later clear"):

- ST-D1. `ConsentNetwork.tick` now closes, after the member sync, every open item whose participants include a blocked pair (`blocked`: this Network's block or a snapshot person block), with the booked-cancellation copy to every participant and no actor named. The model's `tick` is this code; `tickCode` and `st_d1CodeTickKeepsItemTest` are gone.
- ST-D3. `minorReported` and a minor signal without an age call `onMinorSignal`; the runtime writes `platform.person_minor_signals` in the unit's save transaction, `matching_ages` exposes `minor_signal_at`, `snapshot.ts` carries it as `minorSignalAt`, and `syncRecord` makes each member of the person a minor until staff clear the member after the signal time (`personMinorSignalOpen`, `minorClearedAt`). `NetworkService.clearMinor` deletes the person row when every live membership has a clear at or after the signal time (`personMinorSignalEndsEverywhere`), so one-app clears on every app end it as `minorP` empties in the model; a membership that its app has not loaded is loaded from its record to be cleared. The per-app console views do not carry the signal time. The model applies the signal to every live member at once (`minorReported`) and to a later join (`join`, `inherited`): the code applies it at the next unit, which runs before any match, review decision or send. `minorSignalFollowsPerson` is not in `safety`: staff with safety on one app clear only that app, and the person's other apps stay held, so the rule fails after a one-app clear by design.
- ST-D7. See the check-in above (`st_d7CheckInClosesPairItemTest`).

Open code defects (the model keeps the intended rule in `safety`; a `*Code` action shows each one):

- ST-D2 (`relayAgeSignalReachesAgePolicy`, in `openAgeDefects`). The engine relay sets `ageSignal` when a member's own relayed text says they are under 18 (`packages/engine/src/relay.ts`, `minor:signal`), but `packages/network/src/relay.ts` and `store.ts` only store it; nothing calls the minors policy, so the member stays matchable. Checked again 2026-11-19.
- ST-D4 (`slotFromMeeting`, W3-237, low, matching data), fixed 2026-11-22. `slotOf` in `packages/engine/src/packs/slop/profile.ts` read `getUTCDay` and `getUTCHours`, so an 8 pm or a 2 pm New York meeting got the wrong attended slot. It now reads `localParts` in the zone of the member's home city, and `slotFromMeeting` is back in `safety`. `packages/engine/test/slop-attended-slot.integration.test.ts` checks a New York and a Los Angeles meeting. Abstraction: the model has one zone, so `slotNY` takes every meeting in New York time. The code reads the zone of each member's home city, and New York when the home city has no zone, because an interaction record has no meeting city. The two agree for a member whose home city is New York. For a member who dates in a city of another zone, the code gives the slot of the meeting in the home-city zone, which the model does not show. This note is new: a review found that the note said "where the members are", which is not what the code does.


Code locations in the module body name functions of `vibestack-matching` (no line numbers). Bounds note: `packs.ts` sets `plans: false` for slop and peon, so the model's plans on those apps stand for a group item of any app.

```quint
// quint-check: max-steps=14 max-samples=6000 verify-steps=2
// Safety and trust (docs/research/2026-11-07-state-machines.md section 6.9). Machines: person-safety-carryover
// (M-051), trust-level (M-052), safety-report (M-053), pair-relations (M-054), slop-check-in-report (M-055),
// slop-review-hold (M-056), safety-case (M-127), pending-safety-who (M-128). journey-help (M-183) has no
// state in the Network (HELP returns before any safety state changes), so it is not modelled.
//
// The model is compared with branch vibestack-matching (2026-11-21). Code locations name functions:
//   packages/network/src/trust.ts            add (a points event restarts the decay clock), block, report, lift,
//                                            decay; the generated levelForScore and trustDecayPoints
//   packages/network/src/reports.ts          report kinds, URGENT_REPORTS, reportKindOf, checkInReport (an oracle
//                                            here; the corpus evals/network/check-in-reports.jsonl checks it)
//   packages/network/src/classify.ts         classify: "block X" and "report X" are commands; other text is "other"
//   packages/network/src/network.ts          ConsentNetwork: onTrustChange, caseEvent, liftHold, closeCase,
//                                            fileReport, reportHeld (pendingReportHold), holdMember, decideReports,
//                                            markBanned, dismissReport, metBefore, handleBlock, resolveTarget,
//                                            applyBlock, counterparts, answerWho, minorReported, dropMember,
//                                            handleDrop, onFeedback, recordMeetingSafetyReport, handleImmediateDanger,
//                                            forgetMember, tick, syncMember; inbound (the hold return)
//   packages/network/service/service.ts      NetworkService.route, forget, liftHold, hold, clearMinor, ban
//   packages/network/service/staff-safety-holds.ts currentStaffHold, liftStaffHold, writeStaffHold
//   packages/network/service/packs.ts        slopHooks and peonHooks postDateReports
//   packages/network/service/runtime.ts      recordBlock (person_blocks), the send kind (meta.safety)
//   packages/network/service/snapshot.ts     canonical ban and durable staff hold -> restricted matching status
//   packages/network/src/relay.ts            RelayDesk.apply (stepRelay; no case event for a block)
//   packages/engine/src/packs/slop/rules.ts  reviewReason (trust_review; pair/context separation)
//   packages/engine/src/packs/slop/profile.ts histories and slotOf (a record with `by` counts for that member)
//
// One action is one unit of work (one SQL transaction of one Network). The service's cross-app hold loop
// awaits between apps: `staffHoldApply` is the next app's unit and `crash` is a process stop between two
// units. A unit that reads a member's text first syncs that member (syncMember: a person hold covers them).
// Oracles with nondeterministic output: the report-kind reader on the "report X" text, the check-in reader
// (checkInReport; it reads a happy answer as no report: the corpus gate checks this), resolveTarget's ask
// (`ambiguous`), the routing of a member's message to an app (intended: the app of the newest meeting with the
// person a block or report names; code: the newest open item, else the last writer), the Clef/rules relay
// decision. Time is in days.
//
// Intended actions are in `step`; the `*Code` actions (reportCode, answerWhoElsewhereCode, relaySendCode)
// follow the code where it differs, are not in `step`, and are used by run tests.
//
// Bounds: 2 apps, 3 persons, at most one rejoin per app and person (member generation 0..1), 3 opportunity
// slots. Staff have the safety@* role ("*") or safety on one app.
//
// Also modelled (docs/research/2026-11-07-state-machines.md section 9.6): a leave reads the hold state in one
// lock and forgets in another (W3-221); a ban is one unit per app (W3-223); the lift is one unit with a
// compare-and-set of the hold rows (W3-644, W3-231, W3-435); per-app staff scope and a hold with a report id
// (W3-231); the clear of a minor signal is one unit per app (W3-232); a probing stage; the block-abuse 14-day
// window (trust.ts block, W3-230); inviter accountability (onTrustChange, W3-229); the slot of a meeting in New
// York time against slotOf's UTC reading (W3-225, W3-237); the hold notice kind from outboundKind (W3-225); the
// relay ageSignal (read by nothing in the service, W3-232, W3-237).
module safety_trust {
  // ------------------------------------------------------------------ types
  type Mid = { app: str, p: str, g: int }
  // blocksMade: the times of stranger blocks (trust.ts, the 14-day window, W3-230)
  type Trust = { rec: bool, score: int, level: str, reportsFrom: Set[Mid], lastDecay: int, strangers: Set[Mid], blocksMade: List[int] }
  // meetHour: the New York local hour of the meeting (the slot, W3-225)
  type Opp = {
    app: str, kind: str, parts: Set[Mid], going: Set[Mid], told: Set[Mid], stage: str, meetingAt: int, meetHour: int,
    feedbackFrom: Set[Mid], absent: Set[Mid], closedBy: str, blocker: str, target: str
  }
  // origReporter: a ghost that keeps the reporter after a leave (the code blanks reporterId).
  // meantP: a ghost, the person the member meant (the name they gave or confirmed).
  type Report = {
    reporter: Mid, reporterP: str, origReporter: Mid, subject: Mid, kind: str, met: bool, source: str, status: str,
    credible: bool, intended: bool, at: int, meantP: str
  }
  type ReportIdentity = (Mid, Mid, str, str, int)
  // slot: what profile.ts slotOf reads from the record; hour: the New York hour of the meeting (truth)
  type Inter = { parts: Set[Mid], outcome: str, at: int, meetingAt: int, by: Mid, hour: int, slot: int }
  type Src = { msgs: int, reporters: Set[Mid], staff: bool, other: int }
  type Who = { asked: bool, at: int, verb: str, kind: str, target: str }
  type State = {
    now: int,
    gen: (str, str) -> int,
    joined: (str, str) -> bool,
    live: Mid -> bool,
    trust: Mid -> Trust,
    minorF: Mid -> bool,
    caseSt: Mid -> str,
    blocks: Set[Set[Mid]],
    personBlocks: Set[(str, str)],
    contextualBlocks: Set[(Mid, Mid)],
    // platform.staff_safety_holds: (person, app or "*"); the "*" row is the global row (app_id null)
    personHolds: Set[(str, str)],
    // released_apps of the person's global row: (person, app) that a lift released from the "*" row
    released: Set[(str, str)],
    opps: str -> Opp,
    reports: Set[Report],
    carriedReports: Set[ReportIdentity],
    inters: Set[Inter],
    banned: Set[str],
    restricted: Set[Mid],
    pendingHold: Set[Mid],
    pendingWho: Mid -> Who,
    relayLog: Set[(Mid, str)],
    // platform.share_grants with revoked_at null, by the person whose profile is shared, and
    // platform.pending_texts of the person's number (a share that waits for the member's yes)
    shareGrants: Set[str],
    pendingTexts: Set[str],
    // units that a service request still has to run (each await is a point where the process can stop)
    leaving: Set[Mid],
    banning: Set[Mid],
    clearing: Set[Mid],
    // network.members.invited_by (sim only: nothing in production writes it) and invitesBlockedUntil
    invitedBy: Mid -> Mid,
    invitesBlockedUntil: Mid -> int,
    // ghosts (never read by the modelled code)
    // (person, "*" or app): a staff hold that the rule says holds the person on that scope
    staffHeldP: Set[(str, str)],
    // members whose own relayed text carried a minor self-disclosure (RelayRecord.ageSignal)
    ageSignals: Set[Mid],
    autoHeldP: Set[(str, str)],
    minorP: Set[(str, str)],
    heldMids: Set[Mid],
    heldAtLeave: Set[Mid],
    liftedMids: Set[Mid],
    pendingCallOff: Set[(str, str, str)],
    src: Mid -> Src,
    counted: Mid -> Set[Mid],
    metPairs: Set[(str, str)],
    wanted: Set[(str, str)],
    watchSince: Mid -> int,
    earlyWatchExit: bool,
    staffCleared: Set[Mid],
    holdNotices: Set[(Mid, str)],
    toldOfBan: Set[(str, str)],
    lifts: int,
    lastAction: str,
  }

  // ------------------------------------------------------------------ constants
  pure val APPS = Set("slop", "peon")
  pure val PERSONS = Set("ana", "ben", "cy")
  pure val GENS = 0.to(1)
  pure val OPP_IDS = Set("o1", "o2", "o3")
  pure val ALL_MIDS: Set[Mid] = tuples(APPS, PERSONS, GENS).map(t => { app: t._1, p: t._2, g: t._3 })
  pure val NOBODY: Mid = { app: "", p: "", g: -1 }
  pure val WATCH = 3
  pure val HOLD = 6
  pure val DECAY_DAYS = 14
  pure val MAX_DAY = 60
  // reports.ts URGENT_REPORTS
  pure val URGENT = Set("harassment", "unsafe", "scam", "minor")
  pure val REPORT_KINDS = Set("harassment", "no_show", "minor")
  // New York local hours of a meeting: a weekend afternoon, a 7 pm and an 8 pm date
  pure val HOURS = Set(14, 19, 20)
  pure val NO_TRUST: Trust = { rec: false, score: 0, level: "ok", reportsFrom: Set(), lastDecay: -1, strangers: Set(), blocksMade: List() }
  pure val NO_SRC: Src = { msgs: 0, reporters: Set(), staff: false, other: 0 }
  pure val NO_WHO: Who = { asked: false, at: 0, verb: "", kind: "", target: "" }
  pure val FREE_OPP: Opp = {
    app: "", kind: "", parts: Set(), going: Set(), told: Set(), stage: "free", meetingAt: -1, meetHour: 19,
    feedbackFrom: Set(), absent: Set(), closedBy: "", blocker: "", target: ""
  }

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def imax(a: int, b: int): int = if (a > b) a else b

  // engine slop profile.ts slotOf: weekday evenings 0..4, Saturday 5 / 6, Sunday 7 / 8, else none (-1).
  // Day 0 is a Monday.
  pure def slotFor(dow: int, eve: bool): int =
    if (dow <= 4) (if (eve) dow else -1) else if (dow == 5) (if (eve) 6 else 5) else (if (eve) 8 else 7)
  // The slot of the meeting in New York time, the one zone of the model (ST-D4 note: the code reads the home-city zone, W3-237).
  pure def slotNY(day: int, hour: int): int = slotFor(day % 7, hour >= 17)
  // decisions.ts outboundKind (a proved LemmaScript core; the model calls it, it does not re-prove it)
  pure def outboundKind(reply: bool, causal: bool, replyingTo: bool, safetyMeta: bool, proactive: bool): str =
    if (reply and (causal or replyingTo)) "reply" else if (safetyMeta) "safety" else if (proactive) "proactive" else "transactional"
  // network.ts the hold notice: send(m, copy.hold, { type: "info", safety: true }, "safety"). In the
  // member's own turn the runtime may read it as the causal reply; else meta.safety makes it "safety".
  pure def holdNoticeKind(ownTurn: bool): str = outboundKind(ownTurn, ownTurn, ownTurn, true, false)

  var s: State

  // ------------------------------------------------------------------ derived values
  pure def midOf(st: State, app: str, p: str): Mid = { app: app, p: p, g: st.gen.get((app, p)) }
  pure def liveMidsOf(st: State, p: str): Set[Mid] = APPS.map(a => midOf(st, a, p)).filter(m => st.live.get(m))
  pure def lvl(st: State, m: Mid): str = st.trust.get(m).level
  // network.ts reportHeld (pendingReportHold, generated reportRestrictsMatching of spec/safetyCase.md): open, met
  // and urgent. Compared 2026-11-21: the reporter's standing is not read; a reporter on trust or staff hold can
  // still report (applyBlock runs before the hold return of inbound), so the report takes the subject out of
  // matching (the source branch's SD-072 fix ab4ff2a is not on this branch: SD-072 open, reporterNotHeld).
  pure def reportHeld(st: State, m: Mid): bool =
    st.reports.exists(r => r.subject == m and r.status == "open" and r.met and URGENT.contains(r.kind))
  pure def reportIdentity(r: Report): ReportIdentity = (r.subject, r.origReporter, r.kind, r.source, r.at)
  pure def carriedReportHeld(st: State, m: Mid): bool = st.reports.exists(r =>
    r.subject.p == m.p and r.subject.app == m.app and urgentOpen(r) and st.carriedReports.contains(reportIdentity(r)))
  // Durable coverage for this app or every app (staff-safety-holds.ts currentStaffHold with
  // durableStaffHoldCoversApp): the app row, or the global row when this app is not in its released_apps.
  pure def covered(st: State, m: Mid): bool = st.personHolds.exists(h => h._1 == m.p and
    (h._2 == m.app or (h._2 == "*" and not(st.released.contains((m.p, m.app))))))
  // engine slop profile.ts histories: a check-in record (by) counts for the member who gave it (SD-222)
  pure def noShows(st: State, m: Mid): int = st.inters.filter(i => i.by == m and i.outcome == "no_show").size()
  pure def dates(st: State, m: Mid): int = st.inters.filter(i => i.by == m and i.outcome == "completed").size()
  // profile.ts: one directed block per member with settled same-app encounter evidence at block time.
  pure def blockedBy(st: State, m: Mid): int = st.contextualBlocks.filter(b => b._2 == m).size()
  // slop rules.ts with SLOP_DEFAULT_OPTIONS trust { blockedBy: 2, noShows: 2 }
  pure def trustReview(st: State, m: Mid): bool =
    m.app == "slop" and (blockedBy(st, m) >= 2 or (noShows(st, m) >= 2 and noShows(st, m) > dates(st, m)))
  // Current snapshot.ts applies the canonical ban before matching, including during an interrupted
  // runtime restriction projection. The retained person hold relation expresses desired coverage.
  pure def matchable(st: State, m: Mid): bool =
    st.live.get(m) and not(st.banned.contains(m.p)) and lvl(st, m) == "ok" and not(st.minorF.get(m))
      and not(reportHeld(st, m)) and not(carriedReportHeld(st, m)) and not(st.restricted.contains(m)) and not(covered(st, m))
  // blocked(): this Network's block or a person block from the snapshot
  pure def blockedPair(st: State, a: Mid, b: Mid): bool =
    st.blocks.contains(Set(a, b)) or st.personBlocks.contains((a.p, b.p)) or st.personBlocks.contains((b.p, a.p))
  pure def usedOpps(st: State): Set[Opp] = OPP_IDS.map(k => st.opps.get(k)).filter(o => o.stage != "free" and o.stage != "deleted")
  // network.ts metBefore: a booked opportunity that reached both (bookedTold, SD-044), or a completed /
  // no_show interaction that names both.
  pure def metBefore(st: State, a: Mid, b: Mid): bool = or {
    usedOpps(st).exists(o => o.told.contains(a) and o.told.contains(b)),
    st.inters.exists(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")),
  }
  // network.ts counterparts of a: the others told about a booked meeting a was told about who said yes,
  // or a recorded meeting. The value is the time of the newest such meeting, -1 for none.
  pure def counterpartAt(st: State, a: Mid, b: Mid): int = {
    val fromOpps = usedOpps(st).filter(o => o.told.contains(a) and o.told.contains(b) and o.going.contains(b)).fold(-1, (acc, o) => imax(acc, o.meetingAt))
    st.inters.filter(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")).fold(fromOpps, (acc, i) => imax(acc, i.at))
  }
  pure def counterpart(st: State, a: Mid, b: Mid): bool = a != b and counterpartAt(st, a, b) >= 0
  // intended route (SD-250): the newest meeting of person r with person t on app a (-1: none)
  pure def metAtOn(st: State, a: str, r: str, t: str): int =
    if (st.live.get(midOf(st, a, t))) counterpartAt(st, midOf(st, a, r), midOf(st, a, t)) else -1
  // ghost: the two people were both told about one booked meeting and both are going (they met)
  pure def metPair(o: Opp, a: Mid, b: Mid): bool = a != b and o.told.contains(a) and o.told.contains(b) and o.going.contains(a) and o.going.contains(b)
  // trust.ts the stranger blocks inside the 14-day window
  pure def recentBlocks(t: Trust, now: int): List[int] = t.blocksMade.select(x => now - x < DECAY_DAYS)
  // trust.ts reporter credibility: ok, and fewer than 3 stranger blocks in the last 14 days (W3-230)
  pure def credibleT(t: Trust, now: int): bool = t.level == "ok" and recentBlocks(t, now).length() < 3
  // two people of an item that a person block keeps apart (a probing item: the people asked)
  pure def blockedGoing(st: State, o: Opp): Set[(Mid, Mid)] = {
    val inIt = if (o.stage == "probing") o.parts else o.going
    tuples(inIt, inIt).filter(t => t._1 != t._2 and st.personBlocks.contains((t._1.p, t._2.p)))
  }

  // ------------------------------------------------------------------ code paths as pure functions
  // network.ts caseEvent: no case or a closed one opens a new case; a lifted case reopens.
  pure def caseAfter(c: str, kind: str): str =
    if (c == "none" or c == "closed") "open" else if (c == "lifted" and kind != "hold_lifted") "open" else c

  pure def srcAdd(x: Src, kind: str, by: Mid): Src =
    if (kind == "staff_hold") { ...x, staff: true }
    else if (kind == "report_received") { ...x, reporters: x.reporters.union(Set(by)) }
    else if (kind == "abuse") { ...x, msgs: x.msgs + 1 }
    else { ...x, other: x.other + 1 }

  // network.ts dropMember (scheduled items: handleDrop; a date closes, a plan goes on without them). A
  // probing item (OPEN_STAGES, W3-232) loses the member: replaceOrClose / planOut; the model has no alternates,
  // so a probing 1:1 closes and a probing plan goes on while two are left.
  pure def dropOpps(opps: str -> Opp, m: Mid): str -> Opp =
    OPP_IDS.mapBy(k => {
      val o = opps.get(k)
      if (o.stage == "scheduled" and o.going.contains(m))
        if (o.kind == "date" or o.going.exclude(Set(m)).size() < 2) { ...o, stage: "closed", closedBy: "dropped" }
        else { ...o, going: o.going.exclude(Set(m)) }
      else if (o.stage == "probing" and o.parts.contains(m))
        if (o.kind == "date" or o.parts.exclude(Set(m)).size() < 2) { ...o, stage: "closed", closedBy: "dropped" }
        else { ...o, parts: o.parts.exclude(Set(m)) }
      else o
    })

  // trust.ts add, with relevel and the Network's onEvent (caseEvent) and onChange (onTrustChange).
  // A points event restarts the decay clock (SD-141). `notice`: "reply" in the member's own turn, "safety"
  // outside it, "none" when no notice reaches them; the send kind is outboundKind's (SD-475, W3-225).
  pure def addPts(st: State, m: Mid, pts: int, kind: str, by: Mid, notice: str): State = {
    val s1 = addPtsCore(st, m, pts, kind, by, notice)
    val inv = st.invitedBy.get(m)
    // network.ts onTrustChange inviter accountability: when an invitee reaches hold, the inviter (a member of the
    // same Network) loses invites for 30 days and takes 1 point (invitee_held). The inviter's own hold would
    // cascade to its inviter; the model's invite chain has one link (W3-229).
    if (st.trust.get(m).level != "hold" and s1.trust.get(m).level == "hold" and inv != NOBODY and s1.live.get(inv))
      { ...addPtsCore(s1, inv, 1, "invitee_held", m, "safety"), invitesBlockedUntil: s1.invitesBlockedUntil.set(inv, s1.now + 30) }
    else s1
  }
  pure def addPtsCore(st: State, m: Mid, pts: int, kind: str, by: Mid, notice: str): State = {
    val t = st.trust.get(m)
    val score2 = t.score + pts
    val prev = t.level
    val nxt = if (prev == "hold" or score2 >= HOLD) "hold" else if (score2 >= WATCH) "watch" else "ok"
    val t2 = { ...t, rec: true, score: score2, lastDecay: if (pts > 0 or t.lastDecay < 0) st.now else t.lastDecay, level: nxt }
    val c1 = caseAfter(st.caseSt.get(m), kind)
    val c2 = if (nxt == "hold" and prev != "hold") "held" else c1
    val s1 = {
      ...st,
      trust: st.trust.set(m, t2),
      caseSt: st.caseSt.set(m, c2),
      watchSince: if (nxt == "watch" and prev == "ok") st.watchSince.set(m, st.now) else st.watchSince,
      src: if (pts > 0) st.src.set(m, srcAdd(st.src.get(m), kind, by)) else st.src,
    }
    val s2 = if (nxt != prev and nxt != "ok") { ...s1, opps: dropOpps(s1.opps, m) } else s1
    if (nxt == "hold" and prev != "hold") {
      ...s2,
      heldMids: s2.heldMids.union(Set(m)),
      autoHeldP: if (kind == "staff_hold") s2.autoHeldP else s2.autoHeldP.union(Set((m.p, m.app))),
      holdNotices: if (notice == "none") s2.holdNotices else s2.holdNotices.union(Set((m, holdNoticeKind(notice == "reply")))),
    } else s2
  }

  // network.ts caseEvent: a case event with no points (report_received with 0 points, minor_reported, relay_block)
  pure def caseEv(st: State, m: Mid, kind: str): State = { ...st, caseSt: st.caseSt.set(m, caseAfter(st.caseSt.get(m), kind)) }

  // network.ts minorReported: a case event, the person minor signal (onMinorSignal, runtime.ts writeUnit,
  // platform.person_minor_signals), then the minor flags and dropMember of each member of the person. The other apps
  // apply the signal at their next unit (syncRecord reads snapshot.ts minorSignalAt), before any match or send.
  pure def minorReported(st: State, t: Mid): State = {
    val s1 = caseEv(st, t, "minor_reported")
    liveMidsOf(s1, t.p).union(Set(t)).fold(s1, (acc, x) =>
      if (acc.minorF.get(x)) acc
      else { ...acc, minorF: acc.minorF.set(x, true), minorP: acc.minorP.union(Set((x.p, x.app))), opps: dropOpps(acc.opps, x) })
  }

  // network.ts fileReport (the caller, applyBlock or recordMeetingSafetyReport, writes or asks for the case event).
  // Ghost `counted`: the reporters trust.ts report says count once per target (credible, met).
  pure def fileReport(st: State, rep: Mid, sub: Mid, kind: str, source: str, met: bool, intended: bool, meant: str): State = {
    val rt = st.trust.get(rep)
    val cred = credibleT(rt, st.now) and not(st.banned.contains(rep.p))
    val r: Report = {
      reporter: rep, reporterP: rep.p, origReporter: rep, subject: sub, kind: kind, met: met, source: source, status: "open",
      credible: cred, intended: intended, at: st.now, meantP: meant
    }
    val s1 = { ...st, reports: st.reports.union(Set(r)),
               counted: if (credibleT(rt, st.now) and met) st.counted.set(sub, st.counted.get(sub).union(Set(rep))) else st.counted }
    if (reportHeld(s1, sub)) { ...s1, opps: dropOpps(s1.opps, sub) } else s1
  }

  // trust.ts block: a stranger counts once; the window keeps the stranger blocks of the last 14 days and
  // fires +2 each time it holds exactly 3 (W3-230: it can fire again once old blocks leave the window).
  pure def trustBlock(st: State, from: Mid, target: Mid, met: bool): State = {
    val t = st.trust.get(from)
    if (met or t.strangers.contains(target)) st
    else {
      val win = recentBlocks(t, st.now).append(st.now)
      val t2 = { ...t, rec: true, strangers: t.strangers.union(Set(target)), blocksMade: win }
      val s1 = { ...st, trust: st.trust.set(from, t2) }
      if (win.length() == 3) addPts(s1, from, 2, "block_abuse", NOBODY, "reply") else s1
    }
  }

  // trust.ts report: returns the state after the points (0 or 3)
  pure def trustReport(st: State, target: Mid, by: Mid, met: bool): (State, int) = {
    val r = { ...st.trust.get(target), rec: true }
    val b = { ...st.trust.get(by), rec: true }
    val st0 = { ...st, trust: st.trust.set(target, r).set(by, b) }
    if (not(credibleT(b, st.now)) or not(met)) (st0, 0)
    else if (r.reportsFrom.contains(by)) (st0, 0)
    else {
      val r2 = { ...r, reportsFrom: r.reportsFrom.union(Set(by)) }
      val st1 = { ...st0, trust: st0.trust.set(target, r2) }
      if (r2.reportsFrom.size() >= 2 or r2.score > 0) (addPts(st1, target, 3, "report_received", by, "safety"), 3)
      else (st1, 0)
    }
  }

  // callOffPair (the model's name; network.ts applyBlock's close loop) on THIS app: every open item that both are still in closes (a member who
  // said no or dropped out is not going, SD-045). A probing item (OPEN_STAGES) closes when both are asked.
  pure def callOffPair(st: State, app: str, a: str, b: str, how: str): State =
    { ...st, opps: OPP_IDS.mapBy(k => {
      val o = st.opps.get(k)
      val inIt = if (o.stage == "probing") o.parts else o.going
      if (o.app == app and (o.stage == "scheduled" or o.stage == "probing") and inIt.exists(x => x.p == a) and inIt.exists(x => x.p == b))
        { ...o, stage: "closed", closedBy: how, blocker: a, target: b }
      else o
    }) }

  // blockAndReport (the model's name for network.ts applyBlock; the target is known): the "report X" / "block X" text and the check-in
  // report (SD-229). The block becomes a person block in the same save (runtime.ts person_blocks write); the
  // other apps call the pair off at their next tick (SD-025, ghost pendingCallOff).
  pure def blockAndReport(st: State, m: Mid, kind: str, target: Mid, source: str, intended: bool, meant: str): State = {
    val met = metBefore(st, m, target)
    val contextual = m.app == "slop" and m != target and not(st.personBlocks.contains((m.p, target.p))) and
      st.inters.exists(i => i.parts == Set(m, target) and i.at <= st.now and (i.outcome == "completed" or i.outcome == "no_show"))
    val s1 = {
      ...st,
      blocks: st.blocks.union(Set(Set(m, target))),
      personBlocks: st.personBlocks.union(Set((m.p, target.p))),
      contextualBlocks: if (contextual) st.contextualBlocks.union(Set((m, target))) else st.contextualBlocks,
      pendingCallOff: st.pendingCallOff.union(Set((m.p, target.p, m.app))),
      staffCleared: st.staffCleared.filter(x => x.p != target.p),
    }
    val s2 = trustBlock(s1, m, target, met)
    val s3 = callOffPair(s2, m.app, m.p, target.p, "blocked")
    if (kind == "none") s3
    else {
      val tr = trustReport(s3, target, m, met)
      val s4 = if (tr._2 == 0) caseEv(tr._1, target, "report_received") else tr._1
      val s5 = fileReport(s4, m, target, kind, source, met, intended, meant)
      if (kind == "minor") minorReported(s5, target) else s5
    }
  }

  // network.ts forgetMember (leave one app: service.ts forget)
  pure def forget(st: State, m: Mid): State = {
    ...st,
    live: st.live.set(m, false),
    trust: ALL_MIDS.mapBy(x => if (x == m) NO_TRUST else {
      val t = st.trust.get(x)
      { ...t, reportsFrom: t.reportsFrom.exclude(Set(m)), strangers: t.strangers.exclude(Set(m)) }
    }),
    caseSt: st.caseSt.set(m, "none"),
    minorF: st.minorF.set(m, false),
    blocks: st.blocks.filter(b => not(b.contains(m))),
    contextualBlocks: st.contextualBlocks.filter(b => b._1 != m and b._2 != m),
    opps: OPP_IDS.mapBy(k => { val o = st.opps.get(k)
      if (o.parts.contains(m)) { ...o, stage: "deleted" } else o }),
    inters: st.inters.filter(i => not(i.parts.contains(m))),
    // reports about them stay; a reporter who left is not named (reporterId = "")
    reports: st.reports.map(r => if (r.reporter == m) { ...r, reporter: NOBODY } else r),
    restricted: st.restricted.exclude(Set(m)),
    pendingHold: st.pendingHold.exclude(Set(m)),
    pendingWho: st.pendingWho.set(m, NO_WHO),
    relayLog: st.relayLog.filter(x => x._1 != m),
    heldMids: st.heldMids.exclude(Set(m)),
    heldAtLeave: if (lvl(st, m) == "hold") st.heldAtLeave.union(Set(m)) else st.heldAtLeave,
    src: st.src.set(m, NO_SRC),
    counted: ALL_MIDS.mapBy(x => if (x == m) Set() else st.counted.get(x).exclude(Set(m))),
    staffCleared: st.staffCleared.exclude(Set(m)),
    leaving: st.leaving.exclude(Set(m)),
    banning: st.banning.exclude(Set(m)),
    clearing: st.clearing.exclude(Set(m)),
    ageSignals: st.ageSignals.exclude(Set(m)),
  }

  // network.ts holdMember, decideReports: with no report id every open report about them reads "held";
  // with a report id (`onlyRep`: here the reporter's person) only that report does (W3-231).
  pure def holdMember(st: State, m: Mid, notice: str, onlyRep: str): State = {
    val s1 = if (lvl(st, m) != "hold") {
      val sc = st.trust.get(m).score
      addPts(st, m, if (HOLD - sc > 0) HOLD - sc else 1, "staff_hold", NOBODY, notice)
    } else st
    { ...s1, reports: s1.reports.map(r =>
      if (r.subject == m and r.status == "open" and (onlyRep == "" or r.reporterP == onlyRep)) { ...r, status: "held" } else r) }
  }

  // ConsentNetwork.syncMember (network.ts): snapshot.ts maps a durable staff hold to accountStatus
  // "restricted" (durableStaffHoldSnapshotStatus), and syncMember drops a restricted member from the open items
  // that keep them busy (dropMember). It writes no trust hold, no hold notice and no report status: `matchable`
  // excludes a covered member directly.
  pure def sync(st: State, m: Mid): State =
    if (st.live.get(m) and covered(st, m)) { ...st, opps: dropOpps(st.opps, m) } else st

  // network.ts markBanned
  pure def markBanned(st: State, m: Mid): State = {
    val s1 = if (lvl(st, m) != "hold") {
      val sc = st.trust.get(m).score
      addPts(st, m, if (HOLD - sc > 0) HOLD - sc else 1, "staff_hold", NOBODY, "none")
    } else st
    val s2 = { ...s1, opps: dropOpps(s1.opps, m), restricted: s1.restricted.union(Set(m)) }
    { ...s2, reports: s2.reports.map(r => if (r.subject == m and (r.status == "open" or r.status == "held")) { ...r, status: "banned" } else r) }
  }

  // ------------------------------------------------------------------ init
  // Everyone is an adult member of slop; ana and ben are also on peon. cy may join peon later. ana invited cy to
  // slop (network.members.invited_by: only the simulator writes it; production nulls it, runtime.ts, the member row write).
  pure val INIT_LIVE = ALL_MIDS.mapBy(m => m.g == 0 and (m.app == "slop" or m.p != "cy"))
  pure val INVITER: Mid = { app: "slop", p: "ana", g: 0 }
  pure val INVITEE: Mid = { app: "slop", p: "cy", g: 0 }
  action init = s' = {
    now: 0,
    gen: tuples(APPS, PERSONS).mapBy(_ => 0),
    joined: tuples(APPS, PERSONS).mapBy(t => t._1 == "slop" or t._2 != "cy"),
    live: INIT_LIVE,
    trust: ALL_MIDS.mapBy(_ => NO_TRUST),
    minorF: ALL_MIDS.mapBy(_ => false),
    caseSt: ALL_MIDS.mapBy(_ => "none"),
    blocks: Set(),
    personBlocks: Set(),
    contextualBlocks: Set(),
    personHolds: Set(),
    released: Set(),
    opps: OPP_IDS.mapBy(_ => FREE_OPP),
    reports: Set(),
    carriedReports: Set(),
    inters: Set(),
    banned: Set(),
    restricted: Set(),
    pendingHold: Set(),
    pendingWho: ALL_MIDS.mapBy(_ => NO_WHO),
    relayLog: Set(),
    shareGrants: Set(),
    pendingTexts: Set(),
    leaving: Set(),
    banning: Set(),
    clearing: Set(),
    invitedBy: ALL_MIDS.mapBy(m => if (m == INVITEE) INVITER else NOBODY),
    invitesBlockedUntil: ALL_MIDS.mapBy(_ => -1),
    staffHeldP: Set(),
    ageSignals: Set(),
    autoHeldP: Set(),
    minorP: Set(),
    heldMids: Set(),
    heldAtLeave: Set(),
    liftedMids: Set(),
    pendingCallOff: Set(),
    src: ALL_MIDS.mapBy(_ => NO_SRC),
    counted: ALL_MIDS.mapBy(_ => Set()),
    metPairs: Set(),
    wanted: Set(),
    watchSince: ALL_MIDS.mapBy(_ => -1),
    earlyWatchExit: false,
    staffCleared: Set(),
    holdNotices: Set(),
    toldOfBan: Set(),
    lifts: 0,
    lastAction: "init",
  }

  // ------------------------------------------------------------------ actions
  // A reviewed 1:1 date at a New York hour (approvalCheck and the slop review_hold rule). `probe`: the item
  // waits in probing (asked, nobody told yet); `confirm` books it.
  pure def bookable(st: State, m: Mid): bool = matchable(st, m) and not(trustReview(st, m))
  action bookDateAt(k: str, app: str, a: str, b: str, hour: int, probe: bool): bool = {
    val ma = midOf(s, app, a)
    val mb = midOf(s, app, b)
    all {
      a != b, s.opps.get(k).stage == "free",
      bookable(s, ma), bookable(s, mb), not(blockedPair(s, ma, mb)),
      if (probe)
        s' = { ...s,
          opps: s.opps.set(k, { ...FREE_OPP, app: app, kind: "date", parts: Set(ma, mb), stage: "probing", meetingAt: s.now, meetHour: hour }),
          lastAction: "probeDate" }
      else
        s' = { ...s,
          opps: s.opps.set(k, { ...FREE_OPP, app: app, kind: "date", parts: Set(ma, mb), going: Set(ma, mb), told: Set(ma, mb), stage: "scheduled", meetingAt: s.now, meetHour: hour }),
          metPairs: s.metPairs.union(Set((a, b), (b, a))),
          lastAction: "bookDate" },
    }
  }
  action bookDate(k: str, app: str, a: str, b: str): bool = bookDateAt(k, app, a, b, 19, false)

  // Both said yes to the probe: the item is booked and both are told. Booking re-checks the pair and the members
  // (matching_engine models the approval recheck; this model takes it as given).
  action confirm(k: str): bool = {
    val o = s.opps.get(k)
    all {
      o.stage == "probing", o.parts.forall(x => bookable(s, x)),
      o.parts.forall(x => o.parts.forall(y => x == y or not(blockedPair(s, x, y)))),
      s' = { ...s,
        opps: s.opps.set(k, { ...o, stage: "scheduled", going: o.parts, told: o.parts, meetingAt: s.now }),
        metPairs: s.metPairs.union(tuples(o.parts, o.parts).filter(t => t._1 != t._2).map(t => (t._1.p, t._2.p))),
        lastAction: "confirm" },
    }
  }

  // A plan of three, probed anonymously (all contacted); `declined`: c said no and was never told (bookPlan).
  action bookPlan(k: str, app: str, a: str, b: str, c: str, declined: bool): bool = {
    val ma = midOf(s, app, a)
    val mb = midOf(s, app, b)
    val mc = midOf(s, app, c)
    val going = if (declined) Set(ma, mb) else Set(ma, mb, mc)
    all {
      a != b, b != c, a != c, s.opps.get(k).stage == "free",
      bookable(s, ma), bookable(s, mb), bookable(s, mc),
      not(blockedPair(s, ma, mb)), not(blockedPair(s, ma, mc)), not(blockedPair(s, mb, mc)),
      s' = { ...s,
        opps: s.opps.set(k, { ...FREE_OPP, app: app, kind: "plan", parts: Set(ma, mb, mc), going: going, told: going, stage: "scheduled", meetingAt: s.now }),
        metPairs: s.metPairs.union(tuples(going, going).filter(t => t._1 != t._2).map(t => (t._1.p, t._2.p))),
        lastAction: "bookPlan" },
    }
  }

  // The meeting time passes (finalize, in the tick's advance): done. The tick calls a blocked pair's items
  // off before advance (intended; the code's tick has no such call-off, ST-D1), so an item that two blocked people are going to never finalizes.
  // `absent`: who did not come (truth, never read by the code).
  action meet(k: str, absent: Set[Mid]): bool = {
    val o = s.opps.get(k)
    all {
      o.stage == "scheduled", s.now >= o.meetingAt, absent.subseteq(o.going), blockedGoing(s, o) == Set(),
      s' = { ...s, opps: s.opps.set(k, { ...o, stage: "done", absent: absent }), lastAction: "meet" },
    }
  }

  // onFeedback's record: one per answer, about this member (by), at the meeting time (SD-222, SD-442), with the
  // people the booked plan reached (bookedTold, SD-044), and the slot that slotOf reads from it (local time, W3-237).
  pure def recordOf(o: Opp, m: Mid, selfNoShow: bool): Inter =
    { parts: o.told, outcome: if (selfNoShow) "no_show" else "completed", at: o.meetingAt, meetingAt: o.meetingAt, by: m,
      hour: o.meetHour, slot: slotNY(o.meetingAt, o.meetHour) }

  // The answer to the check-in after a meeting (onFeedback). `intent`: what the member means ("fine",
  // "report", "selfNoShow"); `reader`: checkInReport's output (an oracle). After SD-067 a happy answer reads
  // as no report: the corpus evals/network/check-in-reports.jsonl (gate in scripts/sim/evals.ts) checks the
  // reader on direct answers, so the model takes `checkInReaderSound` as a named assumption for this path. The
  // later free text files nothing on this branch (`freeText`).
  // spec/safetyCase.md, "A ban allows only carrier commands and app leave" (inboundAllowedAfterBan): after the
  // ban rows exist, an ordinary text of the person (a check-in answer, a disclosure, block or report, the answer
  // to "Who do you mean?", any other message) is held: no engagement, no flow. STOP, HELP and "leave <app>"
  // still work (leaveStart and leave have no such guard; STOP is in turn_consent).
  pure def inboundOk(st: State, p: str): bool = not(st.banned.contains(p))
  pure def checkInReaderSound(intent: str, reader: str): bool =
    if (intent == "report") REPORT_KINDS.contains(reader) else reader == "none"
  // postDateReports on slop and peon (packs.ts slopHooks, peonHooks), and onFeedback calls
  // recordMeetingSafetyReport for each other person: a block and a report like a "report X" text (blockAndReport:
  // trust points, the call-off of the pair's open items on this app at once and on the other apps at the next tick).
  // Never a report for a plan (onFeedback `!o.plan`): a plan member reports with "report X".
  action checkIn(k: str, m: Mid, intent: str, reader: str): bool = {
    val s0 = sync(s, m)
    val o = s0.opps.get(k)
    val others = o.going.exclude(Set(m))
    val reportKind = if (o.kind == "date") reader else "none"
    val s1 = { ...s0, opps: s0.opps.set(k, { ...o, feedbackFrom: o.feedbackFrom.union(Set(m)) }),
      inters: s0.inters.union(Set(recordOf(o, m, intent == "selfNoShow"))) }
    val s2 = if (reportKind == "none") s1
      else others.fold(s1, (acc, x) => blockAndReport(acc, m, reportKind, x, "check_in", intent == "report", x.p))
    all {
      o.stage == "done", o.going.contains(m), not(o.feedbackFrom.contains(m)), s.live.get(m), inboundOk(s, m.p),
      lvl(s0, m) != "hold",          // a held member's text stops at the hold return
      s.now - o.meetingAt < 7,       // feedbackDue: within 7 days
      intent != "selfNoShow" or o.absent.contains(m),
      checkInReaderSound(intent, reader),
      s' = { ...s2,
        staffCleared: if (intent == "selfNoShow") s2.staffCleared.filter(y => not(o.parts.contains(y))) else s2.staffCleared,
        wanted: if (intent == "report" and o.kind == "date") s2.wanted.union(others.map(x => (m.p, x.p))) else s2.wanted,
        lastAction: "checkIn" },
    }
  }

  // A later free text about a date with no "block" or "report" command ("he scared me", "my boss was so rude").
  // On this branch classify reads it as "other": inbound logs abuse_disclosed (ids and kinds only) and files
  // nothing; a report goes through the "report" command (`report`, `answerWho`). The source branch's
  // lateCheckInReport (SD-220 there, with W3-218 and W3-219) is not on this branch. Whether such a text should
  // open a report is not in the approved specs (spec/safetyCase.md files a report only from explicit report
  // language), so the model files nothing and records no wanted report.
  action freeText(m: Mid): bool = all {
    s.live.get(m), inboundOk(s, m.p),
    s' = { ...sync(s, m), lastAction: "freeText" },
  }

  // "block X" / "report X" (handleBlock, resolveTarget, applyBlock). The target is looked up on the app the text
  // reaches. `ambiguous`: resolveTarget asks "Who do you mean?" (pendingSafety): a name two counterparts share, or a
  // pronoun ("report him") when no booked meeting is ahead (confirmPast: the most recent counterpart is confirmed
  // first). A pronoun with one booked meeting ahead means that counterpart (F23), which the model writes as its
  // name `t`. Intended (`report`, in `step`): a member of several apps whose text names a counterpart reaches the
  // app of the newest meeting with them (SD-250). Code (`reportCode`, not in `step`): route() in service.ts does
  // not read the name; the text goes to the app with the newest open item, else the app that wrote last (any app
  // of the member here), so a "report Ben" can reach an app where Ben is a stranger (SD-250 open).
  // Ghost `wanted`: the member means a person they met; recorded once the member has named that person.
  action reportBy(code: bool, r: str, app: str, t: str, verb: str, kind: str, ambiguous: bool): bool = {
    val rm = midOf(s, app, r)
    val s0 = sync(s, rm)
    val tm = midOf(s0, app, t)
    val mine = APPS.filter(a => s0.live.get(midOf(s0, a, r)))
    val best = mine.fold(-1, (acc, a) => imax(acc, metAtOn(s0, a, r, t)))
    // ghost: the member means the person they met (a booked meeting both were told about and go to)
    val meantMet = APPS.exists(a => usedOpps(s0).exists(o => o.app == a and metPair(o, midOf(s0, a, r), midOf(s0, a, t))))
    val w = if (verb == "report" and meantMet and not(ambiguous)) s0.wanted.union(Set((r, t))) else s0.wanted
    all {
      r != t, s.live.get(rm), inboundOk(s, r),
      code or mine.size() <= 1 or best < 0 or metAtOn(s0, app, r, t) == best,
      // An ask on an app where the member never met t, while they met t on another app, can never file the report:
      // the ghost records the wanted report at once (only the code's route reaches such an app).
      if (ambiguous) s' = { ...s0, pendingWho: s0.pendingWho.set(rm, { asked: true, at: s0.now, verb: verb, kind: kind, target: t }),
                            wanted: if (verb == "report" and meantMet and metAtOn(s0, app, r, t) < 0) s0.wanted.union(Set((r, t))) else s0.wanted,
                            lastAction: "reportAsk" }
      else if (not(s0.live.get(tm))) s' = { ...s0, wanted: w, lastAction: "reportUnresolved" }
      else s' = { ...blockAndReport(s0, rm, if (verb == "report") kind else "none", tm, "message", true, t), wanted: w, lastAction: "report" },
    }
  }
  action report(r: str, app: str, t: str, verb: str, kind: str, ambiguous: bool): bool = reportBy(false, r, app, t, verb, kind, ambiguous)
  action reportCode(r: str, app: str, t: str, verb: str, kind: str, ambiguous: bool): bool = reportBy(true, r, app, t, verb, kind, ambiguous)

  // The answer to "Who do you mean?" within a day (ConsentNetwork.answerWho): the member names `p.target` (or says
  // yes to the one name asked); a report is applied only to a counterpart on this app, a block to any member.
  action answerWho(m: Mid): bool = {
    val s0 = sync(s, m)
    val p = s0.pendingWho.get(m)
    val tm = midOf(s0, m.app, p.target)
    val meantMet = usedOpps(s0).exists(o => metPair(o, m, tm))
    all {
      p.asked, s.live.get(m), inboundOk(s, m.p),
      s.now - p.at <= 1,
      if (s0.live.get(tm) and counterpart(s0, m, tm))
        s' = { ...blockAndReport({ ...s0, pendingWho: s0.pendingWho.set(m, NO_WHO) }, m, if (p.verb == "report") p.kind else "none", tm, "message", true, p.target),
               wanted: if (p.verb == "report" and meantMet) s0.wanted.union(Set((m.p, p.target))) else s0.wanted,
               lastAction: "answerWho" }
      else s' = { ...s0, pendingWho: s0.pendingWho.set(m, NO_WHO), lastAction: "answerWhoNone" },
    }
  }

  // Code only (not in `step`): the answer to "Who do you mean?" ("Sam R.") does not name an app, so route() sends
  // it to the app with the newest open item or the last writer, which can be another app of the member (W3-220
  // open). There it is plain chat; the asking app's pendingSafety lapses after a day and the report is never filed.
  // Intended: the answer reaches the app that asked (`answerWho`).
  action answerWhoElsewhereCode(m: Mid, app: str): bool = {
    val p = s.pendingWho.get(m)
    val other = midOf(s, app, m.p)
    val meantMet = APPS.exists(a => usedOpps(s).exists(o => o.app == a and metPair(o, midOf(s, a, m.p), midOf(s, a, p.target))))
    all {
      p.asked, s.live.get(m), inboundOk(s, m.p), s.now - p.at <= 1, app != m.app, s.live.get(other),
      s' = { ...s, wanted: if (p.verb == "report" and meantMet) s.wanted.union(Set((m.p, p.target))) else s.wanted,
             lastAction: "answerWhoElsewhereCode" },
    }
  }

  // The member's own abusive message (handleAbuse): a clean record takes at most HOLD - 1 points.
  // The classifier assigns WATCH points to an explicit attempt to bypass contact consent (trustLevel.md).
  action abuse(m: Mid, risk: int): bool = {
    val s0 = sync(s, m)
    val clean = s0.trust.get(m).score <= 0
    all {
      s.live.get(m), inboundOk(s, m.p), lvl(s0, m) != "hold",
      s' = { ...addPts(s0, m, if (clean) imin(risk, HOLD - 1) else risk, "abuse", NOBODY, "reply"), lastAction: "abuse" },
    }
  }

  // Staff hold (service.ts NetworkService.hold). `scope`: "*" for staff with safety@* (or admin@*), else the member's app (staff
  // of that app hold here only, W3-231). The person_holds row (person, scope) first (SD-022), then this app's
  // unit, then one unit per other app for "*". `onlyRep`: a hold from one report (reportId) marks only that one.
  action staffHoldBy(m: Mid, scope: str, onlyRep: str): bool = all {
    s.live.get(m), scope == "*" or scope == m.app,
    onlyRep == "" or s.reports.exists(r => r.subject == m and r.status == "open" and r.reporterP == onlyRep),
    // writeStaffHold: on conflict the row's released_apps becomes '{}' (a new global hold covers every app again).
    val s1 = holdMember({ ...s, personHolds: s.personHolds.union(Set((m.p, scope))),
      released: if (scope == "*") s.released.filter(x => x._1 != m.p) else s.released }, m, "safety", onlyRep)
    s' = { ...s1,
      pendingHold: if (scope == "*") liveMidsOf(s, m.p).exclude(Set(m)) else Set(),
      staffHeldP: s1.staffHeldP.union(Set((m.p, scope))),
      lastAction: "staffHold" },
  }
  action staffHold(m: Mid): bool = staffHoldBy(m, "*", "")
  action staffHoldApply(x: Mid): bool = all {
    s.pendingHold.contains(x), s.live.get(x),
    s' = { ...holdMember(s, x, "safety", ""), pendingHold: s.pendingHold.exclude(Set(x)), lastAction: "staffHoldApply" },
  }
  // The service process stops between two awaits; nothing resumes a loop (the next unit or tick of the other app
  // applies a person hold; a stopped ban waits for the staff retry, W3-232).
  action crash: bool = all {
    s.pendingHold != Set() or s.banning != Set() or s.clearing != Set() or s.leaving != Set(),
    s' = { ...s, pendingHold: Set(), banning: Set(), clearing: Set(), leaving: Set(), lastAction: "crash" },
  }

  // Staff lift a hold on one app: NetworkService.liftHold (service.ts) is ONE unit of work. Inside it the service
  // reads the person's staff_safety_holds rows (currentStaffHold: this app's row and the global row unless this
  // app is in its released_apps), refuses a global hold without safety on every app (durableStaffHoldLiftAllowed,
  // needs_safety_everywhere: nothing changes), and runs ConsentNetwork.liftHold(member, actor, note, durable).
  // That gives holdLiftResult(actor, runtimeHeld || durable): not_on_hold when neither (nothing changes). A held
  // member is lifted by trust.lift (score 0, level ok); the open case, if any, is marked lifted. The member
  // command liftStaffHold reads the rows again under the person lock and throws StaffHoldStateChanged
  // (hold_changed, the whole unit rolls back) when they changed; it deletes this app's row and adds this app to
  // released_apps of the global row. The global row keeps covering every other app, also apps where the person
  // is not a member now. Because the unit is atomic and compare-and-set, a staff hold that lands during the lift
  // either commits first (and the lift reads it) or makes the lift answer hold_changed: the model has one step.
  pure def liftOf(st: State, m: Mid, scope: str): State = {
    val t = st.trust.get(m)
    val runtimeHeld = t.level == "hold"
    val local = st.personHolds.contains((m.p, m.app))
    val global = st.personHolds.contains((m.p, "*")) and not(st.released.contains((m.p, m.app)))
    // ghost: the staff decision. A lift by safety@* staff ends the hold on this app and keeps the others; a lift
    // by staff of one app ends that app's hold only and never a hold on every app.
    val ghostAll = st.staffHeldP.contains((m.p, "*"))
    val ghost = st.staffHeldP.exclude(Set((m.p, m.app)))
    val ghost2 = if (ghostAll and scope == "*") ghost.exclude(Set((m.p, "*"))).union(APPS.exclude(Set(m.app)).map(a => (m.p, a))) else ghost
    val c = st.caseSt.get(m)
    val st1 = { ...st,
      personHolds: st.personHolds.exclude(Set((m.p, m.app))),
      released: if (global) st.released.union(Set((m.p, m.app))) else st.released,
      staffHeldP: ghost2,
      staffCleared: st.staffCleared.union(Set(m)),
      lifts: st.lifts + 1,
      lastAction: "lift" }
    if (runtimeHeld) { ...st1,
      trust: st1.trust.set(m, { ...t, score: 0, level: "ok", reportsFrom: Set(), lastDecay: st.now }),
      // trust.lift's hold_lifted event opens a case when none is open (caseEvent), and liftHold then marks the
      // open case "lifted": the case ends "lifted".
      caseSt: st1.caseSt.set(m, "lifted"),
      heldMids: st1.heldMids.exclude(Set(m)),
      liftedMids: st1.liftedMids.union(Set(m)),
      autoHeldP: st1.autoHeldP.exclude(Set((m.p, m.app))),
      minorP: st1.minorP.exclude(Set((m.p, m.app))),
      counted: st1.counted.set(m, Set()),
      src: st1.src.set(m, NO_SRC) }
    // A durable hold and no runtime hold: ok, and only an open case is marked lifted (no hold_lifted event).
    else { ...st1, caseSt: if (c == "open" or c == "held") st1.caseSt.set(m, "lifted") else st1.caseSt }
  }
  action liftHoldBy(m: Mid, scope: str): bool = {
    val local = s.personHolds.contains((m.p, m.app))
    val global = s.personHolds.contains((m.p, "*")) and not(s.released.contains((m.p, m.app)))
    all {
      s.live.get(m), scope == "*" or scope == m.app,
      not(global and scope != "*"),                    // needs_safety_everywhere (refused: nothing changes)
      lvl(s, m) == "hold" or local or global,          // else not_on_hold (refused: nothing changes)
      s' = liftOf(s, m, scope),
    }
  }
  action liftHold(m: Mid): bool = liftHoldBy(m, "*")

  // Staff close a case (network.ts closeCase): a held member stays held.
  action closeCase(m: Mid): bool = all {
    s.live.get(m), s.caseSt.get(m) != "none", s.caseSt.get(m) != "closed",
    s' = { ...s, caseSt: s.caseSt.set(m, "closed"),
           staffCleared: if (lvl(s, m) != "hold") s.staffCleared.union(Set(m)) else s.staffCleared,
           lastAction: "closeCase" },
  }

  // Staff dismiss a report (network.ts dismissReport).
  action dismiss(r: Report): bool = all {
    s.reports.contains(r), r.status == "open",
    val resolved = { ...s, reports: s.reports.exclude(Set(r)).union(Set({ ...r, status: "dismissed" })),
      carriedReports: s.carriedReports.exclude(Set(reportIdentity(r))), lastAction: "dismiss" }
    s' = if (s.live.get(r.subject)) caseEv(resolved, r.subject, "report_dismissed") else resolved,
  }

  // Staff clear a minor signal (service.ts NetworkService.clearMinor): one unit per app of the person ("*" staff) or this
  // app only, one network at a time (W3-232). Each unit: clearMinorSignal and dismiss the open minor reports.
  action clearMinorStart(m: Mid, scope: str): bool = all {
    s.live.get(m), s.clearing == Set(), scope == "*" or scope == m.app,
    s.minorP.exists(x => x._1 == m.p) or s.ageSignals.exists(x => x.p == m.p),
    s' = { ...s, clearing: liveMidsOf(s, m.p).filter(x => scope == "*" or x.app == m.app), lastAction: "clearMinorStart" },
  }
  action clearMinorApply(x: Mid): bool = all {
    s.clearing.contains(x), s.live.get(x),
    s' = { ...s,
      minorF: s.minorF.set(x, false),
      reports: s.reports.map(r => if (r.subject == x and r.kind == "minor" and r.status == "open") { ...r, status: "dismissed" } else r),
      minorP: s.minorP.exclude(Set((x.p, x.app))),
      ageSignals: s.ageSignals.exclude(Set(x)),
      clearing: s.clearing.exclude(Set(x)),
      lastAction: "clearMinorApply" },
  }

  // Ban by person (service.ts NetworkService.ban): ban rows, suppression, restricted platform memberships, then one unit per app
  // (markBanned, then network.members.account_status = 'restricted'). No person_holds row is written (W3-223), and
  // matching reads network.members, so an app the loop has not reached yet is still matchable. A retry runs when
  // a member is not restricted (banUnfinished). No notice to past contacts exists (SD-253, founder decision).
  action banStart(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      s.banning == Set(), ms != Set(),
      not(p.in(s.banned)) or ms.exists(x => not(s.restricted.contains(x))),
      // spec/safetyCase.md, "A ban allows only carrier commands and app leave": the ban rows, the revocation of
      // the person's share grants and the delete of the number's pending texts are one transaction (pg-store addBan).
      s' = { ...s, banned: s.banned.union(Set(p)), banning: ms.filter(x => not(s.restricted.contains(x))),
             shareGrants: s.shareGrants.exclude(Set(p)), pendingTexts: s.pendingTexts.exclude(Set(p)), lastAction: "banStart" },
    }
  }
  action banApply(x: Mid): bool = all {
    s.banning.contains(x), s.live.get(x),
    s' = { ...markBanned(s, x), banning: s.banning.exclude(Set(x)), lastAction: "banApply" },
  }
  // The whole ban with no stop (run tests only).
  action ban(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      not(p.in(s.banned)), ms != Set(),
      s' = { ...ms.fold(s, (acc, x) => markBanned(acc, x)), banned: s.banned.union(Set(p)),
             shareGrants: s.shareGrants.exclude(Set(p)), pendingTexts: s.pendingTexts.exclude(Set(p)), lastAction: "ban" },
    }
  }

  // A profile share (Accounts.share): the share request stores a pending text that waits for the member's yes,
  // and the yes writes the grant. Both take the person's profile-share lock, which the ban transaction also
  // takes, and read the ban first: a banned person gets no pending share and no grant.
  action shareAsk(p: str): bool = all {
    inboundOk(s, p), liveMidsOf(s, p) != Set(), not(s.pendingTexts.contains(p)),
    s' = { ...s, pendingTexts: s.pendingTexts.union(Set(p)), lastAction: "shareAsk" },
  }
  action shareYes(p: str): bool = all {
    inboundOk(s, p), s.pendingTexts.contains(p),
    s' = { ...s, pendingTexts: s.pendingTexts.exclude(Set(p)), shareGrants: s.shareGrants.union(Set(p)), lastAction: "shareYes" },
  }

  // App leave begins with consent. Keep the historical standalone minor-signal abstraction.
  // Committed hard holds and exact open reports use current state at the atomic forget.
  action leaveStart(app: str, p: str): bool = {
    val m = midOf(s, app, p)
    val rows = if (lvl(s, m) != "hold" and s.minorF.get(m)) s.personHolds.union(Set((p, app))) else s.personHolds
    all { s.live.get(m), not(s.leaving.contains(m)), s' = { ...s, personHolds: rows, leaving: s.leaving.union(Set(m)), lastAction: "leaveStart" } }
  }
  pure def retainHardHold(st: State, m: Mid): State =
    if (lvl(st, m) == "hold" and not(covered(st, m) or st.banned.contains(m.p)))
      { ...st, personHolds: st.personHolds.union(Set((m.p, m.app))) }
    else st
  pure def retainOpenReports(st: State, m: Mid): State = { ...st,
    carriedReports: st.carriedReports.union(st.reports.filter(r => r.subject == m and urgentOpen(r)).map(reportIdentity)) }

  action leaveFinish(m: Mid): bool = all {
    s.leaving.contains(m), s.live.get(m),
    s' = { ...forget(retainOpenReports(retainHardHold(s, m), m), m), lastAction: "leaveFinish" },
  }
  // The leave with nothing between the two steps (run tests only).
  action leave(app: str, p: str): bool = {
    val m = midOf(s, app, p)
    val rows = if (lvl(s, m) != "hold" and s.minorF.get(m)) s.personHolds.union(Set((p, app))) else s.personHolds
    all { s.live.get(m), s' = { ...forget(retainOpenReports(retainHardHold({ ...s, personHolds: rows }, m), m), m), lastAction: "leave" } }
  }

  // A join by text: a banned person is refused; a hold does not refuse a join (PRD 40.3). A former member gets
  // a new member id. A person hold covers the new member (snapshot), and the next unit holds them. An open person
  // minor signal (snapshot.ts minorSignalAt) makes the new member a minor at its first unit (syncRecord).
  action join(app: str, p: str): bool = {
    val cur = midOf(s, app, p)
    val again = s.joined.get((app, p))
    val g2 = if (again) cur.g + 1 else cur.g
    val m2 = { app: app, p: p, g: g2 }
    val inherited = s.minorP.exists(x => x._1 == p)
    all {
      not(s.live.get(cur)), not(p.in(s.banned)), g2 <= 1,
      s' = { ...s,
        gen: s.gen.set((app, p), g2), joined: s.joined.set((app, p), true),
        live: s.live.set(m2, true), trust: s.trust.set(m2, NO_TRUST), minorF: s.minorF.set(m2, inherited), caseSt: s.caseSt.set(m2, "none"),
        minorP: if (inherited) s.minorP.union(Set((p, app))) else s.minorP,
        lastAction: "join" },
    }
  }

  // A relayed message inside a date (RelayDesk.apply): pass, hold (staff relay queue), a block for the form
  // (party, consent, format, photo) or a block for the sender's own words (the engine's harass_severe,
  // llm_severe, clef_severe reasons). Intended (`relaySend`, in `step`): a block for the sender's own words writes
  // a 0-point case event relay_block:<families> on the sender (SD-254). Code (`relaySendCode`, not in `step`):
  // RelayDesk.apply logs the record and answers "refused"; nothing on this branch writes a case event for it
  // (SD-254 open). `ageSig`: the sender's own text carried a minor self-disclosure (engine relay.ts ageSignal).
  // The record keeps the flag and stepRelay drops the text, but nothing in the Network or the service reads it
  // (ST-D2, W3-232, W3-237).
  action relaySendBy(code: bool, k: str, m: Mid, decision: str, ageSig: bool): bool = {
    val o = s.opps.get(k)
    all {
      o.kind == "date", o.stage == "scheduled" or o.stage == "done", o.going.contains(m), s.live.get(m),
      s' = { ...(if (decision == "blockSevere" and not(code)) caseEv(s, m, "relay_block") else s),
             relayLog: s.relayLog.union(Set((m, decision))),
             ageSignals: if (ageSig) s.ageSignals.union(Set(m)) else s.ageSignals,
             lastAction: "relaySend" },
    }
  }
  action relaySend(k: str, m: Mid, decision: str, ageSig: bool): bool = relaySendBy(false, k, m, decision, ageSig)
  action relaySendCode(k: str, m: Mid, decision: str, ageSig: bool): bool = relaySendBy(true, k, m, decision, ageSig)

  // trust.ts decay. Each drop is a negative `decay` trust event; caseEvent adds it to a live case only and
  // never changes the case phase (spec/safetyCase.md recordCaseEvent with decayEvent), so caseSt is unchanged.
  pure def decayOne(t: Trust, now: int): Trust =
    if (t.lastDecay < 0) { ...t, lastDecay: now }
    else {
      val steps = (now - t.lastDecay) / DECAY_DAYS
      if (steps <= 0) t
      else {
        val t1 = { ...t, lastDecay: t.lastDecay + steps * DECAY_DAYS }
        if (t.level == "hold" or t.score <= 0) t1
        else {
          val sc = imax(0, t.score - steps)
          { ...t1, score: sc, level: if (sc >= WATCH) "watch" else "ok" }
        }
      }
    }

  // The tick of every app (network.ts tick): personHold for every covered member (SD-022), callOffPair for every
  // blocked edge in the snapshot (SD-025, ST-D1; the code closes with reason "blocked", labelled "blocked_elsewhere"
  // here so that the witness can tell the tick's call-off apart), then trust.decay(now).
  action tick(d: int): bool = {
    val now2 = s.now + d
    val s1 = ALL_MIDS.fold({ ...s, now: now2 }, (acc, m) => sync(acc, m))
    val s2 = APPS.fold(s1, (acc, a) => s1.personBlocks.fold(acc, (acc2, e) => callOffPair(acc2, a, e._1, e._2, "blocked_elsewhere")))
    val trust2 = ALL_MIDS.mapBy(m => if (s2.live.get(m) and s2.trust.get(m).rec) decayOne(s2.trust.get(m), now2) else s2.trust.get(m))
    val early = ALL_MIDS.exists(m => s2.trust.get(m).level == "watch" and trust2.get(m).level == "ok" and now2 - s2.watchSince.get(m) < DECAY_DAYS)
    all {
      now2 <= MAX_DAY,
      s' = { ...s2, trust: trust2, pendingCallOff: Set(), earlyWatchExit: s2.earlyWatchExit or early, lastAction: "tick" },
    }
  }

  action step = {
    nondet k = OPP_IDS.oneOf()
    nondet app = APPS.oneOf()
    nondet a = PERSONS.oneOf()
    nondet b = PERSONS.oneOf()
    nondet c = PERSONS.oneOf()
    nondet m = ALL_MIDS.oneOf()
    nondet flag = Set(true, false).oneOf()
    nondet flag2 = Set(true, false).oneOf()
    nondet verb = Set("block", "report").oneOf()
    nondet kind = REPORT_KINDS.oneOf()
    nondet intent = Set("fine", "report", "selfNoShow").oneOf()
    nondet reader = Set("none", "harassment", "no_show", "minor").oneOf()
    nondet risk = Set(1, 2, 3, 6).oneOf()
    nondet d = Set(1, 6, 13, 14).oneOf()
    nondet hour = HOURS.oneOf()
    nondet scope = Set("*", m.app).oneOf()
    nondet onlyRep = Set("", a).oneOf()
    nondet decision = Set("pass", "hold", "block", "blockSevere").oneOf()
    nondet absent = s.opps.get(k).going.powerset().oneOf()
    any {
      bookDateAt(k, app, a, b, hour, flag),
      confirm(k),
      bookPlan(k, app, a, b, c, flag),
      meet(k, absent),
      checkIn(k, m, intent, reader),
      freeText(m),
      report(a, app, b, verb, kind, flag),
      answerWho(m),
      abuse(m, risk),
      staffHoldBy(m, scope, onlyRep),
      staffHoldApply(m),
      crash,
      liftHoldBy(m, scope),
      closeCase(m),
      all { s.reports != Set(), nondet r = s.reports.oneOf() dismiss(r) },
      clearMinorStart(m, scope),
      clearMinorApply(m),
      banStart(a),
      banApply(m),
      shareAsk(a),
      shareYes(a),
      leaveStart(app, a),
      leaveFinish(m),
      join(app, a),
      relaySend(k, m, decision, flag2),
      tick(d),
    }
  }

  // ------------------------------------------------------------------ invariants (rules, not code)
  // A report that the code counts toward a hold: open, met, urgent (reportHeld, network.ts reportHeld).
  pure def urgentOpen(r: Report): bool = r.status == "open" and r.met and URGENT.contains(r.kind)
  // The rule's reporter in good standing (ghosts): not banned, not on hold now, and did not leave while on hold.
  pure def standing(st: State, r: Report): bool =
    not(st.banned.contains(r.reporterP)) and not(st.heldMids.contains(r.reporter)) and not(st.heldAtLeave.contains(r.origReporter))

  // PRD 40.3 (docs/prd-snapshot.md:1777) "A safety removal holds the person everywhere ... a safety hold alone
  // does not refuse a join, but the person cannot be matched until staff resolve it"; admin-console 3.7.1
  // "Hold (the person, on every app, until a review)". A staff hold holds every live member of the person.
  // SD-021 (leave and rejoin), SD-022 (join during a hold, the non-atomic loop): fixed in 059965d. W3-226,
  // W3-435: the ghost is (person, scope); a lift on one app keeps the person's other apps under the rule, so a
  // lift that drops the "*" row with no per-app rows is visible (W3-644: service.ts liftHold reads it outside the
  // transaction). A hold by staff of one app holds that app only (W3-231).
  val staffHoldFollowsPerson = s.staffHeldP.forall(h =>
    liveMidsOf(s, h._1).filter(x => h._2 == "*" or x.app == h._2).forall(x => not(matchable(s, x))))

  // trust.ts "hold - ... staff review". An automatic hold (reports, abuse) on an app keeps the person's
  // member on that app out of matching across a leave and a rejoin until staff decide (SD-021, fixed).
  val autoHoldFollowsPersonInApp = s.autoHeldP.forall(h => APPS.filter(a => a == h._2).forall(a => {
    val x = midOf(s, a, h._1)
    s.live.get(x) implies not(matchable(s, x))
  }))

  // Founder decision 1 (AGENTS.md): "Age is a person-level fact"; minors are never matched. A minor report on
  // an app keeps the person's member on that app out of matching across a leave and a rejoin, until staff
  // clear it or lift the carried-over hold (SD-021, fixed).
  val minorSignalFollowsPersonInApp = s.minorP.forall(h => {
    val x = midOf(s, h._2, h._1)
    s.live.get(x) implies not(matchable(s, x))
  })

  // PRD 36.3 / 1446 "an automatic safety hold on the reported member's opportunities until reviewed". An open
  // urgent report keeps the person's member on that app out of matching until its exact disposition.
  // The historical live-member branch abstracts reporter standing. The carried branch uses the committed report.
  val urgentMetReportBlocksMatchingInApp = s.reports.forall(r => urgentOpen(r) implies {
    val x = midOf(s, r.subject.app, r.subject.p)
    (s.live.get(x) and ((x == r.subject and standing(s, r)) or s.carriedReports.contains(reportIdentity(r)))) implies not(matchable(s, x))
  })

  // trust.ts "Holds never decay; only a person lifts them."
  val holdOnlyLiftedByStaff = s.heldMids.forall(m => s.live.get(m) implies lvl(s, m) == "hold")

  // trust.ts "one person, or strangers who know a first name, can never put someone on hold";
  // a clean record takes at most HOLD - 1 points from one message.
  val noSingleActorHold = ALL_MIDS.forall(m => (s.live.get(m) and lvl(s, m) == "hold" and not(s.src.get(m).staff)) implies {
    val x = s.src.get(m)
    x.msgs + x.reporters.size() + x.other >= 2
  })

  // trust.ts "a serial reporter's ... reports don't count"; a banned member is "never matched or
  // contacted again". A reporter on hold or banned cannot take someone out of matching. SD-072 (fixed in
  // ab4ff2a). Two paths reset the reporter's standing that the fix reads (the trust level): a leave and a staff
  // lift of a banned member. They are the separate value `reporterStandingKept` below (NEW-2).
  val reporterNotHeld = ALL_MIDS.forall(m => (s.live.get(m) and reportHeld(s, m)) implies
    s.reports.exists(r => r.subject == m and urgentOpen(r) and (r.reporter == NOBODY or
      (not(s.heldMids.contains(r.reporter)) and (not(s.banned.contains(r.reporterP)) or s.liftedMids.contains(r.reporter))))))

  // PRD 40.3 "Blocks are person to person and apply in every app"; PRD F23 "Block takes effect immediately".
  // No booked item that two blocked people are going to: on the app of the block at once, on every other app
  // at its next tick (callOffPair in the tick, before any meeting finalizes). ST-D1 and ST-D7 are fixed.
  val blockClosesAllApps = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    (o.stage == "scheduled" or o.stage == "probing") implies blockedGoing(s, o).forall(t =>
      s.pendingCallOff.exists(e => e._3 != o.app and Set(e._1, e._2) == Set(t._1.p, t._2.p)))
  })

  // PRD F23 "Block ... only affects the pair". A block calls an item off only when the blocker and the target
  // are both going to it: a member who said no to a plan does not call it off for the others. SD-045 (fixed
  // in df588c8). The stricter "nobody else is going" form is `blockLeavesOthersPlan` below (NEW-3).
  // Compared 2026-11-18: an item closed while it was probing (nobody told yet) counts its asked members, as
  // callOffPair and network.ts applyBlock do (a member who said no is replaced or removed from the participants).
  val blockOnlyAffectsPair = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    val inIt = if (o.told == Set()) o.parts else o.going
    val closedByBlock = o.closedBy == "blocked" or o.closedBy == "blocked_elsewhere"
    closedByBlock implies (inIt.exists(x => x.p == o.blocker) and inIt.exists(x => x.p == o.target))
  })

  // metBefore doc "Anonymous probes do not count: neither knew who the other was"; trust.ts "only when the
  // reporter shared an opportunity with the target". SD-044 (fixed in f8d9de8).
  val metIsReal = s.reports.forall(r => r.met implies s.metPairs.contains((r.reporterP, r.subject.p)))

  // reports.ts "A plain 'it was fine' or 'not my type' is not a report." A check-in report, block and minor
  // flag come only from an answer that reports something. SD-067 (the reader is an oracle here, and the corpus
  // gate checks the reader). W3-224 and W3-219 were defects of the source branch's late path; on this branch a
  // later free text files nothing (`freeText`, w3_219VentingTest).
  val checkInReportIntended = s.reports.forall(r => r.source == "check_in" implies r.intended)

  // PRD F23 "'report' from any channel"; reports.ts a report is about the person the member names; trust.ts
  // the reporter "shared an opportunity with the target". A report (and its block and hold) names the person
  // the member means, not the partner of their newest date. On this branch a pronoun with no date ahead is
  // confirmed first (resolveTarget confirmPast, w3_218PronounConfirmedTest).
  val reportSubjectMeant = s.reports.forall(r => r.meantP == r.subject.p)

  // AGENTS.md 2026-10-09 item 3 "Bans are by phone number"; network.ts markBanned "never matched or contacted
  // again". Every live member of a banned person is out of matching from the moment the ban row exists. The
  // canonical matching snapshot covers an app whose runtime has not applied its own restriction (W3-223).
  val bannedNeverMatchable = s.banned.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

  // spec/safetyCase.md, "A ban allows only carrier commands and app leave" (upstream PR #496): a banned person has
  // no live profile-share grant and no pending text flow; the ban transaction removes both and a share reads the ban.
  val banRevokesShares = s.banned.forall(p => not(s.shareGrants.contains(p)) and not(s.pendingTexts.contains(p)))

  // AGENTS.md founder decision 1 "Minors (13-17) are never matched"; "Age is a person-level fact (the lowest age
  // ever stated or recorded wins)"; engine relay.ts "the platform re-checks the person's lowest age". A
  // member whose own relayed text says they are a minor is out of matching until staff clear it (W3-232,
  // W3-237: nothing reads RelayRecord.ageSignal).
  val relayAgeSignalReachesAgePolicy = s.ageSignals.forall(m => s.live.get(m) implies not(matchable(s, m)))

  // "report X" and the check-in are both reports; trust.ts report: each credible reporter who met them counts
  // once per target. SD-229 is fixed: a check-in report adds trust points (sd229CheckInCountedTest).
  val reportersCounted = ALL_MIDS.forall(m => s.live.get(m) implies s.counted.get(m).subseteq(s.trust.get(m).reportsFrom))

  // trust.ts "Watch lasts until the score decays below 3: 14 days from 3". SD-141 (fixed in db176ce).
  val watchLasts14Days = not(s.earlyWatchExit)

  // network.ts o.post "came: !f.selfNoShow": a no-show counts against the person who did not come. SD-222
  // (fixed in 581888d).
  val noShowCountsAbsentOnly = ALL_MIDS.forall(m => s.live.get(m) implies
    noShows(s, m) <= OPP_IDS.filter(k => s.opps.get(k).absent.contains(m) and s.opps.get(k).stage != "deleted").size())

  // profile.ts attendedSlots are the slots the member attended: the meeting's slot, not the answer's, in the
  // member's local time. SD-442 (fixed in 581888d); W3-237 (fixed 2026-11-22: slotOf reads localParts).
  val slotFromMeeting = s.inters.forall(i => i.outcome == "completed" implies i.slot == slotNY(i.meetingAt, i.hour))

  // PRD F23 "'report' from any channel ... Reports create a safety case"; the slop and peon check-in copy. A
  // report about someone the member met is filed, as met, whatever app the message comes in on. SD-221 is fixed. Open on this
  // branch: SD-250 (`reportCode`, sd250CodeRoutedElsewhereTest,
  // w3_220ReportRoutedElsewhereTest) and W3-220 (`answerWhoElsewhereCode`, w3_220WhoAnswerRoutedElsewhereTest).
  val everyMetReportFiled = s.wanted.forall(w =>
    s.reports.exists(r => r.reporterP == w._1 and r.subject.p == w._2 and r.met))

  // PRD 1420 "moderation holds on relay messages" in the safety console; PRD F23 reports go to a safety case.
  // A relay message blocked for the sender's own words (a threat, a slur) reaches the sender's safety case.
  // SD-254 is open on this branch: `relaySendCode` writes no case event (sd254CodeNoCaseTest).
  val relayBlockReachesSafety = s.relayLog.forall(x => (x._2 == "blockSevere" and s.live.get(x._1)) implies s.caseSt.get(x._1) != "none")

  // network.ts timingOf: a "safety" notice goes "now"; blooio outbound-queue.ts quiet hours apply to
  // "transactional". A hold notice is never queued as transactional. SD-475 (fixed in 49602b7).
  val safetyNoticeImmediate = s.holdNotices.forall(x => x._2 != "transactional")

  // SD-074, minor part (W3-236; in scope: AGENTS.md founder decision 1, "Age is a person-level fact", minors
  // are never matched "in any app"). A minor report on one app keeps the person out of matching on every app.
  val minorSignalFollowsPerson = s.minorP.forall(h => liveMidsOf(s, h._1).forall(x => not(matchable(s, x))))

  // SD-027, visibility part (W3-235). trust.ts "hold - ... staff review"; PRD 1420 the safety console lists
  // "members on watch and hold with the events that caused it". A member that the slop trust_review rule keeps
  // out of matching has an open (or held) safety case.
  val engineHoldVisible = ALL_MIDS.forall(m => (s.live.get(m) and trustReview(s, m)) implies Set("open", "held").contains(s.caseSt.get(m)))

  // SD-027, block part (W3-235). trust.ts "strangers who know a first name can never put someone on hold";
  // network-consent-14 blocks of people you never met count against the blocker, not the target. The
  // trust_review rule by blocks needs two blockers with a settled encounter before the block.
  pure def metBlockers(st: State, m: Mid): int = PERSONS.filter(q => st.personBlocks.contains((q, m.p)) and st.metPairs.contains((q, m.p))).size()
  val strangersCannotEngineHold = ALL_MIDS.forall(m => (s.live.get(m) and m.app == "slop" and blockedBy(s, m) >= 2
    and not(noShows(s, m) >= 2 and noShows(s, m) > dates(s, m))) implies metBlockers(s, m) >= 2)

  // NEW-2 (W3-234: in scope as a security defect with a trace). reportHeld reads the reporter's trust level. A
  // reporter on hold who then leaves the app (forget blanks reporterId, network.ts forgetMember, and trust.level("") is
  // "ok"), or a banned reporter whose hold staff lift (service.ts liftHold does not check the ban), makes
  // the report hold its subject again.
  val reporterStandingKept = ALL_MIDS.forall(m => (s.live.get(m) and reportHeld(s, m)) implies
    s.reports.exists(r => r.subject == m and urgentOpen(r) and standing(s, r)))

  // Every rule above.
  val safety = and {
    staffHoldFollowsPerson,
    autoHoldFollowsPersonInApp,
    minorSignalFollowsPersonInApp,
    urgentMetReportBlocksMatchingInApp,
    holdOnlyLiftedByStaff,
    noSingleActorHold,
    blockClosesAllApps,
    blockOnlyAffectsPair,
    metIsReal,
    reportersCounted,
    watchLasts14Days,
    noShowCountsAbsentOnly,
    relayBlockReachesSafety,
    safetyNoticeImmediate,
    banRevokesShares,
    // wave 4 rules (code items; see docs/research/quint-findings/safety_trust.md). The ones that fail in the
    // intended design are listed below `safety` (openAgeDefects, reporterStandingDecision).
    bannedNeverMatchable,
    engineHoldVisible,
    strangersCannotEngineHold,
    checkInReportIntended,
    reportSubjectMeant,
    everyMetReportFiled,
    slotFromMeeting,
  }

  // OPEN DEFECTS (2026-11-18), not in safety. relayAgeSignalReachesAgePolicy: nothing in the Network or the
  // service reads RelayRecord.ageSignal (packages/network/src/relay.ts and store.ts only store it), so a member
  // whose own relayed text says they are under 18 stays matchable.
  val openAgeDefects = relayAgeSignalReachesAgePolicy

  // FOUNDER DECISION (spec silent), not in safety. reporterNotHeld and reporterStandingKept (SD-072, W3-234):
  // reportHeld (pendingReportHold, the generated reportRestrictsMatching of spec/safetyCase.md) reads no reporter
  // standing, so a reporter on hold who met the subject takes the subject out of matching (sd072HeldReporterTest,
  // w3_234BannedReporterLiftedTest). The approved rule has no reporter-standing condition, so the code agrees with
  // the approved spec; whether to add one is a founder decision for spec/safetyCase.md.
  val reporterStandingDecision = reporterNotHeld and reporterStandingKept

  // ------------------------------------------------------------------ rules kept out of `safety`
  // Each of these still fails on the code. They are not in `safety` because the fix needs a decision that is
  // not ours to make; the run tests below replay a trace for each.

  // SD-074 (the automatic and report parts are skipped: they need a founder decision). admin-console 4.6 "a hold
  // on any app holds the person everywhere": an automatic hold or an urgent report on one app does not reach the
  // person's other apps (platform.person_holds gets a row only from a staff hold or a leave). It is not clear
  // which staff decision ends such a hold on the other apps.
  val autoHoldFollowsPerson = s.autoHeldP.forall(h => liveMidsOf(s, h._1).forall(x => not(matchable(s, x))))
  val urgentMetReportBlocksMatching = s.reports.forall(r =>
    (urgentOpen(r) and standing(s, r)) implies liveMidsOf(s, r.subject.p).forall(x => not(matchable(s, x))))

  // SD-027 (the staff exit is skipped: it needs a founder decision on a new staff action and member copy). The
  // slop trust_review rule holds a member with no case; staff cannot end it.
  val staffDecisionEndsEngineHold = s.staffCleared.forall(m => s.live.get(m) implies not(trustReview(s, m)))

  // SD-253 (skipped: needs a founder decision on new member copy). PRD 40.5 "a relay log so past contacts can be
  // told about a ban".
  val pastContactsToldOfBan = s.banned.forall(p => PERSONS.forall(q => s.metPairs.contains((q, p)) implies s.toldOfBan.contains((q, p))))


  // NEW-3 (not in the register). PRD F23 "Block ... only affects the pair"; bookPlan "one block cannot collapse
  // the quorum". A block between two members who are both going to a plan of three still calls the plan off
  // for the third (callOffPair closes any item both are going to).
  val blockLeavesOthersPlan = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    (o.closedBy == "blocked" or o.closedBy == "blocked_elsewhere") implies o.going.forall(x => x.p == o.blocker or x.p == o.target)
  })

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_dateDone = not(OPP_IDS.exists(k => s.opps.get(k).stage == "done"))
  val witness_checkInReport = not(s.reports.exists(r => r.source == "check_in"))
  val witness_messageReport = not(s.reports.exists(r => r.source == "message" and r.met))
  val witness_staffHold = not(s.staffHeldP != Set())
  val witness_liftToOk = not(s.lifts > 0)
  val witness_watch = not(ALL_MIDS.exists(m => lvl(s, m) == "watch"))
  val witness_rejoin = not(ALL_MIDS.exists(m => m.g == 1 and s.live.get(m)))
  val witness_ban = not(s.banned != Set())
  // A profile-share grant is live (the ban revokes it).
  val witness_shareGrant = not(s.shareGrants != Set())
  // new paths of the fixes
  val witness_callOffElsewhere = not(OPP_IDS.exists(k => s.opps.get(k).closedBy == "blocked_elsewhere"))
  val witness_relayCase = not(s.relayLog.exists(x => x._2 == "blockSevere" and s.live.get(x._1) and s.caseSt.get(x._1) == "open"))
  // wave 4 paths
  val witness_banStopped = not(s.banned.exists(p => s.banning == Set() and liveMidsOf(s, p).exists(x => not(s.restricted.contains(x)))))
  // A lift by safety@* staff that releases this app from the global row while the row keeps the other apps.
  val witness_liftReleasesOneApp = not(s.released != Set() and s.personHolds.exists(h => h._2 == "*"))
  val witness_leaveInFlight = not(s.leaving != Set() and s.reports != Set())
  val witness_probingClosed = not(OPP_IDS.exists(k => s.opps.get(k).stage == "closed" and s.opps.get(k).told == Set()))
  val witness_oneAppHold = not(s.staffHeldP.exists(h => h._2 != "*"))
  val witness_inviteeHeld = not(s.invitesBlockedUntil.get(INVITER) >= 0)

  // ------------------------------------------------------------------ run tests (concrete traces)
  pure val ANA_S: Mid = { app: "slop", p: "ana", g: 0 }
  pure val BEN_S: Mid = { app: "slop", p: "ben", g: 0 }
  pure val CY_S: Mid = { app: "slop", p: "cy", g: 0 }
  pure val ANA_P: Mid = { app: "peon", p: "ana", g: 0 }
  pure val BEN_P: Mid = { app: "peon", p: "ben", g: 0 }
  pure val BEN_S1: Mid = { app: "slop", p: "ben", g: 1 }
  pure val CY_P: Mid = { app: "peon", p: "cy", g: 0 }

  // Two reporters who met cy, after cy's own abusive message, put cy on hold; staff lift returns cy to ok.
  run twoReportersHoldThenLiftTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", false))
      .then(abuse(CY_S, 1))
      .then(report("ana", "slop", "cy", "report", "harassment", false))
      .then(report("ben", "slop", "cy", "report", "harassment", false))
      .expect(lvl(s, CY_S) == "hold" and noSingleActorHold and reporterNotHeld)
      .then(liftHold(CY_S))
      .expect(lvl(s, CY_S) == "ok" and s.caseSt.get(CY_S) == "lifted")

  // SD-021 retained requirement: staff hold ben, ben leaves slop and joins again. The durable staff hold
  // excludes the rejoin from matching (snapshot "restricted"); no unit gives the new member a trust hold. An
  // authorized staff lift releases slop from the global row and keeps peon.
  run sd021LeaveRejoinKeepsHoldTest =
    init
      .then(staffHold(BEN_S))
      .then(staffHoldApply(BEN_P))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(staffHoldFollowsPerson and not(matchable(s, BEN_S1)) and covered(s, BEN_S1))
      .then(tick(1))
      .expect(lvl(s, BEN_S1) == "ok" and not(matchable(s, BEN_S1)) and safety)
      .then(liftHold(BEN_S1))
      .expect(not(covered(s, BEN_S1)) and covered(s, BEN_P) and lvl(s, BEN_P) == "hold" and safety)

  run automaticHardHoldCarriesFromForgetTest =
    init
      .then(abuse(BEN_S, WATCH))
      .then(leaveStart("slop", "ben"))
      .expect(not(covered(s, BEN_S)))
      .then(abuse(BEN_S, HOLD - WATCH))
      .expect(lvl(s, BEN_S) == "hold")
      .then(leaveFinish(BEN_S))
      .then(join("slop", "ben"))
      .expect(covered(s, BEN_S1) and not(matchable(s, BEN_S1)) and not(covered(s, BEN_P)))
      .then(tick(1))
      .expect(lvl(s, BEN_S1) == "ok" and not(matchable(s, BEN_S1)))

  // SD-021 retained requirement: a minor report on slop, a leave and a rejoin. The new member is held.
  run sd021MinorReportCarriedOverTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(not(matchable(s, BEN_S1)) and minorSignalFollowsPersonInApp and urgentMetReportBlocksMatchingInApp)

  // SD-022 (fixed): staff hold on slop, the process stops before the peon unit: ben@peon is covered (not
  // matchable, snapshot "restricted"); the next tick does not need to hold him.
  run sd022HoldNotAtomicTest =
    init
      .then(staffHold(BEN_S))
      .then(crash)
      .expect(staffHoldFollowsPerson and not(matchable(s, BEN_P)) and lvl(s, BEN_P) == "ok")
      .then(tick(1))
      .expect(not(matchable(s, BEN_P)) and safety)

  // SD-022 (fixed): cy is held on every app from slop, then joins peon: the global row covers the new member.
  run sd022JoinDuringHoldTest =
    init
      .then(staffHold(CY_S))
      .then(join("peon", "cy"))
      .expect(staffHoldFollowsPerson and not(matchable(s, CY_P)))
      .then(tick(1))
      .expect(covered(s, CY_P) and not(matchable(s, CY_P)))

  // SD-022 (fixed): the new member's own text runs syncMember, which writes no trust hold now; the member stays
  // covered and out of matching whatever the text adds.
  run sd022JoinDuringHoldTextTest =
    init
      .then(staffHold(CY_S))
      .then(join("peon", "cy"))
      .then(abuse(CY_P, 1))
      .expect(covered(s, CY_P) and not(matchable(s, CY_P)) and staffHoldFollowsPerson)

  // SD-074 (fixed): a minor report on slop keeps ben out of matching on peon too.
  run sd074MinorReportEveryAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .expect(minorSignalFollowsPersonInApp and minorSignalFollowsPerson and not(matchable(s, BEN_P)))

  // SD-025 (intended rule; open on this branch as ST-D1): a slop date and a peon date between ana and ben; ana blocks ben on slop. The peon item stays
  // scheduled until the next tick (it cannot finalize first), then it closes.
  run sd025BlockAcrossAppsTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "peon", "ana", "ben"))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(blockClosesAllApps and s.opps.get("o1").stage == "closed" and s.opps.get("o2").stage == "scheduled")
      .then(tick(1))
      .expect(s.opps.get("o2").stage == "closed" and s.opps.get("o2").closedBy == "blocked_elsewhere" and safety)

  // SD-025 (intended rule): the other app's item cannot finalize before the tick calls it off.
  run sd025NoMeetingBeforeCallOffTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "peon", "ana", "ben"))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(meet("o2", Set()).fail())

  // SD-044 + SD-045 (fixed): cy declined the plan probe; cy's report about ana is a stranger's report and the
  // plan of ana and ben stays booked.
  run sd044sd045DeclinerTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", true))
      .then(report("cy", "slop", "ana", "report", "harassment", false))
      .expect(metIsReal and blockOnlyAffectsPair and matchable(s, ANA_S) and s.opps.get("o1").stage == "scheduled"
              and s.reports.exists(r => r.reporter == CY_S and not(r.met)))

  // SD-044 (fixed, second path): after the plan meets and ana answers the check-in, the record of the meeting
  // does not name cy, so cy's report is still a stranger's report.
  run sd044AfterCheckInTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", true))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(report("cy", "slop", "ana", "report", "harassment", false))
      .expect(metIsReal and matchable(s, ANA_S) and s.reports.exists(r => r.reporter == CY_S and not(r.met)))

  // SD-072 (fixed): a banned member who met ana cannot take her out of matching. Since the ban rule
  // (spec/safetyCase.md, "A ban allows only carrier commands and app leave") the report text is held: no report.
  run sd072BannedReporterTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(ban("ben"))
      .expect(reporterNotHeld and matchable(s, ANA_S))
      .then(report("ben", "slop", "ana", "report", "harassment", false).fail())

  // SD-072 (OPEN, 2026-11-21): a reporter on staff hold who met ana reports her; the report takes ana out of
  // matching. After the reporter leaves, the report still holds her.
  run sd072HeldReporterTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(staffHold(BEN_S))
      .then(report("ben", "slop", "ana", "report", "harassment", false))
      .expect(not(matchable(s, ANA_S)) and not(reporterNotHeld) and not(reporterStandingKept))
      .then(leave("slop", "ben"))
      .expect(not(matchable(s, ANA_S)) and not(reporterStandingKept))

  // SD-067 (fixed): a happy check-in answer is no report (the reader cannot misread it).
  run sd067HappyCheckInTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(s.reports == Set() and not(s.minorF.get(BEN_S)) and not(s.personBlocks.contains(("ana", "ben"))))

  // SD-067 (fixed): the reader cannot read a happy answer as a minor report.
  run sd067NoMisreadTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "minor").fail())

  // SD-229 (intended): two check-in reports by people who met ben add trust points (watch).
  run sd229CheckInCountedTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "slop", "cy", "ben"))
      .then(meet("o1", Set()))
      .then(meet("o2", Set()))
      .then(checkIn("o1", ANA_S, "report", "no_show"))
      .then(checkIn("o2", CY_S, "report", "no_show"))
      .expect(reportersCounted and s.trust.get(BEN_S).reportsFrom == Set(ANA_S, CY_S) and lvl(s, BEN_S) == "watch")

  // ST-D7 (intended): the same check-in through blockAndReport closes the second date at once.
  run st_d7CheckInClosesPairItemTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(bookDate("o2", "slop", "ana", "ben"))
      .then(checkIn("o1", ANA_S, "report", "no_show"))
      .expect(s.opps.get("o2").stage == "closed" and s.opps.get("o2").closedBy == "blocked" and blockClosesAllApps)

  // An urgent check-in report holds ben (reportHeld -> dropMember); the pair's other item closes first, as blocked.
  run checkInUrgentHoldsTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(bookDate("o2", "slop", "ana", "ben"))
      .then(checkIn("o1", ANA_S, "report", "harassment"))
      .expect(not(matchable(s, BEN_S)) and s.opps.get("o2").stage == "closed" and s.opps.get("o2").closedBy == "blocked"
              and urgentMetReportBlocksMatchingInApp and everyMetReportFiled)

  // SD-220 on this branch: the first answer is "it was fine"; a day later "report him" asks "Who do you mean:
  // Ben?" (no date ahead), and "yes" files the report as met.
  run sd220ReportAfterAnswerTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(tick(1))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .expect(s.reports == Set() and s.pendingWho.get(ANA_S).asked)
      .then(answerWho(ANA_S))
      .expect(everyMetReportFiled and s.reports.exists(r => r.reporter == ANA_S and r.source == "message" and r.met)
              and not(matchable(s, BEN_S)))

  // SD-221 (intended): a peon check-in answer that reports something files the report.
  run sd221PeonCheckInTest =
    init
      .then(bookDate("o1", "peon", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_P, "report", "harassment"))
      .expect(everyMetReportFiled and s.reports.exists(r => r.subject == BEN_P and r.met))

  // SD-250 (fixed): ana met ben on slop; "report Ben" cannot go to peon, it goes to slop and holds ben there.
  run sd250ReportRoutedToMeetingTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .expect(everyMetReportFiled and not(matchable(s, BEN_S)))

  // SD-250 (intended): the route never sends that text to peon, where ben is a stranger.
  run sd250NotRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "peon", "ben", "report", "harassment", false).fail())

  // SD-250 (OPEN on this branch): route() does not read the name, so the text can reach peon (an open peon item or
  // the last writer). There ben is no counterpart: findByName finds him, the block stands, and the report is a
  // stranger's report that holds nobody.
  run sd250CodeRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(reportCode("ana", "peon", "ben", "report", "harassment", false))
      .expect(not(everyMetReportFiled) and matchable(s, BEN_S) and matchable(s, BEN_P)
              and s.reports.exists(r => r.subject == BEN_P and not(r.met)))

  run explicitContactBypassTest =
    init
      .expect(matchable(s, BEN_S))
      .then(abuse(BEN_S, WATCH))
      .expect(lvl(s, BEN_S) == "watch" and not(matchable(s, BEN_S)))
      .then(bookDate("o1", "slop", "ana", "ben").fail())

  // SD-141 (fixed): score 1 on day 0, +2 on day 13 (watch); the watch lasts 14 days, to day 27.
  run sd141WatchLastsTest =
    init
      .then(abuse(BEN_S, 1))
      .then(tick(13))
      .then(abuse(BEN_S, 2))
      .expect(lvl(s, BEN_S) == "watch")
      .then(tick(1))
      .expect(lvl(s, BEN_S) == "watch")
      .then(tick(12))
      .expect(lvl(s, BEN_S) == "watch")
      .then(tick(1))
      .expect(lvl(s, BEN_S) == "ok" and watchLasts14Days)

  // SD-027 pair/context separation: these blocks still apply to each pair without triggering member review.
  run sd027TrustReviewTest =
    init
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(report("cy", "slop", "ben", "block", "harassment", false))
      .expect(not(trustReview(s, BEN_S)) and strangersCannotEngineHold and
        s.personBlocks.contains(("ana", "ben")) and s.personBlocks.contains(("cy", "ben")))

  // SD-222 (fixed): ben did not come and says so; only ben is charged a no-show.
  run sd222SelfNoShowTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set(BEN_S)))
      .then(checkIn("o1", BEN_S, "selfNoShow", "none"))
      .expect(noShowCountsAbsentOnly and noShows(s, ANA_S) == 0 and noShows(s, BEN_S) == 1)

  // SD-442 (fixed in part): the answer comes the next day; the record has the meeting day.
  run sd442SlotTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(tick(1))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(slotFromMeeting and s.inters.forall(i => i.at == 0))

  // Upstream PR #496: ben shares his profile, then staff ban him. The ban revokes the grant and the pending text in
  // its transaction. A later report or share text is held; "leave <app>" still works.
  run banRevokesSharesTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(shareAsk("ben"))
      .then(shareYes("ben"))
      .then(shareAsk("ben"))
      .expect(s.shareGrants.contains("ben") and s.pendingTexts.contains("ben"))
      .then(ban("ben"))
      .expect(s.shareGrants == Set() and s.pendingTexts == Set() and banRevokesShares and not(inboundOk(s, "ben")))
      .then(leave("slop", "ben"))
      .expect(not(s.live.get(BEN_S)) and banRevokesShares)

  run bannedShareAskTest =
    init
      .then(ban("ben"))
      .then(shareAsk("ben").fail())

  // SD-253 (skipped): ben met ana, then ben is banned: ana is never told.
  run sd253BanNoticeTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(ban("ben"))
      .expect(not(pastContactsToldOfBan))

  // SD-254 (intended): a relay block for ben's own words opens a case; a photo block opens nothing.
  run sd254RelayBlockTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySend("o1", ANA_S, "block", false))
      .expect(s.caseSt.get(ANA_S) == "none")
      .then(relaySend("o1", BEN_S, "blockSevere", false))
      .expect(relayBlockReachesSafety and s.caseSt.get(BEN_S) == "open")

  // SD-254 (OPEN on this branch): the same block through RelayDesk.apply opens no case for ben.
  run sd254CodeNoCaseTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySendCode("o1", BEN_S, "blockSevere", false))
      .expect(not(relayBlockReachesSafety) and s.caseSt.get(BEN_S) == "none")

  // SD-475 (fixed): a staff hold notice is a "safety" send.
  run sd475HoldNoticeKindTest =
    init
      .then(staffHold(BEN_S))
      .expect(safetyNoticeImmediate and s.holdNotices == Set((BEN_S, "safety")))

  // NEW-3: ana, ben and cy are going to a plan; ana blocks ben; the plan is off for cy too.
  run new3BlockInPlanTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", false))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(blockOnlyAffectsPair and not(blockLeavesOthersPlan) and s.opps.get("o1").stage == "closed")

  // "Who do you mean?": the answer within a day applies the block to the counterpart.
  run answerWhoTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(answerWho(ANA_S))
      .expect(s.reports.exists(r => r.reporter == ANA_S and r.met) and everyMetReportFiled)

  // ------------------------------------------------------------------ wave 4 run tests
  pure val CY_S1: Mid = { app: "slop", p: "cy", g: 1 }

  // W3-218 on this branch: ana dates cy, then ben. "report him" about cy asks "Who do you mean: Ben?" first (no
  // date ahead, the newest counterpart is confirmed); ana answers "Cy", and the report names cy. Ben is untouched.
  run w3_218PronounConfirmedTest =
    init
      .then(bookDate("o1", "slop", "ana", "cy"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(tick(1))
      .then(bookDate("o2", "slop", "ana", "ben"))
      .then(meet("o2", Set()))
      .then(checkIn("o2", ANA_S, "fine", "none"))
      .then(report("ana", "slop", "cy", "report", "harassment", true))
      .then(answerWho(ANA_S))
      .expect(reportSubjectMeant and everyMetReportFiled and matchable(s, BEN_S) and not(matchable(s, CY_S))
              and s.personBlocks.contains(("ana", "cy")) and not(s.personBlocks.contains(("ana", "ben"))))

  // W3-219 on this branch: after a good date, "my boss was so rude today, he yelled at everyone" has no command
  // word: nothing is filed and ben is not blocked.
  run w3_219VentingTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(tick(1))
      .then(freeText(ANA_S))
      .expect(s.reports == Set() and checkInReportIntended and reportSubjectMeant and matchable(s, BEN_S)
              and not(s.personBlocks.contains(("ana", "ben"))))

  // W3-220, trigger A, on this branch (OPEN, with SD-250): "report him" reaches peon (an open peon item), where ana
  // has no counterpart, so peon asks; her answer "Ben" names no counterpart there, and nothing is filed.
  run w3_220ReportRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(tick(1))
      .then(reportCode("ana", "peon", "ben", "report", "harassment", true))
      .then(answerWho(ANA_P))
      .expect(s.lastAction == "answerWhoNone" and not(everyMetReportFiled) and matchable(s, BEN_S) and s.reports == Set())

  // W3-220, trigger B (OPEN): "report Ben" needs "Who do you mean?" on slop; the answer goes to peon; the ask lapses.
  run w3_220WhoAnswerRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(answerWhoElsewhereCode(ANA_S, "peon"))
      .then(tick(6))
      .expect(not(everyMetReportFiled) and s.reports == Set())
      .then(answerWho(ANA_S).fail())

  // W3-221: ana’s urgent report commits after leave consent. Forget keeps the exact report restriction.
  run w3_221LeaveRaceTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(leaveStart("slop", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .then(leaveFinish(BEN_S))
      .then(join("slop", "ben"))
      .expect(urgentMetReportBlocksMatchingInApp and not(matchable(s, BEN_S1)) and not(covered(s, BEN_S1)))
      .then(staffHoldBy(BEN_S1, "slop", ""))
      .then(liftHoldBy(BEN_S1, "slop"))
      .expect(not(matchable(s, BEN_S1)) and not(covered(s, BEN_S1)))
      .then(all { nondet r = s.reports.oneOf() dismiss(r) })
      .expect(matchable(s, BEN_S1) and s.carriedReports == Set())

  // W3-223: the ban stops after the slop unit. The canonical ban excludes ben@peon until staff resume projection.
  run w3_223BanStoppedTest =
    init
      .then(banStart("ben"))
      .then(banApply(BEN_S))
      .then(crash)
      .expect(bannedNeverMatchable and not(s.restricted.contains(BEN_P)) and not(matchable(s, BEN_P)))
      .then(banStart("ben"))
      .then(banApply(BEN_P))
      .expect(bannedNeverMatchable and s.restricted.contains(BEN_P))

  // W3-644 (closed on this branch): the lift is one unit with a compare-and-set of the hold rows. A hold on
  // every app after a one-app hold leaves no lift by one-app staff: the global row needs safety on every app.
  run w3_644LiftAfterGlobalHoldTest =
    init
      .then(staffHoldBy(ANA_S, "slop", ""))
      .then(staffHoldBy(ANA_P, "*", ""))
      .then(staffHoldApply(ANA_S))
      .expect(staffHoldFollowsPerson and not(matchable(s, ANA_S)) and covered(s, ANA_P))
      .then(liftHoldBy(ANA_S, "slop").fail())

  // W3-644: with no race, staff of one app cannot lift a hold on every app (needs_safety_everywhere).
  run w3_644OneAppStaffRefusedTest =
    init
      .then(staffHold(ANA_S))
      .then(liftHoldBy(ANA_S, "slop").fail())

  // W3-231, W3-435: a lift by safety@* staff on slop adds slop to released_apps; the global row keeps peon
  // (and every app the person is not a member of now) covered.
  run w3_435LiftKeepsOtherAppsTest =
    init
      .then(staffHold(BEN_S))
      .then(liftHoldBy(BEN_S, "*"))
      .expect(s.personHolds == Set(("ben", "*")) and s.released == Set(("ben", "slop")) and lvl(s, BEN_S) == "ok"
        and not(covered(s, BEN_S)) and covered(s, BEN_P) and staffHoldFollowsPerson)

  // Drift item 4: a durable hold with no runtime hold. A rejoin after a leave starts at trust ok; the lift
  // answers ok and ends the durable row.
  run liftDurableOnlyTest =
    init
      .then(staffHoldBy(BEN_S, "slop", ""))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(covered(s, BEN_S1) and not(matchable(s, BEN_S1)))
      .then(liftHoldBy(BEN_S1, "slop"))
      .expect(not(covered(s, BEN_S1)) and s.lastAction == "lift")

  // W3-231: a hold from one report marks that report only. After the lift cy's urgent report still holds ben
  // (safe: staff dismiss it to end it).
  run w3_231ReportIdHoldTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", false))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .then(report("cy", "slop", "ben", "report", "harassment", false))
      .then(staffHoldBy(BEN_S, "slop", "ana"))
      .then(liftHoldBy(BEN_S, "slop"))
      .expect(lvl(s, BEN_S) == "ok" and reportHeld(s, BEN_S) and not(matchable(s, BEN_S)))

  // W3-229: cy (invited by ana) reaches hold; ana loses invites for 30 days and takes 1 point (here: hold).
  run w3_229InviterTest =
    init
      .then(abuse(ANA_S, 6))
      .then(abuse(CY_S, 6))
      .then(abuse(CY_S, 1))
      .expect(lvl(s, CY_S) == "hold" and lvl(s, ANA_S) == "hold" and s.invitesBlockedUntil.get(ANA_S) == 30
              and noSingleActorHold and s.src.get(ANA_S).other == 1)

  // W3-230: three stranger blocks in 14 days (+2 and no credibility); after 14 days the reporter is credible again.
  run w3_230BlockWindowTest =
    init
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(report("ana", "slop", "cy", "block", "harassment", false))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(s.trust.get(ANA_S).score == 2 and not(credibleT(s.trust.get(ANA_S), s.now)))
      .then(tick(14))
      .expect(credibleT(s.trust.get(ANA_S), s.now))

  // W3-225, W3-237 (SD-442 remainder): an 8 pm New York date on a Monday is 00:00 UTC on Tuesday; slotOf reads
  // New York time and gives the Monday evening slot.
  run w3_237SlotZoneTest =
    init
      .then(bookDateAt("o1", "slop", "ana", "ben", 20, false))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(slotFromMeeting and s.inters.exists(i => i.slot == 0))

  // W3-232, W3-237: ben's own relayed text says he is 16; nothing reads the ageSignal and ben stays matchable.
  run w3_232RelayAgeSignalTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySend("o1", BEN_S, "hold", true))
      .expect(not(relayAgeSignalReachesAgePolicy) and matchable(s, BEN_S))

  // W3-232: a block closes a probing item on its app at once and on the other app at the tick; it cannot book.
  run w3_232ProbingBlockTest =
    init
      .then(bookDateAt("o1", "slop", "ana", "ben", 19, true))
      .then(bookDateAt("o2", "peon", "ana", "ben", 19, true))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(s.opps.get("o1").stage == "closed" and s.opps.get("o2").stage == "probing" and blockClosesAllApps)
      .then(confirm("o2").fail())

  // W3-234 (NEW-2 path b): ana reports ben, then ana is banned (her hold stops the report from counting), staff
  // lift her slop hold (liftHold does not check the ban), and her report holds ben again. A report sent after
  // the ban is held (inboundOk), so the report must come first.
  run w3_234BannedReporterLiftedTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .then(ban("ana"))
      .then(liftHold(ANA_S))
      .expect(not(reporterStandingKept) and not(matchable(s, BEN_S)))
}
```
