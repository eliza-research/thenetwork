// Console security (admin-console 4): production fails closed, the dev server still boots with a
// token, /healthz answers without auth or data, a PII reveal and a photo read need a fresh sign-in,
// role checks per route and command, read audit rows, and scrubbing. No database: real mode without
// one has no members, which is enough for the auth paths (they run before any member lookup).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, productionProblems, type ObservatoryServer } from "../src/server.ts";
import { createAudit, FileAudit, type AuditSink } from "../src/staff.ts";
import { scrubText } from "../src/scrub.ts";
import type { AuditEntry } from "../src/types.ts";

// Nothing from the shell may change the server under test. The values come back after this file, so
// the files that run after it in the same process (bun test sets NODE_ENV=test) see what they expect.
const SHELL_ENV = ["NODE_ENV", "OBSERVATORY_TOKEN", "OBSERVATORY_TOKENS", "OBSERVATORY_TRUST_CF_ACCESS", "OBSERVATORY_CF_ACCESS_TEAM", "OBSERVATORY_CF_ACCESS_AUD", "OBSERVATORY_ROLES",
  "OBSERVATORY_AUDIT_DATABASE_URL", "OBSERVATORY_REAL_ONLY", "NETWORK_DATABASE_URL", "DATABASE_URL", "NETWORK_SERVICE_URL", "NETWORK_SERVICE_TOKEN", "OBSERVATORY_FRESH_AUTH_MINUTES", "PLATFORM_ENV"];
const savedEnv = Object.fromEntries(SHELL_ENV.map(k => [k, process.env[k]]));
for (const k of SHELL_ENV) delete process.env[k];
afterAll(() => { for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v; });

/** An audit sink in memory that says it is Postgres (production refuses a file). */
class MemAudit implements AuditSink {
  readonly kind = "postgres" as const;
  rows: AuditEntry[] = [];
  async write(e: AuditEntry) { this.rows.push(e); }
  async list() { return [...this.rows].reverse(); }
  async close() {}
}

// ---------------------------------------------------------------- Cloudflare Access test keys
const TEAM = "acme", AUD = "aud-test";
let keys: CryptoKeyPair, jwk: JsonWebKey;
const b64 = (x: string | ArrayBuffer) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
async function jwt(email: string, iatSec: number, expSec = iatSec + 3600): Promise<string> {
  const head = b64(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64(JSON.stringify({ email, aud: [AUD], iss: `https://${TEAM}.cloudflareaccess.com`, iat: iatSec, exp: expSec }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(sig)}`;
}
const certs = async () => Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
const sso = (token: string, extra: Record<string, string> = {}) => ({ "cf-access-jwt-assertion": token, ...extra });

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

describe("production fails closed", () => {
  const ok = { trustCfAccess: true, team: TEAM, aud: AUD, tokens: false, realOnly: undefined, auditPostgres: true };
  test("every missing piece is named", () => {
    expect(productionProblems(ok)).toEqual([]);
    expect(productionProblems({ ...ok, trustCfAccess: false }).join()).toContain("single sign-on is off");
    expect(productionProblems({ ...ok, team: "" }).join()).toContain("Cloudflare Access is not configured");
    expect(productionProblems({ ...ok, aud: undefined }).join()).toContain("Cloudflare Access is not configured");
    expect(productionProblems({ ...ok, tokens: true }).join()).toContain("static token");
    expect(productionProblems({ ...ok, realOnly: false }).join()).toContain("real-only");
    expect(productionProblems({ ...ok, auditPostgres: false }).join()).toContain("audit log is not Postgres");
  });

  test("the server refuses to start without SSO, with a token, or with a file audit log", async () => {
    await expect(createServer({ production: true, port: 0, audit: new MemAudit() })).rejects.toThrow(/single sign-on is off/);
    await expect(createServer({ production: true, port: 0, trustCfAccess: true, cfAccess: { team: TEAM, aud: AUD }, token: "x".repeat(40), audit: new MemAudit() })).rejects.toThrow(/static token/);
    await expect(createServer({ production: true, port: 0, trustCfAccess: true, cfAccess: { team: TEAM, aud: AUD } })).rejects.toThrow(/audit log is not Postgres/);
    await expect(createServer({ production: true, port: 0, trustCfAccess: true, cfAccess: { team: TEAM, aud: AUD }, audit: new FileAudit("/tmp/never") })).rejects.toThrow(/audit log is not Postgres/);
    expect(() => createAudit({ production: true })).toThrow(/must be Postgres/);
  });

  test("with SSO and a Postgres audit it starts real-only, and makes no token", async () => {
    const obs = await createServer({ production: true, port: 0, trustCfAccess: true, cfAccess: { team: TEAM, aud: AUD, fetch: certs }, roles: "a@x.com:admin@*", staffRolesUrl: false, audit: new MemAudit(), real: { service: false } });
    try {
      expect(obs.token).toBeUndefined();
      expect(obs.openUrl).not.toContain("token");
      expect(obs.mode()).toBe("real");
      // A static bearer is refused (sign in through Access).
      expect((await fetch(`${obs.url}/api/me`, { headers: { authorization: `Bearer ${"y".repeat(40)}` } })).status).toBe(401);
      const me = await fetch(`${obs.url}/api/me`, { headers: sso(await jwt("a@x.com", Math.floor(Date.now() / 1000))) });
      expect(me.status).toBe(200);
      expect((await me.json()).realOnly).toBe(true);
    } finally { await obs.stop(); }
  });
});

describe("the dev server", () => {
  let obs: ObservatoryServer;
  let audit: MemAudit;
  beforeAll(async () => {
    audit = new MemAudit();
    obs = await createServer({ port: 0, mode: "real", real: { service: false }, audit, staffRolesUrl: false, token: "z".repeat(40), tokens: `analyst@slop:${"a".repeat(40)},reviewer@slop:${"r".repeat(40)}` });
  });
  afterAll(async () => { await obs.stop(); });
  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  test("with no token configured it makes one and prints it in the page URL's fragment, as before", async () => {
    const dev = await createServer({ port: 0, mode: "real", real: { service: false }, audit: new MemAudit(), staffRolesUrl: false });
    try {
      expect(dev.token?.length).toBeGreaterThanOrEqual(32);
      expect(dev.openUrl).toContain("/#token=");
      expect((await fetch(`${dev.url}/api/me`, { headers: as(dev.token!) })).status).toBe(200);
    } finally { await dev.stop(); }
  });

  test("/healthz answers without auth and without data; the API needs auth", async () => {
    const h = await fetch(`${obs.url}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("ok");
    expect((await fetch(`${obs.url}/api/state`)).status).toBe(401);
    expect((await fetch(`${obs.url}/api/health`)).status).toBe(401);
  });

  test("role checks: an analyst cannot reveal or review; a reviewer cannot switch matching or shadow", async () => {
    const reveal = await fetch(`${obs.url}/api/reveal?app=slop`, { method: "POST", headers: { ...as("a".repeat(40)), "content-type": "application/json" }, body: JSON.stringify({ memberId: "m1", reason: "a check" }) });
    expect(reveal.status).toBe(403);
    const ctl = (t: string, cmd: object) => fetch(`${obs.url}/api/control?app=slop`, { method: "POST", headers: { ...as(t), "content-type": "application/json" }, body: JSON.stringify(cmd) });
    expect((await ctl("a".repeat(40), { type: "review", oppId: "o1", decision: "approve" })).status).toBe(403);
    expect((await ctl("r".repeat(40), { type: "matching", on: true })).status).toBe(403);
    expect((await ctl("r".repeat(40), { type: "shadow", on: true })).status).toBe(403);
    // A reviewer may compose; real mode without the service is read-only (409 with a code).
    const c = await ctl("r".repeat(40), { type: "compose", participants: ["a", "b"], objective: "coffee" });
    expect(c.status).toBe(409);
    expect((await c.json()).code).toBe("read_only");
    // Every refused command leaves a row.
    expect(audit.rows.some(r => r.action === "matching" && !r.ok && r.detail?.refused === "forbidden")).toBe(true);
  });

  test("a read writes its audit row before anything is read", async () => {
    const before = audit.rows.length;
    const r = await fetch(`${obs.url}/api/member/m-unknown`, { headers: as(obs.token!) });
    expect(r.status).toBe(404);
    const row = audit.rows.slice(before).find(x => x.action === "read_member");
    expect(row).toMatchObject({ targetType: "member", targetId: "m-unknown", ok: true });
  });

  test("an override reason is audited as a length, never as text", async () => {
    const before = audit.rows.length;
    await fetch(`${obs.url}/api/control?app=slop`, { method: "POST", headers: { ...as(obs.token!), "content-type": "application/json" }, body: JSON.stringify({ type: "matching", on: true, override: "pilot starts with 35 committed adults" }) });
    const row = audit.rows.slice(before).find(x => x.action === "matching");
    expect(row?.detail?.overrideLength).toBe("pilot starts with 35 committed adults".length);
    expect(JSON.stringify(row)).not.toContain("pilot starts");
  });
});

describe("a PII reveal and a photo read need a fresh sign-in", () => {
  let obs: ObservatoryServer;
  let audit: MemAudit;
  beforeAll(async () => {
    audit = new MemAudit();
    obs = await createServer({ port: 0, mode: "real", real: { service: false }, audit, staffRolesUrl: false, trustCfAccess: true, cfAccess: { team: TEAM, aud: AUD, fetch: certs }, roles: "s@x.com:safety@*", freshAuthMinutes: 15 });
  });
  afterAll(async () => { await obs.stop(); });
  const post = async (path: string, token: string, body: object) => fetch(`${obs.url}${path}`, { method: "POST", headers: { ...sso(token), "content-type": "application/json" }, body: JSON.stringify(body) });
  const now = () => Math.floor(Date.now() / 1000);

  test("a sign-in older than 15 minutes is refused and audited; a fresh one goes on", async () => {
    const stale = await jwt("s@x.com", now() - 20 * 60);
    const r = await post("/api/reveal?app=slop", stale, { memberId: "m1", reason: "report follow-up" });
    expect(r.status).toBe(401);
    expect((await r.json()).code).toBe("reauth_required");
    expect(audit.rows.some(x => x.action === "reveal" && !x.ok && x.detail?.refused === "reauth_required")).toBe(true);
    const p = await post("/api/member/m1/photos?app=slop", stale, { reason: "report follow-up" });
    expect(p.status).toBe(401);
    // Fresh: past the sign-in check (this database has no such member).
    const fresh = await jwt("s@x.com", now() - 60);
    const ok = await post("/api/reveal?app=slop", fresh, { memberId: "m1", reason: "report follow-up" });
    expect(ok.status).toBe(404);
    // A token without an email, or for someone with no role, never gets that far.
    expect((await post("/api/reveal?app=slop", await jwt("nobody@x.com", now()), { memberId: "m1", reason: "x".repeat(10) })).status).toBe(403);
  });
});

describe("scrubbing", () => {
  test("phones, emails and handles are masked unless revealed", () => {
    const t = "text me at (212) 555-0199 or ana@example.com, ig @ana.nyc";
    const s = scrubText(t, false);
    expect(s).not.toContain("555-0199");
    expect(s).not.toContain("ana@example.com");
    expect(scrubText(t, true)).toBe(t);
  });
});
