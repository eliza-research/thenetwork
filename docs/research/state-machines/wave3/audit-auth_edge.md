# Audit: coverage of quint/auth_edge.qnt (wave 3)

Hand-written. Read-only research; no file in the repository was changed.

Inputs: quint/auth_edge.qnt (this branch, claude/quint-state-machines), docs/research/quint-findings/auth_edge.md,
section 6.10 of docs/research/2026-11-07-state-machines.md, the drift review on claude/formal-main
(docs/results/2026-11-09-quint-drift.md, quint/drift.json: auth_edge has no open drift item there) and the
formal-main version of the model. Code read in full on claude/formal-main (the newer code, with the rotation
fix): packages/platform/src/{api,otp,sessions,accounts,pg-store (sessions, OTP, hitAll, deleteAll, movePhone),
cloud-delegation,proxy,decisions}.ts, packages/core/src/svc/{svc-auth,network-delegation,proof-window}.ts,
deploy/router.ts, deploy/backend/backend.ts (loadConfig, normalizeEdge, the api/mcp routes), the svc query
refusals in packages/network/service. Line numbers below are formal-main ("fm:") unless they say HEAD. The
HEAD code of this branch has the same defects below unless noted.

Not repeated (already fixed): SD-013, SD-054 (bindSessions), SD-181, SD-380, SD-491 (open-app path), the
rotation race (PeopleStore.rotateSession, formal-main), the under-13 invite_only membership exit
(declineUnderAge, formal-main), and the formal-main model drift fixes (APP_MIN_AGE 13, banned start counts,
export refuses a banned number, PLATFORM_PROXY_SECRET_PREVIOUS, rotation guard). This branch must take the
formal-main model; the HEAD model here is stale.

## Probes (scratch copy, not committed)

/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/wave3/probe/auth_edge_probe.qnt
adds three actions and three run tests to a copy of the HEAD model. `quint test --match probe`: 3 passing.

- probeNumberChangeTest: bob OTP login on Y (no person) -> alice textJoin X -> carrierReassign(Y, alice) ->
  numberChange(X, Y) (movePhone semantics) -> account(bob, export): staleSessionNoAct is violated.
- probeInflightJoinTest: bob OTP login on Y -> carrierReassign(Y, alice) -> accountBegin(bob) (auth done) ->
  textJoin(Y) (bob's session revoked) -> accountJoinAfterAuth(bob, 1, 15): ageOnlyByOwner is violated.
- probeEarlierHolderJoinTest: bob OTP login on Y -> carrierReassign(Y, alice) -> account(bob, join, 25): bob
  creates the person and the SMS opt-in on alice's number, and `safety` still holds (the carve-out).

## Suspected defects (new)

### D1 (P1). A member number change gives the new number's person-less sessions the person (SD-054 bypass)
Where: fm accounts.ts:252-277 (confirmNumberChange), fm pg-store.ts:423-470 (movePhone; only line 450 deletes
sessions, and only of the OLD number), fm accounts.ts:476-520 and api.ts:584-591, 636-648 (export, stop, leave,
delete use personFor(who.e164), never who.personId).
Trigger: (1) bob holds B, logs in by OTP on slop.date: session (B, person null). He never joins. (2) He gives
up B and keeps the cookie alive (one request per 30 days rotates it; chain cap 90 days). (3) After 45+ days the
carrier gives B to alice, a member on A. (4) alice changes her number to B (/api/me/phone/start + confirm;
findPhone(B) is empty, so it passes). (5) bob's session: GET /api/me/export returns alice's slop membership,
profile, consent history and onExport network data; POST /api/me/stop stops her messages on every app;
POST /api/join with age 10 declines her on every app (declineUnderAge) and fixes her age floor at 10.
Fix: in movePhone, in the same transaction, revoke (or delete) `platform.sessions where e164 = newE164 and
person_id is null` (the bindSessions rule with keep = null). Integration case in
packages/platform/test/auth-edge.integration.test.ts (fails before). Model: add `numberChange` to auth_edge
(probe action above).

### D2 (P1). A request authenticated before a join commits acts for the person that join made (TOCTOU)
Where: fm api.ts:390-393 (withSession: auth once), fm accounts.ts:355-391 (join waits on withLock
`join:<e164>`, then reads personFor and never re-checks the session or who.personId), service.ts:1320 (the text
join holds the same lock).
Trigger: bob's person-less session on Y (as D1, steps 1-3, Y now alice's). bob posts POST /api/join (slop,
age 15, valid consent) in a loop. One request passes auth() while alice's text join holds the lock; it waits,
then runs joinLocked: personFor(Y) = alice's new person, member = true, step "existing" -> recordAge lowers her
age to 15 (minor: never matched again); with age 10 -> "under_age" -> declineUnderAge removes every membership.
If alice joined another app, step "join" makes a slop membership for her with bob's name and an SMS opt-in.
The lock makes the window the whole text join, not a few queries. Export, leave and stop have the same window
(no lock, shorter).
Fix (smallest): inside joinLocked (and in exportApp, leave, stop, share, deleteAll), refuse when
`who.personId === null && person !== undefined && person was not created by this call`, or re-read the session
row by who.session inside the lock and refuse when it is not live. Better (fixes D1, D2 and D3 at once): see D3.
Model: split `account` into accountBegin and the effect (probe).

### D3 (P2). An earlier holder's session can create a person and opt in a number it no longer holds
Where: fm accounts.ts:394-409 (join creates the person and the consent row for who.e164), sessions.ts:53-62
(person-less sessions rotate like any other, chain 90 days > 45-day carrier aging).
Trigger: probeEarlierHolderJoinTest. bob logged in on Y, gave Y up; 45+ days later Y is alice's; bob (by
mistake or not) submits the join form: a person on Y, a slop membership and an SMS opt-in are stored; the
welcome and later messages go to alice, who never opted in.
Fix: a person-less session does not rotate past SESSION_TTL (cap the chain of a session with person null at
30 days, below the 45-day aging), or require a login younger than N days to create a person. With the cap, no
person-less session of an earlier holder is live when a number is reassigned, so D1 and D2 have no actor.
Cloud sessions are not affected (proof life <= 1 h).

### D4 (P1, formal-main only). Under-13 on the invite_only or consent_wording exit keeps the session row
Where: fm accounts.ts:372-376 (recordAge + declineUnderAge on every non-join exit), 382 (forgetPersonlessSessions
only on step "under_age"), fm api.ts:560 (cookies cleared only for error "under_age"); fm decisions.ts:134-146
(joinPlan returns "consent_wording" or "invite_only" before it checks the age).
Trigger: OTP login on ntwrk.party (invite app) with a number that has no person -> POST /api/join age 10 ->
"invite_only": the age floor is stored, the session row keeps the plain number for up to 30 days and the
cookie stays. Same with a wrong consent wording on any app. This is SD-491 again on the exits that the
formal-main fix started to record ages on. HEAD returns before any write on these exits, so HEAD is not affected.
Fix: run forgetPersonlessSessions (and clear the cookies) whenever plan.recordAge and the lowest age < 13 and
there is no person, not only on "under_age". Model: add an invite app and a consent-wording flag (gap G3).

### D5 (P2, availability). A join with a grace-period cookie logs the person out
Where: fm sessions.ts:53 (a token in its grace time is used as is), fm accounts.ts:388, 409 (bindSessions keeps
who.session), fm pg-store.ts:265-269 (every other person-less row of the number is revoked now).
Trigger: day-old cookie T1. The page sends GET /api/me (rotates: T2, cookie set) and POST /api/join with T1 at
the same time. The join binds T1 (grace ends in 60 s) and revokes T2, the cookie the browser keeps: the next
request is 401 right after a successful join. The SD-180 fork (two heads) gives the same result.
Fix: bindSessions keeps every row of who.session's rotation chain (rotated_from) or the newest head of it.

## Model gaps

- G1 (P1) Number change (PRD F25) is not modelled: startNumberChange/confirmNumberChange/movePhone, the
  staff move. Adding it breaks staleSessionNoAct today (D1). Add `numberChange(pOld, pNew)` as in the probe;
  later also the confirm race with an OTP login on pNew (harmless: only the holder of pNew can log in).
- G2 (P1) Every account action is one step from auth() to the effect (HEAD model 473-563). The code has awaits
  and a lock wait between them (D2). Split into begin/effect; the ghost `foreign` then catches D2.
- G3 (P1) One open app with a correct consent wording only: the invite_only and consent_wording exits
  (joinPlan) and the "existing" step with a lower age are unreachable, so under13NothingStored cannot see D4.
  textJoin is always an adult: the text under-13 path (service.ts statedAge, declineUnderAge) never writes
  under13At, and it also leaves earlier person-less web sessions of the number (a web login, then an under-13
  text) in place. Decide whether the rule covers that; if yes, it is a second D4 trigger.
- G4 (P2) The account ops stop (api.ts:589-591, an opt-out for the whole number), share/revokeShare, home,
  resume and GET /api/me (it returns membership.firstName) are not in `op`. With G1/G2 they are foreign acts too;
  `stop` is the worst (consent of another person). home/me check `who.personId === null || ...` (api.ts:515, 533),
  so they also accept a person-less session.
- G5 (P2) Requests carry a cookie value, not the jar head: old tokens in their 60 s grace, logout
  (api.ts:501-506) and the cookie a browser ends with after a fork are not modelled (D5).
- G6 (P2) The 12-month hold: seen() puts a number on hold at login (accounts.ts:182-190), verify then makes a
  person-null session, export/delete refuse held numbers, clearHold same_owner/new_owner. clearHold same_owner
  does not bind or revoke the person-null sessions made during the hold; they get the person when the hold
  ends. Expected not to break an invariant (only the holder could log in during the hold).
- G7 (P2) banNumber needs a person (HEAD model 607-614). Staff can ban a number with no person
  (bans.phone_hash, banUnfinished); OTP and verify check by hash, so no invariant should break; add it so the
  ban/OTP interleavings are covered for person-less numbers.
- G8 (P2) Multi-app: challenges are per (app, number) (pg-store latestChallenge), sessions are per app
  (sessionLive), bindSessions and forgetPersonlessSessions span apps. One app hides a join on one site that
  revokes the person-less session of the same human on another site (harmless, a re-login).
- G9 (P2) The verify rate limits (otp.ts:206-208) and the Twilio check await inside verify. consumeChallenge
  is guarded (consumed_at is null), so two right codes in parallel give one session; no invariant at risk.
- G10 (P2) Cloud: the non-production 60 s validation cache (api.ts:275) and the staging-local per-app mode
  (cloudFor(app) only for one app, api.ts:193): oneAuthMode is global and unavailableNoAccess assumes no cache.
  Dev/staging only; state it in the header.
- G11 (P2) cloudGrantAuthority / validateCloudGrant (api.ts:668-697) are not modelled (the findings file says
  so). validateCloudGrant accepts grant.personId === null whatever the number's owner (line 693): the same
  person-less pattern as SD-054 on MCP grants. Hand to oauth_mcp.

## Model errors

- E1 (P1) cloudLogin requires world.holder(p) == h (HEAD model 442): Cloud's phone proof is the Cloud
  account's verified phone, verified at some earlier time (docs/results/2026-10-18-production-cloud-network-
  handoff.md: "matching verified phone projection"), not a code sent now. A stale Cloud phone on a recycled
  number signs in as the new holder's person. This assumption is not in the header's abstractions. Either
  confirm upstream that Cloud re-verifies the phone within the 45-day aging and state it, or let cloudLogin
  run for an earlier holder (bounded by Cloud's re-verify window) and see staleSessionNoAct.
- E2 (P2) otpVerify and cloudLogin are one action each "because their awaits change nothing an invariant
  reads" (HEAD model 28-29, 347-350). Not true for bannedNoSession: a ban that commits between api.ts:488 (ban
  check) and :494 (sessions.create) gives a session for a banned number (cloud: 439 vs 444). Harmless in the
  code (/me, export and join refuse a banned number), but the invariant is stronger than what the code does.
  Restate bannedNoSession like bannedNoCode (login began after the ban) and split the actions.
- E3 (P2) staleSessionNoAct allows the chain whose own web join created the person (HEAD model 483) even when
  that chain belongs to an earlier holder of the number (probeEarlierHolderJoinTest passes with safety). The
  rule should be about the holder: add a ghost `holderAtLogin` and require it to equal the current holder for
  a join that creates a person or an opt-in (D3).
- E4 (P2) under13NothingStored is reachable only through the web join of an open app (G3), so for the text path
  and the other exits it is vacuous.
- E5 (P2) The HEAD model is stale against the code (the drift fixes are on formal-main only); quint:check on
  HEAD passes against code it no longer matches. Merge the formal-main model first.

## Open carve-outs

- C1 (fix now) formal-main model, under-age branch of account (fm model ~558): the `ageLoweredByOther or lowered`
  write was removed while the rotation race was open. The race is fixed (rotateSession + the rotateCommit guard),
  so restore the write; with G2/D2 not yet fixed, keep the begin/effect split out of the step until D2 lands.
- C2 SD-107 (skipped, founder decision): Cloud mode refuses a suppressed number at the callback (api.ts:439).
  After the 2026-10-19 correction there is no web rejoin, but the agent signup's phone-confirm link may be the
  Cloud sign-in: then a number that deleted everything can rejoin only by text. Ask the founder; keep the
  witness. Not fixable without that decision.
- C3 SD-308, other proof parsers (not reachable here): fm proof-window.ts:7-11 proofWindowOk still refuses
  issuedAt > now with no skew, for the Cloud-issued profile-review owner/disconnect/withdrawal and
  learning-consent proofs. In scope to fix the same way as SD-181 (a skew argument, 30 s, for issuedAt only)
  with an integration case per endpoint; the model for it is profile_learning (or a small proof-window module).
- C4 SD-180 (accepted harmless): true for safety, but see D5 for the availability effect.
- C5 SD-013 remainder (late ban during a start): accepted; consistent with E2 once bannedNoSession is restated.
- C6 SD-382 (refuted) and the inner verifyProxyHeaders at the 60 s edge: normalizeEdge (backend.ts) and
  api.ts:307 verify at two times; a request that passes the first and fails the second falls back to the socket
  IP (one shared rate bucket). Same class as SD-382; no model change.
- C7 The carrier-aging assumption (45 days) is what keeps the old holder's OTP code out; it does not hold for
  numbers some VoIP providers recycle without aging. D3's fix makes the session side independent of it only if
  the person-less chain cap is shorter than the shortest real aging; state the assumption next to the cap.
- No invariant is outside `safety` (no knownOpen) and no defect of the module is "not reproduced".
