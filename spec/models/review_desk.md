# Staff review desk

## Story: Staff review desk

A reviewer needs each decision to apply to the selected opportunity and its drafts before the deadline.

### Safety rules and reachability

Check selection, repeat actions, deadline, direction, and draft ownership. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/review_desk.qnt` at `30d950e`. Compared with `vibestack-matching` on 2026-11-18 and rewritten around the generated controller. See [model index](README.md) for scope and commands.

The browser calls the [staff review controller](../staffReview.md) for selected card, mode, draft scope, and response ownership. The pure defs in this model have the names of that spec. The standalone model also explores server races and the matching switch.

Compared again 2026-11-19: `review.tsx`, `store.ts` and `admin.tsx` have not changed since the 2026-11-18 comparison; the server side (`ConsentNetwork.decide`, `reviewBlock`, `POST /review/:oppId` with its required revision) still agrees with `serverApply`. The only new code is the launch scope of the matching switch, which this model leaves out (see OUTSIDE THE MODEL).

Compared again 2026-11-21 (audit COV08): `review.tsx` (`ReviewQueue`, `onKey`, `approveBlock`, `act`, `ReviewActions`), `store.ts` (`decide`, `canAct`, `canReview`), `admin.tsx` (`Config`) and the generated `staffReview` controller have not changed since 2026-11-19. On the server, `POST /review/:oppId` (`service.ts`, role reviewer, a required integer revision) and `ConsentNetwork.decide` and `reviewBlock` (`network.ts`) still agree with `serverApply`: the deadline first (`review_expired`, and the item expires), then `review_stale` for another revision, then `reviewBlock` (a minor, declined or unknown participant, or matching paused, refuses approve and edit). Three server refusals are outside the model and do not change its traces: `note_required` (the page asks for the note first, `requireReviewNote`), and `staff_review_required` and `gathering_repeat_fixed_pair` for a monthly gathering repeat, which this model's queue does not hold. The key handler uses `store.canReview()` (reviewer role) and `approveBlock` uses `store.canAct()`; the model has one constant `CAN_ACT` for both. The key-repeat defect below is still in the code (`onKey` reads no `e.repeat`).

Open defect: the queue key handler in `packages/observatory/web/review.tsx` (`ReviewQueue`, `onKey`) does not ignore key-repeat events. A held `a` approves the selected card. When the accepted answer moves the selection, the next repeat event approves the next card. `repeatNeverDecides` states the rule. It is not part of `safety`; `heldKeyDecidesTest` replays the defect.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=20000
//
// review_desk: the staff review desk and the matching switch of the Observatory, on the browser side,
// with the server decisions as an environment.
//
// WHAT THIS MODELS (compared with vibestack-matching on 2026-11-18)
//   - The review queue (ReviewQueue, useReviewCtl, act and ReviewActions in packages/observatory/web/review.tsx).
//     Items arrive, close, expire and come back after a re-roll. The selected card is derived on each render
//     by selectedReviewCard (focus, then the held selection, then the head of the list sorted by deadline).
//     The draft controller is the generated controller of spec/staffReview.md
//     (packages/core/src/generated/staffReview.ts): bindCard, changeReviewMode, requireReviewNote,
//     ownsReviewResponse, settleReview. Each pure def below has the name and the decision of that spec.
//     The card key (reviewKey) is the opportunity id and its review revision (Review.rerolls). In the code
//     it also holds the app, the data mode, the sign-in epoch, the deadline and the participants; a re-roll
//     changes all of them together, so the revision stands for them here.
//   - The reviewer presses keys (held keys give repeat events), clicks buttons, opens modes (reject, edit,
//     re-roll), types drafts and a note, and closes and opens the drawer (the queue unmounts).
//   - The decisions in flight (store.decide and its `deciding` set in store.ts). Each decision carries the
//     revision that the page showed. Answers come late, in any order, or fail. A failed answer can follow
//     a decision that the server applied.
//   - The server decision (ConsentNetwork.decide and reviewBlock in packages/network/src/network.ts, served
//     by POST /review/:oppId in packages/network/service/service.ts, which refuses a body without a revision).
//   - The matching switch (Config in packages/observatory/web/admin.tsx, the workspace controller of
//     spec/consoleWorkspace.md) for two admins. The first press asks; the confirm press sends
//     `on: !c.matchingEnabled` from the same fetched config. A reload of the config drops the asked state
//     (edit.of !== c), and so does the 4 s timer.
//
// BOUNDS
//   Items 1..3. People 1..4: 1 and 2 are adults, 3 is a minor, 4 is unknown to the page. Pairs of
//   participants come from PAIRS. Two reasons (reason 2 is "other" and needs a note). Time 0..MAX_T
//   ticks; a deadline is 2..4 ticks after arrival or re-roll. Two admins. At most 2 queue instances
//   (one remount). The page clock is not modelled: the page no longer checks the deadline.
//
// OUTSIDE THE MODEL
//   - React timing. ASSUMPTION: after each store change or state set, React renders and runs its layout
//     effects before the next event. So each action ends with its render, and the `live` refs are the
//     last render.
//   - The text of drafts and notes. A draft is the card key whose texts were loaded, plus a flag
//     "changed". editsOf gives edits only when the drafts changed. A note is the card key on which it was
//     typed. The browser shell clears both when the bound card key changes (clearDraft).
//   - The plan preview gate for planner proposals (usePlanPreview, planPreviewMatchesCard): approval is
//     blocked until the preview of the same app, id, revision and deadline loads. spec/staffReview.md proves
//     that decision. Here it is part of the nondeterministic environment of approveBlock (not modelled).
//   - The opportunity panel (panels.tsx) mounts its own ReviewActions with its own controller. Not modelled.
//   - Errors and toasts, the score disclosure, the app and sign-in scope of a response, popovers.
//   - The launch scope of the matching switch (spec/runtimeUnit.md matchingSwitchAllowed, setMatching refuses
//     "on" outside it). This model's network is inside its scope; staff_console models the refusal.
//   - The approval re-check after approve (approvalCheck, review_invalidated) and edit leak checks
//     (editBlock). The model keeps decision "approve" with the version it was approved at.
//   - The server refusals note_required (the page asks for the note first), staff_review_required and
//     gathering_repeat_fixed_pair (monthly gathering repeats, not in this queue). Compared 2026-11-21.
module review_desk {

  // ---------------------------------------------------------------- constants
  pure val ITEMS = Set(1, 2, 3)
  pure val MAX_T = 8
  pure val REASONS = 2
  pure val CAN_ACT = true
  pure val PAIRS = Set([1, 2], [2, 1], [1, 3], [2, 4])
  pure val ADMINS = Set(1, 2)

  // ---------------------------------------------------------------- generated controller (spec/staffReview.md)
  // ReviewMode: "IdleReview" | "RejectReview" | "EditReview" | "RerollReview". A card key {id: 0} is "".
  type Key = { id: int, ver: int }
  type Ctl = { cardKey: Key, revision: int, mode: str, noteNeeded: bool }
  pure val NOKEY: Key = { id: 0, ver: 0 }
  pure val INITIAL: Ctl = { cardKey: NOKEY, revision: 0, mode: "IdleReview", noteNeeded: false }

  pure def selectedReviewCard(pend: List[int], focused: int, held: int): int =
    if (focused != 0 and has(pend, focused)) focused
    else if (held != 0 and has(pend, held)) held
    else if (pend.length() > 0) pend[0]
    else 0

  pure def canBindCard(c: Ctl, k: Key): bool = k != c.cardKey
  pure def bindCard(c: Ctl, k: Key): Ctl = { cardKey: k, revision: c.revision + 1, mode: "IdleReview", noteNeeded: false }
  pure def canChangeReviewMode(c: Ctl): bool = c.cardKey != NOKEY
  pure def changeReviewMode(c: Ctl, m: str, toggle: bool): Ctl =
    { ...c, mode: if (toggle and m == c.mode) "IdleReview" else m, noteNeeded: false }
  pure def canRequireReviewNote(c: Ctl): bool = c.cardKey != NOKEY and c.mode == "RejectReview"
  pure def requireReviewNote(c: Ctl): Ctl = { ...c, noteNeeded: true }
  pure def alwaysRequiredNoteBelongsToRejection(c: Ctl): bool = c.noteNeeded implies c.mode == "RejectReview"
  pure def ownsReviewResponse(c: Ctl, k: Key, rev: int): bool = c.cardKey != NOKEY and c.cardKey == k and c.revision == rev
  pure def settleReview(c: Ctl): Ctl = { ...c, revision: c.revision + 1, mode: "IdleReview", noteNeeded: false }

  // step(): an event that the rules do not allow leaves the controller unchanged.
  pure def stepBind(c: Ctl, k: Key): Ctl = if (canBindCard(c, k)) bindCard(c, k) else c
  pure def stepMode(c: Ctl, m: str, toggle: bool): Ctl = if (canChangeReviewMode(c)) changeReviewMode(c, m, toggle) else c
  pure def stepNote(c: Ctl): Ctl = if (canRequireReviewNote(c)) requireReviewNote(c) else c
  pure def stepSettle(c: Ctl, k: Key, rev: int): Ctl = if (ownsReviewResponse(c, k, rev)) settleReview(c) else c

  // ---------------------------------------------------------------- page decisions (review.tsx)
  type Person = { minor: bool, declined: bool }
  // People as the page knows them (store.members). Person 4 is not in the map.
  pure val PEOPLE: int -> Person = Map(
    1 -> { minor: false, declined: false },
    2 -> { minor: false, declined: false },
    3 -> { minor: true, declined: false })

  // approveBlock in review.tsx: read-only, plan preview (not modelled), a known minor, a declined
  // participant, matching off. The page does not check the deadline and does not block a person it does
  // not know: the server refuses both.
  pure def approveBlock(canAct: bool, ids: List[int], matchingOff: bool): str =
    if (not(canAct)) "read_only"
    else if (ids.foldl(false, (b, i) => b or (PEOPLE.keys().contains(i) and PEOPLE.get(i).minor))) "minor"
    else if (ids.foldl(false, (b, i) => b or (PEOPLE.keys().contains(i) and PEOPLE.get(i).declined))) "declined"
    else if (matchingOff) "matching_off"
    else "idle"

  // ---------------------------------------------------------------- environment and shell types
  // decision: "pending" | "approve" | "reject" | "expired". A re-roll with no alternate closes the
  // item with decision "pending" and inReview false.
  type SrvItem = { arrived: bool, inReview: bool, decision: str, deadline: int, version: int,
                   parts: List[int], decidedAt: int, approvedVersion: int }
  type ViewItem = { known: bool, inReview: bool, deadline: int, version: int, parts: List[int] }
  type Drafts = { key: Key, changed: bool }
  // The queue component (one mount). inst counts mounts; the old instance is unmounted.
  type Browser = { inst: int, ctl: Ctl, drafts: Drafts, note: Key, selHeld: int, sel: int, pending: List[int] }
  // One decision request. key and rev are what response() captured; the rest are ghost facts.
  type Req = { rid: int, inst: int, id: int, kind: str, key: Key, rev: int, editsFrom: Key, noteFrom: Key,
               repeat: bool, sel: int, modeBefore: str, draftsBefore: Drafts, blocked: bool, version: int }
  type Ans = { req: Req, ok: bool }
  type Admin = { asking: bool, armedAt: int, cfg: bool, asked: bool }
  type MReq = { mid: int, admin: int, on: bool, asked: bool }

  type State = {
    now: int,
    srv: int -> SrvItem, matchingOn: bool,
    mirror: int -> ViewItem, viewMatchingOn: bool,
    focus: int, deciding: Set[int],
    br: Browser,
    inflight: Set[Req], answers: Set[Ans], sent: Set[Req], nextRid: int,
    // ghost: the answers that moved the selection, with whether the queue owned them.
    moves: Set[{ rid: int, owned: bool }],
    admins: int -> Admin, mflight: Set[MReq], msent: Set[MReq], nextMid: int,
    // ghost counters for witnesses
    repeats: int, lateElsewhere: int, oldAnswers: int, raceDrops: int,
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

  pure def keyOf(m: int -> ViewItem, id: int): Key = if (id == 0) NOKEY else { id: id, ver: m.get(id).version }

  pure val NODRAFT: Drafts = { key: NOKEY, changed: false }

  // useReviewCtl: save(next); a changed binding also runs clearDraft (note, drafts, error).
  pure def saveB(b: Browser, nxt: Ctl): Browser =
    if (nxt.cardKey != b.ctl.cardKey or nxt.revision != b.ctl.revision) { ...b, ctl: nxt, note: NOKEY, drafts: NODRAFT }
    else { ...b, ctl: nxt }

  // The render of ReviewQueue: derive the selected card, bind the controller to its key.
  // `selId` (selHeld) is React state: the render does not change it.
  pure def render(st: State): State =
    val pend = pendingOf(st.mirror)
    val sel = selectedReviewCard(pend, st.focus, st.br.selHeld)
    val b = saveB(st.br, stepBind(st.br.ctl, keyOf(st.mirror, sel)))
    { ...st, br: { ...b, sel: sel, pending: pend } }

  // select(o): setSelId and store.focus.
  pure def selectB(st: State, n: int): State = { ...st, br: { ...st.br, selHeld: n }, focus: n }

  pure def blockedOf(st: State, o: int): bool =
    approveBlock(CAN_ACT, st.mirror.get(o).parts, not(st.viewMatchingOn)) != "idle"

  // act(): response() captures the bound key and revision; store.decide sends one decision per item at a
  // time with the revision the page shows. A second press while the first is in flight sends nothing.
  pure def act(st: State, o: int, kind: str, repeat: bool): State =
    if (st.deciding.contains(o)) st
    else
      val b = st.br
      val m = st.mirror.get(o)
      val edit = kind == "approve" and b.ctl.mode == "EditReview" and b.drafts.key == b.ctl.cardKey and b.drafts.changed
      val r: Req = { rid: st.nextRid, inst: b.inst, id: o, kind: if (edit) "edit" else kind,
                     key: b.ctl.cardKey, rev: b.ctl.revision, editsFrom: if (edit) b.drafts.key else NOKEY,
                     noteFrom: b.note, repeat: repeat, sel: b.sel, modeBefore: b.ctl.mode,
                     draftsBefore: b.drafts, blocked: blockedOf(st, o), version: m.version }
      { ...st, deciding: st.deciding.union(Set(o)), inflight: st.inflight.union(Set(r)),
               sent: st.sent.union(Set(r)), nextRid: st.nextRid + 1 }

  // ---------------------------------------------------------------- init
  pure val NO_ITEM: SrvItem = { arrived: false, inReview: false, decision: "pending", deadline: 0, version: 0,
                                parts: [], decidedAt: -1, approvedVersion: -1 }
  pure val NO_VIEW: ViewItem = { known: false, inReview: false, deadline: 0, version: 0, parts: [] }

  action init = { nondet on = Set(true, false).oneOf() initWith(on) }
  action initWith(on: bool): bool = all {
    s' = {
      now: 0,
      srv: ITEMS.mapBy(_ => NO_ITEM), matchingOn: on,
      mirror: ITEMS.mapBy(_ => NO_VIEW), viewMatchingOn: on,
      focus: 0, deciding: Set(),
      br: { inst: 1, ctl: INITIAL, drafts: NODRAFT, note: NOKEY, selHeld: 0, sel: 0, pending: [] },
      inflight: Set(), answers: Set(), sent: Set(), nextRid: 1,
      moves: Set(),
      admins: ADMINS.mapBy(_ => { asking: false, armedAt: 0, cfg: on, asked: false }),
      mflight: Set(), msent: Set(), nextMid: 1,
      repeats: 0, lateElsewhere: 0, oldAnswers: 0, raceDrops: 0,
    },
  }

  // ---------------------------------------------------------------- environment actions
  action tick = all { s.now < MAX_T, s' = { ...s, now: s.now + 1 } }

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

  // The server tick (advance) expires an item at or after its deadline. The tick can come late.
  action serverExpire = {
    nondet id = ITEMS.filter(i => s.srv.get(i).inReview and s.now >= s.srv.get(i).deadline).oneOf()
    s' = { ...s, srv: s.srv.set(id, { ...s.srv.get(id), inReview: false, decision: "expired" }) }
  }

  // Another reviewer decides or re-rolls an item (through the same server rules, before the deadline).
  action otherReviewer = {
    nondet id = ITEMS.filter(i => s.srv.get(i).inReview).oneOf()
    nondet what = Set("approve", "reject", "reroll", "close").oneOf()
    nondet pair = PAIRS.oneOf()
    otherReviewerOf(id, what, pair)
  }
  action otherReviewerOf(id: int, what: str, pair: List[int]): bool = all {
    s.srv.get(id).inReview,
    s.now < s.srv.get(id).deadline,
    what == "approve" implies (partsOk(s.srv.get(id).parts) and s.matchingOn),
    val it = s.srv.get(id)
    val it2 =
      if (what == "reroll") { ...it, deadline: s.now + 3, version: it.version + 1, parts: pair }
      else if (what == "close") { ...it, inReview: false }
      else if (what == "approve") { ...it, inReview: false, decision: what, decidedAt: s.now, approvedVersion: it.version }
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

  // reviewBlock: a participant who is a minor, declined or unknown refuses approve and edit.
  pure def partsOk(parts: List[int]): bool =
    parts.foldl(true, (b, i) => b and PEOPLE.keys().contains(i) and not(PEOPLE.get(i).minor) and not(PEOPLE.get(i).declined))

  // ConsentNetwork.decide in one unit of work. In order: not in review; at or past the deadline the item
  // expires now (advance) and the decision is refused (review_expired); another revision is refused
  // (review_stale); reviewBlock refuses approve and edit for a minor, declined or unknown participant
  // and while matching is off. `lost`: the answer that reaches the page says "failed", whether or not
  // the server applied it.
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
    val late = it.inReview and s.now >= it.deadline
    val accept = it.inReview and not(late) and r.version == it.version and
      (r.kind == "reject" or r.kind == "reroll" or (partsOk(it.parts) and s.matchingOn))
    val doIt = accept and (not(lost) or applied)
    val it2 =
      if (late) { ...it, inReview: false, decision: "expired" }
      else if (not(doIt)) it
      else if (r.kind == "reroll")
        if (alt) { ...it, deadline: s.now + 3, version: it.version + 1, parts: pair }
        else { ...it, inReview: false }
      else if (r.kind == "reject") { ...it, inReview: false, decision: "reject", decidedAt: s.now }
      else { ...it, inReview: false, decision: "approve", decidedAt: s.now, approvedVersion: r.version }
    s' = { ...s,
      srv: s.srv.set(r.id, it2),
      inflight: s.inflight.exclude(Set(r)),
      answers: s.answers.union(Set({ req: r, ok: accept and not(lost) })),
    }
  }

  // ---------------------------------------------------------------- shell actions (reviewer)
  // An answer reaches the page, in any order. store.decide removes the id from `deciding` (finally).
  // act(): response.current() is mounted and ownsReviewResponse(live ctl, key, rev). Only then, and only
  // for an accepted answer, settle; then afterDecision (approve and reject) selects the neighbour.
  action deliver = { nondet a = s.answers.oneOf() deliverAns(a.req.rid) }
  action deliverAns(rid: int): bool = all {
    s.answers.exists(x => x.req.rid == rid),
    val a = s.answers.filter(x => x.req.rid == rid).getOnlyElement()
    val r = a.req
    val st0 = { ...s, answers: s.answers.exclude(Set(a)), deciding: s.deciding.exclude(Set(r.id)) }
    val live = r.inst == s.br.inst
    val current = live and ownsReviewResponse(s.br.ctl, r.key, r.rev)
    // ghost, read without the controller: the decided card is still the one on view, at the same revision.
    val owned = live and s.br.sel == r.id and keyOf(s.mirror, r.id) == r.key
    val st1 =
      if (not(a.ok and current)) st0
      else
        val st2 = { ...st0, br: saveB(st0.br, stepSettle(st0.br.ctl, r.key, r.rev)) }
        if (r.kind == "reroll") st2
        else
          val pend = st2.br.pending
          val i = indexOf(pend, st2.br.sel)
          val n = if (i >= 0 and i + 1 < pend.length()) pend[i + 1] else if (i >= 1) pend[i - 1] else 0
          val st3 = if (n != 0) selectB(st2, n) else { ...st2, br: { ...st2.br, selHeld: 0 } }
          { ...st3, moves: st3.moves.union(Set({ rid: r.rid, owned: owned })) }
    s' = render({ ...st1,
      lateElsewhere: if (a.ok and live and not(current)) st1.lateElsewhere + 1 else st1.lateElsewhere,
      oldAnswers: if (a.ok and not(live)) st1.oldAnswers + 1 else st1.oldAnswers }),
  }

  // The queue keyboard handler (capture phase). It does not look at key repeat.
  action keyPress = {
    nondet key = Set("a", "r", "e", "s", "digit", "esc").oneOf()
    nondet digit = Set(1, 2, 3).oneOf()
    nondet repeat = Set(true, false).oneOf()
    keyPressOf(key, digit, repeat)
  }
  action keyPressOf(key: str, digit: int, repeat: bool): bool = {
    val b = s.br
    val o = b.sel
    val c = b.ctl
    val st = { ...s, repeats: if (repeat) s.repeats + 1 else s.repeats }
    val swaps = if (o == 0) 0 else s.mirror.get(o).parts.length()
    all {
      if (key == "esc") c.mode != "IdleReview" else o != 0,
      s' = render(
        if (key == "esc") { ...st, br: saveB(b, stepMode(c, "IdleReview", false)) }
        else if (key == "a") (if (CAN_ACT and not(blockedOf(s, o))) act(st, o, "approve", repeat) else st)
        else if (key == "r") { ...st, br: saveB(b, stepMode(c, "RejectReview", false)) }
        else if (key == "s") (if (CAN_ACT and swaps >= 1) { ...st, br: saveB(b, stepMode(c, "RerollReview", false)) } else st)
        else if (key == "e") { ...st, br: saveB({ ...b, drafts: { key: c.cardKey, changed: false } }, stepMode(c, "EditReview", false)) }
        else if (c.mode == "RejectReview")
          if (digit > REASONS) st
          else if (digit == REASONS and b.note == NOKEY) { ...st, br: saveB(b, stepNote(c)) }
          else act(st, o, "reject", repeat)
        else if (c.mode == "RerollReview")
          if (digit > swaps) st else act(st, o, "reroll", repeat)
        else st),
    }
  }

  // j, k or a click on a card head: select(o).
  action selectCard = { nondet n = ITEMS.filter(i => has(s.br.pending, i)).oneOf() selectCardOf(n) }
  action selectCardOf(n: int): bool = all { has(s.br.pending, n), s' = render(selectB(s, n)) }

  // A focus link from the map, the pipeline or a search result.
  action focusLink = { nondet n = ITEMS.filter(i => s.mirror.get(i).known).oneOf() focusLinkOf(n) }
  action focusLinkOf(n: int): bool = all { s.mirror.get(n).known, s' = render({ ...s, focus: n }) }

  // Buttons on the selected card (only the selected card shows its body). Approve is disabled when blocked.
  action clickButton = {
    nondet key = Set("approve", "reject", "reroll").oneOf()
    nondet digit = Set(1, 2, 3).oneOf()
    clickButtonOf(key, digit)
  }
  action clickButtonOf(key: str, digit: int): bool = {
    val o = s.br.sel
    val c = s.br.ctl
    all {
      o != 0, CAN_ACT,
      if (key == "approve") not(blockedOf(s, o))
      else if (key == "reject") c.mode == "RejectReview" and digit <= REASONS
      else c.mode == "RerollReview" and digit <= s.mirror.get(o).parts.length(),
      s' = render(
        if (key == "reject" and digit == REASONS and s.br.note == NOKEY) { ...s, br: saveB(s.br, stepNote(c)) }
        else act(s, o, key, false)),
    }
  }

  // The Edit, Re-roll and Reject buttons: toggle(), which loads the current texts when it opens the editor.
  action clickToggle = {
    nondet m = Set("EditReview", "RerollReview", "RejectReview").oneOf()
    val b = s.br
    val nxt = stepMode(b.ctl, m, true)
    all {
      b.sel != 0, CAN_ACT,
      s' = render({ ...s, br: saveB(if (nxt.mode == "EditReview") { ...b, drafts: { key: b.ctl.cardKey, changed: false } } else b, nxt) }),
    }
  }

  // Typing in the editor (only shown in edit mode on the selected card) or in the note field.
  action typeDraft = all {
    s.br.sel != 0, s.br.ctl.mode == "EditReview", s.br.drafts.key == s.br.ctl.cardKey,
    s' = { ...s, br: { ...s.br, drafts: { ...s.br.drafts, changed: true } } },
  }
  action typeNote = all { s.br.sel != 0, s' = { ...s, br: { ...s.br, note: s.br.ctl.cardKey } } }

  // The drawer closes and opens again: the queue unmounts (mounted = false) and mounts with the initial
  // controller and no held selection. `deciding` and `focus` live in the store and stay.
  action remount = all {
    s.br.inst < 2,
    s' = render({ ...s,
      br: { inst: s.br.inst + 1, ctl: INITIAL, drafts: NODRAFT, note: NOKEY, selHeld: 0, sel: 0, pending: [] } }),
  }

  // ---------------------------------------------------------------- shell actions (admins)
  // The first press asks (pressMatchingSwitch); the confirm press (confirmMatchingSwitch) sends
  // `on: !cfg`, where cfg is the config that the page held at the first press.
  action adminPress = { nondet a = ADMINS.oneOf() adminPressOf(a) }
  action adminPressOf(a: int): bool = {
    val ad = s.admins.get(a)
    val m: MReq = { mid: s.nextMid, admin: a, on: not(ad.cfg), asked: ad.asked }
    if (not(ad.asking))
      s' = { ...s, admins: s.admins.set(a, { ...ad, asking: true, armedAt: s.now, asked: not(ad.cfg) }) }
    else
      s' = { ...s,
        admins: s.admins.set(a, { ...ad, asking: false }),
        mflight: s.mflight.union(Set(m)), msent: s.msent.union(Set(m)), nextMid: s.nextMid + 1 }
  }
  // The 4 s timer ends the confirmation (endConfirmation).
  action adminTimeout = {
    nondet a = ADMINS.oneOf()
    val ad = s.admins.get(a)
    all { ad.asking, s.now > ad.armedAt, s' = { ...s, admins: s.admins.set(a, { ...ad, asking: false }) } }
  }
  // useFetch reloads the config: the page shows the server value, and the old ask is dropped (edit.of !== c).
  action adminReload = { nondet a = ADMINS.oneOf() adminReloadOf(a) }
  action adminReloadOf(a: int): bool = {
    val ad = s.admins.get(a)
    s' = { ...s, admins: s.admins.set(a, { ...ad, cfg: s.matchingOn, asking: false }),
                 raceDrops: if (ad.asking) s.raceDrops + 1 else s.raceDrops }
  }
  // The server applies one switch command, in any order.
  action serverMatching = { nondet m = s.mflight.oneOf() serverMatchingOf(m.mid) }
  action serverMatchingOf(mid: int): bool = all {
    s.mflight.exists(m => m.mid == mid),
    val m = s.mflight.filter(x => x.mid == mid).getOnlyElement()
    s' = { ...s, matchingOn: m.on, mflight: s.mflight.exclude(Set(m)) },
  }

  action step = any {
    tick, arrive, serverExpire, otherReviewer, push, pushMatching, serverApply,
    deliver, keyPress, selectCard, focusLink, clickButton, clickToggle, typeDraft, typeNote, remount,
    adminPress, adminTimeout, adminReload, serverMatching,
  }

  // ---------------------------------------------------------------- invariants
  // spec/staffReview.md alwaysRequiredNoteBelongsToRejection (the generated `inv`).
  val requiredNoteBelongsToRejection = alwaysRequiredNoteBelongsToRejection(s.br.ctl)

  // The controller is bound to the card on view, and its drafts and note belong to that binding.
  // spec/staffReview.md "A changed card or revision starts a fresh draft".
  val ctlBoundToSelection = and {
    s.br.ctl.cardKey == keyOf(s.mirror, s.br.sel),
    s.br.drafts.key == NOKEY or s.br.drafts.key == s.br.ctl.cardKey,
    s.br.note == NOKEY or s.br.note == s.br.ctl.cardKey,
  }

  // Rule: AGENTS.md "Every proactive proposal ... must go through human review". Each decision goes to
  // the card on view, with the key and revision that the controller held for it.
  val decisionOnlyToVisibleCard = s.sent.forall(r => r.id == r.sel and r.key == { id: r.id, ver: r.version })

  // spec/staffReview.md "An old response cannot clear or move a newer selection": an answer moves the
  // selection only when it belongs to the mounted queue and the card on view at the same revision.
  val oldResponseNeverMovesSelection = s.moves.forall(m => m.owned)

  // The page sends an approve only when its own approveBlock is idle (the Approve button is disabled and
  // the a key is ignored otherwise).
  val approveOnlyWhenUnblocked = s.sent.forall(r => (r.kind == "approve" or r.kind == "edit") implies not(r.blocked))

  // spec/reviewDeadline.md "An opportunity expires at its review deadline": the server approves only
  // before the deadline (decide and reviewBlock, reviewLate).
  val serverApproveBeforeDeadline =
    ITEMS.forall(i => s.srv.get(i).decision == "approve" and s.srv.get(i).approvedVersion >= 0
                      implies s.srv.get(i).decidedAt < s.srv.get(i).deadline)

  // spec/reviewDeadline.md "A decision applies only to the revision the reviewer saw".
  val approveMatchesSeenPeople =
    ITEMS.forall(i => s.srv.get(i).decision == "approve" and s.srv.get(i).approvedVersion >= 0
                      implies s.srv.get(i).approvedVersion == s.srv.get(i).version)

  // The confirm press sends the direction the first press asked for.
  val confirmSendsAskedDirection = s.msent.forall(m => m.on == m.asked)

  // Edits and the note go only to the card key (card and revision) they were written for.
  val draftsBoundToItem =
    s.sent.forall(r => (r.kind == "edit" implies r.editsFrom == r.key) and (r.noteFrom == NOKEY or r.noteFrom == r.key))

  // An approve in edit mode with changed drafts sends the edit; otherwise a plain approve.
  val approveCarriesOwnDrafts =
    s.sent.forall(r => (r.kind == "approve" or r.kind == "edit") implies
      ((r.kind == "edit") iff (r.modeBefore == "EditReview" and r.draftsBefore.key == r.key and r.draftsBefore.changed)))

  val safety = and {
    requiredNoteBelongsToRejection, ctlBoundToSelection, decisionOnlyToVisibleCard, oldResponseNeverMovesSelection,
    approveOnlyWhenUnblocked, serverApproveBeforeDeadline, approveMatchesSeenPeople, confirmSendsAskedDirection,
    draftsBoundToItem, approveCarriesOwnDrafts,
  }

  // OPEN DEFECT, not in safety: a key-repeat event must never send a decision. review.tsx onKey does not
  // check KeyboardEvent.repeat. heldKeyDecidesTest replays the violation.
  val repeatNeverDecides = s.sent.forall(r => not(r.repeat))

  // ---------------------------------------------------------------- reachability witnesses
  val witness_approveSent = not(s.sent.exists(r => r.kind == "approve"))
  val witness_editSent = not(s.sent.exists(r => r.kind == "edit"))
  val witness_rejectSent = not(s.sent.exists(r => r.kind == "reject"))
  val witness_rerollSent = not(s.sent.exists(r => r.kind == "reroll"))
  val witness_repeatPressed = s.repeats == 0
  val witness_lateAnswerElsewhere = s.lateElsewhere == 0
  val witness_oldQueueAnswer = s.oldAnswers == 0
  val witness_answerMoved = s.moves.size() == 0
  val witness_itemExpired = not(ITEMS.exists(i => s.srv.get(i).decision == "expired"))
  val witness_flipSent = s.msent.size() == 0
  val witness_flipRaceDropped = s.raceDrops == 0
  val witness_noteNeeded = not(s.br.ctl.noteNeeded)

  // ---------------------------------------------------------------- replayed traces
  // Three items with the same deadline, so the queue order is 1, 2, 3.
  action threeItems = initWith(true)
    .then(arriveItem(1, 4, [1, 2])).then(arriveItem(2, 4, [1, 2])).then(arriveItem(3, 4, [2, 1]))
    .then(pushItem(1)).then(pushItem(2)).then(pushItem(3))

  // The head card is bound on render; the first press on it approves it (the page has no "chosen" step).
  run firstPressApprovesHeadTest = threeItems
    .then(keyPressOf("a", 0, false))
    .then(all { assert(s.br.ctl.cardKey == { id: 1, ver: 0 } and s.sent.exists(r => r.id == 1 and r.kind == "approve")), s' = s })

  // Drafts typed on item 1 do not go with a decision on item 2.
  run draftsStayTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("e", 0, false)).then(typeDraft)
    .then(focusLinkOf(2))
    .then(keyPressOf("a", 0, false))
    .then(all { assert(s.sent.forall(r => r.kind == "approve" and r.id == 2 and r.editsFrom == NOKEY)
                       and s.br.drafts == NODRAFT), s' = s })

  // A re-roll by another reviewer changes the revision of the card on view: the draft starts again.
  run rerollClearsDraftTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("e", 0, false)).then(typeDraft)
    .then(otherReviewerOf(1, "reroll", [2, 1])).then(pushItem(1))
    .then(all { assert(s.br.ctl.cardKey == { id: 1, ver: 1 } and s.br.ctl.mode == "IdleReview" and s.br.drafts == NODRAFT), s' = s })

  // The late answer for 1 arrives after the reviewer selected 3: the card stays on 3.
  run lateAnswerStaysTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(selectCardOf(3))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(all { assert(s.br.sel == 3 and s.lateElsewhere == 1 and s.moves.size() == 0), s' = s })

  // The owned answer for 1 moves the selection to its neighbour 2.
  run ownedAnswerMovesTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(all { assert(s.br.sel == 2 and s.focus == 2 and s.moves == Set({ rid: 1, owned: true })), s' = s })

  // An answer for an unmounted queue does nothing: the card stays on 3 after the remount.
  run remountKeepsChoiceTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(remount)
    .then(selectCardOf(3))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(all { assert(s.br.sel == 3 and s.oldAnswers == 1 and s.moves.size() == 0), s' = s })

  // A decision at the deadline is refused and the item expires at once.
  run lateDecisionExpiresTest = threeItems.then(selectCardOf(1))
    .then(keyPressOf("a", 0, false))
    .then(tick).then(tick).then(tick).then(tick)
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(all { assert(s.srv.get(1).decision == "expired" and s.answers.forall(a => not(a.ok))), s' = s })

  // Admin 1 asks "Turn off", admin 2 turns it off, admin 1's config reloads: the ask is dropped and
  // nothing more is sent.
  run flipRaceTest = threeItems
    .then(adminPressOf(1)).then(adminPressOf(2)).then(adminPressOf(2))
    .then(serverMatchingOf(1)).then(adminReloadOf(1))
    .then(all { assert(not(s.matchingOn) and s.msent.size() == 1 and s.raceDrops == 1 and not(s.admins.get(1).asking)), s' = s })

  // OPEN DEFECT: hold the a key. The first keydown approves 1; the answer moves the selection to 2;
  // the next repeat event approves 2, which the reviewer did not press for.
  run heldKeyDecidesTest = threeItems
    .then(keyPressOf("a", 0, false))
    .then(serverApplyReq(1, false, true, false, [1, 2]))
    .then(deliverAns(1))
    .then(keyPressOf("a", 0, true))
    .then(all { assert(not(repeatNeverDecides) and s.sent.exists(r => r.id == 2 and r.repeat)), s' = s })
}
```
