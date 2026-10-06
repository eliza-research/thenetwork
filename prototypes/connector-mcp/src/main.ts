// Local run: `bun run src/main.ts`, then point MCP Inspector at http://localhost:8787/mcp with header
// `Authorization: Bearer dev-ava` (Claude profile) or `dev-ava-chatgpt` (ChatGPT teen-safe profile)
// or `dev-kai` (a 16-year-old member). Synthetic world only. Discovery documents always describe the
// production origin from MCP_ORIGIN / NETWORK_DOMAIN (default https://mcp.ntwrk.love).
import { RealClock, SimClock } from "@thenetwork/core";
import { loadConfig } from "./config.ts";
import { FakeNetwork, seedWorld } from "./fake-network.ts";
import { createHttpHandler, StaticTokenVerifier, type VerifiedToken } from "./http.ts";
import { DEFAULT_SCOPES } from "./schemas.ts";

const port = Number(process.env.PORT ?? 8787);
const cfg = loadConfig(process.env);
const clock = process.env.SIM_CLOCK ? new SimClock() : new RealClock();
const net = new FakeNetwork(clock, { assistantsUrl: `${cfg.networkDomain}/assistants` });
const { ava, kai } = seedWorld(net);
const tok = (memberId: string, clientId: string, grantId: string): VerifiedToken => ({
  memberId, clientId, grantId, scopes: [...DEFAULT_SCOPES], audience: cfg.resource,
  expiresAt: Number.MAX_SAFE_INTEGER, grantCreatedAt: clock.now() - 7 * 24 * 3600_000,
});
const verifier = new StaticTokenVerifier({
  "dev-ava": tok(ava.id, "https://claude.ai/oauth/claude-code-client-metadata", "grt_dev_claude"),
  "dev-ava-chatgpt": tok(ava.id, "https://chatgpt.com/oauth/client.json", "grt_dev_chatgpt"),
  "dev-kai": tok(kai.id, "https://claude.ai/oauth/claude-code-client-metadata", "grt_dev_kai"),
}, () => clock.now());
const handle = createHttpHandler(net, { cfg, verifier });
Bun.serve({ port, fetch: handle });
console.log(`The Network connector prototype on http://localhost:${port}/mcp (resource ${cfg.resource}; tokens: dev-ava, dev-ava-chatgpt, dev-kai)`);
