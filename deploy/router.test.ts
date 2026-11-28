// The site router's fetch handler with a fake env and a fake fetch (no Miniflare, no network):
// which paths go to the backend, which headers it strips and signs, and that the rest are assets.
//   pnpm exec vitest run deploy
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { build } from "esbuild";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { PROXY_HEADERS, proxySignature, verifyProxyHeaders } from "../packages/platform/src/proxy.ts";
import { handle, isBackendPath, MAX_BODY_BYTES, MAX_TELEMETRY_BODY_BYTES, RETIRED_SITE_PATHS, RETIRED_SIGNUP_PATHS, RUN_WORKER_FIRST, TELEMETRY_PATHS, UNKNOWN_IP, UPDATE_HANDOFF_PATHS, type Env, type ExecutionContextLike } from "./router.ts";

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
  const backend = ["/api", "/api/app", "/api/auth/otp/start", "/cal/eyJhIjoic2xvcCJ9.sig_123-abc.ics", "/mcp", "/mcp/", "/oauth/authorize", "/oauth/token", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"];
  const assets = ["/", "/SKILL.md", "/.well-known/agent-skills/index.json", "/apiary", "/api.html", "/cal", "/cal/", "/cal/x", "/cal/foo.txt", "/cal/.ics", "/cal/..ics", "/cal/a..b.ics", "/cal/sub/a.b.ics", "/cal/%2e%2e.ics", "/mcpx", "/oauth", "/.well-known/openai-apps-challenge", "/styles.css"];

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

  test("every site is a Pages project with the router mounted and all its sources in the deployment triggers", async () => {
    const { SITES, routesFile } = await import("../sites/sites.ts");
    expect(JSON.parse(routesFile())).toEqual({ version: 1, include: RUN_WORKER_FIRST, exclude: [] });
    // The built _worker.js exports only the default handler (workerd refuses any other named export:
    // "Incorrect type for map entry 'MAX_BODY_BYTES'" under wrangler pages dev, before the fix).
    const { ROUTER } = await import("../sites/sites.ts");
    const built = await build({ entryPoints: [ROUTER], bundle: true, write: false, platform: "browser", format: "esm", minify: true, metafile: true });
    const code = built.outputFiles[0]!.text;
    expect([...code.matchAll(/export\s*\{([^}]*)\}/g)].map(m => m[1]!.split(",").map(x => x.trim().split(/\s+as\s+/).at(-1))).flat()).toEqual(["default"]);
    const workflow = parseYaml(readFileSync(join(import.meta.dirname, "../.github/workflows/deploy-sites.yml"), "utf8")) as { on: Record<string, { paths: string[] }> };
    const sources = Object.keys(built.metafile!.inputs).filter(input => !input.startsWith("node_modules/"));
    expect(sources).toContain("deploy/pages-worker.ts");
    for (const trigger of ["push", "pull_request"]) {
      const paths = workflow.on[trigger]!.paths;
      expect(sources.filter(file => !paths.some(pattern => posix.matchesGlob(file, pattern))).sort(), trigger).toEqual([]);
    }
    for (const s of SITES) {
      const toml = parseToml(readFileSync(join(import.meta.dirname, "../sites", s.domain, "wrangler.toml"), "utf8")) as { name: string; pages_build_output_dir: string; main?: string; assets?: unknown; routes?: unknown; account_id?: string; vars: Record<string, string> };
      expect(toml.name, s.domain).toBe(s.project);
      expect(toml.pages_build_output_dir, s.domain).toBe("./dist");
      // A Workers config (main, [assets], custom-domain routes) would deploy a Worker, not the Pages project.
      expect([toml.main, toml.assets, toml.routes, toml.account_id], s.domain).toEqual([undefined, undefined, undefined, undefined]);
      expect(toml.vars.SITE_HOST, s.domain).toBe(s.domain);
      expect(toml.vars.APP_ID, s.domain).toBe(s.app);
      expect(toml.vars.BACKEND_ORIGIN, s.domain).toBe("https://api.ntwrk.party");
      expect("PLATFORM_PROXY_SECRET" in toml.vars, `${s.domain} must not hold the secret`).toBe(false);
    }
    // Backend patterns forward. Local routing also requires the Worker.
    for (const pat of RUN_WORKER_FIRST) {
      const sample = pat === "/cal/*" ? "/cal/body.sig.ics" : pat.endsWith("*") ? pat.slice(0, -1) + "x" : pat;
      expect(isBackendPath(sample), pat).toBe(![...RETIRED_SITE_PATHS, ...RETIRED_SIGNUP_PATHS, ...UPDATE_HANDOFF_PATHS, ...TELEMETRY_PATHS].includes(pat));
    }
  });

  test("calendar .ics links forward with signed proxy headers while path traversal and non-.ics /cal/* paths never reach the backend", async () => {
    const { seen, assets: a, run } = setup();
    const calPath = "/cal/eyJhIjoic2xvcCJ9.AbC_123-xyz.ics";
    const res = await run(calPath, {
      headers: { "cf-connecting-ip": "203.0.113.7", "x-network-proxy-host": "peon.biz", "x-forwarded-for": "6.6.6.6" },
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`https://api.example.test${calPath}`);
    expect(await verifyProxyHeaders(new Request(seen[0]!.url, { headers: seen[0]!.headers }), SECRET, TS)).toEqual({
      ip: "203.0.113.7",
      host: "slop.date",
    });
    expect(a).toEqual([]);

    for (const bad of ["/cal/..", "/cal/../api/app.ics", "/cal/%2e%2e/api/app.ics", "/cal/%2e%2e.ics", "/cal/..ics", "/cal/a..b.ics", "/cal/token.txt", "/cal/sub/a.b.ics", "/cal/"]) {
      expect(isBackendPath(bad), bad).toBe(false);
    }
    const before = seen.length;
    for (const bad of ["/cal/..", "/cal/../secret.ics", "/cal/%2e%2e/secret.ics", "/cal/%2e%2e.ics", "/cal/..ics", "/cal/a..b.ics", "/cal/token.txt"]) {
      const r = await run(bad);
      expect(await r.text(), bad).toBe("asset");
    }
    expect(seen).toHaveLength(before);
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
      expect(seen).toEqual(["https://api.ntwrk.party/api/app slop.date", "https://staging.example/api/app slop.date"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the hub worker renders an update handoff with its built static page", async () => {
    const { buildSite, PAGE_FILES, site } = await import("../sites/sites.ts");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "pages-handoff-"));
    try {
      expect((await buildSite(site("ntwrk"), dir)).ok).toBe(true);
      const worker = (await import(join(dir, "_worker.js"))).default as { fetch(r: Request, e: Partial<Env>): Promise<Response> };
      const assets = { fetch: async (request: Request) => {
        expect(request.url).toBe("https://ntwrk.party/_update-handoff");
        expect(request.headers.has("cookie")).toBe(false);
        return new Response(readFileSync(join(dir, PAGE_FILES.UpdateHandoffPage), "utf8"));
      } };
      const path = "https://ntwrk.party/t/T-7F3K9Q?candidate=ignored";
      const res = await worker.fetch(new Request(path, { headers: { cookie: "sid_ntwrk=private" } }), { ASSETS: assets });
      expect(res.status).toBe(200);
      expect(res.headers.get("allow")).toBeNull();
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=()");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await res.text()).toContain('href="https://claude.ai/new?q=Ask%20The%20Network%20for%20update%20T-7F3K9Q"');
      const write = await worker.fetch(new Request(path, { method: "POST" }), { ASSETS: assets });
      expect(write.status).toBe(405);
      expect(write.headers.get("allow")).toBe("GET, HEAD");
      expect((await worker.fetch(new Request("https://ntwrk.party/_update-handoff"), { ASSETS: assets })).status).toBe(404);
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

  test("keeps every Set-Cookie from the backend and adds nosniff, referrer-policy, and HSTS", async () => {
    const { run } = setup();
    const res = await run("/api/me");
    expect(res.headers.getSetCookie()).toEqual(["__Host-sid=a; Path=/; HttpOnly; Secure", "other=b; Path=/"]);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });
});

describe("fails closed", () => {
  test("no secret: 503 and nothing forwarded", async () => {
    const { seen, run } = setup({ PLATFORM_PROXY_SECRET: undefined });
    const res = await run("/api/app");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(await res.json()).toEqual({ ok: false, error: "proxy_not_configured" });
    expect(seen).toEqual([]);
  });

  test("backend down: 502 api_unreachable (the pages show their own message)", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: "slop", SITE_HOST: "slop.date", PLATFORM_PROXY_SECRET: SECRET };
    const res = await handle(new Request("https://slop.date/api/app"), env, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(await res.json()).toEqual({ ok: false, error: "api_unreachable" });
  });

  test("redirects from the backend pass through unfollowed (OAuth)", async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: "ntwrk", SITE_HOST: "ntwrk.party", PLATFORM_PROXY_SECRET: SECRET };
    let redirect: RequestRedirect | undefined;
    const res = await handle(new Request("https://ntwrk.party/oauth/authorize?client_id=x"), env, (async (_u: string, init: RequestInit) => {
      redirect = init.redirect;
      return new Response(null, { status: 302, headers: { location: "https://client.example/cb?code=abc" } });
    }) as unknown as typeof fetch);
    expect(redirect).toBe("manual");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://client.example/cb?code=abc");
  });
});


test("retired signup routes cannot expose cached forms or forward writes", async () => {
  for (const app of ["friends", "slop", "ntwrk"]) {
    const { env, seen, assets, run } = setup(); env.APP_ID = app;
    for (const path of ["/join", "/join/", "/join.html", "/join?via=agent"]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const r = await run(path, { method });
        expect(r.status).toBe(method === "POST" ? 405 : 302);
        expect(r.headers.get("cache-control")).toBe("no-store");
        expect(r.headers.get("location")).toBe(method === "POST" ? null : "/");
        expect(r.headers.get("allow")).toBe(method === "POST" ? "GET, HEAD" : null);
        expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
        expect(r.headers.get("x-content-type-options")).toBe("nosniff");
        expect(r.headers.get("x-frame-options")).toBe("DENY");
        expect(r.headers.get("referrer-policy")).toBe("no-referrer");
        expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
      }
    }
    expect(seen).toHaveLength(0); expect(assets).toHaveLength(0);
  }
});

test("retired settings paths answer 404 with no page and no cache on every site, and never reach the backend or the assets", async () => {
  for (const app of ["ntwrk", "slop", "peon", "friends"]) {
    const { env, seen, assets, run } = setup(); env.APP_ID = app;
    for (const path of ["/settings", "/settings/", "/settings.html"]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const r = await run(path, { method });
        expect([app, path, method, r.status, r.headers.get("cache-control")]).toEqual([app, path, method, 404, "no-store"]);
        expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
        expect(r.headers.get("x-content-type-options")).toBe("nosniff");
        expect(r.headers.get("x-frame-options")).toBe("DENY");
        expect(r.headers.get("referrer-policy")).toBe("no-referrer");
        expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
        expect(await r.text()).toBe(method === "HEAD" ? "" : "Not found");
      }
    }
    expect(seen).toHaveLength(0); expect(assets).toHaveLength(0);
  }
});

test("peon.biz keeps its browser join page: the join paths are static files, for every method", async () => {
  const { env, seen, assets, run } = setup(); env.APP_ID = "peon";
  for (const path of ["/join", "/join/", "/join.html"]) for (const method of ["GET", "HEAD", "POST"]) expect((await run(path, { method })).status).toBe(200);
  expect(seen).toHaveLength(0);
  expect(assets).toHaveLength(9);
});

test("an app id that is not known fails closed on every path the Worker decides", async () => {
  const { env, seen, assets, run } = setup(); env.APP_ID = "unknown-app";
  for (const path of ["/api/app", "/join", "/settings", "/_t", "/r/abc"]) expect((await run(path)).status).toBe(503);
  expect(await (await run("/")).text()).toBe("asset");
  expect(seen).toHaveLength(0); expect(assets).toEqual(["/"]);
});

describe("first-party telemetry /_t and shortlink /r/*", () => {
  test("/_t accepts same-origin allowlisted JSON, strips raw IP via rotating visitHash, returns 204 without backend load", async () => {
    const pipelineEvents: Record<string, unknown>[] = [];
    const aePoints: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = { waitUntil(p) { pending.push(p); } };
    const { env, seen, assets } = setup({
      ANALYTICS_ENGINE: { writeDataPoint(pt) { aePoints.push(pt); } },
      TELEMETRY_PIPELINE: { send(evts) { pipelineEvents.push(...evts); } },
      TELEMETRY_SALT: "telemetry-salt-test",
    });

    const makeReq = () =>
      new Request("https://slop.date/_t", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://slop.date",
          "sec-fetch-site": "same-origin",
          "cf-connecting-ip": "203.0.113.42",
          "user-agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          event: "page_view",
          path: "/",
          utmSource: "ig",
          utmCampaign: "nyc_launch",
          qrBatch: "COAST-SOHO-001",
        }),
      });
    const res = await handle(makeReq(), env, (async () => { throw new Error("backend must not be called"); }) as unknown as typeof fetch, () => NOW, ctx);
    await Promise.all(pending);

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(seen).toEqual([]);
    expect(assets).toEqual([]);
    expect(aePoints).toHaveLength(1);
    expect(pipelineEvents).toHaveLength(1);
    const ev = pipelineEvents[0]!;
    expect(ev.app).toBe("slop");
    expect(ev.event).toBe("page_view");
    expect(ev.utmSource).toBe("ig");
    expect(typeof ev.visitHash).toBe("string");
    expect(String(ev.visitHash)).toHaveLength(32);
    expect(JSON.stringify(ev)).not.toContain("203.0.113.42");

    const nextDayPending: Promise<unknown>[] = [];
    const nextDayCtx: ExecutionContextLike = { waitUntil(p) { nextDayPending.push(p); } };
    await handle(makeReq(), env, fetch, () => NOW + 86_400_000, nextDayCtx);
    await Promise.all(nextDayPending);
    expect(pipelineEvents[1]!.visitHash).not.toBe(pipelineEvents[0]!.visitHash);
  });

  test("/_t enforces same-origin, 2KB limit, method, and zero-PII schema", async () => {
    const { run } = setup();
    expect((await run("/_t", { method: "GET" })).status).toBe(405);
    expect((await run("/_t", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify({ event: "page_view" }),
    })).status).toBe(403);
    expect((await run("/_t", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ event: "page_view" }),
    })).status).toBe(403);
    expect((await run("/_t", {
      method: "POST",
      headers: { origin: "https://slop.date", "content-type": "application/json" },
      body: JSON.stringify({ event: "page_view", utmCampaign: "x".repeat(MAX_TELEMETRY_BODY_BYTES + 10) }),
    })).status).toBe(413);
    expect((await run("/_t", {
      method: "POST",
      headers: { origin: "https://slop.date", "content-type": "application/json" },
      body: JSON.stringify({ event: "page_view", phone: "+12125550199" }),
    })).status).toBe(400);
    expect((await run("/_t", {
      method: "POST",
      headers: { origin: "https://slop.date", "content-type": "application/json" },
      body: JSON.stringify({ event: "page_view", ref: "user@example.com" }),
    })).status).toBe(400);
  });

  test("/r/* redirects safely with 302, logs qr_scan/link_click, and blocks open redirects", async () => {
    const pipelineEvents: Record<string, unknown>[] = [];
    const pending: Promise<unknown>[] = [];
    const ctx: ExecutionContextLike = { waitUntil(p) { pending.push(p); } };
    const { env } = setup({
      TELEMETRY_PIPELINE: { send(evts) { pipelineEvents.push(...evts); } },
      SHORTLINK_TARGETS: {
        vip_nyc: "/join?utm_source=vip",
        bad_open: "https://evil.example/phish",
      },
    });

    const qrRes = await handle(new Request("https://slop.date/r/COAST-SOHO-001", { headers: { "cf-connecting-ip": "198.51.100.7" } }), env, fetch, () => NOW, ctx);
    await Promise.all(pending);
    expect(qrRes.status).toBe(302);
    expect(qrRes.headers.get("location")).toBe("/?qr=COAST-SOHO-001");
    expect(pipelineEvents[0]?.event).toBe("qr_scan");
    expect(JSON.stringify(pipelineEvents[0])).not.toContain("198.51.100.7");

    const openRedirect = await handle(new Request("https://slop.date/r/abc?to=//evil.example"), env, fetch, () => NOW, ctx);
    expect(openRedirect.status).toBe(400);
    const badMapped = await handle(new Request("https://slop.date/r/bad_open"), env, fetch, () => NOW, ctx);
    expect(badMapped.status).toBe(400);
    const badSlug = await handle(new Request("https://slop.date/r/bad/nested"), env, fetch, () => NOW, ctx);
    expect(badSlug.status).toBe(404);
    const badMethod = await handle(new Request("https://slop.date/r/COAST-SOHO-001", { method: "POST" }), env, fetch, () => NOW, ctx);
    expect(badMethod.status).toBe(405);
  });
});
