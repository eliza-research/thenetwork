# Crew invitations and sessions

## Story: Crew invitations and sessions

A member needs to opt in before joining a crew and get at most one crew session per slot.

### Safety rules and reachability

Check opt-in, unique session slots, and handoff counts. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/plan_crew.qnt` at `30d950e`. See [model index](README.md) for scope and commands.
Production offer transitions and the handoff decision use [Recurring crew offers](../crewOffer.md). This standalone model keeps its abstract time and eligibility changes from the source branch. The model's held outcome represents a booked session that reached the feedback step.
The [Friends weekly planner](../friendsWeek.md) reserves prospective crew sessions and offers before repeats and new plans.

A friends.help crew can hold members aged 13 to 17 when every pair with a minor passes the teen pair rule and the crew meets at an all-ages place for an all-ages activity ([friend introductions with a minor](../friendIntroAge.md) `groupAgeAllowed`, `teenPlaceAllowed`; engine `crewSessionPlan` returns no session unless `teenGroupReason` passes and the place rule holds). The model chooses at the start whether the crew is a teen crew (`teenCrew`) and whether its place is all-ages now (`placeAllAges`, read from the catalog entry by id, never from the stored plan copy). In a teen crew the set `minors` stands for the members who fail the rule now (19 on the session's end day, a lost readiness, a report or a bar, a stop of teen introductions), so `noSessionAMinorKnows` is the teen plan rule for a teen crew, and while teen introductions are stopped it is the minors policy. `teenPlanPlace` states that a teen crew at a place that is not all-ages gets no session. Organizing reach is outside this model (`withReach` gives a crew with a minor no reach; `teen-friend-intro.integration.test.ts`). Changed (owner decision 2026-11-22, answer A4): a friends.help crew may hold a minor under the rule, because the owner chose "Also small teen groups".

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=10000 verify-steps=12
//
// The crew offer and the crew sessions (docs/research/2026-11-07-state-machines.md section 6.7: M-124
// crew-offer-and-crew). This machine was part of quint/plan_run.qnt. It is a model of its own so that Apalache
// can check it (docs/research/quint-findings/plan_run.md section 6). The crew machine shares no state with the
// plan run: it reads only STOP, the trust watch and the minors policy (planSeatOk) and the clock. Those are
// actor events here too, so this model has every crew trace of the old combined model.
//
// Code: packages/engine/src/plans.ts (crewOptIn 696, crewSessionPlan 704) and packages/network/src/network.ts
// at the merge of formal-main (crewCheck 3418, onCrewAnswer 3450, resolveCrew 3460, crewSessions 3480,
// planSeatOk 3113). The model follows the code at the same commit as quint/plan_run.qnt (branch
// wave2/plan_run); the other "network.ts:<line>" references in this file are lines at that commit.
//
// Abstractions: one crew offer to a, b, c, then sessions by abstract week slot. A session opportunity is
// reviewed like any plan; here it ends "held" (its time passed) or "failed" (rejected, expired in review, or no
// quorum). The shell supplies exact-offer receipt authority and whether the current public venue can host
// the full slot. Provider receipt timestamps and venue calendar entries are outside this model.
//
// The model follows the code after the fixes for SD-144 and SD-444 (counting). The notice part of SD-444 is
// skipped (a founder decision): its invariant stays out of `safety`.
// See docs/research/quint-findings/plan_run.md.
module plan_crew {

  // ------------------------------------------------------------------------------------------------
  // Constants

  pure val MEMBERS = Set("a", "b", "c", "d")
  pure val CREW0 = Set("a", "b", "c")
  // The members asked about the plan the crew came from: the crew, and d, who was asked and declined. The crew
  // meets at that plan's time and place (crewSource and knowsCrew, network.ts). In the code the set also holds the
  // members asked about each earlier plan whose time and place that plan keeps (timeAndPlaceChain, network.ts).
  pure val SOURCE_ASKED = Set("a", "b", "c", "d")
  pure val MAXT = 13
  pure val CREW_TIMEOUT = 3 // crew offer resolves after 3 days (network.ts)
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
  var crewSessions: List[int] // crew.sessions: PLAN ids (here: the slot), network.ts
  var crewOpps: int -> str     // session opportunity id -> review | held | failed
  var crewOppSlot: int -> int  // session opportunity id -> slot
  var crewWeek: int            // the next free slot (time)
  var crewHandedOff: bool
  var crewEndTold: bool        // members heard that the weekly crew ended
  // Owner decision 2026-11-22, answer A4: a friends.help teen crew (minors = the members who fail the rule), and
  // whether its place and activity are all-ages now (teenPlaceAllowed).
  var teenCrew: bool
  var placeAllAges: bool

  /** planSeatOk (network.ts) with busyOk: an adult, not opted out, trust ok. */
  def seatOk(m: str): bool = not(minors.contains(m)) and not(optedOut.contains(m)) and not(watch.contains(m))

  // ------------------------------------------------------------------------------------------------
  // Init

  action initCrew(tc: bool, aa: bool): bool = all {
    now' = 0, optedOut' = Set(), watch' = Set(), minors' = Set(),
    crewStage' = "offered", crewYes' = Set(), crewNo' = Set(), crewMembers' = CREW0, crewTold' = Set(),
    crewSessions' = List(), crewOpps' = Map(), crewOppSlot' = Map(), crewWeek' = 0, crewHandedOff' = false,
    crewEndTold' = false, teenCrew' = tc, placeAllAges' = aa,
  }
  // An adult crew (the place rule does not apply to it).
  action initAdult = initCrew(false, true)
  action init = {
    nondet tc = Set(true, false).oneOf()
    nondet aa = Set(true, false).oneOf()
    initCrew(tc, aa)
  }

  action keepEnv = all { now' = now, optedOut' = optedOut, watch' = watch, minors' = minors, teenCrew' = teenCrew, placeAllAges' = placeAllAges }
  action keepCrew = all {
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, teenCrew' = teenCrew, placeAllAges' = placeAllAges,
  }

  // ------------------------------------------------------------------------------------------------
  // Actor events that the crew reads (the plan run model has the same events)

  action clock = all { now < MAXT, now' = now + 1, optedOut' = optedOut, watch' = watch, minors' = minors, keepCrew }
  /** STOP (network.ts). */
  action stop(m: str): bool = all {
    not(optedOut.contains(m)), optedOut' = optedOut.union(Set(m)),
    now' = now, watch' = watch, minors' = minors, keepCrew,
  }
  /** Trust goes to watch (onTrustChange, network.ts). */
  action goWatch(m: str): bool = all {
    not(watch.contains(m)), watch' = watch.union(Set(m)),
    now' = now, optedOut' = optedOut, minors' = minors, keepCrew,
  }
  /**
   * A minor signal (network.ts), and a decline for an age under the join age (declineUnderMinAge). dropMember
   * closes every open session of a crew the minor belongs to: the minor knows its time and place
   * (spec/opportunityLifecycle.md, "A new minor signal closes an opportunity involving that person"). It also
   * removes the crew from the Network's crews and resolves its open offer unformed, so the crew stays ended after
   * forget deletes the minor's id. Abstraction: the model keeps the crew and its members, and crewKnownToAMinor
   * refuses every later session and the forming, which has the same effect on sessions. A record that goes under
   * 18 with no inbound signal is read at the next tick, and also at the moment a session books, falls back or takes
   * a late yes (planMembersAdult reads the crew members and the askees of the crew's source table): the session
   * never books for the adults first, so this one atomic step models both.
   */
  action minorSignal(m: str): bool = all {
    not(minors.contains(m)), minors' = minors.union(Set(m)),
    crewOpps' = if (crewMembers.contains(m) or SOURCE_ASKED.contains(m)) crewOpps.keys().mapBy(k => if (crewOpps.get(k) == "review") "failed" else crewOpps.get(k)) else crewOpps,
    crewStage' = crewStage, crewYes' = crewYes, crewNo' = crewNo, crewMembers' = crewMembers, crewTold' = crewTold,
    crewSessions' = crewSessions, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, teenCrew' = teenCrew, placeAllAges' = placeAllAges,
    now' = now, optedOut' = optedOut, watch' = watch,
  }

  /** spec/opportunityLifecycle.md, "A minor signal ends the recurring plans that the minor knows". */
  def crewKnownToAMinor: bool = crewMembers.union(SOURCE_ASKED).exists(id => minors.contains(id))

  // ------------------------------------------------------------------------------------------------
  // Crew actions

  // resolveCrew (formal-main network.ts): a yes counts only from a member who may still take a seat
  // (planSeatOk with busyOk: not a minor, not opted out, trust ok); crewOptIn needs CREW_MIN of them, and only
  // they hear crewFormed or crewNotFormed.
  // A crew whose invitees include a known minor never forms (recurrenceAllowed).
  action resolveCrew(yes0: Set[str]): bool = {
    val yes = yes0.filter(id => seatOk(id))
    val forms = yes.size() >= CREW_MIN and not(crewKnownToAMinor)
    all {
      crewStage' = if (forms) "formed" else "none",
      crewMembers' = if (forms) crewMembers.intersect(yes) else crewMembers,
      crewTold' = crewTold.union(yes),
    }
  }

  /** onCrewAnswer (network.ts): when everyone answered, resolveCrew (network.ts). */
  action crewAnswer(m: str, yes: bool): bool = crewAnswerCurrent(m, yes, true)

  action crewAnswerCurrent(m: str, yes: bool, receiptCurrent: bool): bool = all {
    receiptCurrent, now <= CREW_TIMEOUT, crewStage == "offered", CREW0.contains(m), not(crewYes.contains(m)), not(crewNo.contains(m)),
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

  /** The offer resolves after 3 days (network.ts). */
  action crewTimeout = all {
    crewStage == "offered", now > CREW_TIMEOUT,
    resolveCrew(crewYes), crewYes' = crewYes, crewNo' = crewNo,
    crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewWeek' = crewWeek,
    crewHandedOff' = crewHandedOff, crewEndTold' = crewEndTold, keepEnv,
  }

  /**
   * crewSessions (network.ts): no open session for the crew; then the hand-off when 3 sessions took
   * place (stage done: SD-444 counting fixed; still no member hears it, the skipped notice part); then enough
   * seats; then the dedupe on the plan id, which the crew and the slot fix (SD-144 fixed).
   */
  action crewTick = crewTickWithVenue(true)

  action crewTickWithVenue(venueCurrent: bool): bool = all {
    crewStage == "formed", not(crewHandedOff), not(crewKnownToAMinor),
    crewOpps.keys().forall(k => crewOpps.get(k) != "review"),
    val held = crewOpps.keys().filter(k => crewOpps.get(k) == "held").size()
    val slot = crewWeek
    val planId = slot
    val dup = crewSessions.select(pid => pid == planId).length() > 0
    val oppId = 100 + crewSessions.length()
    if (held >= HANDOFF) all {
      crewSessions' = crewSessions, crewOpps' = crewOpps, crewOppSlot' = crewOppSlot, crewHandedOff' = true,
    } else all {
      venueCurrent,
      // engine crewSessionPlan: a teen crew gets a session only at an all-ages place (teenPlaceAllowed).
      not(teenCrew) or placeAllAges,
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
      crewAnswerCurrent(m, yes, roll != 9), crewTimeout, crewTickWithVenue(roll != 8),
      crewSessionEnd(99 + crewSessions.length(), yes), crewWeekPass,
      clock, all { roll == 0, any { stop(m), goWatch(m), minorSignal(m) } },
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Safety invariants (written from the rules, not from the code)

  /**
   * SD-144 (fixed). One session proposal per crew slot. Rule: the dedupe in crewSessions (network.ts) and "weekly,
   * same time and place, each session opt-in and reviewed like any plan" (network.ts). Code: the dedupe
   * looked up plan ids in a map keyed by opportunity ids, so it never matched.
   */
  val sessionSlotOnce: bool =
    crewSessions.indices().forall(i => crewSessions.indices().forall(j => i == j or crewSessions[i] != crewSessions[j]))

  /**
   * SD-444 counting part (fixed). The crew is handed off after 3 sessions (network.ts "the Network hands the crew off
   * after 3 sessions"), not after 3 proposals: a failed session does not count.
   */
  val handoffCountsSessions: bool =
    crewHandedOff implies crewOpps.keys().filter(k => crewOpps.get(k) != "failed").size() >= HANDOFF

  /**
   * SD-444 notice part (SKIPPED: needs new member text and a founder decision on what the handoff means in the
   * Network, which has no group chat). crewFormed promises "Your weekly crew is on" (copy.ts); when the last
   * session is over after the hand-off, the members hear that the weekly crew ended. Code: only a log line
   * (network.ts). Kept out of `safety`; `crewHandoffTest` shows it still fails.
   */
  val crewEndHeard: bool =
    (crewHandedOff and crewOpps.keys().forall(k => crewOpps.get(k) != "review")) implies crewEndTold

  /** A crew forms only with members who opted in (crewOptIn, founder decision 2026-10-08). */
  val crewOptedIn: bool = crewStage == "formed" implies (crewMembers.subseteq(crewYes) and crewMembers.size() >= CREW_MIN)

  /** No session of a crew waits in review while a crew member is a known minor. */
  val noSessionAMinorKnows: bool =
    crewKnownToAMinor implies crewOpps.keys().forall(k => crewOpps.get(k) != "review")

  /**
   * Owner decision 2026-11-22, answer A4 (spec/friendIntroAge.md groupAgeAllowed, teenPlaceAllowed): in a teen crew
   * `noSessionAMinorKnows` is the teen plan rule (no session in review while a member fails the rule), so it has no
   * second name; a teen crew at a place that is not all-ages gets no session.
   */
  val teenPlanPlace: bool = (teenCrew and not(placeAllAges)) implies crewSessions == List()

  val safety: bool = and { sessionSlotOnce, handoffCountsSessions, crewOptedIn, noSessionAMinorKnows, teenPlanPlace }

  // The invariant of the skipped defect (SD-444 notice part). It fails today; see its comment.
  val skippedDefects: bool = crewEndHeard

  // ------------------------------------------------------------------------------------------------
  // Witnesses (each must be violated: the state is reachable)

  val witness_crewSession = not(crewOpps.keys().exists(k => crewOpps.get(k) == "held"))
  val witness_crewNotFormed = not(crewStage == "none")
  val witness_crewHandedOff = not(crewHandedOff)

  // ------------------------------------------------------------------------------------------------
  // Run tests (concrete traces)

  run unfinishedCrewOfferCannotAcceptTest =
    initAdult.then(crewAnswerCurrent("a", true, false)).fail()

  run closedVenueCannotCreateCrewSessionTest =
    initAdult
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTickWithVenue(false)).fail()

  /** SD-144 fixed: a session that fails in review is not proposed again for the same slot. */
  run sd144SlotOnceTest =
    initAdult
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
    initAdult
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick).then(crewSessionEnd(100, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(101, false))
      .then(crewWeekPass).then(crewTick).then(crewSessionEnd(102, true))
      .then(crewTick).then(crewSessionEnd(103, true))
      .then(crewTick).then(crewSessionEnd(104, true))
      .expect(not(crewHandedOff) and crewSessions.length() == 5)
      .then(crewTick)
      .expect(crewHandedOff and crewSessions.length() == 5 and handoffCountsSessions and not(crewEndHeard) and safety)

  /** A crew member found to be a minor ends the crew: the open session closes and no new session follows. */
  run minorEndsCrewTest =
    initAdult
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick)
      .then(minorSignal("b"))
      .expect(crewOpps.get(100) == "failed" and noSessionAMinorKnows and safety)
      .then(crewWeekPass).then(crewTick)
      .fail()

  /** d, who was asked about the plan the crew came from and is not in the crew, is found to be a minor: the crew ends. */
  run minorAskedAboutSourceEndsCrewTest =
    initAdult
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick)
      .then(minorSignal("d"))
      .expect(crewOpps.get(100) == "failed" and noSessionAMinorKnows and safety)
      .then(crewWeekPass).then(crewTick)
      .fail()

  /** A member who goes on watch leaves the crew short of seats: no session is proposed. */
  run crewSeatsTest =
    initAdult
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(goWatch("b"))
      .expect(crewStage == "formed" and crewMembers.filter(id => seatOk(id)).size() < CREW_MIN and safety)
      .then(crewTick)
      .fail()

  /** Answer A4: a teen crew at an all-ages place gets a session; one member failing the rule ends the crew. */
  run teenCrewSessionTest =
    initCrew(true, true)
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick)
      .expect(crewOpps.get(100) == "review" and safety)
      .then(minorSignal("b"))
      .expect(crewOpps.get(100) == "failed" and noSessionAMinorKnows and safety)
  /** Answer A4: a teen crew at a place that is not all-ages gets no session. */
  run teenCrewBarTest =
    initCrew(true, false)
      .then(crewAnswer("a", true)).then(crewAnswer("b", true)).then(crewAnswer("c", true))
      .then(crewTick)
      .fail()
}
```
