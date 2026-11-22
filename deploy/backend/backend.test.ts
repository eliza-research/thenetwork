// The deployable backend (deploy/backend; docs/deploy.md): config, edge headers, routing, logs,
// shutdown, and one boot of the real process against a database of its own on the dev cluster.
import { setTimeout as sleep } from "node:timers/promises";
import { spawnProcess } from "../../packages/core/src/runtime/process.ts";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_HOST_MAP } from "../../packages/platform/src/apps.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { dropDb, emptyDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { liveSendAllowed } from "../../packages/network/service/channel.ts";
import { SimClock } from "../../packages/core/src/clock.ts";
import { createPublicEventRefresh } from "./public-events.ts";
import { PROXY_MAX_SKEW_S, signProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { PROFILE_REVIEW_DISCONNECT_PATH } from "../../packages/core/src/svc/profile-review-disconnect.ts";
import { PROFILE_REVIEW_WITHDRAWAL_PATH } from "../../packages/core/src/svc/profile-review-withdrawal.ts";
import { calendarOwnerPath } from "../../packages/core/src/generated/calendarFreeBusy.ts";
import { RELAY_PHOTO_RESOLVE_PATH } from "../../packages/core/src/svc/contract.ts";
import {
  BUILD_HEADER, CLIENT_IP, createBackend, ipOf, jsonLogger, liveSendTable, loadConfig, normalizeEdge, PROXY_HEADERS,
  redact, routeLabel, serviceLoginProblem, type BackendConfig, type ServiceLike,
} from "./backend.ts";
import type { BackendBoot } from "../../packages/core/src/generated/bootPolicy.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";

const SECRET = "s".repeat(40);
const DEPLOYED = {
  PLATFORM_ENV: "staging", DATABASE_URL: "postgres://svc@db.invalid/x", MIGRATION_DATABASE_URL: "postgres://owner@db.invalid/x", PLATFORM_HASH_KEY: "h".repeat(40), LEAK_LABEL_KEY: "l".repeat(40), PLATFORM_PROXY_SECRET: SECRET,
  TURNSTILE_SECRET_KEY: "fake", TURNSTILE_SITE_KEY: "fake-site", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_VERIFY_SERVICE_SID: "VAfake",
  SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: `admin@*:${"a".repeat(40)}`, NETWORK_PUBLIC_EVENTS_DATABASE_URL: "postgres://events@db.invalid/x",
  PLATFORM_SESSION_SECRET: "e".repeat(40),
};

describe("config", () => {
  test("isolated signed route cannot enable direct Blooio or proactive Cloud sends", () => {
    const policy = JSON.stringify({authority:{version:1,routeId:"qa",generation:"g1",audience:"network-qa",realmId:"qa"},admitUntil:1000,drainUntil:2000});
    for (const NETWORK_CHANNEL of ["blooio", "eliza_cloud"]) {
      const c = loadConfig({...DEPLOYED,NETWORK_ROUTE_AUTHORITY_POLICY:policy,NETWORK_CHANNEL,BLOOIO_ALLOW_SEND:"1",NTWRK_LIVE_APPROVED:"1",FRIENDS_LIVE_APPROVED:"1",BLOOIO_API_KEY:"synthetic",BLOOIO_FROM:"+12125550142"});
      expect(c.channel).toBe("dry-run");
    }
    expect(() => loadConfig({...DEPLOYED,PLATFORM_ENV:"production",NETWORK_ROUTE_AUTHORITY_POLICY:policy})).toThrow(/staging/);
  });

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

  // spec/bootPolicy.md, "The combined backend entry checks its own database, provider and secret configuration"
  test("a deployed backend refuses to start without the signup connector, the shared line or the staff API (audit OPS29, PER33)", () => {
    // Each of these booted green before: /mcp answered 404, /internal/turn 503 no_secret, every staff route 401.
    for (const k of ["TURNSTILE_SITE_KEY", "NETWORK_SERVICE_TOKENS", "SERVICE_TURN_SECRET", "NETWORK_PUBLIC_EVENTS_DATABASE_URL"]) {
      expect(() => loadConfig({ ...DEPLOYED, [k]: undefined }), k).toThrow(k);
      expect(() => loadConfig({ ...DEPLOYED, PLATFORM_ENV: "production", [k]: undefined }), k).toThrow(k);
    }
    expect(() => loadConfig({ ...DEPLOYED, TURNSTILE_SITE_KEY: "  " })).toThrow("TURNSTILE_SITE_KEY");
    expect(() => loadConfig({ ...DEPLOYED, SERVICE_TURN_SECRET: "t".repeat(31) })).toThrow(/SERVICE_TURN_SECRET of at least 32/);
    expect(() => loadConfig({ ...DEPLOYED, NETWORK_SERVICE_TOKENS: `admin@*:${"a".repeat(40)},reviewer@slop:short-token` })).toThrow(/every NETWORK_SERVICE_TOKENS token/);
    // Production entries name their app (the service's own rule, checked before the service starts).
    expect(() => loadConfig({ ...DEPLOYED, PLATFORM_ENV: "production", NETWORK_SERVICE_TOKENS: `admin:${"a".repeat(40)}` })).toThrow(/names no app/);
    // Dev keeps its shortcuts: none of these is required there.
    const dev = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x" });
    expect(dev.warnings.join(" ")).toMatch(/NETWORK_SERVICE_TOKENS is not set/);
  });

  // spec/bootPolicy.md, "The combined backend entry checks its own database, provider and secret configuration"
  test("every refused boot fact stops loadConfig with its own message, in staging and production", () => {
    const refusals: Record<Exclude<keyof BackendBoot, "deployed">, [Record<string, string | undefined>, RegExp]> = {
      devConflict: [{ PLATFORM_ENV: "dev", NODE_ENV: "production" }, /a NODE_ENV other than production when PLATFORM_ENV=dev/],
      databaseMissing: [{ DATABASE_URL: undefined }, /DATABASE_URL \(or NETWORK_DATABASE_URL\)/],
      turnstileMissing: [{ TURNSTILE_SECRET_KEY: undefined }, /TURNSTILE_SECRET_KEY/],
      turnstileSiteMissing: [{ TURNSTILE_SITE_KEY: undefined }, /TURNSTILE_SITE_KEY/],
      proxyMissing: [{ PLATFORM_PROXY_SECRET: undefined }, /PLATFORM_PROXY_SECRET(;|$)/],
      hashMissing: [{ PLATFORM_HASH_KEY: undefined }, /PLATFORM_HASH_KEY(;|$)/],
      proxyShort: [{ PLATFORM_PROXY_SECRET: "p".repeat(31) }, /PLATFORM_PROXY_SECRET of at least 32 characters/],
      hashShort: [{ PLATFORM_HASH_KEY: "h".repeat(31) }, /PLATFORM_HASH_KEY of at least 32 characters/],
      sessionMissing: [{ PLATFORM_SESSION_SECRET: undefined }, /PLATFORM_SESSION_SECRET(;|$)/],
      sessionShort: [{ PLATFORM_SESSION_SECRET: "e".repeat(31) }, /PLATFORM_SESSION_SECRET of at least 32 characters/],
      sessionReused: [{ PLATFORM_SESSION_SECRET: DEPLOYED.PLATFORM_HASH_KEY }, /PLATFORM_SESSION_SECRET that differs from PLATFORM_HASH_KEY/],
      leakKeyShort: [{ LEAK_LABEL_KEY: "l".repeat(31) }, /LEAK_LABEL_KEY of at least 32 bytes/],
      migrationMissing: [{ MIGRATION_DATABASE_URL: undefined }, /MIGRATION_DATABASE_URL \(or MIGRATE_ON_BOOT=0\)/],
      sharedLogin: [{ MIGRATION_DATABASE_URL: DEPLOYED.DATABASE_URL }, /different login/],
      turnSecretShort: [{ SERVICE_TURN_SECRET: "t".repeat(31) }, /SERVICE_TURN_SECRET of at least 32/],
      staffTokensMissing: [{ NETWORK_SERVICE_TOKENS: undefined }, /NETWORK_SERVICE_TOKENS \(the staff API/],
      staffTokenShort: [{ NETWORK_SERVICE_TOKENS: `admin@*:${"a".repeat(40)},reviewer@slop:${"r".repeat(31)}` }, /every NETWORK_SERVICE_TOKENS token/],
      publicEventsLoginMissing: [{ NETWORK_PUBLIC_EVENTS_DATABASE_URL: undefined }, /NETWORK_PUBLIC_EVENTS_DATABASE_URL/],
      turnSecretReused: [{ SERVICE_TURN_SECRET: "a".repeat(40) }, /not also a NETWORK_SERVICE_TOKENS token/],
      reviewInvalid: [{ NETWORK_REVIEW_MODE: "auto" }, /NETWORK_REVIEW_MODE=human \(got "auto"\)/],
      devSwitchSet: [{ PLATFORM_DEV_CONSOLE_OTP: "1" }, /unset PLATFORM_DEV_CONSOLE_OTP \(dev only\)/],
    };
    for (const environment of ["staging", "production"]) {
      const ready = { ...DEPLOYED, PLATFORM_ENV: environment };
      expect(loadConfig(ready).env).toBe(environment);
      for (const [field, [change, message]] of Object.entries(refusals)) {
        expect(() => loadConfig({ ...ready, ...change }), `${environment} ${field}`).toThrow(message);
      }
    }
    expect(loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x", NETWORK_REVIEW_MODE: "auto", PLATFORM_DEV_CONSOLE_OTP: "1" }).env).toBe("dev");
    expect(() => createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "staging" }, hashKey: "h".repeat(40), turnstile: { verify: async () => true },
      otp: { name: "fixture", send: async () => ({ code: "123456" }) } })).toThrow(/PLATFORM_SESSION_SECRET/);
    for (const environment of ["staging", "production"]) {
      expect(() => createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: environment }, hashKey: "h".repeat(40), sessionSecret: "h".repeat(40),
        turnstile: { verify: async () => true }, otp: { name: "fixture", send: async () => ({ code: "123456" }) } }), environment).toThrow(/PLATFORM_SESSION_SECRET must differ from PLATFORM_HASH_KEY/);
    }
    expect(() => createPublicApi({ store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "dev" }, hashKey: "h".repeat(40), sessionSecret: "",
      otp: { name: "fixture", send: async () => ({ code: "123456" }) } })).not.toThrow();
  });

  // spec/bootPolicy.md, "The combined backend turns photo relay on only with a complete photo relay setup"
  test("photo relay is configured from all four variables together, and a partial setup stops the boot", () => {
    const relay = {
      NETWORK_PHOTO_RELAY_NOTICE_VERSION: "photo-notice-v1", NETWORK_PHOTO_RELAY_NOTICE: "Send this photo to {{recipient}} after a safety review.",
      NETWORK_PHOTO_RELAY_REVIEWERS: "token:safety#0123abcd, safety-lead@example.test", NETWORK_PHOTO_DELIVERY_ORIGIN: "https://backend.example.test",
    };
    expect(loadConfig(DEPLOYED).photoRelay).toBeUndefined();
    expect(loadConfig({ ...DEPLOYED, ...relay }).photoRelay).toEqual({
      version: "photo-notice-v1", notice: "Send this photo to {{recipient}} after a safety review.",
      reviewers: ["token:safety#0123abcd", "safety-lead@example.test"], deliveryOrigin: "https://backend.example.test",
    });
    for (const k of Object.keys(relay)) expect(() => loadConfig({ ...DEPLOYED, ...relay, [k]: undefined }), k).toThrow(/photo relay needs/);
    expect(() => loadConfig({ ...DEPLOYED, NETWORK_PHOTO_DELIVERY_ORIGIN: relay.NETWORK_PHOTO_DELIVERY_ORIGIN })).toThrow(/photo relay needs/);
    for (const change of [
      { NETWORK_PHOTO_RELAY_NOTICE: "Send this photo after a safety review." },
      { NETWORK_PHOTO_DELIVERY_ORIGIN: "https://backend.example.test/photos" },
      { NETWORK_PHOTO_DELIVERY_ORIGIN: "http://backend.example.test" },
      { NETWORK_PHOTO_DELIVERY_ORIGIN: "http://127.0.0.1:8790" },
      { NETWORK_PHOTO_RELAY_REVIEWERS: " , " },
    ]) expect(() => loadConfig({ ...DEPLOYED, ...relay, ...change }), JSON.stringify(change)).toThrow(/photo relay needs/);
    const dev = loadConfig({ PLATFORM_ENV: "dev", DATABASE_URL: "postgres://x@localhost/x", ...relay, NETWORK_PHOTO_DELIVERY_ORIGIN: "http://127.0.0.1:8790" });
    expect(dev.photoRelay?.deliveryOrigin).toBe("http://127.0.0.1:8790");
  });

  // spec/bootPolicy.md, "Exactly one system answers the carrier's inbound messages"
  test("with NETWORK_CHANNEL=eliza_cloud the backend does not own the carrier webhook (audit SHA43)", () => {
    expect(loadConfig(DEPLOYED).blooioWebhook).toBe(true);
    expect(loadConfig({ ...DEPLOYED, NETWORK_CHANNEL: "blooio" }).blooioWebhook).toBe(true);
    const cloud = loadConfig({ ...DEPLOYED, NETWORK_CHANNEL: "eliza_cloud", BLOOIO_WEBHOOK_SECRET: "w".repeat(40) });
    // Off whether or not the live flags make Cloud sends live: the gateway owns inbound either way.
    expect([cloud.channel, cloud.blooioWebhook]).toEqual(["dry-run", false]);
    expect(cloud.warnings.join(" ")).toMatch(/BLOOIO_WEBHOOK_SECRET is ignored/);
    expect(cloud.warnings.join(" ")).not.toMatch(/BLOOIO_WEBHOOK_SECRET is not set/);
  });

  // docs/deploy.md section 6, the live-send table (audit PER34, SHA41: founder decisions, behavior unchanged and pinned)
  test("the live-send table: which flag makes which app's queued sends live; signed-turn replies are never gated by a backend flag", () => {
    const table = (e: Record<string, string | undefined>) => {
      const c = loadConfig({ ...DEPLOYED, NETWORK_CHANNEL: "eliza_cloud", BLOOIO_FROM: "+12125550100", ...e });
      return Object.fromEntries(liveSendTable({ ...DEPLOYED, ...e }, c.channel, liveSendAllowed).map(r => [r.app, `${r.queued}|${r.turnReplies}`]));
    };
    const row = (ntwrk: string, slop: string, friends: string, peon: string) =>
      ({ ntwrk: `${ntwrk}|sent by the gateway`, slop: `${slop}|sent by the gateway`, friends: `${friends}|sent by the gateway`, peon: `${peon}|sent by the gateway` });
    const NETWORK_CLOUD_DELIVERY_ORIGIN = "https://cloud.example.test";
    expect(table({})).toEqual(row("dry-run", "dry-run", "dry-run", "dry-run"));
    expect(table({ BLOOIO_ALLOW_SEND: "1", SLOP_LIVE_APPROVED: "1", FRIENDS_LIVE_APPROVED: "1", PEON_LIVE_APPROVED: "1" })).toEqual(row("dry-run", "dry-run", "dry-run", "dry-run"));
    // NTWRK_LIVE_APPROVED is the global approval: slop cannot go live without it, and with it ntwrk is live too.
    expect(table({ NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" })).toEqual(row("live", "dry-run", "dry-run", "dry-run"));
    expect(table({ NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", SLOP_LIVE_APPROVED: "1" })).toEqual(row("live", "live", "dry-run", "dry-run"));
    expect(table({ NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", SLOP_LIVE_APPROVED: "1", FRIENDS_LIVE_APPROVED: "1", PEON_LIVE_APPROVED: "1" })).toEqual(row("live", "live", "live", "live"));
    expect(table({ NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1", SLOP_LIVE_APPROVED: "1" }).slop).toBe("live|sent by the gateway");
    // --dry-run wins over every flag.
    const c = loadConfig({ ...DEPLOYED, NETWORK_CHANNEL: "eliza_cloud", NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_FROM: "+12125550100", BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }, ["--dry-run"]);
    expect(liveSendTable({ ...DEPLOYED, BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }, c.channel, liveSendAllowed).map(r => r.queued)).toEqual(["dry-run", "dry-run", "dry-run", "dry-run"]);
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
  const svc: ServiceLike & { closed: boolean; ticks: number; slowTick: boolean; rounds: string[] } = {
    closed: false, ticks: 0, slowTick: false, rounds: [],
    async fetch(req) { calls.push({ kind: "staff", host: req.headers.get("host"), path: new URL(req.url).pathname, ip: null }); return Response.json({ ok: true, staff: true }); },
    async publicFetch(req) { calls.push({ kind: "public", host: req.headers.get("host"), path: new URL(req.url).pathname, ip: req.headers.get(CLIENT_IP) }); return Response.json({ ok: true }); },
    runtimes: new Map([["ntwrk:nyc", { id: "ntwrk:nyc", tick: async () => {
      svc.ticks++;
      svc.rounds.push("network:ntwrk:nyc");
      if (svc.slowTick) await new Promise<void>(r => { release = r; });
      return true;
    } }]]),
    async inboxTick() { svc.rounds.push("inbox"); },
    async purge() { svc.rounds.push("retention"); },
    async notifyTick() { svc.rounds.push("notify"); },
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

  // spec/bootPolicy.md, "Exactly one system answers the carrier's inbound messages"
  test("with the Eliza gateway as the inbound owner, neither port serves the legacy Blooio webhook (audit SHA43)", async () => {
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg({ blooioWebhook: false }), log: silent, ping: async () => true });
    for (const path of ["/webhooks/blooio", "/webhooks/blooio/slop"]) {
      const pub = await b.publicFetch(new Request(`http://api.example.test${path}`, { method: "POST", body: "{}" }));
      const staff = await b.staffFetch(new Request(`http://10.0.0.2:4848${path}`, { method: "POST", body: "{}" }));
      expect([pub.status, (await pub.json()).error, staff.status, (await staff.json()).error]).toEqual([404, "webhook_not_served", 404, "webhook_not_served"]);
    }
    expect(calls).toEqual([]);
    // The signed turn route stays open: it is how the gateway hands the backend each message.
    expect((await b.publicFetch(new Request("http://api.example.test/internal/turn", { method: "POST", body: "{}" }))).status).toBe(200);
    expect((await b.staffFetch(new Request("http://10.0.0.2:4848/review"))).status).toBe(200);
  });

  test("the Eliza gateway's signed routes reach the service on the public port, /internal/relay and the relay-photo resolve included (both were 404), each under its own body cap", async () => {
    const { svc, calls } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    for (const p of ["/internal/turn", "/internal/turn-receipt", "/internal/set-state", "/internal/signals", "/internal/updates", "/internal/relay", RELAY_PHOTO_RESOLVE_PATH,
      "/internal/profile-suggestions/preview", "/internal/profile-suggestions/decide", "/internal/profile-suggestions/delete", "/internal/profile-suggestions/collect", "/internal/profile-suggestions/consent-context",
      PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_WITHDRAWAL_PATH, calendarOwnerPath]) {
      const r = await b.publicFetch(new Request(`http://api.example.test${p}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
      expect([p, r.status]).toEqual([p, 200]);
      expect(calls.at(-1)).toMatchObject({ kind: "staff", path: p });
    }
    const n = calls.length;
    // The relay action's cap is 16 KiB (relay-endpoint.ts RELAY_MAX_BODY_BYTES): a larger declared body never reaches the service.
    const big = await b.publicFetch(new Request("http://api.example.test/internal/relay", { method: "POST", body: "x".repeat(17 * 1024), headers: { "content-length": String(17 * 1024) } }));
    expect(big.status).toBe(413);
    const oversizedCalendar = await b.publicFetch(new Request(`http://api.example.test${calendarOwnerPath}`, {
      method: "POST", body: "x".repeat(17 * 1024), headers: { "content-length": String(17 * 1024) },
    }));
    expect(oversizedCalendar.status).toBe(413);
    // Eliza Cloud resolves one approved photo descriptor; its cap is 16 KiB (relay-endpoint.ts RELAY_PHOTO_RESOLVE_MAX_BODY_BYTES).
    const oversizedResolve = await b.publicFetch(new Request(`http://api.example.test${RELAY_PHOTO_RESOLVE_PATH}`, { method: "POST", body: "x".repeat(17 * 1024), headers: { "content-length": String(17 * 1024) } }));
    expect(oversizedResolve.status).toBe(413);
    expect(calls.length).toBe(n);
    // The same size is fine on the turn route (256 KiB).
    expect((await b.publicFetch(new Request("http://api.example.test/internal/turn", { method: "POST", body: "x".repeat(17 * 1024), headers: { "content-length": String(17 * 1024) } }))).status).toBe(200);
    expect((await b.publicFetch(new Request("http://api.example.test/internal/profile-suggestions/decide", { method: "POST", body: "x".repeat(17 * 1024), headers: { "content-length": String(17 * 1024) } }))).status).toBe(413);
    for (const path of [PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_WITHDRAWAL_PATH]) {
      const before = calls.length;
      const r = await b.publicFetch(new Request(`http://api.example.test${path}`, { method: "POST", body: "x".repeat(4097), headers: { "content-length": "4097" } }));
      expect(r.status).toBe(413);
      expect(calls.length).toBe(before);
    }
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

describe("deployed tick round", () => {
  // spec/platformRetention.md, "Platform rows and inbox payloads have separate cutoffs"
  // spec/backendLifecycle.md, "Reserve each tick worker before starting its work"
  test("redrives inbound work before the network ticks, and purges expired data and runs notifications in every round", async () => {
    const { svc } = fakeService();
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    await b.tickAll();
    await b.tickAll();
    const [first, second] = [svc.rounds.slice(0, 4), svc.rounds.slice(4)];
    for (const round of [first, second]) {
      expect([...round].sort()).toEqual(["inbox", "network:ntwrk:nyc", "notify", "retention"]);
      expect(round.indexOf("inbox")).toBeLessThan(round.indexOf("network:ntwrk:nyc"));
    }
  });

  // spec/backendLifecycle.md, "Reserve each tick worker before starting its work"
  test("a long network tick does not delay retention or notifications in the same round", async () => {
    const { svc, release } = fakeService();
    svc.slowTick = true;
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const first = b.tickAll();
    await sleep(10);
    expect([...svc.rounds].sort()).toEqual(["inbox", "network:ntwrk:nyc", "notify", "retention"]);
    await b.tickAll();
    expect(svc.rounds.filter(r => r === "notify")).toHaveLength(2);
    expect(svc.rounds.filter(r => r === "retention")).toHaveLength(2);
    expect(svc.ticks).toBe(1);
    release();
    await first;
  });

  // spec/backendLifecycle.md, "Reserve each tick worker before starting its work"
  test("the public event catalog refresh runs in every round on its own key, beside the network work (audit PER32)", async () => {
    const { svc } = fakeService();
    let refreshes = 0, release: () => void = () => {};
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true,
      publicEvents: async () => { if (++refreshes === 1) await new Promise<void>(r => { release = r; }); } });
    const first = b.tickAll();
    await sleep(10);
    expect([...svc.rounds].sort()).toEqual(["inbox", "network:ntwrk:nyc", "notify", "retention"]);
    await b.tickAll().then(() => undefined, () => undefined);
    expect(refreshes).toBe(1);
    release();
    await first;
    await b.tickAll();
    expect(refreshes).toBe(2);
  });

  test("a redrive or retention error does not stop the remaining workers", async () => {
    const { svc } = fakeService();
    const lines: string[] = [];
    svc.inboxTick = async () => { svc.rounds.push("inbox"); throw new Error("inbox unavailable"); };
    svc.purge = async () => { svc.rounds.push("retention"); throw new Error("retention unavailable"); };
    const b = createBackend({ svc, config: cfg(), log: jsonLogger(s => lines.push(s)), ping: async () => true });
    await b.tickAll();
    expect([...svc.rounds].sort()).toEqual(["inbox", "network:ntwrk:nyc", "notify", "retention"]);
    expect(lines.join("\n")).toMatch(/"msg":"inbox tick failed"/);
    expect(lines.join("\n")).toMatch(/"msg":"retention tick failed"/);
  });
});

describe("graceful shutdown", () => {
  test("a tick in flight finishes before the pool closes; new work is refused meanwhile", async () => {
    const { svc, release } = fakeService();
    svc.slowTick = true;
    const b = createBackend({ svc, config: cfg(), log: silent, ping: async () => true });
    const first = b.startTicks();
    await sleep(5);
    expect(b.inFlight).toBe(1);
    const stopped: boolean[] = [];
    const server = { stop: (force?: boolean) => { stopped.push(!!force); } };
    const done = b.shutdown([server]);
    await sleep(20);
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
    await sleep(5);
    expect(await b.shutdown()).toEqual({ clean: false });
    expect(svc.closed).toBe(true);
  });

  // spec/backendLifecycle.md, "The grace period covers listener and work drain"
  test("the shutdown grace period also bounds an in-flight HTTP response", async () => {
    const { svc } = fakeService();
    let recordEntry!: () => void;
    let finishResponse!: (response: Response) => void;
    const entered = new Promise<void>(resolve => { recordEntry = resolve; });
    const response = new Promise<Response>(resolve => { finishResponse = resolve; });
    const closeMode: boolean[] = [];
    svc.publicFetch = () => { recordEntry(); return response; };
    svc.close = async (force = false) => { closeMode.push(force); };
    const b = createBackend({ svc, config: cfg({ deployed: false, shutdownGraceMs: 30 }), log: silent, ping: async () => true });
    const listener = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: b.publicFetch });
    const client = fetch(new URL("/api/app", listener.url), { signal: AbortSignal.timeout(2000) })
      .then(res => res.status, () => null);
    const reachedService = await Promise.race([entered.then(() => true), client.then(() => false)]);
    try {
      expect(reachedService).toBe(true);
      const result = await Promise.race([b.shutdown([listener]), sleep(600, "still draining")]);
      expect(result).toEqual({ clean: false });
      expect(closeMode).toEqual([true]);
      expect(await client).toBeNull();
    } finally {
      finishResponse(Response.json({ ok: true }));
      await listener.stop(true);
      await b.shutdown();
    }
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
      // The catalog ingest login, and a fresh catalog, so the first tick round does not reach the real feed.
      await owner.unsafe(`drop role if exists ${role}_events`).catch(() => {});
      await owner.unsafe(`create role ${role}_events login nosuperuser nobypassrls`);
      await owner.unsafe(`grant network_public_event_ingest to ${role}_events`);
      await owner.unsafe(`grant connect on database ${new URL(url).pathname.slice(1)} to ${role}_events`);
      await owner`insert into network.public_event_imports (source, checked_at) values ('nyc-parks', now())`;
    } finally { await owner.close(); }
    const svcUrl = Object.assign(new URL(url), { username: role }).toString();
    const eventsUrl = Object.assign(new URL(url), { username: `${role}_events` }).toString();
    const env: Record<string, string> = {
      ...process.env as Record<string, string>, ...DEPLOYED, DATABASE_URL: svcUrl, MIGRATION_DATABASE_URL: url, NETWORK_PUBLIC_EVENTS_DATABASE_URL: eventsUrl, PORT: String(port), STAFF_PORT: String(staff), TICK_MS: "3600000",
      PLATFORM_DB_ENVIRONMENT_INIT: "1", BUILD_ID: "boot-test", NODE_ENV: "", NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", NTWRK_LIVE_APPROVED: "", NETWORK_PROFILE_REVIEW_ENABLED: "0",
      NETWORK_PHOTO_RELAY_NOTICE_VERSION: "boot-photo-notice-v1", NETWORK_PHOTO_RELAY_NOTICE: "Send this photo to {{recipient}} after a safety review.",
      NETWORK_PHOTO_RELAY_REVIEWERS: "token:safety#0123abcd", NETWORK_PHOTO_DELIVERY_ORIGIN: "https://backend.example.test",
    };
    const proc = spawnProcess([process.execPath, "--import", "tsx", `${import.meta.dirname}/server.ts`], { env, stdout: "pipe", stderr: "pipe" });
    const out = new Response(proc.stdout).text();
    try {
      let ok = false;
      for (let i = 0; i < 100 && !ok; i++) {
        await sleep(100);
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
      // The actual service owns cleanup authority; the public router must forward these routes
      // without granting access when the private profile-review runtime is off.
      for (const path of [PROFILE_REVIEW_DISCONNECT_PATH, PROFILE_REVIEW_WITHDRAWAL_PATH]) {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: "{}" });
        expect(r.status).toBe(503);
        expect(await r.json()).toEqual({ error: "cleanup_unavailable" });
        expect(r.headers.get("cache-control")).toBe("no-store");
        const big = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body: "x".repeat(4097) });
        expect(big.status).toBe(413);
      }
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
    // The live-send table is in the boot log (docs/deploy.md section 6), and the signup connector is on.
    expect(logs).toMatch(/"msg":"live sends".*"inbound":"backend webhook".*"ntwrk: queued dry-run, turn replies sent by the gateway"/);
    expect(logs).toMatch(/"msg":"mcp".*"enabled":true/);
    expect(logs).toMatch(/"msg":"photo relay".*"enabled":true.*"version":"boot-photo-notice-v1".*"reviewers":1/);
  }, 30_000);
});

// spec/publicEventCatalog.md, "The backend scans once a day, at most one process at a time, and waits after a failed attempt"
describe.skipIf(!pgAvailable)("public event catalog refresh (dev Postgres, the ingest login; audit PER32)", () => {
  let url = "";
  const role = `backend_events_${process.pid}`;
  afterAll(async () => { if (url) await dropDb(url); });

  test("scans when the catalog is missing or a day old, never twice at once, and waits an hour after a failure", async () => {
    url = await emptyDb("backend_events");
    await migrate(url, { lockTimeout: "5s" });
    const owner = new SQL({ url, max: 1 });
    const HOUR = 3_600_000, DAY = 24 * HOUR;
    const clock = new SimClock(Date.UTC(2026, 9, 6, 12));
    let feedCalls = 0, feedDown = false;
    const feed: typeof fetch = async () => {
      feedCalls++;
      if (feedDown) return new Response(null, { status: 503 });
      return Response.json([{ guid: "2257118", title: "Outdoor climbing", categories: "Fitness", location: "McCarren Park",
        starttime: "2026-10-09T18:00:00.000", endtime: "2026-10-09T19:00:00.000", coordinates: "40.7206,-73.9518",
        link: { url: "https://www.nycgovparks.org/events/2026/10/09/climbing" } }]);
    };
    const events = await (async () => {
      await owner.unsafe(`drop role if exists ${role}`).catch(() => {});
      await owner.unsafe(`create role ${role} login nosuperuser nobypassrls`);
      await owner.unsafe(`grant network_public_event_ingest to ${role}`);
      await owner.unsafe(`grant connect on database ${new URL(url).pathname.slice(1)} to ${role}`);
      return new SQL({ url: Object.assign(new URL(url), { username: role }).toString(), max: 2 });
    })();
    try {
      const refresh = createPublicEventRefresh({ sql: events, clock, request: feed });
      expect(await refresh()).toEqual({ kind: "scanned", published: true, events: 1 });
      expect(await refresh()).toEqual({ kind: "not_due" });
      clock.advance(DAY - 1);
      expect(await refresh()).toEqual({ kind: "not_due" });
      clock.advance(1);
      expect(await refresh()).toEqual({ kind: "scanned", published: true, events: 1 });
      expect(feedCalls).toBe(2);
      // A failed scan keeps the last publication, and the next attempt waits for the retry interval.
      clock.advance(DAY);
      feedDown = true;
      await expect(refresh()).rejects.toThrow(/HTTP 503/);
      const [kept] = await owner`select checked_at from network.public_event_imports`;
      expect(new Date(kept.checked_at).getTime()).toBe(clock.now() - DAY);
      clock.advance(HOUR - 1);
      expect(await refresh()).toEqual({ kind: "not_due" });
      expect(feedCalls).toBe(3);
      feedDown = false;
      clock.advance(1);
      expect(await refresh()).toEqual({ kind: "scanned", published: true, events: 1 });
      // Another process holds the lease: this one does not scan, and scans once the lease is free.
      clock.advance(DAY);
      await owner`select pg_advisory_lock(hashtext('thenetwork-public-events-refresh'))`;
      expect(await refresh()).toEqual({ kind: "lease_held" });
      await owner`select pg_advisory_unlock(hashtext('thenetwork-public-events-refresh'))`;
      expect(feedCalls).toBe(4);
      expect(await refresh()).toEqual({ kind: "scanned", published: true, events: 1 });
    } finally {
      await events.close();
      await owner.unsafe(`drop owned by ${role}`).catch(() => {});
      await owner.close();
    }
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
