import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.skipIf(!pgAvailable)("two replicas: a queued text follows the stored Network state, and network.messages follows the queue", async () => {
  const url = await migratedDb("outbound_state_fence");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const app = APPS.friends;
  const phones = ["+12125550481", "+12125550482"];
  const calls: SendRequest[] = [];
  const replica = () => {
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550480", clock, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const service = new NetworkService({
      url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
      env: { PLATFORM_ENV: "dev" }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
    });
    return { adapter, service };
  };
  const a = replica(), b = replica();
  try {
    await a.service.start();
    await b.service.start();
    const rtA = a.service.runtimes.get("friends:nyc")!, rtB = b.service.runtimes.get("friends:nyc")!;
    const staff = { id: "fixture-staff", roles: ["safety" as const], grants: [{ role: "safety" as const, app: app.id }], via: "sso" as const };
    const members: Spec[] = [];
    for (const [index, e164] of phones.entries()) {
      const name = index === 0 ? "Ari" : "Blair";
      const joined = await a.service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      for (const check of ["age", "liveness"] as const) {
        expect(await a.service.verify(staff, rtA, joined.membership.memberId, check, "pass", "fixture verification")).toEqual({ ok: true });
      }
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const [first, second] = members.map(m => m.id);
    const w = new Mini(members, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
    w.verify(first!, second!);
    await w.onboard(first!, second!);
    const oppId = w.propose([first!, second!], { category: "hobby" });
    expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === oppId), 2 * DAY)).toBe(true);
    const update = (id: string, i: number) => ({ id, memberId: members[i]!.id, to: phones[i], kind: "transactional" as const,
      body: "Your activity update is ready.", type: "reminder", oppId, proactive: false, system: false, ts: clock.now() });

    await a.adapter.queue.setLineSafety("review");
    await rtA.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: w.net.exportState().members, opps: w.net.exportState().opps });
      rtA.unit.sends.push(update("sd020-update", 0));
    });
    expect(await a.adapter.queue.statusOf("sd020-update")).toBe("retry_scheduled");
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

    await sql`update network.messages set status='retry_scheduled' where app_id=${app.id} and id='sd020-update'`;
    await rtA.deliver();
    expect(await message("sd020-update")).toBe("expired");

    await a.adapter.queue.setLineSafety("review");
    await rtA.unitOfWork(net => { rtA.unit.sends.push({ ...update("sd136-update", 1), oppId: undefined }); });
    expect(await message("sd136-update")).toBe("retry_scheduled");
    await a.adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await a.adapter.direct("+12125550489", "Reply HELP for help.", "sys:sd136-help", "compliance");
    expect(await a.adapter.queue.statusOf("sd136-update")).toBe("sent");
    expect(await message("sd136-update")).toBe("sent");

    await a.adapter.status({ kind: "status", channel: "sim", providerMessageId: "sim:tn:sd136-update", status: "delivered", at: clock.now() });
    expect(await a.adapter.queue.statusOf("sd136-update")).toBe("delivered");
    await rtA.storeStatuses([{ id: "sd136-update", memberId: second!, status: "sent" }]);
    expect(await message("sd136-update")).toBe("delivered");

    await sql`update network.messages set status='collected' where app_id=${app.id} and id='sd020-update'`;
    await rtA.deliver();
    expect(await message("sd020-update")).toBe("expired");

    const version = async () => String((await sql`select xmin::text as v from network.network_state where id='friends:nyc'`)[0]?.v);
    const storedOptOut = async () => (await sql`select opted_out from network.members where app_id=${app.id} and id=${first!}`)[0]?.opted_out;
    const text = (id: string, body: string) => ({ kind: "message" as const, channel: "sim" as const, messageId: id, from: phones[0]!,
      to: "+12125550480", chatId: phones[0]!, isGroup: false, text: body, mediaUrls: [], transport: "sim" as const, receivedAt: clock.now() });
    await a.adapter.queue.setLineSafety("review");
    await rtA.unitOfWork(() => { rtA.unit.sends.push({ ...update("sd020-copy", 0), oppId: undefined }); });
    expect(await message("sd020-copy")).toBe("retry_scheduled");
    await a.service.inbound(text("sd020-stop", "STOP"), { app: app.id });
    expect(await storedOptOut()).toBe(true);
    expect(rtA.net.exportState().members.find(m => m.id === first)?.optedOut).toBe(true);
    const saved = await version();
    clock.advance(60_000);
    await b.service.inbound(text("sd020-start", "START"), { app: app.id });
    expect(await storedOptOut()).toBe(false);
    expect(await version()).not.toBe(saved);
    expect(rtA.net.exportState().members.find(m => m.id === first)?.optedOut).toBe(true);
    await a.adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rtA.deliver();
    expect(await a.adapter.queue.statusOf("sd020-copy")).toBe("sent");
    expect(await message("sd020-copy")).toBe("sent");
  } finally {
    await a.service.close();
    await b.service.close();
    await sql.close();
    await dropDb(url);
  }
}, 180_000);
