// HTTP front door: OAuth discovery metadata (RFC 9728 + RFC 8414 shape), stubbed authorization
// server endpoints, and the Streamable HTTP /mcp endpoint with bearer + audience + scope checks.
// Production: the authorization server lives in Eliza Cloud (Steward), which does not yet publish
// OAuth AS metadata for MCP clients (PRD 30.2). Until it does, /authorize and /token here are stubs.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FakeNetwork } from "./fake-network.ts";
import { createMcpServer } from "./server.ts";
import { SCOPES, TOOL_SCOPES, type ToolName } from "./schemas.ts";

export interface VerifiedToken { memberId: string; clientId: string; scopes: string[]; audience: string; expiresAt: number }
export interface TokenVerifier { verify(token: string): Promise<VerifiedToken | null> }

/** Test/dev verifier. Production verifies a JWT (JWKS, iss, aud, exp/nbf, scope) or introspects. */
export class StaticTokenVerifier implements TokenVerifier {
  constructor(private tokens: Record<string, VerifiedToken>, private now: () => number) {}
  async verify(t: string) { const v = this.tokens[t]; return v && v.expiresAt > this.now() ? v : null; }
}

export interface HttpOptions {
  origin: string; // public origin of this resource server, e.g. https://connect.thenetwork.example
  issuer?: string; // authorization server issuer; defaults to origin (stub)
  verifier: TokenVerifier;
  allowedBrowserOrigins?: string[]; // DNS-rebinding defense; requests without Origin (server-to-server) pass
}

/** Redirect URIs the AS should allow (from host docs, Oct 2026). Loopback ports are wildcarded. */
export const ALLOWED_REDIRECTS = [
  /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/,
  /^https:\/\/claude\.com\/api\/mcp\/auth_callback$/,
  /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect$/,
  /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/callback$/,
];

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export function createHttpHandler(net: FakeNetwork, o: HttpOptions) {
  const resource = `${o.origin}/mcp`;
  const issuer = o.issuer ?? o.origin;
  const prmUrl = `${o.origin}/.well-known/oauth-protected-resource/mcp`;
  const allScopes = Object.values(SCOPES);
  const challenge = (extra = "") =>
    `Bearer resource_metadata="${prmUrl}", scope="${allScopes.join(" ")}"${extra}`;

  return async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const browserOrigin = req.headers.get("origin");
    if (browserOrigin && o.allowedBrowserOrigins && !o.allowedBrowserOrigins.includes(browserOrigin))
      return json({ error: "origin_not_allowed" }, 403);

    // RFC 9728 protected resource metadata (path-suffixed form for resource /mcp, and the root form).
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp" || u.pathname === "/.well-known/oauth-protected-resource")
      return json({
        resource,
        authorization_servers: [issuer],
        scopes_supported: allScopes,
        bearer_methods_supported: ["header"],
        resource_name: "The Network",
        resource_documentation: `${o.origin}/docs/connector`,
      });

    // RFC 8414 AS metadata. Stub: in production this document is served by the Eliza Cloud issuer.
    if (u.pathname === "/.well-known/oauth-authorization-server")
      return json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        jwks_uri: `${issuer}/oauth/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"], // public clients; "none" is required for Claude's CIMD path
        client_id_metadata_document_supported: true, // CIMD preferred by ChatGPT, Claude and MCP 2026-07-28
        authorization_response_iss_parameter_supported: true, // RFC 9207
        scopes_supported: allScopes,
      });

    // Dynamic client registration (RFC 7591): deprecated in MCP 2026-07-28 but still the fallback for some hosts.
    if (u.pathname === "/oauth/register" && req.method === "POST") {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "invalid_client_metadata" }, 400); }
      const uris: unknown = body?.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every((x) => typeof x === "string" && ALLOWED_REDIRECTS.some((r) => r.test(x))))
        return json({ error: "invalid_redirect_uri" }, 400);
      return json({ client_id: `dcr_${crypto.randomUUID()}`, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
    }
    if (["/oauth/authorize", "/oauth/token", "/oauth/revoke", "/oauth/jwks.json"].includes(u.pathname))
      return json({ error: "temporarily_unavailable", error_description: "Prototype stub. The authorization server will be Eliza Cloud (PRD 30)." }, 501);

    if (u.pathname !== "/mcp") return json({ error: "not_found" }, 404);

    // ---- MCP resource server ----
    const token = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401, { "www-authenticate": challenge() });
    const v = await o.verifier.verify(token);
    if (!v || v.audience !== resource) // RFC 8707 audience binding: never accept tokens minted for another resource
      return json({ error: "invalid_token" }, 401, { "www-authenticate": challenge(`, error="invalid_token"`) });

    if (req.method === "POST") {
      let msg: any;
      try { msg = await req.clone().json(); } catch { msg = null; }
      for (const m of Array.isArray(msg) ? msg : [msg]) {
        if (m?.method !== "tools/call") continue;
        const need = TOOL_SCOPES[m.params?.name as ToolName];
        if (need && !v.scopes.includes(need))
          return json({ error: "insufficient_scope" }, 403, {
            "www-authenticate": `Bearer error="insufficient_scope", scope="${need}", resource_metadata="${prmUrl}"`,
          });
      }
    }

    // Stateless: one server per request. Elicitation (server->client requests mid-call) needs a
    // stateful session (Durable Object) or the 2026-07-28 multi-round-trip flow; without it,
    // medium-risk confirmations fall back to host_respond (GW-007).
    const server = createMcpServer(net, { memberId: v.memberId, clientId: v.clientId });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(req, {
      authInfo: { token, clientId: v.clientId, scopes: v.scopes, expiresAt: Math.floor(v.expiresAt / 1000), resource: new URL(resource) },
    });
    queueMicrotask(() => void server.close());
    return res;
  };
}
