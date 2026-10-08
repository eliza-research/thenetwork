// Environment flags shared by the platform code. Detection fails closed: the dev shortcuts (the
// console OTP provider, the Turnstile bypass, the public dev hash key, a trusted X-Forwarded-Host,
// cookies without Secure) run only in an environment that is declared dev. An environment that is
// not declared is treated like production for every check.
export type Env = Record<string, string | undefined>;
export type PlatformEnv = "production" | "staging" | "dev";
export const PLATFORM_ENVS: readonly PlatformEnv[] = ["production", "staging", "dev"];

/**
 * The declared environment: PLATFORM_ENV (production | staging | dev), else NODE_ENV=production, else
 * NODE_ENV=test (bun test) as dev. Anything else is undefined: not declared.
 */
export function platformEnv(env: Env = process.env): PlatformEnv | undefined {
  const p = env.PLATFORM_ENV;
  if (p !== undefined && p !== "") return (PLATFORM_ENVS as readonly string[]).includes(p) ? (p as PlatformEnv) : undefined;
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "dev";
  return undefined;
}

/** True when the environment says production. */
export const isProduction = (env: Env = process.env) => env.NODE_ENV === "production" || env.PLATFORM_ENV === "production";

/** True only in a declared dev environment. Every dev-only shortcut checks this (fail closed). */
export const devShortcutsAllowed = (env: Env = process.env) => !isProduction(env) && platformEnv(env) === "dev";

/** The declared environment, or an error that names PLATFORM_ENV. The service (main.ts) refuses to start without it. */
export function requirePlatformEnv(env: Env = process.env): PlatformEnv {
  const e = platformEnv(env);
  if (!e) throw new Error(`set PLATFORM_ENV to one of ${PLATFORM_ENVS.join(", ")} (got ${JSON.stringify(env.PLATFORM_ENV ?? null)}); the service does not guess`);
  return e;
}

/** The smallest secret length the boot check accepts for the keys below. */
export const MIN_SECRET_LENGTH = 32;

/**
 * What a production (or staging) process is missing, as one line per problem; empty when it may
 * start. Production needs real providers and every secret:
 *  - OTP_PROVIDER=twilio with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID;
 *  - TURNSTILE_SECRET_KEY;
 *  - PLATFORM_PROXY_SECRET (the site routers sign the client IP and host with it), PLATFORM_HASH_KEY
 *    and PLATFORM_SESSION_SECRET, each at least 32 characters;
 *  - NETWORK_DATABASE_URL or DATABASE_URL;
 *  - review mode human (NETWORK_REVIEW_MODE, when set, must be "human");
 *  - no dev-only switch (PLATFORM_DEV_*).
 * A dev environment has no requirement here (the dev shortcuts refuse every other environment).
 */
export function bootConfigProblems(env: Env = process.env): string[] {
  const e = platformEnv(env);
  if (e === undefined) return [`PLATFORM_ENV must be one of ${PLATFORM_ENVS.join(", ")}`];
  if (e === "dev") return isProduction(env) ? ["NODE_ENV=production with PLATFORM_ENV=dev"] : [];
  const out: string[] = [];
  if (env.OTP_PROVIDER !== "twilio") out.push("OTP_PROVIDER=twilio (the dev console provider never runs here)");
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID", "TURNSTILE_SECRET_KEY"]) if (!env[k]) out.push(k);
  for (const k of ["PLATFORM_PROXY_SECRET", "PLATFORM_HASH_KEY", "PLATFORM_SESSION_SECRET"]) {
    if (!env[k]) out.push(k);
    else if (env[k]!.length < MIN_SECRET_LENGTH) out.push(`${k} (at least ${MIN_SECRET_LENGTH} characters)`);
  }
  if (!env.NETWORK_DATABASE_URL && !env.DATABASE_URL) out.push("NETWORK_DATABASE_URL or DATABASE_URL");
  if (env.NETWORK_REVIEW_MODE !== undefined && env.NETWORK_REVIEW_MODE !== "human") out.push(`NETWORK_REVIEW_MODE=human (got ${env.NETWORK_REVIEW_MODE})`);
  for (const k of Object.keys(env)) if (k.startsWith("PLATFORM_DEV_") && env[k]) out.push(`unset ${k} (dev only)`);
  return out;
}

/** Throw when the process may not start in this environment (main.ts calls it first). Returns the environment. */
export function assertBootConfig(env: Env = process.env): PlatformEnv {
  const problems = bootConfigProblems(env);
  if (problems.length) throw new Error(`refusing to start (PLATFORM_ENV=${env.PLATFORM_ENV ?? ""}): needs ${problems.join("; ")}`);
  return requirePlatformEnv(env);
}
