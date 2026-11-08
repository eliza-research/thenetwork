# Quint findings: `quint/auth_edge.qnt`

Model: [quint/auth_edge.qnt](../../../quint/auth_edge.qnt). Module plan: [state-machine report, section 6.10](../2026-11-07-state-machines.md).
Code base: commit ad67275. The model follows the code as it is now. It does not show the code as it should be.
This file is hand-written. The traces come from the Quint simulator (seed `0x5eed`) and from the `run` tests in the model.

## 1. What the model covers

| Machine | Model actions | Code |
|---|---|---|
| otp-challenge (M-057) | `otpStartBegin`, `otpStartBucket` (one action for each rate bucket), `otpStartSend`, `otpStartPut`, `otpStartCrash`, `otpStartFast` (a macro-step of the same six actions), `otpVerify` | api.ts:462-496, otp.ts:166-212, pg-store.ts:195-243 |
| web-session (M-058) | `otpVerify` (create), `rotateRead` / `rotateCommit`, `purge`, `account` (revoke on "invalid") | sessions.ts:34-64, pg-store.ts:214-227, 281-292 |
| cloud-handoff (M-059) | `cloudLogin` | api.ts:411-452, cloud-delegation.ts:19-25, network-delegation.ts:32-43 |
| cloud-session-validation (M-060) | `account` (status), `cloudSignOut` | api.ts:263-299, 313-321; cloud-delegation.ts:26-37 |
| proxy-signature, edge-trust (M-061, M-062) | `edgeRequest` | proxy.ts:56-82, deploy/router.ts:88-127, deploy/backend/backend.ts:236-255, 350-363 |
| svc-auth (M-063) | `svcSend`, `svcTamper`, `svcDeliver` | svc-auth.ts:58-115; service.ts:1975-1986; relay-endpoint.ts:141-147 |
| auth-mode-config (M-129) | `mode`, chosen once in `init` | api.ts:152-193 |
| public-api-gates (M-130) | the guards inside `otpStartBegin`, `otpVerify`, `cloudLogin`, `account` | api.ts:399-639 |
| proxy-secret-rotation (M-131) | `rotateProxySecret` | backend.ts:90-97, router.ts:93-94 |
| other actors | `textJoin`, `carrierReassign` (number recycling), `banNumber`, `tick` | accounts.ts:345-395, service.ts:1734-1760 |

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
- The 12-month hold (accounts.ts:176-184) and the `unknown` signed IP (SD-382) are not modelled.

## 2. Check results

`bun run quint:check quint/auth_edge.qnt` (max-steps 24, max-samples 6000, seed 0x5eed):

```
ok   typecheck
ok   test                                   (15 run tests)
FAIL safety                                 (expected: the model shows the defects below)
ok   witness_otpLogin, witness_cloudLogin, witness_rotation, witness_rotationFork,
     witness_signedTurnSkew, witness_secretRotationOutage, witness_cloudSuppressedRefused (all reachable)
```

Each invariant alone (`quint run … --max-steps 24 --max-samples 20000`):

| Invariant | Rule | Result | Register id |
|---|---|---|---|
| `bannedNoCode` | AGENTS.md founder decision 2026-10-09 item 3 (bans by phone number, refused at OTP) | violated | SD-013 |
| `bannedNoSession` | the same rule | violated (OTP mode) | SD-013 |
| `staleSessionNoAct` | accounts.ts:9-10, 446 (own data only) | violated | SD-054 |
| `ageOnlyByOwner` | AGENTS.md age policy (a person's age comes from that person's statements) | violated | SD-054 |
| `under13NothingStored` | AGENTS.md age policy ("under 13 … nothing stored"), accounts.ts:7 | violated | SD-491 |
| `otpRefusedNotCounted` | otp.ts:4-5 | violated | SD-380 |
| `cloudSkewTolerated` | api.ts:100-101, 441 | violated | SD-181 (case of SD-308) |
| `chainBounded` | sessions.ts:6, 14-15 | holds | - |
| `unavailableNoAccess` | api.ts:263-264, 293 | holds | - |
| `edgeHeaderSigned` | proxy.ts:1-14, backend.ts:91-96 | holds | - |
| `effectAtMostOnce` | svc-auth.ts:10-11 | holds | - |
| `staleSvcRefused` | svc-auth.ts:10 | holds | - |
| `queryNotSigned` | svc-auth.ts:57 | holds | - |
| `oneAuthMode` | api.ts:152-193, 403, 412, 463, 480 | holds | - |

Apalache (`quint verify`, Apalache 0.62.4): `safety` gives a counterexample at `--max-steps 6` (22 s).
`holding` (the conjunction of the seven invariants that hold) has no counterexample at `--max-steps 5` (8 min, private
server port). A longer bound was not run: the shared Apalache server on port 8822 was restarted by other sessions.

## 3. Defects that the model reproduces

### SD-013: a banned number gets a code and a session (OTP mode)

Trace (`run sd013BannedOtpTest`, and the simulator trace for `bannedNoSession`):

```
init(mode=otp) -> textJoin(X)            alice is person 1 on X
-> banNumber(X)                          bans + suppression (service.ts:1748-1751)
-> otpStartBegin(alice, X) -> 4 buckets  no ban check
-> otpStartSend(delivered)               SMS goes to X              bannedNoCode violated
-> otpStartPut -> otpVerify(alice, X)    session row for X          bannedNoSession violated
```

Code: api.ts:462-477 calls `otp.start` with no `accounts.banned` check; api.ts:479-492 creates the session with no ban
check. The Cloud callback does refuse (api.ts:437), which `run cloudBannedRefusedTest` confirms.

### SD-054: a session from an earlier holder of the number acts for the new holder

Trace (`run sd054StaleSessionTest`):

```
init(mode=otp) -> bob: otpStart(Y) + otpVerify(Y)   session (Y, person null), held by bob
-> carrierReassign(Y, alice)                        Y has no person, so no hold
-> textJoin(Y)                                      person 1 = alice; attachPerson is web only
-> account(bob, export)                             exportApp reads personFor(Y) = alice    staleSessionNoAct violated
-> account(bob, join, age 15)                       repeated-join branch records age 15 on alice's person
                                                                                            ageOnlyByOwner violated
```

Code: api.ts:391 builds `who = {e164, personId}`; accounts.ts:447-463 (`exportApp`), 421-429 (`leave`) and 357-363 (the
repeated-join age statement) use `personFor(who.e164)` and never compare `who.personId`. Session rows with a null person
are only filled by a web join (accounts.ts:385, pg-store.ts:225-227). The session lives 30 days and its rotation chain
90 days (sessions.ts:12-15). The age consequence is new detail on the same defect: the old holder can lower the new
holder's lowest age (to a minor age on another app, which makes the new holder unmatched everywhere).

### SD-491: an under-13 web join keeps the session with the plain number

Trace (`run sd491Under13Test`):

```
init(mode=otp) -> alice: otpStart(X) + otpVerify(X)   session (X, null), e164 in plain text
-> account(alice, join, age 10)                       under_age; age floor 10 is the only join write
                                                      the session row stays     under13NothingStored violated
```

Code: accounts.ts:365-370 writes only the floor; api.ts:555 answers `under_age` and revokes nothing. The row keeps
`platform.sessions.e164` until `purge` after expiry (pg-store.ts:285).

### SD-380: a refused OTP start still counts in the buckets before the refusing one

Trace (`run sd380BurnTest`, `run otpStartFastTest`; the simulator finds it in 3 steps):

```
init(mode=otp) -> otpStart(alice, X) accepted        ip=1, phone=1, day=1, global=1
-> tick(1) -> otpStartBegin(alice, X)
-> bucket ip: ok (ip=2) -> bucket phone: refused by the 30 s gap     otpRefusedNotCounted violated
```

Code: otp.ts:171-184 commits each `store.hit` in its own transaction (pg-store.ts:229-243), against the rule in
otp.ts:4-5. The same holds for a day-limit refusal (hour bucket counted, `last_at` moved) and for a global refusal (ip,
phone and day counted).

### SD-181 (one case of SD-308): the 30 s Cloud clock skew allowance is dead code in production

Trace (`run sd181CloudSkewTest`; the simulator finds it in 3 steps):

```
init(mode=cloud) -> cloudLogin(alice, X, skew=+5 s)
   parseNetworkDelegation refuses issuedAt*1000 > now (network-delegation.ts:40), called by
   productionCloudDelegation.exchange with o.now() (cloud-delegation.ts:22)
   -> reject(403) before api.ts:436 can apply CLOUD_CLOCK_SKEW_MS           cloudSkewTolerated violated
```

The same zero-skew test is in `validateCloudGrant` (api.ts:674: `authority.issuedAt*1000>now`). The model covers the login
parser only. The other proof parsers that SD-308 names belong to other modules.

## 4. Behaviour that the model reaches, but that is not a defect here

- **SD-107** (`witness_cloudSuppressedRefused`, `run sd107CloudSuppressedTest`). In Cloud mode a number that deleted
  everything gets 403 at the callback (api.ts:437), so the web join that would lift the suppression cannot run. A text join
  lifts it, and the next Cloud sign-in works. The founder correction of 2026-10-19 (no website account portal; sign-up is in
  the agent or by text) removes the web rejoin requirement, and deploy/router.ts:40-48 already retires `/join` on three sites.
  No safety invariant is broken. A fix needs a founder decision.
- **SD-180** (`witness_rotationFork`, `run rotationForkTest`). Two requests that read the same day-old cookie both rotate it:
  two live heads in one chain (sessions.ts:49-56 has no compare-and-set). `chainBounded` still holds (both heads keep the
  login's `startedAt`, so the 90-day cap applies). The register refutes it as harmless, and the model agrees.
- **SD-166** (`witness_secretRotationOutage`, `run edgeTest`, runtime_ops module). The backend takes one
  `PLATFORM_PROXY_SECRET`; a deploy on one side answers 421 to honest router requests until the other side deploys. It fails
  closed: `edgeHeaderSigned` holds.

## 5. Register defects of this module that the model cannot reach

- **SD-308**, other parsers: only the login delegation parser and the grant check are in this module (see 3).
- **SD-382** (refuted): the `unknown` signed IP needs the IP pattern in normalizeEdge (backend.ts:247). The model has no IP
  values, because the rate buckets use the human as the IP.

## 6. New findings

None. Every violated invariant maps to a register id above. The age-lowering consequence is part of SD-054.

## 7. Where a fix goes

Each fix needs a test that fails before it (docs/tests-policy.md):
- SD-013: `packages/platform/test/api-security.test.ts` is the security suite file for these routes; a new
  `packages/platform/test/auth-edge.integration.test.ts` is better for parallel branches.
- SD-054, SD-491, SD-380: the same new file (Postgres store, real `createPublicApi`).
- SD-181: `packages/platform/test/cloud-auth.pg.test.ts` with a delegation whose `issuedAt` is 5 s ahead.
