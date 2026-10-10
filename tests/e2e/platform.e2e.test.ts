// End to end: the four sites through the production router code, the shared backend, the platform
// API, the MCP server and Postgres, in one process (harness.ts). Needs the dev Postgres (:54339); it
// skips with a message without one, and CI (REQUIRE_PG=1) fails instead of skipping.
//   bun test tests/e2e            (bun run test:e2e)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "../../packages/core/src/clock.ts";
import { lastEvents, resolveConsent } from "../../packages/platform/src/consent.ts";
import { APP_IDS, type AppId } from "../../packages/platform/src/apps.ts";
import { proxySignature } from "../../packages/platform/src/proxy.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import { createServiceMcp } from "../../packages/network/service/serve.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { SET_STATE_PATH, TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { Browser, connectMcp, VERIFIER, newPhone, pgAvailable, rpc, signIn, startStack, toolData, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable) {
  if (process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");
  console.warn("tests/e2e skipped: no Postgres. Install postgresql@16 (the dev cluster runs on :54339) or run in CI.");
}

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("the platform end to end (sites -> router -> backend -> Postgres)", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const memberRow = async (app: AppId, e164: string) =>
    (await sql`select m.id, m.age, m.account_status, m.opted_out from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as
      { id: string; age: number | null; account_status: string; opted_out: boolean } | undefined;
  const me = async (app: AppId, b: Browser) => {
    const res = await st.site(app, "/api/me", { browser: b });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  describe.each(APP_IDS.map(a => [a]))("%s site", (app: AppId) => {
    test("landing page, /SKILL.md and the agent-skills index are served by the site", async () => {
      const s = st.sites[app].site;
      const home = await st.site(app, "/");
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toContain("text/html");
      expect(await home.text()).toContain("<html");
      const md = await st.site(app, "/SKILL.md");
      expect(md.status).toBe(200);
      expect(md.headers.get("content-type")).toContain("text/markdown");
      const text = await md.text();
      expect(text).toContain(`name: ${s.skill}`);
      // The skill names this site's own MCP endpoint (the router forwards it with the site's signed host).
      expect(text).toContain(`https://${s.domain}/mcp`);
      expect(text).not.toContain("https://api.ntwrk.love/mcp");
      const idx = await st.site(app, "/.well-known/agent-skills/index.json");
      expect(idx.status).toBe(200);
      const names = ((await idx.json()) as { skills: { name: string }[] }).skills.map(x => x.name);
      expect(names).toEqual(app === "ntwrk" ? ["ntwrk-love", "slop-date", "peon-biz", "friends-help"] : [s.skill]);
    });

    test("/api/app through the router names this site's app (the signed host picks it)", async () => {
      const res = await st.site(app, "/api/app");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: string }).id).toBe(app);
    });

    test("join with a texted code; /api/me shows this app only", async () => {
      const phone = newPhone();
      const j = await webJoin(st, app, phone, { age: 29 });
      if (app === "ntwrk") {
        // The Network's web join is invite-only (platform.apps join_mode).
        expect(j.res.status).toBe(400);
        expect(j.body.error).toBe("invite_only");
        return;
      }
      expect(j.res.status, JSON.stringify(j.body)).toBe(200);
      expect(j.body.membership.state).toBe("active");
      const m = await me(app, j.b);
      expect(m.status).toBe(200);
      expect(m.body.app).toBe(app);
      expect(m.body.membership.state).toBe("active");
      expect(JSON.stringify(m.body)).not.toContain(phone.slice(2));
      expect((await memberRow(app, phone))?.account_status).toBe("active");
    }, T);
  });

  test("a session is per app: /api/me on another site never shows this app, and the cookie does not cross", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 31, browser: b })).res.status).toBe(200);
    // The same browser, not signed in on peon: 401, and slop's cookie sent as peon's is refused.
    expect((await me("peon", b)).status).toBe(401);
    const forged = new Browser();
    forged.jar.set("sid_peon", b.jar.get("sid_slop")!);
    expect((await me("peon", forged)).status).toBe(401);
    // Signed in on peon (not a member there): peon's /api/me knows nothing about slop.
    await signIn(st, "peon", phone, b);
    const m = await me("peon", b);
    expect(m.status).toBe(200);
    expect(m.body.app).toBe("peon");
    expect(m.body.membership).toBeNull();
    expect(JSON.stringify(m.body)).not.toMatch(/slop/);
  }, T);

  test("leave one app keeps the other", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "slop", phone, { age: 33, browser: b })).res.status).toBe(200);
    expect((await webJoin(st, "peon", phone, { age: 33, browser: b })).res.status).toBe(200);
    const leave = await st.site("slop", "/api/me/delete", { browser: b, json: { scope: "app" } });
    expect(leave.status).toBe(200);
    expect(await memberRow("slop", phone)).toBeUndefined();
    expect((await memberRow("peon", phone))?.account_status).toBe("active");
    expect((await me("peon", b)).body.membership.state).toBe("active");
    const slop = await me("slop", b);
    expect(slop.body.membership === null || slop.body.membership.state === "removed").toBe(true);
  }, T);

  test("STOP on the shared line stops every app", async () => {
    const phone = newPhone();
    const b = new Browser();
    expect((await webJoin(st, "peon", phone, { age: 35, browser: b })).res.status).toBe(200);
    expect((await webJoin(st, "friends", phone, { age: 35, browser: b })).res.status).toBe(200);
    await st.text(phone, "STOP");
    const events = (await sql`select e164, app_id as app, state, source, extract(epoch from at) * 1000 as at from platform.consent_events where e164 = ${phone} order by id`).map((r: any) => ({ ...r, at: Number(r.at) }));
    for (const app of ["peon", "friends"] as const) {
      expect(resolveConsent(lastEvents(events, phone, app))).toBe("opted_out");
      expect((await me(app, b)).body.membership.state).toBe("paused");
      expect((await memberRow(app, phone))?.opted_out).toBe(true);
    }
  }, T);

  test("a pause set by text shows on Settings with its end date; resume ends it and keeps messages on (#11)", async () => {
    // As the Eliza gateway does: a signed /internal/turn for each text, then the agent's signed
    // /internal/set-state on the member's open turn ("pause me until next Friday").
    const phone = newPhone();
    const signed = async (path: string, body: object, id: string) => {
      const raw = JSON.stringify(body);
      return st.svc.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path, id, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    };
    const turn = async (messageId: string, text: string) => {
      const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "friends" };
      const res = await signed(TURN_PATH, body, messageId);
      expect(res.status).toBe(200);
      st.clock.advance(60_000);
      return (await res.json()) as Record<string, any>;
    };
    for (const [i, text] of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) await turn(`pause-${phone}-${i}`, text);
    const open = await turn(`pause-${phone}-open`, "Pause me until next Friday, I'm slammed at work");
    expect(open.outcome).toBe("open");
    const until = new Date(st.clock.now() + 7 * DAY).toISOString();
    const key = `pause-${phone}-state`;
    const set = await signed(SET_STATE_PATH, { channel: "blooio", messageId: `pause-${phone}-open`, app: "friends", memberId: open.memberId, idempotencyKey: key, state: "paused", from: null, until, note: null }, key);
    expect(set.status, await set.clone().text()).toBe(200);

    const b = new Browser();
    await signIn(st, "friends", phone, b);
    const m = await me("friends", b);
    expect(m.status).toBe(200);
    expect(m.body.membership.state).toBe("active");
    expect(m.body.participation).toMatchObject({ state: "paused", until });
    // A pause is not a stop: messaging consent is unchanged.
    expect(m.body.smsOptedIn).toBe(true);
    // The value is read from the member record the Network uses, not a copy.
    const [row] = await sql`select participation_window from network.members where app_id = 'friends' and id = ${open.memberId}`;
    expect(row.participation_window.until).toBe(until);
    // Every site's Settings page has the slot that shows "Paused until <date>" and the resume button.
    for (const app of APP_IDS) {
      const html = await (await st.site(app, "/settings")).text();
      expect(html).toContain('data-slot="pauseText"');
      expect(html).toContain('data-action="resume"');
    }

    const resume = await st.site("friends", "/api/me/resume", { browser: b, json: {} });
    expect(resume.status).toBe(200);
    const after = await me("friends", b);
    expect(after.body.participation).toMatchObject({ state: "open", until: null });
    expect(after.body.smsOptedIn).toBe(true);
    // Not a member: nothing to resume.
    const stranger = new Browser();
    await signIn(st, "peon", newPhone(), stranger);
    expect((await st.site("peon", "/api/me/resume", { browser: stranger, json: {} })).status).toBe(400);
  }, T);

  describe("MCP through the site router", () => {
    test("private ChatGPT Slop is dev-only and keeps the public plugin closed", async () => {
      const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
      const denied = await st.site("slop", "/oauth/register", { json: { redirect_uris: [redirect], token_endpoint_auth_method: "none" } });
      expect(denied.status).toBe(400);
      for (const env of [
        { PLATFORM_ENV: "production" }, { PLATFORM_ENV: "staging" }, { PLATFORM_ENV: "unknown" },
        { PLATFORM_ENV: "dev", NODE_ENV: "production" },
      ]) {
        await expect(createServiceMcp(st.svc, { env: { ...env, MCP_PRIVATE_OPENAI_APPS: "slop" } })).rejects.toThrow("owned dev runtime only");
      }
      const beforeOuter = Number((await sql`select count(*) as n from network.members`)[0]!.n);
      const pilot = await startStack({ privateOpenAiApps: ["slop"] });
      const db = new SQL({ url: pilot.url, max: 2 });
      try {
        expect(pilot.url).not.toBe(st.url);
        expect((await rpc(pilot, "slop", "/mcp/openai", "tools/list")).res.status).toBe(404);
        expect((await pilot.site("slop", "/.well-known/oauth-protected-resource/mcp/openai")).status).toBe(404);
        const publicApps = toolData(await rpc(pilot, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: {} }));
        expect(JSON.stringify(publicApps)).not.toMatch(/slop|dating/i);
        const phone = newPhone();
        const browser = new Browser();
        expect((await webJoin(pilot, "slop", phone, { age: 30, browser })).res.status).toBe(200);
        const connection = await connectMcp(pilot, "slop", phone, { browser, redirect });
        expect(connection.token?.access_token, connection.html).toBeString();
        expect(new URL(connection.location!).searchParams.get("iss")).toBe(pilot.sites.slop.origin);
        const member = (await db`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${phone}`)[0]!;
        const about = "I'm Rae, 30, in Williamsburg, looking for a long-term relationship. I like climbing and live music. Free weekend afternoons.";
        expect(toolData(await rpc(pilot, "slop", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, connection.token!.access_token)).submitted).toBe(true);
        expect((await db`select member_id from network.messages where member_id = ${member.id} and body = ${about}`).length).toBe(1);
        expect(toolData(await rpc(pilot, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token))).toMatchObject({ app: "slop", status: "active" });
        // A handler restart uses the SAME Postgres clients, grants and tokens; off suspends, not revokes.
        const authorizeQuery = new URLSearchParams({ response_type: "code", client_id: connection.client.client_id, redirect_uri: redirect, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", resource: `${pilot.sites.slop.origin}/mcp` });
        // A pre-existing CIMD client cannot inherit the DCR pilot, even with a non-OpenAI redirect.
        const dcrClient = (await pilot.mcp.store.getClient(connection.client.client_id))!;
        const cimdId = "https://chatgpt.com/oauth/client.json";
        await pilot.mcp.store.putClient({ ...dcrClient, id: cimdId, kind: "cimd", surface: "full", redirectUris: ["https://client.example/callback"] });
        const cimdQuery = new URLSearchParams(authorizeQuery);
        cimdQuery.set("client_id", cimdId);
        cimdQuery.set("redirect_uri", "https://client.example/callback");
        expect((await pilot.site("slop", `/oauth/authorize?${cimdQuery}`, { browser })).status).toBe(403);
        expect((await pilot.site("slop", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: connection.token!.refresh_token, client_id: cimdId } })).status).toBe(401);
        const pending = await pilot.site("slop", `/oauth/authorize?${authorizeQuery}`, { browser });
        const rid = /name="rid" value="([^"]+)"/.exec(await pending.text())?.[1];
        expect(rid).toBeString();
        const refresh = () => pilot.site("slop", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: connection.token!.refresh_token, client_id: connection.client.client_id } });
        await pilot.setPrivateOpenAiApps([]);
        expect((await rpc(pilot, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token)).res.status).toBe(404);
        expect((await pilot.site("slop", `/oauth/authorize?${authorizeQuery}`, { browser })).status).toBe(403);
        expect((await pilot.site("slop", "/oauth/authorize/consent", { browser, form: { rid: rid!, decision: "approve" } })).status).toBe(403);
        expect((await refresh()).status).toBe(401);
        const codeExchange = await pilot.site("slop", "/oauth/token", { form: { grant_type: "authorization_code", code: new URL(connection.location!).searchParams.get("code")!, redirect_uri: redirect, client_id: connection.client.client_id, code_verifier: VERIFIER } });
        expect(codeExchange.status).toBe(401);
        await pilot.setPrivateOpenAiApps(["slop"]);
        expect((await rpc(pilot, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token)).res.status).toBe(200);
        await pilot.setPrivateOpenAiApps([]);
        expect((await pilot.site("slop", "/oauth/revoke", { form: { token: connection.token!.refresh_token, client_id: connection.client.client_id } })).status).toBe(200);
        await pilot.setPrivateOpenAiApps(["slop"]);
        expect((await rpc(pilot, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, connection.token!.access_token)).res.status).toBe(401);
        expect((await refresh()).status).toBe(400);
        expect(Number((await sql`select count(*) as n from network.members`)[0]!.n)).toBe(beforeOuter);
      } finally {
        await db.close();
        await pilot.close();
      }
      expect(Number((await sql`select count(*) as n from network.members`)[0]!.n)).toBe(beforeOuter);
    }, T);

    test("Slop: two assistants share one phone owner, a different account stays isolated, and one disconnect preserves the other", async () => {
      const phone = newPhone();
      const browser = new Browser();
      expect((await webJoin(st, "slop", phone, { age: 30, firstName: "Rae", browser })).res.status).toBe(200);
      const before = await memberRow("slop", phone);
      const sent = st.otp.sent.length;
      const a = await connectMcp(st, "slop", phone, { browser, redirect: "https://assistant-a.example/callback" });
      const b = await connectMcp(st, "slop", phone, { browser, redirect: "http://127.0.0.1:55103/callback" });
      expect(a.token?.access_token, a.html).toBeString();
      expect(b.token?.access_token, b.html).toBeString();
      expect(st.otp.sent.length).toBe(sent);
      expect(new URL(b.location!).origin).toBe("http://127.0.0.1:55103");
      expect(new URL(b.location!).searchParams.get("iss")).toBe(st.sites.slop.origin);
      const about = "I'm Rae, a woman, 30, in Williamsburg, seeking men 28-38 within 5 miles for a long-term relationship. I like climbing and live music. Free weekend afternoons.";
      expect(toolData(await rpc(st, "slop", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, a.token!.access_token))).toMatchObject({ app: "slop", submitted: true });
      expect((await memberRow("slop", phone))?.id).toBe(before?.id);
      expect((await sql`select body from network.messages where member_id = ${before!.id} and direction = 'inbound'`).some((r: any) => r.body === about)).toBe(true);
      expect(toolData(await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, b.token!.access_token))).toMatchObject({ app: "slop", status: "active" });
      const otherPhone = newPhone();
      const otherBrowser = new Browser();
      expect((await webJoin(st, "slop", otherPhone, { age: 31, firstName: "Kai", browser: otherBrowser })).res.status).toBe(200);
      const other = await connectMcp(st, "slop", otherPhone, { browser: otherBrowser });
      const otherMember = (await memberRow("slop", otherPhone))!;
      expect(otherMember.id).not.toBe(before!.id);
      expect((await sql`select body from network.messages where member_id = ${otherMember.id} and body = ${about}`).length).toBe(0);
      expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, a.token!.access_token)).res.status).toBe(401);
      expect((await st.site("slop", "/oauth/revoke", { form: { token: a.token!.access_token, client_id: a.client.client_id } })).status).toBe(200);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, a.token!.access_token)).res.status).toBe(401);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, b.token!.access_token)).res.status).toBe(200);
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, other.token!.access_token)).res.status).toBe(200);
      expect((await me("slop", browser)).status).toBe(200);
    }, T);

    test("OAuth with PKCE on peon.biz; check_status shows only peon; the token is refused on another site and on /mcp/openai", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "peon", phone, { age: 40, browser: b })).res.status).toBe(200);
      expect((await webJoin(st, "slop", phone, { age: 40, browser: b })).res.status).toBe(200);
      // A fresh browser: the authorize page on peon's own domain asks for the number and the code.
      const c = await connectMcp(st, "peon", phone);
      expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
      expect(new URL(c.location!).searchParams.get("iss")).toBe(st.sites.peon.origin);
      const token = c.token!.access_token as string;
      const status = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token));
      expect(status.app).toBe("peon");
      expect(status.status).toBe("active");
      expect(JSON.stringify(status)).not.toMatch(/slop|\+1212|"age"/);
      // Another app named in the call: refused, never answered with slop's state.
      const other = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "check_status", arguments: { app: "slop" } }, token));
      expect(other.error ?? other.app).not.toBe("slop");
      if (!other.error) expect(other.status).toBeUndefined();
      // The same token on slop.date's /mcp and on peon's /mcp/openai: 401 (a token is bound to one resource).
      expect((await rpc(st, "slop", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token)).res.status).toBe(401);
      expect((await rpc(st, "peon", "/mcp/openai", "tools/call", { name: "check_status", arguments: {} }, token)).body?.result?.isError ?? true).toBe(true);
    }, T);

    test("signed in on the site already: the authorize page skips the code; leaving the app revokes the grant", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "friends", phone, { age: 27, browser: b })).res.status).toBe(200);
      const sent = st.otp.sent.length;
      const c = await connectMcp(st, "friends", phone, { browser: b });
      expect(c.token?.access_token, c.html.slice(0, 300)).toBeString();
      expect(st.otp.sent.length).toBe(sent);
      const token = c.token!.access_token as string;
      expect(toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token)).status).toBe("active");
      expect((await st.site("friends", "/api/me/delete", { browser: b, json: { scope: "app" } })).status).toBe(200);
      const after = await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, token);
      expect(after.res.status).toBe(401);
    }, T);

    test("agent-first sign-up: join on the site, connect, submit_profile reaches the member's own Network; an age in it counts (decision 10)", async () => {
      const phone = newPhone();
      const b = new Browser();
      expect((await webJoin(st, "friends", phone, { age: 27, firstName: "Ola", browser: b })).res.status).toBe(200);
      const c = await connectMcp(st, "friends", phone, { browser: b });
      const token = c.token!.access_token as string;
      expect(c.token!.scope).toContain("profile:write");
      const about = "Ola, around Fort Greene. I want people to play pickup basketball and board games with, weekday evenings. Small groups are best.";
      const r = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, token));
      expect(r).toMatchObject({ app: "friends", submitted: true });
      const m = (await memberRow("friends", phone))!;
      // Stored as the member's own inbound message, and the Network answered it like a text.
      const msgs = await sql`select direction, body from network.messages where member_id = ${m.id} order by ts`;
      expect(msgs.some((x: any) => x.direction === "inbound" && x.body === about)).toBe(true);
      // A phone number or a code in the profile is refused and stored nowhere.
      const bad = toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "text me at 212 555 0199 about games" } }, token));
      expect(bad.error).toMatch(/phone numbers, codes and email/);
      expect((await sql`select 1 from network.messages where body like ${"%555 0199%"}`).length).toBe(0);
      // A minor's age stated in the profile makes the member a minor (single-player) on every app.
      const teen = newPhone();
      const tb = new Browser();
      expect((await webJoin(st, "friends", teen, { age: 19, firstName: "Kit", browser: tb })).res.status).toBe(200);
      const tc = await connectMcp(st, "friends", teen, { browser: tb });
      expect(toolData(await rpc(st, "friends", "/mcp", "tools/call", { name: "submit_profile", arguments: { about: "Kit here, I'm 15 actually, I like drawing and chess." } }, tc.token!.access_token)).submitted).toBe(true);
      const tm = (await memberRow("friends", teen))!;
      const rt = [...st.svc.runtimes.values()].find(x => x.app.id === "friends")!;
      expect(rt.net.member(tm.id as never).minor).toBe(true);
      expect(tm.age).toBe(15);
    }, T);

    test("the OpenAI surface hides slop: app_info lists no slop, and slop.date answers 404 at /mcp/openai", async () => {
      const list = toolData(await rpc(st, "ntwrk", "/mcp/openai", "tools/call", { name: "app_info", arguments: {} }));
      expect(list.apps.map((a: { id: string }) => a.id)).toEqual(["ntwrk", "peon", "friends"]);
      expect(JSON.stringify(list)).not.toMatch(/slop|dating/i);
      const full = toolData(await rpc(st, "ntwrk", "/mcp", "tools/call", { name: "app_info", arguments: {} }));
      expect(full.apps.map((a: { id: string }) => a.id)).toContain("slop");
      expect((await rpc(st, "slop", "/mcp/openai", "tools/list")).res.status).toBe(404);
      const meta = await st.site("peon", "/.well-known/oauth-protected-resource/mcp");
      expect(meta.status).toBe(200);
      expect(((await meta.json()) as { resource: string }).resource).toBe(`${st.sites.peon.origin}/mcp`);
    }, T);

    test("an authorize form from another site is refused, and Origin: null without Sec-Fetch-Site same-origin too", async () => {
      const reg = (await (await st.site("peon", "/oauth/register", { json: { client_name: "X", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none" } })).json()) as { client_id: string };
      const b = new Browser();
      const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://client.example/callback", code_challenge: "x".repeat(43), code_challenge_method: "S256", state: "s" });
      const html = await (await st.site("peon", `/oauth/authorize?${q}`, { browser: b })).text();
      const rid = /name="rid" value="([^"]+)"/.exec(html)![1]!;
      for (const headers of [{ origin: "https://evil.example" }, { origin: "null", "sec-fetch-site": "cross-site" }, { origin: "null" }] as Record<string, string>[]) {
        const res = await st.site("peon", "/oauth/authorize/phone", { browser: b, headers, form: { rid, phone: "+12125550190" } });
        expect(res.status, JSON.stringify(headers)).toBe(403);
      }
    });

    test("tools take no phone number and no code", async () => {
      const r = toolData(await rpc(st, "peon", "/mcp", "tools/call", { name: "start_signup", arguments: { app: "peon", phone: "+12125550188" } }));
      expect(r.error).toBeString();
      const tools = (await rpc(st, "peon", "/mcp", "tools/list")).body!.result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
      // submit_profile also takes the person's own approved text ("about"), which refuses phone numbers and codes;
      // get_updates takes an update reference (T-XXXXXX), never a verification code.
      for (const t of tools) expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(t.name === "submit_profile" ? ["app", "about"] : t.name === "get_updates" ? ["app", "update_token"] : ["app"]);
      expect(tools.map(t => t.name).sort()).toEqual(["app_info", "check_status", "get_updates", "start_signup", "submit_profile"]);
    });
  });

  describe("spoofed proxy headers", () => {
    test("straight to the backend: forged or stale x-network-proxy-* and retired x-ntwrk-proxy-* headers name no app", async () => {
      const ts = Math.floor(st.clock.now() / 1000);
      const forged: Record<string, string>[] = [
        { "x-ntwrk-proxy-ip": "203.0.113.9", "x-ntwrk-proxy-app": "slop", "x-ntwrk-proxy-ts": String(ts), "x-ntwrk-proxy-sig": "00".repeat(32), "x-forwarded-host": "slop.date" },
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": "forged" },
        // A right signature with the wrong secret, and a right one that is 2 minutes old.
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": await proxySignature("w".repeat(48), { method: "GET", path: "/api/app", host: "slop.date", ip: "203.0.113.9", ts }) },
        { "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-host": "slop.date", "x-network-proxy-ts": String(ts - 120), "x-network-proxy-sig": await proxySignature("e2e-proxy-secret-0123456789abcdef0123456789abcdef", { method: "GET", path: "/api/app", host: "slop.date", ip: "203.0.113.9", ts: ts - 120 }) },
      ];
      for (const h of forged) {
        const res = await fetch(`${st.backendOrigin}/api/app`, { headers: h });
        expect(res.status, JSON.stringify(h)).toBe(404);
        expect(((await res.json()) as { error: string }).error).toBe("unknown_app");
        const mcp = await fetch(`${st.backendOrigin}/.well-known/oauth-authorization-server`, { headers: h });
        expect(mcp.status).toBe(404);
      }
    });

    test("through a site: a client's own proxy headers are replaced, so peon.biz stays peon", async () => {
      const ts = Math.floor(st.clock.now() / 1000);
      const res = await st.site("peon", "/api/app", { headers: { "x-network-proxy-host": "slop.date", "x-network-proxy-ip": "203.0.113.9", "x-network-proxy-ts": String(ts), "x-network-proxy-sig": "forged", "x-ntwrk-proxy-app": "slop", "x-forwarded-host": "slop.date" } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: string }).id).toBe("peon");
    });
  });

  describe("minors (13-17)", () => {
    test("a 13-year-old joins friends.help and slop.date, and is never matched", async () => {
      const teen = newPhone();
      const tb = new Browser();
      const fj = await webJoin(st, "friends", teen, { age: 13, firstName: "Kai", interests: ["climbing", "board games"], browser: tb });
      expect(fj.res.status, JSON.stringify(fj.body)).toBe(200);
      expect(fj.body.membership.state).toBe("active");
      expect((await webJoin(st, "slop", teen, { age: 13, firstName: "Kai", browser: tb })).res.status).toBe(200);
      const fm = (await memberRow("friends", teen))!;
      expect(fm.age).toBe(13);
      // Adults with the same interests, so the engine has someone to propose.
      const adults: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = newPhone();
        adults.push(p);
        expect((await webJoin(st, "friends", p, { age: 25 + i, firstName: ["Ana", "Ben", "Cy", "Di"][i], interests: ["climbing", "board games"] })).res.status).toBe(200);
      }
      // Everyone says what they want on the shared line (the offline reader; no LLM key in tests).
      // Onboarding answers first (want, when and where, format), then a request of their own.
      for (const p of [...adults, teen]) {
        await st.text(p, "I want to find people to go climbing with this weekend, and to play board games.");
        await st.text(p, "Weekends mostly, I'm around Williamsburg.");
        await st.text(p, "Small groups are great.");
      }
      for (const p of [...adults, teen]) await st.text(p, "Find me someone to go bouldering with in Brooklyn this Saturday afternoon");
      const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends")!;
      expect(rt.net.member(fm.id as never).minor).toBe(true);
      // friendsPack matches only members whose age and liveness checks passed (staff record them, PRD 40.5):
      // the adults pass; the minor is checked too, so only the age policy can keep them out.
      for (const p of [...adults, teen]) {
        const id = (await memberRow("friends", p))!.id;
        for (const check of ["age", "liveness"]) expect((await st.staff(`/apps/friends/members/${id}/verify`, { check, result: "pass", note: "e2e staff check" })).status).toBe(200);
      }
      expect((await st.staff("/apps/friends/matching", { on: true })).status).toBe(200);
      // Three daily engine runs (9:30 New York each day).
      for (let d = 0; d < 3; d++) {
        for (const r of st.svc.runtimes.values()) await r.tick();
        st.clock.advance(DAY);
      }
      st.clock.advance(HOUR);
      // The engine proposed among the adults (the test fails if nothing was proposed: a run with no
      // proposals proves nothing about the minor), and the minor is in none of it.
      const opps = await sql`select o.id, array_agg(p.member_id) as parts from network.opportunities o join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = 'friends' group by o.id`;
      expect(opps.length).toBeGreaterThan(0);
      // The engine's own input never holds the minor (packInput drops minors before any pack runs).
      const input = rt.net.packInput(st.clock.now());
      expect(input.members.map(m => m.id)).not.toContain(fm.id);
      expect(input.members.length).toBeGreaterThanOrEqual(adults.length);
      for (const o of opps as { parts: string[] }[]) expect(o.parts).not.toContain(fm.id);
      expect((await sql`select 1 from network.participations where member_id = ${fm.id}`).length).toBe(0);
      const sm = (await memberRow("slop", teen))!;
      expect((await sql`select 1 from network.participations where member_id = ${sm.id}`).length).toBe(0);
      // No text to the minor names another member or proposes anyone.
      const toTeen = (await sql`select body from network.messages where member_id = ${fm.id} and direction = 'outbound'`).map((r: any) => r.body as string);
      for (const name of ["Ana", "Ben", "Cy", "Di"]) for (const body of toTeen) expect(body).not.toContain(name);
    }, T);

    test("minors cannot upload photos (adults_only at the age gate, with an adult control); no MCP tool takes one; none is stored", async () => {
      // A real (small) PNG with the current photo consent: before the fix this test sent a 4-byte body, so a
      // 4xx from photos_off, json_required or bad_image passed it whether or not the age gate worked.
      const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); o.set([0, 0, data.length >> 8, data.length & 0xff]); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
      const png = () => { const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", new TextEncoder().encode("PIXELS")), chunk("IEND", new Uint8Array(0))];
        const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
      const upload = (b: Browser) => st.site("slop", "/api/photos", { browser: b, method: "POST", body: png(), headers: { "content-type": "image/png", "x-photo-consent": PHOTO_CONSENT.version } });
      const teen = newPhone(), adult = newPhone();
      const tb = new Browser(), ab = new Browser();
      expect((await webJoin(st, "slop", teen, { age: 15, browser: tb })).res.status).toBe(200);
      expect((await webJoin(st, "slop", adult, { age: 29, browser: ab })).res.status).toBe(200);
      const refused = await upload(tb);
      expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([403, "adults_only"]);
      // The control: the same request from an adult is stored (no ID check, founder decision 9).
      const ok = await upload(ab);
      expect(ok.status, await ok.clone().text()).toBe(200);
      const tools = (await rpc(st, "slop", "/mcp", "tools/list")).body!.result.tools as { name: string }[];
      expect(tools.some(t => /photo|image|upload/i.test(t.name))).toBe(false);
      const personOf = async (p: string) => (await sql`select person_id from platform.phone_identities where e164 = ${p}`)[0]!.person_id;
      expect((await sql`select 1 from platform.photos where person_id = ${await personOf(teen)}`).length).toBe(0);
      expect((await sql`select 1 from platform.photos where person_id = ${await personOf(adult)}`).length).toBe(1);
      const sm = (await memberRow("slop", teen))!;
      expect((await sql`select 1 from network.facets where member_id = ${sm.id} and (kind ilike '%photo%' or value ilike '%photo%')`).length).toBe(0);
    }, T);
  });
});
