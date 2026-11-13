import {expect, test} from "bun:test";
import {SQL} from "bun";
import {DAY, MINUTE, SimClock} from "@thenetwork/core";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH, type TurnRequest} from "../../core/src/svc/contract.ts";
import {dropTestDb, pgAvailable, testDb} from "../../observatory/test/pg.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

test.skipIf(!pgAvailable)("open member turns count notification actions once, on their actual channel, while replays and profiles do not", async () => {
  const url = await testDb(), sql = new SQL({url, max: 3}), clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const secret = "synthetic-open-notify-regression-2026";
  const make = () => new NetworkService({url, clock, photoStorage: null, instance: "open-notify-regression",
    env: {PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret, CLEF_RATINGS: "off"},
    networks: [{id: "friends:nyc", matchingEnabled: false}], network: {seed: 1},
    adapter: () => new DryRunAdapter(() => {}), log: () => {}});
  let svc = make(), seq = 0;
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => svc.fetch(req)});
  const post = async (input: TurnRequest) => {
    const body = JSON.stringify(input), res = await fetch(new URL(TURN_PATH, server.url), {method: "POST", body,
      headers: {"content-type": "application/json", ...await svcSign(secret, {method: "POST", path: TURN_PATH,
        id: input.messageId, body, nowS: Math.floor(clock.now() / 1000)})}});
    expect(res.status).toBe(200); return res.json();
  };
  try {
    await svc.start();
    for (const [index, transport] of (["imessage", "sms"] as const).entries()) {
      const phone = `+1212555018${index}`;
      const input = (text: string): TurnRequest => ({messageId: `open-notify-${++seq}`, channel: transport === "sms" ? "twilio" : "blooio",
        from: phone, to: null, text, transport, receivedAt: clock.now(), app: "friends"});
      const say = async (text: string) => { const response = await post(input(text)); clock.advance(MINUTE); return response; };
      for (const text of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"])
        await say(text);
      const personId = (await svc.accounts.personFor(phone))!.id;
      const pending = async () => (await sql`select count(*)::int as n from notify.deliveries where person_id=${personId} and outcome is null`)[0].n;
      const add = async (subjectId: string) => {
        await svc.notify!.add({personId, app: "friends", eventType: "requested", subjectId, urgency: "requested", summary: "Your requested update is ready."}, clock.now());
        await svc.notifyTick();
      };
      await add("first"); await add("second"); expect(await pending()).toBe(2);
      const request = input("Tell me something about the weather"), response = await post(request);
      expect(response.outcome).toBe("open"); expect(await pending()).toBe(0);
      expect((await sql`select acted from notify.surface_signals where person_id=${personId} and surface=${transport}`)[0].acted).toBe(2);
      await add("after-open"); expect(await pending()).toBe(1);
      expect(await post(request)).toEqual(response); expect(await pending()).toBe(1);
      expect((await say("show my friends profile")).outcome).toBe("handled"); expect(await pending()).toBe(1);
      expect(await svc.submitProfile(personId, "friends", phone, "I enjoy hiking and cooking")).toBe("accepted");
      expect(await pending()).toBe(1);
      await svc.close(); svc = make(); await svc.start(); expect(await pending()).toBe(1);
      expect((await say("Tell me something about the weather")).outcome).toBe("open"); expect(await pending()).toBe(0);
      await add("help-control"); expect((await say("HELP")).outcome).toBe("handled"); expect(await pending()).toBe(0);
      const notifications = await sql`select m.id,m.body,m.status from network.messages m join network.members p on p.id=m.member_id where p.person_id=${personId} and m.type='notify' order by m.id`;
      expect(notifications).toHaveLength(4);
      expect(notifications.every((r: {status: string}) => r.status === "dry_run")).toBe(true);
      clock.advance(4 * DAY); await svc.notifyTick();
      const outcomes = await sql`select outcome,count(*)::int as n from notify.deliveries where person_id=${personId} group by outcome`;
      expect(outcomes).toEqual([{outcome: "acted", n: 4}]);
      expect((await sql`select acted,ignored from notify.surface_signals where person_id=${personId} and surface=${transport}`)[0]).toEqual({acted: 4, ignored: 0});
      expect(await sql`select m.id,m.body,m.status from network.messages m join network.members p on p.id=m.member_id where p.person_id=${personId} and m.type='notify' order by m.id`).toEqual(notifications);
    }
  } finally { server.stop(true); await svc.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
