# Connector authorization and member tools

## Story: Connector authorization and member tools

A member needs to give an agent scoped access to their account and revoke it.

### Safety rules and reachability

Check code use, refresh, ownership, ban and revocation, scoped tools, and request retention. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/oauth_mcp.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=60 max-samples=10000 verify-steps=5
//
// Model of the MCP OAuth server and its tools: packages/mcp/src/handler.ts (H), tools.ts (T),
// pg-store.ts (P), hooks.ts (K), and the parts of packages/network/service/service.ts (SVC) and
// packages/notify/src/scheduler.ts that the tools call. Module plan: docs/research/2026-11-07-state-machines.md
// section 6.11. Source report: docs/research/state-machines/mcp-oauth.md. Findings and fix status:
// docs/research/quint-findings/oauth_mcp.md.
//
// This version follows the code after the fixes on branch wave2/oauth_mcp (SD-019, SD-089, SD-184,
// SD-185, SD-186 part (c), SD-214, SD-384, SD-389, SD-390, SD-393, SD-394, SD-395, SD-397, SD-428,
// SD-430, Q-oauth_mcp-1). Line numbers are for the code on branch claude/formal-main (compared
// with the code on 2026-11-09).
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
//    P:115-132 approveConsent). Each grant has its one code (same transaction).
//  - Time: grants, codes and tokens expire by nondeterministic clock actions. Auth requests have an
//    age in 5-minute ticks, because the README gives a minute limit for them (SD-393).
//  - Cloud validation is an oracle: a Cloud grant is valid only while its owner is the consent person
//    (packages/platform/src/api.ts:681-697). "unavailable" writes no state (INV-CA3), so it is left out. The ban check that
//    cloudGrantCurrent now runs first (H:777) is in the model for every grant.
//  - Bans are per person here (the code also bans by number; the model's bans cover the person's
//    numbers at ban time through `banned(phoneKey, personId)`, K:159-161).
//  - Revocation and its audit row are one action on every path. A crash between revokeGrant and its
//    audit row is not modelled.
//  - Leave, delete everything and the under-13 decline are each one action. The real paths are several
//    statements; the race of a leave with an approval is closed by a row lock (P:246-249, the
//    Q-oauth_mcp-1 fix, proved by packages/mcp/test/consent-forget.pg.test.ts), so an atomic leave is
//    a sound abstraction of it.
//  - The leak gate (leaks.ts) is an oracle: each inbox item has a nondeterministic `leaky` flag.
//  - A signup draft has no clock here: its 10-minute expiry (T:288, P:232-233 scrubs it) only removes
//    data, and no invariant needs it.
//  - Open drift, not modelled (docs: the oauth_mcp drift report of 2026-11-09): endIfBanned (H:581-585)
//    revokes a banned person's grant at its first use, and the platform number change
//    (packages/platform/src/pg-store.ts:452-457) revokes the Cloud grants of the old number. Neither
//    writes an oauth.audit row, which `everyRevocationAudited` requires. The model keeps the ban as a
//    read-only check and the old abort of a number change with a Cloud grant.
module oauth_mcp {

  // ---------------------------------------------------------------- constants
  pure val PERSONS = Set("p1", "p2")
  pure val PHONES = Set("n1", "n2")
  pure val APPS = Set("friends", "peon")
  pure val CLIENTS = Set("cF", "cP")
  /** The app a client registered on (H:331; every grant of a client is for this app). */
  pure def clientApp(c: str): str = if (c == "cF") "friends" else "peon"
  pure val REQS = Set(1, 2, 3)
  pure val ITEMS = Set(1, 2)
  pure val NONE = "none"
  /** TTL.requestMs = 10 minutes = 2 ticks (H:74-75, SD-393 fix). */
  pure val REQ_TTL = 2
  /** packages/mcp/README.md section 3: "at most 10 minutes" = 2 ticks. */
  pure val README_REQ_MAX = 2
  /** PROFILES_PER_GRANT_DAY (H:103), scaled down from 5 to 2 to keep the state small. */
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
    // under13: a person whose lowest age is under 13 (the join age of every app, apps.ts).
    under13: Set[str], deleted: Set[str],
    member: (str, str) -> str, forgotten: Set[(str, str)],
  }
  type Inbox = { items: int -> Item, active: Set[str] }
  type Procs = { appr: int -> str, deny: int -> str, exch: int -> str, refr: int -> str }
  /**
   * `audits` are the rows of oauth.audit (real state: the sweep reads consent_granted rows, P:241-243).
   * The rest is ghost state for the invariants.
   */
  type Ghost = {
    audits: Set[(str, int)], granted: Set[int], denied: Set[int], everGranted: Set[str],
    revokedEver: Set[int], oldKey: Set[str], last: Effect,
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
  /** K:156-158 personForKey: null when the number is on hold or has no live person. */
  def personForKey(p: Platform, n: str): str = if (p.holdNum.contains(n)) NONE else p.owner.get(n)
  /** K:148-150 login: "held" when banned or on hold. */
  def login(p: Platform, n: str): str =
    if (p.holdNum.contains(n) or p.banned.contains(p.owner.get(n))) "held" else p.owner.get(n)
  /**
   * K:179-186 status -> publicStatus (decisions.ts:27-39). SD-428 fix (K:183-185, serve.ts:91-94): an active
   * member that the app's Network holds reads on_hold.
   */
  def statusOf(p: Platform, person: str, app: str): str =
    if (person == NONE) "not_joined" else {
      val m = p.member.get((person, app))
      if (m == "active") (if (p.netHeld.contains((person, app))) "on_hold" else "active")
      else if (m == "paused") "stopped" else if (m == "restricted") "on_hold"
      else if (m == "invited") "invited" else "not_joined"
    }
  /** decisions.ts:18-20 grantStillTheirs. */
  pure def stillTheirs(atConsent: str, now: str): bool = if (atConsent == NONE) now == NONE else now == atConsent
  def liveG(o: OAuth, g: int): bool = o.grants.get(g).st == "live" and not(o.grants.get(g).expired)
  /** K:159-161 banned(phoneKey, personId): the grant's person, else the number's owner now. */
  def banSubject(o: OAuth, p: Platform, g: int): str = {
    val gr = o.grants.get(g)
    if (gr.person != NONE) gr.person else p.owner.get(gr.phone)
  }
  /**
   * H:775-786 cloudGrantCurrent. SD-019 fix (H:777): a ban makes every grant invalid (no tool call,
   * no code exchange, no refresh). Legacy grants are then "valid" with no Cloud call; a Cloud grant is
   * an oracle.
   */
  def cloudValid(o: OAuth, p: Platform, g: int): bool = {
    val gr = o.grants.get(g)
    not(p.banned.contains(banSubject(o, p, g)))
      and (not(gr.cloud) or personForKey(p, gr.phone) == gr.person)
  }

  // ---------------------------------------------------------------- helpers (writes)
  /** P:147-155 revokeGrant: grant, its tokens and its draft payload in one transaction. */
  def revokeOa(o: OAuth, g: int): OAuth = {
    ...o,
    grants: o.grants.setBy(g, x => if (x.st == "live") { ...x, st: "revoked" } else x),
    toks: o.toks.keys().mapBy(t => { val k = o.toks.get(t); if (k.g == g) { ...k, revoked: true } else k }),
    drafts: o.drafts.setBy(g, d => { ...d, scrubbed: true }),
  }
  /**
   * H:182-192 revokeGrant then linked(grant, false). SD-186 (c) fix: for each grant in `gs` that this
   * revocation ended (st was live) and that has a person, the signal goes off only when no other live
   * grant of that person (and assistant; every client here is Claude) is left on the grant's phone key
   * (store.grantsFor, P:144-146). `oNew` is the state after every revocation of the step.
   */
  def unlinkAfter(act: Set[str], oOld: OAuth, oNew: OAuth, gs: Set[int]): Set[str] =
    act.exclude(gs.filter(g => {
      val gr = oOld.grants.get(g)
      gr.st == "live" and gr.person != NONE
        and not(REQS.exists(g2 => liveG(oNew, g2) and oNew.grants.get(g2).person == gr.person and oNew.grants.get(g2).phone == gr.phone))
    }).map(g => oOld.grants.get(g).person))
  def revokedEverAfter(h: Ghost, o: OAuth, g: int): Set[int] =
    if (o.grants.get(g).st == "live") h.revokedEver.union(Set(g)) else h.revokedEver
  def phonesOf(p: Platform, person: str): Set[str] = PHONES.filter(n => p.owner.get(n) == person)

  /** Revoke one grant with its audit row (consent revoke, the /oauth/revoke endpoint, a tool's invalid_grant, a replay). */
  action revokeWithAudit(g: int, extra: Set[(str, int)], last: Effect): bool = all {
    val o2 = revokeOa(oa, g)
    all {
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, Set(g)) },
      gh' = { ...gh,
        audits: gh.audits.union(extra).union(if (oa.grants.get(g).st == "live") Set(("revoked", g)) else Set()),
        revokedEver: revokedEverAfter(gh, oa, g), last: last },
    },
  }

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
      banned: Set(), holdNum: Set(), netHeld: Set(), minor: Set(), under13: Set(), deleted: Set(),
      member: tuples(PERSONS, APPS).mapBy(k => if (k._1 == "p1") "active" else "none"),
      forgotten: Set(),
    },
    ib' = {
      items: ITEMS.mapBy(i => { live: false, person: NONE, app: "", kind: "", seen: false, oppOpen: false, leaky: false }),
      active: Set(),
    },
    pc' = { appr: REQS.mapBy(r => "idle"), deny: REQS.mapBy(r => "idle"), exch: REQS.mapBy(g => "idle"), refr: Map() },
    gh' = { audits: Set(), granted: Set(), denied: Set(), everGranted: Set(), revokedEver: Set(), oldKey: Set(), last: NO_EFFECT },
  }

  // ---------------------------------------------------------------- oauth-auth-request
  /** GET /oauth/authorize: one row, step phone. An unknown (swept) client gets an error page. */
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

  /** POST /authorize/phone: startOtp, then updateAuthRequest(e164, step code). */
  action enterPhone(r: int, n: str): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "phone" or q.step == "code",
      oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, phone: n, step: "code" }) },
      pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("phone", NONE, r, true) },
    }
  }

  /** POST /authorize/code: verifyOtp (oracle: the person types the right code), login, step consent. */
  action enterCode(r: int): bool = all {
    val q = oa.reqs.get(r)
    val who = login(pf, q.phone)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "code",
      if (who == "held") all {
        // Held or banned: the request is deleted.
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

  /**
   * H:513-537 approve, up to the transaction: liveRequest, session and owner checks, the Cloud oracle.
   * The grant object is prepared in memory (no row yet; st stays "none").
   */
  action approveRead(r: int, cloud: bool): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "consent", pc.appr.get(r) == "idle",
      if (login(pf, q.phone) == "held" or login(pf, q.phone) != q.person) all {
        // H:518-527: the number is held or banned, or its person changed: the request is deleted
        // ("Connect again").
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, live: false }) },
        pc' = pc, gh' = { ...gh, last: eff("approveOwnerChanged", NONE, r, false) },
      } else all {
        // Cloud authority needs a current owner; legacy grants need nothing more.
        not(cloud) or q.person != NONE,
        oa' = { ...oa,
          grants: oa.grants.setBy(r, x => { ...x, phone: q.phone, person: q.person, app: clientApp(q.client), client: q.client, cloud: cloud }) },
        pc' = { ...pc, appr: pc.appr.set(r, "read") },
        gh' = { ...gh, last: eff("approveRead", q.person, r, true) },
      },
      pf' = pf, ib' = ib,
    }
  }
  /**
   * SD-389 fix, P:115-132 approveConsent (H:545-562): one transaction deletes the request (only a live request at
   * step consent), and inserts the grant, its code and the consent_granted and code_issued rows. A
   * failed insert (`insertFails`, or the client row is gone: oauth.sql grants.client_id foreign key)
   * rolls everything back and the request stays for a retry. A request that is gone (taken by a
   * denial, deleted by a forget, expired) gives "This page has expired" and stores nothing.
   */
  action approveCommit(r: int, insertFails: bool): bool = all {
    pc.appr.get(r) == "read",
    val q = oa.reqs.get(r)
    val gr = oa.grants.get(r)
    if (not(q.live and q.step == "consent" and q.age < REQ_TTL)) all {
      oa' = oa, pc' = { ...pc, appr: pc.appr.set(r, "failed") }, gh' = { ...gh, last: eff("approveExpired", NONE, r, false) },
    } else if (insertFails or not(oa.clients.get(gr.client).exists)) all {
      oa' = oa, pc' = { ...pc, appr: pc.appr.set(r, "idle") }, gh' = { ...gh, last: eff("approveRolledBack", NONE, r, false) },
    } else all {
      oa' = { ...oa,
        reqs: oa.reqs.set(r, { ...q, live: false }),
        grants: oa.grants.setBy(r, x => { ...x, st: "live" }),
        codes: oa.codes.set(r, { st: "issued", expired: false }) },
      pc' = { ...pc, appr: pc.appr.set(r, "committed") },
      gh' = { ...gh, granted: gh.granted.union(Set(r)), everGranted: gh.everGranted.union(Set(gr.client)),
              // Ghost for Q-oauth_mcp-2: the grant is stored on a number its person no longer owns.
              oldKey: if (gr.person != NONE and pf.owner.get(gr.phone) != gr.person) gh.oldKey.union(Set(gr.person)) else gh.oldKey,
              audits: gh.audits.union(Set(("consent_granted", r), ("code_issued", r))),
              last: eff("approveCommit", gr.person, r, true) },
    },
    pf' = pf, ib' = ib,
  }
  /** H:563 linked(grant, true) after the commit: active=true, only for a grant with a person; then the 303 with the code. */
  action approveLink(r: int): bool = all {
    pc.appr.get(r) == "committed",
    val p = oa.grants.get(r).person
    ib' = { ...ib, active: if (p != NONE) ib.active.union(Set(p)) else ib.active },
    pc' = { ...pc, appr: pc.appr.set(r, "done") },
    oa' = oa, pf' = pf, gh' = { ...gh, last: eff("approved", oa.grants.get(r).person, r, true) },
  }

  /** liveRequest read of a cancel or a non-approve consent POST. */
  action denyRead(r: int): bool = all {
    oa.reqs.get(r).live, oa.reqs.get(r).age < REQ_TTL, oa.clients.get(oa.reqs.get(r).client).exists, pc.deny.get(r) == "idle",
    pc' = { ...pc, deny: pc.deny.set(r, "read") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("denyRead", NONE, r, true) },
  }
  /**
   * SD-397 fix, H:539-540: the delete reports whether it deleted the row. Only then the denial is
   * audited and the client gets access_denied; else (an approval took the request) "This page has expired".
   */
  action denyFinish(r: int): bool = all {
    pc.deny.get(r) == "read",
    pc' = { ...pc, deny: pc.deny.set(r, "done") },
    if (oa.reqs.get(r).live) all {
      oa' = { ...oa, reqs: oa.reqs.setBy(r, q => { ...q, live: false }) },
      gh' = { ...gh, audits: gh.audits.union(Set(("consent_denied", r))), denied: gh.denied.union(Set(r)), last: eff("denied", NONE, r, true) },
    } else all {
      oa' = oa, gh' = { ...gh, last: eff("denyExpired", NONE, r, false) },
    },
    pf' = pf, ib' = ib,
  }

  /**
   * The clock: each live request gets one tick older (5 minutes). SD-393 fix: the service's tick runs
   * the OAuth sweep at most once a minute with no OAuth traffic (serve.ts:106, H:205-209), so a
   * request is deleted when it reaches its 10-minute TTL.
   */
  action tickRequests = all {
    oa.reqs.keys().exists(r => oa.reqs.get(r).live),
    oa' = { ...oa, reqs: oa.reqs.keys().mapBy(r => {
      val q = oa.reqs.get(r)
      if (q.live) { ...q, age: q.age + 1, live: q.age + 1 < REQ_TTL } else q
    }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("tick", NONE, 0, true) },
  }

  // ---------------------------------------------------------------- oauth-code: exchange (H:609-647)
  /** H:609-636: code unused, unexpired, grant live, ban and Cloud check (cloudGrantCurrent). */
  action exchCheck(g: int): bool = all {
    oa.codes.get(g).st == "issued", not(oa.codes.get(g).expired), liveG(oa, g), cloudValid(oa, pf, g),
    pc.exch.get(g) == "idle",
    pc' = { ...pc, exch: pc.exch.set(g, "checked") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("exchCheck", banSubject(oa, pf, g), g, true) },
  }
  /**
   * SD-184 fix, H:637-646 and P:164-182 redeemCode: one transaction marks the code used and, on its
   * first use, stores both tokens and the token_issued row. The mint callback checks expiry only: when
   * the code or the grant expired meanwhile, the code is used and nothing is stored (invalid_grant).
   * A grant row deleted meanwhile fails the token insert (foreign key): the code stays unused.
   */
  action exchRedeem(g: int): bool = all {
    pc.exch.get(g) == "checked", oa.codes.get(g).st == "issued",
    val gr = oa.grants.get(g)
    val refreshTok = oa.nextTok + 1
    if (gr.st == "deleted") all {
      oa' = oa, pc' = { ...pc, exch: pc.exch.set(g, "idle") }, gh' = { ...gh, last: eff("exchRolledBack", NONE, g, false) },
    } else if (oa.codes.get(g).expired or gr.expired) all {
      oa' = { ...oa, codes: oa.codes.setBy(g, c => { ...c, st: "used" }) },
      pc' = { ...pc, exch: pc.exch.set(g, "idle") },
      gh' = { ...gh, last: eff("exchExpired", NONE, g, false) },
    } else all {
      refreshTok <= MAX_TOKENS,
      oa' = { ...oa,
        codes: oa.codes.setBy(g, c => { ...c, st: "used" }),
        toks: oa.toks
          .put(oa.nextTok, { g: g, kind: "access", origin: "code", rotated: false, revoked: false, expired: false })
          .put(refreshTok, { g: g, kind: "refresh", origin: "code", rotated: false, revoked: false, expired: false }),
        nextTok: oa.nextTok + 2 },
      pc' = { ...pc, exch: pc.exch.set(g, "done"), refr: pc.refr.put(refreshTok, "idle") },
      gh' = { ...gh, audits: gh.audits.union(Set(("token_issued", g))), last: eff("tokens", gr.person, g, true) },
    },
    pf' = pf, ib' = ib,
  }
  /**
   * H:614-622 and H:643: a client presents a used code. The grant is revoked as a replay. codeVerdict
   * (decisions.ts:76-79) reads "used" before "expired": a used code is a replay until the sweep deletes
   * its row, also after it expired.
   * Model ghost: the replay is "true" when an earlier exchange of this code completed; "dead" when the
   * grant was not usable before (revoked, expired, or its one code used with no token issued: the
   * exchange that used it expired, exchRedeem), so the replay ends nothing.
   */
  action exchReplay(g: int): bool = all {
    oa.codes.get(g).st == "used",
    val trueReplay = pc.exch.get(g) == "done"
    val dead = not(liveG(oa, g)) or not(oa.toks.keys().exists(t => oa.toks.get(t).g == g))
    revokeWithAudit(g, Set(("code_replay", g)),
      { kind: "replay", person: NONE, grant: g, ok: trueReplay or dead,
        status: if (trueReplay) "true" else if (dead) "dead" else "false", items: Set() }),
    pf' = pf, pc' = pc,
  }

  // ---------------------------------------------------------------- oauth-token-family: refresh (H:649-675)
  /**
   * H:649-658: token unrevoked, unexpired, grant live, ban and Cloud check. The handler keeps the token
   * row it read: "checkedRot" when it was already rotated then (H:664, a replay with no rotateRefresh call).
   */
  action refrCheck(t: int): bool = all {
    oa.toks.keys().contains(t),
    val k = oa.toks.get(t)
    all {
      k.kind == "refresh", not(k.revoked), not(k.expired), liveG(oa, k.g), cloudValid(oa, pf, k.g),
      pc.refr.keys().contains(t), pc.refr.get(t) == "idle",
      pc' = { ...pc, refr: pc.refr.set(t, if (k.rotated) "checkedRot" else "checked") },
    },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("refrCheck", banSubject(oa, pf, oa.toks.get(t).g), oa.toks.get(t).g, true) },
  }
  /**
   * SD-185 fix, H:664-673 and P:194-212 rotateRefresh: one transaction that locks the grant. "stale"
   * when the grant is revoked, expired or gone (invalid_grant; no revocation, no audit row); "replay"
   * when the token was rotated or revoked (the grant is revoked, with a refresh_replay row); else it
   * rotates.
   */
  action refrRotate(t: int): bool = all {
    pc.refr.keys().contains(t), oa.toks.keys().contains(t), Set("checked", "checkedRot").contains(pc.refr.get(t)),
    val k = oa.toks.get(t)
    val g = k.g
    val gr = oa.grants.get(g)
    val idle = { ...pc, refr: pc.refr.set(t, "idle") }
    val replay = { kind: "replay", person: NONE, grant: g, ok: true, status: "true", items: Set() }
    if (pc.refr.get(t) == "checkedRot") all {
      pc' = idle, revokeWithAudit(g, Set(("refresh_replay", g)), replay),
    } else if (gr.st != "live" or gr.expired) all {
      oa' = oa, pc' = idle, ib' = ib, gh' = { ...gh, last: eff("refreshStale", NONE, g, false) },
    } else if (k.rotated or k.revoked) all {
      pc' = idle,
      revokeWithAudit(g, Set(("refresh_replay", g)), { ...replay, ok: k.rotated, status: if (k.rotated) "true" else "false" }),
    } else if (oa.nextTok + 1 <= MAX_TOKENS) all {
      oa' = { ...oa,
        toks: oa.toks.set(t, { ...k, rotated: true })
          .put(oa.nextTok, { g: g, kind: "access", origin: "refresh", rotated: false, revoked: false, expired: false })
          .put(oa.nextTok + 1, { g: g, kind: "refresh", origin: "refresh", rotated: false, revoked: false, expired: false }),
        nextTok: oa.nextTok + 2 },
      pc' = { ...pc, refr: pc.refr.set(t, "idle").put(oa.nextTok + 1, "idle") },
      ib' = ib,
      gh' = { ...gh, audits: gh.audits.union(Set(("token_refreshed", g))), last: eff("refresh", gr.person, g, true) },
    } else all {
      oa' = oa, pc' = idle, ib' = ib, gh' = gh,
    },
    pf' = pf,
  }

  // ---------------------------------------------------------------- revocation by the client and the person
  /** /oauth/revoke with a refresh token: the grant ends, with an audit row. */
  action revokeEndpoint(t: int): bool = all {
    oa.toks.keys().contains(t), oa.toks.get(t).kind == "refresh",
    revokeWithAudit(oa.toks.get(t).g, Set(), eff("revoke", NONE, oa.toks.get(t).g, true)),
    pf' = pf, pc' = pc,
  }
  /** H:689-692 /oauth/revoke with an access token: that token only ends, with a token_revoked row. */
  action revokeAccessToken(t: int): bool = all {
    oa.toks.keys().contains(t), oa.toks.get(t).kind == "access", not(oa.toks.get(t).revoked),
    oa' = { ...oa, toks: oa.toks.setBy(t, k => { ...k, revoked: true }) },
    gh' = { ...gh, audits: gh.audits.union(Set(("token_revoked", oa.toks.get(t).g))), last: eff("revokeAccess", NONE, oa.toks.get(t).g, true) },
    pf' = pf, ib' = ib, pc' = pc,
  }
  /** /oauth/consents/revoke by the person: audit only when revokeGrant returned true. */
  action consentsRevoke(g: int): bool = all {
    oa.grants.get(g).st == "live",
    revokeWithAudit(g, Set(), eff("revoke", NONE, g, true)),
    pf' = pf, pc' = pc,
  }

  // ---------------------------------------------------------------- mcp-request-gate and the tools
  /** bearer: access token unrevoked, unexpired, grant live, ban and Cloud check (cloudGrantCurrent). */
  def bearerOk(t: int): bool =
    oa.toks.keys().contains(t) and {
      val k = oa.toks.get(t)
      k.kind == "access" and not(k.revoked) and not(k.expired) and liveG(oa, k.g) and cloudValid(oa, pf, k.g)
    }

  /** SD-394 fix, H:895-899: invalid_grant from a tool revokes the grant and writes consent_revoked when the revoke ended it. */
  action toolInvalidGrant(g: int, tool: str): bool = all {
    revokeWithAudit(g, Set(), eff(tool, NONE, g, false)),
    pf' = pf, pc' = pc,
  }

  /**
   * T:317-328 get_updates and SVC:672-690 updatesFor. SD-214 fix: a minor reads nothing (and nothing is
   * marked seen). SD-430 fix: readUpdates marks every unseen item of the app seen; the leak gate and the
   * closed-opportunity filter then drop items.
   */
  action getUpdates(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "getUpdates")
    else if (pf.minor.contains(now)) all {
      gh' = { ...gh, last: { kind: "getUpdates", person: now, grant: g, ok: true, status: "", items: Set() } },
      oa' = oa, pf' = pf, ib' = ib, pc' = pc,
    } else {
      val mine = ITEMS.filter(i => ib.items.get(i).live and not(ib.items.get(i).seen) and ib.items.get(i).person == now and ib.items.get(i).app == gr.app and now != NONE)
      val shown = mine.filter(i => not(ib.items.get(i).leaky) and ib.items.get(i).oppOpen)
      all {
        ib' = { ...ib, items: ib.items.keys().mapBy(i => if (mine.contains(i)) { ...ib.items.get(i), seen: true } else ib.items.get(i)) },
        gh' = { ...gh, last: { kind: "getUpdates", person: now, grant: g, ok: true, status: "", items: shown } },
        oa' = oa, pf' = pf, pc' = pc,
      }
    }
  }

  /** T:293-301 check_status (rate limit left out). */
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
   * T:302-316 submit_profile: grantStillTheirs, the status gate (active; the model has no onboarding
   * state), then (SD-395 fix) the per-grant profile bucket counts the call (T:312, H:889-891), then the
   * service's own ban check (SVC submitProfile).
   */
  action submitProfile(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val oaQ = { ...oa, quota: oa.quota.set(g, { ...q, count: count }) }
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "profile")
    else if (now == NONE or st != "active") all {
      oa' = oa, gh' = { ...gh, last: { kind: "profile", person: now, grant: g, ok: false, status: st, items: Set() } },
      pf' = pf, ib' = ib, pc' = pc,
    } else if (count > PROFILE_CAP) all {
      oa' = oaQ, gh' = { ...gh, last: { kind: "quotaRefused", person: now, grant: g, ok: false, status: st, items: Set() } },
      pf' = pf, ib' = ib, pc' = pc,
    } else {
      val accepted = not(pf.banned.contains(now))
      all {
        oa' = if (accepted) { ...oaQ, quota: oaQ.quota.set(g, { count: count, accepted: q.accepted + 1 }) } else oaQ,
        gh' = { ...gh, last: { kind: "profile", person: now, grant: g, ok: accepted, status: st, items: Set() } },
        pf' = pf, ib' = ib, pc' = pc,
      }
    }
  }

  /**
   * T:275-292 and P:47-60 prepare_signup (friends and ntwrk; friends here): the age policy first
   * (withSignupAgePolicy, K:126-135: canJoinApp, 13 on every app, so only an under-13 person is
   * refused; a 13-17 person may prepare a Join form), then grantStillTheirs (invalid_grant revokes the
   * grant, H:895-899), the status, then (SD-395 fix) the quota, then one draft row per grant, with the
   * grant's phone key.
   */
  action prepareSignup(t: int): bool = all {
    bearerOk(t),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    all {
      gr.app == "friends", not(pf.under13.contains(now)),
      if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "prepare")
      else all {
        count <= PROFILE_CAP, st == "not_joined" or st == "invited",
        oa' = { ...oa, quota: oa.quota.set(g, { ...q, count: count }),
                drafts: if (oa.drafts.get(g).exists) oa.drafts else oa.drafts.set(g, { exists: true, phone: gr.phone, scrubbed: false }) },
        gh' = { ...gh, last: eff("prepare", now, g, not(oa.drafts.get(g).exists)) },
        pf' = pf, ib' = ib, pc' = pc,
      },
    }
  }

  // ---------------------------------------------------------------- crashes (a process stops between two statements)
  /** Before the approval's transaction nothing is written; after it, linked(true) may not run (SD-186 part (a), kept by contract). */
  action crashApprove(r: int): bool = all {
    Set("read", "committed").contains(pc.appr.get(r)),
    pc' = { ...pc, appr: pc.appr.set(r, if (pc.appr.get(r) == "read") "idle" else "crashed") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, r, true) },
  }
  /** The exchange has one transaction now: a stop after the checks writes nothing. */
  action crashExchange(g: int): bool = all {
    pc.exch.get(g) == "checked",
    pc' = { ...pc, exch: pc.exch.set(g, "idle") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, g, true) },
  }

  // ---------------------------------------------------------------- clocks
  action expireGrant(g: int): bool = all {
    oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked", not(oa.grants.get(g).expired),
    // tokens never outlive their grant.
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
   * P:232-244 sweep (on every OAuth request and every service tick, at most once a minute; modelled as
   * any time). Expired codes and tokens go; revoked or expired grants go (after 30 days, abstracted)
   * with their codes, tokens and drafts. SD-390 fix (P:241-243): a day-old client goes only when no
   * grant row is left and it never got a consent_granted audit row.
   */
  /** P:241-243: the client has a consent_granted audit row (audit rows are never swept). */
  def everConsented(c: str): bool = REQS.exists(g => gh.audits.contains(("consent_granted", g)) and oa.grants.get(g).client == c)
  action sweep = all {
    val work = REQS.exists(g => oa.grants.get(g).st == "revoked" or oa.grants.get(g).expired or oa.codes.get(g).expired)
      or oa.toks.keys().exists(t => oa.toks.get(t).expired) or CLIENTS.exists(c => oa.clients.get(c).exists and oa.clients.get(c).old)
    work,
    val deadG = REQS.filter(g => oa.grants.get(g).st == "revoked" or (oa.grants.get(g).st == "live" and oa.grants.get(g).expired))
    val grants2 = oa.grants.keys().mapBy(g => if (deadG.contains(g)) { ...oa.grants.get(g), st: "deleted" } else oa.grants.get(g))
    val rowG = REQS.filter(g => grants2.get(g).st == "live" or grants2.get(g).st == "revoked")
    all {
      oa' = { ...oa,
        codes: oa.codes.keys().mapBy(g => { val c = oa.codes.get(g); if (c.expired or deadG.contains(g)) { ...c, st: if (c.st == "none") "none" else "deleted" } else c }),
        toks: oa.toks.keys().filter(t => not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => oa.toks.get(t)),
        grants: grants2,
        drafts: oa.drafts.keys().mapBy(g => if (deadG.contains(g)) { ...oa.drafts.get(g), exists: false } else oa.drafts.get(g)),
        clients: oa.clients.keys().mapBy(c => { val x = oa.clients.get(c); if (x.exists and x.old and not(rowG.exists(g => grants2.get(g).client == c)) and not(everConsented(c))) { ...x, exists: false } else x }),
      },
      pc' = { ...pc, refr: pc.refr.keys().filter(t => oa.toks.keys().contains(t) and not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => pc.refr.get(t)) },
      pf' = pf, ib' = ib, gh' = { ...gh, last: eff("sweep", NONE, 0, true) },
    }
  }

  // ---------------------------------------------------------------- platform and network actors
  /** SVC ban: ban rows, suppression, memberships restricted. No OAuth write: the OAuth checks read the ban. */
  action ban(p: str): bool = all {
    not(pf.banned.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, banned: pf.banned.union(Set(p)),
            member: pf.member.keys().mapBy(k => if (k._1 == p and pf.member.get(k) != "none" and pf.member.get(k) != "removed" and pf.member.get(k) != "invited") "restricted" else pf.member.get(k)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("ban", p, 0, true) },
  }
  /** SVC hold: the network holds the member (trust). platform.memberships is not written. */
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
   * SVC delivered: a member-facing send becomes an inbox item. An intro names another member, so it
   * exists only for an adult who can be matched (AGENTS decision 1). The leak flag is an oracle.
   */
  action produceItem(i: int, p: str, a: str, kind: str, leaky: bool): bool = all {
    not(ib.items.get(i).live), pf.member.get((p, a)) == "active", not(pf.banned.contains(p)),
    kind == "probe" or not(pf.minor.contains(p)),
    ib' = { ...ib, items: ib.items.set(i, { live: true, person: p, app: a, kind: kind, seen: false, oppOpen: true, leaky: leaky }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("item", p, 0, true) },
  }
  /** The opportunity behind an item closes (completed, cancelled, skipped). The item is not touched. */
  action closeOpp(i: int): bool = all {
    ib.items.get(i).live, ib.items.get(i).oppOpen,
    ib' = { ...ib, items: ib.items.setBy(i, x => { ...x, oppOpen: false }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("closeOpp", NONE, 0, true) },
  }

  /**
   * H:994-1008 revokeAllFor(e164, app, {forget}): revoke and audit each live, unexpired grant
   * (grantsFor), then forgetPhone (P:246-255): delete the sign-in requests, then every grant row of
   * the number and app (with its codes, tokens and drafts).
   */
  def revokeAllForgetOa(o: OAuth, ns: Set[str], a: str): OAuth = {
    ...o,
    grants: o.grants.keys().mapBy(g => { val x = o.grants.get(g); if ((x.st == "live" or x.st == "revoked") and ns.contains(x.phone) and x.app == a) { ...x, st: "deleted" } else x }),
    toks: o.toks.keys().filter(t => { val x = o.grants.get(o.toks.get(t).g); not(ns.contains(x.phone) and x.app == a) }).mapBy(t => o.toks.get(t)),
    reqs: o.reqs.keys().mapBy(r => { val q = o.reqs.get(r); if (q.live and ns.contains(q.phone) and clientApp(q.client) == a) { ...q, live: false } else q }),
    drafts: o.drafts.keys().mapBy(g => { val x = o.grants.get(g); if (ns.contains(x.phone) and x.app == a) { ...o.drafts.get(g), exists: false } else o.drafts.get(g) }),
  }
  /** The grants that revokeAllFor revokes (and audits) before the delete: live and unexpired (grantsFor). */
  def forgetGhost(o: OAuth, ns: Set[str], apps: Set[str]): Set[int] =
    REQS.filter(g => liveG(o, g) and ns.contains(o.grants.get(g).phone) and apps.contains(o.grants.get(g).app))
  def forgetAllOa(o: OAuth, ns: Set[str]): OAuth = revokeAllForgetOa(revokeAllForgetOa(o, ns, "friends"), ns, "peon")
  /** The ghost and inbox side of a forget of `apps` on the numbers `ns`. */
  def forgetGh(gone: Set[int], last: Effect): Ghost =
    { ...gh, audits: gh.audits.union(gone.map(g => ("revoked", g))), revokedEver: gh.revokedEver.union(gone), last: last }

  /**
   * ACC leave one app: hooks.onForget (SVC:829-839) runs the listener, which calls
   * revokeAllFor(e164, app, {forget:true}) (serve.ts:107-112). SD-089 fix: a listener error now stops
   * the leave before the membership goes (SVC:838), so the person can try again.
   */
  action leave(p: str, a: str, listenerFails: bool): bool = all {
    val ns = phonesOf(pf, p)
    val o2 = revokeAllForgetOa(oa, ns, a)
    val gone = forgetGhost(oa, ns, Set(a))
    all {
      ns.size() > 0, pf.member.get((p, a)) != "none", pf.member.get((p, a)) != "removed",
      if (listenerFails) all {
        oa' = oa, ib' = ib, pf' = pf, gh' = { ...gh, last: eff("leave", p, 0, false) },
      } else all {
        oa' = o2,
        ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
        gh' = forgetGh(gone, eff("leave", p, 0, true)),
        // The Network forgets the member: a later join is a new member with no hold.
        pf' = { ...pf, member: pf.member.set((p, a), "removed"), forgotten: pf.forgotten.union(ns.map(n => (n, a))),
                netHeld: pf.netHeld.exclude(Set((p, a))) },
      },
      pc' = pc,
    }
  }

  /**
   * ACC delete everything: onForget for each live membership, then (SD-089 fix, ACC:495)
   * onForgetPhone, which runs the listener with no app: revokeAllFor of every app of the number,
   * also an app with no membership. Then the person is deleted (personForKey is null after).
   */
  action deleteAll(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val o2 = forgetAllOa(oa, ns)
    val gone = forgetGhost(oa, ns, APPS)
    all {
      ns.size() > 0,
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
      gh' = forgetGh(gone, eff("deleteAll", p, 0, true)),
      pf' = { ...pf,
        owner: pf.owner.keys().mapBy(n => if (ns.contains(n)) NONE else pf.owner.get(n)),
        deleted: pf.deleted.union(Set(p)), netHeld: pf.netHeld.filter(k => k._1 != p),
        member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
        forgotten: pf.forgotten.union(tuples(ns, APPS)) },
      pc' = pc,
    }
  }

  /**
   * SVC statedAge with a decline (under 13). SD-089 fix (SVC:1506): forgetPhone(e164) runs the forget
   * listeners with no app first (every app's grants), then forgetMembership on every app.
   */
  action declineUnder13(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val apps = APPS.filter(a => pf.member.get((p, a)) != "none" and pf.member.get((p, a)) != "removed")
    val o2 = forgetAllOa(oa, ns)
    val gone = forgetGhost(oa, ns, APPS)
    all {
      ns.size() > 0, apps.size() > 0,
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
      gh' = forgetGh(gone, eff("decline", p, 0, true)),
      pf' = { ...pf, member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
              minor: pf.minor.union(Set(p)), under13: pf.under13.union(Set(p)), forgotten: pf.forgotten.union(tuples(ns, APPS)),
              netHeld: pf.netHeld.filter(k => k._1 != p) },
      pc' = pc,
    }
  }

  /**
   * packages/platform/src/pg-store.ts:371-377 movePhone: one transaction that also moves
   * oauth.grants.phone_key and (SD-384 fix) oauth.signup_drafts.phone_key to the new number.
   * oauth.sql raises on any grant_cloud_ row, so the whole number change rolls back (SD-108, owned by
   * the identity_sagas model, not fixed on this branch).
   */
  action movePhone(p: str, src: str, dst: str): bool = all {
    src != dst, pf.owner.get(src) == p, p != NONE, pf.owner.get(dst) == NONE,
    not(pf.holdNum.contains(src)), not(pf.holdNum.contains(dst)),
    val cloudRow = REQS.exists(g => oa.grants.get(g).cloud and oa.grants.get(g).phone == src and (oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked"))
    if (cloudRow) all {
      oa' = oa, pf' = pf, gh' = { ...gh, last: eff("movePhoneAborted", p, 0, false) },
    } else all {
      oa' = { ...oa,
        grants: oa.grants.keys().mapBy(g => { val x = oa.grants.get(g); if (x.phone == src and x.st != "none") { ...x, phone: dst } else x }),
        drafts: oa.drafts.keys().mapBy(g => { val d = oa.drafts.get(g); if (d.exists and d.phone == src) { ...d, phone: dst } else d }) },
      // Ghost: a forget recorded for an earlier owner of dst does not cover the person who moves in.
      pf' = { ...pf, owner: pf.owner.set(src, NONE).set(dst, p), forgotten: pf.forgotten.filter(k => k._1 != dst) },
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
      flowFamily(r, c, n, b, b2), clientFamily(r, t), toolFamily(t),
      flowFamily(r, c, n, b, b2), clientFamily(r, t), toolFamily(t),
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

  /** The person signs in and decides on the site. `fails` is a failed insert in the approval transaction. */
  action flowFamily(r: int, c: str, n: str, b: bool, fails: bool): bool = any {
    startAuth(r, c), enterPhone(r, n), enterCode(r), approveRead(r, b), approveCommit(r, fails), approveLink(r),
  }
  /** The client: code exchange, refresh, revocation. */
  action clientFamily(r: int, t: int): bool = any {
    exchCheck(r), exchRedeem(r), exchReplay(r),
    refrCheck(t), refrRotate(t), revokeEndpoint(t), revokeAccessToken(t),
  }
  /** The client calls a tool. */
  action toolFamily(t: int): bool = any { getUpdates(t), checkStatus(t), submitProfile(t), prepareSignup(t) }

  // ================================================================ invariants (from the rules)

  /**
   * SD-019. AGENTS founder 2026-10-09 #3: a banned number is refused at join, OTP and inbound, on every
   * app; SVC "never matched or texted again". No banned person's agent gets inbox data, a tool answer,
   * or past the check of a code exchange or a refresh. Fix: cloudGrantCurrent checks the ban (H:777).
   * A ban that commits while an exchange or a refresh waits between its check and its transaction still
   * lets that one transaction commit; every later use of those tokens fails this check (bearer, refresh).
   */
  val noBannedUse =
    not(Set("getUpdates", "status", "profile", "exchCheck", "refrCheck").contains(gh.last.kind) and gh.last.ok
        and pf.banned.contains(gh.last.person))

  /**
   * SD-184, SD-185. packages/mcp/README.md section 3: "a reused refresh token or code ends the whole
   * grant"; H:668 "A refresh token used twice: someone else has a copy". A replay revocation ends a
   * usable grant only for a credential that was redeemed before (that redemption completed).
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
   * INV-G2, INV-OB1 (tools.ts:249, decisions.ts:11-20, README "New owner"): a tool serves data only on a live grant, and only
   * about the person who consented.
   */
  val servedOnLiveOwnGrant =
    (Set("getUpdates", "status", "profile").contains(gh.last.kind) and gh.last.ok) implies {
      val gr = oa.grants.get(gh.last.grant)
      gr.st == "live" and not(gr.expired) and personForKey(pf, gr.phone) == gr.person and gh.last.person == gr.person
    }

  /**
   * SD-186 part (c), strict form. hooks.ts:69-70 "An assistant was connected (consent granted) or disconnected (grant
   * revoked) for a person", keyed by person and assistant: while a live grant of the person whose
   * approval completed (linked) exists, the signal stays on. Fix: H:182-192.
   *
   * NOT in `safety` (Q-oauth_mcp-2, found by this model after the fix run, not fixed): the fix looks for
   * other live grants on the revoked grant's phone key only (store.grantsFor). When the number moves
   * between the approval's read and its commit, the new grant is stored on the old key (the grant object
   * is built from the request's number, and approveConsent does not check the owner again). Revoking that
   * grant then turns the signal off while the moved grant on the new key is live (`moveDuringApprovalTest`).
   * The random walk and the bounded check do not reach this 16-step trace. A fix needs a code change
   * (look up the person's live grants on every key, or refuse the commit when the request's number has a
   * new owner) with its own integration test.
   */
  val activeKeptWhileLiveAll = PERSONS.forall(p =>
    REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p and pc.appr.get(g) == "done") implies ib.active.contains(p))

  /**
   * SD-186 part (c), in `safety`: `activeKeptWhileLiveAll` for every person who never got a grant stored
   * on a number they no longer own (ghost `oldKey`, the Q-oauth_mcp-2 race). This is what the fix
   * guarantees; the excluded case is the open defect above, not a weaker rule.
   */
  val activeKeptWhileLive = PERSONS.forall(p => not(gh.oldKey.contains(p)) implies
    (REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p and pc.appr.get(g) == "done") implies ib.active.contains(p)))

  /**
   * SD-186 parts (a) and (b), NOT in `safety`: the signal is on exactly when a live grant exists. It
   * fails by design: the documented assistantLinked contract (hooks.ts:69-70) sends the signal on
   * "consent granted" and "grant revoked" only, so an expiry does not clear it (b) and a stop between
   * the approval's commit and linked(true) leaves it off (a). The fix commit c4b97ca left both as they
   * are; a change needs a maintainer decision on the hook contract.
   */
  val activeExactlyGrants = PERSONS.forall(p =>
    not(REQS.exists(g => pc.appr.get(g) == "committed" and oa.grants.get(g).person == p)) implies
      (ib.active.contains(p) iff REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p)))

  /**
   * SD-089, Q-oauth_mcp-1. handler.ts:90-93 and README section 3: after leave or delete everything
   * "nothing keeps the phone next to the app"; AGENTS age policy: under 13 is declined with nothing stored.
   */
  val grantDiesWithPerson = pf.forgotten.forall(na =>
    not(REQS.exists(g => (oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked")
      and oa.grants.get(g).phone == na._1 and oa.grants.get(g).app == na._2)))

  /**
   * SD-428. T:310 "the profile never reaches a stopped or held one"; decisions.ts:27-39 and K:183-185 a held member reads
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
   * SD-389. README section 3 Audit (one row for each consent and code): a stored grant has its code and
   * its consent_granted row.
   */
  val grantHasCodeAndAudit = REQS.forall(g =>
    oa.grants.get(g).st == "live" implies (oa.codes.get(g).st != "none" and gh.audits.contains(("consent_granted", g))))

  /** SD-393. README section 3: "A sign-in request keeps the number only while it is open (at most 10 minutes, then swept)". */
  val requestRetention = REQS.forall(r => (oa.reqs.get(r).live and oa.reqs.get(r).phone != "") implies oa.reqs.get(r).age <= README_REQ_MAX)

  /**
   * SD-390. README section 3: the sweep deletes "registered clients that never got a grant after a
   * day"; client_secret_expires_at 0 (the registration does not expire).
   */
  val clientKeptOnceGranted = CLIENTS.forall(c => not(oa.clients.get(c).exists) implies not(gh.everGranted.contains(c)))

  /** SD-395. README section 2: "At most 5 accepted profiles per grant a day": only accepted ones count. */
  val quotaCountsAccepted = gh.last.kind == "quotaRefused" implies oa.quota.get(gh.last.grant).accepted >= PROFILE_CAP

  /**
   * SD-108, NOT in `safety`. INV-M1 (platform number change, pg-store.ts:371-377): a number change
   * succeeds whatever grants the person has. Still violated (`cloudMoveTest`): the oauth.sql trigger
   * raises on a Cloud grant row. SD-108 belongs to the identity_sagas model and its fix set, not to this
   * branch, and its verdict is disputed (a number change is 409 in Cloud mode).
   */
  val numberChangeWorks = gh.last.kind != "movePhoneAborted"

  /** SD-384. P:61-79: a draft is claimed by its grant's phone key; a live draft keys the same phone as its grant. */
  val draftFollowsGrant = REQS.forall(g =>
    (oa.drafts.get(g).exists and not(oa.drafts.get(g).scrubbed) and oa.grants.get(g).st == "live")
      implies oa.drafts.get(g).phone == oa.grants.get(g).phone)

  val safety = and {
    noBannedUse, replayIsTrue, codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant,
    activeKeptWhileLive, grantDiesWithPerson, heldIsHeld, noIntroToMinor, noStaleUpdate,
    everyRevocationAudited, oneOutcome, grantHasCodeAndAudit, requestRetention, clientKeptOnceGranted,
    quotaCountsAccepted, draftFollowsGrant,
  }

  /** The invariants that the code kept before the fixes (no register defect). */
  val soundCore = and { codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant }

  // ================================================================ witnesses (states that must be reachable)
  /** The full PKCE flow, then get_updates shows an update. */
  val witness_fullFlowUpdate = not(gh.last.kind == "getUpdates" and gh.last.items.size() > 0)
  /** A refresh rotates and mints a new pair. */
  val witness_refreshRotates = not(gh.last.kind == "refresh" and gh.last.ok)
  /** After a revoke, the next tool call is refused (no access token of the grant passes bearer). */
  val witness_revokeStops = not(REQS.exists(g => oa.grants.get(g).st == "revoked"
    and oa.toks.keys().exists(t => oa.toks.get(t).g == g and oa.toks.get(t).kind == "access" and not(oa.toks.get(t).expired))))
  /** A true code or refresh replay revokes the grant. */
  val witness_trueReplay = not(gh.last.kind == "replay" and gh.last.status == "true")
  /** A withheld update is marked seen (SD-183 state; the register refutes the harm). */
  val witness_withheldSeen = not(ITEMS.exists(i => ib.items.get(i).live and ib.items.get(i).leaky and ib.items.get(i).seen))
  /** A person leaves an app and the grants of that app are deleted. */
  val witness_leaveDeletes = not(gh.last.kind == "leave" and gh.last.ok and pf.forgotten.size() > 0
    and REQS.exists(g => oa.grants.get(g).st == "deleted"))
  /** A refresh that loses the race with a revocation or an expiry ends as invalid_grant, not as a replay (SD-185). */
  val witness_refreshStale = not(gh.last.kind == "refreshStale")
  /** A denial that loses the race with an approval denies nothing (SD-397). */
  val witness_denyLoses = not(gh.last.kind == "denyExpired" and gh.granted.contains(gh.last.grant))
  /** A held member reads on_hold (SD-428). */
  val witness_heldReadsOnHold = not(gh.last.kind == "status" and gh.last.status == "on_hold")

  // ================================================================ run tests (traces from the code and its tests)
  /** p1 connects client c on number n with request r and holds its token pair (legacy or Cloud grant). */
  run connectOn(r: int, c: str, n: str, cloud: bool): bool =
    startAuth(r, c).then(enterPhone(r, n)).then(enterCode(r)).then(approveRead(r, cloud))
      .then(approveCommit(r, false)).then(approveLink(r))
      .then(exchCheck(r)).then(exchRedeem(r))
  run connect(r: int, c: str, cloud: bool): bool = connectOn(r, c, "n1", cloud)

  /** oauth.test.ts "full flow: sign in on the page, approve, exchange, check_status". */
  run fullFlowTest =
    init.then(connect(1, "cF", false)).then(checkStatus(1))
      .expect(gh.last.kind == "status" and gh.last.status == "active" and safety and activeExactlyGrants)

  /** oauth.test.ts "a second use of the code revokes what the first issued". */
  run codeReplayTest =
    init.then(connect(1, "cF", false)).then(exchReplay(1))
      .expect(oa.grants.get(1).st == "revoked" and not(bearerOk(1)) and gh.last.status == "true" and safety)

  /** oauth.test.ts "access tokens expire; refresh rotates; a reused refresh token ends the grant". */
  run refreshReplayTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(refrRotate(2))
      .expect(gh.last.kind == "refresh" and gh.last.ok)
      .then(refrCheck(2)).then(refrRotate(2))
      .expect(oa.grants.get(1).st == "revoked" and gh.last.kind == "replay" and gh.last.status == "true"
        and gh.audits.contains(("refresh_replay", 1)) and safety)

  /** SD-019 fix (e2e "a staff ban ends get_updates and refresh on an existing grant"). */
  run banEndsGrantUseTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "probe", false))
      .then(ban("p1"))
      .expect(not(bearerOk(1)) and safety)
      .then(getUpdates(1)).fail()
  run banEndsRefreshTest =
    init.then(connect(1, "cF", false)).then(ban("p1")).then(refrCheck(2)).fail()
  run banEndsExchangeTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(approveLink(1)).then(ban("p1")).then(exchCheck(1)).fail()

  /** SD-184 fix (e2e "a failed token mint leaves the code unused, and the retry gets the tokens"). */
  run codeCrashRetryTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(approveLink(1))
      .then(exchCheck(1)).then(crashExchange(1))
      .expect(oa.codes.get(1).st == "issued" and oa.toks.keys() == Set())
      .then(exchCheck(1)).then(exchRedeem(1))
      .expect(oa.grants.get(1).st == "live" and bearerOk(1) and safety)

  /** SD-185 fix: the grant expires while a refresh waits; rotateRefresh says "stale"; no revocation, no replay row. */
  run refreshExpiredTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(expireGrant(1)).then(refrRotate(2))
      .expect(gh.last.kind == "refreshStale" and oa.grants.get(1).st == "live"
        and not(gh.audits.contains(("refresh_replay", 1))) and safety)

  /** SD-185 fix (e2e "a refresh that waits on a grant revoked meanwhile writes no refresh_replay row"). */
  run refreshRevokedTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(consentsRevoke(1)).then(refrRotate(2))
      .expect(gh.last.kind == "refreshStale" and not(gh.audits.contains(("refresh_replay", 1))) and safety)

  /** SD-089 fix (e2e "an under-13 decline deletes the person's grants on every app"). */
  run declineDeletesGrantTest =
    init.then(connect(1, "cF", false)).then(connect(2, "cP", false))
      .then(declineUnder13("p1"))
      .expect(oa.grants.get(1).st == "deleted" and oa.grants.get(2).st == "deleted"
        and grantDiesWithPerson and everyRevocationAudited and not(ib.active.contains("p1")))

  /** SD-089 fix (e2e "delete everything deletes the grant of an app with no membership"). */
  run deleteAllOtherAppTest =
    init.then(createPerson("n2")).then(join("p2", "peon")).then(connectOn(1, "cF", "n2", false))
      .expect(oa.grants.get(1).person == "p2" and pf.member.get(("p2", "friends")) == "none")
      .then(deleteAll("p2"))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)

  /** SD-089 fix (e2e "a failed forget listener stops the leave, and a retry deletes the grant"). */
  run leaveListenerFailsTest =
    init.then(connect(1, "cF", false))
      .then(leave("p1", "friends", true))
      .expect(pf.member.get(("p1", "friends")) == "active" and liveG(oa, 1) and safety)
      .then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)

  /** Leave runs revokeAllFor with forget: the grant row is deleted (oauth.test.ts "leaving an app deletes the grants"). */
  run leaveDeletesTest =
    init.then(connect(1, "cF", false)).then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and activeExactlyGrants and everyRevocationAudited)

  /** SD-397 fix (e2e "a deny that loses the race with an approve does not answer access_denied"). */
  run approveDenyRaceTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1))
      .then(denyRead(1)).then(approveRead(1, false)).then(approveCommit(1, false)).then(denyFinish(1))
      .expect(gh.last.kind == "denyExpired" and not(gh.audits.contains(("consent_denied", 1))) and oneOutcome and safety)
  /** The other order: the denial deletes the request first; the approval stores nothing. */
  run denyFirstTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1))
      .then(approveRead(1, false)).then(denyRead(1)).then(denyFinish(1)).then(approveCommit(1, false))
      .expect(gh.last.kind == "approveExpired" and oa.grants.get(1).st == "none" and oneOutcome and safety)

  /** SD-214 fix (e2e "a member who becomes a minor does not read an earlier item that names an adult"). */
  run minorIntroTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "intro", false))
      .then(becomeMinor("p1")).then(getUpdates(1))
      .expect(gh.last.items == Set() and not(ib.items.get(1).seen) and noIntroToMinor and safety)

  /** SD-430 fix (e2e "get_updates does not return a probe whose opportunity closed"): reading still marks it seen. */
  run staleProbeTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "probe", false))
      .then(closeOpp(1)).then(getUpdates(1))
      .expect(gh.last.items == Set() and ib.items.get(1).seen and noStaleUpdate and safety)

  /** SD-428 fix (e2e "a member on a staff hold reads on_hold and cannot submit a profile"). */
  run heldActiveTest =
    init.then(connect(1, "cF", false)).then(staffHold("p1")).then(checkStatus(1))
      .expect(gh.last.status == "on_hold" and heldIsHeld)
      .then(submitProfile(1))
      .expect(not(gh.last.ok) and oa.quota.get(1).count == 0 and heldIsHeld and safety)

  /** SD-394 fix (e2e "a tool call that ends the grant writes a consent_revoked row"); the hold stays final. */
  run silentRevokeTest =
    init.then(connect(1, "cF", false)).then(holdNumber("n1")).then(checkStatus(1))
      .expect(oa.grants.get(1).st == "revoked" and gh.audits.contains(("revoked", 1)) and everyRevocationAudited)
      .then(clearHoldSame("n1"))
      .expect(not(bearerOk(1)) and safety)

  /** SD-389 fix: a stop after the approval's commit leaves a grant with its code and its audit row. */
  run consentCrashTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(crashApprove(1))
      .expect(liveG(oa, 1) and oa.codes.get(1).st == "issued" and grantHasCodeAndAudit and safety
        // SD-186 part (a), kept by the hook contract: linked(true) did not run.
        and not(ib.active.contains("p1")) and not(activeExactlyGrants))

  /** SD-389 fix (e2e "a failed code insert stores no grant, and the person can approve again"). */
  run consentInsertFailsTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, true))
      .expect(oa.grants.get(1).st == "none" and oa.reqs.get(1).live and safety)
      .then(approveRead(1, false)).then(approveCommit(1, false)).then(approveLink(1))
      .expect(liveG(oa, 1) and grantHasCodeAndAudit and safety)

  /** SD-393 fix (e2e "a sign-in request with a number is swept 10 minutes after it starts, with no OAuth traffic"). */
  run requestRetentionTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1"))
      .then(tickRequests)
      .expect(oa.reqs.get(1).live and requestRetention)
      .then(tickRequests)
      .expect(not(oa.reqs.get(1).live) and requestRetention)

  /** SD-390 fix (e2e "a client whose grant was revoked and deleted stays registered"). */
  run clientSweptTest =
    init.then(connect(1, "cF", false)).then(consentsRevoke(1)).then(clientAges("cF")).then(sweep)
      .expect(oa.grants.get(1).st == "deleted" and oa.clients.get("cF").exists and clientKeptOnceGranted)
      .then(startAuth(2, "cF"))
      .expect(gh.last.kind == "authorize")
  /** A client that never got a grant is still swept after a day (README section 3). */
  run unusedClientSweptTest =
    init.then(clientAges("cP")).then(sweep)
      .expect(not(oa.clients.get("cP").exists) and clientKeptOnceGranted)

  /** SD-395 fix (e2e "refused profiles do not use up the daily profile quota"). */
  run quotaTest =
    init.then(connectOn(1, "cF", "n2", false))
      .then(submitProfile(1)).then(submitProfile(1)).then(submitProfile(1))
      .expect(gh.last.kind == "profile" and not(gh.last.ok) and oa.quota.get(1).count == 0 and safety)
  /** The quota still stops the third accepted profile of a joined member (cap 2 in the model). */
  run quotaAcceptedTest =
    init.then(connect(1, "cF", false))
      .then(submitProfile(1)).then(submitProfile(1))
      .expect(oa.quota.get(1).accepted == 2)
      .then(submitProfile(1))
      .expect(gh.last.kind == "quotaRefused" and quotaCountsAccepted and safety)

  /** SD-108 trace (not fixed here; identity_sagas): a person with a Cloud grant row cannot change the number. */
  run cloudMoveTest =
    init.then(connect(1, "cF", true)).then(consentsRevoke(1)).then(movePhone("p1", "n1", "n2"))
      .expect(not(numberChangeWorks) and pf.owner.get("n1") == "p1")

  /** SD-186 (c) fix (e2e "revoking one of two live Claude grants keeps the Claude signal active"). */
  run activeTwoGrantsTest =
    init.then(connect(1, "cF", false)).then(connect(2, "cP", false)).then(consentsRevoke(1))
      .expect(liveG(oa, 2) and ib.active.contains("p1") and activeKeptWhileLiveAll and activeExactlyGrants)
      .then(consentsRevoke(2))
      .expect(not(ib.active.contains("p1")) and safety)

  /** Q-oauth_mcp-2 trace: the number moves while an approval waits; revoking the new (old-key) grant turns the signal off. */
  run moveDuringApprovalTest =
    init.then(connect(1, "cF", false)).then(startAuth(2, "cP")).then(enterPhone(2, "n1")).then(enterCode(2))
      .then(approveRead(2, false)).then(movePhone("p1", "n1", "n2")).then(approveCommit(2, false)).then(approveLink(2))
      .expect(oa.grants.get(1).phone == "n2" and oa.grants.get(2).phone == "n1")
      .then(consentsRevoke(2))
      .expect(liveG(oa, 1) and pc.appr.get(1) == "done" and not(ib.active.contains("p1")) and not(activeKeptWhileLiveAll) and gh.oldKey == Set("p1") and safety)

  /** SD-186 (b) trace, kept by the hook contract: the grant expires; the signal stays on. */
  run activeExpiryTest =
    init.then(connect(1, "cF", false)).then(expireGrant(1))
      .expect(ib.active.contains("p1") and not(activeExactlyGrants) and safety)

  /** SD-384 fix (e2e "a signup draft follows its grant to the new number"). */
  run draftMoveTest =
    init.then(leave("p1", "friends", false)).then(connect(2, "cF", false)).then(prepareSignup(1))
      .expect(oa.drafts.get(2).exists)
      .then(movePhone("p1", "n1", "n2"))
      .expect(oa.grants.get(2).phone == "n2" and oa.drafts.get(2).phone == "n2" and draftFollowsGrant and safety)

  /**
   * Q-oauth_mcp-1 fix (consent-forget.pg.test.ts "a grant approved while the person leaves the app does
   * not stay"): the leave deletes the request before the approval's transaction; the approval stores
   * nothing.
   */
  run consentDuringLeaveTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(leave("p1", "friends", false)).then(approveCommit(1, false))
      .expect(gh.last.kind == "approveExpired" and oa.grants.get(1).st == "none" and grantDiesWithPerson and safety)
  /** The other order: the approval commits first (the forget waits on its row lock); the leave deletes the grant. */
  run leaveAfterConsentTest =
    init.then(startAuth(1, "cF")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)
}
```
