#!/usr/bin/env bun
// GEPA-lite: reflective prompt evolution with a Pareto front over per-item wins (after Agrawal et al.
// 2025, arXiv 2507.19457), for the pass-1 screen prompt. Dev split only.
//
//   bun run prototypes/prompt-opt/src/gepa.ts --features <features.jsonl> [--iters 20] [--cap 1.2]
//        [--val 70] [--mb 10] [--tag pilot] [--seed 1]
//
// Loop:
//   1. candidates = [seed]; evaluate seed on the Pareto/validation set (dev, stratified).
//   2. pick a parent from the Pareto front: for each val item, the candidates with the best verdict
//      (expected accuracy) on it; drop dominated candidates; sample proportional to items "won".
//   3. take the next minibatch from the feedback set (dev minus val, epoch-shuffled); run the parent.
//   4. luna reflects on the parent's reasoning + verdicts + the soft label, diagnoses systematic
//      errors and writes a full new prompt (output contract and hard policy must stay verbatim).
//   5. run the child on the same minibatch; if its mean score beats the parent's, evaluate it on the
//      val set and add it to the pool. Otherwise discard.
//   6. stop at --iters or the spend cap; write out/<tag>.json (all candidates, per-item val scores, spend).
// The test split is never touched here (see test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadItems, shuffle, splitDev, type Item } from "./data.ts";
import { evaluate, meanOf, type ItemResult } from "./evaluate.ts";
import { Budget, chatJson } from "./llm.ts";
import { CONTRACT_LINE, POLICY_LINES, SEED_VERSION, seedPrompt } from "./seed.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const FEATURES = arg("features")!;
const ITERS = Number(arg("iters", "20")), CAP = Number(arg("cap", "1.2")), NVAL = Number(arg("val", "70")), MB = Number(arg("mb", "10"));
const TAG = arg("tag", "pilot")!, SEED = Number(arg("seed", "1"));
const OUT = join(import.meta.dir, "../out");

export interface Candidate {
  id: number; parent: number | null; iter: number; prompt: string; diagnosis?: string; changes?: string[];
  val: ItemResult[]; valMean: number; valExpAcc: number;
}

/** Pareto parent selection over per-item expected accuracy (GEPA Alg. 2, simplified). */
export function selectParent(cands: Candidate[], rnd: () => number): Candidate {
  const nItems = cands[0]!.val.length;
  const wins = new Map<number, number>();
  const bestSets: number[][] = [];
  for (let i = 0; i < nItems; i++) {
    const best = Math.max(...cands.map(c => c.val[i]!.expAcc));
    bestSets.push(cands.filter(c => c.val[i]!.expAcc >= best - 1e-9).map(c => c.id));
  }
  // Dominated = another candidate is at least as good on every item and better on one.
  const dominated = new Set<number>();
  for (const a of cands) for (const b of cands) {
    if (a === b || dominated.has(b.id)) continue;
    const ge = a.val.every((r, i) => b.val[i]!.expAcc >= r.expAcc - 1e-9), gt = a.val.some((r, i) => b.val[i]!.expAcc > r.expAcc + 1e-9);
    if (ge && gt) { dominated.add(a.id); break; }
  }
  for (const s of bestSets) for (const id of s) if (!dominated.has(id)) wins.set(id, (wins.get(id) ?? 0) + 1);
  const total = [...wins.values()].reduce((x, y) => x + y, 0);
  let r = rnd() * total;
  for (const [id, w] of wins) { r -= w; if (r <= 0) return cands.find(c => c.id === id)!; }
  return cands[0]!;
}

const REFLECT_SYSTEM = `You improve the system prompt of an LLM judge. The judge screens proposed introductions between members of a people-matching service and answers yes or no with a calibrated probability.
You get the judge's CURRENT PROMPT and a batch of EXAMPLES. Each example shows the judge's input (JSON), the judge's own reasoning, its verdict and probability, and the REFERENCE: the probability that the introduction turns out well for everyone attending (each person enjoys and benefits from meeting). A verdict is correct when it is "yes" for a reference >= 0.5 and "no" below. References between 0.35 and 0.65 are close to a coin flip: do not derive rules from them.
Your job:
1. Diagnose SYSTEMATIC reasons for the wrong verdicts and badly calibrated probabilities: which instruction misleads the judge, which rule is missing, what it over- or under-weights. Look at the correct examples too, so you do not break what works.
2. Rewrite the prompt to fix them. Write general rules about kinds of evidence, never facts, refs, ids or wording specific to one example.
Constraints on the new prompt:
- Keep these lines verbatim: ${POLICY_LINES.map(l => JSON.stringify(l)).join("; ")}.
- Keep the numbered JSON key list (1. "reasoning" ... 7. "member_why") in the same order: reasoning first, verdict after it, member-facing text last. You may change the guidance inside each step.
- Keep this final line verbatim: ${CONTRACT_LINE}
- Keep the member_why privacy rules.
- Prefer a few precise rules over many; the new prompt must be at most {MAXLEN} characters.
Return ONLY JSON: {"diagnosis": string (3-8 sentences), "changes": [string, ...], "new_prompt": string}`;

function feedbackBlock(it: Item, r: ItemResult, k: number): string {
  const want = it.pGood >= 0.5 ? "yes" : "no";
  const status = r.verdict === null ? `FAILED (${r.error})` : r.verdict === want ? "correct" : "WRONG";
  const note = it.pGood > 0.35 && it.pGood < 0.65 ? " (near coin flip: weak evidence)" : "";
  return `### Example ${k + 1}: ${status}
INPUT: ${it.user}
JUDGE REASONING: ${r.reasoning || "(none)"}
JUDGE VERDICT: ${r.verdict ?? "-"}, match_probability ${r.prob ?? "-"}
REFERENCE: ${it.pGood.toFixed(2)} -> correct verdict "${want}"${note}`;
}

export function validPrompt(p: string, maxLen: number): string | null {
  if (p.length > maxLen) return `too long (${p.length} > ${maxLen})`;
  if (!p.includes(CONTRACT_LINE)) return "output contract line changed";
  for (const l of POLICY_LINES) if (!p.includes(l)) return `policy line missing: ${l.slice(0, 40)}`;
  const iR = p.indexOf('1. "reasoning"'), iV = p.indexOf('"verdict"'), iW = p.indexOf('7. "member_why"');
  if (iR < 0 || iW < 0 || iV < iR) return "explanation-first key list broken";
  return null;
}

async function main() {
  const all = loadItems(FEATURES);
  const dev = all.filter(i => i.split === "dev");
  const { val, feedback } = splitDev(dev, NVAL);
  const budget = new Budget(CAP);
  const seed = seedPrompt();
  const MAXLEN = Math.round(seed.length * 1.8);
  let rs = 1;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  for (let i = 0; i < SEED; i++) rnd();
  console.log(`dev ${dev.length} items: val ${val.length}, feedback ${feedback.length}; seed ${SEED_VERSION} (${seed.length} chars); cap $${CAP}`);

  const cands: Candidate[] = [];
  const seedVal = await evaluate(seed, val, budget);
  cands.push({ id: 0, parent: null, iter: 0, prompt: seed, val: seedVal, valMean: meanOf(seedVal), valExpAcc: seedVal.reduce((s, r) => s + r.expAcc, 0) / val.length });
  console.log(`seed val score ${cands[0]!.valMean.toFixed(3)} expAcc ${cands[0]!.valExpAcc.toFixed(3)} spend $${budget.usd.toFixed(4)}`);

  const log: any[] = [];
  let order = shuffle(feedback, 100 + SEED), pos = 0;
  const save = () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({
      tag: TAG, seedVersion: SEED_VERSION, iters: ITERS, cap: CAP, nVal: val.length, nFeedback: feedback.length, mb: MB,
      valIds: val.map(i => i.id), spendUsd: budget.usd, freshCalls: budget.freshCalls, cachedCalls: budget.cachedCalls, fallbackCalls: budget.fallbackCalls,
      tokens: { prompt: budget.promptTokens, completion: budget.completionTokens }, log,
      candidates: cands.map(c => ({ ...c, val: c.val.map(r => ({ id: r.id, verdict: r.verdict, prob: r.prob, expAcc: r.expAcc, score: r.score, error: r.error })) })),
    }, null, 1));
  };

  for (let iter = 1; iter <= ITERS; iter++) {
    try {
      budget.check();
      const parent = selectParent(cands, rnd);
      if (pos + MB > order.length) { order = shuffle(feedback, 100 + SEED + iter); pos = 0; }
      const mb = order.slice(pos, pos + MB); pos += MB;
      const pRes = await evaluate(parent.prompt, mb, budget);
      const pMean = meanOf(pRes);
      const examples = mb.map((it, k) => feedbackBlock(it, pRes[k]!, k)).join("\n\n");
      const refl = await chatJson([
        { role: "system", content: REFLECT_SYSTEM.replace("{MAXLEN}", String(MAXLEN)) },
        { role: "user", content: `CURRENT PROMPT:\n<<<\n${parent.prompt}\n>>>\n\nEXAMPLES (${mb.length}; ${pRes.filter((r, k) => r.verdict !== (mb[k]!.pGood >= 0.5 ? "yes" : "no")).length} wrong):\n\n${examples}` },
      ], { budget, maxTokens: 16000 });
      const child = String(refl.json.new_prompt ?? "");
      const bad = validPrompt(child, MAXLEN);
      if (bad) { log.push({ iter, parent: parent.id, accepted: false, reason: `invalid: ${bad}`, pMean }); console.log(`iter ${iter}: parent ${parent.id} -> invalid (${bad})`); save(); continue; }
      const cRes = await evaluate(child, mb, budget);
      const cMean = meanOf(cRes);
      const entry: any = { iter, parent: parent.id, pMean, cMean, diagnosis: refl.json.diagnosis, changes: refl.json.changes, mbIds: mb.map(i => i.id) };
      if (cMean <= pMean) {
        log.push({ ...entry, accepted: false, reason: "no minibatch gain" });
        console.log(`iter ${iter}: parent ${parent.id} mb ${pMean.toFixed(3)} -> child ${cMean.toFixed(3)} rejected; $${budget.usd.toFixed(4)}`);
        save(); continue;
      }
      const v = await evaluate(child, val, budget);
      const c: Candidate = { id: cands.length, parent: parent.id, iter, prompt: child, diagnosis: refl.json.diagnosis, changes: refl.json.changes, val: v, valMean: meanOf(v), valExpAcc: v.reduce((s, r) => s + r.expAcc, 0) / val.length };
      cands.push(c);
      log.push({ ...entry, accepted: true, child: c.id, valMean: c.valMean, valExpAcc: c.valExpAcc });
      console.log(`iter ${iter}: parent ${parent.id} mb ${pMean.toFixed(3)} -> child ${cMean.toFixed(3)} ACCEPTED as #${c.id}: val ${c.valMean.toFixed(3)} (expAcc ${c.valExpAcc.toFixed(3)}); $${budget.usd.toFixed(4)}`);
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 200);
      log.push({ iter, error: msg });
      console.log(`iter ${iter}: error ${msg}`);
      if (/spend cap/.test(msg)) { save(); break; }
    }
    save();
  }
  save();
  const best = [...cands].sort((a, b) => b.valMean - a.valMean)[0]!;
  console.log(`done: ${cands.length} candidates; best #${best.id} val ${best.valMean.toFixed(3)} vs seed ${cands[0]!.valMean.toFixed(3)}; spend $${budget.usd.toFixed(4)} (${budget.freshCalls} fresh calls, ${budget.fallbackCalls} via fallback)`);
}

if (import.meta.main) await main();
