import { describe, expect, test } from "vitest";
import { defaultApps, type McpAppId } from "../src/apps.ts";
import { addMember, browserFlow, call, CHALLENGE, connect, origin, pendingAuthorizationCookie, PHONE_A, PHONE_B, register, rpc, setup, tokenRequest, VERIFIER, type Env } from "./harness.ts";

const HUB = "ntwrk.party";
const APPS: McpAppId[] = ["ntwrk", "slop", "peon", "friends"];
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
const RETURN = "https://client.example/callback";
const endpoint = (app: McpAppId, openai = false) => `https://ntwrk.party${app === "ntwrk" ? "/mcp" : `/mcp/${app}`}${openai ? "/openai" : ""}`;

async function consentFor(env: Env, app: McpAppId, phone: string, o: { redirect?: string; openai?: boolean } = {}) {
  const redirect = o.redirect ?? RETURN;
  const reg = await register(env, HUB, { redirect_uris: [redirect] });
  expect(reg.res.status).toBe(201);
  const q = new URLSearchParams({
    response_type: "code", client_id: reg.body.client_id, redirect_uri: redirect, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: `st-${app}`, scope: "membership:read profile:write", resource: endpoint(app, o.openai),
  });
  const start = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize?${q}`));
  const first = await start.text();
  expect(start.status, first.slice(0, 300)).toBe(200);
  const rid = /name="rid" value="([^"]+)"/.exec(first)?.[1];
  const browser = pendingAuthorizationCookie(start);
  if (!rid || !browser) throw new Error("no authorization request");
  const cookies = new Map<string, string>([[browser.slice(0, browser.indexOf("=")), browser.slice(browser.indexOf("=") + 1)]]);
  const post = async (path: string, form: Record<string, string>) => {
    const res = await env.fetch(new Request(`${origin(HUB)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: origin(HUB), cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: new URLSearchParams({ rid, ...form }).toString(),
    }));
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(";")[0]!; const at = pair.indexOf("=");
      if (pair.slice(at + 1)) cookies.set(pair.slice(0, at), pair.slice(at + 1)); else cookies.delete(pair.slice(0, at));
    }
    return res;
  };
  env.clock.t += 31_000;
  const phonePage = await post("/oauth/authorize/phone", { phone });
  expect(phonePage.status).toBe(200);
  const code = env.provider.last(phone);
  if (!code) throw new Error("no code sent");
  const consent = await post("/oauth/authorize/code", { code });
  return { clientId: reg.body.client_id as string, redirect, rid, first, consent: await consent.text(), consentStatus: consent.status, post };
}

async function approve(env: Env, flow: Awaited<ReturnType<typeof consentFor>>) {
  const done = await flow.post("/oauth/authorize/consent", { decision: "approve" });
  expect(done.status).toBe(303);
  const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
  const tok = await tokenRequest(env, HUB, { grant_type: "authorization_code", code, redirect_uri: flow.redirect, client_id: flow.clientId, code_verifier: VERIFIER });
  expect(tok.res.status).toBe(200);
  return tok.body as { access_token: string; refresh_token: string };
}

describe("one ntwrk.party connector endpoint for every app", () => {
  test("each app is authorized and used through its own ntwrk.party path: metadata, OTP, consent page, grant and status are for that app", async () => {
    const env = setup();
    await addMember(env, PHONE_A, APPS.map(app => ({ app, state: "active" as const })));
    const names = defaultApps();
    for (const app of APPS) {
      env.clock.t += 61 * 60_000;
      const path = new URL(endpoint(app)).pathname;
      const prm = await (await env.fetch(new Request(`${origin(HUB)}/.well-known/oauth-protected-resource${path}`))).json() as Record<string, any>;
      expect(prm, app).toMatchObject({ resource: endpoint(app), authorization_servers: ["https://ntwrk.party"], resource_name: `${names[app].name} (powered by The Network)` });
      const anon = await call(env, endpoint(app), "check_status");
      expect(anon.res.status, app).toBe(401);
      expect(anon.res.headers.get("www-authenticate"), app).toContain(`resource_metadata="https://ntwrk.party/.well-known/oauth-protected-resource${path}"`);

      const flow = await consentFor(env, app, PHONE_A);
      expect(env.provider.sent.at(-1)!.app, app).toBe(app);
      expect(flow.consentStatus, app).toBe(200);
      expect(flow.consent, app).toContain('action="/oauth/authorize/consent"');
      expect(flow.consent, app).toContain(`· ${names[app].name}</title>`);
      const token = await approve(env, flow);
      const granted = (await env.store.auditRows()).filter(r => r.kind === "consent_granted").at(-1)!;
      expect(granted.app, app).toBe(app);
      const status = await call(env, endpoint(app), "check_status", {}, { token: token.access_token });
      expect(status.res.status, app).toBe(200);
      expect(status.body!.result.structuredContent, app).toMatchObject({ app, status: "active" });
      const tools = (await rpc(env, endpoint(app), "tools/list", {}, { token: token.access_token })).body!.result.tools;
      expect(tools.find((t: any) => t.name === "check_status").inputSchema.properties.app.enum, app).toEqual([app]);
      for (const name of ["check_status", "get_updates"]) {
        const description = tools.find((t: any) => t.name === name).description as string;
        expect(description, `${app} ${name}`).toContain("allows access on ntwrk.party");
        if (app !== "ntwrk") expect(description, `${app} ${name}`).not.toContain(`on ${names[app].domain}`);
      }
    }
  });

  test("a grant for one app is refused for every other app, on the same host and on the app sites", async () => {
    const env = setup();
    await addMember(env, PHONE_A, APPS.map(app => ({ app, state: "active" as const })));
    const slop = await approve(env, await consentFor(env, "slop", PHONE_A));
    expect((await call(env, endpoint("slop"), "check_status", {}, { token: slop.access_token })).res.status).toBe(200);
    for (const other of ["ntwrk", "peon", "friends"] as const) {
      for (const tool of ["check_status", "app_info"]) {
        const r = await call(env, endpoint(other), tool, tool === "app_info" ? { app: other } : {}, { token: slop.access_token });
        expect(r.res.status, `${other} ${tool}`).toBe(401);
        expect(r.res.headers.get("www-authenticate"), `${other} ${tool}`).toContain('error="invalid_token"');
      }
      expect((await call(env, endpoint(other, true), "check_status", {}, { token: slop.access_token })).res.status, other).toBe(401);
    }
    expect((await call(env, endpoint("slop", true), "check_status", {}, { token: slop.access_token })).res.status).toBe(404);
    expect((await call(env, `${origin("slop.date")}/mcp`, "check_status", {}, { token: slop.access_token })).res.status).toBe(401);
    const peonArg = await call(env, endpoint("slop"), "check_status", { app: "peon" }, { token: slop.access_token });
    expect(peonArg.body!.result.isError).toBe(true);
    expect(peonArg.text).toContain("covers slop.date only");

    const moved = await tokenRequest(env, HUB, { grant_type: "refresh_token", refresh_token: slop.refresh_token, client_id: (await env.store.auditRows()).find(r => r.kind === "client_registered")!.clientId!, resource: endpoint("peon") });
    expect(moved.res.status).toBe(400);

    const peonFlow = await consentFor(env, "peon", PHONE_A);
    const done = await peonFlow.post("/oauth/authorize/consent", { decision: "approve" });
    const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
    const cross = await tokenRequest(env, HUB, { grant_type: "authorization_code", code, redirect_uri: peonFlow.redirect, client_id: peonFlow.clientId, code_verifier: VERIFIER, resource: endpoint("slop") });
    expect(cross.res.status).toBe(400);
    const site = await tokenRequest(env, "slop.date", { grant_type: "authorization_code", code, redirect_uri: peonFlow.redirect, client_id: peonFlow.clientId, code_verifier: VERIFIER });
    expect(site.res.status).toBe(401);
  });

  test("an unknown app path and a resource of another host are refused", async () => {
    const env = setup();
    expect((await rpc(env, "https://ntwrk.party/mcp/zzzz", "tools/list")).res.status).toBe(404);
    expect((await rpc(env, "https://ntwrk.party/mcp/ntwrk", "tools/list")).res.status).toBe(404);
    expect((await env.fetch(new Request(`${origin(HUB)}/.well-known/oauth-protected-resource/mcp/zzzz`))).status).toBe(404);
    expect((await rpc(env, `${origin("peon.biz")}/mcp/slop`, "tools/list")).res.status).toBe(404);
    const reg = await register(env, HUB);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE, code_challenge_method: "S256", resource: `${origin("slop.date")}/mcp` });
    expect((await env.fetch(new Request(`${origin(HUB)}/oauth/authorize?${q}`))).status).toBe(400);
  });
});

describe("ChatGPT on the ntwrk.party endpoint", () => {
  test("ChatGPT can authorize friends on the ntwrk.party endpoint and a new person is offered signup", async () => {
    const env = setup();
    const flow = await consentFor(env, "friends", PHONE_B, { redirect: CHATGPT, openai: true });
    expect(flow.consentStatus).toBe(200);
    expect(flow.consent).toContain(`· friends.help</title>`);
    expect(flow.consent).toContain('action="/oauth/authorize/signup"');
    const opened = await flow.post("/oauth/authorize/signup", { decision: "open" });
    expect(opened.status).toBe(200);
    const token = await approve(env, flow);
    const status = await call(env, endpoint("friends", true), "check_status", {}, { token: token.access_token });
    expect(status.res.status).toBe(200);
    expect(status.body!.result.structuredContent).toMatchObject({ app: "friends", status: "not_joined" });
    expect((await call(env, endpoint("friends"), "check_status", {}, { token: token.access_token })).res.status).toBe(401);
    expect((await register(env, "slop.date", { redirect_uris: [CHATGPT] })).res.status).toBe(400);
  });

  test("unavailable Slop resources do not issue an authorization request on either host", async () => {
    const env = setup();
    const begin = async (host: string, resource: string, redirect: string) => {
      const reg = await register(env, host, { redirect_uris: [redirect] });
      expect(reg.res.status).toBe(201);
      const query = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id,
        redirect_uri: redirect, resource, code_challenge: CHALLENGE, code_challenge_method: "S256" });
      const response = await env.fetch(new Request(`${origin(host)}/oauth/authorize?${query}`));
      return [response.status, !!pendingAuthorizationCookie(response)];
    };
    expect(await begin(HUB, endpoint("slop", true), CHATGPT)).toEqual([400, false]);
    expect(await begin(HUB, endpoint("slop"), CHATGPT)).toEqual([403, false]);
    expect(await begin("slop.date", "https://slop.date/mcp/openai", RETURN)).toEqual([400, false]);
    expect(env.provider.sent).toHaveLength(0);
  });

  test("the allowlisted private Slop pilot still authorizes only adults at the dedicated full endpoint", async () => {
    const env = setup({ env: { PLATFORM_ENV: "staging" }, customChatGptSlopPersonIds: ["eligible-owner", "underage-owner"] });
    for (const [id, phone, age] of [["eligible-owner", PHONE_A, 30], ["underage-owner", PHONE_B, 17]] as const) {
      await env.people.createPerson({ id, e164: phone, method: "otp_sms", at: env.clock.t, lowestAge: age, phoneHash: env.accounts.phoneHash(phone) });
      await env.people.putMembership({ app: "slop", personId: id, memberId: `slop_${id}`, state: "active", review: null, firstName: "Rae", profile: {}, joinedAt: env.clock.t, leftAt: null });
    }
    const hub = await register(env, HUB, { redirect_uris: [CHATGPT] });
    const hubFlow = await browserFlow(env, HUB, hub.body.client_id, PHONE_A, { redirectUri: CHATGPT, resource: endpoint("slop") });
    expect(hubFlow.start.status).toBe(403);
    const opts = { redirectUri: CHATGPT, resource: "https://slop.date/mcp" };
    const adult = await connect(env, "slop.date", PHONE_A, { ...opts, register: { redirect_uris: [CHATGPT] } });
    expect(adult.tokenRes.status).toBe(200);
    const status = await call(env, opts.resource, "check_status", {}, { token: adult.token.access_token });
    expect(status.body!.result.structuredContent).toMatchObject({ app: "slop", status: "active" });
    env.clock.t += 61 * 60_000;
    const minor = await browserFlow(env, "slop.date", adult.client.client_id, PHONE_B, opts);
    expect(minor.location).toBeNull();
    expect(minor.status).toBe(403);
  });

  test("The Network stays invite-only on the ntwrk.party endpoint: signup without an invitation creates no membership", async () => {
    const env = setup();
    const flow = await consentFor(env, "ntwrk", PHONE_B, { redirect: CHATGPT, openai: true });
    expect(flow.consentStatus).toBe(200);
    expect(flow.consent).toContain('action="/oauth/authorize/signup"');
    const opened = await flow.post("/oauth/authorize/signup", { decision: "open" });
    expect(opened.status).toBe(200);
    const form = await opened.text();
    const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(form)?.[1] ?? "";
    const sent = await flow.post("/oauth/authorize/signup", {
      decision: "join", signupView: field("signupView"), consentVersion: field("consentVersion"), smsConsent: "yes",
      firstName: "Ash", birthdate: "1993-01-15", homeCity: "nyc", invitation: "",
    });
    const html = await sent.text();
    expect(html).toMatch(/invitation/i);
    const who = await env.accounts.byPhoneHash(env.accounts.phoneHash(PHONE_B));
    const membership = who ? await env.people.getMembership(who.person.id, "ntwrk") : undefined;
    expect(membership ?? null).toBeNull();
  });
});

function cookieJar(...headers: Array<string | null | undefined>) {
  const jar = new Map<string, string>();
  const take = (all: string | null | undefined) => {
    for (const header of (all ?? "").split(/,\s*(?=[^;,\s]+=)/)) {
      const pair = header.split(";")[0]!.trim(); const at = pair.indexOf("=");
      if (at > 0) { if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1)); else jar.delete(pair.slice(0, at)); }
    }
  };
  headers.forEach(take);
  return { jar, take, header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

describe("hub findings: each browser path of ntwrk.party acts for the app of its own request", () => {
  // spec/oauthBrowserAuthorization.md, "A live authorization request is bound to one browser in one app"
  test("one browser can finish two pending hub authorizations for different apps", async () => {
    const env = setup({ productionSessionCookies: true });
    const prior = await connect(env, HUB, PHONE_A);
    const jar = cookieJar(prior.flow.siteCookie);
    const client = await register(env, HUB);
    expect(client.res.status).toBe(201);

    const start = async (app: McpAppId) => {
      const resource = endpoint(app);
      const query = new URLSearchParams({
        response_type: "code", client_id: client.body.client_id, redirect_uri: RETURN, resource,
        code_challenge: CHALLENGE, code_challenge_method: "S256", state: app, scope: "membership:read",
      });
      const response = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize?${query}`, { headers: { cookie: jar.header() } }));
      const rid = /name="rid" value="([^"]+)"/.exec(await response.text())?.[1];
      expect(response.status).toBe(200);
      if (!rid) throw new Error("missing OAuth request");
      const cookie = response.headers.getSetCookie()[0];
      if (!cookie) throw new Error("missing pending browser cookie");
      jar.take(cookie);
      expect(await env.store.getAuthRequest(rid)).toMatchObject({ app, resource });
      return { app, resource, rid, cookie: cookie.split(";")[0]! };
    };

    const post = async (rid: string, action: string, form: Record<string, string>, cookie = jar.header()) => {
      const response = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize/${action}`, {
        method: "POST", headers: { origin: origin(HUB), cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rid, ...form }),
      }));
      response.headers.getSetCookie().forEach(jar.take);
      return response;
    };

    const friends = await start("friends");
    const peon = await start("peon");
    const wrongBrowser = await post(friends.rid, "phone", { phone: PHONE_A }, peon.cookie);
    expect(await wrongBrowser.text()).toContain("This page has expired");
    expect((await env.store.getAuthRequest(friends.rid))?.step).toBe("phone");

    for (const [flow, phone] of [[friends, PHONE_A], [peon, PHONE_B]] as const) {
      env.clock.t += 31_000;
      const phonePage = await post(flow.rid, "phone", { phone });
      expect(await phonePage.text()).toContain('action="/oauth/authorize/code"');
      const consent = await post(flow.rid, "code", { code: env.provider.last(phone)! });
      expect(await consent.text()).toContain('action="/oauth/authorize/consent"');
      const approved = await post(flow.rid, "consent", { decision: "approve" });
      expect(approved.status).toBe(303);
      const redirect = new URL(approved.headers.get("location")!);
      expect(redirect.searchParams.get("state")).toBe(flow.app);
      const token = await tokenRequest(env, HUB, {
        grant_type: "authorization_code", code: redirect.searchParams.get("code")!, client_id: client.body.client_id,
        redirect_uri: RETURN, code_verifier: VERIFIER, resource: flow.resource,
      });
      expect(token.res.status).toBe(200);
      const scoped = await call(env, flow.resource, "check_status", {}, { token: token.body.access_token });
      expect(scoped.body?.result.structuredContent).toMatchObject({ app: flow.app });
    }

    expect((await call(env, endpoint("ntwrk"), "check_status", {}, { token: prior.token.access_token })).res.status).toBe(200);
  });

  test("/oauth/signup-draft acts for the app of the stored authorization request (rid), only in the browser that holds it", async () => {
    const env = setup();
    const c = await connect(env, HUB, PHONE_B, { scope: "membership:read profile:write", resource: endpoint("friends") });
    const saved = await call(env, endpoint("friends"), "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token: c.token.access_token });
    expect(saved.body!.result.structuredContent).toMatchObject({ prepared: true });
    const friends = cookieJar(c.flow.siteCookie).header();
    const q = new URLSearchParams({
      response_type: "code", client_id: c.client.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE,
      code_challenge_method: "S256", state: "st-draft", scope: "membership:read profile:write", resource: endpoint("friends"),
    });
    const start = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize?${q}`, { headers: { cookie: friends } }));
    const html = await start.text();
    const rid = /name="rid" value="([^"]+)"/.exec(html)?.[1];
    expect(rid, html.slice(0, 300)).toBeTruthy();
    const jar = cookieJar(friends, start.headers.get("set-cookie"));
    const claim = (body: Record<string, unknown>, cookie = jar.header()) => env.fetch(new Request(`${origin(HUB)}/oauth/signup-draft`, {
      method: "POST", headers: { cookie, origin: origin(HUB), "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const other = await claim({ rid }, friends);
    expect(other.status).toBe(403);
    expect((await claim({ rid: "A".repeat(22) })).status).toBe(403);
    expect((await claim({})).status).toBe(401);
    const shown = await claim({ rid });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ draft: { firstName: "Ari", homeCity: "sf" } });
  });

  test("/oauth/consents on ntwrk.party lists and removes the grants of every app, each labeled with its app; an app site lists only its own", async () => {
    // spec/connectedAssistants.md, "The page lists live grants only for a signed-in session"
    // spec/webSession.md, "Only a live token on the requested app can authenticate"
    const env = setup({ productionSessionCookies: true });
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }, { app: "friends", state: "active" }]);
    const slop = await connect(env, HUB, PHONE_A, { resource: endpoint("slop") });
    const hubBrowser = cookieJar(slop.flow.siteCookie);
    const friends = await connect(env, HUB, PHONE_A, { resource: endpoint("friends"), cookie: hubBrowser.header() });
    hubBrowser.take(friends.flow.siteCookie);
    const cookie = hubBrowser.header();
    const names = defaultApps();
    const page = (path = "", host = HUB, cookies = cookie) => env.fetch(new Request(`${origin(host)}/oauth/consents${path}`, { headers: { cookie: cookies } }));
    const listed = await page();
    const html = await listed.text();
    expect(listed.status, html.slice(0, 300)).toBe(200);
    expect(html).toContain(`Test Assistant (${names.slop.name})`);
    expect(html).toContain(`Test Assistant (${names.friends.name})`);
    for (const [app, connection] of [["slop", slop], ["friends", friends]] as const) {
      const options = connection.flow.siteCookie?.split(", ").find(header => header.startsWith(`__Host-mcp_sid_${app}=`))?.split("; ").slice(1) ?? [];
      expect(options, app).toEqual(expect.arrayContaining(["Path=/", "HttpOnly", "SameSite=Lax", "Secure"]));
      expect(options.some(option => option.startsWith("Domain=")), app).toBe(false);
    }
    const friendsSession = hubBrowser.jar.get("__Host-mcp_sid_friends");
    expect(friendsSession).toBeTruthy();
    expect((await page("", HUB, `__Host-mcp_sid_slop=${friendsSession}`)).status).toBe(401);
    expect((await page("", "friends.help", cookie)).status).toBe(401);
    const directFriends = await connect(env, "friends.help", PHONE_A);
    const directCookie = cookieJar(directFriends.flow.siteCookie).header();
    expect(directCookie).toMatch(/^__Host-sid=/);
    expect((await page("", HUB, directCookie)).status).toBe(401);
    const site = await (await page("", "friends.help", directCookie)).text();
    expect(site).toContain("Test Assistant");
    expect(site).not.toContain(`(${names.friends.name})`);
    expect(site).not.toContain(`(${names.slop.name})`);

    const key = env.accounts.phoneHash(PHONE_A);
    const [slopGrant] = await env.store.grantsFor(key, "slop", env.clock.t);
    const [friendsGrant] = await env.store.grantsFor(key, "friends", env.clock.t);
    const confirm = await (await page(`?remove=${encodeURIComponent(slopGrant!.id)}`)).text();
    const proof = /name="confirmation" value="([^"]+)"/.exec(confirm)?.[1];
    expect(proof).toBeTruthy();
    const removed = await env.fetch(new Request(`${origin(HUB)}/oauth/consents/revoke`, {
      method: "POST", headers: { cookie, origin: origin(HUB), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: slopGrant!.id, confirmation: proof! }),
    }));
    expect(await removed.text()).toContain("Access removed.");
    expect((await env.store.getGrant(slopGrant!.id))!.revokedAt).not.toBeNull();
    expect(await env.store.getGrant(friendsGrant!.id)).toMatchObject({ revokedAt: null });
    expect((await env.store.auditRows()).filter(r => r.kind === "consent_revoked").map(r => [r.grantId, r.app])).toEqual([[slopGrant!.id, "slop"]]);
    expect((await call(env, endpoint("slop"), "check_status", {}, { token: slop.token.access_token })).res.status).toBe(401);
    expect((await call(env, endpoint("friends"), "check_status", {}, { token: friends.token.access_token })).res.status).toBe(200);
    const friendsOnly = `__Host-mcp_sid_friends=${friendsSession}`;
    const codesSent = env.provider.sent.length;
    const slopAgain = await connect(env, HUB, PHONE_A, { resource: endpoint("slop"), cookie });
    expect(env.provider.sent).toHaveLength(codesSent);
    const [live] = await env.store.grantsFor(key, "slop", env.clock.t);
    const seeNewProof = await (await page(`?remove=${encodeURIComponent(live!.id)}`)).text();
    const currentProof = /name="confirmation" value="([^"]+)"/.exec(seeNewProof)?.[1];
    expect(currentProof).toBeTruthy();
    const refused = await env.fetch(new Request(`${origin(HUB)}/oauth/consents/revoke`, {
      method: "POST", headers: { cookie: friendsOnly, origin: origin(HUB), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: live!.id, confirmation: currentProof! }),
    }));
    expect(await refused.text()).not.toContain("Access removed.");
    expect(await env.store.getGrant(live!.id)).toMatchObject({ revokedAt: null });
    expect(slopAgain.token.access_token).toBeTruthy();
    expect((await page("", HUB, "")).status).toBe(401);
  });

  test("a token from /oauth/authorize without a resource is The Network's; an app path answers 401 that names its own metadata", async () => {
    const env = setup();
    await addMember(env, PHONE_A, APPS.map(app => ({ app, state: "active" as const })));
    for (const openai of [false, true]) {
      env.clock.t += 61 * 60_000;
      const redirect = openai ? CHATGPT : RETURN;
      const fallback = await connect(env, HUB, PHONE_A, { register: { redirect_uris: [redirect] }, redirectUri: redirect });
      expect(fallback.tokenRes.status).toBe(200);
      expect((await call(env, endpoint("ntwrk", openai), "check_status", {}, { token: fallback.token.access_token })).res.status).toBe(200);
      const supported: McpAppId[] = openai ? ["peon", "friends"] : ["slop", "peon", "friends"];
      for (const app of supported) {
        const r = await call(env, endpoint(app, openai), "check_status", {}, { token: fallback.token.access_token });
        expect(r.res.status, `${app} ${openai}`).toBe(401);
        const challenge = r.res.headers.get("www-authenticate") ?? "";
        const path = new URL(endpoint(app, openai)).pathname;
        expect(challenge, app).toContain(`resource_metadata="https://ntwrk.party/.well-known/oauth-protected-resource${path}"`);
        expect(challenge, app).toContain('error="invalid_token"');
      }
      const reconnectApp = openai ? "friends" : "slop";
      const metadataUrl = /resource_metadata="([^"]+)"/.exec((await call(env, endpoint(reconnectApp, openai), "check_status", {}, { token: fallback.token.access_token })).res.headers.get("www-authenticate")!)![1]!;
      const prm = await (await env.fetch(new Request(metadataUrl))).json() as { resource: string };
      expect(prm.resource).toBe(endpoint(reconnectApp, openai));
      const again = await connect(env, HUB, PHONE_A, { register: { redirect_uris: [redirect] }, redirectUri: redirect, resource: prm.resource });
      const status = await call(env, endpoint(reconnectApp, openai), "check_status", {}, { token: again.token.access_token });
      expect(status.res.status).toBe(200);
      expect(status.body!.result.structuredContent).toMatchObject({ app: reconnectApp });
    }
  });

  test("a request started on slop.date does not continue on ntwrk.party: the phone form there gets the expired page", async () => {
    const env = setup();
    const reg = await register(env, "slop.date");
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st-x" });
    const start = await env.fetch(new Request(`${origin("slop.date")}/oauth/authorize?${q}`));
    const rid = /name="rid" value="([^"]+)"/.exec(await start.text())?.[1];
    const browser = pendingAuthorizationCookie(start);
    expect(rid && browser).toBeTruthy();
    env.clock.t += 31_000;
    const sends = env.provider.sent.length;
    const moved = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize/phone`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: origin(HUB), cookie: browser! },
      body: new URLSearchParams({ rid: rid!, phone: PHONE_A }).toString(),
    }));
    expect(await moved.text()).toContain("This page has expired");
    expect(env.provider.sent.length).toBe(sends);
    expect((await env.store.getAuthRequest(rid!))).toMatchObject({ step: "phone", e164: null });
  });

  test("a cross-site authorization form on ntwrk.party is refused before its body is read", async () => {
    const env = setup();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(`rid=${"A".repeat(22)}&phone=%2B12125550142`)); controller.close(); },
    }, { highWaterMark: 0 });
    const refused = await env.fetch(new Request(`${origin(HUB)}/oauth/authorize/phone`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body, duplex: "half",
    } as RequestInit));
    expect(refused.status).toBe(403);
    expect(pulls).toBe(0);
  });
});
