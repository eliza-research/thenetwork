// quint-check: max-steps=14 max-samples=20000 verify-steps=6
//
// The staff console (packages/observatory) and its path to the Network service, as small machines in one
// state record. Plan: docs/research/2026-11-07-state-machines.md section 6.15. Machine notes:
// docs/research/state-machines/observatory.md (sections 2.1 to 2.13) and
// docs/research/state-machines/gap-console-client.md (sections 2.1 to 2.9).
//
// Bounds: 2 staff (S1, S2), 2 apps (slop, peon), one member per app (x in slop, y in peon; one person P owns
// both), one case id "sc1" in each app (each app's Network counts cases from 1, network.ts:1211).
//
// Staff grants at start (platform.staff_roles): S1 = safety@slop + reviewer@slop; S2 = admin@*.
//
// Oracles and other actors are nondeterministic: the audit sink (up or down), the database reads (ok or
// failed), the service (commits, refuses, crashes), the response (in time or after the 15 s timeout), the
// Network (age signals, review items, leave and forget), the world simulator (game outcome records), and the
// service clock (skew). Time is an integer tick.
//
// The invariants come from the rules (AGENTS.md, the PRD, docs/admin-console.md, code comments), not from the
// code. Where the code does not meet a rule, `safety` fails and the counterexample names a register id
// (docs/research/quint-findings/staff_console.md).
module staff_console {

  // ------------------------------------------------------------------ types
  type Grant = (str, str, str) // (staff, role, app or "*")
  type Reveal = { st: str, app: str, m: str, until: int }
  type Socket = { st: str, app: str, fresh: bool }
  type Ticket = { id: int, st: str, app: str, until: int }
  type Effect = { id: int, kind: str, rowBefore: bool }

  type State = {
    now: int,
    // staff-grants (staff.ts:205-229): the table and the console's copy, reloaded every 60 s.
    grantsDb: Set[Grant],
    grantsCopy: Set[Grant],
    // members in an open review item (real.ts:716 inOpenReview), set by the Network.
    openReview: Set[str],
    // pii-reveal (server.ts:295, 561-588) and the client's list (web/store.ts:540-558).
    reveals: Set[Reveal],
    clientReveals: Set[Reveal],
    auditedReveals: Set[(str, str)],
    lastRead: { valid: bool, st: str, revealed: bool, safetyNow: bool },
    // ws-ticket and ws-socket (server.ts:471-476, 797-824, 338-347).
    tickets: Set[Ticket],
    nextTicket: int,
    sockets: Set[Socket],
    // staff-audit and staff-action-relay: one console action in flight (server.ts:611-617, 630-633, 679-683;
    // sources/service.ts:92-104) and the service effects it causes (network service.ts).
    rel: { phase: str, kind: str, consoleRowFirst: bool, svc: str, consoleResult: str },
    svcEffects: Set[Effect],
    nextEffect: int,
    // real-source (real.ts:196-236).
    src: { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool },
    // console-age-view (real.ts:71-97, 264-272, 420-449) for member x, and the slop photo panel (panels.tsx:576-604).
    age: { netMinor: bool, viaEvent: bool, recordAge: str, consoleMinor: bool, netAtPoll: bool, photosShown: bool },
    // console-fetch-scope and case-row-actions (admin.tsx:11-21, 58-111, 182-230; web/store.ts:282).
    cs: { shownApp: str, dataApp: str, closeSent: bool, intended: str, actual: str, note: bool, noteLost: bool },
    // report-row-actions, hold (admin.tsx:260; service.ts:1676-1688).
    hs: { heldIn: Set[str], toastEvery: bool },
    // console-mode and source cache (server.ts:189-251, 361-372).
    md: { realOnly: bool, mode: str, srcState: str -> str, pending: str, ranSaw: str, ranIn: str },
    // network-matching-gate (apps.ts:21; real.ts:864; health.ts:334; service.ts:1809-1817).
    mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool },
    // matching-switch-confirm (admin.tsx:378-392).
    cf: { armed: bool, armedApp: str, dataApp: str, sent: bool, sentApp: str, sentArmedFor: str, sentDataOf: str },
    // auth-prompt (web/store.ts:283-316).
    cl: { epoch: int, inflight: Set[int], authNeeded: bool, valid: Set[int] },
    // held photo preview (server.ts:640-655, 676-683; network service.ts:2306-2307).
    pv: { skew: int, tokenUntil: int, state: str, refusedAt: int, loadedBy: str, releasedBy: str },
    // opp-projection, game mode (projector.ts:11-14, 100-110, 160-200, 245-256).
    pj: { stage: str, proj: str, term: str },
    // real-source store retention for member z (real.ts:334-341, 351-356; network runtime.ts:520-545).
    fg: { dbEdge: bool, consoleEdge: bool, edgeAtPoll: bool, left: bool, dbRemovedNoName: bool, consoleDeclined: bool },
    // client-sync: snapshot and buffered deltas (web/store.ts:330-345, 380-392).
    dv: { server: int, feed: int, version: int, loading: bool, buffered: Set[int] },
  }

  var s: State

  // ------------------------------------------------------------------ constants
  pure val STAFF = Set("S1", "S2")
  pure val APPS = Set("slop", "peon")
  pure val MODES = Set("game", "real")
  pure val KINDS = Set("review", "hold", "leak", "relayText")
  pure val MEMBER_OF: str -> str = Map("slop" -> "x", "peon" -> "y")
  // Case "sc1" exists in each app and names a different member (network.ts:1211: `sc${++this.caseSeq}`, no app prefix).
  pure val CASE_SC1: str -> str = Map("slop" -> "x", "peon" -> "y")
  pure val GRANTS0: Set[Grant] = Set(("S1", "safety", "slop"), ("S1", "reviewer", "slop"), ("S2", "admin", "*"))
  // PACK_READY (apps.ts:21): the console refuses "matching on" for peon.
  pure val CONSOLE_ALLOWS: str -> bool = Map("slop" -> true, "peon" -> false)
  pure val REVEAL_TICKS = 3   // 15 minutes (server.ts:572 REVEAL_MAX_MINUTES)
  pure val TICKET_TICKS = 1   // 30 s (WS_TICKET_MS)
  pure val PREVIEW_TICKS = 5  // 5 minutes (server.ts:647 and network service.ts:2306)
  pure val CLOSED_STATES = Set("CANCELLED", "SKIPPED", "DECLINED", "EXPIRED")
  pure val TERMINAL = Set("COMPLETED", "FEEDBACK_COLLECTED", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED")

  // ------------------------------------------------------------------ helpers (staff.ts:181-200)
  pure def rolesFor(g: Set[Grant], st: str, app: str): Set[str] =
    g.filter(x => x._1 == st and (x._3 == app or x._3 == "*")).map(x => x._2)
  pure def allowedR(g: Set[Grant], st: str, need: Set[str], app: str): bool =
    rolesFor(g, st, app).contains("admin") or need.exists(r => rolesFor(g, st, app).contains(r))
  pure def everywhere(g: Set[Grant], st: str, role: str): bool =
    g.exists(x => x._1 == st and x._2 == role and x._3 == "*")
  // canSeeMember (server.ts:415-420): admin and safety see any member; a reviewer only members in an open review item.
  pure def canSee(g: Set[Grant], st: str, app: str, m: str, openReview: Set[str]): bool =
    allowedR(g, st, Set("safety"), app) or (rolesFor(g, st, app).contains("reviewer") and openReview.contains(m))
  pure def recordMinor(a: str): bool = a == "minor"
  // ageView (real.ts:79-82) with the Network's latest entry, or none.
  pure def ageViewMinor(recordAge: str, hasNet: bool, netMinor: bool): bool =
    if (hasNet) netMinor or recordMinor(recordAge) else (recordAge == "none" or recordMinor(recordAge))

  // ------------------------------------------------------------------ init
  action initWith(loginFit: bool, realOnly: bool, startMode: str, skew: int, peonRegistry: bool, recordAge: str): bool = all {
    s' = {
      now: 0,
      grantsDb: GRANTS0, grantsCopy: GRANTS0,
      openReview: Set(),
      reveals: Set(), clientReveals: Set(), auditedReveals: Set(),
      lastRead: { valid: false, st: "", revealed: false, safetyNow: false },
      tickets: Set(), nextTicket: 0, sockets: Set(),
      rel: { phase: "idle", kind: "none", consoleRowFirst: false, svc: "none", consoleResult: "none" },
      svcEffects: Set(), nextEffect: 0,
      src: { phase: "new", loginFit: loginFit, loginChecked: false, served: false, envError: false },
      age: { netMinor: false, viaEvent: false, recordAge: recordAge, consoleMinor: true, netAtPoll: false, photosShown: false },
      cs: { shownApp: "slop", dataApp: "slop", closeSent: false, intended: "", actual: "", note: false, noteLost: false },
      hs: { heldIn: Set(), toastEvery: false },
      md: {
        realOnly: realOnly,
        mode: if (realOnly) "real" else startMode,
        srcState: if (realOnly or startMode == "real") Map("game" -> "absent", "real" -> "ready") else Map("game" -> "ready", "real" -> "absent"),
        pending: "none", ranSaw: "none", ranIn: "none",
      },
      // Migration 0011 sets platform.networks.matching_enabled true for peon:nyc (observatory.md D35); a
      // deployment may differ, so the peon row is an input.
      mg: { registry: Map("slop" -> true, "peon" -> peonRegistry), stored: Map("slop" -> false, "peon" -> false), engineRan: Map("slop" -> false, "peon" -> false) },
      cf: { armed: false, armedApp: "slop", dataApp: "slop", sent: false, sentApp: "", sentArmedFor: "", sentDataOf: "" },
      cl: { epoch: 0, inflight: Set(), authNeeded: false, valid: Set(0) },
      pv: { skew: skew, tokenUntil: 0, state: "none", refusedAt: 0, loadedBy: "", releasedBy: "" },
      pj: { stage: "none", proj: "none", term: "none" },
      fg: { dbEdge: true, consoleEdge: false, edgeAtPoll: false, left: false, dbRemovedNoName: false, consoleDeclined: false },
      dv: { server: 0, feed: 0, version: 0, loading: false, buffered: Set() },
    },
  }

  action init = {
    nondet loginFit = Set(true, false).oneOf()
    nondet realOnly = Set(true, false).oneOf()
    nondet startMode = MODES.oneOf()
    nondet skew = Set(0, 1).oneOf()
    nondet peonRegistry = Set(true, false).oneOf()
    nondet recordAge = Set("adult", "minor", "none").oneOf()
    initWith(loginFit, realOnly, startMode, skew, peonRegistry, recordAge)
  }

  // ------------------------------------------------------------------ time and grants
  action tick = s' = { ...s, now: s.now + 1 }

  // An admin removes one grant from platform.staff_roles (another actor).
  action revokeGrant(g: Grant): bool = all {
    s.grantsDb.contains(g),
    s' = { ...s, grantsDb: s.grantsDb.exclude(Set(g)) },
  }

  // PgStaffRoles.load (staff.ts:216-227): a good read replaces the copy; a failed read keeps the last good list.
  // Sockets are not told: they read the copy again at the next recheck.
  action reloadRoles(ok: bool): bool = all {
    s' = { ...s,
      grantsCopy: if (ok) s.grantsDb else s.grantsCopy,
      sockets: if (ok) s.sockets.map(k => { ...k, fresh: false }) else s.sockets,
    },
  }

  // The Network queues or closes a review item with member m (another actor).
  action networkReview(m: str, open: bool): bool =
    s' = { ...s, openReview: if (open) s.openReview.union(Set(m)) else s.openReview.exclude(Set(m)) }

  // ------------------------------------------------------------------ pii-reveal
  // POST /api/reveal (server.ts:561-578): guard (role for the app, safety), audit row first, then the grant.
  action revealPost(st: str, app: str, auditUp: bool): bool = all {
    rolesFor(s.grantsCopy, st, app).size() > 0,
    allowedR(s.grantsCopy, st, Set("safety"), app),
    val m = MEMBER_OF.get(app)
    val g = { st: st, app: app, m: m, until: s.now + REVEAL_TICKS }
    s' = if (auditUp) { ...s,
      reveals: s.reveals.filter(r => not(r.st == st and r.app == app and r.m == m)).union(Set(g)),
      clientReveals: s.clientReveals.filter(r => not(r.st == st and r.app == app and r.m == m)).union(Set(g)),
      auditedReveals: s.auditedReveals.union(Set((st, m))),
    } else s,
  }

  // GET /api/member/:id (server.ts:479-497): canSeeMember, then revealFor (server.ts:406-410), which looks
  // only at the grant and its time, then the audit row, then the read with reveal = !!grant.
  action readMember(st: str, app: str, auditUp: bool): bool = all {
    rolesFor(s.grantsCopy, st, app).size() > 0,
    val m = MEMBER_OF.get(app)
    all {
      canSee(s.grantsCopy, st, app, m, s.openReview),
      auditUp,
      s' = { ...s, lastRead: {
        valid: true, st: st,
        revealed: s.reveals.exists(r => r.st == st and r.app == app and r.m == m and r.until > s.now),
        safetyNow: allowedR(s.grantsCopy, st, Set("safety"), app),
      } },
    },
  }

  // "End" (panels.tsx:542; web/store.ts:547-551): the client drops its grant whatever the answer. The server
  // DELETE (server.ts:581-588) needs a role for the app and safety, and a network error never reaches it.
  action unreveal(st: str, app: str, reached: bool): bool = {
    val m = MEMBER_OF.get(app)
    val serverDeletes = reached and rolesFor(s.grantsCopy, st, app).size() > 0 and allowedR(s.grantsCopy, st, Set("safety"), app)
    all {
      s.clientReveals.exists(r => r.st == st and r.app == app and r.m == m),
      s' = { ...s,
        clientReveals: s.clientReveals.filter(r => not(r.st == st and r.app == app and r.m == m)),
        reveals: if (serverDeletes) s.reveals.filter(r => not(r.st == st and r.app == app and r.m == m)) else s.reveals,
      },
    }
  }

  // ------------------------------------------------------------------ ws-ticket and ws-socket
  action issueTicket(st: str, app: str): bool = all {
    rolesFor(s.grantsCopy, st, app).size() > 0,
    s.nextTicket < 3,
    s' = { ...s, tickets: s.tickets.union(Set({ id: s.nextTicket, st: st, app: app, until: s.now + TICKET_TICKS })), nextTicket: s.nextTicket + 1 },
  }

  // GET /ws?ticket= (server.ts:297-306): the ticket is deleted first; then its time and app, then the role.
  action openSocket(id: int): bool = all {
    s.tickets.exists(t => t.id == id),
    val t = s.tickets.filter(t => t.id == id).fold({ id: -1, st: "", app: "", until: 0 }, (a, b) => b)
    val ok = t.until > s.now and rolesFor(s.grantsCopy, t.st, t.app).size() > 0
    s' = { ...s,
      tickets: s.tickets.filter(x => x.id != id),
      sockets: if (ok) s.sockets.union(Set({ st: t.st, app: t.app, fresh: true })) else s.sockets,
    },
  }

  // recheck (server.ts:338-347), every 15 s: no role for the app closes the socket.
  action recheck(st: str, app: str): bool = all {
    s.sockets.exists(k => k.st == st and k.app == app),
    val keep = rolesFor(s.grantsCopy, st, app).size() > 0
    s' = { ...s, sockets: s.sockets.filter(k => not(k.st == st and k.app == app)).union(if (keep) Set({ st: st, app: app, fresh: true }) else Set()) },
  }

  // ------------------------------------------------------------------ staff-audit and staff-action-relay
  // The console writes "requested" first (server.ts:612, 631, 680); no row, no action (503).
  action consoleSend(kind: str, auditUp: bool): bool = all {
    s.rel.phase != "sent",
    s' = if (auditUp) { ...s, rel: { phase: "sent", kind: kind, consoleRowFirst: true, svc: "pending", consoleResult: "none" } } else s,
  }

  // The service runs the request. review and hold go through staffAction/audited (service.ts:1519-1526,
  // 1765-1773): a "requested" row first, and a failed write throws before the action. The leak decision
  // (service.ts:2328-2343) and a relay text decision (service.ts:2461-2468) act first and audit after.
  // The service may still run after the console timed out (no idempotency key; observatory.md D14).
  action serviceApply(outcome: str, svcAuditUp: bool): bool = all {
    s.rel.phase != "idle",
    s.rel.svc == "pending",
    val auditFirst = s.rel.kind == "review" or s.rel.kind == "hold"
    val commits = outcome == "commit" and (svcAuditUp or not(auditFirst))
    s' = { ...s,
      rel: { ...s.rel, svc: if (commits) "committed" else if (outcome == "crash") "crashed" else "refused" },
      svcEffects: if (commits) s.svcEffects.union(Set({ id: s.nextEffect, kind: s.rel.kind, rowBefore: auditFirst })) else s.svcEffects,
      nextEffect: if (commits) s.nextEffect + 1 else s.nextEffect,
    },
  }

  // The answer reaches the console in time (sources/service.ts:99-103).
  action consoleAnswer: bool = all {
    s.rel.phase == "sent",
    s.rel.svc != "pending",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: if (s.rel.svc == "committed") "ok" else "fail" } },
  }

  // AbortSignal.timeout(15 s) (sources/service.ts:83, 95-97): service_unavailable, and the result row says ok:false.
  action consoleTimeout: bool = all {
    s.rel.phase == "sent",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: "fail" } },
  }

  // ------------------------------------------------------------------ real-source login check
  // RealSource.init (real.ts:196-221): a login that fails loginProblem is refused; a check that throws only
  // sets an env error, and init goes on to load and start the timers.
  action sourceInit(checkThrows: bool, loadOk: bool): bool = all {
    s.src.phase == "new",
    s' = { ...s, src:
      if (not(checkThrows) and not(s.src.loginFit)) { ...s.src, phase: "refused", loginChecked: true }
      else { ...s.src, phase: if (loadOk) "live" else "readError", loginChecked: not(checkThrows), served: loadOk, envError: checkThrows or not(loadOk) },
    },
  }

  // reload every 10 s (real.ts:229-236): a good load clears the env error (real.ts:232).
  action sourcePoll(loadOk: bool): bool = all {
    s.src.phase == "live" or s.src.phase == "readError",
    s' = { ...s, src: { ...s.src, phase: if (loadOk) "live" else "readError", served: s.src.served or loadOk, envError: not(loadOk) } },
  }

  // ------------------------------------------------------------------ console-age-view
  // The Network marks x as a minor (another actor): by an age event in AGE_EVENTS (real.ts:71), or by
  // minor_reported / minor_record, which write the stored flag only.
  action netMinorSignal(viaEvent: bool): bool =
    s' = { ...s, age: { ...s.age, netMinor: true, viaEvent: s.age.viaEvent or viaEvent } }

  // One poll (real.ts:264-272, 420-449): stateRow catches its error and returns [] (real.ts:269-270); the
  // events query catches its error and returns [] (real.ts:424). ageInfo replaces this.ages (real.ts:320).
  action agePoll(rowOk: bool, eventsOk: bool): bool = {
    val hasNet = rowOk or (eventsOk and s.age.viaEvent)
    val netMinor = if (rowOk) s.age.netMinor else true
    s' = { ...s, age: { ...s.age,
      consoleMinor: ageViewMinor(s.age.recordAge, hasNet, netMinor),
      netAtPoll: s.age.netMinor or recordMinor(s.age.recordAge),
    } }
  }

  // POST /api/member/:id/photos (server.ts:518-540): safety, reason, photosAllowed on the console's view; the
  // service checks its own age state again (network service.ts:1788-1810).
  action loadPhotos(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    not(s.age.consoleMinor),
    not(s.age.netMinor),
    s' = { ...s, age: { ...s.age, photosShown: true } },
  }

  // The staff member closes the disclosure (ui.tsx:97): the panel state goes.
  action closePhotos: bool = s' = { ...s, age: { ...s.age, photosShown: false } }

  // ------------------------------------------------------------------ console-fetch-scope and case rows
  // setApp (web/store.ts:507-520) does not remount SafetyCases; its useFetch key has no app (admin.tsx:60).
  action switchApp(app: str): bool = s' = { ...s, cs: { ...s.cs, shownApp: app } }

  // A poll of GET /api/safety (admin.tsx:14-20): an answer replaces the data; an error answer replaces it too,
  // and SafetyCases renders <Err>, which unmounts every row (admin.tsx:62-63).
  action pollSafety(ok: bool): bool =
    s' = { ...s, cs: { ...s.cs,
      dataApp: if (ok) s.cs.shownApp else "none",
      noteLost: s.cs.noteLost or (not(ok) and s.cs.note),
      note: if (ok) s.cs.note else false,
    } }

  action typeNote: bool = all { s.cs.dataApp != "none", s' = { ...s, cs: { ...s.cs, note: true } } }

  // "Close case" (admin.tsx:186-189, 221): the row shows case sc1 of the data's app; withApp sends the app shown
  // now (web/store.ts:282); the service closes sc1 of that app (network.ts:1254-1260).
  action pressClose(st: str): bool = all {
    s.cs.dataApp != "none",
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    s' = { ...s, cs: { ...s.cs, closeSent: true, intended: CASE_SC1.get(s.cs.dataApp), actual: CASE_SC1.get(s.cs.shownApp) } },
  }

  // "Hold" on a report (admin.tsx:260): the service holds every app only for safety@* or admin@*
  // (service.ts:1676-1688); the client always says "Person held on every app".
  action pressHold(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    val crossApp = everywhere(s.grantsCopy, st, "safety") or everywhere(s.grantsCopy, st, "admin")
    s' = { ...s, hs: { heldIn: if (crossApp) APPS else s.hs.heldIn.union(Set(s.cs.shownApp)), toastEvery: true } },
  }

  // ------------------------------------------------------------------ console-mode
  // POST /api/mode then setMode (server.ts:241-251, 455-463): mode is set before the source starts; a failed
  // start leaves its rejected promise in `starting` (server.ts:228-238), and the handler answers 400.
  action modeSwitch(m: str, initOk: bool): bool = all {
    not(s.md.realOnly and m == "game"),
    val st = s.md.srcState.get(m)
    s' = { ...s, md: { ...s.md,
      mode: m,
      srcState: if (st == "absent") s.md.srcState.set(m, if (initOk) "ready" else "poisoned") else s.md.srcState,
    } },
  }

  // guard (server.ts:369-371): the x-observatory-mode header is checked, then the handler awaits the body
  // and the audit row (server.ts:591, 611) before it reads `mode` again (server.ts:612).
  action controlCheck(saw: str): bool = all {
    s.md.pending == "none",
    saw == s.md.mode,
    s' = { ...s, md: { ...s.md, pending: saw } },
  }

  action controlRun: bool = all {
    s.md.pending != "none",
    s.md.srcState.get(s.md.mode) == "ready",
    s' = { ...s, md: { ...s.md, pending: "none", ranSaw: s.md.pending, ranIn: s.md.mode } },
  }

  // ------------------------------------------------------------------ network-matching-gate
  // The service checks only its registry row on "on" (service.ts:1809-1817).
  pure def serviceSwitch(mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool }, app: str, on: bool): { registry: str -> bool, stored: str -> bool, engineRan: str -> bool } =
    if (on and not(mg.registry.get(app))) mg else { ...mg, stored: mg.stored.set(app, on) }

  // A direct call to the service staff API with a service admin token (another actor; observatory.md D35).
  action directServiceSwitch(app: str, on: bool): bool = s' = { ...s, mg: serviceSwitch(s.mg, app, on) }

  // The service tick runs matching for a network whose matching is on.
  action serviceTick(app: str): bool = all {
    s.mg.stored.get(app),
    s' = { ...s, mg: { ...s.mg, engineRan: s.mg.engineRan.set(app, true) } },
  }

  // Config "Turn on/off" (admin.tsx:378-392): first click arms; second click sends `on: !c.matchingEnabled`
  // from the panel's data to the app shown now. The console refuses on for a locked app (real.ts:864).
  action pressSwitch(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set(), s.cs.shownApp),
    if (not(s.cf.armed)) s' = { ...s, cf: { ...s.cf, armed: true, armedApp: s.cs.shownApp } }
    else {
      val app = s.cs.shownApp
      val on = not(s.mg.stored.get(s.cf.dataApp))
      val consoleRefuses = on and not(CONSOLE_ALLOWS.get(app))
      s' = { ...s,
        mg: if (consoleRefuses) s.mg else serviceSwitch(s.mg, app, on),
        cf: { ...s.cf, armed: false, sent: true, sentApp: app, sentArmedFor: s.cf.armedApp, sentDataOf: s.cf.dataApp },
      }
    },
  }

  // The Config useFetch key (mode, matchingEnabled, review mode) changes, and the panel refetches for the app shown.
  action configPoll: bool = s' = { ...s, cf: { ...s.cf, dataApp: s.cs.shownApp } }
  // The 4 s timer disarms the switch.
  action disarm: bool = s' = { ...s, cf: { ...s.cf, armed: false } }

  // ------------------------------------------------------------------ auth-prompt
  // api() (web/store.ts:283-293) reads the token when it sends; any 401 sets authNeeded.
  action clientSend: bool = all { s.cl.inflight.size() < 2, s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.union(Set(s.cl.epoch)) } } }
  action clientAnswer(e: int): bool = all {
    s.cl.inflight.contains(e),
    s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.exclude(Set(e)), authNeeded: s.cl.authNeeded or not(s.cl.valid.contains(e)) } },
  }
  // setToken (web/store.ts:308-316): a new, good token; authNeeded is cleared.
  action setToken: bool = all {
    s.cl.epoch < 2,
    s' = { ...s, cl: { ...s.cl, epoch: s.cl.epoch + 1, valid: s.cl.valid.union(Set(s.cl.epoch + 1)), authNeeded: false } },
  }
  // The current token stops working (an SSO session ends, a token is rotated).
  action tokenExpires: bool = s' = { ...s, cl: { ...s.cl, valid: s.cl.valid.exclude(Set(s.cl.epoch)) } }

  // ------------------------------------------------------------------ held photo preview
  // GET /api/held/:id/photo (server.ts:640-655): the service makes until = serviceNow + 5 min
  // (service.ts:2306); the console refuses until <= now or until > now + 5 min (server.ts:647).
  action loadPreview(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    val until = s.now + s.pv.skew + PREVIEW_TICKS
    val refused = until <= s.now or until > s.now + PREVIEW_TICKS
    s' = { ...s, pv: { ...s.pv, tokenUntil: until, state: if (refused) "refusedExpired" else "ready", refusedAt: s.now, loadedBy: if (refused) "" else st } },
  }

  // POST /api/held release (server.ts:676-683): the preview key holds the staff id; it must be fresh.
  action releasePhoto(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    s.pv.state == "ready",
    s.pv.loadedBy == st,
    s.pv.tokenUntil > s.now,
    s' = { ...s, pv: { ...s.pv, state: "released", releasedBy: st } },
  }

  // ------------------------------------------------------------------ opp-projection (game mode)
  pure def setProj(pj: { stage: str, proj: str, term: str }, stage: str, proj: str): { stage: str, proj: str, term: str } =
    { stage: stage, proj: proj, term: if (pj.term == "none" and TERMINAL.contains(proj)) proj else pj.term }

  // The ConsentNetwork's stage machine and the records it writes, in its own order.
  action netPropose: bool = all { s.pj.stage == "none", s' = { ...s, pj: setProj(s.pj, "review", "IN_REVIEW") } }
  action netBook: bool = all { s.pj.stage == "review", s' = { ...s, pj: setProj(s.pj, "scheduled", "SCHEDULED") } }
  // A close in review is a reject (projector.ts:318, SKIPPED). A close of a booked plan logs opportunity_closed,
  // which the projector skips for SCHEDULED (projector.ts:251), and copy.dropNotice does not match the
  // /calling this one off/ test (projector.ts:105).
  action netClose: bool = all {
    s.pj.stage == "review" or s.pj.stage == "scheduled",
    s' = { ...s, pj: setProj(s.pj, "closed",
      if (s.pj.stage == "review") "SKIPPED"
      else if (TERMINAL.contains(s.pj.proj) or s.pj.proj == "SCHEDULED") s.pj.proj else "CANCELLED") },
  }
  action netDone: bool = all { s.pj.stage == "scheduled", s' = { ...s, pj: setProj(s.pj, "done", "COMPLETED") } }
  // The world still holds the meeting and writes an outcome (projector.ts:198); no API cancels it.
  action worldOutcome(held: bool): bool = all {
    s.pj.stage == "closed",
    s.pj.proj == "SCHEDULED",
    s' = { ...s, pj: setProj(s.pj, s.pj.stage, if (held) "COMPLETED" else "ABANDONED") },
  }

  // ------------------------------------------------------------------ store retention (forget)
  // Leave or delete everything (network runtime.ts:520-545): the edges go, name = null, account 'removed'.
  action forgetMember: bool = all {
    not(s.fg.left),
    s' = { ...s, fg: { ...s.fg, dbEdge: false, left: true, dbRemovedNoName: true } },
  }
  // load() only adds edges (real.ts:351-355); removed + null name reads as an under-13 decline (real.ts:334-336).
  action forgetPoll: bool =
    s' = { ...s, fg: { ...s.fg, consoleEdge: s.fg.consoleEdge or s.fg.dbEdge, edgeAtPoll: s.fg.dbEdge, consoleDeclined: s.fg.dbRemovedNoName } }

  // ------------------------------------------------------------------ client-sync
  action dvEmit: bool = all {
    s.dv.server < 3,
    s' = { ...s, dv: if (s.dv.loading) { ...s.dv, server: s.dv.server + 1, buffered: s.dv.buffered.union(Set(s.dv.server + 1)) }
                     else { ...s.dv, server: s.dv.server + 1, feed: s.dv.feed + 1, version: s.dv.server + 1 } },
  }
  action dvStartLoad: bool = all { not(s.dv.loading), s' = { ...s, dv: { ...s.dv, loading: true, buffered: Set() } } }
  // load() (web/store.ts:330-345): applyFull(state), then every buffered delta with d.version >= state.version.
  action dvSnapshot: bool = all {
    s.dv.loading,
    s' = { ...s, dv: { ...s.dv, loading: false, buffered: Set(), version: s.dv.server,
      feed: s.dv.server + s.dv.buffered.filter(d => d >= s.dv.server).size() } },
  }

  // ------------------------------------------------------------------ step
  action step = any {
    tick,
    nondet g = GRANTS0.oneOf()
    revokeGrant(g),
    nondet ok = Set(true, false).oneOf()
    reloadRoles(ok),
    nondet app = APPS.oneOf()
    nondet open = Set(true, false).oneOf()
    networkReview(MEMBER_OF.get(app), open),
    nondet st = STAFF.oneOf()
    nondet app = APPS.oneOf()
    nondet up = Set(true, false).oneOf()
    revealPost(st, app, up),
    nondet st = STAFF.oneOf()
    nondet app = APPS.oneOf()
    nondet up = Set(true, false).oneOf()
    readMember(st, app, up),
    nondet st = STAFF.oneOf()
    nondet app = APPS.oneOf()
    nondet reached = Set(true, false).oneOf()
    unreveal(st, app, reached),
    nondet st = STAFF.oneOf()
    nondet app = APPS.oneOf()
    issueTicket(st, app),
    nondet id = 0.to(2).oneOf()
    openSocket(id),
    nondet st = STAFF.oneOf()
    nondet app = APPS.oneOf()
    recheck(st, app),
    nondet kind = KINDS.oneOf()
    nondet up = Set(true, false).oneOf()
    consoleSend(kind, up),
    nondet outcome = Set("commit", "refuse", "crash").oneOf()
    nondet up = Set(true, false).oneOf()
    serviceApply(outcome, up),
    consoleAnswer,
    consoleTimeout,
    nondet a = Set(true, false).oneOf()
    nondet b = Set(true, false).oneOf()
    sourceInit(a, b),
    nondet ok = Set(true, false).oneOf()
    sourcePoll(ok),
    nondet v = Set(true, false).oneOf()
    netMinorSignal(v),
    nondet a = Set(true, false).oneOf()
    nondet b = Set(true, false).oneOf()
    agePoll(a, b),
    nondet st = STAFF.oneOf()
    loadPhotos(st),
    closePhotos,
    nondet app = APPS.oneOf()
    switchApp(app),
    nondet ok = Set(true, false).oneOf()
    pollSafety(ok),
    typeNote,
    nondet st = STAFF.oneOf()
    pressClose(st),
    nondet st = STAFF.oneOf()
    pressHold(st),
    nondet m = MODES.oneOf()
    nondet ok = Set(true, false).oneOf()
    modeSwitch(m, ok),
    nondet m = MODES.oneOf()
    controlCheck(m),
    controlRun,
    nondet app = APPS.oneOf()
    nondet on = Set(true, false).oneOf()
    directServiceSwitch(app, on),
    nondet app = APPS.oneOf()
    serviceTick(app),
    nondet st = STAFF.oneOf()
    pressSwitch(st),
    configPoll,
    disarm,
    clientSend,
    nondet e = 0.to(2).oneOf()
    clientAnswer(e),
    setToken,
    tokenExpires,
    nondet st = STAFF.oneOf()
    loadPreview(st),
    nondet st = STAFF.oneOf()
    releasePhoto(st),
    netPropose,
    netBook,
    netClose,
    netDone,
    nondet h = Set(true, false).oneOf()
    worldOutcome(h),
    forgetMember,
    forgetPoll,
    dvEmit,
    dvStartLoad,
    dvSnapshot,
  }

  // ------------------------------------------------------------------ invariants
  // revokedNoData. Admin-console 4.4 (docs/admin-console.md) ties a PII reveal to the safety role; observatory.md
  // R4. A read that returns revealed data goes to a person who holds safety (or admin) for that app now.
  // Code: server.ts:406-410 (revealFor has no role check), 479-497. Register: SD-084.
  val inv_revokedNoData = s.lastRead.valid and s.lastRead.revealed implies s.lastRead.safetyNow

  // revealAudited. Admin-console 4.4 and server.ts:575 "audited before it is granted": each grant has a row.
  val inv_revealAudited = s.reveals.forall(r => s.auditedReveals.contains((r.st, r.m)))

  // revealBound. Admin-console 4.4: a reveal lasts at most 15 minutes (server.ts:572).
  val inv_revealBound = s.reveals.forall(r => r.until <= s.now + REVEAL_TICKS)

  // revealShownTruly. gap-console-client.md RV3: the console says "revealed" exactly when the server still
  // reveals; an "End" that did not end the reveal must not hide it. Code: web/store.ts:547-551. Register: SD-247.
  val inv_revealShownTruly = s.reveals.forall(r => r.until <= s.now or s.clientReveals.exists(c => c.st == r.st and c.app == r.app and c.m == r.m))

  // socketAuthorized. observatory.md W1 and server.ts:334-337 comment: after a recheck, a socket stays open
  // only while its person holds a role for its app.
  val inv_socketAuthorized = s.sockets.forall(k => k.fresh implies rolesFor(s.grantsCopy, k.st, k.app).size() > 0)

  // auditFirst. AGENTS.md "every proactive proposal and every member request goes through human review" and the
  // service rule "an audit row first (no row, no action)" (network service.ts:1518, 1762). Every staff effect
  // in the service has a "requested" row before it. Register: SD-135.
  val inv_auditFirst = s.svcEffects.forall(e => e.rowBefore)

  // consoleAuditFirst. server.ts:611 "Staff actions are audited before they run": no console action without
  // its "requested" row (observatory.md A1).
  val inv_consoleAuditFirst = s.rel.phase != "idle" implies s.rel.consoleRowFirst

  // consoleSaysServiceDoes. observatory.md V3 and 2.8: the console's answer and its audit result row say what
  // the service did. "ok" only after a commit; "failed" only when the service did not act. Register: SD-288.
  val inv_consoleSaysServiceDoes =
    (s.rel.consoleResult == "ok" implies s.rel.svc == "committed") and
    (s.rel.consoleResult == "fail" implies s.rel.svc != "committed")

  // servedOnlyCheckedLogin. real.ts:199 comment "The login is checked, not assumed" and observatory.md E1: data
  // is served only through a login that passed loginProblem. Register: SD-083.
  val inv_servedOnlyCheckedLogin = s.src.served implies (s.src.loginChecked and s.src.loginFit)

  // ageFailClosed. AGENTS.md age policy and real.ts:444 "A missing flag fails closed": a read error never makes
  // the console treat as an adult a member the Network held as under 18 at that poll. Register: SD-082.
  val inv_ageFailClosed = s.age.netAtPoll implies s.age.consoleMinor

  // photosOnlyAdults. Founder decision 9 and AGENTS.md "Adults only": slop photos are never on screen for a
  // member the console treats as under 18. Code: panels.tsx:599-601. Register: SD-071.
  val inv_photosOnlyAdults = s.age.photosShown implies not(s.age.consoleMinor)

  // actionTargetsSelectedPerson. gap-console-client.md CR1 and FS1: a case action closes the case of the person
  // shown on the row. Code: admin.tsx:60, 68, 221; web/store.ts:282; network.ts:1211. Register: SD-068.
  val inv_actionTargetsSelectedPerson = s.cs.closeSent implies s.cs.intended == s.cs.actual

  // failedPollKeepsInput. gap-console-client.md FS2: a failed read does not destroy typed staff input.
  // Code: admin.tsx:16, 62-63. Register: SD-466.
  val inv_failedPollKeepsInput = not(s.cs.noteLost)

  // successTextMatchesScope. gap-console-client.md RR1: a success message states the scope the service applied.
  // Code: admin.tsx:260; service.ts:1679. Register: SD-070.
  val inv_successTextMatchesScope = s.hs.toastEvery implies s.hs.heldIn == APPS

  // modeHasRunningSource. observatory.md C2: `mode` and a running source agree.
  // Code: server.ts:228-238, 241-251, 461. Register: SD-285.
  val inv_modeHasRunningSource = s.md.srcState.get(s.md.mode) != "poisoned"

  // commandRunsInSeenMode. server.ts:368 comment and observatory.md C1: a change runs in the mode its sender saw.
  // Code: server.ts:369-371, 591, 611-612. Register: SD-286.
  val inv_commandRunsInSeenMode = s.md.ranSaw != "none" implies s.md.ranSaw == s.md.ranIn

  // everySwitchAudited is inv_consoleAuditFirst with kind config; the switch goes through staffAction
  // (service.ts:1816), so a committed config effect is covered by inv_auditFirst.

  // consoleShowsGate. AGENTS.md decision 4 (peon matching runs locally only) and observatory.md 2.13: the
  // overview's matching line says what the service does. Code: health.ts:334. Register: SD-122.
  val inv_consoleShowsGate = APPS.forall(a => (not(CONSOLE_ALLOWS.get(a)) implies not(s.mg.stored.get(a))))

  // tickRunImpliesAllowedAndStored. AGENTS.md decision 4: matching for peon (and friends) runs locally only; a
  // production tick runs matching only for an app whose pack the console allows and whose switch is on.
  // Code: apps.ts:21 (console only), service.ts:1809-1817 (registry row). Register: SD-088 (refuted for
  // deployment reasons outside this model; the model reaches it when the peon registry row is true).
  val inv_tickRunImpliesAllowedAndStored = APPS.forall(a => s.mg.engineRan.get(a) implies (CONSOLE_ALLOWS.get(a) and s.mg.registry.get(a)))

  // confirmMatchesApp. gap-console-client.md 2.9: the two-step confirm is given for one app and sends that
  // app's switch, computed from that app's data. Code: admin.tsx:381-392. Register: SD-246.
  val inv_confirmMatchesApp = s.cf.sent implies (s.cf.sentApp == s.cf.sentArmedFor and s.cf.sentApp == s.cf.sentDataOf)

  // promptOnlyForBadToken. gap-console-client.md 2.8: the sign-in prompt shows only when the current token
  // fails. Code: web/store.ts:289-292. Register: SD-470.
  val inv_promptOnlyForBadToken = s.cl.authNeeded implies not(s.cl.valid.contains(s.cl.epoch))

  // previewRefusalTrue. observatory.md 2.9 and H4: "This photo preview expired" only when it did. Code:
  // server.ts:647; network service.ts:2306-2307. Register: SD-287.
  val inv_previewRefusalTrue = s.pv.state == "refusedExpired" implies s.pv.tokenUntil <= s.pv.refusedAt

  // releaseBySameStaff. observatory.md H1: a photo is released only by the staff member who loaded it.
  val inv_releaseBySameStaff = s.pv.state == "released" implies s.pv.releasedBy == s.pv.loadedBy

  // projectionRefines. docs/observatory.md 6 and observatory.md O3/O4: a closed Network opportunity never reads
  // as open or done in the console. Code: projector.ts:105, 198, 251. Register: SD-279.
  val inv_projectionRefines = s.pj.stage == "closed" implies CLOSED_STATES.contains(s.pj.proj)

  // terminalAbsorbing. projector.ts:11-14 TERMINAL and observatory.md O1. Register: SD-499.
  val inv_terminalAbsorbing = s.pj.term != "none" implies s.pj.proj == s.pj.term

  // forgetClosure. PRD privacy (leave and delete everything) and observatory.md section 5 item 6: after a good
  // poll, nothing the database dropped stays in console memory. Code: real.ts:351-356. Register: SD-281.
  val inv_forgetClosure = s.fg.consoleEdge implies s.fg.edgeAtPoll

  // declinedMeansDeclined. real.ts:333 comment "A member declined at join (under 13)": the console marks as an
  // under-13 decline only a person who was declined at join. Code: real.ts:334-336. Register: SD-282.
  val inv_declinedMeansDeclined = s.fg.consoleDeclined implies not(s.fg.left)

  // feedExact. web/store.ts load comment: the snapshot and the deltas after it give each feed line once.
  // Code: web/store.ts:337. Register: SD-505.
  val inv_feedExact = not(s.dv.loading) implies s.dv.feed == s.dv.server

  val safety = and {
    inv_revokedNoData,
    inv_revealAudited,
    inv_revealBound,
    inv_revealShownTruly,
    inv_socketAuthorized,
    inv_auditFirst,
    inv_consoleAuditFirst,
    inv_consoleSaysServiceDoes,
    inv_servedOnlyCheckedLogin,
    inv_ageFailClosed,
    inv_photosOnlyAdults,
    inv_actionTargetsSelectedPerson,
    inv_failedPollKeepsInput,
    inv_successTextMatchesScope,
    inv_modeHasRunningSource,
    inv_commandRunsInSeenMode,
    inv_consoleShowsGate,
    inv_tickRunImpliesAllowedAndStored,
    inv_confirmMatchesApp,
    inv_promptOnlyForBadToken,
    inv_previewRefusalTrue,
    inv_releaseBySameStaff,
    inv_projectionRefines,
    inv_terminalAbsorbing,
    inv_forgetClosure,
    inv_declinedMeansDeclined,
    inv_feedExact,
  }

  // The invariants that hold in this model (the rest show register defects): a regression check.
  val holds = and {
    inv_revealAudited,
    inv_revealBound,
    inv_socketAuthorized,
    inv_consoleAuditFirst,
    inv_releaseBySameStaff,
    inv_terminalAbsorbing,
  }

  // ------------------------------------------------------------------ witnesses (each must be reachable)
  val witness_reviewThroughConsole = not(s.svcEffects.exists(e => e.kind == "review") and s.rel.consoleResult == "ok")
  val witness_revealWithAuditRow = not(s.reveals.size() > 0)
  val witness_revealedRead = not(s.lastRead.valid and s.lastRead.revealed)
  val witness_socketOpen = not(s.sockets.size() > 0)
  val witness_sourceServes = not(s.src.served)
  val witness_photosShown = not(s.age.photosShown)
  val witness_photoReleased = not(s.pv.state == "released")
  val witness_caseClosed = not(s.cs.closeSent)
  val witness_commandRan = not(s.md.ranSaw != "none")
  val witness_matchingRan = not(s.mg.engineRan.get("slop"))
  val witness_projectionDone = not(s.pj.stage == "done" and s.pj.proj == "COMPLETED")

  // ------------------------------------------------------------------ run tests (concrete traces)
  // Default start: login fit, real-only, no skew, peon registry row true (migration 0011), adult record age.
  action init0 = initWith(true, true, "real", 0, true, "adult")

  // SD-084 (observatory.md D03): S1 reveals x, loses safety@slop, keeps reviewer@slop; x is in an open review
  // item; after the reload S1 still reads x revealed.
  run revealSurvivesRoleChangeTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(networkReview("x", true))
      .then(readMember("S1", "slop", true))
      .expect(s.lastRead.revealed and not(s.lastRead.safetyNow) and not(inv_revokedNoData))

  // SD-247 (gap GC10): after the role loss, "End" gets 403; the client hides the reveal, the server keeps it.
  run endRevealFailsTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(unreveal("S1", "slop", true))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 0 and not(inv_revealShownTruly))

  // A reveal needs its audit row: with the audit sink down nothing is granted (server.ts:575-576).
  run revealNeedsAuditTest =
    init0
      .then(revealPost("S1", "slop", false))
      .expect(s.reveals.size() == 0)

  // The socket recheck closes S1's slop socket after both grants go (observatory.md 2.4; staff.test.ts:387).
  run socketClosedAfterRevokeTest =
    init0
      .then(issueTicket("S1", "slop"))
      .then(openSocket(0))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(revokeGrant(("S1", "reviewer", "slop")))
      .then(reloadRoles(true))
      .then(recheck("S1", "slop"))
      .expect(s.sockets.size() == 0 and inv_socketAuthorized)

  // SD-083 (observatory.md D02): the pg_roles check throws; init loads data with an unfit login.
  run loginCheckFailsOpenTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(true, true))
      .then(sourcePoll(true))
      .expect(s.src.served and not(s.src.envError) and not(inv_servedOnlyCheckedLogin))

  // An unfit login with a working check serves nothing (real.ts:205-206).
  run unfitLoginRefusedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(false, true))
      .expect(s.src.phase == "refused" and not(s.src.served))

  // SD-082 (observatory.md D01): minor_reported sets the stored flag only; the state view read fails.
  run ageReadErrorTest =
    init0
      .then(netMinorSignal(false))
      .then(agePoll(true, true))
      .then(agePoll(false, true))
      .expect(not(s.age.consoleMinor) and not(inv_ageFailClosed))

  // SD-071 (gap GC5): photos loaded for adult x stay on screen after x becomes a minor in the console.
  run photosStayAfterMinorTest =
    init0
      .then(agePoll(true, true))
      .then(loadPhotos("S1"))
      .then(netMinorSignal(true))
      .then(agePoll(true, true))
      .expect(s.age.photosShown and s.age.consoleMinor and not(inv_photosOnlyAdults))

  // SD-068 (gap GC1): S2 (admin@*) sees slop's sc1 (x), switches to peon, presses Close before the poll: peon's
  // sc1 (y) is closed.
  run crossAppCloseTest =
    init0
      .then(switchApp("peon"))
      .then(pressClose("S2"))
      .expect(s.cs.intended == "x" and s.cs.actual == "y" and not(inv_actionTargetsSelectedPerson))

  // SD-070 (gap GC3): S1 (safety@slop only) holds P; the service holds slop only; the toast says every app.
  run holdScopeTextTest =
    init0
      .then(pressHold("S1"))
      .expect(s.hs.heldIn == Set("slop") and s.hs.toastEvery and not(inv_successTextMatchesScope))

  // An admin@* hold covers every app (service.ts:1679).
  run holdEveryAppTest =
    init0
      .then(pressHold("S2"))
      .expect(s.hs.heldIn == APPS and inv_successTextMatchesScope)

  // SD-135: a relay text release commits before its audit row (service.ts:2461-2468).
  run relayTextAuditAfterTest =
    init0
      .then(consoleSend("relayText", true))
      .then(serviceApply("commit", false))
      .expect(not(inv_auditFirst))

  // A hold with the service audit sink down does not run (service.ts:1767-1769).
  run holdNeedsServiceRowTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", false))
      .expect(s.svcEffects.size() == 0 and s.rel.svc == "refused")

  // SD-288 (observatory.md D14): the service commits, the answer comes after 15 s; the console says it failed.
  run timeoutAfterCommitTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", true))
      .then(consoleTimeout)
      .expect(s.rel.consoleResult == "fail" and s.rel.svc == "committed" and not(inv_consoleSaysServiceDoes))

  // A review through the console (the witness path): requested row, commit, answer.
  run reviewThroughConsoleTest =
    init0
      .then(consoleSend("review", true))
      .then(serviceApply("commit", true))
      .then(consoleAnswer)
      .expect(s.rel.consoleResult == "ok" and inv_auditFirst and inv_consoleSaysServiceDoes)

  // SD-285 (observatory.md D11): a server started in real mode (not real-only) switches to game; the game start
  // fails; the mode stays game with a poisoned source.
  run modeSwitchPoisonTest =
    initWith(true, false, "real", 0, true, "adult")
      .then(modeSwitch("game", false))
      .expect(s.md.mode == "game" and not(inv_modeHasRunningSource))

  // SD-286 (observatory.md D12): a reviewer's command passes the header check in game mode; an admin switches to
  // real; the command runs in real.
  run modeHeaderRaceTest =
    initWith(true, false, "game", 0, true, "adult")
      .then(controlCheck("game"))
      .then(modeSwitch("real", true))
      .then(controlRun)
      .expect(s.md.ranSaw == "game" and s.md.ranIn == "real" and not(inv_commandRunsInSeenMode))

  // SD-122 (gap-status GS-7): a direct service call turns peon on; the console overview says "locked".
  run peonGateTest =
    init0
      .then(directServiceSwitch("peon", true))
      .then(serviceTick("peon"))
      .expect(s.mg.engineRan.get("peon") and not(inv_consoleShowsGate))

  // The console itself refuses peon on (real.ts:864).
  run consoleRefusesPeonTest =
    init0
      .then(switchApp("peon"))
      .then(configPoll)
      .then(pressSwitch("S2"))
      .then(pressSwitch("S2"))
      .expect(not(s.mg.stored.get("peon")))

  // SD-246 (gap GC9): armed on slop (matching off there), switch to peon, confirm: the click goes to peon with
  // slop's data.
  run armedSwitchCarriesTest =
    init0
      .then(pressSwitch("S2"))
      .then(switchApp("peon"))
      .then(pressSwitch("S2"))
      .expect(s.cf.sentApp == "peon" and s.cf.sentArmedFor == "slop" and not(inv_confirmMatchesApp))

  // SD-470 (gap GC13): a request with token 0 is in flight, token 0 stops working, a new token is set; the late
  // 401 opens the prompt over a good token.
  run late401Test =
    init0
      .then(clientSend)
      .then(tokenExpires)
      .then(setToken)
      .then(clientAnswer(0))
      .expect(s.cl.authNeeded and not(inv_promptOnlyForBadToken))

  // SD-287 (observatory.md D13): the service clock leads by one tick; a fresh preview is refused as expired.
  run previewSkewTest =
    initWith(true, true, "real", 1, true, "adult")
      .then(loadPreview("S1"))
      .expect(s.pv.state == "refusedExpired" and not(inv_previewRefusalTrue))

  // Without skew the preview loads and S1 releases it (held-photo-ui.test.tsx path).
  run previewReleaseTest =
    init0
      .then(loadPreview("S1"))
      .then(releasePhoto("S1"))
      .expect(s.pv.state == "released" and inv_releaseBySameStaff)

  // SD-279 (observatory.md D05): a booked plan is closed by the Network; the projection stays SCHEDULED, and the
  // world's outcome then sets COMPLETED.
  run closedStaysScheduledTest =
    init0
      .then(netPropose)
      .then(netBook)
      .then(netClose)
      .then(worldOutcome(true))
      .expect(s.pj.proj == "COMPLETED" and not(inv_projectionRefines))

  // SD-281 and SD-282 (observatory.md D07, D08): z leaves; the console keeps the edge and shows z as declined.
  run forgetTest =
    init0
      .then(forgetPoll)
      .then(forgetMember)
      .then(forgetPoll)
      .expect(s.fg.consoleEdge and not(inv_forgetClosure) and not(inv_declinedMeansDeclined))

  // SD-505 (observatory.md D27): a delta taken before the snapshot is applied again.
  run deltaTwiceTest =
    init0
      .then(dvStartLoad)
      .then(dvEmit)
      .then(dvSnapshot)
      .expect(s.dv.feed == 2 and s.dv.server == 1 and not(inv_feedExact))

  // SD-466 (gap GC7): a typed note, then one failed poll.
  run failedPollTest =
    init0
      .then(typeNote)
      .then(pollSafety(false))
      .expect(not(inv_failedPollKeepsInput))
}
