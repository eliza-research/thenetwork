import { expect, test } from "vitest";
import { canBeMatched } from "../../core/src/policy.ts";
import { dropTestDb, pgAvailable, testDb } from "../../../apps/observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { MemoryOAuthStore } from "../src/store.ts";
import { pkceS256 } from "../src/util.ts";
import { call, connect, type Env, PHONE_A, PHONE_B, register, setup, VERIFIER } from "./harness.ts";

const ridOf = (html: string) => /name="rid" value="([^"]+)"/.exec(html)?.[1];
const field = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";

async function authorize(e: Env, domain: string, clientId: string, phone: string) {
  const app = domain === "ntwrk.party" ? "ntwrk" : "friends";
  const cookies = new Map<string, string>([[`sid_${app}`, (await e.sessions.create(app, phone, null)).token]]);
  const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const keep = (response: Response) => {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0]!, at = pair.indexOf("=");
      if (pair.slice(at + 1)) cookies.set(pair.slice(0, at), pair.slice(at + 1)); else cookies.delete(pair.slice(0, at));
    }
    return response;
  };
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: "https://client.example/callback",
    code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "st-prefill", scope: "membership:read profile:write",
  });
  const start = keep(await e.fetch(new Request(`https://${domain}/oauth/authorize?${q}`, { headers: { cookie: cookie() } })));
  const consent = await start.text();
  const rid = ridOf(consent);
  if (!rid) throw new Error(`no authorization page: ${consent.slice(0, 200)}`);
  const post = async (path: string, form: Record<string, string>) => keep(await e.fetch(new Request(`https://${domain}${path}`, {
    method: "POST", body: new URLSearchParams({ rid, ...form }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://${domain}`, cookie: cookie() },
  })));
  return { consent, post };
}

async function openSignup(e: Env, domain: string, clientId: string, phone: string) {
  const { consent, post } = await authorize(e, domain, clientId, phone);
  expect(consent).toContain('action="/oauth/authorize/signup"');
  const signup = await post("/oauth/authorize/signup", { decision: "open" });
  expect(signup.status).toBe(200);
  const form = await signup.text();
  const join = (fields: Record<string, string>) => post("/oauth/authorize/signup", {
    decision: "join", signupView: field(form, "signupView"), consentVersion: field(form, "consentVersion"), ...fields,
  });
  return { form, post, join };
}

const shows = (html: string, firstName: string, city: string) =>
  new RegExp(`name="firstName"[^>]*value="${firstName}"`).test(html) && html.includes(`<option value="${city}" selected="">`);
const blank = (html: string) => !/name="firstName"[^>]*value="/.test(html) && !/<option value="(nyc|sf)" selected/.test(html);
const neverPrefilledAgeOrConsent = (html: string) => !/name="age"/.test(html) && !/name="birthdate"[^>]*value="/.test(html) && !/name="smsConsent"[^>]*checked/.test(html);

async function draftFor(e: Env, domain: string, phone: string, fields: Record<string, unknown> = { firstName: "Ari", homeCity: "sf" }) {
  const c = await connect(e, domain, phone, { scope: "membership:read profile:write" });
  const saved = await call(e, `https://${domain}/mcp`, "prepare_signup", fields, { token: c.token.access_token });
  expect(saved.body!.result.structuredContent).toMatchObject({ prepared: true });
  return c.client.client_id as string;
}

test("the same client's next authorization shows the approved draft once; the person edits it, types the birthday and ticks consent", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  const first = await openSignup(e, "friends.help", clientId, PHONE_A);
  expect(shows(first.form, "Ari", "sf")).toBe(true);
  expect(neverPrefilledAgeOrConsent(first.form)).toBe(true);
  expect(first.form).toContain("Finish signup");
  expect(first.form).not.toContain(PHONE_A);
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].map(d => d.fields)).toEqual([{ firstName: "" }]);
  await first.post("/oauth/authorize/signup", { decision: "skip", signupView: field(first.form, "signupView") });
  expect(blank(await (await first.post("/oauth/authorize/signup", { decision: "open" })).text())).toBe(true);
  expect(blank((await openSignup(e, "friends.help", clientId, PHONE_A)).form)).toBe(true);
  const unticked = await first.join({ firstName: "Rae", birthdate: "1997-01-15", homeCity: "sf" });
  const refused = await unticked.text();
  expect(refused).toContain("Review and accept the current text message terms to continue.");
  expect(shows(refused, "Rae", "sf")).toBe(true);
  expect(neverPrefilledAgeOrConsent(refused)).toBe(true);
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  const joined = await first.join({ firstName: "Rae", birthdate: "1997-01-15", homeCity: "sf", smsConsent: "yes" });
  expect(await joined.text()).toContain("Signup confirmed.");
  const person = await e.accounts.personFor(PHONE_A);
  expect((await e.people.getMembership(person!.id, "friends"))!.firstName).toBe("Rae");
});

test("another client, another app, another phone, an expired draft and a stale grant get an empty form and no error", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  const other = (await register(e, "friends.help")).body.client_id as string;
  const cross = await openSignup(e, "friends.help", other, PHONE_A);
  expect(blank(cross.form)).toBe(true);
  expect(cross.form).not.toContain("This page has expired");
  const ntwrk = (await register(e, "ntwrk.party")).body.client_id as string;
  expect(blank((await openSignup(e, "ntwrk.party", ntwrk, PHONE_A)).form)).toBe(true);
  expect(blank((await openSignup(e, "friends.help", clientId, PHONE_B)).form)).toBe(true);
  expect(shows((await openSignup(e, "friends.help", clientId, PHONE_A)).form, "Ari", "sf")).toBe(true);

  const late = setup(), lateClient = await draftFor(late, "friends.help", PHONE_A);
  late.clock.t += 10 * 60_000;
  expect(blank((await openSignup(late, "friends.help", lateClient, PHONE_A)).form)).toBe(true);

  const revoked = setup(), revokedClient = await draftFor(revoked, "friends.help", PHONE_A);
  const [grant] = await revoked.store.grantsFor(revoked.accounts.phoneHash(PHONE_A), "friends", revoked.clock.t);
  await revoked.store.revokeGrant(grant!.id, revoked.clock.t);
  expect(blank((await openSignup(revoked, "friends.help", revokedClient, PHONE_A)).form)).toBe(true);
});

test("a recorded age below 13 hides and scrubs the draft; a birthday below 13 on the form is refused and a teen joins unmatched", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  await e.accounts.recordAge(PHONE_A, undefined, 12);
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].map(d => d.fields)).toEqual([{ firstName: "" }]);
  const minor = await authorize(e, "friends.help", clientId, PHONE_A);
  expect(minor.consent).not.toMatch(/\bAri\b/);
  const opened = await (await minor.post("/oauth/authorize/signup", { decision: "open" })).text();
  expect(opened).not.toMatch(/\bAri\b/);
  expect(blank(opened)).toBe(true);

  const child = setup(), childClient = await draftFor(child, "friends.help", PHONE_A);
  const page = await openSignup(child, "friends.help", childClient, PHONE_A);
  expect(shows(page.form, "Ari", "sf")).toBe(true);
  const refused = await (await page.join({ firstName: "Ari", birthdate: "2014-01-15", homeCity: "sf", smsConsent: "yes" })).text();
  expect(refused).toContain("You can’t join this app with the birthday entered.");
  expect(neverPrefilledAgeOrConsent(refused)).toBe(true);
  expect(await child.accounts.personFor(PHONE_A)).toBeUndefined();

  const teen = setup(), teenClient = await draftFor(teen, "friends.help", PHONE_A);
  await teen.accounts.recordAge(PHONE_A, undefined, 15);
  const teenPage = await openSignup(teen, "friends.help", teenClient, PHONE_A);
  expect(shows(teenPage.form, "Ari", "sf")).toBe(true);
  expect(await (await teenPage.join({ firstName: "Ari", birthdate: "1997-01-15", homeCity: "sf", smsConsent: "yes" })).text()).toContain("Signup confirmed.");
  const person = await teen.accounts.personFor(PHONE_A);
  const lowest = (await teen.people.getPerson(person!.id))!.lowestAge;
  expect(lowest).toBe(15);
  expect(canBeMatched(lowest)).toBe(false);
});

test("a verified signup birthday advances the member's age when the Clock reaches the birthday", async () => {
  const e = setup();
  e.clock.t = Date.UTC(2026, 9, 7, 12);
  const clientId = await draftFor(e, "friends.help", PHONE_A);
  const page = await openSignup(e, "friends.help", clientId, PHONE_A);
  const response = await page.join({ firstName: "Ari", birthdate: "2008-10-08", homeCity: "sf", smsConsent: "yes" });
  expect(await response.text()).toContain("Signup confirmed.");
  const currentAge = async () => e.accounts.lowestAge(PHONE_A, await e.accounts.personFor(PHONE_A));

  e.clock.t = Date.UTC(2026, 9, 8, 11, 59, 59);
  expect(await currentAge()).toBe(17);
  e.clock.t = Date.UTC(2026, 9, 8, 12);
  expect(await currentAge()).toBe(18);
});

test("a verified birthday keeps a lower age previously stated on the phone", async () => {
  const e = setup();
  e.clock.t = Date.UTC(2026, 9, 7, 12);
  await e.accounts.recordAge(PHONE_A, undefined, 16);
  const clientId = await draftFor(e, "friends.help", PHONE_A);
  const page = await openSignup(e, "friends.help", clientId, PHONE_A);
  const response = await page.join({ firstName: "Ari", birthdate: "2008-10-08", homeCity: "sf", smsConsent: "yes" });
  expect(await response.text()).toContain("Signup confirmed.");

  e.clock.t = Date.UTC(2026, 9, 8, 12);
  expect(await e.accounts.lowestAge(PHONE_A, await e.accounts.personFor(PHONE_A))).toBe(16);
});

test("the birthday is refused when it is missing, malformed, impossible, in the future or over 120 years ago, and the age counts on the Clock date", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  const page = await openSignup(e, "friends.help", clientId, PHONE_A);
  expect(page.form).toContain('name="birthdate"');
  expect(page.form).toContain('type="date"');
  expect(page.form).not.toContain('name="age"');
  for (const birthdate of ["", "1997-1-15", "15/01/1997", "1997-02-30", "2023-02-29", "1997-13-01", "2026-10-09", "1905-10-07", "29"]) {
    const sent = { firstName: "Ari", homeCity: "sf", smsConsent: "yes", ...(birthdate ? { birthdate } : {}) };
    const refused = await page.join(sent);
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(html).toContain("Enter your birthday. It must be a real date, not after today.");
    expect(/<input[^>]*name="birthdate"[^>]*>/.exec(html)?.[0]).toContain('aria-invalid="true"');
    if (birthdate.length > 4) expect(html).not.toContain(birthdate);
    expect(neverPrefilledAgeOrConsent(html)).toBe(true);
    expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  }
  const dayBefore = await (await page.join({ firstName: "Ari", birthdate: "2013-10-09", homeCity: "sf", smsConsent: "yes" })).text();
  expect(dayBefore).toContain("You can’t join this app with the birthday entered.");
  expect(dayBefore).not.toContain("2013-10-09");
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();

  const leap = setup(), leapClient = await draftFor(leap, "friends.help", PHONE_A);
  const leapPage = await openSignup(leap, "friends.help", leapClient, PHONE_A);
  expect(await (await leapPage.join({ firstName: "Ari", birthdate: "2012-02-29", homeCity: "sf", smsConsent: "yes" })).text()).toContain("Signup confirmed.");
  const leapPerson = (await leap.accounts.personFor(PHONE_A))!;
  expect(leapPerson.lowestAge).toBeNull();
  expect(await leap.accounts.lowestAge(PHONE_A, leapPerson)).toBe(14);

  const birthday = setup(), birthdayClient = await draftFor(birthday, "friends.help", PHONE_A);
  const birthdayPage = await openSignup(birthday, "friends.help", birthdayClient, PHONE_A);
  expect(await (await birthdayPage.join({ firstName: "Ari", birthdate: "2013-10-08", homeCity: "sf", smsConsent: "yes" })).text()).toContain("Signup confirmed.");
  const birthdayPerson = (await birthday.accounts.personFor(PHONE_A))!;
  expect(birthdayPerson.lowestAge).toBeNull();
  const thirteen = await birthday.accounts.lowestAge(PHONE_A, birthdayPerson);
  expect(thirteen).toBe(13);
  expect(canBeMatched(thirteen)).toBe(false);
});

test.skipIf(!pgAvailable)("on Postgres the draft shows on one form only, also when two forms of the same client open at once", async () => {
  const store = new PgOAuthStore(await testDb());
  try {
    const e = setup({ store }), clientId = await draftFor(e, "friends.help", PHONE_A);
    const key = e.accounts.phoneHash(PHONE_A);
    const other = (await register(e, "friends.help")).body.client_id as string;
    expect(await store.useSignupPrefill({ clientId: other, app: "friends", phoneKey: key, personId: null, ageAllowed: true }, e.clock.t)).toBeUndefined();
    expect(await store.useSignupPrefill({ clientId, app: "friends", phoneKey: key, personId: null, ageAllowed: false }, e.clock.t)).toBeUndefined();
    const restarted = new PgOAuthStore(store.sql);
    const ask = { clientId, app: "friends" as const, phoneKey: key, personId: null, ageAllowed: true };
    const pair = await Promise.all([store.useSignupPrefill(ask, e.clock.t), restarted.useSignupPrefill(ask, e.clock.t)]);
    expect(pair.filter(Boolean)).toEqual([{ firstName: "Ari", homeCity: "sf" }]);
    expect((await store.sql`select fields, consumed_at is not null as used from oauth.signup_drafts where phone_key=${key}`)).toEqual([{ fields: {}, used: true }]);
    expect(blank((await openSignup(e, "friends.help", clientId, PHONE_A)).form)).toBe(true);
    const again = await draftFor(e, "friends.help", PHONE_A, { firstName: "Rae", homeCity: "nyc" });
    expect(shows((await openSignup(e, "friends.help", again, PHONE_A)).form, "Rae", "nyc")).toBe(true);
  } finally { await store.close(); await dropTestDb(); }
});
