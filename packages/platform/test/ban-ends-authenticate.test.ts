// A staff ban must refuse an already-issued web cookie on the next request (spec/webSession.md,
// "A banned phone or person is not admitted"). This is the per-request admission. It covers a session
// row that ban-time cleanup does not revoke: #172 endAuthForBan only updates rows whose person id
// matches, or whose e164 is a phone identity of that person. A pre-join cookie has neither, and a
// session stored after that cleanup is a new row. OTP verify and the Cloud callback are the two
// ways a site cookie is issued. Phone-scope and person-scope bans are both refused.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { APPS, type AppId } from "../src/apps.ts";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import { tokenHash } from "../src/sessions.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { MemoryPeopleStore, type PeopleStore, type Session } from "../src/store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
const HASH = "dev-only-platform-hash-key";
const SECRET = "dev-only-platform-session-secret";
let seq = 0;
const newPhone = () => `+121255501${String(++seq).padStart(2, "0")}`;

function make(store: PeopleStore) {
  const clock = { t: Date.UTC(2026, 9, 9, 15) };
  const codes = new Map<string, string>();
  let sends = 0;
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: HASH, PLATFORM_SESSION_SECRET: SECRET }, now: () => clock.t,
    minStartMs: 0, minVerifyMs: 0, log: () => {},
    ipOf: () => `198.51.100.${(seq % 200) + 1}`,
    otp: { name: "fake", send: async e164 => { sends++; const code = String(100000 + ((sends * 7919) % 900000)); codes.set(e164, code); return { code }; } },
  });
  const call = async (app: AppId, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = (await api.fetch(new Request(`http://${HOST[app]}${path}`, {
      method, headers: { host: HOST[app], ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })))!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (app: AppId, phone: string) => {
    expect((await call(app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    const v = await call(app, "POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) });
    expect(v.status).toBe(200);
    clock.t += 31_000;
    return v.cookie!;
  };
  return { api, clock, call, login };
}

/** #172 deletes or revokes by person id, or by an e164 stored on that person's phone identity. */
async function banCleanupWouldRevoke(store: PeopleStore, session: Session, personId: string): Promise<boolean> {
  if (session.personId === personId) return true;
  const identity = await store.findPhone(session.e164);
  return identity?.personId === personId;
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });
const stores = [
  { name: "memory", skip: false, make: async (): Promise<PeopleStore> => new MemoryPeopleStore() },
  { name: "postgres", skip: !pgAvailable, make: async (): Promise<PeopleStore> => { const u = await migratedDb("banauth"); urls.push(u); return new PgPeopleStore(u); } },
];

for (const s of stores) describe.skipIf(s.skip)(`ban ends an already-issued web cookie (${s.name})`, () => {
  let store: PeopleStore;
  beforeAll(async () => { store = await s.make(); }, 120_000);
  afterAll(async () => { await (store as PgPeopleStore).close?.(); });

  async function liveRow(token: string): Promise<Session> {
    const row = await store.getSession(tokenHash(token, SECRET));
    expect(row?.revokedAt).toBeNull();
    return row!;
  }

  test("otp login: a person ban and a phone ban refuse the next request", async () => {
    const c = make(store);
    for (const scope of ["person", "phone"] as const) {
      const phone = newPhone();
      const cookie = await c.login("slop", phone);
      const token = cookie.split("=")[1]!;
      expect(token.startsWith("cloud.")).toBe(false);
      expect((await c.call("slop", "POST", "/api/join", { firstName: "Ana", age: 30, consent: { sms: true, wording: APPS.slop.consent.text } }, { cookie })).status).toBe(200);
      expect((await c.call("slop", "GET", "/api/me", undefined, { cookie })).status).toBe(200);
      const personId = (await c.api.accounts.personFor(phone))!.id;
      const before = await liveRow(token);
      await store.ban({
        id: `ban_otp_${scope}_${phone}`, scope, personId: scope === "person" ? personId : null,
        phoneHash: scope === "phone" ? c.api.accounts.phoneHash(phone) : null,
        reason: "abuse", reportId: null, bannedBy: "staff", at: c.clock.t,
      });
      // The ban row does not revoke the cookie. Admission does, on the next request.
      expect((await store.getSession(before.tokenHash))!.revokedAt).toBeNull();
      expect((await c.call("slop", "GET", "/api/me", undefined, { cookie })).status).toBe(401);
      expect((await c.call("slop", "GET", "/api/me/export", undefined, { cookie })).body).toEqual({ ok: false, error: "unauthorized" });
      expect((await store.getSession(before.tokenHash))!.revokedAt).toBe(c.clock.t);
      expect(await c.api.sessions.authenticate("slop", token)).toBeUndefined();
    }
  });

  test("otp login: a pre-join cookie and a session written after eager cleanup are still refused", async () => {
    const c = make(store);
    const phone = newPhone();
    const cookie = await c.login("friends", phone);
    const token = cookie.split("=")[1]!;
    const before = await liveRow(token);
    expect(before.personId).toBeNull();
    expect(await store.findPhone(phone)).toBeUndefined();
    // No person and no phone identity: #172's cleanup predicate matches nothing on this row.
    await store.ban({ id: `ban_miss_${phone}`, scope: "phone", personId: null, phoneHash: c.api.accounts.phoneHash(phone), reason: "spam", reportId: null, bannedBy: "staff", at: c.clock.t });
    expect(await banCleanupWouldRevoke(store, before, "person-the-cleanup-was-given")).toBe(false);
    expect((await c.call("friends", "GET", "/api/me", undefined, { cookie })).status).toBe(401);
    expect((await store.getSession(before.tokenHash))!.revokedAt).toBe(c.clock.t);

    const joined = newPhone();
    const joinedCookie = await c.login("peon", joined);
    expect((await c.call("peon", "POST", "/api/join", { firstName: "Bea", age: 28, consent: { sms: true, wording: APPS.peon.consent.text } }, { cookie: joinedCookie })).status).toBe(200);
    const personId = (await c.api.accounts.personFor(joined))!.id;
    const issued = await liveRow(joinedCookie.split("=")[1]!);
    expect(await banCleanupWouldRevoke(store, issued, personId)).toBe(true);
    await store.ban({ id: `ban_late_${joined}`, scope: "person", personId, phoneHash: c.api.accounts.phoneHash(joined), reason: "abuse", reportId: null, bannedBy: "staff", at: c.clock.t });
    // Eager cleanup revokes the row it can see. A session stored after that is a new live cookie.
    await store.revokeSession(issued.tokenHash, c.clock.t);
    const late = await c.api.sessions.create("peon", joined, personId);
    expect((await store.getSession(late.session.tokenHash))!.revokedAt).toBeNull();
    expect(await c.api.sessions.authenticate("peon", late.token)).toBeUndefined();
    expect((await c.call("peon", "GET", "/api/me", undefined, { cookie: `sid_peon=${late.token}` })).status).toBe(401);
    expect((await store.getSession(late.session.tokenHash))!.revokedAt).toBe(c.clock.t);
  });

  test("cloud login: a person ban and a phone ban refuse the next request", async () => {
    for (const scope of ["person", "phone"] as const) {
      const phone = newPhone();
      const cloud = await cloudSession(store, phone, scope === "person");
      expect(cloud.token.startsWith("cloud.")).toBe(true);
      expect((await cloud.me()).status).toBe(200);
      const before = await liveRow(cloud.token);
      if (scope === "phone") {
        expect(before.personId).toBeNull();
        expect(await banCleanupWouldRevoke(store, before, "no-such-person")).toBe(false);
      }
      const personId = scope === "person" ? (await cloud.api.accounts.personFor(phone))!.id : null;
      await store.ban({
        id: `ban_cloud_${scope}_${phone}`, scope, personId,
        phoneHash: scope === "phone" ? cloud.api.accounts.phoneHash(phone) : null,
        reason: "abuse", reportId: null, bannedBy: "staff", at: cloud.clock.t,
      });
      expect((await store.getSession(before.tokenHash))!.revokedAt).toBeNull();
      const validations = cloud.validations;
      const refused = await cloud.me();
      expect(refused.status).toBe(401);
      expect(refused.body).toEqual({ ok: false, error: "unauthorized" });
      // The Cloud authority still accepts the proof. The 401 is the ban admission, then the revoked row.
      expect(cloud.validations).toBe(validations + 1);
      expect((await store.getSession(before.tokenHash))!.revokedAt).toBe(cloud.clock.t);
      expect(await cloud.api.sessions.authenticate("slop", cloud.token)).toBeUndefined();
    }
  });
});

/** A Cloud callback cookie. `withPerson` creates the person first so the session carries that person id. */
async function cloudSession(store: PeopleStore, phone: string, withPerson: boolean) {
  const clock = { t: Date.UTC(2026, 9, 9, 16) };
  const counted = { validations: 0 };
  let challenge = "";
  const code = `enso_${"ab".repeat(32)}`;
  const consumed = new Set<string>();
  const issuedAt = Math.floor(clock.t / 1000) - 60;
  const expiresAt = clock.t + 3_600_000;
  const transport = (async (request: RequestInfo | URL) => {
    const req = request as Request;
    const body = await req.json() as Record<string, unknown>;
    if (new URL(req.url).pathname.endsWith("network-validate")) {
      counted.validations++;
      return Response.json({ ok: true });
    }
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.codeVerifier)))).toString("hex");
    if (body.code !== code || consumed.has(code) || hash !== challenge) return Response.json({ ok: false }, { status: 401 });
    consumed.add(code);
    return Response.json({ userId: "cloud-user", organizationId: "cloud-org", e164: phone, expiresAt, stewardUserId: "steward", issuedAt });
  }) as typeof fetch;
  const api = createPublicApi({
    store, now: () => clock.t, cloudAuthFetch: transport, cloudValidationTtlMs: 0, minStartMs: 0, minVerifyMs: 0, log: () => {},
    otp: { name: "fake", send: async () => ({ code: "000000" }) },
    env: {
      PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: HASH, PLATFORM_SESSION_SECRET: SECRET,
      NETWORK_CLOUD_AUTH_ENABLED: "true", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
      NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: "http://127.0.0.1:5102",
      NETWORK_CLOUD_AUTH_SERVER_TOKEN: "local-server-fixture".repeat(2),
    },
  });
  if (withPerson) await api.accounts.createPerson(phone, "inbound_message", 30);
  const start = (await api.fetch(new Request("http://127.0.0.1:5102/api/auth/cloud/start", {
    method: "POST", headers: { host: "127.0.0.1:5102", origin: "http://127.0.0.1:5102", "content-type": "application/json" },
    body: JSON.stringify({ returnPath: "/join" }),
  })))!;
  expect(start.status).toBe(200);
  const pending = start.headers.get("set-cookie")!.split(";")[0]!;
  const authorize = new URL((await start.json()).url);
  challenge = authorize.searchParams.get("challenge")!;
  const state = authorize.searchParams.get("state")!;
  const signedIn = (await api.fetch(new Request(`http://127.0.0.1:5102/api/auth/cloud/callback?code=${code}&state=${state}`, {
    headers: { host: "127.0.0.1:5102", cookie: pending },
  })))!;
  expect(signedIn.status).toBe(303);
  const jar = signedIn.headers.getSetCookie().filter(value => !value.startsWith("cloud_pending_")).map(value => value.split(";")[0]).join("; ");
  const token = jar.split("; ").find(part => part.startsWith("sid_slop="))!.split("=")[1]!;
  const me = async () => {
    const res = (await api.fetch(new Request("http://127.0.0.1:5102/api/me", { headers: { host: "127.0.0.1:5102", cookie: jar } })))!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { api, clock, token, me, get validations() { return counted.validations; } };
}
