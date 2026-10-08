// The OAuth flow on Postgres: a database of its own per test process (mcp_test_<pid>) on the local
// dev cluster (:54339), dropped afterwards. Skipped when Postgres is not installed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { addMember, call, connect, origin, PHONE_A, setup, tokenRequest } from "./harness.ts";

const USER = process.env.USER ?? "postgres";
const DB = `mcp_test_${process.pid}`;
const admin = async (q: string) => {
  const sql = new SQL({ url: `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
};

describe.skipIf(!pgAvailable)("PgOAuthStore", () => {
  let store: PgOAuthStore;
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(`postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`);
    await store.migrate();
    await store.migrate(); // repeatable
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("full flow, refresh rotation and replay, with hashes only at rest", async () => {
    const env = setup({ store });
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, "peon.biz", PHONE_A);
    expect(c.tokenRes.status).toBe(200);
    const url = `${origin("peon.biz")}/mcp`;
    expect((await call(env, url, "check_status", {}, { token: c.token.access_token })).body!.result.structuredContent.status).toBe("active");
    const r1 = await tokenRequest(env, "peon.biz", { grant_type: "refresh_token", refresh_token: c.token.refresh_token, client_id: c.client.client_id });
    expect(r1.res.status).toBe(200);
    expect((await tokenRequest(env, "peon.biz", { grant_type: "refresh_token", refresh_token: c.token.refresh_token, client_id: c.client.client_id })).body.error).toBe("invalid_grant");
    expect((await call(env, url, "check_status", {}, { token: r1.body.access_token })).res.status).toBe(401);
    const dump = JSON.stringify(await store.sql`select * from oauth.tokens`) + JSON.stringify(await store.sql`select * from oauth.codes`) + JSON.stringify(await store.sql`select * from oauth.audit`);
    for (const secret of [c.token.access_token, c.token.refresh_token, r1.body.access_token, c.code]) expect(dump).not.toContain(secret);
    expect(dump).not.toContain("5550142");
    expect((await store.auditRows()).map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(["client_registered", "consent_granted", "token_issued", "token_refreshed", "refresh_replay"]));
  });

  test("a code is taken once under a race; rate windows count and reset", async () => {
    const env = setup({ store });
    const c = await connect(env, "slop.date", PHONE_A);
    const g = (await store.grantsFor(env.accounts.phoneHash(PHONE_A), "slop", env.clock.t))[0]!;
    await store.putCode({ hash: "race", grantId: g.id, clientId: c.client.client_id, redirectUri: "https://client.example/callback", codeChallenge: "x".repeat(43), resource: "https://slop.date/mcp", scopes: ["apps:read"], createdAt: env.clock.t, expiresAt: env.clock.t + 60_000, usedAt: null });
    const taken = await Promise.all([1, 2, 3, 4].map(() => store.takeCode("race", env.clock.t)));
    expect(taken.filter(t => t!.usedAt === null)).toHaveLength(1);
    const t0 = 3_600_000 * 1000;
    expect(await store.hit("b", 60_000, t0)).toBe(1);
    expect(await store.hit("b", 60_000, t0 + 1)).toBe(2);
    expect(await store.hit("b", 60_000, t0 + 60_000)).toBe(1);
    await store.sweep(env.clock.t + 365 * 24 * 3_600_000);
    expect((await store.sql`select count(*)::int as n from oauth.tokens`)[0].n).toBe(0);
  });
});
