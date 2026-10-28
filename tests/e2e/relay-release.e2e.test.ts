// Staff release must re-read platform eligibility, not just the desk's stored members.
// Real service route and migrated Postgres; fictional adults, dry-run delivery only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "../../packages/core/src/clock.ts";
import { newPhone, pgAvailable, startStack, webJoin, type Stack } from "./harness.ts";

if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("relay release e2e requires Postgres");

describe.skipIf(!pgAvailable)("staff relay release with canonical platform eligibility", () => {
  let st: Stack;
  let sql: SQL;
  beforeAll(async () => {
    st = await startStack();
    sql = new SQL({ url: st.url, max: 2 });
  }, 180_000);
  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, 180_000);

  test("a recipient's STOP after hold prevents release and appends no message", async () => {
    const phones = [newPhone(), newPhone()];
    for (const [i, phone] of phones.entries()) {
      const joined = await webJoin(st, "friends", phone!, { age: 29 + i, firstName: i ? "Bo" : "Ari" });
      expect(joined.res.status).toBe(200);
    }
    const rows: Array<{ id: string; person_id: string; e164: string }> = await sql`select m.id, m.person_id, ph.e164 from network.members m
      join platform.phone_identities ph on ph.person_id=m.person_id
      where m.app_id='friends' and ph.e164 in ${sql(phones)}`;
    const ari = rows.find(r => r.e164 === phones[0])!;
    const bo = rows.find(r => r.e164 === phones[1])!;
    expect(rows).toHaveLength(2);
    const rt = st.svc.runtimeFor("friends")!;
    // Fixture: an existing two-person plan accepted by both (matching has its own gates).
    await rt.unitOfWork(n => {
      const state = n.exportState();
      state.opps.push({ id: "release-e2e-match", origin: "engine", kind: "intro", category: "hobby", objective: "a hike", detail: "",
        participants: [ari.id, bo.id], alternates: [], primed: [], status: [[ari.id, "yes"], [bo.id, "yes"]], explanations: {},
        stage: "scheduled", deadline: st.clock.now() + DAY, createdAt: st.clock.now(), score: 0.5,
        components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
        generator: "fixture", exploration: false, sameDay: false, contacted: [ari.id, bo.id], reminded: [], tags: [], replacements: 0,
        feedbackFrom: [], meetingAt: st.clock.now() + DAY } as any);
      n.importState(state);
    });
    const hold = async (itemId: string, text: string) => {
      const outcome = await rt.unitOfWork(n => n.relayRequest({ itemId, from: ari.id, kind: "text", text }));
      expect(outcome.decision).toBe("held");
    };
    const release = (id: string) => st.staff(`/staff/relay/${id}/release?app=friends`, { note: "reviewed the held text" });
    // Positive control: the same route releases a content hold for two eligible adults.
    await hold("release-e2e-adult", "add me on telegram, it's easier");
    const control = await release("release-e2e-adult");
    expect(control.status).toBe(200);
    expect(await control.json()).toMatchObject({ ok: true });
    expect(await sql`select id from network.messages where app_id='friends' and id='relay:release-e2e-adult'`).toHaveLength(1);

    st.clock.advance(60_000);
    await hold("release-e2e-stop", "dm me on instagram instead");
    // Only the canonical consent ledger changes: the Network member is still opted in.
    await sql`insert into platform.consent_events (e164, app_id, state, source, at)
      values (${phones[1]}, null, 'opted_out', 'keyword:stop', ${new Date(st.clock.now())})`;
    expect((await sql`select opted_out from network.members where app_id='friends' and id=${bo.id}`)[0].opted_out).toBe(false);
    const before = await sql`select id from network.messages where app_id='friends' order by id`;
    const refused = await release("release-e2e-stop");
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({ ok: true, delivered: false });
    expect(await sql`select id from network.messages where app_id='friends' order by id`).toEqual(before);
    expect(await sql`select id from network.messages where app_id='friends' and id='relay:release-e2e-stop'`).toHaveLength(0);
    // A repeated release cannot turn the decided item into a new delivery.
    expect(await (await release("release-e2e-stop")).json()).toMatchObject({ ok: false, reason: "not_held" });
  }, 180_000);
});
