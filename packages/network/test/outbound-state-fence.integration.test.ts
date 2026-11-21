import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";

test.skipIf(!pgAvailable)("two replicas: a queued text follows the stored Network state, and network.messages follows the queue", async () => {
  const url = await migratedDb("outbound_state_fence");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const app = APPS.friends;
  const phones = ["+12125550481", "+12125550482"];
  const calls: SendRequest[] = [];
  const replica = () => {
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550480", clock, liveGate: () => true, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const service = new NetworkService({
      url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
    });
    return { adapter, service };
  };
  const a = replica(), b = replica();
  try {
    await a.service.start();
    await b.service.start();
    const members: Spec[] = [];
    for (const [index, e164] of phones.entries()) {
      const name = index === 0 ? "Ari" : "Blair";
      const joined = await a.service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const [first, second] = members.map(m => m.id);
    const w = new Mini(members, { app: app.id, review: "human", plans: false, growth: false });
    await w.onboard(first!, second!);
    const oppId = w.propose([first!, second!], { category: "hobby" });
    expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === oppId), 2 * DAY)).toBe(true);
    const rtA = a.service.runtimes.get("friends:nyc")!, rtB = b.service.runtimes.get("friends:nyc")!;
    const update = (id: string, i: number) => ({ id, memberId: members[i]!.id, to: phones[i], kind: "transactional" as const,
      body: "Your activity update is ready.", type: "reminder", oppId, proactive: false, system: false, ts: clock.now() });

    // spec/outboundAdmission.md, "A claim needs the Network state that its checks read"
    // Replica A queues an update about the open opportunity; the line's review pause holds it.
    await a.adapter.queue.setLineSafety("review");
    await rtA.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: w.net.exportState().members, opps: w.net.exportState().opps });
      rtA.unit.sends.push(update("sd020-update", 0));
    });
    expect(await a.adapter.queue.statusOf("sd020-update")).toBe("retry_scheduled");
    // Replica B closes the opportunity. Replica A's copy still has it open.
    await rtB.unitOfWork(net => {
      const state = net.exportState();
      net.importState({ ...state, opps: state.opps.map(o => o.id === oppId ? { ...o, stage: "closed" } : o) });
    });
    expect(rtA.net.opps.get(oppId)?.stage).not.toBe("closed");
    await a.adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rtA.deliver();
    expect(await a.adapter.queue.statusOf("sd020-update")).toBe("expired");
    expect(calls.map(c => c.idempotencyKey)).not.toContain("tn:sd020-update");
    const message = async (id: string) => (await sql`select status from network.messages where app_id=${app.id} and id=${id}`)[0]?.status;
    expect(await message("sd020-update")).toBe("expired");

    // A message whose change a drain lost (its process stopped after the queue commit) takes its row's status
    // at the next runtime drain.
    await sql`update network.messages set status='retry_scheduled' where app_id=${app.id} and id='sd020-update'`;
    await rtA.deliver();
    expect(await message("sd020-update")).toBe("expired");

    // A direct send drains the other due rows of the line: their changes reach network.messages too.
    await a.adapter.queue.setLineSafety("review");
    await rtA.unitOfWork(net => { rtA.unit.sends.push({ ...update("sd136-update", 1), oppId: undefined }); });
    expect(await message("sd136-update")).toBe("retry_scheduled");
    await a.adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await a.adapter.direct("+12125550489", "Reply HELP for help.", "sys:sd136-help", "compliance");
    expect(await a.adapter.queue.statusOf("sd136-update")).toBe("sent");
    expect(await message("sd136-update")).toBe("sent");

    // A drain's change that a delivery receipt overtook does not move the message back.
    await a.adapter.status({ kind: "status", channel: "sim", providerMessageId: "sim:tn:sd136-update", status: "delivered", at: clock.now() });
    expect(await a.adapter.queue.statusOf("sd136-update")).toBe("delivered");
    await rtA.storeStatuses([{ id: "sd136-update", memberId: second!, status: "sent" }]);
    expect(await message("sd136-update")).toBe("delivered");
  } finally {
    await a.service.close();
    await b.service.close();
    await sql.close();
    await dropDb(url);
  }
}, 180_000);
