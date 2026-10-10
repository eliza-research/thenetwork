// The deployable backend (deploy/backend; docs/deploy.md): config, edge headers, routing, logs,
// shutdown, and one boot of the real process against a database of its own on the dev cluster.
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_HOST_MAP } from "../../packages/platform/src/apps.ts";
import { SQL } from "bun";
import { dropDb, emptyDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { PROXY_MAX_SKEW_S, signProxyHeaders } from "../../packages/platform/src/proxy.ts";
import {
  BUILD_HEADER, CLIENT_IP, createBackend, ipOf, jsonLogger, loadConfig, normalizeEdge, PROXY_HEADERS,
  redact, routeLabel, serviceLoginProblem, type BackendConfig, type ServiceLike,
} from "./backend.ts";

const SECRET = "s".repeat(40);
const DEPLOYED = {
  PLATFORM_ENV: "staging", DATABASE_URL: "postgres://svc@db.invalid/x", MIGRATION_DATABASE_URL: "postgres://owner@db.invalid/x", PLATFORM_HASH_KEY: "h".repeat(40), LEAK_LABEL_KEY: "l".repeat(40), PLATFORM_PROXY_SECRET: SECRET,
  TURNSTILE_SECRET_KEY: "fake", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_VERIFY_SERVICE_SID: "VAfake",
};

describe("config", () => {
  test("binds loopback locally and every interface only when deployed", () => {
    const dev = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x" });
    expect(dev.host).toBe("127.0.0.1");
    expect(dev.staff).toEqual({ host: "127.0.0.1", port: 4848 });
    expect(dev.port).toBe(8790);
    const st = loadConfig({ ...DEPLOYED, PORT: "3000" });
    expect(st.host).toBe("0.0.0.0");
    expect(st.staff?.host).toBe("::");
    expect(st.port).toBe(3000);
    expect(loadConfig({ ...DEPLOYED, PLATFORM_ENV: "production" }).host).toBe("0.0.0.0");
  });

  test("an undeclared environment does not start", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x@localhost/x" })).toThrow(/PLATFORM_ENV/);
    expect(() => loadConfig({ PLATFORM_ENV: "prod", DATABASE_URL: "postgres://x@localhost/x" })).toThrow(/PLATFORM_ENV/);
  });

  test("deployed: migrations and the service use two logins (audit: the superuser URL made RLS moot)", async () => {
    expect(() => loadConfig({ ...DEPLOYED, MIGRATION_DATABASE_URL: undefined })).toThrow(/MIGRATION_DATABASE_URL/);
    expect(loadConfig({ ...DEPLOYED, MIGRATION_DATABASE_URL: undefined, MIGRATE_ON_BOOT: "0" }).migrateOnBoot).toBe(false);
    expect(() => loadConfig({ ...DEPLOYED, MIGRATION_DATABASE_URL: DEPLOYED.DATABASE_URL })).toThrow(/different login/);
    const c = loadConfig(DEPLOYED);
    expect([c.databaseUrl, c.migrationUrl]).toEqual([DEPLOYED.DATABASE_URL, DEPLOYED.MIGRATION_DATABASE_URL]);
    // Locally one URL does both.
    const dev = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x" });
    expect(dev.migrationUrl).toBe(dev.databaseUrl);
    // The boot check refuses a superuser, BYPASSRLS or an owner of the tables.
    const as = (r: Record<string, unknown>) => serviceLoginProblem(async () => [r]);
    expect(await as({ rolsuper: true, rolbypassrls: false, owner: false })).toMatch(/superuser/);
    expect(await as({ rolsuper: false, rolbypassrls: true, owner: false })).toMatch(/BYPASSRLS/);
    expect(await as({ rolsuper: false, rolbypassrls: false, owner: true })).toMatch(/owns/);
    expect(await as({ rolsuper: false, rolbypassrls: false, owner: false })).toBeUndefined();
  });

  test("a deployed environment needs every secret", () => {
    for (const k of ["DATABASE_URL", "PLATFORM_HASH_KEY", "LEAK_LABEL_KEY", "PLATFORM_PROXY_SECRET", "TURNSTILE_SECRET_KEY", "TWILIO_AUTH_TOKEN"]) {
      const e: Record<string, string | undefined> = { ...DEPLOYED, [k]: undefined };
      expect(() => loadConfig(e)).toThrow(k);
    }
    expect(() => loadConfig({ ...DEPLOYED, OTP_PROVIDER: "dev" })).toThrow(/OTP_PROVIDER=twilio/);
    expect(() => loadConfig({ ...DEPLOYED, PLATFORM_PROXY_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...DEPLOYED, PLATFORM_HASH_KEY: "short" })).toThrow(/at least 32/);
  });

  test("the staff API never shares the public port", () => {
    expect(() => loadConfig({ ...DEPLOYED, PORT: "4848" })).toThrow(/STAFF_PORT/);
    expect(loadConfig({ ...DEPLOYED, PORT: "4848", BACKEND_STAFF: "off" }).staff).toBeUndefined();
    expect(() => loadConfig({ ...DEPLOYED, PORT: "http" })).toThrow(/PORT/);
  });

  test("sends stay dry-run unless every global live flag is set", () => {
    const base = { ...DEPLOYED, NETWORK_CHANNEL: "blooio", BLOOIO_API_KEY: "k", BLOOIO_FROM: "+15550100" };
    expect(loadConfig(DEPLOYED).channel).toBe("dry-run");
    expect(loadConfig(base).channel).toBe("dry-run");
    expect(loadConfig({ ...base, BLOOIO_ALLOW_SEND: "1" }).channel).toBe("dry-run");
    expect(loadConfig({ ...base, NTWRK_LIVE_APPROVED: "1" }).channel).toBe("dry-run");
    expect(loadConfig({ ...base, BLOOIO_ALLOW_SEND: "true", NTWRK_LIVE_APPROVED: "1" }).channel).toBe("dry-run");
    expect(loadConfig({ ...base, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }, ["--dry-run"]).channel).toBe("dry-run");
    expect(loadConfig({ ...base, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }).channel).toBe("blooio");
    expect(loadConfig(base).warnings.join(" ")).toMatch(/stay dry-run/);
    expect(() => loadConfig({ ...base, BLOOIO_API_KEY: undefined, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" })).toThrow(/BLOOIO_API_KEY/);
  });

  test("extra hosts are for staging only and must name a known app", () => {
    expect(loadConfig({ ...DEPLOYED, BACKEND_EXTRA_HOSTS: "pr-1-slop.example.workers.dev=slop" }).hostMap["pr-1-slop.example.workers.dev"]).toBe("slop");
    expect(() => loadConfig({ ...DEPLOYED, BACKEND_EXTRA_HOSTS: "x.dev=nope" })).toThrow(/known app/);
    expect(() => loadConfig({ ...DEPLOYED, PLATFORM_ENV: "production", BACKEND_EXTRA_HOSTS: "x.dev=slop" })).toThrow(/not production/);
  });

  test("the build id comes from BUILD_ID, then Railway's commit", () => {
    expect(loadConfig({ ...DEPLOYED, RAILWAY_GIT_COMMIT_SHA: "abc123" }).build).toBe("abc123");
    expect(loadConfig({ ...DEPLOYED, BUILD_ID: "b7", RAILWAY_GIT_COMMIT_SHA: "abc123" }).build).toBe("b7");
  });
});

/** What a site router sends for one request, signed with the platform's own signer (packages/platform/src/proxy.ts). */
async function signed(o: { method?: string; path?: string; host: string; ip?: string; secret?: string; now?: number }) {
  return signProxyHeaders(o.secret ?? SECRET, { method: o.method ?? "GET", path: o.path ?? "/api/app", host: o.host, ip: o.ip ?? "203.0.113.7", ts: Math.floor((o.now ?? Date.now()) / 1000) });
}

describe("edge headers", () => {
  const site = Object.keys(DEFAULT_HOST_MAP).find(h => !h.includes(":") && !h.startsWith("www.") && DEFAULT_HOST_MAP[h] !== "ntwrk")!;
  const app = DEFAULT_HOST_MAP[site]!;
  const req = (h: Record<string, string>, init: RequestInit = {}, path = "/api/app") => new Request(`http://api.example.test${path}`, { ...init, headers: { host: "api.example.test", ...h } });
  const edge = async (h: Record<string, string>, init: RequestInit = {}, path = "/api/app", now?: number) => normalizeEdge(req(h, init, path), SECRET, DEFAULT_HOST_MAP, now);
  const trusted = async (h: Record<string, string>, init?: RequestInit, path?: string, now?: number) => (await edge(h, init, path, now)).edge;

  test("a router signature verifies; any change to what it covers does not", async () => {
    expect(await trusted(await signed({ host: site }))).toBe(true);
    expect(await trusted(await signed({ host: site, secret: "x".repeat(40) }))).toBe(false);
    expect((await normalizeEdge(req(await signed({ host: site })), undefined, DEFAULT_HOST_MAP)).edge).toBe(false);
    // Another path, query, method, host or IP than the one signed.
    expect(await trusted(await signed({ host: site }), {}, "/api/me")).toBe(false);
    expect(await trusted(await signed({ host: site }), {}, "/api/app?x=1")).toBe(false);
    expect(await trusted(await signed({ host: site, method: "POST" }))).toBe(false);
    expect(await trusted({ ...(await signed({ host: site })), [PROXY_HEADERS.host]: "ntwrk.party" })).toBe(false);
    expect(await trusted({ ...(await signed({ host: site })), [PROXY_HEADERS.ip]: "198.51.100.1" })).toBe(false);
    // Stale or future timestamps.
    expect(await trusted(await signed({ host: site, now: Date.now() - (PROXY_MAX_SKEW_S + 5) * 1000 }))).toBe(false);
    expect(await trusted(await signed({ host: site, now: Date.now() + (PROXY_MAX_SKEW_S + 5) * 1000 }))).toBe(false);
    expect(await trusted({ ...(await signed({ host: site })), [PROXY_HEADERS.sig]: "zz" })).toBe(false);
  });

  test("verified: the site host picks the app and the visitor IP is kept", async () => {
    const n = await edge(await signed({ host: site }));
    expect(n.edge).toBe(true);
    expect(n.app).toBe(app);
    expect(n.req.headers.get("host")).toBe(site);
    expect(new URL(n.req.url).host).toBe(site);
    expect(n.req.headers.get(CLIENT_IP)).toBe("203.0.113.7");
    // The signed headers stay, so the same check further in still passes.
    expect((await normalizeEdge(n.req, SECRET, DEFAULT_HOST_MAP)).edge).toBe(true);
    expect(ipOf(n.req, "10.0.0.1")).toBe("203.0.113.7");
  });

  test("unsigned or wrongly signed: every proxy and forwarding header is removed", async () => {
    const forged = [
      { "x-forwarded-host": site, [PROXY_HEADERS.host]: site, [PROXY_HEADERS.ip]: "203.0.113.7", "x-ntwrk-proxy-app": app, "x-forwarded-for": "198.51.100.1" },
      await signed({ host: site, secret: "w".repeat(40) }),
    ];
    for (const h of forged) {
      const n = await edge(h);
      expect(n.edge).toBe(false);
      expect(n.app).toBeUndefined();
      expect(n.req.headers.get("host")).toBe("api.example.test");
      for (const x of ["x-forwarded-host", ...Object.values(PROXY_HEADERS), "x-ntwrk-proxy-app", "x-forwarded-for"]) expect(n.req.headers.get(x)).toBeNull();
      expect(ipOf(n.req, "10.0.0.1")).toBe("10.0.0.1");
    }
  });

  test("an unknown site host is not trusted even when signed", async () => {
    const n = await edge(await signed({ host: "evil.example" }));
    expect(n.edge).toBe(false);
    expect(n.req.headers.get("host")).toBe("api.example.test");
    expect(n.req.headers.get(CLIENT_IP)).toBeNull();
  });

  test("a POST body survives the rewrite", async () => {
    const n = await edge({ ...(await signed({ host: site, method: "POST" })), "content-type": "application/json" }, { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(n.edge).toBe(true);
    expect(n.req.method).toBe("POST");
    expect(await n.req.json()).toEqual({ a: 1 });
  });
});

describe("logs", () => {
  test("phone numbers are masked and text and secrets are dropped", () => {
    const lines: string[] = [];
    const log = jsonLogger(s => lines.push(s), { svc: "t" });
    log.info("inbound from +15550100123 and (555) 010-0199 and 5550100177", { text: "my secret message", body: "x", phone: "+15550100123", token: "t0k", note: "call +1 555 010 0123", ms: 12 });
    const o = JSON.parse(lines[0]!);
    expect(o.level).toBe("info");
    expect(o.svc).toBe("t");
    expect(o.ms).toBe(12);
    expect(lines[0]).not.toMatch(/555/);
    expect(lines[0]).not.toMatch(/secret message|t0k/);
    expect(o.text).toBeUndefined();
    expect(o.phone).toBeUndefined();
    expect(o.note).toBe("call [phone]");
  });

  test("timestamps and short numbers are left alone", () => {
    expect(redact("took 1234 ms at 2026-10-08T05:48:24.645Z, id 1696000000000")).toBe("took 1234 ms at 2026-10-08T05:48:24.645Z, id 1696000000000");
  });

  test("route labels carry no query string and no ids", () => {
    expect(routeLabel("/api/auth/otp/start")).toBe("/api/auth/otp");
    expect(routeLabel("/review/opp_123")).toBe("/review/:id");
    expect(routeLabel("/webhooks/blooio/slop")).toBe("/webhooks/blooio/slop");
  });
});

// ------------------------------------------------------------------ routing and shutdown with a fake service

function fakeService() {
  const calls: { kind: string; host: string | null; path: string; ip: string | null }[] = [];
  let release: () => void = () => {};
  const svc: ServiceLike & { closed: boolean; ticks: number; slowTick: boolean } = {
    closed: false, ticks: 0, slowTick: false,
    async fetch(req) { calls.push({ kind: "staff", host: req.headers.get("host"), path: new URL(req.url).pathname, ip: null }); return Response.json({ ok: true, staff: true }); },
    async publicFetch(req) { calls.push({ kind: "public", host: req.headers.get("host"), path: new URL(req.url).pathname, ip: req.headers.get(CLIENT_IP) }); return Response.json({ ok: true }); },
    runtimes: new Map([["ntwrk:nyc", { id: "ntwrk:nyc", tick: async () => {
      svc.ticks++;
      if (svc.slowTick) await new Promise<void>(r => { release = r; });
      return true;
    } }]]),
    async close() { svc.closed = true; },
  };
  return { svc, calls, release: () => release() };
}

const cfg = (o: Partial<BackendConfig> = {}): BackendConfig => ({ ...loadConfig(DEPLOYED), build: "test-build", tickMs: 3_600_000, shutdownGraceMs: 2_000, ...o });
const silent = jsonLogger(() => {});

describe("routing", () => {
  test("/healthz answers without auth or data, and 503 when the database is down", async () => {
    const { svc } = fakeService();
    const up = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const r = await up.publicFetch(new Request("http://x/healthz"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, build: "test-build", env: "staging" });
    expect(r.headers.get(BUILD_HEADER)).toBe("test-build");
    const down = createBackend({ svc, config: cfg(), log: silent, ping: async () => { throw new Error("connection refused"); } });
    expect((await down.publicFetch(new Request("http://x/healthz"))).status).toBe(503);
  });

  test("/api goes to the public API with the edge applied; webhooks to the service", async () => {
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const site = "slop.date";
    const r = await b.publicFetch(new Request("http://api.example.test/api/app", { headers: { host: "api.example.test", ...(await signed({ host: site, ip: "203.0.113.9" })) } }));
    expect(r.status).toBe(200);
    expect(r.headers.get(BUILD_HEADER)).toBe("test-build");
    expect(calls.at(-1)).toEqual({ kind: "public", host: site, path: "/api/app", ip: "203.0.113.9" });
    await b.publicFetch(new Request("http://api.example.test/webhooks/blooio/slop", { method: "POST", body: "{}" }));
    expect(calls.at(-1)!.kind).toBe("staff");
    expect(calls.at(-1)!.path).toBe("/webhooks/blooio/slop");
  });

  test("deployed, an unsigned request names no site: /api and /mcp answer 421 (audit: Host: slop.date was served as slop.date)", async () => {
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true, mcp: async () => new Response("ok") });
    for (const p of ["/api/app", "/mcp", "/oauth/authorize"]) {
      const r = await b.publicFetch(new Request(`https://network-backend.up.railway.app${p}`, { headers: { host: "slop.date" } }));
      expect([p, r.status, (await r.json()).error]).toEqual([p, 421, "edge_required"]);
    }
    expect(calls.length).toBe(0);
    // Locally (dev), the site ports name their app without a router.
    const local = createBackend({ svc, config: cfg({ deployed: false }), log: silent, ping: async () => true });
    expect((await local.publicFetch(new Request("http://127.0.0.1:8790/api/app", { headers: { host: "slop.date" } }))).status).toBe(200);
  });

  test("the staff API never answers on the public port", async () => {
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    for (const p of ["/health", "/review", "/review/opp_1", "/safety/lift", "/matching", "/holds", "/apps/slop/health", "/invite"]) {
      const r = await b.publicFetch(new Request(`http://x${p}`, { method: p === "/health" || p === "/review" ? "GET" : "POST" }));
      expect(r.status).toBe(404);
    }
    expect(calls.length).toBe(0);
    const s = await b.staffFetch(new Request("http://x/health"));
    expect(s.status).toBe(200);
    expect(calls.at(-1)!.kind).toBe("staff");
  });

  test("MCP and OAuth paths answer 404 until an MCP server is wired in, then go to it", async () => {
    const { svc } = fakeService();
    const paths = ["/mcp", "/oauth/authorize", "/oauth/token", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];
    const none = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    for (const p of paths) {
      const r = await none.publicFetch(new Request(`http://x${p}`, { headers: await signed({ host: "slop.date", path: p }) }));
      expect(r.status).toBe(404);
      expect((await r.json()).error).toBe("mcp_not_enabled");
    }
    const seen: string[] = [];
    const wired = createBackend({ svc, config: cfg(), log: silent, ping: async () => true, mcp: async req => { seen.push(new URL(req.url).pathname); return new Response("ok"); } });
    for (const p of paths) expect((await wired.publicFetch(new Request(`http://x${p}`, { headers: await signed({ host: "slop.date", path: p }) }))).status).toBe(200);
    expect(seen).toEqual(paths);
    expect((await wired.publicFetch(new Request("http://x/mcpx"))).status).toBe(404);
  });

  test("an error in the service is a 500 without detail, and the access log has no phone or query", async () => {
    const lines: string[] = [];
    const { svc } = fakeService();
    svc.publicFetch = async () => { throw new Error("boom for +15550100123"); };
    const b = createBackend({ svc, config: cfg(), log: jsonLogger(s => lines.push(s)), ping: async () => true });
    const r = await b.publicFetch(new Request("http://x/api/auth/otp/start?phone=%2B15550100123", { headers: await signed({ host: "slop.date", path: "/api/auth/otp/start?phone=%2B15550100123" }) }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: "internal_error" });
    expect(lines.join("\n")).not.toMatch(/555|phone=/);
  });
});

describe("router to backend (deploy/router.ts, the real Worker code)", () => {
  test("each site's Worker reaches its own app; a client's own proxy headers never count", async () => {
    const { handle } = await import("../router.ts");
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const sites = Object.entries(DEFAULT_HOST_MAP).filter(([h]) => !h.includes(":") && !h.startsWith("www."));
    for (const [host, app] of sites) {
      const env = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: app, SITE_HOST: host, PLATFORM_PROXY_SECRET: SECRET };
      const visitor = new Request(`https://${host}/api/app?x=1`, { headers: { "cf-connecting-ip": "203.0.113.20", [PROXY_HEADERS.host]: "evil.example", "x-forwarded-host": "evil.example" } });
      const res = await handle(visitor, env, (async (url: string | URL | Request, init?: RequestInit) => b.publicFetch(new Request(url, init))) as typeof fetch);
      expect(res.status).toBe(200);
      expect(calls.at(-1)).toEqual({ kind: "public", host, path: "/api/app", ip: "203.0.113.20" });
    }
  });
});

describe("graceful shutdown", () => {
  test("a tick in flight finishes before the pool closes; new work is refused meanwhile", async () => {
    const { svc, release } = fakeService();
    svc.slowTick = true;
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const first = b.startTicks();
    await Bun.sleep(5);
    expect(b.inFlight).toBe(1);
    const stopped: boolean[] = [];
    const server = { stop: (force?: boolean) => { stopped.push(!!force); } };
    const done = b.shutdown([server]);
    await Bun.sleep(20);
    expect(svc.closed).toBe(false);
    expect((await b.publicFetch(new Request("http://x/healthz"))).status).toBe(503);
    expect((await b.publicFetch(new Request("http://x/api/app"))).status).toBe(503);
    expect((await b.staffFetch(new Request("http://x/review"))).status).toBe(503);
    await b.tickAll();
    expect(svc.ticks).toBe(1);
    release();
    expect(await done).toEqual({ clean: true });
    await first;
    expect(svc.closed).toBe(true);
    expect(stopped).toEqual([false, true]);
    expect(b.shutdown()).toBe(done);
  });

  test("work that outlives the grace period is cut off and reported", async () => {
    const { svc } = fakeService();
    svc.slowTick = true;
    const b = createBackend({ svc, config: cfg({ shutdownGraceMs: 30 }), log: silent, ping: async () => true });
    void b.startTicks();
    await Bun.sleep(5);
    expect(await b.shutdown()).toEqual({ clean: false });
    expect(svc.closed).toBe(true);
  });
});

// ------------------------------------------------------------------ the real process

describe.skipIf(!pgAvailable)("boot (dev Postgres, a database of its own)", () => {
  let url = "";
  afterAll(async () => { if (url) await dropDb(url); });

  test("migrates on boot, serves /healthz and /api/app per site host, refuses spoofed edges, exits 0 on SIGTERM", async () => {
    url = await emptyDb("backend_boot");
    const port = 20000 + (process.pid % 20000), staff = port + 1;
    // The owner migrates; the service runs as a network_service login that RLS applies to (the boot check refuses the owner).
    await migrate(url, { lockTimeout: "5s" });
    const role = `backend_boot_${process.pid}`;
    const owner = new SQL({ url, max: 1 });
    try {
      await owner.unsafe(`drop role if exists ${role}`).catch(() => {});
      await owner.unsafe(`create role ${role} login nosuperuser nobypassrls`);
      await owner.unsafe(`grant network_service to ${role}`);
      await owner.unsafe(`grant connect on database ${new URL(url).pathname.slice(1)} to ${role}`);
    } finally { await owner.close(); }
    const svcUrl = Object.assign(new URL(url), { username: role }).toString();
    const env: Record<string, string> = {
      ...process.env as Record<string, string>, ...DEPLOYED, DATABASE_URL: svcUrl, MIGRATION_DATABASE_URL: url, PORT: String(port), STAFF_PORT: String(staff), TICK_MS: "3600000",
      PLATFORM_DB_ENVIRONMENT_INIT: "1", BUILD_ID: "boot-test", NODE_ENV: "", NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", NTWRK_LIVE_APPROVED: "",
    };
    const proc = Bun.spawn(["bun", "run", `${import.meta.dir}/server.ts`], { env, stdout: "pipe", stderr: "pipe" });
    const out = new Response(proc.stdout).text();
    try {
      let ok = false;
      for (let i = 0; i < 100 && !ok; i++) {
        await Bun.sleep(100);
        ok = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.status === 200, () => false);
      }
      if (!ok) { proc.kill("SIGKILL"); throw new Error(`the backend did not become healthy:\n${(await out).split("\n").filter(l => !l.includes('"applied ')).slice(-5).join("\n")}`); }
      const h = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(h.headers.get(BUILD_HEADER)).toBe("boot-test");
      const hosts = Object.entries(DEFAULT_HOST_MAP).filter(([h]) => !h.includes(":") && !h.startsWith("www.") && !h.endsWith(".pages.dev"));
      expect(hosts.length).toBe(4);
      for (const [host, app] of hosts) {
        const r = await fetch(`http://127.0.0.1:${port}/api/app`, { headers: await signed({ host }) });
        expect(r.status).toBe(200);
        expect((await r.json()).id).toBe(app);
        expect(r.headers.get(BUILD_HEADER)).toBe("boot-test");
      }
      const spoof = await fetch(`http://127.0.0.1:${port}/api/app`, { headers: { "x-forwarded-host": hosts[1]![0], [PROXY_HEADERS.host]: hosts[1]![0], [PROXY_HEADERS.ip]: "203.0.113.1" } });
      expect([spoof.status, (await spoof.json()).error]).toEqual([421, "edge_required"]);
      expect((await fetch(`http://127.0.0.1:${port}/review`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${staff}/health`)).status).toBe(401);
    } finally {
      proc.kill("SIGTERM");
    }
    expect(await proc.exited).toBe(0);
    const logs = await out;
    const lines = logs.trim().split("\n");
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    expect(logs).toMatch(/"msg":"shutdown complete".*"clean":true/);
    expect(logs).toMatch(/"sends":"dry-run"/);
    expect(logs).not.toMatch(/"sends":"live"/);
  }, 30_000);
});

describe("ensureServiceLogin (first deploy)", () => {
  test("creates the login once, escapes the password, and refuses unsafe names", async () => {
    const { ensureServiceLogin } = await import("./backend.ts");
    const qs: string[] = [];
    let exists = false;
    const q = async (s: string) => { qs.push(s); return s.startsWith("select") && exists ? [{ x: 1 }] : []; };
    const url = "postgres://network_backend:" + encodeURIComponent("a'b" + "x".repeat(30)) + "@h:5432/railway";
    expect(await ensureServiceLogin(q, url)).toEqual({ role: "network_backend", created: true });
    expect(qs[1]).toContain("password 'a''b");
    expect(qs[1]).toContain("nosuperuser nobypassrls");
    expect(qs[2]).toBe("grant network_service to network_backend");
    exists = true; qs.length = 0;
    expect(await ensureServiceLogin(q, url)).toEqual({ role: "network_backend", created: false });
    expect(qs.length).toBe(1);
    await expect(ensureServiceLogin(q, "postgres://postgres:" + "x".repeat(30) + "@h/db")).rejects.toThrow();
    await expect(ensureServiceLogin(q, "postgres://bad-name:" + "x".repeat(30) + "@h/db")).rejects.toThrow();
    exists = false;
    await expect(ensureServiceLogin(q, "postgres://svc:short@h/db")).rejects.toThrow();
  });
});
