# State machines: MCP OAuth, agent signup, inbox and output gate

Key: `mcp-oauth`. Source: branch `claude/quint-state-machines`, head `a0ed7bc`, read on 2026-11-07.
Scope: `packages/mcp` (all source, SQL and tests) and the site SKILL signup flow.
Hand-written from reading the code. No file was changed other than this report.
Files under `packages/mcp` and the SKILL files were read in full. `packages/platform`, `packages/network/service`, `packages/notify` and `deploy` were read only at the paths that connect to this scope.
No service was called. Two local probes ran `outputLeaks` from `packages/mcp/src/leaks.ts`.
No test suite ran, so no defect below has a failing test yet.

Path short names: `H` = `packages/mcp/src/handler.ts`, `T` = `packages/mcp/src/tools.ts`,
`S` = `packages/mcp/src/store.ts`, `P` = `packages/mcp/src/pg-store.ts`,
`K` = `packages/mcp/src/hooks.ts`, `Q` = `packages/mcp/db/oauth.sql`,
`API` = `packages/platform/src/api.ts`, `ACC` = `packages/platform/src/accounts.ts`,
`SVC` = `packages/network/service/service.ts`.

## 1. Summary

### Machines

| Id | Kind | Priority | State lives in |
|---|---|---|---|
| `oauth-auth-request` | explicit | P0 | `oauth.auth_requests.step`, row presence, `expires_at`, cookie `mcp_auth` |
| `oauth-grant` | implicit | P0 | `oauth.grants.revoked_at`, `expires_at`, `person_id`, row presence |
| `oauth-code` | implicit | P0 | `oauth.codes.used_at`, `expires_at`, row presence |
| `oauth-token-family` | implicit | P0 | `oauth.tokens.kind`, `rotated_at`, `revoked_at`, `expires_at` |
| `cloud-grant-authority` | implicit | P0 | `oauth.grants.cloud_authority`, id prefix `grant_cloud_`, external Cloud status |
| `mcp-request-gate` | implicit | P0 | One pipeline per request; reads grant, token, client, person, config |
| `openai-surface-gate` | implicit | P0 | `oauth.clients.surface`, redirect hosts, env flags |
| `grant-owner-binding` | implicit | P0 | `grants.person_id`, `grants.phone_key`, phone identity, hold, ban |
| `signup-draft` | implicit | P0 | `oauth.signup_drafts`, age-guard advisory lock |
| `skill-signup` | implicit | P0 | Agent conversation, agent cookie jar, `platform.sessions`, membership |
| `output-leak-gate` | implicit | P0 | Stateless filter after `inbox.seenAt` was written |
| `inbox-read-seen` | implicit | P1 | `notify` item `seenAt`, surface `lastUsedAt` |
| `assistant-surface-signal` | implicit | P1 | `notify` signal `active` per person and surface |
| `submit-profile-intake` | implicit | P1 | Rate bucket, membership state, network message row |
| `oauth-client-lifecycle` | implicit | P1 | `oauth.clients` row, `kind`, `created_at`, grants existence |
| `oauth-forget-revoke` | implicit | P1 | Platform forget hook and `revokeAllFor` |
| `oauth-phone-move` | implicit | P1 | `platform.movePhone` writing `oauth.grants.phone_key` |
| `oauth-sweep-retention` | implicit | P1 | `lastSweep`, TTL columns |
| `oauth-rate-window` | implicit | P2 | `oauth.rate_limits` |
| `oauth-audit-log` | implicit | P2 | `oauth.audit` append-only |

### Defects, most severe first

| Id | Title | Pri | Confidence |
|---|---|---|---|
| D1 | A ban does not end existing grants; banned people keep `get_updates` and refresh | P0 | High |
| D2 | `/api/auth/otp/start` and `/verify` have no ban check, so the SKILL path sends a code to a banned number | P0 | High |
| D3 | The SKILL flow and the MCP contract state opposite rules about phone and code | P0 | High (the conflict); founder must decide which wins |
| D4 | The output gate misses 7-digit phones and the id formats that the repo mints | P0 | High (the gap); impact unknown |
| D5 | `update oauth.grants set phone_key` in `movePhone` hits the immutable trigger on any Cloud grant row and fails the number change | P1 | High (by reading; not run) |
| D6 | Tools and text still send people to `/join?via=agent`, which redirects to `/` on ntwrk, slop and friends | P1 | High |
| D7 | The signup-draft claim has no caller: `prepare_signup` writes data nobody can read | P1 | High |
| D8 | An update withheld by the leak gate is already marked seen and is lost on every surface | P1 | High |
| D9 | Code consumption and token mint are not atomic; a retry after a failure revokes the grant | P1 | High |
| D10 | `rotateRefresh` false means several things; the handler treats all as replay | P1 | High |
| D11 | The `active` assistant signal is wrong in four ways | P1 | High |
| D12 | "Delete everything" leaves grants of apps with no live membership; listener failures are swallowed | P1 | High |
| D13 | Legacy phone grants skip all Cloud, hold, ban and suppression checks after cutover | P1 | Medium (by design; needs a decision) |
| D14 | `updateAuthRequest` is an unguarded read-modify-write; a mixed-identity request is reachable | P2 | High (state); no exploit found in production |
| D15 | Consent to code is not atomic; an orphan live grant can exist | P2 | High |
| D16 | Sweep deletes a DCR client once it has no grants; a client's cached id then fails | P2 | Medium |
| D17 | CIMD is dead in production, and its upsert leaves the row and the object disagreeing | P2 | High |
| D18 | One draft per grant plus a 10-minute expiry gives a stuck grant | P2 | High |
| D19 | Retention and comment claims do not match the code | P2 | High |
| D20 | Revocation by a tool call writes no audit row; a hold revokes for good | P2 | High |
| D21 | The profile quota counts attempts, is shared and is per grant only | P2 | High |
| D22 | MemoryOAuthStore differs from PgOAuthStore in safety-relevant ways | P2 | High |
| D23 | Small state notes: deny after approve, `LIKE` wildcard, unused `apps:read`, registered metadata not stored | P2 | High |

Known limit, not a new defect: a lost HTTP response after a refresh commit, or two concurrent refreshes
from one client, ends the whole grant (see `docs/results/2026-10-13-oauth-refresh-atomic.md`).
This is a liveness cost of strict rotation. Model it so that the trade-off stays visible.

## 2. Rules that apply

- AGENTS founder 2026-10-09 #3: a banned number is refused at join (web, text, MCP), OTP and inbound, on every app.
- AGENTS decision 1 and code invariants: minors are never matched. Age uses the lowest stated value.
- AGENTS decision 10: the agent never sees the code; the person confirms the phone with one link.
- AGENTS founder correction 2026-10-19: no Sign in, settings or dashboard pages. Phone confirmation and connector authorization remain for signup and agent access. Backend privacy controls and OAuth consent stay.
- AGENTS code invariant: every outbound message goes through the leak check; the MCP server withholds an inbox update that fails its output gate.
- AGENTS decision 7: STOP stops every app; leave stops one.
- `packages/mcp/README.md` section 3: PKCE S256, rotation, a reused code or refresh ends the grant, a grant lasts at most 90 days, new owner kills the grant.

## 3. Machine: `oauth-auth-request`

Kind: explicit. Row in `oauth.auth_requests` (Q:18-33). `step in ('phone','code','consent')` (Q:30).
Memory form: `MemoryOAuthStore.requests` (S:167). Bound to one browser by `sha256(cookie)` in `browser_hash`.

States: `none`, `phone`, `code`, `consent`, `ended` (row deleted). Implied: `expired` (row present, `expires_at<=now`, until sweep).
Sub-state on `consent`: `e164` not null; `person_id` may be null. `requestMs` = 15 minutes (H:73).

Transitions:

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| none | GET `/oauth/authorize` | no duplicate params; IP limit; client on this app; not `openAiUnavailable`; registered redirect; `response_type=code`; S256; valid scopes; resource | insert row; set cookie | phone | H:355-388 | client via browser |
| phone | same GET, session valid | session is a person; `customSlopEligible` | `e164`, `personId` set | consent | H:398-405 | browser |
| phone | same GET, session valid, not eligible | | delete row; 403 | ended | H:399-401 | browser |
| phone | same GET, no session, cloud required | handoff built | 302 to Cloud | phone | H:406-410 | browser |
| phone | same GET, no handoff | | delete row; 503 | ended | H:407-408 | browser |
| phone | same GET, session `unavailable` | | 503 with retry to cloud-return | phone | H:391-394 | Cloud |
| phone | GET `/oauth/cloud-return` | same browser; `step=phone`; `rid` format; client, redirect, resource, PKCE recheck; session; eligible | `e164`, `personId` set | consent | H:429-443 | browser |
| phone, code | POST `/authorize/phone` | origin; live; Turnstile; number valid; `startOtp` ok | `e164` set; code sent unless banned | code | H:456-472 | person |
| code | POST `/authorize/code`, bad code | | error page | code | H:478 | person |
| code | POST `/authorize/code`, good code, held or not eligible | | delete row; clear cookie | ended | H:480-485 | person |
| code | POST `/authorize/code`, good code | | `personId` set; site session made | consent | H:486-490 | person |
| consent | POST approve | see 3.1 | consume; grant; code | ended | H:495-514, H:524-544 | person |
| consent | POST approve, account changed | | delete row; 403 | ended | H:499-505 | person |
| consent | POST approve, Cloud `unavailable` | | keep row; 503 retry page | consent | H:497, H:509, H:530 | Cloud |
| consent | POST approve, no Cloud authority or wrong phone | | keep row; 403 | consent | H:510-511 | person |
| any step | POST cancel, or consent with `decision` other than approve | live | delete; `consent_denied`; redirect `access_denied` | ended | H:518-520 | person |
| any | clock | `expires_at<=now` | refused by `liveRequest` | expired | H:423 | clock |
| expired | sweep | | delete | ended | P:205 | sweep |
| any with e164 | forget | phone and app match | delete | ended | P:218-219 | platform |

3.1 Approve guards, in order: `current` session read; `login()` for owner (banned or held gives `"held"`, H:498, K:167-170);
session person and phone equal the request; owner equal; slop eligible; Cloud authority read; `finishAuthorization`: request not expired,
`cloudGrantCurrent`, `takeConsentRequest` (atomic `DELETE ... RETURNING`, P:110-112), then identity equal again and not expired (H:533-535), then `putGrant`.

Invariants:

- INV-AR1: a grant comes only from a request in `consent`, and each request yields at most one grant (test `concurrent approvals`).
- INV-AR2: `consent` is reached only through OTP success, a live site session or Cloud return.
- INV-AR3: the step never moves back from `consent`. Note: `code` can return to `code` with a new phone. That is a legal self-loop.
- INV-AR4: a request acts only for the browser that started it.
- INV-AR5: an error before redirect validation never redirects (RFC 9700 4.11.2, H:368-371).
- Liveness: each request ends by expiry even with no action.

Concurrency: each store call is its own statement. Only `takeConsentRequest` is conditional. `updateAuthRequest` is read-then-write (P:103-108), see D14.
Duplicate approve: one winner, the other sees "expired". Crash after consume: person restarts. Fail closed.
One cookie per origin: a second `/oauth/authorize` in one browser overwrites the cookie, and the first request then reads "expired" (H:389, H:423). Parallel connects fail closed, and a reconnect recovers.
`cloud-return` needs `step=phone`, so a reload of the consent page on that URL gives 400. The earlier page form still works until expiry.

Quint notes: vars `step: rid -> Step`, `phone`, `person`, `browser`, `expires`. Actions per row of the table. Split read and write of `updateAuthRequest` into two actions, to expose D14. Merge with `oauth-grant` and `oauth-code` into one spec `oauth_flow.qnt`. Bounds: 2 browsers, 2 phones, 2 requests, 2 clients.

## 4. Machine: `oauth-grant`

Kind: implicit. Row in `oauth.grants` (Q:36-48).

States: `absent`, `live`, `expired` (clock), `revoked` (`revoked_at` set), `deleted`.
Derived per use: `dead_owner` (see `grant-owner-binding`), `suspended` (env flag or allowlist; no column).

Transitions:

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| absent | approve | 3.1 | insert; expiry `min(now+90d, authority)` | live | H:528, H:536 | person |
| live | code replay | `used_at` set | revoke; tokens revoked; drafts scrubbed | revoked | H:575-580, H:598-602 | client |
| live | refresh replay or any false rotate | | same | revoked | H:628-633 | client |
| live | `/oauth/revoke` with a refresh token | same client | same | revoked | H:651 | client |
| live | `/oauth/consents/revoke` | session phone and app match; POST; origin | same | revoked | H:671 | person |
| live | tool returns `invalid_grant` | owner changed | same, no audit | revoked | H:852-853 | client |
| live | `revokeAllFor` | live grants of phone | same | revoked | H:950-961 | platform |
| live | clock | `expires_at<=now` | none | expired | | clock |
| revoked, expired | sweep | older than 30 days | delete, cascade | deleted | P:210 | sweep |
| any | forget | phone and app | delete, cascade | deleted | P:215-217 | platform |
| any legacy | `movePhone` | | `phone_key` updated | same | `packages/platform/src/pg-store.ts:373` | platform |

Revocation is one transaction in Postgres: grant, tokens, drafts (P:128-135).

Invariants:

- INV-G1: `revoked` is terminal. No code path clears `revoked_at`. `Q:67-70` guards only Cloud rows.
- INV-G2: a token is usable only when its grant is live (`bearer` H:728; refresh H:615). Token rows alone do not decide.
- INV-G3: `tokens.expires_at <= grant.expires_at`. Enforced by `tokenPair` (H:553-554) and by `rotateRefresh` (P:170).
- INV-G4: `grant.app`, `resource`, `client_id` are fixed for legacy grants by code and for Cloud grants by trigger.
- INV-G5: a grant holds a keyed hash and never a phone number (Q:40-41).
- Liveness: a person can always revoke. No `openAiUnavailable` check blocks `consents` or `/oauth/revoke`.

Note: nothing de-duplicates grants. Each approval makes a new grant, and older grants keep working (test `denying a fresh request`).

Quint notes: model as a map `grant -> {live, revoked, deleted}` with `expires`. Merge into `oauth_flow.qnt`.

## 5. Machine: `oauth-code`

Kind: implicit. Row in `oauth.codes` (Q:79-90). TTL 5 minutes (H:72).

States: `absent`, `issued`, `used`, `expired` (clock), `deleted`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| absent | approve | after `putGrant` | insert hash | issued | H:538-540 |
| issued | exchange | client, not expired, redirect, PKCE, resource, grant live, eligible, Cloud valid, `takeCode` first | `used_at` set | used | H:572-596 |
| issued | exchange, Cloud unavailable | | no change; 503 | issued | H:592 |
| used | exchange | same client | revoke grant; `code_replay` | used | H:575-580 |
| issued | concurrent exchange loses `takeCode` | | revoke grant | used | H:598-602 |
| issued | clock | | none | expired | |
| issued, used, expired | sweep | `expires_at<=now` | delete | deleted | P:206 |

Order matters: the replay check (H:575) runs before expiry, redirect and PKCE. Authentication runs first, so another client cannot revoke (H:574).
A public client has no secret, so anyone who holds a spent code and the client id can revoke. That is the OAuth 2.1 behavior.

`takeCode` is atomic (P:147-149, test `a code is taken once under a race`). Mint is not; see D9.

Invariants: INV-C1 each code yields at most one token pair. INV-C2 the code holds the same client, redirect, PKCE challenge, resource and scopes as the request. INV-C3 a second use leaves no usable token of that grant.

Note on INV-C3: `A` wins `takeCode`, `B` revokes, then `A` runs `putToken` after the revocation. The new tokens have `revoked_at` null, but the grant is revoked, so `bearer` refuses them. INV-G2 saves this. Keep this interleaving in the model.

## 6. Machine: `oauth-token-family`

Kind: implicit. `oauth.tokens` (Q:92-104). `kind` access or refresh. Access 15 minutes. Refresh 30 days per rotation.

Refresh states: `live`, `rotated`, `revoked`, `expired`, `deleted`. Access states: `live`, `revoked`, `expired`, `deleted`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| none | code exchange | | two separate inserts | live | H:604-605 |
| live refresh | refresh | client; not revoked; not expired; grant live; eligible; Cloud valid; scope subset; resource; `rotateRefresh` true | tx: lock grant, mark old, insert pair, insert audit | rotated | H:611-634, P:164-182 |
| live refresh | refresh, Cloud unavailable | | no change; 503 | live | H:619 |
| rotated | refresh | `t.revokedAt` null | revoke grant; `refresh_replay` | revoked | H:628-632 |
| live refresh | `rotateRefresh` false | | revoke grant; `refresh_replay` | revoked | H:628-632, see D10 |
| live access | `/oauth/revoke` with access token | same client | `revoked_at` | revoked | H:652 |
| live | grant revoked | | `revoked_at` | revoked | P:131 |
| any | sweep | `expires_at<=now` | delete | deleted | P:207 |

Lock order: grant first, then tokens, in both revocation and rotation (P:130-131, P:167-171). No deadlock, and revoke against rotate serializes (test `refresh serialization`).

Scopes only narrow (H:621-622). Rotation does not revoke earlier access tokens, so two access tokens may be live for up to 15 minutes.

Invariants: INV-T1 at most one live, unrotated refresh token descends from each refresh token. INV-T2 scopes of a child are a subset of its parent. INV-T3 a token is valid only at its own `resource` and `app` (H:726). INV-T4 no refresh token outlives its grant.

Quint notes: vars `tokens: hash -> {kind, parent, state, scopes}`. Add a nondet `responseLost` action to show the known liveness limit.

## 7. Machine: `cloud-grant-authority`

Kind: implicit. `grants.cloud_authority` (Q:58), `id like 'grant_cloud_%'`, check constraint (Q:59-64), immutability trigger (Q:65-75).
External state: session and delegation status at Eliza Cloud, read through `API:658-688`.

Status per check: `valid`, `invalid`, `unavailable` (H:735-744). `unavailable` is temporary and leaves every row unchanged (tests `Cloud ... denies temporarily`).

States of a Cloud grant: `live_valid`, `live_unavailable`, `live_invalid`, `expired`, `revoked`, `deleted`.
`live_invalid` writes nothing. The grant stays unrevoked; each use gets 401 or `invalid_grant`.

Checks: `validateCloudGrant` tests the sealed authority, owner, hold, ban, suppression and the Cloud status (API:671-688).

| Path | Check | Failure effect |
|---|---|---|
| issue | H:529-531 | keep request; 503 or 403 |
| code exchange | H:590-595 | code unchanged |
| refresh | H:617-626 | token unchanged |
| bearer | H:729-731 | 503 or 401 |

Invariants: INV-CA1 `grant.expires_at <= authority.expires_at`. INV-CA2 an outage never extends authority (H:743). INV-CA3 no state change on `unavailable`. INV-CA4 authority fields are immutable once written, including phone. See D5: this last rule conflicts with `movePhone`.

Cutover: `cloudAuthorityRequired` is a global per deployment value (`API:645`). Legacy grants keep working after it turns on (D13).

Quint notes: model Cloud as a nondet oracle `{valid, invalid, unavailable}`. Check `unavailable` is a stutter on all stores. Merge into `oauth_flow.qnt` as an optional flag. Add `movePhone` as an action to reach D5.

## 8. Machine: `mcp-request-gate`

Kind: implicit. Each request walks this pipeline (H:760-861). No session state. The ordered steps:

1. Origin (H:765). 2. POST only (H:770). 3. IP limit (H:772). 4. `bearer` (H:718-733). 5. `openAiUnavailable` (H:778). 6. `customSlopEligible` (H:779). 7. Body and JSON-RPC (H:782-790). 8. Header match (H:796-812). 9. Scope check, grant limit, profile limit (H:835-849). 10. Tool (H:850).

Tool outcome machine: `ok`, `error`, `invalid_grant`. `invalid_grant` revokes the grant as a side effect (H:852-854).

Scope to tool: none for `app_info`, `start_signup`; `membership:read` for `check_status`, `get_updates`; `profile:write` for `submit_profile`, `prepare_signup` (T:12).

Note: `get_updates` writes `seenAt` under a read scope. The annotation discloses it (T:120).

Invariants: INV-RG1 each tool result concerns only the grant's own app and person. INV-RG2 no tool takes a phone, code or age (T:159-165). INV-RG3 a client on the OpenAI surface never sees slop (H:816).

What the gate does not check: ban, suppression, STOP. See D1.

Quint notes: model as guard predicates on `oauth_flow.qnt`, and do not model protocol header rules.

## 9. Machine: `openai-surface-gate`

Kind: implicit. Inputs: `client.surface`, redirect hosts, `client.kind`, `app.openai`, `privateOpenAiApps`, `customSlopPeople`.

States of one client on one app: `allowed`, `suspended_by_config`, `refused_at_registration`.
`openAiUnavailable` (H:236-239) re-reads config on each authorize, token and MCP call. Revocation stays open.

Custom pilot gate: `customSlopEligible` (H:252-255) applies at authorize session path, code step, consent, exchange, refresh and bearer. `K:178-185`: live person, not banned, active or onboarding, no review, adult.

Invariants: INV-OS1 slop never reaches a public OpenAI client. INV-OS2 the dev pilot and custom pilot exclude each other (H:157). INV-OS3 a minor never gets a custom pilot token, because `canMatchInApp` is checked at each step.

Verified: a mixed redirect list on slop is not `custom`, so it gets surface `openai` and is refused (H:309-311). A port on `chatgpt.com` also fails `chatGptRedirects`, since it compares `u.host`.

Quint notes: small alone, as a boolean table. Priority P0 because of minors. Low model cost.

## 10. Machine: `grant-owner-binding`

Kind: implicit. Compare `grant.personId` at consent to `personForKey(grant.phoneKey)` now (T:249-251).

Rule: `atConsent === null ? now === null : now === atConsent`.

| grant.personId | now | Result |
|---|---|---|
| null | null | ok |
| null | P | dead, grant revoked on first tool call |
| P | P | ok |
| P | Q | dead |
| P | null | dead (deleted person or **number on hold**) |

`personForKey` is null on hold (`ACC:154-158`). So a tool call during a hold revokes the grant for good, even if staff later decide `same_owner` (D20).

Checked by: `prepare_signup`, `check_status`, `submit_profile`, `get_updates`. Not checked by: refresh, code exchange, `bearer`, public tools. The new owner path therefore can refresh until a tool runs. It gets no data from refresh alone.

Effect on the signup order: a grant made before Join dies at Join. The person reconnects. The session skips the phone code. README section 2 records this.

Invariants: INV-OB1 a tool never returns data about a person other than the consent person. INV-OB2 a null-person grant never follows a later person.

Gap: a null-person grant has no owner to compare. If the number passes to a new holder who also has no person, the old grant remains valid and `prepare_signup` writes a draft for that number. It carries only a first name and a city. Low risk.

Quint notes: add `person: phone -> Option[Person]`, `hold`, `ban` as state, and merge with the flow spec. INV-OB1 is the most valuable check. Add a ban action to expose D1.

## 11. Machine: `signup-draft`

Kind: implicit. `oauth.signup_drafts` (Q:127-134), one row per grant, apps `ntwrk` and `friends` only.
Fields: first name and optional home city.

States: `none`, `open`, `expired`, `discarded` (`consumed_at` set, fields scrubbed), `scrubbed` (fields scrubbed, `consumed_at` null), `deleted`.

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| none | `prepare_signup` | age policy; owner; status `not_joined` or `invited`; grant live; scope; no row | insert, expires in 10 minutes or at grant end | open | T:277-293, P:47-60 | agent |
| open | claim | app, session, person, one live draft, age allowed | read only, no state change | open | H:887-911, P:61-78 | browser |
| open | discard | `signupView` matches | scrub; `consumed_at` | discarded | H:898-902, P:80-83 | browser |
| open | age floor below join age | canonical record | scrub; `consumed_at` | discarded | K:129-134, H:164 | platform |
| open | clock | | not claimable | expired | | clock |
| expired | sweep | | scrub | scrubbed | P:203 | sweep |
| open | grant revoked | | scrub | scrubbed | P:132 | any |
| any | grant deleted | | cascade | deleted | Q:128 | sweep, forget |

Serialization: `withPhoneAgeGuard` (`packages/platform/src/pg-store.ts:90`) covers draft access and age lowering. Tests confirm both orders.

Invariants: INV-D1 no draft of a phone whose stated age is below the join age survives after the age write returns. INV-D2 a draft never creates a person, membership or consent. INV-D3 a draft is read only by the same phone and app. INV-D4 a grant writes at most one draft ever.

Ambiguity: two live drafts for one phone and app read as none (P:69, test). This is fail closed.

Defects: D7 (no reader), D18 (stuck grant), D5 related: `movePhone` does not change `signup_drafts.phone_key`, so a draft dies. That is fail closed.

Quint notes: a small spec with age guard as a mutex. Lower priority while D7 stands. Decide first if the feature stays.

## 12. Machine: `skill-signup`

Kind: implicit, part client and part server. Two versions exist.

**Direct flow** (`sites/skills/{slop-date,friends-help,ntwrk-party}/SKILL.md` version 1.2.5). The agent holds the state.

States: `read`, `app_checked`, `drafted`, `consented`, `session_checked`, `need_phone`, `otp_requested`, `verified`, `member_checked`, `joined`, `read_back_ok`, `discrepancy`, `unsupported`, `stopped_under_age`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| read | GET `/api/app` | `id` matches | app_checked | SKILL step 1 |
| app_checked | age below join age | | stopped_under_age | step 1 |
| app_checked | facts confirmed | agent | drafted | step 2 |
| drafted | person approves profile and texts | agent | consented | step 3 |
| consented | jar exists | GET `/api/me` 200 | session_checked | step 4 |
| consented | no jar or 401 | | need_phone | step 4 |
| need_phone | `/api/auth/mode` not `otp` | | unsupported | step 4 |
| need_phone | POST `otp/start` 200 | one request | otp_requested | step 5 |
| otp_requested | POST `otp/verify` ok | one request | verified | step 6 |
| otp_requested | rejected | only the person may ask again | need_phone | step 6 |
| verified, session_checked | GET `/api/me` | app matches | member_checked | step 7 |
| member_checked | membership exists | no Join | read_back_ok or discrepancy | step 7 |
| member_checked | `canJoin` | POST `/api/join` once | joined | step 8 |
| joined | GET `/api/me` and export match | | read_back_ok | step 9 |
| joined | readback differs | no Join retry | discrepancy | step 9 |

Server side: `otp/start` (API:462-477), `otp/verify` (API:479-496), `/api/me`, `/api/join` (API:545-572).
`PLATFORM_PHONE_OTP_ONLY_APPS` turns Turnstile off for ntwrk, slop and friends. Peon is not allowed there (API:139-141).

Server rules that hold when the agent does not follow the text: `signupView` must match (API:549); `accounts.join` refuses ban, invite-only and under-age; a repeated Join keeps the membership and records the age (`ACC:355-365`).
Nothing on the server checks that the person approved the profile. `consent` wording is the only server check. This is client-side trust.

Cookie machine: the agent keeps a site session for 30 days. It rotates after a day and the old token works for 60 seconds (`packages/platform/src/sessions.ts:13-17`). An agent that does not save `Set-Cookie` loses the session and must ask for a new code.

**MCP flow** (`sites/skills/peon-biz/SKILL.md` version 1.1.2): build profile, person opens `https://peon.biz/join?via=agent`, connector authorization, `check_status`, `submit_profile`, `check_status`. Step 3 says "Access connects automatically". That text predates the explicit consent page.

**Text fallback**: first message keyword. Out of scope here.

Invariants: INV-S1 no Join without explicit approval (client only). INV-S2 the agent claims success only after read-back. INV-S3 banned numbers get no code (AGENTS), see D2. INV-S4 one signup targets one app.

Failure analysis: a timeout after Join is safe because a retry does not change a membership. A timeout after `otp/verify` is risky because a code is single-use: the SKILL says to check state first. `otp/start` has per-number limits.

Quint notes: model the server, and treat the agent as a nondet actor that can skip any client-side guard. Check INV-S3 and "no membership without verified phone". A short spec of its own, `skill_signup.qnt`, sharing the phone and ban vars.

## 13. Machines: `output-leak-gate` and `inbox-read-seen`

`get_updates` order (T:318-328, `packages/notify/src/scheduler.ts:236-248`):

1. `touch` surface. 2. `unseen`, filter by app. 3. Redeem token, if any. 4. `markSeen`. 5. Return to tool. 6. `outputLeaks` filter. 7. Result.

Item states: `unseen`, `seen`. A text brief reads `unseen` too (`scheduler.ts:126`).
Gate states for one summary: `clean`, `withheld`. There is no retained record of a withheld item.

Invariant: INV-L1 every summary an assistant reads passes the gate. Holds by order of steps 6-7.
Invariant wanted: INV-L2 a withheld item stays deliverable or reaches staff. Fails, see D8.
Gate patterns, with probe results, are in D4.

Other model-visible text: `T:222-230`, `T:291`, `T:315`, `T:328` are this package's own copy. No person data.

Cross-app privacy: the `app` filter is in `readUpdates`, not in the store. A token for another app's item redeems into `wanted`, but `items` is filtered first, so it returns nothing.

Quint notes: model the item with `seen` and a nondet `leaky` flag. A check for INV-L2 fails at once. Merge the two machines.

## 14. Machine: `assistant-surface-signal`

Kind: implicit. Signal `active` per `(person, surface)` in notify. `surface` is `chatgpt`, `claude`, `grok` or `web` from redirect hosts (H:142-148).

| Event | Effect | Where |
|---|---|---|
| grant stored | `active=true` | H:537 |
| live grant revoked by any path | `active=false` | H:175-179 |
| grant expiry | none | |
| sweep or forget of grant | none (after revoke on the forget path) | P:210 |
| `get_updates` | `lastUsedAt` | `scheduler.ts:237` |

`resolveDelivery` uses `active` to pick a deep link or button page (`packages/notify/src/surface.ts:47-59`).

Invariant wanted: INV-A1 `active(person, surface)` is true exactly when a live grant for that person and surface exists and the client holds a token. Fails, see D11.

Quint notes: count of live grants per `(person, surface)`, compare with the boolean. Simple and quick. Add to the flow spec.

## 15. Machine: `submit-profile-intake`

Order: scope, 30 per minute per grant, then 5 per day per grant for a well-formed `submit_profile` or `prepare_signup` (H:845-848), then `grantStillTheirs`, then status gate `active` or `onboarding` (T:312), then hook (K:187-191), then `svc.submitProfile` (SVC:1207-1219).

Results: `submitted:true`; `submitted:false` with status; `error` for refused text; `invalid_grant`.

STOP: `stopped()` moves `active` to `paused` (SVC:801-812), so the gate refuses. It does not change `onboarding`. `onboarding` is written only when `joinMode==="waitlist"` (`ACC:378`, SVC:1444, SVC:1488). All four apps are open or invite today (`packages/platform/src/apps.ts:70-85`). So `onboarding` is unreachable in the current config, and the STOP gap is latent.

`ban`: sets memberships `restricted`, so `status` is `on_hold` and the gate refuses. `svc.submitProfile` also checks `banned`.

Idempotency: `rowId` is random per call (SVC:1212). No idempotency key exists. A retry after a timeout sends the profile twice. `idempotentHint:false` discloses it.

Age: `statedAge` runs after the message, inside the same request but outside `rt.unitOfWork` (SVC:1216-1217). Crash between: the age is not recorded. `takeAges` state is in memory. This belongs to the network scope; see that report.

Quint notes: a guard on the flow spec, no separate spec.

## 16. Machine: `oauth-client-lifecycle`

Kind: implicit. States: `absent`, `registered_unused`, `in_use`, `orphan`, `deleted`.

| From | Event | Effect | To | Where |
|---|---|---|---|---|
| absent | POST `/oauth/register` | row, optional secret hash | registered_unused | H:292-321 |
| registered_unused | first grant | | in_use | H:536 |
| in_use | last grant deleted | | orphan | P:210, P:216 |
| registered_unused, orphan | sweep, age >= 1 day, no grants | delete | deleted | P:211 |
| absent | CIMD fetch | row | registered_unused | H:267-290, off in production |

No client can delete itself. Secrets never expire (H:317).
Registered `grant_types` and `scope` are echoed, not stored. Any client may ask for any scope and may refresh.

Invariant: INV-CL1 a client's `app` never changes. Holds for DCR. For CIMD see D17.

Quint notes: P2. Add a `sweep` action to the flow spec only if D16 needs a check.

## 17. Machine: `oauth-forget-revoke`

Triggers: `accounts.leave` (`ACC:421-429`), `accounts.deleteAll` (`ACC:432-444`), `clearHold(new_owner)` (`ACC:203-205`).
Each calls `hooks.onForget` for each live membership. SVC:755-766 runs `forgetListeners` and catches errors. The listener calls `revokeAllFor(e164, app, {forget:true})` (`packages/network/service/serve.ts:101-103`).

`revokeAllFor` steps (H:950-964): list live grants, revoke each (separate transaction), audit, then `forgetPhone` (two statements, no shared transaction, P:214-221).

Crash windows: after some grants: rest stay live, no retry. After revoke, before delete: rows stay up to 30 days. Harmless to access. Privacy claim weakens.
Order: `leave` calls the hook before `forgetMembership`. A hook failure inside the listener is logged, and the membership goes. No later pass retries (D12).

Concurrent: a consent in flight can `putGrant` after `revokeAllFor` lists the grants. The new grant survives. With person P and leave of one app: the grant still resolves, `status` is `not_joined`. Low risk.

Invariant wanted: INV-F1 after leave or delete, no grant row links this phone to this app. Fails, see D12.

Quint notes: add to the flow spec as an action, with a failure branch.

## 18. Machine: `oauth-phone-move`

`platform.movePhone` transaction writes `oauth.grants.phone_key` (`packages/platform/src/pg-store.ts:371-373`) when the role has rights. `MemoryPeopleStore` does not touch OAuth. See D5.

After a legacy move: `phone_key` is the new hash. `personForKey(new)` returns P, so the grant lives on.
Drafts keep the old key. Draft dies. Fail closed.
In-flight `auth_requests.e164` keeps the old number. Consent then fails at `current.e164 !== r.e164`, since sessions of the old number were deleted.

Invariant wanted: INV-M1 a number change succeeds for each person regardless of grant kind.

Quint notes: one action in the Cloud spec.

## 19. Machines: sweep, rate window, audit

**Sweep** (`oauth-sweep-retention`). Trigger: any OWNED request, at most once in 10 minutes per process (H:969). `lastSweep` is in memory. No cron calls it: the only production caller is H:969. It runs inside the request. It sets `lastSweep` first, so one failure gives one 500 and a skip for 10 minutes.
Steps are separate statements (P:203-211). Each is idempotent. A crash is safe.

**Rate window** (`oauth-rate-window`). Fixed window, row per bucket (Q:119-124, P:192-200). Upsert is atomic. The counter increases on each call, also on rejected ones. A clock behind by one window would reset the count. Boundary burst is 2x the limit. Buckets: `reg:ip`, `authz:ip`, `token:ip` (shared with `/oauth/revoke`), `mcp:ip`, `status:grant`, `profile:grant`.

**Audit** (`oauth-audit-log`). Append-only, separate writes, except refresh success, which is inside the rotation transaction. A crash loses a row. No production code reads `oauth.audit`. No retention exists. Rows keep grant and client ids only.

Quint notes: rate windows as a separate tiny spec only if a cap proof is wanted. Do not model audit, except for "each replay has a row".

## 20. Defect detail

### D1. A ban does not end existing grants. P0, high.

`SVC:1734-1765` sets bans and suppression, sets memberships `restricted`, and does not call `revokeAllFor` or any OAuth code. `bearer` (H:718-733) and `get_updates` (T:318-328) do not check bans. `updatesFor` (SVC:637-641) does not either.
Sequence: member connects Claude. Safety bans the person. Client calls `get_updates`: 200 with inbox items. Client calls refresh: new pair, for up to 90 days from consent. `check_status` says `on_hold`.
`validateCloudGrant` does check bans (API:683-684), so only legacy grants have the gap.
Rule: AGENTS founder 2026-10-09 #3 lists join and inbound. A read by a banned person's own agent is a smaller harm than a join. It still leaves a live channel for a banned account. `prepare_signup` on a legacy null-person grant has no ban check either.

### D2. No ban check on the site OTP path. P0, high.

`K:159` returns ok without sending for banned numbers on the MCP path. `API:462-477` and `OtpService.start` (`packages/platform/src/otp.ts:166-195`) have no ban check; `grep banned API` finds only Cloud lines. `API:479-496` creates a session for a banned number.
Sequence: banned person's agent follows SKILL step 5. A code is texted. Verify gives a session. `/api/join` then refuses with `review` (`ACC:355`). So join is safe. The OTP rule is not met.
`scripts/sim/safety.ts` tests only `hooks.startOtp`, so the gate does not see this path.

### D3. Two opposite signup contracts. P0, high that they conflict.

`T:19-23` INSTRUCTIONS: "Never ask for, accept or relay a phone number or a verification code." `packages/mcp/README.md:5`: the agent never sees the number or code. `T:270-271`: never share the code with this assistant. AGENTS decision 10 agrees.
SKILL 1.2.5 steps 4-6 tell the agent to ask for the number and code and to send them, and to keep a 30-day session in a local file. The same agent can read both texts on one site. A session gives the whole `/api/me/*` surface, not a scoped token.
Commits `47666a4` and `650c912` show this was deliberate. AGENTS still states the old rule. A founder decision must say which rule stands, and the losing text must change.

### D4. Output gate gaps. P0, high for the gap.

Probe output of `outputLeaks`, 2026-11-07:

```text
"call 555-0102"                                            []
"call me 5550102 now"                                      []
"Member slop_abcdefab-cdef-4abc-8def-abcdefabcdef replied" []
"slop_a1b2c3d4-aaaa-4bbb-8ccc-deadbeefcafe"                []
"grant_abcDEF123"                                          []
"mem_abc"                                                  ["internal_id"]
```

`PHONE` needs 10 to 15 digits (`leaks.ts:10`). `INTERNAL_ID` lists `mem|opp|act|rcp|grt|prp|dcr` (`leaks.ts:15`). The repo mints `<app>_<uuid>` for members (`ACC:340`, `ACC:377`) and `grant_`, `mcp_`, `plan_`, `p_`. No non-sim code mints the listed prefixes (search of `packages`, excluding tests and sim). UUIDs that hold long digit runs trip `phone_pattern` only by chance.
The gate runs with no `forbidden`, `facts` or `contacts` (T:327). Inbox summaries are built member-safe upstream, so this is a second line of defense. Actual leak impact is unknown.

### D5. Number change fails with a Cloud grant row. P1, high by reading; not run.

`Q:67-71` raises when `new.phone_key<>old.phone_key` on any `grant_cloud_%` row. `packages/platform/src/pg-store.ts:373` runs `update oauth.grants set phone_key = new where phone_key = old` in the `movePhone` transaction, with no filter for Cloud rows, revoked rows or expired rows.
Sequence: person has one Cloud grant, even a revoked one still in its 30-day keep. Person completes a number change. The trigger raises. The whole transaction rolls back. The change throws; the person cannot change the number until the grant row is swept or removed.
No test covers it: `packages/platform/test/number-change.pg.test.ts` does not mention Cloud grants. `Q:67` and the comment at `pg-store.ts:372` state opposite intents.

### D6. Dead `/join` destinations. P1, high.

`deploy/router.ts:40-49` redirects `/join` to `/` for ntwrk, slop and friends. `deploy/router.test.ts:246` tests `/join?via=agent`.
Still pointing there: `T:203` (`app_info.join.url`), `T:206-207`, `T:224`, `T:225`, `T:267`, `T:270`, `T:290`, and `start_signup` tells the person to "enter your own phone number" on that page. Only `peon` still has a page.
Sequence: an MCP client on slop.date calls `start_signup`, gets a URL, and the person lands on the home page with no way to join there.

### D7. Draft claim has no caller. P1, high.

`0f1797a` removed `join.html` for ntwrk, slop and friends. `sites/shared/join.ts` is now loaded only by `sites/peon.biz/public/join.html`. Draft code there is gated to `friends` and `ntwrk` (`join.ts:58`), and `H:892` refuses peon. So no page calls `/oauth/signup-draft`. `tests/e2e/signup-draft.e2e.test.ts` was deleted in the same commit.
`prepare_signup` still lists for ntwrk and friends (T:67), stores a name for 10 minutes and answers `prepared:true` with next step "Open Join". States `claimed` and `discarded` by a browser are unreachable from the product. Age cleanup still works.

### D8. Withheld update is consumed. P1, high.

`scheduler.ts:246` marks items seen. `T:327` filters afterwards. `scheduler.ts:126` builds a text brief only from `unseen`. So a failing summary is not shown on this call, nor on a later call, nor in a text. No log or staff queue records it.
Sequence: an item with an email in the summary arrives. Assistant calls `get_updates`. Result: "Nothing new". Item is seen. The person never hears of it. For a proposal this can lose a reply window.

### D9. Code consume and mint are not atomic. P1, high.

H:596 commits `used_at`. H:605 inserts two tokens in separate statements. H:606 audits.
Sequence: `putToken` fails or the process dies. Client gets 500 or no answer. Client retries. `usedAt` is set (H:575). Grant is revoked. Person must connect again. If one insert passed, an orphan token exists until revoked or expired. The refresh path was fixed this way (P:164). `docs/results/2026-10-13-oauth-refresh-atomic.md` lists this as out of scope.

### D10. `rotateRefresh` false is not always replay. P1, high.

False also means: grant missing, revoked, expired during the transaction, Cloud row without authority, pair outlives grant, or Cloud expiry during commit (P:169-170, P:176-179). H:628-633 treats each as replay: revokes and writes `refresh_replay` with "grant revoked".
Sequence: grant expires while a refresh waits on the row lock (`cloud-authority.pg.test.ts` line 79 covers the store result only). The audit log then shows a security event that did not happen, and an expired grant gets `revoked_at`. Access was already over, so no access is lost. The cost is false alarms in audit, plus a false `linked(false)`.

### D11. `active` signal errors. P1, high.

(a) Set before the client holds a token (H:537, before H:540). An abandoned connect leaves `active=true`.
(b) Expiry never clears it. Only `revokeGrant` does (H:175-179). Sweep deletes grants without a signal.
(c) It is keyed by person and surface. Two live Claude grants, in slop and peon. Revoking one sets `active=false` while the other lives. SVC:644 has no app or grant key.
(d) A null-person grant never signals (H:170). After Join and reconnect it does.
Effect: `resolveDelivery` may point a text at an assistant link that no longer works, or stop pointing at a working one. The `MAX_IGNORED_STREAK` rule limits (a) and (b) to two dead links.

### D12. Forget leaves grants. P1, high.

`ACC:438-442` runs `onForget` only for live memberships. `PgPeopleStore.deleteAll` (`packages/platform/src/pg-store.ts:304-320`) does not touch `oauth.*`.
Sequence: person is a member of slop. They connected peon.biz and never joined peon. "Delete everything". The peon grant row stays with the phone key and app until expiry plus 30 days. README section 3 says nothing keeps the phone next to the app. A null-person grant of that kind stays usable: with no person, `grantStillTheirs` is true, so `check_status` answers `not_joined`.
Also SVC:763-765 catches listener errors. After `forgetMembership`, no retry finds that membership.

### D13. Legacy grants bypass Cloud checks. P1, medium.

`H:736`: a grant without the prefix or authority is "valid" with no call. After cutover a legacy grant keeps working for up to 90 days with no hold, ban, suppression or logout check. `docs/results/2026-10-20-oauth-cloud-composition.md` says legacy grants "keep their behavior", so this is intended. A person logged out of Cloud has no way to learn this. It needs an explicit cutover decision, for example revoking legacy grants at cutover.

### D14. Unguarded `updateAuthRequest`. P2, high for the state.

P:103-108 reads, merges, writes all three fields. No compare on step.
Sequence: browser has a code for phone A. It POSTs `/phone` with B (700 ms pad, H:459). During the pad it POSTs `/code` with A's code. `/code` passes, then `/phone` writes `e164=B, step=code`, then `/code` writes `personId=A's, step=consent`. Result: `e164=B`, person A, `consent`.
Approve then fails: `current.e164` is A and `r.e164` is B (H:499). The site session guard saves it, and the request is deleted.
The guard needs `o.platform.session`; `H:499` skips it when the hook is absent. Production always has it (`K:201`). A custom composition would grant on an unverified phone. Fix would be a conditional update, not this report's job.

### D15. Consent to code is not atomic. P2, high.

H:532, H:536, H:537, H:540, H:541-542 are separate. A crash after `putGrant` leaves a live grant with no code, no audit row and `active=true`. The person sees it on `/oauth/consents`. It expires in 90 days. No token exists, so access is not at risk.

### D16. Client swept while a connector still holds its id. P2, medium.

P:211 deletes any client with no grant row, one day old. Sequences: a connector registers and the person authorizes two days later, or a person leaves (grants deleted) and returns later. The connector keeps its `client_id`. Authorize answers "not registered on this site" (H:362). Recovery needs the connector to register again. Behavior of real clients was not tested.

### D17. CIMD. P2, high.

`cimdFetch` is not passed in `serve.ts` or `deploy` (search found no caller). So `kind='cimd'` is unreachable in production.
If enabled: P:88 upsert leaves `app_id` as it was, while H:286 returns an object with the current app. Authorize passes on site B, then `authClient` reads the row with app A and fails (H:340). Memory store overwrites the whole row, so a client changes app. Tests use memory.

### D18. Stuck draft. P2, high.

`on conflict do nothing` and `S:176` allow one draft per grant ever. After 10 minutes the grant can never prepare again. The tool answers "already prepared". Exit is a new grant. Moot while D7 stands.

### D19. Retention and comment mismatches. P2, high.

- README section 3: request keeps the number "at most 10 minutes". `H:73`: 15 minutes, then until the next sweep. With no MCP traffic no sweep runs (H:969 is the only production caller).
- `S:157`: "the person's consent page shows it". `grantsFor` filters to live grants (P:126). Nothing shows revoked grants, so the 30-day keep has no reader.
- `store.ts` comment on `claimSignupDraft` name: claim reads only; `consumed_at` comes from discard.

### D20. Silent revocation; hold is final. P2, high.

H:853 revokes with no audit row. README says one row for each revocation.
A tool call while the number is on hold revokes (section 10). `clearHold(same_owner)` cannot restore it. Fail closed, but a read during a review ends the connection. Person must reconnect.

### D21. Quota text. P2, high.

README: "At most 5 accepted profiles per grant a day". H:848 counts before the tool runs, so a `submitted:false` counts. `prepare_signup` shares the bucket. The cap is per grant, and each new grant has a new bucket.

### D22. Store differences. P2, high.

`S:240-247` does not check the grant, unlike P:167-170. `S:174-178` does not check `expiresAt` against `at`, unlike P:56. Scrub writes `{firstName:""}` against `{}`. `movePhone` touches OAuth on Postgres only. Harness tests default to memory, so grant-lock behavior is proven only in the Postgres test files. The harness also omits `authenticatedSiteSession`, so it runs the rotating session path that production does not use. Model Postgres semantics.

### D23. Small notes. P2, high.

- Approve and deny race: deny does not check that a row was deleted (H:518). If approve won, the person may see `access_denied` while a grant exists. Both audit rows exist.
- `Q:62` and `Q:67` use `LIKE 'grant_cloud_%'`, where `_` is a wildcard. A legacy id `grant_cloud` + any char would match; a random id has about 1 in 10^9 odds to start with `cloud`. Insert would fail.
- No tool needs `apps:read` (T:12). The scope is decorative.
- `decodeURIComponent` at H:333 can throw on a bad Basic header, which gives 500 and not 401.

## 21. Checked and found sound

- Consent single use under two connections (P:110-112, test).
- `takeCode` under a race (P:147-149, test).
- Grant then token lock order; refresh against revoke (P:130, P:167).
- Refresh failure rollback (P:166-181, three fault cases in `pg.test.ts`).
- No Cloud outage writes state (cases in `cloud-oauth-continuation.integration.test.ts`).
- `oauth.sql` reruns at each migrate: `9001_oauth_schema` has `repeatable:true` (`packages/observatory/db/migrate.ts:38`).
- Session cookie loss on the unavailable path: production uses `authenticatedSiteSession` with `rotate=false` (API:656), so `setCookie` is never set there.
- Banned number on the OAuth page: no code, no grant (K:159, K:168). Existing session at consent: `login` gives `held` (H:498-500).
- Under-13 cleanup across both write orders (`signup-draft.test.ts`, `pg.test.ts`).

## 22. Quint plan

Suggested specs, in order:

1. `oauth_flow.qnt` (P0): `oauth-auth-request`, `oauth-grant`, `oauth-code`, `oauth-token-family`, `grant-owner-binding`, `assistant-surface-signal`, forget and ban actions.
   Vars: `requests`, `grants`, `codes`, `tokens`, `person`, `hold`, `ban`, `session`, `active`, `clock`.
   Split non-atomic handlers into a read action and a write action so that races appear. Keep Postgres semantics.
   Bounds: 2 phones, 2 persons, 2 clients, 2 apps, 3 requests, 3 grants, clock in abstract ticks with named TTLs.
   Invariants: INV-AR1, AR2, AR4, G1, G2, G3, C1, C3, T1, T2, T4, OB1, OB2. New: `noBannedUse`, `noOwnerlessMint`, `activeMatchesGrants`.
   Expected counterexamples: D1, D9, D11, D14 (state only), D15.
2. `cloud_authority.qnt` (P0): Cloud oracle, sealed fields, `movePhone`. Expected counterexample: D5. Check INV-CA3 as a stutter.
3. `skill_signup.qnt` (P0): server with an adversarial agent. Expected counterexample: D2.
4. `inbox_gate.qnt` (P1): item, seen, gate. Expected counterexample: D8.
5. `signup_draft.qnt` (P1 once D7 is decided): draft with a mutex for the age guard. Include only if the feature stays.
6. `surface_gate.qnt` (P0, cheap): boolean table for OpenAI and custom pilot, with age.

Do not model: MCP protocol headers, HTML, CSP, rate windows unless a cap proof is wanted.
Abstract: hashes as ids, tokens as ids, PKCE as a boolean match, time as ticks.
Crash modelling: add a `crash` action that drops the rest of a split handler.
