import { expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import type { EngineAsk } from "@thenetwork/engine";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";

test.skipIf(!pgAvailable)("a queued profiling question reaches only the member whose exact turn is still open", async () => {
  const url = await migratedDb("engine_question_delivery");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
  const app = APPS.friends;
  const runtimeId = "friends:nyc";
  const secret = "synthetic-engine-question-delivery";
  const people = [{ name: "Alex", e164: "+12125550801" }, { name: "Drew", e164: "+12125550802" }];
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550800", clock, log: () => {}, provider: {
    kind: "sim", send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, adapter, networks: [{ id: runtimeId }],
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, network: { plans: false, growth: false } });
  try {
    await service.start();
    const members: Spec[] = [];
    for (const { name, e164 } of people) {
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error("Fixture join was refused");
      members.push({ id: joined.membership.memberId, name, age: 30 });
      await adapter.engaged(e164);
    }
    const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
    const now = clock.now();
    fixture.clock.set(now);
    await fixture.onboard(...members.map(member => member.id));
    const rt = service.runtimes.get(runtimeId)!;
    const question = "What activity would you like to try next?";
    await adapter.queue.setLineSafety("review");
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members });
      // Use the serving path with a deterministic engine result.
      (net as unknown as { sendAsks(asks: EngineAsk[], at: number): void }).sendAsks(members.map(member => ({
        kind: "ask", id: `fixture:${member.id}`, memberId: member.id, reason: "few_facets", question, createdAt: now,
      })), now);
    });
    const staged = await sql<{ id: string; member_id: string }[]>`select id,member_id from network.messages
      where app_id=${app.id} and direction='outbound' and type='question' and body like ${`%${question}%`}`;
    expect(staged).toHaveLength(2);
    for (const row of staged) expect(await adapter.queue.statusOf(row.id)).toBe("retry_scheduled");

    clock.advance(HOUR);
    const inbound: TurnRequest = { app: app.id, channel: "blooio", transport: "imessage", from: people[0]!.e164,
      to: null, messageId: "after-engine-question", text: "I would like to try birdwatching.", receivedAt: clock.now() };
    const body = JSON.stringify(inbound);
    const signed = await svcSign(secret, { id: inbound.messageId, path: TURN_PATH, method: "POST", body, nowS: Math.floor(clock.now() / 1000) });
    const turn = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...signed }, body }));
    expect(turn.status).toBe(200);
    await adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rt.deliver();
    await rt.deliver();

    const stale = staged.find(row => row.member_id === members[0]!.id)!;
    const current = staged.find(row => row.member_id === members[1]!.id)!;
    expect(await adapter.queue.statusOf(stale.id)).toBe("suppressed_ineligible");
    expect(await adapter.queue.statusOf(current.id)).toBe("sent");
    expect(calls.filter(call => call.idempotencyKey === `tn:${stale.id}`)).toHaveLength(0);
    expect(calls.filter(call => call.idempotencyKey === `tn:${current.id}`)).toHaveLength(1);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
});
