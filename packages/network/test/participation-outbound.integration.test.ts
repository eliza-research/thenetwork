import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini } from "./mini.ts";

test.skipIf(!pgAvailable)("a queued probe rechecks matching settings and an acceptance release can reach its member", async () => {
  // spec/outboundAdmission.md, "A queued match invitation still needs the member's current settings"
  // spec/outboundAdmission.md, "A current row needs live approval and the recipient's eligibility"
  const url = await migratedDb("participation_outbound");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const app = APPS.friends;
  const phones = ["+12125550381", "+12125550382"];
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550380", clock, liveGate: () => true, log: () => {}, provider: {
    kind: "sim", send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
  });
  try {
    await service.start();
    const members = [];
    for (const [index, e164] of phones.entries()) {
      const name = index === 0 ? "Ari" : "Blair";
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const [first, second] = members.map(m => m.id);
    const w = new Mini(members, { app: app.id, review: "human", plans: false, growth: false });
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
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
