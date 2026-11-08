# Quint findings: `quint/oauth_mcp.qnt`

Module plan: [state-machines report, section 6.11](../2026-11-07-state-machines.md). Source report:
[mcp-oauth.md](../state-machines/mcp-oauth.md). First model at `70e4f75` (code at `ad67275`). This
version follows the code after the fixes on branch `wave2/oauth_mcp` (`f52975f` to `659a083`).
Hand-written from the model runs on 2026-11-08. The traces are short forms of the simulator output and
of the `run` tests in the model.

Path short names: `H` = `packages/mcp/src/handler.ts`, `T` = `packages/mcp/src/tools.ts`,
`P` = `packages/mcp/src/pg-store.ts`, `K` = `packages/mcp/src/hooks.ts`, `Q` = `packages/mcp/db/oauth.sql`,
`SVC` = `packages/network/service/service.ts`, `ACC` = `packages/platform/src/accounts.ts`,
`PP` = `packages/platform/src/pg-store.ts`.

## 1. Final state

`safety` passes: every invariant in it holds on the fixed code, in the random simulation and in the
bounded Apalache check (section 3). Every witness is reachable. Three invariants stay out of `safety`, each
as its own named value with a comment:

- `activeExactlyGrants` (SD-186 parts (a) and (b)): the fix kept the documented `assistantLinked` hook
  contract, which sends the signal only on "consent granted" and "grant revoked".
- `numberChangeWorks` (SD-108): this defect belongs to the `identity_sagas` model and is not in this
  branch's fix set.
- `activeKeptWhileLiveAll` (Q-oauth_mcp-2, new, section 5): the strict form of the SD-186 (c) rule. It
  fails on a number change during an approval. `safety` holds `activeKeptWhileLive`, the same rule for
  every person outside that race (ghost `oldKey`).

## 2. What the model holds

- State: `oa` (auth requests, grants, codes, tokens, clients, drafts, profile buckets), `pf` (phone owner,
  bans, number holds, staff holds per member, minors, memberships, deleted persons, "forgotten" phone and
  app pairs), `ib` (inbox items, the `active` surface signal), `pc` (the program counter of each split
  handler: approve, deny, code exchange, refresh), `gh` (the `oauth.audit` rows, and ghost state: granted
  and denied requests, clients that ever got a grant, revoked grants, the effect of the last action).
- One action for each SQL statement or transaction. Changes for the fixed code:
  - Approve is `approveRead` (checks, no write), `approveCommit` (the `approveConsent` transaction: the
    request delete, the grant, its code and both audit rows; a failed insert rolls back and keeps the
    request), `approveLink` (`linked(true)` after the commit).
  - Code exchange is `exchCheck` and `exchRedeem` (the `redeemCode` transaction: the code's use, both
    tokens and `token_issued`). A crash can stop the exchange only before the transaction.
  - Refresh is `refrCheck` and `refrRotate`; `rotateRefresh` returns `rotated`, `replay` or `stale`.
  - Deny: `denyFinish` audits and denies only when its delete removed the row.
  - `cloudValid` checks the ban first for every grant (`banned(phoneKey, personId)`).
  - Every tool revocation writes its audit row. The signal goes off only when no other live grant of the
    person and assistant is left on the phone key.
  - Leave stops on a listener error. Delete everything and the under-13 decline forget every app.
  - `statusOf` reads `on_hold` for a member the Network holds.
  - `get_updates` returns nothing to a minor and drops items of closed opportunities (they are still
    marked seen).
  - The profile quota counts only calls that reach the app.
  - The request TTL is 10 minutes (2 ticks), and the service tick sweeps it with no OAuth traffic.
  - The sweep keeps a client with a `consent_granted` row. `movePhone` moves the drafts.
- Oracles: OTP verify, Cloud validation, the leak gate (a `leaky` flag per item), listener failure on
  leave, a failed insert in the approval transaction.
- Bounds: 2 persons, 2 phones, 2 apps (`friends`, `peon`), 2 clients (both on the Claude surface),
  3 auth requests, 2 inbox items, at most 8 tokens, profile cap 2 (the code has 5), request TTL 2 ticks
  of 5 minutes.

Left out (unchanged): `openai-surface-gate`, `skill-signup` (agent text), the MCP protocol headers, rate
windows other than the profile bucket, `updateAuthRequest` races (SD-388, refuted), a crash between
`revokeGrant` and its audit row, a listener failure during "delete everything" (it stops the delete like a
leave; the model has no failure branch for it), and bans by number (the model bans persons).

## 3. Checks run

```text
$ bun run quint:check --verify quint/oauth_mcp.qnt        (19 min 36 s on a shared machine)
ok   quint/oauth_mcp.qnt typecheck
ok   quint/oauth_mcp.qnt test                      (33 run tests)
ok   quint/oauth_mcp.qnt safety                    (--max-steps 60 --max-samples 10000, seed 0x5eed)
ok   quint/oauth_mcp.qnt witness_fullFlowUpdate (must be reachable)
ok   quint/oauth_mcp.qnt witness_refreshRotates (must be reachable)
ok   quint/oauth_mcp.qnt witness_revokeStops (must be reachable)
ok   quint/oauth_mcp.qnt witness_trueReplay (must be reachable)
ok   quint/oauth_mcp.qnt witness_withheldSeen (must be reachable)
ok   quint/oauth_mcp.qnt witness_leaveDeletes (must be reachable)
ok   quint/oauth_mcp.qnt witness_refreshStale (must be reachable)
ok   quint/oauth_mcp.qnt witness_denyLoses (must be reachable)
ok   quint/oauth_mcp.qnt witness_heldReadsOnHold (must be reachable)
FAIL quint/oauth_mcp.qnt verify safety             (error: Connection dropped: the shared Apalache port 8822)
```

The safety simulation alone took 12 min 38 s: 10000 traces, no violation, trace length 14 to 61
(average 43). The verify step lost its connection to the Apalache server on the default port 8822,
which other sessions on this machine share. It was run again on a private server:

```text
$ quint verify quint/oauth_mcp.qnt --main oauth_mcp --invariant safety --max-steps 5 \
    --server-endpoint localhost:28977
[ok] No violation found (665048ms).
```

Apalache 0.62.4. The first try used `--max-steps 8` (the old bound): step 3 took 2.5 min, step 4 took
9.7 min, and step 5 did not end in reasonable time, so it was stopped. The model's bound line is now
`verify-steps=5`. Five steps reach the sign-in and approval (startAuth, enterPhone, enterCode,
approveRead, approveCommit) and the deny race; they do not reach tokens. The random walk covers the
long flows (code exchange, refresh, tools, leave and delete). The new run tests cover each fixed trace.

## 4. Defect status

| Id | Status | Fix commit | Model change | Invariant | Run tests |
|---|---|---|---|---|---|
| SD-019 | fixed | f52975f | `cloudValid` checks the ban for every grant | `noBannedUse` | `banEndsGrantUseTest`, `banEndsRefreshTest`, `banEndsExchangeTest` |
| SD-089 | fixed | 55e6eb8 | `leave` stops on a listener error; `deleteAll` and `declineUnder13` forget every app | `grantDiesWithPerson` | `declineDeletesGrantTest`, `deleteAllOtherAppTest`, `leaveListenerFailsTest` |
| SD-184 | fixed | 47f486c | `exchRedeem` is one transaction | `replayIsTrue` | `codeCrashRetryTest` |
| SD-185 | fixed | c75c3e5 | `refrRotate` answers `stale` with no revocation | `replayIsTrue` | `refreshExpiredTest`, `refreshRevokedTest` |
| SD-186 (c) | fixed | c4b97ca | `unlinkAfter` keeps the signal while another live grant is left on the key | `activeKeptWhileLive` | `activeTwoGrantsTest` |
| Q-oauth_mcp-2 | new, not fixed | - | `oldKey` ghost marks the race | `activeKeptWhileLiveAll` (out of `safety`) | `moveDuringApprovalTest` |
| SD-186 (a), (b) | not changed (documented hook contract) | - | none | `activeExactlyGrants` (out of `safety`) | `consentCrashTest`, `activeExpiryTest` |
| SD-214 | fixed | b9a22e3 | `getUpdates` returns nothing to a minor | `noIntroToMinor` | `minorIntroTest` |
| SD-384 | fixed | f0fa853 | `movePhone` moves the drafts | `draftFollowsGrant` | `draftMoveTest` |
| SD-389 | fixed | 0bef2e0 | `approveCommit` is one transaction | `grantHasCodeAndAudit` | `consentCrashTest`, `consentInsertFailsTest` |
| SD-390 | fixed | bc68958 | the sweep keeps a client with a `consent_granted` row | `clientKeptOnceGranted` | `clientSweptTest`, `unusedClientSweptTest` |
| SD-393 | fixed | 5632c86 | TTL 2 ticks; the tick sweeps the request | `requestRetention` | `requestRetentionTest` |
| SD-394 | fixed | 96c0f57 | `toolInvalidGrant` writes the audit row | `everyRevocationAudited` | `silentRevokeTest` |
| SD-395 | fixed | 0251ac9 | the quota counts after the status gate | `quotaCountsAccepted` | `quotaTest`, `quotaAcceptedTest` |
| SD-397 | fixed | c219433 | `denyFinish` denies only when it deleted the row | `oneOutcome` | `approveDenyRaceTest`, `denyFirstTest` |
| SD-428 | fixed | ad36ab9 | `statusOf` reads `on_hold` for a held member | `heldIsHeld` | `heldActiveTest` |
| SD-430 | fixed | 9fb0588 | `getUpdates` drops items of closed opportunities | `noStaleUpdate` | `staleProbeTest` |
| Q-oauth_mcp-1 | fixed | 659a083 | the leave deletes the request; the approval then stores nothing | `grantDiesWithPerson` | `consentDuringLeaveTest`, `leaveAfterConsentTest` |
| SD-108 | not on this branch (identity_sagas) | - | none | `numberChangeWorks` (out of `safety`) | `cloudMoveTest` |
| SD-058 | skipped: founder decision | - | not modelled (agent text) | - | - |
| SD-115 | skipped: founder or maintainer decision | - | not modelled (no caller) | - | - |
| SD-182 | skipped: depends on SD-058 | - | not modelled (routing and copy) | - | - |
| SD-391 | skipped: founder decision | - | not modelled (CIMD is off) | - | - |

No defect of this module was "not reproduced".

### Notes on the fixes

- **SD-019.** A ban that commits while an exchange or a refresh waits between its check and its
  transaction still lets that one transaction commit (`redeemCode` and `rotateRefresh` do not read
  bans). The new tokens fail at the next bearer check and the next refresh, so no data reaches the
  banned person. `noBannedUse` therefore checks the points where the code reads the ban: the tool
  answers and the exchange and refresh checks.
- **SD-184.** The `mint` callback checks only expiry. When the grant expires while the exchange waits,
  `redeemCode` marks the code used and stores nothing. A retry of that code then revokes the expired
  grant and writes a `code_replay` row. No usable grant ends, so `replayIsTrue` accepts a replay on a
  grant that was not usable before (`status: "dead"`); the witness `witness_trueReplay` asks for a true
  replay. Also, a grant revoked (not expired) while the exchange waits still gets its tokens; they fail
  at bearer and at refresh (`stale`).
- **SD-186.** The fix checks other live grants on the same phone key (`store.grantsFor`). The model
  follows that. Part (a) (a stop between the approval's commit and `linked(true)`) and part (b) (an
  expiry does not clear the signal) are the documented hook contract; `activeExactlyGrants` shows both.
  Part (d), null-person grants, has no signal in the code (`linked` returns for them).
- **SD-430.** The fix is in `updatesFor` (the MCP `get_updates` path). The Postgres branch of
  `/internal/updates` reads `Notifier.readUpdates` directly and has no such filter; the model does not
  contain that path. An item whose opportunity row was pruned is not filtered either.
- **Q-oauth_mcp-1.** `forgetPhone` now deletes the sign-in requests first. The approval's transaction
  holds the request row lock until it commits, so the delete waits, and the grant delete after it sees
  the new grant. The model has leave and approve as atomic actions; both orders are run tests, and
  `packages/mcp/test/consent-forget.pg.test.ts` proves the lock order on real Postgres.

### Skipped defects (reasons from the fix run)

- **SD-058.** The site SKILL.md files tell the agent to take the phone number and the code; the MCP
  INSTRUCTIONS, the MCP README and AGENTS decision 10 say the agent never sees them. The founder must
  choose which rule wins. It is agent text, with no server state to model.
- **SD-115.** No page calls `/oauth/signup-draft`. The fixes are a Join page (a UI change, against the
  2026-10-19 correction) or the removal of `prepare_signup` (a change to the public tool list). A
  founder or maintainer decision comes first. The model keeps `prepareSignup` and the draft rows.
- **SD-182.** The `/join` redirect is deliberate. The fix changes agent-facing copy, and the correct copy
  depends on SD-058.
- **SD-391.** CIMD is off on purpose (no caller passes `cimdFetch`). Turning it on is a feature decision.

## 5. New defect

### Q-oauth_mcp-2: a number change during an approval stores the grant on the old key (`moveDuringApprovalTest`)

`connect(g1 on n1) -> startAuth(2) -> enterPhone(2, n1) -> enterCode(2) -> approveRead(2) ->
movePhone(p1, n1, n2) -> approveCommit(2) -> approveLink(2) -> consentsRevoke(2)`: the number change moves
g1 to n2 (`PP:373`). The approval built its grant from the request's number (old key) and
`approveConsent` (`P:115-135`) checks only the request row, so g2 is stored on n1, which nobody owns.
Revoking g2 runs the SD-186 fix (`H:181-191`): `store.grantsFor(old key)` finds no other grant, so
`assistantLinked(p1, claude, false)` runs while g1 is live on n2. The inbox then treats p1 as having no
Claude connection. g2 itself can do nothing: its first tool call answers `invalid_grant`
(`personForKey(old key)` is null). Severity is low (one surface signal; no data reaches anyone), and the
window is the few milliseconds between the approval's read and its commit. Found by a hand-written trace
after the fix run; the random walk (10000 samples of 60 steps) and Apalache (5 steps) do not reach it.
Possible fixes: refuse the commit when the request's number has a new owner (`approveConsent` callback),
or look up the person's live grants on every key in `revokeGrant`. Either needs a test that fails before
it. Not fixed on this branch: this step of the workflow updates the model only.

## 6. Model errors found and fixed

First version (`70e4f75`):

- A person deleted by "delete everything" came back with the same id through `createPerson`. Fixed with
  `pf.deleted`.
- A staff hold was per person; it is per member. Fixed: `netHeld` is a set of person and app pairs.
- A request continued after its client was swept. Fixed: every request step needs the client.
- `activeMatchesGrants` had wrong operator precedence. Fixed.
- `refrRotate` and `sweep` read keys of deleted tokens. Fixed with key guards.

This version:

- `movePhone` let a person move onto a number that an earlier owner had "forgotten" (left or deleted),
  and `grantDiesWithPerson` then counted the moved grant as a grant that was kept after a forget. The
  ghost set `forgotten` now drops the entries of the destination number on a move.
- The leave ghost counted expired grants as revoked; `revokeAllFor` revokes only live, unexpired grants
  (`grantsFor`). Fixed in `forgetGhost`.
