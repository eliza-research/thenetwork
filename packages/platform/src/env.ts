import { otpConfigProblems } from "./otp-config.ts";
import { bootProblems, declaredEnv, devAllowed, MIN_SECRET_LENGTH, productionEnv } from "./env-core.ts";
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
  const e = declaredEnv(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");
  return e === "" ? undefined : (e as PlatformEnv);
}

/** True when the environment says production. */
export const isProduction = (env: Env = process.env) => productionEnv(env.NODE_ENV ?? "", env.PLATFORM_ENV ?? "");

/** True only in a declared dev environment. Every dev-only shortcut checks this (fail closed). */
export const devShortcutsAllowed = (env: Env = process.env) => devAllowed(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");

/** The declared environment, or an error that names PLATFORM_ENV. The service (main.ts) refuses to start without it. */
export function requirePlatformEnv(env: Env = process.env): PlatformEnv {
  const e = platformEnv(env);
  if (!e) throw new Error(`set PLATFORM_ENV to one of ${PLATFORM_ENVS.join(", ")} (got ${JSON.stringify(env.PLATFORM_ENV ?? null)}); the service does not guess`);
  return e;
}

/** The smallest secret length the boot check accepts for the keys below (env-core.ts). */
export { MIN_SECRET_LENGTH };

/**
 * What a production (or staging) process is missing, as one line per problem; empty when it may
 * start. Production needs real providers and every secret:
 *  - explicit OTP_PROVIDER=twilio with Verify credentials, or blooio with its key and exact sender;
 *  - TURNSTILE_SECRET_KEY;
 *  - PLATFORM_PROXY_SECRET (the site routers sign the client IP and host with it), PLATFORM_HASH_KEY
 *    and PLATFORM_SESSION_SECRET, each at least 32 characters;
 *  - NETWORK_DATABASE_URL or DATABASE_URL;
 *  - review mode human (NETWORK_REVIEW_MODE, when set, must be "human");
 *  - no dev-only switch (PLATFORM_DEV_*).
 * A dev environment has no requirement here (the dev shortcuts refuse every other environment).
 */
export function bootConfigProblems(env: Env = process.env): string[] {
  // The OTP check reads provider details, so it runs only where env-core.ts uses its result.
  const e = declaredEnv(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");
  const keys = Object.keys(env);
  return bootProblems({
    platformEnv: env.PLATFORM_ENV ?? "", nodeEnv: env.NODE_ENV ?? "",
    otpProblems: e === "" || e === "dev" ? [] : otpConfigProblems(env),
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
    proxySecret: env.PLATFORM_PROXY_SECRET ?? "", hashKey: env.PLATFORM_HASH_KEY ?? "", sessionSecret: env.PLATFORM_SESSION_SECRET ?? "",
    networkDatabaseUrl: env.NETWORK_DATABASE_URL ?? "", databaseUrl: env.DATABASE_URL ?? "",
    reviewModeSet: env.NETWORK_REVIEW_MODE !== undefined, reviewMode: env.NETWORK_REVIEW_MODE ?? "",
    envKeys: keys, envValues: keys.map(k => env[k] ?? ""),
  });
}

/** Throw when the process may not start in this environment (main.ts calls it first). Returns the environment. */
export function assertBootConfig(env: Env = process.env): PlatformEnv {
  const problems = bootConfigProblems(env);
  if (problems.length) throw new Error(`refusing to start (PLATFORM_ENV=${env.PLATFORM_ENV ?? ""}): needs ${problems.join("; ")}`);
  return requirePlatformEnv(env);
}
