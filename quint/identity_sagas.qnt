// quint-check: max-steps=40 max-samples=10000 verify-steps=5
//
// identity_sagas: person lifecycle, phone identity and recycled-number hold, number change, ban saga,
// erasure sagas (leave, delete everything, staff new_owner, under-13 decline) and suppression.
// Plan: docs/research/2026-11-07-state-machines.md section 6.4. Sources: docs/research/state-machines/
// implicit-sweep.md 3.4, 3.5, 3.8; platform-identity.md 2.1-2.4, 2.9, 2.10 and D4, D7, D9, D11, D16-D19,
// D24, D25.
//
// The model follows the code as it is on ad67275, not as it should be:
//   packages/platform/src/accounts.ts       (personFor, seen, clearHold, confirmNumberChange, join, stop, leave, deleteAll, exportApp)
//   packages/platform/src/pg-store.ts       (createPerson, putMembership, isBanned, phoneHashesOf, forgetMembership, deleteAll, movePhone)
//   packages/network/service/service.ts     (hooks().onForget 758-766, stopped 801-812, inbound 1052-1092, statedAge 1292-1310, ban 1734-1764, /holds 2262-2270)
//   packages/network/service/runtime.ts     (identities 387-404, the forget path 521-551)
//   packages/network/service/photoIntake.ts (consentAnswer 112-134)
//   packages/blooio/src/outbound-queue.ts   (admission binding 470-485, line_conversations 559-565 and 640-641)
//
// Rules of the model (quint/README.md):
//  - One SQL transaction is one action. Each `await` between two transactions of a saga is a separate
//    step, so a crash or another actor can run between them. A saga is one record with a program counter.
//  - `crash` drops a running saga (the process stops). The staff or the member can start it again; the
//    start action runs the code's own guards, so a retry that the code refuses is visible.
//  - Other actors (the holder of a number, staff, the Network, the carrier, the clock) run at any time.
//  - Hashes are the phone names ("A" stands for keyedHash("phone:A")). The eliza notice uses its own
//    hash domain (service.ts:1164), so the model keys it by the phone in a separate set.
//  - Ghost state (record `g`) holds what really happened: who holds a number (`holder`, `humanOf`),
//    what a person asked for, and counters for the witnesses. Network code never reads it.
//
// Assumptions (not facts about the code):
//  - A carrier gives a number to another human only when it is nobody's verified number, or when it
//    was silent for the stale period (accounts.ts:9-10 is the same assumption).
//  - The holder of a number is the only sender from it. A number change needs a code from the new
//    number, so only its holder can confirm it.
//  - A legacy `network.channel_identities` row exists only if the init chooses one (platform-identity D7).
//  - A Cloud-origin OAuth grant on the old number exists only if the init chooses one (a person who
//    got a Cloud grant before the auth mode changed to OTP: platform-identity D25).
module identity_sagas {

  // ------------------------------------------------------------------ types and bounds
  type Ph = str
  type PhoneRow = { exists: bool, owner: int, hold: bool, holdAt: int, lastSeen: int }
  // hash "" is people.phone_hash null (after detachPhoneHash).
  type PersonRow = { exists: bool, live: bool, hash: str }
  // app "*" is a global event (app_id null). seq orders events with the same time (order by at, id).
  type Ev = { ph: str, app: str, out: bool, at: int, seq: int }
  type BanRow = { scope: str, person: int, hash: str }
  // A STOP the gateway received; it is written to the ledger by a later action (stopCommit).
  type StopMsg = { ph: str, at: int, owner: int, h: str }

  type World = {
    now: int,
    holder: str -> str,                   // ghost: the human who holds each number
    phones: str -> PhoneRow,              // platform.phone_identities
    people: int -> PersonRow,             // platform.people
    humanOf: int -> str,                  // ghost: the human behind each person
    mem: (int, str) -> str,               // platform.memberships.state ("none" = no row)
    gen: (int, str) -> int,               // the member id generation of (person, app)
    net: (int, str) -> str,               // network.members.account_status ("none" = no row)
    netBanned: Set[(int, str)],           // the Network's markBanned hold
    photos: Set[(int, str)],              // platform photos of a person in an app
    ratings: Set[int],                    // appearance ratings
    privFacts: Set[(int, str)],           // agent_private facts the member stated (the join zip)
    grants: Set[(int, str)],              // live MCP OAuth grants of (person, app)
    cloudGrant: Set[str],                 // Cloud-origin oauth.grants rows by phone_key (revoked or not)
    bans: Set[BanRow],                    // platform.bans
    suppression: Set[str],                // platform.suppression
    floors: Set[str],                     // platform.age_floor rows
    ledger: Set[Ev],                      // platform.consent_events
    seq: int,
    lineRows: Set[str],                   // platform.line_conversations rows (plain E.164 address)
    runs: Set[(int, str, int)],           // network.matching_runs summaries that name a member
    receipts: Set[int],                   // profile_suggestion_connection_receipts (person_id)
    notices: Set[str],                    // platform.eliza_notices, keyed by the eliza_notice hash of a phone
    legacy: Set[(str, int, str)],         // network.channel_identities (address, person's member, app)
    pendingStops: Set[StopMsg],
    photoSnap: int -> str,                // photo consent answer: the membership state it read ("" = none)
  }

  type Sagas = {
    ban: { pc: int, p: int, scope: str, hashes: Set[str], left: Set[str] },
    leave: { pc: int, p: int, app: str, ph: str, hasM: bool, failListener: bool },
    del: { pc: int, p: int, ph: str, left: Set[str] },
    ch: { pc: int, ph: str, p: int, left: Set[str] },
    mv: { pc: int, p: int, src: str, dst: str },
    u13: { pc: int, p: int, ph: str, app: str, left: Set[str] },
    crashes: int,
  }

  type Ghost = {
    banDecided: Set[int],                 // a ban row was written for this person (the ban is in force)
    banPending: Set[int],                 // a ban saga started and has not finished
    leavePending: Set[(int, str)],
    delPending: Set[int],
    chPending: Set[str],                  // a new_owner decision started and has not finished
    newOwnerDecided: Set[str],
    revivedForOther: bool,                // a join revived a person whose number got a new_owner decision
    erasedPhones: Set[str],               // numbers whose owner deleted everything (until they write again)
    erasedPersons: Set[int],
    selfDeleted: Set[str],                // like erasedPhones, until a join or a move to the number
    forgotten: Set[(int, str, int)],      // (person, app, member generation) the forget unit removed
    personStop: Set[int],                 // a person sent STOP from their own number (and no opt-in since)
    holderStop: Set[(str, str)],          // a human who is not the number's person sent STOP from it
    everVerified: int -> Set[str],
    photosAtBan: Set[(int, str)],
    wrongHuman: bool,                     // a proactive text reached a human who is not the member
    misrouted: bool,                      // a text from a human reached another person's member
    moveFailedAfterCode: bool,            // a number change with a used code and passed checks did not move
    exportGap: bool,                      // an export left out the member's own photos or stated facts
    noticed: Set[int],                    // persons who got the one-time Eliza notice
    banDone: int, banRefused: int, leaveDone: int, delDone: int, newOwnerDone: int, sameOwnerDone: int,
    moveDone: int, u13Done: int, stopsCommitted: int, rejoins: int,
    last: str,
    args: List[str],
  }

  pure val PHONES = Set("A", "B")
  pure val HUMANS = Set("h1", "h2")
  pure val PERSONS = Set(1, 2, 3)
  pure val PIDS = Set(0, 1, 2, 3)          // 0 = no person
  pure val APPS = Set("slop", "peon")
  pure val STALE = 1                       // RECYCLED_AFTER_MS (12 months) in ticks
  pure val MAX_T = 6
  pure val MAX_CRASH = 1
  pure val LIVE_MEM = Set("active", "paused", "restricted", "onboarding")
  pure val NET_LIVE = Set("active", "restricted")
  pure val NO_PHONE: PhoneRow = { exists: false, owner: 0, hold: false, holdAt: 0, lastSeen: 0 }
  pure val NO_PERSON: PersonRow = { exists: false, live: false, hash: "" }
  pure val EV0: Ev = { ph: "", app: "", out: false, at: -1, seq: -1 }

  var w: World
  var s: Sagas
  var g: Ghost

  // ------------------------------------------------------------------ code predicates (pure)
  pure def newer(a: Ev, b: Ev): bool = a.at > b.at or (a.at == b.at and a.seq > b.seq)
  pure def lastEv(evs: Set[Ev]): Ev = evs.fold(EV0, (acc, e) => if (newer(e, acc)) e else acc)

  // consent.ts:37-43 resolveConsent on the two last events (pg-store.ts:137-145).
  pure def resolvedOut(w0: World, ph: str, a: str): bool = {
    val ae = lastEv(w0.ledger.filter(e => e.ph == ph and e.app == a))
    val ge = lastEv(w0.ledger.filter(e => e.ph == ph and e.app == "*"))
    if (ae.seq < 0) ge.seq >= 0 and ge.out
    else if (ge.seq < 0 or not(ge.out)) ae.out
    else not(not(ae.out) and ae.at > ge.at)
  }

  // The phone row of a person (one phone per person: pg-store.ts:178).
  pure def phoneOf(w0: World, p: int): str =
    PHONES.fold("", (acc, ph) => if (w0.phones.get(ph).exists and w0.phones.get(ph).owner == p) ph else acc)

  pure def ownerOf(w0: World, ph: str): int = if (w0.phones.get(ph).exists) w0.phones.get(ph).owner else 0

  // accounts.ts:142-147 personFor: no person for a held number or a tombstone.
  pure def personFor(w0: World, ph: str): int = {
    val r = w0.phones.get(ph)
    if (r.exists and not(r.hold) and w0.people.get(r.owner).live) r.owner else 0
  }

  // pg-store.ts:173-176 isBanned(phoneHash, personId).
  pure def codeBanned(w0: World, hash: str, p: int): bool =
    w0.bans.exists(b => (hash != "" and b.hash == hash) or (b.scope == "person" and p != 0 and b.person == p))

  // accounts.ts:166-168 banned(e164, person).
  pure def bannedPh(w0: World, ph: str, p: int): bool = codeBanned(w0, ph, if (p != 0) p else ownerOf(w0, ph))

  // service.ts:1623-1629 personBanned (photos.mayTake reads it).
  pure def personBanned(w0: World, p: int): bool = codeBanned(w0, w0.people.get(p).hash, p)

  pure def stale(w0: World, ph: str): bool =
    w0.phones.get(ph).exists and w0.now - w0.phones.get(ph).lastSeen > STALE

  // accounts.ts:176-184 seen: two statements with no transaction (read, then hold or touch).
  pure def seen(w0: World, ph: str): { nw: World, out: str } = {
    val r = w0.phones.get(ph)
    if (not(r.exists)) { nw: w0, out: "new" }
    else if (r.hold) { nw: w0, out: "held" }
    else if (w0.now - r.lastSeen > STALE) { nw: { ...w0, phones: w0.phones.set(ph, { ...r, hold: true, holdAt: w0.now }) }, out: "held" }
    else { nw: { ...w0, phones: w0.phones.set(ph, { ...r, lastSeen: w0.now }) }, out: "ok" }
  }

  // runtime.ts:387-404 identities: platform rows (hold is null), then legacy rows (no hold filter); a
  // later row wins in addrToMember, so a legacy row beats the platform row for the same address.
  pure def routesText(w0: World, ph: str, a: str): int = {
    val r = w0.phones.get(ph)
    val plat = if (r.exists and not(r.hold) and NET_LIVE.contains(w0.net.get((r.owner, a)))) r.owner else 0
    val leg = w0.legacy.fold(0, (acc, t) => if (t._1 == ph and t._3 == a and NET_LIVE.contains(w0.net.get((t._2, a)))) t._2 else acc)
    if (leg != 0) leg else plat
  }

  // runtime.ts:521-551 the forget path in one unit transaction (facets, channel_identities, members row).
  pure def forgetUnit(w0: World, p: int, a: str): World = {
    ...w0,
    net: w0.net.set((p, a), "removed"),
    netBanned: w0.netBanned.exclude(Set((p, a))),
    legacy: w0.legacy.filter(t => not(t._2 == p and t._3 == a)),
    privFacts: w0.privFacts.exclude(Set((p, a))),
  }

  // pg-store.ts:304-326 store.deleteAll in one transaction. line_conversations, matching_runs, connection
  // receipts and eliza_notices are not touched.
  pure def storeDeleteAll(w0: World, p: int, ph: str): World = {
    ...w0,
    suppression: w0.suppression.union(Set(ph)),
    ledger: w0.ledger.filter(e => e.ph != ph),
    mem: if (p != 0) w0.mem.keys().mapBy(k => if (k._1 == p) "none" else w0.mem.get(k)) else w0.mem,
    phones: PHONES.mapBy(x => if (x == ph or (p != 0 and w0.phones.get(x).exists and w0.phones.get(x).owner == p)) NO_PHONE else w0.phones.get(x)),
    people: if (p != 0) w0.people.set(p, { ...w0.people.get(p), live: false }) else w0.people,
  }

  pure def addEv(w0: World, ph: str, a: str, out: bool, at: int): World =
    { ...w0, ledger: w0.ledger.union(Set({ ph: ph, app: a, out: out, at: at, seq: w0.seq + 1 })), seq: w0.seq + 1 }

  pure def firstOf(S: Set[str]): str = S.fold("", (acc, x) => if (acc == "") x else acc)

  // ------------------------------------------------------------------ state predicates
  def busy(p: int): bool =
    (s.ban.pc > 0 and s.ban.p == p) or (s.leave.pc > 0 and s.leave.p == p) or (s.del.pc > 0 and s.del.p == p)
    or (s.ch.pc > 0 and s.ch.p == p) or (s.mv.pc > 0 and s.mv.p == p) or (s.u13.pc > 0 and s.u13.p == p)
    or w.pendingStops.exists(m => m.owner == p) or w.photoSnap.get(p) != ""

  // The guard a staff retry of the ban meets (service.ts:1735-1743).
  def banRetryOk(p: int): bool = {
    val hashes = if (w.people.get(p).hash == "") Set() else Set(w.people.get(p).hash)
    val member = APPS.exists(a => NET_LIVE.contains(w.net.get((p, a))))
    val already = if (s.ban.scope == "person") codeBanned(w, "", p) else hashes.forall(h => codeBanned(w, h, 0))
    member and not(s.ban.scope == "phone" and hashes == Set()) and not(already)
  }

  // The member's own retry of a leave by text (service.ts:1078-1084: the sender must route to a member).
  def leaveRetryOk(p: int, a: str): bool =
    PHONES.exists(ph => w.holder.get(ph) == w.humanOf.get(p) and routesText(w, ph, a) != 0)

  // A staff retry of POST /holds (accounts.ts:196-197).
  def chRetryOk(ph: str): bool = w.phones.get(ph).exists and w.phones.get(ph).hold

  // A member's retry of delete everything (api.ts:626-636: a session, not held).
  def delRetryOk(p: int): bool = { val ph = phoneOf(w, p); ph != "" and personFor(w, ph) == p }

  // ------------------------------------------------------------------ invariants (rules, not code)

  // AGENTS.md founder decision 3 (2026-10-09), PRD 40.5 and lines 1777, 1817, and the ban comment at
  // service.ts:1727-1731: once a ban is in force, the person is never matched on any app (memberships
  // restricted, the Network holds the member). Reproduces SD-005 (crash, then the retry is refused as
  // already_banned) and SD-017 (photo consent writes a whole stale row over `restricted`).
  val bannedNotMatchable = g.banDecided.forall(p =>
    (s.ban.pc > 0 and s.ban.p == p) or APPS.forall(a =>
      w.net.get((p, a)) != "active" and not(Set("active", "paused", "onboarding").contains(w.mem.get((p, a))))))

  // implicit-sweep.md 3.5 and platform-identity.md 5.1 `recoverable`: a saga that stopped half way can be
  // finished by the retry the code offers. Reproduces SD-005 (ban), SD-016 (clearHold new_owner) and
  // SD-029 (leave: the text retry no longer routes to a member).
  val retryCompletes =
    g.banPending.forall(p => (s.ban.pc > 0 and s.ban.p == p) or banRetryOk(p))
    and g.leavePending.forall(k => (s.leave.pc > 0 and s.leave.p == k._1 and s.leave.app == k._2) or leaveRetryOk(k._1, k._2))
    and g.chPending.forall(ph => (s.ch.pc > 0 and s.ch.ph == ph) or chRetryOk(ph))
    and g.delPending.forall(p => (s.del.pc > 0 and s.del.p == p) or delRetryOk(p))

  // platform-identity.md 2.4 `no-pair-divergence` and the leave comment at accounts.ts:420: an active
  // membership has its Network member, except while a saga runs or waits for a retry that the code
  // allows (a crashed delete everything is finished by the member's retry: retryCompletes checks that).
  // Reproduces SD-029 (leave), SD-017 (a late whole-row write) and SD-011 (a crashed under-13 decline).
  val pairAgrees = tuples(PERSONS, APPS).forall(k =>
    busy(k._1) or g.delPending.contains(k._1) or (g.leavePending.contains(k) and leaveRetryOk(k._1, k._2))
    or w.mem.get(k) != "active" or w.net.get(k) == "active")

  // AGENTS.md founder decision 3 and accounts.ts:16-18 ("a banned person or number never moves"): the
  // number a banned person uses is a banned number. Reproduces SD-056 (a phone ban during a move).
  val banCoversPerson = g.banDecided.forall(p =>
    not(w.people.get(p).live) or { val ph = phoneOf(w, p); ph == "" or codeBanned(w, ph, p) })

  // PRD 40.5 and line 1817 ("ban by phone and person, not by account"): a banned person cannot come back
  // as a new person through a number they verified and still hold. Reproduces SD-492.
  val banCoversOldNumbers = g.banDecided.forall(p => g.everVerified.get(p).forall(ph =>
    w.holder.get(ph) != w.humanOf.get(p) or not(PERSONS.exists(q =>
      q != p and w.people.get(q).live and ownerOf(w, ph) == q and APPS.exists(a => w.mem.get((q, a)) == "active")))))

  // service.ts:1752 "The photos stay for the safety team": a banned person's photos are not deleted by
  // their own leave or delete. Reproduces SD-275, SD-256 (leave by text) and SD-178 (delete everything).
  val banKeepsPhotos = g.photosAtBan.forall(k => w.photos.contains(k))

  // accounts.ts:189-193 and 208 ("never revived for the new owner"), api.test.ts:302-303: after a
  // new_owner decision no join of that number gets the old owner's person. Reproduces SD-016.
  val newOwnerNotRevived = not(g.revivedForOther)

  // PRD 40.3 and docs/runbook-real.md 9.2 (consent moves with the person): a STOP a person sent from
  // their own number stays in force on the number they use now. Reproduces SD-055.
  val stopFollowsPerson = g.personStop.forall(p =>
    not(w.people.get(p).live) or w.pendingStops.exists(m => m.owner == p) or {
      val ph = phoneOf(w, p)
      ph == "" or w.suppression.contains(ph) or APPS.forall(a => resolvedOut(w, ph, a))
    })

  // PRD 40.3 and AGENTS.md "Consent path" (STOP always works, also while a number is held): the STOP of
  // the human who holds a number stays in force until that human opts in. Reproduces SD-051.
  val holderStopRespected = g.holderStop.forall(t =>
    w.holder.get(t._2) != t._1 or w.pendingStops.exists(m => m.ph == t._2)
    or PERSONS.exists(q => w.people.get(q).live and w.humanOf.get(q) == t._1)
    or w.suppression.contains(t._2) or APPS.forall(a => resolvedOut(w, t._2, a)))

  // accounts.ts:9-10: a number is put on hold because it was silent for 12 months. Reproduces SD-381.
  val holdMeansSilent = PHONES.forall(ph =>
    not(w.phones.get(ph).exists and w.phones.get(ph).hold) or w.phones.get(ph).holdAt - w.phones.get(ph).lastSeen > STALE)

  // accounts.ts:9-10 and PRD line 1771 (a number silent for 12 months waits for staff review): no
  // proactive text reaches a human who is not the member. Reproduces SD-098.
  val noSendToOtherHuman = not(g.wrongHuman)

  // README "Rules the code keeps" (a held number has no person) and runtime.ts:394 ("a number on hold is
  // nobody's address"): a text from one human never reaches another person's member. Reproduces SD-026.
  val noRouteToOtherHuman = not(g.misrouted)

  // implicit-sweep.md 3.5 invariant and AGENTS.md founder correction (deletion keeps no profile data):
  // after delete everything, no row holds the number in plain form. Reproduces SD-092.
  val noPlainPhoneAfterDelete = g.erasedPhones.forall(ph => not(w.lineRows.contains(ph)) and not(w.ledger.exists(e => e.ph == ph)))

  // runtime.ts:520 ("Nothing that names the member stays") and PRD F24 / SEC-005: after a forget or a
  // delete, no row names the member or the person. Reproduces SD-124 and SD-385.
  val forgetLeavesNoRows =
    g.forgotten.forall(t => not(w.runs.contains(t))) and g.erasedPersons.forall(p => not(w.receipts.contains(p)))

  // PRD 11.5 line 383 ("Removing a member ... revokes every key"), service.ts:761-765: a forgotten member
  // has no live agent grant. Reproduces SD-089 (under-13 decline; a failed listener is swallowed).
  val forgetRevokesGrants = g.forgotten.forall(t => busy(t._1) or not(w.grants.contains((t._1, t._2))))

  // PRD 11.5 line 383 ("A phone number change (F25) moves keys to the new number without breaking
  // them"): a confirmed code with all checks passed moves the number. Reproduces SD-108.
  val moveCompletes = not(g.moveFailedAfterCode)

  // store.ts:169-175 (movePhone moves "the one-time Eliza notice"). Reproduces SD-379.
  val noticeFollowsMove = g.noticed.forall(p =>
    not(w.people.get(p).live) or { val ph = phoneOf(w, p); ph == "" or w.notices.contains(ph) })

  // PRD line 551 and F24 ("Members can export their own data"), accounts.ts:446. Reproduces SD-378
  // (photos) and SD-294 (agent_private facts the member stated).
  val exportComplete = not(g.exportGap)

  // accounts.ts:246 and 373 (a new opt-in lifts the suppression of a delete): the number of a live,
  // not banned person is not suppressed once no saga runs for them. New finding Q-identity_sagas-1.
  val liveNumberNotSuppressed = PERSONS.forall(p =>
    not(w.people.get(p).live) or busy(p) or g.banDecided.contains(p) or {
      val ph = phoneOf(w, p)
      ph == "" or not(w.suppression.contains(ph))
    })

  // README "Rules the code keeps" and accounts.ts:431-437: after a delete of everything the person's
  // number keeps the suppression hash and the age floor (until the person joins again). The floor moves
  // with a number change by design (SD-274, refuted), so one of the person's numbers must keep it.
  // New finding Q-identity_sagas-2 (delete everything concurrent with a number change).
  val deleteKeepsSafety =
    g.selfDeleted.forall(ph => w.suppression.contains(ph))
    and (g.selfDeleted == Set() or g.selfDeleted.exists(ph => w.floors.contains(ph)))

  // Control: a held number has no person (accounts.ts:141-147), and a ban row is never removed.
  val heldHasNoPerson = PHONES.forall(ph => not(w.phones.get(ph).hold) or personFor(w, ph) == 0)

  val safety = and {
    bannedNotMatchable,
    retryCompletes,
    pairAgrees,
    banCoversPerson,
    banCoversOldNumbers,
    banKeepsPhotos,
    newOwnerNotRevived,
    stopFollowsPerson,
    holderStopRespected,
    holdMeansSilent,
    noSendToOtherHuman,
    noRouteToOtherHuman,
    noPlainPhoneAfterDelete,
    forgetLeavesNoRows,
    forgetRevokesGrants,
    moveCompletes,
    noticeFollowsMove,
    exportComplete,
    liveNumberNotSuppressed,
    deleteKeepsSafety,
    heldHasNoPerson,
  }

  // The invariant that holds on this code (a control for the run tests and for --verify).
  val controls = heldHasNoPerson

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_banDone = g.banDone == 0
  val witness_banRetryRefused = g.banRefused == 0
  val witness_leaveDone = g.leaveDone == 0
  val witness_deleteDone = g.delDone == 0
  val witness_newOwnerDone = g.newOwnerDone == 0
  val witness_sameOwnerDone = g.sameOwnerDone == 0
  val witness_moveDone = g.moveDone == 0
  val witness_u13Done = g.u13Done == 0
  val witness_stopCommitted = g.stopsCommitted == 0
  val witness_rejoin = g.rejoins == 0
  val witness_held = PHONES.forall(ph => not(w.phones.get(ph).hold))

  // ------------------------------------------------------------------ init
  pure val SAGAS0: Sagas = {
    ban: { pc: 0, p: 0, scope: "", hashes: Set(), left: Set() },
    leave: { pc: 0, p: 0, app: "", ph: "", hasM: false, failListener: false },
    del: { pc: 0, p: 0, ph: "", left: Set() },
    ch: { pc: 0, ph: "", p: 0, left: Set() },
    mv: { pc: 0, p: 0, src: "", dst: "" },
    u13: { pc: 0, p: 0, ph: "", app: "", left: Set() },
    crashes: 0,
  }

  // Person 1 (human h1) is a live member of both apps on number A, with a slop photo, a rating, a zip
  // fact, an MCP grant per app and the one-time Eliza notice. Number B is free.
  action initWith(lg: Set[(str, int, str)], holderB: str, cloudA: bool, suppB: bool): bool = all {
    w' = {
      now: 0,
      holder: Map("A" -> "h1", "B" -> holderB),
      phones: Map("A" -> { exists: true, owner: 1, hold: false, holdAt: 0, lastSeen: 0 }, "B" -> NO_PHONE),
      people: PIDS.mapBy(q => if (q == 1) { exists: true, live: true, hash: "A" } else NO_PERSON),
      humanOf: PIDS.mapBy(q => if (q == 1) "h1" else ""),
      mem: tuples(PIDS, APPS).mapBy(k => if (k._1 == 1) "active" else "none"),
      gen: tuples(PIDS, APPS).mapBy(k => if (k._1 == 1) 1 else 0),
      net: tuples(PIDS, APPS).mapBy(k => if (k._1 == 1) "active" else "none"),
      netBanned: Set(),
      photos: Set((1, "slop")),
      ratings: Set(1),
      privFacts: Set((1, "slop")),
      grants: Set((1, "slop"), (1, "peon")),
      cloudGrant: if (cloudA) Set("A") else Set(),
      bans: Set(),
      suppression: if (suppB) Set("B") else Set(),
      floors: Set("A"),
      ledger: Set({ ph: "A", app: "slop", out: false, at: 0, seq: 1 }, { ph: "A", app: "peon", out: false, at: 0, seq: 2 }),
      seq: 2,
      lineRows: Set(),
      runs: Set(),
      receipts: Set(),
      notices: Set("A"),
      legacy: lg,
      pendingStops: Set(),
      photoSnap: PIDS.mapBy(q => ""),
    },
    s' = SAGAS0,
    g' = {
      banDecided: Set(), banPending: Set(), leavePending: Set(), delPending: Set(), chPending: Set(),
      newOwnerDecided: Set(), revivedForOther: false, erasedPhones: Set(), erasedPersons: Set(), selfDeleted: Set(),
      forgotten: Set(), personStop: Set(), holderStop: Set(),
      everVerified: PIDS.mapBy(q => if (q == 1) Set("A") else Set()),
      photosAtBan: Set(), wrongHuman: false, misrouted: false, moveFailedAfterCode: false, exportGap: false,
      noticed: Set(1),
      banDone: 0, banRefused: 0, leaveDone: 0, delDone: 0, newOwnerDone: 0, sameOwnerDone: 0,
      moveDone: 0, u13Done: 0, stopsCommitted: 0, rejoins: 0,
      last: "init", args: [],
    },
  }

  action init = {
    nondet lg = Set(Set(), Set(("A", 1, "slop"))).oneOf()
    nondet hb = HUMANS.oneOf()
    nondet ca = Set(false, true).oneOf()
    nondet sb = Set(false, true).oneOf()
    initWith(lg, hb, ca, sb)
  }

  action set3(nw: World, ns: Sagas, ng: Ghost): bool = all { w' = nw, s' = ns, g' = ng }
  action blocked = all { false, set3(w, s, g) }

  // ------------------------------------------------------------------ environment
  action tick = all { w.now < MAX_T, set3({ ...w, now: w.now + 1 }, s, { ...g, last: "tick", args: [] }) }

  action stutter = set3(w, s, { ...g, last: "stutter", args: [] })

  // The carrier gives a number to another human (assumption in the header).
  action reassign(ph: str, h: str): bool = all {
    w.holder.get(ph) != h,
    not(w.phones.get(ph).exists) or stale(w, ph),
    not(s.mv.pc > 0 and s.mv.dst == ph),          // the code proved the holder a moment ago
    set3({ ...w, holder: w.holder.set(ph, h) }, s, { ...g, last: "carrier reassigns (phone, human)", args: [ph, h] }),
  }

  // A normal text from the holder (service.ts:1043 routing, 1061 seen, then memberMessage). The line
  // keeps a conversation row with the plain address (outbound-queue.ts:640-641).
  action inbound(ph: str, a: str): bool = {
    val h = w.holder.get(ph)
    val target = routesText(w, ph, a)
    val sn = seen(w, ph)
    val handled = sn.out != "held" and target != 0
    set3(
      { ...sn.nw, lineRows: if (handled) sn.nw.lineRows.union(Set(ph)) else sn.nw.lineRows },
      s,
      { ...g, misrouted: g.misrouted or (handled and w.humanOf.get(target) != h),
        erasedPhones: g.erasedPhones.exclude(Set(ph)), last: "inbound text (phone, app)", args: [ph, a] })
  }

  // STOP received by the gateway (a signed turn). The ledger write is the next action: an older turn
  // and a move can commit between the two (accounts.ts:398-407, service.ts:1054-1057).
  action stopRecv(ph: str): bool = {
    val h = w.holder.get(ph)
    val o = ownerOf(w, ph)
    val own = o != 0 and w.humanOf.get(o) == h
    all {
      w.pendingStops.size() < 2,
      set3({ ...w, pendingStops: w.pendingStops.union(Set({ ph: ph, at: w.now, owner: o, h: h })) }, s,
        { ...g, personStop: if (own) g.personStop.union(Set(o)) else g.personStop,
          holderStop: if (own) g.holderStop else g.holderStop.union(Set((h, ph))), last: "STOP received from", args: [ph] })
    }
  }

  // The ledger event on the number of the message, then stopped(): personFor at this time pauses the
  // person's active memberships (service.ts:801-812, whole-row putMembership).
  action stopCommit(m: StopMsg): bool = {
    val w1 = addEv(w, m.ph, "*", true, m.at)
    val p = personFor(w1, m.ph)
    val w2 = if (p == 0) w1 else { ...w1, mem: w1.mem.keys().mapBy(k => if (k._1 == p and w1.mem.get(k) == "active") "paused" else w1.mem.get(k)) }
    set3({ ...w2, pendingStops: w2.pendingStops.exclude(Set(m)) }, s,
      { ...g, stopsCommitted: g.stopsCommitted + 1, erasedPhones: g.erasedPhones.exclude(Set(m.ph)), last: "STOP committed on", args: [m.ph] })
  }

  // A join by text or web for the holder of ph, one atomic action under the join lock (the join steps
  // themselves are quint/join_age.qnt). accounts.ts:351-395, service.ts:1435-1463, pg-store.ts:64-73.
  action join(ph: str, a: str): bool = {
    val h = w.holder.get(ph)
    val sn = seen(w, ph)
    val w0 = sn.nw
    val p0 = personFor(w0, ph)
    val refused = sn.out == "held" or bannedPh(w0, ph, p0)
    val existing = if (p0 != 0) w0.mem.get((p0, a)) else "none"
    val tomb = PERSONS.filter(q => w0.people.get(q).exists and not(w0.people.get(q).live) and w0.people.get(q).hash == ph)
    val fresh = PERSONS.filter(q => not(w0.people.get(q).exists))
    val q = if (p0 != 0) p0 else if (tomb != Set()) tomb.fold(0, (acc, x) => if (x > acc) x else acc)
            else fresh.fold(0, (acc, x) => if (acc == 0 or x < acc) x else acc)
    val revived = p0 == 0 and tomb != Set()
    if (refused or LIVE_MEM.contains(existing) or q == 0)
      set3(w0, s, { ...g, last: "join refused or already a member", args: [ph, a] })
    else {
      val w1 = {
        ...w0,
        people: w0.people.set(q, { exists: true, live: true, hash: if (revived) w0.people.get(q).hash else if (p0 != 0) w0.people.get(q).hash else ph }),
        phones: if (p0 != 0) w0.phones else w0.phones.set(ph, { exists: true, owner: q, hold: false, holdAt: 0, lastSeen: w0.now }),
        humanOf: w0.humanOf.set(q, h),
        floors: w0.floors.union(Set(ph)),
        suppression: w0.suppression.exclude(Set(ph)),
        mem: w0.mem.set((q, a), "active"),
        gen: if (existing == "invited") w0.gen else w0.gen.set((q, a), w0.gen.get((q, a)) + 1),
        net: w0.net.set((q, a), "active"),
        privFacts: if (a == "slop") w0.privFacts.union(Set((q, a))) else w0.privFacts,
      }
      set3(addEv(w1, ph, a, false, w0.now), s, {
        ...g,
        revivedForOther: g.revivedForOther or (revived and g.newOwnerDecided.contains(ph)),
        everVerified: g.everVerified.set(q, g.everVerified.get(q).union(Set(ph))),
        erasedPhones: g.erasedPhones.exclude(Set(ph)), erasedPersons: g.erasedPersons.exclude(Set(q)),
        selfDeleted: g.selfDeleted.exclude(Set(ph)),
        personStop: g.personStop.exclude(Set(q)), holderStop: g.holderStop.exclude(Set((h, ph))),
        rejoins: if (existing == "removed" or revived) g.rejoins + 1 else g.rejoins,
        last: if (revived) "join (revived a tombstone)" else "join", args: [ph, a],
      })
    }
  }

  // A proactive send to member (p, a): the Network's address is the person's platform phone. Admission:
  // outbound-queue.ts:470-485 (member active, binding with hold null, membership active) and
  // service.ts:696-716 consentRefused (suppressed, banned, opted out). Nobody checks staleness.
  action sendProactive(p: int, a: str): bool = {
    val ph = phoneOf(w, p)
    all {
      ph != "",
      w.net.get((p, a)) == "active",
      w.mem.get((p, a)) == "active",
      w.people.get(p).live,
      not(w.phones.get(ph).hold),
      not(w.suppression.contains(ph)),
      not(bannedPh(w, ph, ownerOf(w, ph))),
      not(resolvedOut(w, ph, a)),
      set3({ ...w, lineRows: w.lineRows.union(Set(ph)) }, s,
        { ...g, wrongHuman: g.wrongHuman or w.holder.get(ph) != w.humanOf.get(p), last: "proactive send (phone, app)", args: [ph, a] }),
    }
  }

  // The Network's daily run writes a summary that names the member (runtime.ts unit `runs`).
  action matchRun(p: int, a: str): bool = all {
    w.net.get((p, a)) == "active",
    set3({ ...w, runs: w.runs.union(Set((p, a, w.gen.get((p, a))))) }, s, { ...g, last: "matching run names the member (app)", args: [a] }),
  }

  // A profile-suggestion connection receipt (insert only; service.ts:443-444).
  action connReceipt(p: int): bool = all {
    w.people.get(p).live,
    set3({ ...w, receipts: w.receipts.union(Set(p)) }, s, { ...g, last: "connection receipt", args: [] }),
  }

  // A photo upload by the person (photos.ts:457-473, mayTake: not banned).
  action uploadPhoto(p: int): bool = all {
    w.people.get(p).live,
    Set("active", "paused").contains(w.mem.get((p, "slop"))),
    not(personBanned(w, p)),
    set3({ ...w, photos: w.photos.union(Set((p, "slop"))) }, s, { ...g, last: "photo upload", args: [] }),
  }

  // YES PHOTOS: photoIntake.ts:112-134 reads the membership, checks mayTake (ban), then later writes the
  // whole row back with putMembership (pg-store.ts:124-129). Two actions.
  action photoRead(p: int): bool = {
    val ph = phoneOf(w, p)
    all {
      ph != "",
      personFor(w, ph) == p,
      w.photoSnap.get(p) == "",
      Set("active", "paused", "onboarding").contains(w.mem.get((p, "slop"))),
      not(personBanned(w, p)),
      set3({ ...w, photoSnap: w.photoSnap.set(p, w.mem.get((p, "slop"))) }, s, { ...g, last: "YES PHOTOS: read membership, mayTake ok", args: [] }),
    }
  }
  action photoWrite(p: int): bool = all {
    w.photoSnap.get(p) != "",
    set3({ ...w, mem: w.mem.set((p, "slop"), w.photoSnap.get(p)), photoSnap: w.photoSnap.set(p, "") }, s,
      { ...g, last: "YES PHOTOS: putMembership writes the row it read", args: [] }),
  }

  // GET /api/me/export (api.ts:574-577, accounts.ts:447-463): profile, consent, the network blob; no
  // photo rows, and the network blob leaves out agent_private facets (service.ts:834).
  action exportReq(ph: str, a: str): bool = {
    val p = personFor(w, ph)
    all {
      p != 0,
      LIVE_MEM.contains(w.mem.get((p, a))),
      set3(w, s, { ...g, exportGap: g.exportGap or w.photos.contains((p, a)) or w.privFacts.contains((p, a)), last: "export", args: [a] })
    }
  }

  // ------------------------------------------------------------------ ban saga (service.ts:1734-1764)
  action banStart(p: int, scope: str): bool = {
    val hashes = if (w.people.get(p).hash == "") Set() else Set(w.people.get(p).hash)
    val member = APPS.exists(a => NET_LIVE.contains(w.net.get((p, a))))
    val already = if (scope == "person") codeBanned(w, "", p) else hashes.forall(h => codeBanned(w, h, 0))
    all {
      s.ban.pc == 0,
      member,                                         // personOfMember (service.ts:1739)
      not(scope == "phone" and hashes == Set()),      // no_phone (service.ts:1741)
      if (already)                                    // already_banned (service.ts:1742-1743)
        set3(w, { ...s, ban: { ...s.ban, scope: scope } }, { ...g, banRefused: g.banRefused + 1, last: "ban start: refused already_banned (scope)", args: [scope] })
      else
        set3(w, { ...s, ban: { pc: 1, p: p, scope: scope, hashes: hashes,
                               left: APPS.filter(a => LIVE_MEM.contains(w.mem.get((p, a))) or NET_LIVE.contains(w.net.get((p, a)))) } },
          { ...g, banPending: g.banPending.union(Set(p)), last: "ban start: audit requested, hashes read (scope)", args: [scope] }),
    }
  }

  action banStep(a: str): bool = {
    val b = s.ban
    val p = b.p
    all {
      b.pc > 0,
      if (b.pc == 1) {
        // service.ts:1745-1749: ban rows with the hashes read at the start.
        val rows = if (b.scope == "person") Set({ scope: "person", person: p, hash: firstOf(b.hashes) })
                   else b.hashes.map(h => { scope: "phone", person: p, hash: h })
        set3({ ...w, bans: w.bans.union(rows) }, { ...s, ban: { ...b, pc: 2 } },
          { ...g, banDecided: g.banDecided.union(Set(p)), photosAtBan: g.photosAtBan.union(w.photos.filter(k => k._1 == p)), last: "ban: rows inserted", args: [] })
      } else if (b.pc == 2) {
        set3({ ...w, suppression: w.suppression.union(b.hashes) }, { ...s, ban: { ...b, pc: 3 } }, { ...g, last: "ban: hashes suppressed", args: [] })
      } else if (b.pc == 3) {
        set3({ ...w, ratings: w.ratings.exclude(Set(p)) }, { ...s, ban: { ...b, pc: 4 } }, { ...g, last: "ban: ratings dropped", args: [] })
      } else if (b.pc == 4) {
        // service.ts:1754: every membership not removed or invited -> restricted (whole-row writes).
        set3({ ...w, mem: w.mem.keys().mapBy(k => if (k._1 == p and LIVE_MEM.contains(w.mem.get(k))) "restricted" else w.mem.get(k)) },
          { ...s, ban: { ...b, pc: 5 } }, { ...g, last: "ban: memberships restricted", args: [] })
      } else if (b.pc == 5 and b.left.contains(a)) {
        // service.ts:1757-1759: account_status = 'restricted' (no status filter), then markBanned in a unit.
        set3({ ...w, net: w.net.set((p, a), "restricted"), netBanned: w.netBanned.union(Set((p, a))) },
          { ...s, ban: { ...b, left: b.left.exclude(Set(a)) } }, { ...g, last: "ban: network member restricted and held (app)", args: [a] })
      } else if (b.pc == 5 and b.left == Set()) {
        set3(w, { ...s, ban: { ...b, pc: 0 } }, { ...g, banPending: g.banPending.exclude(Set(p)), banDone: g.banDone + 1, last: "ban: audit result, done", args: [] })
      } else blocked,
    }
  }

  // ------------------------------------------------------------------ leave (accounts.ts:421-429)
  // By text: "leave <app>" (service.ts:1078-1092). STOP is not the message; seen runs first (1061).
  action leaveText(ph: str, a: str): bool = {
    val sn = seen(w, ph)
    val target = routesText(w, ph, a)
    val w0 = sn.nw
    val p = personFor(w0, ph)
    all {
      s.leave.pc == 0,
      if (sn.out == "held") set3(w0, s, { ...g, last: "leave text from a held number: not handled", args: [] })
      else if (target == 0) set3(w0, s, { ...g, last: "leave by text: no member, falls to the join flow (app, phone)", args: [a, ph] })
      else if (p == 0)
        // A member with no platform person (legacy): consent, then forget (service.ts:1086).
        set3(addEv(forgetUnit(w0, target, a), ph, a, true, w.now), s,
          { ...g, forgotten: g.forgotten.union(Set((target, a, w.gen.get((target, a))))), last: "leave by a legacy member", args: [a] })
      else
        set3(w0, { ...s, leave: { pc: 1, p: p, app: a, ph: ph, hasM: LIVE_MEM.contains(w0.mem.get((p, a))) or w0.mem.get((p, a)) == "invited", failListener: false } },
          { ...g, leavePending: if (LIVE_MEM.contains(w0.mem.get((p, a)))) g.leavePending.union(Set((p, a))) else g.leavePending,
            last: "leave by text (app, phone)", args: [a, ph] }),
    }
  }

  // By the API (api.ts:626-629): refused only when held. No ban check.
  action leaveApi(ph: str, a: str, failListener: bool): bool = {
    val p = personFor(w, ph)
    all {
      s.leave.pc == 0,
      not(w.phones.get(ph).hold),
      w.phones.get(ph).exists,
      set3(w, { ...s, leave: { pc: 1, p: p, app: a, ph: ph, hasM: p != 0 and w.mem.get((p, a)) != "none" and w.mem.get((p, a)) != "removed", failListener: failListener } },
        { ...g, leavePending: if (p != 0 and LIVE_MEM.contains(w.mem.get((p, a)))) g.leavePending.union(Set((p, a))) else g.leavePending,
          last: "leave by the API", args: [a] }),
    }
  }

  action leaveStep: bool = {
    val l = s.leave
    val p = l.p
    val a = l.app
    all {
      l.pc > 0,
      if (l.pc == 1) {
        // addConsent opted_out, then return when there is no person or membership (accounts.ts:425-426).
        val done = p == 0 or not(l.hasM)
        set3(addEv(w, l.ph, a, true, w.now), { ...s, leave: { ...l, pc: if (done) 0 else 2 } },
          { ...g, leaveDone: if (done) g.leaveDone else g.leaveDone, last: "leave: opted_out written", args: [] })
      } else if (l.pc == 2) {
        // onForget: photos first (service.ts:760).
        set3({ ...w, photos: w.photos.exclude(Set((p, a))) }, { ...s, leave: { ...l, pc: 3 } }, { ...g, last: "leave: photos deleted", args: [] })
      } else if (l.pc == 3) {
        set3(forgetUnit(w, p, a), { ...s, leave: { ...l, pc: 4 } },
          { ...g, forgotten: g.forgotten.union(Set((p, a, w.gen.get((p, a))))), last: "leave: network forget unit committed", args: [] })
      } else if (l.pc == 4) {
        // forgetListeners: an error is logged and swallowed (service.ts:763-765).
        set3({ ...w, grants: if (l.failListener) w.grants else w.grants.exclude(Set((p, a))) }, { ...s, leave: { ...l, pc: 5 } },
          { ...g, last: if (l.failListener) "leave: OAuth listener failed (swallowed)" else "leave: OAuth grants revoked", args: [] })
      } else if (l.pc == 5) {
        // forgetMembership (pg-store.ts:293-302).
        set3({ ...w, mem: w.mem.set((p, a), "removed") }, { ...s, leave: { ...l, pc: 0 } },
          { ...g, leavePending: g.leavePending.exclude(Set((p, a))), leaveDone: g.leaveDone + 1, last: "leave: membership removed, done", args: [] })
      } else blocked,
    }
  }

  // ------------------------------------------------------------------ delete everything (accounts.ts:432-444)
  action delStart(ph: str): bool = {
    val p = personFor(w, ph)
    all {
      s.del.pc == 0,
      w.phones.get(ph).exists,
      not(w.phones.get(ph).hold),                  // api.ts:628
      p != 0,
      set3(w, { ...s, del: { pc: 1, p: p, ph: ph, left: APPS.filter(a => w.mem.get((p, a)) != "none" and w.mem.get((p, a)) != "removed") } },
        { ...g, delPending: g.delPending.union(Set(p)), last: "delete everything from", args: [ph] }),
    }
  }

  action delStep(a: str): bool = {
    val d = s.del
    val p = d.p
    all {
      d.pc > 0,
      if (d.pc == 1)
        set3({ ...w, floors: w.floors.union(Set(d.ph)) }, { ...s, del: { ...d, pc: 2 } }, { ...g, last: "delete: age floor kept", args: [] })
      else if (d.pc == 2 and d.left.contains(a))
        // onForget per membership: photos, the forget unit, the listeners.
        set3({ ...forgetUnit(w, p, a), photos: w.photos.exclude(Set((p, a))), grants: w.grants.exclude(Set((p, a))) },
          { ...s, del: { ...d, left: d.left.exclude(Set(a)) } },
          { ...g, forgotten: g.forgotten.union(Set((p, a, w.gen.get((p, a))))), last: "delete: forget path for", args: [a] })
      else if (d.pc == 2 and d.left == Set())
        set3(storeDeleteAll(w, p, d.ph), { ...s, del: { ...d, pc: 0 } },
          { ...g, delPending: g.delPending.exclude(Set(p)), erasedPhones: g.erasedPhones.union(Set(d.ph, phoneOf(w, p)).exclude(Set(""))),
            erasedPersons: g.erasedPersons.union(Set(p)), selfDeleted: g.selfDeleted.union(Set(d.ph, phoneOf(w, p)).exclude(Set(""))),
            delDone: g.delDone + 1, last: "delete: store.deleteAll committed, done", args: [] })
      else blocked,
    }
  }

  // ------------------------------------------------------------------ staff hold decision (accounts.ts:194-213)
  action chStart(ph: str, decision: str): bool = {
    val r = w.phones.get(ph)
    all {
      s.ch.pc == 0,
      if (not(r.exists and r.hold))
        set3(w, s, { ...g, last: "POST /holds: not_held (decision, phone)", args: [decision, ph] })
      else if (decision == "same_owner")
        set3(w, { ...s, ch: { pc: 10, ph: ph, p: r.owner, left: Set() } }, { ...g, last: "POST /holds same_owner on", args: [ph] })
      else
        set3(w, { ...s, ch: { pc: 1, ph: ph, p: r.owner, left: APPS.filter(a => w.mem.get((r.owner, a)) != "none" and w.mem.get((r.owner, a)) != "removed") } },
          { ...g, chPending: g.chPending.union(Set(ph)), newOwnerDecided: g.newOwnerDecided.union(Set(ph)), last: "POST /holds new_owner on", args: [ph] }),
    }
  }

  action chStep(a: str): bool = {
    val c = s.ch
    val p = c.p
    all {
      c.pc > 0,
      if (c.pc == 10)
        set3({ ...w, phones: w.phones.set(c.ph, { ...w.phones.get(c.ph), hold: false, holdAt: 0 }) }, { ...s, ch: { ...c, pc: 11 } },
          { ...g, last: "same_owner: setPhoneHold(null)", args: [] })
      else if (c.pc == 11)
        set3({ ...w, phones: w.phones.set(c.ph, { ...w.phones.get(c.ph), lastSeen: w.now }) }, { ...s, ch: { ...c, pc: 0 } },
          { ...g, sameOwnerDone: g.sameOwnerDone + 1, last: "same_owner: touchPhone, done", args: [] })
      else if (c.pc == 1 and c.left.contains(a))
        set3({ ...forgetUnit(w, p, a), photos: w.photos.exclude(Set((p, a))), grants: w.grants.exclude(Set((p, a))) },
          { ...s, ch: { ...c, left: c.left.exclude(Set(a)) } },
          { ...g, forgotten: g.forgotten.union(Set((p, a, w.gen.get((p, a))))), last: "new_owner: forget path for", args: [a] })
      else if (c.pc == 1 and c.left == Set())
        set3(storeDeleteAll(w, p, c.ph), { ...s, ch: { ...c, pc: 2 } }, { ...g, last: "new_owner: store.deleteAll committed", args: [] })
      else if (c.pc == 2)
        set3({ ...w, people: w.people.set(p, { ...w.people.get(p), hash: "" }) }, { ...s, ch: { ...c, pc: 3 } }, { ...g, last: "new_owner: detachPhoneHash", args: [] })
      else if (c.pc == 3)
        set3({ ...w, suppression: w.suppression.exclude(Set(c.ph)) }, { ...s, ch: { ...c, pc: 4 } }, { ...g, last: "new_owner: unsuppress", args: [] })
      else if (c.pc == 4)
        set3({ ...w, floors: w.floors.exclude(Set(c.ph)) }, { ...s, ch: { ...c, pc: 0 } },
          { ...g, chPending: g.chPending.exclude(Set(c.ph)), newOwnerDone: g.newOwnerDone + 1, last: "new_owner: clearAgeFloor, done", args: [] })
      else blocked,
    }
  }

  // ------------------------------------------------------------------ number change (accounts.ts:249-274)
  // mvStart: the code from the new number is verified (verify answers true once): the holder of dst.
  action mvStart(p: int, dst: str): bool = {
    val src = phoneOf(w, p)
    all {
      s.mv.pc == 0,
      src != "", src != dst,
      not(w.phones.get(src).hold), not(stale(w, src)),
      personFor(w, src) == p,
      w.holder.get(dst) == w.humanOf.get(p),
      set3(w, { ...s, mv: { pc: 1, p: p, src: src, dst: dst } }, { ...g, last: "number change: code verified (from, to)", args: [src, dst] }),
    }
  }

  action mvStep: bool = {
    val m = s.mv
    val p = m.p
    all {
      m.pc > 0,
      if (m.pc == 1) {
        // Under the join lock of dst: ban checks, findPhone(dst), then movePhone in one transaction.
        if (bannedPh(w, m.src, p) or codeBanned(w, m.dst, 0) or w.phones.get(m.dst).exists)
          set3(w, { ...s, mv: { ...m, pc: 0 } }, { ...g, last: "number change refused in the lock", args: [] })
        else if (not(w.phones.get(m.src).exists and w.phones.get(m.src).owner == p))
          // pg-store.ts:343-344: the old phone row is gone (a delete committed first): "no_phone", nothing moves.
          set3(w, { ...s, mv: { ...m, pc: 0 } }, { ...g, last: "movePhone: no_phone, nothing moved", args: [] })
        else if (w.cloudGrant.contains(m.src))
          // oauth.sql:66-71 keep_cloud_grant_authority raises on the phone_key update (pg-store.ts:373): rollback.
          set3(w, { ...s, mv: { ...m, pc: 0 } }, { ...g, moveFailedAfterCode: true, last: "movePhone: Cloud grant trigger raises, rollback (500)", args: [] })
        else {
          val copied = w.ledger.filter(e => e.ph == m.src).map(e => { ...e, ph: m.dst })
          set3({
            ...w,
            phones: w.phones.set(m.dst, { exists: true, owner: p, hold: false, holdAt: 0, lastSeen: w.now }).set(m.src, NO_PHONE),
            ledger: w.ledger.filter(e => e.ph != m.src).union(copied),
            people: w.people.set(p, { ...w.people.get(p), hash: m.dst }),
            floors: if (w.floors.contains(m.src)) w.floors.exclude(Set(m.src)).union(Set(m.dst)) else w.floors,
            // eliza_notices: the statements use the phone: hash, the rows use the eliza_notice: hash (no effect).
          }, { ...s, mv: { ...m, pc: 2 } },
          { ...g, everVerified: g.everVerified.set(p, g.everVerified.get(p).union(Set(m.dst))), selfDeleted: g.selfDeleted.exclude(Set(m.dst)),
            last: "movePhone committed", args: [] })
        }
      } else if (m.pc == 2)
        set3({ ...w, suppression: w.suppression.exclude(Set(m.dst)) }, { ...s, mv: { ...m, pc: 3 } }, { ...g, last: "number change: unsuppress new number", args: [] })
      else if (m.pc == 3)
        set3(w, { ...s, mv: { ...m, pc: 0 } }, { ...g, moveDone: g.moveDone + 1, last: "number change: age floor folded, listeners, done", args: [] })
      else blocked,
    }
  }

  // ------------------------------------------------------------------ under-13 decline in chat (service.ts:1292-1310)
  // The Network declines the member in its unit (forget of this app's member commits), then statedAge.
  action u13Start(ph: str, a: str): bool = {
    val p = personFor(w, ph)
    all {
      s.u13.pc == 0,
      p != 0,
      w.net.get((p, a)) == "active",
      set3(forgetUnit(w, p, a), { ...s, u13: { pc: 1, p: p, ph: ph, app: a, left: APPS.filter(b => LIVE_MEM.contains(w.mem.get((p, b))) or w.mem.get((p, b)) == "invited") } },
        { ...g, forgotten: g.forgotten.union(Set((p, a, w.gen.get((p, a))))), last: "under-13 decline: unit forgets the member", args: [a] }),
    }
  }

  action u13Step(b: str): bool = {
    val u = s.u13
    val p = u.p
    all {
      u.pc > 0,
      if (u.pc == 1)
        // recordAge -> ageLowered (< 18): every photo and rating goes (service.ts:779).
        set3({ ...w, floors: w.floors.union(Set(u.ph)), photos: w.photos.filter(k => k._1 != p), ratings: w.ratings.exclude(Set(p)) },
          { ...s, u13: { ...u, pc: 2 } }, { ...g, last: "under-13: recordAge", args: [] })
      else if (u.pc == 2 and u.left.contains(b)) {
        // forget (other apps), forgetMembership, consent: no onForget hook, so no OAuth listener.
        val w1 = if (b != u.app) forgetUnit(w, p, b) else w
        set3(addEv({ ...w1, mem: w1.mem.set((p, b), "removed") }, u.ph, b, true, w.now), { ...s, u13: { ...u, left: u.left.exclude(Set(b)) } },
          { ...g, forgotten: if (b != u.app) g.forgotten.union(Set((p, b, w.gen.get((p, b))))) else g.forgotten, last: "under-13: forgotten and removed", args: [b] })
      } else if (u.pc == 2 and u.left == Set())
        set3(w, { ...s, u13: { ...u, pc: 0 } }, { ...g, u13Done: g.u13Done + 1, last: "under-13: done", args: [] })
      else blocked,
    }
  }

  // ------------------------------------------------------------------ crash: the process stops; the saga is lost
  action crash(which: str): bool = all {
    s.crashes < MAX_CRASH,
    if (which == "ban") all { s.ban.pc > 0, set3(w, { ...s, ban: { ...s.ban, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during ban", args: [] }) }
    else if (which == "leave") all { s.leave.pc > 0, set3(w, { ...s, leave: { ...s.leave, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during leave", args: [] }) }
    else if (which == "del") all { s.del.pc > 0, set3(w, { ...s, del: { ...s.del, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during delete", args: [] }) }
    else if (which == "ch") all { s.ch.pc > 0, set3(w, { ...s, ch: { ...s.ch, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during clearHold", args: [] }) }
    else if (which == "mv") all { s.mv.pc > 0, set3(w, { ...s, mv: { ...s.mv, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during number change", args: [] }) }
    else all { s.u13.pc > 0, set3(w, { ...s, u13: { ...s.u13, pc: 0 }, crashes: s.crashes + 1 }, { ...g, last: "crash during under-13 decline", args: [] }) },
  }

  // ------------------------------------------------------------------ step
  action envStep = {
    nondet p = PERSONS.oneOf()
    nondet a = APPS.oneOf()
    nondet ph = PHONES.oneOf()
    nondet h = HUMANS.oneOf()
    any {
      tick,
      reassign(ph, h),
      inbound(ph, a),
      join(ph, a),
      sendProactive(p, a),
      matchRun(p, a),
      connReceipt(p),
      uploadPhoto(p),
      photoRead(p),
      photoWrite(p),
      exportReq(ph, a),
    }
  }

  action stopStep = {
    nondet ph = PHONES.oneOf()
    any {
      stopRecv(ph),
      all { w.pendingStops != Set(), nondet m = w.pendingStops.oneOf() stopCommit(m) },
    }
  }

  action sagaStart = {
    nondet p = PERSONS.oneOf()
    nondet a = APPS.oneOf()
    nondet ph = PHONES.oneOf()
    nondet scope = Set("phone", "person").oneOf()
    nondet decision = Set("same_owner", "new_owner").oneOf()
    nondet fl = Set(false, true).oneOf()
    any {
      banStart(p, scope),
      leaveText(ph, a),
      leaveApi(ph, a, fl),
      delStart(ph),
      chStart(ph, decision),
      mvStart(p, ph),
      u13Start(ph, a),
    }
  }

  action sagaProgress = {
    nondet a = APPS.oneOf()
    any { banStep(a), leaveStep, delStep(a), chStep(a), mvStep, u13Step(a) }
  }

  action step = {
    nondet which = Set("ban", "leave", "del", "ch", "mv", "u13").oneOf()
    any {
      envStep,
      stopStep,
      sagaStart,
      sagaProgress,
      sagaProgress,
      crash(which),
      stutter,
    }
  }

  // ------------------------------------------------------------------ run tests (concrete traces)
  action init0 = initWith(Set(), "h1", false, false)

  // SD-005: rows are written, the process stops, the staff retry is refused as already_banned and the
  // memberships stay active (service.ts:1742-1743).
  run banCrashRetryRefusedTest =
    init0
      .then(banStart(1, "person"))
      .then(banStep("slop"))
      .then(crash("ban"))
      .then(banStart(1, "person"))
      .expect(g.banRefused == 1 and s.ban.pc == 0 and w.mem.get((1, "slop")) == "active" and not(bannedNotMatchable) and not(retryCompletes))

  // A ban with no crash: every membership restricted, the Network holds both members.
  run banCompletesTest =
    init0
      .then(banStart(1, "person"))
      .then(banStep("slop")).then(banStep("slop")).then(banStep("slop")).then(banStep("slop"))
      .then(banStep("slop")).then(banStep("peon")).then(banStep("slop"))
      .expect(g.banDone == 1 and bannedNotMatchable and w.mem.get((1, "peon")) == "restricted" and w.netBanned.contains((1, "slop")))

  // SD-017: YES PHOTOS reads `active`, the ban restricts, the photo write restores `active`.
  run photoOverwritesBanTest =
    init0
      .then(photoRead(1))
      .then(banStart(1, "person"))
      .then(banStep("slop")).then(banStep("slop")).then(banStep("slop")).then(banStep("slop"))
      .then(banStep("slop")).then(banStep("peon")).then(banStep("slop"))
      .then(photoWrite(1))
      .expect(w.mem.get((1, "slop")) == "active" and not(bannedNotMatchable))

  // SD-029: leave by text; crash after the forget unit; the membership reads active with no member, and
  // the next "leave slop" no longer routes to a member.
  run leaveCrashTest =
    init0
      .then(leaveText("A", "slop"))
      .then(leaveStep).then(leaveStep).then(leaveStep)
      .then(crash("leave"))
      .expect(w.mem.get((1, "slop")) == "active" and w.net.get((1, "slop")) == "removed" and not(leaveRetryOk(1, "slop")) and not(pairAgrees))

  // SD-016: new_owner crashes after store.deleteAll; the retry answers not_held; a join of the new owner
  // revives the old owner's person.
  run newOwnerCrashTest =
    init0
      .then(tick).then(tick).then(tick)
      .then(reassign("A", "h2"))
      .then(inbound("A", "slop"))
      .then(chStart("A", "new_owner"))
      .then(chStep("slop")).then(chStep("peon")).then(chStep("slop"))
      .then(crash("ch"))
      .then(chStart("A", "new_owner"))
      .then(join("A", "slop"))
      .expect(g.revivedForOther and not(retryCompletes) and w.humanOf.get(1) == "h2")

  // SD-381: same_owner clears the hold; a message in the gap holds the number again; touch follows.
  run sameOwnerReholdTest =
    init0
      .then(tick).then(tick).then(tick)
      .then(inbound("A", "slop"))
      .then(chStart("A", "same_owner"))
      .then(chStep("slop"))
      .then(inbound("A", "slop"))
      .then(chStep("slop"))
      .expect(w.phones.get("A").hold and not(holdMeansSilent))

  // SD-055: STOP from the old number is received, the move commits, the STOP lands on the old number.
  run stopDuringMoveTest =
    init0
      .then(stopRecv("A"))
      .then(mvStart(1, "B"))
      .then(mvStep)
      .then(stopCommit({ ph: "A", at: 0, owner: 1, h: "h1" }))
      .expect(not(resolvedOut(w, "B", "slop")) and not(stopFollowsPerson))

  // SD-056: a phone ban reads hash A, the move commits, the ban row names A only.
  run phoneBanDuringMoveTest =
    init0
      .then(banStart(1, "phone"))
      .then(mvStart(1, "B"))
      .then(mvStep)
      .then(banStep("slop"))
      .expect(not(codeBanned(w, "B", 1)) and not(banCoversPerson))

  // SD-492: the person moves A -> B, is banned by person, then joins from A (still theirs) as a new person.
  run banAfterMoveTest =
    init0
      .then(mvStart(1, "B")).then(mvStep).then(mvStep).then(mvStep)
      .then(banStart(1, "person"))
      .then(banStep("slop"))
      .then(join("A", "peon"))
      .expect(w.people.get(2).live and w.mem.get((2, "peon")) == "active" and not(banCoversOldNumbers))

  // SD-098: the number is silent past the stale period, the carrier gives it to h2, a proactive text goes.
  run staleSendTest =
    init0
      .then(tick).then(tick).then(tick)
      .then(reassign("A", "h2"))
      .then(sendProactive(1, "slop"))
      .expect(g.wrongHuman)

  // SD-092: one proactive text, then delete everything: the line row keeps the plain number.
  run deleteKeepsLineRowTest =
    init0
      .then(sendProactive(1, "slop"))
      .then(delStart("A"))
      .then(delStep("slop")).then(delStep("slop")).then(delStep("peon")).then(delStep("slop"))
      .expect(g.delDone == 1 and w.lineRows.contains("A") and not(noPlainPhoneAfterDelete) and deleteKeepsSafety)

  // SD-108: a Cloud grant on the old number makes movePhone raise after the code was used.
  run cloudGrantMoveTest =
    initWith(Set(), "h1", true, false)
      .then(mvStart(1, "B"))
      .then(mvStep)
      .expect(g.moveFailedAfterCode and w.phones.get("A").exists)

  // A clean number change: one transaction moves the phone, consent and floor (witness for the move).
  run moveCleanTest =
    init0
      .then(mvStart(1, "B")).then(mvStep).then(mvStep).then(mvStep)
      .expect(g.moveDone == 1 and phoneOf(w, 1) == "B" and w.floors.contains("B") and not(resolvedOut(w, "B", "slop")) and not(noticeFollowsMove))

  // Q-identity_sagas-1: B was suppressed by an earlier owner's delete; the move commits and the process
  // stops before unsuppress: a live member's number stays suppressed, and no path lifts it.
  run moveCrashSuppressedTest =
    initWith(Set(), "h1", false, true)
      .then(mvStart(1, "B")).then(mvStep)
      .then(crash("mv"))
      .then(join("B", "slop"))
      .expect(w.suppression.contains("B") and not(liveNumberNotSuppressed))

  // Q-identity_sagas-2: delete everything (session on A) and a number change to B run at the same time.
  // movePhone commits first; store.deleteAll suppresses A and deletes A's consent rows, but the person's
  // number is now B: B is not suppressed and keeps the copied consent rows with the plain number.
  run deleteDuringMoveTest =
    init0
      .then(mvStart(1, "B"))
      .then(delStart("A"))
      .then(mvStep)
      .then(delStep("slop")).then(delStep("slop")).then(delStep("peon")).then(delStep("slop"))
      .expect(g.delDone == 1 and not(w.suppression.contains("B")) and w.ledger.exists(e => e.ph == "B")
              and not(deleteKeepsSafety) and not(noPlainPhoneAfterDelete))

  // SD-026: a legacy row for A; the member moves to B; A goes to h2; h2's text reaches the member.
  run legacyRouteTest =
    initWith(Set(("A", 1, "slop")), "h1", false, false)
      .then(mvStart(1, "B")).then(mvStep).then(mvStep).then(mvStep)
      .then(reassign("A", "h2"))
      .then(inbound("A", "slop"))
      .expect(g.misrouted)

  // SD-275 / SD-256: a banned person leaves slop by text: the safety photos go.
  run bannedLeaveDeletesPhotosTest =
    init0
      .then(banStart(1, "person"))
      .then(banStep("slop")).then(banStep("slop")).then(banStep("slop")).then(banStep("slop"))
      .then(banStep("slop")).then(banStep("peon")).then(banStep("slop"))
      .then(leaveText("A", "slop"))
      .then(leaveStep).then(leaveStep)
      .expect(not(w.photos.contains((1, "slop"))) and not(banKeepsPhotos))

  // SD-178: a banned person deletes everything with a fresh login (api.ts:626-636 has no ban check):
  // the photos the ban kept for the safety team go.
  run bannedDeleteTest =
    init0
      .then(banStart(1, "person"))
      .then(banStep("slop")).then(banStep("slop")).then(banStep("slop")).then(banStep("slop"))
      .then(banStep("slop")).then(banStep("peon")).then(banStep("slop"))
      .then(delStart("A"))
      .then(delStep("slop")).then(delStep("slop")).then(delStep("peon")).then(delStep("slop"))
      .expect(g.delDone == 1 and not(w.photos.contains((1, "slop"))) and not(banKeepsPhotos))

  // SD-051: h2 holds A (silent, recycled), sends STOP, then a text puts A on hold; new_owner erases the STOP.
  run newOwnerErasesStopTest =
    init0
      .then(tick).then(tick).then(tick)
      .then(reassign("A", "h2"))
      .then(stopRecv("A"))
      .then(stopCommit({ ph: "A", at: 3, owner: 1, h: "h2" }))
      .then(inbound("A", "slop"))
      .then(chStart("A", "new_owner"))
      .then(chStep("slop")).then(chStep("peon")).then(chStep("slop"))
      .then(chStep("slop")).then(chStep("slop")).then(chStep("slop"))
      .expect(g.newOwnerDone == 1 and not(resolvedOut(w, "A", "slop")) and not(holderStopRespected))

  // SD-089: an under-13 decline removes both memberships and leaves the MCP grants.
  run u13GrantsTest =
    init0
      .then(u13Start("A", "slop"))
      .then(u13Step("slop")).then(u13Step("slop")).then(u13Step("peon")).then(u13Step("slop"))
      .expect(g.u13Done == 1 and w.grants.contains((1, "peon")) and not(forgetRevokesGrants))
}
