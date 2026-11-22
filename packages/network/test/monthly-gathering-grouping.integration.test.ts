import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("staff grouping review follows current private RSVPs and refuses a stale or blocked grouping", async () => {
  // spec/monthlyGatheringGrouping.md, "Human approval binds the exact current nonempty suggestion for one gathering revision"
  const url = await migratedDb("monthly_gathering_grouping");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "synthetic-gathering-grouping-turn-signature-key";
  const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, notify: false,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:ntwrk-admin,reviewer@ntwrk:ntwrk-reviewer,admin@friends:friends-admin", consoleToken: "ntwrk-admin",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
  });
  const base = "/apps/ntwrk/gatherings";
  const staff = (path: string, payload?: object, token = "ntwrk-admin") => service.fetch(new Request(`http://localhost${path}`, {
    method: payload ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "x-network-staff-id": "operator@example.test", "content-type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }));
  let sequence = 0;
  const turn = async (phone: string, text: string) => {
    clock.advance(MINUTE);
    const input: TurnRequest = { app: "ntwrk", from: phone, messageId: `grouping-fixture-${++sequence}`, text,
      channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }));
  };
  try {
    await service.start();
    const app = APPS.ntwrk;
    const people = [];
    for (const [index, firstName] of ["Ari", "Blair", "Casey", "Drew", "Ellis", "Francis", "Gray"].entries()) {
      const phone = `+1212555032${index}`;
      const invitation = await service.accounts.invite(app, phone);
      if (!invitation) throw new Error("Fixture invitation refused");
      const joined = await service.accounts.join(app, { e164: phone, personId: invitation.personId },
        { firstName, age: index === 6 ? 16 : 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
      people.push({ ...joined.membership, phone, firstName });
      if (index < 6) for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
        expect((await turn(phone, text)).status).toBe(200);
      }
    }
    const startsAt = Date.UTC(2026, 10, 21, 17);
    const created = await staff(base, { month: "2026-11", venue: { kind: "curated", id: "mccarren-park" }, startsAt, endsAt: startsAt + HOUR, capacity: 8 });
    expect(created.status).toBe(201);
    const { gathering: { id } } = await created.json() as { gathering: { id: string } };
    const grouping = `${base}/${id}/grouping`;
    const read = `${grouping}?revision=1`, review = `${grouping}/review`;
    expect((await staff(read)).status).toBe(404);
    expect((await staff(`${base}/${id}/review`, { revision: 0, decision: "approve" })).status).toBe(200);
    for (const [index, person] of people.entries()) {
      const reply = await (await turn(person.phone, `RSVP GATHERING ${id} 1 YES${index === 5 ? "" : " WITH GROUPING"}`)).json();
      expect(reply.replies).toHaveLength(index === 6 ? 0 : 1);
    }
    expect((await staff(read, undefined, "ntwrk-reviewer")).status).toBe(403);
    expect((await staff(read, undefined, "friends-admin")).status).toBe(403);
    expect((await staff(`${grouping}?revision=2`)).status).toBe(404);
    const preview = async () => await (await staff(read)).json() as { ok: boolean; id: string; revision: number; fingerprint: string; approved: boolean; groups: string[][] };
    const current = await preview();
    expect(current).toEqual({ ok: true, id, revision: 1, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), approved: false,
      groups: [people.slice(0, 5).map(person => person.memberId).sort()],
    });
    for (const { phone, firstName } of people) {
      expect(JSON.stringify(current)).not.toContain(phone);
      expect(JSON.stringify(current)).not.toContain(firstName);
    }
    expect(await preview()).toEqual(current);
    const outbound = await sql`select id from network.messages where direction='outbound' order by id`;
    const toReview = { revision: 1, fingerprint: current.fingerprint };
    const results = await Promise.all([staff(review, toReview), staff(review, toReview)]);
    expect(results.map(res => res.status)).toEqual([200, 200]);
    const receipts = await Promise.all(results.map(res => res.json()));
    expect(receipts.filter(r => r.replayed)).toHaveLength(1);
    expect(await preview()).toMatchObject({ fingerprint: current.fingerprint, approved: true });

    const blockedPair = people.slice(0, 2).map(person => person.memberId).sort();
    const rt = service.runtimes.get("ntwrk:nyc")!;
    await rt.unitOfWork(net => {
      const state = net.exportState();
      net.importState({ ...state, blocks: [...state.blocks, blockedPair.join("|")] });
    });
    expect((await staff(review, toReview)).status).toBe(409);
    const repaired = await preview();
    expect(repaired.approved).toBe(false);
    expect(repaired.groups).toHaveLength(1);
    expect(repaired.groups[0]).toHaveLength(4);
    expect(repaired.groups[0]?.filter(memberId => blockedPair.includes(memberId))).toHaveLength(1);
    expect((await staff(review, { revision: 1, fingerprint: repaired.fingerprint })).status).toBe(200);
    expect(await sql`select fingerprint,superseded_at is null as current from network.monthly_gathering_grouping_reviews where gathering_id=${id} order by current`)
      .toEqual([{ fingerprint: current.fingerprint, current: false }, { fingerprint: repaired.fingerprint, current: true }]);
    expect(await sql`select actor from network.staff_audit where target_id=${id} and action='approve_monthly_gathering_grouping'`)
      .toEqual([{ actor: "operator@example.test" }, { actor: "operator@example.test" }]);
    expect(await sql`select id from network.messages where direction='outbound' order by id`).toEqual(outbound);
    expect(await sql`select id from platform.outbound`).toEqual([]);

    const withdrawing = people.find(person => person.memberId === repaired.groups[0]![0])!;
    expect((await turn(withdrawing.phone, `WITHDRAW GATHERING ${id} 1`)).status).toBe(200);
    expect((await preview()).groups.flat()).not.toContain(withdrawing.memberId);
    expect((await staff(review, { revision: 1, fingerprint: repaired.fingerprint })).status).toBe(409);
    await service.accounts.leave(app, { e164: withdrawing.phone, personId: withdrawing.personId });
    expect(await sql`select group_no from network.monthly_gathering_group_members where member_id=${withdrawing.memberId}`).toEqual([]);
    clock.set(startsAt);
    const started = await preview();
    expect(started.ok).toBe(true);
    expect((await staff(review, { revision: 1, fingerprint: started.fingerprint })).status).toBe(409);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
