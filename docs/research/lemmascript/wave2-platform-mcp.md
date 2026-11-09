# Wave 2: platform-mcp

Hand-written. lsc 0.6.6, Dafny 4.11, throttled shim. No LLM calls. All changes are uncommitted in the shared worktree.

## Proved files

"Verified" is the Dafny count that `lsc check` printed for the whole file, with 0 errors.

| File | Verified | Functions | Production call site |
|---|---|---|---|
| packages/platform/src/riff.ts | 5 | `le32`, `riffSpans` (the whole walk, with `decreases`) | `riffChunks` in photos.ts. The old inline loop is gone |
| packages/platform/src/decisions.ts | 12 | `hitPasses`, `challengeClaimable`, `sessionExpiry`, `sessionLive`, `withinSkew`, `lowerOf`, `lowestOf`, `adultGate`, `joinPlan` | store.ts and pg-store.ts `hit`, store.ts `claimAttempt`, sessions.ts `create` and `authenticate`, proxy.ts `verifyProxyHeaders`, age.ts `lowestAge`, photos.ts `adult`, accounts.ts `joinLocked` |
| packages/platform/src/consent.ts | 1 | `resolveConsent`, in place | Itself: accounts.ts `optedIn`, service |
| packages/mcp/src/decisions.ts | 9 | `grantStillTheirs`, `publicStatus`, `resolveRedirect`, `scopesWithin`, `toolAllowed`, `codeVerdict`, `grantVerdict`, `takenVerdict` | tools.ts (all grant checks), hooks.ts (re-export), handler.ts `authorizeStart`, `token`, `mcp` |
| packages/mcp/src/update-gate.ts | 2 | `gateUpdates` | tools.ts `get_updates` |
| deploy/backend/route.ts | 3 | `publicRoute` | backend.ts `publicFetch` is now a switch on it |
| deploy/router.ts | 7 | `isBackendPath`, in place, with two helper lemmas in proofs/deploy/router.dfy | Itself: `handle` |

OAuth: the checks in `token()` are gone from the handler and it branches on `codeVerdict`, `grantVerdict` and `takenVerdict`. The order is the same, and Cloud is still called only after PKCE passes.
`lowerOf` is called by `joinPlan` only. `lowestOf` is called by age.ts.

## Mutations

One or more real mutations per decision, run on copies. Each gave at least one Dafny error. Script: scratchpad/mut-platform/run.py.

| Function | Mutation | Errors |
|---|---|---|
| le32 | signed top byte (the shipped bug) | 3 |
| riffSpans | no header step in the offset | 1 (decreases) |
| riffSpans | no bounds check | 1 |
| hitPasses | `count > limit` | 1 |
| challengeClaimable | claimable at expiry | 1 |
| sessionExpiry | chain cap removed | 1 |
| sessionLive | revocation ignored | 1 |
| withinSkew | future time accepted | 1 |
| lowerOf | `Math.max` | 4 |
| lowestOf | keeps the last age | 1 |
| adultGate | minor passes | 2 |
| joinPlan | invite_only drops the age (defect 4) | 1 |
| joinPlan | wording exit drops the age (defect 4) | 1 |
| joinPlan | held or banned check removed | 5 |
| joinPlan | earlier lowest age ignored | 1 |
| grantStillTheirs | null-person grant follows a new person | 1 |
| publicStatus | restricted reads active | 1 |
| resolveRedirect | unregistered redirect | 1 |
| scopesWithin | `some` for `every` | 1 |
| toolAllowed | any scope runs a tool | 1 |
| codeVerdict | PKCE skipped | 1 |
| codeVerdict | replay not detected | 2 |
| grantVerdict | banned grant issues tokens | 2 |
| takenVerdict | second take issues | 2 |
| gateUpdates | gate loosened | 1 |
| publicRoute | any path reaches the service | 1 |
| publicRoute | no drain | 1 |
| resolveConsent | tie beats STOP | 1 |
| resolveConsent | no event means consent | 1 |
| isBackendPath | `/oauth/` widened to `/` (same edit in the .dfy) | 5 |

## What the proofs do not cover

- Booleans passed in are trusted: `wordingOk`, `held`, `banned`, `verifierOk`, `resourceOk`, `cloud`, `internal`, `mcp`, `adult`.
- `adultGate` takes `adult` as a boolean from core `isMinor`. Importing `adultAge` into the file gave unresolved `ADULT_AGE` in Dafny. The age rule itself is proved in core policy.ts.
- `riffSpans` needs bytes in 0..255. A Uint8Array gives that, but the cast in `riffChunks` is not checked. The walk reads only index and length. The strip itself ("no metadata survives") is not proved. JPEG and PNG walks are not proved.
- `codeVerdict`, `grantVerdict` and `takenVerdict` are separate steps. That the handler runs all three before it issues tokens is plain code, not a theorem. `takeCode` and `rotateRefresh` atomicity is SQL.
- `challengeClaimable` backs the memory store only. The SQL in pg-store.ts stays; a case in api-security.test.ts compares both stores with the proved rules on a grid. `hit` in pg-store.ts does call `hitPasses`, inside the SQL lock.
- `gateUpdates` proves the gate is applied, not that the regexes are complete. Only `summary` is gated.
- Numbers are integers in these proofs. `parseJoin` refuses a non-integer age.

## Trust

extern: 1 (`leakCount` in update-gate.ts: `outputLeaks` is regex). assume 0, havoc 0, axiom 0.
`//@ skip`: 6 in consent.ts (Set and regex constants).

## Defects fixed

Every case below failed before its fix. The failures were run in this worktree before the fix, or on a scratch copy with the HEAD handler, API or hooks files (scratchpad/before-fix, now deleted).

| Defect | Fix | Case and before-failure |
|---|---|---|
| 1 WebP hang (photos.ts riffChunks) | `le32` with `+` (unsigned) inside the proved `riffSpans` walk | photos.test.ts "a WebP chunk length with the top bit set ...": 7 files in a child process with a 15 s limit. Before: killed at 15 s (exit 143). After: `BadImage` for each |
| 3 OTP and ban, site path (api.ts) | `otp.start(app, e164, ip, send)`: a banned number goes through the same rate limits and gets the same answer, but no code is sent. Verify gives `invalid_code` for a banned number. The MCP hook now uses the same `send` flag, so a banned number also hits the limits like any other number (the old early return skipped them). | api-security.test.ts "a banned number gets no code ...". Before: 3 provider sends |
| 3 (coordinator) `/api/me`, `/api/me/export` with a session from before the ban | 403 `review`, like a held number. STOP still works | Same case. Before: 200 with `phoneMasked` |
| 4 age lost on the invite_only and consent_wording exits (accounts.ts) | `joinLocked` runs `joinPlan`. The wording check moved under the join lock, and every exit records the age except held or banned | api-security.test.ts "a stated age survives every exit". Before: `lowestAge` undefined. The PLAT-02 property test assumed that the invite-only refusal drops the age, so it now counts that age too |
| 6 `detectKeyword` misses "STOP NOW", "stop it", "stop pls" | Fail closed: a whole message that is only STOP (any spelling) plus courtesy or urgency words (`IT THAT THIS NOW RIGHT NOW ALREADY PLEASE PLS PLZ THANKS THANK YOU THX TY`, leading `PLEASE PLS PLZ JUST`) is a STOP. A sentence with other words is not | 25 rows appended to evals/opt-out.jsonl (14 stop, 11 not_stop, for example "haha stop it", "can't stop now", "stop now or after dinner?", "bus stop pls send the address"). Before: the evals gate failed on the stop rows. After: the evals block passes 25/25 |
| B4 legacy MCP grant after a ban | Checked first: `updatesFor` and notify `readUpdates` do not filter bans. New optional hook `banned(phoneKey, personId)`, which `platformHooks` supplies through `store.isBanned`. `bearer` and both token grants revoke the grant and refuse | oauth.test.ts "a ban ends a grant made before it". Before: refresh gave tokens |
| Coordinator: malformed percent escape gives 500 | hooks.ts uses the safe `cookieValue` from util.ts (local copy deleted). The Basic decode in handler.ts is in a `try` and gives 401 | oauth.test.ts "a bad percent escape ...". Before: 500 for the cookie and 500 for Basic |
| Coordinator: Origin scheme (api.ts:378) | An Origin counts only for https, or for http on localhost or 127.0.0.1 in dev | api-security.test.ts "an Origin ... on plain http". Before: 200 |
| Coordinator: a second `/oauth/authorize` ends the first tab | The start reuses this browser's `mcp_auth` token (a well-formed one) and does not mint a new one. Both tabs stay bound to the same browser. No product choice was needed | oauth.test.ts "a second authorize ...". Before: "This page has expired". Still true: when one tab finishes, the cookie is cleared, so the other tab expires. That clear is kept on purpose for shared browsers |

B5: photos.ts now uses core `isMinor` in place of a hard-coded 18 (through `adultGate`).
The handler.ts Basic decode and the hooks.ts cookie are fixed as above. Not done: `contactOrCode` and the parallel upload count.

## Tests and sims (heavy lock, one at a time)

Results are after the fixes. Sims run the simulated reviewer (`review: "auto"`), offline, with no LLM.

| Run | Result |
|---|---|
| Security suite: db, api-security, proxy, cloud-auth.pg, notify-retention.pg, mcp oauth, mcp pg, deploy/backend/backend, deploy/router, network shared-agent.integration, observatory staff | all pass (api-security 28/28 after the Turnstile stub was added to the new Origin case) |
| platform photos, api, number-change.pg, blooio-otp.integration | 17, 38, 5, 7 pass |
| mcp mcp, updates, cloud-authority.pg, cloud-oauth-continuation, signup-draft, output-schemas | 13, 5, 4, 13, 10, 2 pass |
| tests/e2e/platform.e2e.test.ts | 40 pass |
| sim evals / safety / ops | 25/25, 17/17, 11/11 blocking gates pass |
| `bunx tsc --noEmit -p .` | 1 error, in packages/engine/test/selection-guard.integration.test.ts (not my area). None in my files |
| `lsc check` on the 7 files | all 0 errors |

The api-security case "claimAttempt and hit answer as the proved rules do" compares the memory store and Postgres with `challengeClaimable` and `hitPasses` on a grid. It passes on both stores.

## Skipped

- 2.14 phone canonical form: the coordinator moved it to the frontend session (packages/core/src/phone-core.ts). phone.ts, pages.ts and util.ts `esc` were not touched.
- `refreshUsable` and the bearer token predicate: single conjunctions that sit next to the store reads. A proof would repeat the body.
- JPEG and PNG walks: they are already correct (non-negative length, the offset grows). Low value.
- restore.ts `restoreRefusal`, ops.ts, `env.ts`: these protect no member invariant.

## Founder or maintainer questions

- Should a join on a held or banned number record the stated age? Today it does not (a held number may have a new owner). `joinPlan` pins this: `recordAge <==> !held && !banned`.
- A wrong consent wording is now checked inside the join lock and after `seen()`. So a stale number goes on hold even on a malformed join. The answer is unchanged (`consent_wording`).

## Changes needed outside my files

- packages/network/service/service.ts text-join path (around line 1212) uses `joinAgeCheck`. Check whether it has the same lost-age exits.
- packages/core/src/replies.ts `parseOptOut` (core owner): "stop it" and "STOP NOW" could also be `exact` there, to match the ledger.
- proofs/trust.json: add extern +1 (update-gate.ts `leakCount`).
- Ban action in service.ts could also call `revokeAllFor`. Not needed now: the grant ends at its next use.
