// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=8000 verify-steps=6
//
// The opportunity machines of the ConsentNetwork (docs/research/2026-11-07-state-machines.md section 6.6):
// opportunity-lifecycle, opp-participant-status, review-item, awaiting-slot, yes-hold,
// send-pipeline-and-deferred, reply-reader (as an oracle), send-belief, booked-attendance,
// member-request (one request), outreach-attention (the two-unanswered pause) and the tick.
//
// The model follows packages/network/src/network.ts AS IT IS (branch wave2/opportunity, from ad67275).
// "N:<line>" is a line in that file. One action is one unit of work under the store lock (store.ts:263):
// an inbound message (onInbound), a staff decision (decide), a tick (tick), or one step of another actor
// (the outbound queue, the member record). The probe send is its own action: probe() defers a probe while
// the member's send window is closed, and tick() tries again (N:2165-2173), so other units run in between.
//
// Bounds: 3 members (a, b, c), 2 pair opportunities. o1 is a member request of a with b (alternate c);
// o2 is an engine intro of a with c (alternate b). Time is in hours.
// Oracles: the send window and quiet hours (env.openW), the intro budget (env.budget), the meeting lead
// time (env.lead), the outbound queue outcome (queueDecide), and the reply readers (readProbe, readYesNo).
// The readers are fixed maps from the member's real intent to the code's reading (classify.ts:666, 719
// map a counter-offer to "yes"); the evals/ corpora test the readers themselves.
//
// Ghost state (not in the code): what the member really meant (accepted, withdrawn, saidNo, cancelAsked),
// what really reached them (msgs[].q from the queue), and who was told what (revealSent, wasTold,
// cancelHeard, released).
//
// Defects that this model reproduces are named on the invariant that shows them (SD-NNN, register in
// docs/research/2026-11-07-state-machines.md section 5). Findings: docs/research/quint-findings/opportunity.md.
module opportunity {

  // ---------------------------------------------------------------- constants
  pure val MEMBERS = Set("a", "b", "c")
  pure val ORDER = List("a", "b", "c")
  pure val OPPS = Set("o1", "o2")
  pure val OPP_ORDER = List("o1", "o2")
  // feedbackDue (N:2589) searches the newest opportunity first.
  pure val OPP_NEWEST = List("o2", "o1")
  pure val OPEN = Set("review", "probing", "scheduled")
  pure val TERMINAL = Set("closed", "done", "gone")

  pure val PROBE_TTL = 26      // N:440
  pure val PROBE_WAIT = 48     // N:440: partnerProbeDays = 2 (engine config.ts:340)
  pure val REVIEW_SLA = 12     // N:578 reviewSlaHours
  pure val OPT_OUT_HOURS = 48  // N:444
  pure val UNANSWERED_AFTER = 72 // outreach.ts:24
  pure val UNANSWERED_LIMIT = 2  // outreach.ts:26
  pure val SLOT_EXPIRY = 72    // N:3285: awaiting other than probe and booked ends after 3 days
  pure val FEEDBACK_AFTER = 3  // N:3405
  pure val FINALIZE_AFTER = 96 // N:3425
  pure val FEEDBACK_DUE = 168  // N:2590

  // What the member really says (the readers see only the text).
  pure val INTENTS = Set("yes", "yes_other_times", "counter", "no", "unclear", "cancel",
                         "fb_good", "fb_other_noshow", "fb_self_noshow", "ack", "job_post")
  // Intents that are consent to meet (AGENTS.md decision 11: only answer "yes" is consent, a counter is
  // not a yes). "yes, but none of those times" is a yes to the meeting.
  pure val CONSENT = Set("yes", "yes_other_times", "ack")

  // ---------------------------------------------------------------- types
  type Aw = { kind: str, opp: str, at: int, clarified: bool }
  type Review = { decision: str, deadline: int, decidedAt: int, invalidated: bool }
  type Msg = { kind: str, opp: str, to: str, at: int, q: str }
  type Def = { kind: str, opp: str, to: str }
  type Env = { openW: Set[str], budget: bool, lead: int }
  type OppSt = {
    stage: str, closedFrom: str, closedReason: str,
    parts: Set[str], alts: Set[str], first: str, requester: str,
    status: str -> str,
    review: Review,
    contacted: Set[str], sentAt: str -> int, turnAt: str -> int, timeRetry: Set[str],
    meetingAt: int, bookedTold: Set[str], bookedAt: str -> int, confirmed: Set[str], reminded: Set[str],
    feedbackSent: bool, finalized: bool, post: str -> str, feedbackFrom: Set[str],
    outcomeRec: str,
    // ghosts
    accepted: str -> str, withdrawn: Set[str], saidNo: Set[str], cancelAsked: Set[str],
    revealSent: Set[str], wasTold: Set[str], silent: Set[str], expiredSilent: Set[str],
    released: Set[str], cancelHeard: Set[str], droppedBy: Set[str], noShowCount: str -> int,
    everTerminal: bool
  }
  type MemSt = {
    optedOut: bool, minor: bool, forgotten: bool, aw: Aw, outbound: int, asks: List[int],
    onlyWhenAsked: bool, noShows: int
  }
  type Req = { outcome: str, toldNone: bool }
  type Last = { act: str, o: str, m: str, x: str, dt: int }
  type S = {
    now: int, opps: str -> OppSt, mem: str -> MemSt, req: Req,
    deferred: Set[Def], msgs: Set[Msg], last: Last
  }

  pure def L(act: str, o: str, m: str, x: str): Last = { act: act, o: o, m: m, x: x, dt: 0 }
  pure val NO_AW: Aw = { kind: "none", opp: "", at: 0, clarified: false }

  pure def zeroMap(v: int): str -> int = MEMBERS.mapBy(_ => v)
  pure def strMap(v: str): str -> str = MEMBERS.mapBy(_ => v)

  pure def template(parts: Set[str], alts: Set[str], first: str, requester: str): OppSt = {
    stage: "absent", closedFrom: "", closedReason: "",
    parts: parts, alts: alts, first: first, requester: requester,
    status: strMap("out"),
    review: { decision: "", deadline: 0, decidedAt: 0, invalidated: false },
    contacted: Set(), sentAt: zeroMap(-1), turnAt: zeroMap(-1), timeRetry: Set(),
    meetingAt: -1, bookedTold: Set(), bookedAt: zeroMap(-1), confirmed: Set(), reminded: Set(),
    feedbackSent: false, finalized: false, post: strMap(""), feedbackFrom: Set(),
    outcomeRec: "",
    accepted: strMap(""), withdrawn: Set(), saidNo: Set(), cancelAsked: Set(),
    revealSent: Set(), wasTold: Set(), silent: Set(), expiredSilent: Set(),
    released: Set(), cancelHeard: Set(), droppedBy: Set(), noShowCount: zeroMap(0),
    everTerminal: false
  }

  pure val MEM0: MemSt = {
    optedOut: false, minor: false, forgotten: false, aw: NO_AW, outbound: 0, asks: List(),
    onlyWhenAsked: false, noShows: 0
  }

  pure val S0: S = {
    now: 0,
    opps: Map("o1" -> template(Set("a", "b"), Set("c"), "a", "a"),
              "o2" -> template(Set("a", "c"), Set("b"), "a", "")),
    mem: MEMBERS.mapBy(_ => MEM0),
    req: { outcome: "", toldNone: false },
    deferred: Set(), msgs: Set(), last: L("init", "", "", "")
  }

  // ---------------------------------------------------------------- small helpers
  pure def op(s: S, o: str): OppSt = s.opps.get(o)
  pure def mm(s: S, m: str): MemSt = s.mem.get(m)
  pure def putO(s: S, o: str, x: OppSt): S = { ...s, opps: s.opps.set(o, x) }
  pure def putM(s: S, m: str, x: MemSt): S = { ...s, mem: s.mem.set(m, x) }
  pure def stat(s: S, o: str, m: str): str = op(s, o).status.get(m)
  pure def setStat(s: S, o: str, m: str, v: str): S = putO(s, o, { ...op(s, o), status: op(s, o).status.set(m, v) })
  pure def partsOrdered(s: S, o: str): List[str] = ORDER.select(p => op(s, o).parts.contains(p))
  pure def clearAwFor(s: S, m: str, o: str): S =
    if (mm(s, m).aw.opp == o and mm(s, m).aw.kind != "none") putM(s, m, { ...mm(s, m), aw: NO_AW }) else s

  // busy(): in an open opportunity (other than `except`) and not out of it (N:4368).
  pure def busy(s: S, m: str, except: str): bool =
    OPPS.exists(o => o != except and OPEN.contains(op(s, o).stage) and op(s, o).parts.contains(m)
      and not(Set("unavailable", "no", "dropped", "out").contains(stat(s, o, m))))

  // eligible(): a member who may be put into an opportunity (not declined, opted out, a minor or busy).
  pure def eligible(s: S, m: str, except: str): bool =
    not(mm(s, m).forgotten) and not(mm(s, m).optedOut) and not(mm(s, m).minor) and not(busy(s, m, except))

  // ---------------------------------------------------------------- the send pipeline (N:3862-3954)
  // The gates of send() in order: checkRecipient (N:4215), budget, the Blooio streak, timing.
  // Kinds that are about other members (outreach.ts:59 ABOUT_OTHERS) are refused for a minor.
  pure def sendGate(s: S, m: str, kind: str, timing: str, aboutOthers: bool, proactive: bool, env: Env): str = {
    val x = mm(s, m)
    if (x.forgotten or x.optedOut) "refused"
    else if (proactive and x.onlyWhenAsked) "refused"
    else if (aboutOthers and x.minor) "refused"
    else if (proactive and not(env.budget)) "refused"
    else if (timing == "slot" and x.outbound > 1) "refused"          // attention.canInterrupt
    else if (timing == "logistics" and x.outbound > 2) "refused"     // attention.canSendLogistics
    else if (timing != "now" and not(env.openW.contains(m))) "deferred"
    else "sent"
  }

  // The message is collected for the outbound queue in the same unit (runtime.ts: ctx.send only collects).
  pure def collect(s: S, m: str, kind: str, o: str, proactive: bool): S = {
    val x = mm(s, m)
    val x2 = { ...x, outbound: x.outbound + 1, asks: if (proactive) x.asks.append(s.now) else x.asks }
    { ...putM(s, m, x2), msgs: s.msgs.union(Set({ kind: kind, opp: o, to: m, at: s.now, q: "pending" })) }
  }

  pure def pushDef(s: S, kind: str, o: str, m: str): S = { ...s, deferred: s.deferred.union(Set({ kind: kind, opp: o, to: m })) }

  // expect() (N:4136): a pending probe or booked plan is never replaced by another kind.
  pure def expectSlot(s: S, m: str, aw: Aw): S = {
    val cur = mm(s, m).aw.kind
    if ((cur == "probe" or cur == "booked") and aw.kind != "probe" and aw.kind != "booked") s
    else putM(s, m, { ...mm(s, m), aw: aw })
  }

  // ---------------------------------------------------------------- close (N:2526-2561)
  pure def close(s: S, o: str, reason: str, env: Env): S = {
    val x = op(s, o)
    if (TERMINAL.contains(x.stage) or x.stage == "absent") s
    else {
      val wasReview = x.stage == "review"
      val wasProbing = x.stage == "probing" or wasReview
      val s1 = putO(s, o, { ...x, closedFrom: x.stage, closedReason: reason, stage: "closed", everTerminal: true })
      // Participants: clear their slot for this opportunity; tell the ones who said yes, when it was booked.
      val s2 = partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val a1 = clearAwFor(acc, p, o)
        if (not(wasProbing) and stat(a1, o, p) == "yes" and reason != "blocked") {
          val r = sendGate(a1, p, "declined_quiet", "logistics", false, false, env)
          if (r == "sent") { val a2 = collect(a1, p, "declined_quiet", o, false)
                             putO(a2, o, { ...op(a2, o), cancelHeard: op(a2, o).cancelHeard.union(Set(p)) }) }
          else if (r == "deferred") pushDef(a1, "declined_quiet", o, p)
          else a1
        } else a1
      })
      // The member request (N:2542-2557): a request still probing goes back to waiting.
      val req = x.requester
      val s3 = if (req != "" and s2.req.outcome == "probing") {
        val rm = mm(s2, req)
        val tell = not(rm.optedOut) and reason != "requester unavailable" and stat(s2, o, req) != "no"
        if (not(tell)) { ...s2, req: { ...s2.req, outcome: "none" } }
        else if (s2.req.toldNone) { ...s2, req: { ...s2.req, outcome: "none" } }
        else {
          // tellNoneYet (N:1642): told once.
          val s4 = { ...s2, req: { outcome: "none", toldNone: true } }
          val r = sendGate(s4, req, "none_yet", "logistics", false, false, env)
          if (r == "sent") { val s5 = collect(s4, req, "none_yet", o, false)
                             putO(s5, o, { ...op(s5, o), released: op(s5, o).released.union(Set(req)) }) }
          else if (r == "deferred") pushDef(s4, "none_yet", o, req)
          else s4
        }
      } else s2
      // The interaction record (N:2559): "declined" only for reason "declined".
      val rec = if (wasReview) "" else if (reason == "declined") "declined" else if (wasProbing) "expired" else "cancelled"
      putO(s3, o, { ...op(s3, o), outcomeRec: rec })
    }
  }

  // ---------------------------------------------------------------- probe turns (advanceProbes, N:2129)
  // Turn order only. The probe itself is the probeSend action (see the header).
  pure def advanceTurns(s: S, o: str): S = {
    val x = op(s, o)
    if (x.stage != "probing") s
    else {
      val first = if (x.parts.contains(x.first)) x.first else partsOrdered(s, o)[0]
      val s1 = putO(s, o, { ...x, first: first })
      val firstIn = stat(s1, o, first) == "available"
      partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val st = stat(acc, o, p)
        if (st != "queued") acc
        else if (p != first and not(firstIn)) acc
        else putO(acc, o, { ...op(acc, o), status: op(acc, o).status.set(p, "probing"), turnAt: op(acc, o).turnAt.set(p, acc.now) })
      })
    }
  }

  // ---------------------------------------------------------------- replaceOrClose (N:2368)
  // With one alternate the replacement cannot reveal at once: the alternate starts "queued".
  pure def replaceOrClose(s: S, o: str, out: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage != "probing") s
    else if (x.requester == out) close(s, o, "requester unavailable", env)
    else {
      val stay = x.parts.exclude(Set(out))
      val cands = ORDER.select(a => x.alts.contains(a) and eligible(s, a, o))
      if (cands.length() > 0) {
        val alt = cands[0]
        val s1 = putO(s, o, { ...x, alts: Set(), parts: stay.union(Set(alt)),
                              first: if (x.first == out) alt else x.first,
                              status: x.status.set(out, "out").set(alt, "queued") })
        advanceTurns(s1, o)
      } else close(putO(s, o, { ...x, alts: Set() }), o, "no one available", env)
    }
  }

  // ---------------------------------------------------------------- handleDrop (N:2502)
  pure def handleDrop(s: S, m: str, o: str, ack: bool, env: Env): S = {
    val x0 = op(s, o)
    val s1 = putO(s, o, { ...x0, status: x0.status.set(m, "dropped"), droppedBy: x0.droppedBy.union(Set(m)) })
    val s2 = if (ack) collect(s1, m, "reply", o, false) else s1
    val s3 = clearAwFor(s2, m, o)
    val still = partsOrdered(s3, o).select(p => stat(s3, o, p) == "yes")
    // Only members who were told about the plan hear that it changed (N:2516). The drop_notice hook has no onRefused.
    val s4 = still.foldl(s3, (acc, p) =>
      if (not(op(acc, o).bookedTold.contains(p))) acc
      else {
        val r = sendGate(acc, p, "drop_notice", "logistics", false, false, env)
        if (r == "sent") { val a2 = collect(acc, p, "drop_notice", o, false)
                           putO(a2, o, { ...op(a2, o), cancelHeard: op(a2, o).cancelHeard.union(Set(p)) }) }
        else if (r == "deferred") pushDef(acc, "drop_notice", o, p)
        else acc
      })
    // A pair: keep is false, so the opportunity closes on handleDrop's own path (not close()).
    val keep = op(s4, o).parts.size() > 2 and still.length() >= 2
    if (keep) s4
    else putO(s4, o, { ...op(s4, o), closedFrom: op(s4, o).stage, closedReason: "participant dropped", stage: "closed", everTerminal: true })
  }

  // ---------------------------------------------------------------- reveal (N:2411)
  pure def onSentReveal(s: S, o: str, m: str): S = {
    val s1 = expectSlot(s, m, { kind: "booked", opp: o, at: s.now, clarified: false })
    val x = op(s1, o)
    putO(s1, o, { ...x, bookedTold: x.bookedTold.union(Set(m)), bookedAt: x.bookedAt.set(m, s1.now),
                  revealSent: x.revealSent.union(Set(m)), wasTold: x.wasTold.union(Set(m)) })
  }

  pure def sendReveal(s: S, o: str, p: str, env: Env): S = {
    val r = sendGate(s, p, "reveal", "logistics", true, false, env)
    if (r == "sent") onSentReveal(collect(s, p, "reveal", o, false), o, p)
    else if (r == "deferred") pushDef(s, "reveal", o, p)
    else handleDrop(s, p, o, false, env) // the reveal hook's onRefused (N:4087)
  }

  pure def reveal(s: S, o: str, env: Env): S = {
    // Send-time re-check (N:2415-2424): reachable, about the others, and room on the Blooio streak.
    val bad = partsOrdered(s, o).select(p => {
      val x = mm(s, p)
      x.forgotten or x.optedOut or x.minor or x.outbound > 2
    })
    if (bad.length() > 0) replaceOrClose(setStat(s, o, bad[0], "unavailable"), o, bad[0], env)
    else {
      val x = op(s, o)
      val s1 = putO(s, o, { ...x, stage: "scheduled", meetingAt: s.now + env.lead,
                            status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "yes" else x.status.get(k)) })
      val s2 = if (x.requester != "") { ...s1, req: { ...s1.req, outcome: "booked" } } else s1
      partsOrdered(s2, o).foldl(s2, (acc, p) =>
        if (op(acc, o).stage != "scheduled" or stat(acc, o, p) != "yes") acc else sendReveal(acc, o, p, env))
    }
  }

  pure def maybeReveal(s: S, o: str, env: Env): S =
    if (op(s, o).stage == "probing" and op(s, o).parts.forall(p => stat(s, o, p) == "available")) reveal(s, o, env) else s

  pure def advanceProbes(s: S, o: str, env: Env): S = maybeReveal(advanceTurns(s, o), o, env)

  // ---------------------------------------------------------------- dropMember (N:2564), the hub
  pure def dropMember(s: S, m: str, reason: str, env: Env): S = {
    val minorReason = reason == "minors policy"
    OPP_ORDER.foldl(s, (acc, o) => {
      val x = op(acc, o)
      if (not(OPEN.contains(x.stage))) acc
      else {
        val wasAlternate = minorReason and x.alts.contains(m)
        val a1 = putO(acc, o, { ...x, alts: x.alts.exclude(Set(m)) })
        if (wasAlternate and not(x.parts.contains(m)) and x.stage != "scheduled") close(a1, o, reason, env)
        else if (not(x.parts.contains(m))) a1
        else if (minorReason and x.stage != "scheduled") close(a1, o, reason, env)
        else if (x.stage == "review") close(a1, o, reason, env)
        else if (x.stage == "probing") replaceOrClose(setStat(a1, o, m, "unavailable"), o, m, env)
        // N:2581: handleDrop for any status of a scheduled participant.
        else handleDrop(a1, m, o, false, env)
      }
    })
  }

  // heardFrom (N:639): any inbound resets the pause rules. The queue releases messages held for an answer
  // (outbound-queue.ts:636-643).
  pure def heardFrom(s: S, m: str): S = {
    val x = mm(s, m)
    val s1 = putM(s, m, { ...x, asks: List(), outbound: 0, onlyWhenAsked: false })
    { ...s1, msgs: s1.msgs.map(g => if (g.to == m and g.q == "held") { ...g, q: "pending" } else g) }
  }

  // ---------------------------------------------------------------- readers (oracles, fixed per intent)
  // parseProbeReply with time options (classify.ts:661-723) merged by the probe branch (N:766-771).
  // "counter" -> yes with no keys (classify.ts:719); "it was great" -> yes (an affirmation);
  // "I couldn't make it" -> no (a can't); "ok" -> yes, unclear after two of our messages in a row (N:769).
  pure def readProbe(intent: str, outboundBefore: int): str =
    if (Set("yes", "fb_good").contains(intent)) "yes_all"
    else if (Set("yes_other_times", "counter").contains(intent)) "yes_none"
    else if (intent == "ack") (if (outboundBefore >= 2) "unclear" else "yes_all")
    else if (Set("no", "cancel", "fb_self_noshow").contains(intent)) "no"
    else "unclear"

  // yesNoOf / consentOf (N:654, classify.ts:556): yes, no, counter or unclear.
  pure def readYesNo(intent: str): str =
    if (Set("yes", "fb_good", "ack").contains(intent)) "yes"
    else if (Set("no", "cancel", "fb_self_noshow").contains(intent)) "no"
    else if (intent == "counter") "counter"
    else "unclear"

  // ---------------------------------------------------------------- onProbeAnswer (N:2290)
  pure def onProbeAnswer(s: S, m: str, o: str, yes: bool, nonePicked: bool, intent: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage != "probing" or stat(s, o, m) != "probing") s
    else {
      val retry = x.timeRetry.contains(m)
      if (yes) {
        val x1 = { ...x, status: x.status.set(m, "available"), accepted: x.accepted.set(m, intent) }
        if (nonePicked and not(retry)) {
          // "Yes, but none of those": other times, once (a reply; the times hook sets awaiting probe).
          val s1 = putO(s, o, { ...x1, timeRetry: x1.timeRetry.union(Set(m)), status: x1.status.set(m, "probing"), sentAt: x1.sentAt.set(m, s.now) })
          val s2 = collect(s1, m, "times", o, false)
          putM(s2, m, { ...mm(s2, m), aw: { kind: "probe", opp: o, at: s2.now, clarified: false } })
        } else advanceProbes(collect(putO(s, o, x1), m, "reply", o, false), o, env)
      } else {
        val s1 = putO(s, o, { ...x, status: x.status.set(m, "unavailable"), saidNo: x.saidNo.union(Set(m)) })
        advanceProbes(replaceOrClose(collect(s1, m, "reply", o, false), o, m, env), o, env)
      }
    }
  }

  pure def confirmPlan(s: S, o: str, m: str, silent: bool): S = {
    val x = op(s, o)
    if (x.status.get(m) != "yes" or x.bookedAt.get(m) < 0 or x.confirmed.contains(m)) s
    else putO(s, o, { ...x, confirmed: x.confirmed.union(Set(m)), silent: if (silent) x.silent.union(Set(m)) else x.silent })
  }

  pure def feedbackDue(s: S, m: str): str = {
    val due = OPP_NEWEST.select(o => op(s, o).stage == "done" and stat(s, o, m) == "yes" and not(op(s, o).feedbackFrom.contains(m))
      and op(s, o).meetingAt <= s.now and s.now - op(s, o).meetingAt < FEEDBACK_DUE)
    if (due.length() > 0) due[0] else ""
  }

  // onFeedback (N:2593): the post-meeting answer; a self no-show counts on the member (N:2622).
  pure def onFeedback(s: S, m: str, o: str, intent: str): S = {
    val x = op(s, o)
    val post = if (intent == "fb_self_noshow") "self_noshow" else if (intent == "fb_other_noshow") "came_other" else "came"
    val s1 = putO(s, o, { ...x, feedbackFrom: x.feedbackFrom.union(Set(m)), post: x.post.set(m, post),
                          noShowCount: if (post == "self_noshow") x.noShowCount.set(m, x.noShowCount.get(m) + 1) else x.noShowCount })
    collect(s1, m, "reply", o, false)
  }

  // ---------------------------------------------------------------- handleInbound routing (N:673-845)
  pure def route(s: S, m: str, intent: str, outboundBefore: int, env: Env): S = {
    val aw = mm(s, m).aw
    val yn = readYesNo(intent)
    if (intent == "job_post") {
      // peon: postingTurn (N:755, jobs.ts) reads the post back and sets awaiting "posting" with no expect() (N:4636).
      putM(s, m, { ...mm(s, m), aw: { kind: "posting", opp: "", at: s.now, clarified: false } })
    } else if (aw.kind == "posting") {
      // The manager's yes or no to the read-back ends the draft.
      putM(s, m, { ...mm(s, m), aw: NO_AW })
    } else {
      // The probe branch (N:762-772).
      val pr = readProbe(intent, outboundBefore)
      val probeDone = aw.kind == "probe" and pr != "unclear"
      val clarifyNow = aw.kind == "probe" and pr == "unclear" and not(aw.clarified)
        and not(Set("cancel", "fb_other_noshow", "fb_self_noshow").contains(intent))
      if (probeDone) {
        val s1 = putM(s, m, { ...mm(s, m), aw: NO_AW })
        onProbeAnswer(s1, m, aw.opp, pr != "no", pr == "yes_none", intent, env)
      } else if (clarifyNow) {
        collect(putM(s, m, { ...mm(s, m), aw: { ...aw, clarified: true } }), m, "reply", aw.opp, false)
      } else if (aw.kind == "booked" and op(s, aw.opp).stage == "scheduled" and stat(s, aw.opp, m) == "yes" and (intent == "cancel" or yn == "no")) {
        handleDrop(putM(s, m, { ...mm(s, m), aw: NO_AW }), m, aw.opp, true, env)
      } else if (aw.kind == "booked" and (yn == "yes" or intent == "ack")) {
        val s1 = putM(s, m, { ...mm(s, m), aw: NO_AW })
        collect(if (op(s1, aw.opp).stage == "scheduled") confirmPlan(s1, aw.opp, m, false) else s1, m, "reply", aw.opp, false)
      } else {
        // A cancel with no slot: the first scheduled opportunity where the member is "yes" (N:798-801).
        val sched = OPP_ORDER.select(o => op(s, o).stage == "scheduled" and stat(s, o, m) == "yes")
        if (intent == "cancel" and sched.length() > 0) handleDrop(s, m, sched[0], true, env)
        else {
          val fbKind = Set("fb_good", "fb_other_noshow", "fb_self_noshow").contains(intent)
          if ((aw.kind == "feedback" and intent != "ack") or fbKind) {
            val o = if (aw.kind == "feedback") aw.opp else feedbackDue(s, m)
            if (o != "") onFeedback(putM(s, m, { ...mm(s, m), aw: NO_AW }), m, o, intent) else s
          } else s
        }
      }
    }
  }

  // ---------------------------------------------------------------- the tick (N:3263)
  pure def defValid(s: S, d: Def): bool = {
    val x = op(s, d.opp)
    if (d.kind == "reveal") x.stage == "scheduled" and x.status.get(d.to) == "yes" and s.now < x.meetingAt
    else if (d.kind == "drop_notice") x.stage != "gone" and s.now < x.meetingAt
    else true
  }

  pure def deliverDeferred(s: S, env: Env): S = {
    val waiting = s.deferred
    waiting.fold({ ...s, deferred: Set() }, (acc, d) => {
      if (mm(acc, d.to).forgotten) acc
      else if (not(defValid(acc, d))) acc            // N:3274: dropped, no onRefused
      else if (not(env.openW.contains(d.to))) pushDef(acc, d.kind, d.opp, d.to)
      else {
        val about = d.kind == "reveal" or d.kind == "feedback"
        val r = sendGate(acc, d.to, d.kind, "logistics", about, false, env)
        if (r == "sent") {
          val a1 = collect(acc, d.to, d.kind, d.opp, false)
          if (d.kind == "reveal") onSentReveal(a1, d.opp, d.to)
          else if (d.kind == "feedback") expectSlot(a1, d.to, { kind: "feedback", opp: d.opp, at: a1.now, clarified: false })
          else if (d.kind == "none_yet") putO(a1, d.opp, { ...op(a1, d.opp), released: op(a1, d.opp).released.union(Set(d.to)) })
          else putO(a1, d.opp, { ...op(a1, d.opp), cancelHeard: op(a1, d.opp).cancelHeard.union(Set(d.to)) })
        }
        else if (r == "deferred") pushDef(acc, d.kind, d.opp, d.to)
        else if (d.kind == "reveal" and op(acc, d.opp).stage == "scheduled" and stat(acc, d.opp, d.to) == "yes") handleDrop(acc, d.to, d.opp, false, env)
        else acc
      }
    })
  }

  // refreshUnanswered (N:3323): two initial invites unanswered for 72 h move the member to only-when-I-ask.
  pure def refreshUnanswered(s: S): S =
    MEMBERS.fold(s, (acc, m) => {
      val x = mm(acc, m)
      val n = x.asks.select(t => acc.now - t >= UNANSWERED_AFTER).length()
      if (n >= UNANSWERED_LIMIT and not(x.onlyWhenAsked)) putM(acc, m, { ...x, onlyWhenAsked: true }) else acc
    })

  pure def finalize(s: S, o: str): S = {
    val x = op(s, o)
    val going = partsOrdered(s, o).select(p => x.status.get(p) == "yes" and x.bookedAt.get(p) >= 0)
    def said(p: str): bool = x.post.get(p) != ""
    def vouched(p: str): bool = going.select(q => q != p and x.post.get(q) == "came").length() > 0
    def present(p: str): bool = x.post.get(p) == "came" or x.post.get(p) == "came_other" or (x.post.get(p) != "self_noshow" and vouched(p))
    def reported(p: str): bool = going.select(q => q != p and x.post.get(q) == "came_other").length() > 0
    // N:2771-2774: a reported no-show who did not answer counts once here.
    val nsc = going.foldl(x.noShowCount, (acc, p) => if (not(present(p)) and not(said(p)) and reported(p)) acc.set(p, acc.get(p) + 1) else acc)
    val s1 = putO(s, o, { ...x, finalized: true, noShowCount: nsc })
    if (x.requester != "" and present(x.requester) and going.select(p => p != x.requester and present(p)).length() > 0
        and s1.req.outcome != "fulfilled") { ...s1, req: { ...s1.req, outcome: "fulfilled" } }
    else s1
  }

  pure def advance(s: S, o: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage == "review" and s.now >= x.review.deadline) {
      // Missed its SLA: expires instead of being sent late (PRD 32.8).
      close(putO(s, o, { ...x, review: { ...x.review, decision: "expired", decidedAt: s.now } }), o, "review expired", env)
    } else if (x.stage == "probing") {
      val s1 = partsOrdered(s, o).foldl(s, (acc, p) => {
        val y = op(acc, o)
        if (y.stage != "probing" or y.status.get(p) != "probing") acc
        else {
          val due = if (y.contacted.contains(p)) y.sentAt.get(p) + PROBE_TTL else y.turnAt.get(p) + PROBE_WAIT
          if (acc.now < due) acc
          // N:3378: they said yes and were offered other times: no answer keeps the yes.
          else if (y.timeRetry.contains(p)) setStat(acc, o, p, "available")
          else {
            val a1 = if (y.contacted.contains(p)) putO(acc, o, { ...y, expiredSilent: y.expiredSilent.union(Set(p)) }) else acc
            replaceOrClose(setStat(clearAwFor(a1, p, o), o, p, "unavailable"), o, p, env)
          }
        }
      })
      advanceProbes(s1, o, env)
    } else if (x.stage == "scheduled") {
      // Silence for 48 hours after the booked plan reached them (or the start) confirms it (N:3389-3393).
      val s1 = ORDER.foldl(s, (acc, p) => {
        val y = op(acc, o)
        if (y.bookedTold.contains(p) and y.bookedAt.get(p) >= 0 and (acc.now - y.bookedAt.get(p) >= OPT_OUT_HOURS or acc.now >= y.meetingAt))
          confirmPlan(acc, o, p, true) else acc
      })
      // Reminders (N:3394-3404): inside the member's allowed window in the day before the meeting. The
      // window oracle stands for "at T-4h, or the last allowed tick before it".
      val s1r = partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val y = op(acc, o)
        if (y.status.get(p) != "yes" or y.reminded.contains(p) or acc.now >= y.meetingAt or acc.now < y.meetingAt - 24 or not(env.openW.contains(p))) acc
        else {
          val a1 = putO(acc, o, { ...y, reminded: y.reminded.union(Set(p)) })
          if (sendGate(a1, p, "reminder", "logistics", true, false, env) == "sent") collect(a1, p, "reminder", o, false) else a1
        }
      })
      val y = op(s1r, o)
      if (y.feedbackSent or s1r.now < y.meetingAt + FEEDBACK_AFTER) s1r
      else {
        val s2 = putO(s1r, o, { ...y, feedbackSent: true, stage: "done", everTerminal: true })
        partsOrdered(s2, o).foldl(s2, (acc, p) =>
          if (stat(acc, o, p) != "yes") acc
          else {
            val r = sendGate(acc, p, "feedback", "logistics", true, false, env)
            if (r == "sent") expectSlot(collect(acc, p, "feedback", o, false), p, { kind: "feedback", opp: o, at: acc.now, clarified: false })
            else if (r == "deferred") pushDef(acc, "feedback", o, p)
            else acc
          })
      }
    } else if (x.stage == "done" and not(x.finalized)) {
      val going = partsOrdered(s, o).select(p => x.status.get(p) == "yes")
      if (s.now >= x.meetingAt + FINALIZE_AFTER or going.foldl(true, (b, p) => b and x.post.get(p) != "")) finalize(s, o) else s
    } else s
  }

  pure def expireSlots(s: S): S =
    MEMBERS.fold(s, (acc, m) => {
      val aw = mm(acc, m).aw
      val end = if (aw.kind == "booked") acc.now - aw.at > OPT_OUT_HOURS or acc.now >= op(acc, aw.opp).meetingAt
                else aw.kind != "probe" and aw.kind != "none" and acc.now - aw.at > SLOT_EXPIRY
      if (end) putM(acc, m, { ...mm(acc, m), aw: NO_AW }) else acc
    })

  // ================================================================ state and actions
  var s: S

  action init = s' = S0

  // newOpp + submit (N:2047, 2096): every opportunity goes to review first. The engine and the request
  // search propose only eligible members (eligible, busy).
  action submit(o: str): bool = {
    val x = op(s, o)
    all {
      x.stage == "absent",
      x.parts.forall(p => eligible(s, p, o)),
      x.requester == "" or s.req.outcome == "" or s.req.outcome == "none",
      val alts = x.alts.filter(a => eligible(s, a, o))
      val s1 = putO(s, o, { ...x, stage: "review", alts: alts,
                            status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "queued" else "out"),
                            review: { ...x.review, deadline: s.now + REVIEW_SLA } })
      val s2 = if (x.requester != "") { ...s1, req: { ...s1.req, outcome: "probing" } } else s1
      s' = { ...s2, last: L("submit", o, "", "") },
    }
  }

  // decide(approve) (N:1889-1928). reviewBlock (N:1941) and approvalCheck (N:1987) have no deadline check.
  action approve(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      x.stage == "review", x.review.decision == "",
      x.parts.forall(p => not(mm(s, p).minor) and not(mm(s, p).forgotten)), // reviewBlock refuses otherwise
      val s1 = putO(s, o, { ...x, review: { ...x.review, decision: "approve", decidedAt: s.now } })
      val bad = x.parts.exists(p => not(eligible(s1, p, o)))
      val s2 = if (bad) close(putO(s1, o, { ...op(s1, o), review: { ...op(s1, o).review, invalidated: true } }), o, "invalidated", env)
               else advanceProbes(putO(s1, o, { ...op(s1, o), stage: "probing",
                       status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "queued" else "out") }), o, env)
      s' = { ...s2, last: L("approve", o, "", "") },
    }
  }

  action reject(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      x.stage == "review", x.review.decision == "",
      s' = { ...close(putO(s, o, { ...x, review: { ...x.review, decision: "reject", decidedAt: s.now } }), o, "rejected in review", env), last: L("reject", o, "", "") },
    }
  }

  // probe() (N:2154) at a moment the member's send window is open. send() with noDefer and the probe hook:
  // onSent sets awaiting with no expect() (N:4055); onRefused replaces or closes (N:4061).
  action probeSend(o: str, m: str, env: Env): bool = {
    val x = op(s, o)
    all {
      x.stage == "probing", x.parts.contains(m), x.status.get(m) == "probing", not(x.contacted.contains(m)),
      env.openW.contains(m),
      val invite = x.requester != m
      val r = sendGate(s, m, "probe", if (invite) "slot" else "logistics", true, invite, env)
      val s2 = if (r == "sent") {
                 val s1 = collect(s, m, "probe", o, invite)
                 val y = op(s1, o)
                 putM(putO(s1, o, { ...y, contacted: y.contacted.union(Set(m)), sentAt: y.sentAt.set(m, s1.now) }), m,
                      { ...mm(s1, m), aw: { kind: "probe", opp: o, at: s1.now, clarified: false } })
               } else advanceProbes(replaceOrClose(setStat(s, o, m, "unavailable"), o, m, env), o, env)
      s' = { ...s2, last: L("probeSend", o, m, r) },
    }
  }

  // An inbound text from the member (onInbound N:595, handleInbound N:673).
  action answer(m: str, intent: str, env: Env): bool = {
    val x = mm(s, m)
    all {
      not(x.forgotten), not(x.optedOut),
      // A post-meeting answer ("it was great", "he never showed") comes only from a member who had a meeting.
      Set("fb_good", "fb_other_noshow", "fb_self_noshow").contains(intent)
        implies OPPS.exists(o => op(s, o).feedbackSent and op(s, o).status.get(m) == "yes"),
      val before = x.outbound
      val s1 = heardFrom(s, m)
      // Ghost: what the member means. A no or a cancel takes back an earlier yes (status "available" while
      // the opportunity still probes), and asks to leave a booked plan.
      val s2 = OPP_ORDER.foldl(s1, (acc, o) => {
        val y = op(acc, o)
        if (not(Set("no", "cancel").contains(intent))) acc
        else if (y.stage == "probing" and y.status.get(m) == "available") putO(acc, o, { ...y, withdrawn: y.withdrawn.union(Set(m)) })
        else if (y.stage == "scheduled" and y.status.get(m) == "yes") putO(acc, o, { ...y, cancelAsked: y.cancelAsked.union(Set(m)) })
        else acc
      })
      s' = { ...route(s2, m, intent, before, env), last: L("answer", "", m, intent) },
    }
  }

  // STOP (N:675): heardFrom first (N:615), then dropMember.
  action stop(m: str, env: Env): bool = all {
    not(mm(s, m).forgotten), not(mm(s, m).optedOut),
    val s1 = heardFrom(s, m)
    s' = { ...dropMember(putM(s1, m, { ...mm(s1, m), optedOut: true }), m, "opted out", env), last: L("stop", "", m, "") },
  }

  // START (N:676).
  action start(m: str): bool = all {
    not(mm(s, m).forgotten), mm(s, m).optedOut,
    val s1 = heardFrom(s, m)
    s' = { ...collect(putM(s1, m, { ...mm(s1, m), optedOut: false }), m, "reply", "", false), last: L("start", "", m, "") },
  }

  // A minor signal or a record age under 18 (N:717-722, syncMember N:4430): minor, then dropMember.
  action becomeMinor(m: str, env: Env): bool = all {
    not(mm(s, m).forgotten), not(mm(s, m).minor),
    s' = { ...dropMember(putM(s, m, { ...mm(s, m), minor: true }), m, "minors policy", env), last: L("minor", "", m, "") },
  }

  // Leave the app or delete (service forget -> Network.forget, N:913): declined, requests gone, dropMember,
  // then every opportunity that names the member is deleted.
  action forget(m: str, env: Env): bool = all {
    not(mm(s, m).forgotten),
    val s1 = putM(s, m, { ...mm(s, m), forgotten: true })
    val s2 = if (m == "a") { ...s1, req: { outcome: "", toldNone: false } } else s1
    val s3 = dropMember(s2, m, "declined", env)
    val s4 = OPP_ORDER.foldl(s3, (acc, o) => {
      val y = op(acc, o)
      if (y.stage != "absent" and (y.parts.contains(m) or y.requester == m)) putO(acc, o, { ...y, stage: "gone", everTerminal: true })
      else putO(acc, o, { ...y, alts: y.alts.exclude(Set(m)) })
    })
    // N:940-948: slots on a deleted opportunity end; the member state goes; deferred sends to them, or about
    // them (reveal and feedback carry `about`), go. A drop notice has no `about` and stays (N:4105).
    val s5 = MEMBERS.fold(s4, (acc, p) => {
      val aw = mm(acc, p).aw
      if (p == m or (aw.kind != "none" and aw.opp != "" and op(acc, aw.opp).stage == "gone")) putM(acc, p, { ...mm(acc, p), aw: NO_AW }) else acc
    })
    val s6 = { ...s5, deferred: s5.deferred.filter(d => d.to != m and not((d.kind == "reveal" or d.kind == "feedback") and op(s5, d.opp).parts.contains(m))) }
    s' = { ...s6, last: L("forget", "", m, "") },
  }

  // The clock moves between two ticks: units read clock.now(), and withTickLock skips a tick while another
  // holder has the lock (runtime.ts). Review expiry runs only in a tick (N:3345).
  action elapse(dt: int): bool = all {
    s' = { ...s, now: s.now + dt, last: { act: "elapse", o: "", m: "", x: "", dt: dt } },
  }

  // The service tick under the lock (N:3263).
  action tick(dt: int, env: Env): bool = all {
    val s1 = deliverDeferred({ ...s, now: s.now + dt }, env)
    val s2 = refreshUnanswered(s1)
    val s3 = OPP_ORDER.foldl(s2, (acc, o) => advance(acc, o, env))
    s' = { ...expireSlots(s3), last: { act: "tick", o: "", m: "", x: "", dt: dt } },
  }

  // The outbound queue (packages/blooio/src/outbound-queue.ts) decides each collected message later:
  // sent, held for an answer (the line's unanswered cap, :398-401) or refused.
  action queueDecide(g: Msg, q: str): bool = all {
    s.msgs.contains(g), g.q == "pending",
    s' = { ...s, msgs: s.msgs.exclude(Set(g)).union(Set({ ...g, q: q })), last: L("queue", g.kind, g.to, q) },
  }

  // The scheduler. Destructive actions (reject, STOP, a minor signal, a leave, a clock jump with no tick)
  // take a roll so that the random simulation also reaches the long consent path; every behaviour stays
  // reachable. The send window is often open for everyone, and the intro budget is rarely spent.
  action step = {
    nondet roll = oneOf(0.to(9))
    nondet wide = oneOf(Set(true, false))
    nondet someW = oneOf(powerset(MEMBERS))
    nondet lead = oneOf(Set(8, 30))
    val env: Env = { openW: if (wide) MEMBERS else someW, budget: roll != 5, lead: lead }
    nondet o = oneOf(OPPS)
    nondet m = oneOf(MEMBERS)
    nondet intent = oneOf(INTENTS)
    nondet dt = oneOf(Set(1, 6, 13, 27, 49))
    any {
      submit(o),
      approve(o, env),
      all { roll == 0, reject(o, env) },
      probeSend(o, m, env),
      answer(m, intent, env),
      answer(m, "yes", env),
      all { roll == 1, stop(m, env) },
      start(m),
      all { roll == 2, becomeMinor(m, env) },
      all { roll == 3, forget(m, env) },
      tick(dt, env),
      all { roll == 4, elapse(dt) },
      all { s.msgs != Set(), nondet g = oneOf(s.msgs) nondet q = oneOf(Set("delivered", "held", "refused")) queueDecide(g, q) },
    }
  }

  // ================================================================ safety
  // Each invariant names the rule it comes from. A defect it shows is named with its register id.

  // AGENTS.md (code invariants): every proactive proposal and every member request goes through human
  // review before any member is contacted. N:2063 begin() has one caller chain, decide().
  val reviewGate = OPPS.forall(o => {
    val x = op(s, o)
    (Set("probing", "scheduled", "done").contains(x.stage) or x.contacted != Set())
      implies (x.review.decision == "approve" and not(x.review.invalidated))
  })

  // PRD 32.8 and docs/network.md 2: an item that missed its SLA expires; "it is never sent late".
  // SD-009: decide() (N:1889) and reviewBlock() (N:1941) have no deadline check; only advance() (N:3345) has.
  val decidedBeforeDeadline = OPPS.forall(o => {
    val x = op(s, o)
    x.review.decision == "approve" implies x.review.decidedAt < x.review.deadline
  })

  // AGENTS.md decision 11: only answer "yes" is consent; a counter is not a yes. PRD consent flow: names
  // go out only after every member said yes, and a member can take a yes back before the reveal.
  // SD-041 (counter = yes, N:2300 via classify.ts:719), SD-075 (a later no is ignored), SD-076 (a no after
  // a silent time retry is swallowed), SD-077 (a feedback answer read as a yes to a new probe).
  val namesAfterAllYes = OPPS.forall(o => {
    val x = op(s, o)
    x.revealSent != Set() implies x.parts.forall(p => CONSENT.contains(x.accepted.get(p)) and not(x.withdrawn.contains(p)))
  })

  // AGENTS.md decision 11: a counter-offer (or an answer to another question) never makes a member
  // "available" (the yes-hold, N:2300). SD-041, SD-077.
  val counterIsNotYes = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "available" and x.contacted.contains(p)) implies CONSENT.contains(x.accepted.get(p)))
  })

  // The slot routes the consent reply (N:766), so it is consent state. Code comment N:4133: the slot keeps
  // a pending yes/no. A probe slot points at a probe that waits for this member. SD-048 (a replaced
  // prober keeps the slot, N:2580), and the time-retry expiry that keeps it (N:3378).
  val slotOwnerAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "probe" implies (op(s, aw.opp).stage == "probing" and op(s, aw.opp).parts.contains(m)
      and op(s, aw.opp).status.get(m) == "probing")
  })

  // The booked slot routes "can't make it" to the booked plan (N:782-786); it belongs to a booked plan.
  // SD-139 (second part): handleDrop's own close path (N:2518) clears only the dropping member's slot, so
  // the other member keeps "booked" for a closed plan and their next "yes" is thanked for it.
  val bookedSlotAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "booked" implies op(s, aw.opp).stage == "scheduled"
  })

  // Code comment N:4133-4135: "can't this week" must reach the probe. While a probe waits for the
  // member's answer, the slot points at it. SD-043 (the posting writer overwrites it, N:4636).
  val noLostAnswer = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "probing" and x.contacted.contains(p)) implies (mm(s, p).aw.kind == "probe" and mm(s, p).aw.opp == o))
  })

  // AGENTS.md founder decision 1 and core/policy.ts: members aged 13-17 are never matched or connected.
  val minorNever = MEMBERS.forall(m => mm(s, m).minor implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m)))))

  // AGENTS.md STOP: an opted-out member is out of everything open (dropMember, N:675).
  val stopWins = MEMBERS.forall(m => mm(s, m).optedOut implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m)))))

  // Code comment N:4083 and N:3389: silence for 48 hours confirms a booked plan only after "the booked plan
  // reached them". SD-006: the Network believes the reveal went out when it was only collected; the queue can
  // hold or refuse it (outbound-queue.ts:398-401), and silence still confirms.
  val confirmedImpliesDelivered = OPPS.forall(o => op(s, o).silent.forall(m =>
    s.msgs.exists(g => g.kind == "reveal" and g.opp == o and g.to == m and g.q == "delivered")))

  // PRD F28 and outreach.ts:23: silence counts only for an invite the member got. SD-030: a probe that the
  // queue refused or held still expires as the member's silence (N:3381) and counts toward the pause.
  val silenceOnlyAfterDelivery = OPPS.forall(o => op(s, o).expiredSilent.forall(m =>
    s.msgs.exists(g => g.kind == "probe" and g.opp == o and g.to == m and g.q == "delivered")))

  // N:2527: closed and done are terminal (gone: deleted by forget).
  val terminalStable = OPPS.forall(o => op(s, o).everTerminal implies TERMINAL.contains(op(s, o).stage))

  // Request comment N:388: "booked": a meeting is set. SD-139: handleDrop closes on its own path (N:2518)
  // and the request stays "booked" with no meeting, never retried (N:3695).
  val requestNotStuck = s.req.outcome == "booked" implies Set("scheduled", "done").contains(op(s, "o1").stage)

  // PRD F11 and N:2340-2341: when a booked plan is off, the others who were told hear it is off.
  // SD-249 (the drop notice is refused by the streak rule, no retry), SD-248 (a leave or delete deletes the
  // opportunity and the deferred notice is dropped as invalid, N:3274).
  val cancelReachesTold = OPPS.forall(o => {
    val x = op(s, o)
    (Set("closed", "gone").contains(x.stage) and x.closedFrom == "scheduled") implies x.wasTold.forall(m =>
      x.droppedBy.contains(m) or mm(s, m).forgotten or mm(s, m).optedOut or x.cancelHeard.contains(m)
      or s.deferred.exists(d => d.opp == o and d.to == m and (d.kind == "drop_notice" or d.kind == "declined_quiet") and defValid(s, d)))
  })

  // PRD F29: "Partial acceptances are released politely". SD-263: close() tells only when the plan was
  // booked (N:2540); a member who said yes while the other said no hears nothing.
  val partialAcceptReleased = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "closed" and x.closedFrom == "probing") implies x.parts.forall(p =>
      // A member who left, opted out or is a minor gets no release (a minor gets the minor notice instead).
      (x.status.get(p) == "available" and CONSENT.contains(x.accepted.get(p)) and not(mm(s, p).forgotten) and not(mm(s, p).optedOut)
        and not(mm(s, p).minor))
        implies (x.released.contains(p) or s.deferred.exists(d => d.opp == o and d.to == p and d.kind == "none_yet")))
  })

  // engine world.ts:160 reads interaction outcomes; a member's "no" is a decline. SD-140: close() records
  // "declined" only for reason "declined" (N:2559), so a probe a member turned down is "expired".
  val declineRecorded = OPPS.forall(o => op(s, o).outcomeRec == "expired" implies op(s, o).saidNo == Set())

  // network-consent-17 (N:2770 comment): a reported no-show counts once. SD-328: finalize (N:2773) counts it
  // at +4 days, then a late self no-show answer (N:2622, feedbackDue until +7 days) counts it again.
  val noShowOnce = OPPS.forall(o => MEMBERS.forall(m => op(s, o).noShowCount.get(m) <= 1))

  // The booked text says "Reply if your plans change" (copy.ts:79). A member's "no" to a booked plan takes
  // them out of it. SD-259: after the 48-hour slot (or an "ok") a plain "no" is not read as a cancel.
  val bookedNoHonored = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "scheduled" implies x.cancelAsked.forall(m => x.status.get(m) != "yes")
  })

  // N:2405-2408: everyone said yes, so the plan is booked and each member is told once; the reveal hook's
  // onRefused (N:4087) says "the plan cannot stand without them". SD-146: a deferred reveal that goes invalid
  // at the meeting time is dropped (N:3274) and the plan stays booked for a member who was never told.
  val bookedMembersTold = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "scheduled" and s.now >= x.meetingAt) implies x.parts.forall(p => x.status.get(p) == "yes" implies x.bookedTold.contains(p))
  })

  val safety = and {
    reviewGate, decidedBeforeDeadline, namesAfterAllYes, counterIsNotYes, slotOwnerAlive, noLostAnswer,
    minorNever, stopWins, confirmedImpliesDelivered, silenceOnlyAfterDelivery, terminalStable,
    requestNotStuck, cancelReachesTold, partialAcceptReleased, declineRecorded, noShowOnce, bookedNoHonored,
    bookedMembersTold, bookedSlotAlive,
  }

  // The invariants that the model expects to hold on the current code (no register defect).
  val safetyHolds = and { reviewGate, minorNever, stopWins, terminalStable }

  // ================================================================ witnesses (must be reachable)
  val witness_revealed = OPPS.forall(o => op(s, o).revealSent == Set())
  val witness_feedbackAnswered = OPPS.forall(o => not(op(s, o).stage == "done" and op(s, o).feedbackFrom != Set()))
  val witness_rejectNoContact = OPPS.forall(o => not(op(s, o).review.decision == "reject" and op(s, o).stage == "closed" and op(s, o).contacted == Set()))
  val witness_confirmedBySilence = OPPS.forall(o => op(s, o).silent == Set())
  val witness_requestFulfilled = s.req.outcome != "fulfilled"

  // ================================================================ run tests (traces from the code)
  pure val ALL_OPEN: Env = { openW: MEMBERS, budget: true, lead: 30 }

  // Approve, both yes, reveal, the meeting, feedback (docs/network.md 4; the mini.ts happy path).
  run happyPathTest =
    init
      .then(submit("o1"))
      .then(approve("o1", ALL_OPEN))
      .then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", ALL_OPEN))
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent == Set("a", "b") and s.req.outcome == "booked" and safety)
      .then(tick(31, ALL_OPEN))
      .then(tick(6, ALL_OPEN))
      .expect(op(s, "o1").stage == "done" and mm(s, "a").aw.kind == "feedback")
      .then(answer("a", "fb_good", ALL_OPEN))
      .then(answer("b", "fb_good", ALL_OPEN))
      .then(tick(1, ALL_OPEN))
      .expect(op(s, "o1").finalized and s.req.outcome == "fulfilled" and safetyHolds)

  // A reject closes the item and nobody is contacted (N:1928-1932).
  run rejectTest =
    init.then(submit("o2")).then(reject("o2", ALL_OPEN))
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").contacted == Set() and s.msgs == Set() and safety)

  // SD-009: the clock passes the deadline, no tick runs, a reviewer approves, and the probe goes out.
  run lateApprovalTest =
    init.then(submit("o2")).then(elapse(13)).then(approve("o2", ALL_OPEN)).then(probeSend("o2", "a", ALL_OPEN))
      .expect(op(s, "o2").stage == "probing" and not(decidedBeforeDeadline))

  // SD-041: "how about next week instead?" is read as a yes with no time picked; silence keeps the yes
  // (N:3378); the partner says yes; both get the names.
  run counterOfferTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "counter", ALL_OPEN))
      .then(tick(27, ALL_OPEN))
      .expect(not(counterIsNotYes))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", ALL_OPEN))
      .expect(op(s, "o1").revealSent == Set("a", "b") and not(namesAfterAllYes))

  // SD-075: a yes, then "actually no, sorry"; nothing changes, the partner says yes, names go out.
  run withdrawnYesTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(answer("a", "no", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", ALL_OPEN))
      .expect(op(s, "o1").stage == "scheduled" and not(namesAfterAllYes))

  // SD-048: b is probing, b sends STOP, c replaces b, b sends START: b keeps a dead probe slot.
  run replacedProberTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(stop("b", ALL_OPEN))
      .then(start("b"))
      .expect(op(s, "o1").parts == Set("a", "c") and mm(s, "b").aw.kind == "probe" and not(slotOwnerAlive))

  // SD-139: a booked request, then the requester cancels: handleDrop closes the item, the request stays booked.
  run requestStuckTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", ALL_OPEN))
      .then(answer("a", "cancel", ALL_OPEN))
      .expect(op(s, "o1").stage == "closed" and s.req.outcome == "booked" and not(requestNotStuck)
              and mm(s, "b").aw.kind == "booked" and not(bookedSlotAlive))

  // SD-006: the reveal to b is collected, the queue holds it (b's line streak), 48 hours of silence confirm it.
  run silentConfirmTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", { ...ALL_OPEN, lead: 72 }))
      .then(queueDecide({ kind: "reveal", opp: "o1", to: "b", at: 0, q: "pending" }, "held"))
      .then(tick(49, ALL_OPEN))
      .expect(op(s, "o1").silent.contains("b") and not(confirmedImpliesDelivered))

  // The common prefix: o1 is booked for a and b (lead 30 unless given).
  action bookO1(lead: int): bool =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", { ...ALL_OPEN, lead: lead }))

  // SD-249: both get the reminder (3 messages since their last text); a cancels; the drop notice to b is
  // refused by the streak rule and nothing retries it. b still believes the plan is on.
  run cancelRefusedTest =
    bookO1(30).then(tick(10, ALL_OPEN))
      .expect(mm(s, "b").outbound == 3)
      .then(answer("a", "cancel", ALL_OPEN))
      .expect(op(s, "o1").stage == "closed" and not(op(s, "o1").cancelHeard.contains("b")) and not(cancelReachesTold))

  // SD-248: b is in quiet hours; a leaves the app; the drop notice to b is deferred, the opportunity is
  // deleted, and the deferred notice is now invalid (it is dropped at the next tick).
  run leaveInQuietHoursTest =
    bookO1(30).then(forget("a", { ...ALL_OPEN, openW: Set("a", "c") }))
      .expect(op(s, "o1").stage == "gone" and not(cancelReachesTold))
      .then(tick(6, ALL_OPEN))
      .expect(s.deferred == Set() and not(op(s, "o1").cancelHeard.contains("b")))

  // SD-328: a says b never showed; finalize at +4 days counts b's no-show; b's late "I couldn't make it"
  // (feedbackDue until +7 days) counts it again.
  run noShowTwiceTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(tick(6, ALL_OPEN))
      .then(answer("a", "fb_other_noshow", ALL_OPEN))
      .then(tick(96, ALL_OPEN))
      .expect(op(s, "o1").finalized and op(s, "o1").noShowCount.get("b") == 1)
      .then(answer("b", "fb_self_noshow", ALL_OPEN))
      .expect(op(s, "o1").noShowCount.get("b") == 2 and not(noShowOnce))

  // SD-259: the booked slot ends after 48 hours; a plain "no, sorry" to the booked plan is then ignored.
  run lateNoTest =
    bookO1(72).then(tick(49, ALL_OPEN))
      .expect(mm(s, "a").aw.kind == "none")
      .then(answer("a", "no", ALL_OPEN))
      .expect(op(s, "o1").stage == "scheduled" and stat(s, "o1", "a") == "yes" and not(bookedNoHonored))

  // SD-077: after the o1 meeting, a has the feedback slot; the o2 probe overwrites it (no expect(), N:4055);
  // "it was great!" is read as a yes to o2.
  run feedbackAsYesTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(tick(6, ALL_OPEN))
      .expect(mm(s, "a").aw.kind == "feedback")
      // "ok" is not an answer to "How did it go?" (N:805-812): the slot stays, and the streak resets.
      .then(answer("a", "ack", ALL_OPEN))
      .then(submit("o2")).then(approve("o2", ALL_OPEN)).then(probeSend("o2", "a", ALL_OPEN))
      .expect(mm(s, "a").aw.kind == "probe")
      .then(answer("a", "fb_good", ALL_OPEN))
      .expect(stat(s, "o2", "a") == "available" and not(counterIsNotYes))

  // SD-043: a job post read-back takes the slot of a pending probe (N:4636); the probe answer path is lost.
  run postingTakesSlotTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "job_post", ALL_OPEN))
      .expect(mm(s, "a").aw.kind == "posting" and not(noLostAnswer))

  // SD-030: the queue refuses the probe; 26 hours later it expires as a's silence.
  run refusedProbeSilenceTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(queueDecide({ kind: "probe", opp: "o1", to: "a", at: 0, q: "pending" }, "refused"))
      .then(tick(27, ALL_OPEN))
      .expect(op(s, "o1").expiredSilent.contains("a") and not(silenceOnlyAfterDelivery))

  // SD-263 and SD-140: o2, a says yes, c says no, no alternate is free: the item closes; a hears nothing,
  // and the interaction is recorded as "expired" with nobody who declined.
  run partnerNoTest =
    init.then(stop("b", ALL_OPEN)).then(submit("o2")).then(approve("o2", ALL_OPEN)).then(probeSend("o2", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o2", "c", ALL_OPEN))
      .then(answer("c", "no", ALL_OPEN))
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").outcomeRec == "expired"
              and not(partialAcceptReleased) and not(declineRecorded))

  // SD-146: b is in quiet hours at the reveal; the deferred reveal waits; at the meeting time it is invalid
  // and dropped; the plan stays booked and b was never told.
  run deferredRevealTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", { openW: Set("a"), budget: true, lead: 8 }))
      .expect(s.deferred == Set({ kind: "reveal", opp: "o1", to: "b" }))
      .then(tick(6, { openW: Set("a"), budget: true, lead: 8 }))
      .then(tick(2, ALL_OPEN))
      .expect(s.deferred == Set() and op(s, "o1").stage == "scheduled" and not(bookedMembersTold))

  // SD-076: "yes, but none of those times", silence for 26 hours keeps the yes (N:3378) and the probe slot;
  // then "no thanks" clears the slot and onProbeAnswer returns (status "available"); the partner says yes.
  run noAfterRetryTest =
    init.then(submit("o1")).then(approve("o1", ALL_OPEN)).then(probeSend("o1", "a", ALL_OPEN))
      .then(answer("a", "yes_other_times", ALL_OPEN))
      .then(tick(27, ALL_OPEN))
      .expect(stat(s, "o1", "a") == "available" and mm(s, "a").aw.kind == "probe" and not(slotOwnerAlive))
      .then(answer("a", "no", ALL_OPEN))
      .then(probeSend("o1", "b", ALL_OPEN))
      .then(answer("b", "yes", ALL_OPEN))
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent.contains("a") and not(namesAfterAllYes))
}
