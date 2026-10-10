// OAuth discovery documents (design §3.1) and the prototype client registry (§3.2). Issuer and
// resource are the permanent MCP origin (https://mcp.ntwrk.party). The authorization, token and
// revocation endpoints are stubs in this prototype; the metadata is what production will publish.
import { isLoopbackRedirect, KNOWN_HOSTS, resolveClient, type NetworkConfig, type ResolvedClient } from "./config.ts";
import { textVariants } from "./policy.ts";
import { ALL_AS_SCOPES, DEFAULT_SCOPES } from "./schemas.ts";

const BRAND_WORDS = [
  "network", "ntwrk", "official", "verified", "openai", "chatgpt", "anthropic", "claude", "google", "gemini",
  ...Object.values(KNOWN_HOSTS).map((h) => h.displayName.toLowerCase().replace(/[^a-z0-9]/g, "")),
];
/** True if a client-supplied name contains (a look-alike of) our brand, a host brand, "official" or "verified". */
export function looksLikeBrand(name: string): boolean {
  return textVariants(name).some((v) => { const k = v.replace(/[^a-z0-9]/g, ""); return BRAND_WORDS.some((b) => k.includes(b)); });
}

/** RFC 9728 protected resource metadata, served at /.well-known/oauth-protected-resource[/mcp]. */
export function protectedResourceMetadata(cfg: NetworkConfig) {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer], // exactly one: Claude uses only the first [A6]
    scopes_supported: [...DEFAULT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "The Network",
    resource_documentation: cfg.documentationUrl,
  };
}

/** RFC 8414 authorization server metadata, also mirrored at /.well-known/openid-configuration. */
export function authorizationServerMetadata(cfg: NetworkConfig) {
  const o = cfg.issuer;
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    jwks_uri: `${o}/oauth/jwks.json`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // "none" + client_id_metadata_document_supported is what makes Claude pick CIMD [A6];
    // private_key_jwt covers ChatGPT's CIMD option [O5]. client_secret_post is never advertised.
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256", "ES256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true, // RFC 9207: iss on every authorization response
    // No openid/email/profile: ChatGPT requests advertised OIDC scopes by default [O5].
    scopes_supported: [...ALL_AS_SCOPES],
    service_documentation: cfg.documentationUrl,
  };
}

/** In-memory DCR store (production: network.oauth_clients in Postgres). DCR clients never expire [O5]. */
export class ClientRegistry {
  private dcr = new Map<string, { redirectUris: string[]; clientName?: string }>();

  register(body: unknown): { status: number; body: Record<string, unknown> } {
    const b = (body ?? {}) as Record<string, unknown>;
    const uris = b.redirect_uris;
    const bad = (error_description: string) => ({ status: 400, body: { error: "invalid_redirect_uri", error_description } });
    if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string"))
      return bad("redirect_uris must be 1-5 strings");
    for (const u of uris as string[]) {
      if (!(u.startsWith("https://") || isLoopbackRedirect(u))) return bad("redirect_uris must be https or loopback");
    }
    const method = b.token_endpoint_auth_method ?? "none";
    if (method !== "none")
      return { status: 400, body: { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none) may register dynamically." } };
    const clientName = typeof b.client_name === "string" ? b.client_name.slice(0, 80) : undefined;
    const clientId = `dcr_${crypto.randomUUID().replace(/-/g, "")}`;
    const resolved = resolveClient(clientId, uris as string[]);
    // Look-alike names are refused for unverified clients (design §8.3), compared on a folded
    // skeleton so case, fullwidth forms, homoglyphs, zero-width characters and spacing don't help.
    if (resolved.trustTier === "unverified" && clientName && looksLikeBrand(clientName))
      return { status: 400, body: { error: "invalid_client_metadata", error_description: "client_name is not allowed for this client." } };
    this.dcr.set(clientId, { redirectUris: uris as string[], clientName });
    return {
      status: 201,
      body: {
        client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: uris,
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        ...(clientName ? { client_name: clientName } : {}),
      },
    };
  }

  /** Resolve host key, trust tier and surface profile for a token's client_id. */
  resolve(clientId: string): ResolvedClient {
    return resolveClient(clientId, this.dcr.get(clientId)?.redirectUris ?? []);
  }
}

