// The production service (packages/network/service) against the local dev Postgres, in a database
// of its own per test process (the packages/observatory/test/pg.ts pattern). Nothing is sent: the
// default adapter is dry-run, and the Blooio adapter gets a fake provider. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH, type ServiceOptions } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
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
const outbound = async (member: string) => (await sql`select id, body, status, type, opportunity_id, system from network.messages where direction = 'outbound' and member_id = ${member} order by ts, id`) as any[];

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
    // Their phone is gone too: a later text is from a stranger. The age stays on the phone's age floor,
    // so a join that now says 25 is refused (NET-35).
    expect(await say(s, clock, "u", "hello?")).toBe("join_asked");
    expect(await say(s, clock, "u", "Uma, 25")).toBe("under_age");
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
    expect(() => service(clock, "auto", { network: { review: "auto" } })).toThrow(/human/);
    // A new Network starts with matching off; an admin turns it on.
    expect((await (await staff(a, "ana-tok", "GET", "/health")).json()).matchingEnabled).toBe(false);
    expect((await staff(a, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);

    // Onboarding and a member request through the webhook; a restart in the middle.
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD.slice(0, 2)) await say(a, clock, id, text);
    await a.close();
    const b = service(clock, "second");
    for (const id of ["a", "b", "c", "r"]) for (const text of ONBOARD.slice(2)) await say(b, clock, id, text);
    for (const id of ["a", "b", "c", "r"]) {
      const bodies = (await outbound(id)).map(m => m.body);
      expect(new Set(bodies).size).toBe(bodies.length); // no welcome or question twice across the restart
    }
    expect(await say(b, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");

    const queue = await (await staff(b, "rev-tok", "GET", "/review")).json();
    const item = queue.items.find((i: any) => i.origin === "request");
    expect(item).toBeDefined();
    const oppId = item.oppId as string;
    const aboutOpp = async () => (await sql`select count(*)::int as n from network.messages where opportunity_id = ${oppId}`)[0].n;
    expect(await aboutOpp()).toBe(0); // nobody hears about it before review
    expect((await sql`select decision from network.review_items where opportunity_id = ${oppId}`)[0].decision).toBeNull();

    // An unknown decision is refused; approve works; the reviewer of record is the staff id.
    expect((await staff(b, "rev-tok", "POST", `/review/${oppId}`, { decision: "maybe" })).status).toBe(400);
    clock.set(START + 90 * MINUTE); // 14:30 New York: every member's send window is open
    const ok = await staff(b, "rev-tok", "POST", `/review/${oppId}`, { decision: "approve", secondsSpent: 40, reviewer: "someone-else" });
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
    expect(h).toMatchObject({ ok: true, channel: "dry_run", reviewMode: "human", matchingEnabled: true, lockHolder: null });
    expect(h.lastTick.thisInstance).toEqual({ at: clock.now(), ran: true });
  }, T);

  test("two instances never tick at once; the second sees the lock holder and skips", async () => {
    await reset();
    const clock = new SimClock(START);
    const x = service(clock, "svc-x"), y = service(clock, "svc-y");
    let active = 0, most = 0;
    for (const s of [x, y]) {
      const orig = s.net.tick.bind(s.net);
      s.net.tick = async now => { active++; most = Math.max(most, active); await Bun.sleep(25); try { await orig(now); } finally { active--; } };
    }
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) { clock.advance(MINUTE); results.push(...await Promise.all([x.tick(), y.tick()])); }
    expect(most).toBe(1);
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(results.some(r => !r)).toBe(true);
    // While x holds the lock (an inbound message or staff action), y's tick does nothing and /health names x.
    let release!: () => void;
    const held = x.pg.withLock(() => new Promise<void>(r => (release = r)));
    await Bun.sleep(50);
    expect(await y.tick()).toBe(false);
    expect((await y.health()).lockHolder?.application).toBe("network-service:svc-x");
    release(); await held;
    expect(await y.tick()).toBe(true);
  }, T);

  test("Blooio adapter: no send without both live flags; with both, the provider gets the message through the queue", async () => {
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
    for (const env of [{}, { BLOOIO_ALLOW_SEND: "1" }, { NTWRK_LIVE_APPROVED: "1" }, { BLOOIO_ALLOW_SEND: "0", NTWRK_LIVE_APPROVED: "1" }]) {
      const r = await run(env);
      expect(r.sent).toEqual([]);
      expect(r.rows.map(m => m.status)).toEqual(["refused_not_approved"]);
      expect(r.health.refusals.channel).toEqual({ refused_not_approved: 1 });
    }
    // Both flags (founder approval): the fake provider receives the welcome, to the member's phone, with the stored id as its key.
    const live = await run({ BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" });
    expect(live.sent.length).toBe(1);
    expect(live.sent[0]).toMatchObject({ to: phone("a"), text: live.rows[0].body, idempotencyKey: `tn:${live.rows[0].id}` });
    expect(live.rows[0].status).toBe("accepted");
    // An under-13 decline: the one kind decline reaches the provider; nothing about the member is stored.
    const declined = await run({ BLOOIO_ALLOW_SEND: "1", NTWRK_LIVE_APPROVED: "1" }, async (s, clock) => { await say(s, clock, "u", "hi"); await say(s, clock, "u", "I am 12 years old"); });
    expect(declined.sent.filter(r => r.to === phone("u")).length).toBe(2);
    expect((await outbound("u")).length).toBe(0);
  }, T);
});
