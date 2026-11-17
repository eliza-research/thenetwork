import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { reengagementDeliveryPrefix } from "../../core/src/generated/outreachPolicy.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, START } from "./mini.ts";

// spec/outreachPolicy.md, "Re-engagement requires current evidence of silence"
test("a deferred re-engagement is discarded after a member answers, including across restart", async () => {
  const start = Date.UTC(2026, 10, 7, 15); // 10:00 New York, before the default send window.
  const world = new Mini([{ id: "quiet", name: "Quinn", age: 30 }, { id: "silent", name: "Sam", age: 31 }],
    { matchingEnabled: false, growth: false, plans: false });
  await world.onboard("quiet", "silent");
  const saved = world.net.exportState();
  for (const member of saved.members) {
    Object.assign(member, { onlyWhenAsked: true, outbound: 2, unsolStreak: 2, lastInbound: START, lastAskAt: START,
      openAskAt: undefined, awaiting: undefined, replies: [], heldHighAt: start - DAY });
  }
  world.net.importState(saved);
  world.clock.set(start);
  await world.net.tick(start);
  expect(world.net.exportState().deferred.filter(item => item.kind === "reengage").map(item => item.memberId).sort()).toEqual(["quiet", "silent"]);

  const sendAt = Math.max(...world.logs.filter(entry => entry.kind === "send_deferred" && entry.detail.kind === "reengage")
    .map(entry => entry.detail.until as number));
  world.clock.advance(HOUR);
  await world.say("quiet", "Thanks, all good.");
  world.restart();
  world.clock.set(sendAt);
  await world.net.tick(sendAt);
  expect(world.sent.filter(item => item.meta.reengagement).map(item => item.to)).toEqual(["silent"]);
});

test.skipIf(!pgAvailable)("the persisted queue sends one current re-engagement and discards one superseded by a signed reply", async () => {
  const url = await migratedDb("reengagement");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 7, 21)); // 16:00 New York, inside the send window.
  const app = APPS.friends;
  const secret = "synthetic-reengagement-signing-key";
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550580", clock, log: () => {}, liveGate: () => true,
    provider: { kind: "sim", async send(request) {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
    } },
  });
  const service = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {}, adapter: () => adapter,
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret, CLEF_RATINGS: "off" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }], network: { plans: false, growth: false, runHour: 16 },
  });
  try {
    await service.start();
    const members = [];
    for (const [name, e164] of [["Ari", "+12125550581"], ["Bea", "+12125550582"]] as const) {
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}: ${joined.error}`);
      members.push({ id: joined.membership.memberId, name, e164, age: 30 });
    }
    const [responded, silent] = [members[0]!, members[1]!];
    const mini = new Mini(members, { app: app.id });
    await mini.onboard(responded.id, silent.id);
    const rt = service.runtimeFor(app.id)!;
    const saved = mini.net.exportState().members.map(member => ({ ...member, onlyWhenAsked: true, outbound: 2, unsolStreak: 2,
      lastInbound: START, lastAskAt: START, openAskAt: undefined, awaiting: undefined, replies: [], heldHighAt: clock.now() - DAY }));
    await rt.unitOfWork(net => net.importState({ ...net.exportState(), members: saved }));
    await adapter.lineSafety("review", "fixture");
    await service.tick();
    const queued = await sql<{ id: string; member_id: string }[]>`select id, member_id from network.messages
      where app_id=${app.id} and id like ${`${reengagementDeliveryPrefix}%`} order by member_id`;
    expect(queued).toHaveLength(2);
    const attempted = () => calls.filter(call => call.idempotencyKey.startsWith(`tn:${reengagementDeliveryPrefix}`)).map(call => call.to);
    expect(attempted()).toEqual([]);
    for (const row of queued) expect(await adapter.queue.statusOf(row.id)).toBe("retry_scheduled");

    clock.advance(HOUR);
    const turn: TurnRequest = { app: app.id, messageId: "reengagement-reply", channel: "blooio", from: responded.e164, to: null,
      transport: "imessage", text: "Thanks, all good.", receivedAt: clock.now() };
    const body = JSON.stringify(turn);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: turn.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    expect((await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }))).status).toBe(200);
    await adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rt.deliver();
    await rt.deliver();
    for (const row of queued) {
      const [stored] = await sql`select status,note,last_error from platform.outbound where id=${row.id}`;
      expect(stored?.status, JSON.stringify(stored)).toBe(row.member_id === responded.id ? "suppressed_ineligible" : "sent");
    }
    expect(attempted()).toEqual([silent.e164]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
