import { afterAll, beforeAll, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { dropTestDb, pgAvailable, testDb } from "../../../apps/observatory/test/pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { heldJudge, within } from "./tick-held-judge.ts";

const TURN_LIMIT_MS = 8_000;
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const secret = "synthetic-tick-lock-fixture-signing-secret";
const app = APPS.ntwrk;
const networkId = "ntwrk:nyc";
let url: string;
let sql: SQL;
let service: NetworkService | undefined;


beforeAll(async () => {
  if (!pgAvailable) return;
  url = await testDb();
  sql = new SQL({ url, max: 2 });
}, 120_000);

afterAll(async () => {
  await service?.close();
  await sql?.close();
  await dropTestDb();
});

async function signedTurn(from: string, messageId: string, text: string) {
  const input: TurnRequest = { messageId, app: app.id, from, to: null, text, receivedAt: clock.now(), channel: "blooio", transport: "imessage" };
  const body = JSON.stringify(input);
  return service!.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
}

test.skipIf(!pgAvailable)("a signed turn, a STOP and a ban during a held engine run do not wait for it, the run never reaches the stopped or banned member, and events that start meanwhile do not make it compute again", async () => {
  const judge = heldJudge(() => clock.advance(MINUTE));
  service = new NetworkService({
    url, clock, env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, log: () => {},
    networks: [{ id: networkId }], devMatching: [networkId],
    network: { seed: 3, plans: false, growth: false, selective: false, maxNewPerDay: 20 }, engineJudge: judge.llm,
    adapter: () => new DryRunAdapter(() => {}),
  });
  await service.start();
  const runtime = service.runtimeFor(app.id)!;
  const people = [["+12125550131", "Ana", "climbing"], ["+12125550132", "Cy", "climbing"], ["+12125550133", "Eve", "pottery"], ["+12125550134", "Fay", "pottery"],
    ["+12125550135", "Ben", "chess"], ["+12125550136", "Dee", "chess"]] as const;
  const members: { e164: string; id: string }[] = [];
  for (const [e164, firstName, hobby] of people) {
    const invitation = await service.accounts.invite(app, e164);
    if (!invitation) throw new Error("Missing fixture staff invitation");
    const joined = await service.accounts.join(app, { e164, personId: invitation.personId }, {
      firstName, age: 31, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    if (!joined.ok) throw new Error(`Fixture signup failed: ${joined.error}`);
    const id = joined.membership.memberId;
    members.push({ e164, id });
    await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, status, valid_from)
      values (${app.id}, ${`fixture-hobby:${id}`}, ${id}, 'interest', ${hobby}, ${sql.array([hobby], "TEXT")}, 'matchable', 'said', 'confirmed', ${new Date(clock.now())})`;
    await sql`insert into network.intents (app_id, id, member_id, objective, category, horizon_days, status, created_at)
      values (${app.id}, ${`fixture-want:${id}`}, ${id}, ${`find a regular ${hobby} partner`}, 'hobby', 60, 'active', ${new Date(clock.now())})`;
    await sql`insert into network.presence (app_id, member_id, city, type, areas) values (${app.id}, ${id}, 'nyc', 'home', ${sql.array(["greenpoint"], "TEXT")})`;
  }
  const [ana, , eve, , ben] = members;
  const t0 = clock.now();
  await sql`insert into network.public_event_imports (source, checked_at) values ('nyc-parks', ${new Date(t0)})`;
  for (let k = 1; k <= 120; k++) {
    await sql`insert into network.public_events (source, source_id, city, source_url, title, venue, area, latitude, longitude, starts_at, ends_at, category, tags)
      values ('nyc-parks', ${String(9000 + k)}, 'nyc', ${`https://www.nycgovparks.org/events/fixture-${k}`}, 'Public gathering', 'Public park', 'Brooklyn',
        40.75, -73.95, ${new Date(t0 + k * MINUTE)}, ${new Date(t0 + k * MINUTE + HOUR)}, 'events', '{}')`;
  }

  const tick = runtime.tick();
  expect((await within(judge.first, 60_000)).done).toBe(true);

  let started = performance.now();
  const open = await within(signedTurn(eve!.e164, "tick-lock-open", "Could you explain the solar system?"), TURN_LIMIT_MS);
  expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
  if (!open.done) throw new Error("The signed turn waited for the engine run");
  expect(open.v.status).toBe(200);
  const answer = await open.v.json();
  expect(answer).toMatchObject({ outcome: "handled", memberId: eve!.id, replies: [expect.any(String)] });

  started = performance.now();
  const stop = await within(signedTurn(ana!.e164, "tick-lock-stop", "STOP"), TURN_LIMIT_MS);
  expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
  if (!stop.done) throw new Error("The signed STOP waited for the engine run");
  expect(await stop.v.json()).toMatchObject({ outcome: "handled", consent: { state: "opted_out", scope: "all" } });

  const safety = { id: "safety@example.test", roles: ["safety" as const], grants: [{ role: "safety" as const, app: "*" }], via: "sso" as const };
  started = performance.now();
  const banned = await within(service.ban(safety, runtime, ben!.id, "phone", "fixture ban during the engine run"), TURN_LIMIT_MS);
  expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
  if (!banned.done) throw new Error("The ban waited for the engine run");
  expect(banned.v).toMatchObject({ ok: true });

  judge.release();
  expect(await tick).toBe(true);

  const opportunities = await sql<{ id: string; member_id: string }[]>`select o.id, p.member_id from network.opportunities o
    join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = ${app.id}`;
  expect(opportunities.map(row => row.member_id)).toEqual(expect.arrayContaining([eve!.id, members[3]!.id]));
  expect(opportunities.map(row => row.member_id)).not.toContain(ana!.id);
  expect(opportunities.map(row => row.member_id)).not.toContain(ben!.id);
  const toStoppedOrBanned = await sql`select id from network.messages where app_id = ${app.id} and member_id in ${sql([ana!.id, ben!.id])}
    and direction = 'outbound' and (proactive or opportunity_id is not null)`;
  expect(toStoppedOrBanned).toEqual([]);
}, 180_000);
