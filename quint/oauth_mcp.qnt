// quint-check: max-steps=60 max-samples=10000 verify-steps=8
//
// Model of the MCP OAuth server and its tools: packages/mcp/src/handler.ts (H), tools.ts (T),
// pg-store.ts (P), hooks.ts (K), and the parts of packages/network/service/service.ts (SVC) and
// packages/notify/src/scheduler.ts that the tools call. Module plan: docs/research/2026-11-07-state-machines.md
// section 6.11. Source report: docs/research/state-machines/mcp-oauth.md.
//
// Machines in this model: oauth-auth-request, oauth-grant, oauth-code, oauth-token-family,
// cloud-grant-authority (as an oracle), mcp-request-gate, grant-owner-binding, signup-draft,
// output-leak-gate, inbox-read-seen, assistant-surface-signal, submit-profile-intake,
// oauth-client-lifecycle, oauth-forget-revoke, oauth-phone-move, oauth-sweep-retention.
// Not in this model: openai-surface-gate (a boolean config table; no app here is slop), skill-signup
// (agent text, see SD-058 in the findings file).
//
// Abstractions (hand-written):
//  - Each Postgres statement or transaction is one action. Each `await` between two statements is a
//    point where a process can stop (a crash action) or another actor can run.
//  - A grant gets the id of the auth request it came from (each request gives at most one grant,
//    P:110-112 takeConsentRequest). Each grant has its one code (H:538-540).
//  - Time: grants, codes and tokens expire by nondeterministic clock actions. Auth requests have an
//    age in 5-minute ticks, because the README gives a minute limit for them (SD-393).
//  - Cloud validation is an oracle: a Cloud grant is valid only while its owner is the consent person,
//    not banned and not on hold (API:671-688). "unavailable" writes no state (INV-CA3), so it is left out.
//  - Revocation and its audit row are one action on every path that writes the row; the tool path
//    (H:852-853) writes no row. A crash between revokeGrant and audit is not modelled.
//  - The leak gate (leaks.ts) is an oracle: each inbox item has a nondeterministic `leaky` flag.
module oauth_mcp {

  // ---------------------------------------------------------------- constants
  pure val PERSONS = Set("p1", "p2")
  pure val PHONES = Set("n1", "n2")
  pure val APPS = Set("friends", "peon")
  pure val CLIENTS = Set("cF", "cP")
  /** The app a client registered on (H:313; every grant of a client is for this app). */
  pure def clientApp(c: str): str = if (c == "cF") "friends" else "peon"
  pure val REQS = Set(1, 2, 3)
  pure val ITEMS = Set(1, 2)
  pure val NONE = "none"
  /** TTL.requestMs = 15 minutes = 3 ticks (H:73). */
  pure val REQ_TTL = 3
  /** packages/mcp/README.md section 3: "at most 10 minutes" = 2 ticks. */
  pure val README_REQ_MAX = 2
  /** PROFILES_PER_GRANT_DAY (H:99), scaled down from 5 to 2 to keep the state small. */
  pure val PROFILE_CAP = 2
  pure val MAX_TOKENS = 8

  // ---------------------------------------------------------------- types
  type Req = { live: bool, step: str, phone: str, person: str, client: str, age: int }
  type Grant = { st: str, expired: bool, phone: str, person: str, app: str, client: str, cloud: bool }
  type Code = { st: str, expired: bool }
  type Tok = { g: int, kind: str, origin: str, rotated: bool, revoked: bool, expired: bool }
  type Client = { exists: bool, old: bool }
  type Draft = { exists: bool, phone: str, scrubbed: bool }
  type Quota = { count: int, accepted: int }
  type Item = { live: bool, person: str, app: str, kind: str, seen: bool, oppOpen: bool, leaky: bool }
  type Effect = { kind: str, person: str, grant: int, ok: bool, status: str, items: Set[int] }

  type OAuth = {
    reqs: int -> Req, grants: int -> Grant, codes: int -> Code, toks: int -> Tok, nextTok: int,
    clients: str -> Client, drafts: int -> Draft, quota: int -> Quota,
  }
  type Platform = {
    owner: str -> str, banned: Set[str], holdNum: Set[str], netHeld: Set[(str, str)], minor: Set[str],
    deleted: Set[str],
    member: (str, str) -> str, forgotten: Set[(str, str)],
  }
  type Inbox = { items: int -> Item, active: Set[str] }
  type Procs = { appr: int -> str, deny: int -> str, exch: int -> str, refr: int -> str }
  type Ghost = {
    audits: Set[(str, int)], granted: Set[int], denied: Set[int], everGranted: Set[str],
    revokedEver: Set[int], last: Effect,
  }

  // ---------------------------------------------------------------- state
  var oa: OAuth
  var pf: Platform
  var ib: Inbox
  var pc: Procs
  var gh: Ghost

  pure val NO_EFFECT: Effect = { kind: "none", person: NONE, grant: 0, ok: true, status: "", items: Set() }
  pure def eff(kind: str, person: str, g: int, ok: bool): Effect =
    { kind: kind, person: person, grant: g, ok: ok, status: "", items: Set() }

  // ---------------------------------------------------------------- helpers (platform reads)
  /** K:175-177 personForKey: null when the number is on hold or has no live person. */
  def personForKey(p: Platform, n: str): str = if (p.holdNum.contains(n)) NONE else p.owner.get(n)
  /** K:167-170 login: "held" when banned or on hold. */
  def login(p: Platform, n: str): str =
    if (p.holdNum.contains(n) or p.banned.contains(p.owner.get(n))) "held" else p.owner.get(n)
  /** K:195-200 status -> publicStatus (K:76-87). */
  def statusOf(p: Platform, person: str, app: str): str =
    if (person == NONE) "not_joined" else {
      val m = p.member.get((person, app))
      if (m == "active") "active" else if (m == "paused") "stopped" else if (m == "restricted") "on_hold"
      else if (m == "invited") "invited" else "not_joined"
    }
  /** T:249-251 grantStillTheirs. */
  pure def stillTheirs(atConsent: str, now: str): bool = if (atConsent == NONE) now == NONE else now == atConsent
  def liveG(o: OAuth, g: int): bool = o.grants.get(g).st == "live" and not(o.grants.get(g).expired)
  /** H:735-744 cloudGrantCurrent as an oracle; legacy grants are "valid" with no call (H:736). */
  def cloudValid(o: OAuth, p: Platform, g: int): bool = {
    val gr = o.grants.get(g)
    not(gr.cloud) or (personForKey(p, gr.phone) == gr.person and not(p.banned.contains(gr.person)))
  }

  // ---------------------------------------------------------------- helpers (writes)
  /** P:128-135 revokeGrant: grant, its tokens and its draft payload in one transaction. */
  def revokeOa(o: OAuth, g: int): OAuth = {
    ...o,
    grants: o.grants.setBy(g, x => if (x.st == "live") { ...x, st: "revoked" } else x),
    toks: o.toks.keys().mapBy(t => { val k = o.toks.get(t); if (k.g == g) { ...k, revoked: true } else k }),
    drafts: o.drafts.setBy(g, d => { ...d, scrubbed: true }),
  }
  /** H:175-179: revokeGrant tells the inbox active=false for the grant's person (keyed by person and surface). */
  def unlink(act: Set[str], o: OAuth, g: int): Set[str] = {
    val gr = o.grants.get(g)
    if (gr.st == "live" and gr.person != NONE) act.exclude(Set(gr.person)) else act
  }
  def revokedEverAfter(h: Ghost, o: OAuth, g: int): Set[int] =
    if (o.grants.get(g).st == "live") h.revokedEver.union(Set(g)) else h.revokedEver
  def phonesOf(p: Platform, person: str): Set[str] = PHONES.filter(n => p.owner.get(n) == person)

  // ---------------------------------------------------------------- init
  action init = all {
    oa' = {
      reqs: REQS.mapBy(r => { live: false, step: "none", phone: "", person: NONE, client: "", age: 0 }),
      grants: REQS.mapBy(g => { st: "none", expired: false, phone: "", person: NONE, app: "", client: "", cloud: false }),
      codes: REQS.mapBy(g => { st: "none", expired: false }),
      toks: Map(),
      nextTok: 1,
      clients: CLIENTS.mapBy(c => { exists: true, old: false }),
      drafts: REQS.mapBy(g => { exists: false, phone: "", scrubbed: false }),
      quota: REQS.mapBy(g => { count: 0, accepted: 0 }),
    },
    pf' = {
      owner: Map("n1" -> "p1", "n2" -> NONE),
      banned: Set(), holdNum: Set(), netHeld: Set(), minor: Set(), deleted: Set(),
      member: tuples(PERSONS, APPS).mapBy(k => if (k._1 == "p1") "active" else "none"),
      forgotten: Set(),
    },
    ib' = {
      items: ITEMS.mapBy(i => { live: false, person: NONE, app: "", kind: "", seen: false, oppOpen: false, leaky: false }),
      active: Set(),
    },
    pc' = { appr: REQS.mapBy(r => "idle"), deny: REQS.mapBy(r => "idle"), exch: REQS.mapBy(g => "idle"), refr: Map() },
    gh' = { audits: Set(), granted: Set(), denied: Set(), everGranted: Set(), revokedEver: Set(), last: NO_EFFECT },
  }

  // ---------------------------------------------------------------- oauth-auth-request
  /** H:355-388 GET /oauth/authorize: one row, step phone. An unknown (swept) client gets an error page (H:362). */
  action startAuth(r: int, c: str): bool = all {
    not(oa.reqs.get(r).live), oa.reqs.get(r).step == "none", pc.appr.get(r) == "idle",
    if (oa.clients.get(c).exists) all {
      oa' = { ...oa, reqs: oa.reqs.set(r, { live: true, step: "phone", phone: "", person: NONE, client: c, age: 0 }) },
      gh' = { ...gh, last: eff("authorize", NONE, r, true) },
    } else all {
      oa' = oa,
      gh' = { ...gh, last: eff("clientUnknown", NONE, r, false) },
    },
    pf' = pf, ib' = ib, pc' = pc,
  }

  /** H:456-472 POST /authorize/phone: startOtp, then updateAuthRequest(e164, step code). */
  action enterPhone(r: int, n: str): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "phone" or q.step == "code",
      oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, phone: n, step: "code" }) },
      pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("phone", NONE, r, true) },
    }
  }

  /** H:475-490 POST /authorize/code: verifyOtp (oracle: the person types the right code), login, step consent. */
  action enterCode(r: int): bool = all {
    val q = oa.reqs.get(r)
    val who = login(pf, q.phone)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "code",
      if (who == "held") all {
        // H:480-484: held or banned: the request is deleted.
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, live: false }) },
        pf' = pf,
      } else all {
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, person: who, step: "consent" }) },
        // Model bookkeeping: a person who connects again after a forget starts a new consent.
        pf' = { ...pf, forgotten: pf.forgotten.exclude(Set((q.phone, clientApp(q.client)))) },
      },
      ib' = ib, pc' = pc, gh' = { ...gh, last: eff("code", who, r, who != "held") },
    }
  }

  /** H:495-532 approve: session and owner checks, Cloud oracle, then takeConsentRequest (P:109-114). */
  action approveTake(r: int, cloud: bool): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "consent", pc.appr.get(r) == "idle",
      login(pf, q.phone) != "held", login(pf, q.phone) == q.person,
      // Cloud authority (H:507-511) needs a current owner; legacy grants need nothing more.
      not(cloud) or (q.person != NONE and not(pf.banned.contains(q.person))),
      oa' = { ...oa,
        reqs: oa.reqs.set(r, { ...q, live: false }),
        grants: oa.grants.setBy(r, x => { ...x, phone: q.phone, person: q.person, app: clientApp(q.client), client: q.client, cloud: cloud }) },
      pc' = { ...pc, appr: pc.appr.set(r, "taken") },
      pf' = pf, ib' = ib, gh' = { ...gh, last: eff("approveTake", q.person, r, true) },
    }
  }
  /** H:536 putGrant. oauth.sql:38 grants.client_id references clients: a swept client makes the insert fail (500). */
  action approvePutGrant(r: int): bool = all {
    pc.appr.get(r) == "taken",
    if (oa.clients.get(oa.grants.get(r).client).exists) all {
      oa' = { ...oa, grants: oa.grants.setBy(r, x => { ...x, st: "live" }) },
      pc' = { ...pc, appr: pc.appr.set(r, "granted") },
      gh' = { ...gh, granted: gh.granted.union(Set(r)), everGranted: gh.everGranted.union(Set(oa.grants.get(r).client)),
              last: eff("putGrant", oa.grants.get(r).person, r, true) },
    } else all {
      oa' = oa, pc' = { ...pc, appr: pc.appr.set(r, "failed") }, gh' = { ...gh, last: eff("putGrant", NONE, r, false) },
    },
    pf' = pf, ib' = ib,
  }
  /** H:537 linked(grant, true): active=true, only for a grant with a person (H:170). */
  action approveLink(r: int): bool = all {
    pc.appr.get(r) == "granted",
    val p = oa.grants.get(r).person
    ib' = { ...ib, active: if (p != NONE) ib.active.union(Set(p)) else ib.active },
    pc' = { ...pc, appr: pc.appr.set(r, "linked") },
    oa' = oa, pf' = pf, gh' = { ...gh, last: eff("link", oa.grants.get(r).person, r, true) },
  }
  /** H:538-540 putCode. */
  action approvePutCode(r: int): bool = all {
    pc.appr.get(r) == "linked",
    oa' = { ...oa, codes: oa.codes.set(r, { st: "issued", expired: false }) },
    pc' = { ...pc, appr: pc.appr.set(r, "coded") },
    pf' = pf, ib' = ib, gh' = { ...gh, last: eff("putCode", NONE, r, true) },
  }
  /** H:541-543 the two audit rows and the 303 with the code. */
  action approveAudit(r: int): bool = all {
    pc.appr.get(r) == "coded",
    gh' = { ...gh, audits: gh.audits.union(Set(("consent_granted", r))), last: eff("approved", NONE, r, true) },
    pc' = { ...pc, appr: pc.appr.set(r, "done") },
    oa' = oa, pf' = pf, ib' = ib,
  }

  /** H:445-451 liveRequest read of a cancel or a non-approve consent POST. */
  action denyRead(r: int): bool = all {
    oa.reqs.get(r).live, oa.reqs.get(r).age < REQ_TTL, oa.clients.get(oa.reqs.get(r).client).exists, pc.deny.get(r) == "idle",
    pc' = { ...pc, deny: pc.deny.set(r, "read") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("denyRead", NONE, r, true) },
  }
  /** H:518-520: delete with no row check, audit consent_denied, redirect access_denied. */
  action denyFinish(r: int): bool = all {
    pc.deny.get(r) == "read",
    oa' = { ...oa, reqs: oa.reqs.setBy(r, q => { ...q, live: false }) },
    pc' = { ...pc, deny: pc.deny.set(r, "done") },
    gh' = { ...gh, audits: gh.audits.union(Set(("consent_denied", r))), denied: gh.denied.union(Set(r)), last: eff("denied", NONE, r, true) },
    pf' = pf, ib' = ib,
  }

  /** The clock: each live request gets one tick older (5 minutes). */
  action tickRequests = all {
    oa.reqs.keys().exists(r => oa.reqs.get(r).live and oa.reqs.get(r).age < REQ_TTL + 1),
    oa' = { ...oa, reqs: oa.reqs.keys().mapBy(r => { val q = oa.reqs.get(r); if (q.live and q.age < REQ_TTL + 1) { ...q, age: q.age + 1 } else q }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("tick", NONE, 0, true) },
  }

  // ---------------------------------------------------------------- oauth-code: exchange (H:571-607)
  /** H:572-595: code unused, unexpired, grant live, Cloud valid. No owner and no ban check. */
  action exchCheck(g: int): bool = all {
    oa.codes.get(g).st == "issued", not(oa.codes.get(g).expired), liveG(oa, g), cloudValid(oa, pf, g),
    pc.exch.get(g) == "idle",
    pc' = { ...pc, exch: pc.exch.set(g, "checked") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("exchCheck", NONE, g, true) },
  }
  /** H:596 takeCode commits used_at (P:145-151). */
  action exchTake(g: int): bool = all {
    pc.exch.get(g) == "checked", oa.codes.get(g).st == "issued",
    oa' = { ...oa, codes: oa.codes.setBy(g, c => { ...c, st: "used" }) },
    pc' = { ...pc, exch: pc.exch.set(g, "taken") },
    pf' = pf, ib' = ib, gh' = { ...gh, last: eff("exchTake", NONE, g, true) },
  }
  /** H:605 first putToken (access). No grant check. */
  action exchTok1(g: int): bool = all {
    pc.exch.get(g) == "taken", oa.nextTok <= MAX_TOKENS,
    oa' = { ...oa, toks: oa.toks.put(oa.nextTok, { g: g, kind: "access", origin: "code", rotated: false, revoked: false, expired: false }), nextTok: oa.nextTok + 1 },
    pc' = { ...pc, exch: pc.exch.set(g, "tok1") },
    pf' = pf, ib' = ib, gh' = { ...gh, last: eff("exchTok1", NONE, g, true) },
  }
  /** H:605-607 second putToken (refresh), audit token_issued, 200 to the client. */
  action exchTok2(g: int): bool = all {
    pc.exch.get(g) == "tok1", oa.nextTok <= MAX_TOKENS,
    oa' = { ...oa, toks: oa.toks.put(oa.nextTok, { g: g, kind: "refresh", origin: "code", rotated: false, revoked: false, expired: false }), nextTok: oa.nextTok + 1 },
    pc' = { ...pc, exch: pc.exch.set(g, "done"), refr: pc.refr.put(oa.nextTok, "idle") },
    pf' = pf, ib' = ib, gh' = { ...gh, audits: gh.audits.union(Set(("token_issued", g))), last: eff("tokens", oa.grants.get(g).person, g, true) },
  }
  /**
   * H:575-580 (and H:598-602): a client presents a used code. The grant is revoked as a replay.
   * Model ghost: the replay is true when an earlier exchange of this code completed or is still in flight.
   */
  action exchReplay(g: int): bool = all {
    oa.codes.get(g).st == "used", not(oa.codes.get(g).expired),
    val trueReplay = Set("taken", "tok1", "done").contains(pc.exch.get(g))
    all {
      oa' = revokeOa(oa, g),
      ib' = { ...ib, active: unlink(ib.active, oa, g) },
      gh' = { ...gh, audits: gh.audits.union(Set(("revoked", g), ("code_replay", g))), revokedEver: revokedEverAfter(gh, oa, g),
              last: eff("replay", NONE, g, trueReplay) },
    },
    pf' = pf, pc' = pc,
  }

  // ---------------------------------------------------------------- oauth-token-family: refresh (H:610-634)
  /** H:611-626: token unrevoked, unexpired, grant live, Cloud valid. A rotated token passes here. */
  action refrCheck(t: int): bool = all {
    oa.toks.keys().contains(t),
    val k = oa.toks.get(t)
    all {
      k.kind == "refresh", not(k.revoked), not(k.expired), liveG(oa, k.g), cloudValid(oa, pf, k.g),
      pc.refr.keys().contains(t), pc.refr.get(t) == "idle",
    },
    pc' = { ...pc, refr: pc.refr.set(t, "checked") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("refrCheck", NONE, oa.toks.get(t).g, true) },
  }
  /**
   * H:628-633 and P:164-182 rotateRefresh: one transaction that locks the grant. False for a rotated
   * token, and also for a revoked, expired or deleted grant; the handler treats every false as a replay.
   */
  action refrRotate(t: int): bool = all {
    pc.refr.keys().contains(t), oa.toks.keys().contains(t), pc.refr.get(t) == "checked",
    val k = oa.toks.get(t)
    val g = k.g
    val gr = oa.grants.get(g)
    val rotates = not(k.rotated) and not(k.revoked) and gr.st == "live" and not(gr.expired)
    if (rotates and oa.nextTok + 1 <= MAX_TOKENS) all {
      oa' = { ...oa,
        toks: oa.toks.set(t, { ...k, rotated: true })
          .put(oa.nextTok, { g: g, kind: "access", origin: "refresh", rotated: false, revoked: false, expired: false })
          .put(oa.nextTok + 1, { g: g, kind: "refresh", origin: "refresh", rotated: false, revoked: false, expired: false }),
        nextTok: oa.nextTok + 2 },
      pc' = { ...pc, refr: pc.refr.set(t, "idle").put(oa.nextTok + 1, "idle") },
      ib' = ib,
      gh' = { ...gh, audits: gh.audits.union(Set(("token_refreshed", g))), last: eff("refresh", gr.person, g, true) },
    } else if (not(rotates)) all {
      // A true replay: this token was rotated before (that rotation completed). Every other false is not.
      oa' = revokeOa(oa, g),
      pc' = { ...pc, refr: pc.refr.set(t, "idle") },
      ib' = { ...ib, active: unlink(ib.active, oa, g) },
      gh' = { ...gh, audits: gh.audits.union(Set(("revoked", g), ("refresh_replay", g))), revokedEver: revokedEverAfter(gh, oa, g),
              last: eff("replay", NONE, g, k.rotated) },
    } else all {
      oa' = oa, pc' = { ...pc, refr: pc.refr.set(t, "idle") }, ib' = ib, gh' = gh,
    },
    pf' = pf,
  }

  // ---------------------------------------------------------------- revocation by the client and the person
  /** H:639-656 /oauth/revoke with a refresh token: the grant ends, with an audit row. */
  action revokeEndpoint(t: int): bool = all {
    oa.toks.keys().contains(t), oa.toks.get(t).kind == "refresh",
    val g = oa.toks.get(t).g
    all {
      oa' = revokeOa(oa, g),
      ib' = { ...ib, active: unlink(ib.active, oa, g) },
      gh' = { ...gh, audits: gh.audits.union(Set(("revoked", g))), revokedEver: revokedEverAfter(gh, oa, g), last: eff("revoke", NONE, g, true) },
    },
    pf' = pf, pc' = pc,
  }
  /** H:660-675 /oauth/consents/revoke by the person: audit only when revokeGrant returned true. */
  action consentsRevoke(g: int): bool = all {
    oa.grants.get(g).st == "live",
    oa' = revokeOa(oa, g),
    ib' = { ...ib, active: unlink(ib.active, oa, g) },
    gh' = { ...gh, audits: gh.audits.union(Set(("revoked", g))), revokedEver: revokedEverAfter(gh, oa, g), last: eff("revoke", NONE, g, true) },
    pf' = pf, pc' = pc,
  }

  // ---------------------------------------------------------------- mcp-request-gate and the tools
  /** H:718-733 bearer: access token unrevoked, unexpired, grant live, Cloud valid. No ban check. */
  def bearerOk(t: int): bool =
    oa.toks.keys().contains(t) and {
      val k = oa.toks.get(t)
      k.kind == "access" and not(k.revoked) and not(k.expired) and liveG(oa, k.g) and cloudValid(oa, pf, k.g)
    }

  /** H:852-854: invalid_grant from a tool revokes the grant. No audit row is written. */
  action toolInvalidGrant(g: int, tool: str): bool = all {
    oa' = revokeOa(oa, g),
    ib' = { ...ib, active: unlink(ib.active, oa, g) },
    gh' = { ...gh, revokedEver: revokedEverAfter(gh, oa, g), last: eff(tool, NONE, g, false) },
    pf' = pf, pc' = pc,
  }

  /** T:317-328 get_updates: readUpdates marks every unseen item of the app seen, then the leak gate filters. */
  action getUpdates(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "getUpdates")
    else {
      val mine = ITEMS.filter(i => ib.items.get(i).live and not(ib.items.get(i).seen) and ib.items.get(i).person == now and ib.items.get(i).app == gr.app and now != NONE)
      val shown = mine.filter(i => not(ib.items.get(i).leaky))
      all {
        ib' = { ...ib, items: ib.items.keys().mapBy(i => if (mine.contains(i)) { ...ib.items.get(i), seen: true } else ib.items.get(i)) },
        gh' = { ...gh, last: { kind: "getUpdates", person: now, grant: g, ok: true, status: "", items: shown } },
        oa' = oa, pf' = pf, pc' = pc,
      }
    }
  }

  /** T:294-302 check_status (rate limit left out). */
  action checkStatus(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "status")
    else all {
      gh' = { ...gh, last: { kind: "status", person: now, grant: g, ok: true, status: statusOf(pf, now, gr.app), items: Set() } },
      oa' = oa, pf' = pf, ib' = ib, pc' = pc,
    }
  }

  /**
   * H:845-848 then T:303-316 submit_profile: the per-grant profile bucket counts every well-formed call
   * before the tool runs; then grantStillTheirs, the status gate (active or onboarding) and the
   * service's own ban check (SVC:1207-1211).
   */
  action submitProfile(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val oaQ = { ...oa, quota: oa.quota.set(g, { ...q, count: count }) }
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    if (count > PROFILE_CAP) all {
      oa' = oaQ, gh' = { ...gh, last: { kind: "quotaRefused", person: now, grant: g, ok: false, status: st, items: Set() } },
      pf' = pf, ib' = ib, pc' = pc,
    } else if (not(stillTheirs(gr.person, now))) all {
      oa' = revokeOa(oaQ, g),
      ib' = { ...ib, active: unlink(ib.active, oa, g) },
      gh' = { ...gh, revokedEver: revokedEverAfter(gh, oa, g), last: eff("profile", NONE, g, false) },
      pf' = pf, pc' = pc,
    } else {
      val accepted = now != NONE and st == "active" and not(pf.banned.contains(now))
      all {
        oa' = if (accepted) { ...oaQ, quota: oaQ.quota.set(g, { count: count, accepted: q.accepted + 1 }) } else oaQ,
        gh' = { ...gh, last: { kind: "profile", person: now, grant: g, ok: accepted, status: st, items: Set() } },
        pf' = pf, ib' = ib, pc' = pc,
      }
    }
  }

  /** T:277-293 and P:47-60 prepare_signup (friends only): one draft row per grant, with the grant's phone key. */
  action prepareSignup(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    all {
      gr.app == "friends", count <= PROFILE_CAP, stillTheirs(gr.person, now),
      not(pf.minor.contains(now)), st == "not_joined" or st == "invited",
      oa' = { ...oa, quota: oa.quota.set(g, { ...q, count: count }),
              drafts: if (oa.drafts.get(g).exists) oa.drafts else oa.drafts.set(g, { exists: true, phone: gr.phone, scrubbed: false }) },
      gh' = { ...gh, last: eff("prepare", now, g, not(oa.drafts.get(g).exists)) },
      pf' = pf, ib' = ib, pc' = pc,
    }
  }

  // ---------------------------------------------------------------- crashes (a process stops between two statements)
  action crashApprove(r: int): bool = all {
    Set("taken", "granted", "linked", "coded").contains(pc.appr.get(r)),
    pc' = { ...pc, appr: pc.appr.set(r, "crashed") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, r, true) },
  }
  action crashExchange(g: int): bool = all {
    Set("checked", "taken", "tok1").contains(pc.exch.get(g)),
    pc' = { ...pc, exch: pc.exch.set(g, if (pc.exch.get(g) == "checked") "idle" else "crashed") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, g, true) },
  }

  // ---------------------------------------------------------------- clocks
  action expireGrant(g: int): bool = all {
    oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked", not(oa.grants.get(g).expired),
    // tokens never outlive their grant (H:553-554, P:170).
    oa' = { ...oa, grants: oa.grants.setBy(g, x => { ...x, expired: true }),
            toks: oa.toks.keys().mapBy(t => { val k = oa.toks.get(t); if (k.g == g) { ...k, expired: true } else k }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireGrant", NONE, g, true) },
  }
  action expireCode(g: int): bool = all {
    oa.codes.get(g).st == "issued" or oa.codes.get(g).st == "used", not(oa.codes.get(g).expired),
    oa' = { ...oa, codes: oa.codes.setBy(g, c => { ...c, expired: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireCode", NONE, g, true) },
  }
  action expireToken(t: int): bool = all {
    oa.toks.keys().contains(t), not(oa.toks.get(t).expired),
    oa' = { ...oa, toks: oa.toks.setBy(t, k => { ...k, expired: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireToken", NONE, oa.toks.get(t).g, true) },
  }
  /** A day passes for a registered client (CLIENT_UNUSED_MS). */
  action clientAges(c: str): bool = all {
    oa.clients.get(c).exists, not(oa.clients.get(c).old),
    oa' = { ...oa, clients: oa.clients.setBy(c, x => { ...x, old: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("clientAges", NONE, 0, true) },
  }

  /**
   * P:202-212 sweep (H:969, at most once in 10 minutes, on OAuth traffic only; modelled as any time).
   * Expired requests, codes and tokens go; revoked or expired grants go (after 30 days, abstracted)
   * with their codes, tokens and drafts; a day-old client with no grant row now goes.
   */
  action sweep = all {
    val work = REQS.exists(g => oa.grants.get(g).st == "revoked" or oa.grants.get(g).expired or (oa.reqs.get(g).live and oa.reqs.get(g).age >= REQ_TTL) or oa.codes.get(g).expired)
      or oa.toks.keys().exists(t => oa.toks.get(t).expired) or CLIENTS.exists(c => oa.clients.get(c).exists and oa.clients.get(c).old)
    work,
    val deadG = REQS.filter(g => oa.grants.get(g).st == "revoked" or (oa.grants.get(g).st == "live" and oa.grants.get(g).expired))
    val grants2 = oa.grants.keys().mapBy(g => if (deadG.contains(g)) { ...oa.grants.get(g), st: "deleted" } else oa.grants.get(g))
    val rowG = REQS.filter(g => grants2.get(g).st == "live" or grants2.get(g).st == "revoked")
    all {
      oa' = { ...oa,
        reqs: oa.reqs.keys().mapBy(r => { val q = oa.reqs.get(r); if (q.live and q.age >= REQ_TTL) { ...q, live: false } else q }),
        codes: oa.codes.keys().mapBy(g => { val c = oa.codes.get(g); if (c.expired or deadG.contains(g)) { ...c, st: if (c.st == "none") "none" else "deleted" } else c }),
        toks: oa.toks.keys().filter(t => not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => oa.toks.get(t)),
        grants: grants2,
        drafts: oa.drafts.keys().mapBy(g => if (deadG.contains(g)) { ...oa.drafts.get(g), exists: false } else oa.drafts.get(g)),
        clients: oa.clients.keys().mapBy(c => { val x = oa.clients.get(c); if (x.exists and x.old and not(rowG.exists(g => grants2.get(g).client == c))) { ...x, exists: false } else x }),
      },
      pc' = { ...pc, refr: pc.refr.keys().filter(t => oa.toks.keys().contains(t) and not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => pc.refr.get(t)) },
      pf' = pf, ib' = ib, gh' = { ...gh, last: eff("sweep", NONE, 0, true) },
    }
  }

  // ---------------------------------------------------------------- platform and network actors
  /** SVC:1734-1765 ban: ban rows, suppression, memberships restricted. No OAuth call. */
  action ban(p: str): bool = all {
    not(pf.banned.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, banned: pf.banned.union(Set(p)),
            member: pf.member.keys().mapBy(k => if (k._1 == p and pf.member.get(k) != "none" and pf.member.get(k) != "removed" and pf.member.get(k) != "invited") "restricted" else pf.member.get(k)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("ban", p, 0, true) },
  }
  /** SVC:1675-1686 hold: the network holds the member (trust). platform.memberships is not written. */
  action staffHold(p: str): bool = all {
    APPS.exists(a => pf.member.get((p, a)) == "active" and not(pf.netHeld.contains((p, a)))),
    pf' = { ...pf, netHeld: pf.netHeld.union(APPS.filter(a => pf.member.get((p, a)) == "active").map(a => (p, a))) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("hold", p, 0, true) },
  }
  /** A number not seen for a year goes on hold for staff (accounts.ts seen): personForKey is null. */
  action holdNumber(n: str): bool = all {
    pf.owner.get(n) != NONE, not(pf.holdNum.contains(n)),
    pf' = { ...pf, holdNum: pf.holdNum.union(Set(n)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("holdNumber", NONE, 0, true) },
  }
  /** Staff decide the held number has the same owner. */
  action clearHoldSame(n: str): bool = all {
    pf.holdNum.contains(n),
    pf' = { ...pf, holdNum: pf.holdNum.exclude(Set(n)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("clearHold", NONE, 0, true) },
  }
  /** A person states an age under 18 (onAgeLowered): the person is a minor on every app. */
  action becomeMinor(p: str): bool = all {
    not(pf.minor.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, minor: pf.minor.union(Set(p)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("minor", p, 0, true) },
  }
  /** A new person for a number with none (p2 joins later on n2). */
  action createPerson(n: str): bool = all {
    pf.owner.get(n) == NONE, not(pf.holdNum.contains(n)), phonesOf(pf, "p2").size() == 0, not(pf.deleted.contains("p2")),
    pf' = { ...pf, owner: pf.owner.set(n, "p2") },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("createPerson", "p2", 0, true) },
  }
  /** POST /api/join (accounts.join refuses banned people). */
  action join(p: str, a: str): bool = all {
    phonesOf(pf, p).size() > 0, not(pf.banned.contains(p)),
    pf.member.get((p, a)) == "none" or pf.member.get((p, a)) == "removed",
    pf' = { ...pf, member: pf.member.set((p, a), "active") },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("join", p, 0, true) },
  }
  /**
   * SVC:615-635 delivered: a member-facing send becomes an inbox item. An intro names another member,
   * so it exists only for an adult who can be matched (AGENTS decision 1). The leak flag is an oracle.
   */
  action produceItem(i: int, p: str, a: str, kind: str, leaky: bool): bool = all {
    not(ib.items.get(i).live), pf.member.get((p, a)) == "active", not(pf.banned.contains(p)),
    kind == "probe" or not(pf.minor.contains(p)),
    ib' = { ...ib, items: ib.items.set(i, { live: true, person: p, app: a, kind: kind, seen: false, oppOpen: true, leaky: leaky }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("item", p, 0, true) },
  }
  /** The opportunity behind an item closes (declined, expired, cancelled). The item is not touched. */
  action closeOpp(i: int): bool = all {
    ib.items.get(i).live, ib.items.get(i).oppOpen,
    ib' = { ...ib, items: ib.items.setBy(i, x => { ...x, oppOpen: false }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("closeOpp", NONE, 0, true) },
  }

  /** H:950-964 revokeAllFor(e164, app, {forget}): revoke and audit each live grant, then delete rows. */
  def revokeAllForgetOa(o: OAuth, ns: Set[str], a: str): OAuth = {
    ...o,
    grants: o.grants.keys().mapBy(g => { val x = o.grants.get(g); if ((x.st == "live" or x.st == "revoked") and ns.contains(x.phone) and x.app == a) { ...x, st: "deleted" } else x }),
    toks: o.toks.keys().filter(t => { val x = o.grants.get(o.toks.get(t).g); not(ns.contains(x.phone) and x.app == a) }).mapBy(t => o.toks.get(t)),
    reqs: o.reqs.keys().mapBy(r => { val q = o.reqs.get(r); if (q.live and ns.contains(q.phone) and clientApp(q.client) == a) { ...q, live: false } else q }),
    drafts: o.drafts.keys().mapBy(g => { val x = o.grants.get(g); if (ns.contains(x.phone) and x.app == a) { ...o.drafts.get(g), exists: false } else o.drafts.get(g) }),
  }
  def forgetGhost(o: OAuth, ns: Set[str], a: str): Set[int] =
    REQS.filter(g => o.grants.get(g).st == "live" and ns.contains(o.grants.get(g).phone) and o.grants.get(g).app == a)

  /**
   * ACC:421-429 leave one app: hooks.onForget (SVC:758-766) runs the listener, which calls
   * revokeAllFor(e164, app, {forget:true}) (serve.ts:100-103). A listener error is logged and dropped
   * (SVC:763-765); the membership goes anyway.
   */
  action leave(p: str, a: str, listenerFails: bool): bool = all {
    val ns = phonesOf(pf, p)
    val gone = forgetGhost(oa, ns, a)
    all {
      ns.size() > 0, pf.member.get((p, a)) != "none", pf.member.get((p, a)) != "removed",
      oa' = if (listenerFails) oa else revokeAllForgetOa(oa, ns, a),
      ib' = if (listenerFails) ib else { ...ib, active: if (gone.size() > 0) ib.active.exclude(Set(p)) else ib.active },
      gh' = if (listenerFails) { ...gh, last: eff("leave", p, 0, false) }
            else { ...gh, audits: gh.audits.union(gone.map(g => ("revoked", g))), revokedEver: gh.revokedEver.union(gone), last: eff("leave", p, 0, true) },
      // The Network forgets the member (SVC:818-): a later join is a new member with no hold.
      pf' = { ...pf, member: pf.member.set((p, a), "removed"), forgotten: pf.forgotten.union(ns.map(n => (n, a))),
              netHeld: pf.netHeld.exclude(Set((p, a))) },
      pc' = pc,
    }
  }

  /**
   * ACC:432-444 delete everything: onForget only for apps with a live membership (ACC:438-442);
   * then the person is deleted (personForKey is null after). The rule covers every app.
   */
  action deleteAll(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val liveApps = APPS.filter(a => pf.member.get((p, a)) != "none" and pf.member.get((p, a)) != "removed")
    val oa1 = if (liveApps.contains("friends")) revokeAllForgetOa(oa, ns, "friends") else oa
    val oa2 = if (liveApps.contains("peon")) revokeAllForgetOa(oa1, ns, "peon") else oa1
    val gone = liveApps.map(a => forgetGhost(oa, ns, a)).flatten()
    all {
      ns.size() > 0,
      oa' = oa2,
      ib' = { ...ib, active: ib.active.exclude(Set(p)) },
      gh' = { ...gh, audits: gh.audits.union(gone.map(g => ("revoked", g))), revokedEver: gh.revokedEver.union(gone), last: eff("deleteAll", p, 0, true) },
      pf' = { ...pf,
        owner: pf.owner.keys().mapBy(n => if (ns.contains(n)) NONE else pf.owner.get(n)),
        deleted: pf.deleted.union(Set(p)), netHeld: pf.netHeld.filter(k => k._1 != p),
        member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
        forgotten: pf.forgotten.union(tuples(ns, APPS)) },
      pc' = pc,
    }
  }

  /**
   * SVC:1293-1309 statedAge with a decline (under 13): forgetMembership on every app directly. The
   * hooks do not run, so revokeAllFor is not called (AGENTS: under 13 is declined with nothing stored).
   */
  action declineUnder13(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val apps = APPS.filter(a => pf.member.get((p, a)) != "none" and pf.member.get((p, a)) != "removed")
    all {
      ns.size() > 0, apps.size() > 0,
      pf' = { ...pf, member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
              minor: pf.minor.union(Set(p)), forgotten: pf.forgotten.union(tuples(ns, APPS)),
              netHeld: pf.netHeld.filter(k => k._1 != p) },
      oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("decline", p, 0, true) },
    }
  }

  /**
   * packages/platform/src/pg-store.ts:371-373 movePhone: one transaction that also runs
   * `update oauth.grants set phone_key = new where phone_key = old`. oauth.sql:66-71 raises on any
   * grant_cloud_ row, so the whole number change rolls back. Drafts keep the old key.
   */
  action movePhone(p: str, src: str, dst: str): bool = all {
    src != dst, pf.owner.get(src) == p, p != NONE, pf.owner.get(dst) == NONE,
    not(pf.holdNum.contains(src)), not(pf.holdNum.contains(dst)),
    val cloudRow = REQS.exists(g => oa.grants.get(g).cloud and oa.grants.get(g).phone == src and (oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked"))
    if (cloudRow) all {
      oa' = oa, pf' = pf, gh' = { ...gh, last: eff("movePhoneAborted", p, 0, false) },
    } else all {
      oa' = { ...oa, grants: oa.grants.keys().mapBy(g => { val x = oa.grants.get(g); if (x.phone == src and x.st != "none") { ...x, phone: dst } else x }) },
      pf' = { ...pf, owner: pf.owner.set(src, NONE).set(dst, p) },
      gh' = { ...gh, last: eff("movePhone", p, 0, true) },
    },
    ib' = ib, pc' = pc,
  }

  // ---------------------------------------------------------------- step
  // The step picks one family, then one action in it, so that the long flows (sign-in, exchange, a
  // tool call) are reached in a random walk; every action of every family stays possible at each step.
  action step = {
    nondet r = REQS.oneOf()
    nondet c = CLIENTS.oneOf()
    nondet n = PHONES.oneOf()
    nondet n2 = PHONES.oneOf()
    nondet p = PERSONS.oneOf()
    nondet a = APPS.oneOf()
    nondet i = ITEMS.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet b2 = Set(true, false).oneOf()
    nondet kind = Set("intro", "probe").oneOf()
    nondet t = oa.toks.keys().union(Set(0)).oneOf()
    // The progress families are listed twice: the simulator picks among enabled branches, so this
    // doubles their weight against the environment. It adds no behaviour.
    any {
      flowFamily(r, c, n, b), clientFamily(r, t), toolFamily(t),
      flowFamily(r, c, n, b), clientFamily(r, t), toolFamily(t),
      // the environment: the person cancels or revokes, a process stops, clocks and the sweep,
      // the network and its inbox, staff and account changes
      any {
        any { denyRead(r), denyFinish(r), consentsRevoke(r), crashApprove(r), crashExchange(r) },
        any { tickRequests, expireGrant(r), expireCode(r), expireToken(t), clientAges(c), sweep },
        any { join(p, a), produceItem(i, p, a, kind, b), closeOpp(i), createPerson(n) },
        any {
          ban(p), staffHold(p), holdNumber(n), clearHoldSame(n), becomeMinor(p),
          leave(p, a, b2), deleteAll(p), declineUnder13(p), movePhone(p, n, n2),
        },
      },
    }
  }

  /** The person signs in and decides on the site. */
  action flowFamily(r: int, c: str, n: str, b: bool): bool = any {
    startAuth(r, c), enterPhone(r, n), enterCode(r), approveTake(r, b),
    approvePutGrant(r), approveLink(r), approvePutCode(r), approveAudit(r),
  }
  /** The client: code exchange, refresh, revocation. */
  action clientFamily(r: int, t: int): bool = any {
    exchCheck(r), exchTake(r), exchTok1(r), exchTok2(r), exchReplay(r),
    refrCheck(t), refrRotate(t), revokeEndpoint(t),
  }
  /** The client calls a tool. */
  action toolFamily(t: int): bool = any { getUpdates(t), checkStatus(t), submitProfile(t), prepareSignup(t) }

  // ================================================================ invariants (from the rules)

  /**
   * SD-019. AGENTS founder 2026-10-09 #3: a banned number is refused at join, OTP and inbound, on every
   * app; SVC:1727-1733 "never matched or texted again". No banned person's agent gets inbox data or new
   * tokens. Code: bearer H:718-733 and refresh H:610-634 have no ban check.
   */
  val noBannedUse =
    not(Set("getUpdates", "refresh").contains(gh.last.kind) and gh.last.ok
        and pf.banned.contains(gh.last.person) and (gh.last.kind == "refresh" or gh.last.items.size() > 0))

  /**
   * SD-184, SD-185. packages/mcp/README.md section 3: "a reused refresh token or code ends the whole
   * grant"; H:629 "A refresh token used twice: someone else has a copy". A replay revocation is only
   * for a credential that was redeemed before (that redemption completed or is still running).
   */
  val replayIsTrue = gh.last.kind == "replay" implies gh.last.ok

  /** INV-C1 (OAuth 2.1 4.1.3): one code gives at most one token pair. */
  val codeOnce = REQS.forall(g => oa.toks.keys().filter(t => oa.toks.get(t).g == g and oa.toks.get(t).origin == "code").size() <= 2)

  /** INV-T1 (README: refresh tokens rotate): at most one unrotated, unrevoked refresh token per grant. */
  val oneRefreshHead = REQS.forall(g => oa.toks.keys().filter(t => {
    val k = oa.toks.get(t)
    k.g == g and k.kind == "refresh" and not(k.rotated) and not(k.revoked) and not(k.expired)
  }).size() <= 1)

  /** INV-G1: a revoked grant never becomes live again. */
  val revokedTerminal = gh.revokedEver.forall(g => oa.grants.get(g).st != "live")

  /**
   * INV-G2, INV-OB1 (T:244-251, README "New owner"): a tool serves data only on a live grant, and only
   * about the person who consented.
   */
  val servedOnLiveOwnGrant =
    (Set("getUpdates", "status", "profile").contains(gh.last.kind) and gh.last.ok) implies {
      val gr = oa.grants.get(gh.last.grant)
      gr.st == "live" and not(gr.expired) and personForKey(pf, gr.phone) == gr.person and gh.last.person == gr.person
    }

  /**
   * SD-186, SD-389. hooks.ts:67-68 "An assistant was connected (consent granted) or disconnected (grant
   * revoked) for a person" and H:174 "the inbox always hears about it": the inbox signal for a person is
   * on exactly when a live grant of that person exists. A grant between putGrant and linked is in flight.
   */
  val activeMatchesGrants = PERSONS.forall(p =>
    not(REQS.exists(g => pc.appr.get(g) == "granted" and oa.grants.get(g).person == p)) implies
      (ib.active.contains(p) iff REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p)))

  /**
   * SD-089. handler.ts:89-91 and README section 3: after leave or delete everything "nothing keeps the
   * phone next to the app"; AGENTS age policy: under 13 is declined with nothing stored.
   */
  val grantDiesWithPerson = pf.forgotten.forall(na =>
    not(REQS.exists(g => (oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked")
      and oa.grants.get(g).phone == na._1 and oa.grants.get(g).app == na._2)))

  /**
   * SD-428. T:311 "the profile never reaches a stopped or held one"; K:76-87 a held member reads
   * on_hold. A staff hold must not read "active" nor accept a profile.
   */
  val heldIsHeld =
    val held = gh.last.grant > 0 and pf.netHeld.contains((gh.last.person, oa.grants.get(gh.last.grant).app))
    not(gh.last.kind == "status" and gh.last.status == "active" and held)
    and not(gh.last.kind == "profile" and gh.last.ok and held)

  /** SD-214. AGENTS decision 1: minors are never matched or connected; no intro reaches a minor. */
  val noIntroToMinor = gh.last.kind == "getUpdates" implies
    gh.last.items.forall(i => not(ib.items.get(i).kind == "intro" and pf.minor.contains(gh.last.person)))

  /**
   * SD-430. T:327 next_step "They answer by replying to the text": an update shown as new must still
   * be answerable, so its opportunity must be open.
   */
  val noStaleUpdate = gh.last.kind == "getUpdates" implies gh.last.items.forall(i => ib.items.get(i).oppOpen)

  /** SD-394. README section 3 Audit: "one row for each ... revocation and replay". */
  val everyRevocationAudited = gh.revokedEver.forall(g => gh.audits.contains(("revoked", g)))

  /** SD-397. RFC 6749 4.1.2: one authorization request ends in a code or in an error, never both. */
  val oneOutcome = gh.granted.intersect(gh.denied) == Set()

  /**
   * SD-389. README section 3 Audit (one row for each consent and code) and H:524-544: a stored grant
   * has its code and its consent_granted row, unless its approval is still running.
   */
  val grantHasCodeAndAudit = REQS.forall(g =>
    oa.grants.get(g).st == "live" implies
      (Set("granted", "linked", "coded").contains(pc.appr.get(g))
       or (oa.codes.get(g).st != "none" and gh.audits.contains(("consent_granted", g)))))

  /** SD-393. README section 3: "A sign-in request keeps the number only while it is open (at most 10 minutes, then swept)". */
  val requestRetention = REQS.forall(r => (oa.reqs.get(r).live and oa.reqs.get(r).phone != "") implies oa.reqs.get(r).age <= README_REQ_MAX)

  /**
   * SD-390. README section 3: the sweep deletes "registered clients that never got a grant after a
   * day"; H:317 client_secret_expires_at 0 (the registration does not expire).
   */
  val clientKeptOnceGranted = CLIENTS.forall(c => not(oa.clients.get(c).exists) implies not(gh.everGranted.contains(c)))

  /** SD-395. README section 2: "At most 5 accepted profiles per grant a day": only accepted ones count. */
  val quotaCountsAccepted = gh.last.kind == "quotaRefused" implies oa.quota.get(gh.last.grant).accepted >= PROFILE_CAP

  /** SD-108. INV-M1 (platform number change, pg-store.ts:371-373): a number change succeeds whatever grants the person has. */
  val numberChangeWorks = gh.last.kind != "movePhoneAborted"

  /** SD-384. P:61-78: a draft is claimed by its grant's phone key; a live draft keys the same phone as its grant. */
  val draftFollowsGrant = REQS.forall(g =>
    (oa.drafts.get(g).exists and not(oa.drafts.get(g).scrubbed) and oa.grants.get(g).st == "live")
      implies oa.drafts.get(g).phone == oa.grants.get(g).phone)

  val safety = and {
    noBannedUse, replayIsTrue, codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant,
    activeMatchesGrants, grantDiesWithPerson, heldIsHeld, noIntroToMinor, noStaleUpdate,
    everyRevocationAudited, oneOutcome, grantHasCodeAndAudit, requestRetention, clientKeptOnceGranted,
    quotaCountsAccepted, numberChangeWorks, draftFollowsGrant,
  }

  /** The invariants that the code keeps (no register defect): checked on their own. */
  val soundCore = and { codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant }

  // ================================================================ witnesses (states that must be reachable)
  /** The full PKCE flow, then get_updates shows an update. */
  val witness_fullFlowUpdate = not(gh.last.kind == "getUpdates" and gh.last.items.size() > 0)
  /** A refresh rotates and mints a new pair. */
  val witness_refreshRotates = not(gh.last.kind == "refresh" and gh.last.ok)
  /** After a revoke, the next tool call is refused (no access token of the grant passes bearer). */
  val witness_revokeStops = not(REQS.exists(g => oa.grants.get(g).st == "revoked"
    and oa.toks.keys().exists(t => oa.toks.get(t).g == g and oa.toks.get(t).kind == "access" and not(oa.toks.get(t).expired))))
  /** A true code replay revokes the grant. */
  val witness_trueReplay = not(gh.last.kind == "replay" and gh.last.ok)
  /** A withheld update is marked seen (SD-183 state; the register refutes the harm). */
  val witness_withheldSeen = not(ITEMS.exists(i => ib.items.get(i).live and ib.items.get(i).leaky and ib.items.get(i).seen))
  /** A person leaves an app and the grants of that app are deleted. */
  val witness_leaveDeletes = not(gh.last.kind == "leave" and gh.last.ok and pf.forgotten.size() > 0
    and REQS.exists(g => oa.grants.get(g).st == "deleted"))

  // ================================================================ run tests (traces from the code and its tests)
  /** oauth.test.ts "full flow: sign in on the page, approve, exchange, check_status". */
  run fullFlowTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(checkStatus(1))
      .expect(gh.last.kind == "status" and gh.last.status == "active" and safety)

  /** oauth.test.ts "a second use of the code revokes what the first issued". */
  run codeReplayTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(exchReplay(1))
      .expect(oa.grants.get(1).st == "revoked" and not(bearerOk(1)) and replayIsTrue and everyRevocationAudited)

  /** oauth.test.ts "access tokens expire; refresh rotates; a reused refresh token ends the grant". */
  run refreshReplayTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(refrCheck(2)).then(refrRotate(2))
      .then(refrCheck(2)).then(refrRotate(2))
      .expect(oa.grants.get(1).st == "revoked" and gh.last.kind == "replay" and gh.last.ok)

  /** SD-019 trace: a banned member keeps get_updates through a legacy grant. */
  run bannedKeepsUpdatesTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(produceItem(1, "p1", "friends", "probe", false))
      .then(ban("p1"))
      .then(getUpdates(1))
      .expect(not(noBannedUse))

  /** SD-184 trace: takeCode commits, the process stops before putToken, the client retries. */
  run codeCrashRetryTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(crashExchange(1))
      .then(exchReplay(1))
      .expect(not(replayIsTrue) and oa.grants.get(1).st == "revoked")

  /** SD-185 trace: the grant expires while a refresh waits; rotateRefresh false is taken as a replay. */
  run refreshExpiredTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(refrCheck(2)).then(expireGrant(1)).then(refrRotate(2))
      .expect(not(replayIsTrue))

  /** SD-089 trace: an under-13 decline removes every membership but the grant stays. */
  run declineKeepsGrantTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(declineUnder13("p1"))
      .expect(not(grantDiesWithPerson))

  /** Leave runs revokeAllFor with forget: the grant row is deleted (oauth.test.ts "leaving an app deletes the grants"). */
  run leaveDeletesTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and activeMatchesGrants and everyRevocationAudited)

  /** SD-397 trace: deny reads the request, approve takes it and stores the grant, deny then audits a denial. */
  run approveDenyRaceTest =
    init
      .then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1))
      .then(denyRead(1)).then(approveTake(1, false)).then(approvePutGrant(1)).then(denyFinish(1))
      .expect(not(oneOutcome))

  /** p1 connects client cF (friends) on n1 with request r and holds its token pair (legacy or Cloud grant). */
  run connect(r: int, c: str, cloud: bool): bool =
    startAuth(r, c).then(enterPhone(r, "n1")).then(enterCode(r)).then(approveTake(r, cloud))
      .then(approvePutGrant(r)).then(approveLink(r)).then(approvePutCode(r)).then(approveAudit(r))
      .then(exchCheck(r)).then(exchTake(r)).then(exchTok1(r)).then(exchTok2(r))

  /** SD-214 trace: an intro item for an adult; the member states 16; get_updates returns the intro. */
  run minorIntroTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "intro", false))
      .then(becomeMinor("p1")).then(getUpdates(1))
      .expect(gh.last.items == Set(1) and not(noIntroToMinor))

  /** SD-430 trace: a probe item; its opportunity closes; get_updates still returns it as new. */
  run staleProbeTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "probe", false))
      .then(closeOpp(1)).then(getUpdates(1))
      .expect(not(noStaleUpdate))

  /** SD-428 trace: a staff hold writes only network trust; check_status says active and a profile is accepted. */
  run heldActiveTest =
    init.then(connect(1, "cF", false)).then(staffHold("p1")).then(checkStatus(1))
      .expect(gh.last.status == "active" and not(heldIsHeld))
      .then(submitProfile(1))
      .expect(gh.last.ok and not(heldIsHeld))

  /** SD-394 trace: the number goes on hold; a tool call answers invalid_grant and revokes with no audit row. */
  run silentRevokeTest =
    init.then(connect(1, "cF", false)).then(holdNumber("n1")).then(checkStatus(1))
      .expect(oa.grants.get(1).st == "revoked" and not(everyRevocationAudited))
      .then(clearHoldSame("n1"))
      .expect(not(bearerOk(1)))

  /** SD-389 trace: the process stops after putGrant and linked: a live grant with no code and no audit row. */
  run consentCrashTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(crashApprove(1))
      .expect(not(grantHasCodeAndAudit) and ib.active.contains("p1"))

  /** SD-393 trace: a request with a number stays 15 minutes (and until the next sweep), not 10. */
  run requestRetentionTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1"))
      .then(tickRequests).then(tickRequests).then(tickRequests)
      .expect(not(requestRetention))

  /** SD-390 trace: the person revokes; the grant is swept; the day-old client goes; its id no longer works. */
  run clientSweptTest =
    init.then(connect(1, "cF", false)).then(consentsRevoke(1)).then(clientAges("cF")).then(sweep)
      .expect(not(clientKeptOnceGranted))
      .then(startAuth(2, "cF"))
      .expect(gh.last.kind == "clientUnknown")

  /** SD-395 trace: refused profiles (not joined) fill the per-grant bucket with no accepted profile. */
  run quotaTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n2")).then(enterCode(1)).then(approveTake(1, false))
      .then(approvePutGrant(1)).then(approveLink(1)).then(approvePutCode(1)).then(approveAudit(1))
      .then(exchCheck(1)).then(exchTake(1)).then(exchTok1(1)).then(exchTok2(1))
      .then(submitProfile(1)).then(submitProfile(1)).then(submitProfile(1))
      .expect(gh.last.kind == "quotaRefused" and not(quotaCountsAccepted))

  /** SD-108 trace: a person with a Cloud grant row cannot change the number (oauth.sql trigger). */
  run cloudMoveTest =
    init.then(connect(1, "cF", true)).then(consentsRevoke(1)).then(movePhone("p1", "n1", "n2"))
      .expect(not(numberChangeWorks) and pf.owner.get("n1") == "p1")

  /** SD-186 (c) trace: two live grants of one person on one surface; revoking one turns the signal off. */
  run activeTwoGrantsTest =
    init.then(connect(1, "cF", false)).then(connect(2, "cP", false)).then(consentsRevoke(1))
      .expect(liveG(oa, 2) and not(ib.active.contains("p1")) and not(activeMatchesGrants))

  /** SD-186 (b) trace: the grant expires; the signal stays on. */
  run activeExpiryTest =
    init.then(connect(1, "cF", false)).then(expireGrant(1))
      .expect(ib.active.contains("p1") and not(activeMatchesGrants))

  /** SD-384 trace: a draft is prepared; the number changes; the grant moves and the draft keeps the old key. */
  run draftMoveTest =
    init.then(leave("p1", "friends", false)).then(connect(2, "cF", false)).then(prepareSignup(1))
      .expect(oa.drafts.get(2).exists)
      .then(movePhone("p1", "n1", "n2"))
      .expect(oa.grants.get(2).phone == "n2" and not(draftFollowsGrant))

  /**
   * Q-oauth_mcp-1 trace: approve takes the request (H:532), the person leaves the app (revokeAllFor and
   * forgetPhone run, H:950-963), then putGrant (H:536) stores a grant for the app the person left.
   */
  run consentDuringLeaveTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveTake(1, false))
      .then(leave("p1", "friends", false)).then(approvePutGrant(1))
      .expect(oa.grants.get(1).st == "live" and not(grantDiesWithPerson))
}
