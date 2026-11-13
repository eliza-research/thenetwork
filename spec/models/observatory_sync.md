# Staff console synchronization

## Story: Staff console synchronization

A staff user needs the console to show current data for the selected app.

### Safety rules and reachability

Check load generations, delta ordering, reveal badges, and filter behavior. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/observatory_sync.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

The browser calls [Observatory snapshot and live updates](../observatorySync.md) for the current load, delta versions, and feed sequence. Reveal, filters, and other separate console state remain in this standalone model.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=20 max-samples=20000
//
// observatory_sync: the Observatory console state sync, on the browser side.
//
// WHAT THIS MODELS
//   The browser state of one console tab (packages/observatory/web/store.ts, map.ts, drawer.tsx):
//   - The app switch (setApp and the `app` setter in store.ts). The data of the old app leaves.
//   - Full loads (load, beginLoad in store.ts). Each load has a generation. The server reads the
//     state at some time after the start, and the answer comes late, out of order, or fails.
//   - The delta stream (connect and applyDelta in store.ts). Deltas come with versions. They can
//     repeat, come out of order (a rewind or a gap), or carry a reset. A delta that comes during a
//     load waits in the buffer, and the buffer replays when the load lands.
//   - The feed merge (appendNew). A state at version V can hold part of delta V+1 (B18).
//   - The PII reveal badge (reveal, unreveal, loadReveals in store.ts) against the server grant.
//   - The global filters per drawer tab (filters.ts; the filter bar in drawer.tsx dims a filter by
//     APPLIES, which is tabKeys).
//   Each LemmaScript function in packages/observatory/web/logic/sync.ts and logic/filters.ts that
//   takes a decision is a pure def here with the same name and the same decision. Each shell event
//   is an action that calls it. The server is a nondeterministic environment.
//
// BOUNDS
//   Apps "A" and "B". Server version 0..MAX_VER and feed seq 0..MAX_SEQ per app. One member with a
//   reveal, in app "A". Six filter rows. Generations are not bounded, but a run has 20 steps.
//
// RUN (from the worktree root; quint 0.33.1; there is no Apalache in this setup)
//   quint typecheck quint/observatory_sync.qnt
//   quint run quint/observatory_sync.qnt --step=tick --invariant=<name> \
//     --max-samples=2000 --max-steps=20 --seed=11
//   For the sync invariants, run also with --step=syncTick (only the sync events and the server,
//   so the random runs go deeper): --max-samples=10000 --max-steps=20 --seed=11.
//   Each witness_<name> must be VIOLATED (the state is reachable). witness_twoDataDeltas needs
//   --step=syncTick; with --step=tick, 2000 samples of 20 steps do not reach it.
//   badgeFollowsGrant holds with the shipping shell since the revealMerge fix (see its comment).
//   For badgeFollowsGrant and revealReadPending, run also with --step=revealTick (only the loads
//   and the reveal events): --max-samples=20000 --max-steps=20.
//
// ABSTRACTIONS
//   - Versions, seqs and generations are integers. The shell drops a non-integer version or seq
//     before it calls the core, as the LemmaScript proofs assume.
//   - Arrays of keys, boroughs and tags are sets (the code only asks `includes`).
//   - A delta message carries an app tag. The shell drops a message of another app (msg.app check
//     in connect). The socket generation (wsGen) is not modeled: any delta of the current app can
//     come at any time, also from an old socket. This is more than the shell allows.
//   - A delta that the server sent stays on the wire, so it can come again (a repeat).
//   - Version and seq are per app. A server restart is not modeled: the socket close makes the
//     shell call load() (the `reconnect` action covers that load).
//
// OUTSIDE THE MODEL
//   - The /api/me and /api/mode prefix of load(), the redirect to the first app with a role, and
//     the role check (clientRoles; LemmaScript proves it against rolesFor).
//   - The mode switch (it is one more load here: `reconnect`).
//   - Map markers (markersAfter; LemmaScript proves the set equality). React and Leaflet timing.
//   - Wall-clock expiry of a reveal and clock skew between browser and server (`expire` ends both
//     sides at once).
//   - What a delta changes in members, edges and opportunities. Upserts are safe to repeat; only the
//     feed is checked here.
//   - The content of a full state. The model checks its app, its generation and its feed seqs.
module observatory_sync {

  // ---------------------------------------------------------------- bounds
  pure val APPS: Set[str] = Set("A", "B")
  pure val MAX_VER: int = 3
  pure val MAX_SEQ: int = 3
  /** The app of the one member with a reveal. */
  pure val REVEAL_APP: str = "A"

  // ---------------------------------------------------------------- sync.ts: types
  type SyncState = { app: str, gen: int, buffering: bool, dataApp: str, version: int, synced: bool }
  type LandEv = { gen: int, app: str, version: int }
  type DeltaEv = { version: int, reset: bool }
  type SyncEvent = Switch(str) | Begin | Land(LandEv) | Fail(int) | Delta(DeltaEv)

  // ---------------------------------------------------------------- sync.ts: decisions (same names)
  pure def initialSync(app: str): SyncState =
    { app: app, gen: 0, buffering: false, dataApp: "", version: 0, synced: false }

  /** sync.ts `good`. The Quint name `good` is the invariant, so this def has another name. */
  pure def goodSync(s: SyncState): bool =
    (s.dataApp == "" or s.dataApp == s.app) and (not(s.synced) or s.dataApp == s.app)

  pure def owns(s: SyncState, gen: int): bool = gen == s.gen

  pure def admits(s: SyncState, gen: int, app: str): bool =
    owns(s, gen) and app == s.app and s.buffering

  /** "buffer" | "reload" | "drop" | "meta" | "data", in the same order of tests as sync.ts. */
  pure def deltaMove(s: SyncState, version: int, reset: bool): str =
    if (reset) "reload"
    else if (s.buffering) "buffer"
    else if (not(s.synced)) "reload"
    else if (version < s.version) "drop"
    else if (version == s.version) "meta"
    else if (version > s.version + 1) "reload"
    else "data"

  // syncStep is sync.ts `step` (renamed here: `action step` is the default step for quint:check).
  pure def syncStep(s: SyncState, e: SyncEvent): SyncState = match e {
    | Switch(a) =>
        if (a == s.app) s
        else { app: a, gen: s.gen + 1, buffering: false, dataApp: "", version: 0, synced: false }
    | Begin => { ...s, gen: s.gen + 1, buffering: true }
    | Land(l) =>
        if (admits(s, l.gen, l.app)) { ...s, buffering: false, dataApp: l.app, version: l.version, synced: true }
        else s
    | Fail(g) => if (owns(s, g)) { ...s, buffering: false, synced: false } else s
    | Delta(d) => if (deltaMove(s, d.version, d.reset) == "data") { ...s, version: d.version } else s
  }

  // ---------------------------------------------------------------- sync.ts: feed merge
  type Item = { app: str, seq: int }

  /** sync.ts appendNew: add only the items with a seq above the last seq of the feed. */
  pure def appendNew(feed: List[Item], items: List[Item]): List[Item] =
    items.foldl(feed, (out, it) =>
      if (out.length() == 0 or it.seq > out[out.length() - 1].seq) out.append(it) else out)

  // ---------------------------------------------------------------- sync.ts: reveal
  type RevealState = { server: bool, badge: bool }

  /** A model of DELETE /api/reveal in src/server.ts: only 200 and 404 leave no grant. 0: no answer. */
  pure def serverEnded(status: int): bool = status == 200 or status == 404

  /** The client's rule: the badge goes only on an answer that shows that no grant is left. */
  pure def badgeEnds(status: int): bool = status == 200 or status == 404

  pure def unrevealStep(s: RevealState, status: int): RevealState =
    { server: if (serverEnded(status)) false else s.server,
      badge: if (badgeEnds(status)) false else s.badge }

  /** sync.ts revealMerge: a GET answer replaces the list only when it came and no POST or DELETE answer came after it was sent. */
  pure def revealMerge(gen: int, sentGen: int, ok: bool): bool = ok and sentGen == gen

  /** sync.ts revealReread: a GET answer that came after a newer POST or DELETE answer starts a new GET. */
  pure def revealReread(gen: int, sentGen: int, ok: bool): bool = ok and sentGen != gen

  // ---------------------------------------------------------------- filters.ts (same names)
  type FilterView = { allTime: bool, since: int, borough: str, members: str, origin: str, stateGroup: str }
  type FilterRow = { t: int, timeless: bool, boroughs: Set[str], tags: Set[str], origin: str, group: str }

  pure val ALL_KEYS: Set[str] = Set("range", "borough", "members", "origin", "stateGroup")
  pure val TABS: Set[str] = Set("review", "feed", "pipeline", "requests", "engine", "safety", "metrics", "lab", "config", "game")

  pure def tabKeys(tab: str): Set[str] =
    if (tab == "review") Set("borough", "members", "origin")
    else if (tab == "feed") Set("range", "borough", "members", "origin")
    else if (tab == "pipeline") Set("range", "borough", "members", "origin", "stateGroup")
    else if (tab == "engine") Set("range")
    else if (tab == "safety") Set("range", "borough", "members")
    else if (tab == "metrics") Set("range", "borough", "origin")
    else if (tab == "requests") Set("range", "borough", "members")
    else Set()

  pure def has(ks: Set[str], key: str): bool = ks.contains(key)

  pure def rangeOk(t: int, timeless: bool, f: FilterView): bool = f.allTime or timeless or t >= f.since
  pure def boroughOk(boroughs: Set[str], borough: str): bool = borough == "all" or boroughs.contains(borough)
  pure def membersOk(tags: Set[str], members: str): bool = members == "all" or tags.contains(members)

  pure def passes(ks: Set[str], x: FilterRow, f: FilterView): bool =
    (not(has(ks, "range")) or rangeOk(x.t, x.timeless, f))
    and (not(has(ks, "borough")) or boroughOk(x.boroughs, f.borough))
    and (not(has(ks, "members")) or membersOk(x.tags, f.members))
    and (not(has(ks, "origin")) or f.origin == "all" or x.origin == f.origin)
    and (not(has(ks, "stateGroup")) or f.stateGroup == "all" or x.group == f.stateGroup)

  pure def visible(tab: str, x: FilterRow, f: FilterView): bool = passes(tabKeys(tab), x, f)

  // ---------------------------------------------------------------- the shell's filter keys per tab
  // The keys the shell code applies to the list of each tab (read from the code, not from tabKeys):
  //   review   store.ts matchReview -> visible("review")
  //   feed     drawer.tsx:108 matchFeed -> visible("feed")
  //   pipeline drawer.tsx:168 matchOpp(o) -> every key
  //   engine   drawer.tsx:213 inRange -> range
  //   safety   drawer.tsx:315 matchMember (borough, members) and :319 matchFeed -> visible("safety");
  //            admin.tsx:87 SafetyCases inBorough -> borough
  //   metrics  drawer.tsx:378 inRange and matchOpp(skip range, members, stateGroup) -> range, borough,
  //            origin; :380 inBorough -> borough
  //   requests admin.tsx:318-319 matchMember and inRange -> borough, members, range
  //   lab, config, game: no filter
  // The filter bar dims a key that is not in APPLIES[tab] = tabKeys(tab) (drawer.tsx:22).
  pure def shellKeys(tab: str): Set[str] =
    if (tab == "review") tabKeys("review")
    else if (tab == "feed") tabKeys("feed")
    else if (tab == "pipeline") ALL_KEYS
    else if (tab == "engine") Set("range")
    else if (tab == "safety") tabKeys("safety").union(Set("borough", "members"))
    else if (tab == "metrics") Set("range").union(ALL_KEYS.exclude(Set("range", "members", "stateGroup"))).union(Set("borough"))
    else if (tab == "requests") Set("borough", "members", "range")
    else Set()

  pure def shellShows(tab: str, x: FilterRow, f: FilterView): bool = passes(shellKeys(tab), x, f)

  pure val ROWS: Set[FilterRow] = Set(
    { t: 0, timeless: false, boroughs: Set("bk"), tags: Set("active"), origin: "engine", group: "open" },
    { t: 10, timeless: false, boroughs: Set("qn"), tags: Set("watch"), origin: "request", group: "met" },
    { t: 0, timeless: true, boroughs: Set("bk", "qn"), tags: Set(), origin: "request", group: "open" },
    { t: 10, timeless: false, boroughs: Set(), tags: Set(), origin: "", group: "" },
    { t: 0, timeless: false, boroughs: Set("qn"), tags: Set("active", "watch"), origin: "", group: "met" },
    { t: 10, timeless: true, boroughs: Set("bk"), tags: Set("active"), origin: "engine", group: "met" },
  )

  pure val NO_FILTER: FilterView =
    { allTime: true, since: 0, borough: "all", members: "all", origin: "all", stateGroup: "all" }

  // ---------------------------------------------------------------- environment and shell types
  /** One delta on the socket: its app, version, reset flag, and the feed seqs lo..hi it carries. */
  type Msg = { app: str, version: int, reset: bool, lo: int, hi: int }
  /** One full load: its generation and app, and, once the server read it, the version and seq. */
  type Req = { gen: int, app: str, read: bool, version: int, seq: int }
  /** The server of one app: its version, its feed seq, and the last seq that a delta carried. */
  type Srv = { ver: int, seq: int, sent: int }
  /** One GET /api/reveal: the app it was for, what the server read, and store.ts revealGen at the send. */
  type RevReq = { id: int, app: str, read: bool, grant: bool, gen: int }

  /** The shell state of the tab, with ghost fields that only the invariants read. */
  type Ui = {
    sync: SyncState,
    screenApp: str,          // the app of the data on screen ("" when the panels are empty)
    feed: List[Item],
    buffer: List[Msg],
    loads: Set[Req],
    // ghosts
    landGen: int,            // the generation of the load whose state is on screen
    landApp: str,
    landVersion: int,
    applied: List[int],      // the versions applied as data since that load landed
    rewound: bool,           // a delta step made the version fall
    lastEvent: str,
  }

  pure def itemsOf(app: str, lo: int, hi: int): List[Item] =
    if (lo > hi) List() else range(lo, hi + 1).foldl(List(), (acc, q) => acc.append({ app: app, seq: q }))

  /** store.ts beginLoad and the request that load() sends. */
  pure def beginLoad(u: Ui): Ui = {
    val s = syncStep(u.sync, Begin)
    { ...u, sync: s, buffer: List(),
      loads: u.loads.union(Set({ gen: s.gen, app: s.app, read: false, version: 0, seq: 0 })) }
  }

  /** store.ts applyDelta, after the socket filter in connect (msg.app check). */
  pure def applyMsg(u: Ui, m: Msg): Ui =
    if (m.app != u.sync.app) { ...u, lastEvent: "deltaOtherApp" }
    else {
      val mv = deltaMove(u.sync, m.version, m.reset)
      if (mv == "buffer") { ...u, buffer: u.buffer.append(m), lastEvent: "deltaBuffer" }
      else if (mv == "reload") { ...beginLoad(u), lastEvent: "deltaReload" }
      else if (mv == "drop") { ...u, lastEvent: "deltaDrop" }
      else {
        // "meta" or "data": the shell calls step with the delta in both cases.
        val s2 = syncStep(u.sync, Delta({ version: m.version, reset: false }))
        val fed = if (mv == "data") appendNew(u.feed, itemsOf(m.app, m.lo, m.hi)) else u.feed
        val ap = if (mv == "data") u.applied.append(m.version) else u.applied
        { ...u, sync: s2, feed: fed, applied: ap, rewound: u.rewound or s2.version < u.sync.version,
          lastEvent: if (mv == "data") "deltaData" else "deltaMeta" }
      }
    }

  /** store.ts load(), from the /api/state answer: admits, applyFull, step land, buffer replay. */
  pure def landAnswer(u: Ui, r: Req): Ui = {
    val u0 = { ...u, loads: u.loads.exclude(Set(r)) }
    if (admits(u0.sync, r.gen, r.app)) {
      val later = u0.buffer
      val full = { ...u0, screenApp: r.app, feed: itemsOf(r.app, 1, r.seq),
                   sync: syncStep(u0.sync, Land({ gen: r.gen, app: r.app, version: r.version })),
                   landGen: r.gen, landApp: r.app, landVersion: r.version, applied: List(), buffer: List() }
      val after = later.foldl(full, (acc, m) => applyMsg(acc, m))
      { ...after, lastEvent: "land" }
    } else {
      { ...u0, lastEvent: if (r.app != u0.sync.app) "landOtherApp" else "landStale" }
    }
  }

  /** store.ts load(), the catch path. */
  pure def failAnswer(u: Ui, r: Req): Ui = {
    val u0 = { ...u, loads: u.loads.exclude(Set(r)) }
    if (owns(u0.sync, r.gen)) { ...u0, sync: syncStep(u0.sync, Fail(r.gen)), lastEvent: "fail" }
    else { ...u0, lastEvent: "failStale" }
  }

  /** store.ts setApp(app) for a changed app: the setter (step switch, clearData), then load(). */
  pure def switchApp(u: Ui, a: str): Ui = {
    val had = u.sync.dataApp != ""
    val s1 = syncStep(u.sync, Switch(a))
    val cleared = if (had and s1.dataApp == "") { ...u, sync: s1, screenApp: "", feed: List() } else { ...u, sync: s1 }
    { ...beginLoad(cleared), lastEvent: "switch" }
  }

  // ---------------------------------------------------------------- state
  var ui: Ui
  var srv: str -> Srv
  var wire: Set[Msg]
  /**
   * The page: the server grant of the member, the badge, and "the reveal list is not loaded yet, or
   * a POST answer was lost after it". gen: store.ts revealGen. ev: ghost, the last reveal event.
   * failed: ghost, the last GET answer for this app failed and no GET was sent after it.
   */
  var rv: { server: bool, badge: bool, stale: bool, lastStatus: int, gen: int, ev: str, failed: bool }
  /** Ghost: the LemmaScript fold of unrevealRun (grants and DELETE answers only). */
  var rvCore: RevealState
  var revReqs: Set[RevReq]
  var flt: FilterView
  var prevFlt: FilterView
  var lastKey: str
  var tab: str

  action init = all {
    // The constructor calls connect() and load().
    ui' = beginLoad({ sync: initialSync("A"), screenApp: "", feed: List(), buffer: List(), loads: Set(),
                      landGen: -1, landApp: "", landVersion: 0, applied: List(), rewound: false, lastEvent: "init" }),
    srv' = APPS.mapBy(a => { ver: 0, seq: 0, sent: 0 }),
    wire' = Set(),
    rv' = { server: false, badge: false, stale: true, lastStatus: -1, gen: 0, ev: "init", failed: false },
    rvCore' = { server: false, badge: false },
    revReqs' = Set(),
    flt' = NO_FILTER,
    prevFlt' = NO_FILTER,
    lastKey' = "",
    tab' = "feed",
  }

  action keepReveal = all { rv' = rv, rvCore' = rvCore, revReqs' = revReqs }
  action keepFilters = all { flt' = flt, prevFlt' = prevFlt, lastKey' = lastKey, tab' = tab }
  action keepEnv = all { srv' = srv, wire' = wire }

  // ---------------------------------------------------------------- server (environment)
  /** The server adds a feed item. The version does not change (src/store.ts pushFeed). */
  action serverPush = {
    nondet a = APPS.oneOf()
    all {
      srv.get(a).seq < MAX_SEQ,
      srv' = srv.set(a, { ...srv.get(a), seq: srv.get(a).seq + 1 }),
      wire' = wire, ui' = ui, keepReveal, keepFilters,
    }
  }

  /** The server sends delta ver+1 with the feed items that no delta carried yet (takeDelta). */
  action serverDelta = {
    nondet a = APPS.oneOf()
    val v = srv.get(a)
    all {
      v.ver < MAX_VER,
      srv' = srv.set(a, { ...v, ver: v.ver + 1, sent: v.seq }),
      wire' = wire.union(Set({ app: a, version: v.ver + 1, reset: false, lo: v.sent + 1, hi: v.seq })),
      ui' = ui, keepReveal, keepFilters,
    }
  }

  /**
   * The server sends a reset. src/store.ts takeDelta sets reset when edges were removed (a change, so
   * the version goes up and the new feed items leave with it); sources/game.ts sets it on a game reset,
   * also on a delta with no change (the version stays). The client reloads either way.
   */
  action serverReset = {
    nondet a = APPS.oneOf()
    nondet bump = Set(true, false).oneOf()
    val v = srv.get(a)
    all {
      not(bump) or v.ver < MAX_VER,
      srv' = if (bump) srv.set(a, { ...v, ver: v.ver + 1, sent: v.seq }) else srv,
      wire' = wire.union(Set({ app: a, version: if (bump) v.ver + 1 else v.ver, reset: true, lo: 1, hi: 0 })),
      ui' = ui, keepReveal, keepFilters,
    }
  }

  /** The server reads the state of one load (at any time after the load starts). */
  action serverRead = {
    nondet r = ui.loads.filter(r => not(r.read)).oneOf()
    all {
      ui' = { ...ui, loads: ui.loads.exclude(Set(r)).union(Set({ ...r, read: true, version: srv.get(r.app).ver, seq: srv.get(r.app).seq })), lastEvent: "read" },
      keepEnv, keepReveal, keepFilters,
    }
  }

  // ---------------------------------------------------------------- shell events
  /** A delta comes on the socket: any sent delta, in any order, again and again. */
  action deliver = {
    nondet m = wire.oneOf()
    all { ui' = applyMsg(ui, m), keepEnv, keepReveal, keepFilters }
  }

  /** The /api/state answer lands. A land that the core admits also sends GET /api/reveal. */
  action land = {
    nondet r = ui.loads.filter(r => r.read).oneOf()
    val u2 = landAnswer(ui, r)
    val admitted = admits(ui.sync, r.gen, r.app)
    all {
      ui' = u2,
      revReqs' = if (admitted) revReqs.union(Set({ id: r.gen, app: r.app, read: false, grant: false, gen: rv.gen })) else revReqs,
      rv' = if (admitted) { ...rv, failed: false } else rv, rvCore' = rvCore, keepEnv, keepFilters,
    }
  }

  /** A load fails (any step of load() throws, or the answer is not JSON). */
  action loadFail = {
    nondet r = ui.loads.oneOf()
    all { ui' = failAnswer(ui, r), keepEnv, keepReveal, keepFilters }
  }

  /** The staff member picks another app (store.setApp). */
  action setApp = {
    nondet a = APPS.oneOf()
    all {
      a != ui.sync.app,
      val had = ui.sync.dataApp != ""
      all {
        ui' = switchApp(ui, a),
        // clearData empties the reveal list.
        rv' = if (had) { ...rv, badge: false, stale: true } else rv,
        rvCore' = rvCore, revReqs' = revReqs, keepEnv, keepFilters,
      }
    }
  }

  /** Another call of load(): the socket reconnect, a 4401/4403 close, the mode message, setMode. */
  action reconnect = all {
    ui' = { ...beginLoad(ui), lastEvent: "reconnect" },
    keepEnv, keepReveal, keepFilters,
  }

  // ---------------------------------------------------------------- reveal events
  /**
   * POST /api/reveal. "ok": the badge shows. "lost": the server made the grant, the answer is lost.
   * store.ts reveal: each answer adds 1 to revealGen; with no grant in the answer it reads the list again.
   */
  action grant = {
    nondet outcome = Set("ok", "lost", "refused").oneOf()
    val g = rv.gen + 1
    val reread = { id: -g, app: ui.sync.app, read: false, grant: false, gen: g }
    all {
      ui.sync.app == REVEAL_APP, ui.screenApp == REVEAL_APP,
      not(rv.badge), // RevealControl shows the Reveal button only with no badge.
      rv' = if (outcome == "ok") { ...rv, server: true, badge: true, stale: false, gen: g, ev: "grantOk", failed: false }
            else if (outcome == "lost") { ...rv, server: true, stale: true, gen: g, ev: "grantLost", failed: false }
            else { ...rv, gen: g, ev: "grantRefused", failed: false },
      rvCore' = if (outcome == "ok") { server: true, badge: true } else rvCore,
      revReqs' = if (outcome == "ok") revReqs else revReqs.union(Set(reread)),
      ui' = ui, keepEnv, keepFilters,
    }
  }

  /** DELETE /api/reveal (the End button). Status 0: the request threw; the server may have acted. */
  action unreveal = {
    nondet status = Set(0, 200, 404, 403, 500).oneOf()
    nondet actedAnyway = Set(true, false).oneOf()
    all {
      ui.sync.app == REVEAL_APP, rv.badge,
      // store.ts unreveal: the shell asks the core with {server: true, badge: true}.
      val keep = unrevealStep({ server: true, badge: true }, status).badge
      rv' = { ...rv,
              server: if (serverEnded(status) or (status == 0 and actedAnyway)) false else rv.server,
              badge: if (keep) rv.badge else false, lastStatus: status, gen: rv.gen + 1, ev: "unreveal" },
      rvCore' = unrevealStep(rvCore, status),
      revReqs' = revReqs, ui' = ui, keepEnv, keepFilters,
    }
  }

  /**
   * A POST or DELETE answer for another member on the same page: store.ts adds 1 to revealGen. A
   * POST with no grant in the answer (reread) also sends a GET. This member does not change.
   */
  action otherAnswer = {
    nondet reread = Set(true, false).oneOf()
    val g = rv.gen + 1
    all {
      ui.sync.app == REVEAL_APP, ui.screenApp == REVEAL_APP,
      rv' = { ...rv, gen: g, ev: "other", failed: if (reread) false else rv.failed },
      revReqs' = if (reread) revReqs.union(Set({ id: -500 - g, app: ui.sync.app, read: false, grant: false, gen: g })) else revReqs,
      rvCore' = rvCore, ui' = ui, keepEnv, keepFilters,
    }
  }

  /** The grant time ends. Both sides end together (clock skew is outside the model). */
  action expire = all {
    rv.server or rv.badge,
    rv' = { ...rv, server: false, badge: false, ev: "expire" },
    rvCore' = { server: false, badge: false },
    revReqs' = revReqs, ui' = ui, keepEnv, keepFilters,
  }

  /** The server reads the grant list for one GET /api/reveal. */
  action revealRead = {
    nondet q = revReqs.filter(q => not(q.read)).oneOf()
    all {
      revReqs' = revReqs.exclude(Set(q)).union(Set({ ...q, read: true, grant: q.app == REVEAL_APP and rv.server })),
      rv' = rv, rvCore' = rvCore, ui' = ui, keepEnv, keepFilters,
    }
  }

  /**
   * The GET /api/reveal answer: store.ts loadReveals. An old answer that came sends a new GET
   * (revealReread). The list is replaced only when revealMerge says so.
   */
  action revealAnswer = {
    nondet q = revReqs.filter(q => q.read).oneOf()
    nondet ok = Set(true, false).oneOf()
    all {
      revReqs' = if (q.app == ui.sync.app and revealReread(rv.gen, q.gen, ok))
                   revReqs.exclude(Set(q)).union(Set({ id: -1000 - rv.gen, app: q.app, read: false, grant: false, gen: rv.gen }))
                 else revReqs.exclude(Set(q)),
      // `if (app !== this.app) return`. A failed or old answer keeps the list. Otherwise it is replaced.
      rv' = if (q.app != ui.sync.app) rv
            else if (revealReread(rv.gen, q.gen, ok)) { ...rv, ev: "answerOld", failed: false }
            else if (not(revealMerge(rv.gen, q.gen, ok))) { ...rv, ev: "answerFailed", failed: true }
            else if (q.app == REVEAL_APP) { ...rv, badge: q.grant, stale: false, failed: false,
                                             ev: if (q.id <= -1000) "rereadOld" else if (q.id < 0) "reread" else "answer" }
            else { ...rv, badge: false, stale: false, failed: false, ev: "answer" },
      rvCore' = rvCore, ui' = ui, keepEnv, keepFilters,
    }
  }

  // ---------------------------------------------------------------- filter events
  action setTab = {
    nondet t = TABS.oneOf()
    all { tab' = t, flt' = flt, prevFlt' = prevFlt, lastKey' = lastKey, ui' = ui, keepEnv, keepReveal }
  }

  /** store.setFilters: one key changes. */
  action setFilter = {
    nondet k = ALL_KEYS.oneOf()
    nondet allTime = Set(true, false).oneOf()
    nondet since = Set(0, 5).oneOf()
    nondet b = Set("all", "bk", "qn").oneOf()
    nondet mem = Set("all", "active", "watch").oneOf()
    nondet o = Set("all", "engine", "request").oneOf()
    nondet g = Set("all", "open", "met").oneOf()
    all {
      flt' = if (k == "range") { ...flt, allTime: allTime, since: since }
             else if (k == "borough") { ...flt, borough: b }
             else if (k == "members") { ...flt, members: mem }
             else if (k == "origin") { ...flt, origin: o }
             else { ...flt, stateGroup: g },
      prevFlt' = flt, lastKey' = k, tab' = tab,
      ui' = ui, keepEnv, keepReveal,
    }
  }

  /** Only the sync events and the server. The random runs then reach deeper sync states. */
  action syncTick = any {
    serverPush, serverDelta, serverReset, serverRead,
    deliver, land, loadFail, setApp, reconnect,
  }

  /** Only the load answers and the reveal events. The random runs then reach longer reveal orders. */
  action revealTick = any {
    serverRead, land, reconnect,
    grant, unreveal, otherAnswer, expire, revealRead, revealAnswer,
  }

  action tick = any {
    serverPush, serverDelta, serverReset, serverRead,
    deliver, land, loadFail, setApp, reconnect,
    grant, unreveal, otherAnswer, expire, revealRead, revealAnswer,
    setTab, setFilter,
  }

  /**
   * The default step for `bun run quint:check`. It allows the same events as `tick`, but it picks the
   * sync-only and reveal-only steps more often, so random runs reach the longer delta and reveal orders.
   * revealTick is listed three times on purpose: the simulator picks each listed action with the same
   * chance, and witness_oldReread needs a long reveal order.
   */
  action step = any { tick, syncTick, revealTick, revealTick, revealTick }

  // ================================================================ invariants
  // Each comment names the rule and the LemmaScript function and contract that proves it in code.

  // Rule: nothing on screen belongs to another app (bug B1 and B9 in
  // docs/research/lemmascript/frontend-observatory-state.md; admin-console app scoping).
  // LemmaScript: sync.ts `good`, kept by `step` (ensures good(\result)) and by `run` (any order).
  // Here it also checks the shell: the panels and every feed item are of the current app.
  val good: bool =
    goodSync(ui.sync)
    and (ui.screenApp == "" or ui.screenApp == ui.sync.app)
    and (not(ui.sync.synced) or ui.screenApp == ui.sync.app)
    and ui.feed.foldl(true, (ok, it) => ok and it.app == ui.sync.app)

  // Rule: each version is applied once and in order, and the version never falls (B2, B11).
  // LemmaScript: sync.ts `appliedVersions` (ensures \result[i] === s.version + 1 + i), with
  // `deltaMove` (ensures "data" ==> version === s.version + 1).
  val appliedVersions: bool =
    ui.applied.indices().forall(i => ui.applied[i] == ui.landVersion + 1 + i)
    and (ui.sync.synced implies ui.sync.version == ui.landVersion + ui.applied.length())

  // Rule: a delta never makes the version fall (B2).
  // LemmaScript: sync.ts `step`, ensures e.kind === "delta" ==> \result.version >= s.version.
  val stepDeltaNoRewind: bool = not(ui.rewound)

  // Rule: a stale load never lands; the newest load wins (B1, B3).
  // LemmaScript: sync.ts `newerLoadWins`, and `step` ensures
  // e.kind === "land" && !admits(s, e.gen, e.app) ==> \result === s.
  val newerLoadWins: bool =
    (ui.sync.synced and not(ui.sync.buffering)) implies (ui.landGen == ui.sync.gen and ui.landApp == ui.sync.app)

  // Rule: the newest load can still land; an old answer does not end its buffering (B3).
  // LemmaScript: sync.ts `step`, ensures e.kind === "fail" && !owns(s, e.gen) ==> \result === s,
  // and `loadLands` (a load that nothing overtakes lands).
  val newestLoadCanLand: bool =
    ui.loads.forall(r => r.gen == ui.sync.gen implies (ui.sync.buffering and r.app == ui.sync.app))

  // Rule: the feed holds each item once, in seq order (B18, B11).
  // LemmaScript: sync.ts `appendNew`, ensures \result is strictly sorted by seq.
  val appendNewSorted: bool =
    ui.feed.indices().forall(i => ui.feed.indices().forall(j => i < j implies ui.feed[i].seq < ui.feed[j].seq))

  // Rule: after a DELETE answer, the badge stays on while the server can still serve the PII (B10).
  // LemmaScript: sync.ts `unrevealRun` (ensures \result.server ==> \result.badge), from
  // `unrevealStep` and `badgeEnds` (ensures \result <==> serverEnded(status)).
  val unrevealRun: bool = rvCore.server implies rvCore.badge

  // Rule: the same, for the whole page: while the server holds a grant for a member on screen and
  // the reveal list is loaded, the badge shows (admin-console PII reveal; B10).
  // LemmaScript: sync.ts `revealRun` (ensures \result.known && \result.server ==> \result.badge),
  // from `revealStep` and `revealMerge`. Before the fix, store.ts loadReveals set
  // `reveals = r.data ?? []` (a failed GET, or an answer read before a newer grant, removed the
  // badge), and reveal() did not read the list again when the POST answer was lost.
  val badgeFollowsGrant: bool =
    (ui.sync.app == REVEAL_APP and ui.screenApp == REVEAL_APP and rv.server and not(rv.stale)) implies rv.badge

  // Rule: while the server holds the grant and the list is not known (stale), a GET /api/reveal of
  // this app is on the way, unless the last one failed (the residual window: the next load reads it).
  // It closes the gap of badgeFollowsGrant, which allows a stale list: an old GET answer dropped
  // after a POST or DELETE answer for another member must not leave the list stale with no GET.
  // LemmaScript: sync.ts `revealStep` (an old answer that came appends a read at the current gen),
  // from `revealReread` (ensures \result === (ok && sentGen !== gen)).
  val revealReadPending: bool =
    (ui.sync.app == REVEAL_APP and ui.screenApp == REVEAL_APP and rv.server and rv.stale and not(rv.failed))
      implies revReqs.exists(q => q.app == REVEAL_APP)

  // Rule: a filter that the bar dims does not change what the tab shows (B4, B19).
  // LemmaScript: filters.ts `tabNonInterference` (requires agree(tabKeys(tab), f, g)), here
  // applied to the keys that the shell code really uses for each tab (shellKeys).
  val tabNonInterference: bool =
    (lastKey != "" and not(tabKeys(tab).contains(lastKey)))
      implies ROWS.forall(x => shellShows(tab, x, flt) == shellShows(tab, x, prevFlt))

  // Rule: the Origin filter cannot hide a Safety event (B4).
  // LemmaScript: filters.ts `safetyIgnoresOrigin`.
  val safetyIgnoresOrigin: bool =
    (tab == "safety" and lastKey == "origin") implies ROWS.forall(x => shellShows("safety", x, flt) == shellShows("safety", x, prevFlt))

  // Rule: no Range filter hides a Review item, pending or decided (B19).
  // LemmaScript: filters.ts `reviewIgnoresRange`.
  val reviewIgnoresRange: bool =
    (tab == "review" and lastKey == "range") implies ROWS.forall(x => shellShows("review", x, flt) == shellShows("review", x, prevFlt))

  // Rule: every filter at "all" hides nothing, on any tab.
  // LemmaScript: filters.ts `allHidesNothing`.
  val allHidesNothing: bool =
    (flt == NO_FILTER) implies TABS.forall(t => ROWS.forall(x => shellShows(t, x, flt)))

  /** All invariants that must hold. */
  val safety: bool =
    good and appliedVersions and stepDeltaNoRewind and newerLoadWins and newestLoadCanLand and appendNewSorted
    and unrevealRun and badgeFollowsGrant and revealReadPending and tabNonInterference and safetyIgnoresOrigin and reviewIgnoresRange and allHidesNothing

  // ================================================================ reachability witnesses
  // Each one is EXPECTED to be violated. If one holds, the matching invariant passes in vain.

  /** A load of an older generation answers after a newer one began, and changes nothing. */
  val witness_staleLoadIgnored: bool = ui.lastEvent != "landStale"
  /** A load of the old app answers after the switch. */
  val witness_otherAppLoadIgnored: bool = ui.lastEvent != "landOtherApp"
  /** A load lands and the buffer replays at least one delta as data. */
  val witness_bufferReplayed: bool = not(ui.lastEvent == "land" and ui.applied.length() > 0)
  /** Two versions applied as data after one load. */
  val witness_twoDataDeltas: bool = ui.applied.length() < 2
  /** A delta at the state's own version is kept as meta. */
  val witness_metaDelta: bool = ui.lastEvent != "deltaMeta"
  /** An older delta (a rewind or a repeat) is dropped. */
  val witness_rewindDropped: bool = ui.lastEvent != "deltaDrop"
  /** A gap or a reset starts a new load. */
  val witness_gapReload: bool = ui.lastEvent != "deltaReload"
  /** An app switch empties the panels after data was on screen. */
  val witness_switchCleared: bool = not(ui.lastEvent == "switch" and ui.landGen >= 0 and ui.screenApp == "")
  /** The feed has two items after a delta that overlaps the state (B18 shape). */
  val witness_feedTwoItems: bool = ui.feed.length() < 2
  /** A DELETE answer that fails keeps the badge while the server keeps the grant. */
  val witness_badgeKeptOnFailure: bool = not(rv.lastStatus == 500 and rv.badge and rv.server and rvCore.server and rvCore.badge)
  /** A failed GET /api/reveal answer keeps the badge while the server holds the grant (path a). */
  val witness_failedReadKept: bool = not(rv.ev == "answerFailed" and rv.server and rv.badge and ui.sync.app == REVEAL_APP)
  /** A GET answer older than a POST answer is dropped, and the badge stays (path b). */
  val witness_oldReadDropped: bool = not(rv.ev == "answerOld" and rv.server and rv.badge and ui.sync.app == REVEAL_APP)
  /** After a lost POST answer, the second read shows the badge of the grant that the server made (path c). */
  val witness_lostReread: bool = not(rv.ev == "reread" and rv.server and rv.badge and not(rv.stale))
  /** An old GET answer, dropped after an answer for another member, is read again and shows the badge. */
  val witness_oldReread: bool = not(rv.ev == "rereadOld" and rv.server and rv.badge and not(rv.stale))
  /** A filter that the bar dims is changed, so tabNonInterference is not vacuous. */
  val witness_dimmedFilterChanged: bool = not(lastKey != "" and not(tabKeys(tab).contains(lastKey)) and flt != prevFlt)
  /** A filter that applies hides a row on the current tab. */
  val witness_filterHides: bool = ROWS.forall(x => shellShows(tab, x, flt))
}
```
