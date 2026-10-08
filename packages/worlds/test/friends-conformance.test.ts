// friendsPack passes the shared per-pack conformance suite (packages/engine/test/conformance.ts) on
// friends.help worlds (NYC personas with 13-17 year olds, age liars, adversaries, canaries, holds
// and blocks from reports, three weeks of meetup history), plus friends-specific checks: no romance
// anywhere (lane, rules, copy), no minors in any plan, adversaries the Network can see are held.
// No LLM calls (friendsPack has no judge).
import { describe, expect, setDefaultTimeout, test } from "bun:test";

// Whole-world simulations: allow for a loaded machine when the full suite runs in parallel.
setDefaultTimeout(120_000);
import { canBeMatched, type MemberId } from "@thenetwork/core";
import * as A from "@thenetwork/engine/src/attention.ts";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { runEngine } from "@thenetwork/engine/src/engine.ts";
import { candidateReason, memberReason } from "@thenetwork/engine/src/filters.ts";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, ROMANCE_FRAMING, friendsInfo, friendsPack, planFriendsWeek } from "@thenetwork/engine/src/packs/friends/index.ts";
import { buildPlanProbe } from "@thenetwork/engine/src/plans.ts";
import type { Candidate, EngineInput } from "@thenetwork/engine/src/types.ts";
import { World } from "@thenetwork/engine/src/world.ts";
import { runConformance } from "../../engine/test/conformance.ts";
import { NYC_TZ, buildFriendsSnapshot, engineInputOf, evidenceOf, friendsMetrics, friendsPackMatcher, runFriendsWorld, VENUES, type FriendsSnapshot } from "../src/friends/index.ts";

/** A friends world after `weeks` weeks of friendsPack meetups: the snapshot the engine would read next. */
const cache = new Map<number, FriendsSnapshot>();
export function friendsSnapshotAfter(seed: number, weeks = 3, n = 160): FriendsSnapshot {
  if (!cache.has(seed)) {
    const r = runFriendsWorld({ seed: 100 + seed, n, weeks, matcher: friendsPackMatcher() });
    const st = r.world.state;
    st.week = weeks; st.now += 7 * 86400000;
    cache.set(seed, buildFriendsSnapshot(r.world.personas, st));
  }
  return cache.get(seed)!;
}
const friendsWorld = (seed: number): EngineInput => engineInputOf(friendsSnapshotAfter(seed));

runConformance(friendsPack, { world: friendsWorld, seeds: [1, 2, 3, 4] });

describe("friendsPack: friends-specific checks", () => {
  const seeds = [1, 2, 3, 4];
  const worldOf = (seed: number) => new World(friendsWorld(seed), resolveConfig({ seed }), localEmbed, friendsPack);
  const weekOf = (seed: number) => {
    const s = friendsSnapshotAfter(seed), w = worldOf(seed);
    return { s, w, wk: planFriendsWeek(w, { now: s.now, tz: NYC_TZ, evidence: evidenceOf(w, s), venues: VENUES, crews: s.crews.filter(c => !c.handedOff), outcomes: s.outcomes, offered: s.offered }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS) };
  };
  const allPlans = (wk: ReturnType<typeof weekOf>["wk"]) => [...wk.sessions, ...wk.offers.map(o => o.first), ...wk.repeats, ...wk.plans, ...wk.partners];

  test("registration: no romance lane, id friends, 13-17 tier never matchable", () => {
    expect(friendsPack.id).toBe("friends");
    expect(friendsPack.ontology.lanes.map(l => l.id)).not.toContain("romance");
    expect(friendsPack.ontology.objectives.some(o => o.romance)).toBe(false);
    expect(friendsPack.eligibility.accountTiers.every(t => t.matchable === false && t.maxAge < 18)).toBe(true);
  });

  test("romance excluded at every layer: member, pair, configuration, attention item, probe", () => {
    const w = worldOf(1);
    const adults = w.ids.filter(id => !memberReason(w, id, { category: "social", role: "peer", format: "small_group", timeSensitive: false }));
    expect(adults.length).toBeGreaterThan(20);
    const [a, b] = adults as [MemberId, MemberId];
    expect(memberReason(w, a, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("romance_excluded");
    const c = { key: "x", kind: "intro", generator: "x", category: "romance", participants: [a, b], roles: { [a]: "peer", [b]: "peer" }, format: "one_to_one", objective: "x", channels: new Set<string>(), evidence: {}, fit: 1, benefit: {}, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "" } as unknown as Candidate;
    expect(candidateReason(w, c)).toBe("romance_excluded");
    expect(friendsPack.attention.itemGate!({ age: 30 }, { category: "romance" })).not.toBeNull();
    expect(friendsPack.attention.probeAllowed!("romance", 1)).toBe(false);
  });

  test("no romance framing in any member-facing text: explanations, engine probes, plan probes", async () => {
    for (const seed of seeds) {
      const { s, w, wk } = weekOf(seed);
      const r = await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack });
      expect(r.proposals.length).toBeGreaterThan(0);
      for (const p of r.proposals) {
        expect(["social", "hobby"]).toContain(p.category);
        for (const t of Object.values(p.explanations)) expect(t).not.toMatch(ROMANCE_FRAMING);
        for (const me of p.participants) {
          const probe = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: NYC_TZ }, me, p.participants.filter(x => x !== me), s.now);
          if (probe) expect(probe.text).not.toMatch(ROMANCE_FRAMING);
        }
      }
      let probes = 0;
      for (const p of allPlans(wk)) for (const me of p.invited) {
        const t = buildPlanProbe(w, p, me, s.now, NYC_TZ);
        if (t) { probes++; expect(t).not.toMatch(ROMANCE_FRAMING); expect(t).not.toMatch(/canary/i); }
      }
      expect(probes).toBeGreaterThan(0);
    }
  }, 60_000);

  test("no minors in any plan role (planner: sessions, offers, repeats, plans, partners), declared or by claimed age", () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const plans = allPlans(wk);
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) for (const id of [...p.invited, ...p.alternates, ...(p.hostId ? [p.hostId] : [])]) expect(canBeMatched(w.get(id)!.m.age)).toBe(true);
    }
  });

  test("adversaries the Network can see are held: no uncleared safety cue or unpassed check in any proposal or plan", async () => {
    for (const seed of seeds) {
      const { w, wk } = weekOf(seed);
      const info = friendsInfo(w);
      const flagged = new Set(w.ids.filter(id => info.get(id)!.safetyCue || !info.get(id)!.verified || w.holds.has(id)));
      expect(flagged.size).toBeGreaterThan(0);
      const r = await runEngine(friendsWorld(seed), { seed }, { pack: friendsPack });
      for (const p of r.proposals) for (const id of [...p.participants, ...p.alternates]) expect(flagged.has(id)).toBe(false);
      for (const p of allPlans(wk)) for (const id of [...p.invited, ...p.alternates]) expect(flagged.has(id)).toBe(false);
    }
  }, 60_000);

  test("in the simulator: 0 declared-minor proposals and contacts, 0 known-adversary contacts (8 weeks, 2 seeds)", () => {
    for (const seed of [21, 22]) {
      const m = friendsMetrics(runFriendsWorld({ seed, n: 300, weeks: 8, matcher: friendsPackMatcher() }));
      expect(m.meetups).toBeGreaterThan(20);
      expect(m.safety.declaredMinorProposals).toBe(0);
      expect(m.safety.declaredMinorContacts).toBe(0);
      expect(m.safety.knownAdversaryContacts).toBe(0);
    }
  }, 120_000);
});
