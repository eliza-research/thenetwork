// End to end: the profile an agent signup skill submits with POST /api/join reaches the app's Network
// member (sites -> router -> backend -> Postgres, harness.ts). Before, the profile stayed on the
// platform membership only: matching never saw it and text onboarding asked for every field again.
//   pnpm test:e2e
// spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { HARD_FIELDS } from "../../packages/engine/src/packs/slop/extract.ts";
import { SLOP_ONBOARD_QUESTIONS } from "../../packages/engine/src/packs/slop/onboard.ts";
import { NTWRK_BRAND, copyFor } from "../../packages/network/src/copy.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { connectMcp, newPhone, pgAvailable, rpc, startStack, webJoin, type Stack } from "./harness.ts";

const T = 180_000;

let st: Stack;
let sql: SQL;

describe.skipIf(!pgAvailable)("the agent's approved profile reaches the Network at join", () => {
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  const memberRow = async (app: AppId, e164: string) =>
    (await sql`select m.id, m.age from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0] as
      { id: string; age: number | null } | undefined;
  const outbound = async (app: AppId, memberId: string) =>
    ((await sql`select body from network.messages where app_id = ${app} and member_id = ${memberId} and direction = 'outbound' order by ts, id`) as { body: string }[]).map(r => r.body);
  /** The onboarding questions about the fields the agent's profile already gave (the hard dating fields). */
  const hardQuestions = Object.values(SLOP_ONBOARD_QUESTIONS)
    .filter(q => (HARD_FIELDS as readonly string[]).includes(q.field))
    .map(q => q.text);

  test("slop: onboarding reads the dating fields and home area from the join and never asks for them again", async () => {
    const phone = newPhone();
    const join = await webJoin(st, "slop", phone, {
      age: 30, firstName: "Rae", homeCity: "nyc", neighborhood: "Greenpoint",
      about: "I'm a woman looking for men, 27 to 38, within 5 miles of 11222. I love climbing and live music.",
    });
    expect(join.res.status, JSON.stringify(join.body)).toBe(200);
    const member = (await memberRow("slop", phone))!;
    expect(member.age).toBe(30);
    // The welcome, then the read-back of what the agent sent: every hard field is already known.
    const atJoin = await outbound("slop", member.id);
    expect(atJoin.some(t => /^so: you're a woman looking for men 27-38 within 5 mi\b/.test(t)), atJoin.join(" | ")).toBe(true);
    // The member confirms on the line; onboarding goes on with what is still missing.
    await st.text(phone, "yes, that's right");
    const all = await outbound("slop", member.id);
    expect(all.length).toBeGreaterThan(atJoin.length);
    for (const question of hardQuestions) expect(all, question).not.toContain(question);
  }, T);

  test("an age the profile states counts: under 13 stores nothing, 13 to 17 is single-player", async () => {
    const child = newPhone();
    const refused = await webJoin(st, "friends", child, { age: 25, firstName: "Mo", about: "I am 12 years old and I love drawing." });
    expect(refused.res.status).toBe(400);
    expect(refused.body.error).toBe("under_age");
    expect(await memberRow("friends", child)).toBeUndefined();
    expect((await sql`select count(*)::int as n from platform.memberships ms join platform.phone_identities ph on ph.person_id = ms.person_id where ph.e164 = ${child}`)[0]!.n).toBe(0);

    const teen = newPhone();
    const joined = await webJoin(st, "friends", teen, { age: 25, firstName: "Kai", about: "I'm 15 years old, into climbing and board games." });
    expect(joined.res.status, JSON.stringify(joined.body)).toBe(200);
    const member = (await memberRow("friends", teen))!;
    expect(member.age).toBe(15);
    const rt = [...st.svc.runtimes.values()].find(r => r.app.id === "friends")!;
    expect(rt.net.member(member.id as never).minor).toBe(true);
  }, T);

  test("friends (the fixed interview): the profile answers the first question, and the interview goes on", async () => {
    const phone = newPhone();
    const join = await webJoin(st, "friends", phone, { age: 29, firstName: "Ines", neighborhood: "Astoria", about: "I want more friends to play tennis and go to gigs with." });
    expect(join.res.status, JSON.stringify(join.body)).toBe(200);
    const member = (await memberRow("friends", phone))!;
    const sent = await outbound("friends", member.id);
    // One welcome; the agent's profile answered its first question, so the interview asked the next one, once.
    expect(sent.filter(t => t.startsWith("Hi Ines,")).length, sent.join(" | ")).toBe(1);
    expect(sent.filter(t => t === copyFor(NTWRK_BRAND).interview.availability).length, sent.join(" | ")).toBe(1);
  }, T);

  test("a failure to learn the profile never undoes the join: one membership, one member, one welcome, consent kept", async () => {
    const phone = newPhone();
    const original = st.svc.submitProfile;
    st.svc.submitProfile = async () => { throw new Error("profile reader unavailable"); };
    try {
      const join = await webJoin(st, "slop", phone, { age: 31, firstName: "Lu", about: "I'm a man looking for women, 28 to 36." });
      // Before the fix the join answered 500, after the welcome had gone out and the member existed.
      expect(join.res.status, JSON.stringify(join.body)).toBe(200);
    } finally {
      st.svc.submitProfile = original;
    }
    const members = await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${phone}`;
    expect(members.length).toBe(1);
    const memberships = await sql`select ms.state from platform.memberships ms join platform.phone_identities ph on ph.person_id = ms.person_id where ms.app_id = 'slop' and ph.e164 = ${phone}`;
    expect(memberships.map(r => r.state)).toEqual(["active"]);
    const consent = (await sql`select state, source from platform.consent_events where e164 = ${phone} and app_id = 'slop' order by at, id`) as { state: string; source: string }[];
    expect(consent.at(-1)).toMatchObject({ state: "opted_in", source: "web_form" });
    expect(consent.some(c => c.source === "join_failed")).toBe(false);
    expect((await outbound("slop", members[0]!.id as string)).filter(t => t.startsWith("Hi Lu,")).length).toBe(1);
  }, T);

  // spec/mcpProfileSubmission.md, "A retry returns confirmed acceptance or holds an unresolved intake"
  test("the enrolled agent's profile applies once across a concurrent retry and a lost intake result", async () => {
    const phone = newPhone();
    const joined = await webJoin(st, "peon", phone, { age: 31, firstName: "Lu" });
    expect(joined.res.status).toBe(200);
    const member = (await memberRow("peon", phone))!;
    const connected = await connectMcp(st, "peon", phone, { browser: joined.b });
    const token = connected.token!.access_token;
    const submit = (about: string) => rpc(st, "peon", "/mcp", "tools/call", { name: "submit_profile", arguments: { about } }, token);
    const exactProfile = "I am a backend engineer in Brooklyn and I prefer a small team.";
    const nextProfile = "I would also like to learn more about database infrastructure roles.";
    const rawCopies = (about: string) => sql`select id from network.messages where app_id='peon' and member_id=${member.id}
      and direction='inbound' and position(${about} in body)>0`;
    const agentProfileRows = async () => Number((await sql`select count(*)::int as n from network.messages where app_id='peon'
      and member_id=${member.id} and direction='inbound' and type='agent_profile' and body=${"Private profile from the member's agent."}`)[0]!.n);
    const rowsAtStart = await agentProfileRows();
    const original = st.svc.submitProfile.bind(st.svc);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    let first: ReturnType<typeof submit> | undefined;
    try {
      st.svc.submitProfile = async (...args) => {
        if (args[3] === exactProfile) { entered(); await held; }
        const result = await original(...args);
        if (args[3] === nextProfile) throw new Error("Synthetic loss after the canonical intake accepted the profile");
        return result;
      };
      first = submit(exactProfile);
      // If intake unexpectedly returns without entering, surface the error instead of waiting for the test timeout.
      await Promise.race([started, first.then(() => { throw new Error("No intake claim reached the enrolled member"); })]);
      const overlapping = await submit(`  ${exactProfile}  `);
      expect(overlapping.body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("unconfirmed") }] });
      expect(await agentProfileRows()).toBe(rowsAtStart);
      release();
      expect((await first).body!.result.structuredContent).toMatchObject({ app: "peon", submitted: true });
      expect(await agentProfileRows()).toBe(rowsAtStart + 1);
      expect(await rawCopies(exactProfile)).toEqual([]);

      await st.setPrivateOpenAiApps([]);
      expect((await submit(exactProfile)).body!.result.structuredContent).toMatchObject({ app: "peon", submitted: true });
      expect(await agentProfileRows()).toBe(rowsAtStart + 1);
      for (let i = 0; i < 2; i++) {
        expect((await submit(nextProfile)).body!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("unconfirmed") }] });
        expect(await agentProfileRows()).toBe(rowsAtStart + 2);
        expect(await rawCopies(nextProfile)).toEqual([]);
      }
      expect((await submit("I am available for another application starting next month.")).res.status).toBe(429);
      const receipts = await sql`select s.fingerprint,s.accepted from oauth.profile_submissions s
        join oauth.grants g on g.id=s.grant_id join network.members m on m.person_id::text=g.person_id and m.app_id=g.app_id
        where m.id=${member.id} order by s.accepted`;
      expect(receipts).toEqual([{ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), accepted: false },
        { fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), accepted: true }]);
      await st.mcp.revokeAllFor(phone, "peon", { forget: true });
      expect((await submit(exactProfile)).res.status).toBe(401);
      expect(await sql`select fingerprint from oauth.profile_submissions where fingerprint in ${sql(receipts.map(row => row.fingerprint))}`).toEqual([]);
    } finally {
      release();
      if (first) await first.catch(() => {});
      st.svc.submitProfile = original;
    }
  }, T);
});
