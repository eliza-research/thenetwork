import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { gatheringMutualFollowups } from "../service/monthly-gathering-followup.ts";
import { currentGatheringRepeatSources, gatheringMatchSourceCurrent, lockGatheringMatchSource } from "../service/monthly-gathering-match-authority.ts";
import { gatheringRsvpReference } from "../service/monthly-gathering-rsvp.ts";
import { NetworkService } from "../service/service.ts";
import { gatheringRepeatOppPrefix, gatheringRepeatProbeKey } from "../src/network.ts";
import type { GatheringRepeatSource, NetworkState } from "../src/network.ts";

// spec/monthlyGatheringFollowup.md, "Confirm attendance and choose whom to meet again"
test.skipIf(!pgAvailable)("signed gathering attendance and private follow-up preserve exact, current, bilateral consent", async () => {
  const url = await migratedDb("monthly_gathering_followup");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 17));
  const secret = "synthetic-monthly-gathering-followup-secret";
  const id = "33acec36-2c04-4dac-9843-eaf002677a0b", groupReviewId = "e37bde0f-ea1e-473f-8092-07eba58aedce";
  const startsAt = clock.now() + 4 * HOUR, endsAt = startsAt + HOUR;
  const app = APPS.ntwrk, key = { id, revision: 1 };
  const sent: SendRequest[] = [];
  const createService = () => new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:gathering-staff", network: { growth: false, plans: false },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }, { id: "friends:nyc", matchingEnabled: false }],
    adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: "+12125550100", clock, log: () => {}, liveGate: () => true,
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
      } },
    }),
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
    const staff = (path: string, payload?: object) => service.fetch(new Request(`http://localhost/apps/ntwrk${path}`, {
      method: payload ? "POST" : "GET", headers: { authorization: "Bearer gathering-staff", "content-type": "application/json" },
      ...(payload && { body: JSON.stringify(payload) }),
    }));
    const mutual = () => service.runtimeFor("ntwrk")!.scoped(tx => gatheringMutualFollowups(tx, service.accountsFor(tx), app, key, clock.now()));
    const sources = () => service.runtimeFor("ntwrk")!.scoped(tx => currentGatheringRepeatSources(tx, service.accountsFor(tx), app, clock.now()));
    const claim = (source: GatheringRepeatSource, e164 = ari.e164) => service.runtimeFor("ntwrk")!.scoped(async tx => {
      const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id='ntwrk' and id='ntwrk:nyc' for share`;
      await lockGatheringMatchSource(tx, app, source);
      return gatheringMatchSourceCurrent(tx, service.accountsFor(tx), app, source, clock.now(), { memberId: ari.memberId, e164 }, saved?.state);
    });
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
    const who = { e164: ari.e164, personId: ari.personId };
    const privacyExport = await service.accounts.exportApp(app, who);
    expect(privacyExport.network).toMatchObject({ member: { id: ari.memberId } });
    expect((privacyExport.network as { gatherings: unknown }).gatherings).toEqual([{
      gatheringId: id, revision: 1, venue: "McCarren Park",
      startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
      rsvp: { choice: "grouping", respondedAt: createdAt.toISOString() },
      attendance: { attended: true, respondedAt: new Date(endsAt).toISOString() },
      followUpChoices: [{ wanted: true, respondedAt: new Date(clock.now()).toISOString() }],
    }]);
    expect(await service.accounts.exportApp(APPS.friends, who)).toMatchObject({ membership: null, consent: [], network: null });
    expect(await service.accounts.exportApp(app, { ...who, personId: bea.personId }))
      .toMatchObject({ membership: null, consent: [], network: null });

    expect((await send(prefer(bea.e164, ariCode!))).replies).toEqual(early.replies);
    expect(await mutual()).toEqual([{ members: [ari.memberId, bea.memberId].sort(), groupReviewId }]);
    const [firstEpoch] = await sources();
    expect(firstEpoch).toMatchObject({ gatheringId: id, revision: 1, groupReviewId, members: [ari.memberId, bea.memberId].sort(), consentVersion: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await claim(firstEpoch!)).toBe(true);
    expect(await claim(firstEpoch!, bea.e164)).toBe(false);
    const [peer] = await sql`select prefs from network.members where app_id='ntwrk' and id=${bea.memberId}`;
    await sql`update network.members set prefs=prefs || '{"formats":["event"]}'::jsonb where app_id='ntwrk' and id=${bea.memberId}`;
    expect(await claim(firstEpoch!)).toBe(false);
    await sql`update network.members set prefs=${peer!.prefs}::jsonb where app_id='ntwrk' and id=${bea.memberId}`;

    // spec/gatheringRepeatDelivery.md, "A probe or initial reveal must match the reviewed opportunity and current source"
    expect((await staff("/matching", { on: true })).status).toBe(200);
    const rt = service.runtimeFor("ntwrk")!;
    const repeatSends = () => sent.filter(message => message.idempotencyKey.startsWith(`tn:${gatheringRepeatOppPrefix}`));
    await service.tick();
    const reviewItems = await (await staff("/review")).json();
    const reviews = reviewItems.items.filter((item: { oppId: string }) => item.oppId.startsWith(gatheringRepeatOppPrefix));
    expect(reviews).toHaveLength(1);
    expect(repeatSends()).toHaveLength(0);
    const { oppId, revision } = reviews[0]!;
    const adapter = rt.adapter as BlooioAdapter;
    await adapter.lineSafety("review", "fixture");
    const approval = await staff(`/review/${oppId}`, { decision: "approve", revision });
    expect(await approval.json()).toMatchObject({ ok: true });
    const awaitProgress = async (ready: () => boolean | Promise<boolean>) => {
      for (let slot = 0; slot < 22 && !await ready(); slot++) {
        clock.advance(HOUR);
        await service.tick();
      }
      expect(await ready()).toBe(true);
    };
    const queued = () => sql`select member_id,to_address,status from platform.outbound where opportunity_id=${oppId}`;
    await awaitProgress(async () => (await queued()).length === 1);
    const [firstPending] = await queued();
    expect(firstPending?.status).toBe("retry_scheduled");
    expect(repeatSends()).toHaveLength(0);
    expect((await send(turn(firstPending!.to_address, "yes"))).status).toBe(200);
    expect((await rt.pg.load())?.opps.find(opp => opp.id === oppId)?.stage).toBe("probing");
    await adapter.lineSafety(undefined);
    await awaitProgress(() => repeatSends().length === 1);
    expect(repeatSends()[0]!.idempotencyKey).toBe(`tn:${gatheringRepeatProbeKey(oppId, firstPending!.member_id)}`);
    expect(repeatSends()[0]!.text).not.toMatch(/\b(Ari|Bea)\b/);
    clock.advance(MINUTE);
    expect((await send(turn(firstPending!.to_address, "yes"))).status).toBe(200);
    await awaitProgress(() => repeatSends().length === 2);
    const second = repeatSends()[1]!;
    expect(second.to).not.toBe(firstPending!.to_address);
    expect(second.text).not.toMatch(/\b(Ari|Bea)\b/);
    expect((await rt.pg.load())?.opps.find(opp => opp.id === oppId)?.stage).toBe("probing");
    clock.advance(MINUTE);
    const bookingTurn = turn(second.to, "yes");
    const booking = await send(bookingTurn);
    expect(booking).toMatchObject({ status: 200, replies: [expect.stringContaining("You're both in")] });
    expect((await rt.pg.load())?.opps.find(opp => opp.id === oppId)?.stage).toBe("scheduled");

    await service.close();
    service = createService();
    await service.start();
    expect(await mutual()).toHaveLength(1);
    expect(await sources()).toEqual([firstEpoch]);
    expect((await send(makeAttendance(bea.e164, false, yesB.receivedAt))).replies).toEqual(["I recorded that you did not attend the gathering."]);
    expect((await send(yesB)).status).toBe(409);
    expect(await mutual()).toEqual([]);
    expect(await claim(firstEpoch!)).toBe(false);
    expect((await send(bookingTurn)).status).toBe(409);
    clock.advance(MINUTE);
    expect((await send(makeAttendance(bea.e164))).replies?.[0]).toContain("I recorded that you attended");
    expect(await mutual()).toEqual([]);
    await send(prefer(ari.e164, beaCode!));
    await send(prefer(bea.e164, ariCode!));
    expect(await mutual()).toHaveLength(1);
    const [secondEpoch] = await sources();
    expect(secondEpoch?.consentVersion).not.toBe(firstEpoch?.consentVersion);
    expect(await claim(secondEpoch!)).toBe(true);
    expect(await claim(firstEpoch!)).toBe(false);
    await sql`insert into platform.person_blocks (from_person,to_person,origin_app,at) values (${ari.personId},${bea.personId},'friends',${new Date(clock.now())})`;
    expect(await mutual()).toEqual([]);
    expect(await claim(secondEpoch!)).toBe(false);

    expect(await sql`select body from network.messages where body like ${`%${beaCode}%`} or body like ${`%${ariCode}%`}`).toEqual([]);
    await service.accounts.leave(app, who);
    expect(await sql`select member_id from network.monthly_gathering_attendance where member_id=${ari.memberId}`).toEqual([]);
    expect(await rows()).toEqual([]);
    expect(await service.accounts.exportApp(app, who)).toMatchObject({ membership: null, network: null });
    clock.set(endsAt + 7 * DAY);
    expect(await send(makeAttendance(bea.e164))).toMatchObject({ reason: "gathering_followup", replies: [] });
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
