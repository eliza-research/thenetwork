import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { REVIEW_JUDGE_PROMPT_VERSION, SIM_REVIEW_JUDGE, type ReviewPacket } from "../../packages/engine/src/reviewJudge.ts";
import { Browser, newPhone, pgAvailable, signIn, startStack, webJoin, type Stack } from "./harness.ts";

const T = 240_000;

const ADMIN = "e2e-teen-admin-a-0123456789abcdef0123";
const SAFETY = "e2e-teen-safety-s-0123456789abcdef012";
const REVIEWER = "e2e-teen-reviewer-0123456789abcdef012";
const SLOP_SAFETY = "e2e-teen-slop-safety-0123456789abcdef";
const FRIENDS_SAFETY = "e2e-teen-friends-safety-0123456789abc";

let st: Stack;
let sql: SQL;
const judgedPackets: ReviewPacket[] = [];

async function staffAs(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await st.svc.fetch(new Request(`http://127.0.0.1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function birthdateJoin(app: AppId, phone: string, firstName: string, birthdate: string, extra: Record<string, string> = {}) {
  const b = new Browser();
  await signIn(st, app, phone, b);
  const info = (await (await st.site(app, "/api/app")).json()) as { consent: { version: string } };
  const res = await st.site(app, "/api/join", {
    browser: b, json: { firstName, birthdate, consent: { sms: true, version: info.consent.version }, interests: ["climbing", "board games"], ...extra },
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function memberOf(phone: string, app: AppId = "friends"): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
    where m.app_id = ${app} and ph.e164 = ${phone}`;
  if (!row) throw new Error(`no ${app} member for ${phone}`);
  return row.id;
}

const runtimeOf = (app: AppId) => [...st.svc.runtimes.values()].find(r => r.app.id === app)!;
const teenItemsOf = async (memberId: string) =>
  ((await staffAs(REVIEWER, "GET", "/apps/friends/review")).body.items as { oppId: string; revision: number; proposal: { participants: string[]; alternates: string[] }; teen?: { members: Record<string, unknown>[] } }[])
    .filter(i => i.proposal.participants.includes(memberId));
const pendingTeenItemsOf = (memberId: string) => runtimeOf("friends").readState(n => n.exportState().opps
  .filter(o => o.stage === "review" && o.participants.includes(memberId))
  .map(o => ({ oppId: o.id, revision: o.review?.rerolls?.length ?? 0, proposal: { participants: [...o.participants], alternates: [...o.alternates] } })));
const switchRows = (network: string) => sql<{ ok: boolean; on: boolean }[]>`select ok, (detail->>'teenIntros')::boolean as on from network.staff_audit
  where target_id = ${`teen_intros_${network}`} and detail->>'phase' = 'result' order by at, id`;

describe.skipIf(!pgAvailable)("spec/teenIntroSwitch.md and spec/friendIntroAge.md through HTTP (owner decision 2026-11-22, answers A2 to A5)", () => {
  beforeAll(async () => {
    st = await startStack({
      reviewJudge: { reviewer: SIM_REVIEW_JUDGE, judge: async packet => {
        judgedPackets.push(packet);
        return { verdict: "approve", reason: "none", explanation: "e2e judgment", model: "simulated", promptVersion: REVIEW_JUDGE_PROMPT_VERSION };
      } },
      staffTokens: `admin@friends:${ADMIN},admin@ntwrk:${ADMIN},admin@slop:${ADMIN},safety@friends:${SAFETY},safety@ntwrk:${SAFETY},reviewer@friends:${REVIEWER},safety@slop:${SLOP_SAFETY},safety@friends:${FRIENDS_SAFETY}`,
    });
    sql = new SQL({ url: st.url, max: 2 });
  }, T);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  test("two birth-date joins give a 16 and a 17 a friendship introduction with no confirm step, the review judge approves it with the strict rubric, and one staff stop and one admin resume act on friends and ntwrk", async () => {
    const p16 = newPhone(), p17 = newPhone(), pAdult = newPhone();
    expect((await birthdateJoin("friends", p16, "Tess", "2010-03-15")).status).toBe(200);
    expect((await birthdateJoin("friends", p17, "Uma", "2009-06-01")).status).toBe(200);
    expect((await webJoin(st, "friends", pAdult, { age: 30, firstName: "Vic", interests: ["climbing", "board games"] })).res.status).toBe(200);
    const t16 = await memberOf(p16), t17 = await memberOf(p17), adult = await memberOf(pAdult);
    expect((await sql`select birth_date from platform.people p join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${p16}`)[0]).toEqual({ birth_date: 20100315 });

    for (const p of [p16, p17, pAdult]) {
      await st.text(p, "I want to find people to go climbing with this weekend, and to play board games.");
      await st.text(p, "Weekends mostly, I'm around Williamsburg.");
      await st.text(p, "One-on-one is good.");
    }
    for (const check of ["age", "liveness"]) {
      expect((await st.staff(`/apps/friends/members/${adult}/verify`, { check, result: "pass", note: "e2e staff check" })).status).toBe(200);
    }
    expect((await st.staff("/apps/friends/matching", { on: true })).status).toBe(200);
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("slop").readState(n => n.teenIntrosEnabled())).toBe(false);
    expect((await staffAs(SAFETY, "GET", `/apps/friends/safety/teen-age?memberId=${encodeURIComponent(t16)}`)).status).toBe(404);

    await st.text(p16, "Find me someone to go bouldering with in Brooklyn this Saturday afternoon");
    for (const r of st.svc.runtimes.values()) await r.tick();
    const [item] = await pendingTeenItemsOf(t16);
    expect(item).toBeDefined();
    expect([...item!.proposal.participants].sort()).toEqual([t16, t17].sort());
    expect(item!.proposal.alternates).not.toContain(adult);
    expect(await teenItemsOf(t16)).toEqual([]);

    expect((await staffAs(ADMIN, "POST", "/apps/slop/teen-intros", { on: true })).body).toEqual({ ok: false, reason: "teen_intros_not_offered" });
    expect(await sql`select ok, detail->>'reason' as reason from network.staff_audit where target_id = 'teen_intros_slop:nyc'`).toEqual([{ ok: false, reason: "teen_intros_not_offered" }]);
    expect((await staffAs(REVIEWER, "POST", "/apps/friends/teen-intros", { on: false })).status).toBe(403);

    const approve = { decision: "approve", revision: item!.revision };
    expect((await staffAs(REVIEWER, "POST", `/apps/friends/review/${encodeURIComponent(item!.oppId)}`, approve)).body).toEqual({ ok: false, reason: "not_held_for_staff" });
    await st.svc.reviewJudgeTick();
    const packet = judgedPackets.find(p => p.oppId === item!.oppId);
    expect(packet?.rubric).toBe("minor");
    expect(packet?.ageFacts.codeChecks).toEqual(["teen_age_rule", "teen_place_all_ages", "teen_daytime_10_19", "no_adult_session_nearby"]);
    expect(packet?.roster.filter(m => m.teen).map(m => [m.firstName, m.teen!.age, m.teen!.apps?.includes("friends")]).sort()).toEqual([["Tess", 16, true], ["Uma", 17, true]]);
    expect(await runtimeOf("friends").readState(n => n.exportState().opps.find(o => o.id === item!.oppId)?.review)).toMatchObject({ decision: "approve", approver: "judge", reviewer: SIM_REVIEW_JUDGE });
    expect(await runtimeOf("friends").readState(n => n.teenItemCurrent(item!.oppId))).toBe(true);

    expect((await staffAs(SAFETY, "POST", "/apps/friends/teen-intros", { on: false })).body).toEqual({ ok: true });
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(false);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(false);
    expect(await runtimeOf("friends").readState(n => n.teenItemCurrent(item!.oppId))).toBe(false);
    expect((await switchRows("friends:nyc")).map(r => [r.ok, r.on])).toEqual([[true, false]]);
    expect((await switchRows("ntwrk:nyc")).map(r => [r.ok, r.on])).toEqual([[true, false]]);

    expect((await staffAs(SAFETY, "POST", "/apps/friends/teen-intros", { on: true })).status).toBe(403);
    expect((await staffAs(ADMIN, "POST", "/apps/friends/teen-intros", { on: true })).body).toEqual({ ok: true });
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect((await switchRows("friends:nyc")).map(r => [r.ok, r.on])).toEqual([[true, false], [true, true]]);
    expect((await switchRows("ntwrk:nyc")).map(r => [r.ok, r.on])).toEqual([[true, false], [true, true]]);
  }, T);

  test("a stop by a staff member who lacks the role on a teen network stops nothing, is refused and is audited for each network it cannot reach", async () => {
    const refusedRows = (actor: string) => sql<{ target_id: string; reason: string }[]>`select target_id, detail->>'reason' as reason from network.staff_audit
      where actor = ${actor} and target_id like 'teen_intros_%' and ok = false order by target_id`;
    const forbiddenActors = async (network: string) => (await sql<{ actor: string }[]>`select distinct actor from network.staff_audit
      where target_id = ${`teen_intros_${network}`} and ok = false and detail->>'reason' = 'forbidden'`).map(r => r.actor);
    const newActor = async (network: string, before: string[]) => {
      const added = (await forbiddenActors(network)).filter(a => !before.includes(a));
      expect(added).toHaveLength(1);
      return added[0]!;
    };
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(true);
    const friendsSwitchBefore = (await switchRows("friends:nyc")).map(r => [r.ok, r.on]);
    const ntwrkSwitchBefore = (await switchRows("ntwrk:nyc")).map(r => [r.ok, r.on]);

    const friendsRefusedBefore = await forbiddenActors("friends:nyc");
    expect(await staffAs(SLOP_SAFETY, "POST", "/apps/slop/teen-intros", { on: false })).toEqual({ status: 403, body: { ok: false, reason: "forbidden", code: "forbidden" } });
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(true);
    const slopActor = await newActor("friends:nyc", friendsRefusedBefore);
    expect(await refusedRows(slopActor)).toEqual([{ target_id: "teen_intros_friends:nyc", reason: "forbidden" }, { target_id: "teen_intros_ntwrk:nyc", reason: "forbidden" }]);

    const ntwrkRefusedBefore = await forbiddenActors("ntwrk:nyc");
    expect(await staffAs(FRIENDS_SAFETY, "POST", "/apps/friends/teen-intros", { on: false })).toEqual({ status: 403, body: { ok: false, reason: "forbidden", code: "forbidden" } });
    expect(await runtimeOf("friends").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect(await runtimeOf("ntwrk").readState(n => n.teenIntrosEnabled())).toBe(true);
    expect((await switchRows("friends:nyc")).map(r => [r.ok, r.on])).toEqual(friendsSwitchBefore);
    expect((await switchRows("ntwrk:nyc")).map(r => [r.ok, r.on])).toEqual(ntwrkSwitchBefore);
    const friendsActor = await newActor("ntwrk:nyc", ntwrkRefusedBefore);
    expect(await refusedRows(friendsActor)).toEqual([{ target_id: "teen_intros_ntwrk:nyc", reason: "forbidden" }]);
  }, T);

  test("an open report about a teen on friends.help takes the teen out of the ntwrk teen pool through platform.teen_pool_holds, and the other teen stays in it", async () => {
    const pIda = newPhone(), pJoy = newPhone();
    for (const [p, firstName, born] of [[pIda, "Ida", "2009-06-01"], [pJoy, "Joy", "2010-03-15"]] as const) {
      expect((await birthdateJoin("friends", p, firstName, born)).status).toBe(200);
      expect((await st.staff("/apps/ntwrk/invite", { phone: p })).status).toBe(200);
      expect((await birthdateJoin("ntwrk", p, firstName, born, { homeCity: "nyc" })).status).toBe(200);
    }
    const idaN = await memberOf(pIda, "ntwrk"), joyN = await memberOf(pJoy, "ntwrk"), joyF = await memberOf(pJoy);
    const ntwrkTeenReady = () => runtimeOf("ntwrk").unitOfWork(n => n.packInput(st.clock.now()).members
      .filter(m => m.teenReady === true && (m.id === idaN || m.id === joyN)).map(m => m.id).sort());
    const holds = () => sql<{ app_id: string }[]>`select h.app_id from platform.teen_pool_holds h join platform.people p on p.phone_hash = h.phone_hash
      join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${pIda} order by h.app_id`;
    expect(await ntwrkTeenReady()).toEqual([idaN, joyN].sort());
    expect(await holds()).toEqual([]);

    let seq = 0;
    const sayOnFriends = (body: string) => runtimeOf("friends").unitOfWork(n => n.onInbound({ id: `e2e-teen-cross-${++seq}`, memberId: joyF, body, ts: st.clock.now(), channel: "sms" }));
    for (const body of ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await sayOnFriends(body);
    await sayOnFriends("report Ida, she was rude to me");
    expect(await holds()).toEqual([{ app_id: "friends" }]);
    expect(await ntwrkTeenReady()).toEqual([joyN]);
  }, T);

  test("a teen pair row in platform.teen_pair_avoid gives the ntwrk engine input an avoid edge between the two teens", async () => {
    const pKai = newPhone(), pLea = newPhone();
    for (const [p, firstName, born] of [[pKai, "Kai", "2009-08-01"], [pLea, "Lea", "2010-01-15"]] as const) {
      expect((await birthdateJoin("friends", p, firstName, born)).status).toBe(200);
      expect((await st.staff("/apps/ntwrk/invite", { phone: p })).status).toBe(200);
      expect((await birthdateJoin("ntwrk", p, firstName, born, { homeCity: "nyc" })).status).toBe(200);
    }
    const kai = await memberOf(pKai, "ntwrk"), lea = await memberOf(pLea, "ntwrk");
    const pair = [kai, lea].sort().join("|");
    const ntwrkInput = () => runtimeOf("ntwrk").unitOfWork(n => {
      const input = n.packInput(st.clock.now());
      return {
        ready: input.members.filter(m => m.teenReady === true && (m.id === kai || m.id === lea)).map(m => m.id).sort(),
        avoid: input.edges.filter(e => e.type === "avoid" && [e.from, e.to].sort().join("|") === pair).length,
      };
    });
    expect(await ntwrkInput()).toEqual({ ready: [kai, lea].sort(), avoid: 0 });
    const hashes = (await sql<{ phone_hash: string }[]>`select p.phone_hash from platform.people p join platform.phone_identities ph on ph.person_id = p.id
      where ph.e164 in ${sql([pKai, pLea])} order by p.phone_hash`).map(r => r.phone_hash);
    expect(hashes).toHaveLength(2);
    await sql`insert into platform.teen_pair_avoid (phone_hash_a, phone_hash_b, at) values (${hashes[0]!}, ${hashes[1]!}, ${new Date(st.clock.now())})`;
    const after = await ntwrkInput();
    expect(after.ready).toEqual([kai, lea].sort());
    expect(after.avoid).toBeGreaterThan(0);
  }, T);

  test("a minor report about a teen on friends.help writes no teen pool bar, keeps the teen out of the pool, and the staff teen doubt clear returns the teen to it", async () => {
    const pMia = newPhone(), pNoa = newPhone();
    for (const [p, firstName, born] of [[pMia, "Mia", "2009-08-01"], [pNoa, "Noa", "2010-01-15"]] as const) {
      expect((await birthdateJoin("friends", p, firstName, born)).status).toBe(200);
    }
    const mia = await memberOf(pMia), noa = await memberOf(pNoa);
    const ready = () => runtimeOf("friends").unitOfWork(n => n.packInput(st.clock.now()).members
      .filter(m => m.teenReady === true && (m.id === mia || m.id === noa)).map(m => m.id).sort());
    const bars = () => sql<{ reason: string }[]>`select b.reason from platform.teen_pool_bars b join platform.people p on p.phone_hash = b.phone_hash
      join platform.phone_identities ph on ph.person_id = p.id where ph.e164 = ${pMia}`;
    const reportsAboutMia = () => runtimeOf("friends").readState(n => n.safetyReports().filter(r => r.subjectId === mia).map(r => [r.kind, r.status]));
    expect(await ready()).toEqual([mia, noa].sort());

    let seq = 0;
    const sayOnFriends = (body: string) => runtimeOf("friends").unitOfWork(n => n.onInbound({ id: `e2e-teen-minor-${++seq}`, memberId: noa, body, ts: st.clock.now(), channel: "sms" }));
    for (const body of ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await sayOnFriends(body);
    await sayOnFriends("report Mia, she's only 12");
    expect(await reportsAboutMia()).toEqual([["minor", "open"]]);
    expect(await bars()).toEqual([]);
    expect(await ready()).toEqual([noa]);

    const cleared = await staffAs(SAFETY, "POST", "/apps/friends/safety/clear-minor", { memberId: mia, note: "checked the birth date with the member" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.ok).toBe(true);
    expect(await reportsAboutMia()).toEqual([["minor", "dismissed"]]);
    expect(await bars()).toEqual([]);
    expect(await ready()).toEqual([mia, noa].sort());
  }, T);
});
