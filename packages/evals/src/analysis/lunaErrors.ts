// Offline error analysis for the judgment-passes run (docs/results/2026-10-06-luna-error-analysis.md).
// Makes NO model calls: it rebuilds the richness-tier recommender dataset deterministically, then
// decomposes every item's oracle label into its systematic part and the pair-chemistry noise, and
// re-scores the same oracle formula on (a) what the Network could see, (b) the same view without
// stale / wrong-inference source facts, and (c) the member's full public profile (what a fully
// onboarded member would have said). Output: one JSON line per item for the hand analysis.
//
//   bun run packages/evals/src/analysis/lunaErrors.ts [items.jsonl] [out.jsonl]
import { readFileSync, writeFileSync } from "node:fs";
import { buildRecDataset } from "../recDataset.ts";
import { Rng, hash32 } from "../../../sim/src/rng.ts";
import { desireById, INTERESTS, SKILLS } from "../../../sim/src/taxonomy.ts";
import { PAIR_CHEMISTRY_SD } from "../../../sim/src/oracle.ts";
import type { Persona } from "../../../sim/src/persona.ts";

const itemsPath = process.argv[2] ?? "runs/evals/results/passes-gpt-6-luna.items.jsonl";
const outPath = process.argv[3] ?? "runs/evals/results/luna-error-analysis.features.jsonl";
const GOOD_PAIR = 0.55, GOOD_GROUP_MEAN = 0.55, GOOD_GROUP_MIN = 0.4;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The trait bundle the oracle's systematic enjoyment reads (hidden truth, or a proxy view of it). */
interface View {
  id: string; gender: Persona["gender"]; age: number;
  interests: string[]; skills: string[]; desires: { id: string; strength: number }[];
  boundaries: string[]; socialEnergy: number; openness: number; capacity: number; preferredGroupSize: number;
  romance: Persona["hidden"]["romance"]; adversarial?: string; relationships: Persona["relationships"]; homeArea: string;
}
const truthView = (p: Persona): View => ({
  id: p.id, gender: p.gender, age: p.hidden.trueAge, interests: p.hidden.interests, skills: p.hidden.skills,
  desires: p.hidden.desires.map(d => ({ id: d.id, strength: d.strength })), boundaries: p.hidden.boundaries,
  socialEnergy: p.hidden.socialEnergy, openness: p.hidden.openness, capacity: p.hidden.capacity,
  preferredGroupSize: p.hidden.preferredGroupSize, romance: p.hidden.romance, adversarial: p.hidden.adversarial,
  relationships: p.relationships, homeArea: p.routine.homeArea,
});
const validI = new Set(INTERESTS.map(i => i.tag)), validS = new Set(SKILLS.map(s => s.tag));
/**
 * What the Network knows, mapped onto oracle traits. Unknown latent traits get population priors
 * (desire strength 0.7 = mean of U(0.4,1); energy / openness / capacity 0.5). Group-size preference is
 * semi-visible through the format preference (one_to_one first <=> preferredGroupSize <= 2).
 * mode: "seen" = chat + every source fact; "clean" = chat + correct source facts only; "full" = whole public profile.
 */
function knownView(p: Persona, mode: "seen" | "clean" | "full"): View {
  const k = p.knowledge;
  let interests: string[], skills: string[], intents: string[], boundaries: string[];
  if (!k || mode === "full") {
    interests = p.public.statedInterests; skills = p.public.statedSkills;
    intents = p.public.statedIntents.map(i => i.desireId); boundaries = p.hidden.boundaries;
  } else {
    const obs = k.observations.filter(o => !o.facet.sensitive && (mode === "seen" || o.truth === "correct"));
    interests = [...new Set([...k.chat.interests, ...obs.filter(o => o.facet.kind === "interest").flatMap(o => o.facet.tags).filter(t => validI.has(t))])];
    skills = [...new Set([...k.chat.skills, ...obs.filter(o => o.facet.kind === "skill").flatMap(o => o.facet.tags).filter(t => validS.has(t))])];
    intents = k.chat.intentMode === "vague" ? [] : k.chat.intents.map(i => p.public.statedIntents[i]?.desireId).filter((x): x is string => !!x);
    // ai_memory goals carry the desire's tags; treat a correct/seen goal facet as a known want.
    for (const o of obs) if (o.facet.kind === "goal") {
      const d = [...desireById.values()].find(d => o.facet.value === `wants to ${d.text}`);
      if (d) intents.push(d.id);
    }
    boundaries = k.chat.boundaries.map(i => p.hidden.boundaries[i]!).filter(Boolean);
  }
  return {
    id: p.id, gender: p.gender, age: p.public.claimedAge, interests, skills,
    desires: [...new Set(intents)].map(id => ({ id, strength: 0.7 })), boundaries,
    socialEnergy: 0.5, openness: 0.5, capacity: 0.5, preferredGroupSize: p.hidden.preferredGroupSize <= 2 ? 2 : 3.5,
    romance: p.hidden.romance, relationships: p.relationships.filter(r => r.type !== "ex"), homeArea: p.routine.homeArea,
  };
}

function romanceOk(a: View, b: View) {
  return a.romance.optIn && a.age >= 18 && b.age >= 18 && a.romance.seeking.includes(b.gender) && b.age >= a.romance.ageRange[0] && b.age <= a.romance.ageRange[1];
}
/** Oracle.pairEnjoyment, returning its parts. */
function pairParts(a: View, b: View, category?: string) {
  const shared = a.interests.filter(t => b.interests.includes(t)).length;
  const overlap = shared / Math.max(1, Math.min(a.interests.length, b.interests.length));
  const rok = romanceOk(a, b) && romanceOk(b, a);
  const satisfies = (x: View, y: View) => {
    let best = 0, why = "";
    for (const d of x.desires) {
      const def = desireById.get(d.id);
      if (!def) continue;
      if (def.category === "romance") { if (rok && d.strength * 0.9 > best) { best = d.strength * 0.9; why = `${d.id}:romance`; } continue; }
      let s = 0, w = "";
      if (def.needsSkills.some(sk => y.skills.includes(sk))) { s = 1; w = "skill"; }
      else if (def.pool && y.desires.some(o => desireById.get(o.id)?.pool === def.pool)) { s = 0.85; w = "pool"; }
      else if (def.needsInterests.some(t => y.interests.includes(t))) { s = 0.45; w = "interest"; }
      if (d.strength * s > best) { best = d.strength * s; why = `${d.id}:${w}`; }
    }
    return { best, why };
  };
  const cA = satisfies(a, b), cB = satisfies(b, a);
  const actor = 0.1 * (a.socialEnergy - 0.5) + 0.08 * (a.openness - 0.5);
  let e = 0.22 + 0.3 * overlap + 0.42 * cA.best + 0.1 * cB.best * a.capacity + actor;
  const pen: string[] = [];
  const rel = a.relationships.find(r => r.to === b.id);
  if (rel?.type === "ex") { e -= 0.6; pen.push("ex"); } else if (rel) e += 0.03;
  if (b.adversarial && ["harasser", "scammer", "spammer", "block_abuser"].includes(b.adversarial)) { e -= b.adversarial === "block_abuser" ? 0.25 : 0.55; pen.push(`adversarial:${b.adversarial}`); }
  if (category === "romance" && !rok) { e -= 0.45; pen.push("romance_mismatch"); }
  if (category === "professional" && a.boundaries.includes("no networking-heavy events")) { e -= 0.12; pen.push("boundary:no_networking"); }
  if (a.boundaries.includes("no romantic setups unless asked") && category === "romance" && !a.desires.some(d => d.id === "dating")) { e -= 0.3; pen.push("boundary:no_romance"); }
  if (Math.abs(a.age - b.age) > 15) { e -= 0.05; pen.push("age_gap"); }
  return { e, overlap, complementA: cA.best, complementAWhy: cA.why, complementB: cB.best, actor, pen };
}

/** Oracle.evaluate's enjoyment model without the accept/show draws; chem optional. */
function score(views: View[], seed: string, category: string | undefined, withChem: boolean) {
  const n = views.length;
  const per = views.map(a => {
    const others = views.filter(o => o.id !== a.id);
    let e = 0, chemSum = 0;
    const parts: ReturnType<typeof pairParts>[] = [];
    for (const b of others) {
      const pp = pairParts(a, b, category);
      parts.push(pp);
      const chem = new Rng(hash32(seed, "chem", ...[a.id, b.id].sort())).normal(0, PAIR_CHEMISTRY_SD);
      e += pp.e + (withChem ? chem : 0); chemSum += chem;
    }
    e = others.length ? e / others.length : 0;
    const sizePen = 0.06 * Math.max(0, n - a.preferredGroupSize) * (1 - a.socialEnergy);
    e -= sizePen;
    let oneOnOne = 0;
    if (n === 2 && a.boundaries.includes("prefers groups over one-on-one with strangers") && !a.relationships.some(r => others.some(o => o.id === r.to))) { e -= 0.15; oneOnOne = 0.15; }
    return {
      id: a.id, e: clamp01(e), chem: others.length ? chemSum / others.length : 0, sizePen, oneOnOne,
      overlap: avg(parts.map(p => p.overlap)), complementA: avg(parts.map(p => p.complementA)), complementB: avg(parts.map(p => p.complementB)),
      why: parts.map(p => p.complementAWhy).filter(Boolean), actor: parts[0]?.actor ?? 0, pen: [...new Set(parts.flatMap(p => p.pen))],
    };
  });
  const es = per.map(p => p.e);
  const quality = avg(es), minE = Math.min(...es);
  const good = n === 2 ? minE >= GOOD_PAIR : quality >= GOOD_GROUP_MEAN && minE >= GOOD_GROUP_MIN;
  return { per, quality, minE, good };
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const ds = await buildRecDataset({ richness: true });
const byItem = new Map(ds.items.map(i => [i.id, i]));
const lines = readFileSync(itemsPath, "utf8").trim().split("\n").map(l => JSON.parse(l));
const out: string[] = [];
let mismatches = 0;
for (const r of lines) {
  const it = byItem.get(r.itemId);
  if (!it) { mismatches++; continue; }
  const w = ds.worlds.get(it.world)!;
  const ids = it.config.participants;
  const refIds = Object.values(r.refs as Record<string, string>);
  const sameSet = ids.every(id => refIds.includes(id));
  if (!sameSet || Math.abs(it.truth.minEnjoyment - r.label.minEnjoyment) > 1e-6) mismatches++;
  const ps = ids.map(id => w.byId.get(id)!);
  const seed = `evals:${w.spec.id}:${w.spec.seed}`;
  const cat = it.config.category;
  const truth = score(ps.map(truthView), seed, cat, true);
  const sys = score(ps.map(truthView), seed, cat, false);
  const seen = score(ps.map(p => knownView(p, "seen")), seed, cat, false);
  const clean = score(ps.map(p => knownView(p, "clean")), seed, cat, false);
  const full = score(ps.map(p => knownView(p, "full")), seed, cat, false);
  const refOf = Object.fromEntries(Object.entries(r.refs as Record<string, string>).map(([k, v]) => [v, k]));
  out.push(JSON.stringify({
    itemId: r.itemId, labelGood: r.label.good, oracleGoodCheck: truth.good, minE: r3(truth.minE), quality: r3(truth.quality),
    sysGood: sys.good, sysMinE: r3(sys.minE), sysQuality: r3(sys.quality),
    seenGood: seen.good, seenMinE: r3(seen.minE), cleanGood: clean.good, cleanMinE: r3(clean.minE), fullGood: full.good, fullMinE: r3(full.minE),
    per: truth.per.map((x, i) => ({
      ref: refOf[x.id], id: x.id, e: r3(x.e), chem: r3(x.chem), sysE: r3(sys.per[i]!.e), seenE: r3(seen.per[i]!.e), fullE: r3(full.per[i]!.e),
      sizePen: r3(x.sizePen), oneOnOne: x.oneOnOne, overlap: r3(x.overlap), complementA: r3(x.complementA), complementB: r3(x.complementB), why: x.why, actor: r3(x.actor), pen: x.pen,
      seenWhy: seen.per[i]!.why, seenComplementA: r3(seen.per[i]!.complementA), seenOverlap: r3(seen.per[i]!.overlap),
    })),
    persons: ps.map(p => ({
      ref: refOf[p.id], id: p.id, archetype: p.archetype, tier: p.hidden.richness, honesty: r3(p.hidden.honesty), adversarial: p.hidden.adversarial ?? null,
      trueAge: p.hidden.trueAge, claimedAge: p.public.claimedAge, socialEnergy: r3(p.hidden.socialEnergy), capacity: r3(p.hidden.capacity), flakiness: r3(p.hidden.flakiness),
      preferredGroupSize: p.hidden.preferredGroupSize, boundaries: p.hidden.boundaries,
      hiddenInterests: p.hidden.interests, hiddenSkills: p.hidden.skills, hiddenDesires: p.hidden.desires.map(d => `${d.id}@${d.strength}`),
      statedInterests: p.public.statedInterests, statedIntents: p.public.statedIntents.map(i => i.desireId),
      knownInterests: knownView(p, "seen").interests, knownSkills: knownView(p, "seen").skills, knownIntents: knownView(p, "seen").desires.map(d => d.id),
      intentMode: p.knowledge?.chat.intentMode, knownBoundaries: knownView(p, "seen").boundaries,
      badSourceFacts: (p.knowledge?.observations ?? []).filter(o => o.truth !== "correct" && !o.facet.sensitive).map(o => `${o.truth}:${o.facet.source}:${o.facet.value}`),
      relationships: p.relationships.filter(x => ids.includes(x.to)).map(x => x.type),
    })),
  }));
}
writeFileSync(outPath, out.join("\n") + "\n");
console.log(`wrote ${out.length} items to ${outPath}; ${mismatches} mismatches vs the results file`);
