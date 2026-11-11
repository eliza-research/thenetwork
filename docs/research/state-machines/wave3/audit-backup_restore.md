# Audit: quint/backup_restore.qnt coverage

Read: quint/backup_restore.qnt (238 lines), quint/drift.json `backup_restore`, docs/formal-coverage.md:44-47,
docs/results/2026-11-09-quint-drift.md:47-59, docs/research/2026-11-07-state-machines.md SD-165/SD-362/SD-363,
docs/research/quint-findings/runtime_ops.md (M-089 rows), docs/research/lemmascript/wave3-platform.md:10-18,
and in full: deploy/backup/restore.ts, refusal.ts, lib.ts, backup.ts, restore-source.integration.test.ts,
docs/deploy.md 8.1-8.2, docs/runbook-real.md 8. There is no quint-findings/backup_restore.md.

Model check: `bun run quint:check quint/backup_restore.qnt`: typecheck, tests, safety, 7 witnesses ok (15 s).

Mutation probes (scratchpad copies, wave3/probe/):
- m1: `restoreRefusal` never returns "rolesOnSource" (qnt:63 -> `if (false)`): **safety still holds** (No violation, 20000 samples).
- m2: m1 plus the `not(maybeSource(f))` conjunct removed from runsRoles (qnt:69): safety violated.
- m3: the exists check removed (qnt:108 -> `if (false)`): safety violated (createsOnlyNew / neverSourceDatabase).

## model_error

1. **P1 runsRoles masks the roles refusal (qnt:66-69, 115).** restore.ts:68 runs roles.sql on
   `o.roles && manifest.files.roles && existsSync(...)`; it has no source condition. The model adds
   `not(maybeSource(f))`. So the safety invariants `rolesOnlyOffRecordedSource` and
   `rolesNeverOnSourceWithSystemId` hold even with the `rolesOnSource` refusal deleted (probe m1). The
   model cannot detect a regression of the one refusal it exists to check. Fix: make runsRoles
   `f.roles and rolesFilePresent` (the code), so the guard at qnt:107 alone carries the invariant.
2. **P2 cluster identifier assumed stable and unique (qnt:27-30, 98-101).** The model sets
   `systemId equal <=> server == "S"`. In the code (restore.ts:48,53) the id is pg_control_system():
   - It changes when S is re-initialised (pg_upgrade major upgrade, a new cluster at the same service).
     A manifest recorded before that has the old id; through the proxy host the check falls back to
     host strings and roles.sql runs on S. `rolesNeverOnSourceWithSystemId` cannot see this case.
   - It is shared by a physical copy: runbook-real.md 8.2 step 5 restores a Railway volume backup into a
     new service. That copy has S's id, so --roles and the own-database name are refused there (fail
     closed; availability only).
   Fix: add a nondet `idMatches` independent of `server` for an "upgraded S" and a "volume clone N".
3. **P2 guard restatements.** createsOnlyNew (`c.existed` is always false by construction, qnt:108-114),
   neverLiveName, onlySafeNames, onlyKnownVersion, neverUndecrypted and drillDropsPrivileges (restates the
   privilegeFlags def, qnt:70/166) only re-read the guards of the same action. They fail only if the
   check order of restoreAttempt changes, not on any code behaviour outside it.
4. **P2 initialKept cannot fail (qnt:121-123, 168).** Only dropScratch removes a database, and it is
   guarded by `not(INITIAL_DBS.contains(...))`. The code's real drop path, the catch at restore.ts:75-81
   (`drop database if exists "<db>" with (force)` by name), is not an action. Model it as
   `restoreFail(server,name)` that drops the attempt's own database, so initialKept checks that the catch
   is only reachable after this run's `create database`.
5. **P2 vacuous parts of the name domain.** LIVE contains template0/template1 but NAMES does not
   (qnt:46-48), so neverLiveName never meets a template name. Port is not modelled (lib.ts:206 compares
   port too). Host strings are assumed unique per server (see gap 4).

## model_gap

1. **P1 the live server after a recovery.** The model fixes S as both the backup source and the live
   server for all time, with one backup. After runbook-real.md 8.3, the empty replacement N becomes the
   live server. Backups taken before the switch name S. restore.ts:50-55 then allows `--roles` on N
   (it is "not the source"), so roles.sql (CREATE/ALTER ROLE, GRANT memberships, whole server) runs on
   the live server. Adding a second backup source and a `promote(N)` step would break the rule as the
   header states it ("never changes a role ... of the source server" is met; "of a live server" is not).
   See suspected_defect 2.
2. **P1 the download path and the bucket as an input (restore.ts:91-123).** Not in the model: "latest"
   selection by key sort, keyId check, decryption, the plain manifest written after download, and the
   absence of any check that a manifest is encrypted when a key is set. A bucket writer is a real actor
   (R2 token with Object Read & Write, deploy.md 8.1). Adding it breaks the encryption claim of
   deploy.md 8.2 ("a changed file stops it"). See suspected_defect 1.
3. **P2 failure paths after create (restore.ts:66-82).** roles.sql failure (logged, continues),
   pg_restore failure, row-count failure -> catch drop; a drop failure is logged and the database stays.
   A mismatch result keeps the database (return path, exit 1). A process kill (SIGINT/SIGTERM) skips
   both the catch and the `finally` that removes the temp dir. The model has none of these as states, so
   "no failed restore leaves member data" (header line 9-10) is not an invariant. Adding them breaks
   nothing in `safety` but would show the orphan state (suspected_defect 3).
4. **P2 roles side effects survive the drop.** roles.sql runs before pg_restore (restore.ts:68-72). A
   later pg_restore failure drops the database but not the roles made on N. Not modelled (cluster roles
   are not state). No invariant breaks (N is not the source).
5. **P2 host string collisions.** `postgres.railway.internal:5432` is the same string for a Postgres
   service in another Railway project or environment. sameServer (lib.ts:204-207) says "same server",
   so restores on a real other server are refused (fail closed). Not modelled; fail-closed only.
6. **P2 silent roles skip.** With --roles and `files.roles` missing (backup made without superuser,
   backup.ts:59-64) or the plain roles file missing (encrypted --from dir), restore.ts:68 skips roles.sql
   with no log. With --keep-privileges on an empty server, pg_restore then fails on missing owners and
   the catch drops. Model has rolesFile nondet but no outcome for "asked for roles, none ran".
7. **P2 concurrency.** Two restores with one name: the code is safe (the second `create database`
   fails inside the first try, restore.ts:61-62, before the catch that drops). The model's atomic step
   cannot show this; a two-phase (check, create) split would confirm it.
8. **Out of model and covered elsewhere:** backup.ts (snapshot, manifest-last upload, privacy probe,
   key required outside dev, heartbeat) is runtime_ops M-089/M-145 (formal-coverage.md:44-45); M-145
   backup-run is listed as left out in quint-findings/runtime_ops.md:25.

## open_carveout

1. **SD-165 residual, old manifests (drift.json backup_restore; qnt:175-178, 235-237;
   quint-drift.md:57).** `rolesNeverOnSourceServer` is out of `safety`. Trigger: a manifest with
   `source` but no `systemId`, `--roles`, target through the TCP proxy -> roles.sql on S. Fixable now in
   scope (security, small): in restore.ts:52-53 treat `--roles` as on-source unless
   `manifest.source?.systemId` is present (for example `sourceKnown: !!manifest.source?.systemId` for
   the roles fact only, or a new fact `idKnown` in RestoreFacts with a LemmaScript ensures
   `roles && !idKnown ==> refused`). Add a case to restore-source.integration.test.ts with a manifest
   without systemId (it fails today). Then move rolesNeverOnSourceServer into `safety`. Old backups
   expire after 35 days in R2, but `--from` copies on disk do not.
2. **SD-363 (failed restore leaves a database):** fixed for thrown errors (818df9d, restore.ts:75-81);
   still open for a mismatch exit (by design, operator drops, runbook 8.2 step 6) and for a kill
   (suspected_defect 3). Not modelled.
3. **SD-362 (deploy.md prefix):** fixed in the doc (deploy.md 8.2 sets BACKUP_PREFIX). Not modelled; no
   action needed in the model.
4. No other invariant is kept out of `safety`; all 7 witnesses are reachable.

## suspected_defect

1. **P1 security: encryption downgrade through an unauthenticated manifest (restore.ts:107-121,
   lib.ts:31-32, deploy.md 8.2).** `download` decrypts only `if (manifest.encryption)`; a manifest
   without that field is accepted even when BACKUP_ENCRYPTION_KEY is set, and the manifest itself has no
   MAC. Trigger: someone with write access to `ntwrk-backups` (the R2 token, or a Cloudflare account
   member with R2 write) uploads `postgres/production/99999999T999999Z/manifest.json` with
   `version:1`, no `encryption`, a `source` with another host and systemId, and a plain crafted
   `db.dump` (and `roles.sql`). The documented drill `restore.ts --r2 latest` (runbook 8.2 step 2) sorts
   that prefix last (restore.ts:103), writes the files plain, and runs pg_restore of the crafted archive
   as the owner login (`postgres` on Railway, deploy.md 8.2) on the production server: arbitrary SQL as
   superuser (ALTER ROLE on live roles, COPY ... PROGRAM). With `--roles`, psql -f also runs any SQL and
   psql meta-commands. AES-GCM protects the files only when the restore insists on it. Fix: in
   `download`, refuse a manifest without `encryption` when a key is given or set, or when PLATFORM_ENV is
   not dev (mirror backupKeyFromEnv); optionally MAC the manifest with an HKDF sub-key and bind file names
   as GCM AAD. Test: backup-cli.integration.test.ts with a plain manifest in an encrypted prefix.
2. **P2 roles.sql on the live server after a recovery (restore.ts:50-55, 68-69; runbook 8.3).**
   Trigger: recover onto empty server N (8.3), cut the service over to N, set new passwords (step 4).
   Later (a retry of an older point in time, or a drill) run `--r2 postgres/production/<pre-recovery
   stamp> --roles` with RESTORE_DATABASE_URL on N. manifest.source names S (host and systemId of S), so
   sameServer is false and roles.sql runs on the live N: ALTER ROLE resets attributes (LOGIN, CREATEDB,
   BYPASSRLS ...) and GRANTs restore old memberships. The refusal is source-based, not live-based. Fix
   options: refuse `--roles` unless the target server has no non-system roles other than the login
   (a direct "empty server" check, matching the docs' rule "only to rebuild an empty replacement
   server"), or require an explicit `--empty-server` confirmation that the script verifies.
3. **P2 kill during a restore leaves plaintext and a scratch database (restore.ts:131-145, 66-82).**
   Trigger: `--r2 latest`, Ctrl-C (SIGINT) during pg_restore. The default signal exit runs neither the
   catch (no drop) nor the `finally` (no `rm` of `/tmp/network-restore-*`). The decrypted `db.dump` and
   `roles.sql` (mode 0600) stay on the operator's disk, and the scratch database with member data stays
   on the server. Runbook 8.2 step 6 asks for manual cleanup only after a pass. Fix: a SIGINT/SIGTERM
   handler that drops the database it created and removes `tmp`, then exits non-zero.
4. **P2 "latest" can pick a non-backup prefix (restore.ts:97-105).** Any key under the root that ends in
   `/manifest.json` counts, at any depth; a nested prefix such as `postgres/production/drills/x/` sorts
   after the `2026...` stamps ('d' > '2'). Fail mode is a wrong (older or foreign) backup, logged as
   `backupAt`. Fix: accept only `<root><stamp>/manifest.json` with the stamp pattern of backup.ts:106.
