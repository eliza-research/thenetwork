import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { plans } from "@thenetwork/engine";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { friendsPlanProbeDeliveryKey, friendsPlanTimeOptions } from "../src/friends-plan-time-choice.ts";
import { NY } from "../src/outreach.ts";
import { Mini, type Spec } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.skipIf(!pgAvailable).each([
  "current", "peer availability changed", "receipt replaced", "message changed", "message missing", "review revised", "unpicked slot", "deadline reached",
] as const)(
  "a queued Friends partner probe rechecks the exact reviewed options (%s)", async scenario => {
    const url = await migratedDb("friends_plan_probe_claim");
    const sql = new SQL(url);
    const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
    const app = APPS.friends;
    const appRuntime = "friends:nyc";
    const people = [{ name: "Ari", e164: "+12125550881" }, { name: "Bren", e164: "+12125550882" }];
    const calls: SendRequest[] = [];
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550880", clock, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, adapter, networks: [{ id: appRuntime }],
      env: { PLATFORM_ENV: "dev" }, network: { plans: false, growth: false } });
    try {
      await service.start();
      const members: Spec[] = [];
      for (const { name, e164 } of people) {
        const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
        if (!joined.ok) throw new Error("Fixture join was refused");
        members.push({ id: joined.membership.memberId, name, age: 30 });
        await adapter.engaged(e164);
      }
      const [first, second] = members.map(m => m.id) as [string, string];
      const now = clock.now();
      const fixture = new Mini(members, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
      fixture.clock.set(now);
      await fixture.onboard(first, second);
      const slots = [4, 5, 6].map(days => ({ start: now + days * DAY, end: now + days * DAY + 2 * HOUR }));
      const plan: plans.Plan = {
        id: "reviewed-partner-choices", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
        window: slots[0]!, reviewedOptions: slots, invited: [first, second], alternates: [], partner: true,
        size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: now + 2 * (scenario === "deadline reached" ? HOUR : DAY),
        score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
      };
      const { id: oppId } = fixture.net["submitPlan"](plan, now)!;
      const saved = fixture.net.exportState();
      const opp = saved.opps.find(o => o.id === oppId)!;
      const deliveryId = friendsPlanProbeDeliveryKey(oppId, 0, second);
      const offered = friendsPlanTimeOptions(slots, [slots[0]!, slots[2]!], NY);
      expect(offered.map(option => option.key)).toEqual(["a", "c"]);
      // Seed the result of the first partner's exact consent. The ordinary PostgreSQL queue claims the second offer.
      opp.stage = "probing";
      opp.review = { queuedAt: now, deadline: now + DAY, decision: "approve", reviewer: "fixture-staff" };
      opp.planRun = { plan, answers: { [first]: "yes", [second]: "pending" }, bench: [], stage: "probing" };
      opp.offered = { [first]: friendsPlanTimeOptions(slots, slots, NY), [second]: offered };
      opp.picks = { [first]: offered.map(option => option.start) };
      opp.status = [[first, "available"], [second, "probing"]];
      opp.contacted = [first, second];
      saved.members.find(m => m.id === second)!.awaiting = { kind: "probe", oppId, probeReceiptId: deliveryId, at: now };
      const body = `Would you like to go climbing? ${offered.map(option => `${option.key.toUpperCase()}: ${option.label}`).join(". ")}`;
      const rt = service.runtimes.get(appRuntime)!;
      await adapter.queue.setLineSafety("review");
      await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: saved.members, opps: saved.opps });
        rt.unit.sends.push({ id: deliveryId, memberId: second, to: people[1]!.e164, body, kind: "proactive",
          type: "plan_probe", oppId, proactive: true, system: false, ts: now });
      });
      expect(await adapter.queue.statusOf(deliveryId)).toBe("retry_scheduled");
      clock.advance(HOUR);
      await rt.unitOfWork(net => {
        const current = net.exportState();
        if (scenario === "peer availability changed") {
          current.members.find(m => m.id === first)!.stated = { at: clock.now(), until: now + 7 * DAY, windows: [slots[0]!] };
        }
        if (scenario === "receipt replaced") current.members.find(m => m.id === second)!.awaiting!.probeReceiptId = "some-other-current-probe";
        if (scenario === "review revised") current.opps.find(o => o.id === oppId)!.review!.rerolls = [{ at: clock.now(), reviewer: "fixture-staff" }];
        if (scenario === "unpicked slot") current.opps.find(o => o.id === oppId)!.picks![first] = [slots[0]!.start];
        net.importState(current);
      });
      if (scenario === "message changed") await sql`update network.messages set body='A different question' where app_id=${app.id} and id=${deliveryId}`;
      if (scenario === "message missing") await sql`delete from network.messages where app_id=${app.id} and id=${deliveryId}`;
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      await rt.deliver();
      const sent = scenario === "current";
      expect(await adapter.queue.statusOf(deliveryId)).toBe(sent ? "sent" : "suppressed_ineligible");
      expect(calls.filter(call => call.idempotencyKey === `tn:${deliveryId}`)).toHaveLength(sent ? 1 : 0);
    } finally {
      await service.close();
      await sql.close();
      await dropDb(url);
    }
  },
);
