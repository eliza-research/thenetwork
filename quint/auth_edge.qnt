// quint-check: max-steps=24 max-samples=6000 verify-steps=6
// -*- mode: Bluespec; -*-
//
// auth_edge: web login, sessions, the Cloud sign-in handoff and the signed hops in front of the backend.
// Module plan: docs/research/2026-11-07-state-machines.md section 6.10. Machines: otp-challenge (M-057),
// web-session (M-058), cloud-handoff (M-059), cloud-session-validation (M-060), proxy-signature (M-061),
// edge-trust (M-062), svc-auth (M-063), auth-mode-config (M-129), public-api-gates (M-130),
// proxy-secret-rotation (M-131).
//
// The model follows the code as it is at ad67275, not as it should be:
//   packages/platform/src/api.ts          routes, gates, Cloud callback and validation
//   packages/platform/src/otp.ts          OtpService.start / verify and the rate buckets
//   packages/platform/src/sessions.ts     SessionService.create / authenticate / revoke / fresh
//   packages/platform/src/accounts.ts     join, leave, deleteAll, exportApp (who = {e164, personId})
//   packages/platform/src/pg-store.ts     hit, sessions, deleteAll, attachPerson, purge
//   packages/platform/src/cloud-delegation.ts and packages/core/src/svc/network-delegation.ts
//   packages/platform/src/proxy.ts, deploy/router.ts, deploy/backend/backend.ts (normalizeEdge)
//   packages/core/src/svc/svc-auth.ts and the signed endpoints that use it
//
// Abstractions (each one is listed so that a reader can check it):
//  - Time is an integer in seconds. `tick` moves it by one of a few named steps.
//  - HMAC, the OTP code, Turnstile and the Cloud proof are oracles. A human knows a code only when the
//    provider sent it to the phone that human holds. Nobody can forge a signature without the secret.
//  - Each SQL transaction is one action. OtpService.start is six actions (four rate buckets, the
//    provider send, putChallenge), because each bucket commits on its own (pg-store.ts:229-243).
//    The OTP verify route and the Cloud callback are one action each: their internal awaits do not
//    change any value that the invariants below read (noted at each action).
//  - One app (slop, 18+), two phones, two humans. A carrier can give a number to another human
//    (number recycling); the 12-month hold (accounts.ts:176-184) cannot be reached in these bounds.
//  - Assumption (upstream): the Worker to backend hop and the gateway to backend hop are TLS, so an
//    attacker cannot capture or change a signed request. The attacker can send any request directly.
//  - Assumption (svc endpoints): each signed endpoint records its id and its effect in one transaction
//    (the durable inbox is modelled in quint/turn_consent.qnt).
module auth_edge {

  // ------------------------------------------------------------------ constants (code values)

  pure val MINUTE = 60
  pure val HOUR = 3600
  pure val DAY = 86400
  // otp.ts:129-132 OTP_LIMITS. GLOBAL_PER_HOUR is 500 in the code; the model bound is 2 so that the
  // global refusal is reachable in a short trace. The rule it checks does not depend on the value.
  pure val OTP_TTL = 600
  pure val OTP_MAX_ATTEMPTS = 5
  pure val PER_PHONE_HOUR = 3
  pure val PER_PHONE_DAY = 6
  pure val PER_IP_HOUR = 10
  pure val MIN_GAP = 30
  pure val GLOBAL_PER_HOUR = 2
  // sessions.ts:12-19
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
  // apps.ts: slop is 18+; policy.ts: under 13 cannot join at all.
  pure val APP_MIN_AGE = 18
  pure val JOIN_FLOOR = 13

  pure val PHONES = Set("X", "Y")
  pure val HUMANS = Set("alice", "bob")
  pure val SVC_IDS = Set("m1", "m2")
  pure val NONE = -1

  pure def imin(a: int, b: int): int = if (a < b) a else b
  pure def iabs(a: int): int = if (a < 0) -a else a

  // ------------------------------------------------------------------ types

  type Bucket = { start: int, n: int, last: int }
  // One OtpService.start in flight. stage: 0 ip, 1 phone hour (and gap), 2 phone day, 3 global,
  // 4 provider send, 5 putChallenge.
  type StartReq = { phone: str, ip: str, stage: int, sentTo: str }
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
    owner: int -> str,           // ghost: the human who created each person
    alive: Set[int],             // people with deleted_at null
    member: Set[int],            // a live slop membership
    nextPerson: int,
    banned: Set[str],            // platform.bans by phone hash (service.ts:1734-1760)
    suppressed: Set[str],        // platform.suppression (delete everything, ban)
    floor: str -> int,           // platform.age_floor (NONE when absent)
    cloudRevoked: Set[int],      // Eliza Cloud: delegations (by session chain) that Cloud now denies
  }
  type Otp = { buckets: (str, str) -> Bucket, inflight: int -> StartReq, nextRid: int, challenge: str -> Challenge }
  type Sess = { rows: int -> Session, jar: str -> int, nextSid: int, pendingRot: Set[Rot] }
  type Edge = { backendSecret: int, siteSecret: int }
  type Svc = { inflight: Set[SvcReq], seen: Set[str], effects: str -> int }
  type Ghost = {
    codeToBanned: bool,          // a code went to a banned number
    sessionToBanned: bool,       // a session was created for a banned number
    otpLogins: int,
    cloudLogins: int,
    burned: bool,                // an OTP start was refused after an earlier bucket counted it
    foreignActs: Set[Act],       // account actions on a person the acting human does not own
    under13At: str -> int,       // time of an under-13 web join refusal per phone
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
  var mode: str                  // auth-mode-config: "otp" or "cloud" (api.ts:152-193), fixed at boot
  var world: World
  var otp: Otp
  var sess: Sess
  var edge: Edge
  var svc: Svc
  var ghost: Ghost

  // ------------------------------------------------------------------ helpers

  // accounts.ts:142-147 personFor: the live person of the phone (no hold in these bounds).
  def personFor(w: World, p: str): int =
    val id = w.phoneOf.get(p)
    if (id != NONE and w.alive.contains(id)) id else NONE

  // pg-store.ts:229-243 hit: one advisory-locked transaction per bucket.
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

  // sessions.ts:46-52 authenticate (the checks before rotation).
  def liveSession(s: Sess, sid: int, at: int): bool =
    sid != NONE and s.rows.keys().contains(sid) and
    (s.rows.get(sid).revoked == NONE or s.rows.get(sid).revoked > at) and
    s.rows.get(sid).expires > at

  // sessions.ts:62-64 revoke: revoked_at = least(coalesce(revoked_at, at), at) (pg-store.ts:222-224).
  pure def revokeRow(rows: int -> Session, sid: int, at: int): int -> Session =
    if (sid != NONE and rows.keys().contains(sid))
      rows.set(sid, { ...rows.get(sid), revoked: if (rows.get(sid).revoked == NONE) at else imin(rows.get(sid).revoked, at) })
    else rows

  pure def dropRows(rows: int -> Session, keep: int => bool): int -> Session =
    rows.keys().filter(k => keep(k)).mapBy(k => rows.get(k))

  // ------------------------------------------------------------------ init

  action initWith(m: str): bool = all {
    now' = 0,
    mode' = m,
    world' = {
      holder: Map("X" -> "alice", "Y" -> "bob"),
      phoneOf: Map("X" -> NONE, "Y" -> NONE),
      owner: Map(),
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
    edge' = { backendSecret: 1, siteSecret: 1 },
    svc' = { inflight: Set(), seen: Set(), effects: Map() },
    ghost' = {
      codeToBanned: false, sessionToBanned: false, otpLogins: 0, cloudLogins: 0, burned: false,
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

  // api.ts:462-473 POST /api/auth/otp/start. Cloud mode answers 409 (api.ts:463). Turnstile is an
  // oracle that passes. There is no ban check before otp.start (the subject of SD-013).
  action otpStartBegin(h: str, p: str): bool = all {
    mode == "otp",
    otp.inflight.keys().size() < 2,
    otp' = { ...otp, inflight: otp.inflight.put(otp.nextRid, { phone: p, ip: h, stage: 0, sentTo: "" }), nextRid: otp.nextRid + 1 },
    now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // otp.ts:171-184: one bucket per transaction. A refusal ends the request; the buckets that came
  // before it keep their hit.
  pure def bucketStage(r: StartReq): { key: (str, str), window: int, limit: int, gap: int } =
    if (r.stage == 0) { key: ("ip", r.ip), window: HOUR, limit: PER_IP_HOUR, gap: 0 }
    else if (r.stage == 1) { key: ("phone", r.phone), window: HOUR, limit: PER_PHONE_HOUR, gap: MIN_GAP }
    else if (r.stage == 2) { key: ("day", r.phone), window: DAY, limit: PER_PHONE_DAY, gap: 0 }
    else { key: ("global", ""), window: HOUR, limit: GLOBAL_PER_HOUR, gap: 0 }

  action otpStartBucket(rid: int): bool = {
    val r = otp.inflight.get(rid)
    val b = bucketStage(r)
    all {
      otp.inflight.keys().contains(rid),
      r.stage <= 3,
      if (hitOk(otp.buckets, b.key, b.window, now, b.limit, b.gap)) all {
        otp' = { ...otp, buckets: hitApply(otp.buckets, b.key, b.window, now),
                 inflight: otp.inflight.set(rid, { ...r, stage: r.stage + 1 }) },
        ghost' = ghost,
      } else all {
        // limited(): 429. Earlier stages already committed their hit (otp.ts:4-5 says they must not count).
        otp' = { ...otp, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
        ghost' = { ...ghost, burned: ghost.burned or r.stage > 0 },
      },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // otp.ts:186: provider.send. The SMS goes to whoever holds the number now. A provider error is
  // logged and the answer stays { ok: true } with no challenge (otp.ts:191-194).
  action otpStartSend(rid: int, delivered: bool): bool = {
    val r = otp.inflight.get(rid)
    all {
      otp.inflight.keys().contains(rid),
      r.stage == 4,
      if (delivered) all {
        otp' = { ...otp, inflight: otp.inflight.set(rid, { ...r, stage: 5, sentTo: world.holder.get(r.phone) }) },
        ghost' = { ...ghost, codeToBanned: ghost.codeToBanned or world.banned.contains(r.phone) },
      } else all {
        otp' = { ...otp, inflight: otp.inflight.keys().exclude(Set(rid)).mapBy(k => otp.inflight.get(k)) },
        ghost' = ghost,
      },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // otp.ts:187-190 putChallenge: the newest challenge is the one verify reads (latestChallenge).
  action otpStartPut(rid: int): bool = {
    val r = otp.inflight.get(rid)
    all {
      otp.inflight.keys().contains(rid),
      r.stage == 5,
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

  // The six actions above run back to back with no other step in between (a macro-step: it adds no
  // behaviour, it only lets the random simulation reach a login in fewer steps).
  pure def startBuckets(b: (str, str) -> Bucket, h: str, p: str, at: int): { ok: bool, burned: bool, buckets: (str, str) -> Bucket } =
    val stages = [0, 1, 2, 3]
    stages.foldl({ ok: true, burned: false, buckets: b }, (acc, st) =>
      if (not(acc.ok)) acc
      else {
        val k = bucketStage({ phone: p, ip: h, stage: st, sentTo: "" })
        if (hitOk(acc.buckets, k.key, k.window, at, k.limit, k.gap))
          { ...acc, buckets: hitApply(acc.buckets, k.key, k.window, at) }
        else { ok: false, burned: st > 0, buckets: acc.buckets }
      })

  action otpStartFast(h: str, p: str, delivered: bool): bool = {
    val r = startBuckets(otp.buckets, h, p, now)
    all {
      mode == "otp",
      otp' = { ...otp, buckets: r.buckets,
               challenge: if (r.ok and delivered)
                 otp.challenge.put(p, { live: true, attempts: 0, expires: now + OTP_TTL, sentTo: world.holder.get(p) })
                 else otp.challenge },
      ghost' = { ...ghost, burned: ghost.burned or r.burned,
                 codeToBanned: ghost.codeToBanned or (r.ok and delivered and world.banned.contains(p)) },
      now' = now, mode' = mode, world' = world, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ otp-challenge (verify) + web-session (create)

  // api.ts:479-492 POST /api/auth/otp/verify with otp.ts:198-211. One action: claimAttempt and
  // consumeChallenge are the only writes before the session, and nothing in between changes a value that
  // an invariant reads. The right code is known only to the human the SMS went to. No ban check (SD-013).
  action otpVerify(h: str, p: str): bool = {
    val c = otp.challenge.get(p)
    val right = c.sentTo == h
    all {
      mode == "otp",
      otp.challenge.keys().contains(p),
      // claimAttempt (pg-store.ts:204-208)
      c.live, c.expires > now, c.attempts < OTP_MAX_ATTEMPTS,
      if (right) {
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

  // sessions.ts:49-52: the read. A session older than a day and not yet rotated will rotate.
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

  // sessions.ts:53-56: revoke the old token with a 60 s grace, then create the next one. No
  // compare-and-set: two requests that both read the old row both rotate it (SD-180, refuted as harmless).
  action rotateCommit(r: Rot): bool = {
    val old = sess.rows.get(r.sid)
    val sid = sess.nextSid
    val rows1 = revokeRow(sess.rows, r.sid, now + SESSION_GRACE)
    val expires = imin(imin(now + SESSION_TTL, old.started + SESSION_MAX), if (old.cloud) old.expires else now + SESSION_TTL)
    all {
      sess.pendingRot.contains(r),
      sess.rows.keys().contains(r.sid),
      sess' = { ...sess,
                rows: rows1.put(sid, { ...old, created: now, expires: expires, revoked: NONE }),
                jar: sess.jar.set(r.human, sid), nextSid: sid + 1,
                pendingRot: sess.pendingRot.exclude(Set(r)) },
      ghost' = { ...ghost, rotations: ghost.rotations + 1 },
      now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc,
    }
  }

  // pg-store.ts:281-292 purge: expired and revoked rows go.
  action purge = all {
    sess' = { ...sess, rows: dropRows(sess.rows, k => sess.rows.get(k).expires >= now and
                                         (sess.rows.get(k).revoked == NONE or sess.rows.get(k).revoked >= now)) },
    now' = now, mode' = mode, world' = world, otp' = otp, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ cloud-handoff (callback)

  // api.ts:411-452 GET /api/auth/cloud/callback in production (productionDelegation set). Cloud signs a
  // phone proof for the number the human holds now, with its own clock: issuedAt = now + skew.
  // cloud-delegation.ts:22 parseNetworkDelegation(…, o.now()) refuses issuedAt*1000 > now with no skew
  // allowance (network-delegation.ts:40). The api.ts:436 check with CLOUD_CLOCK_SKEW_MS runs after it.
  action cloudLogin(h: str, p: str, skew: int): bool = {
    val issuedAt = now + skew
    val proofExpires = issuedAt + CLOUD_PROOF_LIFE
    val parsedOk = issuedAt <= now and proofExpires > now               // network-delegation.ts:40
    val callbackOk = parsedOk and issuedAt <= now + CLOUD_SKEW           // api.ts:436
    val refused = world.banned.contains(p) or world.suppressed.contains(p) // api.ts:437 (no hold here)
    val person = personFor(world, p)
    val sid = sess.nextSid
    val started = imin(issuedAt, now)                                  // api.ts:442
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

  // api.ts:313-321 auth(), then one of the withSession routes. In Cloud mode the session's proof is
  // validated first (cloudSessionStatus, api.ts:267-283): "invalid" revokes, "unavailable" answers 503
  // (api.ts:318, 696). In production every request asks Cloud (no cache, api.ts:274). The Cloud answer
  // is an oracle; a human that Cloud has revoked always gets "invalid".
  // who = { e164: session.phone, personId: session.person } (api.ts:391). The Accounts calls use
  // personFor(who.e164) and do not compare who.personId (accounts.ts:398-463).
  action account(h: str, op: str, age: int, cloudSays: str): bool = {
    val sid = sess.jar.get(h)
    val s = sess.rows.get(sid)
    // cloud-delegation.ts:26-37 validate: Cloud denies (403) a revoked delegation; otherwise the answer is
    // valid or unavailable (oracle).
    val status = if (not(s.cloud)) "valid" else if (world.cloudRevoked.contains(s.chain)) "invalid" else cloudSays
    val target = personFor(world, s.phone)
    val foreign = target != NONE and world.owner.get(target) != h
    val act = { human: h, person: target, op: op }
    val unvalidated = s.cloud and (world.cloudRevoked.contains(s.chain) or status != "valid")
    all {
      liveSession(sess, sid, now),
      if (status == "invalid") all {
        // api.ts:319: the session is revoked; 401.
        sess' = { ...sess, rows: revokeRow(sess.rows, sid, now) },
        world' = world, ghost' = ghost,
      } else if (status == "unavailable") all {
        // api.ts:318: 503, nothing happens.
        sess' = sess, world' = world, ghost' = ghost,
      } else if (op == "export") all {
        // api.ts:574-577, accounts.ts:447-463: the data of personFor(who.e164).
        sess' = sess, world' = world,
        ghost' = { ...ghost, actedUnvalidated: ghost.actedUnvalidated or unvalidated,
                   foreignActs: if (foreign) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
      } else if (op == "leave") all {
        // api.ts:629, accounts.ts:421-429: the forget path of personFor(who.e164).
        sess' = sess,
        world' = { ...world, member: world.member.exclude(Set(target)) },
        ghost' = { ...ghost, actedUnvalidated: ghost.actedUnvalidated or unvalidated,
                   foreignActs: if (foreign and world.member.contains(target)) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
      } else if (op == "deleteAll") all {
        // api.ts:630-635: step-up (sessions.fresh), then accounts.deleteAll (accounts.ts:432-444,
        // pg-store.ts:304-325): sessions of the phone or the person go, the number is suppressed.
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
        // op == "join": api.ts:545-561, accounts.ts:345-395 (one lock per phone: one action).
        val banned = world.banned.contains(s.phone)
        val oldFloor = world.floor.get(s.phone)
        val newFloor = if (oldFloor == NONE) age else imin(oldFloor, age)
        val isMember = target != NONE and world.member.contains(target)
        if (banned) all {
          sess' = sess, world' = world, ghost' = ghost,
        } else if (isMember) all {
          // accounts.ts:357-363: a repeated join is still an age statement on personFor(who.e164).
          sess' = sess,
          world' = { ...world, floor: world.floor.set(s.phone, newFloor) },
          ghost' = { ...ghost, ageLoweredByOther: ghost.ageLoweredByOther or (foreign and age < oldFloor) or (foreign and oldFloor == NONE) },
        } else if (newFloor < APP_MIN_AGE) all {
          // accounts.ts:365-370: under_age. Only the age floor is written; api.ts:555 keeps the session.
          sess' = sess,
          world' = { ...world, floor: world.floor.set(s.phone, newFloor) },
          ghost' = { ...ghost, under13At: if (age < JOIN_FLOOR) ghost.under13At.put(s.phone, now) else ghost.under13At },
        } else {
          // accounts.ts:371-385: a person (when none), the membership, unsuppress, attachPerson.
          val pid = if (target != NONE) target else world.nextPerson
          all {
            sess' = { ...sess, rows: sess.rows.keys().mapBy(k =>
                       if (sess.rows.get(k).phone == s.phone and sess.rows.get(k).person == NONE)
                         { ...sess.rows.get(k), person: pid } else sess.rows.get(k)) },
            world' = { ...world,
                       phoneOf: world.phoneOf.set(s.phone, pid),
                       owner: if (target != NONE) world.owner else world.owner.put(pid, h),
                       alive: world.alive.union(Set(pid)),
                       member: world.member.union(Set(pid)),
                       nextPerson: if (target != NONE) world.nextPerson else world.nextPerson + 1,
                       suppressed: world.suppressed.exclude(Set(s.phone)),
                       floor: world.floor.set(s.phone, newFloor) },
            ghost' = { ...ghost, foreignActs: if (foreign) ghost.foreignActs.union(Set(act)) else ghost.foreignActs },
          }
        }
      },
      now' = now, mode' = mode, otp' = otp, edge' = edge, svc' = svc,
    }
  }

  // ------------------------------------------------------------------ other actors

  // The text channel (accounts text join, founder 2026-10-09 item 3): only the holder of a number can
  // text from it; a banned number is refused. An adult joins; the person is created when absent and
  // the join is a new opt-in (suppression lifted). Sessions are not touched (attachPerson is web only).
  action textJoin(p: str): bool = {
    val h = world.holder.get(p)
    val target = personFor(world, p)
    val pid = if (target != NONE) target else world.nextPerson
    all {
      not(world.banned.contains(p)),
      world' = { ...world,
                 phoneOf: world.phoneOf.set(p, pid),
                 owner: if (target != NONE) world.owner else world.owner.put(pid, h),
                 alive: world.alive.union(Set(pid)),
                 member: world.member.union(Set(pid)),
                 nextPerson: if (target != NONE) world.nextPerson else world.nextPerson + 1,
                 suppressed: world.suppressed.exclude(Set(p)) },
      now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // A carrier gives a number that has no person to another human (number recycling). A number with a
  // person stays with that person in these bounds (its next login after 12 months would hold it).
  action carrierReassign(p: str, h: str): bool = {
    all {
      world.holder.get(p) != h,
      personFor(world, p) == NONE,
      world' = { ...world, holder: world.holder.set(p, h) },
      now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
    }
  }

  // service.ts:1734-1760 ban by phone: needs a person; writes the ban and suppresses the number.
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
  // proof (api.ts:322-331), so the revocation covers the whole chain. The backend learns it only
  // through validate.
  action cloudSignOut(chain: int): bool = all {
    sess.rows.keys().exists(k => sess.rows.get(k).cloud and sess.rows.get(k).chain == chain),
    not(world.cloudRevoked.contains(chain)),
    world' = { ...world, cloudRevoked: world.cloudRevoked.union(Set(chain)) },
    now' = now, mode' = mode, otp' = otp, sess' = sess, edge' = edge, svc' = svc, ghost' = ghost,
  }

  // ------------------------------------------------------------------ proxy-signature, edge-trust, proxy-secret-rotation

  // deploy/router.ts:88-127 signs with the site's PLATFORM_PROXY_SECRET; deploy/backend/backend.ts:236-255
  // normalizeEdge verifies with the backend's secret and the 60 s window (proxy.ts:73-82); deployed, an
  // unverified /api or /mcp request answers 421 (backend.ts:216, 224). The attacker sends directly
  // with forged headers: a signature without the secret never verifies (HMAC oracle).
  action edgeRequest(kind: str, routerSkew: int): bool = {
    val sigSecret = if (kind == "router") edge.siteSecret else 0     // 0: the attacker has no secret
    val verified = sigSecret == edge.backendSecret and iabs(routerSkew) <= PROXY_SKEW
    all {
      ghost' = { ...ghost,
                 servedUnsigned: ghost.servedUnsigned or (verified and kind != "router"),
                 edgeOutage: ghost.edgeOutage or (kind == "router" and not(verified) and iabs(routerSkew) <= PROXY_SKEW) },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, edge' = edge, svc' = svc,
    }
  }

  // One deploy sets a new PLATFORM_PROXY_SECRET on one side; the backend takes exactly one secret.
  action rotateProxySecret(side: str): bool = {
    val nextSecret = if (edge.backendSecret > edge.siteSecret) edge.backendSecret + 1 else edge.siteSecret + 1
    all {
      edge.backendSecret < 3, edge.siteSecret < 3,
      edge' = if (side == "backend") { ...edge, backendSecret: if (edge.siteSecret > edge.backendSecret) edge.siteSecret else nextSecret }
              else { ...edge, siteSecret: if (edge.backendSecret > edge.siteSecret) edge.backendSecret else nextSecret },
      now' = now, mode' = mode, world' = world, otp' = otp, sess' = sess, svc' = svc, ghost' = ghost,
    }
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
  // (service.ts:1979, relay-endpoint.ts:141, …), a seen id answers the stored response, a new id has
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
        edgeRequest(kind, edgeSkew), rotateProxySecret(side),
        svcSend(id, svcSkew),
        all { svc.inflight.size() > 0, nondet r = svc.inflight.oneOf() any { svcTamper(r), svcDeliver(r, flag) } },
      },
      otpStartFast(h, p, flag),
      any {
        otpStartBegin(h, p),
        all { otp.inflight.keys().size() > 0, nondet rid = otp.inflight.keys().oneOf() any {
          otpStartBucket(rid), otpStartSend(rid, flag), otpStartPut(rid), otpStartCrash(rid) } },
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
  // OTP and inbound, on every app". No code goes to a banned number (api.ts:462-477 has no ban check).
  // Violated: SD-013.
  val bannedNoCode = not(ghost.codeToBanned)

  // The same rule: no login (OTP or Cloud) creates a session for a banned number.
  // Violated: SD-013 (OTP mode; the Cloud callback refuses a banned number).
  val bannedNoSession = not(ghost.sessionToBanned)

  // accounts.ts:9-10 and 446 ("This app's own data") and PRD export/delete of one's own data: an account
  // action through a session acts only on the person of the human who holds that session.
  // Violated: SD-054.
  val staleSessionNoAct = ghost.foreignActs == Set()

  // AGENTS.md age policy: "Lowest stated age wins"; a person's age is lowered only by a statement of
  // that person. A web join through someone else's session must not lower another person's age.
  // Violated: SD-054 (the same stale session, through the repeated-join branch).
  val ageOnlyByOwner = not(ghost.ageLoweredByOther)

  // AGENTS.md code invariants, age policy: "under 13 cannot join and is declined kindly with nothing
  // stored"; accounts.ts:7 "An under-age join stores nothing for that app (only the age floor)".
  // After an under-13 refusal no session row from before the refusal still holds the plain number.
  // Violated: SD-491.
  val under13NothingStored = sess.rows.keys().forall(k =>
    val r = sess.rows.get(k)
    not(ghost.under13At.keys().contains(r.phone) and r.created <= ghost.under13At.get(r.phone)))

  // otp.ts:4-5: "A refused request is not counted, so it never extends a limit."
  // Violated: SD-380.
  val otpRefusedNotCounted = not(ghost.burned)

  // api.ts:100-101 and 441: a Cloud proof whose issuedAt is at most 30 s ahead of our clock is accepted.
  // Violated: SD-181 (one case of SD-308).
  val cloudSkewTolerated = ghost.cloudSkewRejects.forall(k => k > CLOUD_SKEW)

  // sessions.ts:6 and 14-15: a rotation chain never outlives 90 days from the login; a Cloud session
  // never outlives its Cloud proof (api.ts:442, sessions.ts:55).
  val chainBounded = sess.rows.keys().forall(k =>
    val r = sess.rows.get(k)
    r.expires <= r.started + SESSION_MAX and (not(r.cloud) or r.expires <= r.started + CLOUD_PROOF_LIFE + CLOUD_SKEW))

  // api.ts:263-264 and 293 (cloud-session-validation): a denial is never cached and an unavailable Cloud
  // gives no access. In this model the account action runs only on "valid".
  val unavailableNoAccess = not(ghost.actedUnvalidated)

  // proxy.ts:1-14 and backend.ts:91-96: only a request that a site router signed may name a site and an IP.
  val edgeHeaderSigned = not(ghost.servedUnsigned)

  // svc-auth.ts:10-11: replays inside the window are harmless because each endpoint is idempotent by id.
  val effectAtMostOnce = svc.effects.keys().forall(k => svc.effects.get(k) <= 1)

  // svc-auth.ts:10: requests older or newer than 60 s are rejected.
  val staleSvcRefused = not(ghost.staleSvcEffect)

  // svc-auth.ts:57 signs the pathname only, so a query string is not signed and must not be read.
  val queryNotSigned = not(ghost.querySvcEffect)

  // auth-mode-config (api.ts:152-193): the mode is fixed at boot. In Cloud mode the OTP routes answer 409
  // (api.ts:463, 480); in OTP mode the Cloud routes answer 404 (api.ts:403, 412). One mode, one login path.
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

  // The invariants that the simulation and Apalache do not violate (see docs/research/quint-findings/auth_edge.md).
  val holding = and {
    chainBounded, unavailableNoAccess, edgeHeaderSigned, effectAtMostOnce, staleSvcRefused, queryNotSigned, oneAuthMode,
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
  // SD-166 (runtime_ops): a one-side proxy secret rotation answers 421 to honest router requests.
  val witness_secretRotationOutage = not(ghost.edgeOutage)
  // SD-107: in Cloud mode a number that deleted everything cannot sign in on the web.
  val witness_cloudSuppressedRefused = not(ghost.cloudRefusedDeleted)

  // ------------------------------------------------------------------ run tests (concrete traces)

  // The six actions of one accepted OtpService.start for request `rid`.
  action otpStartAll(rid: int): bool =
    otpStartBucket(rid).then(otpStartBucket(rid)).then(otpStartBucket(rid)).then(otpStartBucket(rid))
      .then(otpStartSend(rid, true)).then(otpStartPut(rid))

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

  // SD-013: a banned number gets a code and a session (api.ts:462-496 has no ban check;
  // /api/me then answers "review", accounts.ts:307-311).
  run sd013BannedOtpTest =
    initWith("otp")
      .then(textJoin("X")).then(banNumber("X"))
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .expect(not(bannedNoCode))
      .then(otpVerify("alice", "X"))
      .expect(not(bannedNoSession))

  // Cloud mode refuses a banned number at the callback (api.ts:437): no session.
  run cloudBannedRefusedTest =
    initWith("cloud")
      .then(textJoin("X")).then(banNumber("X"))
      .then(cloudLogin("alice", "X", 0))
      .expect(ghost.cloudLogins == 0 and bannedNoSession)

  // SD-054: bob logs in on Y before Y has a person; the carrier gives Y to alice; alice joins by text;
  // bob's old session exports alice's data (accounts.ts:447-463 reads personFor(who.e164)) and its
  // web join lowers alice's age (accounts.ts:357-363).
  run sd054StaleSessionTest =
    initWith("otp")
      .then(otpStartBegin("bob", "Y")).then(otpStartAll(1))
      .then(otpVerify("bob", "Y"))
      .then(carrierReassign("Y", "alice"))
      .then(textJoin("Y"))
      .then(account("bob", "export", 25, "valid"))
      .expect(not(staleSessionNoAct))
      .then(account("bob", "join", 15, "valid"))
      .expect(not(ageOnlyByOwner))

  // SD-491: an under-13 web join is refused, and the session row with the plain number stays
  // (api.ts:555 revokes nothing).
  run sd491Under13Test =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(account("alice", "join", 10, "valid"))
      .expect(world.floor.get("X") == 10 and world.alive == Set() and not(under13NothingStored))

  // An adult web join creates the person, attaches it to the session and passes every invariant.
  run webJoinTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(otpVerify("alice", "X"))
      .then(account("alice", "join", 25, "valid"))
      .expect(world.member == Set(1) and sess.rows.get(1).person == 1 and safety)

  // SD-380: a second start 1 s later is refused by the 30 s gap of the phone bucket, but the IP bucket
  // before it has already counted it (otp.ts:171-178 against otp.ts:4-5).
  run sd380BurnTest =
    initWith("otp")
      .then(otpStartBegin("alice", "X")).then(otpStartAll(1))
      .then(tick(1))
      .then(otpStartBegin("alice", "X")).then(otpStartBucket(2)).then(otpStartBucket(2))
      .expect(otp.buckets.get(("ip", "alice")).n == 2 and otp.inflight.keys() == Set() and not(otpRefusedNotCounted))

  // SD-181 / SD-308: a Cloud clock 5 s ahead of ours makes parseNetworkDelegation refuse the proof
  // (network-delegation.ts:40 via cloud-delegation.ts:22) before the 30 s allowance in api.ts:436.
  run sd181CloudSkewTest =
    initWith("cloud")
      .then(cloudLogin("alice", "X", 5))
      .expect(ghost.cloudLogins == 0 and not(cloudSkewTolerated))

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

  // edge-trust: a forged direct request is never served; a backend-only secret rotation turns honest
  // router requests into 421 until the site deploy (SD-166, runtime_ops).
  run edgeTest =
    initWith("otp")
      .then(edgeRequest("direct", 0))
      .then(edgeRequest("router", 5))
      .expect(not(ghost.edgeOutage) and safety)
      .then(rotateProxySecret("backend"))
      .then(edgeRequest("router", 0))
      .expect(ghost.edgeOutage and safety)
      .then(rotateProxySecret("site"))
      .expect(edge.siteSecret == edge.backendSecret)

  // The macro-step gives the same buckets and challenge as the six single actions.
  run otpStartFastTest =
    initWith("otp")
      .then(otpStartFast("alice", "X", true))
      .expect(otp.challenge.get("X").sentTo == "alice" and otp.buckets.get(("phone", "X")).n == 1
              and otp.buckets.get(("global", "")).n == 1 and safety)
      .then(tick(1))
      .then(otpStartFast("alice", "X", true))
      .expect(otp.buckets.get(("ip", "alice")).n == 2 and otp.buckets.get(("phone", "X")).n == 1 and not(otpRefusedNotCounted))
}
