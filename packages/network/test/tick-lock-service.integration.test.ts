// spec/runtimeUnit.md, "The engine runs on a snapshot outside the store lock"
// spec/runtimeUnit.md, "A prepared engine result commits only for members whose evidence did not change"
// The production service: while its daily tick waits on the engine's model judge, a signed gateway turn
// answers inside the 8 s turn limit, and a signed STOP or a phone ban that lands during the run keeps every
// proposal of that run away from that member. Public events start while the run computes: the run still
// commits on its first commit unit (a started event is evidence of its own, not shared evidence).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { HOUR, MINUTE, SimClock, type LLM } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { applySchema, devPgUp, DEV_PG_URL } from "../../observatory/db/dev-pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const TURN_LIMIT_MS = 8_000;
const db = `tick_lock_service_${randomUUID().replaceAll("-", "")}`;
const url = new URL(`/${db}`, DEV_PG_URL).href;
const admin = new SQL({ url: new URL("/postgres", DEV_PG_URL).href, max: 1 });
// 12:00 in New York: the first tick of the day runs the daily engine.
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const secret = "synthetic-tick-lock-fixture-signing-secret";
const app = APPS.ntwrk;
const networkId = "ntwrk:nyc";
let sql: SQL;
let service: NetworkService | undefined;

/**
 * The engine's judge model, held until the test releases it. A released call fails, so the engine keeps its
 * earlier stages. Each call takes one minute of the service clock, so a public event starts during every
 * engine computation: a tick that computed again would see more events gone at its next commit.
 */
function heldJudge() {
  let release!: () => void, called!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const first = new Promise<void>(r => (called = r));
  const llm: LLM = { chat: async () => { clock.advance(MINUTE); called(); await gate; throw new Error("judge held by the test"); } };
  return { llm, release, first };
}

const within = <T>(p: Promise<T>, ms: number) => Promise.race([p.then(v => ({ done: true as const, v })),
  new Promise<{ done: false }>(r => setTimeout(() => r({ done: false }), ms))]);

beforeAll(async () => {
  await devPgUp();
  await admin.unsafe(`create database ${db}`);
  await applySchema(url, { lockTimeout: "5s" });
  sql = new SQL({ url, max: 2 });
}, 120_000);

afterAll(async () => {
  try {
    await service?.close();
    await sql?.close();
    await admin.unsafe(`drop database if exists ${db} with (force)`);
  } finally {
    await admin.close();
  }
});

async function signedTurn(from: string, messageId: string, text: string) {
  const input: TurnRequest = { messageId, app: app.id, from, to: null, text, receivedAt: clock.now(), channel: "blooio", transport: "imessage" };
  const body = JSON.stringify(input);
  return service!.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", body, headers: {
    "content-type": "application/json",
    ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) }),
  } }));
}

test("a signed turn, a STOP and a ban during a held engine run do not wait for it, the run never reaches the stopped or banned member, and events that start meanwhile do not make it compute again", async () => {
  const judge = heldJudge();
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
  // The public catalog: one event starts every minute of the next two hours (more than the judge calls of two runs).
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
  // A real answer, never a busy retry: the member's first turn after signup gets its handled reply.
  const answer = await open.v.json();
  expect(answer).toMatchObject({ outcome: "handled", memberId: eve!.id, replies: [expect.any(String)] });

  started = performance.now();
  const stop = await within(signedTurn(ana!.e164, "tick-lock-stop", "STOP"), TURN_LIMIT_MS);
  expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
  if (!stop.done) throw new Error("The signed STOP waited for the engine run");
  expect(await stop.v.json()).toMatchObject({ outcome: "handled", consent: { state: "opted_out", scope: "all" } });

  // A phone ban by cross-app safety staff during the run: it takes the free lock and marks Ben banned.
  const safety = { id: "safety@example.test", roles: ["safety" as const], grants: [{ role: "safety" as const, app: "*" }], via: "sso" as const };
  started = performance.now();
  const banned = await within(service.ban(safety, runtime, ben!.id, "phone", "fixture ban during the engine run"), TURN_LIMIT_MS);
  expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
  if (!banned.done) throw new Error("The ban waited for the engine run");
  expect(banned.v).toMatchObject({ ok: true });

  judge.release();
  // True: the first commit unit used the computed run. With the public events as shared evidence the commit
  // computed again, saw more events gone after the second computation, and saved nothing (false).
  expect(await tick).toBe(true);

  const opportunities = await sql<{ id: string; member_id: string }[]>`select o.id, p.member_id from network.opportunities o
    join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = ${app.id}`;
  // The run committed (to the human review queue): the pottery pair, whose members did not change.
  expect(opportunities.map(row => row.member_id)).toEqual(expect.arrayContaining([eve!.id, members[3]!.id]));
  expect(opportunities.map(row => row.member_id)).not.toContain(ana!.id);
  expect(opportunities.map(row => row.member_id)).not.toContain(ben!.id);
  const toStoppedOrBanned = await sql`select id from network.messages where app_id = ${app.id} and member_id in ${sql([ana!.id, ben!.id])}
    and direction = 'outbound' and (proactive or opportunity_id is not null)`;
  expect(toStoppedOrBanned).toEqual([]);
}, 180_000);
