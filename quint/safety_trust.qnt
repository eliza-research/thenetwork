// quint-check: max-steps=14 max-samples=6000 verify-steps=2
// Safety and trust (docs/research/2026-11-07-state-machines.md section 6.9). Machines: person-safety-carryover
// (M-051), trust-level (M-052), safety-report (M-053), pair-relations (M-054), slop-check-in-report (M-055),
// slop-review-hold (M-056), safety-case (M-127), pending-safety-who (M-128). journey-help (M-183) has no
// state in the Network (HELP returns before any safety state changes), so it is not modelled.
//
// The model follows the code on branch wave2/safety_trust (the fixes f8d9de8..49602b7):
//   packages/network/src/trust.ts            add 83 (a points event restarts the decay clock, SD-141), block 99,
//                                            report 113, lift 60, decay 125
//   packages/network/src/reports.ts          report kinds, URGENT_REPORTS, checkInReport (an oracle here; the
//                                            corpus evals/network/check-in-reports.jsonl checks it, SD-067)
//   packages/network/src/network.ts          onTrustChange 1192, caseEvent 1213, liftHold 1248, closeCase 1258,
//                                            fileReport 1284, reportHeld 1300 (a held reporter holds nobody,
//                                            SD-072), holdMember 1316, markBanned 1332, dismissReport 1346,
//                                            metBefore 1394 (bookedTold, SD-044), handleBlock 1412, applyBlock 1428,
//                                            blockAndReport 1443 (SD-229), callOffPair 1469 (SD-045, SD-025),
//                                            counterparts 1488, safetyTargetAt 1549 (SD-250), answerWho 1571,
//                                            minorReported 1593, dropMember 2607, onFeedback 2636 (record `by`,
//                                            the meeting time and the bookedTold people, SD-222, SD-442, SD-044;
//                                            postDateReports),
//                                            checkInReported 2687, lateCheckInReport 2698 (SD-220), forget 916,
//                                            tick 3326 (personHold, callOffPair on snapshot blocks, decay 3358),
//                                            syncMember/personHold/safetyHeld 4497-4514 (SD-021, SD-022),
//                                            RelayHost.severeBlock 4850 (SD-254)
//   packages/network/service/service.ts      route 980 (a block/report text goes to the app of the newest
//                                            meeting, SD-250), forget 821 (leave writes a person hold, SD-021),
//                                            liftHold 1562, hold 1720 (person_holds row first, SD-022), ban
//   packages/network/service/packs.ts        peonHooks postDateReports (SD-221)
//   packages/network/service/runtime.ts      send kind 430 (meta.safety is the "safety" kind, SD-475),
//                                            person_blocks write
//   packages/network/service/snapshot.ts     person_holds -> member.safetyHold
//   packages/network/src/relay.ts            RelayDesk.apply 236-246 (a severe block calls severeBlock)
//   packages/engine/src/packs/slop/rules.ts  reviewReason (trust_review; SD-027 is skipped)
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
// (member generation 0..1), 3 opportunity slots. Staff in the model have the safety@* role.
module safety_trust {
  // ------------------------------------------------------------------ types
  type Mid = { app: str, p: str, g: int }
  type Trust = { rec: bool, score: int, level: str, reportsFrom: Set[Mid], lastDecay: int, strangers: Set[Mid] }
  type Opp = {
    app: str, kind: str, parts: Set[Mid], going: Set[Mid], told: Set[Mid], stage: str, meetingAt: int,
    feedbackFrom: Set[Mid], absent: Set[Mid], closedBy: str, blocker: str, target: str
  }
  // origReporter: a ghost that keeps the reporter after a leave (the code blanks reporterId).
  type Report = {
    reporter: Mid, reporterP: str, origReporter: Mid, subject: Mid, kind: str, met: bool, source: str, status: str,
    credible: bool, intended: bool, at: int
  }
  type Inter = { parts: Set[Mid], outcome: str, at: int, meetingAt: int, by: Mid }
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
    // platform.person_holds: (person, app or "*")
    personHolds: Set[(str, str)],
    opps: str -> Opp,
    reports: Set[Report],
    inters: Set[Inter],
    banned: Set[str],
    restricted: Set[Mid],
    pendingHold: Set[Mid],
    pendingWho: Mid -> Who,
    relayLog: Set[(Mid, str)],
    // ghosts (never read by the modelled code)
    staffHeldP: Set[str],
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
  // reports.ts:15
  pure val URGENT = Set("harassment", "unsafe", "scam", "minor")
  pure val REPORT_KINDS = Set("harassment", "no_show", "minor")

  pure val NO_TRUST: Trust = { rec: false, score: 0, level: "ok", reportsFrom: Set(), lastDecay: -1, strangers: Set() }
  pure val NO_SRC: Src = { msgs: 0, reporters: Set(), staff: false, other: 0 }
  pure val NO_WHO: Who = { asked: false, at: 0, verb: "", kind: "", target: "" }
  pure val FREE_OPP: Opp = {
    app: "", kind: "", parts: Set(), going: Set(), told: Set(), stage: "free", meetingAt: -1,
    feedbackFrom: Set(), absent: Set(), closedBy: "", blocker: "", target: ""
  }

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def imax(a: int, b: int): int = if (a > b) a else b

  var s: State

  // ------------------------------------------------------------------ derived values
  pure def midOf(st: State, app: str, p: str): Mid = { app: app, p: p, g: st.gen.get((app, p)) }
  pure def liveMidsOf(st: State, p: str): Set[Mid] = APPS.map(a => midOf(st, a, p)).filter(m => st.live.get(m))
  pure def lvl(st: State, m: Mid): str = st.trust.get(m).level
  // trust.level of a reporter id; a reporter who left has the blank id, which has no record ("ok")
  pure def repLvl(st: State, m: Mid): str = if (m == NOBODY) "ok" else lvl(st, m)
  // network.ts:1300 reportHeld: open, met, urgent, and the reporter is not on hold (SD-072)
  pure def reportHeld(st: State, m: Mid): bool =
    st.reports.exists(r => r.subject == m and r.status == "open" and r.met and URGENT.contains(r.kind) and repLvl(st, r.reporter) != "hold")
  // network.ts:4512 safetyHeld: what a leave carries over to platform.person_holds
  pure def safetyHeld(st: State, m: Mid): bool = lvl(st, m) == "hold" or reportHeld(st, m) or st.minorF.get(m)
  // snapshot.ts: a person_holds row for this app or "*" covers the member (member.safetyHold)
  pure def covered(st: State, m: Mid): bool = st.personHolds.exists(h => h._1 == m.p and (h._2 == m.app or h._2 == "*"))
  // engine slop profile.ts histories: a check-in record (by) counts for the member who gave it (SD-222)
  pure def noShows(st: State, m: Mid): int = st.inters.filter(i => i.by == m and i.outcome == "no_show").size()
  pure def dates(st: State, m: Mid): int = st.inters.filter(i => i.by == m and i.outcome == "completed").size()
  // profile.ts: a "blocked" edge per blocker (person blocks reach every app's snapshot)
  pure def blockedBy(st: State, m: Mid): int = PERSONS.filter(q => st.personBlocks.contains((q, m.p))).size()
  // slop rules.ts with SLOP_DEFAULT_OPTIONS trust { blockedBy: 2, noShows: 2 }
  pure def trustReview(st: State, m: Mid): bool =
    m.app == "slop" and (blockedBy(st, m) >= 2 or (noShows(st, m) >= 2 and noShows(st, m) > dates(st, m)))
  // engineInput holds, not_ready (restricted account). Matching runs in the tick after personHold, so a
  // member that a person hold covers is held at matching time.
  pure def matchable(st: State, m: Mid): bool =
    st.live.get(m) and lvl(st, m) == "ok" and not(st.minorF.get(m)) and not(reportHeld(st, m)) and not(st.restricted.contains(m)) and not(covered(st, m))
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
  // trust.ts:115 reporter credibility
  pure def credibleT(t: Trust): bool = t.level == "ok" and t.strangers.size() < 3
  // two people of an item that a person block keeps apart
  pure def blockedGoing(st: State, o: Opp): Set[(Mid, Mid)] =
    tuples(o.going, o.going).filter(t => t._1 != t._2 and st.personBlocks.contains((t._1.p, t._2.p)))

  // ------------------------------------------------------------------ code paths as pure functions
  // network.ts:1213 caseEvent: no case or a closed one opens a new case; a lifted case reopens.
  pure def caseAfter(c: str, kind: str): str =
    if (c == "none" or c == "closed") "open" else if (c == "lifted" and kind != "hold_lifted") "open" else c

  pure def srcAdd(x: Src, kind: str, by: Mid): Src =
    if (kind == "staff_hold") { ...x, staff: true }
    else if (kind == "report_received") { ...x, reporters: x.reporters.union(Set(by)) }
    else if (kind == "abuse") { ...x, msgs: x.msgs + 1 }
    else { ...x, other: x.other + 1 }

  // network.ts:2607 dropMember (scheduled items: handleDrop; a date closes, a plan goes on without them)
  pure def dropOpps(opps: str -> Opp, m: Mid): str -> Opp =
    OPP_IDS.mapBy(k => {
      val o = opps.get(k)
      if (o.stage == "scheduled" and o.going.contains(m))
        if (o.kind == "date" or o.going.exclude(Set(m)).size() < 2) { ...o, stage: "closed", closedBy: "dropped" }
        else { ...o, going: o.going.exclude(Set(m)) }
      else o
    })

  // trust.ts:83 add, with relevel and the Network's onEvent (caseEvent) and onChange (onTrustChange 1192).
  // A points event restarts the decay clock (SD-141). `notice`: the send kind of the hold notice ("reply"
  // in the member's own turn, else "safety" since SD-475, runtime.ts:430; "none" when no notice reaches them).
  pure def addPts(st: State, m: Mid, pts: int, kind: str, by: Mid, notice: str): State = {
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
      holdNotices: if (notice == "none") s2.holdNotices else s2.holdNotices.union(Set((m, notice))),
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
  pure def fileReport(st: State, rep: Mid, sub: Mid, kind: str, source: str, met: bool, intended: bool): State = {
    val rt = st.trust.get(rep)
    val cred = credibleT(rt) and not(st.banned.contains(rep.p))
    val r: Report = {
      reporter: rep, reporterP: rep.p, origReporter: rep, subject: sub, kind: kind, met: met, source: source, status: "open",
      credible: cred, intended: intended, at: st.now
    }
    val s1 = { ...st, reports: st.reports.union(Set(r)),
               counted: if (credibleT(rt) and met) st.counted.set(sub, st.counted.get(sub).union(Set(rep))) else st.counted }
    if (reportHeld(s1, sub)) { ...s1, opps: dropOpps(s1.opps, sub) } else s1
  }

  // trust.ts:99 block
  pure def trustBlock(st: State, from: Mid, target: Mid, met: bool): State = {
    val t = st.trust.get(from)
    if (met or t.strangers.contains(target)) st
    else {
      val t2 = { ...t, rec: true, strangers: t.strangers.union(Set(target)) }
      val s1 = { ...st, trust: st.trust.set(from, t2) }
      if (t2.strangers.size() == 3) addPts(s1, from, 2, "block_abuse", NOBODY, "reply") else s1
    }
  }

  // trust.ts:113 report: returns the state after the points (0 or 3)
  pure def trustReport(st: State, target: Mid, by: Mid, met: bool): (State, int) = {
    val r = { ...st.trust.get(target), rec: true }
    val b = { ...st.trust.get(by), rec: true }
    val st0 = { ...st, trust: st.trust.set(target, r).set(by, b) }
    if (not(credibleT(b)) or not(met)) (st0, 0)
    else if (r.reportsFrom.contains(by)) (st0, 0)
    else {
      val r2 = { ...r, reportsFrom: r.reportsFrom.union(Set(by)) }
      val st1 = { ...st0, trust: st0.trust.set(target, r2) }
      if (r2.reportsFrom.size() >= 2 or r2.score > 0) (addPts(st1, target, 3, "report_received", by, "safety"), 3)
      else (st1, 0)
    }
  }

  // network.ts:1469 callOffPair on THIS app: every scheduled item that both are going to closes (a member who
  // said no or dropped out is not going, SD-045).
  pure def callOffPair(st: State, app: str, a: str, b: str, how: str): State =
    { ...st, opps: OPP_IDS.mapBy(k => {
      val o = st.opps.get(k)
      if (o.app == app and o.stage == "scheduled" and o.going.exists(x => x.p == a) and o.going.exists(x => x.p == b))
        { ...o, stage: "closed", closedBy: how, blocker: a, target: b }
      else o
    }) }

  // network.ts:1443 blockAndReport (the target is known): the "report X" / "block X" text and the check-in
  // report (SD-229). The block becomes a person block in the same save (runtime.ts person_blocks write); the
  // other apps call the pair off at their next tick (SD-025, ghost pendingCallOff).
  pure def blockAndReport(st: State, m: Mid, kind: str, target: Mid, source: str, intended: bool): State = {
    val met = metBefore(st, m, target)
    val s1 = {
      ...st,
      blocks: st.blocks.union(Set(Set(m, target))),
      personBlocks: st.personBlocks.union(Set((m.p, target.p))),
      pendingCallOff: st.pendingCallOff.union(Set((m.p, target.p, m.app))),
      staffCleared: st.staffCleared.filter(x => x.p != target.p),
    }
    val s2 = trustBlock(s1, m, target, met)
    val s3 = callOffPair(s2, m.app, m.p, target.p, "blocked")
    if (kind == "none") s3
    else {
      val tr = trustReport(s3, target, m, met)
      val s4 = if (tr._2 == 0) caseEv(tr._1, target, "report_received") else tr._1
      val s5 = fileReport(s4, m, target, kind, source, met, intended)
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
  }

  // network.ts:1316 holdMember (no reportId: every open report about them reads "held")
  pure def holdMember(st: State, m: Mid, notice: str): State = {
    val s1 = if (lvl(st, m) != "hold") {
      val sc = st.trust.get(m).score
      addPts(st, m, if (HOLD - sc > 0) HOLD - sc else 1, "staff_hold", NOBODY, notice)
    } else st
    { ...s1, reports: s1.reports.map(r => if (r.subject == m and r.status == "open") { ...r, status: "held" } else r) }
  }

  // network.ts:4497-4508 syncMember -> personHold: a person hold that covers a live member who is not on
  // hold holds them like a staff hold (the hold notice is a "safety" send).
  pure def sync(st: State, m: Mid): State =
    if (st.live.get(m) and covered(st, m) and lvl(st, m) != "hold") holdMember(st, m, "safety") else st

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
  // Everyone is an adult member of slop; ana and ben are also on peon. cy may join peon later.
  pure val INIT_LIVE = ALL_MIDS.mapBy(m => m.g == 0 and (m.app == "slop" or m.p != "cy"))
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
    personHolds: Set(),
    opps: OPP_IDS.mapBy(_ => FREE_OPP),
    reports: Set(),
    inters: Set(),
    banned: Set(),
    restricted: Set(),
    pendingHold: Set(),
    pendingWho: ALL_MIDS.mapBy(_ => NO_WHO),
    relayLog: Set(),
    staffHeldP: Set(),
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
  // A reviewed 1:1 date is booked and both are told (approvalCheck and the slop review_hold rule).
  pure def bookable(st: State, m: Mid): bool = matchable(st, m) and not(trustReview(st, m))
  action bookDate(k: str, app: str, a: str, b: str): bool = {
    val ma = midOf(s, app, a)
    val mb = midOf(s, app, b)
    all {
      a != b, s.opps.get(k).stage == "free",
      bookable(s, ma), bookable(s, mb), not(blockedPair(s, ma, mb)),
      s' = { ...s,
        opps: s.opps.set(k, { ...FREE_OPP, app: app, kind: "date", parts: Set(ma, mb), going: Set(ma, mb), told: Set(ma, mb), stage: "scheduled", meetingAt: s.now }),
        metPairs: s.metPairs.union(Set((a, b), (b, a))),
        lastAction: "bookDate" },
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

  // The answer to the check-in after a meeting (onFeedback 2636). `intent`: what the member means ("fine",
  // "report", "selfNoShow"); `reader`: checkInReport's output (an oracle). After SD-067 a happy answer reads
  // as no report (corpus evals/network/check-in-reports.jsonl, gate in scripts/sim/evals.ts).
  action checkIn(k: str, m: Mid, intent: str, reader: str): bool = {
    val s0 = sync(s, m)
    val o = s0.opps.get(k)
    val others = o.going.exclude(Set(m))
    // postDateReports on slop and peon (SD-221); never for a plan
    val reportKind = if (o.kind == "date") reader else "none"
    val s1 = { ...s0, opps: s0.opps.set(k, { ...o, feedbackFrom: o.feedbackFrom.union(Set(m)) }) }
    // checkInReported -> blockAndReport for each other (SD-229)
    val s2 = if (reportKind == "none") s1
      else others.fold(s1, (acc, x) => blockAndReport(acc, m, reportKind, x, "check_in", intent == "report"))
    // one record per answer, about this member (by), at the meeting time (SD-222, SD-442), with the people the
    // booked plan reached (bookedTold): a member who said no to the probe is not in it (SD-044, second path)
    val rec: Inter = { parts: o.told, outcome: if (intent == "selfNoShow") "no_show" else "completed", at: o.meetingAt, meetingAt: o.meetingAt, by: m }
    all {
      o.stage == "done", o.going.contains(m), not(o.feedbackFrom.contains(m)), s.live.get(m),
      lvl(s0, m) != "hold",          // a held member's text stops at the hold return
      s.now - o.meetingAt < 7,       // feedbackDue: within 7 days
      intent != "selfNoShow" or o.absent.contains(m),
      if (intent == "report") REPORT_KINDS.contains(reader) else reader == "none",
      s' = { ...s2,
        inters: s2.inters.union(Set(rec)),
        staffCleared: if (intent == "selfNoShow") s2.staffCleared.filter(y => not(o.parts.contains(y))) else s2.staffCleared,
        wanted: if (intent == "report") s2.wanted.union(others.map(x => (m.p, x.p))) else s2.wanted,
        lastAction: "checkIn" },
    }
  }

  // A safety disclosure after the first check-in answer ("actually he followed me home"): lateCheckInReport
  // (2698) files the same check-in report inside the 7 days after the date (SD-220). The code takes the
  // member's newest done 1:1 date; the model lets the member disclose only when there is one such date (a
  // disclosure about an older date while a newer one is in the window is not modelled).
  action disclose(k: str, m: Mid, kind: str): bool = {
    val s0 = sync(s, m)
    val o = s0.opps.get(k)
    val inWindow = OPP_IDS.filter(j => { val q = s0.opps.get(j)
      q.stage == "done" and q.kind == "date" and q.going.contains(m) and s0.now - q.meetingAt < 7 })
    val others = o.going.exclude(Set(m))
    all {
      o.stage == "done", o.kind == "date", o.going.contains(m), o.feedbackFrom.contains(m), s.live.get(m),
      lvl(s0, m) != "hold", s.now - o.meetingAt < 7, inWindow == Set(k), REPORT_KINDS.contains(kind),
      s' = { ...others.fold(s0, (acc, x) => blockAndReport(acc, m, kind, x, "check_in", true)),
             wanted: s0.wanted.union(others.map(x => (m.p, x.p))), lastAction: "disclose" },
    }
  }

  // "block X" / "report X" (handleBlock 1412). route() (service.ts:980): a member of several apps whose text
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
      r != t, s.live.get(rm),
      mine.size() <= 1 or best < 0 or metAtOn(s0, app, r, t) == best,
      if (ambiguous) s' = { ...s0, pendingWho: s0.pendingWho.set(rm, { asked: true, at: s0.now, verb: verb, kind: kind, target: t }), lastAction: "reportAsk" }
      else if (not(s0.live.get(tm))) s' = { ...s0, wanted: w, lastAction: "reportUnresolved" }
      else s' = { ...blockAndReport(s0, rm, if (verb == "report") kind else "none", tm, "message", true), wanted: w, lastAction: "report" },
    }
  }

  // The answer to "Who do you mean?" within a day (answerWho 1571): applied only to a counterpart.
  action answerWho(m: Mid): bool = {
    val s0 = sync(s, m)
    val p = s0.pendingWho.get(m)
    val tm = midOf(s0, m.app, p.target)
    val meantMet = usedOpps(s0).exists(o => metPair(o, m, tm))
    all {
      p.asked, s.live.get(m),
      s.now - p.at <= 1,
      if (s0.live.get(tm) and counterpart(s0, m, tm))
        s' = { ...blockAndReport({ ...s0, pendingWho: s0.pendingWho.set(m, NO_WHO) }, m, if (p.verb == "report") p.kind else "none", tm, "message", true),
               wanted: if (p.verb == "report" and meantMet) s0.wanted.union(Set((m.p, p.target))) else s0.wanted,
               lastAction: "answerWho" }
      else s' = { ...s0, pendingWho: s0.pendingWho.set(m, NO_WHO), lastAction: "answerWhoNone" },
    }
  }

  // The member's own abusive message (handleAbuse): a clean record takes at most HOLD - 1 points.
  action abuse(m: Mid, risk: int): bool = {
    val s0 = sync(s, m)
    val clean = s0.trust.get(m).score <= 0
    all {
      s.live.get(m), lvl(s0, m) != "hold",
      s' = { ...addPts(s0, m, if (clean) imin(risk, HOLD - 1) else risk, "abuse", NOBODY, "reply"), lastAction: "abuse" },
    }
  }

  // Staff hold (service.ts:1720, staff with safety@*): the person_holds row "*" first (SD-022), then this
  // app's unit, then one unit per other app.
  action staffHold(m: Mid): bool = all {
    s.live.get(m),
    val s1 = holdMember({ ...s, personHolds: s.personHolds.union(Set((m.p, "*"))) }, m, "safety")
    s' = { ...s1,
      pendingHold: liveMidsOf(s, m.p).exclude(Set(m)),
      staffHeldP: s1.staffHeldP.union(Set(m.p)),
      lastAction: "staffHold" },
  }
  action staffHoldApply(x: Mid): bool = all {
    s.pendingHold.contains(x), s.live.get(x),
    s' = { ...holdMember(s, x, "safety"), pendingHold: s.pendingHold.exclude(Set(x)), lastAction: "staffHoldApply" },
  }
  // The service process stops between two awaits; nothing resumes the loop (the next unit or tick of the
  // other app applies the person hold).
  action crash: bool = all {
    s.pendingHold != Set(),
    s' = { ...s, pendingHold: Set(), lastAction: "crash" },
  }

  // Staff lift a hold on one app (service.ts:1562 -> network.ts:1248 -> trust.ts:60). A "*" row becomes one
  // row per other app the person is a member of; this app's row and the "*" row go.
  action liftHold(m: Mid): bool = {
    val t = s.trust.get(m)
    val star = s.personHolds.contains((m.p, "*"))
    val others = APPS.exclude(Set(m.app)).filter(a => s.live.get(midOf(s, a, m.p)))
    val rows = (if (star) s.personHolds.union(others.map(a => (m.p, a))) else s.personHolds).exclude(Set((m.p, m.app), (m.p, "*")))
    all {
      s.live.get(m), t.level == "hold",
      s' = { ...s,
        personHolds: rows,
        trust: s.trust.set(m, { ...t, score: 0, level: "ok", reportsFrom: Set(), lastDecay: s.now }),
        caseSt: s.caseSt.set(m, if (s.caseSt.get(m) == "closed" or s.caseSt.get(m) == "none") "open" else "lifted"),
        heldMids: s.heldMids.exclude(Set(m)),
        liftedMids: s.liftedMids.union(Set(m)),
        staffHeldP: s.staffHeldP.exclude(Set(m.p)),
        autoHeldP: s.autoHeldP.exclude(Set((m.p, m.app))),
        minorP: s.minorP.exclude(Set((m.p, m.app))),
        counted: s.counted.set(m, Set()),
        src: s.src.set(m, NO_SRC),
        staffCleared: s.staffCleared.union(Set(m)),
        lifts: s.lifts + 1,
        lastAction: "liftHold" },
    }
  }

  // Staff close a case (network.ts:1258): a held member stays held.
  action closeCase(m: Mid): bool = all {
    s.live.get(m), s.caseSt.get(m) != "none", s.caseSt.get(m) != "closed",
    s' = { ...s, caseSt: s.caseSt.set(m, "closed"),
           staffCleared: if (lvl(s, m) != "hold") s.staffCleared.union(Set(m)) else s.staffCleared,
           lastAction: "closeCase" },
  }

  // Staff dismiss a report (network.ts:1346).
  action dismiss(r: Report): bool = all {
    s.reports.contains(r), r.status == "open",
    s' = { ...caseEv({ ...s, reports: s.reports.exclude(Set(r)).union(Set({ ...r, status: "dismissed" })) }, r.subject, "report_dismissed"),
           lastAction: "dismiss" },
  }

  // Staff clear a minor signal on every app (service clearMinor; atomic here): the record says adult.
  action staffClearMinor(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      s.minorP.exists(x => x._1 == p),
      s' = { ...s,
        minorF: ALL_MIDS.mapBy(x => if (ms.contains(x)) false else s.minorF.get(x)),
        reports: s.reports.map(r => if (ms.contains(r.subject) and r.kind == "minor" and r.status == "open") { ...r, status: "dismissed" } else r),
        minorP: s.minorP.filter(x => x._1 != p),
        lastAction: "staffClearMinor" },
    }
  }

  // Ban by person (service ban): ban rows, then each app's unit marks the member banned. No notice to past
  // contacts exists (SD-253, skipped: founder decision).
  action ban(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      not(p.in(s.banned)), ms != Set(),
      s' = { ...ms.fold(s, (acc, x) => markBanned(acc, x)),
             banned: s.banned.union(Set(p)), staffHeldP: s.staffHeldP.union(Set(p)), lastAction: "ban" },
    }
  }

  // "leave <app>" (service.ts:821 forget): a member who is held, has an urgent report waiting for staff or was
  // reported as a minor leaves a person_holds row for this app (SD-021); then the Network forgets the member.
  action leave(app: str, p: str): bool = {
    val m = midOf(s, app, p)
    val rows = if (safetyHeld(s, m)) s.personHolds.union(Set((p, app))) else s.personHolds
    all { s.live.get(m), s' = { ...forget({ ...s, personHolds: rows }, m), lastAction: "leave" } }
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

  // A relayed message inside a date (RelayDesk.apply): pass, hold (staff relay queue), a block for the form
  // (party, consent, format, photo) or a block for the sender's own words (harass_severe, llm_severe,
  // clef_severe), which writes a 0-point case event relay_block:<families> (severeBlock, SD-254).
  action relaySend(k: str, m: Mid, decision: str): bool = {
    val o = s.opps.get(k)
    all {
      o.kind == "date", o.stage == "scheduled" or o.stage == "done", o.going.contains(m), s.live.get(m),
      s' = { ...(if (decision == "blockSevere") caseEv(s, m, "relay_block") else s),
             relayLog: s.relayLog.union(Set((m, decision))), lastAction: "relaySend" },
    }
  }

  // trust.ts:125 decay
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

  // The tick of every app (network.ts:3326): personHold for every covered member (SD-022), callOffPair for
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
    nondet verb = Set("block", "report").oneOf()
    nondet kind = REPORT_KINDS.oneOf()
    nondet intent = Set("fine", "report", "selfNoShow").oneOf()
    nondet reader = Set("none", "harassment", "no_show", "minor").oneOf()
    nondet risk = Set(1, 2, 3, 6).oneOf()
    nondet d = Set(1, 6, 13, 14).oneOf()
    nondet decision = Set("pass", "hold", "block", "blockSevere").oneOf()
    nondet absent = s.opps.get(k).going.powerset().oneOf()
    any {
      bookDate(k, app, a, b),
      bookPlan(k, app, a, b, c, flag),
      meet(k, absent),
      checkIn(k, m, intent, reader),
      disclose(k, m, kind),
      report(a, app, b, verb, kind, flag),
      answerWho(m),
      abuse(m, risk),
      staffHold(m),
      staffHoldApply(m),
      crash,
      liftHold(m),
      closeCase(m),
      all { s.reports != Set(), nondet r = s.reports.oneOf() dismiss(r) },
      staffClearMinor(a),
      ban(a),
      leave(app, a),
      join(app, a),
      relaySend(k, m, decision),
      tick(d),
    }
  }

  // ------------------------------------------------------------------ invariants (rules, not code)
  // A report that the code counts toward a hold: open, met, urgent (reportHeld, network.ts:1300).
  pure def urgentOpen(r: Report): bool = r.status == "open" and r.met and URGENT.contains(r.kind)
  // The rule's reporter in good standing (ghosts): not banned, not on hold now, and did not leave while on hold.
  pure def standing(st: State, r: Report): bool =
    not(st.banned.contains(r.reporterP)) and not(st.heldMids.contains(r.reporter)) and not(st.heldAtLeave.contains(r.origReporter))

  // PRD 40.3 (docs/prd-snapshot.md:1777) "A safety removal holds the person everywhere ... a safety hold alone
  // does not refuse a join, but the person cannot be matched until staff resolve it"; admin-console 3.7.1
  // "Hold (the person, on every app, until a review)". A staff hold holds every live member of the person.
  // SD-021 (leave and rejoin), SD-022 (join during a hold, the non-atomic loop): fixed in 059965d.
  val staffHoldFollowsPerson = s.staffHeldP.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

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
  // urgent report by someone in good standing who met them keeps the person's member on that app out of
  // matching until staff decide (a dismiss, or a lift of the rejoined member), whatever member id the person
  // has now. SD-021 (fixed).
  val urgentMetReportBlocksMatchingInApp = s.reports.forall(r => (urgentOpen(r) and standing(s, r)) implies {
    val x = midOf(s, r.subject.app, r.subject.p)
    (s.live.get(x) and (x == r.subject or not(s.liftedMids.contains(x)))) implies not(matchable(s, x))
  })

  // trust.ts:6-7 "Holds never decay; only a person lifts them."
  val holdOnlyLiftedByStaff = s.heldMids.forall(m => s.live.get(m) implies lvl(s, m) == "hold")

  // trust.ts:8-11 "one person, or strangers who know a first name, can never put someone on hold";
  // a clean record takes at most HOLD - 1 points from one message.
  val noSingleActorHold = ALL_MIDS.forall(m => (s.live.get(m) and lvl(s, m) == "hold" and not(s.src.get(m).staff)) implies {
    val x = s.src.get(m)
    x.msgs + x.reporters.size() + x.other >= 2
  })

  // trust.ts:115-116 "a serial reporter's ... reports don't count"; a banned member is "never matched or
  // contacted again". A reporter on hold or banned cannot take someone out of matching. SD-072 (fixed in
  // ab4ff2a). Two paths reset the reporter's standing that the fix reads (the trust level): a leave and a staff
  // lift of a banned member. They are the separate value `reporterStandingKept` below (NEW-2).
  val reporterNotHeld = ALL_MIDS.forall(m => (s.live.get(m) and reportHeld(s, m)) implies
    s.reports.exists(r => r.subject == m and urgentOpen(r) and (r.reporter == NOBODY or
      (not(s.heldMids.contains(r.reporter)) and (not(s.banned.contains(r.reporterP)) or s.liftedMids.contains(r.reporter))))))

  // PRD 40.3 "Blocks are person to person and apply in every app"; PRD F23 "Block takes effect immediately".
  // No booked item that two blocked people are going to: on the app of the block at once, on every other app
  // at its next tick (callOffPair in the tick, before any meeting finalizes). SD-025 (fixed in de48147).
  val blockClosesAllApps = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    o.stage == "scheduled" implies blockedGoing(s, o).forall(t =>
      s.pendingCallOff.exists(e => e._3 != o.app and Set(e._1, e._2) == Set(t._1.p, t._2.p)))
  })

  // PRD F23 "Block ... only affects the pair". A block calls an item off only when the blocker and the target
  // are both going to it: a member who said no to a plan does not call it off for the others. SD-045 (fixed
  // in df588c8). The stricter "nobody else is going" form is `blockLeavesOthersPlan` below (NEW-3).
  val blockOnlyAffectsPair = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    (o.closedBy == "blocked" or o.closedBy == "blocked_elsewhere") implies
      (o.going.exists(x => x.p == o.blocker) and o.going.exists(x => x.p == o.target))
  })

  // metBefore doc "Anonymous probes do not count: neither knew who the other was"; trust.ts:9 "only when the
  // reporter shared an opportunity with the target". SD-044 (fixed in f8d9de8).
  val metIsReal = s.reports.forall(r => r.met implies s.metPairs.contains((r.reporterP, r.subject.p)))

  // reports.ts "A plain 'it was fine' or 'not my type' is not a report." A check-in report, block and minor
  // flag come only from an answer that reports something. SD-067 (fixed in 0e0bf2a; the reader is an oracle
  // here, and the corpus gate checks the reader).
  val checkInReportIntended = s.reports.forall(r => r.source == "check_in" implies r.intended)

  // "report X" and the check-in are both reports; trust.ts:8-10 each credible reporter who met them counts
  // once per target. SD-229 (fixed in db4ea4c).
  val reportersCounted = ALL_MIDS.forall(m => s.live.get(m) implies s.counted.get(m).subseteq(s.trust.get(m).reportsFrom))

  // trust.ts:4-5 "Watch lasts until the score decays below 3: 14 days from 3". SD-141 (fixed in db176ce).
  val watchLasts14Days = not(s.earlyWatchExit)

  // network.ts o.post "came: !f.selfNoShow": a no-show counts against the person who did not come. SD-222
  // (fixed in 581888d).
  val noShowCountsAbsentOnly = ALL_MIDS.forall(m => s.live.get(m) implies
    noShows(s, m) <= OPP_IDS.filter(k => s.opps.get(k).absent.contains(m) and s.opps.get(k).stage != "deleted").size())

  // profile.ts attendedSlots are the slots the member attended: the meeting's slot, not the answer's (days of
  // the week; the UTC hour that slotOf still reads is not modelled). SD-442 (fixed in 581888d, in part).
  val slotFromMeeting = s.inters.forall(i => i.outcome == "completed" implies (i.at - i.meetingAt) % 7 == 0)

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

  // Every rule above.
  val safety = and {
    staffHoldFollowsPerson,
    autoHoldFollowsPersonInApp,
    minorSignalFollowsPersonInApp,
    urgentMetReportBlocksMatchingInApp,
    holdOnlyLiftedByStaff,
    noSingleActorHold,
    reporterNotHeld,
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
  }

  // ------------------------------------------------------------------ rules kept out of `safety`
  // Each of these still fails on the code. They are not in `safety` because the fix needs a decision that is
  // not ours to make; the run tests below replay a trace for each.

  // SD-074 (skipped: needs a founder decision). admin-console 4.6 "a hold on any app holds the person
  // everywhere": an automatic hold, a minor report or an urgent report on one app does not reach the person's
  // other apps (platform.person_holds gets a row only from a staff hold or a leave).
  val autoHoldFollowsPerson = s.autoHeldP.forall(h => liveMidsOf(s, h._1).forall(x => not(matchable(s, x))))
  val minorSignalFollowsPerson = s.minorP.forall(h => liveMidsOf(s, h._1).forall(x => not(matchable(s, x))))
  val urgentMetReportBlocksMatching = s.reports.forall(r =>
    (urgentOpen(r) and standing(s, r)) implies liveMidsOf(s, r.subject.p).forall(x => not(matchable(s, x))))

  // SD-027 (skipped: needs a founder decision). trust.ts:6 "hold - ... staff review"; PRD 1420 the safety
  // console lists "members on watch and hold with the events that caused it". The slop trust_review rule holds
  // a member with no case and no staff exit.
  val engineHoldVisible = ALL_MIDS.forall(m => (s.live.get(m) and trustReview(s, m)) implies Set("open", "held").contains(s.caseSt.get(m)))
  val staffDecisionEndsEngineHold = s.staffCleared.forall(m => s.live.get(m) implies not(trustReview(s, m)))

  // SD-253 (skipped: needs a founder decision on new member copy). PRD 40.5 "a relay log so past contacts can be
  // told about a ban".
  val pastContactsToldOfBan = s.banned.forall(p => PERSONS.forall(q => s.metPairs.contains((q, p)) implies s.toldOfBan.contains((q, p))))

  // NEW-2 (not in the register; found by this model after the SD-072 fix). reportHeld reads the reporter's
  // trust level. A reporter on hold who then leaves the app (forget blanks reporterId and trust.level("") is
  // "ok"), or a banned reporter whose hold staff lift (liftHold does not check the ban), makes the report hold
  // its subject again.
  val reporterStandingKept = ALL_MIDS.forall(m => (s.live.get(m) and reportHeld(s, m)) implies
    s.reports.exists(r => r.subject == m and urgentOpen(r) and standing(s, r)))

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
  // new paths of the fixes
  val witness_carryoverHold = not(ALL_MIDS.exists(m => m.g == 1 and s.live.get(m) and lvl(s, m) == "hold" and s.personHolds.exists(h => h._1 == m.p and h._2 == m.app)))
  val witness_callOffElsewhere = not(OPP_IDS.exists(k => s.opps.get(k).closedBy == "blocked_elsewhere"))
  val witness_relayCase = not(s.relayLog.exists(x => x._2 == "blockSevere" and s.live.get(x._1) and s.caseSt.get(x._1) == "open"))

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

  // SD-021 (fixed): staff hold ben, ben leaves slop and joins again: the rejoin is covered by the person hold,
  // not matchable, and held at its next unit; a staff lift ends it.
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

  // SD-021 (fixed): a minor report on slop, a leave and a rejoin: the new member is held.
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

  // SD-074 (skipped): a minor report on slop keeps ben matchable on peon.
  run sd074MinorReportOneAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .expect(minorSignalFollowsPersonInApp and not(minorSignalFollowsPerson) and matchable(s, BEN_P))

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

  // SD-072 (fixed): a banned member who met ana reports her: the report is open for staff, ana is matchable.
  run sd072BannedReporterTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(ban("ben"))
      .then(report("ben", "slop", "ana", "report", "harassment", false))
      .expect(reporterNotHeld and matchable(s, ANA_S) and s.reports.exists(r => r.subject == ANA_S and r.status == "open"))

  // NEW-2: a held reporter's report holds nobody until the reporter leaves the app.
  run new2HeldReporterLeavesTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(staffHold(BEN_S))
      .then(report("ben", "slop", "ana", "report", "harassment", false))
      .expect(matchable(s, ANA_S))
      .then(leave("slop", "ben"))
      .expect(not(matchable(s, ANA_S)) and not(reporterStandingKept) and reporterNotHeld)

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

  // SD-220 (fixed): the first answer is "it was fine", the disclosure a day later files the report.
  run sd220DisclosureAfterAnswerTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(tick(1))
      .then(disclose("o1", ANA_S, "harassment"))
      .expect(everyMetReportFiled and s.reports.exists(r => r.reporter == ANA_S and r.source == "check_in" and r.met)
              and not(matchable(s, BEN_S)))

  // SD-221 (fixed): a peon check-in answer that reports something files the report.
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

  // SD-250 (fixed): the route never sends that text to peon, where ben is a stranger.
  run sd250NotRoutedElsewhereTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "peon", "ben", "report", "harassment", false).fail())

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

  // SD-027 (skipped): ana and cy block ben (strangers); ben is in trust_review with no case.
  run sd027TrustReviewTest =
    init
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(report("cy", "slop", "ben", "block", "harassment", false))
      .expect(trustReview(s, BEN_S) and not(engineHoldVisible))

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
      .then(relaySend("o1", ANA_S, "block"))
      .expect(s.caseSt.get(ANA_S) == "none")
      .then(relaySend("o1", BEN_S, "blockSevere"))
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
}
