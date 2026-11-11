// OAuth consent and the forget path on Postgres (machines oauth-consent and oauth-grant in
// docs/research/state-machines/mcp-oauth.md, model finding Q-oauth_mcp-1 in
// docs/research/quint-findings/oauth_mcp.md). A unique database on the dev cluster, dropped afterwards.
// The approval and the leave run on separate connections, as two requests do in production.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import type { AuthCode, AuthRequest, Grant } from "../src/store.ts";
import { sha256hex } from "../src/util.ts";
import { PHONE_A, register, setup } from "./harness.ts";

const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
if (process.env.REQUIRE_PG === "1" && !pgAvailable) throw new Error("OAuth integration requires PostgreSQL");
const DB = `mcp_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${DB}`;
const admin = async (q: string) => {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
};

describe.skipIf(!pgAvailable)("consent approval and the forget path", () => {
  let store: PgOAuthStore;
  beforeAll(async () => {
    await devPgUp();
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(testUrl.toString());
    await store.migrate();
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  const waiting = async (sql: SQL, prefix: string) => {
    for (let i = 0; i < 200; i++) {
      const [r] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like ${`${prefix}%`}`;
      if ((r as { n: number }).n > 0) return;
      await Bun.sleep(25);
    }
    throw new Error(`no query waits: ${prefix}`);
  };

  // Q-oauth_mcp-1: the person approves while they leave the app. The approval took the sign-in request
  // and stores its grant; the leave (revokeAllFor with forget) runs meanwhile. Before the fix forgetPhone
  // deleted the grants before the approval committed, so it did not see the new grant, and then it found
  // no request to delete: a live grant linked the number to an app the person had left.
  test("a grant approved while the person leaves the app does not stay", async () => {
    const env = setup({ store });
    const client = (await register(env, "peon.biz")).body.client_id as string;
    const at = env.clock.t, phoneKey = env.accounts.phoneHash(PHONE_A);
    const request: AuthRequest = {
      id: `approval_${randomUUID()}`, browserHash: sha256hex("browser-cookie"), clientId: client, app: "peon",
      redirectUri: "https://client.example/callback", state: "state", codeChallenge: sha256hex("challenge"),
      scopes: ["membership:read"], resource: "https://peon.biz/mcp", e164: PHONE_A, personId: null,
      step: "consent", createdAt: at, expiresAt: at + 60_000,
    };
    await store.putAuthRequest(request);
    const grant: Grant = { id: `grant_${randomUUID()}`, clientId: client, app: "peon", phoneKey, personId: null, scopes: request.scopes, resource: request.resource, createdAt: at, expiresAt: at + 86_400_000, revokedAt: null };
    const code: AuthCode = { hash: sha256hex(`code-${grant.id}`), grantId: grant.id, clientId: client, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, resource: request.resource, scopes: request.scopes, createdAt: at, expiresAt: at + 60_000, usedAt: null };

    const watch = new SQL({ url: testUrl.toString(), max: 1 });
    const locker = await store.sql.reserve();
    try {
      // Hold the approval open after it took the request and stored the grant: its code insert waits.
      await locker`begin`;
      await locker`lock table oauth.codes in exclusive mode`;
      const approving = store.approveConsent(request.id, at, () => ({ grant, code, audit: [] }));
      await waiting(watch, "insert into oauth.codes");
      const leaving = env.handler.revokeAllFor(PHONE_A, "peon", { forget: true });
      await waiting(watch, "delete from oauth.auth_requests");
      await locker`commit`;
      expect((await approving)?.issued?.grant.id).toBe(grant.id);
      await leaving;
    } finally {
      locker.release();
      await watch.close();
    }
    expect(await store.getGrant(grant.id)).toBeUndefined();
    expect(await store.grantsFor(phoneKey, "peon", at)).toEqual([]);
  });
});
