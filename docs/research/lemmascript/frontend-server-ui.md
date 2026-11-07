# LemmaScript survey: UI outside `sites/` and `packages/observatory/web`

Hand-written by a research agent, at commit a0ed7bc. A skeptic pass then checked it and corrected it. No code in the repo changed.

Trials and reproduction scripts are in the session scratchpad, not in the repo:
`/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/server-ui/` (skeptic pass, current) and `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-server-ui/` (first pass).
All `lsc` runs used the throttled wrapper with `--backend=dafny`. No sim, no test suite, no build.

**Main results**

- Only one file renders production HTML: `packages/mcp/src/pages.ts`. It holds the OAuth phone, code and consent pages. There is no other server-rendered production page.
- I found no XSS, no open redirect and no consent bypass. HTML escaping, redirect target checks, consent state and CSRF are sound in this file set. One client value reaches a response header without a check (item 15). I found no exploit.
- 11 first-pass findings reproduce (bugs 1, 2, 3, 4, 6, 7, 8, 9 and items 10, 11, 14). Items 12 and 13 hold on reading. Bug 5 was overstated and is downgraded. One new item: 15.
- The worst: Cancel on the phone and code pages does nothing in Chrome (bug 1), and a banned number still gets a code and a session from the web API (bug 2). The session also reads `/api/me` and `/api/me/export`.
- Candidates: 8 tried. Each proved contract was run against a mutant or against today's code, and that run failed or showed the contract too weak. 3 candidates are rejected because their contract restates the code or models SQL (4, 5, 9).

**Reach of bugs 1, 2 and 5.** With `NETWORK_CLOUD_AUTH_MODE=production-v1`, the phone and code pages and `/api/auth/otp/*` are off (`handler.ts:406`, `hooks.ts:155`, `api.ts:463`). `docs/results/2026-10-18-production-cloud-network-handoff.md` says those flags stay unset in the real services. The repo has no later record, so confirm the live value. The agent SKILL files use `/api/auth/otp/*` directly (`sites/skills/friends-help/SKILL.md:98`), so that path is a main path when the flags are unset.

**Limit of the trials.** Each proof covers a copy or a rewrite, not the shipping function. `number` is a mathematical int here. Section 7 lists what each trial proves.

## 1. Inventory

Verdicts: **VIP** = verify in place. **EXT** = extract, then verify. **NA** = not applicable.

Search: `git grep` for `<html`, `<!doctype`, `text/html`, `<form`, `html\``, `Bun.serve`, redirects and `Set-Cookie`, over the whole tree except `sites/`, `docs/` and `packages/observatory/web`. The skeptic pass repeated this and found no further HTML file. `plugins/` has none. `.tsx` outside those folders is one test (`packages/observatory/test/held-photo-ui.test.tsx`).

### 1.1 Every HTML or `text/html` hit

| File:line | What it is | Production? |
|---|---|---|
| `packages/mcp/src/pages.ts:19` | OAuth phone, code, consent, message and connections pages | Yes |
| `design/member-flows/server.ts:89` | Loopback design studio preview | No, local |
| `design/member-flows/index.html` | Studio shell | No, local |
| `tools/clef-label/index.html` | Rater tool, opened as a local file | No, local, handles photos |
| `packages/notify/scripts/link-test-page.ts:31` | Writes a device-test HTML file | No, CLI |
| `scripts/sim/audit.ts:233` | Fixture for a build gate | No, test |
| `scripts/sim/clef.ts:213` | Regex gate that reads the clef-label page | No, test |
| `tests/e2e/auth-feedback.e2e.test.ts:35`, `tests/e2e/platform.e2e.test.ts:60`, `deploy/router.test.ts:18` | Fixtures and assertions | No, test |

The phone confirmation for OAuth is `phonePage` and `codePage` in `pages.ts`. The older web path is `sites/shared/auth.ts` (out of slice) calling `/api/auth/otp/*`. The observatory page comes from `packages/observatory/web/index.html`, which `packages/observatory/src/server.ts:31` imports. It is out of slice.

### 1.2 `packages/mcp/src`

| Path:line | Purpose | Verdict |
|---|---|---|
| `pages.ts:13` `page` | Page shell, CSP, headers | EXT: CSP string builder is pure. `Response` is NA. Prove `form-action` lists the redirect origin. See 4.1 |
| `pages.ts:42` `hidden`, `:43` `err` | Escaped fragments | VIP after `esc` is proved |
| `pages.ts:45` `phonePage` | Phone form. `clientName` and `redirectHost` are unused | EXT with `page`; pass the redirect origin |
| `pages.ts:58` `codePage` | Code form. Cancel only, no resend | EXT with `page` |
| `pages.ts:77` `consentPage` | Consent form, the only page with `formTargets` | EXT with `page` |
| `pages.ts:88` `messagePage` | Error page with retry link | EXT: gate at `:89`, candidate 7 |
| `pages.ts:93` `consentsPage` | List of grants | NA: template only, escaped |
| `util.ts:28` `esc` | HTML escape, regex form | EXT: candidate 3 |
| `util.ts:4-6` hash and random | `node:crypto` | NA: crypto |
| `util.ts:8` `safeEqual` | Constant-time compare | NA: `Buffer`, timing is not modelled |
| `util.ts:14` `pkceS256` | PKCE hash | NA: crypto |
| `util.ts:18,20` `validVerifier`, `validChallenge` | PKCE shape | EXT: regex to a char loop |
| `util.ts:24` `json` | JSON response | NA |
| `util.ts:31` `readForm` | Form parse, duplicate refusal | EXT: duplicate key check only |
| `util.ts:44` `readJson` | JSON body | NA |
| `util.ts:55` `cookieValue` | Cookie read, catches bad escapes | EXT: split logic; `decodeURIComponent` as `extern`. Merge the three copies |
| `util.ts:65` `isLoopbackHost` | Loopback names | VIP |
| `handler.ts:101` `OWNED` | Paths this handler owns | VIP: candidate 6 |
| `handler.ts:105` `rpcError` | JSON-RPC error | NA: trivial |
| `handler.ts:109` `decodeHeaderValue` | Base64 header | NA: `Buffer`, regex |
| `handler.ts:116` `parseScopes` | Scope parse | EXT: split by whitespace is regex; the subset check is provable |
| `handler.ts:123` `redirectUriAllowed` | RFC 7591 rule | EXT: parts form, candidate 2 |
| `handler.ts:132` `isOpenAiHost` | OpenAI host test | VIP |
| `handler.ts:142` `assistantOf` | Assistant from redirect hosts | EXT: remove `URL` |
| `handler.ts:150` `createMcpHandler` | Closure over all handlers | NA: closures and `await` |
| `handler.ts:169,175` `linked`, `revokeGrant` | Store calls | NA: `await` |
| `handler.ts:196` `canonicalResource` | RFC 8707 form | EXT: remove `URL` |
| `handler.ts:203` `challenge` | `WWW-Authenticate` | NA: no strong property |
| `handler.ts:206` `limited` | Rate check | NA: `await` |
| `handler.ts:211` `resolve` | App and IP from request | EXT: host pick order only |
| `handler.ts:222` `originOk` | CSRF origin rule | EXT: candidate 5 |
| `handler.ts:236-255` `openAiUnavailable`, `chatGptRedirects`, `customSlopClient`, `customSlopEligible` | Surface gating | EXT: `openAiUnavailable` is a pure boolean over inputs. Rest NA (`await`, `URL`) |
| `handler.ts:258` `getClient` | Client cache | NA: `await`. See bug 9 |
| `handler.ts:267` `cimdClient` | CIMD fetch | NA: fetch. Off in production |
| `handler.ts:292` `register` | Dynamic registration | EXT: field rules only |
| `handler.ts:324` `authClient` | Client auth | EXT: method decision (`:341-343`). See bug 6 |
| `handler.ts:349` `redirectTo` | Location builder | NA: `URL`; target comes from a checked value |
| `handler.ts:355` `authorizeStart` | Start of OAuth | EXT: redirect pick (candidate 2) and first state (candidate 1) |
| `handler.ts:419` `liveRequest` | Binds request to browser | EXT: predicate over `rid`, app, expiry and cookie hash |
| `handler.ts:429` `authorizeCloudReturn` | Cloud return | EXT: guard chain at `:431`, `:435` |
| `handler.ts:445` `authorizeStep` | Phone, code, consent, cancel | EXT: candidate 1 |
| `handler.ts:524` `finishAuthorization` | Issues grant and code | EXT: candidate 1 |
| `handler.ts:548` `tokenPair` | Token pair | EXT: expiry never past the grant (`:553-556`) |
| `handler.ts:559` `token` | Token endpoint | EXT: code and refresh state rules, candidate 9 |
| `handler.ts:639` `revoke` | RFC 7009 | NA: `await`, small |
| `handler.ts:660` `consents` | Connections page, revoke | EXT: strict origin check (`:668`), candidate 5 |
| `handler.ts:685,705` metadata | Static JSON | NA |
| `handler.ts:718` `bearer` | Bearer check | EXT: token predicate at `:726`, `:728` |
| `handler.ts:735` `cloudGrantCurrent` | Cloud grant check | EXT: "failure never extends" at `:738`, `:743` |
| `handler.ts:746,751,756` unavailable pages | Error pages | NA |
| `handler.ts:760` `mcp` | JSON-RPC dispatch | NA: too effectful. Version rule at `:796-812` is EXT |
| `handler.ts:865` `handle` | Router | NA; route table is checked by candidate 6 |
| `hooks.ts:76` `publicStatus` | Member state to agent | VIP: `review` wins, `restricted` maps to `on_hold` |
| `hooks.ts:115` `cookieValue` | Cookie read, throws | EXT: delete it. Bug 6 |
| `hooks.ts:127` `platformHooks` | Adapter | NA: closures. Ban order at `:159`, `:168` is a fact for candidate 4 |
| `apps.ts:32` `app`, `:50` `defaultApps` | Static data | NA |
| `apps.ts:63` `appsOn`, `:67` `defaultHostMap` | Lists and host map | VIP: slop never on `openai` |
| `tools.ts:26` `toolDefs` | Tool schemas | NA: data |
| `tools.ts:143` `contactOrCode` | Refuses codes in profile text | NA: regex-heavy |
| `tools.ts:197` `publicInfo`, `:221` `NEXT`, `:267-290` signup answers | Agent-facing links | EXT: link choice per app. Bug 4 |
| `tools.ts:159` `checkArgs`, `:253` `callTool` | Tool arguments and dispatch | EXT: `checkArgs` shape rules. `callTool` is NA |
| `leaks.ts:25` `outputLeaks` | Output gate | NA: regex, LeakGuard |
| `store.ts` `MemoryOAuthStore` | Test store | NA: classes. `takeConsentRequest` at `:201` is modelled in candidate 1 |
| `pg-store.ts:109` `takeConsentRequest` and rest | Postgres store | NA: SQL |
| `dev-server.ts`, `index.ts` | Local server, exports | NA |
| `apps.ts` `devHostMap` | Dev host map | NA: added by skeptic pass |
| `tools.ts:192` `invitationGuidance` | Invite text | NA: added by skeptic pass |
| `tools.ts:249` `grantStillTheirs` | A null-person grant never follows a later person | VIP, but the contract restates a one-line body. A test row is enough. Added by skeptic pass |
| `handler.ts:135` `ASSISTANT_REDIRECT_HOSTS`, `:746-756` `browserUnavailable`, `consentUnavailable`, `temporarilyUnavailable` | Host table, error pages | NA |

### 1.3 `packages/platform/src` (browser-facing decisions only)

| Path:line | Purpose | Verdict |
|---|---|---|
| `api.ts:117` `parseCookies` | Cookie parse, no throw | EXT: same as `util.ts:55` |
| `api.ts:128` `createPublicApi` | Closure | NA |
| `api.ts:146` `localOrigin` | Loopback origin | NA: `URL`, boot only |
| `api.ts:226,233` `seal`, `unseal` | AES-GCM | NA: crypto |
| `api.ts:248` `oauthReturnPath` | Return path gate, regex | EXT: char loop, candidate 7 |
| `api.ts:249` `cloudReturnPath` | Allowed return paths | EXT with `:248`. `/join` is now retired (router) |
| `api.ts:250` `startCloudHandoff` | Builds Cloud URL | NA: crypto and `URL`; target origin is fixed config |
| `api.ts:267` `cloudSessionStatus` | Cloud session | EXT: decision only |
| `api.ts:284` `validate` | Cloud call | EXT: status map at `:291-297`, "only explicit denial revokes" |
| `api.ts:301` `handle` | Router | NA as a whole |
| `api.ts:339-342,356-360,373-379` | Origin checks, three copies | EXT: merge, candidate 5 |
| `api.ts:411` callback | Cloud callback | EXT: guard at `:433-436`. See bug 7 |
| `api.ts:462,479` OTP routes | Web OTP | EXT: add ban check. Bug 2 |
| `api.ts:626` delete | Step-up | EXT: `sessions.fresh` gate |
| `phone.ts:5` `normalizePhone` | Phone rule | EXT: regex to digits, candidate 8 |
| `phone.ts:29` `usOrCanadaArea` | Area code rule | EXT: `NOT_US_CA` as `Set` |
| `phone.ts:33` `isSyntheticPhone` | Test numbers | EXT: small |
| `phone.ts:36` `maskPhone` | Mask | VIP: output shows last 4 only |
| `phone.ts:42,46` hash, compare | Crypto | NA |
| `age.ts:8` `lowestAge`, `:14` `canJoinApp`, `:17` `canMatchInApp`, `:20` `joinAgeCheck` | Age policy | EXT: `typeof` guard falls away on `number`. Candidate 10 |
| `otp.ts:26` `sixDigits` | Random | NA |
| `otp.ts:48,82` providers | Fetch | NA |
| `otp.ts:109` `otpProviderFromEnv` | Provider pick | VIP: console provider only in dev (via class guard) |
| `otp.ts:139` `ipBucket` | Rate bucket | EXT: regex to splits, M effort |
| `otp.ts:166` `start` | Rate limits and send | EXT: limit order |
| `otp.ts:198` `verify` | Code check | EXT: candidate 4 |
| `otp-config.ts:5` | Config problems | NA |
| `proxy.ts:26` `isProxyHeader` | Header strip | VIP: `toLowerCase`, `startsWith` |
| `proxy.ts:42` `sameString` | Compare | VIP: uses `charCodeAt`; XOR is not in the subset, rewrite for proof |
| `proxy.ts:73` `verifyProxyHeaders` | Signature | EXT: skew rule. Crypto is NA |
| `body.ts:9,31` | Capped body | NA: streams, `await` |
| `sessions.ts:28-65` `SessionService` | Sessions | EXT: class is out of the subset. Expiry `min` at `:36` and rotate rule at `:52` are pure |
| `consent.ts:37` `resolveConsent` | STOP versus START | VIP |
| `consent.ts:46` `lastEvents` | Last events | VIP |
| `consent.ts:65` `detectKeyword`, `:81` `leaveTarget` | Keywords | NA: regex. Other slices |
| `turnstile.ts:15` `verify` | Siteverify | NA: fetch |
| `cloud-delegation.ts:7` | Cloud calls | NA: fetch |
| `env.ts:23,26` `isProduction`, `devShortcutsAllowed` | Env gates | VIP: no dev shortcut in production |
| `apps.ts:97` `keywordApp` | Keyword routing | EXT: regex to a table |
| `accounts.ts:82` `parseJoin` | Join input | EXT: age and consent rules |
| `photos.ts:159` `sniffType` | Magic bytes | EXT: bytes as `number[]` |
| `photos.ts:615`, `photo-relay.ts:232` | Image responses. `content-type` comes from sniffed `PhotoType`, with `nosniff` and `default-src 'none'` | NA: headers are fixed. No bug |

### 1.4 `deploy/`, `scripts/`, `tools/`, `design/`, others

| Path:line | Purpose | Verdict |
|---|---|---|
| `deploy/router.ts:44` `retiredSitePage` | Retired path answers | EXT: path decision. Candidate 6 |
| `deploy/router.ts:55` `isBackendPath` | Route split | VIP: candidate 6 |
| `deploy/router.ts:81` `proxyHeaders` | Signing | NA: crypto |
| `deploy/router.ts:88` `handle` | Worker | NA: `await`. Header filter at `:97-100` is EXT |
| `deploy/pages-worker.ts:21` | Env merge | EXT: built value never beats a project value |
| `deploy/smoke.ts:10` `smoke` | Deploy check | NA: network |
| `deploy/cloudflare/worker.ts` | Container class | NA: classes, config guard only |
| `deploy/backend/backend.ts:83` `loadConfig` | Boot config | NA |
| `deploy/backend/backend.ts:197` `redact` | Log redaction | NA: regex. Other slice |
| `deploy/backend/backend.ts:236` `normalizeEdge` | Trust boundary | EXT: "no client proxy header survives unless signed", header lists as arrays |
| `deploy/backend/backend.ts:258` `ipOf` | Client IP | VIP |
| `deploy/backend/backend.ts:293` `routeLabel` | Metric label | NA |
| `deploy/backend/backend.ts:307` `createBackend` | Process | NA |
| `deploy/backend/server.ts`, `ops.ts` | Process and alerts, no UI | NA |
| `deploy/backup/*` | Backups, no UI | NA |
| `scripts/sites-dev.ts:31` `proxy`, `:71` `file`, `:90` `serveSite` | Dev proxy. Slash redirect at `:104` strips leading slashes correctly; path check at `file` is correct | NA: `await`, fs; dev only |
| `scripts/platform-dev.ts` | Dev servers | NA |
| `scripts/wrangler.sh`, `clef-fit.ts`, `relay-*.ts`, others | CLI, no UI | NA |
| `design/member-flows/server.ts:12` `escape` | Escape for copy save | EXT: low value, local |
| `design/member-flows/server.ts:14` server | Host, Origin, file allow list, stale check | NA: fs; local. Checks are correct |
| `design/member-flows/index.html` | Studio script | NA: DOM |
| `tools/clef-label/index.html:106` `hash32`, `:107` `mulberry` | Seeded stream | NA: bit operations are out of model |
| `:109` `key` | Unordered pair key | VIP after extraction: `key(a,b,d) === key(b,a,d)` |
| `:111,:112` `persist`, `restore` | Local storage | NA |
| `:114` `readyCheck`, `:120` folder | DOM | NA |
| `:130` `readJsonl` | Parse | NA: `await` |
| `:132` start | Setup, resume | EXT: flag replay is missing. Bug 3 |
| `:151` `dimFor`, `:152` `drawRaw` | Schedule | EXT: `a !== b` when `ids.length >= 2` |
| `:158` `draw` | Next pair | EXT: candidate 11 |
| `:175` `next`, `:186` `answer` | DOM plus state | EXT: state part of `answer` |
| `:194` `flag`, `:208` `undo` | Flag, undo | EXT: state part. Bug 3, bug 10 |
| `:214` `save`, `:225` keys | DOM | NA |
| `packages/notify/scripts/link-test-page.ts:29` `esc` | Weaker escape, static rows | NA: CLI |
| `packages/notify/src/links.ts:29` `assistantLink`, `:44` `assertSendableUrl`, `buttonPageLink`, `buttonPageButtons` | Link builders | EXT: `URL` to parts; host allow list. The `/t/<token>` page is not built |
| `packages/platform/src/apps.ts:142` `stagingSiteOrigins`, `:180` `appForHost` | Host to app | EXT: `appForHost` has no scheme input, the cause of item 14. Added by skeptic pass |
| `packages/platform/src/sessions.ts:26` `signupAccountView` | Hash | NA: crypto. Added by skeptic pass |
| `deploy/router.ts:41` `RUN_WORKER_FIRST` | Paths the Pages Function must see first | Data. Must cover `isBackendPath`. Candidate 6 can include it. Added by skeptic pass |
| `packages/notify/src/surface.ts:49` `resolveDelivery` | Delivery choice | VIP |
| `packages/blooio/src/phone.ts:14` `toE164`, `:36` `normalizeAddress` | Recipient keys | EXT: regex to digits |
| `packages/observatory/src/server.ts:123` `SECURITY_HEADERS` | API headers | NA: data. Other slice covers the server |

## 2. Journeys as state machines

### 2.1 OAuth consent (`handler.ts:355-544`)

States: `phone`, `code`, `consent`, `issued`, `closed`.

| From | Event | To | Line |
|---|---|---|---|
| start | no session, no Cloud | `phone` | `:412` |
| start | live session | `consent` | `:404` |
| start | Cloud required, no session | Cloud handoff, then `consent` at `/oauth/cloud-return` | `:406-410`, `:439` |
| `phone` | valid phone, send accepted | `code` | `:471` |
| `phone` | bad phone, Turnstile fail, rate limit | `phone` with error | `:461-469` |
| `code` | right code, not held | `consent`, site session | `:486` |
| `code` | wrong code | `code` with error | `:478` |
| `code` | right code, held or banned | `closed` | `:480-484` |
| `consent` | approve, session and owner match | `issued` (one-use take) | `:532` |
| `consent` | approve, session or owner changed | `closed` | `:499-505` |
| `consent` | approve, Cloud unavailable | `consent` with retry, 503 | `:509`, `:530` |
| `consent` | deny, or no `decision` | `closed`, redirect `access_denied` | `:518-520` |
| any open | cancel | `closed`, redirect `access_denied` | `:518-520` |
| any open | past `expiresAt` or wrong browser | error page | `:423` |

Invariants. All hold in the code as read:

1. A grant needs a verified phone: a code at `:478`, or a live session at `:404`.
2. A code is issued only on a `consent` POST with `decision=approve`. A missing `decision` denies.
3. The session must match the request's phone and person at approval (`:499`).
4. One request gives at most one grant. `takeConsentRequest` is atomic (`store.ts`, `pg-store.ts:109`).
5. The redirect target is a registered URI compared exactly (`:366`), and error redirects happen only after a person acts (`:371`).
6. Every POST needs `rid` plus the browser cookie (`:423`). The cookie is `SameSite=Lax`, so a cross-site form cannot complete a step.

**Broken in the browser, not in the state machine:** the `phone -> closed` and `code -> closed` redirect. See bug 1.

### 2.2 Phone confirm and code entry, with retry and lockout (`otp.ts`)

States per challenge: `live(attempts)`, `spent` (attempts at 5), `expired` (10 min), `consumed`.

| From | Event | To |
|---|---|---|
| none | `start` passes limits | `live(0)` |
| `live(n)` | wrong code | `live(n+1)`, or `spent` at 5 |
| `live(n)` | right code | `consumed` |
| `spent`, `expired`, `consumed` | any code | same state, `false` |
| any | new `start` | new `live(0)`; `latestChallenge` reads only the newest |

Limits: 3 sends an hour and 6 a day per number, 10 per IP, 30 s gap, 500 an hour in all. 10 checks per number and 30 per IP in an hour.

Invariants: at most one `true` per challenge, and no `true` after 5 claims. Candidate 4 proves this for a model. A malformed code does not spend an attempt (`otp.ts:199`).

**UX gap:** the OAuth code page shows no resend control. Back works. See bug 5.

### 2.3 Connected assistants (`handler.ts:660`)

States: `signed_out` (401 page), `list`, `list_with_notice`.

Invariant: a grant is revoked only if its `phoneKey` and app match the session (`:671`), and the POST has a same-site Origin or `sec-fetch-site: same-origin` (`:668`).

### 2.4 Cloud sign-in (`api.ts:402-453`)

States: `pending` (sealed cookie, 5 min), `callback`, `session` or `rejected`.

Invariants: `location` is only `/join` or `/oauth/cloud-return?rid=<22 chars>` (`:248-249`). `state` must match the sealed cookie (`:415`). Failures do not redirect. They answer JSON. See bug 7.

### 2.5 Clef labelling (staff)

States: `setup`, `labelling(pair)`, `flagged(photo)`, `done`.

| From | Event | To |
|---|---|---|
| `setup` | attest, rater id, 2+ photos | `labelling` |
| `labelling` | answer or skip | next pair |
| `labelling` | flag | remove photo from `ids`, next pair |
| `labelling` | undo | pop last line; screen does not change |
| any | end session | save, clear browser copy, `setup` |

Intended invariant, stated at `index.html:203`: a flagged photo is never shown again in the session. **It does not hold.** See bug 3.

## 3. Ranked candidates

"Proved" means `lsc check` passed with 0 errors on the trial file. It does not mean the shipping code is proved until the extraction lands. The skeptic pass ran each kept contract against a mutant, so the contract is known to fail for one real bug. Results and output lines are in section 7.

Order after the skeptic pass: 3, 1, 6, 11, 8, 10, 12, 2, 7. Rejected: 4, 5, 9.

### 1. OAuth flow reducer (effort M)

**Skeptic note.** The hand model below proved, but it has no person id and no Cloud authority. The stronger trial is `consentDecision`, a line-by-line transcription of `handler.ts:493-520`, with the awaited values as input fields. It proved. Removing the owner check from it fails the proof. Use that form first.

Extract the step logic of `authorizeStep` and `finishAuthorization` to a pure `step(flow, event)`. The handler keeps the `await`s and feeds results in as event fields. This is the top candidate because a violation is a grant the person did not approve.

```ts
export function step(f: Flow, e: Ev): Flow {
  //@ verify
  //@ ensures f.tag === "closed" ==> \result.tag === "closed"
  //@ ensures f.tag === "issued" ==> \result.tag === "issued" || \result.tag === "closed"
  //@ ensures \result.tag === "issued" && f.tag !== "issued" ==> f.tag === "consent" && e.tag === "approve" && !e.held && e.sessionPhone === f.phone && f.verified
  //@ ensures \result.tag === "consent" && f.tag !== "consent" ==> f.tag === "code" && e.tag === "enterCode" && e.ok && !e.held
  //@ ensures okState(f) ==> okState(\result)
}
export function issuedOnlyVerified(f: Flow, evs: Ev[]): boolean {
  //@ verify
  //@ requires okState(f)
  //@ ensures okState(run(f, evs))
  //@ ensures \result === true
}
```

- **Breaks if violated:** an agent gets a grant with no phone proof, or under another person's session.
- **Blockers:** `await`, `Response`. Workaround: effects stay in the shell, as event inputs.
- **Gap:** the trial's `Flow` and `Ev` types are a hand model. The signed-in start enters at `consent` with `verified: true`, and that entry stays unproved shell logic.
- **Trial:** proved (6 verified). Needs a small `.dfy` induction with `decreases |evs|`.

### 2. Redirect pick and redirect rule (effort S)

```ts
export function chooseRedirect(asked: string | undefined, registered: string[]): string | undefined {
  //@ verify
  //@ ensures \result !== undefined ==> registered.includes(\result)
  //@ ensures asked !== undefined && \result !== undefined ==> \result === asked
}
export function redirectPartsAllowed(u: UriParts): boolean {
  //@ verify
  //@ ensures \result ==> u.username === "" && u.password === "" && u.hash === "" && !u.hasStar
  //@ ensures \result ==> u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname))
  //@ ensures \result && u.protocol === "https:" ==> u.hostname !== ""
}
```

- **Breaks if violated:** an auth code goes to an address the client did not register (`:366`), or to plain http.
- **Blockers:** `URL`. Workaround: the shell parses, the core takes the parts. The parse itself stays trusted.
- **Skeptic note:** keep `chooseRedirect`. Drop `redirectPartsAllowed`, because its `ensures` repeat the body and item 15 shows the trust is in `new URL`.
- **Trial:** `chooseRedirect` proved (2 verified, with one more `ensures`). Removing `includes` failed the proof.

### 3. `esc` (effort S)

**Skeptic note.** The contract below is too weak. It says nothing about `&`. A mutant with no `&` branch still proved (2 verified), and that mutant double-decodes `&lt;`. The stronger contract is `unesc(esc(s)) === s` on a recursive form, plus the old character bar. It proved with one added `.dfy` lemma, so the gap below is closed and the effort is S, not M.

Replace the regex with a recursive form or a char loop. The same function must then ship.

```ts
export function esc(s: string): string {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> \result.charCodeAt(k) !== 60 && \result.charCodeAt(k) !== 62 && \result.charCodeAt(k) !== 34 && \result.charCodeAt(k) !== 39)
}
```

- **Breaks if violated:** a client name or redirect host injects markup into the consent page. The CSP limits the damage, but the page could lie about who asks for access.
- **Blockers:** regex `.replace`. Workaround: loop over `charCodeAt`.
- **Gap:** closed by the round-trip contract. `unesc` is a spec helper, not an HTML parser.
- **Trial:** weak contract proved (2 verified), and it does not catch the `&` mutant. Round trip proved (4 verified).

### 4. OTP attempts (effort M): rejected

**Skeptic note.** Rejected. The attempt and one-use rules are the `where` clauses of two SQL updates (`pg-store.ts:204-212`). `verify` only calls them. This trial proves a hand model of that SQL, so it restates the SQL and cannot see a fault in it. Use a Postgres integration test with a race.

```ts
export function tryCode(c: Ch, max: number, t: Try): Out {
  //@ verify
  //@ requires c.attempts >= 0
  //@ requires max >= 0
  //@ ensures \result.ch.attempts >= c.attempts
  //@ ensures c.attempts <= max ==> \result.ch.attempts <= max
  //@ ensures \result.pass ==> live(c, max, t.at) && t.right && \result.ch.consumed
  //@ ensures c.consumed ==> \result.ch.consumed && !\result.pass
}
export function atMostOne(c: Ch, max: number, ts: Try[]): boolean {
  //@ verify
  //@ requires c.attempts >= 0
  //@ requires max >= 0
  //@ ensures passes(c, max, ts) <= 1
  //@ ensures c.consumed ==> passes(c, max, ts) === 0
  //@ ensures \result === true
}
```

- **Breaks if violated:** brute force past 5 tries, or one code opens two sessions.
- **Blockers:** the atomic SQL in `claimAttempt`. Workaround: model it. The SQL stays trusted, and an integration test must cover the race.
- **Trial:** proved (5 verified). Model only.

### 5. Origin gate (effort S): rejected

**Skeptic note.** Rejected. Each `ensures` repeats the body. The value is one shared gate, which is a refactor and needs no proof. Fix item 14 with a scheme check and a test.

```ts
export function originOk(origin: string | undefined, issuer: string, extra: string[], ownHttpsHost: boolean, fetchSite: string | undefined): boolean {
  //@ verify
  //@ ensures \result && origin === "null" ==> fetchSite === "same-origin" || issuer === "null" || extra.includes("null") || ownHttpsHost
  //@ ensures \result && origin !== undefined && origin !== "null" ==> origin === issuer || extra.includes(origin) || ownHttpsHost
}
export function strictOriginOk(origin: string | undefined, issuer: string, extra: string[], ownHttpsHost: boolean, fetchSite: string | undefined): boolean {
  //@ verify
  //@ ensures \result && origin === undefined ==> fetchSite === "same-origin"
}
```

- **Breaks if violated:** a cross-site form removes an assistant's access, or a foreign page calls `/mcp`.
- **Blockers:** `URL`, `hostMap`. Workaround: `ownHttpsHost` is an input.
- **Note:** the `api.ts` copies differ. See 5.1.
- **Trial:** proved (2 verified).

### 6. Route coverage (effort S)

```ts
export function ownedReachesBackend(p: string): boolean {
  //@ verify
  //@ ensures owned(p) ==> isBackendPath(p)
  //@ ensures \result === true
}
export function retiredNotBackend(p: string): boolean {
  //@ verify
  //@ ensures retired(p) ==> !isBackendPath(p)
  //@ ensures \result === true
}
```

- **Breaks if violated:** an OAuth path falls to static assets and returns a 404, or a retired page shadows a backend route.
- **Blockers:** the two predicates are in separate packages. Workaround: a verify file imports both, or one shared module.
- **Trial:** `ownedReachesBackend` proved (3 verified) on exact copies, with no proof additions. A mutant that narrows `/.well-known/oauth-` failed, so the contract catches a real routing fault. The second lemma, `retiredNotBackend`, proved in the first pass.
- **Related contract that fails today:** `joinPath(app)` must not be a retired path. It failed (0 verified, 1 error), which is bug 4 as a proof obligation.

### 7. Same-site path gate (effort S)

**Skeptic note.** Low value. No caller passes an unsafe path today. The contract is close to the loop body.

One gate for `pages.ts:89` and `api.ts:248`.

```ts
export function isSameSitePath(p: string): boolean {
  //@ verify
  //@ ensures \result ==> p.length >= 2 && p.charCodeAt(0) === 47 && p.charCodeAt(1) !== 47 && p.charCodeAt(1) !== 92
  //@ ensures \result ==> forall(k: nat, k < p.length ==> p.charCodeAt(k) !== 92 && p.charCodeAt(k) > 32)
}
```

- **Breaks if violated:** "Try again" sends a person off site. See bug 8.
- **Blockers:** none for the loop form.
- **Trial:** fixed gate proved (2 verified). The current `startsWith` gate failed the backslash property, as expected.

### 8. Phone rule (effort M)

```ts
export function normalizeDigits(d: string, plus: boolean): string | undefined {
  //@ verify
  //@ ensures \result !== undefined ==> \result.length === 12 && \result.startsWith("+1")
  //@ ensures \result !== undefined ==> usOrCanadaArea(\result.slice(2, 5))
}
```

- **Breaks if violated:** SMS pumping to premium ranges, or one person gets two identities.
- **Blockers:** regex at every step, `Set` of area codes. Workaround: digit loop, `string[]` table.
- **Trial:** proved (7 verified), and idempotence `normalize(normalize(x)) === normalize(x)` proved (14 verified with four `.dfy` lemmas). `api.ts:434` depends on idempotence. Removing the country-code refusal failed the proof. Model limits: ASCII input, `\s` as space and tab, the area table as a parameter.

### 9. Token state (effort M): rejected

**Skeptic note.** Rejected. The contract repeats the branch order at `handler.ts:574-581`. The real risk is the re-check of time between `await`s and the atomic `takeCode`, which this model does not hold. Not run.

```ts
export function codeDecision(usedAt: number | undefined, expiresAt: number, at: number, grantLive: boolean): CodeResult {
  //@ verify
  //@ ensures \result === "replay" <==> usedAt !== undefined
  //@ ensures \result === "ok" ==> usedAt === undefined && expiresAt > at && grantLive
}
```

- **Breaks if violated:** a replayed code gets tokens instead of revoking the grant.
- **Blockers:** many `await`s with re-checks of time between them. Workaround: check the last decision only.
- **Trial:** not run.

### 10. Age rule (effort S)

```ts
export function joinAgeCheckInt(stated: number, lowest: number | undefined, minJoin: number): AgeResult {
  //@ verify
  //@ requires 0 <= stated && stated <= 120
  //@ ensures \result.ok ==> \result.effective >= minJoin && \result.effective <= stated
  //@ ensures \result.ok && lowest !== undefined ==> \result.effective <= lowest
}
```

- **Breaks if violated:** a person who said 15 joins by saying 25.
- **Blockers:** `unknown` inputs, `typeof`. NaN and fractions are out of the model, so `validAge` stays trusted. Workaround: split the guard from the int core.
- **Trial:** proved (1 verified) on a copy with `validAge` inline. The trial adds: a valid stored age below the app's minimum refuses the join. A mutant that ignores the stored age failed with 2 errors.

### 11. Clef flagged photo (effort S)

```ts
export function planNext(plan: Pair[], start: number, flagged: string[]): number {
  //@ verify
  //@ requires 0 <= start
  //@ ensures \result >= plan.length || (\result >= 0 && !hasFlag(plan[\result], flagged))
}
export function repeatPool(history: Pair[], flagged: string[]): Pair[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> !hasFlag(\result[k], flagged))
}
```

- **Breaks if violated:** a photo flagged "may be under 18" is shown again. See bug 3.
- **Blockers:** the tool is one inline script with DOM code. Workaround: the file must stay self-contained (no network, `script-src 'unsafe-inline'`), so inline a build of the pure part, or keep a tested copy.
- **Trial:** the fixed logic proved (8 verified). This now covers the resume path too: `flagsOf` and `resumeIds`. A mutant with the filter removed from `repeatPool` failed. The current plan logic failed in the first pass, with 2 errors. `array.filter` with a helper gave "multi-statement lambda in Dafny", so the trial uses a loop.

### 12. CSP form targets (effort S, after bug 1 and item 15)

```ts
export function formAction(targets: string[]): string[] {
  //@ verify
  //@ ensures forall(k: nat, k < \result.length ==> clean(\result[k]))
}
```

- **Breaks if violated:** a registered client adds a delimiter to the consent page's CSP header. See item 15.
- **Blockers:** whether the redirect origin is in `form-action` is browser behaviour, which no proof covers. Use a browser e2e case for bug 1.
- **Trial:** fixed filter proved (5 verified). The current form, with no filter, failed at the loop invariant.

### Skip

`resolveConsent` and `publicStatus` are easy, but other slices own them. Regex-based leak and keyword logic is out of the subset.

## 4. Confirmed bugs

Reproduced means I ran the code. The scripts are `bugs1.ts`, `bugs2.ts`, `bugs3.ts`, `clef.ts`, `real-cancel.ts` in the trials folder.

### 4.1 Bug 1 (high): Cancel on the phone and code pages does nothing in Chrome

- **Where:** `packages/mcp/src/pages.ts:54`, `:55`, `:67`; `handler.ts:520`.
- **Cause:** only `consentPage` adds the redirect origin to `form-action`. Cancel answers 303 to the client's origin. Chromium applies `form-action` to redirects of a form POST.
- **Input:** the real handler and `pages.ts` on loopback, in Chrome/152.0.7977.167 (the app's browser pane). Open `/oauth/authorize`, click Cancel.
- **Result:** the server returned `303 location=http://127.0.0.1:5299/callback?error=access_denied...`. It also deleted the request and wrote `consent_denied`. The browser stayed on "Confirm your phone number". The console showed a `form-action 'self'` violation.
- **Effect:** the client never hears the denial. The page looks live, but the request is gone, so the next submit gives "This page has expired".
- **Control:** a replica page with the callback origin in `form-action` reached the callback.
- **Skeptic pass:** repeated on the real handler in Chrome/152.0.7977.167. The server log showed `POST /oauth/authorize/cancel -> 303`, requests fell from 2 to 1, and audit added `consent_denied`. The page stayed on "Confirm your phone number". The console said `form-action 'self'` blocked the request. **Reproduced.**
- **Not tested:** Firefox and Safari. Tests miss this because they read the HTTP answer only (`packages/mcp/test/oauth.test.ts:133`).
- **Fix:** pass `redirectOrigin` to `phonePage` and `codePage`.

### 4.2 Bug 2 (high): a banned number gets a code and a session from the web API

- **Where:** `packages/platform/src/api.ts:471`, `:485-491`. The MCP path has the check at `packages/mcp/src/hooks.ts:159` and `:168`.
- **Rule:** founder decision 3 (2026-10-09): a banned number is refused at OTP.
- **Input:** a person with a phone ban (`banned()` returned `true`), then `POST /api/auth/otp/start` and `POST /api/auth/otp/verify`.
- **Result:** start returned `200 {"ok":true}` and the provider got the number. Verify returned `200` with a session cookie.
- **Effect:** a text goes to a banned number. Staff-banned harassers keep a session. `join` still refuses at `accounts.ts:235`, so no new membership results. The skeptic pass also ran `GET /api/me` (200) and `GET /api/me/export` (200) with that cookie. Both worked and showed the existing member's data.
- **Reach:** any app where `cloud` is off (`api.ts:463`). The Cloud callback has the ban check (`api.ts:437`), so only the OTP path lacks it. Agents use this path through SKILL.md.
- **Coverage:** `scripts/sim/safety.ts:271` checks the hook path only.

### 4.3 Bug 3 (high for a local tool): a flagged photo comes back

- **Where:** `tools/clef-label/index.html:143`, `:158-163`, `:203-204`.
- **Cause:** `flag()` removes the photo from `ids` only. Three paths do not read `ids`.
- **Plan:** a plan of `p0/p1`, `p0/p2`. Flag `p0`. The next pair was `p0.jpg p2.jpg`.
- **Repeat:** `history` keeps the photo. Over 300 seeded runs with 30 photos, the flagged photo returned within 60 answers in 27 runs. For example, seed 22 showed `q2.jpg` after 4 answers, with `repeat=true`.
- **Resume:** restored labels hold the flag line, but `:143` reads only `l.a`. `ids` still had `p0.jpg` after resume.
- **Effect:** a rater sees a photo marked "may be under 18" again, and can label it. The fitter drops those labels, so the harm is in the display, not the fit.

### 4.4 Bug 4 (medium): MCP sends people to a retired page

- **Where:** `packages/mcp/src/tools.ts:203`, `:206-207`, `:224-225`, `:267`, `:270`, `:290`; `deploy/router.ts:46-48`.
- **Input:** `GET https://friends.help/join?via=agent`, and the same for `slop.date` and `ntwrk.party`.
- **Result:** `302 location: /` on all three. The query is lost. `peon.biz` answered 200.
- **Effect:** `start_signup` says "Open .../join?via=agent yourself and enter your own phone number". The person lands on the home page with no form. A `prepare_signup` draft for friends or ntwrk has no review page.
- **Coverage:** each side has a passing test that pins its half (`packages/mcp/test/mcp.test.ts:32`, `deploy/router.test.ts:246`).

### 4.5 Bug 5 (low, downgraded): the OAuth code page shows no resend

- **Where:** `handler.ts:478`, `pages.ts:58-68`.
- **Input:** five wrong codes, then the right code.
- **Result:** `400`, "That code did not work. Check the newest text and try again." The page has only the forms `/oauth/authorize/code` and `/oauth/authorize/cancel`.
- **Correction:** the first pass said there is no way out. That is wrong. `authorizeStep` accepts the phone POST in step `code` (`handler.ts:457` refuses only step `consent`). After 31 s a second phone POST with the same `rid` gave `200 Enter your code` and a new send, and the new code reached the consent page. Browser Back also reloads `/oauth/authorize`, because the pages are `no-store`, and that gives a new phone page.
- **Effect:** the person must think of Back. The text says to try again, which fails. With bug 1, Cancel also does nothing in Chrome. `sites/shared/auth.ts:128` has a resend; this page does not.

### 4.6 Bug 6 (low): malformed input gives a 500

- **Cookie:** `packages/mcp/src/hooks.ts:118` has no `try`. `GET /oauth/authorize` with `cookie: sid_peon=%E0%A4%A` returned `500 {"error":"server_error"}` where a clean page is expected. `util.ts:59` and `api.ts:123` both catch this.
- **Basic auth:** `handler.ts:333`. `Authorization: Basic ` of `%E0:x` on `/oauth/token` returned 500, not 401. No sign-in is needed, so anyone can add 500 lines to the log.

### 4.7 Bug 7 (low): a person sees raw JSON

- **Callback:** `api.ts:413`. A top-level `GET /api/auth/cloud/callback?state=x&code=y` with no pending cookie returned `400 {"ok":false,"error":"cloud_auth_unavailable"}`. A person who waits past 5 minutes at the Cloud sign-in sees this. In OAuth mode the return path is lost as well.
- **Form paths:** `GET /oauth/authorize/code` returned `405 {"error":"method_not_allowed"}`. Pressing Enter in the address bar reaches this.

### 4.8 Bug 8 (latent, low): the retry gate allows a backslash

- **Where:** `pages.ts:89`.
- **Input:** `messagePage(app, "t", "x", 503, "/\\evil.example")`, and the same with a tab after the first slash.
- **Result:** the link rendered, and it resolves to `https://evil.example/`.
- **Reach:** none today. The two callers (`handler.ts:392`, `:437`) pass fixed or validated paths. Candidate 7 closes it.

### 4.9 Bug 9 (latent): a CIMD client works on one site only

- **Where:** `handler.ts:284-288`, `:340`, `:362`.
- **Input:** one https `client_id` on `peon.biz`, then on `friends.help`, with `cimdFetch` set.
- **Result:** peon gave the phone page. friends gave "The assistant is not registered on this site."
- **Cause:** a client row holds one `app`. A refetch after 24 hours would move it.
- **Reach:** none in production. `packages/network/service/serve.ts:76` does not pass `cimdFetch`.

### 4.10 Lower items

| # | Where | Finding | Status |
|---|---|---|---|
| 10 | `tools/clef-label/index.html:208-212` | `undo` says "the pair is not shown again", but it deletes the pair from `done` and leaves it in `history`, so the pair can return. Undoing a repeat line frees the first answer's pair too. Undoing a flag removes the line that makes the fitter drop the photo | State reproduced: after undo `done` lacks the pair, `history` has 1 row, the note still says not shown again (`undo.ts`) |
| 11 | `handler.ts:389` | A second `/oauth/authorize` in the same browser overwrites the cookie. The first tab then gets "This page has expired" | Reproduced |
| 12 | `design/member-flows/server.ts:70` | The studio opens on slop + Join. Only `peon.biz` has `join.html`, so the first preview is 404 on three sites | Read, not run |
| 13 | `design/member-flows/README.md:23` | Says "There is no permission screen". `handler.ts:486-487` shows one. The studio has no consent preview (`server.ts:57`), so reviewers cannot see the real screen | Read |
| 14 | `api.ts:378` | Accepts `Origin: http://<site>`. The MCP rule (`handler.ts:227`) needs https. Same host, plain scheme | Reproduced on a dev host |
| 15 | `pages.ts:17`, `handler.ts:405`, `:123` | The redirect origin goes into the CSP header unchecked. `redirectUriAllowed` accepts `https://x;sandbox;y.example/cb`, `https://a,b.example/cb` and `https://a'b.example/cb`, because the URL parser allows these in a host. The header then has `form-action 'self' https://x;sandbox;y.example;`. No space can enter, so an added directive has no value. Directives after `script-src` cannot replace earlier ones. A comma adds a second policy, which can only restrict. Only the client's own consent page suffers. Hygiene, no exploit found | Reproduced (`skeptic.ts`) |

### 4.11 Checked and refuted

- **Stale SMS link:** `packages/notify/src/compose.ts:26` builds `ntwrk.party/t/<token>`, and that path returns 404. But `packages/network/service/service.ts:657` always sets `channel: "imessage"`, so `button_page` is not reached in the service. The README lists the page as not built. Not a live bug.
- **XSS in `pages.ts`:** every client value in the HTML goes through `esc`. `BRAND_MARKS` is static. The CSP header is a different context: item 15.
- **Open redirect through `redirect_uri`:** exact match, and errors render a page.
- **CSRF on OAuth steps:** `rid`, a bound cookie and `SameSite=Lax`.
- **Photo headers:** type comes from sniffed bytes, with `nosniff` and `default-src 'none'`.
- **Dev server path traversal in `scripts/sites-dev.ts`:** the check is correct.

## 5. Rules duplicated between browser and server

### 5.1 Table

| Rule | Browser or copy | Server | Difference |
|---|---|---|---|
| Phone | `sites/shared/api.ts:167` `toE164` | `packages/platform/src/phone.ts:5` `normalizePhone` | Browser strips letters and ignores `+`. Run on both: `+1 800 555 0142`, `(876) 555-0142`, `212 911 0142` and `+2125550142` pass the browser and fail the server with `invalid_phone`. Only the first three are plain US-style input |
| Phone (recipient keys) | none | `packages/blooio/src/phone.ts:14` | Accepts any country, NFKC, `00`. Different purpose; the name is the same as the browser's |
| Mask | `sites/shared/auth.ts:13` | `phone.ts:36` | Format differs, last 4 same |
| Code shape | `sites/shared/auth.ts:111` 4 to 8, strips non-digits; `pages.ts:64` `maxlength=10`, `pattern=[0-9]*` | `otp.ts:199` and `api.ts:611` 4 to 10; `handler.ts:477` strips spaces; `api.ts:484` trims only | A 9 or 10 digit Twilio code fails in the browser. `"123 456"` passes MCP and fails API. `pattern` makes the MCP strip unreachable from a browser |
| Age range | `sites/shared/join.ts:135` 1 to 120, integer; `sites/peon.biz/public/join.html:14` `data-min-age="13"` | `packages/core/src/policy.ts:15` `validAge` 0 to 120; `accounts.ts:87` integer; `age.ts:14` | Browser refuses 0, server answers `under_age`. Harmless |
| Join age shown | `sites/peon.biz/public/join.html:52` static 13 | `packages/platform/src/apps.ts:70-85`, `packages/mcp/src/apps.ts:38` | Static text until `/api/app` fills it |
| Keyword | `sites/agents.ts:46` `keywordFor`: ntwrk is "network" | `apps.ts:97` `keywordApp`; `APP_KEYWORDS` `:92`; `packages/mcp/src/apps.ts:52` keyword `null` | `network` works in `keywordApp` but is not in `APP_KEYWORDS`, so `/api/app` `keywords` (`apps.ts:188`) omits the word the site tells people to send |
| Retired signup apps | `deploy/router.ts:46` ntwrk, slop, friends | `api.ts:140`; `handler.ts:892` ntwrk, friends | Three lists. Bug 4 comes from a missing fourth: `tools.ts` |
| Origin check | `handler.ts:222` | `api.ts:341`, `:360`, `:378` | See item 14. Three copies inside `api.ts` |
| Cookie parse | `packages/mcp/src/util.ts:55` first wins | `hooks.ts:115` throws; `api.ts:117` last wins | Bug 6 |
| HTML escape | `sites/agents.ts:56` no `>`, `'`; `link-test-page.ts:29` no `>`, `'`; `design/member-flows/server.ts:12` no `'` | `packages/mcp/src/util.ts:28` | Output contexts differ; all are safe for their use |
| Constant-time compare | `packages/mcp/src/util.ts:8` | `phone.ts:46`, `proxy.ts:42` | Same behaviour |
| Loopback | `packages/mcp/src/util.ts:65` | `api.ts:149` no `::1` | Boot rule only |

### 5.2 Suggested order of work

1. Fix bug 1 and bug 2. Neither needs LemmaScript. Add e2e cases that fail first. Bug 1 needs a real browser.
2. Fix bug 3, then land candidate 11.
3. Land candidates 3 and 6, then 8 and 10. All are S or M effort and proved in trial.
4. Extract `consentDecision` (candidate 1). It has the most value and needs care in `handler.ts`.

## 6. Trial index

See section 7. First-pass files remain in `frontend-server-ui/`. `safe-path` and the second half of `route-cover` were not repeated in the skeptic pass.

Toolchain notes: `ensures` gives a separate lemma, so an induction needs `.dfy` additions. A `const` arrow helper did not work inside a lambda. `lsc check` warns when a proof file is out of date; delete it and regenerate only before any proof additions exist.

## 7. Verification

Skeptic pass on the same commit, a0ed7bc. Scripts are in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/server-ui/`, except `real-cancel.ts`, the `bugs*.ts` files and `clef.ts`, which are in `frontend-server-ui/`.

### 7.1 Bug checks

| Finding | Command | Outcome |
|---|---|---|
| Bug 1 | `real-cancel.ts`, then a click in the app browser pane, Chrome/152 | Reproduced |
| Bug 2 | `bun run bugs1.ts`, `bun run skeptic.ts` | Reproduced. New: `/api/me` and `/api/me/export` work |
| Bug 3 | `bun run clef.ts` | Reproduced: 27 of 300 runs, plan and resume paths |
| Bug 4 | `bun run bugs1.ts` | Reproduced: 302 on three sites, peon 200. Line refs checked: `sites/peon.biz/public/join.html` is the only join page |
| Bug 5 | `bun run bugs2.ts`, `bun run skeptic.ts` | Partly refuted, downgraded to low |
| Bug 6 | `bun run bugs1.ts` | Reproduced: both 500 |
| Bug 7 | `bun run bugs2.ts`, `bun run bugs3.ts` | Reproduced |
| Bug 8 | `bun run bugs1.ts` | Reproduced, unreachable today |
| Bug 9 | `bun run bugs2.ts` | Reproduced. `serve.ts:76` passes no `cimdFetch` |
| Items 10, 11, 14 | `undo.ts`, `bugs2.ts`, `bugs3.ts` | Reproduced |
| Items 12, 13 | Read | Hold: `find sites -name join.html` gives one file; README line 23 conflicts with `handler.ts:486` |
| Item 15 | `bun run skeptic.ts` | New, reproduced |
| Phone rows in 5.1 | `bun run skeptic.ts` | Reproduced |

Not done: Firefox and Safari for bug 1. Whether production has the Cloud flags set.

### 7.2 Completeness

Added to the inventory: `grantStillTheirs`, `invitationGuidance`, `devHostMap`, `ASSISTANT_REDIRECT_HOSTS`, the three unavailable helpers by name, `buttonPageLink`, `buttonPageButtons`, `appForHost`, `stagingSiteOrigins`, `signupAccountView`, `RUN_WORKER_FIRST`. No new HTML page was found. `git grep` did not time out in this pass.

### 7.3 Proof trials

Command for each row: `scratchpad/bin/lsc check --backend=dafny <file>`. One run at a time.

| Candidate | File | Contract says | Outcome | Mutant | Mutant outcome |
|---|---|---|---|---|---|
| 1 | `consent-decision.verify.ts` | `finish` needs approve, consent step, session, owner, eligibility and Cloud authority match; no approve is denied | Proved: `1 verified, 0 errors` | Owner check removed | Failed: `0 verified, 1 error` |
| 2 | `redirect-pick.verify.ts` | Result is registered; equals the asked value; none when ambiguous | Proved: `2 verified, 0 errors` | `includes` removed | Failed: `1 verified, 1 error` |
| 3 | `esc-roundtrip.verify.ts` + `.dfy` lemma | `unesc(esc(s)) === s` | Proved: `4 verified, 0 errors` | Old contract, no `&` branch | Weak contract still passed: `2 verified, 0 errors` |
| 6 | `routes.verify.ts` | `owned(p) ==> isBackendPath(p)` | Proved: `3 verified, 0 errors` | Backend prefix narrowed | Failed: `2 verified, 1 error` |
| 6, bug 4 | `signup-link.verify.ts` | The join link is not a retired path | Failed as expected: `0 verified, 1 error` | None | The code is the bug |
| 8 | `phone.verify.ts` + `.dfy` lemmas | Shape, area rules, `+` needs country 1, idempotent | Proved: `14 verified, 0 errors` | Country check removed | Failed: `6 verified, 1 error` |
| 10 | `age-join.verify.ts` | Join needs stated and stored age at the minimum; effective is the lowest | Proved: `1 verified, 0 errors` | Stored age ignored | Failed: `0 verified, 2 errors` |
| 11 | `clef-flag.verify.ts` | Plan, repeat and resume skip flagged photos | Proved: `8 verified, 0 errors` | Repeat filter removed | Failed: `7 verified, 1 error` |
| 12 | `csp-target.verify.ts` | Every form target has no CSP delimiter | Proved: `5 verified, 0 errors` | `csp-target-current.verify.ts`, today's form | Failed: `4 verified, 1 error` |

Limits: all are copies or rewrites. Candidate 1 trusts the shell to feed true field values. Candidate 8 models ASCII only. `charCodeAt` past the end is NaN in JavaScript and out of range in Dafny, so the proof forced a length guard before the index reads.

### 7.4 Rejected

Candidates 4, 5 and 9, for the reasons in section 3. `redirectPartsAllowed` from candidate 2 is also dropped: its `ensures` repeat the body, and the real trust is in `new URL`, as item 15 shows.

### 7.5 Corrections to the first pass

- Bug 5 was overstated.
- Candidate 3's contract missed `&`.
- The statement that escaping and redirect checks are sound did not cover the CSP header.
- The resend line reference was off by one: `sites/shared/auth.ts:128`, not `:129`.
- `git grep` did not time out in this pass, so it is the search of record now.
- The reach of bugs 1, 2 and 5 depends on Cloud flags, which the first pass did not say for bugs 1 and 5.
