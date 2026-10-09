// Membership hardening (PRD 28.1, 28.3, 11.5, F1, F24, F25; audit platform-25), on the real service
// with a database of its own (dev cluster, :54339), a SimClock, a recording channel adapter (nothing
// is sent) and a fake OTP provider:
//  - a no-keyword stranger lands on The Network's waitlist (no network member, no proactive send) and
//    a staff invite lets them in;
//  - the text-join opt-in carries frequency, rates, HELP, STOP, terms and privacy, and the ledger
//    stores exactly the text that was sent, with its version;
//  - a staff invitee is unverified until they write; under 13 leaves no person, phone or membership;
//    an unanswered invite expires; "no thanks" ends the asks;
//  - a staff phone change moves the phone, the consent history, the age floor and the OAuth grants;
//  - "now connected" texts, DISCONNECT and "which assistants are connected?";
//  - soft approval: a flagged member is out of matching until staff clear it;
//  - the MCP sign-in texts only numbers with an account, and needs Turnstile outside dev;
//  - the export holds share grants, photos (metadata) and connected assistants.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { NetworkService } from "../../network/service/service.ts";
import { createServiceMcp } from "../../network/service/serve.ts";
import type { ChannelAdapter, Delivery, Outbound } from "../../network/service/channel.ts";
import { brandOf, copy as ntwrkCopy, copyFor, styleViolations } from "../../network/src/copy.ts";
import { createMcpHandler, type McpHandler } from "../../mcp/src/handler.ts";
import { platformHooks } from "../../mcp/src/hooks.ts";
import { addMember, connect, PHONE_A, setup as mcpSetup } from "../../mcp/test/harness.ts";
import { Accounts } from "../src/accounts.ts";
import { riskWords } from "../src/approval.ts";
import { APPS, TEXT_OPT_IN_VERSION } from "../src/apps.ts";
import { OtpService, type OtpProvider } from "../src/otp.ts";
import { MemoryPeopleStore } from "../src/store.ts";
import type { StaffUser } from "../../observatory/src/types.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const T = 120_000;
const TOKENS = { admin: "tok-admin-0123456789", support: "tok-support-0123456789", safety: "tok-safety-0123456789", reviewer: "tok-reviewer-0123456789" };
const ADMIN: StaffUser = { id: "admin@example.com", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };

/** Fictional numbers, one 1000-block per test (the soft-approval block rule counts joins per block). */
const ph = (block: number, n: number) => `+191755${String(block).padStart(2, "0")}${String(n).padStart(3, "0")}`;

/** Records every text the service would send. Nothing leaves the machine. */
class Recorder implements ChannelAdapter {
  readonly name = "dry_run" as const;
  readonly storedStatus = "dry_run";
  readonly out: { to?: string; body: string; memberId?: string }[] = [];
  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    for (const m of msgs) this.out.push({ to: m.to, body: m.body, memberId: m.memberId });
    return msgs.map(m => ({ id: m.id, status: "dry_run" }));
  }
  async flush() { return []; }
  async direct(to: string, body: string) { this.out.push({ to, body }); return "dry_run"; }
  to(e164: string) { return this.out.filter(x => x.to === e164).map(x => x.body); }
  last(e164: string) { return this.to(e164).at(-1); }
}

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly sent: { e164: string; code: string }[] = [];
  async send(e164: string) { const code = String(200000 + this.sent.length * 7919).slice(0, 6); this.sent.push({ e164, code }); return { code }; }
  last(e164: string) { return [...this.sent].reverse().find(s => s.e164 === e164)?.code; }
}

describe.skipIf(!pgAvailable)("membership hardening (Postgres, the service)", () => {
  let url: string;
  let svc: NetworkService;
  let mcp: McpHandler;
  let sql: SQL;
  const clock = new SimClock(Date.UTC(2026, 9, 12, 15));
  const rec = new Recorder();
  const otp = new FakeOtp();
  let seq = 0;
  const text = (from: string, body: string) => svc.inbound({
    kind: "message", channel: "imessage", messageId: `m${++seq}`, from, to: null, chatId: from, isGroup: false, text: body, mediaUrls: [], transport: "imessage", receivedAt: clock.now(),
  } as never);
  const staff = (token: string, method: string, path: string, body?: unknown) => svc.fetch(new Request(`http://127.0.0.1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  /** A slop member by text: the keyword, then name and age. */
  const joinSlop = async (e164: string, answer = "Ana 30") => {
    expect(await text(e164, "slop")).toBe("join_asked");
    expect(await text(e164, answer)).toBe("joined");
    const person = (await svc.accounts.personFor(e164))!;
    return { person, membership: (await svc.people.getMembership(person.id, "slop"))! };
  };
  const putGrant = async (e164: string, personId: string, id: string, client: { id: string; name: string; redirect: string }, at = clock.now()) => {
    await mcp.store.putClient({ id: client.id, secretHash: null, name: client.name, redirectUris: [client.redirect], authMethod: "none", app: "slop", surface: "full", kind: "dcr", createdAt: at });
    await mcp.store.putGrant({ id, clientId: client.id, app: "slop", phoneKey: svc.accounts.phoneHash(e164), personId, scopes: ["membership:read"], resource: "https://slop.date/mcp", createdAt: at, expiresAt: at + 90 * DAY, revokedAt: null });
  };
  const policy = (memberId: string, rt = svc.runtimeFor("slop")!) => rt.unitOfWork(n => n.recipientPolicy(memberId, "probe"));

  beforeAll(async () => {
    url = await migratedDb("membership");
    sql = new SQL({ url, max: 2 });
    svc = new NetworkService({
      url, clock, adapter: rec, env: { PLATFORM_ENV: "dev" }, notify: false, photoStorage: null, log: () => {},
      networks: ["ntwrk:nyc", "slop:nyc", "peon:nyc", "friends:nyc"].map(id => ({ id })),
      tokens: `admin@*:${TOKENS.admin},support@*:${TOKENS.support},safety@*:${TOKENS.safety},reviewer@*:${TOKENS.reviewer}`,
      publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    });
    await svc.start();
    mcp = (await createServiceMcp(svc, { env: { PLATFORM_ENV: "dev" }, log: () => {} }))!;
  }, T);
  afterAll(async () => { await sql?.close(); await svc?.close(); if (url) await dropDb(url); });

  test("a no-keyword stranger is waitlisted on invite-only ntwrk: no network member, no proactive send; a staff invite lets them in", async () => {
    const a = ph(1, 1);
    expect(await text(a, "hi")).toBe("join_asked");
    const ask = rec.last(a)!;
    expect(ask).toBe(ntwrkCopy.joinAsk(13));
    expect(await text(a, "Sam, 29")).toBe("waitlisted");
    expect(rec.last(a)).toContain("invite-only");
    expect(rec.last(a)).toContain("text slop (dating), peon (work) or friends (friends and plans)");
    const person = (await svc.accounts.personFor(a))!;
    expect((await svc.people.getMembership(person.id, "ntwrk"))?.state).toBe("waitlist");
    expect((await sql`select count(*)::int as n from network.members where person_id = ${person.id}`)[0].n).toBe(0);
    // The opt-in the ledger keeps is the ask that was sent, with its version.
    const [e] = (await svc.people.consentEvents(a, "ntwrk")).filter(x => x.state === "opted_in");
    expect([e!.wording, e!.wordingVersion]).toEqual([ask, TEXT_OPT_IN_VERSION]);
    // Ticks: The Network never texts them first.
    const before = rec.to(a).length;
    clock.advance(2 * DAY);
    await svc.tick();
    expect(rec.to(a).length).toBe(before);
    // Another message: the same short answer (once a day), still nothing stored about a member.
    expect(await text(a, "hello?")).toBe("waitlisted");
    // A staff invite of the same number: active, a network member, the welcome.
    expect(await svc.invite(ADMIN, svc.runtimeFor("ntwrk")!, a)).toEqual({ ok: true });
    expect((await svc.people.getMembership(person.id, "ntwrk"))?.state).toBe("active");
    expect((await sql`select count(*)::int as n from network.members where person_id = ${person.id} and app_id = 'ntwrk'`)[0].n).toBe(1);
    expect(rec.last(a)).toContain("Sam");
    // Someone on the waitlist can leave it by text.
    const a2 = ph(1, 2);
    await text(a2, "hey");
    expect(await text(a2, "Lee, 40")).toBe("waitlisted");
    expect(await text(a2, "leave the network")).toBe("left");
    expect((await svc.people.getMembership((await svc.accounts.personFor(a2))!.id, "ntwrk"))?.state).toBe("removed");
  }, T);

  test("the text-join opt-in has frequency, rates, HELP, STOP, terms and privacy; the ledger stores exactly that text", async () => {
    const b = ph(2, 1);
    expect(await text(b, "slop")).toBe("join_asked");
    const ask = rec.last(b)!;
    expect(ask).toBe(copyFor(brandOf(APPS.slop)).joinAsk(13));
    for (const part of ["Up to a few texts a week", "Msg & data rates may apply", "Reply HELP for help, STOP to opt out", "slop.date/terms", "slop.date/privacy"]) expect(ask).toContain(part);
    expect(styleViolations(ask, { firstContact: true })).toEqual([]);
    expect(await text(b, "Ana 30")).toBe("joined");
    const [e] = (await svc.people.consentEvents(b, "slop")).filter(x => x.state === "opted_in");
    expect([e!.wording, e!.wordingVersion, e!.source]).toEqual([ask, TEXT_OPT_IN_VERSION, "inbound_message"]);
    // A first message with an age and no ask yet gets the full ask (the opt-in), not just "your first name?".
    const b2 = ph(2, 2);
    expect(await text(b2, "29")).toBe("join_asked");
    expect(rec.last(b2)).toBe(ntwrkCopy.joinAsk(13));
  }, T);

  test("a staff invitee is unverified until they write; an under-13 answer leaves no person, phone or membership, only the age floor", async () => {
    const c = ph(3, 1);
    expect(await svc.invite(ADMIN, svc.runtimeFor("ntwrk")!, c)).toEqual({ ok: true });
    expect(rec.last(c)).toBe(ntwrkCopy.invited(13));
    const phone = (await svc.people.findPhone(c))!;
    expect([phone.verifiedAt, phone.method, phone.lastSeenAt]).toEqual([null, "staff", null]);
    expect(await text(c, "Kim, 12")).toBe("under_age");
    expect(rec.last(c)).toBe(APPS.ntwrk.brand.underAge);
    expect(await svc.people.findPhone(c)).toBeUndefined();
    expect(await svc.people.getPerson(phone.personId)).toBeUndefined();
    expect(await svc.people.memberships(phone.personId)).toEqual([]);
    expect(await svc.people.ageFloor(svc.accounts.phoneHash(c))).toBe(12);
    // An invitee who writes back is verified from then on.
    const c2 = ph(3, 2);
    await svc.invite(ADMIN, svc.runtimeFor("ntwrk")!, c2);
    expect(await text(c2, "hi there")).toBe("join_asked");
    expect((await svc.people.findPhone(c2))!.verifiedAt).toBe(clock.now());
  }, T);

  test("an invite nobody answers expires after 30 days (the purge)", async () => {
    const d = ph(4, 1);
    await svc.invite(ADMIN, svc.runtimeFor("ntwrk")!, d);
    const { personId } = (await svc.people.findPhone(d))!;
    clock.advance(29 * DAY);
    await svc.purge();
    expect((await svc.people.getMembership(personId, "ntwrk"))?.state).toBe("invited");
    clock.advance(2 * DAY);
    await svc.purge();
    expect(await svc.people.getMembership(personId, "ntwrk")).toBeUndefined();
    expect(await svc.people.findPhone(d)).toBeUndefined();
    expect(await svc.people.getPerson(personId)).toBeUndefined();
  }, T);

  test("'no thanks' to a join question or an invite: one answer, the invite ends, and no more asks", async () => {
    const e = ph(5, 1);
    expect(await text(e, "slop")).toBe("join_asked");
    expect(await text(e, "no thanks")).toBe("declined");
    expect(rec.last(e)).toBe("OK, I won't text again. If you change your mind, just text us.");
    const n = rec.to(e).length;
    expect(await text(e, "hello")).toBe("declined");
    expect(await text(e, "Ana 30")).toBe("declined");
    expect(rec.to(e).length).toBe(n);
    expect((await svc.people.lastConsent(e, "slop")).app).toMatchObject({ state: "opted_out", source: "join_declined" });
    // Naming the app again is the person's own request: the ask comes back.
    expect(await text(e, "slop")).toBe("join_asked");
    // An invitee says no: the invite (and the person it made) is gone, and nothing asks again.
    const f = ph(5, 2);
    await svc.invite(ADMIN, svc.runtimeFor("ntwrk")!, f);
    const { personId } = (await svc.people.findPhone(f))!;
    expect(await text(f, "Not interested")).toBe("declined");
    expect(await svc.people.getPerson(personId)).toBeUndefined();
    const m = rec.to(f).length;
    expect(await text(f, "hi")).toBe("declined");
    expect(rec.to(f).length).toBe(m);
  }, T);

  test("a staff phone change moves the phone, consent history, age floor and OAuth grants to the new verified number", async () => {
    const g = ph(6, 1), next = ph(6, 2);
    const { person, membership } = await joinSlop(g, "Gia 31");
    await putGrant(g, person.id, "grant_pc", { id: "mcp_pc", name: "Claude", redirect: "https://claude.ai/api/mcp/auth_callback" });
    expect(await svc.people.ageFloor(svc.accounts.phoneHash(g))).toBe(31);
    // Staff without admin@* or support@* cannot; a missing number is a 400.
    expect((await staff(TOKENS.reviewer, "POST", `/apps/slop/people/${person.id}/phone-change`, { newPhone: next })).status).toBe(403);
    expect((await staff(TOKENS.support, "POST", `/apps/slop/people/${person.id}/phone-change`, {})).status).toBe(400);
    // Start: a code goes to the new number. Nothing moves yet.
    const start = await staff(TOKENS.support, "POST", `/apps/slop/people/${membership.memberId}/phone-change`, { newPhone: next });
    expect(await start.json()).toEqual({ ok: true });
    expect((await svc.people.findPhone(g))?.personId).toBe(person.id);
    expect((await staff(TOKENS.support, "POST", `/apps/slop/people/${person.id}/phone-change/confirm`, { code: "000000" })).status).toBe(409);
    clock.advance(31_000);
    const done = await staff(TOKENS.support, "POST", `/apps/slop/people/${person.id}/phone-change/confirm`, { code: otp.last(next) });
    expect(await done.json()).toEqual({ ok: true });
    expect(await svc.people.findPhone(g)).toBeUndefined();
    expect((await svc.people.findPhone(next))).toMatchObject({ personId: person.id, method: "otp_sms" });
    expect((await svc.people.getMembership(person.id, "slop"))?.memberId).toBe(membership.memberId);
    expect(await svc.people.consentEvents(g, "slop")).toEqual([]);
    expect((await svc.people.consentEvents(next, "slop")).some(e => e.state === "opted_in")).toBe(true);
    expect(await svc.people.ageFloor(svc.accounts.phoneHash(g))).toBeUndefined();
    expect(await svc.people.ageFloor(svc.accounts.phoneHash(next))).toBe(31);
    expect(await mcp.assistantsOf(g, "slop")).toEqual([]);
    expect((await mcp.assistantsOf(next, "slop")).map(x => x.id)).toEqual(["grant_pc"]);
    expect((await svc.accounts.byPhoneHash(svc.accounts.phoneHash(next)))?.person.id).toBe(person.id);
    // The member's texts now come from the new number.
    expect(await text(next, "which assistants are connected?")).toBe("handled");
    expect(rec.last(next)).toContain("Claude");
    const audit = await sql`select detail from network.staff_audit where detail->>'safety' = 'phone_change' order by id`;
    expect(audit.map((r: any) => `${r.detail.step}:${r.detail.phase}`)).toContain("confirm:result");
  }, T);

  test("'<assistant> is now connected ... Reply DISCONNECT'; DISCONNECT, 'disconnect <name>' and 'which assistants are connected?'", async () => {
    const h = ph(7, 1);
    const { person } = await joinSlop(h, "Hal 40");
    await putGrant(h, person.id, "grant_old", { id: "mcp_grok", name: "Grok", redirect: "https://grok.com/cb" }, clock.now() - 3 * DAY);
    await putGrant(h, person.id, "grant_new", { id: "mcp_claude", name: "x", redirect: "https://claude.ai/api/mcp/auth_callback" });
    await svc.assistantConnected(person.id, "slop", "Claude");
    expect(rec.last(h)).toBe("Claude is now connected to your slop.date account. Reply DISCONNECT to remove it.");
    expect(await text(h, "Which assistants are connected?")).toBe("handled");
    expect(rec.last(h)).toBe(`Connected: Claude, Grok. Reply "disconnect" and a name to remove one.`);
    // DISCONNECT right after the text removes the one just connected.
    expect(await text(h, "DISCONNECT")).toBe("handled");
    expect(rec.last(h)).toBe("Done. Claude is no longer connected.");
    expect((await mcp.store.getGrant("grant_new"))!.revokedAt).not.toBeNull();
    expect(await text(h, "disconnect grok")).toBe("handled");
    expect(rec.last(h)).toBe("Done. Grok is no longer connected.");
    expect((await mcp.store.getGrant("grant_old"))!.revokedAt).not.toBeNull();
    expect(await text(h, "disconnect")).toBe("handled");
    expect(rec.last(h)).toBe("No assistants are connected to your account.");
    // Several old ones: a bare DISCONNECT asks which.
    await putGrant(h, person.id, "grant_a", { id: "mcp_a", name: "Grok", redirect: "https://grok.com/cb" }, clock.now() - 3 * DAY);
    await putGrant(h, person.id, "grant_b", { id: "mcp_b", name: "x", redirect: "https://chatgpt.com/cb" }, clock.now() - 2 * DAY);
    expect(await text(h, "DISCONNECT")).toBe("handled");
    expect(rec.last(h)).toBe(`Which one: ChatGPT, Grok? Reply "disconnect" and its name.`);
    expect((await mcp.store.getGrant("grant_a"))!.revokedAt).toBeNull();
  }, T);

  test("the OAuth consent itself sends the 'now connected' text through the platform hook", async () => {
    const calls: unknown[][] = [];
    const env = mcpSetup({ assistantConnected: async (...a) => { calls.push(a); } });
    const id = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    await connect(env, "peon.biz", PHONE_A);
    expect(calls).toEqual([[id, "peon", "Test Assistant"]]);
  });

  test("soft approval: a burst of joins from one block of numbers is flagged; the member is out of matching until staff clear it", async () => {
    const one = await joinSlop(ph(8, 1), "Ann 30");
    const two = await joinSlop(ph(8, 2), "Bea 31");
    const three = await joinSlop(ph(8, 3), "Cat 32");
    expect(await svc.accounts.flagged("slop", one.person.id)).toBe(false);
    expect(await svc.accounts.flagged("slop", two.person.id)).toBe(false);
    expect((await svc.people.getFlag("slop", three.person.id))?.reasons).toEqual(["number_block_burst"]);
    expect((await sql`select flagged from network.members where app_id = 'slop' and id = ${three.membership.memberId}`)[0].flagged).toBe(true);
    // Onboards normally (the welcome went out), but the Network never puts them in a match.
    expect(rec.to(ph(8, 3)).length).toBeGreaterThan(0);
    expect(await policy(three.membership.memberId)).toEqual({ ok: false, reason: "flagged" });
    expect(await policy(two.membership.memberId)).not.toEqual({ ok: false, reason: "flagged" });
    // The staff queue, then the decision.
    const list = await (await staff(TOKENS.safety, "GET", "/apps/slop/flags")).json() as any;
    expect(list.flags.map((f: any) => f.memberId)).toEqual([three.membership.memberId]);
    expect((await staff(TOKENS.reviewer, "POST", `/apps/slop/flags/${three.membership.memberId}`, { decision: "clear" })).status).toBe(403);
    expect((await staff(TOKENS.safety, "POST", `/apps/slop/flags/${three.membership.memberId}`, { decision: "maybe" })).status).toBe(400);
    expect(await (await staff(TOKENS.safety, "POST", `/apps/slop/flags/${three.membership.memberId}`, { decision: "clear" })).json()).toEqual({ ok: true });
    expect((await sql`select flagged from network.members where app_id = 'slop' and id = ${three.membership.memberId}`)[0].flagged).toBe(false);
    expect(await policy(three.membership.memberId)).not.toEqual({ ok: false, reason: "flagged" });
    expect((await (await staff(TOKENS.safety, "GET", "/apps/slop/flags")).json() as any).flags).toEqual([]);
    // A new hour, a new block window: the next join from the block is not flagged.
    clock.advance(HOUR);
    const four = await joinSlop(ph(8, 4), "Dee 33");
    expect(await svc.accounts.flagged("slop", four.person.id)).toBe(false);
  }, T);

  test("the export holds base-profile grants (never the other app's name), photo metadata and connected assistants", async () => {
    const k = ph(9, 1);
    const { person } = await joinSlop(k, "Kai 35");
    await putGrant(k, person.id, "grant_exp", { id: "mcp_exp", name: "x", redirect: "https://claude.ai/cb" });
    await svc.people.putShareGrant({ personId: person.id, fromApp: "friends", toApp: "slop", fields: ["first_name", "city"], grantedAt: clock.now(), revokedAt: null });
    const out = await svc.accounts.exportApp(APPS.slop, { e164: k, personId: person.id }) as any;
    expect(out.shareGrants).toEqual([{ fields: ["first_name", "city"], grantedAt: new Date(clock.now()).toISOString(), revokedAt: null }]);
    expect(out.assistants).toEqual([{ name: "Claude", scopes: ["membership:read"], connectedAt: new Date(clock.now()).toISOString() }]);
    expect(out.photos).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("friends");
  }, T);
});

describe("membership hardening (no database)", () => {
  test("the MCP sign-in texts only numbers with a membership or an invite; anyone else gets the same answer and nothing is sent", async () => {
    const people = new MemoryPeopleStore();
    const sent: string[] = [];
    const now = () => Date.UTC(2026, 9, 12, 15);
    const accounts = new Accounts(people, { hashKey: "k", now, apps: id => APPS[id] });
    const otp = new OtpService(people, { name: "fake", send: async e164 => { sent.push(e164); return { code: "123456" }; } }, { hashKey: "k", now });
    const hooks = platformHooks({ store: people, otp, accounts, app: id => APPS[id] });
    const stranger = "+12125550191", invitee = "+12125550192";
    expect(await hooks.startOtp("slop", stranger, "198.51.100.1")).toEqual({ ok: true });
    expect(sent).toEqual([]);
    await accounts.invite(APPS.ntwrk, invitee);
    expect(await hooks.startOtp("ntwrk", invitee, "198.51.100.1")).toEqual({ ok: true });
    expect(sent).toEqual([invitee]);
    // Outside dev the MCP sign-in needs Turnstile, like the public API.
    expect(() => createMcpHandler({ platform: hooks, env: { PLATFORM_ENV: "production" } })).toThrow(/Turnstile/);
    expect(() => createMcpHandler({ platform: hooks, env: { PLATFORM_ENV: "production" }, turnstile: { siteKey: "k", verify: async () => true } })).not.toThrow();
  });

  test("soft approval on the web: five joins from one /24 in ten minutes flag the fifth; risk words flag too", async () => {
    const people = new MemoryPeopleStore();
    let t = Date.UTC(2026, 9, 12, 15);
    const accounts = new Accounts(people, { hashKey: "k", now: () => t, apps: id => APPS[id] });
    const consent = { sms: true as const, version: APPS.friends.consent.version };
    const flagged: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const e164 = `+1${["212", "347", "646", "718", "917"][i]}5550150`;
      const r = await accounts.join(APPS.friends, { e164, personId: null }, { firstName: "Pat", age: 30, consent }, { ip: `203.0.113.${10 + i}` });
      if (!r.ok) throw new Error(r.error);
      flagged.push(await accounts.flagged("friends", r.membership.personId));
      t += 60_000;
    }
    expect(flagged).toEqual([false, false, false, false, true]);
    expect((await people.getFlag("friends", [...people.members.values()].at(-1)!.personId))?.reasons).toEqual(["ip_burst"]);
    expect(riskWords("Hi, add me on telegram for crypto tips")).toBe(true);
    expect(riskWords("Sam, 29, I like climbing")).toBe(false);
  });
});
