import { expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import type { SendRequest } from "../../blooio/src/types.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { formatSilentPartnerVenueSwap } from "../src/copy.ts";
import { Mini, type Spec } from "./mini.ts";

// spec/outboundAdmission.md, "Recheck a queued message at send time": a queued venue-swap
// notice goes out only while the recipient still holds a seat and the named venue is current.
test.skipIf(!pgAvailable).each(["current", "peer dropped", "venue swapped again", "prefixed current", "prefixed peer dropped", "prefixed venue swapped again"] as const)(
  "a queued venue-swap notice rechecks the seat and the venue (%s)", async scenario => {
    const url = await migratedDb("venue_swap_notice_claim");
    const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
    const app = APPS.friends;
    const appRuntime = "friends:nyc";
    const people = [
      { name: "Ari", e164: "+12125550891" },
      { name: "Bren", e164: "+12125550892" },
      { name: "Cory", e164: "+12125550893" },
    ];
    const calls: SendRequest[] = [];
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550890", clock, log: () => {}, provider: {
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
      for (const { name, e164 } of people) {
        const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
        if (!joined.ok) throw new Error("Fixture join was refused");
        for (const check of ["age", "liveness"] as const) {
          expect(await service.verify(staff, rt, joined.membership.memberId, check, "pass", "fixture verification")).toEqual({ ok: true });
        }
        members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["climbing"], wants: [{ objective: "find climbing partners", category: "hobby" as const }] });
        await adapter.engaged(e164);
      }
      const ids = members.map(m => m.id) as [string, string, string];
      const peer = ids[2];
      const now = clock.now();
      const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
      fixture.clock.set(now);
      fixture.verify(...ids);
      await fixture.onboard(...ids);
      const oppId = fixture.propose([ids[0], ids[1]]);
      await fixture.answerProbes([ids[0], ids[1]]);
      const saved = fixture.net.exportState();
      const opp = saved.opps.find(o => o.id === oppId)!;
      expect(opp.stage).toBe("scheduled");
      // Seed the third member as a booked seat, so the group booking stands when the peer drops.
      opp.kind = "group";
      opp.participants = [...ids];
      opp.status = ids.map((id): [string, "yes"] => [id, "yes"]);
      opp.bookedTold = [...ids];
      opp.contacted = [...ids];
      // The booking already swapped to Venue B; the peer notice naming it waits in the queue.
      opp.venue = "Venue B";
      opp.venueArea = "Area B";
      opp.venueId = "venue-b";
      const noticeId = "venue-swap-notice-fixture";
      const prefix = scenario === "prefixed peer dropped" ? "That plan didn't come together this time. " : scenario.startsWith("prefixed") ? "Got it, thanks. " : "";
      const body = prefix + formatSilentPartnerVenueSwap("Saturday at 11am", "Venue B", { area: "Area B" });
      await adapter.queue.setLineSafety("review");
      await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: saved.members, opps: saved.opps });
        rt.unit.sends.push({ id: noticeId, memberId: peer, to: people[2]!.e164, body, kind: "transactional",
          type: "scheduling", oppId, proactive: false, system: false, ts: now });
      });
      expect(await adapter.queue.statusOf(noticeId)).toBe("retry_scheduled");
      clock.advance(HOUR);
      await rt.unitOfWork(net => {
        const current = net.exportState();
        const booked = current.opps.find(o => o.id === oppId)!;
        if (scenario.endsWith("peer dropped")) {
          booked.status = booked.status.map(([id, status]): [string, typeof status] => [id, id === peer ? "dropped" : status]);
        }
        if (scenario.endsWith("venue swapped again")) {
          booked.venue = "Venue C";
          booked.venueArea = "Area C";
          booked.venueId = "venue-c";
        }
        net.importState(current);
      });
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      await rt.deliver();
      const sent = scenario.endsWith("current");
      expect(await adapter.queue.statusOf(noticeId)).toBe(sent ? "sent" : "suppressed_ineligible");
      expect(calls.filter(call => call.idempotencyKey === `tn:${noticeId}`)).toHaveLength(sent ? 1 : 0);
    } finally {
      await service.close();
      await dropDb(url);
    }
  },
);
