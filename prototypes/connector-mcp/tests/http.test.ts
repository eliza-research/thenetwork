import { describe, expect, test } from "bun:test";
import { createHttpHandler, StaticTokenVerifier } from "../src/http.ts";
import { SCOPES } from "../src/schemas.ts";
import { world } from "./helpers.ts";

const ORIGIN = "https://connect.network.test";
function setup() {
  const w = world();
  const all = Object.values(SCOPES);
  const verifier = new StaticTokenVerifier({
    good: { memberId: w.ava.id, clientId: "claude", scopes: all, audience: `${ORIGIN}/mcp`, expiresAt: w.clock.now() + 3600_000 },
    readonly: { memberId: w.ava.id, clientId: "grok", scopes: [SCOPES.read], audience: `${ORIGIN}/mcp`, expiresAt: w.clock.now() + 3600_000 },
    otheraud: { memberId: w.ava.id, clientId: "x", scopes: all, audience: "https://elsewhere.test/mcp", expiresAt: w.clock.now() + 3600_000 },
  }, () => w.clock.now());
  const handle = createHttpHandler(w.net, { origin: ORIGIN, verifier, allowedBrowserOrigins: ["https://claude.ai", "https://chatgpt.com"] });
  return { w, handle };
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
const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } };

describe("OAuth discovery and resource-server checks", () => {
  test("protected resource metadata points at the authorization server", async () => {
    const { handle } = setup();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const m = await (await handle(new Request(ORIGIN + path))).json();
      expect(m).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], bearer_methods_supported: ["header"] });
      expect(m.scopes_supported).toEqual(Object.values(SCOPES));
    }
  });

  test("authorization server metadata advertises PKCE S256, CIMD, iss and public clients", async () => {
    const { handle } = setup();
    const m = await (await handle(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.token_endpoint_auth_methods_supported).toContain("none");
    expect(m.authorization_response_iss_parameter_supported).toBe(true);
    expect((await handle(new Request(`${ORIGIN}/oauth/token`, { method: "POST" }))).status).toBe(501);
  });

  test("DCR only accepts known host callbacks", async () => {
    const { handle } = setup();
    const reg = (uris: string[]) => handle(new Request(`${ORIGIN}/oauth/register`, { method: "POST", body: JSON.stringify({ redirect_uris: uris }) }));
    expect((await reg(["https://claude.ai/api/mcp/auth_callback"])).status).toBe(201);
    expect((await reg(["http://127.0.0.1:53111/callback"])).status).toBe(201);
    expect((await reg(["https://evil.test/cb"])).status).toBe(400);
  });

  test("no token -> 401 with resource_metadata challenge; wrong audience -> 401", async () => {
    const { handle } = setup();
    const r = await handle(rpc(null, init));
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect((await handle(rpc("otheraud", init))).status).toBe(401);
    expect((await handle(rpc("nope", init))).status).toBe(401);
  });

  test("scope enforcement per tool -> 403 insufficient_scope", async () => {
    const { handle, w } = setup();
    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "network_respond", arguments: { item_id: w.intro.item_id, decision: "accept", client_request_id: "req_http_0001" } } };
    const r = await handle(rpc("readonly", call));
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate")).toContain(`error="insufficient_scope", scope="${SCOPES.respond}"`);
    expect(w.intro.status).toBe("open");
  });

  test("unknown browser origins are refused (DNS rebinding defense)", async () => {
    const { handle } = setup();
    expect((await handle(rpc("good", init, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await handle(rpc("good", init, { origin: "https://claude.ai" }))).status).toBe(200);
  });

  test("stateless Streamable HTTP: initialize, list and call over JSON responses", async () => {
    const { handle, w } = setup();
    const i = await handle(rpc("good", init));
    expect(i.status).toBe(200);
    expect((await i.json()).result.serverInfo.name).toBe("the-network");
    const list = await (await handle(rpc("good", { jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(list.result.tools).toHaveLength(4);
    const call = await (await handle(rpc("readonly", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "network_get_updates", arguments: {} } }))).json();
    expect(call.result.structuredContent.items).toHaveLength(2);
    expect(JSON.stringify(call)).not.toContain("CANARY_");
    expect(w.net.audit.at(-1)!.clientId).toBe("grok");
  });
});
