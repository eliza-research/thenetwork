import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini } from "./mini.ts";

test.skipIf(!pgAvailable)("a staff-approved group plan sends anonymous probes through the matching settings gate", async () => {
  // spec/planDispatch.md, "A usable message must be sent before the daily record changes"
  // spec/outboundAdmission.md, "A queued match invitation still needs the member's current settings"
  const url = await migratedDb("plan_probe_delivery");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const recipients = [
    { name: "Ari", e164: "+12125550391" },
    { name: "Blair", e164: "+12125550392" },
    { name: "Charlie", e164: "+12125550393" },
  ];
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550390", clock, liveGate: () => true, log: () => {}, provider: {
    kind: "sim", send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" }, networks: [{ id: networkId }],
    devMatching: [networkId], network: { plans: false, growth: false, maxNewPerDay: 0 }, tokens: "reviewer@friends:plan-reviewer",
  });
  try {
    await service.start();
    const members = [];
    for (const { name, e164 } of recipients) {
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30 });
      await adapter.engaged(e164);
    }
    const invited = members.map(member => member.id);
    const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
    const now = clock.now();
    fixture.clock.set(now);
    await fixture.onboard(...invited);
    const rt = service.runtimes.get(networkId)!;
    const plan: plans.Plan = {
      id: "reviewed_group_probe", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
      place: { name: "Inwood Hill Park", area: "Inwood" }, window: { start: now + 5 * DAY, end: now + 5 * DAY + 2 * HOUR },
      invited, alternates: [], partner: false, size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 3 * DAY,
      score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members });
      (net as unknown as { submitPlan(plan: plans.Plan, at: number): void }).submitPlan(plan, now);
    });
    const probes = () => sql<{ id: string; member_id: string; opportunity_id: string | null }[]>`select id,member_id,opportunity_id
      from network.messages where app_id=${app.id} and direction='outbound' and type='plan_probe'`;
    expect(await probes()).toEqual([]);
    await adapter.queue.setLineSafety("review");

    const reviewUrl = "http://127.0.0.1/apps/friends/review";
    const headers = { authorization: "Bearer plan-reviewer", "content-type": "application/json" };
    const queue = await service.fetch(new Request(reviewUrl, { headers }));
    expect(queue.status).toBe(200);
    const { items } = await queue.json() as { items: { oppId: string; revision: number }[] };
    expect(items).toHaveLength(1);
    const { oppId, revision } = items[0]!;
    const approval = await service.fetch(new Request(`${reviewUrl}/${encodeURIComponent(oppId)}`, {
      method: "POST", headers, body: JSON.stringify({ decision: "approve", revision }),
    }));
    expect(approval.status).toBe(200);
    expect(await approval.json()).toEqual({ ok: true });
    const staged = await probes();
    expect(staged).toHaveLength(3);
    for (const probe of staged) {
      expect(probe.opportunity_id).toBe(oppId);
      expect(await adapter.queue.statusOf(probe.id)).toBe("retry_scheduled");
    }

    const changed = invited[1]!;
    await sql`update network.members set prefs=prefs || ${{ categoriesOptIn: ["hobby"] }}::jsonb where app_id=${app.id} and id=${changed}`;
    await adapter.queue.setLineSafety(undefined);
    clock.advance(HOUR);
    await rt.deliver();
    await rt.deliver();
    for (const probe of staged) {
      const suppressed = probe.member_id === changed;
      expect(await adapter.queue.statusOf(probe.id)).toBe(suppressed ? "suppressed_ineligible" : "sent");
      const delivered = calls.filter(call => call.idempotencyKey === `tn:${probe.id}`);
      expect(delivered).toHaveLength(suppressed ? 0 : 1);
      if (!suppressed) {
        expect(delivered[0]?.to).toBe(recipients[invited.indexOf(probe.member_id)]!.e164);
        expect(delivered[0]?.text).toContain("Inwood Hill Park");
        expect(delivered[0]?.text).not.toMatch(/\b(?:Ari|Blair|Charlie)\b/i);
      }
    }
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
