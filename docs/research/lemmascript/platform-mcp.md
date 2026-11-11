# LemmaScript review: platform-mcp

Scope: every non-test file in packages/platform and packages/mcp, plus deploy/router.ts, deploy/pages-worker.ts, deploy/backend/*, deploy/cloudflare, deploy/backup, deploy/smoke.ts, sites/agents.ts and sites/shared/*.

Tools: lsc 0.6.6, Dafny 4.11, through the throttled shim. All trials ran on copies in `scratchpad/research/platform-mcp/` (t1 to t5). Trial files are hand-written. The in-place trials are copies of the shipping file with `//@` lines added. No sim, no test suite and no tsc ran. Nothing in the repository changed except this file.

Headline: the proof attempt on the WebP parser found a real denial of service. Two more invariant defects came from reading the code and then running it (a banned number on the web phone-code path, and a stated age that is lost). All three reproduce. See section 3.

## 1. Files reviewed

Verdicts: PROVE (in place), EXTRACT (core, then prove), MODEL ONLY, N/A.

### deploy

| File | Verdict | Why |
|---|---|---|
| deploy/router.ts | PROVE `isBackendPath`; N/A for the rest | `isBackendPath` verified in place. `handle` is fetch and headers. |
| deploy/pages-worker.ts | N/A | Wrapper for env merge. |
| deploy/smoke.ts | N/A | Read-only deploy check over HTTP. |
| deploy/cloudflare/worker.ts | N/A | Container start and config checks. Regex, `crypto`, class. |
| deploy/cloudflare/README.md, tsconfig.json, wrangler.toml | N/A | Config and docs. |
| deploy/backend/backend.ts | EXTRACT `publicRoute` | The path allow-list is inline in `publicFetch`. `normalizeEdge`, config, logger are I/O or regex. |
| deploy/backend/server.ts | N/A | Process wiring. |
| deploy/backend/ops.ts | MODEL ONLY or skip | `evaluate` is pure but has floats and strings, and only makes alerts. `sendOutcomes` uses regex. `AlertDispatcher.dispatch` mixes state and I/O. No invariant here. |
| deploy/backend/Dockerfile, Dockerfile.dockerignore, railway.toml, observatory.railway.toml | N/A | Config. |
| deploy/backup/lib.ts | MODEL ONLY: `sameServer`, `compareCounts`; N/A for the rest | Small pure helpers. Crypto and streams are outside the fragment. |
| deploy/backup/backup.ts | N/A | Process and streams. |
| deploy/backup/restore.ts | EXTRACT (low) | The refusal checks at restore.ts:38-46 could be one pure `restoreRefusal`. Ops tool, not a member invariant. |
| deploy/backup/Dockerfile, Dockerfile.dockerignore, railway.toml | N/A | Config. |

### packages/platform

| File | Verdict | Why |
|---|---|---|
| src/consent.ts | PROVE `resolveConsent`; EXTRACT keyword parts | `resolveConsent` verified in place with `//@ skip` on 5 consts and a one-line split. `detectKeyword` and `leaveTarget` use regex. |
| src/age.ts | EXTRACT | `unknown` and `Pick<>` parameters give unparseable Dafny. A typed core verified. |
| src/phone.ts | EXTRACT | Regex. A regex-free core partly verified. `keyedHash`, `safeEqual` are crypto. |
| src/otp.ts | EXTRACT | Decision logic is mixed with store calls. Providers are I/O. `ipBucket` is regex. |
| src/store.ts | EXTRACT `hitPasses`, `challengeClaimable` | Both are shared decisions. The class is a test store. |
| src/pg-store.ts | N/A | SQL. The SQL repeats the same predicates, and LS cannot check SQL. See section 4. |
| src/sessions.ts | EXTRACT `sessionExpiry`, `sessionLive` | Verified. The rest is crypto and store calls. |
| src/accounts.ts | EXTRACT `joinPlan` | The join order is the bug site (section 3, B3). `parseJoin` is `unknown` narrowing. |
| src/api.ts | N/A, except one call to add | HTTP routing, cookies, AES-GCM. Keep logic out. Bug B2 is here. |
| src/apps.ts | EXTRACT (low) `keywordApp` match step | Regex and `normalize`. Only the last compare is in the fragment. `lookingFor` is regex: no. |
| src/photos.ts | EXTRACT `le32`, chunk walk, `adultGate` | The parsers use `Uint8Array` and bit operations. Bug B1 is here. |
| src/photo-relay.ts | MODEL ONLY | State machine (`pending` to `approved`, etc.) mixed with DB locks and crypto. A pure `nextState` is possible. Belongs with the relay proofs of other areas. |
| src/proxy.ts | EXTRACT `withinSkew` (S); N/A for the rest | HMAC is Web Crypto. `sameString` is bitwise: not worth it. |
| src/body.ts | N/A | Stream reader. |
| src/turnstile.ts, otp-config.ts, cloud-delegation.ts | N/A | Network calls or env checks. |
| src/env.ts | MODEL ONLY (low) | `devShortcutsAllowed` is a small pure predicate over strings. The fail-closed result is plain to read. |
| src/index.ts, public-types.ts | N/A | Re-exports and types. |
| README.md, package.json | N/A | Docs and config. |

### packages/mcp

| File | Verdict | Why |
|---|---|---|
| src/tools.ts | PROVE `grantStillTheirs`; EXTRACT `gateUpdates` | `grantStillTheirs` verified with the same body. `checkArgs` is `unknown`. `contactOrCode` is regex. |
| src/hooks.ts | PROVE `publicStatus` (one small edit) | `case undefined:` is not supported. The rest is wiring. |
| src/handler.ts | EXTRACT `resolveRedirect`, `scopesWithin`, `toolAllowed`, `codeVerdict` | The OAuth order is inline in async code. All four cores verified. URL parsing stays outside. |
| src/leaks.ts | N/A for the regex; prove the gate around it | `outputLeaks` is regex and goes behind `//@ extern`. |
| src/util.ts | N/A | Crypto and regex. |
| src/store.ts | MODEL ONLY | Test store for OAuth. The same rules are in SQL. |
| src/pg-store.ts | N/A | SQL. |
| src/apps.ts | N/A | Static data. |
| src/pages.ts | N/A | HTML. |
| src/dev-server.ts, index.ts | N/A | Dev entry and re-exports. |
| db/oauth.sql, README.md, package.json | N/A | Schema and docs. |

### sites

| File | Verdict | Why |
|---|---|---|
| sites/agents.ts | N/A | Build-time strings. |
| sites/shared/api.ts | N/A | Client. `toE164` is only a client check; the server decides (phone.ts). |
| sites/shared/auth.ts, join.ts, agent.ts, turnstile.ts, ui.ts, demo.ts, prefill.ts | N/A | DOM. |
| sites/shared/landing.css, member.css | N/A | CSS. |

## 2. Candidates ranked by value

"Verified" means `lsc check` ended with 0 errors. A VC count is what Dafny printed for that whole trial file.

### 2.1 RIFF chunk walk (photos.ts:262, riffChunks), EXTRACT, effort S

- Property: every chunk length is non-negative, so the offset grows and the loop ends.
- Sketch: `le32(b0,b1,b2,b3)` with `//@ ensures \result >= 0 && \result < 4294967296`. The walk has `//@ decreases end - i`.
- Protects: backend availability for all apps, all ticks and /healthz. See B1.
- Blockers: `Uint8Array`, `<<`, `|`, closures. Model the walk on `number[]`, or make `le32` the shared helper and prove the loop on the extracted offset step.
- Trial: t4/riffbug.ts models the shipped signed length. Result: `Error: decreases expression might not decrease`, 4 verified, 1 error. t3/otp.ts with the fixed `le32`: verified. So the proof tells the bug from the fix.
- Note: the same pattern for the PNG length (photos.ts:246) is correct because it uses `+` after `>>> 0`. JPEG lengths are 16 bits with `len >= 2`. Each could use the same `decreases` proof.

### 2.2 Join order (accounts.ts:345-395), EXTRACT `joinPlan`, effort M

- Property: every exit records a stated age. A join happens only if not held, not banned, wording right, not a member, invited where needed, and both stated and lowest age reach the app minimum.
- Sketch:
  - `//@ ensures \result.step === "join" ==> !f.held && !f.banned && f.wordingOk && !f.member && (!f.inviteOnly || f.invited) && f.stated >= f.minJoinAge`
  - `//@ ensures f.lowest !== null ==> \result.step === "join" ==> f.lowest >= f.minJoinAge`
  - `//@ ensures \result.recordAge`
- Protects: minors never matched, lowest age wins, bans at join. See B3.
- Blockers: the shipping code is async with a lock. Facts must be loaded first and `joinLocked` must act on the plan. Keep the lock around both.
- Trial: t3/otp.ts, verified. It needed a local `const low = f.lowest` because field paths do not narrow. Whether a held or banned exit must record the age is a founder call. The trial records it.

### 2.3 Consent resolution (consent.ts:37, resolveConsent), PROVE in place, effort S

- Property: "opted_in" needs an app event that says opted_in. With a global opt-out it also needs that event to be strictly newer. No event means no consent.
- Sketch:
  - `//@ ensures last.app === undefined ==> \result !== "opted_in"`
  - `//@ ensures last.app !== undefined ==> \result === "opted_in" ==> last.app.state === "opted_in"`
  - `//@ ensures last.app !== undefined ==> last.global !== undefined ==> \result === "opted_in" ==> last.global.state === "opted_out" ==> last.app.at > last.global.at`
  - `//@ ensures last.app === undefined ==> last.global !== undefined ==> last.global.state === "opted_out" ==> \result === "opted_out"`
  - `//@ ensures last.app === undefined ==> last.global === undefined ==> \result === undefined`
- Protects: STOP everywhere; a tie goes to the opt-out.
- Blockers: `//@ skip` on the five keyword `Set` consts (spread is not extractable). `if (!global || global.state === "opted_in")` must split into two `if` lines (lsc emits a string compare on the narrowed value: a type error).
- Trial: t2, copy of the real file. Verified, 1 VC.

### 2.4 Backend path allow-list (router.ts:55, isBackendPath), PROVE in place, effort S

- Property: a forwarded path starts with one `/`, never `//`, so `new URL(path, BACKEND_ORIGIN)` stays on the backend origin (router.ts:102). It never starts with `/internal/`, `/review`, `/webhooks/` or `/ops/`.
- Sketch: `//@ ensures \result ==> pathname.startsWith("/") && !pathname.startsWith("//")`, plus one line for the four prefixes.
- Protects: the proxy trust boundary (an origin swap would send signed headers to another host).
- Blockers: none in TS. Needs two helper lemmas in the `.dfy` (`DiffPrefix`, `Excl`, about 20 lines).
- Trial: t1, real router.ts, body byte-identical. First run 2 errors, final run 7 verified, 0 errors.

### 2.5 Public route table (backend.ts:329, publicFetch), EXTRACT `publicRoute`, effort S

- Property: only `/webhooks/blooio[/...]` and the listed internal paths reach `svc.fetch` on the public port. While draining only `/healthz` and `/ops/metrics` answer normally.
- Sketch: `//@ ensures !internal.includes(path) && !path.startsWith("/webhooks/") ==> \result !== "service"`.
- Protects: staff API never on the public port, which guards the review queue.
- Blockers: `MCP_PATH` regex goes behind `//@ extern`.
- Trial: t4/route.ts, 3 verified, 0 errors.

### 2.6 OAuth decisions (handler.ts), EXTRACT, effort M

Trial t3/oauth.ts, with 2.7 and 2.8: 9 verified, 0 errors.

- `resolveRedirect` (handler.ts:365-366): a non-null result is in the registered list. `//@ ensures \result !== null ==> uris.includes(\result)`.
- `scopesWithin` (handler.ts:622): a refresh never widens scopes. `//@ ensures \result <==> forall(s: Scope, asked.includes(s) ==> held.includes(s))`.
- `toolAllowed` (handler.ts:835-838): a tool with a scope needs a token that holds it.
- `codeVerdict` (handler.ts:571-603): tokens issue only when found, same client, unused, unexpired, redirect, PKCE, resource, grant live and owner all hold. Replay goes first. The `verifierOk` input stays a runtime fact: the proof pins the order, not SHA-256.
- Blockers: `new URL`, regex, `await`. `redirectUriAllowed` and `canonicalResource` stay out of the fragment. Note that the two consume steps at handler.ts:575 and 598 must stay outside the pure core.

### 2.7 Grant owner (tools.ts:249, grantStillTheirs), PROVE in place, effort S

- Property: `//@ ensures \result <==> atConsent === now`. A grant never follows a new owner of a number. The proof also shows the body equals one `===`.
- Trial: same body, in t3/oauth.ts. Verified.
- Blocker for the real file: module consts in tools.ts need `//@ skip`. Not tried on the real file.

### 2.8 Leak gate on updates (tools.ts:326), EXTRACT `gateUpdates`, effort S

- Property: `//@ ensures forall(u: PublicUpdate, \result.includes(u) ==> leakCount(u.summary) === 0)`. No update with a leak label leaves through `get_updates`.
- Protects: leak check on every outbound (MCP side).
- Limit: `outputLeaks` stays `//@ extern`, so this proves that the gate is applied, not that the regexes find every leak. Only `summary` is gated, not `at` or `kind`.
- Trial: t3/oauth.ts, verified.

### 2.9 Status mapping (hooks.ts:76, publicStatus), PROVE after one edit, effort S

- Property: review or `restricted` gives `on_hold`; `active` only from state active with no review.
- Blocker: `case undefined:` gives `Unsupported switch case`. Move it to `if (state === undefined)`.
- Trial: t3/oauth.ts, verified.

### 2.10 Rate limit and OTP attempts (store.ts:307 and 289, pg-store.ts:229 and 204), EXTRACT, effort S

- `hitPasses`: `//@ ensures limit !== undefined ==> \result ==> count < limit`, and the gap rule.
- `challengeClaimable`: `//@ ensures \result <==> consumedAt === null && at < expiresAt && attempts < max`.
- Protects: OTP limits.
- Limit: production runs the SQL in pg-store.ts. `hit` can call `hitPasses` from TS (it already reads the count). `claimAttempt` is one SQL statement, so the predicate covers only the memory store unless a test compares them.
- Trial: t3/otp.ts, 14 verified, 0 errors, with 2.11, 2.12, 2.2 and `le32`.

### 2.11 Session life (sessions.ts:34 and 46), EXTRACT, effort S

- `sessionExpiry`: `//@ ensures \result <= at + ttl && \result <= started + maxMs`, and `<= expiresBefore` when given. A rotation chain cannot pass 90 days.
- `sessionLive`: live only for the same app, unexpired, not revoked now.
- Blocker: `Infinity` in `Math.min`, and narrowing inside `||`. The trial rewrote both as branches.
- Trial: t3/otp.ts, verified.

### 2.12 Photo adult gate (photos.ts:439, adult), EXTRACT `adultGate`, effort S

- Property: "ok" needs a stored age of 18 or more, a live person, and the app check. Use `isMinor` in the real code (see B5).
- Trial: t3/otp.ts, verified. The proof is about the literal 18 in the trial.

### 2.13 Lowest age (age.ts:8 and 20), EXTRACT typed core, effort S

- Property: `lowestOf(stated)` is below or equal to every age ever stated.
- Blockers: on the real file, `unknown` plus `Pick<AppInfo, "minJoinAge">` emit `Pick<...>` into Dafny: parse errors. Use a named interface and `number | null` for the core, and keep `validAge` at the boundary.
- Trial: real age.ts failed gen as above. t5/age.ts, 3 verified, 0 errors.

### 2.14 Phone canonical form (phone.ts:5, normalizePhone), EXTRACT, effort M

- Property: a result has length 12, starts with `+1`, area and exchange start with 2-9, area is not in the refused list. Goal: `normalize(normalize(x)) === normalize(x)`, because ban lookup depends on one canonical key.
- Blockers: regex; the core must use `charCodeAt`. `//@ pure` on a function with a `while` and `ensures` gave a Dafny parse error, so the digit check must be recursive.
- Trial: t4/phone.ts, 3 verified, 1 error. The open goal is `!notUsCa.includes(result.slice(2, 5))`. It needs a slice-of-concat assert in the `.dfy`. Idempotence was not attempted.

### 2.15 Proxy skew (proxy.ts:79), EXTRACT, effort S, low value

`withinSkew` verified in t3/otp.ts. HMAC and header parsing stay out.

## 3. Bugs

### B1. High: one small upload stops the whole backend

- Where: packages/platform/src/photos.ts:267 and 285.
- Cause: `b[i+4] | (b[i+5] << 8) | (b[i+6] << 16) | ((b[i+7] << 24) >>> 0)`. The `|` turns the result into a signed 32-bit value, so the `>>> 0` has no effect. The check `i + 8 + len > end` passes for a negative length.
- Result: with bytes `F8 FF FF FF`, `len` is -8, `padded` is -8, and `i += 8 + padded` adds 0. The loop never ends. It runs synchronously in `upload`, so the event loop stops: all apps, ticks and /healthz. With a kept type such as `VP8 `, each pass also pushes a chunk, so memory grows until the process ends.
- Who can do it: a signed-in adult slop member with photo consent, through `POST /api/photos`. packages/network/service/photoIntake.ts:99 also calls `upload` for a photo sent by text; that path was not run.
- Reproduction: `scratchpad/research/platform-mcp/webp-hang.ts`. A 24-byte file: `RIFF`, 4 bytes, `WEBP`, `XXXX`, `F8 FF FF FF`. `sniffType` gives image/webp, the code computes -8, and `stripMetadata` did not return. The alarm ended it at 12 s (exit 142).
- Fix: compute the length with `+` (as `stripPng` does), or apply `>>> 0` to the whole expression, and refuse when `len` is over `end - i - 8`.
- Failing case to add: a row in the photo block of scripts/sim/safety.ts, with a time limit.

### B2. High: a banned number gets a code and a session on the web path

- Where: packages/platform/src/api.ts:462 and 479. `otp.start` and `otp.verify` have no ban check. The Cloud path (api.ts:437) and the MCP path (hooks.ts:154 and 167) do.
- Rule: founder decision 3 of 2026-10-09: a banned number is refused at OTP.
- Reproduction: `scratchpad/research/platform-mcp/ban-age.ts`. With a phone ban: `start` 200 with 1 provider send, `verify` 200 with a session cookie.
- Effect: paid SMS to a banned number, and a session. Join stays refused, so no match follows. At the MCP consent step `login` refuses.
- Gap in the gate: the sim gate "ban: ..." in scripts/sim/safety.ts calls only `hooks.startOtp`, so it passes with this bug.
- Fix: the same silent answer as hooks.ts:158, and no session on verify. Keep the same body and timing so there is no enumeration.

### B3. High: a stated age is lost on two exits

- Where: accounts.ts:364 (`invite_only`) returns before `recordAge`. accounts.ts:346 (`consent_wording`) returns before the lock.
- Rule: "the lowest age ever stated or recorded wins".
- Reproduction, same script: age 15 on invite-only ntwrk gives `invite_only` and no age floor. Then age 25 on slop gives `join ok` and lowest age 25. The same happens with a wrong consent version at 15, then 25.
- Effect: a person who stated 15 becomes a matchable adult member. This touches the minors invariant.
- Fix: record the age on both exits. Candidate 2.2 fixes the order for good.

### B4. Medium: a legacy MCP grant survives a ban (read, not run)

- Where: `bearer` (handler.ts:718) checks only Cloud grants. The ban path (packages/network/service/service.ts about 1735-1760) does not call `revokeAllFor`. `personForKey` ignores bans.
- Effect: membership becomes `restricted`, so `check_status` says on hold and `submit_profile` is refused. But `get_updates` and token refresh continue until the grant ends (up to 90 days). I did not check whether `updatesFor` filters a banned person.
- Fix: revoke grants in the ban action, or refuse in `callTool`.

### B5. Low (read, not run)

- photos.ts:441 hard-codes `p.lowestAge < 18`. The code invariant says use `isMinor`.
- handler.ts:333: `decodeURIComponent` on a Basic header is not in a `try`. A bad `%` gives 500, not 401. hooks.ts:115 has the same issue for a cookie; util.ts:55 has the safe form.
- tools.ts:143 `contactOrCode`: `212/555/01/01` splits into runs of fewer than 4 digits and passes, and fullwidth digits are not `\d`. Low, because the text is the person's own and output has its own gate (`PHONE` allows `/`, and `plainVariants` folds).
- photos.ts upload: the count check for `too_many` has no lock, so parallel uploads can pass the limit of 6.

### Checked with no defect

- Decode before check (hono case): no path is decoded before a check. The router and backend compare the WHATWG pathname. `%2e` dot segments are resolved by the URL parser before the check, and `%2f` stays encoded and matches no prefix. The backend repeats the check on its own URL. `/internal/*` is not reachable through the router.
- Proxy signature: method, path with query, host, IP and time are signed, client copies are removed first, and both layers verify. `normalizeEdge` rewrites `url.host` only, so the path that was signed is the same.
- OTP limits, PKCE (S256 only, verifier and challenge shape), redirect exact match, RFC 8707 resource binding, refresh rotation with replay revoke: no defect found.
- JPEG and PNG strippers: lengths are non-negative and the offset always grows.

## 4. Runtime guards

| Proved predicate | Replaces or backs up | Same code exercised by |
|---|---|---|
| `le32` and the walk | photos.ts:267; `riffChunks` length check | scripts/sim/safety.ts photo block; add the hang row |
| `joinPlan` | order in `joinLocked` | scripts/sim/safety.ts "ban: ..."; packages/platform/test/api-security.test.ts |
| `resolveConsent` | itself (no change) | packages/platform/test/db.test.ts; sim safety block |
| `isBackendPath` | itself; backs up `RUN_WORKER_FIRST` | deploy/router.test.ts |
| `publicRoute` | the if-chain at backend.ts:329 | deploy/backend/backend.test.ts |
| `resolveRedirect`, `scopesWithin`, `toolAllowed`, `codeVerdict` | inline checks in handler.ts | packages/mcp/test/oauth.test.ts, pg.test.ts |
| `hitPasses` | store.ts:307, and the TS branch at pg-store.ts:236 | packages/platform/test/db.test.ts |
| `challengeClaimable` | store.ts:289 only; the SQL at pg-store.ts:204 stays, so add a test that compares them | packages/platform/test/db.test.ts |
| `sessionExpiry`, `sessionLive` | sessions.ts:36 and 50 | packages/platform/test/api-security.test.ts |
| `gateUpdates` | tools.ts:326 | packages/mcp/test/oauth.test.ts; packages/network/test/shared-agent.integration.test.ts |

The test file names come from the security suite list in CLAUDE.md. I did not read those files, so the mapping per case is a suggestion. New checks must be sim gates, integration or e2e cases: docs/tests-policy.md forbids unit tests.

## 5. What not to verify

- SQL (pg-store.ts in both packages, oauth.sql): LS does not see it, and production bans, consent reads and rate limits run there. A proof on the memory store says nothing about Postgres. Use pure predicates where TS decides, and integration tests elsewhere.
- Regex gates (leaks.ts, `contactOrCode`, `lookingFor`, `detectKeyword`, `leaveTarget`, `ipBucket`): out of the fragment, and the true question is about language, not logic. Use corpus rows. Prove only the gate around them.
- Crypto and HTTP (proxy HMAC, AES-GCM cookies, PKCE hash, Twilio, Blooio, Turnstile, R2): trust the libraries.
- `handler.ts`, `api.ts` as wholes: real `await`, and races are the risk there (`takeCode`, `rotateRefresh`). LS has no model of concurrency.
- JPEG, PNG and WebP strippers as whole functions: proving "no metadata survives" needs a format model. Prove termination and bounds only.
- `ops.ts`, backup, smoke, `env.ts`: no member invariant. Effort is better spent above.
- sites/*: DOM and client checks. The server decides.

## LS friction seen (for the implementation wave)

- Any top-level const that lsc cannot extract stops the whole file. Add `//@ skip` above it. `//@ autohavoc` does not help.
- Spec narrowing works with `x !== undefined ==> ...`, not with `x !== undefined && x.f` on a parameter. `?.` is not in the spec grammar.
- Field paths do not narrow in code: use a local const or split the `if`. `!o || o.state === "x"` on a narrowed optional emits a type error (lsc defect).
- `Pick<>` and `unknown` parameters emit Dafny that does not parse.
- `//@ pure` with a `while` and `ensures` emits Dafny that does not parse. Use a recursive function.
- After a TS change, use `lsc regen`, or delete both `.dfy` and `.dfy.gen` only when no proof additions exist. A plain `lsc check` reports "modifications to generated lines" and does not verify the new code.
