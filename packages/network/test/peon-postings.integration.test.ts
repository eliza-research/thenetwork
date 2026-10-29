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
import { POSTING_COPY, type JobPosting } from "../src/jobs.ts";
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

function service(clock: SimClock, seed = 1) {
  return new NetworkService({
    url: URL_, clock, instance: "peon-postings", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "peon:nyc" }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, network: { seed }, photoStorage: null, notify: false,
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

  test("partial text updates keep the saved post in the read-back, including across restart before confirmation", async () => {
    await svc?.close();
    const clock = new SimClock(START + 24 * 60 * MINUTE);
    let s = svc = service(clock);
    await s.start();
    const phone = "+12125550173";
    await text(s, clock, phone, "peon");
    await text(s, clock, phone, "Morgan, 34");
    const manager = (await memberId(phone))!;
    await text(s, clock, phone, "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL");
    await text(s, clock, phone, "yes");
    const [p] = await postings(manager);
    const savedTags = async () => ((await sql`select tags from network.facets where app_id = 'peon' and member_id = ${manager} and ${`peon:posting:${p.id}`} = any(tags)`) as any[]).flatMap(r => r.tags as string[]).sort();
    const original = await savedTags();
    expect(original).toContain("peon:openings:2");

    await text(s, clock, phone, "Update my data analyst post: 3 openings");
    expect(await last(manager)).toMatch(/^Here's your job post: Data analyst, 3 openings, \$90k-\$120k a year, hybrid in Brooklyn\..*Must-haves: sql.*Reply yes to post it/);
    expect(await savedTags()).toEqual(original);
    await s.close();
    s = svc = service(clock);
    await s.start();
    await text(s, clock, phone, "yes");
    expect(await last(manager)).toBe("Updated: data analyst.");
    // A confirmed save may advance its revision time; every other saved field must be preserved.
    const withoutRevisionTime = (tags: string[]) => tags.filter(t => !t.startsWith("peon:posting_updated_at:"));
    expect(withoutRevisionTime(await savedTags())).toEqual(withoutRevisionTime(original.map(t => t === "peon:openings:2" ? "peon:openings:3" : t).sort()));
    expect((await postings(manager)).map(x => x.id)).toEqual([p.id]);

    // Another partial edit and a correction retain the saved fields; a no discards both edits.
    const updated = await savedTags();
    await text(s, clock, phone, "Update my data analyst post: $100k-$140k");
    expect(await last(manager)).toMatch(/^Here's your job post: Data analyst, 3 openings, \$100k-\$140k a year, hybrid in Brooklyn\./);
    await text(s, clock, phone, "actually 4 openings");
    expect(await last(manager)).toMatch(/^Here's your job post: Data analyst, 4 openings, \$100k-\$140k a year, hybrid in Brooklyn\./);
    await text(s, clock, phone, "no");
    expect(await last(manager)).toBe(POSTING_COPY.dropped);
    expect(await savedTags()).toEqual(updated);

    // A new job still requires its own salary; the previous post is not a default for it.
    await text(s, clock, phone, "We're hiring a cashier, 1 opening");
    expect(await last(manager)).toBe(POSTING_COPY.askPay);
    expect(await postings(manager)).toHaveLength(1);

    // A title identifies the existing job; its words must not become new field values.
    const cases: { kind: string; title: string; fields?: string; change?: Partial<JobPosting>; initialMode?: JobPosting["mode"]; generic?: boolean; cancel?: boolean }[] = [
      { kind: "keep_seniority", title: "principal data analyst" },
      { kind: "keep_remote_title", title: "remote support engineer" },
      { kind: "keep_hybrid_title", title: "hybrid systems engineer" },
      { kind: "keep_area", title: "brooklyn account manager" },
      { kind: "change_seniority", title: "principal data analyst", fields: "3 openings, level 4", change: { seniority: 4 } },
      { kind: "change_mode", title: "remote support engineer", initialMode: "hybrid", fields: "3 openings, onsite in Queens", change: { mode: "onsite" } },
      { kind: "change_area", title: "brooklyn account manager", fields: "3 openings, onsite in Manhattan", change: { area: "manhattan" } },
      { kind: "generic", title: "principal data analyst", generic: true },
      { kind: "cancel", title: "remote support engineer", cancel: true },
      { kind: "plain", title: "data analyst" },
    ];
    const outcomes: { seed: number; kind: string; readBackCorrect: boolean; storedCorrect: boolean; seatCorrect: boolean; correct: boolean; stored: Partial<JobPosting>; expected: Partial<JobPosting> }[] = [];
    let index = 0;
    const call = async (method: string, path: string, body?: unknown) => {
      const routes = jobPostingRoutes({ rt: s.runtimeFor("peon")!, user: { id: "staff:test", roles: ["admin"] }, need: () => undefined, audit: async () => {}, now: () => clock.now() });
      const res = await routes(new Request(`http://127.0.0.1:4848/apps/peon${path}`, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }), path.split("?")[0]!);
      expect(res!.status).toBe(200);
      return await res!.json() as { ok: boolean; posting?: JobPosting; postings?: JobPosting[] };
    };
    const fields = (p: JobPosting) => ({ id: p.id, title: p.title, family: p.family, seniority: p.seniority, openings: p.openings, payMin: p.payMin, payMax: p.payMax, mode: p.mode, area: p.area, must: p.must, nice: p.nice, sponsors: p.sponsors, status: p.status });
    for (const seed of [7, 13, 17]) for (const c of cases) {
      await s.close(); s = svc = service(clock, seed); await s.start();
      const phone = `+121255501${String(10 + index++).padStart(2, "0")}`;
      await text(s, clock, phone, "peon"); await text(s, clock, phone, "Alex, 34");
      const owner = (await memberId(phone))!;
      const created = await call("POST", "/postings", { id: `header-${seed}-${c.kind}`, managerId: owner, title: c.title, family: "data_analyst", seniority: 2, openings: 2, payMin: 90, payMax: 120,
        mode: c.initialMode ?? "onsite", area: "queens", must: [{ skill: "sql", level: 2 }], nice: ["python"], sponsors: true });
      expect(created.ok).toBe(true);
      const original = created.posting!;
      const tags = async () => ((await sql`select tags from network.facets where app_id = 'peon' and member_id = ${owner} and ${`peon:posting:${original.id}`} = any(tags)`) as { tags: string[] }[]).flatMap(r => r.tags).sort();
      const before = await tags();
      await s.close(); s = svc = service(clock, seed); await s.start();
      await text(s, clock, phone, `Update my ${c.generic ? "job" : `${c.title} post`}: ${c.fields ?? "3 openings"}`);
      const confirmation = await last(owner);
      expect(confirmation).toStartWith("Here's your job post:");
      expect(await tags()).toEqual(before);
      const changed = { ...original, openings: 3, ...c.change };
      const place = changed.mode === "remote" ? "remote" : `${changed.mode} in ${changed.area![0]!.toUpperCase()}${changed.area!.slice(1)}`;
      const readBackCorrect = confirmation.includes(`, 3 openings, $90k-$120k a year, ${place}.`);
      await s.close(); s = svc = service(clock, seed); await s.start();
      await text(s, clock, phone, c.cancel ? "no" : "yes");
      expect(await last(owner)).toBe(c.cancel ? POSTING_COPY.dropped : `Updated: ${c.title}.`);
      if (c.cancel) expect(await tags()).toEqual(before);
      await s.close(); s = svc = service(clock, seed); await s.start();
      const listed = (await call("GET", `/postings?managerId=${encodeURIComponent(owner)}`)).postings!;
      expect(listed).toHaveLength(1);
      const expected = c.cancel ? original : changed;
      const storedCorrect = Bun.deepEquals(fields(listed[0]!), fields(expected));
      const snapshot = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
      const seatTags = snapshot.facets.filter(f => f.memberId === `job:${original.id}`).flatMap(f => f.tags);
      const seatCorrect = [`peon:openings:${expected.openings}`, `peon:seniority:${expected.seniority}`, `peon:mode:${expected.mode}`, `peon:area:${expected.area}`].every(t => seatTags.includes(t));
      outcomes.push({ seed, kind: c.kind, readBackCorrect, storedCorrect, seatCorrect, correct: readBackCorrect && storedCorrect && seatCorrect, stored: fields(listed[0]!), expected: fields(expected) });
    }
    console.log("POSTING_HEADER_OUTCOMES", JSON.stringify(outcomes));
    expect(outcomes.filter(r => r.correct).length).toBe(outcomes.length);
  }, T);
});
