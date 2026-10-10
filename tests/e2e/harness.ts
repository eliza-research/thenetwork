// The whole platform in one process, wired as in production (docs/runbook-platform.md section 2):
//   four site servers (the built static files, and the production router code, deploy/router.ts, for
//   /api/*, /mcp, /oauth/* and /.well-known/oauth-*)  ->  the shared backend (deploy/backend
//   createBackend, the Network service, the platform API, the MCP server)  ->  Postgres (:54339, a
//   database of its own per test process, every migration applied).
// Nothing is sent: the channel adapter is dry-run and OTP codes come from a fake provider that keeps
// them. One SimClock drives the service, the router signatures, the backend's proxy check and the MCP
// server, so the tests can move time (OTP gaps, the daily engine run) and every signature check agrees.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimClock } from "../../packages/core/src/clock.ts";
import { createBackend, ipOf, loadConfig } from "../../deploy/backend/backend.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import type { McpHandler } from "../../packages/mcp/src/index.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { createServiceMcp } from "../../packages/network/service/serve.ts";
import { NetworkService, WEBHOOK_PATH } from "../../packages/network/service/service.ts";
import { type AppId, type AppInfo, DEFAULT_HOST_MAP } from "../../packages/platform/src/apps.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { LocalDiskPhotoStorage } from "../../packages/platform/src/photos.ts";
import { dropDb, migratedDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { signBlooioPayload } from "../../packages/blooio/src/blooio/webhook.ts";
import { serveSite } from "../../scripts/sites-dev.ts";
import { buildSite, SITES, type Site } from "../../sites/sites.ts";

export { pgAvailable };

export const PROXY_SECRET = "e2e-proxy-secret-0123456789abcdef0123456789abcdef";
export const WEBHOOK_SECRET = "whsec_e2e_shared";
export const ADMIN_TOKEN = "e2e-admin-token-0123456789abcdef";
/** The Eliza gateway's signing secret (SERVICE_TURN_SECRET): the tests sign /internal/turn and /internal/set-state as the gateway does. */
export const TURN_SECRET = "e2e-service-turn-secret-0123456789abcdef";
/** 9:30 in New York (EDT): inside the daily engine run window. */
export const START = Date.UTC(2026, 9, 8, 13, 30);

let phoneSeq = 0;
/** A fresh fictional number (555-01xx is reserved for fiction). */
export const newPhone = () => `+1212555${String(100 + ++phoneSeq).padStart(4, "0")}`;

/** Keeps every code it would have texted. */
export class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly sent: Array<{ e164: string; app: string; code: string }> = [];
  async send(e164: string, app: AppInfo) {
    const code = String(100000 + ((this.sent.length * 7919) % 900000));
    this.sent.push({ e164, app: app.id, code });
    return { code };
  }
  last(e164: string) { return [...this.sent].reverse().find(s => s.e164 === e164)?.code; }
}

/** A browser: one cookie jar for every 127.0.0.1 site (cookies are not port-scoped, as in a real browser). */
export class Browser {
  readonly jar = new Map<string, string>();
  header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  take(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i).trim(), v = pair!.slice(i + 1).trim();
      if (!v || /max-age=0\b/i.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
  }
}

export interface SiteHandle { site: Site; origin: string; port: number }

export interface Stack {
  url: string;
  clock: SimClock;
  svc: NetworkService;
  mcp: McpHandler;
  otp: FakeOtp;
  backendOrigin: string;
  sites: Record<AppId, SiteHandle>;
  /** A request to a site, as the browser at that site sends it (Origin on POST, the jar's cookies). */
  site(app: AppId, path: string, init?: RequestInit & { browser?: Browser; json?: unknown; form?: Record<string, string> }): Promise<Response>;
  /** A text on the shared line, through the backend's webhook (Blooio calls the backend, not a site). */
  text(from: string, body: string): Promise<string>;
  /** A staff call on the service (the staff port is private; the test calls the service directly). */
  staff(path: string, body: unknown): Promise<Response>;
  setPrivateOpenAiApps(apps: readonly AppId[]): Promise<void>;
  close(): Promise<void>;
}

let stackSequence = 0;

export async function startStack(o: { privateOpenAiApps?: readonly AppId[] } = {}): Promise<Stack> {
  const url = await migratedDb(`e2e_${++stackSequence}`);
  const photoDir = mkdtempSync(join(tmpdir(), "e2e-photos-"));
  const clock = new SimClock(START);
  const env = { PLATFORM_ENV: "dev", PLATFORM_PROXY_SECRET: PROXY_SECRET, SERVICE_TURN_SECRET: TURN_SECRET };
  const otp = new FakeOtp();
  // The platform's host map plus each local site origin (random ports), so a browser Origin of a site counts as that app's own.
  const hostMap: Record<string, AppId> = { ...DEFAULT_HOST_MAP };
  const svc = await NetworkService.fromDatabase({
    url, clock, env, instance: "e2e", tokens: `admin:${ADMIN_TOKEN}`, webhookSecret: WEBHOOK_SECRET,
    network: { seed: 1 }, log: () => {},
    // Every test browser is 127.0.0.1: the per-IP OTP limits (unit-tested in packages/platform) would stop the suite.
    publicApi: { otp, minStartMs: 0, minVerifyMs: 0, ipOf, hostMap, otpLimits: { perIpPerHour: 10_000, verifyPerIpPerHour: 10_000 } },
    adapter: () => new DryRunAdapter(() => {}),
    // Photos on (a local folder): the age gate is tested end to end, with an adult control.
    photoStorage: new LocalDiskPhotoStorage(photoDir),
  });
  await svc.start();

  const config = loadConfig({ ...env, DATABASE_URL: url, PORT: "0", BACKEND_STAFF: "off", MIGRATE_ON_BOOT: "0" });
  let mcp: McpHandler | undefined;
  const silent = { info() {}, warn() {}, error() {} };
  const backend = createBackend({
    svc, config, log: silent, ping: async () => true, now: () => clock.now(),
    mcp: async req => (mcp ? mcp.fetch(req) : undefined),
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req, s) => backend.publicFetch(req, s) });
  const backendOrigin = `http://127.0.0.1:${server.port}`;

  const dist = mkdtempSync(join(tmpdir(), "e2e-sites-"));
  const sites = {} as Record<AppId, SiteHandle>;
  const siteServers: Array<{ stop(force?: boolean): unknown }> = [];
  for (const s of SITES) {
    const outdir = join(dist, s.domain);
    const r = await buildSite(s, outdir, { ...process.env, BACKEND_ORIGIN: "", MCP_URL: "", TURNSTILE_SITE_KEY: "", DEPLOY_TARGET: "" });
    if (!r.ok) throw new Error(`build failed for ${s.domain}: ${r.logs.join("\n")}`);
    const up = serveSite(s, { port: 0, apiOrigin: backendOrigin, outdir, proxySecret: PROXY_SECRET, now: () => clock.now() });
    siteServers.push(up);
    sites[s.app] = { site: s, port: up.port!, origin: `http://127.0.0.1:${up.port}` };
    hostMap[`127.0.0.1:${up.port}`] = s.app;
  }
  const devOrigins = Object.fromEntries(Object.values(sites).map(h => [h.site.app, h.origin]));
  mcp = await createServiceMcp(svc, { env, databaseUrl: url, proxySecret: PROXY_SECRET, devOrigins, privateOpenAiApps: o.privateOpenAiApps, log: () => {} });
  if (!mcp) throw new Error("the MCP server did not start");

  let evt = 0;
  return {
    url, clock, svc, get mcp() { return mcp!; }, otp, backendOrigin, sites,
    async setPrivateOpenAiApps(apps) {
      const old = mcp;
      mcp = await createServiceMcp(svc, { env, databaseUrl: url, proxySecret: PROXY_SECRET, devOrigins, privateOpenAiApps: apps, migrate: false, log: () => {} });
      if (!mcp) throw new Error("the MCP server did not restart");
      await (old!.store as unknown as { close?(): Promise<void> }).close?.();
    },
    async site(app, path, init = {}) {
      const { browser, json, form, ...rest } = init;
      const h = sites[app];
      const headers = new Headers(rest.headers);
      if (browser?.jar.size) headers.set("cookie", browser.header());
      let body = rest.body;
      if (json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(json); }
      if (form) { headers.set("content-type", "application/x-www-form-urlencoded"); body = new URLSearchParams(form).toString(); }
      const method = rest.method ?? (body !== undefined ? "POST" : "GET");
      // As a browser sends them: fetch() from the page carries the site's Origin; an HTML form POST from a
      // page with Referrer-Policy: no-referrer (the MCP pages) carries "Origin: null" and Sec-Fetch-Site.
      if (method === "POST" && !headers.has("origin")) {
        if (form) { headers.set("origin", "null"); headers.set("sec-fetch-site", "same-origin"); }
        else headers.set("origin", h.origin);
      }
      const res = await fetch(`${h.origin}${path}`, { ...rest, method, headers, body, redirect: "manual" });
      browser?.take(res);
      return res;
    },
    async text(from, body) {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_e2e_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_e2e",
        data: { message_id: `msg_e2e_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await fetch(`${backendOrigin}${WEBHOOK_PATH}`, {
        method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(WEBHOOK_SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
      });
      if (res.status !== 200) throw new Error(`webhook answered ${res.status}: ${await res.text()}`);
      clock.advance(60_000);
      return ((await res.json()) as { result: string }).result;
    },
    staff(path, body) {
      return svc.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    },
    async close() {
      for (const s of siteServers) s.stop(true);
      await backend.shutdown([server]);
      await (mcp as unknown as { store: { close?(): Promise<void> } }).store.close?.().catch(() => {});
      rmSync(dist, { recursive: true, force: true });
      rmSync(photoDir, { recursive: true, force: true });
      await dropDb(url);
    },
  };
}

// ------------------------------------------------------------------ flows

/** Sign in on a site with a texted code (the fake provider's), as join.html does. Returns the session cookie name. */
export async function signIn(st: Stack, app: AppId, phone: string, b: Browser) {
  st.clock.advance(31_000); // the platform's 30 s gap between codes to one number
  const start = await st.site(app, "/api/auth/otp/start", { browser: b, json: { phone } });
  if (start.status !== 200) throw new Error(`otp/start on ${app}: ${start.status} ${await start.text()}`);
  const code = st.otp.last(phone);
  const verify = await st.site(app, "/api/auth/otp/verify", { browser: b, json: { phone, code } });
  if (verify.status !== 200) throw new Error(`otp/verify on ${app}: ${verify.status} ${await verify.text()}`);
  return `sid_${app}`;
}

/** The web join: sign in, then POST /api/join with the app's canonical opt-in version. */
export async function webJoin(st: Stack, app: AppId, phone: string, o: { age: number; firstName?: string; interests?: string[]; browser?: Browser }) {
  const b = o.browser ?? new Browser();
  await signIn(st, app, phone, b);
  const info = (await (await st.site(app, "/api/app")).json()) as { consent: { version: string } };
  const res = await st.site(app, "/api/join", {
    browser: b,
    json: { firstName: o.firstName ?? "Rae", age: o.age, consent: { sms: true, version: info.consent.version }, ...(o.interests ? { interests: o.interests } : {}) },
  });
  return { b, res, body: (await res.json()) as Record<string, any> };
}

export const VERIFIER = "e2e-verifier-" + "A1b2C3d4e5F6g7H8i9J0k-._~".repeat(2);
export const REDIRECT = "https://client.example/callback";

/** An MCP client's OAuth dance on one site, through the site router: register, authorize, sign in, approve, token. */
export async function connectMcp(st: Stack, app: AppId, phone: string, o: { browser?: Browser; path?: "/mcp" | "/mcp/openai"; redirect?: string } = {}) {
  const b = o.browser ?? new Browser();
  const redirect = o.redirect ?? REDIRECT;
  const reg = await st.site(app, "/oauth/register", { json: { client_name: "E2E Assistant", redirect_uris: [redirect], token_endpoint_auth_method: "none" } });
  const client = (await reg.json()) as Record<string, any>;
  if (reg.status !== 201 && reg.status !== 200) return { reg, client, token: undefined, html: "" };
  const resource = `${st.sites[app].origin}${o.path ?? "/mcp"}`;
  const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "e2e", resource });
  const page = await st.site(app, `/oauth/authorize?${q}`, { browser: b });
  let html = await page.text();
  const rid = /name="rid" value="([^"]+)"/.exec(html)?.[1];
  if (!rid) return { reg, client, token: undefined, html };
  if (!html.includes("Allow this assistant?")) {
    st.clock.advance(31_000);
    const p = await st.site(app, "/oauth/authorize/phone", { browser: b, form: { rid, phone } });
    html = await p.text();
    const c = await st.site(app, "/oauth/authorize/code", { browser: b, form: { rid, code: st.otp.last(phone) ?? "000000" } });
    html = await c.text();
    if (!html.includes("Allow this assistant?")) return { reg, client, token: undefined, html };
  }
  const done = await st.site(app, "/oauth/authorize/consent", { browser: b, form: { rid, decision: "approve" } });
  const loc = done.headers.get("location");
  const code = loc ? new URL(loc).searchParams.get("code") : null;
  if (!code) return { reg, client, token: undefined, html: await done.text() };
  const tok = await st.site(app, "/oauth/token", { form: { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: client.client_id, code_verifier: VERIFIER, resource } });
  return { reg, client, location: loc!, token: (await tok.json()) as Record<string, any>, html };
}

export const MCP_VERSION = "2026-07-28";

/** One MCP JSON-RPC call (2026-07-28 headers and _meta) on a site's /mcp or /mcp/openai. */
export async function rpc(st: Stack, app: AppId, path: string, method: string, params: Record<string, unknown> = {}, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_VERSION, "mcp-method": method };
  if (method === "tools/call") headers["mcp-name"] = String(params.name);
  if (token) headers.authorization = `Bearer ${token}`;
  const meta = { "io.modelcontextprotocol/protocolVersion": MCP_VERSION, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" } };
  const res = await st.site(app, path, { headers, json: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } } });
  const text = await res.text();
  return { res, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

/** The structured result of a tool call, or the error text. */
export function toolData(r: { body: Record<string, any> | null }): any {
  const result = r.body?.result;
  if (!result) return undefined;
  if (result.isError) return { error: result.content?.[0]?.text ?? "error" };
  return result.structuredContent;
}
