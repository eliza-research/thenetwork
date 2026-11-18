// End to end: the connector's "Finish signup" on the OAuth authorization page, through the built sites,
// the production router, the shared backend, the MCP server and Postgres (harness.ts). The browser holds
// the cookies and types the phone and the code; the assistant only registers, exchanges the code and
// calls tools. Then every tool on every app and surface: each link it returns must be a served route.
//   pnpm test:e2e
// spec/oauthBrowserAuthorization.md, "Optional signup stays inside the verified authorization request"
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, VERIFIER, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

/** A hosted assistant's redirect: registrations from one address use the assistant limit. */
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const DOMAINS: Record<AppId, string> = { ntwrk: "ntwrk.party", slop: "slop.date", peon: "peon.biz", friends: "friends.help" };

let st: Stack;
let sql: SQL;

const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];

/** One connector connection as the assistant and the person's browser make it, step by step. */
async function authorize(app: AppId, b: Browser) {
  const reg = await st.site(app, "/oauth/register", { json: { client_name: "E2E Assistant", redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" } });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const resource = `${st.sites[app].origin}/mcp`;
  const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE, code_challenge: pkceS256(VERIFIER), code_challenge_method: "S256", state: "e2e", resource });
  const page = await st.site(app, `/oauth/authorize?${q}`, { browser: b });
  const html = await page.text();
  const rid = hidden(html, "rid");
  if (!rid) throw new Error(`no request on ${app}: ${page.status}`);
  return { client: client.client_id, resource, rid, html, status: page.status };
}

async function confirmPhone(app: AppId, b: Browser, rid: string, phone: string) {
  st.clock.advance(31_000);
  const sent = await st.site(app, "/oauth/authorize/phone", { browser: b, form: { rid, phone } });
  expect(sent.status).toBe(200);
  const res = await st.site(app, "/oauth/authorize/code", { browser: b, form: { rid, code: st.otp.last(phone) ?? "000000" } });
  return { res, html: await res.text() };
}

async function finishSignup(app: AppId, b: Browser, rid: string, fields: Record<string, string>) {
  const opened = await st.site(app, "/oauth/authorize/signup", { browser: b, form: { rid, decision: "open" } });
  const form = await opened.text();
  expect(opened.status, form.slice(0, 300)).toBe(200);
  const res = await st.site(app, "/oauth/authorize/signup", {
    browser: b,
    form: { rid, decision: "join", signupView: hidden(form, "signupView")!, consentVersion: hidden(form, "consentVersion")!, smsConsent: "yes", ...fields },
  });
  return { res, html: await res.text(), form };
}

/** Allow on the consent page, then the assistant's code exchange. */
async function allow(app: AppId, b: Browser, c: { client: string; resource: string; rid: string }, html: string) {
  const approval = hidden(html, "signupApproval");
  const done = await st.site(app, "/oauth/authorize/consent", { browser: b, form: { rid: c.rid, decision: "approve", ...(approval ? { signupApproval: approval } : {}) } });
  expect(done.status).toBe(303);
  const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
  const tok = await st.site(app, "/oauth/token", { form: { grant_type: "authorization_code", code, redirect_uri: CLAUDE, client_id: c.client, code_verifier: VERIFIER, resource: c.resource } });
  expect(tok.status).toBe(200);
  return ((await tok.json()) as { access_token: string }).access_token;
}

const status = async (app: AppId, token: string) => toolData(await rpc(st, app, "/mcp", "tools/call", { name: "check_status", arguments: {} }, token));
const memberships = async (phone: string) =>
  ((await sql`select ms.app_id from platform.memberships ms join platform.phone_identities ph on ph.person_id = ms.person_id where ph.e164 = ${phone} order by ms.app_id`) as { app_id: string }[]).map(r => r.app_id);
const personOf = async (phone: string) => (await st.svc.publicApi.accounts.personFor(phone))?.id;
const banPhone = (phone: string) => st.svc.people.ban({
  id: crypto.randomUUID(), scope: "phone", personId: null, phoneHash: st.svc.publicApi.accounts.phoneHash(phone),
  reason: "owned fixture", reportId: null, bannedBy: "fixture", at: st.clock.now(),
});
const adult = { firstName: "Ari", age: "29", homeCity: "nyc" };

describe.skipIf(!pgAvailable)("connector Finish signup through HTTP", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  for (const app of ["slop", "friends"] as const) {
    test(`${app}: an adult joins an open app, allows access, and check_status shows the new membership`, async () => {
      const phone = newPhone(), b = new Browser();
      const c = await authorize(app, b);
      const verified = await confirmPhone(app, b, c.rid, phone);
      expect(verified.html).toContain('action="/oauth/authorize/signup"');
      const joined = await finishSignup(app, b, c.rid, adult);
      expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
      expect(await memberships(phone)).toEqual([app]);
      const token = await allow(app, b, c, joined.html);
      expect(await status(app, token)).toMatchObject({ app, status: expect.stringMatching(/^(active|onboarding)$/) });
    }, T);
  }

  test("ntwrk is invite-only: no invitation stores nothing; a staff invitation lets the same person join", async () => {
    const phone = newPhone(), b = new Browser();
    const c = await authorize("ntwrk", b);
    await confirmPhone("ntwrk", b, c.rid, phone);
    const refused = await finishSignup("ntwrk", b, c.rid, adult);
    expect(refused.res.status).toBe(400);
    expect(refused.html).toContain("Enter a valid invitation for this app.");
    const forged = await finishSignup("ntwrk", b, c.rid, { ...adult, invitation: "A".repeat(43) });
    expect(forged.res.status).toBe(400);
    expect(await personOf(phone)).toBeUndefined();
    expect(await memberships(phone)).toEqual([]);

    expect((await st.staff("/apps/ntwrk/invite", { phone })).status).toBe(200);
    const invited = await authorize("ntwrk", b);
    expect(invited.html).toContain('action="/oauth/authorize/signup"');
    const joined = await finishSignup("ntwrk", b, invited.rid, adult);
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    const token = await allow("ntwrk", b, invited, joined.html);
    expect(await status("ntwrk", token)).toMatchObject({ app: "ntwrk", status: expect.stringMatching(/^(active|onboarding)$/) });
  }, T);

  test("a 15-year-old joins and is never matched; an under-13 person is declined with nothing stored, also on a retry", async () => {
    const teen = newPhone(), tb = new Browser();
    const t = await authorize("friends", tb);
    await confirmPhone("friends", tb, t.rid, teen);
    const joined = await finishSignup("friends", tb, t.rid, { ...adult, firstName: "Kai", age: "15" });
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    const member = (await sql`select m.id, m.age from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${teen}`)[0] as { id: string; age: number };
    expect(member.age).toBe(15);
    const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends")!;
    expect(rt.net.member(member.id as never).minor).toBe(true);

    const child = newPhone(), cb = new Browser();
    const c = await authorize("friends", cb);
    await confirmPhone("friends", cb, c.rid, child);
    for (const age of ["12", "25"]) {
      const declined = await finishSignup("friends", cb, c.rid, { ...adult, firstName: "Mo", age });
      expect(declined.res.status).toBe(400);
      expect(declined.html).toContain("You can’t join this app at the age entered.");
    }
    expect(await personOf(child)).toBeUndefined();
    expect(await memberships(child)).toEqual([]);
  }, T);

  test("a banned number gets no code; a ban after the code ends the signup with nothing stored", async () => {
    const before = newPhone(), b1 = new Browser();
    await banPhone(before);
    const c1 = await authorize("friends", b1);
    const sentBefore = st.otp.sent.length;
    const verified = await confirmPhone("friends", b1, c1.rid, before);
    expect(st.otp.sent.length).toBe(sentBefore);
    expect(verified.html).not.toContain('action="/oauth/authorize/signup"');
    expect(await memberships(before)).toEqual([]);

    const after = newPhone(), b2 = new Browser();
    const c2 = await authorize("slop", b2);
    expect((await confirmPhone("slop", b2, c2.rid, after)).html).toContain('action="/oauth/authorize/signup"');
    await banPhone(after);
    const opened = await st.site("slop", "/oauth/authorize/signup", { browser: b2, form: { rid: c2.rid, decision: "open" } });
    expect(opened.status).toBe(400);
    expect(await personOf(after)).toBeUndefined();
    expect(await memberships(after)).toEqual([]);
  }, T);

  test("a held number cannot reach consent or signup", async () => {
    const phone = newPhone();
    expect((await webJoin(st, "peon", phone, { age: 30 })).res.status).toBe(200);
    await st.svc.people.setPhoneHold(phone, "recycled_number", st.clock.now());
    const b = new Browser();
    const c = await authorize("friends", b);
    const verified = await confirmPhone("friends", b, c.rid, phone);
    expect(verified.res.status).toBe(403);
    expect(verified.html).toContain("We need to check this number");
    expect(await memberships(phone)).toEqual(["peon"]);
  }, T);

  // spec/connectorTools.md, "The member status decides which member tool can act"
  test("a person who allowed access without joining follows check_status back to Finish signup, then joins a second app", async () => {
    const phone = newPhone(), b = new Browser();
    const first = await authorize("friends", b);
    const verified = await confirmPhone("friends", b, first.rid, phone);
    const skipped = await allow("friends", b, first, verified.html);
    const notJoined = await status("friends", skipped);
    expect(notJoined).toMatchObject({ app: "friends", status: "not_joined" });
    expect(notJoined.next_step).toContain("disconnect friends.help in your agent's connector settings, then connect it again");
    expect(notJoined.next_step).toContain("Finish signup");

    // The next step: a new connection in the same browser offers Finish signup at once.
    const again = await authorize("friends", b);
    expect(again.html).toContain('action="/oauth/authorize/signup"');
    const joined = await finishSignup("friends", b, again.rid, adult);
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    const token = await allow("friends", b, again, joined.html);
    expect(await status("friends", token)).toMatchObject({ app: "friends", status: expect.stringMatching(/^(active|onboarding)$/) });
    // The grant made before the person existed ends at its next use.
    expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, skipped)).res.status).toBe(401);

    const person = await personOf(phone);
    const slop = await authorize("slop", b);
    expect((await confirmPhone("slop", b, slop.rid, phone)).html).toContain('action="/oauth/authorize/signup"');
    const second = await finishSignup("slop", b, slop.rid, adult);
    expect(second.res.status, second.html.slice(0, 300)).toBe(200);
    expect(await personOf(phone)).toBe(person);
    expect(await memberships(phone)).toEqual(["friends", "slop"]);
  }, T);

  test("every link that any tool returns, on every app and surface, is a served route", async () => {
    const links = new Set<string>();
    const collect = (value: unknown) => {
      const text = JSON.stringify(value ?? null);
      for (const m of text.matchAll(/(?:https?:\/\/|mailto:)[^\s"'<>)\\]+/g)) links.add(m[0].replace(/[.,;:]+$/, ""));
    };
    for (const app of Object.keys(DOMAINS) as AppId[]) {
      for (const path of ["/mcp", "/mcp/openai"] as const) {
        const listed = await rpc(st, app, path, "tools/list");
        if (listed.res.status === 404) continue;
        const tools = (listed.body!.result.tools as { name: string; description: string }[]);
        collect(tools.map(t => t.description));
        const ids = ((toolData(await rpc(st, app, path, "tools/call", { name: "app_info", arguments: {} })) as { apps: { id: string }[] }).apps).map(a => a.id);
        collect(toolData(await rpc(st, app, path, "tools/call", { name: "app_info", arguments: {} })));
        for (const id of ids) {
          collect(toolData(await rpc(st, app, path, "tools/call", { name: "app_info", arguments: { app: id } })));
          collect(toolData(await rpc(st, app, path, "tools/call", { name: "start_signup", arguments: { app: id } })));
        }
        // A connection of a person who has not joined, then of an active member.
        for (const joined of [false, true]) {
          // ntwrk has no open web join; its invited member is covered above.
          if (joined && app === "ntwrk") continue;
          const phone = newPhone();
          if (joined) expect((await webJoin(st, app, phone, { age: 30 })).res.status).toBe(200);
          const c = await connectMcp(st, app, phone, { path, redirect: CLAUDE });
          const token = c.token?.access_token as string;
          expect(token).toBeTruthy();
          for (const name of tools.map(t => t.name).filter(n => n !== "app_info" && n !== "start_signup")) {
            const args = name === "submit_profile" ? { about: "I like long walks and board games." } : {};
            collect(toolData(await rpc(st, app, path, "tools/call", { name, arguments: args }, token)));
          }
        }
      }
    }
    expect(links.size).toBeGreaterThan(0);
    for (const link of links) {
      if (link.startsWith("mailto:")) { expect(link).toBe("mailto:help@ntwrk.party"); continue; }
      const url = new URL(link);
      const app = (Object.keys(DOMAINS) as AppId[]).find(id => DOMAINS[id] === url.host);
      if (!app) { expect(url.host, link).toBe("ntwrk.party"); continue; }
      let res = await st.site(app, url.pathname + url.search);
      for (let hops = 0; hops < 3 && res.status >= 300 && res.status < 400; hops++) {
        const next = new URL(res.headers.get("location")!, st.sites[app].origin);
        res = await st.site(app, next.pathname + next.search);
      }
      expect(res.status, link).toBe(200);
    }
  }, T * 2);
});
