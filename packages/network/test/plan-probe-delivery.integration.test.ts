import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { type TurnRequest, TURN_PATH } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { RealSource } from "../../observatory/src/sources/real.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter, DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { interruptionFeedbackKey, interruptionSampleBucket } from "../src/interruption-feedback.ts";
import { Mini } from "./mini.ts";

test.skipIf(!pgAvailable)("approved probes use current settings and a sampled decline contributes private feedback", async () => {
  // spec/planDispatch.md, "A usable message must be sent before the daily record changes"
  // spec/outboundAdmission.md, "A queued match invitation still needs the member's current settings"
  const url = await migratedDb("plan_probe_delivery");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const secret = "synthetic-plan-probe-and-survey-test-fixture";
  const recipients = [
    { name: "Ari", e164: "+12125550391" },
    { name: "Blair", e164: "+12125550392" },
    { name: "Charlie", e164: "+12125550393" },
  ];
  const calls: SendRequest[] = [];
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550390", clock, log: () => {}, provider: {
    kind: "sim", send: async request => {
      calls.push(request);
      return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
    },
  } });
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: (_network, runtime) => runtime.app.id === app.id ? adapter : new DryRunAdapter(() => {}),
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, networks: [{ id: networkId }, { id: "peon:nyc" }],
    devMatching: [networkId], network: { plans: false, growth: false, maxNewPerDay: 0 }, tokens: "reviewer@friends:plan-reviewer",
  });
  const observatory = new RealSource({ app: app.id, url });
  const turn = async (messageId: string, text: string, receivedAt = clock.now(), shared = false) => {
    const input: TurnRequest = { ...(shared ? {} : { app: app.id }), channel: "blooio", from: recipients[0]!.e164, messageId, text,
      transport: "imessage", receivedAt, to: null };
    const body = JSON.stringify(input);
    const signed = await svcSign(secret, { id: messageId, path: TURN_PATH, method: "POST", body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...signed }, body }));
  };
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
    const sampledIndex = Array.from({ length: 400 }, (_, index) => index + 1)
      .find(index => interruptionSampleBucket(app.id, invited[0]!, `${app.id}.nw-1-${index}`) === 0)!;
    expect(sampledIndex).toBeDefined();
    await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members, oppSeq: sampledIndex - 1 });
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
    expect(oppId).toBe(`${app.id}.nw-1-${sampledIndex}`);
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
    const initialAnswer = async () => (await rt.pg.load())?.opps.find(opp => opp.id === oppId)?.planRun?.answers[invited[0]!];
    const beforeDelivery = clock.now();
    const sentProbeKeys = staged.map(probe => `tn:${probe.id}`);
    expect(calls.filter(call => sentProbeKeys.includes(call.idempotencyKey))).toEqual([]);
    expect((await turn("decline-before-plan-delivery", "No", beforeDelivery)).status).toBe(200);
    expect(await initialAnswer()).toBe("pending");

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

    expect((await turn("delayed-plan-reply", "Yes", beforeDelivery)).status).toBe(200);
    expect(await initialAnswer()).toBe("pending");
    expect((await turn("future-plan-reply", "Yes", clock.now() + 1)).status).toBe(200);
    expect(await initialAnswer()).toBe("pending");
    // spec/interruptionFeedback.md, "Sample a confirmed invitation after its own answer"
    // spec/interruptionFeedback.md, "A direct answer measures the interruption once"
    expect((await turn("decline-before-survey", "No")).status).toBe(200);
    const key = interruptionFeedbackKey(app.id, invited[0]!, oppId);
    expect(await adapter.queue.statusOf(key)).toBeUndefined();
    const answeredAt = clock.now();
    clock.set(answeredAt + DAY - 1);
    await rt.unitOfWork(net => net.tick(clock.now()));
    expect(await adapter.queue.statusOf(key)).toBeUndefined();
    for (let hour = 0; hour < 24 && await adapter.queue.statusOf(key) !== "sent"; hour++) {
      clock.set(answeredAt + DAY + hour * HOUR);
      await rt.unitOfWork(net => net.tick(clock.now()));
    }
    const samples = calls.filter(call => call.idempotencyKey === `tn:${key}`);
    expect(samples).toHaveLength(1);
    const reply = /WORTH NO FRIENDS [a-p]{16}/.exec(samples[0]!.text)![0];
    expect((await rt.pg.load())?.members.find(member => member.id === invited[0])?.pendingAsks).toEqual([]);
    expect((await turn("early-survey-answer", reply, clock.now() - 1)).status).toBe(200);
    expect(await sql`select 1 from network.events where app_id='friends' and type='interruption_feedback'`).toEqual([]);
    const otherApp = APPS.peon;
    const phone = recipients[0]!.e164;
    const other = await service.accounts.join(otherApp, { e164: phone, personId: (await service.accounts.personFor(phone))!.id },
      { firstName: recipients[0]!.name, age: 30, consent: { sms: true, wording: otherApp.consent.text } });
    if (!other.ok) throw new Error(`Fixture join refused: ${other.error}`);
    clock.set(clock.now() + 1);
    const otherRuntime = service.runtimes.get("peon:nyc")!;
    await otherRuntime.unitOfWork(() => otherRuntime.system(other.membership.memberId, "fixture-other-app", "Welcome to peon.biz."));
    const lastContact = (await service.memberApps(phone)).sort((a, b) => (b.lastOut ?? 0) - (a.lastOut ?? 0))[0];
    expect(lastContact?.app).toBe(otherApp.id);
    const sharedAnswer = await turn("survey-answer", reply, clock.now(), true);
    expect(sharedAnswer.status).toBe(200);
    expect(await sharedAnswer.json()).toMatchObject({ app: app.id });
    expect((await turn("duplicate-survey-answer", reply)).status).toBe(200);
    expect(await sql`select payload,actor_id,object_id from network.events where app_id='friends' and type='interruption_feedback'`)
      .toEqual([{ payload: { worthwhile: false }, actor_id: null, object_id: null }]);
    expect((await sql`select distinct body from network.messages where direction='inbound' and type='interruption_feedback'`))
      .toEqual([{ body: "Private invitation feedback." }]);
    await observatory.init();
    expect(observatory.state().stats.scorecard?.find(metric => metric.key === "worthwhile_interruption"))
      .toMatchObject({ label: "Worthwhile interruptions", value: 0, n: 1 });
  } finally {
    await observatory.dispose();
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
