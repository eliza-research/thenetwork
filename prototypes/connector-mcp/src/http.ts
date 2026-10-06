// HTTP front door on the MCP origin (design §2.2, §2.5, §3): OAuth discovery documents, stubbed
// authorization-server endpoints, and stateless Streamable HTTP at POST /mcp with bearer, audience
// and scope checks performed BEFORE the MCP SDK parses the body (Claude requires the 401 first [A7]).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizeResource, type NetworkConfig } from "./config.ts";
import type { ConnectorPrincipal, FakeNetwork } from "./fake-network.ts";
import { authorizationServerMetadata, ClientRegistry, protectedResourceMetadata } from "./oauth.ts";
import { DEFAULT_SCOPES, TOOL_SCOPES, type ToolName } from "./schemas.ts";
import { bearerChallenge, createMcpServer, stepUpScope } from "./server.ts";

/** Claims from a verified `at+jwt` access token (design §3.6). */
export interface VerifiedToken {
  memberId: string;
  grantId: string;
  /** CIMD URL or DCR / pre-registered client id. Decides host key and surface profile. */
  clientId: string;
  scopes: string[];
  audience: string;
  expiresAt: number;
  grantCreatedAt: number;
}
export interface TokenVerifier { verify(token: string): Promise<VerifiedToken | null> }

/** Test/dev verifier. Production verifies the JWT (JWKS, iss, typ at+jwt, aud, exp/nbf) and grant status. */
export class StaticTokenVerifier implements TokenVerifier {
  constructor(private tokens: Record<string, VerifiedToken>, private now: () => number) {}
  async verify(t: string) { const v = this.tokens[t]; return v && v.expiresAt > this.now() ? v : null; }
}
/** Used by the Worker until the real authorization server exists: every token is rejected (401). */
export class RejectAllVerifier implements TokenVerifier { async verify() { return null; } }

export interface HttpOptions {
  cfg: NetworkConfig;
  verifier: TokenVerifier;
  clients?: ClientRegistry;
  /** DNS-rebinding defense: browser Origins allowed to call /mcp; requests without Origin pass. */
  allowedBrowserOrigins?: string[];
  /** Serve only requests addressed to the MCP host (production); all other hosts get 404. */
  enforceHost?: boolean;
  /** NETWORK_MCP_ENABLED (design §12.1): when false every path returns 404. */
  enabled?: boolean;
  /**
   * Serve the in-memory DCR endpoint (local runs and tests). The Worker sets this to false: an
   * isolate-local registry would hand out client_ids that vanish on the next isolate, and it has no
   * per-IP registration limit (design §3.2), so /oauth/register is a 501 stub there like the rest of the AS.
   */
  dynamicRegistration?: boolean;
}

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID";
const CORS_EXPOSE_HEADERS = "WWW-Authenticate, Mcp-Session-Id";

export function createHttpHandler(net: FakeNetwork, o: HttpOptions) {
  const { cfg } = o;
  const clients = o.clients ?? new ClientRegistry();
  const mcpHost = new URL(cfg.origin).host;
  const defaultScope = DEFAULT_SCOPES.join(" ");

  return async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const browserOrigin = req.headers.get("origin");
    const cors: Record<string, string> = browserOrigin && o.allowedBrowserOrigins?.includes(browserOrigin)
      ? { "access-control-allow-origin": browserOrigin, "access-control-expose-headers": CORS_EXPOSE_HEADERS, vary: "Origin" }
      : {};
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
      Response.json(data, { status, headers: { "cache-control": "no-store", ...cors, ...headers } });

    if (o.enabled === false) return json({ error: "not_found" }, 404);
    if (o.enforceHost && u.host !== mcpHost) return json({ error: "not_found" }, 404);
    if (browserOrigin && o.allowedBrowserOrigins && !o.allowedBrowserOrigins.includes(browserOrigin))
      return json({ error: "origin_not_allowed" }, 403);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": CORS_ALLOW_HEADERS, "access-control-max-age": "86400" } });

    // ---- discovery documents (public, cacheable)
    const pub = { "cache-control": "public, max-age=3600" };
    if (req.method === "GET" && (u.pathname === "/.well-known/oauth-protected-resource/mcp" || u.pathname === "/.well-known/oauth-protected-resource"))
      return json(protectedResourceMetadata(cfg), 200, pub);
    if (req.method === "GET" && (u.pathname === "/.well-known/oauth-authorization-server" || u.pathname === "/.well-known/openid-configuration"))
      return json(authorizationServerMetadata(cfg), 200, pub);

    // ---- authorization server (prototype: DCR works, the rest is stubbed)
    if (u.pathname === "/oauth/register" && req.method === "POST" && o.dynamicRegistration !== false) {
      let body: unknown;
      try { body = await req.json(); } catch { return json({ error: "invalid_client_metadata" }, 400); }
      const r = clients.register(body);
      return json(r.body, r.status);
    }
    if (u.pathname === "/oauth/jwks.json" && req.method === "GET") return json({ keys: [] }, 200);
    if (["/oauth/authorize", "/oauth/token", "/oauth/revoke", "/oauth/register"].includes(u.pathname))
      return json({ error: "temporarily_unavailable", error_description: "Prototype stub: the Network authorization server is not implemented yet (design §3.3, §3.6)." }, 501);

    if (u.pathname !== "/mcp" && u.pathname !== "/mcp/") return json({ error: "not_found" }, 404);
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" }); // no GET stream, no DELETE (§2.2)

    // ---- resource server: authenticate before the SDK sees the request
    const token = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401, { "www-authenticate": bearerChallenge(cfg, { scope: defaultScope }) });
    const v = await o.verifier.verify(token);
    if (!v || normalizeResource(v.audience, cfg) === null) // RFC 8707: never accept a token minted for another resource
      return json({ error: "invalid_token" }, 401, {
        "www-authenticate": bearerChallenge(cfg, { scope: defaultScope, error: "invalid_token", description: "The access token is invalid or expired." }),
      });
    const client = clients.resolve(v.clientId);

    let msg: any;
    try { msg = await req.clone().json(); } catch { msg = null; }
    if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "JSON-RPC batches are not supported" } }, 400);
    if (msg?.method === "tools/call") {
      const need = TOOL_SCOPES[msg.params?.name as ToolName];
      // Claude & spec clients: HTTP 403 step-up (MCP 2025-11-25 "Runtime Insufficient Scope Errors").
      // The challenged scope is granted ∪ needed, the spec's recommended approach, so re-authorizing
      // never drops scopes the member already granted. ChatGPT: the tool returns its _meta challenge [O5].
      if (need && !v.scopes.includes(need) && client.scopeChallenge === "http")
        return json({ error: "insufficient_scope" }, 403, {
          "www-authenticate": bearerChallenge(cfg, { scope: stepUpScope(v.scopes, need), error: "insufficient_scope", description: `This action needs ${need}.` }),
        });
    }

    const principal: ConnectorPrincipal = {
      memberId: v.memberId, grantId: v.grantId, clientId: v.clientId, hostKey: client.hostKey, hostDisplayName: client.displayName,
      scopes: v.scopes, surfaceProfile: client.profile, trustTier: client.trustTier, grantCreatedAt: v.grantCreatedAt,
    };
    // Stateless: a fresh server and transport per request (§2.3). No elicitation in P1 (§6.4).
    const server = createMcpServer(net, principal, { cfg });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(req, {
      authInfo: { token, clientId: v.clientId, scopes: v.scopes, expiresAt: Math.floor(v.expiresAt / 1000), resource: new URL(cfg.resource) },
    });
    queueMicrotask(() => void server.close());
    if (!Object.keys(cors).length) return res;
    const headers = new Headers(res.headers);
    for (const [k, val] of Object.entries(cors)) headers.set(k, val);
    return new Response(res.body, { status: res.status, headers });
  };
}
