// The production service (packages/network/service) against the local dev Postgres, in a database
// of its own per test process (the packages/observatory/test/pg.ts pattern). Nothing is sent: the
// default adapter is dry-run, and the Blooio adapter gets a fake provider. Skipped without Postgres.
import { setTimeout as sleep } from "node:timers/promises";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { GENERATOR_NAMES } from "../../engine/src/config.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { importPublicEvents } from "../service/import-public-events.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { START } from "./mini.ts";
import { holdEveryItem, simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const DB = `network_service_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_service_test";
const TOKENS = "admin:adm-tok,reviewer:rev-tok,safety:saf-tok,analyst:ana-tok";
const CLIMB = "find a regular climbing partner";
interface Person { id: string; name: string; age: number | null; wants?: boolean }
const PEOPLE: Person[] = [
  { id: "a", name: "Ana Diaz", age: 30, wants: true }, { id: "b", name: "Ben Ito", age: 31, wants: true }, { id: "c", name: "Cy Moss", age: 29, wants: true },
  { id: "r", name: "Rae Kim", age: 33 }, { id: "u", name: "Uma Unknown", age: null },
];
const phone = (id: string) => `+1212555${String(100 + PEOPLE.findIndex(p => p.id === id)).padStart(4, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];

/** A clean schema with the five members: rows in network.members, their phones, facets, wants and home area. */
async function reset() {
  await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  const joined = new Date(START - 30 * 24 * HOUR);
  const prefs = { categoriesOptIn: ["social", "hobby", "professional", "events", "growth", "help"], quietHours: [21, 9], romanceOptIn: false, formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false };
  for (const p of PEOPLE) {
    await sql`insert into network.members (id, name, home_city, home_area, account_status, age, prefs, joined_at) values (${p.id}, ${p.name}, 'nyc', 'Greenpoint', 'active', ${p.age}, ${prefs}::jsonb, ${joined})`;
    await sql`insert into network.channel_identities (member_id, channel, address, is_primary) values (${p.id}, 'imessage', ${phone(p.id)}, true)`;
    await sql`insert into network.presence (member_id, city, type, areas) values (${p.id}, 'nyc', 'home', '{Greenpoint}')`;
    for (const [kind, tag] of [["interest", "climbing"], ["interest", "hiking"], ["skill", "belaying"]] as const) {
      await sql`insert into network.facets (id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values (${`${p.id}:${kind}:${tag}`}, ${p.id}, ${kind}, ${tag}, ${`{${tag}}`}::text[], 'matchable', 'said', 'chat', 0.9, 'confirmed', ${joined})`;
    }
    if (p.wants) await sql`insert into network.intents (id, member_id, objective, category, horizon_days, status, created_at) values (${`${p.id}:want`}, ${p.id}, ${CLIMB}, 'hobby', 60, 'active', ${joined})`;
  }
}

function service(clock: SimClock, instance: string, more: Partial<ServiceOptions> = {}) {
  const s = new NetworkService({ url: URL_, clock, instance, tokens: TOKENS, webhookSecret: SECRET, network: { seed: 1 }, log: () => {}, ...more });
  open.push(s);
  return s;
}

let evt = 0;
/** A signed Blooio webhook (payload version 2026-10-01). Build the Request twice from one body for a provider retry. */
function signed(clock: SimClock, from: string, text: string) {
  const n = ++evt;
  const body = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text, protocol: "imessage" } });
  return { n, body, req: (sig = signBlooioPayload(SECRET, body, Math.floor(clock.now() / 1000))) => new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": sig }, body }) };
}
async function say(s: NetworkService, clock: SimClock, id: string, text: string) {
  const res = await s.fetch(signed(clock, phone(id), text).req());
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const ONBOARD = ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];
const staff = (s: NetworkService, token: string, method: string, path: string, body?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const outbound = async (member: string) => (await sql`select id, body, status, type, opportunity_id, proactive, system from network.messages where direction = 'outbound' and member_id = ${member} order by ts, id`) as any[];

describe.skipIf(!pgAvailable)("network service (Postgres)", () => {
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

  test("inbound webhooks get dry-run replies; bad signatures, retries and strangers are refused; STOP and HELP are confirmed", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "inbound");
    await s.start();
    expect(s.adapter.name).toBe("dry_run");

    const hi = signed(clock, phone("a"), "hi!");
    expect(await (await s.fetch(hi.req("t=1,v1=" + "0".repeat(64)))).json()).toEqual({ ok: false, error: "signature_stale" });
    expect((await sql`select count(*)::int as n from network.messages`)[0].n).toBe(0);
    const first = await s.fetch(hi.req());
    expect(first.status).toBe(200);
    expect((await first.json()).result).toBe("handled");
    const welcome = await outbound("a");
    expect(welcome.length).toBe(1);
    expect(welcome[0]).toMatchObject({ status: "dry_run", type: "onboarding", system: false });
    expect((await sql`select status, body from network.messages where id = ${`in:blooio:msg_${hi.n}`}`)[0]).toEqual({ status: "received", body: "hi!" });
    // A provider retry of the same delivery is handled once.
    expect((await (await s.fetch(hi.req())).json()).result).toBe("duplicate");
    expect((await outbound("a")).length).toBe(1);
    // Someone who is not a member, with no keyword on the shared line: The Network's join asks for name and age; nothing stored.
    expect((await (await s.fetch(signed(clock, "+19175550199", "hello?").req())).json()).result).toBe("join_asked");
    expect((await sql`select count(*)::int as n from network.messages`)[0].n).toBe(2);

    // The next answer continues onboarding (state was saved and loaded again).
    expect(await say(s, clock, "a", "More time outdoors.")).toBe("handled");
    expect((await outbound("a")).length).toBe(2);
    expect((await s.pg.load())!.members.find(m => m.id === "a")!.msgsIn).toBe(2);

    // STOP: the gateway's confirmation (system), the member row opted out. HELP: the help text.
    await say(s, clock, "b", "hi!");
    await say(s, clock, "b", "STOP");
    const b = await outbound("b");
    expect(b.at(-1)).toMatchObject({ system: true, status: "dry_run", type: "system" });
    expect((await sql`select opted_out from network.members where id = 'b'`)[0].opted_out).toBe(true);
    await say(s, clock, "c", "HELP");
    expect((await outbound("c")).at(-1)).toMatchObject({ system: true, type: "system" });
    // Invited but not joined (the invite gate has not let them in): not a member here; the join asks for name and age.
    await sql`update network.members set account_status = 'invited' where id = 'r'`;
    expect(await say(s, clock, "r", "hi!")).toBe("join_asked");
    expect((await sql`select count(*)::int as n from network.messages where member_id = 'r'`)[0].n).toBe(0);
  }, T);

  test("an under-13 decline keeps only the member id", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "decline");
    // No age on the record is unknown, not under 13: asked once, nothing deleted (regression: the snapshot read a missing age as 0).
    await say(s, clock, "u", "hi");
    expect((await sql`select account_status from network.members where id = 'u'`)[0].account_status).toBe("active");
    expect((await outbound("u")).length).toBe(1); // "How old are you?"
    // Events that name them only in the payload (an opportunity's logs) go too; others' events stay.
    await sql`insert into network.events (at, actor_type, actor_id, type, payload) values
      (now(), 'agent', 'network', 'probe_answer', ${{ oppId: "o1", memberId: "u", yes: true }}::jsonb),
      (now(), 'agent', 'network', 'venue', ${{ oppId: "o1", participants: ["a", "u"] }}::jsonb),
      (now(), 'agent', 'network', 'probe_replaced', ${{ oppId: "o1", out: "u", in: "b" }}::jsonb),
      (now(), 'agent', 'network', 'gate_reason', ${{ members: ["u", "c"] }}::jsonb),
      (now(), 'agent', 'network', 'probe_answer', ${{ oppId: "o2", memberId: "a", yes: true }}::jsonb)`;
    await say(s, clock, "u", "I am 12 years old");
    const [row] = await sql`select name, age, account_status from network.members where id = 'u'`;
    expect(row).toEqual({ name: null, age: null, account_status: "removed" });
    for (const t of ["messages", "facets", "presence", "channel_identities"]) expect((await sql.unsafe(`select count(*)::int as n from network.${t} where member_id = 'u'`))[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.events where actor_id = 'u' or object_id = 'u' or payload::text like '%"u"%'`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.events where payload->>'oppId' = 'o2'`)[0].n).toBe(1);
    expect(s.net.isDeclined("u")).toBe(true);
    expect(await say(s, clock, "u", "hello?")).toBe("under_age");
    expect(await say(s, clock, "u", "Uma, 25")).toBe("under_age");
    expect((await sql`select account_status from network.members where id = 'u'`)[0].account_status).toBe("removed");
    expect((await sql`select count(*)::int as n from network.members where id <> 'u' and account_status = 'active'`)[0].n).toBe(PEOPLE.length - 1);
  }, T);

  test("staff API: roles, the matching switch, review through the API after a restart, then the next tick contacts the members", async () => {
    await reset();
    const clock = new SimClock(START);
    const a = service(clock, "first");
    // Auth: no token, a wrong role, and the review mode that is never exposed.
    expect((await a.fetch(new Request("http://127.0.0.1/review"))).status).toBe(401);
    expect((await staff(a, "ana-tok", "GET", "/review")).status).toBe(403);
    expect((await staff(a, "rev-tok", "POST", "/matching", { on: true })).status).toBe(403);
    expect((await staff(a, "adm-tok", "POST", "/review-mode", { mode: "auto" })).status).toBe(404);
    const inline = service(clock, "inline", { network: { inlineJudge: simulatedReviewJudge({ exceptions: false }) } });
    expect(inline.main.net.judgeReviewer).toBe("review_judge");
    expect(Reflect.get(inline.main.net, "inlineJudge")).toBeUndefined();
    // A new Network starts with matching off; an admin turns it on.
    expect((await (await staff(a, "ana-tok", "GET", "/health")).json()).matchingEnabled).toBe(false);
    expect((await staff(a, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);

    // Onboarding and a member request through the webhook; a restart in the middle.
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD.slice(0, 2)) await say(a, clock, id, text);
    await a.close();
    const b = service(clock, "second", { reviewJudge: holdEveryItem.judge });
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD.slice(2)) await say(b, clock, id, text);
    for (const id of ["a", "b", "c", "r"]) {
      const bodies = (await outbound(id)).map(m => m.body);
      expect(new Set(bodies).size).toBe(bodies.length); // no welcome or question twice across the restart
    }
    expect(await say(b, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
    await b.reviewJudgeTick();

    const queue = await (await staff(b, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((i: any) => i.origin === "request");
    expect(item).toBeDefined();
    const oppId = item.oppId as string;
    const aboutOpp = async () => (await sql`select count(*)::int as n from network.messages where opportunity_id = ${oppId}`)[0].n;
    expect(await aboutOpp()).toBe(0); // nobody hears about it before review
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBeNull();

    // An unknown decision is refused; approve works; the reviewer of record is the staff id.
    expect((await staff(b, "rev-tok", "POST", `/review/${oppId}`, { decision: "maybe", revision: item.revision })).status).toBe(400);
    clock.set(START + 90 * MINUTE); // 14:30 New York: every member's send window is open
    const ok = await staff(b, "rev-tok", "POST", `/review/${oppId}`, { decision: "approve", secondsSpent: 40, reviewer: "someone-else", revision: item.revision });
    expect(await ok.json()).toEqual({ ok: true });
    const [decision] = await sql`select decision, reviewer, seconds_spent from network.review_items where opportunity_id = ${oppId}`;
    expect(decision.decision).toBe("approve");
    expect(decision.reviewer).toMatch(/^token:reviewer#/);
    expect(decision.seconds_spent).toBe(40);
    expect(await b.tick()).toBe(true);
    // The requester (strong fit) is asked first which time works; the partner is probed after the answer.
    expect((await sql`select count(*)::int as n from network.events where type = 'probe_started' and object_id = ${oppId}`)[0].n).toBe(1);
    expect((await outbound("r")).at(-1)).toMatchObject({ type: "scheduling", status: "dry_run" });
    expect(await say(b, clock, "r", "Either works")).toBe("handled");
    expect(await b.tick()).toBe(true);
    const partner = (item.proposal.participants as string[]).find(p => p !== "r")!;
    expect((await outbound(partner)).filter(m => m.opportunity_id === oppId).map(m => m.type)).toEqual(["probe"]);
    // The requester's time question and the partner's probe (the time question names its opportunity).
    expect(await aboutOpp()).toBe(2);
    // Every staff action is in network.staff_audit (requested, then the result) and in the Network's logs.
    const audit = await sql`select action, actor, ok, detail->>'phase' as phase from network.staff_audit where action in ('review', 'config') order by id`;
    expect(audit.map((r: any) => `${r.action}:${r.phase}:${r.ok}`)).toEqual(["config:requested:true", "config:result:true", "review:requested:true", "review:result:true"]); // malformed input: 400 and no audit row (SVC-21)
    expect((await sql`select count(*)::int as n from network.events where type = 'review_decision' and actor_type = 'reviewer' and actor_id like 'token:reviewer#%'`)[0].n).toBe(1);
    expect((await sql`select count(*)::int as n from network.events where type = 'matching_switch' and actor_id like 'token:admin#%'`)[0].n).toBe(1);
    const h = await (await staff(b, "ana-tok", "GET", "/health")).json();
    expect(h).toMatchObject({ ok: true, channel: "dry_run", reviewJudge: { awaiting: 0, exceptions: 0, exceptionsOverdue: 0 }, matchingEnabled: true, lockHolder: null });
    expect(h.lastTick.thisInstance).toEqual({ at: clock.now(), ran: true });
  }, T);

  // spec/standingIntent.md, "Changed matching evidence starts another standing intent search"
  test("a new eligible member rechecks standing intents on the same day and queues human review", async () => {
    await reset();
    await sql`update network.members set account_status = 'invited' where id <> 'a'`;
    const clock = new SimClock(START);
    const options: Partial<ServiceOptions> = {
      network: { seed: 1, maxNewPerDay: 1, plans: false, growth: false, selective: false,
        engine: { floors: { fit: 0, mutualBenefit: 0, confidence: 0 }, retrieval: { minSim: 0 }, thresholds: { byState: { normal: 0 } } },
      },
    };
    const s = service(clock, "intent-search", options);
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const text of ONBOARD) await say(s, clock, "a", text);
    const runCount = async () => (await sql<{ n: number }[]>`select count(*)::int as n from network.matching_runs where app_id = 'ntwrk'`)[0]!.n;
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(1);

    // A changed matchable facet does not need a new day. A private facet does not trigger a run.
    await sql`update network.facets set value = 'Indoor climbing' where id = 'a:interest:climbing'`;
    clock.advance(MINUTE);
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(2);
    await sql`insert into network.facets (id, member_id, kind, value, privacy_scope, provenance, status, valid_from)
      values ('a:private', 'a', 'fact', 'Private note', 'agent_private', 'said', 'confirmed', ${new Date(clock.now())})`;
    clock.advance(MINUTE);
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(2);

    await s.close();
    const restarted = service(clock, "intent-search-restarted", options);
    await restarted.start();
    clock.advance(MINUTE);
    expect(await restarted.tick()).toBe(true);
    expect(await runCount()).toBe(2);
    await sql`update network.members set account_status = 'active' where id = 'b'`;
    for (const text of ONBOARD) await say(restarted, clock, "b", text);
    expect(await restarted.tick()).toBe(true);
    expect(await runCount()).toBe(3);
    const queue = await (await staff(restarted, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((row: { origin: string }) => row.origin === "engine");
    expect(item).toBeDefined();
    expect([...item.proposal.participants].sort()).toEqual(["a", "b"]);
    expect((await sql`select id from network.messages where opportunity_id = ${item.oppId}`)).toHaveLength(0);

    // The next new member does not give the recheck another daily review slot.
    await sql`update network.members set account_status = 'active' where id = 'c'`;
    for (const text of ONBOARD) await say(restarted, clock, "c", text);
    expect(await restarted.tick()).toBe(true);
    expect(await runCount()).toBe(3);
  }, T);

  // spec/standingIntent.md, "Changed matching evidence starts another standing intent search"
  test("an earlier return to the matching market rechecks standing intents before the next day", async () => {
    await reset();
    await sql`update network.members set account_status = 'invited' where id not in ('a', 'b')`;
    await sql`insert into network.presence (member_id, city, type, areas, from_at, to_at)
      values ('b', 'sf', 'temporary', '{}', ${new Date(START - DAY)}, ${new Date(START + 30 * DAY)})`;
    const clock = new SimClock(START);
    const options: Partial<ServiceOptions> = { network: { seed: 1, maxNewPerDay: 1, plans: false, growth: false } };
    const first = service(clock, "intent-presence", options);
    expect((await staff(first, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const id of ["a", "b"]) {
      for (const message of [ONBOARD[0]!, "I enjoy hiking, climbing, and cycling.", ...ONBOARD.slice(2)]) await say(first, clock, id, message);
    }
    const runCount = async () => (await sql<{ n: number }[]>`select count(*)::int as n from network.matching_runs where app_id = 'ntwrk'`)[0]!.n;
    expect(await first.tick()).toBe(true);
    expect(await runCount()).toBe(1);
    expect((await (await staff(first, "rev-tok", "GET", "/review")).json()).items).toEqual([]);
    await first.close();

    const restarted = service(clock, "intent-presence-restarted", options);
    await restarted.start();
    const returnedAt = clock.now() + MINUTE;
    await sql`update network.presence set to_at = ${new Date(returnedAt)} where member_id = 'b' and type = 'temporary'`;
    clock.set(returnedAt);
    expect(await restarted.tick()).toBe(true);
    expect(await runCount()).toBe(2);
    const queue = await (await staff(restarted, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((row: { origin: string }) => row.origin === "engine");
    expect(item).toBeDefined();
    expect([...item.proposal.participants].sort()).toEqual(["a", "b"]);
    expect((await sql`select id from network.messages where opportunity_id = ${item.oppId}`)).toHaveLength(0);

    clock.advance(MINUTE);
    expect(await restarted.tick()).toBe(true);
    expect(await runCount()).toBe(2);
  }, T);

  // spec/emptyIntentFollowup.md, "A pending follow-up uses current permission and the same live statement"
  test("an aged intent without a match gets one eligible solo next step across restart", async () => {
    await reset();
    await sql`update network.members set account_status = 'invited' where id <> 'a'`;
    const clock = new SimClock(START);
    const options = { network: { seed: 1, plans: false, growth: false, engine: { emptyStateDays: 10 } } };
    const s = service(clock, "empty-intent", options);
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const message of ONBOARD) await say(s, clock, "a", message);
    const statedAt = START - 10 * DAY + 3 * HOUR;
    const objective = "Find a partner for my quiet north-wall climb";
    await sql`update network.intents set created_at = ${new Date(statedAt)}, objective = ${objective} where member_id = 'a'`;
    const sent = async () => (await outbound("a")).filter(message => message.type === "info" && message.body.includes("Show me public events"));

    clock.set(START + 90 * MINUTE);
    expect(await s.tick()).toBe(true);
    expect(await sent()).toHaveLength(0);

    // The result is old enough on the next day. The member's selected outreach preference wins.
    await sql`update network.members set prefs = jsonb_set(prefs, '{onlyWhenAsked}', 'true') where id = 'a'`;
    clock.advance(DAY);
    expect(await s.tick()).toBe(true);
    expect(await sent()).toHaveLength(0);

    await sql`update network.members set prefs = jsonb_set(prefs, '{onlyWhenAsked}', 'false') where id = 'a'`;
    const morning = START - 3 * HOUR - 30 * MINUTE;
    const pending = async (instance: NetworkService) => (await instance.pg.load())?.deferred.filter(entry => entry.o.hook?.t === "empty_intent");
    // The member's own 48-hour follow-up window has also passed.
    clock.set(morning + 3 * DAY);
    expect(await s.tick()).toBe(true);
    expect(await pending(s)).toHaveLength(1);
    expect(await sent()).toHaveLength(0);

    // Losing the intent's category before the send window cancels this deferred follow-up.
    await sql`update network.members set prefs = jsonb_set(prefs, '{categoriesOptIn}', (prefs->'categoriesOptIn') - 'hobby') where id = 'a'`;
    clock.advance(5 * HOUR);
    expect(await s.tick()).toBe(true);
    expect(await pending(s)).toHaveLength(0);
    expect(await sent()).toHaveLength(0);

    await sql`update network.members set prefs = jsonb_set(prefs, '{categoriesOptIn}', (prefs->'categoriesOptIn') || '["hobby"]') where id = 'a'`;
    clock.set(morning + 4 * DAY);
    expect(await s.tick()).toBe(true);
    expect(await pending(s)).toHaveLength(1);
    await s.close();
    const restarted = service(clock, "empty-intent-restarted", options);
    await restarted.start();
    clock.advance(5 * HOUR);
    expect(await restarted.tick()).toBe(true);
    const one = await sent();
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ status: "dry_run", opportunity_id: null, proactive: true });
    expect(one[0].body).not.toContain(objective);
    expect((await restarted.pg.load())?.members.find(member => member.id === "a")?.unsol?.state).toEqual([clock.now()]);
    const audit = await sql`select payload from network.events where type = 'empty_intent_followup' order by id`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({ memberId: "a", intentId: "a:want", reason: expect.any(String) });
    expect(JSON.stringify(audit[0]?.payload)).not.toContain(objective);

    await restarted.close();
    const reopened = service(clock, "empty-intent-reopened", options);
    await reopened.start();
    clock.advance(DAY);
    expect(await reopened.tick()).toBe(true);
    expect(await sent()).toHaveLength(1);
  }, T);

  // spec/publicEventCatalog.md, "A successful complete scan replaces the previous source and expires if refresh stops"
  test.each(["current", "moved after queuing", "age lowered after queuing"] as const)("publishes public Parks events and checks matching through dispatch (%s)", async listingState => {
    await reset();
    await sql`update network.members set account_status = 'invited' where id <> 'a'`;
    const clock = new SimClock(START);
    const delivered: SendRequest[] = [];
    const s = service(clock, "public-events", {
      adapter: (net, runtime) => new BlooioAdapter({
        net, memberOf: runtime.memberOf, from: "+12125550190", clock, env: {}, log: () => {},
        provider: { kind: "sim", send: async request => {
          delivered.push(request);
          return { providerMessageId: `public-event-${delivered.length}`, status: "queued" };
        } },
      }),
      network: { seed: 1, plans: false, growth: false, selective: false, engine: {
        generators: Object.fromEntries(GENERATOR_NAMES.map(name => [name, name === "event_anchor"])),
        floors: { fit: 0, mutualBenefit: 0, confidence: 0 }, retrieval: { minSim: 0 }, thresholds: { byGenerator: { event_anchor: 0 } },
      } },
    });
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const message of ONBOARD) await say(s, clock, "a", message);
    const runCount = async () => (await sql<{ n: number }[]>`select count(*)::int as n from network.matching_runs where app_id = 'ntwrk'`)[0]!.n;
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(1);
    const fixture = {
      guid: "2257118", title: "Outdoor climbing 21+", categories: "Fitness | Climbing", location: "McCarren Park",
      starttime: "2026-10-07T18:00:00.000", endtime: "2026-10-07T19:00:00.000", coordinates: "40.7206,-73.9518",
      link: { url: "http://www.nycgovparks.org/events/2026/10/07/fitness" }, contact_phone: "unneeded value", description: "unneeded copy",
    };
    const fetchFixture: typeof fetch = async input => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe("https://data.cityofnewyork.us/resource/w3wp-dpdi.json");
      expect(url.searchParams.get("$select")).not.toContain("contact_phone");
      return Response.json([fixture, fixture, { ...fixture, guid: "2", title: "Kids yoga" },
        { ...fixture, guid: "3", location: "Virtual workshop" }, { ...fixture, guid: "4", endtime: fixture.starttime }]);
    };
    clock.advance(MINUTE);
    expect(await importPublicEvents(sql, clock, fetchFixture)).toEqual({ published: true, events: 1 });
    const publishedAt = clock.now();
    const snapshot = await s.runtimeFor("ntwrk")!.scoped(tx => loadSnapshot(tx, clock.now(), { app: "ntwrk", city: "nyc" }));
    expect(snapshot.events).toEqual([{
      id: "nyc-parks:2257118", title: "Outdoor climbing 21+", city: "nyc", area: "Williamsburg",
      start: Date.UTC(2026, 9, 7, 22), end: Date.UTC(2026, 9, 7, 23), tags: ["climbing", "fitness"], category: "hobby",
      listing: { venue: "McCarren Park", lat: 40.7206, lng: -73.9518, url: "https://www.nycgovparks.org/events/2026/10/07/fitness" },
    }]);
    expect((await loadSnapshot(sql, clock.now(), { app: "ntwrk", city: "sf" })).events).toBeUndefined();
    expect((await loadSnapshot(sql, clock.now(), { app: "ntwrk", purpose: "profile_review" })).events).toBeUndefined();
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(2);
    expect(await importPublicEvents(sql, clock, fetchFixture)).toEqual({ published: false, events: 0 });

    clock.advance(MINUTE);
    expect(await importPublicEvents(sql, clock, fetchFixture)).toEqual({ published: true, events: 1 });
    const lastFullScan = clock.now();
    clock.advance(MINUTE);
    await expect(importPublicEvents(sql, clock, async () => new Response(null, { status: 503 }))).rejects.toThrow("HTTP 503");
    await expect(importPublicEvents(sql, clock, async () => Response.json([], {
      status: 206, headers: { "content-range": "bytes 0-1/50" },
    }))).rejects.toThrow("HTTP 206");
    await expect(importPublicEvents(sql, clock, async () => Response.json([], {
      headers: { "content-range": "bytes 0-1/50" },
    }))).rejects.toThrow("did not return a full response");
    const invalidUtf8 = new TextEncoder().encode(JSON.stringify([{ ...fixture, title: "%" }]));
    invalidUtf8[invalidUtf8.indexOf("%".charCodeAt(0))] = 255;
    await expect(importPublicEvents(sql, clock, async () => new Response(invalidUtf8))).rejects.toThrow("UTF-8 JSON");
    // spec/publicEventCatalog.md, "A source id identifies a single normalized listing in each scan"
    const badScans = await Promise.allSettled([
      importPublicEvents(sql, clock, async () => Response.json([{ guid: fixture.guid, starttime: fixture.starttime }, null])),
      importPublicEvents(sql, clock, async () => Response.json([fixture, { ...fixture, location: "Transmitter Park" }])),
    ]);
    expect(badScans).toEqual([
      { status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("complete event listing") }) },
      { status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("conflicting listings") }) },
    ]);

    const megabyteOfSpaces = new Uint8Array(1024 * 1024).fill(32);
    const oversized = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("[]"));
      for (let i = 0; i < 9; i++) controller.enqueue(megabyteOfSpaces);
      controller.close();
    } });
    await expect(importPublicEvents(sql, clock, async () => new Response(oversized))).rejects.toThrow("scan byte cap");
    expect(await sql`select checked_at from network.public_event_imports where source='nyc-parks'`).toEqual([{ checked_at: new Date(lastFullScan) }]);
    expect((await s.runtimeFor("ntwrk")!.scoped(tx => loadSnapshot(tx, clock.now(), { app: "ntwrk", city: "nyc" }))).events).toEqual(snapshot.events);
    expect(await s.tick()).toBe(true);
    expect(await runCount()).toBe(2);
    expect((await loadSnapshot(sql, publishedAt + 2 * DAY + MINUTE, { app: "ntwrk" })).events).toBeUndefined();
    const [grants] = await sql`select has_table_privilege('network_service', 'network.public_events', 'SELECT') reader,
      has_table_privilege('network_service', 'network.public_events', 'INSERT') reader_can_publish,
      has_table_privilege('network_public_event_ingest', 'network.members', 'SELECT') publisher_can_read_members`;
    expect(grants).toEqual({ reader: true, reader_can_publish: false, publisher_can_read_members: false });

    // The reviewed opportunity names the publisher's end-to-end window. A moved listing cannot
    // authorize contact for the old opportunity even before the next tick notices the move.
    await sql`update network.members set account_status = 'active' where id = 'b'`;
    await sql`update network.members set account_status = 'active', age = 16 where id = 'c'`;
    for (const message of ONBOARD) await say(s, clock, "b", message);
    expect(await s.tick()).toBe(true);
    const eventInReview = async () => (await (await staff(s, "rev-tok", "GET", "/review")).json()).items.find(
      (row: { proposal: { kind: string } }) => row.proposal.kind === "event_coattend",
    );
    const pending = await eventInReview();
    const [latest] = await sql`select summary->'funnel' as funnel from network.matching_runs where app_id = 'ntwrk' order by at desc limit 1`;
    expect(pending, JSON.stringify({ funnel: latest?.funnel, gateReasons: (await s.pg.load())?.gateReasons })).toBeDefined();
    expect(pending?.proposal.window).toEqual({ start: Date.UTC(2026, 9, 7, 22), end: Date.UTC(2026, 9, 7, 23) });
    expect([...pending.proposal.participants].sort()).toEqual(["a", "b"]);
    clock.advance(MINUTE);
    expect(await importPublicEvents(sql, clock, async () => Response.json([{ ...fixture, location: "Transmitter Park", coordinates: "40.7273,-73.9606" }]))).toEqual({ published: true, events: 1 });
    const approval = await staff(s, "rev-tok", "POST", `/review/${pending.oppId}`, { decision: "approve", revision: pending.revision });
    expect(approval.status).toBe(409);
    expect(await approval.json()).toMatchObject({ reason: "public_event_changed" });
    expect(await sql`select id from network.messages where opportunity_id = ${pending.oppId}`).toHaveLength(0);

    // A fresh review cannot ignore a member's change to their event-format preference.
    clock.set(START + 90 * MINUTE);
    expect(await s.tick()).toBe(true);
    const preferenceReview = await eventInReview();
    expect(preferenceReview?.oppId).toBeDefined();
    expect(preferenceReview.oppId).not.toBe(pending.oppId);
    await sql`update network.members set prefs = jsonb_set(prefs, '{formats}', '["one_to_one"]') where id = 'b'`;
    const preferenceApproval = await staff(s, "rev-tok", "POST", `/review/${preferenceReview.oppId}`, { decision: "approve", revision: preferenceReview.revision });
    expect(preferenceApproval.status).toBe(409);
    expect(await preferenceApproval.json()).toMatchObject({ reason: "public_event_participant_ineligible" });
    expect(await sql`select id from network.messages where opportunity_id = ${preferenceReview.oppId}`).toHaveLength(0);
    clock.advance(MINUTE);
    expect(await s.tick()).toBe(true);
    expect(await eventInReview()).toBeUndefined();

    // After the member restores their preference, a new review and two choices book the event.
    await sql`update network.members set prefs = jsonb_set(prefs, '{formats}', '["one_to_one", "small_group", "event"]') where id = 'b'`;
    clock.advance(MINUTE);
    expect(await s.tick()).toBe(true);
    const replacement = await eventInReview();
    expect(replacement).toBeDefined();
    const messages = () => sql<{ member_id: string; body: string; type: string; status: string }[]>`select member_id, body, type, status
      from network.messages where direction = 'outbound' and opportunity_id = ${replacement.oppId} order by ts, id`;
    expect(await messages()).toHaveLength(0);
    const runtime = s.runtimeFor("ntwrk")!;
    const adapter = runtime.adapter as BlooioAdapter;
    if (listingState !== "current") await adapter.lineSafety("review", "fixture");
    expect((await staff(s, "rev-tok", "POST", `/review/${replacement.oppId}`, { decision: "approve", revision: replacement.revision })).status).toBe(200);
    expect(await s.tick()).toBe(true);
    const first = (await messages()).filter(m => m.type === "probe");
    expect(first).toHaveLength(1);
    expect(first[0]!.body).toContain("Outdoor climbing");
    expect(first[0]!.body).not.toMatch(/\b(Ana|Ben)\b/);
    if (listingState !== "current") {
      const queued = async () => (await sql<{ id: string; status: string; attempts: number; next_attempt_at: Date }[]>`
        select id,status,attempts,next_attempt_at from platform.outbound where opportunity_id=${replacement.oppId}`)[0];
      const held = await queued();
      expect(held).toMatchObject({ status: "retry_scheduled", attempts: 0 });
      clock.advance(MINUTE);
      if (listingState === "moved after queuing") {
        expect(await importPublicEvents(sql, clock, async () => Response.json([{ ...fixture, starttime: "2026-10-07T19:00:00", endtime: "2026-10-07T20:00:00" }]))).toEqual({ published: true, events: 1 });
      } else {
        // spec/publicEventCatalog.md, "A queued event contact still needs the reviewed listing at final claim"
        const otherParticipant = first[0]!.member_id === "a" ? "b" : "a";
        await sql`update network.members set age = 20 where id = ${otherParticipant}`;
      }
      await adapter.lineSafety(undefined);
      clock.set(held!.next_attempt_at.getTime() + MINUTE);
      await runtime.deliver();
      expect(await queued()).toMatchObject({ status: "suppressed_ineligible", attempts: 0 });
      expect(delivered.some(request => request.idempotencyKey === `tn:${held!.id}`)).toBe(false);
      expect(await sql`select 1 from platform.person_sends where msg_id=${held!.id}`).toEqual([]);
      await s.close();
      return;
    }
    await say(s, clock, first[0]!.member_id, "A");
    expect(await s.tick()).toBe(true);
    const probes = (await messages()).filter(m => m.type === "probe");
    expect(probes.map(m => m.member_id).sort()).toEqual(["a", "b"]);
    expect((await messages()).filter(m => m.type === "proposal")).toHaveLength(0);
    await say(s, clock, probes.find(m => m.member_id !== first[0]!.member_id)!.member_id, "A");
    expect(await s.tick()).toBe(true);
    const booked = (await s.pg.load())?.opps.find(o => o.id === replacement.oppId);
    expect(booked).toMatchObject({ stage: "scheduled", meetingAt: Date.UTC(2026, 9, 7, 22), venue: "Transmitter Park" });
    const confirmations = (await messages()).filter(m => m.type === "proposal");
    const dispatchTrace = await sql`select type, payload from network.events where type in ('guard_blocked', 'send_refused', 'venue') order by id`;
    expect(confirmations.map(m => m.member_id).sort(), JSON.stringify(dispatchTrace)).toEqual(["a", "b"]);
    for (const confirmation of confirmations) {
      expect(confirmation).toMatchObject({ status: "accepted", body: expect.stringContaining("Transmitter Park") });
      expect(confirmation.body).toContain("https://www.nycgovparks.org/events/2026/10/07/fitness");
      expect(delivered).toContainEqual(expect.objectContaining({ to: phone(confirmation.member_id), text: confirmation.body }));
    }
    await s.close();
  }, T);

  test("an item past its review SLA expires unsent even when the reviewer acts before the next tick", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "sla");
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD) await say(s, clock, id, text);
    expect(await say(s, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
    const queue = await (await staff(s, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((i: any) => i.origin === "request");
    expect(item).toBeDefined();
    const oppId = item.oppId as string;

    // The SLA passes and no tick runs (one instance holds the lock, or the 60 s tick is still due).
    clock.set(item.deadline + MINUTE);
    const late = await staff(s, "rev-tok", "POST", `/review/${oppId}`, { decision: "approve", revision: item.revision });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ ok: false, reason: "review_expired" });
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBe("expired");
    // A reroll cannot give the expired item a new deadline either.
    expect(await (await staff(s, "rev-tok", "POST", `/review/${oppId}`, { decision: "reroll", revision: item.revision })).json()).toEqual({ ok: false, reason: "not_in_review" });
    // Nothing about the item reaches a member, now or after the next tick.
    expect(await s.tick()).toBe(true);
    expect((await sql`select count(*)::int as n from network.events where type = 'probe_started' and object_id = ${oppId}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.messages where opportunity_id = ${oppId}`)[0].n).toBe(0);
  }, T);

  test("a decision at exactly the review deadline expires the item, the same as the tick", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "sla-edge");
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD) await say(s, clock, id, text);
    expect(await say(s, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
    const queue = await (await staff(s, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((i: any) => i.origin === "request");
    expect(item).toBeDefined();
    const oppId = item.oppId as string;

    clock.set(item.deadline);
    const edge = await staff(s, "rev-tok", "POST", `/review/${oppId}`, { decision: "approve", revision: item.revision });
    expect(edge.status).toBe(409);
    expect(await edge.json()).toEqual({ ok: false, reason: "review_expired" });
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBe("expired");
  }, T);

  // spec/reviewDeadline.md, "A decision applies only to the revision the reviewer saw" (flow gap G6).
  test("a staff approval of the revision before a re-roll is refused as stale, contacts nobody, and keeps both audit rows", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "stale");
    expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD) await say(s, clock, id, text);
    expect(await say(s, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
    const queued = async () => (await (await staff(s, "rev-tok", "GET", "/review")).json()).items.find((i: any) => i.origin === "request");
    const seen = await queued();
    expect(seen).toMatchObject({ revision: 0 });
    const oppId = seen.oppId as string;
    clock.set(START + 90 * MINUTE); // every member's send window is open

    // A second reviewer re-rolls the item: the partner the first reviewer saw is swapped out.
    expect(await (await staff(s, "rev-tok", "POST", `/review/${encodeURIComponent(oppId)}`, { decision: "reroll", revision: 0 })).json()).toEqual({ ok: true });
    const now = await queued();
    expect(now).toMatchObject({ oppId, revision: 1 });
    expect(now.proposal.participants).not.toEqual(seen.proposal.participants);

    // The first reviewer approves what they saw (revision 0): refused, nothing changes.
    const stale = await staff(s, "rev-tok", "POST", `/review/${encodeURIComponent(oppId)}`, { decision: "approve", revision: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ ok: false, reason: "review_stale" });
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBeNull();
    expect(await s.tick()).toBe(true);
    expect((await sql`select count(*)::int as n from network.events where type = 'probe_started' and object_id = ${oppId}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from network.messages where opportunity_id = ${oppId}`)[0].n).toBe(0);
    const audit = await sql`select ok, detail->>'phase' as phase, detail->>'decision' as decision, (detail->>'revision')::int as revision, detail->>'reason' as reason
      from network.staff_audit where action = 'review' and target_id = ${oppId} order by id`;
    expect(audit.slice(-2)).toEqual([
      { ok: true, phase: "requested", decision: "approve", revision: 0, reason: null },
      { ok: false, phase: "result", decision: "approve", revision: 0, reason: "review_stale" },
    ]);

    // An approval of the revision the queue shows now goes through.
    expect(await (await staff(s, "rev-tok", "POST", `/review/${encodeURIComponent(oppId)}`, { decision: "approve", revision: 1 })).json()).toEqual({ ok: true });
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBe("approve");
  }, T);

  test("two instances never tick at once; the second sees the lock holder and skips", async () => {
    await reset();
    const clock = new SimClock(START);
    const x = service(clock, "svc-x"), y = service(clock, "svc-y");
    let active = 0, most = 0;
    for (const s of [x, y]) {
      const orig = s.net.tick.bind(s.net);
      s.net.tick = async now => { active++; most = Math.max(most, active); await sleep(25); try { await orig(now); } finally { active--; } };
    }
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) { clock.advance(MINUTE); results.push(...await Promise.all([x.tick(), y.tick()])); }
    expect(most).toBe(1);
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(results.some(r => !r)).toBe(true);
    // While x holds the lock (an inbound message or staff action), y's tick does nothing and /health names x.
    let release!: () => void;
    const held = x.pg.withLock(() => new Promise<void>(r => (release = r)));
    await sleep(50);
    expect(await y.tick()).toBe(false);
    expect((await y.health()).lockHolder?.application).toBe("network-service:svc-x");
    release(); await held;
    expect(await y.tick()).toBe(true);
  }, T);

  test("Blooio adapter: with no live flag set the provider gets the message through the queue (owner decision 2026-11-22)", async () => {
    const run = async (env: Record<string, string | undefined>, more?: (s: NetworkService, clock: SimClock) => Promise<void>) => {
      await reset();
      const clock = new SimClock(START);
      const sent: SendRequest[] = [];
      const provider = { kind: "blooio" as const, send: async (r: SendRequest) => { sent.push(r); return { providerMessageId: `p${sent.length}`, status: "queued" as const }; } };
      const s = service(clock, "blooio", { adapter: (net, svc) => new BlooioAdapter({ from: "+12125550100", net, provider, clock, memberOf: svc.memberOf, env, log: () => {} }) });
      await s.start();
      await say(s, clock, "a", "hi!");
      await more?.(s, clock);
      const result = { sent, rows: await outbound("a"), health: await s.health() };
      await s.close();
      return result;
    };
    for (const env of [{}, { BLOOIO_ALLOW_SEND: "0", NTWRK_LIVE_APPROVED: "0" }]) {
      const live = await run(env);
      expect(live.sent.length).toBe(1);
      expect(live.sent[0]).toMatchObject({ to: phone("a"), text: live.rows[0].body, idempotencyKey: `tn:${live.rows[0].id}` });
      expect(live.rows[0].status).toBe("accepted");
      expect(live.health.refusals.channel).toEqual({});
    }
    // An under-13 decline: the one kind decline reaches the provider; nothing about the member is stored.
    const declined = await run({}, async (s, clock) => { await say(s, clock, "u", "hi"); await say(s, clock, "u", "I am 12 years old"); });
    expect(declined.sent.filter(r => r.to === phone("u")).length).toBe(2);
    expect((await outbound("u")).length).toBe(0);
  }, T);
});
