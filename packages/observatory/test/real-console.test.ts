// Real-world mode reads the admin-console data back from Postgres, read-only (docs/admin-console.md
// section 6): the Network's stored state, requests, the newer review columns, events for the
// timeline and the opportunity history, safety cases, the config history, search without inbound
// text, the per-member PII reveal, and the append-only staff audit table.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { HIDDEN_MESSAGE, RealSource } from "../src/sources/real.ts";
import { PgAudit } from "../src/staff.ts";
import type { ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;

describe.skipIf(!pgAvailable)("real mode: admin-console data from Postgres", () => {
  let url: string;
  let g: GameSource;
  let real: RealSource;
  let gs: ObsState, rs: ObsState;
  beforeAll(async () => {
    url = await testDb();
    g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, review: "human", scenario: "spam_wave" });
    await g.init();
    await g.control({ type: "step", ms: DAY });
    // A reviewer edits one item and re-rolls another; an admin flips the matching switch; then the simulated reviewer takes over.
    const q = g.state().opportunities.filter(o => o.state === "IN_REVIEW");
    await g.control({ type: "review", oppId: q[0]!.id, decision: "edit", objective: "a coffee nearby", secondsSpent: 45 }, "rev@example.org");
    await g.control({ type: "review", oppId: q[1]!.id, decision: "reroll", swapOut: q[1]!.participants[1], secondsSpent: 12 }, "rev@example.org");
    await g.control({ type: "matching", on: false }, "admin@example.org");
    await g.control({ type: "matching", on: true }, "admin@example.org");
    await g.control({ type: "review_mode", mode: "auto" }, "admin@example.org");
    await g.control({ type: "step", ms: 4 * DAY });
    gs = g.state();
    const sql = new SQL(url);
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    await sql.close();
    real = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await real.init();
    rs = real.state();
  }, T);
  afterAll(async () => { await real?.dispose(); await g?.dispose(); await dropTestDb(); });

  test("review items with edits, re-rolls and time spent; requests; the Network's counters and switch", () => {
    expect(rs.env.error).toBeUndefined();
    const reviewed = gs.opportunities.filter(o => o.review);
    const byId = new Map(rs.opportunities.map(o => [o.id, o]));
    for (const o of reviewed) expect([o.id, byId.get(o.id)?.review]).toEqual([o.id, o.review]);
    expect(reviewed.some(o => o.review?.edits?.length && o.review.secondsSpent === 45)).toBe(true);
    expect(reviewed.some(o => o.review?.rerolls === 1)).toBe(true);
    const strip = (xs: ObsState["requests"]) => (xs ?? []).map(({ ageHours: _a, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id));
    expect(strip(rs.requests)).toEqual(strip(gs.requests));
    expect(rs.network).toMatchObject({ kind: "consent", matchingEnabled: true, review: { mode: "human" } });
    expect(rs.network!.counters).toEqual(gs.network!.counters);
    expect(rs.network!.trust).toEqual(gs.network!.trust);
    // Trust levels reach the member list in real mode too.
    for (const m of gs.members.filter(x => x.trust && x.trust !== "ok")) expect([m.id, rs.members.find(x => x.id === m.id)?.trust]).toEqual([m.id, m.trust]);
  });

  test("scorecard and growth match game mode where the data is the same; alerts are computed", () => {
    const card = (s: ObsState) => Object.fromEntries(s.stats.scorecard!.map(m => [m.key, m.value]));
    const [a, b] = [card(gs), card(rs)];
    for (const k of ["opt_in", "completion", "repeat_edges", "opt_outs", "minors_contacted", "leaks", "reviewer_minutes"]) expect([k, b[k]]).toEqual([k, a[k]]);
    expect(b.minors_contacted).toBe(0);
    expect(rs.stats.growth!.invitesSent).toBe(gs.stats.growth!.invitesSent);
    expect(rs.stats.growth!.invitees.members).toBe(gs.stats.growth!.invitees.members);
    expect(Array.isArray(rs.stats.alerts)).toBe(true);
    expect(rs.stats.alerts!.some(x => x.key === "matcher_heartbeat" && x.level === "bad")).toBe(false);
  });

  test("timeline: events between messages, inbound text hidden unless this member is revealed; opportunity history matches game mode", async () => {
    const opp = gs.opportunities.find(o => o.review?.decision === "approve" && o.participants.length === 2 && o.state !== "SKIPPED")!;
    const id = opp.participants[0]!;
    const [gt, rt] = [(await g.timeline(id))!, (await real.timeline(id))!];
    const kinds = (t: typeof gt) => t.entries.filter(e => e.kind === "event").map(e => (e.kind === "event" ? e.event.type : "")).sort();
    expect(kinds(rt)).toEqual(kinds(gt));
    expect(rt.entries.filter(e => e.kind === "message").length).toBe(gt.entries.filter(e => e.kind === "message").length);
    const inbound = rt.entries.filter(e => e.kind === "message" && e.message.direction === "inbound" && !e.message.system);
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.every(e => e.kind === "message" && e.message.body === HIDDEN_MESSAGE)).toBe(true);
    const outbound = rt.entries.filter(e => e.kind === "message" && e.message.direction === "outbound" && !e.message.system);
    expect(outbound.every(e => e.kind === "message" && e.message.guard === "passed")).toBe(true);
    // A reveal for this member shows their own words (and only on this call).
    const rv = (await real.timeline(id, { reveal: true }))!;
    expect(rv.entries.some(e => e.kind === "message" && e.message.direction === "inbound" && e.message.body !== HIDDEN_MESSAGE)).toBe(true);
    const detail = (await real.member(id, { reveal: true }))!;
    expect(detail.member.name).toBe(gs.members.find(m => m.id === id)!.name);
    expect((await real.member(id))!.member.name).not.toBe(detail.member.name);
    const [go, ro] = [(await g.opportunity(opp.id))!, (await real.opportunity(opp.id))!];
    expect(ro.events.map(e => [e.type, e.t])).toEqual(go.events.map(e => [e.type, e.t]));
  }, T);

  test("safety cases from the stored state; config history from events; search never returns what members wrote", async () => {
    const [gsf, rsf] = [await g.safety(), await real.safety()];
    expect(rsf.canAct).toBe(false);
    expect(rsf.cases.map(c => [c.id, c.memberId, c.status, c.level])).toEqual(gsf.cases.map(c => [c.id, c.memberId, c.status, c.level]));
    expect(rsf.hold.sort()).toEqual(gsf.hold.sort());
    expect((await real.safetyAction({ action: "close", caseId: rsf.cases[0]!.id }, "x")).ok).toBe(false);
    const cfg = await real.config();
    // Both switches name the staff member who changed them (setReviewMode(mode, actor)).
    expect(cfg.history.map(h => [h.key, h.from, h.to, h.actor])).toEqual([["matching", true, false, "admin@example.org"], ["matching", false, true, "admin@example.org"], ["review_mode", "human", "auto", "admin@example.org"]]);
    expect(cfg.canChange).toBe(false);
    const said = g.world.channel.all().find(m => m.direction === "outbound" && !m.system && /\b[A-Za-z]{8,}\b/.test(m.body))!;
    const hits = await real.search(said.body.match(/\b[A-Za-z]{8,}\b/)![0]);
    expect(hits.some(h => h.kind === "message")).toBe(true);
    const wrote = g.world.channel.all().filter(m => m.direction === "inbound" && m.body.length > 15);
    for (const m of wrote.slice(0, 5)) for (const h of await real.search(m.body.slice(0, 15))) expect(h.snippet.includes(m.body)).toBe(false);
    expect((await real.search("Review SLA")).every(h => h.kind === "event")).toBe(true);
  }, T);

  test("the booked plan (who it reached, who called it off) and the picked times match game mode", () => {
    const byId = new Map(rs.opportunities.map(o => [o.id, o]));
    const booked = gs.opportunities.filter(o => o.booked);
    expect(booked.length).toBeGreaterThan(0);
    for (const o of booked) {
      const r = byId.get(o.id)!;
      expect([o.id, r.booked?.at, r.booked?.told, Object.keys(r.booked?.cancelled ?? {}).sort()]).toEqual([o.id, o.booked!.at, o.booked!.told, Object.keys(o.booked!.cancelled).sort()]);
      expect(r.booked!.optOutHours).toBe(o.booked!.optOutHours);
    }
    const timed = gs.opportunities.filter(o => o.times && Object.values(o.times).some(t => t.picked));
    expect(timed.length).toBeGreaterThan(0);
    // Real mode has the picked keys; the offered labels are only in the message text.
    for (const o of timed) for (const [id, t] of Object.entries(o.times!)) if (t.picked) expect([o.id, id, byId.get(o.id)?.times?.[id]?.picked]).toEqual([o.id, id, t.picked]);
  });

  test("the read-only role cannot read network.network_state; network.network_state_console has only the paths the console reads", async () => {
    const sql = new SQL(url);
    try {
      const as = <T>(q: (tx: SQL) => Promise<T>) => sql.begin(async tx => { await tx`set local role network_observatory`; return q(tx); }).then(v => ({ v }), e => ({ e: String((e as Error).message) }));
      expect(await as(tx => tx`select state from network.network_state`)).toMatchObject({ e: expect.stringContaining("permission denied") });
      const row = await as(tx => tx`select * from network.network_state_console`) as { v: any[] };
      expect(row.v).toHaveLength(1);
      const v = row.v[0];
      expect(Object.keys(v).sort()).toEqual(["cases", "counters", "deferred", "deferred_sends", "gate_reasons", "id", "matching_enabled", "members", "saved_at", "trust"]);
      for (const m of v.members) for (const k of Object.keys(m)) expect(["id", "minor", "ageUnknown", "calendar", "weekly", "offerMade"]).toContain(k);
      for (const c of v.cases) for (const k of Object.keys(c)) expect(["id", "memberId", "opened", "level", "status", "closedAt", "closedBy", "events"]).toContain(k);
      for (const d of v.deferred_sends) for (const k of Object.keys(d)) expect(["memberId", "kind", "type", "proposalId"]).toContain(k);
      expect(Object.values({ ...v.counters, ...v.gate_reasons }).every(x => typeof x === "number")).toBe(true);
      // No full name and no message text gets through.
      const text = JSON.stringify(v);
      for (const m of gs.members.filter(x => x.joined).slice(0, 50)) expect(text.includes(m.name)).toBe(false);
      for (const m of g.world.channel.all().filter(x => x.body.length > 20).slice(0, 50)) expect(text.includes(m.body)).toBe(false);
    } finally { await sql.close(); }
  });

  test("minors and minor contacts follow the Network's age state, not only the record age", async () => {
    const before = Object.fromEntries(real.state().stats.scorecard!.map(m => [m.key, m.value])).minors_contacted;
    expect(before).toBe(0);
    // An adult on record that the Network later treats as under 18 (a minor signal), in an opportunity with messages after it.
    const sql = new SQL(url);
    const [hit] = await sql`select g.opportunity_id as opp, min(g.ts) as ts from network.messages g join network.participations p on p.opportunity_id = g.opportunity_id and p.role = 'participant'
      join network.members m on m.id = p.member_id where g.direction = 'outbound' and not g.system and m.age >= 18 group by 1 order by 2 limit 1`;
    const [who] = await sql`select p.member_id as id from network.participations p join network.members m on m.id = p.member_id where p.opportunity_id = ${hit.opp} and p.role = 'participant' and m.age >= 18 limit 1`;
    await sql`insert into network.events (at, actor_type, actor_id, type, object_type, object_id, payload)
      values (${new Date(new Date(hit.ts).getTime() - 60_000)}, 'agent', null, 'minor_signal', 'member', ${who.id}, ${{ memberId: who.id }}::jsonb)`;
    await sql`update network.network_state set state = jsonb_set(state, '{members}', (select jsonb_agg(case when m->>'id' = ${who.id} then m || '{"minor": true}'::jsonb else m end) from jsonb_array_elements(state->'members') m))`;
    await sql.close();
    await real.control({ type: "refresh" });
    const s = real.state();
    expect(s.members.find(m => m.id === who.id)?.minor).toBe(true);
    const contacts = s.stats.scorecard!.find(m => m.key === "minors_contacted")!;
    expect(contacts.value).toBeGreaterThan(0);
    expect(contacts.met).toBe(false);
    expect(s.stats.alerts!.find(a => a.key === "minor_contacts")).toMatchObject({ level: "bad" });
    expect((await real.safety()).minors.inOpportunities.length + (await real.safety()).minors.members.length).toBeGreaterThan(0);
  });

  test("staff audit: written through its own login, append-only; the real-mode connection cannot write it", async () => {
    const audit = new PgAudit(url);
    await audit.write({ at: Date.now(), actor: "safety@example.org", roles: ["safety"], action: "reveal", targetType: "member", targetId: "ny-0001", reason: "report check", ok: true, detail: { minutes: 15 } });
    await audit.write({ at: Date.now(), actor: "ana@example.org", roles: ["admin"], action: "read_member", targetType: "member", targetId: "ny-0002", ok: true });
    const rows = await audit.list({ targetId: "ny-0001" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "safety@example.org", roles: ["safety"], action: "reveal", reason: "report check", detail: { minutes: 15 }, ok: true });
    expect((await audit.list({ actions: ["read_member"] })).map(r => r.targetId)).toEqual(["ny-0002"]);
    await audit.close();
    const sql = new SQL(url);
    const fail = async (q: () => Promise<unknown>) => { try { await q(); return "changed"; } catch (e) { return String((e as Error).message); } };
    expect(await fail(() => sql`update network.staff_audit set actor = 'x'`)).toContain("append-only");
    expect(await fail(() => sql`delete from network.staff_audit`)).toContain("append-only");
    expect(await fail(() => sql`truncate network.staff_audit`)).toContain("append-only");
    await sql.close();
    const conn = (real as unknown as { sql: SQL }).sql;
    expect(await fail(() => conn`insert into network.staff_audit (actor, action) values ('x', 'y')`)).toMatch(/read-only/);
  });
});
