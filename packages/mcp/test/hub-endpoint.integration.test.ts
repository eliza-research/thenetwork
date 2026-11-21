// spec/connectorTools.md, "The ntwrk.party host serves every app at its own path, and a grant covers only its own app".
// Founder decision 2026-11-18: one connector server for every app (https://ntwrk.party/mcp, /mcp/<app>, and /openai for
// ChatGPT). Each connection is still bound to one app for its whole grant. The real platform (people store, OTP service,
// accounts, sessions) with a fake OTP provider; nothing is sent.
import { describe, expect, test } from "vitest";
import { defaultApps, type McpAppId } from "../src/apps.ts";
import { addMember, call, CHALLENGE, connect, origin, PHONE_A, PHONE_B, register, rpc, setup, tokenRequest, VERIFIER, type Env } from "./harness.ts";

const HUB = "ntwrk.party";
const APPS: McpAppId[] = ["ntwrk", "slop", "peon", "friends"];
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
const RETURN = "https://client.example/callback";
/** The ntwrk.party endpoint of an app (spec/agentEntry.md, appEndpointPath and appOpenAiEndpointPath). */
const endpoint = (app: McpAppId, openai = false) => `https://ntwrk.party${app === "ntwrk" ? "/mcp" : `/mcp/${app}`}${openai ? "/openai" : ""}`;

/** Start authorization for one app on the ntwrk.party host and confirm the phone; returns the consent page. */
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
  const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1];
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
      // The OTP service sends at most 3 codes to one number in one hour, across every app (packages/platform/src/otp.ts).
      env.clock.t += 61 * 60_000;
      const path = new URL(endpoint(app)).pathname;
      const prm = await (await env.fetch(new Request(`${origin(HUB)}/.well-known/oauth-protected-resource${path}`))).json() as Record<string, any>;
      expect(prm, app).toMatchObject({ resource: endpoint(app), authorization_servers: ["https://ntwrk.party"], resource_name: `${names[app].name} (powered by The Network)` });
      // A request without a token gets a challenge that points at this app's own metadata.
      const anon = await call(env, endpoint(app), "check_status");
      expect(anon.res.status, app).toBe(401);
      expect(anon.res.headers.get("www-authenticate"), app).toContain(`resource_metadata="https://ntwrk.party/.well-known/oauth-protected-resource${path}"`);

      const flow = await consentFor(env, app, PHONE_A);
      // The phone code is sent for this app, and the consent page names this app (spec/connectorTools.md).
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
      // The tool list of this path offers this app only to member tools.
      const tools = (await rpc(env, endpoint(app), "tools/list", {}, { token: token.access_token })).body!.result.tools;
      expect(tools.find((t: any) => t.name === "check_status").inputSchema.properties.app.enum, app).toEqual([app]);
    }
  });

  test("a grant for one app is refused for every other app, on the same host and on the app sites", async () => {
    const env = setup();
    await addMember(env, PHONE_A, APPS.map(app => ({ app, state: "active" as const })));
    const slop = await approve(env, await consentFor(env, "slop", PHONE_A));
    expect((await call(env, endpoint("slop"), "check_status", {}, { token: slop.access_token })).res.status).toBe(200);
    // spec/connectorTools.md, lawGrantNeverCrossesApps: the slop token is invalid at each other app's path, a public tool included.
    for (const other of ["ntwrk", "peon", "friends"] as const) {
      for (const tool of ["check_status", "app_info"]) {
        const r = await call(env, endpoint(other), tool, tool === "app_info" ? { app: other } : {}, { token: slop.access_token });
        expect(r.res.status, `${other} ${tool}`).toBe(401);
        expect(r.res.headers.get("www-authenticate"), `${other} ${tool}`).toContain('error="invalid_token"');
      }
      expect((await call(env, endpoint(other, true), "check_status", {}, { token: slop.access_token })).res.status, other).toBe(401);
    }
    // The other surface of the same app, and the app site's own endpoint, are other resources too.
    expect((await call(env, endpoint("slop", true), "check_status", {}, { token: slop.access_token })).res.status).toBe(401);
    expect((await call(env, `${origin("slop.date")}/mcp`, "check_status", {}, { token: slop.access_token })).res.status).toBe(401);
    // On its own path, the slop grant still names no other app.
    const peonArg = await call(env, endpoint("slop"), "check_status", { app: "peon" }, { token: slop.access_token });
    expect(peonArg.body!.result.isError).toBe(true);
    expect(peonArg.text).toContain("covers slop.date only");

    // The refresh token cannot be moved to another app's resource either.
    const moved = await tokenRequest(env, HUB, { grant_type: "refresh_token", refresh_token: slop.refresh_token, client_id: (await env.store.auditRows()).find(r => r.kind === "client_registered")!.clientId!, resource: endpoint("peon") });
    expect(moved.res.status).toBe(400);

    // A code issued for peon cannot be exchanged for slop's resource.
    const peonFlow = await consentFor(env, "peon", PHONE_A);
    const done = await peonFlow.post("/oauth/authorize/consent", { decision: "approve" });
    const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
    const cross = await tokenRequest(env, HUB, { grant_type: "authorization_code", code, redirect_uri: peonFlow.redirect, client_id: peonFlow.clientId, code_verifier: VERIFIER, resource: endpoint("slop") });
    expect(cross.res.status).toBe(400);
    // A client registered on the ntwrk.party host is not a client of an app site.
    const site = await tokenRequest(env, "slop.date", { grant_type: "authorization_code", code, redirect_uri: peonFlow.redirect, client_id: peonFlow.clientId, code_verifier: VERIFIER });
    expect(site.res.status).toBe(401);
  });

  test("an unknown app path and a resource of another host are refused", async () => {
    const env = setup();
    expect((await rpc(env, "https://ntwrk.party/mcp/zzzz", "tools/list")).res.status).toBe(404);
    expect((await rpc(env, "https://ntwrk.party/mcp/ntwrk", "tools/list")).res.status).toBe(404);
    expect((await env.fetch(new Request(`${origin(HUB)}/.well-known/oauth-protected-resource/mcp/zzzz`))).status).toBe(404);
    // An app site serves only its own app.
    expect((await rpc(env, `${origin("peon.biz")}/mcp/slop`, "tools/list")).res.status).toBe(404);
    const reg = await register(env, HUB);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE, code_challenge_method: "S256", resource: `${origin("slop.date")}/mcp` });
    expect((await env.fetch(new Request(`${origin(HUB)}/oauth/authorize?${q}`))).status).toBe(400);
  });
});

describe("ChatGPT on the ntwrk.party endpoint", () => {
  // spec/connectorTools.md, "Each surface offers every app, slop.date included"; spec/landingEntry.md, lawEveryPageOffersChatGpt.
  test("ChatGPT can authorize slop at https://ntwrk.party/mcp/slop/openai, and a new person is offered signup", async () => {
    const env = setup();
    const flow = await consentFor(env, "slop", PHONE_B, { redirect: CHATGPT, openai: true });
    expect(flow.consentStatus).toBe(200);
    expect(flow.consent).toContain(`· slop.date</title>`);
    // signupClientAllowed no longer refuses ChatGPT on slop: the consent page offers signup.
    expect(flow.consent).toContain('action="/oauth/authorize/signup"');
    const opened = await flow.post("/oauth/authorize/signup", { decision: "open" });
    expect(opened.status).toBe(200);
    const token = await approve(env, flow);
    const status = await call(env, endpoint("slop", true), "check_status", {}, { token: token.access_token });
    expect(status.res.status).toBe(200);
    expect(status.body!.result.structuredContent).toMatchObject({ app: "slop", status: "not_joined" });
    // The ChatGPT token is for the OpenAI surface of slop only.
    expect((await call(env, endpoint("slop"), "check_status", {}, { token: token.access_token })).res.status).toBe(401);
    // ChatGPT still cannot use slop.date's own site endpoint (spec/connectorTools.md, lawSlopSiteKeepsNoOpenAiSurface).
    expect((await register(env, "slop.date", { redirect_uris: [CHATGPT] })).res.status).toBe(400);
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
      firstName: "Ash", age: "33", homeCity: "nyc", invitation: "",
    });
    const html = await sent.text();
    expect(html).toMatch(/invitation/i);
    const who = await env.accounts.byPhoneHash(env.accounts.phoneHash(PHONE_B));
    const membership = who ? await env.people.getMembership(who.person.id, "ntwrk") : undefined;
    expect(membership ?? null).toBeNull();
  });
});

/** The cookie pairs ("name=value") of a list of Set-Cookie headers, the last value of each name. */
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
  test("/oauth/signup-draft acts for the app of the stored authorization request (rid), only in the browser that holds it", async () => {
    const env = setup();
    // A pre-signup Friends grant on the ntwrk.party path saves the draft that the person approved in the agent.
    const c = await connect(env, HUB, PHONE_B, { scope: "membership:read profile:write", resource: endpoint("friends") });
    const saved = await call(env, endpoint("friends"), "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token: c.token.access_token });
    expect(saved.body!.result.structuredContent).toMatchObject({ prepared: true });
    // A new Friends authorization on ntwrk.party, in a browser with a confirmed Friends phone session.
    const friends = `sid_friends=${(await env.sessions.create("friends", PHONE_B, null)).token}`;
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
    // Another browser (no authorization cookie of this request) cannot name the request.
    const other = await claim({ rid }, friends);
    expect(other.status).toBe(403);
    // A request id that is not stored is refused, not read as the host's app.
    expect((await claim({ rid: "A".repeat(22) })).status).toBe(403);
    // Without a rid the path stays The Network's: this browser has no Network session.
    expect((await claim({})).status).toBe(401);
    const shown = await claim({ rid });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ draft: { firstName: "Ari", homeCity: "sf" } });
  });

  test("/oauth/consents on ntwrk.party lists and removes the grants of every app, each labeled with its app; an app site lists only its own", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }, { app: "friends", state: "active" }]);
    const slop = await connect(env, HUB, PHONE_A, { resource: endpoint("slop") });
    const friends = await connect(env, HUB, PHONE_A, { resource: endpoint("friends") });
    const jar = cookieJar(slop.flow.siteCookie, friends.flow.siteCookie);
    for (const name of ["sid_slop", "sid_friends"]) expect(jar.jar.has(name), name).toBe(true);
    const cookie = [...jar.jar].filter(([k]) => k.startsWith("sid_")).map(([k, v]) => `${k}=${v}`).join("; ");
    const names = defaultApps();
    const page = (path = "", host = HUB, cookies = cookie) => env.fetch(new Request(`${origin(host)}/oauth/consents${path}`, { headers: { cookie: cookies } }));
    const listed = await page();
    const html = await listed.text();
    expect(listed.status, html.slice(0, 300)).toBe(200);
    expect(html).toContain(`Test Assistant (${names.slop.name})`);
    expect(html).toContain(`Test Assistant (${names.friends.name})`);
    // An app site is unchanged: its own app only, with no app label.
    const site = await (await page("", "friends.help", cookie)).text();
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
    // A session of one app cannot remove another app's grant.
    const friendsOnly = cookie.split("; ").filter(p => p.startsWith("sid_friends=")).join("");
    const slopAgain = await connect(env, HUB, PHONE_A, { resource: endpoint("slop") });
    const [live] = await env.store.grantsFor(key, "slop", env.clock.t);
    const refused = await env.fetch(new Request(`${origin(HUB)}/oauth/consents/revoke`, {
      method: "POST", headers: { cookie: friendsOnly, origin: origin(HUB), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: live!.id, confirmation: proof! }),
    }));
    expect(await refused.text()).not.toContain("Access removed.");
    expect(await env.store.getGrant(live!.id)).toMatchObject({ revokedAt: null });
    expect(slopAgain.token.access_token).toBeTruthy();
    // No session of any app: sign in first.
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
      for (const app of ["slop", "peon", "friends"] as const) {
        const r = await call(env, endpoint(app, openai), "check_status", {}, { token: fallback.token.access_token });
        expect(r.res.status, `${app} ${openai}`).toBe(401);
        const challenge = r.res.headers.get("www-authenticate") ?? "";
        const path = new URL(endpoint(app, openai)).pathname;
        expect(challenge, app).toContain(`resource_metadata="https://ntwrk.party/.well-known/oauth-protected-resource${path}"`);
        expect(challenge, app).toContain('error="invalid_token"');
      }
      // The client follows the challenge: the metadata names the app's resource, and a new authorization for it works.
      const metadataUrl = /resource_metadata="([^"]+)"/.exec((await call(env, endpoint("slop", openai), "check_status", {}, { token: fallback.token.access_token })).res.headers.get("www-authenticate")!)![1]!;
      const prm = await (await env.fetch(new Request(metadataUrl))).json() as { resource: string };
      expect(prm.resource).toBe(endpoint("slop", openai));
      const again = await connect(env, HUB, PHONE_A, { register: { redirect_uris: [redirect] }, redirectUri: redirect, resource: prm.resource });
      const status = await call(env, endpoint("slop", openai), "check_status", {}, { token: again.token.access_token });
      expect(status.res.status).toBe(200);
      expect(status.body!.result.structuredContent).toMatchObject({ app: "slop" });
    }
  });

  test("a request started on slop.date does not continue on ntwrk.party: the phone form there gets the expired page", async () => {
    const env = setup();
    const reg = await register(env, "slop.date");
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st-x" });
    const start = await env.fetch(new Request(`${origin("slop.date")}/oauth/authorize?${q}`));
    const rid = /name="rid" value="([^"]+)"/.exec(await start.text())?.[1];
    const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1];
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
