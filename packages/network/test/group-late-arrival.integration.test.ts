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
import { storedLateArrivalCurrent } from "../src/network.ts";
import { Mini, START } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const pairNotice = "The person you are meeting is running late.";

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
  expect(storedLateArrivalCurrent(world.net.exportState(), binding, world.clock.now(), deliveredBooking)).toBe(true);
  expect(storedLateArrivalCurrent(world.net.exportState(), binding, meetingAt + 30 * MINUTE, deliveredBooking)).toBe(false);

  const changed = world.net.exportState();
  const opp = changed.opps.find(o => o.id === oppId)!;
  opp.scheduleRevision = 2;
  expect(storedLateArrivalCurrent(changed, binding, world.clock.now(), deliveredBooking)).toBe(false);
  opp.scheduleRevision = 0;
  changed.members.find(m => m.id === "a")!.optedOut = true;
  expect(storedLateArrivalCurrent(changed, binding, world.clock.now(), deliveredBooking)).toBe(false);
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

test("an exact signed report reaches only the other booked person", async () => {
  const { world, oppId, meetingAt } = await booked(["a", "b"]);
  world.clock.set(meetingAt);
  const mark = world.mark();
  const state = world.net.exportState();
  state.opps.find(o => o.id === oppId)!.kind = "group";
  world.net.importState(state);
  await report(world, "signed:a:incomplete-group");
  expect(world.sent.slice(mark).filter(message => message.body === pairNotice)).toHaveLength(0);
  expect(lateNotices(world, mark)).toHaveLength(0);
  expect(world.net.exportState().opps.every(o => !o.lateArrivalReported)).toBe(true);

  state.opps.find(o => o.id === oppId)!.kind = "intro";
  world.net.importState(state);
  await expect(report(world, "signed:a:pair")).resolves.toBe("handled");
  world.restart();
  await expect(report(world, "signed:a:pair-repeat")).resolves.toBe("handled");
  expect(world.sent.slice(mark).filter(message => message.body === pairNotice).map(message => message.to)).toEqual(["b"]);
});

test.skipIf(!pgAvailable).each([
  { size: 3, finish: "deadline" },
  { size: 3, finish: "receipt" },
  { size: 2, finish: "sent" },
  { size: 2, finish: "receipt" },
])("the signed turn needs $size current booking receipts at submission and dispatch ($finish)", async ({ size, finish }) => {
  const url = await migratedDb("group_late");
  const sql = new SQL(url);
  const app = APPS.friends;
  const key = "synthetic-late-arrival-turn-signing-key";
  const clock = new SimClock(START);
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550280", clock, log: () => {}, provider: {
    kind: "sim",
    send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({ url, clock, log: () => {}, adapter: () => adapter, photoStorage: null,
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: key }, networks: [{ id: "friends:nyc", matchingEnabled: false }] });
  try {
    await service.start();
    const phones = ["+12125550281", "+12125550282", "+12125550283"].slice(0, size);
    const names = ["Ana Diaz", "Ben Ito", "Cy Moss"].slice(0, size);
    const members = [];
    for (const [index, e164] of phones.entries()) {
      const name = names[index]!;
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push(climber(joined.membership.memberId, name));
    }
    const ids = members.map(member => member.id);
    const [from, ...recipients] = ids as [string, ...string[]];
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
      for (let index = 0; index < size - 1; index++) bookingNotice(index);
    });
    const reportAt = async (messageId: string, receivedAt = clock.now()) => {
      const body = JSON.stringify({ messageId, channel: "blooio", from: phones[0], to: null, text: "I'm running late.",
        transport: "imessage", receivedAt, app: app.id } satisfies TurnRequest);
      const headers = await svcSign(key, { method: "POST", path: TURN_PATH, body, id: messageId, nowS: Math.floor(clock.now() / 1000) });
      return service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers, body }));
    };
    // spec/groupLateArrival.md, "Relay one direct report for one current booked meeting"
    const notice = size === 2 ? pairNotice : lateArrivalNotice;
    const sentNotices = () => calls.filter(call => call.text === notice).map(call => call.to);
    expect(calls.filter(call => call.idempotencyKey.startsWith("tn:fixture-group-booking:"))).toHaveLength(size - 1);
    expect((await reportAt("synthetic-late-missing-receipt")).status).toBe(200);
    expect((await rt.pg.load())!.opps[0]?.lateArrivalReported).toBeUndefined();
    expect(sentNotices()).toEqual([]);
    const lastBooking = await rt.unitOfWork(() => bookingNotice(size - 1));
    expect(await adapter.queue.statusOf(lastBooking)).toBe("sent");
    await adapter.queue.setLineSafety("review");
    expect((await reportAt("synthetic-group-late-old-receive-time", clock.now() - 1)).status).toBe(200);
    expect((await rt.pg.load())!.opps[0]?.lateArrivalReported).toBeUndefined();
    const response = await reportAt("synthetic-group-late-arrival");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "handled", replies: ["I’ll pass along a short update where I can."] });

    const current = (to: string) => lateArrivalDeliveryId({ app: app.id, oppId, meetingAt, revision: 0, from, to });
    const queued = await sql`select id,member_id,body from platform.outbound where id in ${sql(recipients.map(current))} order by member_id`;
    expect(queued).toEqual([...recipients].sort().map(to => ({ id: current(to), member_id: to, body: notice })));
    expect(sentNotices()).toEqual([]);
    const cutoff = meetingAt + 30 * MINUTE;
    const lastRecipient = current(recipients.at(-1)!);
    for (const recipient of recipients.slice(0, -1)) {
      await sql`update platform.outbound set next_attempt_at=${new Date(clock.now())} where id=${current(recipient)}`;
    }
    await sql`update platform.outbound set next_attempt_at=${new Date(finish === "sent" ? clock.now() : cutoff)} where id=${lastRecipient}`;
    await adapter.queue.setLineSafety(undefined);
    await rt.deliver();
    if (finish === "sent") {
      expect(await adapter.queue.statusOf(lastRecipient)).toBe("sent");
      expect(sentNotices()).toEqual(phones.slice(1));
      return;
    }
    const firstRecipients = phones.slice(1, -1);
    expect(sentNotices()).toEqual(firstRecipients);

    if (finish === "receipt") {
      expect(await adapter.status({ kind: "status", channel: "blooio", providerMessageId: `sim:tn:${lastBooking}`,
        status: "failed", at: clock.now() })).toMatchObject({ id: lastBooking, status: "failed" });
      await sql`update platform.outbound set next_attempt_at=${new Date(clock.now())} where id=${lastRecipient}`;
    } else {
      clock.set(cutoff);
    }
    await rt.deliver();
    expect(await adapter.queue.statusOf(lastRecipient)).toBe("suppressed_ineligible");
    expect(sentNotices()).toEqual(firstRecipients);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
});
