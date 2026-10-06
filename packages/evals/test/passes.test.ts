// Judgment-passes suite: prompts carry no hidden truth / labels / canaries (richness worlds),
// abstention metric math, pipeline semantics, and per-item record shape.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildJudgeMessages } from "../../engine/src/judge.ts";
import { buildDeepMessages } from "../../engine/src/judgeDeep.ts";
import { buildPublicView, screenMessages } from "../../engine/src/judgeScreen.ts";
import { canariesOf } from "../../sim/src/persona.ts";
import { abstentionMetrics, ece, pairedBootstrap, reliability } from "../src/metrics.ts";
import { buildRecDataset, type RecDataset } from "../src/recDataset.ts";
import { itemTier } from "../src/richness.ts";
import { candidateOf, engineWorlds, itemRecord, pipeline, type PassItemResult } from "../src/runPasses.ts";
import type { World } from "../../engine/src/world.ts";

let ds: RecDataset;
let worlds: Map<string, World>;
beforeAll(async () => { ds = await buildRecDataset({ richness: true }); worlds = engineWorlds(ds); }, 180_000);

const prompts = (i: RecDataset["items"][number]) => {
  const w = worlds.get(i.world)!;
  const c = candidateOf(w, i);
  return {
    p1: JSON.stringify(screenMessages(buildPublicView(ds.worlds.get(i.world)!.snapshot(), i.config))),
    p2: JSON.stringify(buildJudgeMessages(w, c).messages),
    p3: JSON.stringify(buildDeepMessages(w, c).messages),
  };
};

describe("passes 1-3 prompts never carry hidden truth or labels (richness worlds)", () => {
  test("richness tiers are exposed to the harness and the dataset keeps its shape", () => {
    expect(ds.items.length).toBeGreaterThan(300);
    const tiers = new Set(ds.items.map(i => itemTier(ds.worlds.get(i.world)!, ds.worlds.get(i.world)!.snapshot(), i.config.participants)));
    expect(tiers.has("minimal")).toBe(true);
    expect(tiers.has("medium")).toBe(true);
  });
  test("no canaries, names, member ids, item metadata, tier names or source-truth labels in any pass prompt", () => {
    const bad = /\b(adversarial|harasser|scammer|spammer|lying_minor|ex_partners|hidden_risk|engine_candidate|intent_match|pool_group|oracle|trueAge|wrong_inference|observationTruth|richness|very_rich|knowledge)\b/i;
    for (const i of ds.items) {
      const ew = ds.worlds.get(i.world)!;
      const all = Object.values(prompts(i)).join("\n");
      for (const c of canariesOf(ew.personas)) expect(all.includes(c.canary)).toBe(false);
      for (const id of [...i.config.participants, ...(i.config.via ? [i.config.via] : [])]) {
        const p = ew.byId.get(id)!;
        expect(all.includes(p.name)).toBe(false);
        expect(all.includes(p.id)).toBe(false);
      }
      expect(/\b(sf|nyc)-\d-\d{4}\b/.test(all)).toBe(false);
      expect(bad.test(all)).toBe(false);
      expect(all.includes(i.id)).toBe(false);
    }
  }, 120_000);
  test("passes 1-2 never see agent_private facts; pass 3 sees them only under private_context_never_quote", () => {
    for (const i of ds.items.slice(0, 120)) {
      const ew = ds.worlds.get(i.world)!;
      const { p1, p2, p3 } = prompts(i);
      for (const id of i.config.participants) {
        const p = ew.byId.get(id)!;
        if (p.hidden.privateDisclosure) { expect(p1.includes(p.hidden.privateDisclosure.fact)).toBe(false); expect(p2.includes(p.hidden.privateDisclosure.fact)).toBe(false); }
        for (const b of p.hidden.boundaries) { expect(p1.includes(b)).toBe(false); expect(p2.includes(b)).toBe(false); }
      }
      const user = JSON.parse(JSON.parse(p3)[1].content);
      for (const person of user.people) for (const f of person.facts) expect(["shareable", "do_not_quote"]).toContain(f.visibility);
    }
  });
  test("prompts are a function of the public config only: flipping labels never changes them", () => {
    for (const i of ds.items.slice(0, 40)) {
      const before = prompts(i);
      const flipped = { ...i, source: "random" as const, id: "zz", truth: { ...i.truth, good: !i.truth.good, unsafe: !i.truth.unsafe, quality: 0.123456, participants: {} } };
      expect(prompts(flipped)).toEqual(before);
    }
  });
});

describe("abstention metrics", () => {
  test("abstain-as-no, selective, coverage-adjusted precision", () => {
    // gold:      T     T        F      F      T     F
    const pred = ["yes", "abstain", "no", "yes", "no", "abstain"] as const;
    const gold = [true, true, false, false, true, false];
    const m = abstentionMetrics([...pred], gold);
    expect(m.abstentions).toBe(2);
    expect(m.abstainRate).toBeCloseTo(2 / 6);
    expect(m.coverage).toBeCloseTo(4 / 6);
    // abstain = no: tp 1, fp 1, tn 2 (idx 2, 5), fn 2 (idx 1, 4)
    expect(m.asNo).toMatchObject({ tp: 1, fp: 1, tn: 2, fn: 2 });
    expect(m.asNo.precision).toBeCloseTo(0.5);
    expect(m.asNo.recall).toBeCloseTo(1 / 3);
    // selective on answered (idx 0, 2, 3, 4): acc 2/4, precision 1/2, recall 1/2
    expect(m.selective.n).toBe(4);
    expect(m.selective.accuracy).toBeCloseTo(0.5);
    expect(m.selective.recall).toBeCloseTo(0.5);
    expect(m.coverageAdjustedPrecision).toBeCloseTo(0.5 * 4 / 6);
    expect(m.abstainRateOnGood).toBeCloseTo(1 / 3);
    expect(m.abstainRateOnBad).toBeCloseTo(1 / 3);
  });
  test("failures count as wrong and are not abstentions", () => {
    const m = abstentionMetrics([null, "yes"], [true, true]);
    expect(m.failures).toBe(1);
    expect(m.abstentions).toBe(0);
    expect(m.asNo.accuracy).toBeCloseTo(0.5);
    expect(m.coverage).toBeCloseTo(0.5);
  });
  test("ECE and reliability", () => {
    expect(ece([0.9, 0.9, 0.1, 0.1], [true, true, false, false])).toBeCloseTo(0.1);
    expect(ece([0.5, 0.5], [true, false])).toBeCloseTo(0);
    const r = reliability([0.05, 0.95], [false, true]);
    expect(r[0]!.n).toBe(1); expect(r[9]!.rate).toBe(1);
  });
  test("paired bootstrap: identical rows give a zero difference", () => {
    const b = pairedBootstrap(50, idx => idx.length, idx => idx.length);
    expect(b.diff).toBe(0); expect(b.lo).toBe(0); expect(b.hi).toBe(0);
  });
});

describe("pipeline semantics", () => {
  const mk = (o: { gate?: string | null; p1?: string | null; p2?: string | null; p3?: string | null }): PassItemResult => {
    const run = (v: any) => ({ ok: !!v, verdict: v, attempts: 1, records: [], visible: {} });
    return {
      itemId: "x", world: "w", model: "m", label: { good: true, unsafe: false, oracleFlags: [], quality: 0.7, minEnjoyment: 0.6 },
      meta: { group: false, source: "random", kind: "intro", category: "social", objective: "", proxyBucket: "facts 4-5" },
      refs: {}, hardGate: o.gate ?? null,
      pass1: run(o.p1 === null ? null : { verdict: o.p1 ?? "yes", dealbreaker: false, matchProbability: 0.7, reasoning: "r", citedFacts: [], acceptProbability: {}, memberWhy: "", reasoningFirst: true, pass: 1 }) as any,
      pass2: run(o.p2 === null ? null : { verdict: o.p2 ?? "yes", dealbreaker: false, matchProbability: 0.6, fit: 1, mutualValue: 1, capacityRealism: 1, timing: 1, socialComfort: 1, redFlags: 0, certainty: 1, why: {} }) as any,
      pass3: run(o.p3 === null ? null : { verdict: o.p3 ?? "yes", matchProbability: 0.8, rubric: {}, memberWhy: {} }) as any,
      memberFacing: { pass1: "", pass2: {}, pass3: {} },
      leaks: {} as any, internalCanaries: 0, hidden: { byRef: {} },
    };
  };
  test("gate wins over three yeses; stops at first no; abstain is not a proposal; failures fail open", () => {
    expect(pipeline(mk({ gate: "underage" })).decision).toBe("no");
    expect(pipeline(mk({})).decision).toBe("yes");
    expect(pipeline(mk({})).prob).toBeCloseTo(0.6);
    expect(pipeline(mk({ p2: "no" })).stoppedAt).toBe("pass2");
    expect(pipeline(mk({ p3: "insufficient_information" })).decision).toBe("abstain");
    expect(pipeline(mk({ p2: null })).decision).toBe("yes");
    expect(pipeline(mk({ p1: "no" }), ["pass1", "pass3"]).reached).toEqual(["pass1"]);
  });
  test("per-item record keeps hidden truth in its own block", () => {
    const r = itemRecord(mk({}));
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["itemId", "label", "perPassVerdicts", "explanations", "confidence", "visibleProfiles", "hidden"]));
    expect(r.perPassVerdicts.pipeline).toBe("yes");
  });
});
