// Origin and host configuration (design §2.5, §3.1, §3.2). The MCP origin is permanent: ChatGPT
// treats an origin change as a new plugin and Claude derives its MCP Apps sandbox domain from it.
// Values come from env (MCP_ORIGIN / NETWORK_DOMAIN, see the repo .env); defaults match production.
import type { SurfaceProfileName } from "./profiles.ts";

export const DEFAULT_NETWORK_DOMAIN = "ntwrk.love";

export interface NetworkConfig {
  /** Brand domain, e.g. ntwrk.love. */
  networkDomain: string;
  /** MCP origin, e.g. https://mcp.ntwrk.love. Also the OAuth issuer (same origin, design §3.1). */
  origin: string;
  /** Canonical RFC 8707 resource identifier: `${origin}/mcp`. */
  resource: string;
  issuer: string;
  /** Path-inserted RFC 9728 metadata URL, used in every WWW-Authenticate challenge. */
  resourceMetadataUrl: string;
  documentationUrl: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = {}): NetworkConfig {
  const networkDomain = (env.NETWORK_DOMAIN || DEFAULT_NETWORK_DOMAIN).trim().toLowerCase();
  const origin = (env.MCP_ORIGIN || `https://mcp.${networkDomain}`).trim().replace(/\/+$/, "");
  const u = new URL(origin);
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !loopback) throw new Error(`MCP_ORIGIN must be https (got ${origin})`);
  if (u.pathname !== "/" || u.search || u.hash) throw new Error(`MCP_ORIGIN must be a bare origin (got ${origin})`);
  return {
    networkDomain,
    origin,
    resource: `${origin}/mcp`,
    issuer: origin,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp`,
    documentationUrl: `https://${networkDomain}/assistants`,
  };
}

/** Accepts `…/mcp` and `…/mcp/` (Perplexity sends a trailing slash; design §3.2). */
export function normalizeResource(value: string, cfg: NetworkConfig): string | null {
  return value.replace(/\/+$/, "") === cfg.resource ? cfg.resource : null;
}

// ---------------------------------------------------------------------------------------------
// Client resolution: host key, trust tier and surface profile come from AUTHENTICATED registration
// data (the CIMD URL host or an exact redirect host), never from MCP `clientInfo.name` (design §3.2).

export type HostKey = "chatgpt" | "claude" | "gemini_enterprise" | "unknown";
export type TrustTier = "verified" | "unverified";
export type AuthChallengeStyle = "http" | "tool_meta";

export interface KnownHost {
  hostKey: HostKey;
  displayName: string;
  profile: SurfaceProfileName;
  /**
   * How a missing-scope failure is surfaced. Claude only starts sign-in on HTTP 401/403 and ignores
   * challenges in a 200 [A7]; ChatGPT shows its linking UI from `_meta["mcp/www_authenticate"]` on a
   * tool error [O5]. Invalid/expired tokens are always a transport-level 401 for every host.
   */
  scopeChallenge: AuthChallengeStyle;
}

export const KNOWN_HOSTS: Record<string, KnownHost> = {
  "chatgpt.com": { hostKey: "chatgpt", displayName: "ChatGPT", profile: "teen_safe_directory", scopeChallenge: "tool_meta" },
  "claude.ai": { hostKey: "claude", displayName: "Claude", profile: "general_assistant", scopeChallenge: "http" },
  "claude.com": { hostKey: "claude", displayName: "Claude", profile: "general_assistant", scopeChallenge: "http" },
  "vertexaisearch.cloud.google.com": { hostKey: "gemini_enterprise", displayName: "Gemini Enterprise", profile: "enterprise_professional", scopeChallenge: "http" },
};

/** Exact redirect URIs per known host (loopback handled separately, port-agnostic for Claude Code). */
export const KNOWN_REDIRECTS: Record<string, string> = {
  "https://chatgpt.com/connector_platform_oauth_redirect": "chatgpt.com",
  "https://claude.ai/api/mcp/auth_callback": "claude.ai",
  "https://claude.com/api/mcp/auth_callback": "claude.com",
  "https://vertexaisearch.cloud.google.com/oauth-redirect": "vertexaisearch.cloud.google.com",
};
const CHATGPT_LEGACY_REDIRECT = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/;
export const isLoopbackRedirect = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/callback$/.test(u);

export interface ResolvedClient {
  clientId: string;
  hostKey: HostKey;
  displayName: string;
  trustTier: TrustTier;
  profile: SurfaceProfileName;
  scopeChallenge: AuthChallengeStyle;
}

const UNKNOWN: Omit<ResolvedClient, "clientId" | "trustTier"> = {
  hostKey: "unknown", displayName: "an assistant", profile: "general_assistant", scopeChallenge: "http",
};

/** Host for a redirect URI, if it is one we know exactly. */
export function knownRedirectHost(uri: string): string | null {
  if (KNOWN_REDIRECTS[uri]) return KNOWN_REDIRECTS[uri]!;
  if (CHATGPT_LEGACY_REDIRECT.test(uri)) return "chatgpt.com";
  return null;
}

/**
 * Resolve a client. `clientId` is either a CIMD URL (https://chatgpt.com/oauth/client.json) or an
 * opaque DCR / pre-registered id, in which case its registered redirect URIs decide the host.
 */
export function resolveClient(clientId: string, registeredRedirects: string[] = []): ResolvedClient {
  let host: string | null = null;
  if (/^https:\/\//.test(clientId)) {
    try { host = new URL(clientId).hostname; } catch { host = null; }
  } else {
    const hosts = new Set(registeredRedirects.map(knownRedirectHost));
    if (hosts.size === 1) host = [...hosts][0] ?? null; // all redirects must agree on one known host
  }
  const known = host ? KNOWN_HOSTS[host] : undefined;
  if (!known) return { clientId, trustTier: "unverified", ...UNKNOWN };
  return { clientId, trustTier: "verified", ...known };
}
