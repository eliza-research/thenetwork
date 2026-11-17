import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("staff approve an exact ordered gathering selection once against current eligibility", async () => {
  // spec/monthlyGatheringInvitationReview.md, "The first decision fixes the exact selection for that revision"
  const url = await migratedDb("gathering_invitation_review");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "synthetic-gathering-invitation-review-turn-key";
  const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, notify: false,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:ntwrk-admin,reviewer@ntwrk:ntwrk-reviewer,admin@friends:friends-admin", consoleToken: "ntwrk-admin",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
  });
  const base = "/apps/ntwrk/gatherings";
  const staff = (path: string, data?: object, token = "ntwrk-admin") => service.fetch(new Request(`http://localhost${path}`, {
    method: data ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "x-network-staff-id": "staff@example.test", "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }));
  async function onboard(phone: string, index: number) {
    for (const [step, text] of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      const input: TurnRequest = { app: "ntwrk", from: phone, messageId: `gathering-review-onboard-${index}-${step}`,
        text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
      const body = JSON.stringify(input);
      const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
      expect((await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }))).status).toBe(200);
    }
  }

  try {
    await service.start();
    const app = APPS.ntwrk;
    const people = [];
    for (const [index, age] of [30, 31, 33, 32].entries()) {
      const phone = `+1212555036${index}`;
      const invitation = await service.accounts.invite(app, phone);
      if (!invitation) throw new Error("Fixture invitation refused");
      const joined = await service.accounts.join(app, { e164: phone, personId: invitation.personId },
        { firstName: "Ari", age, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
      people.push({ phone, ...joined.membership });
      await onboard(phone, index);
    }
    const startsAt = Date.UTC(2026, 10, 21, 17);
    const event = await staff(base, { month: "2026-11", venue: { kind: "curated", id: "mccarren-park" }, startsAt, endsAt: startsAt + HOUR, capacity: 3 });
    expect(event.status).toBe(201);
    const { gathering: { id } } = await event.json() as { gathering: { id: string } };
    const approval = `${base}/${id}/invitations/review`;
    expect((await staff(approval, { revision: 1, memberIds: [people[0]!.memberId] })).status).toBe(409);
    expect((await staff(`${base}/${id}/review`, { revision: 0, decision: "approve" })).status).toBe(200);
    const priority = async () => (await (await staff(`${base}/${id}/priority?revision=1`)).json() as { items: string[] }).items;
    const firstRank = await priority();
    expect(firstRank).toHaveLength(3);
    const changed = people.find(person => person.memberId === firstRank[0])!;
    await service.accounts.recordAge(changed.phone, await service.accounts.personFor(changed.phone), 16);
    expect((await staff(approval, { revision: 1, memberIds: firstRank })).status).toBe(409);
    const ranked = await priority();
    expect(ranked).toHaveLength(3);
    expect(ranked).not.toContain(changed.memberId);
    const selected = [ranked[0]!, ranked[2]!];
    expect((await staff(approval, { revision: 1, memberIds: people.map(person => person.memberId) })).status).toBe(409);
    expect((await staff(approval, { revision: 1, memberIds: [...selected].reverse() })).status).toBe(409);
    expect((await staff(approval, { revision: 1, memberIds: selected }, "ntwrk-reviewer")).status).toBe(403);
    expect((await staff(approval, { revision: 1, memberIds: selected }, "friends-admin")).status).toBe(403);

    const outbound = await sql`select id from network.messages where direction='outbound' order by id`;
    const body = { revision: 1, memberIds: selected };
    const approved = await Promise.all([staff(approval, body), staff(approval, body)]);
    expect(approved.map(res => res.status)).toEqual([200, 200]);
    const receipts = await Promise.all(approved.map(res => res.json()));
    expect(receipts.filter(receipt => receipt.replayed)).toHaveLength(1);
    for (const receipt of receipts) expect(receipt).toMatchObject({ ok: true, review: { id, revision: 1, count: 2, reviewedBy: "staff@example.test" } });
    expect(await sql`select member_id,position from network.monthly_gathering_invitees where gathering_id=${id} order by position`)
      .toEqual(selected.map((member_id, index) => ({ member_id, position: index + 1 })));
    expect(await sql`select actor,detail from network.staff_audit where target_id=${id} and action='approve_monthly_gathering_invitees'`)
      .toEqual([{ actor: "staff@example.test", detail: { count: 2, revision: 1 } }]);
    expect(await sql`select id from network.messages where direction='outbound' order by id`).toEqual(outbound);
    expect(await sql`select id from platform.outbound`).toEqual([]);
    expect(await sql`select member_id from network.monthly_gathering_rsvps`).toEqual([]);
    expect((await staff(approval, { revision: 1, memberIds: [selected[0]] })).status).toBe(409);

    const departed = people.find(person => person.memberId === selected[0])!;
    await service.accounts.leave(app, { e164: departed.phone, personId: departed.personId });
    clock.set(startsAt);
    expect(await (await staff(approval, body)).json()).toEqual(receipts.find(receipt => receipt.replayed));
    expect(await sql`select member_id from network.monthly_gathering_invitees where gathering_id=${id}`).toEqual([{ member_id: selected[1] }]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
