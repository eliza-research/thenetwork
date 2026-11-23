import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { REVIEW_JUDGE_PROMPT_VERSION, SIM_REVIEW_JUDGE, type ReviewJudge, type ReviewJudgeReply } from "../../engine/src/reviewJudge.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const DB = `review_exception_queue_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const s = new SQL({ url: ADMIN_URL, max: 1 }); try { await s.unsafe("set lock_timeout = '5s'"); await s.unsafe(q); } finally { await s.close(); } }

const SECRET = "whsec_review_exception_queue";
const TOKENS = "admin:adm-tok,reviewer:rev-tok,safety:saf-tok,analyst:ana-tok";
const CLIMB = "find a regular climbing partner";
const PEOPLE = [
  { id: "a", name: "Ana Diaz", age: 30, wants: true }, { id: "b", name: "Ben Ito", age: 31, wants: true }, { id: "c", name: "Cy Moss", age: 29, wants: true },
  { id: "r", name: "Rae Kim", age: 33, wants: false },
];
const ONBOARD = ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."];
const FLAG_EXPLANATION = "P2 gives no reason that fits a climbing partner for P1.";
const APPROVE_EXPLANATION = "P1 and P2 both climb near Greenpoint and every text is kind.";
const phone = (id: string) => `+1212556${String(100 + PEOPLE.findIndex(p => p.id === id)).padStart(4, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];

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

function fixtureJudge(verdict: "approve" | "flag"): ReviewJudge & { calls: number } {
  const reply: ReviewJudgeReply = verdict === "approve"
    ? { verdict: "approve", reason: "none", explanation: APPROVE_EXPLANATION, model: "fixture", promptVersion: REVIEW_JUDGE_PROMPT_VERSION }
    : { verdict: "flag", reason: "weak_fit", explanation: FLAG_EXPLANATION, model: "fixture", promptVersion: REVIEW_JUDGE_PROMPT_VERSION };
  const judge = { reviewer: SIM_REVIEW_JUDGE, calls: 0, async judge() { judge.calls++; return reply; } };
  return judge;
}

function service(clock: SimClock, instance: string, reviewJudge: ReviewJudge | null) {
  const s = new NetworkService({ url: URL_, clock, instance, tokens: TOKENS, webhookSecret: SECRET, network: { seed: 1 }, env: { PLATFORM_ENV: "dev" }, reviewJudge, log: () => {} });
  open.push(s);
  return s;
}

let evt = 0;
async function say(s: NetworkService, clock: SimClock, id: string, text: string) {
  const n = ++evt;
  const body = JSON.stringify({ id: `evt_rq_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_rq_${n}`, sender: phone(id), chat_id: phone(id), text, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, body, Math.floor(clock.now() / 1000)) }, body }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const staff = (s: NetworkService, token: string, method: string, path: string, body?: unknown) =>
  s.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
const aboutOpp = async (oppId: string) => (await sql`select member_id, type from network.messages where direction = 'outbound' and opportunity_id = ${oppId} order by ts, id`) as { member_id: string; type: string }[];
const reads = async (action: string) => (await sql`select actor, target_id from network.staff_audit where action = ${action} order by id`) as { actor: string; target_id: string | null }[];

async function requestedItem(s: NetworkService, clock: SimClock): Promise<{ oppId: string; revision: number }> {
  expect((await staff(s, "adm-tok", "POST", "/matching", { on: true })).status).toBe(200);
  for (const id of PEOPLE.map(p => p.id)) for (const text of ONBOARD) await say(s, clock, id, text);
  expect(await say(s, clock, "r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.")).toBe("handled");
  const [row] = await sql`select o.id, i.rerolls from network.opportunities o join network.review_items i on i.app_id = o.app_id and i.opportunity_id = o.id
    where o.app_id = 'ntwrk' and i.decision is null order by i.queued_at desc limit 1` as { id: string; rerolls: number }[];
  expect(row).toBeDefined();
  return { oppId: row!.id, revision: row!.rerolls };
}

describe.skipIf(!pgAvailable)("staff exception queue of the automated review (owner decision 2026-11-22, D15 to D17)", () => {
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

  test("a flagged item is in GET /review with its explanation; the judged reads list it; staff approve it; an analyst reads nothing", async () => {
    await reset();
    const clock = new SimClock(START);
    const judge = fixtureJudge("flag");
    const s = service(clock, "flagged", judge);
    const item = await requestedItem(s, clock);
    clock.set(START + 90 * MINUTE);

    const early = await staff(s, "rev-tok", "POST", `/review/${item.oppId}`, { decision: "approve", revision: item.revision });
    expect([early.status, await early.json()]).toEqual([409, { ok: false, reason: "not_held_for_staff" }]);
    expect((await (await staff(s, "rev-tok", "GET", "/review")).json()).items).toEqual([]);

    await s.reviewJudgeTick();
    expect(judge.calls).toBe(1);
    const queue = await (await staff(s, "rev-tok", "GET", "/review")).json();
    expect(queue.items.map((i: any) => i.oppId)).toEqual([item.oppId]);
    expect(queue.items[0].exception).toEqual({ verdict: "flag", reason: "weak_fit", rubric: "adult", at: expect.any(Number), revision: item.revision, explanation: FLAG_EXPLANATION });
    expect(await aboutOpp(item.oppId)).toEqual([]);

    const judged = await (await staff(s, "saf-tok", "GET", "/review/judged")).json();
    expect(judged.items).toEqual([{ oppId: item.oppId, revision: item.revision, verdict: "flag", reason: "weak_fit", rubric: "adult", decidedAt: clock.now(),
      model: "fixture", promptVersion: REVIEW_JUDGE_PROMPT_VERSION, approver: null, decision: null, stage: expect.any(String) }]);
    expect(JSON.stringify(judged)).not.toContain(FLAG_EXPLANATION);
    const one = await (await staff(s, "rev-tok", "GET", `/review/judged/${item.oppId}/${item.revision}`)).json();
    expect(one.items).toHaveLength(1);
    expect(one.items[0]).toMatchObject({ oppId: item.oppId, revision: item.revision, verdict: "flag", explanation: FLAG_EXPLANATION, packet: { oppId: item.oppId, revision: item.revision, rubric: "adult" } });
    expect(JSON.stringify(one.items[0].packet)).not.toContain("Ana Diaz");
    expect((await staff(s, "rev-tok", "GET", `/review/judged/${item.oppId}/${item.revision + 1}`)).status).toBe(404);
    expect((await staff(s, "rev-tok", "GET", "/review/judged?since=yesterday")).status).toBe(400);

    for (const path of ["/review", "/review/judged", `/review/judged/${item.oppId}/${item.revision}`]) {
      expect([path, (await staff(s, "ana-tok", "GET", path)).status]).toEqual([path, 403]);
    }
    expect((await reads("read_review_queue")).length).toBe(2);
    expect((await reads("read_review_judged")).map(r => r.actor)).toEqual([expect.stringMatching(/^token:safety#/)]);
    expect((await reads("read_review_judgment")).map(r => [r.actor, r.target_id])).toEqual([
      [expect.stringMatching(/^token:reviewer#/), item.oppId], [expect.stringMatching(/^token:reviewer#/), item.oppId]]);

    const ok = await staff(s, "rev-tok", "POST", `/review/${item.oppId}`, { decision: "approve", revision: item.revision });
    expect([ok.status, await ok.json()]).toEqual([200, { ok: true }]);
    expect((await sql`select decision, approver, exception_reason, judge_verdict from network.review_items where opportunity_id = ${item.oppId}`)[0])
      .toEqual({ decision: "approve", approver: "staff", exception_reason: null, judge_verdict: "flag" });
    expect((await (await staff(s, "rev-tok", "GET", "/review")).json()).items).toEqual([]);
    expect(await s.tick()).toBe(true);
    expect((await aboutOpp(item.oppId)).length).toBeGreaterThan(0);
  }, T);

  test("a judge-approved item is not in GET /review; staff cannot approve it again; a stop after the first probe ends it before the reveal", async () => {
    await reset();
    const clock = new SimClock(START);
    const s = service(clock, "approved", fixtureJudge("approve"));
    const item = await requestedItem(s, clock);
    clock.set(START + 90 * MINUTE);
    await s.reviewJudgeTick();

    expect((await (await staff(s, "rev-tok", "GET", "/review")).json()).items).toEqual([]);
    const judged = await (await staff(s, "rev-tok", "GET", "/review/judged")).json();
    expect(judged.items).toEqual([{ oppId: item.oppId, revision: item.revision, verdict: "approve", reason: "none", rubric: "adult", decidedAt: clock.now(),
      model: "fixture", promptVersion: REVIEW_JUDGE_PROMPT_VERSION, approver: "judge", decision: "approve", stage: expect.any(String) }]);
    expect(JSON.stringify(judged)).not.toContain(APPROVE_EXPLANATION);
    const again = await staff(s, "rev-tok", "POST", `/review/${item.oppId}`, { decision: "approve", revision: item.revision });
    expect([again.status, await again.json()]).toEqual([409, { ok: false, reason: "not_in_review" }]);

    expect(await s.tick()).toBe(true);
    const first = await aboutOpp(item.oppId);
    expect(first.length).toBeGreaterThan(0);
    expect(first.some(m => m.type === "proposal")).toBe(false);
    expect((await staff(s, "ana-tok", "POST", `/review/${item.oppId}/stop`, { revision: item.revision })).status).toBe(403);
    expect((await staff(s, "rev-tok", "POST", `/review/${item.oppId}/stop`, {})).status).toBe(400);
    const stale = await staff(s, "rev-tok", "POST", `/review/${item.oppId}/stop`, { revision: item.revision + 1 });
    expect([stale.status, await stale.json()]).toEqual([409, { ok: false, reason: "review_stale" }]);
    const stop = await staff(s, "saf-tok", "POST", `/review/${item.oppId}/stop`, { revision: item.revision });
    expect([stop.status, await stop.json()]).toEqual([200, { ok: true }]);
    const audit = await sql`select actor, ok, detail->>'phase' as phase from network.staff_audit where action = 'review_stop' order by id`;
    expect(audit.map((r: any) => [r.phase, r.ok])).toEqual([["requested", true], ["result", false], ["requested", true], ["result", true]]);
    expect((await sql`select count(*)::int as n from network.events where type = 'review_stopped' and object_id = ${item.oppId}`)[0].n).toBe(1);

    const probed = first.filter(m => m.type === "probe").map(m => m.member_id);
    expect(probed.length).toBeGreaterThan(0);
    expect(probed).not.toContain("r");
    const stopped = (await aboutOpp(item.oppId)).length;
    clock.advance(10 * MINUTE);
    await say(s, clock, probed[0]!, "Yes, I'd love that!");
    clock.advance(HOUR);
    expect(await s.tick()).toBe(true);
    const after = (await aboutOpp(item.oppId)).slice(stopped);
    expect(after.filter(m => m.type === "probe" || m.type === "proposal")).toEqual([]);
    expect((await aboutOpp(item.oppId)).filter(m => m.member_id === "r" && m.type === "proposal")).toEqual([]);
    expect((await sql`select state from network.opportunities where app_id = 'ntwrk' and id = ${item.oppId}`)).toEqual([{ state: "SKIPPED" }]);
    const late = await staff(s, "rev-tok", "POST", `/review/${item.oppId}/stop`, { revision: item.revision });
    expect([late.status, await late.json()]).toEqual([409, { ok: false, reason: "not_stoppable" }]);
  }, T);

  test("staff may reject an item that waits for the judge, and nobody hears about it", async () => {
    await reset();
    const clock = new SimClock(START);
    const judge = fixtureJudge("approve");
    const s = service(clock, "awaiting", judge);
    const item = await requestedItem(s, clock);
    const approve = await staff(s, "rev-tok", "POST", `/review/${item.oppId}`, { decision: "approve", revision: item.revision });
    expect([approve.status, await approve.json()]).toEqual([409, { ok: false, reason: "not_held_for_staff" }]);
    const reject = await staff(s, "rev-tok", "POST", `/review/${item.oppId}`, { decision: "reject", reason: "weak_reason", revision: item.revision });
    expect([reject.status, await reject.json()]).toEqual([200, { ok: true }]);
    await s.reviewJudgeTick();
    expect(judge.calls).toBe(0);
    clock.set(START + 90 * MINUTE);
    expect(await s.tick()).toBe(true);
    expect(await aboutOpp(item.oppId)).toEqual([]);
    expect((await sql`select decision, approver from network.review_items where opportunity_id = ${item.oppId}`)[0]).toEqual({ decision: "reject", approver: "staff" });
  }, T);
});
