import { expect, test, vi } from "vitest";
import { SimClock } from "@thenetwork/core";
import { canBeMatched } from "../../core/src/policy.ts";
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

/** The "Finish signup" button (decision=open) is in the page before the "Allow" button (decision=approve). */
function finishSignupComesFirst(html: string): boolean {
  const open = html.indexOf('name="decision" value="open"'), approve = html.indexOf('name="decision" value="approve"');
  return open >= 0 && approve >= 0 && open < approve;
}

// spec/agentPhoneHandoff.md, "Only the browser and the authorized connector complete the handoff"
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
      const verifiedPage = await verified.text();
      expect(verifiedPage).toContain('action="/oauth/authorize/signup"');
      // spec/authorizationPages.md, "A new person sees Finish signup as the main action on the consent page"
      expect(finishSignupComesFirst(verifiedPage)).toBe(true);
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
      // After signup the page confirms it, offers no second signup and "Allow" is the main action again.
      expect(approvalForm).toContain("Signup confirmed.");
      expect(approvalForm).not.toContain('action="/oauth/authorize/signup"');
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
      expect(readForm).toContain("Read the profile you saved for this app");
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

// --- spec/authorizationPages.md: the browser signup step on each open app, the invite-only web path and typed ages ---

type SignupWorld = {
  service: NetworkService;
  connector: NonNullable<Awaited<ReturnType<typeof createServiceMcp>>> & { store: PgOAuthStore };
  env: ReturnType<typeof setup>;
  harness: ReturnType<typeof setup>;
};

/** The real service and connector on the test database, with each app's site host routed to them. */
async function withSignupWorld(networks: string[], run: (w: SignupWorld) => Promise<void>) {
  const url = await testDb();
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const harness = setup();
  const service = new NetworkService({
    url, clock, instance: "agent-signup-paths-test", log: () => {}, photoStorage: null, notify: false,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
    networks: networks.map(id => ({ id, matchingEnabled: false })),
    publicApi: { minStartMs: 0, minVerifyMs: 0, otp: harness.provider },
  });
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
      await run({ service, connector: connector as SignupWorld["connector"], env, harness });
    } finally {
      await server.stop(true);
      await connector.store.close();
    }
  } finally {
    await service.close();
    await dropTestDb();
  }
}

/** One browser with its own cookies on one site. */
function browserOn(w: SignupWorld, site: string) {
  const cookies = new Map<string, string>();
  return async (path: string, fields?: Record<string, string>) => {
    const header = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    const response = await w.env.fetch(new Request(`https://${site}${path}`, {
      headers: { cookie: header, ...(fields ? { origin: `https://${site}`, "content-type": "application/x-www-form-urlencoded" } : {}) },
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
  };
}

type Browser = ReturnType<typeof browserOn>;

/** Register a client on the site and open its connection link in the browser; returns the first page. */
async function openConnection(w: SignupWorld, site: string, browser: Browser, state: string) {
  const registration = await register(w.env, site);
  expect(registration.res.status).toBe(201);
  const clientId = registration.body.client_id as string;
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: clientReturn, state,
    code_challenge: CHALLENGE, code_challenge_method: "S256", scope: "membership:read profile:write",
  });
  const page = await browser(`/oauth/authorize?${params}`);
  expect(page.status).toBe(200);
  return { clientId, html: await page.text() };
}

/** Confirm a new phone on the code page; returns the consent page that follows. */
async function confirmPhone(w: SignupWorld, browser: Browser, rid: string, number: string) {
  expect((await browser("/oauth/authorize/phone", { rid, phone: number })).status).toBe(200);
  const code = w.harness.provider.last(number);
  if (!code) throw new Error("No phone code sent to the fixture provider");
  const verified = await browser("/oauth/authorize/code", { rid, code });
  expect(verified.status).toBe(200);
  return verified.text();
}

/** Open the signup form from the consent page and send it with these fields. */
async function submitSignup(browser: Browser, rid: string, fields: Record<string, string>) {
  const opened = await browser("/oauth/authorize/signup", { rid, decision: "open" });
  expect(opened.status).toBe(200);
  const form = await opened.text();
  const sent = await browser("/oauth/authorize/signup", {
    rid, decision: "join", signupView: hiddenField(form, "signupView"), consentVersion: hiddenField(form, "consentVersion"),
    smsConsent: "yes", homeCity: "nyc", ...fields,
  });
  return { form, status: sent.status, html: await sent.text() };
}

async function exchange(w: SignupWorld, site: string, clientId: string, location: string) {
  const code = new URL(location).searchParams.get("code")!;
  const token = await tokenRequest(w.env, site, { grant_type: "authorization_code", code, redirect_uri: clientReturn, client_id: clientId, code_verifier: VERIFIER });
  expect(token.res.status).toBe(200);
  return token.body.access_token as string;
}

// spec/authorizationPages.md, "A new person sees Finish signup as the main action on the consent page"
test.skipIf(!pgAvailable)("Allow before signup leaves a grant with no person; Finish signup is first and a later signup ends that grant", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "friends.help", number = "+12125550164";
    const browser = browserOn(w, site);
    const first = await openConnection(w, site, browser, "allow-first");
    const rid = hiddenField(first.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    // The person presses Allow anyway: the grant has no person and the agent sees not_joined.
    const allowed = await browser("/oauth/authorize/consent", { rid, decision: "approve" });
    expect(allowed.status).toBe(303);
    const early = await exchange(w, site, first.clientId, allowed.headers.get("location")!);
    expect(await w.connector.store.sql`select person_id from oauth.grants where client_id=${first.clientId}`).toEqual([{ person_id: null }]);
    const status = (token: string) => call(w.env, `https://${site}/mcp`, "check_status", { app: "friends" }, { token });
    expect((await status(early)).body?.result.structuredContent).toMatchObject({ app: "friends", status: "not_joined" });
    expect(await w.service.accounts.personFor(number)).toBeUndefined();

    // A new connection in the same browser needs no second code and again puts Finish signup first.
    const second = await openConnection(w, site, browser, "signup-second");
    expect(second.html).toContain('action="/oauth/authorize/signup"');
    expect(finishSignupComesFirst(second.html)).toBe(true);
    const rid2 = hiddenField(second.html, "rid");
    const joined = await submitSignup(browser, rid2, { firstName: "Noa", age: "31" });
    expect(joined.status).toBe(200);
    expect(joined.html).toContain("Signup confirmed.");
    expect(joined.html).not.toContain('action="/oauth/authorize/signup"');
    const person = await w.service.accounts.personFor(number);
    if (!person) throw new Error("No person after signup");

    // The grant made before the person existed never follows the new person.
    expect((await status(early)).res.status).toBe(401);
    const approved = await browser("/oauth/authorize/consent", { rid: rid2, decision: "approve", signupApproval: hiddenField(joined.html, "signupApproval") });
    expect(approved.status).toBe(303);
    const later = await exchange(w, site, second.clientId, approved.headers.get("location")!);
    expect((await status(later)).body?.result.structuredContent).toMatchObject({ app: "friends", status: expect.stringMatching(/^(active|onboarding)$/) });
  });
}, 60_000);

// memberAge: under 13 cannot join; the lowest stated age wins, also when it is typed in the browser.
test.skipIf(!pgAvailable)("slop.date: an age under 13 typed on the signup page is refused and a higher age later does not undo it", async () => {
  await withSignupWorld(["slop:nyc"], async w => {
    const site = "slop.date", number = "+12125550165";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "under-13");
    const rid = hiddenField(opened.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    const refused = await submitSignup(browser, rid, { firstName: "Kit", age: "12" });
    expect(refused.status).toBe(400);
    expect(refused.html).toContain("You can’t join this app at the age entered.");
    expect(refused.html).not.toContain('name="code"');
    expect(await w.service.accounts.personFor(number)).toBeUndefined();

    const retried = await submitSignup(browser, rid, { firstName: "Kit", age: "30" });
    expect(retried.status).toBe(400);
    expect(retried.html).toContain("You can’t join this app at the age entered.");
    expect(await w.service.accounts.personFor(number)).toBeUndefined();
    expect(await w.connector.store.sql`select id from oauth.grants where client_id=${opened.clientId}`).toEqual([]);
  });
}, 60_000);

// Founder decision 1: 13-17 may join an app but are never matched.
test.skipIf(!pgAvailable)("friends.help: a teen age typed on the signup page joins but can never be matched", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "friends.help", number = "+12125550166";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "teen");
    const rid = hiddenField(opened.html, "rid");
    await confirmPhone(w, browser, rid, number);
    const joined = await submitSignup(browser, rid, { firstName: "Jo", age: "15" });
    expect(joined.status).toBe(200);
    expect(joined.html).toContain("Signup confirmed.");
    const person = await w.service.accounts.personFor(number);
    if (!person) throw new Error("No person after a teen signup");
    expect(await w.service.people.getMembership(person.id, "friends")).toMatchObject({ firstName: "Jo" });
    const lowest = await w.service.accounts.lowestAge(number, person);
    expect(lowest).toBe(15);
    expect(canBeMatched(lowest)).toBe(false);
  });
}, 60_000);

// Founder decision (2026-10-09): ntwrk stays invite-only on the web.
test.skipIf(!pgAvailable)("ntwrk.party: the signup page requires an invitation and refuses a missing or unknown one", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "ntwrk.party", number = "+12125550167";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "invite-only");
    const rid = hiddenField(opened.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    const missing = await submitSignup(browser, rid, { firstName: "Ash", age: "33", invitation: "" });
    expect(missing.form).toMatch(/name="invitation"[^>]*required/);
    expect(missing.status).toBe(400);
    expect(missing.html).toContain("Enter a valid invitation for this app.");

    const unknown = await submitSignup(browser, rid, { firstName: "Ash", age: "33", invitation: "A".repeat(43) });
    expect(unknown.status).toBe(400);
    expect(unknown.html).toContain("Enter a current invitation for this app.");
    expect(await w.service.accounts.personFor(number)).toBeUndefined();
    expect(await w.connector.store.sql`select id from oauth.grants where client_id=${opened.clientId}`).toEqual([]);
  });
}, 60_000);
