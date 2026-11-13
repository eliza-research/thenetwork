# Proposal, review, and response

## Story: Proposal, review, and response

A member needs staff review before contact and control over when The Network makes an introduction.

### Safety rules and reachability

Check review and deadlines, participant answers, name disclosure, STOP, and cancellation. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/opportunity.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=250 max-samples=8000 verify-steps=3
//
// The opportunity machines of the ConsentNetwork (docs/research/2026-11-07-state-machines.md section 6.6):
// opportunity-lifecycle, opp-participant-status, review-item, awaiting-slot, yes-hold,
// send-pipeline-and-deferred, reply-reader (as an oracle), send-belief, booked-attendance,
// member-request (one request), outreach-attention (the two-unanswered pause) and the tick.
//
// The model follows packages/network/src/network.ts AS IT IS on branch wave2/opportunity after the fixes
// (c06f633..25b54f1; the defect register ids are in docs/research/quint-findings/opportunity.md).
// "N:<line>" is a line in that file at 25b54f1 where a fix changed the code; other references are from
// ad67275 and can be up to about 55 lines lower than at 25b54f1. One action is one unit of work under the store lock (store.ts:263):
// an inbound message (onInbound), a staff decision (decide), a tick (tick), or one step of another actor
// (the outbound queue, the member record). The probe send is its own action: probe() defers a probe while
// the member's send window is closed, and tick() tries again (N:2165-2173), so other units run in between.
//
// Bounds: 3 members (a, b, c), 2 pair opportunities. o1 is a member request of a with b (alternate c);
// o2 is an engine intro of a with c (alternate b). Time is in hours.
// Oracles: the send window and quiet hours (env.openW), the intro budget (env.budget), the meeting lead
// time (env.lead), the outbound queue outcome (queueDecide), and the reply readers (readProbe, readYesNo).
// The readers are fixed maps from the member's real intent to the code's reading (classify.ts consentOf:
// a bare counter-offer is "unclear", SD-041); the evals/ corpora test the readers themselves.
//
// Ghost state (not in the code): what the member really meant (accepted, withdrawn, saidNo, cancelAsked),
// what really reached them (probeQ and revealQ: the queue outcome), and who was told what (revealSent, wasTold,
// cancelHeard, released, noticeRefused).
//
// Defects that this model reproduces are named on the invariant that shows them (SD-NNN, register in
// docs/research/2026-11-07-state-machines.md section 5). Findings: docs/research/quint-findings/opportunity.md.
//
// The model is kept small for Apalache (findings section 7):
//  - A unit runs its own light part in one action. The large helpers it calls (close, replaceOrClose,
//    advanceProbes and the reveal, handleDrop, the dropMember step for one opportunity, the tick's parts) are
//    jobs on a stack (`s.jobs`) that the job actions run one at a time, in the order of the calls in the code.
//    No other unit runs until the stack is empty (`idle`), so a unit is still atomic as in the code (one unit
//    under the store lock), and each helper is in the transition relation once. The invariants and the
//    witnesses are read only when the stack is empty. The jobs of a unit use the unit's oracles (`s.jobEnv`).
//  - The tick delivers its deferred sends one job at a time, in any order (the code goes in insertion order;
//    any order includes it).
//  - Messages are not kept one by one. The only messages that an invariant reads are the probe and the reveal
//    (at most one of each per opportunity and member), so each opportunity keeps their queue state
//    (`probeQ`, `revealQ`). `s.collected` counts the collected messages. A member keeps the times of the first
//    two unanswered invites only (`ask1`, `ask2`): the two-unanswered rule reads no more.
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
    noShowCounted: Set[str], noticeRefused: Set[str],
    everTerminal: bool,
    // The queue state of the probe and of the reveal to each member: "" (none), pending, held, delivered, refused.
    probeQ: str -> str, revealQ: str -> str
  }
  type MemSt = {
    optedOut: bool, minor: bool, forgotten: bool, aw: Aw, outbound: int,
    // The times of the first two proactive invites since the member's last text (-1: none).
    ask1: int, ask2: int,
    onlyWhenAsked: bool, noShows: int
  }
  type Req = { outcome: str, toldNone: bool }
  type Last = { act: str, o: str, m: str, x: str, dt: int }
  // A job: the rest of the current unit (see the header). kind: close, replace, probes, reveal, drop, dm,
  // forgetRest, deliver, refresh, adv, exp, expire. why: the close reason or the dropMember reason.
  type Job = { kind: str, o: str, m: str, why: str, ack: bool }
  type S = {
    now: int, opps: str -> OppSt, mem: str -> MemSt, req: Req,
    deferred: Set[Def], collected: int, last: Last,
    jobs: List[Job], jobEnv: Env, toDeliver: Set[Def]
  }

  pure def L(act: str, o: str, m: str, x: str): Last = { act: act, o: o, m: m, x: x, dt: 0 }
  pure def J(kind: str, o: str, m: str, why: str): Job = { kind: kind, o: o, m: m, why: why, ack: false }
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
    noShowCounted: Set(), noticeRefused: Set(),
    everTerminal: false, probeQ: strMap(""), revealQ: strMap("")
  }

  pure val MEM0: MemSt = {
    optedOut: false, minor: false, forgotten: false, aw: NO_AW, outbound: 0, ask1: -1, ask2: -1,
    onlyWhenAsked: false, noShows: 0
  }

  pure val S0: S = {
    now: 0,
    opps: Map("o1" -> template(Set("a", "b"), Set("c"), "a", "a"),
              "o2" -> template(Set("a", "c"), Set("b"), "a", "")),
    mem: MEMBERS.mapBy(_ => MEM0),
    req: { outcome: "", toldNone: false },
    deferred: Set(), collected: 0, last: L("init", "", "", ""),
    jobs: List(), jobEnv: { openW: Set(), budget: true, lead: 8 }, toDeliver: Set()
  }

  // ---------------------------------------------------------------- small helpers
  pure def op(s: S, o: str): OppSt = s.opps.get(o)
  pure def mm(s: S, m: str): MemSt = s.mem.get(m)
  pure def putO(s: S, o: str, x: OppSt): S = { ...s, opps: s.opps.set(o, x) }
  pure def putM(s: S, m: str, x: MemSt): S = { ...s, mem: s.mem.set(m, x) }
  pure def stat(s: S, o: str, m: str): str = op(s, o).status.get(m)
  pure def setStat(s: S, o: str, m: str, v: str): S = putO(s, o, { ...op(s, o), status: op(s, o).status.set(m, v) })
  pure def partsOrdered(s: S, o: str): List[str] = ORDER.select(p => op(s, o).parts.contains(p))
  /** Put jobs on top of the stack: they run first, in list order (a call in the code). */
  pure def push(s: S, js: List[Job]): S = { ...s, jobs: js.concat(s.jobs) }
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
    val a1 = if (proactive and x.ask1 < 0) s.now else x.ask1
    val a2 = if (proactive and x.ask1 >= 0 and x.ask2 < 0) s.now else x.ask2
    val s1 = { ...putM(s, m, { ...x, outbound: x.outbound + 1, ask1: a1, ask2: a2 }), collected: s.collected + 1 }
    if (kind == "probe") putO(s1, o, { ...op(s1, o), probeQ: op(s1, o).probeQ.set(m, "pending") })
    else if (kind == "reveal") putO(s1, o, { ...op(s1, o), revealQ: op(s1, o).revealQ.set(m, "pending") })
    else s1
  }

  pure def pushDef(s: S, kind: str, o: str, m: str): S = { ...s, deferred: s.deferred.union(Set({ kind: kind, opp: o, to: m })) }

  // Ghost: a notice (a cancellation, a release, "none yet") that send() refused. For a member who is still
  // reachable, only the line streak rule refuses it (canSendLogistics): SD-249, skipped.
  pure def noteRefused(s: S, o: str, m: str): S = putO(s, o, { ...op(s, o), noticeRefused: op(s, o).noticeRefused.union(Set(m)) })

  // A notice about o to m through send() with logistics timing: sent (mark it heard), deferred or refused.
  pure def sendNotice(s: S, m: str, kind: str, o: str, env: Env): S = {
    val r = sendGate(s, m, kind, "logistics", false, false, env)
    if (r == "sent") {
      val s1 = collect(s, m, kind, o, false)
      if (kind == "none_yet" or kind == "release") putO(s1, o, { ...op(s1, o), released: op(s1, o).released.union(Set(m)) })
      else putO(s1, o, { ...op(s1, o), cancelHeard: op(s1, o).cancelHeard.union(Set(m)) })
    }
    else if (r == "deferred") pushDef(s, kind, o, m)
    else noteRefused(s, o, m)
  }

  // owedAnswer (N:4662, SD-043): the yes or no this member still owes, other than on `except`: a probe that
  // went out and was not answered (first), or a booked plan they were told about and did not confirm.
  pure def owedAnswer(s: S, m: str, except: str): Aw = {
    val pr = OPP_ORDER.select(o => o != except and op(s, o).stage == "probing" and op(s, o).contacted.contains(m) and stat(s, o, m) == "probing")
    if (pr.length() > 0) { kind: "probe", opp: pr[0], at: op(s, pr[0]).sentAt.get(m), clarified: false }
    else {
      val bk = OPP_ORDER.select(o => o != except and op(s, o).stage == "scheduled" and stat(s, o, m) == "yes"
        and op(s, o).bookedTold.contains(m) and not(op(s, o).confirmed.contains(m)))
      if (bk.length() > 0) { kind: "booked", opp: bk[0], at: op(s, bk[0]).bookedAt.get(m), clarified: false } else NO_AW
    }
  }

  // probe() (N:2198-2201, SD-043 and SD-077): the probe waits while the member owes an answer on another
  // probe, or (when they owe nothing else) while "How did it go?" waits for their answer.
  pure def probeOwed(s: S, m: str, o: str): bool = {
    val owedOn = owedAnswer(s, m, o)
    if (owedOn.kind != "none") owedOn.kind == "probe" else mm(s, m).aw.kind == "feedback"
  }

  // expect() (N:4136): a pending probe or booked plan is never replaced by another kind.
  pure def expectSlot(s: S, m: str, aw: Aw): S = {
    val cur = mm(s, m).aw.kind
    if ((cur == "probe" or cur == "booked") and aw.kind != "probe" and aw.kind != "booked") s
    else putM(s, m, { ...mm(s, m), aw: aw })
  }

  // ---------------------------------------------------------------- close (N:2526-2561), a job
  pure def close(s: S, o: str, reason: str, env: Env): S = {
    val x = op(s, o)
    if (TERMINAL.contains(x.stage) or x.stage == "absent") s
    else {
      val wasReview = x.stage == "review"
      val wasProbing = x.stage == "probing" or wasReview
      val s1 = putO(s, o, { ...x, closedFrom: x.stage, closedReason: reason, stage: "closed", everTerminal: true })
      // Participants: clear their slot for this opportunity; tell the ones who said yes, when it was booked.
      // SD-263 (N:2587-2591): a yes to a probe that is not booked yet is released too, except the requester
      // (the request path tells them) and never on a close for the minors policy.
      val s2 = partsOrdered(s1, o).foldl(s1, (acc, p) => {
        val a1 = clearAwFor(acc, p, o)
        if (mm(a1, p).forgotten) a1
        else if (not(wasProbing) and stat(a1, o, p) == "yes" and reason != "blocked") sendNotice(a1, p, "declined_quiet", o, env)
        else if (wasProbing and p != x.requester and x.contacted.contains(p) and stat(a1, o, p) == "available"
                 and reason != "blocked" and reason != "minors policy") sendNotice(a1, p, "release", o, env)
        else a1
      })
      // The member request (N:2542-2557): a request still probing goes back to waiting.
      val req = x.requester
      val s3 = if (req != "" and s2.req.outcome == "probing") {
        val rm = mm(s2, req)
        val tell = not(rm.optedOut) and reason != "requester unavailable" and stat(s2, o, req) != "no"
        if (not(tell)) { ...s2, req: { ...s2.req, outcome: "none" } }
        else if (s2.req.toldNone) { ...s2, req: { ...s2.req, outcome: "none" } }
        else {
          // tellNoneYet (N:1655): told once (again only on a repeat ask, SD-266; the model has no repeat ask).
          sendNotice({ ...s2, req: { outcome: "none", toldNone: true } }, req, "none_yet", o, env)
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

  // ---------------------------------------------------------------- replaceOrClose (N:2368), a job
  // With one alternate the replacement cannot reveal at once: the alternate starts "queued".
  // SD-048 (N:2408-2410): the member who is out loses a slot that points at this opportunity.
  pure def replaceOrClose(s0: S, o: str, out: str): S = {
    val s = if (op(s0, o).stage == "probing") clearAwFor(s0, out, o) else s0
    val x = op(s, o)
    if (x.stage != "probing") s
    else if (x.requester == out) push(s, [J("close", o, "", "requester unavailable")])
    else {
      val stay = x.parts.exclude(Set(out))
      val cands = ORDER.select(a => x.alts.contains(a) and eligible(s, a, o))
      if (cands.length() > 0) {
        val alt = cands[0]
        val s1 = putO(s, o, { ...x, alts: Set(), parts: stay.union(Set(alt)),
                              first: if (x.first == out) alt else x.first,
                              status: x.status.set(out, "out").set(alt, "queued") })
        advanceTurns(s1, o)
      } else push(putO(s, o, { ...x, alts: Set() }), [J("close", o, "", "no one available")])
    }
  }

  // ---------------------------------------------------------------- handleDrop (N:2502), a job
  pure def handleDrop(s: S, m: str, o: str, ack: bool, env: Env): S = {
    val x0 = op(s, o)
    val s1 = putO(s, o, { ...x0, status: x0.status.set(m, "dropped"), droppedBy: x0.droppedBy.union(Set(m)) })
    val s2 = if (ack) collect(s1, m, "reply", o, false) else s1
    val s3 = clearAwFor(s2, m, o)
    val still = partsOrdered(s3, o).select(p => stat(s3, o, p) == "yes")
    // Only members who were told about the plan hear that it changed (N:2557). The drop_notice hook has no
    // onRefused (SD-249, skipped); it carries the meeting time (SD-248).
    val s4 = still.foldl(s3, (acc, p) =>
      if (not(op(acc, o).bookedTold.contains(p))) acc else sendNotice(acc, p, "drop_notice", o, env))
    // network.ts:2693: a group stays on only with 3 or more still going ("two who are left said yes to a
    // group, not to a meeting of two"). A pair: keep is false, so the opportunity closes on handleDrop's own
    // path (not close()).
    val keep = still.length() >= 3
    if (keep) s4
    else {
      val s5 = putO(s4, o, { ...op(s4, o), closedFrom: op(s4, o).stage, closedReason: "participant dropped", stage: "closed", everTerminal: true })
      // SD-139 (N:2560-2563): the requester still says yes (another member called it off): the request waits again.
      val x5 = op(s5, o)
      if (x5.requester != "" and stat(s5, o, x5.requester) == "yes" and s5.req.outcome == "booked") { ...s5, req: { ...s5.req, outcome: "none" } }
      else s5
    }
  }
  pure def dropJob(o: str, m: str, ack: bool): Job = { ...J("drop", o, m, ""), ack: ack }

  // ---------------------------------------------------------------- reveal (N:2411)
  pure def onSentReveal(s: S, o: str, m: str): S = {
    val s1 = expectSlot(s, m, { kind: "booked", opp: o, at: s.now, clarified: false })
    val x = op(s1, o)
    putO(s1, o, { ...x, bookedTold: x.bookedTold.union(Set(m)), bookedAt: x.bookedAt.set(m, s1.now),
                  revealSent: x.revealSent.union(Set(m)), wasTold: x.wasTold.union(Set(m)) })
  }

  /** The reveal to one participant (a job): the reveal fold's step in reveal() (N:2425). */
  pure def sendReveal(s: S, o: str, p: str, env: Env): S =
    if (op(s, o).stage != "scheduled" or stat(s, o, p) != "yes") s
    else {
      val r = sendGate(s, p, "reveal", "logistics", true, false, env)
      if (r == "sent") onSentReveal(collect(s, p, "reveal", o, false), o, p)
      else if (r == "deferred") pushDef(s, "reveal", o, p)
      else push(s, [dropJob(o, p, false)]) // the reveal hook's onRefused (N:4087)
    }

  pure def reveal(s: S, o: str, env: Env): S = {
    // Send-time re-check (N:2415-2424): reachable, about the others, and room on the Blooio streak.
    val bad = partsOrdered(s, o).select(p => {
      val x = mm(s, p)
      x.forgotten or x.optedOut or x.minor or x.outbound > 2
    })
    if (bad.length() > 0) push(setStat(s, o, bad[0], "unavailable"), [J("replace", o, bad[0], "")])
    else {
      val x = op(s, o)
      val s1 = putO(s, o, { ...x, stage: "scheduled", meetingAt: s.now + env.lead,
                            status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "yes" else x.status.get(k)) })
      val s2 = if (x.requester != "") { ...s1, req: { ...s1.req, outcome: "booked" } } else s1
      push(s2, partsOrdered(s2, o).foldl(List(), (l, p) => l.append(J("reveal", o, p, ""))))
    }
  }

  /** advanceProbes (N:2129), a job: the turn order, then the reveal once every participant said yes. */
  pure def advanceProbes(s0: S, o: str, env: Env): S = {
    val s = advanceTurns(s0, o)
    if (op(s, o).stage == "probing" and op(s, o).parts.forall(p => stat(s, o, p) == "available")) reveal(s, o, env) else s
  }

  // ---------------------------------------------------------------- dropMember (N:2564), the hub
  // dropMember runs one job for each opportunity, in the code's order.
  pure def dropMember(s: S, m: str, reason: str): S = push(s, [J("dm", "o1", m, reason), J("dm", "o2", m, reason)])

  /** The step of dropMember for one opportunity (a job). */
  pure def dropMemberIn(acc: S, o: str, m: str, reason: str): S = {
    val minorReason = reason == "minors policy"
    val x = op(acc, o)
    if (not(OPEN.contains(x.stage))) acc
    else {
      val wasAlternate = minorReason and x.alts.contains(m)
      val a1 = putO(acc, o, { ...x, alts: x.alts.exclude(Set(m)) })
      if (wasAlternate and not(x.parts.contains(m)) and x.stage != "scheduled") push(a1, [J("close", o, "", reason)])
      // A minor who was asked and then replaced is still on the roster: the open item closes (network.ts:2768-2770).
      else if (minorReason and x.contacted.contains(m) and not(x.parts.contains(m)) and x.stage != "scheduled") push(a1, [J("close", o, "", reason)])
      else if (not(x.parts.contains(m))) a1
      else if (minorReason and x.stage != "scheduled") push(a1, [J("close", o, "", reason)])
      else if (x.stage == "review") push(a1, [J("close", o, "", reason)])
      else if (x.stage == "probing") push(setStat(a1, o, m, "unavailable"), [J("replace", o, m, "")])
      // SD-047 (N:2633): only a member who is going ("yes") leaves a booked meeting.
      else if (stat(a1, o, m) == "yes") push(a1, [dropJob(o, m, false)])
      else a1
    }
  }

  // heardFrom (N:639): any inbound resets the pause rules. The queue releases messages held for an answer
  // (outbound-queue.ts:636-643).
  pure def unhold(q: str): str = if (q == "held") "pending" else q
  pure def heardFrom(s: S, m: str): S = {
    val x = mm(s, m)
    val s1 = putM(s, m, { ...x, ask1: -1, ask2: -1, outbound: 0, onlyWhenAsked: false })
    OPP_ORDER.foldl(s1, (acc, o) => putO(acc, o, { ...op(acc, o),
      probeQ: op(acc, o).probeQ.set(m, unhold(op(acc, o).probeQ.get(m))),
      revealQ: op(acc, o).revealQ.set(m, unhold(op(acc, o).revealQ.get(m))) }))
  }

  // ---------------------------------------------------------------- readers (oracles, fixed per intent)
  // parseProbeReply with time options (classify.ts:669-731) merged by the probe branch (N:766-777).
  // A bare "counter" ("how about next week instead?") is "unclear" (consentOf, classify.ts:598, SD-041); a
  // counter with a yes word ("sounds fun! how about next week") is a yes with no time, the same reading as
  // "yes_other_times"; "it was great" -> yes (an affirmation); "I couldn't make it" -> no (a can't);
  // "ok" -> yes, unclear after two of our messages in a row (N:774).
  pure def readProbe(intent: str, outboundBefore: int): str =
    if (Set("yes", "fb_good").contains(intent)) "yes_all"
    else if (intent == "yes_other_times") "yes_none"
    else if (intent == "ack") (if (outboundBefore >= 2) "unclear" else "yes_all")
    else if (Set("no", "cancel", "fb_self_noshow").contains(intent)) "no"
    else "unclear"

  // yesNoOf / consentOf (N:654, classify.ts:556): yes, no, counter or unclear.
  pure def readYesNo(intent: str): str =
    if (Set("yes", "fb_good", "ack").contains(intent)) "yes"
    else if (Set("no", "cancel", "fb_self_noshow").contains(intent)) "no"
    else "unclear"

  // ---------------------------------------------------------------- onProbeAnswer (N:2327)
  // SD-075 and SD-076 (N:2330): a no also takes back a yes that is not booked yet ("available").
  pure def onProbeAnswer(s: S, m: str, o: str, yes: bool, nonePicked: bool, intent: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage != "probing" or not(stat(s, o, m) == "probing" or (not(yes) and stat(s, o, m) == "available"))) s
    else {
      val retry = x.timeRetry.contains(m)
      if (yes) {
        val x1 = { ...x, status: x.status.set(m, "available"), accepted: x.accepted.set(m, intent) }
        if (nonePicked and not(retry)) {
          // "Yes, but none of those": other times, once (a reply; the times hook sets awaiting probe).
          val s1 = putO(s, o, { ...x1, timeRetry: x1.timeRetry.union(Set(m)), status: x1.status.set(m, "probing"), sentAt: x1.sentAt.set(m, s.now) })
          val s2 = collect(s1, m, "times", o, false)
          putM(s2, m, { ...mm(s2, m), aw: { kind: "probe", opp: o, at: s2.now, clarified: false } })
        } else push(collect(putO(s, o, x1), m, "reply", o, false), [J("probes", o, "", "")])
      } else {
        val s1 = putO(s, o, { ...x, status: x.status.set(m, "unavailable"), saidNo: x.saidNo.union(Set(m)) })
        push(collect(s1, m, "reply", o, false), [J("replace", o, m, ""), J("probes", o, "", "")])
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

  // onFeedback (N:2644): the post-meeting answer; a self no-show counts on the member (N:2673), unless
  // finalize already counted it (SD-328).
  pure def onFeedback(s: S, m: str, o: str, intent: str): S = {
    val x = op(s, o)
    val post = if (intent == "fb_self_noshow") "self_noshow" else if (intent == "fb_other_noshow") "came_other" else "came"
    val count = post == "self_noshow" and not(x.noShowCounted.contains(m))
    val s1 = putO(s, o, { ...x, feedbackFrom: x.feedbackFrom.union(Set(m)), post: x.post.set(m, post),
                          noShowCount: if (count) x.noShowCount.set(m, x.noShowCount.get(m) + 1) else x.noShowCount })
    collect(s1, m, "reply", o, false)
  }

  // ---------------------------------------------------------------- handleInbound routing (N:673-845)
  pure def route(s: S, m: str, intent: str, outboundBefore: int, env: Env): S = {
    val aw = mm(s, m).aw
    val yn = readYesNo(intent)
    if (intent == "job_post") {
      // peon: postingTurn (N:758, jobs.ts) reads the post back and sets awaiting "posting" with no expect().
      putM(s, m, { ...mm(s, m), aw: { kind: "posting", opp: "", at: s.now, clarified: false } })
    } else if (aw.kind == "posting") {
      // The manager's yes or no to the read-back ends the draft. SD-043 (N:4681): the slot goes back to a
      // probe or booked plan that still waits for this member's answer.
      putM(s, m, { ...mm(s, m), aw: owedAnswer(s, m, "") })
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
        push(putM(s, m, { ...mm(s, m), aw: NO_AW }), [dropJob(aw.opp, m, true)])
      } else if (aw.kind == "booked" and (yn == "yes" or intent == "ack")) {
        val s1 = putM(s, m, { ...mm(s, m), aw: NO_AW })
        collect(if (op(s1, aw.opp).stage == "scheduled") confirmPlan(s1, aw.opp, m, false) else s1, m, "reply", aw.opp, false)
      } else {
        // A cancel with no slot: the first scheduled opportunity where the member is "yes" (N:798-801).
        val sched = OPP_ORDER.select(o => op(s, o).stage == "scheduled" and stat(s, o, m) == "yes")
        // SD-075 and SD-076 (N:807-812): with no slot, "no" or a cancel takes back a yes to a probe that is
        // not booked yet.
        val held = OPP_ORDER.select(o => op(s, o).stage == "probing" and op(s, o).contacted.contains(m) and stat(s, o, m) == "available")
        if (intent == "cancel" and sched.length() > 0) push(s, [dropJob(sched[0], m, true)])
        else if (aw.kind == "none" and (intent == "cancel" or yn == "no") and held.length() > 0)
          onProbeAnswer(s, m, held[0], false, false, intent, env)
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
    // SD-248 (N:4158): the drop notice carries the meeting time, so it stays valid after forget deletes the item.
    else if (d.kind == "drop_notice") s.now < x.meetingAt
    else true
  }

  /**
   * deliverDeferred (N:3270-3290) for one deferred send `d` (a job). The tick took the deferred sends out of
   * `deferred` into `toDeliver`; a send that must wait again goes back into `deferred`. The next deliver job
   * runs after the drop that a refused reveal starts, as in the code's loop.
   */
  pure def deliverOne(acc0: S, d: Def, env: Env): S = {
    val acc1 = { ...acc0, toDeliver: acc0.toDeliver.exclude(Set(d)) }
    val acc = if (acc1.toDeliver != Set()) push(acc1, [J("deliver", "", "", "")]) else acc1
    if (mm(acc, d.to).forgotten) acc
    else if (not(defValid(acc, d))) acc            // N:3274: dropped, no onRefused
    else if (not(env.openW.contains(d.to))) pushDef(acc, d.kind, d.opp, d.to)
    else {
      val about = d.kind == "reveal" or d.kind == "feedback"
      if (not(about)) sendNotice(acc, d.to, d.kind, d.opp, env)
      else {
        val r = sendGate(acc, d.to, d.kind, "logistics", about, false, env)
        if (r == "sent") {
          val a1 = collect(acc, d.to, d.kind, d.opp, false)
          if (d.kind == "reveal") onSentReveal(a1, d.opp, d.to)
          else expectSlot(a1, d.to, { kind: "feedback", opp: d.opp, at: a1.now, clarified: false })
        }
        else if (r == "deferred") pushDef(acc, d.kind, d.opp, d.to)
        else if (d.kind == "reveal" and op(acc, d.opp).stage == "scheduled" and stat(acc, d.opp, d.to) == "yes") push(acc, [dropJob(d.opp, d.to, false)])
        else acc
      }
    }
  }

  // refreshUnanswered (N:3323): two initial invites unanswered for 72 h move the member to only-when-I-ask.
  // The second oldest invite is 72 hours old, so two invites are (UNANSWERED_LIMIT = 2).
  pure def refreshUnanswered(s: S): S =
    MEMBERS.fold(s, (acc, m) => {
      val x = mm(acc, m)
      if (x.ask2 >= 0 and acc.now - x.ask2 >= UNANSWERED_AFTER and not(x.onlyWhenAsked)) putM(acc, m, { ...x, onlyWhenAsked: true }) else acc
    })

  pure def finalize(s: S, o: str): S = {
    val x = op(s, o)
    val going = partsOrdered(s, o).select(p => x.status.get(p) == "yes" and x.bookedAt.get(p) >= 0)
    def said(p: str): bool = x.post.get(p) != ""
    def vouched(p: str): bool = going.select(q => q != p and x.post.get(q) == "came").length() > 0
    def present(p: str): bool = x.post.get(p) == "came" or x.post.get(p) == "came_other" or (x.post.get(p) != "self_noshow" and vouched(p))
    def reported(p: str): bool = going.select(q => q != p and x.post.get(q) == "came_other").length() > 0
    // N:2823-2826: a reported no-show who did not answer counts once here, and is marked counted (SD-328).
    val counted = going.select(p => not(present(p)) and not(said(p)) and reported(p))
    val nsc = counted.foldl(x.noShowCount, (acc, p) => acc.set(p, acc.get(p) + 1))
    val s1 = putO(s, o, { ...x, finalized: true, noShowCount: nsc,
                          noShowCounted: counted.foldl(x.noShowCounted, (acc, p) => acc.union(Set(p))) })
    if (x.requester != "" and present(x.requester) and going.select(p => p != x.requester and present(p)).length() > 0
        and s1.req.outcome != "fulfilled") { ...s1, req: { ...s1.req, outcome: "fulfilled" } }
    else s1
  }

  /** advance's probe silence for one participant (a job): the step of the loop over the participants. */
  pure def expireProbe(acc: S, o: str, p: str): S = {
    val y = op(acc, o)
    if (y.stage != "probing" or y.status.get(p) != "probing") acc
    else {
      val due = if (y.contacted.contains(p)) y.sentAt.get(p) + PROBE_TTL else y.turnAt.get(p) + PROBE_WAIT
      if (acc.now < due) acc
      // N:3430-3433: they said yes and were offered other times: no answer keeps the yes. The slot that
      // points at this item ends first (SD-076).
      else if (y.timeRetry.contains(p)) setStat(clearAwFor(acc, p, o), o, p, "available")
      else {
        val a1 = if (y.contacted.contains(p)) putO(acc, o, { ...y, expiredSilent: y.expiredSilent.union(Set(p)) }) else acc
        push(setStat(clearAwFor(a1, p, o), o, p, "unavailable"), [J("replace", o, p, "")])
      }
    }
  }

  /** advance (N:3378) for one opportunity (a job). The probing loop is one job for each participant, then advanceProbes. */
  pure def advance(s: S, o: str, env: Env): S = {
    val x = op(s, o)
    if (x.stage == "review" and s.now >= x.review.deadline) {
      // Missed its SLA: expires instead of being sent late (PRD 32.8).
      push(putO(s, o, { ...x, review: { ...x.review, decision: "expired", decidedAt: s.now } }), [J("close", o, "", "review expired")])
    } else if (x.stage == "probing") {
      push(s, partsOrdered(s, o).foldl(List(), (l, p) => l.append(J("exp", o, p, ""))).append(J("probes", o, "", "")))
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

  // The stack of jobs is empty: no unit is running (see the header).
  pure def idleIn(x: S): bool = x.jobs.length() == 0
  val idle: bool = idleIn(s)

  // newOpp + submit (N:2047, 2096): every opportunity goes to review first. The engine and the request
  // search propose only eligible members (eligible, busy).
  action submit(o: str): bool = {
    val x = op(s, o)
    all {
      idle,
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

  // reviewBlock (N:1975, SD-009): every decision is refused once the clock reached the item's review
  // deadline, also before the tick that expires it.
  pure def reviewOpen(s: S, o: str): bool =
    op(s, o).stage == "review" and op(s, o).review.decision == "" and s.now < op(s, o).review.deadline

  // decide(approve) (N:1917-1956), after reviewBlock.
  action approve(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      reviewOpen(s, o),
      x.parts.forall(p => not(mm(s, p).minor) and not(mm(s, p).forgotten)), // reviewBlock refuses otherwise
      val s1 = putO(s, o, { ...x, review: { ...x.review, decision: "approve", decidedAt: s.now } })
      val bad = x.parts.exists(p => not(eligible(s1, p, o)))
      val s2 = if (bad) push(putO(s1, o, { ...op(s1, o), review: { ...op(s1, o).review, invalidated: true } }), [J("close", o, "", "invalidated")])
               else push(putO(s1, o, { ...op(s1, o), stage: "probing",
                       status: x.status.keys().mapBy(k => if (x.parts.contains(k)) "queued" else "out") }), [J("probes", o, "", "")])
      s' = { ...s2, last: L("approve", o, "", ""), jobEnv: env },
    }
  }

  action reject(o: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      reviewOpen(s, o),
      s' = { ...push(putO(s, o, { ...x, review: { ...x.review, decision: "reject", decidedAt: s.now } }), [J("close", o, "", "rejected in review")]),
             last: L("reject", o, "", ""), jobEnv: env },
    }
  }

  // probe() (N:2186) at a moment the member's send window is open and nothing else waits for their answer
  // (probeOwed, SD-043 and SD-077). send() with noDefer and the probe hook: onSent sets awaiting with no
  // expect(); onRefused replaces or closes.
  action probeSend(o: str, m: str, env: Env): bool = {
    val x = op(s, o)
    all {
      idle,
      x.stage == "probing", x.parts.contains(m), x.status.get(m) == "probing", not(x.contacted.contains(m)),
      env.openW.contains(m), not(probeOwed(s, m, o)),
      val invite = x.requester != m
      val r = sendGate(s, m, "probe", if (invite) "slot" else "logistics", true, invite, env)
      val s2 = if (r == "sent") {
                 val s1 = collect(s, m, "probe", o, invite)
                 val y = op(s1, o)
                 putM(putO(s1, o, { ...y, contacted: y.contacted.union(Set(m)), sentAt: y.sentAt.set(m, s1.now) }), m,
                      { ...mm(s1, m), aw: { kind: "probe", opp: o, at: s1.now, clarified: false } })
               } else push(setStat(s, o, m, "unavailable"), [J("replace", o, m, ""), J("probes", o, "", "")])
      s' = { ...s2, last: L("probeSend", o, m, r), jobEnv: env },
    }
  }

  // An inbound text from the member (onInbound N:595, handleInbound N:673).
  action answer(m: str, intent: str, env: Env): bool = {
    val x = mm(s, m)
    all {
      idle,
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
      s' = { ...route(s2, m, intent, before, env), last: L("answer", "", m, intent), jobEnv: env },
    }
  }

  // STOP (N:675): heardFrom first (N:615), then dropMember.
  action stop(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten), not(mm(s, m).optedOut),
    val s1 = heardFrom(s, m)
    s' = { ...dropMember(putM(s1, m, { ...mm(s1, m), optedOut: true }), m, "opted out"), last: L("stop", "", m, ""), jobEnv: env },
  }

  // START (N:676).
  action start(m: str): bool = all {
    idle,
    not(mm(s, m).forgotten), mm(s, m).optedOut,
    val s1 = heardFrom(s, m)
    s' = { ...collect(putM(s1, m, { ...mm(s1, m), optedOut: false }), m, "reply", "", false), last: L("start", "", m, "") },
  }

  // A minor signal or a record age under 18 (N:717-722, syncMember N:4430): minor, then dropMember.
  action becomeMinor(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten), not(mm(s, m).minor),
    s' = { ...dropMember(putM(s, m, { ...mm(s, m), minor: true }), m, "minors policy"), last: L("minor", "", m, ""), jobEnv: env },
  }

  // Leave the app or delete (service forget -> Network.forget, N:913): declined, requests gone, dropMember,
  // then every opportunity that names the member is deleted (forgetRest, a job after dropMember's jobs).
  action forget(m: str, env: Env): bool = all {
    idle,
    not(mm(s, m).forgotten),
    val s1 = putM(s, m, { ...mm(s, m), forgotten: true })
    val s2 = if (m == "a") { ...s1, req: { outcome: "", toldNone: false } } else s1
    s' = { ...dropMember(push(s2, [J("forgetRest", "", m, "")]), m, "declined"), last: L("forget", "", m, ""), jobEnv: env },
  }

  /** The rest of forget after dropMember (a job). */
  pure def forgetRest(s3: S, m: str): S = {
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
    { ...s5, deferred: s5.deferred.filter(d => d.to != m and not((d.kind == "reveal" or d.kind == "feedback") and op(s5, d.opp).parts.contains(m))) }
  }

  // SD-146 (not reproduced): the meeting time is one of the first member's time options, which leave out
  // quiet hours, and the partner only picks from those (chooseTimeOptions, MIN_NOTICE 6 h, PARTNER_LEAD
  // 12 h). So a member whose reveal or drop notice waits for quiet hours is in their send window at some
  // tick before the meeting. The model's ticks jump up to 49 hours, so this is a constraint on the clock:
  // no clock move passes the meeting of a deferred send that is valid only until the meeting (a reveal, a
  // drop notice), and the last tick before it has that member's window open.
  pure def untilMeeting(s: S, d: Def): bool = (d.kind == "reveal" or d.kind == "drop_notice") and defValid(s, d)
  pure def deferredInTime(s: S, dt: int, env: Env): bool =
    s.deferred.forall(d => not(untilMeeting(s, d)) or {
      val at = op(s, d.opp).meetingAt
      s.now + dt < at and (s.now + dt + 1 >= at implies env.openW.contains(d.to))
    })

  // The clock moves between two ticks: units read clock.now(), and withTickLock skips a tick while another
  // holder has the lock (runtime.ts). Review expiry runs only in a tick (N:3397).
  action elapse(dt: int): bool = all {
    idle,
    s.deferred.forall(d => not(untilMeeting(s, d)) or s.now + dt + 1 < op(s, d.opp).meetingAt),
    s' = { ...s, now: s.now + dt, last: { act: "elapse", o: "", m: "", x: "", dt: dt } },
  }

  // The service tick under the lock (N:3315): deliverDeferred, refreshUnanswered, advance for each
  // opportunity, then the slots that ended. Each part is a job.
  action tick(dt: int, env: Env): bool = all {
    idle,
    deferredInTime(s, dt, env),
    val s1 = { ...s, now: s.now + dt, toDeliver: s.deferred, deferred: Set() }
    s' = { ...push(s1, [J("deliver", "", "", ""), J("refresh", "", "", ""), J("adv", "o1", "", ""), J("adv", "o2", "", ""), J("expire", "", "", "")]),
           last: { act: "tick", o: "", m: "", x: "", dt: dt }, jobEnv: env },
  }

  // The outbound queue (packages/blooio/src/outbound-queue.ts) decides a collected probe or reveal later:
  // sent, held for an answer (the line's unanswered cap, :398-401) or refused. The other messages are read by
  // no invariant.
  action queueDecide(kind: str, o: str, m: str, q: str): bool = {
    val x = op(s, o)
    all {
      idle,
      (if (kind == "probe") x.probeQ.get(m) else x.revealQ.get(m)) == "pending",
      val y = if (kind == "probe") { ...x, probeQ: x.probeQ.set(m, q) } else { ...x, revealQ: x.revealQ.set(m, q) }
      s' = { ...putO(s, o, y), last: L("queue", kind, m, q) },
    }
  }

  // ---------------------------------------------------------------- the jobs
  // Each job action takes the job on top of the stack and runs it with the unit's oracles.
  def job: Job = s.jobs.head()
  def popped: S = { ...s, jobs: s.jobs.tail() }
  def jobIs(kind: str): bool = s.jobs.length() > 0 and s.jobs.head().kind == kind

  action runClose = all { jobIs("close"), s' = close(popped, job.o, job.why, s.jobEnv) }
  action runReplace = all { jobIs("replace"), s' = replaceOrClose(popped, job.o, job.m) }
  action runProbes = all { jobIs("probes"), s' = advanceProbes(popped, job.o, s.jobEnv) }
  action runReveal = all { jobIs("reveal"), s' = sendReveal(popped, job.o, job.m, s.jobEnv) }
  action runDrop = all { jobIs("drop"), s' = handleDrop(popped, job.m, job.o, job.ack, s.jobEnv) }
  action runDm = all { jobIs("dm"), s' = dropMemberIn(popped, job.o, job.m, job.why) }
  action runForgetRest = all { jobIs("forgetRest"), s' = forgetRest(popped, job.m) }
  action runDeliver = all {
    jobIs("deliver"),
    if (s.toDeliver == Set()) s' = popped
    else { nondet d = s.toDeliver.oneOf() s' = deliverOne(popped, d, s.jobEnv) },
  }
  action runRefresh = all { jobIs("refresh"), s' = refreshUnanswered(popped) }
  action runAdv = all { jobIs("adv"), s' = advance(popped, job.o, s.jobEnv) }
  action runExp = all { jobIs("exp"), s' = expireProbe(popped, job.o, job.m) }
  action runExpire = all { jobIs("expire"), s' = expireSlots(popped) }

  action runJob = any {
    runClose, runReplace, runProbes, runReveal, runDrop, runDm, runForgetRest, runDeliver, runRefresh, runAdv,
    runExp, runExpire,
  }

  // The scheduler. Destructive actions (reject, STOP, a minor signal, a leave, a clock jump with no tick)
  // take a roll so that the random simulation also reaches the long consent path; every behaviour stays
  // reachable. The send window is often open for everyone, and the intro budget is rarely spent. While a
  // unit runs, only its jobs are enabled.
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
    nondet kind = oneOf(Set("probe", "reveal"))
    nondet q = oneOf(Set("delivered", "held", "refused"))
    nondet yesFirst = oneOf(Set(true, false))
    any {
      runJob,
      submit(o),
      approve(o, env),
      all { roll == 0, reject(o, env) },
      probeSend(o, m, env),
      // Half of the answers are a plain "yes", so that random traces reach the reveal.
      answer(m, if (yesFirst) "yes" else intent, env),
      all { roll == 1, stop(m, env) },
      start(m),
      // A minor signal in half as many draws as the other life events (weights only: the reachable states do not
      // change). Since a minor who was asked and then replaced closes the item (network.ts:2768-2770), a minor signal
      // in one roll of 10 closes the member request before it is held in almost every trace (witness_requestFulfilled).
      all { roll == 2, wide, becomeMinor(m, env) },
      all { roll == 3, forget(m, env) },
      tick(dt, env),
      all { roll == 4, elapse(dt) },
      queueDecide(kind, o, m, q),
    }
  }

  // ================================================================ safety
  // Each invariant names the rule it comes from. A defect it showed is named with its register id and the
  // fix commit. Invariants that still fail on a defect that was skipped are in `knownOpen`, not in `safety`.

  // AGENTS.md (code invariants): every proactive proposal and every member request goes through human
  // review before any member is contacted. begin() has one caller chain, decide().
  val reviewGate = OPPS.forall(o => {
    val x = op(s, o)
    (Set("probing", "scheduled", "done").contains(x.stage) or x.contacted != Set())
      implies (x.review.decision == "approve" and not(x.review.invalidated))
  })

  // PRD 32.8 and docs/network.md 2: an item that missed its SLA expires; "it is never sent late".
  // SD-009, fixed in c06f633: reviewBlock() refuses every decision at or after the deadline.
  val decidedBeforeDeadline = OPPS.forall(o => {
    val x = op(s, o)
    x.review.decision == "approve" implies x.review.decidedAt < x.review.deadline
  })

  // AGENTS.md decision 11: only answer "yes" is consent; a counter is not a yes. PRD consent flow: names
  // go out only after every member said yes, and a member can take a yes back before the reveal.
  // SD-041 (113a369: a bare counter is unclear), SD-075 and SD-076 (791ff6a: a later no takes the yes
  // back), SD-077 (6d8d2d3: the probe waits while "How did it go?" is open).
  val namesAfterAllYes = OPPS.forall(o => {
    val x = op(s, o)
    x.revealSent != Set() implies x.parts.forall(p => CONSENT.contains(x.accepted.get(p)) and not(x.withdrawn.contains(p)))
  })

  // AGENTS.md decision 11: a counter-offer (or an answer to another question) never makes a member
  // "available" (the yes-hold, N:2337). SD-041 (113a369), SD-077 (6d8d2d3).
  val counterIsNotYes = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "available" and x.contacted.contains(p)) implies CONSENT.contains(x.accepted.get(p)))
  })

  // The slot routes the consent reply (N:771), so it is consent state. A probe slot points at a probe that
  // waits for this member. SD-048 (73d1e2b: replaceOrClose clears the slot of the member who is out) and the
  // time-retry expiry that kept it (791ff6a, SD-076).
  val slotOwnerAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "probe" implies (op(s, aw.opp).stage == "probing" and op(s, aw.opp).parts.contains(m)
      and op(s, aw.opp).status.get(m) == "probing")
  })

  // Code comment on expect() (N:4185): "can't this week" must reach the probe. While a probe waits for the
  // member's answer, the slot points at it, or the job-post read-back holds the slot and gives it back when
  // the post is saved or dropped (owedAnswer). SD-043, fixed in 74602b1 (it was lost before).
  val noLostAnswer = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "probing" implies x.parts.forall(p =>
      (x.status.get(p) == "probing" and x.contacted.contains(p)) implies
        ((mm(s, p).aw.kind == "probe" and mm(s, p).aw.opp == o) or mm(s, p).aw.kind == "posting"))
  })

  // AGENTS.md founder decision 1 and core/policy.ts: members aged 13-17 are never matched or connected.
  val minorNever = MEMBERS.forall(m => mm(s, m).minor implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m)))))

  // AGENTS.md STOP: an opted-out member is out of everything open (dropMember).
  val stopWins = MEMBERS.forall(m => mm(s, m).optedOut implies OPPS.forall(o =>
    OPEN.contains(op(s, o).stage) implies not(Set("queued", "probing", "available", "yes").contains(op(s, o).status.get(m)))))

  // closed and done are terminal (gone: deleted by forget).
  val terminalStable = OPPS.forall(o => op(s, o).everTerminal implies TERMINAL.contains(op(s, o).stage))

  // Request comment (N:388): "booked": a meeting is set. SD-139, fixed in 6e500fa: when another member calls
  // the meeting off, the request waits again. When the requester calls it off, the request stays "booked";
  // that is no stuck request, as a new ask opens a new request (openRequest skips "booked", N:1598). The same
  // holds after the meeting time (done; "fulfilled" needs the requester there): the meeting was set. When the
  // partner then leaves the app, forget deletes the done item (N:961) and clears the request's oppId (N:977);
  // the meeting was still set (feedbackSent stays on the deleted item in the model).
  val requestNotStuck = s.req.outcome == "booked" implies
    (Set("scheduled", "done").contains(op(s, "o1").stage) or op(s, "o1").droppedBy.contains("a")
      or (op(s, "o1").stage == "gone" and op(s, "o1").feedbackSent))

  // PRD F11 and the drop notice: when a booked plan is off, the others who were told hear it is off.
  // SD-248, fixed in c29646e: the drop notice carries the meeting time and is sent after a leave or delete.
  // A notice the line streak rule refused (noticeRefused) is SD-249 (skipped, see noticeNeverRefused).
  val cancelReachesTold = OPPS.forall(o => {
    val x = op(s, o)
    (Set("closed", "gone").contains(x.stage) and x.closedFrom == "scheduled") implies x.wasTold.forall(m =>
      x.droppedBy.contains(m) or mm(s, m).forgotten or mm(s, m).optedOut or x.cancelHeard.contains(m)
      or x.noticeRefused.contains(m)
      or s.deferred.exists(d => d.opp == o and d.to == m and (d.kind == "drop_notice" or d.kind == "declined_quiet") and defValid(s, d)))
  })

  // PRD F29: "Partial acceptances are released politely". SD-263, fixed in 791f698: close() releases a
  // member whose yes was not booked yet. The code sends no release on a close for the minors policy (no
  // message about an item with a minor), so that close is exempt. A member who left, opted out or is a minor
  // gets no release; a release the streak rule refused is SD-249 (noticeNeverRefused).
  val partialAcceptReleased = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "closed" and x.closedFrom == "probing" and x.closedReason != "minors policy") implies x.parts.forall(p =>
      (x.status.get(p) == "available" and CONSENT.contains(x.accepted.get(p)) and not(mm(s, p).forgotten) and not(mm(s, p).optedOut)
        and not(mm(s, p).minor) and not(x.noticeRefused.contains(p)))
        implies (x.released.contains(p) or s.deferred.exists(d => d.opp == o and d.to == p and (d.kind == "none_yet" or d.kind == "release"))))
  })

  // network-consent-17: a reported no-show counts once. SD-328, fixed in 25b54f1: finalize marks the members
  // it counted, and a late self no-show answer does not count them again.
  val noShowOnce = OPPS.forall(o => MEMBERS.forall(m => op(s, o).noShowCount.get(m) <= 1))

  // N:2405-2408: everyone said yes, so the plan is booked and each member is told once. SD-146 was not
  // reproduced: with the clock constraint deferredInTime (the meeting time is in the member's send window),
  // a deferred reveal always reaches the member before the meeting.
  val bookedMembersTold = OPPS.forall(o => {
    val x = op(s, o)
    (x.stage == "scheduled" and s.now >= x.meetingAt) implies x.parts.forall(p => x.status.get(p) == "yes" implies x.bookedTold.contains(p))
  })

  // The invariants hold between two units (`idle`); inside a unit, jobs are still to run.
  val safety = idle implies and {
    reviewGate, decidedBeforeDeadline, namesAfterAllYes, counterIsNotYes, slotOwnerAlive, noLostAnswer,
    minorNever, stopWins, terminalStable, requestNotStuck, cancelReachesTold, partialAcceptReleased,
    noShowOnce, bookedMembersTold,
  }

  // ---------------------------------------------------------------- known open (not in safety)
  // Each value below still fails on the code of this branch. The defect was skipped for the reason given,
  // so the value is kept as its own check and the run tests show its trace.

  // SD-006 (skipped: the Network has no delivery-outcome path from the outbound queue; a cross-module design
  // with SD-030, SD-095 and SD-257 that needs a founder or maintainer decision). Code comment N:4083: silence
  // for 48 hours confirms a booked plan only after "the booked plan reached them"; the queue can hold or
  // refuse the reveal (outbound-queue.ts:398-401), and silence still confirms.
  val confirmedImpliesDelivered = OPPS.forall(o => op(s, o).silent.forall(m => op(s, o).revealQ.get(m) == "delivered"))

  // SD-030 (skipped: same root cause and decision as SD-006). PRD F28 and outreach.ts:23: silence counts only
  // for an invite the member got; a probe that the queue refused or held still expires as their silence.
  val silenceOnlyAfterDelivery = OPPS.forall(o => op(s, o).expiredSilent.forall(m => op(s, o).probeQ.get(m) == "delivered"))

  // SD-140 (skipped: the fix was reverted; with declinedBy filled in, two sim gates failed on defects that
  // were already there: the proactive timing of unsolicited info sends and the minors-in-plans gate for a
  // minor found only after contact). engine world.ts:160 reads interaction outcomes; a member's "no" is a
  // decline, but close() records "declined" only for reason "declined".
  val declineRecorded = OPPS.forall(o => op(s, o).outcomeRec == "expired" implies op(s, o).saidNo == Set())

  // SD-259 (skipped: reschedule and a cancel outside the booked slot are a new flow and need a founder or
  // maintainer decision on wording and window). The booked text says "Reply if your plans change"; after
  // the 48-hour slot a plain "no" is not read as a cancel.
  val bookedNoHonored = OPPS.forall(o => {
    val x = op(s, o)
    x.stage == "scheduled" implies x.cancelAsked.forall(m => x.status.get(m) != "yes")
  })

  // SD-249 (skipped: needs a founder decision; the Blooio and Apple line-safety streak rule refuses
  // logistics at 3 unanswered, and the drop_notice hook has no onRefused). No notice to a reachable member
  // is refused. The same rule refuses a release (SD-263) or "none yet" to a member at the streak limit.
  val noticeNeverRefused = OPPS.forall(o => op(s, o).noticeRefused.forall(m => mm(s, m).forgotten or mm(s, m).optedOut))

  // SD-139, second part (residual; the fix 6e500fa covers the request only). The booked slot routes
  // "can't make it" to the booked plan (N:787); handleDrop's own close path clears only the dropping
  // member's slot, so the partner keeps "booked" for a closed plan until it ends (48 hours or the meeting),
  // and a "yes" in that time gets the booked thanks. Not in safety until a fix lands with its own test.
  val bookedSlotAlive = MEMBERS.forall(m => {
    val aw = mm(s, m).aw
    aw.kind == "booked" implies op(s, aw.opp).stage == "scheduled"
  })

  val knownOpen = idle implies and {
    confirmedImpliesDelivered, silenceOnlyAfterDelivery, declineRecorded, bookedNoHonored, noticeNeverRefused,
    bookedSlotAlive,
  }

  // ================================================================ witnesses (must be reachable)
  // Each is read between two units only (`not(idle) or ...`).
  val witness_revealed = not(idle) or OPPS.forall(o => op(s, o).revealSent == Set())
  val witness_feedbackAnswered = not(idle) or OPPS.forall(o => not(op(s, o).stage == "done" and op(s, o).feedbackFrom != Set()))
  val witness_rejectNoContact = not(idle) or OPPS.forall(o => not(op(s, o).review.decision == "reject" and op(s, o).stage == "closed" and op(s, o).contacted == Set()))
  val witness_confirmedBySilence = not(idle) or OPPS.forall(o => op(s, o).silent == Set())
  val witness_requestFulfilled = not(idle) or s.req.outcome != "fulfilled"
  // A yes taken back before the reveal (SD-075, SD-076) and a release after a partial yes (SD-263).
  val witness_yesTakenBack = not(idle) or OPPS.forall(o => not(op(s, o).withdrawn.exists(p => op(s, o).saidNo.contains(p))))
  val witness_partialReleased = not(idle) or OPPS.forall(o => not(op(s, o).released.exists(p => p != op(s, o).requester)))

  // ================================================================ run tests (traces from the code)
  pure val ALL_OPEN: Env = { openW: MEMBERS, budget: true, lead: 30 }

  // A run test step is a unit and then its jobs: `settle` runs one job, or does nothing between two units.
  // The longest unit here (a tick) has fewer than 16 jobs.
  action settle = any { all { idle, s' = s }, runJob }
  action settled = settle.then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle)
    .then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle).then(settle)

  // Approve, both yes, reveal, the meeting, feedback (docs/network.md 4; the mini.ts happy path).
  run happyPathTest =
    init
      .then(submit("o1")).then(settled)
      .then(approve("o1", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and op(s, "o1").revealSent == Set("a", "b") and s.req.outcome == "booked" and safety)
      .then(tick(31, ALL_OPEN)).then(settled)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "done" and mm(s, "a").aw.kind == "feedback")
      .then(answer("a", "fb_good", ALL_OPEN)).then(settled)
      .then(answer("b", "fb_good", ALL_OPEN)).then(settled)
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and s.req.outcome == "fulfilled" and safety)

  // A reject closes the item and nobody is contacted (decide, reject).
  run rejectTest =
    init.then(submit("o2")).then(settled).then(reject("o2", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").contacted == Set() and s.collected == 0 and safety)

  // SD-009 (c06f633, opportunity-review-deadline.test.ts): the clock passes the deadline and no tick runs.
  // No decision is applied (reviewBlock "review_expired"); the next tick expires the item and nobody is contacted.
  run lateApprovalTest =
    init.then(submit("o2")).then(settled).then(elapse(13)).then(settled)
      .expect(not(reviewOpen(s, "o2")) and op(s, "o2").stage == "review")
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").review.decision == "expired" and op(s, "o2").contacted == Set()
              and s.collected == 0 and safety)

  // SD-041 (113a369, opportunity-counter-offer.test.ts): "how about next week instead?" is unclear: one
  // clarification, the probe stays open, silence expires it, and the request item closes. No names go out.
  run counterOfferTest =
    init.then(submit("o2")).then(settled).then(approve("o2", ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "counter", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and mm(s, "a").aw.kind == "probe" and mm(s, "a").aw.clarified and safety)
      .then(tick(27, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("b", "c") and stat(s, "o2", "a") == "out" and op(s, "o2").revealSent == Set()
              and counterIsNotYes and safety)

  // SD-075 (791ff6a, opportunity-withdraw-yes.test.ts): a yes, then "actually no, sorry" with no slot: the
  // yes is taken back; b replaces a; b and c say yes; the names go to b and c only.
  run withdrawnYesTest =
    init.then(submit("o2")).then(settled).then(approve("o2", ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").parts == Set("b", "c") and op(s, "o2").saidNo == Set("a") and safety)
      .then(probeSend("o2", "b", ALL_OPEN)).then(settled).then(answer("b", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled).then(answer("c", "yes", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "scheduled" and op(s, "o2").revealSent == Set("b", "c") and namesAfterAllYes and safety)

  // SD-075 with "I need to cancel" on the request item: the requester takes the yes back; the item closes.
  run cancelYesTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").revealSent == Set() and s.req.outcome == "none" and safety)

  // SD-048 (73d1e2b, opportunity-replaced-prober.test.ts): b is probing, b sends STOP, c replaces b, b
  // sends START: b has no slot left for the item.
  run replacedProberTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(stop("b", ALL_OPEN)).then(settled)
      .then(start("b")).then(settled)
      .expect(op(s, "o1").parts == Set("a", "c") and mm(s, "b").aw.kind == "none" and slotOwnerAlive and safety)

  // The common prefix: o1 is booked for a and b (lead 30 unless given).
  action bookO1(lead: int): bool =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", { ...ALL_OPEN, lead: lead })).then(settled)

  // SD-139 (6e500fa, opportunity-booked-request.test.ts): b cancels the booked request: the request waits
  // again. The residual second part: a keeps the "booked" slot of the closed plan (bookedSlotAlive, knownOpen).
  run requestStuckTest =
    bookO1(30).then(answer("b", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and s.req.outcome == "none" and requestNotStuck and safety
              and mm(s, "a").aw.kind == "booked" and not(bookedSlotAlive))

  // The requester calls the booked meeting off: the request stays "booked" (they called it off; a new ask
  // opens a new request), and b hears it is off.
  run requesterCancelsTest =
    bookO1(30).then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and s.req.outcome == "booked" and op(s, "o1").cancelHeard == Set("b") and safety)

  // SD-006 (skipped): the reveal to b is collected, the queue holds it (b's line streak), 48 hours of silence confirm it.
  run silentConfirmTest =
    bookO1(72)
      .then(queueDecide("reveal", "o1", "b", "held")).then(settled)
      .then(tick(49, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").silent.contains("b") and not(confirmedImpliesDelivered) and safety)

  // requestNotStuck (model error fixed): the meeting takes place, a says "I couldn't make it", so the request
  // is not fulfilled and stays "booked". Then b leaves the app: forget deletes the done item. The meeting was
  // set; a new ask from a opens a new request.
  run requestAfterLeaveTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .then(answer("a", "fb_self_noshow", ALL_OPEN)).then(settled)
      .then(tick(96, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and s.req.outcome == "booked")
      .then(forget("b", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "gone" and s.req.outcome == "booked" and requestNotStuck and safety)

  // SD-249 (skipped): both get the reminder (3 messages since their last text); a cancels; the drop notice
  // to b is refused by the streak rule and nothing retries it. b still believes the plan is on.
  run cancelRefusedTest =
    bookO1(30).then(tick(10, ALL_OPEN)).then(settled)
      .expect(mm(s, "b").outbound == 3)
      .then(answer("a", "cancel", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and not(op(s, "o1").cancelHeard.contains("b"))
              and op(s, "o1").noticeRefused == Set("b") and not(noticeNeverRefused) and safety)

  // SD-248 (c29646e, opportunity-forget-cancellation.test.ts): b is in quiet hours; a leaves the app; the
  // drop notice to b is deferred and the opportunity is deleted; the notice still goes in the morning.
  run leaveInQuietHoursTest =
    bookO1(30).then(forget("a", { ...ALL_OPEN, openW: Set("a", "c") })).then(settled)
      .expect(op(s, "o1").stage == "gone" and s.deferred == Set({ kind: "drop_notice", opp: "o1", to: "b" }) and safety)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(s.deferred == Set() and op(s, "o1").cancelHeard.contains("b") and safety)

  // SD-328 (25b54f1, opportunity-no-show-once.test.ts): a says b never showed; finalize at +4 days counts
  // b's no-show; b's late "I couldn't make it" does not count it again.
  run noShowTwiceTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .then(answer("a", "fb_other_noshow", ALL_OPEN)).then(settled)
      .then(tick(96, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").finalized and op(s, "o1").noShowCount.get("b") == 1 and op(s, "o1").noShowCounted == Set("b"))
      .then(answer("b", "fb_self_noshow", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").noShowCount.get("b") == 1 and op(s, "o1").feedbackFrom.contains("b") and noShowOnce and safety)

  // SD-259 (skipped): the booked slot ends after 48 hours; a plain "no, sorry" to the booked plan is then ignored.
  run lateNoTest =
    bookO1(72).then(tick(49, ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "none")
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and stat(s, "o1", "a") == "yes" and not(bookedNoHonored) and safety)

  // SD-077 (6d8d2d3, opportunity-feedback-slot.test.ts): after the o1 meeting, a has the feedback slot; the
  // o2 probe to a waits; "it was great!" answers the feedback; then the probe goes out.
  run feedbackAsYesTest =
    bookO1(30).then(tick(31, ALL_OPEN)).then(settled).then(tick(6, ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "feedback")
      // "ok" is not an answer to "How did it go?": the slot stays, and the streak resets.
      .then(answer("a", "ack", ALL_OPEN)).then(settled)
      .then(submit("o2")).then(settled).then(approve("o2", ALL_OPEN)).then(settled)
      .expect(stat(s, "o2", "a") == "probing" and probeOwed(s, "a", "o2"))
      .then(answer("a", "fb_good", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").feedbackFrom.contains("a") and stat(s, "o2", "a") == "probing" and not(op(s, "o2").contacted.contains("a")))
      .then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw == { kind: "probe", opp: "o2", at: s.now, clarified: false } and counterIsNotYes and safety)

  // SD-043 (74602b1, opportunity-awaiting-slot.test.ts): a job post read-back holds the slot of a pending
  // probe; "no" drops the post and the slot goes back to the probe; the next "yes" answers the probe.
  run postingTakesSlotTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "job_post", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "posting" and noLostAnswer)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(mm(s, "a").aw.kind == "probe" and mm(s, "a").aw.opp == "o1" and stat(s, "o1", "a") == "probing")
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .expect(stat(s, "o1", "a") == "available" and safety)

  // SD-030 (skipped): the queue refuses the probe; 26 hours later it expires as a's silence.
  run refusedProbeSilenceTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(queueDecide("probe", "o1", "a", "refused")).then(settled)
      .then(tick(27, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").expiredSilent.contains("a") and not(silenceOnlyAfterDelivery) and safety)

  // SD-263 (791f698, opportunity-partial-yes.test.ts) and SD-140 (skipped): o2, a says yes, c says no, no
  // alternate is free: the item closes; a is released; the interaction is still recorded as "expired".
  run partnerNoTest =
    init.then(stop("b", ALL_OPEN)).then(settled).then(submit("o2")).then(settled).then(approve("o2", ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled)
      .then(answer("c", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o2").stage == "closed" and op(s, "o2").released == Set("a") and partialAcceptReleased
              and op(s, "o2").outcomeRec == "expired" and not(declineRecorded) and safety)

  // SD-263 in quiet hours: the release waits for a's window and goes at the next tick.
  run partnerNoQuietTest =
    init.then(stop("b", ALL_OPEN)).then(settled).then(submit("o2")).then(settled).then(approve("o2", ALL_OPEN)).then(settled).then(probeSend("o2", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o2", "c", ALL_OPEN)).then(settled)
      .then(answer("c", "no", { ...ALL_OPEN, openW: Set("c") })).then(settled)
      .expect(s.deferred == Set({ kind: "release", opp: "o2", to: "a" }) and safety)
      .then(tick(6, ALL_OPEN)).then(settled)
      .expect(op(s, "o2").released == Set("a") and s.deferred == Set() and safety)

  // SD-146 (not reproduced): b is in quiet hours at the reveal (meeting 8 hours ahead); the deferred reveal
  // waits; the last tick before the meeting is in b's window, so b is told before the meeting.
  run deferredRevealTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes", ALL_OPEN)).then(settled)
      .then(probeSend("o1", "b", ALL_OPEN)).then(settled)
      .then(answer("b", "yes", { openW: Set("a"), budget: true, lead: 8 })).then(settled)
      .expect(s.deferred == Set({ kind: "reveal", opp: "o1", to: "b" }))
      .then(tick(6, { openW: Set("a"), budget: true, lead: 8 })).then(settled)
      .expect(s.deferred == Set({ kind: "reveal", opp: "o1", to: "b" }) and not(deferredInTime(s, 1, { openW: Set("a"), budget: true, lead: 8 })))
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(s.deferred == Set() and op(s, "o1").bookedTold == Set("a", "b"))
      .then(tick(1, ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "scheduled" and bookedMembersTold and safety)

  // SD-076 (791ff6a, opportunity-withdraw-yes.test.ts): "yes, but none of those times", silence for 26
  // hours keeps the yes and ends the slot; then "no thanks" takes the yes back and the request item closes.
  run noAfterRetryTest =
    init.then(submit("o1")).then(settled).then(approve("o1", ALL_OPEN)).then(settled).then(probeSend("o1", "a", ALL_OPEN)).then(settled)
      .then(answer("a", "yes_other_times", ALL_OPEN)).then(settled)
      .then(tick(27, ALL_OPEN)).then(settled)
      .expect(stat(s, "o1", "a") == "available" and mm(s, "a").aw.kind == "none" and slotOwnerAlive)
      .then(answer("a", "no", ALL_OPEN)).then(settled)
      .expect(op(s, "o1").stage == "closed" and op(s, "o1").revealSent == Set() and safety)
}
```
