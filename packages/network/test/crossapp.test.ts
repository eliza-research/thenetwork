// cross_app_leak (platform plan 2.4 rule 7): two apps on one service and one database, The Network
// (ntwrk) and the NYC friends app, with people who are members of both. Each app's facts carry a
// canary. The run onboards everyone through each app's own line, lets the engine run and members ask
// for people, approves every review item, and delivers. Then:
//  - no canary from one app is in the other app's outbound messages, review queue, opportunities
//    (objective and explanations), events or snapshot;
//  - a person-to-person block made on one app keeps the two people apart on the other app (the
//    control run without the block pairs them).
// Postgres in a database of its own per test process. Nothing is sent (dry-run adapters).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../../prototypes/messaging-blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APP_IDS, APPS, type AppId } from "../../platform/src/apps.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { START } from "./mini.ts";

const T = 600_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const DB = `network_crossapp_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const FR = APP_IDS.find(a => a === ("friends" as string) || a === "buddies")! as AppId;
const APPS_RUN: AppId[] = ["ntwrk", FR];
const SECRET = "whsec_crossapp";
const CANARY: Record<string, string> = { ntwrk: "zqntwrkcanary", [FR]: "zqfriendscanary" };
const CLIMB = "find a regular climbing partner";
const ONBOARD = ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];

/** Who is in which app, and what they are into there. Ana and Ben are in both apps; in the friends app Ben is the only other climber. */
interface Person { key: string; name: string; apps: AppId[]; interests: Partial<Record<AppId, string[]>>; wants?: AppId[] }
const PEOPLE: Person[] = [
  { key: "a", name: "Ana Diaz", apps: ["ntwrk", FR], interests: { ntwrk: ["climbing", "hiking"], [FR]: ["climbing", "hiking"] }, wants: ["ntwrk"] },
  { key: "b", name: "Ben Ito", apps: ["ntwrk", FR], interests: { ntwrk: ["climbing", "hiking"], [FR]: ["climbing", "hiking"] }, wants: ["ntwrk"] },
  { key: "c", name: "Cy Moss", apps: ["ntwrk", FR], interests: { ntwrk: ["climbing", "hiking"], [FR]: ["board_games", "cooking"] }, wants: ["ntwrk"] },
  { key: "d", name: "Dee Park", apps: ["ntwrk"], interests: { ntwrk: ["climbing", "hiking"] }, wants: ["ntwrk"] },
  { key: "e", name: "Eve Ruiz", apps: [FR], interests: { [FR]: ["board_games", "cooking"] } },
];
const phone = (key: string) => `+1212555${String(200 + PEOPLE.findIndex(p => p.key === key)).padStart(4, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];
let evt = 0;

async function seed(svc: NetworkService) {
  const people = new PgPeopleStore(sql);
  const joined = new Date(START - 30 * 24 * HOUR);
  const ids: Record<string, Partial<Record<AppId, string>>> = {};
  for (const p of PEOPLE) {
    const person = await people.createPerson({ id: randomUUID(), e164: phone(p.key), method: "staff", at: START - 30 * 24 * HOUR, lowestAge: 30 });
    ids[p.key] = {};
    for (const app of p.apps) {
      const memberId = `${app}_${p.key}`;
      ids[p.key]![app] = memberId;
      const m = { app, personId: person.id, memberId, state: "active" as const, review: null, firstName: p.name, profile: {}, joinedAt: START - 30 * 24 * HOUR, leftAt: null };
      await people.putMembership(m);
      await svc.createMember(svc.runtimeFor(app)!, m, { age: 30, firstName: p.name, neighborhood: "Greenpoint" });
      await sql.begin(async tx => {
        await tx`select set_config('app.app_id', ${app}, true)`;
        for (const tag of p.interests[app] ?? []) {
          for (const kind of ["interest", "skill"] as const) await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
            values (${app}, ${`${memberId}:${kind}:${tag}`}, ${memberId}, ${kind}, ${tag}, ${tx.array([tag], "TEXT")}, 'matchable', 'said', 'chat', 0.9, 'confirmed', ${joined})`;
        }
        // The canaries: one matchable fact (it may reach this app's own messages) and one private fact.
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from) values
          (${app}, ${`${memberId}:canary:m`}, ${memberId}, 'interest', ${`${CANARY[app]}${p.key}`}, ${tx.array([`${CANARY[app]}${p.key}`], "TEXT")}, 'matchable', 'said', 'chat', 0.9, 'confirmed', ${joined}),
          (${app}, ${`${memberId}:canary:p`}, ${memberId}, 'note', ${`${CANARY[app]} private ${p.key}`}, ${tx.array(["note"], "TEXT")}, 'agent_private', 'said', 'chat', 0.9, 'confirmed', ${joined})`;
        if (p.wants?.includes(app)) await tx`insert into network.intents (app_id, id, member_id, objective, category, horizon_days, status, created_at) values (${app}, ${`${memberId}:want`}, ${memberId}, ${CLIMB}, 'hobby', 60, 'active', ${joined})`;
      });
    }
  }
  return ids;
}

async function say(svc: NetworkService, clock: SimClock, app: AppId, key: string, text: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: phone(key), chat_id: phone(key), text, protocol: "imessage" } });
  const res = await svc.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}/${app}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = (svc: NetworkService, method: string, path: string, body?: unknown) =>
  svc.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: "Bearer adm-tok", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));

/** One run: onboarding on both apps, optionally Ana blocks Ben on The Network, Ana asks for a climbing partner on the friends app, the engine runs, every item is approved. */
async function run(block: boolean) {
  await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  const clock = new SimClock(START);
  const svc = new NetworkService({
    url: URL_, clock, instance: "crossapp", log: () => {}, env: { PLATFORM_ENV: "dev" }, tokens: "admin:adm-tok", network: { seed: 1 },
    networks: APPS_RUN.map(a => ({ id: `${a}:nyc` })), webhookSecrets: Object.fromEntries(APPS_RUN.map(a => [a, SECRET])),
  });
  open.push(svc);
  await svc.start();
  const ids = await seed(svc);
  for (const app of APPS_RUN) expect((await staff(svc, "POST", `/apps/${app}/matching`, { on: true })).status).toBe(200);
  for (const app of APPS_RUN) for (const p of PEOPLE.filter(x => x.apps.includes(app))) for (const t of ONBOARD) await say(svc, clock, app, p.key, t);
  if (block) expect(await say(svc, clock, "ntwrk", "a", "block Ben Ito")).toBe("handled");
  expect(await say(svc, clock, FR, "a", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
  const queues: Record<string, any[]> = {};
  for (let round = 0; round < 3; round++) {
    clock.set(START + (round + 1) * 2 * HOUR);
    await svc.tick();
    for (const app of APPS_RUN) {
      const q = await (await staff(svc, "GET", `/apps/${app}/review`)).json();
      queues[app] = [...(queues[app] ?? []), ...q.items];
      for (const item of q.items) await staff(svc, "POST", `/apps/${app}/review/${encodeURIComponent(item.oppId)}`, { decision: "approve", secondsSpent: 5 });
    }
    await svc.tick();
  }
  return { svc, ids, queues };
}

describe.skipIf(!pgAvailable)("cross_app_leak: two apps, shared people (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  for (const block of [false, true]) {
    test(block ? "a block made on The Network keeps the two people apart on the friends app; no canary crosses apps" : "control (no block): the friends app pairs Ana with Ben; no canary crosses apps", async () => {
      const { svc, ids, queues } = await run(block);
      const a = ids.a![FR]!, b = ids.b![FR]!;
      const frOpps = (await sql`select o.id, o.objective, o.explanations, array_agg(p.member_id) as members from network.opportunities o
        join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id where o.app_id = ${FR} group by o.id, o.objective, o.explanations`) as any[];
      const paired = frOpps.some(o => o.members.includes(a) && o.members.includes(b)) || queues[FR]!.some(i => i.proposal.participants.includes(a) && i.proposal.participants.includes(b));
      if (block) {
        expect(paired).toBe(false);
        expect((await sql`select origin_app from platform.person_blocks`).map((r: any) => r.origin_app)).toEqual(["ntwrk"]);
        const snap = await loadSnapshot(sql, START, { app: FR, city: "nyc" });
        expect(snap.edges.some(e => e.type === "blocked" && e.from === a && e.to === b)).toBe(true);
      } else {
        expect(paired).toBe(true);
        expect(await sql`select 1 from platform.person_blocks`).toHaveLength(0);
      }

      // Something happened on both apps: messages, review items and opportunities.
      for (const app of APPS_RUN) {
        expect((await sql`select count(*)::int as n from network.messages where app_id = ${app} and direction = 'outbound'`)[0].n).toBeGreaterThan(10);
      }
      expect(queues.ntwrk!.length).toBeGreaterThan(0);
      // The friends app: Ana's request finds Ben (control), or nobody once Ben is blocked (the request stays open, nobody is contacted).
      expect(queues[FR]!.map(i => i.origin)).toEqual(block ? [] : ["request"]);
      expect((await sql`select member_id, outcome from network.requests where app_id = ${FR}`).map((r: any) => [r.member_id, r.outcome])).toEqual([[a, block ? "none" : "probing"]]);

      // cross_app_leak = 0: nothing from one app in the other's messages, review views, opportunities, events or snapshot.
      for (const app of APPS_RUN) {
        const other = APPS_RUN.find(x => x !== app)!;
        const otherIds = Object.values(ids).map(x => x[other]).filter((x): x is string => !!x);
        const texts = [
          ...(await sql`select body from network.messages where app_id = ${app}`).map((r: any) => r.body as string),
          JSON.stringify(queues[app]),
          JSON.stringify(await sql`select objective, explanations from network.opportunities where app_id = ${app}`),
          JSON.stringify(await sql`select actor_id, object_id, payload from network.events where app_id = ${app}`),
          JSON.stringify(await loadSnapshot(sql, START + 6 * HOUR, { app, city: "nyc" })),
          JSON.stringify(await (await staff(svc, "GET", `/apps/${app}/health`)).json()),
        ];
        const leaks = texts.filter(t => t.includes(CANARY[other]!) || otherIds.some(id => t.includes(`"${id}"`) || t.includes(`${id}:`)));
        expect(leaks).toEqual([]);
        // Each app's own canary does reach its own snapshot (the check above can see a canary).
        expect(JSON.stringify(await loadSnapshot(sql, START, { app, city: "nyc" }))).toContain(CANARY[app]!);
      }
    }, T);
  }
});
