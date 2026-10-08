// Game mode end to end on small generated worlds: determinism, engine capture, player proposals
// through the real pipeline, the minors policy and safety strikes, member takeover, truth lens.
import { afterEach, describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import type { ObsState } from "../src/types.ts";
import { DATA_DIR, readJsonl, type EdgeRecord, type MemberRecord } from "../../../scripts/synthetic/common.ts";

const T = 120_000;
const live: GameSource[] = [];
async function game(opts: ConstructorParameters<typeof GameSource>[0]) {
  // These tests cover the stub Network over both cities; consent.test.ts covers the consent Network.
  const g = new GameSource({ pushMs: 60_000, tickMs: 60_000, network: "stub", city: "all", ...opts });
  live.push(g);
  await g.init();
  return g;
}
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

const OPEN = new Set(["PROPOSED", "INVITING", "PARTIALLY_ACCEPTED", "MUTUALLY_ACCEPTED", "QUORUM_MET", "SCHEDULED"]);
function freeAdults(g: GameSource, s: ObsState, city: "sf" | "nyc") {
  const busy = new Set(s.opportunities.filter(o => OPEN.has(o.state)).flatMap(o => o.participants));
  const truth = g.store.truth!;
  return s.members.filter(m => m.city === city && m.joined && !m.minor && m.state === "normal" && !busy.has(m.id)
    && !truth[m.id]!.adversarial && truth[m.id]!.archetype !== "never_replies");
}
const fingerprint = (s: ObsState) => JSON.stringify({
  clock: s.clock.now, stats: s.stats, opps: s.opportunities.map(o => [o.id, o.state, o.status, o.enjoyment]),
  edges: s.edges.map(e => e.id).sort(), runs: s.engineRuns.map(r => [r.id, r.proposals, r.funnel]),
});

describe("GameSource", () => {
  test("same seed, same world (deterministic), and engine runs are captured", async () => {
    const a = await game({ seed: 3, personas: 60, days: 10 });
    const b = await game({ seed: 3, personas: 60, days: 10 });
    await a.control({ type: "step", ms: 3 * DAY });
    await b.control({ type: "step", ms: 3 * DAY });
    const sa = a.state(), sb = b.state();
    expect(fingerprint(sa)).toBe(fingerprint(sb));
    expect(sa.engineRuns.length).toBe(6); // 3 nights x 2 cities
    expect(sa.engineRuns.every(r => r.funnel.generated >= r.funnel.selected && r.fairness.lorenz.length > 0)).toBe(true);
    const engineOpps = sa.opportunities.filter(o => o.source === "engine");
    expect(engineOpps.length).toBeGreaterThan(0);
    expect(engineOpps.every(o => o.runId && sa.engineRuns.some(r => r.id === o.runId && r.proposalIds.includes(o.id)))).toBe(true);
    expect(sa.stats.messages).toBeGreaterThan(100);
    // Hidden truth is not in the state unless the lens is on.
    expect(sa.truth).toBeUndefined();
  }, T);

  test("a player intro goes through the pipeline: dispatch, invitations, decisions, scoring", async () => {
    const g = await game({ seed: 5, personas: 60, days: 20, engine: "off" });
    await g.control({ type: "step", ms: 7 * DAY });
    const [x, y] = freeAdults(g, g.state(), "sf");
    const r = await g.control({ type: "propose", participants: [x!.id, y!.id], category: "social", objective: "coffee", why: "you both like coffee" });
    expect(r.ok).toBe(true);
    const id = (r.data as { id: string }).id;
    let o = g.state().opportunities.find(o => o.id === id)!;
    expect(o.source).toBe("player");
    expect(o.state).toBe("PROPOSED");
    expect(o.oracle).toBeDefined();
    expect(g.state().game!.sparksLeft).toBe(5);
    await g.control({ type: "step", ms: 3 * DAY });
    o = g.state().opportunities.find(o => o.id === id)!;
    expect(o.state).not.toBe("PROPOSED");
    expect(Object.values(o.status).some(s => s !== "pending")).toBe(true);
    const detail = await g.opportunity(id);
    expect(detail!.messages.some(m => m.direction === "outbound" && m.proposalId === id)).toBe(true);
    const me = g.state().game!.scores.find(s => s.source === "player")!;
    expect(me.proposals).toBe(1);
  }, T);

  test("minors policy: proposing a member under 18 is a safety strike and is never dispatched", async () => {
    const g = await game({ seed: 11, personas: 120, days: 20, engine: "off" });
    await g.control({ type: "step", ms: 7 * DAY });
    const s = g.state();
    const minor = s.members.find(m => m.minor && m.joined)!;
    expect(minor).toBeDefined();
    const adult = freeAdults(g, s, minor.city as "sf" | "nyc")[0]!;
    const r = await g.control({ type: "propose", participants: [minor.id, adult.id] });
    const id = (r.data as { id: string }).id;
    let gs = g.state();
    expect(gs.opportunities.find(o => o.id === id)!.oracle!.unsafe).toBe(true);
    expect(gs.game!.strikes).toBe(1);
    expect(gs.game!.scores.find(x => x.source === "player")!.points).toBeLessThanOrEqual(-150);
    await g.control({ type: "step", ms: 2 * DAY });
    gs = g.state();
    const o = gs.opportunities.find(o => o.id === id)!;
    expect(o.state).toBe("SKIPPED");
    expect(o.reason).toBe("minors_policy");
    const md = await g.member(minor.id);
    expect(md!.messages.some(m => m.proposalId === id)).toBe(false);
  }, T);

  test("play as a member: the world waits for the player's reply, and a yes is an accept", async () => {
    const g = await game({ seed: 5, personas: 60, days: 20, engine: "off" });
    await g.control({ type: "step", ms: 7 * DAY });
    const [x, y] = freeAdults(g, g.state(), "sf");
    await g.control({ type: "takeover", memberId: x!.id, on: true });
    const r = await g.control({ type: "propose", participants: [x!.id, y!.id], why: "you both like climbing" });
    const id = (r.data as { id: string }).id;
    const stepping = g.control({ type: "step", ms: 2 * DAY });
    let prompt;
    for (let i = 0; i < 200 && !prompt; i++) {
      await Bun.sleep(20);
      prompt = g.state().game!.prompts.find(p => p.memberId === x!.id && p.proposalId === id);
    }
    expect(prompt).toBeDefined();
    expect(g.state().clock.waitingForPlayer).toBe(true);
    const frozen = g.state().clock.now;
    await Bun.sleep(100);
    expect(g.state().clock.now).toBe(frozen); // the world is paused on the player
    const reply = await g.control({ type: "reply", promptId: prompt!.id, text: "Yes, I'm in!" });
    expect(reply.ok).toBe(true);
    expect((reply.data as { decision: string }).decision).toBe("accept");
    // Later prompts (e.g. scheduling) are answered by the persona's own policy.
    const auto = setInterval(() => { for (const p of g.state().game!.prompts) g.control({ type: "reply", promptId: p.id, auto: true }); }, 10);
    await stepping;
    clearInterval(auto);
    const o = g.state().opportunities.find(o => o.id === id)!;
    expect(["accepted", "confirmed", "attended", "cancelled_with_notice", "no_show"]).toContain(o.status[x!.id]);
    const inbound = (await g.member(x!.id))!.messages.filter(m => m.direction === "inbound").map(m => m.body);
    expect(inbound).toContain("Yes, I'm in!");
  }, T);

  test("truth lens, oracle peek cost, god actions, reset", async () => {
    const g = await game({ seed: 2, personas: 40, days: 10, engine: "off" });
    await g.control({ type: "step", ms: 6 * DAY });
    const s = g.state();
    const [x, y] = freeAdults(g, s, "sf");
    expect((await g.member(x!.id))!.truth).toBeUndefined();
    await g.control({ type: "lens", on: true });
    expect(g.state().truth?.[x!.id]).toBeDefined();
    expect((await g.member(x!.id))!.truth?.archetype).toBeDefined();
    expect(g.state().game!.lensUsed).toBe(true);
    const peek = await g.control({ type: "peek", participants: [x!.id, y!.id] });
    expect(peek.ok).toBe(true);
    expect(g.state().game!.scores.find(r => r.source === "player")!.points).toBe(-25);
    await g.control({ type: "god", action: "opt_out", memberId: y!.id });
    await g.control({ type: "step", ms: HOUR });
    expect(g.state().members.find(m => m.id === y!.id)!.state).toBe("opted_out");
    await g.control({ type: "reset", seed: 9 });
    const r = g.state();
    expect(r.clock.now).toBe(r.clock.start);
    expect(r.opportunities.length).toBe(0);
    expect(r.game!.lensUsed).toBe(false);
    expect(r.env.label).toContain("seed 9");
  }, T);

  test("the 500-member synthetic dataset loads with its known graph", async () => {
    const g = await game({ seed: 1, days: 5 });
    const s = g.state();
    const members = await readJsonl<MemberRecord>(`${DATA_DIR}/members.jsonl`);
    const edges = await readJsonl<EdgeRecord>(`${DATA_DIR}/edges.jsonl`);
    const expected: Record<string, number> = {};
    for (const e of new Map(edges.map(e => [e.type === "knows" ? `${e.type}|${[e.from, e.to].sort().join("|")}` : `${e.type}|${e.from}|${e.to}`, e])).values()) expected[e.type] = (expected[e.type] ?? 0) + 1;
    expect(s.members.length).toBe(members.length);
    expect(s.stats.edgesByType).toEqual(expected);
    expect(s.members.filter(m => m.minor).length).toBeGreaterThan(0);
    await g.control({ type: "step", ms: DAY });
    expect(g.state().stats.joined).toBe(members.length);
    expect(g.state().engineRuns.length).toBe(2);
  }, T);
});
