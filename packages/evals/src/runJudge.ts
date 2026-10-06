// Judge suite runner + scoring. Uses the production judges from packages/judge unchanged
// (quality, shareability, timing, privacy audit, and the minors / romance policy judge). For
// policy items the models are compared on the LLM rubric alone (judgePolicyLLM); the production
// combination (deterministic checkPolicy first, LLM only if rules find no hard violation) is
// scored offline from the same responses by `productionPolicy`.
import type { LLM } from "../../core/src/index.ts";
import { checkMessage } from "../../judge/src/rules.ts";
import { judgeExplanationShareability, judgeMessageQuality, judgeTiming, privacyAudit } from "../../judge/src/llmJudges.ts";
import { checkPolicy, judgePolicyLLM } from "../../judge/src/policy.ts";
import type { JudgeEvalItem, JudgeCategory } from "./judgeDataset.ts";
import { classification, cohensKappa, percentile } from "./metrics.ts";
import { pmap, withScope, type HttpRecord } from "./transport.ts";
import type { RunOptions } from "./runRec.ts";

export interface JudgeResult { itemId: string; model: string; predicted: boolean | null; error?: string; records: HttpRecord[] }

export async function predictJudge(llm: LLM, item: JudgeEvalItem, maxTokens: number): Promise<boolean> {
  const it = item.input;
  const o = { maxTokens };
  switch (it.judge) {
    case "quality": return (await judgeMessageQuality(llm, { message: it.message }, o)).pass;
    case "shareability": return (await judgeExplanationShareability(llm, { explanation: it.explanation, privateFacts: it.privateFacts }, o)).shareable;
    case "timing": return (await judgeTiming(llm, it, o)).appropriate;
    case "privacy": return (await privacyAudit(llm, it, o)).pass;
    case "policy": return (await judgePolicyLLM(llm, { message: it.message, context: it.context }, o)).compliant;
  }
}

export async function runJudgeSuite(model: string, items: JudgeEvalItem[], o: RunOptions): Promise<JudgeResult[]> {
  return pmap(items, o.concurrency, async (item): Promise<JudgeResult> => {
    const r = await withScope(model, { attempt: 0, cacheDir: o.cacheDir, settings: o.settings, offline: o.offline, fetch: o.fetch }, llm => predictJudge(llm, item, o.maxTokens));
    return { itemId: item.id, model, predicted: typeof r.value === "boolean" ? r.value : null, error: r.error, records: r.records };
  }, d => o.onProgress?.(d, items.length));
}

/**
 * Deterministic rules from packages/judge as a reference rater, where they can decide:
 * checkMessage for tone/shareability, checkPolicy for policy (a hard violation = fail, no signal
 * at all = pass, "escalate" = cannot decide). Everything else is unscored (null).
 */
export function rulesBaseline(items: JudgeEvalItem[]): JudgeResult[] {
  return items.map(item => {
    const it = item.input;
    let predicted: boolean | null = null;
    if (it.judge === "quality") predicted = checkMessage(it.message).pass;
    else if (it.judge === "shareability") predicted = checkMessage(it.explanation).pass;
    else if (it.judge === "policy") {
      const v = checkPolicy(it.message, it.context).verdict;
      predicted = v === "violation" ? false : v === "clear" ? true : null;
    }
    return { itemId: item.id, model: "rules", predicted, records: [] };
  });
}

/** Production policy judge from a model's LLM-only results: rules violation overrides the model. */
export function productionPolicy(items: JudgeEvalItem[], results: JudgeResult[], name: string): JudgeResult[] {
  return items.map((item, i) => {
    const r = results[i]!;
    if (item.input.judge !== "policy") return r;
    const v = checkPolicy(item.input.message, item.input.context).verdict;
    return { ...r, model: name, predicted: v === "violation" ? false : r.predicted };
  });
}

export interface JudgeScore {
  name: string; n: number; scored: number; failures: number;
  agreement: number; kappa: number;
  byCategory: Record<JudgeCategory, { n: number; correct: number; accuracy: number }>;
  /** Share of true leak items (privacy + shareability, label=false) the judge passed. */
  privacyFnRate: number; privacyFn: number; privacyLeaks: number;
  inferenceFnRate: number;
  policyFnRate: number;
  falseFlagRate: number;
  /** Accuracy on the deliberately ambiguous "hard" items (sub === "hard"). */
  hardN: number; hardAccuracy: number;
  /** Accuracy on the original (non-hard) items. */
  baseAccuracy: number;
  latencyP50: number; latencyP95: number; costMicro: number; freshCostMicro: number;
  correct: boolean[];
}

export function scoreJudge(name: string, items: JudgeEvalItem[], results: JudgeResult[], opts: { skipUnscored?: boolean } = {}): JudgeScore {
  // For model raters a failure counts as disagreement; for the rules reference, unscorable items are skipped.
  const idx = items.map((_, i) => i).filter(i => !opts.skipUnscored || results[i]!.predicted !== null);
  const gold = idx.map(i => items[i]!.label);
  const pred = idx.map(i => results[i]!.predicted ?? !items[i]!.label);
  const correctAll = items.map((it, i) => results[i]!.predicted !== null && results[i]!.predicted === it.label);
  const cls = classification(pred, gold);
  const byCategory = {} as JudgeScore["byCategory"];
  for (const i of idx) {
    const c = items[i]!.category;
    byCategory[c] ??= { n: 0, correct: 0, accuracy: 0 };
    byCategory[c].n++;
    if (correctAll[i]) byCategory[c].correct++;
  }
  for (const c of Object.values(byCategory)) c.accuracy = c.correct / c.n;
  const fnRate = (f: (it: JudgeEvalItem) => boolean) => {
    const leak = idx.filter(i => f(items[i]!) && !items[i]!.label);
    // A failed call is not a catch: it counts as a false negative.
    const missed = leak.filter(i => results[i]!.predicted !== false);
    return { n: leak.length, missed: missed.length, rate: leak.length ? missed.length / leak.length : NaN };
  };
  const priv = fnRate(it => it.category === "privacy" || it.category === "shareability");
  const negatives = idx.filter(i => items[i]!.label);
  const hardIdx = idx.filter(i => items[i]!.sub === "hard"), baseIdx = idx.filter(i => items[i]!.sub !== "hard");
  const recs = idx.flatMap(i => results[i]!.records);
  const lat = idx.filter(i => results[i]!.records.length).map(i => results[i]!.records.reduce((s, x) => s + x.latencyMs, 0));
  return {
    name, n: items.length, scored: idx.length, failures: idx.filter(i => results[i]!.predicted === null).length,
    agreement: cls.accuracy, kappa: cohensKappa(pred, gold), byCategory,
    privacyFnRate: priv.rate, privacyFn: priv.missed, privacyLeaks: priv.n,
    inferenceFnRate: fnRate(it => it.category === "privacy" && it.sub === "inference").rate,
    policyFnRate: fnRate(it => it.category === "policy").rate,
    hardN: hardIdx.length, hardAccuracy: hardIdx.length ? hardIdx.filter(i => correctAll[i]).length / hardIdx.length : NaN,
    baseAccuracy: baseIdx.length ? baseIdx.filter(i => correctAll[i]).length / baseIdx.length : NaN,
    falseFlagRate: negatives.length ? negatives.filter(i => results[i]!.predicted === false).length / negatives.length : NaN,
    latencyP50: percentile(lat, 50), latencyP95: percentile(lat, 95),
    costMicro: recs.reduce((s, x) => s + x.costMicro, 0), freshCostMicro: recs.filter(x => !x.cached).reduce((s, x) => s + x.costMicro, 0),
    correct: correctAll,
  };
}
