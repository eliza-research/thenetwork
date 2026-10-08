// The real platform (people store, OTP service, accounts, sessions) with a fake OTP provider that
// keeps the codes it would have texted. No network, no real phone numbers (555-01xx only).
import { Accounts, APPS, type AppInfo, MemoryPeopleStore, type OtpProvider, OtpService, SessionService } from "@thenetwork/platform";
import { createMcpHandler, type McpHandlerOptions } from "../src/handler.ts";
import { platformHooks, type PlatformHooks, type PlatformParts } from "../src/hooks.ts";
import type { McpAppId } from "../src/apps.ts";
import { MemoryOAuthStore, type OAuthStore } from "../src/store.ts";
import { pkceS256 } from "../src/util.ts";

export class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly sent: Array<{ e164: string; app: string; code: string }> = [];
  async send(e164: string, app: AppInfo) {
    const code = String(100000 + this.sent.length * 7919).slice(0, 6);
    this.sent.push({ e164, app: app.id, code });
    return { code };
  }
  last(e164: string) { return [...this.sent].reverse().find(s => s.e164 === e164)?.code; }
}

export const PHONE_A = "+12125550142";
export const PHONE_B = "+12125550143";
export const HASH_KEY = "test-hash-key";

export function setup(o: Partial<McpHandlerOptions> & { store?: OAuthStore; submitProfile?: PlatformParts["submitProfile"]; updates?: PlatformParts["updates"]; assistantLinked?: PlatformParts["assistantLinked"] } = {}) {
  const clock = { t: Date.UTC(2026, 9, 8, 12, 0, 0) };
  const now = () => clock.t;
  const people = new MemoryPeopleStore();
  const provider = new FakeOtp();
  const otp = new OtpService(people, provider, { hashKey: HASH_KEY, now });
  const appOf = (id: McpAppId) => (APPS as Record<string, AppInfo | undefined>)[id];
  const accounts = new Accounts(people, { hashKey: HASH_KEY, now, apps: id => (APPS as Record<string, AppInfo>)[id]! });
  const sessions = new SessionService(people, { secret: "test-session-secret", now });
  const logs: string[] = [];
  const store = o.store ?? new MemoryOAuthStore();
  const handler = createMcpHandler({
    platform: platformHooks({ store: people, otp, accounts, sessions, app: appOf, cookieName: id => `sid_${id}`, ...(o.submitProfile ? { submitProfile: o.submitProfile } : {}), ...(o.updates ? { updates: o.updates } : {}), ...(o.assistantLinked ? { assistantLinked: o.assistantLinked } : {}) }),
    store, now, minOtpStartMs: 0, log: s => logs.push(s), ...o,
  });
  const fetch = async (req: Request) => (await handler.fetch(req)) ?? new Response("not mine", { status: 418 });
  return { clock, people, provider, otp, accounts, sessions, handler, store, fetch, logs };
}
export type Env = ReturnType<typeof setup>;

export const origin = (domain: string) => `https://${domain}`;

let seq = 0;
export async function addMember(env: Env, e164: string, memberships: Array<{ app: string; state: "active" | "paused" | "invited" | "onboarding" | "restricted" }>, age = 30) {
  const id = `person_${e164.slice(-4)}_${++seq}`;
  await env.people.createPerson({ id, e164, method: "otp_sms", at: env.clock.t, lowestAge: age, phoneHash: env.accounts.phoneHash(e164) });
  for (const m of memberships) {
    await env.people.putMembership({ app: m.app as never, personId: id, memberId: `${m.app}_${id}`, state: m.state, review: null, firstName: "Rae", profile: {}, joinedAt: env.clock.t, leftAt: null });
  }
  return id;
}

export async function register(env: Env, domain: string, body: Record<string, unknown> = {}) {
  const res = await env.fetch(new Request(`${origin(domain)}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Test Assistant", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none", ...body }),
  }));
  return { res, body: (await res.json()) as Record<string, any> };
}

export const VERIFIER = "v".repeat(20) + "-._~" + "A1b2C3d4e5F6g7H8i9J0k";
export const CHALLENGE = pkceS256(VERIFIER);

const ridOf = (html: string) => /name="rid" value="([^"]+)"/.exec(html)?.[1];

export interface FlowOpts { scope?: string; redirectUri?: string; verifier?: string; resource?: string; state?: string; extraQuery?: Record<string, string>; deny?: boolean; cookie?: string }

/** The browser part: authorize, sign in with the texted code, approve. Returns the redirect Location. */
export async function browserFlow(env: Env, domain: string, clientId: string, phone: string, f: FlowOpts = {}) {
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: f.redirectUri ?? "https://client.example/callback",
    code_challenge: pkceS256(f.verifier ?? VERIFIER), code_challenge_method: "S256", state: f.state ?? "st-1",
    ...(f.scope !== undefined ? { scope: f.scope } : {}), ...(f.resource ? { resource: f.resource } : {}), ...f.extraQuery,
  });
  const start = await env.fetch(new Request(`${origin(domain)}/oauth/authorize?${q}`, { headers: f.cookie ? { cookie: f.cookie } : {} }));
  const html = await start.text();
  const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1];
  const rid = ridOf(html);
  if (!rid || !browser) return { start, html, location: null as string | null };
  const cookie = [browser, f.cookie].filter(Boolean).join("; ");
  const post = (path: string, form: Record<string, string>) => env.fetch(new Request(`${origin(domain)}${path}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin(domain) }, body: new URLSearchParams({ rid, ...form }).toString(),
  }));
  let siteCookie: string | null = null;
  if (!html.includes("Allow this assistant?")) {
    env.clock.t += 31_000; // the platform's 30 s gap between codes to one number
    const p = await post("/oauth/authorize/phone", { phone });
    if (p.status !== 200) return { start, html: await p.text(), location: null };
    const code = env.provider.last(phone);
    const c = await post("/oauth/authorize/code", { code: code ?? "000000" });
    siteCookie = c.headers.get("set-cookie");
    const ch = await c.text();
    if (!ch.includes("Allow this assistant?")) return { start, html: ch, location: null };
  }
  const done = await post("/oauth/authorize/consent", { decision: f.deny ? "deny" : "approve" });
  return { start, html, location: done.headers.get("location"), status: done.status, siteCookie };
}

export async function tokenRequest(env: Env, domain: string, form: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await env.fetch(new Request(`${origin(domain)}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(),
  }));
  return { res, body: (await res.json()) as Record<string, any> };
}

/** Register, sign in, approve and exchange the code: an access and a refresh token. */
export async function connect(env: Env, domain: string, phone: string, f: FlowOpts & { register?: Record<string, unknown> } = {}) {
  const reg = await register(env, domain, f.register);
  const flow = await browserFlow(env, domain, reg.body.client_id, phone, f);
  const code = flow.location ? new URL(flow.location).searchParams.get("code") : null;
  if (!code) throw new Error(`no code: ${flow.html.slice(0, 300)}`);
  const tok = await tokenRequest(env, domain, {
    grant_type: "authorization_code", code, redirect_uri: f.redirectUri ?? "https://client.example/callback", client_id: reg.body.client_id, code_verifier: f.verifier ?? VERIFIER,
    ...(f.resource ? { resource: f.resource } : {}),
  });
  return { client: reg.body, flow, code, token: tok.body, tokenRes: tok.res };
}

export const MODERN = "2026-07-28";

/** One MCP request over Streamable HTTP. modern: 2026-07-28 headers and _meta; legacy: plain JSON-RPC. */
export async function rpc(env: Env, url: string, method: string, params: Record<string, unknown> = {}, o: { token?: string; modern?: boolean; headers?: Record<string, string>; id?: number | null } = {}) {
  const modern = o.modern ?? true;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params: modern ? { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } } } : params };
  if (o.id !== null) body.id = o.id ?? 1;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (modern) {
    headers["mcp-protocol-version"] = MODERN;
    headers["mcp-method"] = method;
    if (method === "tools/call") headers["mcp-name"] = String(params.name);
  }
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  const res = await env.fetch(new Request(url, { method: "POST", headers: { ...headers, ...o.headers }, body: JSON.stringify(body) }));
  const text = await res.text();
  return { res, text, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

export const call = (env: Env, url: string, name: string, args: Record<string, unknown> = {}, o: { token?: string; modern?: boolean } = {}) =>
  rpc(env, url, "tools/call", { name, arguments: args }, o);
