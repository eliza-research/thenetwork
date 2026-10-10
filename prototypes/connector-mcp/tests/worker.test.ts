import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/worker.ts";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const prodVars: Env = { NETWORK_DOMAIN: "ntwrk.party", MCP_ORIGIN: "https://mcp.ntwrk.party", ALLOWED_BROWSER_ORIGINS: "https://claude.ai,https://chatgpt.com" };

describe("Cloudflare Worker config for mcp.ntwrk.party (not deployed)", () => {
  test("wrangler.toml routes mcp.ntwrk.party/* on the ntwrk.party zone, in the right account, flag off by default", () => {
    expect(toml).toMatch(/pattern = "mcp\.ntwrk\.party\/\*", zone_name = "ntwrk\.party"/);
    expect(toml).toMatch(/^account_id = "50ad2052bbc6ca528d6993a689b419a4"$/m);
    expect(toml).toMatch(/^main = "src\/worker\.ts"$/m);
    expect(toml).toMatch(/^MCP_ORIGIN = "https:\/\/mcp\.ntwrk\.party"$/m);
    expect(toml).toMatch(/^NETWORK_DOMAIN = "ntwrk\.party"$/m);
    expect(toml).toMatch(/^NETWORK_MCP_ENABLED = "false"$/m);
    expect(toml).toMatch(/nodejs_compat/);
    expect(toml).toMatch(/^workers_dev = false$/m);
    // dry runs name the environment (no "multiple environments" warning), and nothing secret is configured
    expect(toml).toContain('deploy --dry-run --env="" -c prototypes/connector-mcp/wrangler.toml');
    expect(toml).not.toMatch(/^\s*[A-Z_]*(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE)[A-Z_]*\s*=/m);
    expect(toml).toMatch(/\[env\.staging\.vars\][\s\S]*NETWORK_MCP_ENABLED = "false"/);
  });

  test("the flag is checked before config is parsed: a bad MCP_ORIGIN while disabled is a 404, not a 500", async () => {
    for (const NETWORK_MCP_ENABLED of [undefined, "false", "TRUE", "1", "yes"]) {
      const r = await worker.fetch(new Request("https://mcp.ntwrk.party/mcp", { method: "POST" }), { ...prodVars, MCP_ORIGIN: "http://not-https.example", NETWORK_MCP_ENABLED });
      expect(r.status).toBe(404);
    }
  });

  test("DCR is a 501 stub on the Worker (no isolate-local client store)", async () => {
    const r = await worker.fetch(new Request("https://mcp.ntwrk.party/oauth/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    }), { ...prodVars, NETWORK_MCP_ENABLED: "true" });
    expect(r.status).toBe(501);
  });

  test("disabled → 404 everywhere", async () => {
    const r = await worker.fetch(new Request("https://mcp.ntwrk.party/.well-known/oauth-protected-resource/mcp"), { ...prodVars, NETWORK_MCP_ENABLED: "false" });
    expect(r.status).toBe(404);
  });

  test("enabled → serves ntwrk.party metadata, 401s every token, 404s other hosts", async () => {
    const env = { ...prodVars, NETWORK_MCP_ENABLED: "true" };
    const prm = await (await worker.fetch(new Request("https://mcp.ntwrk.party/.well-known/oauth-protected-resource/mcp"), env)).json();
    expect(prm).toMatchObject({ resource: "https://mcp.ntwrk.party/mcp", authorization_servers: ["https://mcp.ntwrk.party"] });
    const as = await (await worker.fetch(new Request("https://mcp.ntwrk.party/.well-known/oauth-authorization-server"), env)).json();
    expect(as.issuer).toBe("https://mcp.ntwrk.party");
    const mcp = await worker.fetch(new Request("https://mcp.ntwrk.party/mcp", { method: "POST", headers: { authorization: "Bearer anything", "content-type": "application/json" }, body: "{}" }), env);
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.ntwrk.party/.well-known/oauth-protected-resource/mcp"');
    expect((await worker.fetch(new Request("https://evil.example/.well-known/oauth-protected-resource"), env)).status).toBe(404);
  });
});
