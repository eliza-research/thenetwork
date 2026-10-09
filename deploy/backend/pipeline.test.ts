// The production message path end to end (docs/mvp-gaps.md 4.1, PRD 34.2): signed Blooio webhooks
// into NetworkService on Postgres, out through the service's BlooioAdapter, the OutboundQueue and the
// real BlooioClient to a fake provider, in simulated time (packages/sim/src/pipeline). Nothing is sent
// and no live flag is set. Its own databases (network_test_e2e*) on the dev cluster; skipped without one.
//
// Known gaps on origin/main are test.todo with the package that fixes them:
//   messaging-pipeline: the welcome (a reply to a stranger's join text) is suppressed by the queue
//                       ("reply without a recent inbound"), and restart recovery of the queue.
//   relay-and-dates:    the relay after a reveal (ban mid-relay, scammer moving off-platform).
//   photos-live:        the photo rater in this world (minors never rated, deletion drops ratings).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE, type MemberId } from "../../packages/core/src/index.ts";
import { createServiceMcp } from "../../packages/network/service/serve.ts";
import { LOOKING_FOR_ASK, LOOKING_FOR_ASK_MINOR } from "../../packages/network/service/service.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { signBlooioPayload } from "../../packages/blooio/src/blooio/webhook.ts";
import { dropPipelineDb, FakeBlooio, pgReachable, pipelineDb, PipelineWorld, SHARED_LINE, STAFF, TEST_WEBHOOK_SECRET } from "../../packages/sim/src/pipeline/index.ts";

const pg = await pgReachable();
const d = pg ? describe : describe.skip;

// Fictional 555-01xx numbers (refused in production), one per person in the world.
let n = 0;
const phone = () => `+1212555${String(++n).padStart(4, "0").replace(/^\d{2}/, "01")}`;

/** Join an app by keyword: "<app>", then "<name>, <age>". Returns the member id on that app. */
async function joinByKeyword(w: PipelineWorld, app: "slop" | "friends" | "peon", who: string, name: string, age: number): Promise<MemberId> {
  expect((await w.text(who, app === "slop" ? "slop.date" : app === "friends" ? "friends.help" : "peon.biz")).result).toBe("join_asked");
  expect((await w.text(who, `${name}, ${age}`)).result).toBe("joined");
  const id = await w.memberOf(app, who);
  expect(id).toBeDefined();
  return id!;
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropPipelineDb(u); });

d("pipeline world: inbound, joins and keywords (shared line)", () => {
  let w: PipelineWorld;
  beforeAll(async () => { const url = await pipelineDb("network_test_e2e"); urls.push(url); w = await PipelineWorld.boot({ url }); }, 120_000);
  afterAll(async () => { await w?.close(); });

  test("the webhook needs the line's signature: missing, stale, wrong secret and wrong body are refused and nothing is stored", async () => {
    const who = phone();
    const body = { id: "evt_sig", type: "message.received", api_version: "2026-10-01", created_at: w.clock.now(), data: { message_id: "sig_1", sender: who, recipient: SHARED_LINE, text: "slop" } };
    const raw = JSON.stringify(body);
    const at = Math.floor(w.clock.now() / 1000);
    const post = (headers: Record<string, string>, b = raw) => w.svc.fetch(new Request("http://127.0.0.1/webhooks/blooio", { method: "POST", body: b, headers }));
    expect((await post({})).status).toBe(401);
    expect((await w.post(body, { signedAt: w.clock.now() - 10 * MINUTE })).error).toBe("signature_stale");
    expect((await w.post(body, { secret: "not-the-secret-0123456789abcdef" })).error).toBe("signature_mismatch");
    // A signature over another body (the raw bytes are what is signed).
    expect((await post({ "x-blooio-signature": signBlooioPayload(TEST_WEBHOOK_SECRET, raw, at) }, raw.replace("slop", "peon"))).status).toBe(401);
    expect(await w.person(who)).toBeUndefined();
    expect(w.got(who)).toEqual([]);
    // The same message with a good signature is handled.
    expect((await w.post(body)).result).toBe("join_asked");
    expect(w.got(who).length).toBe(1);
  });

  test("keyword join ('slop'): asked for name and age, then a member of slop only, with an opt-in", async () => {
    const who = phone();
    expect((await w.text(who, "slop")).result).toBe("join_asked");
    expect(w.got(who)).toEqual([expect.stringContaining("To join slop, reply with your first name and your age")] as never);
    expect((await w.text(who, "Sam, 29", { messageId: "join-answer-sam" })).result).toBe("joined");
    // Blooio retries a webhook it did not see answered: the same message is handled once.
    const mark = w.mark;
    expect((await w.text(who, "Sam, 29", { messageId: "join-answer-sam" })).result).toBe("duplicate");
    expect(w.since(mark, who)).toEqual([]);
    const p = (await w.person(who))!;
    expect(p.memberships.map(m => [m.app, m.state])).toEqual([["slop", "active"]]);
    const id = (await w.memberOf("slop", who))!;
    const [row] = await w.svc.sql`select name, age, account_status from network.members where app_id = 'slop' and id = ${id}`;
    expect(row).toMatchObject({ name: "Sam", age: 29, account_status: "active" });
    expect((await w.svc.people.consentEvents(who, "slop")).map(e => [e.state, e.source])).toEqual([["opted_in", "inbound_message"]]);
    // The welcome is stored as the reply to their answer.
    expect((await w.outbound("slop", id)).map(r => r.type)).toEqual(["onboarding"]);
  });

  test.todo("the welcome reaches the phone after a text join (messaging-pipeline: the queue suppresses it as a reply without a recent inbound)", () => {});

  test("no keyword: The Network asks name and age, then what they are looking for; 'dating' enrolls them in slop", async () => {
    const who = phone();
    expect((await w.text(who, "hey, saw this on a flyer")).result).toBe("join_asked");
    expect((await w.text(who, "Jo, 30")).result).toBe("joined");
    expect(w.got(who)).toContain(LOOKING_FOR_ASK);
    expect((await w.text(who, "dating")).result).toBe("handled");
    const p = (await w.person(who))!;
    expect(p.memberships.map(m => `${m.app}:${m.state}`).sort()).toEqual(["ntwrk:active", "slop:active"]);
    expect(await w.memberOf("slop", who)).toBeDefined();
    expect(w.got(who).at(-1)).toMatch(/^Done: you're in slop\.date\./);
    expect((await w.svc.people.consentEvents(who, "slop")).map(e => e.source)).toEqual(["looking_for"]);
  });

  test("under 13 by text: the kind decline, and nothing is stored for the app (no person, no membership, no member row)", async () => {
    const who = phone();
    const before = (await w.svc.sql`select count(*)::int as n from network.members where app_id = 'slop'`)[0].n;
    await w.text(who, "slop");
    expect((await w.text(who, "Kid, 12")).result).toBe("under_age");
    expect(w.got(who).at(-1)).toBe(APPS.slop.brand.underAge);
    expect(await w.person(who)).toBeUndefined();
    expect((await w.svc.sql`select count(*)::int as n from network.members where app_id = 'slop'`)[0].n).toBe(before);
    expect(await w.svc.people.consentEvents(who, "slop")).toEqual([]);
    // A second try with an older age is refused too (the phone's age floor).
    await w.text(who, "slop");
    expect((await w.text(who, "Kid, 19")).result).toBe("under_age");
    expect(await w.person(who)).toBeUndefined();
  });

  test("a 16-year-old is never enrolled in slop from 'what are you looking for?' (dating is not offered; asking for it does nothing)", async () => {
    const who = phone();
    await w.text(who, "hi there");
    expect((await w.text(who, "Max, 16")).result).toBe("joined");
    expect(w.got(who)).toContain(LOOKING_FOR_ASK_MINOR);
    expect(w.got(who)).not.toContain(LOOKING_FOR_ASK);
    await w.text(who, "dating and friends");
    const p = (await w.person(who))!;
    expect(p.memberships.map(m => m.app).sort()).toEqual(["friends", "ntwrk"]);
    expect(await w.memberOf("slop", who)).toBeUndefined();
    // Their friends member is a minor: out of matching on every app.
    const fid = (await w.memberOf("friends", who))!;
    expect((await w.svc.sql`select age from network.members where app_id = 'friends' and id = ${fid}`)[0].age).toBe(16);
  });

  test("an adult on two apps who later says 'I'm 16' is a minor on both (a minor anywhere is a minor everywhere)", async () => {
    const who = phone();
    const s = await joinByKeyword(w, "slop", who, "Lee", 22);
    const f = await joinByKeyword(w, "friends", who, "Lee", 22);
    await w.text(who, "slop");
    await w.text(who, "honestly I'm 16, my brother set this up");
    const ages = await w.svc.sql`select app_id, age from network.members where (app_id = 'slop' and id = ${s}) or (app_id = 'friends' and id = ${f}) order by app_id`;
    expect(ages.map((r: any) => [r.app_id, r.age])).toEqual([["friends", 16], ["slop", 16]]);
    expect(await w.rt("slop").readState(n => n.memberList().find(m => m.id === s)?.minor)).toBe(true);
  });

  test("HELP answers members and strangers; nothing is stored for a stranger", async () => {
    const stranger = phone();
    expect((await w.text(stranger, "HELP")).result).toBe("handled");
    expect(w.got(stranger)).toEqual([APPS.ntwrk.brand.help]);
    expect(await w.person(stranger)).toBeUndefined();
    const who = phone();
    await joinByKeyword(w, "slop", who, "Ana", 27);
    await w.text(who, "HELP");
    expect(w.got(who).at(-1)).toBe(APPS.slop.brand.help);
  });

  test("STOP on the shared line stops every app (one global opt-out); START resumes the app it reached", async () => {
    const who = phone();
    const s = await joinByKeyword(w, "slop", who, "Ria", 33);
    await joinByKeyword(w, "friends", who, "Ria", 33);
    expect((await w.text(who, "STOP")).result).toBe("handled");
    expect(w.got(who).at(-1)).toMatch(/won't get more messages from any app on this number/);
    const p = (await w.person(who))!;
    expect(p.memberships.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:paused", "slop:paused"]);
    const ev = await w.svc.people.lastConsent(who, "slop");
    expect(ev.global?.state).toBe("opted_out");
    // A send after STOP is refused at delivery, whatever wrote it.
    const mark = w.mark;
    await w.rt("slop").unitOfWork(() => { w.rt("slop").system(s, `after-stop:${s}`, "a test send after STOP", "transactional", "info"); });
    expect(w.since(mark, who)).toEqual([]);
    expect((await w.outbound("slop", s)).find(r => r.id === `after-stop:${s}`)?.status).toBe("refused_opted_out");
    // START on the shared line: the app it routes to (the one that wrote last) resumes.
    expect((await w.text(who, "START")).result).toBe("handled");
    const after = (await w.person(who))!.memberships;
    expect(after.filter(m => m.state === "active").length).toBe(1);
  });

  test("'leave slop.date' leaves slop only: membership removed, member row emptied, friends untouched", async () => {
    const who = phone();
    const s = await joinByKeyword(w, "slop", who, "Kai", 26);
    await joinByKeyword(w, "friends", who, "Kai", 26);
    expect((await w.text(who, "leave slop.date")).result).toBe("left");
    expect(w.got(who).at(-1)).toMatch(/You've left slop/);
    const p = (await w.person(who))!;
    expect(p.memberships.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:active", "slop:removed"]);
    const [row] = await w.svc.sql`select name, age, person_id, account_status from network.members where app_id = 'slop' and id = ${s}`;
    expect(row).toMatchObject({ name: null, age: null, person_id: null, account_status: "removed" });
    expect((await w.svc.sql`select count(*)::int as n from network.messages where app_id = 'slop' and member_id = ${s}`)[0].n).toBe(0);
    expect(await w.memberOf("slop", who)).toBeUndefined();
  });

  test("delete everything: every membership's forget path, the OAuth grants of each app, and the number stays suppressed", async () => {
    const mcp = (await createServiceMcp(w.svc, { env: { PLATFORM_ENV: "dev" }, databaseUrl: urls[0], log: () => {} }))!;
    const who = phone();
    const s = await joinByKeyword(w, "slop", who, "Noa", 31);
    await joinByKeyword(w, "friends", who, "Noa", 31);
    const p = (await w.person(who))!.person;
    const key = w.svc.accounts.phoneHash(who);
    for (const app of ["slop", "friends"] as const) {
      await mcp.store.putClient({ id: `cl_${app}_${n}`, secretHash: null, name: "an assistant", redirectUris: ["https://example.invalid/cb"], authMethod: "none", app, surface: "full", kind: "dcr", createdAt: w.clock.now() });
      await mcp.store.putGrant({ id: `gr_${app}_${n}`, clientId: `cl_${app}_${n}`, app, phoneKey: key, personId: p.id, scopes: ["apps:read"], resource: `https://${APPS[app].domain}/mcp`, createdAt: w.clock.now(), expiresAt: w.clock.now() + 30 * DAY, revokedAt: null });
      expect((await mcp.store.grantsFor(key, app, w.clock.now())).length).toBe(1);
    }
    await w.svc.accounts.deleteAll({ e164: who, personId: p.id });
    for (const app of ["slop", "friends"] as const) expect(await mcp.store.grantsFor(key, app, w.clock.now())).toEqual([]);
    expect((await w.svc.people.memberships(p.id)).every(m => m.state === "removed")).toBe(true);
    expect(await w.svc.people.isSuppressed(key)).toBe(true);
    expect((await w.svc.sql`select count(*)::int as n from network.members where app_id = 'slop' and id = ${s} and person_id is not null`)[0].n).toBe(0);
    // A keyword from the number now is a new join (asked again); nothing about the old person answers it.
    expect((await w.text(who, "slop")).result).toBe("join_asked");
  });

  test("a ban by phone: the number never joins any app again, also after deleting everything; a new number is not stopped (no face match live)", async () => {
    const who = phone(), next = phone();
    const s = await joinByKeyword(w, "slop", who, "Rex", 34);
    expect((await w.svc.ban(STAFF, w.rt("slop"), s, "phone", "pipeline world: harassment after a date")).ok).toBe(true);
    expect((await w.person(who))!.memberships.map(m => m.state)).toEqual(["restricted"]);
    const mark = w.mark;
    expect((await w.text(who, "friends.help")).result).toBe("held");
    expect(w.since(mark, who)).toEqual([]);
    const p = (await w.person(who))!.person;
    await w.svc.accounts.deleteAll({ e164: who, personId: p.id });
    expect((await w.text(who, "slop")).result).toBe("held");
    expect((await w.text(who, "Rex, 34")).result).toBe("held");
    expect(await w.memberOf("slop", who)).toBeUndefined();
    // The same person on a new number joins: live has no face match (ban evasion is a tracked gap, scripts/sim/slop.ts).
    expect((await w.text(next, "slop")).result).toBe("join_asked");
  });

  test("a delivery receipt (message.delivered) updates the stored row", async () => {
    const who = phone();
    await w.text(who, "HELP");
    const sent = w.provider.to(who).at(-1)!;
    // A non-member's text is not stored; a member's is. Use a member's system send.
    const m = await joinByKeyword(w, "friends", who, "Tess", 40);
    await w.rt("friends").unitOfWork(() => { w.rt("friends").system(m, `receipt-test:${m}`, "a transactional text for the receipt test", "transactional", "info"); });
    const s = w.provider.to(who).at(-1)!;
    expect(s.id).not.toBe(sent.id);
    expect((await w.outbound("friends", m)).find(r => r.id === `receipt-test:${m}`)?.status).toBe("accepted");
    expect((await w.receipt(s.id, "delivered")).result).toBe("status");
    expect((await w.outbound("friends", m)).find(r => r.id === `receipt-test:${m}`)?.status).toBe("delivered");
    expect((await w.receipt(s.id, "read")).result).toBe("status");
    expect((await w.outbound("friends", m)).find(r => r.id === `receipt-test:${m}`)?.status).toBe("read");
  });

  test("a number not seen for 12 months is held for staff: nothing is answered or stored, HELP still answers", async () => {
    const who = phone();
    const s = await joinByKeyword(w, "slop", who, "Ivy", 35);
    const before = (await w.svc.sql`select count(*)::int as n from network.messages where app_id = 'slop' and member_id = ${s}`)[0].n;
    // A year and a day later (no ticks needed: the hold is decided on the next inbound).
    w.clock.advance(366 * DAY);
    const mark = w.mark;
    expect((await w.text(who, "hey I'm back")).result).toBe("held");
    expect(w.since(mark, who)).toEqual([]);
    expect((await w.svc.sql`select count(*)::int as n from network.messages where app_id = 'slop' and member_id = ${s}`)[0].n).toBe(before);
    expect((await w.svc.accounts.heldPhones()).some(h => h.e164 === who)).toBe(true);
    expect((await w.text(who, "HELP")).result).toBe("held");
    expect(w.since(mark, who).length).toBe(1);
    expect(await w.memberOf("slop", who)).toBeUndefined();
  });
});

d("pipeline world: probes, consent and caps (slop and friends)", () => {
  let w: PipelineWorld;
  beforeAll(async () => { const url = await pipelineDb("network_test_e2e_probe"); urls.push(url); w = await PipelineWorld.boot({ url }); }, 120_000);
  afterAll(async () => { await w?.close(); });

  test("a probe goes out only after a human approves it; it names no one; a yes from both books the date (the slop hooks)", async () => {
    const A = phone(), B = phone();
    const a = await joinByKeyword(w, "slop", A, "Sam", 29);
    const b = await joinByKeyword(w, "slop", B, "Alex", 31);
    const mark = w.mark;
    await w.matchingOn("slop");
    await w.rt("slop").unitOfWork(n => n.submitProposal({ id: "unapproved", kind: "intro", participants: [a, b], alternates: [], objective: "a first date", category: "romance", city: "nyc",
      window: { start: w.clock.now() + DAY, end: w.clock.now() + 6 * DAY }, score: 1, components: {} as never, exploration: false, explanations: {}, generator: "pipeline", createdAt: w.clock.now() }));
    await w.advance(2 * HOUR);
    expect((await w.svc.reviewQueue(w.rt("slop"))).map(q => q.oppId)).toContain("unapproved");
    expect(w.since(mark)).toEqual([]);
    // A reviewer rejects it: nothing is ever sent about it.
    expect((await w.svc.review(STAFF, "unapproved", "reject", { reason: "weak_reason" }, w.rt("slop"))).ok).toBe(true);
    await w.advance(2 * HOUR);
    expect(w.since(mark)).toEqual([]);
    const id = await w.proposeAndApprove("slop", [a, b]);
    const probed = (p: string) => w.since(mark, p).some(t => /go on a date/.test(t));
    expect(await w.advanceUntil(() => probed(A) || probed(B), DAY)).toBe(true);
    const first = probed(A) ? A : B, second = first === A ? B : A;
    const probe = w.since(mark, first).find(t => /go on a date/.test(t))!;
    expect(probe).toMatch(/I'll only tell you who it is if you both say yes/);
    for (const name of ["Sam", "Alex"]) expect(probe).not.toContain(name);
    // Sequential: the second member is asked only after the first says yes.
    expect(probed(second)).toBe(false);
    await w.text(first, "yes, the first time works");
    expect(await w.advanceUntil(() => probed(second), DAY)).toBe(true);
    await w.text(second, "yes");
    const booked = () => w.since(mark).filter(t => /You're both in: a first date with/.test(t));
    expect(await w.advanceUntil(() => booked().length === 2, DAY)).toBe(true);
    for (const t of booked()) expect(t).toMatch(/a public place/);
    // Each member's booked text names the other, and only the other.
    expect(w.since(mark, first).find(t => /You're both in/.test(t))).toContain(first === A ? "Alex" : "Sam");
    expect((await w.opp("slop", id))?.stage).toBe("scheduled");
  }, 120_000);

  test("STOP while a probe waits for an answer: the probe is withdrawn and the partner is never asked", async () => {
    const A = phone(), B = phone();
    const a = await joinByKeyword(w, "slop", A, "Mia", 28);
    const b = await joinByKeyword(w, "slop", B, "Ben", 30);
    const mark = w.mark;
    const id = await w.proposeAndApprove("slop", [a, b]);
    const probed = (p: string) => w.since(mark, p).some(t => /go on a date/.test(t));
    expect(await w.advanceUntil(() => probed(A) || probed(B), DAY)).toBe(true);
    const first = probed(A) ? A : B;
    const other = first === A ? B : A;
    await w.text(first, "STOP");
    await w.advance(2 * DAY, HOUR);
    expect(w.since(mark, other).some(t => /go on a date/.test(t))).toBe(false);
    const o = await w.opp("slop", id);
    expect(o === undefined || o.stage === "closed" || o.status[first === A ? a : b] !== "probing").toBe(true);
    // Nothing reaches the stopped number after the STOP confirmation.
    const after = w.since(mark, first);
    expect(after.at(-1)).toMatch(/won't get more messages/);
  }, 120_000);

  test("leave mid-match: the partner who said yes is never told who it was; the leaver's rows are gone", async () => {
    const A = phone(), B = phone();
    const a = await joinByKeyword(w, "slop", A, "Zoe", 27);
    const b = await joinByKeyword(w, "slop", B, "Eli", 29);
    const mark = w.mark;
    const id = await w.proposeAndApprove("slop", [a, b]);
    const probed = (p: string) => w.since(mark, p).some(t => /go on a date/.test(t));
    expect(await w.advanceUntil(() => probed(A) || probed(B), DAY)).toBe(true);
    const first = probed(A) ? A : B;
    const second = first === A ? B : A;
    await w.text(first, "yes");
    expect(await w.advanceUntil(() => probed(second), DAY)).toBe(true);
    expect((await w.text(second, "leave slop.date")).result).toBe("left");
    await w.advance(DAY, HOUR);
    const secondName = second === A ? "Zoe" : "Eli";
    expect(w.since(mark, first).some(t => t.includes(secondName))).toBe(false);
    expect(w.since(mark, first).some(t => /You're both in/.test(t))).toBe(false);
    const gone = second === A ? a : b;
    expect((await w.svc.sql`select count(*)::int as n from network.messages where app_id = 'slop' and member_id = ${gone}`)[0].n).toBe(0);
    const o = await w.opp("slop", id);
    expect(o === undefined || o.stage === "closed").toBe(true);
  }, 120_000);

  test("quiet hours: an agent-initiated text at night waits in the queue and goes out after 9:00 New York; a STOP reply does not wait", async () => {
    const who = phone();
    const m = await joinByKeyword(w, "friends", who, "Ola", 34);
    await w.advanceToNyHour(23, HOUR);
    const mark = w.mark;
    const rt = w.rt("friends");
    await rt.unitOfWork(() => { rt.system(m, `night:${m}`, "a transactional text written at night", "transactional", "info"); });
    expect(w.since(mark, who)).toEqual([]);
    expect((await w.outbound("friends", m)).find(r => r.id === `night:${m}`)?.status).toBe("deferred_quiet_hours");
    await w.advance(12 * HOUR, HOUR);
    const s = w.provider.sent.slice(mark).find(x => x.text === "a transactional text written at night")!;
    expect(s).toBeDefined();
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(s.at));
    expect(hour >= 9 && hour < 21).toBe(true);
    expect((await w.outbound("friends", m)).find(r => r.id === `night:${m}`)?.status).toBe("accepted");
    // A STOP at night is confirmed at once (compliance is exempt).
    await w.advanceToNyHour(23, HOUR);
    const mark2 = w.mark;
    await w.text(who, "STOP");
    expect(w.since(mark2, who).at(-1)).toMatch(/won't get more messages/);
  }, 120_000);
});

d("pipeline world: the person cap across apps", () => {
  let w: PipelineWorld;
  beforeAll(async () => { const url = await pipelineDb("network_test_e2e_cap"); urls.push(url); w = await PipelineWorld.boot({ url, personDailyCap: 1 }); }, 120_000);
  afterAll(async () => { await w?.close(); });

  test("one person on slop and friends: proactive sends across both apps stay within the daily cap (cap 1 here)", async () => {
    const A = phone(), B = phone(), C = phone();
    const sa = await joinByKeyword(w, "slop", A, "Uma", 30), sb = await joinByKeyword(w, "slop", B, "Vic", 31);
    const fa = await joinByKeyword(w, "friends", A, "Uma", 30), fc = await joinByKeyword(w, "friends", C, "Wes", 32);
    await w.matchingOn("slop"); await w.matchingOn("friends");
    // Both proposals go in at the same daily run.
    const zero = {} as never;
    const now = w.clock.now();
    await w.rt("slop").unitOfWork(n => n.submitProposal({ id: "cap-slop", kind: "intro", participants: [sa, sb], alternates: [], objective: "a first date", category: "romance", city: "nyc", window: { start: now + DAY, end: now + 6 * DAY }, score: 1, components: zero, exploration: false, explanations: {}, generator: "pipeline", createdAt: now }));
    await w.rt("friends").unitOfWork(n => n.submitProposal({ id: "cap-friends", kind: "intro", participants: [fa, fc], alternates: [], objective: "meet up", category: "social", city: "nyc", window: { start: now + DAY, end: now + 6 * DAY }, score: 1, components: zero, exploration: false, explanations: {}, generator: "pipeline", createdAt: now }));
    await w.advance(MINUTE, MINUTE);
    expect((await w.svc.review(STAFF, "cap-slop", "approve", {}, w.rt("slop"))).ok).toBe(true);
    expect((await w.svc.review(STAFF, "cap-friends", "approve", {}, w.rt("friends"))).ok).toBe(true);
    // A is asked first on both apps (the same day): the second app's probe is over the cap.
    await w.advance(12 * HOUR);
    const proactive = await w.svc.sql`select m.app_id, m.status from network.messages m where m.direction = 'outbound' and m.proactive
      and ((m.app_id = 'slop' and m.member_id = ${sa}) or (m.app_id = 'friends' and m.member_id = ${fa}))`;
    const delivered = proactive.filter((r: any) => !/^(refused|suppressed|failed|blocked|parked)/.test(r.status));
    expect(delivered.length).toBe(1);
    // The other app's probe to the same person was held by the platform counter, not sent.
    expect(proactive.filter((r: any) => r.status === "refused_person_cap").length).toBe(1);
    const capRows = await w.svc.sql`select count(*)::int as n from platform.person_sends`;
    expect(capRows[0].n).toBeGreaterThan(0);
  }, 120_000);
});

d("pipeline world: STOP on an app's own line (PLATFORM_STOP_SCOPE=app)", () => {
  let w: PipelineWorld;
  beforeAll(async () => { const url = await pipelineDb("network_test_e2e_scope"); urls.push(url); w = await PipelineWorld.boot({ url, stopScope: "app" }); }, 120_000);
  afterAll(async () => { await w?.close(); });

  test("STOP on slop's line stops slop only; STOP ALL stops every app; START resumes slop", async () => {
    const who = phone();
    await joinByKeyword(w, "slop", who, "Pat", 29);
    await joinByKeyword(w, "friends", who, "Pat", 29);
    expect((await w.text(who, "STOP", { app: "slop" })).result).toBe("handled");
    expect(w.got(who).at(-1)).toBe(APPS.slop.brand.stopApp);
    let ms = (await w.person(who))!.memberships;
    expect(ms.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:active", "slop:paused"]);
    expect((await w.text(who, "START", { app: "slop" })).result).toBe("handled");
    ms = (await w.person(who))!.memberships;
    expect(ms.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:active", "slop:active"]);
    expect((await w.text(who, "STOP ALL", { app: "friends" })).result).toBe("handled");
    ms = (await w.person(who))!.memberships;
    expect(ms.map(m => `${m.app}:${m.state}`).sort()).toEqual(["friends:paused", "slop:paused"]);
  });
});

d("pipeline world: restart", () => {
  test.todo("restart recovery: rows waiting in the queue (quiet hours, held until a reply) are delivered once after a restart, never twice (messaging-pipeline: the queue is in memory)", () => {});
  test.todo("ban mid-relay: a ban closes the relay and nothing more reaches either side (relay-and-dates)", () => {});
  test.todo("a romance scammer who asks to move off-platform in the relay is held before the second message (relay-and-dates)", () => {});
  test.todo("photos: a minor is never rated, and leaving or deleting drops every rating (photos-live)", () => {});
});

test("the pipeline world never reaches a real provider (the fake refuses any other host)", async () => {
  const f = new FakeBlooio(() => 0);
  await expect(f.fetch("https://api.blooio.com/v4/messages", { method: "POST", body: "{}" })).rejects.toThrow(/fake Blooio only answers/);
  expect(TEST_WEBHOOK_SECRET.length).toBeGreaterThan(20);
});
