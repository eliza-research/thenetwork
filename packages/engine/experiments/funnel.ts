// Q1: why are matches failing? A pair-level funnel from oracle-good pairs to worthwhile meetings,
// and a proposal-level funnel from proposals to worthwhile meetings, on sim seeds 1-3 (30 days,
// 150 personas, stub network, no LLM) and on the synthetic snapshot (one engine tick).
//
//   bun packages/engine/experiments/funnel.ts            # sim seeds 1-3 + sim with richness tiers + synthetic
//   bun packages/engine/experiments/funnel.ts --only sim  # or synthetic
//
// Stages (pair level; a pair "reaches" a stage if ANY candidate containing both members does, in
// any nightly run):
//   S0 oracle-good (latent pair: same city, strangers, adults, compatible at run end)
//   S1 generated (some generator surfaced a candidate with both)
//   S2 passed hard filters        S3 survived dedupe + floors     S4 above threshold (eligible)
//   S5 selected (proposal)        S6 dispatched (not skipped: busy) S7 both accepted
//   S8 meeting held, both showed  S9 worthwhile (both enjoyment >= 0.5 at the meeting)
// Synthetic (one tick): S6+ are expectations from the oracle (P(both accept), P(both show)).
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { memberReason, pairReason } from "../src/filters.ts";
import { intentFormat } from "../src/generators.ts";
import { eligibleMembers, retrieveForIntent, twoHop } from "../src/retrieval.ts";
import { complementarity } from "../src/complementarity.ts";
import { cosine } from "../src/embed.ts";
import { World } from "../src/world.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { DEFAULT_START } from "../../sim/src/world.ts";
import type { EngineInput } from "../src/types.ts";
import { desireById } from "../../sim/src/taxonomy.ts";
import { Oracle } from "../../sim/src/oracle.ts";
import { loadPersonas, loadSnapshot } from "../../../scripts/synthetic/load.ts";
import {
  countBy, mean, outcomes, pairKey, pairTruth, pct, runSim, satisfactionKind, table, tracedEngine, type TraceRow,
} from "./lib.ts";

const args = parseArgs({ options: { only: { type: "string" }, seeds: { type: "string", default: "1,2,3" } } }).values;
const SEEDS = args.seeds!.split(",").map(Number);
const STAGES = ["S0 good", "S1 generated", "S2 hard filters", "S3 dedupe+floors", "S4 above thr", "S5 selected", "S6 dispatched", "S7 both accept", "S8 met", "S9 worthwhile"];

function rowStage(r: TraceRow): number {
  if (r.selected) return 5;
  if (r.eligible) return 4;
  if (r.filter) return 1;
  if (r.deduped) return 2;
  if (r.reason && r.reason !== "below_threshold") return 2;
  return 3; // passed filters + floors, below threshold
}

interface PairRec {
  a: MemberId; b: MemberId; city: string; stage: number; gen?: string; sysGood: boolean; kind: string; cat: string; tier: string;
  lossReason?: string; bestRow?: TraceRow;
}

const FUNNEL_LOSS: Record<number, string> = {};

/** Diagnose a never-generated pair on one engine world (the day-7 snapshot of its city). */
function diagnose(w: World, a: MemberId, b: MemberId, unavailFrac: Map<MemberId, number>): string {
  if (!w.get(a) || !w.get(b)) return "not_joined";
  if ((unavailFrac.get(a) ?? 0) >= 0.5 || (unavailFrac.get(b) ?? 0) >= 0.5) return "member_unavailable";
  if (!w.canMeet([a, b])) return "presence";
  const intentCats = ["social", "professional", "hobby", "events"];
  const ia = w.get(a)!.intents, ib = w.get(b)!.intents;
  const routesA = ia.filter(i => intentCats.includes(i.category)), routesB = ib.filter(i => intentCats.includes(i.category));
  if (!ia.length && !ib.length) return "no_live_intent";
  const cfg = w.cfg;
  const ctx = { w, memberExclusions: {} as Record<string, number> };
  let best = 0, inSim = false, rankCut = false;
  const tryI2C = (seeker: MemberId, other: MemberId, intent: any) => {
    const pr = pairReason(w, seeker, other, intent.category);
    if (pr) return;
    const s = w.intentFit(intent, w.get(other)!, "caps").sim;
    best = Math.max(best, s);
    if (s < cfg.retrieval.minSim) return;
    inSim = true;
    const pool = eligibleMembers(ctx, intent.category, "provider", "one_to_one", false, new Set([seeker])).filter(id => w.canMeet([seeker, id]) && !pairReason(w, seeker, id, intent.category));
    const got = retrieveForIntent(ctx, intent, pool, "caps", cfg.retrieval.minSim);
    const rank = got.findIndex(r => r.id === other);
    if (rank >= cfg.maxPerIntent || rank < 0) rankCut = true;
  };
  for (const i of routesA) tryI2C(a, b, i);
  for (const i of routesB) tryI2C(b, a, i);
  // complementary / pooling routes
  for (const i of routesA) for (const j of routesB) {
    if (i.category !== j.category) continue;
    const fab = w.intentFit(i, w.get(b)!, "match").sim, fba = w.intentFit(j, w.get(a)!, "match").sim;
    best = Math.max(best, Math.min(fab, fba));
    if (fab >= cfg.retrieval.minSim && fba >= cfg.retrieval.minSim) inSim = true;
    const pool = cosine(w.intentEmb.get(i.id)!, w.intentEmb.get(j.id)!);
    if (pool >= cfg.retrieval.poolSim) { inSim = true; rankCut = true; }
  }
  const romanceA = ia.some(i => i.category === "romance"), romanceB = ib.some(i => i.category === "romance");
  if (!routesA.length && !routesB.length) {
    if (romanceA || romanceB) return pairReason(w, a, b, "romance") ? "romance_filtered" : "romance_rank_or_sim";
    return "only_help_or_romance_intents";
  }
  const comp = complementarity(w, [a, b]);
  if (!inSim) return comp && comp.pair >= 0.45 ? "below_minSim_structured_visible" : "below_minSim_no_signal";
  if (rankCut) return "rank_cut_maxPerIntent";
  return "other";
}

function pairFunnelTable(pairs: PairRec[], label: string, keyOf: (p: PairRec) => string) {
  const groups = new Map<string, PairRec[]>();
  for (const p of pairs) { const k = keyOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); }
  const rows = [...groups.entries()].sort((x, y) => y[1].length - x[1].length).map(([k, ps]) => {
    const cum = (s: number) => ps.filter(p => p.stage >= s).length;
    return [k, ps.length, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => `${cum(s)} (${pct(cum(s) / ps.length, 0)})`)];
  });
  return `**${label}**\n\n` + table(["group", "S0 good", ...STAGES.slice(1)], rows);
}

// ------------------------------------------------------------------------------------------
async function simFunnel(gen: Record<string, unknown>, label: string) {
  const all: PairRec[] = [];
  const props: ReturnType<typeof outcomes> = [];
  const filterCounts: Record<string, number> = {}, scoreReasons: Record<string, number> = {};
  const genStats: Record<string, { gen: number; passed: number; eligible: number; selected: number }> = {};
  const memberUnavail: Record<string, number> = {};
  for (const seed of SEEDS) {
    const snaps = new Map<string, EngineInput>();
    const unavail = new Map<MemberId, number>(), runsSeen = new Map<MemberId, number>();
    const res = await runSim({
      seed, gen,
      onRun: (r, ctx, input) => {
        for (const id of r.world.ids) {
          const mi = r.world.get(id)!;
          if (mi.m.homeCity !== ctx.city) continue;
          runsSeen.set(id, (runsSeen.get(id) ?? 0) + 1);
          const why = memberReason(r.world, id, { category: "social", role: "peer", format: "one_to_one", timeSensitive: false });
          if (why) { unavail.set(id, (unavail.get(id) ?? 0) + 1); memberUnavail[why] = (memberUnavail[why] ?? 0) + 1; }
        }
        const d = (ctx.now - DEFAULT_START) / DAY;
        if (!snaps.has(ctx.city) && d >= 7) snaps.set(ctx.city, input);
      },
    });
    const frac = new Map([...runsSeen].map(([id, n]) => [id, (unavail.get(id) ?? 0) / n]));
    const latentRec = res.records.find((r: any) => r.type === "latent_opportunities") as any;
    const latent: { a: MemberId; b: MemberId }[] = latentRec.pairs;
    const pc = new Map<string, { stage: number; row?: TraceRow }>();
    for (const run of res.runs) for (const r of run.trace) {
      genStats[r.generator] ??= { gen: 0, passed: 0, eligible: 0, selected: 0 };
      const g = genStats[r.generator]!;
      g.gen++; if (!r.filter) g.passed++; if (r.eligible) g.eligible++; if (r.selected) g.selected++;
      if (r.filter) filterCounts[r.filter] = (filterCounts[r.filter] ?? 0) + 1;
      else if (r.deduped) scoreReasons.deduped = (scoreReasons.deduped ?? 0) + 1;
      else scoreReasons[r.reason ?? "eligible"] = (scoreReasons[r.reason ?? "eligible"] ?? 0) + 1;
      const st = rowStage(r);
      const ps = r.participants;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const k = pairKey(ps[i]!, ps[j]!);
        const cur = pc.get(k);
        if (!cur || st > cur.stage) pc.set(k, { stage: st, row: r });
      }
    }
    const outs = outcomes(res.records);
    props.push(...outs);
    const pOut = new Map<string, number>();
    for (const o of outs) {
      const ps = o.participants;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!, b = ps[j]!;
        let s = 5;
        if (o.dispatched) s = 6;
        if (o.accepted.includes(a) && o.accepted.includes(b)) s = 7;
        if (o.held && o.showed.includes(a) && o.showed.includes(b)) s = 8;
        if (s === 8 && (o.enjoyment[a] ?? 0) >= 0.5 && (o.enjoyment[b] ?? 0) >= 0.5) s = 9;
        const k = pairKey(a, b);
        pOut.set(k, Math.max(pOut.get(k) ?? 0, s));
      }
    }
    const tier = (id: MemberId) => res.oracle.persona(id)?.hidden.richness ?? "full";
    const tierRank = ["minimal", "light", "medium", "rich", "very_rich", "full"];
    const worlds = new Map([...snaps].map(([c, inp]) => [c, new World(inp, resolveConfig({ seed: 1, cities: [c as any] }), localEmbed)]));
    for (const l of latent) {
      const k = pairKey(l.a, l.b);
      const p = res.oracle.persona(l.a)!;
      const t = pairTruth(res.oracle, seed, l.a, l.b, p.homeCity, res.end);
      const kind = satisfactionKind(res.oracle, l.a, l.b, desireById as any);
      const kindB = satisfactionKind(res.oracle, l.b, l.a, desireById as any);
      const order = ["skill", "romance", "pool", "interest", "none"];
      const best = order[Math.min(order.indexOf(kind), order.indexOf(kindB))]!;
      const desCats = [...new Set([...p.hidden.desires, ...res.oracle.persona(l.b)!.hidden.desires].map(d => d.category))];
      const stage = Math.max(pc.get(k)?.stage ?? 0, pOut.get(k) ?? 0);
      const ta = tier(l.a), tb = tier(l.b);
      const rec: PairRec = {
        a: l.a, b: l.b, city: p.homeCity, stage, gen: pc.get(k)?.row?.generator, sysGood: t.sysGood, kind: best,
        cat: desCats.sort().join("+"), tier: tierRank.indexOf(ta) < tierRank.indexOf(tb) ? ta : tb, bestRow: pc.get(k)?.row,
      };
      if (stage === 0) {
        const w = worlds.get(p.homeCity);
        rec.lossReason = w ? diagnose(w, l.a, l.b, frac) : "no_snapshot";
      } else if (stage < 5) {
        const r = pc.get(k)!.row!;
        rec.lossReason = r.filter ? `filter:${r.filter}` : r.deduped ? "deduped" : r.reason ?? "budget_or_selection";
      }
      all.push(rec);
    }
  }
  const out: string[] = [`## ${label}`];
  const n = all.length;
  const cum = (s: number, ps = all) => ps.filter(p => p.stage >= s).length;
  out.push(table(["stage", "pairs reaching", "share of good", "loss vs previous"], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => [STAGES[s]!, cum(s), pct(cum(s) / n), s ? pct(1 - cum(s) / Math.max(1, cum(s - 1))) : ""])));
  const sys = all.filter(p => p.sysGood);
  out.push(`\nSystematically good (good without the chemistry draw): ${sys.length}/${n} (${pct(sys.length / n)}). Their funnel: ` + [1, 5, 7, 9].map(s => `${STAGES[s]} ${pct(cum(s, sys) / sys.length)}`).join(", "));
  out.push(`Chemistry-only good: ${n - sys.length}; generated ${pct(cum(1, all.filter(p => !p.sysGood)) / Math.max(1, n - sys.length))}, selected ${pct(cum(5, all.filter(p => !p.sysGood)) / Math.max(1, n - sys.length))}.`);
  out.push("\n" + pairFunnelTable(all, "By city", p => p.city));
  out.push("\n" + pairFunnelTable(all, "By what makes the pair good (best side: skill > romance > pool > interest > none)", p => p.kind));
  out.push("\n" + pairFunnelTable(all, "By richness tier (lower tier of the two)", p => p.tier));
  out.push("\n" + pairFunnelTable(all.filter(p => p.stage >= 1), "Generated pairs, by generator of the furthest-reaching candidate", p => p.gen ?? "?"));
  // loss reasons
  const lossAt = (s: number) => countBy(all.filter(p => p.stage === s), p => p.lossReason ?? "?");
  out.push("\n**Never generated (S0): diagnosis on the day-7 snapshot**\n\n" + table(["reason", "pairs", "share of S0 losses"], Object.entries(lossAt(0)).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v / Math.max(1, all.filter(p => p.stage === 0).length))])));
  out.push("\n**Generated but stopped before selection (S1-S4): furthest candidate's reason**\n\n" + table(["reason", "pairs"], Object.entries({ ...lossAt(1), ...Object.fromEntries(Object.entries(lossAt(2)).map(([k, v]) => [`${k} (S2)`, v])), ...Object.fromEntries(Object.entries(lossAt(3)).map(([k, v]) => [`${k} (S3)`, v])), ...Object.fromEntries(Object.entries(lossAt(4)).map(([k, v]) => [`eligible, not selected (S4)`, v])) }).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  // candidate-level
  out.push("\n**Candidate-level hard-filter rejections (all candidates, all runs)**\n\n" + table(["filter", "candidates"], Object.entries(filterCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  out.push("\n**Candidates that passed the filters: scoring outcome**\n\n" + table(["outcome", "candidates"], Object.entries(scoreReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  out.push("\n**Member-level unavailability (generic social check, member-runs)**\n\n" + table(["reason", "member-runs"], Object.entries(memberUnavail).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  out.push("\n**Generators: candidate funnel**\n\n" + table(["generator", "generated", "passed filters", "eligible", "selected"], Object.entries(genStats).sort((a, b) => b[1].gen - a[1].gen).map(([g, s]) => [g, s.gen, s.passed, s.eligible, s.selected])));
  // proposal-level funnel
  out.push("\n" + proposalFunnel(props));
  return out.join("\n");
}

function proposalFunnel(props: ReturnType<typeof outcomes>) {
  const rows = (ps: typeof props, k: string) => {
    const pairsOnly = ps;
    const both = (o: typeof props[0]) => o.participants.length === 2 ? o.accepted.length >= 2 : o.accepted.length >= 3;
    const met = (o: typeof props[0]) => o.held;
    const wort = (o: typeof props[0]) => o.held && o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5);
    const n = pairsOnly.length;
    const pAcc = mean(pairsOnly.flatMap(o => Object.values(o.acceptProb)));
    return [k, n, pct(mean(ps.map(o => (o.compatible ? 1 : 0)))), pct(ps.filter(o => o.dispatched).length / n), pct(ps.filter(both).length / n), pct(ps.filter(met).length / n), pct(ps.filter(wort).length / n),
      pct(mean(ps.flatMap(o => Object.values(o.worthwhile).map(x => (x ? 1 : 0))))), Number.isFinite(pAcc) ? pAcc.toFixed(2) : ""];
  };
  const by = (f: (o: typeof props[0]) => string) => {
    const g = new Map<string, typeof props>();
    for (const o of props) { const k = f(o); if (!g.has(k)) g.set(k, []); g.get(k)!.push(o); }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => rows(v, k));
  };
  const hdr = ["group", "proposals", "oracle precision", "dispatched", "all accepted", "met", "met + worthwhile", "persona worthwhile", ""];
  return "**Proposal-level funnel (sim records)**\n\n" + table(hdr, [rows(props, "all"), ...by(o => `gen:${o.generator}`), ...by(o => `cat:${o.category}`), ...by(o => `city:${o.city}`), ...by(o => (o.participants.length > 2 ? "group" : "pair"))]);
}

// ------------------------------------------------------------------------------------------
async function synthFunnel() {
  const snap = await loadSnapshot();
  const personas = await loadPersonas();
  const oracle = new Oracle(personas, 1, snap.now);
  const res = tracedEngine(snap as any, { seed: 1 });
  const latent = (["sf", "nyc"] as const).flatMap(c => oracle.latentPairs(personas.filter(p => p.homeCity === c).map(p => p.id), snap.now));
  const pc = new Map<string, { stage: number; row: TraceRow }>();
  for (const r of res.trace) {
    const st = rowStage(r);
    const ps = r.participants;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const k = pairKey(ps[i]!, ps[j]!);
      const cur = pc.get(k);
      if (!cur || st > cur.stage) pc.set(k, { stage: st, row: r });
    }
  }
  const tierOf = new Map(personas.map(p => [p.id, p.hidden.richness ?? "none"]));
  const tierRank = ["minimal", "light", "medium", "rich", "very_rich", "none"];
  const unavail = new Map<MemberId, number>(res.world.ids.map(id => [id, memberReason(res.world, id, { category: "social", role: "peer", format: "one_to_one", timeSensitive: false }) ? 1 : 0]));
  // expected downstream for selected pairs (one tick)
  const propByPair = new Map<string, typeof res.proposals[0]>();
  for (const p of res.proposals) for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) propByPair.set(pairKey(p.participants[i]!, p.participants[j]!), p);
  const all: (PairRec & { pAcc?: number; pMet?: number; pWorth?: number })[] = [];
  const reasonsMember: Record<string, number> = {};
  for (const id of res.world.ids) { const r = memberReason(res.world, id, { category: "social", role: "peer", format: "one_to_one", timeSensitive: false }); reasonsMember[r ?? "available"] = (reasonsMember[r ?? "available"] ?? 0) + 1; }
  for (const l of latent) {
    const k = pairKey(l.a, l.b);
    const p = oracle.persona(l.a)!;
    const t = pairTruth(oracle, 1, l.a, l.b, p.homeCity, snap.now);
    const kind = satisfactionKind(oracle, l.a, l.b, desireById as any), kindB = satisfactionKind(oracle, l.b, l.a, desireById as any);
    const order = ["skill", "romance", "pool", "interest", "none"];
    const ta = tierOf.get(l.a)!, tb = tierOf.get(l.b)!;
    const rec: any = { a: l.a, b: l.b, city: p.homeCity, stage: pc.get(k)?.stage ?? 0, gen: pc.get(k)?.row.generator, sysGood: t.sysGood, kind: order[Math.min(order.indexOf(kind), order.indexOf(kindB))], cat: "", tier: tierRank.indexOf(ta) < tierRank.indexOf(tb) ? ta : tb };
    const prop = propByPair.get(k);
    if (prop) {
      const v = oracle.evaluate({ id: prop.id, kind: prop.kind, participants: prop.participants, city: prop.city, window: prop.window, category: prop.category, objective: prop.objective });
      const pa = Object.values(v.participants).reduce((s, x) => s * x.acceptProb, 1);
      const ps = Object.values(v.participants).reduce((s, x) => s * x.showProb, 1);
      rec.pAcc = pa; rec.pMet = pa * ps; rec.pWorth = rec.pMet * (Object.values(v.participants).every(x => x.enjoyment >= 0.5) ? 1 : 0);
    }
    if (rec.stage === 0) rec.lossReason = diagnose(res.world, l.a, l.b, unavail);
    else if (rec.stage < 5) { const r = pc.get(k)!.row; rec.lossReason = r.filter ? `filter:${r.filter}` : r.deduped ? "deduped" : r.reason ?? "budget_or_selection"; }
    all.push(rec);
  }
  const n = all.length;
  const cum = (s: number, ps = all) => ps.filter(p => p.stage >= s).length;
  const exp = (f: "pAcc" | "pMet" | "pWorth", ps = all) => ps.reduce((s, p) => s + ((p as any)[f] ?? 0), 0);
  const out: string[] = ["## Synthetic snapshot (data/synthetic/v1, one tick, seed 1)"];
  out.push(table(["stage", "pairs reaching", "share of good", "loss vs previous"], [
    ...[0, 1, 2, 3, 4, 5].map(s => [STAGES[s]!, cum(s), pct(cum(s) / n, 2), s ? pct(1 - cum(s) / Math.max(1, cum(s - 1))) : ""]),
    ["S7 both accept (expected)", exp("pAcc").toFixed(1), pct(exp("pAcc") / n, 2), pct(1 - exp("pAcc") / Math.max(1, cum(5)))],
    ["S8 met (expected)", exp("pMet").toFixed(1), pct(exp("pMet") / n, 2), pct(1 - exp("pMet") / Math.max(1e-9, exp("pAcc")))],
    ["S9 worthwhile (expected)", exp("pWorth").toFixed(1), pct(exp("pWorth") / n, 2), pct(1 - exp("pWorth") / Math.max(1e-9, exp("pMet")))],
  ]));
  const sys = all.filter(p => p.sysGood);
  out.push(`\nSystematically good: ${sys.length}/${n} (${pct(sys.length / n)}); generated ${pct(cum(1, sys) / sys.length)}, selected ${pct(cum(5, sys) / sys.length, 2)}.`);
  out.push("\n" + pairFunnelTable(all, "By richness tier (lower tier of the two)", p => p.tier).replace(/S6 dispatched.*$/m, m => m));
  out.push("\n" + pairFunnelTable(all, "By city", p => p.city));
  out.push("\n" + pairFunnelTable(all, "By what makes the pair good", p => p.kind));
  const lossAt = (s: number) => countBy(all.filter(p => p.stage === s), p => p.lossReason ?? "?");
  out.push("\n**Never generated (S0): diagnosis**\n\n" + table(["reason", "pairs", "share"], Object.entries(lossAt(0)).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v / Math.max(1, all.filter(p => p.stage === 0).length))])));
  out.push("\n**Never generated, by richness tier x reason**\n\n" + (() => {
    const reasons = Object.keys(lossAt(0));
    const rows = tierRank.slice(0, 5).map(t => [t, ...reasons.map(r => all.filter(p => p.stage === 0 && p.tier === t && p.lossReason === r).length)]);
    return table(["tier", ...reasons], rows);
  })());
  out.push("\n**Generated, lost before selection**\n\n" + table(["reason", "pairs"], Object.entries({ ...lossAt(1), ...lossAt(2), ...lossAt(3), ...Object.fromEntries(Object.entries(lossAt(4)).map(([, v]) => ["eligible, not selected", v])) }).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  out.push("\n**Members, generic availability**\n\n" + table(["reason", "members"], Object.entries(reasonsMember).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  return out.join("\n");
}

if (args.only !== "synthetic") {
  console.log(await simFunnel({}, "Simulator, seeds " + SEEDS.join(",") + " (150 personas, 30 days, full public profile)"));
  console.log("\n" + await simFunnel({ richness: true }, "Simulator with richness tiers (generator richness: true), seeds " + SEEDS.join(",")));
}
if (args.only !== "sim") console.log("\n" + await synthFunnel());
void FUNNEL_LOSS; void twoHop; void intentFormat;
