// The relay classifier decides alone: no held text waits for staff. Eligibility is the canonical platform state.
// Real service route and migrated Postgres; fictional adults, dry-run delivery only.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import type { NetworkState } from "../../packages/network/src/network.ts";
import { DAY } from "../../packages/core/src/clock.ts";
import { newPhone, pgAvailable, startStack, webJoin, type Stack } from "./harness.ts";

if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("relay release e2e requires Postgres");

describe.skipIf(!pgAvailable)("automated relay decisions with canonical platform eligibility", () => {
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

  test("an off-platform text is blocked at once and staff cannot release it; a recipient's STOP refuses a later text", async () => {
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
      const opportunity: NetworkState["opps"][number] = { id: "release-e2e-match", origin: "engine", kind: "intro", category: "hobby", objective: "a hike", detail: "",
        participants: [ari.id, bo.id], alternates: [], primed: [], status: [[ari.id, "yes"], [bo.id, "yes"]], explanations: {},
        stage: "scheduled", deadline: st.clock.now() + DAY, createdAt: st.clock.now(), score: 0.5,
        components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
        generator: "fixture", exploration: false, sameDay: false, contacted: [ari.id, bo.id], reminded: [], tags: [], replacements: 0,
        feedbackFrom: [], meetingAt: st.clock.now() + DAY };
      state.opps.push(opportunity);
      n.importState(state);
    });
    const clean = async () => ({ flags: [], block: [] });
    const ask = (itemId: string, text: string) => rt.unitOfWork(async n =>
      n.relayRequest({ itemId, from: ari.id, kind: "text", text }, { hook: clean, canonical: await rt.relayParties([ari.id, bo.id]) }));
    const release = (id: string) => st.staff(`/staff/relay/${id}/release?app=friends`, { note: "reviewed the held text" });
    const relayRows = () => sql`select id from network.messages where app_id='friends'
      and id in ('relay:release-e2e-control', 'relay:release-e2e-adult', 'relay:release-e2e-stop') order by id`;
    const passed = await ask("release-e2e-control", "see you at the trailhead at nine");
    expect(passed.decision).toBe("sent");
    expect(await relayRows()).toEqual([{ id: "relay:release-e2e-control" }]);

    st.clock.advance(60_000);
    const blocked = await ask("release-e2e-adult", "add me on telegram, it's easier");
    expect(blocked.decision).toBe("refused");
    expect(await relayRows()).toEqual([{ id: "relay:release-e2e-control" }]);
    const refusedRelease = await release("release-e2e-adult");
    expect(refusedRelease.status).toBe(409);
    expect(await refusedRelease.json()).toMatchObject({ ok: false, reason: "not_held" });
    expect(await relayRows()).toEqual([{ id: "relay:release-e2e-control" }]);

    st.clock.advance(60_000);
    await sql`insert into platform.consent_events (e164, app_id, state, source, at)
      values (${phones[1]}, null, 'opted_out', 'keyword:stop', ${new Date(st.clock.now())})`;
    expect((await sql`select opted_out from network.members where app_id='friends' and id=${bo.id}`)[0].opted_out).toBe(false);
    const toBo = () => sql`select id from network.messages where app_id='friends' and member_id=${bo.id} and direction='outbound' order by id`;
    const before = await toBo();
    const stopped = await ask("release-e2e-stop", "see you at the trailhead at ten");
    expect(stopped.decision).not.toBe("sent");
    expect(stopped.delivered).not.toBe(true);
    expect(await toBo()).toEqual(before);
    expect(await relayRows()).toEqual([{ id: "relay:release-e2e-control" }]);
    expect(await (await release("release-e2e-stop")).json()).toMatchObject({ ok: false, reason: "not_held" });
  }, 180_000);
});
