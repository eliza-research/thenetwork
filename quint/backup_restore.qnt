// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=20000
//
// backup_restore: the refusal rules of a restore (docs/deploy.md 8.2, runbook-real.md 8).
//
// WHAT THIS MODELS
//   deploy/backup/restore.ts restore() on this branch: the checks before it creates a database and
//   before it runs roles.sql. Each function of deploy/backup/restore-core.ts (LemmaScript, proved) is a
//   pure def here with the same name and the same decision: targetNameRefused, manifestVersionKnown,
//   onSourceServer, placementRefusal, runsRoles, privilegeFlags. The action `restoreAttempt` calls them
//   in the order of restore.ts and does not decide again. The `exists` check (a SQL read of pg_database)
//   is in the shell, so it is in the action.
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
//   safeDbName (a regex in lib.ts) is the set SAFE_NAMES. sameServer (lib.ts) compares host strings:
//   here it is `host == "s-int"`. The file checks (existsSync) are nondet booleans.
//
// OUTSIDE THE MODEL
//   pg_restore, the row-count check, the download and the decryption, the role statements themselves.
//   A failed pg_restore leaves the new database in place on this branch; dropScratch removes it later.
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

  // ---------------------------------------------------------------- the core (restore-core.ts)
  type RestorePlacement = {
    db: str, sourceDatabase: str, sourceRecorded: bool, sameServer: bool,
    roles: bool, encrypted: bool, dumpPresent: bool,
  }

  pure def isLiveName(db: str): bool = LIVE.contains(db)
  pure def targetNameRefused(db: str, nameSafe: bool): bool = not(nameSafe) or isLiveName(db)
  pure def manifestVersionKnown(v: int): bool = v == 1
  pure def onSourceServer(p: RestorePlacement): bool = not(p.sourceRecorded) or p.sameServer
  pure def placementRefusal(p: RestorePlacement): str =
    if (p.db == p.sourceDatabase and onSourceServer(p)) "ownDatabase"
    else if (p.roles and onSourceServer(p)) "rolesOnSource"
    else if (p.encrypted and not(p.dumpPresent)) "encrypted"
    else "ok"
  pure def runsRoles(p: RestorePlacement, rolesFilePresent: bool): bool =
    p.roles and rolesFilePresent and not(onSourceServer(p))
  pure def privilegeFlags(keep: bool): List[str] = if (keep) [] else ["--no-owner", "--no-privileges"]

  // ---------------------------------------------------------------- state
  // One database a restore created, with the inputs of that restore (ghost history for the invariants).
  type Created = {
    server: str, name: str, existed: bool, version: int, sourceRecorded: bool, hostIsSource: bool,
    encrypted: bool, dumpPresent: bool, rolesRan: bool, keep: bool, flags: List[str],
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
                        encrypted: bool, dumpPresent: bool, rolesFile: bool): bool = {
    val server = serverOf(host)
    val p: RestorePlacement = {
      db: name, sourceDatabase: SOURCE_DB, sourceRecorded: sourceRecorded,
      sameServer: sourceRecorded and host == SOURCE_HOST,
      roles: roles, encrypted: encrypted, dumpPresent: not(encrypted) or dumpPresent,
    }
    val existed = dbs.contains((server, name))
    if (targetNameRefused(name, SAFE_NAMES.contains(name))) all { outcome' = "name", dbs' = dbs, created' = created }
    else if (not(manifestVersionKnown(version))) all { outcome' = "version", dbs' = dbs, created' = created }
    else if (placementRefusal(p) != "ok") all { outcome' = placementRefusal(p), dbs' = dbs, created' = created }
    else if (existed) all { outcome' = "exists", dbs' = dbs, created' = created }
    else all {
      outcome' = "created",
      dbs' = dbs.union(Set((server, name))),
      created' = created.union(Set({
        server: server, name: name, existed: existed, version: version, sourceRecorded: sourceRecorded,
        hostIsSource: host == SOURCE_HOST, encrypted: encrypted, dumpPresent: p.dumpPresent,
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
    nondet encrypted = Set(true, false).oneOf()
    nondet dumpPresent = Set(true, false).oneOf()
    nondet rolesFile = Set(true, false).oneOf()
    restoreAttempt(host, name, roles, keep, version, sourceRecorded, encrypted, dumpPresent, rolesFile),
    nondet sv = SERVERS.oneOf()
    nondet n = NAMES.oneOf()
    dropScratch(sv, n),
  }

  // ---------------------------------------------------------------- invariants
  // docs/deploy.md 8.2 "any database that exists" (restore.ts exists check): a restore only creates a new database.
  val createsOnlyNew = created.forall(c => not(c.existed))
  // restore.ts header "the live names" (restore-core.ts targetNameRefused): no live name is ever created.
  val neverLiveName = created.forall(c => not(LIVE.contains(c.name)))
  // restore.ts header "only a safe name" (lib.ts safeDbName via targetNameRefused).
  val onlySafeNames = created.forall(c => SAFE_NAMES.contains(c.name))
  // docs/deploy.md 8.2 "the source's own database on the source server is refused" (placementRefusal "ownDatabase",
  // with the exists check behind it): no restore targets appdb on S, under any host name.
  val neverSourceDatabase = created.forall(c => not(c.server == "S" and c.name == SOURCE_DB))
  // lib.ts Manifest version 1 (manifestVersionKnown): a restore reads only a known manifest.
  val onlyKnownVersion = created.forall(c => c.version == 1)
  // restore.ts header "An encrypted backup needs BACKUP_ENCRYPTION_KEY" (placementRefusal "encrypted").
  val neverUndecrypted = created.forall(c => not(c.encrypted and not(c.dumpPresent)))
  // restore.ts header "roles.sql runs only with --roles, and only on a server that is not the source" (runsRoles),
  // as the code can see it: the backup names its source, and the target host string is another one.
  val rolesOnlyOffRecordedSource = created.forall(c => c.rolesRan implies (c.sourceRecorded and not(c.hostIsSource)))
  // docs/deploy.md 8.2 "The drill (default) restores with --no-owner --no-privileges" (privilegeFlags).
  val drillDropsPrivileges = created.forall(c => not(c.keep) implies c.flags == ["--no-owner", "--no-privileges"])
  // A database that existed before any restore is still there: a restore never drops one.
  val initialKept = INITIAL_DBS.subseteq(dbs)

  val safety = and {
    createsOnlyNew, neverLiveName, onlySafeNames, neverSourceDatabase, onlyKnownVersion,
    neverUndecrypted, rolesOnlyOffRecordedSource, drillDropsPrivileges, initialKept,
  }

  // SD-165 (open on this branch; fixed on wave2/runtime_ops by commit cadd3c3, not merged here):
  // the rule is "never on the source server", but sameServer compares host strings. Through "s-proxy"
  // the target reads as another server, and roles.sql runs on S. Outside `safety`; rolesViaProxyTest replays it.
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
    .then(restoreAttempt("n", "drill_a", true, false, 1, true, false, true, true))
    .expect(outcome == "created" and safety and rolesNeverOnSourceServer)
    .then(restoreAttempt("n", "drill_a", false, false, 1, true, false, true, true))
    .expect(outcome == "exists")
    .then(dropScratch("N", "drill_a"))
    .then(restoreAttempt("n", "drill_a", false, false, 1, true, false, true, true))
    .expect(outcome == "created" and safety)

  /** The source database on its own server, and --roles there, are refused by name of host. */
  run sourceRefusalsTest = init
    .then(restoreAttempt("s-int", "appdb", false, false, 1, true, false, true, true))
    .expect(outcome == "ownDatabase")
    .then(restoreAttempt("s-int", "drill_a", true, false, 1, true, false, true, true))
    .expect(outcome == "rolesOnSource")
    .then(restoreAttempt("n", "drill_a", true, false, 1, false, false, true, true))
    .expect(outcome == "rolesOnSource")
    .then(restoreAttempt("n", "network", false, false, 1, true, false, true, true))
    .expect(outcome == "name")
    .then(restoreAttempt("n", "drill_b", false, false, 2, true, false, true, true))
    .expect(outcome == "version")
    .then(restoreAttempt("n", "drill_b", false, false, 1, true, true, false, true))
    .expect(outcome == "encrypted" and created == Set())

  /** Through the proxy, the own-database check reads "another server"; the exists check still refuses. */
  run proxyOwnDatabaseTest = init
    .then(restoreAttempt("s-proxy", "appdb", false, false, 1, true, false, true, true))
    .expect(outcome == "exists" and safety)

  /** SD-165 (open here): --roles through the proxy host runs roles.sql on the source server. */
  run rolesViaProxyTest = init
    .then(restoreAttempt("s-proxy", "drill_a", true, false, 1, true, false, true, true))
    .expect(outcome == "created" and safety and not(rolesNeverOnSourceServer))
}
