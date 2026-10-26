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

  test("a missing title can be answered directly after restart, then read back and confirmed", async () => {
    await svc?.close();
    const clock = new SimClock(START + 3 * 24 * 60 * MINUTE);
    let s = svc = service(clock);
    await s.start();
    const rows = [
      { phone: "+12125550181", answer: "Data analyst", title: "data analyst" },
      { phone: "+12125550182", answer: "Senior data analyst", title: "senior data analyst" },
      { phone: "+12125550183", answer: "C++ developer", title: "c++ developer" },
      { phone: "+12125550184", answer: "title: Data analyst", title: "data analyst" },
    ];
    const start = "Job posting: 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL";
    const managers: string[] = [];
    for (const row of rows) {
      await text(s, clock, row.phone, "peon");
      await text(s, clock, row.phone, "Taylor, 34");
      const manager = (await memberId(row.phone))!;
      managers.push(manager);
      await text(s, clock, row.phone, start);
      expect(await last(manager)).toBe(POSTING_COPY.askTitle);
      expect(await postings(manager)).toHaveLength(0);
    }
    await s.close();
    s = svc = service(clock);
    await s.start();
    const observations: { answer: string; readBack: boolean; saved: boolean }[] = [];
    for (const [i, row] of rows.entries()) {
      const manager = managers[i]!;
      await text(s, clock, row.phone, row.answer);
      const readBack = (await last(manager)).toLowerCase().startsWith(`here's your job post: ${row.title}, 2 openings, $90k-$120k a year, hybrid in brooklyn.`);
      expect(await postings(manager)).toHaveLength(0);
      if (readBack) expect(await last(manager)).toContain("Must-haves: sql. Reply yes to post it");
      await text(s, clock, row.phone, "yes");
      const saved = await postings(manager);
      observations.push({ answer: row.answer, readBack, saved: saved.length === 1 && saved[0].objective === `Hire: ${row.title}` });
    }
    // Read persisted rows after a second service restart, not just the in-memory draft.
    await s.close();
    s = svc = service(clock);
    await s.start();
    for (const [i, row] of rows.entries()) {
      const saved = await postings(managers[i]!);
      if (!observations[i]!.saved) { expect(saved).toHaveLength(0); continue; }
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ objective: `Hire: ${row.title}`, status: "active" });
      const snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
      const tags = snap.facets.filter(f => f.memberId === `job:${saved[0].id}`).flatMap(f => f.tags);
      for (const tag of ["peon:openings:2", "peon:pay:90-120", "peon:mode:hybrid", "peon:area:brooklyn", "peon:must:sql:2"]) expect(tags).toContain(tag);
      if (row.title.startsWith("senior")) expect(tags).toContain("peon:seniority:3");
    }
    // The fallback is only an answer to the title question. Non-answers and other field replies
    // must not become titles, and a bare title without an intake must not start a posting.
    const phone = "+12125550185";
    await text(s, clock, phone, "peon");
    await text(s, clock, phone, "Casey, 34");
    const manager = (await memberId(phone))!;
    await text(s, clock, phone, "Data analyst");
    expect(await postings(manager)).toHaveLength(0);
    expect(await last(manager)).not.toMatch(/Here's your job post:/);
    for (const [i, answer] of ["yes", "no", "not sure", "How does this work?", "$100k-$140k", "hybrid"].entries()) {
      const controlPhone = `+121255501${86 + i}`;
      await text(s, clock, controlPhone, "peon");
      await text(s, clock, controlPhone, "Jordan, 34");
      const controlManager = (await memberId(controlPhone))!;
      await text(s, clock, controlPhone, start);
      expect(await last(controlManager)).toBe(POSTING_COPY.askTitle);
      await text(s, clock, controlPhone, answer);
      expect(await last(controlManager)).not.toMatch(/Here's your job post:/);
      expect(await postings(controlManager)).toHaveLength(0);
    }
    await s.close();
    svc = undefined;
    console.log(`  title answers: ${JSON.stringify(observations)}`);
    expect(observations.every(x => x.readBack && x.saved)).toBe(true);
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
