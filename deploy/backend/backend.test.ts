// The deployable backend (deploy/backend; docs/deploy.md): config, edge headers, routing, logs,
// shutdown, and one boot of the real process against a database of its own on the dev cluster.
import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_HOST_MAP } from "../../packages/platform/src/apps.ts";
import { SQL } from "bun";
import { AgentContextStore } from "../../packages/network/service/agent-context-store.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { randomUUID } from "node:crypto";
import { dropDb, emptyDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { PROXY_MAX_SKEW_S, signProxyHeaders } from "../../packages/platform/src/proxy.ts";
import {
  BUILD_HEADER, CLIENT_IP, createBackend, ipOf, jsonLogger, loadConfig, normalizeEdge, PROXY_HEADERS,
  redact, routeLabel, serviceLoginProblem, type BackendConfig, type ServiceLike,
} from "./backend.ts";

const SECRET = "s".repeat(40);
const DEPLOYED = {
  PLATFORM_ENV: "staging", DATABASE_URL: "postgres://svc@db.invalid/x", MIGRATION_DATABASE_URL: "postgres://owner@db.invalid/x", PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_PROXY_SECRET: SECRET,
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
    for (const k of ["DATABASE_URL", "PLATFORM_HASH_KEY", "PLATFORM_PROXY_SECRET", "TURNSTILE_SECRET_KEY", "TWILIO_AUTH_TOKEN"]) {
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
    const cloud = {...DEPLOYED, NETWORK_CHANNEL: "eliza_cloud", NETWORK_CLOUD_DELIVERY_ORIGIN: "https://cloud.invalid", SERVICE_TURN_SECRET: "fixture-service-key-" + "s".repeat(40)};
    expect(loadConfig(cloud).channel).toBe("dry-run");
    expect(loadConfig({...cloud, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1"}).channel).toBe("eliza_cloud");
    expect(loadConfig({...cloud, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1"}, ["--dry-run"]).channel).toBe("dry-run");
    expect(() => loadConfig({...cloud, SERVICE_TURN_SECRET: undefined, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1"})).toThrow(/SERVICE_TURN_SECRET/);
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

  test("boots with private agent reads under the service login, refuses public reads and staff mutations, exits 0 on SIGTERM", async () => {
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
    // The child process uses RealClock; its phone fixture must not age into a recycled-number hold.
    const now = Date.now();
    const e164 = "+12125550189", personId = randomUUID(), memberId = "boot_agent_member";
    const agentToken = "boot-agent-reader-" + "a".repeat(40), staffToken = "boot-human-staff-" + "h".repeat(40);
    const fixture = await NetworkService.fromDatabase({url, clock: {now: () => now}, env: {PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: DEPLOYED.PLATFORM_HASH_KEY}, notify: false, photoStorage: null, log: () => {}});
    try {
      await fixture.people.createPerson({id: personId, e164, method: "inbound_message", at: now, lowestAge: 25, phoneHash: fixture.accounts.phoneHash(e164)});
      await fixture.people.putMembership({app: "slop", personId, memberId, state: "active", review: null, firstName: "Ada", profile: {canary: "BOOT_PRIVATE_PROFILE"}, joinedAt: now, leftAt: null});
      await fixture.people.addConsent({e164, app: "slop", state: "opted_in", source: "local-boot-test", at: now});
      await fixture.runtimeFor("slop")!.scoped(async tx => {
        await tx`insert into network.members (app_id, id, name, home_city, age, person_id, account_status)
          values ('slop', ${memberId}, 'Ada Lovelace', 'nyc', 25, ${personId}, 'active')`;
        await tx`insert into network.facets (app_id, id, member_id, kind, value, privacy_scope, provenance, status)
          values ('slop', 'boot_shared', ${memberId}, 'interest', 'plays chess', 'shareable', 'said', 'confirmed'),
            ('slop', 'boot_private', ${memberId}, 'interest', 'BOOT_PRIVATE_FACET', 'agent_private', 'said', 'confirmed')`;
      });
    } finally { await fixture.close(); }
    const svcUrl = Object.assign(new URL(url), { username: role }).toString();
    const env: Record<string, string> = {
      ...process.env as Record<string, string>, ...DEPLOYED, DATABASE_URL: svcUrl, MIGRATION_DATABASE_URL: url, PORT: String(port), STAFF_PORT: String(staff), TICK_MS: "3600000",
      PLATFORM_DB_ENVIRONMENT_INIT: "1", BUILD_ID: "boot-test", NODE_ENV: "", NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", NTWRK_LIVE_APPROVED: "",
      NETWORK_DATABASE_URL: svcUrl, NETWORK_SERVICE_AUDIT_DATABASE_URL: svcUrl,
      NETWORK_SERVICE_AGENT_TOKEN: agentToken, NETWORK_SERVICE_TOKENS: `admin@slop:${agentToken},admin@*:${staffToken}`, NETWORK_SERVICE_CONSOLE_TOKEN: "",
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
      const privateCall = (path: string, token = agentToken, body: unknown = {e164}, method = "POST", listener = staff) => fetch(`http://127.0.0.1:${listener}${path}`, {
        method, headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
        ...(method === "POST" ? {body: JSON.stringify(body)} : {}),
      });
      for (const endpoint of ["membership", "context"]) {
        const path = `/apps/slop/agent/${endpoint}`;
        expect((await privateCall(path, agentToken, {e164}, "POST", port)).status).toBe(404);
        expect((await privateCall(path, staffToken)).status).toBe(403);
        const response = await privateCall(path);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(endpoint === "membership" ? {app: "slop", personId, memberId}
          : {app: "slop", memberId, firstName: "Ada", city: "nyc", state: "open", stateFrom: null, stateUntil: null, facets: ["plays chess"], activeItems: null});
        expect((await privateCall(`/apps/friends/agent/${endpoint}`)).status).toBe(403);
      }
      const status = await privateCall("/agent/membership-status");
      expect(status.status).toBe(200);
      expect(status.headers.get("cache-control")).toBe("no-store");
      expect(await status.json()).toEqual({active: true});
      expect((await privateCall("/agent/membership-status", agentToken, {e164}, "POST", port)).status).toBe(404);
      expect((await privateCall("/agent/membership-status", staffToken)).status).toBe(403);
      for (const text of ["slop", "hello"]) {
        const response = await privateCall("/agent/route", agentToken, {e164, text});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({app: "slop", personId, memberId});
      }
      expect((await privateCall("/agent/route", agentToken, {e164, text: "slop"}, "POST", port)).status).toBe(404);
      expect((await privateCall("/agent/route", staffToken, {e164, text: "slop"})).status).toBe(403);
      expect((await privateCall("/agent/route", agentToken, {e164, text: "friends"})).status).toBe(403);
      expect((await privateCall("/matching?app=slop", agentToken, {on: true})).status).toBe(403);
      expect((await privateCall("/health?app=slop", agentToken, {}, "GET")).status).toBe(403);
      expect((await privateCall("/health?app=slop", staffToken, {}, "GET")).status).toBe(200);
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
    expect(logs).not.toContain(agentToken);
    expect(logs).not.toContain(staffToken);
    expect(logs).not.toMatch(/BOOT_PRIVATE|12125550189/);
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


describe.skipIf(!pgAvailable)("Cloud host membership lookup (isolated Postgres, no sends)", () => {
  test("requires designated app-scoped server authority and rechecks membership without exposing profiles", async () => {
    const url = await emptyDb("agent_binding");
    let svc: NetworkService | undefined;
    const others: NetworkService[] = [];
    try {
      await migrate(url);
      const now = Date.parse("2026-10-08T12:00:00Z");
      const serverToken = "cloud-host-fixture-" + "m".repeat(40), staffToken = "human-staff-fixture-" + "h".repeat(40);
      const options = {url, tokens: `admin@slop:${serverToken},admin@*:${staffToken}`, clock: {now: () => now}, env: {PLATFORM_ENV: "dev"}, notify: false as const, photoStorage: null, log: () => {}};
      svc = await NetworkService.fromDatabase({...options, agentToken: serverToken});
      const e164 = "+12125550181", personId = randomUUID(), memberId = "slop_server_fixture";
      await svc.people.createPerson({id: personId, e164, method: "inbound_message", at: now, lowestAge: 25, phoneHash: svc.accounts.phoneHash(e164)});
      await svc.people.putMembership({app: "slop", personId, memberId, state: "active", review: null, firstName: "Private fixture", profile: {canary: "DO_NOT_RETURN_PROFILE"}, joinedAt: now, leftAt: null});
      await svc.people.addConsent({e164, app: "slop", state: "opted_in", source: "local-security-test", at: now});
      const request = (path: string, token: string | null = serverToken, body: unknown = {e164}, method = "POST") => new Request(`http://127.0.0.1:4848${path}`, {
        method, headers: {"content-type": "application/json", ...(token ? {authorization: `Bearer ${token}`} : {})},
        ...(method === "POST" ? {body: JSON.stringify(body)} : {}),
      });
      const call = async (path: string, token: string | null = serverToken, body: unknown = {e164}, method = "POST") => {
        const response = await svc!.fetch(request(path, token, body, method));
        expect(response.headers.get("cache-control")).toBe("no-store");
        return response;
      };
      expect((await call("/agent/membership?app=slop", null)).status).toBe(401);
      expect((await call("/agent/membership?app=slop", staffToken)).status).toBe(403);
      expect((await call("/agent/membership?app=friends")).status).toBe(403);
      expect((await call("/agent/membership")).status).toBe(400);
      expect((await call("/agent/membership?app=slop", serverToken, {e164, personId: "forged"})).status).toBe(400);
      expect((await call("/agent/membership?app=slop", serverToken, {e164: "2125550181"})).status).toBe(400);
      expect((await call("/agent/membership?app=slop", serverToken, {}, "GET")).status).toBe(405);
      // The designated agent reader must not inherit staff mutation authority.
      expect((await svc.fetch(request("/matching?app=slop", serverToken, {on: true}))).status).toBe(403);
      expect((await svc.fetch(request("/health?app=slop", serverToken, {}, "GET"))).status).toBe(403);
      expect((await svc.fetch(request("/health?app=slop", staffToken, {}, "GET"))).status).toBe(200);
      const response = await call("/apps/slop/agent/membership");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({app: "slop", personId, memberId});
      const [audit] = await svc.sql`select target_id, app_id, detail from network.staff_audit where action = 'read_agent_membership'`;
      expect(audit.app_id).toBe("slop");
      expect(audit.target_id).not.toBe(e164);
      expect(JSON.stringify(audit)).not.toContain(e164);
      expect(JSON.stringify(audit)).not.toContain("DO_NOT_RETURN_PROFILE");
      // Even an otherwise valid server credential cannot expose the private route through publicFetch.
      expect((await svc.publicFetch(request("/agent/membership?app=slop"))).status).toBe(404);
      await svc.people.addConsent({e164, app: null, state: "opted_out", source: "local-stop-test", at: now+1});
      const stopped = await call("/agent/membership?app=slop");
      const absent = await call("/agent/membership?app=slop", serverToken, {e164: "+12125550182"});
      expect(stopped.status).toBe(404); expect(absent.status).toBe(404);
      expect(await stopped.json()).toEqual(await absent.json());
      const disabled = await NetworkService.fromDatabase(options); others.push(disabled);
      expect((await disabled.fetch(request("/agent/membership?app=slop"))).status).toBe(503);
      const undesignated = await NetworkService.fromDatabase({...options, agentToken: "not-in-token-registry"}); others.push(undesignated);
      expect((await undesignated.fetch(request("/agent/membership?app=slop", "not-in-token-registry"))).status).toBe(401);
      const consoleOnly = await NetworkService.fromDatabase({...options, consoleToken: serverToken, agentToken: serverToken}); others.push(consoleOnly);
      expect((await consoleOnly.fetch(request("/agent/membership?app=slop"))).status).toBe(503);
    } finally {
      for (const other of others) await other.close();
      await svc?.close();
      await dropDb(url);
    }
  }, 120_000);
});


describe.skipIf(!pgAvailable)("Agent context store (isolated Postgres runtime, no sends)", () => {
  test("reads fresh shareable context only and denies revoked authority", async () => {
    const url = await emptyDb("agent_context");
    let svc: NetworkService | undefined;
    try {
      await migrate(url);
      const now = Date.parse("2026-10-08T12:00:00Z");
      const serverToken = "context-host-" + "c".repeat(40), staffToken = "context-staff-" + "s".repeat(40);
      svc = await NetworkService.fromDatabase({url, agentToken: serverToken, tokens: `admin@slop:${serverToken},admin@*:${staffToken}`, clock: {now: () => now}, env: {PLATFORM_ENV: "dev"}, notify: false, photoStorage: null, log: () => {}});
      const e164 = "+12125550183", personId = randomUUID(), memberId = "same_context_member";
      await svc.people.createPerson({id: personId, e164, method: "inbound_message", at: now, lowestAge: 25, phoneHash: svc.accounts.phoneHash(e164)});
      const friendsId = "friends_context_member";
      const membership = (app: "slop" | "friends") => ({app, personId, memberId: app === "slop" ? memberId : friendsId, state: "active" as const, review: null, firstName: "Ada", profile: {}, joinedAt: now, leftAt: null});
      for (const app of ["slop", "friends"] as const) {
        await svc.people.putMembership(membership(app));
        await svc.people.addConsent({e164, app, state: "opted_in", source: "local-context-test", at: now});
        await svc.runtimeFor(app)!.scoped(async tx => {
          await tx`insert into network.members (app_id, id, name, home_city, age, person_id, account_status)
            values (${app}, ${membership(app).memberId}, 'Ada Lovelace', 'nyc', 25, ${personId}, 'active')`;
        });
      }
      const contextRequest = (path: string, token: string | null = serverToken, body: unknown = {e164}, method = "POST") => new Request(`http://127.0.0.1:4848${path}`, {
        method, headers: {"content-type": "application/json", ...(token ? {authorization: `Bearer ${token}`} : {})},
        ...(method === "POST" ? {body: JSON.stringify(body)} : {}),
      });
      const contextCall = async (path = "/apps/slop/agent/context", token: string | null = serverToken, body: unknown = {e164}, method = "POST") => {
        const response = await svc!.fetch(contextRequest(path, token, body, method));
        expect(response.headers.get("cache-control")).toBe("no-store");
        return response;
      };
      const rt = svc.runtimeFor("slop")!;
      const options = {app: "slop" as const, memberId, e164, personId, accounts: svc.accounts, runtime: rt};
      const store = new AgentContextStore(options);
      await rt.scoped(async tx => {
        await tx`insert into network.members (app_id, id, name, home_city, age) values ('slop', 'other_context_member', 'Other Person', 'nyc', 30)`;
        const facets = [
          {id: "own_shared", member_id: memberId, value: "plays chess"},
          {id: "own_private", member_id: memberId, value: "PRIVATE_CONTEXT_CANARY", privacy_scope: "agent_private"},
          {id: "own_matchable", member_id: memberId, value: "MATCHABLE_CONTEXT_CANARY", privacy_scope: "matchable"},
          {id: "own_opportunity", member_id: memberId, value: "OPPORTUNITY_CONTEXT_CANARY", privacy_scope: "opportunity_specific"},
          {id: "other_shared", member_id: "other_context_member", value: "OTHER_MEMBER_CONTEXT_CANARY"},
          {id: "private_disguised_shared", member_id: memberId, value: "PRIVATE_CONTEXT_CANARY"},
          {id: "other_name", member_id: memberId, value: "ask Other Person about chess"},
          {id: "other_first_name", member_id: memberId, value: "ask Other about chess"},
          {id: "unconfirmed", member_id: memberId, value: "UNCONFIRMED_CONTEXT_CANARY", status: "proposed"},
          {id: "sensitive", member_id: memberId, value: "SENSITIVE_CONTEXT_CANARY", sensitive: "health"},
          {id: "future", member_id: memberId, value: "FUTURE_CONTEXT_CANARY", valid_from: new Date(now+1)},
          {id: "expired", member_id: memberId, value: "EXPIRED_CONTEXT_CANARY", valid_to: new Date(now)},
          {id: "phone", member_id: memberId, value: "call +12125550184"},
          {id: "handle", member_id: memberId, value: "DM @ada_handle"},
          {id: "local_phone", member_id: memberId, value: "call 555-0102"},
          {id: "street", member_id: memberId, value: "123 Bedford Ave"},
          {id: "url", member_id: memberId, value: "https://example.com"},
          {id: "obfuscated_phone", member_id: memberId, value: "call ５５５-０１０２"},
        ];
        for (const f of facets) await tx`insert into network.facets ${tx({app_id: "slop", kind: "interest", privacy_scope: "shareable", provenance: "said", status: "confirmed", ...f})}`;
      });
      await svc.runtimeFor("friends")!.scoped(async tx => {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, privacy_scope, provenance)
          values ('friends', 'friend_shared', ${friendsId}, 'interest', 'FRIENDS_CONTEXT_CANARY', 'shareable', 'said')`;
      });
      const before = await svc.sql`select (select count(*)::int from network.network_state) as states,
        (select count(*)::int from network.events) as events, (select count(*)::int from network.messages) as messages`;
      expect(await store.getMemberContext(memberId, "slop")).toEqual({app: "slop", memberId, firstName: "Ada", city: "nyc", state: "open", stateFrom: null, stateUntil: null, facets: ["plays chess"], activeItems: null});
      expect((await contextCall("/apps/slop/agent/context", null)).status).toBe(401);
      expect((await contextCall("/apps/slop/agent/context", staffToken)).status).toBe(403);
      expect((await contextCall("/apps/friends/agent/context")).status).toBe(403);
      expect((await contextCall("/agent/context")).status).toBe(400);
      expect((await contextCall("/apps/slop/agent/context", serverToken, {e164, memberId: "forged"})).status).toBe(400);
      expect((await contextCall("/apps/slop/agent/context", serverToken, {e164: "2125550183"})).status).toBe(400);
      expect((await contextCall("/apps/slop/agent/context", serverToken, {}, "GET")).status).toBe(405);
      const response = await contextCall();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(await store.getMemberContext(memberId, "slop"));
      expect((await svc.publicFetch(contextRequest("/apps/slop/agent/context"))).status).toBe(404);
      const [audit] = await svc.sql`select target_id, app_id, detail from network.staff_audit where action = 'read_agent_context'`;
      expect(audit.app_id).toBe("slop");
      expect(audit.target_id).not.toBe(e164);
      expect(JSON.stringify(audit)).not.toMatch(/1212555|CANARY|Ada|plays chess/);
      expect(await store.getMemberContext(memberId, "friends")).toBeNull();
      expect(await store.getMemberContext("other_context_member", "slop")).toBeNull();
      const friends = new AgentContextStore({...options, app: "friends", memberId: friendsId, runtime: svc.runtimeFor("friends")!});
      expect((await friends.getMemberContext(friendsId, "friends"))!.facets).toEqual(["FRIENDS_CONTEXT_CANARY"]);
      expect(await new AgentContextStore({...options, personId: randomUUID()}).getMemberContext(memberId, "slop")).toBeNull();
      expect(await new AgentContextStore({...options, memberId: "absent_context_member"}).getMemberContext("absent_context_member", "slop")).toBeNull();
      // A platform membership alone must not cause ConsentNetwork.member() to fabricate a profile.
      await svc.people.putMembership({...membership("slop"), memberId: "absent_context_member"});
      expect(await new AgentContextStore({...options, memberId: "absent_context_member"}).getMemberContext("absent_context_member", "slop")).toBeNull();
      expect(rt.net.memberList().some(m => m.id === "absent_context_member")).toBe(false);
      await svc.people.putMembership(membership("slop"));
      // Direct database changes must reach the next read, with no cached plugin state.
      await rt.scoped(async tx => { await tx`update network.members set participation_state = 'quiet' where app_id = 'slop' and id = ${memberId}`; });
      expect((await store.getMemberContext(memberId, "slop"))!.state).toBe("busy");
      await rt.scoped(async tx => { await tx`update network.members set participation_state = 'receiving' where app_id = 'slop' and id = ${memberId}`; });
      expect(await store.getMemberContext(memberId, "slop")).toBeNull();
      await rt.scoped(async tx => { await tx`update network.members set participation_state = 'normal' where app_id = 'slop' and id = ${memberId}`; });
      const after = await svc.sql`select (select count(*)::int from network.network_state) as states,
        (select count(*)::int from network.events) as events, (select count(*)::int from network.messages) as messages`;
      expect(after).toEqual(before);
      // Revoke after the first genuine Accounts check while the runtime lock is occupied.
      let release!: () => void, occupied!: () => void, checked!: () => void;
      const unlocked = new Promise<void>(resolve => { release = resolve; });
      const acquired = new Promise<void>(resolve => { occupied = resolve; });
      const firstCheck = new Promise<void>(resolve => { checked = resolve; });
      const lock = rt.store.withLock(async () => { occupied(); await unlocked; });
      await acquired;
      let checks = 0;
      const rechecked = new AgentContextStore({...options, accounts: {activeMembership: async (...args) => {
        const result = await svc!.accounts.activeMembership(...args);
        if (++checks === 1) checked();
        return result;
      }}});
      const pending = rechecked.getMemberContext(memberId, "slop");
      try {
        await firstCheck;
        await svc.people.putMembership({...membership("slop"), state: "removed", leftAt: now+1});
      } finally { release(); }
      await lock;
      expect(await pending).toBeNull();
      expect(checks).toBe(2);
      const revoked = await contextCall();
      const absent = await contextCall("/apps/slop/agent/context", serverToken, {e164: "+12125550185"});
      expect(revoked.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(await revoked.json()).toEqual(await absent.json());
      await svc.people.putMembership(membership("slop"));
      expect(await store.getMemberContext(memberId, "slop")).not.toBeNull();
      await svc.people.addConsent({e164, app: "slop", state: "opted_out", source: "local-context-leave", at: now+1});
      expect(await store.getMemberContext(memberId, "slop")).toBeNull();
      expect((await friends.getMemberContext(friendsId, "friends"))!.facets).toEqual(["FRIENDS_CONTEXT_CANARY"]);
      await svc.people.addConsent({e164, app: "slop", state: "opted_in", source: "local-context-rejoin", at: now+2});
      await svc.people.addConsent({e164, app: null, state: "opted_out", source: "local-context-stop", at: now+3});
      expect(await store.getMemberContext(memberId, "slop")).toBeNull();
      expect(await friends.getMemberContext(friendsId, "friends")).toBeNull();
      const stopped = await contextCall();
      expect(stopped.status).toBe(404);
      expect(await stopped.json()).toEqual({ok: false, error: "unavailable"});
    } finally {
      await svc?.close();
      await dropDb(url);
    }
  }, 120_000);
});

describe.skipIf(!pgAvailable)("Cloud host canonical app route (isolated Postgres, no sends)", () => {
  test("routes whole keywords and existing conversation state, then checks selected-app authority without writes", async () => {
    const url = await emptyDb("agent_route");
    const services: NetworkService[] = [];
    try {
      await migrate(url);
      const now = Date.parse("2026-10-08T12:00:00Z"), e164 = "+12125550186", personId = randomUUID();
      const serverToken = "route-host-" + "r".repeat(40), staffToken = "route-human-" + "h".repeat(40);
      const options = {url, clock: {now: () => now}, env: {PLATFORM_ENV: "dev"}, notify: false as const, photoStorage: null, log: () => {}};
      const svc = await NetworkService.fromDatabase({...options, agentToken: serverToken, tokens: `admin@*:${serverToken},admin@*:${staffToken}`}); services.push(svc);
      await svc.people.createPerson({id: personId, e164, method: "inbound_message", at: now, lowestAge: 25, phoneHash: svc.accounts.phoneHash(e164)});
      for (const app of ["slop", "friends"] as const) {
        const memberId = `${app}_route_member`;
        await svc.people.putMembership({app, personId, memberId, state: "active", review: null, firstName: "Route fixture", profile: {canary: "ROUTE_PROFILE_CANARY"}, joinedAt: now, leftAt: null});
        await svc.people.addConsent({e164, app, state: "opted_in", source: "local-route-test", at: now});
        await svc.runtimeFor(app)!.scoped(async tx => {
          await tx`insert into network.members (app_id, id, name, home_city, age, person_id, account_status)
            values (${app}, ${memberId}, 'Route Fixture', 'nyc', 25, ${personId}, 'active')`;
        });
      }
      // The real shared-line router reads this persisted outbound history, without delivering it.
      await svc.runtimeFor("friends")!.scoped(async tx => {
        await tx`insert into network.messages (id, app_id, member_id, direction, channel, body, status, ts)
          values ('friends_route_last_out', 'friends', 'friends_route_member', 'outbound', 'imessage', 'LOCAL_ROUTE_HISTORY_CANARY', 'dry_run', ${new Date(now)})`;
      });
      const request = (text = "slop", token: string | null = serverToken, path = "/agent/route", body: unknown = {e164, text}, method = "POST") => new Request(`http://127.0.0.1:4848${path}`, {
        method, headers: {"content-type": "application/json", ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(method === "POST" ? {body: JSON.stringify(body)} : {}),
      });
      const call = async (text = "slop", token: string | null = serverToken, path = "/agent/route", body: unknown = {e164, text}, target = svc, method = "POST") => {
        const response = await target.fetch(request(text, token, path, body, method));
        expect(response.headers.get("cache-control")).toBe("no-store");
        return response;
      };
      const counts = () => svc.sql`select (select count(*)::int from network.messages) as messages,
        (select count(*)::int from network.network_state) as states, (select count(*)::int from network.events) as events,
        (select count(*)::int from platform.consent_events) as consent, (select count(*)::int from platform.memberships) as memberships,
        (select count(*)::int from platform.pending_texts) as pending`;
      const before = await counts();
      const statusCall = (body: unknown = {e164}, token: string | null = serverToken, path = "/agent/membership-status", target = svc, method = "POST") => call("", token, path, body, target, method);
      const active = await statusCall();
      expect(active.status).toBe(200);
      expect(await active.json()).toEqual({active: true});
      expect((await statusCall({e164}, null)).status).toBe(401);
      expect((await statusCall({e164}, staffToken)).status).toBe(403);
      for (const path of ["/agent/membership-status?app=slop", "/agent/membership-status?city=nyc"]) expect((await statusCall({e164}, serverToken, path)).status).toBe(400);
      for (const body of [{e164, text: "PRIVATE_PERSONAL_TEXT"}, {e164, app: "slop"}, {e164, personId}, {e164: "2125550186"}]) expect((await statusCall(body)).status).toBe(400);
      expect((await statusCall({}, serverToken, "/agent/membership-status", svc, "GET")).status).toBe(405);
      expect((await svc.publicFetch(request("", serverToken, "/agent/membership-status", {e164}))).status).toBe(404);
      expect(await (await statusCall({e164: "+12125550187"})).json()).toEqual({active: false});
      const disabled = await NetworkService.fromDatabase(options); services.push(disabled);
      expect((await statusCall({e164}, serverToken, "/agent/membership-status", disabled)).status).toBe(503);
      for (const [text, app] of [["slop", "slop"], ["join slop.date", "slop"], ["friends", "friends"], ["join friends.help", "friends"], ["my ex is on slop.date", "friends"]] as const) {
        const response = await call(text);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({app, personId, memberId: `${app}_route_member`});
      }
      expect((await call("slop", null)).status).toBe(401);
      expect((await call("slop", staffToken)).status).toBe(403);
      expect((await call("slop", serverToken, "/agent/route?app=friends")).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route?city=nyc")).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route", {e164, text: "slop", app: "friends"})).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route", {e164, text: "slop", personId: "forged"})).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route", {e164, text: 42})).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route", {e164: "2125550186", text: "slop"})).status).toBe(400);
      expect((await call("slop", serverToken, "/agent/route", {}, svc, "GET")).status).toBe(405);
      expect((await svc.publicFetch(request())).status).toBe(404);
      const restricted = await NetworkService.fromDatabase({...options, agentToken: serverToken, tokens: `admin@slop:${serverToken}`}); services.push(restricted);
      // The fallback routes to friends, but slop membership still permits sending
      // text to the canonical router. Preflight must not use the fallback app.
      expect(await (await statusCall({e164}, serverToken, "/agent/membership-status", restricted)).json()).toEqual({active: true});
      expect((await call("friends", serverToken, "/agent/route", {e164, text: "friends"}, restricted)).status).toBe(403);
      expect((await call("slop", serverToken, "/agent/route", {e164, text: "slop"}, restricted)).status).toBe(200);
      const unauthorized = await NetworkService.fromDatabase({...options, agentToken: serverToken, tokens: `admin@peon:${serverToken}`}); services.push(unauthorized);
      expect(await (await statusCall({e164}, serverToken, "/agent/membership-status", unauthorized)).json()).toEqual({active: false});
      expect(await counts()).toEqual(before);
      const statusAudit = await svc.sql`select target_id, app_id, detail from network.staff_audit where action = 'read_agent_membership_status' order by id`;
      expect(statusAudit.length).toBe(2);
      expect(statusAudit.every((row: {target_id: string}) => row.target_id === svc.accounts.phoneHash(e164))).toBe(true);
      expect(JSON.stringify(statusAudit)).not.toMatch(/1212555|PRIVATE_PERSONAL_TEXT|CANARY|Route Fixture/);
      const audit = await svc.sql`select target_id, app_id, detail from network.staff_audit where action = 'read_agent_route' order by id`;
      expect(audit.length).toBe(6);
      expect(new Set(audit.map((row: {app_id: string}) => row.app_id))).toEqual(new Set(["slop", "friends"]));
      expect(audit.every((row: {target_id: string}) => row.target_id === svc.accounts.phoneHash(e164))).toBe(true);
      expect(JSON.stringify(audit)).not.toMatch(/1212555|my ex|join slop|CANARY|Route Fixture/);
      const absent = await call("slop", serverToken, "/agent/route", {e164: "+12125550187", text: "slop"});
      expect(absent.status).toBe(404);
      await svc.people.addConsent({e164, app: null, state: "opted_out", source: "local-route-stop", at: now+1});
      expect(await (await statusCall()).json()).toEqual({active: false});
      const stopped = await call("STOP");
      expect(stopped.status).toBe(404);
      expect(await stopped.json()).toEqual(await absent.json());
    } finally {
      for (const service of services) await service.close();
      await dropDb(url);
    }
  }, 120_000);
});

// Signed service ingress over a real localhost HTTP server and isolated Postgres.
// The adapter records only attempts; no provider, model, OTP or photo is called.
describe.skipIf(!pgAvailable)("gateway service turns (real HTTP and Postgres, no sends)", () => {
  const turnSecret = "local-turn-signing-fixture-" + "t".repeat(40);
  const now = Date.parse("2026-10-09T12:00:00Z");
  async function fixture(name: string) {
    const url = await emptyDb(`service_turn_${name}`);
    await migrate(url);
    const sends: Array<{id: string; to?: string; body: string}> = [];
    let time = now;
    const options = { url, serviceTurnSecret: turnSecret, clock: {now: () => time}, env: {PLATFORM_ENV: "dev"}, photoStorage: null, log: () => {}, adapter: {
      name: "dry_run" as const, storedStatus: "queued", flush: async () => [],
      deliver: async (messages: import("../../packages/network/service/channel.ts").Outbound[]) => {
        sends.push(...messages);
        return messages.map(message => ({id: message.id, status: "dry_run"}));
      },
      direct: async (to: string, body: string, id: string) => { sends.push({to, body, id}); return "dry_run"; },
    }};
    let service = await NetworkService.fromDatabase(options);
    const backend = () => createBackend({svc: service, config: loadConfig({PLATFORM_ENV: "dev", DATABASE_URL: url}), log: {info() {}, error() {}} as any, ping: async () => true});
    let api = backend();
    let server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: api.publicFetch});
    const {svcSign} = await import("../../packages/plugin-network/src/backend/svc-auth.ts");
    return {
      url, sends, get service() {return service;}, advance(at: number) { time = at; },
      async call(payload: unknown, path = "/internal/turn", secret = turnSecret, signedId?: string) {
        const b = payload as {messageId: string};
        const raw = JSON.stringify(payload);
        const headers = await svcSign(secret, {method: "POST", path: new URL(path, "http://x").pathname, id: signedId ?? (path === "/internal/turn-receipt" ? `${b.messageId}:receipt` : b.messageId), body: raw, nowS: Math.floor(time / 1000)});
        const response = await fetch(new URL(path, server.url), {method: "POST", headers: {"content-type": "application/json", ...headers}, body: raw});
        expect(response.headers.get("cache-control")).toBe("no-store");
        return {status: response.status, body: await response.json() as any};
      },
      async restart() { await server.stop(true); await service.close(); service = await NetworkService.fromDatabase(options); await service.start(); api = backend(); server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: api.publicFetch}); },
      async close() { await server.stop(true); await service.close(); await dropDb(url); },
    };
  }
  const message = (messageId: string, from: string, text: string, app?: "ntwrk" | "friends" | "slop" | "peon") => ({messageId, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: now, ...(app ? {app} : {})});

  test("claims before join/consent effects, replays across restart, binds channel and payload, and acknowledges exact outputs", async () => {
    const f = await fixture("replay");
    try {
      const input = message("join-request", "+12125550160", "friends");
      expect((await f.call(input, "/internal/turn", "wrong-secret-" + "w".repeat(40))).status).toBe(401);
      expect((await f.call(input, "/internal/turn?app=slop")).status).toBe(400);
      const concurrent = await Promise.all([f.call(input), f.call(input)]);
      const first = concurrent.find(result => result.status === 200)!;
      expect(first.status).toBe(200);
      for (const result of concurrent) {
        if (result.status === 409) expect(result.body).toEqual({error: "turn_unresolved", retryable: false});
        else expect(result).toEqual(first);
      }
      expect(first.body).toMatchObject({outcome: "handled", delivery: "collected", accountEligible: true, reason: "join_asked"});
      expect(first.body.replies.length).toBe(1);
      expect(first.body.replyIds.length).toBe(1);
      expect(f.sends).toEqual([]);
      const counts = () => f.service.sql`select (select count(*)::int from platform.pending_texts) as pending, (select count(*)::int from platform.rate_limits) as hits`;
      const before = await counts();
      expect(await f.call(input)).toEqual(first);
      expect((await f.call({...input, text: "changed"})).status).toBe(409);
      expect(await counts()).toEqual(before);
      expect((await f.call({...input, channel: "twilio", transport: "sms"})).status).toBe(200);
      expect((await f.service.sql`select channel from platform.service_turns where message_id = 'join-request'`).length).toBe(2);
      await f.restart();
      expect(await f.call(input)).toEqual(first);
      expect(f.sends).toEqual([]);
      const receipt = {channel: input.channel, messageId: input.messageId, replyIds: first.body.replyIds, outcome: "accepted", providerMessageIds: ["fixture-provider-accepted"], historyRecorded: true};
      expect((await f.call({...receipt, replyIds: ["other-turn"]}, "/internal/turn-receipt")).status).toBe(409);
      expect((await f.call({...receipt, historyRecorded: false}, "/internal/turn-receipt")).status).toBe(400);
      expect(await f.call(receipt, "/internal/turn-receipt")).toEqual({status: 200, body: {ok: true, replayed: false}});
      expect(await f.call(receipt, "/internal/turn-receipt")).toEqual({status: 200, body: {ok: true, replayed: true}});
      expect((await f.call({...receipt, providerMessageIds: ["changed"]}, "/internal/turn-receipt")).status).toBe(409);
      const rows = await f.service.sql`select status from platform.service_turn_replies where reply_id = ${first.body.replyIds[0]}`;
      expect(rows[0].status).toBe("sent");
    } finally { await f.close(); }
  }, 120_000);

  test("isolates simultaneous users/apps and a tick, preserves silent handled turns, and returns canonical minor context", async () => {
    const f = await fixture("causal");
    try {
      const a = message("adult-join", "+12125550161", "Sam, 29", "friends");
      const b = message("minor-join", "+12125550162", "Kim, 16", "peon");
      const [adult, minor] = await Promise.all([f.call(a), f.call(b), f.service.tick()]);
      expect(adult.status).toBe(200); expect(minor.status).toBe(200);
      expect(adult.body.replies.join(" ")).not.toContain("Kim");
      expect(minor.body.replies.join(" ")).not.toContain("Sam");
      expect(f.sends).toEqual([]);
      for (const [app, id] of [["friends", adult.body.memberId], ["peon", minor.body.memberId]] as const) {
        await f.service.runtimeFor(app)!.unitOfWork(n => {
          const state = n.exportState();
          const member = state.members.find(member => member.id === id)!;
          member.stage = "active"; member.awaiting = undefined;
          n.importState(state);
        });
      }
      const quiet = await f.call(message("quiet-ack", a.from, "thanks", "friends"));
      expect(quiet.body).toMatchObject({outcome: "handled", replies: [], replyIds: []});
      const open = await f.call(message("adult-open", a.from, "Can we talk about my day?", "friends"));
      expect(open.body).toMatchObject({outcome: "open", app: "friends", memberId: adult.body.memberId, context: {singlePlayer: false, activeItems: null}});
      const short = await f.call(message("short-question", b.from, "why?", "peon"));
      expect(short.body).toMatchObject({outcome: "open", context: {singlePlayer: true}});
      // A committed person-level age floor is authoritative even while an app's
      // member projection still has its earlier adult age.
      await f.service.people.noteAgeFloor(f.service.accounts.phoneHash(a.from), 16, now);
      const minorOpen = await f.call(message("minor-open", a.from, "Could we chat about the day again?", "friends"));
      expect(minorOpen.body).toMatchObject({outcome: "open", context: {singlePlayer: true}});
      const collected = await f.service.sql`select status, service_turn_id from network.messages where direction = 'outbound'`;
      expect(collected.every((row: any) => row.status === "collected" && typeof row.service_turn_id === "string")).toBe(true);
      expect(f.sends).toEqual([]);
      // An unrelated committed message may share a runtime delivery batch, but
      // it must never become this inbound's reply or acquire its turn key.
      const background = message("peer-join", "+12125550166", "Pat, 30", "friends");
      const peer = await f.call(background);
      const rt = f.service.runtimeFor("friends")!;
      const [help] = await Promise.all([
        f.call(message("help-with-background", a.from, "HELP", "friends")),
        rt.unitOfWork(() => rt.system(peer.body.memberId, "background-message", "OTHER_PERSON_TICK_CANARY", "transactional")),
        rt.tick(),
      ]);
      expect(help.body.replies.join(" ")).not.toContain("OTHER_PERSON_TICK_CANARY");
      expect(f.sends.map(send => send.id)).toEqual(["background-message"]);
      const [other] = await f.service.sql`select service_turn_id, status from network.messages where id = 'background-message'`;
      expect(other.service_turn_id).toBeNull();
      expect(other.status).toBe("dry_run");
    } finally { await f.close(); }
  }, 120_000);

  test("keeps partial effects unresolved without rerunning, and keeps STOP/under-age receipts out of automatic delivery", async () => {
    const f = await fixture("fault");
    try {
      const pending = f.service.people.putPending.bind(f.service.people);
      let writes = 0;
      f.service.people.putPending = async (...args) => { writes++; await pending(...args); throw new Error("fault after the platform commit"); };
      const input = message("partial-join", "+12125550163", "friends");
      expect(await f.call(input)).toEqual({status: 409, body: {error: "turn_unresolved", retryable: false}});
      expect((await f.service.sql`select count(*)::int as n from platform.pending_texts`)[0].n).toBe(1);
      f.service.people.putPending = pending;
      expect((await f.call(input)).status).toBe(409);
      expect(writes).toBe(1);
      await f.restart();
      expect((await f.call(input)).status).toBe(409);
      const stop = message("stop-once", "+12125550164", "STOP");
      const stopped = await f.call(stop);
      expect(stopped.body).toMatchObject({outcome: "handled", replyKind: "compliance", accountEligible: false, consent: {state: "opted_out", scope: "all"}});
      expect(await f.call(stop)).toEqual(stopped);
      expect((await f.service.sql`select count(*)::int as n from platform.consent_events where ref = 'in:blooio:stop-once'`)[0].n).toBe(1);
      const underage = await f.call(message("decline", "+12125550165", "Lee, 12", "friends"));
      expect(underage.body).toMatchObject({outcome: "handled", replyKind: "compliance", accountEligible: false, reason: "under_age"});
      expect((await f.service.sql`select count(*)::int as n from platform.phone_identities where e164 = '+12125550165'`)[0].n).toBe(0);
      const receipt = {channel: "blooio", messageId: "stop-once", replyIds: stopped.body.replyIds, outcome: "unknown", providerMessageIds: [], historyRecorded: false};
      expect((await f.call(receipt, "/internal/turn-receipt")).status).toBe(200);
      expect((await f.service.sql`select status from platform.service_turn_replies where reply_id = ${stopped.body.replyIds[0]}`)[0].status).toBe("send_unknown");
      await f.restart();
      expect(f.sends).toEqual([]);
      expect((await f.call({...receipt, outcome: "accepted", providerMessageIds: ["recovered-accepted"]}, "/internal/turn-receipt")).status).toBe(200);
      expect(f.sends).toEqual([]);
      // Delete seals a real in-flight claim before its later direct reply write.
      const put = f.service.people.putPending.bind(f.service.people);
      let reached!: () => void, resume!: () => void;
      const effectDone = new Promise<void>(resolve => {reached = resolve;});
      const continueReply = new Promise<void>(resolve => {resume = resolve;});
      f.service.people.putPending = async (...args) => {await put(...args); reached(); await continueReply;};
      const lateInput = message("late-collected-after-delete", "+12125550168", "friends");
      const late = f.call(lateInput);
      await effectDone;
      await f.service.accounts.deleteAll({e164: lateInput.from, personId: null});
      resume();
      expect(await late).toEqual({status: 409, body: {error: "turn_unresolved", retryable: false}});
      f.service.people.putPending = put;
      expect((await f.call(lateInput)).status).toBe(409);
      const [claim] = await f.service.sql`select id, state from platform.service_turns where message_id = 'late-collected-after-delete'`;
      expect(claim.state).toBe("unresolved");
      expect((await f.service.sql`select count(*)::int as n from platform.service_turn_replies where turn_id = ${claim.id}`)[0].n).toBe(0);
      expect(f.sends).toEqual([]);
    } finally { await f.close(); }
  }, 120_000);
  test("actions bind the original open turn, commit canonical participation windows and private signals, and consume one inbox", async () => {
    const f = await fixture("actions");
    try {
      const from = "+12125550167";
      const joined = await f.call(message("action-join", from, "Alex, 28", "friends"));
      const rt = f.service.runtimeFor("friends")!;
      await rt.unitOfWork(n => {
        const state = n.exportState(); const member = state.members.find(member => member.id === joined.body.memberId)!;
        member.stage = "active"; member.awaiting = undefined; n.importState(state);
      });
      const open = await f.call(message("action-origin", from, "Can we talk about my day?", "friends"));
      expect(open.body.outcome).toBe("open");
      const scope = {channel: "blooio", messageId: "action-origin", app: "friends", memberId: joined.body.memberId};
      const state = {...scope, idempotencyKey: "state-1", state: "busy", from: null, until: null, note: null};
      const set = (body: Record<string, unknown>) => f.call(body, "/internal/set-state", turnSecret, String(body.idempotencyKey));
      const changed = await set(state);
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({previous: "open", current: "busy", unchanged: false, replayed: false});
      expect(changed.body.eventId).not.toBeNull();
      expect((await set(state)).body).toMatchObject({...changed.body, replayed: true});
      expect((await set({...state, state: "paused"})).status).toBe(409);
      const same = await set({...state, idempotencyKey: "state-2"});
      expect(same.body).toMatchObject({current: "busy", unchanged: true, eventId: null});
      const [row] = await f.service.sql`select participation_state from network.members where app_id = 'friends' and id = ${joined.body.memberId}`;
      expect(row.participation_state).toBe("quiet");
      const [saved] = await f.service.sql`select state from network.network_state where id = 'friends:nyc'`;
      expect(saved.state.members.find((member: any) => member.id === joined.body.memberId).state).toBe("quiet");
      const future = {...state, idempotencyKey: "state-trip", state: "traveling", from: new Date(now + 3600000).toISOString(), until: new Date(now + 7200000).toISOString(), note: "PRIVATE_STATE_NOTE_CANARY"};
      expect((await set(future)).body).toMatchObject({current: "traveling", from: future.from, until: future.until});
      const view = () => rt.readSnapshot(snapshot => snapshot.members.find(member => member.id === joined.body.memberId)!.state);
      expect(await view()).toBe("quiet");
      const binding = await f.service.accounts.activeMembership(rt.app, {e164: from, personId: null});
      const context = new AgentContextStore({app: "friends", memberId: joined.body.memberId, personId: binding!.person.id, e164: from, accounts: f.service.accounts, runtime: rt});
      await rt.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, privacy_scope, provenance, status)
        values ('friends', 'note-leak-probe', ${joined.body.memberId}, 'fact', 'PRIVATE_STATE_NOTE_CANARY', 'shareable', 'said', 'confirmed')`);
      const upcoming = await context.getMemberContext(joined.body.memberId, "friends");
      expect(upcoming).toMatchObject({state: "traveling", stateFrom: future.from, stateUntil: future.until});
      expect(JSON.stringify(upcoming)).not.toContain("PRIVATE_STATE_NOTE_CANARY");
      f.advance(now + 3600001); await rt.tick(); expect(await view()).toBe("paused");
      f.advance(now + 7200001); await rt.tick(); expect(await view()).toBe("quiet");
      const consent = await f.service.sql`select count(*)::int as n from platform.consent_events`;
      const signals = {...scope, signals: [{kind: "opt_out", evidence: "PRIVATE_SIGNAL_CANARY"}, {kind: "travel", evidence: "Possible trip"}]};
      const signal = await f.call(signals, "/internal/signals", turnSecret, "action-origin:signals");
      expect(signal).toEqual({status: 200, body: {recorded: 2}});
      expect(await f.call(signals, "/internal/signals", turnSecret, "action-origin:signals")).toEqual(signal);
      const facets = await f.service.sql`select privacy_scope, provenance, status from network.facets where value = 'PRIVATE_SIGNAL_CANARY'`;
      expect(facets).toEqual([{privacy_scope: "agent_private", provenance: "inferred", status: "proposed"}]);
      expect(await f.service.sql`select count(*)::int as n from platform.consent_events`).toEqual(consent);
      expect(JSON.stringify(await context.getMemberContext(joined.body.memberId, "friends"))).not.toContain("PRIVATE_SIGNAL_CANARY");
      await f.service.notify!.add({personId: binding!.person.id, app: "friends", eventType: "fixture", subjectId: "own-update", urgency: "normal", summary: "Approved own update"}, now);
      await f.service.notify!.add({personId: binding!.person.id, app: "peon", eventType: "fixture", subjectId: "other-app-update", urgency: "normal", summary: "OTHER_APP_UPDATE_CANARY"}, now);
      const updates = await f.call(scope, "/internal/updates", turnSecret, "action-origin:updates");
      expect(updates).toEqual({status: 200, body: {items: [{summary: "Approved own update"}]}});
      expect(await f.call(scope, "/internal/updates", turnSecret, "action-origin:updates")).toEqual(updates);
      expect(await f.service.updatesFor(binding!.person.id, "friends", "web")).toEqual([]);
      expect((await f.service.updatesFor(binding!.person.id, "peon", "web"))[0].summary).toBe("OTHER_APP_UPDATE_CANARY");
      expect((await set({...state, idempotencyKey: "foreign-member", memberId: "foreign"})).status).toBe(403);
      expect((await set({...state, idempotencyKey: "foreign-channel", channel: "twilio"})).status).toBe(403);
      // A failure after state/event SQL but before PgStore commits rolls back
      // the entire unit, while the earlier durable action claim survives.
      const save = rt.pg.save.bind(rt.pg);
      const beforeFault = await f.service.sql`select count(*)::int as n from network.events where type = 'member_state_requested'`;
      rt.pg.save = (value, effect) => save(value, async tx => { await effect?.(tx); throw new Error("fault before the Network save commit"); });
      const failedState = {...state, idempotencyKey: "state-fault", state: "paused"};
      expect((await set(failedState)).status).toBe(409);
      rt.pg.save = save;
      expect((await set(failedState)).body).toEqual({error: "action_unresolved", retryable: false});
      expect(await view()).toBe("quiet");
      expect(await f.service.sql`select count(*)::int as n from network.events where type = 'member_state_requested'`).toEqual(beforeFault);
      await rt.unitOfWork(() => {});
      expect(rt.net.exportState().members.find(member => member.id === joined.body.memberId)!.state).toBe("quiet");
      await f.service.people.addConsent({e164: from, app: null, state: "opted_out", source: "fixture-revoke", at: now + 7200002});
      expect((await set({...state, idempotencyKey: "revoked"})).status).toBe(403);
      expect(f.sends).toEqual([]);
      await f.service.people.addConsent({e164: from, app: null, state: "opted_in", source: "fixture-restore", at: now + 7200003});
      await f.service.notify!.add({personId: binding!.person.id, app: "friends", eventType: "fixture", subjectId: "delete-race", urgency: "normal", summary: "DELETE_RACE_PRIVATE_CANARY"}, now);
      const deletionOrigin = await f.call(message("delete-race-origin", from, "Can we chat about something else?", "friends"));
      expect(deletionOrigin.body.outcome).toBe("open");
      const readUpdates = f.service.updatesFor.bind(f.service);
      let reached!: () => void, resume!: () => void;
      const readDone = new Promise<void>(resolve => {reached = resolve;});
      const resumeRead = new Promise<void>(resolve => {resume = resolve;});
      f.service.updatesFor = async (...args) => {const value = await readUpdates(...args); reached(); await resumeRead; return value;};
      const late = f.call({...scope, messageId: "delete-race-origin"}, "/internal/updates", turnSecret, "delete-race-origin:updates");
      await readDone;
      await f.service.accounts.deleteAll({e164: from, personId: binding!.person.id});
      resume();
      const sealed = await late;
      expect(sealed).toEqual({status: 409, body: {error: "action_unresolved", retryable: false}});
      expect(JSON.stringify(sealed)).not.toContain("DELETE_RACE_PRIVATE_CANARY");
      f.service.updatesFor = readUpdates;
      const redacted = await f.service.sql`select response from platform.service_turns where message_id = 'action-origin'`;
      expect(redacted[0].response).toEqual({outcome: "ignored", reason: "membership_removed"});
      expect((await f.service.sql`select count(*)::int as n from platform.service_turn_replies`)[0].n).toBe(0);
      expect((await f.service.sql`select count(*)::int as n from platform.service_actions where response is not null`)[0].n).toBe(0);
      expect((await f.call(message("action-origin", from, "Can we talk about my day?", "friends"))).body).toEqual(redacted[0].response);
    } finally { await f.close(); }
  }, 120_000);

  test("Notify app leave erases only its references and keeps other apps, people, STOP and suppression", async () => {
    const f = await fixture("notify_scope");
    try {
      const from = "+12125550170", otherFrom = "+12125550171";
      await f.call(message("notify-friends", from, "Lee, 29", "friends"));
      await f.call(message("notify-peon", from, "Lee, 29", "peon"));
      await f.call(message("notify-other", otherFrom, "Pat, 30", "friends"));
      const person = (await f.service.accounts.personFor(from))!;
      const other = (await f.service.accounts.personFor(otherFrom))!;
      const notify = f.service.notify!, store = notify.store;
      const add = (personId: string, app: string, subjectId: string, summary: string) => notify.add({personId, app, eventType: "fixture", subjectId, urgency: "normal", summary}, now);
      const a = (await add(person.id, "friends", "own-a", "APP_A_PRIVATE_CANARY")).item;
      const b = (await add(person.id, "peon", "own-b", "APP_B_PRIVATE_CANARY")).item;
      const outsider = (await add(other.id, "friends", "other", "OTHER_PERSON_CANARY")).item;
      for (const [deliveryId, personId, itemIds] of [["only-a", person.id, [a.id]], ["only-b", person.id, [b.id]], ["mixed", person.id, [a.id, b.id]], ["other", other.id, [outsider.id]]] as const) {
        await store.recordDelivery({deliveryId, personId, itemIds: [...itemIds], target: "chatgpt", countsTowardCap: true, sentAt: now});
      }
      for (const [token, personId, itemIds] of [["T-AAAAAA", person.id, [a.id]], ["T-BBBBBB", person.id, [b.id]], ["T-CCCCCC", person.id, [a.id, b.id]], ["T-DDDDDD", other.id, [outsider.id]]] as const) {
        await store.insertToken({token, personId, itemIds: [...itemIds], issuedAt: now, expiresAt: now + 86400000});
      }
      await store.setActive(person.id, "chatgpt", true);
      await store.recordOutcome(person.id, "chatgpt", "acted", now);
      await store.setActive(other.id, "claude", true);
      const signals = await store.signals(person.id), otherSignals = await store.signals(other.id);
      await expect(f.service.runtimeFor("friends")!.scoped(tx => tx`select notify.forget_data(${person.id}, 'friends')`)).rejects.toThrow("Notify app erasure requires canonical removal");
      await expect(Promise.resolve(f.service.sql`select notify.forget_data(${person.id}, null)`)).rejects.toThrow("Notify full erasure requires canonical deletion");
      await expect(f.service.runtimeFor("friends")!.scoped(tx => tx`select notify.forget_data(${person.id}, 'peon')`)).rejects.toThrow("Notify app erasure requires canonical app scope");
      await expect(f.service.sql.begin(async tx => {
        await tx.unsafe("set local role platform_service");
        await tx`select set_config('app.app_id', 'friends', true)`;
        await tx`select notify.forget_data(${person.id}, 'friends')`;
      })).rejects.toThrow("Notify app erasure requires canonical removal");
      expect(await store.getItems([a.id, b.id])).toHaveLength(2);
      // Invited/pending memberships may have inbox data before a network row exists.
      await f.service.people.putMembership({app: "ntwrk", personId: person.id, memberId: "notify_pending_member", state: "invited", review: null, firstName: "Lee", profile: {}, joinedAt: null, leftAt: null});
      const pending = (await add(person.id, "ntwrk", "pending", "PENDING_APP_PRIVATE_CANARY")).item;
      await f.service.accounts.leave(f.service.apps.ntwrk, {e164: from, personId: person.id});
      expect(await store.getItems([pending.id])).toEqual([]);
      expect(await store.signals(person.id)).toEqual(signals);
      await f.service.accounts.stop(f.service.apps.friends, {e164: from, personId: person.id});
      const hash = f.service.accounts.phoneHash(from);
      await f.service.people.suppress(hash, "fixture-existing-suppression", now);
      await f.service.accounts.leave(f.service.apps.friends, {e164: from, personId: person.id});
      await f.service.sql.begin(async tx => {
        await tx.unsafe("set local role platform_service");
        await tx`select set_config('app.app_id', 'friends', true)`;
        await tx`select notify.forget_data(${person.id}, 'friends')`;
      });
      expect(await store.getItems([a.id, b.id])).toEqual([expect.objectContaining({id: b.id, summary: "APP_B_PRIVATE_CANARY"})]);
      expect(await store.getDelivery("only-a")).toBeUndefined();
      expect((await store.getDelivery("mixed"))!.itemIds).toEqual([b.id]);
      expect((await store.getDelivery("only-b"))!.itemIds).toEqual([b.id]);
      expect(await store.getToken("T-AAAAAA")).toBeUndefined();
      expect((await store.getToken("T-CCCCCC"))!.itemIds).toEqual([b.id]);
      expect((await store.getToken("T-BBBBBB"))!.itemIds).toEqual([b.id]);
      expect(await store.signals(person.id)).toEqual(signals);
      expect(await store.signals(other.id)).toEqual(otherSignals);
      expect((await store.getDelivery("other"))!.itemIds).toEqual([outsider.id]);
      expect((await store.getToken("T-DDDDDD"))!.itemIds).toEqual([outsider.id]);
      expect(await f.service.accounts.optedIn("peon", from)).toBe(false);
      expect(await f.service.people.isSuppressed(hash)).toBe(true);
      await expect(add(person.id, "friends", "late-erased-app", "LATE_APP_PRIVATE_CANARY")).rejects.toThrow("Notify membership is unavailable");
      expect(await store.recordDelivery({deliveryId: "late-a", personId: person.id, itemIds: [a.id], target: "chatgpt", countsTowardCap: false, sentAt: now})).toBe(false);
      expect(await store.insertToken({token: "T-EEEEEE", personId: person.id, itemIds: [a.id], issuedAt: now, expiresAt: now + 86400000})).toBe(false);
      await f.service.accounts.leave(f.service.apps.peon, {e164: from, personId: person.id});
      expect(await store.unseen(person.id, now)).toEqual([]);
      expect(await store.getDelivery("mixed")).toBeUndefined();
      expect(await store.getToken("T-CCCCCC")).toBeUndefined();
      expect(await store.signals(person.id)).toEqual([]);
      await store.setActive(person.id, "chatgpt", false);
      await store.touch(person.id, "web", now);
      expect(await store.signals(person.id)).toEqual([]);
      expect(await f.service.people.isSuppressed(hash)).toBe(true);
      expect(await store.getItems([outsider.id])).toHaveLength(1);
      expect(await store.signals(other.id)).toEqual(otherSignals);
      await f.restart();
      expect(await f.service.notify!.store.unseen(person.id, now)).toEqual([]);
      expect(await f.service.notify!.store.signals(person.id)).toEqual([]);
      // Last memberships may be left concurrently on different runtime owners.
      await f.call(message("notify-other-peon", otherFrom, "Pat, 30", "peon"));
      await Promise.all([
        f.service.accounts.leave(f.service.apps.friends, {e164: otherFrom, personId: other.id}),
        f.service.accounts.leave(f.service.apps.peon, {e164: otherFrom, personId: other.id}),
      ]);
      expect(await f.service.notify!.store.signals(other.id)).toEqual([]);
      expect(await f.service.notify!.store.getItems([outsider.id])).toEqual([]);
    } finally { await f.close(); }
  }, 120_000);

  test("Notify full deletion waits for accepted projection, erases person data, and fences late writes and restart repair", async () => {
    const f = await fixture("notify_projection_delete");
    try {
      const from = "+12125550172";
      const joined = await f.call(message("notify-delete-join", from, "Alex, 28", "friends"));
      const person = (await f.service.accounts.personFor(from))!;
      const rt = f.service.runtimeFor("friends")!, store = f.service.notify!.store;
      const input = {personId: person.id, app: "ntwrk", eventType: "fixture", subjectId: "not-current-membership", urgency: "normal" as const, summary: "PERSON_PRIVATE_NOTIFY_CANARY"};
      const item = (await f.service.notify!.add(input, now)).item;
      await store.recordDelivery({deliveryId: "person-old-delivery", personId: person.id, itemIds: [item.id], target: "chatgpt", countsTowardCap: true, sentAt: now});
      await store.insertToken({token: "T-FFFFFF", personId: person.id, itemIds: [item.id], issuedAt: now, expiresAt: now + 86400000});
      await store.setActive(person.id, "chatgpt", true);
      const delivered = f.service.delivered.bind(f.service);
      let reached!: () => void, resume!: () => void;
      const projectionStarted = new Promise<void>(resolve => {reached = resolve;});
      const continueProjection = new Promise<void>(resolve => {resume = resolve;});
      f.service.delivered = async (...args) => {reached(); await continueProjection; await delivered(...args);};
      const accepted = rt.unitOfWork(() => rt.system(joined.body.memberId, "notify-delete-accepted", "LATE_PROJECTION_PRIVATE_CANARY", "transactional", "reminder"));
      await projectionStarted;
      let erased = false;
      const deletion = f.service.accounts.deleteAll({e164: from, personId: person.id}).then(() => {erased = true;});
      await Bun.sleep(20);
      expect(erased).toBe(false);
      resume();
      await accepted; await deletion;
      f.service.delivered = delivered;
      for (const table of ["inbox_items", "deliveries", "task_tokens", "surface_signals"]) {
        const [row] = await f.service.sql.unsafe(`select count(*)::int as n from notify.${table} where person_id = $1`, [person.id]);
        expect(row.n).toBe(0);
      }
      expect(await f.service.people.isSuppressed(f.service.accounts.phoneHash(from))).toBe(true);
      expect((await f.service.sql`select count(*)::int as n from network.messages where id = 'notify-delete-accepted'`)[0].n).toBe(0);
      await expect(f.service.notify!.recordSent(input, {deliveryId: "late-deleted-delivery", channel: "imessage", countsTowardCap: true, sentAt: now})).rejects.toThrow("Notify membership is unavailable");
      expect(await store.recordDelivery({deliveryId: "late-deleted-ref", personId: person.id, itemIds: [item.id], target: "chatgpt", countsTowardCap: true, sentAt: now})).toBe(false);
      expect(await store.insertToken({token: "T-GGGGGG", personId: person.id, itemIds: [item.id], issuedAt: now, expiresAt: now + 86400000})).toBe(false);
      await store.setActive(person.id, "chatgpt", true);
      await store.recordOutcome(person.id, "web", "acted", now);
      expect(await store.signals(person.id)).toEqual([]);
      await f.restart();
      await f.service.runtimeFor("friends")!.tick();
      for (const table of ["inbox_items", "deliveries", "task_tokens", "surface_signals"]) {
        const [row] = await f.service.sql.unsafe(`select count(*)::int as n from notify.${table} where person_id = $1`, [person.id]);
        expect(row.n).toBe(0);
      }
    } finally { await f.close(); }
  }, 120_000);

});
