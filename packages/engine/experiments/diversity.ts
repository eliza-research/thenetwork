// Q3: diversity. Measures the current state on sim seeds 1-3 and tests diversity levers, each
// with its precision cost. Hard rules are untouched (filters unchanged; minors/blocks/opt-ins).
//
//   bun packages/engine/experiments/diversity.ts               # baseline state + all levers
//   bun packages/engine/experiments/diversity.ts --only <regex>
//
// Definitions (harness side, from persona data; the engine never sees these labels):
//   interest community = the taxonomy cluster (outdoors, arts, tech...) of most of a persona's
//     stated interests; social community = connected component of the relationship graph
//     (friends, coworkers, siblings, roommates) plus invite edges.
//   bridging rate = share of pair proposals whose two members are in different communities.
//   closure (redundant) = the pair already shares a friend (2-hop in the relationship graph).
//   repeat pairing = a pair proposed more than once in the run.
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import { INTERESTS } from "../../sim/src/taxonomy.ts";
import type { Persona } from "../../sim/src/persona.ts";
import type { EngineConfigInput } from "../src/config.ts";
import type { EngineInput } from "../src/types.ts";
import { augment, historyFromRecords, type AugmentOpts } from "./augment.ts";
import { retune, romanceNeedsPrefs } from "./sweeps.ts";
import type { Scored } from "../src/scoring.ts";
import type { World } from "../src/world.ts";
const COMBO_D_RESCORE = (w: World, s: Scored[]) => romanceNeedsPrefs(w, [retune(x => x.c.category === "professional", 0.38), retune(x => x.c.category === "romance", 0.45), retune(x => x.c.category === "hobby" && x.threshold <= 0.3, 0.26)].reduce((acc, f) => f(w, acc), s));
import { entropy, gini, mean, outcomes, pairKey, pct, runSim, table, type Hooks, type SimHookCtx } from "./lib.ts";
import type { SelectLevers } from "./select.ts";

const args = parseArgs({ options: { only: { type: "string" }, seeds: { type: "string", default: "1,2,3" }, history: { type: "boolean", default: false } } }).values;
const SEEDS = args.seeds!.split(",").map(Number);
const clusterOfTag = new Map(INTERESTS.map(i => [i.tag, i.cluster]));

function interestCommunity(p: Persona): string {
  const c = new Map<string, number>();
  for (const t of p.public.statedInterests) { const k = clusterOfTag.get(t) ?? "other"; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "none";
}
function components(ps: Persona[]): Map<MemberId, string> {
  const parent = new Map<MemberId, MemberId>(ps.map(p => [p.id, p.id]));
  const find = (x: MemberId): MemberId => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const union = (a: MemberId, b: MemberId) => { if (!parent.has(a) || !parent.has(b)) return; parent.set(find(a), find(b)); };
  for (const p of ps) { for (const r of p.relationships) if (r.type !== "ex") union(p.id, r.to); if (p.invitedBy) union(p.id, p.invitedBy); }
  return new Map(ps.map(p => [p.id, find(p.id)]));
}

interface Lever { name: string; cfg?: EngineConfigInput; aug?: AugmentOpts; levers?: (ctx: SimHookCtx) => SelectLevers; rescore?: Hooks["rescore"] }

const LEVERS: Lever[] = [
  { name: "baseline" },
  { name: "exploration 0%", cfg: { exploration: { rate: 0 } } },
  { name: "exploration 15%", cfg: { exploration: { rate: 0.15, maxShare: 0.15 } } },
  { name: "exploration 15%, weight = novelty only (not x score)", cfg: { exploration: { rate: 0.15, maxShare: 0.15 } }, levers: () => ({ exploreWeight: x => Math.max(0.01, x.components.novelty) }) },
  { name: "MMR 0.05 (member-level category/cluster)", levers: () => ({ mmr: 0.05 }) },
  { name: "MMR 0.10", levers: () => ({ mmr: 0.1 }) },
  { name: "exposure debt carried, weight 0.05", aug: { carryDebt: true } },
  { name: "exposure debt carried, weight 0.15", aug: { carryDebt: true }, cfg: { selection: { exposureDebtWeight: 0.15 } } },
  { name: "exposure debt carried, weight 0.30", aug: { carryDebt: true }, cfg: { selection: { exposureDebtWeight: 0.3 } } },
  { name: "cluster-pair quota 15%", levers: () => ({ clusterPairShare: 0.15 }) },
  { name: "bridge bonus +0.03", levers: () => ({ bridgeBonus: 0.03 }) },
  { name: "bridge bonus +0.06", levers: () => ({ bridgeBonus: 0.06 }) },
  { name: "novelty weight 0.4", cfg: { weights: { novelty: 0.4 } } },
  { name: "category rotation -0.05", levers: ctx => ({ categoryRotation: 0.05, lastCategory: lastCategory(ctx) }) },
  { name: "group mixing: theme groups on (interests shareable)", aug: { shareInterests: true } },
  { name: "pacing 1/night (spreads budget)", levers: () => ({ perRunCap: 1 }) },
  { name: "complementarity weight 0.35", cfg: { complementarity: { weight: 0.35 } } },
  { name: "history fed (pair cooldown after a decline)", aug: { history: true } },
  { name: "events 6/wk, event_anchor threshold 0.40", aug: { events: 6 }, rescore: retune(s => s.c.generator === "event_anchor", 0.4) },
  { name: "growth wants routed as hobby", aug: { growthAsHobby: true } },
  { name: "COMBO D (see sweeps.ts)", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { dropSkipped: true, growthAsHobby: true }, rescore: COMBO_D_RESCORE, levers: ctx => ({ exclude: historyFromRecords(ctx.world.records, ctx.now).busy }) },
  { name: "COMBO F (see sweeps.ts)", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { dropSkipped: true, growthAsHobby: true, shareInterests: true, events: 6 }, rescore: (w, x) => retune(s => s.c.generator === "event_anchor" || s.c.generator === "group_composer", 0.4)(w, COMBO_D_RESCORE(w, x)), levers: ctx => ({ exclude: historyFromRecords(ctx.world.records, ctx.now).busy }) },
  { name: "COMBO G (D + history)", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { history: true, dropSkipped: true, growthAsHobby: true }, rescore: COMBO_D_RESCORE, levers: ctx => ({ exclude: historyFromRecords(ctx.world.records, ctx.now).busy }) },
  { name: "COMBO H (G + groups/events)", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { history: true, dropSkipped: true, growthAsHobby: true, shareInterests: true, events: 6 }, rescore: (w, x) => retune(s => s.c.generator === "event_anchor" || s.c.generator === "group_composer", 0.4)(w, COMBO_D_RESCORE(w, x)), levers: ctx => ({ exclude: historyFromRecords(ctx.world.records, ctx.now).busy }) },
  { name: "DIVERSITY COMBO: debt 0.15 carried + MMR 0.05 + bridge 0.03", aug: { carryDebt: true }, cfg: { selection: { exposureDebtWeight: 0.15 } }, levers: () => ({ mmr: 0.05, bridgeBonus: 0.03 }) },
];

function lastCategory(ctx: SimHookCtx): Map<MemberId, string> {
  const m = new Map<MemberId, string>();
  for (const r of ctx.world.records as any[]) if (r.type === "proposal") for (const id of r.proposal.participants) m.set(id, r.proposal.category ?? "");
  return m;
}

async function measure(l: Lever, gen: Record<string, unknown> = {}) {
  const per: any[] = [];
  for (const seed of SEEDS) {
    const res = await runSim({
      seed, cfg: l.cfg, gen, keepTraces: false,
      augment: l.aug ? (s: EngineInput, ctx) => augment(s, ctx, l.aug!) : undefined,
      hooks: (ctx): Hooks => ({ ...(l.levers ? { levers: l.levers(ctx) } : {}), ...(l.rescore ? { rescore: l.rescore } : {}) }),
    });
    const ps = res.personas;
    const byId = new Map(ps.map(p => [p.id, p]));
    const eligible = ps.filter(p => p.hidden.trueAge >= 18 && p.public.claimedAge >= 18 && !p.hidden.adversarial).map(p => p.id);
    const comm = components(ps);
    const ic = new Map(ps.map(p => [p.id, interestCommunity(p)]));
    const friends = new Map<MemberId, Set<MemberId>>(ps.map(p => [p.id, new Set(p.relationships.filter(r => r.type !== "ex").map(r => r.to))]));
    for (const p of ps) for (const r of p.relationships) if (r.type !== "ex") friends.get(r.to)?.add(p.id);
    const outs = outcomes(res.records);
    const pairsP = outs.filter(o => o.participants.length === 2);
    const sentP = pairsP.filter(o => o.dispatched);
    const exp = new Map<MemberId, number>(eligible.map(id => [id, 0]));
    for (const o of outs) for (const id of o.participants) if (exp.has(id)) exp.set(id, exp.get(id)! + 1);
    const counts = [...exp.values()];
    const pairCount = new Map<string, number>();
    // Repeats are counted over proposals the network actually sent (dispatched), in time order.
    const declinedBefore = new Set<string>();
    let metWorthAfterDecline = 0, reaskDeclined = 0;
    for (const o of [...pairsP].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!o.dispatched) continue;
      const k = pairKey(o.participants[0]!, o.participants[1]!);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      if (declinedBefore.has(k)) { reaskDeclined++; if (o.held && o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5)) metWorthAfterDecline++; }
      if (o.declined.length) declinedBefore.add(k);
    }
    const latent = ((res.records.find((r: any) => r.type === "latent_opportunities") as any)?.pairs ?? []) as { a: MemberId; b: MemberId }[];
    const bridgeI = (a: MemberId, b: MemberId) => ic.get(a) !== ic.get(b);
    const bridgeS = (a: MemberId, b: MemberId) => comm.get(a) !== comm.get(b);
    const closure = (a: MemberId, b: MemberId) => [...(friends.get(a) ?? [])].some(x => friends.get(b)?.has(x));
    const ageGap = (a: MemberId, b: MemberId) => Math.abs(byId.get(a)!.hidden.trueAge - byId.get(b)!.hidden.trueAge);
    const sameHood = (a: MemberId, b: MemberId) => byId.get(a)!.routine.homeArea === byId.get(b)!.routine.homeArea;
    const ab = (o: { participants: MemberId[] }) => [o.participants[0]!, o.participants[1]!] as const;
    // profile-size quartile ("richness" proxy in the full-profile sim) or the hidden tier when present
    const size = (p: Persona) => p.public.statedInterests.length + p.public.statedSkills.length + p.public.statedIntents.length;
    const sizes = eligible.map(id => size(byId.get(id)!)).sort((a, b) => a - b);
    const q = (p: Persona) => (p.hidden.richness ? p.hidden.richness : size(p) <= sizes[Math.floor(sizes.length / 3)]! ? "small profile" : size(p) >= sizes[Math.floor((2 * sizes.length) / 3)]! ? "large profile" : "mid profile");
    const tierExp: Record<string, number[]> = {};
    for (const id of eligible) (tierExp[q(byId.get(id)!)] ??= []).push(exp.get(id)!);
    // rich-get-richer over time: exposure in days 0-10 vs days 11-30 (Spearman-ish via ranks)
    const early = new Map<MemberId, number>(), late = new Map<MemberId, number>();
    for (const o of outs) for (const id of o.participants) { const d = (o.createdAt - res.start) / 86_400_000; (d < 10 ? early : late).set(id, ((d < 10 ? early : late).get(id) ?? 0) + 1); }
    const e1 = eligible.map(id => early.get(id) ?? 0), e2 = eligible.map(id => late.get(id) ?? 0);
    const met = outs.filter(o => o.held);
    per.push({
      precision: res.metrics.proposals.precision, worthwhile: res.metrics.experience.worthwhileRate, recall: res.metrics.proposals.recallPairs,
      metWorth: met.filter(o => o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5)).length, proposals: outs.length,
      gini: gini(counts), zero: counts.filter(c => c === 0).length / counts.length, top10: [...counts].sort((a, b) => b - a).slice(0, Math.ceil(counts.length / 10)).reduce((s, x) => s + x, 0) / Math.max(1, counts.reduce((s, x) => s + x, 0)),
      maxPer: Math.max(...counts),
      genShare: Object.fromEntries(Object.entries(countBy2(outs.map(o => o.generator))).map(([k, v]) => [k, v / outs.length])),
      catEntropy: entropy(Object.values(countBy2(outs.map(o => o.category)))), cats: countBy2(outs.map(o => o.category)),
      bridgeI: mean(pairsP.map(o => (bridgeI(...ab(o)) ? 1 : 0))), bridgeS: mean(pairsP.map(o => (bridgeS(...ab(o)) ? 1 : 0))),
      latentBridgeI: mean(latent.map(l => (bridgeI(l.a, l.b) ? 1 : 0))), latentBridgeS: mean(latent.map(l => (bridgeS(l.a, l.b) ? 1 : 0))),
      closure: mean(pairsP.map(o => (closure(...ab(o)) ? 1 : 0))), latentClosure: mean(latent.map(l => (closure(l.a, l.b) ? 1 : 0))),
      ageGap: mean(pairsP.map(o => ageGap(...ab(o)))), latentAgeGap: mean(latent.map(l => ageGap(l.a, l.b))),
      sameHood: mean(pairsP.map(o => (sameHood(...ab(o)) ? 1 : 0))), latentSameHood: mean(latent.map(l => (sameHood(l.a, l.b) ? 1 : 0))),
      xGender: mean(pairsP.filter(o => o.category !== "romance").map(o => (byId.get(o.participants[0]!)!.gender !== byId.get(o.participants[1]!)!.gender ? 1 : 0))),
      reaskDeclined, metWorthAfterDecline,
      repeatPairs: [...pairCount.values()].filter(c => c > 1).length, repeatShare: [...pairCount.values()].reduce((s, c) => s + (c - 1), 0) / Math.max(1, sentP.length),
      repeatPrecision: mean(sentP.filter(o => (pairCount.get(pairKey(...ab(o))) ?? 0) > 1).map(o => (o.compatible ? 1 : 0))),
      tierExp: Object.fromEntries(Object.entries(tierExp).map(([k, v]) => [k, [mean(v), v.filter(x => x === 0).length / v.length]])),
      earlyLate: spearman(e1, e2),
      explorePrec: mean(outs.filter(o => o.exploration).map(o => (o.compatible ? 1 : 0))), exploreN: outs.filter(o => o.exploration).length,
      exploreBridge: mean(pairsP.filter(o => o.exploration).map(o => (bridgeI(...ab(o)) ? 1 : 0))),
    });
  }
  return per;
}

function countBy2(xs: string[]) { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return m; }
function ranks(xs: number[]) { const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++; for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2; i = j + 1; } return r as number[]; }
function spearman(a: number[], b: number[]) { const ra = ranks(a), rb = ranks(b); const ma = mean(ra), mb = mean(rb); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; } return n / Math.sqrt(da * db); }

const avg = (per: any[], k: string) => mean(per.map(p => p[k]));

const only = args.only ? new RegExp(args.only, "i") : undefined;
const results: [Lever, any[]][] = [];
for (const l of LEVERS) {
  if (only && !only.test(l.name)) continue;
  results.push([l, await measure(l)]);
  process.stderr.write(`${l.name} done\n`);
}
const base = results.find(([l]) => l.name === "baseline")?.[1];
if (base) {
  const out: string[] = ["## Current state (baseline, sim seeds " + SEEDS.join(",") + ")"];
  out.push(table(["metric", "engine proposals", "oracle-good (latent) pairs"], [
    ["exposure Gini (adult members)", avg(base, "gini").toFixed(3), ""],
    ["members with no proposal", pct(avg(base, "zero")), ""],
    ["top-10% members' share of proposals", pct(avg(base, "top10")), ""],
    ["max proposals for one member (30 days)", avg(base, "maxPer").toFixed(1), ""],
    ["category entropy (bits)", avg(base, "catEntropy").toFixed(2), ""],
    ["interest-community bridging", pct(avg(base, "bridgeI")), pct(avg(base, "latentBridgeI"))],
    ["social-community bridging", pct(avg(base, "bridgeS")), pct(avg(base, "latentBridgeS"))],
    ["triadic closure (already share a friend)", pct(avg(base, "closure")), pct(avg(base, "latentClosure"))],
    ["mean age gap (years)", avg(base, "ageGap").toFixed(1), avg(base, "latentAgeGap").toFixed(1)],
    ["same home neighborhood", pct(avg(base, "sameHood")), pct(avg(base, "latentSameHood"))],
    ["cross-gender (non-romance pairs)", pct(avg(base, "xGender")), ""],
    ["repeat pairs per seed (proposed 2+ times)", avg(base, "repeatPairs").toFixed(1), ""],
    ["share of pair proposals that repeat an earlier pair", pct(avg(base, "repeatShare")), ""],
    ["precision of repeated pairs", pct(avg(base, "repeatPrecision")), ""],
    ["sent proposals re-asking a pair that declined before (per seed)", avg(base, "reaskDeclined").toFixed(1), ""],
    ["met+worthwhile meetings that came from such re-asks (per seed)", avg(base, "metWorthAfterDecline").toFixed(1), ""],
    ["exploration picks per seed / precision / bridging", `${avg(base, "exploreN").toFixed(1)} / ${pct(avg(base, "explorePrec"))} / ${pct(avg(base, "exploreBridge"))}`, ""],
    ["Spearman(proposals days 0-10, days 10-30)", avg(base, "earlyLate").toFixed(2), ""],
  ]));
  const gens = [...new Set(base.flatMap(p => Object.keys(p.genShare)))];
  out.push("\nGenerator share of proposals: " + gens.map(g => `${g} ${pct(mean(base.map(p => p.genShare[g] ?? 0)))}`).join(", "));
  const cats = [...new Set(base.flatMap(p => Object.keys(p.cats)))];
  out.push("\nCategory mix (per seed): " + cats.map(c => `${c} ${mean(base.map(p => p.cats[c] ?? 0)).toFixed(1)}`).join(", "));
  const tiers = [...new Set(base.flatMap(p => Object.keys(p.tierExp)))];
  out.push("\nExposure by profile size (tercile of stated interests+skills+intents): " + tiers.map(t => `${t}: ${mean(base.map(p => p.tierExp[t]?.[0] ?? NaN)).toFixed(2)} proposals/member, ${pct(mean(base.map(p => p.tierExp[t]?.[1] ?? NaN)))} with none`).join("; "));
  console.log(out.join("\n"));
}
const rows = results.map(([l, per]) => [l.name, avg(per, "proposals").toFixed(0), pct(avg(per, "precision")), pct(avg(per, "worthwhile")), pct(avg(per, "recall")), avg(per, "metWorth").toFixed(1),
  avg(per, "gini").toFixed(3), pct(avg(per, "zero")), pct(avg(per, "bridgeI")), pct(avg(per, "bridgeS")), pct(avg(per, "closure")), avg(per, "catEntropy").toFixed(2), avg(per, "repeatPairs").toFixed(1), avg(per, "reaskDeclined").toFixed(1), avg(per, "metWorthAfterDecline").toFixed(1),
  (() => { const t = per[0].tierExp; const ks = Object.keys(t); const lo = ks.find(k => k.startsWith("small")) ?? ks[0]!, hi = ks.find(k => k.startsWith("large")) ?? ks[ks.length - 1]!; return (mean(per.map(p => p.tierExp[hi]?.[0])) / mean(per.map(p => p.tierExp[lo]?.[0]))).toFixed(2); })()]);
console.log("\n## Diversity levers (sim seeds " + SEEDS.join(",") + ")\n\n" + table(["lever", "proposals/seed", "precision", "persona worthwhile", "pair recall", "met+worthwhile/seed", "Gini", "no proposal", "interest bridging", "social bridging", "closure", "category entropy", "repeat pairs/seed (sent)", "re-asks after decline/seed", "met+worthwhile from re-asks/seed", "large/small profile exposure"], rows));
