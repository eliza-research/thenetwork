import { declaredEnvironment, devShortcuts, minimumSecretLength, networkBoot, networkBootRefused, productionDeclared, type Environment } from "../../core/src/generated/bootPolicy.ts";
import { otpConfigProblems } from "./otp-config.ts";
import { providerKeyPresent } from "../../core/src/llm.ts";
export type Env = Record<string, string | undefined>;
export type PlatformEnv = "production" | "staging" | "dev";
export const PLATFORM_ENVS: readonly PlatformEnv[] = ["production", "staging", "dev"];

const platformEnvNames = {
  Production: "production", Staging: "staging", Dev: "dev", Undeclared: undefined,
} as const satisfies Record<Environment, PlatformEnv | undefined>;

export function platformEnv(env: Env = process.env): PlatformEnv | undefined {
  return platformEnvNames[declaredEnvironment(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "")];
}

export const isProduction = (env: Env = process.env) => productionDeclared(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");

export const devShortcutsAllowed = (env: Env = process.env) => devShortcuts(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? "");

export function requirePlatformEnv(env: Env = process.env): PlatformEnv {
  const e = platformEnv(env);
  if (!e) throw new Error(`set PLATFORM_ENV to one of ${PLATFORM_ENVS.join(", ")} (got ${JSON.stringify(env.PLATFORM_ENV ?? null)}); the service does not guess`);
  return e;
}

export const MIN_SECRET_LENGTH = minimumSecretLength;

export function modelProviderFacts(env: Env): { modelProvider: boolean; unknown: boolean } {
  const keys = [providerKeyPresent(env, env.JUDGE_PROVIDER || "surplus"), providerKeyPresent(env, env.RECOMMENDER_PROVIDER || "surplus")];
  return { modelProvider: keys.every(k => k === "present"), unknown: keys.includes("unknown") };
}

export const MODEL_PROVIDER_MISSING = "JUDGE_PROVIDER and RECOMMENDER_PROVIDER need an API key (SURPLUS_API_KEY or OPENAI_API_KEY)";
export const MODEL_PROVIDER_UNKNOWN = "JUDGE_PROVIDER/RECOMMENDER_PROVIDER names an unknown provider";

export function bootConfigProblems(env: Env = process.env): string[] {
  const sessionSecret = env.PLATFORM_SESSION_SECRET ?? "";
  const models = modelProviderFacts(env);
  const devSwitches = Object.keys(env).filter(k => k.startsWith("PLATFORM_DEV_") && env[k]);
  const policy = networkBoot({
    environment: declaredEnvironment(env.PLATFORM_ENV ?? "", env.NODE_ENV ?? ""), production: isProduction(env),
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY), database: Boolean(env.NETWORK_DATABASE_URL || env.DATABASE_URL),
    proxyLength: env.PLATFORM_PROXY_SECRET?.length ?? 0, hashLength: env.PLATFORM_HASH_KEY?.length ?? 0,
    sessionLength: sessionSecret.length, sessionIsHashKey: sessionSecret !== "" && sessionSecret === env.PLATFORM_HASH_KEY,
    modelProvider: models.modelProvider, devSwitch: devSwitches.length > 0,
  });
  const otpProblems = policy.checkDeployed ? otpConfigProblems(env) : [];
  if (!networkBootRefused(policy) && !otpProblems.length && !models.unknown) return [];
  if (policy.environmentMissing) return [`PLATFORM_ENV must be one of ${PLATFORM_ENVS.join(", ")}`];
  if (policy.devConflict) return ["a NODE_ENV other than production when PLATFORM_ENV=dev"];
  const out = [...otpProblems, ...(models.unknown ? [MODEL_PROVIDER_UNKNOWN] : [])];
  if (policy.turnstileMissing) out.push("TURNSTILE_SECRET_KEY");
  const shortSecrets = {
    PLATFORM_PROXY_SECRET: policy.proxyShort, PLATFORM_HASH_KEY: policy.hashShort, PLATFORM_SESSION_SECRET: policy.sessionShort,
  };
  for (const [key, short] of Object.entries(shortSecrets)) {
    if (short) out.push(env[key] ? `${key} (at least ${MIN_SECRET_LENGTH} characters)` : key);
  }
  if (policy.sessionReused) out.push("a PLATFORM_SESSION_SECRET that differs from PLATFORM_HASH_KEY");
  if (policy.databaseMissing) out.push("NETWORK_DATABASE_URL or DATABASE_URL");
  if (policy.modelProviderMissing) out.push(MODEL_PROVIDER_MISSING);
  if (policy.devSwitchSet) out.push(...devSwitches.map(k => `unset ${k} (dev only)`));
  return out;
}

export function assertBootConfig(env: Env = process.env): PlatformEnv {
  const problems = bootConfigProblems(env);
  if (problems.length) throw new Error(`refusing to start (PLATFORM_ENV=${env.PLATFORM_ENV ?? ""}): needs ${problems.join("; ")}`);
  return requirePlatformEnv(env);
}
