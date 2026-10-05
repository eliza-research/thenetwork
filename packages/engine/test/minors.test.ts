// Minors policy (founder decision 2026-10-05; PRD 17.4 as amended). Members under 18 can join
// but are NEVER connected to anyone: not as participant, alternate, helper, host, connector /
// warm-path intermediary (`via`), or growth-ask target, in any generator or the group composer.
// Adults are never shown or told about minors (no explanation, objective, anchor or run-log
// field carries a minor's id or name). Each generator has a positive control (the adult version
// of the same world yields a candidate) so a test cannot pass just because nothing was generated.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine } from "../src/engine.ts";
import { ADULT_AGE, candidateReason, involvedMembers, isMinorAge, memberReason, pairReason } from "../src/filters.ts";
import {
  complementaryIntents, eventAnchor, expansion, GENERATORS, groupComposer, helpRequest, intentToCapability, networkGrowth,
  newcomerWelcome, secondEncounter, sharedIntentPooling, warmPath, type GenCtx,
} from "../src/generators.ts";
import { composeGroup } from "../src/group.ts";
import { Rng } from "../src/rng.ts";
import { randomWorld } from "../src/testkit.ts";
import type { Candidate, EngineInput, EngineProposal, MatchingRunLog } from "../src/types.ts";
import { World } from "../src/world.ts";
import { baseMember, cand, emptyInput, facet, intent, mkWorld, NOW, resolver, sailingPair } from "./helpers.ts";

const ctx = (inp: EngineInput): GenCtx => ({ w: mkWorld(inp), memberExclusions: {}, rng: new Rng(1), unmatchedIntents: new Set() });
const home = (inp: EngineInput, id: string, area = "mission") => inp.presence.push({ memberId: id, city: "sf", type: "home", areas: [area] });
function people(ids: string[], f: (inp: EngineInput) => void = () => {}): EngineInput {
  const inp = emptyInput(NOW);
  for (const id of ids) { inp.members.push(baseMember(id)); home(inp, id); }
  f(inp);
  return inp;
}
const setAge = (inp: EngineInput, id: string, age: number) => { inp.members.find(m => m.id === id)!.age = age; return inp; };
const touches = (c: Candidate, id: string) => involvedMembers(c).includes(id) || id in c.roles || c.anchor?.id === id;
const touchesAny = (cs: Candidate[], ids: string[]) => cs.filter(c => ids.some(id => touches(c, id)));

describe("minors policy: filters", () => {
  test("18 is policy, not config: ageMin cannot lower it, missing ages fail closed", () => {
    expect(ADULT_AGE).toBe(18);
    for (const a of [13, 17, 17.99, NaN, undefined, null, "30"]) expect(isMinorAge(a)).toBe(true);
    for (const a of [18, 30, 90]) expect(isMinorAge(a)).toBe(false);
    const inp = setAge(sailingPair(), "b", 17);
    const w = new World(inp, resolveConfig({ ageMin: 16 }), localEmbed);
    expect(memberReason(w, "b", { category: "hobby", role: "provider", format: "one_to_one", timeSensitive: false })).toBe("underage");
    const noAge = sailingPair();
    delete (noAge.members[1] as any).age;
    expect(memberReason(mkWorld(noAge), "b", { category: "hobby", role: "provider", format: "one_to_one", timeSensitive: false })).toBe("underage");
  });

  test("pair filter rejects any pair containing a minor (also makes them group-incompatible)", () => {
    const w = mkWorld(setAge(people(["a", "b", "c"]), "b", 15));
    expect(pairReason(w, "a", "b", "social")).toBe("underage");
    expect(pairReason(w, "b", "c", "social")).toBe("underage");
    expect(pairReason(w, "a", "c", "social")).toBeNull();
  });

  test("candidateReason rejects a minor as participant, alternate, or via", () => {
    const w = mkWorld(setAge(people(["a", "b", "c", "k"]), "k", 16));
    expect(candidateReason(w, cand(["a", "b"]))).toBeNull();
    expect(candidateReason(w, cand(["a", "k"]))).toBe("underage");
    expect(candidateReason(w, cand(["a", "b"], { alternates: ["k"] }))).toBe("underage");
    expect(candidateReason(w, cand(["a", "b"], { via: "k", kind: "member_intro" }))).toBe("underage");
  });

  test("World keeps minors out of the warm graph and inviter cohorts", () => {
    const inp = people(["a", "k", "b"], i => {
      i.edges.push({ from: "a", to: "k", type: "knows", strength: 0.8, explicit: true, createdAt: NOW - DAY });
      i.edges.push({ from: "k", to: "b", type: "knows", strength: 0.8, explicit: true, createdAt: NOW - DAY });
      i.members.find(m => m.id === "b")!.invitedBy = "k";
    });
    const w = mkWorld(setAge(inp, "k", 15));
    expect(w.minors.has("k")).toBe(true);
    expect(w.isWarm("a", "k")).toBe(false);
    expect(w.get("a")!.degree).toBe(0);
    expect(w.get("b")!.inviterRoot).toBe("b");
  });
});

describe("minors policy: every generator (positive control, then the same world with a minor)", () => {
  test("intent to capability: minor provider or minor seeker -> nothing", () => {
    expect(intentToCapability(ctx(sailingPair())).length).toBe(1);
    expect(intentToCapability(ctx(setAge(sailingPair(), "b", 16)))).toEqual([]);
    expect(intentToCapability(ctx(setAge(sailingPair(), "a", 16)))).toEqual([]);
  });

  test("complementary intents: a minor is never one side (incl. romance opt-in minors)", () => {
    const mk = () => people(["g", "d"], i => {
      i.facets.push(facet("g", 0, "skill", "plays guitar in a rock band", ["music"]), facet("d", 0, "skill", "plays drums in a rock band", ["music"]));
      i.intents.push(intent("g", "start a rock band and find a drummer who plays drums", "hobby"), intent("d", "start a rock band and find a guitarist who plays guitar", "hobby"));
    });
    expect(complementaryIntents(ctx(mk())).length).toBe(1);
    expect(complementaryIntents(ctx(setAge(mk(), "d", 17)))).toEqual([]);
    const romance = people(["a", "b"], i => {
      for (const m of i.members) { m.prefs.romanceOptIn = true; m.prefs.categoriesOptIn.push("romance"); }
      i.facets.push(facet("a", 0, "interest", "live jazz and cooking", ["music"]), facet("b", 0, "interest", "live jazz and cooking dinners", ["music"]));
      i.intents.push(intent("a", "open to dating someone who loves live jazz", "romance"), intent("b", "open to dating someone who loves cooking and jazz", "romance"));
    });
    expect(complementaryIntents(ctx(romance)).length).toBe(1);
    expect(complementaryIntents(ctx(setAge(romance, "b", 17)))).toEqual([]);
  });

  test("shared intent pooling: minors are in neither the pair nor the group nor its alternates", () => {
    const ids = ["t1", "t2", "t3", "t4", "t5"];
    const mk = () => people(ids, i => {
      for (const id of ids) {
        i.facets.push(facet(id, 0, "interest", "playing tennis on weekends", ["tennis"]));
        i.intents.push(intent(id, "play doubles tennis with a group on weekends", "hobby", { id: `${id}-i` }));
      }
    });
    const adults = sharedIntentPooling(ctx(mk()));
    expect(touchesAny(adults, ["t2"]).length).toBeGreaterThan(0);
    const inp = setAge(setAge(mk(), "t2", 14), "t4", 17);
    const out = sharedIntentPooling(ctx(inp));
    expect(out.some(c => c.kind === "group")).toBe(true); // t1, t3, t5 still get a group
    expect(touchesAny(out, ["t2", "t4"])).toEqual([]);
  });

  test("event anchor: no co-attendance pair or crew with a minor", () => {
    const mk = () => people(["a", "b", "c", "k"], i => {
      for (const id of ["a", "b", "c", "k"]) i.facets.push(facet(id, 0, "interest", "climate tech and clean energy", ["climate"]));
      i.events = [{ id: "e1", title: "Climate tech founder demo night", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR, tags: ["climate"], category: "events" }];
    });
    expect(touchesAny(eventAnchor(ctx(mk())), ["k"]).length).toBeGreaterThan(0);
    const out = eventAnchor(ctx(setAge(mk(), "k", 16)));
    expect(out.length).toBeGreaterThan(0);
    expect(touchesAny(out, ["k"])).toEqual([]);
  });

  test("warm path: a minor is never the friend-of-a-friend nor the connector (via)", () => {
    const mk = () => people(["a", "x", "b"], i => {
      i.edges.push({ from: "a", to: "x", type: "knows", strength: 0.7, explicit: true, createdAt: NOW - DAY }, { from: "x", to: "b", type: "met", strength: 0.7, explicit: true, createdAt: NOW - DAY });
      i.facets.push(facet("b", 0, "skill", "founded a climate tech startup", ["climate"]));
      i.intents.push(intent("a", "meet climate tech founders", "professional"));
    });
    expect(warmPath(ctx(mk())).length).toBe(1);
    expect(warmPath(ctx(setAge(mk(), "x", 16)))).toEqual([]); // minor as via
    expect(warmPath(ctx(setAge(mk(), "b", 16)))).toEqual([]); // minor as target
    expect(warmPath(ctx(setAge(mk(), "a", 16)))).toEqual([]); // minor as seeker
  });

  test("help request: minors are never requester-matched, helpers, or alternates", () => {
    const mk = () => people(["r", "h1", "h2", "h3", "k"], i => {
      for (const id of ["h1", "h2", "h3", "k"]) i.facets.push(facet(id, 0, "offer", "happy to help friends move furniture", ["moving"]));
      i.facets.push(facet("k", 1, "offer", "strong, has a truck, loves to help move furniture and couches", ["moving"]));
      i.intents.push(intent("r", "need help to move a couch to my apartment Saturday", "help"));
    });
    expect(touchesAny(helpRequest(ctx(mk())), ["k"]).length).toBeGreaterThan(0);
    const out = helpRequest(ctx(setAge(mk(), "k", 17)));
    expect(out.length).toBeGreaterThan(0);
    expect(touchesAny(out, ["k"])).toEqual([]);
    expect(helpRequest(ctx(setAge(mk(), "r", 15)))).toEqual([]);
  });

  test("group composer: minors never members, hosts, alternates, or theme counters", () => {
    const ids = ["g1", "g2", "g3", "g4", "g5", "k1", "k2"];
    const mk = () => people(ids, i => {
      for (const id of ids) i.facets.push(facet(id, 0, "interest", "independent film and cinema", ["film"]));
      i.facets.push(facet("k1", 1, "offer", "hosts small film screenings", ["film", "host"]));
    });
    expect(touchesAny(groupComposer(ctx(mk())), ["k1", "k2"]).length).toBeGreaterThan(0);
    const out = groupComposer(ctx(setAge(setAge(mk(), "k1", 16), "k2", 13)));
    expect(out.length).toBe(1);
    expect(touchesAny(out, ["k1", "k2"])).toEqual([]);
    // Theme with only 3 adults + 2 minors falls below minThemeMembers (4): minors do not count.
    const small = people(["a1", "a2", "a3", "k1", "k2"], i => {
      for (const id of ["a1", "a2", "a3", "k1", "k2"]) i.facets.push(facet(id, 0, "interest", "independent film and cinema", ["film"]));
    });
    expect(groupComposer(ctx(setAge(setAge(small, "k1", 16), "k2", 16)))).toEqual([]);
  });

  test("composeGroup: a forced minor yields no group; a minor in the pool is never chosen", () => {
    const inp = setAge(people(["a", "b", "c", "k"], i => { for (const id of ["a", "b", "c", "k"]) i.facets.push(facet(id, 0, "interest", "board games", ["boardgames"])); }), "k", 15);
    const w = mkWorld(inp);
    const base = { category: "social" as const, minSize: 3, maxSize: 4, window: { start: NOW, end: NOW + 7 * DAY }, preferredCity: "sf" as const, needHost: false, beamWidth: 8, minPairwise: -1, alternates: 3 };
    const pool = ["a", "b", "c", "k"].map(id => ({ id, affinity: id === "k" ? 1 : 0.5 }));
    expect(composeGroup(w, { ...base, pool, forced: ["k"] })).toBeNull();
    const g = composeGroup(w, { ...base, pool })!;
    expect(g.primary.sort()).toEqual(["a", "b", "c"]);
    expect(g.alternates).not.toContain("k");
  });

  test("second encounter: even a mutually positive past meeting with a minor is never repeated", () => {
    const mk = () => people(["a", "b"], i => {
      i.interactions = [{ id: "h1", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - 5 * DAY, outcome: "completed" }];
      i.feedback = [
        { id: "f1", from: "a", about: "b", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
        { id: "f2", from: "b", about: "a", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
      ];
    });
    expect(secondEncounter(ctx(mk())).length).toBe(1);
    expect(secondEncounter(ctx(setAge(mk(), "b", 17)))).toEqual([]);
  });

  test("newcomer welcome: no welcome group for a minor newcomer; a minor host is never used", () => {
    const ids = ["n", "h", "f1", "f2", "f3"];
    const mk = () => people(ids, i => {
      i.members[0]!.joinedAt = NOW - 3 * DAY;
      i.facets.push(facet("h", 0, "offer", "loves hosting gatherings and dinners", ["host"]));
      for (const id of ids) i.facets.push(facet(id, 1, "interest", "cooking dinners and trying new restaurants", ["cooking"]));
    });
    expect(newcomerWelcome(ctx(mk())).length).toBe(1);
    expect(newcomerWelcome(ctx(setAge(mk(), "n", 15)))).toEqual([]);
    expect(newcomerWelcome(ctx(setAge(mk(), "h", 17)))).toEqual([]); // the only host is a minor
  });

  test("network growth: a minor is never asked, and a minor's unmet need never becomes an ask", () => {
    // Minor k is the best-connected local: never chosen as connector.
    const mk = () => people(["a", "k", "c2", "c3"], i => {
      for (const x of ["a", "c2", "c3"]) i.edges.push({ from: "k", to: x, type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
      i.edges.push({ from: "c2", to: "c3", type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
      i.edges.push({ from: "a", to: "c2", type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
    });
    expect(touchesAny(networkGrowth(ctx(mk())), ["k"]).length).toBeGreaterThan(0);
    expect(touchesAny(networkGrowth(ctx(setAge(mk(), "k", 16))), ["k"])).toEqual([]);
    // Only the minor has an unmet intent: no "unmet" gap ask about it reaches adults.
    const unmet = people(["k", "c1", "c2", "c3"], i => {
      for (const x of ["c2", "c3"]) i.edges.push({ from: "c1", to: x, type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
      i.edges.push({ from: "c2", to: "c3", type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
      i.facets.push(facet("c1", 0, "offer", "loves hosting gatherings and dinners", ["host"]));
      i.intents.push(intent("k", "learn to fly fish in the mountains", "hobby"));
    });
    const c = ctx(setAge(unmet, "k", 15));
    intentToCapability(c); // marks the minor's intent unmatched (the minor's own intent is skipped by the filter)
    c.unmatchedIntents.add("k-i" + "learn to fly fish in the mountains".length); // even if it were recorded
    const out = networkGrowth(c);
    expect(out.filter(o => o.anchor?.id.startsWith("unmet:"))).toEqual([]);
  });

  test("expansion: no expansion intro with a minor on either side", () => {
    const mk = () => people(["eng", "pot"], i => {
      i.facets.push(facet("eng", 0, "interest", "machine learning and AI research", ["ai"]), facet("eng", 1, "interest", "AI agents", ["ai"]));
      i.facets.push(facet("eng", 2, "desire", "I miss making things with my hands like pottery and ceramics", ["ceramics"]));
      i.facets.push(facet("pot", 0, "skill", "ceramics teacher with a pottery wheel studio", ["ceramics"]), facet("pot", 1, "interest", "pottery and ceramics", ["ceramics"]));
    });
    expect(expansion(ctx(mk())).length).toBe(1);
    expect(expansion(ctx(setAge(mk(), "pot", 16)))).toEqual([]);
    expect(expansion(ctx(setAge(mk(), "eng", 16)))).toEqual([]);
  });

  test("end to end: a minor who would be the best match gets nothing; the adult still does", async () => {
    const inp = sailingPair();
    inp.members.push(baseMember("k", { age: 16 }));
    home(inp, "k");
    inp.facets.push(facet("k", 0, "offer", "teaches sailing to beginners, junior sailing champion", ["sailing"]), facet("k", 1, "interest", "sailing on the bay and the ocean", ["sailing"]));
    const { proposals, runLog } = await runEngine(inp, { seed: 1 });
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.participants.sort()).toEqual(["a", "b"]);
    expect(JSON.stringify({ proposals, runLog })).not.toMatch(/(^|[^A-Za-z0-9])k(?![0-9A-Za-z])|\bK\b/);
    expect(runLog.funnel.memberFunnel.underage).toBe(1);
    expect(runLog.funnel.rejectedAfterSelection).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------
// Property tests: random worlds with 10-20% minors (ages 13-17) who look attractive to every
// generator (same facets, intents, hosts, romance opt-ins, warm ties, invites and history).
const WORLDS = Array.from({ length: 18 }, (_, i) => ({ seed: 5000 + i * 13, members: 40 + ((i * 41) % 130), minorShare: [0.1, 0.15, 0.2][i % 3]! }));

function minorViolations(inp: EngineInput, proposals: EngineProposal[], runLog: MatchingRunLog): string[] {
  const C = resolver(inp);
  const minors = inp.members.filter(m => !(m.age >= 18));
  const minorIds = new Set(minors.map(m => m.id));
  const aliasesOfMinor = Object.entries(inp.idAliases ?? {}).filter(([, v]) => minorIds.has(C(v))).map(([k]) => k);
  const v: string[] = [];
  for (const p of proposals) {
    const roles = [...p.participants, ...p.alternates, ...(p.via ? [p.via] : []), ...Object.keys(p.roles), ...Object.keys(p.explanations)];
    for (const id of roles) if (minorIds.has(C(id))) v.push(`${p.id}/${p.generator}: minor ${id} in role ${p.roles[id] ?? "alternate/via"}`);
    if (p.anchor?.type === "member" && minorIds.has(C(p.anchor.id))) v.push(`${p.id}: anchored on minor ${p.anchor.id}`);
    if (p.anchor?.type === "intent") {
      const it = inp.intents.find(i => i.id === p.anchor!.id);
      if (it && minorIds.has(C(it.memberId))) v.push(`${p.id}: anchored on a minor's intent`);
    }
    const text = [...Object.values(p.explanations), p.objective, p.anchor?.label ?? ""].join(" ");
    for (const m of minors) if (new RegExp(`\\b${m.name}\\b`).test(text)) v.push(`${p.id}: mentions minor ${m.name}`);
  }
  // No adult-facing output and no run-log field carries a minor's id or alias.
  const out = JSON.stringify(proposals) + JSON.stringify(runLog);
  for (const id of [...minorIds, ...aliasesOfMinor]) if (new RegExp(`(^|[^A-Za-z0-9])${id.replace(/[:.]/g, "\\$&")}(?![0-9])`).test(out)) v.push(`output mentions minor id ${id}`);
  if (runLog.funnel.rejectedAfterSelection) v.push(`final guard fired: ${JSON.stringify(runLog.funnel.rejectedAfterSelection)}`);
  return v;
}

describe("property: random worlds with 10-20% minors", () => {
  const results: { inp: EngineInput; proposals: EngineProposal[]; runLog: MatchingRunLog; raw: Candidate[] }[] = [];
  test("engine runs and still serves adults", async () => {
    for (const wo of WORLDS) {
      const inp = randomWorld({ members: wo.members, seed: wo.seed, minorShare: wo.minorShare });
      expect(inp.members.filter(m => m.age < 18).length).toBeGreaterThan(0);
      const { proposals, runLog } = await runEngine(inp, { seed: wo.seed });
      // Raw generator output (before candidateReason) must already be minor-free.
      const c: GenCtx = { w: mkWorld(inp, { seed: wo.seed }), memberExclusions: {}, rng: new Rng(wo.seed), unmatchedIntents: new Set() };
      const raw = GENERATORS.flatMap(g => g.run(c));
      results.push({ inp, proposals, runLog, raw });
    }
    const minors = results.reduce((s, r) => s + r.inp.members.filter(m => m.age < 18).length, 0);
    const total = results.reduce((s, r) => s + r.inp.members.length, 0);
    expect(minors / total).toBeGreaterThan(0.08);
    expect(results.reduce((s, r) => s + r.proposals.length, 0)).toBeGreaterThan(100);
    const gens = new Set(results.flatMap(r => r.proposals.map(p => p.generator)));
    expect(gens.size).toBeGreaterThanOrEqual(7); // the policy does not silently switch generators off
  }, 90_000);

  test("zero proposals involve a minor in any role; no output or run-log field names a minor", () => {
    expect(results.flatMap(r => minorViolations(r.inp, r.proposals, r.runLog))).toEqual([]);
  });

  test("every generator's raw candidates are minor-free (participants, alternates, via, roles)", () => {
    const bad: string[] = [];
    for (const r of results) {
      const minors = new Set(r.inp.members.filter(m => !(m.age >= 18)).map(m => m.id));
      for (const c of r.raw) for (const id of [...involvedMembers(c), ...Object.keys(c.roles)]) if (minors.has(id)) bad.push(`${c.generator}: ${id}`);
    }
    expect(bad).toEqual([]);
  });

  test("minors are counted (aggregate only) in the member funnel and never in fairness cohorts", () => {
    for (const r of results) {
      const n = r.inp.members.filter(m => !(m.age >= 18)).length;
      expect(r.runLog.funnel.memberFunnel.underage).toBe(n);
      expect(r.runLog.fairness.eligibleMembers).toBeLessThanOrEqual(r.inp.members.length - n);
    }
  });
});
