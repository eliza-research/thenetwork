// Staff ban must revoke live MCP grants. The ban is the staff route (POST /safety/ban),
// and the expected admission is the generated OAuth grant policy (spec/oauthGrantIssuance.md).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MINUTE, SimClock } from "../../core/src/clock.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import {
  alwaysIssuanceRequiresCurrentApproval,
  initial,
  sometimesIssuesGrant,
  step,
  validConsumption,
  type AuthorityResult,
  type Issuance,
} from "../../core/src/generated/oauthGrantIssuance.ts";
import { DryRunAdapter } from "../../network/service/channel.ts";
import { createServiceMcp } from "../../network/service/serve.ts";
import { NetworkService, WEBHOOK_PATH } from "../../network/service/service.ts";
import type { McpHandler } from "../src/handler.ts";
import { pkceS256 } from "../src/util.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";

if (process.env.REQUIRE_PG === "1" && !pgAvailable) throw new Error("Postgres required");

const SECRET = "whsec_ban_mcp";
const VERIFIER = "v".repeat(20) + "-._~" + "A1b2C3d4e5F6g7H8i9J0k";
const REDIRECT = "https://client.example/callback";
const MODERN = "2026-07-28";
const T = 120_000;

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) {
    this.sent++;
    const code = String(100000 + this.sent * 7919).slice(0, 6);
    this.codes.set(e164, code);
    return { code };
  }
}

/** The generated issuance policy. A staff ban is invalid authority, so no grant is issued. */
function admit(authority: AuthorityResult): Issuance {
  const began = step(initial, { type: "beginApproval", requestLive: true });
  const checked = step(began, { type: "checkGrantAuthority", authority });
  if (checked.phase !== "AwaitingConsumption") return checked;
  const consumed = step(checked, { type: "checkConsumption", consumption: validConsumption });
  return step(consumed, { type: "recordIssuance" });
}

describe.skipIf(!pgAvailable)("staff ban revokes MCP OAuth grants (Postgres)", () => {
  let url = "";
  const open: NetworkService[] = [];
  let evt = 0;
  let phoneN = 60;

  beforeAll(async () => { url = await migratedDb("ban_mcp"); }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => { if (url) await dropDb(url); });

  const phone = () => `+121255501${String(++phoneN).padStart(2, "0")}`;

  function start(clock: SimClock) {
    const otp = new FakeOtp();
    const s = new NetworkService({
      url, clock, instance: "ban-mcp", log: () => {}, env: { PLATFORM_ENV: "dev" },
      networks: [{ id: "peon:nyc" }, { id: "slop:nyc" }],
      tokens: "safety:saf-tok", webhookSecret: SECRET, network: { seed: 1 },
      publicApi: { otp, minStartMs: 0, minVerifyMs: 0 }, photoStorage: null,
      adapter: () => new DryRunAdapter(() => {}),
    });
    open.push(s);
    return { s, otp };
  }

  async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
    const n = ++evt;
    const raw = JSON.stringify({
      id: `evt_ban_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
      data: { message_id: `msg_ban_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" },
    });
    const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) },
      body: raw,
    }));
    expect(res.status).toBe(200);
    clock.advance(MINUTE);
    return (await res.json() as { result: string }).result;
  }

  async function join(s: NetworkService, clock: SimClock, from: string, word: string, name: string) {
    expect(await text(s, clock, from, word)).toBe("join_asked");
    expect(await text(s, clock, from, `${name}, 30`)).toBe("joined");
  }

  async function memberId(s: NetworkService, app: string, e164: string) {
    const [row] = (await s.sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`) as Array<{ id: string }>;
    if (!row) throw new Error(`no ${app} member for ${e164}`);
    return row.id;
  }

  function staffBan(s: NetworkService, app: string, memberId: string, by: "phone" | "person") {
    return s.fetch(new Request(`http://127.0.0.1:4848/apps/${app}/safety/ban`, {
      method: "POST",
      headers: { authorization: "Bearer saf-tok", "content-type": "application/json" },
      body: JSON.stringify({ memberId, by, note: "confirmed by staff" }),
    }));
  }

  async function connect(mcp: McpHandler, otp: FakeOtp, clock: SimClock, domain: string, e164: string) {
    const origin = `https://${domain}`;
    const fetch = async (req: Request) => (await mcp.fetch(req)) ?? new Response("not mine", { status: 418 });
    const reg = await fetch(new Request(`${origin}/oauth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Test Assistant", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
    }));
    const client = await reg.json() as { client_id: string };
    expect(reg.status).toBe(201);
    const q = new URLSearchParams({
      response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT,
      code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "st-1",
    });
    const jar = new Map<string, string>();
    const startRes = await fetch(new Request(`${origin}/oauth/authorize?${q}`));
    takeCookies(jar, startRes);
    const html = await startRes.text();
    const rid = /name="rid" value="([^"]+)"/.exec(html)?.[1];
    const hasBrowser = jar.has("__Host-mcp_auth") || jar.has("mcp_auth");
    if (!rid || !hasBrowser) throw new Error(`authorize did not start: ${startRes.status} ${html.slice(0, 180)}`);
    const post = async (path: string, form: Record<string, string>) => {
      const res = await fetch(new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar), origin },
        body: new URLSearchParams({ rid, ...form }).toString(),
      }));
      takeCookies(jar, res);
      return res;
    };
    clock.advance(31_000);
    const phoneRes = await post("/oauth/authorize/phone", { phone: e164 });
    expect(phoneRes.status).toBe(200);
    const code = otp.codes.get(e164);
    if (!code) throw new Error("the authorize page did not send a code");
    const verified = await post("/oauth/authorize/code", { code });
    expect(verified.status).toBe(200);
    const done = await post("/oauth/authorize/consent", { decision: "approve" });
    const loc = done.headers.get("location");
    const authCode = loc ? new URL(loc).searchParams.get("code") : null;
    if (!authCode) throw new Error(`consent did not issue a code: ${done.status} ${(await done.text()).slice(0, 180)}`);
    const tokRes = await fetch(new Request(`${origin}/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: authCode, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: VERIFIER }).toString(),
    }));
    const token = await tokRes.json() as { access_token?: string; refresh_token?: string; error?: string };
    expect(tokRes.status).toBe(200);
    return { client, token, fetch, origin };
  }

  async function status(conn: Awaited<ReturnType<typeof connect>>, appPath = "/mcp") {
    return rpc(conn, `${conn.origin}${appPath}`, "tools/call", { name: "check_status", arguments: {} }, conn.token.access_token);
  }

  async function refresh(conn: Awaited<ReturnType<typeof connect>>) {
    const res = await conn.fetch(new Request(`${conn.origin}/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.token.refresh_token!, client_id: conn.client.client_id }).toString(),
    }));
    return { status: res.status, body: await res.json() as { error?: string; access_token?: string } };
  }

  test("the staff ban route clears live grants; use and refresh follow the grant policy", async () => {
    const issued = admit("AuthorityValid");
    const refused = admit("AuthorityInvalid");
    expect(issued.phase).toBe("GrantIssued");
    expect(sometimesIssuesGrant(issued)).toBe(true);
    expect(alwaysIssuanceRequiresCurrentApproval(issued)).toBe(true);
    expect(refused.phase).toBe("DeniedAuthority");
    expect(sometimesIssuesGrant(refused)).toBe(false);
    expect(alwaysIssuanceRequiresCurrentApproval(refused)).toBe(true);

    const clock = new SimClock(Date.UTC(2026, 9, 5, 17));
    const { s, otp } = start(clock);
    const mcp = await createServiceMcp(s, { env: { PLATFORM_ENV: "dev" }, now: () => clock.now(), log: () => {} });
    if (!mcp) throw new Error("MCP server did not start");
    const rae = phone(), ben = phone();
    await join(s, clock, rae, "peon", "Rae");
    await join(s, clock, rae, "slop", "Rae");
    await join(s, clock, ben, "peon", "Ben");
    const raeKey = s.accounts.phoneHash(rae);
    const [stored] = (await s.sql`select phone_hash from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${rae}`) as Array<{ phone_hash: string }>;
    expect(stored!.phone_hash).toBe(raeKey);

    const peon = await connect(mcp, otp, clock, "peon.biz", rae);
    const slop = await connect(mcp, otp, clock, "slop.date", rae);
    const control = await connect(mcp, otp, clock, "peon.biz", ben);
    expect((await status(peon)).status).toBe(200);
    expect((await status(slop)).status).toBe(200);
    expect((await status(control)).status).toBe(200);
    expect(await mcp.store.grantsFor(raeKey, "peon", clock.now())).toHaveLength(1);
    expect(await mcp.store.grantsFor(raeKey, "slop", clock.now())).toHaveLength(1);

    const banned = await staffBan(s, "peon", await memberId(s, "peon", rae), "person");
    expect(banned.status).toBe(200);
    expect(await banned.json()).toEqual({ ok: true });

    // AuthorityInvalid issues nothing. The route must match that: no live grant, bearer refused, refresh refused.
    expect(await mcp.store.grantsFor(raeKey, "peon", clock.now())).toEqual([]);
    expect(await mcp.store.grantsFor(raeKey, "slop", clock.now())).toEqual([]);
    expect((await status(peon)).status).toBe(401);
    expect((await status(slop)).status).toBe(401);
    const peonRefresh = await refresh(peon);
    const slopRefresh = await refresh(slop);
    expect(peonRefresh.status).toBe(400);
    expect(peonRefresh.body.error).toBe("invalid_grant");
    expect(slopRefresh.status).toBe(400);
    expect(slopRefresh.body.error).toBe("invalid_grant");
    const audits = await mcp.store.auditRows();
    expect(audits.filter(row => row.kind === "consent_revoked" && row.detail === "staff ban")).toHaveLength(2);

    // A neighbour stays on the AuthorityValid path.
    expect(await mcp.store.grantsFor(s.accounts.phoneHash(ben), "peon", clock.now())).toHaveLength(1);
    expect((await status(control)).status).toBe(200);
    const controlRefresh = await refresh(control);
    expect(controlRefresh.status).toBe(200);
    expect(typeof controlRefresh.body.access_token).toBe("string");
  }, T);

  test("a revoke failure fails the staff ban, and a later ban finishes the revoke", async () => {
    const refused = admit("AuthorityInvalid");
    expect(refused.phase).toBe("DeniedAuthority");
    expect(sometimesIssuesGrant(refused)).toBe(false);

    const clock = new SimClock(Date.UTC(2026, 9, 5, 17));
    const { s, otp } = start(clock);
    let fail = true;
    s.onBan(async () => { if (fail) { fail = false; throw new Error("grant revoke failed"); } });
    const mcp = await createServiceMcp(s, { env: { PLATFORM_ENV: "dev" }, now: () => clock.now(), log: () => {} });
    if (!mcp) throw new Error("MCP server did not start");
    const cam = phone();
    await join(s, clock, cam, "peon", "Cam");
    const conn = await connect(mcp, otp, clock, "peon.biz", cam);
    const key = s.accounts.phoneHash(cam);
    expect((await status(conn)).status).toBe(200);

    const first = await staffBan(s, "peon", await memberId(s, "peon", cam), "phone");
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ ok: false, error: "internal_error" });
    expect(await mcp.store.grantsFor(key, "peon", clock.now())).toHaveLength(1);
    expect((await status(conn)).status).toBe(200);

    const second = await staffBan(s, "peon", await memberId(s, "peon", cam), "phone");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ ok: false, reason: "already_banned" });
    expect(await mcp.store.grantsFor(key, "peon", clock.now())).toEqual([]);
    expect((await status(conn)).status).toBe(401);
    const again = await refresh(conn);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
    expect((await mcp.store.auditRows()).some(row => row.kind === "consent_revoked" && row.detail === "staff ban")).toBe(true);
  }, T);
});

function takeCookies(jar: Map<string, string>, res: Response) {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value && !/max-age=0/i.test(header)) jar.set(name, value);
    else jar.delete(name);
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function rpc(conn: { fetch: (req: Request) => Promise<Response> }, url: string, method: string, params: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": MODERN, "mcp-method": method,
  };
  if (method === "tools/call") headers["mcp-name"] = String((params as { name?: string }).name);
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await conn.fetch(new Request(url, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method,
      params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } } },
    }),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
