// The site router's fetch handler with a fake env and a fake fetch (no Miniflare, no network):
// which paths go to the backend, which headers it strips and signs, and that the rest are assets.
//   bun test deploy
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PROXY_HEADERS, proxySignature, verifyProxyHeaders } from "../packages/platform/src/proxy.ts";
import { handle, isBackendPath, MAX_BODY_BYTES, RUN_WORKER_FIRST, UNKNOWN_IP, type Env } from "./router.ts";

const SECRET = "test-proxy-secret";
const NOW = Date.UTC(2026, 9, 8, 15, 0, 0);

interface Seen { url: string; method: string; headers: Record<string, string>; body: string }

function setup(over: Partial<Env> = {}) {
  const seen: Seen[] = [];
  const assets: string[] = [];
  const env: Env = {
    ASSETS: { fetch: async (r) => { assets.push(new URL(r.url).pathname); return new Response("asset", { status: 200, headers: { "content-type": "text/html" } }); } },
    BACKEND_ORIGIN: "https://api.example.test",
    APP_ID: "slop",
    SITE_HOST: "slop.date",
    PLATFORM_PROXY_SECRET: SECRET,
    ...over,
  };
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = init.body ? new TextDecoder().decode(init.body as ArrayBuffer) : "";
    seen.push({ url, method: init.method ?? "GET", headers, body });
    const res = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    res.headers.append("set-cookie", "__Host-sid=a; Path=/; HttpOnly; Secure");
    res.headers.append("set-cookie", "other=b; Path=/");
    return res;
  }) as unknown as typeof fetch;
  const run = (path: string, init: RequestInit = {}) => handle(new Request(`https://slop.date${path}`, init), env, fakeFetch, () => NOW);
  return { env, seen, assets, run };
}

const TS = Math.floor(NOW / 1000);
const sig = (method: string, path: string, ip: string, secret = SECRET) => proxySignature(secret, { method, path, host: "slop.date", ip, ts: TS });

describe("which paths reach the backend", () => {
  const backend = ["/api", "/api/app", "/api/auth/otp/start", "/mcp", "/mcp/", "/oauth/authorize", "/oauth/token", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"];
  const assets = ["/", "/join", "/SKILL.md", "/.well-known/agent-skills/index.json", "/apiary", "/api.html", "/mcpx", "/oauth", "/.well-known/openai-apps-challenge", "/styles.css"];

  test.each(backend)("%s is forwarded", async (p) => {
    const { seen, assets: a, run } = setup();
    const res = await run(p);
    expect(res.status).toBe(200);
    expect(seen.length).toBe(1);
    expect(seen[0]!.url).toBe(`https://api.example.test${p}`);
    expect(a).toEqual([]);
  });

  test.each(assets)("%s is a static asset", async (p) => {
    const { seen, assets: a, run } = setup();
    const res = await run(p);
    expect(await res.text()).toBe("asset");
    expect(seen).toEqual([]);
    expect(a).toEqual([p]);
  });

  test("every site is a Pages project whose build runs this router only on the backend paths (founder decision 8)", async () => {
    const { SITES, routesFile } = await import("../sites/sites.ts");
    expect(JSON.parse(routesFile())).toEqual({ version: 1, include: RUN_WORKER_FIRST, exclude: [] });
    // The built _worker.js exports only the default handler (workerd refuses any other named export:
    // "Incorrect type for map entry 'MAX_BODY_BYTES'" under wrangler pages dev, before the fix).
    const { ROUTER } = await import("../sites/sites.ts");
    const built = await Bun.build({ entrypoints: [ROUTER], target: "browser", format: "esm", minify: true });
    const code = await built.outputs[0]!.text();
    expect([...code.matchAll(/export\s*\{([^}]*)\}/g)].map(m => m[1]!.split(",").map(x => x.trim().split(/\s+as\s+/).at(-1))).flat()).toEqual(["default"]);
    for (const s of SITES) {
      const toml = (await import(join(import.meta.dir, "../sites", s.domain, "wrangler.toml"))).default as { name: string; pages_build_output_dir: string; main?: string; assets?: unknown; routes?: unknown; account_id?: string; vars: Record<string, string> };
      expect(toml.name, s.domain).toBe(s.project);
      expect(toml.pages_build_output_dir, s.domain).toBe("./dist");
      // A Workers config (main, [assets], custom-domain routes) would deploy a Worker, not the Pages project.
      expect([toml.main, toml.assets, toml.routes, toml.account_id], s.domain).toEqual([undefined, undefined, undefined, undefined]);
      expect(toml.vars.SITE_HOST, s.domain).toBe(s.domain);
      expect(toml.vars.APP_ID, s.domain).toBe(s.app);
      expect(toml.vars.BACKEND_ORIGIN, s.domain).toBe("https://api.ntwrk.love");
      expect("PLATFORM_PROXY_SECRET" in toml.vars, `${s.domain} must not hold the secret`).toBe(false);
    }
    // Each pattern, read as Cloudflare does (trailing * = prefix), matches isBackendPath.
    for (const pat of RUN_WORKER_FIRST) {
      const sample = pat.endsWith("*") ? pat.slice(0, -1) + "x" : pat;
      expect(isBackendPath(sample), pat).toBe(true);
    }
  });
});

describe("the built Pages _worker.js", () => {
  test("carries its site's APP_ID, SITE_HOST and BACKEND_ORIGIN, so it forwards without project variables; a variable still wins", async () => {
    // Under wrangler pages dev (and a project without wrangler.toml variables) env had only the secret:
    // before the fix every backend path answered 503 proxy_not_configured.
    const { buildSite, SITES } = await import("../sites/sites.ts");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "pages-worker-"));
    try {
      const slop = SITES.find(x => x.app === "slop")!;
      expect((await buildSite(slop, dir, { ...process.env, BACKEND_ORIGIN: "", MCP_URL: "" })).ok).toBe(true);
      const worker = (await import(join(dir, "_worker.js"))).default as { fetch(r: Request, e: Partial<Env>): Promise<Response> };
      const seen: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string, init: RequestInit) => { seen.push(`${url} ${new Headers(init.headers).get("x-network-proxy-host")}`); return new Response("{}"); }) as typeof fetch;
      try {
        const assets = { fetch: async () => new Response("asset") };
        await worker.fetch(new Request("https://slop-date.pages.dev/api/app"), { ASSETS: assets, PLATFORM_PROXY_SECRET: SECRET });
        await worker.fetch(new Request("https://slop-date.pages.dev/api/app"), { ASSETS: assets, PLATFORM_PROXY_SECRET: SECRET, BACKEND_ORIGIN: "https://staging.example" });
      } finally { globalThis.fetch = realFetch; }
      expect(seen).toEqual(["https://api.ntwrk.love/api/app slop.date", "https://staging.example/api/app slop.date"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("body size", () => {
  test("a body over 9 MB is refused unread (413); the backend never sees it", async () => {
    const { seen, run } = setup();
    const res = await run("/api/photos", { method: "POST", headers: { "content-type": "image/jpeg", "content-length": String(MAX_BODY_BYTES + 1) }, body: "x" });
    expect(res.status).toBe(413);
    expect(seen).toEqual([]);
  });

  test("a chunked body (no Content-Length) over 9 MB is cut off and refused too; a small one is forwarded whole", async () => {
    const { seen, run } = setup();
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({ pull(c) { pulled++; if (pulled > 20) c.close(); else c.enqueue(chunk); } });
    const res = await run("/api/photos", { method: "POST", headers: { "content-type": "image/jpeg" }, body: big, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(12); // abandoned just past the cap, never read to the end
    expect(seen).toEqual([]);
    const ok = await run("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: new Blob(['{"a":1}']).stream(), duplex: "half" } as RequestInit);
    expect(ok.status).toBe(200);
    expect(seen.at(-1)!.body).toBe('{"a":1}');
  });
});

describe("headers", () => {
  test("strips spoofed proxy and IP headers and signs v1, method, path with query, host, ip, ts (the one platform contract)", async () => {
    const { seen, run } = setup();
    await run("/api/auth/otp/start?x=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-sid=old",
        "cf-connecting-ip": "203.0.113.7",
        "x-network-proxy-ip": "6.6.6.6",
        "X-Network-Proxy-Host": "peon.biz",
        "x-network-proxy-sig": "forged",
        "x-network-proxy-ts": "1",
        "x-network-proxy-extra": "1",
        "x-ntwrk-proxy-ip": "6.6.6.6",
        "x-ntwrk-proxy-sig": "forged",
        "x-forwarded-for": "6.6.6.7",
        "x-forwarded-host": "peon.biz",
        "x-real-ip": "6.6.6.8",
        "true-client-ip": "6.6.6.9",
        forwarded: "for=6.6.6.10",
      },
      body: JSON.stringify({ phone: "+12125550123" }),
    });
    const s = seen[0]!;
    expect(s.url).toBe("https://api.example.test/api/auth/otp/start?x=1");
    expect(s.method).toBe("POST");
    expect(s.body).toBe(JSON.stringify({ phone: "+12125550123" }));
    expect(s.headers.cookie).toBe("__Host-sid=old");
    expect(s.headers["content-type"]).toBe("application/json");
    expect(s.headers[PROXY_HEADERS.ip]).toBe("203.0.113.7");
    expect(s.headers[PROXY_HEADERS.host]).toBe("slop.date");
    expect(s.headers[PROXY_HEADERS.ts]).toBe(String(TS));
    expect(s.headers[PROXY_HEADERS.sig]).toBe(await sig("POST", "/api/auth/otp/start?x=1", "203.0.113.7"));
    // Exactly the four platform headers: no second contract, no forwarding header the backend could be tempted to read.
    expect(Object.keys(s.headers).filter((k) => k.startsWith("x-network-proxy-") || k.startsWith("x-ntwrk-proxy-")).sort()).toEqual(Object.values(PROXY_HEADERS).sort());
    for (const k of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "true-client-ip", "forwarded", "cf-connecting-ip"]) expect(s.headers[k], k).toBeUndefined();
  });

  test("the backend's verifier (packages/platform proxy.ts) accepts what the router sends, and refuses a forgery", async () => {
    const { seen, run } = setup();
    await run("/api/me/export?x=1", { headers: { "cf-connecting-ip": "203.0.113.7", "x-network-proxy-ip": "6.6.6.6", "x-network-proxy-host": "peon.biz" } });
    const s = seen[0]!;
    const asBackend = (h: Record<string, string>, url = s.url) => new Request(url, { method: s.method, headers: h });
    expect(await verifyProxyHeaders(asBackend(s.headers), SECRET, TS)).toEqual({ ip: "203.0.113.7", host: "slop.date" });
    expect(await verifyProxyHeaders(asBackend({ ...s.headers, "x-network-proxy-host": "peon.biz" }), SECRET, TS)).toBeUndefined();
    expect(await verifyProxyHeaders(asBackend({ ...s.headers, "x-network-proxy-ip": "6.6.6.6" }), SECRET, TS)).toBeUndefined();
    expect(await verifyProxyHeaders(asBackend(s.headers, "https://api.example.test/api/me/export?x=2"), SECRET, TS)).toBeUndefined();
    expect(await verifyProxyHeaders(asBackend(s.headers), "wrong-secret", TS)).toBeUndefined();
  });

  test("a request with no CF-Connecting-IP signs 'unknown', which the backend's verifier still accepts", async () => {
    const { seen, run } = setup();
    await run("/api/app");
    const h = seen[0]!.headers;
    expect(h[PROXY_HEADERS.ip]).toBe(UNKNOWN_IP);
    expect(h[PROXY_HEADERS.sig]).toBe(await sig("GET", "/api/app", UNKNOWN_IP));
    expect(await verifyProxyHeaders(new Request(seen[0]!.url, { headers: h }), SECRET, TS)).toEqual({ ip: UNKNOWN_IP, host: "slop.date" });
  });

  test("a different secret gives a different signature (the backend can tell)", async () => {
    const { seen, run } = setup({ PLATFORM_PROXY_SECRET: "another" });
    await run("/api/app", { headers: { "cf-connecting-ip": "203.0.113.7" } });
    expect(seen[0]!.headers[PROXY_HEADERS.sig]).not.toBe(await sig("GET", "/api/app", "203.0.113.7"));
  });

  test("keeps every Set-Cookie from the backend and adds nosniff", async () => {
    const { run } = setup();
    const res = await run("/api/me");
    expect(res.headers.getSetCookie()).toEqual(["__Host-sid=a; Path=/; HttpOnly; Secure", "other=b; Path=/"]);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("fails closed", () => {
  test("no secret: 503 and nothing forwarded", async () => {
    const { seen, run } = setup({ PLATFORM_PROXY_SECRET: undefined });
    const res = await run("/api/app");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "proxy_not_configured" });
    expect(seen).toEqual([]);
  });

  test("backend down: 502 api_unreachable (the pages show their own message)", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: "slop", SITE_HOST: "slop.date", PLATFORM_PROXY_SECRET: SECRET };
    const res = await handle(new Request("https://slop.date/api/app"), env, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "api_unreachable" });
  });

  test("redirects from the backend pass through unfollowed (OAuth)", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: "ntwrk", SITE_HOST: "ntwrk.love", PLATFORM_PROXY_SECRET: SECRET };
    let redirect: RequestRedirect | undefined;
    const res = await handle(new Request("https://ntwrk.love/oauth/authorize?client_id=x"), env, (async (_u: string, init: RequestInit) => {
      redirect = init.redirect;
      return new Response(null, { status: 302, headers: { location: "https://client.example/cb?code=abc" } });
    }) as unknown as typeof fetch);
    expect(redirect).toBe("manual");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://client.example/cb?code=abc");
  });
});
