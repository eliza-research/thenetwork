// The refusals of the restore drill (restore.ts), free of imports so that they can be proved.
// A restore must never write into a live database, into the backup's own database on its own
// server, or change the roles of the source server. A backup that does not name its source counts
// as taken on this server: when the source is unknown, the restore fails closed.

export const RESTORE_OK = 0;
export const RESTORE_BAD_NAME = 1;
export const RESTORE_OWN_DATABASE = 2;
export const RESTORE_ROLES_ON_SOURCE = 3;
export const RESTORE_ENCRYPTED = 4;

/**
 * What restore.ts knows before it creates the database. Each fact is computed by the caller and
 * trusted here: `safeName` (safeDbName), `liveName` (LIVE_NAMES), `ownName` (the backup's own
 * database name), `sourceKnown` (the manifest names its source), `sameServer` (lib.ts sameServer on
 * host and port, or the same cluster system identifier), `roles` (--roles), `encrypted` (manifest.encryption), `dumpPresent` (the plain dump file is there).
 */
export interface RestoreFacts {
  safeName: boolean; liveName: boolean; ownName: boolean; sourceKnown: boolean; sameServer: boolean;
  roles: boolean; encrypted: boolean; dumpPresent: boolean;
}

/** The target name alone: a safe scratch name that is not a live one. */
//@ verify
export function targetRefused(safeName: boolean, liveName: boolean): boolean {
  return !safeName || liveName;
}

/** The target server may be the source server: it is, or the backup does not say where it came from. */
//@ verify
export function maybeSource(f: RestoreFacts): boolean {
  return !f.sourceKnown || f.sameServer;
}

/** The first refusal, in the order restore.ts reports them, or RESTORE_OK. */
//@ verify
//@ ensures \result === 0 ==> f.safeName && !f.liveName
//@ ensures \result === 0 ==> !(f.ownName && (!f.sourceKnown || f.sameServer))
//@ ensures \result === 0 ==> !(f.roles && (!f.sourceKnown || f.sameServer))
//@ ensures \result === 0 ==> !(f.encrypted && !f.dumpPresent)
//@ ensures f.roles && !f.sourceKnown ==> \result !== 0
//@ ensures \result >= 0 && \result <= 4
export function restoreRefusal(f: RestoreFacts): number {
  if (targetRefused(f.safeName, f.liveName)) return RESTORE_BAD_NAME;
  const onSource = maybeSource(f);
  if (f.ownName && onSource) return RESTORE_OWN_DATABASE;
  if (f.roles && onSource) return RESTORE_ROLES_ON_SOURCE;
  if (f.encrypted && !f.dumpPresent) return RESTORE_ENCRYPTED;
  return RESTORE_OK;
}
