// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=50000 verify-steps=8
//
// The plan run, the plan fallback and the crew offer and sessions (docs/research/2026-11-07-state-machines.md
// section 6.7: M-045 plan-run, M-046 plan-fallback, M-124 crew-offer-and-crew).
//
// Code: packages/engine/src/plans.ts (startPlanRun 537, recordPlanAnswer 560, checkPlanDeadline 582,
// planFallback 627, crewOptIn 696, crewSessionPlan 704; planStep and smallerKind in engine/src/planCore.ts) and
// packages/network/src/network.ts at formal-main (submitPlan 3151, beginPlan 3166, planLane 3178, planProbe 3192,
// planDeadline 3234, planAnswer 3241, planAct 3254, bookPlan 3279, planReveal 3325, planJoin 3340,
// planFallback 3354, planOut 3386, crewCheck 3415, onCrewAnswer 3447, resolveCrew 3457, crewSessions 3477,
// handleDrop 2680, close 2710, dropMember 2756, checkRecipient 4527, bookedNear 3091, planSeatOk 3110,
// onPlanProbeAnswer 2499, applyBlock 1491, callOffPair 1532, the reveal and plan_probe send hooks 4385-4410,
// intro reveal 2578; quorumMet in network/src/transitions.ts:186).
// The model follows the code at the commit that adds this note (branch wave2/plan_run). The other
// "network.ts:<line>" references in this file are lines at that commit (now about 150-260 lines lower);
// the function names above are the anchors. A reference marked "formal-main" is a current line.
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
// The model follows the code after the fixes for SD-008, SD-046, SD-078, SD-144, SD-204, SD-268, SD-423,
// SD-444 (counting), SD-480, Q-plan_run-1 and Q-plan_run-2. Each invariant names its defect id. SD-479 and the
// notice part of SD-444 are skipped (founder decisions): their invariants stay out of `safety` (see below).
// See docs/research/quint-findings/plan_run.md.
module plan_run {

  // ------------------------------------------------------------------------------------------------
  // Constants

  pure val MEMBERS = Set("a", "b", "c", "d", "e")
  pure val INVITED = Set("a", "b", "c", "d")   // a group plan invites up to size.target (3-6), quorum 3
  pure val BENCH0 = ["e"]
  pure val CREW0 = Set("a", "b", "c")
  pure val QUORUM = 3          // DEFAULT_PLANS.quorum.group (engine/src/config.ts:497); a run may also use 4
  pure val GROUP_MIN = 3       // a group plan is 3-6 people (D15, PRD 33.4)
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
    earlyName: bool,            // a reveal named someone before a group of GROUP_MIN yes-sayers was seated
    promised: Set[str],         // heard "Great, thanks. I'll tell you once enough people are in." (network.ts:2347)
    told: Set[str],             // heard how the plan ended for them (reveal, note, event, cancel notice)
    excused: Set[str],          // left on their own or by policy (STOP, minor, watch, block, "can't make it")
    seated: Set[str],           // who was seated at the last booking
    staleRefused: Set[str],     // probe refused only because of a member who is no longer in the run
    lateYesBooked: bool,        // a yes after the probe deadline booked the plan
    fallbackKind: str,          // none | smaller | solo_event | next_week | "" (no fallback ran)
    partnerAsked: Set[str],     // the pair of a group plan that fell to two: a fresh partner plan was submitted
    closedReason: str           // o.closedReason
  }

  type Env = {
    now: int, optedOut: Set[str], watch: Set[str], minors: Set[str], blocks: Set[(str, str)],
    intro: str -> str, minSize: int, quorum: int,
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
  var quorum: int              // plan.quorum: 3 (the default) or 4
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

  /** bookPlan's `tell` (network.ts:3099): the note, never to a minor or a member on watch (SD-480 fixed). */
  pure def noteLeft(e: Env, o: Opp, ids: Set[str]): Opp =
    note(o, ids.filter(id => not(e.minors.contains(id)) and not(e.watch.contains(id))))

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
        // No deadline check here (plans.ts:577-578): the network runs planDeadline before the answer (SD-423).
        if (y.size() >= e.quorum) ({ ...o1, runStage: "booked" }, { kind: "book", member: "", going: y })
        else (o1, NONE)
      }
    } else if (o.runStage == "booked") (o1, NONE)
    else if (e.now < D and o.bench.length() > 0) {
      // nextOnBench without canMatch: the head of the bench.
      val nx = o.bench.head()
      ({ ...o1, bench: o.bench.tail(), answers: a1.put(nx, "pending") }, { kind: "backfill", member: nx, going: Set() })
    }
    else if (pendingOf(a1).size() == 0 and yesOf(a1).size() < e.quorum) ({ ...o1, runStage: "closed" }, { kind: "fallback", member: "", going: Set() })
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
    // A group stays on with 3 or more yes (network.ts:2538, SD-078 fixed).
    val keep = still.size() >= 3
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
                 named: o1.named.union(going.exclude(Set(id)).map(x => (id, x))),
                 earlyName: o1.earlyName or going.size() < GROUP_MIN or going.exists(x => getOr(o.answers, x, "") != "yes") }
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
    val o1 = withStatus(o, going.exclude(keep1), "unavailable")   // plan_conflict
    val seated = keep1.fold(Set(), (acc, id) =>
      if (checkRecipient(e, id, acc.union(Set(id)))._1 == "ok" and not(e.streakBad.contains(id))) acc.union(Set(id)) else acc)
    val o2 = withStatus(o1, keep1.exclude(seated), "unavailable")   // refused at the reveal check
    val left = going.exclude(seated)                               // both kinds are told (SD-480 fixed)
    // A smaller group of 3 or more is booked; a group plan is never booked as a pair (network.ts:3101, SD-008 fixed).
    val enough = seated.size() >= e.quorum or (seated.size() >= GROUP_MIN and e.minSize <= 2)
    if (not(enough)) {
      val o3 = { ...o2, runStage: "closed" }
      if (fromFallback or seated.size() < 2) (closeF(e, noteLeft(e, note(o3, seated), left), "plan did not come together"), "closed")
      // planFallback tells every yes-sayer, the left-out ones too.
      else (o3, "fallback")
    } else {
      val o3 = { ...withStatus(noteLeft(e, o2, left), seated, "yes"), stage: "scheduled", runStage: "booked", seated: seated }
      (seated.fold(o3, (acc, id) => planReveal(e, acc, id)), "booked")
    }
  }

  /** planFallback (network.ts:3109) with engine planFallback (engine/src/plans.ts:640-654). */
  pure def planFallbackF(e: Env, o: Opp): Opp = {
    val o1 = { ...o, runStage: "closed" }
    val yes = yesOf(o1.answers)
    if (yes.size() == 0) closeF(e, { ...o1, fallbackKind: "none" }, "plan did not come together")
    else if (yes.size() >= 2 and e.minSize <= 2 and S - e.now > LATEJOIN) {
      if (yes.size() == 2)
        // Exactly two: the plan closes and a fresh partner plan is submitted for review (network.ts:3160-3168,
        // SD-008 fixed). The two hear "that plan didn't come together" (Q-plan_run-2 fixed).
        { ...note(closeF(e, { ...o1, fallbackKind: "smaller" }, "plan did not come together"), yes), partnerAsked: yes }
      else bookPlanCore(e, { ...o1, fallbackKind: "smaller" }, yes, true)._1
    }
    else if (e.eventExists) {
      val c = closeF(e, { ...o1, fallbackKind: "solo_event" }, "plan did not come together")
      yes.fold(c, (acc, id) => tell(e, acc, id, "planEvent"))
    } else note(closeF(e, { ...o1, fallbackKind: "next_week" }, "plan did not come together"), yes)
  }

  pure def bookPlanMain(e: Env, o: Opp, going: Set[str]): Opp = {
    val r = bookPlanCore(e, o, going, false)
    if (r._2 == "fallback") planFallbackF(e, r._1) else r._1
  }

  /** planJoin (network.ts:3137): a late yes after booking. The reveal goes to the joiner only (SD-479, skipped). */
  pure def planJoin(e: Env, o: Opp, j: str): Opp =
    if (bookedNear(e, j) or checkRecipient(e, j, yesMembers(o))._1 != "ok") withStatus(o, Set(j), "unavailable")
    else planReveal(e, withStatus(o, Set(j), "yes"), j)

  /** planAct (network.ts:3018). Probes for a backfill go out later through the plan lane (the probe action). */
  pure def planAct(e: Env, o: Opp, act: Act): Opp =
    if (act.kind == "book") bookPlanMain(e, o, act.going)
    else if (act.kind == "join") planJoin(e, o, act.member)
    else if (act.kind == "backfill")
      // The alternate joins plan.invited, so the probe copy is built for them (network.ts:3059, SD-204 fixed).
      { ...withStatus(o, Set(act.member), "probing"), invited: o.invited.union(Set(act.member)),
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
      // A yes after the late-join cutoff is out and hears so in the next message (network.ts:3047, Q-plan_run-1 fixed).
      if (getOr(o2.answers, m, "") == "late") note(withStatus(o2, Set(m), "unavailable"), Set(m))
      else planAct(e, o2, r._2)
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
      // Only a member who is going leaves a booked plan (formal-main network.ts:2774): one who said no, is out or
      // still pending for a late join is not in it.
      else if (getOr(o1.status, m, "") == "yes") handleDrop(e, o1, m, false)
      else o1
    }

  /**
   * planProbe (network.ts:2990) once the plan lane lets it go out: seat check, the probe copy
   * (buildPlanProbe returns null for a recipient not in plan.invited, engine/src/plans.ts:488, or when the
   * leak gate drops every frame: copyOk), then send() with about = the participants still in the plan
   * (status not no, unavailable or dropped: network.ts:3019, SD-046 fixed) and the send-time leak guard (leakOk).
   */
  pure def probeF(e: Env, o: Opp, m: str, copyOk: bool, leakOk: bool): Opp =
    if (not(seatOk(e, m))) planAnswerF(e, o, m, false, true)
    else if (not(o.invited.contains(m)) or not(copyOk)) planAnswerF(e, o, m, false, true)   // refuse "plan_copy"
    else {
      val about = o.participants.filter(x => not(Set("no", "unavailable", "dropped").contains(getOr(o.status, x, ""))))
      val chk = checkRecipient(e, m, about)
      if (chk._1 == "ok" and leakOk) {
        val o1 = send(e, o, m, "probe", about)
        { ...o1, contacted: o1.contacted.union(Set(m)), sentAt: o1.sentAt.put(m, e.now) }
      } else {
        val stale = chk._1 == "other" and chk._2.forall(x => not(live(o, x)))
        val o1 = if (stale) { ...o, staleRefused: o.staleRefused.union(Set(m)) } else o
        planOut(e, o1, m)                                                   // onRefused (network.ts:4099)
      }
    }

  /** planDeadline (network.ts:3032): at the probe deadline without quorum, the fallback runs. */
  pure def planDeadlineF(e: Env, o: Opp): Opp =
    if (o.stage == "probing" and o.runStage == "probing" and e.now >= D) planFallbackF(e, { ...o, runStage: "closed" }) else o

  /** advance (network.ts:3400-3420) for the plan: probe silence, the deadline, the meeting is over. */
  pure def tickF(e: Env, o: Opp): Opp = {
    val active = o.runStage != "none" and (o.stage == "probing" or o.stage == "scheduled")
    val o1 = if (not(active)) o else MEMBERS.fold(o, (acc, p) =>
      if (getOr(acc.answers, p, "") == "pending" and acc.sentAt.keys().contains(p) and e.now >= acc.sentAt.get(p) + PROBE_TTL)
        planAnswerF(e, acc, p, false, true)
      else acc)
    val o2 = planDeadlineF(e, o1)
    if (o2.stage == "scheduled" and e.now >= S + 1)
      withStatus({ ...o2, stage: "done" }, pendingOf(o2.answers), "unavailable")
    else o2
  }

  // ------------------------------------------------------------------------------------------------
  // Environment record from the state

  def envOf(streakBad: Set[str], eventExists: bool): Env = {
    now: now, optedOut: optedOut, watch: watch, minors: minors, blocks: blocks, intro: intro, minSize: minSize, quorum: quorum,
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
    named: Set(), earlyName: false, promised: Set(), told: Set(), excused: Set(), seated: Set(), staleRefused: Set(),
    lateYesBooked: false, fallbackKind: "", partnerAsked: Set(), closedReason: ""
  }

  action initWith(ms: int): bool = initQ(ms, QUORUM)
  action initQ(ms: int, q: int): bool = all {
    now' = 0, plan' = OPP0, optedOut' = Set(), watch' = Set(), minors' = Set(), blocks' = Set(), minSize' = ms, quorum' = q,
    intro' = MEMBERS.mapBy(_ => "none"),
    crewStage' = "offered", crewYes' = Set(), crewNo' = Set(), crewMembers' = CREW0, crewTold' = Set(),
    crewSessions' = List(), crewOpps' = Map(), crewOppSlot' = Map(), crewWeek' = 0, crewHandedOff' = false,
    crewEndTold' = false,
  }
  action init = { nondet ms = Set(2, 3).oneOf() nondet q = Set(3, 4).oneOf() initQ(ms, q) }

  action keepEnv = all {
    optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro,
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

  /**
   * The member answers the probe (onPlanProbeAnswer, network.ts:2351); m.awaiting routes it while the opp is
   * open. planDeadline runs first: when it closes the plan, the answer is not counted and gets no ack, and a
   * yes gets the "didn't come together" note (SD-423 fixed).
   */
  action answer(m: str, yes: bool, streakBad: Set[str], eventExists: bool): bool = all {
    plan.contacted.contains(m), getOr(plan.answers, m, "") == "pending",
    plan.stage == "probing" or plan.stage == "scheduled", not(optedOut.contains(m)),
    val e = envOf(streakBad, eventExists)
    val o0 = planDeadlineF(e, plan)
    plan' = if (o0.stage == "closed") (if (yes) note(o0, Set(m)) else o0)
            else planAnswerF(e, if (yes) { ...o0, promised: o0.promised.union(Set(m)) } else o0, m, yes, false),
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
    now' = now, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, keepCrew,
  }

  /** Trust goes to watch (onTrustChange, network.ts:1188): dropMember. */
  action goWatch(m: str): bool = all {
    not(watch.contains(m)),
    val e = { ...env0, watch: watch.union(Set(m)) }
    plan' = dropMember(e, plan, m, false),
    watch' = watch.union(Set(m)),
    now' = now, optedOut' = optedOut, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, keepCrew,
  }

  /** A minor signal (network.ts:721): dropMember with the minors policy. */
  action minorSignal(m: str): bool = all {
    not(minors.contains(m)),
    val e = { ...env0, minors: minors.union(Set(m)) }
    plan' = dropMember(e, plan, m, true),
    minors' = minors.union(Set(m)),
    now' = now, optedOut' = optedOut, watch' = watch, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, keepCrew,
  }

  /** A member blocks another (applyBlock, network.ts:1426): an open opportunity with both is closed. */
  action block(m: str, x: str): bool = all {
    m != x, not(blocks.contains((m, x))),
    val e = { ...env0, blocks: blocks.union(Set((m, x))) }
    // callOffPair (formal-main network.ts:1532-1545) skips an opportunity where either one is already out of it.
    def out(id: str): bool = Set("no", "unavailable", "dropped").contains(getOr(plan.status, id, ""))
    val both = isOpen(plan) and plan.participants.contains(m) and plan.participants.contains(x) and not(out(m)) and not(out(x))
    val o1 = { ...plan, excused: plan.excused.union(Set(m, x)) }
    val o2 = if (both and plan.stage == "scheduled")
      plan.participants.filter(id => id != m and getOr(plan.status, id, "") == "yes" and plan.bookedTold.contains(id))
        .fold(o1, (acc, id) => tell(e, acc, id, "declinedQuiet"))
      else o1
    plan' = if (both) closeF(e, o2, "blocked") else plan,
    blocks' = blocks.union(Set((m, x))),
    now' = now, optedOut' = optedOut, watch' = watch, minors' = minors, minSize' = minSize, quorum' = quorum, intro' = intro, keepCrew,
  }

  /** An intro probe reaches a plan member who is not busy (network.ts:4373-4379: a plan yes is not busy). */
  action introProbe(m: str): bool = all {
    getOr(intro, m, "none") == "none", not(busyInPlan(m)), seatOk(env0, m),
    intro' = intro.set(m, "probing"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, keepCrew,
  }
  /** The member picks the plan's time: evidence() counts only scheduled items as away (network.ts:2285). */
  action introYes(m: str): bool = all {
    getOr(intro, m, "none") == "probing",
    intro' = intro.set(m, "yes"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, keepCrew,
  }
  /**
   * The other side says yes: reveal() (network.ts:2443) books it. A member booked in the plan near that time
   * is left out (bookedNear, refused "booked_elsewhere"): the intro is over for them (SD-268 fixed).
   */
  action introBook(m: str): bool = all {
    getOr(intro, m, "none") == "yes", seatOk(env0, m),
    val clash = plan.stage == "scheduled" and getOr(plan.status, m, "") == "yes"
    intro' = intro.set(m, if (clash) "none" else "booked"),
    now' = now, plan' = plan, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, keepCrew,
  }

  // ------------------------------------------------------------------------------------------------
  // Crew actions

  action keepPlanSide = all { now' = now, plan' = plan, keepEnv }

  // resolveCrew (formal-main network.ts:3457-3470): a yes counts only from a member who may still take a seat
  // (planSeatOk with busyOk: not a minor, not opted out, trust ok); crewOptIn needs CREW_MIN of them, and only
  // they hear crewFormed or crewNotFormed.
  action resolveCrew(yes0: Set[str]): bool = {
    val yes = yes0.filter(id => seatOk(env0, id))
    all {
      crewStage' = if (yes.size() >= CREW_MIN) "formed" else "none",
      crewMembers' = if (yes.size() >= CREW_MIN) crewMembers.intersect(yes) else crewMembers,
      crewTold' = crewTold.union(yes),
    }
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
   * crewSessions (network.ts:3270-3290): no open session for the crew; then the hand-off when 3 sessions took
   * place (stage done: SD-444 counting fixed; still no member hears it, the skipped notice part); then enough
   * seats; then the dedupe on the plan id, which the crew and the slot fix (SD-144 fixed).
   */
  action crewTick = all {
    crewStage == "formed", not(crewHandedOff),
    crewOpps.keys().forall(k => crewOpps.get(k) != "review"),
    val held = crewOpps.keys().filter(k => crewOpps.get(k) == "held").size()
    val slot = crewWeek
    val planId = slot
    val dup = crewSessions.select(pid => pid == planId).length() > 0
    val oppId = 100 + crewSessions.length()
    if (held >= HANDOFF) all {
      crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewHandedOff' = true,
    } else all {
      crewMembers.filter(id => seatOk(env0, id)).size() >= CREW_MIN,
      not(dup),
      crewSessions' = crewSessions.append(planId),
      crewOpps' = crewOpps.put(oppId, "review"),
      crewOppSlot' = crewOppSlot.put(oppId, slot),
      crewHandedOff' = false,
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
      crewAnswer(m, yes), crewTimeout, crewTick, crewSessionEnd(99 + crewSessions.length(), yes), any { crewWeekPass },
    }
  }


  // ------------------------------------------------------------------------------------------------
  // Safety invariants (written from the rules, not from the code)

  /**
   * SD-008 (fixed). A group plan is never booked with fewer than 3 people. Rule: plans are groups of 3-6 (D15,
   * PRD 33.4, engine/src/config.ts resolvePlans), and a group's two yes-sayers "said yes to a group, not to a
   * one-to-one meeting, so the pair is NEVER booked directly" (engine/src/plans.ts:600-606). Before the fix,
   * planFallback booked fallback.members and ignored fallback.partnerPlan, and bookPlan's `enough` accepted 2.
   * Now bookPlan needs 3 (network.ts:3101) and the pair gets the partner plan (network.ts:3160-3170).
   */
  val pairNeverBookedFromGroup: bool =
    (plan.stage == "scheduled" or plan.seated.size() > 0) implies plan.seated.size() >= GROUP_MIN

  /**
   * SD-078 (fixed). A booked group never shrinks to a two-person meeting that nobody agreed to: a scheduled plan
   * always has 3 or more yes. Rule: as above, plus partnerPlanFor's doc "a booking that shrank to two ... becomes
   * a fresh activity-partner plan" (engine plans.ts:612-616). Before the fix handleDrop kept a group of 3+
   * participants on with 2 left; now it keeps it only with 3 or more (network.ts:2538).
   */
  val groupNeverShrinksToPair: bool =
    plan.stage == "scheduled" implies yesMembers(plan).size() >= GROUP_MIN

  /**
   * Names only once enough people are in. Rule: the probe promises "I'll share who's coming once enough people
   * say yes" (engine plans.ts FRAME_COPY); a reveal names only members who said yes to this plan, and only when a
   * group of 3 or more is seated (quorum, or the fallback's smaller group). Checked at each reveal (earlyName),
   * because a member named in a reveal can drop out later. Failed with SD-008 (the pair learned each other's names).
   */
  val noNameBeforeQuorum: bool =
    not(plan.earlyName)

  /**
   * SD-204 (fixed). A backfilled alternate is part of the plan. Rule: Plan.invited is "Members probed (primary group,
   * plus alternates once backfilled)" (engine/src/plans.ts:199). Before the fix planAct's backfill added only
   * to o.participants, buildPlanProbe returned null for the alternate (engine plans.ts:488) and the probe was
   * refused "plan_copy". Now the backfill adds the alternate to plan.invited (network.ts:3059).
   */
  val planInvitedCurrent: bool =
    plan.runStage != "none" implies plan.answers.keys().subseteq(plan.invited)

  /**
   * SD-046 (fixed). A probe is never refused because of a member who has already left the run. Rule: checkRecipient
   * checks "every other person" the message is about (network.ts:4216-4218); a member who said no, went
   * silent or was dropped is no longer someone the plan is about. Before the fix the probe's about was the
   * stale o.plan.invited; now it is the participants whose status is not no, unavailable or dropped
   * (network.ts:3019).
   */
  val noStaleRefusal: bool = plan.staleRefused == Set()

  /**
   * SD-423 (fixed). A yes after the probe deadline never books the plan. Rule: the probe "Expires at the probe
   * deadline" (engine plans.ts:440-443) and "At the probe deadline without quorum: close and fall back"
   * (plans.ts:593). recordPlanAnswer has no deadline check for a yes (plans.ts:577-578). Before the fix only
   * the tick ran checkPlanDeadline; now onPlanProbeAnswer runs planDeadline first (network.ts:2353-2355).
   */
  val noBookAfterDeadline: bool = not(plan.lateYesBooked)

  /**
   * SD-268 (fixed). A member is never booked twice at the same time. Rule: bookPlan "Anyone booked elsewhere within 4
   * hours of the start is left out" (network.ts:3071) and "A member's booked plans count as away when a time
   * is chosen for anything else (plans ask 5)". busy() still skips a plan yes, so an intro can probe the member;
   * the intro reveal now leaves out a member booked near its time (network.ts:2441-2449).
   */
  val noDoubleBooking: bool =
    MEMBERS.forall(m => not(getOr(intro, m, "none") == "booked" and plan.stage == "scheduled" and getOr(plan.status, m, "") == "yes"))

  /**
   * SD-480, Q-plan_run-1 and Q-plan_run-2 (fixed). A yes-sayer always hears how the plan ended. Rule: the ack promises "I'll tell you once enough
   * people are in" (network.ts:2347); planFallback "Yes-sayers hear 'that plan didn't come together'"
   * (network.ts:3106). Exempt: members who left on their own or by policy, and a plan closed for the minors
   * policy or a block (any later message about it is a minor contact or says why, dropMember network.ts:2568-2571,
   * applyBlock network.ts:1437). Fixed paths: bookPlan notes the members it leaves out (plan_conflict and refused
   * seats, not minors or members on watch, network.ts:3097-3110, SD-480); a yes after the late-join cutoff is
   * marked "late" and gets the note (network.ts:3047, Q-plan_run-1); the pair of a group plan that fell to two
   * gets the note with its partner plan (network.ts:3160-3170, Q-plan_run-2).
   */
  val yesSayerTold: bool =
    (plan.stage == "closed" or plan.stage == "done" or plan.stage == "scheduled")
      and plan.closedReason != "minors policy" and plan.closedReason != "blocked" implies
      plan.promised.exclude(plan.excused).exclude(yesMembers(plan)).exclude(pendingOf(plan.answers)).subseteq(plan.told)

  /**
   * SD-479 (SKIPPED: needs a founder decision on member text). Reveals are mutual: in a booked plan, a member
   * who learned another's name is also named to them. Rule: double opt-in and "I'll share who's coming once
   * enough people say yes" to every invitee (FRAME_COPY). Code: planJoin sends planReveal to the joiner only
   * (network.ts:3137-3145). A fix needs new text to the booked members or the removal of late joins (a change to
   * docs/network.md); re-sending the reveal re-emits plan_accepted and resets the 48-hour opt-out. Kept out of
   * `safety` until the founder decides; `sd479LateJoinTest` shows it still fails.
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
   * SD-144 (fixed). One session proposal per crew slot. Rule: the dedupe in crewSessions (network.ts:3230) and "weekly,
   * same time and place, each session opt-in and reviewed like any plan" (network.ts:3214). Code: the dedupe
   * looks up plan ids in a map keyed by opportunity ids, so it never matches.
   */
  val sessionSlotOnce: bool =
    crewSessions.indices().forall(i => crewSessions.indices().forall(j => i == j or crewSessions[i] != crewSessions[j]))

  /**
   * SD-444 counting part (fixed). The crew is handed off after 3 sessions (network.ts:3215 "the Network hands the crew off
   * after 3 sessions"), not after 3 proposals: a failed session does not count.
   */
  val handoffCountsSessions: bool =
    crewHandedOff implies crewOpps.keys().filter(k => crewOpps.get(k) != "failed").size() >= HANDOFF

  /**
   * SD-444 notice part (SKIPPED: needs new member text and a founder decision on what the handoff means in the
   * Network, which has no group chat). crewFormed promises "Your weekly crew is on" (copy.ts:154); when the last
   * session is over after the hand-off, the members hear that the weekly crew ended. Code: only a log line
   * (network.ts:3277). Kept out of `safety`; `crewHandoffTest` shows it still fails.
   */
  val crewEndHeard: bool =
    (crewHandedOff and crewOpps.keys().forall(k => crewOpps.get(k) != "review")) implies crewEndTold

  /** A crew forms only with members who opted in (crewOptIn, founder decision 2026-10-08). */
  val crewOptedIn: bool = crewStage == "formed" implies (crewMembers.subseteq(crewYes) and crewMembers.size() >= CREW_MIN)

  /**
   * A group plan that falls to two yes-sayers becomes a fresh partner plan for the pair (engine plans.ts:600-606,
   * network.ts:3160-3170): the plan is closed, and nobody was seated (SD-008 fixed).
   */
  val partnerPlanNotBooked: bool =
    plan.partnerAsked != Set() implies (plan.stage == "closed" and plan.seated == Set() and plan.partnerAsked.size() == 2)

  val safety: bool = and {
    pairNeverBookedFromGroup, groupNeverShrinksToPair, noNameBeforeQuorum, planInvitedCurrent, noStaleRefusal,
    noBookAfterDeadline, noDoubleBooking, yesSayerTold, noMinorContact, noContactAcrossBlock,
    noContactAfterStop, reviewBeforeContact, sessionSlotOnce, handoffCountsSessions, crewOptedIn, partnerPlanNotBooked,
  }

  // The guards that must hold whatever else changes (minors, blocks, STOP, review, crew opt-in).
  val guards: bool = and { noMinorContact, noContactAcrossBlock, noContactAfterStop, reviewBeforeContact, crewOptedIn }

  // The invariants of the skipped defects (SD-479, SD-444 notice part). They fail today; see their comments.
  val skippedDefects: bool = and { revealSymmetric, crewEndHeard }

  // ------------------------------------------------------------------------------------------------
  // Witnesses (each must be violated: the state is reachable)

  val witness_quorumBooks = not(plan.stage == "scheduled" and plan.seated.size() >= quorum)
  val witness_soloEventCloses = not(plan.stage == "closed" and plan.fallbackKind == "solo_event" and plan.msgs.exists(m => m.kind == "planEvent"))
  val witness_backfill = not(plan.participants.contains("e") and getOr(plan.answers, "e", "") != "")
  val witness_lateJoin = not(plan.stage == "scheduled" and yesMembers(plan).size() > plan.seated.size())
  val witness_stopWhileProbing = not(plan.stage == "probing" and optedOut.size() > 0 and plan.contacted.size() > 0)
  val witness_crewSession = not(crewOpps.keys().exists(k => crewOpps.get(k) == "held"))
  val witness_crewNotFormed = not(crewStage == "none")
  val witness_partnerPlan = not(plan.partnerAsked.size() == 2 and plan.partnerAsked.subseteq(plan.told))
  val witness_crewHandedOff = not(crewHandedOff)
  // A yes-sayer left out at booking (plan_conflict or a refused seat: the answer stays "yes") hears the note.
  val witness_leftOutTold = not(plan.stage == "scheduled" and plan.promised.exists(x =>
    not(plan.seated.contains(x)) and getOr(plan.answers, x, "") == "yes" and getOr(plan.status, x, "") == "unavailable" and plan.told.contains(x)))

  // ------------------------------------------------------------------------------------------------
  // Run tests (concrete traces)

  pure val NOSTREAK: Set[str] = Set()

  /** Quorum 3 books: a, b, c say yes; each learns the other two names; d is still pending. */
  run quorumBooksTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and plan.seated == Set("a", "b", "c") and plan.named.size() == 6 and safety)

  /**
   * SD-008 fixed (register: bouldering, groupSize [2, 6]): two yes, two no, the bench drains. The plan closes,
   * nobody is named, the pair gets a fresh partner plan and hears that the group plan did not come together
   * (Q-plan_run-2 fixed). e is backfilled and probed now (SD-204 fixed); e says no.
   */
  run sd008PairNotBookedTest =
    initWith(2).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true)).then(probe("d", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false))
      .then(answer("c", false, NOSTREAK, false))
      .then(probe("e", true, true))
      .expect(plan.contacted.contains("e") and plan.invited.contains("e"))
      .then(answer("e", false, NOSTREAK, false))
      .then(answer("d", false, NOSTREAK, false))
      .expect(plan.stage == "closed" and plan.seated == Set() and plan.named == Set() and plan.fallbackKind == "smaller"
              and plan.partnerAsked == Set("a", "b") and Set("a", "b").subseteq(plan.told) and safety)

  /** SD-204 fixed: c says no, e is backfilled into plan.invited and gets the probe. */
  run sd204BackfillTest =
    initWith(3).then(approve)
      .then(probe("c", true, true)).then(answer("c", false, NOSTREAK, false))
      .expect(planInvitedCurrent and plan.invited.contains("e"))
      .then(probe("e", true, true))
      .expect(getOr(plan.answers, "e", "") == "pending" and plan.contacted.contains("e") and safety)

  /** SD-078 fixed: a group of 3 is booked; one says "can't make it"; the plan is off for the other two. */
  run sd078ShrinkTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(cantMakeIt("c"))
      .expect(plan.stage == "closed")
      .expect(Set("a", "b").subseteq(plan.told))
      .expect(groupNeverShrinksToPair)
      .expect(yesSayerTold)
      .expect(safety)

  /** SD-046 fixed (register trace): c goes on watch (a silent no); d's probe is no longer about c and goes out. */
  run sd046StaleInvitedTest =
    initWith(3).then(approve)
      .then(probe("a", true, true))
      .then(goWatch("c"))
      .then(probe("d", true, true))
      .expect(plan.contacted.contains("d") and getOr(plan.answers, "d", "") == "pending" and noStaleRefusal and safety)

  /** SD-423 fixed: two yes before the deadline; the third yes after it, before the tick, closes the plan with a note. */
  run sd423LateYesTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false))
      .then(clock).then(clock).then(clock).then(clock)
      .then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "closed" and plan.seated == Set() and plan.told.contains("c") and not(plan.promised.contains("c"))
              and noBookAfterDeadline and safety)

  /**
   * SD-268 fixed: a's plan yes leaves a free for an intro at the same time; the plan books with a; the intro
   * then leaves a out (booked_elsewhere).
   */
  run sd268DoubleBookTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false))
      .then(introProbe("a")).then(introYes("a"))
      .then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(introBook("a"))
      .expect(getOr(intro, "a", "") == "none" and getOr(plan.status, "a", "") == "yes" and noDoubleBooking and safety)

  /**
   * SD-480 fixed (the integration test's trace, quorum 4): a says yes, then is booked in an intro at the plan's
   * time. b, c and d say yes: bookPlan leaves a
   * out (plan_conflict), books b, c and d, and a hears "that plan didn't come together".
   */
  run sd480ConflictToldTest =
    initQ(2, 4).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true)).then(probe("d", true, true))
      .then(answer("a", true, NOSTREAK, false))
      .then(introProbe("a")).then(introYes("a")).then(introBook("a"))
      .then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "probing")
      .then(answer("d", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and plan.seated == Set("b", "c", "d") and getOr(plan.status, "a", "") == "unavailable"
              and plan.told.contains("a") and yesSayerTold and safety)

  /**
   * SD-008 and SD-480: with the old rule the two seated members b, c were booked as a pair. Now a is left out
   * and two are not enough. a's answer is still yes, so the fallback has three yes-sayers: it tries the smaller
   * group of a, b, c again, a is left out again, and the plan closes. All three yes-sayers hear the note.
   */
  run sd480PairLeftTest =
    initWith(2).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false))
      .then(introProbe("a")).then(introYes("a")).then(introBook("a"))
      .then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .expect(plan.stage == "closed" and plan.seated == Set() and Set("a", "b", "c").subseteq(plan.told) and safety)

  /** SD-479 (skipped): a, b, c are booked with d pending; d's late yes joins; d learns a, b, c; they never learn d. */
  run sd479LateJoinTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true)).then(probe("d", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(answer("d", true, NOSTREAK, false))
      .expect(getOr(plan.status, "d", "") == "yes" and plan.named.contains(("d", "a")) and not(plan.named.contains(("a", "d")))
              and not(revealSymmetric) and safety)

  /**
   * Q-plan_run-1 fixed: a, b, c are booked. The plan lane still probes d until the late-join cutoff. d says yes
   * after the cutoff: the answer is "late", d is out (unavailable) and hears the note.
   */
  run qLateYesToldTest =
    initWith(3).then(approve)
      .then(probe("a", true, true)).then(probe("b", true, true)).then(probe("c", true, true))
      .then(answer("a", true, NOSTREAK, false)).then(answer("b", true, NOSTREAK, false)).then(answer("c", true, NOSTREAK, false))
      .then(clock).then(clock).then(clock).then(clock).then(clock).then(clock).then(clock)
      .then(probe("d", true, true))
      .then(clock)
      .then(answer("d", true, NOSTREAK, false))
      .expect(plan.stage == "scheduled" and getOr(plan.answers, "d", "") == "late" and getOr(plan.status, "d", "") == "unavailable"
              and plan.told.contains("d") and yesSayerTold and safety)

  /** SD-144 fixed: a session that fails in review is not proposed again for the same slot. */
  run sd144SlotOnceTest =
    initWith(3)
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick).then(crewSessionEnd(100, false))
      // crewTick is disabled here: slot 0's plan id is already in crew.sessions.
      .expect(crewSessions.select(pid => pid == crewWeek).length() > 0)
      .then(crewWeekPass).then(crewTick)
      .expect(crewSessions == List(0, 1) and sessionSlotOnce and safety)

  /**
   * SD-444 counting fixed: two failed sessions do not count; the hand-off comes after three sessions held. The
   * notice part is skipped: nobody hears that the crew ended (crewEndHeard fails).
   */
  run crewHandoffTest =
    initWith(3)
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick).then(crewSessionEnd(100, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(101, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(102, true))
      .then(crewTick).then(crewSessionEnd(103, true))
      .then(crewTick).then(crewSessionEnd(104, true))
      .expect(not(crewHandedOff) and crewSessions.length() == 5)
      .then(crewTick)
      .expect(crewHandedOff and crewSessions.length() == 5 and handoffCountsSessions and not(crewEndHeard) and safety)
}
