import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { localBookingStart, rescheduleUpdateKey } from "../src/rescheduling.ts";
import { Mini, type Spec } from "./mini.ts";
import { holdEveryItem, simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

test.skipIf(!pgAvailable)("queued invitations and meeting messages recheck the current member and opportunity", async () => {
  // spec/outboundAdmission.md, "A queued match invitation still needs the member's current settings"
  // spec/outboundAdmission.md, "A current row needs a delivering line and the recipient's eligibility"
  // spec/outboundAdmission.md, "A cancelled booking can notify a participant who received the booked plan"
  // spec/meetingSettlement.md, "The day-of check-in uses one near-meeting message"
  const url = await migratedDb("participation_outbound");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "synthetic-named-cancellation-fixture";
  const app = APPS.friends;
  const phones = ["+12125550381", "+12125550382"];
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550380", clock, log: () => {}, provider: {
    kind: "sim", send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
  });
  const sendTurn = async (messageId: string, text: string, receivedAt = clock.now()) => {
    const input: TurnRequest = { app: app.id, channel: "blooio", from: phones[0]!, to: null, messageId,
      transport: "imessage", receivedAt, text };
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }));
  };
  try {
    await service.start();
    const members: Spec[] = [];
    for (const [index, e164] of phones.entries()) {
      const name = index === 0 ? "Ari" : "Blair";
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const [first, second] = members.map(m => m.id);
    const w = new Mini(members, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
    await w.onboard(first!, second!);
    const oppId = w.propose([first!, second!], { category: "hobby" });
    expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === oppId), 2 * DAY)).toBe(true);
    expect(w.net.review(oppId, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => w.probed(first!), DAY)).toBe(true);
    await w.say(first!, "yes");
    expect(await w.runUntil(() => w.probed(second!), DAY)).toBe(true);
    const rt = service.runtimes.get("friends:nyc")!;
    const before = calls.length;
    await adapter.queue.setLineSafety("review");
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: w.net.exportState().members, opps: w.net.exportState().opps });
      rt.unit.sends.push(
        { id: "probe-paused", memberId: first!, to: phones[0], kind: "proactive", body: "Would you like to join an activity?", type: "plan_probe", oppId, proactive: true, system: false, ts: clock.now() },
        { id: "probe-disabled", memberId: second!, to: phones[1], kind: "proactive", body: "Would you like to join an activity?", type: "probe", oppId, proactive: true, system: false, ts: clock.now() },
        { id: "logistics-paused", memberId: first!, to: phones[0], kind: "transactional", body: "Your requested update is ready.", type: "reminder", oppId, proactive: false, system: false, ts: clock.now() },
      );
    });
    expect(await adapter.queue.statusOf("probe-paused")).toBe("retry_scheduled");
    expect(await adapter.queue.statusOf("probe-disabled")).toBe("retry_scheduled");
    await sql`update network.members set participation_state='paused' where app_id=${app.id} and id=${first!}`;
    await sql`update network.members set prefs=prefs || ${{ categoriesOptIn: ["social"] }}::jsonb where app_id=${app.id} and id=${second!}`;
    await adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rt.deliver();
    expect(await adapter.queue.statusOf("probe-paused")).toBe("suppressed_ineligible");
    expect(await adapter.queue.statusOf("probe-disabled")).toBe("suppressed_ineligible");
    expect(await adapter.queue.statusOf("logistics-paused")).toBe("sent");

    // Take a real terminal consent transition, then deliver its stored notice through the adapter.
    await w.say(second!, "no");
    const release = w.sent.find(s => s.meta.type === "cancellation" && s.meta.proposalId === oppId);
    expect(release?.to).toBe(first);
    const releaseId = `opportunity-release:${oppId}:${first}`;
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), opps: w.net.exportState().opps });
      rt.unit.sends.push({ id: releaseId, memberId: first!, to: phones[0], kind: "transactional", body: release!.body,
        type: "cancellation", oppId, proactive: false, system: false, ts: clock.now() });
    });
    expect(await adapter.queue.statusOf(releaseId)).toBe("sent");
    await rt.deliver();
    expect(calls.slice(before).map(call => call.idempotencyKey)).toEqual(["tn:logistics-paused", `tn:${releaseId}`]);

    // A current day-before reminder sends. A pending copy for the other participant expires at the end of its window.
    const pair = new Mini(members, { app: app.id, inlineJudge: simulatedReviewJudge({ exceptions: false }), plans: false, growth: false });
    pair.clock.set(clock.now());
    await pair.onboard(first!, second!);
    const planId = pair.propose([first!, second!]);
    await pair.answerProbes([first!, second!]);
    const booked = pair.net.exportState().opps.find(o => o.id === planId && o.stage === "scheduled")!;
    expect(booked.bookedTold).toEqual(expect.arrayContaining([first, second]));
    clock.set(booked.meetingAt! - DAY);
    for (const phone of phones) await adapter.engaged(phone);
    await sql`update network.members set prefs=prefs || ${{ quietHours: [0, 0] }}::jsonb where app_id=${app.id}`;
    const stageBookingNotice = (opportunity: typeof booked, index: number) => {
      const memberId = members[index]!.id;
      const revision = opportunity.scheduleRevision ?? 0;
      const id = revision > 0 ? rescheduleUpdateKey(opportunity.id, revision, memberId) : `fixture-booking:${opportunity.id}:${memberId}`;
      rt.unit.sends.push({ id, memberId, to: phones[index], kind: "transactional", type: revision > 0 ? "scheduling" : "proposal",
        oppId: opportunity.id, body: "Your meeting is booked at the park.", proactive: false, system: false, ts: clock.now() });
      return id;
    };
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: pair.net.exportState().members, opps: [booked] });
      stageBookingNotice(booked, 0);
      stageBookingNotice(booked, 1);
    });
    const queueReminder = (i: number, memberId: string) => rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), opps: [booked] });
      rt.unit.sends.push({ id: `day-before-reminder:${planId}:${memberId}`, memberId, to: phones[i], kind: "transactional",
        body: "Reminder: Saturday at the park.", type: "reminder", oppId: planId, proactive: false, system: false, ts: clock.now() });
    });
    await queueReminder(0, first!);
    expect(await adapter.queue.statusOf(`day-before-reminder:${planId}:${first}`)).toBe("sent");
    await adapter.queue.setLineSafety("review");
    await queueReminder(1, second!);
    const delayedReminder = `day-before-reminder:${planId}:${second}`;
    expect(await adapter.queue.statusOf(delayedReminder)).toBe("retry_scheduled");
    clock.advance(12 * HOUR);
    await adapter.queue.setLineSafety(undefined);
    await rt.deliver();
    expect(await adapter.queue.statusOf(delayedReminder)).toBe("suppressed_ineligible");
    expect(calls.some(call => call.idempotencyKey === `tn:${delayedReminder}`)).toBe(false);

    // The live queue suppresses a delayed check-in for a superseded schedule of the same booking.
    clock.set(booked.meetingAt! - 3 * HOUR);
    for (const phone of phones) await adapter.engaged(phone);
    await adapter.queue.setLineSafety("review");
    const pairedMembers = pair.net.exportState().members;
    await rt.unitOfWork(async net => {
      net.importState({ ...net.exportState(), members: pairedMembers, opps: [booked] });
      await net.tick(clock.now());
    });
    const firstCheckIn = `day-of-checkin:${planId}:r0:${first}`;
    expect(await adapter.queue.statusOf(firstCheckIn)).toBe("retry_scheduled");
    const booking = async () => (await rt.pg.load())?.opps.find(opp => opp.id === planId);
    expect((await sendTurn("held-check-in-no", "no")).status).toBe(200);
    expect(await booking()).toMatchObject({ stage: "scheduled", status: expect.arrayContaining([[first, "yes"]]) });
    expect(calls.some(call => call.idempotencyKey === `tn:${firstCheckIn}`)).toBe(false);
    const revised = { ...booked, scheduleRevision: 1, meetingAt: booked.meetingAt! + HOUR };
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: pairedMembers, opps: [revised] }));
    clock.advance(HOUR);
    await adapter.queue.setLineSafety(undefined);
    await rt.deliver();
    expect(await adapter.queue.statusOf(firstCheckIn)).toBe("suppressed_ineligible");
    await rt.unitOfWork(() => { stageBookingNotice(revised, 0); });
    await rt.unitOfWork(net => net.tick(clock.now()));
    const revisedCheckIn = `day-of-checkin:${planId}:r1:${first}`;
    expect(await adapter.queue.statusOf(revisedCheckIn)).toBe("sent");
    expect((await sendTurn("delayed-check-in-no", "no", clock.now() - MINUTE)).status).toBe(200);
    expect(await booking()).toMatchObject({ stage: "scheduled", status: expect.arrayContaining([[first, "yes"]]) });
    expect((await sendTurn("delivered-check-in-yes", "yes")).status).toBe(200);
    expect((await booking())?.explicit).toContain(first);
    await rt.deliver();
    expect(calls.filter(call => call.idempotencyKey === `tn:${revisedCheckIn}`)).toHaveLength(1);
    expect(calls.some(call => call.idempotencyKey === `tn:${firstCheckIn}`)).toBe(false);

    // A signed cancellation with an exact time belongs to that meeting, even with another reply pending.
    const previousSchedule = { ...booked, id: `${planId}-another`, meetingAt: booked.meetingAt! + DAY, scheduleRevision: 1 };
    const another = { ...previousSchedule, meetingAt: previousSchedule.meetingAt + HOUR, scheduleRevision: 2 };
    await sql`update network.members set participation_state='normal' where app_id=${app.id} and id=${first!}`;
    for (const phone of phones) await adapter.engaged(phone);
    const receivedScheduleNotice = await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: pairedMembers, opps: [revised, previousSchedule] });
      return stageBookingNotice(previousSchedule, 1);
    });
    expect(await adapter.queue.statusOf(receivedScheduleNotice)).toBe("sent");
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: pairedMembers, opps: [revised, another] }));
    const pendingSlot = async () => (await rt.pg.load())?.members.find(member => member.id === first)?.awaiting;
    expect(await pendingSlot()).toMatchObject({ kind: "booked", oppId: planId });
    const cancelAt = (messageId: string, at: number) =>
      sendTurn(messageId, `Please cancel my meeting on ${localBookingStart(at).replace(" ", " at ")}`);
    const unknown = await cancelAt("unknown-meeting-time", another.meetingAt + HOUR);
    expect(await unknown.json()).toMatchObject({ replies: [expect.stringContaining("couldn't find")] });
    expect(await pendingSlot()).toMatchObject({ kind: "booked", oppId: planId });
    const confirmation = await cancelAt("named-meeting-time", another.meetingAt);
    expect(await confirmation.json()).toMatchObject({ replies: [expect.stringContaining("thanks for the heads up")] });
    expect((await rt.pg.load())?.opps.map(opp => [opp.id, opp.stage])).toEqual([[planId, "scheduled"], [another.id, "closed"]]);
    expect(await pendingSlot()).toMatchObject({ kind: "booked", oppId: planId });
    const sentCancellation = `booked-cancellation:${another.id}:${second}`;
    expect(await adapter.queue.statusOf(sentCancellation)).toBe("sent");
    expect(calls.filter(call => call.idempotencyKey === `tn:${sentCancellation}`)).toHaveLength(1);
    expect(calls.some(call => call.idempotencyKey === `tn:booked-cancellation:${planId}:${second}`)).toBe(false);

    for (const [suffix, text] of [["drop", "I can't make it."], ["block", "Block Blair"]] as const) {
      const cancelledId = `${planId}-${suffix}`;
      await adapter.engaged(phones[0]!);
      await adapter.engaged(phones[1]!);
      const booking = { ...booked, id: cancelledId };
      const bookingNotice = await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: pairedMembers, opps: [booking] });
        return stageBookingNotice(booking, 1);
      });
      expect(await adapter.queue.statusOf(bookingNotice)).toBe("sent");
      await rt.unitOfWork(async net => {
        await net.onInbound({ id: `cancel-${suffix}`, memberId: first!, body: text, ts: clock.now(), channel: "sms" });
        rt.unit.sends.push({ id: `stale-${suffix}`, memberId: second!, to: phones[1], kind: "transactional",
          body: "The previous meeting reminder.", type: "reminder", oppId: cancelledId, proactive: false, system: false, ts: clock.now() });
      });
      const cancellation = `booked-cancellation:${cancelledId}:${second}`;
      expect(await sql`select state from network.opportunities where id=${cancelledId}`).toEqual([{ state: "CANCELLED" }]);
      expect((await rt.pg.load())?.opps.find(o => o.id === cancelledId)).toMatchObject({ stage: "closed", closedFrom: "scheduled", bookedTold: expect.arrayContaining([second]) });
      expect(await adapter.queue.statusOf(cancellation), suffix).toBe("sent");
      expect(await adapter.queue.statusOf(`stale-${suffix}`)).toBe("expired");
      await rt.deliver();
      const delivered = calls.filter(call => call.idempotencyKey === `tn:${cancellation}`);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.to).toBe(phones[1]);
      expect(delivered[0]?.text).not.toMatch(/ari|blair|blocked|declined/i);
    }
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
