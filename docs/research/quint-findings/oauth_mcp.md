# Quint findings: `quint/oauth_mcp.qnt`

Module plan: [state-machines report, section 6.11](../2026-11-07-state-machines.md). Source report:
[mcp-oauth.md](../state-machines/mcp-oauth.md). Code read at `ad67275` (branch `wave2/oauth_mcp`).
Hand-written from the model runs on 2026-11-08. The traces below are short forms of the simulator and
Apalache output and of the `run` tests in the model. No code was changed.

Path short names: `H` = `packages/mcp/src/handler.ts`, `T` = `packages/mcp/src/tools.ts`,
`P` = `packages/mcp/src/pg-store.ts`, `K` = `packages/mcp/src/hooks.ts`, `Q` = `packages/mcp/db/oauth.sql`,
`SVC` = `packages/network/service/service.ts`, `ACC` = `packages/platform/src/accounts.ts`,
`PP` = `packages/platform/src/pg-store.ts`, `SCH` = `packages/notify/src/scheduler.ts`.

## 1. What the model holds

- State: `oa` (auth requests, grants, codes, tokens, clients, drafts, profile buckets), `pf` (phone owner,
  bans, number holds, staff holds per member, minors, memberships, deleted persons, "forgotten" phone and
  app pairs), `ib` (inbox items, the `active` surface signal), `pc` (the program counter of each split
  handler: approve, deny, code exchange, refresh), `gh` (ghost: audit rows, granted and denied requests,
  clients that ever got a grant, revoked grants, the effect of the last action).
- One action for each SQL statement or transaction. Split handlers: approve (`takeConsentRequest`,
  `putGrant`, `linked`, `putCode`, audit), deny (`liveRequest` read, then delete and audit), code exchange
  (checks, `takeCode`, first `putToken`, second `putToken` and audit), refresh (checks, then the
  `rotateRefresh` transaction). Crash actions stop approve and exchange between statements.
- Oracles: OTP verify (the person types the right code), Cloud validation (valid only for the current,
  unbanned, not held consent person; "unavailable" writes nothing and is left out), the leak gate (a
  nondeterministic `leaky` flag per item), listener failure on the forget path.
- Bounds: 2 persons, 2 phones, 2 apps (`friends`, `peon`), 2 clients (both on the Claude surface),
  3 auth requests (a grant has the id of its request), 2 inbox items, at most 8 tokens, profile cap 2
  (the code has 5), request TTL 3 ticks of 5 minutes.
- The `step` lists the progress families (sign-in, client, tools) twice and the environment once, so a
  random walk reaches the long flows. This changes only the weights, not the behaviour.

Left out: `openai-surface-gate` (a configuration table; no app here is slop), `skill-signup` (agent text),
the MCP protocol headers, rate windows other than the profile bucket, `updateAuthRequest` races (SD-388,
refuted), and a crash between `revokeGrant` and its audit row.

## 2. Check output

```text
$ bun run quint:check quint/oauth_mcp.qnt
ok   quint/oauth_mcp.qnt typecheck
ok   quint/oauth_mcp.qnt test                      (22 run tests)
FAIL quint/oauth_mcp.qnt safety                    (expected: the model shows the defects below)
ok   quint/oauth_mcp.qnt witness_fullFlowUpdate (must be reachable)
ok   quint/oauth_mcp.qnt witness_refreshRotates (must be reachable)
ok   quint/oauth_mcp.qnt witness_revokeStops (must be reachable)
ok   quint/oauth_mcp.qnt witness_trueReplay (must be reachable)
ok   quint/oauth_mcp.qnt witness_withheldSeen (must be reachable)
ok   quint/oauth_mcp.qnt witness_leaveDeletes (must be reachable)
```

Each invariant alone (`quint run --backend rust --seed 0x5eed --max-steps 60 --max-samples 10000`):

| Invariant | Result | Register id |
|---|---|---|
| `noBannedUse` | violated (50 steps) | SD-019 |
| `replayIsTrue` | violated (27 steps) | SD-184, SD-185 |
| `codeOnce`, `oneRefreshHead`, `revokedTerminal`, `servedOnLiveOwnGrant` (`soundCore`) | no violation | - |
| `activeMatchesGrants` | violated (25 steps) | SD-186, SD-389 |
| `grantDiesWithPerson` | violated (33 steps) | SD-089, Q-oauth_mcp-1 |
| `heldIsHeld` | violated (55 steps) | SD-428 |
| `noIntroToMinor` | violated (35 steps) | SD-214 |
| `noStaleUpdate` | violated (35 steps) | SD-430 |
| `everyRevocationAudited` | violated (51 steps) | SD-394 |
| `oneOutcome` | violated (50 steps) | SD-397 |
| `grantHasCodeAndAudit` | violated (23 steps) | SD-389 |
| `requestRetention` | violated (5 steps) | SD-393 |
| `clientKeptOnceGranted` | violated (24 steps) | SD-390 |
| `quotaCountsAccepted` | violated (39 steps) | SD-395 |
| `numberChangeWorks` | violated (22 steps) | SD-108 |
| `draftFollowsGrant` | not found by the random walk; the `draftMoveTest` run shows it | SD-384 |

Apalache 0.62.4 (`quint verify --max-steps 8 --invariant safety`, on a private server port because the
default port 8822 is shared on this machine and dropped the connection once): counterexample in 204 s,
`startAuth(3) -> enterPhone(3) -> tick -> tick -> tick` (SD-393). `quint verify --invariant soundCore
--max-steps 6`: see section 7. `bun run quint:check --verify` reports the safety verify as FAIL for the
same reason as the simulation.

## 3. Defects the model reproduces

Each trace is also a `run` test in the model (name in brackets). `connect` is the full sign-in, approve
and code exchange of p1 on n1 for client cF (friends), which leaves access token 1 and refresh token 2.

### SD-019: a ban ends no OAuth grant (`bannedKeepsUpdatesTest`)

`connect -> produceItem(probe for p1) -> ban(p1) -> getUpdates(1)`: the update is served to a banned person.
The simulator also finds `ban(p1) -> refrCheck -> refrRotate`: a banned person's legacy grant mints a new
token pair.

- `SVC:1734-1765` `ban` writes bans, suppression and `restricted` memberships, and calls no OAuth code.
- `H:718-733` `bearer` and `H:610-634` refresh have no ban check; `H:736` returns "valid" for a legacy grant
  with no Cloud call. `T:317-328` and `SVC:637-641` (`updatesFor`) do not check bans.
- `K:175-177` `personForKey` returns the banned person, so `grantStillTheirs` passes.
- Rule: AGENTS founder 2026-10-09 #3; `SVC:1727-1733` ("never matched or texted again").
- A Cloud grant is safe in the model: the Cloud oracle refuses a banned owner (`API:683-684`).

### SD-184: code consume and token mint are not atomic (`codeCrashRetryTest`)

`... exchCheck -> exchTake (used_at committed, H:596) -> crash -> exchReplay`: the client retries the code,
`H:575-580` sees `usedAt` and revokes the grant as a `code_replay`, though no token reached any client.
If the crash comes after the first `putToken` (`H:605`), an orphan access token stays until the grant is
revoked. Invariant `replayIsTrue`.

### SD-185: `rotateRefresh` false is taken as a replay (`refreshExpiredTest`)

`connect -> refrCheck(2) -> expireGrant -> refrRotate(2)`: `P:167-172` returns false because the grant
expired after the handler's own check (`H:626`), and `H:628-633` revokes the grant and writes
`refresh_replay`. The same happens when the person revokes the grant between the check and the rotation
(`refrCheck -> consentsRevoke -> refrRotate`): a second `refresh_replay` row for a token nobody reused.

### SD-186 and SD-389: the `active` signal and the consent-to-code steps (`activeTwoGrantsTest`, `activeExpiryTest`, `consentCrashTest`)

- (c) `connect(cF) -> connect(cP) -> consentsRevoke(g1)`: `H:175-179` calls `linked(grant, false)`, keyed
  by person and surface (`SVC:644-646`), so `active` is false while g2 is live.
- (b) `connect -> expireGrant`: nothing clears `active`.
- (a) and SD-389: `approveTake -> approvePutGrant -> approveLink -> crash`: a live grant with
  `active=true`, no code and no `consent_granted` row (`H:532-542` are separate statements). A crash
  between `putGrant` and `linked` gives a live grant with `active=false`.
- Rule: `K:67-68` and the comment at `H:174`. Invariants `activeMatchesGrants`, `grantHasCodeAndAudit`.

### SD-089: forget paths that leave grants (`declineKeepsGrantTest`)

- `connect -> declineUnder13(p1)`: `SVC:1293-1309` calls `forgetMembership` directly; `hooks.onForget` does
  not run, so `revokeAllFor` is not called and the grant row keeps n1 next to friends.
- Simulator: `p2 joins one app, has a grant on the other app -> deleteAll(p2)`: `ACC:438-442` runs
  `onForget` only for apps with a membership, so the other app's grant stays.
- Simulator: `leave(p1, listenerFails)`: `SVC:763-765` logs the listener error and the membership goes.
- Rule: README section 3 ("Leaving an app or deleting everything deletes that app's grants"),
  `H:89-91`, AGENTS age policy (under 13: nothing stored).

### SD-428: a staff hold reads as active (`heldActiveTest`)

`connect -> staffHold(p1) -> checkStatus(1)` gives `active` ("You are signed up.") and
`submitProfile(1)` is accepted. `SVC:1675-1686` runs `holdMember` only; `platform.memberships` is not
written, so `K:195-200` reads `active`, and `T:312` lets the profile through. Rule: `T:311`
("never reaches a stopped or held one").

### SD-214: an intro reaches a member who became a minor (`minorIntroTest`)

`connect -> produceItem(intro for adult p1) -> becomeMinor(p1) -> getUpdates(1)` returns the intro.
`SCH:236-248` and `T:326` filter only by person, app and the leak gate. Rule: AGENTS decision 1.

### SD-430: inbox items never expire (`staleProbeTest`)

`connect -> produceItem(probe) -> closeOpp -> getUpdates(1)` returns the probe as new, with
`next_step` "They answer by replying to the text" (`T:327`). `SVC:615-635` (`delivered`) records items with
no `expiresAt`, so the store's expiry filter (`packages/notify/src/store.ts:87`) never applies.

### SD-394: a tool revocation writes no audit row (`silentRevokeTest`)

`connect -> holdNumber(n1) -> checkStatus(1)`: `personForKey` is null on hold, `T:297-298` answers
`invalid_grant`, and `H:852-854` revokes with no audit row. After `clearHoldSame(n1)` the grant stays
revoked (the hold is final). Rule: README section 3 Audit.

### SD-397: approve and deny both succeed (`approveDenyRaceTest`)

`... enterCode -> denyRead -> approveTake -> approvePutGrant -> denyFinish`: `H:518-520` deletes with no
row check, writes `consent_denied` and redirects `access_denied` while a grant exists. Invariant `oneOutcome`.

### SD-393: the request keeps the number longer than the README says (`requestRetentionTest`)

`startAuth -> enterPhone -> tick x3`: `H:73` keeps the request 15 minutes, and the sweep (`P:205`) runs only
on OAuth traffic (`H:969`). README section 3 says "at most 10 minutes". Apalache finds the same trace.

### SD-390: a client is swept after its grants (`clientSweptTest`)

`connect -> consentsRevoke -> clientAges -> sweep -> startAuth(cF)`: the revoked grant is deleted, then
`P:211` deletes the day-old client because no grant row is left, and `H:362` answers "not registered".
README section 3 limits the sweep to "registered clients that never got a grant". The simulator also shows
the other order: a client is swept while its sign-in is open; the next step answers "expired"
(`H:424-425`), or, after `takeConsentRequest`, the grant insert fails on `Q:38`.

### SD-395: refused profiles fill the quota (`quotaTest`)

A null-person grant calls `submit_profile` three times; each is refused `not_joined`, and the third is
`429 Too many profiles today` with no accepted profile. `H:848` counts each well-formed call before the
tool runs. README section 2: "At most 5 accepted profiles per grant a day".

### SD-108: a Cloud grant row blocks a number change (`cloudMoveTest`)

`connect(cloud) -> consentsRevoke -> movePhone(p1, n1, n2)`: `PP:373` updates `oauth.grants.phone_key` for
every row of the old key, and `Q:65-75` raises on any Cloud row (also a revoked or expired one), so the
whole number change rolls back.

### SD-384: drafts keep the old phone key (`draftMoveTest`)

`leave(p1, friends) -> connect -> prepareSignup -> movePhone(p1, n1, n2)`: the grant moves to n2 (`PP:373`),
the draft keeps n1, so `P:61-78` can never claim it. Fail closed; the draft expires.

## 4. New defect

### Q-oauth_mcp-1: a consent in flight during leave stores a grant after `revokeAllFor` ran (`consentDuringLeaveTest`)

`startAuth -> enterPhone -> enterCode -> approveTake (takeConsentRequest, H:532) -> leave(p1, friends)
(revokeAllFor and forgetPhone, H:950-963, P:214-221) -> approvePutGrant (H:536)`: a live grant links n1
to friends after the person left friends. `forgetPhone` deletes `auth_requests` by `e164`, but the
approve already took the row, and `putGrant` does not check that a forget ran after the request started.
The grant stays usable: `personForKey` is still p1, `check_status` answers `not_joined`, and the grant
lives up to 90 days. The same window exists for "delete everything" (the person is then deleted, so the
first tool call revokes it, with no audit row, SD-394). The source report noted this race as low risk
(mcp-oauth.md section 17) but the register has no row for it. Rule: README section 3 and `H:89-91`.

## 5. Register defects of this module that the model cannot reach

| Id | Why |
|---|---|
| SD-058 | Two signup contracts in agent text (SKILL.md against `T:19-23`). No server state changes; a founder decision must say which rule stands, so no invariant is fixed. |
| SD-115 | The draft claim has no caller: a page wiring fact. The model has no claim action because production has none; `draftFollowsGrant` and `prepareSignup` still model the draft rows. |
| SD-182 | `/join` redirects in `deploy/router.ts`: routing and copy, no state. |
| SD-391 | CIMD is off because no caller passes `cimdFetch`: a configuration fact, no state to model. |

## 6. Model errors found and fixed during the runs

- A person deleted by "delete everything" came back with the same id through `createPerson`, so a
  ban followed the new person. Fixed with `pf.deleted`.
- A staff hold was per person; it is per member (`holdMember`), and a leave or a new join drops it.
  Fixed: `netHeld` is a set of person and app pairs.
- `liveRequest` (`H:419-426`) needs the client row; the model let a request continue after its client was
  swept, and stored a grant for a missing client. Fixed: every request step needs the client, and
  `putGrant` fails on the foreign key (`Q:38`).
- `activeMatchesGrants` first had wrong operator precedence (`iff` and `or`). Fixed.
- `refrRotate` and `sweep` read `pc.refr` keys of deleted tokens (runtime errors). Fixed with key guards.

## 7. Bounded verification of the invariants the code keeps

`quint verify quint/oauth_mcp.qnt --main oauth_mcp --invariant soundCore --max-steps 6` (Apalache 0.62.4):
no violation in 322 s. `soundCore` is `codeOnce`, `oneRefreshHead`, `revokedTerminal` and
`servedOnLiveOwnGrant`: each code gives at most one token pair, each grant has at most one live refresh
head, a revoked grant never becomes live, and a tool serves data only on a live grant of the consent
person. Six steps do not reach a token, so this bound covers the sign-in part only; the random walk
(10000 samples of 60 steps, which reach tokens, refresh and tool calls) found no violation either.

