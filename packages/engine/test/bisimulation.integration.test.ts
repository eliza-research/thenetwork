import { DAY, HOUR, Rng, type City, type LLM, type MemberId } from "@thenetwork/core";
import { expect, test } from "vitest";
import {
  countPublishedQuestions,
  initial as initialAskRun,
  inv as invAskRun,
  step as stepAskRun,
  type Event as AskEvent,
} from "../../core/src/generated/engineAsks.ts";
import {
  initial as initialSelectionRun,
  inv as invSelectionRun,
  step as stepSelectionRun,
  type Event as SelectionEvent,
  type SelectionChoice,
  type SelectionMember,
} from "../../core/src/generated/selectionRun.ts";
import {
  initial as initialSlopRun,
  inv as invSlopRun,
  memberCount as slopMemberCount,
  step as stepSlopRun,
  type Event as SlopEvent,
} from "../../core/src/generated/slopAssignment.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { computeCitySupplyDemand, runEngine } from "../src/engine.ts";
import { JudgeCache, judgeCandidates, type JudgeRunStats } from "../src/judge.ts";
import { ProjectedSlopAssignmentRun } from "../src/packs/slop/assign.ts";
import { slopProfiles } from "../src/packs/slop/profile.ts";
import { slopHorizontalCompatibility, slopRedLinesOf } from "../src/packs/slop/score.ts";
import { ProjectedAskRun, ProjectedSelectionRun } from "../src/policy.ts";
import { worldStatusBeliefs } from "../src/status.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { Candidate, EngineInput, MatchingRunLog } from "../src/types.ts";
import { World } from "../src/world.ts";

test("ProjectedAskRun is 100% bisimilar to monolithic engineAsks.step over K=100 seeded events", () => {
  const rng = new Rng(20261127);
  let mono = initialAskRun;
  const proj = new ProjectedAskRun();
  const members = Array.from({ length: 30 }, (_, i) => `m_${i}`);

  const applyBoth = (ev: AskEvent) => {
    const nextMono = stepAskRun(mono, ev);
    const monoAccepted = nextMono !== mono;
    mono = nextMono;
    const projAccepted = proj.apply(ev);
    expect(projAccepted).toBe(monoAccepted);
    expect(invAskRun(mono)).toBe(true);
    expect(proj.currentPhase).toBe(mono.phase);
  };

  applyBoth({ type: "setAvailability", configured: true });
  for (let i = 0; i < 100; i++) {
    const memberId = members[rng.int(0, members.length - 1)]!;
    const adult = rng.bool(0.85);
    const supportedMarket = rng.bool(0.85);
    expect(proj.allowed(adult, supportedMarket)).toBe(mono.phase === "PlanningQuestions" && adult && supportedMarket);
    applyBoth({ type: "reserveQuestion", memberId, adult, supportedMarket });
  }
  applyBoth({ type: "publishQuestions" });
  applyBoth({ type: "reserveQuestion", memberId: "m_0", adult: true, supportedMarket: true });

  for (const id of members) {
    expect(proj.publishedCount(id)).toBe(countPublishedQuestions(mono, id));
  }
});

test("ProjectedSlopAssignmentRun is 100% bisimilar to monolithic slopAssignment.step over K=100 seeded events", () => {
  const rng = new Rng(20261128);
  let mono = initialSlopRun;
  const proj = new ProjectedSlopAssignmentRun();
  const members = Array.from({ length: 40 }, (_, i) => `d_${i}`);

  const applyBoth = (ev: SlopEvent) => {
    const nextMono = stepSlopRun(mono, ev);
    const monoAccepted = nextMono !== mono;
    mono = nextMono;
    const projAccepted = proj.apply(ev);
    expect(projAccepted).toBe(monoAccepted);
    expect(invSlopRun(mono)).toBe(true);
    expect(proj.currentPhase).toBe(mono.phase);
    expect(proj.currentRound).toBe(mono.round);
    expect(proj.proposedCount).toBe(mono.proposed);
  };

  applyBoth({ type: "configureAssignment", totalRounds: 2, baseRounds: 1 });
  for (let round = 0; round < 2; round++) {
    applyBoth({ type: "openRound" });
    for (let i = 0; i < 50; i++) {
      const a = members[rng.int(0, members.length - 1)]!;
      let b = members[rng.int(0, members.length - 1)]!;
      if (a === b) b = members[(members.indexOf(a) + 1) % members.length]!;
      const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      const withinBackupDegree = rng.bool(0.45);
      applyBoth({ type: "reservePair", pairKey, memberA: a, memberB: b, withinBackupDegree });
    }
    applyBoth({ type: "closeRound" });
  }

  for (const id of members) {
    expect(proj.countOf(id)).toBe(slopMemberCount(mono.memberCounts, id));
  }
});

test("ProjectedSelectionRun is 100% bisimilar to monolithic selectionRun.step over K=100 seeded events", () => {
  const rng = new Rng(20261129);
  let mono = initialSelectionRun;
  const proj = new ProjectedSelectionRun();
  const cities = ["nyc", "sf", "la"];
  const members: SelectionMember[] = Array.from({ length: 30 }, (_, i) => ({
    id: `s_${i}`,
    unavailable: i === 29,
    priorProactive: i % 3 === 0 ? 1 : 0,
    proactiveLimit: 2,
    contributor: i % 4 === 0,
    priorContribution: 0,
    contributionLimit: 1,
  }));

  const makeChoice = (k: number): SelectionChoice => {
    const size = rng.bool(0.8) ? 2 : 3;
    const picked: SelectionMember[] = [];
    while (picked.length < size) {
      const m = members[rng.int(0, members.length - 1)]!;
      if (!picked.some(x => x.id === m.id)) picked.push(m);
    }
    const pairKeys: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) {
        const a = picked[i]!.id, b = picked[j]!.id;
        pairKeys.push(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
    return {
      candidateKey: `cand_${k}`,
      city: cities[k % cities.length]!,
      cityLimit: 20,
      members: picked,
      pairKeys,
    };
  };

  const applyBoth = (ev: SelectionEvent) => {
    const nextMono = stepSelectionRun(mono, ev);
    const monoAccepted = nextMono !== mono;
    mono = nextMono;
    const projAccepted = proj.apply(ev);
    expect(projAccepted).toBe(monoAccepted);
    expect(invSelectionRun(mono)).toBe(true);
    expect(proj.currentPhase).toBe(mono.phase);
    expect(proj.count).toBe(mono.selectedCount);
    expect(proj.bound).toBe(mono.greedyBound);
  };

  for (let i = 0; i < 20; i++) {
    applyBoth({
      type: "reserveSelection",
      choice: makeChoice(i),
      timeFree: rng.bool(0.9),
      exploring: false,
      packAllows: rng.bool(0.95),
      value: 900 - i,
    });
  }
  applyBoth({ type: "beginExploration" });
  for (let i = 20; i < 40; i++) {
    applyBoth({
      type: "reserveSelection",
      choice: makeChoice(i),
      timeFree: rng.bool(0.9),
      exploring: true,
      packAllows: rng.bool(0.95),
      value: 800 - i,
    });
  }
  applyBoth({ type: "beginGreedy" });
  let val = 1000;
  for (let i = 40; i < 100; i++) {
    val -= rng.int(0, 5);
    const choice = makeChoice(i);
    if (rng.bool(0.3)) {
      const blocked = choice.members[rng.int(0, choice.members.length - 1)]!;
      applyBoth({ type: "refuseSelection", choice, value: val, blockedMember: blocked });
    } else {
      applyBoth({
        type: "reserveSelection",
        choice,
        timeFree: rng.bool(0.9),
        exploring: false,
        packAllows: rng.bool(0.95),
        value: val,
      });
    }
  }
  applyBoth({ type: "completeRun" });
});

test("worldStatusBeliefs is invariant to pooling other cities into the same World", () => {
  const rng = new Rng(42);
  const now = Date.UTC(2026, 9, 15, 16, 0, 0);
  const buildCityData = (city: City, count: number, density: number): EngineInput => {
    const inp = emptyInput(now);
    const ids: MemberId[] = [];
    for (let k = 0; k < count; k++) {
      const id = `${city}_${k}` as MemberId;
      ids.push(id);
      const inv = k > 0 ? ids[Math.floor(rng.next() * Math.min(k, 5))] : undefined;
      inp.members.push(baseMember(id, { homeCity: city, invitedBy: inv, joinedAt: now - 30 * DAY }));
      if (inv) inp.edges.push({ from: inv, to: id, type: "invited_by", strength: 0.8, explicit: true, createdAt: now - 20 * DAY });
      inp.facets.push(facet(id, 0, "interest", "climbing", ["climbing"]));
      inp.facets.push(facet(id, 1, "skill", "typescript", ["typescript"]));
    }
    const nInt = Math.floor(count * density);
    for (let t = 0; t < nInt; t++) {
      const a = ids[Math.floor(rng.next() * ids.length)]!;
      const b = ids[Math.floor(rng.next() * ids.length)]!;
      if (a === b) continue;
      const oid = `o_${city}_${t}`;
      inp.interactions!.push({ id: oid, kind: "intro", category: "social", participants: [a, b], at: now - 5 * DAY, outcome: "completed", acceptedBy: [a, b] });
      inp.feedback!.push({ id: `f_${oid}`, opportunityId: oid, from: a, about: b, at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true });
    }
    return inp;
  };

  const nyc = buildCityData("nyc", 150, 3.0);
  const la = buildCityData("la", 30, 0.5);
  const combined: EngineInput = {
    ...nyc,
    members: [...nyc.members, ...la.members],
    facets: [...nyc.facets, ...la.facets],
    edges: [...nyc.edges, ...la.edges],
    interactions: [...nyc.interactions!, ...la.interactions!],
    feedback: [...nyc.feedback!, ...la.feedback!],
  };

  const bMulti = worldStatusBeliefs(new World(combined, resolveConfig({ cities: ["nyc", "la"] }), localEmbed));
  const bLaIso = worldStatusBeliefs(new World(la, resolveConfig({ cities: ["la"] }), localEmbed));
  for (const m of la.members) {
    const multi = bMulti.get(m.id)!;
    const iso = bLaIso.get(m.id)!;
    expect(Math.abs(multi.mu[3] - iso.mu[3])).toBeLessThan(1e-6);
    expect(Math.abs(multi.mu[4] - iso.mu[4])).toBeLessThan(1e-6);
  }
});

test("JudgeCache achieves >= 6/7 hits across 7 intra-day ticks while still busting on +1 DAY", async () => {
  const input = emptyInput();
  input.members.push(baseMember("ada", { joinedAt: input.now - 10 * DAY }), baseMember("grace", { joinedAt: input.now - 10 * DAY }));
  for (const m of input.members) {
    input.facets.push({ ...facet(m.id, 0, "interest", "Climbing", ["climbing"]), observedAt: input.now - 2 * DAY });
    input.intents.push({ id: `i_${m.id}`, memberId: m.id, objective: "Find a climbing partner", category: "hobby", horizonDays: 14, status: "active", createdAt: input.now - 2 * DAY });
  }
  const cand: Candidate = {
    key: "ada-grace-climb", kind: "intro", generator: "intent_to_capability", category: "hobby",
    participants: ["ada", "grace"], roles: { ada: "peer", grace: "peer" }, format: "one_to_one", objective: "Go climbing",
    city: "sf", window: { start: input.now, end: input.now + 7 * DAY }, channels: new Set(["match"]), evidence: {},
    fit: 0.9, benefit: { ada: 0.9, grace: 0.9 }, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "climbing", lane: "Friend",
  };
  let calls = 0;
  const llm: LLM = {
    chat: async () => {
      calls++;
      return JSON.stringify({
        reasoning: "Both members climb.", verdict: "yes", match_probability: 0.85,
        fit: 4, mutual_value: 4, capacity_realism: 4, timing: 4, social_comfort: 4, red_flags: 1, certainty: 4,
        dealbreaker: false, why: { P1: "Climbing partner", P2: "Climbing partner" },
      });
    },
  };
  const cfg = resolveConfig({});
  const cache = new JudgeCache(7 * DAY);
  let totalHits = 0;
  for (let tick = 0; tick < 7; tick++) {
    const tNow = input.now + tick * 3 * HOUR;
    const w = new World({ ...input, now: tNow }, cfg, localEmbed);
    const stats: JudgeRunStats = { calls: 0, cacheHits: 0, failures: 0 };
    const log: MatchingRunLog["judge"]["verdicts"] = [];
    await judgeCandidates(w, [{ ...cand, window: { start: tNow, end: tNow + 7 * DAY } }], llm, cache, stats, log, "gpt-6-luna");
    totalHits += stats.cacheHits;
  }
  expect(totalHits).toBeGreaterThanOrEqual(6);
  expect(calls).toBe(1);

  const nextDayNow = input.now + DAY;
  const wNext = new World({ ...input, now: nextDayNow }, cfg, localEmbed);
  const statsNext: JudgeRunStats = { calls: 0, cacheHits: 0, failures: 0 };
  await judgeCandidates(wNext, [{ ...cand, window: { start: nextDayNow, end: nextDayNow + 7 * DAY } }], llm, cache, statsNext, [], "gpt-6-luna");
  expect(statsNext.calls).toBe(1);
});

test("postSelection enforces topK cap and computeCitySupplyDemand emits privacy-safe aggregates", async () => {
  const input = emptyInput();
  for (let i = 0; i < 12; i++) {
    const id = `u_${i}` as MemberId;
    input.members.push(baseMember(id, { homeCity: "sf" }));
    input.presence.push({ memberId: id, type: "home", city: "sf", areas: ["mission"] });
    input.facets.push(facet(id, 0, "interest", "Climbing", ["climbing"]), facet(id, 1, "skill", "Belaying", ["belaying", "climbing"]));
    input.intents.push({ id: `int_${id}`, memberId: id, status: "active", category: "hobby", objective: "Find a climbing partner", createdAt: input.now - DAY, horizonDays: 14 });
  }
  let judgeCalls = 0;
  const whyAll = Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`P${k + 1}`, "Climbing"]));
  const llm: LLM = {
    chat: async () => {
      judgeCalls++;
      return JSON.stringify({
        reasoning: "Good fit.", verdict: "yes", match_probability: 0.8,
        fit: 4, mutual_value: 4, capacity_realism: 4, timing: 4, social_comfort: 4, red_flags: 1, certainty: 4,
        dealbreaker: false, why: whyAll,
      });
    },
  };
  const res = await runEngine(input, { cities: ["sf"], judge: { enabled: true, topK: 2, groupTopK: 1, postSelection: { enabled: true, minConfidence: 0, maxConfidence: 1, backups: 2 } } }, { llm, embed: localEmbed });
  expect(judgeCalls).toBeLessThanOrEqual(3);
  expect(res.runLog.judge.calls).toBeLessThanOrEqual(3);
  expect(res.proposals.length).toBeGreaterThan(0);

  const w = new World(input, resolveConfig({ cities: ["sf"] }), localEmbed);
  const signals = computeCitySupplyDemand(w, [], []);
  const sf = signals.find(s => s.city === "sf");
  expect(sf?.activeAdults).toBe(12);
  expect(sf?.densityTier).toBe("sparse");
  expect(JSON.stringify(signals)).not.toContain("u_0");
});

test("SlopProfile precomputes core red lines and slopHorizontalCompatibility scores horizontal signals cleanly", () => {
  const input = emptyInput();
  input.members.push(
    baseMember("a", { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }),
    baseMember("b", { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }),
  );
  input.facets.push(
    facet("a", 0, "fact", "sober", ["slop:drinking:never", "humor:dry_wit", "spend:moderate"], "matchable"),
    facet("b", 0, "fact", "social", ["slop:drinking:social", "humor:dry_wit", "spend:moderate"], "matchable"),
  );
  const profs = slopProfiles(input);
  const pa = profs.get("a")!;
  const pb = profs.get("b")!;
  expect(pa.redLines?.nonDrinker).toBe(true);
  expect(pb.redLines?.nonDrinker).toBe(false);
  expect(slopRedLinesOf(pa, pb).anyNonDrinker).toBe(true);

  const w = new World(input, resolveConfig({ cities: ["nyc"] }), localEmbed);
  expect(slopHorizontalCompatibility(w, "a", "b")).toBeGreaterThan(1);
});
