// spec/oauthGrantIssuance.md, "A staff ban refuses grant admission"
// Postgres: registration, token use and refresh. A banned grant is refused at each step.
// An unrelated account stays able to use, refresh and register.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";
import { Accounts, APPS, type AppInfo, OtpService, PgPeopleStore, SessionService } from "@thenetwork/platform";
import { migrate } from "../../observatory/db/migrate.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { createMcpHandler } from "../src/handler.ts";
import { platformHooks } from "../src/hooks.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { browserFlow, call, connect, FakeOtp, HASH_KEY, origin, PHONE_A, PHONE_B, register, tokenRequest, VERIFIER, type Env } from "./harness.ts";

const PEON = "peon.biz";
const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const DB = `mcp_ban_${process.pid}`;
if (process.env.REQUIRE_PG === "1" && !pgAvailable) throw new Error("OAuth ban regression requires PostgreSQL");

function codeFrom(location: string | null | undefined): string | null {
  return location ? new URL(location).searchParams.get("code") : null;
}

describe.skipIf(!pgAvailable)("staff ban refuses live MCP grants on Postgres", () => {
  let people: PgPeopleStore;
  let oauth: PgOAuthStore;
  let env: Env;

  beforeAll(async () => {
    await devPgUp();
    const admin = new SQL({ url: ADMIN_URL, max: 1 });
    try { await admin.unsafe(`create database ${DB}`); } finally { await admin.close(); }
    const url = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
    await migrate(url, { lockTimeout: "5s" });
    oauth = new PgOAuthStore(url);
    await oauth.migrate();
    people = new PgPeopleStore(url);
    const clock = { t: Date.UTC(2026, 9, 8, 12, 0, 0) };
    const now = () => clock.t;
    const provider = new FakeOtp();
    const otp = new OtpService(people, provider, { hashKey: HASH_KEY, now });
    const accounts = new Accounts(people, { hashKey: HASH_KEY, now, apps: id => (APPS as Record<string, AppInfo>)[id]! });
    const sessions = new SessionService(people, { secret: "test-session-secret", now });
    const handler = createMcpHandler({
      platform: platformHooks({ store: people, otp, accounts, sessions, app: id => (APPS as Record<string, AppInfo | undefined>)[id], cookieName: id => `sid_${id}` }),
      store: oauth, now, minOtpStartMs: 0,
    });
    const fetch = async (req: Request) => (await handler.fetch(req)) ?? new Response("not mine", { status: 418 });
    env = { clock, people, provider, otp, accounts, sessions, handler, store: oauth, fetch, logs: [] } as unknown as Env;
  });

  afterAll(async () => {
    await oauth?.close();
    await people?.close();
    const admin = new SQL({ url: ADMIN_URL, max: 1 });
    try { await admin.unsafe(`drop database if exists ${DB} with (force)`); } finally { await admin.close(); }
  });

  test("registration, token use and refresh refuse the banned grant and leave another account working", async () => {
    const bannedPerson = await people.createPerson({ id: randomUUID(), e164: PHONE_A, method: "otp_sms", at: env.clock.t, lowestAge: 30, phoneHash: env.accounts.phoneHash(PHONE_A) });
    const allowedPerson = await people.createPerson({ id: randomUUID(), e164: PHONE_B, method: "otp_sms", at: env.clock.t, lowestAge: 30, phoneHash: env.accounts.phoneHash(PHONE_B) });
    for (const id of [bannedPerson.id, allowedPerson.id]) {
      await people.putMembership({ app: "peon", personId: id, memberId: randomUUID(), state: "active", review: null, firstName: "Rae", profile: {}, joinedAt: env.clock.t, leftAt: null });
    }

    const banned = await connect(env, PEON, PHONE_A);
    const allowed = await connect(env, PEON, PHONE_B);
    const mcp = `${origin(PEON)}/mcp`;
    expect((await call(env, mcp, "check_status", {}, { token: banned.token.access_token })).res.status).toBe(200);
    expect((await call(env, mcp, "check_status", {}, { token: allowed.token.access_token })).res.status).toBe(200);

    const pending = await register(env, PEON);
    const pendingFlow = await browserFlow(env, PEON, pending.body.client_id, PHONE_A);
    const pendingCode = codeFrom(pendingFlow.location);
    expect(pendingCode).toBeTruthy();

    await people.ban({
      id: `ban_${randomUUID()}`,
      scope: "person",
      personId: bannedPerson.id,
      phoneHash: env.accounts.phoneHash(PHONE_A),
      reason: "staff",
      reportId: null,
      bannedBy: "staff:1",
      at: env.clock.t,
    });
    expect(await env.accounts.banned(PHONE_A)).toBe(true);
    expect(await env.accounts.banned(PHONE_B)).toBe(false);

    const exchanged = await tokenRequest(env, PEON, {
      grant_type: "authorization_code",
      code: pendingCode!,
      redirect_uri: "https://client.example/callback",
      client_id: pending.body.client_id,
      code_verifier: VERIFIER,
    });
    expect(exchanged.res.status).toBe(400);
    expect(exchanged.body.error).toBe("invalid_grant");
    expect((await call(env, mcp, "check_status", {}, { token: banned.token.access_token })).res.status).toBe(401);
    const bannedRefresh = await tokenRequest(env, PEON, {
      grant_type: "refresh_token",
      refresh_token: banned.token.refresh_token,
      client_id: banned.client.client_id,
    });
    expect(bannedRefresh.res.status).toBe(400);
    expect(bannedRefresh.body.error).toBe("invalid_grant");

    const sentBefore = env.provider.sent.filter(row => row.e164 === PHONE_A).length;
    const again = await browserFlow(env, PEON, (await register(env, PEON)).body.client_id, PHONE_A);
    expect(codeFrom(again.location)).toBeNull();
    expect(env.provider.sent.filter(row => row.e164 === PHONE_A).length).toBe(sentBefore);

    expect((await call(env, mcp, "check_status", {}, { token: allowed.token.access_token })).res.status).toBe(200);
    const allowedRefresh = await tokenRequest(env, PEON, {
      grant_type: "refresh_token",
      refresh_token: allowed.token.refresh_token,
      client_id: allowed.client.client_id,
    });
    expect(allowedRefresh.res.status).toBe(200);
    expect((await call(env, mcp, "check_status", {}, { token: allowedRefresh.body.access_token })).res.status).toBe(200);
    const allowedAgain = await connect(env, PEON, PHONE_B);
    expect((await call(env, mcp, "check_status", {}, { token: allowedAgain.token.access_token })).res.status).toBe(200);
  });
});
