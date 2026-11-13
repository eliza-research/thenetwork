# Database restore

## Story: Database restore

An operator needs to restore a backup into a scratch database without modifying a live database.

### Safety rules and reachability

Check target placement, manifest validation, decryption, and privilege flags. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/backup_restore.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=20000
//
// backup_restore: the refusal rules of a restore (docs/deploy.md 8.2, runbook-real.md 8).
//
// WHAT THIS MODELS
//   deploy/backup/restore.ts restore(): the checks before it creates a database and before it runs
//   roles.sql. Each function of deploy/backup/refusal.ts (LemmaScript, proved) is a pure def here with
//   the same name and the same decision: targetRefused, maybeSource, restoreRefusal. The checks that
//   restore.ts makes inline are pure defs with model names: manifestVersionKnown (manifest.version !== 1),
//   runsRoles (o.roles && files.roles && existsSync) and privilegeFlags (keepPrivileges). The action
//   `restoreAttempt` calls them in the order of restore.ts and does not decide again. The `exists`
//   check (a SQL read of pg_database) is in the shell, so it is in the action.
//   runtime_ops.qnt (M-089) models the restore as one step of the recovery (what a restore rolls back).
//   This model is the other half: which targets a restore refuses.
//
// BOUNDS
//   Two servers: S (the source) and N (an empty replacement). S has two host names: "s-int" (the
//   private name that the backup job records in manifest.source) and "s-proxy" (the TCP proxy that a
//   drill can use). N has the host name "n". The backup is of the database "appdb" on S.
//   Names: three live names ("railway" is not on any server), the source database, two scratch names, and one name that safeDbName refuses.
//   The manifest fields come from nondet choices for each attempt (version 1 or 2, source recorded or not,
//   encrypted or not, dump present or not). Run with --max-steps=12.
//
// ORACLES
//   safeDbName (a regex in lib.ts) is the set SAFE_NAMES. The sameServer fact of restore.ts is
//   lib.ts sameServer (host strings: here `host == "s-int"`) OR manifest.source.systemId equal to the
//   target's pg_control_system() identifier (SD-165 fix). The identifier is the same through every host
//   name of S, so here it is `systemIdRecorded and serverOf(host) == "S"`. A backup older than the
//   systemId field has a source without it (nondet systemIdRecorded). The file checks (existsSync) are
//   nondet booleans.
//
// OUTSIDE THE MODEL
//   pg_restore, the row-count check, the download and the decryption, the role statements themselves.
//   A failed roles.sql, pg_restore or row count drops the new database (restore.ts catch, drop database
//   if exists ... with (force)); a drop that fails is logged for the operator. dropScratch covers both
//   that drop and the operator's drop after the drill.
module backup_restore {

  // ---------------------------------------------------------------- constants
  pure val SERVERS = Set("S", "N")
  pure val HOSTS = Set("s-int", "s-proxy", "n")
  pure def serverOf(h: str): str = if (h == "n") "N" else "S"
  pure val SOURCE_HOST = "s-int"
  pure val SOURCE_DB = "appdb"
  pure val NAMES = Set("railway", "network", "postgres", "appdb", "drill_a", "drill_b", "Bad-Name")
  pure val SAFE_NAMES = Set("railway", "network", "postgres", "appdb", "drill_a", "drill_b")
  pure val LIVE = Set("railway", "network", "postgres", "template0", "template1")

  // ---------------------------------------------------------------- the core (refusal.ts)
  // refusal.ts RestoreFacts (safeName and liveName are passed as true and false: targetRefused ran before).
  type RestoreFacts = {
    ownName: bool, sourceKnown: bool, sameServer: bool,
    roles: bool, encrypted: bool, dumpPresent: bool,
  }

  pure def targetRefused(safeName: bool, liveName: bool): bool = not(safeName) or liveName
  pure def manifestVersionKnown(v: int): bool = v == 1
  pure def maybeSource(f: RestoreFacts): bool = not(f.sourceKnown) or f.sameServer
  // restoreRefusal without the name step (restore.ts passes safeName: true, liveName: false).
  pure def restoreRefusal(f: RestoreFacts): str =
    if (f.ownName and maybeSource(f)) "ownDatabase"
    else if (f.roles and maybeSource(f)) "rolesOnSource"
    else if (f.encrypted and not(f.dumpPresent)) "encrypted"
    else "ok"
  // restore.ts: o.roles && manifest.files.roles && existsSync(roles). It runs only after restoreRefusal
  // said ok, so not(maybeSource(f)) holds there; the conjunct says so.
  pure def runsRoles(f: RestoreFacts, rolesFilePresent: bool): bool =
    f.roles and rolesFilePresent and not(maybeSource(f))
  pure def privilegeFlags(keep: bool): List[str] = if (keep) [] else ["--no-owner", "--no-privileges"]

  // ---------------------------------------------------------------- state
  // One database a restore created, with the inputs of that restore (ghost history for the invariants).
  type Created = {
    server: str, name: str, existed: bool, version: int, sourceRecorded: bool, hostIsSource: bool,
    systemIdRecorded: bool, encrypted: bool, dumpPresent: bool, rolesRan: bool, keep: bool, flags: List[str],
  }

  var dbs: Set[(str, str)]
  var created: Set[Created]
  var outcome: str

  pure val INITIAL_DBS: Set[(str, str)] = Set(
    ("S", "postgres"), ("S", "template0"), ("S", "template1"), ("S", "network"), ("S", SOURCE_DB),
    ("N", "postgres"), ("N", "template0"), ("N", "template1"),
  )

  action init = all {
    dbs' = INITIAL_DBS,
    created' = Set(),
    outcome' = "none",
  }

  /** restore.ts restore(): the checks in their order, then create database, then roles.sql. */
  action restoreAttempt(host: str, name: str, roles: bool, keep: bool, version: int, sourceRecorded: bool,
                        systemIdRecorded: bool, encrypted: bool, dumpPresent: bool, rolesFile: bool): bool = {
    val server = serverOf(host)
    val idRecorded = sourceRecorded and systemIdRecorded
    val p: RestoreFacts = {
      ownName: name == SOURCE_DB, sourceKnown: sourceRecorded,
      sameServer: sourceRecorded and (host == SOURCE_HOST or (idRecorded and server == "S")),
      roles: roles, encrypted: encrypted, dumpPresent: not(encrypted) or dumpPresent,
    }
    val existed = dbs.contains((server, name))
    if (targetRefused(SAFE_NAMES.contains(name), LIVE.contains(name))) all { outcome' = "name", dbs' = dbs, created' = created }
    else if (not(manifestVersionKnown(version))) all { outcome' = "version", dbs' = dbs, created' = created }
    else if (restoreRefusal(p) != "ok") all { outcome' = restoreRefusal(p), dbs' = dbs, created' = created }
    else if (existed) all { outcome' = "exists", dbs' = dbs, created' = created }
    else all {
      outcome' = "created",
      dbs' = dbs.union(Set((server, name))),
      created' = created.union(Set({
        server: server, name: name, existed: existed, version: version, sourceRecorded: sourceRecorded,
        hostIsSource: host == SOURCE_HOST, systemIdRecorded: idRecorded, encrypted: encrypted, dumpPresent: p.dumpPresent,
        rolesRan: runsRoles(p, roles and rolesFile), keep: keep, flags: privilegeFlags(keep),
      })),
    }
  }

  /** The operator drops a scratch database after the drill (restore.ts header). */
  action dropScratch(server: str, name: str): bool = all {
    dbs.contains((server, name)), not(INITIAL_DBS.contains((server, name))),
    dbs' = dbs.exclude(Set((server, name))),
    created' = created,
    outcome' = "dropped",
  }

  action step = any {
    nondet host = HOSTS.oneOf()
    nondet name = NAMES.oneOf()
    nondet roles = Set(true, false).oneOf()
    nondet keep = Set(true, false).oneOf()
    nondet version = Set(1, 2).oneOf()
    nondet sourceRecorded = Set(true, false).oneOf()
    nondet systemIdRecorded = Set(true, false).oneOf()
    nondet encrypted = Set(true, false).oneOf()
    nondet dumpPresent = Set(true, false).oneOf()
    nondet rolesFile = Set(true, false).oneOf()
    restoreAttempt(host, name, roles, keep, version, sourceRecorded, systemIdRecorded, encrypted, dumpPresent, rolesFile),
    nondet sv = SERVERS.oneOf()
    nondet n = NAMES.oneOf()
    dropScratch(sv, n),
  }

  // ---------------------------------------------------------------- invariants
  // docs/deploy.md 8.2 "any database that exists" (restore.ts exists check): a restore only creates a new database.
  val createsOnlyNew = created.forall(c => not(c.existed))
  // restore.ts header "the live names" (refusal.ts targetRefused, restore.ts LIVE_NAMES): no live name is ever created.
  val neverLiveName = created.forall(c => not(LIVE.contains(c.name)))
  // restore.ts header "only a safe name" (lib.ts safeDbName via targetNameRefused).
  val onlySafeNames = created.forall(c => SAFE_NAMES.contains(c.name))
  // docs/deploy.md 8.2 "the source's own database on the source server is refused" (restoreRefusal RESTORE_OWN_DATABASE,
  // with the exists check behind it): no restore targets appdb on S, under any host name.
  val neverSourceDatabase = created.forall(c => not(c.server == "S" and c.name == SOURCE_DB))
  // lib.ts Manifest version 1 (manifestVersionKnown): a restore reads only a known manifest.
  val onlyKnownVersion = created.forall(c => c.version == 1)
  // restore.ts header "An encrypted backup needs BACKUP_ENCRYPTION_KEY" (restoreRefusal RESTORE_ENCRYPTED).
  val neverUndecrypted = created.forall(c => not(c.encrypted and not(c.dumpPresent)))
  // restore.ts header "roles.sql runs only with --roles, and only on a server that is not the source" (runsRoles),
  // as the code can see it: the backup names its source, and the target host string is another one.
  val rolesOnlyOffRecordedSource = created.forall(c => c.rolesRan implies (c.sourceRecorded and not(c.hostIsSource)))
  // SD-165 fix (restore.ts:48-53, manifest.source.systemId): when the backup records the cluster
  // identifier, roles.sql never runs on the source server, under any host name.
  val rolesNeverOnSourceWithSystemId = created.forall(c => (c.rolesRan and c.systemIdRecorded) implies c.server != "S")
  // docs/deploy.md 8.2 "The drill (default) restores with --no-owner --no-privileges" (privilegeFlags).
  val drillDropsPrivileges = created.forall(c => not(c.keep) implies c.flags == ["--no-owner", "--no-privileges"])
  // A database that existed before any restore is still there: a restore never drops one.
  val initialKept = INITIAL_DBS.subseteq(dbs)

  val safety = and {
    createsOnlyNew, neverLiveName, onlySafeNames, neverSourceDatabase, onlyKnownVersion,
    neverUndecrypted, rolesOnlyOffRecordedSource, rolesNeverOnSourceWithSystemId, drillDropsPrivileges, initialKept,
  }

  // SD-165 residual: the rule is "never on the source server". A backup with a source but no systemId
  // (made before backup.ts recorded it) falls back to host strings. Through "s-proxy" the target reads
  // as another server, and roles.sql runs on S. Outside `safety`; rolesViaProxyOldManifestTest replays it.
  val rolesNeverOnSourceServer = created.forall(c => c.rolesRan implies c.server != "S")

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // A drill restores into a new database on the new server, and runs roles.sql there.
  val witness_rolesOnNewServer = not(created.exists(c => c.server == "N" and c.rolesRan))
  // A scratch drill on the source server itself (no --roles).
  val witness_scratchOnSource = not(created.exists(c => c.server == "S" and c.name == "drill_a"))
  // The own-database refusal fires.
  val witness_ownDatabaseRefused = outcome != "ownDatabase"
  // The --roles refusal fires.
  val witness_rolesRefused = outcome != "rolesOnSource"
  // The encrypted refusal fires.
  val witness_encryptedRefused = outcome != "encrypted"
  // The exists check fires (a second drill with the same name).
  val witness_existsRefused = outcome != "exists"
  // A real recovery keeps owners and grants.
  val witness_keepPrivileges = not(created.exists(c => c.keep and c.flags == []))

  // ---------------------------------------------------------------- traces
  /** A drill on the new server with --roles: the database is new, roles.sql runs there. */
  run drillOnNewServerTest = init
    .then(restoreAttempt("n", "drill_a", true, false, 1, true, true, false, true, true))
    .expect(outcome == "created" and safety and rolesNeverOnSourceServer)
    .then(restoreAttempt("n", "drill_a", false, false, 1, true, true, false, true, true))
    .expect(outcome == "exists")
    .then(dropScratch("N", "drill_a"))
    .then(restoreAttempt("n", "drill_a", false, false, 1, true, true, false, true, true))
    .expect(outcome == "created" and safety)

  /** The source database on its own server, and --roles there, are refused by name of host. */
  run sourceRefusalsTest = init
    .then(restoreAttempt("s-int", "appdb", false, false, 1, true, true, false, true, true))
    .expect(outcome == "ownDatabase")
    .then(restoreAttempt("s-int", "drill_a", true, false, 1, true, true, false, true, true))
    .expect(outcome == "rolesOnSource")
    .then(restoreAttempt("n", "drill_a", true, false, 1, false, true, false, true, true))
    .expect(outcome == "rolesOnSource")
    .then(restoreAttempt("n", "network", false, false, 1, true, true, false, true, true))
    .expect(outcome == "name")
    .then(restoreAttempt("n", "drill_b", false, false, 2, true, true, false, true, true))
    .expect(outcome == "version")
    .then(restoreAttempt("n", "drill_b", false, false, 1, true, true, true, false, true))
    .expect(outcome == "encrypted" and created == Set())

  /** Old manifest: through the proxy, the own-database check reads "another server"; the exists check still refuses. */
  run proxyOwnDatabaseTest = init
    .then(restoreAttempt("s-proxy", "appdb", false, false, 1, true, false, false, true, true))
    .expect(outcome == "exists" and safety)

  /** SD-165 fix: --roles through the proxy host is refused when the manifest records the systemId. */
  run rolesViaProxyTest = init
    .then(restoreAttempt("s-proxy", "drill_a", true, false, 1, true, true, false, true, true))
    .expect(outcome == "rolesOnSource" and created == Set())
    .then(restoreAttempt("s-proxy", "appdb", false, false, 1, true, true, false, true, true))
    .expect(outcome == "ownDatabase")

  /** SD-165 residual: an old manifest (source without systemId) through the proxy host runs roles.sql on S. */
  run rolesViaProxyOldManifestTest = init
    .then(restoreAttempt("s-proxy", "drill_a", true, false, 1, true, false, false, true, true))
    .expect(outcome == "created" and safety and not(rolesNeverOnSourceServer))
}
```
