import {expect, test} from "bun:test";
import {SQL} from "bun";
import {DAY, MINUTE, SimClock} from "@thenetwork/core";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {TURN_PATH} from "../../core/src/svc/contract.ts";
import {dropTestDb, pgAvailable, testDb} from "../../observatory/test/pg.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

test.skipIf(!pgAvailable)("notification outcomes survive counter failures, restart and overlapping sweeps without double counting", async () => {
  const url = await testDb(), sql = new SQL({url, max: 4}), clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const secret = "synthetic-notify-outcome-regression-2026";
  const make = () => new NetworkService({url, clock, photoStorage: null, instance: "notify-outcome-regression",
    env: {PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret, CLEF_RATINGS: "off"},
    networks: [{id: "friends:nyc", matchingEnabled: false}], network: {seed: 1},
    adapter: () => new DryRunAdapter(() => {}), log: () => {}});
  let svc = make(), seq = 0;
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => svc.fetch(req)});
  const say = async (from: string, text: string) => {
    const id = `outcomes-${++seq}`, body = JSON.stringify({messageId: id, channel: "blooio", from, to: null,
      text, transport: "imessage", receivedAt: clock.now(), app: "friends"});
    const res = await fetch(new URL(TURN_PATH, server.url), {method: "POST", body, headers: {"content-type": "application/json",
      ...await svcSign(secret, {method: "POST", path: TURN_PATH, id, body, nowS: Math.floor(clock.now() / 1000)})}});
    expect(res.status).toBe(200); await res.text(); clock.advance(MINUTE);
  };
  const restart = async () => { await svc.close(); svc = make(); await svc.start(); };
  const fault = async (kind: "acted" | "ignored") => {
    await sql.unsafe(`create function notify.reject_outcome() returns trigger language plpgsql as $$ begin
      if new.${kind}>old.${kind} then raise exception 'synthetic outcome counter failure'; end if;
      return new; end $$`);
    await sql.unsafe(`create trigger reject_outcome before update on notify.surface_signals for each row execute function notify.reject_outcome()`);
  };
  const recover = async () => {
    await sql.unsafe(`drop trigger reject_outcome on notify.surface_signals`);
    await sql.unsafe(`drop function notify.reject_outcome()`);
    await restart();
  };
  try {
    await svc.start();
    const people: string[] = [];
    for (let i = 0; i < 3; i++) {
      const phone = `+1212555018${i}`;
      for (const text of ["friends.help", `${["Ari", "Bea", "Cy"][i]}, 29`, "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"])
        await say(phone, text);
      people.push((await svc.accounts.personFor(phone))!.id);
    }
    // Requested producer fixtures enter the real scheduler, Network units and dry-run send path.
    for (let i = 0; i < 3; i++) for (const personId of people) {
      await svc.notify!.add({personId, app: "friends", eventType: "requested", subjectId: String(i), urgency: "requested", summary: "Your requested update is ready."}, clock.now());
      await svc.notifyTick();
    }
    const messages = await sql`select id,body,status from network.messages where type='notify' order by id`;
    expect(messages).toHaveLength(9); expect(messages.every((r: {status: string}) => r.status === "dry_run")).toBe(true);
    await fault("acted"); await say("+12125550180", "HELP");
    expect((await sql`select count(*)::int as n from notify.deliveries where person_id=${people[0]!} and outcome is null`)[0].n).toBe(3);
    await recover(); await say("+12125550180", "HELP");
    expect((await sql`select acted from notify.surface_signals where person_id=${people[0]!} and surface='imessage'`)[0].acted).toBe(3);
    clock.advance(4 * DAY); await fault("ignored");
    await expect(svc.notifyTick()).rejects.toThrow("synthetic outcome counter failure");
    expect((await sql`select count(*)::int as n from notify.deliveries where outcome is null`)[0].n).toBe(6);
    await recover(); await Promise.all([svc.notifyTick(), svc.notifyTick()]);
    const outcomes = await sql`select outcome,count(*)::int as n from notify.deliveries group by outcome order by outcome`;
    expect(outcomes).toEqual([{outcome: "acted", n: 3}, {outcome: "ignored", n: 6}]);
    const signals = await sql`select person_id,surface,active,acted,ignored,ignored_streak from notify.surface_signals order by person_id,surface`;
    expect(signals.reduce((n: number, r: {acted: number}) => n + r.acted, 0)).toBe(3);
    expect(signals.reduce((n: number, r: {ignored: number}) => n + r.ignored, 0)).toBe(6);
    expect(signals.reduce((n: number, r: {ignored_streak: number}) => n + r.ignored_streak, 0)).toBe(6);
    await say("+12125550180", "HELP"); await svc.notifyTick(); await restart(); await svc.notifyTick();
    expect(await sql`select person_id,surface,active,acted,ignored,ignored_streak from notify.surface_signals order by person_id,surface`).toEqual(signals);
    expect(await sql`select id,body,status from network.messages where type='notify' order by id`).toEqual(messages);
  } finally { server.stop(true); await svc.close(); await sql.close(); await dropTestDb(); }
}, 120_000);
