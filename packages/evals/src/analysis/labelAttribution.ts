// Label-fix attribution (docs/results/2026-10-07-judge-v2.md). Makes NO model calls.
// Re-scores the OLD per-item verdicts of the 2026-10-06 passes run (old prompts, old dataset) against
//   (a) the label they were scored on then (one oracle draw, pre-fix oracle),
//   (b) the current oracle's single draw (dating opt-in fix, window presence, intent liveness),
//   (c) the v2 soft label: pGood by Monte Carlo over oracle seeds, binary = pGood >= 0.5,
//   (d) (c) restricted to opt-in-consistent items (what dataset v2 keeps),
// so the gain from fixing labels can be separated from the gain from fixing prompts.
//
//   bun run packages/evals/src/analysis/labelAttribution.ts [old-items.jsonl] [out.md]
import { readFileSync, writeFileSync } from "node:fs";
import { DAY } from "../../../core/src/index.ts";
import { Oracle } from "../../../sim/src/oracle.ts";
import { brier, brierSoft, classification } from "../metrics.ts";
import { buildEvalWorld, EVAL_NOW, oracleSeedOf, RICHNESS_WORLDS, WORLD_START, type EvalWorld } from "../worlds.ts";

const inPath = process.argv[2] ?? "runs/evals/results/passes-gpt-6-luna.items.jsonl";
const outPath = process.argv[3] ?? "runs/evals/results/label-attribution.md";
const K = 200;

interface OldItem {
  itemId: string; world: string; label: { good: boolean; unsafe: boolean; hiddenRisk: string | null };
  meta: { group: boolean; kind: string; category: string; objective: string };
  hardGate: string | null; refs: Record<string, string>;
  perPassVerdicts: Record<string, string>; confidence: Record<string, number | null>;
  visibleProfiles: { pass1: { people: { ref: string; attending: boolean }[] } };
}
const items: OldItem[] = readFileSync(inPath, "utf8").trim().split("\n").map(l => JSON.parse(l));

const worlds = new Map<string, { w: EvalWorld; mc: Oracle[] }>();
for (const spec of RICHNESS_WORLDS) {
  const w = buildEvalWorld(spec);
  worlds.set(spec.id, { w, mc: Array.from({ length: K }, (_, k) => new Oracle(w.personas, `${oracleSeedOf(spec)}:mc:${k}`, WORLD_START)) });
}

const rows = items.map(it => {
  const { w, mc } = worlds.get(it.world)!;
  const attending = it.visibleProfiles.pass1.people.filter(p => p.attending).map(p => it.refs[p.ref]!);
  const prop = { id: it.itemId, kind: it.meta.kind as any, participants: attending, city: w.spec.city, window: { start: EVAL_NOW, end: EVAL_NOW + 7 * DAY }, category: it.meta.category as any, objective: it.meta.objective };
  const drawNow = !it.label.unsafe && w.oracle.evaluate(prop).compatible;
  const pGood = it.label.unsafe ? 0 : mc.filter(o => o.evaluate(prop).compatible).length / K;
  const v = it.perPassVerdicts, c = it.confidence;
  // gate > pass 1 > pass 3 from the stored per-pass verdicts (a failed call fails open).
  let pipe13 = "yes", p13 = 1;
  if (it.hardGate) { pipe13 = "no"; p13 = 0; }
  else {
    if (c.pass1 != null) p13 = Math.min(p13, c.pass1);
    if (v.pass1 === "no") pipe13 = "no";
    else { if (c.pass3 != null) p13 = Math.min(p13, c.pass3); if (v.pass3 === "no" || v.pass3 === "abstain") pipe13 = v.pass3; }
  }
  return {
    id: it.itemId, oldGood: it.label.good, drawNow, pGood, newGood: pGood >= 0.5,
    optInConsistent: !(it.hardGate === "category_opt_out" || (it.hardGate === "romance_opt_out" && !it.label.unsafe)),
    dec: { baseline: v.baseline, pass1: v.pass1, pass3: it.hardGate ? "no" : v.pass3, "gate > 1 > 3": pipe13 } as Record<string, string>,
    prob: { baseline: c.baseline, pass1: c.pass1, pass3: it.hardGate ? 0 : c.pass3, "gate > 1 > 3": p13 } as Record<string, number | null>,
  };
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const L: string[] = [];
L.push(`Old per-item verdicts (${inPath}, ${rows.length} items) re-scored against new labels. No model calls. Monte Carlo draws per item: ${K}.`, "");
L.push(`- Old label good: ${rows.filter(r => r.oldGood).length}; current-oracle single draw good: ${rows.filter(r => r.drawNow).length}; pGood >= 0.5: ${rows.filter(r => r.newGood).length}.`);
L.push(`- Old label vs pGood >= 0.5 disagree on ${rows.filter(r => r.oldGood !== r.newGood).length} items (old good -> new bad ${rows.filter(r => r.oldGood && !r.newGood).length}; old bad -> new good ${rows.filter(r => !r.oldGood && r.newGood).length}).`);
L.push(`- Opt-in-inconsistent items (hard gate category/romance opt-out on a non-policy item; dataset v2 drops these): ${rows.filter(r => !r.optInConsistent).length}.`, "");
L.push("| Row (old prompts) | (a) old label: acc / P / R | (b) current oracle, one draw: acc / P / R | (c) pGood >= 0.5: acc / P / R | (d) (c) on opt-in-consistent items: acc / P / R | Brier vs old label | Brier vs pGood |");
L.push("|---|---|---|---|---|---|---|");
for (const name of ["baseline", "pass1", "pass3", "gate > 1 > 3"]) {
  const cell = (sub: typeof rows, gold: (r: typeof rows[number]) => boolean) => {
    const m = classification(sub.map(r => r.dec[name] === "yes"), sub.map(gold));
    return `${pct(m.accuracy)} / ${pct(m.precision)} / ${pct(m.recall)}`;
  };
  const withP = rows.filter(r => r.prob[name] != null);
  L.push(`| ${name} | ${cell(rows, r => r.oldGood)} | ${cell(rows, r => r.drawNow)} | ${cell(rows, r => r.newGood)} | ${cell(rows.filter(r => r.optInConsistent), r => r.newGood)} | ${brier(withP.map(r => r.prob[name]!), withP.map(r => r.oldGood)).toFixed(3)} | ${brierSoft(withP.map(r => r.prob[name]!), withP.map(r => r.pGood)).toFixed(3)} |`);
}
const oracleCeiling = (sub: typeof rows) => sub.filter(r => r.newGood === r.oldGood).length / sub.length;
L.push("", `Agreement of the old drawn label with pGood >= 0.5 (the accuracy of a judge that knew the systematic label exactly, scored on the old label): ${pct(oracleCeiling(rows))}.`);
writeFileSync(outPath, L.join("\n") + "\n");
console.log(L.join("\n"));
