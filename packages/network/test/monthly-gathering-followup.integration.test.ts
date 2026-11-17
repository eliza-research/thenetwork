import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { gatheringMutualFollowups } from "../service/monthly-gathering-followup.ts";
import { gatheringRsvpReference } from "../service/monthly-gathering-rsvp.ts";
import { NetworkService } from "../service/service.ts";

// spec/monthlyGatheringFollowup.md, "Confirm attendance and choose whom to meet again"
test.skipIf(!pgAvailable)("signed gathering attendance and private follow-up preserve exact, current, bilateral consent", async () => {
  const url = await migratedDb("monthly_gathering_followup");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 17));
  const secret = "synthetic-monthly-gathering-followup-secret";
  const id = "33acec36-2c04-4dac-9843-eaf002677a0b", groupReviewId = "e37bde0f-ea1e-473f-8092-07eba58aedce";
  const startsAt = clock.now() + 4 * HOUR, endsAt = startsAt + HOUR;
  const app = APPS.ntwrk, key = { id, revision: 1 };
  const createService = () => new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
  });
  let service = createService();
  try {
    await service.start();
    let sequence = 0;
    const turn = (from: string, text: string, receivedAt = clock.now(), targetApp: "ntwrk" | "friends" = "ntwrk"): TurnRequest =>
      ({ messageId: `gathering-followup-${++sequence}`, channel: "blooio", from, to: null, transport: "imessage", app: targetApp, text, receivedAt });
    const send = async (input: TurnRequest, signed = true) => {
      const body = JSON.stringify(input);
      const headers = signed ? await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) }) : {};
      const response = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }));
      return { status: response.status, ...await response.json() } as { status: number; replies?: string[]; reason?: string; error?: string };
    };
    const joined = [];
    for (const [position, name] of ["Ari", "Bea", "Cal"].entries()) {
      const e164 = `+1212555051${position}`;
      expect(await service.accounts.invite(app, e164)).toBeTruthy();
      const result = await service.accounts.join(app, { e164, personId: null }, {
        firstName: name, age: 32, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      if (!result.ok) throw new Error(`Fixture join failed: ${result.error}`);
      joined.push({ e164, ...result.membership });
      for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
        clock.advance(MINUTE);
        expect((await send(turn(e164, text))).status).toBe(200);
      }
    }
    const [ari, bea] = [joined[0]!, joined[1]!];
    const createdAt = new Date(clock.now());
    await sql`insert into network.monthly_gatherings (app_id,id,city,month,venue_kind,venue_ref,venue_name,
      starts_at,ends_at,capacity,status,revision,created_by,created_at,reviewed_by,reviewed_at)
      values ('ntwrk',${id},'nyc','2026-11','curated','mccarren-park','McCarren Park',${new Date(startsAt)},${new Date(endsAt)},
        3,'approved',1,'creator',${createdAt},'reviewer',${createdAt})`;
    const event = `${gatheringRsvpReference(id)} 1`;
    for (const member of joined) {
      const rsvp = await send(turn(member.e164, `RSVP GATHERING ${event} YES WITH GROUPING`));
      expect(rsvp).toMatchObject({ status: 200, reason: "gathering_rsvp", replies: [expect.any(String)] });
    }
    await sql`insert into network.monthly_gathering_grouping_reviews
      (app_id,gathering_id,revision,review_id,fingerprint,group_count,member_count,reviewed_by,reviewed_at)
      values ('ntwrk',${id},1,${groupReviewId},${"a".repeat(64)},1,3,'reviewer',${createdAt})`;
    for (const member of joined) {
      await sql`insert into network.monthly_gathering_group_members (app_id,gathering_id,revision,review_id,group_no,member_id)
        values ('ntwrk',${id},1,${groupReviewId},1,${member.memberId})`;
    }
    const rows = () => sql`select member_id,peer_id,wanted from network.monthly_gathering_followup_choices order by member_id,peer_id`;
    const mutual = () => service.runtimeFor("ntwrk")!.scoped(tx => gatheringMutualFollowups(tx, service.accountsFor(tx), app, key, clock.now()));
    const makeAttendance = (phone: string, yes = true, at = clock.now()) => turn(phone, `GATHERING ATTENDED ${event} ${yes ? "YES" : "NO"}`, at);
    const reference = async (phone: string) => {
      const result = await send(turn(phone, `GATHERING REFERENCE ${event}`));
      expect(result).toMatchObject({ status: 200, reason: "gathering_followup", replies: [expect.any(String)] });
      return result.replies?.[0]?.match(/reference is ([a-p]{32})\./)?.[1];
    };
    const prefer = (phone: string, peer: string, yes = true, at = clock.now()) => turn(phone, `GATHERING FOLLOW-UP ${event} ${peer} ${yes ? "YES" : "NO"}`, at);

    expect((await send(makeAttendance(ari.e164), false)).status).toBe(401);
    clock.set(startsAt);
    expect(await send(makeAttendance(ari.e164))).toMatchObject({ reason: "gathering_followup", replies: [] });
    const ariCode = await reference(ari.e164), beaCode = await reference(bea.e164);
    expect(ariCode).toMatch(/^[a-p]{32}$/);
    expect(beaCode).toMatch(/^[a-p]{32}$/);
    expect(ariCode).not.toBe(beaCode);
    expect(await sql`select * from network.monthly_gathering_attendance`).toEqual([]);

    clock.set(endsAt);
    const yesA = makeAttendance(ari.e164);
    expect(await send(yesA)).toMatchObject({ status: 200, reason: "gathering_followup", replies: [expect.stringContaining("I recorded that you attended")] });
    const earlyTurn = prefer(ari.e164, beaCode!);
    const early = await send(earlyTurn);
    const invalid = await send(prefer(ari.e164, "a".repeat(32)));
    expect(early.replies).toEqual(invalid.replies);
    expect(early.replies).toHaveLength(1);
    expect(await rows()).toEqual([]);
    expect(await send(turn(ari.e164, `GATHERING FOLLOW-UP ${event} ${beaCode} maybe`))).toMatchObject({ reason: "gathering_followup", replies: [] });
    expect(await send(turn(ari.e164, `GATHERING ATTENDED ${event} YES`, clock.now(), "friends"))).toMatchObject({ reason: "gathering_followup", replies: [] });
    clock.advance(MINUTE);
    const yesB = makeAttendance(bea.e164);
    expect((await send(yesB)).replies?.[0]).toContain("I recorded that you attended");
    expect(await send(earlyTurn)).toEqual(early);
    expect(await rows()).toEqual([]);

    const delayedBeaYes = prefer(bea.e164, ariCode!);
    clock.advance(MINUTE);
    expect((await send(prefer(bea.e164, ariCode!, false))).replies).toEqual(early.replies);
    expect((await send(delayedBeaYes)).replies).toEqual(early.replies);
    expect(await rows()).toEqual([{ member_id: bea.memberId, peer_id: ari.memberId, wanted: false }]);
    clock.advance(MINUTE);
    expect((await send(prefer(ari.e164, beaCode!))).replies).toEqual(early.replies);
    expect(await mutual()).toEqual([]);
    expect((await send(prefer(bea.e164, ariCode!))).replies).toEqual(early.replies);
    expect(await mutual()).toEqual([{ members: [ari.memberId, bea.memberId].sort(), groupReviewId }]);

    await service.close();
    service = createService();
    await service.start();
    expect(await mutual()).toHaveLength(1);
    expect((await send(makeAttendance(bea.e164, false, yesB.receivedAt))).replies).toEqual(["I recorded that you did not attend the gathering."]);
    expect((await send(yesB)).status).toBe(409);
    expect(await mutual()).toEqual([]);
    clock.advance(MINUTE);
    expect((await send(makeAttendance(bea.e164))).replies?.[0]).toContain("I recorded that you attended");
    expect(await mutual()).toEqual([]);
    await send(prefer(ari.e164, beaCode!));
    await send(prefer(bea.e164, ariCode!));
    expect(await mutual()).toHaveLength(1);
    await sql`insert into platform.person_blocks (from_person,to_person,origin_app,at) values (${ari.personId},${bea.personId},'friends',${new Date(clock.now())})`;
    expect(await mutual()).toEqual([]);

    expect(await sql`select body from network.messages where body like ${`%${beaCode}%`} or body like ${`%${ariCode}%`}`).toEqual([]);
    await service.accounts.leave(app, { e164: ari.e164, personId: ari.personId });
    expect(await sql`select member_id from network.monthly_gathering_attendance where member_id=${ari.memberId}`).toEqual([]);
    expect(await rows()).toEqual([]);
    clock.set(endsAt + 7 * DAY);
    expect(await send(makeAttendance(bea.e164))).toMatchObject({ reason: "gathering_followup", replies: [] });
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
