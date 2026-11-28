// peon job postings end to end through NetworkService on Postgres (#9): a hiring manager joins peon by
// text on the shared line, posts a job by text, gets the read-back, and the posting is saved only on
// their yes (network.intents and network.facets rows, in the unit's transaction). A new service on the
// same database (a restart) sees the posting as a job seat. A 15-year-old who joins peon cannot post.
// The staff API (service/postings.ts jobPostingRoutes, mounted by the service under /apps/peon after
// staff authentication) verifies the employer, refuses a minor's posting, and closes the posting (the
// seat then has no opening). The reader keeps a full dollar range and refused work terms, picks the named
// post when one title contains another, and a stale yes cannot reopen a job that staff closed
// (spec/postingPolicy.md). Postgres in a database of its own; dry-run sends; fictional numbers
// (+1 212 555 01xx). Nothing is sent.
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";
import { POSTING_COPY } from "../src/jobs.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
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
    tokens: "admin:adm-tok,reviewer:rev-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
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

  test("an in-person job needs its own supported worksite before posting", async () => {
    const clock = new SimClock(START);
    const s = service(clock);
    await s.start();
    try {
      const manager = "+12125550173";
      await text(s, clock, manager, "peon");
      await text(s, clock, manager, "Mina, 32");
      const id = (await memberId(manager))!;
      const request = "We're hiring a data analyst, 2 openings, $90k-$120k";
      for (const site of ["onsite", "hybrid in forest hills", "hybrid in Jersey City, but I live in Brooklyn"]) {
        await text(s, clock, manager, `${request}, ${site}`);
        expect(await last(id)).toBe(POSTING_COPY.askArea);
        expect(await postings(id)).toHaveLength(0);
      }
      await text(s, clock, manager, "yes");
      expect(await last(id)).toBe(POSTING_COPY.askArea);
      expect(await postings(id)).toHaveLength(0);
      await text(s, clock, manager, "Williamsburg");
      expect(await last(id)).toMatch(/hybrid in Williamsburg/);
      await text(s, clock, manager, "yes");
      const [job] = await postings(id);
      expect(job).toMatchObject({ status: "active", objective: "Hire: data analyst" });
      const tags = async () => (await sql`select tags from network.facets where app_id='peon' and member_id=${id} and ${`peon:posting:${job.id}`} = any(tags)`).flatMap(row => row.tags);
      expect(await tags()).toContain("peon:area:williamsburg");
      await text(s, clock, manager, "Update my data analyst post: hybrid in Newark");
      expect(await last(id)).toBe(POSTING_COPY.askArea);
      expect(await tags()).toContain("peon:area:williamsburg");
      await text(s, clock, manager, "remote");
      expect(await last(id)).toMatch(/remote/);
      await text(s, clock, manager, "yes");
      expect(await tags()).toContain("peon:mode:remote");
      expect(await tags()).not.toContain("peon:area:williamsburg");
    } finally { await s.close(); }
  }, T);

  test("a job post by text is read back, saved on the yes, kept across a restart, and closed by staff", async () => {
    const clock = new SimClock(START);
    let s = svc = service(clock);
    await s.start();

    // ---- Join peon by keyword, then post by text: the read-back first, nothing saved yet.
    await text(s, clock, ROWAN, "peon");
    await text(s, clock, ROWAN, "Rowan, 34");
    const rowan = (await memberId(ROWAN))!;
    expect(rowan).toEqual(expect.any(String));
    // spec/postingPolicy.md, "The low end of the pay range comes first": the full dollar range is kept.
    await text(s, clock, ROWAN, "We're hiring a senior data analyst, 2 openings, $90,500-$120,750, hybrid, not remote, in Brooklyn. No sponsorship available. Must have SQL level 4 and SQL level 2");
    expect(await last(rowan)).toMatch(/^Here's your job post: Senior data analyst, 2 openings, \$90\.5k-\$120\.75k a year, hybrid in Brooklyn\..*Visa sponsorship: no\..*Reply yes to post it/);
    expect(await postings(rowan)).toHaveLength(0);

    // ---- The yes saves it: the intent and the facets tagged with its id, on the manager.
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toMatch(/^Posted: senior data analyst\./);
    const [p] = await postings(rowan);
    expect(p).toMatchObject({ status: "active", objective: "Hire: senior data analyst", details: "peon:job" });
    const tags = ((await sql`select tags from network.facets where app_id = 'peon' and member_id = ${rowan} and ${`peon:posting:${p.id}`} = any(tags)`) as any[]).flatMap(r => r.tags as string[]);
    for (const t of ["peon:family:senior_data_analyst", "peon:seniority:3", "peon:pay:90.5-120.75", "peon:mode:hybrid", "peon:area:brooklyn", "peon:must:sql:4", "peon:sponsors:no", "peon:openings:2"]) expect(tags).toContain(t);
    expect(tags).not.toContain("peon:must:sql:2");

    // ---- A 15-year-old may join peon but cannot post a job.
    await text(s, clock, KAI, "peon");
    await text(s, clock, KAI, "Kai, 15");
    const kai = (await memberId(KAI))!;
    expect(kai).toEqual(expect.any(String));
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

    // ---- The staff API on the production service: authentication, roles and audit first.
    const callAs = async (token: string | undefined, method: string, path: string, b?: unknown) => {
      const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(b ? { "content-type": "application/json" } : {}) };
      const res = await s.fetch(new Request(`http://127.0.0.1/apps/peon${path}`, { method, headers, ...(b ? { body: JSON.stringify(b) } : {}) }));
      return { status: res.status, body: await res.json() as any };
    };
    const call = (method: string, path: string, b?: unknown) => callAs("adm-tok", method, path, b);
    const verifyPath = `/employers/${encodeURIComponent(rowan)}/verify`;
    expect((await callAs(undefined, "POST", verifyPath, { company: "Acme", note: "called the office" })).status).toBe(401);
    expect((await callAs("rev-tok", "POST", verifyPath, { company: "Acme", note: "called the office" })).status).toBe(403);
    const listPath = `/postings?managerId=${encodeURIComponent(rowan)}`;
    expect((await callAs(undefined, "GET", listPath)).status).toBe(401);
    expect(await callAs("rev-tok", "GET", listPath)).toMatchObject({ status: 200, body: { ok: true } });
    // ---- Verify the employer, refuse a minor's posting, close the posting.
    expect((await call("POST", verifyPath, { company: "Acme", note: "called the office" })).body.ok).toBe(true);
    const audited = await sql`select ok, detail->>'phase' as phase from network.staff_audit where app_id = 'peon' and action = 'verify_employer' and target_id = ${rowan} order by id`;
    expect(audited).toEqual([{ ok: true, phase: "requested" }, { ok: true, phase: "result" }]);
    const minor = await call("POST", "/postings", { managerId: kai, title: "cashier", openings: 1, payMin: 30, payMax: 35, mode: "onsite", area: "queens" });
    expect(minor).toMatchObject({ status: 409, body: { ok: false, reason: "adults_only" } });
    const listed = await call("GET", `/postings?managerId=${encodeURIComponent(rowan)}`);
    expect(listed.body.postings).toHaveLength(1);
    expect(listed.body.postings[0]).toMatchObject({ id: p.id, title: "senior data analyst", openings: 2, payMin: 90.5, payMax: 120.75, mode: "hybrid", sponsors: false, status: "active" });
    const closed = await call("POST", `/postings/${encodeURIComponent(p.id)}/close`, { reason: "filled" });
    expect(closed).toMatchObject({ status: 200, body: { ok: true, posting: { id: p.id, status: "closed" } } });
    expect((await postings(rowan))[0].status).toBe("closed");
    snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    expect(snap.facets.find(f => f.id === `${seat}:openings`)?.tags).toEqual(["peon:openings:0"]);
    expect(snap.facets.filter(f => f.memberId === seat).flatMap(f => f.tags)).toContain("peon:verified");
    // A closed row keeps its headcount, close reason and change time; a staff reopen restores the openings.
    const closedRead = await call("GET", `/postings?managerId=${encodeURIComponent(rowan)}`);
    expect(closedRead.body.postings[0]).toMatchObject({ status: "closed", closedReason: "filled", openings: 2, updatedAt: clock.now() });
    clock.advance(MINUTE);
    const reopened = await call("POST", "/postings", { id: p.id, managerId: rowan });
    expect(reopened.body.posting).toMatchObject({ status: "active", openings: 2, updatedAt: clock.now() });
    expect(reopened.body.posting.closedReason).toBeUndefined();
    snap = await loadSnapshot(sql, clock.now(), { app: "peon", city: "nyc" });
    expect(snap.facets.find(f => f.id === `${seat}:openings`)?.tags).toEqual(["peon:openings:2"]);

    // ---- A direct title answer completes a draft. A new posting command starts its own question count.
    await text(s, clock, ROWAN, "We're hiring a coordinator");
    expect(await last(rowan)).toBe(POSTING_COPY.askPay);
    await text(s, clock, ROWAN, "Title: office coordinator");
    expect(await last(rowan)).toBe(POSTING_COPY.askPay);
    await text(s, clock, ROWAN, "Job posting: $65k-$75k");
    expect(await last(rowan)).toBe(POSTING_COPY.askTitle);
    // An unrelated request while the title question waits is not a title: the draft ends and the turn goes on to normal handling.
    await text(s, clock, ROWAN, "can you find me a cofounder");
    expect(await last(rowan)).not.toMatch(/Here's your job post|cofounder, 1 opening/i);
    await text(s, clock, ROWAN, "Job posting: $65k-$75k");
    expect(await last(rowan)).toBe(POSTING_COPY.askTitle);
    await text(s, clock, ROWAN, "Data analyst");
    expect(await last(rowan)).toBe(POSTING_COPY.askArea);
    await text(s, clock, ROWAN, "Brooklyn");
    expect(await last(rowan)).toMatch(/Data analyst, 1 opening, \$65k-\$75k/);
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toMatch(/^Posted: data analyst\./);

    // ---- Choosing a post keeps the edits, and "data analyst" inside "senior data analyst" is one post.
    await text(s, clock, ROWAN, "Update my job post: 3 openings");
    expect(await last(rowan)).toContain("Which post should I update");
    await text(s, clock, ROWAN, "Senior data analyst");
    expect(await last(rowan)).toMatch(/Senior data analyst, 3 openings, \$90\.5k-\$120\.75k/);

    // ---- spec/postingPolicy.md, "Confirm only the posting shown in the read-back": a yes with a correction gets a new read-back.
    await text(s, clock, ROWAN, "Yes, 4 openings");
    expect(await last(rowan)).toMatch(/Senior data analyst, 4 openings, \$90\.5k-\$120\.75k/);
    const openingsOf = async () => (await call("GET", `/postings?managerId=${encodeURIComponent(rowan)}`)).body.postings.find((x: { id: string }) => x.id === p.id);
    expect((await openingsOf()).openings).toBe(2);
    // ---- spec/postingPolicy.md, "A stale yes never reopens or overwrites a posting that staff changed or closed".
    await call("POST", `/postings/${encodeURIComponent(p.id)}/close`, { reason: "filled" });
    await text(s, clock, ROWAN, "yes");
    expect(await last(rowan)).toBe(POSTING_COPY.dropped);
    expect(await openingsOf()).toMatchObject({ status: "closed", openings: 2 });

    // ---- The short close command still needs a yes before the only open post closes.
    await text(s, clock, ROWAN, "We filled it.");
    expect(await last(rowan)).toBe(POSTING_COPY.readBackClose("data analyst"));
    expect((await postings(rowan)).filter(x => x.status === "active")).toHaveLength(1);
    await text(s, clock, ROWAN, "yes");
    expect((await postings(rowan)).filter(x => x.status === "active")).toHaveLength(0);

    // Early stored close records could have lost their original headcount.
    await sql`update network.facets set tags = array_replace(tags, 'peon:openings:2', 'peon:openings:0')
      where app_id = 'peon' and ${`peon:posting:${p.id}`} = any(tags) and 'peon:openings:2' = any(tags)`;
    expect(await openingsOf()).toMatchObject({ status: "closed", openings: 0 });
    expect(await call("POST", "/postings", { id: p.id, managerId: rowan })).toMatchObject({
      status: 400, body: { ok: false, error: "invalid_openings" },
    });
    expect(await call("POST", "/postings", { id: p.id, managerId: rowan, openings: 2 })).toMatchObject({
      status: 200, body: { ok: true, posting: { status: "active", openings: 2 } },
    });
  }, T);
test("staff API requires an area for onsite postings but not remote ones", async () => {
  const clock = new SimClock(START);
  const s = service(clock);
  await s.start();
  try {
    await text(s, clock, ROWAN, "peon");
    await text(s, clock, ROWAN, "Rowan, 34");
    const rowan = (await memberId(ROWAN))!;
    const callAs = async (token: string | undefined, method: string, path: string, b?: unknown) => {
      const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(b ? { "content-type": "application/json" } : {}) };
      const res = await s.fetch(new Request(`http://127.0.0.1/apps/peon${path}`, { method, headers, ...(b ? { body: JSON.stringify(b) } : {}) }));
      return { status: res.status, body: await res.json() as any };
    };
    const call = (method: string, path: string, b?: unknown) => callAs("adm-tok", method, path, b);
    expect((await call("POST", `/employers/${encodeURIComponent(rowan)}/verify`, { company: "Acme", note: "called the office" })).body.ok).toBe(true)
        
    // Onsite, no area -> 400 missing_area.
    const onsite = await call("POST", "/postings", {
      managerId: rowan, title: "barista", openings: 1,
      payMin: 30, payMax: 35, mode: "onsite",
    });
    expect(onsite).toMatchObject({ status: 400, body: { error: "missing_area" } });
        
    // Same body, remote, no area -> 200 (remote posts need no area).
    const remote = await call("POST", "/postings", {
      managerId: rowan, title: "barista", openings: 1,
      payMin: 30, payMax: 35, mode: "remote",
    });
    expect(remote.status).toBe(200);
    
    // Onsite with a supported area -> 200.
    const withArea = await call("POST", "/postings", {
      managerId: rowan, title: "barista", openings: 1,
      payMin: 30, payMax: 35, mode: "onsite", area: "queens",
    });
    expect(withArea.status).toBe(200);
  } finally { await s.close(); }
}, T);
  
  
    
});
