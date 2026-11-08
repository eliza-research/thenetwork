// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=20000 verify-steps=8
//
// The plan run, the plan fallback and the crew offer and sessions (docs/research/2026-11-07-state-machines.md
// section 6.7: M-045 plan-run, M-046 plan-fallback, M-124 crew-offer-and-crew).
//
// Code: packages/engine/src/plans.ts (startPlanRun, recordPlanAnswer, checkPlanDeadline, planFallback,
// crewOptIn, crewSessionPlan) and packages/network/src/network.ts (submitPlan 2925, beginPlan 2940,
// planLane 2952, planProbe 2966, planAnswer 3008, planAct 3018, bookPlan 3041, planReveal 3076, planJoin 3091,
// planFallback 3109, planOut 3133, crewCheck 3162, onCrewAnswer 3192, resolveCrew 3203, crewSessions 3220,
// advance 3352, handleDrop 2512, close 2532, dropMember 2564, checkRecipient 4219, busy 4373, bookedNear 2869,
// onPlanProbeAnswer 2340, applyBlock 1426, the reveal and plan_probe send hooks 4076-4100, intro reveal 2411).
//
// The ConsentNetwork is in memory and has no await between the calls of one handler, so one inbound message,
// one tick or one actor event is one action. The send window, the one-a-day rule and the allowance only
// defer a plan probe (planDefer), so a probe is its own action that the simulator may take at any time.
//
// Oracles (README rule 7): the probe copy leak gate (buildPlanProbe's checkMemberFacing), the send-time leak
// guard, the Blooio streak (canSendLogistics) and "a matching public event exists" are nondeterministic.
//
// Abstractions:
//  - One group plan: invited a, b, c, d; alternate e (the engine bench); quorum 3 (DEFAULT_PLANS
//    quorum.group). The activity's smallest group (groupSize[0]) is 2 or 3, chosen at init.
//  - Partner plans are not modelled: the planner's partner path is not in any register defect of this module,
//    and the network never runs the fallback's partnerPlan (that is SD-008).
//  - Hours are small integers: probe deadline D, late-join cutoff CUTOFF (start - lateJoinHours), start S,
//    probe silence PROBE_TTL.
//  - An intro (a non-plan opportunity) for a plan member is a small per-member machine. Its time is the
//    plan's time: evidence() counts only scheduled items as away (network.ts:2285), so an intro may pick it.
//  - The crew machine runs on its own: one crew offer to a, b, c, then sessions by abstract week slot.
//
// Register defects this model reproduces (each invariant names its id): SD-008, SD-078, SD-046, SD-204,
// SD-268, SD-423, SD-479, SD-480, SD-144, SD-444, and the new Q-plan_run-1. See docs/research/quint-findings/plan_run.md.
module plan_run {

  // ------------------------------------------------------------------------------------------------
  // Constants

  pure val MEMBERS = Set("a", "b", "c", "d", "e")
  pure val INVITED = Set("a", "b", "c", "d")   // a group plan invites up to size.target (3-6), quorum 3
  pure val BENCH0 = ["e"]
  pure val CREW0 = Set("a", "b", "c")
  pure val QUORUM = 3          // DEFAULT_PLANS.quorum.group (engine/src/config.ts:497)
  pure val D = 4               // plan.probeDeadline
  pure val S = 10              // plan.window.start
  pure val LATEJOIN = 3        // pcfg.lateJoinHours
  pure val CUTOFF = S - LATEJOIN
  pure val PROBE_TTL = 3       // network.ts:440 (26 h)
  pure val MAXT = 13
  pure val CREW_TIMEOUT = 3    // crew offer resolves after 3 days (network.ts:3221)
  pure val HANDOFF = 3         // pcfg.crews.handOffAfterSessions
  pure val CREW_MIN = 3        // pcfg.crews.minMembers
  pure val MAXWEEK = 4

  // ------------------------------------------------------------------------------------------------
  // Types

  type Msg = { rcpt: str, kind: str, about: Set[str], at: int, minorInvolved: bool, blockedPair: bool, toOptedOut: bool }

  // The plan opportunity (Opp with o.plan and o.planRun) and its ghost fields.
  type Opp = {
    stage: str,                 // review | probing | scheduled | closed | done   (o.stage)
    runStage: str,                   // none | probing | booked | closed               (o.planRun.stage)
    answers: str -> str,        // o.planRun.answers: pending | yes | no | late
    bench: List[str],           // o.planRun.bench
    participants: Set[str],     // o.participants
    alternates: Set[str],       // o.alternates
    invited: Set[str],          // o.plan.invited (set once in beginPlan)
    status: str -> str,         // o.status
    contacted: Set[str],        // o.contacted
    sentAt: str -> int,         // o.sentAt
    bookedTold: Set[str],       // o.bookedTold
    msgs: Set[Msg],
    // ghosts
    named: Set[(str, str)],     // (learner, named member): a reveal named that member to the learner
    promised: Set[str],         // heard "Great, thanks. I'll tell you once enough people are in." (network.ts:2347)
    told: Set[str],             // heard how the plan ended for them (reveal, note, event, cancel notice)
    excused: Set[str],          // left on their own or by policy (STOP, minor, watch, block, "can't make it")
    seated: Set[str],           // who was seated at the last booking
    staleRefused: Set[str],     // probe refused only because of a member who is no longer in the run
    lateYesBooked: bool,        // a yes after the probe deadline booked the plan
    fallbackKind: str,          // none | smaller | solo_event | next_week | "" (no fallback ran)
    closedReason: str           // o.closedReason
  }

  type Env = {
    now: int, optedOut: Set[str], watch: Set[str], minors: Set[str], blocks: Set[(str, str)],
    intro: str -> str, minSize: int,
    // oracles
    streakBad: Set[str], eventExists: bool
  }

  type Act = { kind: str, member: str, going: Set[str] }
  pure val NONE: Act = { kind: "none", member: "", going: Set() }

  // ------------------------------------------------------------------------------------------------
  // State

  var now: int
  var plan: Opp
  var optedOut: Set[str]
  var watch: Set[str]
  var minors: Set[str]
  var blocks: Set[(str, str)]
  var minSize: int
  var intro: str -> str        // none | probing | yes | booked (an intro booked at the plan's time)
  // crew (network.ts:3162-3237, engine/src/plans.ts:664-740)
  var crewStage: str           // offered | formed | none
  var crewYes: Set[str]
  var crewNo: Set[str]
  var crewMembers: Set[str]
  var crewTold: Set[str]       // heard crewFormed / crewNotFormed
  var crewSessions: List[int]  // crew.sessions: PLAN ids (here: the slot), network.ts:3232
  var crewOpps: int -> str     // session opportunity id -> review | held | failed
  var crewOppSlot: int -> int  // session opportunity id -> slot
  var crewWeek: int            // the next free slot (time)
  var crewHandedOff: bool
  var crewEndTold: bool        // members heard that the weekly crew ended

  // ------------------------------------------------------------------------------------------------
  // Helpers

  pure def getOr(m: str -> str, k: str, d: str): str = if (m.keys().contains(k)) m.get(k) else d
  pure def yesOf(a: str -> str): Set[str] = a.keys().filter(k => a.get(k) == "yes")
  pure def pendingOf(a: str -> str): Set[str] = a.keys().filter(k => a.get(k) == "pending")
  pure def blocked(e: Env, x: str, y: str): bool = e.blocks.contains((x, y)) or e.blocks.contains((y, x))
  pure def withStatus(o: Opp, ids: Set[str], st: str): Opp =
    { ...o, status: ids.fold(o.status, (s, id) => s.put(id, st)) }
  pure def yesMembers(o: Opp): Set[str] = o.participants.filter(p => getOr(o.status, p, "") == "yes")
  pure def live(o: Opp, x: str): bool = getOr(o.answers, x, "") == "pending" or getOr(o.answers, x, "") == "yes"
  pure def isOpen(o: Opp): bool = o.stage == "review" or o.stage == "probing" or o.stage == "scheduled"

  /** planSeatOk (network.ts:2888) with busyOk: an adult, not opted out, trust ok. */
  pure def seatOk(e: Env, m: str): bool =
    not(e.minors.contains(m)) and not(e.optedOut.contains(m)) and not(e.watch.contains(m))

  /** bookedNear (network.ts:2869): booked in another scheduled opportunity near the plan's start. */
  pure def bookedNear(e: Env, m: str): bool = getOr(e.intro, m, "none") == "booked"

  /**
   * checkRecipient (network.ts:4219) for an ABOUT_OTHERS kind (probe, reveal): the reason, and the set of
   * other members that caused a refusal.
   */
  pure def checkRecipient(e: Env, id: str, about: Set[str]): (str, Set[str]) =
    if (e.optedOut.contains(id)) ("opted_out", Set())
    else if (e.minors.contains(id)) ("minor", Set())
    else if (e.watch.contains(id)) ("on_watch", Set())
    else {
      val bad = about.exclude(Set(id)).filter(x => blocked(e, id, x) or e.minors.contains(x) or e.watch.contains(x))
      if (bad == Set()) ("ok", Set()) else ("other", bad)
    }

  pure def send(e: Env, o: Opp, rcpt: str, kind: str, about: Set[str]): Opp = {
    val m: Msg = {
      rcpt: rcpt, kind: kind, about: about, at: e.now,
      minorInvolved: e.minors.contains(rcpt) or about.exists(x => e.minors.contains(x)),
      blockedPair: about.exists(x => x != rcpt and blocked(e, rcpt, x)),
      toOptedOut: e.optedOut.contains(rcpt)
    }
    { ...o, msgs: o.msgs.union(Set(m)) }
  }

  /** An "info" or "cancellation" send to one member (no others named): refused only when they opted out. */
  pure def tell(e: Env, o: Opp, rcpt: str, kind: str): Opp =
    if (e.optedOut.contains(rcpt)) o
    else { ...send(e, o, rcpt, kind, Set()), told: o.told.union(Set(rcpt)) }

  /** noteFor (network.ts:3130): a note folded into the member's next message. Counted as told. */
  pure def note(o: Opp, ids: Set[str]): Opp = { ...o, told: o.told.union(ids) }

  // ------------------------------------------------------------------------------------------------
  // Engine: recordPlanAnswer (engine/src/plans.ts:568-591), group plans only, and without opts.canMatch
  // (network.ts:3011 passes none).

  pure def recordable(o: Opp, m: str): bool = o.runStage != "closed" and getOr(o.answers, m, "") == "pending"

  pure def record(e: Env, o: Opp, m: str, yes: bool): (Opp, Act) = {
    val a1 = o.answers.put(m, if (yes) "yes" else "no")
    val o1 = { ...o, answers: a1 }
    if (yes) {
      if (o.runStage == "booked") {
        if (e.now <= CUTOFF) (o1, { kind: "join", member: m, going: Set() })
        else ({ ...o1, answers: a1.put(m, "late") }, NONE)
      } else {
        val y = yesOf(a1)
        // No deadline check here: a yes at any time while probing books (SD-423).
        if (y.size() >= QUORUM) ({ ...o1, runStage: "booked" }, { kind: "book", member: "", going: y })
        else (o1, NONE)
      }
    } else if (o.runStage == "booked") (o1, NONE)
    else if (e.now < D and o.bench.length() > 0) {
      // nextOnBench without canMatch: the head of the bench.
      val nx = o.bench.head()
      ({ ...o1, bench: o.bench.tail(), answers: a1.put(nx, "pending") }, { kind: "backfill", member: nx, going: Set() })
    }
    else if (pendingOf(a1).size() == 0 and yesOf(a1).size() < QUORUM) ({ ...o1, runStage: "closed" }, { kind: "fallback", member: "", going: Set() })
    else (o1, NONE)
  }

  // ------------------------------------------------------------------------------------------------
  // Network side

  /** close (network.ts:2532). */
  pure def closeF(e: Env, o: Opp, reason: str): Opp =
    if (not(isOpen(o))) o
    else {
      val wasProbing = o.stage == "probing" or o.stage == "review"
      val o1 = { ...o, stage: "closed", closedReason: reason }
      // Tell people who said yes, without saying who declined: only when it was not probing, and not for a block.
      if (wasProbing or reason == "blocked") o1
      else yesMembers(o1).fold(o1, (acc, id) => tell(e, acc, id, "declinedQuiet"))
    }

  /** handleDrop (network.ts:2512): a booked participant drops out. */
  pure def handleDrop(e: Env, o: Opp, m: str, ack: bool): Opp = {
    val o1 = { ...withStatus(o, Set(m), "dropped"),
               answers: if (o.runStage != "none") o.answers.put(m, "no") else o.answers }
    val still = yesMembers(o1)
    val keep = o1.participants.size() > 2 and still.size() >= 2
    val o2 = still.intersect(o1.bookedTold).fold(o1, (acc, id) => tell(e, acc, id, "dropNotice"))
    if (keep) o2 else { ...o2, stage: "closed" }
  }

  /** planReveal (network.ts:3076) through send(): the reveal hook's valid() and the send-time recipient check. */
  pure def planReveal(e: Env, o: Opp, id: str): Opp =
    if (o.stage != "scheduled" or getOr(o.status, id, "") != "yes") o
    else {
      val going = yesMembers(o)
      if (checkRecipient(e, id, going)._1 == "ok") {
        val o1 = send(e, o, id, "reveal", going)
        { ...o1, bookedTold: o1.bookedTold.union(Set(id)), told: o1.told.union(Set(id)),
                 named: o1.named.union(going.exclude(Set(id)).map(x => (id, x))) }
      }
      // onRefused: the plan cannot stand without them (network.ts:4087).
      else handleDrop(e, o, id, false)
    }

  /**
   * bookPlan (network.ts:3041). Returns the opportunity and "booked", "closed" or "fallback" (the caller runs
   * planFallback, which calls this again with fromFallback = true, so there is no recursion).
   */
  pure def bookPlanCore(e: Env, o: Opp, going: Set[str], fromFallback: bool): (Opp, str) = {
    val keep1 = going.filter(id => not(bookedNear(e, id)))
    val o1 = withStatus(o, going.exclude(keep1), "unavailable")   // plan_conflict, never told (SD-480)
    val seated = keep1.fold(Set(), (acc, id) =>
      if (checkRecipient(e, id, acc.union(Set(id)))._1 == "ok" and not(e.streakBad.contains(id))) acc.union(Set(id)) else acc)
    val o2 = withStatus(o1, keep1.exclude(seated), "unavailable")   // refused at reveal check, never told (SD-480)
    // A group plan with groupSize[0] <= 2 books two people (SD-008).
    val enough = seated.size() >= QUORUM or (seated.size() >= 2 and e.minSize <= 2)
    if (not(enough)) {
      val o3 = { ...o2, runStage: "closed" }
      if (fromFallback or seated.size() < 2) (closeF(e, note(o3, seated), "plan did not come together"), "closed")
      else (o3, "fallback")
    } else {
      val o3 = { ...withStatus(o2, seated, "yes"), stage: "scheduled", runStage: "booked", seated: seated }
      (seated.fold(o3, (acc, id) => planReveal(e, acc, id)), "booked")
    }
  }

  /** planFallback (network.ts:3109) with engine planFallback (engine/src/plans.ts:640-654). */
  pure def planFallbackF(e: Env, o: Opp): Opp = {
    val o1 = { ...o, runStage: "closed" }
    val yes = yesOf(o1.answers)
    if (yes.size() == 0) closeF(e, { ...o1, fallbackKind: "none" }, "plan did not come together")
    else if (yes.size() >= 2 and e.minSize <= 2 and S - e.now > LATEJOIN)
      // fallback.partnerPlan (fresh one-to-one consent) is ignored: the yes-sayers are booked (SD-008).
      bookPlanCore(e, { ...o1, fallbackKind: "smaller" }, yes, true)._1
    else if (e.eventExists) {
      val c = closeF(e, { ...o1, fallbackKind: "solo_event" }, "plan did not come together")
      yes.fold(c, (acc, id) => tell(e, acc, id, "planEvent"))
    } else note(closeF(e, { ...o1, fallbackKind: "next_week" }, "plan did not come together"), yes)
  }

  pure def bookPlanMain(e: Env, o: Opp, going: Set[str]): Opp = {
    val r = bookPlanCore(e, o, going, false)
    if (r._2 == "fallback") planFallbackF(e, r._1) else r._1
  }

  /** planJoin (network.ts:3091): a late yes after booking. The reveal goes to the joiner only (SD-479). */
  pure def planJoin(e: Env, o: Opp, j: str): Opp =
    if (bookedNear(e, j) or checkRecipient(e, j, yesMembers(o))._1 != "ok") withStatus(o, Set(j), "unavailable")
    else planReveal(e, withStatus(o, Set(j), "yes"), j)

  /** planAct (network.ts:3018). Probes for a backfill go out later through the plan lane (the probe action). */
  pure def planAct(e: Env, o: Opp, act: Act): Opp =
    if (act.kind == "book") bookPlanMain(e, o, act.going)
    else if (act.kind == "join") planJoin(e, o, act.member)
    else if (act.kind == "backfill")
      { ...withStatus(o, Set(act.member), "probing"),
        participants: o.participants.union(Set(act.member)), alternates: o.alternates.exclude(Set(act.member)) }
    else if (act.kind == "fallback") planFallbackF(e, o)
    else o

  /** planAnswer (network.ts:3008). */
  pure def planAnswerF(e: Env, o: Opp, m: str, yes: bool, silent: bool): Opp =
    if (not(recordable(o, m))) o
    else {
      val r = record(e, o, m, yes)
      val o1 = withStatus(r._1, Set(m), if (yes) "available" else if (silent) "unavailable" else "no")
      val o2 = { ...o1, lateYesBooked: o1.lateYesBooked or (yes and r._2.kind == "book" and e.now >= D) }
      planAct(e, o2, r._2)
    }

  /** planOut (network.ts:3133). */
  pure def planOut(e: Env, o: Opp, m: str): Opp =
    if (getOr(o.answers, m, "") == "pending") planAnswerF(e, o, m, false, true)
    else if (getOr(o.status, m, "") == "available")
      { ...withStatus(o, Set(m), "unavailable"), answers: o.answers.put(m, "no") }
    else if (getOr(o.status, m, "") == "queued") withStatus(o, Set(m), "unavailable")
    else o

  /** dropMember (network.ts:2564) for the plan opportunity. */
  pure def dropMember(e: Env, o: Opp, m: str, minor: bool): Opp =
    if (not(isOpen(o))) o
    else {
      val wasAlternate = minor and o.alternates.contains(m)
      val o1 = { ...o, alternates: o.alternates.exclude(Set(m)), excused: o.excused.union(Set(m)) }
      if (wasAlternate and not(o1.participants.contains(m)) and o1.stage != "scheduled") closeF(e, o1, "minors policy")
      else if (not(o1.participants.contains(m))) o1
      else if (minor and o1.stage != "scheduled") closeF(e, o1, "minors policy")
      else if (o1.stage == "review") closeF(e, o1, "dropped")
      else if (o1.stage == "probing") planOut(e, o1, m)
      else handleDrop(e, o1, m, false)
    }

  /**
   * planProbe (network.ts:2966) once the plan lane lets it go out: seat check, the probe copy
   * (buildPlanProbe returns null for a recipient not in plan.invited, engine/src/plans.ts:488, or when the
   * leak gate drops every frame: copyOk), then send() with about = o.plan.invited (network.ts:2995) and the
   * send-time leak guard (leakOk).
   */
  pure def probeF(e: Env, o: Opp, m: str, copyOk: bool, leakOk: bool): Opp =
    if (not(seatOk(e, m))) planAnswerF(e, o, m, false, true)
    else if (not(o.invited.contains(m)) or not(copyOk)) planAnswerF(e, o, m, false, true)   // refuse "plan_copy"
    else {
      val chk = checkRecipient(e, m, o.invited)
      if (chk._1 == "ok" and leakOk) {
        val o1 = send(e, o, m, "probe", o.invited)
        { ...o1, contacted: o1.contacted.union(Set(m)), sentAt: o1.sentAt.put(m, e.now) }
      } else {
        val stale = chk._1 == "other" and chk._2.forall(x => not(live(o, x)))
        val o1 = if (stale) { ...o, staleRefused: o.staleRefused.union(Set(m)) } else o
        planOut(e, o1, m)                                                   // onRefused (network.ts:4099)
      }
    }

  /** advance (network.ts:3352-3368, 3405-3412) for the plan: probe silence, the deadline, the meeting is over. */
  pure def tickF(e: Env, o: Opp): Opp = {
    val active = o.runStage != "none" and (o.stage == "probing" or o.stage == "scheduled")
    val o1 = if (not(active)) o else MEMBERS.fold(o, (acc, p) =>
      if (getOr(acc.answers, p, "") == "pending" and acc.sentAt.keys().contains(p) and e.now >= acc.sentAt.get(p) + PROBE_TTL)
        planAnswerF(e, acc, p, false, true)
      else acc)
    val o2 = if (o1.stage == "probing" and o1.runStage == "probing" and e.now >= D) planFallbackF(e, { ...o1, runStage: "closed" }) else o1
    if (o2.stage == "scheduled" and e.now >= S + 1)
      withStatus({ ...o2, stage: "done" }, pendingOf(o2.answers), "unavailable")
    else o2
  }

  // ------------------------------------------------------------------------------------------------
  // Environment record from the state

  def envOf(streakBad: Set[str], eventExists: bool): Env = {
    now: now, optedOut: optedOut, watch: watch, minors: minors, blocks: blocks, intro: intro, minSize: minSize,
    streakBad: streakBad, eventExists: eventExists
  }
  def env0: Env = envOf(Set(), false)

  /** busy (network.ts:4373) for the plan opportunity only. */
  def busyInPlan(m: str): bool = {
    val st = getOr(plan.status, m, "")
    isOpen(plan) and plan.participants.contains(m) and not(Set("unavailable", "no", "dropped").contains(st))
      and not(plan.stage == "probing" and st == "available")
  }
  /** busy() for the intro: an open intro (probing, or booked and not yet held) makes the plan probe wait. */
  def introBusy(m: str): bool = getOr(intro, m, "none") != "none"

  // ------------------------------------------------------------------------------------------------
  // Init

  pure val OPP0: Opp = {
    stage: "review", runStage: "none", answers: Map(), bench: BENCH0, participants: INVITED, alternates: Set("e"),
    invited: Set(), status: Map(), contacted: Set(), sentAt: Map(), bookedTold: Set(), msgs: Set(),
    named: Set(), promised: Set(), told: Set(), excused: Set(), seated: Set(), staleRefused: Set(),
    lateYesBooked: false, fallbackKind: "", closedReason: ""
  }

  action initWith(ms: int): bool = all {
    now' = 0, plan' = OPP0, optedOut' = Set(), watch' = Set(), minors' = Set(), blocks' = Set(), minSize' = ms,
    intro' = MEMBERS.mapBy(_ => "none"),
    crewStage' = "offered", crewYes' = Set(), crewNo' = Set(), crewMembers' = CREW0, crewTold' = Set(),
    crewSessions' = List(), crewOpps' = Map(), crewOppSlot' = Map(), crewWeek' = 0, crewHandedOff' = false,
    crewEndTold' = false,
  }
  action init = { nondet ms = Set(2, 3).oneOf() initWith(ms) }

  action keepEnv = all {
    optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, intro' = intro,
  }
  action keepCrew = all {
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold,
  }

  // ------------------------------------------------------------------------------------------------
  // Plan actions

  /** A reviewer approves the plan: beginPlan (network.ts:2940) with engine startPlanRun. */
  action approve = all {
    plan.stage == "review",
    plan' = { ...withStatus(plan, plan.participants, "probing"),
              stage: "probing", runStage: "probing", invited: plan.participants,
              answers: plan.participants.mapBy(_ => "pending"), bench: BENCH0 },
    now' = now, keepEnv, keepCrew,
  }

  /** A reviewer rejects, or the review SLA passes (network.ts:3344-3350). */
  action reject = all {
    plan.stage == "review",
    plan' = closeF(env0, plan, "review expired"),
    now' = now, keepEnv, keepCrew,
  }

  /** The plan lane sends a pending member's probe (send window, one a day and allowance are deferrals). */
  action probe(m: str, copyOk: bool, leakOk: bool): bool = all {
    // advance() runs the deadline check before planLane (network.ts:3365-3369), so no probe goes out at or
    // after the deadline while probing; after booking, probes go out until the late-join cutoff (network.ts:2954).
    (plan.stage == "probing" and now < D) or (plan.stage == "scheduled" and now <= CUTOFF),
    getOr(plan.answers, m, "") == "pending", not(plan.contacted.contains(m)), not(introBusy(m)),
    plan' = probeF(env0, plan, m, copyOk, leakOk),
    now' = now, keepEnv, keepCrew,
  }

  /** The member answers the probe (onPlanProbeAnswer, network.ts:2340); m.awaiting routes it while the opp is open. */
  action answer(m: str, yes: bool, streakBad: Set[str], eventExists: bool): bool = all {
    plan.contacted.contains(m), getOr(plan.answers, m, "") == "pending",
    plan.stage == "probing" or plan.stage == "scheduled", not(optedOut.contains(m)),
    val o = if (yes) { ...plan, promised: plan.promised.union(Set(m)) } else plan
    plan' = planAnswerF(envOf(streakBad, eventExists), o, m, yes, false),
    now' = now, keepEnv, keepCrew,
  }

  /** A booked member says they can't make it (handleDrop with ack, network.ts:2512). */
  action cantMakeIt(m: str): bool = all {
    plan.stage == "scheduled", getOr(plan.status, m, "") == "yes", not(optedOut.contains(m)),
    plan' = handleDrop(env0, { ...plan, excused: plan.excused.union(Set(m)) }, m, true),
    now' = now, keepEnv, keepCrew,
  }

  /** The service tick: advance() for the plan. */
  action tick(streakBad: Set[str], eventExists: bool): bool = all {
    plan' = tickF(envOf(streakBad, eventExists), plan),
    now' = now, keepEnv, keepCrew,
  }

  action clock = all { now < MAXT, now' = now + 1, plan' = plan, keepEnv, keepCrew }

  // ------------------------------------------------------------------------------------------------
  // Other actors

  /** STOP (network.ts:675): opted out, then dropMember. */
  action stop(m: str): bool = all {
    not(optedOut.contains(m)),
    val e = { ...env0, optedOut: optedOut.union(Set(m)) }
    plan' = dropMember(e, plan, m, false),
    optedOut' = optedOut.union(Set(m)),
    now' = now, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, intro' = intro, keepCrew,
  }

  /** Trust goes to watch (onTrustChange, network.ts:1188): dropMember. */
  action goWatch(m: str): bool = all {
    not(watch.contains(m)),
    val e = { ...env0, watch: watch.union(Set(m)) }
    plan' = dropMember(e, plan, m, false),
    watch' = watch.union(Set(m)),
    now' = now, optedOut' = optedOut, minors' = minors, blocks' = blocks, minSize' = minSize, intro' = intro, keepCrew,
  }

  /** A minor signal (network.ts:721): dropMember with the minors policy. */
  action minorSignal(m: str): bool = all {
    not(minors.contains(m)),
    val e = { ...env0, minors: minors.union(Set(m)) }
    plan' = dropMember(e, plan, m, true),
    minors' = minors.union(Set(m)),
    now' = now, optedOut' = optedOut, watch' = watch, blocks' = blocks, minSize' = minSize, intro' = intro, keepCrew,
  }

  /** A member blocks another (applyBlock, network.ts:1426): an open opportunity with both is closed. */
  action block(m: str, x: str): bool = all {
    m != x, not(blocks.contains((m, x))),
    val e = { ...env0, blocks: blocks.union(Set((m, x))) }
    val both = isOpen(plan) and plan.participants.contains(m) and plan.participants.contains(x)
    val o1 = { ...plan, excused: plan.excused.union(Set(m, x)) }
    val o2 = if (both and plan.stage == "scheduled")
      plan.participants.filter(id => id != m and getOr(plan.status, id, "") == "yes" and plan.bookedTold.contains(id))
        .fold(o1, (acc, id) => tell(e, acc, id, "declinedQuiet"))
      else o1
    plan' = if (both) closeF(e, o2, "blocked") else plan,
    blocks' = blocks.union(Set((m, x))),
    now' = now, optedOut' = optedOut, watch' = watch, minors' = minors, minSize' = minSize, intro' = intro, keepCrew,
  }

  /** An intro probe reaches a plan member who is not busy (network.ts:4373-4379: a plan yes is not busy). */
  action introProbe(m: str): bool = all {
    getOr(intro, m, "none") == "none", not(busyInPlan(m)), seatOk(env0, m),
    intro' = intro.set(m, "probing"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, keepCrew,
  }
  /** The member picks the plan's time: evidence() counts only scheduled items as away (network.ts:2285). */
  action introYes(m: str): bool = all {
    getOr(intro, m, "none") == "probing",
    intro' = intro.set(m, "yes"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, keepCrew,
  }
  /** The other side says yes: reveal() (network.ts:2411) books it, with no bookedNear check. */
  action introBook(m: str): bool = all {
    getOr(intro, m, "none") == "yes", seatOk(env0, m),
    intro' = intro.set(m, "booked"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, keepCrew,
  }

  // ------------------------------------------------------------------------------------------------
  // Crew actions

  action keepPlanSide = all { now' = now, plan' = plan, keepEnv }

  action resolveCrew(yes: Set[str]): bool = all {
    crewStage' = if (yes.size() >= CREW_MIN) "formed" else "none",
    crewMembers' = if (yes.size() >= CREW_MIN) crewMembers.intersect(yes) else crewMembers,
    crewTold' = crewTold.union(yes.filter(id => not(optedOut.contains(id)))),
  }

  /** onCrewAnswer (network.ts:3192): when everyone answered, resolveCrew (network.ts:3203). */
  action crewAnswer(m: str, yes: bool): bool = all {
    crewStage == "offered", CREW0.contains(m), not(crewYes.contains(m)), not(crewNo.contains(m)),
    val y = if (yes) crewYes.union(Set(m)) else crewYes
    val n = if (yes) crewNo else crewNo.union(Set(m))
    all {
      crewYes' = y, crewNo' = n,
      if (y.size() + n.size() >= CREW0.size()) resolveCrew(y)
      else all { crewStage' = crewStage, crewMembers' = crewMembers, crewTold' = crewTold },
    },
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, keepPlanSide,
  }

  /** The offer resolves after 3 days (network.ts:3221). */
  action crewTimeout = all {
    crewStage == "offered", now >= CREW_TIMEOUT,
    resolveCrew(crewYes), crewYes' = crewYes, crewNo' = crewNo,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, keepPlanSide,
  }

  /**
   * crewSessions (network.ts:3220-3237): no open session for the crew, enough seats, then the dedupe
   * `crew.sessions.some(id => this.opps.get(id)?.plan?.window.start === next.window.start)`. crew.sessions
   * holds PLAN ids; this.opps is keyed by OPPORTUNITY ids (newOpp, network.ts:2928), so the lookup is never
   * found (SD-144). The hand-off counts proposals, not sessions held, and tells nobody (SD-444).
   */
  action crewTick = all {
    crewStage == "formed", not(crewHandedOff),
    crewOpps.keys().forall(k => crewOpps.get(k) != "review"),
    crewMembers.filter(id => seatOk(env0, id)).size() >= CREW_MIN,
    val slot = crewWeek
    val planId = slot
    val dup = crewSessions.select(pid => crewOpps.keys().contains(pid) and crewOppSlot.get(pid) == slot).length() > 0
    val oppId = 100 + crewSessions.length()
    all {
      not(dup),
      crewSessions' = crewSessions.append(planId),
      crewOpps' = crewOpps.put(oppId, "review"),
      crewOppSlot' = crewOppSlot.put(oppId, slot),
      crewHandedOff' = crewSessions.length() + 1 >= HANDOFF,
    },
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewWeek' = crewWeek, crewEndTold' = crewEndTold, keepPlanSide,
  }

  /** A session ends: held (its time passed), or failed (rejected, expired in review, or no quorum). */
  action crewSessionEnd(id: int, held: bool): bool = all {
    crewOpps.keys().contains(id), crewOpps.get(id) == "review",
    crewOpps' = crewOpps.set(id, if (held) "held" else "failed"),
    crewWeek' = if (held and crewOppSlot.get(id) + 1 > crewWeek) crewOppSlot.get(id) + 1 else crewWeek,
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOppSlot' = crewOppSlot, crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold,
    keepPlanSide,
  }

  /** Time moves on to the next weekly slot. */
  action crewWeekPass = all {
    crewWeek < MAXWEEK, crewWeek' = crewWeek + 1,
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewHandedOff' = crewHandedOff,
    crewEndTold' = crewEndTold, keepPlanSide,
  }

  // ------------------------------------------------------------------------------------------------
  // Step

  action step = {
    nondet m = MEMBERS.oneOf()
    nondet x = MEMBERS.oneOf()
    // Weighted oracles (a set cannot hold a value twice): yes 3 in 4; probe copy fails 1 in 8 and the
    // send-time leak guard 1 in 8; the Blooio streak refuses the member 1 in 3.
    nondet yesR = 0.to(3).oneOf()
    nondet okR = 0.to(7).oneOf()
    nondet streakR = 0.to(2).oneOf()
    nondet eventExists = Set(true, false).oneOf()
    nondet sid = Set(100, 101, 102).oneOf()
    val yes = yesR > 0
    val streakBad = if (streakR == 0) Set(m) else Set()
    any {
      approve, reject,
      // Plan steps appear more than once so that random traces reach booking before time runs out.
      probe(m, okR != 1, okR != 2), probe(m, okR != 1, okR != 2), probe(m, okR != 1, okR != 2),
      answer(m, yes, streakBad, eventExists), answer(m, yes, streakBad, eventExists), answer(m, yes, streakBad, eventExists),
      tick(streakBad, eventExists), clock,
      // Actor events are rarer than plan steps: one branch picks one of them.
      any { stop(m), goWatch(m), minorSignal(m), block(m, x), cantMakeIt(m) },
      any { introProbe(m), introYes(m), introBook(m) },
      crewAnswer(m, yes), crewTimeout, crewTick, crewSessionEnd(sid, yes), any { crewWeekPass },
    }
  }


  // ------------------------------------------------------------------------------------------------
  // Safety invariants (written from the rules, not from the code)

  /**
   * SD-008. A group plan is never booked with two people. Rule: plans are groups of 3-6 (D15, PRD 33.4,
   * engine/src/config.ts resolvePlans), and a group's two yes-sayers "said yes to a group, not to a one-to-one
   * meeting, so the pair is NEVER booked directly" (engine/src/plans.ts:600-606). Code: network.ts:3118 books
   * fallback.members and ignores fallback.partnerPlan; bookPlan's `enough` (network.ts:3060) accepts 2.
   */
  val pairNeverBookedFromGroup: bool =
    (plan.stage == "scheduled" or plan.seated.size() > 0) implies plan.seated.size() >= QUORUM

  /**
   * SD-078. A booked group never shrinks to a two-person meeting that nobody agreed to. Rule: as above, plus
   * partnerPlanFor's doc "a booking that shrank to two ... becomes a fresh activity-partner plan" (engine
   * plans.ts:612-616). Code: handleDrop keeps a group of 3+ participants on with 2 left (network.ts:2524).
   */
  val groupNeverShrinksToPair: bool =
    (plan.stage == "scheduled" and plan.seated.size() >= QUORUM) implies yesMembers(plan).size() != 2

  /**
   * Names only after quorum. Rule: the probe promises "I'll share who's coming once enough people say yes"
   * (engine plans.ts FRAME_COPY); a reveal names only members who said yes to this plan, and only after the
   * group reached quorum. Fails with SD-008 (the pair learns each other's names without quorum).
   */
  val noNameBeforeQuorum: bool =
    plan.named.forall(p => getOr(plan.answers, p._2, "") == "yes" and plan.seated.size() >= QUORUM)

  /**
   * SD-204. A backfilled alternate is part of the plan. Rule: Plan.invited is "Members probed (primary group,
   * plus alternates once backfilled)" (engine/src/plans.ts:199). Code: beginPlan sets o.plan.invited once
   * (network.ts:2942); planAct's backfill adds only to o.participants (network.ts:3024); buildPlanProbe returns
   * null for a recipient not in plan.invited (engine plans.ts:488), so the alternate is refused "plan_copy".
   */
  val planInvitedCurrent: bool =
    plan.runStage != "none" implies plan.answers.keys().subseteq(plan.invited)

  /**
   * SD-046. A probe is never refused because of a member who has already left the run. Rule: checkRecipient
   * checks "every other person" the message is about (network.ts:4216-4218); a member who said no, went
   * silent or was dropped is no longer someone the plan is about. Code: the probe's about is the stale
   * o.plan.invited (network.ts:2995).
   */
  val noStaleRefusal: bool = plan.staleRefused == Set()

  /**
   * SD-423. A yes after the probe deadline never books the plan. Rule: the probe "Expires at the probe
   * deadline" (engine plans.ts:440-443) and "At the probe deadline without quorum: close and fall back"
   * (plans.ts:593). Code: recordPlanAnswer has no deadline check for a yes (plans.ts:577-578); only the tick
   * runs checkPlanDeadline (network.ts:3365-3367).
   */
  val noBookAfterDeadline: bool = not(plan.lateYesBooked)

  /**
   * SD-268. A member is never booked twice at the same time. Rule: bookPlan "Anyone booked elsewhere within 4
   * hours of the start is left out" (network.ts:3036) and "A member's booked plans count as away when a time
   * is chosen for anything else (plans ask 5)" (network.ts:2284). Code: busy() skips a plan yes
   * (network.ts:4376), and the intro reveal (network.ts:2411) has no bookedNear check.
   */
  val noDoubleBooking: bool =
    MEMBERS.forall(m => not(getOr(intro, m, "none") == "booked" and plan.stage == "scheduled" and getOr(plan.status, m, "") == "yes"))

  /**
   * SD-480. A yes-sayer always hears how the plan ended. Rule: the ack promises "I'll tell you once enough
   * people are in" (network.ts:2347); planFallback "Yes-sayers hear 'that plan didn't come together'"
   * (network.ts:3106). Exempt: members who left on their own or by policy, and a plan closed for the minors
   * policy or a block (any later message about it is a minor contact or says why, dropMember network.ts:2568-2571,
   * applyBlock network.ts:1437). Code: bookPlan drops plan_conflict (network.ts:3046) and refused seats
   * (network.ts:3056) with no note. Q-plan_run-1: a yes after the late-join cutoff is acked and then marked "late"
   * (engine plans.ts:574) with no note.
   */
  val yesSayerTold: bool =
    (plan.stage == "closed" or plan.stage == "done" or plan.stage == "scheduled")
      and plan.closedReason != "minors policy" and plan.closedReason != "blocked" implies
      plan.promised.exclude(plan.excused).exclude(yesMembers(plan)).exclude(pendingOf(plan.answers)).subseteq(plan.told)

  /**
   * SD-479. Reveals are mutual: in a booked plan, a member who learned another's name is also named to them.
   * Rule: double opt-in and "I'll share who's coming once enough people say yes" to every invitee (FRAME_COPY).
   * Code: planJoin sends planReveal to the joiner only (network.ts:3095-3100).
   */
  val revealSymmetric: bool =
    plan.stage == "scheduled" implies plan.named.forall(p =>
      not(getOr(plan.status, p._1, "") == "yes" and getOr(plan.status, p._2, "") == "yes") or plan.named.contains((p._2, p._1)))

  /** Minors (13-17) are never matched or connected (AGENTS.md age policy, core/src/policy.ts). */
  val noMinorContact: bool =
    plan.msgs.forall(msg => not(msg.minorInvolved)) and (plan.stage == "scheduled" implies yesMembers(plan).forall(id => not(minors.contains(id))))

  /** A block between two members stops every message about one to the other (checkRecipient, AGENTS.md). */
  val noContactAcrossBlock: bool = plan.msgs.forall(msg => not(msg.blockedPair))

  /** STOP stops every app (AGENTS.md platform decision 7): no message to an opted-out member. */
  val noContactAfterStop: bool = plan.msgs.forall(msg => not(msg.toOptedOut))

  /** Every proactive proposal goes through human review first (AGENTS.md code invariants). */
  val reviewBeforeContact: bool = plan.runStage == "none" implies plan.msgs == Set()

  /**
   * SD-144. One session proposal per crew slot. Rule: the dedupe in crewSessions (network.ts:3230) and "weekly,
   * same time and place, each session opt-in and reviewed like any plan" (network.ts:3214). Code: the dedupe
   * looks up plan ids in a map keyed by opportunity ids, so it never matches.
   */
  val sessionSlotOnce: bool =
    crewSessions.indices().forall(i => crewSessions.indices().forall(j => i == j or crewSessions[i] != crewSessions[j]))

  /**
   * SD-444 (part 2). The crew is handed off after 3 sessions (network.ts:3215 "the Network hands the crew off
   * after 3 sessions"), not after 3 proposals: a failed session does not count.
   */
  val handoffCountsSessions: bool =
    crewHandedOff implies crewOpps.keys().filter(k => crewOpps.get(k) != "failed").size() >= HANDOFF

  /**
   * SD-444 (part 1). crewFormed promises "Your weekly crew is on" (copy.ts:154); when the last session is
   * over after the hand-off, the members hear that the weekly crew ended. Code: only a log line (network.ts:3235).
   */
  val crewEndHeard: bool =
    (crewHandedOff and crewOpps.keys().forall(k => crewOpps.get(k) != "review")) implies crewEndTold

  /** A crew forms only with members who opted in (crewOptIn, founder decision 2026-10-08). */
  val crewOptedIn: bool = crewStage == "formed" implies (crewMembers.subseteq(crewYes) and crewMembers.size() >= CREW_MIN)

  val safety: bool = and {
    pairNeverBookedFromGroup, groupNeverShrinksToPair, noNameBeforeQuorum, planInvitedCurrent, noStaleRefusal,
    noBookAfterDeadline, noDoubleBooking, yesSayerTold, revealSymmetric, noMinorContact, noContactAcrossBlock,
    noContactAfterStop, reviewBeforeContact, sessionSlotOnce, handoffCountsSessions, crewEndHeard, crewOptedIn,
  }

  // Safety without the register defects this model shows (the guards that must hold today).
  val guards: bool = and { noMinorContact, noContactAcrossBlock, noContactAfterStop, reviewBeforeContact, crewOptedIn }

  // ------------------------------------------------------------------------------------------------
  // Witnesses (each must be violated: the state is reachable)

  val witness_quorumBooks = not(plan.stage == "scheduled" and plan.seated.size() >= QUORUM)
  val witness_soloEventCloses = not(plan.stage == "closed" and plan.fallbackKind == "solo_event" and plan.msgs.exists(m => m.kind == "planEvent"))
  val witness_backfill = not(plan.participants.contains("e") and getOr(plan.answers, "e", "") != "")
  val witness_lateJoin = not(plan.stage == "scheduled" and yesMembers(plan).size() > plan.seated.size())
  val witness_stopWhileProbing = not(plan.stage == "probing" and optedOut.size() > 0 and plan.contacted.size() > 0)
  val witness_crewSession = not(crewOpps.keys().exists(k => crewOpps.get(k) == "held"))
  val witness_crewNotFormed = not(crewStage == "none")

  // ------------------------------------------------------------------------------------------------
  // Run tests (concrete traces)

  pure val NOSTREAK: Set[str] = Set()

  /** Quorum 3 books: a, b, c say yes; each learns the other two names; d is still pending. */
  run quorumBooksTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and plan.seated == Set("a", "b", "c") and plan.named.size() == 6 and safety)

  /** SD-008 (register: bouldering, groupSize [2, 6]): two yes, two no, the bench drains, the pair is booked with names. */
  run sd008PairBookedTest =
    initWith(2).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true)).then(probe("d", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false))
      .then(answer("c", false, NOSTREAK, false))
      // c's no backfills e; e's probe has no copy (e is not in plan.invited, SD-204): a silent no.
      .then(probe("e", true, true))
      .then(answer("d", false, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and plan.seated == Set("a", "b") and plan.named.contains(("a", "b"))
              and plan.fallbackKind == "smaller" and not(pairNeverBookedFromGroup) and not(noNameBeforeQuorum))

  /** SD-204: c says no, e is backfilled and never gets a probe: the plan's invited list does not have e. */
  run sd204BackfillTest =
    initWith(3).then(approve)
      .then(probe("c", true, true)).then(answer("c", false, NOSTREAK, false))
      .expect(not(planInvitedCurrent))
      .then(probe("e", true, true))
      .expect(getOr(plan.answers, "e", "") == "no" and not(plan.contacted.contains("e")))

  /** SD-078: a group of 3 is booked; one says "can't make it"; the other two stay booked as a pair. */
  run sd078ShrinkTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(cantMakeIt("c"))
      .expect(plan.stage == "scheduled" and yesMembers(plan) == Set("a", "b") and not(groupNeverShrinksToPair))

  /** SD-046 (register trace): probes wait; c goes on watch (a silent no); d's probe is refused because of c. */
  run sd046StaleInvitedTest =
    initWith(3).then(approve)
      .then(probe("a", true, true))
      .then(goWatch("c"))
      .then(probe("d", true, true))
      .expect(plan.staleRefused.contains("d") and not(noStaleRefusal) and getOr(plan.answers, "d", "") == "no")

  /** SD-423: two yes before the deadline; the third yes after it, before the tick, books the plan. */
  run sd423LateYesTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false))
      .then(clock).then(clock).then(clock).then(clock)
      .then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and not(noBookAfterDeadline))

  /** SD-268: a's plan yes leaves a free for an intro at the same time; the plan books, then the intro books. */
  run sd268DoubleBookTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false))
      .then(introProbe("a")).then(introYes("a"))
      .then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(introBook("a"))
      .expect(not(noDoubleBooking))

  /**
   * SD-480: activity groupSize[0] = 2. a says yes, then is booked in an intro at the plan's time. b and c say
   * yes: bookPlan drops a (plan_conflict) and books b and c. a heard "I'll tell you once enough people are in"
   * and hears nothing more.
   */
  run sd480ConflictSilentTest =
    initWith(2).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false))
      .then(introProbe("a")).then(introYes("a")).then(introBook("a"))
      .then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and getOr(plan.status, "a", "") == "unavailable" and not(plan.told.contains("a"))
              and not(yesSayerTold))

  /** SD-479: a, b, c are booked with d pending; d's late yes joins; d learns a, b, c; they never learn d. */
  run sd479LateJoinTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true)).then(probe("d", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(answer("d", true, NOSTREAK, false))
      .expect(getOr(plan.status, "d", "") == "yes" and plan.named.contains(("d", "a")) and not(plan.named.contains(("a", "d")))
              and not(revealSymmetric))

  /**
   * Q-plan_run-1: a, b, c are booked. The plan lane still probes d after booking, until the late-join cutoff
   * (network.ts:2954). d says yes after the cutoff, inside the probe silence window: the ack says "I'll tell you
   * once enough people are in" (network.ts:2347), recordPlanAnswer marks the answer "late" (engine
   * plans.ts:573-575), planAct does nothing, and d hears nothing more.
   */
  run qLateYesSilentTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(clock).then(clock).then(clock).then(clock).then(clock).then(clock).then(clock)
      .then(probe("d", true, true))
      .then(clock)
      .then(answer("d", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and getOr(plan.answers, "d", "") == "late" and plan.promised.contains("d")
              and not(plan.told.contains("d")) and not(yesSayerTold))

  /** SD-144 and SD-444: a crew forms; two sessions fail in review and the same slot is proposed again; hand-off after 3. */
  run sd144sd444CrewTest =
    initWith(3)
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick).then(crewSessionEnd(100, false))
      .then(crewTick).then(crewSessionEnd(101, false))
      .then(crewTick).then(crewSessionEnd(102, true))
      .expect(crewHandedOff and not(sessionSlotOnce) and not(handoffCountsSessions) and not(crewEndHeard))
}
