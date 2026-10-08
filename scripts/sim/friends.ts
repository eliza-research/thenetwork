// The friends block: friends.help in the NYC friends world (400 personas with 13-17 year olds, age
// liars, adversaries and canaries; weekly plans, partner intros and crews), the official launch gates
// (adopted 2026-10-08, all blocking) against random-within-area and the oracle on the same seeds, the
// tracked metrics (printed, non-blocking), the harness caps, and the conformance rules for friendsPack.
// PINNED (CI): seeds 5-8, 8 weeks, 400 personas (docs/results/2026-10-08-friends-pack.md, held-out).
// --quick: seed 5, 4 weeks, 200 personas; only the safety gates block.
import { canBeMatched, type MemberId } from "../../packages/core/src/index.ts";
import * as A from "../../packages/engine/src/attention.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { runEngine } from "../../packages/engine/src/engine.ts";
import { candidateReason, memberReason } from "../../packages/engine/src/filters.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, ROMANCE_FRAMING, friendsInfo, friendsPack, planFriendsWeek } from "../../packages/engine/src/packs/friends/index.ts";
import { buildPlanProbe } from "../../packages/engine/src/plans.ts";
import type { Candidate, EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { BASELINES } from "../../packages/sim/src/apps/friends/baselines.ts";
import { officialGates, trackedMetrics } from "../../packages/sim/src/apps/friends/gates.ts";
import { friendsMetrics, type FriendsMetrics } from "../../packages/sim/src/apps/friends/metrics.ts";
import { engineInputOf, evidenceOf, friendsPackMatcher } from "../../packages/sim/src/apps/friends/packMatcher.ts";
import { buildFriendsSnapshot, NYC_TZ, type FriendsSnapshot } from "../../packages/sim/src/apps/friends/snapshot.ts";
import { runFriendsWorld, VENUES } from "../../packages/sim/src/apps/friends/world.ts";
import { conformance } from "./conformance.ts";
import { Block, digest, expect } from "./gate.ts";

export const FRIENDS_PINNED = { seeds: [5, 6, 7, 8], weeks: 8, n: 400 };
const SAFETY = new Set(["minors", "known_adversary"]);

/** A friends world after `weeks` weeks of friendsPack meetups: the snapshot the engine would read next. */
const cache = new Map<number, FriendsSnapshot>();
function friendsSnapshotAfter(seed: number, weeks = 3, n = 160): FriendsSnapshot {
  if (!cache.has(seed)) {
    const r = runFriendsWorld({ seed: 100 + seed, n, weeks, matcher: friendsPackMatcher() });
    const st = r.world.state;
    st.week = weeks; st.now += 7 * 86400000;
    cache.set(seed, buildFriendsSnapshot(r.world.personas, st));
  }
  return cache.get(seed)!;
}
const friendsWorld = (seed: number): EngineInput => engineInputOf(friendsSnapshotAfter(seed));

export async function friendsBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const spec = o.quick ? { seeds: [5], weeks: 4, n: 200 } : FRIENDS_PINNED;
  const all: Record<"pack" | "random" | "oracle", FriendsMetrics[]> = { pack: [], random: [], oracle: [] };
  const matchers = { pack: friendsPackMatcher(), random: BASELINES.random, oracle: BASELINES.oracle };
  for (const arm of ["pack", "random", "oracle"] as const) for (const seed of spec.seeds) all[arm].push(friendsMetrics(runFriendsWorld({ seed, n: spec.n, weeks: spec.weeks, matcher: matchers[arm] })));
  b.track("fingerprint: pack, random and oracle arms", true, digest(all));
  for (const g of officialGates(all.pack, all.random, all.oracle)) b.gate(`gate ${g.gate}`, g.pass, g.value, SAFETY.has(g.id) || !o.quick);
  for (const g of trackedMetrics(all.pack, all.random)) b.track(`tracked ${g.gate}`, g.pass, g.value);
  b.gate("pack: 0 declared-minor proposals", all.pack.every(m => m.safety.declaredMinorProposals === 0));

  await b.run("harness: deterministic; no arm contacts a declared minor; tables of at most 6, at most 2 meetups a member a week", () => {
    const runs = [...(["random", "greedy", "oracle"] as const).map(n => runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: BASELINES[n] })), runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() })];
    for (const r of runs) {
      const m = friendsMetrics(r);
      expect(m.proposals).toBeGreaterThan(0);
      expect(m.safety.declaredMinorContacts).toBe(0);
      const meet = new Map<string, number>();
      for (const f of r.flows) { expect(f.going.length).toBeLessThanOrEqual(6); for (const id of f.booked) meet.set(`${id}|${f.week}`, (meet.get(`${id}|${f.week}`) ?? 0) + 1); }
      for (const v of meet.values()) expect(v).toBeLessThanOrEqual(2);
    }
    expect(JSON.stringify(friendsMetrics(runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() })))).toBe(JSON.stringify(friendsMetrics(runs[3]!)));
    // Negative control: random ignores verification and meets adversaries; the oracle never does.
    expect(friendsMetrics(runs[0]!).safety.adversaryContacts).toBeGreaterThan(0);
    expect(friendsMetrics(runs[2]!).safety.adversaryContacts + friendsMetrics(runs[2]!).safety.hiddenMinorContacts).toBe(0);
  });

  // ---- conformance: core rules on friends worlds, then the friends rules ------------------------------
  const seeds = o.quick ? [1, 2] : [1, 2, 3, 4];
  await conformance(b, friendsPack, { world: friendsWorld, seeds });
  const worldOf = (seed: number) => new World(friendsWorld(seed), resolveConfig({ seed }), localEmbed, friendsPack);
  const weekOf = (seed: number) => {
    const s = friendsSnapshotAfter(seed), w = worldOf(seed);
    return { s, w, wk: planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS) };
  };
  const allPlans = (wk: ReturnType<typeof weekOf>["wk"]) => [...wk.sessions, ...wk.offers.map(x => x.first), ...wk.repeats, ...wk.plans, ...wk.partners];

  await b.run("conformance friends: no romance at any layer (lane, member, pair, attention item, probe, explanations, plan probes)", async () => {
    expect(friendsPack.ontology.lanes.map(l => l.id)).not.toContain("romance");
    expect(friendsPack.ontology.objectives.some(x => x.romance)).toBe(false);
    const w = worldOf(1);
    const adults = w.ids.filter(id => !memberReason(w, id, { category: "social", role: "peer", format: "small_group", timeSensitive: false }));
    expect(adults.length).toBeGreaterThan(20);
    const [a, c] = adults as [MemberId, MemberId];
    expect(memberReason(w, a, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("romance_excluded");
    const cand = { key: "x", kind: "intro", generator: "x", category: "romance", participants: [a, c], roles: { [a]: "peer", [c]: "peer" }, format: "one_to_one", objective: "x", channels: new Set<string>(), evidence: {}, fit: 1, benefit: {}, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "" } as unknown as Candidate;
    expect(candidateReason(w, cand)).toBe("romance_excluded");
    expect(friendsPack.attention.itemGate!({ age: 30 }, { category: "romance" })).not.toBeNull();
    expect(friendsPack.attention.probeAllowed!("romance", 1)).toBe(false);
    for (const seed of seeds) {
      const { s, w: ww, wk } = weekOf(seed);
      const r = await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack });
      expect(r.proposals.length).toBeGreaterThan(0);
      for (const p of r.proposals) {
        expect(["social", "hobby"]).toContain(p.category);
        for (const t of Object.values(p.explanations)) expect(t).not.toMatch(ROMANCE_FRAMING);
        for (const me of p.participants) { const probe = A.buildProbe(ww, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: NYC_TZ }, me, p.participants.filter(x => x !== me), s.now); if (probe) expect(probe.text).not.toMatch(ROMANCE_FRAMING); }
      }
      let probes = 0;
      for (const p of allPlans(wk)) for (const me of p.invited) { const t = buildPlanProbe(ww, p, me, s.now, NYC_TZ); if (t) { probes++; expect(t).not.toMatch(ROMANCE_FRAMING); expect(t).not.toMatch(/canary/i); } }
      expect(probes).toBeGreaterThan(0);
    }
  });

  await b.run("conformance friends: no minors in any plan role (sessions, offers, repeats, plans, partners)", () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const plans = allPlans(wk);
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) for (const id of [...p.invited, ...p.alternates, ...(p.hostId ? [p.hostId] : [])]) expect(canBeMatched(w.get(id)!.m.age)).toBe(true);
    }
  });

  await b.run("conformance friends: adversaries the Network can see are held (no uncleared cue, unpassed check or hold in any proposal or plan)", async () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const info = friendsInfo(w);
      const flagged = new Set(w.ids.filter(id => info.get(id)!.safetyCue || !info.get(id)!.verified || w.holds.has(id)));
      expect(flagged.size).toBeGreaterThan(0);
      for (const p of (await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack })).proposals) for (const id of [...p.participants, ...p.alternates]) expect(flagged.has(id)).toBe(false);
      for (const p of allPlans(wk)) for (const id of [...p.invited, ...p.alternates]) expect(flagged.has(id)).toBe(false);
    }
  });
}
