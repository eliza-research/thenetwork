// Dataset v2 (soft labels, systematic selection, opt-in consistency) and the v3 prompts built on it:
// labels behave as specified, the build is deterministic, and no v3 prompt carries hidden truth.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildJudgeMessages } from "../../engine/src/judge.ts";
import { buildDeepMessages, hardGate } from "../../engine/src/judgeDeep.ts";
import { buildPublicView, screenMessages } from "../../engine/src/judgeScreen.ts";
import type { World } from "../../engine/src/world.ts";
import { Oracle } from "../../sim/src/oracle.ts";
import { canariesOf } from "../../sim/src/persona.ts";
import { brierSoft, eceSoft, logLossSoft } from "../src/metrics.ts";
import { buildRecDataset, publicPolicyViolation, type RecDataset } from "../src/recDataset.ts";
import { candidateOf, engineWorlds } from "../src/runPasses.ts";
import { oracleSeedOf, V2_DEV_WORLDS, V2_TEST_WORLDS, WORLD_START } from "../src/worlds.ts";

const WORLDS = [V2_DEV_WORLDS[0]!, V2_TEST_WORLDS[0]!];
let ds: RecDataset;
let worlds: Map<string, World>;
beforeAll(async () => { ds = await buildRecDataset({ version: 2, worlds: WORLDS }); worlds = engineWorlds(ds); }, 300_000);

describe("dataset v2 labels", () => {
  test("binary label is pGood >= 0.5; policy-unsafe items have pGood 0; splits come from the world", () => {
    for (const i of ds.items) {
      expect(i.truth.pGood).toBeGreaterThanOrEqual(0);
      expect(i.truth.pGood).toBeLessThanOrEqual(1);
      expect(i.truth.good).toBe(!i.truth.unsafe && i.truth.pGood! >= 0.5);
      if (i.truth.unsafe) expect(i.truth.pGood).toBe(0);
      expect(i.split).toBe(i.world.startsWith("sf-1") ? "dev" : "test");
    }
    expect(ds.items.some(i => i.truth.good)).toBe(true);
  });
  test("pGood matches an independent Monte Carlo over oracle seeds (different seeds, within sampling error)", () => {
    const sample = ds.items.filter(i => !i.truth.unsafe).slice(0, 25);
    for (const it of sample) {
      const w = ds.worlds.get(it.world)!;
      const ors = Array.from({ length: 300 }, (_, k) => new Oracle(w.personas, `${oracleSeedOf(w.spec)}:check:${k}`, WORLD_START));
      const p = ors.filter(o => o.evaluate({ id: "x", ...it.config }).compatible).length / ors.length;
      expect(Math.abs(p - it.truth.pGood!)).toBeLessThan(0.15);
    }
  });
  test("selection is on fit: good items are not good by a lucky draw more often than bad items are bad by an unlucky one", () => {
    const good = ds.items.filter(i => i.truth.good), bad = ds.items.filter(i => !i.truth.good && !i.truth.unsafe);
    const lucky = good.filter(i => i.truth.pGood! < 0.5).length; // impossible by definition
    expect(lucky).toBe(0);
    // The single draw still disagrees sometimes, in both directions.
    expect(good.filter(i => !i.truth.drawnGood).length + bad.filter(i => i.truth.drawnGood).length).toBeGreaterThan(0);
  });
  test("opt-in consistency: the hard gate never rejects a non-policy item for an opt-out, and nothing good violates policy", () => {
    for (const i of ds.items) {
      const g = hardGate(worlds.get(i.world)!, i.config);
      if (!i.source.startsWith("adversarial_")) expect(g === "category_opt_out" || g === "romance_opt_out").toBe(false);
      if (i.truth.good) { expect(g).toBeNull(); expect(publicPolicyViolation(ds.worlds.get(i.world)!, i.config)).toBeUndefined(); }
    }
  });
  test("deterministic", async () => {
    const again = await buildRecDataset({ version: 2, worlds: WORLDS });
    expect(again.items.map(i => [i.id, i.config.participants, i.config.category, i.truth.pGood, i.truth.good]))
      .toEqual(ds.items.map(i => [i.id, i.config.participants, i.config.category, i.truth.pGood, i.truth.good]));
  }, 300_000);
});

describe("v3 prompts carry no hidden truth (dataset v2)", () => {
  const prompts = (i: RecDataset["items"][number]) => {
    const w = worlds.get(i.world)!;
    const c = candidateOf(w, i);
    return {
      p1: JSON.stringify(screenMessages(buildPublicView(ds.worlds.get(i.world)!.snapshot(), i.config))),
      p2: JSON.stringify(buildJudgeMessages(w, c, "v3").messages),
      p3: JSON.stringify(buildDeepMessages(w, c).messages),
    };
  };
  test("no canaries, names, ids, labels or source-truth words; passes 1-2 never see a boundary or private disclosure", () => {
    const bad = /\b(adversarial|harasser|scammer|spammer|lying_minor|ex_partners|hidden_risk|engine_candidate|intent_match|pool_group|oracle|trueAge|wrong_inference|observationTruth|richness|very_rich|knowledge|pGood|drawnGood)\b/i;
    let flagged = 0;
    for (const i of ds.items) {
      const ew = ds.worlds.get(i.world)!;
      const { p1, p2, p3 } = prompts(i);
      const all = p1 + p2 + p3;
      for (const c of canariesOf(ew.personas)) expect(all.includes(c.canary)).toBe(false);
      expect(bad.test(all)).toBe(false);
      expect(/\b(sf|nyc)-\d-\d{4}\b/.test(all)).toBe(false);
      for (const id of i.config.participants) {
        const p = ew.byId.get(id)!;
        expect(all.includes(p.name)).toBe(false);
        if (p.hidden.privateDisclosure) { expect(p1.includes(p.hidden.privateDisclosure.fact)).toBe(false); expect(p2.includes(p.hidden.privateDisclosure.fact)).toBe(false); }
        for (const b of p.hidden.boundaries) { expect(p1.includes(b)).toBe(false); expect(p2.includes(b)).toBe(false); }
      }
      expect(p2.includes("private_context_never_quote")).toBe(false);
      if (p1.includes("private_boundary_relevant_to")) flagged++;
    }
    expect(flagged).toBeGreaterThan(0); // the redacted flag is actually exercised
  }, 180_000);
  test("prompts are a function of the public config only", () => {
    for (const i of ds.items.slice(0, 30)) {
      const before = prompts(i);
      expect(prompts({ ...i, id: "zz", source: "random", truth: { ...i.truth, good: !i.truth.good, pGood: 0.123, participants: {} } })).toEqual(before);
    }
  });
});

describe("soft-label metrics", () => {
  test("Brier, log-loss and ECE against soft targets", () => {
    expect(brierSoft([0.5, 0.2], [0.5, 0.2])).toBe(0);
    expect(brierSoft([1, 0], [0.5, 0.5])).toBeCloseTo(0.25);
    expect(logLossSoft([0.5], [0.5])).toBeCloseTo(Math.LN2);
    expect(eceSoft([0.9, 0.1], [0.9, 0.1])).toBeCloseTo(0);
    expect(eceSoft([0.95, 0.95], [0.5, 0.5])).toBeCloseTo(0.45);
  });
});
