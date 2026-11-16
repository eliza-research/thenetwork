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
import { newPhone, pgAvailable, startStack, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("tests/e2e needs Postgres (REQUIRE_PG=1)");

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
});
