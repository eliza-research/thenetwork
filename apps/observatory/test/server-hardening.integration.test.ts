import { setTimeout as sleep } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { createServer, MAX_API_BODY_BYTES, MAX_JSON_BODY_BYTES, SECURITY_HEADERS, type ObservatoryServer } from "../src/server.ts";
import { PgStaffRoles } from "../src/staff.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";
import type { ObsState } from "../src/types.ts";

const T = 60_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
const TOK = {
  admin: long("adm-hard"),
  safety: long("saf-hard"),
  analyst: long("ana-hard"),
};
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const ISS = "https://ntwrk.cloudflareaccess.com";
const b64 = (x: string | ArrayBuffer) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");

async function accessKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  return {
    fetch: async () => Response.json({ keys: [jwk] }),
    sign: async (claims: Record<string, unknown>) => {
      const head = `${b64(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
      return `${head}.${b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head)))}`;
    },
  };
}

function chunkedBody(payload: string, chunkSize = 8192): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe("Observatory server hardening", () => {
  let dir: string;
  let obs: ObservatoryServer;
  let base: string;
  let memberId: string;

  const authHeaders = (tok: string): Record<string, string> => ({
    authorization: `Bearer ${tok}`,
    "content-type": "application/json",
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-harden-"));
    obs = await createServer({
      port: 0,
      development: false,
      tokens: `admin:${TOK.admin},safety:${TOK.safety},analyst:${TOK.analyst}`,
      audit: { dir: join(dir, "audit") },
      lab: { dir: join(dir, "lab") },
      game: { seed: 1, judge: "hold-every-item", pushMs: 3_600_000, tickMs: 3_600_000 },
    });
    base = obs.url;
    const state = await (await fetch(`${base}/api/state`, { headers: authHeaders(TOK.admin) })).json() as ObsState;
    memberId = state.members[0]!.id;
  }, T);

  afterAll(async () => {
    await obs?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("rejects oversized JSON and chunked bodies with 413 across JSON routes and transport cap", async () => {
    const overJson = JSON.stringify({ pad: "x".repeat(MAX_JSON_BODY_BYTES + 1024) });
    const routes = [
      "/api/mode",
      "/api/control",
      "/api/safety",
      "/api/reveal",
      "/api/held",
      "/api/lab/run",
      `/api/member/${encodeURIComponent(memberId)}/photos?app=slop`,
    ];

    for (const path of routes) {
      const res = await fetch(base + path, { method: "POST", headers: authHeaders(TOK.admin), body: overJson });
      expect([path, res.status]).toEqual([path, 413]);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(k)).toBe(v);
      }
    }

    const chunked = await fetch(`${base}/api/control`, {
      method: "POST",
      headers: authHeaders(TOK.admin),
      body: chunkedBody(overJson),
      duplex: "half",
    } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(chunked.headers.get("x-content-type-options")).toBe("nosniff");

    const overTransport = JSON.stringify({ pad: "y".repeat(MAX_API_BODY_BYTES + 2048) });
    const transportRes = await fetch(`${base}/api/control`, {
      method: "POST",
      headers: authHeaders(TOK.admin),
      body: overTransport,
    });
    expect(transportRes.status).toBe(413);
  }, T);

  test("SSO WebSocket with >24.8 day expiry clamps timer without TimeoutOverflowWarning and stays open", async () => {
    const k = await accessKeys();
    const nowSec = Math.floor(Date.now() / 1000);
    const thirtyDaysSec = 30 * 86_400;
    const warnings: Error[] = [];
    const onWarn = (w: Error) => warnings.push(w);
    process.on("warning", onWarn);

    const srv = await createServer({
      port: 0,
      development: false,
      trustCfAccess: true,
      roles: "ana@example.org:admin",
      cfAccess: { team: "ntwrk", aud: AUD, fetch: k.fetch },
      audit: { dir: join(dir, "audit-ws-overflow") },
      lab: { dir: join(dir, "lab-ws-overflow") },
      game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 },
      socketCheckMs: 60_000,
    });
    try {
      const jwt = await k.sign({ aud: [AUD], iss: ISS, email: "ana@example.org", amr: ["mfa"], iat: nowSec - 10, exp: nowSec + thirtyDaysSec });
      const ws = new WebSocket(`${srv.url.replace("http", "ws")}/ws`, {
        headers: { "cf-access-jwt-assertion": jwt },
      } as never);
      let closed = false;
      ws.onclose = () => { closed = true; };
      await new Promise<void>((ok, no) => { ws.onopen = () => ok(); ws.onerror = () => no(new Error("ws error")); });
      await sleep(150);
      expect(closed).toBe(false);
      expect(warnings.some(w => w.name === "TimeoutOverflowWarning")).toBe(false);
      ws.close();
      await sleep(50);
    } finally {
      process.off("warning", onWarn);
      await srv.stop();
    }
  }, T);

  test("redacts phones, tokens, and DB credentials in server and audit error logs", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalWrite = obs.audit.write;
    obs.audit.write = async () => {
      throw new Error("pg failure postgres://admin:supersecret@db.internal:5432/prod phone +12125550199 Bearer tok_secret_value_1234567890");
    };
    try {
      const res = await fetch(`${base}/api/safety`, { headers: authHeaders(TOK.safety) });
      expect(res.status).toBe(503);
      const logged = errSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain("Observatory: audit write failed");
      expect(logged).not.toContain("supersecret");
      expect(logged).not.toContain("2125550199");
      expect(logged).not.toContain("tok_secret_value_1234567890");
    } finally {
      obs.audit.write = originalWrite;
      errSpy.mockRestore();
    }
  }, T);

  test("sweeps expired reveals on new reveal grant", async () => {
    const state = await (await fetch(`${base}/api/state`, { headers: authHeaders(TOK.safety) })).json() as ObsState;
    const [m1, m2] = state.members;
    expect(m1 && m2).toBeTruthy();

    const realNow = Date.now;
    const t0 = realNow();
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => t0);
    try {
      const r1 = await fetch(`${base}/api/reveal`, {
        method: "POST",
        headers: authHeaders(TOK.safety),
        body: JSON.stringify({ memberId: m1!.id, reason: "investigating first report", minutes: 5 }),
      });
      expect(r1.status).toBe(200);

      nowSpy.mockImplementation(() => t0 + 6 * 60_000);
      const r2 = await fetch(`${base}/api/reveal`, {
        method: "POST",
        headers: authHeaders(TOK.safety),
        body: JSON.stringify({ memberId: m2!.id, reason: "investigating second report", minutes: 5 }),
      });
      expect(r2.status).toBe(200);

      const active = await (await fetch(`${base}/api/reveal`, { headers: authHeaders(TOK.safety) })).json() as { memberId: string }[];
      expect(active.map(x => x.memberId)).toEqual([m2!.id]);
    } finally {
      nowSpy.mockRestore();
    }
  }, T);
});

describe.skipIf(!pgAvailable)("Observatory Postgres hardening (PgStaffRoles, held-photo error headers, member pruning)", () => {
  let url: string;
  let sql: SQL;
  let dir: string;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    dir = await mkdtemp(join(tmpdir(), "obs-harden-pg-"));
  }, T);

  afterAll(async () => {
    await sql?.close();
    await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("PgStaffRoles keeps last good roles during transient error within staleMs, resets warning on recovery, and fails closed past staleMs", async () => {
    await sql`insert into platform.staff_roles (email, role, app_id, granted_by) values ('grace@example.org', 'reviewer', 'slop', 'test')`;
    let fail = false;
    let clock = 1_000_000;
    const wrappedSql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (fail) return Promise.reject(new Error("connection reset"));
      return sql(strings, ...values);
    }) as unknown as SQL;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const roles = new PgStaffRoles(wrappedSql, 60_000, 5_000, () => clock);
    try {
      await roles.load();
      expect(roles.grants("grace@example.org")).toEqual([{ role: "reviewer", app: "slop" }]);

      fail = true;
      clock += 2_000;
      await roles.load();
      expect(roles.grants("grace@example.org")).toEqual([{ role: "reviewer", app: "slop" }]);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      await roles.load();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      fail = false;
      clock += 1_000;
      await roles.load();
      expect(roles.grants("grace@example.org")).toEqual([{ role: "reviewer", app: "slop" }]);

      fail = true;
      clock += 1_000;
      await roles.load();
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(roles.grants("grace@example.org")).toEqual([{ role: "reviewer", app: "slop" }]);

      clock += 6_000;
      expect(roles.grants("grace@example.org")).toEqual([]);
    } finally {
      roles.stop();
      warnSpy.mockRestore();
      await sql`delete from platform.staff_roles where email = 'grace@example.org'`;
    }
  }, T);

  test("held-photo error pass-through includes SECURITY_HEADERS and strips review token; deleted members leave state and known cache", async () => {
    const item = "pri_" + "d".repeat(32);
    const service = await serveHttp({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/staff/relay/:id/photo": () => new Response(JSON.stringify({ error: "denied" }), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-network-photo-review-token": `${Date.now() + 60_000}.${"a".repeat(64)}`,
          },
        }),
      },
      fetch: () => Response.json({ ok: true }),
    });

    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (app_id, id, name, home_city, account_status, age, joined_at) values
        ('slop', 'mh1', 'Ada Keep', 'nyc', 'active', 30, now()),
        ('slop', 'mh2', 'Zed Gone', 'nyc', 'active', 31, now())`;
    });

    const srv = await createServer({
      port: 0,
      development: false,
      mode: "real",
      tokens: `admin:${TOK.admin},safety:${TOK.safety},analyst:${TOK.analyst}`,
      audit: { dir: join(dir, "audit-real") },
      lab: { dir: join(dir, "lab-real") },
      real: {
        url,
        pollMs: 3_600_000,
        pushMs: 3_600_000,
        service: { url: `http://127.0.0.1:${service.port}`, token: "service-tok" },
      },
      peopleUrl: url,
      staffRolesUrl: false,
    });
    try {
      const photoRes = await fetch(`${srv.url}/api/held/${item}/photo?app=slop`, {
        headers: {
          authorization: `Bearer ${TOK.safety}`,
          "x-network-reason": "verifying error security headers",
        },
      });
      expect(photoRes.status).toBe(403);
      expect(photoRes.headers.get("x-network-photo-review-token")).toBeNull();
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        expect(photoRes.headers.get(k)).toBe(v);
      }

      const beforeState = await (await fetch(`${srv.url}/api/state?app=slop`, {
        headers: { authorization: `Bearer ${TOK.admin}` },
      })).json() as ObsState;
      expect(beforeState.members.map(m => m.id).sort()).toEqual(["mh1", "mh2"]);

      await sql.begin(async tx => {
        await tx`set local app.app_id = 'slop'`;
        await tx`delete from network.members where app_id = 'slop' and id = 'mh2'`;
      });

      const refresh = await fetch(`${srv.url}/api/control?app=slop`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOK.admin}`, "content-type": "application/json" },
        body: JSON.stringify({ type: "refresh" }),
      });
      expect(refresh.status).toBe(200);

      const afterState = await (await fetch(`${srv.url}/api/state?app=slop`, {
        headers: { authorization: `Bearer ${TOK.admin}` },
      })).json() as ObsState;
      expect(afterState.members.map(m => m.id)).toEqual(["mh1"]);
      expect(JSON.stringify(afterState)).not.toContain("Zed Gone");

      const overPerson = JSON.stringify({ app: "slop", reason: "x".repeat(MAX_JSON_BODY_BYTES + 1024) });
      const personRes = await fetch(`${srv.url}/api/person/p1/open`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOK.admin}`, "content-type": "application/json" },
        body: overPerson,
      });
      expect(personRes.status).toBe(413);
      expect(personRes.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      await srv.stop();
      service.stop(true);
    }
  }, T);
});
