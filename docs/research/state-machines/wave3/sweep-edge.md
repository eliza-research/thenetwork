# Wave 3 sweep: sites/, deploy/, plugins/, scripts/ (edge, deploy and agent onboarding)

Hand-written by a research agent (Claude Opus 5.5), 2026-11-09. Read-only. Branch `claude/quint-state-machines`
(HEAD f02196f). Line numbers are for this branch unless the text says `formal-main`.

Inputs read: AGENTS.md; docs/research/2026-11-07-state-machines.md sections 2, 5, 6.18; docs/research/state-machines/deploy-ops.md
(M1-M22, D16-D29), journey-signup.md 4.2, mcp-oauth.md; docs/research/quint-findings/{runtime_ops,auth_edge,oauth_mcp}.md;
quint/{runtime_ops,auth_edge,oauth_mcp,join_age}.qnt; on `claude/formal-main`: docs/results/2026-11-09-quint-drift.md and the
models that exist only there (quint/join_flow.qnt, quint/backup_restore.qnt, quint/boot_config.qnt).

Not re-reported (fixed on formal-main by the integration session): the auth_edge rotation race (`PeopleStore.rotateSession`)
and the under-13 age on the invite_only exit (`declineUnderAge`).

## 0. What is already covered in this area

| Code | Machine | Model on this branch | Note |
|---|---|---|---|
| deploy/router.ts:88-127, backend.ts normalizeEdge | edge-trust, proxy-signature (M-061/062) | auth_edge `edgeRequest` | one site, one secret (see G1) |
| backend.ts:61,93,253-259 PREVIOUS secret | proxy-secret-rotation (M-131) | auth_edge `rotateProxySecret` (no PREVIOUS) | formal-main adds `backendPrevious` |
| scripts/wrangler.sh | wrangler-deploy-guard (M-149) | runtime_ops `runWrangler` (2197 argv checked) | complete |
| deploy/cloudflare/worker.ts | cf-backend-cutover (M-147) | runtime_ops `cfActivate/cfDeactivate/cfCron` | SD-159 open; config branch added on formal-main |
| deploy/backend/backend.ts, server.ts, ops.ts | M-141/142/143/150-152 | runtime_ops | complete for this sweep |
| packages/observatory/db/migrate.ts (`db:migrate`) | migration-runner (M-144) | runtime_ops `migrate` (one counter) | see G4 |
| deploy/backup/restore.ts refusals | pg-restore-recovery (M-089) | runtime_ops `restoreRoles`; backup_restore.qnt on formal-main only | SD-165 residual (old manifests) open on formal-main |
| sites/shared/join.ts, auth.ts | web-join client (deploy-ops M20, merged into M-015) | none here; quint/join_flow.qnt on formal-main | see D1 |
| platform env gate | auth-mode-config (M-129) | none here; quint/boot_config.qnt on formal-main | |

Machines in this area that NO model (on either branch) has with states and transitions:

1. `skill-signup` (M-073): the SKILL.md agent onboarding protocol. oauth_mcp.qnt:17 excludes it explicitly.
2. `signup-channel-mode` (M-114): assigned to join_age, absent from join_age.qnt (no Turnstile, OTP-only, Cloud or router term).
3. `sites-deploy-workflow` (M-148) with the four-project secret rotation (M-131 per project): runtime_ops leaves M-148 out; auth_edge has one site.
4. `backup-run` (M-145): runtime_ops models `backupRun` as one atomic step; backup_restore (formal-main) models only restore refusals.
5. Landing-page and Turnstile client timers (agent.ts, turnstile.ts, auth.ts mode lookup): small UI machines, P2.
6. Skill distribution versions (sites.ts writeSkills digest and `?version=`, plugins/build.ts snapshots; M-196 plugin-snapshot): P2, no Quint value.

## 1. New machines

### N1. `skill-signup`: the SKILL.md agent onboarding protocol (P1)

Files: sites/skills/slop-date/SKILL.md:76-148, sites/skills/ntwrk-party/SKILL.md (same steps 1-10, plus the invite branch in
step 8), sites/skills/friends-help/SKILL.md (same template), sites/skills/peon-biz/SKILL.md:52-75 and :115-128 (a different
protocol: web handoff, then MCP), plugin snapshots plugins/{claude,openai}/skills/* (built by plugins/build.ts:69-83).

Two variants.

Variant A, direct OTP (ntwrk, slop, friends). Agent states:
`Idle -> Explaining | AppRead(id, consent.text, consent.version, joinMode, minJoinAge) -> [UnderAge: Stop]
-> Drafting -> DraftApproved -> ConsentApproved(version) -> SessionCheck (GET /api/me if a jar exists)
-> NeedNumber -> ModeChecked (GET /api/auth/mode; cloud: Stop "unsupported") -> OtpRequested (POST otp/start once;
400 turnstile: Stop) -> CodeAsked -> Verified (POST otp/verify once; reject: back to CodeAsked only on the person's request)
-> MeRead (app check; membership: ReportExisting; canJoin false: ExplainReason) -> JoinPosted (once, signupView, consent)
-> [timeout: Ambiguous -> MeRead] -> ReadBack (GET /api/me, GET /api/me/export) -> Confirmed | Discrepancy`.

Variant B, web handoff (peon). `Drafting -> Approved -> LinkGiven(https://peon.biz/join?via=agent#firstName&age)
-> PersonVerifiesOnWeb (join_flow) -> Return -> ConnectorCheck (MCP tools present? else Stop) -> check_status (app == peon)
-> submit_profile once -> check_status -> Confirmed`.

Server side state the protocol reads: otp challenge, session cookie jar (one per exact host), membership, consent
version (`accounts.ts:355` returns `consent_wording` when the wording or version is not current), signupView (`api.ts:515,551`,
ntwrk and friends only), auth mode (`api.ts:400`), Turnstile policy (`api.ts:136-143`, `PLATFORM_PHONE_OTP_ONLY_APPS`
lists only ntwrk, slop, friends).

Rules that should hold (from the SKILL text, AGENTS.md decision 10, PRD 40.3/40.7):
- R1 Join is posted only after explicit approval of this profile and of the current consent version, and only with
  `canJoin:true` from a /api/me read on the same jar (SKILL step 3, 8).
- R2 Join is posted at most once per membership; an ambiguous timeout leads to a read, never to a blind second POST
  (SKILL lines 57-60, step 7).
- R3 No number or code is requested below minJoinAge, in cloud mode, or when Turnstile is required (steps 1, 4, 5).
- R4 Success is claimed only after export read-back matches, home city included (step 9).
- R5 The agent never uses another app's jar or origin (lines 35-37, 53-55, step 7).
- R6 (AGENTS decision 10) the agent never sees the code. Variant A contradicts R6 (step 5-6: the person types the code
  into the agent). This is SD-058, still open as a founder decision; the model should carry both readings as a flag.

Missing branches found while reading (protocol gaps, not code defects):
- `consent_wording` (accounts.ts:355, mapped to "server" for pages in sites/shared/api.ts:48): the SKILL has no step for
  a consent text that changed between step 1 and step 8 (the OTP wait can be minutes). R1 then needs a re-read of
  /api/app and a new approval; the text says only "explain it".
- `409 account_changed` (api.ts:552): only ntwrk and friends return `signupView`; the SKILL says "when present", but has
  no branch for the 409 (another code in the same jar, for example a resumed chat with an older jar).
- `403 review` on /api/me/export (api.ts:581-583): a held number cannot do the step 9 read-back, so R4 can never be met;
  the SKILL has no branch.

Model choice: extend `join_flow.qnt` (formal-main) with a second client kind `agent` (no Turnstile token, a cookie jar, no
generation counter, the R1-R5 guards) against the same server branches that join_flow already has (`/api/me`, `/api/join`,
joinPlan). Variant B is join_flow's own web client followed by oauth_mcp's `submit_profile` (already modelled), so only the
link step and the "submit once" rule are new. If join_flow is not merged into this branch, a new module
`quint/skill_signup.qnt`.

Quint value: medium. Quint cannot check that an LLM follows the prose. It can check that the prose, read as a protocol,
is complete against the server's real answer set (every server answer has a branch, R1-R5 hold on every path), and it
gives a table of required branches that the agent-client test matrix (CONTRIBUTING.md section 8) can then exercise. The
three gaps above are what a typed model of the answers finds at once.

### N2. `signup-channel-mode`: which signup path works for each app and config (P1, model gap of join_age)

States: a config tuple per app `(authMode otp|cloud, turnstileRequired, otpOnlyListed, webJoinServed)` where
`webJoinServed = (app == peon)` (deploy/router.ts:40,46-48 retires /join for ntwrk, slop, friends), `otpOnlyListed` comes
from `PLATFORM_PHONE_OTP_ONLY_APPS` (packages/platform/src/api.ts:139-143; peon is refused at :140), Turnstile is always on
outside dev (api.ts:136), and authMode from `NETWORK_CLOUD_AUTH_*` (api.ts:152-172).
Derived channels: text keyword (always), agent direct OTP (skill variant A, needs otp mode and otpOnlyListed), web /join
(peon only; in cloud mode the button goes to Cloud and returns to the literal "/join", sites/shared/auth.ts:56), agent web
handoff (peon skill), OAuth phone page (MCP).
Transitions: operator env changes and site deploys (a deploy of the router changes webJoinServed).
Rules: every open app (founder 2026-10-09: slop, peon, friends open) has at least one channel that its own SKILL.md tells
the agent to use; a SKILL never names a retired path; ntwrk web stays invite-only. journey-signup.md 4.2 has the matrix
as text: with the default (no OTP-only list) every skill of variant A stops at Turnstile, and in `production-v1` Cloud mode
variant A stops at step 4 and the three /join paths redirect to `/`, so for ntwrk, slop and friends only the text keyword
is left.
Model: extend `join_age.qnt` (its plan, section 6.3, already owns M-114) with constant config sets and one invariant
`openAppHasSkillChannel`. Quint value: low to medium; the state space is a finite table and a table-driven e2e test would
do as well. Quint adds value only when it is joined to N1 (the skill branch that stops is a state of N1).

### N3. `sites-deploy-workflow` with per-project proxy secrets (P1, new module or extend auth_edge)

Files: .github/workflows/deploy-sites.yml:91-207, deploy/pages-worker.ts:21-26, deploy/router.ts:93-94,
deploy/backend/backend.ts:61,93,106,253-259, docs/deploy.md:121,336-338.
States per project p in {slop-date, ntwrk-party, peon-biz, friends-help}: `storedSecret(p)` (Pages binding),
`runningSecret(p)` (the active deployment; a binding applies from the next deployment), `storedOrigin(p)`,
`builtOrigin(p)` (pages-worker BUILT, a project variable wins, pages-worker.ts:24), job step
`WaitApproval -> Inspect -> [Patch -> Readback] -> Build -> Deploy -> Smoke -> Done | Failed`. Backend:
`(secret, previous?)`. Run: `max-parallel: 1`, `fail-fast: false` (yml:98-99), concurrency group per ref, no cancel
for push (yml:41-44).
Transitions: `inspectFails(p)` (yml:155-159: binding review, Turnstile widget FAILED at :168), `patch(p)` (PATCH then
readback, :172-178), `deploy(p)`, `smoke(p)` (fails after the deploy; no rollback), backend `setNewKeepPrevious`,
`dropPrevious` (runbook step 3), Pages dashboard rollback (restores the bundle, not the bindings, docs/deploy.md:248).
Rules: safety: no unsigned request is accepted (holds; fails closed); availability: after `dropPrevious`, every project's
`runningSecret == backend.secret`; a push never changes bindings; a PATCH changes only BACKEND_ORIGIN and, on rotation,
PLATFORM_PROXY_SECRET (readback check :176-177).
Trigger for the availability break: `repair-proxy-and-deploy` -> slop-date patched and deployed -> ntwrk-party Inspect
throws (for example a binding that needs review) -> peon-biz and friends-help continue (fail-fast false) and deploy ->
the run is red, but three sites work, so the operator runs runbook step 3 (`dropPrevious`) -> ntwrk.party answers 421
on every /api, /mcp and /oauth path until a new manual run passes Inspect. No code checks "all four running the new
secret" before step 3; docs/deploy.md:338 says it in words only.
Model: extend auth_edge (formal-main version, which already has `backendPrevious` and `dropPreviousProxySecret`) from one
site to a set of four with per-project stored/running secrets, or a new module `quint/sites_deploy.qnt` that imports the
edge decision. Quint value: medium for the availability property across partial runs and rollbacks; the safety half is
already proved by auth_edge.

### N4. `backup-run` (M-145), the half of backup_restore that is not modelled (P2)

File: deploy/backup/backup.ts:39-131, deploy/backup/lib.ts:75-201, restore.ts:85-117.
States: `Scheduled -> KeyChecked (backup.ts:102-104) -> SnapshotOpen (:47-49) -> Counted -> Dumped (:55) -> SnapshotClosed
-> RolesDumped? (:59-64, outside the snapshot) -> ManifestWritten (:65) -> ProbeWritten (lib.ts:182) -> ProbeChecked
(:186-197) -> ProbeDeleted (best effort, :199) -> Encrypted/Uploaded per file (backup.ts:81-87) -> ManifestUploaded (:89)
-> Heartbeat (:118-122) -> LocalRemoved (:129)`. Restore side: `latest` selection (restore.ts:87-100) reads the newest key
ending in /manifest.json under `BACKUP_PREFIX ?? postgres/<PLATFORM_ENV>`.
Rules: a prefix with a manifest is complete; no plaintext upload outside dev; `latest` never picks an incomplete prefix and
never picks another environment's backup; counts and dump share one snapshot.
Note for a model: `latest` sorts full keys, not stamps (restore.ts:97). With `BACKUP_PREFIX` set to a parent of several
environment prefixes (for example `postgres`), `postgres/staging/...` always sorts after `postgres/production/...`, so
`latest` picks staging's newest backup whatever its time. The default prefix is per environment, so this needs an operator
setting; it is a fact for the model's oracle, not a reproduced defect.
Model: extend formal-main `backup_restore.qnt` with the upload steps and a `latest` oracle, or extend runtime_ops
`backupRun`. Quint value: low; the order is linear and the property "manifest last" is one line of code. Recommend a
run test only (crash after each upload step, then `latest`).

### N5. Small client machines (P2, no module recommended)

- Turnstile handle (sites/shared/turnstile.ts:45-77): `pending -> ready(token) -> pending (reset after every otp/start,
  auth.ts:95; expired-callback) | failed`; a token is single use. Resend with Turnstile goes back to the phone step
  (auth.ts:131-134).
- Auth mode lookup (auth.ts:26-60): up to 3 tries with 1 s, 2 s backoff, then fall back to the OTP form; in Cloud mode the
  backend then answers 409 `cloud_auth_required` (api.ts:463) and the page tells the person to reload. Fails closed.
- Landing "Use in iMessage" (sites/shared/agent.ts:45-71): `clicked -> (pagehide | hidden) opened | 1500 ms -> fallback
  message`; clipboard copy starts inside the click.
These are UI state with no safety rule. formal-main join_flow lists Turnstile and Cloud mode as outside its model; that is
the right call.

## 2. Model gaps (covered machines that miss part of this area)

### G1. auth_edge: one site, one secret, no PREVIOUS window (this branch)
quint/auth_edge.qnt:625-650: `edgeRequest` and `rotateProxySecret` have one `siteSecret` and the backend takes exactly one
secret ("the backend takes exactly one secret", :643). The code has `PLATFORM_PROXY_SECRET_PREVIOUS` and the re-sign path
(backend.ts:93, 253-259, fixed under SD-166). formal-main's auth_edge adds it. This branch's model is stale; port the
formal-main change, then N3 extends it to four projects. The re-sign keeps the client's `ts` (backend.ts:262), so the
60 s window still applies to a previous-key request; the model should keep that guard.

### G2. join_age lacks M-114 (see N2).

### G3. oauth_mcp excludes skill-signup (see N1). The excluded part is the only path in production for ntwrk, slop and
friends agent signups (no MCP in variant A).

### G4. runtime_ops migration ledger is one counter
quint/runtime_ops.qnt:537-545 and `migrationOnce` (:724) model "all pending in one transaction, at most once".
packages/observatory/db/migrate.ts:89-101 has more states per migration: `pending`, `applied(checksum)`,
`changedAfterRun` (a non-repeatable file whose checksum changed is skipped with a log warning only, :91-93), and
`repeatable` (re-run on change). A changed non-repeatable migration gives a fresh database (CI, tests, dev) the new text
and production the old one, with no failure. A per-migration ledger in the model with the invariant "the schema of every
database equals the files" would fail on that state. Quint value: low; a CI check that refuses a changed checksum of a
merged non-repeatable migration is simpler. P2.

### G5. Branch drift: three models exist only on formal-main
join_flow.qnt (sites/shared/join.ts, auth.ts), backup_restore.qnt (restore refusals) and boot_config.qnt (env gate)
cover machines of this sweep, but only on `claude/formal-main`. This branch's sites/shared/join.ts is the older shell
(no join-core.ts), so D1 below is live here and fixed there. Wave 3 should either rebase on formal-main or treat those
three models as the coverage of record. Open drift from that review that falls in this area (inputs, not new):
SD-159 (worker.ts:55 returns before `stop()` when BACKEND_RUNTIME_CONFIG is unset; runtime_ops `inactiveStops`) and the
SD-165 residual (restore.ts:50 falls back to host strings for a manifest without `source.systemId`, so `--roles` through
the TCP proxy host still runs on the source server; backup_restore `rolesViaProxyOldManifestTest`).

## 3. Suspected defects

### D1. The agent handoff prefill (name, age) is wiped at sign-in on peon.biz/join (this branch; fixed on formal-main)
sites/shared/prefill.ts:2-11 sets `input.value` for firstName and age from the URL fragment, then removes the fragment.
sites/shared/join.ts:54-56 `resetAccount` calls `profile?.reset()`, and join.ts:106-107 calls `resetAccount()` in the
sign-in callback. `form.reset()` restores each input to its default value, and sites/peon.biz/public/join.html:50-51 has
no `value` attribute, so both fields become empty.
Trigger: a new visitor (no session) opens `https://peon.biz/join?via=agent#firstName=Alex&age=28` as
sites/skills/peon-biz/SKILL.md:59 and :121 tell the agent to give -> phone step (the prefilled profile form is hidden) ->
enters number and code -> `otpVerify` ok -> `onSignedIn` -> `resetAccount()` -> `profile.reset()` -> the profile step
shows an empty first name and age. Only a visitor who already has a session (me.ok at load, join.ts:94-96) keeps the
prefill. This is the main path the peon skill describes. formal-main (join-core.ts `formResets`, join.ts `resetAccount`
without `reset()`) fixes it, so it is not a new finding there; on this branch no test covers it (no `prefill` in
sites/test).

### D2. Cloud mode loses the agent return note and the prefill on peon.biz/join (P2, latent)
sites/shared/auth.ts:56 calls `api.cloudAuthStart("/join")` with a literal path, so the return URL has no `?via=agent`
(join.ts:164 shows "Go back to the same chat" only with it), and the prefilled values live only in the DOM (prefill.ts:5
removed the fragment). Trigger: `NETWORK_CLOUD_AUTH_ENABLED=true` and `production-v1`, agent link with fragment ->
"Continue with your phone" -> Cloud -> back on /join -> empty name and age, no return note. Production flags are unset
today (docs/results/2026-10-18-production-cloud-network-handoff.md:13), so this is latent. A fix that keeps
`location.search` in the return path changes no rule.

### D3. A rotation can be finished while one project still signs with the old secret (operational, P2)
See N3 for the trigger. Code side: deploy-sites.yml has no final job that checks all four projects before the operator
may drop `PLATFORM_PROXY_SECRET_PREVIOUS`, and backend.ts:93 has no record of which sites still sign with the previous
value. The effect is an outage (421), never a safety loss. A smoke job across all four sites after the matrix, or a
backend counter of previous-key requests (re-sign path, backend.ts:259) that the runbook reads before step 3, would close
it.

### D4. SKILL variant A has no branch for three server answers (protocol defect, P2)
`consent_wording` (accounts.ts:355), `409 account_changed` (api.ts:552) and `403 review` on export (api.ts:581-583). See
N1. With a consent text change during the OTP wait, an agent that follows step 8 literally posts the stale version, gets
400, and has no instruction to re-read /api/app and ask the person again; a retry with the same body repeats the 400.

## 4. Areas swept with nothing new

deploy/router.ts retired paths and `_routes.json` (sites.ts:163, RUN_WORKER_FIRST router.ts:41) agree with
`isBackendPath` (:55-62); deploy/pages-worker.ts merge order is as documented; deploy/smoke.ts is a check list;
deploy/cloudflare/worker.ts keeps the container awake through the per-minute cron (wrangler.toml crons `* * * * *`
against `sleepAfter = "30m"`); scripts/wrangler.sh is fully covered; scripts/platform-dev.ts and sites-dev.ts are dev-only
(they refuse production env and non-local Postgres) and use the production router code; scripts/require-pg.ts,
quint-check.ts, check-contract-mirror.ts (M-182, left out on purpose), synthetic/* (data) and sim/* (left out by 6.18)
hold no product state; plugins/build.ts --check passes ("plugin skill snapshots are up to date").
