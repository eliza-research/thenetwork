import { setTimeout as waitForMs } from "node:timers/promises";
// The remote MCP server and its OAuth 2.1 authorization server, as one fetch handler that the
// service mounts next to the platform's /api/*. Each site's Worker forwards /mcp, /oauth/* and
// /.well-known/oauth-* to the shared backend, so every site is its own issuer and resource:
//   https://slop.date/mcp          the MCP endpoint (resource) for slop; clients registered here are bound to slop
//   https://ntwrk.party/mcp/openai  the same server for the public OpenAI plugin (slop is hidden)
// Spec: MCP 2026-07-28 (Streamable HTTP, stateless, per-request _meta; initialize kept for 2025-03-26
// to 2025-11-25 clients), OAuth 2.1 with PKCE S256, RFC 7591 (registration), RFC 8414 and RFC 9728
// (metadata), RFC 8707 (resource), RFC 9207 (iss), RFC 7009 (revocation).
import { createHmac } from "node:crypto";
import { devShortcutsAllowed, ipBucket, signupAccountView, type Env } from "@thenetwork/platform";
import { verifyProxyHeaders } from "@thenetwork/platform/src/proxy.ts";
import { readCappedText } from "@thenetwork/platform/src/body.ts";
import { signupDraftAppEnabled, signupDraftBrowserAction, signupDraftBrowserSource, signupDraftClaimRoute, signupDraftDiscardAllowed } from "../../core/src/generated/mcpSignupDraft.ts";
import {
  type BrowserForm, type StoredPage, browserEntryMayResume, initial as browserInitial, mayCompareBrowserDigest,
  sessionMatchesConsent, step as stepBrowser,
} from "../../core/src/generated/oauthBrowserAuthorization.ts";
import { requestIsLive } from "../../core/src/generated/oauthGrantIssuance.ts";
import {
  type AuthPage, type AuthView, type Reply as PageReply, canApprove, canCancelRequest, canOpenPage, canRetryConnection, canReturnFromCloud,
  canSolveCheck, canSubmitCode, canSubmitPhone, checkFor, initial as pageInitial, solveCheck,
} from "../../core/src/generated/authorizationPages.ts";
import { issueConnectorGrant } from "../../core/src/vibe/oauthGrantIssuanceShell.js";
import {
  type TokenAuthority, type TokenFlow, type TokenReason, canReadAuthority, canReadCodeBinding, canReadRefreshBinding,
  canRecordRotation, codeCanBeConsumed, initial as tokenInitial, step as stepToken, tokenRevocation,
} from "../../core/src/generated/oauthTokenLifecycle.ts";
import {
  browserGrantVisibility, browserOwnsLiveGrant, browserRemovalProofMatches, removalConfirmationEndsAt,
  removalFormMayRevoke, removalListRetry, type RemoveReply,
} from "../../core/src/generated/connectedAssistants.ts";
import { configuredHostServes, profileDailyCap, profileLimitReached } from "../../core/src/generated/connectorTools.ts";
import { assistantGrantCounts, projectAssistantActivity } from "../../core/src/generated/notificationDelivery.ts";
import { connectorApp, connectorSurface, defaultApps, defaultHostMap, type McpApp, type McpAppId, type Surface } from "./apps.ts";
import type { AssistantKind, PlatformHooks } from "./hooks.ts";
import { codePage, consentPage, consentsPage, messagePage, phonePage } from "./pages.ts";
import { MemoryOAuthStore, samePendingAuthPage, type AssistantGrantCandidate, type AuthCode, type AuthRequest, type ClientAuthMethod, type Grant, type BrowserGrantRemoval, type OAuthClient, type OAuthStore, type Scope, SCOPES, type Token } from "./store.ts";
import { callTool, canCallTool, checkArgs, checkGrantOwner, connectionOf, INSTRUCTIONS, TOOL_NAMES, TOOL_SCOPE, tokenCovers, type ToolName, toolDefs } from "./tools.ts";
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
  /** Owned dev-only DCR OpenAI connections on /mcp. Default off. Turning off suspends access, not grants; explicit revocation still works. Public /mcp/openai stays filtered. */
  privateOpenAiApps?: readonly McpAppId[];
  /** Inactive by default. Explicit deployed-only, account-allowlisted custom ChatGPT Slop onboarding. */
  customChatGptSlopPersonIds?: readonly string[];
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
  /** The answer for an MCP or OAuth path, or undefined for any other path. Pass the HTTP server for the socket address. */
  fetch(req: Request, server?: { requestIP(req: Request): { address: string } | null }): Promise<Response | undefined>;
  store: OAuthStore;
  /**
   * Revoke a phone's grants in one app or every app. With `forget`, the matching grants and sign-in
   * requests are deleted. A verified account erasure uses `forgetPerson` instead.
   */
  revokeAllFor(e164: string, app?: McpAppId, o?: { forget?: boolean }): Promise<number>;
  /** Erase the verified person's grants and approvals across phone bindings, in one app or every app. */
  forgetPerson(personId: string, app?: McpAppId): Promise<number>;
  /** Current local connector authority for opening inbox items from one app in a hosted assistant. */
  assistantUpdateSurfaces(personId: string, app: McpAppId): Promise<AssistantKind[]>;
  /** Map grants under the provider claim lock for the already verified current owner. */
  assistantUpdateSurfacesForClaim(candidates: readonly AssistantGrantCandidate[]): AssistantKind[];
}

interface Ctx { app: McpApp; issuer: string; ip: string; req: Request; url: URL }
interface Authed { token: Token; grant: Grant; client: OAuthClient }

const browserPages: Record<AuthRequest["step"], StoredPage> = { phone: "PhonePage", code: "CodePage", consent: "ConsentPage" };
const browserForms = { phone: "PhoneForm", code: "CodeForm", consent: "ConsentForm", cancel: "CancelForm" } satisfies Record<string, BrowserForm>;

/** The page view of each stored step (spec/authorizationPages.md, "The server reply selects the page view"). */
const storedViews: Record<AuthRequest["step"], AuthView> = { phone: "PhoneView", code: "CodeView", consent: "ConsentView" };

type PageForm = "phone" | "code" | "consent" | "cancel";

/**
 * The page that sent a form (spec/authorizationPages.md), from the route and the stored request. The phone, code and
 * consent forms are only on their own pages; Cancel is on the page of the stored step. A code was sent when the request
 * holds a number. A posted phone form carries the person's answer to the security check, so the check is solved here
 * and the server verifies the answer next (a failed answer is the reply ReplyCheckFailed).
 */
function sentFrom(r: AuthRequest, form: PageForm, turnstileOn: boolean): AuthPage {
  const view = form === "cancel" ? storedViews[r.step] : storedViews[form];
  const page: AuthPage = {
    ...pageInitial, view, turnstileOn, securityCheck: checkFor(view, turnstileOn),
    codeSent: r.e164 !== null, consentSeen: r.step === "consent",
  };
  return canSolveCheck(page) ? solveCheck(page) : page;
}

/** The generated guard of a form for one reply (spec/authorizationPages.md). Don't allow on a consent page cancels. */
function formAllows(page: AuthPage, form: PageForm, approving: boolean, reply: PageReply): boolean {
  if (form === "phone") return canSubmitPhone(page, reply);
  if (form === "code") return canSubmitCode(page, reply);
  if (form === "consent" && approving) return canApprove(page, reply);
  return canCancelRequest(page, reply);
}

/** The reply that each form asks for: the guard of the form with this reply is the gate in front of its route. */
const askedReply = (form: PageForm, approving: boolean): PageReply =>
  form === "phone" ? "ReplyCode" : form === "code" ? "ReplyConsent" : form === "consent" && approving ? "ReplyApproved" : "ReplyDeclined";

const cloudReturnAllows = (reply: PageReply, turnstileOn: boolean): boolean =>
  canReturnFromCloud({ ...pageInitial, view: "CloudView", turnstileOn }, reply);

const tokenErrors: Record<TokenReason, [error: string, description?: string]> = {
  NoReason: ["invalid_grant"],
  InvalidGrant: ["invalid_grant"],
  CodeExpired: ["invalid_grant", "The code expired."],
  RedirectMismatch: ["invalid_grant", "redirect_uri does not match."],
  VerifierMismatch: ["invalid_grant", "code_verifier does not match."],
  InvalidScope: ["invalid_scope"],
  InvalidTarget: ["invalid_target"],
};
const tokenAuthority: Record<"valid" | "invalid" | "unavailable", TokenAuthority> = {
  valid: "Current", invalid: "Invalid", unavailable: "Unavailable",
};

/** The day of the profile limit: the store's fixed window (spec/connectorTools.md, "what the shell owns"). */
const PROFILE_DAY_MS = 86_400_000;

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
  if (o.privateOpenAiApps?.length && !devShortcutsAllowed(env)) throw new Error("privateOpenAiApps is for an owned dev runtime only");
  const privateOpenAiApps = new Set(o.privateOpenAiApps ?? []);
  const customSlopPeople = o.customChatGptSlopPersonIds === undefined ? null : new Set(o.customChatGptSlopPersonIds);
  if (customSlopPeople) {
    if (privateOpenAiApps.size) throw new Error("custom ChatGPT Slop cannot use the dev pilot");
    if (!["staging", "production"].includes(env.PLATFORM_ENV ?? "")) throw new Error("custom ChatGPT Slop needs explicit staging or production");
    if (!customSlopPeople.size || [...customSlopPeople].some(id => !id.trim() || id === "*")) throw new Error("custom ChatGPT Slop needs an explicit person allowlist");
    if (!o.platform.customChatGptSlopEligible || !o.platform.session) throw new Error("custom ChatGPT Slop needs current account eligibility and sessions");
  }
  const store = o.store ?? new MemoryOAuthStore();
  const now = o.now ?? Date.now;
  o.platform.setSignupAgeCleanup?.((key, app) => store.discardSignupDrafts(key, app, now()));
  const ttl = { ...TTL, ...o.ttl };
  const lim = { ...LIMITS, ...o.limits };
  const log = o.log ?? (s => console.log(s));
  /** Recompute the affected assistant from all of the person's grants after an OAuth change. */
  async function reconcileAssistantSignal(grant: Grant | undefined) {
    const personId = grant?.personId;
    const publish = o.platform.assistantLinked?.bind(o.platform);
    if (!grant || !personId || !publish) return;
    try {
      const client = await store.getClient(grant.clientId);
      if (!client) return;
      const assistant = assistantOf(client);
      // spec/notificationDelivery.md, "One app's removal keeps an assistant active while another grant remains"
      await store.projectAssistantGrants(personId, now, async candidates => {
        let hasEligibleGrant = false;
        let checksComplete = true;
        const owners = new Map<string, boolean | undefined>();
        for (const { grant: candidate, client: caller } of candidates) {
          if (!assistantGrantCounts(candidate.personId === personId, assistantOf(caller) === assistant,
            grantAllowsUpdates(candidate, caller), candidate.revokedAt === null && candidate.expiresAt > now())) continue;
          if (!owners.has(candidate.phoneKey)) owners.set(candidate.phoneKey, await assistantGrantOwnerCurrent(candidate));
          const owner = owners.get(candidate.phoneKey);
          if (owner === undefined) checksComplete = false;
          if (owner && candidate.expiresAt > now()) { hasEligibleGrant = true; break; }
        }
        const activity = projectAssistantActivity(hasEligibleGrant, checksComplete);
        if (activity !== "AssistantUnchanged") await publish(personId, assistant, activity === "AssistantActive");
      });
    } catch (error) {
      log(`[mcp] assistant signal could not be reconciled: ${(error as Error).message}`);
    }
  }
  async function assistantGrantOwnerCurrent(grant: Grant): Promise<boolean | undefined> {
    const owner = await checkGrantOwner(o.platform, grant);
    if (owner === "GrantOwnerUnavailable") return;
    if (owner !== "GrantOwnerMatches") return false;
    try { return !await o.platform.grantIsBanned(grant.phoneKey, grant.personId); } catch { return; }
  }
  /** Every revocation goes through here, so the inbox always hears about it. */
  async function revokeGrant(id: string, at: number, owner?: BrowserGrantRemoval) {
    const ok = await store.revokeGrant(id, at, owner);
    if (ok) await reconcileAssistantSignal(await store.getGrant(id));
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
  // Private pilot is DCR-only. Re-check persisted clients on every auth/write path so an
  // operator disabling the opt-in suspends access without deleting consent or blocking revoke.
  function openAiUnavailable(c: Pick<Ctx, "app">, client: OAuthClient): boolean {
    const openAi = assistantOf(client) === "chatgpt" || (client.kind === "cimd" && isOpenAiHost(new URL(client.id).hostname));
    return openAi && !c.app.openai && !customSlopClient(c, client) && (client.kind !== "dcr" || !privateOpenAiApps.has(c.app.id));
  }

  function chatGptRedirects(uris: readonly string[]): boolean {
    return uris.length > 0 && uris.every(uri => {
      const u = new URL(uri);
      return u.protocol === "https:" && !u.username && !u.password && ["chatgpt.com", "chat.openai.com"].includes(u.host);
    });
  }

  function customSlopClient(c: Pick<Ctx, "app">, client: OAuthClient): boolean {
    return customSlopPeople !== null && c.app.id === "slop" && client.kind === "dcr" && chatGptRedirects(client.redirectUris);
  }

  async function customSlopEligible(c: Ctx, client: OAuthClient, personId: string | null, phoneKey: string): Promise<boolean> {
    if (!customSlopClient(c, client)) return true;
    return !!personId && customSlopPeople!.has(personId) && await o.platform.customChatGptSlopEligible!(personId, phoneKey);
  }

  function grantAllowsUpdates(grant: Grant, client: OAuthClient): boolean {
    const app = apps[grant.app];
    if (!app || app.id !== client.app || !tokenCovers("get_updates", grant.scopes)) return false;
    const pathSurface = grant.resource.endsWith("/mcp/openai") ? "openai" : o.surface ?? "full";
    if (grant.resource !== resourceFor(issuerOf(app), pathSurface)) return false;
    const surface = pathSurface === "openai" || client.surface === "openai" ? "openai" : "full";
    return configuredHostServes(connectorSurface[surface], connectorApp[app.id], app.openai)
      && !openAiUnavailable({ app }, client) && !customSlopClient({ app }, client);
  }

  function localUpdateSurface(grant: Grant, client: OAuthClient, at: number): AssistantKind | undefined {
    if (grant.revokedAt !== null || grant.expiresAt <= at || !grantAllowsUpdates(grant, client)) return;
    const authority = grant.cloudAuthority;
    if (grant.id.startsWith("grant_cloud_") || authority) {
      if (!authority || authority.app !== grant.app || authority.resource !== grant.resource || authority.phoneKey !== grant.phoneKey
        || grant.expiresAt > authority.expiresAt || authority.expiresAt <= at) return;
    }
    const assistant = assistantOf(client);
    return assistant === "web" ? undefined : assistant;
  }


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
    const custom = customSlopPeople !== null && c.app.id === "slop" && chatGptRedirects(uris as string[]);
    const surface: Surface = !custom && !privateOpenAiApps.has(c.app.id) && (uris as string[]).some(r => isOpenAiHost(new URL(r).hostname)) ? "openai" : "full";
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
    if (openAiUnavailable(c, client)) return messagePage(c.app, "Not available", "This assistant connection is not available on this site.", 403);
    const asked = q.get("redirect_uri");
    const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : null);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) return messagePage(c.app, "This link does not work", "The assistant asked to return to an address it did not register.");
    const state = q.get("state");
    // A malformed request is an error page here, never a redirect (RFC 9700 4.11.2): open registration
    // would otherwise let anyone bounce a person from this site to any https page with no click.
    // Only the person's Cancel action redirects back with an error.
    const fail = (_error: string, description: string) => messagePage(c.app, "This link does not work", `The assistant sent a sign-in link this site cannot use (${description}). Go back to the assistant and try again.`, 400);
    if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challengeIn = q.get("code_challenge");
    if (q.get("code_challenge_method") !== "S256" || !validChallenge(challengeIn)) return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    const scopes = parseScopes(q.get("scope"));
    if (!scopes) return fail("invalid_scope", "scope may be apps:read, membership:read and profile:write only");
    const rawResource = q.get("resource");
    const resource = rawResource ? canonicalResource(rawResource, c.issuer) : resourceFor(c.issuer, client.surface);
    if (!resource) return fail("invalid_target", "resource must be this site's MCP endpoint");
    if (customSlopClient(c, client) && resource !== resourceFor(c.issuer, "full")) return fail("invalid_target", "this connection must use the /mcp endpoint");
    if (client.surface === "openai" && resource !== resourceFor(c.issuer, "openai")) return fail("invalid_target", "this client must use the /mcp/openai endpoint");
    // login_hint, phone or any other person data in the URL is never read: the person types it on our page.
    const browser = randomToken();
    const r = {
      id: randomId(), browserHash: sha256hex(browser), clientId: client.id, app: c.app.id, redirectUri, state,
      codeChallenge: challengeIn, scopes, resource, e164: null, personId: null, step: "phone" as const, createdAt: now(), expiresAt: now() + ttl.requestMs,
    };
    await store.putAuthRequest(r);
    const cookie = `${browserCookie(c.app)}=${browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl.requestMs / 1000)}${secureCookies(c.app) ? "; Secure" : ""}`;
    const response = await authorizeEntry(c, r, client, false);
    response.headers.append("set-cookie", cookie);
    return response;
  }

  async function readAuthorizationSession(c: Ctx) {
    try { return await o.platform.session?.(c.app.id, c.req); }
    catch { return "unavailable" as const; }
  }

  /** Retry the initial session check on this unadvanced request without making a new browser binding. */
  async function authorizeEntry(c: Ctx, r: AuthRequest, client: OAuthClient, retry: boolean): Promise<Response> {
    const expired = () => messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.", 400);
    const page = { ...pageInitial, turnstileOn: !!o.turnstile };
    const answer = (reply: PageReply, respond: () => Response | Promise<Response>) => {
      const allowed = retry ? canRetryConnection({ ...page, view: "PleaseRetryView" }, reply) : canOpenPage(page, reply);
      return allowed ? respond() : expired();
    };
    const signedIn = await readAuthorizationSession(c);
    if (!requestIsLive(now(), r.expiresAt)) return expired();
    if (retry) {
      const current = await store.getAuthRequest(r.id);
      if (!current || !samePendingAuthPage(current, r, now())) return expired();
    }
    const entry = stepBrowser(browserInitial, {
      type: "chooseEntry",
      session: signedIn === "unavailable" ? "SessionUnavailable" : signedIn ? "SignedIn" : "SignedOut",
      cloudRequired: !signedIn && !!o.platform.cloudAuthorityRequired?.(c.app.id),
    });
    if (entry.phase === "SessionRetry") {
      return answer("ReplyRetryLater", () => browserUnavailable(c, `/oauth/retry?rid=${r.id}`));
    }
    if (signedIn && signedIn !== "unavailable") {
      const identity = stepBrowser(entry, {
        type: "recordBrowserIdentity",
        identity: await customSlopEligible(c, client, signedIn.personId, o.platform.phoneKey(signedIn.e164))
          ? "IdentityPermitted" : "IdentityRejected",
      });
      if (identity.phase !== "ShowingConsent") {
        if (!retry) await store.deleteAuthRequest(r.id);
        return answer("ReplyNotAvailable", () => messagePage(c.app, "Not available", "This account cannot use this assistant connection.", 403));
      }
      if (!await store.advanceAuthRequest(r, { e164: signedIn.e164, personId: signedIn.personId, step: "consent" }, now)) return expired();
      return answer("ReplyConsent", () => {
        const redirect = new URL(r.redirectUri);
        const response = consentPage(c.app, r.id, client.name, redirect.host, redirect.origin, r.scopes);
        if (signedIn.setCookie) response.headers.append("set-cookie", signedIn.setCookie);
        return response;
      });
    }
    if (entry.phase === "HandingOffToCloud") {
      const handoff = await o.platform.beginCloudOAuth?.(c.app.id, r.id);
      if (!handoff) {
        if (!retry) await store.deleteAuthRequest(r.id);
        return answer("ReplySignInUnavailable", () => messagePage(c.app, "Sign-in unavailable", "Go back to the assistant and try again later.", 503));
      }
      return answer("ReplyCloud", () => new Response(null, { status: 302, headers: { location: handoff.url, "cache-control": "no-store", "set-cookie": handoff.setCookie } }));
    }
    return answer("ReplyPhone", () => phonePage(c.app, r.id, { turnstileSiteKey: o.turnstile?.siteKey }));
  }

  /** The live request of this browser (rid in the form, the cookie from the start). */
  async function liveRequest(c: Ctx, form: URLSearchParams) {
    const rid = form.get("rid") ?? "";
    const r = rid ? await store.getAuthRequest(rid) : undefined;
    const browser = cookieValue(c.req.headers.get("cookie"), browserCookie(c.app));
    if (!r) return undefined;
    const sameApp = r.app === c.app.id;
    if (!mayCompareBrowserDigest(sameApp, sameApp && requestIsLive(now(), r.expiresAt), !!browser) || !browser) return undefined;
    const bound = stepBrowser(browserInitial, { type: "bindBrowser", matchesDigest: safeEqual(sha256hex(browser), r.browserHash) });
    if (bound.phase !== "CheckingClient") return undefined;
    const client = await store.getClient(r.clientId);
    const flow = stepBrowser(bound, { type: "readBrowserClient", clientExists: !!client });
    return flow.phase === "BrowserBound" && client ? { r, client, flow } : undefined;
  }

  async function liveBrowserEntry(c: Ctx) {
    const rid = c.url.searchParams.get("rid") ?? "";
    if (c.url.searchParams.size !== 1 || !/^[A-Za-z0-9_-]{22}$/.test(rid)) return;
    const live = await liveRequest(c, c.url.searchParams);
    if (live && browserEntryMayResume(live.flow, browserPages[live.r.step], !!live.r.e164)) return live;
  }

  function validBrowserEntry(c: Ctx, r: AuthRequest, client: OAuthClient): boolean {
    return client.app === c.app.id && client.redirectUris.includes(r.redirectUri) && !!canonicalResource(r.resource, c.issuer)
      && (client.surface !== "openai" || r.resource === resourceFor(c.issuer, "openai"))
      && (!customSlopClient(c, client) || r.resource === resourceFor(c.issuer, "full"))
      && validChallenge(r.codeChallenge) && !openAiUnavailable(c, client);
  }

  async function authorizeRetry(c: Ctx): Promise<Response> {
    const live = await liveBrowserEntry(c);
    if (!live) return messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.", 400);
    const { r, client } = live;
    if (!validBrowserEntry(c, r, client)) return messagePage(c.app, "This link does not work", "Go back to the assistant and connect again.", 400);
    return authorizeEntry(c, r, client, true);
  }

  /** Resume only the same browser's unexpired request; consent is still a separate POST. */
  async function authorizeCloudReturn(c: Ctx): Promise<Response> {
    // Initial session retry used this address on OTP apps before /oauth/retry.
    if (!o.platform.cloudAuthorityRequired?.(c.app.id)) return authorizeRetry(c);
    const live = await liveBrowserEntry(c);
    if (!live) return messagePage(c.app,"This page has expired","Go back to the assistant and connect again.",400);
    const { r, client, flow } = live;
    const expired = () => messagePage(c.app,"This page has expired","Go back to the assistant and connect again.",400);
    // spec/authorizationPages.md, "The return from Cloud sign-in and the retry link resume the same request": each reply passes the generated guard first; a refused one gets "This page has expired".
    const answer = async (reply: PageReply, respond: () => Response | Promise<Response>) => (cloudReturnAllows(reply, !!o.turnstile) ? respond() : expired());
    if (!cloudReturnAllows("ReplyConsent", !!o.turnstile)) return expired();
    const form = stepBrowser(flow, { type: "readBrowserForm", page: browserPages[r.step], hasPhone: !!r.e164, form: "CloudReturn", approve: false });
    if (form.phase !== "CheckingIdentity") return expired();
    if (!validBrowserEntry(c, r, client)) return answer("ReplyLinkInvalid", () => messagePage(c.app, "This link does not work", "Go back to the assistant and connect again.", 400));
    const who = await readAuthorizationSession(c);
    const identity = stepBrowser(form, {
      type: "recordBrowserIdentity",
      identity: who === "unavailable" ? "IdentityUnavailable"
        : who && await customSlopEligible(c, client, who.personId, o.platform.phoneKey(who.e164)) ? "IdentityPermitted"
        : "IdentityRejected",
    });
    if (identity.phase === "SessionRetry") return answer("ReplyRetryLater",()=>browserUnavailable(c,c.url.pathname+c.url.search));
    if (identity.phase !== "ShowingConsent" || !who || who === "unavailable") return answer("ReplyConnectAgain",()=>messagePage(c.app,"Connect again","Return to your agent or text conversation and connect again.",403));
    return answer("ReplyConsent", async () => {
      if (!await store.advanceAuthRequest(r, { e164: who.e164, personId: who.personId, step: "consent" }, now)) return expired();
      const response=consentPage(c.app,r.id,client.name,new URL(r.redirectUri).host,new URL(r.redirectUri).origin,r.scopes);
      if(who.setCookie)response.headers.append("set-cookie",who.setCookie);
      return response;
    });
  }

  async function authorizeStep(c: Ctx, step: PageForm): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (!originOk(c)) return messagePage(c.app, "Not allowed", "This form must be sent from this site.", 403);
    const form = await readForm(c.req);
    const live = form && (await liveRequest(c, form));
    if (!form || !live) return messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.");
    const { r, client, flow } = live;
    if (openAiUnavailable(c, client)) return messagePage(c.app, "Not available", "This assistant connection is not available on this site.", 403);
    const redirectHost = new URL(r.redirectUri).host;
    const clearCookie = `${browserCookie(c.app)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(c.app) ? "; Secure" : ""}`;

    const approving = step === "consent" && form.get("decision") === "approve";
    const expired = () => messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.");
    // spec/authorizationPages.md: the page that sent this form, and the generated guard of the form in front of the route
    // and of each reply. A refused form or reply gets "This page has expired", the answer to a form that does not belong
    // to the stored request.
    const page = sentFrom(r, step, !!o.turnstile);
    const answer = async (reply: PageReply, respond: () => Response | Promise<Response>) => (formAllows(page, step, approving, reply) ? respond() : expired());
    if (!formAllows(page, step, approving, askedReply(step, approving))) return expired();

    const action = stepBrowser(flow, {
      type: "readBrowserForm", page: browserPages[r.step], hasPhone: !!r.e164, form: browserForms[step], approve: approving,
    });
    if (action.phase === "BrowserExpired") return expired();
    if (action.phase === "AlreadyVerified") return answer("ReplyAlreadySignedIn", () => messagePage(c.app, "Already signed in", "Go back to the previous page to finish."));

    if (action.phase === "StartingOtp") {
      const t0 = performance.now();
      const pad = async () => { const left = (o.minOtpStartMs ?? 700) - (performance.now() - t0); if (left > 0) await waitForMs(left); };
      const turnstile = o.turnstile;
      if (turnstile && !(await turnstile.verify(form.get("cf-turnstile-response") ?? undefined, c.ip, c.app.id))) {
        return answer("ReplyCheckFailed", () => phonePage(c.app, r.id, { error: "Please complete the check and try again.", turnstileSiteKey: turnstile.siteKey }));
      }
      const e164 = o.platform.normalizePhone(form.get("phone"));
      if (!e164) return answer("ReplyPhoneInvalid", () => phonePage(c.app, r.id, { error: "Enter a US or Canada phone number.", turnstileSiteKey: o.turnstile?.siteKey }));
      const sent = await o.platform.startOtp(c.app.id, e164, c.ip);
      await pad();
      const next = stepBrowser(action, { type: "recordOtpSend", sent: sent.ok });
      if (next.phase !== "ShowingCode") {
        const limited = !sent.ok && sent.error === "rate_limited";
        const text = limited ? "Too many codes were asked for. Please wait and try again." : "Sign-in is not available for this app right now.";
        return answer(limited ? "ReplyTooManyCodes" : "ReplySendUnavailable", () => phonePage(c.app, r.id, { error: text, turnstileSiteKey: o.turnstile?.siteKey }));
      }
      return answer("ReplyCode", async () => {
        if (!await store.advanceAuthRequest(r, { e164, personId: null, step: "code" }, now)) return expired();
        return codePage(c.app, r.id, e164.slice(-4));
      });
    }

    if (action.phase === "VerifyingOtp" && r.e164) {
      const code = (form.get("code") ?? "").replace(/\s/g, "");
      const proof = stepBrowser(action, { type: "recordOtpVerification", verified: await o.platform.verifyOtp(c.app.id, r.e164, code, c.ip) });
      const last4 = r.e164.slice(-4);
      if (proof.phase !== "CheckingIdentity") return answer("ReplyCodeRejected", () => codePage(c.app, r.id, last4, { error: "That code did not work. Check the newest text and try again." }));
      const who = await o.platform.login(r.e164);
      const identity = stepBrowser(proof, {
        type: "recordBrowserIdentity",
        identity: who !== "held" && await customSlopEligible(c, client, who.personId, o.platform.phoneKey(r.e164))
          ? "IdentityPermitted" : "IdentityRejected",
      });
      if (identity.phase !== "ShowingConsent" || who === "held") {
        return answer("ReplyCheckNumber", async () => {
          await store.deleteAuthRequest(r.id);
          const res = messagePage(c.app, "We need to check this number", "We need to check this number before it can be used here. Please try again later, or email us for help.", 403);
          res.headers.append("set-cookie", clearCookie);
          return res;
        });
      }
      const e164 = r.e164;
      return answer("ReplyConsent", async () => {
        if (!await store.advanceAuthRequest(r, { e164, personId: who.personId, step: "consent" }, now)) return expired();
        const res = consentPage(c.app, r.id, client.name, redirectHost, new URL(r.redirectUri).origin, r.scopes);
        const site = o.platform.createSession ? await o.platform.createSession(c.app.id, { e164, personId: who.personId }) : undefined;
        if (site) res.headers.append("set-cookie", site);
        return res;
      });
    }

    if (action.phase === "CheckingConsentOwner" && r.e164) {
      const current = o.platform.session ? await o.platform.session(c.app.id, c.req) : undefined;
      const owner = current === "unavailable" ? undefined : await o.platform.login(r.e164);
      const checked = stepBrowser(action, {
        type: "readConsentOwner",
        verdict: current === "unavailable" ? "CheckUnavailable"
          : sessionMatchesConsent(!!o.platform.session, current?.personId === r.personId, current?.e164 === r.e164)
            && owner && owner !== "held" && owner.personId === r.personId
            && await customSlopEligible(c, client, r.personId, o.platform.phoneKey(r.e164))
            ? "CheckAccepted" : "CheckRejected",
      });
      if (checked.phase === "SessionRetry") return answer("ReplyConsentRetry", () => consentUnavailable(c, r, client));
      if (checked.phase !== "CheckingCloudGrant") {
        return answer("ReplyConnectAgain", async () => {
          await store.deleteAuthRequest(r.id);
          const response = messagePage(c.app, "Connect again", "Your account changed. Go back to your assistant and connect again.", 403);
          response.headers.append("set-cookie", clearCookie);
          return response;
        });
      }
      const required = o.platform.cloudAuthorityRequired?.(c.app.id);
      const authority = required ? await o.platform.cloudGrantAuthority?.(c.app.id, c.req, r.resource) : undefined;
      const readiness = stepBrowser(checked, {
        type: "readConsentAuthority",
        verdict: authority === "unavailable" ? "CheckUnavailable"
          : !required || (authority && authority.phoneKey === o.platform.phoneKey(r.e164)) ? "CheckAccepted" : "CheckRejected",
      });
      if (readiness.phase === "SessionRetry") return answer("ReplyConsentRetry", () => consentUnavailable(c, r, client));
      if (readiness.phase !== "ConsentReady" || authority === "unavailable")
        return answer("ReplyConnectAgain", () => messagePage(c.app, "Connect again", "Return to your agent or text conversation and connect again.", 403));
      // The gate in front of this route allowed ReplyApproved. The issuance can also answer "This page has expired",
      // the retry consent page or "Connect again"; each is an approve reply of the same consent page.
      const response = await finishAuthorization(c, { ...r, e164: r.e164 }, client, authority);
      if (current && current !== "unavailable" && current.setCookie) response.headers.append("set-cookie", current.setCookie);
      return response;
    }

    if (action.phase !== "ConsentDeclined") return expired();
    return answer("ReplyDeclined", async () => {
      await store.deleteAuthRequest(r.id);
      await store.audit({ at: now(), kind: "consent_denied", clientId: client.id, grantId: null, app: c.app.id, detail: null });
      return redirectTo(r.redirectUri, { error: "access_denied", error_description: "Connection cancelled", state: r.state, iss: c.issuer }, 303, { "set-cookie": clearCookie });
    });
  }

  /** Validate Cloud authority before the atomic issuance so outages remain retryable. */
  async function finishAuthorization(c: Ctx, r: AuthRequest & { e164: string }, client: OAuthClient, authority?: Grant["cloudAuthority"]): Promise<Response> {
    const clearCookie = `${browserCookie(c.app)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies(c.app) ? "; Secure" : ""}`;
    const issued = await issueConnectorGrant<Grant>(r, {
      now,
      makeGrant: at => ({
        id: `${authority ? "grant_cloud_" : "grant_"}${randomId()}`,
        clientId: client.id,
        app: c.app.id,
        phoneKey: o.platform.phoneKey(r.e164),
        personId: r.personId,
        scopes: r.scopes,
        resource: r.resource,
        createdAt: at,
        expiresAt: Math.min(at + ttl.grantMs, authority?.expiresAt ?? Infinity),
        revokedAt: null,
        ...(authority ? { cloudAuthority: authority } : {}),
      }),
      checkAuthority: cloudGrantCurrent,
      prepareIssuance: (grant, at) => {
        const code = randomToken("ntwc_");
        const record: AuthCode = {
          hash: sha256hex(code), grantId: grant.id, clientId: client.id, redirectUri: r.redirectUri,
          codeChallenge: r.codeChallenge, resource: r.resource, scopes: r.scopes,
          createdAt: at, expiresAt: at + ttl.codeMs, usedAt: null,
        };
        const audit = { at, clientId: client.id, grantId: grant.id, app: c.app.id };
        return {
          code,
          commit: (approvalAt, confirm) => store.commitConsentGrant(r.id, approvalAt, confirm, {
            grant, code: record,
            audit: [
              { ...audit, kind: "consent_granted", detail: r.scopes.join(" ") },
              { ...audit, kind: "code_issued", detail: null },
            ],
          }),
        };
      },
    });
    switch (issued.kind) {
      case "expired":
        return messagePage(c.app, "This page has expired", "Go back to the assistant and connect again.");
      case "retry":
        return consentUnavailable(c, r, client);
      case "denied":
        return messagePage(c.app, "Connect again", "This connection is no longer valid. Return to your agent or text conversation and connect again.", 403);
      case "issued":
        await reconcileAssistantSignal(issued.grant);
        return redirectTo(r.redirectUri, { code: issued.code, state: r.state, iss: c.issuer }, 303, { "set-cookie": clearCookie });
    }
  }

  // ---------------------------------------------------------------- token, revoke

  function tokenPair(client: OAuthClient, grant: Grant, scopes: Scope[], resource: string) {
    const at = now();
    const access = randomToken("ntwa_"), refresh = randomToken("ntwr_");
    const base = { grantId: grant.id, clientId: client.id, app: grant.app, resource, scopes, createdAt: at, revokedAt: null, rotatedAt: null };
    const tokens: readonly [Token, Token] = [
      { ...base, hash: sha256hex(access), kind: "access", expiresAt: Math.min(at + ttl.accessMs, grant.expiresAt) },
      { ...base, hash: sha256hex(refresh), kind: "refresh", expiresAt: Math.min(at + ttl.refreshMs, grant.expiresAt) },
    ];
    return { tokens, response: { access_token: access, token_type: "Bearer", expires_in: Math.floor(Math.min(ttl.accessMs, grant.expiresAt - at) / 1000), refresh_token: refresh, scope: scopes.join(" ") } };
  }

  async function checkTokenGrant(c: Ctx, client: OAuthClient, flow: TokenFlow, grantId: string, credentialExpiry: number, at: number) {
    const grant = await store.getGrant(grantId);
    const grantLive = !!grant && grant.revokedAt === null && !(grant.expiresAt <= at);
    const checked = stepToken(flow, {
      type: "readGrant", grantLive,
      eligible: grantLive && await customSlopEligible(c, client, grant.personId, grant.phoneKey),
    });
    if (!grant || !canReadAuthority(checked)) return { grant, flow: checked };
    const authority = tokenAuthority[await grantAuthorityCurrent(grant)];
    return { grant, flow: stepToken(checked, { type: "readAuthority", credentialLive: !(credentialExpiry <= now()), authority }) };
  }

  async function token(c: Ctx): Promise<Response> {
    if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (await limited(`token:ip:${sha256hex(ipBucket(c.ip))}`, lim.tokenPerIpMinute, 60_000)) return tooMany(60);
    const form = await readForm(c.req);
    if (!form) return json(400, { error: "invalid_request", error_description: "Send application/x-www-form-urlencoded with each parameter once." });
    const client = await authClient(c, form);
    if (client instanceof Response) return client;
    if (openAiUnavailable(c, client)) return json(401, { error: "invalid_client" });
    const bad = (error: string, d?: string) => json(400, { error, ...(d ? { error_description: d } : {}) });
    const refused = (flow: TokenFlow) => flow.phase === "RetryAuthority" ? temporarilyUnavailable() : bad(...tokenErrors[flow.reason]);
    const at = now();
    const grantType = form.get("grant_type");

    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const ac = code ? await store.getCode(sha256hex(code)) : undefined;
      const read = stepToken(tokenInitial, {
        type: "readCode", clientMatches: ac?.clientId === client.id, used: !!ac && ac.usedAt !== null, live: !!ac && !(ac.expiresAt <= at),
      });
      if (!ac) return refused(read);
      if (read.phase === "RevokeGrant") {
        // OAuth 2.1 4.1.3: a second use of a code revokes what the first use issued.
        await revokeGrant(ac.grantId, at);
        await store.audit({ at, kind: "code_replay", clientId: client.id, grantId: ac.grantId, app: c.app.id, detail: "grant revoked" });
        return refused(read);
      }
      if (!canReadCodeBinding(read)) return refused(read);
      const redirectMatches = form.get("redirect_uri") === ac.redirectUri;
      const verifier = form.get("code_verifier");
      const verifierMatches = redirectMatches && validVerifier(verifier) && safeEqual(pkceS256(verifier), ac.codeChallenge);
      const res = form.get("resource");
      const binding = stepToken(read, {
        type: "readCodeBinding", redirectMatches, verifierMatches,
        resourceMatches: verifierMatches && (!res || canonicalResource(res, c.issuer) === ac.resource),
      });
      if (binding.phase !== "CheckingGrant") return refused(binding);
      const { grant, flow: authorized } = await checkTokenGrant(c, client, binding, ac.grantId, ac.expiresAt, at);
      if (!grant || authorized.phase !== "AwaitingConsumption") return refused(authorized);
      // The Cloud check may be slow: recheck expiry and atomically consume only after it succeeds.
      if (!codeCanBeConsumed(authorized, !(ac.expiresAt <= now()) && !(grant.expiresAt <= now()))) return refused(authorized);
      const pair = tokenPair(client, grant, ac.scopes, ac.resource);
      const result = await store.commitCodeExchange({ code: ac, grant, tokens: pair.tokens, now, audit: {
        kind: "token_issued", clientId: client.id, grantId: grant.id, app: c.app.id, detail: ac.scopes.join(" "),
      } });
      const ready = stepToken(authorized, { type: "readCodeExchange", result });
      if (ready.phase === "RevokeGrant") {
        await revokeGrant(ac.grantId, now());
        await store.audit({ at: now(), kind: "code_replay", clientId: client.id, grantId: ac.grantId, app: c.app.id, detail: "grant revoked" });
      }
      return ready.phase === "TokensReady" ? json(200, pair.response) : refused(ready);
    }

    if (grantType === "refresh_token") {
      const raw = form.get("refresh_token") ?? "";
      const t = raw ? await store.getToken(sha256hex(raw)) : undefined;
      const read = stepToken(tokenInitial, {
        type: "readRefresh", refreshMatches: !!t && t.kind === "refresh" && t.clientId === client.id && t.revokedAt === null && !(t.expiresAt <= at),
      });
      if (!t || read.phase !== "CheckingGrant") return refused(read);
      const { grant, flow: authorized } = await checkTokenGrant(c, client, read, t.grantId, t.expiresAt, at);
      if (!grant || !canReadRefreshBinding(authorized)) return refused(authorized);
      const asked = form.get("scope") === null ? t.scopes : parseScopes(form.get("scope"));
      const scopeAllowed = !!asked && asked.every(s => t.scopes.includes(s));
      const res = form.get("resource");
      const resourceMatches = scopeAllowed && (!res || canonicalResource(res, c.issuer) === t.resource);
      const refreshedAt = resourceMatches ? now() : at;
      const binding = stepToken(authorized, {
        type: "readRefreshBinding", scopeAllowed, resourceMatches,
        bothLive: resourceMatches && !(t.expiresAt <= refreshedAt) && !(grant.expiresAt <= refreshedAt),
      });
      if (!asked || !canRecordRotation(binding)) return refused(binding);
      const pair = tokenPair(client, grant, asked, t.resource);
      const result = await store.rotateRefresh({ refresh: t, grant, tokens: pair.tokens, now, audit: {
        kind: "token_refreshed", clientId: client.id, grantId: grant.id, app: c.app.id, detail: asked.join(" "),
      } });
      const rotation = stepToken(binding, { type: "recordRotation", result });
      if (rotation.phase === "RevokeGrant") {
        // A refresh token used twice: someone else has a copy. End the whole grant.
        await revokeGrant(t.grantId, now());
        await store.audit({ at: now(), kind: "refresh_replay", clientId: client.id, grantId: t.grantId, app: c.app.id, detail: "grant revoked" });
        return refused(rotation);
      }
      return rotation.phase === "TokensReady" ? json(200, pair.response) : refused(rotation);
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
    const effect = tokenRevocation(t?.clientId === client.id, t?.kind === "refresh");
    if (t && effect !== "NoChange") {
      const at = now();
      if (effect === "EndGrant") await revokeGrant(t.grantId, at);
      else await store.revokeToken(t.hash, at);
      await store.audit({ at, kind: "token_revoked", clientId: client.id, grantId: t.grantId, app: c.app.id, detail: effect === "EndGrant" ? "refresh: grant revoked" : "access" });
    }
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }

  // ---------------------------------------------------------------- the person's consent records

  /** The signed form binds one grant and its expiry to the confirmed browser session. */
  function consentRemovalMac(browserBinding: string, grant: Grant, until: number): string {
    return createHmac("sha256", browserBinding)
      .update(JSON.stringify(["connected-assistants-remove", grant.app, grant.phoneKey, grant.personId, grant.id, until]))
      .digest("base64url");
  }

  async function consents(c: Ctx, revokeOne: boolean): Promise<Response> {
    const who = await readAuthorizationSession(c);
    if (who === "unavailable") return browserUnavailable(c, "/oauth/consents");
    const signInFirst = () => messagePage(c.app, "Sign in first", "Connect this app in your agent and confirm your phone during authorization, then open this page again.", 401);
    if (!who) return signInFirst();
    const owner = { app: c.app.id, phoneKey: o.platform.phoneKey(who.e164), personId: who.personId };
    const owns = (grant: Grant, at: number) => browserOwnsLiveGrant(grant.app === owner.app, grant.phoneKey === owner.phoneKey,
      grant.personId === owner.personId, grant.revokedAt === null, at, grant.expiresAt);
    let removal: Extract<RemoveReply, "Removed" | "NothingRemoved"> | undefined;
    if (revokeOne) {
      if (c.req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
      // A cross-site form cannot remove access for the person: the Origin must be this site.
      if (!originOk(c) || (c.req.headers.get("origin") === null && c.req.headers.get("sec-fetch-site") !== "same-origin")) return messagePage(c.app, "Not allowed", "This form must be sent from this site.", 403);
      const form = await readForm(c.req);
      const id = form?.get("grant");
      const grant = id ? await store.getGrant(id) : undefined;
      const proof = /^([0-9]{1,15})\.([A-Za-z0-9_-]{43})$/.exec(form?.get("confirmation") ?? "");
      const until = proof ? Number(proof[1]) : 0;
      const sessionHash = who.browserBinding;
      const proves = (binding?: string) => !!(grant && proof && binding && safeEqual(proof[2]!, consentRemovalMac(binding, grant, until)));
      const matches = browserRemovalProofMatches(!!sessionHash, proves(sessionHash), proves(who.rotatedFromBrowserBinding));
      const currentOwner = matches && who.personId === await o.platform.personForKey(owner.phoneKey);
      const at = now();
      removal = "NothingRemoved";
      if (grant && sessionHash && removalFormMayRevoke(currentOwner && owns(grant, at), matches, at, until)
        && await revokeGrant(grant.id, at, { ...owner, e164: who.e164, sessionHash, confirmationEndsAt: until, now })) {
        await store.audit({ at: now(), kind: "consent_revoked", clientId: grant.clientId, grantId: grant.id, app: c.app.id, detail: "by the person" });
        removal = "Removed";
      }
    }
    const startedAt = now();
    const candidates = (await store.grantsFor(owner.phoneKey, owner.app, startedAt)).filter(grant => owns(grant, startedAt));
    const checked = new Map(await Promise.all(candidates.map(async grant => {
      const [authority, client] = await Promise.all([
        usesCloudGrantAuthority(grant) ? cloudGrantCurrent(grant) : "valid" as const,
        store.getClient(grant.clientId),
      ]);
      return [grant.id, { authority, clientName: client?.name ?? null }] as const;
    })));
    const current = candidates.length ? await store.grantsFor(owner.phoneKey, owner.app, now()) : [];
    if (who.personId !== await o.platform.personForKey(owner.phoneKey)) return signInFirst();
    const at = now();
    const grants: Array<Grant & { clientName: string | null }> = [];
    for (const grant of current) {
      const check = checked.get(grant.id);
      if (!check) continue;
      const visibility = browserGrantVisibility(owns(grant, at), check.authority);
      if (visibility === "RetryBrowserGrantList") {
        const response = browserUnavailable(c, "/oauth/consents", removalListRetry(removal ?? "") === "RemovedListUnavailable");
        if (who.setCookie) response.headers.append("set-cookie", who.setCookie);
        return response;
      }
      if (visibility === "ShowBrowserGrant") grants.push({ ...grant, clientName: check.clientName });
    }
    const selected = revokeOne ? undefined : grants.find(grant => grant.id === c.url.searchParams.get("remove"));
    const until = selected ? removalConfirmationEndsAt(at, selected.expiresAt) : 0;
    const confirmation = selected && who.browserBinding ? {
      grantId: selected.id, proof: `${until}.${consentRemovalMac(who.browserBinding, selected, until)}`,
    } : undefined;
    const page = consentsPage(c.app, grants, ms => new Date(ms).toISOString().slice(0, 10), { removal, confirmation });
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

  async function bearer(c: Ctx, resource: string): Promise<Authed | null | "invalid" | "unavailable"> {
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
    const authority = await grantAuthorityCurrent(grant);
    if (t.expiresAt <= now() || grant.expiresAt <= now()) return "invalid";
    if (authority !== "valid") return authority;
    return { token: t, grant, client };
  }

  async function grantAuthorityCurrent(grant: Grant): Promise<"valid" | "invalid" | "unavailable"> {
    // spec/connectorTools.md, "A grant that no longer belongs to the phone's person ends the connection"
    const owner = await checkGrantOwner(o.platform, grant);
    if (owner === "GrantOwnerUnavailable") return "unavailable";
    if (owner === "GrantOwnerHeld") return "invalid";
    if (owner === "GrantOwnerChanged") {
      try { await revokeGrant(grant.id, now()); } catch { return "unavailable"; }
      return "invalid";
    }
    return cloudGrantCurrent(grant);
  }

  function usesCloudGrantAuthority(grant: Grant): boolean {
    return grant.id.startsWith("grant_cloud_") || grant.cloudAuthority != null;
  }

  async function cloudGrantCurrent(grant: Grant): Promise<"valid" | "invalid" | "unavailable"> {
    // spec/oauthTokenLifecycle.md, "The request needs current grant authority and must stay within its consent"
    let banned: boolean;
    try { banned = await o.platform.grantIsBanned(grant.phoneKey, grant.personId); } catch { return "unavailable"; }
    if(banned)return "invalid";
    if(!usesCloudGrantAuthority(grant))return "valid";
    const authority=grant.cloudAuthority;
    if(!authority || grant.expiresAt<=now() || grant.expiresAt>authority.expiresAt || authority.expiresAt<=now())return "invalid";
    if(!o.platform.validateCloudGrant)return "unavailable";
    let status:"valid"|"invalid"|"unavailable";
    try{status=await o.platform.validateCloudGrant(grant);}catch{status="unavailable";}
    // A failed transport never extends sealed authority, even if it expired during validation.
    return grant.expiresAt>now() && authority.expiresAt>now()?status:"invalid";
  }

  function browserUnavailable(c: Ctx, retryPath?: string, accessRemoved = false): Response {
    const text = accessRemoved
      ? "Access removed. We can’t check your other connections right now. Try again shortly."
      : "We can’t check your connection right now. Try again shortly, or return to your agent or text conversation.";
    const response = messagePage(c.app, "Please try again", text, accessRemoved ? 200 : 503, retryPath);
    if (!accessRemoved) response.headers.set("retry-after", "5");
    return response;
  }

  function consentUnavailable(c:Ctx,r:AuthRequest,client:OAuthClient):Response {
    const response=consentPage(c.app,r.id,client.name,new URL(r.redirectUri).host,new URL(r.redirectUri).origin,r.scopes,{unavailable:true});
    response.headers.set("retry-after","5");return response;
  }

  function temporarilyUnavailable(): Response {
    return json(503,{error:"temporarily_unavailable",error_description:"Your connection cannot be checked right now. Please try again shortly."},{"retry-after":"5"});
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
    if (auth === "unavailable")return out(503,rpcError(null,-32603,"Your connection cannot be checked right now. Please try again shortly."),{"retry-after":"5"});
    if (auth === "invalid") return out(401, rpcError(null, -31401, "The access token is not valid here"), { "www-authenticate": challenge(resource, { error: "invalid_token", error_description: "The access token is invalid, expired or for another resource" }) });
    const surface: Surface = pathSurface === "openai" || auth?.client.surface === "openai" ? "openai" : "full";
    if (auth && openAiUnavailable(c, auth.client)) return out(404, rpcError(null, -32601, "Not available"));
    if (auth && !(await customSlopEligible(c, auth.client, auth.grant.personId, auth.grant.phoneKey))) return out(401, rpcError(null, -31401, "The access token is not valid here"), { "www-authenticate": challenge(resource, { error: "invalid_token" }) });
    const onboardingOnly = customSlopPeople !== null && c.app.id === "slop" && (!auth || customSlopClient(c, auth.client));

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
    // spec/connectorTools.md, "A connection binds to one host on one surface"
    if (!configuredHostServes(connectorSurface[surface], connectorApp[host.id], host.openai)) {
      return out(404, rpcError(id, -32601, "Not available"));
    }

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
        return result({ tools: toolDefs(apps, surface, host).filter(t => !onboardingOnly || t.name !== "get_updates") });
      case "tools/call": {
        const name = params.name;
        if (!(TOOL_NAMES as readonly string[]).includes(name)) return out(200, { jsonrpc: "2.0", id, result: { ...(modern ? { resultType: "complete" } : {}), content: [{ type: "text", text: "Unknown tool." }], isError: true } });
        const tool = name as ToolName;
        if (onboardingOnly && tool === "get_updates") return result({ content: [{ type: "text", text: "This connection supports onboarding only." }], isError: true });
        const need = TOOL_SCOPE[tool];
        if (need) {
          const scopeChallenge = challenge(resource, auth ? { error: "insufficient_scope", error_description: `This tool needs ${need}` } : {});
          // spec/connectorTools.md, "Public tools need no sign-in": a member tool needs a grant that covers its scope.
          if (!auth || !tokenCovers(tool, auth.token.scopes)) {
            // ChatGPT reads the challenge from the tool result; other clients get the HTTP status (MCP authorization, step-up).
            if (surface === "openai") return result({ content: [{ type: "text", text: "The person must sign in on the site and allow access first." }], isError: true, _meta: { "mcp/www_authenticate": [scopeChallenge] } });
            return auth
              ? out(403, rpcError(id, -31403, "Insufficient scope"), { "www-authenticate": scopeChallenge })
              : out(401, rpcError(id, -31401, "Sign-in required"), { "www-authenticate": scopeChallenge });
          }
          if (await limited(`status:grant:${auth.grant.id}`, lim.statusPerGrantMinute, 60_000)) return out(429, rpcError(id, -31029, "Too many requests"), { "retry-after": "60" });
          const args = checkArgs(tool, params.arguments, [], host);
          // spec/connectorTools.md: the generated guard of the call. A draft on a host without Join drafts gets the
          // answer of its argument check, as the tool gives it.
          if (!canCallTool(connectionOf(host, surface, auth.token.scopes), tool)) {
            const text = tool === "prepare_signup" && !args.ok ? args.message : "The person must sign in on the site and allow access first.";
            return result({ content: [{ type: "text", text }], isError: true });
          }
          // A profile is a few messages a day at most (each one reaches the member's own app as a text).
          // Only a well-formed profile counts (a refused one never reaches the app).
          if ((tool === "submit_profile" || tool === "prepare_signup") && args.ok) {
            // spec/connectorTools.md, "within the daily limit": the earlier calls of this grant in the store's day.
            const sentToday = Math.min((await store.hit(`profile:grant:${auth.grant.id}`, PROFILE_DAY_MS, now())) - 1, profileDailyCap);
            if (profileLimitReached(sentToday)) return out(429, rpcError(id, -31029, "Too many profiles today"), { "retry-after": "3600" });
          }
        }
        const r = await callTool(tool, params.arguments, { apps, surface, host, hooks: o.platform, grant: auth?.grant ?? null, store, now: now(), assistant: auth ? assistantOf(auth.client) : undefined });
        log(`[mcp] ${host.id} ${surface} ${tool} ${r.kind}${auth ? ` grant=${auth.grant.id}` : ""}`);
        if (r.kind === "grant_unavailable") return out(503, rpcError(id, -32603, "Your connection cannot be checked right now. Please try again shortly."), { "retry-after": "5" });
        if (r.kind === "invalid_grant" || r.kind === "grant_held") {
          if (auth && r.kind === "invalid_grant") await revokeGrant(auth.grant.id, now());
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
      case "/oauth/signup-draft":
      case "/oauth/signup-draft/discard": {
        if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
        // Same-origin session only. No draft IDs, phone or facts in URLs or request bodies.
        const browserConfirmed = req.headers.get("origin") !== null || req.headers.get("sec-fetch-site") === "same-origin";
        if (!signupDraftBrowserSource(originOk(c), browserConfirmed, !!url.search)) return json(403, { error: "not_allowed" });
        if (!signupDraftAppEnabled(c.app.id)) return json(404, { error: "not_found" });
        const who = await o.platform.session?.(c.app.id, req);
        if(who==="unavailable")return temporarilyUnavailable();
        if (!who) return json(401, { error: "sign_in_required" });
        const key = o.platform.phoneKey(who.e164);
        const action = signupDraftBrowserAction(who.personId === await o.platform.personForKey(key), p.endsWith("/discard"));
        if (action === "RefuseBrowserAction") return json(403, { error: "not_allowed" });
        const signupView = signupAccountView(c.app.id, key, who.personId);
        if (action === "CheckDiscardView") {
          const body = await readJson(req);
          if (!signupDraftDiscardAllowed(action, !!body && body.signupView === signupView)) return json(403, { error: "not_allowed" });
          await store.discardSignupDrafts(key, c.app.id, now());
          return json(200, { discarded: true }, who.setCookie ? { "set-cookie": who.setCookie } : {});
        }
        if (!o.platform.withSignupAgePolicy || !o.platform.setSignupAgeCleanup) return json(403, { error: "not_allowed" });
        return o.platform.withSignupAgePolicy(key, c.app.id, async allowed => {
          const status = who.personId === null ? "not_joined" : await o.platform.status(who.personId, c.app.id, key);
          const decision = signupDraftClaimRoute(status, allowed);
          if (decision === "RefuseClaim") return json(403, { error: "not_allowed" });
          const draft = decision === "ReadDraft" ? await store.claimSignupDraft(key, c.app.id, who.personId, now()) : undefined;
          const response = json(200, { draft: draft ?? null, signupView }, { "cache-control": "no-store" });
          if (who.setCookie) response.headers.append("set-cookie", who.setCookie);
          return response;
        });
      }
      case "/oauth/register": {
        const res = await register(c);
        res.headers.set("access-control-allow-origin", "*");
        return res;
      }
      case "/oauth/authorize":
        return get ? authorizeStart(c) : json(405, { error: "method_not_allowed" });
      case "/oauth/retry":
        return get ? authorizeRetry(c) : json(405, { error: "method_not_allowed" });
      case "/oauth/cloud-return":
        return get?authorizeCloudReturn(c):json(405,{error:"method_not_allowed"});
      case "/oauth/authorize/phone":
        return authorizeStep(c, "phone");
      case "/oauth/authorize/code":
        return authorizeStep(c, "code");
      case "/oauth/authorize/consent":
        return authorizeStep(c, "consent");
      case "/oauth/authorize/cancel":
        return authorizeStep(c, "cancel");
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
    async assistantUpdateSurfaces(personId, app) {
      const surfaces = new Set<AssistantKind>();
      const owners = new Map<string, boolean | undefined>();
      for (const { grant, client } of await store.assistantGrants(personId, now(), app)) {
        const assistant = localUpdateSurface(grant, client, now());
        if (!assistant || surfaces.has(assistant)) continue;
        if (!owners.has(grant.phoneKey)) owners.set(grant.phoneKey, await assistantGrantOwnerCurrent(grant));
        if (grant.expiresAt > now() && owners.get(grant.phoneKey)) surfaces.add(assistant);
      }
      return [...surfaces];
    },
    assistantUpdateSurfacesForClaim(candidates) {
      const surfaces = new Set<AssistantKind>();
      const at = now();
      for (const { grant, client } of candidates) {
        const assistant = localUpdateSurface(grant, client, at);
        if (assistant) surfaces.add(assistant);
      }
      return [...surfaces];
    },
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
    async forgetPerson(personId, app) {
      const removed = await store.forgetPerson(personId, app);
      const at = now();
      let revoked = 0;
      for (const grant of removed) {
        await reconcileAssistantSignal(grant);
        if (grant.revokedAt === null && grant.expiresAt > at) {
          revoked++;
          await store.audit({ at, kind: "consent_revoked", clientId: grant.clientId, grantId: grant.id, app: grant.app, detail: "account change" });
        }
      }
      return revoked;
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
