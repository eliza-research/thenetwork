// The remote MCP server and its OAuth 2.1 authorization server, as one fetch handler that the
// service mounts next to the platform's /api/*. Each site's Worker forwards /mcp, /oauth/* and
// /.well-known/oauth-* to the shared backend, so every site is its own issuer and resource:
//   https://slop.date/mcp          the MCP endpoint (resource) for slop; clients registered here are bound to slop
//   https://ntwrk.love/mcp/openai  the same server for the public OpenAI plugin (slop is hidden)
// Spec: MCP 2026-07-28 (Streamable HTTP, stateless, per-request _meta; initialize kept for 2025-03-26
// to 2025-11-25 clients), OAuth 2.1 with PKCE S256, RFC 7591 (registration), RFC 8414 and RFC 9728
// (metadata), RFC 8707 (resource), RFC 9207 (iss), RFC 7009 (revocation).
import { devShortcutsAllowed, ipBucket, type Env } from "@thenetwork/platform";
import { verifyProxyHeaders } from "@thenetwork/platform/src/proxy.ts";
import { readCappedText } from "@thenetwork/platform/src/body.ts";
import { defaultApps, defaultHostMap, type McpApp, type McpAppId, type Surface } from "./apps.ts";
import type { AssistantKind, PlatformHooks, SignedIn } from "./hooks.ts";
import { codePage, consentPage, consentsPage, messagePage, phonePage } from "./pages.ts";
import { MemoryOAuthStore, type AuthCode, type ClientAuthMethod, type Grant, type OAuthClient, type OAuthStore, type Scope, SCOPES, type Token } from "./store.ts";
import { callTool, checkArgs, INSTRUCTIONS, TOOL_NAMES, TOOL_SCOPE, type ToolName, toolDefs } from "./tools.ts";
import { cookieValue, isLoopbackHost, json, pkceS256, randomId, randomToken, readForm, readJson, safeEqual, sha256hex, validChallenge, validVerifier } from "./util.ts";

export const LATEST_PROTOCOL = "2026-07-28";
export const MODERN_PROTOCOLS = ["2026-07-28"] as const;
export const LEGACY_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPS = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO = { name: "the-network", title: "The Network", version: "1.0.0" };


/** Redirect hosts of OpenAI clients (ChatGPT, Codex). A client that returns there is on the OpenAI surface. */
export const OPENAI_REDIRECT_HOSTS = ["chatgpt.com", "chat.openai.com", "platform.openai.com", "openai.com"];

export interface McpHandlerOptions {
  platform: PlatformHooks;
  apps?: Record<McpAppId, McpApp>;
  store?: OAuthStore;
  /** The issuer (and site origin) of an app. Default https://<domain>. http is allowed for loopback hosts only. */
  issuer?: string | ((app: McpApp) => string);
  hostMap?: Record<string, McpAppId>;
  /** The surface of /mcp (default "full"). /mcp/openai is always the OpenAI surface. */
  surface?: Surface;
  now?: () => number;
  env?: Env;
  /**
   * PLATFORM_PROXY_SECRET: the site Workers sign the visitor IP and the site host with it
   * (packages/platform/src/proxy.ts). Only a valid signature makes the backend trust them.
   */
  proxySecret?: string;
  /** Dev site proxy only (PLATFORM_ENV=dev): trust X-Forwarded-Host without a secret. */
  trustForwardedHost?: boolean;
  /** The one header that holds the client IP when no proxy secret is used (for example cf-connecting-ip). */
  trustedIpHeader?: string;
  /** More browser origins that may call /mcp (the app's own site origin is always allowed). */
  allowedOrigins?: string[];
  /** Turnstile on the code page. `app` lets the verifier check the token's hostname against that site's hosts. */
  turnstile?: { siteKey: string; verify(token: string | undefined, ip: string, app?: McpAppId): Promise<boolean> };
  /** OAuth Client ID Metadata Documents: the fetch used to read a client's https client_id. Without it, CIMD is off. */
  cimdFetch?: typeof fetch;
  ttl?: Partial<typeof TTL>;
  limits?: Partial<typeof LIMITS>;
  /** The minimum time of the "text me a code" answer, so a known and an unknown number look the same (default 700 ms). */
  minOtpStartMs?: number;
  log?: (s: string) => void;
}

export const TTL = {
  accessMs: 15 * 60_000,
  refreshMs: 30 * 24 * 3_600_000,
  /** A consent lasts at most this long; then the person signs in again. */
  grantMs: 90 * 24 * 3_600_000,
  codeMs: 5 * 60_000,
  requestMs: 15 * 60_000,
};
export const LIMITS = {
  registerPerIpHour: 20,
  authorizePerIpHour: 60,
  tokenPerIpMinute: 30,
  mcpPerIpMinute: 120,
  statusPerGrantMinute: 30,
};

export interface McpHandler {
  /** The answer for an MCP or OAuth path, or undefined for any other path. Pass the Bun server for the socket address. */
  fetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response | undefined>;
  store: OAuthStore;
  /** Revoke every consent of a phone (one app, or all). Call it when the person leaves an app or deletes everything. */
  /**
   * Revoke every grant of a phone (of one app, or of all). With `forget`, the grants and sign-in requests
   * are then deleted, so nothing keeps the phone next to the app (the person left or deleted everything).
   */
  revokeAllFor(e164: string, app?: McpAppId, o?: { forget?: boolean }): Promise<number>;
}

interface Ctx { app: McpApp; issuer: string; ip: string; req: Request; url: URL }
interface Authed { token: Token; grant: Grant; client: OAuthClient }

/** submit_profile calls one grant may make in a day. */
const PROFILES_PER_GRANT_DAY = 5;

const OWNED = (p: string) =>
  p === "/mcp" || p === "/mcp/openai" || p.startsWith("/oauth/") ||
  p.startsWith("/.well-known/oauth-authorization-server") || p.startsWith("/.well-known/oauth-protected-resource");

const rpcError = (id: unknown, code: number, message: string, data?: unknown) =>
  ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

/** Mcp-Name may carry =?base64?...?= (2026-07-28 Value Encoding). */
function decodeHeaderValue(v: string | null): string | null {
  if (v === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return Buffer.from(m[1]!, "base64").toString("utf8"); } catch { return null; }
}

function parseScopes(s: string | null | undefined): Scope[] | undefined {
  if (s === null || s === undefined || s.trim() === "") return [...SCOPES];
  const parts = [...new Set(s.trim().split(/\s+/))];
  return parts.every(p => (SCOPES as readonly string[]).includes(p)) ? (parts as Scope[]) : undefined;
}

/** RFC 7591 redirect URI rules: absolute, no fragment, no userinfo, https; http only for a loopback host. */
export function redirectUriAllowed(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 512 || raw.includes("*")) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || raw.includes("#") || u.username || u.password) return false;
  if (u.protocol === "https:") return !!u.hostname;
  return u.protocol === "http:" && isLoopbackHost(u.hostname);
}

const isOpenAiHost = (host: string) => OPENAI_REDIRECT_HOSTS.some(h => host === h || host.endsWith(`.${h}`));

/** Redirect hosts per assistant, for the inbox's surface signals (packages/notify). Unknown clients are "web". */
export const ASSISTANT_REDIRECT_HOSTS: Record<Exclude<AssistantKind, "web">, string[]> = {
  chatgpt: OPENAI_REDIRECT_HOSTS,
  claude: ["claude.ai", "claude.com", "anthropic.com"],
  grok: ["grok.com", "x.ai"],
};

/** Which assistant an OAuth client is, from its redirect URIs. */
export function assistantOf(client: Pick<OAuthClient, "redirectUris" | "surface">): AssistantKind {
  if (client.surface === "openai") return "chatgpt";
  const hosts = client.redirectUris.flatMap(u => { try { return [new URL(u).hostname]; } catch { return []; } });
  for (const [kind, list] of Object.entries(ASSISTANT_REDIRECT_HOSTS) as [Exclude<AssistantKind, "web">, string[]][])
    if (hosts.some(h => list.some(d => h === d || h.endsWith(`.${d}`)))) return kind;
  return "web";
}

export function createMcpHandler(o: McpHandlerOptions): McpHandler {
  const env = o.env ?? process.env;
  const apps = o.apps ?? defaultApps();
  const store = o.store ?? new MemoryOAuthStore();
  const now = o.now ?? Date.now;
  const ttl = { ...TTL, ...o.ttl };
  const lim = { ...LIMITS, ...o.limits };
  const log = o.log ?? (s => console.log(s));
  /** Tell the inbox an assistant was connected or disconnected for the grant's person (never blocks OAuth). */
  async function linked(grant: Grant | undefined, active: boolean) {
    if (!grant?.personId || !o.platform.assistantLinked) return;
    const client = await store.getClient(grant.clientId);
    await o.platform.assistantLinked(grant.personId, client ? assistantOf(client) : "web", active).catch(e => log(`[mcp] assistant ${active ? "link" : "unlink"} not recorded: ${(e as Error).message}`));
  }
  /** Every revocation goes through here, so the inbox always hears about it. */
  async function revokeGrant(id: string, at: number) {
    const ok = await store.revokeGrant(id, at);
    if (ok) await linked(await store.getGrant(id), false);
    return ok;
  }
  const hostMap = o.hostMap ?? defaultHostMap(apps);
  const dev = devShortcutsAllowed(env);
  if (o.trustForwardedHost && !dev) throw new Error("trustForwardedHost is for the dev site proxy only (PLATFORM_ENV=dev)");
  const issuerOf = (a: McpApp) => (typeof o.issuer === "function" ? o.issuer(a) : o.issuer ?? `https://${a.domain}`).replace(/\/+$/, "");
  for (const a of Object.values(apps)) {
    const u = new URL(issuerOf(a));
    if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost(u.hostname))) throw new Error(`the issuer for ${a.id} must be https (http only on a loopback host)`);
    if (u.pathname !== "/" || u.search || u.hash) throw new Error(`the issuer for ${a.id} must be an origin with no path`);
  }
  const secureCookies = (a: McpApp) => issuerOf(a).startsWith("https:");
  const browserCookie = (a: McpApp) => (secureCookies(a) ? "__Host-mcp_auth" : "mcp_auth");
  let lastSweep = 0;

  const resourceFor = (issuer: string, surface: Surface) => `${issuer}${surface === "openai" ? "/mcp/openai" : "/mcp"}`;
  const prmUrl = (resource: string) => { const u = new URL(resource); return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`; };
  /** RFC 8707: the canonical form of a resource parameter, or undefined when it is not this site's MCP endpoint. */
  function canonicalResource(raw: string, issuer: string): string | undefined {
    let u: URL;
    try { u = new URL(raw); } catch { return undefined; }
    if (u.hash || u.search) return undefined;
    const c = `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
    return c === resourceFor(issuer, "full") || c === resourceFor(issuer, "openai") ? c : undefined;
  }
  const challenge = (resource: string, extra: Record<string, string> = {}) =>
    "Bearer " + Object.entries({ resource_metadata: prmUrl(resource), scope: "membership:read", ...extra }).map(([k, v]) => `${k}="${v.replace(/"/g, "'")}"`).join(", ");

  async function limited(bucket: string, max: number, windowMs: number): Promise<boolean> {
    return (await store.hit(bucket, windowMs, now())) > max;
  }
  const tooMany = (retry: number) => json(429, { error: "rate_limited" }, { "retry-after": String(retry) });

  async function resolve(req: Request, peer?: string): Promise<{ app: McpApp; ip: string } | undefined> {
    const signed = await verifyProxyHeaders(req, o.proxySecret, Math.floor(now() / 1000));
    const fwd = signed?.host ?? (o.trustForwardedHost ? req.headers.get("x-forwarded-host") : null);
    const host = (fwd ?? req.headers.get("host") ?? new URL(req.url).host).trim().toLowerCase().replace(/\.$/, "");
    const id = hostMap[host];
    if (!id || !apps[id]) return undefined;
    const ip = (signed?.ip ?? (o.trustedIpHeader ? req.headers.get(o.trustedIpHeader)?.split(",")[0] : undefined))?.trim() || peer || "unknown";
    return { app: apps[id], ip };
  }

  /** A browser Origin, when present, must be the site itself (or a configured origin). */
  function originOk(c: Ctx, extra: string[] = []): boolean {
    const origin = c.req.headers.get("origin");
    if (!origin) return true;
    if (origin === c.issuer || extra.includes(origin)) return true;
    // The site's own hosts (its www name and its Pages name) are this site too.
    try { const h = new URL(origin).host; if (origin.startsWith("https://") && hostMap[h] === c.app.id) return true; } catch { /* not a URL */ }
    // The pages send Referrer-Policy: no-referrer, so a browser's own form POST carries "Origin: null".
    // Sec-Fetch-Site is set by the browser only (a page cannot forge it): same-origin is this site.
    return origin === "null" && c.req.headers.get("sec-fetch-site") === "same-origin";
  }

  // ---------------------------------------------------------------- clients

  async function getClient(id: string, c: Ctx): Promise<OAuthClient | undefined> {
    if (id.length > 512) return undefined;
    const known = await store.getClient(id);
    if (known && (known.kind === "dcr" || now() - known.createdAt < 24 * 3_600_000)) return known;
    if (!o.cimdFetch || !id.startsWith("https://")) return known;
    return cimdClient(id, c);
  }

  /** Client ID Metadata Document: the client_id is an https URL that serves the client's metadata. */
  async function cimdClient(id: string, c: Ctx): Promise<OAuthClient | undefined> {
    let u: URL;
    try { u = new URL(id); } catch { return undefined; }
    // No IP literals, no loopback, a path is required (draft-ietf-oauth-client-id-metadata-document 3).
    if (u.protocol !== "https:" || u.pathname === "/" || u.hash || u.username || /^[\d.]+$|^\[/.test(u.hostname) || isLoopbackHost(u.hostname)) return undefined;
    let doc: Record<string, unknown> | undefined;
    try {
      const res = await o.cimdFetch!(id, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
      const text = res.ok ? await res.text() : "";
      if (text.length <= 5_120) doc = JSON.parse(text);
    } catch { return undefined; }
    if (!doc || doc.client_id !== id) return undefined;
    const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : [];
    const method = doc.token_endpoint_auth_method ?? "none";
    if (!uris.length || uris.length > 10 || !uris.every(redirectUriAllowed) || method !== "none") return undefined;
    const surface: Surface = uris.some(r => isOpenAiHost(new URL(r).hostname)) || isOpenAiHost(u.hostname) ? "openai" : "full";
    if (surface === "openai" && !c.app.openai) return undefined;
    const client: OAuthClient = {
      id, secretHash: null, name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : u.hostname,
      redirectUris: uris, authMethod: "none", app: c.app.id, surface, kind: "cimd", createdAt: now(),
    };
    await store.putClient(client);
    return client;
  }

  async function register(c: Ctx): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (await limited(`reg:ip:${sha256hex(ipBucket(c.ip))}`, lim.registerPerIpHour, 3_600_000)) return tooMany(3600);
    const b = await readJson(c.req);
    const bad = (d: string, error = "invalid_client_metadata") => json(400, { error, error_description: d });
    if (!b) return bad("The body must be a JSON object.");
    const uris = b.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) return bad("redirect_uris must list 1 to 5 URIs.", "invalid_redirect_uri");
    if (!uris.every(redirectUriAllowed)) return bad("Each redirect URI must be https (http only for localhost), with no fragment and no wildcard.", "invalid_redirect_uri");
    const method = (b.token_endpoint_auth_method ?? "client_secret_basic") as ClientAuthMethod;
    if (!["none", "client_secret_basic", "client_secret_post"].includes(method)) return bad("token_endpoint_auth_method must be none, client_secret_basic or client_secret_post.");
    const grants = (b.grant_types ?? ["authorization_code", "refresh_token"]) as unknown[];
    if (!Array.isArray(grants) || !grants.every(g => g === "authorization_code" || g === "refresh_token")) return bad("grant_types may be authorization_code and refresh_token only.");
    const responses = (b.response_types ?? ["code"]) as unknown[];
    if (!Array.isArray(responses) || !responses.every(r => r === "code")) return bad("response_types may be code only.");
    if (b.scope !== undefined && (typeof b.scope !== "string" || !parseScopes(b.scope))) return bad("scope may be apps:read, membership:read and profile:write only.");
    const name = typeof b.client_name === "string" ? b.client_name.replace(/[\u0000-\u001f]/g, "").slice(0, 100) : null;
    const surface: Surface = (uris as string[]).some(r => isOpenAiHost(new URL(r).hostname)) ? "openai" : "full";
    if (surface === "openai" && !c.app.openai) return bad("This app is not available for this client.");
    const secret = method === "none" ? null : randomToken("ntws_");
    const client: OAuthClient = { id: `mcp_${randomId()}`, secretHash: secret ? sha256hex(secret) : null, name, redirectUris: uris as string[], authMethod: method, app: c.app.id, surface, kind: "dcr", createdAt: now() };
    await store.putClient(client);
    await store.audit({ at: now(), kind: "client_registered", clientId: client.id, grantId: null, app: c.app.id, detail: `${method} ${surface}` });
    return json(201, {
      client_id: client.id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(client.createdAt / 1000), client_name: name ?? undefined, redirect_uris: client.redirectUris,
      token_endpoint_auth_method: method, grant_types: grants, response_types: ["code"], scope: (parseScopes(b.scope as string | undefined) ?? SCOPES).join(" "),
    });
  }

  /** Client authentication at the token and revocation endpoints. */
  async function authClient(c: Ctx, form: URLSearchParams): Promise<OAuthClient | Response> {
    const fail = () => json(401, { error: "invalid_client" }, { "www-authenticate": 'Basic realm="oauth"' });
    let id = form.get("client_id"), secret = form.get("client_secret"), basic = false;
    const auth = c.req.headers.get("authorization");
    if (auth?.startsWith("Basic ")) {
      let dec = "";
      try { dec = Buffer.from(auth.slice(6), "base64").toString("utf8"); } catch { return fail(); }
      const i = dec.indexOf(":");
      if (i < 0) return fail();
      const [bid, bsec] = [decodeURIComponent(dec.slice(0, i)), decodeURIComponent(dec.slice(i + 1))];
      if (id && id !== bid) return fail();
      if (secret) return fail(); // one method per request
      id = bid; secret = bsec; basic = true;
    }
    if (!id) return fail();
    const client = await getClient(id, c);
    if (!client || client.app !== c.app.id) return fail();
    if (client.authMethod === "none") return secret ? fail() : client;
    if (!secret || !client.secretHash || !safeEqual(sha256hex(secret), client.secretHash)) return fail();
    if ((client.authMethod === "client_secret_basic") !== basic) return fail();
    return client;
  }

  // ---------------------------------------------------------------- authorize (the person's pages)

  function redirectTo(base: string, params: Record<string, string | null>, status = 302, headers: Record<string, string> = {}): Response {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
    return new Response(null, { status, headers: { location: u.toString(), "cache-control": "no-store", ...headers } });
  }

  async function authorizeStart(c: Ctx): Promise<Response> {
    const q = c.url.searchParams;
    const keys = [...q.keys()];
    if (new Set(keys).size !== keys.length) return messagePage(c.app, "This link does not work", "The sign-in link from the assistant is not valid. Go back to the assistant and try again.");
    if (await limited(`authz:ip:${sha256hex(ipBucket(c.ip))}`, lim.authorizePerIpHour, 3_600_000)) return messagePage(c.app, "Too many tries", "Please wait an hour and try again.", 429);
    const client = await getClient(q.get("client_id") ?? "", c);
    // An unknown client or a redirect URI it did not register: show an error, never redirect (open redirector).
    if (!client || client.app !== c.app.id) return messagePage(c.app, "This link does not work", "The assistant is not registered on this site. Go back to the assistant and try again.");
    const asked = q.get("redirect_uri");
    const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : null);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) return messagePage(c.app, "This link does not work", "The assistant asked to return to an address it did not register.");
    const state = q.get("state");
    // A malformed request is an error page here, never a redirect (RFC 9700 4.11.2): open registration
    // would otherwise let anyone bounce a person from this site to any https page with no click.
    // Only the person's own "Deny" on the consent page redirects back with an error.
    const fail = (_error: string, description: string) => messagePage(c.app, "This link does not work", `The assistant sent a sign-in link this site cannot use (${description}). Go back to the assistant and try again.`, 400);
    if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challengeIn = q.get("code_challenge");
    if (q.get("code_challenge_method") !== "S256" || !validChallenge(challengeIn)) return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    const scopes = parseScopes(q.get("scope"));
    if (!scopes) return fail("invalid_scope", "scope may be apps:read, membership:read and profile:write only");
    const rawResource = q.get("resource");
    const resource = rawResource ? canonicalResource(rawResource, c.issuer) : resourceFor(c.issuer, client.surface);
    if (!resource) return fail("invalid_target", "resource must be this site's MCP endpoint");
    if (client.surface === "openai" && resource !== resourceFor(c.issuer, "openai")) return fail("invalid_target", "this client must use the /mcp/openai endpoint");
    // login_hint, phone or any other person data in the URL is never read: the person types it on our page.
    const browser = randomToken();
    const r = {
      id: randomId(), browserHash: sha256hex(browser), clientId: client.id, app: c.app.id, redirectUri, state,
      codeChallenge: challengeIn, scopes, resource, e164: null, personId: null, step: "phone" as const, createdAt: now(), expiresAt: now() + ttl.requestMs,
    };
    await store.putAuthRequest(r);
    const cookie = `${browserCookie(c.app)}=${browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl.requestMs / 1000)}${secureCookies(c.app) ? "; Secure" : ""}`;
    const signedIn = o.platform.session ? await o.platform.session(c.app.id, c.req) : undefined;
    const redirectHost = new URL(redirectUri).host;
    const cookieOut = [cookie];
    let res: Response;
    if (signedIn) {
      if (signedIn.setCookie) cookieOut.push(signedIn.setCookie);
      await store.updateAuthRequest(r.id, { e164: signedIn.e164, personId: signedIn.personId, step: "consent" });
      res = consentPage(c.app, r.id, client.name, redirectHost, new URL(redirectUri).origin, scopes);
    } else {
      res = phonePage(c.app, r.id, client.name, redirectHost, { turnstileSiteKey: o.turnstile?.siteKey });
    }
    for (const c2 of cookieOut) res.headers.append("set-cookie", c2);
    return res;
  }

  /** The live request of this browser (rid in the form, the cookie from the start). */
  async function liveRequest(c: Ctx, form: URLSearchParams) {
    const rid = form.get("rid") ?? "";
    const r = rid ? await store.getAuthRequest(rid) : undefined;
    const browser = cookieValue(c.req.headers.get("cookie"), browserCookie(c.app));
    if (!r || r.app !== c.app.id || r.expiresAt <= now() || !browser || !safeEqual(sha256hex(browser), r.browserHash)) return undefined;
    const client = await store.getClient(r.clientId);
    return client ? { r, client } : undefined;
  }

  async function authorizeStep(c: Ctx, step: "phone" | "code" | "consent"): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (!originOk(c)) return messagePage(c.app, "Not allowed", "This form must be sent from this site.", 403);
    const form = await readForm(c.req);
    const live = form && (await liveRequest(c, form));
    if (!form || !live) return messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.");
    const { r, client } = live;
    const redirectHost = new URL(r.redirectUri).host;
    const clearCookie = `${browserCookie(c.app)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(c.app) ? "; Secure" : ""}`;

    if (step === "phone") {
      if (r.step === "consent") return messagePage(c.app, "Already signed in", "Go back to the previous page to finish.");
      const t0 = performance.now();
      const pad = async () => { const left = (o.minOtpStartMs ?? 700) - (performance.now() - t0); if (left > 0) await Bun.sleep(left); };
      if (o.turnstile && !(await o.turnstile.verify(form.get("cf-turnstile-response") ?? undefined, c.ip, c.app.id))) {
        return phonePage(c.app, r.id, client.name, redirectHost, { error: "Please complete the check and try again.", turnstileSiteKey: o.turnstile.siteKey });
      }
      const e164 = o.platform.normalizePhone(form.get("phone"));
      if (!e164) return phonePage(c.app, r.id, client.name, redirectHost, { error: "Enter a US or Canada phone number.", turnstileSiteKey: o.turnstile?.siteKey });
      const sent = await o.platform.startOtp(c.app.id, e164, c.ip);
      await pad();
      if (!sent.ok) {
        const text = sent.error === "rate_limited" ? "Too many codes were asked for. Please wait and try again." : "Sign-in is not available for this app right now.";
        return phonePage(c.app, r.id, client.name, redirectHost, { error: text, turnstileSiteKey: o.turnstile?.siteKey });
      }
      await store.updateAuthRequest(r.id, { e164, step: "code" });
      return codePage(c.app, r.id, e164.slice(-4));
    }

    if (step === "code") {
      if (r.step !== "code" || !r.e164) return messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.");
      const code = (form.get("code") ?? "").replace(/\s/g, "");
      if (!(await o.platform.verifyOtp(c.app.id, r.e164, code, c.ip))) return codePage(c.app, r.id, r.e164.slice(-4), { error: "That code did not work. Check the newest text and try again." });
      const who = await o.platform.login(r.e164);
      if (who === "held") {
        await store.deleteAuthRequest(r.id);
        const res = messagePage(c.app, "We need to check this number", "We need to check this number before it can be used here. Please try again later, or email us for help.", 403);
        res.headers.append("set-cookie", clearCookie);
        return res;
      }
      await store.updateAuthRequest(r.id, { personId: who.personId, step: "consent" });
      const res = consentPage(c.app, r.id, client.name, redirectHost, new URL(r.redirectUri).origin, r.scopes);
      const site = o.platform.createSession ? await o.platform.createSession(c.app.id, { e164: r.e164, personId: who.personId }) : undefined;
      if (site) res.headers.append("set-cookie", site);
      return res;
    }

    // consent
    const decision = form.get("decision");
    if (decision !== "approve" || r.step !== "consent" || !r.e164) {
      await store.deleteAuthRequest(r.id);
      await store.audit({ at: now(), kind: "consent_denied", clientId: client.id, grantId: null, app: c.app.id, detail: null });
      return redirectTo(r.redirectUri, { error: "access_denied", error_description: "The person did not allow access", state: r.state, iss: c.issuer }, 303, { "set-cookie": clearCookie });
    }
    const at = now();
    const grant: Grant = { id: `grant_${randomId()}`, clientId: client.id, app: c.app.id, phoneKey: o.platform.phoneKey(r.e164), personId: r.personId, scopes: r.scopes, resource: r.resource, createdAt: at, expiresAt: at + ttl.grantMs, revokedAt: null };
    await store.putGrant(grant);
    await linked(grant, true);
    const code = randomToken("ntwc_");
    const ac: AuthCode = { hash: sha256hex(code), grantId: grant.id, clientId: client.id, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, resource: r.resource, scopes: r.scopes, createdAt: at, expiresAt: at + ttl.codeMs, usedAt: null };
    await store.putCode(ac);
    await store.deleteAuthRequest(r.id);
    await store.audit({ at, kind: "consent_granted", clientId: client.id, grantId: grant.id, app: c.app.id, detail: r.scopes.join(" ") });
    await store.audit({ at, kind: "code_issued", clientId: client.id, grantId: grant.id, app: c.app.id, detail: null });
    return redirectTo(r.redirectUri, { code, state: r.state, iss: c.issuer }, 303, { "set-cookie": clearCookie });
  }

  // ---------------------------------------------------------------- token, revoke

  async function issuePair(client: OAuthClient, grant: Grant, scopes: Scope[], resource: string) {
    const at = now();
    const access = randomToken("ntwa_"), refresh = randomToken("ntwr_");
    const base = { grantId: grant.id, clientId: client.id, app: grant.app, resource, scopes, createdAt: at, revokedAt: null, rotatedAt: null };
    await store.putToken({ ...base, hash: sha256hex(access), kind: "access", expiresAt: Math.min(at + ttl.accessMs, grant.expiresAt) });
    await store.putToken({ ...base, hash: sha256hex(refresh), kind: "refresh", expiresAt: Math.min(at + ttl.refreshMs, grant.expiresAt) });
    return { access_token: access, token_type: "Bearer", expires_in: Math.floor(Math.min(ttl.accessMs, grant.expiresAt - at) / 1000), refresh_token: refresh, scope: scopes.join(" ") };
  }

  async function token(c: Ctx): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (await limited(`token:ip:${sha256hex(ipBucket(c.ip))}`, lim.tokenPerIpMinute, 60_000)) return tooMany(60);
    const form = await readForm(c.req);
    if (!form) return json(400, { error: "invalid_request", error_description: "Send application/x-www-form-urlencoded with each parameter once." });
    const client = await authClient(c, form);
    if (client instanceof Response) return client;
    const bad = (error: string, d?: string) => json(400, { error, ...(d ? { error_description: d } : {}) });
    const at = now();
    const grantType = form.get("grant_type");

    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const ac = code ? await store.takeCode(sha256hex(code), at) : undefined;
      if (!ac || ac.clientId !== client.id) return bad("invalid_grant");
      if (ac.usedAt !== null) {
        // OAuth 2.1 4.1.3: a second use of a code revokes what the first use issued.
        await revokeGrant(ac.grantId, at);
        await store.audit({ at, kind: "code_replay", clientId: client.id, grantId: ac.grantId, app: c.app.id, detail: "grant revoked" });
        return bad("invalid_grant");
      }
      if (ac.expiresAt <= at) return bad("invalid_grant", "The code expired.");
      if (form.get("redirect_uri") !== ac.redirectUri) return bad("invalid_grant", "redirect_uri does not match.");
      const verifier = form.get("code_verifier");
      if (!validVerifier(verifier) || !safeEqual(pkceS256(verifier), ac.codeChallenge)) return bad("invalid_grant", "code_verifier does not match.");
      const res = form.get("resource");
      if (res && canonicalResource(res, c.issuer) !== ac.resource) return bad("invalid_target");
      const grant = await store.getGrant(ac.grantId);
      if (!grant || grant.revokedAt !== null || grant.expiresAt <= at) return bad("invalid_grant");
      const pair = await issuePair(client, grant, ac.scopes, ac.resource);
      await store.audit({ at, kind: "token_issued", clientId: client.id, grantId: grant.id, app: c.app.id, detail: ac.scopes.join(" ") });
      return json(200, pair);
    }

    if (grantType === "refresh_token") {
      const raw = form.get("refresh_token") ?? "";
      const t = raw ? await store.getToken(sha256hex(raw)) : undefined;
      if (!t || t.kind !== "refresh" || t.clientId !== client.id || t.revokedAt !== null || t.expiresAt <= at) return bad("invalid_grant");
      const grant = await store.getGrant(t.grantId);
      if (!grant || grant.revokedAt !== null || grant.expiresAt <= at) return bad("invalid_grant");
      const asked = form.get("scope") === null ? t.scopes : parseScopes(form.get("scope"));
      if (!asked || !asked.every(s => t.scopes.includes(s))) return bad("invalid_scope");
      const res = form.get("resource");
      if (res && canonicalResource(res, c.issuer) !== t.resource) return bad("invalid_target");
      if (t.rotatedAt !== null || !(await store.rotateRefresh(t.hash, at))) {
        // A refresh token used twice: someone else has a copy. End the whole grant.
        await revokeGrant(t.grantId, at);
        await store.audit({ at, kind: "refresh_replay", clientId: client.id, grantId: t.grantId, app: c.app.id, detail: "grant revoked" });
        return bad("invalid_grant");
      }
      const pair = await issuePair(client, grant, asked, t.resource);
      await store.audit({ at, kind: "token_refreshed", clientId: client.id, grantId: grant.id, app: c.app.id, detail: asked.join(" ") });
      return json(200, pair);
    }
    return bad("unsupported_grant_type");
  }

  async function revoke(c: Ctx): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (await limited(`token:ip:${sha256hex(ipBucket(c.ip))}`, lim.tokenPerIpMinute, 60_000)) return tooMany(60);
    const form = await readForm(c.req);
    if (!form) return json(400, { error: "invalid_request" });
    const client = await authClient(c, form);
    if (client instanceof Response) return client;
    const raw = form.get("token") ?? "";
    const t = raw ? await store.getToken(sha256hex(raw)) : undefined;
    // RFC 7009 2.2: the same 200 for an unknown token.
    if (t && t.clientId === client.id) {
      const at = now();
      if (t.kind === "refresh") await revokeGrant(t.grantId, at);
      else await store.revokeToken(t.hash, at);
      await store.audit({ at, kind: "token_revoked", clientId: client.id, grantId: t.grantId, app: c.app.id, detail: t.kind === "refresh" ? "refresh: grant revoked" : "access" });
    }
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }

  // ---------------------------------------------------------------- the person's consent records

  async function consents(c: Ctx, revokeOne: boolean): Promise<Response> {
    const who: SignedIn | undefined = o.platform.session ? await o.platform.session(c.app.id, c.req) : undefined;
    if (!who) return messagePage(c.app, "Sign in first", `Sign in at ${c.app.links.settings}, then open this page again.`, 401);
    let notice: string | undefined;
    if (revokeOne) {
      if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
      // A cross-site form cannot remove access for the person: the Origin must be this site.
      if (!originOk(c) || (c.req.headers.get("origin") === null && c.req.headers.get("sec-fetch-site") !== "same-origin")) return messagePage(c.app, "Not allowed", "This form must be sent from this site.", 403);
      const form = await readForm(c.req);
      const g = form?.get("grant") ? await store.getGrant(form.get("grant")!) : undefined;
      if (g && g.phoneKey === o.platform.phoneKey(who.e164) && g.app === c.app.id && (await revokeGrant(g.id, now()))) {
        await store.audit({ at: now(), kind: "consent_revoked", clientId: g.clientId, grantId: g.id, app: c.app.id, detail: "by the person" });
        notice = "Access removed.";
      }
    }
    const grants = await store.grantsFor(o.platform.phoneKey(who.e164), c.app.id, now());
    const named = await Promise.all(grants.map(async g => ({ ...g, clientName: (await store.getClient(g.clientId))?.name ?? null })));
    const page = consentsPage(c.app, named, ms => new Date(ms).toISOString().slice(0, 10), notice);
    if (who.setCookie) page.headers.append("set-cookie", who.setCookie);
    return page;
  }

  // ---------------------------------------------------------------- metadata

  function asMetadata(c: Ctx) {
    const i = c.issuer;
    return {
      issuer: i,
      authorization_endpoint: `${i}/oauth/authorize`,
      token_endpoint: `${i}/oauth/token`,
      registration_endpoint: `${i}/oauth/register`,
      revocation_endpoint: `${i}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      revocation_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      scopes_supported: [...SCOPES],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: !!o.cimdFetch,
      service_documentation: `${i}/SKILL.md`,
    };
  }
  function prMetadata(c: Ctx, surface: Surface) {
    return {
      resource: resourceFor(c.issuer, surface),
      authorization_servers: [c.issuer],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: `${c.app.name} (powered by The Network)`,
      resource_documentation: `${c.issuer}/SKILL.md`,
    };
  }

  // ---------------------------------------------------------------- the MCP endpoint

  async function bearer(c: Ctx, resource: string): Promise<Authed | null | "invalid"> {
    const h = c.req.headers.get("authorization");
    if (!h) return null;
    const m = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(h);
    if (!m) return "invalid";
    const at = now();
    const t = await store.getToken(sha256hex(m[1]!));
    // RFC 8707: a token minted for another resource (another site, or the other surface) is refused.
    if (!t || t.kind !== "access" || t.revokedAt !== null || t.expiresAt <= at || t.resource !== resource || t.app !== c.app.id) return "invalid";
    const [grant, client] = await Promise.all([store.getGrant(t.grantId), store.getClient(t.clientId)]);
    if (!grant || grant.revokedAt !== null || grant.expiresAt <= at || !client) return "invalid";
    return { token: t, grant, client };
  }

  async function mcp(c: Ctx, pathSurface: Surface): Promise<Response> {
    const resource = resourceFor(c.issuer, pathSurface);
    const cors: Record<string, string> = {};
    const origin = c.req.headers.get("origin");
    if (origin && (origin === c.issuer || o.allowedOrigins?.includes(origin))) Object.assign(cors, { "access-control-allow-origin": origin, "access-control-expose-headers": "WWW-Authenticate", vary: "Origin" });
    if (!originOk(c, o.allowedOrigins)) return json(403, rpcError(null, -32600, "Origin not allowed"));
    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id", "access-control-max-age": "600" } });
    }
    // 2026-07-28: no GET stream and no sessions. Legacy session ids are ignored, never minted.
    if (c.req.method !== "POST") return json(405, rpcError(null, -32600, "Method not allowed. Use POST."), { allow: "POST, OPTIONS", ...cors });
    const out = (status: number, body: unknown, headers: Record<string, string> = {}) => json(status, body, { ...cors, ...headers });
    if (await limited(`mcp:ip:${sha256hex(ipBucket(c.ip))}`, lim.mcpPerIpMinute, 60_000)) return out(429, rpcError(null, -31029, "Too many requests"), { "retry-after": "60" });

    const auth = await bearer(c, resource);
    if (auth === "invalid") return out(401, rpcError(null, -31401, "The access token is not valid here"), { "www-authenticate": challenge(resource, { error: "invalid_token", error_description: "The access token is invalid, expired or for another resource" }) });
    const surface: Surface = pathSurface === "openai" || auth?.client.surface === "openai" ? "openai" : "full";

    const text = await readCappedText(c.req, 65_536);
    if (text === "too_large") return out(413, rpcError(null, -32600, "Request too large"));
    let msg: any;
    try { msg = JSON.parse(text); } catch { return out(400, rpcError(null, -32700, "Parse error")); }
    if (Array.isArray(msg)) return out(400, rpcError(null, -32600, "Batches are not supported"));
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return out(400, rpcError(msg?.id, -32600, "Invalid request"));
    const isNotification = !("id" in msg);
    const id = msg.id;
    if (!isNotification && (id === null || (typeof id !== "string" && typeof id !== "number"))) return out(400, rpcError(null, -32600, "The id must be a string or a number"));
    const params = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? msg.params : {};
    const meta = params._meta && typeof params._meta === "object" ? params._meta : {};
    const headerVersion = c.req.headers.get("mcp-protocol-version");
    const modern = msg.method !== "initialize" && typeof meta[META_VERSION] === "string";

    if (modern) {
      const v = meta[META_VERSION] as string;
      if (headerVersion !== v) return out(400, rpcError(id, -32020, `Header mismatch: MCP-Protocol-Version must equal the request's protocolVersion (${v})`));
      if (!(MODERN_PROTOCOLS as readonly string[]).includes(v)) return out(400, rpcError(id, -32022, "Unsupported protocol version", { supported: [...MODERN_PROTOCOLS, ...LEGACY_PROTOCOLS], requested: v }));
      if (c.req.headers.get("mcp-method") !== msg.method) return out(400, rpcError(id, -32020, "Header mismatch: Mcp-Method must equal the request method"));
      if (["tools/call", "resources/read", "prompts/get"].includes(msg.method)) {
        const want = msg.method === "resources/read" ? params.uri : params.name;
        if (decodeHeaderValue(c.req.headers.get("mcp-name")) !== want) return out(400, rpcError(id, -32020, "Header mismatch: Mcp-Name must equal the requested name"));
      }
      if (isNotification) return new Response(null, { status: 202, headers: cors });
      if (!meta[META_CAPS] || typeof meta[META_CAPS] !== "object") return out(400, rpcError(id, -32602, `Invalid params: _meta["${META_CAPS}"] is required`));
    } else {
      if (headerVersion !== null && !(LEGACY_PROTOCOLS as readonly string[]).includes(headerVersion) && msg.method !== "initialize") {
        return out(400, rpcError(id, -32022, "Unsupported protocol version", { supported: [...MODERN_PROTOCOLS, ...LEGACY_PROTOCOLS], requested: headerVersion }));
      }
      if (isNotification) return new Response(null, { status: 202, headers: cors });
    }

    const result = (r: Record<string, unknown>) => out(200, { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...r, _meta: { ...(r._meta as object | undefined), "io.modelcontextprotocol/serverInfo": SERVER_INFO } } : r });
    const host = c.app;
    if (surface === "openai" && !host.openai) return out(404, rpcError(id, -32601, "Not available"));

    switch (msg.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (LEGACY_PROTOCOLS as readonly string[]).includes(asked) ? asked : LEGACY_PROTOCOLS[0];
        return result({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
      }
      case "server/discover":
        return result({ supportedVersions: [...MODERN_PROTOCOLS, ...LEGACY_PROTOCOLS], capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS });
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: toolDefs(apps, surface, host) });
      case "tools/call": {
        const name = params.name;
        if (!(TOOL_NAMES as readonly string[]).includes(name)) return out(200, { jsonrpc: "2.0", id, result: { ...(modern ? { resultType: "complete" } : {}), content: [{ type: "text", text: "Unknown tool." }], isError: true } });
        const tool = name as ToolName;
        const need = TOOL_SCOPE[tool];
        if (need) {
          const scopeChallenge = challenge(resource, auth ? { error: "insufficient_scope", error_description: `This tool needs ${need}` } : {});
          if (!auth || !auth.token.scopes.includes(need)) {
            // ChatGPT reads the challenge from the tool result; other clients get the HTTP status (MCP authorization, step-up).
            if (surface === "openai") return result({ content: [{ type: "text", text: "The person must sign in on the site and allow access first." }], isError: true, _meta: { "mcp/www_authenticate": [scopeChallenge] } });
            return auth
              ? out(403, rpcError(id, -31403, "Insufficient scope"), { "www-authenticate": scopeChallenge })
              : out(401, rpcError(id, -31401, "Sign-in required"), { "www-authenticate": scopeChallenge });
          }
          if (await limited(`status:grant:${auth.grant.id}`, lim.statusPerGrantMinute, 60_000)) return out(429, rpcError(id, -31029, "Too many requests"), { "retry-after": "60" });
          // A profile is a few messages a day at most (each one reaches the member's own app as a text).
          // Only a well-formed profile counts (a refused one never reaches the app).
          if (tool === "submit_profile" && checkArgs(tool, params.arguments, [], host).ok && (await limited(`profile:grant:${auth.grant.id}`, PROFILES_PER_GRANT_DAY, 86_400_000))) return out(429, rpcError(id, -31029, "Too many profiles today"), { "retry-after": "3600" });
        }
        const r = await callTool(tool, params.arguments, { apps, surface, host, hooks: o.platform, grant: auth?.grant ?? null, assistant: auth ? assistantOf(auth.client) : undefined });
        log(`[mcp] ${host.id} ${surface} ${tool} ${r.kind}${auth ? ` grant=${auth.grant.id}` : ""}`);
        if (r.kind === "invalid_grant") {
          if (auth) await revokeGrant(auth.grant.id, now());
          return out(401, rpcError(id, -31401, "The access token is not valid here"), { "www-authenticate": challenge(resource, { error: "invalid_token" }) });
        }
        if (r.kind === "error") return result({ content: [{ type: "text", text: r.message }], isError: true });
        return result({ content: [{ type: "text", text: JSON.stringify(r.data) }], structuredContent: r.data, isError: false });
      }
    }
    return modern ? out(404, rpcError(id, -32601, "Method not found")) : out(200, rpcError(id, -32601, "Method not found"));
  }

  // ---------------------------------------------------------------- routing

  async function handle(req: Request, url: URL, peer?: string): Promise<Response> {
    const r = await resolve(req, peer);
    if (!r) return json(404, { error: "unknown_app" });
    const c: Ctx = { app: r.app, issuer: issuerOf(r.app), ip: r.ip, req, url };
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const pub = { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" };
    const get = req.method === "GET" || req.method === "HEAD";
    if (req.method === "OPTIONS" && !p.startsWith("/mcp")) {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, MCP-Protocol-Version", "access-control-max-age": "600" } });
    }
    switch (p) {
      case "/.well-known/oauth-authorization-server":
        return get ? json(200, asMetadata(c), pub) : json(405, { error: "method_not_allowed" });
      case "/.well-known/oauth-protected-resource":
      case "/.well-known/oauth-protected-resource/mcp":
        return get ? json(200, prMetadata(c, "full"), pub) : json(405, { error: "method_not_allowed" });
      case "/.well-known/oauth-protected-resource/mcp/openai":
        return !c.app.openai ? json(404, { error: "not_found" }) : get ? json(200, prMetadata(c, "openai"), pub) : json(405, { error: "method_not_allowed" });
      case "/mcp":
        return mcp(c, o.surface ?? "full");
      case "/mcp/openai":
        return c.app.openai ? mcp(c, "openai") : json(404, { error: "not_found" });
      case "/oauth/register": {
        const res = await register(c);
        res.headers.set("access-control-allow-origin", "*");
        return res;
      }
      case "/oauth/authorize":
        return get ? authorizeStart(c) : json(405, { error: "method_not_allowed" });
      case "/oauth/authorize/phone":
        return authorizeStep(c, "phone");
      case "/oauth/authorize/code":
        return authorizeStep(c, "code");
      case "/oauth/authorize/consent":
        return authorizeStep(c, "consent");
      case "/oauth/token": {
        const res = await token(c);
        res.headers.set("access-control-allow-origin", "*");
        return res;
      }
      case "/oauth/revoke": {
        const res = await revoke(c);
        res.headers.set("access-control-allow-origin", "*");
        return res;
      }
      case "/oauth/consents":
        return consents(c, false);
      case "/oauth/consents/revoke":
        return consents(c, true);
    }
    return json(404, { error: "not_found" });
  }

  return {
    store,
    async revokeAllFor(e164, app, ro = {}) {
      const at = now();
      const key = o.platform.phoneKey(e164);
      let n = 0;
      for (const id of app ? [app] : (Object.keys(apps) as McpAppId[])) {
        for (const g of await store.grantsFor(key, id, at)) {
          if (await revokeGrant(g.id, at)) {
            n++;
            await store.audit({ at, kind: "consent_revoked", clientId: g.clientId, grantId: g.id, app: id, detail: "account change" });
          }
        }
      }
      if (ro.forget) await store.forgetPhone(key, e164, app);
      return n;
    },
    async fetch(req, server) {
      const url = new URL(req.url);
      if (!OWNED(url.pathname)) return undefined;
      try {
        if (now() - lastSweep > 10 * 60_000) { lastSweep = now(); await store.sweep(now()); }
        let peer: string | undefined;
        try { peer = server?.requestIP(req)?.address; } catch { /* not a served request (tests) */ }
        return await handle(req, url, peer);
      } catch (e) {
        log(`[mcp] ${req.method} ${url.pathname} failed: ${(e as Error).message}`);
        return json(500, { error: "server_error" });
      }
    },
  };
}

