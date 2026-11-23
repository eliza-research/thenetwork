// OAuth 2.1 against the handler with the real platform OTP and a fake provider (no texts are sent).
import { describe, expect, test } from "vitest";
import type { PeopleStore } from "@thenetwork/platform";
import { signProxyHeaders } from "@thenetwork/platform/src/proxy.ts";
import { redirectUriAllowed } from "../src/handler.ts";
import { CLIENT_UNUSED_MS, GRANT_KEEP_MS, MemoryOAuthStore, type Grant } from "../src/store.ts";
import { addMember, browserFlow, call, CHALLENGE, connect, origin, PHONE_A, PHONE_B, register, rpc, setup, tokenRequest, VERIFIER, type Env } from "./harness.ts";

const SLOP = "slop.date", PEON = "peon.biz", NTWRK = "ntwrk.party";

describe("metadata", () => {
  test("each site is its own issuer and resource; S256 only; iss in responses", async () => {
    const env = setup();
    const as = await (await env.fetch(new Request(`${origin(PEON)}/.well-known/oauth-authorization-server`))).json() as Record<string, any>;
    expect(as.issuer).toBe("https://peon.biz");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.scopes_supported).toEqual(["apps:read", "membership:read", "profile:write", "profile:read"]);
    expect(as.registration_endpoint).toBe("https://peon.biz/oauth/register");
    const prm = await (await env.fetch(new Request(`${origin(PEON)}/.well-known/oauth-protected-resource/mcp`))).json() as Record<string, any>;
    expect(prm).toMatchObject({ resource: "https://peon.biz/mcp", authorization_servers: ["https://peon.biz"], bearer_methods_supported: ["header"] });
    expect(prm.scopes_supported).not.toContain("offline_access");
    const openai = await (await env.fetch(new Request(`${origin(NTWRK)}/.well-known/oauth-protected-resource/mcp/openai`))).json() as Record<string, any>;
    expect(openai.resource).toBe("https://ntwrk.party/mcp/openai");
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
    // Approval cannot bypass phone verification.
    expect((await post("/oauth/authorize/consent", { decision: "approve" })).status).toBe(400);
    // Cancellation before signing in never grants access.
    const deny = await post("/oauth/authorize/cancel", {});
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

  test("a request that names only a scope the site does not offer is refused with invalid_scope and never gets a grant with no scope", async () => {
    const env = setup();
    const registered = await register(env, PEON, { scope: "photos:use" });
    expect([registered.res.status, registered.body.error]).toEqual([400, "invalid_client_metadata"]);
    const reg = await register(env, PEON);
    const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "photos:use" });
    const res = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
    expect([res.status, res.headers.get("location")]).toEqual([400, null]);
    expect(await res.text()).toContain("scope");
    const { client, token } = await connect(env, PEON, PHONE_A);
    const narrowed = await tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: token.refresh_token, client_id: client.client_id, scope: "photos:use" });
    expect(narrowed.body.error).toBe("invalid_scope");
  });
});

describe("slop.date photo tools (owner decision 2026-11-22)", () => {
  const PHOTOS = "apps:read membership:read profile:write photos:use";
  const holdings = (calls: string[]) => async (personId: string) => {
    calls.push(personId);
    return {
      text: "You have 2 photos with me: 1 \"beach\" (Mon 2 Nov), Maya has it; 2 (Sat 14 Nov). See them: https://slop.date/photos/mine#tok",
      photos: [
        { number: 1, name: "beach", addedOn: "2026-11-02", sharedWith: [{ firstName: "Maya", state: "ready" as const }], id: "photo-row-1", url: "https://slop.date/photos/view#secret", sha256: "a".repeat(64) },
        { number: 2, name: null, addedOn: "2026-11-14", sharedWith: [] },
      ],
    };
  };

  test("the photo tools are listed only on the slop.date full surface", async () => {
    const env = setup();
    const names = async (url: string) => ((await rpc(env, url, "tools/list")).body!.result.tools as { name: string }[]).map(t => t.name);
    expect(await names(`${origin(SLOP)}/mcp`)).toEqual(expect.arrayContaining(["my_photos", "photo_request"]));
    for (const url of [`${origin(NTWRK)}/mcp`, `${origin(NTWRK)}/mcp/openai`, `${origin(PEON)}/mcp`, `${origin("friends.help")}/mcp`]) {
      const listed = await names(url);
      expect(listed).toContain("check_status");
      expect(listed.filter(n => n === "my_photos" || n === "photo_request")).toEqual([]);
    }
  });

  test("only slop.date offers photos:use: the other sites leave it out of their metadata and drop it from a request", async () => {
    const env = setup();
    const slopAs = await (await env.fetch(new Request(`${origin(SLOP)}/.well-known/oauth-authorization-server`))).json() as Record<string, any>;
    expect(slopAs.scopes_supported).toEqual(["apps:read", "membership:read", "profile:write", "profile:read", "photos:use"]);
    const slopPrm = await (await env.fetch(new Request(`${origin(SLOP)}/.well-known/oauth-protected-resource/mcp`))).json() as Record<string, any>;
    expect(slopPrm.scopes_supported).toContain("photos:use");
    for (const site of [PEON, NTWRK, "friends.help"]) {
      const as = await (await env.fetch(new Request(`${origin(site)}/.well-known/oauth-authorization-server`))).json() as Record<string, any>;
      expect(as.scopes_supported).toEqual(["apps:read", "membership:read", "profile:write", "profile:read"]);
      const prm = await (await env.fetch(new Request(`${origin(site)}/.well-known/oauth-protected-resource/mcp`))).json() as Record<string, any>;
      expect(prm.scopes_supported).not.toContain("photos:use");
    }
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const { token } = await connect(env, PEON, PHONE_A, { scope: PHOTOS });
    expect(token.scope).toBe("apps:read membership:read profile:write");
  });

  test("a default grant does not hold photos:use, so my_photos answers 403 with the photos scope and the platform is never asked", async () => {
    const calls: string[] = [];
    const env = setup({ photoHoldings: holdings(calls) });
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }]);
    const { token } = await connect(env, SLOP, PHONE_A);
    expect(token.scope).toBe("apps:read membership:read profile:write");
    const r = await call(env, `${origin(SLOP)}/mcp`, "my_photos", {}, { token: token.access_token });
    expect(r.res.status).toBe(403);
    const h = r.res.headers.get("www-authenticate")!;
    expect(h).toContain('error="insufficient_scope"');
    expect(h).toContain('scope="photos:use"');
    expect(calls).toEqual([]);
  });

  test("my_photos returns numbers, names, days and first names only, never an id, a link or a hash", async () => {
    const calls: string[] = [];
    const env = setup({ photoHoldings: holdings(calls) });
    const personId = await addMember(env, PHONE_A, [{ app: "slop", state: "active" }]);
    const { token } = await connect(env, SLOP, PHONE_A, { scope: PHOTOS });
    expect(token.scope).toBe(PHOTOS);
    const r = await call(env, `${origin(SLOP)}/mcp`, "my_photos", {}, { token: token.access_token });
    expect(r.res.status).toBe(200);
    expect(r.body!.result.isError).toBe(false);
    expect(r.body!.result.structuredContent).toEqual({
      app: "slop",
      text: expect.not.stringContaining("http"),
      photos: [
        { number: 1, name: "beach", addedOn: "2026-11-02", sharedWith: [{ firstName: "Maya", state: "ready" }] },
        { number: 2, name: null, addedOn: "2026-11-14", sharedWith: [] },
      ],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/photo-row|https?:|#secret|#tok|[0-9a-f]{64}/);
    expect(calls).toEqual([personId]);
  });

  test("a slop.date member under 18 gets no photo list, and the platform is never asked", async () => {
    const calls: string[] = [];
    const env = setup({ photoHoldings: holdings(calls) });
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }], 16);
    const { token } = await connect(env, SLOP, PHONE_A, { scope: PHOTOS });
    const r = await call(env, `${origin(SLOP)}/mcp`, "my_photos", {}, { token: token.access_token });
    expect(r.body!.result.structuredContent).toEqual({ app: "slop", text: "Photos are not available for this person here.", photos: [] });
    expect(calls).toEqual([]);
  });

  test("photo_request passes the person's own words and answers without a link; it takes no photo id", async () => {
    const asked: string[] = [];
    const env = setup({
      photoRequest: async (_personId, _app, _e164, words) => {
        asked.push(words);
        return { status: "texted", text: "Send Maya photo 1 \"beach\" (Mon 2 Nov)? See it: https://slop.date/photos/check#t Reply YES to send it." };
      },
    });
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }]);
    const { token } = await connect(env, SLOP, PHONE_A, { scope: PHOTOS });
    const r = await call(env, `${origin(SLOP)}/mcp`, "photo_request", { words: "send Maya the beach one" }, { token: token.access_token });
    expect(r.body!.result.structuredContent).toEqual({ app: "slop", status: "texted", text: "I texted the person the photo to check. They reply YES to that text to send it." });
    expect(asked).toEqual(["send Maya the beach one"]);
    const withId = await call(env, `${origin(SLOP)}/mcp`, "photo_request", { words: "send Maya photo 1", photo_id: "photo-1" }, { token: token.access_token });
    expect(withId.body!.result.isError).toBe(true);
    expect(asked).toEqual(["send Maya the beach one"]);
  });

  test("photo_request takes a list of photo numbers written with spaces, and still refuses a phone number written the same way", async () => {
    const asked: string[] = [];
    const env = setup({
      photoRequest: async (_personId, _app, _e164, words) => {
        asked.push(words);
        return { status: "texted", text: "" };
      },
    });
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }]);
    const { token } = await connect(env, SLOP, PHONE_A, { scope: PHOTOS });
    const listed = await call(env, `${origin(SLOP)}/mcp`, "photo_request", { words: "send her photos 1 3 4 5" }, { token: token.access_token });
    expect(listed.body!.result.isError).toBe(false);
    expect(listed.body!.result.structuredContent).toMatchObject({ app: "slop", status: "texted" });
    for (const words of ["send her photo 5 5 5 1 2 3 4", "send her photos 1 2 3 4 5 6 7 8 9", "send her photos 1 2 3 4 then 555 0199"]) {
      const phone = await call(env, `${origin(SLOP)}/mcp`, "photo_request", { words }, { token: token.access_token });
      expect(phone.body!.result.isError).toBe(true);
    }
    expect(asked).toEqual(["send her photos 1 3 4 5"]);
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

  test("AE-2 a banned number reaches the code limit at the same start as any number, and still gets no code", async () => {
    const pages = async (phone: string) => {
      const env = setup();
      await env.people.ban({ id: "ban_ae2", scope: "phone", personId: null, phoneHash: env.accounts.phoneHash(PHONE_A), reason: "staff", reportId: null, bannedBy: "staff:1", at: env.clock.t });
      const reg = await register(env, PEON);
      const limited: boolean[] = [];
      for (let i = 0; i < 4; i++) limited.push((await browserFlow(env, PEON, reg.body.client_id, phone)).html.includes("Too many codes were asked for"));
      return { limited, sent: env.provider.sent.filter(s => s.e164 === phone).length };
    };
    const banned = await pages(PHONE_A), plain = await pages(PHONE_B);
    expect(banned.limited).toEqual([false, false, false, true]);
    expect(banned.limited).toEqual(plain.limited);
    expect([banned.sent, plain.sent]).toEqual([0, 3]);
  });
});

describe("the person's consent records", () => {
  // spec/connectedAssistants.md, "A confirmed removal shows its result"
  test("lists the current person's grants and requires the exact browser confirmation to remove one", async () => {
    const env = setup();
    const personId = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, PEON, PHONE_A);
    const site = /sid_peon=[^;]+/.exec(c.flow.siteCookie!)![0];
    const page = (path = "", cookie = site) => env.fetch(new Request(`${origin(PEON)}/oauth/consents${path}`, { headers: { cookie } }));
    const [grant] = await env.store.grantsFor(env.accounts.phoneHash(PHONE_A), "peon", env.clock.t);
    expect(grant?.personId).toBe(personId);
    const former = { ...grant!, id: "earlier-owner-grant", personId: "earlier-owner" };
    await env.store.putGrant(former);
    const html = await (await page()).text();
    expect(html).toContain("Test Assistant");
    expect(html).not.toContain(former.id);
    expect(html).not.toContain('name="grant"');
    const chosen = /name="remove" value="([^"]+)"/.exec(html)![1]!;
    const confirmPath = `?remove=${encodeURIComponent(chosen)}`;
    const getProof = async () => {
      const confirm = await (await page(confirmPath)).text();
      expect(confirm).toContain(`name="grant" value="${chosen}"`);
      expect(confirm).toContain("Keep access");
      return /name="confirmation" value="([^"]+)"/.exec(confirm)![1]!;
    };
    const post = (id: string, confirmation?: string, o = origin(PEON), cookie = site) => env.fetch(new Request(`${origin(PEON)}/oauth/consents/revoke`, {
      method: "POST", headers: { cookie, origin: o, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: id, ...(confirmation ? { confirmation } : {}) }),
    }));
    expect(await (await page(`?remove=${former.id}`)).text()).not.toContain('name="confirmation"');
    expect(await (await post(chosen)).text()).not.toContain("Access removed.");
    const proof = await getProof();
    expect((await post(chosen, proof, "https://evil.example")).status).toBe(403);
    expect(await (await post(former.id, proof)).text()).not.toContain("Access removed.");
    const anotherSession = await env.sessions.create("peon", PHONE_A, personId);
    expect(await (await post(chosen, proof, origin(PEON), `sid_peon=${anotherSession.token}`)).text()).not.toContain("Access removed.");
    env.clock.t += 5 * 60_000;
    expect(await (await post(chosen, proof)).text()).not.toContain("Access removed.");
    expect(await env.store.getGrant(chosen)).toMatchObject({ revokedAt: null });
    const current = await getProof();
    expect(await (await post(chosen, current)).text()).toContain("Access removed.");
    expect(await (await post(chosen, current)).text()).not.toContain("Access removed.");
    expect(await env.store.getGrant(former.id)).toMatchObject({ revokedAt: null });
    expect((await env.store.auditRows()).filter(row => row.kind === "consent_revoked").map(row => row.grantId)).toEqual([chosen]);
    expect((await call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token: c.token.access_token })).res.status).toBe(401);
    expect((await page("", "")).status).toBe(401);
  });

  test("a removal confirmation ends when its grant expires before five minutes", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(env, PEON, PHONE_A);
    const cookie = /sid_peon=[^;]+/.exec(c.flow.siteCookie!)![0];
    const [live] = await env.store.grantsFor(env.accounts.phoneHash(PHONE_A), "peon", env.clock.t);
    const expiresAt = env.clock.t + 60_000;
    const grant = { ...live!, id: "short-lived-consent", expiresAt };
    await env.store.putGrant(grant);
    const response = await env.fetch(new Request(`${origin(PEON)}/oauth/consents?remove=${grant.id}`, { headers: { cookie } }));
    const confirmation = /name="confirmation" value="([^"]+)"/.exec(await response.text())?.[1];
    expect(confirmation?.split(".")[0]).toBe(String(expiresAt));
    env.clock.t = expiresAt;
    const expired = await env.fetch(new Request(`${origin(PEON)}/oauth/consents/revoke`, {
      method: "POST", headers: { cookie, origin: origin(PEON), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: grant.id, confirmation: confirmation! }),
    }));
    expect((await expired.text()).includes("Access removed.")).toBe(false);
    expect(await env.store.getGrant(grant.id)).toMatchObject({ revokedAt: null });
    expect(await env.store.getGrant(live!.id)).toMatchObject({ revokedAt: null });
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

  test("spec/connectorTools.md, \"Request limits count each person's grant, and the client address has only a coarse ceiling\": people behind one assistant address keep their own MCP and token budgets", async () => {
    const env = setup({ limits: { mcpPerIpMinute: 2, mcpPerGrantMinute: 3, tokenPerGrantMinute: 2 } });
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    await addMember(env, PHONE_B, [{ app: "peon", state: "active" }]);
    const a = await connect(env, PEON, PHONE_A);
    const b = await connect(env, PEON, PHONE_B);
    const status = (token: string) => call(env, `${origin(PEON)}/mcp`, "check_status", {}, { token });
    for (let i = 0; i < 3; i++) expect((await status(a.token.access_token)).res.status).toBe(200);
    expect((await status(a.token.access_token)).res.status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await status(b.token.access_token)).body!.result.structuredContent).toMatchObject({ app: "peon", status: "active" });
    for (let i = 0; i < 2; i++) expect((await rpc(env, `${origin(PEON)}/mcp`, "tools/list")).res.status).toBe(200);
    expect((await rpc(env, `${origin(PEON)}/mcp`, "tools/list")).res.status).toBe(429);
    const refresh = (c: typeof a, refreshToken: string) =>
      tokenRequest(env, PEON, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: c.client.client_id });
    env.clock.t = Math.ceil(env.clock.t / 60_000) * 60_000;
    let aRefresh = a.token.refresh_token;
    for (let i = 0; i < 2; i++) {
      const refreshed = await refresh(a, aRefresh);
      expect(refreshed.res.status).toBe(200);
      aRefresh = refreshed.body.refresh_token;
    }
    expect((await refresh(a, aRefresh)).res.status).toBe(429);
    expect((await refresh(b, b.token.refresh_token)).res.status).toBe(200);
  });

  test("assistant client registrations from one address have their own hourly limit", async () => {
    const env = setup({ limits: { registerPerIpHour: 1, registerAssistantPerIpHour: 3 } });
    const claude = { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    for (let i = 0; i < 3; i++) expect((await register(env, PEON, claude)).res.status).toBe(201);
    expect((await register(env, PEON, claude)).res.status).toBe(429);
    expect((await register(env, PEON)).res.status).toBe(201);
    expect((await register(env, PEON)).res.status).toBe(429);
    const mixed = setup({ limits: { registerPerIpHour: 1, registerAssistantPerIpHour: 3 } });
    const both = { redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://attacker.example/cb"] };
    expect((await register(mixed, PEON, both)).res.status).toBe(201);
    expect((await register(mixed, PEON, both)).res.status).toBe(429);
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
      return (await res.text()).replaceAll(rid, "RID").replace(/Sent to ••• \d{4}/, "Sent to ••• XXXX");
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
    expect(() => setup({ issuer: "http://ntwrk.party" })).toThrow(/https/);
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
    expect(flow.status).toBe(303);
    expect((await env.store.getClient(CID))?.name).toBe("Doc Client");
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

describe("explicit client approval boundary", () => {
  const DOMAIN = "peon.biz";
  const BASE = origin(DOMAIN);
  const SCOPES = "membership:read profile:write";
  async function member(env: Env, phone = PHONE_A) {
    const personId = await addMember(env, phone, [{ app: "peon", state: "active" }]);
    const { token } = await env.sessions.create("peon", phone, personId);
    return { personId, cookie: `sid_peon=${token}` };
  }
  async function begin(env: Env, clientId: string, site = "", scope = SCOPES) {
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://client.example/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", scope, state: "connection-state" });
    const response = await env.fetch(new Request(`${BASE}/oauth/authorize?${query}`, { headers: { cookie: site } }));
    const html = await response.text();
    const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const rid = /name="rid" value="([^"]+)"/.exec(html)?.[1] ?? "";
    return { response, html, rid, cookie: [browser, site].filter(Boolean).join("; ") };
  }
  function post(env: Env, path: string, rid: string, cookie: string, form: Record<string, string>, from = BASE) {
    return env.fetch(new Request(BASE + path, { method: "POST", headers: { cookie, origin: from, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ rid, ...form }) }));
  }
  function noIssuedAccess(env: Env, grants = 0) {
    const store = env.store as MemoryOAuthStore;
    expect(store.grants.size).toBe(grants);
    expect(store.codes.size).toBe(0);
    expect(store.rows.filter(r => r.kind === "consent_granted" || r.kind === "code_issued")).toHaveLength(0);
  }
  async function priorApproval(env: Env, clientId: string, personId: string, scopes: Grant["scopes"]) {
    const grant: Grant = { id: "grant_existing_approval", clientId, app: "peon", phoneKey: env.accounts.phoneHash(PHONE_A), personId, scopes, resource: `${BASE}/mcp`, createdAt: env.clock.t, expiresAt: env.clock.t + 86_400_000, revokedAt: null };
    await env.store.putGrant(grant);
    return grant;
  }

  test("a session outage on an OTP app retries the same request in the same browser", async () => {
    let available = false;
    let transportFailure = false;
    let siteToken = "";
    let env: Env;
    env = setup({ authenticatedSiteSession: async app => {
      if (transportFailure) throw new Error("session service is unavailable");
      return available ? env.sessions.authenticate(app, siteToken) : "unavailable";
    } });
    const who = await member(env);
    siteToken = who.cookie.slice("sid_peon=".length);
    const client = await register(env, DOMAIN);
    const started = await begin(env, client.body.client_id, who.cookie);
    expect(started.response.status).toBe(503);
    const retry = /href="(\/oauth\/retry\?rid=([A-Za-z0-9_-]+))"/.exec(started.html);
    if (!retry) throw new Error("missing same-request retry link");
    const [, path, rid] = retry;
    const fetchRetry = (cookie: string, base = BASE, route = path) => env.fetch(new Request(base + route, { headers: { cookie } }));
    expect((await fetchRetry(who.cookie)).status).toBe(400);
    expect((await fetchRetry(started.cookie, origin(SLOP))).status).toBe(400);
    transportFailure = true;
    const stillUnavailable = await fetchRetry(started.cookie);
    expect(stillUnavailable.status).toBe(503);
    expect(await stillUnavailable.text()).toContain(`href="${path}"`);

    transportFailure = false;
    available = true;
    const boundBrowserOnly = started.cookie.replace(`; ${who.cookie}`, "");
    const phonePage = await fetchRetry(boundBrowserOnly);
    expect(phonePage.status).toBe(200);
    expect(await phonePage.text()).toContain(`name="rid" value="${rid}"`);
    expect((await fetchRetry(boundBrowserOnly, BASE, `/oauth/cloud-return?rid=${rid}`)).status).toBe(200);
    expect(await env.store.getAuthRequest(rid!)).toMatchObject({ step: "phone", e164: null });

    const consent = await fetchRetry(started.cookie);
    expect(consent.status).toBe(200);
    expect(consent.headers.get("location")).toBeNull();
    expect(await consent.text()).toContain('action="/oauth/authorize/consent"');
    expect(await env.store.getAuthRequest(rid!)).toMatchObject({ step: "consent", personId: who.personId });
    noIssuedAccess(env);
    expect((await fetchRetry(started.cookie)).status).toBe(400);
    const approved = await post(env, "/oauth/authorize/consent", rid!, started.cookie, { decision: "approve" });
    expect(approved.status).toBe(303);
    expect(new URL(approved.headers.get("location")!).searchParams.get("state")).toBe("connection-state");
    expect(env.provider.sent).toHaveLength(0);
  });

  test("a session retry cannot replace a phone form that advanced during its check", async () => {
    let enteredCheck!: () => void;
    let finishCheck!: () => void;
    const checking = new Promise<void>(resolve => { enteredCheck = resolve; });
    const complete = new Promise<void>(resolve => { finishCheck = resolve; });
    let recovering = false;
    let siteToken = "";
    let env: Env;
    env = setup({ authenticatedSiteSession: async app => {
      if (!recovering) return "unavailable";
      enteredCheck();
      await complete;
      return env.sessions.authenticate(app, siteToken);
    } });
    const who = await member(env);
    siteToken = who.cookie.slice("sid_peon=".length);
    const client = await register(env, DOMAIN);
    const started = await begin(env, client.body.client_id, who.cookie);
    const retry = /href="(\/oauth\/retry\?rid=([A-Za-z0-9_-]+))"/.exec(started.html);
    if (!retry) throw new Error("missing same-request retry link");
    recovering = true;
    const delayed = env.fetch(new Request(BASE + retry[1], { headers: { cookie: started.cookie } }));
    await checking;
    try {
      const phone = await post(env, "/oauth/authorize/phone", retry[2]!, started.cookie, { phone: PHONE_B });
      expect(phone.status).toBe(200);
      expect(await phone.text()).toContain(PHONE_B.slice(-4));
    } finally {
      finishCheck();
    }
    expect((await delayed).status).toBe(400);
    expect(await env.store.getAuthRequest(retry[2]!)).toMatchObject({ step: "code", e164: PHONE_B, personId: null });
    noIssuedAccess(env);
  });

  test("a new DCR client cannot turn a signed-in browser GET into a grant or code", async () => {
    let links = 0;
    const env = setup({ assistantLinked: async () => { links++; } });
    const who = await member(env);
    const client = await register(env, DOMAIN, { client_name: '<img src=x onerror="alert(1)">' });
    const request = await begin(env, client.body.client_id, who.cookie);
    expect(request.response.status).toBe(200);
    expect(request.response.headers.has("location")).toBe(false);
    expect(request.html).toContain('/oauth/authorize/consent');
    expect(request.html).toContain('client.example');
    expect(request.response.headers.get("content-security-policy")).toContain("form-action 'self' https://client.example");
    expect(request.html).toContain('&lt;img');
    expect(request.html).not.toContain('<img src=x');
    expect(request.response.headers.get("cache-control")).toBe("no-store");
    noIssuedAccess(env);
    expect(links).toBe(0);
    expect(env.provider.sent).toHaveLength(0);
  });

  test("expanded scopes require an explicit decision and cannot mutate the older grant", async () => {
    const env = setup(); const who = await member(env); const client = await register(env, DOMAIN);
    const old = await priorApproval(env, client.body.client_id, who.personId, ["membership:read"]);
    const request = await begin(env, client.body.client_id, who.cookie);
    expect(request.response.status).toBe(200);
    noIssuedAccess(env, 1);
    expect(await env.store.getGrant(old.id)).toEqual(old);
    const approved = await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve", scope: "apps:read", client_id: "forged", resource: "https://other.example/mcp" });
    expect(approved.status).toBe(303);
    const location = new URL(approved.headers.get("location")!);
    expect(location.origin).toBe("https://client.example");
    expect(location.searchParams.get("state")).toBe("connection-state");
    const exchanged = await tokenRequest(env, DOMAIN, { grant_type: "authorization_code", code: location.searchParams.get("code")!, client_id: client.body.client_id, redirect_uri: "https://client.example/callback", code_verifier: VERIFIER });
    expect(exchanged.res.status).toBe(200);
    expect(exchanged.body.scope).toBe(SCOPES);
    expect(await env.store.getGrant(old.id)).toEqual(old);
  });

  test("a previously approved client still needs a decision for a fresh request", async () => {
    const env = setup(); const who = await member(env); const client = await register(env, DOMAIN);
    const old = await priorApproval(env, client.body.client_id, who.personId, ["membership:read", "profile:write"]);
    const request = await begin(env, client.body.client_id, who.cookie);
    expect(request.response.status).toBe(200);
    expect(request.html).toContain('/oauth/authorize/consent');
    noIssuedAccess(env, 1);
    expect(await env.store.getGrant(old.id)).toEqual(old);
  });

  test("a valid phone code proves ownership, not permission for the requesting client", async () => {
    const env = setup(); const client = await register(env, DOMAIN); const request = await begin(env, client.body.client_id);
    expect((await post(env, "/oauth/authorize/phone", request.rid, request.cookie, { phone: PHONE_A })).status).toBe(200);
    const verified = await post(env, "/oauth/authorize/code", request.rid, request.cookie, { code: env.provider.last(PHONE_A)! });
    expect(verified.status).toBe(200);
    expect(verified.headers.has("location")).toBe(false);
    expect(await verified.text()).toContain('/oauth/authorize/consent');
    noIssuedAccess(env);
  });

  test("approval remains POST-only, same-origin, request-cookie bound and single-use", async () => {
    const env = setup(); const who = await member(env); const client = await register(env, DOMAIN); const request = await begin(env, client.body.client_id, who.cookie);
    expect((await env.fetch(new Request(`${BASE}/oauth/authorize/consent`))).status).toBe(405);
    expect((await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" }, "https://other.example")).status).toBe(403);
    expect((await post(env, "/oauth/authorize/consent", request.rid, who.cookie, { decision: "approve" })).status).toBe(400);
    noIssuedAccess(env);
    expect((await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" })).status).toBe(303);
    expect((await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" })).status).toBe(400);
    expect((env.store as MemoryOAuthStore).grants.size).toBe(1);
  });

  test("concurrent approvals issue only one grant and one code", async () => {
    const env = setup(); const who = await member(env); const client = await register(env, DOMAIN);
    const request = await begin(env, client.body.client_id, who.cookie);
    const responses = await Promise.all([1, 2].map(() => post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" })));
    expect(responses.map(r => r.status).sort()).toEqual([303, 400]);
    const store = env.store as MemoryOAuthStore;
    expect(store.grants.size).toBe(1);
    expect(store.codes.size).toBe(1);
    expect(store.rows.filter(r => r.kind === "consent_granted")).toHaveLength(1);
  });

  test("an approval expiring during storage consumption cannot issue access", async () => {
    const env = setup(); const who = await member(env); const client = await register(env, DOMAIN);
    const request = await begin(env, client.body.client_id, who.cookie);
    const commit = env.store.commitConsentGrant.bind(env.store);
    env.store.commitConsentGrant = (id, at, confirm, writes) => commit(id, at, approval => {
      env.clock.t = approval.expiresAt;
      return confirm(approval);
    }, writes);
    expect((await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" })).status).toBe(400);
    noIssuedAccess(env);
  });

  test("a pending identity changed after validation cannot receive a grant", async () => {
    for (const patch of [{ e164: PHONE_B }, { personId: "different-owner" }]) {
      const env = setup(); const who = await member(env); const client = await register(env, DOMAIN);
      const request = await begin(env, client.body.client_id, who.cookie);
      const commit = env.store.commitConsentGrant.bind(env.store);
      env.store.commitConsentGrant = async (id, at, confirm, writes) => {
        await env.store.updateAuthRequest(id, patch);
        return commit(id, at, confirm, writes);
      };
      expect((await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "approve" })).status).toBe(400);
      noIssuedAccess(env);
    }
  });

  test("switching the signed-in account cannot approve the earlier account's request", async () => {
    const env = setup(); const who = await member(env); const other = await member(env, PHONE_B); const client = await register(env, DOMAIN); const request = await begin(env, client.body.client_id, who.cookie);
    const switched = request.cookie.replace(who.cookie, other.cookie);
    expect((await post(env, "/oauth/authorize/consent", request.rid, switched, { decision: "approve" })).status).toBe(403);
    noIssuedAccess(env);
  });

  test("denying a fresh request preserves the already approved access and refresh tokens", async () => {
    const env = setup(); await member(env);
    const connection = await connect(env, DOMAIN, PHONE_A, { scope: "membership:read" });
    const site = /sid_peon=[^;]+/.exec(connection.flow.siteCookie!)![0];
    const old = [...(env.store as MemoryOAuthStore).grants.values()].find(g => g.clientId === connection.client.client_id)!;
    expect(old).toBeDefined();
    const request = await begin(env, connection.client.client_id, site);
    expect(request.response.status).toBe(200);
    const denied = await post(env, "/oauth/authorize/consent", request.rid, request.cookie, { decision: "deny" });
    expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect(await env.store.getGrant(old.id)).toEqual(old);
    expect((await call(env, `${BASE}/mcp`, "check_status", {}, { token: connection.token.access_token })).res.status).toBe(200);
    const refresh = await tokenRequest(env, DOMAIN, { grant_type: "refresh_token", refresh_token: connection.token.refresh_token, client_id: connection.client.client_id });
    expect(refresh.res.status).toBe(200);
    expect(refresh.body.scope).toBe("membership:read");
    expect((env.store as MemoryOAuthStore).grants.size).toBe(1);
  });
});
