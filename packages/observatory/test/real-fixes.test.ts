// Real mode on Postgres: the console's read-path fixes (audit observatory-9, -11, -17, -19, -22, -23),
// the per-app Member 360 panels (slop dating preferences behind a reveal, photos for verified adults
// only and never a score; peon roles and applications), and the post-date report queue with hold and
// ban by phone or person through the Network service (a local fake of the contract in
// docs/admin-console.md 3.7.1). Skipped without Postgres. Phone numbers are 555-01xx.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import { ageView, loginProblem, mergeStateRows, minorAt, RealSource } from "../src/sources/real.ts";
import type { AppProfile360, AuditEntry, MemberDetail, PeonProfile360, SafetyInfo, SlopProfile360 } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");

describe("age, logins and merged state (units)", () => {
  test("minorAt agrees with ageView: no age fails closed, the Network's stored view decides, events win from their time", () => {
    const empty = { latest: new Map(), changes: new Map(), optIns: new Map() };
    expect([ageView(null).minor, minorAt(empty, "a", null, 5)]).toEqual([true, true]);
    expect([ageView(30).minor, minorAt(empty, "a", 30, 5)]).toEqual([false, false]);
    expect([ageView(16).minor, minorAt(empty, "a", 16, 5)]).toEqual([true, true]);
    const stored = { ...empty, latest: new Map([["a", { minor: false, unknown: false }]]) };
    expect([ageView(null, stored.latest.get("a")).minor, minorAt(stored, "a", null, 5)]).toEqual([false, false]);
    const ev = { ...empty, latest: new Map([["a", { minor: false, unknown: false }]]), changes: new Map([["a", [{ at: 10, minor: true, unknown: true }, { at: 20, minor: false, unknown: false }]]]) };
    expect([minorAt(ev, "a", null, 5), minorAt(ev, "a", null, 15), minorAt(ev, "a", null, 25)]).toEqual([true, true, false]);
  });

  test("a login is refused when it can write, is a superuser away from this machine, or is not in the app's role", () => {
    const ok = { su: false, bypass: false, ro: "on", inAppRole: true };
    expect(loginProblem(ok, { local: false, isolation: "rls_role", app: "slop" })).toBeUndefined();
    expect(loginProblem({ ...ok, ro: "off" }, { local: true, isolation: "app_filter", app: "slop" })).toContain("read-only");
    expect(loginProblem({ ...ok, su: true }, { local: false, isolation: "app_filter", app: "slop" })).toContain("superuser");
    expect(loginProblem({ ...ok, bypass: true }, { local: false, isolation: "app_filter", app: "slop" })).toContain("bypasses");
    expect(loginProblem({ ...ok, su: true }, { local: true, isolation: "app_filter", app: "slop" })).toBeUndefined();
    expect(loginProblem({ ...ok, inAppRole: false }, { local: true, isolation: "rls_role", app: "slop" })).toContain("network_observatory_slop");
  });

  test("one app's cities merge: lists join, counts add up, matching is on only where every city has it on", () => {
    const m = mergeStateRows([
      { saved_at: 2, matching: true, deferred: 2, trust: JSON.stringify([{ id: "a", level: "hold" }]), counters: { x: 1 }, gate: { g: 2 } },
      { saved_at: 1, matching: false, deferred: 3, trust: [{ id: "b", level: "watch" }], counters: { x: 2, y: 1 }, gate: {} },
    ])!;
    expect(m).toEqual({ saved_at: 2, matching: false, deferred: 5, trust: [{ id: "a", level: "hold" }, { id: "b", level: "watch" }], counters: { x: 3, y: 1 }, gate: { g: 2 } });
  });
});

describe.skipIf(!pgAvailable)("real mode fixes and per-app panels (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let dir: string;
  let obs: ObservatoryServer;
  let fake: ReturnType<typeof Bun.serve>;
  const calls: { method: string; path: string; staff: string | null; reason: string | null; body: any }[] = [];
  const LOGIN = `obs_peon_${process.pid}`;
  const P = { a: crypto.randomUUID(), c: crypto.randomUUID() };
  const TOK = { admin: long("admin-real"), safety: long("safety-slop"), reviewer: long("reviewer-slop") };
  const as = (tok: string, path: string, init: RequestInit = {}) => fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" } });
  const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });
  const facet = (id: string, member: string, kind: string, value: string, tags: string[], scope = "agent_private") =>
    sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance) values (${member.startsWith("s") ? "slop" : "peon"}, ${id}, ${member}, ${kind}, ${value}, ${`{${tags.join(",")}}`}::text[], ${scope}, 'said')`;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await sql`insert into platform.people (id, lowest_age) values (${P.a}, 29), (${P.c}, 41)`;
    // slop: s1 a verified adult with dating facts (and a score that must never show), s2 a 16-year-old, s3 an adult not verified, s4 with no name.
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at, person_id) values
        ('s1', 'Sam Slop', 'nyc', 'active', 29, now(), ${P.a}), ('s2', 'Tia Teen', 'nyc', 'active', 16, now(), null),
        ('s3', 'Cy Slop', 'nyc', 'active', 41, now(), ${P.c}), ('s4', null, 'nyc', 'active', 33, now(), null)`;
      // Two cities of slop: both rows count.
      await tx`insert into network.network_state (id, version, state) values
        ('slop:nyc', 1, ${{ matchingEnabled: false, trust: [{ id: "s1", level: "watch" }], cases: [{ id: "c1", memberId: "s3", opened: Date.now() - 3_600_000, level: "watch", status: "open", events: [] }], members: [] }}::jsonb),
        ('slop:sf', 1, ${{ matchingEnabled: false, trust: [{ id: "s3", level: "hold" }], cases: [], members: [] }}::jsonb)`;
    });
    await sql`insert into platform.memberships (app_id, person_id, member_id, state, joined_at) values ('slop', ${P.a}, 's1', 'active', now()), ('slop', ${P.c}, 's3', 'active', now())`;
    await sql`insert into platform.person_blocks (from_person, to_person, origin_app, at) values (${P.a}, ${P.c}, 'slop', now())`;
    await facet("f1", "s1", "preference", "seeks women", ["romance:is:man", "romance:seeks:woman", "romance:age:25-35"]);
    await facet("f2", "s1", "goal", "long term", ["slop:goal:long_term"], "matchable");
    await facet("f3", "s1", "boundary", "no smokers", ["slop:dealbreaker:smoker"]);
    await facet("f4", "s1", "fact", "age check passed", ["verify:age:pass"]);
    await facet("f5", "s1", "fact", "attractiveness 0.91", ["slop:attractiveness:0.91"]);
    await facet("f6", "s1", "interest", "climbing", ["climbing"], "shareable");
    await facet("f7", "s2", "fact", "age check passed", ["verify:age:pass"]);
    await facet("f8", "s2", "preference", "seeks", ["romance:seeks:man"]);
    // peon: a job seat (with a proxy tag that must never show) and a candidate.
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'peon'`;
      // Full preferences: the engine reads them (a member stored with the column default '{}' crashes a shadow run; see openIssues).
      const prefs = { categoriesOptIn: ["professional"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false };
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at, prefs) values ('j1', 'Hana Hiring', 'nyc', 'active', 18, now(), ${prefs}::jsonb), ('c1', 'Cal Cand', 'nyc', 'active', 18, now(), ${prefs}::jsonb)`;
      await tx`insert into network.intents (id, member_id, objective, category, details) values ('i1', 'j1', 'Hire: ICU nurse', 'professional', 'peon:job')`;
    });
    await facet("p1", "j1", "fact", "job", ["peon:entity:job", "peon:family:nursing", "peon:seniority:3", "peon:pay:90-120", "peon:mode:onsite", "peon:market:nyc", "peon:openings:2", "peon:verified"], "matchable");
    await facet("p2", "c1", "fact", "candidate", ["peon:entity:candidate", "peon:family:nursing", "peon:mode:hybrid"], "matchable");
    await facet("p3", "c1", "fact", "zip", ["peon:proxy:zip:10001"]);
    await sql.unsafe(`drop role if exists ${LOGIN}`);
    await sql.unsafe(`create role ${LOGIN} login in role network_observatory_peon`);

    // A local fake of the Network service's staff API (docs/admin-console.md 3.7.1).
    fake = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const u = new URL(req.url);
        calls.push({ method: req.method, path: u.pathname, staff: req.headers.get("x-network-staff-id"), reason: req.headers.get("x-network-reason"), body: req.method === "POST" ? await req.json() : undefined });
        if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
        if (u.pathname === "/safety/reports") return Response.json({ ok: true, reports: [
          { id: "r1", kind: "harassment", reporterId: "s1", subjectId: "s3", opportunityId: "o9", at: Date.now() - 2 * 3_600_000, status: "open" },
          { id: "r2", kind: "lying", reporterId: "s1", subjectId: "s3", at: Date.now() - 600_000, status: "open" },
          { id: "r3", kind: "made-up", reporterId: "s3", subjectId: "s1", at: Date.now(), status: "weird" },
          { id: "bad" },
        ] });
        if (u.pathname.startsWith("/safety/")) return Response.json({ ok: true });
        if (/^\/members\/[^/]+\/photos$/.test(u.pathname)) return Response.json({ ok: true, photos: [{ id: "ph1", url: "https://photos.example.org/ph1.jpg", expiresAt: Date.now() + 60_000 }, { id: "x", url: "javascript:alert(1)" }] });
        return Response.json({ error: "no route" }, { status: 404 });
      },
    });
    dir = await mkdtemp(join(tmpdir(), "obs-real-fixes-"));
    obs = await createServer({
      port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false,
      tokens: `admin:${TOK.admin},safety@slop:${TOK.safety},reviewer@slop:${TOK.reviewer}`,
      real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc") } },
    });
  }, T);
  afterAll(async () => {
    await obs?.stop(); fake?.stop(true);
    await sql?.unsafe(`drop role if exists ${LOGIN}`).catch(() => {});
    await sql?.close(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("every city of an app counts (two slop networks: one watch, one hold); a member with no name is 'Unnamed member'", async () => {
    const s = await (await as(TOK.admin, "/api/state?app=slop")).json() as { members: { id: string; name: string }[]; network: { trust: { watch: number; hold: number } } };
    expect(s.network.trust).toEqual({ watch: 1, hold: 1 });
    expect(s.members.find(m => m.id === "s4")?.name).toBe("Unnamed member");
  }, T);

  test("slop Member 360: dating facts hidden until a reveal, scores never, photos for verified adults only", async () => {
    const d = await (await as(TOK.safety, "/api/member/s1?app=slop")).json() as MemberDetail;
    expect(d.facets.map(f => f.id).sort()).toEqual(["f6"]); // no dating fact, no score
    const hidden = await (await as(TOK.safety, "/api/member/s1/app?app=slop")).json() as SlopProfile360;
    expect(hidden).toEqual({ app: "slop", adult: true, ageVerified: true, prefs: { hidden: true, count: 4 }, photos: "reason_required" });
    // A reviewer may not open a member outside review; nothing leaks through the panel route.
    expect((await as(TOK.reviewer, "/api/member/s1/app?app=slop")).status).toBe(403);
    expect((await post(TOK.safety, "/api/reveal?app=slop", { memberId: "s1", reason: "report r1 review" })).status).toBe(200);
    const shown = await (await as(TOK.safety, "/api/member/s1/app?app=slop")).json() as SlopProfile360;
    expect(shown.prefs).toEqual({ hidden: false, prefs: { is: "man", seeks: ["woman"], ageRange: [25, 35], goal: "long_term", values: {}, dealbreakers: ["smoker"], activities: [], free: [], verification: ["verify:age:pass"], safety: [] } });
    const revealed = await (await as(TOK.safety, "/api/member/s1?app=slop")).json() as MemberDetail;
    expect(revealed.facets.map(f => f.id).sort()).toEqual(["f1", "f2", "f3", "f4", "f6"]);
    expect(JSON.stringify([shown, revealed])).not.toMatch(/attractiveness|0\.91/);
    // Photos: a reason; never under 18; verified adults only; only https links come back.
    expect((await post(TOK.safety, "/api/member/s1/photos?app=slop", { reason: "no" })).status).toBe(400);
    const minor = await post(TOK.safety, "/api/member/s2/photos?app=slop", { reason: "report r9 check" });
    expect([minor.status, (await minor.json()).code]).toEqual([403, "never_minor"]);
    expect((await (await as(TOK.safety, "/api/member/s2/app?app=slop")).json() as SlopProfile360).photos).toBe("never_minor");
    const unverified = await post(TOK.safety, "/api/member/s3/photos?app=slop", { reason: "report r1 check" });
    expect([unverified.status, (await unverified.json()).code]).toEqual([403, "needs_verification"]);
    expect(calls.some(c => c.path.includes("/photos"))).toBe(false);
    const ok = await post(TOK.safety, "/api/member/s1/photos?app=slop", { reason: "report r1 check" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { photos: unknown[] }).photos).toEqual([{ id: "ph1", url: "https://photos.example.org/ph1.jpg", expiresAt: expect.any(Number) }]);
    expect(calls.find(c => c.path === "/members/s1/photos")).toMatchObject({ method: "GET", reason: "report r1 check", staff: expect.stringMatching(/^token:safety#/) });
    expect((await post(TOK.reviewer, "/api/member/s1/photos?app=slop", { reason: "report r1 check" })).status).toBe(403);
    // Every photo read and refusal is in the audit log with its reason.
    const rows = (await (await as(TOK.admin, "/api/audit?limit=200&app=slop")).json() as { entries: AuditEntry[] }).entries.filter(e => e.action === "read_photos");
    expect(rows.map(e => [e.targetId, e.ok, (e.detail as { refused?: string } | undefined)?.refused ?? null])).toEqual([["s1", true, null], ["s3", false, "needs_verification"], ["s2", false, "never_minor"]]);
  }, T);

  test("peon Member 360: the role a job seat hires for and a candidate's families; proxy tags never", async () => {
    const job = await (await as(TOK.admin, "/api/member/j1/app?app=peon")).json() as PeonProfile360;
    expect(job).toEqual({ app: "peon", entity: "job", roles: [{ title: "ICU nurse", family: "nursing", seniority: 3, pay: "$90-120k", mode: "onsite", market: "nyc", openings: 2, verified: true }], applications: [] });
    const cand = await (await as(TOK.admin, "/api/member/c1/app?app=peon")).json() as AppProfile360;
    expect(cand).toMatchObject({ app: "peon", entity: "candidate", roles: [{ family: "nursing", mode: "hybrid" }] });
    expect(JSON.stringify(cand)).not.toContain("10001");
    expect(await (await as(TOK.admin, "/api/member/n/app?app=ntwrk")).json()).toEqual({ error: "not found" });
  }, T);

  test("post-date reports from the service, urgent first; hold and ban by phone or person go to the service with the person who acted", async () => {
    const sf = await (await as(TOK.safety, "/api/safety?app=slop")).json() as SafetyInfo;
    expect(sf.canBan).toBe(true);
    expect(sf.reports!.map(r => [r.id, r.kind, r.status, r.urgent, r.priorReports])).toEqual([["r1", "harassment", "open", true, 0], ["r2", "lying", "open", false, 1], ["r3", "other", "open", false, 0]]);
    expect(sf.reports![0]!.overdue).toBe(true); // harassment: 1-hour target, reported 2 hours ago
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "ban", memberId: "s3", by: "account", note: "repeat harassment" })).status).toBe(400);
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "hold", memberId: "s3", note: "no" })).status).toBe(400);
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "hold", memberId: "s3", note: "report r1, harassment after a date", reportId: "r1" })).status).toBe(200);
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "ban", memberId: "s3", by: "phone", note: "report r1 confirmed", reportId: "r1" })).status).toBe(200);
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "ban", memberId: "s3", by: "person", note: "report r1 confirmed" })).status).toBe(200);
    expect((await post(TOK.safety, "/api/safety?app=slop", { action: "dismiss", reportId: "r3", note: "not about a date" })).status).toBe(200);
    expect((await post(TOK.reviewer, "/api/safety?app=slop", { action: "ban", memberId: "s3", by: "person", note: "report r1 confirmed" })).status).toBe(403);
    const sent = calls.filter(c => c.method === "POST" && c.path.startsWith("/safety/"));
    expect(sent.map(c => [c.path, c.body])).toEqual([
      ["/safety/hold", { memberId: "s3", note: "report r1, harassment after a date", reportId: "r1" }],
      ["/safety/ban", { memberId: "s3", by: "phone", note: "report r1 confirmed", reportId: "r1" }],
      ["/safety/ban", { memberId: "s3", by: "person", note: "report r1 confirmed" }],
      ["/safety/dismiss", { reportId: "r3", note: "not about a date" }],
    ]);
    expect(sent.every(c => /^token:safety#/.test(c.staff ?? ""))).toBe(true);
    const rows = (await (await as(TOK.admin, "/api/audit?limit=200&app=slop")).json() as { entries: AuditEntry[] }).entries.filter(e => e.action === "safety_ban");
    expect(rows.map(e => [(e.detail as any).phase, (e.detail as any).by])).toEqual([["result", "person"], ["requested", "person"], ["result", "phone"], ["requested", "phone"]]);
  }, T);

  test("an app login outside the app's role is refused; the global reveal needs a dev database; shadow runs are one at a time and read the app's blocks view", async () => {
    const wrong = new RealSource({ url, app: "slop", appUrl: url.replace(/\/\/[^@]+@/, `//${LOGIN}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await wrong.init();
      expect(wrong.state().env.error).toContain("network_observatory_slop");
      expect(wrong.state().members).toEqual([]);
    } finally { await wrong.dispose(); }
    await sql`update platform.settings set value = 'production' where key = 'environment'`;
    const prod = new RealSource({ url, app: "slop", revealPii: true, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await prod.init();
      expect(prod.state().env.piiRevealed).toBe(false);
      expect(prod.state().env.label).toContain("OBSERVATORY_REVEAL_PII refused");
      expect(prod.state().members.find(m => m.id === "s1")?.name).toBe("Sam S.");
    } finally { await prod.dispose(); await sql`update platform.settings set value = 'dev' where key = 'environment'`; }
    // peon's own login: the shadow run builds its snapshot through platform.person_blocks_peon (it cannot read the table).
    const peon = new RealSource({ url, app: "peon", appUrl: url.replace(/\/\/[^@]+@/, `//${LOGIN}@`), pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    try {
      await peon.init();
      expect(peon.state().env.error).toBeUndefined();
      const [a, b] = await Promise.all([peon.control({ type: "shadow_run", city: "nyc" }), peon.control({ type: "shadow_run", city: "nyc" })]);
      expect([a.ok, b.ok, a.error]).toEqual([true, true, undefined]);
      expect(peon.state().engineRuns.filter(r => r.shadow)).toHaveLength(1);
    } finally { await peon.dispose(); }
  }, T);
});
