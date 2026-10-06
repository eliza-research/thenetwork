import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DAY } from "@thenetwork/core";
import { loadConfig } from "../src/config.ts";
import { createHttpHandler, StaticTokenVerifier, type VerifiedToken } from "../src/http.ts";
import { ClientRegistry } from "../src/oauth.ts";
import { DEFAULT_SCOPES, SCOPES } from "../src/schemas.ts";
import { CLIENTS, designJsonBlocks, world } from "./helpers.ts";

const ORIGIN = "https://mcp.ntwrk.love";
const PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
const DEFAULT_SCOPE_STR = "network.read.basic network.write.requests network.write.profile network.write.responses offline_access";

function setup() {
  const w = world();
  const cfg = loadConfig({ NETWORK_DOMAIN: "ntwrk.love", MCP_ORIGIN: ORIGIN });
  const tok = (clientId: string, scopes: string[] = [...DEFAULT_SCOPES], extra: Partial<VerifiedToken> = {}): VerifiedToken => ({
    memberId: w.ava.id, grantId: `grt_${clientId.length}_${scopes.length}`, clientId, scopes, audience: cfg.resource,
    expiresAt: w.clock.now() + 3600_000, grantCreatedAt: w.clock.now() - 7 * DAY, ...extra,
  });
  const clients = new ClientRegistry();
  const verifier = new StaticTokenVerifier({
    claude: tok(CLIENTS.claude),
    chatgpt: tok(CLIENTS.chatgpt),
    claude_readonly: tok(CLIENTS.claude, [SCOPES.readBasic]),
    chatgpt_readonly: tok(CLIENTS.chatgpt, [SCOPES.readBasic]),
    otheraud: tok(CLIENTS.claude, [...DEFAULT_SCOPES], { audience: "https://elsewhere.test/mcp" }),
    trailing: tok(CLIENTS.claude, [...DEFAULT_SCOPES], { audience: `${ORIGIN}/mcp/` }),
    expired: tok(CLIENTS.claude, [...DEFAULT_SCOPES], { expiresAt: w.clock.now() - 1 }),
  }, () => w.clock.now());
  const handle = createHttpHandler(w.net, { cfg, verifier, clients, allowedBrowserOrigins: ["https://claude.ai", "https://chatgpt.com"] });
  return { w, cfg, handle, clients, verifier };
}
const rpc = (token: string | null, body: unknown, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25",
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra,
    },
    body: JSON.stringify(body),
  });
const init = (name = "t") => ({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name, version: "0" } } });
const toolCall = (name: string, args: Record<string, unknown>, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("config: the permanent origin is ntwrk.love", () => {
  test("defaults and the repo .env.example agree on https://mcp.ntwrk.love", () => {
    const d = loadConfig({});
    expect(d).toMatchObject({ networkDomain: "ntwrk.love", origin: ORIGIN, issuer: ORIGIN, resource: `${ORIGIN}/mcp`, resourceMetadataUrl: PRM_URL, documentationUrl: "https://ntwrk.love/assistants" });
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    expect(example).toMatch(/^NETWORK_DOMAIN=ntwrk\.love$/m);
    expect(example).toMatch(/^MCP_ORIGIN=https:\/\/mcp\.ntwrk\.love$/m);
    expect(loadConfig({ NETWORK_DOMAIN: "ntwrk.love" }).origin).toBe(ORIGIN);
    expect(loadConfig({ MCP_ORIGIN: "https://mcp-staging.ntwrk.love/" }).resource).toBe("https://mcp-staging.ntwrk.love/mcp");
    expect(() => loadConfig({ MCP_ORIGIN: "http://mcp.ntwrk.love" })).toThrow();
    expect(() => loadConfig({ MCP_ORIGIN: "https://mcp.ntwrk.love/mcp" })).toThrow();
  });
});

describe("OAuth metadata (RFC 9728, RFC 8414) at the ntwrk.love origin", () => {
  test("protected resource metadata equals the design document at both well-known paths", async () => {
    const { handle } = setup();
    const designPrm = designJsonBlocks().find((b) => "resource" in b && "authorization_servers" in b);
    expect(designPrm.resource).toBe(`${ORIGIN}/mcp`);
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await handle(new Request(ORIGIN + path));
      expect(res.status).toBe(200);
      const m = await res.json();
      expect(m).toEqual(designPrm);
      expect(m.authorization_servers).toEqual([ORIGIN]); // exactly one: Claude uses the first only
    }
  });

  test("authorization server metadata equals the design document and is mirrored at openid-configuration", async () => {
    const { handle } = setup();
    const designAs = designJsonBlocks().find((b) => "issuer" in b);
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const m = await (await handle(new Request(ORIGIN + path))).json();
      expect(m).toEqual(designAs);
      expect(m.issuer).toBe(ORIGIN);
      expect(m.code_challenge_methods_supported).toEqual(["S256"]);
      expect(m.client_id_metadata_document_supported).toBe(true);
      expect(m.token_endpoint_auth_methods_supported).toContain("none");
      expect(m.token_endpoint_auth_methods_supported).not.toContain("client_secret_post");
      expect(m.authorization_response_iss_parameter_supported).toBe(true);
      for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint", "jwks_uri"]) expect(m[k].startsWith(`${ORIGIN}/oauth/`)).toBe(true);
      expect(m.scopes_supported).not.toContain("openid");
      expect(m.scopes_supported).not.toContain("email");
      expect(m.scopes_supported).not.toContain("profile");
    }
  });

  test("PRM authorization_servers[0] equals the AS issuer exactly (ChatGPT requirement)", async () => {
    const { handle } = setup();
    const prm = await (await handle(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))).json();
    const as = await (await handle(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(prm.authorization_servers[0]).toBe(as.issuer);
  });

  test("stubbed AS endpoints say so; JWKS is served", async () => {
    const { handle } = setup();
    for (const p of ["/oauth/authorize", "/oauth/token", "/oauth/revoke"]) expect((await handle(new Request(ORIGIN + p, { method: "POST" }))).status).toBe(501);
    expect(await (await handle(new Request(`${ORIGIN}/oauth/jwks.json`))).json()).toEqual({ keys: [] });
  });

  test("DCR: public clients only, https or loopback redirects, look-alike names refused, known hosts verified", async () => {
    const { handle, clients } = setup();
    const reg = (body: unknown) => handle(new Request(`${ORIGIN}/oauth/register`, { method: "POST", body: JSON.stringify(body) }));
    const claude = await reg({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" });
    expect(claude.status).toBe(201);
    const cj = await claude.json();
    expect(cj.token_endpoint_auth_method).toBe("none");
    expect(clients.resolve(cj.client_id)).toMatchObject({ hostKey: "claude", trustTier: "verified", profile: "general_assistant" });
    const gpt = await (await reg({ redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] })).json();
    expect(clients.resolve(gpt.client_id).profile).toBe("teen_safe_directory");
    expect((await reg({ redirect_uris: ["http://127.0.0.1:53111/callback"] })).status).toBe(201);
    const other = await reg({ redirect_uris: ["https://le-chat.example.test/cb"] });
    expect(other.status).toBe(201);
    expect(clients.resolve((await other.json()).client_id)).toMatchObject({ trustTier: "unverified", profile: "general_assistant" });
    expect((await reg({ redirect_uris: ["http://evil.test/cb"] })).status).toBe(400);
    expect((await reg({ redirect_uris: ["https://evil.test/cb"], token_endpoint_auth_method: "client_secret_post" })).status).toBe(400);
    expect((await reg({ redirect_uris: ["https://evil.test/cb"], client_name: "The Network Official" })).status).toBe(400);
    expect((await reg({ redirect_uris: ["https://evil.test/cb"], client_name: "ChatGPT" })).status).toBe(400);
  });
});

describe("auth challenges", () => {
  test("Claude-style: no token → HTTP 401 with resource_metadata and scope, before the SDK runs", async () => {
    const { handle } = setup();
    const r = await handle(rpc(null, init()));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${PRM_URL}", scope="${DEFAULT_SCOPE_STR}"`);
    // even a malformed body gets the 401 first
    expect((await handle(new Request(`${ORIGIN}/mcp`, { method: "POST", body: "{not json" }))).status).toBe(401);
  });

  test("invalid, expired, wrong-audience tokens → 401 error=invalid_token; trailing-slash audience accepted", async () => {
    const { handle } = setup();
    for (const t of ["nope", "expired", "otheraud"]) {
      const r = await handle(rpc(t, init()));
      expect(r.status).toBe(401);
      const h = r.headers.get("www-authenticate")!;
      expect(h.startsWith(`Bearer resource_metadata="${PRM_URL}"`)).toBe(true);
      expect(h).toContain(`error="invalid_token"`);
      expect(h).toContain("error_description=");
    }
    expect((await handle(rpc("trailing", init()))).status).toBe(200);
  });

  test("Claude-style missing scope → HTTP 403 insufficient_scope step-up; nothing executes", async () => {
    const { handle, w } = setup();
    const r = await handle(rpc("claude_readonly", toolCall("respond_to_network_item", { item_id: "itm_abcdef1234", response: "interested" })));
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${PRM_URL}", scope="network.write.responses", error="insufficient_scope", error_description="This action needs network.write.responses."`);
    expect(w.net.audit).toHaveLength(0);
  });

  test("ChatGPT-style missing scope → tool error with _meta['mcp/www_authenticate'] (plus securitySchemes on the tool)", async () => {
    const { handle, w } = setup();
    const r = await handle(rpc("chatgpt_readonly", toolCall("tell_network_agent", { instruction: "pause for a week" })));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.result.isError).toBe(true);
    const challenges = body.result._meta["mcp/www_authenticate"];
    expect(Array.isArray(challenges)).toBe(true);
    expect(challenges[0]).toMatch(new RegExp(`^Bearer resource_metadata="${PRM_URL.replace(/[./]/g, "\\$&")}", scope="network\\.write\\.requests", error="insufficient_scope", error_description="[^"]+"$`));
    expect(body.result._meta["network/error"].code).toBe("needs_scope");
    expect(body.result.structuredContent).toBeUndefined();
    expect(w.net.effects).toHaveLength(0);
    const list = await (await handle(rpc("chatgpt_readonly", { jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    const tell = list.result.tools.find((t: any) => t.name === "tell_network_agent");
    expect(tell._meta.securitySchemes).toEqual([{ type: "oauth2", scopes: ["network.write.requests"] }]);
  });
});

describe("Streamable HTTP behavior", () => {
  test("stateless initialize, list and call over JSON; serverInfo and instructions", async () => {
    const { handle, w } = setup();
    const i = await handle(rpc("claude", init()));
    expect(i.status).toBe(200);
    const ij = await i.json();
    expect(ij.result.serverInfo).toMatchObject({ name: "the-network", title: "The Network" });
    expect(ij.result.instructions.slice(0, 512)).toContain("ask_network_agent");
    const list = await (await handle(rpc("claude", { jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(list.result.tools).toHaveLength(5);
    const call = await (await handle(rpc("claude_readonly", toolCall("get_network_updates", { limit: 10 }, 3)))).json();
    expect(call.result.structuredContent.items.map((x: any) => x.title)).toContain(w.trivia.title);
    expect(JSON.stringify(call)).not.toContain("CANARY_");
  });

  test("the profile comes from the token's client, not from clientInfo: a ChatGPT token never sees 21+ or romance", async () => {
    const { handle, w } = setup();
    await handle(rpc("chatgpt", init("claude-ai")));
    const call = await (await handle(rpc("chatgpt", toolCall("get_network_updates", { limit: 10 })))).json();
    const titles = call.result.structuredContent.items.map((x: any) => x.title);
    expect(titles).not.toContain(w.trivia.title);
    expect(JSON.stringify(call)).not.toMatch(/cocktail|CANARY_ROMANCE|CANARY_SPONSORED/);
  });

  test("GET/DELETE → 405, batches → 400, CORS preflight, DNS-rebinding defense, unknown paths 404", async () => {
    const { handle } = setup();
    for (const method of ["GET", "DELETE"]) expect((await handle(new Request(`${ORIGIN}/mcp`, { method, headers: { authorization: "Bearer claude" } }))).status).toBe(405);
    expect((await handle(rpc("claude", [init(), { jsonrpc: "2.0", id: 2, method: "tools/list" }]))).status).toBe(400);
    const pre = await handle(new Request(`${ORIGIN}/mcp`, { method: "OPTIONS", headers: { origin: "https://claude.ai" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
    expect(pre.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    const unauth = await handle(rpc(null, init(), { origin: "https://claude.ai" }));
    expect(unauth.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    expect((await handle(rpc("claude", init(), { origin: "https://evil.test" }))).status).toBe(403);
    expect((await handle(rpc("claude", init(), { origin: "https://chatgpt.com" }))).status).toBe(200);
    expect((await handle(new Request(`${ORIGIN}/network/graph`))).status).toBe(404);
  });
});
