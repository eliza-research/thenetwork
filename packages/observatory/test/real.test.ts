// Real-world mode against Postgres: reads the network schema correctly, matches what was written
// (dataset and a full simulated run: game → DB → real parity), never writes, scrubs PII.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { DATA_DIR, readJsonl, type EdgeRecord, type FacetRecord } from "../../../scripts/synthetic/common.ts";
import { rowsFromDataset, rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { pgAvailable, testDb } from "./pg.ts";

const T = 180_000;
const PHONE = /\+?1?[-\s.]?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

describe.skipIf(!pgAvailable)("RealSource (Postgres)", () => {
  let url: string;
  let sql: SQL;
  const sources: RealSource[] = [];
  const open = async (opts: Partial<ConstructorParameters<typeof RealSource>[0]> = {}) => {
    const r = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, ...opts });
    sources.push(r);
    await r.init();
    return r;
  };
  beforeAll(async () => { url = await testDb(); sql = new SQL(url); }, T);
  afterAll(async () => { for (const s of sources) await s.dispose(); await sql?.close(); });

  test("not configured: a clear error, no crash", async () => {
    const r = new RealSource({ url: undefined });
    const prev = [process.env.NETWORK_DATABASE_URL, process.env.DATABASE_URL];
    delete process.env.NETWORK_DATABASE_URL; delete process.env.DATABASE_URL;
    const r2 = new RealSource({});
    await r2.init();
    expect(r2.state().env.error).toContain("NETWORK_DATABASE_URL");
    expect(r2.state().members.length).toBe(0);
    [process.env.NETWORK_DATABASE_URL, process.env.DATABASE_URL] = prev;
    await r.dispose(); await r2.dispose();
  });

  test("dataset → Postgres → real mode: members, graph and facets match the files; PII and private facts are scrubbed", async () => {
    await writeRows(sql, await rowsFromDataset(), { truncate: true });
    const r = await open();
    const s = r.state();
    expect(s.env.mode).toBe("real");
    expect(s.env.capabilities).toEqual({ canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true });
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
    const real = (await open()).state();
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
});
