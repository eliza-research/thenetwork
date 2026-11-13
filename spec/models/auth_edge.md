# Web sessions and trusted requests

## Story: Web sessions and trusted requests

A member needs to confirm their phone and use their own session. The service needs to authorize each request at the edge.

### Safety rules and reachability

Check banned numbers, session ownership, OTP and Cloud authentication, and signed proxy requests. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [OTP limits spec](../otpLimits.md) supplies runtime defaults. This model uses seconds for the lifetime and minimum gap and scales the global send limit for reachability. It does not model the per-number and per-address verification counters.

Imported from `quint/auth_edge.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=24 max-samples=20000 verify-steps=4
// -*- mode: Bluespec; -*-
//
// auth_edge: web login, sessions, the Cloud sign-in handoff and the signed hops in front of the backend.
// Module plan: docs/research/2026-11-07-state-machines.md section 6.10. Machines: otp-challenge (M-057),
// web-session (M-058), cloud-handoff (M-059), cloud-session-validation (M-060), proxy-signature (M-061),
// edge-trust (M-062), svc-auth (M-063), auth-mode-config (M-129), public-api-gates (M-130),
// proxy-secret-rotation (M-131).
//
// The model follows the code of branch wave2/auth_edge (ad67275 with the fixes for SD-013, SD-054,
// SD-181, SD-380 and SD-491; docs/research/quint-findings/auth_edge.md):
//   packages/platform/src/api.ts          routes, gates, Cloud callback and validation
//   packages/platform/src/otp.ts          OtpService.start / verify and the rate buckets
//   packages/platform/src/sessions.ts     SessionService.create / authenticate / revoke / fresh
//   packages/platform/src/accounts.ts     join, leave, deleteAll, exportApp, createPerson (who = {e164, personId, session})
//   packages/platform/src/pg-store.ts     hitAll, sessions, deleteAll, bindSessions, forgetPersonlessSessions, purge
//   packages/platform/src/cloud-delegation.ts and packages/core/src/svc/network-delegation.ts
//   packages/platform/src/proxy.ts, deploy/router.ts, deploy/backend/backend.ts (normalizeEdge)
//   packages/core/src/svc/svc-auth.ts and the signed endpoints that use it
//
// Abstractions (each one is listed so that a reader can check it):
//  - Time is an integer in seconds. `tick` moves it by one of a few named steps.
//  - HMAC, the OTP code, Turnstile and the Cloud proof are oracles. A human knows a code only when the
//    provider sent it to the phone that human holds. Nobody can forge a signature without the secret.
//  - Each SQL transaction is one action. One code request is four actions: the route's ban check,
//    the four rate buckets in one transaction (store.hitAll, pg-store.ts:268-295), the provider send and
//    putChallenge.
//  - The verify limits (otp.ts:206-208: 10 code checks a number and 30 an IP an hour) are not modelled:
//    they only refuse more checks, and no invariant here needs a refused check.
//    The OTP verify route and the Cloud callback are one action each: their internal awaits do not
//    change any value that the invariants below read (noted at each action).
//  - One app (slop, joins at 13; matching at 18 is outside this model), two phones, two humans. A carrier can give a number to another human
//    (number recycling); the 12-month hold (accounts.ts:182-190) cannot be reached in these bounds.
//    Assumption: a number ages 45 days before a carrier gives it to another human, so a 10-minute OTP
//    code of the earlier holder is never live then (web sessions, 30 to 90 days, can be).
//  - Assumption (upstream): the Worker to backend hop and the gateway to backend hop are TLS, so an
//    attacker cannot capture or change a signed request. The attacker can send any request directly.
//  - Assumption (svc endpoints): each signed endpoint records its id and its effect in one transaction
//    (the durable inbox is modelled in quint/turn_consent.qnt).
module auth_edge {

  // ------------------------------------------------------------------ constants (code values)

  pure val MINUTE = 60
  pure val HOUR = 3600
  pure val DAY = 86400
  // otp.ts:130-133 OTP_LIMITS. GLOBAL_PER_HOUR is 500 in the code; the model bound is 2 so that the
  // global refusal is reachable in a short trace. The rule it checks does not depend on the value.
  pure val OTP_TTL = 600
  pure val OTP_MAX_ATTEMPTS = 5
  pure val PER_PHONE_HOUR = 3
  pure val PER_PHONE_DAY = 6
  pure val PER_IP_HOUR = 10
  pure val MIN_GAP = 30
  pure val GLOBAL_PER_HOUR = 2
  // sessions.ts:13-20
  pure val SESSION_TTL = 30 * DAY
  pure val SESSION_ROTATE = DAY
  pure val SESSION_MAX = 90 * DAY
  pure val SESSION_GRACE = 60
  pure val STEP_UP = 600
  // api.ts:101 CLOUD_CLOCK_SKEW_MS (30 s); network-delegation.ts:41 a proof lives at most one hour.
  pure val CLOUD_SKEW = 30
  pure val CLOUD_PROOF_LIFE = HOUR
  // proxy.ts:23 PROXY_MAX_SKEW_S and svc-auth.ts:17 SVC_MAX_SKEW_S
  pure val PROXY_SKEW = 60
  pure val SVC_SKEW = 60
  // packages/platform/src/apps.ts:76: slop minJoinAge 13 (founder 2026-10-09: open to 13+; minors are
  // never matched, which is not in this model); policy.ts: under 13 cannot join at all.
  pure val APP_MIN_AGE = 13
  pure val JOIN_FLOOR = 13

  pure val PHONES = Set("X", "Y")
  pure val HUMANS = Set("alice", "bob")
  pure val SVC_IDS = Set("m1", "m2")
  pure val NONE = -1

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def iabs(a: int): int = if (a < 0) -a else a

  // ------------------------------------------------------------------ types

  type Bucket = { start: int, n: int, last: int }
  // One OtpService.start in flight. stage: 0 rate buckets (one transaction), 1 provider send, 2 putChallenge.
  type StartReq = { phone: str, ip: str, stage: int, sentTo: str, bannedAtBegin: bool }
  type Challenge = { live: bool, attempts: int, expires: int, sentTo: str }
  // platform.sessions row. person NONE = person_id null. chain = the first session of the login.
  // human is ghost state: the browser that holds the cookie.
  type Session = { phone: str, person: int, human: str, created: int, started: int, expires: int,
                   revoked: int, cloud: bool, chain: int }
  type Rot = { human: str, sid: int, req: int }
  type Act = { human: str, person: int, op: str }
  type SvcReq = { id: str, ts: int, query: bool }

  type World = {
    holder: str -> str,          // the human who holds each number (carrier fact)
    phoneOf: str -> int,         // platform.phone_identities: phone -> person (NONE when absent)
    // ghost, per person: the session id counter when the person was created (a login chain with a lower
    // first id is older than the person), and the chain of the web join that created it (NONE: text join)
    bornAt: int -> int,
    bornBy: int -> int,
    alive: Set[int],             // people with deleted_at null
    member: Set[int],            // a live slop membership
    nextPerson: int,
    banned: Set[str],            // platform.bans by phone hash (service.ts:2010-2042)
    suppressed: Set[str],        // platform.suppression (delete everything, ban)
    floor: str -> int,           // platform.age_floor (NONE when absent)
    cloudRevoked: Set[int],      // Eliza Cloud: delegations (by session chain) that Cloud now denies
  }
  type Otp = { buckets: (str, str) -> Bucket, inflight: int -> StartReq, nextRid: int, challenge: str -> Challenge }
  type Sess = { rows: int -> Session, jar: str -> int, nextSid: int, pendingRot: Set[Rot] }
  // backendPrevious: PLATFORM_PROXY_SECRET_PREVIOUS (backend.ts:94), NONE when unset.
  type Edge = { backendSecret: int, backendPrevious: int, siteSecret: int }
  type Svc = { inflight: Set[SvcReq], seen: Set[str], effects: str -> int }
  type Ghost = {
    codeToBanned: bool,          // a code went for a request that began after the number was banned
    lateBanCode: bool,           // a code went to a number banned while its request was in flight
    sessionToBanned: bool,       // a session was created for a banned number
    otpLogins: int,
    cloudLogins: int,
    burned: bool,                // an OTP start was refused after an earlier bucket counted it
    foreignActs: Set[Act],       // account actions on a person through a session from before that person
    under13At: str -> int,       // per phone: sess.nextSid at an under-13 web join refusal (rows with a lower id are older)
    cloudSkewRejects: Set[int],  // Cloud clock offsets that the callback refused as "from the future"
    cloudRefusedDeleted: bool,   // a Cloud sign-in refused only because the number deleted everything
    actedUnvalidated: bool,      // a Cloud session acted without a valid Cloud validation
    rotations: int,
    servedUnsigned: bool,        // a request served with the edge facts but no valid router signature
    edgeOutage: bool,            // an honest router request answered 421
    staleSvcEffect: bool,        // a signed request outside the 60 s window had an effect
    querySvcEffect: bool,        // a signed request with an unsigned query string had an effect
    skewedSvcOk: bool,           // a signed request with a non-zero clock offset within 60 s had an effect
    ageLoweredByOther: bool,     // a web join lowered the age of a person the actor does not own
  }

  // ------------------------------------------------------------------ state

  var now: int
  var mode: str                  // auth-mode-config: "otp" or "cloud" (api.ts:152-198), fixed at boot
  var world: World
  var otp: Otp
  var sess: Sess
  var edge: Edge
  var svc: Svc
  var ghost: Ghost

  // ------------------------------------------------------------------ helpers

  // accounts.ts:148-153 personFor: the live person of the phone (no hold in these bounds).
  def personFor(w: World, p: str): int =
    val id = w.phoneOf.get(p)
    if (id != NONE and w.alive.contains(id)) id else NONE

  // pg-store.ts:265-295 hit and hitAll: one advisory-locked transaction.
  pure def bucketOf(b: (str, str) -> Bucket, key: (str, str)): Bucket =
    if (b.keys().contains(key)) b.get(key) else { start: NONE, n: 0, last: NONE }
  pure def hitOk(b: (str, str) -> Bucket, key: (str, str), window: int, at: int, limit: int, gap: int): bool =
    val cur = bucketOf(b, key)
    val n = if (cur.start == at - at % window) cur.n else 0
    not(n >= limit or (gap > 0 and cur.last != NONE and at - cur.last < gap))
  pure def hitApply(b: (str, str) -> Bucket, key: (str, str), window: int, at: int): (str, str) -> Bucket =
    val cur = bucketOf(b, key)
    val start = at - at % window
    val n = if (cur.start == start) cur.n else 0
    b.put(key, { start: start, n: n + 1, last: at })

  // sessions.ts:47-53 authenticate (the checks before rotation; decisions.ts:42 sessionLive).
  def liveSession(s: Sess, sid: int, at: int): bool =
    sid != NONE and s.rows.keys().contains(sid) and
    (s.rows.get(sid).revoked == NONE or s.rows.get(sid).revoked > at) and
    s.rows.get(sid).expires > at

  // sessions.ts:63-65 revoke: revoked_at = least(coalesce(revoked_at, at), at) (pg-store.ts:252-254).
  pure def revokeRow(rows: int -> Session, sid: int, at: int): int -> Session =
    if (sid != NONE and rows.keys().contains(sid))
      rows.set(sid, { ...rows.get(sid), revoked: if (rows.get(sid).revoked == NONE) at else imin(rows.get(sid).revoked, at) })
    else rows

  pure def dropRows(rows: int -> Session, keep: int => bool): int -> Session =
    rows.keys().filter(k => keep(k)).mapBy(k => rows.get(k))

  // accounts.ts:306-311 createPerson and pg-store.ts:255-259 bindSessions (SD-054 fix): the number has a
  // person now. Of its sessions with no person, `keepSid` gets the person and every other one is revoked
  // at `at` (it may belong to an earlier holder of the number). NONE keeps no session (a text join).
  pure def bindSessions(rows: int -> Session, p: str, pid: int, keepSid: int, at: int): int -> Session =
    rows.keys().mapBy(k =>
      val r = rows.get(k)
      if (r.phone != p or r.person != NONE) r
      else if (k == keepSid) { ...r, person: pid }
      else { ...r, revoked: if (r.revoked == NONE) at else imin(r.revoked, at) })

  // ------------------------------------------------------------------ init

  action initWith(m: str): bool = all {
    now' = 0,
    mode' = m,
    world' = {
      holder: Map("X" -> "alice", "Y" -> "bob"),
      phoneOf: Map("X" -> NONE, "Y" -> NONE),
      bornAt: Map(),
      bornBy: Map(),
      alive: Set(),
      member: Set(),
      nextPerson: 1,
      banned: Set(),
      suppressed: Set(),
      floor: Map("X" -> NONE, "Y" -> NONE),
      cloudRevoked: Set(),
    },
    otp' = { buckets: Map(), inflight: Map(), nextRid: 1, challenge: Map() },
    sess' = { rows: Map(), jar: Map("alice" -> NONE, "bob" -> NONE), nextSid: 1, pendingRot: Set() },
    edge' = { backendSecret: 1, backendPrevious: NONE, siteSecret: 1 },
    svc' = { inflight: Set(), seen: Set(), effects: Map() },
    ghost' = {
      codeToBanned: false, lateBanCode: false, sessionToBanned: false, otpLogins: 0, cloudLogins: 0, burned: false,
      foreignActs: Set(), under13At: Map(), cloudSkewRejects: Set(), cloudRefusedDeleted: false,
      actedUnvalidated: false, rotations: 0, servedUnsigned: false, edgeOutage: false,
      staleSvcEffect: false, querySvcEffect: false, skewedSvcOk: false, ageLoweredByOther: false,
    },
  }

  action init = {
    nondet m = Set("otp", "cloud").oneOf()
    initWith(m)
  }

  // ------------------------------------------------------------------ time

  action tick(d: int): bool = all {
    d >= 0,
    now' = now + d,
    mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ otp-challenge (OtpService.start)

  // api.ts:464-480 POST /api/auth/otp/start. Cloud mode answers 409 (api.ts:465). Turnstile is an
  // oracle that passes. api.ts:474 (SD-013 fix): the route reads the ban first and passes send =
  // not banned to OtpService.start: a banned number counts in the rate buckets like any number, gets
  // { ok: true } and no code (otp.ts:189). `bannedAtBegin` is that ban read (not send); bannedNoCode
  // reads it.
  action otpStartBegin(h: str, p: str): bool = all {
    mode == "otp",
    otp.inflight.keys().size() < 2,
    otp' = { ...otp, inflight: otp.inflight.put(otp.nextRid, { phone: p, ip: h, stage: 0, sentTo: "", bannedAtBegin: world.banned.contains(p) }),
             nextRid: otp.nextRid + 1 },
    now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // The four rate buckets of one start, in order: ip, phone hour (and the 30 s gap), phone day, global.
  pure def bucketStage(p: str, ip: str, st: int): { key: (str, str), window: int, limit: int, gap: int } =
    if (st == 0) { key: ("ip", ip), window: HOUR, limit: PER_IP_HOUR, gap: 0 }
    else if (st == 1) { key: ("phone", p), window: HOUR, limit: PER_PHONE_HOUR, gap: MIN_GAP }
    else if (st == 2) { key: ("day", p), window: DAY, limit: PER_PHONE_DAY, gap: 0 }
    else { key: ("global", ""), window: HOUR, limit: GLOBAL_PER_HOUR, gap: 0 }

  // otp.ts:175-188 with store.hitAll (pg-store.ts:268-295, SD-380 fix): one transaction checks the four
  // buckets in order and counts the hit in all of them, or in none when one refuses. `burned` is true
  // when a refused request still changed a bucket (otp.ts:4-5 says it must not).
  pure def startBuckets(b: (str, str) -> Bucket, h: str, p: str, at: int): { ok: bool, burned: bool, buckets: (str, str) -> Bucket } =
    val stages = [0, 1, 2, 3]
    val ok = stages.foldl(true, (acc, st) => {
      val k = bucketStage(p, h, st)
      acc and hitOk(b, k.key, k.window, at, k.limit, k.gap)
    })
    val applied = stages.foldl(b, (acc, st) => {
      val k = bucketStage(p, h, st)
      hitApply(acc, k.key, k.window, at)
    })
    val after = if (ok) applied else b
    { ok: ok, burned: not(ok) and after != b, buckets: after }

  action otpStartLimits(rid: int): bool = {
    val r = otp.inflight.get(rid)
    val res = startBuckets(otp.buckets, r.ip, r.phone, now)
    all {
      otp.inflight.keys().contains(rid),
      r.stage == 0,
      if (res.ok and r.bannedAtBegin) all {
        // otp.ts:189: send false (a banned number): the buckets count, { ok: true }, no code.
        otp' = { ...otp, buckets: res.buckets, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
        ghost' = ghost,
      } else if (res.ok) all {
        otp' = { ...otp, buckets: res.buckets, inflight: otp.inflight.set(rid, { ...r, stage: 1 }) },
        ghost' = ghost,
      } else all {
        // limited(): 429, and no bucket counts the request.
        otp' = { ...otp, buckets: res.buckets, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
        ghost' = { ...ghost, burned: ghost.burned or res.burned },
      },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // otp.ts:191 provider.send. The SMS goes to whoever holds the number now. A provider error is
  // logged and the answer stays { ok: true } with no challenge. A ban that commits while the request
  // is in flight (after the route's ban check) does not stop the send: verify refuses that code.
  action otpStartSend(rid: int, delivered: bool): bool = {
    val r = otp.inflight.get(rid)
    all {
      otp.inflight.keys().contains(rid),
      r.stage == 1,
      if (delivered) all {
        otp' = { ...otp, inflight: otp.inflight.set(rid, { ...r, stage: 2, sentTo: world.holder.get(r.phone) }) },
        ghost' = { ...ghost, codeToBanned: ghost.codeToBanned or r.bannedAtBegin,
                   lateBanCode: ghost.lateBanCode or world.banned.contains(r.phone) },
      } else all {
        otp' = { ...otp, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
        ghost' = ghost,
      },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // otp.ts:192 putChallenge: the newest challenge is the one verify reads (latestChallenge).
  action otpStartPut(rid: int): bool = {
    val r = otp.inflight.get(rid)
    all {
      otp.inflight.keys().contains(rid),
      r.stage == 2,
      otp' = { ...otp,
               inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)),
               challenge: otp.challenge.put(r.phone, { live: true, attempts: 0, expires: now + OTP_TTL, sentTo: r.sentTo }) },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // The process stops between two awaits of OtpService.start.
  action otpStartCrash(rid: int): bool = {
    all {
      otp.inflight.keys().contains(rid),
      otp' = { ...otp, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // The four actions above run back to back with no other step in between (a macro-step: it adds no
  // behaviour, it only lets the random simulation reach a login in fewer steps).
  action otpStartFast(h: str, p: str, delivered: bool): bool = {
    val r = startBuckets(otp.buckets, h, p, now)
    val banned = world.banned.contains(p)
    all {
      mode == "otp",
      otp' = { ...otp, buckets: r.buckets,
               challenge: if (r.ok and delivered and not(banned))
                 otp.challenge.put(p, { live: true, attempts: 0, expires: now + OTP_TTL, sentTo: world.holder.get(p) })
                 else otp.challenge },
      ghost' = { ...ghost, burned: ghost.burned or r.burned },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ otp-challenge (verify) + web-session (create)

  // api.ts:482-499 POST /api/auth/otp/verify with otp.ts:203-219. One action: claimAttempt and
  // consumeChallenge are the only writes before the session, and nothing in between changes a value that
  // an invariant reads. The right code is known only to the human the SMS went to. api.ts:488 (SD-013
  // fix): after otp.verify has used the code, a banned number gets 400 and no session.
  action otpVerify(h: str, p: str): bool = {
    val c = otp.challenge.get(p)
    val right = c.sentTo == h
    all {
      mode == "otp",
      otp.challenge.keys().contains(p),
      // claimAttempt (pg-store.ts:234-238)
      c.live, c.expires > now, c.attempts < OTP_MAX_ATTEMPTS,
      if (right and world.banned.contains(p)) all {
        otp' = { ...otp, challenge: otp.challenge.set(p, { ...c, attempts: c.attempts + 1, live: false }) },
        sess' = sess, ghost' = ghost,
      } else if (right) {
        // consumeChallenge, revoke the cookie on this request, seen, personFor, sessions.create.
        val person = personFor(world, p)
        val sid = sess.nextSid
        val rows1 = revokeRow(sess.rows, sess.jar.get(h), now)
        all {
          otp' = { ...otp, challenge: otp.challenge.set(p, { ...c, attempts: c.attempts + 1, live: false }) },
          sess' = { ...sess,
                    rows: rows1.put(sid, { phone: p, person: person, human: h, created: now, started: now,
                                           expires: now + SESSION_TTL, revoked: NONE, cloud: false, chain: sid }),
                    jar: sess.jar.set(h, sid), nextSid: sid + 1 },
          ghost' = { ...ghost, otpLogins: ghost.otpLogins + 1,
                     sessionToBanned: ghost.sessionToBanned or world.banned.contains(p) },
        }
      } else all {
        otp' = { ...otp, challenge: otp.challenge.set(p, { ...c, attempts: c.attempts + 1 }) },
        sess' = sess, ghost' = ghost,
      },
      now' = now, mode' = mode, world' = world, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ web-session (rotation)

  // sessions.ts:50-53: the read. A session older than a day and not yet rotated will rotate.
  action rotateRead(h: str, req: int): bool = {
    val sid = sess.jar.get(h)
    all {
      liveSession(sess, sid, now),
      sess.rows.get(sid).revoked == NONE,
      now - sess.rows.get(sid).created >= SESSION_ROTATE,
      not(sess.pendingRot.contains({ human: h, sid: sid, req: req })),
      sess' = { ...sess, pendingRot: sess.pendingRot.union(Set({ human: h, sid: sid, req: req })) },
      now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // sessions.ts authenticate -> pg-store.ts rotateSession: one statement ends the old token with a 60 s
  // grace and stores the next one with the person the old row has at that moment. It does nothing when the
  // old row is no longer live (a join's bindSessions ended it after rotateRead: the SD-054 race). Two
  // requests in the grace time both rotate it (SD-180, refuted as harmless).
  action rotateCommit(r: Rot): bool = {
    val old = sess.rows.get(r.sid)
    val sid = sess.nextSid
    val rows1 = revokeRow(sess.rows, r.sid, now + SESSION_GRACE)
    val expires = imin(imin(now + SESSION_TTL, old.started + SESSION_MAX), if (old.cloud) old.expires else now + SESSION_TTL)
    all {
      sess.pendingRot.contains(r),
      sess.rows.keys().contains(r.sid),
      old.revoked == NONE or old.revoked > now,
      sess' = { ...sess,
                rows: rows1.put(sid, { ...old, created: now, expires: expires, revoked: NONE }),
                jar: sess.jar.set(r.human, sid), nextSid: sid + 1,
                pendingRot: sess.pendingRot.exclude(Set(r)) },
      ghost' = { ...ghost, rotations: ghost.rotations + 1 },
      now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc,
    }
  }

  // pg-store.ts:331-343 purge: expired and revoked rows go.
  action purge = all {
    sess' = { ...sess, rows: dropRows(sess.rows, k => sess.rows.get(k).expires >= now and
                                         (sess.rows.get(k).revoked == NONE or sess.rows.get(k).revoked >= now)) },
    now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ cloud-handoff (callback)

  // api.ts:413-455 GET /api/auth/cloud/callback in production (productionDelegation set). Cloud signs a
  // phone proof for the number the human holds now, with its own clock: issuedAt = now + skew.
  // cloud-delegation.ts:25 parseNetworkDelegation(…, o.now(), o.skewMs) refuses issuedAt*1000 > now +
  // CLOUD_CLOCK_SKEW_MS (network-delegation.ts:41, SD-181 fix), the same allowance as api.ts:438.
  action cloudLogin(h: str, p: str, skew: int): bool = {
    val issuedAt = now + skew
    val proofExpires = issuedAt + CLOUD_PROOF_LIFE
    val parsedOk = issuedAt <= now + CLOUD_SKEW and proofExpires > now  // network-delegation.ts:41
    val callbackOk = parsedOk and issuedAt <= now + CLOUD_SKEW           // api.ts:438
    val refused = world.banned.contains(p) or world.suppressed.contains(p) // api.ts:439 (no hold here)
    val person = personFor(world, p)
    val sid = sess.nextSid
    val started = imin(issuedAt, now)                                  // api.ts:444
    all {
      mode == "cloud",
      world.holder.get(p) == h,
      if (not(callbackOk)) all {
        sess' = sess,
        ghost' = { ...ghost, cloudSkewRejects: ghost.cloudSkewRejects.union(Set(skew)) },
      } else if (refused) all {
        sess' = sess,
        ghost' = { ...ghost, cloudRefusedDeleted: ghost.cloudRefusedDeleted or not(world.banned.contains(p)) },
      } else all {
        sess' = { ...sess,
                  rows: revokeRow(sess.rows, sess.jar.get(h), now).put(sid, {
                    phone: p, person: person, human: h, created: now, started: started,
                    expires: imin(imin(now + SESSION_TTL, started + SESSION_MAX), proofExpires),
                    revoked: NONE, cloud: true, chain: sid }),
                  jar: sess.jar.set(h, sid), nextSid: sid + 1 },
        ghost' = { ...ghost, cloudLogins: ghost.cloudLogins + 1,
                   sessionToBanned: ghost.sessionToBanned or world.banned.contains(p) },
      },
      now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ account actions through a session

  // api.ts:314-322 auth(), then one of the withSession routes. In Cloud mode the session's proof is
  // validated first (cloudSessionStatus, api.ts:268-284): "invalid" revokes, "unavailable" answers 503
  // (api.ts:319, 706). In production every request asks Cloud (no cache, api.ts:275). The Cloud answer
  // is an oracle; a human that Cloud has revoked always gets "invalid".
  // who = { e164: session.phone, personId: session.person, session: token hash } (api.ts:393). The
  // Accounts calls use personFor(who.e164) and do not compare who.personId (accounts.ts:355-516). This is
  // safe after the SD-054 fix: when a number gets a person, every person-less session of the number other
  // than the joining one ends (createPerson and bindSessions, accounts.ts:306-311, 384, 390, 405).
  action account(h: str, op: str, age: int, cloudSays: str): bool = {
    val sid = sess.jar.get(h)
    val s = sess.rows.get(sid)
    // cloud-delegation.ts:29-40 validate: Cloud denies (403) a revoked delegation; otherwise the answer is
    // valid or unavailable (oracle).
    val status = if (not(s.cloud)) "valid" else if (world.cloudRevoked.contains(s.chain)) "invalid" else cloudSays
    val target = personFor(world, s.phone)
    // SD-054 rule: a login chain that began before the person existed acts for it only when its own web
    // join created the person. A login after the person exists gets that person by the recycled-number
    // policy (accounts.ts:176-190, 12 months), which is not in the scope of this rule.
    val foreign = target != NONE and s.chain < world.bornAt.get(target) and s.chain != world.bornBy.get(target)
    val act = { human: h, person: target, op: op }
    val unvalidated = s.cloud and (world.cloudRevoked.contains(s.chain) or status != "valid")
    all {
      liveSession(sess, sid, now),
      if (status == "invalid") all {
        // api.ts:320: the session is revoked; 401.
        sess' = { ...sess, rows: revokeRow(sess.rows, sid, now) },
        world' = world, ghost' = ghost,
      } else if (status == "unavailable") all {
        // api.ts:319 and 706: 503, nothing happens.
        sess' = sess, world' = world, ghost' = ghost,
      } else if (op == "export") all {
        // api.ts:584-587, accounts.ts:500-516: the data of personFor(who.e164). A banned (or held)
        // number gets 403 and nothing.
        sess' = sess, world' = world,
        ghost' = if (world.banned.contains(s.phone)) ghost
                 else { ...ghost, actedUnvalidated: ghost.actedUnvalidated or unvalidated,
                        foreignActs: if (foreign) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
      } else if (op == "leave") all {
        // api.ts:636-639 (POST /api/me/delete, scope "app"), accounts.ts:472-482: the forget path of
        // personFor(who.e164).
        sess' = sess,
        world' = { ...world, member: world.member.exclude(Set(target)) },
        ghost' = { ...ghost, actedUnvalidated: ghost.actedUnvalidated or unvalidated,
                   foreignActs: if (foreign and world.member.contains(target)) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
      } else if (op == "deleteAll") all {
        // api.ts:640-645: step-up (sessions.fresh), then accounts.deleteAll (accounts.ts:484-497,
        // pg-store.ts:355-390): sessions of the phone or the person go, the number's OTP challenges go,
        // the number is suppressed.
        now - s.started <= STEP_UP,
        sess' = { ...sess, rows: dropRows(sess.rows, k => sess.rows.get(k).phone != s.phone and
                                             (target == NONE or sess.rows.get(k).person != target)) },
        world' = { ...world,
                   phoneOf: world.phoneOf.set(s.phone, NONE),
                   alive: world.alive.exclude(Set(target)),
                   member: world.member.exclude(Set(target)),
                   suppressed: world.suppressed.union(Set(s.phone)) },
        ghost' = { ...ghost, actedUnvalidated: ghost.actedUnvalidated or unvalidated, foreignActs: if (foreign) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
      } else {
        // op == "join": api.ts:550-571, accounts.ts:355-422 with joinPlan (decisions.ts:134-146; one lock
        // per phone: one action). The order of joinPlan: a ban refuses; then the age decides, for a
        // member too (a member under the app age is "under_age"); then a member is "existing".
        val banned = world.banned.contains(s.phone)
        val oldFloor = world.floor.get(s.phone)
        val newFloor = if (oldFloor == NONE) age else imin(oldFloor, age)
        val isMember = target != NONE and world.member.contains(target)
        // recordAge writes the person's age too: a lower age for a person the actor does not own.
        val lowered = foreign and (oldFloor == NONE or age < oldFloor)
        if (banned) all {
          sess' = sess, world' = world, ghost' = ghost,
        } else if (newFloor < APP_MIN_AGE) all {
          // accounts.ts:373-380: under_age. The age floor is written; under 13, declineUnderAge
          // (accounts.ts:442-455) forgets every membership of the person. SD-491 fix: a number with no
          // person keeps no session (forgetPersonlessSessions, pg-store.ts:261-263), and api.ts:559-563
          // clears the cookies of a session with no person. A number with a person keeps its sessions:
          // its data is already stored, so the "nothing stored" rule is about a number with no person
          // (under13At).
          sess' = { ...sess,
                    rows: if (target != NONE) sess.rows
                          else dropRows(sess.rows, k => not(sess.rows.get(k).phone == s.phone and sess.rows.get(k).person == NONE)),
                    jar: if (s.person == NONE) sess.jar.set(h, NONE) else sess.jar },
          world' = { ...world, floor: world.floor.set(s.phone, newFloor),
                     member: if (newFloor < JOIN_FLOOR) world.member.exclude(Set(target)) else world.member },
          // The ghost `lowered` is not recorded here. Open drift (2026-11-09): a rotation that read a
          // person-less session before bindSessions creates its next row after it (sessions.ts:53-56,
          // no re-read of the person), so a session from before the person can still act for it.
          ghost' = { ...ghost, under13At: if (age < JOIN_FLOOR and target == NONE) ghost.under13At.put(s.phone, sess.nextSid) else ghost.under13At },
        } else if (isMember) all {
          // accounts.ts:381-387 "existing": a repeated join is still an age statement on
          // personFor(who.e164), and bindSessions gives this session the person (the others with no
          // person end).
          sess' = { ...sess, rows: bindSessions(sess.rows, s.phone, target, sid, now) },
          world' = { ...world, floor: world.floor.set(s.phone, newFloor) },
          ghost' = { ...ghost, ageLoweredByOther: ghost.ageLoweredByOther or lowered },
        } else {
          // accounts.ts:388-422: a person (when none), the membership, unsuppress, bindSessions: of the
          // person-less sessions of the number, only this request's session gets the person; the others
          // end now (SD-054 fix).
          val pid = if (target != NONE) target else world.nextPerson
          all {
            sess' = { ...sess, rows: bindSessions(sess.rows, s.phone, pid, sid, now) },
            world' = { ...world,
                       phoneOf: world.phoneOf.set(s.phone, pid),
                       bornAt: if (target != NONE) world.bornAt else world.bornAt.put(pid, sess.nextSid),
                       bornBy: if (target != NONE) world.bornBy else world.bornBy.put(pid, s.chain),
                       alive: world.alive.union(Set(pid)),
                       member: world.member.union(Set(pid)),
                       nextPerson: if (target != NONE) world.nextPerson else world.nextPerson + 1,
                       suppressed: world.suppressed.exclude(Set(s.phone)),
                       floor: world.floor.set(s.phone, newFloor) },
            ghost' = { ...ghost, foreignActs: if (foreign) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
          }
        }
      },
      // pg-store.ts:373: delete everything removes the number's OTP challenges.
      otp' = if (status == "valid" and op == "deleteAll")
               { ...otp, challenge: otp.challenge.keys().exclude(Set(s.phone)).mapBy(k => otp.challenge.get(k)) }
             else otp,
      now' = now, mode' = mode, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ other actors

  // The text channel (accounts text join, founder 2026-10-09 item 3): only the holder of a number can
  // text from it; a banned number is refused. An adult joins; the person is created when absent and
  // the join is a new opt-in (suppression lifted). service.ts:1677 creates the person with
  // accounts.createPerson and no session to keep, so every person-less web session of the number ends
  // (SD-054 fix).
  action textJoin(p: str): bool = {
    val h = world.holder.get(p)
    val target = personFor(world, p)
    val pid = if (target != NONE) target else world.nextPerson
    all {
      not(world.banned.contains(p)),
      world' = { ...world,
                 phoneOf: world.phoneOf.set(p, pid),
                 bornAt: if (target != NONE) world.bornAt else world.bornAt.put(pid, sess.nextSid),
                 bornBy: if (target != NONE) world.bornBy else world.bornBy.put(pid, NONE),
                 alive: world.alive.union(Set(pid)),
                 member: world.member.union(Set(pid)),
                 nextPerson: if (target != NONE) world.nextPerson else world.nextPerson + 1,
                 suppressed: world.suppressed.exclude(Set(p)) },
      sess' = if (target != NONE) sess else { ...sess, rows: bindSessions(sess.rows, p, pid, NONE, now) },
      now' = now, mode' = mode, otp' = otp, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // A carrier gives a number that has no person to another human (number recycling). A number with a
  // person stays with that person in these bounds (its next login after 12 months would hold it).
  // Assumption (carrier aging): a disconnected number ages at least 45 days before reassignment
  // (47 CFR 52.15(f)(1)(ii)), so no OTP code sent to the earlier holder (10 minutes) is still usable.
  action carrierReassign(p: str, h: str): bool = {
    all {
      world.holder.get(p) != h,
      personFor(world, p) == NONE,
      not(otp.challenge.keys().contains(p) and otp.challenge.get(p).live and otp.challenge.get(p).expires > now),
      world' = { ...world, holder: world.holder.set(p, h) },
      now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // service.ts:2010-2042 ban by phone: needs a person; writes the ban and suppresses the number.
  // Sessions are not revoked (not a rule this module checks: existing sessions keep own-data rights).
  action banNumber(p: str): bool = {
    all {
      personFor(world, p) != NONE,
      not(world.banned.contains(p)),
      world' = { ...world, banned: world.banned.union(Set(p)), suppressed: world.suppressed.union(Set(p)) },
      now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // Eliza Cloud revokes one Network delegation (sign-out, account change). A rotation keeps the same
  // proof (api.ts:323-333), so the revocation covers the whole chain. The backend learns it only
  // through validate.
  action cloudSignOut(chain: int): bool = all {
    sess.rows.keys().exists(k => sess.rows.get(k).cloud and sess.rows.get(k).chain == chain),
    not(world.cloudRevoked.contains(chain)),
    world' = { ...world, cloudRevoked: world.cloudRevoked.union(Set(chain)) },
    now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ proxy-signature, edge-trust, proxy-secret-rotation

  // deploy/router.ts:87-110 signs with the site's PLATFORM_PROXY_SECRET; deploy/backend/backend.ts:253-279
  // normalizeEdge verifies with the backend's secret, then with PLATFORM_PROXY_SECRET_PREVIOUS when it is
  // set (backend.ts:257-259), and the 60 s window (proxy.ts:75-84); deployed, an unverified /api or /mcp
  // request answers 421 (backend.ts:388, 399). The attacker sends directly with forged headers: a
  // signature without the secret never verifies (HMAC oracle).
  action edgeRequest(kind: str, routerSkew: int): bool = {
    val sigSecret = if (kind == "router") edge.siteSecret else 0     // 0: the attacker has no secret
    val verified = (sigSecret == edge.backendSecret or (edge.backendPrevious != NONE and sigSecret == edge.backendPrevious))
                   and iabs(routerSkew) <= PROXY_SKEW
    all {
      ghost' = { ...ghost,
                 servedUnsigned: ghost.servedUnsigned or (verified and kind != "router"),
                 edgeOutage: ghost.edgeOutage or (kind == "router" and not(verified) and iabs(routerSkew) <= PROXY_SKEW) },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // One deploy sets a new PLATFORM_PROXY_SECRET on one side. On the backend, `keepPrevious` sets
  // PLATFORM_PROXY_SECRET_PREVIOUS to the old value (docs/deploy.md 3.4, backend.ts:94); without it the
  // backend takes one secret only.
  action rotateProxySecret(side: str, keepPrevious: bool): bool = {
    val nextSecret = if (edge.backendSecret > edge.siteSecret) edge.backendSecret + 1 else edge.siteSecret + 1
    all {
      edge.backendSecret < 3, edge.siteSecret < 3,
      edge' = if (side == "backend") { ...edge, backendSecret: if (edge.siteSecret > edge.backendSecret) edge.siteSecret else nextSecret,
                                               backendPrevious: if (keepPrevious) edge.backendSecret else NONE }
              else { ...edge, siteSecret: if (edge.backendSecret > edge.siteSecret) edge.backendSecret else nextSecret },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, svc' = svc, ghost' = ghost,
    }
  }

  // The last step of a rotation: PLATFORM_PROXY_SECRET_PREVIOUS is removed from the backend.
  action dropPreviousProxySecret = all {
    edge.backendPrevious != NONE,
    edge' = { ...edge, backendPrevious: NONE },
    now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ svc-auth

  // svc-auth.ts:58-79 svcSign by the gateway with its own clock (now + skew). The gateway retries and
  // the network may deliver late or twice.
  action svcSend(id: str, skew: int): bool = {
    all {
      svc.inflight.size() < 3,
      svc' = { ...svc, inflight: svc.inflight.union(Set({ id: id, ts: now + skew, query: false })) },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge, ghost' = ghost,
    }
  }

  // An attacker appends a query string to a captured signed request (the signature covers the
  // pathname only, svc-auth.ts:57). Under the TLS assumption only a replaying sender can do this.
  action svcTamper(r: SvcReq): bool = {
    all {
      svc.inflight.contains(r),
      not(r.query),
      svc' = { ...svc, inflight: svc.inflight.union(Set({ ...r, query: true })) },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge, ghost' = ghost,
    }
  }

  // svc-auth.ts:86-115 svcVerify (|now - ts| <= 60) and the endpoint: a query string is refused
  // (service.ts:2267, 2424, relay-endpoint.ts:141, …), a seen id answers the stored response, a new id has
  // its effect once. The request may stay in flight (duplicate delivery).
  action svcDeliver(r: SvcReq, keep: bool): bool = {
    val fresh = iabs(now - r.ts) <= SVC_SKEW
    val effect = fresh and not(r.query) and not(svc.seen.contains(r.id))
    val count = if (svc.effects.keys().contains(r.id)) svc.effects.get(r.id) else 0
    all {
      svc.inflight.contains(r),
      svc' = { inflight: if (keep) svc.inflight else svc.inflight.exclude(Set(r)),
               seen: if (effect) svc.seen.union(Set(r.id)) else svc.seen,
               effects: if (effect) svc.effects.put(r.id, count + 1) else svc.effects },
      ghost' = { ...ghost,
                 staleSvcEffect: ghost.staleSvcEffect or (effect and not(fresh)),
                 querySvcEffect: ghost.querySvcEffect or (effect and r.query),
                 skewedSvcOk: ghost.skewedSvcOk or (effect and r.ts != now) },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge,
    }
  }

  // ------------------------------------------------------------------ step

  pure val TICKS = Set(1, 29, 31, 61, 600, HOUR, DAY, 29 * DAY)

  action step = {
    nondet h = HUMANS.oneOf()
    nondet p = PHONES.oneOf()
    nondet d = TICKS.oneOf()
    nondet flag = Set(true, false).oneOf()
    nondet op = Set("export", "leave", "join", "deleteAll").oneOf()
    nondet age = Set(10, 15, 25).oneOf()
    nondet cloudSays = Set("valid", "unavailable").oneOf()
    nondet cloudSkew = Set(-20, 0, 5, 25, 45).oneOf()
    nondet kind = Set("router", "direct").oneOf()
    nondet edgeSkew = Set(-61, -5, 0, 5, 61).oneOf()
    nondet side = Set("backend", "site").oneOf()
    nondet id = SVC_IDS.oneOf()
    nondet svcSkew = Set(-90, -30, 0, 30, 90).oneOf()
    any {
      // Actors that do not touch the login state: time, purge, the edge and the signed service hop.
      any {
        tick(d), purge,
        edgeRequest(kind, edgeSkew), rotateProxySecret(side, flag), dropPreviousProxySecret,
        svcSend(id, svcSkew),
        all { svc.inflight.size() > 0, nondet r = svc.inflight.oneOf() any { svcTamper(r), svcDeliver(r, flag) } },
      },
      otpStartFast(h, p, flag),
      any {
        otpStartBegin(h, p),
        all { otp.inflight.keys().size() > 0, nondet rid = otp.inflight.keys().oneOf() any {
          otpStartLimits(rid), otpStartSend(rid, flag), otpStartPut(rid), otpStartCrash(rid) } },
      },
      otpVerify(h, p),
      any {
        nondet req = Set(1, 2).oneOf()
        rotateRead(h, req),
        all { sess.pendingRot.size() > 0, nondet r = sess.pendingRot.oneOf() rotateCommit(r) },
      },
      cloudLogin(h, p, cloudSkew),
      account(h, op, age, cloudSays),
      all { sess.rows.keys().size() > 0, nondet k = sess.rows.keys().oneOf() cloudSignOut(sess.rows.get(k).chain) },
      any { textJoin(p), carrierReassign(p, h), banNumber(p) },
    }
  }

  // ------------------------------------------------------------------ invariants

  // AGENTS.md founder decisions 2026-10-09 item 3: "a banned number is refused at join (web, text, MCP),
  // OTP and inbound, on every app". No code goes out for a code request that began after the ban
  // committed (api.ts:474, otp.ts:189). A ban that commits while a request is in flight is concurrent with it; that
  // code can go out (witness_lateBanCode), and verify refuses it (bannedNoSession).
  // Was violated at ad67275 (SD-013); holds after 6225b02.
  val bannedNoCode = not(ghost.codeToBanned)

  // The same rule: no login (OTP or Cloud) creates a session for a banned number.
  // Was violated at ad67275 in OTP mode (SD-013); holds after 6225b02 (api.ts:488).
  val bannedNoSession = not(ghost.sessionToBanned)

  // accounts.ts:8 and 499 ("This app's own data") and PRD export/delete of one's own data: a session
  // from before a person existed (it may belong to an earlier holder of the number) never acts for that
  // person, except the session whose web join created it. A login made after the person exists gets the
  // person of the number by the recycled-number policy (accounts.ts:176-190), which this model scopes out.
  // Was violated at ad67275 (SD-054); holds after 6ddfc8f.
  val staleSessionNoAct = ghost.foreignActs == Set()

  // AGENTS.md age policy: "Lowest stated age wins"; a person's age is lowered only by a statement of
  // that person. A web join through a session from before the person (as in staleSessionNoAct) must not
  // lower that person's age.
  // Was violated at ad67275 (SD-054, the repeated-join branch); holds after 6ddfc8f.
  val ageOnlyByOwner = not(ghost.ageLoweredByOther)

  // AGENTS.md code invariants, age policy: "under 13 cannot join and is declined kindly with nothing
  // stored"; accounts.ts:7 "An under-age join stores nothing for that app (only the age floor)".
  // After an under-13 refusal for a number with no person, no session row from before the refusal still
  // holds the plain number. Was violated at ad67275 (SD-491); holds after b56267f.
  // Session ids are in creation order, so "from before the refusal" is an id below the recorded one (a
  // new login in the same second is not from before it).
  val under13NothingStored = sess.rows.keys().forall(k =>
    val r = sess.rows.get(k)
    not(ghost.under13At.keys().contains(r.phone) and k < ghost.under13At.get(r.phone)))

  // otp.ts:4-5: "A refused request is not counted, so it never extends a limit."
  // Was violated at ad67275 (SD-380); holds after d68fdd2.
  val otpRefusedNotCounted = not(ghost.burned)

  // api.ts:100-101 and 438: a Cloud proof whose issuedAt is at most 30 s ahead of our clock is accepted.
  // Was violated at ad67275 (SD-181, one case of SD-308); holds after c7515cc.
  val cloudSkewTolerated = ghost.cloudSkewRejects.forall(k => k > CLOUD_SKEW)

  // sessions.ts:6 and 14-15: a rotation chain never outlives 90 days from the login; a Cloud session
  // never outlives its Cloud proof (api.ts:444, sessions.ts:56).
  val chainBounded = sess.rows.keys().forall(k =>
    val r = sess.rows.get(k)
    r.expires <= r.started + SESSION_MAX and (not(r.cloud) or r.expires <= r.started + CLOUD_PROOF_LIFE + CLOUD_SKEW))

  // api.ts:264-265 and 297 (cloud-session-validation): a denial is never cached and an unavailable Cloud
  // gives no access. In this model the account action runs only on "valid".
  val unavailableNoAccess = not(ghost.actedUnvalidated)

  // proxy.ts:1-14 and backend.ts:246-252: only a request that a site router signed may name a site and an IP.
  val edgeHeaderSigned = not(ghost.servedUnsigned)

  // svc-auth.ts:10-11: replays inside the window are harmless because each endpoint is idempotent by id.
  val effectAtMostOnce = svc.effects.keys().forall(k => svc.effects.get(k) <= 1)

  // svc-auth.ts:10: requests older or newer than 60 s are rejected.
  val staleSvcRefused = not(ghost.staleSvcEffect)

  // svc-auth.ts:57 signs the pathname only, so a query string is not signed and must not be read.
  val queryNotSigned = not(ghost.querySvcEffect)

  // auth-mode-config (api.ts:152-198): the mode is fixed at boot. In Cloud mode the OTP routes answer 409
  // (api.ts:465, 483); in OTP mode the Cloud routes answer 404 (api.ts:405, 414). One mode, one login path.
  val oneAuthMode = (mode == "otp" implies ghost.cloudLogins == 0) and (mode == "cloud" implies ghost.otpLogins == 0)

  val safety = and {
    bannedNoCode,
    bannedNoSession,
    staleSessionNoAct,
    ageOnlyByOwner,
    under13NothingStored,
    otpRefusedNotCounted,
    cloudSkewTolerated,
    chainBounded,
    unavailableNoAccess,
    edgeHeaderSigned,
    effectAtMostOnce,
    staleSvcRefused,
    queryNotSigned,
    oneAuthMode,
  }

  // ------------------------------------------------------------------ witnesses (each must be violated)

  val witness_otpLogin = ghost.otpLogins == 0
  val witness_cloudLogin = ghost.cloudLogins == 0
  val witness_rotation = ghost.rotations == 0
  // SD-180 (refuted as harmless in the register): two live heads in one rotation chain.
  val witness_rotationFork = not(sess.rows.keys().exists(a => sess.rows.keys().exists(b =>
    a < b and sess.rows.get(a).chain == sess.rows.get(b).chain and
    sess.rows.get(a).revoked == NONE and sess.rows.get(b).revoked == NONE and
    sess.rows.get(a).expires > now and sess.rows.get(b).expires > now)))
  // A signed turn with a clock offset under 60 s is accepted.
  val witness_signedTurnSkew = not(ghost.skewedSvcOk)
  // SD-166 (runtime_ops): a one-side proxy secret rotation without PLATFORM_PROXY_SECRET_PREVIOUS (or a
  // site first) answers 421 to honest router requests.
  val witness_secretRotationOutage = not(ghost.edgeOutage)
  // SD-107: in Cloud mode a number that deleted everything cannot sign in on the web.
  val witness_cloudSuppressedRefused = not(ghost.cloudRefusedDeleted)
  // SD-013 remainder: a ban that commits while a code request is in flight does not stop that code.
  val witness_lateBanCode = not(ghost.lateBanCode)

  // ------------------------------------------------------------------ run tests (concrete traces)

  // The three actions of one accepted OtpService.start for request `rid`.
  action otpStartAll(rid: int): bool =
    otpStartLimits(rid).then(otpStartSend(rid, true)).then(otpStartPut(rid))

  // OTP login: the code goes to the holder, the holder gets a session with no person yet
  // (api.test.ts / api-security.test.ts login flow).
  run otpLoginTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .expect(ghost.otpLogins == 1 and sess.jar.get("alice") == 1 and sess.rows.get(1).person == NONE and safety)

  // Someone who does not hold the number never gets the code: a wrong code only counts an attempt.
  run otpWrongHolderTest =
    initWith("otp")
      .then(otpStartBegin("bob", "X")).then(otpStartAll(1))
      .then(otpVerify("bob", "X"))
      .expect(ghost.otpLogins == 0 and otp.challenge.get("X").attempts == 1 and safety)

  // SD-013 (fixed, 6225b02; auth-edge.integration.test.ts "SD-013 ..."): a code sent before the ban is
  // used up by verify and gives no session; a new start for the banned number counts in the rate
  // buckets and sends no code (api.ts:474, otp.ts:189).
  run sd013BannedOtpTest =
    initWith("otp")
      .then(textJoin("X"))
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(banNumber("X"))
      .then(otpVerify("alice", "X"))
      .expect(ghost.otpLogins == 0 and not(otp.challenge.get("X").live) and sess.rows == Map() and safety)
      .then(tick(31))
      .then(otpStartBegin("alice", "X")).then(otpStartLimits(2))
      .expect(otp.inflight == Map() and otp.nextRid == 3 and otp.buckets.get(("phone", "X")).n == 2
              and not(otp.challenge.get("X").live) and safety)
      .then(otpStartFast("alice", "X", true))
      .expect(not(otp.challenge.get("X").live) and safety)

  // SD-013 remainder: a ban that commits while a start is in flight (after the route's ban check) does
  // not stop that code, but verify refuses it: no session.
  run sd013LateBanTest =
    initWith("otp")
      .then(textJoin("X"))
      .then(otpStartBegin("alice", "X"))
      .then(banNumber("X"))
      .then(otpStartAll(1))
      .expect(ghost.lateBanCode and safety)
      .then(otpVerify("alice", "X"))
      .expect(ghost.otpLogins == 0 and sess.rows == Map() and safety)

  // Cloud mode refuses a banned number at the callback (api.ts:437): no session.
  run cloudBannedRefusedTest =
    initWith("cloud")
      .then(textJoin("X")).then(banNumber("X"))
      .then(cloudLogin("alice", "X", 0))
      .expect(ghost.cloudLogins == 0 and bannedNoSession)

  // SD-054 (fixed, 6ddfc8f; "SD-054 a session from before a text join ..."): bob logs in on Y before Y
  // has a person; the carrier gives Y to alice; alice joins by text. The text join ends bob's session,
  // so it can neither export alice's data nor make an age statement for her.
  run sd054StaleSessionTest =
    initWith("otp")
      .then(otpStartBegin("bob", "Y")).then(otpStartAll(1))
      .then(otpVerify("bob", "Y"))
      .then(carrierReassign("Y", "alice"))
      .then(textJoin("Y"))
      .expect(sess.rows.get(1).revoked == now and not(liveSession(sess, sess.jar.get("bob"), now)) and safety)

  // SD-054 (fixed, 6ddfc8f; "SD-054 a web join binds only the joining session ..."): bob and then alice
  // log in on Y (the carrier gave Y to alice in between); alice's web join gives the person to her own
  // session only and ends bob's.
  run sd054WebJoinTest =
    initWith("otp")
      .then(otpStartBegin("bob", "Y")).then(otpStartAll(1))
      .then(otpVerify("bob", "Y"))
      .then(carrierReassign("Y", "alice"))
      .then(tick(31))
      .then(otpStartBegin("alice", "Y")).then(otpStartAll(2))
      .then(otpVerify("alice", "Y"))
      .then(account("alice", "join", 25, "valid"))
      .expect(sess.rows.get(2).person == 1 and sess.rows.get(2).revoked == NONE
              and sess.rows.get(1).person == NONE and sess.rows.get(1).revoked == now
              and not(liveSession(sess, sess.jar.get("bob"), now)) and safety)

  // SD-491 (fixed, b56267f; "SD-491 an under-13 web join keeps no session with the number"): two logins
  // on X, then an under-13 web join. Only the age floor stays; no session row and no cookie.
  run sd491Under13Test =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(tick(31))
      .then(otpStartBegin("alice", "X")).then(otpStartAll(2))
      .then(otpVerify("alice", "X"))
      .then(account("alice", "join", 10, "valid"))
      .expect(world.floor.get("X") == 10 and world.alive == Set() and sess.rows == Map()
              and sess.jar.get("alice") == NONE and ghost.under13At.keys() == Set("X") and safety)

  // A member's repeated web join under 13 is "under_age" (joinPlan checks the age before "existing"):
  // the floor drops and declineUnderAge forgets the membership; the session keeps its person.
  // A banned number's export reads nothing.
  run repeatJoinUnderAgeTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(account("alice", "join", 25, "valid"))
      .then(account("alice", "join", 10, "valid"))
      .expect(world.floor.get("X") == 10 and world.member == Set() and world.alive == Set(1)
              and liveSession(sess, 1, now) and safety)
      .then(banNumber("X"))
      .then(account("alice", "export", 25, "valid"))
      .expect(ghost.foreignActs == Set() and safety)

  // An adult web join creates the person, attaches it to the session and passes every invariant.
  run webJoinTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(account("alice", "join", 25, "valid"))
      .expect(world.member == Set(1) and sess.rows.get(1).person == 1 and safety)

  // SD-380 (fixed, d68fdd2; "SD-380 a code request refused by a later limit ..."): a second start 1 s
  // later is refused by the 30 s gap of the phone bucket, and no bucket counts it.
  run sd380BurnTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(tick(1))
      .then(otpStartBegin("alice", "X")).then(otpStartLimits(2))
      .expect(otp.buckets.get(("ip", "alice")).n == 1 and otp.buckets.get(("phone", "X")).last == 0
              and otp.inflight.keys() == Set() and safety)

  // SD-380, the global limit (2 an hour in the model): a third number is refused, and its IP, hour and
  // day buckets stay empty.
  run sd380GlobalTest =
    initWith("otp")
      .then(otpStartFast("alice", "X", true))
      .then(otpStartFast("bob", "Y", true))
      .then(tick(31))
      .then(otpStartFast("alice", "Y", true))
      .expect(otp.buckets.get(("global", "")).n == 2 and otp.buckets.get(("ip", "alice")).n == 1
              and otp.buckets.get(("phone", "Y")).n == 1 and otp.buckets.get(("phone", "Y")).last == 0 and safety)

  // SD-181 (fixed, c7515cc; "SD-181 a Cloud clock 5 s ahead still signs in ..."): a Cloud clock 5 s
  // ahead signs in; one 45 s ahead is still refused (outside the 30 s allowance).
  run sd181CloudSkewTest =
    initWith("cloud")
      .then(cloudLogin("alice", "X", 5))
      .expect(ghost.cloudLogins == 1 and sess.rows.get(1).started == 0 and safety)
      .then(cloudLogin("bob", "Y", 45))
      .expect(ghost.cloudLogins == 1 and ghost.cloudSkewRejects == Set(45) and safety)

  // Cloud login with a Cloud clock behind ours, then a validated export; a Cloud revocation makes the
  // next request revoke the session, and "unavailable" changes nothing.
  run cloudLoginTest =
    initWith("cloud")
      .then(cloudLogin("alice", "X", -20))
      .expect(ghost.cloudLogins == 1 and sess.rows.get(1).started == -20 and safety)
      .then(account("alice", "export", 25, "unavailable"))
      .expect(liveSession(sess, 1, now) and safety)
      .then(cloudSignOut(1))
      .then(account("alice", "export", 25, "valid"))
      .expect(not(liveSession(sess, 1, now)) and safety)

  // SD-107: in Cloud mode a number that deleted everything cannot sign in on the web (api.ts:437);
  // a text join lifts the suppression and the Cloud sign-in works again.
  run sd107CloudSuppressedTest =
    initWith("cloud")
      .then(cloudLogin("alice", "X", 0))
      .then(account("alice", "deleteAll", 25, "valid"))
      .then(cloudLogin("alice", "X", 0))
      .expect(ghost.cloudRefusedDeleted and ghost.cloudLogins == 1)
      .then(textJoin("X"))
      .then(cloudLogin("alice", "X", 0))
      .expect(ghost.cloudLogins == 2 and safety)

  // Rotation after a day; two parallel requests with the same old cookie both rotate (SD-180).
  run rotationForkTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(tick(DAY))
      .then(rotateRead("alice", 1)).then(rotateRead("alice", 2))
      .then(rotateCommit({ human: "alice", sid: 1, req: 1 }))
      .then(rotateCommit({ human: "alice", sid: 1, req: 2 }))
      .expect(ghost.rotations == 2 and not(witness_rotationFork) and sess.rows.get(1).revoked == DAY + SESSION_GRACE and safety)

  // svc-auth: a turn signed 30 s ahead is accepted once; a duplicate delivery has no second effect;
  // a 90 s old request and a request with a query string have none.
  run svcTest =
    initWith("otp")
      .then(svcSend("m1", 30))
      .then(svcDeliver({ id: "m1", ts: 30, query: false }, true))
      .then(svcDeliver({ id: "m1", ts: 30, query: false }, false))
      .expect(svc.effects.get("m1") == 1 and ghost.skewedSvcOk and safety)
      .then(svcSend("m2", -90))
      .then(svcTamper({ id: "m2", ts: -90, query: false }))
      .then(svcDeliver({ id: "m2", ts: -90, query: false }, false))
      .then(svcDeliver({ id: "m2", ts: -90, query: true }, false))
      .expect(not(svc.effects.keys().contains("m2")) and safety)

  // edge-trust: a forged direct request is never served. The runbook rotation (docs/deploy.md 3.4: the
  // backend first with PLATFORM_PROXY_SECRET_PREVIOUS, then the sites, then the previous value goes) has
  // no outage; a backend-only rotation without the previous value turns honest router requests into 421
  // until the site deploy (SD-166, runtime_ops).
  run edgeTest =
    initWith("otp")
      .then(edgeRequest("direct", 0))
      .then(edgeRequest("router", 5))
      .expect(not(ghost.edgeOutage) and safety)
      .then(rotateProxySecret("backend", true))
      .then(edgeRequest("router", 0))
      .expect(not(ghost.edgeOutage) and edge.backendPrevious == 1 and safety)
      .then(rotateProxySecret("site", false))
      .then(dropPreviousProxySecret)
      .then(edgeRequest("router", 0))
      .expect(not(ghost.edgeOutage) and edge.siteSecret == edge.backendSecret and safety)
      .then(rotateProxySecret("backend", false))
      .then(edgeRequest("router", 0))
      .expect(ghost.edgeOutage and safety)

  // The macro-step gives the same buckets and challenge as the single actions, and a refused second
  // start 1 s later counts in no bucket.
  run otpStartFastTest =
    initWith("otp")
      .then(otpStartFast("alice", "X", true))
      .expect(otp.challenge.get("X").sentTo == "alice" and otp.buckets.get(("phone", "X")).n == 1
              and otp.buckets.get(("global", "")).n == 1 and safety)
      .then(tick(1))
      .then(otpStartFast("alice", "X", true))
      .expect(otp.buckets.get(("ip", "alice")).n == 1 and otp.buckets.get(("phone", "X")).n == 1 and safety)
}
```
