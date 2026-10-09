// Game mode with the consent-first Network (the default): NYC only, human review before any
// contact (PRD 32.8), probes before reveals, real venues, growth joiners, scenario levels, the age
// policy, private facets behind the truth lens, the judge scorer, and Postgres parity.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, MINUTE } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const live: GameSource[] = [];
async function game(opts: ConstructorParameters<typeof GameSource>[0] = {}) {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, ...opts });
  live.push(g);
  await g.init();
  return g;
}
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });
afterAll(async () => { await dropTestDb(); });
/** Messages the Network sent a member about an opportunity (probe key or proposal id). */
const about = (g: GameSource, memberId: string, oppId: string) =>
  g.world.channel.messagesFor(memberId).filter(m => m.direction === "outbound" && (m.meta?.proposalId === oppId || (m.meta?.probe as { key?: string } | undefined)?.key === oppId));

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
    // Game mode defaults to the simulated reviewer: every Network opportunity was reviewed first.
    expect(s.network!.review).toMatchObject({ mode: "auto", queued: 0, rejected: 0, expired: 0 });
    expect(s.network!.review.approved).toBeGreaterThan(0);
    expect(engineOpps.every(o => o.review?.decision === "approve" && o.review.reviewer === "sim_auto_reviewer")).toBe(true);
    // The judge scorer runs over the records: no canary leaks, no minor contacts.
    expect(s.stats.judge).toBeDefined();
    expect(s.stats.judge!.canaryLeaks).toBe(0);
    expect(s.stats.judge!.minorContacts).toBe(0);
    expect(s.stats.invariantViolations).toBe(s.stats.judge!.invariants);
  }, T);

  test("human review: nothing is sent before approval; approve starts probes; reject and expiry send nothing", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY }); // the nightly engine run is at 9:00; the world starts at 13:00
    let s = g.state();
    expect(s.network!.review.mode).toBe("human");
    const queued = s.opportunities.filter(o => o.state === "IN_REVIEW");
    expect(queued.length).toBeGreaterThanOrEqual(3);
    expect(s.network!.review.queued).toBe(queued.length);
    expect(queued.every(o => o.review && !o.review.decision && o.review.deadline > o.review.queuedAt)).toBe(true);
    expect(s.network!.counters.probesSent).toBe(0);
    for (const o of queued) for (const id of o.participants) expect(about(g, id, o.id)).toEqual([]);
    const yes = queued.find(o => o.origin === "engine")!;
    const [no, late] = queued.filter(o => o !== yes) as [typeof yes, typeof yes];

    expect((await g.control({ type: "review", oppId: yes.id, decision: "approve" })).ok).toBe(true);
    expect((await g.control({ type: "review", oppId: no.id, decision: "reject", reason: "weak_reason", note: "thin reason" })).ok).toBe(true);
    expect((await g.control({ type: "review", oppId: no.id, decision: "approve" })).ok).toBe(false); // already decided
    expect((await g.control({ type: "review", oppId: late.id, decision: "reject", reason: "bogus" as never })).ok).toBe(false);
    s = g.state();
    const a = s.opportunities.find(o => o.id === yes.id)!, b = s.opportunities.find(o => o.id === no.id)!;
    expect(a.state).not.toBe("IN_REVIEW");
    expect(a.review).toMatchObject({ decision: "approve", reviewer: "player" });
    expect(b.state).toBe("SKIPPED");
    expect(b.reason).toContain("rejected in review");
    expect(b.review).toMatchObject({ decision: "reject", reason: "weak_reason", note: "thin reason", reviewer: "player" });
    await g.control({ type: "step", ms: 18 * 3_600_000 }); // past the 12 h SLA
    s = g.state();
    expect(s.network!.counters.probesSent).toBeGreaterThan(0);
    expect(a.participants.some(id => about(g, id, yes.id).length > 0)).toBe(true);
    for (const id of no.participants) expect(about(g, id, no.id)).toEqual([]);
    const l = s.opportunities.find(o => o.id === late.id)!;
    expect([l.state, l.review?.decision]).toEqual(["SKIPPED", "expired"]);
    for (const id of late.participants) expect(about(g, id, late.id)).toEqual([]);
    expect(s.network!.review.rejected).toBe(1);
    expect(s.network!.review.expired).toBeGreaterThan(0);
    // Switching to the simulated reviewer approves what is waiting.
    expect((await g.control({ type: "review_mode", mode: "auto" })).ok).toBe(true);
    s = g.state();
    expect(s.network!.review).toMatchObject({ mode: "auto", queued: 0 });
    expect(s.opportunities.some(o => o.state === "IN_REVIEW")).toBe(false);
  }, T);

  test("review rules: reason 'other' needs a note; approve is refused when the member record turns minor while the item waits", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY });
    const [a, b] = g.state().opportunities.filter(o => o.state === "IN_REVIEW");
    expect(await g.control({ type: "review", oppId: a!.id, decision: "reject", reason: "other" })).toMatchObject({ ok: false, error: expect.stringContaining("needs a note") });
    expect((await g.control({ type: "review", oppId: a!.id, decision: "reject", reason: "other", note: "duplicate of a staff intro" })).ok).toBe(true);
    // A staff correction: the record now says 16. The Network reads the record again and takes the
    // member out of the waiting item (minors policy), so approve is refused (any caller) and nothing is sent.
    g.world.personaList().find(p => p.id === b!.participants[0])!.public.claimedAge = 16;
    await g.control({ type: "step", ms: 30 * MINUTE });
    expect(await g.control({ type: "review", oppId: b!.id, decision: "approve" })).toMatchObject({ ok: false, error: expect.stringMatching(/under 18|minors policy/) });
    expect(g.consent!.review(b!.id, "approve", { reviewer: "script" })).toBe(false);
    await g.control({ type: "step", ms: 2 * 3_600_000 });
    for (const id of b!.participants) expect(about(g, id, b!.id)).toEqual([]);
  }, T);

  test("member detail: agent-private facets (and their canaries) only under the truth lens", async () => {
    const g = await game({ engine: "off" });
    await g.control({ type: "step", ms: DAY });
    const priv = g.world.snapshot().facets.filter(f => f.scope === "agent_private");
    expect(priv.length).toBeGreaterThan(0);
    const f = priv.find(x => /\(ref /.test(x.value)) ?? priv[0]!;
    const hidden = (await g.member(f.memberId))!;
    expect(hidden.facets.find(x => x.id === f.id)!.value).toBe("[private]");
    expect(JSON.stringify(hidden.facets)).not.toContain(f.value);
    expect((await g.member(f.memberId, { truth: true }))!.facets.find(x => x.id === f.id)!.value).toBe(f.value);
  }, T);

  test("player intros wait for review like everything else, then go through probes; propose() refuses a known minor", async () => {
    const g = await game({ engine: "off", review: "human" });
    await g.control({ type: "step", ms: 2 * DAY });
    const s = g.state();
    const adults = s.members.filter(m => m.joined && !m.minor && m.trust !== "hold");
    const minor = s.members.find(m => m.minor && m.joined)!;
    const ok = await g.control({ type: "propose", participants: [adults[0]!.id, adults[1]!.id], why: "you both like climbing" });
    const id = (ok.data as { id: string }).id;
    expect((ok.data as { dispatch: string }).dispatch).toContain("review queue");
    const refused = await g.control({ type: "propose", participants: [minor.id, adults[2]!.id] });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("under 18");
    await g.control({ type: "step", ms: DAY }); // the morning batch (09:00) queues it; the 12 h SLA has not passed
    const queued = g.state().opportunities.find(x => x.id === id)!;
    expect(queued.state).toBe("IN_REVIEW");
    for (const p of queued.participants) expect(about(g, p, id)).toEqual([]);
    expect((await g.control({ type: "review", oppId: id, decision: "approve" })).ok).toBe(true);
    await g.control({ type: "step", ms: 2 * DAY });
    const after = g.state();
    const mine = after.opportunities.filter(o => o.source === "player");
    expect(mine.length).toBe(1); // one opportunity per proposal, no duplicates; nothing for the minor
    const o = after.opportunities.find(x => x.id === id)!;
    expect(o.review).toMatchObject({ decision: "approve", reviewer: "player" });
    expect(o.state).not.toBe("PROPOSED");
    expect(after.game!.strikes).toBe(0);
    const md = await g.member(minor.id);
    expect(md!.messages.some(m => m.type === "probe" || m.type === "proposal")).toBe(false);
  }, T);

  test("age levels: an under-13 joiner is declined and can't be proposed; a stated minor is flagged", async () => {
    const g = await game({ scenario: "under_13_join" });
    await g.control({ type: "step", ms: 4 * DAY });
    const r = await g.control({ type: "check_scenario" });
    expect((r.data as { pass: boolean }).pass).toBe(true);
    const s = g.state();
    const kid = s.members.find(m => m.declined)!;
    expect(kid).toBeDefined();
    expect(kid.minor).toBe(true);
    const decline = s.feed.find(f => /under 13/.test(f.text))!;
    expect(decline.members).toBeUndefined();
    const adult = s.members.find(m => m.joined && !m.minor)!;
    const refused = await g.control({ type: "propose", participants: [kid.id, adult.id] });
    expect(refused.error).toContain("declined at join");
    // The rows written to Postgres keep only the id and the decline (docs/network.md 6.3).
    const rows = rowsFromGame(g);
    expect(rows.members.find(m => m.id === kid.id)).toMatchObject({ name: null, home_city: null, home_area: null, age: null, bio: null, prefs: {}, invited_by: null, joined_at: null, account_status: "removed" });
    expect(rows.opportunities.filter(o => JSON.stringify(o).includes(kid.id))).toEqual([]);
    for (const t of ["channel_identities", "facets", "intents", "presence", "messages", "participations", "feedback"] as const)
      expect([t, rows[t].filter(r => r.member_id === kid.id || r.from_id === kid.id)]).toEqual([t, []]);
    expect(rows.edges.filter(e => e.from_id === kid.id || e.to_id === kid.id)).toEqual([]);
    expect(rows.events.filter(e => e.actor_id === kid.id || e.object_id === kid.id)).toEqual([]);

    const t = await game({ scenario: "stated_minor_first_message" });
    await t.control({ type: "step", ms: 4 * DAY });
    expect(((await t.control({ type: "check_scenario" })).data as { pass: boolean }).pass).toBe(true);
    const teen = t.state().members.find(m => m.id === t.scenarioIds.teen)!;
    expect(teen.minor).toBe(true);
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
    const r = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await r.init();
    const rs = r.state();
    await r.dispose();
    // Review decisions are written to network.review_items and read back (read-only).
    const reviewed = gs.opportunities.filter(o => o.review);
    expect(reviewed.length).toBeGreaterThan(0);
    const byId = new Map(rs.opportunities.map(o => [o.id, o]));
    for (const o of reviewed) expect([o.id, byId.get(o.id)?.review]).toEqual([o.id, o.review]);
    expect(rs.members.length).toBe(gs.members.length);
    expect(rs.stats.edgesByType).toEqual(gs.stats.edgesByType);
    expect(rs.stats.oppsByState).toEqual(gs.stats.oppsByState);
    expect(rs.stats.meetingsHeld).toBe(gs.stats.meetingsHeld);
    expect(rs.stats.messages).toBe(gs.stats.messages);
  }, T);
});
