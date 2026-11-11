# Audit: quint/boot_config.qnt coverage (2026-11-11)

Read: quint/boot_config.qnt (247 lines), its quint/drift.json entry (file hashes only, no "drift" list),
docs/formal-coverage.md rows 40, 43, 372, docs/results/2026-11-09-quint-drift.md "boot_config",
docs/research/state-machines/deploy-ops.md (M5 notes line 249-251, D10 line 644), code:
packages/platform/src/env.ts, env-core.ts, otp-config.ts, every caller of assertBootConfig /
requirePlatformEnv / devShortcutsAllowed / isProduction / platformEnv, deploy/backend/server.ts,
deploy/backend/backend.ts loadConfig (85-170), packages/network/service/main.ts, service.ts (104-110,
335-395, 515-525), api.ts 128-140, serve.ts 36-46, mcp/handler.ts 150-200, mcp/dev-server.ts,
scripts/platform-dev.ts, observatory/src/staff.ts parseTokenGrants. No findings file exists for this module.

Probe: two mutants in scratchpad/wave3/bc/ (dev branch of bootOk always true; useShortcut guarded by
"declared" instead of devAllowed). `quint run --invariant=safety` finds a violation for both, so the
invariants are not vacuous with respect to the pure defs.

## 1. model_error

E1 (P1). The model's boot gate is not the production boot gate. The header (lines 8-10) says main.ts
calls assertBootConfig first. Production runs deploy/backend/server.ts (Dockerfile:36,
package.json "start:backend", docs/deploy.md:22,81). server.ts:31 calls backend.ts loadConfig, which
calls only requirePlatformEnv (backend.ts:87) and its own hand-written checks (backend.ts:89-113).
No production code path calls bootConfigProblems / bootProblems (only main.ts:31 and one test do).
So the LemmaScript-proved bootProblems and the 4 invariants describe the local runner
(packages/network/service/main.ts), not the deployed process. docs/formal-coverage.md:372 marks
env.ts "covered" and :40/:43 say boot is covered in runtime_ops; runtime_ops (M-143) models the boot
steps after the config check, not the config decision. The divergence was noted in
deploy-ops.md:249 (D10) but the model header still states main.ts is the gate.
Effect on invariants under server.ts:
 - startedDevNotProduction FAILS: NODE_ENV=production + PLATFORM_ENV=dev -> requirePlatformEnv
   returns "dev", deployed=false, no refusal (see D1 below).
 - startedDeployedIsReady: review != Auto and not(devSwitch) are not checked by loadConfig; holds
   only because nothing reads those variables (E3). The other clauses are checked by loadConfig
   (database 92, hash/session/turnstile 94, OTP 95, proxy 96 + length 108-110), plus extra ones
   the model does not have (LEAK_LABEL_KEY 112, MIGRATION_DATABASE_URL 103-105, previous proxy
   secret length 108).
 - startedOnlyDeclared and shortcutsOnlyInDev hold on both paths.

E2 (P2). The invariants restate the defs. startedDeployedIsReady (166-170) is the body of
deployedReady; shortcutsOnlyInDev (179-184) is the two `ensures` of env-core.ts devAllowed (35-36);
startedDevNotProduction is the third ensures of bootProblems (114). `boot` is guarded by bootOk and
`useShortcut` by devAllowed, so the state machine adds only "snapshot at start". The model can fail
only if a def differs from its own restatement, which LemmaScript already proves. The real
questions (does every entry point run the gate; does every shortcut ask devAllowed) are "OUTSIDE
THE MODEL" (lines 40-43).

E3 (P1). Two invariant clauses guard dead variables. NETWORK_REVIEW_MODE and PLATFORM_DEV_* have no
reader outside env.ts / env-core.ts (repo grep). The comment at 163-165 cites "CLAUDE.md human
review", but the review gate does not read NETWORK_REVIEW_MODE (review is fixed to "human" in the
service path, deploy-ops.md:741). So `review != Auto` and `not(devSwitch)` cannot connect to any
behaviour: the invariant is weaker than the rule it names (human review is enforced in
packages/network, not here), and a deployed process with NETWORK_REVIEW_MODE=auto (server.ts path)
behaves exactly like one without it.

E4 (P2). Snapshot assumption is too strong. Line 43 says "Node and Bun read the environment at
start". process.env is mutable; scripts/platform-dev.ts:47 writes PLATFORM_ENV ??= "dev" and
:61 PLATFORM_PROXY_SECRET after start, and every shortcut caller re-reads env at construction time
(api.ts:130-132 `o.env ?? process.env`, serve.ts:38-39, service.ts:337/348, handler.ts:194). No
code snapshots the boot env. Harmless today (the writes happen before construction and only in the
dev runner), but the model's `snap` has no code counterpart, and an injected `o.env` that differs
from the env the gate checked is possible (tests do it).

E5 (P2). Abstraction `db` = "NETWORK_DATABASE_URL or DATABASE_URL is set" matches env-core.ts:98
(`!== ""` on either) but not main.ts:34 (`NETWORK_DATABASE_URL ?? DATABASE_URL`): with
NETWORK_DATABASE_URL="" and DATABASE_URL=x the gate passes and main.ts:35 throws. Fail closed, but
the model claims the gate equals the start condition. (server.ts uses `||`, backend.ts:90, so it agrees.)

## 2. model_gap

G1 (P1). The second entry point: deploy/backend/server.ts + loadConfig (backend.ts:85-170). Its own
decision table: deployed = staging|production; required DATABASE_URL always; hash/session/turnstile/
OTP/proxy when deployed; LEAK_LABEL_KEY >= 32 bytes (TextEncoder, not UTF-16 length) when deployed;
MIGRATION_DATABASE_URL distinct from the service URL when deployed and MIGRATE_ON_BOOT != 0; channel
config throws (147-148). Adding it as `bootBackend` with guard loadConfigOk(cfg) BREAKS
startedDevNotProduction (trace: configure{platformEnv:"dev", nodeEnv:"production"}, bootBackend).
Needs new Config fields: leakLen, migrationDistinct.

G2 (P1). Second configuration source: platform.settings.environment. service.ts:519-521 refuses when
PLATFORM_ENV is declared and the row differs; server.ts:44-55 moves the row dev -> PLATFORM_ENV once
with PLATFORM_DB_ENVIRONMENT_INIT=1 (deployed only). The 555-01xx trigger
(observatory/db/migrations/0003_platform.sql:222-231, 0015:104) reads that row, not PLATFORM_ENV.
Not modelled here or in runtime_ops (grep: no environment state). Gaps to add: dbEnv in
{missing, dev, staging, production}, action dbInit (deployed and flag and dbEnv == dev), check
`started => dbEnv == declared or dbEnv == missing`. Adding `missing` shows a declared production
process can run with no environment row (service.ts:520 `envRow &&`), and then the synthetic-phone
guard is off. Not a break of the current 4 invariants; a new invariant "production process =>
dbEnv == production" would fail on the missing row.

G3 (P2). Post-gate refusals in the same process (all fail closed, none break an invariant, but the
model treats "bootOk => started"): service.ts:343-344 turnSecretProblem (SERVICE_TURN_SECRET >= 32
when the turn path is on), 348-349 hash key, 351 parseTokenGrants (explicitApp only in production),
353-356 turn secret distinct from staff tokens, 383 devMatching only in dev; api.ts:133-137 (hash
key, trustForwardedHost only in dev, Turnstile verifier outside dev); backend.ts 147-148 channel.
A witness "bootOk and still not up" would document them.

G4 (P2). Shortcut decisions that do not call devAllowed (the model has one useShortcut that asks
devAllowed): main.ts:47 trustForwardedHost uses `env === "dev"` from assertBootConfig (equivalent
only because the gate refused dev+production); handler.ts custom ChatGPT Slop reads raw
PLATFORM_ENV (stricter); relay-endpoint.ts:86 and service.ts:351 use isProduction, so staging gets
the lax branch (rules-only relay without Clef keys; staff tokens without an app). These are
"staging is not production" decisions the model does not show; none is a dev shortcut in the
env.ts sense, but service.ts:351 is a security-relevant config split (see D2).

G5 (P2). Restart/retry: railway.toml restartPolicyType ON_FAILURE, max 5 retries. A refused boot
(the model's `refused`) is retried with the same config up to 5 times and then stays down; the model
lets boot retry without bound and has no "down for good" state. No invariant at risk.

G6 (P2). Secret length units: env-core.ts counts UTF-16 code units (`.length`), loadConfig counts
UTF-16 for proxy/hash/session (108-110) and bytes for LEAK_LABEL_KEY (112). The model's LENGTHS
{0,10,32} has no unit. No break; note only.

## 3. open_carveout

C1. "OUTSIDE THE MODEL: each caller of devShortcutsAllowed" (lines 41-42). Can be closed in scope:
replace the one useShortcut with one action per caller kind (otp.ts:36, turnstile.ts:41,
api.ts:132-137, serve.ts:39, service.ts:348/383, handler.ts:157/194, dev-server.ts:11, main.ts:47),
each with the guard the code uses. main.ts:47 would then need the gate refusal to keep
shortcutsOnlyInDev true; on the server.ts path main.ts:47 is not used (server.ts:82 passes false).

C2. "process.env changes inside a running process" (line 43). Close by documenting E4 instead of
asserting immutability; optionally model an `envWrite` before construction for platform-dev.ts.

C3. drift.json has no drift list and the 2026-11-09 drift review found nothing open; that review
checked env.ts vs env-core.ts and "main.ts calls assertBootConfig first" but did not check which
entry point production runs (E1). Reopen as a drift item.

C4. SD-164 (deploy-ops D10) is fixed in loadConfig for staging/production (backend.ts:94, 110,
boot-secrets.integration.test.ts), but the residual on the dev+production path remains (D1).

All of C1-C4 and the fix for D1 are in scope (security, fail-closed boot; CONTRIBUTING section 3).
Fix: make loadConfig call bootConfigProblems(e) first (or call assertBootConfig in server.ts before
loadConfig) so both entry points run the proved gate; keep loadConfig's extra checks. Test: an
integration case in deploy/backend/boot-secrets.integration.test.ts that boots server.ts with
PLATFORM_ENV=dev, NODE_ENV=production and expects exit 1 (fails before the fix). Model: add G1 as a
second boot action with the same gate after the fix.

## 4. suspected_defect

D1 (P1, new trigger for the D10 residual). The deployed entry point starts "dev that says
production". Trigger: on the Railway backend (server.ts), set PLATFORM_ENV=dev and NODE_ENV=production
(NODE_ENV=production is the documented value for builds, docs/deploy.md:216), with DATABASE_URL and
PLATFORM_HASH_KEY and TURNSTILE_SECRET_KEY set, against a database whose environment row is still
'dev' (a fresh database, migration 0003) or missing. Steps: backend.ts:87 requirePlatformEnv -> "dev";
:89 deployed=false, so no OTP/proxy/session/leak-key/migration-login check; server.ts:44 and :57
skip the environment init and serviceLoginProblem (so a superuser/BYPASSRLS URL is accepted);
service.ts:519-521 passes (declared dev == row dev). devShortcutsAllowed is false (productionEnv),
so api.ts:134 sets the session secret to PLATFORM_HASH_KEY (the SD-164 one-key-two-uses case), the
leak guard labels stay unkeyed (server.ts:33), and migrations run with the service URL
(backend.ts:103). bootProblems (env-core.ts:120) refuses this exact configuration, and main.ts would
not start. Mitigation: the bind is 127.0.0.1 (backend.ts:128), so on Railway the public port is
unreachable and the health check fails; impact is a misconfigured process that runs migrations and
ticks (sends stay dry-run unless the live flags are set; the channel decision 145 does not depend
on `deployed`, so with NETWORK_CHANNEL + BLOOIO_ALLOW_SEND + NTWRK_LIVE_APPROVED set it ticks live
networks with an unkeyed leak label key and a session key equal to the hash key).

D2 (P2). Staff bearer tokens of the service have no minimum length. service.ts:351 calls
parseTokenGrants(o.tokens, { explicitApp }) without minLength; the Observatory requires 32
(observatory/src/server.ts:273). NETWORK_SERVICE_CONSOLE_TOKEN has no length check either. Neither
boot gate (bootProblems, loadConfig) checks them. Trigger: deploy with
NETWORK_SERVICE_TOKENS="reviewer@*:abc"; the staff port accepts a 3-character bearer for every app's
review queue. Mitigated by the staff port being private (docs/deploy.md:31), but every other
deployed secret has the 32 rule. Fix in scope: pass minLength: 32 when deployed (and check the
console token), with an integration case that boots with a short token and expects a refusal.

D3 (P2, benign). main.ts:34 `??` vs the gate's "either non-empty" (E5): NETWORK_DATABASE_URL=""
with DATABASE_URL set passes assertBootConfig and then throws at main.ts:35. Fail closed; only the
error text is wrong.
