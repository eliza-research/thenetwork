import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  BACKEND: DurableObjectNamespace<NetworkBackend>;
  BACKEND_ENABLED: string;
  BACKEND_RUNTIME_CONFIG: string;
  PLATFORM_ENV: string;
  BUILD_ID: string;
}

/** The existing backend owns PostgreSQL transactions, jobs and authorization. */
export class NetworkBackend extends Container<Env> {
  defaultPort = 8790;
  sleepAfter = "30m";

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    let config: unknown;
    try {
      config = JSON.parse(env.BACKEND_RUNTIME_CONFIG);
    } catch {
      throw new Error("BACKEND_RUNTIME_CONFIG must contain valid JSON");
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("BACKEND_RUNTIME_CONFIG must be an object");
    }
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value !== "string") throw new Error("Backend settings must be strings");
      if (key.startsWith("RAILWAY_")) continue;
      settings[key] = value;
    }
    if (!["staging", "production"].includes(env.PLATFORM_ENV) || settings.PLATFORM_ENV !== env.PLATFORM_ENV) {
      throw new Error("Backend configuration environment does not match deployment");
    }
    if (!/^[a-f0-9]{40}$/.test(env.BUILD_ID)) throw new Error("BUILD_ID must identify the deployed source commit");
    for (const name of ["NETWORK_DATABASE_URL", "MIGRATION_DATABASE_URL", "NETWORK_SERVICE_AUDIT_DATABASE_URL"]) {
      if (name !== "NETWORK_DATABASE_URL" && !settings[name]) continue;
      let database: URL;
      try {
        database = new URL(settings[name] ?? "");
      } catch {
        throw new Error(`Backend ${name} must be a PostgreSQL connection URL`);
      }
      if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname.endsWith(".railway.internal")) {
        throw new Error(`Backend ${name} must be externally reachable PostgreSQL`);
      }
    }
    this.envVars = { ...settings, PORT: "8790", BUILD_ID: env.BUILD_ID, NETWORK_SERVICE_INSTANCE: crypto.randomUUID() };
  }
}

async function stopInactiveBackend(env: Env): Promise<void> {
  // A provisioned Worker without runtime credentials has no process to drain.
  if (!env.BACKEND_RUNTIME_CONFIG) return;
  // SIGTERM lets the existing backend finish in-flight work and release leases.
  // A 503 response alone does not certify that this drain has finished.
  await getContainer(env.BACKEND, "backend").stop();
}

/**
 * This Worker routes only the public port. The staff API (review, safety, leak review, holds) listens
 * on STAFF_PORT inside the container, and nothing routes to it, so an active deployment would let every
 * proposal expire unreviewed (audit OPS28). Activation is refused until a private staff route exists.
 */
const STAFF_API_UNREACHABLE = "staff_api_unreachable";

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    // Install and validate configuration before transferring ownership of jobs.
    await stopInactiveBackend(env);
    return new Response(env.BACKEND_ENABLED === "true" ? STAFF_API_UNREACHABLE : "Backend deployment inactive", { status: 503 });
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await stopInactiveBackend(env);
    if (env.BACKEND_ENABLED === "true") throw new Error(`Backend activation refused: ${STAFF_API_UNREACHABLE} (deploy/cloudflare/README.md)`);
  },
};
