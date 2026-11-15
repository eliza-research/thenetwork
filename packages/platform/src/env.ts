import { declaredEnvironment, devShortcuts, minimumSecretLength, networkBoot, productionDeclared, type Environment } from "../../core/src/generated/bootPolicy.ts";
import { otpConfigProblems } from "./otp-config.ts";
// Environment flags shared by the platform code. Detection fails closed: the dev shortcuts (the
// console OTP provider, the Turnstile bypass, the public dev hash key, a trusted X-Forwarded-Host,
// cookies without Secure) run only in an environment that is declared dev. An environment that is
// not declared is treated like production for every check.
export type Env = Record<string, string | undefined>;
export type PlatformEnv = "production" | "staging" | "dev";
export const PLATFORM_ENVS: readonly PlatformEnv[] = ["production", "staging", "dev"];

const platformEnvNames = {
  Production: "production", Staging: "staging", Dev: "dev", Undeclared: undefined,
} as const satisfies Record<Environment, PlatformEnv | undefined>;

/**
 * The declared environment: PLATFORM_ENV (production | staging | dev), else NODE_ENV=production, else
 * NODE_ENV=test (bun test) as dev. Anything else is undefined: not declared.
 */
export function platformEnv(env: Env = process.env): PlatformEnv | undefined {
  return platformEnvNames[declaredEnvironment(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "")];
}

/** True when the environment says production. */
export const isProduction = (env: Env = process.env) => productionDeclared(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");

/** True only in a declared dev environment. Every dev-only shortcut checks this (fail closed). */
export const devShortcutsAllowed = (env: Env = process.env) => devShortcuts(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");

/** The declared environment, or an error that names PLATFORM_ENV. The service (main.ts) refuses to start without it. */
export function requirePlatformEnv(env: Env = process.env): PlatformEnv {
  const e = platformEnv(env);
  if (!e) throw new Error(`set PLATFORM_ENV to one of ${PLATFORM_ENVS.join(", ")} (got ${JSON.stringify(env.PLATFORM_ENV ?? null)}); the service does not guess`);
  return e;
}

/** The smallest secret length the boot check accepts for the keys below. */
export const MIN_SECRET_LENGTH = minimumSecretLength;

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
  const policy = networkBoot({
    environment: declaredEnvironment(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? ""), production: isProduction(env),
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY), database: Boolean(env.NETWORK_DATABASE_URL || env.DATABASE_URL),
    proxyLength: env.PLATFORM_PROXY_SECRET?.length ?? 0, hashLength: env.PLATFORM_HASH_KEY?.length ?? 0,
    sessionLength: env.PLATFORM_SESSION_SECRET?.length ?? 0,
    review: env.NETWORK_REVIEW_MODE ?? "", reviewSet: env.NETWORK_REVIEW_MODE !== undefined,
  });
  if (policy.environmentMissing) return [`PLATFORM_ENV must be one of ${PLATFORM_ENVS.join(", ")}`];
  if (policy.devConflict) return ["NODE_ENV=production with PLATFORM_ENV=dev"];
  if (!policy.checkDeployed) return [];
  const out = otpConfigProblems(env);
  if (policy.turnstileMissing) out.push("TURNSTILE_SECRET_KEY");
  const shortSecrets = {
    PLATFORM_PROXY_SECRET: policy.proxyShort, PLATFORM_HASH_KEY: policy.hashShort, PLATFORM_SESSION_SECRET: policy.sessionShort,
  };
  for (const [key, short] of Object.entries(shortSecrets)) {
    if (short) out.push(env[key] ? `${key} (at least ${MIN_SECRET_LENGTH} characters)` : key);
  }
  if (policy.databaseMissing) out.push("NETWORK_DATABASE_URL or DATABASE_URL");
  if (policy.reviewInvalid) out.push(`NETWORK_REVIEW_MODE=human (got ${env.NETWORK_REVIEW_MODE})`);
  for (const k of Object.keys(env)) if (k.startsWith("PLATFORM_DEV_") && env[k]) out.push(`unset ${k} (dev only)`);
  return out;
}

/** Throw when the process may not start in this environment (main.ts calls it first). Returns the environment. */
export function assertBootConfig(env: Env = process.env): PlatformEnv {
  const problems = bootConfigProblems(env);
  if (problems.length) throw new Error(`refusing to start (PLATFORM_ENV=${env.PLATFORM_ENV ?? ""}): needs ${problems.join("; ")}`);
  return requirePlatformEnv(env);
}
