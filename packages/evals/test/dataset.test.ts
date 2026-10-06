import { beforeAll, describe, expect, test } from "bun:test";
import { buildRecDataset, datasetComposition, publicPolicyViolation, type RecDataset } from "../src/recDataset.ts";
import { buildJudgeDataset } from "../src/judgeDataset.ts";
import { CALIBRATION_SET } from "../../judge/src/calibration.ts";
import { constantBaseline, engineBaseline, scoreRec } from "../src/runRec.ts";
import { rulesBaseline, scoreJudge } from "../src/runJudge.ts";

let ds: RecDataset;
beforeAll(async () => { ds = await buildRecDataset(); }, 120_000);

describe("recommender dataset", () => {
  test("size and balance: ~300 pairs + ~60 groups, ~40% good", () => {
    const c = datasetComposition(ds.items);
    expect(c.pairs).toBeGreaterThanOrEqual(280);
    expect(c.pairs).toBeLessThanOrEqual(320);
    expect(c.groups).toBeGreaterThanOrEqual(50);
    expect(c.groups).toBeLessThanOrEqual(70);
    expect(c.good / c.total).toBeGreaterThan(0.33);
    expect(c.good / c.total).toBeLessThan(0.47);
    for (const w of ["sf-1", "sf-2", "nyc-1", "nyc-2"]) expect(c.byWorld[w]).toBeGreaterThan(0);
  });
  test("deterministic for fixed seeds", async () => {
    const again = await buildRecDataset();
    expect(again.items.map(i => [i.id, i.config.participants, i.config.via, i.truth.good, i.truth.unsafeReason]))
      .toEqual(ds.items.map(i => [i.id, i.config.participants, i.config.via, i.truth.good, i.truth.unsafeReason]));
  }, 120_000);
  test("unique ids, group sizes 3-5, pairs of 2, no duplicate participants", () => {
    expect(new Set(ds.items.map(i => i.id)).size).toBe(ds.items.length);
    for (const i of ds.items) {
      const n = i.config.participants.length;
      if (i.group) { expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(6); } else expect(n).toBe(2);
      expect(new Set(i.config.participants).size).toBe(n);
    }
  });
  test("every adversarial category is present and every unsafe item is labeled bad", () => {
    const reasons = new Set(ds.items.map(i => i.truth.unsafeReason).filter(Boolean));
    for (const r of ["blocked", "minor_participant", "minor_connector", "romance_no_mutual_optin"]) expect(reasons.has(r as any)).toBe(true);
    for (const i of ds.items.filter(x => x.truth.unsafe)) {
      expect(i.truth.good).toBe(false);
      expect(publicPolicyViolation(ds.worlds.get(i.world)!, i.config)).toBeDefined();
    }
    // Conversely, nothing labeled good violates public policy.
    for (const i of ds.items.filter(x => x.truth.good)) expect(publicPolicyViolation(ds.worlds.get(i.world)!, i.config)).toBeUndefined();
    expect(ds.items.some(i => i.group && i.truth.unsafe)).toBe(true);
    expect(ds.items.some(i => i.truth.hiddenRisk)).toBe(true);
  });
  test("good labels agree with the oracle", () => {
    for (const i of ds.items.filter(x => x.truth.good)) {
      expect(i.truth.oracleCompatible).toBe(true);
      expect(i.truth.oracleUnsafe).toBe(false);
    }
    for (const i of ds.items) expect(Object.keys(i.truth.participants).sort()).toEqual([...i.config.participants].sort());
  });
  test("baselines score sensibly", () => {
    const no = scoreRec("always-no", ds.items, constantBaseline(ds, false));
    expect(no.accuracy).toBeCloseTo(1 - ds.items.filter(i => i.truth.good).length / ds.items.length);
    expect(no.unsafeRejectionRate).toBe(1);
    const eng = scoreRec("engine", ds.items, engineBaseline(ds));
    // The engine's hard filters must never propose a policy-unsafe configuration.
    expect(eng.unsafeRejectionRate).toBe(1);
    expect(eng.failures).toBe(0);
  });
});

describe("judge dataset", () => {
  const items = buildJudgeDataset();
  test("183 items (121 original + 62 hard), unique ids, all calibration items reused verbatim", () => {
    expect(items.length).toBe(183);
    expect(items.filter(i => i.sub === "hard").length).toBe(62);
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
    for (const c of CALIBRATION_SET) expect(items.find(i => i.id === c.id)?.input).toBe(c);
  });
  test("every category has both pass and fail gold labels", () => {
    for (const cat of ["tone", "one_question", "privacy", "shareability", "timing", "policy"]) {
      const xs = items.filter(i => i.category === cat);
      expect(xs.length).toBeGreaterThanOrEqual(10);
      expect(xs.some(i => i.label)).toBe(true);
      expect(xs.some(i => !i.label)).toBe(true);
    }
    expect(items.some(i => i.category === "privacy" && i.sub === "inference" && !i.label)).toBe(true);
    expect(items.some(i => i.category === "policy" && i.sub === "minor")).toBe(true);
    expect(items.some(i => i.category === "policy" && i.sub === "romance")).toBe(true);
  });
  test("one-question gold labels match the deterministic question counter", () => {
    const { countQuestions } = require("../../judge/src/rules.ts");
    for (const i of items.filter(x => x.category === "one_question")) {
      const msg = (i.input as any).message as string;
      expect(countQuestions(msg) <= 1).toBe(i.label);
    }
  });
  test("judge scoring: failures count as disagreement and as missed leaks", () => {
    const perfect = items.map(i => ({ itemId: i.id, model: "x", predicted: i.label, records: [] }));
    const s = scoreJudge("x", items, perfect);
    expect(s.agreement).toBe(1);
    expect(s.kappa).toBe(1);
    expect(s.privacyFnRate).toBe(0);
    const failed = items.map(i => ({ itemId: i.id, model: "y", predicted: null, records: [] }));
    const f = scoreJudge("y", items, failed);
    expect(f.agreement).toBe(0);
    expect(f.privacyFnRate).toBe(1);
    const rules = scoreJudge("rules", items, rulesBaseline(items), { skipUnscored: true });
    expect(rules.scored).toBeLessThan(items.length);
  });
  test("hard items: every category has both labels; ids marked *-hard-*", () => {
    for (const cat of ["tone", "privacy", "shareability", "timing", "policy"]) {
      const xs = items.filter(i => i.category === cat && i.sub === "hard");
      expect(xs.length).toBeGreaterThanOrEqual(7);
      expect(xs.some(i => i.label)).toBe(true);
      expect(xs.some(i => !i.label)).toBe(true);
      for (const x of xs) expect(x.id).toContain("-hard-");
    }
  });
  test("policy rules are high-precision: a deterministic violation is never on a compliant gold item", () => {
    const { checkPolicy } = require("../../judge/src/policy.ts");
    let blocked = 0;
    for (const i of items.filter(x => x.category === "policy")) {
      const it = i.input as any;
      const v = checkPolicy(it.message, it.context).verdict;
      if (v === "violation") { blocked++; expect(i.label).toBe(false); }
      if (v === "clear" && !i.label) console.log(`  rules see no signal on violating item ${i.id} (the LLM must catch it)`);
    }
    expect(blocked).toBeGreaterThanOrEqual(12);
  });
  test("production policy = rules override the model; rules never flip a model's fail to pass", () => {
    const { productionPolicy } = require("../src/runJudge.ts");
    const yes = items.map(i => ({ itemId: i.id, model: "m", predicted: true, records: [] }));
    const prod = productionPolicy(items, yes, "m + rules");
    const pol = items.map((it, k) => k).filter(k => items[k]!.category === "policy");
    expect(pol.some(k => prod[k].predicted === false)).toBe(true);
    for (let k = 0; k < items.length; k++) if (items[k]!.category !== "policy") expect(prod[k].predicted).toBe(true);
    const no = items.map(i => ({ itemId: i.id, model: "m", predicted: false, records: [] }));
    for (const r of productionPolicy(items, no, "x")) expect(r.predicted).toBe(false);
  });
});
