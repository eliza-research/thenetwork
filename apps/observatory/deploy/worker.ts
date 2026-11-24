import { Container, getContainer } from "@cloudflare/containers";
import { consoleSettings } from "./settings.ts";

interface Env {
  CONSOLE: DurableObjectNamespace<ObservatoryConsole>;
  OBSERVATORY_ENABLED: string;
  OBSERVATORY_RUNTIME_CONFIG: string;
  PLATFORM_ENV: string;
  BUILD_ID: string;
}

/** The staff console (apps/observatory), real mode only, from the backend image. */
export class ObservatoryConsole extends Container<Env> {
  defaultPort = 4747;
  sleepAfter = "15m";
  entrypoint = ["node", "--import", "tsx", "apps/observatory/src/server.ts", "--mode", "real"];

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    this.envVars = consoleSettings(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.OBSERVATORY_ENABLED !== "true") return new Response("Console deployment inactive", { status: 503 });
    // Cloudflare Access adds its assertion to every request it lets through. Without one the request did
    // not pass Access (a wrong route or a missing Access application): refuse it before the container starts.
    // The console verifies the assertion itself (apps/observatory/src/staff.ts); this only keeps it closed.
    if (!request.headers.get("cf-access-jwt-assertion")) return new Response("Sign in through Cloudflare Access", { status: 401 });
    return getContainer(env.CONSOLE, "console").fetch(request);
  },
};
