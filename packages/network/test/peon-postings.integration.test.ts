// peon job postings end to end through NetworkService on Postgres (#9): a hiring manager joins peon by
// text on the shared line, posts a job by text, gets the read-back, and the posting is saved only on
// their yes (network.intents and network.facets rows, in the unit's transaction). A new service on the
// same database (a restart) sees the posting as a job seat. A 15-year-old who joins peon cannot post.
// The staff API (service/postings.ts jobPostingRoutes) verifies the employer, refuses a minor's
// posting, and closes the posting (the seat then has no opening). Postgres in a database of its own;
// dry-run sends; fictional numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { jobPostingRoutes } from "../service/postings.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { POSTING_COPY } from "../src/jobs.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_peon_postings_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_peon_postings";
const ROWAN = "+12125550171", KAI = "+12125550172";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'peon' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
const last = async (id: string) =>
  ((await sql`select body from network.messages where app_id = 'peon' and member_id = ${id} and direction = 'outbound' order by ts desc, id desc limit 1`)[0] as { body: string } | undefined)?.body ?? "";
const postings = async (id: string) => (await sql`select id, status, objective, details from network.intents where app_id = 'peon' and member_id = ${id} and details like 'peon:job%' order by id`) as any[];

function service(clock: SimClock) {
  return new NetworkService({
    url: URL_, clock, instance: "peon-postings", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: () => new DryRunAdapter(() => {}),
  });
}

describe.skipIf(!pgAvailable)("peon postings: text intake, restart, staff API (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("overlapping posting titles select the named role, but distinct mentions and duplicate titles stay ambiguous", async () => {
    await svc?.close();
    const clock = new SimClock(START + 4 * 24 * 60 * MINUTE);
    let s = svc = service(clock);
    await s.start();
    const phone = "+12125550192";
    await text(s, clock, phone, "peon");
    await text(s, clock, phone, "Alex, 34");
    const manager = (await memberId(phone))!;
    const titles = ["analyst", "data analyst", "senior data analyst", "product designer"];
    for (const title of titles) {
      await text(s, clock, phone, `We're hiring a ${title}, 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL`);
      expect(await last(manager)).toContain("Reply yes to post it");
      await text(s, clock, phone, "yes");
    }
    const stored = async () => Promise.all((await postings(manager)).map(async row => ({
      ...row,
      tags: ((await sql`select tags from network.facets where app_id = 'peon' and member_id = ${manager} and ${`peon:posting:${row.id}`} = any(tags)`) as { tags: string[] }[]).flatMap(f => f.tags).sort(),
    })));
    const original = await stored();
    expect(original).toHaveLength(4);
    const id = (title: string) => original.find(p => p.objective === `Hire: ${title}`)!.id as string;
    await s.close();
    s = svc = service(clock);
    await s.start();

    // Both orders must remain ambiguous: the short title also appears outside the longer one.
    const clarifications: { reply: string; retained: boolean; resolved: boolean }[] = [];
    const draft = () => s.runtimeFor("peon")!.net.memberList().find(m => m.id === manager)?.posting;
    for (const command of ["Close my analyst post and senior data analyst post", "Close my senior data analyst post and analyst post"]) {
      await text(s, clock, phone, command);
      expect(await last(manager)).toMatch(/^Which post should I close:/);
      expect(await stored()).toEqual(original);
      const reply = command.replace("Close my ", "");
      await text(s, clock, phone, reply);
      const retained = draft()?.close === true && draft()?.id === undefined && draft()?.ready === false && draft()?.asks === 2;
      await s.close(); s = svc = service(clock); await s.start();
      expect(await stored()).toEqual(original);
      await text(s, clock, phone, "senior data analyst");
      const resolved = draft()?.id === id("senior data analyst") && draft()?.ready === true && draft()?.asks === 2
        && (await last(manager)) === POSTING_COPY.readBackClose("senior data analyst");
      expect(await stored()).toEqual(original);
      await text(s, clock, phone, "no");
      expect(draft()).toBeUndefined();
      expect(await stored()).toEqual(original);
      clarifications.push({ reply, retained, resolved });
    }
    const observations: { operation: string; selectedAndSaved: boolean }[] = [];
    await text(s, clock, phone, "Update my senior data analyst post: 3 openings, $100k-$140k, hybrid in Brooklyn, must have SQL");
    const updateReadBack = (await last(manager)).startsWith("Here's your job post: Senior data analyst, 3 openings, $100k-$140k");
    expect(await stored()).toEqual(original);
    await text(s, clock, phone, "yes");
    const updated = await stored();
    expect(updated.filter(p => p.id !== id("senior data analyst"))).toEqual(original.filter(p => p.id !== id("senior data analyst")));
    const senior = updated.find(p => p.id === id("senior data analyst"))!;
    observations.push({ operation: "update senior", selectedAndSaved: updateReadBack && senior.tags.includes("peon:openings:3") && senior.tags.includes("peon:pay:100-140") });

    await text(s, clock, phone, "Close my senior data analyst post");
    const closeReadBack = (await last(manager)) === POSTING_COPY.readBackClose("senior data analyst");
    expect(await stored()).toEqual(updated);
    await text(s, clock, phone, "yes");
    const closed = await stored();
    expect(closed.filter(p => p.id !== id("senior data analyst"))).toEqual(updated.filter(p => p.id !== id("senior data analyst")));
    observations.push({ operation: "close senior", selectedAndSaved: closeReadBack && closed.find(p => p.id === id("senior data analyst"))!.status === "closed" });

    await text(s, clock, phone, "Close my post");
    expect(await last(manager)).toMatch(/^Which post should I close:/);
    await s.close();
    s = svc = service(clock);
    await s.start();
    await text(s, clock, phone, "data analyst");
    const answerReadBack = (await last(manager)) === POSTING_COPY.readBackClose("data analyst");
    expect(await stored()).toEqual(closed);
    await text(s, clock, phone, "yes");
    const answered = await stored();
    expect(answered.filter(p => p.id !== id("data analyst"))).toEqual(closed.filter(p => p.id !== id("data analyst")));
    observations.push({ operation: "answer which post", selectedAndSaved: answerReadBack && answered.find(p => p.id === id("data analyst"))!.status === "closed" });

    // Non-overlapping title control, then two distinct postings with the exact same title.
    await text(s, clock, phone, "Close my product designer post");
    expect(await last(manager)).toBe(POSTING_COPY.readBackClose("product designer"));
    expect(await stored()).toEqual(answered);
    await text(s, clock, phone, "yes");
    expect((await stored()).find(p => p.id === id("product designer"))!.status).toBe("closed");
    await text(s, clock, phone, "We're hiring an analyst, 1 opening, $90k-$120k, hybrid in Brooklyn, must have SQL");
    await text(s, clock, phone, "yes");
    const duplicate = await stored();
    expect(duplicate.filter(p => p.objective === "Hire: analyst" && p.status === "active")).toHaveLength(2);
    await text(s, clock, phone, "Close my analyst post");
    expect(await last(manager)).toMatch(/^Which post should I close:/);
    expect(await stored()).toEqual(duplicate);
    await text(s, clock, phone, "analyst");
    const retained = draft()?.close === true && draft()?.id === undefined && draft()?.ready === false && draft()?.asks === 2;
    await s.close(); s = svc = service(clock); await s.start();
    expect(await stored()).toEqual(duplicate);
    // The existing two-question limit still prevents an endless ambiguity loop.
    await text(s, clock, phone, "analyst");
    const resolved = draft() === undefined && (await last(manager)) === POSTING_COPY.dropped;
    expect(await stored()).toEqual(duplicate);
    clarifications.push({ reply: "duplicate title", retained, resolved });
    await s.close();
    svc = undefined;
    console.log(`  named postings: ${JSON.stringify(observations)}`);
    expect(observations.every(x => x.selectedAndSaved)).toBe(true);
    console.log(`  posting clarifications: ${JSON.stringify(clarifications)}`);
    expect(clarifications.every(x => x.retained && x.resolved)).toBe(true);
  }, T);

  test("a job post by text is read back, saved on the yes, kept across a restart, and closed by staff", async () => {
    const clock = new SimClock(START);
    let s = svc = service(clock);
    await s.start();

    // ---- Join peon by keyword, then post by text: the read-back first, nothing saved yet.
    await text(s, clock, ROWAN, "peon");
    await text(s, clock, ROWAN, "Rowan, 34");
    const rowan = (await memberId(ROWAN))!;
    expect(rowan).toBeString();
    await text(s, clock, ROWAN, "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL");
    expect(await last(rowan)).toMatch(/^Here's your job post: Data analyst, 2 openings, \$90k-\$120k a year, hybrid in Brooklyn\..*Reply yes to post it/);
    expect(await postings(rowan)).toHaveLength(0);

    // ---- The yes saves it: the intent and the facets tagged with its id, on the manager.
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toMatch(/^Posted: data analyst\./);
    const [p] = await postings(rowan);
    expect(p).toMatchObject({ status: "active", objective: "Hire: data analyst", details: "peon:job" });
    const tags = ((await sql`select tags from network.facets where app_id = 'peon' and member_id = ${rowan} and ${`peon:posting:${p.id}`} = any(tags)`) as any[]).flatMap(r => r.tags as string[]);
    for (const t of ["peon:family:data_analyst", "peon:seniority:2", "peon:pay:90-120", "peon:mode:hybrid", "peon:area:brooklyn", "peon:must:sql:2", "peon:openings:2"]) expect(tags).toContain(t);

    // ---- A 15-year-old may join peon but cannot post a job.
    await text(s, clock, KAI, "peon");
    await text(s, clock, KAI, "Kai, 15");
    const kai = (await memberId(KAI))!;
    expect(kai).toBeString();
    await text(s, clock, KAI, "We're hiring a cashier, 1 opening, $30k-$35k, onsite in Queens");
    expect(await last(kai)).toBe(POSTING_COPY.adultsOnly);
    expect(await postings(kai)).toHaveLength(0);

    // ---- A restart: a new service on the same database sees the posting as a job seat with its openings.
    await s.close();
    s = svc = service(clock);
    await s.start();
    let snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    const seat = `job:${p.id}`;
    expect(snap.members.some(m => m.id === seat)).toBe(true);
    expect(snap.facets.find(f => f.id === `${seat}:openings`)?.tags).toEqual(["peon:openings:2"]);

    // ---- The staff API: verify the employer, refuse a minor's posting, close the posting.
    const routes = jobPostingRoutes({ rt: s.runtimeFor("peon")!, user: { id: "staff:test", roles: ["admin"] }, need: () => undefined, audit: async () => {}, now: () => clock.now() });
    const call = async (method: string, path: string, b?: unknown) => {
      const res = await routes(new Request(`http://127.0.0.1:4848/apps/peon${path}`, { method, ...(b ? { headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : {}) }), path.split("?")[0]!);
      return { status: res!.status, body: await res!.json() as any };
    };
    expect((await call("POST", `/employers/${encodeURIComponent(rowan)}/verify`, { company: "Acme", note: "called the office" })).body.ok).toBe(true);
    const minor = await call("POST", "/postings", { managerId: kai, title: "cashier", openings: 1, payMin: 30, payMax: 35, mode: "onsite" });
    expect(minor).toMatchObject({ status: 409, body: { ok: false, reason: "adults_only" } });
    const listed = await call("GET", `/postings?managerId=${encodeURIComponent(rowan)}`);
    expect(listed.body.postings).toHaveLength(1);
    expect(listed.body.postings[0]).toMatchObject({ id: p.id, title: "data analyst", openings: 2, payMin: 90, payMax: 120, status: "active" });
    const closed = await call("POST", `/postings/${encodeURIComponent(p.id)}/close`, { reason: "filled" });
    expect(closed.body).toMatchObject({ ok: true, posting: { id: p.id, status: "closed" } });
    expect((await postings(rowan))[0].status).toBe("closed");
    snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    expect(snap.facets.find(f => f.id === `${seat}:openings`)?.tags).toEqual(["peon:openings:0"]);
    expect(snap.facets.filter(f => f.memberId === seat).flatMap(f => f.tags)).toContain("peon:verified");
  }, T);
});
