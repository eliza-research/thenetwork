# Wave 3 sweep: packages/mcp (OAuth server, grants, tools, inbox, output gate, token lifecycles)

Hand-written on 2026-11-09 from a read of the code on branch `claude/quint-state-machines` (HEAD f02196f),
checked against `claude/formal-main` (06ad8e6) where the MCP code moved. Read-only; no model was changed.

Short names: `H` = packages/mcp/src/handler.ts, `T` = tools.ts, `K` = hooks.ts, `P` = pg-store.ts,
`S` = store.ts, `Q` = packages/mcp/db/oauth.sql, `SV` = packages/network/service/serve.ts,
`SVC` = packages/network/service/service.ts, `NS` = packages/notify/src/scheduler.ts,
`API` = packages/platform/src/api.ts, `SES` = packages/platform/src/sessions.ts.
Line numbers are for this branch unless marked "fm" (formal-main).

Inputs taken as known (not reported again as new): the oauth_mcp findings file (SD-019 ... Q-oauth_mcp-2,
SD-186 (a)(b) contract, SD-058/115/182/391 skipped), the formal-main drift items for oauth_mcp
(endIfBanned without audit row, movePhone Cloud-grant revocation without audit row, prepare_signup in the
profile bucket), and the two defects formal-main already fixed (auth_edge rotateSession, under-13 on
invite_only exit).

## Coverage summary

`quint/oauth_mcp.qnt` covers 15 of the 17 catalog machines (M-064..M-074, M-132..M-137) at the level of
grants, codes, token families, approve/deny, sweep, forget, phone move, inbox read and the quota. It does
not have: the Cloud continuation of an auth request, the web session at the consent step, the
custom/private ChatGPT pilots (openai-surface-gate, M-070, left out), the browser binding cookie, the rate
windows (M-210), the audit log as its own non-atomic writer (M-209), the signup-draft claim/discard/expiry
part, and the sweep's failure path.

## new_machine

### N1 (P1) `mcp-pilot-surface-gate`: custom ChatGPT Slop pilot + private OpenAI dev pilot + OpenAI surface

Not in any model (oauth_mcp header: "openai-surface-gate ... a boolean config table; no app here is
slop"). It is no longer a table: it is a config-driven gate with suspension semantics, rechecked on
every path.

- Config state: `customSlopPeople: null | Set` (H:158-164), `privateOpenAiApps: Set` (H:156-157), per app
  `openai` flag (apps.ts:45, slop false).
- Client state: `surface` full|openai and `kind` dcr|cimd fixed at register (H:326-330); the pilot client is
  a DCR client on slop whose redirects are all chatgpt.com/chat.openai.com (H:258-267), stored with
  surface `full`.
- Per-request derived state: `openAiUnavailable` (H:253-256), `customSlopClient` (H:265-267),
  `customSlopEligible` = allowlist and `K:185-192` (phone owner, not banned, slop membership
  active/onboarding with no review, lowest age >= 18), `onboardingOnly` (H:805).
- Transitions/check points: register (H:326-328), authorizeStart signed-in (H:416-419), cloud-return
  (H:452-455), code step (H:497), consent (H:518), token exchange (H:607; fm grantForTokens), refresh
  (H:636), every MCP request (H:803-805), tools/list filter (H:854), get_updates refusal (H:859).
  Revocation (H:662-679) and /oauth/consents (H:683-704) deliberately skip the gate.
- Rules: packages/mcp/README.md section 5 "Real-account custom ChatGPT pilot": checks "at authorization,
  code exchange, refresh and authenticated MCP requests"; `get_updates` "omitted and refused for pilot
  connections"; "Disable the flag or remove a person from the allowlist to suspend access"; "Revocation
  remains available". H:39 "Turning off suspends access, not grants; explicit revocation still works".
  "The public Slop /mcp/openai surface remains unavailable" (apps.ts:55, H:841, H:909, H:913).
- Proposal: extend `oauth_mcp` (one more client kind `pilot` on app slop, config vars `pilotOn`,
  `allow: Set[person]`, `devPilot: bool`, nondeterministic toggles as actions). Invariants:
  (a) no token minted and no tool result for a pilot client unless `pilotOn` and the person is eligible
  at that step; (b) no get_updates result ever for a pilot client; (c) a toggle off never changes `grants`
  (suspend, not revoke); (d) revokeEndpoint and consentsRevoke stay enabled for a suspended client;
  (e) no client of surface openai ever holds a slop grant.
- Quint value: good. The property is "every path rechecks a mutable config", which is exactly what a
  missing recheck breaks; the state is small (2 booleans, one set, one client kind). Today all listed
  paths recheck; see D1 for the one eligibility input that is missing.

### N2 (P2) `oauth-audit-log` (M-209) as a separate, non-atomic writer

- State: `oauth.audit` append-only (Q:109-117), no retention and no index besides the PK; it is also
  READ by the client sweep (P:242-243, the SD-390 fix keeps a client with a `consent_granted` row).
- Transitions: written inside a transaction on approve (P:130), redeem (P:178) and rotate (P:205); written
  as a separate statement AFTER a committed revocation on six paths: code replay (H:595-596, H:622-623),
  refresh replay (H:653-654), /oauth/revoke (H:674-676), /oauth/consents/revoke (H:694-695), tool
  invalid_grant (H:879-880), revokeAllFor (H:983-985). Plus fm `endIfBanned` (no row at all, drift item)
  and platform movePhone Cloud revocation (no row, drift item).
- Rule: README section 3 "`oauth.audit` keeps one row for each registration, consent, denial, code,
  token, refresh, revocation and replay". `revokeGrant` (H:181-191) can also throw after its commit
  (`store.grantsFor`, `assistantFor` are not caught; only `linked` is), so the caller's audit line never
  runs and the request answers 500 (H:1001-1003).
- Proposal: extend `oauth_mcp`: split `revokeWithAudit` into `revokeCommit` and `auditWrite` with a crash
  or throw action between (the findings file lists "a crash between revokeGrant and its audit row" as left
  out). `everyRevocationAudited` then shows the gap as a reachable violation; keep it out of `safety` as a
  named value unless the code moves the audit into the revoke transaction (`store.revokeGrant(id, at,
  auditRow)`). Retention/index are not state-model material (see D4).
- Quint value: moderate; it turns the README sentence into a checked or explicitly waived property.

### N3 (P2) `oauth-rate-window` (M-210)

- State: one row per bucket (Q:119-124), fixed window aligned to epoch (P:222-230, S `hit`), swept after
  the window (P:238). Buckets: `reg:ip` 20/h (H:311), `authz:ip` 60/h (H:376), `token:ip` 30/min shared by
  /oauth/token AND /oauth/revoke (H:579, H:664), `mcp:ip` 120/min (H:797), `status:grant` 30/min for every
  scoped tool (H:870), `profile:grant` 5/day for submit_profile and prepare_signup (H:874, T:292, T:318).
- Rules: README section 3 "Rate limits per IP for registration, authorize, token and MCP calls, and per
  grant for check_status and submit_profile"; README section 2 "At most 5 accepted profiles per grant a
  day".
- Notes: the revoke endpoint spends the token bucket (a client that revokes then retries a refresh in the
  same minute shares 30); a fixed window allows 2x the limit across a boundary; the profile bucket counts
  before `submitProfile` can still answer `not_member` (T:318-320, see D2), so "accepted" is not exact even
  after SD-395.
- Proposal: no new module. Keep the `Quota` in `oauth_mcp` and add a `reached` flag from the hook
  result to `quotaCountsAccepted`; the IP windows are arithmetic and belong in integration tests. Low
  Quint value beyond the quota.

### N4 (P2) `mcp-sweep-throttle` (in-memory `lastSweep`, H:203-208, H:997)

- State: `lastSweep` per process (in memory), set BEFORE `store.sweep` runs; the sweep is 7 autocommit
  statements (P:232-244). Callers: every OAuth/MCP request (H:997) and the service tick (SV:105).
- Rule: H:94 "at most once a minute ... call it on a timer too, so nothing waits for traffic".
- Model: `oauth_mcp` has `sweep` as one atomic action with no failure; the failure leaks into an unrelated
  request (D3). Extend `oauth_mcp` only if D3 is accepted as a defect (one `sweepFails` action whose
  effect is that the current request fails); otherwise document. Low Quint value.

## model_gap

### G1 (P1) oauth_mcp: Cloud continuation of the auth request is missing

- Code: authorizeStart Cloud branch (H:423-427: `beginCloudOAuth`, 302 to Cloud, `cloud_pending` cookie
  for 300 s, API:249-260, 653-656), session "unavailable" retry to `/oauth/cloud-return` (H:408-411),
  `/oauth/cloud-return` (H:446-460: same browser, `step == phone`, rid shape, client/redirect/resource/PKCE
  recheck, Cloud session, pilot eligibility -> `consent`), consent with `cloudGrantAuthority` (H:524-528:
  "unavailable" keeps the request and shows a retry page, H:776-779; a phone-key mismatch is a 403 that
  keeps the request), `finishAuthorization` Cloud check before the single-use take (H:541-549).
- Model: `startAuth` always goes to step `phone`; `approveRead(r, cloud)` is a boolean oracle; there is no
  handoff-pending state, no cloud-return action, no "unavailable keeps the request" branch. auth_edge has
  the cloud-handoff callback (auth_edge.qnt:425) but not the OAuth rid return.
- Rules: H:541 "Validate Cloud authority before single-use consumption so outages remain retryable";
  mcp-oauth.md:635 "No Cloud outage writes state"; mcp-oauth.md:133 (a reload on cloud-return gives 400).
- Proposal: extend `oauth_mcp`: request step `cloudPending`, actions `cloudCallback(r, ok)` (session
  created, oracle) and `cloudReturn(r)`, Cloud oracle `ok|invalid|unavailable` at approve. Invariants:
  an "unavailable" answer changes no `oa` field; a request reaches consent only through OTP, a matching
  session or a cloud-return of the same browser; a Cloud grant's phone key equals the request's.

### G2 (P1) oauth_mcp and auth_edge: the web session at the consent step

- Code: the code step creates a 30-day site session (H:505, K:221-227); a browser that already has a
  site session skips the phone and code pages (H:407-422); approve requires the session to name the same
  person and number as the request (H:513-523); rotated session cookies are passed on (H:420, 458, 530,
  702). The consent page shows the client name and redirect host but no account hint (pages.ts:77-86).
- Model: `oauth_mcp` has no session; auth_edge's web-session (M-058) has no OAuth consumer. The junction
  (a logout, a session rotation in its 60 s grace, a ban or a number hold between the code step and
  consent; a stale 90-day session chain used to connect a new assistant) is checked by no model.
- Proposal: extend `oauth_mcp` with a per-browser `session: person | none` (created at enterCode, dropped
  by logout/expiry/hold actions) and the signed-in shortcut in `startAuth`; invariant: every grant's
  person equals the session person at commit. See D6 for the freshness question.

### G3 (P2) oauth_mcp: signup-draft lifecycle is only half modelled

- Code: draft states none -> stored (P:47-60, 10-minute expiry, one per grant) -> claimed (read only,
  repeatable, bound to phone key, app and person, P:61-78, H:914-939) -> consumed (discard after Join,
  P:80-83, `signupView` marker H:927) | scrubbed (revoke P:151, sweep after expiry P:233, age cleanup
  K:133-138 and H:167) | deleted with the grant (cascade Q:128).
- Model: `Draft = {exists, phone, scrubbed}`; no claim, no consumed, no expiry, no age cleanup, no
  person binding. Production value is low while SD-115 stands (no page claims a draft), so P2.
- Proposal: if SD-115 is decided for keeping drafts, add `claim(p, n)`, `discard`, `draftExpire`,
  `ageCleanup` to `oauth_mcp`; invariant: a claim returns fields only to the session whose person equals
  the grant's person (null included) and never after discard, revoke, expiry or an under-join-age floor.

### G4 (P2) oauth_mcp: browser binding cookie

- Code: one cookie `__Host-mcp_auth` per browser, Max-Age = request TTL (H:400-406); `liveRequest` needs
  the cookie hash of the request (H:436-443). On this branch every authorize GET writes a new value, so a
  second authorize in the same browser makes the first tab's request answer "This page has expired". On
  formal-main the value is reused (fm H:401-403), which fixes that.
- Model: requests have no browser. Add `browser` to `Req` and a per-browser cookie value if login-CSRF
  properties (a request is advanced only by the browser that started it) are to be checked. Low value.

### G5 (P2) notify_capital: token redeem ignores the app filter

- Code: `NS:235-247` redeems the token (marks it redeemed and records the delivery `acted`, NS:220-227)
  BEFORE it intersects the token's items with the app-filtered unseen items. `SVC:675` passes the grant's
  app. The `redeem` action in notify_capital has no app. See D5.

### G6 (P2) oauth_mcp: submitProfile outcome mapping

- Model `submitProfile` sets `accepted = not(banned)` and reports ok/refused; the code also maps a
  `not_member` hook result to status `not_joined` (T:319-320). See D2.

## suspected_defect

### D1 (P2) The custom ChatGPT pilot does not read the Network trust hold

- Where: K:185-192 (`customChatGptSlopEligible`) checks ban, phone owner, membership state, `review` and
  age, but not `memberHeld`; K:202-209 (`status`) does read it; SV:91-94 (`memberHeld` = trust level
  `hold`); SD-428 established that a staff hold changes `trust`, not `platform.memberships`.
- Rule: README section 5: the person must "have an active/onboarding Slop membership without review ...
  and have no hold or ban".
- Trigger: pilot on; allowlisted adult P with active slop membership connects ChatGPT -> staff hold P
  (`holdMember`, membership row unchanged) -> the connector refreshes (H:636 eligible = true, new tokens)
  -> tools/call check_status (H:804 eligible = true) answers `on_hold`; submit_profile is refused only by
  the tool's own status gate (T:317).
- Impact: low; no data crosses. The pilot gate itself is wrong, so any later tool added to the pilot
  without its own status gate would reach a held member.
- Fix idea: add `memberHeld` (or `status(...) in {active, onboarding}`) to K:185-192.

### D2 (P2) submit_profile answers "not joined" for any `not_member`, after spending the quota

- Where: T:315-320; K:194-198; SVC:1370-1375.
- Trigger: an active member whose network member row is missing, whose home-city runtime is not running
  (`runtimeOfMember` undefined, SVC:495-498), or who is banned between T:315 and SVC:1374 -> T:318 counts
  the profile bucket -> the hook returns `not_member` -> the tool returns `{submitted:false,
  status:"not_joined", next_step:"Not joined. To join, open https://<site>/join ..."}` while
  `check_status` still answers `active`; `/join` redirects to `/` for three sites (SD-182).
- Impact: wrong agent guidance and one quota unit lost per try; README says only accepted profiles count.
- Fix idea: return the live `status` (re-read) instead of a constant, and count the bucket only on
  `accepted`.

### D3 (P2) A sweep failure fails an unrelated OAuth or MCP request

- Where: H:993-1004 (`await sweep()` inside the request's try), H:203-208 (`lastSweep` set before the
  sweep), P:232-244 (seven statements).
- Trigger: the per-minute sweep is due -> a token exchange arrives -> one sweep statement fails (lock
  timeout, a deadlock between `delete from oauth.tokens where expires_at<=t` (P:237) and a concurrent
  `revokeGrant` multi-row token update (P:150) that locks the same expired tokens in another order, or a
  connection error) -> the exchange answers 500 `server_error` although its own work never ran. The code
  stays unused, so a retry works; a refresh or an approval page also gets 500.
- Fix idea: run the request sweep in the background (`void sweep().catch(log)`) or only on the tick
  (SV:105 already does it).

### D4 (P2, efficiency) The client sweep scans an unbounded, unindexed audit table every minute

- Where: P:242-243 (`not exists (select 1 from oauth.audit a where a.client_id = c.id and a.kind =
  'consent_granted')`), Q:109-117 (no index on `client_id`/`kind`, no retention), H:997 (on the request
  path).
- Trigger: any client older than a day with no grant row is a candidate on every sweep; clients that once
  got consent and whose grants were deleted after 30 days stay candidates forever (by the SD-390 fix), so
  every minute Postgres anti-joins them against all of `oauth.audit`, which only grows (one row per token
  refresh, every 15 minutes per active connector).
- Fix idea: index `oauth.audit (client_id) where kind = 'consent_granted'`, or mark the client row
  (`granted_at`) in the approve transaction and drop the audit read.

### D5 (P2) A token from another app's text is redeemed and counted as "acted" on the wrong grant

- Where: NS:235-247 and NS:220-227; SVC:675; T:332.
- Trigger: person P is in friends and peon; peon texts an update with token T -> P pastes T into the
  assistant connected to friends.help -> get_updates(update_token=T) -> `redeem` marks T redeemed on
  surface claude and records the peon delivery `acted` -> the app filter leaves no item -> "Nothing new".
  P saw nothing, but the surface signal learns that claude works for P (a wrong `acted` outcome) and the
  peon delivery is closed as acted.
- Fix idea: filter the token's items by `opts.app` before `markTokenRedeemed`/`acted`, and redeem only
  when at least one item is returned.

### D6 (P2, may be intended) Consent through a long-lived site session needs no OTP and names no account

- Where: H:407-422 (a site session skips phone and code), SES:12-19 (30-day session, rotation chain up to
  90 days; delete everything needs a 10-minute fresh login), pages.ts:77-86 (no "phone ending in ..."
  on the consent page), H:513-523 (approve only rechecks that the session matches the request).
- Trigger: a person verifies on a shared computer during an agent connect -> weeks later another person
  starts a connector to the same site in that browser -> the consent page appears directly with no
  account hint -> "Allow" creates a grant for the first person -> get_updates returns that person's
  intros and plans.
- Rule tension: README "The person signs in on the site's own page with the platform phone code";
  sessions.ts treats the more sensitive delete-everything as needing a fresh OTP. A founder or maintainer
  decision may accept this (standard OAuth practice); if not, require `sessions.fresh` or show the last
  four digits on the consent page (copy change: needs scope confirmation).

### D7 (P2, doc and retention) GRANT_KEEP_MS says the consent page shows revoked grants; it does not

- Where: S `GRANT_KEEP_MS` comment ("the person's consent page shows it"), H:699 and P:144-146
  (`grantsFor` returns only live, unexpired grants), P:240 (30-day keep).
- Effect: the stated purpose of keeping revoked/expired grants (with `phone_key` next to `app_id`) for 30
  days has no reader except code-replay lookups and the sweep. Either the page should list them, or the
  keep time can be shortened (README section 3 states the 30 days, so a change needs the README too).

## open_carveout (unchanged, for completeness)

- `skill-signup` (M-073): the site SKILL.md files (for example sites/skills/friends-help/SKILL.md:62-120)
  run the signup over `/api/auth/otp/*` with the agent holding the code and a cookie jar, against the MCP
  INSTRUCTIONS (T:19-22) "Never ask for, accept or relay a phone number or a verification code". Agent
  text, no server state; blocked on SD-058 (founder decision).
- CIMD (SD-391) stays off (no `cimdFetch` caller).
