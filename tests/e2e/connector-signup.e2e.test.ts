import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import { newMemberInvitation, storeMemberInvitation } from "../../packages/platform/src/invite-links.ts";
import { Browser, connectMcp, newPhone, pgAvailable, rpc, startStack, toolData, VERIFIER, webJoin, type Stack } from "./harness.ts";

const T = 180_000;

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const DOMAINS: Record<AppId, string> = { ntwrk: "ntwrk.party", slop: "slop.date", peon: "peon.biz", friends: "friends.help" };

let st: Stack;
let sql: SQL;

const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];

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
const DEV_PLATFORM_HASH_KEY = "dev-only-platform-hash-key";
const memberIdOf = async (phone: string, app: AppId) => ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
  where m.app_id = ${app} and ph.e164 = ${phone}`)[0] as { id: string } | undefined)?.id;
const draftRows = async (phone: string, app: AppId) => Number(((await sql`select count(*)::int as n from oauth.signup_drafts
  where phone_key = ${st.svc.publicApi.accounts.phoneHash(phone)} and app_id = ${app}`)[0] as { n: number }).n);

async function saveDraft(app: AppId, phone: string, b: Browser) {
  const c = await authorize(app, b);
  const verified = await confirmPhone(app, b, c.rid, phone);
  const token = await allow(app, b, c, verified.html);
  const saved = toolData(await rpc(st, app, "/mcp", "tools/call", { name: "prepare_signup", arguments: { firstName: "Ari", homeCity: "sf" } }, token));
  expect(saved).toMatchObject({ prepared: true, app, next_step: expect.stringContaining("Finish signup") });
  expect(await draftRows(phone, app)).toBe(1);
  return token;
}

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
    expect(invited.html).not.toContain('action="/oauth/authorize/signup"');
    expect(invited.html).toContain('action="/oauth/authorize/phone"');
    const reverified = await confirmPhone("ntwrk", b, invited.rid, phone);
    expect(reverified.html).toContain('action="/oauth/authorize/signup"');
    const joined = await finishSignup("ntwrk", b, invited.rid, adult);
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    const token = await allow("ntwrk", b, invited, joined.html);
    expect(await status("ntwrk", token)).toMatchObject({ app: "ntwrk", status: expect.stringMatching(/^(active|onboarding)$/) });
  }, T);

  test("ntwrk: a member's invitation link typed at Finish signup joins; an unknown link is refused with nothing stored", async () => {
    const inviterPhone = newPhone();
    expect((await st.staff("/apps/ntwrk/invite", { phone: inviterPhone })).status).toBe(200);
    expect((await webJoin(st, "ntwrk", inviterPhone, { age: 34, firstName: "Ari", homeCity: "nyc" })).res.status).toBe(200);
    const inviter = await memberIdOf(inviterPhone, "ntwrk");
    expect(inviter).toEqual(expect.any(String));
    const issued = newMemberInvitation(DEV_PLATFORM_HASH_KEY, "ntwrk");
    await storeMemberInvitation(sql, "ntwrk", { tokenHash: issued.tokenHash, inviterMemberId: inviter! }, "friend", st.clock.now());
    const unknown = newMemberInvitation(DEV_PLATFORM_HASH_KEY, "ntwrk");

    const phone = newPhone(), b = new Browser();
    const c = await authorize("ntwrk", b);
    expect((await confirmPhone("ntwrk", b, c.rid, phone)).html).toContain('action="/oauth/authorize/signup"');
    const refused = await finishSignup("ntwrk", b, c.rid, { ...adult, firstName: "Maya", invitation: `https://ntwrk.party/SKILL.md#invite=${unknown.token}` });
    expect(refused.res.status).toBe(400);
    expect(refused.html).toContain("Enter a current invitation for this app.");
    expect(await personOf(phone)).toBeUndefined();
    expect(await memberships(phone)).toEqual([]);
    expect(await sql`select step from oauth.auth_requests where id = ${c.rid}`).toEqual([{ step: "consent" }]);
    expect(await sql`select redeemed_at from platform.member_invitations where token_hash = ${issued.tokenHash}`).toEqual([{ redeemed_at: null }]);

    const joined = await finishSignup("ntwrk", b, c.rid, { ...adult, firstName: "Maya", invitation: `https://ntwrk.party/SKILL.md#invite=${issued.token}` });
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    expect(await memberships(phone)).toEqual(["ntwrk"]);
    const invitee = await memberIdOf(phone, "ntwrk");
    expect(await sql`select redeemed_member_id from platform.member_invitations where token_hash = ${issued.tokenHash}`).toEqual([{ redeemed_member_id: invitee }]);
    expect(await sql`select invited_by from network.members where app_id = 'ntwrk' and id = ${invitee!}`).toEqual([{ invited_by: inviter }]);
    const token = await allow("ntwrk", b, c, joined.html);
    expect(await status("ntwrk", token)).toMatchObject({ app: "ntwrk", status: expect.stringMatching(/^(active|onboarding)$/) });
  }, T);

  test("a Finish signup posted with an outdated text message terms version is refused with nothing stored", async () => {
    const phone = newPhone(), b = new Browser();
    const c = await authorize("slop", b);
    expect((await confirmPhone("slop", b, c.rid, phone)).html).toContain('action="/oauth/authorize/signup"');
    const stale = await finishSignup("slop", b, c.rid, { ...adult, consentVersion: "outdated-terms-version" });
    expect(stale.res.status).toBe(400);
    expect(stale.html).toContain("Review and accept the current text message terms to continue.");
    expect(await personOf(phone)).toBeUndefined();
    expect(await memberships(phone)).toEqual([]);
    expect(await sql`select step from oauth.auth_requests where id = ${c.rid}`).toEqual([{ step: "consent" }]);
    const current = await finishSignup("slop", b, c.rid, adult);
    expect(current.res.status, current.html.slice(0, 300)).toBe(200);
    expect(await memberships(phone)).toEqual(["slop"]);
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

    const adults: string[] = [];
    for (const [i, firstName] of ["Ana", "Ben", "Cy", "Di"].entries()) {
      const p = newPhone();
      adults.push(p);
      expect((await webJoin(st, "friends", p, { age: 25 + i, firstName, interests: ["climbing", "board games"] })).res.status).toBe(200);
    }
    for (const p of [...adults, teen]) {
      await st.text(p, "I want to find people to go climbing with this weekend, and to play board games.");
      await st.text(p, "Weekends mostly, I'm around Williamsburg.");
      await st.text(p, "Small groups are great.");
    }
    for (const p of [...adults, teen]) await st.text(p, "Find me someone to go bouldering with in Brooklyn this Saturday afternoon");
    for (const p of [...adults, teen]) {
      const [row] = await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${p}`;
      for (const check of ["age", "liveness"]) expect((await st.staff(`/apps/friends/members/${(row as { id: string }).id}/verify`, { check, result: "pass", note: "e2e staff check" })).status).toBe(200);
    }
    expect((await st.staff("/apps/friends/matching", { on: true })).status).toBe(200);
    for (let day = 0; day < 3; day++) {
      for (const r of st.svc.runtimes.values()) await r.tick();
      st.clock.advance(86_400_000);
    }
    const opportunities = await sql<{ parts: string[] }[]>`select array_agg(p.member_id) as parts from network.opportunities o
      join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = 'friends' group by o.id`;
    expect(opportunities.length).toBeGreaterThan(0);
    for (const o of opportunities) expect(o.parts).not.toContain(member.id);
    expect((await sql`select 1 from network.participations where member_id = ${member.id}`).length).toBe(0);
    expect(rt.net.packInput(st.clock.now()).members.map(m => m.id)).not.toContain(member.id);

    const child = newPhone(), cb = new Browser();
    const c = await authorize("friends", cb);
    await confirmPhone("friends", cb, c.rid, child);
    const declined = await finishSignup("friends", cb, c.rid, { ...adult, firstName: "Mo", age: "12" });
    expect(declined.res.status).toBe(400);
    expect(declined.html).toContain("You can’t join this app at the age entered.");
    const reopened = await st.site("friends", "/oauth/authorize/signup", { browser: cb, form: { rid: c.rid, decision: "open" } });
    expect(reopened.status).toBe(400);
    expect(await reopened.text()).toContain("This page has expired");
    const retry = await authorize("friends", cb);
    expect(retry.html).toContain('action="/oauth/authorize/phone"');
    expect((await confirmPhone("friends", cb, retry.rid, child)).html).toContain('action="/oauth/authorize/signup"');
    const older = await finishSignup("friends", cb, retry.rid, { ...adult, firstName: "Mo", age: "25" });
    expect(older.res.status).toBe(400);
    expect(older.html).toContain("You can’t join this app at the age entered.");
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

  test("a person who allowed access without joining follows check_status back to Finish signup, then joins a second app", async () => {
    const phone = newPhone(), b = new Browser();
    const first = await authorize("friends", b);
    const verified = await confirmPhone("friends", b, first.rid, phone);
    const skipped = await allow("friends", b, first, verified.html);
    const notJoined = await status("friends", skipped);
    expect(notJoined).toMatchObject({ app: "friends", status: "not_joined" });
    expect(notJoined.next_step).toContain("disconnect friends.help in your agent's connector settings, then connect it again");
    expect(notJoined.next_step).toContain("Finish signup");

    const again = await authorize("friends", b);
    expect(again.html).toContain('action="/oauth/authorize/signup"');
    const joined = await finishSignup("friends", b, again.rid, adult);
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    const token = await allow("friends", b, again, joined.html);
    expect(await status("friends", token)).toMatchObject({ app: "friends", status: expect.stringMatching(/^(active|onboarding)$/) });
    expect((await rpc(st, "friends", "/mcp", "tools/call", { name: "check_status", arguments: {} }, skipped)).res.status).toBe(401);

    const person = await personOf(phone);
    const slop = await authorize("slop", b);
    expect((await confirmPhone("slop", b, slop.rid, phone)).html).toContain('action="/oauth/authorize/signup"');
    const second = await finishSignup("slop", b, slop.rid, adult);
    expect(second.res.status, second.html.slice(0, 300)).toBe(200);
    expect(await personOf(phone)).toBe(person);
    expect(await memberships(phone)).toEqual(["friends", "slop"]);
  }, T);

  test("spec/agentPhoneHandoff.md: an enrolled request whose stored handoff is refused, missing or not waiting for the grant gets no grant", async () => {
    const refusedHandoff = { phase: "HandoffRefused", approvedDraft: true, verifiedEnrollment: false, matchingGrant: false };
    const readyHandoff = { phase: "ReadyForSignupProfile", approvedDraft: true, verifiedEnrollment: true, matchingGrant: true };
    for (const stored of [refusedHandoff, readyHandoff, null]) {
      const phone = newPhone(), b = new Browser();
      const c = await authorize("friends", b);
      await confirmPhone("friends", b, c.rid, phone);
      const joined = await finishSignup("friends", b, c.rid, adult);
      expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
      expect(await sql`select step, handoff->>'phase' as phase from oauth.auth_requests where id = ${c.rid}`).toEqual([{ step: "enrolled", phase: "AwaitingSignupGrant" }]);
      await sql`update oauth.auth_requests set handoff = ${stored}::jsonb where id = ${c.rid}`;
      const refused = await st.site("friends", "/oauth/authorize/consent", { browser: b, form: { rid: c.rid, decision: "approve", signupApproval: hidden(joined.html, "signupApproval")! } });
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("This page has expired");
      const person = await personOf(phone);
      expect(person).toEqual(expect.any(String));
      expect(await sql`select id from oauth.grants where person_id = ${person!}`).toEqual([]);
    }
  }, T);

  test("spec/agentPhoneHandoff.md: a stored handoff that does not parse is a server error and gets no grant", async () => {
    const phone = newPhone(), b = new Browser();
    const c = await authorize("friends", b);
    await confirmPhone("friends", b, c.rid, phone);
    const joined = await finishSignup("friends", b, c.rid, adult);
    expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
    await sql`update oauth.auth_requests set handoff = ${{ phase: "ReadyForSignupProfile", approvedDraft: true, verifiedEnrollment: true, matchingGrant: false }}::jsonb where id = ${c.rid}`;
    const failed = await st.site("friends", "/oauth/authorize/consent", { browser: b, form: { rid: c.rid, decision: "approve", signupApproval: hidden(joined.html, "signupApproval")! } });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "server_error" });
    const person = await personOf(phone);
    expect(person).toEqual(expect.any(String));
    expect(await sql`select id from oauth.grants where person_id = ${person!}`).toEqual([]);
  }, T);

  describe("spec/mcpSignupDraft.md, \"The signup result settles the draft\"", () => {
    test("an adult's draft stays readable at Finish signup and is deleted when they join with corrected details", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      const again = await authorize("friends", b);
      const opened = await st.site("friends", "/oauth/authorize/signup", { browser: b, form: { rid: again.rid, decision: "open" } });
      expect(opened.status).toBe(200);
      expect(await draftRows(phone, "friends")).toBe(1);
      const joined = await finishSignup("friends", b, again.rid, { ...adult, firstName: "Rae" });
      expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
      expect(await draftRows(phone, "friends")).toBe(0);
      const member = (await sql`select ms.first_name from platform.memberships ms join platform.phone_identities ph on ph.person_id = ms.person_id where ph.e164 = ${phone} and ms.app_id = 'friends'`)[0] as { first_name: string };
      expect(member.first_name).toBe("Rae");
    }, T);

    test("a 15-year-old's draft is used when they join, and they are never matched", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      const again = await authorize("friends", b);
      const joined = await finishSignup("friends", b, again.rid, { ...adult, firstName: "Kai", age: "15" });
      expect(joined.res.status, joined.html.slice(0, 300)).toBe(200);
      expect(await draftRows(phone, "friends")).toBe(0);
      const member = (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'friends' and ph.e164 = ${phone}`)[0] as { id: string };
      const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends")!;
      expect(rt.net.member(member.id as never).minor).toBe(true);
    }, T);

    test("an under-13 age at Finish signup declines the join and deletes the draft", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      const again = await authorize("friends", b);
      const declined = await finishSignup("friends", b, again.rid, { ...adult, age: "12" });
      expect(declined.res.status).toBe(400);
      expect(declined.html).toContain("You can’t join this app at the age entered.");
      expect(await draftRows(phone, "friends")).toBe(0);
      expect(await personOf(phone)).toBeUndefined();
    }, T);

    test("a ban after the draft deletes it when Finish signup opens", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      const again = await authorize("friends", b);
      await banPhone(phone);
      const opened = await st.site("friends", "/oauth/authorize/signup", { browser: b, form: { rid: again.rid, decision: "open" } });
      expect(opened.status).toBe(400);
      expect(await draftRows(phone, "friends")).toBe(0);
    }, T);

    test("a staff ban of a member deletes the number's draft in another app at once", async () => {
      const phone = newPhone();
      expect((await webJoin(st, "peon", phone, { age: 30 })).res.status).toBe(200);
      await saveDraft("friends", phone, new Browser());
      const member = await memberIdOf(phone, "peon");
      expect(member).toEqual(expect.any(String));
      const banned = await st.staff("/apps/peon/safety/ban", { memberId: member!, by: "phone", note: "confirmed by staff" });
      expect(await banned.json()).toEqual({ ok: true });
      expect(await draftRows(phone, "friends")).toBe(0);
    }, T);

    test("another person's signup and a signup in a second app leave the draft alone", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      const other = newPhone(), ob = new Browser();
      const oc = await authorize("friends", ob);
      await confirmPhone("friends", ob, oc.rid, other);
      expect((await finishSignup("friends", ob, oc.rid, { ...adult, firstName: "Bo" })).res.status).toBe(200);
      expect(await draftRows(phone, "friends")).toBe(1);
      const slop = await authorize("slop", b);
      expect((await confirmPhone("slop", b, slop.rid, phone)).html).toContain('action="/oauth/authorize/signup"');
      expect((await finishSignup("slop", b, slop.rid, adult)).res.status).toBe(200);
      expect(await draftRows(phone, "friends")).toBe(1);
    }, T);

    test("a draft past its ten minutes is deleted", async () => {
      const phone = newPhone(), b = new Browser();
      await saveDraft("friends", phone, b);
      st.clock.advance(11 * 60_000);
      const again = await authorize("friends", b);
      expect(again.html).toContain('action="/oauth/authorize/signup"');
      expect(await draftRows(phone, "friends")).toBe(0);
    }, T);
  });

  describe("spec/mcpSignupDraft.md, \"A recorded age that the app does not allow deletes the draft at once\"", () => {
    test("an under-13 age texted to the line after the draft deletes the draft at once; an adult age keeps it", async () => {
      const child = newPhone();
      await saveDraft("friends", child, new Browser());
      expect(await st.text(child, "Mo, 12. My home is unknown.")).toBe("under_age");
      expect((await st.svc.people.ageFloorRecord(st.svc.publicApi.accounts.phoneHash(child)))?.age).toBe(12);
      expect(await draftRows(child, "friends")).toBe(0);

      const grown = newPhone();
      await saveDraft("friends", grown, new Browser());
      expect(await st.text(grown, "Mo, 30")).toBe("joined");
      expect((await st.svc.people.ageFloorRecord(st.svc.publicApi.accounts.phoneHash(grown)))?.age).toBe(30);
      expect(await draftRows(grown, "friends")).toBe(1);
    }, T);

    test("an under-13 age from a web join in another app deletes the draft at once; an adult web join keeps it", async () => {
      const child = newPhone();
      await saveDraft("friends", child, new Browser());
      const refused = await webJoin(st, "peon", child, { age: 12, firstName: "Mo" });
      expect(refused.res.status).toBe(400);
      expect(refused.body.error).toBe("under_age");
      expect((await st.svc.people.ageFloorRecord(st.svc.publicApi.accounts.phoneHash(child)))?.age).toBe(12);
      expect(await draftRows(child, "friends")).toBe(0);

      const grown = newPhone();
      await saveDraft("friends", grown, new Browser());
      expect((await webJoin(st, "peon", grown, { age: 30, firstName: "Mo" })).res.status).toBe(200);
      expect(await draftRows(grown, "friends")).toBe(1);
    }, T);
  });

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
        for (const state of ["not_joined", "active", "stopped", "on_hold"] as const) {
          if (state !== "not_joined" && app === "ntwrk") continue;
          const phone = newPhone();
          if (state !== "not_joined") expect((await webJoin(st, app, phone, { age: 30 })).res.status).toBe(200);
          const c = await connectMcp(st, app, phone, { path, redirect: CLAUDE });
          const token = c.token?.access_token as string;
          expect(token).toBeTruthy();
          if (state === "stopped") await st.text(phone, "STOP");
          if (state === "on_hold") {
            const person = (await st.svc.publicApi.accounts.personFor(phone))!;
            const membership = (await st.svc.people.getMembership(person.id, app))!;
            await st.svc.people.putMembership({ ...membership, review: "recycled_number" });
          }
          const current = toolData(await rpc(st, app, path, "tools/call", { name: "check_status", arguments: {} }, token)) as { status: string; next_step: string };
          if (state === "active") expect(current.status).toMatch(/^(active|onboarding)$/);
          else expect(current.status).toBe(state);
          expect(current.next_step.length).toBeGreaterThan(0);
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
