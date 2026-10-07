// Q4: is the oracle realistic? Decomposes the oracle's acceptance and enjoyment on sim seeds 1-3
// (baseline engine run) and on the synthetic snapshot. Read-only: proposes calibration changes,
// changes nothing (the oracle is shared with another session).
//
//   bun packages/engine/experiments/oracle-realism.ts
import type { MemberId } from "@thenetwork/core";
import { ARCHETYPE_MIX } from "../../sim/src/generator.ts";
import { Oracle, PAIR_CHEMISTRY_SD } from "../../sim/src/oracle.ts";
import type { Persona } from "../../sim/src/persona.ts";
import { loadPersonas, loadSnapshot } from "../../../scripts/synthetic/load.ts";
import { chem, mean, outcomes, pairKey, pct, runSim, table } from "./lib.ts";

const SEEDS = [1, 2, 3];
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const capF = (p: Persona) => 0.3 + 0.7 * p.hidden.capacity;
/** Best-case P(accept) for a persona given the pair's systematic enjoyment (no fatigue, no noise). */
const bestAccept = (p: Persona, eSys: number) => Math.min(1, sigmoid((eSys - 0.5) * 7) * capF(p) * 1.05);

function auc(pos: number[], neg: number[]) {
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / Math.max(1, pos.length * neg.length);
}
function variance(xs: number[]) { const m = mean(xs); return mean(xs.map(x => (x - m) ** 2)); }

const out: string[] = [];
const capRows: (string | number)[][] = [];
const accRows: (string | number)[][] = [];
const allLatent: { city: string; pMutual: number; pMutualNoCap: number; chemOnly: boolean; sys: number }[] = [];
let repeatAcc = 0, repeatDeclinedBefore = 0, catFlip = 0, catTotal = 0, worthNoChem = 0, worthTotal = 0;
const decomp: { logAcc: number; logSig: number; logCap: number; logFat: number }[] = [];
const accCompat: number[] = [], accIncompat: number[] = [];
const enjCompat: number[] = [];
for (const seed of SEEDS) {
  const res = await runSim({ seed, keepTraces: false });
  const o: Oracle = res.oracle;
  const ps = res.personas.filter(p => !p.hidden.adversarial && p.hidden.trueAge >= 18);
  for (const city of ["sf", "nyc"]) {
    const cp = ps.filter(p => p.homeCity === city);
    capRows.push([`seed ${seed} ${city}`, cp.length, mean(cp.map(p => p.hidden.capacity)).toFixed(2), mean(cp.map(capF)).toFixed(2), pct(cp.filter(p => capF(p) >= 0.8).length / cp.length),
      Object.entries(countArch(cp)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")]);
  }
  const latent = ((res.records.find((r: any) => r.type === "latent_opportunities") as any).pairs) as { a: MemberId; b: MemberId }[];
  for (const l of latent) {
    const A = o.persona(l.a)!, B = o.persona(l.b)!;
    const v = o.evaluate({ id: `lat:${l.a}:${l.b}`, kind: "intro", participants: [l.a, l.b], city: A.homeCity, window: { start: res.end, end: res.end } });
    const c = chem(seed, l.a, l.b);
    const eA = v.participants[l.a]!.enjoyment - c, eB = v.participants[l.b]!.enjoyment - c;
    const pA = bestAccept(A, eA), pB = bestAccept(B, eB);
    allLatent.push({ city: A.homeCity, pMutual: pA * pB, pMutualNoCap: Math.min(1, sigmoid((eA - 0.5) * 7) * 1.05) * Math.min(1, sigmoid((eB - 0.5) * 7) * 1.05), chemOnly: Math.min(eA, eB) < 0.55, sys: Math.min(eA, eB) });
  }
  // acceptance on actual proposals: how much is capacity vs perceived fit?
  const outs = outcomes(res.records);
  const seenPairs = new Map<string, boolean>(); // pair -> declined before
  for (const p of outs.sort((a, b) => a.createdAt - b.createdAt)) {
    const k = p.participants.length === 2 ? pairKey(p.participants[0]!, p.participants[1]!) : "";
    for (const id of p.participants) {
      const ap = p.acceptProb[id]; if (ap === undefined) continue;
      (p.compatible ? accCompat : accIncompat).push(ap);
    }
    if (k && seenPairs.get(k) && p.accepted.length) { repeatAcc += p.accepted.length; }
    if (k && seenPairs.has(k) && seenPairs.get(k)) repeatDeclinedBefore++;
    if (k) seenPairs.set(k, (seenPairs.get(k) ?? false) || p.declined.length > 0);
    // category-aware re-evaluation (the sim's proposal record omits the category)
    if (p.category !== "none") {
      const v2 = o.evaluate({ id: p.id, kind: p.kind as any, participants: p.participants, city: p.city as any, window: undefined, category: p.category as any });
      const v1 = o.evaluate({ id: p.id, kind: p.kind as any, participants: p.participants, city: p.city as any, window: undefined });
      catTotal++; if (v1.compatible !== v2.compatible) catFlip++;
    }
    for (const id of p.participants) {
      const per = o.persona(id)!;
      const ap = p.acceptProb[id];
      if (ap === undefined || ap <= 0) continue;
      const others = p.participants.filter(x => x !== id);
      const v = o.evaluate({ id: p.id, kind: p.kind as any, participants: p.participants, city: p.city as any, window: undefined });
      const e = v.participants[id]!.enjoyment;
      const cm = mean(others.map(x => chem(seed, id, x)));
      const sig = sigmoid((e - cm - 0.5) * 7);
      decomp.push({ logAcc: Math.log(ap), logSig: Math.log(Math.max(1e-6, sig)), logCap: Math.log(capF(per)), logFat: 0 });
      worthTotal++; if ((e >= 0.5) !== (e - cm >= 0.5)) worthNoChem++;
      if (p.compatible) enjCompat.push(e);
    }
  }
}

function countArch(ps: Persona[]) { const m: Record<string, number> = {}; for (const p of ps) m[p.archetype] = (m[p.archetype] ?? 0) + 1; return m; }

out.push("## Oracle realism (sim seeds 1-3, baseline engine)");
out.push("\n**Capacity factor (0.3 + 0.7 x capacity) by city**\n\n" + table(["world", "adults", "mean capacity", "mean factor", "factor >= 0.8", "archetypes"], capRows));
out.push(`\nArchetype mix (generator): ${Object.entries(ARCHETYPE_MIX).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
const byCity = (c: string) => allLatent.filter(l => l.city === c);
out.push("\n**Best-case mutual acceptance for oracle-good pairs** (systematic enjoyment, no fatigue, no decision noise)\n\n" + table(["city", "good pairs", "mean P(both accept)", ">= 0.5", ">= 0.7", ">= 0.9", "max", "mean without the capacity factor", ">= 0.9 without it"],
  ["sf", "nyc"].map(c => { const ls = byCity(c); return [c, ls.length, mean(ls.map(l => l.pMutual)).toFixed(3), pct(ls.filter(l => l.pMutual >= 0.5).length / ls.length), pct(ls.filter(l => l.pMutual >= 0.7).length / ls.length), pct(ls.filter(l => l.pMutual >= 0.9).length / ls.length), Math.max(...ls.map(l => l.pMutual)).toFixed(3), mean(ls.map(l => l.pMutualNoCap)).toFixed(3), pct(ls.filter(l => l.pMutualNoCap >= 0.9).length / ls.length)]; })));
const vLog = variance(decomp.map(d => d.logAcc)), vSig = variance(decomp.map(d => d.logSig)), vCap = variance(decomp.map(d => d.logCap));
out.push(`\n**What drives an invitation decision** (log P(accept) = log fit-sigmoid + log capacity factor + log fatigue/area; ${decomp.length} invitations): variance of log P(accept) ${vLog.toFixed(3)}; fit-sigmoid term ${vSig.toFixed(3)} (${pct(vSig / vLog)}), capacity term ${vCap.toFixed(3)} (${pct(vCap / vLog)}).`);
out.push(`AUC of P(accept) for separating oracle-good from oracle-bad proposals: ${auc(accCompat, accIncompat).toFixed(3)} (members on good proposals: mean P(accept) ${mean(accCompat).toFixed(3)}; bad: ${mean(accIncompat).toFixed(3)}).`);
const chemOnly = allLatent.filter(l => l.chemOnly).length;
out.push(`\n**Chemistry**: SD ${PAIR_CHEMISTRY_SD}. ${chemOnly}/${allLatent.length} oracle-good pairs (${pct(chemOnly / allLatent.length)}) are good only because of a favourable chemistry draw (systematic min enjoyment < 0.55). Systematic min-enjoyment of good pairs: mean ${mean(allLatent.map(l => l.sys)).toFixed(3)}.`);
out.push(`Persona "worthwhile" judgments made at invitation time that flip if the (not yet experienced) chemistry is removed: ${worthNoChem}/${worthTotal} (${pct(worthNoChem / worthTotal)}).`);
out.push(`\n**Repeat proposals**: ${repeatDeclinedBefore} proposals re-proposed a pair that had declined before; they drew ${repeatAcc} fresh accepts (the decision noise is keyed by proposal id, so a re-ask is a new coin flip).`);
out.push(`**Category omitted at scoring**: the world's proposal record calls Oracle.evaluate without the category. Re-evaluating the ${catTotal} engine proposals with their category flips the compatible label on ${catFlip} (${pct(catFlip / Math.max(1, catTotal))}): romance mismatch and "no networking-heavy events" penalties never reach the precision metric.`);

// synthetic: same capacity analysis
const snap = await loadSnapshot();
const personas = await loadPersonas();
const o = new Oracle(personas, 1, snap.now);
const synRows: (string | number)[][] = [];
for (const city of ["sf", "nyc"] as const) {
  const cp = personas.filter(p => p.homeCity === city && !p.hidden.adversarial && p.hidden.trueAge >= 18);
  const lat = o.latentPairs(cp.map(p => p.id), snap.now);
  const pm = lat.map(l => {
    const A = o.persona(l.a)!, B = o.persona(l.b)!;
    const v = o.evaluate({ id: `s:${l.a}:${l.b}`, kind: "intro", participants: [l.a, l.b], city, window: { start: snap.now, end: snap.now } });
    const c = chem(1, l.a, l.b);
    return bestAccept(A, v.participants[l.a]!.enjoyment - c) * bestAccept(B, v.participants[l.b]!.enjoyment - c);
  });
  synRows.push([city, cp.length, mean(cp.map(p => p.hidden.capacity)).toFixed(2), lat.length, mean(pm).toFixed(3), pct(pm.filter(x => x >= 0.7).length / pm.length), pct(pm.filter(x => x >= 0.9).length / pm.length), Math.max(...pm).toFixed(3)]);
}
out.push("\n**Synthetic snapshot: same check**\n\n" + table(["city", "adults", "mean capacity", "good pairs", "mean best-case P(both accept)", ">= 0.7", ">= 0.9", "max"], synRows));
console.log(out.join("\n"));
