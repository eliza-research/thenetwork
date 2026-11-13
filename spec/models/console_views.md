# Staff member views

## Story: Staff member views

A staff user needs accurate member details and an age-gated photo view.

### Safety rules and reachability

Check asynchronous reads, access to photos, visible tabs, and proposal eligibility. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/console_views.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=20 max-samples=2000
//
// console_views: the Observatory staff console, person views, on the browser side.
//
// WHAT THIS MODELS
//   The browser state of the member panel and the drawer in packages/observatory/web:
//   - Detail reads (useLive in panels.tsx, Search in main.tsx). A read starts, the server answers
//     late, out of order, more than once, or never. A dependency change cancels the reads that started.
//     A credential change (authEpoch) also takes the data off the screen.
//   - The photo gate (SlopPanel in panels.tsx). The rule comes from the last detail read that landed.
//     The minor flag is the live store flag. A stated age can drop to a minor between two reads.
//   - The drawer tab (shownTab in drawer.tsx). The saved tab and the viewer caps change.
//   - Game proposals (ProposeTray in main.tsx). Picks, store age changes, a person that the store
//     forgets, sparks and the game end.
//   - The everyone-yes counts (KpiGrid in panels.tsx).
//   Each LemmaScript step function in packages/observatory/web/logic/views.ts is a pure def here with
//   the same name and the same decision. Each shell event is an action that calls it. The server is
//   a nondeterministic environment.
//
// BOUNDS
//   Persons 1..3 (person 1 is the person whose panel is open). At most MAX_TICKET read starts.
//   At most 2 photo requests in flight. At most 3 picks. Sparks 0..2. Two opportunities with two
//   participants each.
//
// RUN (from the repository root; quint 0.33.1; there is no Apalache in this setup)
//   quint typecheck quint/console_views.qnt
//   quint test quint/console_views.qnt
//   quint run quint/console_views.qnt --invariant=safety --max-samples=2000 --max-steps=20 --seed=7
//   quint run quint/console_views.qnt --invariant=<name> --max-samples=2000 --max-steps=20 --seed=7
//   Each witness_<name> must be VIOLATED (the state is reachable).
//
// OUTSIDE THE MODEL
//   - React timing. ASSUMPTION: after each store change React renders, and the SlopPanel effect that
//     drops photos (photoHeld) runs, before the next event. useSyncExternalStore renders a store change
//     on the sync lane, and React flushes passive effects before the next discrete event. So each
//     action here includes its render and its effect. Two store changes that React batches into one
//     render are one action with the last value.
//   - The server gates (photo rule, role check, participant_minor refusal on propose). The server is
//     an environment: the photo rule in an answer and the photo answer itself are free choices.
//   - The DOM, the text, fetch errors (a failed read is an answer that never comes), the 3 s reload
//     gap (a key-change timer is one more read start), Search (it uses the same three functions as
//     useLive; this model has one read gate).
//   - durParts, rate, planCloses and planView: no browser state machine. LemmaScript proves them.
//   - A photo answer for a SlopPanel that unmounted (authChange): React drops its setPhotos. The
//     model drops the photo requests in flight at the unmount.
//   - Strings in canPropose are person ids 1..3. Map<string, boolean> is a Quint Map.
module console_views {

  // ---------------------------------------------------------------- types (own, small)
  type PhotoRule = NeverMinor | NeedsVerification | ReasonRequired
  type PhotoView = Hide | Form | Gallery
  type PhotoGate = { rule: PhotoRule, canSafety: bool, minor: bool }

  type ReadGate = { last: int, closed: int }
  type ReadLand = { gate: ReadGate, show: bool }

  type ViewTab = Review | Feed | Pipeline | Requests | Engine | Safety | Metrics | Lab | Config | Game
  type TabCaps = { showReview: bool, game: bool, hasRequests: bool, analyst: bool, realOnly: bool }

  type YesCount = { revealed: int, yes: int }

  // One server answer to a detail read: its ticket, the dependency epoch when it started, and the
  // photo rule that the server put in it.
  type Answer = { ticket: int, epoch: int, rule: PhotoRule }

  // ---------------------------------------------------------------- bounds
  pure val PERSONS = Set(1, 2, 3)
  pure val FOCUS = 1
  pure val MAX_TICKET = 5
  pure val MAX_PHOTO_REQS = 2
  pure val MAX_PICKS = 3
  pure val RULES = Set(NeverMinor, NeedsVerification, ReasonRequired)
  pure val TABS = Set(Review, Feed, Pipeline, Requests, Engine, Safety, Metrics, Lab, Config, Game)
  // "" is a status that the map does not know (panels.tsx passes `o.status[id] ?? ""`); "proposed"
  // is a status before the reveal.
  pure val STATUSES = Set("", "proposed", "invited", "accepted", "declined", "confirmed", "no_show")

  // ================================================================ core: views.ts mirror
  // ---- photos (views.ts photoAllowed, photoView, photoHeld)
  pure def photoAllowed(g: PhotoGate): bool =
    g.rule == ReasonRequired and g.canSafety and not(g.minor)

  pure def photoView(g: PhotoGate, loaded: bool): PhotoView =
    if (not(photoAllowed(g))) Hide
    else if (loaded) Gallery
    else Form

  pure def photoHeld(g: PhotoGate, loaded: bool): bool =
    loaded and photoAllowed(g)

  // ---- detail reads (views.ts readOk, readNew, canLand, readStart, readCancel, readLand)
  pure def readOk(g: ReadGate): bool = 0 <= g.closed and g.closed <= g.last

  pure def readNew: ReadGate = { last: 0, closed: 0 }

  pure def canLand(g: ReadGate, ticket: int): bool = g.closed < ticket and ticket <= g.last

  pure def readStart(g: ReadGate): ReadGate = { last: g.last + 1, closed: g.closed }

  pure def readCancel(g: ReadGate): ReadGate = { last: g.last, closed: g.last }

  pure def readLand(g: ReadGate, ticket: int): ReadLand =
    if (canLand(g, ticket)) { gate: { last: g.last, closed: ticket }, show: true }
    else { gate: g, show: false }

  // ---- drawer tab (views.ts tabVisible, effectiveTab)
  pure def tabVisible(t: ViewTab, c: TabCaps): bool =
    if (t == Review) c.showReview
    else if (t == Game) c.game
    else if (t == Requests) c.hasRequests
    else if (t == Lab) c.analyst and not(c.realOnly)
    else if (t == Config) c.analyst
    else Set(Feed, Pipeline, Engine, Safety, Metrics).contains(t)

  pure def effectiveTab(want: ViewTab, c: TabCaps): ViewTab =
    if (tabVisible(want, c)) want else Feed

  // ---- propose (views.ts canPropose). The loop returns false at the first pick that the map does
  // not know or that is a minor. A fold with the same test gives the same result.
  pure def canPropose(picks: List[int], minor: int -> bool, hasGame: bool, sparks: int, over: bool): bool =
    if (not(hasGame) or sparks <= 0 or over) false
    else picks.foldl(true, (ok, p) => ok and minor.keys().contains(p) and not(minor.get(p)))

  // ---- everyone-yes (views.ts isRevealed, saidYes, allOf, yesCounts)
  pure def isRevealed(s: str): bool =
    Set("invited", "accepted", "declined", "countered", "ignored", "expired", "dropped", "confirmed",
        "attended", "no_show", "cancelled_with_notice").contains(s)

  pure def saidYes(s: str): bool =
    Set("accepted", "confirmed", "attended", "no_show", "cancelled_with_notice").contains(s)

  pure def allOf(xs: List[str], yes: bool): bool =
    xs.foldl(true, (ok, s) => ok and (if (yes) saidYes(s) else isRevealed(s)))

  pure def yesCounts(opps: List[List[str]]): YesCount =
    opps.foldl({ revealed: 0, yes: 0 }, (c, xs) => {
      revealed: if (allOf(xs, false)) c.revealed + 1 else c.revealed,
      yes: if (allOf(xs, true)) c.yes + 1 else c.yes,
    })

  // ================================================================ shell state
  // Detail reads of the open member panel (useLive): the gate ref, the dependency epoch (a ghost:
  // it counts dependency changes), the answers that the server can still send, and the data on screen.
  var gate: ReadGate
  var epoch: int
  var inflight: Set[Answer]
  var hasData: bool
  var shown: Answer
  // Ghost: the last answer that came back, the ticket on screen before it, and if it showed.
  var lastLand: { landed: bool, ticket: int, before: int, show: bool, startEpoch: int, landEpoch: int }

  // The store: person id -> live minor flag. A person that is not a key is unknown to the store.
  var members: int -> bool
  // The viewer holds the safety role (s.can("safety")).
  var canSafety: bool
  // SlopPanel: photos loaded, photo requests in flight, and a ghost `trail`: every gate since the
  // photos loaded allowed them.
  var photos: { loaded: bool, reqs: int, trail: bool }

  // Drawer: the saved tab (s.ui.drawer) and the viewer caps (tabCaps in drawer.tsx).
  var want: ViewTab
  var caps: TabCaps

  // Game: picks, the game state, and the proposals that the tray sent. `bad` is a ghost: at the
  // time of the send, some pick was a minor or unknown to the store.
  var picks: List[int]
  var game: { has: bool, sparks: int, over: bool }
  var proposals: List[{ picks: List[int], bad: bool }]

  // Opportunities: each one is the list of its participants' statuses (KpiGrid input).
  var opps: List[List[str]]

  // ---------------------------------------------------------------- derived (what React renders)
  // panels.tsx SlopPanel: `minor: !m || m.minor`. An unknown member counts as a minor.
  pure def focusMinor(m: int -> bool): bool = not(m.keys().contains(FOCUS)) or m.get(FOCUS)

  pure def gateOf(a: Answer, safety: bool, m: int -> bool): PhotoGate =
    { rule: a.rule, canSafety: safety, minor: focusMinor(m) }

  val curGate: PhotoGate = gateOf(shown, canSafety, members)

  // SlopPanel exists only after the first detail read lands.
  val view: PhotoView = if (hasData) photoView(curGate, photos.loaded) else Hide

  val shownTab: ViewTab = effectiveTab(want, caps)

  // main.tsx ProposeTray: `known` holds only the picks that the store knows.
  val known: int -> bool =
    picks.foldl(Map(), (k, p) => if (members.keys().contains(p)) k.put(p, members.get(p)) else k)

  val ready: bool = canPropose(picks, known, game.has, game.sparks, game.over)

  // SlopPanel effect: `if (photos && !held) setPhotos(null)`. It runs in the same action as the
  // change of gate (see the assumption in the header).
  pure def settle(p: { loaded: bool, reqs: int, trail: bool }, g: PhotoGate): { loaded: bool, reqs: int, trail: bool } =
    { loaded: photoHeld(g, p.loaded), reqs: p.reqs, trail: p.loaded and p.trail and photoAllowed(g) }

  // ---------------------------------------------------------------- init
  action init = all {
    gate' = readNew,
    epoch' = 0,
    inflight' = Set(),
    hasData' = false,
    shown' = { ticket: 0, epoch: 0, rule: NeverMinor },
    lastLand' = { landed: false, ticket: 0, before: 0, show: false, startEpoch: 0, landEpoch: 0 },
    members' = Map(1 -> false, 2 -> false, 3 -> true),
    canSafety' = true,
    photos' = { loaded: false, reqs: 0, trail: false },
    want' = Feed,
    caps' = { showReview: true, game: true, hasRequests: true, analyst: true, realOnly: false },
    picks' = List(),
    game' = { has: true, sparks: 2, over: false },
    proposals' = List(),
    opps' = [["proposed", "proposed"], ["invited", "proposed"]],
  }

  // ---------------------------------------------------------------- frame helpers
  action readsUnchanged = all {
    gate' = gate, epoch' = epoch, inflight' = inflight, hasData' = hasData, shown' = shown, lastLand' = lastLand,
  }
  action drawerUnchanged = all { want' = want, caps' = caps }
  action playUnchanged = all { picks' = picks, game' = game, proposals' = proposals }

  // ---------------------------------------------------------------- shell events: reads
  // panels.tsx useLive, the key-change timer: `run()` starts one more read. No cancel.
  action keyChangeRead = all {
    gate.last < MAX_TICKET,
    nondet r = RULES.oneOf()
    val g1 = readStart(gate)
    all {
      gate' = g1,
      inflight' = inflight.union(Set({ ticket: g1.last, epoch: epoch, rule: r })),
      epoch' = epoch, hasData' = hasData, shown' = shown, lastLand' = lastLand,
    },
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    drawerUnchanged, playUnchanged,
  }

  // panels.tsx useLive, a dependency change (mode, app, reveal grant): the cleanup cancels, the
  // effect cancels again, then `run()` starts a read.
  action depChange = all {
    gate.last < MAX_TICKET,
    nondet r = RULES.oneOf()
    val g1 = readStart(readCancel(readCancel(gate)))
    all {
      gate' = g1,
      epoch' = epoch + 1,
      inflight' = inflight.union(Set({ ticket: g1.last, epoch: epoch + 1, rule: r })),
      hasData' = hasData, shown' = shown, lastLand' = lastLand,
    },
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    drawerUnchanged, playUnchanged,
  }

  // panels.tsx useLive, a credential change (store.authEpoch: another staff member, a 401): the view
  // shaped for the old credential leaves the screen (`setD(undefined)`), so the member panel and its
  // SlopPanel unmount (the photos go). authEpoch is also a dependency: the reads cancel and one starts.
  action authChange = all {
    gate.last < MAX_TICKET,
    nondet r = RULES.oneOf()
    val g1 = readStart(readCancel(readCancel(gate)))
    all {
      gate' = g1,
      epoch' = epoch + 1,
      inflight' = inflight.union(Set({ ticket: g1.last, epoch: epoch + 1, rule: r })),
      hasData' = false, shown' = shown, lastLand' = lastLand,
    },
    photos' = { loaded: false, reqs: 0, trail: false },
    members' = members, canSafety' = canSafety, opps' = opps,
    drawerUnchanged, playUnchanged,
  }

  // The server answers one read: late, out of order, and possibly more than once (`again`).
  // useLive: `const l = readLand(gate.current, ticket); gate.current = l.gate; if (l.show) setD(x)`.
  action readAnswer = all {
    inflight.size() > 0,
    nondet a = inflight.oneOf()
    nondet again = Set(true, false).oneOf()
    val l = readLand(gate, a.ticket)
    val nextShown = if (l.show) a else shown
    val nextHas = hasData or l.show
    all {
      gate' = l.gate,
      epoch' = epoch,
      inflight' = if (again) inflight else inflight.exclude(Set(a)),
      hasData' = nextHas,
      shown' = nextShown,
      lastLand' = { landed: true, ticket: a.ticket, before: shown.ticket, show: l.show, startEpoch: a.epoch, landEpoch: epoch },
      photos' = if (nextHas) settle(photos, gateOf(nextShown, canSafety, members)) else photos,
    },
    members' = members, canSafety' = canSafety, opps' = opps,
    drawerUnchanged, playUnchanged,
  }

  // The read fails or never answers: `.then` does not run.
  action readLost = all {
    inflight.size() > 0,
    nondet a = inflight.oneOf()
    inflight' = inflight.exclude(Set(a)),
    gate' = gate, epoch' = epoch, hasData' = hasData, shown' = shown, lastLand' = lastLand,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    drawerUnchanged, playUnchanged,
  }

  // ---------------------------------------------------------------- shell events: store and role
  // The live store changes one person: a stated age drops to a minor, staff clear a minor flag,
  // the store learns a person, or the store forgets a person.
  action storeChange = all {
    nondet p = PERSONS.oneOf()
    nondet kind = Set("minor", "adult", "forget").oneOf()
    val m2 = if (kind == "forget") members.keys().exclude(Set(p)).mapBy(q => members.get(q)) else members.put(p, kind == "minor")
    all {
      members' = m2,
      photos' = if (hasData) settle(photos, gateOf(shown, canSafety, m2)) else photos,
    },
    canSafety' = canSafety, opps' = opps,
    readsUnchanged, drawerUnchanged, playUnchanged,
  }

  // The viewer's role changes (sign in as another staff member, role edit).
  action roleChange = {
    nondet c = Set(true, false).oneOf()
    all {
      canSafety' = c,
      photos' = if (hasData) settle(photos, gateOf(shown, c, members)) else photos,
      members' = members, opps' = opps,
      readsUnchanged, drawerUnchanged, playUnchanged,
    }
  }

  // ---------------------------------------------------------------- shell events: photos
  // SlopPanel form submit: only while the form shows.
  action photoAsk = all {
    view == Form,
    photos.reqs < MAX_PHOTO_REQS,
    photos' = { ...photos, reqs: photos.reqs + 1 },
    members' = members, canSafety' = canSafety, opps' = opps,
    readsUnchanged, drawerUnchanged, playUnchanged,
  }

  // The server answers a photo request (late; the gate may have changed). `served` false is a
  // refusal or an error. SlopPanel `show()`: `if (r.data?.photos) setPhotos(...)`, then the effect.
  action photoAnswer = all {
    photos.reqs > 0,
    nondet served = Set(true, false).oneOf()
    val g = gateOf(shown, canSafety, members)
    val p1 = if (served) { loaded: true, reqs: photos.reqs - 1, trail: true } else { ...photos, reqs: photos.reqs - 1 }
    // A fresh load starts a new trail: it is then the first gate that the photos see.
    photos' = settle(p1, g),
    members' = members, canSafety' = canSafety, opps' = opps,
    readsUnchanged, drawerUnchanged, playUnchanged,
  }

  // ---------------------------------------------------------------- shell events: drawer
  // A tab click, or a saved tab from an earlier session (any tab).
  action pickTab = all {
    nondet t = TABS.oneOf()
    want' = t,
    caps' = caps,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    readsUnchanged, playUnchanged,
  }

  // The caps change: role, world kind, request count, review mode.
  action capsChange = all {
    nondet sr = Set(true, false).oneOf()
    nondet gm = Set(true, false).oneOf()
    nondet hr = Set(true, false).oneOf()
    nondet an = Set(true, false).oneOf()
    nondet ro = Set(true, false).oneOf()
    caps' = { showReview: sr, game: gm, hasRequests: hr, analyst: an, realOnly: ro },
    want' = want,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    readsUnchanged, playUnchanged,
  }

  // ---------------------------------------------------------------- shell events: game
  action pick = {
    nondet p = PERSONS.oneOf()
    all {
      picks.length() < MAX_PICKS,
      not(picks.foldl(false, (f, q) => f or q == p)),
      picks' = picks.append(p),
      game' = game, proposals' = proposals,
      members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
      readsUnchanged, drawerUnchanged,
    }
  }

  action clearPicks = all {
    picks' = List(),
    game' = game, proposals' = proposals,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    readsUnchanged, drawerUnchanged,
  }

  // The server changes the game: sparks, the end of the game, or no game.
  action gameChange = all {
    nondet h = Set(true, false).oneOf()
    nondet sp = 0.to(2).oneOf()
    nondet ov = Set(true, false).oneOf()
    game' = { has: h, sparks: sp, over: ov },
    picks' = picks, proposals' = proposals,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    readsUnchanged, drawerUnchanged,
  }

  // ProposeTray: the button is `disabled={!ready}`, and `submit` sends the picks of the same render.
  // The server answer (and its participant_minor refusal) is outside the model.
  action propose = all {
    ready,
    proposals.length() < 3,
    val bad = picks.foldl(false, (b, p) => b or not(members.keys().contains(p)) or members.get(p))
    proposals' = proposals.append({ picks: picks, bad: bad }),
    picks' = List(),
    game' = game,
    members' = members, canSafety' = canSafety, photos' = photos, opps' = opps,
    readsUnchanged, drawerUnchanged,
  }

  // ---------------------------------------------------------------- shell events: opportunities
  action statusChange = all {
    nondet o = 0.to(1).oneOf()
    nondet i = 0.to(1).oneOf()
    nondet s = STATUSES.oneOf()
    opps' = opps.replaceAt(o, opps[o].replaceAt(i, s)),
    members' = members, canSafety' = canSafety, photos' = photos,
    readsUnchanged, drawerUnchanged, playUnchanged,
  }

  action step = any {
    keyChangeRead, depChange, authChange, readAnswer, readLost,
    storeChange, roleChange, photoAsk, photoAnswer,
    pickTab, capsChange,
    pick, clearPicks, gameChange, propose,
    statusChange,
  }

  // ================================================================ invariants
  // Rule: AGENTS.md "Platform decisions" item 9 and founder 2026-10-09 item 5 (photos and ratings are
  // for adults only), AGENTS.md "Age policy" (minors are never connected). Slice report B1.
  // LemmaScript: photoView, `ensures g.minor ==> \result === "hide"` and
  // `ensures \result === "gallery" ==> photoAllowed(g) && loaded`, `\result === "form" ==> photoAllowed(g)`.
  // A minor or a person that the store does not know never sees a gallery or a photo form.
  val photoNeverMinor: bool =
    (view == Gallery or view == Form) implies (not(focusMinor(members)) and photoAllowed(curGate))

  // Rule: slice report B1 (the gallery stayed after the rule refused it).
  // LemmaScript: photoHeld and photoTrail, `ensures \result ==> forall(i, photoAllowed(gates[i]))`.
  // Photos that the panel still holds were allowed by every gate since they loaded.
  val photoTrail: bool = photos.loaded implies photos.trail

  // Rule: slice report B14 (an older read restored an old rule on the screen).
  // LemmaScript: shownRise (`ensures \result`) and olderLoses, from readLand
  // `ensures \result.show ==> forall(t <= ticket, !canLand(\result.gate, t))`.
  // A read that shows has a higher number than the read on the screen: an older read never
  // overwrites a newer one.
  val shownRise: bool = (lastLand.landed and lastLand.show) implies lastLand.ticket > lastLand.before

  // Rule: slice report B13 and B14 (a read from before a dependency change showed after it).
  // LemmaScript: readCancel, `ensures forall(t: int, t <= g.last ==> !canLand(\result, t))`.
  // A read that shows started after the last dependency change.
  val readCancel_noLand: bool = (lastLand.landed and lastLand.show) implies lastLand.startEpoch == lastLand.landEpoch

  // LemmaScript: readOk is kept by readNew, readStart, readCancel and readLand (`requires/ensures readOk`).
  val readGateOk: bool = readOk(gate) and gate.last <= MAX_TICKET

  // Rule: slice report B4 (a control read the saved tab, not the tab on screen); docs/observatory.md roles.
  // LemmaScript: effectiveTab, `ensures tabVisible(\result, c)`, `\result === "config" || "lab" ==> c.analyst`,
  // `\result === "lab" ==> !c.realOnly`, `\result === "game" ==> c.game`.
  // The tab on screen is always one that this viewer can open.
  val effectiveTabVisible: bool = and {
    tabVisible(shownTab, caps),
    (shownTab == Config or shownTab == Lab) implies caps.analyst,
    shownTab == Lab implies not(caps.realOnly),
    shownTab == Game implies caps.game,
    shownTab == Review implies caps.showReview,
    tabVisible(want, caps) implies shownTab == want,
  }

  // Rule: AGENTS.md "Age policy" (minors are never matched or connected); PRD 28.3 game is staff only.
  // LemmaScript: canPropose, `ensures \result ==> forall(i, minor.has(picks[i]) && !minor.get(picks[i]))`
  // and `ensures \result ==> hasGame && sparks > 0 && !over`.
  // A proposal never includes a minor or a person that the store does not know.
  val canPropose_noMinor: bool = proposals.foldl(true, (ok, pr) => ok and not(pr.bad))

  // LemmaScript: canPropose, the same contract, on the gate that enables the button.
  val readyOnlyInGame: bool = ready implies (game.has and game.sparks > 0 and not(game.over))

  // Rule: docs/observatory.md KPIs; slice report B5 and B15.
  // LemmaScript: yesCounts, `ensures 0 <= yes <= revealed <= opps.length` and
  // `ensures \result.yes > 0 ==> exists(i, forall(j, saidYes(opps[i][j])))`.
  val yesCountsBound: bool = {
    val c = yesCounts(opps)
    and {
      0 <= c.yes, c.yes <= c.revealed, c.revealed <= opps.length(),
      c.yes > 0 implies opps.indices().exists(i => opps[i].foldl(true, (ok, s) => ok and saidYes(s))),
    }
  }

  val safety: bool = and {
    photoNeverMinor, photoTrail, shownRise, readCancel_noLand, readGateOk,
    effectiveTabVisible, canPropose_noMinor, readyOnlyInGame, yesCountsBound,
  }

  // ================================================================ witnesses (each MUST be violated)
  // The gallery shows.
  val witness_galleryShown: bool = not(view == Gallery)
  // The rule on screen allows photos, but the live store says the person is now a minor: the
  // stated age dropped between reads. The panel hides.
  val witness_ageDropBetweenReads: bool =
    not(hasData and shown.rule == ReasonRequired and canSafety and focusMinor(members) and view == Hide)
  // A late read comes back and does not show (an older read lost to a newer one).
  val witness_lateReadDropped: bool =
    not(lastLand.landed and not(lastLand.show) and lastLand.startEpoch == lastLand.landEpoch)
  // A read from before a dependency change comes back and does not show.
  val witness_cancelledReadDropped: bool =
    not(lastLand.landed and not(lastLand.show) and lastLand.startEpoch < lastLand.landEpoch)
  // A credential change took the member panel off the screen.
  val witness_authCleared: bool = not(not(hasData) and epoch > 0 and gate.last > 1)
  // A second read shows after a first one.
  val witness_secondReadShown: bool = not(lastLand.landed and lastLand.show and lastLand.before > 0)
  // The saved tab is hidden and the drawer falls back to the feed.
  val witness_tabFallback: bool = not(want != shownTab)
  // A proposal goes out.
  val witness_proposalSent: bool = proposals.length() == 0
  // The tray has a minor pick in a live game, and the button is off.
  val witness_minorPickBlocked: bool =
    not(game.has and game.sparks > 0 and not(game.over) and picks.length() > 0 and not(ready))
  // An opportunity has a yes from everyone.
  val witness_everyoneYes: bool = yesCounts(opps).yes == 0

  // ================================================================ replayed traces
  // B14: two reads start, the newer one answers first, then the older one answers. The older one
  // does not show.
  run olderLosesTest = {
    val g1 = readStart(readStart(readNew))
    val l2 = readLand(g1, 2)
    val l1 = readLand(l2.gate, 1)
    assert(l2.show and not(l1.show))
  }

  // A dependency change cancels a read that is in flight.
  run cancelTest = {
    val g1 = readStart(readNew)
    val g2 = readStart(readCancel(g1))
    assert(not(readLand(g2, 1).show) and readLand(g2, 2).show)
  }

  // The stated age drops to a minor after a read with an allowed rule: the panel hides.
  run ageDropTest = {
    val g = { rule: ReasonRequired, canSafety: true, minor: true }
    assert(photoView(g, true) == Hide and not(photoHeld(g, true)))
  }

  // A pick that the store does not know blocks the proposal (fail closed).
  run unknownPickTest = assert(not(canPropose([1, 2], Map(1 -> false), true, 1, false))
                               and canPropose([1, 2], Map(1 -> false, 2 -> false), true, 1, false))

  // A saved Lab tab on a real-only console falls back to the feed.
  run labFallbackTest = {
    val c = { showReview: true, game: false, hasRequests: true, analyst: true, realOnly: true }
    assert(effectiveTab(Lab, c) == Feed and effectiveTab(Config, c) == Config)
  }
}
```
