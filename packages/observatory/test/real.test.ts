// Real-world mode against Postgres: reads the network schema correctly, matches what was written
// (dataset and a full simulated run: game → DB → real parity), never writes, scrubs PII.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { DATA_DIR, readJsonl, type EdgeRecord, type FacetRecord } from "../../../scripts/synthetic/common.ts";
import { rowsFromDataset, rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { HIDDEN_MESSAGE, RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 180_000;
const PHONE = /\+?1?[-\s.]?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

describe.skipIf(!pgAvailable)("RealSource (Postgres)", () => {
  let url: string;
  let sql: SQL;
  const sources: RealSource[] = [];
  const open = async (opts: Partial<ConstructorParameters<typeof RealSource>[0]> = {}) => {
    const r = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false, ...opts });
    sources.push(r);
    await r.init();
    return r;
  };
  beforeAll(async () => { url = await testDb(); sql = new SQL(url); }, T);
  afterAll(async () => { for (const s of sources) await s.dispose(); await sql?.close(); await dropTestDb(); });

  test("not configured: a clear error, no crash", async () => {
    const prev = { NETWORK_DATABASE_URL: process.env.NETWORK_DATABASE_URL, DATABASE_URL: process.env.DATABASE_URL };
    delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
    const r = new RealSource({});
    try {
      await r.init();
      expect(r.state().env.error).toContain("NETWORK_DATABASE_URL");
      expect(r.state().members.length).toBe(0);
    } finally {
      // Restore exactly: assigning undefined would store the string "undefined".
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      await r.dispose();
    }
  });

  test("dataset → Postgres → real mode: members, graph and facets match the files; PII and private facts are scrubbed", async () => {
    await writeRows(sql, await rowsFromDataset(), { truncate: true });
    const r = await open();
    const s = r.state();
    expect(s.env.mode).toBe("real");
    // No Network service configured: no staff actions either (the database login never writes).
    expect(s.env.capabilities).toEqual({ canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true, staffActions: false });
    expect(s.env.error).toBeUndefined();
    expect(s.members.length).toBe(500);
    const edges = await readJsonl<EdgeRecord>(`${DATA_DIR}/edges.jsonl`);
    const expected: Record<string, number> = {};
    for (const e of new Map(edges.map(e => [`${e.from}|${e.to}|${e.type}`, e])).values()) expected[e.type] = (expected[e.type] ?? 0) + 1;
    expect(s.stats.edgesByType).toEqual(expected);
    // Names are "First L." by default.
    expect(s.members.every(m => /^\S+( \S\.)?$/.test(m.name))).toBe(true);
    // A member with private facts: values withheld, canary refs never exposed.
    const facets = await readJsonl<FacetRecord>(`${DATA_DIR}/facets.jsonl`);
    const priv = facets.find(f => f.scope === "agent_private")!;
    const d = (await r.member(priv.memberId))!;
    expect(d.facets.length).toBe(facets.filter(f => f.memberId === priv.memberId).length);
    expect(d.facets.find(f => f.id === priv.id)!.value).toBe("[private · agent only]");
    const text = JSON.stringify([s, d]);
    expect(text).not.toMatch(PHONE);
    expect(text).not.toMatch(EMAIL);
    // Sensitive facts and their canary references never leave the database (generic private
    // values like "rock music" can legitimately also be another member's public interest).
    const sensitive = facets.filter(f => f.tags.includes("sensitive") || (f as { sensitive?: string }).sensitive);
    expect(sensitive.length).toBeGreaterThan(50);
    for (const f of sensitive) {
      expect(text.includes(f.value)).toBe(false);
      const canary = /\(ref ([^)]+)\)/.exec(f.value)?.[1];
      if (canary) expect(text.includes(canary)).toBe(false);
    }
    for (const f of facets.filter(f => f.memberId === priv.memberId && f.scope === "agent_private"))
      expect(d.facets.find(x => x.id === f.id)!.value).toBe("[private · agent only]");
  }, T);

  test("read-only: the observatory's connection cannot write", async () => {
    const r = await open();
    const conn = (r as unknown as { sql: SQL }).sql;
    const attempt = async (q: () => Promise<unknown>) => { try { await q(); return "wrote"; } catch (e) { return String((e as Error).message); } };
    expect(await attempt(() => conn`insert into network.events (at, actor_type, type) values (now(), 'sim', 'x')`)).toMatch(/read-only/);
    expect(await attempt(() => conn`update network.members set name = 'x'`)).toMatch(/read-only/);
    expect(await attempt(() => conn`delete from network.messages`)).toMatch(/read-only/);
    expect((await r.control({ type: "play" })).ok).toBe(false);
    expect((await r.control({ type: "propose", participants: ["a", "b"] })).ok).toBe(false);
  });

  test("game → Postgres → real parity: the same graph, opportunities, meetings and messages", async () => {
    const g = new GameSource({ seed: 4, personas: 80, days: 12, pushMs: 3_600_000, tickMs: 3_600_000, network: "stub", city: "all" });
    await g.init();
    await g.control({ type: "step", ms: 10 * DAY });
    const game = g.state();
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    await g.dispose();
    const rs = await open();
    const real = rs.state();
    expect(game.stats.meetingsHeld).toBeGreaterThan(0);
    expect(real.members.length).toBe(game.members.length);
    expect(real.stats.joined).toBe(game.stats.joined);
    expect(real.stats.edgesByType).toEqual(game.stats.edgesByType);
    expect(real.stats.oppsByState).toEqual(game.stats.oppsByState);
    expect(real.stats.proposalsBySource).toEqual(game.stats.proposalsBySource);
    for (const k of ["messages", "inbound", "outbound", "proactive", "invites", "meetingsScheduled", "meetingsHeld", "attended", "noShows", "cancelledWithNotice", "optOuts"] as const)
      expect([k, real.stats[k]]).toEqual([k, game.stats[k]]);
    expect(real.stats.enjoymentSum).toBeCloseTo(game.stats.enjoymentSum, 4);
    expect(real.engineRuns.map(r => r.id).sort()).toEqual(game.engineRuns.map(r => r.id).sort());
    // Per-opportunity parity, including participant statuses and enjoyment.
    const byId = new Map(real.opportunities.map(o => [o.id, o]));
    for (const o of game.opportunities) {
      const ro = byId.get(o.id)!;
      expect([o.id, ro.state, ro.status, ro.enjoyment]).toEqual([o.id, o.state, o.status, o.enjoyment]);
    }
    // Per-member activity counters.
    const rm = new Map(real.members.map(m => [m.id, m]));
    for (const m of game.members) {
      const c = rm.get(m.id)!.counters;
      expect([m.id, c.msgsIn, c.msgsOut, c.proposals, c.meetings]).toEqual([m.id, m.counters.msgsIn, m.counters.msgsOut, m.counters.proposals, m.counters.meetings]);
    }
    // What members wrote never leaves the database by default: only its length and time.
    const talker = game.members.filter(m => m.counters.msgsIn > 0 && m.counters.msgsOut > 0)[0]!;
    const rows = await sql`select direction, body from network.messages where member_id = ${talker.id} and not system order by ts, id`;
    const d = (await rs.member(talker.id))!;
    const inbound = d.messages.filter(m => m.direction === "inbound" && !m.system);
    expect(inbound.length).toBe(talker.counters.msgsIn);
    expect(inbound.every(m => m.body === HIDDEN_MESSAGE && (m.hiddenLength ?? 0) > 0 && m.ts > 0)).toBe(true);
    const json = JSON.stringify(d);
    for (const r of rows as { direction: string; body: string }[]) if (r.direction === "inbound" && r.body.length > 12) expect(json.includes(r.body)).toBe(false);
    expect(d.messages.some(m => m.direction === "outbound" && m.body.length > 0 && m.body !== HIDDEN_MESSAGE)).toBe(true);
    // OBSERVATORY_REVEAL_PII (local only) shows them.
    const revealed = (await (await open({ revealPii: true })).member(talker.id))!;
    expect(revealed.messages.filter(m => m.direction === "inbound" && !m.system).map(m => m.body)).toContain((rows as { direction: string; body: string }[]).find(r => r.direction === "inbound")!.body);
  }, T);

  test("shadow engine run: proposals shown, nothing written", async () => {
    const r = await open();
    const before = (await sql`select count(*)::int as n from network.opportunities`)[0].n;
    const res = await r.control({ type: "shadow_run" });
    expect(res.ok).toBe(true);
    const s = r.state();
    const shadow = s.opportunities.filter(o => o.source === "shadow");
    expect(shadow.length).toBe((res.data as { proposals: number }).proposals);
    expect(s.engineRuns.filter(x => x.shadow).length).toBe(2);
    expect((await sql`select count(*)::int as n from network.opportunities`)[0].n).toBe(before);
    // Shadow proposals never count as real proposals.
    expect(s.stats.proposalsBySource.shadow).toBeUndefined();
    const snap = await r.snapshot();
    expect(snap.members.length).toBeGreaterThan(0);
    expect(snap.members.every(m => m.prefs && Array.isArray(m.prefs.categoriesOptIn))).toBe(true);
  }, T);
  test("under 18 follows the Network's age state, not only the record age (network.md 6.3)", async () => {
    const now = new Date();
    const member = (id: string, age: number | null) => ({ id, name: `${id} Test`, home_city: "nyc", account_status: "active", participation_state: "normal", opted_out: false, age, prefs: {}, unanswered_proactive: 0, joined_at: now });
    const nm = (id: string, minor: boolean, ageUnknown?: boolean) => ({ id, minor, ...(ageUnknown ? { ageUnknown } : {}) });
    const rows = {
      // adult: no record age, said "34" (resolved). signal: record age 30, said something a minor says. quiet: no record age, never answered.
      members: [member("adult", null), member("signal", 30), member("quiet", null), member("unseen", null)],
      channel_identities: [], facets: [], intents: [], presence: [], edges: [], review_items: [], messages: [], feedback: [], events: [], matching_runs: [], requests: [],
      opportunities: [{ id: "o1", kind: "intro", state: "IN_REVIEW", source: "engine", city: "nyc", objective: "a coffee", explanations: {}, exploration: false, created_at: now, updated_at: now }],
      participations: ["adult", "signal"].map(id => ({ opportunity_id: "o1", member_id: id, role: "participant", status: "pending" })),
      network_state: [{ id: "nyc", version: 1, saved_at: now, state: { matchingEnabled: true, deferred: [], members: [nm("adult", false), nm("signal", true), nm("quiet", true, true)] } }],
    };
    await writeRows(sql, rows as unknown as Parameters<typeof writeRows>[1], { truncate: true });
    const r = await open();
    const m = new Map(r.state().members.map(x => [x.id, x]));
    expect(["adult", "signal", "quiet", "unseen"].map(id => [id, m.get(id)!.minor, !!m.get(id)!.ageUnknown])).toEqual([
      ["adult", false, false], ["signal", true, false], ["quiet", true, true], ["unseen", true, true],
    ]);
    const safety = await r.safety();
    expect(safety.minors.inOpportunities.map(x => x.memberId)).toEqual(["signal"]);
    expect(safety.minors.members).toEqual(["signal"]);
    expect(safety.minors.unknownAge.sort()).toEqual(["quiet", "unseen"]);
  }, T);
});
