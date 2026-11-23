import { expect, test, vi } from "vitest";
import { SimClock } from "@thenetwork/core";
import { fetchWithHost } from "../../core/src/runtime/fetch.ts";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { PgOAuthStore } from "../../mcp/src/pg-store.ts";
import { call, CHALLENGE, register, setup, tokenRequest, VERIFIER } from "../../mcp/test/harness.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { createServiceMcp } from "../service/serve.ts";
import { NetworkService } from "../service/service.ts";

const domain = "friends.help";
const origin = `https://${domain}`;
const phone = "+12125550163";
const clientReturn = "https://client.example/callback";

function hiddenField(html: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];
  if (!value) throw new Error(`Missing ${name} in the browser form`);
  return value;
}

test.skipIf(!pgAvailable)("a new member joins in the OAuth browser and submits the approved profile once through MCP", async () => {
  const url = await testDb();
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const harness = setup();
  const service = new NetworkService({
    url, clock, instance: "agent-signup-handoff-test", log: () => {}, photoStorage: null, notify: false,
    env: { PLATFORM_ENV: "dev" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
    publicApi: { minStartMs: 0, minVerifyMs: 0, otp: harness.provider },
  });
  const intake = vi.spyOn(service, "submitProfile");
  try {
    await service.start();
    const connector = await createServiceMcp(service, { databaseUrl: url, migrate: false, log: () => {}, env: { PLATFORM_ENV: "dev" } });
    if (!connector || !(connector.store instanceof PgOAuthStore)) throw new Error("Expected the database-backed connector");
    const server = await serveHttp({ hostname: "127.0.0.1", port: 0, async fetch(req, socket) {
      return await connector.fetch(req, socket) ?? service.publicFetch(req, socket);
    } });
    try {
      const env = { ...harness, fetch: async (req: Request) => {
        const target = new URL(req.url);
        const headers = new Headers(req.headers);
        headers.set("host", target.host);
        return fetchWithHost(new URL(target.pathname + target.search, server.url), {
          headers, method: req.method, redirect: "manual", ...(req.body ? { body: await req.arrayBuffer() } : {}),
        });
      } };
      const registration = await register(env, domain);
      expect(registration.res.status).toBe(201);
      const clientId = registration.body.client_id;
      const params = new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: clientReturn, state: "signup-handoff",
        code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "membership:read profile:write",
      });

      // The browser owns both cookies and the delivered phone code. The OAuth client uses its own HTTP requests below.
      const cookies = new Map<string, string>();
      async function browser(path: string, fields?: Record<string, string>) {
        const header = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
        const response = await env.fetch(new Request(`${origin}${path}`, {
          headers: { cookie: header, ...(fields ? { origin, "content-type": "application/x-www-form-urlencoded" } : {}) },
          ...(fields ? { method: "POST", body: new URLSearchParams(fields) } : {}),
        }));
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(";")[0]!;
          const at = pair.indexOf("=");
          const name = pair.slice(0, at), token = pair.slice(at + 1);
          if (token) cookies.set(name, token);
          else cookies.delete(name);
        }
        return response;
      }

      const initial = await browser(`/oauth/authorize?${params}`);
      expect(initial.status).toBe(200);
      const rid = hiddenField(await initial.text(), "rid");
      expect((await browser("/oauth/authorize/phone", { rid, phone })).status).toBe(200);
      const phoneCode = harness.provider.last(phone);
      if (!phoneCode) throw new Error("No phone code sent to the fixture provider");
      const verified = await browser("/oauth/authorize/code", { rid, code: phoneCode });
      expect(verified.status).toBe(200);
      expect(await verified.text()).toContain('action="/oauth/authorize/signup"');
      expect(await service.accounts.personFor(phone)).toBeUndefined();

      const signup = await browser("/oauth/authorize/signup", { rid, decision: "open" });
      const form = await signup.text();
      expect(signup.status).toBe(200);
      const joined = await browser("/oauth/authorize/signup", {
        rid, decision: "join", signupView: hiddenField(form, "signupView"),
        consentVersion: hiddenField(form, "consentVersion"),
        firstName: "Ari", age: "29", homeCity: "nyc", smsConsent: "yes",
      });
      expect(joined.status).toBe(200);
      const approvalForm = await joined.text();
      expect(approvalForm).toContain('action="/oauth/authorize/consent"');
      expect(approvalForm).toContain("Save your profile, prepare signup details, and pause or turn back on what this app finds for you");
      const person = await service.accounts.personFor(phone);
      if (!person) throw new Error("No owner recorded after verified signup");
      const membership = await service.people.getMembership(person.id, "friends");
      expect(membership).toMatchObject({ firstName: "Ari", state: expect.stringMatching(/^(active|onboarding)$/) });
      expect(await connector.store.sql`select id from oauth.grants where client_id=${clientId}`).toEqual([]);
      expect(intake).not.toHaveBeenCalled();

      const previousConsent = await browser("/oauth/authorize/consent", { rid, decision: "approve" });
      expect(await previousConsent.text()).toContain("This page has expired");
      expect(await connector.store.sql`select id from oauth.grants where client_id=${clientId}`).toEqual([]);

      const allowed = await browser("/oauth/authorize/consent", {
        rid, decision: "approve", signupApproval: hiddenField(approvalForm, "signupApproval"),
      });
      expect(allowed.status).toBe(303);
      const returned = new URL(allowed.headers.get("location")!);
      expect(returned.origin + returned.pathname).toBe(clientReturn);
      expect(returned.searchParams.get("state")).toBe("signup-handoff");
      expect(returned.href).not.toContain(encodeURIComponent(phone));
      expect(returned.href).not.toContain(phoneCode);

      const exchanged = await tokenRequest(env, domain, {
        grant_type: "authorization_code", code: returned.searchParams.get("code")!, redirect_uri: clientReturn,
        client_id: clientId, code_verifier: VERIFIER,
      });
      expect(exchanged.res.status).toBe(200);
      const auth = { token: exchanged.body.access_token };
      expect(await connector.store.sql`select app_id,person_id from oauth.grants where client_id=${clientId}`)
        .toEqual([{ app_id: "friends", person_id: person.id }]);
      const check = () => call(env, `${origin}/mcp`, "check_status", { app: "friends" }, auth);
      expect((await check()).body?.result.structuredContent).toMatchObject({ app: "friends", status: membership!.state });
      const about = "I like hiking and would like to meet a walking group.";
      const save = () => call(env, `${origin}/mcp`, "submit_profile", { about }, auth);
      expect((await save()).body?.result.structuredContent).toMatchObject({ app: "friends", submitted: true });
      expect((await save()).body?.result.structuredContent).toMatchObject({ app: "friends", submitted: true });
      expect(intake).toHaveBeenCalledExactlyOnceWith(person.id, "friends", phone, about);
      expect((await check()).body?.result.structuredContent).toMatchObject({ app: "friends", status: expect.stringMatching(/^(active|onboarding)$/) });

      // spec/connectorTools.md, "Read saved profile fields only for this app's active member"
      const read = (token: string) => call(env, `${origin}/mcp`, "read_profile", { app: "friends" }, { token });
      expect((await read(auth.token)).res.status).toBe(403);
      params.set("scope", "profile:read");
      const readConsent = await browser(`/oauth/authorize?${params}`);
      expect(readConsent.status).toBe(200);
      const readForm = await readConsent.text();
      expect(readForm).toContain("Read the profile you saved for this app and what this app finds for you");
      const readApproval = await browser("/oauth/authorize/consent", {
        rid: hiddenField(readForm, "rid"), decision: "approve",
      });
      expect(readApproval.status).toBe(303);
      const readCode = new URL(readApproval.headers.get("location")!).searchParams.get("code")!;
      const readToken = await tokenRequest(env, domain, {
        grant_type: "authorization_code", code: readCode, redirect_uri: clientReturn,
        client_id: clientId, code_verifier: VERIFIER,
      });
      expect(readToken.body.scope).toBe("profile:read");
      const savedProfile = await read(readToken.body.access_token);
      expect(savedProfile.body?.result.structuredContent).toMatchObject({ app: "friends", profile: { first_name: "Ari", home_region: "nyc" } });
      expect(savedProfile.text).not.toContain(phone);
      expect(intake).toHaveBeenCalledTimes(1);
    } finally {
      await server.stop(true);
      await connector.store.close();
    }
  } finally {
    await service.close();
    await dropTestDb();
  }
}, 60_000);
