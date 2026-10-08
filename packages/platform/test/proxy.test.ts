// The trusted proxy (founder decision 2026-10-08: Cloudflare Worker routers in front of one backend).
// A site router signs the client IP and its host (proxy.ts); the backend trusts them only with a
// valid signature under 60 s old, and otherwise uses the socket address and its own Host map
// (PLAT-18, PLAT-19 in small). End to end: routeSiteRequest -> a local Bun server -> createPublicApi.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicApi } from "../src/api.ts";
import { PROXY_HEADERS, proxySignature, routeSiteRequest, signProxyHeaders, verifyProxyHeaders } from "../src/proxy.ts";
import { MemoryPeopleStore } from "../src/store.ts";

const SECRET = "p".repeat(40);
const nowS = () => Math.floor(Date.now() / 1000);

describe("signing", () => {
  test("a signature verifies for the same request only; a stale, a future, a tampered or an unsigned one does not", async () => {
    const facts = { method: "POST", path: "/api/auth/otp/start", host: "slop.date", ip: "203.0.113.5" };
    const req = async (h: Record<string, string>, path = facts.path, method = "POST") => new Request(`http://127.0.0.1:8790${path}`, { method, headers: h });
    const t = nowS();
    const good = await signProxyHeaders(SECRET, { ...facts, ts: t });
    expect(await verifyProxyHeaders(await req(good), SECRET, t)).toEqual({ ip: "203.0.113.5", host: "slop.date" });
    expect(await verifyProxyHeaders(await req(good), SECRET, t + 61)).toBeUndefined(); // stale
    expect(await verifyProxyHeaders(await req(good), SECRET, t - 61)).toBeUndefined(); // from the future
    expect(await verifyProxyHeaders(await req(good), "another-secret-of-forty-characters-xxxx", t)).toBeUndefined();
    expect(await verifyProxyHeaders(await req(good), undefined, t)).toBeUndefined();
    expect(await verifyProxyHeaders(await req(good, "/api/me/delete"), SECRET, t)).toBeUndefined(); // another path
    expect(await verifyProxyHeaders(await req(good, facts.path, "GET"), SECRET, t)).toBeUndefined(); // another method
    expect(await verifyProxyHeaders(await req({ ...good, [PROXY_HEADERS.ip]: "10.0.0.1" }), SECRET, t)).toBeUndefined(); // another IP
    expect(await verifyProxyHeaders(await req({ ...good, [PROXY_HEADERS.host]: "peon.biz" }), SECRET, t)).toBeUndefined(); // another host
    expect(await verifyProxyHeaders(await req({}), SECRET, t)).toBeUndefined();
    // The signature is plain HMAC-SHA256 over the documented fields (routers in another language can make it).
    const { createHmac } = await import("node:crypto");
    const want = createHmac("sha256", SECRET).update(["v1", "POST", facts.path, "slop.date", facts.ip, String(t)].join("\n")).digest("base64url");
    expect(await proxySignature(SECRET, { ...facts, ts: t })).toBe(want);
  });
});

describe("a site router in front of the backend", () => {
  let server: ReturnType<typeof Bun.serve>;
  let sent = 0;
  const assets = { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`) };
  beforeAll(() => {
    const api = createPublicApi({
      store: new MemoryPeopleStore(), otp: { name: "fake", send: async () => { sent++; return { code: "123456" }; } },
      env: { PLATFORM_ENV: "staging" }, hashKey: "h".repeat(40), sessionSecret: "s".repeat(40), proxySecret: SECRET,
      turnstile: { verify: async () => true }, minStartMs: 0, minVerifyMs: 0, log: () => {},
    });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req, srv) => (await api.fetch(req, srv)) ?? new Response("not found", { status: 404 }) });
  });
  afterAll(() => server?.stop(true));
  const env = () => ({ API_ORIGIN: `http://127.0.0.1:${server.port}`, PROXY_SECRET: SECRET, ASSETS: assets });
  let n = 0;
  const phone = () => `+1212555${String(100 + ++n).padStart(4, "0")}`;
  const visit = (site: string, path: string, init: RequestInit & { ip: string; headers?: Record<string, string> }) =>
    routeSiteRequest(new Request(`https://${site}${path}`, { ...init, headers: { "cf-connecting-ip": init.ip, ...(init.headers ?? {}) } }), env());

  test("the router forwards /api, /mcp, /oauth and /.well-known/oauth-* and serves the rest as assets", async () => {
    expect(await (await visit("slop.date", "/join", { ip: "198.51.100.1" })).text()).toBe("asset /join");
    expect(await (await visit("slop.date", "/.well-known/agent-skills/index.json", { ip: "198.51.100.1" })).text()).toBe("asset /.well-known/agent-skills/index.json");
    expect(await (await visit("slop.date", "/api/app", { ip: "198.51.100.1" })).json()).toMatchObject({ id: "slop" });
    expect(await (await visit("peon.biz", "/api/app", { ip: "198.51.100.1" })).json()).toMatchObject({ id: "peon" });
  });

  test("the signed host picks the app; a client's own X-Forwarded-Host or proxy headers change nothing", async () => {
    const spoof = { "x-forwarded-host": "slop.date", [PROXY_HEADERS.host]: "slop.date", [PROXY_HEADERS.ip]: "1.2.3.4", [PROXY_HEADERS.ts]: String(nowS()), [PROXY_HEADERS.sig]: "forged" };
    expect(await (await visit("peon.biz", "/api/app", { ip: "198.51.100.2", headers: spoof })).json()).toMatchObject({ id: "peon" });
    // Straight to the origin with no valid signature: the Host is the origin's own name, which is no app.
    const direct = await fetch(`http://127.0.0.1:${server.port}/api/app`, { headers: spoof });
    expect(direct.status).toBe(404);
    // A signature older than 60 s is not trusted either.
    const old = await signProxyHeaders(SECRET, { method: "GET", path: "/api/app", host: "slop.date", ip: "1.2.3.4", ts: nowS() - 120 });
    expect((await fetch(`http://127.0.0.1:${server.port}/api/app`, { headers: old })).status).toBe(404);
  });

  test("OTP limits key on the visitor IP the router signed: one visitor hits the limit, another does not; spoofed headers make no new bucket", async () => {
    sent = 0;
    const start = (ip: string, headers: Record<string, string> = {}) =>
      visit("slop.date", "/api/auth/otp/start", { ip, method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ phone: phone() }) }).then(r => r.status);
    const a: number[] = [];
    for (let i = 0; i < 11; i++) a.push(await start("203.0.113.10", { "x-forwarded-for": `10.9.0.${i}`, "x-real-ip": `10.8.0.${i}` }));
    expect(a).toEqual([...Array(10).fill(200), 429]);
    expect(await start("203.0.113.11")).toBe(200);
    expect(sent).toBe(11);
    // 50 direct calls to the origin with forged headers share the socket bucket: at most 10 sends.
    sent = 0;
    const direct: number[] = [];
    for (let i = 0; i < 50; i++) {
      const forged = await signProxyHeaders("wrong-secret-wrong-secret-wrong-secret-xx", { method: "POST", path: "/api/auth/otp/start", host: "slop.date", ip: `10.7.${i}.1` });
      direct.push((await fetch(`http://127.0.0.1:${server.port}/api/auth/otp/start`, { method: "POST", headers: { host: "slop.date", "content-type": "application/json", ...forged, "x-forwarded-for": `10.6.${i}.1` }, body: JSON.stringify({ phone: phone() }) })).status);
    }
    expect(sent).toBeLessThanOrEqual(10);
    expect(direct.filter(s => s === 429).length).toBeGreaterThanOrEqual(40);
  });
});
