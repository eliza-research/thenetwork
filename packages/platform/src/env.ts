// Environment flags shared by the platform code. Detection fails closed: the dev shortcuts (the
// console OTP provider, the Turnstile bypass, the public dev hash key, a trusted X-Forwarded-Host,
// cookies without Secure) run only in an environment that is declared dev. An environment that is
// not declared is treated like production for every check.
export type Env = Record<string, string | undefined>;
export type PlatformEnv = "production" | "staging" | "dev";
export const PLATFORM_ENVS: readonly PlatformEnv[] = ["production", "staging", "dev"];

/**
 * The declared environment: PLATFORM_ENV (production | staging | dev), else NODE_ENV=production, else
 * NODE_ENV=test or development (bun test sets test) as dev. Anything else is undefined: not declared.
 */
export function platformEnv(env: Env = process.env): PlatformEnv | undefined {
  const p = env.PLATFORM_ENV;
  if (p !== undefined && p !== "") return (PLATFORM_ENVS as readonly string[]).includes(p) ? (p as PlatformEnv) : undefined;
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test" || env.NODE_ENV === "development") return "dev";
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
