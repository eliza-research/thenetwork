// Game mode with the consent-first Network (the default): NYC only, probes before reveals, real
// venues, growth joiners, scenario levels, and Postgres parity.
import { afterEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const live: GameSource[] = [];
async function game(opts: ConstructorParameters<typeof GameSource>[0] = {}) {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, ...opts });
  live.push(g);
  await g.init();
  return g;
}
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

describe("consent-first game mode (NYC)", () => {
  test("NYC only; probes come before reveals; meetings at real venues; engine runs linked", async () => {
    const g = await game();
    let s = g.state();
    expect(s.members.length).toBe(250);
    expect(s.members.every(m => m.city === "nyc")).toBe(true);
    expect(s.env.label).toContain("consent-first");
    await g.control({ type: "step", ms: 6 * DAY });
    s = g.state();
    expect(s.engineRuns.length).toBeGreaterThanOrEqual(5);
    expect(s.network?.kind).toBe("consent");
    expect(s.network!.counters.probesSent).toBeGreaterThan(20);
    const engineOpps = s.opportunities.filter(o => o.origin === "engine");
    expect(engineOpps.length).toBeGreaterThan(0);
    expect(engineOpps.every(o => o.runId && s.engineRuns.some(r => r.id === o.runId))).toBe(true);
    // Anything that reached an invitation went through availability checks first.
    const revealed = s.opportunities.filter(o => !["PROPOSED", "SKIPPED"].includes(o.state));
    expect(revealed.length).toBeGreaterThan(0);
    const met = s.opportunities.filter(o => o.state === "SCHEDULED" || o.state === "COMPLETED" || o.state === "FEEDBACK_COLLECTED");
    expect(met.length).toBeGreaterThan(0);
    for (const o of met) { expect(o.venue).toBeDefined(); expect(o.venue!.lat).toBeGreaterThan(40.5); expect(o.venue!.lng).toBeLessThan(-73.7); }
    const skipped = s.opportunities.filter(o => o.state === "SKIPPED");
    expect(skipped.every(o => !!o.reason)).toBe(true);
  }, T);

  test("player intros go through probes; a minor is still a strike and never contacted", async () => {
    const g = await game({ engine: "off" });
    await g.control({ type: "step", ms: 2 * DAY });
    const s = g.state();
    const adults = s.members.filter(m => m.joined && !m.minor && m.trust !== "hold");
    const minor = s.members.find(m => m.minor && m.joined)!;
    const ok = await g.control({ type: "propose", participants: [adults[0]!.id, adults[1]!.id], why: "you both like climbing" });
    const id = (ok.data as { id: string }).id;
    await g.control({ type: "propose", participants: [minor.id, adults[2]!.id] });
    await g.control({ type: "step", ms: 2 * DAY });
    const after = g.state();
    const mine = after.opportunities.filter(o => o.source === "player");
    expect(mine.length).toBe(2); // one opportunity per proposal, no duplicates
    const o = after.opportunities.find(x => x.id === id)!;
    expect(o.state).not.toBe("PROPOSED");
    expect(after.game!.strikes).toBe(1);
    const md = await g.member(minor.id);
    expect(md!.messages.some(m => m.type === "probe" || m.type === "proposal")).toBe(false);
  }, T);

  test("invited friends join and appear in the graph", async () => {
    const g = await game({ scenario: "newcomer_wave" });
    await g.control({ type: "step", ms: 7 * DAY });
    const s = g.state();
    expect(s.members.length).toBeGreaterThan(250);
    const newIds = s.members.filter(m => !/^ny-/.test(m.id)).map(m => m.id);
    expect(newIds.length).toBeGreaterThan(0);
    expect(s.edges.some(e => e.type === "invited_by" && newIds.includes(e.to))).toBe(true);
    expect(s.feed.some(f => f.kind === "growth")).toBe(true);
  }, T);

  test("scenario levels play in the observatory and their checks pass", async () => {
    for (const id of ["spam_wave", "block_abuse", "minor_signal"]) {
      const g = await game({ scenario: id });
      await g.control({ type: "step", ms: 5 * DAY });
      const r = await g.control({ type: "check_scenario" });
      expect(r.ok).toBe(true);
      const d = r.data as { pass: boolean; checks: { name: string; pass: boolean; detail: string }[] };
      expect([id, d.checks.filter(c => !c.pass).map(c => `${c.name}: ${c.detail}`)]).toEqual([id, []]);
      expect(g.state().network?.scenario?.id).toBe(id);
    }
  }, T);

  test.skipIf(!pgAvailable)("consent game → Postgres → real parity", async () => {
    const url = await testDb();
    const g = await game();
    await g.control({ type: "step", ms: 6 * DAY });
    const gs = g.state();
    const sql = new SQL(url);
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    await sql.close();
    const r = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000 });
    await r.init();
    const rs = r.state();
    await r.dispose();
    expect(rs.members.length).toBe(gs.members.length);
    expect(rs.stats.edgesByType).toEqual(gs.stats.edgesByType);
    expect(rs.stats.oppsByState).toEqual(gs.stats.oppsByState);
    expect(rs.stats.meetingsHeld).toBe(gs.stats.meetingsHeld);
    expect(rs.stats.messages).toBe(gs.stats.messages);
  }, T);
});
