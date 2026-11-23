// A probe that waits in the delivery queue describes the roster it was written for (audit OPP18 review).
// Before the fix, the queue rechecked only the member's matching settings, so a probe written before an
// alternate replaced the other person still went out after the replacement.
// spec/probeDispatch.md, "A queued probe goes out only for the roster that it describes"
import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { brandOf, copyFor } from "../src/copy.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.skipIf(!pgAvailable).each([
  ["roster unchanged", "proactive"], ["roster changed", "proactive"], ["roster changed", "transactional"],
] as const)(
  "a queued one-to-one probe goes out only for its roster (%s, %s)", async (scenario, kind) => {
    const url = await migratedDb("probe_roster_queue");
    const sql = new SQL(url);
    const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
    const app = APPS.friends;
    const appRuntime = "friends:nyc";
    const secret = "synthetic-probe-roster-queue-turn-fixture";
    const people = [{ name: "Ari", e164: "+12125550781" }, { name: "Bren", e164: "+12125550782" }, { name: "Cato", e164: "+12125550783" }];
    const calls: SendRequest[] = [];
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550780", clock, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null, adapter, networks: [{ id: appRuntime }],
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, network: { plans: false, growth: false } });
    const turn = async (messageId: string, text: string) => {
      const input: TurnRequest = { app: app.id, channel: "blooio", from: people[0]!.e164, messageId, text, transport: "imessage", receivedAt: clock.now(), to: null };
      const body = JSON.stringify(input);
      const signed = await svcSign(secret, { id: messageId, path: TURN_PATH, method: "POST", body, nowS: Math.floor(clock.now() / 1000) });
      const res = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...signed }, body }));
      expect(res.status).toBe(200);
      return await res.json() as TurnResponse;
    };
    try {
      await service.start();
      const members: Spec[] = [];
      for (const { name, e164 } of people) {
        const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
        if (!joined.ok) throw new Error("Fixture join was refused");
        members.push({ id: joined.membership.memberId, name, age: 30 });
        await adapter.engaged(e164);
      }
      const [first, second, third] = members.map(m => m.id) as [string, string, string];
      await sql`update network.members set prefs=jsonb_set(coalesce(prefs,'{}'::jsonb),'{categoriesOptIn}','["hobby"]'::jsonb)
        where app_id=${app.id} and id=${first}`;
      const now = clock.now();
      const fixture = new Mini(members, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
      fixture.clock.set(now);
      await fixture.onboard(first, second, third);
      fixture.propose([first, second], { category: "hobby", objective: "find a climbing partner", alternates: [third] });
      expect(await fixture.runUntil(() => fixture.net.reviewQueue().length > 0, 2 * DAY)).toBe(true);
      const oppId = fixture.net.reviewQueue()[0]!.oppId;
      const saved = fixture.net.exportState();
      const opp = saved.opps.find(o => o.id === oppId)!;
      const deliveryId = `${first}:probe-roster-queue`;
      opp.stage = "probing";
      opp.review = { queuedAt: now, deadline: now + DAY, decision: "approve", reviewer: "fixture-staff" };
      opp.status = [[first, "probing"], [second, "queued"]];
      opp.first = first;
      opp.contacted = [first];
      opp.sentAt = { [first]: now };
      opp.probeDelivery = { [first]: deliveryId };
      saved.members.find(m => m.id === first)!.awaiting = { kind: "probe", oppId, probeReceiptId: deliveryId, at: now };
      const rt = service.runtimes.get(appRuntime)!;
      await adapter.queue.setLineSafety("review");
      await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: saved.members, opps: saved.opps });
        rt.unit.sends.push({ id: deliveryId, memberId: first, to: people[0]!.e164, body: "Up for climbing with someone nearby this week?",
          kind, type: "probe", oppId, proactive: kind === "proactive", system: false, ts: now });
      });
      expect(await adapter.queue.statusOf(deliveryId)).toBe("retry_scheduled");
      clock.advance(HOUR);
      if (scenario === "roster changed") {
        await rt.unitOfWork(async net => {
          await net.onInbound({ id: "roster-queue-stop", memberId: second, body: "STOP", keyword: "STOP", ts: clock.now(), channel: "sms" });
        });
        const changed = (await rt.pg.load())!.opps.find(o => o.id === oppId)!;
        expect(changed).toMatchObject({ roster: 1, participants: [first, third] });
      }
      await adapter.queue.setLineSafety(undefined);
      clock.advance(HOUR);
      await rt.deliver();
      await rt.deliver();
      const sent = scenario !== "roster changed";
      expect(await adapter.queue.statusOf(deliveryId)).toBe(sent ? "sent" : "suppressed_ineligible");
      expect(calls.filter(call => call.idempotencyKey === `tn:${deliveryId}`)).toHaveLength(sent ? 1 : 0);
      if (!sent) {
        const [reask] = await sql<{ id: string }[]>`select id from network.messages where app_id=${app.id} and opportunity_id=${oppId}
          and member_id=${first} and type='probe' and direction='outbound' and id<>${deliveryId}`;
        expect(reask).toBeDefined();
        expect(await adapter.queue.statusOf(reask!.id)).toBe("sent");
        if (kind === "proactive") {
          clock.advance(2 * DAY);
          await rt.tick();
          const late = await turn("late-yes-after-expiry", "Yes I'm in!");
          expect(late).toMatchObject({ outcome: "handled", replies: [copyFor(brandOf(app)).probeEnded] });
          expect(await turn("second-late-yes", "yes")).toMatchObject({ outcome: "handled", replies: [] });
          const after = (await rt.pg.load())!.opps.find(o => o.id === oppId)!;
          expect(after.status).not.toContainEqual([first, "available"]);
        }
      }
    } finally {
      await service.close();
      await sql.close();
      await dropDb(url);
    }
  },
);
