// The backend's line in the queue dry run (line.ts): the real NetworkService and one shared OutboundQueue
// for every app, against a recording fake provider, on a database of its own, with a fake clock. Nothing is
// sent anywhere: the provider only records. Signed webhooks go in through svc.fetch as Blooio would send them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { DAY, SimClock } from "../../packages/core/src/clock.ts";
import { signBlooioPayload } from "../../packages/blooio/src/blooio/webhook.ts";
import { APPS, type AppId } from "../../packages/platform/src/apps.ts";
import type { Membership } from "../../packages/platform/src/store.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { DEV_PG_PORT, devPgUp } from "../../packages/observatory/db/dev-pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";
import { pgAvailable } from "../../packages/observatory/test/pg.ts";
import { loadConfig } from "./backend.ts";
import { lineChannel, type LineChannel } from "./line.ts";

const SECRET = "whsec_queue_test";
const ADMIN_TOKEN = "tok-admin-queue-test-0123456789";
const DB = "network_test_messaging_backend";
const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
// Noon in New York: outside quiet hours.
const NOON = Date.UTC(2026, 9, 8, 16);
// slop and ntwrk may send in this dry run; peon and friends are not open.
const ENV = { PLATFORM_ENV: "dev", QUEUE_DRY_RUN_APPS: "ntwrk,slop" };

let svc: NetworkService;
let ch: LineChannel;
let clock: SimClock;
let n = 0;

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

/** A text from `from`, signed as Blooio signs it. */
async function text(from: string, body: string) {
  const id = `m_${++n}`;
  const raw = JSON.stringify({ id: `evt_${id}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), data: { message_id: id, sender: from, text: body, protocol: "imessage" } });
  const res = await svc.fetch(new Request("http://backend.test/webhooks/blooio", {
    method: "POST", body: raw, headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) },
  }));
  const j = await res.json() as { ok: boolean; result?: string };
  expect(j.ok).toBe(true);
  return j.result;
}

const sent = () => ch.recorded!.sent;
const sentTo = (to: string) => sent().filter(s => s.to === to).map(s => s.text);
const records = () => [...ch.line!.queue.records.values()];

/**
 * A member of an app made directly (as a web join would), who never texted the line. `welcome`: the web
 * join's welcome (an agent-started text to someone who never wrote: a new conversation on the line).
 */
async function member(app: AppId, e164: string, name: string, o: { welcome?: boolean } = {}): Promise<string> {
  const person = (await svc.accounts.personFor(e164)) ?? (await svc.accounts.createPerson(e164, "inbound_message", 30));
  const m: Membership = { app, personId: person.id, memberId: `${app}_${randomUUID()}`, state: "active", review: null, firstName: name, profile: {}, joinedAt: clock.now(), leftAt: null };
  await svc.people.putMembership(m);
  const rt = svc.runtimeFor(app)!;
  await svc.createMember(rt, m, { age: 30, firstName: name });
  if (o.welcome) await rt.unitOfWork(net => { net.welcomeJoined(m.memberId); });
  return m.memberId;
}

const staff = (path: string, init: RequestInit = {}) =>
  svc.fetch(new Request(`http://staff.test${path}`, { ...init, headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } }));

describe.skipIf(!pgAvailable)("the line in the queue dry run (one queue, every app)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await migrate(URL_, { lockTimeout: "5s" });
    clock = new SimClock(NOON);
    const c = loadConfig({ ...ENV, DATABASE_URL: URL_ });
    expect(c.channel).toBe("queue-dry-run");
    ch = lineChannel(c, { clock, env: ENV, log: () => {}, queue: { newChatsPerLinePerDay: 1 } });
    svc = await NetworkService.fromDatabase({
      url: URL_, clock, env: ENV, instance: "queue-test", tokens: `admin:${ADMIN_TOKEN}`, webhookSecret: SECRET,
      adapter: ch.adapter, notify: false, log: () => {},
    });
    await ch.start(() => svc.sql);
    await svc.start();
  }, 120_000);

  afterAll(async () => {
    await svc?.close().catch(() => {});
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("every app's runtime shares one queue", () => {
    const lines = new Set([...svc.runtimes.values()].map(rt => rt.adapter.shared));
    expect(lines.size).toBe(1);
    expect([...lines][0]).toBe(ch.line);
    expect(svc.runtimeFor("slop")!.adapter.name).toBe("queue_dry_run");
  });

  test("a new texter's keyword join: the join question and the welcome go as replies, not suppressed and not new chats", async () => {
    const SAM = "+12125550142";
    expect(await text(SAM, "slop")).toBe("join_asked");
    expect(sentTo(SAM).length).toBe(1);
    expect(await text(SAM, "Sam, 29")).toBe("joined");
    const mine = records().filter(r => r.to === SAM);
    const welcome = mine.filter(r => r.kind === "reply");
    expect(welcome.length).toBeGreaterThan(0);
    for (const r of welcome) expect(r.status).toBe("accepted");
    expect(mine.filter(r => r.status.startsWith("suppressed"))).toEqual([]);
    expect(sentTo(SAM).length).toBe(1 + welcome.length);
    // Nothing to Sam counted as a brand-new conversation on the line.
    expect(ch.line!.queue.newChats(ch.line!.from!)).toBe(0);
    // The stored status of the welcome follows the queue (network.messages).
    const rows = await svc.sql`select status from network.messages where app_id = 'slop' and direction = 'outbound'`;
    expect(rows.map((r: any) => r.status)).toContain("accepted");
  });

  test("a keyword of an app that is not live gets 'not open yet'; nothing is stored", async () => {
    const PAT = "+12125550150";
    expect(await text(PAT, "peon.biz")).toBe("not_open");
    expect(sentTo(PAT)).toEqual([expect.stringContaining("isn't open yet")]);
    expect(await svc.accounts.personFor(PAT)).toBeUndefined();
    // Once a day per number.
    expect(await text(PAT, "peon")).toBe("not_open");
    expect(sentTo(PAT).length).toBe(1);
  });

  test("HELP and STOP confirmations go out for a member of an app that is not live", async () => {
    const ROB = "+12125550151";
    await member("peon", ROB, "Rob");
    expect(await text(ROB, "HELP")).toBe("handled");
    expect(sentTo(ROB)).toContain(APPS.peon.brand.help);
    expect(await text(ROB, "STOP")).toBe("handled");
    expect(sentTo(ROB)).toContain(APPS.peon.brand.stop);
    // Nothing else of peon's went out: it is not live.
    expect(sentTo(ROB).length).toBe(2);
  });

  test("an inbound engages held messages for every app", async () => {
    const KIM = "+12125550170";
    const k1 = await member("ntwrk", KIM, "Kim");
    const k2 = await member("slop", KIM, "Kim");
    const nrt = svc.runtimeFor("ntwrk")!, srt = svc.runtimeFor("slop")!;
    // Kim writes to each app once (each app's Network now knows Kim, and the answers are replies).
    await text(KIM, "ntwrk.party");
    await text(KIM, "slop.date");
    expect(records().filter(r => r.to === KIM).every(r => r.kind === "reply" && r.status === "accepted")).toBe(true);
    await nrt.unitOfWork(() => nrt.system(k1 as never, "kim:1", "First note.", "transactional", "info"));
    await nrt.unitOfWork(() => nrt.system(k1 as never, "kim:2", "Second note.", "transactional", "info"));
    await nrt.unitOfWork(() => nrt.system(k1 as never, "kim:3", "Third note.", "transactional", "info"));
    await srt.unitOfWork(() => srt.system(k2 as never, "kim:slop", "A slop note.", "transactional", "info"));
    const q = ch.line!.queue;
    // At most one unanswered before an interruption (PRD 41.4): the later ones wait for Kim, whichever app sent them.
    expect([q.get("kim:3")!.status, q.get("kim:slop")!.status]).toEqual(["held_awaiting_reply", "held_awaiting_reply"]);
    // Kim writes to one app; both apps' held messages are released.
    await text(KIM, "sounds good");
    for (const k of ["kim:3", "kim:slop"]) expect(q.get(k)!.history.some(h => h.note === "recipient engaged")).toBe(true);
    await svc.tick();
    expect(sentTo(KIM).filter(t => /note/.test(t)).length).toBeGreaterThan(0);
  });

  test("leak review: staff list a parked message and release it; the alert is a queue_alert event", async () => {
    const LEE = "+12125550180";
    const id = await member("ntwrk", LEE, "Lee");
    await text(LEE, "ntwrk.party");
    const before = sentTo(LEE).length;
    const rt = svc.runtimeFor("ntwrk")!;
    // A reply to Lee that carries a phone number: the leak guard parks it right before the send.
    await rt.unitOfWork(() => rt.system(id as never, "leak:1", "Call Dana at 212-555-0199 tonight.", "reply", "info"));
    expect(ch.line!.queue.get("leak:1")!.status).toBe("parked_leak_review");
    const list = await (await staff("/apps/ntwrk/queue/leak-review")).json() as any;
    expect(list.items.map((i: any) => [i.id, i.kind, i.to.includes("5550180")])).toEqual([["leak:1", "reply", false]]);
    expect(list.items[0].reasons.length).toBeGreaterThan(0);
    // Another app's list does not show it.
    expect((await (await staff("/apps/slop/queue/leak-review")).json() as any).items).toEqual([]);
    expect((await staff("/apps/ntwrk/queue/leak-review/leak%3A1", { method: "POST", body: JSON.stringify({ decision: "release" }) })).status).toBe(400);
    const res = await staff("/apps/ntwrk/queue/leak-review/leak%3A1", { method: "POST", body: JSON.stringify({ decision: "release", reason: "a public business number" }) });
    expect(res.status).toBe(200);
    expect(ch.line!.queue.get("leak:1")!.status).toBe("accepted");
    expect(sentTo(LEE).slice(before)).toEqual(["Call Dana at 212-555-0199 tonight."]);
    const [row] = await svc.sql`select status from network.messages where app_id = 'ntwrk' and id = 'leak:1'`;
    expect(row.status).toBe("accepted");
    // Not parked any more: a second decision is refused.
    expect((await staff("/apps/ntwrk/queue/leak-review/leak%3A1", { method: "POST", body: JSON.stringify({ decision: "drop", reason: "changed my mind" }) })).status).toBe(409);
    const audit = await svc.sql`select action, detail from network.staff_audit where action in ('leak_review', 'read_leak_review') order by id`;
    expect(audit.map((r: any) => r.action)).toEqual(["read_leak_review", "read_leak_review", "leak_review", "leak_review", "leak_review", "leak_review"]);
    const alerts = await svc.sql`select payload from network.events where type = 'queue_alert' and app_id = 'ntwrk'`;
    const kinds = alerts.map((r: any) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload).kind);
    expect(kinds).toContain("leak_blocked");
  });

  test("two apps share one new-conversation cap on the line", async () => {
    // Two web joins on two apps: each welcome is a new conversation for the line (the cap is 1 a day here).
    const A = "+12125550160", B = "+12125550161";
    await member("ntwrk", A, "Ann", { welcome: true });
    await member("slop", B, "Bea", { welcome: true });
    const toA = records().filter(r => r.to === A), toB = records().filter(r => r.to === B);
    expect(toA.map(r => [r.app, r.status])).toEqual([["ntwrk", "accepted"]]);
    expect(toB.map(r => [r.app, r.status, r.history.at(-1)!.note])).toEqual([["slop", "retry_scheduled", "per-line new conversation cap"]]);
    expect(ch.line!.queue.newChats(ch.line!.from!)).toBe(1);
  });

  test("a safety event with no line holds the configured line; parked state and counters survive a restart", async () => {
    const raw = JSON.stringify({ id: "evt_safety_1", type: "safety.state_changed", api_version: "2026-10-01", created_at: clock.now(), data: { action: "reply_only", previous_action: "none" } });
    const res = await svc.fetch(new Request("http://backend.test/webhooks/blooio", { method: "POST", body: raw, headers: { "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) } }));
    expect((await res.json() as any).result).toBe("safety");
    expect(ch.line!.queue.lineSafety(ch.line!.from!)).toBe("reply_only");
    const alerts = await svc.sql`select payload from network.events where type = 'queue_alert'`;
    const safety = alerts.map((r: any) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload)).filter((p: any) => p.kind === "line_safety");
    expect(safety.map((p: any) => [p.line, p.detail.action, p.detail.type])).toEqual([[ch.line!.from, "reply_only", "safety.state_changed"]]);
    // A second line built on the same database (a restart) loads the same state.
    const again = lineChannel({ channel: "queue-dry-run" }, { clock, env: ENV, log: () => {} });
    await again.start(() => svc.sql);
    expect(again.line!.queue.lineSafety(again.line!.from!)).toBe("reply_only");
    for (const k of ["kim:1", "kim:2", "kim:3", "kim:slop", "leak:1"]) expect(again.line!.queue.get(k)?.status).toBe(ch.line!.queue.get(k)!.status);
    expect(again.line!.queue.contactState("blooio", "+12125550160")?.unanswered).toBe(1);
    expect(again.line!.queue.newChats(again.line!.from!)).toBe(1);
  });
});
