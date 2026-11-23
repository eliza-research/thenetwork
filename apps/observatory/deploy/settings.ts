// The deployed console's settings check (docs/deploy.md 2.6). Import-free, so the ops sim block can run it
// outside the Workers runtime (scripts/sim/ops.ts).

export interface ConsoleDeployEnv { OBSERVATORY_RUNTIME_CONFIG: string; PLATFORM_ENV: string; BUILD_ID: string }

/** Settings that would let a shared secret open member data: the console signs staff in through Cloudflare Access only. */
const REFUSED = ["OBSERVATORY_TOKEN", "OBSERVATORY_TOKENS", "OBSERVATORY_REVEAL_PII"];
/** Database logins the console reads through (docs/deploy.md 2.6). */
const DATABASES = [
  "NETWORK_DATABASE_URL", "OBSERVATORY_PLATFORM_DATABASE_URL", "OBSERVATORY_AUDIT_DATABASE_URL",
  "OBSERVATORY_DATABASE_URL_NTWRK", "OBSERVATORY_DATABASE_URL_SLOP", "OBSERVATORY_DATABASE_URL_PEON", "OBSERVATORY_DATABASE_URL_FRIENDS",
];

/** Validates the runtime settings and returns the container environment, or throws. */
export function consoleSettings(env: ConsoleDeployEnv): Record<string, string> {
  let config: unknown;
  try {
    config = JSON.parse(env.OBSERVATORY_RUNTIME_CONFIG);
  } catch {
    throw new Error("OBSERVATORY_RUNTIME_CONFIG must contain valid JSON");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("OBSERVATORY_RUNTIME_CONFIG must be an object");
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") throw new Error("Console settings must be strings");
    if (key.startsWith("RAILWAY_")) continue;
    settings[key] = value;
  }
  if (!["staging", "production"].includes(env.PLATFORM_ENV) || settings.PLATFORM_ENV !== env.PLATFORM_ENV) {
    throw new Error("Console configuration environment does not match deployment");
  }
  if (!/^[a-f0-9]{40}$/.test(env.BUILD_ID)) throw new Error("BUILD_ID must identify the deployed source commit");
  for (const name of REFUSED) if (settings[name]) throw new Error(`${name} is refused on a deployed console (Cloudflare Access only)`);
  if (settings.OBSERVATORY_TRUST_CF_ACCESS !== "1" || !settings.OBSERVATORY_CF_ACCESS_TEAM || !settings.OBSERVATORY_CF_ACCESS_AUD) {
    throw new Error("The console needs OBSERVATORY_TRUST_CF_ACCESS=1 with OBSERVATORY_CF_ACCESS_TEAM and OBSERVATORY_CF_ACCESS_AUD");
  }
  if (!settings.OBSERVATORY_ALLOWED_ORIGINS) throw new Error("OBSERVATORY_ALLOWED_ORIGINS must name the console's Access-protected origin");
  if (!settings.NETWORK_DATABASE_URL) throw new Error("NETWORK_DATABASE_URL is required");
  for (const name of DATABASES) {
    if (!settings[name]) continue;
    let database: URL;
    try {
      database = new URL(settings[name]);
    } catch {
      throw new Error(`Console ${name} must be a PostgreSQL connection URL`);
    }
    if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname.endsWith(".railway.internal")) {
      throw new Error(`Console ${name} must be externally reachable PostgreSQL`);
    }
  }
  return {
    ...settings,
    OBSERVATORY_REAL_ONLY: "1",
    NODE_ENV: "production",
    OBSERVATORY_HOST: "0.0.0.0",
    PORT: "4747",
    BUILD_ID: env.BUILD_ID,
  };
}
