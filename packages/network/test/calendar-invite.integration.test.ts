import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { bookedCancellationPrefix } from "../../core/src/generated/outboundAdmission.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { bookedReminderKey } from "../src/network.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { localBookingStart, rescheduleUpdateKey } from "../src/rescheduling.ts";
import { Mini } from "./mini.ts";

const calendarJourney = "a signed calendar request downloads the current booking with no participant details";
const expiredBookingNotice = "an original booking notice cannot send or replay once the meeting starts";
const cancelAfterNotice = "a cancellation reaches a booked participant who received the details";
const cancelBeforeNotice = "a cancellation stays private from a booked participant whose details never sent";
const cancelWaitingForNotice = "a cancellation waits for a pending signed receipt of booking details";
const feedbackReception = "post-meeting feedback reaches only a participant who received the booking";
const feedbackWaitingForNotice = "post-meeting feedback waits for a pending signed receipt of booking details";

test.skipIf(!pgAvailable).each([
  calendarJourney, expiredBookingNotice, cancelAfterNotice, cancelBeforeNotice, cancelWaitingForNotice, feedbackReception, feedbackWaitingForNotice,
] as const)("%s", async scenario => {
  // spec/calendarInvite.md, "The member asks for one current booking"
  // spec/calendarInvite.md, "A calendar link follows the booked revision and the current owner"
  const url = await migratedDb("calendar_invite");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, scenario === expiredBookingNotice ? 19 : 16, 16));
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
    const adapter = rt.adapter as BlooioAdapter;
    if (scenario === expiredBookingNotice || scenario === cancelBeforeNotice || scenario === feedbackReception) {
      await adapter.lineSafety("review", "hold the booking notice");
    }
    const confirm = turn("calendar-booking", "yes", phones[1]);
    const bookingReply = await (await send(confirm)).json();
    expect(bookingReply.replies.join(" ")).toContain("You're both in");
    expect(await (await send(confirm)).json()).toEqual(bookingReply);
    const bookedState = (await rt.pg.load())!;
    const booked = bookedState.opps.find(opp => opp.id === id && opp.stage === "scheduled")!;
    expect(booked.bookedTold).toEqual(expect.arrayContaining(ids));
    if (scenario === feedbackReception || scenario === feedbackWaitingForNotice) {
      // spec/meetingSettlement.md, "Send feedback requests during the open attendance period"
      // spec/meetingSettlement.md, "A feedback reply needs receipt of its exact prompt"
      const waiting = scenario === feedbackWaitingForNotice;
      if (!waiting) expect((await acceptCollected(confirm, bookingReply.replyIds)).status).toBe(200);
      const [firstBooking] = await sql`select receipt.id,receipt.status,receipt.attempts from platform.outbound receipt
        join network.messages notice on notice.app_id=receipt.app_id and notice.id=receipt.id and notice.member_id=receipt.member_id
        where notice.opportunity_id=${id} and notice.type='proposal' and notice.member_id=${ids[0]!}`;
      expect(firstBooking).toMatchObject(waiting ? { status: "accepted", attempts: 1 } : { status: "retry_scheduled", attempts: 0 });
      clock.set(booked.meetingAt! + 3 * HOUR);
      await adapter.lineSafety(undefined);
      await rt.unitOfWork(n => n.tick(clock.now()));
      expect(await sql`select state from network.opportunities where id=${id}`).toEqual([{ state: "COMPLETED" }]);
      await rt.deliver();
      const feedbackState = async () => await sql<{id: string; member_id: string; status: string; attempts: number}[]>`select
        message.id,message.member_id,receipt.status,receipt.attempts
        from network.messages message join platform.outbound receipt on receipt.app_id=message.app_id and receipt.id=message.id
        where message.opportunity_id=${id} and message.type='feedback_request'`;
      const feedback = await feedbackState();
      expect(feedback).toEqual(expect.arrayContaining([
        { id: expect.any(String), member_id: ids[0], ...(waiting ? { status: "accepted", attempts: 1 } : { status: "suppressed_ineligible", attempts: 0 }) },
        { id: expect.any(String), member_id: ids[1], ...(waiting ? { status: "retry_scheduled", attempts: 0 } : { status: "accepted", attempts: 1 }) },
      ]));
      const feedbackKeys = new Set(feedback.map(message => `tn:${message.id}`));
      const feedbackSends = () => delivered.filter(call => feedbackKeys.has(call.idempotencyKey));
      expect(feedbackSends()).toEqual([expect.objectContaining({ to: phones[waiting ? 0 : 1],
        text: expect.stringContaining(waiting ? "Blair" : "Ari") })]);
      const feedbackText = "It was great. I would definitely meet again.";
      const feedbackData = async () => (await rt.pg.load())!.feedback.filter(record => record.opportunityId === id);
      if (waiting) {
        const beforePrompt = turn("feedback-before-prompt", feedbackText, phones[1]);
        expect((await send(beforePrompt)).status).toBe(200);
        expect(await feedbackData()).toEqual([]);
        expect((await acceptCollected(confirm, bookingReply.replyIds)).status).toBe(200);
        clock.advance(5 * MINUTE);
        await rt.deliver();
        await rt.deliver();
        expect((await feedbackState()).map(row => [row.status, row.attempts])).toEqual([["accepted", 1], ["accepted", 1]]);
        expect(feedbackSends().map(message => message.to)).toEqual(phones);
        expect((await send({ ...beforePrompt, messageId: "feedback-delayed" })).status).toBe(200);
        expect((await send({ ...turn("feedback-future", feedbackText, phones[1]), receivedAt: clock.now() + MINUTE })).status).toBe(200);
        expect(await feedbackData()).toEqual([]);
        const answer = turn("feedback-on-time", feedbackText, phones[1]);
        expect((await send(answer)).status).toBe(200);
        expect((await send(answer)).status).toBe(200);
        expect(await feedbackData()).toMatchObject([{ from: ids[1], about: ids[0], sentiment: "positive", repeatConsent: true }]);

        const afterDeadline = booked.meetingAt! + 4 * DAY + MINUTE;
        // An exact answer after settlement can affect private feedback but cannot rewrite attendance.
        clock.set(afterDeadline);
        await rt.unitOfWork(n => n.tick(clock.now()));
        const settled = async () => {
          const saved = (await rt.pg.load())!;
          const opportunity = saved.opps.find(opp => opp.id === id)!;
          const member = saved.members.find(m => m.id === ids[0])!;
          return { finalized: opportunity.finalized, post: opportunity.post, noShows: member.noShows,
            completedSinceNoShow: member.completedSinceNoShow, interactions: saved.interactions.filter(record => record.id.startsWith(`${id}:fb:`)) };
        };
        const closed = await settled();
        expect(closed).toMatchObject({ finalized: true });
        expect((await send(turn("feedback-after-settlement", feedbackText, phones[0]))).status).toBe(200);
        expect(await feedbackData()).toMatchObject([{ from: ids[1] }, { from: ids[0], about: ids[1], sentiment: "positive" }]);
        expect(await settled()).toEqual(closed);
      } else {
        expect(delivered.some(call => call.idempotencyKey === `tn:${firstBooking.id}`)).toBe(false);
        expect((await send(turn("feedback-peer-absent", "I went, but the other person never showed up.", phones[1]))).status).toBe(200);
        expect(await feedbackData()).toMatchObject([{ from: ids[1], about: ids[0], sentiment: "negative" }]);
        clock.set(booked.meetingAt! + 4 * DAY + MINUTE);
        await rt.unitOfWork(n => n.tick(clock.now()));
        const missed = (await rt.pg.load())!.members.find(member => member.id === ids[0]);
        expect(missed?.noShows).toBe(0);
        expect((await send(turn("feedback-independent-report", "Report Ari, he kept harassing me.", phones[1]))).status).toBe(200);
        expect((await rt.pg.load())!.reports).toMatchObject([{ reporterId: ids[1], subjectId: ids[0], kind: "harassment", source: "message" }]);
        expect(await feedbackData()).toHaveLength(1);
      }
      return;
    }
    if (scenario === cancelAfterNotice || scenario === cancelBeforeNotice || scenario === cancelWaitingForNotice) {
      // spec/meetingSettlement.md, "Claim a cancellation only for a member who received booking details"
      const waitsForReceipt = scenario === cancelWaitingForNotice;
      const counterpart = waitsForReceipt ? 1 : 0;
      const counterpartReceived = scenario !== cancelBeforeNotice;
      const [notice] = await sql`select queued.id,queued.status,queued.attempts,queued.sent_at from platform.outbound queued
        join network.messages message on message.app_id=queued.app_id and message.id=queued.id and message.member_id=queued.member_id
        where message.opportunity_id=${id} and message.type='proposal' and message.member_id=${ids[counterpart]!}`;
      expect(notice).toMatchObject(waitsForReceipt ? { status: "collected", attempts: 0, sent_at: null } : counterpartReceived
        ? { status: "accepted", attempts: 1, sent_at: expect.any(Date) }
        : { status: "retry_scheduled", attempts: 0, sent_at: null });
      if (!waitsForReceipt) expect((await acceptCollected(confirm, bookingReply.replyIds)).status).toBe(200);
      const drop = turn("calendar-cancel", "I can't make it.", phones[1 - counterpart]);
      expect(await (await send(drop)).json()).toMatchObject({ replies: [expect.stringContaining("thanks for the heads up")] });
      expect(await sql`select state from network.opportunities where id=${id}`).toEqual([{ state: "CANCELLED" }]);
      const cancellation = `${bookedCancellationPrefix}${id}:${ids[counterpart]!}`;
      if (waitsForReceipt) {
        expect(await sql`select status,attempts from platform.outbound where id=${cancellation}`)
          .toEqual([{ status: "retry_scheduled", attempts: 0 }]);
        expect(delivered.some(call => call.idempotencyKey === `tn:${cancellation}`)).toBe(false);
        expect((await acceptCollected(confirm, bookingReply.replyIds)).status).toBe(200);
      }
      await adapter.lineSafety(undefined);
      clock.advance(HOUR);
      expect(clock.now()).toBeLessThan(booked.meetingAt!);
      await rt.deliver();
      await rt.deliver();
      const [queued] = await sql`select status,attempts from platform.outbound where id=${cancellation}`;
      const cancellations = delivered.filter(call => call.idempotencyKey === `tn:${cancellation}`);
      expect({ ...queued, providerCalls: cancellations.length }).toEqual(counterpartReceived
        ? { status: "accepted", attempts: 1, providerCalls: 1 }
        : { status: "suppressed_ineligible", attempts: 0, providerCalls: 0 });
      if (counterpartReceived) {
        expect(cancellations[0]).toMatchObject({ to: phones[counterpart] });
        expect(cancellations[0]?.text).not.toMatch(/Ari|Blair|declined|blocked/i);
      } else {
        expect(await adapter.queue.statusOf(notice.id)).toBe("expired");
        expect(delivered.some(call => call.idempotencyKey === `tn:${notice.id}`)).toBe(false);
      }
      return;
    }
    if (scenario === expiredBookingNotice) {
      // spec/meetingReschedule.md, "The original booking notice belongs to the original confirmed seat"
      const [held] = await sql`select queued.id,queued.status,queued.attempts from platform.outbound queued
        join network.messages notice on notice.app_id=queued.app_id and notice.id=queued.id and notice.member_id=queued.member_id
        where notice.opportunity_id=${id} and notice.type='proposal' and notice.member_id=${ids[0]!}`;
      expect(held).toMatchObject({ status: "retry_scheduled", attempts: 0 });
      expect(booked.meetingAt! - clock.now()).toBeLessThan(3 * DAY);
      clock.set(booked.meetingAt!);
      await adapter.lineSafety(undefined);
      await rt.deliver();
      const [state] = await sql`select status,attempts from platform.outbound where id=${held.id}`;
      const replay = await send(confirm);
      expect({ status: state.status, attempts: state.attempts, replay: replay.status,
        providerCalls: delivered.filter(call => call.idempotencyKey === `tn:${held.id}`).length })
        .toEqual({ status: "suppressed_ineligible", attempts: 0, replay: 409, providerCalls: 0 });
      expect(await replay.json()).toMatchObject({ error: "turn_booking_changed" });
      return;
    }
    // spec/meetingSettlement.md, "Claim a reminder only after the member received the current booking notice"
    const reminderAt = Math.max(clock.now(), booked.meetingAt! - DAY);
    expect(booked.meetingAt! - reminderAt).toBeGreaterThan(12 * HOUR);
    clock.set(reminderAt);
    const reminder = (memberId: string, revision = 0) => bookedReminderKey("day-before-reminder", id, memberId, revision);
    const reminderState = async (memberId: string, revision = 0) => (await sql`select status,attempts from platform.outbound where id=${reminder(memberId, revision)}`)[0];
    const reminderSends = (memberId: string, revision = 0) => delivered.filter(request => request.idempotencyKey === `tn:${reminder(memberId, revision)}`);
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

    const freshMove = turn("calendar-reschedule-new", propose.text);
    const freshOffer = await (await send(freshMove)).json();
    const proposerYes = /RESCHEDULE YES [a-p]{16}/.exec(freshOffer.replies.join(" "))![0];
    expect((await acceptCollected(freshMove, freshOffer.replyIds)).status).toBe(200);
    const freshPeerOffer = delivered.findLast(message => message.to === phones[1] && message.text.includes("Reply RESCHEDULE YES"));
    const freshPeerYes = /RESCHEDULE YES [a-p]{16}/.exec(freshPeerOffer?.text ?? "")![0];
    expect(freshPeerYes).not.toBe(peerYes);
    expect((await send(turn("calendar-reschedule-new-proposer", proposerYes))).status).toBe(200);
    const finalVote = turn("calendar-reschedule-new-peer", freshPeerYes, phones[1]);
    const movedReply = await (await send(finalVote)).json();
    const moved = (await rt.pg.load())!.opps.find(opp => opp.id === id)!;
    expect(moved).toMatchObject({ stage: "scheduled", meetingAt: proposedAt, scheduleRevision: 1 });
    expect(movedReply.replyIds).toEqual([rescheduleUpdateKey(id, 1, ids[1]!)]);
    const [originalReceipt] = await sql`select status,sent_at from platform.outbound where id=${bookingReply.replyIds[0]}`;
    const [revisedReceipt] = await sql`select status,sent_at from platform.outbound where id=${movedReply.replyIds[0]}`;
    expect(originalReceipt).toMatchObject({ status: "sent", sent_at: expect.any(Date) });
    expect(revisedReceipt).toEqual({ status: "collected", sent_at: null });

    // The accepted original notices cannot authorize a reminder for the new schedule.
    clock.set(proposedAt - DAY);
    await rt.unitOfWork(n => n.tick(clock.now()));
    expect(await reminderState(ids[0]!, 1)).toMatchObject({ status: "accepted", attempts: 1 });
    expect(await reminderState(ids[1]!, 1)).toMatchObject({ status: "retry_scheduled", attempts: 0 });
    expect(reminderSends(ids[1]!, 1)).toEqual([]);
    expect((await acceptCollected(finalVote, movedReply.replyIds)).status).toBe(200);
    clock.advance(5 * MINUTE);
    await rt.deliver();
    await rt.deliver();
    expect(await reminderState(ids[1]!, 1)).toMatchObject({ status: "accepted", attempts: 1 });
    expect(reminderSends(ids[1]!, 1)).toHaveLength(1);

    // A late request expires at the meeting start, even with time left on the normal lifetime.
    clock.set(proposedAt - 2 * MINUTE);
    const stopped = turn("calendar-stop-target");
    const latest = await (await send(stopped)).json();
    const latestLink = latest.replies[0].split("\n")[1];
    expect((await download(latestLink)).status).toBe(200);
    const [nearStartGrant] = await sql`select expires_at from platform.calendar_invites where app_id=${app.id} and issued_at=${new Date(clock.now())}`;
    expect(nearStartGrant).toEqual({ expires_at: new Date(proposedAt) });
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
