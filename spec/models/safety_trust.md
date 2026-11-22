# Safety reports, holds, and blocks

## Story: Safety reports, holds, and blocks

A member needs a safety report or block to affect eligibility, with staff control of restricted actions.

### Safety rules and reachability

Check person and app scope, age signals, review and hold decisions, and safety notices. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/safety_trust.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

Production uses [Safety cases and report review](../safetyCase.md) for the case lifecycle, report decisions, and staff hold and age-clearance admission. The standalone model also covers member contact, trust scores, and cross-app effects.

The matching snapshot reads [canonical ban authority](../staffSafetyService.md#live-enrollment-and-ban-projection-use-the-current-person) while runtime restriction is being projected. [Durable staff holds](../staffSafetyService.md#a-staff-hold-survives-ordinary-app-membership-changes) retain explicit staff decisions through ordinary app leave and rejoin under [PRD §40.3](../product/source/prd.md#403-shared-platform). Production keeps global authority with per-app releases. The retained model represents decisions with increasing identifiers and global releases with an app set. [A committed hard trust hold](../staffSafetyService.md#a-committed-trust-hold-follows-the-person-through-ordinary-app-leave) also carries within its app when the runtime forgets its member. [Exact open report restrictions](../safetyCase.md#the-exact-open-report-follows-its-subject-through-ordinary-app-leave) carry within their originating app. This model has one runtime per app and represents the exact report ID by its immutable report identity tuple. A reported minor signal restricts matching in its originating app. The [membership and age model](join_age.md) checks person-wide propagation of an age stated by the member or verified through signup.

[A report keeps its own disposition](../safetyCase.md#a-hold-ban-or-dismissal-updates-the-matching-report). `pendingReportHold` in `packages/network/src/network.ts` reads the open report's subject, encounter, and urgency. [A ban refuses new ordinary text](../safetyCase.md#a-ban-allows-only-carrier-commands-and-app-leave). `NetworkService.inbound` calls `inboundAllowedAfterBan` before the report reaches the runtime.

[Danger disclosures during a check-in](../safetyCase.md#direct-current-danger-text-gets-immediate-guidance-first) use the [receipt of the exact current feedback prompt](../meetingSettlement.md#a-feedback-reply-needs-receipt-of-its-exact-prompt). The model receives the receipt check and the attributed counterpart as inputs. Unattributed disclosures and disclosures without the exact receipt receive guidance without changing attendance or creating a report. The ordinary member report uses its separate transition.

The shared-line clarification action treats the offered target as the exact displayed-name match. Its live memberships represent verified current app owners. It can route the reply to the app that asked when only one current offer matches. Explicit app routing and several matching offers leave that other app's report untouched. The runtime rechecks the pending question and target while applying the report.

```quint
// quint-check: max-steps=14 max-samples=6000 verify-steps=2
// Safety and trust (docs/research/2026-11-07-state-machines.md section 6.9). Machines: person-safety-carryover
// (M-051), trust-level (M-052), safety-report (M-053), pair-relations (M-054), slop-check-in-report (M-055),
// slop-review-hold (M-056), safety-case (M-127), pending-safety-who (M-128). journey-help (M-183) has no
// state in the Network (HELP returns before any safety state changes), so it is not modelled.
//
// The model follows the code on branch wave2/safety_trust (the fixes f8d9de8..49602b7). Line numbers below are
// at formal-main; other "<file>:<line>" references in the body are lines at wave2/safety_trust (the function
// names are the anchors):
//   packages/network/src/trust.ts            add 83 (a points event restarts the decay clock, SD-141), block 99,
//                                            report 113, lift 60, decay 125; nextLevel, reportCounts,
//                                            reportPoints, decayedScore and staffHoldPoints in transitions.ts
//   packages/network/src/reports.ts          report kinds, URGENT_REPORTS, checkInReport (an oracle here; the
//                                            corpus evals/network/check-in-reports.jsonl checks it, SD-067)
//   packages/network/src/network.ts          onTrustChange 1257, caseEvent 1278, liftHold 1313, closeCase 1323,
//                                            fileReport 1349, reportHeld 1365, holdMember 1381,
//                                            markBanned 1396, dismissReport 1409,
//                                            metBefore 1457 (bookedTold, SD-044), handleBlock 1475, applyBlock 1491,
//                                            blockAndReport 1506 (SD-229), callOffPair 1532 (SD-045, SD-025),
//                                            counterparts 1551, safetyTargetAt 1612 (SD-250), answerWho 1634,
//                                            minorReported 1656, dropMember 2756, onFeedback 2786 (record `by`,
//                                            the meeting time and the bookedTold people, SD-222, SD-442, SD-044;
//                                            postDateReports),
//                                            handleImmediateDanger, recordMeetingSafetyReport, forget 965,
//                                            tick 3523 (personHold, callOffPair on snapshot blocks, decay 3559),
//                                            syncMember/personHold/safetyHeld 4782-4799 (SD-021, SD-022),
//                                            RelayHost.severeBlock 5154 (SD-254)
//   packages/network/service/service.ts      route 1085 (a block/report text goes to the app of the newest
//                                            meeting, SD-250), historic carryover in forget 921 (SD-021),
//                                            liftHold 1793, hold 1943 (historic person_holds, SD-022), ban 2010
//   packages/network/service/packs.ts        peonHooks postDateReports (SD-221)
//   packages/network/service/runtime.ts      send kind 466 (meta.safety is the "safety" kind, SD-475),
//                                            person_blocks write 578
//   packages/network/service/snapshot.ts     canonical ban from platform.matching_ages -> restricted matching status
//   packages/network/src/relay.ts            RelayDesk.apply 244-252 (a severe block calls severeBlock)
//   packages/engine/src/packs/slop/rules.ts  reviewReason (trust_review; SD-027 pair/context separation)
//   packages/engine/src/packs/slop/profile.ts histories 232-260 (a record with `by` counts for that member only)
//
// One action is one unit of work (one SQL transaction of one Network). The service's cross-app hold loop
// awaits between apps: `staffHoldApply` is the next app's unit and `crash` is a process stop between two
// units. A unit that reads a member's text first syncs that member (syncMember: a person hold covers them).
// Oracles with nondeterministic output: the report-kind reader on the "report X" text, the check-in reader
// (checkInReport; after SD-067 it reads a happy answer as no report: the corpus gate checks this), the
// routing of a member's message to an app (route(): the app of the newest meeting with the person a block
// or report names, else the newest item, else the last writer), the Clef/rules relay decision. Time is in days.
//
// Bounds: 2 apps (both have postDateReports since SD-221), 3 persons, at most one rejoin per app and person
// (member generation 0..1), 3 opportunity slots. Staff have the safety@* role ("*") or safety on one app.
//
// Wave 4 (docs/research/2026-11-07-state-machines.md section 9.6, items W3-218..W3-237, W3-435, W3-644; lines at
// e4f0a32). New in the model: the late disclosure picks the newest done date and a pronoun passes the gate
// (network.ts:346, 2859-2871; W3-218, W3-219, W3-224); route() of a text that classify reads as "other" (the
// disclosure, the answer to "Who do you mean?") is an oracle over the member's apps (service.ts:1085-1135,
// W3-220); a leave reads safetyHeld in one lock and forgets in another (service.ts:921-930, W3-221); a ban is one
// unit per app with no person hold (service.ts:2014-2046, W3-223); liftHold reads the "*" row before its
// transaction, deletes the rows in it and lifts in a later unit (service.ts:1797-1814, W3-644, W3-231, W3-435);
// per-app staff scope and a hold with a report id (service.ts:1947-1966, network.ts:1381-1427, W3-231); the clear
// of a minor signal is one unit per app (service.ts:1977-2003, W3-232); a probing stage (network.ts:482, 2756-2778,
// 1532-1545); the block-abuse 14-day window (trust.ts:99-106, 116, W3-230); inviter accountability
// (network.ts:1266-1272, W3-229); the slot of a meeting in New York time against slotOf's UTC reading
// (engine slop profile.ts:224-230, W3-225, W3-237); the hold notice kind from outboundKind (decisions.ts:109,
// W3-225); the direct age statement in the member-authored relay body (W3-232, W3-237).
module safety_trust {
  // ------------------------------------------------------------------ types
  type Mid = { app: str, p: str, g: int }
  // blocksMade: the times of stranger blocks (trust.ts:105, the 14-day window, W3-230)
  type Trust = { rec: bool, score: int, level: str, reportsFrom: Set[Mid], lastDecay: int, strangers: Set[Mid], blocksMade: List[int] }
  // meetHour: the New York local hour of the meeting (the slot, W3-225)
  type Opp = {
    app: str, kind: str, parts: Set[Mid], going: Set[Mid], told: Set[Mid], stage: str, meetingAt: int, meetHour: int,
    feedbackFrom: Set[Mid], absent: Set[Mid], closedBy: str, blocker: str, target: str, blockRoster: Set[Mid]
  }
  // origReporter: a ghost that keeps the reporter after a leave (the code blanks reporterId).
  // meantP: a ghost, the person the member meant ("boss": somebody who is not a member).
  // bannedAtFiling: canonical ban observed when this report entered the case.
  type Report = {
    reporter: Mid, reporterP: str, origReporter: Mid, subject: Mid, kind: str, met: bool, source: str, status: str,
    credible: bool, intended: bool, at: int, meantP: str, bannedAtFiling: bool
  }
  type ReportIdentity = (Mid, Mid, str, str, int)
  // slot: what profile.ts slotOf reads from the record; hour: the New York hour of the meeting (truth)
  type Inter = { parts: Set[Mid], outcome: str, at: int, meetingAt: int, by: Mid, hour: int, slot: int }
  // A staff lift reads the decision identifiers, then commits the durable and runtime changes together.
  type Lift = { m: Mid, scope: str, expectedLocal: int, expectedGlobal: int, stage: str }
  type Src = { msgs: int, reporters: Set[Mid], staff: bool, other: int }
  type Who = { asked: bool, at: int, verb: str, kind: str, target: str, offered: bool }
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
    // platform.person_holds: (person, app or "*")
    personHolds: Set[(str, str)],
    holdDecisions: (str, str) -> int,
    nextHold: int,
    globalHoldReleases: Set[(str, str)],
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
    lift: Lift,
    // network.members.invited_by (sim only: nothing in production writes it) and invitesBlockedUntil
    invitedBy: Mid -> Mid,
    invitesBlockedUntil: Mid -> int,
    // ghosts (never read by the modelled code)
    // (person, "*" or app): a staff hold that the rule says holds the person on that scope
    staffHeldP: Set[(str, str)],
    // people with a direct minor age committed from their own relay text
    statedRelayMinors: Set[str],
    autoHeldP: Set[(str, str)],
    minorP: Set[(str, str)],
    heldMids: Set[Mid],
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
  pure val HOLD_SCOPES = APPS.union(Set("*"))
  pure val GENS = 0.to(1)
  pure val OPP_IDS = Set("o1", "o2", "o3")
  pure val ALL_MIDS: Set[Mid] = tuples(APPS, PERSONS, GENS).map(t => { app: t._1, p: t._2, g: t._3 })
  pure val NOBODY: Mid = { app: "", p: "", g: -1 }
  pure val WATCH = 3
  pure val HOLD = 6
  pure val DECAY_DAYS = 14
  pure val MAX_DAY = 60
  // reports.ts:15
  pure val URGENT = Set("harassment", "unsafe", "scam", "minor")
  pure val REPORT_KINDS = Set("harassment", "no_show", "minor")
  // New York local hours of a meeting: a weekend afternoon, a 7 pm and an 8 pm date
  pure val HOURS = Set(14, 19, 20)
  // ghost persons a member can mean: a member, or somebody who is not a member (a boss, a landlord)
  pure val MEANT = Set("ana", "ben", "cy", "boss")

  pure val NO_TRUST: Trust = { rec: false, score: 0, level: "ok", reportsFrom: Set(), lastDecay: -1, strangers: Set(), blocksMade: List() }
  pure val NO_SRC: Src = { msgs: 0, reporters: Set(), staff: false, other: 0 }
  pure val NO_WHO: Who = { asked: false, at: 0, verb: "", kind: "", target: "", offered: false }
  pure val NO_LIFT: Lift = { m: { app: "", p: "", g: -1 }, scope: "", expectedLocal: -1, expectedGlobal: -1, stage: "none" }
  pure val FREE_OPP: Opp = {
    app: "", kind: "", parts: Set(), going: Set(), told: Set(), stage: "free", meetingAt: -1, meetHour: 19,
    feedbackFrom: Set(), absent: Set(), closedBy: "", blocker: "", target: "", blockRoster: Set()
  }

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def imax(a: int, b: int): int = if (a > b) a else b

  // meetingSettlement.md: completedMeetingSlot in the booked zone. The model stores local day and hour
  // directly. The runtime resolves IANA zones and DST outside the model. Day 0 is a Monday.
  pure def slotFromLocalParts(dow: int, hour: int): int =
    if (dow < 0 or dow > 6 or hour < 0 or hour > 23) -1
    else if (dow < 5) (if (hour >= 17) dow else -1)
    else if (dow == 5) (if (hour >= 17) 6 else 5)
    else if (hour >= 17) 8 else 7
  // decisions.ts:109 outboundKind (a proved LemmaScript core; the model calls it, it does not re-prove it)
  pure def outboundKind(reply: bool, causal: bool, replyingTo: bool, safetyMeta: bool, proactive: bool): str =
    if (reply and (causal or replyingTo)) "reply" else if (safetyMeta) "safety" else if (proactive) "proactive" else "transactional"
  // network.ts:1265 the hold notice: send(m, copy.hold, { type: "info", safety: true }, "safety"). In the
  // member's own turn the runtime may read it as the causal reply; else meta.safety makes it "safety".
  pure def holdNoticeKind(ownTurn: bool): str = outboundKind(ownTurn, ownTurn, ownTurn, true, false)

  var s: State

  // ------------------------------------------------------------------ derived values
  pure def midOf(st: State, app: str, p: str): Mid = { app: app, p: p, g: st.gen.get((app, p)) }
  pure def liveMidsOf(st: State, p: str): Set[Mid] = APPS.map(a => midOf(st, a, p)).filter(m => st.live.get(m))
  pure def lvl(st: State, m: Mid): str = st.trust.get(m).level
  // Network pendingReportHold calls reportRestrictsMatching for the subject's exact report.
  pure def reportHeld(st: State, m: Mid): bool =
    st.reports.exists(r => r.subject == m and r.status == "open" and r.met and URGENT.contains(r.kind))
  pure def reportIdentity(r: Report): ReportIdentity = (r.subject, r.origReporter, r.kind, r.source, r.at)
  pure def carriedReportHeld(st: State, m: Mid): bool = st.reports.exists(r =>
    r.subject.p == m.p and r.subject.app == m.app and urgentOpen(r) and st.carriedReports.contains(reportIdentity(r)))
  // Durable coverage for this app or every app. Production preserves global authority on the other apps after a lift.
  pure def localHoldDecision(st: State, m: Mid): int =
    if (st.personHolds.contains((m.p, m.app))) st.holdDecisions.get((m.p, m.app)) else -1
  pure def globalHoldDecision(st: State, m: Mid): int =
    if (st.personHolds.contains((m.p, "*")) and not(st.globalHoldReleases.contains((m.p, m.app))))
      st.holdDecisions.get((m.p, "*")) else -1
  pure def covered(st: State, m: Mid): bool = localHoldDecision(st, m) >= 0 or globalHoldDecision(st, m) >= 0
  pure def writeHold(st: State, p: str, scope: str): State = {
    ...st,
    personHolds: st.personHolds.union(Set((p, scope))),
    holdDecisions: st.holdDecisions.set((p, scope), st.nextHold),
    nextHold: st.nextHold + 1,
    globalHoldReleases: if (scope == "*") st.globalHoldReleases.filter(x => x._1 != p) else st.globalHoldReleases,
  }
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
      and not(st.statedRelayMinors.contains(m.p))
      and not(reportHeld(st, m)) and not(carriedReportHeld(st, m)) and not(st.restricted.contains(m)) and not(covered(st, m))
  // blocked(): this Network's block or a person block from the snapshot
  pure def blockedPair(st: State, a: Mid, b: Mid): bool =
    st.blocks.contains(Set(a, b)) or st.personBlocks.contains((a.p, b.p)) or st.personBlocks.contains((b.p, a.p))
  pure def usedOpps(st: State): Set[Opp] = OPP_IDS.map(k => st.opps.get(k)).filter(o => o.stage != "free" and o.stage != "deleted")
  // network.ts:1394 metBefore: a booked opportunity that reached both (bookedTold, SD-044), or a completed /
  // no_show interaction that names both.
  pure def metBefore(st: State, a: Mid, b: Mid): bool = or {
    usedOpps(st).exists(o => o.told.contains(a) and o.told.contains(b)),
    st.inters.exists(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")),
  }
  // network.ts:1488 counterparts of a: the others told about a booked meeting a was told about who said yes,
  // or a recorded meeting. The value is the time of the newest such meeting, -1 for none.
  pure def counterpartAt(st: State, a: Mid, b: Mid): int = {
    val fromOpps = usedOpps(st).filter(o => o.told.contains(a) and o.told.contains(b) and o.going.contains(b)).fold(-1, (acc, o) => imax(acc, o.meetingAt))
    st.inters.filter(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")).fold(fromOpps, (acc, i) => imax(acc, i.at))
  }
  pure def counterpart(st: State, a: Mid, b: Mid): bool = a != b and counterpartAt(st, a, b) >= 0
  // service.ts:980 + safetyTargetAt: the newest meeting of person r with person t on app a (-1: none)
  pure def metAtOn(st: State, a: str, r: str, t: str): int =
    if (st.live.get(midOf(st, a, t))) counterpartAt(st, midOf(st, a, r), midOf(st, a, t)) else -1
  // ghost: the two people were both told about one booked meeting and both are going (they met)
  pure def metPair(o: Opp, a: Mid, b: Mid): bool = a != b and o.told.contains(a) and o.told.contains(b) and o.going.contains(a) and o.going.contains(b)
  // trust.ts:105 the stranger blocks inside the 14-day window
  pure def recentBlocks(t: Trust, now: int): List[int] = t.blocksMade.select(x => now - x < DECAY_DAYS)
  // trust.ts:116 reporter credibility: ok, and fewer than 3 stranger blocks in the last 14 days (W3-230)
  pure def credibleT(t: Trust, now: int): bool = t.level == "ok" and recentBlocks(t, now).length() < 3
  // two people of an item that a person block keeps apart (a probing item: the people asked)
  pure def blockedGoing(st: State, o: Opp): Set[(Mid, Mid)] = {
    val inIt = if (o.stage == "probing") o.parts else o.going
    tuples(inIt, inIt).filter(t => t._1 != t._2 and st.personBlocks.contains((t._1.p, t._2.p)))
  }

  // ------------------------------------------------------------------ code paths as pure functions
  // network.ts:1213 caseEvent: no case or a closed one opens a new case; a lifted case reopens.
  pure def caseAfter(c: str, kind: str): str =
    if (c == "none" or c == "closed") "open" else if (c == "lifted" and kind != "hold_lifted") "open" else c

  pure def srcAdd(x: Src, kind: str, by: Mid): Src =
    if (kind == "staff_hold") { ...x, staff: true }
    else if (kind == "report_received") { ...x, reporters: x.reporters.union(Set(by)) }
    else if (kind == "abuse") { ...x, msgs: x.msgs + 1 }
    else { ...x, other: x.other + 1 }

  // network.ts:2756 dropMember (scheduled items: handleDrop; a date closes, a plan goes on without them). A
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

  // trust.ts:83 add, with relevel and the Network's onEvent (caseEvent) and onChange (onTrustChange 1257).
  // A points event restarts the decay clock (SD-141). `notice`: "reply" in the member's own turn, "safety"
  // outside it, "none" when no notice reaches them; the send kind is outboundKind's (SD-475, W3-225).
  pure def addPts(st: State, m: Mid, pts: int, kind: str, by: Mid, notice: str): State = {
    val s1 = addPtsCore(st, m, pts, kind, by, notice)
    val inv = st.invitedBy.get(m)
    // network.ts:1266-1272 inviter accountability: when an invitee reaches hold, the inviter (a member of the
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

  // network.ts:1213 a case event with no points (report_received with 0 points, minor_reported, relay_block)
  pure def caseEv(st: State, m: Mid, kind: str): State = { ...st, caseSt: st.caseSt.set(m, caseAfter(st.caseSt.get(m), kind)) }

  // network.ts:1593 minorReported: a case event, then (first time) the minor flags and dropMember on THIS Network.
  pure def minorReported(st: State, t: Mid): State = {
    val s1 = caseEv(st, t, "minor_reported")
    if (s1.minorF.get(t)) s1
    else { ...s1, minorF: s1.minorF.set(t, true), minorP: s1.minorP.union(Set((t.p, t.app))), opps: dropOpps(s1.opps, t) }
  }

  // network.ts:1284 fileReport (the caller, blockAndReport, writes the case event and keeps the trust rules).
  // Ghost `counted`: the reporters trust.ts:112-121 says count once per target (credible, met).
  pure def fileReport(st: State, rep: Mid, sub: Mid, kind: str, source: str, met: bool, intended: bool, meant: str): State = {
    val rt = st.trust.get(rep)
    val cred = credibleT(rt, st.now) and not(st.banned.contains(rep.p))
    val r: Report = {
      reporter: rep, reporterP: rep.p, origReporter: rep, subject: sub, kind: kind, met: met, source: source, status: "open",
      credible: cred, intended: intended, at: st.now, meantP: meant, bannedAtFiling: st.banned.contains(rep.p)
    }
    val s1 = { ...st, reports: st.reports.union(Set(r)),
               counted: if (credibleT(rt, st.now) and met) st.counted.set(sub, st.counted.get(sub).union(Set(rep))) else st.counted }
    if (reportHeld(s1, sub)) { ...s1, opps: dropOpps(s1.opps, sub) } else s1
  }

  // trust.ts:99 block: a stranger counts once; the window keeps the stranger blocks of the last 14 days and
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

  // trust.ts:113 report: returns the state after the points (0 or 3)
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

  // network.ts:1532 callOffPair on THIS app: every open item that both are still in closes (a member who
  // said no or dropped out is not going, SD-045). A probing item (OPEN_STAGES) closes when both are asked.
  pure def callOffPair(st: State, app: str, a: str, b: str, how: str): State =
    { ...st, opps: OPP_IDS.mapBy(k => {
      val o = st.opps.get(k)
      val inIt = if (o.stage == "probing") o.parts else o.going
      if (o.app == app and (o.stage == "scheduled" or o.stage == "probing") and inIt.exists(x => x.p == a) and inIt.exists(x => x.p == b))
        { ...o, stage: "closed", closedBy: how, blocker: a, target: b, blockRoster: inIt }
      else o
    }) }

  // network.ts:1443 blockAndReport (the target is known): the "report X" / "block X" text and the check-in
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

  // network.ts:916 forget (leave one app: service.ts:821 forget -> forgetMember)
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
    src: st.src.set(m, NO_SRC),
    counted: ALL_MIDS.mapBy(x => if (x == m) Set() else st.counted.get(x).exclude(Set(m))),
    staffCleared: st.staffCleared.exclude(Set(m)),
    leaving: st.leaving.exclude(Set(m)),
    banning: st.banning.exclude(Set(m)),
    clearing: st.clearing.exclude(Set(m)),
  }

  // network.ts:1381 holdMember, decideReports 1421: with no report id every open report about them reads "held";
  // with a report id (`onlyRep`: here the reporter's person) only that report does (W3-231).
  pure def holdMember(st: State, m: Mid, notice: str, onlyRep: str): State = {
    val s1 = if (lvl(st, m) != "hold") {
      val sc = st.trust.get(m).score
      addPts(st, m, if (HOLD - sc > 0) HOLD - sc else 1, "staff_hold", NOBODY, notice)
    } else st
    { ...s1, reports: s1.reports.map(r =>
      if (r.subject == m and r.status == "open" and (onlyRep == "" or r.reporterP == onlyRep)) { ...r, status: "held" } else r) }
  }

  // network.ts:4497-4508 syncMember -> personHold: a person hold that covers a live member who is not on
  // hold holds them like a staff hold (the hold notice is a "safety" send).
  pure def sync(st: State, m: Mid): State =
    if (st.live.get(m) and covered(st, m) and lvl(st, m) != "hold") holdMember(st, m, "safety", "") else st

  // network.ts:1332 markBanned
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
  // slop (network.members.invited_by: only the simulator writes it; production nulls it, runtime.ts:588).
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
    holdDecisions: tuples(PERSONS, HOLD_SCOPES).mapBy(_ => -1),
    nextHold: 0,
    globalHoldReleases: Set(),
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
    lift: NO_LIFT,
    invitedBy: ALL_MIDS.mapBy(m => if (m == INVITEE) INVITER else NOBODY),
    invitesBlockedUntil: ALL_MIDS.mapBy(_ => -1),
    staffHeldP: Set(),
    statedRelayMinors: Set(),
    autoHeldP: Set(),
    minorP: Set(),
    heldMids: Set(),
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
  // off before advance (network.ts:3326), so an item that two blocked people are going to never finalizes.
  // `absent`: who did not come (truth, never read by the code).
  action meet(k: str, absent: Set[Mid]): bool = {
    val o = s.opps.get(k)
    all {
      o.stage == "scheduled", s.now >= o.meetingAt, absent.subseteq(o.going), blockedGoing(s, o) == Set(),
      s' = { ...s, opps: s.opps.set(k, { ...o, stage: "done", absent: absent }), lastAction: "meet" },
    }
  }

  // Feedback keeps its receipt day. The dating slot comes from the booked meeting's local day and hour.
  pure def recordOf(o: Opp, m: Mid, selfNoShow: bool, feedbackAt: int): Inter =
    { parts: o.told, outcome: if (selfNoShow) "no_show" else "completed", at: feedbackAt, meetingAt: o.meetingAt, by: m,
      hour: o.meetHour, slot: slotFromLocalParts(o.meetingAt % 7, o.meetHour) }

  // The answer to the check-in after a meeting (onFeedback 2636). `intent`: what the member means ("fine",
  // "report", "selfNoShow"); `reader`: checkInReport's output (an oracle). After SD-067 a happy answer reads
  // as no report: the corpus evals/network/check-in-reports.jsonl (gate in scripts/sim/evals.ts) checks the
  // reader on direct answers, so the model takes `checkInReaderSound` as a named assumption for this path. The
  // separate immediate danger disclosure path requires exact receipt and counterpart attribution.
  // spec/safetyCase.md, "A ban allows only carrier commands and app leave" (inboundAllowedAfterBan): after the
  // ban rows exist, an ordinary text of the person (a check-in answer, a disclosure, block or report, the answer
  // to "Who do you mean?", any other message) is held: no engagement, no flow. STOP, HELP and "leave <app>"
  // still work (leaveStart and leave have no such guard; STOP is in turn_consent).
  pure def inboundOk(st: State, p: str): bool = not(st.banned.contains(p))
  pure def checkInReaderSound(intent: str, reader: str): bool =
    if (intent == "report") REPORT_KINDS.contains(reader) else reader == "none"
  action checkIn(k: str, m: Mid, intent: str, reader: str): bool = {
    val s0 = sync(s, m)
    val o = s0.opps.get(k)
    val others = o.going.exclude(Set(m))
    // postDateReports on slop and peon (SD-221); never for a plan
    val reportKind = if (o.kind == "date") reader else "none"
    val s1 = { ...s0, opps: s0.opps.set(k, { ...o, feedbackFrom: o.feedbackFrom.union(Set(m)) }),
      inters: s0.inters.union(Set(recordOf(o, m, intent == "selfNoShow", s0.now))) }
    // checkInReported -> blockAndReport for each other (SD-229); the member means the person of the date
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
        wanted: if (reportKind != "none") s2.wanted.union(others.map(x => (m.p, x.p))) else s2.wanted,
        lastAction: "checkIn" },
    }
  }

  // handleImmediateDanger (network.ts). exactReceipt abstracts the matching pending slot, schedule
  // revision and receipt times. The subject supplied by the parser can be unrelated to the meeting.
  action disclose(k: str, app: str, p: str, meant: str, kind: str, exactReceipt: bool): bool = {
    val m = midOf(s, app, p)
    val s0 = sync(s, m)
    val o = s0.opps.get(k)
    val others = o.going.exclude(Set(m))
    val current = exactReceipt and o.stage == "done" and o.kind == "date" and o.app == app
      and o.going.contains(m) and not(o.feedbackFrom.contains(m)) and s.now - o.meetingAt < 7
    val attributed = others.size() == 1 and others.exists(other => other.p == meant)
    all {
      s.live.get(m), inboundOk(s, p), meant != p, REPORT_KINDS.contains(kind),
      if (current and attributed) {
        val replied = { ...s0, opps: s0.opps.set(k, { ...o, feedbackFrom: o.feedbackFrom.union(Set(m)) }) }
        val filed = others.fold(replied, (acc, x) => blockAndReport(acc, m, kind, x, "check_in", true, meant))
        s' = { ...filed,
          wanted: if (s0.metPairs.contains((p, meant))) s0.wanted.union(Set((p, meant))) else s0.wanted,
          lastAction: "dangerReport" }
      } else s' = { ...s0, lastAction: "dangerGuidanceOnly" },
    }
  }

  // An explicit block/report command reaches handleBlock. safetyCase.md models the polite prefix and conditional refusal.
  // route() (service.ts:1085): a member of several apps whose text
  // names a counterpart goes to the app of the newest meeting with them (SD-250); else any app of theirs (the
  // newest item or the last writer). The target is looked up on that app. `ambiguous`: two possible people,
  // so "Who do you mean?" (pendingSafety).
  action report(r: str, app: str, t: str, verb: str, kind: str, ambiguous: bool): bool = {
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
      mine.size() <= 1 or best < 0 or metAtOn(s0, app, r, t) == best,
      if (ambiguous) s' = { ...s0, pendingWho: s0.pendingWho.set(rm, {
        asked: true, at: s0.now, verb: verb, kind: kind, target: t, offered: s0.live.get(tm) and counterpart(s0, rm, tm),
      }), lastAction: "reportAsk" }
      else if (not(s0.live.get(tm))) s' = { ...s0, wanted: w, lastAction: "reportUnresolved" }
      else s' = { ...blockAndReport(s0, rm, if (verb == "report") kind else "none", tm, "message", true, t), wanted: w, lastAction: "report" },
    }
  }

  // The answer to "Who do you mean?" within a day (answerWho 1634): applied only to a counterpart.
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

  pure def currentWhoOffer(st: State, m: Mid, name: str): bool = {
    val p = st.pendingWho.get(m)
    val target = midOf(st, m.app, name)
    st.live.get(m) and p.asked and p.offered and st.now - p.at <= 1 and p.target == name
      and st.live.get(target) and counterpart(st, m, target)
  }

  // The shared route sees one exact name. The same active offer must still be usable under the app lock.
  // An explicit app has its own existing local answer path, modeled by answerWho.
  action answerWhoShared(m: Mid, ordinaryApp: str, explicit: bool): bool = {
    val p = s.pendingWho.get(m)
    val other = midOf(s, ordinaryApp, m.p)
    val matches = liveMidsOf(s, m.p).filter(member => currentWhoOffer(s, member, p.target))
    all {
      p.asked, s.live.get(m), inboundOk(s, m.p), ordinaryApp != m.app, s.live.get(other),
      if (not(explicit) and matches.size() == 1)
        answerWho(matches.fold(NOBODY, (_, member) => member))
      else s' = { ...s, lastAction: "whoSharedPreserved" },
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

  // Staff hold (service.ts:1947). `scope`: "*" for staff with safety@* (or admin@*), else the member's app (staff
  // of that app hold here only, W3-231). The person_holds row (person, scope) first (SD-022), then this app's
  // unit, then one unit per other app for "*". `onlyRep`: a hold from one report (reportId) marks only that one.
  action staffHoldBy(m: Mid, scope: str, onlyRep: str): bool = all {
    s.live.get(m), scope == "*" or scope == m.app,
    onlyRep == "" or s.reports.exists(r => r.subject == m and r.status == "open" and r.reporterP == onlyRep),
    val s1 = holdMember(writeHold(s, m.p, scope), m, "safety", onlyRep)
    s' = { ...s1,
      pendingHold: if (scope == "*") liveMidsOf(s, m.p).exclude(Set(m)) else Set(),
      staffHeldP: s1.staffHeldP.union(Set((m.p, scope))),
      lastAction: "staffHold" },
  }
  action staffHold(m: Mid): bool = staffHoldBy(m, "*", "")
  action staffHoldApply(x: Mid): bool = all {
    s.pendingHold.contains(x), s.live.get(x), globalHoldDecision(s, x) >= 0,
    s' = { ...holdMember(s, x, "safety", ""), pendingHold: s.pendingHold.exclude(Set(x)), lastAction: "staffHoldApply" },
  }
  // The service process stops between two awaits; nothing resumes a loop (the next unit or tick of the other app
  // applies a person hold; a stopped ban waits for the staff retry, W3-232).
  action crash: bool = all {
    s.pendingHold != Set() or s.banning != Set() or s.clearing != Set() or s.leaving != Set() or s.lift.stage != "none",
    s' = { ...s, pendingHold: Set(), banning: Set(), clearing: Set(), leaving: Set(), lift: NO_LIFT, lastAction: "crash" },
  }

  // An authorized lift commits the runtime and durable changes together after verifying the current
  // owner, both decision identifiers and staff scope. A new decision invalidates an in-flight lift.
  pure def liftStillAuthorized(st: State): bool = {
    val l = st.lift
    val local = localHoldDecision(st, l.m)
    val global = globalHoldDecision(st, l.m)
    st.live.get(l.m) and local == l.expectedLocal and global == l.expectedGlobal and
      (global < 0 or l.scope == "*") and (lvl(st, l.m) == "hold" or local >= 0 or global >= 0)
  }
  pure def releaseHold(st: State): State = {
    val l = st.lift
    val memberScope = (l.m.p, l.m.app)
    val ghost = st.staffHeldP.exclude(Set(memberScope))
    val ghost2 = if (st.staffHeldP.contains((l.m.p, "*")) and l.scope == "*")
      ghost.exclude(Set((l.m.p, "*"))).union(APPS.exclude(Set(l.m.app)).map(a => (l.m.p, a))) else ghost
    { ...st, personHolds: st.personHolds.exclude(Set(memberScope)), staffHeldP: ghost2,
      globalHoldReleases: if (l.expectedGlobal >= 0) st.globalHoldReleases.union(Set(memberScope)) else st.globalHoldReleases,
      pendingHold: st.pendingHold.exclude(Set(l.m)) }
  }
  pure def liftUnitOf(st: State): State = {
    val m = st.lift.m
    val t = st.trust.get(m)
    if (st.live.get(m) and t.level == "hold") { ...st,
      trust: st.trust.set(m, { ...t, score: 0, level: "ok", reportsFrom: Set(), lastDecay: st.now }),
      // trust.lift's hold_lifted event opens a case when none is open (caseEvent), and liftHold then marks the
      // open case "lifted" (network.ts:1313-1317): the case always ends "lifted" (W3-228: already so).
      caseSt: st.caseSt.set(m, "lifted"),
      heldMids: st.heldMids.exclude(Set(m)),
      autoHeldP: st.autoHeldP.exclude(Set((m.p, m.app))),
      minorP: st.minorP.exclude(Set((m.p, m.app))),
      counted: st.counted.set(m, Set()),
      src: st.src.set(m, NO_SRC),
      staffCleared: st.staffCleared.union(Set(m)),
      lifts: st.lifts + 1,
      lift: NO_LIFT,
      lastAction: "liftUnit" }
    else { ...st, lift: NO_LIFT, lastAction: "liftNotOnHold" }
  }
  pure def liftRead(st: State, m: Mid, scope: str): Lift =
    { m: m, scope: scope, expectedLocal: localHoldDecision(st, m), expectedGlobal: globalHoldDecision(st, m), stage: "read" }

  pure def commitLift(st: State): State =
    if (liftStillAuthorized(st)) { ...liftUnitOf(releaseHold(st)), lift: { ...st.lift, stage: "tx" }, lastAction: "liftTx" }
    else { ...st, lift: NO_LIFT, lastAction: "liftChanged" }

  action liftStart(m: Mid, scope: str): bool = all {
    s.lift.stage == "none", s.live.get(m), scope == "*" or scope == m.app,
    globalHoldDecision(s, m) < 0 or scope == "*",
    s' = { ...s, lift: liftRead(s, m, scope), lastAction: "liftStart" },
  }
  action liftTx: bool = all { s.lift.stage == "read", s' = commitLift(s) }
  action liftUnit: bool = all { s.lift.stage == "tx", s' = { ...s, lift: NO_LIFT, lastAction: "liftResult" } }
  action liftHoldBy(m: Mid, scope: str): bool = {
    val ready = { ...s, lift: liftRead(s, m, scope) }
    all {
      s.lift.stage == "none", liftStillAuthorized(ready),
      s' = { ...commitLift(ready), lift: NO_LIFT },
    }
  }
  action liftHold(m: Mid): bool = liftHoldBy(m, "*")

  // Staff close a case (network.ts:1323): a held member stays held.
  action closeCase(m: Mid): bool = all {
    s.live.get(m), s.caseSt.get(m) != "none", s.caseSt.get(m) != "closed",
    s' = { ...s, caseSt: s.caseSt.set(m, "closed"),
           staffCleared: if (lvl(s, m) != "hold") s.staffCleared.union(Set(m)) else s.staffCleared,
           lastAction: "closeCase" },
  }

  // Staff dismiss a report (network.ts:1409).
  action dismiss(r: Report): bool = all {
    s.reports.contains(r), r.status == "open",
    val resolved = { ...s, reports: s.reports.exclude(Set(r)).union(Set({ ...r, status: "dismissed" })),
      carriedReports: s.carriedReports.exclude(Set(reportIdentity(r))), lastAction: "dismiss" }
    s' = if (s.live.get(r.subject)) caseEv(resolved, r.subject, "report_dismissed") else resolved,
  }

  // Staff clear a minor signal (service.ts:1977 clearMinor): one unit per app of the person ("*" staff) or this
  // app only, one network at a time (W3-232). Each unit: clearMinorSignal and dismiss the open minor reports.
  action clearMinorStart(m: Mid, scope: str): bool = all {
    s.live.get(m), s.clearing == Set(), scope == "*" or scope == m.app,
    s.minorP.exists(x => x._1 == m.p), not(s.statedRelayMinors.contains(m.p)),
    s' = { ...s, clearing: liveMidsOf(s, m.p).filter(x => scope == "*" or x.app == m.app), lastAction: "clearMinorStart" },
  }
  action clearMinorApply(x: Mid): bool = all {
    s.clearing.contains(x), s.live.get(x),
    s' = { ...s,
      minorF: s.minorF.set(x, false),
      reports: s.reports.map(r => if (r.subject == x and r.kind == "minor" and r.status == "open") { ...r, status: "dismissed" } else r),
      minorP: s.minorP.exclude(Set((x.p, x.app))),
      clearing: s.clearing.exclude(Set(x)),
      lastAction: "clearMinorApply" },
  }

  // Ban by person (service.ts:2014): ban rows, suppression, restricted platform memberships, then one unit per app
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
    val recorded = if (lvl(s, m) != "hold" and s.minorF.get(m) and not(covered(s, m))) writeHold(s, p, app) else s
    all { s.live.get(m), not(s.leaving.contains(m)), s' = { ...recorded, leaving: s.leaving.union(Set(m)), lastAction: "leaveStart" } }
  }
  pure def retainHardHold(st: State, m: Mid): State =
    if (lvl(st, m) == "hold" and not(covered(st, m) or st.banned.contains(m.p)))
      writeHold(st, m.p, m.app)
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
    val recorded = if (lvl(s, m) != "hold" and s.minorF.get(m) and not(covered(s, m))) writeHold(s, p, app) else s
    all { s.live.get(m), s' = { ...forget(retainOpenReports(retainHardHold(recorded, m), m), m), lastAction: "leave" } }
  }

  // A join by text: a banned person is refused; a hold does not refuse a join (PRD 40.3). A former member gets
  // a new member id. A person hold covers the new member (snapshot), and the next unit holds them.
  action join(app: str, p: str): bool = {
    val cur = midOf(s, app, p)
    val again = s.joined.get((app, p))
    val g2 = if (again) cur.g + 1 else cur.g
    val m2 = { app: app, p: p, g: g2 }
    all {
      not(s.live.get(cur)), not(p.in(s.banned)), g2 <= 1,
      s' = { ...s,
        gen: s.gen.set((app, p), g2), joined: s.joined.set((app, p), true),
        live: s.live.set(m2, true), trust: s.trust.set(m2, NO_TRUST), minorF: s.minorF.set(m2, false), caseSt: s.caseSt.set(m2, "none"),
        lastAction: "join" },
    }
  }

  // The signed relay can expose a direct self-age after the request prefix is removed. Commit that age
  // for the person and remove the sender from the current app's opportunities before dispatch. The
  // other relay policy outcomes, including moderation holds, do not supply a stated age.
  action relaySend(k: str, m: Mid, decision: str, selfAge: bool): bool = {
    val o = s.opps.get(k)
    all {
      o.kind == "date", o.stage == "scheduled" or o.stage == "done", o.going.contains(m), s.live.get(m),
      if (selfAge) s' = { ...s,
        minorF: s.minorF.set(m, true),
        statedRelayMinors: s.statedRelayMinors.union(Set(m.p)),
        opps: dropOpps(s.opps, m),
        lastAction: "relayAgeObserved" }
      else s' = { ...(if (decision == "blockSevere") caseEv(s, m, "relay_block") else s),
        relayLog: s.relayLog.union(Set((m, decision))),
        lastAction: "relaySend" },
    }
  }

  // trust.ts:125 decay. Each drop is a negative `decay` trust event; caseEvent adds it to a live case only and
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

  // The tick of every app (network.ts:3523): personHold for every covered member (SD-022), callOffPair for
  // every blocked edge in the snapshot (SD-025), then trust.decay(now).
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
    nondet meant = MEANT.oneOf()
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
      disclose(k, app, a, meant, kind, flag),
      report(a, app, b, verb, kind, flag),
      answerWho(m),
      answerWhoShared(m, app, flag),
      abuse(m, risk),
      staffHoldBy(m, scope, onlyRep),
      staffHoldApply(m),
      crash,
      liftStart(m, scope),
      liftTx,
      liftUnit,
      closeCase(m),
      all { s.reports != Set(), nondet r = s.reports.oneOf() dismiss(r) },
      clearMinorStart(m, scope),
      clearMinorApply(m),
      banStart(a),
      banApply(m),
      shareAsk(a),
      shareYes(a),
      leaveStart(app, a),
      all { s.leaving != Set(), nondet departing = s.leaving.oneOf() leaveFinish(departing) },
      join(app, a),
      relaySend(k, m, decision, flag2),
      tick(d),
    }
  }

  // ------------------------------------------------------------------ invariants (rules, not code)
  // The approved restriction persists while a report is open, met and urgent.
  pure def urgentOpen(r: Report): bool = r.status == "open" and r.met and URGENT.contains(r.kind)

  // PRD 40.3 (docs/prd-snapshot.md:1777) "A safety removal holds the person everywhere ... a safety hold alone
  // does not refuse a join, but the person cannot be matched until staff resolve it"; admin-console 3.7.1
  // "Hold (the person, on every app, until a review)". A staff hold holds every live member of the person.
  // SD-021 (leave and rejoin), SD-022 (join during a hold, the non-atomic loop): fixed in 059965d. W3-226,
  // W3-435: the ghost is (person, scope); a lift on one app keeps the person's other apps under the rule. The
  // row scope and exact decision are checked again inside the lift transaction. A hold by staff of
  // one app holds that app only (W3-231).
  val staffHoldFollowsPerson = s.staffHeldP.forall(h =>
    liveMidsOf(s, h._1).filter(x => h._2 == "*" or x.app == h._2).forall(x => not(matchable(s, x))))

  // trust.ts:6-7 "hold - ... staff review". An automatic hold (reports, abuse) on an app keeps the person's
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
  val urgentMetReportBlocksMatchingInApp = s.reports.forall(r => urgentOpen(r) implies {
    val x = midOf(s, r.subject.app, r.subject.p)
    (s.live.get(x) and (x == r.subject or s.carriedReports.contains(reportIdentity(r)))) implies not(matchable(s, x))
  })

  // trust.ts:6-7 "Holds never decay; only a person lifts them."
  val holdOnlyLiftedByStaff = s.heldMids.forall(m => s.live.get(m) implies lvl(s, m) == "hold")

  // trust.ts:8-11 "one person, or strangers who know a first name, can never put someone on hold";
  // a clean record takes at most HOLD - 1 points from one message.
  val noSingleActorHold = ALL_MIDS.forall(m => (s.live.get(m) and lvl(s, m) == "hold" and not(s.src.get(m).staff)) implies {
    val x = s.src.get(m)
    x.msgs + x.reporters.size() + x.other >= 2
  })

  // A completed report records the ban at filing, independent of the transition's inbound guard.
  val reportsAdmittedBeforeBan = s.reports.forall(r => not(r.bannedAtFiling))

  // PRD 40.3 "Blocks are person to person and apply in every app"; PRD F23 "Block takes effect immediately".
  // No booked item that two blocked people are going to: on the app of the block at once, on every other app
  // at its next tick (callOffPair in the tick, before any meeting finalizes). SD-025 (fixed in de48147).
  val blockClosesAllApps = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    (o.stage == "scheduled" or o.stage == "probing") implies blockedGoing(s, o).forall(t =>
      s.pendingCallOff.exists(e => e._3 != o.app and Set(e._1, e._2) == Set(t._1.p, t._2.p)))
  })

  // PRD F23 "Block ... only affects the pair". A block calls an item off only when the blocker and the target
  // are both on its roster at closure: asked participants for a probe, going participants for a booking.
  // A member who said no to a plan does not call it off for the others. SD-045 (fixed
  // in df588c8). The stricter "nobody else is going" form is `blockLeavesOthersPlan` below (NEW-3).
  val blockOnlyAffectsPair = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    (o.closedBy == "blocked" or o.closedBy == "blocked_elsewhere") implies
      (o.blockRoster.exists(x => x.p == o.blocker) and o.blockRoster.exists(x => x.p == o.target))
  })

  // metBefore doc "Anonymous probes do not count: neither knew who the other was"; trust.ts:9 "only when the
  // reporter shared an opportunity with the target". SD-044 (fixed in f8d9de8).
  val metIsReal = s.reports.forall(r => r.met implies s.metPairs.contains((r.reporterP, r.subject.p)))

  // reports.ts "A plain 'it was fine' or 'not my type' is not a report." A check-in report, block and minor
  // flag come only from an answer that reports something. SD-067 (fixed in 0e0bf2a; the reader is an oracle
  // here, and the corpus gate checks the reader).
  val checkInReportIntended = s.reports.forall(r => r.source == "check_in" implies r.intended)

  // PRD F23 "'report' from any channel"; reports.ts a report is about the person the member names; trust.ts:9
  // the reporter "shared an opportunity with the target". A report (and its block and hold) names the person
  // the member means. The danger path requires attribution to the counterpart of the exact current check-in.
  val reportSubjectMeant = s.reports.forall(r => r.meantP == r.subject.p)

  // AGENTS.md 2026-10-09 item 3 "Bans are by phone number"; network.ts markBanned "never matched or contacted
  // again". Every live member of a banned person is out of matching from the moment the ban row exists. The
  // canonical matching snapshot covers an app whose runtime has not applied its own restriction (W3-223).
  val bannedNeverMatchable = s.banned.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

  // spec/safetyCase.md, "A ban allows only carrier commands and app leave" (upstream PR #496): a banned person has
  // no live profile-share grant and no pending text flow; the ban transaction removes both and a share reads the ban.
  val banRevokesShares = s.banned.forall(p => not(s.shareGrants.contains(p)) and not(s.pendingTexts.contains(p)))

  // spec/memberAge.md: the member's own direct age from the bound relay text enters the same
  // durable age floor as a direct chat statement. It keeps that person ineligible on every app.
  val relayAgeSignalReachesAgePolicy = s.statedRelayMinors.forall(p =>
    liveMidsOf(s, p).forall(m => not(matchable(s, m))))

  // "report X" and the check-in are both reports; trust.ts:8-10 each credible reporter who met them counts
  // once per target. SD-229 (fixed in db4ea4c).
  val reportersCounted = ALL_MIDS.forall(m => s.live.get(m) implies s.counted.get(m).subseteq(s.trust.get(m).reportsFrom))

  // trust.ts:4-5 "Watch lasts until the score decays below 3: 14 days from 3". SD-141 (fixed in db176ce).
  val watchLasts14Days = not(s.earlyWatchExit)

  // network.ts o.post "came: !f.selfNoShow": a no-show counts against the person who did not come. SD-222
  // (fixed in 581888d).
  val noShowCountsAbsentOnly = ALL_MIDS.forall(m => s.live.get(m) implies
    noShows(s, m) <= OPP_IDS.filter(k => s.opps.get(k).absent.contains(m) and s.opps.get(k).stage != "deleted").size())

  // The Slop profile reads completed attendance using the booked meeting time in its local zone.
  val slotFromMeeting = s.inters.forall(i => i.outcome == "completed" implies
    i.slot == slotFromLocalParts(i.meetingAt % 7, i.hour))

  // PRD F23 "'report' from any channel ... Reports create a safety case"; the slop and peon check-in copy. A
  // report about someone the member met is filed, as met, whatever app the message comes in on. SD-220
  // (33ea2bc), SD-221 (9b8ef32), SD-250 (4878d3c): fixed.
  val everyMetReportFiled = s.wanted.forall(w =>
    s.reports.exists(r => r.reporterP == w._1 and r.subject.p == w._2 and r.met))

  // PRD 1420 "moderation holds on relay messages" in the safety console; PRD F23 reports go to a safety case.
  // A relay message blocked for the sender's own words (a threat, a slur) reaches the sender's safety case.
  // SD-254 (fixed in fa81646).
  val relayBlockReachesSafety = s.relayLog.forall(x => (x._2 == "blockSevere" and s.live.get(x._1)) implies s.caseSt.get(x._1) != "none")

  // network.ts timingOf: a "safety" notice goes "now"; blooio outbound-queue.ts quiet hours apply to
  // "transactional". A hold notice is never queued as transactional. SD-475 (fixed in 49602b7).
  val safetyNoticeImmediate = s.holdNotices.forall(x => x._2 != "transactional")

  // SD-027, visibility part (W3-235). trust.ts:6 "hold - ... staff review"; PRD 1420 the safety console lists
  // "members on watch and hold with the events that caused it". A member that the slop trust_review rule keeps
  // out of matching has an open (or held) safety case.
  val engineHoldVisible = ALL_MIDS.forall(m => (s.live.get(m) and trustReview(s, m)) implies Set("open", "held").contains(s.caseSt.get(m)))

  // SD-027, block part (W3-235). trust.ts:8-11 "strangers who know a first name can never put someone on hold";
  // network-consent-14 blocks of people you never met count against the blocker, not the target. The
  // trust_review rule by blocks needs two blockers with a settled encounter before the block.
  pure def metBlockers(st: State, m: Mid): int = PERSONS.filter(q => st.personBlocks.contains((q, m.p)) and st.metPairs.contains((q, m.p))).size()
  val strangersCannotEngineHold = ALL_MIDS.forall(m => (s.live.get(m) and m.app == "slop" and blockedBy(s, m) >= 2
    and not(noShows(s, m) >= 2 and noShows(s, m) > dates(s, m))) implies metBlockers(s, m) >= 2)

  // Every rule above.
  val safety = and {
    staffHoldFollowsPerson,
    autoHoldFollowsPersonInApp,
    minorSignalFollowsPersonInApp,
    urgentMetReportBlocksMatchingInApp,
    holdOnlyLiftedByStaff,
    noSingleActorHold,
    reportsAdmittedBeforeBan,
    blockClosesAllApps,
    blockOnlyAffectsPair,
    metIsReal,
    checkInReportIntended,
    reportersCounted,
    watchLasts14Days,
    noShowCountsAbsentOnly,
    slotFromMeeting,
    everyMetReportFiled,
    relayBlockReachesSafety,
    safetyNoticeImmediate,
    banRevokesShares,
    // wave 4: rules that fail on the code now (code items; see docs/research/quint-findings/safety_trust.md)
    reportSubjectMeant,
    bannedNeverMatchable,
    relayAgeSignalReachesAgePolicy,
    engineHoldVisible,
    strangersCannotEngineHold,
  }

  // ------------------------------------------------------------------ rules kept out of `safety`
  // Each of these still fails on the code. They are not in `safety` because the fix needs a decision that is
  // not ours to make; the run tests below replay a trace for each.

  // SD-074 (the automatic and report parts are skipped: they need a founder decision). admin-console 4.6 "a hold
  // on any app holds the person everywhere": an automatic hold or an urgent report on one app does not reach the
  // person's other apps (platform.person_holds gets a row only from a staff hold or a leave). It is not clear
  // which staff decision ends such a hold on the other apps.
  val autoHoldFollowsPerson = s.autoHeldP.forall(h => liveMidsOf(s, h._1).forall(x => not(matchable(s, x))))

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
  val witness_carryoverHold = not(ALL_MIDS.exists(m => m.g == 1 and s.live.get(m) and lvl(s, m) == "hold" and s.personHolds.exists(h => h._1 == m.p and h._2 == m.app)))
  val witness_callOffElsewhere = not(OPP_IDS.exists(k => s.opps.get(k).closedBy == "blocked_elsewhere"))
  val witness_relayCase = not(s.relayLog.exists(x => x._2 == "blockSevere" and s.live.get(x._1) and s.caseSt.get(x._1) == "open"))
  // wave 4 paths
  val witness_banStopped = not(s.banned.exists(p => s.banning == Set() and liveMidsOf(s, p).exists(x => not(s.restricted.contains(x)))))
  val witness_liftInFlight = not(s.lift.stage == "tx")
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
      .expect(lvl(s, CY_S) == "hold" and noSingleActorHold and reportsAdmittedBeforeBan)
      .then(liftHold(CY_S))
      .expect(lvl(s, CY_S) == "ok" and s.caseSt.get(CY_S) == "lifted")

  // SD-021 retained requirement: staff hold ben, ben leaves slop and joins again. The modeled person hold
  // excludes the rejoin from matching and the next unit marks it held. An authorized staff lift ends it.
  run sd021LeaveRejoinKeepsHoldTest =
    init
      .then(staffHold(BEN_S))
      .then(staffHoldApply(BEN_P))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(staffHoldFollowsPerson and not(matchable(s, BEN_S1)) and covered(s, BEN_S1))
      .then(tick(1))
      .expect(lvl(s, BEN_S1) == "hold" and safety)
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
      .expect(not(witness_carryoverHold))

  // SD-021 retained requirement: a minor report on slop, a leave and a rejoin. The new member is held.
  run sd021MinorReportCarriedOverTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(not(matchable(s, BEN_S1)) and minorSignalFollowsPersonInApp and urgentMetReportBlocksMatchingInApp)

  // SD-022 (fixed): staff hold on slop, the process stops before the peon unit: ben@peon is covered (not
  // matchable) and the next tick holds him.
  run sd022HoldNotAtomicTest =
    init
      .then(staffHold(BEN_S))
      .then(crash)
      .expect(staffHoldFollowsPerson and not(matchable(s, BEN_P)) and lvl(s, BEN_P) == "ok")
      .then(tick(1))
      .expect(lvl(s, BEN_P) == "hold" and safety)

  // SD-022 (fixed): cy is held on slop, then joins peon: the new member is covered and held.
  run sd022JoinDuringHoldTest =
    init
      .then(staffHold(CY_S))
      .then(join("peon", "cy"))
      .expect(staffHoldFollowsPerson and not(matchable(s, CY_P)))
      .then(tick(1))
      .expect(lvl(s, CY_P) == "hold")

  // SD-022 (fixed): the new member's own text is held first (syncMember), so it stops at the hold return.
  run sd022JoinDuringHoldTextTest =
    init
      .then(staffHold(CY_S))
      .then(join("peon", "cy"))
      .then(abuse(CY_P, 1).fail())

  run minorReportRemainsInOriginAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .expect(minorSignalFollowsPersonInApp and not(matchable(s, BEN_S)) and matchable(s, BEN_P))

  // SD-025 (fixed): a slop date and a peon date between ana and ben; ana blocks ben on slop. The peon item stays
  // scheduled until the next tick (it cannot finalize first), then it closes.
  run sd025BlockAcrossAppsTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "peon", "ana", "ben"))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(blockClosesAllApps and s.opps.get("o1").stage == "closed" and s.opps.get("o2").stage == "scheduled")
      .then(tick(1))
      .expect(s.opps.get("o2").stage == "closed" and s.opps.get("o2").closedBy == "blocked_elsewhere" and safety)

  run crossAppBlockClosesCurrentProbeTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDateAt("o2", "peon", "ana", "ben", 19, true))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(tick(1))
      .expect(s.opps.get("o2").closedBy == "blocked_elsewhere" and blockOnlyAffectsPair and safety)

  // SD-025 (fixed): the other app's item cannot finalize before the tick calls it off.
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

  // The canonical ban prevents a new ordinary report even before the app projects the restriction.
  run sd072BannedReporterTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(banStart("ben"))
      .expect(s.banning.contains(BEN_S) and s.reports == Set() and matchable(s, ANA_S))
      .then(report("ben", "slop", "ana", "report", "harassment", false).fail())

  // An admitted urgent report keeps its matching restriction after its reporter leaves.
  run openReportSurvivesReporterLeaveTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(staffHold(BEN_S))
      .then(report("ben", "slop", "ana", "report", "harassment", false))
      .expect(not(matchable(s, ANA_S)))
      .then(leave("slop", "ben"))
      .expect(not(matchable(s, ANA_S)) and urgentMetReportBlocksMatchingInApp and reportsAdmittedBeforeBan)

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

  // SD-229 (fixed): two check-in reports by people who met ben add trust points (watch).
  run sd229CheckInCountedTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "slop", "cy", "ben"))
      .then(meet("o1", Set()))
      .then(meet("o2", Set()))
      .then(checkIn("o1", ANA_S, "report", "no_show"))
      .then(checkIn("o2", CY_S, "report", "no_show"))
      .expect(reportersCounted and s.trust.get(BEN_S).reportsFrom == Set(ANA_S, CY_S) and lvl(s, BEN_S) == "watch")

  run exactDangerCheckInFilesOneReportWithoutAttendanceTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(disclose("o1", "slop", "ana", "ben", "harassment", true))
      .expect(s.lastAction == "dangerReport" and everyMetReportFiled
              and s.reports.exists(r => r.reporter == ANA_S and r.subject == BEN_S and r.source == "check_in" and r.met)
              and s.inters == Set() and not(matchable(s, BEN_S)))
      .then(disclose("o1", "slop", "ana", "ben", "harassment", true))
      .expect(s.lastAction == "dangerGuidanceOnly" and s.reports.size() == 1 and s.inters == Set())

  // SD-221 (fixed): a peon check-in answer that reports something files the report.
  run sd221PeonCheckInTest =
    init
      .then(bookDate("o1", "peon", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_P, "report", "harassment"))
      .expect(everyMetReportFiled and s.reports.exists(r => r.subject == BEN_P and r.met))

  run planCheckInLeavesExplicitReportAvailableTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", false))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "report", "harassment"))
      .expect(s.reports == Set() and everyMetReportFiled)
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .expect(everyMetReportFiled and s.reports.exists(r => r.subject == BEN_S and r.source == "message"))

  // SD-250 (fixed): ana met ben on slop; "report Ben" cannot go to peon, it goes to slop and holds ben there.
  run sd250ReportRoutedToMeetingTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .expect(everyMetReportFiled and not(matchable(s, BEN_S)))

  // SD-250 (fixed): the route never sends that text to peon, where ben is a stranger.
  run sd250NotRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "peon", "ben", "report", "harassment", false).fail())

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

  // SD-442: the answer comes the next day. The record keeps the feedback day and the earlier booked slot.
  run sd442SlotTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(tick(1))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(slotFromMeeting and s.inters.forall(i => i.at == 1 and i.meetingAt == 0 and i.slot == 0))

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

  // SD-254 (fixed): a relay block for ben's own words opens a case; a photo block opens nothing.
  run sd254RelayBlockTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySend("o1", ANA_S, "block", false))
      .expect(s.caseSt.get(ANA_S) == "none")
      .then(relaySend("o1", BEN_S, "blockSevere", false))
      .expect(relayBlockReachesSafety and s.caseSt.get(BEN_S) == "open")

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

  // W3-218: a current prompt with Ben supplies no authority to report Cy.
  run dangerAboutDifferentCounterpartTest =
    init
      .then(bookDate("o1", "slop", "ana", "cy"))
      .then(meet("o1", Set()))
      .then(tick(1))
      .then(bookDate("o2", "slop", "ana", "ben"))
      .then(meet("o2", Set()))
      .then(disclose("o2", "slop", "ana", "cy", "harassment", true))
      .expect(s.lastAction == "dangerGuidanceOnly" and s.reports == Set() and s.personBlocks == Set())
      .then(report("ana", "slop", "cy", "report", "harassment", false))
      .expect(reportSubjectMeant and everyMetReportFiled and not(matchable(s, CY_S)) and matchable(s, BEN_S))

  run dangerWithoutExactCurrentPromptTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(disclose("o1", "slop", "ana", "ben", "harassment", false))
      .expect(s.lastAction == "dangerGuidanceOnly" and s.reports == Set() and s.inters == Set())

  // W3-219: danger concerning someone outside the connection does not file against the counterpart.
  run dangerAboutUnrelatedPersonTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(disclose("o1", "slop", "ana", "boss", "harassment", true))
      .expect(s.lastAction == "dangerGuidanceOnly" and s.reports == Set() and s.personBlocks == Set())

  // W3-220: the same disclosure on an unrelated app gives guidance and leaves the original check-in intact.
  run dangerRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(disclose("o1", "peon", "ana", "ben", "harassment", false))
      .expect(s.lastAction == "dangerGuidanceOnly" and everyMetReportFiled and matchable(s, BEN_S)
              and s.reports == Set() and s.opps.get("o1").feedbackFrom == Set())

  // W3-220: another app would receive a reply by the ordinary route, but only Slop asked for this name.
  run sharedWhoKeepsTheOriginatingAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(answerWhoShared(ANA_S, "peon", false))
      .expect(everyMetReportFiled and s.reports.exists(r => r.subject == BEN_S and r.met)
              and not(s.reports.exists(r => r.subject == BEN_P)) and not(s.pendingWho.get(ANA_S).asked))

  run sharedWhoDoesNotGuessBetweenAppsTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "peon", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(report("ana", "peon", "ben", "report", "harassment", true))
      .then(answerWhoShared(ANA_S, "peon", false))
      .expect(s.reports == Set() and s.pendingWho.get(ANA_S).asked and s.pendingWho.get(ANA_P).asked)

  run sharedWhoDoesNotOverrideAnExplicitAppOrUseExpiredOffersTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(answerWhoShared(ANA_S, "peon", true))
      .expect(s.reports == Set() and s.pendingWho.get(ANA_S).asked)
      .then(tick(2))
      .then(answerWhoShared(ANA_S, "peon", false))
      .expect(s.reports == Set() and everyMetReportFiled)

  run sharedWhoDoesNotUseANameThatWasNeverOfferedTest =
    init
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(answerWhoShared(ANA_S, "peon", false))
      .expect(s.reports == Set() and everyMetReportFiled and not(s.pendingWho.get(ANA_S).offered))

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

  run staleLocalLiftKeepsNewGlobalHoldTest =
    init
      .then(staffHoldBy(ANA_S, "slop", ""))
      .then(liftStart(ANA_S, "slop"))
      .then(staffHoldBy(ANA_P, "*", ""))
      .then(staffHoldApply(ANA_S))
      .then(liftTx)
      .expect(s.lastAction == "liftChanged" and staffHoldFollowsPerson and covered(s, ANA_S) and covered(s, ANA_P))

  // W3-644: with no race, staff of one app cannot lift a hold on every app (needs_safety_everywhere).
  run w3_644OneAppStaffRefusedTest =
    init
      .then(staffHold(ANA_S))
      .then(liftStart(ANA_S, "slop").fail())

  // W3-231, W3-435: a lift by safety@* staff on slop keeps a row for peon; a rejoin on peon is held.
  run w3_435LiftKeepsOtherAppsTest =
    init
      .then(staffHold(BEN_S))
      .then(liftStart(BEN_S, "*"))
      .then(liftTx)
      .then(liftUnit)
      .expect(s.personHolds == Set(("ben", "*")) and not(covered(s, BEN_S)) and lvl(s, BEN_S) == "ok" and covered(s, BEN_P) and staffHoldFollowsPerson)

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

  // 8 pm in New York on Monday is midnight UTC on Tuesday during daylight saving time.
  run w3_237SlotZoneTest =
    init
      .then(bookDateAt("o1", "slop", "ana", "ben", 20, false))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(slotFromMeeting and s.inters.exists(i => i.slot == 0))

  run relaySelfAgeCommitsBeforeDispatchTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySend("o1", BEN_S, "hold", false))
      .expect(matchable(s, BEN_S) and matchable(s, BEN_P))
      .then(relaySend("o1", BEN_S, "pass", true))
      .expect(relayAgeSignalReachesAgePolicy and s.opps.get("o1").stage == "closed"
        and not(matchable(s, BEN_S)) and not(matchable(s, BEN_P)) and not(s.relayLog.contains((BEN_S, "pass"))))

  // W3-232: a block closes a probing item on its app at once and on the other app at the tick; it cannot book.
  run w3_232ProbingBlockTest =
    init
      .then(bookDateAt("o1", "slop", "ana", "ben", 19, true))
      .then(bookDateAt("o2", "peon", "ana", "ben", 19, true))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(s.opps.get("o1").stage == "closed" and s.opps.get("o2").stage == "probing" and blockClosesAllApps)
      .then(confirm("o2").fail())

  // A later reporter ban leaves the exact open report pending until staff dismiss it.
  run openReportSurvivesReporterBanTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .expect(matchable(s, ANA_S) and matchable(s, BEN_S))
      .then(report("ana", "slop", "ben", "report", "harassment", false))
      .expect(not(matchable(s, BEN_S)) and matchable(s, BEN_P))
      .then(banStart("ana"))
      .expect(not(matchable(s, BEN_S)) and reportsAdmittedBeforeBan)
      .then(banApply(ANA_P))
      .then(banApply(ANA_S))
      .then(closeCase(BEN_S))
      .expect(not(matchable(s, BEN_S)) and urgentMetReportBlocksMatchingInApp)
      .then(all { nondet r = s.reports.oneOf() dismiss(r) })
      .expect(matchable(s, BEN_S) and s.reports.forall(r => r.status == "dismissed"))
}
```
