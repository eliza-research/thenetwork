// The console's safety decisions as pure functions, proved with LemmaScript. This file imports nothing.
// Each input is read elsewhere and trusted here: core's isMinor gives the age answer, the database gives
// the login's facts, the environment gives the deploy facts.

/**
 * Whether the console treats a member as under 18. A record age that core calls minor always wins (an
 * invalid age is one). Otherwise the Network's view decides, and with neither, a missing age fails closed.
 */
export function consoleMinor(hasAge: boolean, ageIsMinor: boolean, netKnown: boolean, netMinor: boolean): boolean {
  //@ verify
  //@ ensures !hasAge && !netKnown ==> \result
  //@ ensures hasAge && ageIsMinor ==> \result
  //@ ensures netKnown && netMinor ==> \result
  //@ ensures !\result ==> (hasAge && !ageIsMinor) || (netKnown && !netMinor)
  if (hasAge && ageIsMinor) return true;
  if (netKnown) return netMinor;
  return !hasAge;
}

export type LoginVerdict = "ok" | "not_read_only" | "not_app_role" | "too_strong";

/** Why a database login may not serve the console. */
export function loginVerdict(readOnly: boolean, rlsRole: boolean, inAppRole: boolean, local: boolean, superuser: boolean, bypass: boolean): LoginVerdict {
  //@ verify
  //@ ensures \result === "ok" ==> readOnly
  //@ ensures \result === "ok" && rlsRole ==> inAppRole
  //@ ensures \result === "ok" && !local ==> !superuser && !bypass
  if (!readOnly) return "not_read_only";
  if (rlsRole && !inAppRole) return "not_app_role";
  if (!local && (superuser || bypass)) return "too_strong";
  return "ok";
}

export type DeployVerdict = "ok" | "no_env" | "unknown_env" | "needs_access" | "needs_audit" | "dev_remote";

/**
 * The console's start guard (docs/deploy.md 2.6). `env` is PLATFORM_ENV, "" when unset. `remote` is true when
 * a database or the Network service is not on this machine. `auditPg` is true when the audit log is in Postgres
 * (a deployed console loses a file audit log on a redeploy).
 */
export function deployVerdict(realOnly: boolean, access: boolean, env: string, remote: boolean, auditPg: boolean): DeployVerdict {
  //@ verify
  //@ ensures \result === "ok" && (realOnly || remote) ==> env === "dev" || env === "staging" || env === "production"
  //@ ensures \result === "ok" && (realOnly || remote) && env !== "dev" ==> access
  //@ ensures \result === "ok" && (realOnly || remote) && env !== "dev" ==> auditPg
  //@ ensures \result === "ok" && remote ==> access
  //@ ensures !realOnly && !remote ==> \result === "ok"
  if (!realOnly && !remote) return "ok";
  if (env === "") return "no_env";
  if (env !== "dev" && env !== "staging" && env !== "production") return "unknown_env";
  if (env !== "dev" && !access) return "needs_access";
  if (env !== "dev" && !auditPg) return "needs_audit";
  if (access) return "ok";
  if (remote) return "dev_remote";
  return "ok";
}
