# Group plans and fallback

## Story: Group plans and fallback

A member needs a plan to book only after enough eligible people accept.

### Safety rules and reachability

Check quorum, group size, deadlines, alternatives, and contact eligibility. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/plan_run.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=50000 verify-steps=2
//
// The plan run and the plan fallback (docs/research/2026-11-07-state-machines.md section 6.7: M-045 plan-run,
// M-046 plan-fallback). The crew offer and sessions (M-124) are in quint/plan_crew.qnt: the two machines share
// no state, and Apalache can check each model alone but not the two together.
//
// Code: packages/engine/src/plans.ts (startPlanRun 537, recordPlanAnswer 560, checkPlanDeadline 582,
// planFallback 627; planStep and smallerKind in engine/src/planCore.ts) and packages/network/src/network.ts
// at the merge of formal-main (submitPlan 3154, beginPlan 3169, planLane 3181, planProbe 3195,
// planDeadline 3237, planAnswer 3244, planAct 3257, bookPlan 3282, planReveal 3328, planJoin 3343,
// planFallback 3357, planOut 3389, handleDrop 2680, close 2710, dropMember 2756, checkRecipient 4530,
// bookedNear 3094, planSeatOk 3113, onPlanProbeAnswer 2499, applyBlock 1491, callOffPair 1532, the reveal and
// plan_probe send hooks 4388-4413, intro reveal 2578; quorumMet in network/src/transitions.ts:186).
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
//
// The model is kept small for Apalache (docs/research/quint-findings/plan_run.md section 6):
//  - The maps are total over MEMBERS ("" or -1 is "no entry"). The messages are not kept one by one: the
//    invariants read only whether a message went to a minor, across a block or to an opted-out member, so the
//    model keeps these facts.
//  - bookPlan and planFallback are their own steps (finishBook, finishFallback). The unit that needs them
//    (an answer, a tick, a probe, an actor event) records the request in `todo`, and no other action is
//    enabled until `todo` is empty again. So no other actor runs in between, as in the code (one handler, no
//    await), and each of the two large functions is in the transition relation once. A unit can need both:
//    bookPlan falls back, and planFallback books a smaller group. What the unit does after them (the answer
//    that waited for the deadline step, the silent members of a tick) is in `todo` too. The invariants and
//    witnesses are read only when `todo` is empty (`idle`), that is, between two units.
//  - The tick runs the plan fallback at most once (after the silence fold), as the code does.
//
// The model follows the code after the fixes for SD-008, SD-046, SD-078, SD-204, SD-268, SD-423, SD-480,
// Q-plan_run-1 and Q-plan_run-2 (SD-144 and SD-444 are in quint/plan_crew.qnt). Each invariant names its defect
// id. SD-479 is skipped (a founder decision): its invariant stays out of `safety` (see below).
// See docs/research/quint-findings/plan_run.md.
module plan_run {

  // ------------------------------------------------------------------------------------------------
  // Constants

  pure val MEMBERS = Set("a", "b", "c", "d", "e")
  pure val ORDER = ["a", "b", "c", "d", "e"]
  pure val INVITED = Set("a", "b", "c", "d")   // a group plan invites up to size.target (3-6), quorum 3
  pure val BENCH0 = ["e"]
  pure val QUORUM = 3          // DEFAULT_PLANS.quorum.group (engine/src/config.ts:497); a run may also use 4
  pure val GROUP_MIN = 3       // a group plan is 3-6 people (D15, PRD 33.4)
  pure val D = 4               // plan.probeDeadline
  pure val S = 10              // plan.window.start
  pure val LATEJOIN = 3        // pcfg.lateJoinHours
  pure val CUTOFF = S - LATEJOIN
  pure val PROBE_TTL = 3       // network.ts:440 (26 h)
  pure val MAXT = 13

  // ------------------------------------------------------------------------------------------------
  // Types

  // The plan opportunity (Opp with o.plan and o.planRun) and its ghost fields.
  type Opp = {
    stage: str,                 // review | probing | scheduled | closed | done   (o.stage)
    runStage: str,                   // none | probing | booked | closed               (o.planRun.stage)
    answers: str -> str,        // o.planRun.answers: pending | yes | no | late ("" = not in the run)
    bench: List[str],           // o.planRun.bench
    participants: Set[str],     // o.participants
    alternates: Set[str],       // o.alternates
    invited: Set[str],          // o.plan.invited (set once in beginPlan)
    status: str -> str,         // o.status ("" = no status)
    contacted: Set[str],        // o.contacted
    sentAt: str -> int,         // o.sentAt (-1 = not sent)
    bookedTold: Set[str],       // o.bookedTold
    // ghosts: what the messages did (send() below)
    sent: bool,                 // a message about the plan went out
    minorMsg: bool,             // a message went to a minor, or named one
    blockedMsg: bool,           // a message named a member to someone who blocked them, or whom they blocked
    optedOutMsg: bool,          // a message went to an opted-out member
    eventMsg: bool,             // the solo-event fallback message went out
    // ghosts
    knows: str -> Set[str],     // learner -> the members a reveal named to them
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

  // ------------------------------------------------------------------------------------------------
  // Helpers

  pure def yesOf(a: str -> str): Set[str] = MEMBERS.filter(k => a.get(k) == "yes")
  pure def pendingOf(a: str -> str): Set[str] = MEMBERS.filter(k => a.get(k) == "pending")
  pure def blocked(e: Env, x: str, y: str): bool = e.blocks.contains((x, y)) or e.blocks.contains((y, x))
  pure def withStatus(o: Opp, ids: Set[str], st: str): Opp =
    { ...o, status: MEMBERS.mapBy(k => if (ids.contains(k)) st else o.status.get(k)) }
  pure def setStatus(o: Opp, m: str, st: str): Opp = { ...o, status: o.status.set(m, st) }
  pure def yesMembers(o: Opp): Set[str] = o.participants.filter(p => o.status.get(p) == "yes")
  pure def live(o: Opp, x: str): bool = o.answers.get(x) == "pending" or o.answers.get(x) == "yes"
  pure def isOpen(o: Opp): bool = o.stage == "review" or o.stage == "probing" or o.stage == "scheduled"

  /** planSeatOk (network.ts:2888) with busyOk: an adult, not opted out, trust ok. */
  pure def seatOk(e: Env, m: str): bool =
    not(e.minors.contains(m)) and not(e.optedOut.contains(m)) and not(e.watch.contains(m))


  /** bookedNear (network.ts:2869): booked in another scheduled opportunity near the plan's start. */
  pure def bookedNear(e: Env, m: str): bool = e.intro.get(m) == "booked"

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

  /** A message to `rcpt` about the members in `about`: the model keeps what the invariants read. */
  pure def send(e: Env, o: Opp, rcpt: str, kind: str, about: Set[str]): Opp =
    { ...o, sent: true,
      minorMsg: o.minorMsg or e.minors.contains(rcpt) or about.exists(x => e.minors.contains(x)),
      blockedMsg: o.blockedMsg or about.exists(x => x != rcpt and blocked(e, rcpt, x)),
      optedOutMsg: o.optedOutMsg or e.optedOut.contains(rcpt),
      eventMsg: o.eventMsg or kind == "planEvent" }

  /**
   * An "info" or "cancellation" send to each member in `ids` (no others named): refused only when they opted out.
   * One send() per member that is not opted out; the members are independent, so the order does not matter.
   */
  pure def tellAll(e: Env, o: Opp, ids: Set[str], kind: str): Opp = {
    val r = ids.filter(id => not(e.optedOut.contains(id)))
    { ...o, sent: o.sent or r != Set(), minorMsg: o.minorMsg or r.exists(x => e.minors.contains(x)),
      eventMsg: o.eventMsg or (kind == "planEvent" and r != Set()), told: o.told.union(r) }
  }

  /** noteFor (network.ts:3130): a note folded into the member's next message. Counted as told. */
  pure def note(o: Opp, ids: Set[str]): Opp = { ...o, told: o.told.union(ids) }

  /** bookPlan's `tell` (network.ts:3099): the note, never to a minor or a member on watch (SD-480 fixed). */
  pure def noteLeft(e: Env, o: Opp, ids: Set[str]): Opp =
    note(o, ids.filter(id => not(e.minors.contains(id)) and not(e.watch.contains(id))))

  // ------------------------------------------------------------------------------------------------
  // Engine: recordPlanAnswer (engine/src/plans.ts:568-591), group plans only, and without opts.canMatch
  // (network.ts:3011 passes none).

  pure def recordable(o: Opp, m: str): bool = o.runStage != "closed" and o.answers.get(m) == "pending"

  pure def record(e: Env, o: Opp, m: str, yes: bool): (Opp, Act) = {
    val a1 = o.answers.set(m, if (yes) "yes" else "no")
    val o1 = { ...o, answers: a1 }
    if (yes) {
      if (o.runStage == "booked") {
        if (e.now <= CUTOFF) (o1, { kind: "join", member: m, going: Set() })
        else ({ ...o1, answers: a1.set(m, "late") }, NONE)
      } else {
        val y = yesOf(a1)
        // No deadline check here (plans.ts:577-578): the network runs planDeadline before the answer (SD-423).
        if (y.size() >= e.quorum) ({ ...o1, runStage: "booked" }, { kind: "book", member: "", going: y })
        else (o1, NONE)
      }
    } else recordNo(e, o1)
  }

  /** The no branch of recordPlanAnswer (plans.ts:582-591), after the answer is stored. */
  pure def recordNo(e: Env, o1: Opp): (Opp, Act) =
    if (o1.runStage == "booked") (o1, NONE)
    else if (e.now < D and o1.bench.length() > 0) {
      // nextOnBench without canMatch: the head of the bench.
      val nx = o1.bench.head()
      ({ ...o1, bench: o1.bench.tail(), answers: o1.answers.set(nx, "pending") }, { kind: "backfill", member: nx, going: Set() })
    }
    else if (pendingOf(o1.answers).size() == 0 and yesOf(o1.answers).size() < e.quorum) ({ ...o1, runStage: "closed" }, { kind: "fallback", member: "", going: Set() })
    else (o1, NONE)

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
      else tellAll(e, o1, yesMembers(o1), "declinedQuiet")
    }

  /** handleDrop (network.ts:2512): a booked participant drops out. */
  pure def handleDrop(e: Env, o: Opp, m: str): Opp = {
    val o1 = { ...setStatus(o, m, "dropped"),
               answers: if (o.runStage != "none") o.answers.set(m, "no") else o.answers }
    val still = yesMembers(o1)
    // A group stays on with 3 or more yes (network.ts:2538, SD-078 fixed).
    val keep = still.size() >= 3
    val o2 = tellAll(e, o1, still.intersect(o1.bookedTold), "dropNotice")
    if (keep) o2 else { ...o2, stage: "closed" }
  }

  /** The reveal to `id` once the send-time recipient check passed: the names of everyone going. */
  pure def revealTo(e: Env, o: Opp, id: str, going: Set[str]): Opp = {
    val o1 = send(e, o, id, "reveal", going)
    { ...o1, bookedTold: o1.bookedTold.union(Set(id)), told: o1.told.union(Set(id)),
             knows: o1.knows.set(id, o1.knows.get(id).union(going.exclude(Set(id)))),
             earlyName: o1.earlyName or going.size() < GROUP_MIN or going.exists(x => o.answers.get(x) != "yes") }
  }

  /** planReveal (network.ts:3076) through send(): the reveal hook's valid() and the send-time recipient check. */
  pure def planReveal(e: Env, o: Opp, id: str): Opp =
    if (o.stage != "scheduled" or o.status.get(id) != "yes") o
    else {
      val going = yesMembers(o)
      if (checkRecipient(e, id, going)._1 == "ok") revealTo(e, o, id, going)
      // onRefused: the plan cannot stand without them (network.ts:4087).
      else handleDrop(e, o, id)
    }

  /**
   * bookPlan (network.ts:3041). Returns the opportunity and "booked", "closed" or "fallback" (the caller runs
   * planFallback, which calls this again with fromFallback = true, so there is no recursion).
   */
  pure def bookPlanCore(e: Env, o: Opp, going: Set[str], fromFallback: bool): (Opp, str) = {
    val keep1 = going.filter(id => not(bookedNear(e, id)))
    val o1 = withStatus(o, going.exclude(keep1), "unavailable")   // plan_conflict
    val seated = ORDER.foldl(Set(), (acc, id) =>
      if (keep1.contains(id) and checkRecipient(e, id, acc.union(Set(id)))._1 == "ok" and not(e.streakBad.contains(id))) acc.union(Set(id)) else acc)
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
      // The reveals go out one by one (network.ts:3115). Each seated member passed the recipient check against
      // the members seated before them, and blocks and the minors and watch checks are symmetric, so each
      // reveal passes planReveal's check against the whole group: every seated member hears the names.
      (ORDER.foldl(o3, (acc, id) => if (seated.contains(id)) revealTo(e, acc, id, seated) else acc), "booked")
    }
  }

  /**
   * planFallback (network.ts:3109) with engine planFallback (engine/src/plans.ts:640-654). The smaller group
   * is booked by bookPlan (fromFallback = true): this returns the plan and the members to book, or Set() when
   * the fallback is done.
   */
  pure def planFallbackF(e: Env, o: Opp): (Opp, Set[str]) = {
    val o1 = { ...o, runStage: "closed" }
    val yes = yesOf(o1.answers)
    if (yes.size() == 0) (closeF(e, { ...o1, fallbackKind: "none" }, "plan did not come together"), Set())
    else if (yes.size() >= 2 and e.minSize <= 2 and S - e.now > LATEJOIN) {
      if (yes.size() == 2)
        // Exactly two: the plan closes and a fresh partner plan is submitted for review (network.ts:3160-3168,
        // SD-008 fixed). The two hear "that plan didn't come together" (Q-plan_run-2 fixed).
        ({ ...note(closeF(e, { ...o1, fallbackKind: "smaller" }, "plan did not come together"), yes), partnerAsked: yes }, Set())
      else ({ ...o1, fallbackKind: "smaller" }, yes)
    }
    else if (e.eventExists) {
      val c = closeF(e, { ...o1, fallbackKind: "solo_event" }, "plan did not come together")
      (tellAll(e, c, yes, "planEvent"), Set())
    } else (note(closeF(e, { ...o1, fallbackKind: "next_week" }, "plan did not come together"), yes), Set())
  }

  /** planJoin (network.ts:3137): a late yes after booking. The reveal goes to the joiner only (SD-479, skipped). */
  pure def planJoin(e: Env, o: Opp, j: str): Opp =
    if (bookedNear(e, j) or checkRecipient(e, j, yesMembers(o))._1 != "ok") setStatus(o, j, "unavailable")
    else planReveal(e, setStatus(o, j, "yes"), j)

  /** planAct (network.ts:3018) for a backfill: the probe goes out later through the plan lane (the probe action). */
  pure def backfill(o: Opp, m: str): Opp =
    // The alternate joins plan.invited, so the probe copy is built for them (network.ts:3059, SD-204 fixed).
    { ...setStatus(o, m, "probing"), invited: o.invited.union(Set(m)),
      participants: o.participants.union(Set(m)), alternates: o.alternates.exclude(Set(m)) }

  // ------------------------------------------------------------------------------------------------
  // The result of a unit: the plan, and what must run next in the same unit (`next`: "" | "book" |
  // "fallback"; `going`: the members to book).

  type Res = { o: Opp, next: str, going: Set[str] }
  pure def done(o: Opp): Res = { o: o, next: "", going: Set() }
  pure def thenFallback(o: Opp): Res = { o: o, next: "fallback", going: Set() }

  /**
   * planAnswer (network.ts:3008) for a yes: recordPlanAnswer, then planAct. "book" runs bookPlan (finishBook);
   * a yes after booking joins; a yes after the late-join cutoff is out and hears so in the next message
   * (network.ts:3047, Q-plan_run-1 fixed). A yes never backfills or falls back (recordPlanAnswer).
   */
  pure def planYesF(e: Env, o: Opp, m: str): Res =
    if (not(recordable(o, m))) done(o)
    else {
      val r = record(e, o, m, true)
      val o1 = setStatus(r._1, m, "available")
      val o2 = { ...o1, lateYesBooked: o1.lateYesBooked or (r._2.kind == "book" and e.now >= D) }
      if (o2.answers.get(m) == "late") done(note(setStatus(o2, m, "unavailable"), Set(m)))
      else if (r._2.kind == "book") { o: o2, next: "book", going: r._2.going }
      else if (r._2.kind == "join") done(planJoin(e, o2, m))
      else done(o2)
    }

  /**
   * planAnswer for a no (an answer, a silence, a refused probe, a member who left): recordPlanAnswer, then
   * planAct. A backfill runs here; a fallback is the next step. A no never books or joins.
   */
  pure def planNoF(e: Env, o: Opp, m: str, silent: bool): Res =
    if (not(recordable(o, m))) done(o)
    else {
      val r = recordNo(e, { ...o, answers: o.answers.set(m, "no") })
      val o1 = setStatus(r._1, m, if (silent) "unavailable" else "no")
      if (r._2.kind == "backfill") done(backfill(o1, r._2.member))
      else if (r._2.kind == "fallback") thenFallback(o1)
      else done(o1)
    }

  /** planOut (network.ts:3133). */
  pure def planOut(e: Env, o: Opp, m: str): Res =
    if (o.answers.get(m) == "pending") planNoF(e, o, m, true)
    else if (o.status.get(m) == "available")
      done({ ...setStatus(o, m, "unavailable"), answers: o.answers.set(m, "no") })
    else if (o.status.get(m) == "queued") done(setStatus(o, m, "unavailable"))
    else done(o)

  /** dropMember (network.ts:2564) for the plan opportunity. */
  pure def dropMember(e: Env, o: Opp, m: str, minor: bool): Res =
    if (not(isOpen(o))) done(o)
    else {
      val wasAlternate = minor and o.alternates.contains(m)
      val o1 = { ...o, alternates: o.alternates.exclude(Set(m)), excused: o.excused.union(Set(m)) }
      if (wasAlternate and not(o1.participants.contains(m)) and o1.stage != "scheduled") done(closeF(e, o1, "minors policy"))
      // A minor who was asked and then replaced is still on the roster: the open plan closes (formal-main
      // network.ts:2768-2770).
      else if (minor and o1.contacted.contains(m) and not(o1.participants.contains(m)) and o1.stage != "scheduled") done(closeF(e, o1, "minors policy"))
      else if (not(o1.participants.contains(m))) done(o1)
      else if (minor and o1.stage != "scheduled") done(closeF(e, o1, "minors policy"))
      else if (o1.stage == "review") done(closeF(e, o1, "dropped"))
      else if (o1.stage == "probing") planOut(e, o1, m)
      // Only a member who is going leaves a booked plan (formal-main network.ts:2777): one who said no, is out or
      // still pending for a late join is not in it.
      else if (o1.status.get(m) == "yes") done(handleDrop(e, o1, m))
      else done(o1)
    }

  /**
   * planProbe (network.ts:2990) once the plan lane lets it go out: seat check, the probe copy
   * (buildPlanProbe returns null for a recipient not in plan.invited, engine/src/plans.ts:488, or when the
   * leak gate drops every frame: copyOk), then send() with about = the participants still in the plan
   * (status not no, unavailable or dropped: network.ts:3019, SD-046 fixed) and the send-time leak guard (leakOk).
   */
  pure def probeF(e: Env, o: Opp, m: str, copyOk: bool, leakOk: bool): Res =
    if (not(seatOk(e, m)) or not(o.invited.contains(m)) or not(copyOk)) planNoF(e, o, m, true)   // refuse "plan_copy"
    else {
      val about = o.participants.filter(x => not(Set("no", "unavailable", "dropped").contains(o.status.get(x))))
      val chk = checkRecipient(e, m, about)
      if (chk._1 == "ok" and leakOk) {
        val o1 = send(e, o, m, "probe", about)
        done({ ...o1, contacted: o1.contacted.union(Set(m)), sentAt: o1.sentAt.set(m, e.now) })
      } else {
        val stale = chk._1 == "other" and chk._2.forall(x => not(live(o, x)))
        val o1 = if (stale) { ...o, staleRefused: o.staleRefused.union(Set(m)) } else o
        planOut(e, o1, m)                                                   // onRefused (network.ts:4099)
      }
    }

  /** planDeadline (network.ts:3032): at the probe deadline without quorum, the fallback runs. */
  pure def deadlineDue(e: Env, o: Opp): bool = o.stage == "probing" and o.runStage == "probing" and e.now >= D

  /** A probe that went silent for PROBE_TTL (network.ts:440). */
  pure def silentNow(e: Env, o: Opp, p: str): bool =
    o.answers.get(p) == "pending" and o.sentAt.get(p) >= 0 and e.now >= o.sentAt.get(p) + PROBE_TTL

  /**
   * advance (network.ts:3400-3420) for the plan: probe silence, the deadline, the meeting is over. The silence
   * of each member is a planAnswer no (planNoF). When one of them makes the run fall back, the fold stops and
   * the fallback is the next step. In the code the later members are then not recorded (the run is closed),
   * or, when the fallback booked a smaller group, recorded as no with no other effect: finishBook does that
   * (`todo.late`). Then the deadline step: its fallback is the next step too. The meeting is over at S + 1;
   * a fallback books a smaller group only before S - LATEJOIN, so a tick with a fallback never ends the meeting.
   */
  pure def tickF(e: Env, o: Opp): (Res, bool) = {
    val active = o.runStage != "none" and (o.stage == "probing" or o.stage == "scheduled")
    val r = if (not(active)) done(o) else ORDER.foldl(done(o), (acc, p) =>
      if (acc.next == "" and silentNow(e, acc.o, p)) planNoF(e, acc.o, p, true) else acc)
    if (r.next != "") (r, true)
    else if (deadlineDue(e, r.o)) (thenFallback({ ...r.o, runStage: "closed" }), false)
    else if (r.o.stage == "scheduled" and e.now >= S + 1)
      (done(withStatus({ ...r.o, stage: "done" }, pendingOf(r.o.answers), "unavailable")), false)
    else (r, false)
  }

  /** The members that went silent and are recorded as no after a fallback booked a smaller group in a tick. */
  pure def lateSilence(e: Env, o: Opp): Opp = {
    val late = MEMBERS.filter(p => silentNow(e, o, p))
    { ...withStatus(o, late, "unavailable"), answers: MEMBERS.mapBy(p => if (late.contains(p)) "no" else o.answers.get(p)) }
  }

  /**
   * The rest of an answer that waited for the deadline step (onPlanProbeAnswer, network.ts:2353-2355): when the
   * plan closed, the answer is not counted and gets no ack, and a yes gets the "didn't come together" note
   * (SD-423 fixed). When the fallback booked a smaller group, the answer is recorded on the booked run (a yes
   * joins, a no has no other effect).
   */
  pure def afterDeadline(e: Env, o: Opp, m: str, yes: bool): Opp =
    if (o.stage == "closed") (if (yes) note(o, Set(m)) else o)
    else if (yes) planYesF(e, { ...o, promised: o.promised.union(Set(m)) }, m).o
    else planNoF(e, o, m, false).o

  // ------------------------------------------------------------------------------------------------
  // Environment record from the state

  def envOf(streakBad: Set[str], eventExists: bool): Env = {
    now: now, optedOut: optedOut, watch: watch, minors: minors, blocks: blocks, intro: intro, minSize: minSize, quorum: quorum,
    streakBad: streakBad, eventExists: eventExists
  }
  def env0: Env = envOf(Set(), false)

  /** busy (network.ts:4373) for the plan opportunity only. */
  def busyInPlan(m: str): bool = {
    val st = plan.status.get(m)
    isOpen(plan) and plan.participants.contains(m) and not(Set("unavailable", "no", "dropped").contains(st))
      and not(plan.stage == "probing" and st == "available")
  }
  /** busy() for the intro: an open intro (probing, or booked and not yet held) makes the plan probe wait. */
  def introBusy(m: str): bool = intro.get(m) != "none"

  // ------------------------------------------------------------------------------------------------
  // Init

  pure val OPP0: Opp = {
    stage: "review", runStage: "none", answers: MEMBERS.mapBy(_ => ""), bench: BENCH0, participants: INVITED,
    alternates: Set("e"), invited: Set(), status: MEMBERS.mapBy(_ => ""), contacted: Set(), sentAt: MEMBERS.mapBy(_ => -1),
    bookedTold: Set(), sent: false, minorMsg: false, blockedMsg: false, optedOutMsg: false, eventMsg: false,
    knows: MEMBERS.mapBy(_ => Set()), earlyName: false, promised: Set(), told: Set(), excused: Set(), seated: Set(),
    staleRefused: Set(), lateYesBooked: false, fallbackKind: "", partnerAsked: Set(), closedReason: ""
  }

  /**
   * The rest of the current unit: "" (none: the model is between two units), "book" (bookPlan for `going`,
   * from the fallback or not) or "fallback" (planFallback). `late`: a tick fell back, so the silent members
   * are recorded after a smaller booking. `ansM`, `ansYes`: an answer that waits for the deadline step. The
   * oracles of the unit are kept for the steps that finish it.
   */
  type Todo = {
    kind: str, going: Set[str], fromFallback: bool, late: bool, ansM: str, ansYes: bool,
    streakBad: Set[str], eventExists: bool
  }
  pure val IDLE: Todo = {
    kind: "", going: Set(), fromFallback: false, late: false, ansM: "", ansYes: false, streakBad: Set(), eventExists: false
  }
  var todo: Todo
  val idle: bool = todo.kind == ""

  /** The todo for a unit result: nothing, bookPlan or planFallback next, with the unit's oracles. */
  pure def todoOf(r: Res, streakBad: Set[str], eventExists: bool): Todo =
    if (r.next == "") IDLE
    else { ...IDLE, kind: r.next, going: r.going, streakBad: streakBad, eventExists: eventExists }

  // Checkpoints: states that the plan run reaches from the initial state. The run tests `cpTwoYesTest` and
  // `cpBookedTest` replay the actions that reach them and compare the whole state. `init` may also start at a
  // checkpoint, so that bounded model checking (verify-steps) reaches the booking, the fallback and the
  // deadline from there (docs/research/quint-findings/plan_run.md section 6). The initial state stays one of
  // the choices, so every trace of the model from the initial state is still a trace of `init`.

  /** a, b, c and d got the probe at hour 0; a and b said yes (any quorum and group size). */
  pure val CP_TWO_YES: Opp = { ...OPP0,
    stage: "probing", runStage: "probing", invited: INVITED, contacted: INVITED, sent: true, promised: Set("a", "b"),
    answers: Map("a" -> "yes", "b" -> "yes", "c" -> "pending", "d" -> "pending", "e" -> ""),
    status: Map("a" -> "available", "b" -> "available", "c" -> "probing", "d" -> "probing", "e" -> ""),
    sentAt: Map("a" -> 0, "b" -> 0, "c" -> 0, "d" -> 0, "e" -> -1) }

  /** Then c said yes: quorum 3 books a, b and c, and each hears the other two names; d is still pending. */
  pure val CP_BOOKED: Opp = { ...CP_TWO_YES,
    stage: "scheduled", runStage: "booked", promised: Set("a", "b", "c"), seated: Set("a", "b", "c"),
    bookedTold: Set("a", "b", "c"), told: Set("a", "b", "c"),
    answers: Map("a" -> "yes", "b" -> "yes", "c" -> "yes", "d" -> "pending", "e" -> ""),
    status: Map("a" -> "yes", "b" -> "yes", "c" -> "yes", "d" -> "probing", "e" -> ""),
    knows: Map("a" -> Set("b", "c"), "b" -> Set("a", "c"), "c" -> Set("a", "b"), "d" -> Set(), "e" -> Set()) }

  // Ghost: the trace started at the initial state. The witnesses ask for it, so that a witness state is
  // reached by the actions of the model and not given by a checkpoint.
  var fromStart: bool

  /** Start at checkpoint cp: 0 the initial state, 1 CP_TWO_YES, 2 CP_BOOKED (quorum 3), 3 CP_TWO_YES at the deadline. */
  action initAt(ms: int, q: int, cp: int): bool = all {
    now' = if (cp == 3) D else 0,
    plan' = if (cp == 0) OPP0 else if (cp == 2) CP_BOOKED else CP_TWO_YES,
    optedOut' = Set(), watch' = Set(), minors' = Set(), blocks' = Set(), minSize' = ms,
    quorum' = if (cp == 2) QUORUM else q,
    intro' = MEMBERS.mapBy(_ => "none"), todo' = IDLE, fromStart' = cp == 0,
  }
  action initWith(ms: int): bool = initQ(ms, QUORUM)
  action initQ(ms: int, q: int): bool = initAt(ms, q, 0)
  action init = {
    nondet ms = Set(2, 3).oneOf()
    nondet q = Set(3, 4).oneOf()
    nondet cp = 0.to(3).oneOf()
    initAt(ms, q, cp)
  }

  action keepEnv = all {
    fromStart' = fromStart, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro,
  }

  // ------------------------------------------------------------------------------------------------
  // Plan actions

  /** A reviewer approves the plan: beginPlan (network.ts:2940) with engine startPlanRun. */
  action approve = all {
    idle, plan.stage == "review",
    plan' = { ...withStatus(plan, plan.participants, "probing"),
              stage: "probing", runStage: "probing", invited: plan.participants,
              answers: MEMBERS.mapBy(k => if (plan.participants.contains(k)) "pending" else ""), bench: BENCH0 },
    now' = now, todo' = IDLE, keepEnv,
  }

  /** A reviewer rejects, or the review SLA passes (network.ts:3344-3350). */
  action reject = all {
    idle, plan.stage == "review",
    plan' = closeF(env0, plan, "review expired"),
    now' = now, todo' = IDLE, keepEnv,
  }

  /** The plan lane sends a pending member's probe (send window, one a day and allowance are deferrals). */
  action probe(m: str, copyOk: bool, leakOk: bool): bool = all {
    idle,
    // advance() runs the deadline check before planLane (network.ts:3365-3369), so no probe goes out at or
    // after the deadline while probing; after booking, probes go out until the late-join cutoff (network.ts:2954).
    (plan.stage == "probing" and now < D) or (plan.stage == "scheduled" and now <= CUTOFF),
    plan.answers.get(m) == "pending", not(plan.contacted.contains(m)), not(introBusy(m)),
    val r = probeF(env0, plan, m, copyOk, leakOk)
    all { plan' = r.o, todo' = todoOf(r, Set(), false) },
    now' = now, keepEnv,
  }

  /**
   * The member answers the probe (onPlanProbeAnswer, network.ts:2351); m.awaiting routes it while the opp is
   * open. planDeadline runs first (SD-423 fixed): when it is due, its fallback is the next step and the
   * answer waits in `todo` (afterDeadline).
   */
  action answer(m: str, yes: bool, streakBad: Set[str], eventExists: bool): bool = all {
    idle,
    plan.contacted.contains(m), plan.answers.get(m) == "pending",
    plan.stage == "probing" or plan.stage == "scheduled", not(optedOut.contains(m)),
    val e = envOf(streakBad, eventExists)
    if (deadlineDue(e, plan)) all {
      plan' = { ...plan, runStage: "closed" },
      todo' = { ...IDLE, kind: "fallback", ansM: m, ansYes: yes, streakBad: streakBad, eventExists: eventExists },
    } else {
      val r = if (yes) planYesF(e, { ...plan, promised: plan.promised.union(Set(m)) }, m) else planNoF(e, plan, m, false)
      all { plan' = r.o, todo' = todoOf(r, streakBad, eventExists) }
    },
    now' = now, keepEnv,
  }

  /** A booked member says they can't make it (handleDrop with ack, network.ts:2512). */
  action cantMakeIt(m: str): bool = all {
    idle, plan.stage == "scheduled", plan.status.get(m) == "yes", not(optedOut.contains(m)),
    plan' = handleDrop(env0, { ...plan, excused: plan.excused.union(Set(m)) }, m),
    now' = now, todo' = IDLE, keepEnv,
  }

  /** The service tick: advance() for the plan. */
  action tick(streakBad: Set[str], eventExists: bool): bool = all {
    idle,
    val r = tickF(envOf(streakBad, eventExists), plan)
    all { plan' = r._1.o, todo' = { ...todoOf(r._1, streakBad, eventExists), late: r._2 } },
    now' = now, keepEnv,
  }

  action clock = all { idle, now < MAXT, now' = now + 1, plan' = plan, todo' = IDLE, keepEnv }

  /**
   * bookPlan (network.ts:3041), the next step of a unit that books. When the main booking falls back, the
   * fallback is the next step. When a smaller group is booked in a tick, the silent members are recorded
   * (lateSilence). Then the answer that waited for the deadline step, if any, runs.
   */
  action finishBook = all {
    todo.kind == "book",
    val e = envOf(todo.streakBad, todo.eventExists)
    val r = bookPlanCore(e, plan, todo.going, todo.fromFallback)
    if (r._2 == "fallback") all { plan' = r._1, todo' = { ...todo, kind: "fallback", going: Set(), fromFallback: false } }
    else {
      val o1 = if (todo.late and r._1.runStage == "booked") lateSilence(e, r._1) else r._1
      all { plan' = if (todo.ansM != "") afterDeadline(e, o1, todo.ansM, todo.ansYes) else o1, todo' = IDLE }
    },
    now' = now, keepEnv,
  }

  /** planFallback (network.ts:3109), the next step of a unit that falls back. */
  action finishFallback = all {
    todo.kind == "fallback",
    val e = envOf(todo.streakBad, todo.eventExists)
    val r = planFallbackF(e, plan)
    if (r._2 != Set()) all { plan' = r._1, todo' = { ...todo, kind: "book", going: r._2, fromFallback: true } }
    else all { plan' = if (todo.ansM != "") afterDeadline(e, r._1, todo.ansM, todo.ansYes) else r._1, todo' = IDLE },
    now' = now, keepEnv,
  }

  // ------------------------------------------------------------------------------------------------
  // Other actors

  /** STOP (network.ts:675): opted out, then dropMember. */
  action stop(m: str): bool = all {
    idle, not(optedOut.contains(m)),
    val e = { ...env0, optedOut: optedOut.union(Set(m)) }
    val r = dropMember(e, plan, m, false)
    all { plan' = r.o, todo' = todoOf(r, Set(), false) },
    optedOut' = optedOut.union(Set(m)),
    now' = now, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, fromStart' = fromStart,
  }

  /** Trust goes to watch (onTrustChange, network.ts:1188): dropMember. */
  action goWatch(m: str): bool = all {
    idle, not(watch.contains(m)),
    val e = { ...env0, watch: watch.union(Set(m)) }
    val r = dropMember(e, plan, m, false)
    all { plan' = r.o, todo' = todoOf(r, Set(), false) },
    watch' = watch.union(Set(m)),
    now' = now, optedOut' = optedOut, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, fromStart' = fromStart,
  }

  /** A minor signal (network.ts:721): dropMember with the minors policy. */
  action minorSignal(m: str): bool = all {
    idle, not(minors.contains(m)),
    val e = { ...env0, minors: minors.union(Set(m)) }
    val r = dropMember(e, plan, m, true)
    all { plan' = r.o, todo' = todoOf(r, Set(), false) },
    minors' = minors.union(Set(m)),
    now' = now, optedOut' = optedOut, watch' = watch, blocks' = blocks, minSize' = minSize, quorum' = quorum, intro' = intro, fromStart' = fromStart,
  }

  /** A member blocks another (applyBlock, network.ts:1426): an open opportunity with both is closed. */
  action block(m: str, x: str): bool = all {
    idle, m != x, not(blocks.contains((m, x))),
    val e = { ...env0, blocks: blocks.union(Set((m, x))) }
    // callOffPair (formal-main network.ts:1532-1545) skips an opportunity where either one is already out of it.
    def out(id: str): bool = Set("no", "unavailable", "dropped").contains(plan.status.get(id))
    val both = isOpen(plan) and plan.participants.contains(m) and plan.participants.contains(x) and not(out(m)) and not(out(x))
    val o1 = { ...plan, excused: plan.excused.union(Set(m, x)) }
    val o2 = if (both and plan.stage == "scheduled")
      tellAll(e, o1, plan.participants.filter(id => id != m and plan.status.get(id) == "yes" and plan.bookedTold.contains(id)), "declinedQuiet")
      else o1
    plan' = if (both) closeF(e, o2, "blocked") else plan,
    blocks' = blocks.union(Set((m, x))),
    now' = now, todo' = IDLE, optedOut' = optedOut, watch' = watch, minors' = minors, minSize' = minSize, quorum' = quorum, intro' = intro, fromStart' = fromStart,
  }

  /** An intro probe reaches a plan member who is not busy (network.ts:4373-4379: a plan yes is not busy). */
  action introProbe(m: str): bool = all {
    idle, intro.get(m) == "none", not(busyInPlan(m)), seatOk(env0, m),
    intro' = intro.set(m, "probing"),
    now' = now, plan' = plan, todo' = IDLE, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, fromStart' = fromStart,
  }
  /** The member picks the plan's time: evidence() counts only scheduled items as away (network.ts:2285). */
  action introYes(m: str): bool = all {
    idle, intro.get(m) == "probing",
    intro' = intro.set(m, "yes"),
    now' = now, plan' = plan, todo' = IDLE, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, fromStart' = fromStart,
  }
  /**
   * The other side says yes: reveal() (network.ts:2443) books it. A member booked in the plan near that time
   * is left out (bookedNear, refused "booked_elsewhere"): the intro is over for them (SD-268 fixed).
   */
  action introBook(m: str): bool = all {
    idle, intro.get(m) == "yes", seatOk(env0, m),
    val clash = plan.stage == "scheduled" and plan.status.get(m) == "yes"
    intro' = intro.set(m, if (clash) "none" else "booked"),
    now' = now, plan' = plan, todo' = IDLE, optedOut' = optedOut, watch' = watch, minors' = minors, blocks' = blocks, minSize' = minSize, quorum' = quorum, fromStart' = fromStart,
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
    // The branch weights: plan steps are more frequent than actor events, so that random traces reach booking
    // before time runs out. A weight is the number of `pick` values that enable a branch (the simulator draws
    // the nondet values again when the step is disabled), not copies of the action, so that Apalache sees each
    // action once. The steps that finish a unit have no weight: they are the only enabled steps until the
    // unit is done.
    nondet pick = 0.to(11).oneOf()
    val yes = yesR > 0
    val streakBad = if (streakR == 0) Set(m) else Set()
    any {
      finishBook, finishFallback,
      all { pick == 0, approve },
      all { pick == 1, reject },
      all { pick >= 2, pick <= 4, probe(m, okR != 1, okR != 2) },
      all { pick >= 5, pick <= 7, answer(m, yes, streakBad, eventExists) },
      all { pick == 8, tick(streakBad, eventExists) },
      all { pick == 9, clock },
      // Actor events are rarer than plan steps: one branch picks one of them.
      all { pick == 10, any { stop(m), goWatch(m), minorSignal(m), block(m, x), cantMakeIt(m) } },
      all { pick == 11, any { introProbe(m), introYes(m), introBook(m) } },
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
    plan.runStage != "none" implies MEMBERS.forall(k => plan.answers.get(k) != "" implies plan.invited.contains(k))

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
    MEMBERS.forall(m => not(intro.get(m) == "booked" and plan.stage == "scheduled" and plan.status.get(m) == "yes"))

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
    plan.stage == "scheduled" implies MEMBERS.forall(l => plan.knows.get(l).forall(x =>
      not(plan.status.get(l) == "yes" and plan.status.get(x) == "yes") or plan.knows.get(x).contains(l)))

  /** Minors (13-17) are never matched or connected (AGENTS.md age policy, core/src/policy.ts). */
  val noMinorContact: bool =
    not(plan.minorMsg) and (plan.stage == "scheduled" implies yesMembers(plan).forall(id => not(minors.contains(id))))

  /** A block between two members stops every message about one to the other (checkRecipient, AGENTS.md). */
  val noContactAcrossBlock: bool = not(plan.blockedMsg)

  /** STOP stops every app (AGENTS.md platform decision 7): no message to an opted-out member. */
  val noContactAfterStop: bool = not(plan.optedOutMsg)

  /** Every proactive proposal goes through human review first (AGENTS.md code invariants). */
  val reviewBeforeContact: bool = plan.runStage == "none" implies not(plan.sent)

  /**
   * A group plan that falls to two yes-sayers becomes a fresh partner plan for the pair (engine plans.ts:600-606,
   * network.ts:3160-3170): the plan is closed, and nobody was seated (SD-008 fixed).
   */
  val partnerPlanNotBooked: bool =
    plan.partnerAsked != Set() implies (plan.stage == "closed" and plan.seated == Set() and plan.partnerAsked.size() == 2)

  // The invariants hold between two units (`idle`); inside a unit, bookPlan or planFallback is still to run.
  val safety: bool = idle implies and {
    pairNeverBookedFromGroup, groupNeverShrinksToPair, noNameBeforeQuorum, planInvitedCurrent, noStaleRefusal,
    noBookAfterDeadline, noDoubleBooking, yesSayerTold, noMinorContact, noContactAcrossBlock,
    noContactAfterStop, reviewBeforeContact, partnerPlanNotBooked,
  }

  // The guards that must hold whatever else changes (minors, blocks, STOP, review).
  val guards: bool = idle implies and { noMinorContact, noContactAcrossBlock, noContactAfterStop, reviewBeforeContact }

  // The invariant of the skipped defect SD-479. It fails today; see its comment. (The SD-444 notice part is
  // in quint/plan_crew.qnt.)
  val skippedDefects: bool = idle implies revealSymmetric

  // ------------------------------------------------------------------------------------------------
  // Witnesses (each must be violated: the state is reachable between two units, from the initial state)

  val witness_quorumBooks = not(fromStart and idle and (plan.stage == "scheduled" and plan.seated.size() >= quorum))
  val witness_soloEventCloses = not(fromStart and idle and (plan.stage == "closed" and plan.fallbackKind == "solo_event" and plan.eventMsg))
  val witness_backfill = not(fromStart and idle and (plan.participants.contains("e") and plan.answers.get("e") != ""))
  val witness_lateJoin = not(fromStart and idle and (plan.stage == "scheduled" and yesMembers(plan).size() > plan.seated.size()))
  val witness_stopWhileProbing = not(fromStart and idle and (plan.stage == "probing" and optedOut.size() > 0 and plan.contacted.size() > 0))
  val witness_partnerPlan = not(fromStart and idle and (plan.partnerAsked.size() == 2 and plan.partnerAsked.subseteq(plan.told)))
  // A yes-sayer left out at booking (plan_conflict or a refused seat: the answer stays "yes") hears the note.
  val witness_leftOutTold = not(fromStart and idle and (plan.stage == "scheduled" and plan.promised.exists(x =>
    not(plan.seated.contains(x)) and plan.answers.get(x) == "yes" and plan.status.get(x) == "unavailable" and plan.told.contains(x))))

  // ------------------------------------------------------------------------------------------------
  // Run tests (concrete traces)

  pure val NOSTREAK: Set[str] = Set()

  /** One step that finishes the current unit, or nothing between two units. */
  action settle = any {
    all { idle, plan' = plan, todo' = todo, now' = now, keepEnv },
    finishBook, finishFallback,
  }
  /** A unit and the steps that finish it (at most three: bookPlan, planFallback, bookPlan). */
  action ans(m: str, yes: bool): bool = answer(m, yes, NOSTREAK, false).then(settle).then(settle).then(settle)
  action prb(m: str): bool = probe(m, true, true).then(settle).then(settle)

  /** Quorum 3 books: a, b, c say yes; each learns the other two names; d is still pending. */
  run quorumBooksTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true)).then(ans("b", true)).then(ans("c", true))
      .expect(plan.stage == "scheduled" and plan.seated == Set("a", "b", "c") and plan.knows.get("a") == Set("b", "c")
              and plan.knows.get("b") == Set("a", "c") and plan.knows.get("c") == Set("a", "b") and safety)

  /**
   * SD-008 fixed (register: bouldering, groupSize [2, 6]): two yes, two no, the bench drains. The plan closes,
   * nobody is named, the pair gets a fresh partner plan and hears that the group plan did not come together
   * (Q-plan_run-2 fixed). e is backfilled and probed now (SD-204 fixed); e says no.
   */
  run sd008PairNotBookedTest =
    initWith(2).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true)).then(ans("b", true))
      .then(ans("c", false))
      .then(prb("e"))
      .expect(plan.contacted.contains("e") and plan.invited.contains("e"))
      .then(ans("e", false))
      .then(ans("d", false))
      .expect(plan.stage == "closed" and plan.seated == Set() and MEMBERS.forall(l => plan.knows.get(l) == Set()) and plan.fallbackKind == "smaller"
              and plan.partnerAsked == Set("a", "b") and Set("a", "b").subseteq(plan.told) and safety)

  /** SD-204 fixed: c says no, e is backfilled into plan.invited and gets the probe. */
  run sd204BackfillTest =
    initWith(3).then(approve)
      .then(prb("c")).then(ans("c", false))
      .expect(planInvitedCurrent and plan.invited.contains("e"))
      .then(prb("e"))
      .expect(plan.answers.get("e") == "pending" and plan.contacted.contains("e") and safety)

  /** SD-078 fixed: a group of 3 is booked; one says "can't make it"; the plan is off for the other two. */
  run sd078ShrinkTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true)).then(ans("b", true)).then(ans("c", true))
      .then(cantMakeIt("c"))
      .expect(plan.stage == "closed")
      .expect(Set("a", "b").subseteq(plan.told))
      .expect(groupNeverShrinksToPair)
      .expect(yesSayerTold)
      .expect(safety)

  /** SD-046 fixed (register trace): c goes on watch (a silent no); d's probe is no longer about c and goes out. */
  run sd046StaleInvitedTest =
    initWith(3).then(approve)
      .then(prb("a"))
      .then(goWatch("c"))
      .then(prb("d"))
      .expect(plan.contacted.contains("d") and plan.answers.get("d") == "pending" and noStaleRefusal and safety)

  /** SD-423 fixed: two yes before the deadline; the third yes after it, before the tick, closes the plan with a note. */
  run sd423LateYesTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true)).then(ans("b", true))
      .then(clock).then(clock).then(clock).then(clock)
      .then(ans("c", true))
      .expect(plan.stage == "closed" and plan.seated == Set() and plan.told.contains("c") and not(plan.promised.contains("c"))
              and noBookAfterDeadline and safety)

  /**
   * SD-268 fixed: a's plan yes leaves a free for an intro at the same time; the plan books with a; the intro
   * then leaves a out (booked_elsewhere).
   */
  run sd268DoubleBookTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true))
      .then(introProbe("a")).then(introYes("a"))
      .then(ans("b", true)).then(ans("c", true))
      .then(introBook("a"))
      .expect(intro.get("a") == "none" and plan.status.get("a") == "yes" and noDoubleBooking and safety)

  /**
   * SD-480 fixed (the integration test's trace, quorum 4): a says yes, then is booked in an intro at the plan's
   * time. b, c and d say yes: bookPlan leaves a
   * out (plan_conflict), books b, c and d, and a hears "that plan didn't come together".
   */
  run sd480ConflictToldTest =
    initQ(2, 4).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true))
      .then(introProbe("a")).then(introYes("a")).then(introBook("a"))
      .then(ans("b", true)).then(ans("c", true))
      .expect(plan.stage == "probing")
      .then(ans("d", true))
      .expect(plan.stage == "scheduled" and plan.seated == Set("b", "c", "d") and plan.status.get("a") == "unavailable"
              and plan.told.contains("a") and yesSayerTold and safety)

  /**
   * SD-008 and SD-480: with the old rule the two seated members b, c were booked as a pair. Now a is left out
   * and two are not enough. a's answer is still yes, so the fallback has three yes-sayers: it tries the smaller
   * group of a, b, c again, a is left out again, and the plan closes. All three yes-sayers hear the note.
   */
  run sd480PairLeftTest =
    initWith(2).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true))
      .then(introProbe("a")).then(introYes("a")).then(introBook("a"))
      .then(ans("b", true)).then(ans("c", true))
      .expect(plan.stage == "closed" and plan.seated == Set() and Set("a", "b", "c").subseteq(plan.told) and safety)

  /** SD-479 (skipped): a, b, c are booked with d pending; d's late yes joins; d learns a, b, c; they never learn d. */
  run sd479LateJoinTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true)).then(ans("b", true)).then(ans("c", true))
      .then(ans("d", true))
      .expect(plan.status.get("d") == "yes" and plan.knows.get("d").contains("a") and not(plan.knows.get("a").contains("d"))
              and not(revealSymmetric) and safety)

  /**
   * Q-plan_run-1 fixed: a, b, c are booked. The plan lane still probes d until the late-join cutoff. d says yes
   * after the cutoff: the answer is "late", d is out (unavailable) and hears the note.
   */
  run qLateYesToldTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c"))
      .then(ans("a", true)).then(ans("b", true)).then(ans("c", true))
      .then(clock).then(clock).then(clock).then(clock).then(clock).then(clock).then(clock)
      .then(prb("d"))
      .then(clock)
      .then(ans("d", true))
      .expect(plan.stage == "scheduled" and plan.answers.get("d") == "late" and plan.status.get("d") == "unavailable"
              and plan.told.contains("d") and yesSayerTold and safety)

  /**
   * The tick: b and c stay silent past the probe silence, after a said yes and d said no (the bench is used up
   * by e's no). The silence of b is the last missing answer only after c's, so the fallback runs once, in the
   * same tick, and the one yes-sayer hears the note.
   */
  run silenceFallbackTest =
    initWith(3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true)).then(ans("d", false))
      .then(prb("e")).then(ans("e", false))
      .then(clock).then(clock).then(clock)
      .then(tick(NOSTREAK, false)).then(settle)
      .expect(plan.stage == "closed" and plan.fallbackKind == "next_week" and plan.answers.get("b") == "no"
              and plan.answers.get("c") == "no" and plan.told == Set("a") and safety)

  /** The checkpoints are reachable: the actions reach them from the initial state (quorum 3 and 4). */
  run cpTwoYesTest =
    initQ(3, 4).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true)).then(ans("b", true))
      .expect(plan == CP_TWO_YES and now == 0 and safety)
      .then(clock).then(clock).then(clock).then(clock)
      .expect(plan == CP_TWO_YES and now == D)

  run cpBookedTest =
    initQ(2, 3).then(approve)
      .then(prb("a")).then(prb("b")).then(prb("c")).then(prb("d"))
      .then(ans("a", true)).then(ans("b", true))
      .expect(plan == CP_TWO_YES)
      .then(ans("c", true))
      .expect(plan == CP_BOOKED and now == 0 and safety)
}
```
