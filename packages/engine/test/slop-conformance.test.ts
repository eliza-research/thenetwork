// slopPack passes the per-pack conformance suite (test/conformance.ts) on slop worlds, plus the
// slop-specific checks: mutual inclusion, mutual radius, age ranges and dealbreakers both ways, no
// exact distance or coordinate in member-facing text, minors and flagged age liars never matched,
// scammers held, no race filter, asks instead of guesses, public venues, the stable assignment.
import { describe, expect, test } from "bun:test";
import type { Facet, MemberId } from "@thenetwork/core";
import { canBeMatched, DAY } from "@thenetwork/core";
import * as A from "../src/attention.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine, type EngineResult } from "../src/engine.ts";
import { privateVocabulary } from "../src/explain.ts";
import { checkMemberFacing } from "../src/judgeCommon.ts";
import { makeSlopPack, planFromInput, PUBLIC_VENUE, SLOP_ASK_QUESTIONS, SLOP_ENGINE_CONFIG, slopPack, slopProfiles, mutualMarkets, distanceBand } from "../src/packs/slop/index.ts";
import { slopAssign } from "../src/packs/slop/assign.ts";
import { cellMiles, ZIPS } from "../src/packs/slop/zips.ts";
import { cellIn } from "../src/packs/slop/profile.ts";
import { limitMiles } from "../src/packs/slop/geo.ts";
import { ageRangeOf, reviewReason } from "../src/packs/slop/rules.ts";
import { statedDealbreaker } from "../src/packs/slop/score.ts";
import type { Scored } from "../src/scoring.ts";
import type { EngineInput, EngineProposal } from "../src/types.ts";
import { World } from "../src/world.ts";
import { ZIPS as WORLD_ZIPS } from "../../worlds/src/slop/geo.ts";
import { runConformance } from "./conformance.ts";
import { slopWorld } from "./slopkit.ts";

runConformance(slopPack, { world: seed => slopWorld(seed), cfg: SLOP_ENGINE_CONFIG });

const cfg = (seed: number) => ({ ...SLOP_ENGINE_CONFIG, seed });
const run = (input: EngineInput, seed = 1, pack = slopPack) => runEngine(input, cfg(seed), { pack });
const worldOf = (input: EngineInput, seed = 1, pack = slopPack) => new World(input, resolveConfig(cfg(seed)), localEmbed, pack);
const SEEDS = [1, 2, 3];
const inputs = new Map(SEEDS.map(s => [s, slopWorld(s, { perCity: 60 })]));
const results = new Map<number, Promise<EngineResult>>();
const result = (s: number) => { if (!results.has(s)) results.set(s, run(inputs.get(s)!, s)); return results.get(s)!; };

describe("slopPack: hard filters hold in every proposal", () => {
  test("positive control: every world yields proposals", async () => {
    for (const s of SEEDS) expect((await result(s)).proposals.length).toBeGreaterThan(5);
  });

  test("mutual gender / orientation inclusion, age ranges both ways, stated dealbreakers both ways", async () => {
    for (const s of SEEDS) {
      const input = inputs.get(s)!, P = slopProfiles(input);
      for (const p of (await result(s)).proposals) {
        const [a, b] = p.participants.map(id => P.get(id)!) as [NonNullable<ReturnType<typeof P.get>>, NonNullable<ReturnType<typeof P.get>>];
        expect(a.seeks).toContain(b.is!); expect(b.seeks).toContain(a.is!);
        const ra = ageRangeOf(a, slopPack.options)!, rb = ageRangeOf(b, slopPack.options)!;
        expect(b.age >= ra[0] && b.age <= ra[1] && a.age >= rb[0] && a.age <= rb[1]).toBe(true);
        expect(statedDealbreaker(a, b)).toBeUndefined(); expect(statedDealbreaker(b, a)).toBeUndefined();
        expect(p.category).toBe("romance"); expect(p.participants.length).toBe(2);
      }
    }
  });

  test("mutual radius: d(cells) + margin <= min(rA, rB) in the proposal's market (both ways)", async () => {
    for (const s of SEEDS) {
      const input = inputs.get(s)!, P = slopProfiles(input);
      for (const p of (await result(s)).proposals) {
        const [a, b] = p.participants.map(id => P.get(id)!);
        const d = cellMiles(cellIn(a!, p.city), cellIn(b!, p.city));
        expect(d + slopPack.options.radiusMargin).toBeLessThanOrEqual(Math.min(limitMiles(a!, slopPack.options)!, limitMiles(b!, slopPack.options)!));
        expect(mutualMarkets(a!, b!, slopPack.options, ["sf", "nyc", "la"]).map(m => m.market)).toContain(p.city);
      }
    }
  });

  test("a mutation that drops the orientation rule is caught by the inclusion check", async () => {
    const broken = makeSlopPack();
    (broken.eligibility as unknown as { pairRules: unknown[] }).pairRules = broken.eligibility.pairRules.filter(r => r.id !== "orientation_mismatch");
    const input = inputs.get(1)!, P = slopProfiles(input);
    const r = await run(input, 1, broken);
    const bad = r.proposals.filter(p => { const [a, b] = p.participants.map(id => P.get(id)!); return !a!.seeks.includes(b!.is!) || !b!.seeks.includes(a!.is!); });
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe("slopPack: safety", () => {
  test("declared minors are never matched; age liars and scammers are held once flagged (cue or report)", async () => {
    for (const s of SEEDS) {
      const input = inputs.get(s)!, P = slopProfiles(input);
      const r = await result(s);
      const inAny = new Set(r.proposals.flatMap(p => p.participants));
      for (const [id, p] of P) {
        if (!canBeMatched(p.age)) expect(inAny.has(id)).toBe(false);
        if (p.safety.length) expect(inAny.has(id)).toBe(false);
      }
      for (const h of input.safetyHolds ?? []) expect(inAny.has(h.memberId)).toBe(false);
    }
  });

  test("flagging a proposed member (age signal, scam pattern) or holding them after a report removes them", async () => {
    const input = inputs.get(1)!;
    const r0 = await result(1);
    const [x, y, z] = [r0.proposals[0]!.participants[0]!, r0.proposals[1]!.participants[0]!, r0.proposals[2]!.participants[0]!];
    const cue = (id: MemberId, tag: string): Facet => ({ id: `${id}:cue:${tag}`, memberId: id, kind: "fact", value: "cue", tags: [tag], scope: "agent_private", provenance: "inferred", confidence: 0.6, inferred: true });
    const flagged: EngineInput = { ...input, facets: [...input.facets, cue(x, "safety:age_signal"), cue(y, "safety:scam_pattern")], safetyHolds: [...(input.safetyHolds ?? []), { memberId: z, from: input.now - DAY, reason: "reported: money_ask" }] };
    const r = await run(flagged, 1);
    const inAny = new Set(r.proposals.flatMap(p => p.participants));
    for (const id of [x, y, z]) expect(inAny.has(id)).toBe(false);
    expect(r.asks.some(a => [x, y, z].includes(a.memberId))).toBe(false);
  });

  test("verification: a failed liveness or age check holds the member; `required` excludes the unverified", async () => {
    const input = inputs.get(2)!;
    const r0 = await result(2);
    const x = r0.proposals[0]!.participants[0]!;
    const v = (id: MemberId, tag: string): Facet => ({ id: `${id}:v:${tag}`, memberId: id, kind: "fact", value: "check", tags: [tag], scope: "agent_private", provenance: "connected_source", confidence: 0.95 });
    const r = await run({ ...input, facets: [...input.facets, v(x, "verify:liveness:fail")] }, 2);
    expect(r.proposals.some(p => p.participants.includes(x))).toBe(false);
    const req = await run(input, 2, makeSlopPack({ verification: { required: true } }));
    expect(req.proposals.length).toBe(0);
  });
});

describe("slopPack: member-facing text", () => {
  const BANDS = ["under 2 mi", "2-5 mi", "5-10 mi", "10-25 mi", "25+ mi"];
  const noDistance = (t: string) => {
    let x = t;
    for (const b of BANDS) x = x.split(b).join("");
    expect(x).not.toMatch(/\d+(\.\d+)?\s*(mi|mile|miles|km|kilometers?)\b/i); // no number of miles outside a band
    expect(x).not.toMatch(/-?\d{1,3}\.\d{3,}/); // no coordinate
    expect(x).not.toMatch(/\b\d{5}\b/); // no zip
    expect(x).not.toMatch(/cell:|zip:/i);
  };
  test("explanations and probes: bands only, no zip, no coordinate, leak gate passes", async () => {
    for (const s of SEEDS) {
      const input = inputs.get(s)!;
      const w = worldOf(input, s);
      for (const p of (await result(s)).proposals as EngineProposal[]) {
        const vocab = privateVocabulary(w, p.participants);
        for (const t of Object.values(p.explanations)) { noDistance(t); expect(checkMemberFacing(t, vocab).ok).toBe(true); expect(t).not.toMatch(/\d+\s*%|compatib/i); }
        expect(Object.values(p.explanations).some(t => BANDS.some(b => t.includes(b)))).toBe(true);
        for (const me of p.participants) {
          const others = p.participants.filter(o => o !== me);
          const probe = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: "America/New_York" }, me, others, w.now);
          expect(probe).not.toBeNull();
          noDistance(probe!.text);
          expect(probe!.text).toMatch(/only tell you who it is if you both say yes/);
        }
      }
    }
  });
  test("ask questions and plan copy carry no distance number or private value", () => {
    for (const q of Object.values(SLOP_ASK_QUESTIONS)) expect(q).not.toMatch(/\d+\.\d+|\b\d{5}\b/);
    expect(distanceBand(0.4)).toBe("under 2 mi");
    expect(distanceBand(30)).toBe("25+ mi");
  });
});

describe("slopPack: asks, plans, ontology", () => {
  test("unknown age range or distance: an ask, not a proposal (and never a guess)", async () => {
    for (const s of SEEDS) {
      const input = inputs.get(s)!, P = slopProfiles(input);
      const r = await result(s);
      const inAny = new Set(r.proposals.flatMap(p => p.participants));
      const unknown = [...P.values()].filter(p => p.adult && p.optedIn && !reviewReason(p, slopPack.options) && (!p.ageRange || limitMiles(p, slopPack.options) === undefined));
      expect(unknown.length).toBeGreaterThan(0);
      for (const p of unknown) {
        expect(inAny.has(p.id)).toBe(false);
        if (!(input.safetyHolds ?? []).some(h => h.memberId === p.id)) expect(r.asks.some(a => a.memberId === p.id && /^slop_(age_range|distance)$/.test(a.reason))).toBe(true);
      }
      for (const a of r.asks) { expect(canBeMatched(P.get(a.memberId)!.age)).toBe(true); expect(a.question).toBe(SLOP_ASK_QUESTIONS[a.reason]!); }
    }
  });

  test("with asks off, unknown fields fall back to the stated defaults (the baseline behaviour)", async () => {
    const r = await run(inputs.get(1)!, 1, makeSlopPack({ asks: false, compatAsks: false }));
    expect(r.asks.filter(a => a.reason !== "slop_orientation").length).toBe(0);
    expect(r.proposals.length).toBeGreaterThan((await result(1)).proposals.length);
  });

  test("the first-date plan: a public venue, 2-3 options from the slot grid, a distance band", async () => {
    const input = inputs.get(1)!;
    for (const p of (await result(1)).proposals) {
      const plan = planFromInput(input, p.participants[0]!, p.participants[1]!, ["sf", "nyc", "la"])!;
      expect(plan.public).toBe(true);
      expect(Object.values(PUBLIC_VENUE).map(v => v.venue)).toContain(plan.venue);
      expect(plan.options.length).toBeGreaterThanOrEqual(2); expect(plan.options.length).toBeLessThanOrEqual(3);
      expect(plan.market).toBe(p.city);
    }
  });

  test("no race filter: race or ethnicity tags change nothing", async () => {
    const input = inputs.get(3)!;
    const r0 = await result(3);
    const tagged: EngineInput = { ...input, facets: [...input.facets, ...input.members.map((m, i): Facet => ({ id: `${m.id}:race`, memberId: m.id, kind: "preference", value: "x", tags: [i % 2 ? "race:x" : "ethnicity:y", "romance:race:x"], scope: "agent_private", provenance: "said", confidence: 1 }))] };
    const r = await run(tagged, 3);
    expect(r.proposals.map(p => p.participants.join())).toEqual(r0.proposals.map(p => p.participants.join()));
  });

  test("romance ships alone and never in plans; dating has no warm graph; minors tier is never matchable", () => {
    expect(slopPack.attention.shipsAloneLane).toBe("romance");
    expect(slopPack.ontology.lanes.every(l => l.neverInPlans && l.shipsAlone && l.adultOnly)).toBe(true);
    expect(slopPack.ontology.warmEdges.size).toBe(0);
    expect(slopPack.eligibility.accountTiers.every(t => t.matchable === false && t.maxAge < 18)).toBe(true);
    expect(slopPack.consent.default).toEqual({ kind: "probe_first", order: "wanter_first", reveal: "opt_out", anonymousProbe: true });
  });

  test("each member is in at most one proposal per tick (inbound cap), and pairs are never repeated", async () => {
    for (const s of SEEDS) {
      const r = await result(s);
      const n = new Map<MemberId, number>();
      for (const p of r.proposals) for (const id of p.participants) n.set(id, (n.get(id) ?? 0) + 1);
      expect(Math.max(...n.values())).toBe(1);
    }
  });

  test("the engine zip table matches the slop world's", () => {
    expect(ZIPS.map(z => [z.zip, z.market, z.lat, z.lon])).toEqual(WORLD_ZIPS.map(z => [z.zip, z.city, z.lat, z.lon]));
  });
});

describe("slopPack: stable roommates assignment", () => {
  // Minimal scored edges for slopAssign: benefit = each side's preference, score = pair value.
  const mk = (a: string, b: string, va: number, vb: number): Scored => ({
    c: { key: `k:${a}${b}`, kind: "intro", generator: "t", category: "romance", participants: [a, b], roles: {}, format: "one_to_one", objective: "", channels: new Set(), evidence: {}, fit: 0, benefit: { [a]: va, [b]: vb }, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "" },
    components: {} as never, score: (va + vb) / 2, threshold: 0, eligible: true,
  });
  const fakeWorld = (ids: string[]) => ({ get: () => ({ inOpenOpportunity: false }), ids } as unknown as World);
  const stable = makeSlopPack({ assignment: "stable" }).options;
  const blocking = (sel: Scored[], all: Scored[]) => {
    const partner = new Map<string, Scored>();
    for (const s of sel) for (const id of s.c.participants) partner.set(id, s);
    const got = (id: string) => { const s = partner.get(id); return s ? s.c.benefit[id]! : -Infinity; };
    return all.filter(x => !sel.includes(x) && x.c.participants.every(id => x.c.benefit[id]! > got(id)));
  };
  test("bipartite instance: the result is stable (no blocking pair) and a matching", () => {
    const all = [mk("m1", "w1", 0.9, 0.2), mk("m1", "w2", 0.5, 0.9), mk("m2", "w1", 0.8, 0.8), mk("m2", "w2", 0.3, 0.4), mk("m3", "w1", 0.7, 0.1), mk("m3", "w3", 0.6, 0.6)];
    const res = slopAssign(stable, fakeWorld(["m1", "m2", "m3", "w1", "w2", "w3"]), all, { rng: undefined as never, debt: {} });
    const ids = res.selected.flatMap(s => s.s.c.participants);
    expect(new Set(ids).size).toBe(ids.length);
    expect(blocking(res.selected.map(s => s.s), all)).toEqual([]);
  });
  test("non-bipartite pool (queer, bi): stable when one exists; greedy fill when none does (odd preference cycle)", () => {
    const all = [mk("a", "b", 0.9, 0.5), mk("b", "c", 0.9, 0.5), mk("c", "a", 0.9, 0.5), mk("a", "d", 0.1, 0.9), mk("b", "d", 0.1, 0.9), mk("c", "d", 0.1, 0.9)];
    const res = slopAssign(stable, fakeWorld(["a", "b", "c", "d"]), all, { rng: undefined as never, debt: {} });
    const ids = res.selected.flatMap(s => s.s.c.participants);
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.selected.length).toBe(2); // everyone is still served
    const ok = [mk("p", "q", 0.9, 0.9), mk("p", "r", 0.5, 0.5), mk("q", "r", 0.4, 0.6), mk("r", "s", 0.8, 0.8)];
    const r2 = slopAssign(stable, fakeWorld(["p", "q", "r", "s"]), ok, { rng: undefined as never, debt: {} });
    expect(blocking(r2.selected.map(s => s.s), ok)).toEqual([]);
    expect(r2.selected.map(s => s.s.c.participants.join())).toEqual(["p,q", "r,s"]);
  });
});

// ---- Iteration 3 hard rule: photos and appearance ratings are for verified adults only -------------
import { adultsOnly, appearanceFacet, canRatePhotos, ClipAppearanceRater, rateMember, VisionLlmAppearanceRater, type AppearanceRater } from "../src/packs/slop/appearance.ts";
import { buildSlopSnapshot as buildSnap } from "../../worlds/src/slop/snapshot.ts";
import { generateSlopPersonas as genPersonas } from "../../worlds/src/slop/persona.ts";
import { createSlopWorld } from "../../worlds/src/slop/world.ts";
import { emptySlopState } from "./slopkit.ts";

describe("conformance: photo processing and appearance ratings are adults-only (verified 18+)", () => {
  const notAdults = [{ age: 13 }, { age: 16 }, { age: 17 }, { age: NaN }, { age: undefined as unknown as number }, { age: 25, ageVerified: false }];
  const spyRater = () => {
    let calls = 0;
    const clip = new ClipAppearanceRater({ embedImage: async () => { calls++; return [1, 0, 0, 1]; }, embedText: async t => (/unattractive/.test(t) ? [0, 1, 1, 0] : [1, 0, 0, 1]) });
    const vlm = new VisionLlmAppearanceRater({ chat: async () => { calls++; return JSON.stringify({ face: 1, body: 0.5, overall: 0.8, confidence: 0.9 }); } });
    return { clip, vlm, calls: () => calls };
  };
  const photo = [{ id: "p1", url: "https://example.invalid/p1.jpg" }];

  test("every rater refuses a minor, an unknown age or an unverified age before touching a photo", async () => {
    const s = spyRater();
    for (const subj of notAdults) {
      expect(canRatePhotos(subj)).toBe(false);
      expect(await s.clip.rate(subj, photo)).toBeNull();
      expect(await s.vlm.rate(subj, photo)).toBeNull();
    }
    expect(s.calls()).toBe(0);
    expect(await s.clip.rate({ age: 30 }, photo)).not.toBeNull();
    expect(await s.vlm.rate({ age: 30, ageVerified: true }, photo)).not.toBeNull();
    expect(s.calls()).toBe(2);
  });

  test("the adultsOnly guard (and rateMember) protects a third-party rater that forgot the check", async () => {
    let calls = 0;
    const naive: AppearanceRater = { id: "naive", rate: async () => { calls++; return { face: 0, body: 0, overall: 0, confidence: 1, model: "naive" }; } };
    for (const subj of notAdults) { expect(await adultsOnly(naive).rate(subj, photo)).toBeNull(); expect(await rateMember(naive, subj, photo)).toBeNull(); }
    expect(calls).toBe(0);
  });

  test("a rating facet cannot be built for a non-adult, and the pack ignores one on a minor or a failed age check", () => {
    for (const subj of notAdults) expect(() => appearanceFacet("m", subj, { face: 1, body: 1, overall: 1, confidence: 1, model: "x" }, 0)).toThrow();
    const input = slopWorld(1, { perCity: 40, extras: false });
    const minor = input.members.find(m => !canBeMatched(m.age))!, adult = input.members.find(m => canBeMatched(m.age))!;
    const tags = ["appearance:face=1.00", "appearance:body=1.00", "appearance:overall=1.00", "appearance:conf=0.90"];
    const forged = (id: string): Facet => ({ id: `${id}:forged`, memberId: id, kind: "fact", value: "photo rating (internal)", tags, scope: "agent_private", provenance: "inferred", confidence: 0.9 });
    const P = slopProfiles({ ...input, facets: [...input.facets, forged(minor.id), forged(adult.id), { ...forged(adult.id), id: "v", tags: ["verify:age:fail"] }] });
    expect(P.get(minor.id)!.appearance).toBeUndefined();
    expect(P.get(adult.id)!.appearance).toBeUndefined(); // failed age check: ignored
  });

  test("the slop world never rates or shows a photo of anyone under 18 (claimed age)", () => {
    const ps = genPersonas({ seed: 2, perCity: 120, minorShare: 0.15 });
    const snap = buildSnap(ps, { ...emptySlopState(), platform: { rater: { noise: 0.5, bias: 0, biasShare: 0.3 } } });
    const rated = new Set(snap.facets.filter(f => f.tags.some(t => t.startsWith("appearance:"))).map(f => f.memberId));
    for (const p of ps) expect(rated.has(p.id)).toBe(canBeMatched(p.stated.claimedAge));
    const w = createSlopWorld({ seed: 2, perCity: 120, minorShare: 0.15 });
    const minorP = w.personas.find(p => !canBeMatched(p.stated.claimedAge))!, adultP = w.personas.find(p => canBeMatched(p.stated.claimedAge))!;
    const ctx = { week: 0, city: adultP.hidden.homeCity, activity: "coffee" as const };
    expect(w.oracle.probeYesProb(adultP.id, { ...ctx, photo: { of: minorP.id, noiseSd: 0.5 } })).toBe(w.oracle.probeYesProb(adultP.id, ctx));
  });

  test("ratings never appear in run logs, proposals, asks or member-facing text; the band filter holds", async () => {
    const ps = genPersonas({ seed: 3, perCity: 60, minorShare: 0.15 });
    const snap = buildSnap(ps, { ...emptySlopState(), platform: { rater: { noise: 0.3, bias: 0, biasShare: 0.3 } } });
    const input: EngineInput = { ...snap };
    const pack = makeSlopPack({ appearance: { mode: "band", band: 0.75, protectBelow: 0 } }); // band semantics without the iteration-5 bottom-rated exemption
    const r = await runEngine(input, cfg(3), { pack });
    expect(r.proposals.length).toBeGreaterThan(0);
    const out = JSON.stringify({ p: r.proposals, a: r.asks, l: { ...r.runLog, timingsMs: undefined } });
    const scores = snap.facets.filter(f => f.tags.some(t => t.startsWith("appearance:"))).flatMap(f => f.tags);
    for (const t of scores) expect(out.includes(t)).toBe(false);
    expect(/appearance|attractive|photo rating/i.test(JSON.stringify(r.proposals.map(p => p.explanations)))).toBe(false);
    const P = slopProfiles(input);
    for (const p of r.proposals) {
      const [a, b] = p.participants.map(id => P.get(id)!.appearance);
      if (a && b) expect(Math.abs(a.overall - b.overall)).toBeLessThanOrEqual(0.75);
    }
  });
});

// Iteration 4 (founder decision 2026-10-08): the rater is ON in matching, and its scores are NEVER
// shared. Members only learn what the agent tells them (first name, the plan) through the relay.
import { appearanceLeak, APPEARANCE_PREFIX } from "../src/packs/slop/appearance.ts";
import { appearanceFactor, bodyTypeFactor } from "../src/packs/slop/score.ts";
import { ratingFloorLift } from "../src/packs/slop/assign.ts";
import { slopEngineInput, slopEngineMatcher } from "../../worlds/src/slop/enginePack.ts";
import { runSlopWorldAsync } from "../../worlds/src/slop/world.ts";
import { BODY_TYPE_DEFAULTS } from "../../worlds/src/slop/bodyType.ts";
import { RATER_DEFAULTS } from "../../worlds/src/slop/snapshot.ts";

describe("conformance: appearance scores are used in matching and never shared", () => {
  const RATER = { ...RATER_DEFAULTS, noise: 0.4 };
  // A slop world run for 3 weeks with photos, the rater and body types, so members have history
  // (post-date ratings feed the revealed body-type preference); then one more engine run on its snapshot.
  const setup = (async () => {
    const res = await runSlopWorldAsync({ seed: 5, perCity: 70, weeks: 3, minorShare: 0.15, platform: { rater: RATER, photos: { noiseSd: 1 } }, bodyTypes: BODY_TYPE_DEFAULTS, matcher: slopEngineMatcher({ seed: 5 }) });
    res.world.state.week = 3; res.world.state.now += 3 * 7 * DAY;
    const snap = buildSnap(res.world.personas, res.world.state);
    const input = slopEngineInput(snap);
    const r = await runEngine(input, cfg(5), { pack: slopPack });
    const scoreTags = [...new Set(input.facets.filter(f => f.tags.some(t => t.startsWith(APPEARANCE_PREFIX) || t.startsWith("slop:wants_body:"))).flatMap(f => f.tags))];
    return { res, input, r, scoreTags };
  })();
  const ASPECTS = /appearance|bodyType|body_type|wants_body|attractive|photo rating|clef/i;

  test("the default pack has the rater on (soft, face / body / overall, body type), and it changes matching", async () => {
    expect(slopPack.options.appearance.mode).toBe("soft");
    expect(slopPack.options.appearance.bodyType.enabled).toBe(true);
    const { input, r, scoreTags } = await setup;
    expect(scoreTags.some(t => t.startsWith(`${APPEARANCE_PREFIX}bodyType=`))).toBe(true);
    expect(scoreTags.some(t => t.startsWith("slop:wants_body:"))).toBe(true);
    const P = slopProfiles(input);
    const ps = [...P.values()].filter(p => p.appearance);
    let soft = 0, body = 0;
    for (const a of ps.slice(0, 40)) for (const b of ps.slice(40, 80)) { if (appearanceFactor(a, b, slopPack.options) < 1) soft++; if (bodyTypeFactor(a, b, slopPack.options) !== 1) body++; }
    expect(soft).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(0);
    const off = await runEngine(input, cfg(5), { pack: makeSlopPack({ appearance: { mode: "off" } }) });
    const pairs = (x: EngineResult) => x.proposals.map(p => [...p.participants].sort().join("|")).sort().join(",");
    expect(pairs(r)).not.toBe(pairs(off)); // used in matching
    expect(r.proposals.length).toBeGreaterThan(0);
  });

  test("no score, rank, bucket, body type or derived phrase in explanations, probes, asks, plans or reveals", async () => {
    const { input, r, scoreTags } = await setup;
    const w = worldOf(input, 5);
    const texts: string[] = [];
    for (const p of r.proposals as EngineProposal[]) {
      texts.push(...Object.values(p.explanations));
      for (const me of p.participants) {
        const others = p.participants.filter(o => o !== me);
        const probe = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: p.category, objective: p.objective, window: p.window, tz: "America/New_York" }, me, others, w.now);
        if (probe) texts.push(probe.text);
      }
      // The reveal (mutual yes): first names only, never anything about looks.
      let flow = A.startProbeFlowFor(p, slopPack);
      for (const m of [flow.first, ...flow.partners]) flow = A.recordProbeAnswer(flow, m, true);
      expect(A.canReveal(flow)).toBe(true);
      const nameOf = (id: string) => input.members.find(m => m.id === id)!.name.split(/\s+/)[0]!;
      for (const me of p.participants) texts.push(JSON.stringify(A.revealFor(flow, me, nameOf)));
      const plan = planFromInput(input, p.participants[0]!, p.participants[1]!, ["sf", "nyc", "la"]);
      if (plan) texts.push(JSON.stringify(plan));
    }
    for (const a of r.asks) texts.push(SLOP_ASK_QUESTIONS[a.reason] ?? "");
    texts.push(...Object.values(SLOP_ASK_QUESTIONS));
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) { expect(appearanceLeak(t, scoreTags)).toBeNull(); expect(ASPECTS.test(t)).toBe(false); }
  });

  test("explanations never mention appearance ratings (a forged facet value cannot reach them either)", async () => {
    const { input } = await setup;
    // Even if the platform stored a rating with a revealing value, it is agent_private: explanations
    // are built from shareable facts only, and the leak gate treats the value as private vocabulary.
    const forged = input.facets.map(f => (f.tags.some(t => t.startsWith(APPEARANCE_PREFIX)) ? { ...f, value: "very attractive, athletic body type, top 10% looks" } : f));
    const r = await runEngine({ ...input, facets: forged }, cfg(5), { pack: slopPack });
    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) for (const t of Object.values(p.explanations)) { expect(appearanceLeak(t)).toBeNull(); expect(t).not.toMatch(/looks|attractive|athletic|top 10/i); }
  });

  test("no score, tag, rank or appearance vocabulary in proposals or run logs (soft and band modes)", async () => {
    const { input, r, scoreTags } = await setup;
    const band = await runEngine(input, cfg(5), { pack: makeSlopPack({ appearance: { mode: "band", band: 0.75 } }) });
    const tie = await runEngine(input, cfg(5), { pack: makeSlopPack({ appearance: { mode: "tiebreak" }, congestion: { ratingFloor: { weight: 0.3 } } }) });
    expect(tie.proposals.length).toBeGreaterThan(0);
    for (const x of [r, band, tie]) {
      const out = JSON.stringify({ p: x.proposals, a: x.asks, l: { ...x.runLog, timingsMs: undefined } });
      for (const t of scoreTags) expect(out.includes(t)).toBe(false);
      expect(out).not.toMatch(ASPECTS);
      expect(appearanceLeak(out)).toBeNull();
    }
  });

  test("iteration 5: the rating-quintile exposure floor lifts only members of quintiles below the floor", async () => {
    const { input } = await setup;
    const o = slopPack.options; // the default floor: 1.0, weight 0.3, smooth 0.05
    expect(o.congestion.ratingFloor.weight).toBeGreaterThan(0);
    const w = worldOf(input, 5);
    const lift = ratingFloorLift(o, w, input.members.map(m => m.id));
    expect(lift.size).toBeGreaterThan(0);
    const P = slopProfiles(input);
    const rated = [...P.values()].filter(p => p.appearance && p.appearance.confidence >= o.appearance.minConfidence);
    const mean = rated.reduce((s, p) => s + p.history.dates, 0) / rated.length;
    for (const [id, l] of lift) { expect(l).toBeGreaterThan(0); expect(l).toBeLessThanOrEqual(0.3); expect(P.get(id)!.appearance).toBeDefined(); }
    const liftedMean = [...lift.keys()].reduce((s, id) => s + P.get(id)!.history.dates, 0) / lift.size;
    expect(liftedMean).toBeLessThan(mean);
    expect(ratingFloorLift(makeSlopPack({ congestion: { ratingFloor: { weight: 0 } } }).options, w, input.members.map(m => m.id)).size).toBe(0);
  });

  test("minors are never rated and never get a body-type preference, even with body types on", async () => {
    const { res } = await setup;
    let minors = 0;
    for (const p of res.world.personas) if (!canBeMatched(p.stated.claimedAge)) {
      minors++;
      const snap = buildSnap([p], { ...emptySlopState(), platform: { rater: RATER }, bodyTypes: BODY_TYPE_DEFAULTS });
      expect(snap.facets.some(f => f.tags.some(t => t.startsWith(APPEARANCE_PREFIX) || t.startsWith("slop:wants_body:")))).toBe(false);
    }
    expect(minors).toBeGreaterThan(0);
  });
});
