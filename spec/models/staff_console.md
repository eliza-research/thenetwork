# Staff roles and console actions

## Story: Staff roles and console actions

A staff user needs to use their role in the right app and have sensitive access recorded.

### Safety rules and reachability

Check role revocation, audit, reveal scope, and socket authorization. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/staff_console.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

The production staff role projection and route admission use [Observatory staff permissions](../staffPermissions.md). Audit, revocation and socket timing remain in this standalone flow.

Convention (2026-11-21, second pass): the intended action is in `step`, so `safety` checks the intended design of every flow. Where the code differs, a `*Code` action (one `*By(code, ...)` body with the code branch) is outside `step`, and a run test shows the rule fail after it. This is the convention of [join_age](join_age.md) and [safety_trust](safety_trust.md).

Compared with `vibestack-matching` on 2026-11-18 for the reveal, the case rows and the matching switch. Three earlier fixes are gone from `packages/observatory/web` (open code defects; `unrevealWithCode` and `switchAppCode` are the code):

- `inv_revealShownTruly` (SD-247): `store.ts` `unreveal` removes the client reveal whatever the DELETE answer is, so after a 403, a 503 or a network error the server still serves the revealed data while the badge is gone.
- `inv_actionTargetsSelectedPerson` (SD-068): `SafetyCases` in `admin.tsx` has no `key={s.app}` and `useFetch` keeps the old answer until the new one comes. For that time the rows of the old app stay, and "Close case" sends the old row's case id (`sc1`) to the new app, which closes another member's case.
- `inv_confirmMatchesApp` (SD-246): `Config` in `admin.tsx` also has no `key={s.app}`. An armed switch survives an app switch until the config read answers, and the confirm sends `on: !c.matchingEnabled` of the old app to the new app.

The confirm press of the matching switch now always sends; a reload of the config (a new `c`) or the 4 s timer ends the ask.

Compared again 2026-11-21, action by action, with the code of `vibestack-matching` (audit COV08). Eleven fixes that the model took from the source branch (`wave2/staff_console`) were never on this branch; the 2026-11-18 and 2026-11-19 comparisons had read them as present. The intended action stays in `step` and its rule in `safety`; the `*Code` action follows the code, and a run test shows each failure:

- SD-288 (`consoleTimeoutCode`): `ServiceClient.act` answers a timeout as `service_unavailable` (ok false), and the result audit row says the action failed, also when the service committed (`timeoutAfterCommitTest`).
- SD-083 (`sourceInitCode`, `sourcePollCode`): `RealSource.init` reads through a connection whose login check threw, and `reload` never checks it again (`loginCheckFailsClosedTest`).
- SD-082 (`agePollCode`): `stateRow` catches a failed read of the state view, so a minor flag that only the stored state holds is lost for that poll and the console treats the member as the adult of the record age (`ageReadErrorTest`).
- SD-466 (`pollSafetyCode`): `useFetch` replaces the data with a failed answer, so the case and report rows unmount and a typed note goes (`failedPollTest`).
- SD-070 (`pressHoldCode`): `reportAction` always says "Person held on every app" (and "Minor signal cleared on every app"), also for staff with safety on one app, where the service acts on this app only (`holdScopeTextTest`).
- SD-285 (`modeSwitchCode`): `setMode` sets the mode before the start of the new source, and `starting` keeps a rejected start (`modeSwitchFailKeepsModeTest`).
- SD-286 (`controlRunCode`): `/api/control`, `/api/safety` and `/api/held` run on `source(mode, app)` after their awaits, not in the mode that `guard` admitted (`modeHeaderRaceTest`).
- SD-470 (`clientAnswerCode`): `Store.api` sets `authNeeded` on any 401, also the late 401 of a replaced token (`late401Test`).
- SD-287 (`loadPreviewCode`): the held photo route refuses a preview whose `until` is more than 5 minutes ahead of the console clock with "This photo preview expired" (`previewSkewTest`).
- SD-279 (`netCloseCode`, `worldOutcomeCode`): `Projector.apply` skips `opportunity_closed` for a SCHEDULED opportunity and applies an outcome to any state (`closedBookedPlanCancelledTest`).
- SD-281 (`forgetPollCode`): `RealSource.load` only adds edges to the long-lived store, so a forgotten member's edges stay in console memory (`forgetTest`).

SD-282 (`inv_declinedMeansDeclined`, `openConsoleDecisions`) is not in `safety`: it needs a privacy and data-retention decision, and no intended action is settled. The other fixes are on this branch: SD-084 (`revealFor`, `revealCurrent`), SD-071 (`SlopPanel`, `staffPhotoAllowed`), SD-135 (`auditedRun` for the leak and relay decisions), SD-505 (`deltaAction` of [observatory sync](../observatorySync.md)), PER63. All `file:line` comments were replaced by function and route names on 2026-11-21.

Not modelled yet: the console staff-step proxy (`packages/observatory/src/staffSteps.ts`, `staffStepRoutes`, mounted in `server.ts`; in the working tree on 2026-11-21, not on HEAD). Read by hand: it admits a step only in real mode with `staffStepAdmitted`, checks the mode header with `modeRefusal` before its awaits and always forwards to `source("real", app)`, so the command runs in the mode it was admitted in (`inv_commandRunsInSeenMode` holds); a write records its "requested" row before `RealSource.staffStep` forwards it (`inv_consoleAuditFirst` holds). A forward that throws (a timeout included) records ok false and answers `service_unavailable`, the SD-288 pattern (`inv_consoleSaysServiceDoes` fails for a step that the service committed). `packages/observatory/test/staff-steps.integration.test.ts` covers the proxy; a `staffStep` action goes into this model when the code lands.

Compared 2026-11-19 for the matching gate. Audit PER63 replaced the service's registry-only check and the console's own peon list (`PACK_READY`) with one launch-scope decision, [`matchingSwitchAllowed`](../runtimeUnit.md) (`matching-scope.ts` `networkMatchingAllowed`): the service refuses "on" and the tick does not run outside the scope, the real source sends every press to the service, and the overview says "locked" from the service's `/health` `matchingAllowed`. The model now has the deployment inputs `production` and `peonLive`, and SD-088 (`inv_tickRunImpliesLaunchScope`) is in `safety`. SD-247, SD-068, SD-246 and SD-282 were checked again in the code and are still open.

```quint
// quint-check: max-steps=14 max-samples=20000 verify-steps=6
//
// The staff console (packages/observatory) and its path to the Network service, as small machines in one
// state record. Plan: docs/research/2026-11-07-state-machines.md section 6.15. Machine notes:
// docs/research/state-machines/observatory.md (sections 2.1 to 2.13) and
// docs/research/state-machines/gap-console-client.md (sections 2.1 to 2.9).
//
// Bounds: 2 staff (S1, S2), 2 apps (slop, peon), one member per app (x in slop, y in peon; one person P owns
// both), one case id "sc1" in each app (each app's Network counts cases from 1, network.ts caseEvent).
//
// Staff grants at start (platform.staff_roles): S1 = safety@slop + reviewer@slop; S2 = admin@*.
//
// Oracles and other actors are nondeterministic: the audit sink (up or down), the database reads (ok or
// failed), the service (commits, refuses, crashes), the response (in time or after the 15 s timeout), the
// Network (age signals, review items, leave and forget), the world simulator (game outcome records), and the
// service clock (skew). Time is an integer tick.
//
// The invariants come from the rules (AGENTS.md, the PRD, docs/admin-console.md, code comments), not from the
// code. The actions in `step` are the intended design, and `safety` holds for them. Where the code of
// vibestack-matching differs (compared 2026-11-21), a `*Code` action outside `step` follows the code and a run
// test shows the rule fail: SD-247, SD-068, SD-246, SD-288, SD-083, SD-082, SD-466, SD-070, SD-285, SD-286,
// SD-470, SD-287, SD-279, SD-281. SD-282 (`openConsoleDecisions`) needs a privacy and data-retention decision;
// real.ts still reads every removed row with a null name as an under-13 decline. SD-088 is closed by the launch-scope decision (audit PER63,
// spec/runtimeUnit.md matchingSwitchAllowed): its rule is now inv_tickRunImpliesLaunchScope, in `safety`.
// Code locations name functions and routes of vibestack-matching.
module staff_console {

  // ------------------------------------------------------------------ types
  type Grant = (str, str, str) // (staff, role, app or "*")
  type Reveal = { st: str, app: str, m: str, until: int }
  type Socket = { st: str, app: str, fresh: bool }
  type Ticket = { id: int, st: str, app: str, until: int }
  type Effect = { id: int, kind: str, rowBefore: bool }

  type State = {
    now: int,
    // staff-grants (staff.ts PgStaffRoles): the table and the console's copy, reloaded every 60 s.
    grantsDb: Set[Grant],
    grantsCopy: Set[Grant],
    // members in an open review item (real.ts RealSource.inOpenReview), set by the Network.
    openReview: Set[str],
    // pii-reveal (server.ts reveals and "/api/reveal") and the client's list (web/store.ts loadReveals, reveal and unreveal).
    reveals: Set[Reveal],
    clientReveals: Set[Reveal],
    auditedReveals: Set[(str, str)],
    lastRead: { valid: bool, st: str, revealed: bool, safetyNow: bool },
    // ws-ticket and ws-socket (server.ts "/api/ws-ticket", fetch (/ws) and recheck).
    tickets: Set[Ticket],
    nextTicket: int,
    sockets: Set[Socket],
    // staff-audit and staff-action-relay: one console action in flight (server.ts "/api/control", "/api/safety" and "/api/held";
    // sources/service.ts ServiceClient.act) and the service effects it causes (network service.ts).
    rel: { phase: str, kind: str, consoleRowFirst: bool, svc: str, consoleResult: str },
    svcEffects: Set[Effect],
    nextEffect: int,
    // real-source (real.ts RealSource.init).
    src: { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool },
    // console-age-view (real.ts AGE_EVENTS, ageView and RealSource.ageInfo) for member x, and the slop photo panel (panels.tsx SlopPanel).
    age: { netMinor: bool, viaEvent: bool, recordAge: str, consoleMinor: bool, netAtPoll: bool, photosShown: bool, photosBy: str },
    // console-fetch-scope and case-row-actions (admin.tsx useFetch, SafetyCases and CaseItem; web/store.ts withApp).
    cs: { shownApp: str, dataApp: str, closeSent: bool, intended: str, actual: str, note: bool, noteLost: bool },
    // report-row-actions, hold (admin.tsx ReportItem; service.ts NetworkService.hold).
    hs: { heldIn: Set[str], toastEvery: bool },
    // console-mode and source cache (server.ts source, setMode and guard).
    md: { realOnly: bool, mode: str, srcState: str -> str, pending: str, ranSaw: str, ranIn: str },
    // network-matching-gate (spec/runtimeUnit.md matchingSwitchAllowed; matching-scope.ts networkMatchingAllowed;
    // service.ts setMatching; runtime.ts tick rollout; health.ts appHealth; real.ts serviceMatchingAllowed).
    mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool, production: bool, peonLive: bool },
    // matching-switch-confirm (admin.tsx Config).
    cf: { armed: bool, armedApp: str, target: bool, dataApp: str, sent: bool, sentApp: str, sentArmedFor: str, sentDataOf: str },
    // auth-prompt (web/store.ts api and setToken).
    cl: { epoch: int, inflight: Set[int], authNeeded: bool, valid: Set[int] },
    // held photo preview (server.ts "/api/held/:id/photo" and "/api/held"; network service.ts, the held photo route).
    pv: { skew: int, tokenUntil: int, state: str, refusedAt: int, loadedBy: str, releasedBy: str },
    // opp-projection, game mode (projector.ts TERMINAL and Projector.apply).
    pj: { stage: str, proj: str, term: str },
    // real-source store retention for member z (real.ts RealSource.load; network runtime.ts unit commit, the forget path).
    fg: { dbEdge: bool, consoleEdge: bool, edgeAtPoll: bool, left: bool, dbRemovedNoName: bool, consoleDeclined: bool },
    // client-sync: snapshot and buffered deltas (web/store.ts load and applyDelta).
    dv: { server: int, feed: int, version: int, loading: bool, buffered: Set[int] },
  }

  var s: State

  // ------------------------------------------------------------------ constants
  pure val STAFF = Set("S1", "S2")
  pure val APPS = Set("slop", "peon")
  pure val MODES = Set("game", "real")
  pure val KINDS = Set("review", "hold", "leak", "relayText")
  pure val MEMBER_OF: str -> str = Map("slop" -> "x", "peon" -> "y")
  // Case "sc1" exists in each app and names a different member (network.ts caseEvent: `sc${++this.caseSeq}`, no app prefix).
  pure val CASE_SC1: str -> str = Map("slop" -> "x", "peon" -> "y")
  pure val GRANTS0: Set[Grant] = Set(("S1", "safety", "slop"), ("S1", "reviewer", "slop"), ("S2", "admin", "*"))
  // spec/runtimeUnit.md appMatchingLocalOnly: friends and peon (this model has peon).
  pure val LOCAL_ONLY_APPS = Set("peon")
  pure val REVEAL_TICKS = 3   // 15 minutes (server.ts REVEAL_MAX_MINUTES)
  pure val TICKET_TICKS = 1   // 30 s (WS_TICKET_MS)
  pure val PREVIEW_TICKS = 5  // 5 minutes (server.ts "/api/held/:id/photo" and network service.ts, the held photo route)
  pure val CLOSED_STATES = Set("CANCELLED", "SKIPPED", "DECLINED", "EXPIRED")
  pure val TERMINAL = Set("COMPLETED", "FEEDBACK_COLLECTED", "DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED")

  // ------------------------------------------------------------------ helpers (staff.ts rolesFor and appsFor)
  pure def rolesFor(g: Set[Grant], st: str, app: str): Set[str] =
    g.filter(x => x._1 == st and (x._3 == app or x._3 == "*")).map(x => x._2)
  pure def allowedR(g: Set[Grant], st: str, need: Set[str], app: str): bool =
    rolesFor(g, st, app).contains("admin") or need.exists(r => rolesFor(g, st, app).contains(r))
  pure def everywhere(g: Set[Grant], st: str, role: str): bool =
    g.exists(x => x._1 == st and x._2 == role and x._3 == "*")
  // canSeeMember (server.ts canSeeMember): admin and safety see any member; a reviewer only members in an open review item.
  pure def canSee(g: Set[Grant], st: str, app: str, m: str, openReview: Set[str]): bool =
    allowedR(g, st, Set("safety"), app) or (rolesFor(g, st, app).contains("reviewer") and openReview.contains(m))
  pure def recordMinor(a: str): bool = a == "minor"
  // ageView (real.ts ageView) with the Network's latest entry, or none.
  pure def ageViewMinor(recordAge: str, hasNet: bool, netMinor: bool): bool =
    if (hasNet) netMinor or recordMinor(recordAge) else (recordAge == "none" or recordMinor(recordAge))

  // ------------------------------------------------------------------ init
  // The default start is a production deployment without the founder's peon live decision.
  action initWith(loginFit: bool, realOnly: bool, startMode: str, skew: int, peonRegistry: bool, recordAge: str): bool =
    initFull(loginFit, realOnly, startMode, skew, peonRegistry, recordAge, true, false)

  action initFull(loginFit: bool, realOnly: bool, startMode: str, skew: int, peonRegistry: bool, recordAge: str,
                  production: bool, peonLive: bool): bool = all {
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
      // deployment may differ, so the peon row is an input. production (isProduction(env)) and peonLive
      // (PEON_LIVE_APPROVED=1) are deployment inputs of the launch scope.
      mg: { registry: Map("slop" -> true, "peon" -> peonRegistry), stored: Map("slop" -> false, "peon" -> false), engineRan: Map("slop" -> false, "peon" -> false),
            production: production, peonLive: peonLive },
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
    nondet production = Set(true, false).oneOf()
    nondet peonLive = Set(true, false).oneOf()
    initFull(loginFit, realOnly, startMode, skew, peonRegistry, recordAge, production, peonLive)
  }

  // ------------------------------------------------------------------ time and grants
  action tick = s' = { ...s, now: s.now + 1 }

  // An admin removes one grant from platform.staff_roles (another actor).
  action revokeGrant(g: Grant): bool = all {
    s.grantsDb.contains(g),
    s' = { ...s, grantsDb: s.grantsDb.exclude(Set(g)) },
  }

  // PgStaffRoles.load (staff.ts PgStaffRoles.load): a good read replaces the copy; a failed read keeps the last good list.
  // Sockets are not told: they read the copy again at the next recheck. The slop photo panel shows loaded photos
  // only while its staff member holds safety (panels.tsx SlopPanel, SD-071 fix d8fa61c).
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
  // POST /api/reveal (server.ts "/api/reveal" POST): guard (role for the app, safety), audit row first, then the grant.
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

  // GET /api/member/:id (server.ts "/api/member/:id"): canSeeMember, then revealFor (server.ts revealFor), which looks at
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

  // "End" (panels.tsx MemberReveal; web/store.ts reveal and unreveal): the server DELETE (server.ts DELETE /api/reveal) needs a role
  // for the app and safety, and a network error never reaches it. The server deletes the grant first, then
  // writes the reveal_revoke row; with the audit sink down it answers 503 after the delete.
  // Intended (`unrevealWith`, in `step`): the client drops its grant only on 200 or 404, that is when the server
  // has no grant after the call, so on a 503 the badge stays while the server holds no grant (safe side).
  // Code (`unrevealWithCode`, not in `step`): store.ts unreveal ignores the DELETE answer and always drops the
  // client grant, also after a 403, a 503 or a network error (SD-247 open on this branch).
  action unrevealBy(code: bool, st: str, app: str, reached: bool, auditUp: bool): bool = {
    val m = MEMBER_OF.get(app)
    val allowed = rolesFor(s.grantsCopy, st, app).size() > 0 and allowedR(s.grantsCopy, st, Set("safety"), app)
    val serverDeletes = reached and allowed
    val hadGrant = s.reveals.exists(r => r.st == st and r.app == app and r.m == m)
    val clientDrops = code or (serverDeletes and (auditUp or not(hadGrant)))
    all {
      s.clientReveals.exists(r => r.st == st and r.app == app and r.m == m),
      s' = { ...s,
        clientReveals: if (clientDrops) s.clientReveals.filter(r => not(r.st == st and r.app == app and r.m == m)) else s.clientReveals,
        reveals: if (serverDeletes) s.reveals.filter(r => not(r.st == st and r.app == app and r.m == m)) else s.reveals,
      },
    }
  }
  action unrevealWith(st: str, app: str, reached: bool, auditUp: bool): bool = unrevealBy(false, st, app, reached, auditUp)
  action unrevealWithCode(st: str, app: str, reached: bool, auditUp: bool): bool = unrevealBy(true, st, app, reached, auditUp)
  action unreveal(st: str, app: str, reached: bool): bool = unrevealWith(st, app, reached, true)
  action unrevealCode(st: str, app: str, reached: bool): bool = unrevealWithCode(st, app, reached, true)

  // ------------------------------------------------------------------ ws-ticket and ws-socket
  action issueTicket(st: str, app: str): bool = all {
    rolesFor(s.grantsCopy, st, app).size() > 0,
    s.nextTicket < 3,
    s' = { ...s, tickets: s.tickets.union(Set({ id: s.nextTicket, st: st, app: app, until: s.now + TICKET_TICKS })), nextTicket: s.nextTicket + 1 },
  }

  // GET /ws?ticket= (server.ts fetch, /ws): the ticket is deleted first; then its time and app, then the role.
  action openSocket(id: int): bool = all {
    s.tickets.exists(t => t.id == id),
    val t = s.tickets.filter(t => t.id == id).fold({ id: -1, st: "", app: "", until: 0 }, (a, b) => b)
    val ok = t.until > s.now and rolesFor(s.grantsCopy, t.st, t.app).size() > 0
    s' = { ...s,
      tickets: s.tickets.filter(x => x.id != id),
      sockets: if (ok) s.sockets.union(Set({ st: t.st, app: t.app, fresh: true })) else s.sockets,
    },
  }

  // recheck (server.ts recheck), every 15 s: no role for the app closes the socket.
  action recheck(st: str, app: str): bool = all {
    s.sockets.exists(k => k.st == st and k.app == app),
    val keep = rolesFor(s.grantsCopy, st, app).size() > 0
    s' = { ...s, sockets: s.sockets.filter(k => not(k.st == st and k.app == app)).union(if (keep) Set({ st: st, app: app, fresh: true }) else Set()) },
  }

  // ------------------------------------------------------------------ staff-audit and staff-action-relay
  // The console writes "requested" first (server.ts "/api/control", "/api/safety" and "/api/held"); no row, no action (503).
  action consoleSend(kind: str, auditUp: bool): bool = all {
    s.rel.phase != "sent",
    s' = if (auditUp) { ...s, rel: { phase: "sent", kind: kind, consoleRowFirst: true, svc: "pending", consoleResult: "none" } } else s,
  }

  // The service runs the request. review and hold go through staffAction/audited (service.ts staffAction,
  // audited and auditedRun); the leak decision (service.ts /queue/leak-review) and a relay text or photo decision (service.ts, the relay photo decision)
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

  // The answer reaches the console in time (sources/service.ts ServiceClient.act).
  action consoleAnswer: bool = all {
    s.rel.phase == "sent",
    s.rel.svc != "pending",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: if (s.rel.svc == "committed") "ok" else "fail" } },
  }

  // AbortSignal.timeout(15 s) (sources/service.ts ServiceClient.call and act). Intended (`consoleTimeout`, in
  // `step`): a timeout reads as "unknown", the action may have run. Code (`consoleTimeoutCode`, not in `step`):
  // act catches the timeout with every other fetch error and answers code service_unavailable, "the Network
  // service did not answer", ok false; the console's result audit row (server.ts /api/control) says ok false,
  // and real.ts afterAction does not read the state again (SD-288 open on this branch).
  action consoleTimeoutBy(code: bool): bool = all {
    s.rel.phase == "sent",
    s' = { ...s, rel: { ...s.rel, phase: "answered", consoleResult: if (code) "fail" else "unknown" } },
  }
  action consoleTimeout: bool = consoleTimeoutBy(false)
  action consoleTimeoutCode: bool = consoleTimeoutBy(true)

  // ------------------------------------------------------------------ real-source login check
  // The login check in RealSource.init (real.ts init, loginProblem): an unfit login is refused and the connection
  // is closed; a fit login becomes the connection that load() reads. Phase "unchecked" names a connection whose
  // check threw. Intended (`sourceInit`, `sourcePoll`, in `step`): nothing is read through it until a check
  // answers, and reload checks it again first. Code (`sourceInitCode`, `sourcePollCode`, not in `step`): a check
  // that throws only sets an env error, init then calls load() through the unchecked connection, and reload
  // never checks it again (SD-083 open on this branch).
  pure def checkThenLoad(src: { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool },
                         checkThrows: bool, loadOk: bool, code: bool): { phase: str, loginFit: bool, loginChecked: bool, served: bool, envError: bool } =
    if (checkThrows and code) { ...src, phase: if (loadOk) "unchecked" else "readError", served: src.served or loadOk, envError: true }
    else if (checkThrows) { ...src, phase: "unchecked", envError: true }
    else if (not(src.loginFit)) { ...src, phase: "refused", loginChecked: true }
    else { ...src, phase: if (loadOk) "live" else "readError", loginChecked: true, served: src.served or loadOk, envError: not(loadOk) }

  // RealSource.init: the check, then the load, then the timers.
  action sourceInitBy(code: bool, checkThrows: bool, loadOk: bool): bool = all {
    s.src.phase == "new",
    s' = { ...s, src: checkThenLoad(s.src, checkThrows, loadOk, code) },
  }
  action sourceInit(checkThrows: bool, loadOk: bool): bool = sourceInitBy(false, checkThrows, loadOk)
  action sourceInitCode(checkThrows: bool, loadOk: bool): bool = sourceInitBy(true, checkThrows, loadOk)

  // reload every 10 s (real.ts reload). A good load clears the env error.
  action sourcePollBy(code: bool, checkThrows: bool, loadOk: bool): bool = all {
    s.src.phase == "unchecked" or s.src.phase == "live" or s.src.phase == "readError",
    s' = { ...s, src:
      if (code) { ...s.src,
        phase: if (not(loadOk)) "readError" else if (s.src.loginChecked) "live" else "unchecked",
        served: s.src.served or loadOk, envError: not(loadOk) }
      else if (s.src.phase == "unchecked") checkThenLoad(s.src, checkThrows, loadOk, false)
      else { ...s.src, phase: if (loadOk) "live" else "readError", served: s.src.served or loadOk, envError: not(loadOk) },
    },
  }
  action sourcePoll(checkThrows: bool, loadOk: bool): bool = sourcePollBy(false, checkThrows, loadOk)
  action sourcePollCode(checkThrows: bool, loadOk: bool): bool = sourcePollBy(true, checkThrows, loadOk)

  // ------------------------------------------------------------------ console-age-view
  // The Network marks x as a minor (another actor): by an age event in AGE_EVENTS (real.ts AGE_EVENTS), or by
  // minor_reported / minor_record, which write the stored flag only.
  action netMinorSignal(viaEvent: bool): bool =
    s' = { ...s, age: { ...s.age, netMinor: true, viaEvent: s.age.viaEvent or viaEvent } }

  // One poll (real.ts load and ageInfo). The events query has no catch, so a failed events read fails the whole
  // load and this.ages keeps the last good copy. netAtPoll is what the Network held at the last poll that read
  // the state row. Intended (`agePoll`, in `step`): a failed read of the app's state view also fails the load
  // (strict stateRow), so the last good copy stays. Code (`agePollCode`, not in `step`): stateRow catches the
  // failed read and returns no row; then only the age events give the Network's view, and a minor flag that only
  // the stored state holds (minor_reported, minor_record) is lost for that poll: ageView falls back to the record
  // age (SD-082 open on this branch).
  action agePollBy(code: bool, rowOk: bool, eventsOk: bool): bool = {
    val consoleMinor = if (rowOk) ageViewMinor(s.age.recordAge, true, s.age.netMinor)
                       else ageViewMinor(s.age.recordAge, s.age.viaEvent, s.age.viaEvent)
    if (eventsOk and (rowOk or code)) s' = { ...s, age: { ...s.age,
      consoleMinor: consoleMinor,
      netAtPoll: if (rowOk) s.age.netMinor or recordMinor(s.age.recordAge) else s.age.netAtPoll,
      // The photo gate closes with the console's age view (panels.tsx SlopPanel staffPhotoAllowed on each render).
      photosShown: s.age.photosShown and not(consoleMinor),
    } }
    else s' = s
  }
  action agePoll(rowOk: bool, eventsOk: bool): bool = agePollBy(false, rowOk, eventsOk)
  action agePollCode(rowOk: bool, eventsOk: bool): bool = agePollBy(true, rowOk, eventsOk)

  // POST /api/member/:id/photos (server.ts "/api/member/:id/photos"): safety, reason, photosAllowed on the console's view; the
  // service checks its own age state again (network service.ts NetworkService.staffPhotos). photosAllowed now needs only a stated
  // adult age and no failed age check (appProfile.ts photosAllowed, SD-283 fix 93a99b8); the model has no age
  // check facet, so the stated adult age decides, as before.
  action loadPhotos(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    not(s.age.consoleMinor),
    not(s.age.netMinor),
    s' = { ...s, age: { ...s.age, photosShown: true, photosBy: st } },
  }

  // The staff member closes the disclosure (panels.tsx Disclosure): the panel state goes.
  action closePhotos: bool = s' = { ...s, age: { ...s.age, photosShown: false } }

  // ------------------------------------------------------------------ console-fetch-scope and case rows
  // setApp (web/store.ts setApp). Intended (`switchApp`, in `step`): an app switch drops the case rows, a typed
  // note, the config data and an armed switch, and both panels read again for the new app (pollSafety and
  // configPoll). Code (`switchAppCode`, not in `step`): SafetyCases and Config in admin.tsx mount once and
  // useFetch keeps the last answer until the read for the new app answers, so the rows, a typed note, the config
  // data and an armed switch stay (SD-068 and SD-246 open on this branch).
  action switchAppBy(code: bool, app: str): bool =
    if (code) s' = { ...s, cs: { ...s.cs, shownApp: app } }
    else s' = { ...s,
      cs: { ...s.cs, shownApp: app, dataApp: "none", note: false },
      cf: { ...s.cf, armed: false, dataApp: "none" },
    }
  action switchApp(app: str): bool = switchAppBy(false, app)
  action switchAppCode(app: str): bool = switchAppBy(true, app)

  // A poll of GET /api/safety every 10 s (admin.tsx useFetch). Intended (`pollSafety`, in `step`): a network
  // error or a 5xx for the same key keeps the last good data, so the rows and a typed note stay mounted. Code
  // (`pollSafetyCode`, not in `step`): every answer replaces the fetched value, and a failed read is an answer
  // without data, so SafetyCases shows its status row, the CaseItem and ReportItem rows unmount and a typed note
  // goes (SD-466 open on this branch).
  action pollSafetyBy(code: bool, ok: bool): bool =
    if (code) s' = { ...s, cs: { ...s.cs,
      dataApp: if (ok) s.cs.shownApp else "none",
      noteLost: s.cs.noteLost or (not(ok) and s.cs.note),
      note: if (ok) s.cs.note else false,
    } }
    else s' = { ...s, cs: { ...s.cs,
      dataApp: if (ok) s.cs.shownApp else s.cs.dataApp,
      noteLost: s.cs.noteLost or (not(ok) and s.cs.note and s.cs.dataApp == "none"),
      note: if (ok or s.cs.dataApp != "none") s.cs.note else false,
    } }
  action pollSafety(ok: bool): bool = pollSafetyBy(false, ok)
  action pollSafetyCode(ok: bool): bool = pollSafetyBy(true, ok)

  action typeNote: bool = all { s.cs.dataApp != "none", s' = { ...s, cs: { ...s.cs, note: true } } }

  // "Close case" (admin.tsx CaseItem): the row shows case sc1 of the data's app; withApp sends the app shown
  // now (web/store.ts withApp); the service closes sc1 of that app (network.ts ConsentNetwork.closeCase).
  action pressClose(st: str): bool = all {
    s.cs.dataApp != "none",
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    s' = { ...s, cs: { ...s.cs, closeSent: true, intended: CASE_SC1.get(s.cs.dataApp), actual: CASE_SC1.get(s.cs.shownApp) } },
  }

  // "Hold" on a report (admin.tsx ReportItem, reportAction HoldPersonStep): the service holds every app only for
  // safety@* or admin@* (network service.ts NetworkService.hold, crossAppSafety). Intended (`pressHold`, in
  // `step`): the toast says "every app" only for those grants, else "this app". Code (`pressHoldCode`, not in
  // `step`): reportAction always says "Person held on every app", and the service answer does not carry the
  // scope (SD-070 open on this branch).
  action pressHoldBy(code: bool, st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), s.cs.shownApp),
    val crossApp = everywhere(s.grantsCopy, st, "safety") or everywhere(s.grantsCopy, st, "admin")
    s' = { ...s, hs: { heldIn: if (crossApp) APPS else s.hs.heldIn.union(Set(s.cs.shownApp)), toastEvery: code or crossApp } },
  }
  action pressHold(st: str): bool = pressHoldBy(false, st)
  action pressHoldCode(st: str): bool = pressHoldBy(true, st)

  // ------------------------------------------------------------------ console-mode
  // POST /api/mode then setMode (server.ts setMode and source). Intended (`modeSwitch`, in `step`): the new mode's
  // source starts first; a failed start is not kept and the server stays in its mode. Code (`modeSwitchCode`, not
  // in `step`): setMode sets `mode` first and then awaits source(m); a start that fails leaves the server in the
  // new mode with no running source, and `starting` keeps the rejected start, so every later source(m) call fails
  // again (SD-285 open on this branch). srcState "failed" is that kept rejected start.
  action modeSwitchBy(code: bool, m: str, initOk: bool): bool = all {
    not(s.md.realOnly and m == "game"),
    val st = s.md.srcState.get(m)
    val started = if (st == "absent") (if (initOk) "ready" else "failed") else st
    if (code) s' = { ...s, md: { ...s.md, mode: m, srcState: s.md.srcState.set(m, started) } }
    else if (st == "absent" and not(initOk)) s' = s
    else s' = { ...s, md: { ...s.md, mode: m, srcState: s.md.srcState.set(m, "ready") } },
  }
  action modeSwitch(m: str, initOk: bool): bool = modeSwitchBy(false, m, initOk)
  action modeSwitchCode(m: str, initOk: bool): bool = modeSwitchBy(true, m, initOk)

  // guard (server.ts guard and admitRoute, spec/staffSignIn.md stepStaffRoute): the x-observatory-mode header
  // must match the mode at admission. Intended (`controlRun`, in `step`): the handler keeps the mode it admitted
  // (`seen`) and runs on source(seen, app) after its awaits. Code (`controlRunCode`, not in `step`): the handlers
  // of /api/control, /api/safety and /api/held await the body and the audit row and run on source(mode, app)
  // with the mode of that later moment (SD-286 open on this branch).
  action controlCheck(saw: str): bool = all {
    s.md.pending == "none",
    saw == s.md.mode,
    s' = { ...s, md: { ...s.md, pending: saw } },
  }

  action controlRunBy(code: bool): bool = all {
    s.md.pending != "none",
    val runIn = if (code) s.md.mode else s.md.pending
    all {
      s.md.srcState.get(runIn) == "ready",
      s' = { ...s, md: { ...s.md, pending: "none", ranSaw: s.md.pending, ranIn: runIn } },
    },
  }
  action controlRun: bool = controlRunBy(false)
  action controlRunCode: bool = controlRunBy(true)

  // ------------------------------------------------------------------ network-matching-gate
  // spec/runtimeUnit.md, "Matching runs for an app only inside its launch scope": the registry row, and for a
  // local-only app in production the founder's live decision. The service builds each runtime's matchingAllowed
  // with it (matching-scope.ts networkMatchingAllowed) and reports it on /health.
  pure def matchingSwitchAllowed(registryAllows: bool, app: str, production: bool, liveApproved: bool): bool =
    registryAllows and (not(LOCAL_ONLY_APPS.contains(app)) or not(production) or liveApproved)
  pure def launchScope(mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool, production: bool, peonLive: bool }, app: str): bool =
    matchingSwitchAllowed(mg.registry.get(app), app, mg.production, app == "peon" and mg.peonLive)

  // setMatching (service.ts): "on" outside the launch scope is refused (and audited); "off" is always taken.
  pure def serviceSwitch(mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool, production: bool, peonLive: bool }, app: str, on: bool): { registry: str -> bool, stored: str -> bool, engineRan: str -> bool, production: bool, peonLive: bool } =
    if (on and not(launchScope(mg, app))) mg else { ...mg, stored: mg.stored.set(app, on) }

  // A direct call to the service staff API with a service admin token (another actor; observatory.md D35).
  action directServiceSwitch(app: str, on: bool): bool = s' = { ...s, mg: serviceSwitch(s.mg, app, on) }

  // The service tick runs matching for a network whose matching is on and inside its launch scope
  // (runtime.ts tick: rollout = matchingAllowed and state.matchingEnabled; a load outside the scope also stores off).
  action serviceTick(app: str): bool = all {
    s.mg.stored.get(app),
    launchScope(s.mg, app),
    s' = { ...s, mg: { ...s.mg, engineRan: s.mg.engineRan.set(app, true) } },
  }

  // The overview's matching line (health.ts appHealth): "locked" when the service reports the network outside its
  // launch scope (real.ts serviceMatchingAllowed, env.matchingLocked), else the stored switch. The console keeps
  // no list of its own in real mode (audit PER63).
  pure def overviewMatching(mg: { registry: str -> bool, stored: str -> bool, engineRan: str -> bool, production: bool, peonLive: bool }, app: str): str =
    if (not(launchScope(mg, app))) "locked" else if (mg.stored.get(app)) "on" else "off"

  // Config "Turn on/off" (admin.tsx Config): the generated consoleWorkspace pressMatchingSwitch and
  // confirmMatchingSwitch. The first click arms with the target `!c.matchingEnabled` read from the panel's data.
  // The second click sends that target to the app shown now (store.control uses the current app). A change made
  // by another admin ends the ask only through a reload of the config (configPoll). The button shows only with
  // data. The real source sends every press to the service, which alone decides the launch scope (setMatching).
  action pressSwitch(st: str): bool = all {
    allowedR(s.grantsCopy, st, Set(), s.cs.shownApp),
    s.cf.dataApp != "none",
    val current = s.mg.stored.get(s.cf.dataApp)
    if (not(s.cf.armed)) s' = { ...s, cf: { ...s.cf, armed: true, armedApp: s.cs.shownApp, target: not(current) } }
    else {
      val app = s.cs.shownApp
      val on = s.cf.target
      s' = { ...s,
        mg: serviceSwitch(s.mg, app, on),
        cf: { ...s.cf, armed: false, sent: true, sentApp: app, sentArmedFor: s.cf.armedApp, sentDataOf: s.cf.dataApp },
      }
    },
  }

  // The Config useFetch key (mode, matchingEnabled, review mode) changes, and the panel refetches for the app shown.
  // The answer is a new `c`, so the ask (edit.of === c) ends.
  action configPoll: bool = s' = { ...s, cf: { ...s.cf, dataApp: s.cs.shownApp, armed: false } }
  // The 4 s timer disarms the switch.
  action disarm: bool = s' = { ...s, cf: { ...s.cf, armed: false } }

  // ------------------------------------------------------------------ auth-prompt
  // api() (web/store.ts Store.api). A 401 comes only for a token that does not work (not(valid)). Intended
  // (`clientAnswer`, in `step`): api() keeps the token it sent, and a 401 sets authNeeded only when that token is
  // still the one in use. Code (`clientAnswerCode`, not in `step`): any 401 sets authNeeded, also the late 401 of
  // a request sent with a token that setToken has since replaced (SD-470 open on this branch).
  action clientSend: bool = all { s.cl.inflight.size() < 2, s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.union(Set(s.cl.epoch)) } } }
  action clientAnswerBy(code: bool, e: int): bool = all {
    s.cl.inflight.contains(e),
    s' = { ...s, cl: { ...s.cl, inflight: s.cl.inflight.exclude(Set(e)),
      authNeeded: s.cl.authNeeded or ((code or e == s.cl.epoch) and not(s.cl.valid.contains(e))) } },
  }
  action clientAnswer(e: int): bool = clientAnswerBy(false, e)
  action clientAnswerCode(e: int): bool = clientAnswerBy(true, e)
  // setToken (web/store.ts Store.setToken): a new, good token; authNeeded is cleared.
  action setToken: bool = all {
    s.cl.epoch < 2,
    s' = { ...s, cl: { ...s.cl, epoch: s.cl.epoch + 1, valid: s.cl.valid.union(Set(s.cl.epoch + 1)), authNeeded: false } },
  }
  // The current token stops working (an SSO session ends, a token is rotated).
  action tokenExpires: bool = s' = { ...s, cl: { ...s.cl, valid: s.cl.valid.exclude(Set(s.cl.epoch)) } }

  // ------------------------------------------------------------------ held photo preview
  // GET /api/held/:id/photo (server.ts "/api/held/:id/photo"): the service makes until = serviceNow + 5 min (network
  // service.ts, the held photo route). Intended (`loadPreview`, in `step`): the console refuses only until <= now
  // and keeps the preview at most 5 minutes on its own clock (min(until, now + 5 min)). Code (`loadPreviewCode`,
  // not in `step`): the console answers "This photo preview expired" when until <= now or until > now + 5 min, so
  // a service clock that leads refuses a fresh preview as expired, and a kept preview keeps the service's until
  // (SD-287 open on this branch).
  action loadPreviewBy(code: bool, st: str): bool = all {
    allowedR(s.grantsCopy, st, Set("safety"), "slop"),
    val until = s.now + s.pv.skew + PREVIEW_TICKS
    val refused = until <= s.now or (code and until > s.now + PREVIEW_TICKS)
    val kept = if (code or until < s.now + PREVIEW_TICKS) until else s.now + PREVIEW_TICKS
    s' = { ...s, pv: { ...s.pv, tokenUntil: if (refused) until else kept, state: if (refused) "refusedExpired" else "ready", refusedAt: s.now, loadedBy: if (refused) "" else st } },
  }
  action loadPreview(st: str): bool = loadPreviewBy(false, st)
  action loadPreviewCode(st: str): bool = loadPreviewBy(true, st)

  // POST /api/held release (server.ts "/api/held" POST): the preview key holds the staff id; it must be fresh.
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
  // A close in review is a reject (projector.ts review_decision, SKIPPED). A close of a booked plan logs
  // opportunity_closed. Intended (`netClose`, in `step`): the projector applies it to SCHEDULED too: CANCELLED.
  // Code (`netCloseCode`, not in `step`): Projector.apply skips opportunity_closed for a SCHEDULED opportunity
  // (`o.state !== "SCHEDULED"`), so the closed booked plan still reads SCHEDULED (SD-279 open on this branch).
  action netCloseBy(code: bool): bool = all {
    s.pj.stage == "review" or s.pj.stage == "scheduled",
    s' = { ...s, pj: setProj(s.pj, "closed",
      if (s.pj.stage == "review") "SKIPPED"
      else if (code or TERMINAL.contains(s.pj.proj)) s.pj.proj else "CANCELLED") },
  }
  action netClose: bool = netCloseBy(false)
  action netCloseCode: bool = netCloseBy(true)
  action netDone: bool = all { s.pj.stage == "scheduled", s' = { ...s, pj: setProj(s.pj, "done", "COMPLETED") } }
  // The world still holds the booked meeting and writes an outcome record; no API cancels it. Intended
  // (`worldOutcome`, in `step`): the projector applies an outcome only to an opportunity that is not terminal, so
  // after a close it changes nothing. Code (`worldOutcomeCode`, not in `step`): Projector.apply "outcome" sets
  // COMPLETED or ABANDONED without a terminal check, so a closed booked plan that still reads SCHEDULED reads as
  // held (SD-279 open on this branch). The world writes one outcome per booked meeting.
  action worldOutcomeBy(code: bool, held: bool): bool = all {
    s.pj.stage == "closed",
    if (code) all {
      s.pj.proj == "SCHEDULED",
      s' = { ...s, pj: setProj(s.pj, s.pj.stage, if (held) "COMPLETED" else "ABANDONED") },
    }
    else s' = if (TERMINAL.contains(s.pj.proj)) s else { ...s, pj: setProj(s.pj, s.pj.stage, if (held) "COMPLETED" else "ABANDONED") },
  }
  action worldOutcome(held: bool): bool = worldOutcomeBy(false, held)
  action worldOutcomeCode(held: bool): bool = worldOutcomeBy(true, held)

  // ------------------------------------------------------------------ store retention (forget)
  // Leave or delete everything (network runtime.ts unit commit, the forget path): the edges go, name = null, account 'removed'.
  action forgetMember: bool = all {
    not(s.fg.left),
    s' = { ...s, fg: { ...s.fg, dbEdge: false, left: true, dbRemovedNoName: true } },
  }
  // A poll (real.ts load). Intended (`forgetPoll`, in `step`): load() sets exactly the database's edges. Code
  // (`forgetPollCode`, not in `step`): load() adds each database edge to the long-lived store (Store.addEdge) and
  // never removes one, so an edge that the forget path deleted stays in console memory (SD-281 open on this
  // branch). In both, removed + null name reads as an under-13 decline (real.ts load, `declined`; SD-282, a
  // privacy and data-retention decision).
  action forgetPollBy(code: bool): bool =
    s' = { ...s, fg: { ...s.fg, consoleEdge: if (code) s.fg.consoleEdge or s.fg.dbEdge else s.fg.dbEdge,
      edgeAtPoll: s.fg.dbEdge, consoleDeclined: s.fg.dbRemovedNoName } }
  action forgetPoll: bool = forgetPollBy(false)
  action forgetPollCode: bool = forgetPollBy(true)

  // ------------------------------------------------------------------ client-sync
  action dvEmit: bool = all {
    s.dv.server < 3,
    s' = { ...s, dv: if (s.dv.loading) { ...s.dv, server: s.dv.server + 1, buffered: s.dv.buffered.union(Set(s.dv.server + 1)) }
                     else { ...s.dv, server: s.dv.server + 1, feed: s.dv.feed + 1, version: s.dv.server + 1 } },
  }
  action dvStartLoad: bool = all { not(s.dv.loading), s' = { ...s, dv: { ...s.dv, loading: true, buffered: Set() } } }
  // load() (web/store.ts load): applyFull(state), then every buffered delta with d.version > state.version
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
  // Code: server.ts revealFor (it checks the role, revealCurrent) and "/api/member/:id". Register: SD-084 (fixed).
  val inv_revokedNoData = s.lastRead.valid and s.lastRead.revealed implies s.lastRead.safetyNow

  // revealAudited. Admin-console 4.4 and server.ts "/api/reveal" "audited before it is granted": each grant has a row.
  val inv_revealAudited = s.reveals.forall(r => s.auditedReveals.contains((r.st, r.m)))

  // revealBound. Admin-console 4.4: a reveal lasts at most 15 minutes (server.ts REVEAL_MAX_MINUTES).
  val inv_revealBound = s.reveals.forall(r => r.until <= s.now + REVEAL_TICKS)

  // revealShownTruly. gap-console-client.md RV3: the console says "revealed" exactly when the server still
  // reveals; an "End" that did not end the reveal must not hide it. Code: web/store.ts reveal and unreveal.
  // Register: SD-247, open on this branch: `unrevealWithCode` fails it (endRevealRefusedKeepsItTest,
  // endRevealUnreachedTest).
  val inv_revealShownTruly = s.reveals.forall(r => r.until <= s.now or s.clientReveals.exists(c => c.st == r.st and c.app == r.app and c.m == r.m))

  // socketAuthorized. observatory.md W1 and server.ts recheck comment: after a recheck, a socket stays open
  // only while its person holds a role for its app.
  val inv_socketAuthorized = s.sockets.forall(k => k.fresh implies rolesFor(s.grantsCopy, k.st, k.app).size() > 0)

  // auditFirst. AGENTS.md "every proactive proposal and every member request goes through human review" and the
  // service rule "an audit row first (no row, no action)" (network service.ts staffAction and auditedRun). Every staff effect
  // in the service has a "requested" row before it. Register: SD-135 (fixed).
  val inv_auditFirst = s.svcEffects.forall(e => e.rowBefore)

  // consoleAuditFirst. server.ts "/api/control" "Staff actions are audited before they run": no console action without
  // its "requested" row (observatory.md A1).
  val inv_consoleAuditFirst = s.rel.phase != "idle" implies s.rel.consoleRowFirst

  // consoleSaysServiceDoes. observatory.md V3 and 2.8: the console's answer and its audit result row say what
  // the service did. "ok" only after a commit; "failed" only when the service did not act; a timeout reads as
  // "unknown". Register: SD-288 (open on this branch, the code variant of the action fails it in timeoutAfterCommitTest).
  val inv_consoleSaysServiceDoes =
    (s.rel.consoleResult == "ok" implies s.rel.svc == "committed") and
    (s.rel.consoleResult == "fail" implies s.rel.svc != "committed")

  // servedOnlyCheckedLogin. real.ts RealSource.init comment "The login is checked, not assumed" and observatory.md E1: data
  // is served only through a login that passed loginProblem. Register: SD-083 (open on this branch, the code variant of the action fails it in loginCheckFailsClosedTest).
  val inv_servedOnlyCheckedLogin = s.src.served implies (s.src.loginChecked and s.src.loginFit)

  // ageFailClosed. AGENTS.md age policy and real.ts "A missing flag fails closed": a read error never makes the
  // console treat as an adult a member the Network held as under 18 at the last poll that read it (netAtPoll
  // changes only on a good read; the Network never clears the minor flag in this model). Register: SD-082
  // (open on this branch, the code variant of the action fails it in ageReadErrorTest).
  val inv_ageFailClosed = s.age.netAtPoll implies s.age.consoleMinor

  // photosOnlyAdults. Founder decision 9 and AGENTS.md "Adults only": slop photos are never on screen for a
  // member the console treats as under 18. Code: panels.tsx SlopPanel (staffPhotoAllowed). Register: SD-071 (fixed).
  val inv_photosOnlyAdults = s.age.photosShown implies not(s.age.consoleMinor)

  // actionTargetsSelectedPerson. gap-console-client.md CR1 and FS1: a case action closes the case of the person
  // shown on the row. Code: admin.tsx SafetyCases and CaseItem; web/store.ts withApp; network.ts caseEvent
  // (`sc${++this.caseSeq}`). Register: SD-068, open on this branch: `switchAppCode` fails it (crossAppCloseTest).
  val inv_actionTargetsSelectedPerson = s.cs.closeSent implies s.cs.intended == s.cs.actual

  // failedPollKeepsInput. gap-console-client.md FS2: a failed read does not destroy typed staff input.
  // Code: admin.tsx useFetch. Register: SD-466 (open on this branch, the code variant of the action fails it in failedPollTest).
  val inv_failedPollKeepsInput = not(s.cs.noteLost)

  // successTextMatchesScope. gap-console-client.md RR1: a success message states the scope the service applied.
  // Code: admin.tsx reportAction; network service.ts NetworkService.hold. Register: SD-070 (open on this branch,
  // the code variant of the action fails it in holdScopeTextTest).
  val inv_successTextMatchesScope = s.hs.toastEvery implies s.hs.heldIn == APPS

  // modeHasRunningSource. observatory.md C2: `mode` and a running source agree: the mode's source is started.
  // Code: server.ts source and setMode. Register: SD-285 (open on this branch, the code variant of the action fails it in
  // modeSwitchFailKeepsModeTest).
  val inv_modeHasRunningSource = s.md.srcState.get(s.md.mode) == "ready"

  // commandRunsInSeenMode. server.ts modeChanged comment and observatory.md C1: a change runs in the mode its sender saw.
  // Code: server.ts guard, /api/control, /api/safety, /api/held. Register: SD-286 (open on this branch, the code variant of the action fails it in modeHeaderRaceTest).
  val inv_commandRunsInSeenMode = s.md.ranSaw != "none" implies s.md.ranSaw == s.md.ranIn

  // everySwitchAudited is inv_consoleAuditFirst with kind config; the switch goes through staffAction
  // (service.ts setMatching), so a committed config effect is covered by inv_auditFirst.

  // consoleShowsGate. AGENTS.md decision 4 (peon matching runs locally only) and observatory.md 2.13: the
  // overview's matching line says what the service does: "on" exactly when the stored switch is on inside the
  // launch scope, which is when the service tick runs matching. Code: health.ts appHealth with
  // env.matchingLocked from the service's /health matchingAllowed. Register: SD-122 (fixed), PER63.
  val inv_consoleShowsGate = APPS.forall(a => (overviewMatching(s.mg, a) == "on") == (s.mg.stored.get(a) and launchScope(s.mg, a)))

  // tickRunImpliesRegistry. service.ts setMatching and the runtime tick: matching runs only where the registry
  // row allows it.
  val inv_tickRunImpliesRegistry = APPS.forall(a => s.mg.engineRan.get(a) implies s.mg.registry.get(a))

  // tickRunImpliesLaunchScope (was tickRunImpliesAllowedAndStored, SD-088). AGENTS.md decision 4 and
  // spec/runtimeUnit.md, "Matching runs for an app only inside its launch scope": a production tick runs peon
  // matching only after the founder's live decision. Before PER63 the service read only the registry row and this
  // rule was out of `safety`; matching-scope.ts networkMatchingAllowed now closes it, and it is in `safety`.
  val inv_tickRunImpliesLaunchScope = APPS.forall(a => s.mg.engineRan.get(a) implies
    (s.mg.registry.get(a) and (not(LOCAL_ONLY_APPS.contains(a)) or not(s.mg.production) or s.mg.peonLive)))

  // confirmMatchesApp. gap-console-client.md 2.9: the two-step confirm is given for one app and sends that
  // app's switch, computed from that app's data. Code: admin.tsx Config. Register: SD-246, open on this branch:
  // `switchAppCode` fails it (armedSwitchCarriesTest).
  val inv_confirmMatchesApp = s.cf.sent implies (s.cf.sentApp == s.cf.sentArmedFor and s.cf.sentApp == s.cf.sentDataOf)

  // promptOnlyForBadToken. gap-console-client.md 2.8: the sign-in prompt shows only when the current token
  // fails. Code: web/store.ts Store.api. Register: SD-470 (open on this branch, the code variant of the action fails it in
  // late401Test).
  val inv_promptOnlyForBadToken = s.cl.authNeeded implies not(s.cl.valid.contains(s.cl.epoch))

  // previewRefusalTrue. observatory.md 2.9 and H4: "This photo preview expired" only when it did. Code:
  // server.ts "/api/held/:id/photo"; network service.ts held photo route. Register: SD-287 (open on this branch,
  // the code variant of the action fails it in previewSkewTest).
  val inv_previewRefusalTrue = s.pv.state == "refusedExpired" implies s.pv.tokenUntil <= s.pv.refusedAt

  // releaseBySameStaff. observatory.md H1: a photo is released only by the staff member who loaded it.
  val inv_releaseBySameStaff = s.pv.state == "released" implies s.pv.releasedBy == s.pv.loadedBy

  // projectionRefines. docs/observatory.md 6 and observatory.md O3/O4: a closed Network opportunity never reads
  // as open or done in the console. Code: projector.ts Projector.apply "outcome" and opportunity_closed. Register:
  // SD-279 (open on this branch, the code variant of the action fails it in closedBookedPlanCancelledTest).
  val inv_projectionRefines = s.pj.stage == "closed" implies CLOSED_STATES.contains(s.pj.proj)

  // terminalAbsorbing. projector.ts TERMINAL and observatory.md O1. Register: SD-499 (not reproduced).
  val inv_terminalAbsorbing = s.pj.term != "none" implies s.pj.proj == s.pj.term

  // forgetClosure. PRD privacy (leave and delete everything) and observatory.md section 5 item 6: after a good
  // poll, nothing the database dropped stays in console memory. Code: real.ts load (edges), store.ts addEdge.
  // Register: SD-281 (open on this branch, the code variant of the action fails it in forgetTest).
  val inv_forgetClosure = s.fg.consoleEdge implies s.fg.edgeAtPoll

  // NOT IN `safety`. declinedMeansDeclined. real.ts RealSource.load comment "A member declined at join (under 13)": the
  // console marks as an under-13 decline only a person who was declined at join. Code: real.ts RealSource.load (`declined`);
  // network runtime.ts unit commit, the forget path. Register: SD-282, skipped: the forget path stores a member who left and an
  // under-13 decline the same way (id only, name null, 'removed'), so a fix must keep a new fact after a
  // forget, and that needs a privacy and data-retention decision (docs/network.md 6.3). `forgetTest` shows it.
  val inv_declinedMeansDeclined = s.fg.consoleDeclined implies not(s.fg.left)

  // feedExact. web/store.ts load comment: the snapshot and the deltas after it give each feed line once.
  // Code: web/store.ts load. Register: SD-505 (fixed).
  val inv_feedExact = not(s.dv.loading) implies s.dv.feed == s.dv.server

  val safety = and {
    inv_revokedNoData,
    inv_revealAudited,
    inv_revealBound,
    inv_socketAuthorized,
    inv_auditFirst,
    inv_consoleAuditFirst,
    inv_photosOnlyAdults,
    inv_consoleShowsGate,
    inv_tickRunImpliesRegistry,
    inv_tickRunImpliesLaunchScope,
    inv_releaseBySameStaff,
    inv_terminalAbsorbing,
    inv_feedExact,
    inv_revealShownTruly,
    inv_actionTargetsSelectedPerson,
    inv_confirmMatchesApp,
    inv_consoleSaysServiceDoes,
    inv_servedOnlyCheckedLogin,
    inv_ageFailClosed,
    inv_failedPollKeepsInput,
    inv_successTextMatchesScope,
    inv_modeHasRunningSource,
    inv_commandRunsInSeenMode,
    inv_promptOnlyForBadToken,
    inv_previewRefusalTrue,
    inv_projectionRefines,
    inv_forgetClosure,
  }

  // Not in `safety`: SD-282 needs a privacy and data-retention decision. The forget path stores a member who left
  // and an under-13 decline the same way, so the intended design is not settled and `forgetPoll` and
  // `forgetPollCode` both fail this rule (forgetTest).
  val openConsoleDecisions = inv_declinedMeansDeclined

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
  // A timeout is reachable (intended: it reads as "unknown"), and so is a hold that the service applies on one app.
  val witness_timedOut = not(s.rel.phase == "answered" and s.rel.svc == "pending")
  val witness_holdThisApp = not(s.hs.heldIn == Set("slop"))

  // ------------------------------------------------------------------ run tests (concrete traces)
  // The traces of the first model. Where a fix of the source branch is not on vibestack-matching (compared
  // 2026-11-21), the trace ends in the defect state and the test says "OPEN".
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

  // SD-247 (OPEN again, 2026-11-18): after the role loss, "End" gets 403; the client drops the reveal while
  // the server keeps the grant.
  run endRevealRefusedKeepsItTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(unrevealCode("S1", "slop", true))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 0 and not(inv_revealShownTruly))

  // OPEN: a network error on "End" also drops the reveal on screen while the server keeps it.
  run endRevealUnreachedTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unrevealCode("S1", "slop", false))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 0 and not(inv_revealShownTruly))

  // "End" that the server accepts drops the reveal on both sides.
  run endRevealTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unreveal("S1", "slop", true))
      .expect(s.reveals.size() == 0 and s.clientReveals.size() == 0)

  // "End" with the audit sink down: the server deleted the grant, then answered 503; the code drops it too.
  run endRevealAuditDownTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unrevealWithCode("S1", "slop", true, false))
      .expect(s.reveals.size() == 0 and s.clientReveals.size() == 0 and inv_revealShownTruly)

  // Intended "End" after the role loss (403) and after a network error: the badge stays while the server reveals.
  run endRevealIntendedKeepsBadgeTest =
    init0
      .then(revealPost("S1", "slop", true))
      .then(unreveal("S1", "slop", false))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 1 and inv_revealShownTruly)
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(reloadRoles(true))
      .then(unreveal("S1", "slop", true))
      .expect(s.reveals.size() == 1 and s.clientReveals.size() == 1 and inv_revealShownTruly)

  // A reveal needs its audit row: with the audit sink down nothing is granted (server.ts "/api/reveal").
  run revealNeedsAuditTest =
    init0
      .then(revealPost("S1", "slop", false))
      .expect(s.reveals.size() == 0)

  // The socket recheck closes S1's slop socket after both grants go (observatory.md 2.4; staff.test.ts "live sockets are authorized again").
  run socketClosedAfterRevokeTest =
    init0
      .then(issueTicket("S1", "slop"))
      .then(openSocket(0))
      .then(revokeGrant(("S1", "safety", "slop")))
      .then(revokeGrant(("S1", "reviewer", "slop")))
      .then(reloadRoles(true))
      .then(recheck("S1", "slop"))
      .expect(s.sockets.size() == 0 and inv_socketAuthorized)

  // SD-083 (OPEN, 2026-11-21): the pg_roles check throws for an unfit login; init reads through the unchecked
  // connection anyway, and the polls keep reading through it without a new check.
  run loginCheckFailsClosedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInitCode(true, true))
      .expect(s.src.phase == "unchecked" and s.src.served and s.src.envError and not(inv_servedOnlyCheckedLogin))
      .then(sourcePollCode(false, true))
      .expect(s.src.phase == "unchecked" and s.src.served and not(s.src.loginChecked) and not(inv_servedOnlyCheckedLogin))

  // A fit login whose check throws is also never checked again in the code; its data is served.
  run loginCheckRetryServesTest =
    init0
      .then(sourceInitCode(true, true))
      .then(sourcePollCode(false, true))
      .expect(s.src.phase == "unchecked" and s.src.served and not(s.src.loginChecked))

  // Intended: an unfit login whose check throws serves nothing; the next poll checks it and refuses it.
  run loginCheckIntendedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(true, true))
      .expect(s.src.phase == "unchecked" and not(s.src.served) and inv_servedOnlyCheckedLogin)
      .then(sourcePoll(false, true))
      .expect(s.src.phase == "refused" and not(s.src.served) and inv_servedOnlyCheckedLogin)

  // A fit login whose check answers is live.
  run loginCheckedLiveTest =
    init0
      .then(sourceInit(false, true))
      .expect(s.src.phase == "live" and s.src.served and s.src.loginChecked and inv_servedOnlyCheckedLogin)

  // An unfit login with a working check serves nothing (real.ts RealSource.init).
  run unfitLoginRefusedTest =
    initWith(false, true, "real", 0, true, "adult")
      .then(sourceInit(false, true))
      .expect(s.src.phase == "refused" and not(s.src.served))

  // SD-082 (OPEN, 2026-11-21): minor_reported sets the stored flag only; the state view read then fails. stateRow
  // returns no row, and the console treats x as the adult of the record age.
  run ageReadErrorTest =
    init0
      .then(netMinorSignal(false))
      .then(agePollCode(true, true))
      .then(agePollCode(false, true))
      .expect(not(s.age.consoleMinor) and s.age.netAtPoll and not(inv_ageFailClosed))

  // Intended: the failed state view read fails the load, and the console keeps x as a minor.
  run ageReadErrorIntendedTest =
    init0
      .then(netMinorSignal(false))
      .then(agePoll(true, true))
      .then(agePoll(false, true))
      .expect(s.age.consoleMinor and inv_ageFailClosed)

  // A minor flag that came by an age event survives a failed state view read (the events give it).
  run ageEventSurvivesRowErrorTest =
    init0
      .then(netMinorSignal(true))
      .then(agePollCode(true, true))
      .then(agePollCode(false, true))
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

  // SD-068 (OPEN again, 2026-11-18): S2 (admin@*) sees slop's sc1 (x) and switches to peon. Until peon's cases
  // answer, the slop rows stay, and Close on the row closes peon's sc1 (y).
  run crossAppCloseTest =
    init0
      .then(pollSafety(true))
      .then(switchAppCode("peon"))
      .expect(s.cs.dataApp == "slop")
      .then(pressClose("S2"))
      .expect(s.cs.intended == "x" and s.cs.actual == "y" and not(inv_actionTargetsSelectedPerson))

  // After peon's cases answer, Close closes the case on the row.
  run crossAppCloseAfterPollTest =
    init0
      .then(switchApp("peon"))
      .then(pollSafety(true))
      .then(pressClose("S2"))
      .expect(s.cs.intended == "y" and s.cs.actual == "y" and inv_actionTargetsSelectedPerson)

  // SD-070 (OPEN, 2026-11-21): S1 (safety@slop only) holds P; the service holds slop only; the toast says
  // "Person held on every app".
  run holdScopeTextTest =
    init0
      .then(pressHoldCode("S1"))
      .expect(s.hs.heldIn == Set("slop") and s.hs.toastEvery and not(inv_successTextMatchesScope))

  // Intended: the same hold says "this app".
  run holdScopeTextIntendedTest =
    init0
      .then(pressHold("S1"))
      .expect(s.hs.heldIn == Set("slop") and not(s.hs.toastEvery) and inv_successTextMatchesScope)

  // An admin@* hold covers every app (service.ts NetworkService.hold), and the text says every app.
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

  // A hold with the service audit sink down does not run (service.ts auditedRun).
  run holdNeedsServiceRowTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", false))
      .expect(s.svcEffects.size() == 0 and s.rel.svc == "refused")

  // SD-288 (OPEN, 2026-11-21): the service commits, the answer comes after 15 s; the console says the service did
  // not answer (service_unavailable, ok false), and its result row says the action failed.
  run timeoutAfterCommitTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", true))
      .then(consoleTimeoutCode)
      .expect(s.rel.consoleResult == "fail" and s.rel.svc == "committed" and not(inv_consoleSaysServiceDoes))

  // Intended: the same late answer reads as "unknown".
  run timeoutUnknownIntendedTest =
    init0
      .then(consoleSend("hold", true))
      .then(serviceApply("commit", true))
      .then(consoleTimeout)
      .expect(s.rel.consoleResult == "unknown" and inv_consoleSaysServiceDoes)

  // A review through the console (the witness path): requested row, commit, answer.
  run reviewThroughConsoleTest =
    init0
      .then(consoleSend("review", true))
      .then(serviceApply("commit", true))
      .then(consoleAnswer)
      .expect(s.rel.consoleResult == "ok" and inv_auditFirst and inv_consoleSaysServiceDoes)

  // SD-285 (OPEN, 2026-11-21): a server started in real mode (not real-only) tries game; the game start fails; the
  // server is in game mode with no running source, and the kept rejected start fails the next switch too.
  run modeSwitchFailKeepsModeTest =
    initWith(true, false, "real", 0, true, "adult")
      .then(modeSwitchCode("game", false))
      .expect(s.md.mode == "game" and s.md.srcState.get("game") == "failed" and not(inv_modeHasRunningSource))
      .then(modeSwitchCode("game", true))
      .expect(s.md.mode == "game" and s.md.srcState.get("game") == "failed" and not(inv_modeHasRunningSource))

  // A switch whose start works goes to the new mode with its source running.
  run modeSwitchTest =
    initWith(true, false, "real", 0, true, "adult")
      .then(modeSwitch("game", true))
      .expect(s.md.mode == "game" and inv_modeHasRunningSource)

  // Intended: a failed start leaves the server in real mode.
  run modeSwitchFailIntendedTest =
    initWith(true, false, "real", 0, true, "adult")
      .then(modeSwitch("game", false))
      .expect(s.md.mode == "real" and inv_modeHasRunningSource)

  // SD-286 (OPEN, 2026-11-21): a reviewer's command passes the checks in game mode; an admin switches to real
  // while the handler awaits its body; the command runs on the real source.
  run modeHeaderRaceTest =
    initWith(true, false, "game", 0, true, "adult")
      .then(controlCheck("game"))
      .then(modeSwitch("real", true))
      .then(controlRunCode)
      .expect(s.md.ranSaw == "game" and s.md.ranIn == "real" and not(inv_commandRunsInSeenMode))

  // PER63: in production without the peon live decision a direct service call cannot turn peon on, the tick does
  // not run it, and the overview says "locked" (SD-088 closed).
  run peonGateTest =
    init0
      .then(directServiceSwitch("peon", true))
      .expect(not(s.mg.stored.get("peon")) and overviewMatching(s.mg, "peon") == "locked" and inv_consoleShowsGate
              and inv_tickRunImpliesLaunchScope)

  // Outside production (local simulation, development, test) peon follows its registry row: on, then the tick runs.
  run peonLocalRunsTest =
    initFull(true, true, "real", 0, true, "adult", false, false)
      .then(directServiceSwitch("peon", true))
      .then(serviceTick("peon"))
      .expect(s.mg.engineRan.get("peon") and overviewMatching(s.mg, "peon") == "on" and inv_consoleShowsGate
              and inv_tickRunImpliesLaunchScope)

  // In production with PEON_LIVE_APPROVED=1 the founder's decision lets peon matching run.
  run peonLiveRunsTest =
    initFull(true, true, "real", 0, true, "adult", true, true)
      .then(directServiceSwitch("peon", true))
      .then(serviceTick("peon"))
      .expect(s.mg.engineRan.get("peon") and inv_tickRunImpliesLaunchScope)

  // With the peon registry row false the service refuses peon on everywhere, and the overview says "locked".
  run peonRegistryOffTest =
    initFull(true, true, "real", 0, false, "adult", false, true)
      .then(directServiceSwitch("peon", true))
      .expect(not(s.mg.stored.get("peon")) and overviewMatching(s.mg, "peon") == "locked" and inv_tickRunImpliesLaunchScope)

  // The console sends the press; the service refuses peon on outside the launch scope (setMatching matching_not_allowed).
  run consoleRefusesPeonTest =
    init0
      .then(switchApp("peon"))
      .then(configPoll)
      .then(pressSwitch("S2"))
      .then(pressSwitch("S2"))
      .expect(not(s.mg.stored.get("peon")) and s.cf.sent and s.cf.sentApp == "peon")

  // SD-246 (OPEN again, 2026-11-18): armed on slop, switch to peon before peon's config answers: the switch stays
  // armed with slop's data, and the confirm sends slop's target to peon.
  run armedSwitchCarriesTest =
    init0
      .then(pressSwitch("S2"))
      .then(switchAppCode("peon"))
      .expect(s.cf.armed and s.cf.dataApp == "slop")
      .then(pressSwitch("S2"))
      .expect(s.cf.sent and s.cf.sentApp == "peon" and s.cf.sentArmedFor == "slop" and not(inv_confirmMatchesApp))

  // When peon's config answers first, the ask ends and the next click only arms peon.
  run armedSwitchReloadTest =
    init0
      .then(pressSwitch("S2"))
      .then(switchApp("peon"))
      .then(configPoll)
      .expect(not(s.cf.armed))
      .then(pressSwitch("S2"))
      .expect(s.cf.armed and s.cf.armedApp == "peon" and not(s.cf.sent) and inv_confirmMatchesApp)

  // Bug 11 (flip): S2 arms "turn on" for slop, another admin turns slop on, and the push reloads the config:
  // the ask ends and nothing is sent.
  run switchAlreadyFlippedTest =
    init0
      .then(pressSwitch("S2"))
      .then(directServiceSwitch("slop", true))
      .then(configPoll)
      .expect(not(s.cf.armed) and not(s.cf.sent) and s.mg.stored.get("slop"))

  // SD-470 (OPEN, 2026-11-21): a request with token 0 is in flight, token 0 stops working, a new token is set; the
  // late 401 opens the prompt although the new token works.
  run late401Test =
    init0
      .then(clientSend)
      .then(tokenExpires)
      .then(setToken)
      .then(clientAnswerCode(0))
      .expect(s.cl.authNeeded and not(inv_promptOnlyForBadToken))

  // A 401 for the token in use opens the prompt.
  run current401Test =
    init0
      .then(clientSend)
      .then(tokenExpires)
      .then(clientAnswer(0))
      .expect(s.cl.authNeeded and inv_promptOnlyForBadToken)

  // SD-287 (OPEN, 2026-11-21): the service clock leads by one tick; the fresh preview is refused as "expired".
  run previewSkewTest =
    initWith(true, true, "real", 1, true, "adult")
      .then(loadPreviewCode("S1"))
      .expect(s.pv.state == "refusedExpired" and s.pv.tokenUntil > s.pv.refusedAt and not(inv_previewRefusalTrue))

  // Intended: the same lead loads the preview and keeps it 5 minutes on the console clock.
  run previewSkewIntendedTest =
    initWith(true, true, "real", 1, true, "adult")
      .then(loadPreview("S1"))
      .expect(s.pv.state == "ready" and s.pv.tokenUntil == s.now + PREVIEW_TICKS and inv_previewRefusalTrue)

  // Without skew the preview loads and S1 releases it (held-photo-ui.test.tsx path).
  run previewReleaseTest =
    init0
      .then(loadPreview("S1"))
      .then(releasePhoto("S1"))
      .expect(s.pv.state == "released" and inv_releaseBySameStaff)

  // SD-279 (OPEN, 2026-11-21): a booked plan is closed by the Network; the projection still reads SCHEDULED, and
  // the world's outcome then makes it COMPLETED.
  run closedBookedPlanCancelledTest =
    init0
      .then(netPropose)
      .then(netBook)
      .then(netCloseCode)
      .expect(s.pj.proj == "SCHEDULED" and not(inv_projectionRefines))
      .then(worldOutcomeCode(true))
      .expect(s.pj.proj == "COMPLETED" and not(inv_projectionRefines) and inv_terminalAbsorbing)

  // SD-281 (OPEN, 2026-11-21): z leaves; the next poll keeps the deleted edge in console memory. SD-282 (skipped,
  // not in `safety`): z also shows as an under-13 decline.
  run forgetTest =
    init0
      .then(forgetPollCode)
      .then(forgetMember)
      .then(forgetPollCode)
      .expect(s.fg.consoleEdge and not(inv_forgetClosure) and not(inv_declinedMeansDeclined))

  // SD-505 (fixed, 5afecd3): a delta at the snapshot version is not applied again.
  run deltaOnceTest =
    init0
      .then(dvStartLoad)
      .then(dvEmit)
      .then(dvSnapshot)
      .expect(s.dv.feed == 1 and s.dv.server == 1 and inv_feedExact)

  // SD-466 (OPEN, 2026-11-21): a typed note, then one failed poll: the rows unmount and the note is lost.
  run failedPollTest =
    init0
      .then(typeNote)
      .then(pollSafetyCode(false))
      .expect(not(s.cs.note) and s.cs.dataApp == "none" and not(inv_failedPollKeepsInput))
}
```
