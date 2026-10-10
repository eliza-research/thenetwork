// The admin console for four apps (platform plan section 5): roles per app (role@app, role@*),
// every route checked for the request's app, slop and peon with matching off until their packs,
// the app's join age in its simulated world, per-app review reasons and SLA, real mode kept to one
// app (an app_id filter, and the app's read login under row-level security), and the cross-app
// person view (cross_app_safety@* or admin@* only; the audit row is written before any read).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { slaHours, toNetworkReason } from "../src/apps.ts";
import { healthAlerts } from "../src/health.ts";
import { labArgs } from "../src/lab.ts";
import { PeopleView } from "../src/people.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { ServiceClient } from "../src/sources/service.ts";
import { allowed, authenticate, canCrossApp, parseRoles, parseTokenGrants, parseTokens, rolesFor, type AuditSink } from "../src/staff.ts";
import type { AppHealth, AuditEntry, ObsState, PersonAppPanel, PersonSummary, StaffUser } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
/** Staff tokens are at least 32 characters on a server; the short names in these tests are padded to that. */
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");
/** A token spec ("role@app:name,...") with every token made long. */
const spec = (s: string) => s.split(",").map(p => { const i = p.lastIndexOf(":"); return `${p.slice(0, i)}:${long(p.slice(i + 1))}`; }).join(",");
const user = (tokens: string, tok: string): StaffUser => {
  const a = authenticate(new Request("http://x/", { headers: { authorization: `Bearer ${tok}` } }), { tokens: parseTokenGrants(tokens) });
  if (!("user" in a)) throw new Error(a.error);
  return a.user;
};

describe("roles per app", () => {
  test("role@app, role@* and the old role (= role@*); both token orders; typos and a per-app cross_app_safety are refused", () => {
    const t = parseTokenGrants("admin:a1,reviewer@slop:r1,p1:safety@peon,engineer@*:e1,cross_app_safety@*:c1,r1:analyst@slop");
    expect(t.get("a1")).toEqual([{ role: "admin", app: "*" }]);
    expect(t.get("r1")).toEqual([{ role: "reviewer", app: "slop" }, { role: "analyst", app: "slop" }]);
    expect(t.get("p1")).toEqual([{ role: "safety", app: "peon" }]);
    expect(t.get("c1")).toEqual([{ role: "cross_app_safety", app: "*" }]);
    expect(() => parseTokenGrants("reviewer@tinder:x")).toThrow("unknown app");
    expect(() => parseTokenGrants("reviewr:x")).toThrow("OBSERVATORY_TOKENS");
    expect(() => parseTokenGrants("cross_app_safety@slop:x")).toThrow("cross_app_safety@*");
    // In production an entry must name its app: an old "reviewer:<t>" would quietly read slop and peon too.
    expect(() => parseTokenGrants("reviewer:x", { explicitApp: true })).toThrow("names no app");
    expect(() => parseTokenGrants("x:reviewer", { explicitApp: true })).toThrow("names no app");
    expect(parseTokenGrants("reviewer@*:x,y:safety@slop", { explicitApp: true }).size).toBe(2);
    expect(parseRoles("Ana@Example.org:reviewer@slop,ana@example.org:safety").get("ana@example.org")).toEqual([{ role: "reviewer", app: "slop" }, { role: "safety", app: "*" }]);
    // The reader the Network service uses takes roles for every app only: a per-app token would grant too much there.
    expect(() => parseTokens("reviewer@slop:x")).toThrow("for one app");
    expect(parseTokens("admin:x").get("x")).toEqual(new Set(["admin"]));
  });

  test("every check is for one app; admin@app passes for that app only; engineer is simulated worlds only; cross_app_safety is never a per-app role", () => {
    const spec = "admin@slop:as,reviewer@peon:rp,engineer:en,cross_app_safety@*:cx,admin:ad";
    const as = user(spec, "as"), rp = user(spec, "rp"), en = user(spec, "en"), cx = user(spec, "cx"), ad = user(spec, "ad");
    expect(allowed(as, ["safety"], "slop")).toBe(true);
    expect(allowed(as, ["safety"], "ntwrk")).toBe(false);
    expect(allowed(as, [])).toBe(false); // a global admin check needs admin@*
    expect(allowed(rp, ["reviewer"], "peon")).toBe(true);
    expect(allowed(rp, ["reviewer"], "slop")).toBe(false);
    expect([...rolesFor(en, "slop", "game")]).toEqual(["engineer"]);
    expect([...rolesFor(en, "slop", "real")]).toEqual([]);
    expect([...rolesFor(cx, "ntwrk", "real")]).toEqual([]);
    expect([canCrossApp(cx), canCrossApp(ad), canCrossApp(as), canCrossApp(rp)]).toEqual([true, true, false, false]);
  });

  test("per-app review reasons map to the Network's PRD 32.8 codes and keep the app code in the note", () => {
    expect(toNetworkReason("slop", "preference_mismatch", " not her type ")).toEqual({ reason: "weak_reason", note: "[preference_mismatch] not her type" });
    expect(toNetworkReason("slop", "safety_concern")).toEqual({ reason: "safety", note: "[safety_concern]" });
    expect(toNetworkReason("peon", "not_qualified")).toEqual({ reason: "weak_reason", note: "[not_qualified]" });
    expect(toNetworkReason("peon", "role_closed")).toEqual({ reason: "wrong_timing", note: "[role_closed]" });
    expect(toNetworkReason("ntwrk", "tone", "x")).toEqual({ reason: "tone", note: "x" });
    expect(toNetworkReason("ntwrk", "preference_mismatch")).toBeUndefined();
    expect(toNetworkReason("slop", "not_qualified")).toBeUndefined();
  });

  test("review SLA per app: an item waiting past the app's SLA is an alert before the Network's deadline", () => {
    expect(slaHours("")).toMatchObject({ slop: 6, peon: 24, ntwrk: 12 });
    expect(slaHours("slop:2").slop).toBe(2);
    expect(() => slaHours("tinder:3")).toThrow("OBSERVATORY_REVIEW_SLA_HOURS");
    const now = 100 * HOUR;
    const base = { now, start: 0, reviewExpired: 0, deferred: 0, refusals: {}, guardBlocked: 0, expectEngine: false, matchingEnabled: true, invariants: 0, canaryLeaks: 0, minorContacts: 0 };
    const item = { queuedAt: now - 7 * HOUR, deadline: now + 5 * HOUR };
    expect(healthAlerts({ ...base, reviewOpen: [item], sla: { app: "slop", hours: 6 } }).find(a => a.key === "review_app_sla")?.count).toBe(1);
    expect(healthAlerts({ ...base, reviewOpen: [item], sla: { app: "ntwrk", hours: 12 } }).find(a => a.key === "review_app_sla")).toBeUndefined();
  });

  test("lab allows the shipped Slop pack and keeps Peon matching off", () => {
    expect(labArgs({ arms: ["consent"], seeds: [1], days: 3, app: "peon" }, 1)).toContain("--max-new");
    expect(labArgs({ arms: ["consent"], seeds: [1], days: 3, app: "slop" }, 1)).not.toContain("--max-new");
  });
});

describe("the console for four apps (game mode)", () => {
  let dir: string;
  let obs: ObservatoryServer;
  const TOK = spec("admin:adm,reviewer@slop:rev-slop,admin@slop:adm-slop,engineer:eng,analyst@ntwrk:ana");
  const as = (tok: string, path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${long(tok)}`, "content-type": "application/json" } });
  const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-apps-"));
    obs = await createServer({ port: 0, development: false, tokens: TOK, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, game: { seed: 1, review: "human", pushMs: 3_600_000, tickMs: 3_600_000 } });
  }, T);
  afterAll(async () => { await obs?.stop(); await rm(dir, { recursive: true, force: true }); });

  test("routes check the role for the request's app; /api/me lists the apps; an unknown app is refused", async () => {
    expect((await as("rev-slop", "/api/state?app=slop")).status).toBe(200);
    const no = await as("rev-slop", "/api/state?app=ntwrk");
    expect([no.status, (await no.json()).code]).toEqual([403, "forbidden"]);
    expect((await as("rev-slop", "/api/state")).status).toBe(403); // no app = ntwrk
    expect((await as("adm", "/api/state?app=tinder")).status).toBe(400);
    const me = await (await as("rev-slop", "/api/me")).json() as { apps: string[]; crossApp: boolean; grants: unknown[] };
    expect(me).toMatchObject({ apps: ["slop"], crossApp: false, grants: [{ role: "reviewer", app: "slop" }] });
    // admin@slop acts on slop only, and cannot switch the server's mode (admin@* only).
    expect((await as("adm-slop", "/api/config?app=slop")).status).toBe(200);
    expect((await as("adm-slop", "/api/config?app=peon")).status).toBe(403);
    expect((await post("adm-slop", "/api/mode", { mode: "real" })).status).toBe(403);
    // An analyst for ntwrk sees ntwrk config, not slop.
    expect((await as("ana", "/api/config?app=ntwrk")).status).toBe(200);
    expect((await as("ana", "/api/config?app=slop")).status).toBe(403);
    // The WebSocket needs a role for its app too.
    expect((await fetch(`${obs.url}/ws?app=ntwrk`, { headers: { authorization: `Bearer ${long("rev-slop")}`, upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } })).status).toBe(403);
  }, T);

  test("slop: the shipped pack matches adults and keeps joined minors out", async () => {
    const slop = await (await as("adm", "/api/state?app=slop")).json() as ObsState;
    const ntwrk = await (await as("adm", "/api/state?app=ntwrk")).json() as ObsState;
    expect(slop.env).toMatchObject({ app: "slop" });
    expect(slop.env.matchingLocked).toBeUndefined();
    expect(slop.env.label).toContain("SLOP");
    expect(slop.env.label).not.toContain("matching off until pack");
    expect(ntwrk.env.app).toBe("ntwrk");
    expect(ntwrk.env.matchingLocked).toBeUndefined();
    // AGENTS.md decision 1: 13+ may join every app; members aged 13-17 show with the minor flag and are never matched.
    const teens = slop.members.filter(m => m.age !== undefined && m.age >= 13 && m.age < 18);
    expect(teens.length).toBeGreaterThan(0);
    expect(teens.every(m => m.minor)).toBe(true);

    // Joins and onboarding run; opportunities never include minors.
    expect((await post("adm", "/api/control?app=slop", { type: "step", ms: 2 * DAY })).status).toBe(200);
    const after = await (await as("adm", "/api/state?app=slop")).json() as ObsState;
    expect(after.members.filter(m => m.joined).length).toBeGreaterThan(0);
    expect(after.opportunities.every(o => [...o.participants, ...o.alternates].every(id => !after.members.find(m => m.id === id)?.minor))).toBe(true);
    // A joined teen is never introduced, even by staff.
    const teen = after.members.find(m => m.joined && m.minor && !m.declined), adult = after.members.find(m => m.joined && !m.minor);
    expect(teen && adult).toBeTruthy();
    const pick = await post("adm", "/api/control?app=slop", { type: "propose", participants: [teen!.id, adult!.id] });
    expect([pick.status, (await pick.json()).error]).toEqual([409, expect.stringContaining("under 18")]);
    expect(after.network?.matchingEnabled).toBe(true);
    const on = await post("adm", "/api/control?app=slop", { type: "matching", on: true });
    expect(on.status).toBe(200);
  }, T);

  test("reasons are checked per app; the audit row names the app and keeps the app's code", async () => {
    const bad = await post("adm", "/api/control?app=ntwrk", { type: "review", oppId: "nope", decision: "reject", reason: "preference_mismatch" });
    expect([bad.status, (await bad.json()).code]).toEqual([400, "unknown_reason"]);
    const r = await post("adm", "/api/control?app=slop", { type: "review", oppId: "nope", decision: "reject", reason: "preference_mismatch" });
    expect((await r.json()).code).toBe("not_in_review");
    const rows = await obs.audit.list({ targetId: "nope", apps: ["slop"] });
    expect(rows.find(x => x.detail?.phase === "requested")).toMatchObject({ app: "slop", action: "review", detail: { reason: "preference_mismatch" } });
    // A reviewer for slop cannot decide ntwrk items.
    expect((await post("rev-slop", "/api/control?app=ntwrk", { type: "review", oppId: "nope", decision: "approve" })).status).toBe(403);
  }, T);

  test("engineer: game controls and the lab in a simulated world; health lists only the apps a person holds", async () => {
    expect((await post("eng", "/api/control?app=slop", { type: "step", ms: HOUR })).status).toBe(200);
    expect((await as("eng", "/api/lab?app=slop")).status).toBe(200);
    expect((await as("eng", "/api/safety?app=slop")).status).toBe(403);
    const h = await (await as("rev-slop", "/api/apps/health")).json() as { apps: AppHealth[] };
    expect(h.apps.map(a => a.app)).toEqual(["slop"]);
    expect(h.apps[0]).toMatchObject({ app: "slop", available: true, slaHours: 6, matching: "on" });
    const all = await (await as("adm", "/api/apps/health")).json() as { apps: AppHealth[] };
    expect(all.apps.map(a => a.app)).toEqual(["ntwrk", "slop", "peon", "friends"]);
    expect(all.apps.find(a => a.app === "peon")?.available).toBe(false); // its world was never opened
    const peon = await post("adm", "/api/control?app=peon", { type: "matching", on: true });
    expect([peon.status, (await peon.json()).code]).toEqual([409, "matching_locked"]);
  }, T);
});

describe("reviewer of record: the console sends the signed-in person to the service", () => {
  test("X-Network-Staff-Id carries the staff id, ?app= and X-Network-App the app, and the token is the console's own", async () => {
    const seen: { auth: string | null; staff: string | null; app: string | null; q: string | null; path: string }[] = [];
    const svc = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
      const u = new URL(req.url);
      seen.push({ auth: req.headers.get("authorization"), staff: req.headers.get("x-network-staff-id"), app: req.headers.get("x-network-app"), q: u.searchParams.get("app"), path: u.pathname });
      return Response.json({ ok: true });
    } });
    try {
      const c = new ServiceClient({ url: svc.url.href, token: "console-token", app: "slop" });
      expect(await c.review("rev@example.org", { type: "review", oppId: "o1", decision: "approve" })).toEqual({ ok: true });
      expect(await c.matching("admin@example.org", false)).toEqual({ ok: true });
      expect(seen).toEqual([
        { auth: "Bearer console-token", staff: "rev@example.org", app: "slop", q: "slop", path: "/review/o1" },
        { auth: "Bearer console-token", staff: "admin@example.org", app: "slop", q: "slop", path: "/matching" },
      ]);
    } finally { svc.stop(true); }
  });
});

describe.skipIf(!pgAvailable)("real mode for four apps (Postgres)", () => {
  let url: string, slopUrl: string;
  let g: GameSource;
  const LOGIN = `obs_slop_${process.pid}`;
  const P1 = crypto.randomUUID(), P2 = crypto.randomUUID();
  let ntwrkMember: string;
  const admin = (q: (sql: SQL) => Promise<unknown>) => { const s = new SQL(url); return q(s).finally(() => s.close()); };
  beforeAll(async () => {
    url = await testDb();
    g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, review: "human", personas: 40, days: 5 });
    await g.init();
    await g.control({ type: "step", ms: DAY });
    await admin(async sql => {
      await writeRows(sql, rowsFromGame(g), { truncate: true });
      // A small slop network: two members (one on hold), messages, an event and its stored state.
      await sql.begin(async tx => {
        await tx`set local app.app_id = 'slop'`;
        await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values ('s1', 'Sam Slop', 'nyc', 'active', 29, now()), ('s2', 'Ria Slop', 'nyc', 'active', 31, now())`;
        await tx`insert into network.messages (id, member_id, direction, body, ts) values ('sm1', 's1', 'inbound', 'slop secret words', now()), ('sm2', 's1', 'outbound', 'welcome to slop', now())`;
        await tx`insert into network.events (at, actor_type, actor_id, type, payload) values (now(), 'member', 's1', 'member_joined', '{}'::jsonb)`;
        const state = { matchingEnabled: false, deferred: [], trust: [{ id: "s1", level: "hold" }], cases: [{ id: "c1", memberId: "s1", opened: Date.now(), level: "hold", status: "held", events: [] }], counters: {}, gateReasons: {}, members: [] };
        await tx`insert into network.network_state (id, version, state) values ('slop:nyc', 1, ${state}::jsonb)`;
      });
      ntwrkMember = ((await sql`select id from network.members where app_id = 'ntwrk' and account_status = 'active' order by id limit 1`)[0] as { id: string }).id;
      // One person in ntwrk and slop; another person they blocked on slop.
      await sql`insert into platform.people (id, lowest_age) values (${P1}, 29), (${P2}, 40)`;
      await sql`insert into platform.memberships (app_id, person_id, member_id, state, joined_at) values ('ntwrk', ${P1}, ${ntwrkMember}, 'active', now()), ('slop', ${P1}, 's1', 'active', now())`;
      await sql`insert into platform.person_blocks (from_person, to_person, origin_app, at) values (${P1}, ${P2}, 'slop', now())`;
      // slop's own read login: a member of network_observatory_slop (row-level security).
      await sql.unsafe(`drop role if exists ${LOGIN}`);
      await sql.unsafe(`create role ${LOGIN} login in role network_observatory_slop`);
    });
    slopUrl = url.replace(/\/\/[^@]+@/, `//${LOGIN}@`);
  }, T);
  afterAll(async () => {
    await g?.dispose();
    await dropTestDb();
    if (pgAvailable) { const s = new SQL(url.replace(/\/[^/]+$/, "/postgres")); await s.unsafe(`drop role if exists ${LOGIN}`).catch(() => {}); await s.close(); }
  });

  test("the shared login with the app filter: each app sees only its rows; slop is invisible from ntwrk", async () => {
    const ntwrk = new RealSource({ url, app: "ntwrk", pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    const slop = new RealSource({ url, app: "slop", pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await ntwrk.init(); await slop.init();
      const n = ntwrk.state(), s = slop.state();
      expect(s.env).toMatchObject({ app: "slop", appIsolation: "app_filter", capabilities: { readOnly: true } });
      expect(s.members.map(m => m.id).sort()).toEqual(["s1", "s2"]);
      expect(n.members.some(m => m.id === "s1")).toBe(false);
      expect(n.members.length).toBe(g.state().members.length);
      expect(s.network).toMatchObject({ matchingEnabled: false, trust: { hold: 1 } });
      expect(n.network?.matchingEnabled).toBe(true);
      expect((await slop.safety()).cases.map(c => c.id)).toEqual(["c1"]);
      expect(await ntwrk.search("welcome to slop")).toEqual([]);
      expect((await slop.search("welcome to slop")).map(h => h.memberId)).toEqual(["s1"]);
      expect(await ntwrk.member("s1")).toBeUndefined();
    } finally { await ntwrk.dispose(); await slop.dispose(); }
  }, T);

  test("slop's read login: row-level security keeps the connection to slop, and the console view of its state works", async () => {
    const direct = new SQL(slopUrl);
    try {
      expect(((await direct`select count(*)::int as n from network.members`)[0] as { n: number }).n).toBe(2);
      expect(((await direct`select count(*)::int as n from network.messages where app_id = 'ntwrk'`)[0] as { n: number }).n).toBe(0);
      expect((await direct`select id from network.network_state_console_slop`).map((r: any) => r.id)).toEqual(["slop:nyc"]);
      expect(await direct`select 1 from network.network_state_console_ntwrk`.then(() => "read", e => String(e.message))).toContain("permission denied");
      expect(await direct`select 1 from platform.memberships`.then(() => "read", e => String(e.message))).toContain("permission denied");
    } finally { await direct.close(); }
    const slop = new RealSource({ url, app: "slop", appUrl: slopUrl, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await slop.init();
      const s = slop.state();
      expect(s.env.error).toBeUndefined();
      expect(s.env.appIsolation).toBe("rls_role");
      expect(s.members.map(m => m.id).sort()).toEqual(["s1", "s2"]);
      expect(s.network?.trust.hold).toBe(1);
    } finally { await slop.dispose(); }
  }, T);

  test("cross-app view: cross_app_safety and admin only; each app's panel needs a reason and is audited before it is read", async () => {
    const log: string[] = [];
    const rows: AuditEntry[] = [];
    let failAudit = false;
    const sink: AuditSink = {
      kind: "file",
      async write(e) { if (failAudit) throw new Error("down"); log.push(`audit:${e.action}`); rows.push(e); },
      async list() { return rows.slice().reverse(); },
      async close() {},
    };
    const panel = PeopleView.prototype.panel, summary = PeopleView.prototype.summary;
    PeopleView.prototype.panel = function (...a) { log.push("read:panel"); return panel.apply(this, a); };
    PeopleView.prototype.summary = function (...a) { log.push("read:summary"); return summary.apply(this, a); };
    const dir = await mkdtemp(join(tmpdir(), "obs-cross-"));
    const obs = await createServer({
      port: 0, development: false, mode: "real", tokens: spec("admin:ad,cross_app_safety@*:cx,reviewer:rv,admin@slop:as,safety:sf"),
      audit: sink, lab: { dir: join(dir, "lab") }, real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: false }, peopleUrl: url,
    });
    const as = (tok: string, path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${long(tok)}`, "content-type": "application/json" } });
    const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });
    try {
      // Reviewers, per-app admins and app safety staff never reach it.
      for (const tok of ["rv", "as", "sf"]) {
        expect((await as(tok, `/api/person/${P1}`)).status).toBe(403);
        expect((await as(tok, `/api/person/lookup?app=ntwrk&member=${ntwrkMember}`)).status).toBe(403);
        expect((await post(tok, `/api/person/${P1}/open`, { app: "slop", reason: "safety report 42" })).status).toBe(403);
      }
      // cross_app_safety has no per-app role: the app views stay closed to it.
      expect((await as("cx", "/api/state?app=slop")).status).toBe(403);
      expect(log).toEqual([]);
      const found = await (await as("cx", `/api/person/lookup?app=ntwrk&member=${encodeURIComponent(ntwrkMember)}`)).json() as { personId: string };
      expect(found.personId).toBe(P1);
      const p = await (await as("cx", `/api/person/${P1}`)).json() as PersonSummary;
      // Dating (slop) is not in the summary (PRD 40.3): its membership is not listed, its hold shows as
      // "restricted" on an app not named, and a block made there has no app.
      expect(p.memberships.map(m => [m.app, m.state, m.hold])).toEqual([["ntwrk", "active", false]]);
      expect(p.holds).toEqual([{ app: "*", level: "restricted" }]);
      expect(p.blocks.made).toMatchObject([{ person: P2, originApp: "*" }]);
      expect(p.privateApps).toEqual(["slop"]);
      expect(JSON.stringify({ ...p, privateApps: [] })).not.toContain("slop");
      expect(JSON.stringify(p)).not.toContain("Sam");
      // A person with no slop membership gets the same summary shape: the same closed slop row, nothing that differs.
      const p2 = await (await as("cx", `/api/person/${P2}`)).json() as PersonSummary;
      expect([p2.privateApps, p2.holds]).toEqual([["slop"], []]);
      expect((await post("cx", `/api/person/${P2}/open`, { app: "slop", reason: "safety report 42" })).status).toBe(404);
      // A panel needs a typed reason; nothing is read without one.
      const before = log.length;
      expect((await post("cx", `/api/person/${P1}/open`, { app: "slop", reason: "hm" })).status).toBe(400);
      expect(log.length).toBe(before);
      const open = await post("ad", `/api/person/${P1}/open`, { app: "slop", reason: "safety report 42" });
      expect(open.status).toBe(200);
      const pnl = await open.json() as PersonAppPanel;
      expect(pnl).toMatchObject({ app: "slop", memberId: "s1", trust: "hold", messages: { in: 1, out: 1 }, cases: [{ id: "c1" }] });
      // The audit row (with the app and the reason) came before the read.
      expect(log.slice(-2)).toEqual(["audit:open_person_app", "read:panel"]);
      expect(rows.at(-1)).toMatchObject({ action: "open_person_app", app: "slop", targetType: "person", targetId: P1, reason: "safety report 42", actor: expect.stringMatching(/^token:admin#/) });
      expect(log.indexOf("audit:read_person")).toBeLessThan(log.indexOf("read:summary"));
      // No audit row, no read (fail closed).
      failAudit = true;
      const n = log.length;
      expect((await post("cx", `/api/person/${P1}/open`, { app: "ntwrk", reason: "safety report 42" })).status).toBe(503);
      expect((await as("cx", `/api/person/${P1}`)).status).toBe(503);
      expect(log.length).toBe(n);
    } finally {
      PeopleView.prototype.panel = panel; PeopleView.prototype.summary = summary;
      await obs.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, T);

  test("the Postgres audit log stores the app (network.staff_audit.app_id) and filters by it", async () => {
    const { PgAudit } = await import("../src/staff.ts");
    const a = new PgAudit(url);
    try {
      await a.write({ at: Date.now(), actor: "x@example.org", roles: ["admin"], action: "read_member", targetType: "member", targetId: "s1", app: "slop", ok: true });
      await a.write({ at: Date.now(), actor: "x@example.org", roles: ["admin"], action: "read_member", targetType: "member", targetId: ntwrkMember, app: "ntwrk", ok: true });
      expect((await a.list({ apps: ["slop"] })).map(r => [r.app, r.targetId])).toEqual([["slop", "s1"]]);
      expect((await a.list({})).length).toBe(2);
      expect(await admin(sql => sql`select app_id from network.staff_audit order by id`)).toEqual([{ app_id: "slop" }, { app_id: "ntwrk" }]);
    } finally { await a.close(); }
  }, T);
});
