// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=10000 verify-steps=12
//
// The crew offer and the crew sessions (docs/research/2026-11-07-state-machines.md section 6.7: M-124
// crew-offer-and-crew). This machine was part of quint/plan_run.qnt. It is a model of its own so that Apalache
// can check it (docs/research/quint-findings/plan_run.md section 6). The crew machine shares no state with the
// plan run: it reads only STOP, the trust watch and the minors policy (planSeatOk) and the clock. Those are
// actor events here too, so this model has every crew trace of the old combined model.
//
// Code: packages/engine/src/plans.ts (crewOptIn, crewSessionPlan) and packages/network/src/network.ts
// (crewCheck 3212, onCrewAnswer 3242, resolveCrew 3252, crewSessions 3270). The model follows the code at the
// same commit as quint/plan_run.qnt (branch wave2/plan_run).
//
// Abstractions: one crew offer to a, b, c, then sessions by abstract week slot. A session opportunity is
// reviewed like any plan; here it ends "held" (its time passed) or "failed" (rejected, expired in review, or no
// quorum).
//
// The model follows the code after the fixes for SD-144 and SD-444 (counting). The notice part of SD-444 is
// skipped (a founder decision): its invariant stays out of `safety`.
// See docs/research/quint-findings/plan_run.md.
module plan_crew {

  // ------------------------------------------------------------------------------------------------
  // Constants

  pure val MEMBERS = Set("a", "b", "c")
  pure val CREW0 = Set("a", "b", "c")
  pure val MAXT = 13
  pure val CREW_TIMEOUT = 3    // crew offer resolves after 3 days (network.ts:3221)
  pure val HANDOFF = 3         // pcfg.crews.handOffAfterSessions
  pure val CREW_MIN = 3        // pcfg.crews.minMembers
  pure val MAXWEEK = 4

  // ------------------------------------------------------------------------------------------------
  // State

  var now: int
  var optedOut: Set[str]
  var watch: Set[str]
  var minors: Set[str]
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

  /** planSeatOk (network.ts:2888) with busyOk: an adult, not opted out, trust ok. */
  def seatOk(m: str): bool = not(minors.contains(m)) and not(optedOut.contains(m)) and not(watch.contains(m))

  // ------------------------------------------------------------------------------------------------
  // Init

  action init = all {
    now' = 0, optedOut' = Set(), watch' = Set(), minors' = Set(),
    crewStage' = "offered", crewYes' = Set(), crewNo' = Set(), crewMembers' = CREW0, crewTold' = Set(),
    crewSessions' = List(), crewOpps' = Map(), crewOppSlot' = Map(), crewWeek' = 0, crewHandedOff' = false,
    crewEndTold' = false,
  }

  action keepEnv = all { now' = now, optedOut' = optedOut, watch' = watch, minors' = minors }
  action keepCrew = all {
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold,
  }

  // ------------------------------------------------------------------------------------------------
  // Actor events that the crew reads (the plan run model has the same events)

  action clock = all { now < MAXT, now' = now + 1, optedOut' = optedOut, watch' = watch, minors' = minors, keepCrew }
  /** STOP (network.ts:675). */
  action stop(m: str): bool = all {
    not(optedOut.contains(m)), optedOut' = optedOut.union(Set(m)),
    now' = now, watch' = watch, minors' = minors, keepCrew,
  }
  /** Trust goes to watch (onTrustChange, network.ts:1188). */
  action goWatch(m: str): bool = all {
    not(watch.contains(m)), watch' = watch.union(Set(m)),
    now' = now, optedOut' = optedOut, minors' = minors, keepCrew,
  }
  /** A minor signal (network.ts:721). */
  action minorSignal(m: str): bool = all {
    not(minors.contains(m)), minors' = minors.union(Set(m)),
    now' = now, optedOut' = optedOut, watch' = watch, keepCrew,
  }

  // ------------------------------------------------------------------------------------------------
  // Crew actions

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
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, keepEnv,
  }

  /** The offer resolves after 3 days (network.ts:3221). */
  action crewTimeout = all {
    crewStage == "offered", now >= CREW_TIMEOUT,
    resolveCrew(crewYes), crewYes' = crewYes, crewNo' = crewNo,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, keepEnv,
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
      crewMembers.filter(id => seatOk(id)).size() >= CREW_MIN,
      not(dup),
      crewSessions' = crewSessions.append(planId),
      crewOpps' = crewOpps.put(oppId, "review"),
      crewOppSlot' = crewOppSlot.put(oppId, slot),
      crewHandedOff' = false,
    },
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewWeek' = crewWeek, crewEndTold' = crewEndTold, keepEnv,
  }

  /** A session ends: held (its time passed), or failed (rejected, expired in review, or no quorum). */
  action crewSessionEnd(id: int, held: bool): bool = all {
    crewOpps.keys().contains(id), crewOpps.get(id) == "review",
    crewOpps' = crewOpps.set(id, if (held) "held" else "failed"),
    crewWeek' = if (held and crewOppSlot.get(id) + 1 > crewWeek) crewOppSlot.get(id) + 1 else crewWeek,
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOppSlot' = crewOppSlot, crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold,
    keepEnv,
  }

  /** Time moves on to the next weekly slot. */
  action crewWeekPass = all {
    crewWeek < MAXWEEK, crewWeek' = crewWeek + 1,
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewHandedOff' = crewHandedOff,
    crewEndTold' = crewEndTold, keepEnv,
  }

  // ------------------------------------------------------------------------------------------------
  // Step

  action step = {
    nondet m = MEMBERS.oneOf()
    nondet yes = Set(true, false).oneOf()
    // Actor events are rare (1 in 10), so that random traces also reach the hand-off.
    nondet roll = 0.to(9).oneOf()
    any {
      crewAnswer(m, yes), crewTimeout, crewTick, crewSessionEnd(99 + crewSessions.length(), yes), crewWeekPass,
      clock, all { roll == 0, any { stop(m), goWatch(m), minorSignal(m) } },
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Safety invariants (written from the rules, not from the code)

  /**
   * SD-144 (fixed). One session proposal per crew slot. Rule: the dedupe in crewSessions (network.ts:3230) and "weekly,
   * same time and place, each session opt-in and reviewed like any plan" (network.ts:3214). Code: the dedupe
   * looked up plan ids in a map keyed by opportunity ids, so it never matched.
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

  val safety: bool = and { sessionSlotOnce, handoffCountsSessions, crewOptedIn }

  // The invariant of the skipped defect (SD-444 notice part). It fails today; see its comment.
  val skippedDefects: bool = crewEndHeard

  // ------------------------------------------------------------------------------------------------
  // Witnesses (each must be violated: the state is reachable)

  val witness_crewSession = not(crewOpps.keys().exists(k => crewOpps.get(k) == "held"))
  val witness_crewNotFormed = not(crewStage == "none")
  val witness_crewHandedOff = not(crewHandedOff)

  // ------------------------------------------------------------------------------------------------
  // Run tests (concrete traces)

  /** SD-144 fixed: a session that fails in review is not proposed again for the same slot. */
  run sd144SlotOnceTest =
    init
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
    init
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick).then(crewSessionEnd(100, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(101, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(102, true))
      .then(crewTick).then(crewSessionEnd(103, true))
      .then(crewTick).then(crewSessionEnd(104, true))
      .expect(not(crewHandedOff) and crewSessions.length() == 5)
      .then(crewTick)
      .expect(crewHandedOff and crewSessions.length() == 5 and handoffCountsSessions and not(crewEndHeard) and safety)

  /** A member who goes on watch leaves the crew short of seats: no session is proposed. */
  run crewSeatsTest =
    init
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(goWatch("b"))
      .expect(crewStage == "formed" and crewMembers.filter(id => seatOk(id)).size() < CREW_MIN and safety)
      .then(crewTick)
      .fail()
}
