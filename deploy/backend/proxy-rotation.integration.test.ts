// Rotation of the site routers' proxy secret (docs/deploy.md 3.1). The backend and the four Pages
// projects get the new value in separate deploys. During that time a site that still signs with the
// old value must reach the backend, and the platform API and the MCP server (which check the
// signature again with PLATFORM_PROXY_SECRET) must see a valid signature. The real site router
// (deploy/router.ts) signs; the real backend (createBackend, loadConfig) checks; the service and the
// MCP stand-ins run the same verifyProxyHeaders check that packages/platform/src/api.ts and
// packages/mcp/src/handler.ts run.
import { expect, test } from "bun:test";
import { verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { handle } from "../router.ts";
import { createBackend, jsonLogger, loadConfig, type ServiceLike } from "./backend.ts";

const OLD = "o".repeat(40), NEW = "n".repeat(40), OTHER = "x".repeat(40);
const NOW = 1_800_000_000_000;
const DEPLOYED = {
  PLATFORM_ENV: "staging", DATABASE_URL: "postgres://svc@db.invalid/x", MIGRATION_DATABASE_URL: "postgres://owner@db.invalid/x", PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_SESSION_SECRET: "e".repeat(40), LEAK_LABEL_KEY: "l".repeat(40),
  TURNSTILE_SECRET_KEY: "fake", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_VERIFY_SERVICE_SID: "VAfake",
};

/** What the platform API and the MCP server do with a forwarded request: check the signature with PLATFORM_PROXY_SECRET. */
const inner = async (req: Request) => {
  const v = await verifyProxyHeaders(req, NEW, Math.floor(NOW / 1000));
  return v ? Response.json({ ok: true, host: v.host, ip: v.ip }) : Response.json({ ok: false, error: "unknown_app" }, { status: 404 });
};

function backend(env: Record<string, string>) {
  const svc: ServiceLike = { fetch: async () => new Response(null, { status: 404 }), publicFetch: inner, runtimes: new Map(), close: async () => {} };
  const b = createBackend({ svc, config: { ...loadConfig({ ...DEPLOYED, ...env }), build: "test-build" }, log: jsonLogger(() => {}), ping: async () => true, mcp: inner, now: () => NOW });
  /** One visitor request through the slop.date router, signed with `siteSecret`. */
  return async (siteSecret: string, path: string) => {
    const site = { ASSETS: { fetch: async () => new Response("asset") }, BACKEND_ORIGIN: "https://api.example.test", APP_ID: "slop", SITE_HOST: "slop.date", PLATFORM_PROXY_SECRET: siteSecret };
    const visitor = new Request(`https://slop.date${path}`, { headers: { "cf-connecting-ip": "203.0.113.20" } });
    const res = await handle(visitor, site, (async (url: string | URL | Request, init?: RequestInit) => b.publicFetch(new Request(url, init))) as typeof fetch, () => NOW);
    return { status: res.status, body: await res.json() };
  };
}

test("during a proxy secret rotation, a site that still signs with the old secret reaches the API and the MCP server", async () => {
  const send = backend({ PLATFORM_PROXY_SECRET: NEW, PLATFORM_PROXY_SECRET_PREVIOUS: OLD });
  const ok = { status: 200, body: { ok: true, host: "slop.date", ip: "203.0.113.20" } };
  // A site that is not yet deployed with the new value.
  expect(await send(OLD, "/api/app?x=1")).toEqual(ok);
  expect(await send(OLD, "/mcp")).toEqual(ok);
  // A site that is deployed with the new value.
  expect(await send(NEW, "/api/app?x=1")).toEqual(ok);
  expect(await send(NEW, "/mcp")).toEqual(ok);
  // Any other secret is still refused.
  expect((await send(OTHER, "/api/app")).status).toBe(421);

  // After the rotation the previous value is removed, and the old secret is refused.
  const after = backend({ PLATFORM_PROXY_SECRET: NEW });
  expect((await after(OLD, "/api/app")).status).toBe(421);
  expect(await after(NEW, "/api/app")).toEqual(ok);
});
