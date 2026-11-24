import { expect, test, vi } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import { canBeMatched } from "../../core/src/policy.ts";
import { fetchWithHost } from "../../core/src/runtime/fetch.ts";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { PgOAuthStore } from "../../mcp/src/pg-store.ts";
import { call, CHALLENGE, register, setup, tokenRequest, VERIFIER } from "../../mcp/test/harness.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { PHOTO_CONSENT, type PhotoStorage } from "../../platform/src/photos.ts";
import { createServiceMcp } from "../service/serve.ts";
import { NetworkService } from "../service/service.ts";

const domain = "friends.help";
const origin = `https://${domain}`;
const phone = "+12125550163";
const clientReturn = "https://client.example/callback";
const signupTurnSecret = "synthetic-signup-age-lifecycle-turn-secret";

function hiddenField(html: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];
  if (!value) throw new Error(`Missing ${name} in the browser form`);
  return value;
}

function finishSignupComesFirst(html: string): boolean {
  const decisions = [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0])
    .filter(tag => /\sname="decision"/.test(tag)).map(tag => /\svalue="([^"]*)"/.exec(tag)?.[1]);
  const open = decisions.indexOf("open"), approve = decisions.indexOf("approve");
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
      expect(finishSignupComesFirst(verifiedPage)).toBe(true);
      expect(await service.accounts.personFor(phone)).toBeUndefined();

      const signup = await browser("/oauth/authorize/signup", { rid, decision: "open" });
      const form = await signup.text();
      expect(signup.status).toBe(200);
      const joined = await browser("/oauth/authorize/signup", {
        rid, decision: "join", signupView: hiddenField(form, "signupView"),
        consentVersion: hiddenField(form, "consentVersion"),
        firstName: "Ari", birthdate: "1997-01-15", homeCity: "nyc", smsConsent: "yes",
      });
      expect(joined.status).toBe(200);
      const approvalForm = await joined.text();
      expect(approvalForm).toContain('action="/oauth/authorize/consent"');
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

      // The connector can still confirm this app's existing membership while its intake runtime is unavailable.
      const partial = new NetworkService({
        url, clock, instance: "agent-signup-unavailable-intake", log: () => {}, photoStorage: null, notify: false,
        env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc", matchingEnabled: false }],
      });
      try {
        await partial.start();
        const live = await createServiceMcp(partial, { databaseUrl: url, migrate: false, log: () => {}, env: { PLATFORM_ENV: "dev" } });
        if (!live || !(live.store instanceof PgOAuthStore)) throw new Error("Expected a shared database-backed connector");
        try {
          const partialEnv = { ...env, fetch: async (request: Request) => (await live.fetch(request))! };
          const status = await call(partialEnv, `${origin}/mcp`, "check_status", {}, auth);
          expect(status.body?.result.structuredContent).toMatchObject({ app: "friends", status: "active" });
          expect(await partial.runtimeOfMember("friends", membership!.memberId)).toBeUndefined();
          const refused = await call(partialEnv, `${origin}/mcp`, "submit_profile", { about: "I like photography." }, auth);
          expect(refused.body?.result.structuredContent).toMatchObject({
            app: "friends", submitted: false, status: "active",
            next_step: "Profile delivery is unavailable. Check your app status before making changes.",
          });
          expect(await live.store.sql`select accepted from oauth.profile_submissions`).toEqual([{ accepted: true }]);
        } finally {
          await live.store.close();
        }
      } finally {
        await partial.close();
      }
    } finally {
      await server.stop(true);
      await connector.store.close();
    }
  } finally {
    await service.close();
    await dropTestDb();
  }
}, 60_000);


type SignupWorld = {
  service: NetworkService;
  clock: SimClock;
  connector: NonNullable<Awaited<ReturnType<typeof createServiceMcp>>> & { store: PgOAuthStore };
  env: ReturnType<typeof setup>;
  harness: ReturnType<typeof setup>;
};

async function withSignupWorld(networks: string[], run: (w: SignupWorld) => Promise<void>, options: { photoStorage?: PhotoStorage; tokens?: string } = {}) {
  const url = await testDb();
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const harness = setup();
  const service = new NetworkService({
    url, clock, instance: "agent-signup-paths-test", log: () => {}, photoStorage: options.photoStorage ?? null, tokens: options.tokens, notify: false,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: signupTurnSecret },
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
      await run({ service, clock, connector: connector as SignupWorld["connector"], env, harness });
    } finally {
      await server.stop(true);
      await connector.store.close();
    }
  } finally {
    await service.close();
    await dropTestDb();
  }
}

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

// spec/photoUploadLink.md, "A link is issued only to an adult live member of a photo app who is not banned or held"
test.skipIf(!pgAvailable)("a private photo upload link is app-bound, single use and rechecks eligibility at publication", async () => {
  const objects = new Map<string, Uint8Array>();
  let pausePut = false;
  let enteredPut!: (key: string) => void;
  let releasePut!: () => void;
  const entered = new Promise<string>(resolve => { enteredPut = resolve; });
  const released = new Promise<void>(resolve => { releasePut = resolve; });
  const storage: PhotoStorage = {
    kind: "local",
    async put(key, bytes) {
      if (pausePut) { enteredPut(key); await released; }
      objects.set(key, bytes);
    },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
  };
  await withSignupWorld(["slop:nyc"], async w => {
    const number = "+12125550198";
    const site = "https://slop.date";
    const post = (path: string, body: unknown, cookie?: string) => w.env.fetch(new Request(site + path, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    }));
    expect((await post("/api/auth/otp/start", { phone: number })).status).toBe(200);
    const verified = await post("/api/auth/otp/verify", { phone: number, code: w.harness.provider.last(number) });
    expect(verified.status).toBe(200);
    expect((await post("/api/join", { firstName: "Jo", age: 29, homeCity: "nyc", consent: { sms: true, version: APPS.slop.consent.version } },
      verified.headers.getSetCookie()[0]?.split(";")[0])).status).toBe(200);
    const person = (await w.service.accounts.personFor(number))!;
    const path = "/api/photos/upload";
    const status = (token: string, origin = site) => w.env.fetch(new Request(origin + path, { headers: { "x-photo-upload-link": token } }));
    const upload = (token: string, consent?: string, origin = site) => {
      const form = new FormData();
      form.append("photo", new Blob([Uint8Array.from([255,216,255,218,0,2,1,255,217])], { type: "image/jpeg" }), "private.jpg");
      return w.env.fetch(new Request(origin + path, {
        method: "POST", body: form,
        headers: { origin, "x-photo-upload-link": token, ...(consent ? { "x-photo-consent": consent } : {}) },
      }));
    };
    const issue = async () => {
      const link = await w.service.photoLinks.issue(person.id, "slop", "agent");
      if (!link.ok) throw new Error(`Photo link refused: ${link.reason}`);
      return { token: new URL(link.url).hash.slice(1), expiresAt: link.expiresAt };
    };
    const turn = async (messageId: string, text: string) => {
      const body = JSON.stringify({ messageId, channel: "blooio", from: number, to: null, text,
        transport: "imessage", receivedAt: w.clock.now(), app: "slop" } satisfies TurnRequest);
      const proof = await svcSign(signupTurnSecret, { method: "POST", path: TURN_PATH, id: messageId, body,
        nowS: Math.floor(w.clock.now() / 1000) });
      const response = await w.service.fetch(new Request("http://127.0.0.1" + TURN_PATH, {
        method: "POST", body, headers: { "content-type": "application/json", ...proof },
      }));
      expect(response.status).toBe(200);
      return await response.json() as { outcome: string; replies?: string[] };
    };

    const unconsented = await issue();
    const opened = await status(unconsented.token);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("no-store");
    expect(await opened.json()).toEqual({ ok: true, consentRequired: true, consent: PHOTO_CONSENT });
    expect((await status(unconsented.token, "https://friends.help")).status).toBe(410);
    expect(await (await upload(unconsented.token)).json()).toEqual({ ok: false, error: "consent_required" });
    expect((await status(unconsented.token)).status).toBe(200);
    expect(await (await upload(unconsented.token, undefined, "https://friends.help")).json()).toEqual({ ok: false, error: "link_unavailable" });
    expect((await status(unconsented.token)).status).toBe(410);

    const ask = await turn("photo-upload-ask", "ADD PHOTOS");
    expect(ask.outcome).toBe("handled");
    expect(ask.replies?.join(" ")).toContain("YES PHOTOS");
    const consent = await turn("photo-upload-consent", "YES PHOTOS");
    const token = /\/photos\/add#([A-Za-z0-9_-]{43})/.exec(consent.replies?.join(" ") ?? "")?.[1];
    if (!token) throw new Error("No private photo link in the signed turn reply");
    expect(await (await status(token)).json()).toMatchObject({ ok: true, consentRequired: false });
    const responses = await Promise.all([upload(token), upload(token)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 410]);
    const saved = responses.find(r => r.status === 200)!;
    expect(await saved.json()).toEqual({ ok: true, stored: 1, refused: [] });
    expect(objects.size).toBe(1);
    expect((await w.env.fetch(new Request(site + "/api/photos", { headers: { "x-photo-upload-link": token } }))).status).toBe(401);
    const [rights] = await w.connector.store.sql`select has_table_privilege('network_observatory_slop', 'platform.photo_upload_links', 'select') as can_read_links`;
    expect(rights?.can_read_links).toBe(false);

    const expired = await issue();
    w.clock.set(expired.expiresAt);
    expect((await upload(expired.token)).status).toBe(410);
    const held = await issue();
    await w.service.people.setPhoneHold(number, "recycled_number", w.clock.now());
    expect((await status(held.token)).status).toBe(410);
    expect((await upload(held.token)).status).toBe(410);
    await w.service.people.setPhoneHold(number, null, w.clock.now());

    const staffHeld = await issue();
    await w.connector.store.sql`insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at)
      values (${person.id}, 'slop', '00000000-0000-4000-8000-000000000014', ${new Date(w.clock.now())})`;
    expect((await upload(staffHeld.token)).status).toBe(410);
    await w.connector.store.sql`delete from platform.staff_safety_holds where person_id = ${person.id} and app_id = 'slop'`;

    const inFlight = await issue();
    expect(await w.service.photoLinks.issue(person.id, "slop", "agent")).toEqual({ ok: false, reason: "daily_limit" });
    pausePut = true;
    const late = upload(inFlight.token);
    try {
      const key = await Promise.race([entered, late.then(res => { throw new Error(`Upload ended before storage wait: ${res.status}`); })]);
      await w.service.accounts.recordAge(number, person, 17);
      releasePut();
      expect(await (await late).json()).toEqual({ ok: false, stored: 0, refused: ["adults_only"] });
      expect(objects.has(key)).toBe(false);
      w.clock.advance(24 * HOUR);
      expect(await w.service.photoLinks.issue(person.id, "slop", "agent")).toEqual({ ok: false, reason: "adults_only" });
      expect(await w.service.accounts.deleteAll({ e164: number, personId: person.id })).toBe(true);
      expect(await w.connector.store.sql`select id from platform.photo_upload_links where person_id = ${person.id}`).toEqual([]);
    } finally {
      releasePut();
      await late.catch(() => undefined);
    }
  }, { photoStorage: storage });
}, 60_000);

type Browser = ReturnType<typeof browserOn>;

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

async function confirmPhone(w: SignupWorld, browser: Browser, rid: string, number: string) {
  expect((await browser("/oauth/authorize/phone", { rid, phone: number })).status).toBe(200);
  const code = w.harness.provider.last(number);
  if (!code) throw new Error("No phone code sent to the fixture provider");
  const verified = await browser("/oauth/authorize/code", { rid, code });
  expect(verified.status).toBe(200);
  return verified.text();
}

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

test.skipIf(!pgAvailable)("Allow before signup leaves a grant with no person; Finish signup is first and a later signup ends that grant", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "friends.help", number = "+12125550164";
    const browser = browserOn(w, site);
    const first = await openConnection(w, site, browser, "allow-first");
    const rid = hiddenField(first.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    const allowed = await browser("/oauth/authorize/consent", { rid, decision: "approve" });
    expect(allowed.status).toBe(303);
    const early = await exchange(w, site, first.clientId, allowed.headers.get("location")!);
    expect(await w.connector.store.sql`select person_id from oauth.grants where client_id=${first.clientId}`).toEqual([{ person_id: null }]);
    const status = (token: string) => call(w.env, `https://${site}/mcp`, "check_status", { app: "friends" }, { token });
    expect((await status(early)).body?.result.structuredContent).toMatchObject({ app: "friends", status: "not_joined" });
    expect(await w.service.accounts.personFor(number)).toBeUndefined();

    const second = await openConnection(w, site, browser, "signup-second");
    expect(second.html).toContain('action="/oauth/authorize/signup"');
    expect(finishSignupComesFirst(second.html)).toBe(true);
    const rid2 = hiddenField(second.html, "rid");
    const joined = await submitSignup(browser, rid2, { firstName: "Noa", birthdate: "1995-01-15" });
    expect(joined.status).toBe(200);
    expect(joined.html).toContain("Signup confirmed.");
    expect(joined.html).not.toContain('action="/oauth/authorize/signup"');
    const person = await w.service.accounts.personFor(number);
    if (!person) throw new Error("No person after signup");

    expect((await status(early)).res.status).toBe(401);
    const approved = await browser("/oauth/authorize/consent", { rid: rid2, decision: "approve", signupApproval: hiddenField(joined.html, "signupApproval") });
    expect(approved.status).toBe(303);
    const later = await exchange(w, site, second.clientId, approved.headers.get("location")!);
    expect((await status(later)).body?.result.structuredContent).toMatchObject({ app: "friends", status: expect.stringMatching(/^(active|onboarding)$/) });
  });
}, 60_000);

test.skipIf(!pgAvailable)("slop.date: a birthday under 13 typed on the signup page is refused and a higher age later does not undo it", async () => {
  await withSignupWorld(["slop:nyc"], async w => {
    const site = "slop.date", number = "+12125550165";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "under-13");
    const rid = hiddenField(opened.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    const refused = await submitSignup(browser, rid, { firstName: "Kit", birthdate: "2014-01-15" });
    expect(refused.status).toBe(400);
    expect(refused.html).toContain("You can’t join this app with the birthday entered.");
    expect(refused.html).not.toContain('name="code"');
    expect(refused.html).not.toContain("2014-01-15");
    expect(await w.service.accounts.personFor(number)).toBeUndefined();
    expect(await w.service.people.ageFloor(w.service.accounts.phoneHash(number))).toBe(12);
    expect(await w.connector.store.sql`select first_name from platform.memberships where first_name = 'Kit'`).toEqual([]);
    expect(await w.connector.store.sql`select person_id from platform.signup_eligibility`).toEqual([]);

    const retried = await submitSignup(browser, rid, { firstName: "Kit", birthdate: "1996-01-15" });
    expect(retried.status).toBe(400);
    expect(retried.html).toContain("You can’t join this app with the birthday entered.");
    expect(await w.service.accounts.personFor(number)).toBeUndefined();
    expect(await w.connector.store.sql`select id from oauth.grants where client_id=${opened.clientId}`).toEqual([]);
  });
}, 60_000);

test.skipIf(!pgAvailable)("friends.help: a teen birthday typed on the signup page joins but stays out of matching as a minor", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "friends.help", number = "+12125550166";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "teen");
    const rid = hiddenField(opened.html, "rid");
    await confirmPhone(w, browser, rid, number);
    const invalidBirthdays = ["", "2011-1-15", "2011-02-29", "2026-10-10", "1905-10-08"];
    for (const birthdate of invalidBirthdays) {
      const refused = await submitSignup(browser, rid, { firstName: "Jo", birthdate });
      expect(refused.status).toBe(400);
      expect(refused.html).toContain('id="signup-birthdate-error"');
      if (birthdate) expect(refused.html).not.toContain(birthdate);
      expect(await w.service.accounts.personFor(number)).toBeUndefined();
    }
    const joined = await submitSignup(browser, rid, { firstName: "Jo", birthdate: "2011-01-15" });
    expect(joined.status).toBe(200);
    expect(joined.form).toMatch(/<input\b(?=[^>]*\bname="birthdate")(?=[^>]*\btype="date")[^>]*>/);
    expect(joined.form).not.toContain('name="age"');
    expect(joined.html).toContain("Signup confirmed.");
    const person = await w.service.accounts.personFor(number);
    if (!person) throw new Error("No person after a teen signup");
    expect(await w.service.people.getMembership(person.id, "friends")).toMatchObject({ firstName: "Jo" });
    const lowest = await w.service.accounts.lowestAge(number, person);
    expect(lowest).toBe(15);
    expect(canBeMatched(lowest)).toBe(false);
  });
}, 60_000);

// spec/siteEnrollment.md, "An authenticated join accepts one age input"
test.skipIf(!pgAvailable)("the site join uses private birthday eligibility for new and existing members", async () => {
  await withSignupWorld(["friends:nyc"], async w => {
    const site = "https://friends.help";
    const newNumber = "+12125550196", existingNumber = "+12125550197";
    const birthdate = "2008-10-10";
    const profile = { firstName: "Jo", homeCity: "nyc", consent: { sms: true, version: APPS.friends.consent.version } };
    let cookie = "";
    const post = (path: string, body: unknown) => w.env.fetch(new Request(site + path, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie },
    }));
    const signIn = async (number: string) => {
      w.clock.advance(31_000);
      expect((await post("/api/auth/otp/start", { phone: number })).status).toBe(200);
      const verified = await post("/api/auth/otp/verify", { phone: number, code: w.harness.provider.last(number) });
      expect(verified.status).toBe(200);
      cookie = verified.headers.getSetCookie()[0]!.split(";")[0]!;
    };
    const join = async (fields: Record<string, unknown>) => {
      const response = await post("/api/join", { ...profile, ...fields });
      return { status: response.status, body: await response.json() };
    };

    await signIn(newNumber);
    expect(await join({ birthdate, age: 30 })).toMatchObject({ status: 400, body: { error: "invalid" } });
    expect(await join({ birthdate: "2008-02-30" })).toMatchObject({ status: 400, body: { error: "invalid_birthdate" } });
    expect(await w.service.accounts.personFor(newNumber)).toBeUndefined();
    expect(await join({ birthdate })).toMatchObject({ status: 200, body: { ok: true } });
    const newPerson = (await w.service.accounts.personFor(newNumber))!;
    const membership = (await w.service.people.getMembership(newPerson.id, "friends"))!;
    expect(membership.profile).toEqual({ homeCity: "nyc" });
    expect(newPerson.lowestAge).toBeNull();
    expect(await w.service.people.signupAgeAt(newPerson.id, w.clock.now())).toBe(17);

    await signIn(existingNumber);
    expect(await join({ age: 30 })).toMatchObject({ status: 200, body: { ok: true } });
    const existingPerson = (await w.service.accounts.personFor(existingNumber))!;
    const existing = (await w.service.people.getMembership(existingPerson.id, "friends"))!;
    await w.connector.store.sql`insert into platform.photos(id,person_id,app_id,storage_key,content_type,bytes,sha256,consent_version,created_at)
      values ('http-join-photo',${existingPerson.id},'slop','http-join-storage','image/jpeg',1,'http-join-sha','http-join-consent',${new Date(w.clock.now())})`;
    expect(await join({ birthdate, firstName: "Changed" })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await w.service.people.getMembership(existingPerson.id, "friends")).toEqual(existing);
    expect(await w.service.accounts.lowestAge(existingNumber, existingPerson)).toBe(17);
    expect(await w.connector.store.sql`select id from platform.photos where person_id=${existingPerson.id} and deleted_at is null`).toEqual([]);

    w.clock.set(Date.UTC(2026, 9, 10, 12));
    expect(await w.service.accounts.lowestAge(newNumber, newPerson)).toBe(18);
    expect(await w.service.accounts.lowestAge(existingNumber, existingPerson)).toBe(18);
  });
}, 60_000);

test.skipIf(!pgAvailable)("a browser birthday advances account and matching ages while a lower recorded age stays binding", async () => {
  await withSignupWorld(["friends:nyc"], async w => {
    const site = "friends.help";
    const firstNumber = "+12125550178", secondNumber = "+12125550179", previousAdultNumber = "+12125550180";
    await w.service.accounts.recordAge(secondNumber, undefined, 16);

    const previousAdult = await w.service.accounts.createPerson(previousAdultNumber, "otp_sms", 30);
    await w.connector.store.sql`insert into platform.photos(id,person_id,app_id,storage_key,content_type,bytes,sha256,consent_version,created_at)
      values ('fixture-private-photo',${previousAdult.id},'slop','fixture-private-storage','image/jpeg',1,'fixture-sha','fixture-consent',${new Date(w.clock.now())})`;

    for (const number of [firstNumber, secondNumber, previousAdultNumber]) {
      const browser = browserOn(w, site);
      const opened = await openConnection(w, site, browser, `birthday-${number}`);
      const rid = hiddenField(opened.html, "rid");
      await confirmPhone(w, browser, rid, number);
      const joined = await submitSignup(browser, rid, { firstName: "Jo", birthdate: "2008-10-10" });
      expect(joined.status).toBe(200);
      expect(joined.html).toContain("Signup confirmed.");
    }

    expect(await w.connector.store.sql`select id from platform.photos where person_id=${previousAdult.id} and deleted_at is null`).toEqual([]);

    const runtime = w.service.runtimeFor("friends");
    if (!runtime) throw new Error("No Friends runtime after signup");
    const agesFor = async (number: string) => {
      const person = await w.service.accounts.personFor(number);
      if (!person) throw new Error("No person after signup");
      const membership = await w.service.people.getMembership(person.id, "friends");
      if (!membership) throw new Error("No Friends membership after signup");
      return {
        account: await w.service.accounts.lowestAge(number, person),
        matching: await runtime.scoped(async tx => (await tx`select age from platform.matching_ages
          where app_id = 'friends' and member_id = ${membership.memberId}`)[0]?.age),
      };
    };

    const firstPerson = (await w.service.accounts.personFor(firstNumber))!;
    const firstMembership = (await w.service.people.getMembership(firstPerson.id, "friends"))!;
    const cachedMinor = () => runtime.readState(n => n.memberList().find(member => member.id === firstMembership.memberId)?.minor);

    w.clock.set(Date.UTC(2026, 9, 10, 11, 59, 59));
    expect(await agesFor(firstNumber)).toEqual({ account: 17, matching: 17 });
    expect(await cachedMinor()).toBe(true);
    expect(await agesFor(previousAdultNumber)).toEqual({ account: 17, matching: 17 });
    w.clock.advance(1_000);
    expect.soft(await agesFor(firstNumber)).toEqual({ account: 18, matching: 18 });
    expect(await agesFor(secondNumber)).toEqual({ account: 16, matching: 16 });

    await runtime.tick();
    expect(await cachedMinor()).toBe(false);
    expect(firstMembership.profile).toEqual({ homeCity: "nyc" });
    const staffAge = await runtime.scoped(async tx => {
      await tx`set local role network_observatory_friends`;
      const [rights] = await tx`select has_table_privilege(current_user, 'platform.signup_eligibility', 'select') as reads_private_date`;
      expect(rights?.reads_private_date).toBe(false);
      const row = await tx`select * from platform.matching_ages_friends where member_id = ${firstMembership.memberId}`;
      await tx`select set_config('app.age_as_of', '2000-01-01T00:00:00Z', true)`;
      expect(await tx`select * from platform.matching_ages_friends where member_id = ${firstMembership.memberId}`).toEqual(row);
      return row;
    });
    expect(staffAge).toEqual([{ app_id: "friends", member_id: firstMembership.memberId, age: expect.any(Number),
      banned: false, staff_held: false, report_held: false }]);

    const crossAppAge = await runtime.scoped(async tx => {
      await tx`set local role network_observatory_cross_app`;
      const [rights] = await tx`select has_table_privilege(current_user, 'platform.signup_eligibility', 'select') as reads_private_date`;
      expect(rights?.reads_private_date).toBe(false);
      return tx`select * from platform.observatory_person_ages where person_id = ${firstPerson.id}`;
    });
    expect(crossAppAge).toEqual([{ person_id: firstPerson.id, age: staffAge[0]?.age }]);

    await w.service.accounts.deleteAll({ e164: firstNumber, personId: firstPerson.id });
    expect(await w.service.people.signupAgeAt(firstPerson.id, w.clock.now())).toBeUndefined();

  });
}, 60_000);

test.skipIf(!pgAvailable)("ntwrk.party: the signup page requires an invitation and refuses a missing or unknown one", async () => {
  await withSignupWorld(["ntwrk:nyc", "friends:nyc"], async w => {
    const site = "ntwrk.party", number = "+12125550167";
    const browser = browserOn(w, site);
    const opened = await openConnection(w, site, browser, "invite-only");
    const rid = hiddenField(opened.html, "rid");
    const consent = await confirmPhone(w, browser, rid, number);
    expect(finishSignupComesFirst(consent)).toBe(true);

    const missing = await submitSignup(browser, rid, { firstName: "Ash", birthdate: "1993-01-15", invitation: "" });
    expect(missing.form).toMatch(/<input\b(?=[^>]*\sname="invitation")(?=[^>]*\srequired)[^>]*>/);
    expect(missing.status).toBe(400);
    expect(missing.html).toContain("Enter a valid invitation for this app.");

    const unknown = await submitSignup(browser, rid, { firstName: "Ash", birthdate: "1993-01-15", invitation: "A".repeat(43) });
    expect(unknown.status).toBe(400);
    expect(unknown.html).toContain("Enter a current invitation for this app.");
    expect(await w.service.accounts.personFor(number)).toBeUndefined();
    expect(await w.connector.store.sql`select id from oauth.grants where client_id=${opened.clientId}`).toEqual([]);
  });
}, 60_000);

// spec/memberAge.md, "A private signup date can end a birthday-only minor restriction"
test.skipIf(!pgAvailable)("failed browser enrollment preserves only the private age of earlier accepted signups", async () => {
  let blockedPhoto: string | undefined = "02-first-photo";
  const remove = vi.fn(async (key: string) => { if (key === blockedPhoto) throw new Error("fixture object removal failed"); });
  const storage: PhotoStorage = { kind: "local", put: async () => {}, get: async () => undefined, delete: remove };
  await withSignupWorld(["friends:nyc", "ntwrk:nyc"], async w => {
    const number = "+12125550184";
    const person = await w.service.accounts.createPerson(number, "otp_sms", null);
    const sql = w.connector.store.sql;
    const addPriorPhoto = async (id: string) => sql`insert into platform.photos
      (id, person_id, app_id, storage_key, content_type, bytes, sha256, consent_version, created_at)
      values (${id}, ${person.id}, 'slop', ${id}, 'image/jpeg', 1, 'fixture-sha', 'fixture-consent', ${new Date(w.clock.now())})`;
    const openVerified = async (site: string, state: string) => {
      w.clock.advance(HOUR);
      const browser = browserOn(w, site);
      const opened = await openConnection(w, site, browser, state);
      const rid = hiddenField(opened.html, "rid");
      return { browser, rid, verified: await confirmPhone(w, browser, rid, number) };
    };
    const signup = async (site: string, state: string, birthdate: string, invitation?: string) => {
      const { browser, rid } = await openVerified(site, state);
      return submitSignup(browser, rid, { firstName: "Jo", birthdate, ...(invitation === undefined ? {} : { invitation }) });
    };
    const privateRow = () => sql`select initial_minor_age, eligible_at from platform.signup_eligibility where person_id = ${person.id}`;
    const membership = (app: "friends" | "ntwrk") => w.service.people.getMembership(person.id, app);
    const firstDate = Date.UTC(2026, 9, 10, 12), laterDate = Date.UTC(2027, 9, 10, 12);

    await addPriorPhoto("01-first-photo");
    await addPriorPhoto("02-first-photo");
    expect((await signup("friends.help", "failed-first", "2008-10-10")).status).toBe(503);
    expect(await privateRow()).toEqual([]);
    expect(await membership("friends")).toBeUndefined();
    expect(await sql`select id from network.members where person_id = ${person.id}`).toEqual([]);
    expect(await sql`select state from platform.consent_events where e164 = ${number} and app_id = 'friends'`).toEqual([]);
    expect(await sql`select id from platform.photos where person_id = ${person.id}`).toEqual([{ id: "02-first-photo" }]);

    blockedPhoto = undefined;
    expect((await signup("friends.help", "confirmed-first", "2008-10-10")).html).toContain("Signup confirmed.");
    expect(await privateRow()).toEqual([{ initial_minor_age: 17, eligible_at: new Date(firstDate) }]);
    expect((await openVerified("friends.help", "existing-member")).verified).not.toContain("Finish signup");

    const seed = await w.service.fetch(new Request("http://127.0.0.1/apps/ntwrk/invite/seed", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer fixture-signup-seed" },
      body: JSON.stringify({ batchId: "8e43de36-74a3-4e40-96f4-a482a53dc1a8",
        invitations: [{ phone: number, city: "nyc", vouch: "Fixture staff knows the recipient through a local meetup." }] }),
    }));
    expect(seed.status).toBe(200);
    const invitation = new URLSearchParams(new URL((await seed.json()).invitations[0].link).hash.slice(1)).get("invite");
    if (!invitation) throw new Error("Expected the fixture invitation token");

    blockedPhoto = "prior-photo";
    await addPriorPhoto("prior-photo");
    expect((await signup("ntwrk.party", "failed-later", "2009-10-10", invitation)).status).toBe(503);
    expect(await privateRow()).toEqual([{ initial_minor_age: 17, eligible_at: new Date(firstDate) }]);
    expect(await membership("friends")).toMatchObject({ state: "active" });
    expect(await membership("ntwrk")).toBeUndefined();
    expect(await sql`select state from platform.consent_events where e164 = ${number} and app_id = 'ntwrk'`).toEqual([]);
    expect(await sql`select closed_at from platform.seed_invitations`).toEqual([{ closed_at: null }]);

    blockedPhoto = undefined;
    expect((await signup("ntwrk.party", "confirmed-later", "2009-10-10", invitation)).html).toContain("Signup confirmed.");
    expect(await privateRow()).toEqual([{ initial_minor_age: 16, eligible_at: new Date(laterDate) }]);
    const current = (await membership("ntwrk"))!;
    expect(await w.service.people.saveSignupAge(current, number, w.service.accounts.phoneHash(number), {
      initialMinorAge: 17, eligibleAt: firstDate,
    })).toBe(true);
    expect(await w.service.people.saveSignupAge({ ...current, memberId: "replaced-attempt" }, number, w.service.accounts.phoneHash(number), {
      initialMinorAge: 15, eligibleAt: laterDate + HOUR,
    })).toBe(false);
    expect(await privateRow()).toEqual([{ initial_minor_age: 16, eligible_at: new Date(laterDate) }]);
    expect(remove).toHaveBeenCalledTimes(5);
    expect(await sql`select member_id from platform.seed_invitation_attributions`).toEqual([{ member_id: current.memberId }]);
  }, { photoStorage: storage, tokens: "admin@ntwrk:fixture-signup-seed" });
}, 60_000);

test.skipIf(!pgAvailable)("cross-app signup does not freeze a temporary browser birthday age in a network member", async () => {
  await withSignupWorld(["friends:nyc", "peon:nyc"], async w => {
    const site = "friends.help";
    const signedJoin = async (number: string, age: number) => {
      const input: TurnRequest = { channel: "blooio", from: number, to: null, transport: "imessage", app: "peon",
        messageId: `signup-age-partner-${age}`, text: `Peon, Jo, ${age}, New York`, receivedAt: w.clock.now() };
      const body = JSON.stringify(input);
      const signature = await svcSign(signupTurnSecret, { method: "POST", path: TURN_PATH, id: input.messageId, body,
        nowS: Math.floor(w.clock.now() / 1000) });
      const reply = await w.service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, {
        method: "POST", body, headers: { "content-type": "application/json", ...signature },
      }));
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({ outcome: "handled", app: "peon", reason: "joined" });
    };
    const typedJoin = async (number: string, age: number) => {
      w.clock.advance(31_000);
      const post = (path: string, body: unknown, cookie?: string) => w.env.fetch(new Request(`https://peon.biz${path}`, {
        method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      }));
      expect((await post("/api/auth/otp/start", { phone: number })).status).toBe(200);
      const verified = await post("/api/auth/otp/verify", { phone: number, code: w.harness.provider.last(number) });
      expect(verified.status).toBe(200);
      const cookie = verified.headers.getSetCookie()[0]?.split(";")[0];
      expect(cookie).toBeDefined();
      const reply = await post("/api/join", { firstName: "Jo", age, homeCity: "nyc", consent: { sms: true, version: APPS.peon.consent.version } }, cookie);
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({ ok: true });
    };
    const scenarios = [
      { number: "+12125550181", age: 25, before: 17, after: 18, join: signedJoin },
      { number: "+12125550182", age: 16, before: 16, after: 16, join: signedJoin },
      { number: "+12125550183", age: 27, before: 17, after: 18, join: typedJoin },
    ];
    for (const { number, age, join } of scenarios) {
      const browser = browserOn(w, site);
      const opened = await openConnection(w, site, browser, `signup-age-lifecycle-${age}`);
      const rid = hiddenField(opened.html, "rid");
      await confirmPhone(w, browser, rid, number);
      const joined = await submitSignup(browser, rid, { firstName: "Jo", birthdate: "2008-10-10" });
      expect(joined).toMatchObject({ status: 200, html: expect.stringContaining("Signup confirmed.") });
      await join(number, age);
    }
    const friends = w.service.runtimeFor("friends")!;
    const peon = w.service.runtimeFor("peon")!;
    const ages = async (number: string) => {
      const person = (await w.service.accounts.personFor(number))!;
      const member = async (runtime: typeof friends) => {
        const membership = await w.service.people.getMembership(person.id, runtime.app.id);
        if (!membership) throw new Error(`Missing ${runtime.app.id} fixture membership`);
        const ages = await runtime.scoped(async tx => (await tx`select a.age as effective, m.age as recorded
          from network.members m join platform.matching_ages a on a.app_id=m.app_id and a.member_id=m.id
          where m.app_id=${runtime.app.id} and m.id=${membership.memberId}`)[0]);
        const minor = await runtime.readState(n => n.memberList().find(member => member.id === membership.memberId)?.minor);
        return { ...ages, minor };
      };
      return { account: await w.service.accounts.lowestAge(number, person), friends: await member(friends), peon: await member(peon) };
    };
    w.clock.set(Date.UTC(2026, 9, 10, 11, 59, 59));
    for (const { number, before } of scenarios) {
      expect(await ages(number)).toMatchObject({ account: before, friends: { effective: before, minor: true }, peon: { effective: before, minor: true } });
    }
    w.clock.advance(1_000);
    await friends.tick();
    await peon.tick();
    for (const { number, age, after } of scenarios) {
      const minor = !canBeMatched(after);
      expect(await ages(number)).toMatchObject({ account: after, friends: { effective: after, minor }, peon: { effective: after, recorded: age, minor } });
    }
  });
}, 60_000);

// spec/photoRetention.md, "Consent, adult eligibility, and a valid image precede storage"
test.skipIf(!pgAvailable)("cross-app minor signup refuses and removes an in-flight adult photo upload", async () => {
  const objects = new Map<string, Uint8Array>();
  let enterPut!: (key: string) => void;
  let releasePut!: () => void;
  const enteredPut = new Promise<string>(resolve => { enterPut = resolve; });
  const releasedPut = new Promise<void>(resolve => { releasePut = resolve; });
  let puts = 0;
  const storage: PhotoStorage = {
    kind: "local",
    async put(key, bytes) {
      puts++;
      if (puts === 2) {
        enterPut(key);
        await releasedPut;
      }
      objects.set(key, bytes);
    },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
  };
  await withSignupWorld(["slop:nyc", "friends:nyc"], async w => {
    const number = "+12125550186";
    let cookie = "";
    const slop = (path: string, method: string, body?: BodyInit, headers?: Record<string, string>) =>
      w.env.fetch(new Request("https://slop.date" + path, {
        method, body, headers: { cookie, origin: "https://slop.date", ...headers },
      }));
    const json = (path: string, body: unknown) => slop(path, "POST", JSON.stringify(body), { "content-type": "application/json" });
    expect((await json("/api/auth/otp/start", { phone: number })).status).toBe(200);
    const verified = await json("/api/auth/otp/verify", { phone: number, code: w.harness.provider.last(number) });
    expect(verified.status).toBe(200);
    cookie = verified.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^sid_slop=/);
    const joinedSlop = await json("/api/join", {
      firstName: "Jo", age: 29, homeCity: "nyc", consent: { sms: true, version: APPS.slop.consent.version },
    });
    expect(joinedSlop.status).toBe(200);
    expect(await joinedSlop.json()).toMatchObject({ ok: true });
    cookie = joinedSlop.headers.getSetCookie()[0]?.split(";")[0] ?? cookie;
    const person = await w.service.accounts.personFor(number);
    if (!person) throw new Error("No verified Slop person");

    const upload = () => slop("/api/photos", "POST", Uint8Array.from([255,216,255,218,0,2,1,255,217]), {
      "content-type": "image/jpeg", "x-photo-consent": PHOTO_CONSENT.version,
    });
    const list = async () => (await slop("/api/photos", "GET")).json() as Promise<{ eligible: boolean; photos: { id: string }[] }>;
    const currentAge = async () => {
      const owner = await w.service.accounts.personFor(number);
      if (!owner) throw new Error("No person during photo audit");
      return w.service.accounts.lowestAge(number, owner);
    };
    const rows = () => w.connector.store.sql.unsafe<{ id: string; storage_key: string }[]>(
      "select id,storage_key from platform.photos where person_id=$1 and deleted_at is null order by id", [person.id],
    );
    expect(await currentAge()).toBe(29);
    const existingUpload = await upload();
    expect(existingUpload.status).toBe(200);
    const existing = await existingUpload.json() as { id: string };
    expect(await list()).toMatchObject({ eligible: true, photos: [{ id: existing.id }] });

    w.clock.advance(HOUR);
    const friends = browserOn(w, "friends.help");
    const open = await openConnection(w, "friends.help", friends, "photo-upload-age-fence");
    const rid = hiddenField(open.html, "rid");
    await confirmPhone(w, friends, rid, number);
    const inFlight = upload();
    try {
      const delayedKey = await Promise.race([
        enteredPut,
        inFlight.then(result => { throw new Error("Upload returned before storage wait: " + result.status); }),
      ]);
      expect(await rows()).toMatchObject([{ id: existing.id }]);
      const signedUp = await submitSignup(friends, rid, { firstName: "Jo", birthdate: "2008-10-10" });
      expect(signedUp.status).toBe(200);
      expect(signedUp.html).toContain("Signup confirmed.");
      expect(await currentAge()).toBe(17);
      const afterCleanup = await rows();
      expect(afterCleanup).toEqual([]);
      expect(objects.size).toBe(0);
      expect(await list()).toEqual(expect.objectContaining({ eligible: false, photos: [] }));

      releasePut();
      const late = await inFlight;
      expect(late.status).toBe(403);
      expect(await late.json()).toEqual({ ok: false, error: "adults_only" });
      expect(await rows()).toEqual([]);
      expect(objects.has(delayedKey)).toBe(false);
      expect(await list()).toMatchObject({ eligible: false, photos: [] });
      const freshWhileMinor = await upload();
      expect(freshWhileMinor.status).toBe(403);
      expect(puts).toBe(2);

      const birthdayBoundary = Date.UTC(2026, 9, 10, 12);
      w.clock.advance(birthdayBoundary - w.clock.now());
      expect(await currentAge()).toBe(18);
      expect(await list()).toMatchObject({ eligible: true, photos: [] });
      expect(await w.service.photos.staffLinks(person.id, "slop", "https://slop.date"))
        .toEqual({ ok: true, value: [] });
    } finally {
      releasePut();
      await inFlight.catch(() => undefined);
    }
  }, { photoStorage: storage });
}, 60_000);
