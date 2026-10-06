// Cloudflare Worker entry for mcp.ntwrk.love (see wrangler.toml). NOT deployed by this prototype.
// It serves the production discovery documents from MCP_ORIGIN / NETWORK_DOMAIN and rejects every
// bearer token with a 401 challenge, because the authorization server is still a stub. The
// in-memory FakeNetwork is never reachable here. NETWORK_MCP_ENABLED gates the whole host (§12.1).
import { loadConfig } from "./config.ts";
import { FakeNetwork } from "./fake-network.ts";
import { createHttpHandler, RejectAllVerifier } from "./http.ts";

export interface Env {
  MCP_ORIGIN?: string;
  NETWORK_DOMAIN?: string;
  NETWORK_MCP_ENABLED?: string;
  ALLOWED_BROWSER_ORIGINS?: string;
}

let cached: { key: string; handle: (req: Request) => Promise<Response> } | null = null;

export function handlerFor(env: Env) {
  const key = JSON.stringify(env);
  if (cached?.key === key) return cached.handle;
  const cfg = loadConfig(env as Record<string, string | undefined>);
  const handle = createHttpHandler(new FakeNetwork({ now: () => Date.now() }), {
    cfg,
    verifier: new RejectAllVerifier(),
    enforceHost: true,
    enabled: env.NETWORK_MCP_ENABLED === "true",
    allowedBrowserOrigins: (env.ALLOWED_BROWSER_ORIGINS ?? "https://claude.ai,https://chatgpt.com").split(",").map((s) => s.trim()).filter(Boolean),
  });
  cached = { key, handle };
  return handle;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handlerFor(env)(req);
  },
};
