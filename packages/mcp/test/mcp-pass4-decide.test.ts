// Pass 4 Wave B tests: [DECIDE-1] direct finish_signup_url step-up, [DECIDE-2] OAuth resend & change-phone,
// and [DECIDE-3] get_context (lawContextProfileNeedsProfileRead), set_availability, set_red_lines.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { pgAvailable } from "../../../apps/observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { FINISH_SIGNUP_REDIRECT_URI, MemoryOAuthStore } from "../src/store.ts";
import type { PublicUpdate, SetAvailabilityInput, SetRedLinesInput } from "../src/hooks.ts";
import { addMember, call, CHALLENGE, connect, origin, pendingAuthorizationCookie, PHONE_A, PHONE_B, register, setup } from "./harness.ts";

const ridOf = (html: string) => /name="rid" value="([^"]+)"/.exec(html)?.[1];
const signupViewOf = (html: string) => /name="signupView" value="([^"]+)"/.exec(html)?.[1];
const consentVersionOf = (html: string) => /name="consentVersion" value="([^"]+)"/.exec(html)?.[1];

function mergeCookies(current: string, response: Response): string {
  const values = new Map(current.split("; ").filter(Boolean).map(p => {
    const at = p.indexOf("=");
    return [p.slice(0, at), p.slice(at + 1)];
  }));
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0]!;
    const at = pair.indexOf("=");
    if (pair.slice(at + 1)) values.set(pair.slice(0, at), pair.slice(at + 1));
    else values.delete(pair.slice(0, at));
  }
  return [...values].map(([k, v]) => `${k}=${v}`).join("; ");
}

describe("Pass 4 [DECIDE-1]: direct finish_signup_url step-up re-entry", () => {
  test("prepare_signup returns finish_signup_url; existing browser session prefills draft once, completes signup, and links personId onto live grant with zero reconnect", async () => {
    const submitted: string[] = [];
    const env = setup({
      submitProfile: async (_personId, _app, _e164, text) => { submitted.push(text); return "accepted"; },
    });
    const conn = await connect(env, "friends.help", PHONE_A);
    const token = conn.token.access_token as string;
    const siteCookie = conn.flow.siteCookie!.split(", ").find(h => h.startsWith("sid_friends="))!.split(";")[0]!;

    const st0 = await call(env, `${origin("friends.help")}/mcp`, "check_status", {}, { token });
    expect(st0.body!.result.structuredContent).toMatchObject({
      app: "friends",
      status: "not_joined",
      finish_signup_url: expect.stringMatching(/^https:\/\/friends\.help\/oauth\/finish-signup\?t=[A-Za-z0-9_-]{22}$/),
    });

    const prep = await call(env, `${origin("friends.help")}/mcp`, "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token });
    expect(prep.body!.result.isError).toBe(false);
    const finishUrl = prep.body!.result.structuredContent.finish_signup_url as string;
    expect(finishUrl).toMatch(/^https:\/\/friends\.help\/oauth\/finish-signup\?t=[A-Za-z0-9_-]{22}$/);
    expect(finishUrl).not.toContain(PHONE_A);
    expect(prep.body!.result.structuredContent.signup_url).toBe("https://friends.help/SKILL.md");

    // Opening finish_signup_url with matching browser session jumps directly to AuthSignupView with 1-time draft prefill.
    const open = await env.fetch(new Request(finishUrl, { headers: { cookie: siteCookie } }));
    expect(open.status).toBe(200);
    const html = await open.text();
    expect(html).toContain("Confirm your signup");
    expect(html).toContain('value="Ari"');
    expect(html).toContain('value="sf"');
    const rid = ridOf(html)!;
    const signupView = signupViewOf(html)!;
    const consentVersion = consentVersionOf(html)!;
    expect(rid).toBeTruthy();
    expect(signupView).toBeTruthy();

    // Draft was consumed/deleted on read (single-use prefill).
    const keyA = env.accounts.phoneHash(PHONE_A);
    expect([...(env.store as MemoryOAuthStore).signupDrafts.values()].filter(d => d.phoneKey === keyA)).toEqual([]);

    // Link itself is single-use: opening it a second time fails cleanly.
    const replay = await env.fetch(new Request(finishUrl, { headers: { cookie: siteCookie } }));
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("This page has expired");

    // Submit Finish signup form.
    const cookie = mergeCookies(siteCookie, open);
    const joined = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/signup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({
        rid, decision: "join", signupView, consentVersion,
        firstName: "Ari", birthdate: "1995-05-12", homeCity: "sf", smsConsent: "yes",
      }).toString(),
    }));
    expect(joined.status).toBe(200);
    const doneHtml = await joined.text();
    expect(doneHtml).toContain("You&#x27;re signed up");
    expect(doneHtml).toContain("Go back to your assistant and continue");

    // Zero disconnect/reconnect: the SAME existing access token now sees the newly joined member and can submit_profile!
    const st1 = await call(env, `${origin("friends.help")}/mcp`, "check_status", {}, { token });
    expect(st1.res.status).toBe(200);
    expect(st1.body!.result.structuredContent.status).toMatch(/^(onboarding|active)$/);
    expect(st1.body!.result.structuredContent.finish_signup_url).toBeUndefined();

    const sub = await call(env, `${origin("friends.help")}/mcp`, "submit_profile", { about: "I love climbing, board games, and quiet coffee shops." }, { token });
    expect(sub.res.status).toBe(200);
    expect(sub.body!.result.structuredContent.submitted).toBe(true);
    expect(submitted).toHaveLength(1);
  });

  test("finish_signup_url refuses a browser session belonging to a different phone and never reads or leaks the draft", async () => {
    const env = setup();
    const connA = await connect(env, "friends.help", PHONE_A);
    const connB = await connect(env, "friends.help", PHONE_B);
    const cookieB = connB.flow.siteCookie!.split(", ").find(h => h.startsWith("sid_friends="))!.split(";")[0]!;

    const prep = await call(env, `${origin("friends.help")}/mcp`, "prepare_signup", { firstName: "SecretName", homeCity: "nyc" }, { token: connA.token.access_token });
    const finishUrl = prep.body!.result.structuredContent.finish_signup_url as string;

    const wrong = await env.fetch(new Request(finishUrl, { headers: { cookie: cookieB } }));
    expect(wrong.status).toBe(403);
    const body = await wrong.text();
    expect(body).toContain("different phone number");
    expect(body).not.toContain("SecretName");
    // PHONE_A's draft was NOT consumed or leaked by PHONE_B's failed open.
    expect([...(env.store as MemoryOAuthStore).signupDrafts.values()].some(d => d.fields.firstName === "SecretName")).toBe(true);
  });

  test("finish_signup_url without browser session runs PhoneView -> CodeView OTP, rejects wrong phone, and completes signup for matching phone", async () => {
    const env = setup();
    const conn = await connect(env, "friends.help", PHONE_A);
    const token = conn.token.access_token as string;
    const prep = await call(env, `${origin("friends.help")}/mcp`, "prepare_signup", { firstName: "Nora", homeCity: "la" }, { token });
    const finishUrl = prep.body!.result.structuredContent.finish_signup_url as string;

    // 1. Wrong phone via OTP is refused and never sees draft.
    const stWrong = await call(env, `${origin("friends.help")}/mcp`, "check_status", {}, { token });
    const wrongUrl = stWrong.body!.result.structuredContent.finish_signup_url as string;
    const openWrong = await env.fetch(new Request(wrongUrl));
    expect(openWrong.status).toBe(200);
    const wrongHtml = await openWrong.text();
    expect(wrongHtml).toContain('action="/oauth/authorize/phone"');
    const wrongRid = ridOf(wrongHtml)!;
    const wrongCookie = pendingAuthorizationCookie(openWrong)!;
    env.clock.t += 31_000;
    const pWrong = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/phone`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: wrongCookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid: wrongRid, phone: PHONE_B }).toString(),
    }));
    expect(pWrong.status).toBe(200);
    const cWrong = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/code`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: wrongCookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid: wrongRid, code: env.provider.last(PHONE_B)! }).toString(),
    }));
    expect(cWrong.status).toBe(403);
    const cWrongText = await cWrong.text();
    expect(cWrongText).toContain("does not match this assistant connection");
    expect(cWrongText).not.toContain("Nora");

    // 2. Matching phone via OTP opens prefilled AuthSignupView and links grant without reconnect.
    const open = await env.fetch(new Request(finishUrl));
    expect(open.status).toBe(200);
    const phoneHtml = await open.text();
    const rid = ridOf(phoneHtml)!;
    let cookie = pendingAuthorizationCookie(open)!;
    env.clock.t += 31_000;
    const p = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/phone`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid, phone: PHONE_A }).toString(),
    }));
    expect(p.status).toBe(200);
    const verified = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/code`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid, code: env.provider.last(PHONE_A)! }).toString(),
    }));
    expect(verified.status).toBe(200);
    const signupHtml = await verified.text();
    expect(signupHtml).toContain("Confirm your signup");
    expect(signupHtml).toContain('value="Nora"');
    expect(signupHtml).toContain('value="la"');
    cookie = mergeCookies(cookie, verified);

    const joined = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize/signup`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({
        rid, decision: "join", signupView: signupViewOf(signupHtml)!, consentVersion: consentVersionOf(signupHtml)!,
        firstName: "Nora", birthdate: "1994-03-15", homeCity: "la", smsConsent: "yes",
      }).toString(),
    }));
    expect(joined.status).toBe(200);
    expect(await joined.text()).toContain("You&#x27;re signed up");

    const stAfter = await call(env, `${origin("friends.help")}/mcp`, "check_status", {}, { token });
    expect(stAfter.body!.result.structuredContent.status).toMatch(/^(onboarding|active)$/);
  });
});

describe("Pass 4 [DECIDE-2]: OAuth resend code & change phone backend", () => {
  test("POST /oauth/authorize/resend sends a fresh code (200 CodeResent), handles rate limits (429), and never leaks full phone", async () => {
    const env = setup();
    const reg = await register(env, "friends.help");
    const q = new URLSearchParams({
      response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback",
      code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s-resend",
    });
    const start = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize?${q}`));
    const startHtml = await start.text();
    const rid = ridOf(startHtml)!;
    const cookie = pendingAuthorizationCookie(start)!;
    const post = (path: string, body: Record<string, string>) => env.fetch(new Request(`${origin("friends.help")}${path}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid, ...body }).toString(),
    }));

    // Resend before phone step is refused cleanly.
    const premature = await post("/oauth/authorize/resend", {});
    expect(premature.status).toBe(400);
    expect(await premature.text()).toContain("This page has expired");

    // Submit phone -> CodeView.
    const p1 = await post("/oauth/authorize/phone", { phone: PHONE_A });
    expect(p1.status).toBe(200);
    const firstCode = env.provider.last(PHONE_A)!;

    // Immediate resend triggers OtpService cooldown -> 429 CodeResendRateLimited.
    const rateLimited = await post("/oauth/authorize/resend", {});
    expect(rateLimited.status).toBe(429);
    const rlHtml = await rateLimited.text();
    expect(rlHtml).toContain("Too many codes");
    expect(rlHtml).not.toContain(PHONE_A);

    // Advance past OTP cooldown -> resend succeeds with 200 CodeResent and fresh code works!
    env.clock.t += 31_000;
    const resent = await post("/oauth/authorize/resend", {});
    expect(resent.status).toBe(200);
    const resentHtml = await resent.text();
    expect(resentHtml).toContain("We sent a new code");
    expect(resentHtml).toContain(PHONE_A.slice(-4));
    expect(resentHtml).not.toContain(PHONE_A);
    const secondCode = env.provider.last(PHONE_A)!;
    expect(secondCode).not.toBe(firstCode);

    const verified = await post("/oauth/authorize/code", { code: secondCode });
    expect(verified.status).toBe(200);
    expect(await verified.text()).toContain('action="/oauth/authorize/consent"');
  });

  test("POST /oauth/authorize/change-phone returns to PhoneView with cleared e164, blocks stale code, and completes OTP with new number", async () => {
    const env = setup();
    const reg = await register(env, "friends.help");
    const q = new URLSearchParams({
      response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback",
      code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s-change",
    });
    const start = await env.fetch(new Request(`${origin("friends.help")}/oauth/authorize?${q}`));
    const rid = ridOf(await start.text())!;
    const cookie = pendingAuthorizationCookie(start)!;
    const post = (path: string, body: Record<string, string>) => env.fetch(new Request(`${origin("friends.help")}${path}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin("friends.help") },
      body: new URLSearchParams({ rid, ...body }).toString(),
    }));

    expect((await post("/oauth/authorize/phone", { phone: PHONE_A })).status).toBe(200);
    const oldCode = env.provider.last(PHONE_A)!;

    // Click "Use a different number" -> returns to PhoneView and clears stored e164.
    const changed = await post("/oauth/authorize/change-phone", {});
    expect(changed.status).toBe(200);
    expect(await changed.text()).toContain('action="/oauth/authorize/phone"');
    const reqAfter = await env.store.getAuthRequest(rid);
    expect(reqAfter?.step).toBe("phone");
    expect(reqAfter?.e164).toBeNull();

    // Submitting the old code now is refused (step is "phone", not "code").
    const staleCode = await post("/oauth/authorize/code", { code: oldCode });
    expect(staleCode.status).toBe(400);
    expect(await staleCode.text()).toContain("This page has expired");

    // Enter new phone PHONE_B -> verify OTP -> reaches consent cleanly.
    const p2 = await post("/oauth/authorize/phone", { phone: PHONE_B });
    expect(p2.status).toBe(200);
    const v2 = await post("/oauth/authorize/code", { code: env.provider.last(PHONE_B)! });
    expect(v2.status).toBe(200);
    expect(await v2.text()).toContain('action="/oauth/authorize/consent"');
  });
});

describe("Pass 4 [DECIDE-3]: get_context, set_availability, and set_red_lines MCP tools", () => {
  test("get_context obeys lawContextProfileNeedsProfileRead: omits profile/looking_for without profile:read and includes both with profile:read", async () => {
    let lookingForCalls = 0;
    const env = setup({
      lookingFor: async () => {
        lookingForCalls++;
        return {
          entries: [{ ref: "INT-AAAAAAAAAAAA", number: 1, kind: "request", summary: "A climbing partner", status: "active", inProgress: false, endsAt: Date.UTC(2026, 10, 8) }],
          closedRecently: [],
          checkWithPerson: [],
        };
      },
      updates: async (): Promise<PublicUpdate[]> => [
        { summary: `Call ${PHONE_A} right now.`, at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" },
        { summary: "Coffee on Saturday at 11 AM in Mission.", at: "2026-10-08T12:05:00.000Z", kind: "plan_confirmed" },
      ],
    });
    const person = await addMember(env, PHONE_A, [{ app: "friends", state: "active" }]);
    const saved = (await env.people.getMembership(person, "friends"))!;
    await env.people.putMembership({
      ...saved,
      profile: { about: "Board games and hiking.", interests: ["hiking"], neighborhood: "Mission", homeCity: "sf", redLines: ["halal"] },
    });
    await env.accounts.recordConsent({ e164: PHONE_A, app: "friends", state: "opted_in", source: "keyword:start", at: env.clock.t });

    // Without profile:read scope: profile & looking_for MUST be null and profile_read_granted false.
    const basic = await connect(env, "friends.help", PHONE_A, { scope: "membership:read" });
    const ctxNoRead = await call(env, `${origin("friends.help")}/mcp`, "get_context", {}, { token: basic.token.access_token });
    expect(ctxNoRead.res.status).toBe(200);
    expect(ctxNoRead.body!.result.isError).toBe(false);
    expect(ctxNoRead.body!.result.structuredContent).toEqual({
      app: "friends",
      status: "active",
      next_step: "You are signed up.",
      profile_read_granted: false,
      profile: null,
      looking_for: null,
      updates: [{ summary: "Coffee on Saturday at 11 AM in Mission.", at: "2026-10-08T12:05:00.000Z", kind: "plan_confirmed" }],
      enabled_domains: ["friendship"],
      available_domains: ["dating", "friendship", "business"],
    });
    expect(lookingForCalls).toBe(0);

    // With profile:read scope: returns profile (incl. red_lines), looking_for, and leak-gated updates.
    const full = await connect(env, "friends.help", PHONE_A, { scope: "membership:read profile:read" });
    const ctxWithRead = await call(env, `${origin("friends.help")}/mcp`, "get_context", {}, { token: full.token.access_token });
    expect(ctxWithRead.res.status).toBe(200);
    expect(ctxWithRead.body!.result.structuredContent).toMatchObject({
      app: "friends",
      status: "active",
      profile_read_granted: true,
      profile: { first_name: "Rae", about: "Board games and hiking.", red_lines: ["halal"] },
      looking_for: [{ ref: "INT-AAAAAAAAAAAA", summary: "A climbing partner", status: "active" }],
      updates: [{ summary: "Coffee on Saturday at 11 AM in Mission.", at: "2026-10-08T12:05:00.000Z", kind: "plan_confirmed" }],
    });
    expect(lookingForCalls).toBe(1);
  });

  test("set_availability and set_red_lines validate inputs, refuse non-live members, delegate to hooks, and enforce daily profileDailyCap (5/day)", async () => {
    const availCalls: SetAvailabilityInput[] = [];
    const redLineCalls: SetRedLinesInput[] = [];
    const env = setup({
      setAvailability: async (_personId, _app, _phoneKey, input) => {
        availCalls.push(input);
        return { ok: true, summary: "Tue/Thu after 6pm, quiet 22:00-08:00" };
      },
      setRedLines: async (_personId, _app, _phoneKey, input) => {
        redLineCalls.push(input);
        return { ok: true, redLines: input.redLines };
      },
    });

    // Not-joined member is refused (saved: false, hooks never called).
    const unjoined = await connect(env, "friends.help", PHONE_B);
    const avUnjoined = await call(env, `${origin("friends.help")}/mcp`, "set_availability", { days: ["tue"] }, { token: unjoined.token.access_token });
    expect(avUnjoined.body!.result.structuredContent).toMatchObject({ saved: false, app: "friends" });
    const rlUnjoined = await call(env, `${origin("friends.help")}/mcp`, "set_red_lines", { redLines: ["halal"] }, { token: unjoined.token.access_token });
    expect(rlUnjoined.body!.result.structuredContent).toMatchObject({ saved: false, app: "friends", red_lines: [] });
    expect(availCalls).toHaveLength(0);
    expect(redLineCalls).toHaveLength(0);

    // Active member with profile:write.
    await addMember(env, PHONE_A, [{ app: "friends", state: "active" }]);
    const readOnly = await connect(env, "friends.help", PHONE_A, { scope: "membership:read" });
    expect((await call(env, `${origin("friends.help")}/mcp`, "set_availability", { days: ["tue"] }, { token: readOnly.token.access_token })).res.status).toBe(403);
    expect((await call(env, `${origin("friends.help")}/mcp`, "set_red_lines", { redLines: ["halal"] }, { token: readOnly.token.access_token })).res.status).toBe(403);

    const conn = await connect(env, "friends.help", PHONE_A);
    const token = conn.token.access_token as string;

    // Invalid inputs refused without consuming daily cap.
    expect((await call(env, `${origin("friends.help")}/mcp`, "set_red_lines", { redLines: ["not_a_real_tag"] }, { token })).body!.result.isError).toBe(true);
    expect((await call(env, `${origin("friends.help")}/mcp`, "set_availability", { notes: `Call ${PHONE_A}` }, { token })).body!.result.isError).toBe(true);
    expect((await call(env, `${origin("friends.help")}/mcp`, "set_availability", { quietHours: { start: "25:00", end: "08:00" } }, { token })).body!.result.isError).toBe(true);

    // 5 valid calls succeed; 6th hits 429 daily cap.
    const r1 = await call(env, `${origin("friends.help")}/mcp`, "set_availability", {
      days: ["tue", "thu"], windows: ["after 6pm"], quietHours: { start: "22:00", end: "08:00" }, timezone: "America/Los_Angeles",
    }, { token });
    expect(r1.body!.result.structuredContent).toEqual({
      saved: true, app: "friends", summary: "Tue/Thu after 6pm, quiet 22:00-08:00", next_step: "Saved availability for friends.help.",
    });
    const r2 = await call(env, `${origin("friends.help")}/mcp`, "set_red_lines", {
      redLines: ["halal", "strict_sober", "low_noise"], mode: "replace",
    }, { token });
    expect(r2.body!.result.structuredContent).toEqual({
      saved: true, app: "friends", red_lines: ["halal", "strict_sober", "low_noise"], next_step: "Saved private venue red lines for friends.help.",
    });
    expect(availCalls).toHaveLength(1);
    expect(redLineCalls).toEqual([{ redLines: ["halal", "strict_sober", "low_noise"], mode: "replace" }]);

    for (let i = 0; i < 3; i++) {
      const ok = await call(env, `${origin("friends.help")}/mcp`, "set_red_lines", { redLines: ["wheelchair"] }, { token });
      expect(ok.res.status).toBe(200);
      expect(ok.body!.result.structuredContent.saved).toBe(true);
    }
    const capped = await call(env, `${origin("friends.help")}/mcp`, "set_availability", { days: ["fri"] }, { token });
    expect(capped.res.status).toBe(429);
  });
});

const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const DB = `mcp_p4_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${DB}`;
const admin = async (q: string) => {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe(q); } finally { await sql.close(); }
};

describe.skipIf(!pgAvailable)("Pass 4 PgOAuthStore: zero-migration step-up claimAuthRequestBrowser & attachGrantPerson", () => {
  let store: PgOAuthStore;
  beforeAll(async () => {
    await devPgUp();
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(testUrl.toString());
    await store.migrate();
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`);
  });

  test("single-use step-up claim and attachGrantPerson work on real Postgres auth_requests + grants with zero new migrations", async () => {
    const env = setup({ store });
    const conn = await connect(env, "friends.help", PHONE_A);
    const token = conn.token.access_token as string;
    const prep = await call(env, `${origin("friends.help")}/mcp`, "prepare_signup", { firstName: "Mina", homeCity: "sf" }, { token });
    const finishUrl = new URL(prep.body!.result.structuredContent.finish_signup_url as string);
    const reqId = finishUrl.searchParams.get("t")!;

    const stored = await store.getAuthRequest(reqId);
    expect(stored?.redirectUri).toBe(FINISH_SIGNUP_REDIRECT_URI);
    expect(stored?.browserHash).toBe("");

    // First claim succeeds, second claim returns undefined (strictly single-use).
    const claimed = await store.claimAuthRequestBrowser(reqId, "a".repeat(64), env.clock.t);
    expect(claimed?.browserHash).toBe("a".repeat(64));
    expect(await store.claimAuthRequestBrowser(reqId, "b".repeat(64), env.clock.t)).toBeUndefined();

    // attachGrantPerson binds personId only for matching phoneKey when personId was null.
    const grantId = stored!.codeChallenge;
    const keyA = env.accounts.phoneHash(PHONE_A);
    const keyB = env.accounts.phoneHash(PHONE_B);
    expect(await store.attachGrantPerson(grantId, "person_new_1", keyB, env.clock.t)).toBe(false);
    expect(await store.attachGrantPerson(grantId, "person_new_1", keyA, env.clock.t)).toBe(true);
    expect((await store.getGrant(grantId))?.personId).toBe("person_new_1");
    expect(await store.attachGrantPerson(grantId, "person_other_2", keyA, env.clock.t)).toBe(false);
  });
});
