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

/**
 * RFC 8707 audience / resource check. Accepts `…/mcp` and `…/mcp/` (Perplexity sends a trailing
 * slash; design §3.2) and uppercase scheme and host, which MCP 2025-11-25 says servers SHOULD accept.
 * Anything else (another path on this origin, the bare origin, a query or fragment, another host) is
 * not this resource.
 */
export function normalizeResource(value: string, cfg: NetworkConfig): string | null {
  let u: URL;
  try { u = new URL(value); } catch { return null; }
  if (u.search || u.hash || u.username || u.password) return null;
  const canonical = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  return canonical === cfg.resource ? cfg.resource : null;
}

// ---------------------------------------------------------------------------------------------
// Client resolution: host key, trust tier and surface profile come from AUTHENTICATED registration
// data (the CIMD URL host or an exact redirect host), never from MCP `clientInfo.name` (design §3.2).

export type HostKey = "chatgpt" | "claude" | "gemini_enterprise" | "unknown";
export type TrustTier = "verified" | "unverified";
export type AuthChallengeStyle = "http" | "tool_meta";

export interface KnownHost {
  hostKey: HostKey;
  /**
   * CIMD client_id paths this host publishes. A CIMD URL on the host but outside these paths is not
   * the host's client (it could be user content the host serves) and resolves as unverified.
   * Omitted = any path on the host (the CIMD fetch still requires `client_id` to equal the URL).
   */
  cimdPath?: RegExp;
  displayName: string;
  profile: SurfaceProfileName;
  /**
   * How a missing-scope failure is surfaced. Claude only starts sign-in on HTTP 401/403 and ignores
   * challenges in a 200 [A7]; ChatGPT shows its linking UI from `_meta["mcp/www_authenticate"]` on a
   * tool error [O5]. Invalid/expired tokens are always a transport-level 401 for every host.
   */
  scopeChallenge: AuthChallengeStyle;
}

const CLAUDE_CIMD_PATH = /^\/oauth\/[A-Za-z0-9_-]+(?:\.json)?$/;

export const KNOWN_HOSTS: Record<string, KnownHost> = {
  // OpenAI documents exactly two CIMD forms: /oauth/client.json and /oauth/{callback_id}/client.json [O5].
  "chatgpt.com": { hostKey: "chatgpt", displayName: "ChatGPT", profile: "teen_safe_directory", scopeChallenge: "tool_meta", cimdPath: /^\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/ },
  // Claude's CIMD documents live directly under /oauth/ (audit plugin-prototypes-24: any path, such as
  // /public/artifacts/..., is user content Anthropic serves, not its client). Confirm the exact
  // document names with Anthropic before launch and narrow this further.
  "claude.ai": { hostKey: "claude", displayName: "Claude", profile: "general_assistant", scopeChallenge: "http", cimdPath: CLAUDE_CIMD_PATH },
  "claude.com": { hostKey: "claude", displayName: "Claude", profile: "general_assistant", scopeChallenge: "http", cimdPath: CLAUDE_CIMD_PATH },
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
  let known: KnownHost | undefined;
  if (/^https:\/\//i.test(clientId)) {
    // CIMD: the URL host decides, and only on the paths that host publishes.
    try {
      const u = new URL(clientId);
      const k = KNOWN_HOSTS[u.hostname];
      if (k && !u.port && !u.username && !u.password && !u.search && !u.hash && (!k.cimdPath || k.cimdPath.test(u.pathname))) known = k;
    } catch { known = undefined; }
  } else {
    // DCR / pre-registered: every registered redirect must be an exact known redirect of ONE host key
    // (Claude legitimately registers both claude.ai and claude.com callbacks).
    const keys = new Set(registeredRedirects.map((r) => { const h = knownRedirectHost(r); return h ? KNOWN_HOSTS[h]!.hostKey : null; }));
    if (keys.size === 1 && !keys.has(null)) {
      const h = knownRedirectHost(registeredRedirects[0]!)!;
      known = KNOWN_HOSTS[h];
    }
  }
  if (!known) return { clientId, trustTier: "unverified", ...UNKNOWN };
  const { cimdPath: _ignored, ...rest } = known;
  return { clientId, trustTier: "verified", ...rest };
}
