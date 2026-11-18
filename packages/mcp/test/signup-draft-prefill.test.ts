// spec/authorizationPages.md, "The signup form shows the draft that the person approved in the agent".
// The normal OAuth browser pages and MCP tools on the real platform; only OTP delivery is a fixture.
import { expect, test } from "vitest";
import { canBeMatched } from "../../core/src/policy.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { MemoryOAuthStore } from "../src/store.ts";
import { pkceS256 } from "../src/util.ts";
import { call, connect, type Env, PHONE_A, PHONE_B, register, setup, VERIFIER } from "./harness.ts";

const ridOf = (html: string) => /name="rid" value="([^"]+)"/.exec(html)?.[1];
const field = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";

/**
 * One authorization request of `clientId` in a browser that holds a verified phone session of that app
 * (no new code is sent, so the per-phone code limit does not apply). Returns the consent page and a form poster.
 */
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

/** The same request, then "Finish signup": the signup form and its submit. */
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

/** Whether the signup form shows the draft (name and city), and never an age or a ticked consent box. */
const shows = (html: string, firstName: string, city: string) =>
  new RegExp(`name="firstName"[^>]*value="${firstName}"`).test(html) && html.includes(`<option value="${city}" selected="">`);
const blank = (html: string) => !/name="firstName"[^>]*value="/.test(html) && !/<option value="(nyc|sf)" selected/.test(html);
const neverPrefilledAgeOrConsent = (html: string) => !/name="age"[^>]*value="/.test(html) && !/name="smsConsent"[^>]*checked/.test(html);

/** A pre-signup grant of a client for a new phone, and the draft it saved for that phone. */
async function draftFor(e: Env, domain: string, phone: string, fields: Record<string, unknown> = { firstName: "Ari", homeCity: "sf" }) {
  const c = await connect(e, domain, phone, { scope: "membership:read profile:write" });
  const saved = await call(e, `https://${domain}/mcp`, "prepare_signup", fields, { token: c.token.access_token });
  expect(saved.body!.result.structuredContent).toMatchObject({ prepared: true });
  return c.client.client_id as string;
}

test("the same client's next authorization shows the approved draft once; the person edits it, types the age and ticks consent", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  const first = await openSignup(e, "friends.help", clientId, PHONE_A);
  expect(shows(first.form, "Ari", "sf")).toBe(true);
  expect(neverPrefilledAgeOrConsent(first.form)).toBe(true);
  expect(first.form).toContain("Finish signup");
  expect(first.form).not.toContain(PHONE_A);
  // Used once: the draft is scrubbed, a reopen of the same request and a new request of the same client get an empty form.
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].map(d => d.fields)).toEqual([{ firstName: "" }]);
  await first.post("/oauth/authorize/signup", { decision: "skip", signupView: field(first.form, "signupView") });
  expect(blank(await (await first.post("/oauth/authorize/signup", { decision: "open" })).text())).toBe(true);
  expect(blank((await openSignup(e, "friends.help", clientId, PHONE_A)).form)).toBe(true);
  // The person changes the name; the form never ticks consent: without the tick nothing is joined.
  const unticked = await first.join({ firstName: "Rae", age: "29", homeCity: "sf" });
  const refused = await unticked.text();
  expect(refused).toContain("Review and accept the current text message terms to continue.");
  expect(shows(refused, "Rae", "sf")).toBe(true);
  expect(neverPrefilledAgeOrConsent(refused)).toBe(true);
  expect(await e.accounts.personFor(PHONE_A)).toBeUndefined();
  const joined = await first.join({ firstName: "Rae", age: "29", homeCity: "sf", smsConsent: "yes" });
  expect(await joined.text()).toContain("Signup confirmed.");
  const person = await e.accounts.personFor(PHONE_A);
  expect((await e.people.getMembership(person!.id, "friends"))!.firstName).toBe("Rae");
});

test("another client, another app, another phone, an expired draft and a stale grant get an empty form and no error", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  // Another client of the same app and phone: empty, and the draft stays for its own client.
  const other = (await register(e, "friends.help")).body.client_id as string;
  const cross = await openSignup(e, "friends.help", other, PHONE_A);
  expect(blank(cross.form)).toBe(true);
  expect(cross.form).not.toContain("This page has expired");
  // Another app on the same phone.
  const ntwrk = (await register(e, "ntwrk.party")).body.client_id as string;
  expect(blank((await openSignup(e, "ntwrk.party", ntwrk, PHONE_A)).form)).toBe(true);
  // The same client with another phone.
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

test("a recorded age below 13 hides and scrubs the draft; an age below 13 on the form is refused and a teen joins unmatched", async () => {
  const e = setup(), clientId = await draftFor(e, "friends.help", PHONE_A);
  await e.accounts.recordAge(PHONE_A, undefined, 12);
  // The draft is scrubbed and no page of the request shows it.
  expect([...(e.store as MemoryOAuthStore).signupDrafts.values()].map(d => d.fields)).toEqual([{ firstName: "" }]);
  const minor = await authorize(e, "friends.help", clientId, PHONE_A);
  expect(minor.consent).not.toContain("Ari");
  const opened = await (await minor.post("/oauth/authorize/signup", { decision: "open" })).text();
  expect(opened).not.toContain("Ari");
  expect(blank(opened)).toBe(true);

  const child = setup(), childClient = await draftFor(child, "friends.help", PHONE_A);
  const page = await openSignup(child, "friends.help", childClient, PHONE_A);
  expect(shows(page.form, "Ari", "sf")).toBe(true);
  const refused = await (await page.join({ firstName: "Ari", age: "12", homeCity: "sf", smsConsent: "yes" })).text();
  expect(refused).toContain("You can’t join this app at the age entered.");
  expect(neverPrefilledAgeOrConsent(refused)).toBe(true);
  expect(await child.accounts.personFor(PHONE_A)).toBeUndefined();

  // The lowest stated age wins: a teen age already recorded beats the adult age on the form, and a teen is never matched.
  const teen = setup(), teenClient = await draftFor(teen, "friends.help", PHONE_A);
  await teen.accounts.recordAge(PHONE_A, undefined, 15);
  const teenPage = await openSignup(teen, "friends.help", teenClient, PHONE_A);
  expect(shows(teenPage.form, "Ari", "sf")).toBe(true);
  expect(await (await teenPage.join({ firstName: "Ari", age: "29", homeCity: "sf", smsConsent: "yes" })).text()).toContain("Signup confirmed.");
  const person = await teen.accounts.personFor(PHONE_A);
  const lowest = (await teen.people.getPerson(person!.id))!.lowestAge;
  expect(lowest).toBe(15);
  expect(canBeMatched(lowest)).toBe(false);
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
    // A new draft of the same client shows on the real signup page through the Postgres store.
    const again = await draftFor(e, "friends.help", PHONE_A, { firstName: "Rae", homeCity: "nyc" });
    expect(shows((await openSignup(e, "friends.help", again, PHONE_A)).form, "Rae", "nyc")).toBe(true);
  } finally { await store.close(); await dropTestDb(); }
});
