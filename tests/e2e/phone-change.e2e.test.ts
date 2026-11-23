// spec/phoneChange.md: a member whose number changed keeps one person (Story F25), through HTTP in both
// sign-in modes, at the API that the /phone page calls: the person signs in on the current number, then proves the
// new number with a platform code that the agent never sees.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serveHttp, type HttpServer } from "../../packages/core/src/runtime/http.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { PgPeopleStore } from "../../packages/platform/src/pg-store.ts";
import { dropDb, migratedDb } from "../../packages/platform/test/pg.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, signIn, startStack, toolData, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const MIN = 60_000;
// A Cloud sign-in site has no platform sign-in code, so the answer names no code.
const REAUTH_TEXT = "For your safety, sign in again with your current number, then change your number.";

describe.skipIf(!pgAvailable)("phone change on an OTP sign-in site", () => {
  let st: Stack;
  beforeAll(async () => { st = await startStack(); }, T);
  afterAll(async () => { await st?.close(); }, T);

  // spec/phoneChange.md, "The request uses the existing account"; "The verified request can move only when both numbers allow it"
  test("a fresh sign-in on the old number and a code to the new one keep the person, the membership and the connector", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b, res } = await webJoin(st, "slop", A, { age: 31, firstName: "Ana" });
    expect(res.status).toBe(200);
    const personId = (await st.svc.publicApi.accounts.personFor(A))!.id;
    const connector = await connectMcp(st, "slop", A);
    const token = connector.token!.access_token as string;
    const status = async () => toolData(await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token));
    expect(await status()).toMatchObject({ app: "slop" });

    st.clock.advance(11 * MIN);
    const stale = await st.site("slop", "/api/me/phone/start", { browser: b, json: { phone: B } });
    expect({ status: stale.status, body: await stale.json() }).toMatchObject({ status: 403, body: { error: "reauth", message: REAUTH_TEXT } });
    expect(st.otp.last(B)).toBeUndefined();

    await signIn(st, "slop", A, b);
    const old = new Browser();
    for (const [k, v] of b.jar) old.jar.set(k, v);
    expect((await st.site("slop", "/api/me/phone/start", { browser: b, json: { phone: B } })).status).toBe(200);
    expect(await (await st.site("slop", "/api/me/phone/confirm", { browser: b, json: { code: "000000" } })).json()).toEqual({ ok: false, error: "invalid_code" });
    const moved = await st.site("slop", "/api/me/phone/confirm", { browser: b, json: { code: st.otp.last(B) } });
    expect({ status: moved.status, body: await moved.json() }).toMatchObject({ status: 200, body: { ok: true } });

    expect((await st.site("slop", "/api/me", { browser: old })).status).toBe(401);
    expect(await (await st.site("slop", "/api/me", { browser: b })).json()).toMatchObject({ membership: { state: expect.stringMatching(/^(active|onboarding)$/) } });
    expect(await st.svc.publicApi.accounts.personFor(A)).toBeUndefined();
    expect((await st.svc.publicApi.accounts.personFor(B))!.id).toBe(personId);
    // A native connector grant follows the person to the new number.
    expect(await status()).toMatchObject({ app: "slop", status: expect.stringMatching(/^(active|onboarding)$/) });
  }, T);

  // spec/phoneChange.md, "The verified request can move only when both numbers allow it"
  test("a banned new number refuses after its code is proved, and the person stays on the old number", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b } = await webJoin(st, "slop", A, { age: 30 });
    expect(await (await st.site("slop", "/api/me/phone/start", { browser: b, json: { phone: B } })).json()).toEqual({ ok: true });
    const code = st.otp.last(B);
    expect(code).toMatch(/^\d{6}$/);
    await st.svc.people.ban({ id: crypto.randomUUID(), scope: "phone", personId: null, phoneHash: st.svc.publicApi.accounts.phoneHash(B),
      reason: "owned fixture", reportId: null, bannedBy: "fixture", at: st.clock.now() });
    const refused = await st.site("slop", "/api/me/phone/confirm", { browser: b, json: { code } });
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({ status: 403, body: { error: "review" } });
    expect(await st.svc.publicApi.accounts.personFor(B)).toBeUndefined();
    expect((await st.site("slop", "/api/me", { browser: b })).status).toBe(200);
  }, T);

  // spec/otpLimits.md, "Start keeps its public response private"; spec/phoneChange.md, "The verified request can move only when both numbers allow it"
  test("a number banned before the start gets the ordinary answer and no code, and the person stays on the old number", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b } = await webJoin(st, "slop", A, { age: 30 });
    await st.svc.people.ban({ id: crypto.randomUUID(), scope: "phone", personId: null, phoneHash: st.svc.publicApi.accounts.phoneHash(B),
      reason: "owned fixture", reportId: null, bannedBy: "fixture", at: st.clock.now() });
    expect(await (await st.site("slop", "/api/me/phone/start", { browser: b, json: { phone: B } })).json()).toEqual({ ok: true });
    expect(st.otp.last(B)).toBeUndefined();
    expect(await (await st.site("slop", "/api/me/phone/confirm", { browser: b, json: { code: "123456" } })).json()).toMatchObject({ ok: false });
    expect(await st.svc.publicApi.accounts.personFor(B)).toBeUndefined();
    expect((await st.site("slop", "/api/me", { browser: b })).status).toBe(200);
  }, T);

  // spec/phoneChange.md, "Change the phone on my account": the text line sends the one-purpose link
  test("a member who texts CHANGE NUMBER gets the app's /phone link in one reply, and a person who is not a member gets no link", async () => {
    let seq = 0;
    const turn = async (phone: string, text: string) => {
      const messageId = `phone-link-${++seq}`;
      const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
      const raw = JSON.stringify(body);
      const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json",
        ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
      expect(res.status).toBe(200);
      st.clock.advance(MIN);
      return (await res.json()) as { outcome: string; replies?: string[] };
    };
    const A = newPhone();
    expect((await webJoin(st, "slop", A, { age: 31, firstName: "Ana" })).res.status).toBe(200);
    expect(await turn(A, "CHANGE NUMBER")).toMatchObject({ outcome: "handled", replies: [
      "To change the number on your account, open https://slop.date/phone and sign in with your current number. Then enter the new number and the code that we text to it.",
    ] });
    expect(JSON.stringify(await turn(A, "change my number to +12125550199"))).not.toContain("/phone");
    expect(JSON.stringify(await turn(newPhone(), "change my number"))).not.toContain("/phone");
  }, T);
});

describe.skipIf(!pgAvailable)("phone change on a Cloud sign-in site", () => {
  let url: string, store: PgPeopleStore, server: HttpServer;
  let now = Date.UTC(2026, 10, 18, 15);
  let cloudPhone = "", challenge = "", exchanges = 0;
  const codes = new Map<string, string>();
  beforeAll(async () => {
    url = await migratedDb("e2e_phone_change_cloud");
    store = new PgPeopleStore(url);
    let platform: ReturnType<typeof createPublicApi> | undefined;
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: async req => (await platform!.fetch(req)) ?? new Response("Not found", { status: 404 }) });
    const origin = `http://127.0.0.1:${server.port}`;
    platform = createPublicApi({
      store, now: () => now, hostMap: { [`127.0.0.1:${server.port}`]: "slop" }, minStartMs: 0, minVerifyMs: 0, log: () => {},
      env: {
        PLATFORM_ENV: "dev", NETWORK_CLOUD_AUTH_MODE: "staging-local", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
        NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: origin,
        NETWORK_CLOUD_AUTH_SERVER_TOKEN: "phone-change-e2e-cloud-fixture".repeat(2),
      },
      // The platform OTP service proves only the new number; Cloud proves the current one.
      otp: { name: "fake", send: async e164 => { const code = String(300000 + codes.size); codes.set(e164, code); return { code }; } },
      // Eliza Cloud's exchange and validation endpoints at their HTTP boundary: Cloud proves the phone it is told to.
      cloudAuthFetch: async input => {
        const req = input instanceof Request ? input : new Request(input);
        if (new URL(req.url).pathname.endsWith("network-validate")) return Response.json({ ok: true });
        const body = await req.json() as { codeVerifier: string };
        if (createHash("sha256").update(body.codeVerifier).digest("hex") !== challenge) return Response.json({ ok: false }, { status: 401 });
        return Response.json({ userId: `cloud-user-${cloudPhone}`, organizationId: "cloud-org-fixture", stewardUserId: "steward-fixture",
          e164: cloudPhone, issuedAt: Math.floor(now / 1000), expiresAt: now + 30 * MIN });
      },
    });
  }, T);
  afterAll(async () => { await server?.stop(true); await store?.close(); if (url) await dropDb(url); }, T);

  const call = async (b: Browser, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: `http://127.0.0.1:${server.port}` };
    if (b.jar.size) headers.cookie = b.header();
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers, redirect: "manual", ...(body ? { body: JSON.stringify(body) } : {}) });
    b.take(res);
    return { status: res.status, location: res.headers.get("location"), body: await res.json().catch(() => null) as any };
  };
  /** The /phone page's Cloud sign-in: start, Eliza Cloud's redirect back, and the callback that lands on /phone. */
  const cloudSignIn = async (b: Browser, phone: string) => {
    cloudPhone = phone;
    const start = await call(b, "POST", "/api/auth/cloud/start", { returnPath: "/phone" });
    expect(start.status).toBe(200);
    const authorize = new URL(start.body.url);
    challenge = authorize.searchParams.get("challenge")!;
    const back = await call(b, "GET", `/api/auth/cloud/callback?code=enso_${(++exchanges).toString(16).padStart(64, "0")}&state=${authorize.searchParams.get("state")}`);
    expect({ status: back.status, location: back.location }).toEqual({ status: 303, location: "/phone" });
  };

  // spec/phoneChange.md, "The request uses the existing account"; "After a move the browser signs in on the new number in its own sign-in mode"
  test("a fresh Cloud proof of the old number starts the change, the platform code moves the person, and only the new number reaches them", async () => {
    const [A, B] = ["+12125550231", "+12125550232"];
    const b = new Browser();
    await cloudSignIn(b, A);
    expect((await call(b, "POST", "/api/join", { firstName: "Ana", age: 31, consent: { sms: true, version: APPS.slop.consent.version } })).status).toBe(200);
    const personId = (await store.findPhone(A))!.personId;

    now += 11 * MIN;
    expect(await call(b, "POST", "/api/me/phone/start", { phone: B })).toMatchObject({ status: 403, body: { error: "reauth", message: REAUTH_TEXT } });
    expect(codes.has(B)).toBe(false);
    await cloudSignIn(b, A);
    const old = new Browser();
    for (const [k, v] of b.jar) old.jar.set(k, v);
    expect(await call(b, "POST", "/api/me/phone/start", { phone: B })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await call(b, "POST", "/api/me/phone/confirm", { code: codes.get(B) })).toMatchObject({ status: 200, body: { ok: true } });

    // The browser keeps no session and no Cloud identity that names the released number.
    expect(b.jar.size).toBe(0);
    expect((await call(old, "GET", "/api/me")).status).toBe(401);
    expect(await store.findPhone(A)).toBeUndefined();
    // A new Cloud proof of the old number does not reach the person.
    const recycled = new Browser();
    await cloudSignIn(recycled, A);
    expect((await call(recycled, "GET", "/api/me")).body).toMatchObject({ membership: null, canJoin: true });
    // A Cloud sign-in on the new number reaches the same person and membership.
    await cloudSignIn(b, B);
    expect((await call(b, "GET", "/api/me")).body).toMatchObject({ membership: { state: "active", firstName: "Ana" } });
    expect((await store.findPhone(B))!.personId).toBe(personId);
  }, T);
});
