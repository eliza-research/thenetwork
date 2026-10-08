// slop.date world: determinism, no hidden-truth leak into snapshots, minors, oracle sanity, baselines.
import { describe, expect, test } from "bun:test";
import { canBeMatched } from "@thenetwork/core";
import {
  BASELINES, SLOP_WORLD_START, buildSlopSnapshot, createSlopWorld, generateSlopPersonas, isSafe, runSlopWorld,
  slopMetrics, visibleMutualCities, visibleProfiles, type SlopNetworkState, type SlopPersona,
} from "../src/slop/index.ts";

const emptyState = (): SlopNetworkState => ({ now: SLOP_WORLD_START, week: 0, interactions: [], feedback: [], safetyHolds: [], inboundAsks: [], edges: [], paused: new Set() });

describe("slop personas", () => {
  test("deterministic by seed, different across seeds", () => {
    const a = generateSlopPersonas({ seed: 7, perCity: 80 }), b = generateSlopPersonas({ seed: 7, perCity: 80 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateSlopPersonas({ seed: 8, perCity: 80 }))).not.toBe(JSON.stringify(a));
    expect(a.length).toBe(240);
  });

  test("minors 13-17 are present, flagged in hidden truth only; some lie about age", () => {
    const ps = generateSlopPersonas({ seed: 3, perCity: 300 });
    const minors = ps.filter(p => p.hidden.isMinor);
    expect(minors.length).toBeGreaterThan(20);
    for (const m of minors) { expect(m.hidden.trueAge).toBeGreaterThanOrEqual(13); expect(m.hidden.trueAge).toBeLessThanOrEqual(17); }
    const liars = minors.filter(m => m.stated.claimedAge >= 18);
    expect(liars.length).toBeGreaterThan(0);
    expect(liars.every(m => m.hidden.adversary === "age_liar")).toBe(true);
    const snap = buildSlopSnapshot(ps, emptyState());
    for (const m of minors) {
      const mem = snap.members.find(x => x.id === m.id)!;
      expect(mem.age).toBe(m.stated.claimedAge);
      expect(Object.keys(mem)).not.toContain("isMinor");
      if (m.stated.claimedAge < 18) {
        expect(mem.prefs.romanceOptIn).toBe(false);
        expect(snap.intents.some(i => i.memberId === m.id)).toBe(false);
        expect(snap.facets.filter(f => f.memberId === m.id).every(f => f.scope === "agent_private" && !f.tags.some(t => t.startsWith("romance:")))).toBe(true);
      }
    }
  });
});

describe("snapshot: no hidden truth", () => {
  const ps = generateSlopPersonas({ seed: 5, perCity: 120 });
  const snap = buildSlopSnapshot(ps, emptyState());
  const json = JSON.stringify(snap);

  test("no canary, no hidden field names, no adversary labels", () => {
    for (const p of ps) expect(json).not.toContain(p.hidden.canary);
    for (const k of ["desirability", "warmth", "taste\"", "traits\"", "trueAge", "isMinor", "appetite", "flakiness", "chemistry", "honesty", "replyProb", "\"hidden\"", "richness"])
      expect(json).not.toContain(k);
    for (const k of ["romance_scammer", "catfish", "age_liar", "not_single", "harasser"]) expect(json).not.toContain(k);
  });

  test("changing hidden truth does not change the snapshot", () => {
    const perturbed: SlopPersona[] = JSON.parse(JSON.stringify(ps));
    for (const p of perturbed) {
      const h = p.hidden;
      h.desirability += 3; h.warmth = -h.warmth; h.taste = h.taste.map(x => -x); h.traits = h.traits.map(x => x + 1);
      h.appetite = 0.5; h.flakiness = 0.3; h.replyProb = 0.5; h.honesty = 0.7; h.trueAge += 1; h.isMinor = !h.isMinor;
      h.canary = "CANARY-other"; h.dealbreakers = []; h.goal = "casual"; h.seeks = ["woman", "man", "nonbinary"]; h.ageRange = [18, 70];
      h.values = { ...h.values, smoking: "regular" }; h.availability = { slotFree: h.availability.slotFree.map(() => 0.5), shock: 0 };
    }
    expect(JSON.stringify(buildSlopSnapshot(perturbed, emptyState()))).toBe(json);
  });

  test("location is a zip only; distances shown are buckets", () => {
    expect(json).not.toMatch(/"(lat|lon)"/);
    for (const f of snap.facets) for (const t of f.tags) expect(t).not.toMatch(/\d+\.\d{3,}/);
    const vp = visibleProfiles(snap);
    expect([...vp.values()].every(v => /^\d{5}$/.test(v.homeZip))).toBe(true);
  });

  test("the visible reader returns what a very rich member stated", () => {
    const p = ps.find(x => x.hidden.richness === "very_rich" && canBeMatched(x.stated.claimedAge))!;
    const v = visibleProfiles(snap).get(p.id)!;
    expect(v.ageRange).toEqual(p.stated.ageRange);
    expect(v.seeks).toEqual(p.stated.seeks);
    expect(v.matchGender).toBe(p.stated.matchGender);
    expect(v.goal).toBe(p.stated.goal);
    expect(v.dealbreakers).toEqual(p.stated.dealbreakers);
    expect(v.interests.sort()).toEqual([...p.stated.interests].sort());
  });
});

describe("oracle", () => {
  const w = createSlopWorld({ seed: 11, perCity: 150 });
  const O = w.oracle;
  const safe = w.personas.filter(isSafe);
  const pairs: [SlopPersona, SlopPersona][] = [];
  for (let i = 0; i < safe.length && pairs.length < 200; i++) for (let j = i + 1; j < safe.length && pairs.length < 200; j++)
    if (O.statedMutual(safe[i]!, safe[j]!, 0)) pairs.push([safe[i]!, safe[j]!]);

  test("chemistry is symmetric; outcomes do not depend on argument order", () => {
    expect(pairs.length).toBeGreaterThan(50);
    for (const [a, b] of pairs) {
      expect(O.chemistry(a.id, b.id)).toBe(O.chemistry(b.id, a.id));
      const x = O.dateOutcome(a.id, b.id, "coffee"), y = O.dateOutcome(b.id, a.id, "coffee");
      expect(x.quality).toBeCloseTo(y.quality, 12);
      expect(x.ea).toBeCloseTo(y.eb, 12);
      expect(O.statedMutual(a, b, 0)).toBe(O.statedMutual(b, a, 0));
    }
  });

  test("soft labels are probabilities; unsafe pairs get 0; filters exclude declared minors", () => {
    for (const [a, b] of pairs.slice(0, 40)) {
      const s = O.softLabel(a.id, b.id, "drinks", 32);
      expect(s.pGood).toBeGreaterThanOrEqual(0); expect(s.pGood).toBeLessThanOrEqual(1);
      expect(s.pSecond).toBeLessThanOrEqual(1);
    }
    const bad = w.personas.find(p => !isSafe(p))!;
    expect(O.softLabel(bad.id, safe[0]!.id).pGood).toBe(0);
    const minor = w.personas.find(p => p.hidden.isMinor && p.stated.claimedAge < 18)!;
    expect(w.personas.some(p => O.statedMutual(minor, p, 0))).toBe(false);
  });

  test("perfect knowledge beats random within filters on P(second date)", () => {
    const meanRandom = pairs.reduce((s, [a, b]) => s + O.softLabel(a.id, b.id, undefined, 32).pSecond, 0) / pairs.length;
    const best = pairs.map(([a, b]) => O.softLabel(a.id, b.id, undefined, 32).pSecond).sort((x, y) => y - x).slice(0, 20);
    expect(best.reduce((s, x) => s + x, 0) / best.length).toBeGreaterThan(3 * meanRandom);
  });
});

describe("baselines", () => {
  const runs = (["random", "greedy", "oracle"] as const).map(n => runSlopWorld({ seed: 2, perCity: 120, weeks: 2, matcher: BASELINES[n] as any }));

  test("all three run, never propose a declared minor, and are deterministic", () => {
    for (const r of runs) {
      const m = slopMetrics(r);
      expect(m.proposals).toBeGreaterThan(0);
      expect(m.safety.minorContacts).toBe(0);
      expect(r.flows.every(f => !f.declaredMinor)).toBe(true);
    }
    const again = runSlopWorld({ seed: 2, perCity: 120, weeks: 2, matcher: BASELINES.random as any });
    expect(JSON.stringify(slopMetrics(again))).toBe(JSON.stringify(slopMetrics(runs[0]!)));
  });

  test("random respects visible filters; oracle-optimal respects stated filters and never meets an adversary or minor", () => {
    const [random, , oracle] = runs;
    const snap = buildSlopSnapshot(random!.world.personas, emptyState());
    const vp = visibleProfiles(snap);
    for (const f of random!.flows.filter(x => x.week === 0)) expect(visibleMutualCities(vp.get(f.first)!, vp.get(f.partner)!)).toContain(f.city);
    const m = slopMetrics(oracle!);
    expect(m.filterViolations).toBe(0);
    expect(m.safety.adversaryProposals).toBe(0);
    expect(m.safety.undisclosedMinorProposals).toBe(0);
  });

  test("greedy-by-desirability congests: proposals concentrate on few members", () => {
    const [random, greedy] = runs.map(slopMetrics);
    expect(greedy!.congestion.top10ProposalShare).toBeGreaterThan(random!.congestion.top10ProposalShare + 0.1);
    expect(greedy!.droppedForCap).toBeGreaterThan(0);
  });
});

describe("platform features (iteration 2; all off by default)", () => {
  test("photos re-sort probe answers toward attraction and shrink back-outs", () => {
    const w = createSlopWorld({ seed: 4, perCity: 120 });
    const O = w.oracle, safe = w.personas.filter(isSafe);
    const a = safe[0]!;
    const others = safe.slice(1, 80);
    const ctx = { week: 0, city: a.hidden.homeCity, activity: "coffee" as const };
    const base = O.probeYesProb(a.id, ctx);
    const withPhoto = others.map(b => ({ att: O.latent(a, b), y: O.probeYesProb(a.id, { ...ctx, photo: { of: b.id, noiseSd: 0.25 } }) }));
    expect(withPhoto.some(x => x.y !== base)).toBe(true);
    const sorted = [...withPhoto].sort((x, y) => x.att - y.att);
    const lo = sorted.slice(0, 20).reduce((s, x) => s + x.y, 0), hi = sorted.slice(-20).reduce((s, x) => s + x.y, 0);
    expect(hi).toBeGreaterThan(lo);
  });

  test("the relay classifier blocks flagged scripts, holds the sender, and changes nothing when off", () => {
    const off = runSlopWorld({ seed: 3, perCity: 120, weeks: 2, matcher: BASELINES.random as any });
    const again = runSlopWorld({ seed: 3, perCity: 120, weeks: 2, matcher: BASELINES.random as any, platform: {} });
    expect(JSON.stringify(slopMetrics(again))).toBe(JSON.stringify(slopMetrics(off)));
    const on = runSlopWorld({ seed: 3, perCity: 120, weeks: 2, matcher: BASELINES.random as any, platform: { relay: { scamRecall: 1, hostileRecall: 1, falsePositive: 0 } } });
    expect(on.relay!.truePositive).toBeGreaterThan(0);
    expect(on.relay!.falsePositive).toBe(0);
    const relayHarms = (r: typeof on) => r.flows.flatMap(f => f.harms).filter(h => ["offplatform_move", "money_ask", "financial_loss", "harassment"].includes(h.kind)).length;
    expect(relayHarms(on)).toBe(0);
    expect(relayHarms(off)).toBeGreaterThan(0);
    expect(on.world.state.safetyHolds.some(h => h.reason?.startsWith("relay"))).toBe(true);
  });

  test("human review: flagged members get a cleared / confirmed fact after the review delay", () => {
    const ps = generateSlopPersonas({ seed: 6, perCity: 150 });
    const st = { ...emptyState(), platform: { review: { days: 3, clearHonest: 1, catchAdversary: 1 } } };
    expect(JSON.stringify(buildSlopSnapshot(ps, st)).includes("review:")).toBe(false); // day 0: not yet
    const later = buildSlopSnapshot(ps, { ...st, now: SLOP_WORLD_START + 4 * 86_400_000 });
    const rv = later.facets.filter(f => f.tags.some(t => t.startsWith("review:")));
    expect(rv.length).toBeGreaterThan(0);
    for (const f of rv) expect(f.tags[0]).toBe(ps.find(p => p.id === f.memberId)!.hidden.adversary ? "review:confirmed" : "review:cleared");
  });
});
