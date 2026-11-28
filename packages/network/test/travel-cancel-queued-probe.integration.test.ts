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

// spec/travelPresence.md, "Use my travel dates for matching"; spec/planDispatch.md, "A missing seat or an absence rules out the invitation"
test.skipIf(!pgAvailable).each(["trip cancelled", "trip present", "home member"] as const)(
  "a queued invitation for a saved trip does not arrive after the trip is cancelled (%s)", async scenario => {
    const url = await migratedDb("travel_cancel_queued_probe");
    const sql = new SQL(url);
    const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
    const app = APPS.friends;
    const appRuntime = "friends:nyc";
    const people = [{ name: "Ari", e164: "+12125550981" }, { name: "Bren", e164: "+12125550982" }];
    const calls: SendRequest[] = [];
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550980", clock, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, adapter, networks: [{ id: appRuntime }],
      env: { PLATFORM_ENV: "dev" }, network: { plans: false, growth: false } });
    try {
      await service.start();
      const rt = service.runtimes.get(appRuntime)!;
      const staff = { id: "fixture-staff", roles: ["safety" as const], grants: [{ role: "safety" as const, app: app.id }], via: "sso" as const };
      const members: Spec[] = [];
      for (const [index, { name, e164 }] of people.entries()) {
        const homeCity = index === 1 && scenario !== "home member" ? "chicago" as const : "nyc" as const;
        const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, homeCity, consent: { sms: true, wording: app.consent.text } });
        if (!joined.ok) throw new Error("Fixture join was refused");
        for (const check of ["age", "liveness"] as const) {
          expect(await service.verify(staff, rt, joined.membership.memberId, check, "pass", "fixture verification")).toEqual({ ok: true });
        }
        members.push({ id: joined.membership.memberId, name, age: 30 });
        await adapter.engaged(e164);
      }
      const [first, second] = members.map(m => m.id) as [string, string];
      const now = clock.now();
      if (scenario !== "home member") {
        await sql`insert into network.presence (app_id, member_id, city, type, from_at, to_at)
          values (${app.id}, ${second}, 'nyc', 'temporary', ${new Date(now - DAY)}, ${new Date(now + 8 * DAY)})`;
      }
      const fixture = new Mini(members, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
      fixture.clock.set(now);
      fixture.verify(first, second);
      await fixture.onboard(first, second);
      const slots = [4, 5, 6].map(days => ({ start: now + days * DAY, end: now + days * DAY + 2 * HOUR }));
      const plan: plans.Plan = {
        id: "travel-cancel-partner-choices", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
        window: slots[0]!, reviewedOptions: slots, invited: [first, second], alternates: [], partner: true,
        size: { min: 2, target: 2, max: 2 }, quorum: 2, probeDeadline: now + 2 * DAY,
        score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
      };
      const { id: oppId } = fixture.net["submitPlan"](plan, now)!;
      const saved = fixture.net.exportState();
      const opp = saved.opps.find(o => o.id === oppId)!;
      const deliveryId = friendsPlanProbeDeliveryKey(oppId, 0, second);
      const probeId = "travel-cancel-regular-probe";
      const offered = friendsPlanTimeOptions(slots, [slots[0]!, slots[2]!], NY);
      opp.stage = "probing";
      opp.review = { queuedAt: now, deadline: now + DAY, decision: "approve", reviewer: "fixture-staff" };
      opp.planRun = { plan, answers: { [first]: "yes", [second]: "pending" }, bench: [], stage: "probing" };
      opp.offered = { [first]: friendsPlanTimeOptions(slots, slots, NY), [second]: offered };
      opp.picks = { [first]: offered.map(option => option.start) };
      opp.status = [[first, "available"], [second, "probing"]];
      opp.contacted = [first, second];
      saved.members.find(m => m.id === second)!.awaiting = { kind: "probe", oppId, probeReceiptId: deliveryId, at: now };
      const body = `Would you like to go climbing? ${offered.map(option => `${option.key.toUpperCase()}: ${option.label}`).join(". ")}`;
      await adapter.queue.setLineSafety("review");
      await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: saved.members, opps: saved.opps });
        rt.unit.sends.push(
          { id: deliveryId, memberId: second, to: people[1]!.e164, body, kind: "proactive",
            type: "plan_probe", oppId, proactive: true, system: false, ts: now },
          { id: probeId, memberId: second, to: people[1]!.e164, body: "Would you like to join an activity?", kind: "proactive",
            type: "probe", oppId, proactive: true, system: false, ts: now },
        );
      });
      expect(await adapter.queue.statusOf(deliveryId)).toBe("retry_scheduled");
      expect(await adapter.queue.statusOf(probeId)).toBe("retry_scheduled");
      clock.advance(HOUR);
      if (scenario === "trip cancelled") {
        await sql`delete from network.presence where app_id=${app.id} and member_id=${second} and type='temporary' and city='nyc'`;
      }
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      await rt.deliver();
      const sent = scenario !== "trip cancelled";
      expect(await adapter.queue.statusOf(deliveryId)).toBe(sent ? "sent" : "suppressed_ineligible");
      expect(await adapter.queue.statusOf(probeId)).toBe(sent ? "sent" : "suppressed_ineligible");
      expect(calls.filter(call => call.idempotencyKey === `tn:${deliveryId}`)).toHaveLength(sent ? 1 : 0);
      expect(calls.filter(call => call.idempotencyKey === `tn:${probeId}`)).toHaveLength(sent ? 1 : 0);
    } finally {
      await service.close();
      await sql.close();
      await dropDb(url);
    }
  },
);
