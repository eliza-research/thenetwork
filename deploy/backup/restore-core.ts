// The refusal rules of a restore (docs/deploy.md 8.2). Import-free, proved by LemmaScript
// (docs/formal-verification.md). restore.ts reads the manifest, the URLs and the files, and asks these
// functions before it creates a database or runs roles.sql. The inputs that come from a regex (safeDbName),
// from the URL parser (sameServer) or from the file system (dumpPresent, rolesFilePresent) are trusted.

/** Database names a restore never creates: the live ones. */
const LIVE_NAMES: string[] = ["railway", "network", "postgres", "template0", "template1"];

/** The reason that restore.ts refuses a backup after it reads the manifest. "ok" when it may go on. */
export type RestoreRefusal = "ok" | "ownDatabase" | "rolesOnSource" | "encrypted";

/** What restore.ts knows after it reads the manifest and parses the target URL. */
export interface RestorePlacement {
  /** The new database name (--db). */
  db: string;
  /** manifest.database: the database that the backup was taken from. */
  sourceDatabase: string;
  /** manifest.source is set. A backup older than the field does not name its source server. */
  sourceRecorded: boolean;
  /** The target host and port are the recorded source (sameServer in lib.ts). */
  sameServer: boolean;
  /** --roles: run roles.sql, which changes roles for the whole server. */
  roles: boolean;
  /** manifest.encryption is set. */
  encrypted: boolean;
  /** The plain dump file is in the backup folder. restore.ts looks only for an encrypted backup, and passes true otherwise. */
  dumpPresent: boolean;
}

function isLiveName(db: string): boolean {
  //@ verify
  //@ ensures \result === (db === "railway" || db === "network" || db === "postgres" || db === "template0" || db === "template1")
  return LIVE_NAMES.includes(db);
}

/** True when restore.ts must refuse the name before it reads the backup: not a safe name, or a live name. */
export function targetNameRefused(db: string, nameSafe: boolean): boolean {
  //@ verify
  //@ ensures !nameSafe ==> \result
  //@ ensures isLiveName(db) ==> \result
  //@ ensures !\result ==> nameSafe && db !== "postgres" && db !== "railway" && db !== "network"
  return !nameSafe || isLiveName(db);
}

/** restore.ts reads manifest version 1 only. */
export function manifestVersionKnown(version: number): boolean {
  //@ verify
  //@ ensures \result === (version === 1)
  return version === 1;
}

/** The target is the source server. A backup that does not name its source counts as taken on this server. */
export function onSourceServer(p: RestorePlacement): boolean {
  //@ verify
  //@ ensures !p.sourceRecorded ==> \result
  //@ ensures \result === (!p.sourceRecorded || p.sameServer)
  return !p.sourceRecorded || p.sameServer;
}

/**
 * The first refusal after the manifest is read, in the order of restore.ts: the backup's own database on
 * its own server, then --roles on the source server, then an encrypted backup that is not decrypted.
 */
export function placementRefusal(p: RestorePlacement): RestoreRefusal {
  //@ verify
  //@ ensures \result === "ok" ==> !(p.db === p.sourceDatabase && onSourceServer(p))
  //@ ensures \result === "ok" ==> !(p.roles && onSourceServer(p))
  //@ ensures \result === "ok" ==> !(p.encrypted && !p.dumpPresent)
  //@ ensures p.db === p.sourceDatabase && onSourceServer(p) ==> \result === "ownDatabase"
  //@ ensures \result === "rolesOnSource" ==> p.roles && onSourceServer(p)
  //@ ensures \result === "encrypted" ==> p.encrypted && !p.dumpPresent
  const onSource = onSourceServer(p);
  if (p.db === p.sourceDatabase && onSource) return "ownDatabase";
  if (p.roles && onSource) return "rolesOnSource";
  if (p.encrypted && !p.dumpPresent) return "encrypted";
  return "ok";
}

/** roles.sql runs only when asked, only when the backup has it, and never on the source server. */
export function runsRoles(p: RestorePlacement, rolesFilePresent: boolean): boolean {
  //@ verify
  //@ ensures \result ==> p.roles && rolesFilePresent && !onSourceServer(p)
  //@ ensures placementRefusal(p) === "ok" && p.roles && rolesFilePresent ==> \result
  return p.roles && rolesFilePresent && !onSourceServer(p);
}

/** The pg_restore flags for owners and grants. The drill (the default) keeps neither. */
export function privilegeFlags(keepPrivileges: boolean): string[] {
  //@ verify
  //@ ensures !keepPrivileges ==> \result.length === 2 && \result[0] === "--no-owner" && \result[1] === "--no-privileges"
  //@ ensures keepPrivileges ==> \result.length === 0
  return keepPrivileges ? [] : ["--no-owner", "--no-privileges"];
}
