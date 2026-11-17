import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { bookedReminderKey } from "../src/network.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { localBookingStart } from "../src/rescheduling.ts";
import { Mini } from "./mini.ts";

test.skipIf(!pgAvailable)("a signed calendar request downloads the current booking with no participant details", async () => {
  // spec/calendarInvite.md, "The member asks for one current booking"
  // spec/calendarInvite.md, "A calendar link follows the booked revision and the current owner"
  const url = await migratedDb("calendar_invite");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "a-synthetic-calendar-invite-fixture-secret";
  const phones = ["+12125550288", "+12125550289"];
  const app = APPS.friends;
  const delivered: SendRequest[] = [];
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null,
    adapter: (_net, runtime) => new BlooioAdapter({ app: runtime.app.id, city: runtime.city, clock, from: "+12125550160",
      env: {}, log: () => {}, liveGate: () => true, provider: { kind: "sim", send: async request => {
        delivered.push(request);
        return { providerMessageId: `calendar-fixture-${delivered.length}`, status: "queued" };
      } },
    }),
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
  });
  const turn = (id: string, text = "calendar invite", from = phones[0]!): TurnRequest => ({ app: "friends", from, messageId: id,
    text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null });
  const send = async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const acceptCollected = async (input: TurnRequest, replyIds: string[]) => {
    const receipt: TurnReceiptRequest = { channel: input.channel, messageId: input.messageId, replyIds,
      providerMessageIds: ["calendar-fixture-collected"], historyRecorded: true, outcome: "accepted" };
    const body = JSON.stringify(receipt);
    const auth = await svcSign(secret, { method: "POST", path: TURN_RECEIPT_PATH, id: `${input.messageId}:receipt`, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_RECEIPT_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const download = (href: string | URL) => service.publicFetch(new Request(href));
  const iCalTime = (at: number) => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, "");

  try {
    await service.start();
    const unknown = await send(turn("calendar-unknown", "calendar invite", "+12125550287"));
    expect(await unknown.json()).toMatchObject({ outcome: "handled", reason: "calendar_invite", replies: [] });
    const members = [];
    for (const [i, e164] of phones.entries()) {
      const name = i ? "Blair" : "Ari";
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const rt = service.runtimes.get("friends:nyc")!;
    const world = new Mini(members, { app: "friends", review: "auto", plans: false, growth: false });
    world.clock.set(clock.now());
    const ids = members.map(member => member.id);
    await world.onboard(...ids);
    const id = world.propose(ids);
    expect(await world.runUntil(() => world.probed(ids[0]!), 2 * DAY)).toBe(true);
    await world.say(ids[0]!, "yes");
    expect(await world.runUntil(() => world.probed(ids[1]!), DAY)).toBe(true);
    clock.set(world.clock.now());
    const awaiting = world.net.exportState();
    await rt.unitOfWork(n => n.importState({ ...n.exportState(), members: awaiting.members, opps: awaiting.opps }));
    const confirm = turn("calendar-booking", "yes", phones[1]);
    const bookingReply = await (await send(confirm)).json();
    expect(bookingReply.replies.join(" ")).toContain("You're both in");
    expect(await (await send(confirm)).json()).toEqual(bookingReply);
    const bookedState = (await rt.pg.load())!;
    const booked = bookedState.opps.find(opp => opp.id === id && opp.stage === "scheduled")!;
    expect(booked.bookedTold).toEqual(expect.arrayContaining(ids));
    // spec/meetingSettlement.md, "Claim a reminder only after the member received the current booking notice"
    const reminderAt = Math.max(clock.now(), booked.meetingAt! - DAY);
    expect(booked.meetingAt! - reminderAt).toBeGreaterThan(12 * HOUR);
    clock.set(reminderAt);
    const reminder = (memberId: string) => bookedReminderKey("day-before-reminder", id, memberId, booked.scheduleRevision);
    const reminderState = async (memberId: string) => (await sql`select status,attempts from platform.outbound where id=${reminder(memberId)}`)[0];
    const reminderSends = (memberId: string) => delivered.filter(request => request.idempotencyKey === `tn:${reminder(memberId)}`);
    await rt.unitOfWork(n => n.tick(clock.now()));
    expect(await reminderState(ids[0]!)).toMatchObject({ status: "accepted", attempts: 1 });
    expect(await reminderState(ids[1]!)).toMatchObject({ status: "retry_scheduled", attempts: 0 });
    expect(reminderSends(ids[1]!)).toEqual([]);
    expect((await acceptCollected(confirm, bookingReply.replyIds)).status).toBe(200);
    clock.advance(5 * MINUTE);
    await rt.deliver();
    await rt.deliver();
    expect(await reminderState(ids[1]!)).toMatchObject({ status: "accepted", attempts: 1 });
    expect(reminderSends(ids[1]!)).toHaveLength(1);
    const save = (opportunity: typeof booked) => rt.unitOfWork(n => {
      n.importState({ ...n.exportState(), opps: [opportunity] });
    });

    const requested = turn("calendar-issue");
    const original = await send(requested);
    expect(original.status).toBe(200);
    const result = await original.json();
    expect(result).toMatchObject({ outcome: "handled", reason: "calendar_invite", replies: [expect.stringContaining("https://friends.help/api/calendar/invite?code=")] });
    const link = result.replies[0].split("\n")[1];
    const replay = await send(requested);
    expect(await replay.json()).toEqual(result);
    expect(await sql`select token_hash from platform.calendar_invites`).toHaveLength(1);
    expect(await sql`select body from network.messages where type='calendar_invite' and direction='outbound'`).toEqual([{ body: "Private calendar invite reply." }]);

    const file = await download(link);
    expect(file.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    const contents = (await file.text()).replace(/\r\n /g, "");
    expect(contents).toContain(`DTSTART:${iCalTime(booked.meetingAt!)}`);
    expect(contents).toContain(`LOCATION:${booked.venue}`);
    expect(contents).not.toMatch(/Blair|Ari|ATTENDEE|\+1212/);
    expect((await download(link.replace("friends.help", "peon.biz"))).status).toBe(404);
    expect((await download(link + "x")).status).toBe(404);

    // A changed start invalidates the old file and its signed reply. A newly requested file uses the new start.
    await save({ ...booked, meetingAt: booked.meetingAt! + HOUR, scheduleRevision: 1 });
    expect((await download(link)).status).toBe(404);
    expect((await send(requested)).status).toBe(409);
    expect((await send(confirm)).status).toBe(409);
    const timed = await (await send(turn("calendar-expires"))).json();
    const timedLink = timed.replies[0].split("\n")[1];
    clock.advance(15 * MINUTE);
    expect((await download(timedLink)).status).toBe(404);

    // spec/meetingReschedule.md, "Only independent answers to the current offer can change the booking"
    const originalAt = Date.UTC(2026, 10, 21, 17);
    const proposedAt = Date.UTC(2026, 10, 22, 18);
    const venue = PLAN_VENUES.find(candidate => candidate.id === "mccarren-park")!;
    await rt.unitOfWork(n => n.importState({ ...n.exportState(), members: bookedState.members,
      opps: [{ ...booked, meetingAt: originalAt, venue: venue.name, venueArea: venue.area }] }));
    const propose = turn("calendar-reschedule", `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`);
    const offered = await (await send(propose)).json();
    const code = /RESCHEDULE NO [a-p]{16}/.exec(offered.replies.join(" "))?.[0];
    expect(code).toBeDefined();
    expect(await (await send(propose)).json()).toEqual(offered);
    const pendingDraft = async () => (await rt.pg.load())!.opps.find(opp => opp.id === id)?.reschedule;
    const earlyTime = clock.now();
    expect((await send(turn("calendar-reschedule-without-receipt", code!))).status).toBe(200);
    expect(await pendingDraft()).toMatchObject({ accepted: [] });
    clock.advance(MINUTE);
    expect((await acceptCollected(propose, offered.replyIds)).status).toBe(200);
    const delayed = { ...turn("calendar-reschedule-before-receipt", code!), receivedAt: earlyTime };
    expect((await send(delayed)).status).toBe(200);
    expect(await pendingDraft()).toMatchObject({ accepted: [] });
    const future = { ...turn("calendar-reschedule-future-time", code!), receivedAt: clock.now() + MINUTE };
    expect((await send(future)).status).toBe(200);
    expect(await pendingDraft()).toMatchObject({ accepted: [] });
    const peerOffer = delivered.find(message => message.to === phones[1] && message.text.includes("Reply RESCHEDULE YES"));
    const peerYes = /RESCHEDULE YES [a-p]{16}/.exec(peerOffer?.text ?? "")?.[0];
    expect(peerYes).toBeDefined();
    expect((await send(turn("calendar-reschedule-peer-yes", peerYes!, phones[1]))).status).toBe(200);
    expect(await pendingDraft()).toMatchObject({ accepted: [ids[1]] });
    expect((await send(turn("calendar-reschedule-decline", code!))).status).toBe(200);
    expect((await send(propose)).status).toBe(409);

    const stopped = turn("calendar-stop-target");
    const latest = await (await send(stopped)).json();
    const latestLink = latest.replies[0].split("\n")[1];
    expect((await download(latestLink)).status).toBe(200);
    await send(turn("calendar-stop", "STOP"));
    expect((await download(latestLink)).status).toBe(404);
    expect((await send(stopped)).status).toBe(409);
    expect((await send(confirm)).status).toBe(409);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
