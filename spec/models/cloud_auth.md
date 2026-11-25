# Eliza Cloud sign-in and grants

## Story: Eliza Cloud sign-in and grants

An Eliza Cloud member needs to authorize their own access to The Network.

### Safety rules and reachability

Check grant ownership and expiry, ban checks, auth mode, and validation cache behavior. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [Cloud sign-in spec](../cloudSignIn.md) generates the platform callback machine. The VibeLang shell uses it from handoff through the stored session. The [Cloud authority spec](../cloudAuthority.md) generates per-request site proof, cache, and grant eligibility decisions. The staging callback and the production delegation parser permit up to 30 seconds of future issue time (`cloudIdentityTimesValid`). Grant and profile proof checks require an issue time no later than the local clock. This standalone model compares a request's start with the latest cache invalidation to represent the runtime's in-flight validation rounds. It also covers app configuration and storage-level interactions.

Imported from `quint/cloud_auth.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=20 max-samples=40000 verify-steps=5
// -*- mode: Bluespec; -*-
//
// cloud_auth: the Eliza Cloud sign-in and the validation of Cloud proofs and Cloud MCP grants. This is a
// separate machine from the web OTP session (quint/auth_edge.qnt keeps the OTP challenge, the web session
// rotation, the edge and the svc-auth hop). Module plan: docs/research/2026-11-07-state-machines.md
// section 9.6.2 (`cloud_auth`, items W3-125, W3-126, W3-127, W3-134, W3-373, W3-671).
//
// Compared with the code on branch vibestack-matching on 2026-11-18 (locations are by function name):
//   packages/platform/src/api.ts                cloudFor (per-app mode), "GET /api/auth/cloud/callback" with
//                                               completeCloudSignIn (spec/cloudSignIn.md), cloudSessionStatus
//                                               with its `validated` cache and `validationRounds`, auth(),
//                                               authenticatedSiteSession, cloudGrantAuthority, validateCloudGrant
//   packages/platform/src/cloud-delegation.ts   productionCloudDelegation.exchange / validate
//   packages/core/src/svc/network-delegation.ts parseNetworkDelegation (cloudIdentityTimesValid: skew and one-hour proof life)
//   packages/core/src/svc/profile-review-*.ts  owner, source, withdrawal and disconnect proof windows
//   packages/platform/src/sessions.ts           create, authenticate (rotation after 24 h), revoke
//   packages/platform/src/pg-store.ts           admitMembership and attachPerson: only the joining session
//                                               gets the new person, every other person-less session of the
//                                               number ends (AE-3 fixed on 2026-11-21; see textJoin)
//
// Proof states: issued (the callback stored it in a session), validated (a live `validated` cache entry,
// api.ts), expired (now >= expiresAt), revoked (Cloud denies it: `denied`).
//
// Abstractions (each one is listed so that a reader can check it):
//  - Time is an integer in seconds. `tick` moves it by one of a few named steps.
//  - The Cloud answer is an oracle: `cloudAnswer` computes it from the Cloud state at the moment Cloud
//    answers. A revoked proof, or a proof whose account no longer has that phone, gets "invalid"; any
//    other proof gets "valid" or "unavailable". HMAC and the AES-GCM seal cannot be forged.
//  - One validation is three actions (the awaits of cloudSessionStatus and validateCloudGrant): the
//    request begins and reads the cache, Cloud answers, the request ends and writes the cache. Other
//    requests run between them. The code's `validationRounds` (one round object per session, deleted at
//    each cache clear) is modelled by `invalidatedAt` and the request's `startSeq`
//    (cloudCachePublication: publish only a positive answer of the current round, outside production).
//  - The Cloud callback is one action. Its awaits (completeCloudSignIn: phoneAllowed, then
//    endPreviousSession, recordPhoneSeen, findPersonId, createSession) can let a ban commit between the
//    ban check and sessions.create; auth_edge owns that race (W3-128).
//  - The OTP login is one action here: only its interplay with the per-app mode is in this model.
//  - Two apps (slop, ntwrk), two phones (X, Y), two humans (alice, bob).
//  - A Cloud session never rotates: its expiry is at most the proof expiry (sessionDeadline with the
//    identity expiry), and SessionService.authenticate rotates only after 24 h. The staging-local
//    callback (parseCloudIdentity in api.ts) and the production parser (parseNetworkDelegation) both call
//    cloudIdentityTimesValid of spec/cloudSignIn.md, which caps the proof at one hour after issuedAt
//    (cloudProofLifeValid). W3-373 closed on 2026-11-22: the staging callback had no cap, and a longer
//    staging proof gave a Cloud session that could rotate. rotatedCookies no longer reseals a Cloud
//    identity, because a Cloud session never reaches the rotation age. PROOF_LIFE holds for every mode,
//    and the invariant `cloudSessionNeverRotates` checks it.
//  - The 10 000-entry clear (publishCloudValidation) is the action `cacheClear` (it only removes entries).
//  - A restart (new env) is `restart`: the in-memory cache and the requests in flight are lost.
//  - Assumption (recycled numbers, phone_identity and auth_edge): when a carrier gives a number with a
//    person to another human, the number is held for staff (accounts.held); the model sets `held` in
//    `recycle`. That keeps the old person out of this model; the 12-month rule itself is not here.
//  - ASSUMPTION ASSUME_CARRIER_AGING (environment, the same as auth_edge; no code enforces it): a
//    disconnected number ages at least 45 days before the carrier gives it to another human, so every
//    Cloud proof for that number (at most one hour in production) has expired at the reassignment. Then
//    every Cloud session and Cloud grant of the earlier holder has ended with its proof. OTP sessions of
//    the earlier holder (30 days, rotated every 24 h) can still be live; auth_edge covers them
//    (staleSessionNoAct, AE-3). The step uses `recycle` (both assumptions). The assumption does NOT hold
//    for a number that is handed over without aging: `recycleUnaged` and `recycleStale` drop it, and the
//    trace w3_126NullGrantTest shows what then breaks.
//  - AE-3 (fixed on 2026-11-21, recorded in auth_edge): `textJoin` is the code: a text join has no joining
//    session, so every person-less session of the number ends (SD-054; pg-store.ts attachPerson). Without
//    carrier aging, a Cloud request that Cloud answered "valid" before the reassignment then acts for
//    nobody (ae3IntendedRevokesTest). Before the fix the code gave those sessions the new person.
//  - AE-5 (closed 2026-11-21): parseNetworkDelegation calls cloudIdentityTimesValid of
//    spec/cloudSignIn.md, so the production exchange and validation allow the same 30 s of issue time
//    ahead of the local clock as the staging callback (cloudProofClockRules, cloudSkewKind). The other
//    proof kinds keep 0 s.
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
  // api.ts VALIDATION_TTL_MS (default 60 s).
  pure val VALIDATION_TTL = 60
  // api.ts CLOUD_CLOCK_SKEW_MS (30 s).
  pure val CLOUD_SKEW = 30
  // spec/cloudSignIn.md cloudProofLifeMs: a Cloud proof lives at most one hour after issuedAt, in every mode.
  pure val PROOF_LIFE = HOUR
  // sessions.ts.
  pure val SESSION_TTL = 30 * DAY
  pure val SESSION_ROTATE = DAY
  pure val NONE = -1

  pure val APPS = Set("slop", "ntwrk")
  pure val PHONES = Set("X", "Y")
  pure val HUMANS = Set("alice", "bob")
  pure val PROOF_KINDS = Set("staging-login", "production-delegation", "grant", "owner", "source", "withdrawal", "disconnect")
  // The Cloud sign-in identity (cloudIdentityTimesValid in spec/cloudSignIn.md) in staging and in production.
  pure def cloudSkewKind(kind: str): bool = kind == "staging-login" or kind == "production-delegation"
  pure def skewAllowed(kind: str): int = if (cloudSkewKind(kind)) CLOUD_SKEW else 0
  // Cloud issue time relative to the local time, in seconds.
  pure val OFFSETS = Set(-1, 0, 20, 30, 31)

  pure def imin(a: int, b: int): int = if (a < b) a else b

  // ------------------------------------------------------------------ types

  // Auth mode (api.ts): prod is productionCloud (production-v1 or own-pages-fresh-person-v1,
  // every app is Cloud); "staging-local" makes only the app of NETWORK_CLOUD_AUTH_SITE_ORIGIN Cloud
  // (cloudFor, api.ts); "off" is OTP everywhere.
  type Cfg = { name: str, prod: bool, cloudApps: Set[str] }
  // A Network delegation that Cloud issued (the sealed identity cookie holds it).
  type Proof = { human: str, phone: str, app: str, issuedAt: int, expiresAt: int }
  // platform.sessions row. kind "cloud" = token "cloud.…" with its identity cookie; "otp" = any other.
  // person: the owner human of the person on the row ("" = person_id null). human is ghost state: the
  // browser that holds the cookie.
  type Session = { app: str, phone: str, human: str, person: str, proof: int, kind: str,
                   created: int, expires: int, revoked: bool }
  // An OAuth grant with Cloud authority (api.ts; mcp handler.ts). personId "" = null.
  type Grant = { app: str, phone: str, human: str, personId: str, proof: int, expires: int }
  // One cloudSessionStatus or validateCloudGrant call in flight. path: "auth" (auth(), api.ts),
  // "site" (authenticatedSiteSession, api.ts), "grant" (cloudGrantAuthority, api.ts),
  // "gvalid" (validateCloudGrant, api.ts). answer "" until Cloud answers.
  type Req = { sess: int, grant: int, path: str, startSeq: int, answer: str, answerSeq: int, bannedAtBegin: bool }
  // A `validated` entry (api.ts). answered is ghost: the event number of the Cloud answer it came from.
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
    seq: int,                  // event counter for Cloud answers and cache invalidations
    deniedAns: int -> int,     // ghost, per session: the event number of the newest Cloud denial a request delivered
    invalidatedAt: int -> int, // per session: the event number of the latest cache invalidation
  }
  type ProofClockCheck = { kind: str, offset: int, accepted: bool }
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
    proofClockChecks: Set[ProofClockCheck],
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

  // SessionService.authenticate: the row is live (spec/webSession.md readRow). A Cloud row never rotates.
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
    flight' = { reqs: Map(), nextReq: 1, seq: 0, deniedAns: Map(), invalidatedAt: Map() },
    ghost' = {
      cloudLogins: 0, staleLogin: false, freshAccepts: 0, cacheAccepts: 0, prodCacheAccept: false,
      revokedCacheAccept: false, wrongModeAccept: false, wrongModeLogin: false, foreignAct: false,
      expiredAccept: false, grantsValid: 0, bannedGrantValid: false, lateBanGrantValid: false,
      otpRefusedOnCloud: false, proofClockChecks: Set(),
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

  // A deploy with a new env (api.ts run once in createPublicApi). The cache (api.ts) and the
  // requests in flight are in memory: a restart loses them. Sessions and grants are in Postgres.
  action restart(n: str): bool = all {
    now' = now,
    cfg' = cfgNamed(n),
    world' = world, sess' = sess,
    cache' = Map(),
    flight' = { ...flight, reqs: Map(), invalidatedAt: Map() },
    ghost' = ghost,
  }

  // api.ts: above 10 000 entries the whole cache is cleared before the next write.
  action cacheClear: bool = all {
    cache.keys().size() > 0,
    cache' = Map(),
    now' = now, cfg' = cfg, world' = world, sess' = sess, flight' = flight, ghost' = ghost,
  }

  // ------------------------------------------------------------------ logins

  // api.ts POST /api/auth/otp/verify (one action here; quint/auth_edge.qnt has the challenge).
  // In a Cloud-mode app the OTP routes answer 409 (api.ts): the guard.
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

  // api.ts GET /api/auth/cloud/callback. cloudFor(app) must be set (404 otherwise, api.ts).
  // Cloud exchanges the code for a delegation that names the phone of the Cloud account of `h`
  // (cloud-delegation.ts). The callback refuses a held, banned or suppressed number (api.ts),
  // revokes the old cookie's session, creates a "cloud." session that ends with the proof and
  // writes a cache entry for it: the exchange is a fresh Cloud answer.
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
      cache' = if (cfg.prod) cache else cache.put(sid, { until: now + VALIDATION_TTL, answered: flight.seq + 1 }),
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
  // api.ts cloudSessionStatus up to the Cloud call, then auth(), authenticatedSiteSession
  // or cloudGrantAuthority for an answer that needs no Cloud call.
  //  - cloudFor(app) unset: a "cloud." token is "invalid", any other token is "valid" (api.ts).
  //  - cloudFor(app) set: no identity cookie (an OTP session) or an expired proof is "invalid", and the
  //    cache entry is deleted. Outside production a live cache entry answers "valid".
  //  - "invalid" revokes the session row on the auth() path only (api.ts).
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
      // api.ts: cloudGrantAuthority answers undefined for another resource or outside production.
      if (invalidNow) all {
        sess' = if (path == "auth") { ...sess, rows: sess.rows.set(sid, { ...s, revoked: true }) } else sess,
        cache' = if (badIdentity) cache.keys().filter(k => k != sid).mapBy(k => cache.get(k)) else cache,
        flight' = if (badIdentity and not(cfg.prod)) { ...flight, seq: flight.seq + 1,
                    invalidatedAt: flight.invalidatedAt.put(sid, flight.seq + 1) } else flight,
        world' = world,
        ghost' = { ...ghost, otpRefusedOnCloud: ghost.otpRefusedOnCloud or (cloudApp and s.kind == "otp") },
      } else if (noCloudValid or cacheHit) all {
        // "valid" with no Cloud call, then sessions.authenticate (api.ts).
        sess' = sess, cache' = cache, flight' = flight,
        world' = if (acceptNow and path == "grant") grantFrom(world, s) else world,
        ghost' = if (acceptNow) acceptGhost(ghost, s, cacheHit) else ghost,
      } else all {
        // validate() is called (api.ts): the request waits for Cloud.
        flight' = { ...flight, reqs: flight.reqs.put(rid, { sess: sid, grant: NONE, path: path, startSeq: flight.seq,
                                                              answer: "", answerSeq: NONE, bannedAtBegin: false }),
                    nextReq: rid + 1 },
        sess' = sess, cache' = cache, world' = world, ghost' = ghost,
      },
      now' = now, cfg' = cfg,
    }
  }

  // api.ts cloudGrantAuthority: the sealed authority of the session, then the grant that
  // finishAuthorization creates (mcp handler.ts): its personId is the auth request's person
  // (personFor at consent), its expiry is min(session, proof).
  def grantFrom(w: World, s: Session): World =
    { ...w, grants: w.grants.put(w.nextGrant, { app: s.app, phone: s.phone, human: s.human, personId: actsFor(w, s.phone),
                                                 proof: s.proof, expires: imin(s.expires, w.proofs.get(s.proof).expiresAt) }),
            nextGrant: w.nextGrant + 1 }

  // cloud-delegation.ts validate (production) and api.ts (staging-local): Cloud answers
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

  // The end of cloudSessionStatus, then the caller. An expired proof is "invalid".
  // A positive result may publish only in the non-production cache and only if its round is current.
  // Denial, expiry or unavailability clears the positive cache and invalidates its in-flight round. Then:
  //  auth():                   "invalid" revokes the row, "unavailable" answers 503,
  //                            "valid" runs sessions.authenticate.
  //  authenticatedSiteSession: "invalid" answers undefined and does NOT revoke the row.
  //  cloudGrantAuthority:      "valid" and a live row give the grant authority.
  action reqEnd(rid: int): bool = {
    val r = flight.reqs.get(rid)
    val s = sess.rows.get(r.sess)
    val status = if (proofExpired(world, s.proof, now)) "invalid" else r.answer
    val currentRound = lookup(flight.invalidatedAt, r.sess, NONE) <= r.startSeq
    val store = not(cfg.prod) and status == "valid" and currentRound
    val clear = not(cfg.prod) and status != "valid"
    val cloudDenial = r.answer == "invalid"
    val newerDenial = cloudDenial and r.answerSeq > lookup(flight.deniedAns, r.sess, NONE)
    val accept = status == "valid" and rowLive(s, now)
    all {
      flight.reqs.keys().contains(rid),
      r.grant == NONE,
      r.answer != "",
      cache' = if (store) cache.put(r.sess, { until: now + VALIDATION_TTL, answered: r.answerSeq })
               else if (clear) cache.keys().filter(k => k != r.sess).mapBy(k => cache.get(k))
               else cache,
      flight' = { ...flight,
                  reqs: flight.reqs.keys().filter(k => k != rid).mapBy(k => flight.reqs.get(k)),
                  seq: if (clear) flight.seq + 1 else flight.seq,
                  deniedAns: if (newerDenial) flight.deniedAns.put(r.sess, r.answerSeq) else flight.deniedAns,
                  invalidatedAt: if (clear) flight.invalidatedAt.put(r.sess, flight.seq + 1) else flight.invalidatedAt },
      sess' = if (status == "invalid" and r.path == "auth") { ...sess, rows: sess.rows.set(r.sess, { ...s, revoked: true }) } else sess,
      world' = if (accept and r.path == "grant") grantFrom(world, s) else world,
      ghost' = if (accept) acceptGhost(ghost, s, false) else ghost,
      now' = now, cfg' = cfg,
    }
  }

  // ------------------------------------------------------------------ Cloud MCP grants (validateCloudGrant)

  // api.ts validateCloudGrant before the Cloud call: the authority is bound to app, resource and
  // phone, issuedAt no later than the local clock, not expired; grant.personId is null or the number's owner; the
  // number is not held, banned or suppressed. A refusal answers "invalid" at once (no request in flight).
  // mcp handler.ts cloudGrantCurrent checks the ban first as well.
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

  // api.ts: the Cloud answer, then "invalid" when the authority expired during the call.
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

  // The carrier gives number p to human h. With ASSUME_CLOUD_PHONE_CURRENT, Cloud drops the binding of
  // every other account to p at once. With ASSUME_CARRIER_AGING every proof for p has expired first.
  // A number with a person goes on hold.
  action recycleWith(p: str, h: str, assumeCloudCurrent: bool, assumeAged: bool): bool = all {
    world.holder.get(p) != h,
    assumeAged implies world.proofs.keys().forall(k => world.proofs.get(k).phone != p or world.proofs.get(k).expiresAt <= now),
    world' = { ...world,
               holder: world.holder.set(p, h),
               cloudPhone: if (assumeCloudCurrent) HUMANS.mapBy(x => if (x != h and world.cloudPhone.get(x) == p) "" else world.cloudPhone.get(x))
                           else world.cloudPhone,
               held: if (world.person.get(p) != "") world.held.union(Set(p)) else world.held },
    now' = now, cfg' = cfg, sess' = sess, cache' = cache, flight' = flight, ghost' = ghost,
  }
  action recycle(p: str, h: str): bool = recycleWith(p, h, true, true)
  // Without carrier aging (a number handed over at once); Cloud is current.
  action recycleUnaged(p: str, h: str): bool = recycleWith(p, h, true, false)
  // Without either assumption (W3-126, W3-127): Cloud keeps the earlier holder's binding.
  action recycleStale(p: str, h: str): bool = recycleWith(p, h, false, false)

  // A text join (service.ts NetworkService.join, accounts.createPerson): the holder gets a person on p,
  // and every person-less session of p ends (SD-054; pg-store.ts admitMembership -> attachPerson with no
  // joining session, AE-3 fixed). OAuth grants are not touched.
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

  // A proof arrives with an issue time `off` seconds from the local clock. Assume the correct envelope
  // and a live expiry so the action represents only the parser's issue-time decision.
  action proofArrives(kind: str, off: int): bool = {
    val accepted = off <= skewAllowed(kind)
    all {
      ghost' = { ...ghost, proofClockChecks: ghost.proofClockChecks.union(Set({ kind: kind, offset: off, accepted: accepted })) },
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

  // A cache invalidation ends the current validation round. A live cache entry cannot come from a
  // Cloud answer older than a denial that the same session already received.
  val denialNeverCached = cache.keys().forall(k =>
    cache.get(k).until <= now or cache.get(k).answered > lookup(flight.deniedAns, k, NONE))

  // In production every request asks Cloud and leaves the cache empty.
  val prodNoCacheAccept = not(ghost.prodCacheAccept) and (cfg.prod implies cache.keys().size() == 0)

  // W3-125. api.ts cloudFor, cloudSessionStatus and the OTP and Cloud routes: each app has one auth mode at a time. A
  // login path runs only on an app of its mode, and a session is accepted only on an app of its mode
  // (an OTP session on a Cloud app has no identity cookie; a Cloud token on an OTP app is "invalid").
  val authModeMatches = not(ghost.wrongModeAccept) and not(ghost.wrongModeLogin)

  // W3-127, W3-126. AGENTS.md decision 9 ("phone login is the identity check") and accounts.ts
  // (a session must never act for the person of a later holder of the number): a Cloud session or a
  // Cloud grant acts only for a person of its own human. Holds under ASSUME_CLOUD_PHONE_CURRENT only.
  val cloudActsForHolder = not(ghost.foreignAct) and not(ghost.staleLogin)

  // AGENTS.md founder decisions 2026-10-09 #3 (bans by phone; MCP included) and mcp handler.ts: a
  // grant validation that began after the ban committed never answers "valid". A ban that commits while
  // the Cloud call is in flight is concurrent with it (witness_lateBanGrantValid), as SD-013's remainder.
  val bannedGrantRefused = not(ghost.bannedGrantValid)

  // api.ts and network-delegation.ts: an expired proof never authorizes a request.
  val expiredNeverAccepted = not(ghost.expiredAccept)

  // The staging callback and the production exchange and validation (parseNetworkDelegation) use the
  // 30-second window in cloudSignIn.md. The MCP grant envelope and profile proof windows require a
  // current issue time. The service signature window is a separate check.
  val cloudProofClockRules = ghost.proofClockChecks.forall(check =>
    if (cloudSkewKind(check.kind)) check.accepted == (check.offset <= CLOUD_SKEW)
    else check.accepted == (check.offset <= 0))

  // W3-373 (the rotation write of api.ts): a Cloud session ends before sessions.ts would rotate it.
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
    cloudProofClockRules,
    cloudSessionNeverRotates,
  }

  // ------------------------------------------------------------------ witnesses (each must be violated)

  val witness_cloudLogin = ghost.cloudLogins == 0
  val witness_freshAccept = ghost.freshAccepts == 0
  // Outside production a request is accepted from the cache.
  val witness_cacheAccept = ghost.cacheAccepts == 0
  // Outside production a cached validation lasts up to VALIDATION_TTL before its next authority check.
  val witness_revokedWithinTtl = not(ghost.revokedCacheAccept)
  val witness_grantValid = ghost.grantsValid == 0
  val witness_lateBanGrantValid = not(ghost.lateBanGrantValid)
  // W3-125: after a switch to a Cloud mode an OTP session is refused on that app.
  val witness_otpRefusedOnCloud = not(ghost.otpRefusedOnCloud)
  // A future-dated proof reaches the issue-time gate.
  val witness_skewSeen = ghost.proofClockChecks.forall(check => check.offset <= 0)

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

  // An unavailable validation ends the current cache round. A later round can refresh normally.
  run stagingCacheRoundOrderingTest =
    initWith("staging-local")
      .then(cloudLogin("alice", "slop"))
      .then(tick(61))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(reqBegin(1, "site"))
      .then(cloudAnswer(2, false))
      .then(reqEnd(2))
      .then(reqEnd(1))
      .expect(not(cache.keys().contains(1)) and safety)
      .then(reqBegin(1, "auth"))
      .expect(ghost.cacheAccepts == 0 and flight.reqs.keys() == Set(3) and safety)
      .then(cloudAnswer(3, true))
      .then(reqEnd(3))
      .then(reqBegin(1, "auth"))
      .expect(ghost.cacheAccepts == 1 and flight.reqs.keys().size() == 0 and safety)

  // Production has no such window: the same trace accepts nothing from the cache (api.ts).
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

  // W3-126 (counterexample, neither assumption): bob gets a Cloud grant on Y while Y has no person
  // (personId null). The carrier gives Y to alice while the grant is live and alice joins by text: the
  // grant passes the owner check of validateCloudGrant (null personId) and Cloud's answer, and acts for
  // alice's person. `cloudActsForHolder` fails: the invariant is not vacuous.
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

  // W3-126 with ASSUME_CLOUD_PHONE_CURRENT and no aging: Cloud denies the earlier holder's delegation;
  // the grant is not valid.
  run w3_126AssumptionTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(recycleUnaged("Y", "alice"))
      .then(textJoin("Y"))
      .then(grantBegin(1))
      .then(cloudAnswer(2, true))
      .then(grantEnd(2))
      .expect(ghost.grantsValid == 0 and safety)

  // W3-126 with carrier aging: the grant ends with its proof (at most one hour), so the carrier cannot
  // give Y to alice while it is live; after the reassignment the grant is refused before any Cloud call.
  run w3_126AgedTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(recycle("Y", "alice"))
      .fail()

  run w3_126AgedRefusedTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "grant"))
      .then(cloudAnswer(1, true))
      .then(reqEnd(1))
      .then(tick(HOUR))
      .then(recycle("Y", "alice"))
      .then(textJoin("Y"))
      .then(grantBegin(1))
      .expect(flight.reqs == Map() and ghost.grantsValid == 0 and world.cloudPhone.get("bob") == "" and safety)

  // AE-3: bob's request on his person-less Cloud session on Y got Cloud's "valid" before
  // the carrier gave Y to alice (no aging). Alice's text join ends bob's session, so the late answer
  // acts for nobody.
  run ae3IntendedRevokesTest =
    initWith("production")
      .then(cloudLogin("bob", "slop"))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(recycleUnaged("Y", "alice"))
      .then(textJoin("Y"))
      .then(reqEnd(1))
      .expect(ghost.freshAccepts == 0 and sess.rows.get(1).revoked and safety)

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
  // (api.ts), and the session answers "invalid" before any Cloud call (api.ts).
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

  // api.ts: the proof expires while validate() is in flight; Cloud's late "valid" is not used and
  // the auth() path revokes the row.
  run sessionExpiryInFlightTest =
    initWith("production")
      .then(cloudLogin("alice", "slop"))
      .then(reqBegin(1, "auth"))
      .then(cloudAnswer(1, true))
      .then(tick(HOUR))
      .then(reqEnd(1))
      .expect(ghost.freshAccepts == 0 and sess.rows.get(1).revoked and expiredNeverAccepted)

  // W3-134 / SD-308 / AE-5: only the Cloud sign-in identity allows a proof issued ahead of the local clock.
  run w3_134SkewTest =
    initWith("off")
      .then(proofArrives("staging-login", 30))
      .then(proofArrives("staging-login", 31))
      .then(proofArrives("production-delegation", 30))
      .then(proofArrives("production-delegation", 31))
      .then(proofArrives("grant", 1))
      .then(proofArrives("owner", 1))
      .then(proofArrives("source", 1))
      .then(proofArrives("withdrawal", 1))
      .then(proofArrives("disconnect", 1))
      .then(proofArrives("production-delegation", 0))
      .then(proofArrives("grant", 0))
      .expect(cloudProofClockRules and ghost.proofClockChecks.size() == 11
              and ghost.proofClockChecks.contains({ kind: "production-delegation", offset: 30, accepted: true }))
}
```
