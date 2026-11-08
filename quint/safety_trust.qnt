// quint-check: max-steps=14 max-samples=6000 verify-steps=2
// Safety and trust (docs/research/2026-11-07-state-machines.md section 6.9). Machines: person-safety-carryover
// (M-051), trust-level (M-052), safety-report (M-053), pair-relations (M-054), slop-check-in-report (M-055),
// slop-review-hold (M-056), safety-case (M-127), pending-safety-who (M-128). journey-help (M-183) has no
// state in the Network (HELP returns at network.ts:677), so it is not modelled.
//
// The model follows the code as it is now:
//   packages/network/src/trust.ts            Trust.add, block, report, lift, decay, relevel
//   packages/network/src/reports.ts          report kinds, URGENT_REPORTS, checkInReport (an oracle here)
//   packages/network/src/network.ts          onTrustChange 1188, caseEvent 1209, liftHold 1244, closeCase 1254,
//                                            fileReport 1279, reportHeld 1295, holdMember 1311, markBanned 1327,
//                                            dismissReport 1341, metBefore 1387, handleBlock/applyBlock 1405-1455,
//                                            answerWho 1528, minorReported 1550, clearMinorSignal 1565,
//                                            close 2526, dropMember 2564, onFeedback 2593, forget 912,
//                                            engineInput holds 3710, tick decay 3291
//   packages/network/service/service.ts      route 957, leave 1078-1092, join 1384-1460, hold 1675-1688,
//                                            clearMinor 1697, ban 1734-1764, membersOfPerson 1659
//   packages/network/service/runtime.ts      send kind 429 (a safety notice outside the member's own turn is
//                                            "transactional"), person_blocks write 508-512
//   packages/network/src/relay.ts            RelayDesk.apply 232-249 (a block is logged and returned)
//   packages/engine/src/packs/slop/rules.ts  reviewReason 46-62 (trust_review)
//   packages/engine/src/packs/slop/profile.ts histories 232-275 (noShows, dates, blockedBy, attendedSlots)
//
// One action is one unit of work (one SQL transaction of one Network). The service's cross-app loops
// (hold, ban) await between apps: `staffHoldApply` is the nxt app's unit and `crash` is a process stop
// between two units. Oracles with nondeterministic output: the report-kind reader on the "report X" text,
// the check-in reader (checkInReport, misread only on a happy answer: reader misses of a real report are
// the corpus's job, SD-031 family), the routing of a member's message to an app (route(): the app with the
// newest item, else the last writer), the Clef/rules relay decision. Time is in days.
//
// Bounds: 2 apps (slop has postDateReports, peon does not), 3 persons, at most one rejoin per app and
// person (member generation 0..1), 3 opportunity slots.
module safety_trust {
  // ------------------------------------------------------------------ types
  type Mid = { app: str, p: str, g: int }
  type Trust = { rec: bool, score: int, level: str, reportsFrom: Set[Mid], lastDecay: int, strangers: Set[Mid] }
  type Opp = {
    app: str, kind: str, parts: Set[Mid], going: Set[Mid], told: Set[Mid], stage: str, meetingAt: int,
    feedbackFrom: Set[Mid], absent: Set[Mid], closedBy: str, blocker: str, target: str
  }
  type Report = {
    reporter: Mid, reporterP: str, subject: Mid, kind: str, met: bool, source: str, status: str,
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
    autoHeldP: Set[str],
    minorP: Set[str],
    heldMids: Set[Mid],
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
  // network.ts:1295 reportHeld
  pure def reportHeld(st: State, m: Mid): bool =
    st.reports.exists(r => r.subject == m and r.status == "open" and r.met and URGENT.contains(r.kind))
  // engine slop profile.ts:247 and 241-246
  pure def noShows(st: State, m: Mid): int = st.inters.filter(i => i.parts.contains(m) and i.outcome == "no_show").size()
  pure def dates(st: State, m: Mid): int = st.inters.filter(i => i.parts.contains(m) and i.outcome == "completed").size()
  // profile.ts:273: a "blocked" edge per blocker (person blocks reach every app's snapshot, snapshot.ts:98-124)
  pure def blockedBy(st: State, m: Mid): int = PERSONS.filter(q => st.personBlocks.contains((q, m.p))).size()
  // slop rules.ts:56-58 with SLOP_DEFAULT_OPTIONS trust { blockedBy: 2, noShows: 2 } (options.ts:151)
  pure def trustReview(st: State, m: Mid): bool =
    m.app == "slop" and (blockedBy(st, m) >= 2 or (noShows(st, m) >= 2 and noShows(st, m) > dates(st, m)))
  // network.ts:3710 engineInput holds, 4504 not_ready (restricted account)
  pure def matchable(st: State, m: Mid): bool =
    st.live.get(m) and lvl(st, m) == "ok" and not(st.minorF.get(m)) and not(reportHeld(st, m)) and not(st.restricted.contains(m))
  // network.ts:4387 blocked(): this Network's block or a person block from the snapshot
  pure def blockedPair(st: State, a: Mid, b: Mid): bool =
    st.blocks.contains(Set(a, b)) or st.personBlocks.contains((a.p, b.p)) or st.personBlocks.contains((b.p, a.p))
  pure def usedOpps(st: State): Set[Opp] = OPP_IDS.map(k => st.opps.get(k)).filter(o => o.stage != "free" and o.stage != "deleted")
  // network.ts:1387-1390 metBefore, as the code reads it: a booked opportunity that names both and contacted
  // both (a plan's decliner was contacted by the anonymous probe), or a completed / no_show interaction.
  pure def metBefore(st: State, a: Mid, b: Mid): bool = or {
    usedOpps(st).exists(o => o.parts.contains(a) and o.parts.contains(b)),
    st.inters.exists(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")),
  }
  // network.ts:1461-1481 counterparts: a booked meeting both were told about, with a yes, or a recorded meeting.
  pure def counterpart(st: State, a: Mid, b: Mid): bool = or {
    usedOpps(st).exists(o => o.told.contains(a) and o.told.contains(b) and o.going.contains(a) and o.going.contains(b)),
    st.inters.exists(i => i.parts.contains(a) and i.parts.contains(b) and (i.outcome == "completed" or i.outcome == "no_show")),
  }
  // ghost: the two people were both told about one booked meeting (the truth "they met through the Network")
  pure def toldPair(o: Opp, a: Mid, b: Mid): bool = a != b and o.told.contains(a) and o.told.contains(b)
  // trust.ts:115 reporter credibility
  pure def credibleT(t: Trust): bool = t.level == "ok" and t.strangers.size() < 3

  // ------------------------------------------------------------------ code paths as pure functions
  // network.ts:1209 caseEvent: no case or a closed one opens a new case; a lifted case reopens.
  pure def caseAfter(c: str, kind: str): str =
    if (c == "none" or c == "closed") "open" else if (c == "lifted" and kind != "hold_lifted") "open" else c

  pure def srcAdd(x: Src, kind: str, by: Mid): Src =
    if (kind == "staff_hold") { ...x, staff: true }
    else if (kind == "report_received") { ...x, reporters: x.reporters.union(Set(by)) }
    else if (kind == "abuse") { ...x, msgs: x.msgs + 1 }
    else { ...x, other: x.other + 1 }

  // network.ts:2564 dropMember (scheduled items: handleDrop; a date closes, a plan goes on without them)
  pure def dropOpps(opps: str -> Opp, m: Mid): str -> Opp =
    OPP_IDS.mapBy(k => {
      val o = opps.get(k)
      if (o.stage == "scheduled" and o.going.contains(m))
        if (o.kind == "date" or o.going.exclude(Set(m)).size() < 2) { ...o, stage: "closed", closedBy: "dropped" }
        else { ...o, going: o.going.exclude(Set(m)) }
      else o
    })

  // trust.ts:83 add, with relevel (136) and the Network's onEvent (caseEvent) and onChange (onTrustChange 1188).
  // `notice`: the send kind of the hold notice ("reply" in the member's own turn, "transactional" otherwise,
  // runtime.ts:429; "none" when the code sends none that reaches the member).
  pure def addPts(st: State, m: Mid, pts: int, kind: str, by: Mid, notice: str): State = {
    val t = st.trust.get(m)
    val score2 = t.score + pts
    val prev = t.level
    val nxt = if (prev == "hold" or score2 >= HOLD) "hold" else if (score2 >= WATCH) "watch" else "ok"
    val t2 = { ...t, rec: true, score: score2, lastDecay: if (t.lastDecay < 0) st.now else t.lastDecay, level: nxt }
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
      autoHeldP: if (kind == "staff_hold") s2.autoHeldP else s2.autoHeldP.union(Set(m.p)),
      holdNotices: if (notice == "none") s2.holdNotices else s2.holdNotices.union(Set((m, notice))),
    } else s2
  }

  // network.ts:1209 a case event with no points (report_received with 0 points, report:<kind>, minor_reported)
  pure def caseEv(st: State, m: Mid, kind: str): State = { ...st, caseSt: st.caseSt.set(m, caseAfter(st.caseSt.get(m), kind)) }

  // network.ts:1550 minorReported: a case event, then (first time) the minor flags and dropMember on THIS Network.
  pure def minorReported(st: State, t: Mid): State = {
    val s1 = caseEv(st, t, "minor_reported")
    if (s1.minorF.get(t)) s1
    else { ...s1, minorF: s1.minorF.set(t, true), minorP: s1.minorP.union(Set(t.p)), opps: dropOpps(s1.opps, t) }
  }

  // network.ts:1279 fileReport. `caseEvent` false on the "report X" path (the trust path already wrote it).
  // Ghost `counted`: the reporters trust.ts:112-121 says count once per target (credible, met).
  pure def fileReport(st: State, rep: Mid, sub: Mid, kind: str, source: str, met: bool, intended: bool, caseEvent: bool): State = {
    val rt = st.trust.get(rep)
    val cred = credibleT(rt) and not(st.banned.contains(rep.p))
    val r: Report = {
      reporter: rep, reporterP: rep.p, subject: sub, kind: kind, met: met, source: source, status: "open",
      credible: cred, intended: intended, at: st.now
    }
    val s1 = { ...st, reports: st.reports.union(Set(r)),
               counted: if (credibleT(rt) and met) st.counted.set(sub, st.counted.get(sub).union(Set(rep))) else st.counted }
    val s2 = if (caseEvent) caseEv(s1, sub, "report:" ) else s1
    if (reportHeld(s2, sub)) { ...s2, opps: dropOpps(s2.opps, sub) } else s2
  }

  // trust.ts:98 block
  pure def trustBlock(st: State, from: Mid, target: Mid, met: bool): State = {
    val t = st.trust.get(from)
    if (met or t.strangers.contains(target)) st
    else {
      val t2 = { ...t, rec: true, strangers: t.strangers.union(Set(target)) }
      val s1 = { ...st, trust: st.trust.set(from, t2) }
      if (t2.strangers.size() == 3) addPts(s1, from, 2, "block_abuse", NOBODY, "reply") else s1
    }
  }

  // trust.ts:112 report: returns the state after the points (0 or 3)
  pure def trustReport(st: State, target: Mid, by: Mid, met: bool): (State, int) = {
    val r = { ...st.trust.get(target), rec: true }
    val b = { ...st.trust.get(by), rec: true }
    val st0 = { ...st, trust: st.trust.set(target, r).set(by, b) }
    if (not(credibleT(b)) or not(met)) (st0, 0)
    else if (r.reportsFrom.contains(by)) (st0, 0)
    else {
      val r2 = { ...r, reportsFrom: r.reportsFrom.union(Set(by)) }
      val st1 = { ...st0, trust: st0.trust.set(target, r2) }
      if (r2.reportsFrom.size() >= 2 or r2.score > 0) (addPts(st1, target, 3, "report_received", by, "transactional"), 3)
      else (st1, 0)
    }
  }

  // network.ts:1421 applyBlock (the target is known)
  pure def applyBlock(st: State, m: Mid, verb: str, kind: str, target: Mid): State = {
    val met = metBefore(st, m, target)
    val s1 = {
      ...st,
      blocks: st.blocks.union(Set(Set(m, target))),
      // runtime.ts:508-512: the unit's blocks become person blocks in the same save
      personBlocks: st.personBlocks.union(Set((m.p, target.p))),
      staffCleared: st.staffCleared.filter(x => x.p != target.p),
    }
    val s2 = trustBlock(s1, m, target, met)
    // close every open item of THIS Network that names both (1434-1445)
    val s3 = { ...s2, opps: OPP_IDS.mapBy(k => {
      val o = s2.opps.get(k)
      if (o.stage == "scheduled" and o.parts.contains(m) and o.parts.contains(target))
        { ...o, stage: "closed", closedBy: "blocked", blocker: m.p, target: target.p }
      else o
    }) }
    if (verb != "report") s3
    else {
      val tr = trustReport(s3, target, m, met)
      val s4 = if (tr._2 == 0) caseEv(tr._1, target, "report_received") else tr._1
      val s5 = fileReport(s4, m, target, kind, "message", met, true, false)
      if (kind == "minor") minorReported(s5, target) else s5
    }
  }

  // network.ts:912 forget (leave one app: service.ts:1088 -> accounts.leave -> onForget -> forgetMember)
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
    // reports about them stay; a reporter who left is not named (reporterP is a ghost)
    reports: st.reports.map(r => if (r.reporter == m) { ...r, reporter: NOBODY } else r),
    restricted: st.restricted.exclude(Set(m)),
    pendingHold: st.pendingHold.exclude(Set(m)),
    pendingWho: st.pendingWho.set(m, NO_WHO),
    relayLog: st.relayLog.filter(x => x._1 != m),
    heldMids: st.heldMids.exclude(Set(m)),
    src: st.src.set(m, NO_SRC),
    counted: ALL_MIDS.mapBy(x => if (x == m) Set() else st.counted.get(x).exclude(Set(m))),
    staffCleared: st.staffCleared.exclude(Set(m)),
  }

  // network.ts:1311 holdMember (no reportId: every open report about them reads "held")
  pure def holdMember(st: State, m: Mid, notice: str): State = {
    val s1 = if (lvl(st, m) != "hold") {
      val sc = st.trust.get(m).score
      addPts(st, m, if (HOLD - sc > 0) HOLD - sc else 1, "staff_hold", NOBODY, notice)
    } else st
    { ...s1, reports: s1.reports.map(r => if (r.subject == m and r.status == "open") { ...r, status: "held" } else r) }
  }

  // network.ts:1327 markBanned
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
  // A reviewed 1:1 date is booked and both are told (approvalCheck 1987 and the slop review_hold rule).
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

  // A plan of three, probed anonymously (all contacted); `declined`: c said no and was never told (bookPlan 3041).
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

  // The meeting time passes (finalize 2733): done. `absent`: who did not come (truth, never read by the code).
  action meet(k: str, absent: Set[Mid]): bool = {
    val o = s.opps.get(k)
    all {
      o.stage == "scheduled", s.now >= o.meetingAt, absent.subseteq(o.going),
      s' = { ...s, opps: s.opps.set(k, { ...o, stage: "done", absent: absent }), lastAction: "meet" },
    }
  }

  // The answer to the check-in after a meeting (onFeedback 2593). `intent`: what the member means ("fine",
  // "report", "selfNoShow"); `reader`: checkInReport's output (an oracle; correct on a report, and on a happy
  // answer it can misread a kind: "minor" models "she was so sweet, she said she is 17 at heart").
  action checkIn(k: str, m: Mid, intent: str, reader: str): bool = {
    val o = s.opps.get(k)
    val others = o.going.exclude(Set(m))
    val reportKind = if (o.app == "slop" and o.kind == "date") reader else "none"
    val s1 = { ...s, opps: s.opps.set(k, { ...o, feedbackFrom: o.feedbackFrom.union(Set(m)) }) }
    val s2 = if (reportKind == "none") s1
      else others.fold(s1, (acc, x) => {
        val a1 = fileReport(acc, m, x, reportKind, "check_in", true, intent == "report", true)
        val a2 = { ...a1, blocks: a1.blocks.union(Set(Set(m, x))), personBlocks: a1.personBlocks.union(Set((m.p, x.p))),
                   staffCleared: a1.staffCleared.filter(y => y.p != x.p) }
        if (reportKind == "minor") minorReported(a2, x) else a2
      })
    // one interaction per answer, with every participant, stamped with the answer time (2641)
    val rec: Inter = { parts: o.parts, outcome: if (intent == "selfNoShow") "no_show" else "completed", at: s.now, meetingAt: o.meetingAt, by: m }
    all {
      o.stage == "done", o.going.contains(m), not(o.feedbackFrom.contains(m)), s.live.get(m),
      lvl(s, m) != "hold",           // a held member's text stops at the hold return (746)
      s.now - o.meetingAt < 7,       // feedbackDue: within 7 days
      intent != "selfNoShow" or o.absent.contains(m),
      if (intent == "report") REPORT_KINDS.contains(reader)
      else if (intent == "fine") Set("none", "minor").contains(reader)
      else reader == "none",
      s' = { ...s2,
        inters: s2.inters.union(Set(rec)),
        staffCleared: if (intent == "selfNoShow") s2.staffCleared.filter(y => not(o.parts.contains(y))) else s2.staffCleared,
        wanted: if (intent == "report") s2.wanted.union(others.map(x => (m.p, x.p))) else s2.wanted,
        lastAction: "checkIn" },
    }
  }

  // A safety disclosure after the first check-in answer ("he grabbed me"): no "report" verb, so classify()
  // does not make it a report; abuse_disclosed is logged (748), nothing is filed (SD-220).
  action disclose(k: str, m: Mid): bool = {
    val o = s.opps.get(k)
    all {
      o.stage == "done", o.feedbackFrom.contains(m), s.live.get(m), lvl(s, m) != "hold", s.now - o.meetingAt < 7,
      s' = { ...s, wanted: s.wanted.union(o.going.exclude(Set(m)).map(x => (m.p, x.p))), lastAction: "disclose" },
    }
  }

  // "block X" / "report X" (handleBlock 1405). The message is routed to `app` (route(): newest item, else the
  // last writer; an app name inside the sentence never routes). The target is looked up on that app only.
  // `ambiguous`: two possible people, so "Who do you mean?" (pendingSafety).
  action report(r: str, app: str, t: str, verb: str, kind: str, ambiguous: bool): bool = {
    val rm = midOf(s, app, r)
    val tm = midOf(s, app, t)
    // ghost: the member means the person they met (a booked meeting both were told about) on an app where
    // both are still members
    val meantMet = APPS.exists(a => usedOpps(s).exists(o => o.app == a and toldPair(o, midOf(s, a, r), midOf(s, a, t))))
    val w = if (verb == "report" and meantMet and not(ambiguous)) s.wanted.union(Set((r, t))) else s.wanted
    all {
      r != t, s.live.get(rm),
      if (ambiguous) s' = { ...s, pendingWho: s.pendingWho.set(rm, { asked: true, at: s.now, verb: verb, kind: kind, target: t }), lastAction: "reportAsk" }
      else if (not(s.live.get(tm))) s' = { ...s, wanted: w, lastAction: "reportUnresolved" }
      else s' = { ...applyBlock(s, rm, verb, kind, tm), wanted: w, lastAction: "report" },
    }
  }

  // The answer to "Who do you mean?" within a day (answerWho 1528): applied only to a counterpart.
  action answerWho(m: Mid): bool = {
    val p = s.pendingWho.get(m)
    val tm = midOf(s, m.app, p.target)
    val meantMet = usedOpps(s).exists(o => toldPair(o, m, tm))
    all {
      p.asked, s.live.get(m),
      s.now - p.at <= 1,
      if (s.live.get(tm) and counterpart(s, m, tm))
        s' = { ...applyBlock({ ...s, pendingWho: s.pendingWho.set(m, NO_WHO) }, m, p.verb, p.kind, tm),
               wanted: if (p.verb == "report" and meantMet) s.wanted.union(Set((m.p, p.target))) else s.wanted,
               lastAction: "answerWho" }
      else s' = { ...s, pendingWho: s.pendingWho.set(m, NO_WHO), lastAction: "answerWhoNone" },
    }
  }

  // The member's own abusive message (handleAbuse 1138): a clean record takes at most HOLD - 1 points.
  action abuse(m: Mid, risk: int): bool = {
    val clean = s.trust.get(m).score <= 0
    all {
      s.live.get(m), lvl(s, m) != "hold",
      s' = { ...addPts(s, m, if (clean) imin(risk, HOLD - 1) else risk, "abuse", NOBODY, "reply"), lastAction: "abuse" },
    }
  }

  // Staff hold (service.ts:1675, staff with safety@*): this app's unit first, then one unit per other app.
  action staffHold(m: Mid): bool = all {
    s.live.get(m),
    val s1 = holdMember(s, m, "transactional")
    s' = { ...s1,
      pendingHold: liveMidsOf(s, m.p).exclude(Set(m)),
      staffHeldP: s1.staffHeldP.union(Set(m.p)),
      lastAction: "staffHold" },
  }
  action staffHoldApply(x: Mid): bool = all {
    s.pendingHold.contains(x), s.live.get(x),
    s' = { ...holdMember(s, x, "transactional"), pendingHold: s.pendingHold.exclude(Set(x)), lastAction: "staffHoldApply" },
  }
  // The service process stops between two awaits; nothing resumes the loop.
  action crash: bool = all {
    s.pendingHold != Set(),
    s' = { ...s, pendingHold: Set(), lastAction: "crash" },
  }

  // Staff lift a hold on one app (service.ts:1540 -> network.ts:1244 -> trust.ts:60).
  action liftHold(m: Mid): bool = {
    val t = s.trust.get(m)
    all {
      s.live.get(m), t.level == "hold",
      s' = { ...s,
        trust: s.trust.set(m, { ...t, score: 0, level: "ok", reportsFrom: Set(), lastDecay: s.now }),
        caseSt: s.caseSt.set(m, if (s.caseSt.get(m) == "closed" or s.caseSt.get(m) == "none") "open" else "lifted"),
        heldMids: s.heldMids.exclude(Set(m)),
        staffHeldP: s.staffHeldP.exclude(Set(m.p)),
        autoHeldP: s.autoHeldP.exclude(Set(m.p)),
        counted: s.counted.set(m, Set()),
        src: s.src.set(m, NO_SRC),
        staffCleared: s.staffCleared.union(Set(m)),
        lifts: s.lifts + 1,
        lastAction: "liftHold" },
    }
  }

  // Staff close a case (network.ts:1254): a held member stays held.
  action closeCase(m: Mid): bool = all {
    s.live.get(m), s.caseSt.get(m) != "none", s.caseSt.get(m) != "closed",
    s' = { ...s, caseSt: s.caseSt.set(m, "closed"),
           staffCleared: if (lvl(s, m) != "hold") s.staffCleared.union(Set(m)) else s.staffCleared,
           lastAction: "closeCase" },
  }

  // Staff dismiss a report (network.ts:1341).
  action dismiss(r: Report): bool = all {
    s.reports.contains(r), r.status == "open",
    s' = { ...caseEv({ ...s, reports: s.reports.exclude(Set(r)).union(Set({ ...r, status: "dismissed" })) }, r.subject, "report_dismissed"),
           lastAction: "dismiss" },
  }

  // Staff clear a minor signal on every app (service.ts:1697; atomic here): the record says adult.
  action staffClearMinor(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      p.in(s.minorP),
      s' = { ...s,
        minorF: ALL_MIDS.mapBy(x => if (ms.contains(x)) false else s.minorF.get(x)),
        reports: s.reports.map(r => if (ms.contains(r.subject) and r.kind == "minor" and r.status == "open") { ...r, status: "dismissed" } else r),
        minorP: s.minorP.exclude(Set(p)),
        lastAction: "staffClearMinor" },
    }
  }

  // Ban by person (service.ts:1734): ban rows, then each app's unit marks the member banned. No notice to
  // past contacts exists (the relay log's ban notice is not built).
  action ban(p: str): bool = {
    val ms = liveMidsOf(s, p)
    all {
      not(p.in(s.banned)), ms != Set(),
      s' = { ...ms.fold(s, (acc, x) => markBanned(acc, x)),
             banned: s.banned.union(Set(p)), staffHeldP: s.staffHeldP.union(Set(p)), lastAction: "ban" },
    }
  }

  // "leave <app>" (service.ts:1078): the Network forgets the member.
  action leave(app: str, p: str): bool = {
    val m = midOf(s, app, p)
    all { s.live.get(m), s' = { ...forget(s, m), lastAction: "leave" } }
  }

  // A join by text (service.ts:1384): a banned person is refused; a hold alone does not refuse a join.
  // A former member gets a new member id (`${app}_${uuid}`).
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

  // A relayed message inside a date (RelayDesk.apply 232): pass, hold (staff relay queue) or block.
  action relaySend(k: str, m: Mid, decision: str): bool = {
    val o = s.opps.get(k)
    all {
      o.kind == "date", o.stage == "scheduled" or o.stage == "done", o.going.contains(m), s.live.get(m),
      s' = { ...s, relayLog: s.relayLog.union(Set((m, decision))), lastAction: "relaySend" },
    }
  }

  // The daily run (network.ts:3291): days pass, trust.decay(now).
  action tick(d: int): bool = {
    val now2 = s.now + d
    val trust2 = ALL_MIDS.mapBy(m => if (s.live.get(m) and s.trust.get(m).rec) decayOne(s.trust.get(m), now2) else s.trust.get(m))
    val early = ALL_MIDS.exists(m => s.trust.get(m).level == "watch" and trust2.get(m).level == "ok" and now2 - s.watchSince.get(m) < DECAY_DAYS)
    all {
      now2 <= MAX_DAY,
      s' = { ...s, now: now2, trust: trust2, earlyWatchExit: s.earlyWatchExit or early, lastAction: "tick" },
    }
  }
  // trust.ts:124 decay
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
    nondet decision = Set("pass", "hold", "block").oneOf()
    nondet absent = s.opps.get(k).going.powerset().oneOf()
    any {
      bookDate(k, app, a, b),
      bookPlan(k, app, a, b, c, flag),
      meet(k, absent),
      checkIn(k, m, intent, reader),
      disclose(k, m),
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
  // PRD 40.3 (docs/prd-snapshot.md:1777) "A safety removal holds the person everywhere ... a safety hold alone
  // does not refuse a join, but the person cannot be matched until staff resolve it"; admin-console 3.7.1
  // "Hold (the person, on every app, until a review)". A staff hold holds every live member of the person.
  // SD-021 (leave and rejoin), SD-022 (join during a hold, the non-atomic loop).
  val staffHoldFollowsPerson = s.staffHeldP.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

  // admin-console 4.6 "a hold on any app holds the person everywhere"; trust.ts:6-7 "hold - ... staff review".
  // An automatic hold (reports, abuse) keeps every member of the person out of matching. SD-074, SD-021.
  val autoHoldFollowsPerson = s.autoHeldP.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

  // Founder decision 1 (AGENTS.md): "Age is a person-level fact"; minors are never matched in any app.
  // A minor signal (a report that they are under 18) keeps the person out of matching on every app until
  // staff clear it. SD-074, SD-021.
  val minorSignalFollowsPerson = s.minorP.forall(p => liveMidsOf(s, p).forall(x => not(matchable(s, x))))

  // PRD 36.3 / 1446 "an automatic safety hold on the reported member's opportunities until reviewed";
  // network.ts:1289-1294 reportHeld doc. An open urgent report by someone who met them keeps the person out
  // of matching until staff decide, whatever member id the person has now. SD-021, SD-022.
  val urgentMetReportBlocksMatching = s.reports.forall(r =>
    (r.status == "open" and r.met and URGENT.contains(r.kind)) implies liveMidsOf(s, r.subject.p).forall(x => not(matchable(s, x))))

  // trust.ts:6-7 "Holds never decay; only a person lifts them."
  val holdOnlyLiftedByStaff = s.heldMids.forall(m => s.live.get(m) implies lvl(s, m) == "hold")

  // trust.ts:8-11 "one person, or strangers who know a first name, can never put someone on hold";
  // network.ts:1143 a clean record takes at most HOLD - 1 points from one message.
  val noSingleActorHold = ALL_MIDS.forall(m => (s.live.get(m) and lvl(s, m) == "hold" and not(s.src.get(m).staff)) implies {
    val x = s.src.get(m)
    x.msgs + x.reporters.size() + x.other >= 2
  })

  // trust.ts:115-116 "a serial reporter's ... reports don't count"; network.ts:1326 a banned member is "never
  // matched or contacted again". A held or banned reporter cannot take someone out of matching. SD-072.
  val reporterNotHeld = s.reports.forall(r => (r.status == "open" and r.met and URGENT.contains(r.kind)) implies r.credible)

  // PRD 40.3 "Blocks are person to person and apply in every app"; PRD F23 (prd-snapshot.md:1055) "Block takes
  // effect immediately". No booked item that two blocked people are going to, on any app. SD-025.
  val blockClosesAllApps = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    o.stage == "scheduled" implies tuples(o.going, o.going).forall(t => not(s.personBlocks.contains((t._1.p, t._2.p))))
  })

  // PRD F23 "Block ... only affects the pair"; network.ts:3050-3051 "one block cannot collapse the quorum".
  // A block closes an item only when nobody else is going. SD-045.
  val blockOnlyAffectsPair = OPP_IDS.forall(k => {
    val o = s.opps.get(k)
    o.closedBy == "blocked" implies o.going.forall(x => x.p == o.blocker or x.p == o.target)
  })

  // network.ts:1383-1386 metBefore doc "Anonymous probes do not count: neither knew who the other was";
  // trust.ts:9 "only when the reporter shared an opportunity with the target". SD-044.
  val metIsReal = s.reports.forall(r => r.met implies s.metPairs.contains((r.reporterP, r.subject.p)))

  // reports.ts:33-37 "A plain 'it was fine' or 'not my type' is not a report." A check-in report, block and
  // minor flag come only from an answer that reports something. SD-067.
  val checkInReportIntended = s.reports.forall(r => r.source == "check_in" implies r.intended)

  // reports.ts:1-2 and network.ts:1272-1278: "report X" and the check-in are both reports; trust.ts:8-10 each
  // credible reporter who met them counts once per target. SD-229.
  val reportersCounted = ALL_MIDS.forall(m => s.live.get(m) implies s.counted.get(m).subseteq(s.trust.get(m).reportsFrom))

  // trust.ts:4-5 "Watch lasts until the score decays below 3: 14 days from 3". SD-141.
  val watchLasts14Days = not(s.earlyWatchExit)

  // trust.ts:6 "hold - ... staff review"; PRD 1420 the safety console lists "members on watch and hold with the
  // events that caused it". A slop engine hold (trust_review) is visible to staff as a case. SD-027.
  val engineHoldVisible = ALL_MIDS.forall(m => (s.live.get(m) and trustReview(s, m)) implies Set("open", "held").contains(s.caseSt.get(m)))

  // trust.ts:7 "only a person lifts them": a staff lift or close ends the hold, and it stays ended until
  // something new happens. SD-027 ("no exit").
  val staffDecisionEndsEngineHold = s.staffCleared.forall(m => s.live.get(m) implies not(trustReview(s, m)))

  // network.ts:2602 o.post "came: !f.selfNoShow": a no-show counts against the person who did not come. SD-222.
  val noShowCountsAbsentOnly = ALL_MIDS.forall(m => s.live.get(m) implies
    noShows(s, m) <= OPP_IDS.filter(k => s.opps.get(k).absent.contains(m) and s.opps.get(k).stage != "deleted").size())

  // profile.ts:51 attendedSlots are the slots the member attended: the meeting's slot, not the answer's.
  // (days of the week; the UTC hour error is not modelled). SD-442.
  val slotFromMeeting = s.inters.forall(i => i.outcome == "completed" implies (i.at - i.meetingAt) % 7 == 0)

  // PRD F23 "'report' from any channel ... Reports create a safety case"; the slop check-in copy ("tell me and
  // I'll pass it to our safety team"); the peon check-in asks what "felt off". A report about someone the member
  // met is filed, as met, whatever the app the message is routed to. SD-220, SD-221, SD-250.
  val everyMetReportFiled = s.wanted.forall(w =>
    s.reports.exists(r => r.reporterP == w._1 and r.subject.p == w._2 and r.met))

  // PRD 40.5 (prd-snapshot.md:1820) "a relay log so past contacts can be told about a ban". SD-253.
  val pastContactsToldOfBan = s.banned.forall(p => PERSONS.forall(q => s.metPairs.contains((q, p)) implies s.toldOfBan.contains((q, p))))

  // PRD 1420 "moderation holds on relay messages" in the safety console; PRD F23 reports go to a safety case.
  // A relay message blocked as scam or harassment reaches the sender's safety case. SD-254.
  val relayBlockReachesSafety = s.relayLog.forall(x => (x._2 == "block" and s.live.get(x._1)) implies Set("open", "held").contains(s.caseSt.get(x._1)))

  // network.ts:4143 timingOf: a "safety" notice goes "now"; blooio outbound-queue.ts:46 quiet hours apply to
  // "transactional". A hold notice is never queued as transactional. SD-475.
  val safetyNoticeImmediate = s.holdNotices.forall(x => x._2 != "transactional")

  // Every rule above.
  val safety = and {
    staffHoldFollowsPerson,
    autoHoldFollowsPerson,
    minorSignalFollowsPerson,
    urgentMetReportBlocksMatching,
    holdOnlyLiftedByStaff,
    noSingleActorHold,
    reporterNotHeld,
    blockClosesAllApps,
    blockOnlyAffectsPair,
    metIsReal,
    checkInReportIntended,
    reportersCounted,
    watchLasts14Days,
    engineHoldVisible,
    staffDecisionEndsEngineHold,
    noShowCountsAbsentOnly,
    slotFromMeeting,
    everyMetReportFiled,
    pastContactsToldOfBan,
    relayBlockReachesSafety,
    safetyNoticeImmediate,
  }

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_dateDone = not(OPP_IDS.exists(k => s.opps.get(k).stage == "done"))
  val witness_checkInReport = not(s.reports.exists(r => r.source == "check_in"))
  val witness_messageReport = not(s.reports.exists(r => r.source == "message" and r.met))
  val witness_staffHold = not(s.staffHeldP != Set())
  val witness_liftToOk = not(s.lifts > 0)
  val witness_watch = not(ALL_MIDS.exists(m => lvl(s, m) == "watch"))
  val witness_rejoin = not(ALL_MIDS.exists(m => m.g == 1 and s.live.get(m)))
  val witness_ban = not(s.banned != Set())

  // ------------------------------------------------------------------ run tests (concrete traces)
  pure val ANA_S: Mid = { app: "slop", p: "ana", g: 0 }
  pure val BEN_S: Mid = { app: "slop", p: "ben", g: 0 }
  pure val CY_S: Mid = { app: "slop", p: "cy", g: 0 }
  pure val ANA_P: Mid = { app: "peon", p: "ana", g: 0 }
  pure val BEN_P: Mid = { app: "peon", p: "ben", g: 0 }

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

  // SD-021: staff hold ben, ben leaves slop and joins again: a new member id, level ok, matchable.
  run sd021LeaveRejoinClearsHoldTest =
    init
      .then(staffHold(BEN_S))
      .then(staffHoldApply(BEN_P))
      .expect(staffHoldFollowsPerson)
      .then(leave("slop", "ben"))
      .then(join("slop", "ben"))
      .expect(not(staffHoldFollowsPerson) and matchable(s, { app: "slop", p: "ben", g: 1 }))

  // SD-022: staff hold on slop, the process stops before the peon unit: ben is matchable on peon.
  run sd022HoldNotAtomicTest =
    init
      .then(staffHold(BEN_S))
      .then(crash)
      .expect(not(staffHoldFollowsPerson) and matchable(s, BEN_P))

  // SD-022: cy is held on slop, then joins peon: the new member is not held.
  run sd022JoinDuringHoldTest =
    init
      .then(staffHold(CY_S))
      .then(join("peon", "cy"))
      .expect(not(staffHoldFollowsPerson))

  // SD-074: a minor report on slop keeps ben matchable on peon.
  run sd074MinorReportOneAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "minor", false))
      .expect(not(minorSignalFollowsPerson) and matchable(s, BEN_P))

  // SD-025: a slop date and a peon intro between ana and ben; ana blocks ben on slop; the peon item stays open.
  run sd025BlockOneAppTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(bookDate("o2", "peon", "ana", "ben"))
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .expect(not(blockClosesAllApps) and s.opps.get("o2").stage == "scheduled")

  // SD-044 + SD-045: cy declined the plan probe; cy reports ana as met and the block closes ana and ben's plan.
  run sd044sd045DeclinerTest =
    init
      .then(bookPlan("o1", "slop", "ana", "ben", "cy", true))
      .then(report("cy", "slop", "ana", "report", "harassment", false))
      .expect(not(metIsReal) and not(blockOnlyAffectsPair) and not(matchable(s, ANA_S)))

  // SD-072: a banned member who met ana reports her: ana is out of matching.
  run sd072BannedReporterTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(ban("ben"))
      .then(report("ben", "slop", "ana", "report", "harassment", false))
      .expect(not(reporterNotHeld) and not(matchable(s, ANA_S)))

  // SD-067: a happy check-in answer misread as "minor": report, block and minor flag on an adult.
  run sd067HappyCheckInTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "minor"))
      .expect(not(checkInReportIntended) and s.minorF.get(BEN_S) and s.personBlocks.contains(("ana", "ben")))

  // SD-229: a credible check-in report is not counted by the trust rules.
  run sd229CheckInNotCountedTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "report", "harassment"))
      .expect(not(reportersCounted))

  // SD-220: the first answer is "it was fine", the disclosure comes after: no report.
  run sd220DisclosureAfterAnswerTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .then(disclose("o1", ANA_S))
      .expect(not(everyMetReportFiled))

  // SD-221: a peon check-in answer that reports something files nothing.
  run sd221PeonCheckInTest =
    init
      .then(bookDate("o1", "peon", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(checkIn("o1", ANA_P, "report", "harassment"))
      .expect(not(everyMetReportFiled))

  // SD-250: ana met ben on slop; "report Ben" is routed to peon (ben is a member there): met = false, no hold.
  run sd250MisroutedReportTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "peon", "ben", "report", "harassment", false))
      .expect(not(everyMetReportFiled) and matchable(s, BEN_S))

  // SD-141: score 1 on day 0, +2 on day 13 (watch), the decay on day 14 ends the watch after one day.
  run sd141ShortWatchTest =
    init
      .then(abuse(BEN_S, 1))
      .then(tick(13))
      .then(abuse(BEN_S, 2))
      .expect(lvl(s, BEN_S) == "watch")
      .then(tick(1))
      .expect(lvl(s, BEN_S) == "ok" and not(watchLasts14Days))

  // SD-027: ana and cy block ben (strangers); ben is in trust_review with no case; a staff close does not end it.
  run sd027TrustReviewTest =
    init
      .then(report("ana", "slop", "ben", "block", "harassment", false))
      .then(report("cy", "slop", "ben", "block", "harassment", false))
      .expect(trustReview(s, BEN_S) and not(engineHoldVisible))

  // SD-222: ben did not come and says so; ana is charged a no-show.
  run sd222SelfNoShowTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set(BEN_S)))
      .then(checkIn("o1", BEN_S, "selfNoShow", "none"))
      .expect(not(noShowCountsAbsentOnly) and noShows(s, ANA_S) == 1)

  // SD-442: the answer comes the nxt day: the completed interaction carries the answer day.
  run sd442SlotTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(meet("o1", Set()))
      .then(tick(1))
      .then(checkIn("o1", ANA_S, "fine", "none"))
      .expect(not(slotFromMeeting))

  // SD-253: ben met ana, then ben is banned: ana is never told.
  run sd253BanNoticeTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(ban("ben"))
      .expect(not(pastContactsToldOfBan))

  // SD-254: a relay block of ben's message opens no safety case.
  run sd254RelayBlockTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(relaySend("o1", BEN_S, "block"))
      .expect(not(relayBlockReachesSafety))

  // SD-475: a staff hold notice is queued as transactional.
  run sd475HoldNoticeKindTest =
    init
      .then(staffHold(BEN_S))
      .expect(not(safetyNoticeImmediate))

  // "Who do you mean?": the answer within a day applies the block to the counterpart.
  run answerWhoTest =
    init
      .then(bookDate("o1", "slop", "ana", "ben"))
      .then(report("ana", "slop", "ben", "report", "harassment", true))
      .then(answerWho(ANA_S))
      .expect(s.reports.exists(r => r.reporter == ANA_S and r.met) and everyMetReportFiled)
}
