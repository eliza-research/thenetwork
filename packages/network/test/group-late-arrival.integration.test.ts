import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { lateArrivalNotice } from "../../core/src/generated/groupLateArrival.ts";
import { lateArrivalDeliveryId, parseLateArrivalDeliveryId } from "../src/group-late-arrival.ts";
import { storedGroupLateArrivalCurrent } from "../src/network.ts";
import { Mini, START } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

async function booked(participants = ["a", "b", "c"]) {
  const world = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")],
    { lateArrivalTurnAllowed: (memberId, messageId) => messageId.startsWith(`signed:${memberId}:`) });
  await world.onboard("a", "b", "c", "d");
  const oppId = world.propose(participants);
  await world.answerProbes(participants);
  const saved = world.net.exportState();
  const opp = saved.opps.find(o => o.id === oppId)!;
  expect(opp).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(participants) });
  return { world, oppId, meetingAt: opp.meetingAt! };
}

function lateNotices(world: Mini, from: number) {
  return world.sent.slice(from).filter(message => message.body === lateArrivalNotice);
}

function report(world: Mini, id: string, body = "I’m running late.", source?: "mcp") {
  return world.net.onInbound({ id, body, memberId: "a", channel: "sms", ts: world.clock.now(), source });
}

test("one exact signed report reaches only booked group recipients and survives restart", async () => {
  const { world, oppId, meetingAt } = await booked();
  const mark = world.mark();
  world.clock.set(meetingAt - HOUR - 1);
  await report(world, "signed:a:early");
  expect(lateNotices(world, mark)).toHaveLength(0);

  world.clock.set(meetingAt - HOUR);
  await report(world, "unsigned:a:report");
  await report(world, "signed:a:assistant", undefined, "mcp");
  await report(world, "signed:a:request", "tell them I'm running late");
  expect(lateNotices(world, mark)).toHaveLength(0);

  await expect(report(world, "signed:a:report")).resolves.toBe("handled");
  const notices = lateNotices(world, mark);
  expect(notices.map(notice => notice.to).sort()).toEqual(["b", "c"]);
  expect(notices.every(notice => !notice.reply && notice.meta.proposalId === oppId)).toBe(true);

  world.restart();
  world.clock.set(meetingAt + 29 * MINUTE);
  await expect(report(world, "signed:a:repeat", "RUNNING LATE")).resolves.toBe("handled");
  expect(lateNotices(world, mark)).toHaveLength(2);

  const binding = { app: "ntwrk", oppId, meetingAt, revision: 0, from: "a", to: "b" };
  expect(parseLateArrivalDeliveryId(lateArrivalDeliveryId(binding))).toEqual(binding);
  const deliveredBooking = (id: string) => ["a", "b", "c"].includes(id);
  expect(storedGroupLateArrivalCurrent(world.net.exportState(), binding, world.clock.now(), deliveredBooking)).toBe(true);
  expect(storedGroupLateArrivalCurrent(world.net.exportState(), binding, meetingAt + 30 * MINUTE, deliveredBooking)).toBe(false);

  const changed = world.net.exportState();
  const opp = changed.opps.find(o => o.id === oppId)!;
  opp.scheduleRevision = 2;
  expect(storedGroupLateArrivalCurrent(changed, binding, world.clock.now(), deliveredBooking)).toBe(false);
  opp.scheduleRevision = 0;
  changed.members.find(m => m.id === "a")!.optedOut = true;
  expect(storedGroupLateArrivalCurrent(changed, binding, world.clock.now(), deliveredBooking)).toBe(false);
});

test("a direct report with overlapping bookings leaves both groups untouched", async () => {
  const { world, oppId, meetingAt } = await booked();
  world.clock.set(meetingAt);
  const saved = world.net.exportState();
  const opp = saved.opps.find(opportunity => opportunity.id === oppId)!;
  saved.opps.push({ ...opp, id: "second-current-group" });
  world.net.importState(saved);
  const mark = world.mark();
  await report(world, "signed:a:ambiguous");
  expect(lateNotices(world, mark)).toHaveLength(0);
  expect(world.net.exportState().opps.every(o => !o.lateArrivalReported)).toBe(true);
});

test("a two-person booking keeps its existing relay path", async () => {
  const { world, meetingAt } = await booked(["a", "b"]);
  world.clock.set(meetingAt);
  const mark = world.mark();
  await report(world, "signed:a:pair");
  expect(lateNotices(world, mark)).toHaveLength(0);
  expect(world.net.exportState().opps.every(o => !o.lateArrivalReported)).toBe(true);
});

test.skipIf(!pgAvailable).each([false, true])("the signed turn needs three current booking receipts at submission and dispatch (provider failure: %s)", async receiptFailed => {
  const url = await migratedDb("group_late");
  const sql = new SQL(url);
  const app = APPS.friends;
  const key = "synthetic-late-arrival-turn-signing-key";
  const clock = new SimClock(START);
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550280", clock, liveGate: () => true, log: () => {}, provider: {
    kind: "sim",
    send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({ url, clock, log: () => {}, adapter: () => adapter, photoStorage: null,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: key }, networks: [{ id: "friends:nyc", matchingEnabled: false }] });
  try {
    await service.start();
    const phones = ["+12125550281", "+12125550282", "+12125550283"] as const;
    const names = ["Ana Diaz", "Ben Ito", "Cy Moss"] as const;
    const members = [];
    for (const [index, e164] of phones.entries()) {
      const name = names[index]!;
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push(climber(joined.membership.memberId, name));
    }
    const ids = members.map(member => member.id);
    const [from, second, third] = ids as [string, string, string];
    const world = new Mini(members, { app: app.id, plans: false, growth: false });
    await world.onboard(...ids);
    const oppId = world.propose(ids);
    await world.answerProbes(ids);
    const state = world.net.exportState();
    const opp = state.opps.find(p => p.id === oppId)!;
    const meetingAt = opp.meetingAt!;
    expect(opp).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(ids) });
    const rt = service.runtimes.get("friends:nyc")!;
    clock.set(meetingAt - MINUTE);
    for (const phone of phones) await adapter.engaged(phone);
    await sql`update network.members set prefs=prefs || ${{ quietHours: [0, 0] }}::jsonb where app_id=${app.id}`;
    const bookingNotice = (index: number) => {
      const memberId = ids[index]!;
      const id = `fixture-group-booking:${oppId}:${memberId}`;
      rt.unit.sends.push({ id, memberId, to: phones[index], kind: "transactional", type: "proposal", oppId,
        body: "Your climbing session is booked at the park.", bookingRoster: ids, proactive: false, system: false, ts: clock.now() });
      return id;
    };
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: state.members, opps: state.opps });
      bookingNotice(0);
      bookingNotice(1);
    });
    const reportAt = async (messageId: string, receivedAt = clock.now()) => {
      const body = JSON.stringify({ messageId, channel: "blooio", from: phones[0], to: null, text: "I'm running late.",
        transport: "imessage", receivedAt, app: app.id } satisfies TurnRequest);
      const headers = await svcSign(key, { method: "POST", path: TURN_PATH, body, id: messageId, nowS: Math.floor(clock.now() / 1000) });
      return service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers, body }));
    };
    // spec/groupLateArrival.md, "Relay one direct report for one current booked group"
    expect(calls.filter(call => call.idempotencyKey.startsWith("tn:fixture-group-booking:"))).toHaveLength(2);
    expect((await reportAt("synthetic-group-late-missing-third")).status).toBe(200);
    expect((await rt.pg.load())!.opps[0]?.lateArrivalReported).toBeUndefined();
    expect(calls.filter(call => call.text === lateArrivalNotice)).toHaveLength(0);
    const thirdBooking = await rt.unitOfWork(() => bookingNotice(2));
    expect(await adapter.queue.statusOf(thirdBooking)).toBe("sent");
    await adapter.queue.setLineSafety("review");
    expect((await reportAt("synthetic-group-late-old-receive-time", clock.now() - 1)).status).toBe(200);
    expect((await rt.pg.load())!.opps[0]?.lateArrivalReported).toBeUndefined();
    const response = await reportAt("synthetic-group-late-arrival");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "handled", replies: ["I’ll pass along a short update where I can."] });

    const current = (to: string) => lateArrivalDeliveryId({ app: app.id, oppId, meetingAt, revision: 0, from, to });
    const queued = await sql`select id,member_id,body from platform.outbound where id in ${sql([current(second), current(third)])} order by member_id`;
    expect(queued).toEqual([second, third].sort().map(to => ({ id: current(to), member_id: to, body: lateArrivalNotice })));
    expect(calls.filter(call => call.text === lateArrivalNotice)).toHaveLength(0);
    const cutoff = meetingAt + 30 * MINUTE;
    await sql`update platform.outbound set next_attempt_at=${new Date(clock.now())} where id=${current(second)}`;
    await sql`update platform.outbound set next_attempt_at=${new Date(cutoff)} where id=${current(third)}`;
    await adapter.queue.setLineSafety(undefined);
    await rt.deliver();
    expect(await adapter.queue.statusOf(current(second))).toBe("sent");
    expect(calls.filter(call => call.text === lateArrivalNotice).map(call => call.to)).toEqual([phones[1]]);

    if (receiptFailed) {
      expect(await adapter.status({ kind: "status", channel: "blooio", providerMessageId: `sim:tn:${thirdBooking}`,
        status: "failed", at: clock.now() })).toMatchObject({ id: thirdBooking, status: "failed" });
      await sql`update platform.outbound set next_attempt_at=${new Date(clock.now())} where id=${current(third)}`;
    } else {
      clock.set(cutoff);
    }
    await rt.deliver();
    expect(await adapter.queue.statusOf(current(third))).toBe("suppressed_ineligible");
    expect(calls.filter(call => call.text === lateArrivalNotice).map(call => call.to)).toEqual([phones[1]]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
});
