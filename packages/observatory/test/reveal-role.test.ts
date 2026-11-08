// SD-084 (observatory D03): the per-member PII reveal on a running console server with Cloudflare
// Access sign-in and roles read from platform.staff_roles (Postgres). A reveal is for safety and admin
// staff (admin-console 4.4): when the safety role is taken away, the reveal stops at the next role
// reload, also for a member the staff member can still open as a reviewer. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { SQL } from "bun";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { MemberDetail, MemberTimeline, ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2", ISS = "https://ntwrk.cloudflareaccess.com";
const b64 = (x: string | ArrayBuffer) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");

describe.skipIf(!pgAvailable)("PII reveal after a role change (Postgres)", () => {
  let dir: string;
  let sql: SQL;
  let srv: ObservatoryServer;
  let jwt: string;
  const get = (path: string) => fetch(srv.url + path, { headers: { "cf-access-jwt-assertion": jwt } });
  const post = (path: string, body: unknown) => fetch(srv.url + path, { method: "POST", headers: { "cf-access-jwt-assertion": jwt, "content-type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-reveal-role-"));
    const url = await testDb();
    sql = new SQL(url);
    // A local Access signing key and its certs endpoint.
    const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const now = Math.floor(Date.now() / 1000);
    const head = `${b64(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))}.${b64(JSON.stringify({ aud: [AUD], iss: ISS, email: "saf@example.org", iat: now - 30, exp: now + 3600, type: "app" }))}`;
    jwt = `${head}.${b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(head)))}`;
    await sql`insert into platform.staff_roles (email, role, app_id, granted_by) values ('saf@example.org', 'safety', null, 'test'), ('saf@example.org', 'reviewer', null, 'test')`;
    srv = await createServer({
      port: 0, development: false, trustCfAccess: true, roles: "",
      cfAccess: { team: "ntwrk", aud: AUD, fetch: async () => Response.json({ keys: [jwk], public_cert: { kid: "k1", cert: "-----BEGIN CERTIFICATE-----" } }) },
      staffRolesUrl: url, staffRolesEveryMs: 100,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 },
    });
    expect((await post("/api/control", { type: "step", ms: DAY })).status).toBe(200);
  }, T);

  afterAll(async () => {
    await srv?.stop();
    await sql?.close();
    await dropTestDb();
    await rm(dir, { recursive: true, force: true });
  });

  test("a reveal gives no member's own words after the safety role is taken away", async () => {
    const s = await (await get("/api/state")).json() as ObsState;
    const m = s.opportunities.find(o => o.state === "IN_REVIEW")!.participants[0]!;
    expect((await post("/api/reveal", { memberId: m, reason: "checking a safety report", minutes: 15 })).status).toBe(200);
    expect((await (await get(`/api/member/${m}`)).json() as MemberDetail).revealed).toBeDefined();
    await sql`delete from platform.staff_roles where email = 'saf@example.org' and role = 'safety'`;
    await Bun.sleep(400);
    // Now a reviewer: m is in an open review item, so the member opens, but without the reveal.
    expect((await post("/api/reveal", { memberId: m, reason: "checking a safety report" })).status).toBe(403);
    const d = await get(`/api/member/${m}`);
    expect(d.status).toBe(200);
    expect((await d.json() as MemberDetail).revealed).toBeUndefined();
    expect((await (await get(`/api/member/${m}/timeline`)).json() as MemberTimeline & { revealed?: unknown }).revealed).toBeUndefined();
  }, T);
});
