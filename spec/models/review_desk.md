# Staff review desk

## Story: Staff review desk

A reviewer needs each decision to apply to the selected opportunity and its drafts before the deadline.

### Safety rules and reachability

Check selection, repeat actions, deadline, direction, and draft ownership. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/review_desk.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=20000
//
// review_desk: the staff review desk and the matching switch of the Observatory, on the browser side.
//
// WHAT THIS MODELS
//   - The review queue (ReviewQueue and ReviewActions in packages/observatory/web/review.tsx). Items
//     arrive, close, expire and come back after a re-roll. The selected card is derived on each render
//     (focus link, then the held selection, then the head of the list sorted by deadline). The
//     reviewer presses keys (held keys give repeat events), clicks buttons, opens modes (reject, edit,
//     re-roll), types drafts and a note, and closes and opens the drawer (the queue unmounts).
//   - The decisions in flight (store.decide and its `deciding` set in store.ts). Answers come late,
//     in any order, or fail. A failed answer can follow a decision that the server applied.
//   - The matching switch with two presses (Config in admin.tsx), for two admins. Each admin reads the
//     switch value from a fetch that can be stale.
//   Each LemmaScript step function in packages/observatory/web/logic/review.ts is a pure def here with
//   the same name and the same decision: ctlOk, rebind, choose, leaveMode, keyStep, toggleMode, settle,
//   moveOnAfter, approveBlock, flip. Each shell event is an action that calls it and does not decide again.
//   The server and the other reviewer are a nondeterministic environment.
//
// BOUNDS
//   Items 1..3. People 1..4: 1 and 2 are adults, 3 is a minor, 4 is unknown to the page. Pairs of
//   participants come from PAIRS. Two reasons (reason 2 is "other" and needs a note). Time 0..MAX_T
//   ticks; a deadline is 2..4 ticks after arrival or re-roll. Two admins. At most 2 queue instances
//   (one remount). The page clock can lag the real clock.
//
// RUN (from the repository root; quint 0.33.1; there is no Apalache in this setup)
//   quint typecheck quint/review_desk.qnt
//   quint test quint/review_desk.qnt                 # 7 replayed traces (run ...Test)
//   quint run quint/review_desk.qnt --invariant=safety --max-samples=2000 --max-steps=20 --seed=11
//   quint run quint/review_desk.qnt --invariant=<name> --max-samples=2000 --max-steps=20 --seed=11
//   Each witness_<name> must be VIOLATED (the state is reachable). witness_lateAnswerElsewhere is a
//   long path: use --max-samples=20000 --max-steps=30 (lateAnswerStaysTest also reaches it).
//   decisionOnlyToReviewerChoice (the remount variant of bug 3) is fixed and is now part of safety:
//   quint run quint/review_desk.qnt --invariant=decisionOnlyToReviewerChoice --max-samples=20000 --max-steps=20 --seed=11
//   (and --seed=29). remountMovesChoiceTest replays the old trace and shows that it now holds.
//   serverApproveBeforeDeadline (bug 4 of the slice report, server side) is fixed: ConsentNetwork.reviewBlock
//   refuses every decision at or past the deadline (network.ts reviewBlock, transitions.ts reviewLate,
//   SD-009). It is now part of safety.
//   KNOWN DEFECT (expected to be violated today, see the comment at it):
//   approveMatchesSeenPeople (gap G6, server side; random run finds it).
//
// OUTSIDE THE MODEL
//   - React timing. ASSUMPTION: after each store change or state set, React renders before the next
//     event (discrete events and useSyncExternalStore flush on the sync lane). So each action ends
//     with its render. The `live` ref of the queue is then always the last render.
//   - The text of drafts and notes. A draft is the id of the item whose texts were loaded, plus a flag
//     "changed". editsOf gives edits only when the drafts changed. A note is the id of the card on
//     which it was typed.
//   - The opportunity panel (panels.tsx) has its own controller with key={f.id}. Not modelled.
//   - Errors and toasts (bug 6), the score disclosure, Enter on a focused button (bug 14), popovers.
//   - The server rules are oracles: participant checks (reviewBlock), the 4 s timer is ARM_T ticks,
//     the app switch that clears the pending press is the same as the timer.
//   - Report actions (reportOffer) and the line text (reviewStatus) have no browser state machine
//     here. LemmaScript proves them.
//   - Integers are small; the proof has ideal numbers. NaN is outside both.
module review_desk {

  // ---------------------------------------------------------------- constants
  pure val ITEMS = Set(1, 2, 3)
  pure val MAX_T = 8
  pure val ARM_T = 2
  pure val REASONS = 2
  pure val CAN_ACT = true
  pure val PAIRS = Set([1, 2], [2, 1], [1, 3], [2, 4])
  pure val ADMINS = Set(1, 2)
  // Bug 4 is fixed: network.ts reviewBlock refuses every decision (approve, edit, reject, re-roll) with
  // "review_expired" when reviewLate(now, deadline), that is now >= deadline. true = the shipping server.
  pure val SERVER_CHECKS_DEADLINE = true

  // ---------------------------------------------------------------- core types (logic/review.ts)
  // Mode: "idle" | "reject" | "edit" | "reroll". Ids are ints; 0 is the empty id "".
  type Ctl = { mode: str, boundId: int, draftsId: int, chosen: bool }
  // Key: "a" | "r" | "e" | "s" | "digit" | "esc"
  type Press = { key: str, digit: int, repeat: bool, blocked: bool, canAct: bool, reasons: int, swaps: int }
  // Cmd tag: "nothing" | "approve" | "reject" | "reroll"
  type Cmd = { tag: str, id: int, withEdits: bool, digit: int }
  type Step = { ctl: Ctl, cmd: Cmd }
  type Person = { minor: bool, declined: bool }
  type Pending = { active: bool, target: bool }
  type Flip = { pending: Pending, send: bool, on: bool }

  pure val NOTHING: Cmd = { tag: "nothing", id: 0, withEdits: false, digit: 0 }

  // People as the page knows them (store.members). Person 4 is not in the map.
  pure val PEOPLE: int -> Person = Map(
    1 -> { minor: false, declined: false },
    2 -> { minor: false, declined: false },
    3 -> { minor: true, declined: false })

  // ---------------------------------------------------------------- core step functions
  // Each def has the name and the decision of the function in packages/observatory/web/logic/review.ts.

  pure def ctlOk(c: Ctl): bool =
    and {
      c.draftsId == 0 or c.draftsId == c.boundId,
      c.mode != "edit" or c.draftsId == c.boundId,
      c.chosen or (c.mode == "idle" and c.draftsId == 0),
    }

  pure def rebind(ctl: Ctl, selId: int): Ctl =
    if (ctl.boundId == selId) ctl
    else { mode: "idle", boundId: selId, draftsId: 0, chosen: false }

  pure def choose(ctl: Ctl, id: int): Ctl =
    val c = rebind(ctl, id)
    { mode: c.mode, boundId: c.boundId, draftsId: c.draftsId, chosen: true }

  pure def leaveMode(c: Ctl): Ctl =
    { mode: "idle", boundId: c.boundId, draftsId: if (c.mode == "edit") 0 else c.draftsId, chosen: c.chosen }

  pure def keyStep(ctl0: Ctl, selId: int, p: Press): Step =
    val ctl = rebind(ctl0, selId)
    if (p.key == "esc") { ctl: leaveMode(ctl), cmd: NOTHING }
    else if (p.repeat or not(p.canAct)) { ctl: ctl, cmd: NOTHING }
    // The first press on a card that nobody chose only marks it as chosen.
    else if (ctl0.boundId != selId or not(ctl0.chosen)) { ctl: choose(ctl0, selId), cmd: NOTHING }
    else if (p.key == "a")
      if (p.blocked) { ctl: ctl, cmd: NOTHING }
      else { ctl: ctl, cmd: { tag: "approve", id: selId, withEdits: ctl.draftsId == selId, digit: 0 } }
    else if (p.key == "digit")
      if (ctl.mode == "reject" and p.digit >= 1 and p.digit <= p.reasons)
        { ctl: ctl, cmd: { tag: "reject", id: selId, withEdits: false, digit: p.digit } }
      else if (ctl.mode == "reroll" and p.digit >= 1 and p.digit <= p.swaps)
        { ctl: ctl, cmd: { tag: "reroll", id: selId, withEdits: false, digit: p.digit } }
      else { ctl: ctl, cmd: NOTHING }
    else if (p.key == "r") { ctl: { mode: "reject", boundId: selId, draftsId: ctl.draftsId, chosen: true }, cmd: NOTHING }
    else if (p.key == "s")
      if (p.swaps < 1) { ctl: ctl, cmd: NOTHING }
      else { ctl: { mode: "reroll", boundId: selId, draftsId: ctl.draftsId, chosen: true }, cmd: NOTHING }
    else { ctl: { mode: "edit", boundId: selId, draftsId: selId, chosen: true }, cmd: NOTHING }

  pure def toggleMode(ctl: Ctl, id: int, m: str): Ctl =
    val c = choose(ctl, id)
    if (c.mode == m) leaveMode(c)
    else { mode: m, boundId: id, draftsId: if (m == "edit") id else c.draftsId, chosen: true }

  pure def settle(ctl: Ctl, id: int): Ctl =
    if (ctl.boundId != id) ctl
    else { mode: "idle", boundId: id, draftsId: 0, chosen: ctl.chosen }

  // An answer moves the selection only in a mounted queue, and only when the reviewer did not choose another card.
  pure def moveOnAfter(mounted: bool, ctl: Ctl, id: int): bool =
    mounted and (not(ctl.chosen) or ctl.boundId == id)

  // Block: "read_only" | "minor" | "declined" | "matching_off" | "expired" | "idle".
  // A person that the page does not know blocks like a minor.
  pure def approveBlock(canAct: bool, ids: List[int], people: int -> Person, matchingOff: bool, now: int, deadline: int): str =
    if (not(canAct)) "read_only"
    else if (ids.foldl(false, (b, i) => b or not(people.keys().contains(i)) or people.get(i).minor)) "minor"
    else if (ids.foldl(false, (b, i) => b or (people.keys().contains(i) and people.get(i).declined))) "declined"
    else if (matchingOff) "matching_off"
    else if (now < deadline) "idle"
    else "expired"

  pure def flip(p: Pending, current: bool): Flip =
    if (not(p.active)) { pending: { active: true, target: not(current) }, send: false, on: current }
    else if (p.target == current) { pending: { active: false, target: current }, send: false, on: current }
    else { pending: { active: false, target: current }, send: true, on: p.target }

  // ---------------------------------------------------------------- environment and shell types
  // decision: "pending" | "approve" | "reject" | "expired". A re-roll with no alternate closes the
  // item with decision "pending" and inReview false.
  type SrvItem = { arrived: bool, inReview: bool, decision: str, deadline: int, version: int,
                   parts: List[int], decidedAt: int, approvedVersion: int }
  // What the page store holds for an item (pushed by the server, possibly late).
  type ViewItem = { known: bool, inReview: bool, deadline: int, version: int, parts: List[int] }
  type Drafts = { from: int, changed: bool }
  // The queue component (one mount). inst counts mounts.
  type Browser = { inst: int, ctl: Ctl, drafts: Drafts, note: int, awaiting: bool,
                   selHeld: int, sel: int, pending: List[int] }
  // The last render of an unmounted queue: its closures still run when an old answer arrives.
  type OldQueue = { inst: int, ctl: Ctl, sel: int, pending: List[int] }
  // One decision request. The fields after `kind` are ghost facts for the invariants.
  type Req = { rid: int, inst: int, id: int, kind: str, editsFrom: int, noteFrom: int,
               repeat: bool, sel: int, boundBefore: int, chosenBefore: bool, choiceBefore: int,
               draftsBefore: Drafts, blocked: bool, pageNow: int, pageDeadline: int, version: int }
  type Ans = { rid: int, inst: int, id: int, kind: str, ok: bool }
  type Admin = { pending: Pending, armedAt: int, cfg: bool, asked: bool }
  type MReq = { mid: int, admin: int, on: bool, asked: bool }

  type State = {
    now: int, pageNow: int,
    srv: int -> SrvItem, matchingOn: bool,
    mirror: int -> ViewItem, viewMatchingOn: bool,
    focus: int, deciding: Set[int],
    br: Browser, old: OldQueue,
    // ghost: the card that the reviewer last chose (see decisionOnlyToReviewerChoice).
    choice: int,
    inflight: Set[Req], answers: Set[Ans], sent: Set[Req], nextRid: int,
    admins: int -> Admin, mflight: Set[MReq], msent: Set[MReq], nextMid: int,
    // ghost counters for witnesses
    repeats: int, lateElsewhere: int, oldAnswers: int, raceSkips: int,
  }

  var s: State

  // ---------------------------------------------------------------- shell helpers
  pure def viewOf(it: SrvItem): ViewItem =
    { known: it.arrived, inReview: it.inReview, deadline: it.deadline, version: it.version, parts: it.parts }

  // reviewPending: the items in review, sorted by deadline, then id.
  pure def pendingOf(m: int -> ViewItem): List[int] =
    val ids = ITEMS.filter(i => m.get(i).known and m.get(i).inReview)
    pure def before(j: int, i: int): bool =
      m.get(j).deadline < m.get(i).deadline or (m.get(j).deadline == m.get(i).deadline and j < i)
    pure def rank(i: int): int = ids.filter(j => before(j, i)).size()
    range(0, ids.size()).foldl([], (acc, k) => acc.append(ids.filter(i => rank(i) == k).getOnlyElement()))

  pure def has(l: List[int], x: int): bool = l.foldl(false, (b, y) => b or y == x)
  pure def indexOf(l: List[int], x: int): int =
    range(0, l.length()).foldl(-1, (acc, i) => if (acc < 0 and l[i] == x) i else acc)

  // useReviewCtl.commit: what is typed for one item leaves with that item.
  pure def commitB(b: Browser, nxt: Ctl): Browser =
    val left = nxt.boundId != b.ctl.boundId
    { ...b,
      ctl: nxt,
      note: if (left) 0 else b.note,
      drafts: if (left or nxt.draftsId == 0) { from: 0, changed: false } else b.drafts,
      awaiting: if (left or nxt.mode != b.ctl.mode) false else b.awaiting }

  // applyStep: commit, then load the drafts of item o when the step opened the editor.
  pure def applyStepB(b: Browser, o: int, nxt: Ctl): Browser =
    val b1 = commitB(b, nxt)
    if (nxt.draftsId == o and b.ctl.draftsId != o) { ...b1, drafts: { from: o, changed: false } } else b1

  // The render of ReviewQueue: derive `sel`, then the controller follows it in the same render, then
  // the effect holds the card (setSelId).
  pure def render(st: State): State =
    val pend = pendingOf(st.mirror)
    val b = st.br
    val sel = if (st.focus != 0 and has(pend, st.focus)) st.focus
              else if (b.selHeld != 0 and has(pend, b.selHeld)) b.selHeld
              else if (pend.length() > 0) pend[0]
              else 0
    val b1 = if (sel != 0 and b.ctl.boundId != sel)
               commitB(b, if (st.focus == sel) choose(b.ctl, sel) else rebind(b.ctl, sel))
             else b
    { ...st, br: { ...b1, sel: sel, pending: pend, selHeld: if (sel != 0) sel else b1.selHeld } }

  // select(o) in ReviewQueue: the reviewer's choice (j, k, a card head, or the move after a decision).
  pure def selectB(st: State, n: int): State =
    { ...st, br: { ...commitB(st.br, choose(st.br.ctl, n)), selHeld: n }, focus: n }

  pure def blockedOf(st: State, o: int): bool =
    val m = st.mirror.get(o)
    approveBlock(CAN_ACT, m.parts, PEOPLE, not(st.viewMatchingOn), st.pageNow, m.deadline) != "idle"

  // store.decide: one decision per item at a time. A second press while the first is in flight sends nothing.
  pure def sendReq(st: State, b0: Browser, o: int, kind: str, editsFrom: int, repeat: bool): State =
    if (st.deciding.contains(o)) st
    else
      val m = st.mirror.get(o)
      val r: Req = { rid: st.nextRid, inst: b0.inst, id: o, kind: kind, editsFrom: editsFrom, noteFrom: b0.note,
                     repeat: repeat, sel: b0.sel, boundBefore: b0.ctl.boundId, chosenBefore: b0.ctl.chosen,
                     choiceBefore: st.choice, draftsBefore: b0.drafts, blocked: blockedOf(st, o),
                     pageNow: st.pageNow, pageDeadline: m.deadline, version: m.version }
      { ...st, deciding: st.deciding.union(Set(o)), inflight: st.inflight.union(Set(r)),
               sent: st.sent.union(Set(r)), nextRid: st.nextRid + 1 }

  // press() in review.tsx: the proved reducer decides, the shell runs what it returned.
  // b0 is the controller that the press reads (after the click's choose on the button path).
  pure def doPress(st0: State, o: int, key: str, digit: int, repeat: bool): State =
    val b0 = st0.br
    val m = st0.mirror.get(o)
    val step = keyStep(b0.ctl, o, { key: key, digit: digit, repeat: repeat, blocked: blockedOf(st0, o),
                                    canAct: CAN_ACT, reasons: REASONS, swaps: m.parts.length() })
    val b1 = applyStepB(b0, o, step.ctl)
    // ghost: a fresh key press on the visible card is a choice of that card (recorded after the send).
    val st1 = { ...st0, br: b1, repeats: if (repeat) st0.repeats + 1 else st0.repeats }
    val cmd = step.cmd
    val st2 =
      if (cmd.tag == "approve")
        // act(): editsOf(o, c.drafts) gives edits only when withEdits and the drafts changed.
        val edit = cmd.withEdits and b0.drafts.from != 0 and b0.drafts.changed
        sendReq(st1, b0, o, if (edit) "edit" else "approve", if (edit) b0.drafts.from else 0, repeat)
      else if (cmd.tag == "reject")
        if (cmd.digit == REASONS and b0.note == 0) { ...st1, br: { ...b1, awaiting: true } }
        else sendReq(st1, b0, o, "reject", 0, repeat)
      else if (cmd.tag == "reroll") sendReq(st1, b0, o, "reroll", 0, repeat)
      else st1
    { ...st2, choice: if (not(repeat) and key != "esc") o else st2.choice }

  // afterDecision (the live queue, or the closure of an unmounted one): moveOnAfter decides. An
  // unmounted queue (live = false) does nothing: its `mounted` ref is false. `allowed` is the ghost
  // rule: the move counts as the reviewer's choice only when their last choice was the decided item,
  // or is no longer in the queue.
  pure def afterDecision(st: State, core: Ctl, pend: List[int], sel: int, id: int, live: bool): State =
    if (not(moveOnAfter(live, core, id))) st
    else
      val i = indexOf(pend, id)
      val n = if (i < 0) sel
              else if (i + 1 < pend.length()) pend[i + 1]
              else if (i >= 1) pend[i - 1]
              else 0
      val allowed = st.choice == id or not(has(st.br.pending, st.choice))
      val st1 = if (n == 0) (if (live) { ...st, br: { ...st.br, selHeld: 0 } } else st)
                else selectB(st, n)
      if (n != 0 and allowed) { ...st1, choice: n } else st1

  // ---------------------------------------------------------------- init
  pure val NO_ITEM: SrvItem = { arrived: false, inReview: false, decision: "pending", deadline: 0, version: 0,
                                parts: [], decidedAt: -1, approvedVersion: -1 }
  pure val NO_VIEW: ViewItem = { known: false, inReview: false, deadline: 0, version: 0, parts: [] }
  pure val IDLE: Ctl = { mode: "idle", boundId: 0, draftsId: 0, chosen: false }

  action init = { nondet on = Set(true, false).oneOf() initWith(on) }
  action initWith(on: bool): bool = all {
    s' = {
      now: 0, pageNow: 0,
      srv: ITEMS.mapBy(_ => NO_ITEM), matchingOn: on,
      mirror: ITEMS.mapBy(_ => NO_VIEW), viewMatchingOn: on,
      focus: 0, deciding: Set(),
      br: { inst: 1, ctl: IDLE, drafts: { from: 0, changed: false }, note: 0, awaiting: false,
            selHeld: 0, sel: 0, pending: [] },
      old: { inst: 0, ctl: IDLE, sel: 0, pending: [] },
      choice: 0,
      inflight: Set(), answers: Set(), sent: Set(), nextRid: 1,
      admins: ADMINS.mapBy(_ => { pending: { active: false, target: false }, armedAt: 0, cfg: on, asked: false }),
      mflight: Set(), msent: Set(), nextMid: 1,
      repeats: 0, lateElsewhere: 0, oldAnswers: 0, raceSkips: 0,
    },
  }

  // ---------------------------------------------------------------- environment actions
  action tick = all { s.now < MAX_T, s' = { ...s, now: s.now + 1 } }
  // The page clock follows the pushed clock; it can lag (G4: it stops while the socket is down).
  action pageClockSync = all { s.pageNow < s.now, s' = render({ ...s, pageNow: s.now }) }

  action arriveItem(id: int, d: int, pair: List[int]): bool = all {
    not(s.srv.get(id).arrived),
    s' = { ...s, srv: s.srv.set(id, { ...NO_ITEM, arrived: true, inReview: true, deadline: s.now + d, parts: pair }) },
  }
  action arrive = {
    nondet id = ITEMS.filter(i => not(s.srv.get(i).arrived)).oneOf()
    nondet d = Set(2, 3, 4).oneOf()
    nondet pair = PAIRS.oneOf()
    arriveItem(id, d, pair)
  }

  // The server tick expires an item at or after its deadline. The tick can come late.
  action serverExpire = {
    nondet id = ITEMS.filter(i => s.srv.get(i).inReview and s.now >= s.srv.get(i).deadline).oneOf()
    s' = { ...s, srv: s.srv.set(id, { ...s.srv.get(id), inReview: false, decision: "expired" }) }
  }

  // Another reviewer decides or re-rolls an item.
  action otherReviewer = {
    nondet id = ITEMS.filter(i => s.srv.get(i).inReview).oneOf()
    nondet what = Set("approve", "reject", "reroll", "close").oneOf()
    nondet pair = PAIRS.oneOf()
    otherReviewerOf(id, what, pair)
  }
  action otherReviewerOf(id: int, what: str, pair: List[int]): bool = all {
    s.srv.get(id).inReview,
    val it = s.srv.get(id)
    val it2 =
      if (what == "reroll") { ...it, deadline: s.now + 3, version: it.version + 1, parts: pair }
      else if (what == "close") { ...it, inReview: false }
      else { ...it, inReview: false, decision: what, decidedAt: s.now }
    s' = { ...s, srv: s.srv.set(id, it2) },
  }

  // A push of one item to the page store. Pushes come in any order and can repeat.
  action pushItem(id: int): bool = all {
    s.srv.get(id).arrived,
    s' = render({ ...s, mirror: s.mirror.set(id, viewOf(s.srv.get(id))) }),
  }
  action push = { nondet id = ITEMS.filter(i => s.srv.get(i).arrived).oneOf() pushItem(id) }
  action pushMatching = s' = render({ ...s, viewMatchingOn: s.matchingOn })

  pure def partsOk(parts: List[int]): bool =
    parts.foldl(true, (b, i) => b and PEOPLE.keys().contains(i) and not(PEOPLE.get(i).minor) and not(PEOPLE.get(i).declined))

  // The server applies one decision (ConsentNetwork.decide under its lock, after reviewBlock). `lost`:
  // the answer that reaches the page says "failed", whether or not the server applied it. reviewBlock
  // refuses any decision past the deadline, and an approve (or edit) with matching off or with a
  // participant who is a minor, declined or unknown.
  action serverApply = {
    nondet r = s.inflight.oneOf()
    nondet lost = Set(true, false).oneOf()
    nondet applied = Set(true, false).oneOf()
    nondet alt = Set(true, false).oneOf()
    nondet pair = PAIRS.oneOf()
    serverApplyReq(r.rid, lost, applied, alt, pair)
  }
  action serverApplyReq(rid: int, lost: bool, applied: bool, alt: bool, pair: List[int]): bool = all {
    s.inflight.exists(x => x.rid == rid),
    val r = s.inflight.filter(x => x.rid == rid).getOnlyElement()
    val it = s.srv.get(r.id)
    val accept = it.inReview and (not(SERVER_CHECKS_DEADLINE) or s.now < it.deadline) and
      (r.kind == "reject" or r.kind == "reroll" or (partsOk(it.parts) and s.matchingOn))
    val doIt = accept and (not(lost) or applied)
    val it2 =
      if (not(doIt)) it
      else if (r.kind == "reroll")
        if (alt) { ...it, deadline: s.now + 3, version: it.version + 1, parts: pair }
        else { ...it, inReview: false }
      else if (r.kind == "reject") { ...it, inReview: false, decision: "reject", decidedAt: s.now }
      else { ...it, inReview: false, decision: "approve", decidedAt: s.now, approvedVersion: r.version }
    s' = { ...s,
      srv: s.srv.set(r.id, it2),
      inflight: s.inflight.exclude(Set(r)),
      answers: s.answers.union(Set({ rid: r.rid, inst: r.inst, id: r.id, kind: r.kind, ok: accept and not(lost) })),
    }
  }

  // ---------------------------------------------------------------- shell actions (reviewer)
  // An answer reaches the page, in any order. store.decide removes the id from `deciding`; act()
  // settles the controller on success; onDone runs afterDecision for approve and reject.
  action deliver = { nondet a = s.answers.oneOf() deliverAns(a.rid) }
  action deliverAns(rid: int): bool = all {
    s.answers.exists(x => x.rid == rid),
    val a = s.answers.filter(x => x.rid == rid).getOnlyElement()
    val st0 = { ...s, answers: s.answers.exclude(Set(a)), deciding: s.deciding.exclude(Set(a.id)) }
    val live = a.inst == s.br.inst
    val elsewhere = s.br.ctl.chosen and s.br.ctl.boundId != a.id
    val st1 =
      if (not(a.ok)) st0
      else if (live)
        val st2 = { ...st0, br: commitB(st0.br, settle(st0.br.ctl, a.id)) }
        if (a.kind == "reroll") st2 else afterDecision(st2, st2.br.ctl, st2.br.pending, st2.br.sel, a.id, true)
      else if (a.kind == "reroll") st0
      else afterDecision(st0, s.old.ctl, s.old.pending, s.old.sel, a.id, false)
    s' = render({ ...st1,
      lateElsewhere: if (a.ok and live and elsewhere) st1.lateElsewhere + 1 else st1.lateElsewhere,
      oldAnswers: if (a.ok and not(live)) st1.oldAnswers + 1 else st1.oldAnswers }),
  }

  // The queue keyboard handler (capture phase). It filters keys as onKey does, then calls press().
  action keyPress = {
    nondet key = Set("a", "r", "e", "s", "digit", "esc").oneOf()
    nondet digit = Set(1, 2, 3).oneOf()
    nondet repeat = Set(true, false).oneOf()
    keyPressOf(key, digit, repeat)
  }
  action keyPressOf(key: str, digit: int, repeat: bool): bool = {
    val b = s.br
    val o = b.sel
    val mode = b.ctl.mode
    all {
      o != 0,
      if (key == "esc") mode != "idle"
      else if (key == "digit") (mode == "reject" and digit <= 8) or (mode == "reroll" and digit <= s.mirror.get(o).parts.length())
      else CAN_ACT,
      s' = render(doPress(s, o, key, digit, repeat)),
    }
  }

  // j, k or a click on a card head: select(o).
  action selectCard = { nondet n = ITEMS.filter(i => has(s.br.pending, i)).oneOf() selectCardOf(n) }
  action selectCardOf(n: int): bool = {
    all { has(s.br.pending, n), s' = render({ ...selectB(s, n), choice: n }) }
  }

  // A focus link from the map, the pipeline or a search result.
  action focusLink = { nondet n = ITEMS.filter(i => s.mirror.get(i).known).oneOf() focusLinkOf(n) }
  action focusLinkOf(n: int): bool = {
    all { s.mirror.get(n).known, s' = render({ ...s, focus: n, choice: if (has(s.br.pending, n)) n else s.choice }) }
  }

  // Buttons on the selected card. click(): the click chooses this card, then press().
  action clickButton = {
    nondet key = Set("a", "digit").oneOf()
    nondet digit = Set(1, 2, 3).oneOf()
    clickButtonOf(key, digit)
  }
  action clickButtonOf(key: str, digit: int): bool = {
    val o = s.br.sel
    val mode = s.br.ctl.mode
    all {
      o != 0, CAN_ACT,
      if (key == "a") not(blockedOf(s, o))   // the Approve button is disabled when blocked
      else (mode == "reject" and digit <= REASONS) or (mode == "reroll" and digit <= s.mirror.get(o).parts.length()),
      s' = render(doPress({ ...s, br: commitB(s.br, choose(s.br.ctl, o)), choice: o }, o, key, digit, false)),
    }
  }

  // The Edit, Re-roll and Reject buttons: toggle().
  action clickToggle = {
    nondet m = Set("edit", "reroll", "reject").oneOf()
    val o = s.br.sel
    all {
      o != 0, CAN_ACT,
      s' = render({ ...s, br: { ...applyStepB(s.br, o, toggleMode(s.br.ctl, o, m)), awaiting: false }, choice: o }),
    }
  }

  // Typing in the editor (only shown in edit mode on the selected card) or in the note field.
  action typeDraft = all {
    s.br.sel != 0, s.br.ctl.mode == "edit", s.br.ctl.boundId == s.br.sel,
    s' = { ...s, br: { ...s.br, drafts: { ...s.br.drafts, changed: true } } },
  }
  action typeNote = all { s.br.sel != 0, s' = { ...s, br: { ...s.br, note: s.br.sel } } }

  // The drawer closes and opens again: the queue unmounts and mounts. useReviewCtl(initial) marks the
  // first card as chosen. `deciding` and `focus` live in the store and stay.
  action remount = all {
    s.br.inst < 2,
    val pend = pendingOf(s.mirror)
    val init = if (s.focus != 0 and has(pend, s.focus)) s.focus else if (pend.length() > 0) pend[0] else 0
    s' = render({ ...s,
      old: { inst: s.br.inst, ctl: s.br.ctl, sel: s.br.sel, pending: s.br.pending },
      br: { inst: s.br.inst + 1, ctl: { mode: "idle", boundId: init, draftsId: 0, chosen: init != 0 },
            drafts: { from: 0, changed: false }, note: 0, awaiting: false, selHeld: 0, sel: 0, pending: [] },
      choice: init }),
  }

  // ---------------------------------------------------------------- shell actions (admins)
  // A press on the matching switch: flip() decides; the shell sends only what it returned.
  action adminPress = { nondet a = ADMINS.oneOf() adminPressOf(a) }
  action adminPressOf(a: int): bool = {
    val ad = s.admins.get(a)
    val step = flip(ad.pending, ad.cfg)
    // ghost: the label read on the first press ("Turn off" when the page shows on).
    val asked = if (not(ad.pending.active)) not(ad.cfg) else ad.asked
    val ad2 = { ...ad, pending: step.pending, armedAt: if (step.pending.active) s.now else ad.armedAt, asked: asked }
    val m: MReq = { mid: s.nextMid, admin: a, on: step.on, asked: asked }
    s' = { ...s,
      admins: s.admins.set(a, ad2),
      mflight: if (step.send) s.mflight.union(Set(m)) else s.mflight,
      msent: if (step.send) s.msent.union(Set(m)) else s.msent,
      nextMid: if (step.send) s.nextMid + 1 else s.nextMid,
      raceSkips: if (ad.pending.active and not(step.send)) s.raceSkips + 1 else s.raceSkips }
  }
  // The 4 s timer (or an app switch) clears the first press.
  action adminTimeout = {
    nondet a = ADMINS.oneOf()
    val ad = s.admins.get(a)
    all { ad.pending.active, s.now - ad.armedAt >= ARM_T,
          s' = { ...s, admins: s.admins.set(a, { ...ad, pending: { active: false, target: false } }) } }
  }
  // useFetch reloads the config: the page now shows the server value.
  action adminReload = { nondet a = ADMINS.oneOf() adminReloadOf(a) }
  action adminReloadOf(a: int): bool = s' = { ...s, admins: s.admins.set(a, { ...s.admins.get(a), cfg: s.matchingOn }) }
  // The server applies one switch command, in any order.
  action serverMatching = { nondet m = s.mflight.oneOf() serverMatchingOf(m.mid) }
  action serverMatchingOf(mid: int): bool = all {
    s.mflight.exists(m => m.mid == mid),
    val m = s.mflight.filter(x => x.mid == mid).getOnlyElement()
    s' = { ...s, matchingOn: m.on, mflight: s.mflight.exclude(Set(m)) },
  }

  action step = any {
    tick, pageClockSync, arrive, serverExpire, otherReviewer, push, pushMatching, serverApply,
    deliver, keyPress, selectCard, focusLink, clickButton, clickToggle, typeDraft, typeNote, remount,
    adminPress, adminTimeout, adminReload, serverMatching,
  }

  // ---------------------------------------------------------------- invariants
  // Rule: logic/review.ts, the controller rule ctlOk. LemmaScript: every step function ensures
  // ctlOk(\result) (rebind, choose, leaveMode, keyStep, toggleMode, settle).
  val ctlOkHolds = ctlOk(s.br.ctl)

  // Rule: AGENTS.md "Every proactive proposal ... must go through human review"; slice report
  // I1 (bugs 1, 16). LemmaScript: keyStep, ensures `cmd.tag === "approve" ==> cmd.id === selId &&
  // ctl0.boundId === selId && ctl0.chosen` (and the same for reject and reroll). Here: each decision
  // goes to the card on view, and the controller was bound to it and chosen before the press.
  val decisionOnlyToChosenItem = s.sent.forall(r => r.id == r.sel and r.boundBefore == r.id and r.chosenBefore)

  // Rule: as above, judged by a ghost that does not read the core: the card that the reviewer last
  // chose (j, k, a click, a focus link, a key press, the mount default, or the move after their own
  // decision). Shell: afterDecision and select in review.tsx. LemmaScript: moveOnAfter, ensures
  // `!mounted ==> !\result` and `ctl.chosen && ctl.boundId !== id ==> !\result`. The remount variant
  // of bug 3 is fixed: an answer for an unmounted queue no longer calls store.focus.
  val decisionOnlyToReviewerChoice = s.sent.forall(r => r.id == r.choiceBefore)

  // Rule: slice report I2 (bug 2), "a person reviews every proposal". LemmaScript: keyStep, ensures
  // `p.repeat ==> \result.cmd.tag === "nothing"`.
  val repeatNeverDecides = s.sent.forall(r => not(r.repeat))

  // Rule: docs/admin-console.md 3.2 "an expired proposal is never sent late"; slice report I4 (bug 4,
  // page side). LemmaScript: approveBlock, ensures `\result === "idle" <==> (... && now < deadline &&
  // ...)`; keyStep, ensures `cmd.tag === "approve" ==> ... && !p.blocked`. The page sends an approve
  // only when its own clock is before the deadline that it shows, and approval is not blocked.
  val approveOnlyBeforeDeadline =
    s.sent.forall(r => (r.kind == "approve" or r.kind == "edit") implies (not(r.blocked) and r.pageNow < r.pageDeadline))

  // Rule: the same rule, on the server. Bug 4 is fixed: network.ts reviewBlock refuses a decision when
  // reviewLate(now, deadline), so an approve after the deadline is refused even before the tick expires
  // the item, and even when the page clock lags (G4). LemmaScript: transitions.ts reviewLate,
  // `ensures \result <==> now >= deadline`; quint/opportunity.qnt decidedBeforeDeadline.
  val serverApproveBeforeDeadline =
    ITEMS.forall(i => s.srv.get(i).decision == "approve" and s.srv.get(i).approvedVersion >= 0
                      implies s.srv.get(i).decidedAt < s.srv.get(i).deadline)

  // Rule: slice report J5 (bug 11): the confirm press sends the direction the first press asked for.
  // LemmaScript: flip, ensures `\result.send ==> p.active && \result.on === p.target && \result.on !== current`.
  val confirmSendsAskedDirection = s.msent.forall(m => m.on == m.asked)

  // Rule: slice report bug 1 (A's plan sent to B), S4. LemmaScript: ctlOk (drafts belong to the bound
  // item), keyStep ensures `cmd.withEdits === (ctl0.draftsId === selId)` and `\result.ctl.draftsId ===
  // selId && ctl0.draftsId !== selId ==> p.key === "e" && ...`; rebind ensures the drafts never follow
  // the selection. Edits and the note go only to the item they were written for.
  val draftsBoundToItem = and {
    s.sent.forall(r => (r.kind == "edit" implies r.editsFrom == r.id) and (r.noteFrom == 0 or r.noteFrom == r.id)),
    s.br.drafts.from == s.br.ctl.draftsId,
  }

  // Rule: slice report I6 (bug 5): an approve after an edit sends the edit. LemmaScript: keyStep,
  // ensures `cmd.withEdits === (ctl0.draftsId === selId)`.
  val approveCarriesOwnDrafts =
    s.sent.forall(r => (r.kind == "approve" or r.kind == "edit") implies
      ((r.kind == "edit") iff (r.draftsBefore.from == r.id and r.draftsBefore.changed)))

  // Rule: slice report gap G6. KNOWN DEFECT (server side): a decision names the item id only, so an
  // approve can land after another reviewer re-rolled the item to people the reviewer did not see.
  // LemmaScript: none (needs a version in the wire request).
  val approveMatchesSeenPeople =
    ITEMS.forall(i => s.srv.get(i).decision == "approve" and s.srv.get(i).approvedVersion >= 0
                      implies s.srv.get(i).approvedVersion == s.srv.get(i).version)

  // The invariants that hold today. The KNOWN DEFECT invariant (approveMatchesSeenPeople) is checked alone.
  val safety = and {
    ctlOkHolds, decisionOnlyToChosenItem, decisionOnlyToReviewerChoice, repeatNeverDecides, approveOnlyBeforeDeadline,
    serverApproveBeforeDeadline, confirmSendsAskedDirection, draftsBoundToItem, approveCarriesOwnDrafts,
  }

  // ---------------------------------------------------------------- reachability witnesses
  // Each must be VIOLATED by `quint run`: the state is reachable, so a pass above is not vacuous.
  val witness_approveSent = not(s.sent.exists(r => r.kind == "approve"))
  val witness_editSent = not(s.sent.exists(r => r.kind == "edit"))
  val witness_rejectSent = not(s.sent.exists(r => r.kind == "reject"))
  val witness_rerollSent = not(s.sent.exists(r => r.kind == "reroll"))
  val witness_repeatPressed = s.repeats == 0
  val witness_lateAnswerElsewhere = s.lateElsewhere == 0
  val witness_oldQueueAnswer = s.oldAnswers == 0
  val witness_itemExpired = not(ITEMS.exists(i => s.srv.get(i).decision == "expired"))
  val witness_flipSent = s.msent.size() == 0
  val witness_flipRaceSkipped = s.raceSkips == 0
  val witness_awaitingOther = not(s.br.awaiting)

  // ---------------------------------------------------------------- replayed traces
  // Three items with the same deadline, so the queue order is 1, 2, 3.
  action threeItems = initWith(true)
    .then(arriveItem(1, 4, [1, 2])).then(arriveItem(2, 4, [1, 2])).then(arriveItem(3, 4, [2, 1]))
    .then(pushItem(1)).then(pushItem(2)).then(pushItem(3))

  // Bug 16 is fixed: an item that nobody chose is never approved by the first press.
  run firstPressOnlyChoosesTest = threeItems
    .then(keyPressOf("a", 0, false))
    .then(all { assert(s.sent.size() == 0 and s.br.ctl.chosen and s.br.ctl.boundId == 1), s' = s })

  // Bug 2 is fixed: a held key (repeat events) decides nothing.
  run heldKeyTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, true)).then(keyPressOf("a", 0, true))
    .then(all { assert(s.sent.size() == 0), s' = s })

  // Bug 1 is fixed: drafts typed on item 1 do not go with a decision on item 2.
  run draftsStayTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("e", 0, false)).then(typeDraft)
    .then(focusLinkOf(2))
    .then(keyPressOf("a", 0, false))
    .then(all { assert(s.sent.forall(r => r.kind == "approve" and r.id == 2 and r.editsFrom == 0)
                       and s.br.drafts.from == 0), s' = s })

  // Bug 16 and bug 1 are fixed: the reviewer chose 1 and opened the editor. Another reviewer rejects
  // 1 and the push removes it. The selection moves by itself to 2, with no mode and no drafts; the
  // next press only chooses 2.
  run selectionMovesUnchosenTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("e", 0, false)).then(typeDraft)
    .then(otherReviewerOf(1, "reject", [1, 2])).then(pushItem(1))
    .then(all { assert(s.br.sel == 2 and not(s.br.ctl.chosen) and s.br.ctl.mode == "idle" and s.br.drafts.from == 0), s' = s })
    .then(keyPressOf("a", 0, false))
    .then(all { assert(s.sent.size() == 0 and s.br.ctl.chosen), s' = s })

  // Bug 3 is fixed in the live queue: approve 1, choose 3, the late answer for 1 leaves the card on 3.
  run lateAnswerStaysTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(selectCardOf(3))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(all { assert(s.br.sel == 3 and s.br.ctl.boundId == 3 and s.br.ctl.chosen and s.lateElsewhere == 1), s' = s })

  // Bug 11 is fixed: admin 1 presses "Turn off", admin 2 turns it off, admin 1 reloads and confirms.
  // Nothing is sent: the switch is already where admin 1 asked.
  run flipRaceTest = threeItems
    .then(adminPressOf(1)).then(adminPressOf(2)).then(adminPressOf(2))
    .then(serverMatchingOf(1)).then(adminReloadOf(1)).then(adminPressOf(1))
    .then(all { assert(not(s.matchingOn) and s.msent.size() == 1 and s.raceSkips == 1), s' = s })

  // The remount variant of bug 3 is fixed (found by this model): approve 1, close and open the
  // drawer, choose 3. The late answer for 1 reaches the old queue. Its afterDecision does nothing
  // (moveOnAfter: not mounted), so the card stays on 3 and the next press approves 3.
  // Before the fix, the old queue called store.focus(2) and the next press approved 2.
  run remountMovesChoiceTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(remount)
    .then(selectCardOf(3))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(all { assert(s.br.sel == 3 and s.br.ctl.chosen and s.choice == 3 and s.oldAnswers == 1), s' = s })
    .then(keyPressOf("a", 0, false))
    .then(all { assert(decisionOnlyToReviewerChoice and decisionOnlyToChosenItem
                       and s.sent.exists(r => r.id == 3 and r.kind == "approve")), s' = s })
}
```
