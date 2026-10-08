// OAuth 2.1 against the handler with the real platform OTP and a fake provider (no texts are sent).
import { describe, expect, test } from "bun:test";
import type { PeopleStore } from "@thenetwork/platform";
import { signProxyHeaders } from "@thenetwork/platform/src/proxy.ts";
import { redirectUriAllowed } from "../src/handler.ts";
import { CLIENT_UNUSED_MS, GRANT_KEEP_MS, MemoryOAuthStore } from "../src/store.ts";
import { addMember, browserFlow, call, CHALLENGE, connect, origin, PHONE_A, PHONE_B, register, rpc, setup, tokenRequest, VERIFIER } from "./harness.ts";

const SLOP = "slop.date", PEON = "peon.biz", NTWRK = "ntwrk.love";

describe("metadata", () => {
  test("each site is its own issuer and resource; S256 only; iss in responses", async () => {
    const env = setup();
    const as = await (await env.fetch(new Request(`${origin(PEON)}/.well-known/oauth-authorization-server`))).json() as Record<string, any>;
    expect(as.issuer).toBe("https://peon.biz");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.scopes_supported).toEqual(["apps:read", "membership:read", "profile:write"]);
    expect(as.registration_endpoint).toBe("https://peon.biz/oauth/register");
    const prm = await (await env.fetch(new Request(`${origin(PEON)}/.well-known/oauth-protected-resource/mcp`))).json() as Record<string, any>;
    expect(prm).toMatchObject({ resource: "https://peon.biz/mcp", authorization_servers: ["https://peon.biz"], bearer_methods_supported: ["header"] });
    expect(prm.scopes_supported).not.toContain("offline_access");
    const openai = await (await env.fetch(new Request(`${origin(NTWRK)}/.well-known/oauth-protected-resource/mcp/openai`))).json() as Record<string, any>;
    expect(openai.resource).toBe("https://ntwrk.love/mcp/openai");
    expect((await env.fetch(new Request(`${origin(SLOP)}/.well-known/oauth-protected-resource/mcp/openai`))).status).toBe(404);
    expect((await env.fetch(new Request("https://evil.example/.well-known/oauth-authorization-server"))).status).toBe(404);
    expect(await env.handler.fetch(new Request(`${origin(SLOP)}/api/app`))).toBeUndefined();
  });
});

describe("authorization code with PKCE", () => {
  test("full flow: sign in on the page, approve, exchange, check_status", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }]);
    const { flow, token, tokenRes, client } = await connect(env, SLOP, PHONE_A);
    expect(flow.status).toBe(303);
    const loc = new URL(flow.location!);
    expect(loc.origin + loc.pathname).toBe("https://client.example/callback");
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(loc.searchParams.get("iss")).toBe("https://slop.date");
    expect(tokenRes.status).toBe(200);
    expect(token).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "apps:read membership:read profile:write" });
    expect(token.access_token).toMatch(/^ntwa_/);
    expect(token.refresh_token).toMatch(/^ntwr_/);
    // The phone never leaves the server: not in the redirect, not in the token response.
    expect(flow.location!).not.toContain("555");
    expect(JSON.stringify(token)).not.toContain("555");
    const r = await call(env, `${origin(SLOP)}/mcp`, "check_status", {}, { token: token.access_token });
    expect(r.res.status).toBe(200);
    expect(r.body!.result.structuredContent).toMatchObject({ app: "slop", status: "active" });
    expect(JSON.stringify(r.body)).not.toMatch(/555|\bages?\b|lowest|person_|member_/);
    // The site session was started too (the person is signed in on slop.date).
    expect(flow.siteCookie).toContain("sid_slop=");
    // Tokens are stored as hashes only.
    expect(JSON.stringify([...(env.store as any).tokens.keys()])).not.toContain(token.access_token);
    const kinds = (await env.store.auditRows()).map(a => a.kind);
    expect(kinds).toEqual(["client_registered", "consent_granted", "code_issued", "token_issued"]);
    expect(JSON.stringify(await env.store.auditRows())).not.toMatch(/555|ntwa_|ntwr_|ntwc_/);
    expect(client.client_id).toMatch(/^mcp_/);
  });

  test("a wrong code_verifier is refused, and a second use of the code revokes what the first issued", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    const flow = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    const code = new URL(flow.location!).searchParams.get("code")!;
    const base = { grant_type: "authorization_code", code, redirect_uri: "https://client.example/callback", client_id: reg.body.client_id };
    const wrong = await tokenRequest(env, PEON, { ...base, code_verifier: "w".repeat(43) });
    expect(wrong.res.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");

    const flow2 = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    const code2 = new URL(flow2.location!).searchParams.get("code")!;
    const ok = await tokenRequest(env, PEON, { ...base, code: code2, code_verifier: VERIFIER });
    expect(ok.res.status).toBe(200);
    const replay = await tokenRequest(env, PEON, { ...base, code: code2, code_verifier: VERIFIER });
    expect(replay.body.error).toBe("invalid_grant");
    const after = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: ok.body.access_token });
    expect(after.res.status).toBe(401);
    expect((await env.store.auditRows()).map(a => a.kind)).toContain("code_replay");
  });

  test("PKCE is required and only S256; a bad request is an error page on this site, never a redirect", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    for (const extra of [{ code_challenge_method: "plain", code_challenge: CHALLENGE }, { code_challenge_method: "S256", code_challenge: "short" }]) {
      const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", state: "s", ...extra });
      const res = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toContain("PKCE");
    }
  });

  test("no open redirect: a freshly registered client cannot bounce a person to any page (RFC 9700 4.11.2)", async () => {
    const env = setup();
    // Before the fix: 302 to https://evil.example/landing?error=unsupported_response_type&iss=https://slop.date.
    const reg = await register(env, "slop.date", { redirect_uris: ["https://evil.example/landing"] });
    for (const bad of [{ response_type: "nope" }, { response_type: "code", code_challenge_method: "plain" }, { response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "everything" }] as Record<string, string>[]) {
      const q = new URLSearchParams({ client_id: reg.body.client_id, ...bad });
      const res = await env.fetch(new Request(`${origin("slop.date")}/oauth/authorize?${q}`));
      expect([res.status, res.headers.get("location")]).toEqual([400, null]);
    }
  });

  test("the code expires after 5 minutes", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    const flow = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    env.clock.t += 5 * 60_000 + 1;
    const r = await tokenRequest(env, PEON, { grant_type: "authorization_code", code: new URL(flow.location!).searchParams.get("code")!, redirect_uri: "https://client.example/callback", client_id: reg.body.client_id, code_verifier: VERIFIER });
    expect(r.body.error).toBe("invalid_grant");
  });

  test("a wrong texted code does not sign in; denial redirects access_denied", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "x" });
    const start = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
    const html = await start.text();
    const rid = /name="rid" value="([^"]+)"/.exec(html)![1]!;
    const cookie = /(mcp_auth=[^;]+|__Host-mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie")!)![1]!;
    const post = (path: string, form: Record<string, string>, c = cookie) => env.fetch(new Request(`${origin(PEON)}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: c }, body: new URLSearchParams({ rid, ...form }).toString() }));
    // Without the browser cookie (another browser, login CSRF): refused.
    expect(await (await post("/oauth/authorize/phone", { phone: PHONE_A }, "")).text()).toContain("expired");
    expect((await post("/oauth/authorize/phone", { phone: PHONE_A })).status).toBe(200);
    const bad = await post("/oauth/authorize/code", { code: "999999" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("did not work");
    // Approving before signing in is a denial, never a grant.
    const deny = await post("/oauth/authorize/consent", { decision: "approve" });
    expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect([...(env.store as any).grants.values()]).toHaveLength(0);
  });
});

describe("redirect URI rules", () => {
  test("https only, http only for loopback, no fragments, wildcards or custom schemes", () => {
    for (const ok of ["https://client.example/cb", "http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/cb", "https://chatgpt.com/connector_platform_oauth_redirect"]) expect(redirectUriAllowed(ok)).toBe(true);
    for (const bad of ["http://client.example/cb", "https://client.example/cb#x", "https://*.example/cb", "myapp://cb", "javascript:alert(1)", "https://user:pw@client.example/cb", "/relative", "http://localhost.evil.example/cb"]) expect(redirectUriAllowed(bad)).toBe(false);
  });

  test("registration refuses a bad URI; authorize never redirects to an unregistered URI", async () => {
    const env = setup();
    const bad = await register(env, PEON, { redirect_uris: ["http://client.example/cb"] });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe("invalid_redirect_uri");
    const reg = await register(env, PEON, { redirect_uris: ["https://client.example/callback", "https://client.example/other"] });
    expect(reg.res.status).toBe(201);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://evil.example/steal", code_challenge: CHALLENGE, code_challenge_method: "S256" });
    const res = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    // Two registered URIs and none named: no guess.
    const q2 = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, code_challenge: CHALLENGE, code_challenge_method: "S256" });
    expect((await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q2}`))).headers.get("location")).toBeNull();
  });

  test("a client registered on one site is unknown on another", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256" });
    const res = await env.fetch(new Request(`${origin(SLOP)}/oauth/authorize?${q}`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("not registered on this site");
  });
});

describe("token expiry and refresh rotation", () => {
  test("access tokens expire; refresh rotates; a reused refresh token ends the grant", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const { client, token } = await connect(env, PEON, PHONE_A);
    const url = `${origin(PEON)}/mcp`;
    env.clock.t += 15 * 60_000 + 1;
    const expired = await call(env, url, "check_status", {}, { token: token.access_token });
    expect(expired.res.status).toBe(401);
    expect(expired.res.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const r1 = await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: client.client_id });
    expect(r1.res.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(token.refresh_token);
    expect((await call(env, url, "check_status", {}, { token: r1.body.access_token })).body!.result.structuredContent.status).toBe("active");

    const replay = await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: client.client_id });
    expect(replay.body.error).toBe("invalid_grant");
    // The whole grant ended: the newest tokens are dead too.
    expect((await call(env, url, "check_status", {}, { token: r1.body.access_token })).res.status).toBe(401);
    expect((await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: client.client_id })).body.error).toBe("invalid_grant");
    expect((await env.store.auditRows()).map(a => a.kind)).toEqual(expect.arrayContaining(["token_refreshed", "refresh_replay"]));
  });

  test("another client cannot use the refresh token; revocation ends the grant", async () => {
    const env = setup();
    const a = await connect(env, PEON, PHONE_A);
    const other = await register(env, PEON);
    expect((await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: a.token.refresh_token, client_id: other.body.client_id })).body.error).toBe("invalid_grant");
    const rev = await env.fetch(new Request(`${origin(PEON)}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: a.token.refresh_token, client_id: a.client.client_id }).toString() }));
    expect(rev.status).toBe(200);
    expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: a.token.access_token })).res.status).toBe(401);
    expect((await env.store.auditRows()).map(x => x.kind)).toContain("token_revoked");
  });

  test("a confidential client must authenticate with its registered method", async () => {
    const env = setup();
    const reg = await register(env, PEON, { token_endpoint_auth_method: "client_secret_basic" });
    expect(reg.body.client_secret).toMatch(/^ntws_/);
    const flow = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    const form = { grant_type: "authorization_code", code: new URL(flow.location!).searchParams.get("code")!, redirect_uri: "https://client.example/callback", code_verifier: VERIFIER };
    const post = await tokenRequest(env, PEON, { ...form, client_id: reg.body.client_id, client_secret: reg.body.client_secret });
    expect(post.res.status).toBe(401);
    const basic = `Basic ${Buffer.from(`${reg.body.client_id}:${reg.body.client_secret}`).toString("base64")}`;
    const wrong = await tokenRequest(env, PEON, form, { authorization: `Basic ${Buffer.from(`${reg.body.client_id}:nope`).toString("base64")}` });
    expect(wrong.res.status).toBe(401);
    // The code was spent by the attempts above only if the client authenticated; it was not.
    const ok = await tokenRequest(env, PEON, form, { authorization: basic });
    expect(ok.res.status).toBe(200);
  });
});

describe("scopes", () => {
  test("apps:read only: check_status answers 403 insufficient_scope; refresh cannot widen", async () => {
    const env = setup();
    const { client, token } = await connect(env, PEON, PHONE_A, { scope: "apps:read" });
    expect(token.scope).toBe("apps:read");
    const r = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: token.access_token });
    expect(r.res.status).toBe(403);
    const h = r.res.headers.get("www-authenticate")!;
    expect(h).toContain('error="insufficient_scope"');
    expect(h).toContain('scope="membership:read"');
    expect(h).toContain('resource_metadata="https://peon.biz/.well-known/oauth-protected-resource/mcp"');
    const wider = await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: client.client_id, scope: "apps:read membership:read" });
    expect(wider.body.error).toBe("invalid_scope");
    // app_info needs no scope.
    expect((await call(env, `${origin(PEON)}/mcp`, "app_info", { app: "peon" }, { token: token.access_token })).body!.result.isError).toBe(false);
  });

  test("an unknown scope is refused at authorize", async () => {
    const env = setup();
    const reg = await register(env, PEON);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "membership:read messages:read" });
    const res = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
    expect([res.status, res.headers.get("location")]).toEqual([400, null]);
    expect(await res.text()).toContain("scope");
  });
});

describe("check_status isolation across apps", () => {
  test("a peon grant sees peon only, never slop; a token from one site is refused on another", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }, { app: "peon", state: "paused" }]);
    const peon = await connect(env, PEON, PHONE_A);
    const url = `${origin(PEON)}/mcp`;
    const r = await call(env, url, "check_status", {}, { token: peon.token.access_token });
    expect(r.body!.result.structuredContent).toMatchObject({ app: "peon", status: "stopped" });
    expect(r.text).not.toMatch(/slop/i);
    const asked = await call(env, url, "check_status", { app: "slop" }, { token: peon.token.access_token });
    expect(asked.body!.result.isError).toBe(true);
    expect(asked.text).not.toMatch(/active/);
    // RFC 8707: the peon token is not valid at slop.date.
    expect((await call(env, `${origin(SLOP)}/mcp`, "check_status", {}, { token: peon.token.access_token })).res.status).toBe(401);
    // Nor at the other surface of the same site.
    expect((await call(env, `${origin(NTWRK)}/mcp/openai`, "check_status", {}, { token: peon.token.access_token })).res.status).toBe(401);
  });

  test("a person in slop only is not_joined on peon (nothing tells that they use slop)", async () => {
    const env = setup();
    await addMember(env, PHONE_B, [{ app: "slop", state: "active" }]);
    const peon = await connect(env, PEON, PHONE_B);
    const r = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: peon.token.access_token });
    expect(r.body!.result.structuredContent.status).toBe("not_joined");
    const none = setup();
    const peon2 = await connect(none, PEON, PHONE_B);
    const r2 = await call(none, `${origin(PEON)}/mcp`, "check_status", {}, { token: peon2.token.access_token });
    expect(JSON.stringify(r2.body!.result.structuredContent)).toBe(JSON.stringify(r.body!.result.structuredContent));
  });

  test("a number that changed owner kills the old grant", async () => {
    const env = setup();
    const oldId = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, PEON, PHONE_A);
    // Staff decided new_owner: the old person is gone and the number starts clean with a new person.
    await (env.people as PeopleStore).setPhoneHold(PHONE_A, "recycled_number", env.clock.t);
    expect(await env.accounts.clearHold(PHONE_A, "new_owner")).toBe(true);
    const newId = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    // The new owner is a new person: the old owner's tombstone is never revived for them.
    expect(newId).not.toBe(oldId);
    const r = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: c.token.access_token });
    expect(r.res.status).toBe(401);
  });

  test("a held number (may have a new owner) cannot sign in", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    await (env.people as PeopleStore).setPhoneHold(PHONE_A, "recycled_number", env.clock.t);
    const reg = await register(env, PEON);
    const flow = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    expect(flow.location).toBeNull();
    expect(flow.html).toContain("We need to check this number");
  });
});

describe("banned numbers", () => {
  test("a banned number gets no code and cannot sign in or hold a grant (the page answers as for any number)", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "restricted" }]);
    const personId = (await env.accounts.personFor(PHONE_A))!.id;
    await (env.people as PeopleStore).ban({ id: "ban_1", scope: "person", personId, phoneHash: null, reason: "staff", reportId: null, bannedBy: "staff:1", at: env.clock.t });
    const sends = env.provider.sent.length;
    const reg = await register(env, PEON);
    const flow = await browserFlow(env, PEON, reg.body.client_id, PHONE_A);
    // Before the fix: a code was sent, sign-in worked, and the grant read "on_hold".
    expect(env.provider.sent.length).toBe(sends);
    expect(flow.location).toBeNull();
  });
});

describe("the person's consent records", () => {
  test("listed on the site and revocable by the person only, from the site itself", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, PEON, PHONE_A);
    const site = /sid_peon=[^;]+/.exec(c.flow.siteCookie!)![0];
    const list = await env.fetch(new Request(`${origin(PEON)}/oauth/consents`, { headers: { cookie: site } }));
    const html = await list.text();
    expect(html).toContain("Test Assistant");
    const grantId = /name="grant" value="([^"]+)"/.exec(html)![1]!;
    const post = (o: string) => env.fetch(new Request(`${origin(PEON)}/oauth/consents/revoke`, { method: "POST", headers: { cookie: site, origin: o, "content-type": "application/x-www-form-urlencoded" }, body: `grant=${grantId}` }));
    expect((await post("https://evil.example")).status).toBe(403);
    expect(await (await post(origin(PEON))).text()).toContain("Access removed.");
    expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: c.token.access_token })).res.status).toBe(401);
    expect((await env.fetch(new Request(`${origin(PEON)}/oauth/consents`))).status).toBe(401);
  });

  test("a signed-in site session skips the code step; revokeAllFor ends every grant of a phone", async () => {
    const env = setup();
    const c = await connect(env, PEON, PHONE_A);
    const site = /sid_peon=[^;]+/.exec(c.flow.siteCookie!)![0];
    const sends = env.provider.sent.length;
    const again = await connect(env, PEON, PHONE_A, { cookie: site });
    expect(env.provider.sent.length).toBe(sends);
    expect(await env.handler.revokeAllFor(PHONE_A)).toBe(2);
    for (const t of [c.token, again.token]) expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: t.access_token })).res.status).toBe(401);
  });

  test("leaving an app deletes the grants that keep the phone next to it; sweep deletes old grants and unused clients", async () => {
    const env = setup();
    const store = env.store as MemoryOAuthStore;
    await connect(env, PEON, PHONE_A);
    await connect(env, PEON, PHONE_B);
    const unused = await register(env, PEON);
    // Before the fix: revoked grants kept the phone (and the app) forever.
    expect(await env.handler.revokeAllFor(PHONE_A, "peon", { forget: true })).toBe(1);
    expect([...store.grants.values()].map(g => g.phoneKey)).toEqual([env.accounts.phoneHash(PHONE_B)]);
    // No grant keeps the number itself: only the platform's keyed hash (audit: oauth phone).
    expect(JSON.stringify([...store.grants.values()])).not.toContain(PHONE_B.slice(2));
    expect([...store.requests.values()].some(r => r.e164 === PHONE_A)).toBe(false);
    // A revoked grant is deleted after GRANT_KEEP_MS; a client that never got a grant after CLIENT_UNUSED_MS.
    await env.handler.revokeAllFor(PHONE_B, "peon");
    await store.sweep(env.clock.t + CLIENT_UNUSED_MS);
    expect(store.clients.has(unused.body.client_id)).toBe(false);
    expect(store.grants.size).toBe(1);
    await store.sweep(env.clock.t + GRANT_KEEP_MS);
    expect(store.grants.size).toBe(0);
    expect(store.tokens.size).toBe(0);
  });
});

describe("abuse limits", () => {
  test("registration and MCP calls are rate-limited per IP; OTP limits are the platform's", async () => {
    const env = setup({ limits: { registerPerIpHour: 2, mcpPerIpMinute: 3 } });
    expect((await register(env, PEON)).res.status).toBe(201);
    expect((await register(env, PEON)).res.status).toBe(201);
    expect((await register(env, PEON)).res.status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await rpc(env, `${origin(PEON)}/mcp`, "tools/list")).res.status).toBe(200);
    expect((await rpc(env, `${origin(PEON)}/mcp`, "tools/list")).res.status).toBe(429);
  });

  test("the code page says the same for any number (no enumeration)", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const reg = await register(env, PEON);
    const page = async (phone: string) => {
      const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256" });
      const start = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
      const rid = /name="rid" value="([^"]+)"/.exec(await start.text())![1]!;
      const cookie = /(mcp_auth=[^;]+|__Host-mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie")!)![1]!;
      const res = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize/phone`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ rid, phone }).toString() }));
      return (await res.text()).replaceAll(rid, "RID").replace(/\d{4}\b(?= a code)|ending in \d{4}/, "ending in XXXX");
    };
    expect(await page(PHONE_A)).toBe(await page(PHONE_B));
  });
});

describe("dev and proxy host rules", () => {
  test("the site host and IP are trusted only with a valid router signature", async () => {
    const env = setup({ proxySecret: "s3cret" });
    const url = "https://api.internal/.well-known/oauth-authorization-server";
    const req = (h: Record<string, string>) => env.fetch(new Request(url, { headers: h }));
    expect((await req({ "x-forwarded-host": "slop.date" })).status).toBe(404);
    const facts = { method: "GET", path: "/.well-known/oauth-authorization-server", host: "slop.date", ip: "203.0.113.9", ts: Math.floor(env.clock.t / 1000) };
    const forged = await signProxyHeaders("wrong", facts);
    expect((await req(forged)).status).toBe(404);
    const ok = await req(await signProxyHeaders("s3cret", facts));
    expect(((await ok.json()) as any).issuer).toBe("https://slop.date");
    // A signature older than 60 s is refused (replay).
    env.clock.t += 61_000;
    expect((await req(await signProxyHeaders("s3cret", facts))).status).toBe(404);
  });

  test("an http issuer is refused unless it is a loopback host", () => {
    expect(() => setup({ issuer: "http://ntwrk.love" })).toThrow(/https/);
    expect(() => setup({ issuer: "http://127.0.0.1:4849" })).not.toThrow();
  });
});

describe("Client ID Metadata Documents", () => {
  const CID = "https://client.example/oauth/client.json";
  const doc = { client_id: CID, client_name: "Doc Client", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none" };
  const fakeFetch = (body: unknown, seen: string[] = []) => (async (u: string | URL | Request) => { seen.push(String(u)); return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;

  test("an https client_id is fetched (fake fetch), checked, and works without registration", async () => {
    const seen: string[] = [];
    const env = setup({ cimdFetch: fakeFetch(doc, seen) });
    const meta = await (await env.fetch(new Request(`${origin(PEON)}/.well-known/oauth-authorization-server`))).json() as Record<string, any>;
    expect(meta.client_id_metadata_document_supported).toBe(true);
    const flow = await browserFlow(env, PEON, CID, PHONE_A);
    expect(flow.html).toContain("Doc Client");
    const code = new URL(flow.location!).searchParams.get("code")!;
    const t = await tokenRequest(env, PEON, { grant_type: "authorization_code", code, redirect_uri: "https://client.example/callback", client_id: CID, code_verifier: VERIFIER });
    expect(t.res.status).toBe(200);
    expect(seen).toEqual([CID]);
  });

  test("a document for another client_id, a private host or a bad redirect URI is refused; CIMD is off by default", async () => {
    for (const [cid, body] of [
      [CID, { ...doc, client_id: "https://other.example/c.json" }],
      [CID, { ...doc, redirect_uris: ["http://client.example/cb"] }],
      ["https://127.0.0.1/c.json", { ...doc, client_id: "https://127.0.0.1/c.json" }],
      ["https://client.example/", { ...doc, client_id: "https://client.example/" }],
    ] as const) {
      const env = setup({ cimdFetch: fakeFetch(body) });
      const flow = await browserFlow(env, PEON, cid, PHONE_A);
      expect(flow.location).toBeNull();
      expect(flow.html).toContain("not registered on this site");
    }
    const off = setup();
    expect((await browserFlow(off, PEON, CID, PHONE_A)).location).toBeNull();
  });
});

describe("a grant made before the number had a person (audit: null-person grant)", () => {
  test("does not follow a person created later; that person connects again", async () => {
    const env = setup();
    const c = await connect(env, PEON, PHONE_A);
    const before = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: c.token.access_token });
    expect(before.body!.result.structuredContent.status).toBe("not_joined");
    // Before the fix the same token then read the new person's status ("active").
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const after = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: c.token.access_token });
    expect(after.res.status).toBe(401);
    const again = await connect(env, PEON, PHONE_A);
    const fresh = await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: again.token.access_token });
    expect(fresh.body!.result.structuredContent.status).toBe("active");
  });
});
