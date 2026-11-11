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
// code. The actions follow the code after the wave 2 fixes (branch wave2/staff_console), and `safety` holds.
// Two invariants stay out of `safety` because their defects are not fixed for a stated reason: SD-282 (skipped,
// needs a privacy and data-retention decision) and SD-088 (refuted in the register: production keeps peon
// local-only outside this model). See docs/research/quint-findings/staff_console.md. Line numbers in the
// comments of the actions that the fixes did not change refer to commit ad67275.
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
    // console-age-view (real.ts:71-97, 290-303, 451-480) for member x, and the slop photo panel (panels.tsx:576-608).
    age: { netMinor: bool, viaEvent: bool, recordAge: str, consoleMinor: bool, netAtPoll: bool, photosShown: bool, photosBy: str },
    // console-fetch-scope and case-row-actions (admin.tsx:11-21, 58-111, 182-230; web/store.ts:282).
    cs: { shownApp: str, dataApp: str, closeSent: bool, intended: str, actual: str, note: bool, noteLost: bool },
    // report-row-actions, hold (admin.tsx:260; service.ts:1676-1688).
    hs: { heldIn: Set[str], toastEvery: bool },
    // console-mode and source cache (server.ts:189-251, 361-372).
    md: { realOnly: bool, mode: str, srcState: str -> str, pending: str, ranSaw: str, ranIn: str },
    // network-matching-gate (apps.ts:21; real.ts:864; health.ts:334; service.ts:1809-1817).
    mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool },
    // matching-switch-confirm (admin.tsx:378-392).
    cf: { armed: bool, armedApp: str, target: bool, dataApp: str, sent: bool, sentApp: str, sentArmedFor: str, sentDataOf: str },
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
  pure val TERMINAL = Set("COMPLETED", "FEEDBACK_COLLECTED", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED")

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
      age: { netMinor: false, viaEvent: false, recordAge: recordAge, consoleMinor: true, netAtPoll: false, photosShown: false, photosBy: "" },
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
      cf: { armed: false, armedApp: "slop", target: false, dataApp: "slop", sent: false, sentApp: "", sentArmedFor: "", sentDataOf: "" },
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
  // Sockets are not told: they read the copy again at the next recheck. The slop photo panel shows loaded photos
  // only while its staff member holds safety (panels.tsx:586-587, SD-071 fix d8fa61c).
  action reloadRoles(ok: bool): bool = {
    val copy = if (ok) s.grantsDb else s.grantsCopy
    s' = { ...s,
      grantsCopy: copy,
      sockets: if (ok) s.sockets.map(k => { ...k, fresh: false }) else s.sockets,
      age: { ...s.age, photosShown: s.age.photosShown and allowedR(copy, s.age.photosBy, Set("safety"), "slop") },
    }
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

  // GET /api/member/:id (server.ts:494-512): canSeeMember, then revealFor (server.ts:421-425), which looks at
  // the grant, its time and the safety role for the app now, and drops a grant whose role is gone (SD-084 fix
  // cd612bc); then the audit row, then the read with reveal = !!grant.
  action readMember(st: str, app: str, auditUp: bool): bool = all {
    rolesFor(s.grantsCopy, st, app).size() > 0,
    val m = MEMBER_OF.get(app)
    val safetyNow = allowedR(s.grantsCopy, st, Set("safety"), app)
    all {
      canSee(s.grantsCopy, st, app, m, s.openReview),
      auditUp,
      s' = { ...s,
        reveals: if (safetyNow) s.reveals else s.reveals.filter(r => not(r.st == st and r.app == app and r.m == m)),
        lastRead: {
          valid: true, st: st,
          revealed: safetyNow and s.reveals.exists(r => r.st == st and r.app == app and r.m == m and r.until > s.now),
          safetyNow: safetyNow,
        },
      },
    },
  }

  // "End" (panels.tsx:542; web/store.ts:555-563): the server DELETE (server.ts DELETE /api/reveal) needs a role
  // for the app and safety, and a network error never reaches it. The server deletes the grant first, then
  // writes the reveal_revoke row; with the audit sink down it answers 503 after the delete. The client drops
  // its grant only on 200 or 404, that is when the server has no grant after the call (SD-247 fix e662d5f),
  // so on a 503 the badge stays while the server holds no grant (safe side).
  action unrevealWith(st: str, app: str, reached: bool, auditUp: bool): bool = {
    val m = MEMBER_OF.get(app)
    val serverDeletes = reached and rolesFor(s.grantsCopy, st, app).size() > 0 and allowedR(s.grantsCopy, st, Set("safety"), app)
    val clientDrops = serverDeletes and auditUp
    all {
      s.clientReveals.exists(r => r.st == st and r.app == app and r.m == m),
      s' = { ...s,
        clientReveals: if (clientDrops) s.clientReveals.filter(r => not(r.st == st and r.app == app and r.m == m)) else s.clientReveals,
        reveals: if (serverDeletes) s.reveals.filter(r => not(r.st == st and r.app == app and r.m == m)) else s.reveals,
      },
    }
  }
  action unreveal(st: str, app: str, reached: bool): bool = unrevealWith(st, app, reached, true)

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
  // 1765-1773); the leak decision (service.ts:2330-2332) and a relay text or photo decision (service.ts:2436-2437)
  // now also write their "requested" row first (SD-135 fix 88d4d88). A failed write throws before the action.
  // The service may still run after the console timed out (no idempotency key; observatory.md D14).
  action serviceApply(outcome: str, svcAuditUp: bool): bool = all {
    s.rel.phase != "idle",
    s.rel.svc == "pending",
    val commits = outcome == "commit" and svcAuditUp
    s' = { ...s,
      rel: { ...s.rel, svc: if (commits) "committed" else if (outcome == "crash") "crashed" else "refused" },
      svcEffects: if (commits) s.svcEffects.union(Set({ id: s.nextEffect, kind: s.rel.kind, rowBefore: true })) else s.svcEffects,
      nextEffect: if (commits) s.nextEffect + 1 else s.nextEffect,
    },
  }

  // The answer reaches the console in time (sources/service.ts:101-110).
  action consoleAnswer: bool = all {
    s.rel.phase == "sent",
    s.rel.svc != "pending",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: if (s.rel.svc == "committed") "ok" else "fail" } },
  }

  // AbortSignal.timeout(15 s) (sources/service.ts:83, 98-100): code service_timeout, "the action may have run",
  // and the console reads the state again (real.ts afterAction) (SD-288 fix 084f060).
  action consoleTimeout: bool = all {
    s.rel.phase == "sent",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: "unknown" } },
  }

  // ------------------------------------------------------------------ real-source login check
  // checkLogin (real.ts:221-248, SD-083 fix bedc81f): nothing is read through the connection until the check
  // answers. A check that throws leaves it unchecked with an env error; an unfit login is refused; a fit login
  // becomes the connection that load() reads.
  pure def checkThenLoad(src: { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool },
                         checkThrows: bool, loadOk: bool): { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool } =
    if (checkThrows) { ...src, phase: "unchecked", envError: true }
    else if (not(src.loginFit)) { ...src, phase: "refused", loginChecked: true }
    else { ...src, phase: if (loadOk) "live" else "readError", loginChecked: true, served: src.served or loadOk, envError: not(loadOk) }

  // RealSource.init (real.ts:199-215): the check, then a load only through a checked login, then the timers.
  action sourceInit(checkThrows: bool, loadOk: bool): bool = all {
    s.src.phase == "new",
    s' = { ...s, src: checkThenLoad(s.src, checkThrows, loadOk) },
  }

  // reload every 10 s (real.ts:254-260): an unchecked connection is checked again first; a good load clears the
  // env error.
  action sourcePoll(checkThrows: bool, loadOk: bool): bool = all {
    s.src.phase == "unchecked" or s.src.phase == "live" or s.src.phase == "readError",
    s' = { ...s, src:
      if (s.src.phase == "unchecked") checkThenLoad(s.src, checkThrows, loadOk)
      else { ...s.src, phase: if (loadOk) "live" else "readError", served: s.src.served or loadOk, envError: not(loadOk) },
    },
  }

  // ------------------------------------------------------------------ console-age-view
  // The Network marks x as a minor (another actor): by an age event in AGE_EVENTS (real.ts:71), or by
  // minor_reported / minor_record, which write the stored flag only.
  action netMinorSignal(viaEvent: bool): bool =
    s' = { ...s, age: { ...s.age, netMinor: true, viaEvent: s.age.viaEvent or viaEvent } }

  // One poll (real.ts:290-303, 451-480; SD-082 fix 546743b): stateRow(strict) throws a read error of the app's
  // view, and the events query has no catch, so a failed read fails the whole load and this.ages keeps the last
  // good copy (real.ts:342-348). netAtPoll is what the Network held at the last poll that read it.
  action agePoll(rowOk: bool, eventsOk: bool): bool = {
    val consoleMinor = ageViewMinor(s.age.recordAge, true, s.age.netMinor)
    if (rowOk and eventsOk) s' = { ...s, age: { ...s.age,
      consoleMinor: consoleMinor,
      netAtPoll: s.age.netMinor or recordMinor(s.age.recordAge),
      // The photo gate closes with the console's age view (panels.tsx:586-587, SD-071 fix d8fa61c).
      photosShown: s.age.photosShown and not(consoleMinor),
    } }
    else s' = s
  }

  // POST /api/member/:id/photos (server.ts:518-540): safety, reason, photosAllowed on the console's view; the
  // service checks its own age state again (network service.ts:1788-1810). photosAllowed now needs only a stated
  // adult age and no failed age check (appProfile.ts photosAllowed, SD-283 fix 93a99b8); the model has no age
  // check facet, so the stated adult age decides, as before.
  action loadPhotos(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    not(s.age.consoleMinor),
    not(s.age.netMinor),
    s' = { ...s, age: { ...s.age, photosShown: true, photosBy: st } },
  }

  // The staff member closes the disclosure (ui.tsx:97): the panel state goes.
  action closePhotos: bool = s' = { ...s, age: { ...s.age, photosShown: false } }

  // ------------------------------------------------------------------ console-fetch-scope and case rows
  // setApp (web/store.ts:507-520). SafetyCases and Config mount once per app (admin.tsx SafetyCases and Config
  // with key={s.app}; SD-068 fix d8b34a1, SD-246 fix e6daa04): an app switch drops the rows, a typed note, the
  // config data and an armed switch, and both panels read again for the new app.
  action switchApp(app: str): bool = s' = { ...s,
    cs: { ...s.cs, shownApp: app, dataApp: if (app == s.cs.shownApp) s.cs.dataApp else "none", note: if (app == s.cs.shownApp) s.cs.note else false },
    cf: if (app == s.cs.shownApp) s.cf else { ...s.cf, armed: false, dataApp: "none" },
  }

  // A poll of GET /api/safety (admin.tsx useFetch, SD-466 fix 2bf14c3): an answer replaces the data; a network
  // error or a 5xx for the same key keeps the last good data, so the rows and a typed note stay mounted. (A 401
  // or 403 is an answer, not a failed read: the role is gone and the rows go.)
  action pollSafety(ok: bool): bool =
    s' = { ...s, cs: { ...s.cs,
      dataApp: if (ok) s.cs.shownApp else s.cs.dataApp,
      noteLost: s.cs.noteLost or (not(ok) and s.cs.note and s.cs.dataApp == "none"),
      note: if (ok or s.cs.dataApp != "none") s.cs.note else false,
    } }

  action typeNote: bool = all { s.cs.dataApp != "none", s' = { ...s, cs: { ...s.cs, note: true } } }

  // "Close case" (admin.tsx:186-189, 221): the row shows case sc1 of the data's app; withApp sends the app shown
  // now (web/store.ts:282); the service closes sc1 of that app (network.ts:1254-1260).
  action pressClose(st: str): bool = all {
    s.cs.dataApp != "none",
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    s' = { ...s, cs: { ...s.cs, closeSent: true, intended: CASE_SC1.get(s.cs.dataApp), actual: CASE_SC1.get(s.cs.shownApp) } },
  }

  // "Hold" on a report (admin.tsx ReportRow): the service holds every app only for safety@* or admin@*
  // (service.ts:1676-1688); the client text says "every app" only for the same grants (store.canEverywhere,
  // SD-070 fix 85083c4), else "this app".
  action pressHold(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    val crossApp = everywhere(s.grantsCopy, st, "safety") or everywhere(s.grantsCopy, st, "admin")
    s' = { ...s, hs: { heldIn: if (crossApp) APPS else s.hs.heldIn.union(Set(s.cs.shownApp)), toastEvery: crossApp } },
  }

  // ------------------------------------------------------------------ console-mode
  // POST /api/mode then setMode (server.ts:249-262; SD-285 fix ab37c2a): the new mode's source starts first; a
  // failed start is not kept in `starting` (server.ts:226-247), and the server stays in its mode.
  action modeSwitch(m: str, initOk: bool): bool = all {
    not(s.md.realOnly and m == "game"),
    val st = s.md.srcState.get(m)
    if (st == "absent" and not(initOk)) s' = s
    else s' = { ...s, md: { ...s.md, mode: m, srcState: s.md.srcState.set(m, "ready") } },
  }

  // guard (server.ts:374-386; SD-286 fix 4d794bc): the x-observatory-mode header is checked and `seen` keeps
  // the mode of the checks; the handler awaits the body and the audit row, then runs on source(seen, app).
  action controlCheck(saw: str): bool = all {
    s.md.pending == "none",
    saw == s.md.mode,
    s' = { ...s, md: { ...s.md, pending: saw } },
  }

  action controlRun: bool = all {
    s.md.pending != "none",
    s.md.srcState.get(s.md.pending) == "ready",
    s' = { ...s, md: { ...s.md, pending: "none", ranSaw: s.md.pending, ranIn: s.md.pending } },
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

  // The overview's matching line (health.ts appHealth, SD-122 fix 83990e2): the stored switch first, then
  // "locked" for an app whose pack the console does not list, else "off" (real mode, no stored state is off).
  pure def overviewMatching(mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool }, app: str): str =
    if (mg.stored.get(app)) "on" else if (not(CONSOLE_ALLOWS.get(app))) "locked" else "off"

  // Config "Turn on/off" (admin.tsx AppConfig, press): logic/review.ts flip decides. The first click arms and
  // stores the target `!c.matchingEnabled` read from the panel's data. The second click sends that target to
  // the app shown now, or sends nothing when the data already shows it (another admin made the change; slice
  // report bug 11, quint/review_desk.qnt). The button shows only with data. The console refuses on for a
  // locked app (real.ts matching_locked).
  action pressSwitch(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set(), s.cs.shownApp),
    s.cf.dataApp != "none",
    val current = s.mg.stored.get(s.cf.dataApp)
    if (not(s.cf.armed)) s' = { ...s, cf: { ...s.cf, armed: true, armedApp: s.cs.shownApp, target: not(current) } }
    else if (s.cf.target == current) s' = { ...s, cf: { ...s.cf, armed: false } }
    else {
      val app = s.cs.shownApp
      val on = s.cf.target
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
  // api() (web/store.ts:283-296) keeps the token it sent; a 401 sets authNeeded only when that token is still
  // the one in use (SD-470 fix 0f9fc3d).
  action clientSend: bool = all { s.cl.inflight.size() < 2, s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.union(Set(s.cl.epoch)) } } }
  action clientAnswer(e: int): bool = all {
    s.cl.inflight.contains(e),
    s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.exclude(Set(e)), authNeeded: s.cl.authNeeded or (e == s.cl.epoch and not(s.cl.valid.contains(e))) } },
  }
  // setToken (web/store.ts:308-316): a new, good token; authNeeded is cleared.
  action setToken: bool = all {
    s.cl.epoch < 2,
    s' = { ...s, cl: { ...s.cl, epoch: s.cl.epoch + 1, valid: s.cl.valid.union(Set(s.cl.epoch + 1)), authNeeded: false } },
  }
  // The current token stops working (an SSO session ends, a token is rotated).
  action tokenExpires: bool = s' = { ...s, cl: { ...s.cl, valid: s.cl.valid.exclude(Set(s.cl.epoch)) } }

  // ------------------------------------------------------------------ held photo preview
  // GET /api/held/:id/photo (server.ts:655-670; SD-287 fix 3e7d55f): the service makes until = serviceNow + 5 min
  // (service.ts:2306); the console refuses only until <= now and keeps the preview at most 5 minutes on its own
  // clock (min(until, now + 5 min)).
  action loadPreview(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    val until = s.now + s.pv.skew + PREVIEW_TICKS
    val refused = until <= s.now
    val kept = if (until < s.now + PREVIEW_TICKS) until else s.now + PREVIEW_TICKS
    s' = { ...s, pv: { ...s.pv, tokenUntil: if (refused) until else kept, state: if (refused) "refusedExpired" else "ready", refusedAt: s.now, loadedBy: if (refused) "" else st } },
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
  // which the projector now applies to SCHEDULED too: CANCELLED (projector.ts:252; SD-279 fix a26ec66).
  action netClose: bool = all {
    s.pj.stage == "review" or s.pj.stage == "scheduled",
    s' = { ...s, pj: setProj(s.pj, "closed",
      if (s.pj.stage == "review") "SKIPPED"
      else if (TERMINAL.contains(s.pj.proj)) s.pj.proj else "CANCELLED") },
  }
  action netDone: bool = all { s.pj.stage == "scheduled", s' = { ...s, pj: setProj(s.pj, "done", "COMPLETED") } }
  // The world still holds the meeting and writes an outcome (projector.ts:199); no API cancels it. The
  // projector applies it only to an opportunity that is not terminal (SD-279 fix a26ec66), so after a close it
  // changes nothing.
  action worldOutcome(held: bool): bool = all {
    s.pj.stage == "closed",
    s' = if (TERMINAL.contains(s.pj.proj)) s else { ...s, pj: setProj(s.pj, s.pj.stage, if (held) "COMPLETED" else "ABANDONED") },
  }

  // ------------------------------------------------------------------ store retention (forget)
  // Leave or delete everything (network runtime.ts:520-545): the edges go, name = null, account 'removed'.
  action forgetMember: bool = all {
    not(s.fg.left),
    s' = { ...s, fg: { ...s.fg, dbEdge: false, left: true, dbRemovedNoName: true } },
  }
  // load() sets exactly the database's edges (real.ts:381-384, store.ts setEdges; SD-281 fix 7e51cf3); removed +
  // null name still reads as an under-13 decline (real.ts:334-336; SD-282 skipped).
  action forgetPoll: bool =
    s' = { ...s, fg: { ...s.fg, consoleEdge: s.fg.dbEdge, edgeAtPoll: s.fg.dbEdge, consoleDeclined: s.fg.dbRemovedNoName } }

  // ------------------------------------------------------------------ client-sync
  action dvEmit: bool = all {
    s.dv.server < 3,
    s' = { ...s, dv: if (s.dv.loading) { ...s.dv, server: s.dv.server + 1, buffered: s.dv.buffered.union(Set(s.dv.server + 1)) }
                     else { ...s.dv, server: s.dv.server + 1, feed: s.dv.feed + 1, version: s.dv.server + 1 } },
  }
  action dvStartLoad: bool = all { not(s.dv.loading), s' = { ...s, dv: { ...s.dv, loading: true, buffered: Set() } } }
  // load() (web/store.ts:330-346): applyFull(state), then every buffered delta with d.version > state.version
  // (SD-505 fix 5afecd3).
  action dvSnapshot: bool = all {
    s.dv.loading,
    s' = { ...s, dv: { ...s.dv, loading: false, buffered: Set(), version: s.dv.server,
      feed: s.dv.server + s.dv.buffered.filter(d => d > s.dv.server).size() } },
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
    nondet up = Set(true, false).oneOf()
    unrevealWith(st, app, reached, up),
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
    nondet a = Set(true, false).oneOf()
    nondet b = Set(true, false).oneOf()
    sourcePoll(a, b),
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
  // Code: server.ts:421-425 (revealFor checks the role since cd612bc), 494-512. Register: SD-084 (fixed).
  val inv_revokedNoData = s.lastRead.valid and s.lastRead.revealed implies s.lastRead.safetyNow

  // revealAudited. Admin-console 4.4 and server.ts:575 "audited before it is granted": each grant has a row.
  val inv_revealAudited = s.reveals.forall(r => s.auditedReveals.contains((r.st, r.m)))

  // revealBound. Admin-console 4.4: a reveal lasts at most 15 minutes (server.ts:572).
  val inv_revealBound = s.reveals.forall(r => r.until <= s.now + REVEAL_TICKS)

  // revealShownTruly. gap-console-client.md RV3: the console says "revealed" exactly when the server still
  // reveals; an "End" that did not end the reveal must not hide it. Code: web/store.ts:555-563. Register: SD-247
  // (fixed).
  val inv_revealShownTruly = s.reveals.forall(r => r.until <= s.now or s.clientReveals.exists(c => c.st == r.st and c.app == r.app and c.m == r.m))

  // socketAuthorized. observatory.md W1 and server.ts:334-337 comment: after a recheck, a socket stays open
  // only while its person holds a role for its app.
  val inv_socketAuthorized = s.sockets.forall(k => k.fresh implies rolesFor(s.grantsCopy, k.st, k.app).size() > 0)

  // auditFirst. AGENTS.md "every proactive proposal and every member request goes through human review" and the
  // service rule "an audit row first (no row, no action)" (network service.ts:1518, 1762). Every staff effect
  // in the service has a "requested" row before it. Register: SD-135 (fixed).
  val inv_auditFirst = s.svcEffects.forall(e => e.rowBefore)

  // consoleAuditFirst. server.ts:611 "Staff actions are audited before they run": no console action without
  // its "requested" row (observatory.md A1).
  val inv_consoleAuditFirst = s.rel.phase != "idle" implies s.rel.consoleRowFirst

  // consoleSaysServiceDoes. observatory.md V3 and 2.8: the console's answer and its audit result row say what
  // the service did. "ok" only after a commit; "failed" only when the service did not act; a timeout reads as
  // "unknown". Register: SD-288 (fixed).
  val inv_consoleSaysServiceDoes =
    (s.rel.consoleResult == "ok" implies s.rel.svc == "committed") and
    (s.rel.consoleResult == "fail" implies s.rel.svc != "committed")

  // servedOnlyCheckedLogin. real.ts:199 comment "The login is checked, not assumed" and observatory.md E1: data
  // is served only through a login that passed loginProblem. Register: SD-083 (fixed).
  val inv_servedOnlyCheckedLogin = s.src.served implies (s.src.loginChecked and s.src.loginFit)

  // ageFailClosed. AGENTS.md age policy and real.ts "A missing flag fails closed": a read error never makes the
  // console treat as an adult a member the Network held as under 18 at the last poll that read it (netAtPoll
  // changes only on a good read; the Network never clears the minor flag in this model). Register: SD-082
  // (fixed).
  val inv_ageFailClosed = s.age.netAtPoll implies s.age.consoleMinor

  // photosOnlyAdults. Founder decision 9 and AGENTS.md "Adults only": slop photos are never on screen for a
  // member the console treats as under 18. Code: panels.tsx:586-587, 606. Register: SD-071 (fixed).
  val inv_photosOnlyAdults = s.age.photosShown implies not(s.age.consoleMinor)

  // actionTargetsSelectedPerson. gap-console-client.md CR1 and FS1: a case action closes the case of the person
  // shown on the row. Code: admin.tsx SafetyCases (key={s.app}); web/store.ts:282; network.ts:1211. Register:
  // SD-068 (fixed).
  val inv_actionTargetsSelectedPerson = s.cs.closeSent implies s.cs.intended == s.cs.actual

  // failedPollKeepsInput. gap-console-client.md FS2: a failed read does not destroy typed staff input.
  // Code: admin.tsx useFetch. Register: SD-466 (fixed).
  val inv_failedPollKeepsInput = not(s.cs.noteLost)

  // successTextMatchesScope. gap-console-client.md RR1: a success message states the scope the service applied.
  // Code: admin.tsx ReportRow scope; service.ts:1679. Register: SD-070 (fixed).
  val inv_successTextMatchesScope = s.hs.toastEvery implies s.hs.heldIn == APPS

  // modeHasRunningSource. observatory.md C2: `mode` and a running source agree: the mode's source is started.
  // Code: server.ts:226-247, 249-262. Register: SD-285 (fixed).
  val inv_modeHasRunningSource = s.md.srcState.get(s.md.mode) == "ready"

  // commandRunsInSeenMode. server.ts:368 comment and observatory.md C1: a change runs in the mode its sender saw.
  // Code: server.ts guard `seen`, /api/control, /api/safety, /api/held. Register: SD-286 (fixed).
  val inv_commandRunsInSeenMode = s.md.ranSaw != "none" implies s.md.ranSaw == s.md.ranIn

  // everySwitchAudited is inv_consoleAuditFirst with kind config; the switch goes through staffAction
  // (service.ts:1816), so a committed config effect is covered by inv_auditFirst.

  // consoleShowsGate. AGENTS.md decision 4 (peon matching runs locally only) and observatory.md 2.13: the
  // overview's matching line says what the service does: "on" exactly when the stored switch is on, the switch
  // the service tick reads. Code: health.ts appHealth. Register: SD-122 (fixed).
  val inv_consoleShowsGate = APPS.forall(a => (overviewMatching(s.mg, a) == "on") == s.mg.stored.get(a))

  // tickRunImpliesRegistry. service.ts:1809-1817: the service turns matching on only where its registry row
  // allows it, and the tick runs only with the stored switch on.
  val inv_tickRunImpliesRegistry = APPS.forall(a => s.mg.engineRan.get(a) implies s.mg.registry.get(a))

  // NOT IN `safety`. tickRunImpliesAllowedAndStored. AGENTS.md decision 4: matching for peon (and friends) runs
  // locally only; a production tick runs matching only for an app whose pack the console allows. Code: apps.ts:21
  // (console only), service.ts:1809-1817 (registry row only). Register: SD-088, refuted in the register:
  // production keeps peon local-only by deployment, outside this model. The model breaks it only when the peon
  // registry row is true (an input); `peonGateTest` shows the trace.
  val inv_tickRunImpliesAllowedAndStored = APPS.forall(a => s.mg.engineRan.get(a) implies (CONSOLE_ALLOWS.get(a) and s.mg.registry.get(a)))

  // confirmMatchesApp. gap-console-client.md 2.9: the two-step confirm is given for one app and sends that
  // app's switch, computed from that app's data. Code: admin.tsx Config (key={s.app}). Register: SD-246 (fixed).
  val inv_confirmMatchesApp = s.cf.sent implies (s.cf.sentApp == s.cf.sentArmedFor and s.cf.sentApp == s.cf.sentDataOf)

  // promptOnlyForBadToken. gap-console-client.md 2.8: the sign-in prompt shows only when the current token
  // fails. Code: web/store.ts:283-296. Register: SD-470 (fixed).
  val inv_promptOnlyForBadToken = s.cl.authNeeded implies not(s.cl.valid.contains(s.cl.epoch))

  // previewRefusalTrue. observatory.md 2.9 and H4: "This photo preview expired" only when it did. Code:
  // server.ts:663-668; network service.ts:2306-2307. Register: SD-287 (fixed).
  val inv_previewRefusalTrue = s.pv.state == "refusedExpired" implies s.pv.tokenUntil <= s.pv.refusedAt

  // releaseBySameStaff. observatory.md H1: a photo is released only by the staff member who loaded it.
  val inv_releaseBySameStaff = s.pv.state == "released" implies s.pv.releasedBy == s.pv.loadedBy

  // projectionRefines. docs/observatory.md 6 and observatory.md O3/O4: a closed Network opportunity never reads
  // as open or done in the console. Code: projector.ts:199, 252. Register: SD-279 (fixed).
  val inv_projectionRefines = s.pj.stage == "closed" implies CLOSED_STATES.contains(s.pj.proj)

  // terminalAbsorbing. projector.ts:11-14 TERMINAL and observatory.md O1. Register: SD-499 (not reproduced).
  val inv_terminalAbsorbing = s.pj.term != "none" implies s.pj.proj == s.pj.term

  // forgetClosure. PRD privacy (leave and delete everything) and observatory.md section 5 item 6: after a good
  // poll, nothing the database dropped stays in console memory. Code: real.ts:381-384, store.ts setEdges.
  // Register: SD-281 (fixed).
  val inv_forgetClosure = s.fg.consoleEdge implies s.fg.edgeAtPoll

  // NOT IN `safety`. declinedMeansDeclined. real.ts:333 comment "A member declined at join (under 13)": the
  // console marks as an under-13 decline only a person who was declined at join. Code: real.ts:334-336;
  // network runtime.ts:520-545. Register: SD-282, skipped: the forget path stores a member who left and an
  // under-13 decline the same way (id only, name null, 'removed'), so a fix must keep a new fact after a
  // forget, and that needs a privacy and data-retention decision (docs/network.md 6.3). `forgetTest` shows it.
  val inv_declinedMeansDeclined = s.fg.consoleDeclined implies not(s.fg.left)

  // feedExact. web/store.ts load comment: the snapshot and the deltas after it give each feed line once.
  // Code: web/store.ts:338-339. Register: SD-505 (fixed).
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
    inv_tickRunImpliesRegistry,
    inv_confirmMatchesApp,
    inv_promptOnlyForBadToken,
    inv_previewRefusalTrue,
    inv_releaseBySameStaff,
    inv_projectionRefines,
    inv_terminalAbsorbing,
    inv_forgetClosure,
    inv_feedExact,
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
  // The fixed paths are reachable: a timeout reads as "unknown", and a one-app hold says "this app".
  val witness_outcomeUnknown = not(s.rel.consoleResult == "unknown")
  val witness_holdThisApp = not(s.hs.heldIn.size() > 0 and not(s.hs.toastEvery))

  // ------------------------------------------------------------------ run tests (concrete traces)
  // Each defect trace of the first model now ends in a state where its invariant holds (the fix). The traces
  // are the same; the expectations follow the fixed code.
  // Default start: login fit, real-only, no skew, peon registry row true (migration 0011), adult record age.
  action init0 = initWith(true, true, "real", 0, true, "adult")

  // SD-084 (fixed, cd612bc): S1 reveals x, loses safety@slop, keeps reviewer@slop; x is in an open review item.
  // The reviewer read shows no reveal, and the server drops the grant.
  run revealEndsOnRoleChangeTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(networkReview("x", true))
      .then(readMember("S1", "slop", true))
      .expect(s.lastRead.valid and not(s.lastRead.revealed) and s.reveals.size() == 0 and inv_revokedNoData)

  // SD-247 (fixed, e662d5f): after the role loss, "End" gets 403; the client keeps the reveal on screen.
  run endRevealRefusedKeepsItTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(unreveal("S1", "slop", true))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 1 and inv_revealShownTruly)

  // A network error on "End" also keeps the reveal on screen.
  run endRevealUnreachedTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unreveal("S1", "slop", false))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 1 and inv_revealShownTruly)

  // "End" that the server accepts drops the reveal on both sides.
  run endRevealTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unreveal("S1", "slop", true))
      .expect(s.reveals.size() == 0 and s.clientReveals.size() == 0)

  // "End" with the audit sink down: the server deleted the grant, then answered 503; the badge stays.
  run endRevealAuditDownTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unrevealWith("S1", "slop", true, false))
      .expect(s.reveals.size() == 0 and s.clientReveals.size() == 1 and inv_revealShownTruly)

  // A reveal needs its audit row: with the audit sink down nothing is granted (server.ts:589-591).
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

  // SD-083 (fixed, bedc81f): the pg_roles check throws; nothing is read. The next poll checks again and refuses
  // the unfit login.
  run loginCheckFailsClosedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(true, true))
      .expect(s.src.phase == "unchecked" and not(s.src.served) and s.src.envError)
      .then(sourcePoll(false, true))
      .expect(s.src.phase == "refused" and not(s.src.served) and inv_servedOnlyCheckedLogin)

  // A fit login whose first check throws serves data after the next check answers.
  run loginCheckRetryServesTest =
    init0
      .then(sourceInit(true, true))
      .then(sourcePoll(false, true))
      .expect(s.src.phase == "live" and s.src.served and s.src.loginChecked)

  // An unfit login with a working check serves nothing (real.ts:226-233).
  run unfitLoginRefusedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(false, true))
      .expect(s.src.phase == "refused" and not(s.src.served))

  // SD-082 (fixed, 546743b): minor_reported sets the stored flag only; the state view read then fails. The
  // console keeps the last good age view.
  run ageReadErrorTest =
    init0
      .then(netMinorSignal(false))
      .then(agePoll(true, true))
      .then(agePoll(false, true))
      .expect(s.age.consoleMinor and inv_ageFailClosed)

  // The second trigger: the events query fails while the state view reads.
  run ageEventsErrorTest =
    init0
      .then(netMinorSignal(true))
      .then(agePoll(true, true))
      .then(agePoll(true, false))
      .expect(s.age.consoleMinor and inv_ageFailClosed)

  // SD-071 (fixed, d8fa61c): photos loaded for adult x leave the screen when x becomes a minor in the console.
  run photosLeaveAfterMinorTest =
    init0
      .then(agePoll(true, true))
      .then(loadPhotos("S1"))
      .expect(s.age.photosShown)
      .then(netMinorSignal(true))
      .then(agePoll(true, true))
      .expect(not(s.age.photosShown) and s.age.consoleMinor and inv_photosOnlyAdults)

  // SD-071 (fixed): photos leave the screen when the safety role goes.
  run photosLeaveAfterRoleLossTest =
    init0
      .then(agePoll(true, true))
      .then(loadPhotos("S1"))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .expect(not(s.age.photosShown))

  // SD-068 (fixed, d8b34a1): S2 (admin@*) sees slop's sc1 (x) and switches to peon: the slop rows go, and Close
  // is not possible until peon's cases load; then it closes peon's sc1 (y), the case on the row.
  run crossAppCloseTest =
    init0
      .then(switchApp("peon"))
      .expect(s.cs.dataApp == "none")
      .then(pollSafety(true))
      .then(pressClose("S2"))
      .expect(s.cs.intended == "y" and s.cs.actual == "y" and inv_actionTargetsSelectedPerson)

  // SD-070 (fixed, 85083c4): S1 (safety@slop only) holds P; the service holds slop only; the text says this app.
  run holdScopeTextTest =
    init0
      .then(pressHold("S1"))
      .expect(s.hs.heldIn == Set("slop") and not(s.hs.toastEvery) and inv_successTextMatchesScope)

  // An admin@* hold covers every app (service.ts:1679), and the text says every app.
  run holdEveryAppTest =
    init0
      .then(pressHold("S2"))
      .expect(s.hs.heldIn == APPS and s.hs.toastEvery and inv_successTextMatchesScope)

  // SD-135 (fixed, 88d4d88): a relay text decision with the service audit sink down does not run.
  run relayTextNeedsServiceRowTest =
    init0
      .then(consoleSend("relayText", true))
      .then(serviceApply("commit", false))
      .expect(s.svcEffects.size() == 0 and s.rel.svc == "refused" and inv_auditFirst)

  // SD-135 (fixed): the same for a leak review decision.
  run leakNeedsServiceRowTest =
    init0
      .then(consoleSend("leak", true))
      .then(serviceApply("commit", false))
      .expect(s.svcEffects.size() == 0 and inv_auditFirst)

  // A hold with the service audit sink down does not run (service.ts:1767-1769).
  run holdNeedsServiceRowTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", false))
      .expect(s.svcEffects.size() == 0 and s.rel.svc == "refused")

  // SD-288 (fixed, 084f060): the service commits, the answer comes after 15 s; the console says the outcome is
  // unknown, not that the service did not act.
  run timeoutAfterCommitTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", true))
      .then(consoleTimeout)
      .expect(s.rel.consoleResult == "unknown" and s.rel.svc == "committed" and inv_consoleSaysServiceDoes)

  // A review through the console (the witness path): requested row, commit, answer.
  run reviewThroughConsoleTest =
    init0
      .then(consoleSend("review", true))
      .then(serviceApply("commit", true))
      .then(consoleAnswer)
      .expect(s.rel.consoleResult == "ok" and inv_auditFirst and inv_consoleSaysServiceDoes)

  // SD-285 (fixed, ab37c2a): a server started in real mode (not real-only) tries game; the game start fails; the
  // mode stays real. A later switch whose start works goes to game.
  run modeSwitchFailKeepsModeTest =
    initWith(true, false, "real", 0, true, "adult")
      .then(modeSwitch("game", false))
      .expect(s.md.mode == "real" and s.md.srcState.get("game") == "absent" and inv_modeHasRunningSource)
      .then(modeSwitch("game", true))
      .expect(s.md.mode == "game" and inv_modeHasRunningSource)

  // SD-286 (fixed, 4d794bc): a reviewer's command passes the checks in game mode; an admin switches to real; the
  // command runs in game.
  run modeHeaderRaceTest =
    initWith(true, false, "game", 0, true, "adult")
      .then(controlCheck("game"))
      .then(modeSwitch("real", true))
      .then(controlRun)
      .expect(s.md.ranSaw == "game" and s.md.ranIn == "game" and inv_commandRunsInSeenMode)

  // SD-122 (fixed, 83990e2): a direct service call turns peon on; the console overview says "on". SD-088 (not in
  // `safety`): the service then runs peon matching, because its registry row allows it.
  run peonGateTest =
    init0
      .then(directServiceSwitch("peon", true))
      .then(serviceTick("peon"))
      .expect(s.mg.engineRan.get("peon") and overviewMatching(s.mg, "peon") == "on" and inv_consoleShowsGate
              and inv_tickRunImpliesRegistry and not(inv_tickRunImpliesAllowedAndStored))

  // With the peon registry row false the service refuses peon on, and the overview says "locked".
  run peonRegistryOffTest =
    initWith(true, true, "real", 0, false, "adult")
      .then(directServiceSwitch("peon", true))
      .expect(not(s.mg.stored.get("peon")) and overviewMatching(s.mg, "peon") == "locked" and inv_tickRunImpliesAllowedAndStored)

  // The console itself refuses peon on (real.ts:898).
  run consoleRefusesPeonTest =
    init0
      .then(switchApp("peon"))
      .then(configPoll)
      .then(pressSwitch("S2"))
      .then(pressSwitch("S2"))
      .expect(not(s.mg.stored.get("peon")))

  // SD-246 (fixed, e6daa04): armed on slop, switch to peon: the switch is disarmed and the slop data goes. The
  // next click after peon's data loads only arms peon.
  run armedSwitchCarriesTest =
    init0
      .then(pressSwitch("S2"))
      .then(switchApp("peon"))
      .expect(not(s.cf.armed) and s.cf.dataApp == "none")
      .then(configPoll)
      .then(pressSwitch("S2"))
      .expect(s.cf.armed and s.cf.armedApp == "peon" and not(s.cf.sent) and inv_confirmMatchesApp)

  // Bug 11 (flip): S2 arms "turn on" for slop, another admin turns slop on, the panel reads it again; the
  // confirm click sends nothing.
  run switchAlreadyFlippedTest =
    init0
      .then(pressSwitch("S2"))
      .then(directServiceSwitch("slop", true))
      .then(pressSwitch("S2"))
      .expect(not(s.cf.armed) and not(s.cf.sent) and s.mg.stored.get("slop"))

  // SD-470 (fixed, 0f9fc3d): a request with token 0 is in flight, token 0 stops working, a new token is set; the
  // late 401 does not open the prompt.
  run late401Test =
    init0
      .then(clientSend)
      .then(tokenExpires)
      .then(setToken)
      .then(clientAnswer(0))
      .expect(not(s.cl.authNeeded) and inv_promptOnlyForBadToken)

  // A 401 for the token in use opens the prompt.
  run current401Test =
    init0
      .then(clientSend)
      .then(tokenExpires)
      .then(clientAnswer(0))
      .expect(s.cl.authNeeded and inv_promptOnlyForBadToken)

  // SD-287 (fixed, 3e7d55f): the service clock leads by one tick; the preview loads, is kept 5 minutes on the
  // console clock, and S1 releases it.
  run previewSkewTest =
    initWith(true, true, "real", 1, true, "adult")
      .then(loadPreview("S1"))
      .expect(s.pv.state == "ready" and s.pv.tokenUntil == s.now + PREVIEW_TICKS)
      .then(releasePhoto("S1"))
      .expect(s.pv.state == "released" and inv_releaseBySameStaff)

  // Without skew the preview loads and S1 releases it (held-photo-ui.test.tsx path).
  run previewReleaseTest =
    init0
      .then(loadPreview("S1"))
      .then(releasePhoto("S1"))
      .expect(s.pv.state == "released" and inv_releaseBySameStaff)

  // SD-279 (fixed, a26ec66): a booked plan is closed by the Network; the projection reads CANCELLED, and the
  // world's outcome does not change it.
  run closedBookedPlanCancelledTest =
    init0
      .then(netPropose)
      .then(netBook)
      .then(netClose)
      .expect(s.pj.proj == "CANCELLED")
      .then(worldOutcome(true))
      .expect(s.pj.proj == "CANCELLED" and inv_projectionRefines and inv_terminalAbsorbing)

  // SD-281 (fixed, 7e51cf3): z leaves; the next poll drops the edge. SD-282 (skipped, not in `safety`): z still
  // shows as an under-13 decline.
  run forgetTest =
    init0
      .then(forgetPoll)
      .then(forgetMember)
      .then(forgetPoll)
      .expect(not(s.fg.consoleEdge) and inv_forgetClosure and not(inv_declinedMeansDeclined))

  // SD-505 (fixed, 5afecd3): a delta at the snapshot version is not applied again.
  run deltaOnceTest =
    init0
      .then(dvStartLoad)
      .then(dvEmit)
      .then(dvSnapshot)
      .expect(s.dv.feed == 1 and s.dv.server == 1 and inv_feedExact)

  // SD-466 (fixed, 2bf14c3): a typed note, then one failed poll: the rows and the note stay.
  run failedPollTest =
    init0
      .then(typeNote)
      .then(pollSafety(false))
      .expect(s.cs.note and s.cs.dataApp == "slop" and inv_failedPollKeepsInput)
}
