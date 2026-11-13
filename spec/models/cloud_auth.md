# Eliza Cloud sign-in and grants

## Story: Eliza Cloud sign-in and grants

An Eliza Cloud member needs to authorize their own access to The Network.

### Safety rules and reachability

Check grant ownership and expiry, ban checks, auth mode, and validation cache behavior. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/cloud_auth.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=20 max-samples=10000 verify-steps=5
// -*- mode: Bluespec; -*-
//
// cloud_auth: the Eliza Cloud sign-in and the validation of Cloud proofs and Cloud MCP grants. This is a
// separate machine from the web OTP session (quint/auth_edge.qnt keeps the OTP challenge, the web session
// rotation, the edge and the svc-auth hop). Module plan: docs/research/2026-11-07-state-machines.md
// section 9.6.2 (`cloud_auth`, items W3-125, W3-126, W3-127, W3-134, W3-373, W3-671).
//
// The model follows the code at e4f0a32:
//   packages/platform/src/api.ts                cloudFor (per-app mode), the callback, cloudSessionStatus and
//                                               its `validated` cache, auth(), authenticatedSiteSession,
//                                               cloudGrantAuthority, validateCloudGrant
//   packages/platform/src/cloud-delegation.ts   productionCloudDelegation.exchange / validate
//   packages/core/src/svc/network-delegation.ts parseNetworkDelegation (skew, one-hour proof life)
//   packages/core/src/svc/proof-window.ts       proofWindowOk, used by the four Cloud-issued profile proofs
//   packages/platform/src/sessions.ts           create, authenticate (no rotation for a Cloud session), revoke
//   packages/platform/src/accounts.ts           createPerson + bindSessions (a person-less session ends)
//
// Proof states: issued (the callback stored it in a session), validated (a live `validated` cache entry,
// api.ts:267), expired (now >= expiresAt), revoked (Cloud denies it: `denied`).
//
// Abstractions (each one is listed so that a reader can check it):
//  - Time is an integer in seconds. `tick` moves it by one of a few named steps.
//  - The Cloud answer is an oracle: `cloudAnswer` computes it from the Cloud state at the moment Cloud
//    answers. A revoked proof, or a proof whose account no longer has that phone, gets "invalid"; any
//    other proof gets "valid" or "unavailable". HMAC and the AES-GCM seal cannot be forged.
//  - One validation is three actions (the awaits of api.ts:277 and 695): the request begins and reads the
//    cache, Cloud answers, the request ends and writes the cache. Other requests run between them.
//  - The Cloud callback is one action. Its awaits (api.ts:439-444) can let a ban commit between the ban
//    check and sessions.create; quint/auth_edge.qnt owns that race (W3-128).
//  - The OTP login is one action here: only its interplay with the per-app mode is in this model.
//  - Two apps (slop, ntwrk), two phones (X, Y), two humans (alice, bob).
//  - A Cloud session never rotates: its expiry is at most the proof expiry, at most one hour after
//    issuedAt (network-delegation.ts:42, api.ts:444), and sessions.ts:53 rotates only after 24 h. So the
//    cache write on rotation (api.ts:330, W3-373) cannot run with the default SESSION_ROTATE_MS. The
//    invariant `cloudSessionNeverRotates` keeps that fact checked.
//  - The 10 000-entry clear (api.ts:280) is the action `cacheClear` (it only removes entries).
//  - A restart (new env) is `restart`: the in-memory cache and the requests in flight are lost.
//  - Assumption (recycled numbers, quint/phone_identity.qnt and auth_edge): when a carrier gives a number
//    with a person to another human, the number is held for staff (accounts.held); the model sets `held`
//    in `recycle`. That keeps the old person out of this model; the 12-month rule itself is not here.
//  - ASSUMPTION ASSUME_CLOUD_PHONE_CURRENT (W3-127, upstream, not confirmed): the phone that Cloud signs
//    into a Network delegation names the current holder of the number. Cloud signs the account's
//    "matching verified phone projection" (docs/results/2026-10-18-production-cloud-network-handoff.md),
//    verified at an earlier time, not a code sent now. The model keeps the assumption in `recycle` (Cloud
//    drops the binding of every other account to that number at once). `recycleStale` is the same
//    carrier event without the assumption; the run tests w3_127StaleProofTest and w3_126NullGrantTest show
//    that `cloudActsForHolder` fails without it. Nothing in this repository can check the assumption.
module cloud_auth {

  // ------------------------------------------------------------------ constants (code values)

  pure val MINUTE = 60
  pure val HOUR = 3600
  pure val DAY = 86400
  // api.ts:266 VALIDATION_TTL_MS (default 60 s).
  pure val VALIDATION_TTL = 60
  // api.ts:102 CLOUD_CLOCK_SKEW_MS (30 s).
  pure val CLOUD_SKEW = 30
  // network-delegation.ts:42: a delegation lives at most one hour after issuedAt.
  pure val PROOF_LIFE = HOUR
  // sessions.ts:13-14.
  pure val SESSION_TTL = 30 * DAY
  pure val SESSION_ROTATE = DAY
  pure val NONE = -1

  pure val APPS = Set("slop", "ntwrk")
  pure val PHONES = Set("X", "Y")
  pure val HUMANS = Set("alice", "bob")
  // The proofs that Cloud issues with its own clock. "login" and "grant" are parsed with
  // CLOUD_CLOCK_SKEW_MS (network-delegation.ts:41, api.ts:438 and 684). The four profile proofs are parsed
  // with proofWindowOk (proof-window.ts:10), which allows no skew: profile-review-owner.ts:55,
  // profile-review-source.ts:68, profile-review-withdrawal.ts:49, profile-review-disconnect.ts:54.
  pure val PROOF_KINDS = Set("login", "grant", "owner", "source", "withdrawal", "disconnect")
  pure def skewAllowed(kind: str): int = if (kind == "login" or kind == "grant") CLOUD_SKEW else 0
  // The Cloud clock is ahead of ours by one of these offsets (seconds).
  pure val OFFSETS = Set(0, 20, 45)

  pure def imin(a: int, b: int): int = if (a < b) a else b

  // ------------------------------------------------------------------ types

  // Auth mode (api.ts:153-193): prod is productionCloud (production-v1 or own-pages-fresh-person-v1,
  // every app is Cloud); "staging-local" makes only the app of NETWORK_CLOUD_AUTH_SITE_ORIGIN Cloud
  // (cloudFor, api.ts:193); "off" is OTP everywhere.
  type Cfg = { name: str, prod: bool, cloudApps: Set[str] }
  // A Network delegation that Cloud issued (the sealed identity cookie holds it).
  type Proof = { human: str, phone: str, app: str, issuedAt: int, expiresAt: int }
  // platform.sessions row. kind "cloud" = token "cloud.…" with its identity cookie; "otp" = any other.
  // person: the owner human of the person on the row ("" = person_id null). human is ghost state: the
  // browser that holds the cookie.
  type Session = { app: str, phone: str, human: str, person: str, proof: int, kind: str,
                   created: int, expires: int, revoked: bool }
  // An OAuth grant with Cloud authority (api.ts:668-680; mcp handler.ts:549). personId "" = null.
  type Grant = { app: str, phone: str, human: str, personId: str, proof: int, expires: int }
  // One cloudSessionStatus or validateCloudGrant call in flight. path: "auth" (auth(), api.ts:314-322),
  // "site" (authenticatedSiteSession, api.ts:660-667), "grant" (cloudGrantAuthority, api.ts:668-680),
  // "gvalid" (validateCloudGrant, api.ts:681-697). answer "" until Cloud answers.
  type Req = { sess: int, grant: int, path: str, startSeq: int, answer: str, answerSeq: int, bannedAtBegin: bool }
  // A `validated` entry (api.ts:267). answered is ghost: the event number of the Cloud answer it came from.
  type Entry = { until: int, answered: int }

  type World = {
    holder: str -> str,        // carrier fact: who holds each number
    cloudPhone: str -> str,    // Cloud: the verified phone of each human's Cloud account ("" = none)
    person: str -> str,        // platform: the owner human of the live person on each number ("" = none)
    held: Set[str],            // accounts.held (staff review)
    banned: Set[str],          // platform.bans by phone hash (founder 2026-10-09 #3)
    proofs: int -> Proof,
    nextProof: int,
    denied: Set[int],          // Cloud revoked these delegations (logout markers, lifecycle)
    grants: int -> Grant,
    nextGrant: int,
  }
  type Sess = { rows: int -> Session, nextSid: int }
  type Flight = {
    reqs: int -> Req,
    nextReq: int,
    seq: int,                  // event counter: Cloud answers and delivered denials
    deniedAns: int -> int,     // ghost, per session: the event number of the newest Cloud denial a request delivered
    deniedAt: int -> int,      // per session: the event number at which that denial was delivered (the fix reads it)
  }
  type Ghost = {
    cloudLogins: int,
    staleLogin: bool,          // a Cloud sign-in for a human who does not hold the number now
    freshAccepts: int,         // a request accepted after a Cloud answer in that request
    cacheAccepts: int,         // a request accepted from the cache, with no Cloud call
    prodCacheAccept: bool,     // the same in a production mode
    revokedCacheAccept: bool,  // accepted from the cache while Cloud already denied the proof
    wrongModeAccept: bool,     // a session of the other auth mode was accepted on an app
    wrongModeLogin: bool,      // a login path ran on an app of the other mode
    foreignAct: bool,          // a Cloud session or grant acted for a person of another human
    expiredAccept: bool,       // a Cloud session or grant was accepted after its proof expired
    grantsValid: int,
    bannedGrantValid: bool,    // a grant validation that began after the ban answered valid
    lateBanGrantValid: bool,   // a grant validation in flight when the ban committed answered valid
    otpRefusedOnCloud: bool,   // an OTP session was refused on an app that is now Cloud
    skewRefused: Set[str],     // proof kinds refused although the Cloud clock was within CLOUD_SKEW
    skewSeen: Set[str],        // proof kinds that arrived with a non-zero Cloud clock offset
  }

  // ------------------------------------------------------------------ state

  var now: int
  var cfg: Cfg
  var world: World
  var sess: Sess
  var cache: int -> Entry
  var flight: Flight
  var ghost: Ghost

  // ------------------------------------------------------------------ helpers

  pure def cfgNamed(n: str): Cfg =
    if (n == "production") { name: n, prod: true, cloudApps: APPS }
    else if (n == "staging-local") { name: n, prod: false, cloudApps: Set("slop") }
    else { name: "off", prod: false, cloudApps: Set() }

  pure def lookup(m: int -> int, k: int, d: int): int = if (m.keys().contains(k)) m.get(k) else d

  // sessions.ts:47-51 authenticate: the row is live (decisions.ts sessionLive). A Cloud row never rotates.
  def rowLive(s: Session, at: int): bool = not(s.revoked) and s.expires > at

  def proofExpired(w: World, pid: int, at: int): bool = w.proofs.get(pid).expiresAt <= at

  // accounts.ts personFor + held: the person a request acts for ("" when the number is held or has none).
  def actsFor(w: World, p: str): str = if (w.held.contains(p)) "" else w.person.get(p)

  // The ghost record of one accepted request for session `sid` (the request then acts for the number).
  def acceptGhost(g: Ghost, s: Session, fromCache: bool): Ghost =
    val wrongMode = (s.kind == "cloud") != cfg.cloudApps.contains(s.app)
    val acted = actsFor(world, s.phone)
    {
      ...g,
      freshAccepts: if (fromCache) g.freshAccepts else g.freshAccepts + 1,
      cacheAccepts: if (fromCache) g.cacheAccepts + 1 else g.cacheAccepts,
      prodCacheAccept: g.prodCacheAccept or (fromCache and cfg.prod),
      revokedCacheAccept: g.revokedCacheAccept or (fromCache and s.kind == "cloud" and world.denied.contains(s.proof)),
      wrongModeAccept: g.wrongModeAccept or wrongMode,
      foreignAct: g.foreignAct or (s.kind == "cloud" and acted != "" and acted != s.human),
      expiredAccept: g.expiredAccept or (s.kind == "cloud" and proofExpired(world, s.proof, now)),
    }

  // ------------------------------------------------------------------ init

  action initWith(n: str): bool = all {
    now' = 0,
    cfg' = cfgNamed(n),
    world' = {
      holder: Map("X" -> "alice", "Y" -> "bob"),
      cloudPhone: Map("alice" -> "X", "bob" -> "Y"),
      person: Map("X" -> "", "Y" -> ""),
      held: Set(),
      banned: Set(),
      proofs: Map(),
      nextProof: 1,
      denied: Set(),
      grants: Map(),
      nextGrant: 1,
    },
    sess' = { rows: Map(), nextSid: 1 },
    cache' = Map(),
    flight' = { reqs: Map(), nextReq: 1, seq: 0, deniedAns: Map(), deniedAt: Map() },
    ghost' = {
      cloudLogins: 0, staleLogin: false, freshAccepts: 0, cacheAccepts: 0, prodCacheAccept: false,
      revokedCacheAccept: false, wrongModeAccept: false, wrongModeLogin: false, foreignAct: false,
      expiredAccept: false, grantsValid: 0, bannedGrantValid: false, lateBanGrantValid: false,
      otpRefusedOnCloud: false, skewRefused: Set(), skewSeen: Set(),
    },
  }

  action init = {
    nondet n = Set("off", "production", "staging-local").oneOf()
    initWith(n)
  }

  // ------------------------------------------------------------------ time and configuration

  action tick(d: int): bool = all {
    d > 0,
    now' = now + d,
    cfg' = cfg, world' = world, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }

  // A deploy with a new env (api.ts:153-193 run once in createPublicApi). The cache (api.ts:267) and the
  // requests in flight are in memory: a restart loses them. Sessions and grants are in Postgres.
  action restart(n: str): bool = all {
    now' = now,
    cfg' = cfgNamed(n),
    world' = world, sess' = sess,
    cache' = Map(),
    flight' = { ...flight, reqs: Map() },
    ghost' = ghost,
  }

  // api.ts:280: above 10 000 entries the whole cache is cleared before the next write.
  action cacheClear: bool = all {
    cache.keys().size() > 0,
    cache' = Map(),
    now' = now, cfg' = cfg, world' = world, sess' = sess, flight' = flight, ghost' = ghost,
  }

  // ------------------------------------------------------------------ logins

  // api.ts:482-499 POST /api/auth/otp/verify (one action here; quint/auth_edge.qnt has the challenge).
  // In a Cloud-mode app the OTP routes answer 409 (api.ts:465, 483): the guard.
  action otpLogin(h: str, p: str, a: str): bool = all {
    not(cfg.cloudApps.contains(a)),
    world.holder.get(p) == h,
    not(world.banned.contains(p)),
    val sid = sess.nextSid
    sess' = { rows: sess.rows.put(sid, { app: a, phone: p, human: h, person: world.person.get(p), proof: NONE,
                                         kind: "otp", created: now, expires: now + SESSION_TTL, revoked: false }),
              nextSid: sid + 1 },
    ghost' = { ...ghost, wrongModeLogin: ghost.wrongModeLogin or cfg.cloudApps.contains(a) },
    now' = now, cfg' = cfg, world' = world, cache' = cache, flight' = flight,
  }

  // api.ts:413-455 GET /api/auth/cloud/callback. cloudFor(app) must be set (404 otherwise, api.ts:414).
  // Cloud exchanges the code for a delegation that names the phone of the Cloud account of `h`
  // (cloud-delegation.ts:22-28). The callback refuses a held, banned or suppressed number (api.ts:439),
  // revokes the old cookie's session (440), creates a "cloud." session that ends with the proof (444) and
  // writes a cache entry for it (447): the exchange is a fresh Cloud answer.
  action cloudLogin(h: str, a: str): bool = {
    val p = world.cloudPhone.get(h)
    val pid = world.nextProof
    val sid = sess.nextSid
    all {
      cfg.cloudApps.contains(a),
      p != "",
      not(world.held.contains(p)),
      not(world.banned.contains(p)),
      world' = { ...world, proofs: world.proofs.put(pid, { human: h, phone: p, app: a, issuedAt: now, expiresAt: now + PROOF_LIFE }),
                 nextProof: pid + 1 },
      sess' = { rows: sess.rows.keys().mapBy(k => val r = sess.rows.get(k)
                                               if (r.human == h and r.app == a) { ...r, revoked: true } else r)
                        .put(sid, { app: a, phone: p, human: h, person: world.person.get(p), proof: pid, kind: "cloud",
                                    created: now, expires: imin(now + SESSION_TTL, now + PROOF_LIFE), revoked: false }),
                nextSid: sid + 1 },
      cache' = cache.put(sid, { until: now + VALIDATION_TTL, answered: flight.seq + 1 }),
      flight' = { ...flight, seq: flight.seq + 1 },
      ghost' = { ...ghost, cloudLogins: ghost.cloudLogins + 1,
                 staleLogin: ghost.staleLogin or world.holder.get(p) != h,
                 wrongModeLogin: ghost.wrongModeLogin or not(cfg.cloudApps.contains(a)),
                 foreignAct: ghost.foreignAct or (actsFor(world, p) != "" and actsFor(world, p) != h) },
      now' = now, cfg' = cfg,
    }
  }

  // ------------------------------------------------------------------ cloud-session-validation

  // The start of one request with the session cookie of `sid` (the browser of its human).
  // api.ts:268-276 cloudSessionStatus up to the Cloud call, then auth() (314-322), authenticatedSiteSession
  // (660-667) or cloudGrantAuthority (668-676) for an answer that needs no Cloud call.
  //  - cloudFor(app) unset: a "cloud." token is "invalid", any other token is "valid" (api.ts:270).
  //  - cloudFor(app) set: no identity cookie (an OTP session) or an expired proof is "invalid", and the
  //    cache entry is deleted (273-274). Outside production a live cache entry answers "valid" (275).
  //  - "invalid" revokes the session row on the auth() path only (api.ts:320).
  action reqBegin(sid: int, path: str): bool = {
    val s = sess.rows.get(sid)
    val cloudApp = cfg.cloudApps.contains(s.app)
    val noCloudInvalid = not(cloudApp) and s.kind == "cloud"
    val noCloudValid = not(cloudApp) and s.kind == "otp"
    val badIdentity = cloudApp and (s.kind == "otp" or proofExpired(world, s.proof, now))
    val cacheHit = cloudApp and not(badIdentity) and not(cfg.prod) and lookup(cache.keys().mapBy(k => cache.get(k).until), sid, 0) > now
    val invalidNow = noCloudInvalid or badIdentity
    val acceptNow = (noCloudValid or cacheHit) and rowLive(s, now)
    val rid = flight.nextReq
    all {
      sess.rows.keys().contains(sid),
      path == "auth" or path == "site" or (path == "grant" and cfg.prod),
      // api.ts:669: cloudGrantAuthority answers undefined for another resource or outside production.
      if (invalidNow) all {
        sess' = if (path == "auth") { ...sess, rows: sess.rows.set(sid, { ...s, revoked: true }) } else sess,
        cache' = if (badIdentity) cache.keys().filter(k => k != sid).mapBy(k => cache.get(k)) else cache,
        flight' = flight,
        world' = world,
        ghost' = { ...ghost, otpRefusedOnCloud: ghost.otpRefusedOnCloud or (cloudApp and s.kind == "otp") },
      } else if (noCloudValid or cacheHit) all {
        // "valid" with no Cloud call, then sessions.authenticate (api.ts:321, 666, 675).
        sess' = sess, cache' = cache, flight' = flight,
        world' = if (acceptNow and path == "grant") grantFrom(world, s) else world,
        ghost' = if (acceptNow) acceptGhost(ghost, s, cacheHit) else ghost,
      } else all {
        // validate() is called (api.ts:277): the request waits for Cloud.
        flight' = { ...flight, reqs: flight.reqs.put(rid, { sess: sid, grant: NONE, path: path, startSeq: flight.seq,
                                                              answer: "", answerSeq: NONE, bannedAtBegin: false }),
                    nextReq: rid + 1 },
        sess' = sess, cache' = cache, world' = world, ghost' = ghost,
      },
      now' = now, cfg' = cfg,
    }
  }

  // api.ts:677-679 cloudGrantAuthority: the sealed authority of the session, then the grant that
  // finishAuthorization creates (mcp handler.ts:549): its personId is the auth request's person
  // (personFor at consent), its expiry is min(session, proof).
  def grantFrom(w: World, s: Session): World =
    { ...w, grants: w.grants.put(w.nextGrant, { app: s.app, phone: s.phone, human: s.human, personId: actsFor(w, s.phone),
                                                 proof: s.proof, expires: imin(s.expires, w.proofs.get(s.proof).expiresAt) }),
            nextGrant: w.nextGrant + 1 }

  // cloud-delegation.ts:29-40 validate (production) and api.ts:285-300 (staging-local): Cloud answers
  // for the delegation at this moment. Cloud rechecks owner, phone and logout markers: a revoked
  // delegation, or one whose account no longer has that phone, is "invalid" (403 ok:false).
  action cloudAnswer(rid: int, up: bool): bool = {
    val r = flight.reqs.get(rid)
    val pid = if (r.grant != NONE) world.grants.get(r.grant).proof else sess.rows.get(r.sess).proof
    val pr = world.proofs.get(pid)
    val deny = world.denied.contains(pid) or world.cloudPhone.get(pr.human) != pr.phone
    all {
      flight.reqs.keys().contains(rid),
      r.answer == "",
      flight' = { ...flight, seq: flight.seq + 1,
                  reqs: flight.reqs.set(rid, { ...r, answer: if (deny) "invalid" else if (up) "valid" else "unavailable",
                                                     answerSeq: flight.seq + 1 }) },
      now' = now, cfg' = cfg, world' = world, sess' = sess, cache' = cache, ghost' = ghost,
    }
  }

  // api.ts:278-283: the end of cloudSessionStatus, then the caller. An expired proof is "invalid" (278).
  // "valid" writes the cache entry (281); anything else deletes it (282). Then:
  //  auth():                   "invalid" revokes the row (320), "unavailable" answers 503 (319, 706),
  //                            "valid" runs sessions.authenticate (321).
  //  authenticatedSiteSession: "invalid" answers undefined and does NOT revoke the row (665).
  //  cloudGrantAuthority:      "valid" and a live row give the grant authority (675-679).
  // `genFix` is the proposed fix of W3-671 (a generation counter): a positive answer is stored only when
  // no denial for the session was delivered after this request began. The code today is genFix = false.
  action reqEndWith(rid: int, genFix: bool): bool = {
    val r = flight.reqs.get(rid)
    val s = sess.rows.get(r.sess)
    val status = if (proofExpired(world, s.proof, now)) "invalid" else r.answer
    val store = status == "valid" and (not(genFix) or lookup(flight.deniedAt, r.sess, NONE) < r.startSeq)
    val cloudDenial = r.answer == "invalid"
    val accept = status == "valid" and rowLive(s, now)
    all {
      flight.reqs.keys().contains(rid),
      r.grant == NONE,
      r.answer != "",
      cache' = if (store) cache.put(r.sess, { until: now + VALIDATION_TTL, answered: r.answerSeq })
               else if (status == "valid") cache
               else cache.keys().filter(k => k != r.sess).mapBy(k => cache.get(k)),
      flight' = { ...flight,
                  reqs: flight.reqs.keys().filter(k => k != rid).mapBy(k => flight.reqs.get(k)),
                  seq: if (cloudDenial) flight.seq + 1 else flight.seq,
                  deniedAns: if (cloudDenial) flight.deniedAns.put(r.sess, r.answerSeq) else flight.deniedAns,
                  deniedAt: if (cloudDenial) flight.deniedAt.put(r.sess, flight.seq + 1) else flight.deniedAt },
      sess' = if (status == "invalid" and r.path == "auth") { ...sess, rows: sess.rows.set(r.sess, { ...s, revoked: true }) } else sess,
      world' = if (accept and r.path == "grant") grantFrom(world, s) else world,
      ghost' = if (accept) acceptGhost(ghost, s, false) else ghost,
      now' = now, cfg' = cfg,
    }
  }

  action reqEnd(rid: int): bool = reqEndWith(rid, false)

  // ------------------------------------------------------------------ Cloud MCP grants (validateCloudGrant)

  // api.ts:681-694 validateCloudGrant before the Cloud call: the authority is bound to app, resource and
  // phone, issuedAt within the skew, not expired; grant.personId is null or the number's owner (693); the
  // number is not held, banned or suppressed. A refusal answers "invalid" at once (no request in flight).
  // mcp handler.ts:775-786 cloudGrantCurrent checks the ban first as well.
  action grantBegin(gid: int): bool = {
    val g = world.grants.get(gid)
    val ok = g.expires > now and (g.personId == "" or g.personId == world.person.get(g.phone))
             and not(world.held.contains(g.phone)) and not(world.banned.contains(g.phone))
    val rid = flight.nextReq
    all {
      cfg.prod,
      world.grants.keys().contains(gid),
      flight' = if (ok) { ...flight, reqs: flight.reqs.put(rid, { sess: NONE, grant: gid, path: "gvalid", startSeq: flight.seq,
                                                                    answer: "", answerSeq: NONE,
                                                                    bannedAtBegin: world.banned.contains(g.phone) }),
                          nextReq: rid + 1 }
                else flight,
      now' = now, cfg' = cfg, world' = world, sess' = sess, cache' = cache, ghost' = ghost,
    }
  }

  // api.ts:695-696: the Cloud answer, then "invalid" when the authority expired during the call.
  // A "valid" grant then acts (mcp tools: grantStillTheirs(personId, personForKey(phoneKey))): for its
  // personId, or for the number's person when personId is null.
  action grantEnd(rid: int): bool = {
    val r = flight.reqs.get(rid)
    val g = world.grants.get(r.grant)
    val valid = r.answer == "valid" and now < g.expires
    val acted = if (g.personId != "") g.personId else actsFor(world, g.phone)
    all {
      flight.reqs.keys().contains(rid),
      r.grant != NONE,
      r.answer != "",
      flight' = { ...flight, reqs: flight.reqs.keys().filter(k => k != rid).mapBy(k => flight.reqs.get(k)) },
      ghost' = if (valid) { ...ghost, grantsValid: ghost.grantsValid + 1,
                            bannedGrantValid: ghost.bannedGrantValid or r.bannedAtBegin,
                            lateBanGrantValid: ghost.lateBanGrantValid or (world.banned.contains(g.phone) and not(r.bannedAtBegin)),
                            foreignAct: ghost.foreignAct or (acted != "" and acted != g.human),
                            expiredAccept: ghost.expiredAccept or proofExpired(world, g.proof, now) }
               else ghost,
      now' = now, cfg' = cfg, world' = world, sess' = sess, cache' = cache,
    }
  }

  // ------------------------------------------------------------------ other actors

  // Cloud revokes one delegation (logout marker, lifecycle, owner change).
  action cloudRevoke(pid: int): bool = all {
    world.proofs.keys().contains(pid),
    not(world.denied.contains(pid)),
    world' = { ...world, denied: world.denied.union(Set(pid)) },
    now' = now, cfg' = cfg, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }

  // A human verifies the phone they hold now on their Cloud account.
  action cloudBind(h: str, p: str): bool = all {
    world.holder.get(p) == h,
    world' = { ...world, cloudPhone: world.cloudPhone.set(h, p) },
    now' = now, cfg' = cfg, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }

  // The carrier gives number p to human h (after the 45-day aging). With ASSUME_CLOUD_PHONE_CURRENT, Cloud
  // drops the binding of every other account to p at once. A number with a person goes on hold.
  action recycleWith(p: str, h: str, assumeCloudCurrent: bool): bool = all {
    world.holder.get(p) != h,
    world' = { ...world,
               holder: world.holder.set(p, h),
               cloudPhone: if (assumeCloudCurrent) HUMANS.mapBy(x => if (x != h and world.cloudPhone.get(x) == p) "" else world.cloudPhone.get(x))
                           else world.cloudPhone,
               held: if (world.person.get(p) != "") world.held.union(Set(p)) else world.held },
    now' = now, cfg' = cfg, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }
  action recycle(p: str, h: str): bool = recycleWith(p, h, true)
  // The same carrier event without the assumption (W3-127): Cloud keeps the earlier holder's binding.
  action recycleStale(p: str, h: str): bool = recycleWith(p, h, false)

  // A text join (service.ts join path, accounts.createPerson): the holder gets a person on p, and every
  // person-less session of p ends (bindSessions, SD-054 fix). OAuth grants are not touched.
  action textJoin(p: str): bool = all {
    world.person.get(p) == "",
    not(world.banned.contains(p)),
    world' = { ...world, person: world.person.set(p, world.holder.get(p)) },
    sess' = { ...sess, rows: sess.rows.keys().mapBy(k => val r = sess.rows.get(k)
                                                     if (r.phone == p and r.person == "") { ...r, revoked: true } else r) },
    now' = now, cfg' = cfg, cache' = cache, flight' = flight, ghost' = ghost,
  }

  // Staff ban a number (service.ts ban path): bans are by phone.
  action ban(p: str): bool = all {
    not(world.banned.contains(p)),
    world' = { ...world, banned: world.banned.union(Set(p)) },
    now' = now, cfg' = cfg, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }

  // ------------------------------------------------------------------ Cloud-issued proof clock skew (SD-308)

  // A proof of `kind` arrives from Cloud, issued on a Cloud clock `off` seconds ahead of ours, with a
  // lifetime inside the parser's maximum. The parser accepts it when issuedAt <= now + skewAllowed(kind)
  // (network-delegation.ts:41 for login and grant; proof-window.ts:10 for the profile proofs).
  action proofArrives(kind: str, off: int): bool = {
    val accepted = off <= skewAllowed(kind)
    all {
      ghost' = { ...ghost,
                 skewSeen: if (off > 0) ghost.skewSeen.union(Set(kind)) else ghost.skewSeen,
                 skewRefused: if (not(accepted) and off <= CLOUD_SKEW) ghost.skewRefused.union(Set(kind)) else ghost.skewRefused },
      now' = now, cfg' = cfg, world' = world, sess' = sess, cache' = cache, flight' = flight,
    }
  }

  // ------------------------------------------------------------------ step

  pure val TICKS = Set(1, 30, 61, HOUR)

  action step = {
    nondet h = HUMANS.oneOf()
    nondet p = PHONES.oneOf()
    nondet a = APPS.oneOf()
    nondet d = TICKS.oneOf()
    nondet up = Set(true, false).oneOf()
    nondet path = Set("auth", "site", "grant").oneOf()
    nondet n = Set("off", "production", "staging-local").oneOf()
    nondet kind = PROOF_KINDS.oneOf()
    nondet off = OFFSETS.oneOf()
    any {
      // The login and request flow.
      otpLogin(h, p, a),
      cloudLogin(h, a),
      all { sess.rows.keys().size() > 0, nondet sid = sess.rows.keys().oneOf() reqBegin(sid, path) },
      all { flight.reqs.keys().size() > 0, nondet rid = flight.reqs.keys().oneOf() any {
        cloudAnswer(rid, up), reqEnd(rid), grantEnd(rid) } },
      all { world.grants.keys().size() > 0, nondet gid = world.grants.keys().oneOf() grantBegin(gid) },
      // Time, Cloud, the carrier, staff and the deploy: one branch, so that the flow above gets most steps.
      any {
        tick(d),
        all { world.proofs.keys().size() > 0, nondet pid = world.proofs.keys().oneOf() cloudRevoke(pid) },
        cloudBind(h, p),
        recycle(p, h),
        textJoin(p),
        ban(p),
        restart(n),
        cacheClear,
        proofArrives(kind, off),
      },
    }
  }

  // ------------------------------------------------------------------ invariants

  // W3-671 / W3-373. api.ts:264-265: "A positive Cloud validation is reused for 60 seconds per session
  // ... A denial is never cached." So a live cache entry never comes from a Cloud answer that is older
  // than a Cloud denial for the same session that a request already delivered. VIOLATED by the code
  // (staging-local and dev only): a late positive answer overwrites the denial (Q trace in
  // quint-findings/cloud_auth.md, run test w3_671LateValidTest).
  val denialNeverCached = cache.keys().forall(k =>
    cache.get(k).until <= now or cache.get(k).answered > lookup(flight.deniedAns, k, NONE))

  // api.ts:275 and auth_edge `unavailableNoAccess`: in a production Cloud mode every request asks Cloud;
  // no request is accepted from the cache.
  val prodNoCacheAccept = not(ghost.prodCacheAccept)

  // W3-125. api.ts:193 cloudFor, 270, 273, 465, 483, 405, 414: each app has one auth mode at a time. A
  // login path runs only on an app of its mode, and a session is accepted only on an app of its mode
  // (an OTP session on a Cloud app has no identity cookie; a Cloud token on an OTP app is "invalid").
  val authModeMatches = not(ghost.wrongModeAccept) and not(ghost.wrongModeLogin)

  // W3-127, W3-126. AGENTS.md decision 9 ("phone login is the identity check") and accounts.ts:300-304
  // (a session must never act for the person of a later holder of the number): a Cloud session or a
  // Cloud grant acts only for a person of its own human. Holds under ASSUME_CLOUD_PHONE_CURRENT only.
  val cloudActsForHolder = not(ghost.foreignAct) and not(ghost.staleLogin)

  // AGENTS.md founder decisions 2026-10-09 #3 (bans by phone; MCP included) and mcp handler.ts:776: a
  // grant validation that began after the ban committed never answers "valid". A ban that commits while
  // the Cloud call is in flight is concurrent with it (witness_lateBanGrantValid), as SD-013's remainder.
  val bannedGrantRefused = not(ghost.bannedGrantValid)

  // api.ts:274, 278, 685, 696 and network-delegation.ts:41: an expired proof never authorizes a request.
  val expiredNeverAccepted = not(ghost.expiredAccept)

  // W3-134 / SD-308. cloud-delegation.ts:7-8 ("Cloud issues issuedAt on its own clock") and api.ts:101-102:
  // a Cloud-issued proof whose Cloud clock is at most CLOUD_SKEW ahead of ours is accepted. svc-auth.ts
  // accepts 60 s of skew on the same responses. VIOLATED by the four profile proof parsers (proofWindowOk
  // allows 0 s): run test w3_134SkewTest.
  val cloudProofSkewTolerated = ghost.skewRefused == Set()

  // W3-373 (the rotation write of api.ts:330): a Cloud session ends before sessions.ts:53 would rotate it.
  val cloudSessionNeverRotates = sess.rows.keys().forall(k =>
    val r = sess.rows.get(k)
    r.kind != "cloud" or r.expires - r.created < SESSION_ROTATE)

  val safety = and {
    denialNeverCached,
    prodNoCacheAccept,
    authModeMatches,
    cloudActsForHolder,
    bannedGrantRefused,
    expiredNeverAccepted,
    cloudProofSkewTolerated,
    cloudSessionNeverRotates,
  }

  // ------------------------------------------------------------------ witnesses (each must be violated)

  val witness_cloudLogin = ghost.cloudLogins == 0
  val witness_freshAccept = ghost.freshAccepts == 0
  // Outside production a request is accepted from the cache.
  val witness_cacheAccept = ghost.cacheAccepts == 0
  // By design (api.ts:264): a revocation that no request has seen yet is accepted from the cache for up
  // to VALIDATION_TTL. This is not the W3-671 defect (no denial was delivered).
  val witness_revokedWithinTtl = not(ghost.revokedCacheAccept)
  val witness_grantValid = ghost.grantsValid == 0
  val witness_lateBanGrantValid = not(ghost.lateBanGrantValid)
  // W3-125: after a switch to a Cloud mode an OTP session is refused on that app.
  val witness_otpRefusedOnCloud = not(ghost.otpRefusedOnCloud)
  // A Cloud clock ahead of ours by less than the skew is seen (login, grant or profile proofs).
  val witness_skewSeen = ghost.skewSeen == Set()

  // ------------------------------------------------------------------ run tests (concrete traces)

  // Production: alice signs in with Cloud on slop; the next request asks Cloud (no cache) and is accepted.
  run cloudLoginTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "auth"))
      .expect(flight.reqs.keys() == Set(1) and ghost.cacheAccepts == 0)
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .expect(ghost.freshAccepts == 1 and ghost.cloudLogins == 1 and safety)

  // W3-671 (code, staging-local or dev): request A's validate() is in flight; Cloud revokes the
  // delegation; request B (authenticatedSiteSession: the MCP authorize page) gets "invalid" and deletes
  // the cache entry, but does not revoke the row (api.ts:665); A's late "valid" writes the entry again
  // (api.ts:281). Request C is then accepted from the cache with no Cloud call, after a denial.
  run w3_671LateValidTest =
    initWith("staging-local")
      .then(cloudLogin("alice", "slop"))
      .then(tick(61))
      .then(reqBegin(1, "auth"))                 // A, rid 1
      .then(cloudAnswer(1, true))                // Cloud says valid for A
      .then(cloudRevoke(1))                      // Cloud revokes the delegation
      .then(reqBegin(1, "site"))                 // B, rid 2
      .then(cloudAnswer(2, true))                // Cloud denies B
      .then(reqEnd(2))                           // B deletes the entry; the row stays live
      .expect(not(cache.keys().contains(1)) and denialNeverCached)
      .then(reqEnd(1))                           // A's late valid writes the entry
      .expect(cache.keys().contains(1) and not(denialNeverCached))
      .then(reqBegin(1, "auth"))                 // C: accepted from the cache
      .expect(ghost.cacheAccepts == 1 and ghost.revokedCacheAccept and not(denialNeverCached))

  // The proposed fix (generation counter): A's answer is not stored, because a denial arrived after A
  // began. C then asks Cloud again.
  run w3_671FixTest =
    initWith("staging-local")
      .then(cloudLogin("alice", "slop"))
      .then(tick(61))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(cloudRevoke(1))
      .then(reqBegin(1, "site"))
      .then(cloudAnswer(2, true))
      .then(reqEndWith(2, true))
      .then(reqEndWith(1, true))
      .expect(not(cache.keys().contains(1)) and denialNeverCached)
      .then(reqBegin(1, "auth"))
      .expect(ghost.cacheAccepts == 0 and flight.reqs.keys() == Set(3) and denialNeverCached)

  // Production has no such window: the same trace accepts nothing from the cache (api.ts:275).
  run w3_671ProductionTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(cloudRevoke(1))
      .then(reqBegin(1, "site"))
      .then(cloudAnswer(2, true))
      .then(reqEnd(2))
      .then(reqEnd(1))
      .then(reqBegin(1, "auth"))
      .expect(ghost.cacheAccepts == 0 and flight.reqs.keys() == Set(3) and prodNoCacheAccept)

  // W3-373: outside production a revocation that no request has seen is accepted from the cache for up
  // to 60 s (by design); after the TTL the next request asks Cloud and the denial revokes the row.
  run w3_373CacheTtlTest =
    initWith("staging-local")
      .then(cloudLogin("alice", "slop"))
      .then(cloudRevoke(1))
      .then(reqBegin(1, "auth"))
      .expect(ghost.cacheAccepts == 1 and ghost.revokedCacheAccept and safety)
      .then(tick(61))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .expect(sess.rows.get(1).revoked and not(cache.keys().contains(1)) and safety)

  // W3-125: staging-local makes only slop Cloud. ntwrk keeps OTP; slop refuses OTP; a restart into the
  // production mode refuses the ntwrk OTP session (no identity cookie) and revokes it.
  run w3_125PerAppModeTest =
    initWith("staging-local")
      .then(otpLogin("alice", "X", "ntwrk"))
      .expect(sess.rows.keys() == Set(1))
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "auth"))
      .expect(ghost.freshAccepts == 1 and safety)
      .then(restart("production"))
      .then(reqBegin(1, "auth"))
      .expect(sess.rows.get(1).revoked and ghost.otpRefusedOnCloud and ghost.freshAccepts == 1 and safety)
      .then(restart("off"))
      .then(reqBegin(2, "auth"))
      .expect(sess.rows.get(2).revoked and ghost.freshAccepts == 1 and safety)

  // W3-125: the guards. OTP verify answers 409 on a Cloud app, the Cloud callback 404 on an OTP app.
  run w3_125GuardsTest =
    initWith("staging-local")
      .then(otpLogin("alice", "X", "slop"))
      .fail()

  run w3_125CloudGuardTest =
    initWith("staging-local")
      .then(cloudLogin("alice", "ntwrk"))
      .fail()

  // W3-127 with the assumption: the carrier gives Y to alice, Cloud drops bob's binding, so bob cannot
  // sign in on Y any more.
  run w3_127AssumptionTest =
    initWith("production")
      .then(recycle("Y", "alice"))
      .then(cloudLogin("bob", "slop"))
      .fail()

  // W3-127 without the assumption (the model error, now an explicit assumption): Cloud keeps bob's
  // verified phone Y after the carrier gives Y to alice; alice joins by text; bob signs in with Cloud
  // and his session acts for alice's person. `cloudActsForHolder` fails: the invariant is not vacuous.
  run w3_127StaleProofTest =
    initWith("production")
      .then(recycleStale("Y", "alice"))
      .then(textJoin("Y"))
      .then(cloudLogin("bob", "slop"))
      .expect(ghost.staleLogin and ghost.foreignAct and not(cloudActsForHolder))

  // W3-126: bob gets a Cloud grant on Y while Y has no person (personId null). Without the assumption,
  // the carrier gives Y to alice and alice joins by text: the grant passes the owner check of api.ts:693
  // (null personId) and Cloud's answer, and acts for alice's person.
  run w3_126NullGrantTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .expect(world.grants.keys() == Set(1) and world.grants.get(1).personId == "")
      .then(recycleStale("Y", "alice"))
      .then(textJoin("Y"))
      .then(grantBegin(1))
      .then(cloudAnswer(2, true))
      .then(grantEnd(2))
      .expect(ghost.grantsValid == 1 and ghost.foreignAct and not(cloudActsForHolder))

  // W3-126 with the assumption: Cloud denies the earlier holder's delegation; the grant is not valid.
  run w3_126AssumptionTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(recycle("Y", "alice"))
      .then(textJoin("Y"))
      .then(grantBegin(1))
      .then(cloudAnswer(2, true))
      .then(grantEnd(2))
      .expect(ghost.grantsValid == 0 and safety)

  // Bans by phone: a grant validation that begins after the ban is refused before the Cloud call; one
  // in flight when the ban commits can still answer valid (concurrent, like SD-013's remainder).
  run banGrantTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(grantBegin(1))
      .then(ban("X"))
      .then(cloudAnswer(2, true))
      .then(grantEnd(2))
      .expect(ghost.lateBanGrantValid and safety)
      .then(grantBegin(1))
      .expect(flight.reqs == Map() and safety)

  // An expired proof: the grant answers "invalid" after a Cloud call that outlived the authority
  // (api.ts:696), and the session answers "invalid" before any Cloud call (api.ts:274).
  run expiryTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(grantBegin(1))
      .then(cloudAnswer(2, true))
      .then(tick(HOUR))
      .then(grantEnd(2))
      .expect(ghost.grantsValid == 0 and safety)
      .then(reqBegin(1, "auth"))
      .expect(sess.rows.get(1).revoked and flight.reqs == Map() and safety)

  // api.ts:278: the proof expires while validate() is in flight; Cloud's late "valid" is not used and
  // the auth() path revokes the row.
  run sessionExpiryInFlightTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(tick(HOUR))
      .then(reqEnd(1))
      .expect(ghost.freshAccepts == 0 and sess.rows.get(1).revoked and expiredNeverAccepted)

  // W3-134 / SD-308: a Cloud clock 20 s ahead. The login and grant parsers accept the proof (30 s skew);
  // the profile-review owner proof is refused (proofWindowOk allows 0 s).
  run w3_134SkewTest =
    initWith("off")
      .then(proofArrives("login", 20))
      .then(proofArrives("grant", 20))
      .expect(cloudProofSkewTolerated)
      .then(proofArrives("owner", 20))
      .expect(not(cloudProofSkewTolerated) and ghost.skewRefused == Set("owner"))
      .then(proofArrives("login", 45))
      .expect(ghost.skewRefused == Set("owner"))
}
```
