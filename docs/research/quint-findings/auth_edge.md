# Quint findings: `quint/auth_edge.qnt`

Model: [quint/auth_edge.qnt](../../../quint/auth_edge.qnt). Module plan: [state-machine report, section 6.10](../2026-11-07-state-machines.md).
Code base: branch `wave2/auth_edge` (ad67275 with the fix commits 6225b02, 6ddfc8f, c7515cc, d68fdd2 and b56267f, and the
test change d66970d). The model follows that code. Sections 3 and 4 also keep the traces that the model found at ad67275.
This file is hand-written. The traces come from the Quint simulator (seed `0x5eed`) and from the `run` tests in the model.

## 1. What the model covers

| Machine | Model actions | Code |
|---|---|---|
| otp-challenge (M-057) | `otpStartBegin` (with the ban check), `otpStartLimits` (the four rate buckets in one transaction), `otpStartSend`, `otpStartPut`, `otpStartCrash`, `otpStartFast` (a macro-step of the same actions), `otpVerify` | api.ts:462-496, otp.ts:166-214, pg-store.ts:195-258 |
| web-session (M-058) | `otpVerify` (create), `rotateRead` / `rotateCommit`, `purge`, `account` (revoke on "invalid") | sessions.ts:34-64, pg-store.ts:214-227, 281-292 |
| cloud-handoff (M-059) | `cloudLogin` | api.ts:411-452, cloud-delegation.ts:19-25, network-delegation.ts:32-43 |
| cloud-session-validation (M-060) | `account` (status), `cloudSignOut` | api.ts:263-299, 313-321; cloud-delegation.ts:26-37 |
| proxy-signature, edge-trust (M-061, M-062) | `edgeRequest` | proxy.ts:56-82, deploy/router.ts:88-127, deploy/backend/backend.ts:236-255, 350-363 |
| svc-auth (M-063) | `svcSend`, `svcTamper`, `svcDeliver` | svc-auth.ts:58-115; service.ts:1975-1986; relay-endpoint.ts:141-147 |
| auth-mode-config (M-129) | `mode`, chosen once in `init` | api.ts:152-193 |
| public-api-gates (M-130) | the guards inside `otpStartBegin`, `otpVerify`, `cloudLogin`, `account` | api.ts:399-639 |
| proxy-secret-rotation (M-131) | `rotateProxySecret` | backend.ts:90-97, router.ts:93-94 |
| other actors | `textJoin` (creates the person with `accounts.createPerson`), `carrierReassign` (number recycling), `banNumber`, `tick` | accounts.ts:304-308, 353-405, service.ts:1437, 1734-1760 |

Bounds: two phones (X, Y), two humans (alice, bob), one app (slop, 18+), at most two OTP starts and three signed service
requests in flight. The global OTP budget is 2 an hour in the model (500 in the code), so that the global refusal is reachable.

Abstractions and assumptions:
- HMAC, the OTP code, Turnstile and the Cloud answer are oracles. A human knows a code only when the provider sent it to the
  number that this human holds at send time.
- The verify route and the Cloud callback are one action each. Their internal awaits write nothing that an invariant reads.
- Assumption (upstream): the Worker-to-backend and gateway-to-backend hops are TLS, so an attacker cannot capture or change a
  signed request. The attacker can send any request directly.
- Assumption: each signed service endpoint records the id and its effect in one transaction (the durable inbox is in
  `quint/turn_consent.qnt`).
- Assumption (carrier aging, new in this version): a carrier gives a disconnected number to another human only after at
  least 45 days (47 CFR 52.15(f)(1)(ii)). So `carrierReassign` needs that no OTP code (10 minutes) of the number is live.
  Without it the simulator found a trace that is not possible in practice: alice gets a code for X, the carrier gives X
  to bob in the same second, bob joins by text, and alice enters her old code. Web sessions (30 days, 90 with rotation)
  can outlive the aging, so SD-054 stays in scope.
- The 12-month hold (accounts.ts:176-184) and the `unknown` signed IP (SD-382) are not modelled.

## 2. Check results (final state)

`bun run quint:check quint/auth_edge.qnt` (max-steps 24, max-samples 20000, seed 0x5eed):

```
ok   typecheck
ok   test                                   (18 run tests)
ok   safety                                 (all 14 invariants)
ok   witness_otpLogin, witness_cloudLogin, witness_rotation, witness_rotationFork, witness_signedTurnSkew,
     witness_secretRotationOutage, witness_cloudSuppressedRefused, witness_lateBanCode (all reachable)
```

max-samples went from 6000 to 20000: with the shorter OTP start (four actions in place of six) the random walk reached
`witness_rotationFork` only from about 12000 samples. One full check takes about 22 s.

`bun run quint:check --verify quint/auth_edge.qnt` (Apalache, `verify-steps=4`): `ok verify safety`, no counterexample
(about 4 to 5 minutes). A direct run at `--max-steps 5` on a private Apalache server also found no counterexample
(2620 s). The header keeps 4 steps because 5 steps take about 44 minutes. At ad67275, `safety` had a counterexample at 6 steps.
Two runs at 5 and 6 steps on servers that other sessions restarted stopped with "Connection dropped" (no result).
The first 5-step run with the old statement of `staleSessionNoAct` found a counterexample. Section 2 explains why
that statement was wrong and gives the new one.

| Invariant | Rule | At ad67275 | Now | Register id |
|---|---|---|---|---|
| `bannedNoCode` | AGENTS.md founder decision 2026-10-09 item 3 (bans by phone number, refused at OTP) | violated | holds | SD-013 |
| `bannedNoSession` | the same rule | violated (OTP mode) | holds | SD-013 |
| `staleSessionNoAct` | accounts.ts:9-10, 446 (own data only) | violated | holds | SD-054 |
| `ageOnlyByOwner` | AGENTS.md age policy (a person's age comes from that person's statements) | violated | holds | SD-054 |
| `under13NothingStored` | AGENTS.md age policy ("under 13 ... nothing stored"), accounts.ts:7 | violated | holds | SD-491 |
| `otpRefusedNotCounted` | otp.ts:4-5 | violated | holds | SD-380 |
| `cloudSkewTolerated` | api.ts:100-101, 436 | violated | holds | SD-181 (case of SD-308) |
| `chainBounded` | sessions.ts:6, 14-15 | holds | holds | - |
| `unavailableNoAccess` | api.ts:263-264, 293 | holds | holds | - |
| `edgeHeaderSigned` | proxy.ts:1-14, backend.ts:91-96 | holds | holds | - |
| `effectAtMostOnce` | svc-auth.ts:10-11 | holds | holds | - |
| `staleSvcRefused` | svc-auth.ts:10 | holds | holds | - |
| `queryNotSigned` | svc-auth.ts:57 | holds | holds | - |
| `oneAuthMode` | api.ts:152-193, 403, 412, 463, 481 | holds | holds | - |

All 14 are in `safety`. The `holding` value (the seven that held at ad67275) is removed: `safety` now holds as a whole.

Changes to the statement of two invariants (both in the model comments):
- `bannedNoCode` is about a code request that began after the ban committed. A ban that commits while a request is
  between the route's ban check (api.ts:472) and `provider.send` is concurrent with that request, so the code can still
  go out. `witness_lateBanCode` shows that this is reachable, and `run sd013LateBanTest` shows that verify then refuses
  the code (api.ts:487): `bannedNoSession` holds.
- `staleSessionNoAct` (and the `foreign` test that `ageOnlyByOwner` uses) is now the SD-054 rule itself: a login chain
  that began before a person existed never acts for that person, except the chain whose web join created it. Before, it
  said "a human acts only on a person that this human created". Apalache found (5 steps, Cloud mode) a trace that broke
  the old statement with no stale session: alice signs in on X, the carrier gives X to bob, alice's live session joins
  (the person is created), and bob then signs in on X and gets that person. That is the recycled-number policy
  (accounts.ts:170-184: for 12 months a number's person is the person of whoever signs in with it), which the model
  already scopes out (`carrierReassign` needs a number with no person). A mutation check shows that the new statement
  still catches SD-054: with `bindSessions` changed back to the ad67275 behaviour (attach every person-less session, and
  nothing on a text join), the simulator violates `staleSessionNoAct` and `ageOnlyByOwner` at once.
- `under13NothingStored` is about a number with no person (the rule "nothing stored" is about a join that stores
  nothing; a number with a person has its data already, and the fix keeps those sessions on purpose). "From before the
  refusal" is now a lower session id, not a creation time that is not later: a new login in the same second after the
  refusal is not from before it.

## 3. Defects: fixed

### SD-013: a banned number got a code and a session (OTP mode). Fixed in 6225b02.

Trace at ad67275 (simulator trace for `bannedNoSession`):

```
init(mode=otp) -> textJoin(X) -> banNumber(X)
-> otpStart(alice, X): code to X                    bannedNoCode violated
-> otpVerify(alice, X): session row for X           bannedNoSession violated
```

Fix: api.ts:472 answers `{ ok: true }` and sends no code to a banned number; api.ts:487 answers 400 `invalid_code`
after `otp.verify` has used the code, also for a code sent before the ban. Model: `otpStartBegin` ends the request for a
banned number, `otpStartFast` does nothing for one, and `otpVerify` uses the code and makes no session.
Run tests: `sd013BannedOtpTest` (a code sent before the ban gives no session; a new start sends nothing),
`sd013LateBanTest` (a ban during an in-flight start). Integration test: `packages/platform/test/auth-edge.integration.test.ts`
"SD-013 a banned number gets no code and no session from web OTP"; d66970d changes `service-safety.test.ts` to match.

### SD-054: a session from an earlier holder of the number acted for the new holder. Fixed in 6ddfc8f.

Trace at ad67275:

```
init(mode=otp) -> bob: otpStart(Y) + otpVerify(Y)   session (Y, person null), held by bob
-> carrierReassign(Y, alice) -> textJoin(Y)         person 1 = alice
-> account(bob, export)                             staleSessionNoAct violated
-> account(bob, join, age 15)                       ageOnlyByOwner violated
```

Fix: `Accounts.createPerson` (accounts.ts:304-308, also used by the text join at service.ts:1437) and the web join
(accounts.ts:395) call `bindSessions`: of the person-less sessions of the number, only the joining request's session
(`who.session`, api.ts:391) gets the person; every other one is revoked at once. Model: `bindSessions` in `textJoin`
and in the adult branch of the web join. Run tests: `sd054StaleSessionTest` (the text join revokes bob's session, so
neither action is enabled), `sd054WebJoinTest` (alice's web join keeps her session and revokes bob's). Integration
tests: "SD-054 a session from before a text join does not act for the person the join made" and "SD-054 a web join binds
only the joining session, not an earlier holder's session".

### SD-491: an under-13 web join kept the session with the plain number. Fixed in b56267f.

Trace at ad67275: `otpStart(X) + otpVerify(X) -> account(alice, join, 10)`: under_age, the session row stays
(`under13NothingStored` violated).

Fix: on an under-age refusal for a number with no person, `forgetPersonlessSessions` (accounts.ts:378, pg-store.ts:231)
deletes the person-less sessions of the number, and api.ts:557-561 clears the session and identity cookies. Model: the
under-age branch of the web join drops those rows and clears the human's cookie. Run test: `sd491Under13Test` (two
logins, then an under-13 join: no row, no cookie, only the age floor). Integration test: "SD-491 an under-13 web join
keeps no session with the number".

### SD-380: a refused OTP start still counted in the buckets before the refusing one. Fixed in d68fdd2.

Trace at ad67275: `otpStart(alice, X) -> tick(1) -> otpStart(alice, X)`: the IP bucket counted the request, then the
phone bucket refused it by the 30 s gap (`otpRefusedNotCounted` violated).

Fix: `store.hitAll` (store.ts, pg-store.ts:238-258) checks the four buckets in order in one transaction and counts the
hit in all of them or in none. Model: `otpStartLimits` (one action) and `startBuckets`. Run tests: `sd380BurnTest` (gap
refusal), `sd380GlobalTest` (global refusal: the IP, hour and day buckets of the third number stay unchanged),
`otpStartFastTest`. Integration test: "SD-380 a code request refused by a later limit is not counted in the earlier
limits".

### SD-181 (one case of SD-308): the 30 s Cloud clock skew allowance was dead code in production. Fixed in c7515cc.

Trace at ad67275: `init(mode=cloud) -> cloudLogin(alice, X, skew=+5 s)`: `parseNetworkDelegation` refused the proof
with no skew allowance (`cloudSkewTolerated` violated).

Fix: `parseNetworkDelegation` takes `skewMs` (network-delegation.ts:33, 41), and `productionCloudDelegation` passes
`CLOUD_CLOCK_SKEW_MS` on exchange and validate (cloud-delegation.ts); `validateCloudGrant` (api.ts:681) has the same
allowance. `network-delegation.ts` is not part of the wire mirror (contract.ts, svc-auth.ts). Model: `parsedOk` in
`cloudLogin`. Run test: `sd181CloudSkewTest` (5 s ahead signs in and the session starts at our clock; 45 s ahead is
still refused). Integration test: "SD-181 a Cloud clock 5 s ahead still signs in on the production delegation path".
The model does not cover `validateCloudGrant` (the Cloud answer in `account` is an oracle).

## 4. Defects: not reproduced

None.

## 5. Defects: skipped

- **SD-107** (`witness_cloudSuppressedRefused`, `run sd107CloudSuppressedTest`). Needs a founder decision. In Cloud mode a
  number that deleted everything gets 403 at the callback (api.ts:437), so the web join that would lift the suppression
  cannot run. A text join lifts it, and the next Cloud sign-in works. The founder correction of 2026-10-19 (no website
  account portal; sign-up is in the agent or by text) removes the web rejoin requirement. No safety invariant is broken.
  Letting a suppressed number sign in to Cloud would change the deletion and suppression policy.
- **SD-308**, the other parsers. Partly fixed in c7515cc together with SD-181 (same root cause): the login delegation
  parser (exchange and validate) and `validateCloudGrant`. The other four proof parsers (profile-review owner, source,
  disconnect and withdrawal, learning-consent-context in `packages/core/src/svc`, used by `packages/network/service`)
  belong to other modules, and the disputed vote could not show that they fail in production. This model does not
  reach them.

## 6. Behaviour that the model reaches, but that is not a defect here

- **SD-013 remainder** (`witness_lateBanCode`, `run sd013LateBanTest`). A ban that commits while a code request is in
  flight does not stop that code. The ban and the request are concurrent; verify refuses the code, so no session.
- **SD-180** (`witness_rotationFork`, `run rotationForkTest`). Two requests that read the same day-old cookie both rotate it:
  two live heads in one chain (sessions.ts:49-56 has no compare-and-set). `chainBounded` still holds (both heads keep the
  login's `startedAt`, so the 90-day cap applies). The register refutes it as harmless, and the model agrees.
- **SD-166** (`witness_secretRotationOutage`, `run edgeTest`, runtime_ops module). The backend takes one
  `PLATFORM_PROXY_SECRET`; a deploy on one side answers 421 to honest router requests until the other side deploys. It fails
  closed: `edgeHeaderSigned` holds.

## 7. Register defects of this module that the model cannot reach

- **SD-308**, other parsers: see section 5.
- **SD-382** (refuted): the `unknown` signed IP needs the IP pattern in normalizeEdge (backend.ts:247). The model has no IP
  values, because the rate buckets use the human as the IP.

## 8. New findings

None. The trace that led to the carrier aging assumption (section 1) is not possible with real carriers.
