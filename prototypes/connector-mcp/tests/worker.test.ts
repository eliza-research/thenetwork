import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import worker, { type Env } from "../src/worker.ts";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const prodVars: Env = { NETWORK_DOMAIN: "ntwrk.love", MCP_ORIGIN: "https://mcp.ntwrk.love", ALLOWED_BROWSER_ORIGINS: "https://claude.ai,https://chatgpt.com" };

describe("Cloudflare Worker config for mcp.ntwrk.love (not deployed)", () => {
  test("wrangler.toml routes mcp.ntwrk.love/* on the ntwrk.love zone, in the right account, flag off by default", () => {
    expect(toml).toMatch(/pattern = "mcp\.ntwrk\.love\/\*", zone_name = "ntwrk\.love"/);
    expect(toml).toMatch(/^account_id = "50ad2052bbc6ca528d6993a689b419a4"$/m);
    expect(toml).toMatch(/^main = "src\/worker\.ts"$/m);
    expect(toml).toMatch(/^MCP_ORIGIN = "https:\/\/mcp\.ntwrk\.love"$/m);
    expect(toml).toMatch(/^NETWORK_DOMAIN = "ntwrk\.love"$/m);
    expect(toml).toMatch(/^NETWORK_MCP_ENABLED = "false"$/m);
    expect(toml).toMatch(/nodejs_compat/);
    expect(toml).toMatch(/^workers_dev = false$/m);
  });

  test("disabled → 404 everywhere", async () => {
    const r = await worker.fetch(new Request("https://mcp.ntwrk.love/.well-known/oauth-protected-resource/mcp"), { ...prodVars, NETWORK_MCP_ENABLED: "false" });
    expect(r.status).toBe(404);
  });

  test("enabled → serves ntwrk.love metadata, 401s every token, 404s other hosts", async () => {
    const env = { ...prodVars, NETWORK_MCP_ENABLED: "true" };
    const prm = await (await worker.fetch(new Request("https://mcp.ntwrk.love/.well-known/oauth-protected-resource/mcp"), env)).json();
    expect(prm).toMatchObject({ resource: "https://mcp.ntwrk.love/mcp", authorization_servers: ["https://mcp.ntwrk.love"] });
    const as = await (await worker.fetch(new Request("https://mcp.ntwrk.love/.well-known/oauth-authorization-server"), env)).json();
    expect(as.issuer).toBe("https://mcp.ntwrk.love");
    const mcp = await worker.fetch(new Request("https://mcp.ntwrk.love/mcp", { method: "POST", headers: { authorization: "Bearer anything", "content-type": "application/json" }, body: "{}" }), env);
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.ntwrk.love/.well-known/oauth-protected-resource/mcp"');
    expect((await worker.fetch(new Request("https://evil.example/.well-known/oauth-protected-resource"), env)).status).toBe(404);
  });
});
